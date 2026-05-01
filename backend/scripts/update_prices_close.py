"""
Actualiza `backend/data/prices_close.csv` com prioridade TWS (IB), depois Yahoo Finance.

1) Liga ao TWS/Gateway e pede barras diárias recentes (defeito: 2 meses) por símbolo.
2) Mescla no CSV existente (preserva histórico longo).
3) Para símbolos que falharam no TWS, preenche com yfinance (mesmo período curto por defeito).

Uso (na raiz do repo decide-core):
  python backend/scripts/update_prices_close.py
  python backend/scripts/update_prices_close.py --source yf          # só Yahoo (legado)
  python backend/scripts/update_prices_close.py --source tws       # só TWS, sem fallback
  python backend/scripts/update_prices_close.py --yf-period 5y     # fallback YF longo

Agendamento diário 21:30: ver `scripts/windows/register_prices_task_2130.ps1`.
"""
from __future__ import annotations

import argparse
import importlib.util
import os
import shutil
import sys
from datetime import datetime
from pathlib import Path

import numpy as np
import pandas as pd

REPO_ROOT = Path(__file__).resolve().parents[2]
_BACKEND_PKG = REPO_ROOT / "backend"
if str(_BACKEND_PKG) not in sys.path:
    sys.path.insert(0, str(_BACKEND_PKG))
from price_series_clean import sanitize_extreme_daily_closes  # noqa: E402
SCRIPTS_DIR = Path(__file__).resolve().parent
DEFAULT_OUT = REPO_ROOT / "backend" / "data" / "prices_close.csv"
SIBLING_DASHBOARD = REPO_ROOT.parent / "decideai_dashboard" / "backend" / "data" / "prices_close.csv"


