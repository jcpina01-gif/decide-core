# -*- coding: utf-8 -*-
"""
Varredura de robustez do motor ``engine_v2.run_model`` (momentum multi-horizonte + CAP + vol target por perfil).

Executar a partir da pasta ``backend/``::

    python scripts/model_robustness_sweep.py
    python scripts/model_robustness_sweep.py --quick
    python scripts/model_robustness_sweep.py --csv ../tmp_diag/model_robustness.csv

Saída: KPIs do modelo vs benchmark, várias combinações de perfil / top_q / cap / benchmark explícito
e sub-janelas temporais (últimos 5y / 10y de pregão aprox.) + um bloco leve de stress por remoção aleatória
de colunas de preços (universo mais «espesso»).
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import random
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Optional

import numpy as np
import pandas as pd

# Garantir imports como nos outros scripts (cwd = backend/)
_BACKEND = Path(__file__).resolve().parent.parent
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))

import engine_v2 as ev2  # noqa: E402


def _fmt(x: float, nd: int = 4) -> str:
    if x is None or (isinstance(x, float) and (np.isnan(x) or np.isinf(x))):
        return "—"
    return f"{float(x):.{nd}f}"


def _kpis(res: dict) -> tuple[dict[str, float], dict[str, float]]:
    k = res.get("kpis") or {}
    b = res.get("benchmark_kpis") or {}
    return (
        {kk: float(k[kk]) for kk in ("cagr", "vol", "sharpe", "max_drawdown") if kk in k},
        {kk: float(b[kk]) for kk in ("cagr", "vol", "sharpe", "max_drawdown") if kk in b},
    )


def _top5_tickers(res: dict) -> str:
    sel = res.get("selection") or []
    out = []
    for row in sel[:5]:
        t = str(row.get("ticker", ""))
        w = float(row.get("weight", 0) or 0)
        if t:
            out.append(f"{t}:{w:.3f}")
    return "|".join(out)


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


@dataclass
class Row:
    suite: str
    window: str
    profile: str
    top_q: int
    cap: float
    benchmark: str
    ok: bool
    err: str
    cagr: float
    b_cagr: float
    vol: float
    sharpe: float
    max_dd: float
    top5: str

    def cells(self) -> list[Any]:
        ex = self.cagr - self.b_cagr if self.ok else float("nan")
        return [
            self.suite,
            self.window,
            self.profile,
            self.top_q,
            self.cap,
            self.benchmark,
            self.ok,
            self.err,
            _fmt(self.cagr),
            _fmt(self.b_cagr),
            _fmt(ex),
            _fmt(self.vol),
            _fmt(self.sharpe),
            _fmt(self.max_dd),
            self.top5,
        ]


def _print_table(rows: list[Row]) -> None:
    headers = [
        "suite",
        "window",
        "profile",
        "top_q",
        "cap",
        "bench",
        "ok",
        "err",
        "cagr",
        "b_cagr",
        "excess",
        "vol",
        "sharpe",
        "max_dd",
        "top5",
    ]
    widths = [len(h) for h in headers]
    data: list[list[str]] = []
    for r in rows:
        cells = [str(x) for x in r.cells()]
        data.append(cells)
        for i, c in enumerate(cells):
            widths[i] = max(widths[i], len(c))

    def line(cs: list[str]) -> str:
        return "  ".join(c.ljust(widths[i]) for i, c in enumerate(cs))

    print(line(headers))
    print(line(["-" * w for w in widths]))
    for cs in data:
        print(line(cs))


def _write_csv(path: Path, rows: list[Row]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(
            [
                "suite",
                "window",
                "profile",
                "top_q",
                "cap",
                "benchmark",
                "ok",
                "error",
                "cagr",
                "bench_cagr",
                "excess_cagr",
                "vol",
                "sharpe",
                "max_drawdown",
                "top5",
            ]
        )
        for r in rows:
            ex = r.cagr - r.b_cagr if r.ok else float("nan")
            w.writerow(
                [
                    r.suite,
                    r.window,
                    r.profile,
                    r.top_q,
                    r.cap,
                    r.benchmark,
                    r.ok,
                    r.err,
                    r.cagr if r.ok else "",
                    r.b_cagr if r.ok else "",
                    ex if r.ok else "",
                    r.vol if r.ok else "",
                    r.sharpe if r.ok else "",
                    r.max_dd if r.ok else "",
                    r.top5,
                ]
            )


def main() -> int:
    ap = argparse.ArgumentParser(description="Robustez: varredura engine_v2.run_model")
    ap.add_argument("--quick", action="store_true", help="Grelha mais pequena (mais rápido)")
    ap.add_argument("--csv", type=str, default="", help="Escrever CSV para este caminho")
    ap.add_argument("--json", type=str, default="", help="Escrever JSON com resumo agregado")
    ap.add_argument("--seed", type=int, default=42, help="Semente RNG para stress de colunas")
    args = ap.parse_args()

    os.chdir(_BACKEND)
    prices_full, meta = ev2._load_prices_from_disk()
    n_cols = len(prices_full.columns)
    n_days = len(prices_full.index)

    print("=== DECIDE engine_v2 robustness sweep ===", flush=True)
    print(f"engine_version: {ev2.ENGINE_VERSION}", flush=True)
    print(f"price_universe: {json.dumps(meta, ensure_ascii=False)}", flush=True)
    print(f"shape: {n_days} dias × {n_cols} séries", flush=True)

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

    rows: list[Row] = []

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
            rows.append(
                Row(
                    suite,
                    window,
                    profile,
                    top_q,
                    cap,
                    bench_tag,
                    False,
                    str(r.get("error", "?"))[:120],
                    float("nan"),
                    float("nan"),
                    float("nan"),
                    float("nan"),
                    float("nan"),
                    "",
                )
            )
            return
        mk, bk = _kpis(r)
        rows.append(
            Row(
                suite,
                window,
                profile,
                top_q,
                cap,
                bench_tag,
                True,
                "",
                float(mk.get("cagr", float("nan"))),
                float(bk.get("cagr", float("nan"))),
                float(mk.get("vol", float("nan"))),
                float(mk.get("sharpe", float("nan"))),
                float(mk.get("max_drawdown", float("nan"))),
                _top5_tickers(r),
            )
        )

    # --- Grelha principal ---
    for wtag in windows:
        px = _subwindow(prices_full, wtag)
        for prof in profiles:
            for tq in top_qs:
                for cap in caps:
                    for bench in benchmarks:
                        emit("grid", wtag, prof, tq, cap, bench, px)

    # --- Stress: remover fração aleatória de colunas (mantendo sempre SPY se existir, para benchmark directo) ---
    cols_all = list(prices_full.columns)
    rng = random.Random(int(args.seed))
    for i in range(chaos_runs):
        keep = set(cols_all)
        n_drop = max(1, int(len(cols_all) * drop_frac))
        victims = rng.sample(cols_all, k=min(n_drop, len(cols_all)))
        for v in victims:
            if v == "SPY" and "SPY" in cols_all:
                # manter pelo menos um benchmark líquido na maior parte dos runs
                if rng.random() < 0.65:
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

    _print_table(rows)

    ok_n = sum(1 for r in rows if r.ok)
    print(f"\nCorridas OK: {ok_n}/{len(rows)}", flush=True)

    # Resumo: estabilidade do CAGR «moderado» full vs 5y
    def median(xs: list[float]) -> float:
        s = sorted(xs)
        if not s:
            return float("nan")
        m = len(s) // 2
        return float(s[m]) if len(s) % 2 else (s[m - 1] + s[m]) / 2

    mod_full = [r.cagr for r in rows if r.ok and r.suite == "grid" and r.profile == "moderado" and r.window == "full"]
    mod_5y = [r.cagr for r in rows if r.ok and r.suite == "grid" and r.profile == "moderado" and r.window == "5y"]
    summary = {
        "engine_version": ev2.ENGINE_VERSION,
        "price_universe": meta,
        "runs_total": len(rows),
        "runs_ok": ok_n,
        "moderado_cagr_median_full_window": median(mod_full),
        "moderado_cagr_median_5y_window": median(mod_5y),
    }
    print("\nResumo:", json.dumps(summary, indent=2, ensure_ascii=False), flush=True)

    if args.csv:
        _write_csv(Path(args.csv), rows)
        print(f"\nCSV: {args.csv}", flush=True)
    if args.json:
        Path(args.json).parent.mkdir(parents=True, exist_ok=True)
        Path(args.json).write_text(json.dumps(summary, indent=2, ensure_ascii=False), encoding="utf-8")
        print(f"JSON: {args.json}", flush=True)

    return 0 if ok_n == len(rows) else 0


if __name__ == "__main__":
    raise SystemExit(main())
