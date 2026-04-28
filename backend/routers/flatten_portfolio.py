"""
Fecho de todas as posções na conta IBKR paper (ordens de mercado).
Inclui ações (STK), incl. proxy T-Bills, e posições Forex IDEALPRO (CASH), p.ex. EUR.USD —
para poder voltar a comprar o plano e submeter hedge FX limpo no mesmo envio.
Uso temporário / testes — não expor a contas reais (paper_mode obrigatório).
Ligação: IB Gateway (recomendado) ou TWS — `IB_GATEWAY_HOST` / `IB_GATEWAY_PORT` ou `TWS_HOST` / `TWS_PORT`.

Após fechar **acções** (SELL nos longos), o fecho inclui posições **Forex CASH** (ex. EUR.USD); com posição FX
**negativa** a ordem de fecho é **BUY** — na corretora pode parecer «uma série de compras» após as vendas.
Para **não** enviar fecho cambial na paper: ``DECIDE_FLATTEN_PAPER_SKIP_FX=1`` no ambiente do FastAPI.

Para **nunca** enviar ``BUY`` em acções/UCITS (só ``SELL`` em posições longas; shorts em STK/FUND ficam na conta
até fecho manual): ``DECIDE_FLATTEN_PAPER_SELL_LONGS_ONLY=1``. Útil se a IB mostrar linhas com ``position`` negativo
que não reconheces como short (ex. efeito de margem / contrato) e queres evitar «compras» de fecho em STK.

**Inconsistência corrigida:** o ``portfolio()`` da IB pode devolver **várias linhas** do mesmo título com quantidades
de sinal oposto (lotes / duplicados). O código antigo emitia **SELL** numa linha e **BUY** noutra; a posição **líquida**
podia ser long — agora agrega por instrumento antes de decidir o lado.
"""
from __future__ import annotations

import asyncio
import os
from typing import Any

from ib_insync import IB, MarketOrder
from pydantic import BaseModel

from ib_socket_env import ib_socket_host, ib_socket_port

IBKR_HOST = ib_socket_host()
IBKR_PORT = ib_socket_port()
# Antes: 95 fixo — desalinhado de `send_orders` (778) e de `cancel_open_orders_paper`, o que impedia
# inventário/cancelOrder de ver as mesmas ordens do «Zerar posições». Por defeito = envio de ordens.
_DEFAULT_SEND_ORDERS_CLIENT = int(os.environ.get("TWS_CLIENT_ID_SEND_ORDERS", "778"))
IBKR_CLIENT_ID = int(os.environ.get("TWS_CLIENT_ID_FLATTEN", str(_DEFAULT_SEND_ORDERS_CLIENT)))
IBKR_MARKET_DATA_TYPE = 3
IBKR_POLL_SECONDS = 1
# Após fechar longs (SELL), breve pausa antes de cobrir shorts (BUY) — alinha com libertação de margem na IBKR.
IBKR_FLATTEN_PHASE_GAP_SEC = float(os.getenv("IBKR_FLATTEN_PHASE_GAP_SEC", "2.5"))
IBKR_REQUIRE_PAPER = os.getenv("IBKR_REQUIRE_PAPER", "1").strip() != "0"


