#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Compara custo total 5 bps vs 10 bps (txn+slippage) e variantes de turnover/buffer,
moderado + CAP15 plafonado + histerese bear+baixa vol (p40/p65), mesmo dataset.

Variantes:
  V1 baseline
  V2 rebalance_min_abs_weight_delta (drift / min trade)
  V3 buffer assimétrico rank_in_entry=15, rank_maintain=25
  V4 V2+V3

Uso: python scripts/run_v5_cost_buffer_battery.py [--json-out f.json]
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
    raise FileNotFoundError("DECIDE_V5_ENGINE_ROOT ou clone com engine_research_v5.py")


def _max_dd(eq: list[float]) -> float:
    s = np.asarray(eq, dtype=float)
    if s.size < 2:
        return float("nan")
    peak = np.maximum.accumulate(s)
    return float(np.min(s / peak - 1.0))


def _tail_metrics(r: dict[str, Any]) -> tuple[float, float]:
    idx = pd.to_datetime(r["dates"], errors="coerce")
    ov = pd.to_numeric(pd.Series(r["equity_overlayed"], index=idx), errors="coerce").dropna()
    dr = ov.pct_change().dropna().to_numpy(dtype=float)
    dr = dr[np.isfinite(dr)]
    if dr.size < 100:
        return float("nan"), float("nan")
    p1 = float(np.percentile(dr, 1))
    tail = dr[dr <= p1]
    cvar = float(np.mean(tail)) if tail.size else float("nan")
    return p1, cvar


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--prices", type=str, default="")
    ap.add_argument("--json-out", type=str, default="")
    args = ap.parse_args()

    v5b = _resolve_v5_backend()
    if str(v5b) not in sys.path:
        sys.path.insert(0, str(v5b))
    from engine_research_v5 import run_research_v1  # noqa: E402

    prices_path = Path(args.prices).resolve() if str(args.prices).strip() else _BACKEND / "data" / "prices_close.csv"
    if not prices_path.is_file():
        print("ERRO:", prices_path, file=sys.stderr)
        return 2

    base: dict[str, Any] = {
        "prices_path": str(prices_path),
        "profile": "moderado",
        "cap_per_ticker": 0.15,
        "max_effective_exposure": 1.0,
        "fx_conversion_bps": 0.0,
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

    variants: list[tuple[str, dict[str, Any]]] = [
        ("V1_baseline", {}),
        ("V2_min_abs_dw_004", {"rebalance_min_abs_weight_delta": 0.004}),
        (
            "V3_asym_rank15_maint25",
            {"selection_buffer_asymmetric": True, "rank_in_entry": 15, "rank_maintain": 25},
        ),
        (
            "V4_min_dw004_asym_15_25",
            {
                "rebalance_min_abs_weight_delta": 0.004,
                "selection_buffer_asymmetric": True,
                "rank_in_entry": 15,
                "rank_maintain": 25,
            },
        ),
    ]

    cost_rows: list[tuple[str, float, float]] = [
        ("total_10bps", 5.0, 5.0),
        ("total_5bps", 2.5, 2.5),
    ]

    out: list[dict[str, Any]] = []
    for cost_label, txn_bps, slip_bps in cost_rows:
        for vname, vkw in variants:
            kw = {**base, "transaction_cost_bps": txn_bps, "slippage_bps": slip_bps, **vkw}
            rr = run_research_v1(**kw)
            s = rr["summary"] or {}
            p1, cvar = _tail_metrics(rr)
            out.append(
                {
                    "cost_scenario": cost_label,
                    "txn_bps": txn_bps,
                    "slippage_bps": slip_bps,
                    "variant": vname,
                    "params": vkw,
                    "overlayed_sharpe": float(s.get("overlayed_sharpe") or 0.0),
                    "overlayed_cagr": float(s.get("overlayed_cagr") or 0.0),
                    "max_drawdown": _max_dd([float(x) for x in rr["equity_overlayed"]]),
                    "avg_turnover": float(s.get("avg_turnover") or 0.0),
                    "n_rebalance_executed": int(s.get("n_rebalance_executed") or 0),
                    "worst_day_p1": p1,
                    "cvar_daily_1pct": cvar,
                }
            )

    txt = json.dumps({"v5_engine_root": str(v5b), "prices": str(prices_path), "rows": out}, indent=2)
    if str(args.json_out).strip():
        Path(args.json_out).resolve().parent.mkdir(parents=True, exist_ok=True)
        Path(args.json_out).write_text(txt, encoding="utf-8")

    print("moderado | CAP15 max_eff=1 | bear hyst p40/p65 | fx=0")
    print()
    for cost_label, txn_bps, slip_bps in cost_rows:
        print(f"=== {cost_label} (txn={txn_bps} + slip={slip_bps} bps) ===")
        sub = [x for x in out if x["cost_scenario"] == cost_label]
        sub.sort(key=lambda x: -x["overlayed_sharpe"])
        for row in sub:
            print(
                f"  {row['variant']:<26} Sh={row['overlayed_sharpe']:.4f} "
                f"CAGR={row['overlayed_cagr']*100:.2f}% MDD={row['max_drawdown']*100:.2f}% "
                f"avgTurn={row['avg_turnover']:.4f} n_reb={row['n_rebalance_executed']} "
                f"p1={row['worst_day_p1']*100:.3f}% CVaR1%={row['cvar_daily_1pct']*100:.3f}%"
            )
        print()

    b10 = next(x for x in out if x["variant"] == "V1_baseline" and x["cost_scenario"] == "total_10bps")
    b5 = next(x for x in out if x["variant"] == "V1_baseline" and x["cost_scenario"] == "total_5bps")
    d_sh = b5["overlayed_sharpe"] - b10["overlayed_sharpe"]
    print(f"Delta Sharpe baseline: 5bps - 10bps = {d_sh:+.4f} (V1)")
    v4_10 = next(x for x in out if x["variant"] == "V4_min_dw004_asym_15_25" and x["cost_scenario"] == "total_10bps")
    v4_5 = next(x for x in out if x["variant"] == "V4_min_dw004_asym_15_25" and x["cost_scenario"] == "total_5bps")
    print(f"Delta Sharpe V4: 5bps - 10bps = {v4_5['overlayed_sharpe'] - v4_10['overlayed_sharpe']:+.4f}")
    print(f"Sharpe @5bps best in grid: {max(x['overlayed_sharpe'] for x in out if x['cost_scenario']=='total_5bps'):.4f}")
    print(f"Sharpe @10bps best in grid: {max(x['overlayed_sharpe'] for x in out if x['cost_scenario']=='total_10bps'):.4f}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
