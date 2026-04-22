"""
POST /api/send-orders — envia ordens de ações (SMART/USD) e, opcionalmente,
uma ordem FX EUR.USD na mesma sessão IBKR (vender USD / comprar EUR sobre o montante estimado das compras).

**Anti-short (SELL):** antes de cada venda de STK/UCITS MM, lê-se ``ib.portfolio()`` e limita-se a
quantidade ao **long disponível** (somatório das linhas longas por símbolo). Se o plano pedir mais do que
o long na IBKR, envia-se só o excedente permitido; se não houver long, a linha fica ``skip_sell_no_long``.
Isto evita descoberto involuntário quando o CSV/plano desactualiza face à conta. Desligar:
``DECIDE_DISABLE_SELL_LONG_CAP=1``.

Requer **IB Gateway** (recomendado) ou TWS em modo paper (porta por defeito 7497).
Host/porta: `IB_GATEWAY_*` ou `TWS_*` — ver `ib_socket_env.py`.
"""

from __future__ import annotations

import math
import os
import time
from typing import Any, Dict, List, Optional

from fastapi import APIRouter
from ib_insync import IB, Contract, Forex, LimitOrder, MarketOrder, Order, Stock
from pydantic import BaseModel, Field

from ib_socket_env import ib_socket_host, ib_socket_port
from ib_insync_thread_loop import ensure_ib_insync_loop, teardown_ib_insync_loop
from ibkr_paper_checks import ibkr_require_paper_env, is_paper_account

router = APIRouter(tags=["send-orders"])

# Exposto em `/api/health` para confirmar que o processo carregou este módulo (útil sem `--reload`).
SEND_ORDERS_BUILD_ID = "sell_long_cap_v1"

TWS_HOST = ib_socket_host()
TWS_PORT = ib_socket_port()
TWS_CLIENT_ID = int(os.environ.get("TWS_CLIENT_ID_SEND_ORDERS", "778"))

# Mínimo USD para tentar hedge FX (evita micro-ordens)
MIN_FX_HEDGE_USD = float(os.environ.get("DECIDE_MIN_FX_HEDGE_USD", "500"))

# ETFs de tesouraria / caixa usados como TBILL_PROXY — na paper às vezes SMART devolve ordem «Inactive»;
# ARCA (NYSE Arca) costuma ser o listing principal.
_ETF_ARCA_US = frozenset({"SHV", "BIL", "SGOV"})

# MM em EUR (UCITS) — alinhado com `EUR_MM_PROXY` / `EUR_MM_IB_TICKER` no frontend.
_EUR_MM_IB = (
    os.environ.get("EUR_MM_IB_TICKER")
    or os.environ.get("NEXT_PUBLIC_EUR_MM_IB_TICKER")
    or "CSH2"
).strip().upper() or "CSH2"

# O plano / CSV pode enviar o símbolo explícito (ex. CSH2) em vez de EUR_MM_PROXY — sempre tratar como UCITS EUR.
_KNOWN_EUR_MM_UCITS = frozenset(
    {
        _EUR_MM_IB,
        "CSH2",
        "XEON",
        "LQDE",
    }
)


def _is_eur_mm_ucits_symbol(sym: str) -> bool:
    s = (sym or "").strip().upper()
    return s == "EUR_MM_PROXY" or s in _KNOWN_EUR_MM_UCITS


# ISIN por símbolo — recurso quando Stock(sym, exchange, EUR) não qualifica na paper (ex. CSH2).
_EUR_MM_ISIN_MAP: dict[str, str] = {
    "CSH2": "IE00BF92F321",
}


def _isin_for_mm_symbol(sym: str) -> Optional[str]:
    s = (sym or "").strip().upper()
    raw = os.environ.get(f"DECIDE_EUR_MM_ISIN_{s}") or os.environ.get("DECIDE_EUR_MM_ISIN")
    if raw and raw.strip():
        return raw.strip().upper()
    return _EUR_MM_ISIN_MAP.get(s)


