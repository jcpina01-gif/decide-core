from __future__ import annotations

import asyncio
import os
from typing import Any

from fastapi import APIRouter
from ib_insync import IB, ContractDetails, Stock
from pydantic import BaseModel

from ib_socket_env import ib_socket_host, ib_socket_port
from ibkr_paper_checks import ibkr_require_paper_env, is_paper_account

router = APIRouter(tags=["ibkr-snapshot"])

IBKR_HOST = ib_socket_host()
IBKR_PORT = ib_socket_port()
# Distinct from send-orders clientId to reduce clashes if both run close together.
IBKR_CLIENT_ID = 96
IBKR_MARKET_DATA_TYPE = 3
# Nome / sector / zona via reqContractDetails (pacing ~0.2s por linha).
IBKR_SNAPSHOT_ENRICH_METADATA = os.getenv("IBKR_SNAPSHOT_ENRICH_METADATA", "1").strip() != "0"
IBKR_SNAPSHOT_META_SLEEP_S = float(os.getenv("IBKR_SNAPSHOT_META_SLEEP_S", "0.08"))

_EXCHANGE_ZONE_COUNTRY: dict[str, tuple[str, str | None]] = {
    "NYSE": ("América do Norte", "EUA"),
    "NASDAQ": ("América do Norte", "EUA"),
    "NASDAQCM": ("América do Norte", "EUA"),
    "NASDAQGM": ("América do Norte", "EUA"),
    "NASDAQGS": ("América do Norte", "EUA"),
    "ARCA": ("América do Norte", "EUA"),
    "NYSE ARCA": ("América do Norte", "EUA"),
    "AMEX": ("América do Norte", "EUA"),
    "BATS": ("América do Norte", "EUA"),
    "PINK": ("América do Norte", "EUA"),
    "IBIS": ("Europa", "Alemanha"),
    "XETRA": ("Europa", "Alemanha"),
    "FWB": ("Europa", "Alemanha"),
    "SWB": ("Europa", "Alemanha"),
    "GETTEX": ("Europa", "Alemanha"),
    "AEB": ("Europa", "Países Baixos"),
    "BVLP": ("Europa", "Portugal"),
    "BVLP.ETF": ("Europa", "Portugal"),
    "LSE": ("Europa", "Reino Unido"),
    "LSEETF": ("Europa", "Reino Unido"),
    "SIX": ("Europa", "Suíça"),
    "SWX": ("Europa", "Suíça"),
    "EBS": ("Europa", "Suíça"),
    "EPA": ("Europa", "França"),
    "MIL": ("Europa", "Itália"),
    "BVME": ("Europa", "Itália"),
    "MEXI": ("América do Norte", "México"),
    "TSEJ": ("Ásia", "Japão"),
    "SEHK": ("Ásia", "Hong Kong"),
}

# Prefixo ISO do ISIN (2 letras) → (zona, país) em PT. Só usado quando ≠ inferência bolsista USD genérica.
_ISIN_PREFIX_TO_ZONE_COUNTRY: dict[str, tuple[str, str]] = {
    "US": ("América do Norte", "EUA"),
    "CA": ("América do Norte", "Canadá"),
    "MX": ("América do Norte", "México"),
    "BR": ("América Latina", "Brasil"),
    "GB": ("Europa", "Reino Unido"),
    "NL": ("Europa", "Países Baixos"),
    "DE": ("Europa", "Alemanha"),
    "FR": ("Europa", "França"),
    "IT": ("Europa", "Itália"),
    "ES": ("Europa", "Espanha"),
    "PT": ("Europa", "Portugal"),
    "CH": ("Europa", "Suíça"),
    "SE": ("Europa", "Suécia"),
    "NO": ("Europa", "Noruega"),
    "DK": ("Europa", "Dinamarca"),
    "FI": ("Europa", "Finlândia"),
    "IE": ("Europa", "Irlanda"),
    "BE": ("Europa", "Bélgica"),
    "AT": ("Europa", "Áustria"),
    "PL": ("Europa", "Polónia"),
    "CZ": ("Europa", "República Checa"),
    "GR": ("Europa", "Grécia"),
    "LU": ("Europa", "Luxemburgo"),
    "JP": ("Ásia", "Japão"),
    "KR": ("Ásia", "Coreia do Sul"),
    "CN": ("Ásia", "China"),
    "HK": ("Ásia", "Hong Kong"),
    "SG": ("Ásia", "Singapura"),
    "TW": ("Ásia", "Taiwan"),
    "IN": ("Ásia", "Índia"),
    "AU": ("Oceania", "Austrália"),
    "NZ": ("Oceania", "Nova Zelândia"),
    "IL": ("Ásia", "Israel"),
    "ZA": ("África", "África do Sul"),
    "AE": ("Médio Oriente", "EAU"),
    "SA": ("Médio Oriente", "Arábia Saudita"),
}

