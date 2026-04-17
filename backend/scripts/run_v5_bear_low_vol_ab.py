#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
A/B: motor V5 completo **baseline** vs **bear + baixa vol → reduzir exposição**.

A regra vive em ``engine_research_v5`` (clone / ``DECIDE_V5_ENGINE_ROOT``):
multiplica o stack de exposição (breadth × trend × …) por ``bear_low_vol_exposure_mult``
nos dias em que o benchmark está em RISK_OFF (preço < MA200) **e** a vol realizada do
benchmark (janela configurável) está abaixo da mediana expansiva passada.

Uso (PowerShell), a partir de ``decide-core/backend``::

    $env:DECIDE_V5_ENGINE_ROOT = "C:\\Users\\Joaquim\\Documents\\DECIDE_CORE22_CLONE\\backend"
    python scripts/run_v5_bear_low_vol_ab.py
    python scripts/run_v5_bear_low_vol_ab.py --profile moderado --mult 0.80 --json-out ..\\tmp_ab_bear_low_vol.json
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

_BACKEND = Path(__file__).resolve().parent.parent
_REPO = _BACKEND.parent


def _resolve_v5_backend() -> Path:
    env = (os.environ.get("DECIDE_V5_ENGINE_ROOT") or "").strip()
    if env:
        p = Path(env).resolve()
        if (p / "engine_research_v5.py").is_file():
            return p
    cand = _REPO.parent / "DECIDE_CORE22_CLONE" / "backend"
    if (cand / "engine_research_v5.py").is_file():
        return cand.resolve()
    raise FileNotFoundError(
        "Não encontrei engine_research_v5.py. Define DECIDE_V5_ENGINE_ROOT para a pasta "
        "backend do clone (ex.: .../DECIDE_CORE22_CLONE/backend)."
    )


def main() -> int:
    ap = argparse.ArgumentParser(description="A/B V5: overlay bear+baixa vol")
    ap.add_argument("--prices", type=str, default="", help="CSV preços (default: decide-core backend/data/prices_close.csv)")
    ap.add_argument("--profile", type=str, default="moderado")
    ap.add_argument("--cap-per-ticker", type=float, default=0.15)
    ap.add_argument("--mult", type=float, default=0.85, help="Exposição relativa quando a regra está activa")
    ap.add_argument("--vol-window", type=int, default=63, help="Dias úteis para vol realizada do benchmark")
    ap.add_argument("--json-out", type=str, default="", help="Escrever JSON com resumos baseline vs variant")
    args = ap.parse_args()

    v5_backend = _resolve_v5_backend()
    if str(v5_backend) not in sys.path:
        sys.path.insert(0, str(v5_backend))

    from engine_research_v5 import run_research_v1  # noqa: E402

    prices_path = Path(args.prices).resolve() if str(args.prices).strip() else _BACKEND / "data" / "prices_close.csv"
    if not prices_path.is_file():
        print(f"ERRO: não encontrei preços: {prices_path}", file=sys.stderr)
        return 2

    common_kw = dict(
        prices_path=str(prices_path),
        profile=str(args.profile),
        cap_per_ticker=float(args.cap_per_ticker),
    )

    # Baseline = motor **sem** este overlay (legado). Variante = com overlay (por defeito igual ao modelo actual).
    base = run_research_v1(**common_kw, bear_low_vol_overlay_enabled=False)
    variant = run_research_v1(
        **common_kw,
        bear_low_vol_overlay_enabled=True,
        bear_low_vol_bench_vol_window=int(args.vol_window),
        bear_low_vol_exposure_mult=float(args.mult),
    )

    sb = base.get("summary") or {}
    sv = variant.get("summary") or {}

    def pick(d: dict) -> dict:
        keys = (
            "overlayed_cagr",
            "overlayed_sharpe",
            "benchmark_cagr",
            "avg_trend_exposure",
            "avg_cash_sleeve",
            "bear_low_vol_overlay_enabled",
            "avg_bear_low_vol_exposure",
            "pct_days_bear_low_vol_active",
        )
        return {k: d.get(k) for k in keys}

    out = {
        "v5_engine_root": str(v5_backend),
        "prices_path": str(prices_path),
        "profile": args.profile,
        "variant_params": {
            "bear_low_vol_overlay_enabled": True,
            "bear_low_vol_bench_vol_window": int(args.vol_window),
            "bear_low_vol_exposure_mult": float(args.mult),
        },
        "baseline_summary": pick(sb),
        "variant_summary": pick(sv),
        "delta_overlayed_cagr": (float(sv.get("overlayed_cagr") or 0) - float(sb.get("overlayed_cagr") or 0))
        if sb.get("overlayed_cagr") is not None and sv.get("overlayed_cagr") is not None
        else None,
    }

    txt = json.dumps(out, ensure_ascii=False, indent=2)
    if str(args.json_out).strip():
        outp = Path(args.json_out).resolve()
        outp.parent.mkdir(parents=True, exist_ok=True)
        outp.write_text(txt, encoding="utf-8")
        print(txt)
        print(f"-> {outp}", file=sys.stderr)
    else:
        print(txt)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
