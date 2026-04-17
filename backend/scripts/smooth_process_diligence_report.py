#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Due diligence operacional sobre curvas **smooth** (freeze): janelas móveis, regimes simples,
stress de custo (drag diário equivalente), concentração/turnover a partir de ``weights_by_rebalance``.

Rolling (36m / 60m / 120m em dias de pregão ≈ 252/12 * meses):
  - distribuição (p10/p50/p90) de excesso CAGR vs benchmark na janela
  - IR (``_relative_kpis`` na janela)
  - max drawdown do modelo na janela
  - ``pct_days_cum_excess_negative``: fração de dias em que o rácio normalizado
    (M/M0)/(B/B0) < 1 — «tempo abaixo do benchmark» desde o início da janela

Regimes (descritivos; mediana global do período comum para cortes de vol — ver ``notes`` no JSON):
  - bull/bear: benchmark acima da MA de 200 sessões
  - high/low vol: vol anualizada 63d do benchmark vs mediana da série alinhada
  - high/low «rates proxy»: nível TBILL_PROXY vs MA 252d (caixa curta; requer ``prices_close``)

Custo: multiplicador diário ``(1+r)*(1 - bps/1e4/252) - 1`` sobre retornos do **modelo** apenas (custos
à carteira, não ao índice).

Uso (a partir de ``backend/``)::

    python scripts/smooth_process_diligence_report.py
    python scripts/smooth_process_diligence_report.py --json-out ../tmp_diag/diligence.json
    python scripts/smooth_process_diligence_report.py --cost-bps-extra 0 10 20 --step 21
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path
from typing import Any, Iterable

import numpy as np
import pandas as pd

_BACKEND = Path(__file__).resolve().parent.parent
_REPO = _BACKEND.parent
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))

from engine_v2 import _compute_kpis, _relative_kpis  # noqa: E402

DEFAULT_FREEZE = _REPO / "freeze" / "DECIDE_MODEL_V5_V2_3_SMOOTH" / "model_outputs"
DEFAULT_PRICES = _BACKEND / "data" / "prices_close.csv"

OVERLAY_CURVES: list[tuple[str, str]] = [
    ("moderado_overlay", "model_equity_final_20y_moderado.csv"),
    ("conservador_overlay", "model_equity_final_20y_conservador.csv"),
    ("dinamico_overlay", "model_equity_final_20y_dinamico.csv"),
]

ALL_CURVES: list[tuple[str, str]] = OVERLAY_CURVES + [
    ("theoretical_raw", "model_equity_theoretical_20y.csv"),
    ("overlay_default", "model_equity_final_20y.csv"),
    ("moderado_margin", "model_equity_final_20y_moderado_margin.csv"),
    ("dinamico_margin", "model_equity_final_20y_dinamico_margin.csv"),
    ("conservador_margin", "model_equity_final_20y_conservador_margin.csv"),
    ("margin_levered", "model_equity_final_20y_margin.csv"),
]

# Meses → dias de pregão (convenção 252 d/ano)
MONTHS_TO_TD = lambda m: max(120, int(round(m / 12.0 * 252)))


def _load_series(csv_path: Path, value_col: str) -> pd.Series:
    df = pd.read_csv(csv_path)
    tcol = str(df.columns[0])
    df[tcol] = pd.to_datetime(df[tcol], errors="coerce")
    df = df.dropna(subset=[tcol]).set_index(tcol).sort_index()
    s = pd.to_numeric(df[value_col], errors="coerce").dropna()
    return s[~s.index.duplicated(keep="last")]


def _pctiles(xs: list[float], qs: tuple[float, ...] = (10, 50, 90)) -> dict[str, float]:
    arr = np.array([x for x in xs if x == x and math.isfinite(x)], dtype=float)
    if arr.size == 0:
        return {f"p{int(q)}": float("nan") for q in qs}
    return {f"p{int(q)}": float(np.percentile(arr, q)) for q in qs}


