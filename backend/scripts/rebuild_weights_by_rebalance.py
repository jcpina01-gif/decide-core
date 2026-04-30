#!/usr/bin/env python3
"""
Regenera `backend/data/weights_by_rebalance.csv` para o historico de decisoes.

**O que e o V5 CAP15?** Os retornos que apresentas (curva em model_equity_final_20y,
overlay, caixa, etc.) vêm de um **backtest completo** que **nao esta** neste repo como
um unico `import` — o codigo que o corre gera, entre outros, `weights_by_rebalance.csv`
em `freeze/.../model_outputs/`. **Esse CSV e a unica forma de ter pesos por activo
identicos ao V5** sem esse pipeline.

**Modo auto (defeito):**
  1. Se existir export oficial do V5 (CAP15 / clone / env), **copia** para backend/data/
  2. Caso contrario, calcula com **engine_v2** (momentum+score+cap em prices_close) —
     **os retornos nao batem** com a curva CAP15; e fallback documentado.

**Modo v5:** corre `engine_research_v5.run_research_v1_cap15` no clone (DECIDE_V5_ENGINE_ROOT
  ou ../DECIDE_CORE22_CLONE/backend) e grava weights + cash_sleeve_daily + v5_kpis em backend/data/.
  Isto **e** o pipeline completo V5 CAP15 (nao e engine_v2).

**Modo freeze:** falha se nao houver ficheiro V5.

**Modo v2:** ignora o freeze; so engine_v2.

Uso:
  python backend/scripts/rebuild_weights_by_rebalance.py
  python backend/scripts/rebuild_weights_by_rebalance.py --mode v5
  python backend/scripts/rebuild_weights_by_rebalance.py --mode v5 --prices C:\\path\\prices_close.csv
  python backend/scripts/rebuild_weights_by_rebalance.py --mode v2
  python backend/scripts/rebuild_weights_by_rebalance.py --mode freeze
  DECIDE_V5_WEIGHTS_SRC=C:\\path\\weights_by_rebalance.csv python ...
  DECIDE_PRICES_CLOSE=C:\\path\\prices_close.csv python ... --mode v2
"""
from __future__ import annotations

import argparse
import csv
import os
import shutil
import subprocess
import sys
from pathlib import Path

import numpy as np
import pandas as pd

REPO_ROOT = Path(__file__).resolve().parents[2]
_backend_dir = REPO_ROOT / "backend"
if str(_backend_dir) not in sys.path:
    sys.path.insert(0, str(_backend_dir))

from engine_v2_rebalance import compute_selection_engine_v2


def _freeze_dirs_ordered() -> list[Path]:
    """Ordem alinhada a kpi_server.resolve_decide_clone_freeze_dir / freeze local."""
    out: list[Path] = []
    env = (os.environ.get("DECIDE_KPI_CLONE_ROOT") or "").strip()
    if env:
        p = Path(env)
        out.append(p / "freeze" if (p / "freeze").is_dir() else p)
    out.append(REPO_ROOT.parent / "DECIDE_CORE22_CLONE" / "freeze")
    out.append(REPO_ROOT / "freeze")
    seen: set[Path] = set()
    res: list[Path] = []
    for fz in out:
        try:
            r = fz.resolve()
        except Exception:
            r = fz
        if r in seen or not r.is_dir():
            continue
        seen.add(r)
        res.append(r)
    return res


def _unique_rebalance_months_in_csv(path: Path) -> int:
    """Número de datas de rebalance distintas (prefixo YYYY-MM-DD)."""
    try:
        text = path.read_text(encoding="utf-8", errors="ignore")
    except Exception:
        return 0
    rows = list(csv.reader(text.splitlines()))
    if len(rows) < 2:
        return 0
    head = [str(h).strip().lower() for h in rows[0]]
    date_aliases = ("rebalance_date", "date", "as_of")
    di = -1
    for a in date_aliases:
        if a in head:
            di = head.index(a)
            break
    if di < 0:
        return 0
    seen: set[str] = set()
    for r in rows[1:]:
        if di >= len(r):
            continue
        raw = str(r[di]).strip()
        if not raw:
            continue
        d = raw.split("T")[0][:10]
        if len(d) >= 10:
            seen.add(d[:10])
    return len(seen)


def resolve_v5_weights_csv() -> Path | None:
    """
    Export oficial do motor V5 overlay CAP15 (ou MAX100 como fallback de pesos).
    """
    env_src = (os.environ.get("DECIDE_V5_WEIGHTS_SRC") or "").strip()
    if env_src:
        p = Path(env_src)
        if p.is_file() and p.stat().st_size > 50:
            return p

    rels = [
        "DECIDE_MODEL_V5_OVERLAY_CAP15/model_outputs/weights_by_rebalance.csv",
        "DECIDE_MODEL_V5_OVERLAY_CAP15/model_outputs_from_clone/weights_by_rebalance.csv",
        "DECIDE_MODEL_V5_OVERLAY_CAP15_MAX100EXP/model_outputs/weights_by_rebalance.csv",
        "DECIDE_MODEL_V5_OVERLAY_CAP15_MAX100EXP/model_outputs_from_clone/weights_by_rebalance.csv",
    ]
    for fz in _freeze_dirs_ordered():
        for rel in rels:
            p = fz / rel
            if p.is_file() and p.stat().st_size > 50:
                return p
    return None