def _qualify_eur_ucits(ib: IB, sym: str):
    """
    ETF UCITS — tenta várias rotas: exchanges EUR, reqContractDetails, ISIN, e por fim listagem GBP (LSE).
    CSH2: por defeito tenta LSE (GBP/EUR) antes de Xetra (ver comentário no corpo). Com
    ``DECIDE_CSH2_PREFER_EUR_VENUES=1``, CSH2 segue o mesmo fluxo EUR que os outros símbolos (IBIS, …).
    """
    sym = (sym or "").strip().upper()
    if not sym:
        return None

    def _try(contract: Contract) -> Optional[Any]:
        try:
            q = ib.qualifyContracts(contract)
            return q[0] if q else None
        except Exception:
            return None

    # CSH2: por defeito LSE (GBP/EUR) antes de Xetra — na paper o MKT em ``IBIS`` (EUR) qualifica mas
    # costuma cancelar; LSE costuma executar. Para forçar listagem **EUR primeiro** (Xetra / SMART EUR):
    # ``DECIDE_CSH2_PREFER_EUR_VENUES=1`` na VM (backend/.env) + reiniciar uvicorn.
    _cs2_eur_first = os.environ.get("DECIDE_CSH2_PREFER_EUR_VENUES", "").strip().lower() in (
        "1",
        "true",
        "yes",
        "on",
    )
    if sym == "CSH2" and not _cs2_eur_first:
        for exchange in ("LSE", "LSEETF"):
            for ccy in ("GBP", "EUR"):
                qc = _try(Stock(sym, exchange, ccy))
                if qc:
                    return qc

    # 1) Venues EUR (Xetra / Euronext / LSE EUR / …)
    for exchange in ("IBIS", "AEB", "LSEETF", "LSE", "BVLP.ETF", "SWB", "ETFP", "SMART"):
        qc = _try(Stock(sym, exchange, "EUR"))
        if qc:
            return qc

    qc = _try(Stock(sym, "SMART", "EUR"))
    if qc:
        return qc

    # 2) reqContractDetails — listagens reais devolvidas pela IB (útil na paper quando o contrato «genérico» falha)
    try:
        details = ib.reqContractDetails(Stock(sym, "SMART", "EUR"))
        ib.sleep(0.35)
        for d in details or []:
            c = d.contract
            if (getattr(c, "currency", "") or "").upper() == "EUR" and (getattr(c, "secType", "") or "").upper() == "STK":
                qc = _try(c)
                if qc:
                    return qc
    except Exception:
        pass

    # 3) ISIN → SMART (EUR)
    isin = _isin_for_mm_symbol(sym)
    if isin:
        try:
            c_isin = Contract(
                secType="STK",
                exchange="SMART",
                currency="EUR",
                secIdType="ISIN",
                secId=isin,
            )
            qc = _try(c_isin)
            if qc:
                return qc
        except Exception:
            pass

    # 4) Fallback GBP (muitos UCITS UK listam só em GBP no LSE)
    for exchange in ("LSEETF", "LSE", "SMART"):
        qc = _try(Stock(sym, exchange, "GBP"))
        if qc:
            return qc

    # 5) reqMatchingSymbols — listagens que a IB reconhece (útil na paper quando tudo o resto falha)
    try:
        matches = ib.reqMatchingSymbols(sym)
        ib.sleep(0.5)
        for m in matches or []:
            c = m.contract
            if (getattr(c, "secType", "") or "").upper() != "STK":
                continue
            cur = (getattr(c, "currency", "") or "").upper()
            if cur not in ("EUR", "GBP"):
                continue
            qc = _try(c)
            if qc:
                return qc
    except Exception:
        pass

    # 6) conId explícito (TWS → Contract info) — último recurso na paper
    for env_key in (f"DECIDE_{sym}_CONID", "DECIDE_EUR_MM_CONID"):
        raw = os.environ.get(env_key)
        if not raw or not raw.strip():
            continue
        try:
            cid = int(raw.strip())
            c = Contract(conId=cid, exchange="SMART", secType="STK")
            qc = _try(c)
            if qc:
                return qc
        except Exception:
            pass

    return None


