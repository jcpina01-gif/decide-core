from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Tuple, Any

import csv
import json
import math
import os
import numpy as np
import pandas as pd


# ============================================================
# CONFIG
# ============================================================

# When this file lives in backend/, ROOT = backend so data paths resolve correctly
ROOT = Path(__file__).resolve().parent
DATA_CANDIDATES = [
    ROOT / "data" / "prices_close.csv",
    ROOT / "data" / "prices_close_15y_from_tws.csv",
    ROOT.parent / "backend" / "data" / "prices_close.csv",
    ROOT.parent / "backend" / "data" / "prices_close_15y_from_tws.csv",
]

# Bench: 60% US, 25% EU, 10% JP, 5% CAN
BENCHMARK_WEIGHTS = {
    "SPY": 0.60,
    "VGK": 0.25,
    "EWJ": 0.10,
    "EWC": 0.05,
}

# Tolerância sobre o peso setorial do benchmark: cada sector pode ir até bench_weight * (1 + SECTOR_TOLERANCE)
SECTOR_TOLERANCE = 0.10
# Cap mínimo por sector quando o bench dá 0 (ex.: sector só em zone OTHER) — evita sector "esquecido"
SECTOR_MIN_CAP = 0.10
# Tecto absoluto por sector: nenhum sector pode exceder este peso (evita um sector dominar)
SECTOR_ABS_MAX = 0.35
# Technology: cap explícito 30% × (1 + 10%) = 33%
TECHNOLOGY_CAP = 0.33


# Fallback: tickers Technology (v3 + global) para cap quando CSV falha ou não existe
_TECH_TICKERS_FALLBACK = frozenset({
    "AAPL", "ADBE", "ADI", "AMD", "AMAT", "ASML", "AVGO", "CDNS", "CHKP", "CRWD", "CSCO", "CTSH",
    "DDOG", "DOCU", "FISV", "INTC", "INTU", "KLAC", "LRCX", "MU", "NICE", "STM", "TOELY", "WIX",
})


def _technology_tickers_set() -> set:
    """Tickers Technology: global_enriched + v3 (igual ao KPI server). Fallback se CSV falhar."""
    out = set()
    for path in (
        ROOT / "data" / "company_meta_global_enriched.csv",
        ROOT / "data" / "company_meta_v3.csv",
    ):
        if not path.exists():
            continue
        try:
            df = pd.read_csv(path)
            df.columns = [str(c).strip().lower() for c in df.columns]
            if "ticker" not in df.columns or "sector" not in df.columns:
                continue
            mask = df["sector"].fillna("").astype(str).str.strip().str.lower() == "technology"
            for t in df.loc[mask, "ticker"].dropna().astype(str).str.strip().str.upper():
                out.add(t)
        except Exception:
            pass
    return out if out else set(_TECH_TICKERS_FALLBACK)

PROFILE_TARGET_VOL_MULTIPLIER = {
    "conservador": 0.75,
    "moderado": 1.00,
    "dinamico": 1.25,
    "dinâmico": 1.25,
}

TRADING_DAYS = 252

# Mesma convenção que kpi_server.py: Sharpe clássico em retornos diários; rf anual (linear → diário).
try:
    RISK_FREE_ANNUAL = float(os.environ.get("DECIDE_KPI_RISK_FREE_ANNUAL", "0"))
except ValueError:
    RISK_FREE_ANNUAL = 0.0


@dataclass
class ResearchConfig:
    # Universe / selection
    top_q: int = 20
    rank_in: int = 15
    rank_out: int = 25
    # V2.1 — buffer assimétrico (menos reactivo): novo nome só se rank <= rank_in_entry;
    # nome já em carteira mantém-se se rank <= rank_maintain; sai se rank > rank_maintain.
    # Se False, usa-se a regra clássica rank_in / rank_out em todo o lado.
    selection_buffer_asymmetric: bool = False
    rank_in_entry: int = 10
    rank_maintain: int = 15
    monthly_rebalance_only: bool = True
    monthly_rebalance_turnover_threshold: float = 0.20
    # V2.2 — cortar micro-rotação: mesmo com turnover potencial alto, não executar se
    # |Δw| máximo < limiar e a linha de nomes (entradas/saídas) não mudou.
    rebalance_min_abs_weight_delta: float | None = None

    # Rebalance extraordinário (só com monthly_rebalance_only=True): fora de fim de mês,
    # avalia e pode trocar se turnover >= extraordinary_rebalance_turnover_threshold,
    # quando se verificam gatilhos. Recomendado: modelo (scores) + só grandes mudanças.
    extraordinary_rebalance_enabled: bool = False
    # --- Gatilhos no próprio modelo (convex_score no universo) — “grandes mudanças” ---
    extraordinary_model_lookback_days: int = 5
    # Limiar no quantil dos |score(t) − score(t−N)| (quantil em extraordinary_model_abs_score_delta_quantile, default P90)
    extraordinary_model_p90_abs_score_delta_min: float | None = None
    # Quantil em [0,1]: 0.9 = P90, 0.8 = P80, 0.7 = P70 (comparar gatilhos mais/menos sensíveis)
    extraordinary_model_abs_score_delta_quantile: float = 0.90
    # Opcional: média dos |Δscore| acima disto (mais sensível que p90)
    extraordinary_model_mean_abs_score_delta_min: float | None = None
    extraordinary_model_min_names_for_delta: int = 20
    # --- Opcional: benchmark (legado; None = desligado) ---
    extraordinary_benchmark_lookback_days: int = 5
    extraordinary_benchmark_cumret_max: float | None = None
    extraordinary_benchmark_cumret_min: float | None = None
    # Breadth = fração de tickers com score >= score_threshold; abaixo disto → stress (também modelo)
    extraordinary_breadth_below: float | None = None
    # Limiar de turnover para executar o extraordinário (grandes mudanças → usar >= ao mensal p.ex. 0.22)
    extraordinary_rebalance_turnover_threshold: float = 0.22
    # Máximo de rebalances extraordinários executados por ano civil (None = sem limite)
    extraordinary_max_per_calendar_year: int | None = None

    # Momentum spec
    lookback_120_days: int = 120
    lookback_60_days: int = 60
    lookback_20_days: int = 20
    mom_120_weight: float = 0.50
    mom_60_weight: float = 0.50
    mom_20_weight: float = 0.00
    # V2.3 — horizontes ~3m/6m/12m (dias úteis); momentum_mode escolhe a fórmula.
    lookback_63_days: int = 63
    lookback_126_days: int = 126
    lookback_252_days: int = 252
    # default | v2_smooth (40/35/25 em 63/126/252) | v2_prudent (50/50 em 126/252)
    momentum_mode: str = "default"
    # Opcional: winsorizar retornos momentum por linha (q e 1−q) antes do convex score.
    momentum_winsorize_quantile: float | None = None
    convex_power: float = 2.0
    score_threshold: float = 0.03

    # Weights / costs
    cap_per_ticker: float = 0.20
    transaction_cost_bps: float = 5.0
    # Slippage + FX: somados ao txn bps sobre |Δw_efectivo| (ver compute_raw_portfolio_returns).
    # Default slippage > 0 para o backtest não depender só de flags CLI (CAGR reflecte fricção típica).
    slippage_bps: float = 5.0
    fx_conversion_bps: float = 0.0

    # Breadth overlay
    breadth_min: float = 0.60
    breadth_max: float = 1.30

    # Trend regime filter
    benchmark_ma_window: int = 200
    risk_off_exposure: float = 0.50
    risk_on_exposure: float = 1.10

    # Vol-spike regime (optional)
    vol_spike_enabled: bool = False
    vol_spike_short_window: int = 20
    vol_spike_long_window: int = 126
    vol_spike_ratio_threshold: float = 1.50  # short_vol / long_vol
    vol_spike_exposure: float = 0.70

    # Drawdown trigger (optional; evaluated on benchmark equity)
    drawdown_enabled: bool = False
    drawdown_threshold_1: float = -0.12
    drawdown_exposure_1: float = 0.85
    drawdown_threshold_2: float = -0.20
    drawdown_exposure_2: float = 0.70

    # Vol targeting
    vol_target_window: int = 126
    vol_scale_floor: float = 0.75
    vol_scale_cap: float = 1.50
    overlay_target_vol_realization_boost: float = 1.00

    # Bear + baixa vol (benchmark): reduz exposição à perna arriscada vs overlay base.
    # «Baixa vol» = vol realizada anualizada (janela bench) abaixo da mediana expansiva passada
    # (sem lookahead: mediana até t−1 vs vol em t). Só actua em RISK_OFF (preço bench < MA).
    # Por defeito **ligado** (pedido de produto); desligar com bear_low_vol_overlay_enabled=False.
    bear_low_vol_overlay_enabled: bool = True
    bear_low_vol_bench_vol_window: int = 63
    bear_low_vol_exposure_mult: float = 0.85
    # Modo escalonado: «bear» = preço bench < MA252; mult conforme vol 63d vs quantis expansivos
    # passados (p20/p40/p50). Se False, mantém a regra simples (RISK_OFF do trend + vol < mediana).
    bear_low_vol_tiered: bool = False
    bear_low_vol_bear_ma_window: int = 252
    bear_low_vol_quantile_min_periods: int = 252
    # Histerese (prioridade sobre tiered/simples se True): entra com bear (MA252) + vol < p30
    # expansivo; só sai com (não bear) OU vol > p55 durante N dias seguidos.
    bear_low_vol_hysteresis: bool = False
    bear_low_vol_hysteresis_entry_quantile: float = 0.30
    bear_low_vol_hysteresis_exit_quantile: float = 0.55
    bear_low_vol_hysteresis_exit_consecutive_days: int = 10
    bear_low_vol_hysteresis_bear_ma_window: int = 252

    profile: str = "moderado"
    # Constraints (optional)
    constrain_us_to_benchmark: bool = False
    constrain_sectors_to_benchmark: bool = False
    us_target_weight: float = 0.60
    us_tolerance: float = 0.05
    sector_tolerance: float = 0.05
    # Optional explicit sector caps (approx. benchmark sector weights)
    sector_cap_overrides: Dict[str, float] | None = None
    # Trial feature flags (default off): concentration controls by sector/cluster.
    sector_cluster_cap_enabled: bool = False
    sector_cap: float = 0.35
    cluster_cap: float = 0.30
    cluster_map_path: str = str(ROOT / "data" / "sector_cluster_map.json")
    # Trial crash overlay: robust 2-of-3 defensive state machine.
    crash_overlay_2of3_enabled: bool = False
    crash_breadth_threshold: float = 0.40
    crash_dd_window: int = 60
    crash_dd_threshold: float = -0.08
    crash_exposure_2_signals: float = 0.70
    crash_exposure_3_signals: float = 0.55
    crash_exit_consecutive_days: int = 10


# ============================================================
# IO
# ============================================================

def find_prices_file() -> Path:
    for candidate in DATA_CANDIDATES:
        if candidate.exists():
            return candidate
    searched = "\n".join(str(x) for x in DATA_CANDIDATES)
    raise FileNotFoundError("Não encontrei ficheiro de preços. Procurei em:\n" + searched)


def load_prices(path: Path | None = None) -> pd.DataFrame:
    csv_path = path or find_prices_file()
    df = pd.read_csv(csv_path)

    df.rename(columns={df.columns[0]: "Date"}, inplace=True)
    df["Date"] = pd.to_datetime(df["Date"], errors="coerce")
    df = df.dropna(subset=["Date"]).copy()
    df = df.sort_values("Date").set_index("Date")

    for col in df.columns:
        df[col] = pd.to_numeric(df[col], errors="coerce")

    df = df.dropna(axis=1, how="all")
    df = df.ffill()

    missing_benchmark = [t for t in BENCHMARK_WEIGHTS if t not in df.columns]
    if missing_benchmark:
        raise ValueError(f"Faltam tickers do benchmark no dataset: {missing_benchmark}")

    return df


# ============================================================
# HELPERS
# ============================================================

def compute_returns(prices: pd.DataFrame) -> pd.DataFrame:
    return prices.pct_change().replace([np.inf, -np.inf], np.nan).fillna(0.0)


def compute_benchmark_returns(returns: pd.DataFrame) -> pd.Series:
    bench = pd.Series(0.0, index=returns.index, dtype=float)
    for ticker, weight in BENCHMARK_WEIGHTS.items():
        bench = bench.add(returns[ticker].fillna(0.0) * weight, fill_value=0.0)
    return bench


def compute_benchmark_price(prices: pd.DataFrame) -> pd.Series:
    bench = pd.Series(0.0, index=prices.index, dtype=float)
    for ticker, weight in BENCHMARK_WEIGHTS.items():
        bench = bench.add(prices[ticker].ffill() * weight, fill_value=0.0)
    return bench


def compute_equity_curve(returns: pd.Series, start_value: float = 1.0) -> pd.Series:
    return (1.0 + returns.fillna(0.0)).cumprod() * start_value


def annualized_return(daily_returns: pd.Series) -> float:
    daily_returns = daily_returns.dropna()
    if len(daily_returns) < 2:
        return 0.0
    total = float((1.0 + daily_returns).prod())
    years = len(daily_returns) / TRADING_DAYS
    if years <= 0 or total <= 0:
        return 0.0
    return total ** (1.0 / years) - 1.0


def annualized_vol(daily_returns: pd.Series) -> float:
    """Vol anualizada a partir de retornos diários (desvio-padrão amostral, ddof=1), ×√252 — alinhado com kpi_server."""
    daily_returns = daily_returns.dropna()
    if len(daily_returns) < 2:
        return 0.0
    return float(daily_returns.std(ddof=1) * math.sqrt(TRADING_DAYS))


def sharpe_ratio(
    daily_returns: pd.Series,
    *,
    risk_free_annual: float | None = None,
) -> float:
    """
    Sharpe anualizado (definição usual, alinhada com kpi_server.compute_sharpe_ratio):
    média(retorno_diário − rf_dia) / std(amostral dos excessos) × √252.
    rf_dia ≈ rf_anual / 252. Override opcional em risk_free_annual; senão usa RISK_FREE_ANNUAL (env DECIDE_KPI_RISK_FREE_ANNUAL).
    """
    rf_annual = RISK_FREE_ANNUAL if risk_free_annual is None else float(risk_free_annual)
    r = pd.Series(daily_returns, dtype=float).dropna()
    if len(r) < 2:
        return float("nan")
    rf_daily = rf_annual / float(TRADING_DAYS)
    excess = r - rf_daily
    mu = float(excess.mean())
    sigma = float(excess.std(ddof=1))
    if sigma <= 1e-12 or not np.isfinite(sigma):
        return float("nan")
    return float(mu / sigma * math.sqrt(float(TRADING_DAYS)))


def max_drawdown_from_equity(equity: pd.Series) -> float:
    equity = equity.dropna()
    if len(equity) == 0:
        return 0.0
    running_peak = equity.cummax()
    dd = equity / running_peak - 1.0
    return float(dd.min())


def is_month_end(index: pd.DatetimeIndex) -> pd.Series:
    months = pd.Series(index.month, index=index)
    next_months = months.shift(-1)
    flags = months != next_months
    flags.iloc[-1] = True
    return flags.astype(bool)


def compute_drawdown(equity: pd.Series, window: int) -> pd.Series:
    rolling_peak = equity.rolling(window, min_periods=1).max()
    return equity / rolling_peak - 1.0


def _make_kpis_from_returns_and_equity(daily_returns: pd.Series, equity: pd.Series) -> Dict[str, float]:
    return {
        "cagr": float(annualized_return(daily_returns)),
        "vol": float(annualized_vol(daily_returns)),
        "sharpe": float(sharpe_ratio(daily_returns)),
        "max_drawdown": float(max_drawdown_from_equity(equity)),
        "total_return": float((1.0 + daily_returns.fillna(0.0)).prod() - 1.0),
    }


# ============================================================
# MOMENTUM / SCORING
# ============================================================

def _winsorize_momentum_rowwise(score: pd.DataFrame, q: float) -> pd.DataFrame:
    """Por data, limita cada célula ao intervalo [quantile(q), quantile(1−q)] nos nomes."""
    if q <= 0.0 or q >= 0.5 or score.empty:
        return score
    out = score.copy().astype(float)
    lo = out.quantile(q, axis=1)
    hi = out.quantile(1.0 - q, axis=1)
    for idx in out.index:
        try:
            a = float(lo.loc[idx])
            b = float(hi.loc[idx])
            if np.isfinite(a) and np.isfinite(b) and a < b:
                out.loc[idx] = out.loc[idx].clip(lower=a, upper=b)
        except Exception:
            continue
    return out


def compute_multi_horizon_momentum(prices: pd.DataFrame, config: ResearchConfig) -> pd.DataFrame:
    mode = str(getattr(config, "momentum_mode", "default") or "default").strip().lower()
    if mode == "v2_smooth":
        m63 = prices / prices.shift(int(config.lookback_63_days)) - 1.0
        m126 = prices / prices.shift(int(config.lookback_126_days)) - 1.0
        m252 = prices / prices.shift(int(config.lookback_252_days)) - 1.0
        score = 0.40 * m63 + 0.35 * m126 + 0.25 * m252
    elif mode == "v2_prudent":
        m126 = prices / prices.shift(int(config.lookback_126_days)) - 1.0
        m252 = prices / prices.shift(int(config.lookback_252_days)) - 1.0
        score = 0.50 * m126 + 0.50 * m252
    else:
        mom_120 = prices / prices.shift(config.lookback_120_days) - 1.0
        mom_60 = prices / prices.shift(config.lookback_60_days) - 1.0
        mom_20 = prices / prices.shift(config.lookback_20_days) - 1.0
        score = (
            config.mom_120_weight * mom_120
            + config.mom_60_weight * mom_60
            + config.mom_20_weight * mom_20
        )
    score = score.replace([np.inf, -np.inf], np.nan)
    wq = getattr(config, "momentum_winsorize_quantile", None)
    if wq is not None:
        try:
            wqf = float(wq)
            if 0.0 < wqf < 0.5:
                score = _winsorize_momentum_rowwise(score, wqf)
        except (TypeError, ValueError):
            pass
    return score


