"""
POST /api/ibkr-orders — adaptador DECIDE frontend → IB Gateway.

Recebe o formato do cliente:
  {ticker, action, delta_pct, est_eur, aum, paper_mode, …}

Converte para o formato interno (ticker, side, qty) e reutiliza toda
a lógica de execução existente em send_orders.py.
"""
from __future__ import annotations

import concurrent.futures
import math
import os
import time
import traceback
from typing import Any, List, Optional

from fastapi import APIRouter
from ib_insync import IB, Contract, Forex, LimitOrder, MarketOrder, Stock
from pydantic import BaseModel

from ib_socket_env import ib_socket_host, ib_socket_port
from ib_insync_thread_loop import ensure_ib_insync_loop, teardown_ib_insync_loop
from ibkr_paper_checks import ibkr_require_paper_env, is_paper_account
from routers.send_orders import (
    TWS_CLIENT_ID,
    _is_eur_mm_ucits_symbol,
    _place_stock,
    _place_eur_mm_ucits,
    _ib_portfolio_net_qty_by_key,
    _position_map_key,
)

router = APIRouter(tags=["ibkr-orders"])

TWS_HOST = ib_socket_host()
TWS_PORT = ib_socket_port()

# Taxa EUR/USD para estimar qty em acções USD (pode ser overridden via env)
_FX_EURUSD = float(os.environ.get("DECIDE_EURUSD_ESTIMATE", "1.09"))

# clientId separado para não colidir com o send_orders (778).
# Base 790: afastado de 779/780 que ficaram presos em sessões anteriores.
_CLIENT_ID = int(os.environ.get("TWS_CLIENT_ID_IBKR_ORDERS", "790"))


class _OrderIn(BaseModel):
    ticker: str
    action: str          # Comprar | Aumentar | Reduzir | Vender
    delta_pct: float = 0.0
    est_eur: float = 0.0
    qty: Optional[float] = None  # se fornecida, usa directamente (ignora price lookup)


class IbkrOrdersBody(BaseModel):
    orders: List[_OrderIn]
    paper_mode: bool = True
    aum: float = 0.0
    profile: str = ""
    fx_exposure: str = "parcial"
    margin_enabled: bool = False
    sell_cap_disabled: bool = False  # override env var — use True when flattening shorts


def _get_last_price(ib: IB, ticker: str, currency: str) -> Optional[float]:
    """Obtém o último preço disponível para um contrato."""
    try:
        exchange = "SMART"
        c = Stock(ticker, exchange, currency)
        qcs = ib.qualifyContracts(c)
        if not qcs:
            return None
        tickers = ib.reqTickers(qcs[0])
        if not tickers:
            return None
        t = tickers[0]
        for v in (t.last, t.close, t.bid, t.ask):
            try:
                fv = float(v)
                if math.isfinite(fv) and fv > 0:
                    return fv
            except (TypeError, ValueError):
                continue
    except Exception:
        pass
    return None


def _fetch_live_eurusd(ib: IB) -> float:
    """Obtém a taxa EUR/USD live via IDEALPRO. Devolve o fallback estático se falhar."""
    try:
        fx = Forex("EURUSD")
        ib.qualifyContracts(fx)
        tickers = ib.reqTickers(fx)
        if tickers:
            t = tickers[0]
            for v in (t.last, t.close, t.bid, t.ask):
                try:
                    fv = float(v)
                    if math.isfinite(fv) and fv > 0:
                        return fv
                except (TypeError, ValueError):
                    continue
    except Exception:
        pass
    return _FX_EURUSD  # fallback estático


def _est_qty(ib: IB, ticker: str, est_eur: float, fx_eurusd: float) -> int:
    """Calcula quantidade a partir do valor EUR estimado e do preço de mercado."""
    if est_eur <= 0:
        return 0
    if _is_eur_mm_ucits_symbol(ticker):
        price = _get_last_price(ib, ticker, "EUR")
        if price and price > 0:
            return max(1, round(est_eur / price))
    else:
        price = _get_last_price(ib, ticker, "USD")
        if price and price > 0:
            return max(1, round(est_eur * fx_eurusd / price))
    # Sem preço: fallback conservador (1 acção) — melhor do que 0
    return 1


