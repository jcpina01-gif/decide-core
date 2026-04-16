# -*- coding: utf-8 -*-
"""
Varredura de robustez do motor ``engine_v2.run_model``.

O motor devolve KPIs completos em ``kpis``, ``benchmark_kpis`` e ``relative_kpis`` (ver ``engine_v2._compute_kpis``).

Executar a partir da pasta ``backend/``::

    python scripts/model_robustness_sweep.py --quick
    python scripts/model_robustness_sweep.py --csv ../tmp_diag/model_robustness_kpis_full.csv
    python scripts/model_robustness_sweep.py --json ../tmp_diag/model_robustness_summary.json

Por defeito grava CSV completo em ``../tmp_diag/model_robustness_kpis_full.csv`` se existir a pasta
``tmp_diag`` no repositório (senão use ``--csv``). Use ``--no-auto-csv`` para desligar.
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import random
import sys
from pathlib import Path
from typing import Any, Optional

import numpy as np
import pandas as pd

_BACKEND = Path(__file__).resolve().parent.parent
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))

import engine_v2 as ev2  # noqa: E402


def _fmt(x: float, nd: int = 4) -> str:
    if x is None or (isinstance(x, float) and (np.isnan(x) or np.isinf(x))):
        return "—"
    return f"{float(x):.{nd}f}"


def _top5_tickers(res: dict) -> str:
    sel = res.get("selection") or []
    out = []
    for row in sel[:5]:
        t = str(row.get("ticker", ""))
        w = float(row.get("weight", 0) or 0)
        if t:
            out.append(f"{t}:{w:.3f}")
    return "|".join(out)


def _flatten_run(
    *,
    suite: str,
    window: str,
    profile: str,
    top_q: int,
    cap: float,
    benchmark: str,
    ok: bool,
    err: str,
    res: Optional[dict],
) -> dict[str, Any]:
    row: dict[str, Any] = {
        "suite": suite,
        "window": window,
        "profile": profile,
        "top_q": top_q,
        "cap": cap,
        "benchmark": benchmark,
        "ok": ok,
        "error": err,
        "top5": _top5_tickers(res) if res else "",
    }
    if not ok or not res:
        return row
    for k, v in (res.get("kpis") or {}).items():
        row[f"model_{k}"] = v
    for k, v in (res.get("benchmark_kpis") or {}).items():
        row[f"benchmark_{k}"] = v
    for k, v in (res.get("relative_kpis") or {}).items():
        row[f"relative_{k}"] = v
    return row


def _run_safe(
    *,
    prices: pd.DataFrame,
    profile: Optional[str],
    top_q: int,
    cap: float,
    benchmark: Optional[str],
) -> tuple[bool, dict[str, Any]]:
    try:
        r = ev2.run_model(
            profile=profile,
            prices=prices,
            top_q=top_q,
            cap_per_ticker=cap,
            benchmark=benchmark,
            include_series=False,
        )
        if not r.get("ok"):
            return False, {"error": "not_ok"}
        return True, r
    except Exception as e:  # noqa: BLE001
        return False, {"error": str(e)}


def _subwindow(prices: pd.DataFrame, tag: str) -> pd.DataFrame:
    if tag == "full":
        return prices
    n = len(prices.index)
    if tag == "10y":
        take = min(n, int(252 * 10))
    elif tag == "5y":
        take = min(n, int(252 * 5))
    elif tag == "3y":
        take = min(n, int(252 * 3))
    else:
        return prices
    return prices.iloc[-take:].copy()


def _collect_fieldnames(rows: list[dict[str, Any]]) -> list[str]:
    keys: set[str] = set()
    for r in rows:
        keys.update(r.keys())
    meta = ["suite", "window", "profile", "top_q", "cap", "benchmark", "ok", "error", "top5"]
    front = [k for k in meta if k in keys]
    mk = sorted(k for k in keys if k.startswith("model_"))
    bk = sorted(k for k in keys if k.startswith("benchmark_"))
    rk = sorted(k for k in keys if k.startswith("relative_"))
    other = sorted(k for k in keys if k not in front and k not in mk and k not in bk and k not in rk)
    return front + mk + bk + rk + other


def _print_table(rows: list[dict[str, Any]]) -> None:
    headers = [
        "suite",
        "window",
        "profile",
        "top_q",
        "cap",
        "bench",
        "ok",
        "err",
        "m_cagr",
        "b_cagr",
        "excess",
        "m_vol",
        "m_sharpe",
        "m_sortino",
        "m_max_dd",
        "rel_IR",
        "rel_beta",
        "top5",
    ]
    widths = [len(h) for h in headers]
    data: list[list[str]] = []

    def pick(r: dict[str, Any], key: str) -> str:
        v = r.get(key)
        if v is None:
            return "—"
        if isinstance(v, float) and (np.isnan(v) or np.isinf(v)):
            return "—"
        if isinstance(v, float):
            return _fmt(v)
        return str(v)[:80]

    for r in rows:
        ok = bool(r.get("ok"))
        m_c = float(r.get("model_cagr", float("nan"))) if ok else float("nan")
        b_c = float(r.get("benchmark_cagr", float("nan"))) if ok else float("nan")
        ex = m_c - b_c if ok else float("nan")
        err = str(r.get("error", ""))[:40]
        cells = [
            str(r.get("suite", "")),
            str(r.get("window", "")),
            str(r.get("profile", "")),
            str(r.get("top_q", "")),
            str(r.get("cap", "")),
            str(r.get("benchmark", "")),
            "True" if ok else "False",
            err,
            pick(r, "model_cagr") if ok else "—",
            pick(r, "benchmark_cagr") if ok else "—",
            _fmt(ex) if ok else "—",
            pick(r, "model_vol") if ok else "—",
            pick(r, "model_sharpe") if ok else "—",
            pick(r, "model_sortino") if ok else "—",
            pick(r, "model_max_drawdown") if ok else "—",
            pick(r, "relative_information_ratio") if ok else "—",
            pick(r, "relative_beta_vs_benchmark") if ok else "—",
            str(r.get("top5", ""))[:56],
        ]
        data.append(cells)
        for i, c in enumerate(cells):
            widths[i] = max(widths[i], len(c))

    def line(cs: list[str]) -> str:
        return "  ".join(c.ljust(widths[i]) for i, c in enumerate(cs))

    print(line(headers))
    print(line(["-" * w for w in widths]))
    for cs in data:
        print(line(cs))


def _write_csv(path: Path, rows: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fieldnames = _collect_fieldnames(rows)
    with path.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames, extrasaction="ignore")
        w.writeheader()
        for r in rows:
            out = {k: r.get(k, "") for k in fieldnames}
            w.writerow(out)


def main() -> int:
    ap = argparse.ArgumentParser(description="Robustez: varredura engine_v2.run_model (todos os KPIs no CSV)")
    ap.add_argument("--quick", action="store_true", help="Grelha mais pequena")
    ap.add_argument("--csv", type=str, default="", help="CSV com todas as colunas KPI")
    ap.add_argument("--no-auto-csv", action="store_true", help="Não gravar CSV automático em tmp_diag")
    ap.add_argument("--json", type=str, default="", help="JSON: resumo + lista de chaves KPI")
    ap.add_argument("--jsonl", type=str, default="", help="Uma linha JSON por corrida (todas as chaves)")
    ap.add_argument("--seed", type=int, default=42, help="Semente RNG (stress de colunas)")
    args = ap.parse_args()

    os.chdir(_BACKEND)
    prices_full, meta = ev2._load_prices_from_disk()
    n_cols = len(prices_full.columns)
    n_days = len(prices_full.index)

    print("=== DECIDE engine_v2 robustness sweep (full KPIs) ===", flush=True)
    print(f"engine_version: {ev2.ENGINE_VERSION}", flush=True)
    print(f"price_universe: {json.dumps(meta, ensure_ascii=False)}", flush=True)
    print(f"shape: {n_days} dias x {n_cols} series", flush=True)

    if args.quick:
        profiles = ["moderado", "conservador", "dinamico"]
        top_qs = [15, 20]
        caps = [0.15, 0.20]
        benchmarks: list[Optional[str]] = ["SPY", None]
        windows = ["full", "10y", "5y"]
        chaos_runs = 4
        drop_frac = 0.04
    else:
        profiles = ["moderado", "conservador", "dinamico", "raw"]
        top_qs = [12, 15, 20, 25]
        caps = [0.10, 0.15, 0.20]
        benchmarks = ["SPY", None]
        windows = ["full", "10y", "5y", "3y"]
        chaos_runs = 8
        drop_frac = 0.03

    rows_out: list[dict[str, Any]] = []

    def emit(
        suite: str,
        window: str,
        profile: str,
        top_q: int,
        cap: float,
        benchmark: Optional[str],
        prices: pd.DataFrame,
    ) -> None:
        bench_tag = benchmark if benchmark else "BLEND"
        ok, r = _run_safe(
            prices=prices,
            profile=profile,
            top_q=top_q,
            cap=cap,
            benchmark=benchmark,
        )
        if not ok:
            rows_out.append(
                _flatten_run(
                    suite=suite,
                    window=window,
                    profile=profile,
                    top_q=top_q,
                    cap=cap,
                    benchmark=bench_tag,
                    ok=False,
                    err=str(r.get("error", "?"))[:200],
                    res=None,
                )
            )
            return
        rows_out.append(
            _flatten_run(
                suite=suite,
                window=window,
                profile=profile,
                top_q=top_q,
                cap=cap,
                benchmark=bench_tag,
                ok=True,
                err="",
                res=r,
            )
        )

    for wtag in windows:
        px = _subwindow(prices_full, wtag)
        for prof in profiles:
            for tq in top_qs:
                for cap in caps:
                    for bench in benchmarks:
                        emit("grid", wtag, prof, tq, cap, bench, px)

    cols_all = list(prices_full.columns)
    rng = random.Random(int(args.seed))
    for i in range(chaos_runs):
        keep = set(cols_all)
        n_drop = max(1, int(len(cols_all) * drop_frac))
        victims = rng.sample(cols_all, k=min(n_drop, len(cols_all)))
        for v in victims:
            if v == "SPY" and "SPY" in cols_all and rng.random() < 0.65:
                continue
            keep.discard(v)
        if len(keep) < 30:
            continue
        px_c = prices_full[list(sorted(keep))].copy()
        emit(
            f"chaos_{i+1}",
            "full",
            "moderado",
            20,
            0.20,
            "SPY" if "SPY" in px_c.columns else None,
            px_c,
        )

    _print_table(rows_out)

    ok_n = sum(1 for r in rows_out if r.get("ok"))
    print(f"\nCorridas OK: {ok_n}/{len(rows_out)}", flush=True)

    kpi_sample: dict[str, Any] = {}
    for r in rows_out:
        if r.get("ok"):
            kpi_sample = {k: v for k, v in r.items() if k.startswith(("model_", "benchmark_", "relative_"))}
            break
    print("\nChaves KPI exportadas no CSV (amostra 1 corrida):", flush=True)
    print(json.dumps(sorted(kpi_sample.keys()), indent=2, ensure_ascii=False), flush=True)
    print("\nValores KPI (amostra):", flush=True)
    print(json.dumps(kpi_sample, indent=2, ensure_ascii=False), flush=True)

    def median(xs: list[float]) -> float:
        s = sorted(xs)
        if not s:
            return float("nan")
        m = len(s) // 2
        return float(s[m]) if len(s) % 2 else (s[m - 1] + s[m]) / 2

    mod_full = [
        float(r["model_cagr"])
        for r in rows_out
        if r.get("ok") and r.get("suite") == "grid" and r.get("profile") == "moderado" and r.get("window") == "full"
    ]
    mod_5y = [
        float(r["model_cagr"])
        for r in rows_out
        if r.get("ok") and r.get("suite") == "grid" and r.get("profile") == "moderado" and r.get("window") == "5y"
    ]
    summary = {
        "engine_version": ev2.ENGINE_VERSION,
        "price_universe": meta,
        "runs_total": len(rows_out),
        "runs_ok": ok_n,
        "kpi_column_groups": {
            "model": sorted({k[7:] for r in rows_out for k in r if str(k).startswith("model_")}),
            "benchmark": sorted({k[11:] for r in rows_out for k in r if str(k).startswith("benchmark_")}),
            "relative": sorted({k[10:] for r in rows_out for k in r if str(k).startswith("relative_")}),
        },
        "moderado_cagr_median_full_window": median(mod_full),
        "moderado_cagr_median_5y_window": median(mod_5y),
    }

    csv_path = args.csv.strip()
    if not csv_path and not args.no_auto_csv:
        auto = _BACKEND.parent / "tmp_diag" / "model_robustness_kpis_full.csv"
        if auto.parent.is_dir():
            csv_path = str(auto)
    if csv_path:
        _write_csv(Path(csv_path), rows_out)
        print(f"\nCSV completo (todos os KPIs): {csv_path}", flush=True)

    if args.json:
        Path(args.json).parent.mkdir(parents=True, exist_ok=True)
        Path(args.json).write_text(json.dumps(summary, indent=2, ensure_ascii=False), encoding="utf-8")
        print(f"JSON resumo: {args.json}", flush=True)

    if args.jsonl:
        p = Path(args.jsonl)
        p.parent.mkdir(parents=True, exist_ok=True)
        with p.open("w", encoding="utf-8") as jf:
            for r in rows_out:
                jf.write(json.dumps(r, ensure_ascii=False) + "\n")
        print(f"JSONL: {args.jsonl}", flush=True)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