def _place_eur_mm_ucits(ib: IB, o: OrderIn) -> dict[str, Any]:
    """Compra/venda UCITS MM em EUR (ex. CSH2)."""
    sym = (o.ticker or "").strip().upper()
    if sym == "EUR_MM_PROXY":
        sym = _EUR_MM_IB
    # Plano/CSV com «CSH2» explícito: alinhar a ``EUR_MM_IB_TICKER`` (ex. XEON) quando configurado.
    if sym == "CSH2" and _EUR_MM_IB != "CSH2":
        sym = _EUR_MM_IB
    side = (o.side or "").strip().upper()
    qty = int(float(o.qty))
    if qty < 1 or side not in ("BUY", "SELL"):
        return {
            "ticker": sym,
            "action": side,
            "requested_qty": float(qty),
            "filled": 0.0,
            "avg_fill_price": None,
            "status": "skip_zero",
            "message": "invalid qty or side",
            "executed_as": "EU_UCITS_MM",
        }
    fb_note = ""
    qc = _qualify_eur_ucits(ib, sym)
    if (
        not qc
        and sym in ("CSH2", _EUR_MM_IB)
        and os.environ.get("DECIDE_TRY_XEON_IF_MM_FAILS", "1").strip().lower() not in ("0", "false", "no")
    ):
        qc = _qualify_eur_ucits(ib, "XEON")
        if qc:
            sym = "XEON"
            fb_note = " (fallback: CSH2 não qualificou na IB — mesma quantidade de unidades; alinhe EUR_MM_IB_TICKER ou DECIDE_*_CONID)"

    if not qc:
        return {
            "ticker": sym,
            "action": side,
            "requested_qty": float(qty),
            "filled": 0.0,
            "avg_fill_price": None,
            "status": "contract_not_qualified",
            "message": (
                f"Não foi possível qualificar {sym} (tentámos EUR, ISIN, GBP, matching, conId). "
                "Na paper: permissões ETF EU/UK e dados. Defina DECIDE_CSH2_CONID=<conId da TWS> ou "
                "EUR_MM_IB_TICKER=XEON."
            ),
            "executed_as": "EU_UCITS_MM",
        }

    ex = getattr(qc, "exchange", None) or "?"
    ccy = (getattr(qc, "currency", None) or "EUR").upper()

    def _ucits_fill_dict(trade: Any, msg: Optional[str] = None) -> dict[str, Any]:
        st = str(trade.orderStatus.status or "").strip()
        ap = float(trade.orderStatus.avgFillPrice or 0.0)
        filled = float(trade.orderStatus.filled or 0.0)
        sl = st.lower()
        if float(qty) > 0 and filled + 1e-6 >= float(qty):
            if "cancel" not in sl and "inactive" not in sl:
                st = "Filled"
        oid = int(getattr(trade.order, "orderId", 0) or 0)
        perm = int(getattr(trade.order, "permId", 0) or getattr(trade.orderStatus, "permId", 0) or 0)
        return {
            "ticker": sym,
            "action": side,
            "requested_qty": float(qty),
            "filled": filled,
            "avg_fill_price": ap if ap > 0 else None,
            "status": st,
            "message": (msg or f"UCITS {sym} em {ccy} (exchange={ex})") + fb_note,
            "executed_as": "EU_UCITS_MM",
            "ib_order_id": oid or None,
            "ib_perm_id": perm or None,
        }

    def _eur_aggressive_limit(side_u: str, qc_local: Any) -> Optional[float]:
        tickers = ib.reqTickers(qc_local)
        ib.sleep(1.0)
        t = tickers[0] if tickers else None
        if t is None:
            return None
        bid = float(t.bid or 0) if t.bid else 0.0
        ask = float(t.ask or 0) if t.ask else 0.0
        last = float(t.last or 0) if t.last else 0.0
        if side_u == "BUY":
            if ask > 0:
                cushion = max(0.01, round(ask * 0.0005, 4))
                return round(min(ask + cushion, ask * 1.005), 2)
            if last > 0:
                return round(last * 1.002, 2)
        if side_u == "SELL":
            if bid > 0:
                cushion = max(0.01, round(bid * 0.0005, 4))
                return round(max(bid - cushion, bid * 0.995), 2)
            if last > 0:
                return round(last * 0.998, 2)
        return None

    order = MarketOrder(side, qty)
    order.tif = "DAY"
    trade = ib.placeOrder(qc, order)
    _wait_trade_after_place(ib, trade, float(qty), max_sec=10.0)
    filled0 = float(trade.orderStatus.filled or 0.0)
    st = str(trade.orderStatus.status or "").strip()
    st_l = st.lower()
    if filled0 > 0:
        return _ucits_fill_dict(trade)
    if not st or st in ("PendingSubmit", "PreSubmitted"):
        return _ucits_fill_dict(trade)
    # Já na fila / a executar — não duplicar com segunda ordem.
    if not _status_inactive_like(st) and "cancel" not in st_l:
        return _ucits_fill_dict(trade)

    if _status_inactive_like(st) or "cancel" in st_l:
        _cancel_trade_safe(ib, trade)

    lp = _eur_aggressive_limit(side, qc)
    if lp is not None and lp > 0:
        lo = LimitOrder(side, qty, lp)
        lo.tif = "DAY"
        trade2 = ib.placeOrder(qc, lo)
        _wait_trade_after_place(ib, trade2, float(qty), max_sec=8.0)
        st2 = str(trade2.orderStatus.status or "").strip()
        if float(trade2.orderStatus.filled or 0) > 0 or not _status_inactive_like(st2):
            return _ucits_fill_dict(trade2, f"UCITS LIMIT ~{lp} {ccy} ({ex})")

    last_ucits_trade: Any = trade
    for outside_rth in (False, True):
        mo = MarketOrder(side, qty)
        mo.tif = "DAY"
        mo.outsideRth = outside_rth
        trade3 = ib.placeOrder(qc, mo)
        last_ucits_trade = trade3
        _wait_trade_after_place(ib, trade3, float(qty), max_sec=10.0)
        st3 = str(trade3.orderStatus.status or "").strip()
        if float(trade3.orderStatus.filled or 0) > 0 or not _status_inactive_like(st3):
            return _ucits_fill_dict(
                trade3,
                f"UCITS MARKET (outsideRth={outside_rth}, {ex})",
            )
        if _status_inactive_like(st3):
            _cancel_trade_safe(ib, trade3)

    return _ucits_fill_dict(
        last_ucits_trade,
        f"UCITS {sym} ({ccy}): mercado inactivo ou sem preço — horário EU/UK e permissões ETF. Última tentativa: MARKET (exchange={ex}).",
    )


def _position_map_key(ticker: str) -> str:
    """
    Chave alinhada aos tickers do plano/DECIDE para cruzar com ``ib.portfolio()``.
    Berkshire: API IB «BRK B» → mesma chave que ``BRK.B`` no CSV.
    """
    s = (ticker or "").strip().upper()
    if s == "EUR_MM_PROXY":
        s = _EUR_MM_IB
    compact = s.replace(" ", "")
    if compact in ("BRK.B", "BRK-B", "BRKB") or s == "BRK B":
        return "BRK.B"
    return compact


