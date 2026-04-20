# -*- coding: utf-8 -*-

from __future__ import annotations

import json
import math
import os
import re
from pathlib import Path
from typing import Any, Dict, Iterable, Optional

import numpy as np
import pandas as pd

from price_series_clean import sanitize_extreme_daily_closes


ENGINE_VERSION = "DECIDE_ENGINE_V2_M3_SCORE_RANK_POOL_2026_04_17_ZONE_CAP_SINK"

_TSE_DOT_T_COL = re.compile(r"^\d+\.[Tt]$|^\d+-[Tt]$")


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


def _env_truthy(name: str) -> bool:
    v = (os.environ.get(name) or "").strip().lower()
    return v in ("1", "true", "yes", "on")


def _normalize_tse_listing_col(name: str) -> Optional[str]:
    """``8035.T`` / ``8035-t`` / ``8035T`` → ``8035.T`` (chave do mapa ADR); senão None."""
    s = str(name).strip().upper().replace(" ", "")
    m = re.match(r"^(\d{3,5})\.[T]$", s)
    if m:
        return f"{m.group(1)}.T"
    m = re.match(r"^(\d{3,5})-T$", s)
    if m:
        return f"{m.group(1)}.T"
    m = re.match(r"^(\d{3,5})T$", s)
    if m:
        return f"{m.group(1)}.T"
    return None


# Alinhado a ``frontend/lib/server/jpListingToAdrMap.ts`` + ``jp_listing_to_adr.csv``.
_BUILTIN_JP_LISTING_TO_ADR: Dict[str, str] = {
    "8035.T": "TOELY",
    "7974.T": "NTDOY",
    "8411.T": "MFG",
    "7203.T": "TM",
    "6758.T": "SONY",
    "8306.T": "MUFG",
    "8316.T": "SMFG",
    "9433.T": "KDDIY",
    "9984.T": "SFTBY",
    "6501.T": "HTHIY",
    "9983.T": "FRCOY",
    "6954.T": "FANUY",
    "8002.T": "MARUY",
    "8058.T": "MSBHF",
    "6981.T": "MRAAY",
}

_JP_LISTING_TO_ADR_CACHE: Optional[Dict[str, str]] = None


def _load_jp_listing_to_adr_map() -> Dict[str, str]:
    global _JP_LISTING_TO_ADR_CACHE
    if _JP_LISTING_TO_ADR_CACHE is not None:
        return _JP_LISTING_TO_ADR_CACHE
    m: Dict[str, str] = {k.upper(): v.upper() for k, v in _BUILTIN_JP_LISTING_TO_ADR.items()}
    csv_path = _candidate_path(
        "backend/data/jp_listing_to_adr.csv",
        "data/jp_listing_to_adr.csv",
    )
    if csv_path is not None:
        try:
            text = csv_path.read_text(encoding="utf-8")
            lines = [ln for ln in text.splitlines() if ln.strip()]
            for ln in lines[1:]:
                parts = ln.split(",")
                if len(parts) < 2:
                    continue
                key = _normalize_tse_listing_col(parts[0])
                adr = str(parts[1]).strip().upper()
                if key and adr:
                    m[key] = adr
        except OSError:
            pass
    _JP_LISTING_TO_ADR_CACHE = m
    return m


def _drop_tse_listing_columns_when_adr_exists(df: pd.DataFrame) -> tuple[pd.DataFrame, int]:
    """Com ``DECIDE_KEEP_TSE_DOT_T_COLUMNS=1`` o universo mantém ``NNNN.T``; o momentum pode escolher
    a série Tóquio em vez do ADR já presente no CSV (duplicado). Remove só listagens com par ADR na grelha.
    """
    mp = _load_jp_listing_to_adr_map()
    if not mp:
        return df, 0
    colset = {str(c).strip() for c in df.columns}
    drop: list[str] = []
    for c in list(df.columns):
        key = _normalize_tse_listing_col(str(c))
        if not key:
            continue
        adr = mp.get(key)
        if adr and adr in colset and str(c) not in drop:
            drop.append(str(c))
    if not drop:
        return df, 0
    return df.drop(columns=drop, errors="ignore"), len(drop)


def _drop_tse_dot_t_columns_if_prefer_adr(df: pd.DataFrame) -> tuple[pd.DataFrame, int]:
    """Listagens Yahoo ``NNNN.T`` são Tóquio em JPY; não são ADRs. O CSV já tem ADRs/OTC USD (TM, SONY, …).

    Por defeito **remove** essas colunas para o momentum/execução alinharem a USD (conta IBKR típica).
    Para manter o universo completo com Tóquio local: ``DECIDE_KEEP_TSE_DOT_T_COLUMNS=1``.
    """
    if _env_truthy("DECIDE_KEEP_TSE_DOT_T_COLUMNS"):
        return df, 0
    drop = [c for c in df.columns if _TSE_DOT_T_COL.match(str(c).strip())]
    if not drop:
        return df, 0
    return df.drop(columns=drop, errors="ignore"), len(drop)


