"""
Cotações diárias via Interactive Brokers (TWS / IB Gateway) com ib_insync.

Requisitos: TWS ou Gateway com API activa (ex.: paper 127.0.0.1:7497).
Variáveis de ambiente:
  DECIDE_TWS_HOST      (defeito 127.0.0.1)
  DECIDE_TWS_PORT      (defeito 7497 paper)
  DECIDE_TWS_CLIENT_ID (defeito 71)
  DECIDE_TWS_HIST_DELAY_SEC — pausa entre pedidos históricos (defeito 0.35)
"""
from __future__ import annotations

import os
import time
from typing import Callable

import pandas as pd

try:
    from ib_insync import IB, Stock
except ImportError as e:
    raise ImportError("Instale ib-insync: pip install ib-insync") from e


def _env_int(name: str, default: int) -> int:
    raw = (os.environ.get(name) or "").strip()
    if not raw:
        return default
    try:
        return int(raw)
    except ValueError:
        return default


def _env_float(name: str, default: float) -> float:
    raw = (os.environ.get(name) or "").strip()
    if not raw:
        return default
    try:
        return float(raw)
    except ValueError:
        return default


def _tse_numeric_code(symbol: str) -> str | None:
    """Código numérico TSE a partir do cabeçalho do CSV (ex.: 8035.T, 8035-T, 8035)."""
    s = str(symbol).strip()
    base = s
    for suf in (".T", ".t", "-T", "-t"):
        if len(base) > len(suf) and base.upper().endswith(suf.upper()):
            base = base[: -len(suf)]
            break
    if base.isdigit() and 3 <= len(base) <= 5:
        return str(int(base))  # normaliza zeros à esquerda p/ qualify IB
    return None


_SYMBOL_ALIASES: dict[str, list[tuple[str, str, str, str]]] = {
    # Legacy/renamed tickers
    "SHOP.1": [("SHOP", "SMART", "USD", "NYSE")],
    "SQ": [("XYZ", "SMART", "USD", "NYSE"), ("SQ", "SMART", "USD", "")],
    "BATS": [("BTI", "SMART", "USD", "NYSE")],
    # Internal proxy
    "TBILL_PROXY": [("BIL", "SMART", "USD", "ARCA")],
    # Symbols that often require explicit primary exchange in IB
    "MMC": [("MMC", "SMART", "USD", "NYSE")],
    "DFS": [("DFS", "SMART", "USD", "NYSE")],
    "ANSS": [("ANSS", "SMART", "USD", "NASDAQ")],
    "TEF": [("TEF", "SMART", "USD", "NYSE")],
    "ORAN": [("ORAN", "SMART", "USD", "NYSE")],
    "MTU": [("MTU", "SMART", "USD", "NYSE")],
    # OTC / ADR fallbacks for symbols that fail frequently on SMART defaults
    "PCRFY": [("PCRFY", "SMART", "USD", "OTC")],
    "MSBHF": [("MUFG", "SMART", "USD", "NYSE"), ("MSBHF", "SMART", "USD", "OTC")],
    # JP listings without TSE permissions: use ADR as fallback
    "6954.T": [("FANUY", "SMART", "USD", "OTC")],
}


def _stock(symbol: str, exchange: str = "SMART", currency: str = "USD", primary_exchange: str = "") -> Stock:
    kw = {"primaryExchange": primary_exchange} if primary_exchange else {}
    return Stock(symbol, exchange, currency, **kw)


def stock_contract_candidates(symbol: str) -> list[Stock]:
    """Constrói candidatos de contrato IB para um ticker do CSV."""
    s = str(symbol).strip()
    out: list[Stock] = []

    for cand in _SYMBOL_ALIASES.get(s, []):
        out.append(_stock(*cand))

    if s == "BRK.B":
        out.append(_stock("BRK B", "SMART", "USD", "NYSE"))
    else:
        tse = _tse_numeric_code(s)
        if tse is not None:
            out.append(_stock(tse, "TSEJ", "JPY", "TSEJ"))
        out.append(_stock(s, "SMART", "USD"))

    # Dedup by key to avoid repeated qualify calls.
    seen: set[tuple[str, str, str, str]] = set()
    uniq: list[Stock] = []
    for c in out:
        key = (str(c.symbol), str(c.exchange), str(c.currency), str(c.primaryExchange))
        if key in seen:
            continue
        seen.add(key)
        uniq.append(c)
    return uniq


def connect_ib() -> IB:
    host = (os.environ.get("DECIDE_TWS_HOST") or "127.0.0.1").strip()
    port = _env_int("DECIDE_TWS_PORT", 7497)
    client_id = _env_int("DECIDE_TWS_CLIENT_ID", 71)
    ib = IB()
    ib.connect(host, port, clientId=client_id, readonly=True, timeout=25)
    return ib


def fetch_daily_bars(
    ib: IB,
    symbol: str,
    *,
    duration_str: str = "2 M",
    what_to_show: str = "ADJUSTED_LAST",
) -> pd.Series | None:
    """
    Devolve série diária index datetime (normalizado), valores = close ajustado.
    None se não houver dados ou erro.
    """
    for c_try in stock_contract_candidates(symbol):
        try:
            qualified = ib.qualifyContracts(c_try)
        except Exception:
            qualified = []
        if not qualified:
            continue
        c = qualified[0]
        bars = None
        for wts in (what_to_show, "TRADES"):
            try:
                bars = ib.reqHistoricalData(
                    c,
                    endDateTime="",
                    durationStr=duration_str,
                    barSizeSetting="1 day",
                    whatToShow=wts,
                    useRTH=True,
                    formatDate=1,
                )
                if bars:
                    break
            except Exception:
                bars = None
        if not bars:
            continue
        idx = [pd.Timestamp(b.date).normalize() for b in bars]
        vals = [float(b.close) for b in bars]
        return pd.Series(vals, index=idx, name=symbol)
    return None


def fetch_all_symbols(
    ib: IB,
    symbols: list[str],
    *,
    duration_str: str = "2 M",
    on_progress: Callable[[int, int, str], None] | None = None,
) -> tuple[pd.DataFrame, list[str]]:
    """
    Uma série histórica por símbolo; devolve DataFrame wide (index=date) e lista de falhados.
    """
    delay = _env_float("DECIDE_TWS_HIST_DELAY_SEC", 0.35)
    cols: dict[str, pd.Series] = {}
    failed: list[str] = []
    n = len(symbols)
    for i, sym in enumerate(symbols):
        if on_progress:
            on_progress(i + 1, n, sym)
        try:
            ser = fetch_daily_bars(ib, sym, duration_str=duration_str)
            if ser is not None and len(ser) > 0:
                cols[sym] = ser
            else:
                failed.append(sym)
        except Exception:
            failed.append(sym)
        if delay > 0 and i + 1 < n:
            time.sleep(delay)
    if not cols:
        return pd.DataFrame(), failed
    df = pd.DataFrame(cols)
    df = df.sort_index()
    df = df[~df.index.duplicated(keep="last")]
    return df, failed


def disconnect_safely(ib: IB | None) -> None:
    if ib is None:
        return
    try:
        if ib.isConnected():
            ib.disconnect()
    except Exception:
        pass