def _standardize_signal_matrix(signal: pd.DataFrame) -> pd.DataFrame:
    out = signal.copy().astype(float)
    out = out.replace([np.inf, -np.inf], np.nan).fillna(0.0)
    if out.empty:
        return out

    row_mean = out.mean(axis=1)
    row_std = out.std(axis=1, ddof=0).replace(0.0, np.nan)
    out = out.sub(row_mean, axis=0)
    out = out.div(row_std, axis=0).fillna(0.0)
    return out


def _rowwise_rank_score(signal: pd.DataFrame) -> pd.DataFrame:
    out = signal.copy().astype(float)
    out = out.replace([np.inf, -np.inf], np.nan)
    if out.empty:
        return out

    ranked = out.rank(axis=1, pct=True, method="average")
    ranked = ranked.mul(2.0).sub(1.0)
    return ranked.replace([np.inf, -np.inf], np.nan).fillna(0.0)


def _load_external_alpha_matrix(
    external_alpha_path: str | Path | None,
    index: pd.Index,
    columns: List[str],
) -> pd.DataFrame | None:
    if external_alpha_path is None:
        return None

    path = Path(external_alpha_path)
    if not path.exists():
        return None

    df = pd.read_csv(path)
    if df.empty:
        return None

    df.columns = [str(c).strip() for c in df.columns]
    lower_cols = {str(c).strip().lower(): c for c in df.columns}

    if {"date", "ticker"}.issubset(lower_cols.keys()):
        date_col = lower_cols["date"]
        ticker_col = lower_cols["ticker"]
        value_col = None
        for candidate in ("signal", "score", "alpha", "value", "weight"):
            if candidate in lower_cols:
                value_col = lower_cols[candidate]
                break
        if value_col is None:
            numeric_cols = [
                c for c in df.columns
                if c not in (date_col, ticker_col) and pd.api.types.is_numeric_dtype(df[c])
            ]
            if not numeric_cols:
                return None
            value_col = numeric_cols[0]

        df[date_col] = pd.to_datetime(df[date_col], errors="coerce")
        df[ticker_col] = df[ticker_col].astype(str).str.upper().str.strip()
        df[value_col] = pd.to_numeric(df[value_col], errors="coerce")
        df = df.dropna(subset=[date_col, ticker_col, value_col]).copy()
        mat = df.pivot_table(index=date_col, columns=ticker_col, values=value_col, aggfunc="mean")
    else:
        date_col = df.columns[0]
        df[date_col] = pd.to_datetime(df[date_col], errors="coerce")
        df = df.dropna(subset=[date_col]).copy()
        mat = df.set_index(date_col)

    mat.index = pd.to_datetime(mat.index, errors="coerce")
    mat = mat[~mat.index.isna()].sort_index()
    mat.columns = [str(c).strip().upper() for c in mat.columns]
    mat = mat.reindex(index=pd.DatetimeIndex(index), columns=columns)
    mat = mat.apply(pd.to_numeric, errors="coerce").fillna(0.0)
    mat = _standardize_signal_matrix(mat)
    return mat


def apply_convex_score(raw_score: pd.DataFrame, config: ResearchConfig) -> pd.DataFrame:
    score = raw_score.copy()
    score = score.where(score >= config.score_threshold, other=np.nan)
    score = score.clip(lower=0.0) ** config.convex_power
    return score


# ============================================================
# PORTFOLIO CONSTRUCTION
# ============================================================

def _cap_and_renormalize_weights(weights: pd.Series, cap_per_ticker: float) -> pd.Series:
    w = weights.copy().astype(float)
    if w.sum() <= 0:
        return w

    w = w / w.sum()

    for _ in range(100):
        prev = w.copy()

        over = (w - cap_per_ticker).clip(lower=0.0)
        excess = float(over.sum())

        w = w.clip(upper=cap_per_ticker)

        if excess > 1e-12:
            eligible = w[w < cap_per_ticker - 1e-12]
            if len(eligible) > 0:
                denom = float(eligible.sum())
                if denom > 1e-12:
                    w.loc[eligible.index] += excess * (eligible / denom)
                else:
                    w.loc[eligible.index] += excess / len(eligible)

        if w.sum() > 0:
            w = w / w.sum()

        if np.allclose(prev.values, w.values, atol=1e-12, rtol=0.0):
            break

    if w.sum() > 0:
        w = w / w.sum()

    return w


def _build_candidate_holdings_and_weights(
    ranking: pd.Series,
    score_today: pd.Series,
    current_holdings: List[str],
    config: ResearchConfig,
) -> Tuple[List[str], pd.Series]:
    rank_map = {ticker: rank + 1 for rank, ticker in enumerate(ranking.index.tolist())}

    if getattr(config, "selection_buffer_asymmetric", False):
        entry_cut = int(config.rank_in_entry)
        maintain_cut = int(config.rank_maintain)
    else:
        entry_cut = int(config.rank_in)
        maintain_cut = int(config.rank_out)

    survivors = [t for t in current_holdings if t in rank_map and rank_map[t] <= maintain_cut]
    entries = [t for t in ranking.index.tolist() if rank_map[t] <= entry_cut and t not in survivors]

    new_holdings = survivors.copy()

    for t in entries:
        if len(new_holdings) >= config.top_q:
            break
        new_holdings.append(t)

    if len(new_holdings) < config.top_q:
        for t in ranking.index.tolist():
            if t not in new_holdings:
                new_holdings.append(t)
            if len(new_holdings) >= config.top_q:
                break

    new_holdings = new_holdings[: config.top_q]

    if new_holdings:
        selected_scores = score_today.reindex(new_holdings).fillna(0.0)
        if float(selected_scores.sum()) > 0.0:
            candidate_weights = selected_scores / selected_scores.sum()
        else:
            candidate_weights = pd.Series(1.0 / len(new_holdings), index=new_holdings, dtype=float)

        candidate_weights = _cap_and_renormalize_weights(candidate_weights, config.cap_per_ticker)
    else:
        candidate_weights = pd.Series(dtype=float)

    return new_holdings, candidate_weights


