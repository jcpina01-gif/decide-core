# -*- coding: utf-8 -*-

from __future__ import annotations

import os
from pathlib import Path
from typing import Optional, Dict, Any

import numpy as np
import pandas as pd


ENGINE_VERSION = "DECIDE_ENGINE_V2_M1_RAW_LINEAR_SCORES_2026_04_16"


# ============================================================
# PATHS / DATA LOAD
# ============================================================

def _project_root() -> Path:
    """Raiz para resolver freeze/ e data/.

    - Monorepo local: ``.../repo/backend/engine_v2.py`` → raiz do repositório.
    - Imagem Docker (``COPY backend/ /app/``): ``/app/engine_v2.py`` → ``/app``.
    """
    override = os.environ.get("DECIDE_BACKEND_ROOT") or os.environ.get("BACKEND_ROOT")
    if override:
        return Path(override).resolve()

    here = Path(__file__).resolve().parent
    if (here / "data").is_dir() and not (here.parent / "backend" / "data").exists():
        return here
    return here.parent


def _candidate_path(*rels: str) -> Optional[Path]:
    root = _project_root()
    for rel in rels:
        p = root / rel
        if p.exists():
            return p
    return None


def _load_prices_from_disk() -> pd.DataFrame:

    price_path = _candidate_path(
        "freeze/DECIDE_MODEL_V1/data_prices/prices_close_20y_global_index_proxy_from_tws.csv",
        "backend/data/prices_close_20y_global_index_proxy_from_tws.csv",
        "data/prices_close_20y_global_index_proxy_from_tws.csv",
        "backend/data/prices_close.csv",
        "data/prices_close.csv",
    )

    if price_path is None:
        raise FileNotFoundError("prices file not found")

    df = pd.read_csv(price_path)

    first_col = df.columns[0]
    df[first_col] = pd.to_datetime(df[first_col], errors="coerce")

    df = df.rename(columns={first_col: "date"})
    df = df.dropna(subset=["date"])
    df = df.set_index("date")
    df = df.sort_index()

    for c in df.columns:
        df[c] = pd.to_numeric(df[c], errors="coerce")

    df = df.dropna(axis=1, how="all")
    df = df.ffill()

    return df


# ============================================================
# BENCHMARK
# ============================================================

def _make_benchmark_from_prices(prices: pd.DataFrame, benchmark: Optional[str]) -> pd.Series:

    if benchmark and benchmark in prices.columns:
        s = prices[benchmark].ffill().dropna()
        return s / s.iloc[0]

    weights = {
        "SPY": 0.60,
        "VGK": 0.25,
        "EWJ": 0.10,
        "EWC": 0.05,
    }

    available = {k: v for k, v in weights.items() if k in prices.columns}

    aligned = prices[list(available.keys())].ffill().dropna()

    rets = aligned.pct_change().fillna(0)

    bench_ret = 0

    for c, w in available.items():
        bench_ret += rets[c] * w

    bench_eq = (1 + bench_ret).cumprod()

    bench_eq.iloc[0] = 1.0

    return bench_eq


# ============================================================
# SCORE
# ============================================================

def compute_multi_horizon_score(prices_window: pd.DataFrame) -> pd.Series:

    px_now = prices_window.iloc[-1]

    idx_long = max(0, len(prices_window) - 121)
    idx_mid = max(0, len(prices_window) - 61)
    idx_short = max(0, len(prices_window) - 21)

    ret_long = px_now / prices_window.iloc[idx_long] - 1
    ret_mid = px_now / prices_window.iloc[idx_mid] - 1
    ret_short = px_now / prices_window.iloc[idx_short] - 1

    score = (
        0.50 * ret_long
        + 0.30 * ret_mid
        + 0.20 * ret_short
    )

    score = pd.to_numeric(score, errors="coerce")

    score = score.replace([np.inf, -np.inf], np.nan)

    score = score.dropna()

    score = score[score > 0]

    score = score.sort_values(ascending=False)

    return score


# ============================================================
# WEIGHTS
# ============================================================