def _find_prices_path(explicit: str | None = None) -> Path | None:
    if explicit:
        p = Path(explicit).expanduser()
        if p.is_file() and p.stat().st_size > 100:
            return p.resolve()
    envp = (os.environ.get("DECIDE_PRICES_CLOSE") or "").strip()
    if envp:
        p = Path(envp).expanduser()
        if p.is_file() and p.stat().st_size > 100:
            return p.resolve()
    for rel in (
        "backend/prices_close.csv",
        "backend/data/prices_close.csv",
    ):
        p = REPO_ROOT / rel
        if p.exists() and p.stat().st_size > 100:
            return p
    return None


def _month_end_dates(idx: pd.DatetimeIndex) -> list[pd.Timestamp]:
    """Último dia de pregão de cada mês civil no índice (não é o dia 31 se não houver cotação)."""
    if len(idx) == 0:
        return []
    s = pd.Series(np.arange(len(idx)), index=idx)
    out: list[pd.Timestamp] = []
    for (_, _), grp in s.groupby([idx.year, idx.month]):
        last = grp.index.max()
        out.append(pd.Timestamp(last))
    return sorted(set(out))


def _run_engine_v2(args: argparse.Namespace, out_path: Path) -> int:
    ex = (getattr(args, "prices", None) or "").strip() or None
    prices_path = _find_prices_path(ex)
    if prices_path is None:
        print("ERRO: nao encontrei backend/prices_close.csv nem backend/data/prices_close.csv")
        return 1

    df = pd.read_csv(prices_path, parse_dates=["date"], low_memory=False)
    if "date" not in df.columns:
        print("ERRO: prices_close precisa de coluna 'date'")
        return 1
    df = df.sort_values("date").drop_duplicates(subset=["date"], keep="last")
    df = df.set_index("date")

    tickers = [c for c in df.columns if str(c).strip().lower() not in {"date"}]
    px = df[tickers].apply(pd.to_numeric, errors="coerce")
    px = px.sort_index()
    px = px.ffill()
    px = px.dropna(how="all")

    idx = pd.DatetimeIndex(pd.to_datetime(px.index).normalize())
    px.index = idx

    rebal_dates = _month_end_dates(idx)
    rows_out: list[tuple[str, str, float, float]] = []

    for rebal in rebal_dates:
        pos = int(idx.searchsorted(rebal, side="right") - 1)
        if pos < 2:
            continue
        sub = px.iloc[: pos + 1].copy()
        sel = compute_selection_engine_v2(
            sub,
            lookback=int(args.lookback),
            top_q=int(args.top_q),
            cap_per_ticker=float(args.cap),
            benchmark=str(args.benchmark),
        )
        if not sel:
            continue
        dstr = str(idx[pos])[:10]
        for row in sel:
            tkr = str(row["ticker"])
            w = float(row["weight"])
            sc = float(row["score"])
            rows_out.append((dstr, tkr, w, sc))

    if not rows_out:
        print("ERRO: sem linhas geradas — verifica precos e parametros.")
        return 1

    out_path.parent.mkdir(parents=True, exist_ok=True)
    with out_path.open("w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow(["rebalance_date", "ticker", "weight", "score"])
        for row in rows_out:
            w.writerow(row)

    n_months = len({r[0] for r in rows_out})
    dmin = min(r[0] for r in rows_out)
    dmax = max(r[0] for r in rows_out)
    print(f"OK: {len(rows_out)} linhas, {n_months} meses -> {out_path}")
    print(f"     datas: {dmin} .. {dmax}")
    try:
        precos_rel = prices_path.relative_to(REPO_ROOT)
    except ValueError:
        precos_rel = prices_path
    print(f"     precos: {precos_rel}")
    first_d = pd.Timestamp(idx.min())
    last_d = pd.Timestamp(idx.max())
    span_y = (last_d - first_d).days / 365.25
    print(f"     cobertura prices_close: {first_d.date()} .. {last_d.date()} (~{span_y:.1f} anos)")
    if span_y < 19.0:
        alvo_ini = last_d - pd.DateOffset(years=20)
        lb = int(args.lookback)
        print(
            f"     NOTA: para historico ~20 anos (como model_equity_final_20y), o painel de precos "
            f"deveria comecar por volta de {alvo_ini.date()} (mais ~{lb} dias uteis de lookback antes do 1 rebalance)."
        )
    print(
        f"     motor: engine_v2 (lookback={args.lookback}, top_q={args.top_q}, cap={args.cap}, bench={args.benchmark})"
    )
    print(
        "     AVISO: estes pesos nao reproduzem o overlay V5/CAP15 nem a curva model_equity do freeze."
    )
    return 0


def _run_v5_cap15_pipeline(args: argparse.Namespace) -> int:
    """Delega para run_v5_cap15_pipeline.py (engine_research_v5 no clone)."""
    script = REPO_ROOT / "backend" / "scripts" / "run_v5_cap15_pipeline.py"
    if not script.is_file():
        print(f"ERRO: falta {script}")
        return 1
    cmd = [sys.executable, str(script)]
    ex = (args.prices or "").strip()
    if ex:
        cmd.extend(["--prices", ex])
    er = (getattr(args, "engine_root", None) or "").strip()
    if er:
        cmd.extend(["--engine-root", er])
    print(f"INFO: pipeline V5 CAP15: {' '.join(cmd)}")
    r = subprocess.run(cmd, cwd=str(REPO_ROOT))
    return int(r.returncode)


def main() -> int:
    ap = argparse.ArgumentParser(
        description="weights_by_rebalance: V5 desde freeze (se existir) ou engine_v2"
    )
    ap.add_argument(
        "--mode",
        choices=("auto", "v2", "freeze", "v5"),
        default="auto",
        help="auto=preferir export V5 no freeze; v5=motor engine_research_v5 CAP15 no clone; v2=engine_v2; freeze=copiar V5 ou falhar",
    )
    ap.add_argument("--lookback", type=int, default=120)
    ap.add_argument(
        "--top-q",
        type=int,
        default=20,
        dest="top_q",
        help="Numero de nomes na carteira (momentum top-Q). Nao e o 'CAP15' do V5; ex. 15 para coincidir com comando manual.",
    )
    ap.add_argument("--cap", type=float, default=0.20)
    ap.add_argument("--benchmark", type=str, default="SPY")
    ap.add_argument("--out", type=str, default="", help="CSV de saida")
    ap.add_argument(
        "--prices",
        type=str,
        default="",
        help="CSV de precos (coluna date). Alternativa: env DECIDE_PRICES_CLOSE",
    )
    ap.add_argument(
        "--engine-root",
        type=str,
        default="",
        dest="engine_root",
        help="Só --mode v5: pasta do backend do clone (engine_research_v5.py). Env: DECIDE_V5_ENGINE_ROOT",
    )
    ap.add_argument(
        "--min-v5-months",
        type=int,
        default=6,
        dest="min_v5_months",
        help="Em modo auto, nao copiar export V5 se tiver menos N meses distintos (stubs). Forcar: DECIDE_V5_WEIGHTS_FORCE=1",
    )
    args = ap.parse_args()

    if args.mode == "v5":
        return _run_v5_cap15_pipeline(args)

    out_path = Path(args.out) if args.out else REPO_ROOT / "backend" / "data" / "weights_by_rebalance.csv"
    out_path.parent.mkdir(parents=True, exist_ok=True)

    force_v5 = (os.environ.get("DECIDE_V5_WEIGHTS_FORCE") or "").strip().lower() in ("1", "true", "yes")

    v5_skip_reason = ""

    if args.mode in ("auto", "freeze"):
        src = resolve_v5_weights_csv()
        if src is not None:
            nmonths = _unique_rebalance_months_in_csv(src)
            min_m = max(1, int(args.min_v5_months))
            if not force_v5 and nmonths < min_m:
                if args.mode == "freeze":
                    print(
                        f"ERRO: export V5 em {src} tem so {nmonths} mes(es) (< {min_m}). "
                        "Stub incompleto. Usa DECIDE_V5_WEIGHTS_FORCE=1 ou um CSV completo."
                    )
                    return 1
                v5_skip_reason = (
                    f"export V5 em {src} tem so {nmonths} mes(es) (< {min_m}); ignorado como stub. "
                    "Forcar copia: DECIDE_V5_WEIGHTS_FORCE=1"
                )
            else:
                shutil.copy2(src, out_path)
                print(f"OK: copiado export V5 (oficial) -> {out_path}")
                print(f"     origem: {src} ({nmonths} meses distintos)")
                return 0
        elif args.mode == "freeze":
            print(
                "ERRO: nao encontrei weights_by_rebalance.csv do V5 (freeze CAP15 ou DECIDE_V5_WEIGHTS_SRC)."
            )
            print("      Coloca o freeze em decide-core/freeze/... ou define DECIDE_V5_WEIGHTS_SRC.")
            return 1

    if v5_skip_reason:
        print(f"INFO: {v5_skip_reason}")
    else:
        print(
            "INFO: sem export V5 no freeze — a calcular com engine_v2 (nao e o mesmo motor que a curva CAP15)."
        )
    return _run_engine_v2(args, out_path)


if __name__ == "__main__":
    raise SystemExit(main())