def _ib_portfolio_net_qty_by_key(ib: IB) -> Dict[str, float]:
    """Soma líquida por símbolo (STK/FUND); positivo = long, negativo = short."""
    out: Dict[str, float] = {}
    try:
        items = ib.portfolio()
    except Exception:
        return out
    for item in items or []:
        c = item.contract
        st = (getattr(c, "secType", "") or "").upper()
        if st not in ("STK", "FUND", ""):
            continue
        raw = str(getattr(c, "symbol", "") or "").strip().upper()
        if not raw:
            continue
        key = _position_map_key(raw)
        q = float(item.position or 0.0)
        out[key] = out.get(key, 0.0) + q
    return out


def _ib_us_equity_symbol_for_contract(sym: str) -> str:
    """
    Símbolo tal como a IB qualifica o contrato. Berkshire classe B: CSV/DECIDE usam BRK.B;
    na TWS/API o ticker é «BRK B» (espaço).
    """
    s = (sym or "").strip().upper()
    compact = s.replace(" ", "")
    if compact in ("BRK.B", "BRK-B", "BRKB") or s == "BRK B":
        return "BRK B"
    return s


def _try_qualify_usd_stock(ib: IB, sym_q: str, exchange: str) -> Optional[Any]:
    """qualifyContracts pode falhar por venue; ADRs OTC (muitos JP em USD) qualificam melhor em PINK/OTCQB."""
    try:
        q = ib.qualifyContracts(Stock(sym_q, exchange, "USD"))
        return q[0] if q else None
    except Exception:
        return None


def _qualify_us_stock_contract(ib: IB, sym: str):
    """Qualifica STK USD: para ETFs TBILL-proxy tenta SMART primeiro (paper costuma rotear melhor)."""
    sym_in = (sym or "").strip().upper()
    sym_q = _ib_us_equity_symbol_for_contract(sym_in)
    if sym_q in _ETF_ARCA_US:
        for exchange in ("SMART", "ARCA"):
            qc = _try_qualify_usd_stock(ib, sym_q, exchange)
            if qc:
                return qc
        return None
    if sym_q == "BRK B":
        for exchange in ("SMART", "NYSE"):
            qc = _try_qualify_usd_stock(ib, "BRK B", exchange)
            if qc:
                return qc
        return None
    # ADRs / OTC em USD (ex. SoftBank SFTBY): SMART por vezes não devolve contrato na paper; tentar venues OTC.
    for exchange in ("SMART", "PINK", "VALUE", "OTCQB", "OTCQX", "NASDAQ", "NYSE", "AMEX"):
        qc = _try_qualify_usd_stock(ib, sym_q, exchange)
        if qc:
            return qc
    return None


def _etf_aggressive_limit_price(ib: IB, qc: Any, side: str) -> Optional[float]:
    """Preço LIMIT junto ao NBBO. Limites demasiado longe do mercado na paper costumam ficar «Inactive»."""
    tickers = ib.reqTickers(qc)
    ib.sleep(1.25)
    t = tickers[0] if tickers else None
    if t is None:
        return None
    bid = float(t.bid or 0) if t.bid else 0.0
    ask = float(t.ask or 0) if t.ask else 0.0
    last = float(t.last or 0) if t.last else 0.0
    side_u = (side or "").strip().upper()
    if side_u == "BUY":
        if ask > 0:
            # Poucos ticks acima do ask (evita rejeição por preço fora da banda)
            cushion = max(0.02, round(ask * 0.0005, 4))
            return round(min(ask + cushion, ask * 1.01), 2)
        if last > 0:
            return round(last * 1.002, 2)
        return None
    if side_u == "SELL":
        if bid > 0:
            cushion = max(0.02, round(bid * 0.0005, 4))
            return round(max(bid - cushion, bid * 0.99), 2)
        if last > 0:
            return round(last * 0.998, 2)
        return None
    return None


def _status_inactive_like(st: str) -> bool:
    return "inactive" in (st or "").lower()


def _wait_trade_status(ib: IB, trade: Any, max_sec: float = 4.0) -> str:
    """Espera sair de Pending/PreSubmitted para o estado final não estar mascarado."""
    deadline = time.monotonic() + max_sec
    while time.monotonic() < deadline:
        st = trade.orderStatus.status or ""
        if st and st not in ("PendingSubmit", "PreSubmitted"):
            return st
        ib.sleep(0.25)
    return trade.orderStatus.status or ""


def _wait_trade_after_place(ib: IB, trade: Any, want_qty: float, max_sec: float = 22.0) -> str:
    """
    Espera execução efectiva: «Submitted» com filled=0 **não** é terminal (evita a UI ficar em «Em curso»
    quando a ordem ainda está a ser preenchida após o HTTP regressar).
    """
    deadline = time.monotonic() + max_sec
    want = float(want_qty)
    while time.monotonic() < deadline:
        st = str(trade.orderStatus.status or "").strip()
        sl = st.lower()
        filled = float(trade.orderStatus.filled or 0.0)
        if want > 0 and filled + 1e-6 >= want:
            if "cancel" not in sl and "inactive" not in sl:
                return "Filled"
        if st == "Filled":
            return st
        if st in ("Cancelled", "ApiCancelled", "Inactive"):
            return st
        if "inactive" in sl and st:
            return st
        slx = sl.replace(" ", "")
        if ("cancelled" in slx or "canceled" in slx) and "pendingcancel" not in slx:
            return st
        if st in ("PendingSubmit", "PreSubmitted"):
            ib.sleep(0.22)
            continue
        if "partial" in sl and want > 0 and filled + 1e-6 < want:
            ib.sleep(0.32)
            continue
        if st == "Submitted" or st == "":
            ib.sleep(0.32)
            continue
        ib.sleep(0.28)
    return str(trade.orderStatus.status or "").strip() or "Submitted"


