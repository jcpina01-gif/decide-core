#!/usr/bin/env python3
"""
Acrescenta linhas a `backend/data/prices_close.csv` com fechos diários (Yahoo via yfinance),
a partir do dia seguinte ao último `date` no CSV até hoje (dias úteis devolvidos pelo Yahoo).

Uso (a partir de `backend/`):
  python scripts/update_prices_close_yfinance.py

Requer: `yfinance` (ver `backend/requirements.txt`).
"""
from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

import numpy as np
import pandas as pd

BACKEND_DIR = Path(__file__).resolve().parent.parent
CSV_PATH = BACKEND_DIR / "data" / "prices_close.csv"
CHUNK = 35
SLEEP_SEC = 1.25


def _yahoo_symbol(col: str) -> str | None:
    c = str(col).strip()
    if not c or c.lower() == "date":
        return None
    return c.replace(".", "-")


def _read_close_matrix(path: Path) -> pd.DataFrame:
    df = pd.read_csv(path)
    if df.empty or "date" not in df.columns:
        raise SystemExit("CSV sem coluna date ou vazio.")
    df["date"] = pd.to_datetime(df["date"], errors="coerce")
    df = df.dropna(subset=["date"]).set_index("date").sort_index()
    for c in df.columns:
        df[c] = pd.to_numeric(df[c], errors="coerce")
    return df


def _download_chunk(symbols: list[str], start: str) -> pd.DataFrame:
    """Devolve DataFrame index=data, colunas = símbolos Yahoo (hífen)."""
    if not symbols:
        return pd.DataFrame()
    import yfinance as yf  # noqa: PLC0415

    raw = yf.download(
        symbols,
        start=start,
        auto_adjust=True,
        progress=False,
        threads=True,
        group_by="column",
    )
    if raw is None or raw.empty:
        return pd.DataFrame()
    if isinstance(raw.columns, pd.MultiIndex):
        if "Close" in raw.columns.get_level_values(0):
            out = raw["Close"].copy()
        else:
            return pd.DataFrame()
    else:
        if "Close" in raw.columns and len(symbols) == 1:
            out = pd.DataFrame({symbols[0]: raw["Close"]})
        else:
            return pd.DataFrame()
    out.index = pd.to_datetime(out.index).tz_localize(None).normalize()
    out = out.sort_index()
    return out


def _yahoo_to_csv_col(y: str, csv_cols: list[str]) -> str | None:
    cand_dot = y.replace("-", ".")
    if cand_dot in csv_cols:
        return cand_dot
    if y in csv_cols:
        return y
    return None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "--dry-run",
        action="store_true",
        help="Só mostra o intervalo a descarregar, sem gravar.",
    )
    args = ap.parse_args()

    if not CSV_PATH.is_file():
        print("Falta:", CSV_PATH, file=sys.stderr)
        return 1

    base = _read_close_matrix(CSV_PATH)
    last = pd.Timestamp(base.index.max()).normalize()
    today = pd.Timestamp.today().normalize()
    if last >= today:
        print("prices_close já tem última data >= hoje:", last.date())
        return 0

    start = (last + pd.Timedelta(days=1)).strftime("%Y-%m-%d")
    csv_cols = list(base.columns)
    yahoo_map: dict[str, str] = {}
    for c in csv_cols:
        y = _yahoo_symbol(c)
        if y:
            yahoo_map[c] = y

    unique_yahoo = sorted(set(yahoo_map.values()))
    print("Última data no CSV:", last.date(), "| descarga desde:", start, "| tickers:", len(unique_yahoo))

    if args.dry_run:
        print("dry-run: sem pedidos à rede nem escrita.")
        return 0

    pieces: list[pd.DataFrame] = []
    for i in range(0, len(unique_yahoo), CHUNK):
        syms = unique_yahoo[i : i + CHUNK]
        try:
            block = _download_chunk(syms, start)
            if not block.empty:
                pieces.append(block)
        except Exception as exc:  # noqa: BLE001
            print("Aviso: chunk falhou:", syms[:3], "…", exc, file=sys.stderr)
        time.sleep(SLEEP_SEC)

    if not pieces:
        print("Nenhum dado novo do Yahoo (rede, tickers ou fim‑de‑semana).")
        return 0

    yahoo_w = pd.concat(pieces, axis=1)
    yahoo_w = yahoo_w.loc[:, ~pd.Index(yahoo_w.columns).duplicated(keep="last")]
    yahoo_w = yahoo_w.loc[~yahoo_w.index.duplicated(keep="last")].sort_index()
    yahoo_w = yahoo_w[yahoo_w.index > last]

    if yahoo_w.empty:
        print("Sem linhas novas após", last.date())
        return 0

    # Mapear colunas Yahoo → nomes do CSV
    new_rows = pd.DataFrame(index=yahoo_w.index, columns=csv_cols, dtype=float)
    for ycol in yahoo_w.columns:
        csv_c = _yahoo_to_csv_col(str(ycol), csv_cols)
        if csv_c:
            new_rows[csv_c] = yahoo_w[ycol].values

    if "TBILL_PROXY" in new_rows.columns and "BIL" in new_rows.columns:
        new_rows["TBILL_PROXY"] = new_rows["BIL"].combine_first(new_rows["TBILL_PROXY"])
    elif "TBILL_PROXY" in new_rows.columns:
        new_rows["TBILL_PROXY"] = new_rows["TBILL_PROXY"].ffill()

    new_rows = new_rows.replace([np.inf, -np.inf], np.nan)
    merged = pd.concat([base, new_rows], axis=0)
    merged = merged.sort_index()
    merged = merged[~merged.index.duplicated(keep="last")]
    merged = merged.ffill()

    out = merged.reset_index()
    out["date"] = out["date"].dt.strftime("%Y-%m-%d")
    out.to_csv(CSV_PATH, index=False)
    print("OK — gravado até", out["date"].iloc[-1], "| linhas:", len(out))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
