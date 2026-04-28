"""
Cancelamento de ordens ainda não concluídas na conta IBKR paper (testes).

Importante: `cancelOrder(orderId)` só é fiável para ordens criadas **nesta** ligação API
(o orderId é por sessão/cliente). Ordens enviadas por outro clientId (ex. send_orders)
ou pela própria TWS podem ignorar o cancelamento individual.

O «Zerar posições» (flatten) usava **clientId 95** fixo até 2026-04; o cancel/sync usam **778** por defeito.
Se o inventário vier vazio na ligação principal, tentamos **TWS_CLIENT_ID_FLATTEN_LEGACY** (95) antes do
cancel global cego.

Por isso, após inventariar as ordens abertas com `reqAllOpenOrders`, usamos
`reqGlobalCancel()` — cancela **todas** as ordens activas na conta, incluindo as de
outros clientes e da TWS (documentação ib_insync / IB API).
"""
from __future__ import annotations

import asyncio
import os

from ib_insync import IB, OrderStatus, Trade
from pydantic import BaseModel

from ib_socket_env import ib_socket_host, ib_socket_port

IBKR_HOST = ib_socket_host()
IBKR_PORT = ib_socket_port()
# O mesmo default que `send_orders` (778) — ligação com outro clientId muitas vezes devolve
# `trades`/`openTrades` vazios após `reqAllOpenOrders` mesmo com ordens activas na TWS.
_DEFAULT_SEND_ORDERS_CLIENT = int(os.environ.get("TWS_CLIENT_ID_SEND_ORDERS", "778"))
IBKR_CLIENT_ID = int(
    os.environ.get("TWS_CLIENT_ID_CANCEL_OPEN_ORDERS", str(_DEFAULT_SEND_ORDERS_CLIENT))
)
# Segunda ligação só se o inventário na principal vier vazio (ordens antigas do flatten em 95).
_FLATTEN_LEGACY_CLIENT_ID = int(os.environ.get("TWS_CLIENT_ID_FLATTEN_LEGACY", "95"))
IBKR_MARKET_DATA_TYPE = 3
CANCEL_OPEN_ORDERS_BUILD_ID = "multi_client_global_v1"
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


def _ib_meta() -> dict:
    """
    O backend lê host/porta em `ib_socket_env` (TWS/IB). Por defeito a porta do repo é
    4002 (IB Gateway); a TWS paper clássica usa 7497 — muita gente liga a 4002 ver ordens
    noutro processo e os cancelos «não funcionam».
    """
    return {
        "ib_api_target": f"{IBKR_HOST}:{IBKR_PORT}",
        "ib_port_hint": "TWS paper: defina TWS_PORT=7497; IB Gateway paper: 4002. Deve bater com a aplicação onde vê as ordens (ver ib_socket_env e backend/.env).",
    }


def _connect_ib(client_id: int | None = None) -> IB:
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        try:
            asyncio.get_event_loop()
        except RuntimeError:
            asyncio.set_event_loop(asyncio.new_event_loop())

    cid = int(IBKR_CLIENT_ID if client_id is None else client_id)
    ib = IB()
    ib.connect(IBKR_HOST, IBKR_PORT, clientId=cid, timeout=8)
    ib.reqMarketDataType(IBKR_MARKET_DATA_TYPE)
    return ib


def _multi_client_global_cancel_blast() -> list[int]:
    """
    Liga-se a cada clientId relevante e envia reqGlobalCancel — cobre ordens que ficaram
    associadas a outra sessão API (ex.: flatten antigo em 95 vs cancel em 778).
    """
    tried: list[int] = []
    for cid in sorted({IBKR_CLIENT_ID, _FLATTEN_LEGACY_CLIENT_ID}):
        ibx: IB | None = None
        try:
            ibx = _connect_ib(cid)
            if IBKR_REQUIRE_PAPER and not _is_paper_account(ibx)[0]:
                continue
            ibx.reqGlobalCancel()
            ibx.sleep(1.6)
            tried.append(cid)
        except Exception:
            pass
        finally:
            if ibx is not None and ibx.isConnected():
                ibx.disconnect()
    return tried


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


def _collect_nonterminal_trades(ib: IB) -> list[Trade]:
    """
    Usa `ib.trades()` (não só `openTrades()`) e filtra com o mesmo criterio que a antiga
    iteração + evita duplicar por orderId/permId.
    """
    seen: set[tuple[int, int]] = set()
    out: list[Trade] = []
    for trade in list(ib.trades()):
        st = str(trade.orderStatus.status or "").strip()
        if st in _TERMINAL or st in OrderStatus.DoneStates:
            continue
        perm = int(getattr(trade.order, "permId", 0) or 0)
        oid = int(getattr(trade.order, "orderId", 0) or 0)
        if perm <= 0 and oid <= 0:
            continue
        k = (perm, oid)
        if k in seen:
            continue
        seen.add(k)
        out.append(trade)
    return out


def _wait_for_open_order_snapshot(ib: IB) -> None:
    ib.reqAllOpenOrders()
    ib.sleep(1.6)
    try:
        ib.waitOnUpdate(2.5)
    except Exception:
        pass
    ib.sleep(0.5)


def _try_cancel_trades_per_order(ib: IB, trades: list[Trade]) -> int:
    """
    Tenta `cancelOrder` em cada `Trade` — a IB aplica muitas vezes quando o cancel global
    não remove ordens pendentes (RTH, GTC, ligação API, etc.). Ignora excepções.
    """
    n = 0
    for trade in list(trades):
        try:
            st = str(trade.orderStatus.status or "").strip()
            if st in _TERMINAL or st in OrderStatus.DoneStates:
                continue
            oid = int(getattr(trade.order, "orderId", 0) or 0)
            if oid <= 0 and int(getattr(trade.order, "permId", 0) or 0) <= 0:
                continue
            ib.cancelOrder(trade.order)
            n += 1
        except Exception:
            pass
        ib.sleep(0.04)
    return n