def _load_prices_from_disk() -> tuple[pd.DataFrame, dict]:

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
    # Glitches Yahoo em .T (saltos >100% num dia); TWS/IB costuma ser limpo — desactivar com ...=0
    df = sanitize_extreme_daily_closes(df)
    # Sempre que existir coluna ADR mapeada, retirar o duplicado ``NNNN.T`` (mesmo com KEEP_TSE=1).
    df, n_jp_dup = _drop_tse_listing_columns_when_adr_exists(df)
    df, n_dot_t = _drop_tse_dot_t_columns_if_prefer_adr(df)
    meta = {
        "price_file": str(price_path).replace("\\", "/"),
        "jp_listing_columns_dropped_when_adr_present": int(n_jp_dup),
        "tse_dot_t_columns_dropped": int(n_dot_t),
        "keep_tse_dot_t_columns": _env_truthy("DECIDE_KEEP_TSE_DOT_T_COLUMNS"),
    }
    return df, meta


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
# ZONA / «PAÍS» vs BENCHMARK (teto relativo, p.ex. 130%)
# ============================================================

_DEFAULT_COMPOSITE_BENCH_ZONES: tuple[tuple[str, float, str], ...] = (
    ("SPY", 0.60, "US"),
    ("VGK", 0.25, "EU"),
    ("EWJ", 0.10, "JP"),
    ("EWC", 0.05, "CAN"),
)

_BENCH_ZONE_FALLBACK_WORLD: dict[str, float] = {
    "US": 0.55,
    "EU": 0.22,
    "JP": 0.14,
    "CAN": 0.05,
    "OTHER": 0.04,
}


def _bench_zones_need_world_fallback(z: dict[str, float]) -> bool:
    return z.get("US", 0.0) < 1e-12 or z.get("EU", 0.0) < 1e-12 or z.get("JP", 0.0) < 1e-12


# Mistura regional aproximada quando o benchmark é **uma** coluna (ETF).
# Valores sumam 1.0 por ETF; «OTHER» absorve o que não cai em US/EU/JP/CAN.
_SINGLE_ETF_BENCH_ZONE_PRIOR: dict[str, dict[str, float]] = {
    "SPY": {"US": 0.72, "EU": 0.14, "JP": 0.08, "CAN": 0.03, "OTHER": 0.03},
    "VOO": {"US": 0.72, "EU": 0.14, "JP": 0.08, "CAN": 0.03, "OTHER": 0.03},
    "IVV": {"US": 0.72, "EU": 0.14, "JP": 0.08, "CAN": 0.03, "OTHER": 0.03},
    "QQQ": {"US": 0.76, "EU": 0.12, "JP": 0.07, "CAN": 0.02, "OTHER": 0.03},
    "VGK": {"EU": 1.0},
    "EZU": {"EU": 1.0},
    "EUNL.DE": {"EU": 0.85, "US": 0.10, "OTHER": 0.05},
    "IWDA.AS": {"US": 0.58, "EU": 0.22, "JP": 0.09, "CAN": 0.04, "OTHER": 0.07},
    "IWDA": {"US": 0.58, "EU": 0.22, "JP": 0.09, "CAN": 0.04, "OTHER": 0.07},
    "URTH": {"US": 0.58, "EU": 0.22, "JP": 0.09, "CAN": 0.04, "OTHER": 0.07},
    "ACWI": {"US": 0.58, "EU": 0.20, "JP": 0.09, "CAN": 0.04, "OTHER": 0.09},
    "EWJ": {"JP": 1.0},
    "EWC": {"CAN": 1.0},
}

_META_CSV_ZONE_CANDIDATES: tuple[str, ...] = (
    "backend/data/company_meta_global_enriched.csv",
    "backend/data/company_meta_global.csv",
    "backend/data/company_meta_combined.csv",
    "backend/data/company_meta_v3.csv",
)


def _normalize_ticker_key_meta(ticker: str) -> str:
    return str(ticker or "").strip().upper().replace(".", "-")


def _canon_zone_label(raw: object) -> str:
    s = str(raw or "").strip().upper()
    if not s:
        return "OTHER"
    if s in {"US", "EU", "JP", "CAN"}:
        return s
    if s in {"USA", "U.S.", "U.S.A.", "UNITED STATES", "UNITED STATES OF AMERICA"}:
        return "US"
    if s in {"EU", "EUROPE", "EUROZONE", "EURO AREA", "EMU"}:
        return "EU"
    if s in {"UK", "UNITED KINGDOM", "GB", "GBR"}:
        return "EU"
    if s in {"JP", "JPN", "JAPAN"} or "JAPAN" in s:
        return "JP"
    if s in {"CAN", "CANADA", "CA"}:
        return "CAN"
    return "OTHER"