def _execute_ib_orders(
    orders: List[_OrderIn],
    sell_cap_disabled: bool,
    host: str,
    port: int,
    client_id: int,
    fx_exposure: str = "parcial",
    aum_eur: float = 0.0,
) -> dict[str, Any]:
    """Corre numa thread isolada — submete TODAS as ordens em batch para caber no timeout Cloudflare."""
    from routers.send_orders import MIN_FX_HEDGE_USD

    created_loop, _loop = ensure_ib_insync_loop()
    ib = IB()
    fills: List[dict[str, Any]] = []

    # Try clientId; cycle through 4 alternates if stale session exists
    tried: list[int] = []
    connected = False
    for cid in [client_id] + list(range(client_id + 1, client_id + 5)):
        try:
            ib.connect(host, port, clientId=cid, timeout=5)
            connected = True
            break
        except Exception:
            tried.append(cid)
            ib = IB()
    if not connected:
        return {"status": "error",
                "error": f"Não foi possível ligar à IB Gateway {host}:{port} — clientIds {tried} em uso. Reinicia a IB Gateway.",
                "fills": []}

    try:
        ib.reqMarketDataType(3)

        is_paper, accounts = is_paper_account(ib)
        if ibkr_require_paper_env() and not is_paper:
            return {"status": "rejected", "error": f"Conta não é paper ({accounts}).", "fills": []}

        fx_eurusd = _fetch_live_eurusd(ib)

        rem_long: dict[str, float] = {}
        if not sell_cap_disabled:
            net_map = _ib_portfolio_net_qty_by_key(ib)
            rem_long = {k: max(0.0, v) for k, v in net_map.items()}

        # ── Phase 1: Batch qualify contracts (1 round-trip for ALL tickers) ──
        raw_contracts = []
        for o in orders:
            sym = (o.ticker or "").strip().upper()
            if _is_eur_mm_ucits_symbol(sym):
                raw_contracts.append(Stock(sym, "SMART", "EUR"))
            else:
                raw_contracts.append(Stock(sym, "SMART", "USD"))
        try:
            qualified = ib.qualifyContracts(*raw_contracts)
        except Exception:
            qualified = []
        qc_map: dict[str, Any] = {}
        for qc in qualified:
            if qc and getattr(qc, "symbol", None):
                qc_map[qc.symbol.upper()] = qc

        # ── Phase 2: Batch price fetch (1 round-trip for ALL contracts) ──
        valid_qcs = [q for q in qualified if q and getattr(q, "conId", 0)]
        price_map: dict[str, float] = {}
        if valid_qcs:
            try:
                tickers_data = ib.reqTickers(*valid_qcs)
                for td in tickers_data:
                    sym_t = getattr(td.contract, "symbol", "").upper()
                    for v in (td.last, td.close, td.bid, td.ask):
                        try:
                            fv = float(v)
                            if math.isfinite(fv) and fv > 0:
                                price_map[sym_t] = fv
                                break
                        except (TypeError, ValueError):
                            continue
            except Exception:
                pass

        # ── Phase 3: Submit equity orders + per-order FX hedge ──────────────
        _fx_normalised = fx_exposure.lower().strip()
        _do_fx = _fx_normalised in ("total", "parcial", "protegida")
        _hedge_frac = 0.9 if _fx_normalised == "protegida" else (1.0 if _fx_normalised == "total" else 0.5)

        # Pre-build a single FXCONV contract (reused for all mini-hedges, no qualifyContracts needed)
        _fxconv_contract = Contract(secType="CASH", symbol="EUR", currency="USD", exchange="FXCONV")

        pending: list[tuple[Any, str, str, int, _OrderIn]] = []
        # (fx_trade, sym, eur_qty) — mini FX hedges paired with each BUY
        pending_fx: list[tuple[Any, str, int]] = []

        for o in orders:
            sym = (o.ticker or "").strip().upper()
            side = "BUY" if o.action in ("Comprar", "Aumentar") else "SELL"

            if o.qty is not None and o.qty > 0:
                qty = int(math.floor(o.qty + 1e-9)) or 1
            else:
                price = price_map.get(sym)
                if price and price > 0:
                    # 0.90 safety factor: cotações atrasadas tendem a subestimar o preço real
                    # → comprar 10% menos para evitar overshoot do AUM
                    _PRICE_SAFETY = float(os.environ.get("DECIDE_QTY_SAFETY_FACTOR", "0.90"))
                    if _is_eur_mm_ucits_symbol(sym):
                        qty = max(1, int(abs(o.est_eur) * _PRICE_SAFETY / price))
                    else:
                        qty = max(1, int(abs(o.est_eur) * _PRICE_SAFETY * fx_eurusd / price))
                else:
                    qty = 1

            if qty <= 0:
                fills.append({"ticker": sym, "action": side, "requested_qty": 0,
                               "filled": 0, "status": "skip_zero", "message": "qty=0"})
                continue

            if not sell_cap_disabled and side == "SELL":
                cap_key = _position_map_key(sym)
                avail = int(math.floor(rem_long.get(cap_key, 0.0) + 1e-9))
                if avail < 1:
                    fills.append({"ticker": sym, "action": "SELL", "requested_qty": float(qty),
                                   "filled": 0, "status": "skip_sell_no_long",
                                   "message": "Sem posição longa disponível."})
                    continue
                qty = min(qty, avail)
                rem_long[cap_key] = max(0.0, avail - qty)

            qc = qc_map.get(sym)
            if not qc:
                fills.append({"ticker": sym, "action": side, "requested_qty": float(qty),
                               "filled": 0, "status": "contract_not_qualified",
                               "message": "Contrato não qualificou na IB."})
                continue

            equity_order = MarketOrder(side, int(qty))
            equity_order.tif = "DAY"
            equity_order.outsideRth = True
            trade = ib.placeOrder(qc, equity_order)
            pending.append((trade, sym, side, qty, o))

            # ── Per-order mini FX hedge (immediately after equity order) ────
            if _do_fx and side == "BUY" and not _is_eur_mm_ucits_symbol(sym):
                est_usd = abs(o.est_eur) * fx_eurusd
                eur_hedge = max(100, int(est_usd * _hedge_frac / fx_eurusd / 100) * 100)
                fx_order = MarketOrder("BUY", eur_hedge)
                fx_order.tif = "DAY"
                try:
                    fx_trade = ib.placeOrder(_fxconv_contract, fx_order)
                    pending_fx.append((fx_trade, sym, eur_hedge))
                except Exception:
                    pass  # per-order FX failure logged in final step

        # ── Phase 4: Wait up to 8s for ALL fills collectively ──
        deadline = time.monotonic() + 8.0
        while time.monotonic() < deadline:
            all_equity_done = all(
                str(t.orderStatus.status or "").strip() in
                ("Filled", "Cancelled", "ApiCancelled", "Inactive")
                or float(t.orderStatus.filled or 0) >= qty - 1e-6
                for t, _, _, qty, _ in pending
            )
            if all_equity_done:
                break
            ib.sleep(0.3)

        # Collect equity results
        total_buy_usd = 0.0
        for trade, sym, side, qty, o in pending:
            st = str(trade.orderStatus.status or "").strip() or "Submitted"
            ap = float(trade.orderStatus.avgFillPrice or 0.0)
            filled = float(trade.orderStatus.filled or 0.0)
            oid = int(getattr(trade.order, "orderId", 0) or 0)
            fills.append({
                "ticker": sym, "action": side,
                "requested_qty": float(qty), "filled": filled,
                "avg_fill_price": ap if ap > 0 else None,
                "status": st, "message": None,
                "ib_order_id": oid or None,
            })
            if side == "BUY" and not _is_eur_mm_ucits_symbol(sym):
                if filled > 0 and ap > 0:
                    total_buy_usd += filled * ap
                else:
                    total_buy_usd += abs(o.est_eur) * fx_eurusd

        # Collect per-order FX hedge results (already submitted above)
        for fx_trade, sym, eur_hedge in pending_fx:
            fx_st = str(fx_trade.orderStatus.status or "").strip() or "Submitted"
            fx_filled = float(fx_trade.orderStatus.filled or 0.0)
            fx_ap = float(fx_trade.orderStatus.avgFillPrice or 0.0)
            fills.append({
                "ticker": "EUR/USD",
                "action": "BUY",
                "requested_qty": eur_hedge,
                "filled": fx_filled,
                "avg_fill_price": fx_ap if fx_ap > 0 else fx_eurusd,
                "status": fx_st,
                "message": f"Hedge FX {sym} (FXCONV): {eur_hedge:,} EUR @ {fx_eurusd:.4f}",
                "is_fx": True,
            })

        # Per-order FX hedges are submitted inline above (pending_fx).
        # A short wait ensures IB has processed them before we collect status.
        if pending_fx:
            ib.sleep(3)

    except (ConnectionRefusedError, TimeoutError, OSError) as exc:
        return {
            "status": "error",
            "error": (f"Não foi possível ligar ao IB Gateway em {host}:{port} — {type(exc).__name__}. "
                      "Confirme que está aberto, autenticado e com API socket activa."),
            "fills": fills,
        }
    except Exception as exc:  # noqa: BLE001
        traceback.print_exc()
        return {"status": "error", "error": f"{type(exc).__name__}: {exc}", "fills": fills}
    finally:
        try:
            if ib.isConnected():
                ib.disconnect()
        except Exception:
            pass
        teardown_ib_insync_loop(created_loop, _loop)

    order_ref = "ORD-" + hex(int(time.time() * 1000))[2:].upper()
    submitted = sum(1 for f in fills if f.get("status") not in
                    ("skip_zero", "skip_sell_no_long", "contract_not_qualified"))
    return {"ok": True, "status": "submitted", "order_ref": order_ref,
            "submitted": submitted, "fills": fills}