def _cap_and_normalize(weights: pd.Series, cap: float) -> pd.Series:

    weights = weights.clip(lower=0)

    weights = weights / weights.sum()

    for _ in range(20):

        over = weights[weights > cap]

        if over.empty:
            break

        excess = (over - cap).sum()

        weights.loc[over.index] = cap

        under = weights[weights < cap]

        if under.empty:
            break

        under_total = under.sum()

        weights.loc[under.index] = weights.loc[under.index] + (weights.loc[under.index] / under_total) * excess

    weights = weights / weights.sum()

    return weights.sort_values(ascending=False)


def build_weights(
    scores: pd.Series,
    cap_per_ticker: float = 0.20,
    *,
    linear_score_weights: bool = False,
) -> pd.Series:
    """Pesos a partir de scores (long-only). ``linear_score_weights`` (perfil raw): mais peso nos
    nomes com maior momentum — o ``sqrt`` dilui o #1 vs o CAP15 a 15%, o que podia fazer o «raw»
    parecer mais fraco que o investível."""
    s = pd.to_numeric(scores, errors="coerce").clip(lower=1e-12)
    if linear_score_weights:
        base = s
    else:
        base = np.sqrt(s)
    base = pd.Series(base, index=scores.index)
    base = base / base.sum()
    weights = _cap_and_normalize(base, cap_per_ticker)
    return weights


# ============================================================
# KPI
# ============================================================

def _compute_kpis(equity: pd.Series):

    rets = equity.pct_change().dropna()

    years = (equity.index[-1] - equity.index[0]).days / 365.25

    cagr = equity.iloc[-1] ** (1 / years) - 1

    vol = rets.std() * np.sqrt(252)

    sharpe = (rets.mean() * 252) / vol if vol != 0 else 0

    dd = equity / equity.cummax() - 1

    max_dd = dd.min()

    return {
        "cagr": float(cagr),
        "vol": float(vol),
        "sharpe": float(sharpe),
        "max_drawdown": float(max_dd),
    }


# ============================================================
# PROFILE VOL TARGET
# ============================================================

def _profile_multiplier(profile):

    p = str(profile or "").lower().strip()

    if p == "conservador":
        return 0.75

    if p in ["dinamico", "dinâmico"]:
        return 1.25

    return 1.0


def _profile_uses_benchmark_vol_target(profile) -> bool:
    """Só conservador e dinâmico escalam retornos para um alvo de vol vs benchmark."""
    p = str(profile or "").lower().strip()
    return p == "conservador" or p in ("dinamico", "dinâmico")


def _is_raw_profile(profile: Optional[str]) -> bool:
    """Motor teórico «sem produto»: mesmo top_q que o investível, sem CAP por nome, pesos lineares
    nos scores (vs sqrt no CAP15), sem alvo de vol vs benchmark."""
    p = str(profile or "").lower().strip()
    return p in ("raw", "cru", "theoretical", "teorico", "teórico", "equity_raw")


def _effective_cap_for_profile(profile: Optional[str], cap_per_ticker: float) -> float:
    if _is_raw_profile(profile):
        return 1.0
    return float(cap_per_ticker)


# No perfil ``raw``, clip por ativo no retorno diário antes da soma ponderada (evita um print
# corrupto dominar; ±100% já é extremo para um único dia). Não afecta moderado/conservador/dinâmico.
RAW_ALIGNED_DAILY_CLIP = 1.0


def _align_returns_for_profile(
    profile: Optional[str], aligned: pd.Series
) -> pd.Series:
    if not _is_raw_profile(profile):
        return aligned
    return aligned.clip(lower=-RAW_ALIGNED_DAILY_CLIP, upper=RAW_ALIGNED_DAILY_CLIP)


# ============================================================
# MODEL
# ============================================================