def _trades_to_cancellation_rows(trades: list[Trade]) -> list[dict]:
    out: list[dict] = []
    for trade in trades:
        st = str(trade.orderStatus.status or "").strip()
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
    return out


def run_cancel_open_orders_paper(req: CancelOpenOrdersRequest) -> dict:
    if not req.paper_mode:
        return {**_ib_meta(), "status": "rejected", "error": "paper_mode=false is not allowed on this endpoint", "cancellations": []}

    try:
        ib = _connect_ib()
    except Exception as e:
        m = _ib_meta()
        return {
            **m,
            "status": "rejected",
            "error": f"IBKR (Gateway/TWS) connection failed: {e}  — alvo {m['ib_api_target']}. Se usa TWS paper: TWS_PORT=7497 no backend; Gateway paper: 4002.",
            "cancellations": [],
        }

    out: list[dict] = []
    per_n = 0

    try:
        is_paper, accounts = _is_paper_account(ib)
        if IBKR_REQUIRE_PAPER and not is_paper:
            return {
                **_ib_meta(),
                "status": "rejected",
                "error": f"Connected account is not paper ({accounts})",
                "cancellations": [],
                "accounts": accounts,
            }

        def _snapshot_inventory(ibx: IB) -> tuple[list[Trade], list[dict]]:
            _wait_for_open_order_snapshot(ibx)
            raw = _collect_nonterminal_trades(ibx)
            rows = _trades_to_cancellation_rows(raw)
            if not rows:
                _wait_for_open_order_snapshot(ibx)
                raw = _collect_nonterminal_trades(ibx)
                rows = _trades_to_cancellation_rows(raw)
            return raw, rows

        raw_trades, out = _snapshot_inventory(ib)

        if not out and _FLATTEN_LEGACY_CLIENT_ID != IBKR_CLIENT_ID:
            if ib.isConnected():
                ib.disconnect()
            try:
                ib = _connect_ib(_FLATTEN_LEGACY_CLIENT_ID)
            except Exception:
                ib = _connect_ib(IBKR_CLIENT_ID)
                raw_trades, out = _snapshot_inventory(ib)
            else:
                is_paper2, accounts2 = _is_paper_account(ib)
                if IBKR_REQUIRE_PAPER and not is_paper2:
                    return {
                        **_ib_meta(),
                        "status": "rejected",
                        "error": f"Connected account is not paper ({accounts2})",
                        "cancellations": [],
                        "accounts": accounts2,
                    }
                raw_trades, out = _snapshot_inventory(ib)

        if not out:
            # Inventário vazio: cancel global na ligação actual + blast em **cada** clientId (778/95).
            per_before = 0
            ib.reqGlobalCancel()
            ib.sleep(1.4)
            _wait_for_open_order_snapshot(ib)
            late = _collect_nonterminal_trades(ib)
            if late:
                per_before = _try_cancel_trades_per_order(ib, late)
            if ib.isConnected():
                ib.disconnect()
            tried_mc = _multi_client_global_cancel_blast()
            meta = _ib_meta()
            return {
                **meta,
                "status": "ok",
                "cancellations": [],
                "global_cancel_sent": True,
                "inventory_unavailable": True,
                "per_order_cancel_attempts": int(per_before),
                "global_cancel_client_ids": tried_mc,
                "backend_cancel_build": CANCEL_OPEN_ORDERS_BUILD_ID,
                "hint": (
                    f"Inventário vazio na API; enviámos reqGlobalCancel na sessão actual e de seguida "
                    f"em cada clientId {tried_mc} (cobre flatten antigo em 95). "
                    f"Alvo socket: {meta['ib_api_target']}. Se as ordens persistirem no IB Gateway, "
                    f"verifique API não só-leitura e permissões; reinicie o uvicorn com este build "
                    f"({CANCEL_OPEN_ORDERS_BUILD_ID})."
                ),
            }

        per_n = int(
            _try_cancel_trades_per_order(ib, raw_trades) or 0
        )
        ib.sleep(0.5)
        ib.reqGlobalCancel()
        ib.sleep(2.5)
        _wait_for_open_order_snapshot(ib)
        open_after = _collect_nonterminal_trades(ib)

        still_perm = {
            int(getattr(t.order, "permId", 0) or 0)
            for t in open_after
            if int(getattr(t.order, "permId", 0) or 0) > 0
        }
        still_by_perm: dict[int, str] = {}
        for t in open_after:
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

    return {
        **_ib_meta(),
        "status": "ok",
        "cancellations": out,
        "per_order_cancel_attempts": int(per_n),
        "global_cancel_sent": True,
        "backend_cancel_build": CANCEL_OPEN_ORDERS_BUILD_ID,
    }


def cancel_open_orders_paper_probe() -> dict:
    m = _ib_meta()
    return {
        "ok": True,
        "endpoint": "/api/cancel-open-orders-paper",
        "methods": ["GET", "POST"],
        "hint": (
            'POST com body JSON {"paper_mode": true} — inventaria ordens abertas, cancelOrder por linha, '
            "e reqGlobalCancel. "
            f"Alvo ligação API: {m.get('ib_api_target')}. {m.get('ib_port_hint')} "
            f"ClientId: default=send_orders {_DEFAULT_SEND_ORDERS_CLIENT}."
        ),
    }
