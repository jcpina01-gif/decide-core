#!/usr/bin/env python3
"""
Actualiza o freeze ``DECIDE_MODEL_V5_V2_3_SMOOTH/model_outputs`` a partir de
``backend/data/prices_close.csv``.

**Por defeito** usa o motor **smooth canónico** (``engine_research_v5.run_research_v1``) via
``export_smooth_freeze_from_v5.py`` — custos, CAP15, ``equity_raw`` / overlay / margem como no
clone V5.

Requisitos do motor V5
----------------------

- ``DECIDE_V5_ENGINE_ROOT`` → pasta ``.../backend`` com ``engine_research_v5.py``, **ou**
- repositório ``DECIDE_CORE22_CLONE`` ao lado de ``decide-core`` (caminho por omissão do export).

Fallback opcional (proxy rápido, **não** é smooth V5)
------------------------------------------------------

- ``python scripts/regenerate_smooth_freeze_outputs.py --legacy-engine-v2`` — só ``engine_v2``.
- Ou, se o export V5 falhar: define ``DECIDE_FREEZE_FALLBACK_ENGINE_V2=1`` para cair no legado.

Uso (a partir da pasta ``backend/``)::

  python scripts/regenerate_smooth_freeze_outputs.py
  python scripts/regenerate_smooth_freeze_outputs.py --prices data/prices_close.csv
  python scripts/regenerate_smooth_freeze_outputs.py --legacy-engine-v2
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

import numpy as np
import pandas as pd

BACKEND_DIR = Path(__file__).resolve().parent.parent
REPO_ROOT = BACKEND_DIR.parent
FREEZE_OUT = (
    REPO_ROOT / "freeze" / "DECIDE_MODEL_V5_V2_3_SMOOTH" / "model_outputs"
)
FREEZE_CLONE = FREEZE_OUT.parent / "model_outputs_from_clone"
PRICES_CSV = BACKEND_DIR / "data" / "prices_close.csv"
V5_KPIS = FREEZE_OUT / "v5_kpis.json"
EXPORT_V5_SCRIPT = Path(__file__).resolve().parent / "export_smooth_freeze_from_v5.py"

CAP = 0.15
TOP_Q = 20
MARGIN_LEVERAGE = 1.12
MARGIN_BORROW_APY = 0.04


def _margin_equity_compounded(
    eq: list[float],
    leverage: float,
    borrow_apy: float,
) -> list[float]:
    """NAV com alavancagem L sobre os retornos do modelo sem margem e custo diário sobre (L-1)."""
    L = float(leverage)
    if L <= 1.0:
        L = MARGIN_LEVERAGE
    daily_br = float(borrow_apy) / 252.0
    out: list[float] = []
    if not eq:
        return out
    out.append(float(eq[0]))
    for i in range(1, len(eq)):
        r = float(eq[i] / eq[i - 1] - 1.0)
        prev = out[-1]
        g = L * r - (L - 1.0) * daily_br
        out.append(prev * (1.0 + g))
    return out


def _fmt_main_date(d: str) -> str:
    s = d.strip()
    if len(s) == 10:
        return s + " 00:00:00"
    if len(s) >= 19:
        return s[:19]
    return s


def _fmt_margin_date(d: str) -> str:
    return d.strip()[:10]


def _median_equity_csv_ratio(num_path: Path, den_path: Path) -> float | None:
    if not num_path.is_file() or not den_path.is_file():
        return None
    num = pd.read_csv(num_path)
    den = pd.read_csv(den_path)
    n0, d0 = num.columns[0], den.columns[0]
    num[n0] = pd.to_datetime(num[n0], errors="coerce")
    den[d0] = pd.to_datetime(den[d0], errors="coerce")
    nn = num.set_index(n0).iloc[:, 0].astype(float)
    dd = den.set_index(d0).iloc[:, 0].astype(float)
    joined = pd.DataFrame({"n": nn, "d": dd}).dropna()
    joined = joined[joined["d"] > 0]
    if joined.empty:
        return None
    ratio = float((joined["n"] / joined["d"]).median())
    if not np.isfinite(ratio) or ratio <= 0:
        return None
    return ratio


def _extend_cash_sleeve(new_date_strs: list[str]) -> None:
    cash_path = FREEZE_OUT / "cash_sleeve_daily.csv"
    legacy = pd.read_csv(cash_path)
    d0 = legacy.columns[0]
    legacy[d0] = pd.to_datetime(legacy[d0], errors="coerce")
    s = legacy.set_index(d0).iloc[:, 0].astype(float)
    idx = pd.to_datetime(new_date_strs)
    out = s.reindex(idx, method="ffill").fillna(0.0)
    pd.DataFrame(
        {"date": [_fmt_margin_date(str(x.date())) for x in idx], "cash_sleeve": out.values}
    ).to_csv(cash_path, index=False)


def _run_v5_smooth_export(prices_csv: Path) -> int:
    if not EXPORT_V5_SCRIPT.is_file():
        print("Falta script:", EXPORT_V5_SCRIPT, file=sys.stderr)
        return 1
    cmd = [sys.executable, str(EXPORT_V5_SCRIPT), "--prices", str(prices_csv.resolve())]
    print("[smooth] Motor V5 (export_smooth_freeze_from_v5):", " ".join(cmd), file=sys.stderr)
    proc = subprocess.run(cmd, cwd=str(REPO_ROOT))
    return int(proc.returncode)


def _legacy_engine_v2_freeze(prices_csv: Path) -> int:
    sys.path.insert(0, str(BACKEND_DIR))
    import engine_v2 as ev2  # noqa: E402

    FREEZE_OUT.mkdir(parents=True, exist_ok=True)
    FREEZE_CLONE.mkdir(parents=True, exist_ok=True)

    legacy_margin_ratio: dict[str, float | None] = {}
    for _mk in ("moderado", "conservador", "dinamico"):
        legacy_margin_ratio[_mk] = _median_equity_csv_ratio(
            FREEZE_OUT / f"model_equity_final_20y_{_mk}_margin.csv",
            FREEZE_OUT / f"model_equity_final_20y_{_mk}.csv",
        )

    prices = pd.read_csv(prices_csv)
    first_col = prices.columns[0]
    prices[first_col] = pd.to_datetime(prices[first_col], errors="coerce")
    prices = prices.rename(columns={first_col: "date"})
    prices = prices.dropna(subset=["date"]).set_index("date").sort_index()
    for c in prices.columns:
        prices[c] = pd.to_numeric(prices[c], errors="coerce")
    prices = prices.dropna(axis=1, how="all").ffill()

    profiles = {
        "moderado": "moderado",
        "conservador": "conservador",
        "dinamico": "dinamico",
    }

    curves: dict[str, tuple[list[str], list[float], list[float]]] = {}
    for key, prof in profiles.items():
        res = ev2.run_model(
            profile=prof,
            prices=prices,
            top_q=TOP_Q,
            cap_per_ticker=CAP,
            benchmark=None,
        )
        ser = res.get("series") or {}
        raw_dates = [str(x) for x in ser.get("dates") or []]
        dates_h = [_fmt_main_date(d) for d in raw_dates]
        eq = [float(x) for x in ser.get("equity_overlayed") or []]
        bench = [float(x) for x in ser.get("benchmark_equity") or []]
        if len(dates_h) != len(eq) or len(eq) != len(bench):
            print("Série inconsistente para", key, file=sys.stderr)
            return 1
        curves[key] = (dates_h, eq, bench)

    dates_m, eq_m, bench_m = curves["moderado"]
    date_days = [d[:10] for d in dates_m]

    res_raw = ev2.run_model(
        profile="raw",
        prices=prices,
        top_q=TOP_Q,
        cap_per_ticker=CAP,
        benchmark=None,
    )
    ser_raw = res_raw.get("series") or {}
    raw_dates = [str(x) for x in ser_raw.get("dates") or []]
    dates_raw = [_fmt_main_date(d) for d in raw_dates]
    eq_raw = [float(x) for x in ser_raw.get("equity_overlayed") or []]
    if len(dates_raw) != len(eq_raw) or len(eq_raw) != len(eq_m):
        print(
            "Série RAW vs moderado: comprimentos",
            len(eq_raw),
            len(eq_m),
            file=sys.stderr,
        )
        return 1

    margin_eq_by_profile: dict[str, list[float]] = {}
    for key, (d_h, eq, _) in curves.items():
        pd.DataFrame({"date": d_h, "model_equity": eq}).to_csv(
            FREEZE_OUT / f"model_equity_final_20y_{key}.csv", index=False
        )
        mr = legacy_margin_ratio.get(key)
        if mr is None or mr <= 1.0 or mr > 2.5:
            mr = MARGIN_LEVERAGE
        margin_eq = _margin_equity_compounded(eq, mr, MARGIN_BORROW_APY)
        margin_eq_by_profile[key] = margin_eq
        pd.DataFrame(
            {"date": [_fmt_margin_date(x) for x in d_h], "model_equity": margin_eq}
        ).to_csv(FREEZE_OUT / f"model_equity_final_20y_{key}_margin.csv", index=False)

    pd.DataFrame({"date": dates_m, "model_equity": eq_m}).to_csv(
        FREEZE_OUT / "model_equity_final_20y.csv", index=False
    )
    pd.DataFrame(
        {
            "date": [_fmt_margin_date(x) for x in dates_m],
            "model_equity": margin_eq_by_profile["moderado"],
        }
    ).to_csv(FREEZE_OUT / "model_equity_final_20y_margin.csv", index=False)

    pd.DataFrame({"date": dates_m, "model_equity": eq_raw}).to_csv(
        FREEZE_OUT / "model_equity_theoretical_20y.csv", index=False
    )

    bench_df = pd.DataFrame({"date": dates_m, "benchmark_equity": bench_m})
    bench_df.to_csv(FREEZE_OUT / "benchmark_equity_final_20y.csv", index=False)
    bench_df.to_csv(FREEZE_CLONE / "benchmark_equity_final_20y.csv", index=False)

    _extend_cash_sleeve(date_days)

    last_day = date_days[-1]
    n_obs = len(eq_m)

    idx = pd.to_datetime(date_days)
    kpis_m = ev2._compute_kpis(pd.Series(eq_m, index=idx))
    kpis_b = ev2._compute_kpis(pd.Series(bench_m, index=idx))

    v5: dict = {}
    if V5_KPIS.is_file():
        v5 = json.loads(V5_KPIS.read_text(encoding="utf-8"))
    v5["data_end"] = last_day
    v5["data_start"] = v5.get("data_start") or date_days[0]
    v5["latest_portfolio_date"] = last_day
    v5["n_obs"] = int(n_obs)
    v5["data_file_used"] = str(prices_csv.resolve())
    v5["overlayed_cagr"] = kpis_m["cagr"]
    v5["overlayed_sharpe"] = kpis_m["sharpe"]
    v5["benchmark_cagr"] = kpis_b["cagr"]
    v5["cap_per_ticker"] = CAP
    v5["top_q"] = TOP_Q
    v5["curve_engine"] = "engine_v2_regenerate"
    v5["curve_engine_script"] = "regenerate_smooth_freeze_outputs.py --legacy-engine-v2"
    v5["curve_engine_note"] = (
        "Proxy engine_v2 — não replica custos/CAP15 completos do engine_research_v5."
    )
    cash_df = pd.read_csv(FREEZE_OUT / "cash_sleeve_daily.csv")
    v5["latest_cash_sleeve"] = float(cash_df.iloc[-1, 1])
    V5_KPIS.write_text(json.dumps(v5, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    cash_backend = BACKEND_DIR / "data" / "cash_sleeve_daily.csv"
    if cash_backend.parent.is_dir():
        shutil.copy2(FREEZE_OUT / "cash_sleeve_daily.csv", cash_backend)

    print("OK (engine_v2 legado) — série até", last_day, "| observações:", n_obs, "| pasta:", FREEZE_OUT)
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description="Freeze smooth: motor V5 por defeito, ou --legacy-engine-v2.")
    ap.add_argument(
        "--legacy-engine-v2",
        action="store_true",
        help="Usa só engine_v2 (sem motor research V5).",
    )
    ap.add_argument(
        "--prices",
        type=str,
        default=str(PRICES_CSV),
        help="Caminho para prices_close.csv",
    )
    args = ap.parse_args()
    prices_path = Path(args.prices.strip()).resolve()
    if not prices_path.is_file():
        print("Falta ficheiro de preços:", prices_path, file=sys.stderr)
        return 1

    if args.legacy_engine_v2:
        return _legacy_engine_v2_freeze(prices_path)

    rc = _run_v5_smooth_export(prices_path)
    if rc == 0:
        print("[smooth] OK — motor engine_research_v5 (ver curve_engine em v5_kpis.json).", file=sys.stderr)
        return 0

    print(
        "[smooth] Export V5 falhou (código",
        rc,
        "). Instala o clone com engine_research_v5 ou define DECIDE_V5_ENGINE_ROOT.",
        file=sys.stderr,
    )
    fb = os.environ.get("DECIDE_FREEZE_FALLBACK_ENGINE_V2", "").strip().lower() in (
        "1",
        "true",
        "yes",
        "on",
    )
    if fb:
        print(
            "[smooth] DECIDE_FREEZE_FALLBACK_ENGINE_V2 activo — a usar engine_v2.",
            file=sys.stderr,
        )
        return _legacy_engine_v2_freeze(prices_path)
    print(
        "[smooth] Para forçar o proxy v2: --legacy-engine-v2 ou DECIDE_FREEZE_FALLBACK_ENGINE_V2=1",
        file=sys.stderr,
    )
    return rc


if __name__ == "__main__":
    raise SystemExit(main())
