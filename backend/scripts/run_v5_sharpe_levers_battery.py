#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Bateria: alavancas tipicas para Sharpe / cauda / turnover (V5, perfil moderado, CAP15).

Mede amostra completa + janelas moveis 36m/60m/120m (Sharpe anualizado por janela, passo 21)
e cauda (p1 retorno diario, CVaR 1%), TE e IR vs benchmark diario.

Requisito: DECIDE_V5_ENGINE_ROOT ou DECIDE_CORE22_CLONE ao lado do decide-core.

Uso (desde decide-core/backend)::

    python scripts/run_v5_sharpe_levers_battery.py
    python scripts/run_v5_sharpe_levers_battery.py --json-out tmp_sharpe_battery.json
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

TRADING_DAYS = 252


def _resolve_v5_backend() -> Path:
    env = (os.environ.get("DECIDE_V5_ENGINE_ROOT") or "").strip()
    if env:
        p = Path(env).resolve()
        if (p / "engine_research_v5.py").is_file():
            return p
    cand = _REPO.parent / "DECIDE_CORE22_CLONE" / "backend"
    if (cand / "engine_research_v5.py").is_file():
        return cand.resolve()
    raise FileNotFoundError("Define DECIDE_V5_ENGINE_ROOT com engine_research_v5.py")


def _pctiles(xs: list[float], qs: tuple[int, ...] = (10, 50, 90)) -> dict[str, float]:
    arr = np.array([x for x in xs if x == x and math.isfinite(x)], dtype=float)
    if arr.size == 0:
        return {f"p{q}": float("nan") for q in qs}
    return {f"p{q}": float(np.percentile(arr, q)) for q in qs}


def _max_dd(eq: np.ndarray) -> float:
    if len(eq) < 2:
        return float("nan")
    s = np.asarray(eq, dtype=float)
    peak = np.maximum.accumulate(s)
    dd = s / peak - 1.0
    return float(np.min(dd))


def _segment_sharpe(r: np.ndarray) -> float:
    r = np.asarray(r, dtype=float)
    r = r[np.isfinite(r)]
    if r.size < 40:
        return float("nan")
    sd = float(np.std(r, ddof=0))
    if sd < 1e-12:
        return float("nan")
    return float(np.mean(r) / sd * math.sqrt(TRADING_DAYS))


def _rolling_sharpe_panel(r: pd.Series, window_td: int, step: int) -> dict[str, float]:
    r = r.dropna()
    n = len(r)
    if n < window_td + 10:
        return {f"p{q}": float("nan") for q in (10, 50, 90)}
    vals: list[float] = []
    for end in range(window_td, n, step):
        seg = r.iloc[end - window_td : end].to_numpy(dtype=float)
        sh = _segment_sharpe(seg)
        if sh == sh:
            vals.append(sh)
    return _pctiles(vals)