def _apply_flat_annual_cost_bps(eq: pd.Series, bps_annual: float) -> pd.Series:
    """Drag diário constante em cima dos retornos do modelo (reconstrói níveis)."""
    if bps_annual <= 0:
        return eq.copy()
    daily = bps_annual / 10000.0 / 252.0
    r = eq.pct_change().fillna(0.0)
    adj = (1.0 + r) * (1.0 - daily) - 1.0
    out = (1.0 + adj).cumprod()
    out *= float(eq.iloc[0])
    out.index = eq.index
    return out


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
    irs: list[float] = []
    mdds: list[float] = []
    pct_cum_neg: list[float] = []

    for i in range(window_td, n, step):
        sm = m.iloc[i - window_td : i]
        sb = b.iloc[i - window_td : i]
        if len(sm) < int(window_td * 0.95):
            continue
        mk = _compute_kpis(sm)
        rk = _relative_kpis(sm, sb)
        mdds.append(float(mk.get("max_drawdown", float("nan"))))
        irs.append(float(rk.get("information_ratio", float("nan"))))
        excess_cagr.append(float(rk.get("excess_cagr_vs_benchmark", float("nan"))))

        m0, b0 = float(sm.iloc[0]), float(sb.iloc[0])
        if m0 > 0 and b0 > 0:
            rm = sm / m0
            rb = sb / b0
            pct_cum_neg.append(float((rm < rb).mean() * 100.0))
        else:
            pct_cum_neg.append(float("nan"))

    return {
        "window_trading_days": window_td,
        "step_days": step,
        "n_windows": len(excess_cagr),
        "excess_cagr": _pctiles(excess_cagr),
        "information_ratio": _pctiles(irs),
        "model_max_drawdown": _pctiles(mdds),
        "pct_days_cum_excess_negative": _pctiles(pct_cum_neg),
    }


def _load_tbill_series_fixed(prices_csv: Path) -> pd.Series | None:
    if not prices_csv.is_file():
        return None
    df = pd.read_csv(prices_csv, usecols=["date", "TBILL_PROXY"], low_memory=False)
    df["date"] = pd.to_datetime(df["date"], errors="coerce")
    df["TBILL_PROXY"] = pd.to_numeric(df["TBILL_PROXY"], errors="coerce")
    df = df.dropna(subset=["date", "TBILL_PROXY"]).set_index("date").sort_index()
    s = df["TBILL_PROXY"].astype(float)
    return s[~s.index.duplicated(keep="last")]


def _regime_decomposition(
    model: pd.Series,
    bench: pd.Series,
    tbill: pd.Series | None,
) -> dict[str, Any]:
    idx = model.index.intersection(bench.index)
    m = model.loc[idx].astype(float)
    b = bench.loc[idx].astype(float)
    r_m = m.pct_change()
    r_b = b.pct_change()
    al = pd.DataFrame({"r_m": r_m, "r_b": r_b}).dropna()
    if len(al) < 120:
        return {"error": "serie_curta"}

    b_al = b.reindex(al.index)
    ma200 = b_al.rolling(200, min_periods=60).mean()
    bull = (b_al > ma200).reindex(al.index)

    bv = b_al.pct_change().rolling(63, min_periods=20).std() * math.sqrt(252.0)
    vol_med = float(bv.median())
    high_vol = (bv > vol_med).reindex(al.index)

    rate_high: pd.Series | None = None
    if tbill is not None:
        tb = tbill.reindex(al.index).ffill()
        ma252 = tb.rolling(252, min_periods=60).mean()
        rate_high = (tb > ma252).reindex(al.index)

    def cell(mask: pd.Series) -> dict[str, float]:
        mm = mask.fillna(False) & al["r_m"].notna()
        if int(mm.sum()) < 30:
            return {"n_days": int(mm.sum())}
        xs = (al.loc[mm, "r_m"] - al.loc[mm, "r_b"]).astype(float)
        mu = float(xs.mean() * 252.0)
        te = float(xs.std(ddof=0) * math.sqrt(252.0))
        ir = float(mu / te) if te > 1e-12 else float("nan")
        hit = float((al.loc[mm, "r_m"] > al.loc[mm, "r_b"]).mean() * 100.0)
        return {
            "n_days": int(mm.sum()),
            "excess_return_annualized_from_daily_mean": mu,
            "excess_information_ratio": ir,
            "pct_days_model_beats_benchmark": hit,
        }

    out: dict[str, Any] = {
        "bull": cell(bull == True),
        "bear": cell(bull == False),
        "bench_high_vol": cell(high_vol == True),
        "bench_low_vol": cell(high_vol == False),
    }
    if rate_high is not None:
        out["tbill_proxy_high_vs_ma252"] = cell(rate_high == True)
        out["tbill_proxy_low_vs_ma252"] = cell(rate_high == False)
    else:
        out["tbill_proxy_high_vs_ma252"] = {"n_days": 0, "note": "TBILL_PROXY indisponível"}
        out["tbill_proxy_low_vs_ma252"] = {"n_days": 0, "note": "TBILL_PROXY indisponível"}

    # 2x2 bull x vol
    out["bull_high_vol"] = cell((bull == True) & (high_vol == True))
    out["bull_low_vol"] = cell((bull == True) & (high_vol == False))
    out["bear_high_vol"] = cell((bull == False) & (high_vol == True))
    out["bear_low_vol"] = cell((bull == False) & (high_vol == False))
    return out