def _normalize_zone_weight_dict(raw: dict[str, float]) -> dict[str, float]:
    out: dict[str, float] = {}
    for k, v in raw.items():
        z = _canon_zone_label(k)
        try:
            fv = float(v)
        except (TypeError, ValueError):
            continue
        if fv > 0 and math.isfinite(fv):
            out[z] = out.get(z, 0.0) + fv
    s = sum(out.values())
    if s <= 1e-18:
        return {"US": 1.0}
    return {z: out[z] / s for z in out}


def benchmark_zone_weights(prices: pd.DataFrame, benchmark: Optional[str]) -> dict[str, float]:
    """
    Pesos regionais do benchmark (US/EU/JP/CAN/OTHER) alinhados a ``_make_benchmark_from_prices``:
    - coluna única presente em ``prices``: prior em ``_SINGLE_ETF_BENCH_ZONE_PRIOR`` ou mistura mundial de reserva;
    - caso contrário, mistura **sleeves** SPY/VGK/EWJ/EWC (renormalizada); se faltar JP/US/EU, usa a mesma reserva.
    Override opcional: env ``DECIDE_BENCHMARK_ZONE_WEIGHTS_JSON`` (objecto JSON de zona->peso).
    """
    raw_json = (os.environ.get("DECIDE_BENCHMARK_ZONE_WEIGHTS_JSON") or "").strip()
    if raw_json:
        try:
            parsed = json.loads(raw_json)
            if isinstance(parsed, dict):
                d = {str(k): float(v) for k, v in parsed.items() if str(k).strip()}
                if d:
                    return _normalize_zone_weight_dict(d)
        except (json.JSONDecodeError, TypeError, ValueError):
            pass

    cols = {str(c).strip() for c in prices.columns}
    # Igual a ``_make_benchmark_from_prices``: só série única quando o nome da coluna existe.
    bc_raw = str(benchmark).strip() if benchmark is not None and str(benchmark).strip() else ""
    if bc_raw and bc_raw in cols:
        key = bc_raw.upper()
        prior = _SINGLE_ETF_BENCH_ZONE_PRIOR.get(key)
        if prior is not None:
            return _normalize_zone_weight_dict(prior)
        return _normalize_zone_weight_dict(dict(_BENCH_ZONE_FALLBACK_WORLD))

    zsum: dict[str, float] = {}
    for etf, w, zone in _DEFAULT_COMPOSITE_BENCH_ZONES:
        if etf in cols:
            zsum[zone] = zsum.get(zone, 0.0) + float(w)
    if not zsum:
        return _normalize_zone_weight_dict(dict(_BENCH_ZONE_FALLBACK_WORLD))
    tot = sum(zsum.values())
    out = {z: zsum[z] / tot for z in zsum}
    if _bench_zones_need_world_fallback(out):
        return _normalize_zone_weight_dict(dict(_BENCH_ZONE_FALLBACK_WORLD))
    return out


def load_ticker_zone_lookup(labels: Iterable[str]) -> dict[str, str]:
    """Ticker (chave normalizada ``BRK-B``) → zona US/EU/JP/CAN/OTHER a partir dos CSV de meta."""
    want = {_normalize_ticker_key_meta(x) for x in labels}
    if not want:
        return {}
    out: dict[str, str] = {}
    for rel in _META_CSV_ZONE_CANDIDATES:
        p = _candidate_path(rel)
        if p is None:
            continue
        try:
            df = pd.read_csv(p)
        except (OSError, ValueError, TypeError):
            continue
        if "ticker" not in df.columns:
            continue
        for _, row in df.iterrows():
            tk = _normalize_ticker_key_meta(row.get("ticker", ""))
            if not tk or tk not in want:
                continue
            if tk in out:
                continue
            zraw = row.get("zone") or row.get("country_group") or row.get("region") or ""
            out[tk] = _canon_zone_label(zraw)
    return out


_ZONE_CAP_SINK_TICKER = "TBILL_PROXY"