def _metrics_from_run(r: dict[str, Any], *, step: int) -> dict[str, Any]:
    s = r.get("summary") or {}
    idx = pd.to_datetime(r["dates"], errors="coerce")
    ov = pd.to_numeric(pd.Series(r["equity_overlayed"], index=idx), errors="coerce").dropna()
    be = pd.to_numeric(pd.Series(r["benchmark_equity"], index=idx), errors="coerce").reindex(ov.index).ffill()
    be = be.dropna()
    common = ov.index.intersection(be.index)
    ov = ov.loc[common].astype(float)
    be = be.loc[common].astype(float)
    r_m = ov.pct_change().dropna()
    r_b = be.pct_change().reindex(r_m.index).dropna()
    cx = r_m.index.intersection(r_b.index)
    r_m = r_m.loc[cx]
    r_b = r_b.loc[cx]
    excess = (r_m - r_b).dropna()
    te = float(excess.std(ddof=0) * math.sqrt(TRADING_DAYS)) if len(excess) > 30 else float("nan")
    ir = (
        float(excess.mean() / excess.std(ddof=0) * math.sqrt(TRADING_DAYS))
        if excess.std(ddof=0) > 1e-12
        else float("nan")
    )
    arr = r_m.to_numpy(dtype=float)
    arr = arr[np.isfinite(arr)]
    p1 = float(np.percentile(arr, 1)) if arr.size > 50 else float("nan")
    thr = np.percentile(arr, 1) if arr.size > 50 else float("nan")
    tail = arr[arr <= thr] if arr.size > 0 else arr[:0]
    cvar1 = float(np.mean(tail)) if tail.size > 0 else float("nan")

    months_td = {36: 756, 60: 1260, 120: 2520}
    roll_sh: dict[str, Any] = {}
    for mo, w in months_td.items():
        roll_sh[str(mo)] = _rolling_sharpe_panel(r_m, w, step)

    return {
        "overlayed_cagr": float(s.get("overlayed_cagr") or 0.0),
        "overlayed_sharpe": float(s.get("overlayed_sharpe") or 0.0),
        "benchmark_cagr": float(s.get("benchmark_cagr") or 0.0),
        "max_drawdown": _max_dd(ov.to_numpy(dtype=float)),
        "avg_turnover": float(s.get("avg_turnover") or 0.0),
        "n_rebalance_executed": int(s.get("n_rebalance_executed") or 0),
        "tracking_error_ann": te,
        "information_ratio": ir,
        "worst_day_p1": p1,
        "cvar_daily_1pct": cvar1,
        "rolling_sharpe": roll_sh,
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--prices", type=str, default="", help="CSV precos")
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
        print("ERRO: falta CSV", prices_path, file=sys.stderr)
        return 2

    base: dict[str, Any] = {
        "prices_path": str(prices_path),
        "profile": str(args.profile),
        "cap_per_ticker": float(args.cap_per_ticker),
        "max_effective_exposure": 1.0,
        "bear_low_vol_overlay_enabled": True,
        "bear_low_vol_hysteresis": True,
        "bear_low_vol_tiered": False,
        "bear_low_vol_hysteresis_entry_quantile": 0.40,
        "bear_low_vol_hysteresis_exit_quantile": 0.65,
        "bear_low_vol_hysteresis_exit_consecutive_days": 10,
        "bear_low_vol_hysteresis_bear_ma_window": 252,
        "bear_low_vol_quantile_min_periods": 252,
        "bear_low_vol_bench_vol_window": 63,
        "bear_low_vol_exposure_mult": 0.85,
    }

    def go(name: str, kw: dict[str, Any]) -> tuple[str, dict[str, Any], dict[str, Any]]:
        merged = {**base, **kw}
        rr = run_research_v1(**merged)
        m = _metrics_from_run(rr, step=int(args.step))
        return name, merged, m

    isolated: list[tuple[str, dict[str, Any]]] = [
        ("baseline", {}),
        ("vol_target_63", {"vol_target_window": 63}),
        ("vol_target_252", {"vol_target_window": 252}),
        ("vol_scale_floor_cap_065_110", {"vol_scale_floor": 0.65, "vol_scale_cap": 1.10}),
        ("vol_scale_floor_cap_080_130", {"vol_scale_floor": 0.80, "vol_scale_cap": 1.30}),
        ("benchmark_ma_150", {"benchmark_ma_window": 150}),
        ("benchmark_ma_252", {"benchmark_ma_window": 252}),
        ("monthly_turnover_thr_015", {"monthly_rebalance_turnover_threshold": 0.15}),
        ("monthly_turnover_thr_030", {"monthly_rebalance_turnover_threshold": 0.30}),
        (
            "selection_buffer_asymmetric",
            {"selection_buffer_asymmetric": True, "rank_in_entry": 12, "rank_maintain": 20},
        ),
        ("rebalance_min_abs_dw_0003", {"rebalance_min_abs_weight_delta": 0.003}),
        ("momentum_v2_smooth", {"momentum_mode": "v2_smooth"}),
        ("momentum_v2_prudent", {"momentum_mode": "v2_prudent"}),
        ("top_q_15", {"top_q": 15}),
        ("top_q_30", {"top_q": 30}),
        ("vol_spike_on", {"vol_spike_enabled": True}),
    ]

    combos: list[tuple[str, dict[str, Any]]] = [
        (
            "combo_vol126_cap065110_thr030_smooth",
            {
                "vol_target_window": 126,
                "vol_scale_floor": 0.65,
                "vol_scale_cap": 1.10,
                "monthly_rebalance_turnover_threshold": 0.30,
                "momentum_mode": "v2_smooth",
            },
        ),
        (
            "combo_vol126_cap065110_asym_thr028",
            {
                "vol_target_window": 126,
                "vol_scale_floor": 0.65,
                "vol_scale_cap": 1.10,
                "selection_buffer_asymmetric": True,
                "rank_in_entry": 12,
                "rank_maintain": 20,
                "monthly_rebalance_turnover_threshold": 0.28,
            },
        ),
        (
            "combo_vol252_ma252_cap065110_thr030",
            {
                "vol_target_window": 252,
                "benchmark_ma_window": 252,
                "vol_scale_floor": 0.65,
                "vol_scale_cap": 1.10,
                "monthly_rebalance_turnover_threshold": 0.30,
            },
        ),
        (
            "combo_vol126_cap065110_top30_thr030",
            {
                "vol_target_window": 126,
                "vol_scale_floor": 0.65,
                "vol_scale_cap": 1.10,
                "top_q": 30,
                "monthly_rebalance_turnover_threshold": 0.30,
            },
        ),
        (
            "combo_vol126_prudent_asym_microdw",
            {
                "vol_target_window": 126,
                "momentum_mode": "v2_prudent",
                "selection_buffer_asymmetric": True,
                "rank_in_entry": 11,
                "rank_maintain": 19,
                "rebalance_min_abs_weight_delta": 0.003,
                "monthly_rebalance_turnover_threshold": 0.28,
            },
        ),
        (
            "combo_defensive_full",
            {
                "vol_target_window": 126,
                "vol_scale_floor": 0.65,
                "vol_scale_cap": 1.10,
                "benchmark_ma_window": 252,
                "monthly_rebalance_turnover_threshold": 0.30,
                "momentum_mode": "v2_smooth",
                "selection_buffer_asymmetric": True,
                "rank_in_entry": 12,
                "rank_maintain": 20,
                "rebalance_min_abs_weight_delta": 0.003,
            },
        ),
    ]

    rows_out: list[dict[str, Any]] = []
    for label, kw in isolated + combos:
        name, merged, m = go(label, kw)
        row = {
            "name": name,
            "params": {k: merged[k] for k in sorted(kw.keys())} if kw else {},
            **m,
        }
        rows_out.append(row)

    payload: dict[str, Any] = {
        "v5_engine_root": str(v5b),
        "prices_path": str(prices_path),
        "profile": args.profile,
        "step_days": int(args.step),
        "isolated": [x for x in rows_out if x["name"] in [t[0] for t in isolated]],
        "combinations": [x for x in rows_out if x["name"] in [t[0] for t in combos]],
    }

    txt = json.dumps(payload, ensure_ascii=False, indent=2)
    if str(args.json_out).strip():
        outp = Path(args.json_out).resolve()
        outp.parent.mkdir(parents=True, exist_ok=True)
        outp.write_text(txt, encoding="utf-8")

    def sort_key(row: dict[str, Any]) -> float:
        v = row.get("overlayed_sharpe")
        return float(v) if v == v else -999.0

    iso_sorted = sorted(payload["isolated"], key=sort_key, reverse=True)
    comb_sorted = sorted(payload["combinations"], key=sort_key, reverse=True)

    print("=== ISOLATED (sorted by full-sample Sharpe) ===")
    for row in iso_sorted:
        rs = row["rolling_sharpe"]
        print(
            f"{row['name']:<38} Sh={row['overlayed_sharpe']:.4f} "
            f"CAGR={row['overlayed_cagr']*100:.2f}% MDD={row['max_drawdown']*100:.2f}% "
            f"TE={row['tracking_error_ann']*100:.2f}% IR={row['information_ratio']:.3f} "
            f"p1={row['worst_day_p1']*100:.3f}% n_reb={row['n_rebalance_executed']}"
        )
        print(
            f"   rolling Sharpe p10/p50/p90: "
            f"36m {rs['36']['p10']:.3f}/{rs['36']['p50']:.3f}/{rs['36']['p90']:.3f} | "
            f"60m {rs['60']['p10']:.3f}/{rs['60']['p50']:.3f}/{rs['60']['p90']:.3f} | "
            f"120m {rs['120']['p10']:.3f}/{rs['120']['p50']:.3f}/{rs['120']['p90']:.3f}"
        )

    print()
    print("=== COMBINATIONS (sorted by full-sample Sharpe) ===")
    for row in comb_sorted:
        rs = row["rolling_sharpe"]
        print(
            f"{row['name']:<42} Sh={row['overlayed_sharpe']:.4f} "
            f"CAGR={row['overlayed_cagr']*100:.2f}% MDD={row['max_drawdown']*100:.2f}% "
            f"TE={row['tracking_error_ann']*100:.2f}% IR={row['information_ratio']:.3f} "
            f"p1={row['worst_day_p1']*100:.3f}% n_reb={row['n_rebalance_executed']}"
        )
        print(
            f"   rolling Sharpe p10/p50/p90: "
            f"36m {rs['36']['p10']:.3f}/{rs['36']['p50']:.3f}/{rs['36']['p90']:.3f} | "
            f"60m {rs['60']['p10']:.3f}/{rs['60']['p50']:.3f}/{rs['60']['p90']:.3f} | "
            f"120m {rs['120']['p10']:.3f}/{rs['120']['p50']:.3f}/{rs['120']['p90']:.3f}"
        )

    print()
    print("Best isolated:", iso_sorted[0]["name"], "Sharpe", round(iso_sorted[0]["overlayed_sharpe"], 4))
    print("Best combo:", comb_sorted[0]["name"], "Sharpe", round(comb_sorted[0]["overlayed_sharpe"], 4))
    print("Baseline Sharpe:", round(next(x["overlayed_sharpe"] for x in rows_out if x["name"] == "baseline"), 4))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
