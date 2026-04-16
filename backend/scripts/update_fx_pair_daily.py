#!/usr/bin/env python3
"""
Descarrega fechos diários de um par FX (Yahoo: ``EURUSD=X``) e grava ``backend/data/fx_EURUSD_daily.csv``
no formato esperado pelo ``kpi_server`` (colunas ``date``, ``ret`` — retorno simples dia a dia).

Uso a partir da pasta ``backend/``::

  python scripts/update_fx_pair_daily.py
  python scripts/update_fx_pair_daily.py --pair EURUSD --start 2005-01-01
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import pandas as pd

BACKEND_DIR = Path(__file__).resolve().parent.parent
DEFAULT_OUT = BACKEND_DIR / "data" / "fx_EURUSD_daily.csv"


def _yahoo_ticker(pair: str) -> str:
    p = "".join(c for c in pair.upper() if c.isalnum())
    if len(p) >= 6:
        return f"{p[:3]}{p[3:6]}=X"
    raise ValueError(f"Par FX inválido: {pair!r}")


def main() -> int:
    ap = argparse.ArgumentParser(description="Gera CSV fx_<PAIR>_daily.csv para hedge ilustrativo no KPI.")
    ap.add_argument("--pair", type=str, default="EURUSD", help="Ex.: EURUSD")
    ap.add_argument("--start", type=str, default="2005-01-01")
    ap.add_argument(
        "--out",
        type=str,
        default=str(DEFAULT_OUT),
        help="Caminho do CSV de saída",
    )
    args = ap.parse_args()
    try:
        import yfinance as yf
    except ImportError:
        print("Instala yfinance: pip install yfinance", file=sys.stderr)
        return 1

    safe = "".join(c for c in args.pair.upper() if c.isalnum())
    out = Path(args.out.strip()).resolve()
    if not str(out).lower().endswith(".csv"):
        out = BACKEND_DIR / "data" / f"fx_{safe}_daily.csv"

    tick = _yahoo_ticker(args.pair)
    df = yf.download(tick, start=args.start, progress=False, auto_adjust=True, threads=False)
    if df is None or df.empty:
        print("Download vazio:", tick, file=sys.stderr)
        return 1
    if isinstance(df.columns, pd.MultiIndex):
        df.columns = [str(c[0]).lower() for c in df.columns]
    close_col = "close" if "close" in df.columns else df.columns[0]
    s = df[close_col].astype(float).dropna()
    s.index = pd.to_datetime(s.index).normalize()
    ret = s.pct_change().fillna(0.0)
    out_df = pd.DataFrame({"date": s.index.strftime("%Y-%m-%d"), "ret": ret.values.astype(float)})
    out.parent.mkdir(parents=True, exist_ok=True)
    out_df.to_csv(out, index=False)
    print("OK:", len(out_df), "rows ->", out)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
