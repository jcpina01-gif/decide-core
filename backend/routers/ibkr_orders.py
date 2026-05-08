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
    """Corre numa thread isolada para garantir event loop limpo (compat. Python 3.13 + FastAPI)."""
    from routers.send_orders import OrderIn as _SOrderIn, MIN_FX_HEDGE_USD

    created_loop, _loop = ensure_ib_insync_loop()
    ib = IB()
    fills: List[dict[str, Any]] = []

    # Try clientId; if already in use, cycle through 3 alternates (stale sessions from crashes)
    tried: list[int] = []
    connected = False
    for cid in [client_id] + list(range(client_id + 1, client_id + 4)):
        try:
            ib.connect(host, port, clientId=cid, timeout=5)
            connected = True
            break
        except Exception:
            tried.append(cid)
            ib = IB()  # fresh instance for next attempt
    if not connected:
        return {"status": "error",
                "error": f"Não foi possível ligar à IB Gateway {host}:{port} — clientIds {tried} em uso. Reinicia a IB Gateway.",
                "fills": []}

    try:
        ib.reqMarketDataType(3)

        is_paper, accounts = is_paper_account(ib)
        if ibkr_require_paper_env() and not is_paper:
            return {
                "status": "rejected",
                "error": f"Conta ligada não é paper ({accounts}).",
                "fills": [],
            }

        # ── Fetch live EUR/USD rate once (used for all USD qty calculations) ──
        fx_eurusd = _fetch_live_eurusd(ib)

        rem_long: dict[str, float] = {}
        if not sell_cap_disabled:
            net_map = _ib_portfolio_net_qty_by_key(ib)
            rem_long = {k: max(0.0, v) for k, v in net_map.items()}

        total_buy_usd = 0.0  # accumulate ACTUAL filled USD notional for FX hedge

        for o in orders:
            sym = (o.ticker or "").strip().upper()
            side = "BUY" if o.action in ("Comprar", "Aumentar") else "SELL"
            # qty explícita tem prioridade (ex: vender toda a carteira com qty real)
            if o.qty is not None and o.qty > 0:
                qty = int(math.floor(o.qty + 1e-9)) or 1
            else:
                qty = _est_qty(ib, sym, abs(o.est_eur), fx_eurusd)
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

            order_in = _SOrderIn(ticker=sym, side=side, qty=float(qty))
            row = _place_eur_mm_ucits(ib, order_in) if _is_eur_mm_ucits_symbol(sym) else _place_stock(ib, order_in)
            fills.append(row)

            # Accumulate ACTUAL filled USD notional for FX hedge (not est_eur which can be a small delta)
            # USD stocks: fill qty * avg_fill_price (price is in USD for US equities)
            if side == "BUY" and not _is_eur_mm_ucits_symbol(sym):
                filled_qty = float(row.get("filled") or 0)
                fill_px = float(row.get("avg_fill_price") or 0)
                if filled_qty > 0 and fill_px > 0:
                    total_buy_usd += filled_qty * fill_px
                else:
                    # Order pending/in-progress — estimate from est_eur converted to USD
                    total_buy_usd += abs(o.est_eur) * fx_eurusd

        # ── EUR/USD hedge (SELL USD / BUY EUR) after equities ────────────────
        # fx_exposure values:
        #   "total" | "protegida" → hedge ~100% of USD exposure
        #   "parcial"             → hedge ~50%
        #   "aberta"  | "nenhum"  → skip
        _fx_normalised = fx_exposure.lower().strip()
        if _fx_normalised in ("total", "parcial", "protegida") and total_buy_usd > 0:
            hedge_frac = 0.9 if _fx_normalised == "protegida" else (1.0 if _fx_normalised == "total" else 0.5)
            usd_to_sell = total_buy_usd * hedge_frac  # already in USD — no EUR conversion needed
            usd_amount_rounded = round(usd_to_sell / 1000) * 1000  # IB min lot 1000 USD
            MIN_FX_FXCONV = 1000.0   # IB minimum lot for FXCONV (currency conversion)
            if usd_to_sell < MIN_FX_FXCONV:
                fills.append({
                    "ticker": "EUR/USD", "action": "BUY",
                    "requested_qty": 0, "filled": 0, "avg_fill_price": fx_eurusd,
                    "status": "skip_fx_below_min",
                    "message": f"Hedge FX ignorado — nocional {usd_to_sell:,.0f} USD < mínimo {MIN_FX_FXCONV:.0f} USD.",
                })
            else:
                try:
                    eur_qty = round(usd_amount_rounded / fx_eurusd, 2) if usd_amount_rounded >= 1 else 0.0
                    if eur_qty < 1.0:
                        raise ValueError(f"EUR qty too small ({eur_qty})")

                    if usd_to_sell >= MIN_FX_HEDGE_USD:
                        # Large amount → use IDEALPRO (OTC interdealer, tightest spreads)
                        fx_contract = Forex("EURUSD")
                        ib.qualifyContracts(fx_contract)
                        venue_label = "IDEALPRO"
                        hedge_order = LimitOrder(
                            "BUY", eur_qty,
                            round(fx_eurusd * 1.002, 5),  # limit slightly above market → fills immediately
                            tif="DAY",
                        )
                    else:
                        # Below IDEALPRO minimum → use FXCONV (IB currency conversion, no minimum)
                        fx_contract = Contract(
                            secType="CASH", symbol="EUR", currency="USD", exchange="FXCONV"
                        )
                        ib.qualifyContracts(fx_contract)
                        if not getattr(fx_contract, "conId", None):
                            # FXCONV not available in this account — fallback to IDEALPRO anyway
                            fx_contract = Forex("EURUSD")
                            ib.qualifyContracts(fx_contract)
                        venue_label = "FXCONV"
                        hedge_order = MarketOrder("BUY", eur_qty)
                        hedge_order.tif = "DAY"

                    trade = ib.placeOrder(fx_contract, hedge_order)
                    ib.sleep(2)
                    st = trade.orderStatus.status or "Submitted"
                    fills.append({
                        "ticker": "EUR/USD",
                        "action": "BUY",
                        "requested_qty": round(eur_qty),
                        "filled": trade.orderStatus.filled,
                        "avg_fill_price": trade.orderStatus.avgFillPrice or fx_eurusd,
                        "status": st,
                        "message": f"Hedge FX {fx_exposure} ({venue_label}): vender {usd_amount_rounded:,.0f} USD @ {fx_eurusd:.4f}",
                    })
                except Exception as fx_exc:
                    fills.append({
                        "ticker": "EUR/USD", "action": "BUY",
                        "requested_qty": 0, "filled": 0,
                        "status": "error",
                        "message": f"Hedge FX falhou: {fx_exc}",
                    })

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