def build_buffered_portfolio_weights(
    prices: pd.DataFrame,
    config: ResearchConfig,
    external_alpha: pd.DataFrame | None = None,
    external_alpha_weight: float = 0.0,
) -> Tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    raw_momentum = compute_multi_horizon_momentum(prices, config)
    selection_score = raw_momentum
    if external_alpha is not None and external_alpha_weight != 0.0:
        extra = external_alpha.reindex(index=raw_momentum.index, columns=raw_momentum.columns).fillna(0.0)
        base_rank = _rowwise_rank_score(raw_momentum)
        extra_rank = _rowwise_rank_score(extra)
        # Keep momentum as the primary driver and use fundamentals/news only as a bounded tilt.
        selection_score = base_rank.add(extra_rank * float(external_alpha_weight), fill_value=0.0)
    convex_score = apply_convex_score(selection_score, config)
    month_end_flags = is_month_end(prices.index)

    excluded_tickers = {"SPY", "VGK", "EWJ", "EWC", "BIL", "TBILL_PROXY"}
    tickers = [c for c in prices.columns if str(c).upper() not in excluded_tickers]
    weights = pd.DataFrame(0.0, index=prices.index, columns=tickers, dtype=float)
    holdings_count = pd.Series(0, index=prices.index, dtype=int)

    rebalance_info = pd.DataFrame(
        {
            "rebalance_opportunity": False,
            "rebalance_executed": False,
            "potential_turnover": 0.0,
            "extraordinary": False,
        },
        index=prices.index,
    )

    def _rolling_compound_return(s: pd.Series, window: int) -> pd.Series:
        out = pd.Series(np.nan, index=s.index, dtype=float)
        arr = s.astype(float).values
        n = len(arr)
        for j in range(n):
            if j + 1 < window:
                continue
            chunk = arr[j + 1 - window : j + 1]
            out.iloc[j] = float(np.prod(1.0 + chunk) - 1.0)
        return out

    # Só calcular retorno composto do benchmark se gatilhos de bench estiverem activos
    bench_cum_for_triggers: pd.Series | None = None
    if config.extraordinary_benchmark_cumret_max is not None or config.extraordinary_benchmark_cumret_min is not None:
        returns_all = compute_returns(prices)
        benchmark_returns_series = compute_benchmark_returns(returns_all).reindex(prices.index).fillna(0.0)
        n_ex_lb = max(1, int(getattr(config, "extraordinary_benchmark_lookback_days", 5) or 5))
        bench_cum_for_triggers = _rolling_compound_return(benchmark_returns_series, n_ex_lb)

    extraordinary_exec_by_year: dict[int, int] = {}

    current_holdings: List[str] = []
    lookback_warmup = max(config.lookback_120_days, config.lookback_60_days, config.lookback_20_days)

    # Load meta for region / sector constraints if needed
    meta_df = None
    if config.constrain_us_to_benchmark or config.constrain_sectors_to_benchmark:
        meta_df = _load_company_meta_prefer_v3()

    def _meta_for_universe(all_tickers: List[str]) -> pd.DataFrame:
        """Return meta indexed by ticker with filled zone/country/sector.

        Defaults are intentionally US/United States for missing zone/country because
        most universe names are US; this makes constraints actually bind instead of
        silently skipping unknown tickers.
        """
        if meta_df is None or meta_df.empty:
            df = pd.DataFrame(index=[str(t).strip().upper() for t in all_tickers])
            df["zone"] = "US"
            df["country"] = "United States"
            df["sector"] = "Other"
            return df

        base = meta_df.copy()
        if "ticker" in base.columns:
            base["ticker"] = base["ticker"].astype(str).str.upper().str.strip()
            base = base.set_index("ticker")
        else:
            base.index = base.index.astype(str).str.upper().str.strip()

        uni = pd.DataFrame(index=[str(t).strip().upper() for t in all_tickers])
        out = uni.join(base, how="left")
        out["zone"] = out.get("zone", "").fillna("").astype(str).str.upper().str.strip()
        out["country"] = out.get("country", "").fillna("").astype(str).str.strip()
        out["sector"] = out.get("sector", "").fillna("").astype(str).str.strip()

        out.loc[out["zone"] == "", "zone"] = "US"
        out.loc[out["country"] == "", "country"] = "United States"
        out.loc[out["sector"] == "", "sector"] = "Other"
        return out

    def _apply_group_caps(w: pd.Series, groups: pd.Series, caps: dict[str, float]) -> pd.Series:
        """Apply hard caps per group with redistribution to groups with slack.
        Group names are matched case-insensitively so that 'Technology' and 'technology' both get the same cap.
        """
        w = w.copy().astype(float)
        w[w < 0] = 0.0
        s = float(w.sum())
        if s <= 0:
            return w
        w /= s

        g_raw = groups.reindex(w.index).fillna("Other").astype(str)
        g = g_raw.str.strip().str.lower()

        # Caps keyed by lowercase so comparison matches regardless of meta casing
        caps_lower = {str(k).strip().lower(): float(v) for k, v in caps.items() if v is not None}

        # First, scale down any group over its cap
        for grp_lower, cap in caps_lower.items():
            mask = g == grp_lower
            grp_sum = float(w[mask].sum())
            if grp_sum > cap and grp_sum > 0:
                w.loc[mask] *= cap / grp_sum

        # Redistribute leftover to groups with slack (proportional to current weights)
        for _ in range(10):
            total = float(w.sum())
            if total <= 0:
                break
            if abs(1.0 - total) < 1e-12:
                break
            if total > 1.0:
                w /= total
                break

            remaining = 1.0 - total
            grp_sums = w.groupby(g).sum()
            slack = {}
            for grp_lower, cap in caps_lower.items():
                slack_amt = cap - float(grp_sums.get(grp_lower, 0.0))
                if slack_amt > 1e-12:
                    slack[grp_lower] = slack_amt

            if not slack:
                # No slack anywhere; renormalize and stop
                w /= float(w.sum())
                break

            slack_total = float(sum(slack.values()))
            add_total = min(remaining, slack_total)

            for grp_lower, slack_amt in slack.items():
                add_grp = add_total * (slack_amt / slack_total)
                mask = g == grp_lower
                denom = float(w[mask].sum())
                if denom > 1e-12:
                    w.loc[mask] += add_grp * (w.loc[mask] / denom)
                else:
                    # If the group has zero holdings, we can't allocate without changing holdings.
                    # Skip; leftover will remain unallocated and renormalized at end.
                    pass

        # Final renormalize (tiny drift)
        if w.sum() > 0:
            w /= float(w.sum())
        return w

    def _enforce_min_non_us_holdings(
        candidate_holdings: List[str],
        full_score_row: pd.Series,
        meta_universe: pd.DataFrame,
        top_q: int,
        min_non_us: int = 2,
    ) -> List[str]:
        """
        Garante pelo menos min_non_us nomes não-US no conjunto de holdings,
        escolhendo-os pela melhor posição no ranking e removendo os US de pior ranking.
        """
        if min_non_us <= 0 or not len(candidate_holdings):
            return candidate_holdings

        # Construir um "ranking" que inclui também nomes com score NaN
        # (estes ficam ao fundo, mas podem ser usados para cumprir os mínimos fora dos EUA).
        scores_full = full_score_row.copy()
        scores_full = scores_full.astype(float)
        scores_full = scores_full.fillna(float("-inf"))
        ordered = scores_full.sort_values(ascending=False)
        rank_map = {ticker: rank for rank, ticker in enumerate(ordered.index.tolist(), start=1)}

        zones = (
            meta_universe.get("zone", "")
            .astype(str)
            .str.upper()
        )

        def _is_non_us(t: str) -> bool:
            z = zones.get(str(t).strip().upper(), "US")
            return z != "US"

        current_non_us = [t for t in candidate_holdings if _is_non_us(t)]
        if len(current_non_us) >= min_non_us:
            return candidate_holdings

        ranked_non_us = [t for t in ordered.index.tolist() if _is_non_us(t)]
        if not ranked_non_us:
            return candidate_holdings

        required = ranked_non_us[:min_non_us]
        new_holdings: List[str] = candidate_holdings.copy()

        for t in required:
            if t not in new_holdings:
                new_holdings.append(t)

        if len(new_holdings) > top_q:
            us_only = [t for t in new_holdings if not _is_non_us(t)]
            us_only_sorted = sorted(
                us_only,
                key=lambda x: rank_map.get(x, 10**9),
                reverse=True,
            )
            idx = 0
            while len(new_holdings) > top_q and idx < len(us_only_sorted):
                cand = us_only_sorted[idx]
                if cand in new_holdings and cand not in required:
                    new_holdings.remove(cand)
                idx += 1

        if len(new_holdings) > top_q:
            new_holdings = sorted(
                new_holdings,
                key=lambda x: rank_map.get(x, 10**9),
            )[:top_q]

        return new_holdings

    def _enforce_sector_cap_at_source(
        candidate_holdings: List[str],
        candidate_weights: pd.Series,
        full_score_row: pd.Series,
        meta_universe: pd.DataFrame,
        cap_per_ticker: float,
        sector_name: str,
        sector_cap: float,
    ) -> Tuple[List[str], pd.Series]:
        """
        Limita o peso de um sector na origem: se > sector_cap, troca nomes desse sector
        por nomes de outros sectores do ranking (pior sai, melhor entra). Sem redistribuir peso.
        """
        if not candidate_holdings or meta_universe is None or meta_universe.empty or sector_cap <= 0:
            return candidate_holdings, candidate_weights

        sector_col = meta_universe.get("sector", pd.Series(dtype=object))
        if sector_col.empty:
            return candidate_holdings, candidate_weights
        sectors = sector_col.astype(str).str.strip().str.lower()
        sector_key = sector_name.strip().lower()
        in_sector = sectors == sector_key

        def _sector_weight(holdings: List[str], weights: pd.Series) -> float:
            tickers_in = [t for t in holdings if t in in_sector.index and bool(in_sector.loc[t])]
            if not tickers_in:
                return 0.0
            return float(weights.reindex(tickers_in).fillna(0.0).sum())

        def _in_sector_ticker(t: str) -> bool:
            return t in in_sector.index and bool(in_sector.loc[t])

        w = candidate_weights.copy()
        if w.sum() <= 0:
            return candidate_holdings, candidate_weights
        w = w / float(w.sum())
        if _sector_weight(candidate_holdings, w) <= sector_cap:
            return candidate_holdings, candidate_weights

        scores_sorted = full_score_row.sort_values(ascending=False)
        ordered_tickers = scores_sorted.index.tolist()

        new_holdings = list(candidate_holdings)
        holdings_set = set(new_holdings)
        other_pool = [t for t in ordered_tickers if t not in holdings_set and t in in_sector.index and not _in_sector_ticker(t)]
        idx_other = 0
        max_iters = len(candidate_holdings) + 20
        for _ in range(max_iters):
            if _sector_weight(new_holdings, w) <= sector_cap or idx_other >= len(other_pool):
                break
            in_holdings = [t for t in new_holdings if _in_sector_ticker(t)]
            if not in_holdings:
                break
            # Nunca trocar o último nome do sector: garantir que o sector continua representado
            if len(in_holdings) <= 1:
                break
            worst = min(in_holdings, key=lambda t: float(full_score_row.get(t, -1e9)))
            best_other = other_pool[idx_other]
            try:
                i = new_holdings.index(worst)
            except ValueError:
                break
            new_holdings[i] = best_other
            holdings_set.discard(worst)
            holdings_set.add(best_other)
            idx_other += 1
            sel_scores = full_score_row.reindex(new_holdings).fillna(0.0)
            if float(sel_scores.sum()) > 0:
                w = sel_scores / float(sel_scores.sum())
            else:
                w = pd.Series(1.0 / len(new_holdings), index=new_holdings, dtype=float)
            w = _cap_and_renormalize_weights(w, cap_per_ticker)

        return new_holdings, w

    def _ensure_sector_floor_at_source(
        candidate_holdings: List[str],
        candidate_weights: pd.Series,
        full_score_row: pd.Series,
        meta_universe: pd.DataFrame,
        cap_per_ticker: float,
        sector_caps: dict,
    ) -> Tuple[List[str], pd.Series]:
        """
        Se um sector tem cap > 0 mas peso 0% na carteira, força a entrada do melhor nome
        desse sector (troca com o pior holding) para o sector aparecer na carteira.
        """
        if not candidate_holdings or meta_universe is None or meta_universe.empty or not sector_caps:
            return candidate_holdings, candidate_weights
        sector_col = meta_universe.get("sector", pd.Series(dtype=object))
        if sector_col.empty:
            return candidate_holdings, candidate_weights
        sectors = sector_col.astype(str).str.strip().str.lower()
        w = candidate_weights.copy()
        if w.sum() <= 0:
            return candidate_holdings, candidate_weights
        w = w / float(w.sum())
        scores_sorted = full_score_row.sort_values(ascending=False)
        new_holdings = list(candidate_holdings)
        for sector_name, cap in sector_caps.items():
            if cap <= 0:
                continue
            sector_key = sector_name.strip().lower()
            in_sector = sectors == sector_key
            sector_weight = float(w.reindex([t for t in new_holdings if t in in_sector.index and bool(in_sector.loc[t])]).fillna(0.0).sum())
            if sector_weight > 0:
                continue
            # Sector com peso 0: adicionar melhor nome do sector se existir
            in_sector_tickers = [t for t in scores_sorted.index.tolist() if t in in_sector.index and bool(in_sector.loc[t])]
            candidates_to_add = [t for t in in_sector_tickers if t not in new_holdings]
            if not candidates_to_add:
                continue
            best_sector = candidates_to_add[0]
            worst_holding = min(new_holdings, key=lambda t: float(full_score_row.get(t, -1e9)))
            try:
                i = new_holdings.index(worst_holding)
            except ValueError:
                continue
            new_holdings[i] = best_sector
            sel_scores = full_score_row.reindex(new_holdings).fillna(0.0)
            if float(sel_scores.sum()) > 0:
                w = sel_scores / float(sel_scores.sum())
            else:
                w = pd.Series(1.0 / len(new_holdings), index=new_holdings, dtype=float)
            w = _cap_and_renormalize_weights(w, cap_per_ticker)
        return new_holdings, w

    # Se estivermos em modo "constrained", restringir logo o universo a US/EU/JP/CAN
    if meta_df is not None and (config.constrain_us_to_benchmark or config.constrain_sectors_to_benchmark):
        meta_universe = _meta_for_universe_with_defaults([str(t) for t in tickers])
        allowed_zones = {"US", "EU", "JP", "CAN"}
        allowed = set(meta_universe.index[meta_universe["zone"].isin(allowed_zones)].tolist())
        tickers = [t for t in tickers if str(t).strip().upper() in allowed]
        # Recriar estruturas dependentes de tickers
        weights = pd.DataFrame(0.0, index=prices.index, columns=tickers, dtype=float)

    def _extraordinary_triggers_today(dt) -> bool:
        """Fora de fim de mês: gatilhos opcionais (mudança forte nos scores do modelo, breadth, ou bench legado)."""
        if not config.extraordinary_rebalance_enabled or not config.monthly_rebalance_only:
            return False
        cap_y = config.extraordinary_max_per_calendar_year
        if cap_y is not None:
            y = int(pd.Timestamp(dt).year)
            if extraordinary_exec_by_year.get(y, 0) >= int(cap_y):
                return False
        fired = False
        # --- Modelo: grandes mudanças em convex_score (|Δ| na cauda ou na média) ---
        n_m = max(1, int(getattr(config, "extraordinary_model_lookback_days", 5) or 5))
        p90_min = config.extraordinary_model_p90_abs_score_delta_min
        mean_min = config.extraordinary_model_mean_abs_score_delta_min
        min_names = max(5, int(getattr(config, "extraordinary_model_min_names_for_delta", 20) or 20))
        q_m = float(getattr(config, "extraordinary_model_abs_score_delta_quantile", 0.90) or 0.90)
        q_m = max(0.01, min(0.99, q_m))
        if p90_min is not None or mean_min is not None:
            if len(tickers) > 0:
                try:
                    cur = convex_score.loc[dt, tickers].astype(float)
                    prev = convex_score.shift(n_m).loc[dt, tickers].astype(float)
                except Exception:
                    cur = pd.Series(dtype=float)
                    prev = pd.Series(dtype=float)
                valid = cur.notna() & prev.notna()
                if int(valid.sum()) >= min_names:
                    dlt = (cur - prev).abs().loc[valid]
                    if p90_min is not None and float(dlt.quantile(q_m)) >= float(p90_min):
                        fired = True
                    if mean_min is not None and float(dlt.mean()) >= float(mean_min):
                        fired = True
        # --- Benchmark (opcional, legado) ---
        mx = config.extraordinary_benchmark_cumret_max
        mn = config.extraordinary_benchmark_cumret_min
        if bench_cum_for_triggers is not None and (mx is not None or mn is not None):
            try:
                bc = float(bench_cum_for_triggers.loc[dt])
            except Exception:
                bc = float("nan")
            if np.isfinite(bc):
                if mx is not None and bc <= float(mx):
                    fired = True
                if mn is not None and bc >= float(mn):
                    fired = True
        # --- Breadth no modelo ---
        bb = config.extraordinary_breadth_below
        if bb is not None and len(tickers) > 0:
            row = convex_score.loc[dt].reindex(tickers)
            tot = int(row.notna().sum())
            if tot > 0:
                elig = int((row.dropna() >= float(config.score_threshold)).sum())
                br = elig / float(tot)
                if br < float(bb):
                    fired = True
        return fired

    for i, dt in enumerate(prices.index):
        if i < lookback_warmup:
            continue

        is_me = bool(month_end_flags.loc[dt])
        extraordinary = False
        if config.monthly_rebalance_only and not is_me:
            extraordinary = _extraordinary_triggers_today(dt)
            if not extraordinary:
                if i > 0:
                    weights.loc[dt] = weights.iloc[i - 1]
                    holdings_count.loc[dt] = int((weights.loc[dt] > 0).sum())
                continue

        rebalance_info.loc[dt, "rebalance_opportunity"] = True
        if extraordinary:
            rebalance_info.loc[dt, "extraordinary"] = True

        score_row = convex_score.loc[dt]
        score_today = score_row.dropna()
        if score_today.empty:
            if i > 0:
                weights.loc[dt] = weights.iloc[i - 1]
                holdings_count.loc[dt] = int((weights.loc[dt] > 0).sum())
            continue

        ranking = score_today.sort_values(ascending=False)

        candidate_holdings, candidate_weights = _build_candidate_holdings_and_weights(
            ranking=ranking,
            score_today=score_today,
            current_holdings=current_holdings,
            config=config,
        )

        if config.constrain_us_to_benchmark and meta_df is not None and len(candidate_holdings) > 0:
            meta_universe = _meta_for_universe([str(t) for t in score_row.index.tolist()])
            adjusted_holdings = _enforce_min_non_us_holdings(
                candidate_holdings=candidate_holdings,
                full_score_row=score_row,
                meta_universe=meta_universe,
                top_q=config.top_q,
                min_non_us=2,
            )
            if adjusted_holdings != candidate_holdings:
                candidate_holdings = adjusted_holdings
                selected_scores = score_today.reindex(candidate_holdings).fillna(0.0)
                if float(selected_scores.sum()) > 0.0:
                    candidate_weights = selected_scores / selected_scores.sum()
                else:
                    candidate_weights = pd.Series(
                        1.0 / len(candidate_holdings),
                        index=candidate_holdings,
                        dtype=float,
                    )
                candidate_weights = _cap_and_renormalize_weights(
                    candidate_weights,
                    config.cap_per_ticker,
                )

        # Caps setoriais na origem: cada sector <= peso no bench * (1 + tolerância 10%), por troca de nomes
        if config.constrain_sectors_to_benchmark and meta_df is not None and len(candidate_holdings) > 0:
            meta_universe = _meta_for_universe([str(t) for t in score_row.index.tolist()])
            region_bench_weights = {"US": 0.60, "EU": 0.25, "JP": 0.10, "CAN": 0.05}
            bench_meta = meta_universe.copy()
            bench_meta["region_clean"] = bench_meta["zone"].astype(str).str.upper()
            bench_meta["bench_region_weight"] = bench_meta["region_clean"].map(region_bench_weights).fillna(0.0)
            region_counts = bench_meta.groupby("region_clean").size()
            bench_meta["bench_ticker_weight"] = bench_meta["bench_region_weight"]
            for rg, wt in region_bench_weights.items():
                n = int(region_counts.get(rg, 0))
                if n > 0:
                    bench_meta.loc[bench_meta["region_clean"] == rg, "bench_ticker_weight"] = float(wt) / n
            bench_sector = bench_meta.groupby("sector")["bench_ticker_weight"].sum().fillna(0.0)
            if float(bench_sector.sum()) > 0:
                bench_sector = bench_sector / float(bench_sector.sum())
            sector_caps_source = {str(s): min(SECTOR_ABS_MAX, min(1.0, float(w) * (1.0 + SECTOR_TOLERANCE))) for s, w in bench_sector.items()}
            # Sectores que existem no meta mas têm peso 0 no bench (ex.: só em zone OTHER) ficam com cap mínimo
            sectors_in_meta = meta_universe["sector"].astype(str).str.strip().dropna().unique().tolist()
            for s in sectors_in_meta:
                if s and (s not in sector_caps_source or sector_caps_source[s] <= 0):
                    sector_caps_source[str(s)] = SECTOR_MIN_CAP
            # Aplicar tecto absoluto a todos; Technology explicitamente limitado a TECHNOLOGY_CAP (33%)
            for s in list(sector_caps_source.keys()):
                sector_caps_source[s] = min(sector_caps_source[s], SECTOR_ABS_MAX)
            for _s in list(sector_caps_source.keys()):
                if str(_s).strip().lower() == "technology":
                    sector_caps_source[_s] = min(sector_caps_source[_s], TECHNOLOGY_CAP)
                    break
            if config.sector_cap_overrides:
                for k, v in config.sector_cap_overrides.items():
                    sector_caps_source[str(k)] = min(float(v), sector_caps_source.get(str(k), 1.0))
            for sector_name, cap in sorted(sector_caps_source.items(), key=lambda x: x[1]):
                if cap <= 0:
                    continue
                candidate_holdings, candidate_weights = _enforce_sector_cap_at_source(
                    candidate_holdings, candidate_weights, score_row, meta_universe,
                    config.cap_per_ticker, sector_name, cap,
                )
            # Garantir que Technology (e outros sectores com cap > 0) aparecem se peso = 0%
            candidate_holdings, candidate_weights = _ensure_sector_floor_at_source(
                candidate_holdings, candidate_weights, score_row, meta_universe,
                config.cap_per_ticker, sector_caps_source,
            )

        prev_weights = pd.Series(0.0, index=tickers, dtype=float)
        if i > 0:
            prev_weights = weights.iloc[i - 1].copy().astype(float)

        candidate_full = pd.Series(0.0, index=tickers, dtype=float)
        if len(candidate_weights) > 0:
            common = candidate_weights.index.intersection(candidate_full.index)
            if len(common) > 0:
                candidate_full.loc[common] = candidate_weights.loc[common].values

        # Apply optional region / sector constraints
        if meta_df is not None and candidate_full.sum() > 0:
            weights_tmp = candidate_full.clip(lower=0.0)
            total = float(weights_tmp.sum())
            if total > 0:
                weights_tmp /= total

            meta_sub = _meta_for_universe([str(x) for x in weights_tmp.index.tolist()])

            # Constraint 1+2: apply zone+sector caps with iterative projection
            # Ajuste: US máx ~75%, restante 25% distribuído por EU/JP/CAN
            zone_caps = {"US": 0.60, "EU": 0.25, "JP": 0.10, "CAN": 0.05}
            zone_series = meta_sub["zone"].fillna("US").astype(str).str.upper()

            if config.constrain_sectors_to_benchmark:
                # Build a simple "benchmark" sector distribution from all meta_df
                # using region-level ETF weights as proxies (SPY ~60%, VGK ~20%, EWJ ~15%, EWC ~5%)
                region_bench_weights = {"US": 0.60, "EU": 0.25, "JP": 0.10, "CAN": 0.05}

                # Map each ticker to a proxy benchmark weight
                # Build benchmark meta over the *same universe* (so missing tickers don't disappear)
                bench_meta = _meta_for_universe([str(x) for x in tickers])
                bench_meta["region_clean"] = bench_meta["zone"].astype(str).str.upper()
                bench_meta["bench_region_weight"] = bench_meta["region_clean"].map(region_bench_weights).fillna(0.0)

                # Benchmark weight per ticker proportional within region
                # Equal-weight dentro de cada região
                region_counts = bench_meta.groupby("region_clean").size()
                bench_meta["bench_ticker_weight"] = bench_meta["bench_region_weight"]
                for rg, wt in region_bench_weights.items():
                    n = int(region_counts.get(rg, 0))
                    if n > 0:
                        bench_meta.loc[bench_meta["region_clean"] == rg, "bench_ticker_weight"] = wt / n

                # Aggregate by sector
                bench_sector = bench_meta.groupby("sector")["bench_ticker_weight"].sum().fillna(0.0)
                if float(bench_sector.sum()) > 0:
                    bench_sector = bench_sector / float(bench_sector.sum())

                sector_series = meta_sub["sector"].fillna("Other").astype(str)
                # Cap por sector = peso no bench + tolerância (10%); mínimo SECTOR_MIN_CAP; máximo SECTOR_ABS_MAX
                sector_caps = {str(k): min(SECTOR_ABS_MAX, max(SECTOR_MIN_CAP, min(1.0, float(v) * (1.0 + SECTOR_TOLERANCE)))) for k, v in bench_sector.to_dict().items()}
                for s in sector_series.unique():
                    s = str(s).strip()
                    if s and (s not in sector_caps or sector_caps[s] <= 0):
                        sector_caps[s] = SECTOR_MIN_CAP
                for s in list(sector_caps.keys()):
                    sector_caps[s] = min(sector_caps[s], SECTOR_ABS_MAX)
                if "Technology" in sector_caps:
                    sector_caps["Technology"] = min(sector_caps["Technology"], TECHNOLOGY_CAP)
                if config.sector_cap_overrides:
                    for k, v in config.sector_cap_overrides.items():
                        sector_caps[str(k)] = min(float(v), sector_caps.get(str(k), 1.0))

                # Para não limitar artificialmente Europa/JP/CAN neste passo,
                # usamos apenas o cap de US aqui; os restantes são tratados globalmente depois.
                zone_caps_local = {"US": 0.60}

                if config.constrain_us_to_benchmark:
                    for _ in range(6):
                        weights_tmp = _apply_group_caps(weights_tmp, zone_series, zone_caps_local)
                        weights_tmp = _apply_group_caps(weights_tmp, sector_series, sector_caps)
                    weights_tmp = _apply_group_caps(weights_tmp, zone_series, zone_caps_local)
                else:
                    weights_tmp = _apply_group_caps(weights_tmp, sector_series, sector_caps)
            elif config.constrain_us_to_benchmark:
                # Apenas limitar US neste passo; restantes zonas ajustam-se globalmente depois.
                zone_caps_local = {"US": 0.60}
                weights_tmp = _apply_group_caps(weights_tmp, zone_series, zone_caps_local)

            candidate_full = weights_tmp

        potential_turnover = 0.5 * float((candidate_full - prev_weights).abs().sum())
        rebalance_info.loc[dt, "potential_turnover"] = potential_turnover

        turnover_thr = float(config.monthly_rebalance_turnover_threshold)
        if extraordinary:
            turnover_thr = float(config.extraordinary_rebalance_turnover_threshold)

        material_trade = True
        delta_floor = getattr(config, "rebalance_min_abs_weight_delta", None)
        if delta_floor is not None and len(current_holdings) > 0:
            try:
                floor = float(delta_floor)
                if floor > 0.0:
                    max_abs_dw = float((candidate_full - prev_weights).abs().max())
                    prev_names: set[str] = set()
                    for t in tickers:
                        try:
                            if float(prev_weights.loc[t]) > 1e-9:
                                prev_names.add(str(t))
                        except Exception:
                            continue
                    new_names = {str(t) for t in candidate_holdings}
                    lineup_changed = prev_names != new_names
                    material_trade = bool(lineup_changed or (max_abs_dw >= floor))
            except (TypeError, ValueError):
                material_trade = True

        should_execute = len(current_holdings) == 0 or (
            potential_turnover >= turnover_thr and material_trade
        )

        if should_execute:
            current_holdings = candidate_holdings
            weights.loc[dt] = candidate_full.values
            rebalance_info.loc[dt, "rebalance_executed"] = True
            if extraordinary:
                y = int(pd.Timestamp(dt).year)
                extraordinary_exec_by_year[y] = extraordinary_exec_by_year.get(y, 0) + 1
        else:
            weights.loc[dt] = prev_weights.values

        holdings_count.loc[dt] = int((weights.loc[dt] > 0).sum())

    weights = weights.ffill().fillna(0.0)
    holdings_count = holdings_count.replace(0, np.nan).ffill().fillna(0).astype(int)

    return (
        weights,
        holdings_count.to_frame(name="holdings_count"),
        raw_momentum,
        convex_score,
        rebalance_info,
    )


def apply_transaction_costs(
    weights_effective: pd.DataFrame,
    gross_returns: pd.Series,
    *,
    transaction_cost_bps: float,
    slippage_bps: float = 0.0,
    fx_conversion_bps: float = 0.0,
) -> Tuple[pd.Series, pd.Series]:
    """
    Penalização diária linear em |Δw_efectivo|: comissões + slippage + FX.

    `weights_effective` deve ser a mesma série usada no produto escalar com retornos
    (p.ex. weights.shift(lag).fillna(0)), para o custo cair no mesmo dia que o retorno
    que já reflecte essa carteira — não usar aqui os pesos de decisão sem shift.
    """
    turnover = weights_effective.diff().abs().sum(axis=1).fillna(
        weights_effective.abs().sum(axis=1)
    )
    total_bps = float(transaction_cost_bps) + float(slippage_bps) + float(fx_conversion_bps)
    cost_per_day = turnover * (total_bps / 10000.0)
    net_returns = gross_returns - cost_per_day
    return net_returns, turnover