def _redistribute_zone_cap_freed_weights(
    w: pd.Series,
    zone_of,
    zones: tuple[str, ...],
    bench: dict[str, float],
    mult: float,
    freed: float,
    *,
    sink_ticker: str,
) -> float:
    """
    Coloca ``freed`` em linhas de zonas com folga sob ``mult * bench[Z]`` (só zonas com ≥1 ticker
    no índice). Devolve o que não coube (vai para o sink de caixa).
    """
    rem = float(freed)
    for _ in range(50):
        if rem <= 1e-12:
            return 0.0
        risk_idx = [t for t in w.index if str(t).strip().upper() != sink_ticker]
        wt = float(sum(float(w.loc[t]) for t in risk_idx))
        if wt <= 1e-18:
            return rem
        z_w: dict[str, float] = {z: 0.0 for z in zones}
        for t in risk_idx:
            z_w[zone_of(str(t))] = z_w.get(zone_of(str(t)), 0.0) + float(w.loc[t])
        zones_with_rows = [z for z in zones if any(zone_of(str(t)) == z for t in risk_idx)]
        head: dict[str, float] = {}
        total_head = 0.0
        for z in zones_with_rows:
            b = float(bench.get(z, 0.0))
            if b < 1e-12:
                head[z] = 0.0
                continue
            max_w = mult * b * wt
            h = max(0.0, max_w - float(z_w.get(z, 0.0)))
            head[z] = h
            total_head += h
        if total_head <= 1e-9:
            return rem
        to_place = min(rem, total_head)
        placed = 0.0
        for z in zones_with_rows:
            if head[z] <= 1e-9:
                continue
            add_z = min(head[z], to_place * (head[z] / total_head))
            ztick = [t for t in risk_idx if zone_of(str(t)) == z]
            if not ztick:
                continue
            sw = float(sum(float(w.loc[t]) for t in ztick))
            if sw <= 1e-18:
                per = add_z / max(1, len(ztick))
                for t in ztick:
                    w.loc[t] = float(w.loc[t]) + per
            else:
                for t in ztick:
                    w.loc[t] = float(w.loc[t]) + add_z * (float(w.loc[t]) / sw)
            placed += add_z
        rem -= placed
    return rem


def apply_zone_caps_vs_benchmark_weights(
    weights: pd.Series,
    ticker_zone: dict[str, str],
    bench_zones: dict[str, float],
    *,
    multiplier: float = 1.3,
    max_iterations: int = 500,
) -> pd.Series:
    """
    Garante, por zona Z, ``sum_i w_i 1{zone(i)=Z} <= multiplier * bench_zones[Z] * S_risk`` quando
    ``bench_zones[Z]>0``, com ``S_risk`` = soma das linhas **excepto** o sink de caixa.

    A versão anterior renormalizava a carteira inteira após cortar uma zona; quando **toda** a massa
    está nessa zona (ex. só JP), o factor ``cap/ex`` e a divisão pela soma **anulam-se** e o tecto
    nunca baixa. Aqui: corta a zona mais violada, redistribui folga para outras zonas com tickers,
    e o restante acumula em ``TBILL_PROXY`` (alinhado ao produto Next / relatório).
    """
    w = pd.to_numeric(weights, errors="coerce").fillna(0.0).clip(lower=0.0)
    if w.size == 0 or w.sum() <= 1e-18:
        return w
    w = w / w.sum()
    if not ticker_zone or not bench_zones or multiplier <= 0:
        return w

    bench = _normalize_zone_weight_dict({str(k): float(v) for k, v in bench_zones.items()})

    zones = ("US", "EU", "JP", "CAN", "OTHER")
    sink = _ZONE_CAP_SINK_TICKER

    def zone_of(ticker: str) -> str:
        raw = str(ticker).strip()
        for key in (
            _normalize_ticker_key_meta(raw),
            raw.upper().replace(" ", ""),
            raw.upper(),
        ):
            if not key:
                continue
            z = ticker_zone.get(key)
            if z and z in zones:
                return z
        return "OTHER"

    def risk_index(ww: pd.Series) -> list:
        return [t for t in ww.index if str(t).strip().upper() != sink]

    for _ in range(max(50, int(max_iterations))):
        ridx = risk_index(w)
        wt = float(sum(float(w.loc[t]) for t in ridx))
        if wt <= 1e-18:
            break
        worst_z: str | None = None
        worst_excess = 0.0
        for z in zones:
            b = float(bench.get(z, 0.0))
            if b < 1e-12:
                continue
            cap_f = multiplier * b
            sw = float(sum(float(w.loc[t]) for t in ridx if zone_of(str(t)) == z))
            ex_z = sw / wt
            if ex_z > cap_f + 1e-7:
                target_w = cap_f * wt
                excess = sw - target_w
                if excess > worst_excess + 1e-12:
                    worst_excess = excess
                    worst_z = z
        if worst_z is None or worst_excess <= 1e-9:
            break
        cap_f = multiplier * float(bench.get(worst_z, 0.0))
        z_rows = [t for t in ridx if zone_of(str(t)) == worst_z]
        sw_z = float(sum(float(w.loc[t]) for t in z_rows))
        if sw_z <= 1e-12:
            break
        target_w = cap_f * wt
        fac = target_w / sw_z
        freed = 0.0
        for t in z_rows:
            wi = float(w.loc[t])
            nw = wi * fac
            freed += wi - nw
            w.loc[t] = nw
        if freed > 1e-9:
            to_sink = _redistribute_zone_cap_freed_weights(
                w, zone_of, zones, bench, multiplier, freed, sink_ticker=sink
            )
            if to_sink > 1e-9:
                if sink not in w.index:
                    w.loc[sink] = 0.0
                w.loc[sink] = float(w.loc[sink]) + to_sink

    w = w.clip(lower=0.0)
    w = w.where(w >= 1e-8, 0.0)
    s = float(w.sum())
    if s > 1e-18:
        w = w / s
    if sink in w.index and float(w.loc[sink]) < 1e-12:
        w = w.drop(index=[sink], errors="ignore")
        s2 = float(w.sum())
        if s2 > 1e-18:
            w = w / s2

    w = w[w > 1e-12]
    s3 = float(w.sum())
    if s3 > 1e-18:
        w = w / s3
    return w.sort_values(ascending=False)