# Pistas no longName da IB (ADR / registo NY / sociedade estrangeira cotada em USD). Ordenar por comprimento ↓.
_LONG_NAME_GEO_RAW: list[tuple[str, str, str]] = [
    ("TAIWAN SEMICONDUCTOR", "Ásia", "Taiwan"),
    ("TOKYO ELECTRON", "Ásia", "Japão"),
    ("ENEOS HOLDINGS", "Ásia", "Japão"),
    ("ASML HOLDING NV", "Europa", "Países Baixos"),
    ("ASML HOLDING", "Europa", "Países Baixos"),
    ("NOKIA CORP", "Europa", "Finlândia"),
    ("TECK RESOURCES", "América do Norte", "Canadá"),
    ("AGNICO EAGLE", "América do Norte", "Canadá"),
    ("BARRICK MINING", "América do Norte", "Canadá"),
    ("BARRICK GOLD", "América do Norte", "Canadá"),
    ("BARRICK", "América do Norte", "Canadá"),
    ("GOLD.COM", "América do Norte", "Canadá"),
    ("SHOPIFY INC", "América do Norte", "Canadá"),
    ("CANADIAN NATURAL", "América do Norte", "Canadá"),
    ("ENBRIDGE INC", "América do Norte", "Canadá"),
    ("SAP SE", "Europa", "Alemanha"),
    ("INFINEON TECH", "Europa", "Alemanha"),
    ("STMICROELECTRONICS", "Europa", "Suíça"),
    ("NESTLE SA", "Europa", "Suíça"),
    ("ROCHE HOLDING", "Europa", "Suíça"),
    ("NOVARTIS AG", "Europa", "Suíça"),
    ("NOVO NORDISK", "Europa", "Dinamarca"),
    ("LVMH", "Europa", "França"),
    ("TOTALENERGIES", "Europa", "França"),
    ("SHELL PLC", "Europa", "Reino Unido"),
    ("BP PLC", "Europa", "Reino Unido"),
    ("HSBC HOLDINGS", "Europa", "Reino Unido"),
    ("UNILEVER PLC", "Europa", "Reino Unido"),
    ("UNILEVER NV", "Europa", "Países Baixos"),
    ("RIO TINTO", "Europa", "Reino Unido"),
    ("BHP GROUP", "Oceania", "Austrália"),
    ("SONY GROUP", "Ásia", "Japão"),
    ("TOYOTA MOTOR", "Ásia", "Japão"),
    ("HONDA MOTOR", "Ásia", "Japão"),
    ("ALIBABA GROUP", "Ásia", "China"),
    ("JD.COM", "Ásia", "China"),
    ("BAIDU INC", "Ásia", "China"),
    ("PINDUODUO", "Ásia", "China"),
    ("PETROBRAS", "América Latina", "Brasil"),
    ("VALE SA", "América Latina", "Brasil"),
    ("SAMSUNG", "Ásia", "Coreia do Sul"),
    ("HYUNDAI MOTOR", "Ásia", "Coreia do Sul"),
]

_LONG_NAME_GEO_PATTERNS: list[tuple[str, str, str]] = sorted(
    _LONG_NAME_GEO_RAW,
    key=lambda x: len(x[0]),
    reverse=True,
)


class IbkrSnapshotRequest(BaseModel):
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


def _contract_exchange_upper(contract: Any) -> str:
    ex = (getattr(contract, "primaryExchange", "") or getattr(contract, "exchange", "") or "").strip().upper()
    return ex


def _geo_from_long_name(long_name: str) -> tuple[str | None, str | None]:
    u = (long_name or "").upper()
    if not u:
        return None, None
    for needle, zone, country in _LONG_NAME_GEO_PATTERNS:
        if needle in u:
            return zone, country
    return None, None


def _geo_from_contract_isin(contract: Any) -> tuple[str | None, str | None]:
    stype = (getattr(contract, "secIdType", None) or "").strip().upper()
    sid = (getattr(contract, "secId", None) or "").strip().upper()
    if stype != "ISIN" or len(sid) < 12:
        return None, None
    prefix = sid[:2].upper()
    if not prefix.isalpha():
        return None, None
    hit = _ISIN_PREFIX_TO_ZONE_COUNTRY.get(prefix)
    return hit if hit else (None, None)


