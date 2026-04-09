"""
POST /api/sync-paper-exec-lines — actualiza linhas da tabela de execução (Plano) com o estado
actual na IBKR: ordens abertas +, se necessário, execuções recentes (últimas horas).

Útil quando a ordem já executou na TWS / IB Gateway mas a página ainda mostra «Em curso»
porque o instantâneo veio de uma resposta HTTP anterior.
"""

from __future__ import annotations

import asyncio
import json
import os
from typing import Any, List

from fastapi import APIRouter
from ib_insync import IB, ExecutionFilter
from pydantic import BaseModel, Field

from ib_socket_env import ib_socket_host, ib_socket_port

router = APIRouter(tags=["sync-paper-exec-lines"])

SYNC_EXEC_BUILD_ID = "v6_exec_pos_avg_cost"

IBKR_HOST = ib_socket_host()
IBKR_PORT = ib_socket_port()
# Crítico: usar o mesmo clientId por defeito que `send_orders` — outro ID pode deixar de ver
# ordens/execuções colocadas na sessão de envio (openTrades / fills vazios ou desactualizados).
_SEND_ORDERS_CLIENT_DEFAULT = int(os.environ.get("TWS_CLIENT_ID_SEND_ORDERS", "778"))
IBKR_CLIENT_ID = int(os.environ.get("TWS_CLIENT_ID_SYNC_EXEC", str(_SEND_ORDERS_CLIENT_DEFAULT)))
IBKR_MARKET_DATA_TYPE = 3
IBKR_REQUIRE_PAPER = os.getenv("IBKR_REQUIRE_PAPER", "1").strip() != "0"


class ExecLineIn(BaseModel):
    ticker: str = ""
    action: str = "BUY"
    requested_qty: float = 0.0
    filled: float = 0.0
    avg_fill_price: float | None = None
    status: str = ""
    message: str | None = None
    ib_perm_id: int | None = None
    ib_order_id: int | None = None


class SyncPaperExecBody(BaseModel):
    paper_mode: bool = True
    fills: List[ExecLineIn] = Field(default_factory=list)


def _connect_ib() -> IB:
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        try:
            asyncio.get_event_loop()
        except RuntimeError:
            asyncio.set_event_loop(asyncio.new_event_loop())

    ib = IB()
    ib.connect(IBKR_HOST, IBKR_PORT, clientId=IBKR_CLIENT_ID, timeout=12)
    ib.reqMarketDataType(IBKR_MARKET_DATA_TYPE)
    return ib


def _is_paper_account(ib: IB) -> tuple[bool, list[str]]:
    vals = ib.accountValues()
    accts = sorted({str(v.account).strip() for v in vals if getattr(v, "account", None)})
    is_paper = any(a.upper().startswith("DU") for a in accts)
    return is_paper, accts


def _norm_sym(s: str) -> str:
    return (s or "").strip().upper().replace(".", "")


def _contract_symbol(c: Any) -> str:
    st = str(getattr(c, "secType", "") or "").upper()
    if st == "CASH":
        return str(getattr(c, "localSymbol", "") or getattr(c, "symbol", "") or "").strip().upper()
    return str(getattr(c, "symbol", "") or "").strip().upper()


def _action_to_ib_side(action: str) -> str:
    a = (action or "").strip().upper()
    if a == "BUY":
        return "BOT"
    if a == "SELL":
        return "SLD"
    return ""


def _status_cancelled_terminal(st: str) -> bool:
    sl = (st or "").lower().replace(" ", "")
    if "pendingcancel" in sl:
        return False
    return "cancelled" in sl or "canceled" in sl or "bust" in sl


def _row_in_flight(row: dict[str, Any]) -> bool:
    if _status_cancelled_terminal(str(row.get("status") or "")):
        return False
    st = str(row.get("status") or "").lower()
    if "skip_fx" in st:
        return False
    req = float(row.get("requested_qty") or 0.0)
    fill = float(row.get("filled") or 0.0)
    if req > 0 and fill + 1e-3 >= req and "filled" in st:
        return False
    if req > 0 and fill + 1e-3 >= req:
        return False
    if (
        st in ("filled",)
        and req > 0
        and fill + 1e-3 >= req
    ):
        return False
    if any(
        x in st
        for x in (
            "inactive",
            "not_qualified",
            "qualify_error",
            "place_error",
            "reject",
            "contract_not_qualified",
            "skip_zero",
        )
    ):
        return False
    if "error" in st and "presubmit" not in st:
        return False
    # Qualquer linha com quantidade em falta e não «morta» tenta cruzar com reqExecutions —
    # a condição antiga (só se status continha «submit»/«pending») deixava linhas presas
    # com textos raros da TWS / API (ex. variantes de validação) sem actualização.
    if req > 0 and fill + 1e-3 < req:
        return True
    return False