def _engine_lp_zone_caps_enabled() -> bool:
    """
    Opt-in: ``DECIDE_ENGINE_LP_ZONE_CAPS=1`` activa programação linear (HiGHS via SciPy) para
    ``sum w_i = 1``, ``w_i <= cap``, ``sum_{i in Z} w_i <= mult * bench[Z]`` e objectivo
    ``max sum u_i w_i`` com ``u_i = score_i`` (raw) ou ``sqrt(score_i)`` (CAP15).
    """
    return _env_truthy("DECIDE_ENGINE_LP_ZONE_CAPS")


def solve_max_utility_weights_under_zone_and_ticker_caps(
    tickers: list[str],
    scores: pd.Series,
    ticker_zone: dict[str, str],
    bench_zones: dict[str, float],
    *,
    cap_per_ticker: float,
    multiplier: float,
    linear_score_weights: bool,
) -> Optional[pd.Series]:
    """
    Caminho **A** (motor): maximizar utilidade linear nos pesos sujeita a tecto por nome e por zona
    vs benchmark. Devolve ``None`` se SciPy falhar, problema infeasível, ou dados insuficientes.
    """
    try:
        from scipy.optimize import linprog  # type: ignore[import-untyped]
    except Exception:
        return None

    n = len(tickers)
    if n <= 0 or multiplier <= 0:
        return None

    cap = float(min(max(float(cap_per_ticker), 1e-12), 1.0))
    bench = _normalize_zone_weight_dict({str(k): float(v) for k, v in bench_zones.items()})
    zones_order = ("US", "EU", "JP", "CAN", "OTHER")

    def zone_of(t: str) -> str:
        z = ticker_zone.get(_normalize_ticker_key_meta(str(t)))
        return z if z in zones_order else "OTHER"

    c: list[float] = []
    for t in tickers:
        s = float(pd.to_numeric(scores.get(t, float("nan")), errors="coerce"))
        if not math.isfinite(s):
            s = 0.0
        s = max(s, 1e-18)
        u = float(s) if linear_score_weights else float(math.sqrt(s))
        c.append(float(-u))

    a_rows: list[list[float]] = []
    b_vals: list[float] = []
    for z in zones_order:
        bz = float(bench.get(z, 0.0))
        if bz < 1e-12:
            continue
        row = [0.0] * n
        for i, tk in enumerate(tickers):
            if zone_of(tk) == z:
                row[i] = 1.0
        a_rows.append(row)
        b_vals.append(float(multiplier * bz))

    a_ub_np = np.asarray(a_rows, dtype=float) if a_rows else None
    b_ub_np = np.asarray(b_vals, dtype=float) if b_vals else None

    a_eq = np.ones((1, n), dtype=float)
    b_eq = np.asarray([1.0], dtype=float)
    bounds = [(0.0, cap) for _ in range(n)]

    res = linprog(
        c,
        A_ub=a_ub_np,
        b_ub=b_ub_np,
        A_eq=a_eq,
        b_eq=b_eq,
        bounds=bounds,
        method="highs",
        options={"disp": False},
    )
    if res is None or not getattr(res, "success", False):
        return None
    x = getattr(res, "x", None)
    if x is None or len(x) != n:
        return None
    w = pd.Series(np.asarray(x, dtype=float), index=[str(t) for t in tickers], dtype=float).clip(lower=0.0)
    ssum = float(w.sum())
    if ssum <= 1e-18:
        return None
    w = w / ssum
    ex_check: dict[str, float] = {z: 0.0 for z in zones_order}
    for t, wt in w.items():
        ex_check[zone_of(str(t))] += float(wt)
    for z in zones_order:
        bz = float(bench.get(z, 0.0))
        if bz < 1e-12:
            continue
        if ex_check.get(z, 0.0) > float(multiplier * bz) + 1e-5:
            return None
    if float(w.max()) > cap + 1e-5:
        return None
    return w.sort_values(ascending=False)


