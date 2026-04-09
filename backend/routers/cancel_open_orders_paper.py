"""
Cancelamento de ordens ainda não concluídas na conta IBKR paper (testes).

Importante: `cancelOrder(orderId)` só é fiável para ordens criadas **nesta** ligação API
(o orderId é por sessão/cliente). Ordens enviadas por outro clientId (ex. send_orders)
ou pela própria TWS podem ignorar o cancelamento individual.

Por isso, após inventariar as ordens abertas com `reqAllOpenOrders`, usamos
`reqGlobalCancel()` — cancela **todas** as ordens activas na conta, incluindo as de
outros clientes e da TWS (documentação ib_insync / IB API).
"""
from __future__ import annotations

import asyncio
import os

from ib_insync import IB
from pydantic import BaseModel

from ib_socket_env import ib_socket_host, ib_socket_port

IBKR_HOST = ib_socket_host()
IBKR_PORT = ib_socket_port()
IBKR_CLIENT_ID = int(os.environ.get("TWS_CLIENT_ID_CANCEL_OPEN_ORDERS", "96"))
IBKR_MARKET_DATA_TYPE = 3
IBKR_REQUIRE_PAPER = os.getenv("IBKR_REQUIRE_PAPER", "1").strip() != "0"

_TERMINAL = frozenset(
    {
        "Filled",
        "Cancelled",
        "ApiCancelled",
        "Inactive",
        "PendingCancel",
    }
)


class CancelOpenOrdersRequest(BaseModel):
    paper_mode: bool = True


def _connect_ib() -> IB:
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        try:
            asyncio.get_event_loop()
        except RuntimeError:
            asyncio.set_event_loop(asyncio.new_event_loop())

    ib = IB()
    ib.connect(IBKR_HOST, IBKR_PORT, clientId=IBKR_CLIENT_ID, timeout=8)
    ib.reqMarketDataType(IBKR_MARKET_DATA_TYPE)
    return ib


def _is_paper_account(ib: IB) -> tuple[bool, list[str]]:
    vals = ib.accountValues()
    accts = sorted({str(v.account).strip() for v in vals if getattr(v, "account", None)})
    is_paper = any(a.upper().startswith("DU") for a in accts)
    return is_paper, accts


def _contract_label(c) -> str:
    st = str(getattr(c, "secType", "") or "").upper()
    if st == "CASH":
        ls = str(getattr(c, "localSymbol", "") or "").strip()
        return ls or str(getattr(c, "symbol", "") or "?")
    return str(getattr(c, "symbol", "") or "?")


def run_cancel_open_orders_paper(req: CancelOpenOrdersRequest) -> dict:
    if not req.paper_mode:
        return {
            "status": "rejected",
            "error": "paper_mode=false is not allowed on this endpoint",
            "cancellations": [],
        }

    try:
        ib = _connect_ib()
    except Exception as e:
        return {
            "status": "rejected",
            "error": f"IBKR (Gateway/TWS) connection failed: {e}",
            "cancellations": [],
        }

    out: list[dict] = []

    try:
        is_paper, accounts = _is_paper_account(ib)
        if IBKR_REQUIRE_PAPER and not is_paper:
            return {
                "status": "rejected",
                "error": f"Connected account is not paper ({accounts})",
                "cancellations": [],
                "accounts": accounts,
            }

        ib.reqAllOpenOrders()
        ib.sleep(1.5)

        for trade in list(ib.openTrades()):
            st = str(trade.orderStatus.status or "").strip()
            if st in _TERMINAL:
                continue
            oid = int(getattr(trade.order, "orderId", 0) or 0)
            perm = int(getattr(trade.order, "permId", 0) or 0)
            sym = _contract_label(trade.contract)
            action = str(getattr(trade.order, "action", "") or "")
            total = float(getattr(trade.order, "totalQuantity", 0) or 0)
            filled = float(trade.orderStatus.filled or 0.0)
            oc = int(getattr(trade.order, "clientId", 0) or 0)
            out.append(
                {
                    "ticker": sym,
                    "action": action,
                    "order_id": oid or None,
                    "perm_id": perm or None,
                    "api_client_id": oc or None,
                    "status_before": st,
                    "requested_qty": total,
                    "filled_before": filled,
                }
            )

        if not out:
            return {"status": "ok", "cancellations": [], "global_cancel_sent": False}

        ib.reqGlobalCancel()
        ib.sleep(2.0)
        ib.reqAllOpenOrders()
        ib.sleep(1.0)

        still_perm = {
            int(getattr(t.order, "permId", 0) or 0)
            for t in ib.openTrades()
            if int(getattr(t.order, "permId", 0) or 0) > 0
        }
        still_by_perm: dict[int, str] = {}
        for t in ib.openTrades():
            pid = int(getattr(t.order, "permId", 0) or 0)
            if pid > 0:
                still_by_perm[pid] = str(t.orderStatus.status or "").strip()

        for row in out:
            pid = int(row.get("perm_id") or 0)
            row["result"] = "global_cancel_sent"
            if pid <= 0:
                row["status_after"] = "unknown"
                row["still_open"] = None
            elif pid in still_perm:
                st_af = str(still_by_perm.get(pid, "")).strip()
                row["status_after"] = st_af
                row["still_open"] = bool(st_af) and st_af not in _TERMINAL
            else:
                row["status_after"] = "Cancelled"
                row["still_open"] = False

    finally:
        if ib.isConnected():
            ib.disconnect()

    return {"status": "ok", "cancellations": out}


def cancel_open_orders_paper_probe() -> dict:
    return {
        "ok": True,
        "endpoint": "/api/cancel-open-orders-paper",
        "methods": ["GET", "POST"],
        "hint": 'POST com body JSON {"paper_mode": true} — inventaria ordens abertas e envia reqGlobalCancel() à IB (todas as ordens activas, qualquer clientId).',
    }
