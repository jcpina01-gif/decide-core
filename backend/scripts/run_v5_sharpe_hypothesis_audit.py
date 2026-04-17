#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Auditoria de hipoteses: Sharpe 1,3 vs setup actual (freeze vs motor, janelas, perfis, momentum).

Uso: python scripts/run_v5_sharpe_hypothesis_audit.py [--json-out f.json]
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
FREEZE_OUT = _REPO / "freeze" / "DECIDE_MODEL_V5_V2_3_SMOOTH" / "model_outputs"
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
    raise FileNotFoundError("DECIDE_V5_ENGINE_ROOT")


def _sharpe_daily(r: pd.Series, rf_annual: float = 0.0) -> float:
    r = pd.to_numeric(r, errors="coerce").dropna()
    if len(r) < 40:
        return float("nan")
    rf_d = rf_annual / TRADING_DAYS
    x = r - rf_d
    sd = float(x.std(ddof=0))
    if sd < 1e-12:
        return float("nan")
    return float(x.mean() / sd * math.sqrt(TRADING_DAYS))


def _cagr_from_equity(eq: pd.Series) -> float:
    eq = pd.to_numeric(eq, errors="coerce").dropna()
    if len(eq) < 2:
        return float("nan")
    a, b = float(eq.iloc[0]), float(eq.iloc[-1])
    if a <= 0 or b <= 0:
        return float("nan")
    years = (len(eq) - 1) / TRADING_DAYS
    if years <= 0:
        return float("nan")
    return (b / a) ** (1.0 / years) - 1.0


def _max_dd(eq: pd.Series) -> float:
    eq = pd.to_numeric(eq, errors="coerce").dropna()
    if len(eq) < 2:
        return float("nan")
    v = eq.to_numpy(dtype=float)
    peak = np.maximum.accumulate(v)
    return float(np.min(v / peak - 1.0))


def _p1_cvar(r: pd.Series) -> tuple[float, float]:
    r = pd.to_numeric(r, errors="coerce").dropna().to_numpy(dtype=float)
    r = r[np.isfinite(r)]
    if r.size < 100:
        return float("nan"), float("nan")
    p1 = float(np.percentile(r, 1))
    tail = r[r <= p1]
    return p1, float(np.mean(tail)) if tail.size else float("nan")


def _rolling_sharpe_pctl(r: pd.Series, win: int = 252, step: int = 21) -> dict[str, float]:
    r = r.dropna()
    n = len(r)
    vals: list[float] = []
    for end in range(win, n, step):
        seg = r.iloc[end - win : end]
        sh = _sharpe_daily(seg)
        if sh == sh:
            vals.append(sh)
    if not vals:
        return {"p10": float("nan"), "p50": float("nan"), "p90": float("nan")}
    return {
        "p10": float(np.percentile(vals, 10)),
        "p50": float(np.percentile(vals, 50)),
        "p90": float(np.percentile(vals, 90)),
    }


def _pack_equity(name: str, eq: pd.Series, bench: pd.Series) -> dict[str, Any]:
    eq = eq.dropna()
    bench = bench.reindex(eq.index).ffill().dropna()
    common = eq.index.intersection(bench.index)
    eq, bench = eq.loc[common].astype(float), bench.loc[common].astype(float)
    r_m = eq.pct_change().dropna()
    r_b = bench.pct_change().reindex(r_m.index).dropna()
    cx = r_m.index.intersection(r_b.index)
    r_m, r_b = r_m.loc[cx], r_b.loc[cx]
    excess = r_m - r_b
    te = float(excess.std(ddof=0) * math.sqrt(TRADING_DAYS)) if len(excess) > 30 else float("nan")
    ir = (
        float(excess.mean() / excess.std(ddof=0) * math.sqrt(TRADING_DAYS))
        if excess.std(ddof=0) > 1e-12
        else float("nan")
    )
    p1, cvar = _p1_cvar(r_m)
    roll = _rolling_sharpe_pctl(r_m, 252, 21)
    n = len(eq)
    out: dict[str, Any] = {
        "name": name,
        "n_days": n,
        "start": str(eq.index.min().date()),
        "end": str(eq.index.max().date()),
        "sharpe_full": _sharpe_daily(r_m),
        "cagr_full": _cagr_from_equity(eq),
        "mdd_full": _max_dd(eq),
        "te_ann": te,
        "ir": ir,
        "p1_day": p1,
        "cvar_1pct": cvar,
        "rolling_1y_sharpe": roll,
    }
    for label, td in [("5y", 1260), ("10y", 2520)]:
        if n >= td + 5:
            eq_w = eq.iloc[-td:]
            be_w = bench.reindex(eq_w.index).ffill()
            r_w = eq_w.pct_change().dropna()
            out[f"sharpe_last_{label}"] = _sharpe_daily(r_w)
            out[f"cagr_last_{label}"] = _cagr_from_equity(eq_w)
            out[f"mdd_last_{label}"] = _max_dd(eq_w)
        else:
            out[f"sharpe_last_{label}"] = float("nan")
            out[f"cagr_last_{label}"] = float("nan")
            out[f"mdd_last_{label}"] = float("nan")
    return out


def _load_freeze_pair() -> tuple[pd.Series, pd.Series] | None:
    m_path = FREEZE_OUT / "model_equity_final_20y.csv"
    b_path = FREEZE_OUT / "benchmark_equity_final_20y.csv"
    if not m_path.is_file() or not b_path.is_file():
        return None
    dm = pd.read_csv(m_path)
    db = pd.read_csv(b_path)
    dm.columns = [str(c).strip().lower() for c in dm.columns]
    db.columns = [str(c).strip().lower() for c in db.columns]
    dm["date"] = pd.to_datetime(dm["date"], errors="coerce")
    db["date"] = pd.to_datetime(db["date"], errors="coerce")
    dm = dm.dropna(subset=["date"])
    db = db.dropna(subset=["date"])
    eq = pd.to_numeric(dm["model_equity"], errors="coerce").set_axis(dm["date"])
    be = pd.to_numeric(db["benchmark_equity"], errors="coerce").set_axis(db["date"])
    return eq, be