def _zone_cap_multiplier_from_env() -> float:
    try:
        return float(os.environ.get("DECIDE_ZONE_CAP_VS_BENCHMARK_MULT", "1.3"))
    except ValueError:
        return 1.3


def _zone_cap_enabled() -> bool:
    return not _env_truthy("DECIDE_DISABLE_ZONE_CAP_VS_BENCHMARK")


# ============================================================
# SCORE
# ============================================================

def compute_multi_horizon_score(prices_window: pd.DataFrame) -> pd.Series:

    px_now = prices_window.iloc[-1]

    idx_long = max(0, len(prices_window) - 121)
    idx_mid = max(0, len(prices_window) - 61)
    idx_short = max(0, len(prices_window) - 21)

    raw_long = px_now / prices_window.iloc[idx_long] - 1
    raw_mid = px_now / prices_window.iloc[idx_mid] - 1
    raw_short = px_now / prices_window.iloc[idx_short] - 1

    try:
        clip_h = float(os.environ.get("DECIDE_SCORE_HORIZON_RET_CLIP", "3.0"))
    except ValueError:
        clip_h = 3.0
    if clip_h > 0:
        ret_long = raw_long.clip(lower=-0.99, upper=clip_h)
        ret_mid = raw_mid.clip(lower=-0.99, upper=clip_h)
        ret_short = raw_short.clip(lower=-0.99, upper=clip_h)
    else:
        ret_long, ret_mid, ret_short = raw_long, raw_mid, raw_short

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

def _compute_kpis(equity: pd.Series) -> dict[str, float]:
    """KPIs anualizados a partir da curva de equity (fecho diário / rebalance).

    Mantém as chaves históricas ``cagr``, ``vol``, ``sharpe``, ``max_drawdown`` e acrescenta
    métricas de cauda, assimetria e rácios clássicos para stress / robustez.
    """
    nan = float("nan")
    s = pd.to_numeric(pd.Series(equity, dtype=float), errors="coerce").dropna()
    if s.size < 2:
        return {
            "cagr": nan,
            "vol": nan,
            "sharpe": nan,
            "max_drawdown": nan,
            "total_return": nan,
            "span_years": nan,
            "sortino": nan,
            "calmar": nan,
            "hit_ratio_pct": nan,
            "mean_daily_return": nan,
            "worst_daily_return": nan,
            "best_daily_return": nan,
            "return_skewness": nan,
            "return_excess_kurtosis": nan,
            "var_95_daily": nan,
            "cvar_95_daily": nan,
            "omega_ratio": nan,
        }

    rets = s.pct_change().dropna()
    if rets.empty:
        return {
            "cagr": nan,
            "vol": nan,
            "sharpe": nan,
            "max_drawdown": nan,
            "total_return": nan,
            "span_years": nan,
            "sortino": nan,
            "calmar": nan,
            "hit_ratio_pct": nan,
            "mean_daily_return": nan,
            "worst_daily_return": nan,
            "best_daily_return": nan,
            "return_skewness": nan,
            "return_excess_kurtosis": nan,
            "var_95_daily": nan,
            "cvar_95_daily": nan,
            "omega_ratio": nan,
        }

    years = max((s.index[-1] - s.index[0]).days / 365.25, 1e-9)
    start_v = float(s.iloc[0])
    end_v = float(s.iloc[-1])
    total_return = float(end_v / start_v - 1.0) if start_v > 0 else nan
    cagr = float((end_v / start_v) ** (1.0 / years) - 1.0) if start_v > 0 else nan

    vol = float(rets.std(ddof=0) * np.sqrt(252))
    mu_d = float(rets.mean())
    mu_ann = float(mu_d * 252.0)
    sharpe = float(mu_ann / vol) if vol > 1e-12 else 0.0

    dd = s / s.cummax() - 1.0
    max_dd = float(dd.min())
    calmar = float(cagr / abs(max_dd)) if max_dd < -1e-12 else nan

    mar = 0.0
    downside_mask = rets < mar
    downside_sq_mean = float((rets.where(downside_mask, 0.0) ** 2).mean())
    downside_vol = float(np.sqrt(downside_sq_mean * 252.0))
    sortino = float(mu_ann / downside_vol) if downside_vol > 1e-12 else nan

    hit_ratio_pct = float((rets > 0).mean() * 100.0)
    worst_daily_return = float(rets.min())
    best_daily_return = float(rets.max())
    return_skewness = float(rets.skew()) if len(rets) > 2 else nan
    return_excess_kurtosis = float(rets.kurtosis()) if len(rets) > 3 else nan

    var_95_daily = float(np.percentile(rets.to_numpy(dtype=float, copy=False), 5))
    tail = rets[rets <= var_95_daily]
    cvar_95_daily = float(tail.mean()) if len(tail) else nan

    pos_sum = float(rets[rets > 0].sum())
    neg_sum = float(rets[rets < 0].sum())
    omega_ratio = float(pos_sum / abs(neg_sum)) if neg_sum < -1e-18 else nan

    return {
        "cagr": cagr,
        "vol": vol,
        "sharpe": sharpe,
        "max_drawdown": max_dd,
        "total_return": total_return,
        "span_years": float(years),
        "sortino": sortino,
        "calmar": calmar,
        "hit_ratio_pct": hit_ratio_pct,
        "mean_daily_return": mu_d,
        "worst_daily_return": worst_daily_return,
        "best_daily_return": best_daily_return,
        "return_skewness": return_skewness,
        "return_excess_kurtosis": return_excess_kurtosis,
        "var_95_daily": var_95_daily,
        "cvar_95_daily": cvar_95_daily,
        "omega_ratio": omega_ratio,
    }


