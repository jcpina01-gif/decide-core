#!/usr/bin/env python3
"""
Exporta o freeze smooth ``DECIDE_MODEL_V5_V2_3_SMOOTH/model_outputs`` com o **motor V5 real**
(``engine_research_v5.run_research_v1`` e cap 15%), **sem** ``engine_v2`` e **sem** multiplicadores
artificiais sobre a curva plafonada.

Mapeamento (alinhado ao código em ``engine_research_v5.py``):

- ``model_equity_final_20y[_perfil].csv`` e ``model_equity_final_20y.csv`` → **``equity_overlayed``**
  com ``max_effective_exposure=1.0`` (teto **≤100% NAV** na perna arriscada vs caixa/T-Bill; mesmo custos).
- ``model_equity_theoretical_20y.csv`` → **``equity_raw``** (perfil **moderado**): motor com custos,
  **antes** da pilha breadth/trend/vol-overlay do CAP15.
- ``weights_by_rebalance.csv`` → o motor grava em ``backend/data/``; este script **copia** o ficheiro
  para ``freeze/DECIDE_MODEL_V5_V2_3_SMOOTH/model_outputs/`` para alinhar com o merge do relatório.
- ``model_equity_final_20y_*_margin.csv`` / ``model_equity_final_20y_margin.csv`` → **``equity_overlay_margin``**:
  mesma corrida do motor, **sem** esse teto — exposição efectiva pode exceder 100%; CAGR/vol podem
  diferir do plafonado quando o teto encaixa.

Overlay **bear + baixa vol** (smooth): por defeito **histerese** entrada/saída em quantis expansivos
**p40 / p65**, **N = 10** dias seguidos na condição de saída em vol (ver ``ResearchConfig`` no motor).
Use ``--no-bear-low-vol`` para export sem esta regra.

**Momentum (produto smooth):** por defeito ``momentum_mode=v2_prudent`` (**126d/252d** em 50/50, sem 63d).
``v2_smooth`` usa **63/126/252d** em 40/35/25. Use ``--momentum-mode default`` (ou ``v2_smooth``) para variantes.

Requisitos
-----------

- ``DECIDE_V5_ENGINE_ROOT`` = pasta ``.../backend`` onde existe ``engine_research_v5.py``, **ou**
  repositório ``DECIDE_CORE22_CLONE`` ao lado de ``decide-core`` (caminho por omissão).

- O clone deve incluir ``equity_overlay_margin`` no dict devolvido por ``run_research_v1``. Se faltar,
  tenta ``equity_overlay_pre_vol`` (legado) e por fim ``equity_raw_volmatched``, com aviso em stderr.

Fricção (auditável, omissão = canónica **5+5+0**): ``--transaction-cost-bps``,
``--slippage-bps``, ``--fx-conversion-bps`` passam a ``run_research_v1`` e reflectem-se em
``v5_kpis.json`` (e no merge ``export_friction_bps``).

Uso (na raiz do ``decide-core``)::

  python backend/scripts/export_smooth_freeze_from_v5.py
  python backend/scripts/export_smooth_freeze_from_v5.py --prices backend/data/prices_close.csv
  python backend/scripts/export_smooth_freeze_from_v5.py --transaction-cost-bps 5 --slippage-bps 5 --fx-conversion-bps 0
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
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
    ap.add_argument(
        "--no-bear-low-vol",
        action="store_true",
        help="Desliga o overlay bear+baixa vol no motor V5 (export legado sem essa regra).",
    )
    ap.add_argument(
        "--momentum-mode",
        type=str,
        default="v2_prudent",
        help='Motor momentum_mode (default: v2_prudent). Ex.: "default", "v2_smooth".',
    )
    ap.add_argument(
        "--transaction-cost-bps",
        type=float,
        default=5.0,
        help="Fricção explícita (alinhado ResearchConfig): transaction_cost_bps (default: 5).",
    )
    ap.add_argument(
        "--slippage-bps",
        type=float,
        default=5.0,
        help="Fricção explícita: slippage_bps (default: 5).",
    )
    ap.add_argument(
        "--fx-conversion-bps",
        type=float,
        default=0.0,
        help="Fricção explícita: fx_conversion_bps (default: 0).",
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
        kwargs: dict = {
            "prices_path": str(prices_path),
            "profile": pk,
            "cap_per_ticker": 0.15,
            # Uma corrida: plafonado = `equity_overlayed` (teto 100% NAV); margem = `equity_overlay_margin` (sem teto).
            "max_effective_exposure": 1.0,
            "momentum_mode": str(args.momentum_mode).strip().lower(),
            "transaction_cost_bps": float(args.transaction_cost_bps),
            "slippage_bps": float(args.slippage_bps),
            "fx_conversion_bps": float(args.fx_conversion_bps),
        }
        if bool(getattr(args, "no_bear_low_vol", False)):
            kwargs["bear_low_vol_overlay_enabled"] = False
        else:
            kwargs["bear_low_vol_hysteresis"] = True
            kwargs["bear_low_vol_tiered"] = False
            kwargs["bear_low_vol_hysteresis_entry_quantile"] = 0.40
            kwargs["bear_low_vol_hysteresis_exit_quantile"] = 0.65
            kwargs["bear_low_vol_hysteresis_exit_consecutive_days"] = 10
            kwargs["bear_low_vol_hysteresis_bear_ma_window"] = 252
            kwargs["bear_low_vol_quantile_min_periods"] = 252
            kwargs["bear_low_vol_bench_vol_window"] = 63
            kwargs["bear_low_vol_exposure_mult"] = 0.85
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

    if v5_json.is_file():
        meta = json.loads(v5_json.read_text(encoding="utf-8"))
        meta["curve_engine"] = "engine_research_v5"
        meta["curve_engine_script"] = "export_smooth_freeze_from_v5.py"
        meta["prices_input"] = str(prices_path.resolve())
        meta["smooth_export_momentum_mode"] = str(args.momentum_mode).strip().lower()
        meta["smooth_export_overlay_vol_moderado"] = True
        tcb, sb, fxb = float(args.transaction_cost_bps), float(args.slippage_bps), float(args.fx_conversion_bps)
        meta["export_transaction_cost_bps"] = tcb
        meta["export_slippage_bps"] = sb
        meta["export_fx_conversion_bps"] = fxb

        def _fmt_bps(x: float) -> str:
            return str(int(x)) if float(x) == int(x) else str(x)

        meta["export_friction_bps"] = f"{_fmt_bps(tcb)}+{_fmt_bps(sb)}+{_fmt_bps(fxb)}"
        v5_json.write_text(json.dumps(meta, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    # O merge oficial (Next) lê primeiro ``freeze/.../weights_by_rebalance.csv``; o motor só
    # escrevia em ``backend/data/``. Copiar evita CSV antigo no freeze com curvas novas.
    if data_weights.is_file():
        shutil.copy2(data_weights, FREEZE_OUT / "weights_by_rebalance.csv")

    print("OK: freeze smooth V5 em", FREEZE_OUT)
    print("     v5_kpis:", v5_json)
    print("     weights/cash (moderado):", data_weights, "|", data_cash)
    print("     weights (cópia para freeze):", FREEZE_OUT / "weights_by_rebalance.csv")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
