#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Compara **legado** (sem overlay bear/vol), **flat** (overlay simples) e **escalonado**
(bear = bench < MA252; mult 0.85 / 0.90 / 0.95 / 1.00 por quantis expansivos da vol 63d).

Para cada corrida V5 (moderado, cap 15%, mesmos preços), calcula janelas móveis 36m / 60m / 120m
(dias de pregão 756 / 1260 / 2520, passo 21) e percentis p10/p50/p90 de:
  - excesso CAGR vs benchmark na janela
  - max drawdown do modelo na janela

Requisito: ``DECIDE_V5_ENGINE_ROOT`` ou ``../DECIDE_CORE22_CLONE/backend`` com ``engine_research_v5.py``
actualizado (modo ``bear_low_vol_tiered``).

Uso (a partir de ``decide-core/backend``)::

    python scripts/run_v5_bear_low_vol_tiered_rolling_report.py
    python scripts/run_v5_bear_low_vol_tiered_rolling_report.py --json-out ..\\tmp_tiered_rolling.json
"""

from __future__ import annotations

import argparse
import json
import math
import os
import sys
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

_BACKEND = Path(__file__).resolve().parent.parent
_REPO = _BACKEND.parent
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))

from engine_v2 import _compute_kpis, _relative_kpis  # noqa: E402


def _resolve_v5_backend() -> Path:
    env = (os.environ.get("DECIDE_V5_ENGINE_ROOT") or "").strip()
    if env:
        p = Path(env).resolve()
        if (p / "engine_research_v5.py").is_file():
            return p
    cand = _REPO.parent / "DECIDE_CORE22_CLONE" / "backend"
    if (cand / "engine_research_v5.py").is_file():
        return cand.resolve()
    raise FileNotFoundError("Define DECIDE_V5_ENGINE_ROOT para o backend do clone com engine_research_v5.py")


def _series_from_run(r: dict[str, Any]) -> tuple[pd.Series, pd.Series]:
    idx = pd.to_datetime(r["dates"], errors="coerce")
    m = pd.to_numeric(pd.Series(r["equity_overlayed"], index=idx), errors="coerce").dropna()
    b = pd.to_numeric(pd.Series(r["benchmark_equity"], index=idx), errors="coerce").reindex(m.index).ffill()
    b = b.dropna()
    common = m.index.intersection(b.index)
    return m.loc[common].astype(float), b.loc[common].astype(float)


def _pctiles(xs: list[float], qs: tuple[float, ...] = (10, 50, 90)) -> dict[str, float]:
    arr = np.array([x for x in xs if x == x and math.isfinite(x)], dtype=float)
    if arr.size == 0:
        return {f"p{int(q)}": float("nan") for q in qs}
    return {f"p{int(q)}": float(np.percentile(arr, q)) for q in qs}


def _rolling_panel(
    model: pd.Series,
    bench: pd.Series,
    *,
    window_td: int,
    step: int,
) -> dict[str, Any]:
    idx = model.index.intersection(bench.index)
    m = model.loc[idx].astype(float)
    b = bench.loc[idx].astype(float)
    n = len(m)
    if n < window_td + 10:
        return {"error": "serie_curta", "n": n, "window_trading_days": window_td}

    excess_cagr: list[float] = []
    mdds: list[float] = []

    for i in range(window_td, n, step):
        sm = m.iloc[i - window_td : i]
        sb = b.iloc[i - window_td : i]
        if len(sm) < int(window_td * 0.95):
            continue
        mk = _compute_kpis(sm)
        rk = _relative_kpis(sm, sb)
        excess_cagr.append(float(rk.get("excess_cagr_vs_benchmark", float("nan"))))
        mdds.append(float(mk.get("max_drawdown", float("nan"))))

    return {
        "window_trading_days": window_td,
        "step_days": step,
        "n_windows": len(excess_cagr),
        "excess_cagr": _pctiles(excess_cagr),
        "model_max_drawdown": _pctiles(mdds),
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--prices", type=str, default="", help="CSV preços")
    ap.add_argument("--profile", type=str, default="moderado")
    ap.add_argument("--cap-per-ticker", type=float, default=0.15)
    ap.add_argument("--step", type=int, default=21)
    ap.add_argument("--json-out", type=str, default="")
    args = ap.parse_args()

    v5b = _resolve_v5_backend()
    if str(v5b) not in sys.path:
        sys.path.insert(0, str(v5b))
    from engine_research_v5 import run_research_v1  # noqa: E402

    prices_path = Path(args.prices).resolve() if str(args.prices).strip() else _BACKEND / "data" / "prices_close.csv"
    if not prices_path.is_file():
        print(f"ERRO: {prices_path}", file=sys.stderr)
        return 2

    base_kw: dict[str, Any] = {
        "prices_path": str(prices_path),
        "profile": str(args.profile),
        "cap_per_ticker": float(args.cap_per_ticker),
    }

    runs = {
        "legacy_no_bear_low_vol": run_research_v1(**base_kw, bear_low_vol_overlay_enabled=False),
        "flat_bear_low_vol": run_research_v1(
            **base_kw,
            bear_low_vol_overlay_enabled=True,
            bear_low_vol_tiered=False,
            bear_low_vol_exposure_mult=0.85,
        ),
        "tiered_bear_ma252": run_research_v1(
            **base_kw,
            bear_low_vol_overlay_enabled=True,
            bear_low_vol_tiered=True,
            bear_low_vol_bench_vol_window=63,
            bear_low_vol_bear_ma_window=252,
            bear_low_vol_quantile_min_periods=252,
        ),
    }

    months_to_td = {36: 756, 60: 1260, 120: 2520}
    out_roll: dict[str, Any] = {}
    out_sum: dict[str, Any] = {}

    for name, r in runs.items():
        s = r.get("summary") or {}
        out_sum[name] = {
            "overlayed_cagr": s.get("overlayed_cagr"),
            "overlayed_sharpe": s.get("overlayed_sharpe"),
            "benchmark_cagr": s.get("benchmark_cagr"),
            "pct_days_bear_low_vol_active": s.get("pct_days_bear_low_vol_active"),
            "avg_bear_low_vol_exposure": s.get("avg_bear_low_vol_exposure"),
            "bear_low_vol_tiered": s.get("bear_low_vol_tiered"),
            "pct_days_bear_low_vol_tier_085": s.get("pct_days_bear_low_vol_tier_085"),
            "pct_days_bear_low_vol_tier_090": s.get("pct_days_bear_low_vol_tier_090"),
            "pct_days_bear_low_vol_tier_095": s.get("pct_days_bear_low_vol_tier_095"),
        }
        m, b = _series_from_run(r)
        out_roll[name] = {}
        for mo, wtd in months_to_td.items():
            out_roll[name][f"{mo}m"] = _rolling_panel(m, b, window_td=wtd, step=int(args.step))

    payload = {
        "v5_engine_root": str(v5b),
        "prices_path": str(prices_path),
        "profile": args.profile,
        "step_days": int(args.step),
        "rolling_months_trading_days": months_to_td,
        "summary": out_sum,
        "rolling": out_roll,
        "notes": [
            "Escalonado: bear = benchmark_price < MA252; vol 63d vs quantis expansivos (shift(1) na serie de vol antes dos quantis).",
            "Mults: <p20->0.85, [p20,p40)->0.90, [p40,p50)->0.95, >=p50->1.00 (apenas em bear).",
        ],
    }

    txt = json.dumps(payload, ensure_ascii=False, indent=2)
    if str(args.json_out).strip():
        outp = Path(args.json_out).resolve()
        outp.parent.mkdir(parents=True, exist_ok=True)
        outp.write_text(txt, encoding="utf-8")
    print(txt)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