def _geo_zone_country(
    contract: Any,
    cd: ContractDetails | None,
    row_currency: str = "",
) -> tuple[str | None, str | None]:
    """
    País / zona = sede ou domicílio económico aproximado, não o mercado onde o título cota.
    ADRs em USD na NYSE/NASDAQ deixam de ser forçados para EUA só por SMART+USD.
    """
    c = cd.contract if cd and cd.contract else contract
    long_name = (cd.longName or "").strip() if cd else ""

    zn, ct = _geo_from_long_name(long_name)
    if zn and ct:
        return zn, ct

    iz, ic = _geo_from_contract_isin(c)
    if ic:
        return iz, ic

    ex = _contract_exchange_upper(c)
    ccy = (
        (getattr(c, "currency", "") or getattr(contract, "currency", "") or row_currency or "")
        .strip()
        .upper()
    )
    if ex in _EXCHANGE_ZONE_COUNTRY:
        z, co = _EXCHANGE_ZONE_COUNTRY[ex]
        return z, co
    if ex == "SMART" and ccy == "USD":
        return "América do Norte", "EUA"
    if ex == "SMART" and ccy == "EUR":
        return "Europa", None
    if ccy == "EUR" and ex:
        return "Europa", None
    if ccy == "USD" and ex:
        return "América do Norte", None
    return None, None


def _sector_from_details(cd: ContractDetails) -> str | None:
    for attr in ("industry", "category", "subcategory"):
        s = (getattr(cd, attr, "") or "").strip()
        if s:
            return s
    return None


def _short_company_name(long_name: str, max_len: int = 56) -> str:
    """Nome curto para a tabela: remove sufixos legais comuns; limita caracteres."""
    s = (long_name or "").strip()
    if not s:
        return s
    cut = s.split(",")[0].strip()
    if len(cut) > max_len:
        return cut[: max_len - 1].rstrip() + "…"
    return cut


def _normalize_stk_symbol_for_ib_qualify(symbol: str) -> str:
    """Berkshire B: IB usa «BRK B»; relatórios podem usar BRK.B / BRK-B."""
    s = (symbol or "").strip().upper()
    compact = s.replace(" ", "")
    if compact in ("BRK.B", "BRK-B", "BRKB") or s == "BRK B":
        return "BRK B"
    return s


def _contract_for_details(ib: IB, contract: Any, row_currency: str) -> Any:
    """
    O contrato em `portfolio()` muitas vezes vem sem `conId` / troca concreta — a IB devolve
    lista vazia em `reqContractDetails`. Qualificamos um Stock SMART na moeda da posição.
    """
    st = (getattr(contract, "secType", "") or "").upper()
    if st in ("CASH", "BAG"):
        return contract
    sym = str(getattr(contract, "symbol", "") or "").strip().upper()
    if not sym:
        return contract
    sym_q = _normalize_stk_symbol_for_ib_qualify(sym)
    ccy = (row_currency or getattr(contract, "currency", None) or "USD")
    ccy = str(ccy).strip().upper() or "USD"
    con_id = int(getattr(contract, "conId", 0) or 0)
    if con_id:
        return contract
    for try_ccy in (ccy, "USD", "EUR"):
        try:
            qc = ib.qualifyContracts(Stock(sym_q, "SMART", try_ccy))
            if IBKR_SNAPSHOT_META_SLEEP_S > 0:
                ib.sleep(IBKR_SNAPSHOT_META_SLEEP_S)
            if qc:
                return qc[0]
        except Exception:
            continue
    if sym_q == "BRK B" and ccy == "USD":
        try:
            qc = ib.qualifyContracts(Stock("BRK B", "NYSE", "USD"))
            if IBKR_SNAPSHOT_META_SLEEP_S > 0:
                ib.sleep(IBKR_SNAPSHOT_META_SLEEP_S)
            if qc:
                return qc[0]
        except Exception:
            pass
    return Stock(sym_q, "SMART", ccy)


def _enrich_position_row(ib: IB, contract: Any, row: dict[str, Any]) -> bool:
    """Preenche name, sector, zone, country. Devolve True se obteve ContractDetails com longName."""
    st = (getattr(contract, "secType", "") or "").upper()
    if st in ("CASH", "BAG"):
        return False
    if st not in ("STK", "FUND", "") and st:
        return False

    row_ccy = str(row.get("currency") or "").strip().upper()
    c_req = _contract_for_details(ib, contract, row_ccy)

    cd: ContractDetails | None = None
    try:
        cds = ib.reqContractDetails(c_req)
        if IBKR_SNAPSHOT_META_SLEEP_S > 0:
            ib.sleep(IBKR_SNAPSHOT_META_SLEEP_S)
        if cds:
            cd = cds[0]
    except Exception:
        cd = None

    got_name = False
    if cd:
        ln = (cd.longName or "").strip()
        if ln:
            row["name"] = _short_company_name(ln)
            row["long_name"] = ln
            got_name = True
        sec = _sector_from_details(cd)
        if sec:
            row["sector"] = sec

    zone, country = _geo_zone_country(contract, cd, row_ccy)
    if zone:
        row["zone"] = zone
    if country:
        row["country"] = country
    return got_name