def _cancel_trade_safe(ib: IB, trade: Any) -> None:
    try:
        ib.cancelOrder(trade.order)
    except Exception:
        pass
    ib.sleep(0.35)


class OrderIn(BaseModel):
    ticker: str
    side: str
    qty: float = Field(ge=0)


class SendOrdersBody(BaseModel):
    orders: List[OrderIn]
    paper_mode: bool = True
    coordinate_fx_hedge: bool = True
    """Se True (defeito), após títulos submete linha EURUSD (IDEALPRO). Defina False no JSON para desactivar."""
    fx_hedge_usd_estimate: float = 0.0
    """Montante USD a cobrir (soma típica: qty × preço das compras em USD)."""
    attach_fx_hedge_per_order: bool = False
    """
    Se True com coordinate_fx_hedge: cada compra STK USD recebe ordem FX anexa (IB hedgeType=F, qty 0 no filho),
    alinhado ao TWS «Attached FX». Nesse caso **não** se envia o hedge EURUSD agregado no fim (evita duplicar).
    """


def _place_equity_order_with_attached_fx_hedge(ib: IB, contract: Any, parent_order: Order) -> tuple[Any, Optional[str]]:
    """
    IB «Attaching Orders» + hedge cambial (hedgeType='F', quantidade 0 no filho — a IB deriva do pai).
    Ver https://interactivebrokers.github.io/tws-api/hedging.html
    """
    c_fx = _qualify_eurusd_cash(ib)
    if not c_fx:
        parent_order.transmit = True
        trade = ib.placeOrder(contract, parent_order)
        return trade, "EUR.USD não qualificado — ordem mãe sem hedge anexado"

    parent_id = ib.client.getReqId()
    parent_order.orderId = parent_id
    parent_order.transmit = False

    hedge = MarketOrder("BUY", 0.0)
    hedge.orderId = ib.client.getReqId()
    hedge.parentId = parent_id
    hedge.hedgeType = "F"
    hedge.tif = "DAY"
    hedge.transmit = True

    trade_p = ib.placeOrder(contract, parent_order)
    ib.sleep(0.08)
    try:
        ib.placeOrder(c_fx, hedge)
    except Exception as e:
        return trade_p, f"Falha ao submeter filho FX anexado: {e}"
    return trade_p, None