def compute_raw_portfolio_returns(
    weights: pd.DataFrame,
    returns: pd.DataFrame,
    transaction_cost_bps: float,
    execution_lag_days: int = 0,
    slippage_bps: float = 0.0,
    fx_conversion_bps: float = 0.0,
) -> Tuple[pd.Series, pd.Series, pd.Series]:
    """Devolve (retorno_líquido, turnover, retorno_bruto).

    O bruto (pré-custo) deve ser usado para estimar vol no vol-targeting; caso contrário
    a fricção baixa a vol realizada e o escalonamento sobe, «comendo» o efeito no CAGR.
    """
    # 1 = fecho→próximo dia (defeito); +N = N dias úteis extra de atraso vs. sinal.
    lag = 1 + max(0, int(execution_lag_days))
    shifted_weights = weights.shift(lag).fillna(0.0)
    gross = (shifted_weights * returns).sum(axis=1)
    net_returns, turnover = apply_transaction_costs(
        shifted_weights,
        gross,
        transaction_cost_bps=transaction_cost_bps,
        slippage_bps=slippage_bps,
        fx_conversion_bps=fx_conversion_bps,
    )
    return net_returns, turnover, gross


# ============================================================
# OVERLAYS
# ============================================================

def compute_breadth_overlay(
    raw_momentum: pd.DataFrame,
    config: ResearchConfig,
) -> pd.Series:
    eligible_count = (raw_momentum >= config.score_threshold).sum(axis=1).astype(float)
    universe_count = float(raw_momentum.shape[1]) if raw_momentum.shape[1] > 0 else 1.0

    breadth_ratio = eligible_count / universe_count
    breadth_scale = config.breadth_min + breadth_ratio * (config.breadth_max - config.breadth_min)
    breadth_scale = breadth_scale.clip(lower=config.breadth_min, upper=config.breadth_max)
    breadth_scale.name = "breadth_scale"
    return breadth_scale


def compute_trend_regime_filter(
    benchmark_price: pd.Series,
    config: ResearchConfig,
) -> pd.DataFrame:
    ma = benchmark_price.rolling(config.benchmark_ma_window, min_periods=config.benchmark_ma_window).mean()

    exposure = pd.Series(config.risk_on_exposure, index=benchmark_price.index, dtype=float)
    exposure[benchmark_price < ma] = config.risk_off_exposure

    regime = pd.Series("RISK_ON", index=benchmark_price.index, dtype=object)
    regime[benchmark_price < ma] = "RISK_OFF"

    return pd.DataFrame(
        {
            "benchmark_price": benchmark_price,
            "benchmark_ma": ma,
            "exposure": exposure,
            "regime": regime,
        },
        index=benchmark_price.index,
    )


def compute_vol_spike_exposure(
    benchmark_returns: pd.Series,
    config: ResearchConfig,
) -> pd.Series:
    """
    Exposure reduction when short-term realized vol spikes vs long-term realized vol.
    Evaluated on benchmark returns to avoid circularity.
    """
    if not bool(config.vol_spike_enabled):
        return pd.Series(1.0, index=benchmark_returns.index, dtype=float, name="vol_spike_exposure")

    short = (
        benchmark_returns.rolling(int(config.vol_spike_short_window))
        .std(ddof=0)
        * math.sqrt(TRADING_DAYS)
    )
    long = (
        benchmark_returns.rolling(int(config.vol_spike_long_window))
        .std(ddof=0)
        * math.sqrt(TRADING_DAYS)
    )
    ratio = short / long.replace(0.0, np.nan)
    ratio = ratio.replace([np.inf, -np.inf], np.nan)

    exposure = pd.Series(1.0, index=benchmark_returns.index, dtype=float)
    exposure[ratio >= float(config.vol_spike_ratio_threshold)] = float(config.vol_spike_exposure)
    exposure = exposure.fillna(1.0)
    exposure.name = "vol_spike_exposure"
    return exposure


def compute_drawdown_trigger_exposure(
    benchmark_equity: pd.Series,
    config: ResearchConfig,
) -> pd.Series:
    """
    Exposure reduction when benchmark is in drawdown.
    Uses two-step thresholds (mild and severe).
    """
    if not bool(config.drawdown_enabled):
        return pd.Series(1.0, index=benchmark_equity.index, dtype=float, name="drawdown_exposure")

    eq = pd.Series(benchmark_equity, index=benchmark_equity.index, dtype=float).ffill()
    dd = eq / eq.cummax() - 1.0

    exposure = pd.Series(1.0, index=eq.index, dtype=float)
    # Apply more severe rule first, then mild
    exposure[dd <= float(config.drawdown_threshold_2)] = float(config.drawdown_exposure_2)
    exposure[(dd > float(config.drawdown_threshold_2)) & (dd <= float(config.drawdown_threshold_1))] = float(config.drawdown_exposure_1)
    exposure = exposure.fillna(1.0)
    exposure.name = "drawdown_exposure"
    return exposure


def compute_crash_overlay_2of3(
    benchmark_price: pd.Series,
    raw_momentum: pd.DataFrame,
    config: ResearchConfig,
) -> pd.DataFrame:
    """2-of-3 crash overlay with hysteresis on exit.

    Signals:
    - benchmark < MA(benchmark_ma_window)
    - internal breadth < crash_breadth_threshold
    - benchmark rolling drawdown(crash_dd_window) < crash_dd_threshold
    """
    idx = benchmark_price.index
    disabled = pd.DataFrame(index=idx)
    disabled["signal_count"] = 0
    disabled["max_exposure_cap"] = 1.0
    disabled["active_state"] = False
    disabled["benchmark_below_ma"] = False
    disabled["breadth_below_threshold"] = False
    disabled["benchmark_drawdown_below_threshold"] = False
    if not bool(getattr(config, "crash_overlay_2of3_enabled", False)):
        return disabled

    ma = benchmark_price.rolling(int(config.benchmark_ma_window), min_periods=int(config.benchmark_ma_window)).mean()
    sig_ma = (benchmark_price < ma).fillna(False)
    breadth_ratio = (raw_momentum >= float(config.score_threshold)).mean(axis=1).reindex(idx).fillna(0.0)
    sig_breadth = (breadth_ratio < float(config.crash_breadth_threshold)).fillna(False)
    dd_roll = benchmark_price / benchmark_price.rolling(
        int(config.crash_dd_window), min_periods=int(config.crash_dd_window)
    ).max() - 1.0
    sig_dd = (dd_roll < float(config.crash_dd_threshold)).fillna(False)

    signal_count = (sig_ma.astype(int) + sig_breadth.astype(int) + sig_dd.astype(int)).astype(int)
    desired_cap = pd.Series(1.0, index=idx, dtype=float)
    desired_cap[signal_count >= 2] = float(config.crash_exposure_2_signals)
    desired_cap[signal_count >= 3] = float(config.crash_exposure_3_signals)

    caps: list[float] = []
    active_state: list[bool] = []
    active = False
    last_active_cap = 1.0
    exit_days = max(1, int(getattr(config, "crash_exit_consecutive_days", 10) or 10))
    safe_streak = 0
    for dt in idx:
        sc = int(signal_count.loc[dt])
        cap_now = float(desired_cap.loc[dt])
        if sc >= 2:
            active = True
            safe_streak = 0
            last_active_cap = cap_now
            caps.append(cap_now)
            active_state.append(True)
            continue
        if active:
            safe_streak += 1
            if safe_streak >= exit_days:
                active = False
                safe_streak = 0
                caps.append(1.0)
                active_state.append(False)
            else:
                caps.append(last_active_cap)
                active_state.append(True)
        else:
            caps.append(1.0)
            active_state.append(False)

    out = pd.DataFrame(index=idx)
    out["signal_count"] = signal_count.astype(int)
    out["max_exposure_cap"] = pd.Series(caps, index=idx, dtype=float)
    out["active_state"] = pd.Series(active_state, index=idx, dtype=bool)
    out["benchmark_below_ma"] = sig_ma.astype(bool)
    out["breadth_below_threshold"] = sig_breadth.astype(bool)
    out["benchmark_drawdown_below_threshold"] = sig_dd.astype(bool)
    return out