def _truthy_env(key: str) -> bool:
    s = (os.getenv(key) or "").strip().lower()
    return s in ("1", "true", "yes", "on")


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

        # Ações (STK/FUND): primeiro todos os SELL (fechar longos); depois BUY (cobrir shorts).
        # ``ib.portfolio()`` pode devolver **várias linhas** para o mesmo título (lotes, contas, ou duplicados da API).
        # Tratar cada linha isoladamente gera SELL numa e BUY noutra com o mesmo símbolo — a posição **líquida**
        # pode ser long. Agregamos por (conta, conId) ou (conta, símbolo, moeda, troca, tipo) antes de decidir o lado.
        work_rows: list[dict[str, Any]] = []
        # Forex (CASH / IDEALPRO): fechar depois das ações para libertar margem antes do FX.
        fx_rows: list[tuple[str, object, float, float, str]] = []

        def _equity_bucket_key(acct: str, c: Any, sym_u: str, st_u: str) -> tuple[Any, ...]:
            con_id = int(getattr(c, "conId", 0) or 0)
            ccy = str(getattr(c, "currency", "") or "").strip().upper()
            exch = str(getattr(c, "primaryExchange", "") or getattr(c, "exchange", "") or "").strip().upper()
            st_norm = st_u if st_u in ("STK", "FUND") else ("STK" if not st_u else st_u)
            if con_id > 0:
                return ("C", acct, con_id)
            return ("S", acct, sym_u, ccy, exch, st_norm)

        eq_buckets: dict[tuple[Any, ...], dict[str, Any]] = {}

        for item in ib.portfolio():
            c = item.contract
            pos = float(item.position or 0.0)
            if abs(pos) < 1e-9:
                continue
            st = str(getattr(c, "secType", "") or "").upper()

            if st == "CASH":
                if _truthy_env("DECIDE_FLATTEN_PAPER_SKIP_FX"):
                    continue
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
            # UCITS / ETF por vezes vêm como ``FUND`` em ``portfolio()`` — antes eram ignorados e não fechavam.
            if st not in ("", "STK", "FUND"):
                closes.append(
                    {
                        "ticker": sym,
                        "status": "skipped",
                        "message": f"tipo não suportado no fecho automático ({st})",
                    }
                )
                continue

            acct = str(getattr(item, "account", "") or "").strip()
            key = _equity_bucket_key(acct, c, sym, st)
            ent = eq_buckets.setdefault(
                key,
                {"net": 0.0, "best_c": c, "best_abs": -1.0, "sym": sym, "st": st or "STK", "acct": acct},
            )
            ent["net"] = float(ent["net"]) + pos
            ap = abs(pos)
            if ap > float(ent["best_abs"]):
                ent["best_abs"] = ap
                ent["best_c"] = c

        for _key, ent in sorted(eq_buckets.items(), key=lambda kv: kv[0]):
            net = float(ent["net"])
            sym = str(ent["sym"])
            c = ent["best_c"]
            st = str(ent["st"] or "STK")
            if abs(net) < 1e-9:
                continue
            qty = int(round(abs(net)))
            if qty < 1:
                continue
            side = "SELL" if net > 0 else "BUY"
            if _truthy_env("DECIDE_FLATTEN_PAPER_SELL_LONGS_ONLY") and side == "BUY":
                closes.append(
                    {
                        "ticker": sym,
                        "side": side,
                        "requested_qty": qty,
                        "status": "skipped",
                        "message": (
                            "DECIDE_FLATTEN_PAPER_SELL_LONGS_ONLY=1: não envia BUY para cobrir short em STK/FUND. "
                            "Feche manualmente na IB ou desligue esta opção se a posição negativa for intencional."
                        ),
                        "position_before": net,
                        "planned_leg": "short_cover",
                        "executed_as": "STK" if st == "STK" else "FUND",
                    }
                )
                continue
            phase = 0 if side == "SELL" else 1
            work_rows.append(
                {
                    "phase": phase,
                    "sym": sym,
                    "c": c,
                    "net": net,
                    "qty": qty,
                    "side": side,
                    "st": st,
                }
            )

        work_rows.sort(key=lambda r: (r["phase"], r["sym"]))

        for i, row in enumerate(work_rows):
            if i > 0 and work_rows[i - 1]["phase"] == 0 and row["phase"] == 1:
                ib.sleep(IBKR_FLATTEN_PHASE_GAP_SEC)

            sym = row["sym"]
            c = row["c"]
            qty = int(row["qty"])
            side = str(row["side"])
            net = float(row["net"])
            st = str(row["st"] or "STK")

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

            st_out = "STK" if st in ("", "STK") else "FUND"
            closes.append(
                {
                    "ticker": sym,
                    "side": side,
                    "requested_qty": qty,
                    "status": status,
                    "filled": filled,
                    "avg_fill_price": avg_price,
                    "message": msg,
                    "executed_as": st_out,
                    "position_before": net,
                    "planned_leg": "long_close" if side == "SELL" else "short_cover",
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
                    "position_before": _pos,
                    "planned_leg": "fx_close",
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