def _place_stock(ib: IB, o: OrderIn, attach_fx_hedge: bool = False) -> dict[str, Any]:
    sym = (o.ticker or "").strip().upper()
    side = (o.side or "").strip().upper()
    qty = float(o.qty)
    if qty <= 0 or side not in ("BUY", "SELL"):
        return {
            "ticker": sym,
            "action": side,
            "requested_qty": qty,
            "filled": 0.0,
            "avg_fill_price": None,
            "status": "skip_zero",
            "message": "invalid qty or side",
        }
    qc = _qualify_us_stock_contract(ib, sym)
    if not qc:
        return {
            "ticker": sym,
            "action": side,
            "requested_qty": qty,
            "filled": 0.0,
            "avg_fill_price": None,
            "status": "contract_not_qualified",
            "message": (
                "Contrato STK USD não qualificou (tentámos SMART, PINK, OTCQB, …). "
                "Na TWS/Gateway: pesquise o ticker, confirme listagem USD e trading US/OTC na conta paper."
            ),
        }

    def _return_fill(
        trade: Any,
        msg: Optional[str] = None,
        fx_hedge_attached: Optional[bool] = None,
    ) -> dict[str, Any]:
        st = str(trade.orderStatus.status or "").strip()
        ap = float(trade.orderStatus.avgFillPrice or 0.0)
        filled = float(trade.orderStatus.filled or 0.0)
        sl = st.lower()
        if qty > 0 and filled + 1e-6 >= float(qty):
            if "cancel" not in sl and "inactive" not in sl:
                st = "Filled"
        oid = int(getattr(trade.order, "orderId", 0) or 0)
        perm = int(getattr(trade.order, "permId", 0) or getattr(trade.orderStatus, "permId", 0) or 0)
        row: dict[str, Any] = {
            "ticker": sym,
            "action": side,
            "requested_qty": qty,
            "filled": filled,
            "avg_fill_price": ap if ap > 0 else None,
            "status": st,
            "message": msg,
            "executed_as": None,
            "ib_order_id": oid or None,
            "ib_perm_id": perm or None,
        }
        if fx_hedge_attached is not None:
            row["fx_hedge_attached"] = fx_hedge_attached
        return row

    def _place_or_parent_fx(contr: Any, ord_: Order) -> tuple[Any, Optional[bool], Optional[str]]:
        """Devolve (trade_mãe, fx_hedge_attached ou None se N/A, sufixo de mensagem)."""
        if attach_fx_hedge and side == "BUY":
            t, err = _place_equity_order_with_attached_fx_hedge(ib, contr, ord_)
            ok = err is None
            suffix = f" {err}" if err else " Hedge FX EUR.USD anexado (IB hedgeType=F, filho qty=0)."
            return t, ok, suffix
        return ib.placeOrder(contr, ord_), None, None

    # ETFs (TBILL proxy): LIMIT junto ao NBBO; depois MARKET. outsideRth=False costuma ser mais fiável na paper.
    if sym in _ETF_ARCA_US:
        lp = _etf_aggressive_limit_price(ib, qc, side)
        if lp is not None and lp > 0:
            for ort in (False, True):
                lo = LimitOrder(side, int(qty), lp)
                lo.tif = "DAY"
                lo.outsideRth = ort
                trade, fx_att, sfx = _place_or_parent_fx(qc, lo)
                _wait_trade_after_place(ib, trade, float(int(qty)), max_sec=12.0)
                st = trade.orderStatus.status or ""
                if not _status_inactive_like(st):
                    m = f"ETF: limit @{lp} USD (outsideRth={ort})."
                    if sfx:
                        m += sfx
                    return _return_fill(trade, m, fx_att)
                _cancel_trade_safe(ib, trade)

        for ort in (False, True):
            mo = MarketOrder(side, int(qty))
            mo.tif = "DAY"
            mo.outsideRth = ort
            trade, fx_att, sfx = _place_or_parent_fx(qc, mo)
            _wait_trade_after_place(ib, trade, float(int(qty)), max_sec=14.0)
            st = trade.orderStatus.status or ""
            if not _status_inactive_like(st):
                m = f"ETF: MARKET (outsideRth={ort})."
                if sfx:
                    m += sfx
                return _return_fill(trade, m, fx_att)
            _cancel_trade_safe(ib, trade)

        # Último recurso: outro exchange (SMART ↔ ARCA) — mesmo conId pode mudar o campo exchange na ordem
        primary_ex = (getattr(qc, "exchange", None) or "").upper()
        for ex_fallback in ("ARCA", "SMART"):
            if ex_fallback == primary_ex:
                continue
            alt = ib.qualifyContracts(Stock(sym, ex_fallback, "USD"))
            if not alt:
                continue
            qc_alt = alt[0]
            lp2 = _etf_aggressive_limit_price(ib, qc_alt, side)
            if lp2 is not None and lp2 > 0:
                for ort in (False, True):
                    lo = LimitOrder(side, int(qty), lp2)
                    lo.tif = "DAY"
                    lo.outsideRth = ort
                    trade, fx_att, sfx = _place_or_parent_fx(qc_alt, lo)
                    _wait_trade_after_place(ib, trade, float(int(qty)), max_sec=12.0)
                    st = trade.orderStatus.status or ""
                    if not _status_inactive_like(st):
                        m = f"ETF: limit @{lp2} USD ({ex_fallback}, outsideRth={ort})."
                        if sfx:
                            m += sfx
                        return _return_fill(trade, m, fx_att)
                    _cancel_trade_safe(ib, trade)
            for ort in (False, True):
                mo = MarketOrder(side, int(qty))
                mo.tif = "DAY"
                mo.outsideRth = ort
                trade, fx_att, sfx = _place_or_parent_fx(qc_alt, mo)
                _wait_trade_after_place(ib, trade, float(int(qty)), max_sec=14.0)
                st = trade.orderStatus.status or ""
                if not _status_inactive_like(st):
                    m = f"ETF: MARKET ({ex_fallback}, outsideRth={ort})."
                    if sfx:
                        m += sfx
                    return _return_fill(trade, m, fx_att)
                _cancel_trade_safe(ib, trade)

        return _return_fill(
            trade,
            "ETF: continua Inactive — no IB Gateway ou TWS: mensagem na linha da ordem, permissões US/ETF (paper), liquidez e horário.",
        )

    order = MarketOrder(side, int(qty))
    order.tif = "DAY"
    trade, fx_att, sfx = _place_or_parent_fx(qc, order)
    _wait_trade_after_place(ib, trade, float(int(qty)), max_sec=28.0)
    msg = (sfx.strip() if sfx else None) or None
    return _return_fill(trade, msg, fx_att)


def _eurusd_fallback_mid() -> float:
    raw = os.environ.get("DECIDE_EURUSD_MID_HINT") or os.environ.get("NEXT_PUBLIC_DECIDE_EURUSD_MID_HINT") or "1.08"
    try:
        v = float(raw)
        return v if v > 0 else 1.08
    except Exception:
        return 1.08


def _qualify_eurusd_cash(ib: IB) -> Any:
    """EUR.USD no IDEALPRO — fallback de contrato se Forex() não qualificar na paper."""
    fx = Forex("EURUSD")
    q = ib.qualifyContracts(fx)
    if q:
        c = q[0]
        if not getattr(c, "exchange", None):
            c.exchange = "IDEALPRO"
        return c
    try:
        c2 = Contract(secType="CASH", symbol="EUR", currency="USD", exchange="IDEALPRO")
        q2 = ib.qualifyContracts(c2)
        return q2[0] if q2 else None
    except Exception:
        return None