def run_model(
    profile: Optional[str] = None,
    prices: Optional[pd.DataFrame] = None,
    top_q: int = 20,
    cap_per_ticker: float = 0.20,
    benchmark: Optional[str] = None,
    include_series: bool = False,
    lookback: int = 120,
    **kwargs
):

    if prices is None:
        prices = _load_prices_from_disk()

    window = prices.ffill().dropna(how="all")

    scores = compute_multi_horizon_score(window)

    cap_use = _effective_cap_for_profile(profile, cap_per_ticker)
    n_univ = max(1, int(top_q))
    selected = scores.iloc[:n_univ]
    linear_w = _is_raw_profile(profile)

    weights = build_weights(selected, cap_use, linear_score_weights=linear_w)

    selection = []

    for t in weights.index:

        selection.append({
            "ticker": str(t),
            "weight": float(weights[t]),
            "score": float(selected[t]),
        })

    rets = window.pct_change().fillna(0)

    benchmark_curve = _make_benchmark_from_prices(window, benchmark)

    benchmark_rets = benchmark_curve.pct_change().fillna(0)

    min_start = 130

    rebalance_dates = window.resample("ME").last().index

    rebalance_dates = [d for d in rebalance_dates if d in window.index]

    rebalance_set = set(rebalance_dates)

    equity = [1]

    dates = [window.index[min_start]]

    current_weights = pd.Series(dtype=float)

    scale = 1.0

    vol_window = 60

    use_vol_target = _profile_uses_benchmark_vol_target(profile)
    mult = _profile_multiplier(profile) if use_vol_target else 1.0

    for i in range(min_start + 1, len(window)):

        dt = window.index[i]
        prev_dt = window.index[i - 1]

        if prev_dt in rebalance_set:

            hist = window.iloc[:i]

            hist_scores = compute_multi_horizon_score(hist)

            selected_hist = hist_scores.iloc[:n_univ]

            current_weights = build_weights(selected_hist, cap_use, linear_score_weights=linear_w)

            if use_vol_target:

                model_rets = []

                for j in range(i - vol_window, i):

                    if j < 1:
                        continue

                    d = window.index[j]

                    aligned = rets.loc[d, current_weights.index].fillna(0)
                    aligned = _align_returns_for_profile(profile, aligned)

                    model_rets.append((aligned * current_weights).sum())

                model_vol = np.std(model_rets) * np.sqrt(252)

                bench_vol = benchmark_rets.iloc[i - vol_window:i].std() * np.sqrt(252)

                target_vol = bench_vol * mult

                if model_vol > 0:
                    scale = target_vol / model_vol
                else:
                    scale = 1

                scale = np.clip(scale, 0.5, 1.5)
            else:
                # Moderado (e perfis não mapeados): sem escalação de vol para o benchmark.
                scale = 1.0

        if current_weights.empty:
            day_ret = 0
        else:
            aligned = rets.loc[dt, current_weights.index].fillna(0)
            aligned = _align_returns_for_profile(profile, aligned)

            day_ret = (aligned * current_weights).sum()

        day_ret = day_ret * scale

        equity.append(equity[-1] * (1 + day_ret))

        dates.append(dt)

    equity_curve = pd.Series(equity, index=dates)

    benchmark_curve = benchmark_curve.reindex(equity_curve.index).ffill().bfill()
    if benchmark_curve.isna().any():
        benchmark_curve = benchmark_curve.fillna(1.0)

    kpis = _compute_kpis(equity_curve)

    bench_kpis = _compute_kpis(benchmark_curve)

    def _series_date_str(d) -> str:
        if hasattr(d, "strftime"):
            return d.strftime("%Y-%m-%d")
        s = str(d)
        return s[:10] if len(s) >= 10 else s

    result = {
        "ok": True,
        "engine_version": ENGINE_VERSION,
        "selection": selection,
        "weights": weights.to_dict(),
        "kpis": kpis,
        "benchmark_kpis": bench_kpis,
        "as_of_date": str(window.index[-1].date()),
        "series": {
            "dates": [_series_date_str(d) for d in equity_curve.index],
            "equity_overlayed": [float(x) for x in equity_curve.values],
            "benchmark_equity": [float(x) for x in benchmark_curve.values],
        },
    }

    return result