@router.post("/api/sync-paper-exec-lines")
def sync_paper_exec_lines_post(body: SyncPaperExecBody) -> dict[str, Any]:
    if not body.paper_mode:
        return {"status": "rejected", "error": "paper_mode=false not allowed", "fills": []}
    if not body.fills:
        return {"status": "ok", "fills": [], "meta": {"sync_paper_exec_lines": SYNC_EXEC_BUILD_ID}}

    lines: list[dict[str, Any]] = [f.model_dump() for f in body.fills]
    lines_before_json = json.dumps(lines, sort_keys=True, default=str)

    try:
        ib = _connect_ib()
    except Exception as e:
        return {"status": "rejected", "error": str(e), "fills": lines}

    completed_trades: list[Any] = []
    pos_by_sym: dict[str, float] = {}

    try:
        is_paper, accounts = _is_paper_account(ib)
        if IBKR_REQUIRE_PAPER and not is_paper:
            return {
                "status": "rejected",
                "error": f"Connected account is not paper ({accounts})",
                "fills": lines,
            }

        ib.reqAllOpenOrders()
        ib.sleep(1.75)
        open_trades = list(ib.openTrades())

        def find_open_trade(
            sym_u: str,
            act_u: str,
            order_id: int,
            perm_id: int,
        ):
            cands: list[Any] = []
            for t in open_trades:
                ts = _norm_sym(_contract_symbol(t.contract))
                if ts != sym_u:
                    continue
                tact = str(getattr(t.order, "action", "") or "").strip().upper()
                if tact != act_u:
                    continue
                cands.append(t)
            if not cands:
                return None
            if order_id > 0:
                for t in cands:
                    if int(getattr(t.order, "orderId", 0) or 0) == order_id:
                        return t
            if perm_id > 0:
                for t in cands:
                    if int(getattr(t.order, "permId", 0) or 0) == perm_id:
                        return t
            return cands[0]

        for row in lines:
            sym_u = _norm_sym(str(row.get("ticker") or ""))
            act_u = str(row.get("action") or "BUY").strip().upper()
            if not sym_u:
                continue
            oid = int(row.get("ib_order_id") or 0)
            pex = int(row.get("ib_perm_id") or 0)
            t = find_open_trade(sym_u, act_u, oid, pex)
            if t is not None:
                row["status"] = str(t.orderStatus.status or "")
                row["filled"] = float(t.orderStatus.filled or 0.0)
                ap = float(t.orderStatus.avgFillPrice or 0.0)
                row["avg_fill_price"] = ap if ap > 0 else row.get("avg_fill_price")
                pid = int(getattr(t.order, "permId", 0) or 0)
                if pid:
                    row["ib_perm_id"] = pid
                oidi = int(getattr(t.order, "orderId", 0) or 0)
                if oidi:
                    row["ib_order_id"] = oidi

        def find_completed_trade(
            sym_u: str,
            act_u: str,
            order_id: int,
            perm_id: int,
            req_qty: float,
            trades: list[Any],
        ):
            cands: list[Any] = []
            for tr in trades:
                ts = _norm_sym(_contract_symbol(tr.contract))
                if ts != sym_u:
                    continue
                tact = str(getattr(tr.order, "action", "") or "").strip().upper()
                if tact != act_u:
                    continue
                cands.append(tr)
            if not cands:
                return None
            if order_id > 0:
                for tr in cands:
                    if int(getattr(tr.order, "orderId", 0) or 0) == order_id:
                        return tr
                return None
            if perm_id > 0:
                for tr in cands:
                    if int(getattr(tr.order, "permId", 0) or 0) == perm_id:
                        return tr
                return None
            if len(cands) == 1:
                return cands[0]
            if req_qty > 0:
                qty_match = [
                    tr
                    for tr in cands
                    if abs(float(getattr(tr.order, "totalQuantity", 0) or 0) - req_qty) < 0.05
                ]
                if len(qty_match) == 1:
                    return qty_match[0]
            return None

        def _merge_completed_by_perm(*lists: list[Any]) -> list[Any]:
            seen: set[int] = set()
            out: list[Any] = []
            for lst in lists:
                for tr in lst or []:
                    pid = int(getattr(tr.order, "permId", 0) or 0)
                    if pid and pid in seen:
                        continue
                    if pid:
                        seen.add(pid)
                    out.append(tr)
            return out

        def find_completed_relaxed(sym_u: str, act_u: str, req_qty: float, trades: list[Any]):
            """Quando há várias ordens no mesmo ticker (histórico), escolhe uma concluída com filled ≥ pedido."""
            if req_qty <= 0:
                return None
            cands: list[Any] = []
            for tr in trades:
                ts = _norm_sym(_contract_symbol(tr.contract))
                if ts != sym_u:
                    continue
                tact = str(getattr(tr.order, "action", "") or "").strip().upper()
                if tact != act_u:
                    continue
                cands.append(tr)
            if not cands:
                return None
            best: Any = None
            best_fl = -1.0
            for tr in cands:
                if _status_cancelled_terminal(str(tr.orderStatus.status or "")):
                    continue
                fl = float(tr.orderStatus.filled or 0.0)
                if fl + 1e-3 < req_qty * 0.998:
                    continue
                if fl > best_fl:
                    best_fl = fl
                    best = tr
            return best

        def _needs_broker_reconcile(row: dict[str, Any]) -> bool:
            st = str(row.get("status") or "").lower()
            fill = float(row.get("filled") or 0.0)
            req = float(row.get("requested_qty") or 0.0)
            if req <= 0:
                return False
            if fill + 1e-3 >= req:
                return False
            if _status_cancelled_terminal(st):
                return False
            if "pendingsubmit" in st or "presubmitted" in st or st == "apipending":
                return True
            if "submitted" in st and fill < 1e-6:
                return True
            return False

        completed_lists: list[list[Any]] = []
        try:
            completed_lists.append(ib.reqCompletedOrders(apiOnly=False))
        except Exception:
            completed_lists.append([])
        try:
            completed_lists.append(ib.reqCompletedOrders(apiOnly=True))
        except Exception:
            completed_lists.append([])
        completed_trades = _merge_completed_by_perm(*completed_lists)

        for row in lines:
            sym_u = _norm_sym(str(row.get("ticker") or ""))
            act_u = str(row.get("action") or "BUY").strip().upper()
            if not sym_u:
                continue
            oid = int(row.get("ib_order_id") or 0)
            pex = int(row.get("ib_perm_id") or 0)
            req_qty = float(row.get("requested_qty") or 0.0)
            ct = find_completed_trade(sym_u, act_u, oid, pex, req_qty, completed_trades)
            if ct is None:
                continue
            st_done = str(ct.orderStatus.status or "")
            fill_done = float(ct.orderStatus.filled or 0.0)
            ap_done = float(ct.orderStatus.avgFillPrice or 0.0)
            cur = float(row.get("filled") or 0.0)
            row["filled"] = max(cur, fill_done)
            if st_done:
                row["status"] = st_done
            if ap_done > 0:
                row["avg_fill_price"] = ap_done
            pid = int(getattr(ct.order, "permId", 0) or 0)
            if pid:
                row["ib_perm_id"] = pid
            oidi = int(getattr(ct.order, "orderId", 0) or 0)
            if oidi:
                row["ib_order_id"] = oidi
            prev = str(row.get("message") or "").strip()
            tag = " [sincronizado com ordens concluídas na IB]"
            if tag.strip() not in prev:
                row["message"] = (prev + tag).strip() if prev else tag.strip()

        for row in lines:
            sym_u = _norm_sym(str(row.get("ticker") or ""))
            act_u = str(row.get("action") or "BUY").strip().upper()
            if not sym_u:
                continue
            req_qty = float(row.get("requested_qty") or 0.0)
            fill_now = float(row.get("filled") or 0.0)
            if req_qty > 0 and fill_now + 1e-3 >= req_qty:
                continue
            ct2 = find_completed_relaxed(sym_u, act_u, req_qty, completed_trades)
            if ct2 is None:
                continue
            st_done = str(ct2.orderStatus.status or "")
            fill_done = float(ct2.orderStatus.filled or 0.0)
            ap_done = float(ct2.orderStatus.avgFillPrice or 0.0)
            row["filled"] = max(fill_now, fill_done)
            if st_done:
                row["status"] = st_done
            if ap_done > 0:
                row["avg_fill_price"] = ap_done
            pid = int(getattr(ct2.order, "permId", 0) or 0)
            if pid:
                row["ib_perm_id"] = pid
            oidi = int(getattr(ct2.order, "orderId", 0) or 0)
            if oidi:
                row["ib_order_id"] = oidi
            prev = str(row.get("message") or "").strip()
            tag = " [sincronizado com ordens concluídas na IB (correspondência flexível)]"
            if tag.strip() not in prev:
                row["message"] = (prev + tag).strip() if prev else tag.strip()

        pos_by_sym: dict[str, float] = {}
        pos_avg_cost_by_sym: dict[str, float] = {}
        try:
            for p in ib.reqPositions():
                ps = _norm_sym(str(getattr(p.contract, "symbol", "") or ""))
                if not ps:
                    continue
                pos_by_sym[ps] = float(p.position or 0.0)
                ac = float(getattr(p, "avgCost", 0.0) or 0.0)
                if ac > 0:
                    pos_avg_cost_by_sym[ps] = ac
        except Exception:
            pos_by_sym = {}
            pos_avg_cost_by_sym = {}

        for row in lines:
            sym_u = _norm_sym(str(row.get("ticker") or ""))
            act_u = str(row.get("action") or "BUY").strip().upper()
            if not sym_u or sym_u == "EURUSD":
                continue
            if act_u != "BUY":
                continue
            req_qty = float(row.get("requested_qty") or 0.0)
            if req_qty <= 0:
                continue
            if not _needs_broker_reconcile(row):
                continue
            held = float(pos_by_sym.get(sym_u, 0.0))
            if held + 1e-3 < req_qty * 0.995:
                continue
            row["filled"] = req_qty
            row["status"] = "Filled"
            ac_sym = float(pos_avg_cost_by_sym.get(sym_u, 0.0) or 0.0)
            if ac_sym > 0:
                row["avg_fill_price"] = ac_sym
            prev = str(row.get("message") or "").strip()
            tag = " [sincronizado: posição na conta ≥ quantidade pedida (confirmou na TWS)]"
            if tag.strip() not in prev:
                row["message"] = (prev + tag).strip() if prev else tag.strip()

        try:
            all_fills = list(ib.reqExecutions(ExecutionFilter()))
            ib.sleep(0.5)
        except Exception:
            all_fills = []

        for row in lines:
            if not _row_in_flight(row):
                continue
            sym_u = _norm_sym(str(row.get("ticker") or ""))
            if not sym_u or sym_u == "EURUSD":
                continue
            ib_side = _action_to_ib_side(str(row.get("action") or "BUY"))
            if not ib_side:
                continue
            perm = int(row.get("ib_perm_id") or 0)
            order_id = int(row.get("ib_order_id") or 0)
            req = float(row.get("requested_qty") or 0.0)
            total_sh = 0.0
            w = 0.0
            for fi in all_fills:
                ex = getattr(fi, "execution", None)
                if ex is None:
                    continue
                if _norm_sym(getattr(ex, "symbol", "") or "") != sym_u:
                    continue
                if ex.side != ib_side:
                    continue
                ex_oid = int(getattr(ex, "orderId", 0) or 0)
                ex_perm = int(getattr(ex, "permId", 0) or 0)
                if order_id > 0:
                    if ex_oid != order_id:
                        continue
                elif perm > 0:
                    if ex_perm != perm:
                        continue
                sh = float(ex.shares or 0.0)
                px = float(ex.price or 0.0)
                total_sh += sh
                w += sh * px
            if req > 0 and total_sh + 1e-3 >= req:
                row["filled"] = req
                row["status"] = "Filled"
                row["avg_fill_price"] = (w / total_sh) if total_sh > 0 else row.get("avg_fill_price")
                prev = str(row.get("message") or "").strip()
                tag = " [sincronizado com execuções recentes na IB]"
                if tag.strip() not in prev:
                    row["message"] = (prev + tag).strip() if prev else tag.strip()

    except Exception as e:
        return {
            "status": "rejected",
            "error": f"Erro ao sincronizar com a IBKR (sync-paper-exec-lines): {e}",
            "fills": lines,
            "meta": {"sync_paper_exec_lines": SYNC_EXEC_BUILD_ID, "exception_type": type(e).__name__},
        }
    finally:
        try:
            if ib.isConnected():
                ib.disconnect()
        except Exception:
            pass

    fills_changed = json.dumps(lines, sort_keys=True, default=str) != lines_before_json

    return {
        "status": "ok",
        "fills": lines,
        "meta": {
            "sync_paper_exec_lines": SYNC_EXEC_BUILD_ID,
            "ib_client_id": IBKR_CLIENT_ID,
            "completed_trades_merged": len(completed_trades),
            "positions_snapshot_syms": len(pos_by_sym),
            "fills_changed": fills_changed,
        },
    }


def sync_paper_exec_lines_probe() -> dict[str, Any]:
    return {
        "ok": True,
        "endpoint": "/api/sync-paper-exec-lines",
        "build": SYNC_EXEC_BUILD_ID,
        "methods": ["POST"],
    }