def _place_eurusd_hedge(ib: IB, usd_notional: float) -> dict[str, Any]:
    """BUY EURUSD: compra EUR, vende USD — cobre exposição long USD das compras de ações US."""
    if usd_notional < MIN_FX_HEDGE_USD:
        return {
            "ticker": "EURUSD",
            "action": "BUY",
            "requested_qty": 0.0,
            "filled": 0.0,
            "avg_fill_price": None,
            "status": "skip_fx_below_min",
            "message": f"Montante USD {usd_notional:.0f} < mínimo {MIN_FX_HEDGE_USD:.0f}",
            "executed_as": "IDEALPRO",
            "ib_order_submitted": False,
        }
    c = _qualify_eurusd_cash(ib)
    if not c:
        return {
            "ticker": "EURUSD",
            "action": "BUY",
            "requested_qty": 0.0,
            "filled": 0.0,
            "avg_fill_price": None,
            "status": "fx_contract_not_qualified",
            "message": "Não foi possível qualificar EUR.USD (IDEALPRO). Ative permissões FX na conta paper / IB Gateway.",
            "executed_as": "IDEALPRO",
            "ib_order_submitted": False,
        }
    tickers = ib.reqTickers(c)
    ib.sleep(1.5)
    t = tickers[0] if tickers else None
    bid = float(t.bid or 0) if t and t.bid else 0.0
    ask = float(t.ask or 0) if t and t.ask else 0.0
    last = float(t.last or 0) if t and t.last else 0.0
    mid = (bid + ask) / 2 if bid and ask else last
    price_source = "stream"
    if mid <= 0:
        mid = _eurusd_fallback_mid()
        price_source = f"fallback_env (~{mid:.5f})"
    # Quantidade em EUR (primeira moeda do par): USD a vender / USD por EUR
    eur_qty = round(usd_notional / mid, 2)
    if eur_qty < 1.0:
        return {
            "ticker": "EURUSD",
            "action": "BUY",
            "requested_qty": eur_qty,
            "filled": 0.0,
            "avg_fill_price": None,
            "status": "skip_fx_size",
            "message": "Quantidade EUR calculada demasiado pequena.",
            "executed_as": "IDEALPRO",
            "ib_order_submitted": False,
        }
    order = MarketOrder("BUY", eur_qty)
    order.tif = "DAY"
    trade = ib.placeOrder(c, order)
    _wait_trade_after_place(ib, trade, float(eur_qty), max_sec=12.0)
    st = str(trade.orderStatus.status or "").strip()
    filled_fx = float(trade.orderStatus.filled or 0.0)
    slx = st.lower()
    if eur_qty >= 1.0 and filled_fx + 1e-4 >= float(eur_qty):
        if "cancel" not in slx and "inactive" not in slx:
            st = "Filled"
    ap = float(trade.orderStatus.avgFillPrice or 0.0)
    oid = int(getattr(trade.order, "orderId", 0) or 0)
    perm = int(getattr(trade.order, "permId", 0) or getattr(trade.orderStatus, "permId", 0) or 0)
    id_hint = ""
    if oid:
        id_hint = f" ID ordem IB {oid}"
    if perm:
        id_hint += f" (permId {perm})" if id_hint else f" permId IB {perm}"
    return {
        "ticker": "EURUSD",
        "action": "BUY",
        "requested_qty": eur_qty,
        "filled": filled_fx,
        "avg_fill_price": ap if ap > 0 else None,
        "status": st or (trade.orderStatus.status or ""),
        "message": (
            f"Hedge FX IDEALPRO{id_hint}: ~{usd_notional:.0f} USD → ~{eur_qty} EUR @ ref {mid:.5f} ({price_source}). "
            "Na TWS: janela Ordens → filtro «Forex» ou pesquisar EUR.USD; o FX é o último do lote (depois das acções). "
            "Se não vir a ordem, confirme subscrição de dados FX ou mercado aberto."
        ),
        "executed_as": "IDEALPRO",
        "ib_order_submitted": True,
        "ib_order_id": oid or None,
        "ib_perm_id": perm or None,
    }


