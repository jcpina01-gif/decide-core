"""
Fecho de todas as posções na conta IBKR paper (ordens de mercado).
Inclui ações (STK), incl. proxy T-Bills, e posições Forex IDEALPRO (CASH), p.ex. EUR.USD —
para poder voltar a comprar o plano e submeter hedge FX limpo no mesmo envio.
Uso temporário / testes — não expor a contas reais (paper_mode obrigatório).
Ligação: IB Gateway (recomendado) ou TWS — `IB_GATEWAY_HOST` / `IB_GATEWAY_PORT` ou `TWS_HOST` / `TWS_PORT`.
"""
from __future__ import annotations

import asyncio
import os
from ib_insync import IB, MarketOrder
from pydantic import BaseModel

from ib_socket_env import ib_socket_host, ib_socket_port

IBKR_HOST = ib_socket_host()
IBKR_PORT = ib_socket_port()
IBKR_CLIENT_ID = 95
IBKR_MARKET_DATA_TYPE = 3
IBKR_POLL_SECONDS = 1
# Após fechar longs (SELL), breve pausa antes de cobrir shorts (BUY) — alinha com libertação de margem na IBKR.
IBKR_FLATTEN_PHASE_GAP_SEC = float(os.getenv("IBKR_FLATTEN_PHASE_GAP_SEC", "2.5"))
IBKR_REQUIRE_PAPER = os.getenv("IBKR_REQUIRE_PAPER", "1").strip() != "0"


class FlattenRequest(BaseModel):
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


def run_flatten_paper_portfolio(req: FlattenRequest) -> dict:
    """Lógica principal — também registada em `app_main` para garantir o path `/api/flatten-paper-portfolio`."""
    if not req.paper_mode:
        return {
            "status": "rejected",
            "error": "paper_mode=false is not allowed on this endpoint",
            "closes": [],
        }

    try:
        ib = _connect_ib()
    except Exception as e:
        return {
            "status": "rejected",
            "error": f"IBKR (Gateway/TWS) connection failed: {e}",
            "closes": [],
        }

    closes: list[dict] = []

    try:
        is_paper, accounts = _is_paper_account(ib)
        if IBKR_REQUIRE_PAPER and not is_paper:
            return {
                "status": "rejected",
                "error": f"Connected account is not paper ({accounts})",
                "closes": [],
                "accounts": accounts,
            }

        # Ações (STK): primeiro todos os SELL (fechar longos); depois BUY (cobrir shorts).
        work_rows: list[tuple[int, str, object, float, int, str]] = []
        # Forex (CASH / IDEALPRO): fechar depois das ações para libertar margem antes do FX.
        fx_rows: list[tuple[str, object, float, float, str]] = []

        for item in ib.portfolio():
            c = item.contract
            pos = float(item.position or 0.0)
            if abs(pos) < 1e-9:
                continue
            st = str(getattr(c, "secType", "") or "").upper()

            if st == "CASH":
                local_sym = str(getattr(c, "localSymbol", "") or "").strip()
                sym_stk = str(getattr(c, "symbol", "") or "").strip().upper()
                disp = local_sym if local_sym else sym_stk
                if not disp:
                    continue
                fq = round(abs(pos), 2)
                if fq < 0.01:
                    continue
                side_fx = "SELL" if pos > 0 else "BUY"
                fx_rows.append((disp, c, pos, fq, side_fx))
                continue

            sym = str(getattr(c, "symbol", "") or "").strip().upper()
            if not sym:
                continue
            if st and st != "STK":
                closes.append(
                    {
                        "ticker": sym,
                        "status": "skipped",
                        "message": f"tipo não suportado no fecho automático ({st})",
                    }
                )
                continue

            qty = int(round(abs(pos)))
            if qty < 1:
                continue
            side = "SELL" if pos > 0 else "BUY"
            phase = 0 if side == "SELL" else 1
            work_rows.append((phase, sym, c, pos, qty, side))

        work_rows.sort(key=lambda r: (r[0], r[1]))

        for i, (_phase, sym, c, _pos, qty, side) in enumerate(work_rows):
            if i > 0 and work_rows[i - 1][0] == 0 and work_rows[i][0] == 1:
                ib.sleep(IBKR_FLATTEN_PHASE_GAP_SEC)

            try:
                qualified = ib.qualifyContracts(c)
                qc = qualified[0] if qualified else c
                order = MarketOrder(side, qty)
                trade = ib.placeOrder(qc, order)
            except Exception as e:
                closes.append({"ticker": sym, "side": side, "requested_qty": qty, "status": "error", "message": str(e)})
                continue

            ib.sleep(IBKR_POLL_SECONDS)

            status = trade.orderStatus.status
            filled = float(trade.orderStatus.filled or 0.0)
            avg = trade.orderStatus.avgFillPrice
            avg_price = float(avg) if avg is not None and avg > 0 else None
            msg = getattr(trade.orderStatus, "whyHeld", None) or None

            closes.append(
                {
                    "ticker": sym,
                    "side": side,
                    "requested_qty": qty,
                    "status": status,
                    "filled": filled,
                    "avg_fill_price": avg_price,
                    "message": msg,
                    "executed_as": "STK",
                }
            )

        if fx_rows and work_rows:
            ib.sleep(IBKR_FLATTEN_PHASE_GAP_SEC)

        for disp, c, _pos, fq, side_fx in fx_rows:
            try:
                qualified = ib.qualifyContracts(c)
                qc = qualified[0] if qualified else c
                order = MarketOrder(side_fx, fq)
                trade = ib.placeOrder(qc, order)
            except Exception as e:
                closes.append(
                    {
                        "ticker": disp,
                        "side": side_fx,
                        "requested_qty": fq,
                        "status": "error",
                        "message": str(e),
                        "executed_as": "CASH",
                    }
                )
                continue

            ib.sleep(IBKR_POLL_SECONDS)

            status = trade.orderStatus.status
            filled = float(trade.orderStatus.filled or 0.0)
            avg = trade.orderStatus.avgFillPrice
            avg_price = float(avg) if avg is not None and avg > 0 else None
            msg = getattr(trade.orderStatus, "whyHeld", None) or None

            closes.append(
                {
                    "ticker": disp,
                    "side": side_fx,
                    "requested_qty": fq,
                    "status": status,
                    "filled": filled,
                    "avg_fill_price": avg_price,
                    "message": msg,
                    "executed_as": "IDEALPRO",
                }
            )
    finally:
        if ib.isConnected():
            ib.disconnect()

    return {"status": "ok", "closes": closes}


def flatten_paper_portfolio_probe() -> dict:
    """Diagnóstico: GET em /api/flatten-paper-portfolio — se 200, a rota existe; fecho com POST."""
    return {
        "ok": True,
        "endpoint": "/api/flatten-paper-portfolio",
        "methods": ["GET", "POST"],
        "hint": "POST com body JSON {\"paper_mode\": true} para enviar ordens de fecho na paper.",
    }
