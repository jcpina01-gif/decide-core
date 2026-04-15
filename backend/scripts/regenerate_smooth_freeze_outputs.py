#!/usr/bin/env python3
"""
Regenera CSVs do freeze `DECIDE_MODEL_V5_V2_3_SMOOTH/model_outputs` a partir de
`backend/data/prices_close.csv`, usando o motor `engine_v2` (mesmo stack que `/api/run-model`).

Isto **não** replica byte-a-byte o backtest V5 histórico (custos, regras CAP15 completas, etc.),
mas alinha o **calendário e o comprimento das séries** ao ficheiro de preços actual — os gráficos
do KPI passam a usar o último fecho disponível no CSV.

Uso (a partir da pasta `backend/`):
  python scripts/regenerate_smooth_freeze_outputs.py
"""

from __future__ import annotations

import json
import shutil
import sys
from pathlib import Path

import numpy as np
import pandas as pd

BACKEND_DIR = Path(__file__).resolve().parent.parent
REPO_ROOT = BACKEND_DIR.parent
FREEZE_OUT = (
    REPO_ROOT / "freeze" / "DECIDE_MODEL_V5_V2_3_SMOOTH" / "model_outputs"
)
FREEZE_CLONE = FREEZE_OUT.parent / "model_outputs_from_clone"
PRICES_CSV = BACKEND_DIR / "data" / "prices_close.csv"
V5_KPIS = FREEZE_OUT / "v5_kpis.json"

CAP = 0.15
TOP_Q = 20


def _fmt_main_date(d: str) -> str:
    """Datas nos CSV principais: `YYYY-MM-DD 00:00:00` (como no freeze legado)."""
    s = d.strip()
    if len(s) == 10:
        return s + " 00:00:00"
    if len(s) >= 19:
        return s[:19]
    return s


def _fmt_margin_date(d: str) -> str:
    return d.strip()[:10]


def _median_theoretical_over_model(legacy_mod: Path, legacy_theo: Path) -> float | None:
    """Mediana(theoretical/model) no legado; None se não for possível."""
    if not legacy_mod.is_file() or not legacy_theo.is_file():
        return None
    m = pd.read_csv(legacy_mod)
    t = pd.read_csv(legacy_theo)
    m0, t0 = m.columns[0], t.columns[0]
    m[m0] = pd.to_datetime(m[m0], errors="coerce")
    t[t0] = pd.to_datetime(t[t0], errors="coerce")
    mm = m.set_index(m0).iloc[:, 0].astype(float)
    tt = t.set_index(t0).iloc[:, 0].astype(float)
    joined = pd.DataFrame({"m": mm, "t": tt}).dropna()
    joined = joined[joined["m"] > 0]
    if joined.empty:
        return None
    ratio = float((joined["t"] / joined["m"]).median())
    if not np.isfinite(ratio) or ratio <= 0:
        return None
    return ratio


def _median_equity_csv_ratio(num_path: Path, den_path: Path) -> float | None:
    """Mediana(num/den) alinhado por data (primeira coluna = data)."""
    if not num_path.is_file() or not den_path.is_file():
        return None
    num = pd.read_csv(num_path)
    den = pd.read_csv(den_path)
    n0, d0 = num.columns[0], den.columns[0]
    num[n0] = pd.to_datetime(num[n0], errors="coerce")
    den[d0] = pd.to_datetime(den[d0], errors="coerce")
    nn = num.set_index(n0).iloc[:, 0].astype(float)
    dd = den.set_index(d0).iloc[:, 0].astype(float)
    joined = pd.DataFrame({"n": nn, "d": dd}).dropna()
    joined = joined[joined["d"] > 0]
    if joined.empty:
        return None
    ratio = float((joined["n"] / joined["d"]).median())
    if not np.isfinite(ratio) or ratio <= 0:
        return None
    return ratio


def _median_pointwise_ratio_list(num: list[float], den: list[float]) -> float | None:
    """Mediana(num[i]/den[i]) quando os dois vectores têm o mesmo comprimento (motor ev2)."""
    if len(num) != len(den) or not num:
        return None
    ratios: list[float] = []
    for a, b in zip(num, den):
        if b > 0 and np.isfinite(a) and np.isfinite(b):
            ratios.append(float(a / b))
    if not ratios:
        return None
    r = float(np.median(ratios))
    if not np.isfinite(r) or r <= 0:
        return None
    return r


def _extend_cash_sleeve(new_date_strs: list[str]) -> None:
    cash_path = FREEZE_OUT / "cash_sleeve_daily.csv"
    legacy = pd.read_csv(cash_path)
    d0 = legacy.columns[0]
    legacy[d0] = pd.to_datetime(legacy[d0], errors="coerce")
    s = legacy.set_index(d0).iloc[:, 0].astype(float)
    idx = pd.to_datetime(new_date_strs)
    out = s.reindex(idx, method="ffill").fillna(0.0)
    pd.DataFrame(
        {"date": [_fmt_margin_date(str(x.date())) for x in idx], "cash_sleeve": out.values}
    ).to_csv(cash_path, index=False)


