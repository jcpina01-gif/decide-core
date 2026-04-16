#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Bateria de testes sobre o **modelo smooth** (export freeze ``DECIDE_MODEL_V5_V2_3_SMOOTH``).

- Lê curvas CSV em ``freeze/.../model_outputs`` + ``benchmark_equity_final_20y.csv``.
- Calcula os mesmos KPIs estendidos que ``engine_v2`` (import de ``_compute_kpis`` / ``_relative_kpis``).
- Janelas: série completa, últimos ~10y / 5y / 3y (dias de pregão).
- Checagens estruturais + regras de negócio (ordem de risco perfis, margem vs spot).

Uso (a partir de ``backend/``)::

    python scripts/smooth_model_battery.py
    python scripts/smooth_model_battery.py --freeze-dir ../freeze/DECIDE_MODEL_V5_V2_3_SMOOTH/model_outputs
    python scripts/smooth_model_battery.py --csv ../tmp_diag/smooth_battery.csv
"""

from __future__ import annotations

import argparse
import csv
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

# (id, ficheiro modelo, coluna)
SMOOTH_CURVES: list[tuple[str, str, str]] = [
    ("moderado_overlay", "model_equity_final_20y_moderado.csv", "model_equity"),
    ("conservador_overlay", "model_equity_final_20y_conservador.csv", "model_equity"),
    ("dinamico_overlay", "model_equity_final_20y_dinamico.csv", "model_equity"),
    ("theoretical_raw", "model_equity_theoretical_20y.csv", "model_equity"),
    ("overlay_default", "model_equity_final_20y.csv", "model_equity"),
    ("moderado_margin", "model_equity_final_20y_moderado_margin.csv", "model_equity"),
    ("dinamico_margin", "model_equity_final_20y_dinamico_margin.csv", "model_equity"),
    ("conservador_margin", "model_equity_final_20y_conservador_margin.csv", "model_equity"),
    ("margin_levered", "model_equity_final_20y_margin.csv", "model_equity"),
]

WINDOWS = ("full", "10y", "5y", "3y")


def _load_series(csv_path: Path, value_col: str) -> pd.Series:
    df = pd.read_csv(csv_path)
    tcol = str(df.columns[0])
    df[tcol] = pd.to_datetime(df[tcol], errors="coerce")
    df = df.dropna(subset=[tcol]).set_index(tcol).sort_index()
    s = pd.to_numeric(df[value_col], errors="coerce").dropna()
    return s[~s.index.duplicated(keep="last")]


def _tail_window(s: pd.Series, tag: str) -> pd.Series:
    if tag == "full":
        return s
    n = len(s)
    if tag == "10y":
        k = min(n, int(252 * 10))
    elif tag == "5y":
        k = min(n, int(252 * 5))
    elif tag == "3y":
        k = min(n, int(252 * 3))
    else:
        return s
    return s.iloc[-k:].copy()


def _flatten_row(
    curve_id: str,
    window: str,
    model_k: dict[str, float],
    bench_k: dict[str, float],
    rel_k: dict[str, float],
) -> dict[str, Any]:
    row: dict[str, Any] = {"curve_id": curve_id, "window": window}
    for k, v in model_k.items():
        row[f"model_{k}"] = v
    for k, v in bench_k.items():
        row[f"benchmark_{k}"] = v
    for k, v in rel_k.items():
        row[f"relative_{k}"] = v
    return row


def _collect_fieldnames(rows: list[dict[str, Any]]) -> list[str]:
    keys: set[str] = set()
    for r in rows:
        keys.update(r.keys())
    front = ["curve_id", "window"]
    rest = sorted(k for k in keys if k not in front)
    mk = [k for k in rest if k.startswith("model_")]
    bk = [k for k in rest if k.startswith("benchmark_")]
    rk = [k for k in rest if k.startswith("relative_")]
    other = [k for k in rest if k not in mk + bk + rk]
    return front + mk + bk + rk + other


def _structural_checks(
    freeze_dir: Path,
    bench: pd.Series,
    rows: list[dict[str, Any]],
    v5: dict[str, Any],
) -> list[dict[str, Any]]:
    """Lista de {id, ok, detail} para o relatório."""
    out: list[dict[str, Any]] = []

    def ok(i: str, b: bool, d: str) -> None:
        out.append({"id": i, "ok": bool(b), "detail": d})

    ok("freeze_dir_exists", freeze_dir.is_dir(), str(freeze_dir))
    ok("benchmark_csv", (freeze_dir / "benchmark_equity_final_20y.csv").is_file(), "benchmark_equity_final_20y.csv")
    ok("v5_kpis_json", (freeze_dir / "v5_kpis.json").is_file(), "v5_kpis.json")

    m_full = next((r for r in rows if r.get("curve_id") == "moderado_overlay" and r.get("window") == "full"), None)
    if m_full and v5:
        mc = float(m_full.get("model_cagr", float("nan")))
        vc = float(v5.get("overlayed_cagr", float("nan")))
        diff = abs(mc - vc) if np.isfinite(mc) and np.isfinite(vc) else float("nan")
        ok(
            "v5_overlayed_cagr_matches_moderado_csv",
            np.isfinite(diff) and diff < 0.02,
            f"csv_cagr={mc:.6f} v5_kpis.overlayed_cagr={vc:.6f} abs_diff={diff:.6f}",
        )

    # vol ordering full window
    def vol(cid: str) -> float:
        r = next((x for x in rows if x.get("curve_id") == cid and x.get("window") == "full"), None)
        return float(r["model_vol"]) if r and np.isfinite(float(r.get("model_vol", float("nan")))) else float("nan")

    v_cons, v_mod, v_dyn = vol("conservador_overlay"), vol("moderado_overlay"), vol("dinamico_overlay")
    # Conservador deve ser o mais «contido» vs moderado; dinâmico pode ter vol ≤ moderado
    # porque o motor escala para o alvo de vol vs benchmark (não é monótono em σ realizada).
    ok(
        "risk_conservador_vol_le_moderado",
        np.isfinite(v_cons) and np.isfinite(v_mod) and v_cons <= v_mod + 0.005,
        f"cons={v_cons:.4f} mod={v_mod:.4f} dyn={v_dyn:.4f}",
    )

    def volm(cid: str) -> float:
        r = next((x for x in rows if x.get("curve_id") == cid and x.get("window") == "full"), None)
        return float(r["model_vol"]) if r else float("nan")

    vm, vs = volm("moderado_margin"), volm("moderado_overlay")
    ok(
        "moderado_margin_vol_ge_overlay",
        np.isfinite(vm) and np.isfinite(vs) and vm >= vs - 1e-4,
        f"margin_vol={vm:.4f} overlay_vol={vs:.4f}",
    )

    ok("benchmark_strictly_positive", bool((bench > 0).all()), f"n={len(bench)} min={float(bench.min()):.6f}")

    ok("benchmark_index_monotone_dates", bool(bench.index.is_monotonic_increasing), "index sorted")

    return out


def main() -> int:
    ap = argparse.ArgumentParser(description="Bateria smooth (freeze V5 V2.3)")
    ap.add_argument("--freeze-dir", type=str, default="", help="Pasta model_outputs do freeze")
    ap.add_argument("--csv", type=str, default="", help="Escrever CSV com todas as colunas")
    ap.add_argument("--json-out", type=str, default="", help="JSON completo (rows + checks + v5_meta)")
    args = ap.parse_args()

    freeze = Path(args.freeze_dir).resolve() if args.freeze_dir.strip() else DEFAULT_FREEZE
    if not freeze.is_dir():
        print(f"ERRO: pasta freeze inexistente: {freeze}", file=sys.stderr)
        return 2

    bench_path = freeze / "benchmark_equity_final_20y.csv"
    if not bench_path.is_file():
        print(f"ERRO: falta {bench_path}", file=sys.stderr)
        return 2

    bench_full = _load_series(bench_path, "benchmark_equity")
    v5: dict[str, Any] = {}
    kp_path = freeze / "v5_kpis.json"
    if kp_path.is_file():
        v5 = json.loads(kp_path.read_text(encoding="utf-8"))

    rows_out: list[dict[str, Any]] = []
    missing: list[str] = []

    for curve_id, fname, col in SMOOTH_CURVES:
        p = freeze / fname
        if not p.is_file():
            missing.append(fname)
            continue
        try:
            model_full = _load_series(p, col)
        except Exception as e:  # noqa: BLE001
            missing.append(f"{fname} ({e})")
            continue
        common = model_full.index.intersection(bench_full.index)
        m0 = model_full.loc[common]
        b0 = bench_full.loc[common]
        if len(m0) < 200:
            missing.append(f"{fname} (poucos pontos comuns: {len(m0)})")
            continue

        for w in WINDOWS:
            m = _tail_window(m0, w)
            b = b0.loc[m.index]
            mk = _compute_kpis(m)
            bk = _compute_kpis(b)
            rk = _relative_kpis(m, b)
            rows_out.append(_flatten_row(curve_id, w, mk, bk, rk))

    print("=== DECIDE smooth model battery (freeze V5) ===", flush=True)
    print(f"freeze_dir: {freeze}", flush=True)
    if v5:
        print(
            "v5_kpis (resumo):",
            json.dumps(
                {
                    k: v5[k]
                    for k in (
                        "benchmark_cagr",
                        "overlayed_cagr",
                        "overlayed_sharpe",
                        "data_start",
                        "data_end",
                        "profile",
                        "n_obs",
                        "transaction_cost_bps",
                        "total_turnover_friction_bps",
                    )
                    if k in v5
                },
                indent=2,
                ensure_ascii=False,
            ),
            flush=True,
        )
    if missing:
        print("\nAVISO — ficheiros em falta ou inválidos:", flush=True)
        for m in missing:
            print(f"  - {m}", flush=True)

    # Tabela compacta
    hdr = ["curve_id", "window", "m_cagr", "b_cagr", "excess", "m_vol", "m_sharpe", "m_max_dd", "IR", "beta"]
    print("\n" + "  ".join(hdr), flush=True)
    print("  ".join(["-" * len(h) for h in hdr]), flush=True)
    for r in rows_out:
        okw = True
        try:
            mc = float(r["model_cagr"])
            bc = float(r["benchmark_cagr"])
            ex = mc - bc
            ir = float(r["relative_information_ratio"])
            be = float(r["relative_beta_vs_benchmark"])
        except Exception:
            okw = False
        if not okw:
            continue
        print(
            "  ".join(
                [
                    str(r["curve_id"])[:18].ljust(18),
                    str(r["window"]).ljust(5),
                    f"{mc*100:6.2f}",
                    f"{bc*100:6.2f}",
                    f"{ex*100:6.2f}",
                    f"{float(r['model_vol'])*100:5.1f}%",
                    f"{float(r['model_sharpe']):5.2f}",
                    f"{float(r['model_max_drawdown'])*100:6.1f}%",
                    f"{ir:5.2f}",
                    f"{be:5.2f}",
                ]
            ),
            flush=True,
        )

    checks = _structural_checks(freeze, bench_full, rows_out, v5)
    print("\n=== Checagens ===", flush=True)
    for c in checks:
        sym = "OK" if c["ok"] else "FALHOU"
        print(f"  [{sym}] {c['id']}: {c['detail']}", flush=True)

    conclusions: list[str] = []
    if all(c["ok"] for c in checks):
        conclusions.append("Todas as checagens estruturais e de consistência com v5_kpis passaram.")
    else:
        conclusions.append("Existem checagens falhadas — rever detalhes acima antes de usar números em produção.")

    m5 = next((r for r in rows_out if r["curve_id"] == "moderado_overlay" and r["window"] == "5y"), None)
    mfull = next((r for r in rows_out if r["curve_id"] == "moderado_overlay" and r["window"] == "full"), None)
    if m5 and mfull:
        conclusions.append(
            f"Moderado overlay: CAGR cai de {float(mfull['model_cagr'])*100:.1f}% (full) para "
            f"{float(m5['model_cagr'])*100:.1f}% (últimos ~5y) — esperado por variar o período de avaliação."
        )
    th = next((r for r in rows_out if r["curve_id"] == "theoretical_raw" and r["window"] == "full"), None)
    mo = next((r for r in rows_out if r["curve_id"] == "moderado_overlay" and r["window"] == "full"), None)
    if th and mo:
        conclusions.append(
            f"Curva teórica (raw) vs overlay moderado: CAGR {float(th['model_cagr'])*100:.1f}% vs "
            f"{float(mo['model_cagr'])*100:.1f}% — o produto smooth (custos, rebalance, overlay) altera o risco-retorno."
        )

    print("\n=== Conclusões ===", flush=True)
    for line in conclusions:
        print(f"- {line}", flush=True)

    payload = {
        "freeze_dir": str(freeze),
        "v5_kpis_head": {k: v5[k] for k in list(v5.keys())[:25]} if v5 else {},
        "rows": rows_out,
        "checks": checks,
        "conclusions": conclusions,
        "missing_files": missing,
    }

    if args.csv:
        outp = Path(args.csv)
        outp.parent.mkdir(parents=True, exist_ok=True)
        fn = _collect_fieldnames(rows_out)
        with outp.open("w", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=fn, extrasaction="ignore")
            w.writeheader()
            for r in rows_out:
                w.writerow({k: r.get(k, "") for k in fn})
        print(f"\nCSV: {outp}", flush=True)

    if args.json_out:
        p = Path(args.json_out)
        p.parent.mkdir(parents=True, exist_ok=True)
        # JSON não pode ter nan — converter
        def sanitize(x: Any) -> Any:
            if isinstance(x, float) and (np.isnan(x) or np.isinf(x)):
                return None
            if isinstance(x, dict):
                return {k: sanitize(v) for k, v in x.items()}
            if isinstance(x, list):
                return [sanitize(v) for v in x]
            return x

        p.write_text(json.dumps(sanitize(payload), indent=2, ensure_ascii=False), encoding="utf-8")
        print(f"JSON: {p}", flush=True)

    return 0 if rows_out and all(c["ok"] for c in checks) else 1


if __name__ == "__main__":
    raise SystemExit(main())