def _weights_concentration(weights_csv: Path) -> dict[str, Any]:
    if not weights_csv.is_file():
        return {"error": "missing_weights_csv", "path": str(weights_csv)}
    df = pd.read_csv(weights_csv)
    if "rebalance_date" not in df.columns or "final_weight" not in df.columns:
        return {"error": "unexpected_columns"}

    rows: list[dict[str, float]] = []
    for d, g in df.groupby("rebalance_date"):
        w = pd.to_numeric(g["final_weight"], errors="coerce").dropna()
        w = w[w > 0]
        if w.empty:
            continue
        s = float(w.sum())
        if s <= 0:
            continue
        wn = (w / s).astype(float)
        hhi = float((wn**2).sum())
        n_eff = float(1.0 / hhi) if hhi > 1e-18 else float("nan")
        top5 = float(wn.nlargest(5).sum())
        tv = g["turnover"].dropna() if "turnover" in g.columns else pd.Series(dtype=float)
        to = float(tv.iloc[0]) if len(tv) else float("nan")
        rows.append({"hhi": hhi, "n_effective": n_eff, "top5_weight": top5, "turnover": to})

    if not rows:
        return {"error": "no_rows"}
    rdf = pd.DataFrame(rows)
    return {
        "n_rebalances": int(len(rdf)),
        "turnover_per_rebalance": {
            "mean": float(rdf["turnover"].mean()),
            "p50": float(rdf["turnover"].median()),
            "p90": float(rdf["turnover"].quantile(0.9)),
        },
        "herfindahl_final_weights": {
            "mean": float(rdf["hhi"].mean()),
            "p90": float(rdf["hhi"].quantile(0.9)),
        },
        "n_effective_weights": {
            "mean": float(rdf["n_effective"].mean()),
            "p10": float(rdf["n_effective"].quantile(0.1)),
        },
        "top5_weight_share": {
            "mean": float(rdf["top5_weight"].mean()),
            "p90": float(rdf["top5_weight"].quantile(0.9)),
        },
    }


