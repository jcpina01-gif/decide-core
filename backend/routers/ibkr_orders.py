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


def _safe_ib_orders_print(msg: str) -> None:
    """Avoid crashing order flow when Windows console uses cp1252 (cannot encode arrows, etc.)."""
    try:
        print(msg)
    except UnicodeEncodeError:
        print(msg.encode("ascii", errors="replace").decode("ascii"))

from fastapi import APIRouter
from ib_insync import IB, Contract, Forex, MarketOrder, Stock
from pydantic import BaseModel

from ib_socket_env import ib_socket_host, ib_socket_port
from ib_insync_thread_loop import ensure_ib_insync_loop, teardown_ib_insync_loop
from ibkr_paper_checks import ibkr_require_paper_env, is_paper_account
from routers.send_orders import (
    TWS_CLIENT_ID,
    _is_eur_mm_ucits_symbol,
    _place_equity_order_with_attached_fx_hedge,
    _place_eurusd_hedge,
    _place_stock,
    _place_eur_mm_ucits,
    _ib_portfolio_net_qty_by_key,
    _position_map_key,
)

router = APIRouter(tags=["ibkr-orders"])

TWS_HOST = ib_socket_host()
TWS_PORT = ib_socket_port()

# Taxa EUR/USD para estimar qty em acções USD (pode ser overridden via env)
# Default actualizado para reflectir EUR/USD ≈ 1.17 (Maio 2026)
_FX_EURUSD = float(os.environ.get("DECIDE_EURUSD_ESTIMATE", "1.17"))

# ── Last-price cache from DB CSVs (loaded once at startup) ──────────────────
_DB_LAST_PRICES: dict[str, float] = {}

def _load_db_last_prices() -> dict[str, float]:
    """Carrega o último preço de fecho de todos os tickers a partir dos CSVs."""
    import pandas as pd
    prices: dict[str, float] = {}
    data_dir = os.path.join(os.path.dirname(__file__), "..", "data")
    for fname in ("prices_close_expanded.csv", "prices_close.csv",
                  "prices_close_global_20y_from_tws.csv"):
        fpath = os.path.join(data_dir, fname)
        if not os.path.exists(fpath):
            continue
        try:
            df = pd.read_csv(fpath, index_col=0)
            last = df.iloc[-1]
            for col in df.columns:
                val = last.get(col)
                try:
                    fv = float(val)
                    if math.isfinite(fv) and fv > 0 and col not in prices:
                        prices[col.upper()] = fv
                except (TypeError, ValueError):
                    pass
        except Exception:
            pass
    return prices

try:
    _DB_LAST_PRICES = _load_db_last_prices()
except Exception:
    _DB_LAST_PRICES = {}

# clientId separado para não colidir com o send_orders (778).
# Base 790: afastado de 779/780 que ficaram presos em sessões anteriores.
_CLIENT_ID = int(os.environ.get("TWS_CLIENT_ID_IBKR_ORDERS", "790"))