@router.post("/api/ibkr-orders")
def ibkr_orders_post(body: IbkrOrdersBody) -> dict[str, Any]:
    """Recebe ordens do frontend DECIDE e executa-as na IB via ib_insync."""

    orders = [o for o in body.orders if abs(o.est_eur) > 0 and o.action not in ("Manter",)]
    if not orders:
        return {"status": "rejected", "error": "Sem ordens a executar (nenhuma posição com est_eur > 0 e acção activa).", "fills": []}

    sell_cap_disabled = (
        body.sell_cap_disabled
        or os.environ.get("DECIDE_DISABLE_SELL_LONG_CAP", "").strip().lower() in ("1", "true", "yes")
    )

    # Corre em thread isolada — evita conflito de event loop Python 3.13 + AnyIO/FastAPI
    # NÃO usar 'with' (shutdown(wait=True) bloquearia mesmo após future.result timeout)
    _ex = concurrent.futures.ThreadPoolExecutor(max_workers=1)
    future = _ex.submit(
        _execute_ib_orders, orders, sell_cap_disabled,
        TWS_HOST, TWS_PORT, _CLIENT_ID,
        body.fx_exposure, body.aum,
    )
    try:
        result = future.result(timeout=280)
        _ex.shutdown(wait=False)
        return result
    except concurrent.futures.TimeoutError:
        _ex.shutdown(wait=False)
        return {"status": "error",
                "error": f"Timeout (280s) ao executar ordens na IB Gateway {TWS_HOST}:{TWS_PORT}. Mercado pode estar fechado ou ordens muito numerosas.",
                "fills": []}


@router.get("/api/ibkr-orders")
def ibkr_orders_probe() -> dict[str, Any]:
    return {
        "ok": True,
        "endpoint": "/api/ibkr-orders",
        "ib_host": TWS_HOST,
        "ib_port": TWS_PORT,
    }