def _cost_table(model: pd.Series, bench: pd.Series, bps_list: Iterable[float]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for bps in bps_list:
        adj = _apply_flat_annual_cost_bps(model, float(bps))
        idx = adj.index.intersection(bench.index)
        am = adj.loc[idx]
        ab = bench.loc[idx]
        mk = _compute_kpis(am)
        rk = _relative_kpis(am, ab)
        key = str(int(bps)) if bps == int(bps) else str(bps)
        out[key] = {
            "extra_annual_cost_bps": float(bps),
            "model_cagr": mk.get("cagr"),
            "model_vol": mk.get("vol"),
            "model_sharpe": mk.get("sharpe"),
            "model_max_drawdown": mk.get("max_drawdown"),
            "relative_excess_cagr_vs_benchmark": rk.get("excess_cagr_vs_benchmark"),
            "relative_information_ratio": rk.get("information_ratio"),
            "relative_tracking_error_annual": rk.get("tracking_error_annual"),
        }
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description="Due diligence: rolling, regimes, custos, concentração")
    ap.add_argument("--freeze-dir", type=str, default="")
    ap.add_argument("--prices-csv", type=str, default="", help="Para TBILL_PROXY (regime «rates» proxy)")
    ap.add_argument("--json-out", type=str, default="")
    ap.add_argument("--step", type=int, default=21, help="Passo entre janelas móveis (dias de pregão)")
    ap.add_argument("--all-curves", action="store_true", help="Incluir margem/teórico/default (não só overlays)")
    ap.add_argument(
        "--cost-bps-extra",
        type=float,
        nargs="*",
        default=[0.0, 10.0, 20.0],
        help="Drag anual extra em bps aplicado só ao modelo (0 = baseline freeze)",
    )
    args = ap.parse_args()

    freeze = Path(args.freeze_dir).resolve() if str(args.freeze_dir).strip() else DEFAULT_FREEZE
    prices_csv = Path(args.prices_csv).resolve() if str(args.prices_csv).strip() else DEFAULT_PRICES
    bench_path = freeze / "benchmark_equity_final_20y.csv"
    if not bench_path.is_file():
        print(f"ERRO: {bench_path}", file=sys.stderr)
        return 2

    curves = ALL_CURVES if args.all_curves else OVERLAY_CURVES
    bench_full = _load_series(bench_path, "benchmark_equity")
    tbill = _load_tbill_series_fixed(prices_csv)

    rolling_months = (36, 60, 120)
    rolling: dict[str, Any] = {}
    regimes: dict[str, Any] = {}
    cost_stress: dict[str, Any] = {}

    for cid, fname in curves:
        mp = freeze / fname
        if not mp.is_file():
            continue
        mfull = _load_series(mp, "model_equity")
        common = mfull.index.intersection(bench_full.index)
        m0 = mfull.loc[common]
        b0 = bench_full.loc[common]

        rolling[cid] = {}
        for mo in rolling_months:
            wtd = MONTHS_TO_TD(mo)
            rolling[cid][f"{mo}m"] = _rolling_panel(m0, b0, window_td=wtd, step=int(args.step))

        regimes[cid] = _regime_decomposition(m0, b0, tbill)
        cost_stress[cid] = _cost_table(m0, b0, args.cost_bps_extra)

    wpath = freeze / "weights_by_rebalance.csv"
    weights_summary = _weights_concentration(wpath)

    payload: dict[str, Any] = {
        "freeze_dir": str(freeze),
        "prices_csv_used": str(prices_csv) if prices_csv.is_file() else None,
        "rolling_windows_months": list(rolling_months),
        "rolling_trading_days": {f"{m}m": MONTHS_TO_TD(m) for m in rolling_months},
        "step_days": int(args.step),
        "notes": [
            "Cortes bull/bear e high/low vol usam mediana da vol 63d do benchmark **no período comum** "
            "(rótulo descritivo, não teste causal).",
            "TBILL_PROXY acima da MA252: proxy de contexto de caixa curta, não taxa de juro nominal literal.",
            "pct_days_cum_excess_negative: dentro de cada janela móvel, % de dias com (M/M0)/(B/B0) < 1.",
            "Custo extra: drag diário constante sobre retornos do modelo; benchmark inalterado.",
        ],
        "rolling": rolling,
        "regime_decomposition": regimes,
        "cost_stress_bps": cost_stress,
        "weights_concentration": weights_summary,
    }

    txt = json.dumps(payload, ensure_ascii=False, indent=2)
    if args.json_out.strip():
        outp = Path(args.json_out).resolve()
        outp.parent.mkdir(parents=True, exist_ok=True)
        outp.write_text(txt, encoding="utf-8")
        print(f"JSON -> {outp}")
    else:
        print(txt)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