class _OrderIn(BaseModel):
    ticker: str
    action: str          # Comprar | Aumentar | Reduzir | Vender
    delta_pct: float = 0.0
    est_eur: float = 0.0
    qty: Optional[float] = None   # se fornecida, usa directamente (ignora price lookup)
    ref_price: Optional[float] = None  # preço de fecho da BD — fallback quando reqTickers não devolve nada


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

        # ── Backend guard: rejeitar se carteira IB já excede AUM × 1.05 ──────
        # Previne duplicação de ordens quando o frontend não verificou posições
        if aum_eur > 0:
            _only_buys = all(o.action in ("Comprar", "Aumentar") for o in orders)
            if _only_buys:
                _pf_val = sum(abs(float(item.marketValue or 0)) for item in ib.portfolio()
                              if (getattr(item.contract, "secType", "") or "").upper() not in ("CASH",))
                if _pf_val > aum_eur * 1.05:
                    ib.disconnect()
                    return {
                        "status": "rejected",
                        "error": (f"Carteira IB já investida ({_pf_val:,.0f} EUR) excede o AUM "
                                  f"({aum_eur:,.0f} EUR × 1.05). "
                                  "Verifica as posições no Diagnóstico e usa FLAT antes de comprar novamente."),
                        "fills": [],
                    }

        # ── Backend hard cap: total BUY est_eur ≤ AUM × 97% ─────────────────
        # Safety buffer for clients without margin accounts.
        # Covers stale DB prices, price movements between calc and execution,
        # bid-ask spreads, and whole-share rounding.
        # Applied unconditionally — even if frontend already scaled, this is the
        # last line of defence before orders hit the market.
        _BUY_SAFETY_FACTOR = float(os.environ.get("DECIDE_BUY_SAFETY_FACTOR", "0.97"))
        if aum_eur > 0:
            _buy_orders = [o for o in orders if o.action in ("Comprar", "Aumentar")]
            _total_buy_est = sum(abs(o.est_eur) for o in _buy_orders)
            _buy_budget = aum_eur * _BUY_SAFETY_FACTOR
            if _total_buy_est > _buy_budget and _total_buy_est > 0:
                _cap_scale = _buy_budget / _total_buy_est
                _safe_ib_orders_print(
                    f"[CAP] total BUY est_eur {_total_buy_est:,.0f} > budget {_buy_budget:,.0f} "
                    f"(AUM {aum_eur:,.0f} x {_BUY_SAFETY_FACTOR}) -> scale={_cap_scale:.4f}"
                )
                for o in orders:
                    if o.action in ("Comprar", "Aumentar"):
                        o.est_eur = o.est_eur * _cap_scale

        # ── Diagnose FXCONV availability (log only, doesn't block) ───────────
        _fxconv_details_ok = False
        try:
            _fxc_test = Contract(secType="CASH", symbol="EUR", currency="USD", exchange="FXCONV")
            _fxc_dets = ib.reqContractDetails(_fxc_test)
            _fxconv_details_ok = bool(_fxc_dets)
            if not _fxc_dets:
                _safe_ib_orders_print(
                    "[FX] FXCONV contract details returned empty - FX permissions may be missing in IB Gateway"
                )
            else:
                _safe_ib_orders_print(f"[FX] FXCONV available: conId={_fxc_dets[0].contract.conId}")
        except Exception as _fxc_e:
            _safe_ib_orders_print(f"[FX] FXCONV reqContractDetails error: {_fxc_e}")

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
        # Hedge anexado (IB hedgeType=F) falha frequentemente com Error 201 «Wrong symbol» em paper/EU.
        # Por defeito usamos EURUSD IDEALPRO agregado no fim (fiável). Opt-in attach:
        # DECIDE_IBKR_ORDERS_ATTACH_FX_PER_ORDER=1
        _attach_fx_each = (
            _do_fx
            and os.environ.get("DECIDE_IBKR_ORDERS_ATTACH_FX_PER_ORDER", "0").strip().lower()
            not in ("0", "false", "no")
        )

        pending: list[tuple[Any, str, str, int, _OrderIn, Optional[str], bool]] = []

        _buy_act = frozenset(("Comprar", "Aumentar"))
        _sells_first = [o for o in orders if o.action not in _buy_act]
        _buys_run = [o for o in orders if o.action in _buy_act]
        # UCITS MM EUR (XEON, …) primeiro nas compras — reduz falhas por falta de liquidez/cotação no fim do lote.
        _buys_run.sort(
            key=lambda o: 0 if _is_eur_mm_ucits_symbol((o.ticker or "").strip().upper()) else 1,
        )
        orders_exec = _sells_first + _buys_run

        for o in orders_exec:
            sym = (o.ticker or "").strip().upper()
            side = "BUY" if o.action in ("Comprar", "Aumentar") else "SELL"

            if o.qty is not None and o.qty > 0:
                qty = int(math.floor(o.qty + 1e-9)) or 1
            else:
                price = price_map.get(sym)
                # Fallback 1: ref_price sent by frontend (last close from DB via prices state)
                if not (price and price > 0):
                    price = o.ref_price if (o.ref_price and o.ref_price > 0) else None
                # Fallback 2: last close from DB CSV cache (covers tickers not in prices state)
                # Also try reverse alias: BTI→BATS, XYZ→SQ (DB stores original tickers)
                _DB_REVERSE: dict[str, str] = {"BTI": "BATS", "XYZ": "SQ"}
                if not (price and price > 0):
                    price = (_DB_LAST_PRICES.get(sym)
                             or _DB_LAST_PRICES.get(_DB_REVERSE.get(sym, ""))
                             or _DB_LAST_PRICES.get(sym.replace(".", "")))
                if price and price > 0:
                    # Floor (not round) to stay below est_eur — combined with the 97% AUM cap
                    # this guarantees the portfolio stays within budget.
                    # Previously 0.90 was used but with stale DB prices it could overshoot.
                    if _is_eur_mm_ucits_symbol(sym):
                        qty = max(1, int(abs(o.est_eur) / price))
                    else:
                        qty = max(1, int(abs(o.est_eur) * fx_eurusd / price))
                else:
                    qty = 1
                    _safe_ib_orders_print(f"[QTY] {sym}: sem preço live nem ref_price - qty=1 (fallback)")

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
            fx_note: Optional[str] = None
            if (
                _attach_fx_each
                and side == "BUY"
                and not _is_eur_mm_ucits_symbol(sym)
            ):
                ccy = (getattr(qc, "currency", None) or "").strip().upper()
                if ccy == "USD":
                    trade, err, agg_fb = _place_equity_order_with_attached_fx_hedge(ib, qc, equity_order)
                    fx_note = (
                        err.strip()
                        if err
                        else "Hedge EUR.USD anexado a esta compra (IB hedgeType=F; montante derivado pela IB)."
                    )
                else:
                    trade = ib.placeOrder(qc, equity_order)
                    fx_note = f"Compra em {ccy}: sem hedge EUR.USD anexado (apenas STK USD)."
                    agg_fb = False
            else:
                trade = ib.placeOrder(qc, equity_order)
                agg_fb = False
            pending.append((trade, sym, side, qty, o, fx_note, agg_fb))

        # ── Phase 4: Wait up to 20s for ALL fills collectively ──
        # JP ADRs (OTC Pink Sheets) have lower liquidity and need more time
        _eq_wait = float(os.environ.get("DECIDE_IBKR_ORDERS_EQUITY_WAIT_SEC", "40"))
        deadline = time.monotonic() + max(20.0, _eq_wait)
        while time.monotonic() < deadline:
            all_equity_done = all(
                str(t.orderStatus.status or "").strip() in
                ("Filled", "Cancelled", "ApiCancelled", "Inactive")
                or float(t.orderStatus.filled or 0) >= qty - 1e-6
                for t, _, _, qty, _, _, _ in pending
            )
            if all_equity_done:
                break
            ib.sleep(0.5)

        # Collect equity results
        total_buy_usd = 0.0
        supplemental_buy_usd = 0.0
        for trade, sym, side, qty, o, fx_note, agg_fb in pending:
            st = str(trade.orderStatus.status or "").strip() or "Submitted"
            ap = float(trade.orderStatus.avgFillPrice or 0.0)
            filled = float(trade.orderStatus.filled or 0.0)
            oid = int(getattr(trade.order, "orderId", 0) or 0)
            fx_attached_ok = bool(
                fx_note
                and "Hedge EUR.USD anexado" in fx_note
                and "Falha" not in fx_note
                and "não qualificado" not in fx_note.lower()
            )
            fills.append({
                "ticker": sym, "action": side,
                "requested_qty": float(qty), "filled": filled,
                "avg_fill_price": ap if ap > 0 else None,
                "status": st, "message": fx_note,
                "ib_order_id": oid or None,
                **({"fx_hedge_attached": True} if fx_attached_ok else {}),
                **({"fx_aggregate_fallback": True} if agg_fb else {}),
            })
            if side == "BUY" and not _is_eur_mm_ucits_symbol(sym):
                row_usd = (
                    (filled * ap) if filled > 0 and ap > 0 else abs(o.est_eur) * fx_eurusd
                )
                total_buy_usd += row_usd
                if agg_fb:
                    supplemental_buy_usd += row_usd

        # ── Aggregated FX hedge ──
        hedge_usd = total_buy_usd * _hedge_frac
        supplemental_hedge_usd = supplemental_buy_usd * _hedge_frac
        _fx_min_usd = float(os.environ.get("DECIDE_IBKR_ORDERS_MIN_FX_HEDGE_USD", "500"))
        if _do_fx and _attach_fx_each:
            if supplemental_buy_usd > 0:
                _safe_ib_orders_print(
                    f"[FX] complemento IDEALPRO sobre ~{supplemental_hedge_usd:.0f} USD "
                    f"(compras sem hedge EUR.USD anexado válido)."
                )
            else:
                _safe_ib_orders_print("[FX] modo hedge anexado por compra USD — sem EURUSD agregado no fim.")
            if supplemental_hedge_usd >= _fx_min_usd:
                try:
                    fx_ret = _place_eurusd_hedge(ib, supplemental_hedge_usd, min_notional_usd=_fx_min_usd)
                    fills.append({
                        "ticker": "EUR/USD",
                        "action": str(fx_ret.get("action") or "BUY"),
                        "requested_qty": float(fx_ret.get("requested_qty") or 0),
                        "filled": float(fx_ret.get("filled") or 0),
                        "avg_fill_price": fx_ret.get("avg_fill_price"),
                        "status": str(fx_ret.get("status") or "error"),
                        "message": fx_ret.get("message"),
                        "is_fx": True,
                        "ib_order_id": fx_ret.get("ib_order_id"),
                    })
                    _safe_ib_orders_print(
                        f"[FX] hedge complementar supplemental_usd={supplemental_hedge_usd:.0f} min={_fx_min_usd:.0f} "
                        f"status={fx_ret.get('status')} qty={fx_ret.get('requested_qty')}"
                    )
                except Exception as _fx_exc:
                    fills.append({
                        "ticker": "EUR/USD",
                        "action": "BUY",
                        "requested_qty": 0,
                        "filled": 0,
                        "status": "error",
                        "is_fx": True,
                        "message": f"Hedge FX falhou: {_fx_exc}",
                    })
            elif supplemental_buy_usd > 0 and 0 < supplemental_hedge_usd < _fx_min_usd:
                fills.append({
                    "ticker": "EUR/USD",
                    "action": "BUY",
                    "requested_qty": 0,
                    "filled": 0,
                    "status": "skip_fx_below_min",
                    "is_fx": True,
                    "message": (
                        f"Hedge FX complementar ignorado — exposição USD estimada {supplemental_hedge_usd:,.0f} "
                        f"< mínimo {_fx_min_usd:,.0f} USD (DECIDE_IBKR_ORDERS_MIN_FX_HEDGE_USD)."
                    ),
                })
        elif _do_fx and (not _attach_fx_each) and hedge_usd >= _fx_min_usd:
            try:
                fx_ret = _place_eurusd_hedge(ib, hedge_usd, min_notional_usd=_fx_min_usd)
                fills.append({
                    "ticker": "EUR/USD",
                    "action": str(fx_ret.get("action") or "BUY"),
                    "requested_qty": float(fx_ret.get("requested_qty") or 0),
                    "filled": float(fx_ret.get("filled") or 0),
                    "avg_fill_price": fx_ret.get("avg_fill_price"),
                    "status": str(fx_ret.get("status") or "error"),
                    "message": fx_ret.get("message"),
                    "is_fx": True,
                    "ib_order_id": fx_ret.get("ib_order_id"),
                })
                _safe_ib_orders_print(
                    f"[FX] hedge_usd={hedge_usd:.0f} min={_fx_min_usd:.0f} "
                    f"status={fx_ret.get('status')} qty={fx_ret.get('requested_qty')}"
                )
            except Exception as _fx_exc:
                fills.append({
                    "ticker": "EUR/USD",
                    "action": "BUY",
                    "requested_qty": 0,
                    "filled": 0,
                    "status": "error",
                    "is_fx": True,
                    "message": f"Hedge FX falhou: {_fx_exc}",
                })
        elif _do_fx and (not _attach_fx_each) and 0 < hedge_usd < _fx_min_usd:
            fills.append({
                "ticker": "EUR/USD",
                "action": "BUY",
                "requested_qty": 0,
                "filled": 0,
                "status": "skip_fx_below_min",
                "is_fx": True,
                "message": (
                    f"Hedge FX ignorado — exposição USD estimada {hedge_usd:,.0f} < mínimo "
                    f"{_fx_min_usd:,.0f} USD (DECIDE_IBKR_ORDERS_MIN_FX_HEDGE_USD)."
                ),
            })

    except (ConnectionRefusedError, TimeoutError, OSError) as exc:
        return {
            "status": "error",
            "error": (f"Não foi possível ligar ao IB Gateway em {host}:{port} — {type(exc).__name__}. "
                      "Confirme que está aberto, autenticado e com API socket activa."),
            "fills": fills,
        }
    except Exception as exc:  # noqa: BLE001
        try:
            _safe_ib_orders_print(traceback.format_exc())
        except Exception:
            pass
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