@router.post("/api/ibkr-snapshot")
def ibkr_snapshot(req: IbkrSnapshotRequest) -> dict:
    if not req.paper_mode:
        return {
            "status": "rejected",
            "error": "paper_mode=false is not allowed on this endpoint",
            "net_liquidation": 0.0,
            "net_liquidation_ccy": "",
            "account_code": "",
            "positions": [],
        }

    try:
        ib = _connect_ib()
    except Exception as e:
        loc = f"{IBKR_HOST}:{IBKR_PORT} (clientId={IBKR_CLIENT_ID})"
        detail = (str(e) or "").strip() or repr(e) or type(e).__name__
        return {
            "status": "rejected",
            "error": f"IBKR (Gateway/TWS) connection failed @ {loc}: {detail}",
            "net_liquidation": 0.0,
            "net_liquidation_ccy": "",
            "account_code": "",
            "positions": [],
        }

    try:
        is_paper, accounts = is_paper_account(ib)
        if ibkr_require_paper_env() and not is_paper:
            return {
                "status": "rejected",
                "error": f"Connected account is not paper ({accounts})",
                "net_liquidation": 0.0,
                "net_liquidation_ccy": "",
                "account_code": "",
                "positions": [],
                "accounts": accounts,
            }

        ib.sleep(0.6)

        nav = 0.0
        nav_ccy = "USD"
        acct_code = ""
        for v in ib.accountValues():
            if getattr(v, "tag", "") == "NetLiquidation":
                nav = float(v.value or 0.0)
                nav_ccy = str(getattr(v, "currency", "USD") or "USD").upper()
                acct_code = str(getattr(v, "account", "") or "").strip()
                break

        positions: list[dict] = []
        enrich_attempted = 0
        enrich_named = 0
        for item in ib.portfolio():
            c = item.contract
            sym_raw = str(getattr(c, "symbol", "") or "").strip().upper()
            if not sym_raw:
                continue
            sym_compact = sym_raw.replace(" ", "")
            display_sym = (
                "BRK.B"
                if sym_compact in ("BRK.B", "BRK-B", "BRKB") or sym_raw == "BRK B"
                else sym_raw
            )
            qty = float(item.position or 0.0)
            if abs(qty) < 1e-9:
                continue
            mpx = float(item.marketPrice or 0.0)
            mval = float(item.marketValue or 0.0)
            curr = str(getattr(c, "currency", nav_ccy) or nav_ccy).upper()
            if abs(mval) < 1e-9 and mpx != 0.0:
                mval = qty * mpx
            weight_pct = (mval / nav * 100.0) if nav else 0.0
            row: dict[str, Any] = {
                "ticker": display_sym,
                "qty": qty,
                "market_price": mpx,
                "value": mval,
                "currency": curr,
                "weight_pct": weight_pct,
            }
            if IBKR_SNAPSHOT_ENRICH_METADATA:
                try:
                    enrich_attempted += 1
                    if _enrich_position_row(ib, c, row):
                        enrich_named += 1
                except Exception:
                    pass
            positions.append(row)

        positions.sort(key=lambda r: abs(float(r.get("value") or 0.0)), reverse=True)

        cash_val = 0.0
        cash_ccy = nav_ccy
        acct_vals = ib.accountValues()
        for tag in ("TotalCashValue", "SettledCash", "CashBalance"):
            for v in acct_vals:
                if getattr(v, "tag", "") != tag:
                    continue
                try:
                    val = float(v.value or 0.0)
                    ccy = str(getattr(v, "currency", nav_ccy) or nav_ccy).upper()
                except Exception:
                    continue
                cash_val = val
                cash_ccy = ccy
                break
            if abs(cash_val) > 1e-6:
                break
        cash_weight_pct = (cash_val / nav * 100.0) if nav else 0.0

        return {
            "status": "ok",
            "net_liquidation": nav,
            "net_liquidation_ccy": nav_ccy,
            "account_code": acct_code,
            "positions": positions,
            "meta": {
                "ibkr_snapshot_enrich": bool(IBKR_SNAPSHOT_ENRICH_METADATA),
                "enrich_positions_attempted": enrich_attempted,
                "enrich_long_name_ok": enrich_named,
            },
            "cash_ledger": {
                "tag": "TotalCashValue",
                "value": cash_val,
                "currency": cash_ccy,
                "weight_pct": cash_weight_pct,
            },
        }
    finally:
        if ib.isConnected():
            ib.disconnect()