def _load_yf_module():
    path = SCRIPTS_DIR / "update_prices_close_yf.py"
    spec = importlib.util.spec_from_file_location("decide_update_prices_yf", path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Não foi possível carregar {path}")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _read_tickers_from_header(path: Path) -> list[str]:
    df0 = pd.read_csv(path, nrows=0)
    cols = [str(c).strip() for c in df0.columns]
    return [c for c in cols if c.lower() != "date"]


def apply_price_updates(existing_csv: Path, updates_wide: pd.DataFrame) -> pd.DataFrame:
    """
    updates_wide: index = datas (datetime), colunas = tickers com closes recentes.
    """
    old = pd.read_csv(existing_csv, parse_dates=["date"])
    tickers = [c for c in old.columns if c != "date"]
    old = old.set_index("date").sort_index()
    if updates_wide.empty:
        return (
            old.copy()
            .reset_index()
            .assign(date=lambda d: pd.to_datetime(d["date"]).dt.strftime("%Y-%m-%d"))[ ["date"] + tickers]
        )

    upd = updates_wide.copy()
    upd.index = pd.to_datetime(upd.index)
    upd = upd.sort_index()
    upd = upd[~upd.index.duplicated(keep="last")]

    missing = [c for c in upd.columns if c not in old.columns]
    if missing:
        old = pd.concat(
            [old, pd.DataFrame(np.nan, index=old.index, columns=missing)],
            axis=1,
        )
    u_idx = old.index.union(upd.index).sort_values()
    old = old.reindex(u_idx)
    upd2 = upd.reindex(u_idx)

    ecols = list(upd.columns)
    col_order = list(old.columns)
    p = (upd2[ecols] > 0) & upd2[ecols].notna()
    merged_part = old[ecols].where(~p, upd2[ecols])
    rest = [c for c in col_order if c not in ecols]
    old = pd.concat([old[rest], merged_part], axis=1) if rest else merged_part
    old = old.reindex(columns=col_order)

    old = old.copy()
    old = old.sort_index()
    old = sanitize_extreme_daily_closes(old)
    old = old.reset_index()
    if "date" not in old.columns and len(old.columns) > 0:
        old = old.rename(columns={old.columns[0]: "date"})
    old["date"] = old["date"].dt.strftime("%Y-%m-%d")
    return old.reindex(columns=["date"] + tickers)


def run_yf_subset(
    yf_mod,
    tickers: list[str],
    period: str,
    chunk: int,
) -> pd.DataFrame:
    """Descarrega só estes tickers e devolve wide com coluna date (str)."""
    if not tickers:
        return pd.DataFrame()
    # Yahoo falha muitas vezes (JSON vazio, rate limit); nao derruba o run se TWS ja tiver alguns dados
    wide = yf_mod.download_all_closes(tickers, period, chunk, raise_on_empty=False)
    if wide.empty:
        return pd.DataFrame()
    wide = wide.reindex(columns=tickers)
    out_df = wide.reset_index()
    out_df = out_df.rename(columns={out_df.columns[0]: "date"})
    out_df["date"] = pd.to_datetime(out_df["date"]).dt.strftime("%Y-%m-%d")
    return out_df


def merge_long_csv(base: pd.DataFrame, extra: pd.DataFrame) -> pd.DataFrame:
    """Junta dois CSVs wide por data (último valor ganha em duplicados)."""
    if extra.empty:
        return base
    tickers = [c for c in base.columns if c != "date"]
    b = base.copy()
    e = extra.copy()
    b["date"] = pd.to_datetime(b["date"])
    e["date"] = pd.to_datetime(e["date"])
    b = b.set_index("date").sort_index()
    e = e.set_index("date").sort_index()
    missing = [c for c in e.columns if c not in b.columns]
    if missing:
        b = pd.concat(
            [b, pd.DataFrame(np.nan, index=b.index, columns=missing)],
            axis=1,
        )
    u_idx = b.index.union(e.index).sort_values()
    b = b.reindex(u_idx)
    e2 = e.reindex(u_idx)
    ecols = list(e.columns)
    col_order = list(b.columns)
    p = e2[ecols].notna()
    merged_part = b[ecols].where(~p, e2[ecols])
    rest = [c for c in col_order if c not in ecols]
    b = pd.concat([b[rest], merged_part], axis=1) if rest else merged_part
    b = b.reindex(columns=col_order)
    b = b.copy()
    b = b.sort_index()
    b = sanitize_extreme_daily_closes(b)
    b = b.copy()
    b = b.reset_index()
    if "date" not in b.columns and len(b.columns) > 0:
        b = b.rename(columns={b.columns[0]: "date"})
    b["date"] = b["date"].dt.strftime("%Y-%m-%d")
    return b.reindex(columns=["date"] + tickers)


def main() -> int:
    if str(SCRIPTS_DIR) not in sys.path:
        sys.path.insert(0, str(SCRIPTS_DIR))

    ap = argparse.ArgumentParser(description="Actualiza prices_close.csv (TWS + Yahoo).")
    ap.add_argument(
        "--source",
        choices=("auto", "tws", "yf"),
        default=os.environ.get("DECIDE_PRICES_SOURCE", "auto"),
        help="auto: TWS primeiro, YF para falhas; tws: só TWS; yf: só Yahoo (histórico longo).",
    )
    ap.add_argument(
        "--tws-duration",
        default=os.environ.get("DECIDE_TWS_DURATION", "2 M"),
        help="Duração reqHistoricalData TWS (ex.: 1 M, 2 M, 1 Y).",
    )
    ap.add_argument(
        "--yf-fallback-period",
        default=os.environ.get("DECIDE_PRICES_YF_FALLBACK_PERIOD", "3mo"),
        help="Período yfinance para símbolos falhados no TWS (ex.: 3mo, 1y, 5y).",
    )
    ap.add_argument(
        "--yf-period",
        default=os.environ.get("DECIDE_PRICES_PERIOD", "5y"),
        help="Com --source yf: período completo Yahoo.",
    )
    ap.add_argument("--chunk", type=int, default=45, help="Chunk yfinance (tickers por pedido).")
    ap.add_argument("--input", type=Path, default=None, help="CSV de referência (cabeçalho tickers).")
    ap.add_argument("--output", type=Path, default=None, help="Destino CSV.")
    args = ap.parse_args()

    out_path = Path(args.output) if args.output else DEFAULT_OUT
    inp_path = args.input
    if inp_path is None:
        if out_path.exists():
            inp_path = out_path
        elif SIBLING_DASHBOARD.exists():
            inp_path = SIBLING_DASHBOARD
        else:
            print(
                "Não há CSV de referência. Coloque prices_close.csv em backend/data/ "
                f"ou defina --input (tentei também {SIBLING_DASHBOARD}).",
                file=sys.stderr,
            )
            return 2

    tickers = _read_tickers_from_header(inp_path)
    yf_mod = _load_yf_module()

    if args.source == "yf":
        print(f"Modo Yahoo apenas | referência: {inp_path} | tickers={len(tickers)} | período={args.yf_period}", flush=True)
        wide = yf_mod.download_all_closes(tickers, args.yf_period, args.chunk)
        wide = wide.reindex(columns=tickers)
        out_df = wide.reset_index()
        out_df = out_df.rename(columns={out_df.columns[0]: "date"})
        out_df["date"] = pd.to_datetime(out_df["date"]).dt.strftime("%Y-%m-%d")
        if out_path.exists():
            old_n = max(0, len(pd.read_csv(out_path)) - 1)
            if old_n > 400 and len(out_df) < 100:
                print(
                    "Recuso gravar: o período escolhido produziria um histórico muito curto face ao CSV "
                    "existente (use --yf-period 5y ou apague o destino). "
                    "Para forçar: defina DECIDE_PRICES_YF_ALLOW_SHORT=1.",
                    file=sys.stderr,
                )
                if (os.environ.get("DECIDE_PRICES_YF_ALLOW_SHORT") or "").strip().lower() not in {
                    "1",
                    "true",
                    "yes",
                }:
                    return 3
    else:
        from prices_tws import connect_ib, disconnect_safely, fetch_all_symbols

        tws_wide = pd.DataFrame()
        failed: list[str] = list(tickers)
        ib = None

        try:
            ib = connect_ib()
        except Exception as e:
            print(f"TWS indisponível ({e}); fallback Yahoo para símbolos em falta.", flush=True)

        if ib is not None:
            try:

                def _prog(i: int, n: int, sym: str) -> None:
                    if i == 1 or i == n or i % 25 == 0:
                        print(f"  TWS {i}/{n} {sym}", flush=True)

                tws_wide, failed = fetch_all_symbols(
                    ib,
                    tickers,
                    duration_str=args.tws_duration,
                    on_progress=_prog,
                )
            finally:
                disconnect_safely(ib)

            print(f"TWS: séries obtidas={len(tws_wide.columns)} | falhados={len(failed)}", flush=True)

        if args.source == "tws" and failed:
            print(f"Aviso: {len(failed)} símbolos sem dados TWS; sem fallback (--source tws).", flush=True)

        if not out_path.exists():
            shutil.copy2(inp_path, out_path)

        out_df = apply_price_updates(out_path, tws_wide)

        if failed and args.source != "tws":
            fb_period = args.yf_period if ib is None else args.yf_fallback_period
            print(f"Yahoo fallback para {len(failed)} símbolos (período={fb_period})…", flush=True)
            yf_part = run_yf_subset(yf_mod, failed, fb_period, args.chunk)
            if not yf_part.empty:
                out_df = merge_long_csv(out_df, yf_part)
            else:
                print(
                    "Aviso: Yahoo nao devolveu dados (API/limites). TWS/IB: confirme Gateway a correr e portas. "
                    "Pode correr: python backend/scripts/update_prices_close.py --source tws",
                    file=sys.stderr,
                    flush=True,
                )

    out_path.parent.mkdir(parents=True, exist_ok=True)
    if out_path.exists():
        bak = out_path.with_suffix(out_path.suffix + f".{datetime.now().strftime('%Y%m%d_%H%M%S')}.bak")
        shutil.copy2(out_path, bak)
        print(f"Backup: {bak}", flush=True)

    out_df.to_csv(out_path, index=False)
    last = str(out_df["date"].iloc[-1]) if len(out_df) else "?"
    print(f"Gravado: {out_path} | linhas={len(out_df)} | última data={last}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
