#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Focused battery for `moderado_trial_risk_control` validation.

Scenarios exported side by side:
- baseline_3p3
- baseline_5p5
- vol_spike_3p3
- concentration_control_3p3
- moderado_trial_risk_control
"""

from __future__ import annotations

import argparse
import json
import math
import os
import sys
import tempfile
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
    raise FileNotFoundError("Define DECIDE_V5_ENGINE_ROOT with engine_research_v5.py")


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


def _window_kpis(eq: pd.Series) -> dict[str, float]:
    eq = eq.dropna().astype(float)
    if len(eq) < 30:
        return {"cagr": float("nan"), "sharpe": float("nan"), "max_drawdown": float("nan")}
    rets = eq.pct_change().dropna()
    years = max((eq.index[-1] - eq.index[0]).days / 365.25, 1e-9)
    cagr = float((eq.iloc[-1] / eq.iloc[0]) ** (1.0 / years) - 1.0) if eq.iloc[0] > 0 else float("nan")
    sharpe = _segment_sharpe(rets.to_numpy(dtype=float))
    mdd = _max_dd(eq.to_numpy(dtype=float))
    return {"cagr": cagr, "sharpe": sharpe, "max_drawdown": mdd}


def _stress_periods(ov: pd.Series) -> dict[str, dict[str, float]]:
    windows = {
        "stress_2008": ("2008-01-01", "2009-03-31"),
        "stress_2020": ("2020-02-01", "2020-12-31"),
        "stress_2022": ("2022-01-01", "2022-12-31"),
    }
    out: dict[str, dict[str, float]] = {}
    for key, (a, b) in windows.items():
        seg = ov.loc[(ov.index >= pd.Timestamp(a)) & (ov.index <= pd.Timestamp(b))]
        out[key] = _window_kpis(seg)
    return out


def _exposure_snapshot_from_holdings(holdings: list[dict[str, Any]]) -> dict[str, Any]:
    if not holdings:
        return {"country": {}, "sector": {}}
    by_country: dict[str, float] = {}
    by_sector: dict[str, float] = {}
    for row in holdings:
        w = float(row.get("weight") or 0.0)
        c = str(row.get("region") or row.get("country") or "UNKNOWN").strip().upper() or "UNKNOWN"
        s = str(row.get("sector") or "UNKNOWN").strip() or "UNKNOWN"
        by_country[c] = by_country.get(c, 0.0) + w
        by_sector[s] = by_sector.get(s, 0.0) + w
    return {
        "country": dict(sorted(by_country.items(), key=lambda kv: kv[1], reverse=True)),
        "sector": dict(sorted(by_sector.items(), key=lambda kv: kv[1], reverse=True)),
    }


def _history_exposure_from_weights_csv(weights_csv: Path) -> dict[str, Any]:
    if not weights_csv.is_file():
        return {"error": "missing_weights_csv", "path": str(weights_csv)}
    df = pd.read_csv(weights_csv)
    needed = {"rebalance_date", "final_weight", "country", "sector"}
    if not needed.issubset(set(df.columns)):
        return {"error": "unexpected_columns", "columns": list(df.columns)}

    df = df.copy()
    df["rebalance_date"] = pd.to_datetime(df["rebalance_date"], errors="coerce")
    df = df.dropna(subset=["rebalance_date"])
    df["final_weight"] = pd.to_numeric(df["final_weight"], errors="coerce").fillna(0.0)
    df = df[df["final_weight"] > 0]
    if df.empty:
        return {"error": "no_positive_weights"}

    def summarize(dim: str) -> dict[str, Any]:
        g = (
            df.groupby(["rebalance_date", dim], dropna=False)["final_weight"]
            .sum()
            .reset_index()
        )
        g[dim] = g[dim].fillna("UNKNOWN").astype(str)
        pvt = g.pivot(index="rebalance_date", columns=dim, values="final_weight").fillna(0.0)
        stats: list[dict[str, Any]] = []
        for col in pvt.columns:
            ser = pvt[col].astype(float)
            stats.append(
                {
                    "key": str(col),
                    "mean": float(ser.mean()),
                    "p90": float(ser.quantile(0.9)),
                    "max": float(ser.max()),
                    "latest": float(ser.iloc[-1]),
                }
            )
        stats.sort(key=lambda x: x["mean"], reverse=True)
        return {
            "top_by_mean": stats[:10],
            "top_by_latest": sorted(stats, key=lambda x: x["latest"], reverse=True)[:10],
        }

    return {
        "n_rebalances": int(df["rebalance_date"].nunique()),
        "country": summarize("country"),
        "sector": summarize("sector"),
    }


def _metrics_from_run(r: dict[str, Any], *, step: int, weights_csv: Path) -> dict[str, Any]:
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
    arr = r_m.to_numpy(dtype=float)
    arr = arr[np.isfinite(arr)]
    p1 = float(np.percentile(arr, 1)) if arr.size > 50 else float("nan")
    tail = arr[arr <= p1] if arr.size > 0 else arr[:0]
    cvar1 = float(np.mean(tail)) if tail.size > 0 else float("nan")

    months_td = {36: 756, 60: 1260, 120: 2520}
    roll_sh: dict[str, Any] = {}
    for mo, w in months_td.items():
        roll_sh[str(mo)] = _rolling_sharpe_panel(r_m, w, step)

    latest_holdings = r.get("latest_holdings_detailed") or []
    exposure_snapshot = _exposure_snapshot_from_holdings(latest_holdings if isinstance(latest_holdings, list) else [])
    exposure_history = _history_exposure_from_weights_csv(weights_csv)
    model_vol_ann = float(r_m.std(ddof=0) * math.sqrt(TRADING_DAYS)) if len(r_m) > 30 else float("nan")
    bench_vol_ann = float(r_b.std(ddof=0) * math.sqrt(TRADING_DAYS)) if len(r_b) > 30 else float("nan")
    vol_ratio = model_vol_ann / bench_vol_ann if bench_vol_ann > 1e-12 else float("nan")

    return {
        "overlayed_cagr": float(s.get("overlayed_cagr") or 0.0),
        "overlayed_sharpe": float(s.get("overlayed_sharpe") or 0.0),
        "max_drawdown": _max_dd(ov.to_numpy(dtype=float)),
        "avg_turnover": float(s.get("avg_turnover") or 0.0),
        "n_rebalance_executed": int(s.get("n_rebalance_executed") or 0),
        "worst_day_p1": p1,
        "cvar_daily_1pct": cvar1,
        "model_vol_ann": model_vol_ann,
        "benchmark_vol_ann": bench_vol_ann,
        "vol_ratio_vs_benchmark": vol_ratio,
        "rolling_sharpe": roll_sh,
        "stress_periods": _stress_periods(ov),
        "exposure_snapshot": exposure_snapshot,
        "exposure_history": exposure_history,
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--prices", type=str, default="", help="prices CSV path")
    ap.add_argument("--step", type=int, default=21, help="rolling step in trading days")
    ap.add_argument("--json-out", type=str, default="", help="optional output JSON path")
    args = ap.parse_args()

    v5b = _resolve_v5_backend()
    if str(v5b) not in sys.path:
        sys.path.insert(0, str(v5b))
    from engine_research_v5 import run_research_v1  # noqa: E402

    prices_path = Path(args.prices).resolve() if str(args.prices).strip() else _BACKEND / "data" / "prices_close.csv"
    if not prices_path.is_file():
        print("ERROR: missing prices CSV", prices_path, file=sys.stderr)
        return 2

    base: dict[str, Any] = {
        "prices_path": str(prices_path),
        "profile": "moderado",
        "cap_per_ticker": 0.15,
        "top_q": 20,
        "max_effective_exposure": 1.0,
        "transaction_cost_bps": 3.0,
        "slippage_bps": 3.0,
        "fx_conversion_bps": 0.0,
        "momentum_mode": "v2_prudent",
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

    scenarios: list[tuple[str, dict[str, Any]]] = [
        ("baseline_3p3", {}),
        ("baseline_5p5", {"transaction_cost_bps": 5.0, "slippage_bps": 5.0}),
        ("vol_spike_3p3", {"vol_spike_enabled": True}),
        (
            "concentration_control_3p3",
            {
                "cap_per_ticker": 0.12,
                "top_q": 25,
                "selection_buffer_asymmetric": True,
                "rank_in_entry": 15,
                "rank_maintain": 25,
            },
        ),
        (
            "moderado_trial_risk_control",
            {
                # Vol do trial próxima da do benchmark (regra de moderado com cap explícito no scaling).
                "vol_target_window": 63,
                "vol_scale_cap": 1.00,
                "cap_per_ticker": 0.12,
                "top_q": 25,
                "selection_buffer_asymmetric": True,
                "rank_in_entry": 15,
                "rank_maintain": 25,
                "bear_low_vol_hysteresis_entry_quantile": 0.35,
                "bear_low_vol_hysteresis_exit_quantile": 0.60,
                "bear_low_vol_exposure_mult": 0.70,
                "vol_spike_enabled": True,
                "benchmark_ma_window": 252,
            },
        ),
    ]

    rows: list[dict[str, Any]] = []
    with tempfile.TemporaryDirectory(prefix="moderado_trial_battery_") as tmp:
        tmp_dir = Path(tmp)
        for name, override in scenarios:
            run_kw = {**base, **override}
            weights_csv = tmp_dir / f"{name}_weights.csv"
            run_kw["emit_weights_csv"] = str(weights_csv)
            rr = run_research_v1(**run_kw)
            metrics = _metrics_from_run(rr, step=int(args.step), weights_csv=weights_csv)
            rows.append(
                {
                    "name": name,
                    "trial_profile_name": "moderado_trial_risk_control" if name == "moderado_trial_risk_control" else None,
                    "params": {k: run_kw[k] for k in sorted(override.keys())},
                    **metrics,
                }
            )

    payload: dict[str, Any] = {
        "v5_engine_root": str(v5b),
        "prices_path": str(prices_path),
        "base_profile": "moderado",
        "step_days": int(args.step),
        "scenarios": rows,
    }

    txt = json.dumps(payload, ensure_ascii=False, indent=2)
    if str(args.json_out).strip():
        outp = Path(args.json_out).resolve()
        outp.parent.mkdir(parents=True, exist_ok=True)
        outp.write_text(txt, encoding="utf-8")
        print(f"JSON -> {outp}")

    print("=== Moderado Trial Risk Control Battery ===")
    for row in rows:
        print(
            f"{row['name']:<30} "
            f"CAGR={row['overlayed_cagr']*100:.2f}% "
            f"Sharpe={row['overlayed_sharpe']:.4f} "
            f"MDD={row['max_drawdown']*100:.2f}% "
            f"p1={row['worst_day_p1']*100:.3f}% "
            f"CVaR1%={row['cvar_daily_1pct']*100:.3f}% "
            f"turn={row['avg_turnover']:.4f}"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