@router.post("/api/send-orders")
def send_orders(body: SendOrdersBody) -> dict[str, Any]:
    if not body.paper_mode:
        return {
            "status": "rejected",
            "error": "paper_mode=false is not allowed — este endpoint só envia ordens para conta IBKR paper.",
            "fills": [],
        }

    fills: List[dict[str, Any]] = []
    orders = [o for o in body.orders if o.qty and o.qty > 0]
    if not orders:
        return {"status": "rejected", "error": "no_orders", "fills": []}

    skip_fx_env = os.environ.get("DECIDE_SKIP_FX_APPEND", "").strip().lower() in ("1", "true", "yes")
    fx_est = float(body.fx_hedge_usd_estimate or 0.0)
    per_order_fx = (
        not skip_fx_env
        and body.coordinate_fx_hedge
        and bool(body.attach_fx_hedge_per_order)
    )
    sell_cap_disabled = os.environ.get("DECIDE_DISABLE_SELL_LONG_CAP", "").strip().lower() in (
        "1",
        "true",
        "yes",
    )

    # SELL antes de BUY (margem), já ordenado no cliente — mantemos ordem recebida
    created_loop, loop = ensure_ib_insync_loop()
    ib = IB()
    fx_row: Optional[dict[str, Any]] = None
    try:
        # Evitar bloqueio indefinido se TWS/Gateway não estiver a escutar (defeito ib_insync ≈ 4s).
        ib.connect(TWS_HOST, TWS_PORT, clientId=TWS_CLIENT_ID, timeout=15)
        ib.reqMarketDataType(3)

        is_paper, accounts = is_paper_account(ib)
        if ibkr_require_paper_env() and not is_paper:
            return {
                "status": "rejected",
                "error": (
                    f"Conta ligada não é paper ({accounts}). "
                    "Confirme IB Gateway/TWS em modo paper (conta DU*) e porta paper (ex. 7497 / 4002)."
                ),
                "fills": [],
                "accounts": accounts,
            }

        rem_long: Dict[str, float] = {}
        if not sell_cap_disabled:
            net_map = _ib_portfolio_net_qty_by_key(ib)
            rem_long = {k: max(0.0, v) for k, v in net_map.items()}

        for o in orders:
            sym_u = (o.ticker or "").strip().upper()
            if sym_u == "EURUSD":
                # Hedge FX: usar sempre `coordinate_fx_hedge` + `fx_hedge_usd_estimate` (evita STK inválido).
                continue

            o_exec = o
            side_u = (o.side or "").strip().upper()
            cap_key: Optional[str] = None
            cap_note = ""
            req_sell: Optional[int] = None
            if not sell_cap_disabled and side_u == "SELL":
                cap_key = _position_map_key(o.ticker)
                req_sell = int(math.floor(float(o.qty) + 1e-9))
                avail = int(math.floor(rem_long.get(cap_key, 0.0) + 1e-9))
                if avail < 1:
                    fills.append(
                        {
                            "ticker": sym_u,
                            "action": "SELL",
                            "requested_qty": float(req_sell),
                            "filled": 0.0,
                            "avg_fill_price": None,
                            "status": "skip_sell_no_long",
                            "message": (
                                "DECIDE: venda ignorada — sem posição longa na IBKR neste momento "
                                f"(long disponível 0; pedido {req_sell}). Isto impede descoberto involuntário."
                            ),
                            "executed_as": None,
                            "ib_order_id": None,
                            "ib_perm_id": None,
                            "sell_cap_key": cap_key,
                        },
                    )
                    continue
                if req_sell > avail:
                    o_exec = o.model_copy(update={"qty": float(avail)})
                    cap_note = (
                        f" Quantidade limitada ao long na IBKR (pedido {req_sell}; enviado {avail}) — anti-short."
                    )

            if _is_eur_mm_ucits_symbol(sym_u):
                fill_row = _place_eur_mm_ucits(ib, o_exec)
            else:
                fill_row = _place_stock(ib, o_exec, per_order_fx)
            if cap_note:
                prev = fill_row.get("message")
                fill_row["message"] = ((str(prev) + cap_note).strip() if prev else cap_note.strip())
                if req_sell is not None and req_sell > int(float(o_exec.qty) + 1e-9):
                    fill_row["sell_qty_requested"] = float(req_sell)
                    fill_row["sell_qty_long_cap"] = float(o_exec.qty)
            fills.append(fill_row)

            if not sell_cap_disabled and side_u == "SELL" and cap_key is not None:
                filled = float(fill_row.get("filled") or 0.0)
                rem_long[cap_key] = max(0.0, rem_long.get(cap_key, 0.0) - filled)

        # Hedge FX agregado só quando não usamos filho FX anexado por compra STK (evita duplicar).
        if not skip_fx_env and body.coordinate_fx_hedge and not body.attach_fx_hedge_per_order:
            ib.sleep(1.0)
            fx_row = _place_eurusd_hedge(ib, fx_est)
            fills.append(fx_row)
    except Exception as e:
        err = (str(e) or "").strip() or f"{type(e).__name__} (sem mensagem da excepção)"
        return {
            "status": "rejected",
            "error": err,
            "fills": fills,
        }
    finally:
        try:
            if ib.isConnected():
                ib.disconnect()
        except Exception:
            pass
        teardown_ib_insync_loop(created_loop, loop)

    fx_meta: dict[str, Any] = {}
    if fx_row is not None:
        fx_meta = {
            "fx_ib_order_submitted": bool(fx_row.get("ib_order_submitted")),
            "fx_ib_order_id": fx_row.get("ib_order_id"),
            "fx_ib_perm_id": fx_row.get("ib_perm_id"),
        }

    return {
        "status": "ok",
        "fills": fills,
        "meta": {
            "send_orders_router": SEND_ORDERS_BUILD_ID,
            "sell_long_cap_disabled": sell_cap_disabled,
            "fx_append_skipped_by_env": skip_fx_env,
            "coordinate_fx_hedge": body.coordinate_fx_hedge,
            "attach_fx_hedge_per_order": bool(body.attach_fx_hedge_per_order),
            "fx_aggregate_after_equities": not skip_fx_env
            and body.coordinate_fx_hedge
            and not body.attach_fx_hedge_per_order,
            "min_fx_hedge_usd": MIN_FX_HEDGE_USD,
            "fx_hedge_usd_estimate": fx_est,
            "fx_hedge_after_equities": not skip_fx_env and body.coordinate_fx_hedge,
            **fx_meta,
        },
    }
