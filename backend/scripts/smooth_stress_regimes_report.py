#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Stress por **regime** (recortes temporais fixos) e **janelas móveis** sobre curvas smooth (freeze V5).

- Regimes pré-definidos: 2008, 2022, ciclo de juros (Fed 2022–2023).
- Janelas móveis: retorno acumulado e max drawdown dentro de cada sub-janela (não é treino/teste
  com parâmetros diferentes — é avaliação da **mesma regra** ao longo do tempo).

Uso (``backend/``)::

    python scripts/smooth_stress_regimes_report.py
    python scripts/smooth_stress_regimes_report.py --json ../tmp_diag/smooth_regimes.json
"""

from __future__ import annotations

import argparse
import json
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

DEFAULT_FREEZE = _REPO / "freeze" / "DECIDE_MODEL_V5_V2_3_SMOOTH" / "model_outputs"

OVERLAY_CURVES = [
    ("moderado_overlay", "model_equity_final_20y_moderado.csv"),
    ("conservador_overlay", "model_equity_final_20y_conservador.csv"),
    ("dinamico_overlay", "model_equity_final_20y_dinamico.csv"),
]

# (id, data_inicio, data_fim) — inclusive nos limites disponíveis na série
REGIMES: list[tuple[str, str, str]] = [
    ("2008_crise_financeira", "2008-01-01", "2008-12-31"),
    ("2022_inflacao_multiativo", "2022-01-01", "2022-12-31"),
    ("2022_2023_juros_altos_Fed", "2022-03-01", "2023-10-31"),
]


def _load_series(csv_path: Path, value_col: str) -> pd.Series:
    df = pd.read_csv(csv_path)
    tcol = str(df.columns[0])
    df[tcol] = pd.to_datetime(df[tcol], errors="coerce")
    df = df.dropna(subset=[tcol]).set_index(tcol).sort_index()
    s = pd.to_numeric(df[value_col], errors="coerce").dropna()
    return s[~s.index.duplicated(keep="last")]


def _slice(s: pd.Series, start: str, end: str) -> pd.Series:
    a = pd.Timestamp(start)
    b = pd.Timestamp(end)
    return s.loc[(s.index >= a) & (s.index <= b)].copy()


def _rolling_window_stats(
    model: pd.Series,
    bench: pd.Series,
    *,
    window: int = 756,
    step: int = 21,
) -> dict[str, Any]:
    """Estatísticas de retorno acumulado do modelo e do benchmark em janelas deslizantes."""
    idx = model.index.intersection(bench.index)
    m = model.loc[idx]
    b = bench.loc[idx]
    n = len(m)
    if n < window + 10:
        return {"error": "serie_curta", "n": n, "window": window}

    mrets: list[float] = []
    brets: list[float] = []
    mdd_m: list[float] = []
    ends: list[str] = []

    for i in range(window, n, step):
        seg_m = m.iloc[i - window : i]
        seg_b = b.iloc[i - window : i]
        if len(seg_m) < window * 0.95:
            continue
        r_m = float(seg_m.iloc[-1] / seg_m.iloc[0] - 1.0)
        r_b = float(seg_b.iloc[-1] / seg_b.iloc[0] - 1.0)
        dd = seg_m / seg_m.cummax() - 1.0
        mrets.append(r_m)
        brets.append(r_b)
        mdd_m.append(float(dd.min()))
        ends.append(seg_m.index[-1].strftime("%Y-%m-%d"))

    def pct(xs: list[float], q: float) -> float:
        if not xs:
            return float("nan")
        return float(np.percentile(np.array(xs, dtype=float), q))

    excess = [x - y for x, y in zip(mrets, brets)]
    return {
        "window_trading_days": window,
        "step_days": step,
        "n_windows": len(mrets),
        "model_window_return_pct": {
            "p10": pct(mrets, 10) * 100,
            "p50": pct(mrets, 50) * 100,
            "p90": pct(mrets, 90) * 100,
        },
        "benchmark_window_return_pct": {
            "p10": pct(brets, 10) * 100,
            "p50": pct(brets, 50) * 100,
            "p90": pct(brets, 90) * 100,
        },
        "excess_window_return_pct": {
            "p10": pct(excess, 10) * 100,
            "p50": pct(excess, 50) * 100,
            "p90": pct(excess, 90) * 100,
        },
        "model_max_dd_in_window_pct": {
            "p10": pct(mdd_m, 10) * 100,
            "p50": pct(mdd_m, 50) * 100,
            "p90": pct(mdd_m, 90) * 100,
        },
        "last_window_end": ends[-1] if ends else None,
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--freeze-dir", type=str, default="")
    ap.add_argument("--json", type=str, default="")
    args = ap.parse_args()

    freeze = Path(args.freeze_dir).resolve() if args.freeze_dir.strip() else DEFAULT_FREEZE
    bench_path = freeze / "benchmark_equity_final_20y.csv"
    if not bench_path.is_file():
        print(f"ERRO: {bench_path}", file=sys.stderr)
        return 2

    bench_full = _load_series(bench_path, "benchmark_equity")

    regime_rows: list[dict[str, Any]] = []
    rolling_by_curve: dict[str, Any] = {}

    for cid, fname in OVERLAY_CURVES:
        mp = freeze / fname
        if not mp.is_file():
            continue
        mfull = _load_series(mp, "model_equity")
        common = mfull.index.intersection(bench_full.index)
        m0 = mfull.loc[common]
        b0 = bench_full.loc[common]

        rolling_by_curve[cid] = _rolling_window_stats(m0, b0, window=756, step=21)

        for rid, s0, s1 in REGIMES:
            ms = _slice(m0, s0, s1)
            bs = _slice(b0, s0, s1)
            if len(ms) < 20:
                regime_rows.append(
                    {
                        "regime_id": rid,
                        "curve_id": cid,
                        "start": s0,
                        "end": s1,
                        "ok": False,
                        "n_days": len(ms),
                        "note": "poucos pontos na intersecao",
                    }
                )
                continue
            mk = _compute_kpis(ms)
            bk = _compute_kpis(bs)
            rk = _relative_kpis(ms, bs)
            row = {
                "regime_id": rid,
                "curve_id": cid,
                "start": s0,
                "end": s1,
                "ok": True,
                "n_days": len(ms),
                "model_cagr": mk["cagr"],
                "benchmark_cagr": bk["cagr"],
                "model_vol": mk["vol"],
                "model_max_drawdown": mk["max_drawdown"],
                "model_sharpe": mk["sharpe"],
                "information_ratio": rk["information_ratio"],
                "beta_vs_benchmark": rk["beta_vs_benchmark"],
            }
            regime_rows.append(row)

    out = {
        "freeze_dir": str(freeze),
        "regimes_defined": [{"id": r[0], "from": r[1], "to": r[2]} for r in REGIMES],
        "regime_table": regime_rows,
        "rolling_756d_step21": rolling_by_curve,
    }

    print(json.dumps(out, indent=2, ensure_ascii=False, default=str))

    if args.json:
        p = Path(args.json)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps(out, indent=2, ensure_ascii=False, default=str), encoding="utf-8")
        print(f"\nWrote {p}", file=sys.stderr)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
