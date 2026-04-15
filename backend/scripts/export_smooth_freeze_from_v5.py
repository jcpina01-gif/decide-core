#!/usr/bin/env python3
"""
Exporta o freeze smooth ``DECIDE_MODEL_V5_V2_3_SMOOTH/model_outputs`` com o **motor V5 real**
(``engine_research_v5.run_research_v1`` e cap 15%), **sem** ``engine_v2`` e **sem** multiplicadores
artificiais sobre a curva plafonada.

Mapeamento (alinhado ao código em ``engine_research_v5.py``):

- ``model_equity_final_20y[_perfil].csv`` e ``model_equity_final_20y.csv`` → **``equity_overlayed``**
  (CAP15 investível neste script: **sem** ``max_effective_exposure`` por omissão — alinhado ao histórico do hero).
- ``model_equity_theoretical_20y.csv`` → **``equity_raw``** (perfil **moderado**): motor com custos,
  **antes** da pilha breadth/trend/vol-overlay do CAP15.
- ``model_equity_final_20y_*_margin.csv`` / ``model_equity_final_20y_margin.csv`` → **``equity_overlay_margin``**:
  mesmo pipeline CAP15 + custos que ``equity_overlayed``, **sempre** antes de um eventual teto
  ``max_effective_exposure``; quando o teto não se aplica, coincide numericamente com ``equity_overlayed``.

Requisitos
-----------

- ``DECIDE_V5_ENGINE_ROOT`` = pasta ``.../backend`` onde existe ``engine_research_v5.py``, **ou**
  repositório ``DECIDE_CORE22_CLONE`` ao lado de ``decide-core`` (caminho por omissão).

- O clone deve incluir ``equity_overlay_margin`` no dict devolvido por ``run_research_v1``. Se faltar,
  tenta ``equity_overlay_pre_vol`` (legado) e por fim ``equity_raw_volmatched``, com aviso em stderr.

Uso (na raiz do ``decide-core``)::

  python backend/scripts/export_smooth_freeze_from_v5.py
  python backend/scripts/export_smooth_freeze_from_v5.py --prices backend/data/prices_close.csv
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

import pandas as pd

REPO_ROOT = Path(__file__).resolve().parents[2]
BACKEND_DIR = REPO_ROOT / "backend"
FREEZE_OUT = REPO_ROOT / "freeze" / "DECIDE_MODEL_V5_V2_3_SMOOTH" / "model_outputs"
FREEZE_CLONE = FREEZE_OUT.parent / "model_outputs_from_clone"
DEFAULT_PRICES = BACKEND_DIR / "data" / "prices_close.csv"


def _resolve_engine_backend() -> Path:
    env = (os.environ.get("DECIDE_V5_ENGINE_ROOT") or "").strip()
    cand = Path(env) if env else (REPO_ROOT.parent / "DECIDE_CORE22_CLONE" / "backend")
    eng = cand.resolve()
    if not (eng / "engine_research_v5.py").is_file():
        print(
            "ERRO: não encontrei engine_research_v5.py em",
            eng,
            file=sys.stderr,
        )
        print("      Define DECIDE_V5_ENGINE_ROOT ou coloca DECIDE_CORE22_CLONE ao lado do decide-core.", file=sys.stderr)
        raise SystemExit(1)
    return eng


def _fmt_equity_date(raw: str) -> str:
    ts = pd.to_datetime(raw, errors="coerce")
    if pd.isna(ts):
        return str(raw).strip()
    return ts.strftime("%Y-%m-%d %H:%M:%S")


def _fmt_cash_date(raw: str) -> str:
    ts = pd.to_datetime(raw, errors="coerce")
    if pd.isna(ts):
        return str(raw).strip()[:10]
    return ts.strftime("%Y-%m-%d")


def _write_equity_csv(path: Path, dates: list[str], nav: list[float]) -> None:
    rows = [_fmt_equity_date(d) for d in dates]
    pd.DataFrame({"date": rows, "model_equity": [float(x) for x in nav]}).to_csv(path, index=False)


def _margin_series_from_result(r: dict[str, object]) -> list[float]:
    if "equity_overlay_margin" in r and isinstance(r["equity_overlay_margin"], list):
        return [float(x) for x in r["equity_overlay_margin"]]  # type: ignore[arg-type]
    if "equity_overlay_pre_vol" in r and isinstance(r["equity_overlay_pre_vol"], list):
        print(
            "[export_smooth_freeze_from_v5] AVISO: sem equity_overlay_margin — a usar equity_overlay_pre_vol (legado).",
            file=sys.stderr,
        )
        return [float(x) for x in r["equity_overlay_pre_vol"]]  # type: ignore[arg-type]
    print(
        "[export_smooth_freeze_from_v5] AVISO: sem série de margem — fallback: equity_raw_volmatched.",
        file=sys.stderr,
    )
    return [float(x) for x in r["equity_raw_volmatched"]]  # type: ignore[index]


def main() -> int:
    ap = argparse.ArgumentParser(description="Export smooth freeze CSVs via engine_research_v5 (sem engine_v2)")
    ap.add_argument(
        "--prices",
        type=str,
        default=str(DEFAULT_PRICES),
        help="Caminho para prices_close.csv (default: backend/data/prices_close.csv no decide-core)",
    )
    ap.add_argument(
        "--engine-root",
        type=str,
        default="",
        help="Pasta backend do clone (default: env DECIDE_V5_ENGINE_ROOT ou ../DECIDE_CORE22_CLONE/backend)",
    )
    args = ap.parse_args()

    prices_path = Path(args.prices.strip()).resolve()
    if not prices_path.is_file():
        print("Falta ficheiro de preços:", prices_path, file=sys.stderr)
        return 1

    eng = Path(args.engine_root.strip()).resolve() if args.engine_root.strip() else _resolve_engine_backend()
    if str(eng) not in sys.path:
        sys.path.insert(0, str(eng))

    from engine_research_v5 import run_research_v1  # noqa: E402

    FREEZE_OUT.mkdir(parents=True, exist_ok=True)
    FREEZE_CLONE.mkdir(parents=True, exist_ok=True)

    data_weights = BACKEND_DIR / "data" / "weights_by_rebalance.csv"
    data_cash = BACKEND_DIR / "data" / "cash_sleeve_daily.csv"
    v5_json = FREEZE_OUT / "v5_kpis.json"

    profiles = ("conservador", "dinamico", "moderado")
    last_benchmark: list[float] | None = None
    last_dates: list[str] | None = None

    for pk in profiles:
        # Omissão de `max_effective_exposure`: alinha o CSV principal ao CAP15 histórico (hero). Para export
        # explícito com teto NAV 100% na perna arriscada, chama `run_research_v1(..., max_effective_exposure=1.0)`.
        kwargs: dict = {
            "prices_path": str(prices_path),
            "profile": pk,
            "cap_per_ticker": 0.15,
        }
        if pk == "moderado":
            kwargs["emit_weights_csv"] = str(data_weights)
            kwargs["emit_cash_sleeve_daily_csv"] = str(data_cash)
            kwargs["emit_v5_kpis_json"] = str(v5_json)

        r = run_research_v1(**kwargs)
        dates = [str(x) for x in r["dates"]]  # type: ignore[index]
        ov = [float(x) for x in r["equity_overlayed"]]  # type: ignore[index]
        margin_nav = _margin_series_from_result(r)

        _write_equity_csv(FREEZE_OUT / f"model_equity_final_20y_{pk}.csv", dates, ov)
        _write_equity_csv(
            FREEZE_OUT / f"model_equity_final_20y_{pk}_margin.csv",
            dates,
            margin_nav,
        )

        last_benchmark = [float(x) for x in r["benchmark_equity"]]  # type: ignore[index]
        last_dates = dates

        if pk == "moderado":
            raw_nav = [float(x) for x in r["equity_raw"]]  # type: ignore[index]
            _write_equity_csv(FREEZE_OUT / "model_equity_final_20y.csv", dates, ov)
            _write_equity_csv(FREEZE_OUT / "model_equity_final_20y_margin.csv", dates, margin_nav)
            _write_equity_csv(FREEZE_OUT / "model_equity_theoretical_20y.csv", dates, raw_nav)
            cash = [float(x) for x in r["cash_sleeve_daily"]]  # type: ignore[index]
            pd.DataFrame(
                {"date": [_fmt_cash_date(d) for d in dates], "cash_sleeve": cash},
            ).to_csv(FREEZE_OUT / "cash_sleeve_daily.csv", index=False)

    assert last_benchmark is not None and last_dates is not None
    bench_df = pd.DataFrame(
        {"date": [_fmt_equity_date(d) for d in last_dates], "benchmark_equity": last_benchmark},
    )
    bench_df.to_csv(FREEZE_OUT / "benchmark_equity_final_20y.csv", index=False)
    bench_df.to_csv(FREEZE_CLONE / "benchmark_equity_final_20y.csv", index=False)

    print("OK — freeze smooth V5 em", FREEZE_OUT)
    print("     v5_kpis:", v5_json)
    print("     weights/cash (moderado):", data_weights, "|", data_cash)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