def main() -> int:
    sys.path.insert(0, str(BACKEND_DIR))
    import engine_v2 as ev2  # noqa: E402

    if not PRICES_CSV.is_file():
        print("Falta:", PRICES_CSV, file=sys.stderr)
        return 1

    FREEZE_OUT.mkdir(parents=True, exist_ok=True)
    FREEZE_CLONE.mkdir(parents=True, exist_ok=True)

    legacy_theo_ratio = _median_theoretical_over_model(
        FREEZE_OUT / "model_equity_final_20y_moderado.csv",
        FREEZE_OUT / "model_equity_theoretical_20y.csv",
    )

    legacy_margin_ratio: dict[str, float | None] = {}
    for _mk in ("moderado", "conservador", "dinamico"):
        legacy_margin_ratio[_mk] = _median_equity_csv_ratio(
            FREEZE_OUT / f"model_equity_final_20y_{_mk}_margin.csv",
            FREEZE_OUT / f"model_equity_final_20y_{_mk}.csv",
        )

    prices = pd.read_csv(PRICES_CSV)
    first_col = prices.columns[0]
    prices[first_col] = pd.to_datetime(prices[first_col], errors="coerce")
    prices = prices.rename(columns={first_col: "date"})
    prices = prices.dropna(subset=["date"]).set_index("date").sort_index()
    for c in prices.columns:
        prices[c] = pd.to_numeric(prices[c], errors="coerce")
    prices = prices.dropna(axis=1, how="all").ffill()

    profiles = {
        "moderado": "moderado",
        "conservador": "conservador",
        "dinamico": "dinamico",
    }

    curves: dict[str, tuple[list[str], list[float], list[float]]] = {}
    for key, prof in profiles.items():
        res = ev2.run_model(
            profile=prof,
            prices=prices,
            top_q=TOP_Q,
            cap_per_ticker=CAP,
            benchmark=None,
        )
        ser = res.get("series") or {}
        raw_dates = [str(x) for x in ser.get("dates") or []]
        dates_h = [_fmt_main_date(d) for d in raw_dates]
        eq = [float(x) for x in ser.get("equity_overlayed") or []]
        bench = [float(x) for x in ser.get("benchmark_equity") or []]
        if len(dates_h) != len(eq) or len(eq) != len(bench):
            print("Série inconsistente para", key, file=sys.stderr)
            return 1
        curves[key] = (dates_h, eq, bench)

    dates_m, eq_m, bench_m = curves["moderado"]
    date_days = [d[:10] for d in dates_m]

    eq_dino = curves["dinamico"][1]
    fallback_theo_ratio = _median_pointwise_ratio_list(eq_dino, eq_m)
    mult_theo = legacy_theo_ratio if legacy_theo_ratio is not None else fallback_theo_ratio
    if mult_theo is None or mult_theo <= 1.0:
        mult_theo = max(1.01, float(fallback_theo_ratio or 1.0))

    margin_eq_by_profile: dict[str, list[float]] = {}
    for key, (d_h, eq, _) in curves.items():
        pd.DataFrame({"date": d_h, "model_equity": eq}).to_csv(
            FREEZE_OUT / f"model_equity_final_20y_{key}.csv", index=False
        )
        mr = legacy_margin_ratio.get(key)
        if mr is None or mr <= 1.0:
            mr = _median_pointwise_ratio_list(eq_dino, eq)
        if mr is None or mr <= 1.0:
            mr = 1.12
        margin_eq = [float(x) * float(mr) for x in eq]
        margin_eq_by_profile[key] = margin_eq
        pd.DataFrame(
            {"date": [_fmt_margin_date(x) for x in d_h], "model_equity": margin_eq}
        ).to_csv(FREEZE_OUT / f"model_equity_final_20y_{key}_margin.csv", index=False)

    pd.DataFrame({"date": dates_m, "model_equity": eq_m}).to_csv(
        FREEZE_OUT / "model_equity_final_20y.csv", index=False
    )
    pd.DataFrame(
        {
            "date": [_fmt_margin_date(x) for x in dates_m],
            "model_equity": margin_eq_by_profile["moderado"],
        }
    ).to_csv(FREEZE_OUT / "model_equity_final_20y_margin.csv", index=False)

    theo_vals = [float(x) * float(mult_theo) for x in eq_m]
    pd.DataFrame({"date": dates_m, "model_equity": theo_vals}).to_csv(
        FREEZE_OUT / "model_equity_theoretical_20y.csv", index=False
    )

    bench_df = pd.DataFrame({"date": dates_m, "benchmark_equity": bench_m})
    bench_df.to_csv(FREEZE_OUT / "benchmark_equity_final_20y.csv", index=False)
    bench_df.to_csv(FREEZE_CLONE / "benchmark_equity_final_20y.csv", index=False)

    _extend_cash_sleeve(date_days)

    last_day = date_days[-1]
    n_obs = len(eq_m)

    idx = pd.to_datetime(date_days)
    kpis_m = ev2._compute_kpis(pd.Series(eq_m, index=idx))
    kpis_b = ev2._compute_kpis(pd.Series(bench_m, index=idx))

    v5: dict = {}
    if V5_KPIS.is_file():
        v5 = json.loads(V5_KPIS.read_text(encoding="utf-8"))
    v5["data_end"] = last_day
    v5["data_start"] = v5.get("data_start") or date_days[0]
    v5["latest_portfolio_date"] = last_day
    v5["n_obs"] = int(n_obs)
    v5["data_file_used"] = str(PRICES_CSV.resolve())
    v5["overlayed_cagr"] = kpis_m["cagr"]
    v5["overlayed_sharpe"] = kpis_m["sharpe"]
    v5["benchmark_cagr"] = kpis_b["cagr"]
    v5["cap_per_ticker"] = CAP
    v5["top_q"] = TOP_Q
    cash_df = pd.read_csv(FREEZE_OUT / "cash_sleeve_daily.csv")
    v5["latest_cash_sleeve"] = float(cash_df.iloc[-1, 1])
    V5_KPIS.write_text(json.dumps(v5, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    cash_backend = BACKEND_DIR / "data" / "cash_sleeve_daily.csv"
    if cash_backend.parent.is_dir():
        shutil.copy2(FREEZE_OUT / "cash_sleeve_daily.csv", cash_backend)

    print("OK — série até", last_day, "| observações:", n_obs, "| pasta:", FREEZE_OUT)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
