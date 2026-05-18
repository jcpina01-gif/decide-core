"""
GET /api/ibkr-executions
Returns recent IB fills with commissions for audit sync purposes.
Uses ib.reqExecutions() which returns fills from the current session / last few days.
"""
from __future__ import annotations

import concurrent.futures
import math
import os
import traceback
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter
from ib_insync import IB, ExecutionFilter

from ib_socket_env import ib_socket_host, ib_socket_port
from ib_insync_thread_loop import ensure_ib_insync_loop, teardown_ib_insync_loop
from ibkr_paper_checks import is_paper_account

router = APIRouter(tags=["ibkr-executions"])

_CLIENT_ID = int(os.environ.get("TWS_CLIENT_ID_IBKR_EXEC", "795"))
_FX_EURUSD = float(os.environ.get("DECIDE_EURUSD_ESTIMATE", "1.17"))

_EUR_MM_UCITS_SUFFIXES = (".IE", ".LN", ".PA", ".AM", ".XD", "VUAA", "CSPX", "EQQQ",
                          "IWDA", "VWRA", "LCWD", "AGGH", "SPPE", "XEON", "EUNH",
                          "IUSN", "MEUD", "ZPRX", "ZPRV", "QDVE", "ISAC")

def _is_eur(symbol: str) -> bool:
    s = symbol.upper()
    return any(s.startswith(p) or s.endswith(p) for p in _EUR_MM_UCITS_SUFFIXES)


def _fetch_executions(host: str, port: int, client_id: int) -> dict[str, Any]:
    created_loop, _loop = ensure_ib_insync_loop()
    ib = IB()
    results: list[dict[str, Any]] = []

    connected = False
    for cid in [client_id] + list(range(client_id + 1, client_id + 3)):
        try:
            ib.connect(host, port, clientId=cid, timeout=5)
            connected = True
            break
        except Exception:
            continue

    if not connected:
        teardown_ib_insync_loop(created_loop, _loop)
        return {"ok": False, "error": f"Não foi possível ligar ao IB Gateway em {host}:{port}", "fills": []}

    try:
        # reqExecutions with empty filter returns all fills from current session
        ef = ExecutionFilter()
        fills = ib.reqExecutions(ef)

        for fill in fills:
            ex = fill.execution
            cr = fill.commissionReport
            contract = fill.contract

            symbol = contract.symbol if contract else ""
            is_eur = _is_eur(symbol)

            qty = ex.shares if ex else 0
            price = ex.price if ex else 0
            side = "BUY" if (ex and ex.side and "BOT" in ex.side.upper()) else "SELL"
            exec_id = ex.execId if ex else None
            exec_time = ex.time if ex else None

            value_native = qty * price if qty and price else None
            value_eur = (value_native if is_eur else (value_native / _FX_EURUSD if value_native else None))

            commission_raw = cr.commission if cr and cr.commission and math.isfinite(float(cr.commission)) else None
            commission_eur = commission_raw  # IB reports in account currency (EUR for EUR accounts)

            results.append({
                "ticker": symbol,
                "side": side,
                "qty_filled": float(qty) if qty else None,
                "price_executed": float(price) if price else None,
                "value_eur": round(value_eur, 2) if value_eur else None,
                "commission": round(float(commission_eur), 4) if commission_eur else None,
                "ibkr_exec_id": str(exec_id) if exec_id else None,
                "executed_at": exec_time.isoformat() if exec_time and hasattr(exec_time, "isoformat") else (
                    str(exec_time) if exec_time else None
                ),
                "currency": "EUR" if is_eur else "USD",
            })

        return {"ok": True, "fills": results, "count": len(results)}

    except Exception as exc:
        try:
            traceback.print_exc()
        except Exception:
            pass
        return {"ok": False, "error": f"{type(exc).__name__}: {exc}", "fills": results}
    finally:
        try:
            if ib.isConnected():
                ib.disconnect()
        except Exception:
            pass
        teardown_ib_insync_loop(created_loop, _loop)


@router.get("/api/ibkr-executions")
def ibkr_executions_get() -> dict[str, Any]:
    """Devolve execuções recentes da IB com comissões para sincronização de audit logs."""
    host = ib_socket_host()
    port = ib_socket_port()

    ex = concurrent.futures.ThreadPoolExecutor(max_workers=1)
    future = ex.submit(_fetch_executions, host, port, _CLIENT_ID)
    try:
        return future.result(timeout=30)
    except concurrent.futures.TimeoutError:
        return {"ok": False, "error": "Timeout ao ligar ao IB Gateway (30s)", "fills": []}
    except Exception as exc:
        return {"ok": False, "error": str(exc), "fills": []}
    finally:
        ex.shutdown(wait=False)
