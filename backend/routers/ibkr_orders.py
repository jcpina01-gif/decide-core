"""
POST /api/ibkr-orders — adaptador DECIDE frontend → IB Gateway.

Recebe o formato do cliente:
  {ticker, action, delta_pct, est_eur, aum, paper_mode, …}

Converte para o formato interno (ticker, side, qty) e reutiliza toda
a lógica de execução existente em send_orders.py.
"""
from __future__ import annotations

import math
import os
import time
import traceback
from typing import Any, List, Optional

from fastapi import APIRouter
from ib_insync import IB, Stock
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

# clientId separado para não colidir com o send_orders (778)
_CLIENT_ID = int(os.environ.get("TWS_CLIENT_ID_IBKR_ORDERS", "779"))


class _OrderIn(BaseModel):
    ticker: str
    action: str          # Comprar | Aumentar | Reduzir | Vender
    delta_pct: float = 0.0
    est_eur: float = 0.0


class IbkrOrdersBody(BaseModel):
    orders: List[_OrderIn]
    paper_mode: bool = True
    aum: float = 0.0
    profile: str = ""
    fx_exposure: str = "parcial"
    margin_enabled: bool = False


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


def _est_qty(ib: IB, ticker: str, est_eur: float) -> int:
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
            fx = _FX_EURUSD
            return max(1, round(est_eur * fx / price))
    # Sem preço: fallback conservador (1 acção) — melhor do que 0
    return 1


@router.post("/api/ibkr-orders")
def ibkr_orders_post(body: IbkrOrdersBody) -> dict[str, Any]:
    """Recebe ordens do frontend DECIDE e executa-as na IB via ib_insync."""

    # Filtrar acções sem valor e Manter
    orders = [
        o for o in body.orders
        if abs(o.est_eur) > 0 and o.action not in ("Manter",)
    ]
    if not orders:
        return {"status": "rejected", "error": "Sem ordens a executar.", "fills": []}

    sell_cap_disabled = os.environ.get(
        "DECIDE_DISABLE_SELL_LONG_CAP", ""
    ).strip().lower() in ("1", "true", "yes")

    created_loop, _loop = ensure_ib_insync_loop()
    ib = IB()
    fills: List[dict[str, Any]] = []

    try:
        ib.connect(TWS_HOST, TWS_PORT, clientId=_CLIENT_ID, timeout=8)
        ib.reqMarketDataType(3)  # Frozen/delayed se real-time não disponível

        is_paper, accounts = is_paper_account(ib)
        if ibkr_require_paper_env() and not is_paper:
            return {
                "status": "rejected",
                "error": (
                    f"Conta ligada não é paper ({accounts}). "
                    "Use IB Gateway/TWS em modo paper."
                ),
                "fills": [],
                "accounts": accounts,
            }

        # Posições longas actuais (para o cap anti-short)
        rem_long: dict[str, float] = {}
        if not sell_cap_disabled:
            net_map = _ib_portfolio_net_qty_by_key(ib)
            rem_long = {k: max(0.0, v) for k, v in net_map.items()}

        from routers.send_orders import OrderIn as _SOrderIn

        for o in orders:
            sym = (o.ticker or "").strip().upper()
            side = "BUY" if o.action in ("Comprar", "Aumentar") else "SELL"
            est_eur = abs(o.est_eur)

            # Calcular qty
            qty = _est_qty(ib, sym, est_eur)
            if qty <= 0:
                fills.append({
                    "ticker": sym, "action": side,
                    "requested_qty": 0, "filled": 0,
                    "status": "skip_zero", "message": "qty calculada = 0",
                })
                continue

            # Cap anti-short
            if not sell_cap_disabled and side == "SELL":
                cap_key = _position_map_key(sym)
                avail = int(math.floor(rem_long.get(cap_key, 0.0) + 1e-9))
                if avail < 1:
                    fills.append({
                        "ticker": sym, "action": "SELL",
                        "requested_qty": float(qty), "filled": 0,
                        "status": "skip_sell_no_long",
                        "message": "Sem posição longa disponível para vender.",
                    })
                    continue
                qty = min(qty, avail)
                rem_long[cap_key] = max(0.0, avail - qty)

            order_in = _SOrderIn(ticker=sym, side=side, qty=float(qty))

            if _is_eur_mm_ucits_symbol(sym):
                row = _place_eur_mm_ucits(ib, order_in)
            else:
                row = _place_stock(ib, order_in)

            fills.append(row)

    except (ConnectionRefusedError, TimeoutError, OSError) as exc:
        return {
            "status": "error",
            "error": (
                f"Não foi possível ligar ao IB Gateway em {TWS_HOST}:{TWS_PORT} — {type(exc).__name__}. "
                "Confirme que o IB Gateway está aberto, autenticado e com API socket activa (porta 4002)."
            ),
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
    submitted = sum(1 for f in fills if f.get("status") not in (
        "skip_zero", "skip_sell_no_long", "contract_not_qualified",
    ))
    return {
        "ok": True,
        "status": "submitted",
        "order_ref": order_ref,
        "submitted": submitted,
        "fills": fills,
    }


@router.get("/api/ibkr-orders")
def ibkr_orders_probe() -> dict[str, Any]:
    return {
        "ok": True,
        "endpoint": "/api/ibkr-orders",
        "ib_host": TWS_HOST,
        "ib_port": TWS_PORT,
    }