def _relative_kpis(model_eq: pd.Series, bench_eq: pd.Series) -> dict[str, float]:
    """KPIs da carteira vs benchmark na mesma linha temporal (retornos alinhados)."""
    nan = float("nan")
    m = pd.to_numeric(pd.Series(model_eq, dtype=float), errors="coerce").dropna()
    b = pd.to_numeric(pd.Series(bench_eq, dtype=float), errors="coerce").reindex(m.index).ffill()
    r_m = m.pct_change().dropna()
    r_b = b.pct_change().reindex(r_m.index).dropna()
    r_m = r_m.loc[r_b.index]
    if len(r_m) < 20 or len(r_b) < 20:
        return {
            "excess_cagr_vs_benchmark": nan,
            "tracking_error_annual": nan,
            "information_ratio": nan,
            "beta_vs_benchmark": nan,
            "correlation": nan,
            "alpha_capm_annual": nan,
        }

    excess = r_m - r_b
    te = float(excess.std(ddof=0) * np.sqrt(252.0))
    ir = float(excess.mean() * 252.0 / te) if te > 1e-12 else nan
    cov = float(np.cov(r_m.values, r_b.values, ddof=0)[0, 1])
    vb = float(r_b.var(ddof=0))
    beta = cov / vb if vb > 1e-18 else nan
    corr = float(r_m.corr(r_b))
    mu_m = float(r_m.mean() * 252.0)
    mu_b = float(r_b.mean() * 252.0)
    alpha_capm = float(mu_m - beta * mu_b)

    ym = max((m.index[-1] - m.index[0]).days / 365.25, 1e-9)
    yb = max((b.index[-1] - b.index[0]).days / 365.25, 1e-9)
    cagr_m = float((m.iloc[-1] / m.iloc[0]) ** (1.0 / ym) - 1.0) if m.iloc[0] > 0 else nan
    cagr_b = float((b.iloc[-1] / b.iloc[0]) ** (1.0 / yb) - 1.0) if b.iloc[0] > 0 else nan
    excess_cagr = float(cagr_m - cagr_b)

    return {
        "excess_cagr_vs_benchmark": excess_cagr,
        "tracking_error_annual": te,
        "information_ratio": ir,
        "beta_vs_benchmark": float(beta),
        "correlation": corr,
        "alpha_capm_annual": alpha_capm,
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


def score_rank_pool_n(top_q: int, universe_size: int) -> int:
    """
    Quantos nomes do ranking de score entram no **pool** de pesos (LP / heurística), não só ``top_q``.

    - ``DECIDE_ENGINE_SCORE_RANK_POOL`` (inteiro): tecto absoluto de nomes (≥ ``top_q``).
    - Senão ``DECIDE_ENGINE_SCORE_RANK_POOL_MULT`` (float, default **3**): ``ceil(top_q * mult)``, limitado ao universo.

    Isto permite ao PL ou ao cap por zona usar titulares **abaixo** do top imediato (souvente outras regiões).
    """
    n = max(0, int(universe_size))
    tq = max(1, int(top_q))
    if n <= 0:
        return 0
    raw = (os.environ.get("DECIDE_ENGINE_SCORE_RANK_POOL") or "").strip()
    if raw:
        try:
            cap_n = int(raw)
            return max(tq, min(max(1, cap_n), n))
        except ValueError:
            pass
    mraw = (os.environ.get("DECIDE_ENGINE_SCORE_RANK_POOL_MULT") or "3").strip()
    try:
        mult = float(mraw)
    except ValueError:
        mult = 3.0
    mult = max(mult, 1.0)
    return min(n, max(tq, int(math.ceil(tq * mult))))


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
    include_series: bool = True,
    lookback: int = 120,
    **kwargs
):

    price_universe_meta: dict = {}
    if prices is None:
        prices, price_universe_meta = _load_prices_from_disk()

    window = prices.ffill().dropna(how="all")

    scores = compute_multi_horizon_score(window)

    cap_use = _effective_cap_for_profile(profile, cap_per_ticker)
    n_univ = max(1, int(top_q))
    pool_n = score_rank_pool_n(n_univ, len(scores))
    selected = scores.iloc[:pool_n] if pool_n > 0 else scores.iloc[:n_univ]
    linear_w = _is_raw_profile(profile)

    bench_zones = benchmark_zone_weights(window, benchmark)
    ticker_zones = load_ticker_zone_lookup(window.columns) if _zone_cap_enabled() else {}
    zone_cap_mult = _zone_cap_multiplier_from_env()

    def _apply_zone_cap_if_needed(ws: pd.Series) -> pd.Series:
        if not _zone_cap_enabled() or zone_cap_mult <= 0:
            return ws
        if not ticker_zones:
            return ws
        return apply_zone_caps_vs_benchmark_weights(
            ws,
            ticker_zones,
            bench_zones,
            multiplier=zone_cap_mult,
        )

    def _weights_engine(selected_ser: pd.Series) -> tuple[pd.Series, bool]:
        """Heurística ``build_weights`` + cap zona iterativo, ou PL (opt-in) quando viável."""
        tk = [str(x) for x in selected_ser.index]
        if (
            _zone_cap_enabled()
            and _engine_lp_zone_caps_enabled()
            and ticker_zones
            and len(tk) > 0
        ):
            sub_scores = scores.reindex(selected_ser.index)
            lp_w = solve_max_utility_weights_under_zone_and_ticker_caps(
                tk,
                sub_scores,
                ticker_zones,
                bench_zones,
                cap_per_ticker=cap_use,
                multiplier=zone_cap_mult,
                linear_score_weights=linear_w,
            )
            if lp_w is not None and float(lp_w.sum()) > 1e-18:
                return lp_w.astype(float), True
        bw = build_weights(selected_ser, cap_use, linear_score_weights=linear_w)
        return _apply_zone_cap_if_needed(bw), False

    weights, weights_used_lp = _weights_engine(selected)

    w_emit = weights[weights > 1e-9]
    if float(w_emit.sum()) > 1e-18:
        w_emit = w_emit / float(w_emit.sum())
    else:
        w_emit = weights.copy()
        if float(w_emit.sum()) > 1e-18:
            w_emit = w_emit / float(w_emit.sum())

    selection = []
    for t in w_emit.sort_values(ascending=False).index:
        sc = float(scores[t]) if t in scores.index else float(selected.get(t, 0.0))
        selection.append({
            "ticker": str(t),
            "weight": float(w_emit[t]),
            "score": sc,
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

            pool_hist = score_rank_pool_n(n_univ, len(hist_scores))
            selected_hist = hist_scores.iloc[:pool_hist] if pool_hist > 0 else hist_scores.iloc[:n_univ]

            current_weights, _ = _weights_engine(selected_hist)

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
    relative_kpis = _relative_kpis(equity_curve, benchmark_curve)

    def _series_date_str(d) -> str:
        if hasattr(d, "strftime"):
            return d.strftime("%Y-%m-%d")
        s = str(d)
        return s[:10] if len(s) >= 10 else s

    result: dict[str, Any] = {
        "ok": True,
        "engine_version": ENGINE_VERSION,
        "price_universe": price_universe_meta,
        "selection": selection,
        "weights": {str(k): float(v) for k, v in w_emit.items()},
        "kpis": kpis,
        "benchmark_kpis": bench_kpis,
        "relative_kpis": relative_kpis,
        "as_of_date": str(window.index[-1].date()),
    }
    result.setdefault("meta", {})["zone_cap_vs_benchmark"] = {
        "enabled": _zone_cap_enabled(),
        "multiplier": zone_cap_mult,
        "benchmark_zone_weights": bench_zones,
        "tickers_with_zone_meta": int(
            sum(1 for t in weights.index if _normalize_ticker_key_meta(str(t)) in ticker_zones)
        ),
    }
    result["meta"]["engine_lp_zone_caps"] = {
        "env_requested": _engine_lp_zone_caps_enabled(),
        "used_lp_for_initial_weights": bool(weights_used_lp),
    }
    result["meta"]["score_rank_pool"] = {
        "top_q": int(n_univ),
        "pool_n": int(pool_n),
        "universe_scores": int(len(scores)),
        "selection_lines": int(len(selection)),
    }
    if include_series:
        result["series"] = {
            "dates": [_series_date_str(d) for d in equity_curve.index],
            "equity_overlayed": [float(x) for x in equity_curve.values],
            "benchmark_equity": [float(x) for x in benchmark_curve.values],
        }

    return result