def _compute_bear_low_vol_exposure_hysteresis(
    benchmark_returns: pd.Series,
    benchmark_price: pd.Series | None,
    trend_df: pd.DataFrame,
    config: ResearchConfig,
) -> pd.Series:
    """Estado protegido com histerese; ver ``ResearchConfig.bear_low_vol_hysteresis_*``."""
    idx = benchmark_returns.index
    w = max(20, int(getattr(config, "bear_low_vol_bench_vol_window", 63)))
    br = pd.Series(benchmark_returns, index=idx, dtype=float).fillna(0.0)
    bv = br.rolling(w, min_periods=max(20, w // 3)).std(ddof=0) * math.sqrt(TRADING_DAYS)

    bp = pd.Series(benchmark_price, index=idx, dtype=float).ffill() if benchmark_price is not None else None
    if bp is None or bp.isna().all():
        bp = pd.Series(trend_df["benchmark_price"], index=idx, dtype=float).ffill()

    ma_win = max(60, int(getattr(config, "bear_low_vol_hysteresis_bear_ma_window", 252)))
    ma_bear = bp.rolling(ma_win, min_periods=max(60, ma_win // 4)).mean()
    bear_raw = (bp < ma_bear).to_numpy()
    bear = np.where(np.isfinite(bear_raw), bear_raw.astype(bool), False)

    minp = max(130, int(getattr(config, "bear_low_vol_quantile_min_periods", 252)))
    vp = bv.shift(1)
    q_ent = float(getattr(config, "bear_low_vol_hysteresis_entry_quantile", 0.30))
    q_ex = float(getattr(config, "bear_low_vol_hysteresis_exit_quantile", 0.55))
    p30 = vp.expanding(min_periods=minp).quantile(q_ent).to_numpy(dtype=float)
    p55 = vp.expanding(min_periods=minp).quantile(q_ex).to_numpy(dtype=float)
    qok = np.isfinite(p30) & np.isfinite(p55)

    v_a = bv.to_numpy(dtype=float)
    mult_on = float(getattr(config, "bear_low_vol_exposure_mult", 0.85))
    mult_on = min(1.0, max(0.0, mult_on))
    n_exit = max(1, int(getattr(config, "bear_low_vol_hysteresis_exit_consecutive_days", 10)))

    out_vals: list[float] = []
    protected = False
    consec = 0
    for i in range(len(idx)):
        b = bool(bear[i])
        ok = bool(qok[i])
        v = float(v_a[i]) if np.isfinite(v_a[i]) else float("nan")
        p3 = float(p30[i])
        p5 = float(p55[i])

        if not protected:
            if ok and b and math.isfinite(v) and math.isfinite(p3) and v < p3:
                protected = True
                consec = 0
        else:
            if not b:
                protected = False
                consec = 0
            else:
                if ok and math.isfinite(v) and math.isfinite(p5) and v > p5:
                    consec += 1
                else:
                    consec = 0
                if consec >= n_exit:
                    protected = False
                    consec = 0

        out_vals.append(mult_on if protected else 1.0)

    s = pd.Series(out_vals, index=idx, dtype=float)
    s.name = "bear_low_vol_exposure"
    return s


def compute_bear_low_vol_exposure(
    benchmark_returns: pd.Series,
    trend_df: pd.DataFrame,
    config: ResearchConfig,
    benchmark_price: pd.Series | None = None,
) -> pd.Series:
    """
    Factor em [0,1] aplicado multiplicativamente ao stack breadth×trend×… (com shift(1) no caller).

    Modo simples (``bear_low_vol_tiered`` False): RISK_OFF do filtro trend **e** vol bench abaixo da
    mediana expansiva passada → ``bear_low_vol_exposure_mult`` constante.

    Modo escalonado (``bear_low_vol_tiered`` True): **bear** = preço do benchmark < MA
    ``bear_low_vol_bear_ma_window`` (defeito 252); vol 63d vs quantis expansivos **até t−1**:
    vol < p20 → 0.85 ; p20–p40 → 0.90 ; p40–p50 → 0.95 ; ≥ p50 → 1.00 (só quando bear; fora bear → 1).

    Modo histerese (``bear_low_vol_hysteresis`` True, tem prioridade): entra com bear (MA252) e
    vol < p30 expansivo; sai com (não bear) OU vol > p55 durante N dias seguidos; enquanto activo
    aplica ``bear_low_vol_exposure_mult``.
    """
    if not bool(getattr(config, "bear_low_vol_overlay_enabled", False)):
        return pd.Series(1.0, index=benchmark_returns.index, dtype=float, name="bear_low_vol_exposure")

    idx = benchmark_returns.index
    w = max(20, int(getattr(config, "bear_low_vol_bench_vol_window", 63)))
    br = pd.Series(benchmark_returns, index=idx, dtype=float).fillna(0.0)
    bv = br.rolling(w, min_periods=max(20, w // 3)).std(ddof=0) * math.sqrt(TRADING_DAYS)

    if bool(getattr(config, "bear_low_vol_hysteresis", False)):
        return _compute_bear_low_vol_exposure_hysteresis(
            benchmark_returns, benchmark_price, trend_df, config
        )

    if bool(getattr(config, "bear_low_vol_tiered", False)):
        bp = pd.Series(benchmark_price, index=idx, dtype=float).ffill() if benchmark_price is not None else None
        if bp is None or bp.isna().all():
            bp = pd.Series(trend_df["benchmark_price"], index=idx, dtype=float).ffill()
        ma_win = max(60, int(getattr(config, "bear_low_vol_bear_ma_window", 252)))
        ma_bear = bp.rolling(ma_win, min_periods=max(60, ma_win // 4)).mean()
        bear = bp < ma_bear

        minp = max(130, int(getattr(config, "bear_low_vol_quantile_min_periods", 252)))
        vp = bv.shift(1)
        p20 = vp.expanding(min_periods=minp).quantile(0.20)
        p40 = vp.expanding(min_periods=minp).quantile(0.40)
        p50q = vp.expanding(min_periods=minp).quantile(0.50)
        qok = p20.notna() & p40.notna() & p50q.notna()

        out = pd.Series(1.0, index=idx, dtype=float)
        m = bear & qok
        out.loc[m & (bv < p20)] = 0.85
        out.loc[m & (bv >= p20) & (bv < p40)] = 0.90
        out.loc[m & (bv >= p40) & (bv < p50q)] = 0.95
        # bear e vol >= p50: mantém 1.0
        out.name = "bear_low_vol_exposure"
        return out

    minp = max(w * 2, 130)
    past_med = bv.expanding(min_periods=minp).median().shift(1)
    low_vol = (bv < past_med) & past_med.notna()

    regime = trend_df["regime"].reindex(idx)
    bear = regime == "RISK_OFF"

    mult = float(getattr(config, "bear_low_vol_exposure_mult", 0.85))
    mult = min(1.0, max(0.0, mult))

    out = pd.Series(1.0, index=idx, dtype=float)
    out.loc[bear & low_vol] = mult
    out.name = "bear_low_vol_exposure"
    return out


# ============================================================
# VOL TARGET
# ============================================================

def compute_vol_target_scale(
    strategy_returns: pd.Series,
    benchmark_returns: pd.Series,
    config: ResearchConfig,
    target_boost: float = 1.0,
) -> pd.Series:
    profile_key = config.profile.lower()
    target_multiplier = PROFILE_TARGET_VOL_MULTIPLIER.get(profile_key, 1.0)

    strat_vol = strategy_returns.rolling(config.vol_target_window).std(ddof=0) * math.sqrt(TRADING_DAYS)
    bench_vol = benchmark_returns.rolling(config.vol_target_window).std(ddof=0) * math.sqrt(TRADING_DAYS)

    target_vol = bench_vol * target_multiplier * target_boost
    scale = target_vol / strat_vol.replace(0.0, np.nan)
    scale = scale.replace([np.inf, -np.inf], np.nan)
    scale = scale.clip(lower=config.vol_scale_floor, upper=config.vol_scale_cap)
    scale = scale.fillna(1.0)
    return scale


# ============================================================
# MAIN
# ============================================================

def _load_company_meta_prefer_v3() -> pd.DataFrame:
    """
    Carrega meta global e enriquece com sectores/país/zona do v3 onde existirem.
    Dá prioridade a company_meta_global_enriched.csv (do TWS), cai depois para company_meta_global.csv
    e finalmente para v3 apenas se o resto não existir.
    """
    global_path = ROOT / "data" / "company_meta_global_enriched.csv"
    v3_path = ROOT / "data" / "company_meta_v3.csv"

    base = None
    if global_path.exists():
        try:
            base = pd.read_csv(global_path)
            base.columns = [str(c).strip().lower() for c in base.columns]
        except Exception:
            base = None

    if base is None or "ticker" not in base.columns:
        # fallback para v3 simples
        if v3_path.exists():
            try:
                df = pd.read_csv(v3_path)
                df.columns = [str(c).strip().lower() for c in df.columns]
                if "ticker" not in df.columns:
                    return pd.DataFrame(columns=["ticker", "company", "country", "zone", "sector"])
                for col in ["company", "country", "zone", "sector"]:
                    if col not in df.columns:
                        df[col] = ""
                df["ticker"] = df["ticker"].astype(str).str.strip().str.upper()
                df["company"] = df["company"].fillna("").astype(str).replace("nan", "")
                df["country"] = df["country"].fillna("").astype(str).replace("nan", "")
                df["zone"] = df["zone"].fillna("").astype(str).replace("nan", "")
                df["sector"] = df["sector"].fillna("").astype(str).replace("nan", "")
                df = df.drop_duplicates(subset=["ticker"], keep="first")
                return df[["ticker", "company", "country", "zone", "sector"]].copy()
            except Exception:
                return pd.DataFrame(columns=["ticker", "company", "country", "zone", "sector"])
        return pd.DataFrame(columns=["ticker", "company", "country", "zone", "sector"])

    # Normalizar base global
    for col in ["company", "country", "zone", "sector"]:
        if col not in base.columns:
            base[col] = ""
    base["ticker"] = base["ticker"].astype(str).str.strip().str.upper()
    base["company"] = base["company"].fillna("").astype(str).replace("nan", "")
    base["country"] = base["country"].fillna("").astype(str).replace("nan", "")
    base["zone"] = base["zone"].fillna("").astype(str).replace("nan", "")
    base["sector"] = base["sector"].fillna("").astype(str).replace("nan", "")
    base = base.drop_duplicates(subset=["ticker"], keep="first").set_index("ticker")

    # Enriquecer com v3 onde existir
    if v3_path.exists():
        try:
            v3 = pd.read_csv(v3_path)
            v3.columns = [str(c).strip().lower() for c in v3.columns]
            if "ticker" in v3.columns:
                for col in ["company", "country", "zone", "sector"]:
                    if col not in v3.columns:
                        v3[col] = ""
                v3["ticker"] = v3["ticker"].astype(str).str.strip().str.upper()
                v3 = v3.drop_duplicates(subset=["ticker"], keep="first").set_index("ticker")
                # Só preencher onde base está vazio
                for col in ["company", "country", "zone", "sector"]:
                    if col in v3.columns:
                        mask = (base[col].astype(str).str.strip() == "")
                        base.loc[mask, col] = v3.loc[mask & v3.index.isin(base.index), col]
        except Exception:
            pass

    base = base.reset_index()
    return base[["ticker", "company", "country", "zone", "sector"]].copy()


def _meta_row_for_ticker(meta_df: pd.DataFrame, ticker: str) -> Dict[str, str]:
    t = str(ticker).strip().upper()

    if meta_df.empty:
        return {
            "short_name": t,
            "name": t,
            "region": "",
            "sector": "",
        }

    row = meta_df.loc[meta_df["ticker"] == t]
    if row.empty:
        return {
            "short_name": t,
            "name": t,
            "region": "",
            "sector": "",
        }

    r = row.iloc[0]

    short_name = str(r.get("company", "")).strip() or t
    name = short_name
    region = str(r.get("zone", "")).strip() or str(r.get("country", "")).strip()
    sector = str(r.get("sector", "")).strip()

    return {
        "short_name": short_name,
        "name": name,
        "region": region,
        "sector": sector,
    }


def _meta_for_universe_with_defaults(all_tickers: List[str]) -> pd.DataFrame:
    """Meta indexed by ticker with defaults (zone/country/sector filled)."""
    meta = _load_company_meta_prefer_v3()
    if meta is None or meta.empty:
        df = pd.DataFrame(index=[str(t).strip().upper() for t in all_tickers])
        df["zone"] = "US"
        df["country"] = "United States"
        df["sector"] = "Other"
        return df

    base = meta.copy()
    if "ticker" in base.columns:
        base["ticker"] = base["ticker"].astype(str).str.upper().str.strip()
        base = base.set_index("ticker")
    else:
        base.index = base.index.astype(str).str.upper().str.strip()

    uni = pd.DataFrame(index=[str(t).strip().upper() for t in all_tickers])
    out = uni.join(base, how="left")
    out["zone"] = out.get("zone", "").fillna("").astype(str).str.upper().str.strip()
    out["country"] = out.get("country", "").fillna("").astype(str).str.strip()
    out["sector"] = out.get("sector", "").fillna("").astype(str).str.strip()

    # Preencher apenas valores em falta de forma neutra; não reclassificar zonas reais.
    out.loc[out["zone"] == "", "zone"] = "N/A"
    out.loc[out["country"] == "", "country"] = "N/A"
    out.loc[out["sector"] == "", "sector"] = "Other"
    return out


def _load_sector_cluster_map(cluster_map_path: str | Path | None) -> dict[str, str]:
    """Return {TICKER: CLUSTER}. Accepts common JSON shapes."""
    if cluster_map_path is None:
        return {}
    p = Path(cluster_map_path)
    if not p.is_absolute():
        p = (ROOT / str(cluster_map_path)).resolve()
    if not p.is_file():
        return {}
    try:
        payload = json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        return {}
    out: dict[str, str] = {}
    if isinstance(payload, dict):
        raw = payload.get("ticker_to_cluster", payload)
        if isinstance(raw, dict):
            for k, v in raw.items():
                tk = str(k).strip().upper()
                cv = str(v).strip()
                if tk and cv:
                    out[tk] = cv
    elif isinstance(payload, list):
        for row in payload:
            if not isinstance(row, dict):
                continue
            tk = str(row.get("ticker", "")).strip().upper()
            cv = str(row.get("cluster", "")).strip()
            if tk and cv:
                out[tk] = cv
    return out


def _exposure_dict(weights: pd.Series, groups: pd.Series) -> dict[str, float]:
    g = groups.reindex(weights.index).fillna("UNKNOWN").astype(str).str.strip()
    out = weights.groupby(g).sum().astype(float)
    out = out[out > 1e-12].sort_values(ascending=False)
    return {str(k): float(v) for k, v in out.items()}


def _apply_sector_cluster_caps_to_weights(
    weights: pd.DataFrame,
    dates_to_apply: List[pd.Timestamp],
    cap_per_ticker: float,
    sector_cap: float,
    cluster_cap: float,
    cluster_map_path: str | Path | None,
) -> tuple[pd.DataFrame, dict[str, Any]]:
    out = weights.copy()
    tickers = [str(c).strip().upper() for c in out.columns]
    meta = _meta_for_universe_with_defaults(tickers)
    sector_series = meta["sector"].reindex(tickers).fillna("Other").astype(str).str.strip()
    t2c = _load_sector_cluster_map(cluster_map_path)
    cluster_vals = []
    for t in tickers:
        mapped = str(t2c.get(str(t).strip().upper(), "")).strip()
        if mapped:
            cluster_vals.append(mapped)
        else:
            cluster_vals.append(str(sector_series.get(t, "Other")))
    cluster_series = pd.Series(cluster_vals, index=tickers, dtype=object)

    total_cut_sector = 0.0
    total_cut_cluster = 0.0
    violations: list[dict[str, Any]] = []
    last_sector_exposure: dict[str, float] = {}
    last_cluster_exposure: dict[str, float] = {}

    for dt in dates_to_apply:
        if dt not in out.index:
            continue
        w = out.loc[dt].copy().fillna(0.0).astype(float)
        w = w.clip(lower=0.0)
        if float(w.sum()) <= 0:
            continue
        w = w / float(w.sum())
        pre_sector = w.groupby(sector_series).sum()
        pre_cluster = w.groupby(cluster_series).sum()
        total_cut_sector += float((pre_sector - float(sector_cap)).clip(lower=0.0).sum())
        total_cut_cluster += float((pre_cluster - float(cluster_cap)).clip(lower=0.0).sum())

        sector_caps = {str(k): float(sector_cap) for k in sector_series.unique().tolist()}
        cluster_caps = {str(k): float(cluster_cap) for k in cluster_series.unique().tolist()}

        for _ in range(4):
            w = _apply_group_caps(w, sector_series, sector_caps)
            w = _apply_group_caps(w, cluster_series, cluster_caps)
            w = _cap_and_renormalize_weights(w, cap_per_ticker=float(cap_per_ticker))

        sec_exp = w.groupby(sector_series).sum().astype(float)
        clu_exp = w.groupby(cluster_series).sum().astype(float)
        sec_viol = {str(k): float(v) for k, v in sec_exp[sec_exp > float(sector_cap) + 1e-8].items()}
        clu_viol = {str(k): float(v) for k, v in clu_exp[clu_exp > float(cluster_cap) + 1e-8].items()}
        if sec_viol or clu_viol:
            violations.append(
                {
                    "date": str(pd.Timestamp(dt).date()),
                    "sector": sec_viol,
                    "cluster": clu_viol,
                }
            )
        last_sector_exposure = _exposure_dict(w, sector_series)
        last_cluster_exposure = _exposure_dict(w, cluster_series)
        out.loc[dt] = w.reindex(out.columns).fillna(0.0)

    out = out.ffill().fillna(0.0)
    diagnostics = {
        "sector_cap": float(sector_cap),
        "cluster_cap": float(cluster_cap),
        "cluster_map_path": str(cluster_map_path) if cluster_map_path is not None else None,
        "cluster_map_entries": int(len(t2c)),
        "total_cut_weight_sector": float(total_cut_sector),
        "total_cut_weight_cluster": float(total_cut_cluster),
        "violations_count": int(len(violations)),
        "violations": violations[:50],
        "latest_sector_exposure": last_sector_exposure,
        "latest_cluster_exposure": last_cluster_exposure,
    }
    return out, diagnostics


def _apply_group_caps(w: pd.Series, groups: pd.Series, caps: dict[str, float]) -> pd.Series:
    """Hard caps per group with redistribution to groups with slack.
    Group names matched case-insensitively so 'Technology' cap applies to 'technology' etc.
    """
    w = w.copy().astype(float)
    w[w < 0] = 0.0
    s = float(w.sum())
    if s <= 0:
        return w
    w /= s

    g_raw = groups.reindex(w.index).fillna("Other").astype(str)
    g = g_raw.str.strip().str.lower()

    # Caps keyed by lowercase; any group not in caps gets cap 1.0
    caps_lower = {str(k).strip().lower(): float(v) for k, v in caps.items()}
    for grp in g.unique().tolist():
        if grp not in caps_lower:
            caps_lower[grp] = 1.0

    for grp_lower, cap in caps_lower.items():
        mask = g == grp_lower
        grp_sum = float(w[mask].sum())
        if grp_sum > cap and grp_sum > 0:
            w.loc[mask] *= cap / grp_sum

    for _ in range(10):
        total = float(w.sum())
        if total <= 0:
            break
        if abs(1.0 - total) < 1e-12:
            break
        if total > 1.0:
            w /= total
            break

        remaining = 1.0 - total
        grp_sums = w.groupby(g).sum()
        slack = {}
        for grp_lower, cap in caps_lower.items():
            slack_amt = float(cap) - float(grp_sums.get(grp_lower, 0.0))
            if slack_amt > 1e-12:
                slack[grp_lower] = slack_amt

        if not slack:
            w /= float(w.sum())
            break

        slack_total = float(sum(slack.values()))
        add_total = min(remaining, slack_total)
        for grp_lower, slack_amt in slack.items():
            add_grp = add_total * (slack_amt / slack_total)
            mask = g == grp_lower
            denom = float(w[mask].sum())
            if denom > 1e-12:
                w.loc[mask] += add_grp * (w.loc[mask] / denom)

    if w.sum() > 0:
        w /= float(w.sum())
    return w


def _project_weights_quadratic(
    w0: pd.Series,
    group_constraints: List[Tuple[np.ndarray, float]],
    ticker_cap: float,
) -> np.ndarray:
    """Projeção quadrática geral: min ||w - w0||^2 s.t. sum(w)=1, 0<=w<=ticker_cap e, para cada grupo, sum(w[mask])<=cap.
    group_constraints = [(mask_1, cap_1), (mask_2, cap_2), ...] — zonas e sectores; regra única para todas as restrições.
    """
    from scipy.optimize import minimize

    n = len(w0)
    w0_arr = np.asarray(w0, dtype=float).ravel()
    w0_arr = np.clip(w0_arr, 0.0, None)
    if w0_arr.sum() <= 0:
        w0_arr = np.ones(n) / n
    else:
        w0_arr = w0_arr / w0_arr.sum()

    def obj(x: np.ndarray) -> float:
        return 0.5 * float(np.sum((x - w0_arr) ** 2))

    bounds = [(0.0, float(ticker_cap))] * n
    constraints: List[Dict[str, Any]] = [{"type": "eq", "fun": lambda x: np.sum(x) - 1.0}]
    for mask, cap in group_constraints:
        cap_f = float(cap)
        m = np.asarray(mask, dtype=bool)
        if m.shape != (n,) or cap_f <= 0:
            continue
        constraints.append({"type": "ineq", "fun": lambda x, msk=m, c=cap_f: c - float(np.sum(x[msk]))})

    res = minimize(
        obj,
        w0_arr.copy(),
        method="SLSQP",
        bounds=bounds,
        constraints=constraints,
        options={"maxiter": 300, "ftol": 1e-9},
    )
    if not res.success:
        x = np.clip(res.x, 0.0, ticker_cap)
        if x.sum() > 0:
            x = x / x.sum()
        # Aplicar caps por grupo de forma sequencial como fallback
        for mask, cap in group_constraints:
            m = np.asarray(mask, dtype=bool)
            if m.shape == (n,) and cap > 0 and x[m].sum() > cap:
                x[m] *= cap / x[m].sum()
                x = x / x.sum()
        return x
    x = np.clip(res.x, 0.0, ticker_cap)
    if x.sum() > 0:
        x = x / x.sum()
    return x


def _apply_benchmark_like_caps_to_weights(
    weights: pd.DataFrame,
    dates_to_apply: List[pd.Timestamp],
    zone_caps: dict[str, float],
    sector_caps: dict[str, float] | None,
    cap_per_ticker: float,
) -> pd.DataFrame:
    """Apply caps only on selected dates (rebalance dates)."""
    out = weights.copy()
    tickers = [str(c).strip().upper() for c in out.columns]
    meta = _meta_for_universe_with_defaults(tickers)
    zone_series = meta["zone"].astype(str).str.upper()
    # Normalizar sectores para string "bonita"
    sector_series = meta["sector"].astype(str).str.strip()

    def _cap_row(row: pd.Series) -> pd.Series:
        w = row.copy()
        if float(w.sum()) <= 0:
            return w
        # Quadratic-style constraint: alternate projections so we satisfy both
        # (a) zone split and (b) per-ticker cap, while staying close to the original weights.
        w = w.clip(lower=0.0)
        if float(w.sum()) > 0:
            w = w / float(w.sum())

        z = zone_series.reindex(w.index).fillna("US").astype(str).str.upper()
        mask_us = z == "US"
        target_us = float(zone_caps.get("US", 0.60))
        target_non = max(0.0, 1.0 - target_us)

        for _ in range(20):
            # Project onto zone split (US/non-US)
            us_sum = float(w[mask_us].sum())
            non_sum = float(w[~mask_us].sum())
            if us_sum > 0 and non_sum > 0:
                w.loc[mask_us] *= target_us / us_sum
                w.loc[~mask_us] *= target_non / non_sum
            elif us_sum > 0 and non_sum <= 0:
                # Can't satisfy; stop trying
                w /= float(w.sum())
                break
            elif non_sum > 0 and us_sum <= 0:
                w /= float(w.sum())
                break

            # Optional: sector projection
            if sector_caps is not None:
                w = _apply_group_caps(w, sector_series, sector_caps)

            # Project onto per-ticker cap simplex
            w = _cap_and_renormalize_weights(w, cap_per_ticker=cap_per_ticker)

            # Convergence check (US weight close enough)
            us_now = float(w[mask_us].sum())
            if abs(us_now - target_us) < 1e-6 and float(w.max()) <= cap_per_ticker + 1e-9:
                break

        # Final tiny renormalize
        if float(w.sum()) > 0:
            w = w / float(w.sum())
        return w

    for dt in dates_to_apply:
        if dt in out.index:
            out.loc[dt] = _cap_row(out.loc[dt])

    out = out.ffill().fillna(0.0)
    return out


def _export_weights_by_rebalance_csv(
    out_path: Path,
    weights_raw: pd.DataFrame,
    rebalance_info: pd.DataFrame,
    convex_score: pd.DataFrame,
) -> None:
    """Uma linha por (data de rebalance executado, ticker) — formato alinhado ao export V3/V5."""
    meta_df = _load_company_meta_prefer_v3()
    out_path.parent.mkdir(parents=True, exist_ok=True)
    fieldnames = [
        "rebalance_date",
        "ticker",
        "company",
        "country",
        "zone",
        "sector",
        "rank",
        "score",
        "base_weight",
        "final_weight",
        "breadth_exposure",
        "vol_scale",
        "gross_exposure",
        "turnover",
    ]
    with out_path.open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames)
        w.writeheader()
        for dt in weights_raw.index:
            try:
                if not bool(rebalance_info.loc[dt, "rebalance_executed"]):
                    continue
            except Exception:
                continue
            wrow = weights_raw.loc[dt]
            pos = wrow[wrow > 1e-12]
            if pos.empty:
                continue
            dstr = pd.Timestamp(dt).strftime("%Y-%m-%d")
            try:
                turn = float(rebalance_info.loc[dt, "potential_turnover"])
            except Exception:
                turn = float("nan")
            sorted_pos = pos.sort_values(ascending=False)
            for rank, (ticker, wt) in enumerate(sorted_pos.items(), start=1):
                tkr = str(ticker).strip().upper()
                sc = 0.0
                try:
                    sc = float(convex_score.loc[dt, ticker])
                except Exception:
                    pass
                company = tkr
                country = ""
                zone = ""
                sector = ""
                if not meta_df.empty and "ticker" in meta_df.columns:
                    mr = meta_df.loc[meta_df["ticker"] == tkr]
                    if not mr.empty:
                        r0 = mr.iloc[0]
                        company = str(r0.get("company", "") or tkr).strip() or tkr
                        country = str(r0.get("country", "") or "").strip()
                        zone = str(r0.get("zone", "") or "").strip()
                        sector = str(r0.get("sector", "") or "").strip()
                w.writerow(
                    {
                        "rebalance_date": dstr,
                        "ticker": tkr,
                        "company": company,
                        "country": country,
                        "zone": zone,
                        "sector": sector,
                        "rank": rank,
                        "score": sc,
                        "base_weight": float(wt),
                        "final_weight": float(wt),
                        "breadth_exposure": "",
                        "vol_scale": "",
                        "gross_exposure": "",
                        "turnover": turn if math.isfinite(turn) else "",
                    }
                )


def _export_cash_sleeve_daily_csv(out_path: Path, dates_index: pd.Index, cash_sleeve: pd.Series) -> None:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    df = pd.DataFrame(
        {
            "date": [pd.Timestamp(x).strftime("%Y-%m-%d") for x in dates_index],
            "cash_sleeve": np.asarray(cash_sleeve, dtype=float),
        }
    )
    df.to_csv(out_path, index=False)


def _cash_sleeve_at_executed_rebalances(
    rebalance_info: pd.DataFrame, cash_sleeve_series: pd.Series
) -> Dict[str, float]:
    """Fração NAV em caixa/T-Bills em cada data de rebalance executado — para o histórico Next sem `cash_sleeve_daily.csv`."""
    out: Dict[str, float] = {}
    for dt in rebalance_info.index:
        try:
            if not bool(rebalance_info.loc[dt, "rebalance_executed"]):
                continue
        except Exception:
            continue
        if dt not in cash_sleeve_series.index:
            continue
        dstr = pd.Timestamp(dt).strftime("%Y-%m-%d")
        try:
            v = float(cash_sleeve_series.loc[dt])
        except Exception:
            continue
        if math.isfinite(v):
            out[dstr] = max(0.0, min(1.0, v))
    return out


def _export_v5_kpis_json(
    out_path: Path,
    summary: Dict[str, Any],
    config: ResearchConfig,
    prices: pd.DataFrame,
    data_file_used: str,
    latest_portfolio_date: str | None,
    latest_holdings_count: int,
    latest_weights_sum: float,
    max_effective_exposure: float | None,
    external_alpha_weight: float = 0.0,
    external_alpha_path: str | None = None,
    cash_sleeve_at_rebalance: Dict[str, float] | None = None,
) -> None:
    """Payload próximo do `v5_kpis.json` do freeze (dashboard / histórico)."""

    def _num(x: Any) -> float | None:
        try:
            if x is None:
                return None
            v = float(x)
            return v if math.isfinite(v) else None
        except Exception:
            return None

    pl: Dict[str, Any] = {
        "benchmark_cagr": _num(summary.get("benchmark_cagr")),
        "overlayed_cagr": _num(summary.get("overlayed_cagr")),
        "overlayed_sharpe": _num(summary.get("overlayed_sharpe")),
        "data_start": str(prices.index.min().date()) if len(prices.index) else None,
        "data_end": str(prices.index.max().date()) if len(prices.index) else None,
        "profile": str(config.profile),
        "cap_per_ticker": float(config.cap_per_ticker),
        "n_rebalance_opportunities": int(summary.get("n_rebalance_opportunities") or 0),
        "n_rebalance_executed": int(summary.get("n_rebalance_executed") or 0),
        "avg_executed_turnover_rebalance": _num(summary.get("avg_executed_turnover_rebalance")),
        "avg_holdings_count": _num(summary.get("avg_holdings_count")),
        "avg_cash_sleeve": _num(summary.get("avg_cash_sleeve")),
        "latest_cash_sleeve": _num(summary.get("latest_cash_sleeve")),
        "avg_trend_exposure": _num(summary.get("avg_trend_exposure")),
        "risk_on_exposure": float(config.risk_on_exposure),
        "cash_proxy_ticker": "TBILL_PROXY",
        "max_effective_exposure": max_effective_exposure,
        "top_q": int(config.top_q),
        "rank_in": int(config.rank_in),
        "rank_out": int(config.rank_out),
        "monthly_rebalance_only": bool(config.monthly_rebalance_only),
        "monthly_rebalance_turnover_threshold": float(config.monthly_rebalance_turnover_threshold),
        "lookback_120_days": int(config.lookback_120_days),
        "lookback_60_days": int(config.lookback_60_days),
        "lookback_20_days": int(config.lookback_20_days),
        "mom_120_weight": float(config.mom_120_weight),
        "mom_60_weight": float(config.mom_60_weight),
        "mom_20_weight": float(config.mom_20_weight),
        "selection_buffer_asymmetric": bool(config.selection_buffer_asymmetric),
        "rank_in_entry": int(config.rank_in_entry),
        "rank_maintain": int(config.rank_maintain),
        "rebalance_min_abs_weight_delta": config.rebalance_min_abs_weight_delta,
        "momentum_mode": str(config.momentum_mode),
        "momentum_winsorize_quantile": config.momentum_winsorize_quantile,
        "convex_power": float(config.convex_power),
        "score_threshold": float(config.score_threshold),
        "external_alpha_weight": float(external_alpha_weight),
        "external_alpha_path": external_alpha_path,
        "transaction_cost_bps": float(config.transaction_cost_bps),
        "slippage_bps": float(config.slippage_bps),
        "fx_conversion_bps": float(config.fx_conversion_bps),
        "total_turnover_friction_bps": float(
            config.transaction_cost_bps + config.slippage_bps + config.fx_conversion_bps
        ),
        "execution_lag_days": int(summary.get("execution_lag_days") or 0),
        "mean_daily_friction_bps_equiv": _num(summary.get("mean_daily_friction_bps_equiv")),
        "breadth_min": float(config.breadth_min),
        "breadth_max": float(config.breadth_max),
        "benchmark_ma_window": int(config.benchmark_ma_window),
        "risk_off_exposure": float(config.risk_off_exposure),
        "vol_spike_enabled": bool(config.vol_spike_enabled),
        "vol_spike_short_window": int(config.vol_spike_short_window),
        "vol_spike_long_window": int(config.vol_spike_long_window),
        "vol_spike_ratio_threshold": float(config.vol_spike_ratio_threshold),
        "vol_spike_exposure": float(config.vol_spike_exposure),
        "drawdown_enabled": bool(config.drawdown_enabled),
        "drawdown_threshold_1": float(config.drawdown_threshold_1),
        "drawdown_exposure_1": float(config.drawdown_exposure_1),
        "drawdown_threshold_2": float(config.drawdown_threshold_2),
        "drawdown_exposure_2": float(config.drawdown_exposure_2),
        "vol_target_window": int(config.vol_target_window),
        "vol_scale_floor": float(config.vol_scale_floor),
        "vol_scale_cap": float(config.vol_scale_cap),
        "overlay_target_vol_realization_boost": float(config.overlay_target_vol_realization_boost),
        "bear_low_vol_overlay_enabled": bool(getattr(config, "bear_low_vol_overlay_enabled", False)),
        "bear_low_vol_bench_vol_window": int(getattr(config, "bear_low_vol_bench_vol_window", 63)),
        "bear_low_vol_exposure_mult": float(getattr(config, "bear_low_vol_exposure_mult", 0.85)),
        "bear_low_vol_tiered": bool(getattr(config, "bear_low_vol_tiered", False)),
        "bear_low_vol_bear_ma_window": int(getattr(config, "bear_low_vol_bear_ma_window", 252)),
        "bear_low_vol_quantile_min_periods": int(getattr(config, "bear_low_vol_quantile_min_periods", 252)),
        "avg_bear_low_vol_exposure": _num(summary.get("avg_bear_low_vol_exposure")),
        "pct_days_bear_low_vol_active": _num(summary.get("pct_days_bear_low_vol_active")),
        "pct_days_bear_low_vol_tier_085": _num(summary.get("pct_days_bear_low_vol_tier_085")),
        "pct_days_bear_low_vol_tier_090": _num(summary.get("pct_days_bear_low_vol_tier_090")),
        "pct_days_bear_low_vol_tier_095": _num(summary.get("pct_days_bear_low_vol_tier_095")),
        "bear_low_vol_hysteresis": bool(getattr(config, "bear_low_vol_hysteresis", False)),
        "bear_low_vol_hysteresis_entry_quantile": float(getattr(config, "bear_low_vol_hysteresis_entry_quantile", 0.30)),
        "bear_low_vol_hysteresis_exit_quantile": float(getattr(config, "bear_low_vol_hysteresis_exit_quantile", 0.55)),
        "bear_low_vol_hysteresis_exit_consecutive_days": int(
            getattr(config, "bear_low_vol_hysteresis_exit_consecutive_days", 10)
        ),
        "bear_low_vol_hysteresis_bear_ma_window": int(getattr(config, "bear_low_vol_hysteresis_bear_ma_window", 252)),
        "bear_low_vol_hysteresis_entry_edges": summary.get("bear_low_vol_hysteresis_entry_edges"),
        "pct_days_bear_low_vol_protection_last_12m": _num(summary.get("bear_low_vol_protection_pct_days_last_12m")),
        "bear_low_vol_protection_entry_edges_last_12m": int(
            summary.get("bear_low_vol_protection_entry_edges_last_12m") or 0
        ),
        "bear_low_vol_explainability_pt": (
            "Em ambientes de bear market com volatilidade anormalmente baixa (frequente antes de stress), "
            "reduzimos temporariamente a exposição. Usamos histerese para evitar 'pisca-pisca': só entramos "
            "quando o sinal é forte e só saímos quando normaliza."
        ),
        "data_file_used": str(data_file_used),
        "n_obs": int(len(prices.index)),
        "latest_portfolio_date": latest_portfolio_date,
        "latest_holdings_count": int(latest_holdings_count),
        "latest_weights_sum": float(latest_weights_sum),
    }
    if cash_sleeve_at_rebalance:
        pl["cash_sleeve_at_rebalance"] = cash_sleeve_at_rebalance
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(pl, indent=2, ensure_ascii=False), encoding="utf-8")


def run_research_v1(
    prices_path: str | Path | None = None,
    start_date: str | None = None,
    end_date: str | None = None,
    profile: str = "moderado",
    cap_per_ticker: float | None = None,
    transaction_cost_bps: float | None = None,
    slippage_bps: float | None = None,
    fx_conversion_bps: float | None = None,
    execution_lag_days: int = 0,
    rank_in: int | None = None,
    rank_out: int | None = None,
    mom_120_weight: float | None = None,
    mom_60_weight: float | None = None,
    mom_20_weight: float | None = None,
    convex_power: float | None = None,
    external_alpha_path: str | Path | None = None,
    external_alpha_weight: float = 0.0,
    vol_spike_enabled: bool | None = None,
    drawdown_enabled: bool | None = None,
    max_effective_exposure: float | None = None,
    monthly_rebalance_only: bool | None = None,
    monthly_rebalance_turnover_threshold: float | None = None,
    extraordinary_rebalance_enabled: bool | None = None,
    extraordinary_model_lookback_days: int | None = None,
    extraordinary_model_p90_abs_score_delta_min: float | None = None,
    extraordinary_model_abs_score_delta_quantile: float | None = None,
    extraordinary_model_mean_abs_score_delta_min: float | None = None,
    extraordinary_model_min_names_for_delta: int | None = None,
    extraordinary_benchmark_cumret_max: float | None = None,
    extraordinary_benchmark_cumret_min: float | None = None,
    extraordinary_breadth_below: float | None = None,
    extraordinary_benchmark_lookback_days: int | None = None,
    extraordinary_rebalance_turnover_threshold: float | None = None,
    extraordinary_max_per_calendar_year: int | None = None,
    selection_buffer_asymmetric: bool | None = None,
    rank_in_entry: int | None = None,
    rank_maintain: int | None = None,
    rebalance_min_abs_weight_delta: float | None = None,
    momentum_mode: str | None = None,
    momentum_winsorize_quantile: float | None = None,
    emit_weights_csv: str | Path | None = None,
    emit_cash_sleeve_daily_csv: str | Path | None = None,
    emit_v5_kpis_json: str | Path | None = None,
    bear_low_vol_overlay_enabled: bool | None = None,
    bear_low_vol_bench_vol_window: int | None = None,
    bear_low_vol_exposure_mult: float | None = None,
    bear_low_vol_tiered: bool | None = None,
    bear_low_vol_bear_ma_window: int | None = None,
    bear_low_vol_quantile_min_periods: int | None = None,
    bear_low_vol_hysteresis: bool | None = None,
    bear_low_vol_hysteresis_entry_quantile: float | None = None,
    bear_low_vol_hysteresis_exit_quantile: float | None = None,
    bear_low_vol_hysteresis_exit_consecutive_days: int | None = None,
    bear_low_vol_hysteresis_bear_ma_window: int | None = None,
    vol_target_window: int | None = None,
    vol_scale_floor: float | None = None,
    vol_scale_cap: float | None = None,
    top_q: int | None = None,
    benchmark_ma_window: int | None = None,
    sector_cluster_cap_enabled: bool | None = None,
    sector_cap: float | None = None,
    cluster_cap: float | None = None,
    cluster_map_path: str | Path | None = None,
    crash_overlay_2of3_enabled: bool | None = None,
    crash_breadth_threshold: float | None = None,
    crash_dd_window: int | None = None,
    crash_dd_threshold: float | None = None,
    crash_exposure_2_signals: float | None = None,
    crash_exposure_3_signals: float | None = None,
    crash_exit_consecutive_days: int | None = None,
) -> Dict[str, Any]:
    config = ResearchConfig(profile=profile)
    if transaction_cost_bps is not None:
        config.transaction_cost_bps = float(transaction_cost_bps)
    if slippage_bps is not None:
        config.slippage_bps = float(slippage_bps)
    if fx_conversion_bps is not None:
        config.fx_conversion_bps = float(fx_conversion_bps)
    if cap_per_ticker is not None:
        config.cap_per_ticker = float(cap_per_ticker)
    if rank_in is not None:
        config.rank_in = int(rank_in)
    if rank_out is not None:
        config.rank_out = int(rank_out)
    if mom_120_weight is not None:
        config.mom_120_weight = float(mom_120_weight)
    if mom_60_weight is not None:
        config.mom_60_weight = float(mom_60_weight)
    if mom_20_weight is not None:
        config.mom_20_weight = float(mom_20_weight)
    if convex_power is not None:
        config.convex_power = float(convex_power)
    if vol_spike_enabled is not None:
        config.vol_spike_enabled = bool(vol_spike_enabled)
    if drawdown_enabled is not None:
        config.drawdown_enabled = bool(drawdown_enabled)
    if monthly_rebalance_only is not None:
        config.monthly_rebalance_only = bool(monthly_rebalance_only)
    if monthly_rebalance_turnover_threshold is not None:
        config.monthly_rebalance_turnover_threshold = float(monthly_rebalance_turnover_threshold)
    if extraordinary_rebalance_enabled is not None:
        config.extraordinary_rebalance_enabled = bool(extraordinary_rebalance_enabled)
    if extraordinary_model_lookback_days is not None:
        config.extraordinary_model_lookback_days = int(extraordinary_model_lookback_days)
    if extraordinary_model_p90_abs_score_delta_min is not None:
        config.extraordinary_model_p90_abs_score_delta_min = float(extraordinary_model_p90_abs_score_delta_min)
    if extraordinary_model_abs_score_delta_quantile is not None:
        config.extraordinary_model_abs_score_delta_quantile = float(extraordinary_model_abs_score_delta_quantile)
    if extraordinary_model_mean_abs_score_delta_min is not None:
        config.extraordinary_model_mean_abs_score_delta_min = float(extraordinary_model_mean_abs_score_delta_min)
    if extraordinary_model_min_names_for_delta is not None:
        config.extraordinary_model_min_names_for_delta = int(extraordinary_model_min_names_for_delta)
    if extraordinary_benchmark_cumret_max is not None:
        config.extraordinary_benchmark_cumret_max = float(extraordinary_benchmark_cumret_max)
    if extraordinary_benchmark_cumret_min is not None:
        config.extraordinary_benchmark_cumret_min = float(extraordinary_benchmark_cumret_min)
    if extraordinary_breadth_below is not None:
        config.extraordinary_breadth_below = float(extraordinary_breadth_below)
    if extraordinary_benchmark_lookback_days is not None:
        config.extraordinary_benchmark_lookback_days = int(extraordinary_benchmark_lookback_days)
    if extraordinary_rebalance_turnover_threshold is not None:
        config.extraordinary_rebalance_turnover_threshold = float(extraordinary_rebalance_turnover_threshold)
    if extraordinary_max_per_calendar_year is not None:
        config.extraordinary_max_per_calendar_year = int(extraordinary_max_per_calendar_year)
    if selection_buffer_asymmetric is not None:
        config.selection_buffer_asymmetric = bool(selection_buffer_asymmetric)
    if rank_in_entry is not None:
        config.rank_in_entry = int(rank_in_entry)
    if rank_maintain is not None:
        config.rank_maintain = int(rank_maintain)
    if rebalance_min_abs_weight_delta is not None:
        config.rebalance_min_abs_weight_delta = float(rebalance_min_abs_weight_delta)
    if momentum_mode is not None:
        config.momentum_mode = str(momentum_mode).strip().lower()
    if momentum_winsorize_quantile is not None:
        config.momentum_winsorize_quantile = float(momentum_winsorize_quantile)
    if bear_low_vol_overlay_enabled is not None:
        config.bear_low_vol_overlay_enabled = bool(bear_low_vol_overlay_enabled)
    if bear_low_vol_bench_vol_window is not None:
        config.bear_low_vol_bench_vol_window = int(bear_low_vol_bench_vol_window)
    if bear_low_vol_exposure_mult is not None:
        config.bear_low_vol_exposure_mult = float(bear_low_vol_exposure_mult)
    if bear_low_vol_tiered is not None:
        config.bear_low_vol_tiered = bool(bear_low_vol_tiered)
    if bear_low_vol_bear_ma_window is not None:
        config.bear_low_vol_bear_ma_window = int(bear_low_vol_bear_ma_window)
    if bear_low_vol_quantile_min_periods is not None:
        config.bear_low_vol_quantile_min_periods = int(bear_low_vol_quantile_min_periods)
    if bear_low_vol_hysteresis is not None:
        config.bear_low_vol_hysteresis = bool(bear_low_vol_hysteresis)
    if bear_low_vol_hysteresis_entry_quantile is not None:
        config.bear_low_vol_hysteresis_entry_quantile = float(bear_low_vol_hysteresis_entry_quantile)
    if bear_low_vol_hysteresis_exit_quantile is not None:
        config.bear_low_vol_hysteresis_exit_quantile = float(bear_low_vol_hysteresis_exit_quantile)
    if bear_low_vol_hysteresis_exit_consecutive_days is not None:
        config.bear_low_vol_hysteresis_exit_consecutive_days = int(bear_low_vol_hysteresis_exit_consecutive_days)
    if bear_low_vol_hysteresis_bear_ma_window is not None:
        config.bear_low_vol_hysteresis_bear_ma_window = int(bear_low_vol_hysteresis_bear_ma_window)
    if vol_target_window is not None:
        config.vol_target_window = int(vol_target_window)
    if vol_scale_floor is not None:
        config.vol_scale_floor = float(vol_scale_floor)
    if vol_scale_cap is not None:
        config.vol_scale_cap = float(vol_scale_cap)
    if top_q is not None:
        config.top_q = int(top_q)
    if benchmark_ma_window is not None:
        config.benchmark_ma_window = int(benchmark_ma_window)
    if sector_cluster_cap_enabled is not None:
        config.sector_cluster_cap_enabled = bool(sector_cluster_cap_enabled)
    if sector_cap is not None:
        config.sector_cap = float(sector_cap)
    if cluster_cap is not None:
        config.cluster_cap = float(cluster_cap)
    if cluster_map_path is not None:
        config.cluster_map_path = str(cluster_map_path)
    if crash_overlay_2of3_enabled is not None:
        config.crash_overlay_2of3_enabled = bool(crash_overlay_2of3_enabled)
    if crash_breadth_threshold is not None:
        config.crash_breadth_threshold = float(crash_breadth_threshold)
    if crash_dd_window is not None:
        config.crash_dd_window = int(crash_dd_window)
    if crash_dd_threshold is not None:
        config.crash_dd_threshold = float(crash_dd_threshold)
    if crash_exposure_2_signals is not None:
        config.crash_exposure_2_signals = float(crash_exposure_2_signals)
    if crash_exposure_3_signals is not None:
        config.crash_exposure_3_signals = float(crash_exposure_3_signals)
    if crash_exit_consecutive_days is not None:
        config.crash_exit_consecutive_days = int(crash_exit_consecutive_days)
    # Vol target na perna crua (vol_scale_raw): todos os perfis, multiplicador vs bench (moderado = 1×).
    # Na perna overlay: todos os perfis aplicam vol_scale_overlay (moderado = 1× bench; conservador 0,75×; dinâmico 1,25×).

    prices = load_prices(Path(prices_path) if prices_path else None)
    if start_date is not None:
        prices = prices.loc[prices.index >= pd.Timestamp(start_date)]
    if end_date is not None:
        prices = prices.loc[prices.index <= pd.Timestamp(end_date)]
    if prices.empty:
        raise ValueError("Intervalo de datas vazio após start_date/end_date.")
    returns = compute_returns(prices)
    external_alpha = _load_external_alpha_matrix(external_alpha_path, prices.index, [str(c) for c in prices.columns.tolist()])

    benchmark_returns = compute_benchmark_returns(returns)
    benchmark_equity = compute_equity_curve(benchmark_returns)
    benchmark_price = compute_benchmark_price(prices)

    weights_raw, holdings_count, raw_momentum, convex_score, rebalance_info = build_buffered_portfolio_weights(
        prices=prices,
        config=config,
        external_alpha=external_alpha,
        external_alpha_weight=external_alpha_weight,
    )
    sector_cluster_caps_diag: dict[str, Any] = {
        "enabled": bool(getattr(config, "sector_cluster_cap_enabled", False)),
        "applied_rebalances": 0,
        "latest_sector_exposure": {},
        "latest_cluster_exposure": {},
    }
    if bool(getattr(config, "sector_cluster_cap_enabled", False)):
        rb_mask = rebalance_info["rebalance_executed"].fillna(False).astype(bool)
        rb_dates = [pd.Timestamp(x) for x in rebalance_info.index[rb_mask].tolist()]
        weights_raw, sector_cluster_caps_diag = _apply_sector_cluster_caps_to_weights(
            weights=weights_raw,
            dates_to_apply=rb_dates,
            cap_per_ticker=float(config.cap_per_ticker),
            sector_cap=float(config.sector_cap),
            cluster_cap=float(config.cluster_cap),
            cluster_map_path=getattr(config, "cluster_map_path", None),
        )
        sector_cluster_caps_diag["enabled"] = True
        sector_cluster_caps_diag["applied_rebalances"] = int(len(rb_dates))

    raw_returns, turnover, raw_returns_gross = compute_raw_portfolio_returns(
        weights=weights_raw,
        returns=returns,
        transaction_cost_bps=config.transaction_cost_bps,
        execution_lag_days=int(execution_lag_days),
        slippage_bps=config.slippage_bps,
        fx_conversion_bps=config.fx_conversion_bps,
    )
    cost_per_day = raw_returns_gross - raw_returns
    equity_raw = compute_equity_curve(raw_returns)

    vol_scale_raw = compute_vol_target_scale(
        strategy_returns=raw_returns_gross,
        benchmark_returns=benchmark_returns,
        config=config,
        target_boost=1.0,
    )
    raw_vm_returns = raw_returns_gross * vol_scale_raw.shift(1).fillna(1.0) - cost_per_day
    equity_raw_volmatched = compute_equity_curve(raw_vm_returns)

    breadth_scale = compute_breadth_overlay(
        raw_momentum=raw_momentum,
        config=config,
    )

    trend_df = compute_trend_regime_filter(
        benchmark_price=benchmark_price,
        config=config,
    )
    trend_exposure = trend_df["exposure"]

    vol_spike_exposure = compute_vol_spike_exposure(
        benchmark_returns=benchmark_returns,
        config=config,
    )
    drawdown_exposure = compute_drawdown_trigger_exposure(
        benchmark_equity=benchmark_equity,
        config=config,
    )

    bear_low_vol_exposure = compute_bear_low_vol_exposure(
        benchmark_returns=benchmark_returns,
        trend_df=trend_df,
        config=config,
        benchmark_price=benchmark_price,
    )
    crash_overlay_df = compute_crash_overlay_2of3(
        benchmark_price=benchmark_price,
        raw_momentum=raw_momentum,
        config=config,
    )
    _base_exposure_stack = (
        breadth_scale.shift(1).fillna(1.0)
        * trend_exposure.shift(1).fillna(config.risk_on_exposure)
        * pd.Series(vol_spike_exposure, index=prices.index).shift(1).fillna(1.0)
        * pd.Series(drawdown_exposure, index=prices.index).shift(1).fillna(1.0)
        * bear_low_vol_exposure.shift(1).fillna(1.0)
    )
    crash_cap_shifted = crash_overlay_df["max_exposure_cap"].shift(1).fillna(1.0).astype(float)
    crash_multiplier = (crash_cap_shifted / _base_exposure_stack.replace(0.0, np.nan)).clip(upper=1.0).fillna(1.0)
    _exposure_stack = _base_exposure_stack * crash_multiplier
    # KPI pré-vol: com fricção (interpretação económica antes do escalonamento).
    overlay_pre_vol_returns = raw_returns * _exposure_stack
    equity_overlay_pre_vol = compute_equity_curve(overlay_pre_vol_returns)

    # Vol target sobre perna arriscada bruta; fricção aplicada depois (não diluir custos via scale↑).
    overlay_risk_gross_pre_scale = raw_returns_gross * _exposure_stack

    vol_scale_overlay = compute_vol_target_scale(
        strategy_returns=overlay_risk_gross_pre_scale,
        benchmark_returns=benchmark_returns,
        config=config,
        target_boost=config.overlay_target_vol_realization_boost,
    )
    overlayed_returns = overlay_risk_gross_pre_scale * vol_scale_overlay.shift(1).fillna(1.0)
    cash_proxy_ticker = "TBILL_PROXY"
    if cash_proxy_ticker in returns.columns:
        cash_proxy_returns = pd.Series(returns[cash_proxy_ticker], index=prices.index).fillna(0.0)
    else:
        cash_proxy_returns = pd.Series(0.0, index=prices.index)

    effective_exposure_proxy = _exposure_stack * pd.Series(vol_scale_overlay, index=prices.index).shift(1).fillna(1.0)
    cash_sleeve = (1.0 - effective_exposure_proxy).clip(lower=0.0)
    overlayed_returns = overlayed_returns + cash_sleeve * cash_proxy_returns

    # Perna overlay completa (CAP15) **antes** do teto NAV 100%: gross×stack×vol_overlay + T-Bill,
    # mesma fricção `cost_per_day` que o investível. Permite exposição efectiva > 100% quando E>1.
    overlayed_blend_pre_cap = overlayed_returns
    overlay_margin_returns = overlayed_blend_pre_cap - cost_per_day
    equity_overlay_margin = compute_equity_curve(overlay_margin_returns)

    # Teto na exposição bruta (ex.: 1.0 = nunca mais de 100% do capital em perna arriscada
    # vs caixa/T-Bill; mantém cap_per_ticker e restantes overlays).
    if max_effective_exposure is not None:
        cap_g = float(max_effective_exposure)
        E = pd.Series(effective_exposure_proxy, index=prices.index).astype(float)
        Eeff = E.clip(upper=cap_g)
        cash_sleeve = (cap_g - Eeff).clip(lower=0.0)
        risky_part = overlayed_blend_pre_cap - (1.0 - E).clip(lower=0.0) * cash_proxy_returns
        scale = (Eeff / E.replace(0.0, np.nan)).fillna(0.0)
        overlayed_returns = risky_part * scale + (1.0 - Eeff) * cash_proxy_returns - cost_per_day
    else:
        overlayed_returns = overlay_margin_returns

    equity_overlayed = compute_equity_curve(overlayed_returns)

    turnover_daily_export = turnover.reindex(prices.index).fillna(0.0).astype(float)

    n_rebalance_opportunities = int(rebalance_info["rebalance_opportunity"].sum())
    n_rebalance_executed = int(rebalance_info["rebalance_executed"].sum())
    n_rebalance_skipped = int(n_rebalance_opportunities - n_rebalance_executed)
    ex_col = rebalance_info["extraordinary"].fillna(False).astype(bool)
    n_extraordinary_opportunities = int(ex_col.sum())
    n_extraordinary_executed = int((ex_col & rebalance_info["rebalance_executed"].fillna(False).astype(bool)).sum())

    executed_turnovers = rebalance_info.loc[rebalance_info["rebalance_executed"], "potential_turnover"]
    all_potential_turnovers = rebalance_info.loc[rebalance_info["rebalance_opportunity"], "potential_turnover"]

    cash_sleeve_series = pd.Series(cash_sleeve)
    _last_cash = float(cash_sleeve_series.iloc[-1]) if len(cash_sleeve_series) else 0.0
    _last_eq = float(max(0.0, min(1.0, 1.0 - _last_cash)))
    _blv_s = pd.Series(bear_low_vol_exposure, dtype=float)
    _n_blv = len(_blv_s)
    _tail_blv = min(TRADING_DAYS, _n_blv) if _n_blv else 0
    if _tail_blv > 0:
        _t_blv = _blv_s.iloc[-_tail_blv:]
        _prot_blv = (_t_blv < 1.0 - 1e-12).to_numpy(dtype=bool)
        blv_pct_days_last_12m = float(_prot_blv.mean() * 100.0)
        _prev = np.empty_like(_prot_blv)
        _prev[0] = False
        if _prot_blv.size > 1:
            _prev[1:] = _prot_blv[:-1]
        blv_edges_last_12m = int(np.sum(_prot_blv & ~_prev))
    else:
        blv_pct_days_last_12m = 0.0
        blv_edges_last_12m = 0
    summary = {
        "benchmark_cagr": annualized_return(benchmark_returns),
        "raw_cagr": annualized_return(raw_returns),
        "raw_volmatched_cagr": annualized_return(raw_vm_returns),
        "overlay_pre_vol_cagr": annualized_return(overlay_pre_vol_returns),
        "overlayed_cagr": annualized_return(overlayed_returns),
        "overlay_margin_cagr": annualized_return(overlay_margin_returns),

        "benchmark_sharpe": sharpe_ratio(benchmark_returns),
        "raw_sharpe": sharpe_ratio(raw_returns),
        "raw_volmatched_sharpe": sharpe_ratio(raw_vm_returns),
        "overlay_pre_vol_sharpe": sharpe_ratio(overlay_pre_vol_returns),
        "overlayed_sharpe": sharpe_ratio(overlayed_returns),
        "overlay_margin_sharpe": sharpe_ratio(overlay_margin_returns),

        "avg_vol_scale_raw": float(pd.Series(vol_scale_raw).mean()),
        "avg_vol_scale_overlay": float(pd.Series(vol_scale_overlay).mean()),
        "min_vol_scale_overlay": float(pd.Series(vol_scale_overlay).min()),
        "max_vol_scale_overlay": float(pd.Series(vol_scale_overlay).max()),

        "avg_breadth_scale": float(pd.Series(breadth_scale).mean()),
        "min_breadth_scale": float(pd.Series(breadth_scale).min()),
        "max_breadth_scale": float(pd.Series(breadth_scale).max()),

        "avg_trend_exposure": float(pd.Series(trend_exposure).mean()),
        "min_trend_exposure": float(pd.Series(trend_exposure).min()),
        "max_trend_exposure": float(pd.Series(trend_exposure).max()),

        "vol_spike_enabled": bool(config.vol_spike_enabled),
        "avg_vol_spike_exposure": float(pd.Series(vol_spike_exposure).mean()),
        "min_vol_spike_exposure": float(pd.Series(vol_spike_exposure).min()),
        "max_vol_spike_exposure": float(pd.Series(vol_spike_exposure).max()),

        "drawdown_enabled": bool(config.drawdown_enabled),
        "avg_drawdown_exposure": float(pd.Series(drawdown_exposure).mean()),
        "min_drawdown_exposure": float(pd.Series(drawdown_exposure).min()),
        "max_drawdown_exposure": float(pd.Series(drawdown_exposure).max()),

        "bear_low_vol_overlay_enabled": bool(getattr(config, "bear_low_vol_overlay_enabled", False)),
        "avg_bear_low_vol_exposure": float(pd.Series(bear_low_vol_exposure).mean()),
        "min_bear_low_vol_exposure": float(pd.Series(bear_low_vol_exposure).min()),
        "max_bear_low_vol_exposure": float(pd.Series(bear_low_vol_exposure).max()),
        "pct_days_bear_low_vol_active": float((pd.Series(bear_low_vol_exposure) < 1.0 - 1e-12).mean() * 100.0),
        "bear_low_vol_tiered": bool(getattr(config, "bear_low_vol_tiered", False)),
        "pct_days_bear_low_vol_tier_085": float((np.isclose(pd.Series(bear_low_vol_exposure).to_numpy(dtype=float), 0.85)).mean() * 100.0)
        if bool(getattr(config, "bear_low_vol_tiered", False))
        else 0.0,
        "pct_days_bear_low_vol_tier_090": float((np.isclose(pd.Series(bear_low_vol_exposure).to_numpy(dtype=float), 0.90)).mean() * 100.0)
        if bool(getattr(config, "bear_low_vol_tiered", False))
        else 0.0,
        "pct_days_bear_low_vol_tier_095": float((np.isclose(pd.Series(bear_low_vol_exposure).to_numpy(dtype=float), 0.95)).mean() * 100.0)
        if bool(getattr(config, "bear_low_vol_tiered", False))
        else 0.0,
        "bear_low_vol_hysteresis": bool(getattr(config, "bear_low_vol_hysteresis", False)),
        "bear_low_vol_hysteresis_entry_edges": int(
            (
                (pd.Series(bear_low_vol_exposure) < 1.0 - 1e-12)
                & ~(pd.Series(bear_low_vol_exposure).shift(1) < 1.0 - 1e-12).fillna(False)
            ).sum()
        )
        if bool(getattr(config, "bear_low_vol_hysteresis", False))
        else 0,
        "bear_low_vol_protection_pct_days_last_12m": blv_pct_days_last_12m,
        "bear_low_vol_protection_entry_edges_last_12m": blv_edges_last_12m,
        "sector_cluster_cap_enabled": bool(getattr(config, "sector_cluster_cap_enabled", False)),
        "sector_cluster_caps_diagnostics": sector_cluster_caps_diag,
        "crash_overlay_2of3_enabled": bool(getattr(config, "crash_overlay_2of3_enabled", False)),
        "pct_days_crash_overlay_active": float(crash_overlay_df["active_state"].mean() * 100.0),
        "crash_overlay_entry_edges": int(
            (crash_overlay_df["active_state"] & ~crash_overlay_df["active_state"].shift(1, fill_value=False)).sum()
        ),
        "avg_crash_overlay_cap": float(pd.Series(crash_overlay_df["max_exposure_cap"], dtype=float).mean()),

        "cap_per_ticker": float(config.cap_per_ticker),
        "external_alpha_weight": float(external_alpha_weight),
        "transaction_cost_bps": float(config.transaction_cost_bps),
        "slippage_bps": float(config.slippage_bps),
        "fx_conversion_bps": float(config.fx_conversion_bps),
        "total_turnover_friction_bps": float(
            config.transaction_cost_bps + config.slippage_bps + config.fx_conversion_bps
        ),
        "execution_lag_days": int(execution_lag_days),
        "vol_target_window": int(config.vol_target_window),
        "overlay_target_vol_realization_boost": float(config.overlay_target_vol_realization_boost),

        "avg_holdings_count": float(holdings_count["holdings_count"].mean()),
        "min_holdings_count": int(holdings_count["holdings_count"].min()) if len(holdings_count) else 0,
        "max_holdings_count": int(holdings_count["holdings_count"].max()) if len(holdings_count) else 0,

        "avg_turnover": float(pd.Series(turnover).mean()),
        "max_turnover": float(pd.Series(turnover).max()),
        "mean_daily_friction_drag": float(pd.Series(cost_per_day).mean()),
        "mean_daily_friction_bps_equiv": float(pd.Series(cost_per_day).mean() * 10000.0),

        "monthly_rebalance_turnover_threshold": float(config.monthly_rebalance_turnover_threshold),
        "n_rebalance_opportunities": n_rebalance_opportunities,
        "n_rebalance_executed": n_rebalance_executed,
        "n_rebalance_skipped": n_rebalance_skipped,
        "n_extraordinary_opportunities": n_extraordinary_opportunities,
        "n_extraordinary_executed": n_extraordinary_executed,
        "avg_potential_turnover_rebalance": float(all_potential_turnovers.mean()) if len(all_potential_turnovers) else 0.0,
        "avg_executed_turnover_rebalance": float(executed_turnovers.mean()) if len(executed_turnovers) else 0.0,
        "avg_cash_sleeve": float(cash_sleeve_series.mean()),
        "max_cash_sleeve": float(cash_sleeve_series.max()),
        "latest_cash_sleeve": _last_cash,
        # Aliases esperados pelo dashboard Next (alinhamento NAV na tabela de carteira)
        "current_cash_sleeve": _last_cash,
        "current_equity_exposure": _last_eq,
        "cash_proxy_ticker": cash_proxy_ticker,

        "data_file_used": str(find_prices_file()),
        "data_start": str(prices.index.min().date()) if len(prices.index) else None,
        "data_end": str(prices.index.max().date()) if len(prices.index) else None,
        "n_obs": int(len(prices.index)),
    }

    overlay_kpis = _make_kpis_from_returns_and_equity(overlayed_returns, equity_overlayed)
    overlay_margin_kpis = _make_kpis_from_returns_and_equity(overlay_margin_returns, equity_overlay_margin)
    benchmark_kpis = _make_kpis_from_returns_and_equity(benchmark_returns, benchmark_equity)
    raw_kpis = _make_kpis_from_returns_and_equity(raw_returns, equity_raw)
    raw_vm_kpis = _make_kpis_from_returns_and_equity(raw_vm_returns, equity_raw_volmatched)
    overlay_pre_vol_kpis = _make_kpis_from_returns_and_equity(overlay_pre_vol_returns, equity_overlay_pre_vol)

    latest_weights_series = pd.Series(dtype=float)
    latest_portfolio_date = None
    latest_holdings = []
    latest_weights = []
    latest_holdings_detailed = []
    company_meta_df = _load_company_meta_prefer_v3()

    if len(weights_raw.index):
        latest_portfolio_date = str(weights_raw.index[-1].date())
        latest_weights_series = weights_raw.iloc[-1].fillna(0.0)
        latest_weights_series = latest_weights_series[latest_weights_series > 0].sort_values(ascending=False)

        latest_holdings = [str(x) for x in latest_weights_series.index.tolist()]
        latest_weights = [float(x) for x in latest_weights_series.tolist()]

        latest_holdings_detailed = []
        latest_dt = latest_weights_series.name
        latest_score_series = pd.Series(dtype=float)

        try:
            if latest_dt in convex_score.index:
                latest_score_series = convex_score.loc[latest_dt]
        except Exception:
            latest_score_series = pd.Series(dtype=float)

        for i, (ticker, weight) in enumerate(latest_weights_series.items()):
            ticker_str = str(ticker).strip().upper()
            meta_row = _meta_row_for_ticker(company_meta_df, ticker_str)

            score_value = 0.0
            try:
                if ticker_str in latest_score_series.index:
                    raw_score_value = latest_score_series.loc[ticker_str]
                    if pd.isna(raw_score_value):
                        score_value = 0.0
                    else:
                        score_value = float(raw_score_value)
            except Exception:
                score_value = 0.0

            latest_holdings_detailed.append(
                {
                    "ticker": ticker_str,
                    "short_name": (meta_row.get("short_name") or ticker_str),
                    "name": (meta_row.get("name") or meta_row.get("short_name") or ticker_str),
                    "weight": float(weight),
                    "weight_pct": float(weight) * 100.0,
                    "score": score_value,
                    "rank_momentum": int(i + 1),
                    "region": (meta_row.get("region") or ""),
                    "sector": (meta_row.get("sector") or ""),
                }
            )

    data_file_used_str = str(Path(prices_path).resolve()) if prices_path else str(find_prices_file())
    eap_str = str(Path(external_alpha_path).resolve()) if external_alpha_path else None

    if emit_weights_csv:
        _export_weights_by_rebalance_csv(
            Path(emit_weights_csv),
            weights_raw,
            rebalance_info,
            convex_score,
        )
    if emit_cash_sleeve_daily_csv:
        _export_cash_sleeve_daily_csv(Path(emit_cash_sleeve_daily_csv), prices.index, cash_sleeve_series)
    if emit_v5_kpis_json:
        _export_v5_kpis_json(
            Path(emit_v5_kpis_json),
            summary,
            config,
            prices,
            data_file_used_str,
            latest_portfolio_date,
            int(len(latest_holdings)) if latest_holdings else 0,
            float(sum(latest_weights)) if latest_weights else 0.0,
            max_effective_exposure,
            external_alpha_weight=float(external_alpha_weight),
            external_alpha_path=eap_str,
            cash_sleeve_at_rebalance=_cash_sleeve_at_executed_rebalances(rebalance_info, cash_sleeve_series),
        )

    return {
        "dates": [str(x) for x in prices.index.tolist()],
        "equity_raw": [float(x) for x in equity_raw.tolist()],
        "equity_raw_volmatched": [float(x) for x in equity_raw_volmatched.tolist()],
        # Pré-vol do overlay: retornos líquidos de fricção × stack (sem vol_overlay da perna arriscada nem T-Bill final).
        "equity_overlay_pre_vol": [float(x) for x in equity_overlay_pre_vol.tolist()],
        # CAP15 completo (gross×stack×vol_overlay + T-Bill + custos) **sem** teto NAV 100% na perna arriscada.
        "equity_overlay_margin": [float(x) for x in equity_overlay_margin.tolist()],
        "equity_overlayed": [float(x) for x in equity_overlayed.tolist()],
        "benchmark_equity": [float(x) for x in benchmark_equity.tolist()],
        # Alinhado a `dates`: turnover diário (soma |Δw| por dia) para cortes temporais sem re-correr o motor.
        "turnover_daily": [float(x) for x in turnover_daily_export.tolist()],
        # Fração NAV em T-Bills por dia (overlay), alinhada a `dates` — exportar p.ex. cash_sleeve_daily.csv para o histórico de carteira.
        "cash_sleeve_daily": [float(x) for x in cash_sleeve_series.astype(float).tolist()],

        "latest_portfolio_date": latest_portfolio_date,
        "latest_holdings": latest_holdings,
        "latest_weights": latest_weights,
        "latest_holdings_detailed": latest_holdings_detailed,

        "summary": summary,

        "kpis": overlay_kpis,
        "overlay_margin_kpis": overlay_margin_kpis,
        "benchmark_kpis": benchmark_kpis,
        "raw_kpis": raw_kpis,
        "raw_volmatched_kpis": raw_vm_kpis,
        "overlay_pre_vol_kpis": overlay_pre_vol_kpis,

        "meta": {
            "profile": profile,
            "top_q": config.top_q,
            "rank_in": config.rank_in,
            "rank_out": config.rank_out,
            "monthly_rebalance_only": config.monthly_rebalance_only,
            "monthly_rebalance_turnover_threshold": config.monthly_rebalance_turnover_threshold,
            "extraordinary_rebalance_enabled": bool(config.extraordinary_rebalance_enabled),
            "extraordinary_model_lookback_days": int(config.extraordinary_model_lookback_days),
            "extraordinary_model_p90_abs_score_delta_min": config.extraordinary_model_p90_abs_score_delta_min,
            "extraordinary_model_abs_score_delta_quantile": float(
                getattr(config, "extraordinary_model_abs_score_delta_quantile", 0.90) or 0.90
            ),
            "extraordinary_model_mean_abs_score_delta_min": config.extraordinary_model_mean_abs_score_delta_min,
            "extraordinary_model_min_names_for_delta": int(config.extraordinary_model_min_names_for_delta),
            "extraordinary_benchmark_lookback_days": int(config.extraordinary_benchmark_lookback_days),
            "extraordinary_benchmark_cumret_max": config.extraordinary_benchmark_cumret_max,
            "extraordinary_benchmark_cumret_min": config.extraordinary_benchmark_cumret_min,
            "extraordinary_breadth_below": config.extraordinary_breadth_below,
            "extraordinary_rebalance_turnover_threshold": float(config.extraordinary_rebalance_turnover_threshold),
            "extraordinary_max_per_calendar_year": config.extraordinary_max_per_calendar_year,
            "cash_proxy_ticker": "TBILL_PROXY",

            "lookback_120_days": config.lookback_120_days,
            "lookback_60_days": config.lookback_60_days,
            "lookback_20_days": config.lookback_20_days,
            "mom_120_weight": config.mom_120_weight,
            "mom_60_weight": config.mom_60_weight,
            "mom_20_weight": config.mom_20_weight,
            "selection_buffer_asymmetric": bool(config.selection_buffer_asymmetric),
            "rank_in_entry": int(config.rank_in_entry),
            "rank_maintain": int(config.rank_maintain),
            "rebalance_min_abs_weight_delta": config.rebalance_min_abs_weight_delta,
            "momentum_mode": str(config.momentum_mode),
            "momentum_winsorize_quantile": config.momentum_winsorize_quantile,
            "convex_power": config.convex_power,
            "score_threshold": config.score_threshold,

            "cap_per_ticker": config.cap_per_ticker,
            "external_alpha_weight": float(external_alpha_weight),
            "external_alpha_path": str(external_alpha_path) if external_alpha_path is not None else None,
            "transaction_cost_bps": config.transaction_cost_bps,
            "slippage_bps": float(config.slippage_bps),
            "fx_conversion_bps": float(config.fx_conversion_bps),
            "total_turnover_friction_bps": float(
                config.transaction_cost_bps + config.slippage_bps + config.fx_conversion_bps
            ),
            "execution_lag_days": int(execution_lag_days),

            "breadth_min": config.breadth_min,
            "breadth_max": config.breadth_max,

            "benchmark_ma_window": config.benchmark_ma_window,
            "risk_off_exposure": config.risk_off_exposure,
            "risk_on_exposure": config.risk_on_exposure,

            "vol_spike_enabled": bool(config.vol_spike_enabled),
            "vol_spike_short_window": int(config.vol_spike_short_window),
            "vol_spike_long_window": int(config.vol_spike_long_window),
            "vol_spike_ratio_threshold": float(config.vol_spike_ratio_threshold),
            "vol_spike_exposure": float(config.vol_spike_exposure),

            "drawdown_enabled": bool(config.drawdown_enabled),
            "drawdown_threshold_1": float(config.drawdown_threshold_1),
            "drawdown_exposure_1": float(config.drawdown_exposure_1),
            "drawdown_threshold_2": float(config.drawdown_threshold_2),
            "drawdown_exposure_2": float(config.drawdown_exposure_2),

            "vol_target_window": config.vol_target_window,
            "vol_scale_floor": config.vol_scale_floor,
            "vol_scale_cap": config.vol_scale_cap,
            "overlay_target_vol_realization_boost": config.overlay_target_vol_realization_boost,

            "bear_low_vol_overlay_enabled": bool(getattr(config, "bear_low_vol_overlay_enabled", False)),
            "bear_low_vol_bench_vol_window": int(getattr(config, "bear_low_vol_bench_vol_window", 63)),
            "bear_low_vol_exposure_mult": float(getattr(config, "bear_low_vol_exposure_mult", 0.85)),
            "bear_low_vol_tiered": bool(getattr(config, "bear_low_vol_tiered", False)),
            "bear_low_vol_bear_ma_window": int(getattr(config, "bear_low_vol_bear_ma_window", 252)),
            "bear_low_vol_quantile_min_periods": int(getattr(config, "bear_low_vol_quantile_min_periods", 252)),
            "bear_low_vol_hysteresis": bool(getattr(config, "bear_low_vol_hysteresis", False)),
            "bear_low_vol_hysteresis_entry_quantile": float(
                getattr(config, "bear_low_vol_hysteresis_entry_quantile", 0.30)
            ),
            "bear_low_vol_hysteresis_exit_quantile": float(getattr(config, "bear_low_vol_hysteresis_exit_quantile", 0.55)),
            "bear_low_vol_hysteresis_exit_consecutive_days": int(
                getattr(config, "bear_low_vol_hysteresis_exit_consecutive_days", 10)
            ),
            "bear_low_vol_hysteresis_bear_ma_window": int(
                getattr(config, "bear_low_vol_hysteresis_bear_ma_window", 252)
            ),
            "sector_cluster_cap_enabled": bool(getattr(config, "sector_cluster_cap_enabled", False)),
            "sector_cap": float(getattr(config, "sector_cap", 0.35)),
            "cluster_cap": float(getattr(config, "cluster_cap", 0.30)),
            "cluster_map_path": str(getattr(config, "cluster_map_path", "")),
            "crash_overlay_2of3_enabled": bool(getattr(config, "crash_overlay_2of3_enabled", False)),
            "crash_breadth_threshold": float(getattr(config, "crash_breadth_threshold", 0.40)),
            "crash_dd_window": int(getattr(config, "crash_dd_window", 60)),
            "crash_dd_threshold": float(getattr(config, "crash_dd_threshold", -0.08)),
            "crash_exposure_2_signals": float(getattr(config, "crash_exposure_2_signals", 0.70)),
            "crash_exposure_3_signals": float(getattr(config, "crash_exposure_3_signals", 0.55)),
            "crash_exit_consecutive_days": int(getattr(config, "crash_exit_consecutive_days", 10)),

            # Ficheiro usado em `load_prices` (não o primeiro de DATA_CANDIDATES).
            "data_file_used": str(data_file_used_str),
            "data_start": str(prices.index.min().date()) if len(prices.index) else None,
            "data_end": str(prices.index.max().date()) if len(prices.index) else None,
            "n_obs": int(len(prices.index)),
            "latest_portfolio_date": latest_portfolio_date,
            "latest_holdings_count": int(len(latest_holdings)),
            "latest_weights_sum": float(sum(latest_weights)) if latest_weights else 0.0,
            "latest_cash_sleeve": float(cash_sleeve_series.iloc[-1]) if len(cash_sleeve_series) else 0.0,
        },
    }


def run_research_v1_cap15(
    prices_path: str | Path | None = None,
    profile: str = "moderado",
    emit_weights_csv: str | Path | None = None,
    emit_cash_sleeve_daily_csv: str | Path | None = None,
    emit_v5_kpis_json: str | Path | None = None,
    **kwargs: Any,
) -> Dict[str, Any]:
    return run_research_v1(
        prices_path=prices_path,
        profile=profile,
        cap_per_ticker=0.15,
        emit_weights_csv=emit_weights_csv,
        emit_cash_sleeve_daily_csv=emit_cash_sleeve_daily_csv,
        emit_v5_kpis_json=emit_v5_kpis_json,
        **kwargs,
    )


if __name__ == "__main__":
    result = run_research_v1(profile="moderado")
    s = result["summary"]

    print("Profile: moderado")
    print(f"Data file used: {s['data_file_used']}")
    print(f"Data start: {s['data_start']}")
    print(f"Data end: {s['data_end']}")
    print(f"N obs: {s['n_obs']}")
    print(f"Benchmark CAGR: {s['benchmark_cagr'] * 100:.2f} %")
    print(f"Raw CAGR: {s['raw_cagr'] * 100:.2f} %")
    print(f"Raw VM CAGR: {s['raw_volmatched_cagr'] * 100:.2f} %")
    print(f"Overlay Pre-Vol CAGR: {s['overlay_pre_vol_cagr'] * 100:.2f} %")
    print(f"Overlayed CAGR: {s['overlayed_cagr'] * 100:.2f} %")
    print(f"Benchmark Sharpe: {s['benchmark_sharpe']:.2f}")
    print(f"Raw Sharpe: {s['raw_sharpe']:.2f}")
    print(f"Raw VM Sharpe: {s['raw_volmatched_sharpe']:.2f}")
    print(f"Overlay Pre-Vol Sharpe: {s['overlay_pre_vol_sharpe']:.2f}")
    print(f"Overlayed Sharpe: {s['overlayed_sharpe']:.2f}")
    print(f"Avg vol scale raw: {s['avg_vol_scale_raw']:.4f}")
    print(f"Avg vol scale overlay: {s['avg_vol_scale_overlay']:.4f}")
    print(f"Min vol scale overlay: {s['min_vol_scale_overlay']:.4f}")
    print(f"Max vol scale overlay: {s['max_vol_scale_overlay']:.4f}")
    print(f"Avg breadth scale: {s['avg_breadth_scale']:.4f}")
    print(f"Min breadth scale: {s['min_breadth_scale']:.4f}")
    print(f"Max breadth scale: {s['max_breadth_scale']:.4f}")
    print(f"Avg trend exposure: {s['avg_trend_exposure']:.4f}")
    print(f"Min trend exposure: {s['min_trend_exposure']:.4f}")
    print(f"Max trend exposure: {s['max_trend_exposure']:.4f}")
    print(f"Cap per ticker: {s['cap_per_ticker']:.4f}")
    print(f"Transaction cost bps: {s['transaction_cost_bps']:.2f}")
    print(f"Slippage bps: {s.get('slippage_bps', 0):.2f} | FX conversion bps: {s.get('fx_conversion_bps', 0):.2f}")
    print(f"Total turnover friction bps: {s.get('total_turnover_friction_bps', s['transaction_cost_bps']):.2f}")
    print(f"Execution lag days (extra): {s.get('execution_lag_days', 0)}")
    print(f"Vol target window: {s['vol_target_window']}")
    print(f"Overlay target vol boost: {s['overlay_target_vol_realization_boost']:.4f}")
    print(f"Avg holdings count: {s['avg_holdings_count']:.2f}")
    print(f"Min holdings count: {s['min_holdings_count']}")
    print(f"Max holdings count: {s['max_holdings_count']}")
    print(f"Avg turnover: {s['avg_turnover']:.4f}")
    print(f"Max turnover: {s['max_turnover']:.4f}")
    print(f"Mean daily friction (bps equiv. NAV): {s.get('mean_daily_friction_bps_equiv', 0):.4f}")
    print(f"Monthly rebalance turnover threshold: {s['monthly_rebalance_turnover_threshold']:.4f}")
    print(f"N rebalance opportunities: {s['n_rebalance_opportunities']}")
    print(f"N rebalance executed: {s['n_rebalance_executed']}")
    print(f"N rebalance skipped: {s['n_rebalance_skipped']}")
    print(f"Avg potential turnover per rebalance: {s['avg_potential_turnover_rebalance']:.4f}")
    print(f"Avg executed turnover per rebalance: {s['avg_executed_turnover_rebalance']:.4f}")