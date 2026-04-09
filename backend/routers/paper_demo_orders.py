"""
POST /api/paper-demo-orders — demo controlada (conta **paper** IBKR):

1. Ordem FX **EUR.USD** (BUY EUR / vender USD) — reutiliza a lógica de `send_orders._place_eurusd_hedge`.
2. Compra **UCITS em EUR** (por defeito **CSH2** — Lyxor Smart Overnight; alternativa típica: **XEON**).

Requer `DECIDE_PAPER_DEMO_ORDERS=1`. IB Gateway ou TWS paper ligado (ver `ib_socket_env.py`).

Exemplo (curl):

  curl -s -X POST http://127.0.0.1:8090/api/paper-demo-orders \\
    -H "Content-Type: application/json" \\
    -d '{"fx_usd_notional": 1000, "mm_ticker": "CSH2", "mm_qty": 1}'
"""

from __future__ import annotations

import os
from typing import Any

from ib_insync import IB, MarketOrder, Stock

from ib_insync_thread_loop import ensure_ib_insync_loop, teardown_ib_insync_loop
from pydantic import BaseModel, Field

from ib_socket_env import ib_socket_host, ib_socket_port
from ibkr_paper_checks import ibkr_require_paper_env, is_paper_account
from routers.send_orders import (
    MIN_FX_HEDGE_USD,
    TWS_CLIENT_ID,
    _place_eurusd_hedge,
)

TWS_HOST = ib_socket_host()
TWS_PORT = ib_socket_port()


def _paper_demo_enabled() -> bool:
    return (os.environ.get("DECIDE_PAPER_DEMO_ORDERS") or "").strip() == "1"


def _qualify_eur_ucits(ib: IB, sym: str):
    """Qualifica ETF/fundo UCITS cotado em EUR (Xetra SMART, Amsterdam, etc.)."""
    sym = (sym or "").strip().upper()
    if not sym:
        return None
    for exchange in ("SMART", "IBIS", "AEB", "BVLP.ETF"):
        try:
            c = Stock(sym, exchange, "EUR")
            q = ib.qualifyContracts(c)
            if q:
                return q[0]
        except Exception:
            continue
    try:
        q = ib.qualifyContracts(Stock(sym, "SMART", "EUR"))
        return q[0] if q else None
    except Exception:
        return None


def _place_eur_ucits_buy(ib: IB, sym: str, qty: int) -> dict[str, Any]:
    sym_u = (sym or "").strip().upper()
    if qty < 1:
        return {
            "ticker": sym_u,
            "action": "BUY",
            "requested_qty": 0.0,
            "filled": 0.0,
            "avg_fill_price": None,
            "status": "skip_zero",
            "message": "mm_qty inválido",
            "executed_as": "EU_UCITS",
        }
    qc = _qualify_eur_ucits(ib, sym_u)
    if not qc:
        return {
            "ticker": sym_u,
            "action": "BUY",
            "requested_qty": float(qty),
            "filled": 0.0,
            "avg_fill_price": None,
            "status": "contract_not_qualified",
            "message": "Não foi possível qualificar o símbolo em EUR (SMART/IBIS/AEB). Confirme o ticker na TWS.",
            "executed_as": "EU_UCITS",
        }
    order = MarketOrder("BUY", int(qty))
    order.tif = "DAY"
    trade = ib.placeOrder(qc, order)
    ib.sleep(0.45)
    st = trade.orderStatus.status or ""
    ap = float(trade.orderStatus.avgFillPrice or 0.0)
    ex = getattr(qc, "exchange", None) or "?"
    return {
        "ticker": sym_u,
        "action": "BUY",
        "requested_qty": float(qty),
        "filled": float(trade.orderStatus.filled or 0.0),
        "avg_fill_price": ap if ap > 0 else None,
        "status": st,
        "message": f"UCITS EUR {sym_u} (exchange={ex})",
        "executed_as": "EU_UCITS",
    }


class PaperDemoOrdersBody(BaseModel):
    paper_mode: bool = True
    fx_usd_notional: float = Field(
        1000.0,
        ge=1.0,
        description="Montante USD usado para dimensionar EUR.USD (comprar EUR / vender USD).",
    )
    mm_ticker: str = Field(
        "CSH2",
        description="UCITS «cash» EUR (ex.: CSH2, XEON).",
    )
    mm_qty: int = Field(1, ge=1, le=10_000, description="Quantidade de unidades (típico 1 para teste).")


def paper_demo_orders_probe() -> dict[str, Any]:
    return {
        "ok": True,
        "service": "paper-demo-orders",
        "demo_enabled": _paper_demo_enabled(),
        "min_fx_usd": MIN_FX_HEDGE_USD,
        "hint": "Defina DECIDE_PAPER_DEMO_ORDERS=1 e POST com fx_usd_notional >= min_fx_usd.",
    }


def paper_demo_orders_post(body: PaperDemoOrdersBody) -> dict[str, Any]:
    if not body.paper_mode:
        return {
            "status": "rejected",
            "error": "paper_mode=false is not allowed",
            "fills": [],
        }

    if not _paper_demo_enabled():
        return {
            "status": "rejected",
            "error": "paper_demo_disabled",
            "message": "Defina DECIDE_PAPER_DEMO_ORDERS=1 no ambiente do backend para permitir este endpoint.",
            "fills": [],
        }

    if body.fx_usd_notional < MIN_FX_HEDGE_USD:
        return {
            "status": "rejected",
            "error": "fx_below_min",
            "message": f"fx_usd_notional ({body.fx_usd_notional:.0f}) < DECIDE_MIN_FX_HEDGE_USD ({MIN_FX_HEDGE_USD:.0f}). Aumente o montante ou baixe o mínimo via env.",
            "fills": [],
        }

    fills: list[dict[str, Any]] = []
    created_loop, loop = ensure_ib_insync_loop()
    ib = IB()
    try:
        ib.connect(TWS_HOST, TWS_PORT, clientId=int(os.environ.get("TWS_CLIENT_ID_PAPER_DEMO", TWS_CLIENT_ID + 3)), timeout=15)
        ib.reqMarketDataType(3)

        is_paper, accounts = is_paper_account(ib)
        if ibkr_require_paper_env() and not is_paper:
            return {
                "status": "rejected",
                "error": f"Conta ligada não é paper ({accounts}). Demo só em conta DU*.",
                "fills": [],
                "accounts": accounts,
            }

        fills.append(_place_eurusd_hedge(ib, float(body.fx_usd_notional)))
        ib.sleep(0.4)
        fills.append(_place_eur_ucits_buy(ib, body.mm_ticker.strip(), int(body.mm_qty)))
    except Exception as e:
        return {
            "status": "rejected",
            "error": str(e),
            "fills": fills,
        }
    finally:
        try:
            if ib.isConnected():
                ib.disconnect()
        except Exception:
            pass
        teardown_ib_insync_loop(created_loop, loop)

    return {
        "status": "ok",
        "fills": fills,
        "note": "Ordens na conta paper IBKR. EUR.USD em IDEALPRO; UCITS em EUR (ex.: CSH2, XEON).",
    }
