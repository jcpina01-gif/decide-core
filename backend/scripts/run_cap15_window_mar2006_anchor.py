#!/usr/bin/env python3
"""
Recalcula o CAP15 (``run_research_v1`` com ``cap_per_ticker=0.15``) nos preços actuais
com janela ancorada em **20 anos civis antes de 2026-03-19** → ``start_date=2006-03-19``,
até ao fim do CSV (inclui todos os dias úteis **após** 2026-03-19 até ``data_end``).

Uso (na raiz do decide-core)::

  python backend/scripts/run_cap15_window_mar2006_anchor.py
  python backend/scripts/run_cap15_window_mar2006_anchor.py --prices backend/data/prices_close.csv
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
BACKEND_DIR = REPO_ROOT / "backend"
DEFAULT_PRICES = BACKEND_DIR / "data" / "prices_close.csv"
# 20 anos civis antes de 2026-03-19 (pedido: «20y mais os dias desde 19/3»)
START_ANCHOR = "2006-03-19"
REF_MAR = "2026-03-19"


def _resolve_engine_backend() -> Path:
    env = (os.environ.get("DECIDE_V5_ENGINE_ROOT") or "").strip()
    cand = Path(env) if env else (REPO_ROOT.parent / "DECIDE_CORE22_CLONE" / "backend")
    eng = cand.resolve()
    if not (eng / "engine_research_v5.py").is_file():
        print("ERRO: não encontrei engine_research_v5.py em", eng, file=sys.stderr)
        raise SystemExit(1)
    return eng


def main() -> int:
    ap = argparse.ArgumentParser(description="V5 CAP15 com janela desde 2006-03-19 (âncora 20y + pós 19/3/2026)")
    ap.add_argument("--prices", type=str, default=str(DEFAULT_PRICES))
    ap.add_argument("--start", type=str, default=START_ANCHOR, help="Data início (YYYY-MM-DD)")
    ap.add_argument("--end", type=str, default="", help="Data fim opcional (YYYY-MM-DD); omissão = fim do CSV")
    args = ap.parse_args()
    prices_path = Path(args.prices.strip()).resolve()
    if not prices_path.is_file():
        print("Falta ficheiro de preços:", prices_path, file=sys.stderr)
        return 1

    eng = _resolve_engine_backend()
    if str(eng) not in sys.path:
        sys.path.insert(0, str(eng))
    from engine_research_v5 import run_research_v1  # noqa: E402

    end_kw: str | None = args.end.strip() or None

    print("Preços:", prices_path)
    print("Janela motor: start_date=", args.start, " end_date=", end_kw or "(última data do CSV)")
    print("Referencia: 20 anos civis antes de", REF_MAR, "=> inicio", START_ANCHOR)
    print()

    profiles = ("moderado", "dinamico", "conservador")
    for pk in profiles:
        r = run_research_v1(
            prices_path=str(prices_path),
            profile=pk,
            cap_per_ticker=0.15,
            start_date=args.start,
            end_date=end_kw,
        )
        s = r["summary"]
        print(f"--- Perfil: {pk} ---")
        print(f"  data_start={s.get('data_start')}  data_end={s.get('data_end')}  n_obs={s.get('n_obs')}")
        print(f"  benchmark_cagr={float(s['benchmark_cagr'])*100:.4f}%")
        print(f"  raw_cagr={float(s['raw_cagr'])*100:.4f}%")
        print(f"  overlay_pre_vol_cagr={float(s['overlay_pre_vol_cagr'])*100:.4f}%")
        print(f"  overlayed_cagr={float(s['overlayed_cagr'])*100:.4f}%")
        print()

    # Uma linha de comparação: mesmo ficheiro sem recorte de início (moderado)
    r0 = run_research_v1(prices_path=str(prices_path), profile="moderado", cap_per_ticker=0.15)
    s0 = r0["summary"]
    r1 = run_research_v1(
        prices_path=str(prices_path),
        profile="moderado",
        cap_per_ticker=0.15,
        start_date=args.start,
        end_date=end_kw,
    )
    s1 = r1["summary"]
    print("--- Comparativo moderado: sem start_date vs com start_date ---")
    print(f"  sem recorte: n_obs={s0.get('n_obs')}  overlayed_cagr={float(s0['overlayed_cagr'])*100:.4f}%")
    print(f"  com recorte: n_obs={s1.get('n_obs')}  overlayed_cagr={float(s1['overlayed_cagr'])*100:.4f}%")
    d = float(s1["overlayed_cagr"]) - float(s0["overlayed_cagr"])
    print(f"  delta overlayed_cagr (recorte - full): {d*100:+.4f} pontos percentuais")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