def _engine_base(prices_path: Path) -> dict[str, Any]:
    return {
        "prices_path": str(prices_path),
        "cap_per_ticker": 0.15,
        "max_effective_exposure": 1.0,
        "fx_conversion_bps": 0.0,
        "transaction_cost_bps": 5.0,
        "slippage_bps": 5.0,
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


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--prices", type=str, default="")
    ap.add_argument("--json-out", type=str, default="")
    args = ap.parse_args()

    prices_path = Path(args.prices).resolve() if str(args.prices).strip() else _BACKEND / "data" / "prices_close.csv"
    v5b = _resolve_v5_backend()
    if str(v5b) not in sys.path:
        sys.path.insert(0, str(v5b))
    from engine_research_v5 import run_research_v1  # noqa: E402

    rows: list[dict[str, Any]] = []

    # H1: freeze CSV vs motor re-run (moderado plafonado)
    loaded = _load_freeze_pair()
    if loaded is not None:
        eq_f, be_f = loaded
        rows.append(_pack_equity("H1_freeze_smooth_model_equity_csv", eq_f, be_f))

    base = _engine_base(prices_path)
    runs: list[tuple[str, dict[str, Any]]] = [
        ("H2_motor_moderado_10bps_baseline", {"profile": "moderado"}),
        ("H3_motor_momentum_v2_prudent", {"profile": "moderado", "momentum_mode": "v2_prudent"}),
        ("H4_motor_conservador_10bps", {"profile": "conservador"}),
        ("H5_motor_dinamico_10bps", {"profile": "dinamico"}),
        ("H6_moderado_vol_spike", {"profile": "moderado", "vol_spike_enabled": True}),
        ("H7_moderado_benchmark_ma252", {"profile": "moderado", "benchmark_ma_window": 252}),
    ]
    for name, kw in runs:
        r = run_research_v1(**{**base, **kw})
        idx = pd.to_datetime(r["dates"], errors="coerce")
        eq = pd.Series(r["equity_overlayed"], index=idx, dtype=float).dropna()
        be = pd.Series(r["benchmark_equity"], index=idx, dtype=float)
        row = _pack_equity(name, eq, be)
        row["engine_summary_sharpe"] = float((r.get("summary") or {}).get("overlayed_sharpe") or 0.0)
        row["avg_vol_scale_overlay"] = float((r.get("summary") or {}).get("avg_vol_scale_overlay") or 0.0)
        rows.append(row)

    # H1b: correlacao freeze vs motor moderado (ultima data comum)
    if loaded is not None:
        r0 = run_research_v1(**{**base, "profile": "moderado"})
        idx0 = pd.to_datetime(r0["dates"], errors="coerce")
        eq0 = pd.Series(r0["equity_overlayed"], index=idx0, dtype=float).dropna()
        eq_f, be_f = loaded
        common = eq0.index.intersection(eq_f.index)
        if len(common) > 200:
            a = eq0.loc[common].astype(float)
            b = eq_f.loc[common].astype(float)
            rel_diff = float((np.abs(a - b) / np.maximum(a.abs(), 1e-9)).mean())
            rows.append(
                {
                    "name": "H1b_freeze_vs_motor_curve_check",
                    "n_common_days": int(len(common)),
                    "mean_abs_rel_diff": rel_diff,
                    "note": "0 se curvas iguais no overlap",
                }
            )

    payload = {"v5_engine_root": str(v5b), "prices_path": str(prices_path), "freeze_dir": str(FREEZE_OUT), "rows": rows}
    txt = json.dumps(payload, indent=2, ensure_ascii=False)
    if str(args.json_out).strip():
        Path(args.json_out).resolve().parent.mkdir(parents=True, exist_ok=True)
        Path(args.json_out).write_text(txt, encoding="utf-8")

    print("=== Hipoteses: Sharpe/CAGR/MDD (full, ultimos 5y/10y) + rolling 1Y Sharpe p10/p50/p90 ===\n")
    for row in rows:
        if "sharpe_full" not in row:
            print(row.get("name"), row)
            continue
        rs = row["rolling_1y_sharpe"]
        print(
            f"{row['name']}\n"
            f"  full: Sharpe={row['sharpe_full']:.4f} CAGR={row['cagr_full']*100:.2f}% MDD={row['mdd_full']*100:.2f}% "
            f"TE={row['te_ann']*100:.2f}% IR={row['ir']:.3f} p1={row['p1_day']*100:.3f}%\n"
            f"  ultimos 5y: Sharpe={row['sharpe_last_5y']:.4f} CAGR={row['cagr_last_5y']*100:.2f}% MDD={row['mdd_last_5y']*100:.2f}%\n"
            f"  ultimos 10y: Sharpe={row['sharpe_last_10y']:.4f} CAGR={row['cagr_last_10y']*100:.2f}% MDD={row['mdd_last_10y']*100:.2f}%\n"
            f"  rolling 1Y Sharpe p10/p50/p90: {rs['p10']:.3f} / {rs['p50']:.3f} / {rs['p90']:.3f}"
        )
        if "engine_summary_sharpe" in row:
            print(f"  (engine summary overlayed_sharpe={row['engine_summary_sharpe']:.4f}, avg_vol_scale_overlay={row['avg_vol_scale_overlay']:.4f})")
        print()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
