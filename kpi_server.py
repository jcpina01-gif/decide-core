from __future__ import annotations

from collections import deque
from datetime import date, datetime
from math import sqrt
from pathlib import Path
import json
import os
import re
import sys
import traceback
import unicodedata
from urllib.parse import urlparse

import numpy as np
import pandas as pd
from flask import Flask, Response, jsonify, make_response, render_template_string, request

TRADING_DAYS_PER_YEAR = 252

# Sharpe “clássico”: retornos diários em excesso da taxa livre de risco, anualizado com √252.
# Em papers de factor / comparação de estratégias usa-se muitas vezes rf=0; fundos e relatórios
# institucionais costumam usar T-Bills (ex. ~2–5% anual conforme o período). Override: env DECIDE_KPI_RISK_FREE_ANNUAL=0.04
try:
    RISK_FREE_ANNUAL = float(os.environ.get("DECIDE_KPI_RISK_FREE_ANNUAL", "0"))
except ValueError:
    RISK_FREE_ANNUAL = 0.0

def _smooth_v5_kpis_path(root: Path) -> Path:
    return root / "freeze" / "DECIDE_MODEL_V5_V2_3_SMOOTH" / "model_outputs" / "v5_kpis.json"


def _smooth_data_end_date(root: Path) -> date | None:
    """Última data de série no meta do freeze smooth (se existir)."""
    p = _smooth_v5_kpis_path(root)
    if not p.is_file():
        return None
    try:
        meta = json.loads(p.read_text(encoding="utf-8"))
        raw = str(meta.get("data_end") or "").strip()[:10]
        if len(raw) != 10 or raw[4] != "-" or raw[7] != "-":
            return None
        return datetime.strptime(raw, "%Y-%m-%d").date()
    except (OSError, ValueError, TypeError, KeyError):
        return None


def _smooth_model_equity_last_date(root: Path) -> date | None:
    """Última data na primeira coluna de `model_equity_final_20y.csv` (fonte real do embed CAP15)."""
    p = (
        root
        / "freeze"
        / "DECIDE_MODEL_V5_V2_3_SMOOTH"
        / "model_outputs"
        / "model_equity_final_20y.csv"
    )
    if not p.is_file():
        return None
    try:
        tail: deque[str] = deque(maxlen=8)
        with p.open("r", encoding="utf-8-sig", errors="replace", newline="") as f:
            for line in f:
                s = line.strip()
                if not s or s.lower().startswith("date"):
                    continue
                tail.append(s)
        if not tail:
            return None
        first_cell = tail[-1].split(",", 1)[0].strip()
        ts = pd.to_datetime(first_cell, errors="coerce")
        if pd.isna(ts):
            return None
        return ts.date()
    except (OSError, ValueError, TypeError):
        return None


def _smooth_series_freshness(root: Path) -> date | None:
    """Desempate entre clones: `max(última data no CSV de equity, data_end em v5_kpis)`."""
    d_csv = _smooth_model_equity_last_date(root)
    d_meta = _smooth_data_end_date(root)
    if d_csv is not None and d_meta is not None:
        return max(d_csv, d_meta)
    return d_csv or d_meta


def _resolve_kpi_repo_root() -> Path:
    """Pasta do monorepo com `freeze/`.

    Por omissão considera `DECIDE_KPI_REPO_ROOT`, `DECIDE_PROJECT_ROOT` e a pasta do `kpi_server.py`.
    Se `DECIDE_KPI_STRICT_REPO_ROOT` não estiver activo, **escolhe o candidato com série CAP15 mais recente**
    (`model_equity_final_20y.csv` e `v5_kpis.json` — evita gráficos presos a um clone com meta desactualizada
    ou equity truncada quando o checkout canónico já foi regenerado).
    """
    strict = os.environ.get("DECIDE_KPI_STRICT_REPO_ROOT", "").strip().lower() in {"1", "true", "yes", "on"}
    here = Path(__file__).resolve().parent

    def _ordered_candidates() -> list[Path]:
        out: list[Path] = []
        seen: set[str] = set()
        for key in ("DECIDE_KPI_REPO_ROOT", "DECIDE_PROJECT_ROOT"):
            raw = (os.environ.get(key) or "").strip()
            if not raw:
                continue
            p = Path(raw).expanduser().resolve()
            if not p.is_dir() or not (p / "freeze").is_dir():
                continue
            k = str(p)
            if k in seen:
                continue
            seen.add(k)
            out.append(p)
        k0 = str(here)
        if k0 not in seen and here.is_dir() and (here / "freeze").is_dir():
            out.append(here)
        # Mesmo directorio pai (ex.: `Documents/`): outro checkout para desempate de frescura
        # quando se arranca `kpi_server.py` a partir do clone e o freeze canónico está em `decide-core/`.
        try:
            par = here.parent
            for sib_name in ("decide-core", "DECIDE_CORE22_CLONE"):
                sib = (par / sib_name).resolve()
                if not sib.is_dir() or not (sib / "freeze").is_dir():
                    continue
                ks = str(sib)
                if ks in seen:
                    continue
                seen.add(ks)
                out.append(sib)
        except OSError:
            pass
        return out

    cands = _ordered_candidates()
    if not cands:
        return here

    if strict:
        return cands[0]

    scored: list[tuple[tuple[int, date], Path]] = []
    for c in cands:
        de = _smooth_series_freshness(c)
        if de is not None:
            scored.append(((1, de), c))
        else:
            scored.append(((0, date.min), c))
    scored.sort(key=lambda x: x[0], reverse=True)
    return scored[0][1]


REPO_ROOT = _resolve_kpi_repo_root()
BACKEND_META_PATH = REPO_ROOT / "backend" / "data" / "company_meta_global_enriched.csv"
# Complemento versionado: tickers em falta no CSV global (ex.: novos no freeze antes do próximo export de meta).
COMPANY_META_KPI_OVERRIDES_PATH = REPO_ROOT / "backend" / "data" / "company_meta_kpi_overrides.csv"
# Meta no HTML embebido — «Ver código-fonte da página» deve mostrar este valor após deploy/restart.
KPI_SERVER_BUILD_TAG = (
    "decide-kpi-2026-04-cap15-moderado-vol-align-kpi-strict-v29-company-meta-overrides"
    "-horizons-retornos-dd-v30-calc-source-v38-moderado-vol-bench-margin-raw"
)


def _kpi_package_dir() -> Path:
    """Pasta do `kpi_server.py`; pode ter `freeze/` completo quando `DECIDE_PROJECT_ROOT` aponta para clone parcial."""
    return Path(__file__).resolve().parent


def _freeze_search_roots() -> tuple[Path, ...]:
    """Monorepos a pesquisar (`freeze/`, benchmark longo, teórico). Evita stub se o clone só existir no checkout canónico."""
    seen: set[str] = set()
    out: list[Path] = []
    for p in (REPO_ROOT, _kpi_package_dir()):
        try:
            key = str(p.resolve())
        except OSError:
            key = str(p)
        if key in seen:
            continue
        seen.add(key)
        out.append(p)
    return tuple(out)


def _read_v5_meta(outputs_dir: Path) -> dict | None:
    p = outputs_dir / "v5_kpis.json"
    if not p.is_file():
        return None
    try:
        payload = json.loads(p.read_text(encoding="utf-8-sig"))
    except Exception:
        return None
    return payload if isinstance(payload, dict) else None


def _read_official_moderado_battery_kpis() -> dict | None:
    """
    Single source of truth for official moderado KPIs in dashboard cards.
    Reads the main candidate from backend/data/moderado_trial_risk_control_battery.json.
    """
    p = REPO_ROOT / "backend" / "data" / "moderado_trial_risk_control_battery.json"
    if not p.is_file():
        return None
    try:
        payload = json.loads(p.read_text(encoding="utf-8-sig"))
    except Exception:
        return None
    if not isinstance(payload, dict):
        return None
    scenarios = payload.get("scenarios")
    if not isinstance(scenarios, list) or not scenarios:
        return None
    main_name = str(payload.get("main_candidate") or "").strip()
    chosen = None
    if main_name:
        for row in scenarios:
            if isinstance(row, dict) and str(row.get("name") or "").strip() == main_name:
                chosen = row
                break
    if chosen is None:
        for row in scenarios:
            if isinstance(row, dict) and str(row.get("name") or "").strip() == "moderado_trial_risk_control":
                chosen = row
                break
    if chosen is None and isinstance(scenarios[0], dict):
        chosen = scenarios[0]
    if not isinstance(chosen, dict):
        return None
    try:
        cagr = float(chosen.get("overlayed_cagr"))
        sharpe = float(chosen.get("overlayed_sharpe"))
        mdd = float(chosen.get("max_drawdown"))
    except Exception:
        return None
    if not (np.isfinite(cagr) and np.isfinite(sharpe) and np.isfinite(mdd)):
        return None
    return {
        "scenario_name": str(chosen.get("name") or "").strip() or main_name or "moderado_trial_risk_control",
        "cagr": cagr,
        "sharpe": sharpe,
        "max_drawdown": mdd,
    }


def _meta_data_end(meta: dict | None) -> date:
    if not isinstance(meta, dict):
        return date.min
    raw = str(meta.get("data_end") or "").strip()[:10]
    try:
        return datetime.strptime(raw, "%Y-%m-%d").date()
    except Exception:
        return date.min


def _resolve_plafonado_cap15_outputs_dir() -> Path:
    """
    Escolhe a fonte CAP15 para KPI do iframe.

    Prioridade:
    1) artefacto com `curve_engine=engine_research_v5` (fonte calculada pelo motor oficial);
    2) desempate por `data_end` mais recente.

    Isto evita cair em `engine_v2_regenerate` quando algum job legacy reescreve
    `freeze/.../model_outputs`, mantendo cálculo por séries (não por valores injectados).
    """
    candidates: list[Path] = []
    seen: set[str] = set()
    for root in _freeze_search_roots():
        for cand in (
            root / "freeze" / "DECIDE_MODEL_V5_V2_3_SMOOTH" / "model_outputs",
            root / "frontend" / "data" / "landing" / "freeze-cap15",
        ):
            if not (cand / "model_equity_final_20y.csv").is_file():
                continue
            try:
                key = str(cand.resolve())
            except OSError:
                key = str(cand)
            if key in seen:
                continue
            seen.add(key)
            candidates.append(cand)
    if not candidates:
        return REPO_ROOT / "freeze" / "DECIDE_MODEL_V5_V2_3_SMOOTH" / "model_outputs"
    scored: list[tuple[tuple[int, date], Path]] = []
    for c in candidates:
        meta = _read_v5_meta(c)
        eng = str((meta or {}).get("curve_engine") or "").strip().lower()
        is_research_v5 = 1 if eng == "engine_research_v5" else 0
        scored.append(((is_research_v5, _meta_data_end(meta)), c))
    scored.sort(key=lambda x: x[0], reverse=True)
    return scored[0][1]


def _fallback_benchmark_equity_csv_list() -> list[Path]:
    paths: list[Path] = []
    for root in _freeze_search_roots():
        paths.append(
            root
            / "freeze"
            / "DECIDE_MODEL_V5_V2_3_SMOOTH"
            / "model_outputs_from_clone"
            / "benchmark_equity_final_20y.csv",
        )
    return paths

# CAP15 plafonado (≤100% NAV): freeze V2.3 smooth (`model_outputs`) via `equity_overlayed`.
# «Com margem» (mesmo motor + custos, sem teto 100%): `model_equity_final_20y[_perfil]_margin.csv` (`export_smooth_freeze_from_v5.py`).
# Teórico cru: `model_equity_theoretical_20y.csv`.
# Benchmark: se `model_outputs/benchmark_equity_final_20y.csv` for um stub curto, usar `model_outputs_from_clone/` (mesmo calendário que o modelo).
_PLAFONADO_CAP15_OUTPUTS = _resolve_plafonado_cap15_outputs_dir()

MODEL_PATHS = {
    "v5": REPO_ROOT / "freeze" / "DECIDE_MODEL_V5" / "model_outputs",
    "v5_constrained": REPO_ROOT / "freeze" / "DECIDE_MODEL_V5_CONSTRAINED_GLOBAL" / "model_outputs",
    "v5_overlay": REPO_ROOT / "freeze" / "DECIDE_MODEL_V5_OVERLAY" / "model_outputs",
    "v5_overlay_cap15": REPO_ROOT / "freeze" / "DECIDE_MODEL_V5_OVERLAY_CAP15" / "model_outputs",
    "v5_overlay_cap15_max100exp": _PLAFONADO_CAP15_OUTPUTS,
    "v5_v2_3_smooth": _PLAFONADO_CAP15_OUTPUTS,
}
MODEL_LABELS = {
    "v5": "V5",
    "v5_constrained": "V5 Constrained (US≈60% / setores≈bench, in-motor)",
    "v5_overlay": "V5 Overlay (US≈60% / países+setores)",
    "v5_overlay_cap15": "V5 Overlay CAP15 (legado interno)",
    "v5_overlay_cap15_max100exp": "Modelo CAP15 (V2.3 smooth)",
    "v5_v2_3_smooth": "Modelo CAP15 (V2.3 smooth)",
}

# Modelos com v5_kpis.json no freeze (sleeve / meta)
V5_KPI_JSON_MODEL_KEYS = (
    "v5",
    "v5_v2_3_smooth",
    "v5_constrained",
    "v5_overlay",
    "v5_overlay_cap15",
    "v5_overlay_cap15_max100exp",
)

# CAP15 investível (plafonado / legado overlay) e comparativo com margem: conservador/dinâmico com alvo de vol vs benchmark sempre.
CAP15_VOL_TARGET_MODEL_KEYS = frozenset({"v5_overlay_cap15_max100exp", "v5_overlay_cap15", "v5_v2_3_smooth"})

# Frontend Next.js base URL (para links rápidos no dashboard Flask)
# Ex.: http://127.0.0.1:4701
FRONTEND_URL = (os.environ.get("FRONTEND_URL") or "http://127.0.0.1:4701").rstrip("/")


def _normalize_frontend_base_for_next_embeds(scheme: str, netloc: str) -> str:
    """
    Rotas `/embed/*` (FAQ, histórico) vivem no Next (Vercel), não no processo Flask do KPI.
    Quando o HTML do KPI é servido em `kpi.*`, o Referer pode ser esse host — não usar como base do iframe.
    """
    h = (netloc or "").lower()
    if "@" in h:
        h = h.rsplit("@", 1)[-1]
    host_only = h.split(":")[0]
    port = ""
    if ":" in h:
        port = ":" + h.split(":", 1)[1]
    if host_only == "kpi.decidepoweredbyai.com" or host_only == "decidepoweredbyai.com":
        return f"{scheme}://www.decidepoweredbyai.com{port}"
    return f"{scheme}://{netloc}"


def resolve_frontend_url_for_embed(req) -> str:
    """
    Base do Next para iframes (FAQ, histórico de decisões). `FRONTEND_URL` no ambiente tem prioridade.
    Se não estiver definido, tenta `Referer` / `Origin` (página que embute o KPI) — evita iframe para
    127.0.0.1 em produção quando o deploy esqueceu o env.
    """
    explicit = (os.environ.get("FRONTEND_URL") or "").strip().rstrip("/")
    if explicit:
        return explicit
    fallback_public = (os.environ.get("DECIDE_PUBLIC_WEB_URL") or "").strip().rstrip("/")
    if fallback_public:
        return fallback_public
    for hdr in ("Referer", "Origin"):
        raw = (req.headers.get(hdr) or "").strip()
        if not raw.startswith(("http://", "https://")):
            continue
        try:
            p = urlparse(raw)
            if not p.scheme or not p.netloc:
                continue
            host = p.netloc.lower()
            if "@" in host:
                host = host.rsplit("@", 1)[-1]
            host_no_port = host.split(":")[0]
            if (
                "decidepoweredbyai.com" in host
                or host_no_port == "localhost"
                or host_no_port.startswith("127.0.0.1")
            ):
                return _normalize_frontend_base_for_next_embeds(p.scheme, p.netloc)
        except Exception:
            continue
    return FRONTEND_URL
# CAP15 (strict): todos os perfis alinham vol vs benchmark no KPI (moderado 1×; conservador/dinâmico 0,75× / 1,25×) — ver `apply_model_equity_profile_policy`.
PROFILE_OPTIONS = [
    ("conservador", "Conservador (0,75× vol bench)"),
    ("moderado", "Moderado (1× vol bench)"),
    ("dinamico", "Dinâmico (1,25× vol bench)"),
]
PROFILE_VOL_MULTIPLIER = {"conservador": 0.75, "moderado": 1.0, "dinamico": 1.25}
# Rótulo curto PT nos cartões do modelo CAP15 (alinhado ao selector do dashboard Next).
PROFILE_LABEL_PT_SHORT = {"conservador": "Conservador", "moderado": "Moderado", "dinamico": "Dinâmico"}


def normalize_risk_profile_key(profile_key: str | None) -> str:
    """
    Mapeia variantes (PT com acentos, labels em inglês) para conservador | moderado | dinamico.

    Sem isto, `dinâmico` ≠ `dinamico` falha o whitelist do Flask e cai em moderado; e
    `PROFILE_VOL_MULTIPLIER.get` devolve 1.0 em vez de 1.25.
    """
    raw = (profile_key or "").strip()
    if not raw:
        return "moderado"
    lowered = raw.lower()
    s = "".join(
        ch for ch in unicodedata.normalize("NFD", lowered) if unicodedata.category(ch) != "Mn"
    )
    s = s.strip()
    if s in ("conservador", "conservative", "defensivo", "defensive"):
        return "conservador"
    if s in ("dinamico", "dynamic", "agresivo", "agressivo", "arrojado"):
        return "dinamico"
    if s in ("moderado", "moderate", "medio", "equilibrado", "balanced", "neutro", "neutral"):
        return "moderado"
    return "moderado"


def scale_model_equity_to_profile_vol(
    model_eq: pd.Series,
    bench_eq: pd.Series,
    profile_key: str,
    *,
    has_profile_file: bool,
) -> pd.Series:
    """
    Escala retornos para a vol anual da curva ficar ≈ multiplier × vol do benchmark
    (moderado 1×; conservador 0,75×; dinâmico 1,25×). Idempotente quando a série já está no alvo.
    Se `has_profile_file=True`, devolve a série sem alterar (uso pontual por chamadores legados).
    """
    if has_profile_file:
        return model_eq.astype(float)
    canon = normalize_risk_profile_key(profile_key)
    mult = PROFILE_VOL_MULTIPLIER.get(canon, 1.0)
    model_eq = model_eq.astype(float)
    bench_eq = bench_eq.astype(float)
    m_ret = model_eq.pct_change().dropna()
    b_ret = bench_eq.pct_change().dropna()
    if len(m_ret) and len(b_ret):
        common_idx = m_ret.index.intersection(b_ret.index)
        if len(common_idx):
            m_ret_c = m_ret.loc[common_idx]
            b_ret_c = b_ret.loc[common_idx]
            m_vol = float(m_ret_c.std() * sqrt(TRADING_DAYS_PER_YEAR))
            b_vol = float(b_ret_c.std() * sqrt(TRADING_DAYS_PER_YEAR))
            # Benchmark alinhado a um stub curto → vol quase nula mas >0: o factor escala o modelo para CAGR ~0%.
            if m_vol > 0 and b_vol >= 0.02:
                target_vol = mult * b_vol
                scale = target_vol / m_vol
                ret_scaled = m_ret * scale
                eq_new = model_eq.copy()
                for i in range(1, len(eq_new)):
                    eq_new.iloc[i] = eq_new.iloc[i - 1] * (1.0 + float(ret_scaled.iloc[i - 1]))
                return eq_new
    return model_eq.astype(float)


def kpi_env_real_equity() -> bool:
    """Opt-in no embed: preferir `model_equity_final_20y_{perfil}.csv` quando existir (ver `kpi_force_synthetic_vol`)."""
    return str(os.environ.get("DECIDE_KPI_REAL_EQUITY", "")).strip().lower() in {
        "1",
        "true",
        "yes",
        "on",
    }


def kpi_env_synthetic_profile_vol_override() -> bool:
    """Força reescala sintética de vol em qualquer vista (além do defeito do iframe)."""
    return str(os.environ.get("DECIDE_KPI_SYNTHETIC_PROFILE_VOL", "")).strip().lower() in {
        "1",
        "true",
        "yes",
        "on",
    }


def kpi_force_synthetic_vol(*, client_embed: bool) -> bool:
    """
    Controla sobretudo **qual CSV** se carrega no embed (ficheiro base `model_equity_final_20y.csv` vs variante por perfil).

    - Iframe / rotas embed: por defeito usa o CSV base para todos os perfis; `DECIDE_KPI_REAL_EQUITY=1` permite CSV por perfil.
    - Nos modelos **CAP15** (`CAP15_VOL_TARGET_MODEL_KEYS` / margem), conservador/dinâmico aplicam sempre esse alvo
      em `apply_model_equity_profile_policy` (`strict_cap15_vol_targets`). Nos restantes modelos v5, a reescala
      segue o comportamento legado (este flag e `client_embed` incluídos).
    - Reforço global: `DECIDE_KPI_SYNTHETIC_PROFILE_VOL=1`.
    - Página KPI completa (não embed): só força o caminho «base» quando `DECIDE_KPI_SYNTHETIC_PROFILE_VOL=1`.
    """
    if kpi_env_synthetic_profile_vol_override():
        return True
    if client_embed:
        return not kpi_env_real_equity()
    return False


def apply_model_equity_profile_policy(
    model_eq: pd.Series,
    bench_eq: pd.Series,
    profile_key: str,
    *,
    used_profile_file: bool,
    client_embed: bool,
    force_synthetic_profile_vol: bool,
    strict_cap15_vol_targets: bool = False,
) -> pd.Series:
    """
    - **Moderado:** no CAP15 com `strict_cap15_vol_targets`, alinha a vol realizada a ≈ **1×** a do benchmark
      (`scale_model_equity_to_profile_vol`, mult 1,0). Noutros modelos v5, por defeito mantém a série do CSV.
    - **Conservador / dinâmico:** alvo ≈ 0,75× / 1,25× vol do benchmark quando a reescala está activa.

    Com `strict_cap15_vol_targets=True` (CAP15 plafonado, série m100 alinhada, com margem): todos os perfis
    aplicam o alvo via `scale_model_equity_to_profile_vol` (ignora `used_profile_file` e opt-out de embed).
    Se a vol natural da série for superior ao alvo (ex. 1,25× bench no dinâmico), a reescala baixa vol e CAGR.

    Com `strict_cap15_vol_targets=False` (outros modelos v5): comportamento legado — `used_profile_file` isenta;
    no embed sem `force_synthetic_profile_vol` conservador/dinâmico ficam sem reescala.
    """
    pk = normalize_risk_profile_key(profile_key)
    # Single official KPI definition: moderado should remain the raw model series (no post-rescale),
    # including CAP15 paths where strict targets are used for other profiles.
    if pk == "moderado":
        return model_eq.astype(float)
    if strict_cap15_vol_targets:
        return scale_model_equity_to_profile_vol(
            model_eq, bench_eq, pk, has_profile_file=False
        )

    if used_profile_file:
        return model_eq.astype(float)
    if force_synthetic_profile_vol:
        return scale_model_equity_to_profile_vol(
            model_eq, bench_eq, pk, has_profile_file=False
        )
    if client_embed:
        return model_eq.astype(float)
    return scale_model_equity_to_profile_vol(
        model_eq, bench_eq, pk, has_profile_file=False
    )


def kpi_equity_vs_benchmark_rail_enabled() -> bool:
    """
    *Rail* de sanidade (múltiplo máximo vs benchmark + crescimento diário coerente). Por defeito **desligado**
    para manter paridade com os KPIs oficiais do artefacto versionado (Dashboard = Model Lab).
    Para activar explicitamente em troubleshooting visual define ``DECIDE_KPI_EQUITY_RAIL=1``.
    """
    v = str(os.environ.get("DECIDE_KPI_EQUITY_RAIL", "0")).strip().lower()
    return v not in ("0", "false", "off", "no")


def kpi_cap15_bench_prefix_backfill_enabled() -> bool:
    """
    Backfill do prefixo flat CAP15 com benchmark. Por defeito **desligado** para evitar
    pós-processamento no KPI principal. Activar explicitamente com ``DECIDE_KPI_CAP15_BENCH_BACKFILL=1``.
    Mantém compatibilidade com o sinalizador legado ``DECIDE_KPI_DISABLE_CAP15_BENCH_BACKFILL``.
    """
    legacy_disable = os.environ.get("DECIDE_KPI_DISABLE_CAP15_BENCH_BACKFILL", "").strip().lower()
    if legacy_disable in {"1", "true", "yes", "on"}:
        return False
    v = str(os.environ.get("DECIDE_KPI_CAP15_BENCH_BACKFILL", "0")).strip().lower()
    return v in ("1", "true", "yes", "on")


def cap_equity_vs_benchmark_rail(bench_eq: pd.Series, model_eq: pd.Series) -> pd.Series:
    """
    Quando o CSV de equity rebenta na cauda (ex.: 1e19–1e23 com benchmark ~5), o Plotly em escala log
    no iframe fica ilegível. Isto **não** corrige o motor de geração do freeze — só limita a série
    servida ao cliente (múltiplo máximo vs benchmark + crescimento diário coerente com o dia anterior).
    Paridade com `capEquitySeriesVsBenchmarkRail` em `frontend/lib/plafonadoFeesSeries.ts`.

    Desligar (*portfolio* = dados do CSV sem alterar): ``DECIDE_KPI_EQUITY_RAIL=0`` — ver ``kpi_equity_vs_benchmark_rail_enabled``.
    """
    if not kpi_equity_vs_benchmark_rail_enabled():
        return model_eq.astype(float)
    if len(bench_eq) != len(model_eq):
        return model_eq.astype(float)
    MAX_OVER = 120.0
    MAX_DAY = 1.22
    b = bench_eq.to_numpy(dtype=float, copy=False)
    m = model_eq.to_numpy(dtype=float, copy=True)
    for i in range(len(m)):
        bv = float(b[i])
        if not (np.isfinite(bv) and bv > 0):
            continue
        mv = float(m[i])
        if not (np.isfinite(mv) and mv > 0):
            continue
        hard = bv * MAX_OVER
        if i == 0:
            m[i] = min(mv, hard)
            continue
        b0 = float(b[i - 1])
        v0 = float(m[i - 1])
        if not (np.isfinite(b0) and b0 > 0 and np.isfinite(v0) and v0 > 0):
            m[i] = min(mv, hard)
            continue
        br = bv / b0
        linked = v0 * min(MAX_DAY, max(1.0 / MAX_DAY, br * 1.08))
        m[i] = min(mv, hard, linked)
    return pd.Series(m, index=model_eq.index, dtype=float)


def load_run_model_snapshot(profile_key: str) -> dict | None:
    """Load a live run_model snapshot if one is available."""
    candidates = [
        REPO_ROOT / "tmp_diag" / "run_model_live.json",
        REPO_ROOT / f"tmp_run_model_{profile_key}.json",
        REPO_ROOT / "tmp_run_model_moderado.json",
    ]
    for path in candidates:
        if not path.exists():
            continue
        try:
            with path.open("r", encoding="utf-8-sig") as f:
                payload = json.load(f)
        except Exception:
            continue
        if isinstance(payload, dict) and isinstance(payload.get("raw_kpis"), dict):
            return payload
    return None


HTML_TEMPLATE = """
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="color-scheme" content="dark">
    <meta name="decide-kpi-build" content="{{ kpi_build_tag }}">
    <title>DECIDE</title>
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <style>
      :root{
        --bg0:#09090b;
        --bg1:#18181b;
        --card:#18181b;
        --border:rgba(63,63,70,0.75);
        --text:#e5e7eb;
        --muted:#d4d4d8;
        --muted2:#b4b4bc;
        --good:#16a34a;
        --bad:#dc2626;
        --accent:#0d9488;
        --shadow: 0 10px 35px rgba(0,0,0,.45);
      }
      *{ box-sizing:border-box; }
      body{
        font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        margin: 0;
        background:
          radial-gradient(120% 90% at 50% -10%, rgba(45,212,191,.10) 0%, transparent 55%),
          radial-gradient(900px 600px at 100% 0%, rgba(13,148,136,.12), transparent 58%),
          linear-gradient(180deg, var(--bg1), var(--bg0));
        color: var(--text);
      }
      a{ color:inherit; }
      .container{ max-width: 1200px; margin: 0 auto; padding: 28px 32px 52px; }
      .topbar{
        position: sticky;
        top: 0;
        z-index: 5;
        backdrop-filter: blur(10px);
        background: linear-gradient(90deg, rgba(9,9,11,.97), rgba(24,24,27,.96));
        border-bottom: 1px solid rgba(63,63,70,.75);
      }
      .topbar-inner{
        max-width: 1200px;
        margin: 0 auto;
        padding: 12px 28px;
        display:flex;
        align-items:center;
        justify-content:space-between;
        gap: 16px;
      }
      .brand{
        display:flex;
        align-items:center;
        gap: 12px;
        min-width: 260px;
      }
      h1{
        margin: 0;
        font-size: 1.15rem;
        letter-spacing: .02em;
        font-weight: 640;
      }
      .subtitle{
        color: var(--muted);
        font-size: .82rem;
        margin-top: 0;
        max-width: 640px;
      }
      .controls{
        display:flex;
        flex-wrap: wrap;
        gap: 12px 14px;
        align-items:center;
        justify-content:flex-end;
      }
      .control{
        display:flex;
        align-items:center;
        gap: 8px;
        color: var(--muted);
        font-size: .8rem;
      }
      select{
        background: rgba(24,24,27,.96);
        color: var(--text);
        border: 1px solid rgba(63,63,70,.85);
        border-radius: 999px;
        padding: 8px 14px;
        font-size: .9rem;
        outline: none;
      }
      select:focus{ border-color: rgba(45,212,191,.85); box-shadow: 0 0 0 3px rgba(45,212,191,.18); }
      h2{
        margin-top: 32px;
        margin-bottom: 14px;
        font-size: 1.02rem;
        color: #e2e8f0;
      }
      .tabs{
        display:flex;
        gap: 14px;
        margin-top: 4px;
        margin-bottom: 6px;
        padding: 12px 0 16px;
        border-bottom: 2px solid rgba(45,212,191,.35);
        flex-wrap: wrap;
        align-items: center;
      }
      .tab{
        padding: 14px 26px;
        border-radius: 14px;
        border: 2px solid rgba(45,212,191,.45);
        cursor: pointer;
        font-size: 1.08rem;
        font-weight: 800;
        letter-spacing: .04em;
        color: #99f6e4;
        background: rgba(24,24,27,.92);
        box-shadow: 0 4px 16px rgba(0,0,0,.35);
        transition: border-color .15s, color .15s, background .15s, box-shadow .15s;
      }
      .tab:hover{
        color: #fff;
        border-color: rgba(45,212,191,.9);
        background: rgba(13,148,136,.28);
        box-shadow: 0 6px 20px rgba(13,148,136,.22);
      }
      .tab.active{
        background: linear-gradient(180deg, #0f766e 0%, #115e59 55%, #134e4a 100%);
        color: #fff;
        border-color: rgba(45,212,191,.75);
        box-shadow: 0 0 0 4px rgba(13,148,136,.25), 0 10px 28px rgba(15,118,110,.35);
      }
      .tab-nav-label{
        width: 100%;
        font-size: .72rem;
        font-weight: 800;
        letter-spacing: .12em;
        color: #94a3b8;
        margin-bottom: 2px;
        text-transform: uppercase;
      }
      /* Uma linha: interior em nowrap + width:max-content; pai com scroll horizontal. */
      .horizon-intro-one-line{
        display: block;
        overflow-x: auto;
        overflow-y: hidden;
        width: 100%;
        max-width: 100%;
        min-width: 0;
        box-sizing: border-box;
        scrollbar-width: thin;
        -webkit-overflow-scrolling: touch;
      }
      .horizon-intro-one-line .horizon-intro-inner{
        display: inline-block;
        white-space: nowrap !important;
        width: max-content;
        max-width: none;
        word-break: normal;
        overflow-wrap: normal;
        hyphens: manual;
        -webkit-hyphens: manual;
        text-wrap: nowrap;
      }
      .horizon-intro-one-line strong,
      .horizon-intro-one-line code{
        white-space: nowrap !important;
        word-break: normal;
      }
      .tab-content{ display:none; padding-top: 22px; }
      .tab-content.active{ display:block; }
      .card{
        background: linear-gradient(145deg, rgba(12,22,41,.98) 0%, rgba(10,15,28,.98) 100%);
        padding: 20px 20px;
        border-radius: 18px;
        border: 1px solid rgba(13,148,136,.28);
        box-shadow: var(--shadow);
      }
      .grid{
        display:grid;
        grid-template-columns: repeat(12, 1fr);
        gap: 18px;
        margin-top: 16px;
      }
      .col-3{ grid-column: span 3; }
      .col-4{ grid-column: span 4; }
      .col-6{ grid-column: span 6; }
      .col-8{ grid-column: span 8; }
      .col-12{ grid-column: span 12; }
      @media (max-width: 920px){ .col-3{ grid-column: span 12; } }
      @media (max-width: 920px){ .col-4{ grid-column: span 12; } }
      @media (max-width: 920px){ .col-6{ grid-column: span 12; } }
      @media (max-width: 920px){ .col-8{ grid-column: span 12; } }
      .label{ font-size: .78rem; color: var(--muted); }
      .value{ font-size: 1.42rem; font-weight: 700; margin-top: 6px; }
      .value.positive{ color: var(--good); }
      .value.negative{ color: var(--bad); }
      .kpi-line{ margin-top: 8px; font-size: 1.05rem; font-weight: 650; line-height: 1.35; color: #eceef2; }
      .muted{ color: var(--muted2); font-size: .82rem; margin-top: 6px; }
      /* Total return nos cartões: mais legível que .muted genérico (--muted2). */
      .kpi-card-total-return{
        margin-top: 8px;
        font-size: 0.94rem;
        font-weight: 650;
        color: #e8e8ed;
        line-height: 1.35;
      }
      .kpi-hedge-under-metrics .kpi-card-total-return{
        font-size: 0.88rem;
        margin-top: 0;
      }
      .kpi-cagr-hint{ color: #d4d4d8; }
      .kpi-cap15-micro-hint{ color: #d4d4d8; }
      .kpi-cap15-costs-hint{ color: #eceef2; }
      .pill{
        display:inline-flex;
        align-items:center;
        gap: 6px;
        padding: 4px 10px;
        border-radius: 999px;
        background: rgba(39,39,42,.88);
        border: 1px solid rgba(45,212,191,.2);
        font-size: .75rem;
        color: var(--muted);
      }
      .quick-links{
        display:flex;
        flex-wrap:wrap;
        gap: 10px;
        margin-top: 12px;
      }
      .chip{
        display:inline-flex;
        align-items:center;
        padding: 8px 14px;
        border-radius: 999px;
        border: 1px solid rgba(45,212,191,.22);
        background: linear-gradient(180deg, rgba(15,23,42,.96) 0%, rgba(9,9,11,.98) 100%);
        color: var(--text);
        font-size: .82rem;
        text-decoration:none;
      }
      .chip:hover{ border-color: rgba(45,212,191,.85); box-shadow: 0 0 0 3px rgba(45,212,191,.14); }
      .stats-grid{ display:grid; grid-template-columns: repeat(12, 1fr); gap: 14px; margin-top: 16px; }
      .stat-box{ grid-column: span 4; background: linear-gradient(180deg, rgba(15,23,42,.96) 0%, rgba(9,9,11,.98) 100%); padding: 14px 16px; border-radius: 16px; border: 1px solid rgba(45,212,191,.22); }
      @media (max-width: 920px){ .stat-box{ grid-column: span 6; } }
      @media (max-width: 560px){ .stat-box{ grid-column: span 12; } }
      .stat-box .label{ font-size: .72rem; }
      .stat-box .num{ font-size: 1.05rem; font-weight: 700; margin-top: 2px; }
      .stats-grid.kpi-monthly-model-stats .stat-box .label{
        font-size: 0.84rem;
        color: #d8d8dc;
      }
      .stats-grid.kpi-monthly-model-stats .stat-box .num{
        font-size: 1.2rem;
      }
      .exposure-grid{
        display:grid;
        grid-template-columns: 1.15fr .85fr;
        gap: 18px;
        margin-top: 16px;
        align-items: stretch;
      }
      @media (max-width: 920px){ .exposure-grid{ grid-template-columns: 1fr; } }
      .chart-card{
        padding: 20px 20px 16px;
        min-height: 100%;
      }
      .pie-holder{
        position: relative;
        margin-top: 12px;
        min-height: 320px;
      }
      .month-grid{
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 24px;
        margin-top: 1.5rem;
      }
      @media (max-width: 920px){ .month-grid{ grid-template-columns: 1fr; } }
      .horizon-grid-2x2{
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 1.25rem;
        align-items: stretch;
      }
      .horizon-grid-2x2 .pie-holder{
        min-height: 200px;
      }
      @media (max-width: 920px){
        .horizon-grid-2x2{ grid-template-columns: 1fr; }
      }
      .month-card{
        padding: 24px 24px 22px;
        min-height: 100%;
      }
      .month-list{
        display: grid;
        gap: 14px;
        margin-top: 14px;
        font-size: .72rem;
        line-height: 1.55;
      }
      .month-list > div{
        display: flex;
        justify-content: space-between;
        align-items: baseline;
        gap: 24px;
        padding: 12px 0;
        border-bottom: 1px solid rgba(63,63,70,.55);
      }
      .month-list > div:last-child{
        border-bottom: 0;
        padding-bottom: 0;
      }
      .month-list .value{
        font-size: .95rem;
        margin-top: 0;
        white-space: nowrap;
      }
      table{ border-collapse: collapse; margin-top: 16px; width: 100%; background: rgba(24,24,27,.96); border-radius: 16px; overflow: hidden; border: 1px solid rgba(63,63,70,.85); }
      th, td{ padding: 11px 14px; text-align: right; }
      th{ background: rgba(39,39,42,.95); font-weight: 650; font-size: .72rem; color: var(--muted); letter-spacing: .02em; text-transform: uppercase; }
      tr:hover td{ background: rgba(45,212,191,.08); }
      /* Carteira: linhas alternadas mais legíveis */
      #tab-portfolio table tbody tr:nth-child(odd) td{
        background: rgba(15,23,42,.45);
      }
      #tab-portfolio table tbody tr:nth-child(even) td{
        background: rgba(148,163,184,.11);
      }
      #tab-portfolio table tbody tr:hover td{
        background: rgba(45,212,191,.12) !important;
      }
      td:first-child, th:first-child{ text-align: left; }
      canvas{ background: rgba(24,24,27,.96); border-radius: 18px; padding: 14px; border: 1px solid rgba(63,63,70,.85); box-shadow: var(--shadow); }

      /* Clique no painel → ecrã inteiro; «Diminuir» ou Esc para sair */
      .kpi-chart-panel--zoomable {
        position: relative;
        cursor: zoom-in;
      }
      .kpi-chart-panel--zoomable:fullscreen {
        cursor: default;
        background: #09090b;
        padding: 16px 18px 20px;
        display: flex !important;
        flex-direction: column;
        box-sizing: border-box;
        overflow: auto;
        height: 100% !important;
        max-height: none !important;
        min-height: 0 !important;
        z-index: 0;
      }
      .kpi-chart-panel--zoomable:-webkit-full-screen {
        background: #09090b;
        padding: 16px 18px 20px;
      }
      .kpi-chart-panel--zoomable:fullscreen canvas {
        flex: 1 1 auto;
        min-height: 0;
        max-height: none !important;
      }
      .kpi-chart-fs-exit {
        display: none;
        position: absolute;
        top: 10px;
        right: 10px;
        z-index: 6;
        align-items: center;
        gap: 6px;
        padding: 8px 14px;
        border-radius: 12px;
        border: 1px solid rgba(148,163,184,0.45);
        background: rgba(15,23,42,0.96);
        color: #e2e8f0;
        font-size: 0.8rem;
        font-weight: 800;
        font-family: inherit;
        cursor: pointer;
        box-shadow: 0 4px 16px rgba(0,0,0,0.35);
      }
      .kpi-chart-fs-exit:hover {
        border-color: rgba(45,212,191,0.75);
        color: #fff;
      }
      .kpi-chart-panel--zoomable:fullscreen .kpi-chart-fs-exit {
        display: inline-flex;
      }
      .kpi-chart-panel--zoomable:fullscreen > .label {
        padding-right: 120px;
      }

      /* Better visual for "Peso por setor" (progress-style rows) */
      .breakdown-card{
        margin-top: 16px;
        width: 100%;
        background: rgba(24,24,27,.96);
        border-radius: 16px;
        border: 1px solid rgba(63,63,70,.85);
        overflow: hidden;
        box-shadow: var(--shadow);
        padding: 14px 16px 16px;
      }
      .breakdown-list{
        display: grid;
        gap: 12px;
      }
      .breakdown-row{
        display: grid;
        /* Give the sector name enough width; otherwise it collapses to letters */
        grid-template-columns: minmax(150px, 2fr) minmax(120px, 2fr) auto;
        gap: 12px;
        align-items: center;
      }
      /* Carteira: listas zona/setor com fundo alternado */
      #tab-portfolio .breakdown-list .breakdown-row{
        padding: 8px 10px;
        margin: 0 -4px;
        border-radius: 10px;
      }
      #tab-portfolio .breakdown-list .breakdown-row:nth-child(odd){
        background: rgba(15,23,42,.35);
      }
      #tab-portfolio .breakdown-list .breakdown-row:nth-child(even){
        background: rgba(148,163,184,.1);
      }
      .breakdown-name{
        color: #ffffff;
        font-weight: 650;
        font-size: .78rem;
        min-width: 0;
        overflow: hidden;
        /* Allow 2-line display (better than always truncating) */
        white-space: normal;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow-wrap: anywhere;
        word-break: break-word;
      }
      .breakdown-bar{
        height: 10px;
        border-radius: 999px;
        background: #18181b;
        border: 1px solid rgba(63,63,70,.85);
        overflow: hidden;
      }
      .breakdown-bar-fill{
        height: 100%;
        width: 0%;
        background: linear-gradient(90deg, rgba(13,148,136,.95), rgba(45,212,191,.55));
      }
      .breakdown-value{
        color: #ffffff;
        font-weight: 850;
        font-size: .78rem;
        white-space: nowrap;
      }
      @media (max-width: 920px){
        .breakdown-row{ grid-template-columns: minmax(120px, 1.7fr) minmax(90px, 1.7fr) auto; }
      }
      /* Vista KPI simples vs técnico (body.decide-kpi-simple; botões só no iframe) */
      body.decide-kpi-simple .kpi-advanced-only { display: none !important; }
      .kpi-simple-only { display: none !important; }
      body.decide-kpi-simple .kpi-simple-only { display: block !important; }
      body.decide-kpi-simple .kpi-simple-only.kpi-simple-row {
        display: flex !important;
        flex-wrap: wrap;
        align-items: baseline;
        gap: 6px 10px;
      }
      /* 2 cartões (modelo + bench): metade cada; 3 cartões (comparativo extra / legado): 4+4+4 */
      body.decide-kpi-simple #tab-overview .grid:not(.grid-has-plafonada) > .card.kpi-main-compare {
        grid-column: span 6 !important;
      }
      body.decide-kpi-simple #tab-overview .grid.grid-has-plafonada > .card.kpi-main-compare {
        grid-column: span 4 !important;
      }
      @media (max-width: 920px){
        body.decide-kpi-simple #tab-overview .grid > .card.kpi-main-compare {
          grid-column: span 12 !important;
        }
      }
      .kpi-simple-summary {
        display: none;
        margin-top: 14px;
        margin-bottom: 4px;
        padding: 12px 14px;
        border-radius: 14px;
        border: 1px solid rgba(45,212,191,.28);
        background: rgba(15,23,42,.55);
        font-size: .78rem;
        line-height: 1.55;
        color: #d4d4d8;
      }
      body.decide-kpi-simple .kpi-simple-summary { display: block !important; }
      /* Cartão «Modelo teórico (raw)»: omitir em modo simples (definido pelo pai via ?kpi_view=). */
      body.decide-kpi-simple .kpi-card-raw-model { display: none !important; }
      .kpi-view-toggle-wrap {
        display: none;
        align-items: stretch;
        gap: 0;
        flex-wrap: nowrap;
        margin: 6px 0 10px;
        border-radius: 12px;
        border: 1px solid rgba(45,212,191,.38);
        overflow: hidden;
        background: rgba(15,23,42,.9);
        width: fit-content;
        max-width: 100%;
      }
      .kpi-view-btn{
        padding: 8px 16px;
        border-radius: 0;
        border: none;
        border-right: 1px solid rgba(45,212,191,.28);
        background: transparent;
        color: #94a3b8;
        font-size: .78rem;
        font-weight: 800;
        cursor: pointer;
        font-family: inherit;
      }
      .kpi-view-btn:last-child{ border-right: none; }
      .kpi-view-btn.active{
        color: #ecfdf5;
        background: rgba(13,148,136,.42);
        box-shadow: none;
      }
      /* Iframe cliente: começar no simulador — esconder meta técnica do topo em vista simples */
      body.decide-kpi-start-sim.decide-kpi-simple .topbar .brand .subtitle.csv-source-line { display: none !important; }
      body.decide-kpi-start-sim.decide-kpi-simple .controls .pill.profile-source-pill { display: none !important; }
      body.decide-kpi-start-sim .tab-nav-label { display: none; }
      /* Títulos gráficos: linguagem cliente vs técnica (só embed) */
      body.decide-kpi-simple .kpi-chart-title-advanced { display: none !important; }
      body:not(.decide-kpi-simple) .kpi-chart-title-simple { display: none !important; }
      body:not(.decide-kpi-embed) .kpi-chart-title-simple { display: none !important; }
      {% if client_embed %}
      /* Modo embutido: fundo alinhado ao painel Next (cinza muito escuro) */
      html{ background: #0c0c0e; }
      body.decide-kpi-embed{
        background: #0c0c0e !important;
      }
      /* Evita retângulo claro (canvas / slot) antes do Chart.js pintar — alinhado a .kpi-chart-panel canvas */
      body.decide-kpi-embed .kpi-chart-canvas-slot {
        background: rgba(39, 39, 42, 0.96);
        border-radius: 18px;
      }
      body.decide-kpi-embed .kpi-chart-panel--zoomable > canvas {
        background: rgba(39, 39, 42, 0.96) !important;
        border-radius: 18px;
      }
      body.decide-kpi-embed .topbar{
        display: none !important;
      }
      /* Só o hero CAGR (linha .value.positive); não afecta Max DD (.kpi-line.value). */
      body.decide-kpi-embed #tab-overview .card > .value.positive{
        font-size: clamp(1.62rem, 3.85vw, 2.22rem) !important;
        line-height: 1.15;
        letter-spacing: -0.02em;
      }
      body.decide-kpi-embed #tab-overview .card > .value.positive .muted{
        font-size: 0.82rem !important;
        color: #ecfdf5 !important;
        opacity: 0.95;
      }
      /* Modo embutido (dashboard Next): mais ar em torno dos cartões de modelos */
      .container{ max-width: 100%; padding: 14px 18px 36px; }
      .topbar{ position: relative; }
      .topbar-inner{ padding: 6px 12px; gap: 8px; }
      .brand{ min-width: 0; gap: 8px; }
      .subtitle{ font-size: .65rem; margin-top: 0; max-width: 100%; line-height: 1.25; }
      .controls{ gap: 6px 10px; }
      .control{ font-size: .7rem; gap: 6px; }
      select{ padding: 4px 10px; font-size: .82rem; }
      .tab-nav-label{ margin-bottom: 0; font-size: .66rem; }
      .tabs{ padding: 4px 0 6px; margin-top: 2px; margin-bottom: 2px; gap: 6px; }
      .tab{ padding: 6px 11px; font-size: .84rem; border-radius: 10px; border-width: 1px; }
      .tab.active{
        box-shadow: 0 2px 10px rgba(0,0,0,.4);
      }
      h2{ margin-top: 12px; margin-bottom: 6px; font-size: .92rem; }
      /* Grelha de cartões: mais gap para ler bem modelo / benchmark */
      .grid{ margin-top: 20px; gap: 16px; }
      .card{ padding: 14px 14px 16px; border-radius: 14px; }
      body.decide-kpi-embed .label{ font-size: .82rem !important; }
      body.decide-kpi-embed .kpi-card-profile-badge{
        font-weight: 700;
        color: #f4f4f5;
        white-space: nowrap;
      }
      .kpi-line{ margin-top: 5px; font-size: .98rem; }
      .tab-content{ padding-top: 14px; }
      body.decide-kpi-embed #tab-horizons .horizon-intro-one-line{
        overflow-x: auto !important;
        overflow-y: hidden !important;
      }
      body.decide-kpi-embed #tab-horizons .horizon-intro-inner{
        white-space: nowrap !important;
        width: max-content;
        max-width: none;
      }
      body.decide-kpi-embed #tab-horizons .horizon-intro-one-line.horizon-intro-embed{
        overflow-x: visible !important;
        overflow-y: visible !important;
      }
      body.decide-kpi-embed #tab-horizons .horizon-intro-embed-inner{
        white-space: normal !important;
        width: 100% !important;
        max-width: 100% !important;
      }
      .horizon-embed-story{
        margin: 0 0 14px;
        padding: 12px 14px;
        border-radius: 14px;
        border: 1px solid rgba(63,63,70,0.65);
        background: rgba(24,24,27,0.88);
        font-size: 0.88rem;
        line-height: 1.5;
        color: #e2e8f0;
      }
      .horizon-embed-tabbar{
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-bottom: 12px;
        align-items: center;
      }
      .horizon-embed-tab{
        border: 1px solid rgba(63,63,70,0.85);
        background: rgba(24,24,27,0.92);
        color: #94a3b8;
        border-radius: 999px;
        padding: 8px 14px;
        font-size: 0.78rem;
        font-weight: 800;
        cursor: pointer;
        font-family: inherit;
      }
      .horizon-embed-tab.active{
        border-color: rgba(82, 82, 91, 0.85);
        color: #e4e4e7;
        background: linear-gradient(165deg, rgba(63, 63, 70, 0.65) 0%, rgba(39, 39, 42, 0.92) 100%);
        box-shadow: 0 2px 12px rgba(0, 0, 0, 0.28);
      }
      body.decide-kpi-embed #tab-horizons .horizon-bench-composition{
        margin: -0.25rem 0 1rem;
        font-size: 0.78rem;
        line-height: 1.45;
        color: #94a3b8;
      }
      body.decide-kpi-embed #tab-horizons .horizon-embed-charts-row{
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
        gap: 8px 10px;
        align-items: stretch;
      }
      body.decide-kpi-embed #tab-horizons .horizon-embed-panel.chart-card{
        padding: 12px 12px 10px;
      }
      body.decide-kpi-embed #tab-horizons .horizon-pie-holder--equity,
      body.decide-kpi-embed #tab-horizons .horizon-pie-holder--dd{
        min-height: clamp(260px, 42vh, 460px);
        height: clamp(260px, 42vh, 460px);
        display: flex;
        flex-direction: column;
        min-width: 0;
      }
      body.decide-kpi-embed #tab-horizons .horizon-dd-chart-label{
        font-size: 0.72rem;
        font-weight: 700;
        color: #94a3b8;
        margin: 0 0 6px;
        letter-spacing: 0.02em;
      }
      body.decide-kpi-embed #tab-horizons .horizon-pie-holder--dd .horizon-dd-chart-label{
        flex-shrink: 0;
      }
      body.decide-kpi-embed #tab-horizons .horizon-pie-holder--dd canvas{
        flex: 1 1 auto;
        min-height: 0;
      }
      body.decide-kpi-embed #tab-horizons .horizon-pie-holder--equity canvas,
      body.decide-kpi-embed #tab-horizons .horizon-pie-holder--dd canvas{
        height: 100% !important;
        min-height: 0 !important;
        max-height: none !important;
        padding: 8px !important;
        border-radius: 12px !important;
      }
      @media (max-width: 760px) {
        body.decide-kpi-embed #tab-horizons .horizon-embed-charts-row{
          grid-template-columns: 1fr;
        }
        body.decide-kpi-embed #tab-horizons .horizon-pie-holder--equity,
        body.decide-kpi-embed #tab-horizons .horizon-pie-holder--dd{
          min-height: clamp(220px, 35vh, 360px);
          height: clamp(220px, 35vh, 360px);
        }
        body.decide-kpi-embed #tab-horizons .horizon-pie-holder--equity canvas,
        body.decide-kpi-embed #tab-horizons .horizon-pie-holder--dd canvas{
          height: 100% !important;
          min-height: 0 !important;
          max-height: none !important;
        }
      }
      body.decide-kpi-embed #tab-horizons .horizon-embed-stats-grid{
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 8px 10px;
        margin-bottom: 8px;
        align-items: stretch;
      }
      body.decide-kpi-embed #tab-horizons .horizon-embed-stats-grid .stat-box{
        grid-column: auto !important;
      }
      body.decide-kpi-embed #tab-horizons .horizon-embed-stat-box--model,
      body.decide-kpi-embed #tab-horizons .horizon-embed-stat-box--bench{
        padding: 10px 12px;
        border-radius: 12px;
      }
      body.decide-kpi-embed #tab-horizons .horizon-embed-stat-box--model .label,
      body.decide-kpi-embed #tab-horizons .horizon-embed-stat-box--bench .label{
        font-size: 0.74rem !important;
        margin-bottom: 2px;
      }
      body.decide-kpi-embed #tab-horizons .horizon-embed-metric{
        display: flex;
        justify-content: space-between;
        gap: 8px;
        font-size: 0.75rem;
        margin-top: 3px;
        line-height: 1.25;
      }
      body.decide-kpi-embed #tab-horizons .horizon-embed-metric .num{
        font-size: 0.9rem !important;
        margin-top: 0 !important;
      }
      body.decide-kpi-embed #tab-horizons .horizon-embed-metric-k{
        color: #94a3b8;
        font-weight: 600;
      }
      body.decide-kpi-embed #tab-horizons .horizon-diff-line--inst{
        font-size: 0.82rem;
        line-height: 1.35;
        color: #cbd5e1;
        margin: 2px 0 4px;
      }
      body.decide-kpi-embed #tab-horizons .horizon-diff-line{
        margin: 4px 0 6px;
        padding: 6px 8px;
        font-size: 0.76rem;
      }
      @media (max-width: 760px) {
        body.decide-kpi-embed #tab-horizons .horizon-embed-stats-grid{
          grid-template-columns: 1fr;
        }
      }
      .horizon-embed-tab .horizon-embed-pill{
        font-size: 0.62rem;
        font-weight: 900;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        color: #6ee7b7;
        margin-left: 4px;
      }
      .horizon-embed-panel{ display: none !important; }
      .horizon-embed-panel.active{ display: block !important; }
      .horizon-diff-line{
        margin: 8px 0 10px;
        padding: 8px 10px;
        border-radius: 10px;
        background: rgba(39, 39, 42, 0.75);
        border: 1px solid rgba(63, 63, 70, 0.55);
        font-size: 0.82rem;
        line-height: 1.45;
        color: #cbd5e1;
      }
      .horizon-diff-line strong.value.positive{ color: #6ee7b7 !important; font-size: 1.06rem; font-weight: 900; }
      .horizon-embed-cta{
        margin-top: 16px;
        padding: 12px 14px;
        border-radius: 12px;
        border: 1px solid rgba(82,82,91,0.55);
        background: rgba(24,24,27,0.65);
        font-size: 0.8rem;
        line-height: 1.5;
        color: #94a3b8;
      }
      /* Gráficos (aba «Gráficos»): 2×2 compacto — ou narrativa embed (primário + secundário em <details>) */
      #tab-charts .kpi-charts-inner--embed:not(.kpi-charts-inner--embed-narrative) {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 10px 12px;
        margin-top: 0.5rem;
      }
      #tab-charts .kpi-charts-inner--embed.kpi-charts-inner--embed-narrative,
      #tab-simulator .kpi-charts-inner--embed.kpi-charts-inner--embed-narrative {
        display: flex;
        flex-direction: column;
        gap: 22px;
        margin-top: 0.5rem;
      }
      #tab-charts .kpi-charts-primary-row,
      #tab-charts .kpi-charts-secondary-row {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 10px 12px;
        align-items: stretch;
      }
      /* Primário narrativo: cabeçalhos na linha 1, canvas na linha 2 — mesma altura de gráfico nas duas colunas */
      #tab-charts .kpi-charts-primary-sync {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        grid-template-rows: auto clamp(360px, 52vh, 620px);
        gap: 10px 12px;
        align-items: stretch;
        min-width: 0;
      }
      #tab-charts .kpi-charts-primary-sync .kpi-sync-body {
        min-height: 0;
        display: flex;
        flex-direction: column;
      }
      @media (max-width: 720px) {
        #tab-charts .kpi-charts-inner--embed:not(.kpi-charts-inner--embed-narrative) {
          grid-template-columns: 1fr;
        }
        #tab-charts .kpi-charts-primary-row,
        #tab-charts .kpi-charts-secondary-row {
          grid-template-columns: 1fr;
        }
        #tab-charts .kpi-charts-primary-sync {
          grid-template-columns: 1fr;
          grid-template-rows: auto auto clamp(300px, 38vh, 480px) clamp(300px, 38vh, 480px);
        }
      }
      /* Simulação (embed): aviso → simulador → prova (equity) → risco (DD) → CTA. Gráficos: análises complementares. */
      body.decide-kpi-embed #tab-charts .kpi-charts-embed-hero--minimal,
      body.decide-kpi-embed #tab-simulator .kpi-charts-embed-hero--minimal{
        margin: 0 0 12px;
        padding: 10px 14px;
        border-radius: 12px;
        border: 1px solid rgba(63,63,70,0.55);
        background: rgba(24,24,27,0.45);
      }
      body.decide-kpi-embed #tab-charts .kpi-charts-embed-hero--minimal .kpi-charts-embed-hero-compliance,
      body.decide-kpi-embed #tab-simulator .kpi-charts-embed-hero--minimal .kpi-charts-embed-hero-compliance{
        margin: 0;
        font-size: 0.72rem;
        line-height: 1.4;
      }
      body.decide-kpi-embed #tab-charts .kpi-charts-embed-summary {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 10px 12px;
        margin: 0 0 14px;
      }
      body.decide-kpi-embed #tab-charts .kpi-charts-embed-summary-card {
        border-radius: 12px;
        border: 1px solid rgba(63, 63, 70, 0.55);
        background: rgba(24, 24, 27, 0.55);
        padding: 12px 14px;
        min-width: 0;
      }
      body.decide-kpi-embed #tab-charts .kpi-charts-embed-summary-label {
        font-size: 0.72rem;
        font-weight: 600;
        letter-spacing: 0.02em;
        text-transform: uppercase;
        color: #94a3b8;
        margin-bottom: 6px;
      }
      body.decide-kpi-embed #tab-charts .kpi-charts-embed-summary-value {
        font-size: 1.15rem;
        font-weight: 700;
        color: #f1f5f9;
        letter-spacing: -0.02em;
      }
      body.decide-kpi-embed #tab-charts .kpi-charts-embed-summary-value--dd {
        color: #fca5a5;
      }
      body.decide-kpi-embed #tab-charts .kpi-dd-margin-toggle-wrap {
        margin: 0 0 8px;
      }
      body.decide-kpi-embed #tab-charts .kpi-dd-margin-toggle {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        font-size: 0.78rem;
        color: #cbd5e1;
        cursor: pointer;
        user-select: none;
      }
      body.decide-kpi-embed #tab-charts .kpi-dd-margin-toggle input {
        accent-color: #2dd4bf;
      }
      @media (max-width: 720px) {
        body.decide-kpi-embed #tab-charts .kpi-charts-embed-summary {
          grid-template-columns: 1fr;
        }
      }
      body.decide-kpi-embed #tab-simulator .kpi-charts-proof-block{
        margin: 0 0 4px;
      }
      body.decide-kpi-embed #tab-simulator .kpi-charts-proof-title{
        margin: 0 0 8px;
        font-size: clamp(1.02rem, 2.2vw, 1.22rem);
        font-weight: 800;
        letter-spacing: -0.02em;
        color: #f8fafc;
        line-height: 1.25;
      }
      body.decide-kpi-embed #tab-simulator .kpi-charts-proof-layout{
        display: flex;
        flex-direction: row;
        gap: 16px;
        align-items: stretch;
        min-width: 0;
      }
      body.decide-kpi-embed #tab-simulator .kpi-charts-proof-chart{
        flex: 1 1 min(0, 78%);
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 10px;
      }
      body.decide-kpi-embed #tab-simulator .kpi-charts-proof-aside{
        flex: 0 1 280px;
        min-width: 200px;
        max-width: 300px;
        display: flex;
        flex-direction: column;
        gap: 10px;
      }
      body.decide-kpi-embed #tab-simulator .kpi-proof-aside-card{
        border-radius: 12px;
        border: 1px solid rgba(63,63,70,0.65);
        background: rgba(39,39,42,0.55);
        padding: 14px 14px 12px;
      }
      body.decide-kpi-embed #tab-simulator .kpi-proof-aside-card > .label{
        font-size: 0.68rem;
        margin-bottom: 10px;
        color: #94a3b8;
      }
      body.decide-kpi-embed #tab-simulator .kpi-proof-aside-row{
        display: flex;
        flex-direction: column;
        gap: 4px;
        margin-bottom: 12px;
      }
      body.decide-kpi-embed #tab-simulator .kpi-proof-aside-row:last-of-type{ margin-bottom: 8px; }
      body.decide-kpi-embed #tab-simulator .kpi-proof-aside-row span{
        font-size: 0.72rem;
        color: #a1a1aa;
        font-weight: 600;
      }
      body.decide-kpi-embed #tab-simulator .kpi-proof-aside-row strong{
        font-size: clamp(1rem, 2.4vw, 1.25rem);
        font-weight: 800;
        font-variant-numeric: tabular-nums;
        color: #f4f4f5;
        letter-spacing: -0.02em;
      }
      body.decide-kpi-embed #tab-simulator .kpi-proof-aside-foot{
        margin: 0;
        font-size: 0.65rem;
        line-height: 1.4;
        color: #71717a;
      }
      body.decide-kpi-embed #tab-simulator .kpi-charts-proof-chart .kpi-chart-canvas-slot{
        width: 100%;
        height: clamp(420px, 60vh, 720px);
        min-height: 360px;
        position: relative;
        flex: 0 0 auto;
      }
      body.decide-kpi-embed #tab-simulator .kpi-charts-proof-chart .kpi-chart-canvas-slot canvas{
        position: absolute !important;
        left: 0;
        top: 0;
        width: 100% !important;
        height: 100% !important;
        max-height: none !important;
      }
      /* Aba Simulação (embed): simulador → performance (largura total + valores) → risco (DD) → CTA */
      body.decide-kpi-embed #tab-simulator .kpi-charts-proof-layout--stack{
        flex-direction: column;
        gap: 14px;
        align-items: stretch;
      }
      body.decide-kpi-embed #tab-simulator .kpi-charts-proof-layout--stack .kpi-charts-proof-chart{
        flex: 0 0 auto;
        width: 100%;
      }
      body.decide-kpi-embed #tab-simulator .kpi-charts-proof-aside--below{
        flex: none;
        width: 100%;
        max-width: none;
        min-width: 0;
      }
      body.decide-kpi-embed #tab-simulator .kpi-charts-proof-layout--stack .kpi-charts-proof-chart .kpi-chart-canvas-slot{
        height: clamp(340px, min(70vh, 780px), 880px);
        min-height: min(62vh, 480px);
      }
      body.decide-kpi-embed #tab-simulator .kpi-charts-proof-aside--below .kpi-proof-aside-card{
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 0 18px;
        align-items: start;
      }
      body.decide-kpi-embed #tab-simulator .kpi-charts-proof-aside--below .kpi-proof-aside-card > .label{
        grid-column: 1 / -1;
      }
      body.decide-kpi-embed #tab-simulator .kpi-charts-proof-aside--below .kpi-proof-aside-foot{
        grid-column: 1 / -1;
      }
      body.decide-kpi-embed #tab-simulator .kpi-charts-proof-aside--below .kpi-chart-equity-badge{
        grid-column: 1 / -1;
      }
      body.decide-kpi-embed #tab-simulator .kpi-charts-proof-aside--below .kpi-proof-aside-row strong{
        font-size: clamp(1.12rem, 3.2vw, 1.45rem);
      }
      @media (max-width: 560px) {
        body.decide-kpi-embed #tab-simulator .kpi-charts-proof-aside--below .kpi-proof-aside-card{
          grid-template-columns: 1fr;
        }
      }
      body.decide-kpi-embed #tab-simulator .kpi-charts-inner--embed-narrative > .kpi-charts-simulator-embed:first-child{
        margin-top: 0;
        padding-top: 0;
        border-top: none;
      }
      body.decide-kpi-embed #tab-simulator .kpi-charts-simulator-embed + .kpi-charts-proof-block{
        margin-top: 28px;
        padding-top: 22px;
        border-top: 1px solid rgba(63,63,70,0.5);
      }
      body.decide-kpi-embed #tab-simulator .kpi-charts-simulator-embed .sim-client-narrative-card{
        margin-top: 0;
      }
      body.decide-kpi-embed #tab-simulator .kpi-charts-risk-block{
        margin-top: 28px;
        padding-top: 22px;
        border-top: 1px solid rgba(63,63,70,0.5);
      }
      body.decide-kpi-embed #tab-simulator .kpi-charts-risk-block .kpi-chart-panel--meta{
        margin-bottom: 8px;
      }
      body.decide-kpi-embed #tab-simulator .kpi-charts-risk-block .kpi-chart-canvas-slot{
        width: 100%;
        height: clamp(168px, 24vh, 280px);
        min-height: 150px;
        position: relative;
      }
      body.decide-kpi-embed #tab-simulator .kpi-charts-risk-block .kpi-chart-canvas-slot canvas{
        position: absolute !important;
        left: 0;
        top: 0;
        width: 100% !important;
        height: 100% !important;
        max-height: none !important;
      }
      body.decide-kpi-embed #tab-simulator .kpi-charts-embed-cta{
        margin: 20px 0 8px;
        padding: 18px 16px 16px;
        border-radius: 12px;
        border: 1px solid rgba(63,63,70,0.45);
        background: rgba(24,24,27,0.58);
        text-align: center;
      }
      body.decide-kpi-embed #tab-simulator .kpi-charts-embed-cta-kicker{
        margin: 0 0 6px;
        font-size: 0.62rem;
        font-weight: 800;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: #71717a;
      }
      body.decide-kpi-embed #tab-simulator .kpi-charts-embed-cta-micro{
        margin: 0 0 14px;
        font-size: 0.8rem;
        line-height: 1.45;
        color: #94a3b8;
      }
      body.decide-kpi-embed #tab-simulator .kpi-charts-embed-cta-primary{
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: 11px 20px;
        border-radius: 10px;
        font-size: 0.88rem;
        font-weight: 700;
        color: #ecfdf5;
        background: #115e59;
        border: 1px solid rgba(63,63,70,0.55);
        text-decoration: none;
      }
      body.decide-kpi-embed #tab-simulator .kpi-charts-embed-cta-secondary{
        color: #5eead4;
        font-weight: 600;
        text-decoration: underline;
        font-size: 0.78rem;
      }
      body.decide-kpi-embed #tab-simulator .sim-delta-line.sim-delta-line--institutional,
      body.decide-kpi-embed #tab-simulator .kpi-charts-simulator-embed .sim-delta-line.sim-delta-line--institutional{
        font-size: 0.78rem !important;
        font-weight: 500 !important;
        color: #94a3b8 !important;
        padding: 10px 12px !important;
        letter-spacing: 0 !important;
        line-height: 1.5 !important;
        background: rgba(24,24,27,0.48) !important;
        border: 1px solid rgba(63,63,70,0.32) !important;
      }
      body.decide-kpi-embed #tab-simulator .sim-results-hero .sim-hero-card,
      body.decide-kpi-embed #tab-simulator .kpi-charts-simulator-embed .sim-results-hero .sim-hero-card{
        opacity: 0.9;
      }
      body.decide-kpi-embed #tab-simulator .sim-big-value,
      body.decide-kpi-embed #tab-simulator .kpi-charts-simulator-embed .sim-big-value{
        opacity: 0.88;
      }
      @media (max-width: 900px) {
        body.decide-kpi-embed #tab-simulator .kpi-charts-proof-layout{
          flex-direction: column;
        }
        body.decide-kpi-embed #tab-simulator .kpi-charts-proof-aside{
          max-width: none;
          flex: 1 1 auto;
        }
      }
      .kpi-charts-embed-hero{
        margin: 0 0 12px;
        padding: 14px 16px;
        border-radius: 14px;
        border: 1px solid rgba(45,212,191,0.38);
        background: linear-gradient(165deg, rgba(13,148,136,0.16) 0%, rgba(24,24,27,0.75) 100%);
        color: #e2e8f0;
      }
      .kpi-charts-embed-version-pill{
        display: inline-block;
        font-size: 0.62rem;
        font-weight: 900;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: #6ee7b7;
        border: 1px solid rgba(45,212,191,0.45);
        border-radius: 999px;
        padding: 4px 10px;
        margin-bottom: 10px;
        background: rgba(13,148,136,0.2);
      }
      .kpi-charts-embed-hero-title{
        margin: 0 0 10px;
        font-size: 1rem;
        font-weight: 800;
        letter-spacing: -0.02em;
        color: #f8fafc;
      }
      .kpi-charts-embed-hero-body{
        margin: 0 0 10px;
        font-size: 0.88rem;
        line-height: 1.55;
        color: #e2e8f0;
      }
      .kpi-charts-embed-hero-compliance{
        margin: 0 0 12px;
        font-size: 0.76rem;
        line-height: 1.45;
        color: #94a3b8;
      }
      .kpi-charts-embed-subtext{
        margin: 0;
        padding-top: 12px;
        border-top: 1px solid rgba(63,63,70,0.65);
        font-size: 0.8rem;
        line-height: 1.5;
        color: #cbd5e1;
      }
      .kpi-chart-equity-legend{
        margin: 0 0 8px;
        font-size: 0.68rem;
        line-height: 1.35;
        color: #94a3b8;
        width: 100%;
        max-width: none;
        white-space: nowrap;
        overflow-x: auto;
        overflow-y: hidden;
        -webkit-overflow-scrolling: touch;
      }
      .kpi-chart-equity-badge{
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 8px 12px;
        margin: 4px 0 8px;
        padding: 8px 10px;
        border-radius: 10px;
        background: rgba(39, 39, 42, 0.82);
        border: 1px solid rgba(63, 63, 70, 0.55);
        font-size: 0.78rem;
        color: #cbd5e1;
      }
      .kpi-chart-equity-badge strong{ color: #6ee7b7; font-size: 0.95rem; }
      .kpi-chart-equity-badge-pill{
        display: inline-flex;
        align-items: center;
        padding: 3px 8px;
        border-radius: 999px;
        font-size: 0.68rem;
        font-weight: 900;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        background: rgba(22,101,52,0.45);
        border: 1px solid rgba(74,222,128,0.45);
        color: #bbf7d0;
      }
      .kpi-chart-dd-meta-card.kpi-chart-equity-badge{
        display: block;
        align-items: stretch;
      }
      .kpi-chart-dd-meta-card .kpi-chart-dd-caption{
        margin: 0;
      }
      .kpi-chart-dd-caption{
        font-size: 0.72rem;
        line-height: 1.5;
        color: #94a3b8;
        margin: 0 0 8px;
        width: 100%;
        max-width: none;
      }
      .kpi-chart-alpha-hint{
        font-size: 0.72rem;
        line-height: 1.45;
        color: #94a3b8;
        margin: 0 0 8px;
        max-width: 52ch;
      }
      .kpi-charts-embed-more{
        border-radius: 12px;
        border: 1px solid rgba(63,63,70,0.75);
        background: rgba(24,24,27,0.35);
        padding: 0 10px 10px;
      }
      .kpi-charts-embed-more summary{
        list-style: none;
        cursor: pointer;
        padding: 10px 4px;
        font-size: 0.8rem;
        font-weight: 800;
        color: #5eead4;
      }
      .kpi-charts-embed-more summary::-webkit-details-marker{ display: none; }
      .kpi-charts-embed-footer{
        margin-top: 4px;
        padding: 12px 14px;
        border-radius: 12px;
        border: 1px solid rgba(82,82,91,0.55);
        background: rgba(24,24,27,0.55);
        font-size: 0.8rem;
        line-height: 1.5;
        color: #94a3b8;
      }
      body.decide-kpi-embed #tab-charts .kpi-chart-panel,
      body.decide-kpi-embed #tab-simulator .kpi-chart-panel {
        position: relative;
        height: clamp(232px, 30vh, 288px);
        min-height: 0;
        display: flex;
        flex-direction: column;
      }
      body.decide-kpi-embed #tab-charts .kpi-chart-panel--meta,
      body.decide-kpi-embed #tab-simulator .kpi-chart-panel--meta {
        height: auto;
        min-height: 0;
        align-self: stretch;
      }
      body.decide-kpi-embed #tab-charts .kpi-charts-primary-sync .kpi-chart-panel--chartBlock {
        height: 100%;
        min-height: 0;
        flex: 1 1 auto;
        align-self: stretch;
      }
      /* Linha principal (equity + drawdown): altura explícita — evita ciclo Chart.js (responsive + maintainAspectRatio:false) com pai height:auto. */
      body.decide-kpi-embed #tab-charts .kpi-charts-primary-row .kpi-chart-panel {
        height: clamp(380px, 52vh, 560px);
        min-height: 0;
        min-width: 0;
        max-height: clamp(380px, 52vh, 560px);
        align-self: stretch;
        flex-shrink: 0;
      }
      @media (max-width: 720px) {
        body.decide-kpi-embed #tab-charts .kpi-charts-primary-row .kpi-chart-panel {
          height: clamp(300px, 42vh, 460px);
          max-height: clamp(300px, 42vh, 460px);
        }
      }
      body.decide-kpi-embed #tab-charts .kpi-charts-primary-row {
        width: 100%;
        max-width: 100%;
        min-width: 0;
        margin-left: 0;
        margin-right: 0;
      }
      body.decide-kpi-embed #tab-charts .kpi-charts-primary-row .kpi-chart-canvas-slot {
        width: 100%;
        height: clamp(460px, 58vh, 720px);
        min-height: 420px;
        position: relative;
        flex: 0 0 auto;
      }
      /* Log + DD no embed: canvas dentro de slot com posição absoluta — Chart.js mede mal se o canvas for só flex-item sem caixa explícita. */
      body.decide-kpi-embed #tab-charts .kpi-charts-primary-row .kpi-chart-canvas-slot--embed-primary {
        flex: 1 1 auto;
        min-width: 0;
        width: 100%;
        position: relative;
        height: auto !important;
        min-height: 140px;
      }
      body.decide-kpi-embed #tab-charts .kpi-charts-primary-row .kpi-chart-panel--zoomable .kpi-chart-canvas-slot--embed-primary > canvas {
        position: absolute !important;
        left: 0;
        top: 0;
        width: 100% !important;
        height: 100% !important;
        max-height: none !important;
        flex: none !important;
      }
      body.decide-kpi-embed #tab-charts .kpi-charts-primary-sync .kpi-chart-canvas-slot {
        width: 100%;
        flex: 1 1 auto;
        min-height: 0;
        height: 100%;
        position: relative;
      }
      @media (max-width: 1100px) {
        .kpi-chart-equity-legend{
          white-space: normal;
        }
      }
      body.decide-kpi-embed #tab-charts .kpi-charts-primary-row .kpi-chart-canvas-slot canvas,
      body.decide-kpi-embed #tab-charts .kpi-charts-primary-sync .kpi-chart-canvas-slot canvas {
        position: absolute !important;
        left: 0;
        top: 0;
        width: 100% !important;
        height: 100% !important;
        max-height: none !important;
      }
      body.decide-kpi-embed #tab-charts .kpi-chart-panel .label,
      body.decide-kpi-embed #tab-simulator .kpi-chart-panel .label {
        font-size: 0.68rem;
        flex-shrink: 0;
      }
      body.decide-kpi-embed #tab-charts .kpi-chart-panel canvas,
      body.decide-kpi-embed #tab-simulator .kpi-chart-panel canvas {
        flex: 1 1 auto;
        min-height: 0;
        max-height: 100%;
      }
      /* Simulador: evolução + drawdown lado a lado (mesma altura de plot) */
      #tab-simulator .sim-charts-sync,
      #tab-simulator .kpi-charts-simulator-embed .sim-charts-sync{
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        grid-template-rows: auto clamp(260px, 36vh, 480px);
        gap: 10px 12px;
        align-items: stretch;
        min-width: 0;
        margin-top: 0.75rem;
      }
      #tab-simulator .sim-charts-sync .sim-sync-body,
      #tab-simulator .kpi-charts-simulator-embed .sim-charts-sync .sim-sync-body{
        min-height: 0;
        display: flex;
        flex-direction: column;
      }
      #tab-simulator .sim-charts-sync .kpi-chart-panel--chartBlock,
      #tab-simulator .kpi-charts-simulator-embed .sim-charts-sync .kpi-chart-panel--chartBlock{
        display: flex;
        flex-direction: column;
        min-height: 0;
        height: 100%;
      }
      #tab-simulator .sim-charts-sync .kpi-chart-canvas-slot,
      #tab-simulator .kpi-charts-simulator-embed .sim-charts-sync .kpi-chart-canvas-slot{
        width: 100%;
        flex: 1 1 auto;
        min-height: 0;
        height: 100%;
        position: relative;
      }
      @media (max-width: 720px) {
        #tab-simulator .sim-charts-sync,
        #tab-simulator .kpi-charts-simulator-embed .sim-charts-sync{
          grid-template-columns: 1fr;
          grid-template-rows: auto auto clamp(220px, 34vh, 420px) auto auto clamp(220px, 34vh, 420px);
        }
      }
      body.decide-kpi-embed #tab-simulator .kpi-chart-panel--meta,
      body.decide-kpi-embed #tab-simulator .kpi-charts-simulator-embed .kpi-chart-panel--meta{
        height: auto;
        min-height: 0;
        align-self: stretch;
      }
      body.decide-kpi-embed #tab-simulator .sim-charts-sync .kpi-chart-panel--chartBlock,
      body.decide-kpi-embed #tab-simulator .kpi-charts-simulator-embed .sim-charts-sync .kpi-chart-panel--chartBlock{
        height: 100%;
        min-height: 0;
        flex: 1 1 auto;
        align-self: stretch;
      }
      body.decide-kpi-embed #tab-simulator .sim-charts-sync .kpi-chart-canvas-slot canvas,
      body.decide-kpi-embed #tab-simulator .kpi-charts-simulator-embed .sim-charts-sync .kpi-chart-canvas-slot canvas{
        position: absolute !important;
        left: 0;
        top: 0;
        width: 100% !important;
        height: 100% !important;
        max-height: none !important;
      }
      /* Simulação (embed): mockup — valor em destaque, gráficos empilhados, CTA à direita */
      body.decide-kpi-embed #tab-simulator .sim-embed-legacy-hooks{
        display: none !important;
      }
      body.decide-kpi-embed #tab-simulator .sim-embed-simulation-card .sim-headline{
        font-size: clamp(1.08rem, 2.5vw, 1.35rem) !important;
        font-weight: 700 !important;
        letter-spacing: -0.02em;
      }
      body.decide-kpi-embed #tab-simulator .sim-embed-lead{
        margin: 0.35rem 0 0 !important;
        font-size: 0.84rem !important;
        line-height: 1.5 !important;
        color: #94a3b8 !important;
        font-weight: 500 !important;
      }
      body.decide-kpi-embed #tab-simulator .sim-embed-row-actions{
        flex-wrap: wrap !important;
        align-items: flex-end !important;
        gap: 14px 20px !important;
        margin-top: 1rem !important;
      }
      body.decide-kpi-embed #tab-simulator .sim-embed-hero-block > .label{
        color: #71717a !important;
        font-size: 0.7rem !important;
        font-weight: 600 !important;
        letter-spacing: 0.04em;
        margin-bottom: 2px !important;
      }
      body.decide-kpi-embed #tab-simulator .sim-embed-model-total{
        font-size: clamp(2.95rem, 8.5vw, 4.55rem) !important;
        font-weight: 800 !important;
        color: #4ade80 !important;
        letter-spacing: -0.038em;
        line-height: 1.02;
        margin-top: 14px !important;
        margin-bottom: 6px !important;
        text-shadow: 0 0 36px rgba(74, 222, 128, 0.26), 0 0 1px rgba(74, 222, 128, 0.45), 0 2px 0 rgba(0, 0, 0, 0.35);
      }
      body.decide-kpi-embed #tab-simulator .sim-embed-bench-inline{
        margin-top: 18px;
        padding-top: 12px;
        border-top: 1px solid rgba(63,63,70,0.55);
      }
      body.decide-kpi-embed #tab-simulator .sim-embed-bench-inline > .label{
        display: block;
        font-size: 0.74rem;
        color: #9ca3af;
        margin-bottom: 6px;
      }
      body.decide-kpi-embed #tab-simulator .sim-embed-bench-value{
        font-size: clamp(1.22rem, 3.4vw, 1.62rem) !important;
        font-weight: 700 !important;
        color: #e4e4e7 !important;
      }
      body.decide-kpi-embed #tab-simulator .sim-embed-bench-value.sim-big-value-margin{
        color: #fb923c !important;
      }
      body.decide-kpi-embed #tab-simulator .sim-embed-body-grid{
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(280px, 380px);
        gap: 16px 24px;
        align-items: stretch;
        margin-top: 0;
      }
      body.decide-kpi-embed #tab-simulator .sim-embed-main-col{
        display: flex;
        flex-direction: column;
        gap: 0;
        min-width: 0;
        align-self: start;
      }
      body.decide-kpi-embed #tab-simulator .sim-embed-hero-block{
        margin-bottom: 0;
      }
      body.decide-kpi-embed #tab-simulator .sim-embed-cta-aside{
        display: flex;
        flex-direction: column;
        min-height: 0;
        min-width: 0;
      }
      @media (max-width: 900px) {
        body.decide-kpi-embed #tab-simulator .sim-embed-body-grid{
          grid-template-columns: 1fr;
        }
        body.decide-kpi-embed #tab-simulator .sim-embed-cta-aside{
          width: 100%;
        }
      }
      body.decide-kpi-embed #tab-simulator .sim-embed-short-disclaimer{
        color: #64748b !important;
        font-size: 0.72rem !important;
      }
      body.decide-kpi-embed #tab-simulator .sim-embed-chart-bridge{
        margin: 0 0 20px;
        padding-top: 4px;
        font-size: 0.84rem;
        line-height: 1.55;
        font-weight: 600;
        color: #cbd5e1;
      }
      body.decide-kpi-embed #tab-simulator .sim-embed-chart-head .muted.kpi-chart-title-simple{
        color: #64748b !important;
        font-size: 0.68rem !important;
        font-weight: 500 !important;
      }
      body.decide-kpi-embed #tab-simulator .sim-embed-dd-hint{
        color: #64748b !important;
        font-size: 0.72rem !important;
      }
      body.decide-kpi-embed #tab-simulator .sim-embed-chart-section{
        margin-bottom: 18px;
      }
      body.decide-kpi-embed #tab-simulator .sim-embed-chart-section:last-of-type{
        margin-bottom: 0;
      }
      /* Chart.js responsive + maintainAspectRatio:false: não herdar o clamp global de .kpi-chart-panel (232–288px) — esmagava o slot alto e podia cortar o 2.º gráfico (DD). */
      body.decide-kpi-embed #tab-simulator #simResults .sim-embed-chart-section .kpi-chart-panel.kpi-chart-panel--chartBlock{
        height: auto !important;
        max-height: none !important;
        min-height: 0;
      }
      body.decide-kpi-embed #tab-simulator .sim-embed-charts-col{
        max-width: calc(100% - 20px);
        width: 100%;
        margin-right: auto;
        margin-top: 16px;
        padding-top: 6px;
      }
      body.decide-kpi-embed #tab-simulator .sim-embed-canvas-slot{
        width: 100%;
        height: clamp(360px, 52vh, 620px);
        min-height: 320px;
        position: relative;
      }
      body.decide-kpi-embed #tab-simulator .sim-embed-canvas-slot canvas{
        position: absolute !important;
        left: 0;
        top: 0;
        width: 100% !important;
        height: 100% !important;
      }
      body.decide-kpi-embed #tab-simulator .sim-embed-cta-inner{
        flex: 1 1 auto;
        display: flex;
        flex-direction: column;
        justify-content: flex-start;
        align-items: stretch;
        box-sizing: border-box;
        min-height: 100%;
        padding: clamp(16px, 2.5vh, 24px) clamp(18px, 2.5vw, 26px) clamp(20px, 3vh, 28px);
        border-radius: 14px;
        border: 1px solid rgba(63,63,70,0.55);
        background: rgba(39,39,42,0.72);
        text-align: center;
      }
      body.decide-kpi-embed #tab-simulator .sim-embed-cta-inner > p:last-child{
        margin-top: auto;
        padding-top: 12px;
      }
      body.decide-kpi-embed #tab-simulator .sim-embed-cta-inner .kpi-charts-embed-cta-kicker{
        font-size: 0.68rem;
        margin-bottom: 8px;
      }
      body.decide-kpi-embed #tab-simulator .sim-embed-cta-inner .kpi-charts-embed-cta-micro{
        font-size: 0.84rem;
      }
      body.decide-kpi-embed #tab-simulator #chartsEmbedCtaLink.sim-embed-cta-plano{
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 100%;
        box-sizing: border-box;
        margin-top: 6px;
        padding: clamp(14px, 2.2vh, 18px) clamp(18px, 2vw, 22px);
        border-radius: 12px;
        font-size: clamp(0.92rem, 1.1vw, 1.02rem);
        font-weight: 700;
        color: #fffbeb;
        background: linear-gradient(165deg, #ea580c 0%, #c2410c 55%, #9a3412 100%);
        border: 1px solid rgba(254, 215, 170, 0.35);
        text-decoration: none;
        box-shadow: 0 4px 14px rgba(234, 88, 12, 0.28);
      }
      body.decide-kpi-embed #tab-simulator #chartsEmbedCtaLink.sim-embed-cta-plano:hover{
        filter: brightness(1.06);
      }
      /* Zinc neutro: substitui gradientes slate/azul (#0f172a, rgba(12,22,41)) no iframe */
      body.decide-kpi-embed .card{
        background: linear-gradient(145deg, rgba(39,39,42,.98) 0%, rgba(24,24,27,.98) 100%) !important;
      }
      /* Destaque sem scale: o scale(1.07) empurrava o CTA para fora da área útil / cortava no iframe */
      body.decide-kpi-embed #tab-overview .card.kpi-card-recommended{
        position: relative;
        background: linear-gradient(155deg, rgba(24, 39, 42, 0.98) 0%, rgba(15, 30, 32, 0.99) 45%, rgba(9, 9, 11, 0.98) 100%) !important;
        border: 1px solid rgba(82, 82, 91, 0.55) !important;
        box-shadow:
          0 0 0 1px rgba(255, 255, 255, 0.04),
          0 12px 32px rgba(0, 0, 0, 0.42) !important;
        z-index: 3;
      }
      body.decide-kpi-embed #tab-overview .grid{
        overflow: visible !important;
        padding-bottom: 48px;
      }
      body.decide-kpi-embed #tab-overview{
        overflow: visible !important;
        padding-bottom: 20px;
      }
      /* Cartões não recomendados: menos peso visual (hierarquia) */
      body.decide-kpi-embed #tab-overview .grid > .card:not(.kpi-card-recommended){
        border-color: rgba(63, 63, 70, 0.45) !important;
        background: linear-gradient(145deg, rgba(39, 39, 42, 0.82) 0%, rgba(24, 24, 27, 0.9) 100%) !important;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.22) !important;
      }
      body.decide-kpi-embed #tab-overview .grid > .card .label{
        color: #f4f4f5 !important;
      }
      body.decide-kpi-embed #tab-overview .grid > .card.kpi-card-raw-model .kpi-line{
        color: #eceef2 !important;
      }
      body.decide-kpi-embed #tab-overview .grid > .card.kpi-main-compare .kpi-line{
        color: #fafafa !important;
      }
      body.decide-kpi-embed #tab-overview .grid > .card.kpi-main-compare .kpi-line.value.negative{
        color: #fafafa !important;
      }
      body.decide-kpi-embed #tab-overview .grid > .card .muted{
        color: #d4d4d8 !important;
      }
      body.decide-kpi-embed #tab-overview .grid > .card .kpi-card-total-return{
        color: #fafafa !important;
        font-size: 1.02rem !important;
        font-weight: 650 !important;
      }
      body.decide-kpi-embed #tab-overview .grid > .card .kpi-hedge-under-metrics .kpi-card-total-return{
        font-size: 0.94rem !important;
      }
      body.decide-kpi-embed #tab-overview .stats-grid.kpi-monthly-model-stats .stat-box .label{
        font-size: 0.88rem !important;
        color: #f0f0f1 !important;
      }
      body.decide-kpi-embed #tab-overview .stats-grid.kpi-monthly-model-stats .stat-box .num{
        font-size: 1.28rem !important;
      }
      body.decide-kpi-embed #tab-overview .card .kpi-cagr-hint{
        color: #e4e4e7 !important;
      }
      body.decide-kpi-embed #tab-overview .card .kpi-cap15-micro-hint{
        color: #d4d4d8 !important;
      }
      body.decide-kpi-embed #tab-overview .card .kpi-cap15-costs-hint{
        color: #eceef2 !important;
      }
      .kpi-recommended-pill{
        display: inline-flex;
        align-items: center;
        gap: 6px;
        font-size: 0.68rem;
        font-weight: 800;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        color: #e4e4e7;
        background: linear-gradient(165deg, rgba(63,63,70,0.65) 0%, rgba(39,39,42,0.92) 100%);
        border: 1px solid rgba(63,63,70,0.75);
        border-radius: 999px;
        padding: 5px 10px;
        margin-bottom: 8px;
        box-shadow: 0 1px 4px rgba(0,0,0,0.3);
      }
      .kpi-embed-plan-cta-wrap{
        margin-top: auto;
        padding-top: 12px;
        border-top: 1px solid rgba(63,63,70,0.55);
      }
      .kpi-embed-plan-cta{
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 100%;
        box-sizing: border-box;
        padding: 11px 14px;
        border-radius: 11px;
        font-size: 0.8rem;
        font-weight: 900;
        text-decoration: none !important;
        text-align: center;
        color: #0f172a !important;
        background: linear-gradient(165deg, #fdba74 0%, #fb923c 40%, #ea580c 100%);
        border: 1px solid rgba(249,115,22,0.55);
        box-shadow: 0 2px 10px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.25);
      }
      .kpi-embed-plan-cta:hover{ filter: brightness(1.06); }
      .kpi-embed-hedge-banner{
        margin: 2px 0 14px;
        padding: 10px 12px;
        border-radius: 10px;
        border: 1px solid rgba(63, 63, 70, 0.55);
        background: linear-gradient(165deg, rgba(39, 39, 42, 0.88) 0%, rgba(24, 24, 27, 0.96) 100%);
        font-size: 0.76rem;
        line-height: 1.48;
        color: #94a3b8;
        box-shadow: none;
      }
      .kpi-embed-hedge-banner strong{ color: #2dd4bf; font-weight: 700; }
      .kpi-embed-hedge-banner .kpi-embed-hedge-numbers{
        margin-top: 8px;
        padding-top: 8px;
        border-top: 1px solid rgba(45,212,191,0.16);
        display: flex;
        flex-wrap: wrap;
        align-items: baseline;
        gap: 6px 12px;
        font-size: 0.8rem;
      }
      .kpi-embed-hedge-banner .kpi-embed-hedge-numbers .hedge-cagr-big{
        font-size: 1.02rem;
        font-weight: 800;
        color: #5eead4;
        letter-spacing: -0.02em;
        opacity: 0.92;
      }
      .kpi-embed-hedge-banner .hedge-muted{ color: #94a3b8; font-size: 0.72rem; }
      .kpi-embed-hedge-banner .kpi-embed-hedge-numbers .hedge-muted{ font-size: 0.74rem; }
      .kpi-card-details{
        margin-top: 10px;
        padding-top: 8px;
        border-top: 1px solid rgba(63,63,70,0.55);
      }
      .kpi-card-details summary{
        cursor: pointer;
        list-style: none;
        font-size: 0.84rem;
        font-weight: 800;
        color: #5eead4;
        display: inline-flex;
        align-items: center;
        gap: 6px;
      }
      .kpi-card-details summary::-webkit-details-marker{ display: none; }
      .kpi-card-details .kpi-card-details-body{
        margin-top: 8px;
        font-size: 0.9rem;
        line-height: 1.5;
        color: #d4d4d8;
      }
      .kpi-bench-vs-rec{
        margin-top: 10px;
        padding: 10px 11px;
        border-radius: 12px;
        background: rgba(24,24,27,0.72);
        border: 1px solid rgba(63,63,70,0.5);
        font-size: 0.88rem;
        line-height: 1.55;
        color: #d4d4d8;
      }
      .kpi-comparativo-pill{
        display: inline-flex;
        align-items: center;
        margin-bottom: 6px;
        padding: 3px 10px;
        border-radius: 999px;
        font-size: 0.62rem;
        font-weight: 900;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: #e4e4e7;
        background: rgba(39,39,42,0.95);
        border: 1px solid rgba(113,113,122,0.55);
      }
      .kpi-bench-vs-rec-body{ display: block; margin: 0; color: #e8eaed; }
      .kpi-bench-vs-rec strong{ color: #fde68a; }
      body.decide-kpi-embed #tab-overview .card.kpi-card-benchmark-ref{
        border-color: rgba(113,113,122,0.55) !important;
        background: linear-gradient(145deg, rgba(39,39,42,.88) 0%, rgba(24,24,27,.95) 100%) !important;
      }
      body.decide-kpi-embed .kpi-hedge-embed-fallback{
        margin-top: 8px;
        padding-top: 8px;
        border-top: 1px solid rgba(45,212,191,0.22);
      }
      body.decide-kpi-embed .kpi-hedge-fallback-note{
        font-size: 0.72rem !important;
        line-height: 1.45 !important;
        margin: 0 !important;
      }
      /* Bloco hedged logo abaixo do cartão correspondente: métricas muito pequenas; notas legíveis */
      body.decide-kpi-embed .kpi-hedge-under{
        margin-top: 8px;
        padding-top: 8px;
        border-top: 1px solid rgba(45,212,191,0.3);
      }
      body.decide-kpi-embed .kpi-hedge-under-title{
        font-size: 0.72rem;
        font-weight: 800;
        color: #5eead4;
        margin-bottom: 6px;
        letter-spacing: 0.03em;
      }
      body.decide-kpi-embed .kpi-hedge-under .kpi-hedge-under-value{
        font-size: 1.12rem !important;
        margin-top: 4px !important;
        line-height: 1.25 !important;
      }
      body.decide-kpi-embed .kpi-hedge-under .kpi-hedge-under-cagr{
        font-size: 0.72rem !important;
      }
      /* Cartões da grelha com mesma altura de linha: bloco «Com hedge» alinhado na base entre colunas */
      body.decide-kpi-embed #tab-overview .grid > .card{
        display: flex;
        flex-direction: column;
        height: 100%;
        min-height: 0;
        box-sizing: border-box;
      }
      body.decide-kpi-embed #tab-overview .grid > .card .kpi-hedge-under{
        margin-top: auto;
      }
      body.decide-kpi-embed #tab-overview .grid > .card.kpi-card-benchmark-ref .kpi-bench-vs-rec{
        margin-top: auto;
      }
      body.decide-kpi-embed #tab-overview .grid > .card.kpi-card-raw-model > .kpi-card-details{
        margin-top: auto;
      }
      body.decide-kpi-embed #tab-overview .grid > .card.kpi-main-compare:not(.kpi-card-recommended) > .kpi-card-details:last-of-type{
        margin-top: auto;
      }
      body.decide-kpi-embed .kpi-hedge-under .kpi-hedge-under-metrics{
        display: grid;
        grid-template-columns: 1fr 1fr;
        grid-template-rows: auto auto;
        gap: 6px 14px;
        margin-top: 8px;
        align-items: start;
      }
      body.decide-kpi-embed .kpi-hedge-under .kpi-hedge-under-line{
        font-size: 0.82rem !important;
        margin-top: 0 !important;
        line-height: 1.4 !important;
        min-height: 1.4em;
      }
      body.decide-kpi-embed .kpi-hedge-under .kpi-hedge-note{
        font-size: 0.74rem !important;
        line-height: 1.45 !important;
        margin-top: 8px !important;
        padding-top: 8px !important;
        border-top: 1px solid rgba(148,163,184,0.2) !important;
        color: #9ca3af !important;
      }
      @media (max-width: 520px){
        body.decide-kpi-embed .kpi-hedge-under .kpi-hedge-under-metrics{
          grid-template-columns: 1fr;
        }
      }
      body.decide-kpi-embed .chip{
        background: linear-gradient(180deg, rgba(39,39,42,.96) 0%, rgba(24,24,27,.98) 100%) !important;
      }
      body.decide-kpi-embed .stat-box{
        background: linear-gradient(180deg, rgba(39,39,42,.96) 0%, rgba(24,24,27,.98) 100%) !important;
      }
      /* Simulador (embed cliente): flat, sem sombras nem gradientes — também na vista Gráficos quando o painel está embutido */
      body.decide-kpi-embed #tab-simulator .sim-row-actions .sim-capital-label input,
      body.decide-kpi-embed #tab-simulator .sim-row-actions .sim-years-label input,
      body.decide-kpi-embed #tab-simulator .kpi-charts-simulator-embed .sim-row-actions .sim-capital-label input,
      body.decide-kpi-embed #tab-simulator .kpi-charts-simulator-embed .sim-row-actions .sim-years-label input{
        background: rgba(24,24,27,0.98) !important;
        border: 1px solid rgba(63,63,70,0.8) !important;
        color: #fafafa !important;
        box-shadow: none !important;
      }
      body.decide-kpi-embed #tab-simulator .sim-row-actions .sim-capital-label input:focus,
      body.decide-kpi-embed #tab-simulator .sim-row-actions .sim-years-label input:focus,
      body.decide-kpi-embed #tab-simulator .kpi-charts-simulator-embed .sim-row-actions .sim-capital-label input:focus,
      body.decide-kpi-embed #tab-simulator .kpi-charts-simulator-embed .sim-row-actions .sim-years-label input:focus{
        box-shadow: none !important;
        border-color: rgba(113,113,122,0.9) !important;
        outline: none !important;
      }
      body.decide-kpi-embed #tab-simulator #simRunBtn,
      body.decide-kpi-embed #tab-simulator .kpi-charts-simulator-embed #simRunBtn{
        background: #115e59 !important;
        background-image: none !important;
        border: 1px solid rgba(63,63,70,0.75) !important;
        box-shadow: none !important;
      }
      body.decide-kpi-embed #tab-simulator #simRunBtn:hover,
      body.decide-kpi-embed #tab-simulator .kpi-charts-simulator-embed #simRunBtn:hover{
        filter: brightness(1.06) !important;
        box-shadow: none !important;
      }
      body.decide-kpi-embed #tab-simulator .sim-hero-model,
      body.decide-kpi-embed #tab-simulator .kpi-charts-simulator-embed .sim-hero-model{
        background: rgba(39,39,42,0.96) !important;
        background-image: none !important;
        border: 1px solid rgba(45,212,191,0.32) !important;
        box-shadow: none !important;
      }
      body.decide-kpi-embed #tab-simulator .sim-hero-bench,
      body.decide-kpi-embed #tab-simulator .kpi-charts-simulator-embed .sim-hero-bench{
        background: rgba(39,39,42,0.96) !important;
        background-image: none !important;
        border: 1px solid rgba(63,63,70,0.72) !important;
        box-shadow: none !important;
      }
      body.decide-kpi-embed #tab-simulator .sim-client-narrative-card,
      body.decide-kpi-embed #tab-simulator .kpi-charts-simulator-embed .sim-client-narrative-card{
        border: 1px solid rgba(63,63,70,0.62) !important;
        background: rgba(24,24,27,0.96) !important;
        background-image: none !important;
        box-shadow: none !important;
      }
      body.decide-kpi-embed #tab-simulator .sim-headline,
      body.decide-kpi-embed #tab-simulator .kpi-charts-simulator-embed .sim-headline{
        font-size: clamp(1.02rem, 2.4vw, 1.28rem) !important;
        font-weight: 700 !important;
        color: #e2e8f0 !important;
      }
      body.decide-kpi-embed #tab-simulator .sim-lead,
      body.decide-kpi-embed #tab-simulator .kpi-charts-simulator-embed .sim-lead{
        font-weight: 600 !important;
        color: #94a3b8 !important;
        font-size: 0.86rem !important;
      }
      body.decide-kpi-embed #tab-simulator .sim-example-hint,
      body.decide-kpi-embed #tab-simulator .kpi-charts-simulator-embed .sim-example-hint{
        border: 1px solid rgba(63,63,70,0.55) !important;
        background: rgba(39,39,42,0.72) !important;
        background-image: none !important;
        box-shadow: none !important;
      }
      body.decide-kpi-embed #tab-simulator .sim-big-value,
      body.decide-kpi-embed #tab-simulator .kpi-charts-simulator-embed .sim-big-value{
        font-size: clamp(1.22rem, 3.6vw, 1.78rem) !important;
        text-shadow: none !important;
      }
      body.decide-kpi-embed #tab-simulator .sim-results-hero,
      body.decide-kpi-embed #tab-simulator .kpi-charts-simulator-embed .sim-results-hero{
        gap: 12px !important;
      }
      body.decide-kpi-embed #tab-simulator .sim-charts-sync,
      body.decide-kpi-embed #tab-simulator .kpi-charts-simulator-embed .sim-charts-sync{
        grid-template-rows: auto clamp(220px, 30vh, 400px) !important;
      }
      body.decide-kpi-embed #tab-simulator .sim-delta-line,
      body.decide-kpi-embed #tab-simulator .kpi-charts-simulator-embed .sim-delta-line{
        font-size: clamp(0.86rem, 1.95vw, 0.98rem) !important;
        font-weight: 600 !important;
        background: rgba(24,24,27,0.72) !important;
        background-image: none !important;
        border: 1px solid rgba(63,63,70,0.48) !important;
        box-shadow: none !important;
        color: #a1a1aa !important;
      }
      body.decide-kpi-embed #tab-simulator .sim-transition-narrative,
      body.decide-kpi-embed #tab-simulator .kpi-charts-simulator-embed .sim-transition-narrative{
        border: 1px solid rgba(63,63,70,0.5) !important;
        box-shadow: none !important;
        background: rgba(24,24,27,0.72) !important;
        background-image: none !important;
      }
      body.decide-kpi-embed #tab-simulator .sim-framing-block,
      body.decide-kpi-embed #tab-simulator .kpi-charts-simulator-embed .sim-framing-block{
        border: 1px solid rgba(63,63,70,0.5) !important;
        background: rgba(24,24,27,0.65) !important;
        background-image: none !important;
        box-shadow: none !important;
      }
      body.decide-kpi-embed #tab-simulator #simResults .stat-box,
      body.decide-kpi-embed #tab-simulator #simResults .sim-window-card,
      body.decide-kpi-embed #tab-simulator .kpi-charts-simulator-embed #simResults .stat-box,
      body.decide-kpi-embed #tab-simulator .kpi-charts-simulator-embed #simResults .sim-window-card{
        box-shadow: none !important;
        background: rgba(39,39,42,0.78) !important;
        background-image: none !important;
        border: 1px solid rgba(63,63,70,0.55) !important;
      }
      body.decide-kpi-embed #tab-simulator #simCtaBlock,
      body.decide-kpi-embed #tab-simulator .kpi-charts-simulator-embed #simCtaBlock{
        display: none !important;
        background: rgba(39,39,42,0.92) !important;
        background-image: none !important;
        box-shadow: none !important;
        border: 1px solid rgba(63,63,70,0.55) !important;
      }
      body.decide-kpi-embed #tab-simulator canvas,
      body.decide-kpi-embed #tab-simulator .kpi-charts-simulator-embed canvas{
        box-shadow: none !important;
      }
      body.decide-kpi-embed #tab-simulator .kpi-chart-panel--chartBlock,
      body.decide-kpi-embed #tab-simulator .kpi-charts-simulator-embed .kpi-chart-panel--chartBlock{
        box-shadow: none !important;
      }
      body.decide-kpi-embed #tab-portfolio table tbody tr:nth-child(odd) td{
        background: rgba(39,39,42,.52) !important;
      }
      body.decide-kpi-embed #tab-portfolio table tbody tr:nth-child(even) td{
        background: rgba(24,24,27,.68) !important;
      }
      body.decide-kpi-embed #tab-portfolio table tbody tr:hover td{
        background: rgba(45,212,191,.12) !important;
      }
      body.decide-kpi-embed #tab-portfolio .breakdown-list .breakdown-row:nth-child(odd){
        background: rgba(39,39,42,.42) !important;
      }
      body.decide-kpi-embed #tab-portfolio .breakdown-list .breakdown-row:nth-child(even){
        background: rgba(24,24,27,.55) !important;
      }
      body.decide-kpi-embed .kpi-chart-fs-exit{
        background: rgba(39,39,42,0.96) !important;
      }
      body.decide-kpi-embed .simulator-panel input,
      body.decide-kpi-embed .simulator-panel select{
        background: rgba(39, 39, 42, 0.92) !important;
        border-color: rgba(63, 63, 70, 0.85) !important;
      }
      {% endif %}
      {% if client_embed %}
      #decide-embed-standalone-tip{
        display:none;
        margin: 0 0 10px 0;
        padding: 10px 14px;
        border-radius: 12px;
        border: 1px solid rgba(251,191,36,.45);
        background: rgba(251,191,36,.12);
        color: #fde68a;
        font-size: .78rem;
        line-height: 1.45;
      }
      #decide-embed-standalone-tip a{
        color: #5eead4;
        font-weight: 700;
        text-decoration: underline;
      }
      #decide-embed-standalone-tip .decide-embed-tip-meta{
        color: #cbd5e1;
        font-size: .72rem;
        margin-left: .25rem;
      }
      #decide-embed-standalone-tip code{
        font-size: .74rem;
        padding: .1rem .35rem;
        border-radius: 6px;
        background: rgba(39, 39, 42, 0.75);
      }
      {% endif %}
      .simulator-panel label{
        display:flex;
        flex-direction:column;
        gap:6px;
        font-size:.78rem;
        color: var(--muted);
        font-weight: 600;
      }
      .simulator-panel input, .simulator-panel select{
        background: rgba(15,23,42,.88);
        border: 1px solid var(--border);
        color: var(--text);
        border-radius: 10px;
        padding: 8px 11px;
        font-size: .95rem;
        min-width: 150px;
      }
      /* Linha capital / anos / botão — alinhada à landing (proporções + 56px altura) */
      .sim-row-actions{
        display: flex;
        flex-wrap: wrap;
        gap: clamp(10px, 1.6vw, 16px);
        row-gap: 12px;
        align-items: flex-end;
        justify-content: center;
        margin-top: 6px;
        max-width: 920px;
        margin-left: auto;
        margin-right: auto;
        box-sizing: border-box;
      }
      .sim-row-actions .sim-capital-label{
        flex: 5.5 1 0;
        min-width: min(100%, 220px);
        max-width: min(100%, 620px);
        gap: 8px;
        font-size: 0.875rem;
        font-weight: 800;
        color: #cbd5e1;
        letter-spacing: -0.01em;
        box-sizing: border-box;
      }
      .sim-row-actions .sim-years-label{
        flex: 2.15 1 0;
        min-width: min(100%, 172px);
        max-width: min(100%, 248px);
        gap: 8px;
        font-size: 0.875rem;
        font-weight: 900;
        color: #f8fafc;
        letter-spacing: -0.02em;
        box-sizing: border-box;
      }
      .sim-row-actions .sim-capital-label input,
      .sim-row-actions .sim-years-label input{
        width: 100%;
        min-width: 0;
        height: 56px;
        min-height: 56px;
        line-height: 52px;
        margin: 0;
        box-sizing: border-box;
        border-radius: 12px;
        padding: 0 16px;
        font-size: clamp(17px, 2.05vw, 21px);
        font-weight: 900;
        letter-spacing: -0.02em;
        vertical-align: middle;
      }
      .sim-row-actions .sim-capital-label input{
        background: rgba(9,9,11,0.96);
        border: 2px solid rgba(82,82,91,0.65);
        color: #fafafa;
        box-shadow: 0 2px 10px rgba(0,0,0,0.28), inset 0 1px 0 rgba(255,255,255,.04);
      }
      .sim-row-actions .sim-capital-label input::selection,
      .sim-row-actions .sim-years-label input::selection{
        background: rgba(45, 212, 191, 0.32);
        color: #fafafa;
      }
      .sim-row-actions .sim-years-label input{
        background: rgba(24,24,27,0.96);
        border: 2px solid rgba(63,63,70,0.75);
        color: #e4e4e7;
        box-shadow: 0 4px 20px rgba(0,0,0,0.2), inset 0 1px 0 rgba(255,255,255,.03);
      }
      .sim-row-actions .sim-years-label input:focus,
      .sim-row-actions .sim-capital-label input:focus{
        border-color: rgba(113,113,122,0.85);
        outline: none;
        box-shadow: 0 0 0 2px rgba(255,255,255,.08);
      }
      .sim-run-as-field{
        display: flex;
        flex-direction: column;
        gap: 8px;
        justify-content: flex-end;
        margin-left: 12px;
        flex: 0 0 clamp(168px, 22vw, 215px);
        min-width: 168px;
        max-width: 220px;
        box-sizing: border-box;
      }
      .sim-run-as-field .sim-run-spacer{
        font-size: 0.875rem;
        line-height: 1.2;
        color: transparent;
        user-select: none;
      }
      #simRunBtn{
        width: 100%;
        height: 56px;
        min-height: 56px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        background: linear-gradient(180deg,#0f766e 0%,#115e59 55%,#134e4a 100%);
        color:#fff;
        border:1px solid rgba(45,212,191,0.45);
        border-radius:12px;
        padding: 0 20px;
        font-weight:900;
        font-size: clamp(14px, 1.35vw, 16px);
        line-height: 1.2;
        cursor:pointer;
        letter-spacing: -0.01em;
        box-shadow: 0 2px 10px rgba(0,0,0,.42);
        white-space: nowrap;
        box-sizing: border-box;
      }
      #simRunBtn:hover{ filter: brightness(1.05); box-shadow: 0 4px 14px rgba(0,0,0,.48), 0 0 0 1px rgba(255,255,255,.06); }
      .sim-headline{
        font-size: clamp(1.15rem, 2.8vw, 1.55rem);
        font-weight: 800;
        line-height: 1.3;
        color: #f8fafc;
        margin: 0 0 10px;
        letter-spacing: .01em;
      }
      .sim-lead{
        font-size: 0.92rem;
        font-weight: 700;
        color: #e2e8f0;
        line-height: 1.45;
        margin: 0 0 10px;
      }
      .sim-info-tip{
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 1.15rem;
        height: 1.15rem;
        margin-left: 6px;
        border-radius: 999px;
        font-size: 0.68rem;
        font-weight: 800;
        font-style: normal;
        color: #0f172a;
        background: rgba(45,212,191,.88);
        cursor: help;
        vertical-align: middle;
        line-height: 1;
      }
      .sim-example-hint{
        font-size: 0.88rem;
        color: #a1a1aa;
        font-weight: 700;
        margin: 0 0 14px;
        padding: 12px 14px;
        border-radius: 12px;
        background: linear-gradient(180deg, rgba(39,39,42,.92) 0%, rgba(24,24,27,.96) 100%);
        border: 1px solid rgba(63,63,70,.85);
        box-shadow: 0 1px 6px rgba(0,0,0,.28);
      }
      .sim-example-hint strong{ font-weight: 800; }
      .sim-example-hint .sim-example-strong-white{ color: #fafafa; }
      .sim-example-hint .sim-example-strong-teal{ color: #5eead4; }
      .sim-results-hero{
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
        gap: 14px;
        margin-bottom: 10px;
      }
      .sim-transition-narrative{
        margin: 0 0 14px;
        padding: 14px 16px;
        border-radius: 14px;
        border: 1px solid rgba(63,63,70,0.55);
        background: linear-gradient(165deg, rgba(39,39,42,0.88), rgba(24,24,27,0.94));
        box-shadow: 0 2px 10px rgba(0,0,0,0.28);
      }
      .sim-transition-lead{
        margin: 0 0 8px;
        font-size: 0.92rem;
        font-weight: 800;
        line-height: 1.45;
        color: #e2e8f0;
      }
      .sim-transition-follow{
        margin: 0;
        font-size: 0.82rem;
        font-weight: 600;
        line-height: 1.5;
        color: #94a3b8;
      }
      .sim-dd-meta-hint{
        margin: 6px 0 0;
        font-size: 0.68rem;
        line-height: 1.4;
        color: #94a3b8;
      }
      .sim-framing-block{
        margin: 0 0 14px;
        padding: 12px 14px;
        border-radius: 12px;
        border: 1px solid rgba(63,63,70,0.75);
        background: rgba(15,23,42,0.45);
      }
      .sim-mifid-disclaimer{
        margin: 0 0 8px;
        font-size: 0.76rem;
        font-weight: 600;
        line-height: 1.45;
        color: #94a3b8;
      }
      .sim-temporal-line{
        margin: 0 0 8px;
        font-size: 0.84rem;
        font-weight: 800;
        line-height: 1.45;
        color: #e2e8f0;
      }
      .sim-risk-line{
        margin: 0;
        font-size: 0.76rem;
        font-weight: 600;
        line-height: 1.45;
        color: #a8a29e;
      }
      .sim-emotional-line{
        text-align: center;
        font-size: 0.82rem;
        font-weight: 600;
        font-style: normal;
        color: #94a3b8;
        line-height: 1.45;
        margin: 0 0 18px;
        padding: 0 8px;
        letter-spacing: .01em;
      }
      .sim-hero-card{
        border-radius: 16px;
        padding: 18px 16px;
        border: 1px solid rgba(148,163,184,.2);
        text-align: center;
      }
      .sim-hero-model{
        background: linear-gradient(165deg, rgba(42,42,44,.95), rgba(24,24,27,.98));
        border-color: rgba(82,82,91,.5);
        box-shadow: 0 2px 12px rgba(0,0,0,.38);
      }
      .sim-hero-bench{
        background: linear-gradient(180deg, rgba(39,39,42,.9) 0%, rgba(24,24,27,.94) 100%);
        border-color: rgba(82,82,91,.75);
        box-shadow: 0 2px 10px rgba(0,0,0,.32);
      }
      .sim-hero-margin{
        background: linear-gradient(165deg, rgba(120,53,15,.35) 0%, rgba(24,24,27,.94) 100%);
        border-color: rgba(251,146,60,.55);
        box-shadow: 0 2px 10px rgba(0,0,0,.32);
      }
      .sim-big-value-margin{
        color: #fb923c;
      }
      .sim-big-value{
        font-size: clamp(1.55rem, 4.8vw, 2.35rem);
        font-weight: 900;
        letter-spacing: -0.03em;
        line-height: 1.08;
        margin-top: 8px;
        color: #e4e4e7;
        text-shadow: none;
      }
      .sim-delta-line{
        text-align: center;
        font-size: clamp(1.08rem, 2.6vw, 1.22rem);
        font-weight: 900;
        color: #d4d4d8;
        margin: 0 0 14px;
        padding: 14px 16px;
        border-radius: 16px;
        background: linear-gradient(180deg, rgba(39,39,42,.88), rgba(24,24,27,.94));
        border: 1px solid rgba(63,63,70,.55);
        line-height: 1.4;
        letter-spacing: -0.02em;
        box-shadow: 0 2px 10px rgba(0,0,0,.32);
        text-shadow: none;
      }
      .sim-big-value-bench{
        color: #cbd5e1;
        text-shadow: none;
      }
      .sim-window-card .num{ font-size: .88rem !important; color: #cbd5e1 !important; }
      #simCtaBlock{
        margin-top: 22px;
        padding: 20px 18px;
        border-radius: 16px;
        background: linear-gradient(145deg, rgba(39,39,42,.92), rgba(24,24,27,.96));
        border: 1px solid rgba(63,63,70,.55);
        text-align: center;
      }
      #simCtaBlock p{
        margin: 0 0 14px;
        font-size: 1rem;
        font-weight: 700;
        color: #e2e8f0;
        line-height: 1.45;
      }
      #simCtaBlock .sim-cta-headline{
        margin: 0 0 8px;
        font-size: 0.72rem;
        font-weight: 900;
        letter-spacing: 0.14em;
        text-transform: uppercase;
        color: #5eead4;
      }
      .sim-cta-secondary-link{
        color: #94a3b8;
        font-weight: 600;
        text-decoration: underline;
        text-underline-offset: 3px;
      }
      .sim-cta-secondary-link:hover{ color: #5eead4; }
      #simCtaLink{
        display: inline-block;
        background: linear-gradient(180deg,#fdba74 0%,#f97316 45%,#ea580c 100%);
        color: #0f172a;
        font-weight: 900;
        font-size: .95rem;
        padding: 14px 28px;
        border-radius: 14px;
        text-decoration: none;
        border: 1px solid rgba(255,237,213,.45);
        box-shadow: 0 2px 12px rgba(0,0,0,.4), inset 0 1px 0 rgba(255,255,255,.2);
      }
      #simCtaLink:hover{ filter: brightness(1.05); }
      .sim-cta-montante-line{
        color: #a1a1aa !important;
      }
      .sim-cta-montante-line strong{
        color: #5eead4;
        font-weight: 800;
      }
      .sim-cta-micro{
        margin: 10px 0 0;
        font-size: 0.78rem;
        color: #94a3b8;
        font-weight: 600;
        line-height: 1.5;
      }
      .sim-cta-micro + .sim-cta-micro{
        margin-top: 4px;
      }
    </style>
  </head>
  <body{% if client_embed %} class="decide-kpi-embed{% if kpi_simple %} decide-kpi-simple{% endif %}{% if tab_default == 'simulator' %} decide-kpi-start-sim{% endif %}"{% endif %}>
    {% if client_embed %}
    <div id="decide-embed-standalone-tip" role="status">
      Estás a ver os KPIs <strong>directamente no browser</strong> (fora do dashboard DECIDE com iframe).
      Para voltar à vista com iframe no site:
      <a id="decide-embed-dashboard-link" href="{{ frontend_url }}/client-dashboard">abrir o dashboard DECIDE</a>
      <span class="decide-embed-tip-meta">(<span id="decide-embed-dashboard-url">{{ frontend_url }}/client-dashboard</span>)</span>
      <br />
      <span style="opacity:.92">
        Se o link falhar com «recusou ligar»: num terminal na raiz do repositório corre
        <code style="color:#e5e7eb">npm run dev</code> (Next na porta <strong>4701</strong>) e mantém essa janela aberta.
        O URL usa o mesmo <em>hostname</em> que esta página (<code>localhost</code> ≠ <code>127.0.0.1</code> para sessão no browser).
      </span>
    </div>
    <script>
      (function () {
        var el = document.getElementById("decide-embed-standalone-tip");
        if (!el) return;
        try {
          if (window.self === window.top) el.style.display = "block";
        } catch (e) {}
        /* Mesmo host que o Flask (ex.: localhost vs 127.0.0.1) para coincidir com a sessão do Next. */
        var a = document.getElementById("decide-embed-dashboard-link");
        var u = document.getElementById("decide-embed-dashboard-url");
        try {
          var port = "4701";
          var base = window.location.protocol + "//" + window.location.hostname + ":" + port + "/client-dashboard";
          if (a) a.setAttribute("href", base);
          if (u) u.textContent = base;
        } catch (e2) {}
      })();
    </script>
    {% endif %}
    {% macro simulator_client_embed_panel() %}
      <div id="simApiContext"
        {# Prefixo `/kpi-flask` só quando o documento do iframe está nesse path (Next → Flask). Não injectar
           aqui: em `127.0.0.1:5000` ou num host KPI público na raiz, `/kpi-flask/api/...` dá 404. O JS usa
           `window.location.pathname` (`kpiPublicApiPath`) como fallback. #}
        data-cap15-only="{% if cap15_only %}1{% else %}0{% endif %}"
        data-client-embed="{% if client_embed %}1{% else %}0{% endif %}"
        data-charts-embed-narrative="{% if charts_embed_context %}1{% else %}0{% endif %}"
        data-model-key="{{ current_model }}"
        data-embed-profile="{{ current_profile }}"
        data-register-base="{{ frontend_url }}/client/register"
        data-approve-href="{{ frontend_url }}/client/approve"
        style="display:none"
        aria-hidden="true"></div>
      <div class="card sim-client-narrative-card{% if client_embed %} sim-embed-simulation-card{% endif %}" style="margin-top:0.5rem;" data-enter-submit="#simRunBtn">
        {% if client_embed %}
        <h2 class="sim-headline">Simulação ilustrativa baseada no histórico do modelo</h2>
        <p class="sim-lead sim-embed-lead">
          A evolução do capital reflecte o histórico da estratégia na janela que definir (capital e anos). Não constitui projeção nem garantia de resultados futuros.
        </p>
        <p class="muted sim-embed-profile-note" style="font-size:0.82rem; margin-top:0.35rem; line-height:1.45; color:#94a3b8 !important;">
          O <strong style="color:#cbd5e1;">perfil de risco</strong> segue o selector do <strong style="color:#5eead4;">dashboard</strong> (fora deste quadro).
        </p>
        <div class="simulator-panel sim-row-actions sim-embed-row-actions">
          <label class="sim-capital-label">
            Capital inicial (€)
            <input type="text" id="simCapital" inputmode="numeric" autocomplete="off" value="100 000" />
          </label>
          <label class="sim-years-label">
            Anos
            <input type="text" id="simYears" inputmode="decimal" autocomplete="off" value="20" max="{{ num_years|round(3) }}" />
          </label>
          <div class="sim-run-as-field">
            <span class="sim-run-spacer" aria-hidden="true">.</span>
            <button type="button" id="simRunBtn">Atualizar simulação</button>
          </div>
        </div>
        {% else %}
        <h2 class="sim-headline">Simulação ilustrativa de longo prazo</h2>
        <p class="sim-lead">
          Cenário ilustrativo à parte das curvas históricas abaixo: ajuste capital e horizonte para explorar um exemplo numérico.
          <span class="sim-info-tip" title="Valores baseados em histórico. O nível de risco desta simulação não altera o selector do topo.">i</span>
        </p>
        <p class="sim-example-hint">
          <strong class="sim-example-strong-white">Exemplo pré-preenchido:</strong>
          <strong class="sim-example-strong-teal">10 000 €</strong> durante <strong class="sim-example-strong-teal">20 anos</strong>.
          Pode alterar os valores abaixo.
        </p>
        <div class="simulator-panel" style="display:flex; flex-wrap:wrap; gap:14px; align-items:flex-end; margin-top:4px;">
          <label>
            Nível de risco
            <select id="simProfileSelect" style="min-width: 200px;">
              {% for key, label in profile_options %}
              <option value="{{ key }}" {% if key == current_profile %}selected{% endif %}>{{ label }}</option>
              {% endfor %}
            </select>
          </label>
        </div>
        <div class="simulator-panel sim-row-actions">
          <label class="sim-capital-label">
            Capital inicial (€) — mín. 5 000 €
            <input type="text" id="simCapital" inputmode="numeric" autocomplete="off" value="10 000" />
          </label>
          <label class="sim-years-label">
            Anos (desde o investimento)
            <input type="text" id="simYears" inputmode="decimal" autocomplete="off" value="20" max="{{ num_years|round(3) }}" />
          </label>
          <div class="sim-run-as-field">
            <span class="sim-run-spacer" aria-hidden="true">.</span>
            <button type="button" id="simRunBtn">Explorar este cenário</button>
          </div>
        </div>
        {% endif %}
        <div id="simError" style="color:#f87171; margin-top:10px; font-size:0.82rem; display:none;"></div>
        {% if client_embed %}
        <div id="simResults" class="sim-embed-results" style="display:none; margin-top:14px;">
          <div class="sim-embed-body-grid" role="group" aria-label="Resultados da simulação, gráficos e próximo passo">
            <div class="sim-embed-main-col">
              <div class="sim-embed-hero-block">
                <div class="label" id="simModelResultLabel">Modelo DECIDE (valor ilustrativo final)</div>
                <div class="sim-big-value sim-embed-model-total" id="simEndModel">—</div>
                <div class="sim-embed-bench-inline" id="simMarginHeroEmbed" style="display:none; margin-top:12px;">
                  <span class="label">{{ cap15_human_margin_label_pt }} · mesmo período</span>
                  <div class="sim-big-value sim-big-value-margin sim-embed-bench-value" id="simEndMargin">—</div>
                </div>
                <div class="sim-embed-bench-inline">
                  <span class="label">Referência / benchmark (mesmo período)</span>
                  <div class="sim-big-value sim-big-value-bench sim-embed-bench-value" id="simEndBench">—</div>
                </div>
              </div>
              <p class="muted sim-embed-short-disclaimer" style="line-height:1.45; margin:10px 0 0;">
                Exemplo ilustrativo baseado no histórico do modelo.
              </p>
              <div class="sim-embed-charts-col">
              <p class="sim-embed-chart-bridge">A simulação acima baseia-se na evolução histórica apresentada abaixo: primeiro a curva de capital (escala log), a seguir o gráfico de drawdowns no mesmo horizonte.</p>
              <section class="sim-embed-chart-section" aria-label="Base histórica da simulação">
                <div class="kpi-chart-panel kpi-chart-panel--meta sim-embed-chart-head">
                  <button type="button" class="kpi-chart-fs-exit" aria-label="Diminuir gráfico" tabindex="-1">Diminuir</button>
                  <div class="label kpi-chart-title-simple">Base histórica da simulação ({% if model_dates and model_dates|length > 0 %}{{ (model_dates|first)[:4] }}–{{ (model_dates|last)[:4] }}{% else %}série do modelo{% endif %})</div>
                  <div class="muted kpi-chart-title-simple" style="margin-bottom:0;">Escala logarítmica · modelo e referencial na mesma janela simulada.</div>
                </div>
                <div class="kpi-chart-panel kpi-chart-panel--sim kpi-chart-panel--chartBlock kpi-chart-panel--zoomable" title="Clique para ver em ecrã inteiro">
                  <button type="button" class="kpi-chart-fs-exit" aria-label="Diminuir gráfico">Diminuir</button>
                  <div class="kpi-chart-canvas-slot sim-embed-canvas-slot">
                    <canvas id="simulatorChart" height="200"></canvas>
                  </div>
                </div>
              </section>
              <section class="sim-embed-chart-section" aria-label="Drawdowns">
                <div class="kpi-chart-panel kpi-chart-panel--meta">
                  <button type="button" class="kpi-chart-fs-exit" aria-label="Diminuir gráfico" tabindex="-1">Diminuir</button>
                  <div class="label kpi-chart-title-simple">Drawdowns (quedas máximas)</div>
                  <p class="sim-dd-meta-hint sim-embed-dd-hint">Mede as perdas temporárias ao longo do tempo. Quanto mais baixo no gráfico, maior a queda desde o pico.</p>
                </div>
                <div class="kpi-chart-panel kpi-chart-panel--sim kpi-chart-panel--chartBlock kpi-chart-panel--zoomable" title="Clique para ver em ecrã inteiro">
                  <button type="button" class="kpi-chart-fs-exit" aria-label="Diminuir gráfico">Diminuir</button>
                  <div class="kpi-chart-canvas-slot sim-embed-canvas-slot">
                    <canvas id="simulatorDdChart" height="200"></canvas>
                  </div>
                </div>
              </section>
              </div>
            </div>
            <aside class="sim-embed-cta-aside" aria-label="Próximo passo">
              <div class="sim-embed-cta-inner">
                <p class="kpi-charts-embed-cta-kicker">Próximo passo</p>
                <p class="kpi-charts-embed-cta-micro" style="margin:0 0 14px;">Investimento mínimo <strong style="color:#cbd5e1;">5 000 €</strong></p>
                <a id="chartsEmbedCtaLink" class="kpi-charts-embed-cta-primary sim-embed-cta-plano" href="{{ frontend_url }}/client/approve" target="_top" rel="noopener noreferrer">Ver plano para a sua carteira</a>
                <p class="kpi-charts-embed-cta-micro sim-embed-cta-reg-wrap" style="margin-bottom:0;">
                  <a id="chartsEmbedCtaRegLink" class="kpi-charts-embed-cta-secondary" href="{{ frontend_url }}/client/register" target="_blank" rel="noopener noreferrer">Ainda sem conta — criar registo</a>
                </p>
              </div>
            </aside>
          </div>
          <p class="muted sim-embed-footnote" style="font-size:0.68rem; line-height:1.4; margin:12px 0 0;">
            Sem custos nem impostos na ilustração; não é recomendação nem garantia de resultados futuros.
          </p>
          <div class="sim-embed-legacy-hooks" aria-hidden="true">
            <div class="sim-transition-narrative" id="simTransitionNarrative" role="region" aria-label="Da simulação ao plano"></div>
            <div class="sim-framing-block" id="simFramingBlock" aria-live="polite">
              <p class="sim-mifid-disclaimer"></p>
              <p class="sim-temporal-line" id="simTemporalLine"></p>
              <p class="sim-risk-line"></p>
            </div>
            <p class="sim-delta-line" id="simDeltaLine" style="display:none;" role="status"></p>
            <p class="sim-emotional-line"></p>
            <div class="stats-grid" style="margin-bottom:0;">
              <div class="stat-box sim-window-card">
                <div class="label">Janela simulada</div>
                <div class="num" id="simWindow">—</div>
              </div>
            </div>
            <div id="simCtaBlock" style="display:none;">
              <a id="simCtaLink" class="sim-cta-primary" href="{{ frontend_url }}/client/approve" target="_top" rel="noopener noreferrer">Ver plano para a sua carteira</a>
              <a id="simCtaRegisterLink" class="sim-cta-secondary-link" href="{{ frontend_url }}/client/register" target="_blank" rel="noopener noreferrer">Registo</a>
            </div>
          </div>
        </div>
        {% else %}
        <div id="simResults" style="display:none; margin-top:18px;">
          <div class="sim-results-hero">
            <div class="sim-hero-card sim-hero-model">
              <div class="label" id="simModelResultLabel">Modelo DECIDE (valor ilustrativo final)</div>
              <div class="sim-big-value" id="simEndModel">—</div>
            </div>
            <div class="sim-hero-card sim-hero-margin" id="simMarginHeroFull" style="display:none;">
              <div class="label">{{ cap15_human_margin_label_pt }} · mesmo período</div>
              <div class="sim-big-value sim-big-value-margin" id="simEndMargin">—</div>
            </div>
            <div class="sim-hero-card sim-hero-bench">
              <div class="label">Referência / benchmark (mesmo período)</div>
              <div class="sim-big-value sim-big-value-bench" id="simEndBench">—</div>
            </div>
          </div>
          <div class="sim-transition-narrative" id="simTransitionNarrative" role="region" aria-label="Da simulação ao plano">
            <p class="sim-transition-lead">
              Exemplo ilustrativo baseado no histórico do modelo.
            </p>
            <p class="sim-transition-follow">
              O plano proposto procura aplicar estes princípios ao seu perfil de investimento.
            </p>
          </div>
          <div class="sim-framing-block" id="simFramingBlock" aria-live="polite">
            <p class="sim-mifid-disclaimer">
              Ilustrativo a partir do histórico do modelo — não é projeção nem garantia de resultados futuros.
            </p>
            <p class="sim-temporal-line" id="simTemporalLine"></p>
            <p class="sim-risk-line">
              O valor pode variar ao longo do tempo, incluindo períodos de perdas.
            </p>
          </div>
          <p class="sim-delta-line" id="simDeltaLine" style="display:none;" role="status"></p>
          <p class="sim-emotional-line">Mesmo capital inicial e o mesmo horizonte para a estratégia e para o referencial (leitura ilustrativa).</p>
          <div class="stats-grid" style="margin-bottom:0;">
            <div class="stat-box sim-window-card">
              <div class="label">Janela simulada</div>
              <div class="num" id="simWindow">—</div>
            </div>
          </div>
          <div id="simCtaBlock" style="display:none;">
            <p class="sim-cta-headline">Próximo passo</p>
            <p class="sim-cta-micro sim-cta-montante-line" style="margin:0 0 12px;">Investimento mínimo <strong>5 000 €</strong> · leitura do plano alinhada ao seu perfil.</p>
            <a id="simCtaLink" class="sim-cta-primary" href="{{ frontend_url }}/client/approve" target="_top" rel="noopener noreferrer">Ver plano para a sua carteira</a>
            <p class="sim-cta-micro"><a id="simCtaRegisterLink" class="sim-cta-secondary-link" href="{{ frontend_url }}/client/register" target="_blank" rel="noopener noreferrer">Ainda sem conta — criar registo</a></p>
          </div>
          <div class="sim-charts-sync" role="group" aria-label="Evolução do capital e drawdowns da simulação">
            <div class="sim-sync-head sim-sync-1">
              <div class="kpi-chart-panel kpi-chart-panel--meta">
                <button type="button" class="kpi-chart-fs-exit" aria-label="Diminuir gráfico" tabindex="-1">Diminuir</button>
                <div class="label">Evolução do capital (escala log)</div>
                <div class="muted" style="font-size:0.72rem; margin-bottom:0;">Mesmo ponto de partida nos dois cenários; crescimento composto ao longo dos dias úteis da janela.</div>
              </div>
            </div>
            <div class="sim-sync-head sim-sync-2">
              <div class="kpi-chart-panel kpi-chart-panel--meta">
                <button type="button" class="kpi-chart-fs-exit" aria-label="Diminuir gráfico" tabindex="-1">Diminuir</button>
                <div class="label">Drawdowns (modelo vs referência)</div>
                <p class="sim-dd-meta-hint">Quanto mais baixo no gráfico, maior a perda face ao pico anterior na janela.</p>
              </div>
            </div>
            <div class="sim-sync-body sim-sync-1">
              <div class="kpi-chart-panel kpi-chart-panel--chartBlock kpi-chart-panel--zoomable" title="Clique para ver em ecrã inteiro">
                <button type="button" class="kpi-chart-fs-exit" aria-label="Diminuir gráfico">Diminuir</button>
                <div class="kpi-chart-canvas-slot">
                  <canvas id="simulatorChart" height="160"></canvas>
                </div>
              </div>
            </div>
            <div class="sim-sync-body sim-sync-2">
              <div class="kpi-chart-panel kpi-chart-panel--chartBlock kpi-chart-panel--zoomable" title="Clique para ver em ecrã inteiro">
                <button type="button" class="kpi-chart-fs-exit" aria-label="Diminuir gráfico">Diminuir</button>
                <div class="kpi-chart-canvas-slot">
                  <canvas id="simulatorDdChart" height="160"></canvas>
                </div>
              </div>
            </div>
          </div>
          <p class="muted" style="font-size:0.7rem; line-height:1.45; margin:14px 0 0;">
            Ilustração sem custos nem impostos; não constitui recomendação. Resultados futuros podem diferir materialmente do histórico.
          </p>
        </div>
        {% endif %}
      </div>
    {% endmacro %}
    {% macro kpi_client_embed_history_stack() %}{% endmacro %}
    <div class="topbar">
      <div class="topbar-inner">
        <div class="brand">
          <div>
            <div class="subtitle csv-source-line">Fonte: {{ model_path.name }} e {{ bench_path.name }} ({{ num_years|round(2) }} anos; {{ num_days }} dias úteis)</div>
          </div>
        </div>

        <div class="controls">
          {% if not cap15_only %}
          <div class="control">
            <span>Modelo</span>
            <select id="modelSelect">
              {% for key, label in model_options %}
              <option value="{{ key }}" {{ 'selected' if current_model == key else '' }}>{{ label }}</option>
              {% endfor %}
            </select>
          </div>
          {% endif %}
          {% if profile_source_note %}
            <span class="pill profile-source-pill">{{ profile_source_note }}</span>
          {% endif %}
        </div>
      </div>
    </div>

    <div class="container">

    {% if not cap15_only %}
    <div style="margin-top: 0.75rem; margin-bottom: 1.25rem;">
      <div style="font-size:0.8rem; color:#9ca3af; margin-bottom:0.35rem;">
        Navegação rápida (frontend) — base: <span class="pill">{{ frontend_url }}</span>
      </div>
      <div class="quick-links">
        <a class="chip" href="{{ frontend_url }}/client-dashboard" target="_blank" rel="noreferrer" style="border-color:rgba(45,212,191,.55);color:#99f6e4;font-weight:600;">Dashboard Cliente</a>
        <a class="chip" href="{{ frontend_url }}/fees-client" target="_blank" rel="noreferrer">Fees Client</a>
        <a class="chip" href="{{ frontend_url }}/fees-business" target="_blank" rel="noreferrer">Fees Business</a>
        <a class="chip" href="{{ frontend_url }}/onboarding" target="_blank" rel="noreferrer">Onboarding</a>
        <a class="chip" href="{{ frontend_url }}/mifid-test" target="_blank" rel="noreferrer">Teste MiFID</a>
      </div>
    </div>
    {% endif %}

    {% if not client_embed %}
    <div class="tab-nav-label">Conteúdo do dashboard</div>
    {% endif %}
    {% if not client_embed %}
    <div class="tabs" role="tablist" aria-label="Secções do dashboard">
      <button type="button" class="tab{% if tab_default == 'overview' %} active{% endif %}" data-tab="overview" role="tab" aria-selected="{% if tab_default == 'overview' %}true{% else %}false{% endif %}">KPIs</button>
      <button type="button" class="tab{% if tab_default == 'charts' %} active{% endif %}" data-tab="charts" role="tab" aria-selected="{% if tab_default == 'charts' %}true{% else %}false{% endif %}">Gráficos</button>
      <button type="button" class="tab{% if tab_default == 'horizons' %} active{% endif %}" data-tab="horizons" role="tab" aria-selected="{% if tab_default == 'horizons' %}true{% else %}false{% endif %}">Retornos YTD · 1Y · 5Y · 10Y</button>
      <button type="button" class="tab{% if tab_default == 'simulator' %} active{% endif %}" data-tab="simulator" role="tab" aria-selected="{% if tab_default == 'simulator' %}true{% else %}false{% endif %}">Simulador</button>
      <button type="button" class="tab{% if tab_default == 'portfolio' %} active{% endif %}" data-tab="portfolio" role="tab" aria-selected="{% if tab_default == 'portfolio' %}true{% else %}false{% endif %}">Carteira</button>
      <button type="button" class="tab{% if tab_default == 'portfolio_history' %} active{% endif %}" data-tab="portfolio_history" role="tab" aria-selected="{% if tab_default == 'portfolio_history' %}true{% else %}false{% endif %}">Histórico de decisões</button>
      <button type="button" class="tab{% if tab_default == 'faq' %} active{% endif %}" data-tab="faq" role="tab" aria-selected="{% if tab_default == 'faq' %}true{% else %}false{% endif %}">FAQs</button>
      <button type="button" class="tab{% if tab_default == 'diagnostics' %} active{% endif %}" data-tab="diagnostics" role="tab" aria-selected="{% if tab_default == 'diagnostics' %}true{% else %}false{% endif %}">Diagnóstico (rolling)</button>
    </div>
    {% endif %}

    <!-- ABA 1: OVERVIEW KPIs -->
    <div id="tab-overview" class="tab-content{% if tab_default == 'overview' %} active{% endif %}">
      {% if client_embed and cap15_only and hedge_kpis_embed and hedge_kpis_embed.ok %}
      <div class="kpi-embed-hedge-banner" role="status">
        <div>
          <strong>Simulação com hedge cambial:</strong>
          {{ hedge_kpis_embed.hedge_pct | round(0) | int }}%
          {% set hp = hedge_kpis_embed.pair %}
          ({% if hp|length == 6 %}{{ hp[:3] }}/{{ hp[3:] }}{% else %}{{ hp }}{% endif %}).
          <span class="hedge-muted"> Os cartões em baixo são <strong style="color:#e2e8f0;">sem</strong> este ajuste FX; aqui vê o efeito ilustrativo no CAGR.</span>
        </div>
        <div class="kpi-embed-hedge-numbers">
          <span>{{ cap15_human_label_pt }} — <strong style="color:#a7f3d0;">CAGR com hedge ilustrativo</strong>:</span>
          <span class="hedge-cagr-big">{{ (hedge_kpis_embed.cap15_max100.cagr * 100) | round(2) }}%</span>
          <span class="hedge-muted">· sem hedge (valor do cartão): {{ (model_kpis.cagr * 100) | round(2) }}%</span>
        </div>
        <div class="hedge-muted" style="margin-top:8px;font-size:0.7rem;line-height:1.4;">Ilustrativo (remove o factor cambial da série conforme a %); execução real na corretora é independente.</div>
      </div>
      {% endif %}
      <div class="grid{% if compare_cap100_kpis %} grid-has-plafonada{% endif %}">
        {% if client_embed and cap15_only %}
        <details class="kpi-embed-tech-details" style="grid-column:1/-1;margin:0 0 10px 0;border-radius:10px;border:1px solid rgba(63,63,70,0.85);background:rgba(24,24,27,0.65);padding:8px 12px;">
          <summary style="cursor:pointer;font-size:0.78rem;color:#cbd5e1;font-weight:750;list-style:none;">▸ Detalhes técnicos (build, caminhos, ficheiros)</summary>
          <p class="kpi-embed-diag" style="font-size:0.68rem;color:#94a3b8;margin:10px 0 0;line-height:1.35;">
            Decide KPI <code style="color:#cbd5e1;">{{ kpi_diag_build }}</code>
            · repo <code style="color:#cbd5e1;">{{ kpi_diag_repo }}</code>
            · bench <code style="color:#cbd5e1;">{{ kpi_diag_bench_file }}</code> ({{ kpi_diag_bench_rows }} linhas)
            · raw <code style="color:#cbd5e1;">{{ kpi_diag_raw_file }}</code> ({{ kpi_diag_raw_rows }} linhas).
            Se o build não tiver sido actualizado (ex. ainda «v18») ou vires bench ~0%, o Flask na porta 5000 é antigo ou outro repo — termina esse processo e corre <code style="color:#cbd5e1;">npm run kpi</code> na raiz do <code style="color:#cbd5e1;">decide-core</code> onde está este <code style="color:#cbd5e1;">kpi_server.py</code>; opcional <code style="color:#cbd5e1;">DECIDE_KPI_REPO_ROOT</code> se tens vários checkouts.
          </p>
        </details>
        {% endif %}
        <div class="card {{ 'col-3' if compare_cap100_kpis else 'col-4' }} kpi-advanced-only kpi-card-raw-model">
          <div class="label">Modelo RAW / motor (não investível)</div>
          <div class="value positive">{{ (raw_kpis.cagr * 100) | round(2) }}% <span class="muted" style="font-size:0.75rem;">CAGR</span></div>
          <div class="kpi-line kpi-advanced-only">Vol {{ (raw_kpis.volatility * 100) | round(2) }}%</div>
          <div class="kpi-line kpi-simple-only">Risco esperado (vol.) {{ (raw_kpis.volatility * 100) | round(2) }}%</div>
          <div class="kpi-line kpi-advanced-only">Sharpe {{ raw_kpis.sharpe | round(2) }}</div>
          <div class="kpi-line value negative kpi-advanced-only">Max DD {{ (raw_kpis.max_drawdown * 100) | round(2) }}%</div>
          <div class="kpi-line value negative kpi-simple-only">Queda máxima histórica {{ (raw_kpis.max_drawdown * 100) | round(2) }}%</div>
          <div class="kpi-advanced-only kpi-card-total-return">Total return {{ raw_kpis.total_return | round(2) }}x</div>
          <details class="kpi-card-details">
            <summary>O que é isto? · <span style="font-weight:700;color:#99f6e4;">Saber mais</span></summary>
            <div class="kpi-card-details-body">
              Curva <strong>teórica</strong> do motor <strong>antes</strong> das molduras aplicadas ao produto investível (overlay CAP15, limites de drawdown, vol por perfil, etc.). <strong>Não é investível</strong> — mostra a «potência» bruta do modelo face à versão apresentada ao cliente no cartão ao lado.
            </div>
          </details>
        </div>
        <div class="card {{ 'col-3' if compare_cap100_kpis else 'col-4' }} kpi-main-compare">
          <div class="label">{% if cap15_only %}{{ cap15_human_label_pt }}{% else %}Modelo (estratégia apresentada){% endif %}</div>
          {% if cap15_only %}
          <div class="kpi-cap15-micro-hint" style="font-size:0.74rem;font-weight:750;letter-spacing:0.045em;text-transform:uppercase;margin-top:6px;line-height:1.4;">Versão otimizada para implementação real</div>
          {% endif %}
          <div class="value positive">{{ (model_kpis.cagr * 100) | round(2) }}% <span class="muted" style="font-size:0.75rem;">CAGR</span></div>
          {% if cap15_only %}
          <div class="kpi-cap15-costs-hint" style="font-size:0.84rem;margin-top:9px;line-height:1.45;font-weight:650;">Rentabilidade líquida de custos estimados de transação e slippage. Não inclui impostos nem comissões da plataforma.</div>
          {% endif %}
          <div class="kpi-cagr-hint kpi-simple-only" style="font-size:0.7rem;margin-top:6px;line-height:1.35;">Ganho médio anual composto no histórico ilustrativo — não garante resultados futuros.</div>
          <div class="kpi-line kpi-advanced-only">Vol {{ (model_kpis.volatility * 100) | round(2) }}%</div>
          <div class="kpi-line kpi-simple-only">Risco esperado (vol.) {{ (model_kpis.volatility * 100) | round(2) }}%</div>
          <div class="kpi-line kpi-advanced-only">Sharpe {{ model_kpis.sharpe | round(2) }}</div>
          <div class="kpi-line value negative kpi-advanced-only">Max DD {{ (model_kpis.max_drawdown * 100) | round(2) }}%</div>
          <div class="kpi-line value negative kpi-simple-only">Queda máxima histórica {{ (model_kpis.max_drawdown * 100) | round(2) }}%</div>
          <div class="kpi-advanced-only kpi-card-total-return">Total return {{ model_kpis.total_return | round(2) }}x</div>
          {% if cap15_only %}
          <details class="kpi-card-details">
            <summary>O que é isto? · <span style="font-weight:700;color:#99f6e4;">Saber mais</span></summary>
            <div class="kpi-card-details-body">
              {% if current_profile == 'moderado' %}
              Histórico ilustrativo de <strong>{{ cap15_human_label_pt }}</strong> — identificação interna do motor <code>CAP15</code>. O freeze smooth usa <strong>momentum multi-horizonte prudente</strong> (<code>v2_prudent</code>) no motor V5. No perfil <strong>moderado</strong>, a <strong>volatilidade</strong> do cartão reflecte a série investível com alvo <strong>≈1×</strong> a vol do benchmark no motor (perna overlay) e o <strong>alinhamento no painel</strong> à mesma referência. No conservador e no dinâmico, o cartão investível usa ≈0,75× e ≈1,25× da vol do referencial. Exposição a risco <strong>limitada ao capital</strong> (≤100% do NAV). Rentabilidade líquida de custos estimados de transação e slippage no backtest; não inclui impostos nem comissões da plataforma. Informação indicativa — não é aconselhamento.
              {% else %}
              Histórico ilustrativo de <strong>{{ cap15_human_label_pt }}</strong> — identificação interna <code>CAP15</code> — com <strong>volatilidade alinhada ao perfil</strong> relativamente ao benchmark (≈ <strong>0,75×</strong> no conservador, ≈ <strong>1,25×</strong> no dinâmico), conforme o selector do topo. Exposição a risco <strong>limitada ao capital</strong> (≤100% do NAV). Rentabilidade líquida de custos estimados de transação e slippage no backtest; não inclui impostos nem comissões da plataforma. Informação indicativa — não é aconselhamento.
              {% endif %}
            </div>
          </details>
          {% endif %}
          {% if not client_embed and cap15_only and hedge_kpis_embed and hedge_kpis_embed.ok %}
          <div class="kpi-hedge-under">
            <div class="kpi-hedge-under-title">Com hedge ({{ hedge_kpis_embed.hedge_pct | round(0) | int }}% · {{ hedge_kpis_embed.pair }})</div>
            <div class="value positive kpi-hedge-under-value">{{ (hedge_kpis_embed.cap15.cagr * 100) | round(2) }}% <span class="muted kpi-hedge-under-cagr">CAGR</span></div>
            <div class="kpi-hedge-under-metrics">
              <div class="kpi-line kpi-advanced-only kpi-hedge-under-line">Vol {{ (hedge_kpis_embed.cap15.volatility * 100) | round(2) }}%</div>
              <div class="kpi-line kpi-advanced-only kpi-hedge-under-line">Sharpe {{ hedge_kpis_embed.cap15.sharpe | round(2) }}</div>
              <div class="kpi-line value negative kpi-hedge-under-line">Max DD {{ (hedge_kpis_embed.cap15.max_drawdown * 100) | round(2) }}%</div>
              <div class="kpi-advanced-only kpi-hedge-under-line kpi-card-total-return">Total return {{ hedge_kpis_embed.cap15.total_return | round(2) }}x</div>
            </div>
            <div class="kpi-hedge-note muted kpi-advanced-only">Mesma regra de vol por perfil que o cartão acima; o CAGR pode diferir ao retirar o factor FX da série. Ilustrativo.</div>
          </div>
          {% endif %}
        </div>
        {% if compare_cap100_kpis %}
        <div class="card col-3 kpi-main-compare">
          <div class="label">{% if compare_cap100_is_margin %}{{ cap15_human_margin_label_pt }}{% else %}{{ cap15_human_label_pt }}{% endif %}</div>
          {% if compare_cap100_is_margin and cap15_only %}
          <div class="kpi-cap15-micro-hint" style="font-size:0.74rem;font-weight:750;letter-spacing:0.045em;text-transform:uppercase;margin-top:6px;line-height:1.4;">Versão otimizada para implementação real</div>
          {% endif %}
          <div class="value positive">{{ (compare_cap100_kpis.cagr * 100) | round(2) }}% <span class="muted" style="font-size:0.75rem;">CAGR</span></div>
          {% if compare_cap100_is_margin and cap15_only %}
          <div class="kpi-cap15-costs-hint" style="font-size:0.84rem;margin-top:9px;line-height:1.45;font-weight:650;">Rentabilidade líquida de custos estimados de transação e slippage. Não inclui impostos nem comissões da plataforma.</div>
          {% endif %}
          <div class="kpi-cagr-hint kpi-simple-only" style="font-size:0.7rem;margin-top:6px;line-height:1.35;">Ganho médio anual composto no histórico ilustrativo — não garante resultados futuros.</div>
          <div class="kpi-line kpi-advanced-only">Vol {{ (compare_cap100_kpis.volatility * 100) | round(2) }}%</div>
          <div class="kpi-line kpi-simple-only">Risco esperado (vol.) {{ (compare_cap100_kpis.volatility * 100) | round(2) }}%</div>
          <div class="kpi-line kpi-advanced-only">Sharpe {{ compare_cap100_kpis.sharpe | round(2) }}</div>
          <div class="kpi-line value negative kpi-advanced-only">Max DD {{ (compare_cap100_kpis.max_drawdown * 100) | round(2) }}%</div>
          <div class="kpi-line value negative kpi-simple-only">Queda máxima histórica {{ (compare_cap100_kpis.max_drawdown * 100) | round(2) }}%</div>
          <div class="kpi-advanced-only kpi-card-total-return">Total return {{ compare_cap100_kpis.total_return | round(2) }}x</div>
          <details class="kpi-card-details">
            <summary>Nota · <span style="font-weight:700;color:#99f6e4;">Saber mais</span></summary>
            <div class="kpi-card-details-body">
              {% if compare_cap100_is_margin %}
              Variante ilustrativa <strong>com margem</strong>: a exposição económica pode exceder <strong>100%</strong> do capital nos períodos em que o motor o aplica. <strong>Não corresponde</strong> ao produto plafonado (≤100% NAV) do cartão principal. Mesma regra de vol por perfil que os outros cartões, onde aplicável (se a vol natural exceder o alvo vs benchmark, o CAGR mostrado reflecte a série já reescalada). Indicativo — não é aconselhamento.
              {% else %}
              Exposição a risco limitada a <strong>100%</strong> do NAV (sem alavancagem além do capital).
              {% if current_profile == 'moderado' %}
              A <strong>volatilidade</strong> é a <strong>realizada no backtest</strong> da série investível (<code>CAP15</code>); no motor, o moderado aplica na perna overlay alvo <strong>≈1×</strong> a vol do benchmark; o cartão reflecte também o <strong>alinhamento a ≈1×</strong> vs benchmark (como nos outros perfis, com multiplicador diferente).
              {% elif current_profile == 'conservador' %}
              A volatilidade foi ajustada para ≈ <strong>0,75×</strong> a vol do benchmark (perfil conservador).
              {% else %}
              A volatilidade foi ajustada para ≈ <strong>1,25×</strong> a vol do benchmark (perfil dinâmico).
              {% endif %}
              Não é aconselhamento.
              {% endif %}
            </div>
          </details>
          {% if not client_embed and cap15_only and hedge_kpis_embed and hedge_kpis_embed.ok and hedge_kpis_embed.compare_plafonado and hedge_kpis_embed.cap15_max100 %}
          <div class="kpi-hedge-under">
            <div class="kpi-hedge-under-title">Com hedge ({{ hedge_kpis_embed.hedge_pct | round(0) | int }}% · {{ hedge_kpis_embed.pair }})</div>
            <div class="value positive kpi-hedge-under-value">{{ (hedge_kpis_embed.cap15_max100.cagr * 100) | round(2) }}% <span class="muted kpi-hedge-under-cagr">CAGR</span></div>
            <div class="kpi-hedge-under-metrics">
              <div class="kpi-line kpi-advanced-only kpi-hedge-under-line">Vol {{ (hedge_kpis_embed.cap15_max100.volatility * 100) | round(2) }}%</div>
              <div class="kpi-line kpi-advanced-only kpi-hedge-under-line">Sharpe {{ hedge_kpis_embed.cap15_max100.sharpe | round(2) }}</div>
              <div class="kpi-line value negative kpi-hedge-under-line">Max DD {{ (hedge_kpis_embed.cap15_max100.max_drawdown * 100) | round(2) }}%</div>
              <div class="kpi-advanced-only kpi-hedge-under-line kpi-card-total-return">Total return {{ hedge_kpis_embed.cap15_max100.total_return | round(2) }}x</div>
            </div>
            <div class="kpi-hedge-note muted kpi-advanced-only">Mesma regra de vol por perfil que o cartão acima; o CAGR pode diferir ao retirar o factor FX da série. Ilustrativo.</div>
          </div>
          {% endif %}
        </div>
        {% endif %}
        <div class="card {{ 'col-3' if compare_cap100_kpis else 'col-4' }} kpi-main-compare{% if client_embed %} kpi-card-benchmark-ref{% endif %}">
          <div class="label">{% if client_embed %}Mercado (benchmark){% else %}Benchmark{% endif %}</div>
          {% if client_embed %}
          <div class="muted" style="font-size:0.72rem;margin-top:4px;line-height:1.45;font-weight:600;">Benchmark: 60% EUA / 25% Europa / 10% Japão / 5% Canadá</div>
          {% endif %}
          <div class="value positive">{{ (bench_kpis.cagr * 100) | round(2) }}% <span class="muted" style="font-size:0.75rem;">CAGR</span></div>
          <div class="kpi-cagr-hint{% if kpi_simple %} kpi-simple-only{% endif %}" style="font-size:0.7rem;margin-top:6px;line-height:1.35;">Referência passiva para comparar o histórico ilustrativo da estratégia.</div>
          <div class="kpi-line kpi-advanced-only">Vol {{ (bench_kpis.volatility * 100) | round(2) }}%</div>
          <div class="kpi-line kpi-simple-only">Risco esperado (vol.) {{ (bench_kpis.volatility * 100) | round(2) }}%</div>
          <div class="kpi-line kpi-advanced-only">Sharpe {{ bench_kpis.sharpe | round(2) }}</div>
          <div class="kpi-line value negative kpi-advanced-only">Max DD {{ (bench_kpis.max_drawdown * 100) | round(2) }}%</div>
          <div class="kpi-line value negative kpi-simple-only">Queda máxima histórica {{ (bench_kpis.max_drawdown * 100) | round(2) }}%</div>
          <div class="kpi-advanced-only kpi-card-total-return">Total return {{ bench_kpis.total_return | round(2) }}x</div>
          {% if client_embed %}
          <div class="kpi-bench-vs-rec">
            <span class="kpi-comparativo-pill">Comparativo</span>
            {% if cagr_delta_vs_bench_pp >= 0 %}
            <p class="kpi-bench-vs-rec-body">A estratégia indicada mostrou ~<strong>{{ "%.1f"|format(cagr_delta_vs_bench_pp) }}</strong> pontos percentuais por ano a mais de CAGR do que este referencial (histórico ilustrativo).</p>
            {% else %}
            <p class="kpi-bench-vs-rec-body">A estratégia indicada mostrou ~<strong>{{ "%.1f"|format(-cagr_delta_vs_bench_pp) }}</strong> pontos percentuais por ano a menos de CAGR do que este referencial (histórico ilustrativo).</p>
            {% endif %}
          </div>
          {% endif %}
          <details class="kpi-card-details">
            <summary>O que é isto? · <span style="font-weight:700;color:#99f6e4;">Saber mais</span></summary>
            <div class="kpi-card-details-body">
              Referência <strong>passiva</strong> (série histórica em <code style="color:#e5e7eb;font-size:0.82rem;">{{ bench_path.name }}</code>) usada para comparar o modelo: retorno, risco, meses acima/abaixo e alpha rolling. Não é recomendação nem produto investível — é o «termómetro» de comparação no mesmo horizonte temporal.
            </div>
          </details>
        </div>
      </div>

      {% if client_embed and cap15_only and hedge_kpis_embed and not hedge_kpis_embed.ok %}
      <div class="kpi-hedge-embed-wrap kpi-hedge-embed-fallback">
        {% if hedge_kpis_embed.reason == 'zero_pct' %}
        <p class="muted kpi-hedge-fallback-note">Preferência 0% hedge: sem ajuste FX ilustrativo nesta vista. Execução real na corretora é independente.</p>
        {% elif hedge_kpis_embed.reason == 'missing_fx' %}
        <p class="muted kpi-hedge-fallback-note">Série FX indisponível para <strong style="color:#cbd5e1;">{{ hedge_kpis_embed.pair }}</strong> (ficheiro esperado em <code style="color:#94a3b8;">backend/data/fx_{{ hedge_kpis_embed.pair }}_daily.csv</code>).</p>
        {% endif %}
      </div>
      {% endif %}

      <div class="kpi-simple-summary">
        {% if client_embed and cap15_only %}
        <strong style="color:#e5e7eb;">Resumo:</strong> o cartão <strong style="color:#5eead4;">«Recomendado para o seu perfil»</strong> alinha o horizonte ao seu nível de risco.
        Na vista avançada, o <strong style="color:#e5e7eb;">modelo teórico</strong> é só referência técnica (não investível). O cartão principal mostra <strong style="color:#e5e7eb;">{{ cap15_human_label_pt }}</strong> — versão otimizada para implementação real no backtest, exposição ≤100% NV; no <strong>moderado</strong> o motor aplica na perna overlay alvo <strong>≈1×</strong> vol do referencial e o painel alinha o cartão a <strong>≈1×</strong> vs benchmark; conservador/dinâmico têm alvo 0,75× / 1,25× no cartão investível. Identificador interno do motor: <code style="color:#a1a1aa;font-size:0.82rem;">CAP15</code>.
        Informação indicativa — não é aconselhamento nem promessa de resultados futuros.
        {% elif cap15_only %}
        Vista avançada: <strong style="color:#e5e7eb;">modelo teórico</strong> (não investível) vs <strong style="color:#e5e7eb;">{{ cap15_human_label_pt }}</strong> com custos de mercado estimados e execução realista no backtest. Perfil no topo; no <strong>moderado</strong> a vol do cartão reflecte motor (overlay ≈1×) e <strong>alinhamento no painel</strong> a ≈1× vs benchmark; em conservador/dinâmico, vol <strong>alvo vs benchmark</strong> (0,75× / 1,25×). O benchmark mantém a sua vol de mercado.
        {% else %}
        Comparação em horizonte longo com <strong style="color:#e5e7eb;">volatilidade alinhada ao benchmark</strong> (0,75× / 1× / 1,25× conforme o perfil).
        <strong style="color:#e5e7eb;">CAGR</strong> e <strong style="color:#e5e7eb;">queda máxima</strong> lado a lado com o benchmark{% if compare_cap100_kpis %} e com <strong style="color:#e5e7eb;">{{ cap15_human_label_pt }}</strong>{% endif %}.
        {% endif %}
        Para simular capital ao longo do tempo (com o seu perfil), abra <strong style="color:#5eead4;">Simulador</strong>.
        Para curvas completas e drawdowns, abra <strong style="color:#5eead4;">Gráficos</strong>.
        Informação indicativa — não é aconselhamento nem promessa de resultados futuros.
      </div>

      <div class="kpi-advanced-only">
      <h2>Indicadores mensais (modelo)</h2>
      <div class="stats-grid kpi-monthly-model-stats">
        <div class="stat-box">
          <div class="label">Melhor mês</div>
          <div class="num value positive">{{ (monthly.best_month_pct) | round(2) }}%</div>
        </div>
        <div class="stat-box">
          <div class="label">Pior mês</div>
          <div class="num value negative">{{ (monthly.worst_month_pct) | round(2) }}%</div>
        </div>
        <div class="stat-box">
          <div class="label">Meses positivos</div>
          <div class="num">{{ monthly.positive_months }} / {{ monthly.num_months }}</div>
        </div>
        <div class="stat-box">
          <div class="label">Meses negativos</div>
          <div class="num">{{ monthly.negative_months }} / {{ monthly.num_months }}</div>
        </div>
        <div class="stat-box">
          <div class="label">Meses acima do benchmark</div>
          <div class="num value positive">{{ monthly.months_above_benchmark }}</div>
        </div>
        <div class="stat-box">
          <div class="label">Meses abaixo do benchmark</div>
          <div class="num value negative">{{ monthly.months_below_benchmark }}</div>
        </div>
      </div>
      </div>

      <h2>Modo de risco e exposições</h2>
      <div class="exposure-grid">
        <div class="stats-grid" style="margin-top:0;">
          <div class="stat-box">
            <div class="label">Modo de risco atual</div>
            <div class="num">
              {% if risk_info.mode == "on" %}
              <span class="value positive">Risk ON</span>
              {% elif risk_info.mode == "off" %}
              <span class="value negative">Risk OFF</span>
              {% else %}
              <span>{{ risk_info.mode_label }}</span>
              {% endif %}
            </div>
            <div class="muted">
              {{ risk_info.mode_basis_pt }} — não equivale à % «Liquidez» da recomendação ao cliente (outra agregação).
              Exposição média histórica de tendência (contexto): {{ (risk_info.avg_risk_exposure * 100) | round(1) }}%.
            </div>
          </div>
          <div class="stat-box">
            <div class="label">Exposição a equity (actual)</div>
            <div class="num">
              {{ ((1 - risk_info.latest_tbill_exposure) * 100) | round(1) }}%
            </div>
            <div class="muted">Último dia do período</div>
          </div>
          <div class="stat-box">
            <div class="label">Exposição a equity (média histórica)</div>
            <div class="num">
              {{ ((1 - risk_info.avg_tbill_exposure) * 100) | round(1) }}%
            </div>
            <div class="muted">Target risk-on: {{ (risk_info.risk_on_target * 100) | round(0) }}%</div>
          </div>
          <div class="stat-box">
            <div class="label">Exposição a T-Bills (actual)</div>
            <div class="num">
              {{ (risk_info.latest_tbill_exposure * 100) | round(1) }}%
            </div>
            <div class="muted">Cash proxy: {{ risk_info.cash_proxy }}</div>
          </div>
          <div class="stat-box">
            <div class="label">Exposição a T-Bills (média histórica)</div>
            <div class="num">
              {{ (risk_info.avg_tbill_exposure * 100) | round(1) }}%
            </div>
            <div class="muted">Média ao longo do período</div>
          </div>
          <div class="stat-box">
            <div class="label">Turnover médio anual</div>
            <div class="num">
              {% if rebalance_info.avg_annual_turnover is not none %}
              {{ (rebalance_info.avg_annual_turnover * 100) | round(1) }}%
              {% else %}
              —
              {% endif %}
            </div>
            <div class="muted">Turnover executado por rebalance × nº execuções / {{ num_years|round(1) }} anos</div>
          </div>
        </div>
        <div class="card chart-card">
          <div class="label">Exposição actual por país + T-Bills</div>
          <div class="muted">A equity é repartida por país e escalada pela exposição actual; T-Bills aparece como fatia separada.</div>
          <div class="muted" style="margin-top:6px;font-size:0.78rem;line-height:1.45;">Exposição limitada por regras internas de diversificação.</div>
          <div class="pie-holder">
            <canvas id="countryTbillPie"></canvas>
          </div>
        </div>
      </div>

      {% if bear_low_vol_dash.show %}
      <div class="kpi-advanced-only">
      <h2>Protecção (bear + baixa vol)</h2>
      <div class="stats-grid" style="margin-top:0;">
        <div class="stat-box">
          <div class="label">Dias em protecção (últimos 12 meses)</div>
          <div class="num">
            {% if bear_low_vol_dash.pct_last_12m is not none %}
            {{ (bear_low_vol_dash.pct_last_12m) | round(2) }}%
            {% else %}
            —
            {% endif %}
          </div>
          <div class="muted">Últimos 252 dias úteis na série do modelo</div>
        </div>
        <div class="stat-box">
          <div class="label">Número de entradas em protecção (últimos 12 meses)</div>
          <div class="num">
            {% if bear_low_vol_dash.entries_last_12m is not none %}
            {{ bear_low_vol_dash.entries_last_12m }}
            {% else %}
            —
            {% endif %}
          </div>
          <div class="muted">Transições para exposição reduzida pelo overlay</div>
        </div>
      </div>
      {% if bear_low_vol_dash.show_explain %}
      <div class="card" style="margin-top:0.75rem; padding:0.85rem 1rem; max-width:52rem;">
        <div class="label" style="margin-bottom:0.35rem;">Como interpretar</div>
        <p class="muted" style="margin:0; font-size:0.88rem; line-height:1.55;">{{ bear_low_vol_dash.explain_pt }}</p>
      </div>
      {% endif %}
      </div>
      {% endif %}

      <div class="kpi-advanced-only">
      <h2>Rebalanceamento</h2>
      <div class="stats-grid">
        <div class="stat-box">
          <div class="label">Rebalances com alterações</div>
          <div class="num">
            {% if rebalance_info.n_rebalances_executed is not none %}
            {{ rebalance_info.n_rebalances_executed }}
            {% else %}
            -
            {% endif %}
          </div>
          <div class="muted">Em {{ rebalance_info.n_rebalances_opportunities or '-' }} oportunidades</div>
        </div>
        <div class="stat-box">
          <div class="label">Nº médio de ações trocadas</div>
          <div class="num">
            {% if rebalance_info.avg_trades_per_rebalance is not none %}
            {{ rebalance_info.avg_trades_per_rebalance | round(1) }}
            {% else %}
            -
            {% endif %}
          </div>
          <div class="muted">Estimado a partir do turnover</div>
        </div>
      </div>

      <div class="month-grid">
        <div class="card month-card">
          <div class="label">Maiores subidas mensais</div>
          <div class="month-list">
            {% for m in monthly.top_gains %}
            <div>{{ m.month }} <span class="value positive">{{ m.ret_pct | round(2) }}%</span></div>
            {% endfor %}
          </div>
        </div>
        <div class="card month-card">
          <div class="label">Maiores descidas mensais</div>
          <div class="month-list">
            {% for m in monthly.top_losses %}
            <div>{{ m.month }} <span class="value negative">{{ m.ret_pct | round(2) }}%</span></div>
            {% endfor %}
          </div>
        </div>
      </div>
      </div>
    </div>

    <!-- ABA: RETORNOS (YTD, 1Y, 5Y, 10Y vs benchmark) -->
    <div id="tab-horizons" class="tab-content{% if tab_default == 'horizons' %} active{% endif %}">
      {% if client_embed %}
      {% if horizons_embed_story %}
      <div class="horizon-embed-story" role="region" aria-label="Leitura do histórico">{{ horizons_embed_story.line }}</div>
      {% endif %}
      <div class="horizon-intro-one-line horizon-intro-embed" role="note" style="margin: 0 0 1rem; font-size: 0.82rem; line-height: 1.5; color: #94a3b8;">
        <span class="horizon-intro-inner horizon-intro-embed-inner">Retorno total ilustrativo no período; curvas normalizadas ao mesmo ponto de partida. <strong style="color:#cbd5e1;">Escala ajustada para comparação justa ao longo do tempo</strong> (modelo e mercado no mesmo gráfico).{% if close_as_of_date %} · Último fecho de preços: <strong style="color:#cbd5e1;">{{ close_as_of_date }}</strong>{% endif %} · Série até <strong style="color:#cbd5e1;">{{ model_dates|last }}</strong>.</span>
      </div>
      <p class="horizon-bench-composition">Mercado de referência: 60% EUA / 25% Europa / 10% Japão / 5% Canadá</p>
      <div class="horizon-embed-tabbar" role="tablist" aria-label="Horizonte temporal">
        <button type="button" class="horizon-embed-tab" role="tab" data-h="ytd" aria-selected="false">YTD</button>
        <button type="button" class="horizon-embed-tab" role="tab" data-h="y1" aria-selected="false">1 ano</button>
        <button type="button" class="horizon-embed-tab" role="tab" data-h="y5" aria-selected="false">5 anos</button>
        <button type="button" class="horizon-embed-tab active" role="tab" data-h="y10" aria-selected="true">10 anos <span class="horizon-embed-pill">Predefinido</span></button>
      </div>
      <div class="horizon-embed-panels-root">
        <div class="card chart-card horizon-embed-panel" data-panel="ytd" style="margin-top:0;">
          <div class="label">YTD (desde 1 jan {{ (model_dates|last)[:4] }})</div>
          {% set hr = horizon_returns.ytd %}
          {% if hr.ok %}
          {% set diff_pp = hr.model_ret_pct - hr.bench_ret_pct %}
          <div class="horizon-embed-stats-grid">
            <div class="stat-box horizon-embed-stat-box--model">
              <div class="label">DECIDE {{ profile_label_pt }}</div>
              <div class="horizon-embed-metric"><span class="horizon-embed-metric-k">Retorno total</span><span class="num value {% if hr.model_ret_pct >= 0 %}positive{% else %}negative{% endif %}">{{ hr.model_ret_pct | round(2) }}%</span></div>
              <div class="horizon-embed-metric"><span class="horizon-embed-metric-k">CAGR</span><span class="num value">{% if hr.model_cagr_pct is not none %}{{ hr.model_cagr_pct | round(2) }}%/ano{% else %}—{% endif %}</span></div>
              <div class="horizon-embed-metric"><span class="horizon-embed-metric-k">Max drawdown</span><span class="num value negative">{% if hr.model_max_dd_pct is not none %}{{ hr.model_max_dd_pct | round(2) }}%{% else %}—{% endif %}</span></div>
              <div class="horizon-embed-metric"><span class="horizon-embed-metric-k">Sharpe</span><span class="num">{% if hr.model_sharpe is not none %}{{ hr.model_sharpe | round(2) }}{% else %}—{% endif %}</span></div>
            </div>
            <div class="stat-box horizon-embed-stat-box--bench">
              <div class="label">Mercado de referência</div>
              <div class="horizon-embed-metric"><span class="horizon-embed-metric-k">Retorno total</span><span class="num value {% if hr.bench_ret_pct >= 0 %}positive{% else %}negative{% endif %}">{{ hr.bench_ret_pct | round(2) }}%</span></div>
              <div class="horizon-embed-metric"><span class="horizon-embed-metric-k">CAGR</span><span class="num value">{% if hr.bench_cagr_pct is not none %}{{ hr.bench_cagr_pct | round(2) }}%/ano{% else %}—{% endif %}</span></div>
              <div class="horizon-embed-metric"><span class="horizon-embed-metric-k">Max drawdown</span><span class="num value negative">{% if hr.bench_max_dd_pct is not none %}{{ hr.bench_max_dd_pct | round(2) }}%{% else %}—{% endif %}</span></div>
            </div>
          </div>
          {% if diff_pp >= 0 %}
          <div class="horizon-diff-line horizon-diff-line--inst">Neste período, o modelo ficou acima do mercado de referência.</div>
          {% else %}
          <div class="horizon-diff-line horizon-diff-line--inst">Neste período, o modelo ficou abaixo do mercado de referência.</div>
          {% endif %}
          <div class="muted" style="font-size:0.75rem;margin-bottom:8px;">Diferença de retorno acumulado (modelo − referência): {% if diff_pp >= 0 %}+{% endif %}{{ diff_pp | round(1) }} p.p.</div>
          <div class="muted" style="font-size:0.74rem; margin-bottom:6px;">{{ hr.date_start }} → {{ hr.date_end }} · {{ hr.n_days }} dias úteis</div>
          <div class="horizon-embed-charts-row">
            <div class="pie-holder horizon-pie-holder--equity">
              <canvas id="horizonChartYtd"></canvas>
            </div>
            <div class="pie-holder horizon-pie-holder--dd">
              <div class="horizon-dd-chart-label">Drawdown no período</div>
              <canvas id="horizonDdChartYtd"></canvas>
            </div>
          </div>
          {% else %}
          <p class="muted" style="margin:0;">
            {% if hr.reason == 'short_history' %}Histórico insuficiente para este horizonte.
            {% elif hr.reason == 'non_positive_equity' %}Valores não positivos em todo o período — gráfico comparativo indisponível.
            {% elif hr.reason == 'non_finite' %}Dados inválidos neste período.
            {% else %}Dados indisponíveis para YTD.{% endif %}
          </p>
          {% endif %}
        </div>
        <div class="card chart-card horizon-embed-panel" data-panel="y1">
          <div class="label">1 ano (≈252 dias úteis)</div>
          {% set hr = horizon_returns.y1 %}
          {% if hr.ok %}
          {% set diff_pp = hr.model_ret_pct - hr.bench_ret_pct %}
          <div class="horizon-embed-stats-grid">
            <div class="stat-box horizon-embed-stat-box--model">
              <div class="label">DECIDE {{ profile_label_pt }}</div>
              <div class="horizon-embed-metric"><span class="horizon-embed-metric-k">Retorno total</span><span class="num value {% if hr.model_ret_pct >= 0 %}positive{% else %}negative{% endif %}">{{ hr.model_ret_pct | round(2) }}%</span></div>
              <div class="horizon-embed-metric"><span class="horizon-embed-metric-k">CAGR</span><span class="num value">{% if hr.model_cagr_pct is not none %}{{ hr.model_cagr_pct | round(2) }}%/ano{% else %}—{% endif %}</span></div>
              <div class="horizon-embed-metric"><span class="horizon-embed-metric-k">Max drawdown</span><span class="num value negative">{% if hr.model_max_dd_pct is not none %}{{ hr.model_max_dd_pct | round(2) }}%{% else %}—{% endif %}</span></div>
              <div class="horizon-embed-metric"><span class="horizon-embed-metric-k">Sharpe</span><span class="num">{% if hr.model_sharpe is not none %}{{ hr.model_sharpe | round(2) }}{% else %}—{% endif %}</span></div>
            </div>
            <div class="stat-box horizon-embed-stat-box--bench">
              <div class="label">Mercado de referência</div>
              <div class="horizon-embed-metric"><span class="horizon-embed-metric-k">Retorno total</span><span class="num value {% if hr.bench_ret_pct >= 0 %}positive{% else %}negative{% endif %}">{{ hr.bench_ret_pct | round(2) }}%</span></div>
              <div class="horizon-embed-metric"><span class="horizon-embed-metric-k">CAGR</span><span class="num value">{% if hr.bench_cagr_pct is not none %}{{ hr.bench_cagr_pct | round(2) }}%/ano{% else %}—{% endif %}</span></div>
              <div class="horizon-embed-metric"><span class="horizon-embed-metric-k">Max drawdown</span><span class="num value negative">{% if hr.bench_max_dd_pct is not none %}{{ hr.bench_max_dd_pct | round(2) }}%{% else %}—{% endif %}</span></div>
            </div>
          </div>
          {% if diff_pp >= 0 %}
          <div class="horizon-diff-line horizon-diff-line--inst">Neste período, o modelo ficou acima do mercado de referência.</div>
          {% else %}
          <div class="horizon-diff-line horizon-diff-line--inst">Neste período, o modelo ficou abaixo do mercado de referência.</div>
          {% endif %}
          <div class="muted" style="font-size:0.75rem;margin-bottom:8px;">Diferença de retorno acumulado (modelo − referência): {% if diff_pp >= 0 %}+{% endif %}{{ diff_pp | round(1) }} p.p.</div>
          <div class="muted" style="font-size:0.74rem; margin-bottom:6px;">{{ hr.date_start }} → {{ hr.date_end }} · {{ hr.n_days }} dias úteis</div>
          <div class="horizon-embed-charts-row">
            <div class="pie-holder horizon-pie-holder--equity">
              <canvas id="horizonChart1y"></canvas>
            </div>
            <div class="pie-holder horizon-pie-holder--dd">
              <div class="horizon-dd-chart-label">Drawdown no período</div>
              <canvas id="horizonDdChart1y"></canvas>
            </div>
          </div>
          {% else %}
          <p class="muted" style="margin:0;">
            {% if hr.reason == 'short_history' %}Histórico inferior a 1 ano de dias úteis.
            {% elif hr.reason == 'non_positive_equity' %}Valores não positivos em todo o período — gráfico comparativo indisponível.
            {% elif hr.reason == 'non_finite' %}Dados inválidos neste período.
            {% else %}Dados indisponíveis.{% endif %}
          </p>
          {% endif %}
        </div>
        <div class="card chart-card horizon-embed-panel" data-panel="y5">
          <div class="label">5 anos (≈1260 dias úteis)</div>
          {% set hr = horizon_returns.y5 %}
          {% if hr.ok %}
          {% set diff_pp = hr.model_ret_pct - hr.bench_ret_pct %}
          <div class="horizon-embed-stats-grid">
            <div class="stat-box horizon-embed-stat-box--model">
              <div class="label">DECIDE {{ profile_label_pt }}</div>
              <div class="horizon-embed-metric"><span class="horizon-embed-metric-k">Retorno total</span><span class="num value {% if hr.model_ret_pct >= 0 %}positive{% else %}negative{% endif %}">{{ hr.model_ret_pct | round(2) }}%</span></div>
              <div class="horizon-embed-metric"><span class="horizon-embed-metric-k">CAGR</span><span class="num value">{% if hr.model_cagr_pct is not none %}{{ hr.model_cagr_pct | round(2) }}%/ano{% else %}—{% endif %}</span></div>
              <div class="horizon-embed-metric"><span class="horizon-embed-metric-k">Max drawdown</span><span class="num value negative">{% if hr.model_max_dd_pct is not none %}{{ hr.model_max_dd_pct | round(2) }}%{% else %}—{% endif %}</span></div>
              <div class="horizon-embed-metric"><span class="horizon-embed-metric-k">Sharpe</span><span class="num">{% if hr.model_sharpe is not none %}{{ hr.model_sharpe | round(2) }}{% else %}—{% endif %}</span></div>
            </div>
            <div class="stat-box horizon-embed-stat-box--bench">
              <div class="label">Mercado de referência</div>
              <div class="horizon-embed-metric"><span class="horizon-embed-metric-k">Retorno total</span><span class="num value {% if hr.bench_ret_pct >= 0 %}positive{% else %}negative{% endif %}">{{ hr.bench_ret_pct | round(2) }}%</span></div>
              <div class="horizon-embed-metric"><span class="horizon-embed-metric-k">CAGR</span><span class="num value">{% if hr.bench_cagr_pct is not none %}{{ hr.bench_cagr_pct | round(2) }}%/ano{% else %}—{% endif %}</span></div>
              <div class="horizon-embed-metric"><span class="horizon-embed-metric-k">Max drawdown</span><span class="num value negative">{% if hr.bench_max_dd_pct is not none %}{{ hr.bench_max_dd_pct | round(2) }}%{% else %}—{% endif %}</span></div>
            </div>
          </div>
          {% if diff_pp >= 0 %}
          <div class="horizon-diff-line horizon-diff-line--inst">Neste período, o modelo ficou acima do mercado de referência.</div>
          {% else %}
          <div class="horizon-diff-line horizon-diff-line--inst">Neste período, o modelo ficou abaixo do mercado de referência.</div>
          {% endif %}
          <div class="muted" style="font-size:0.75rem;margin-bottom:8px;">Diferença de retorno acumulado (modelo − referência): {% if diff_pp >= 0 %}+{% endif %}{{ diff_pp | round(1) }} p.p.</div>
          <div class="muted" style="font-size:0.74rem; margin-bottom:6px;">{{ hr.date_start }} → {{ hr.date_end }} · {{ hr.n_days }} dias úteis</div>
          <div class="horizon-embed-charts-row">
            <div class="pie-holder horizon-pie-holder--equity">
              <canvas id="horizonChart5y"></canvas>
            </div>
            <div class="pie-holder horizon-pie-holder--dd">
              <div class="horizon-dd-chart-label">Drawdown no período</div>
              <canvas id="horizonDdChart5y"></canvas>
            </div>
          </div>
          {% else %}
          <p class="muted" style="margin:0;">
            {% if hr.reason == 'short_history' %}Histórico inferior a 5 anos de dias úteis.
            {% elif hr.reason == 'non_positive_equity' %}Valores não positivos em todo o período — gráfico comparativo indisponível.
            {% elif hr.reason == 'non_finite' %}Dados inválidos neste período.
            {% else %}Dados indisponíveis.{% endif %}
          </p>
          {% endif %}
        </div>
        <div class="card chart-card horizon-embed-panel active" data-panel="y10">
          <div class="label">10 anos (≈2520 dias úteis)</div>
          {% set hr = horizon_returns.y10 %}
          {% if hr.ok %}
          {% set diff_pp = hr.model_ret_pct - hr.bench_ret_pct %}
          <div class="horizon-embed-stats-grid">
            <div class="stat-box horizon-embed-stat-box--model">
              <div class="label">DECIDE {{ profile_label_pt }}</div>
              <div class="horizon-embed-metric"><span class="horizon-embed-metric-k">Retorno total</span><span class="num value {% if hr.model_ret_pct >= 0 %}positive{% else %}negative{% endif %}">{{ hr.model_ret_pct | round(2) }}%</span></div>
              <div class="horizon-embed-metric"><span class="horizon-embed-metric-k">CAGR</span><span class="num value">{% if hr.model_cagr_pct is not none %}{{ hr.model_cagr_pct | round(2) }}%/ano{% else %}—{% endif %}</span></div>
              <div class="horizon-embed-metric"><span class="horizon-embed-metric-k">Max drawdown</span><span class="num value negative">{% if hr.model_max_dd_pct is not none %}{{ hr.model_max_dd_pct | round(2) }}%{% else %}—{% endif %}</span></div>
              <div class="horizon-embed-metric"><span class="horizon-embed-metric-k">Sharpe</span><span class="num">{% if hr.model_sharpe is not none %}{{ hr.model_sharpe | round(2) }}{% else %}—{% endif %}</span></div>
            </div>
            <div class="stat-box horizon-embed-stat-box--bench">
              <div class="label">Mercado de referência</div>
              <div class="horizon-embed-metric"><span class="horizon-embed-metric-k">Retorno total</span><span class="num value {% if hr.bench_ret_pct >= 0 %}positive{% else %}negative{% endif %}">{{ hr.bench_ret_pct | round(2) }}%</span></div>
              <div class="horizon-embed-metric"><span class="horizon-embed-metric-k">CAGR</span><span class="num value">{% if hr.bench_cagr_pct is not none %}{{ hr.bench_cagr_pct | round(2) }}%/ano{% else %}—{% endif %}</span></div>
              <div class="horizon-embed-metric"><span class="horizon-embed-metric-k">Max drawdown</span><span class="num value negative">{% if hr.bench_max_dd_pct is not none %}{{ hr.bench_max_dd_pct | round(2) }}%{% else %}—{% endif %}</span></div>
            </div>
          </div>
          {% if diff_pp >= 0 %}
          <div class="horizon-diff-line horizon-diff-line--inst">Neste período, o modelo ficou acima do mercado de referência.</div>
          {% else %}
          <div class="horizon-diff-line horizon-diff-line--inst">Neste período, o modelo ficou abaixo do mercado de referência.</div>
          {% endif %}
          <div class="muted" style="font-size:0.75rem;margin-bottom:8px;">Diferença de retorno acumulado (modelo − referência): {% if diff_pp >= 0 %}+{% endif %}{{ diff_pp | round(1) }} p.p.</div>
          <div class="muted" style="font-size:0.74rem; margin-bottom:6px;">{{ hr.date_start }} → {{ hr.date_end }} · {{ hr.n_days }} dias úteis</div>
          <div class="horizon-embed-charts-row">
            <div class="pie-holder horizon-pie-holder--equity">
              <canvas id="horizonChart10y"></canvas>
            </div>
            <div class="pie-holder horizon-pie-holder--dd">
              <div class="horizon-dd-chart-label">Drawdown no período</div>
              <canvas id="horizonDdChart10y"></canvas>
            </div>
          </div>
          {% else %}
          <p class="muted" style="margin:0;">
            {% if hr.reason == 'short_history' %}Histórico inferior a 10 anos de dias úteis.
            {% elif hr.reason == 'non_positive_equity' %}Valores não positivos em todo o período — gráfico comparativo indisponível.
            {% elif hr.reason == 'non_finite' %}Dados inválidos neste período.
            {% else %}Dados indisponíveis.{% endif %}
          </p>
          {% endif %}
        </div>
      </div>
      <div class="horizon-embed-cta" role="note">
        Baseado neste histórico ilustrativo, o plano proposto procura alinhar-se a este tipo de comportamento <strong style="color:#cbd5e1;">relativo ao mercado de referência</strong>.
        O passo seguinte é rever e <strong style="color:#5eead4;">confirmar o plano</strong> quando estiver confortável (atalho «Ver plano» no topo do dashboard).
      </div>
      {% else %}
      <div class="horizon-intro-one-line" role="note" style="margin: 0 0 1rem; font-size: 0.88rem; line-height: 1.45; color: #94a3b8;">
        <span class="horizon-intro-inner">Retorno total no período (ilustrativo) e evolução das curvas normalizadas a 1 no primeiro dia da janela — gráfico em <strong style="color:#cbd5e1;">escala log</strong> para comparar com o benchmark no mesmo eixo{% if close_as_of_date %}<span style="color:#64748b;"> · </span>Último fecho de preços (<code style="color:#94a3b8;font-size:0.78rem;">backend/data/prices_close.csv</code>): <strong style="color:#cbd5e1;">{{ close_as_of_date }}</strong>{% endif %}<span style="color:#64748b;"> · </span>Último dia da série do modelo/benchmark nesta página: <strong style="color:#cbd5e1;">{{ model_dates|last }}</strong></span>
      </div>
      <div class="horizon-grid-2x2">
        <div class="card chart-card" style="margin-top:0;">
          <div class="label">YTD (desde 1 jan {{ (model_dates|last)[:4] }})</div>
          {% set hr = horizon_returns.ytd %}
          {% if hr.ok %}
          <div class="stats-grid" style="margin-bottom: 12px;">
            <div class="stat-box">
              <div class="label">{{ model_display_label }}</div>
              <div class="num value {% if hr.model_ret_pct >= 0 %}positive{% else %}negative{% endif %}">{{ hr.model_ret_pct | round(2) }}%</div>
            </div>
            <div class="stat-box">
              <div class="label">Benchmark</div>
              <div class="num value {% if hr.bench_ret_pct >= 0 %}positive{% else %}negative{% endif %}">{{ hr.bench_ret_pct | round(2) }}%</div>
            </div>
            <div class="stat-box">
              <div class="label">Dias úteis</div>
              <div class="num">{{ hr.n_days }}</div>
            </div>
          </div>
          <div class="muted" style="font-size:0.75rem; margin-bottom:8px;">{{ hr.date_start }} → {{ hr.date_end }}</div>
          <div class="pie-holder" style="min-height: 220px;">
            <canvas id="horizonChartYtd"></canvas>
          </div>
          {% else %}
          <p class="muted" style="margin:0;">
            {% if hr.reason == 'short_history' %}Histórico insuficiente para este horizonte.
            {% elif hr.reason == 'non_positive_equity' %}Valores não positivos em todo o período — escala log indisponível.
            {% elif hr.reason == 'non_finite' %}Dados inválidos neste período.
            {% else %}Dados indisponíveis para YTD.{% endif %}
          </p>
          {% endif %}
        </div>
        <div class="card chart-card">
          <div class="label">1 ano (≈252 dias úteis)</div>
          {% set hr = horizon_returns.y1 %}
          {% if hr.ok %}
          <div class="stats-grid" style="margin-bottom: 12px;">
            <div class="stat-box">
              <div class="label">{{ model_display_label }}</div>
              <div class="num value {% if hr.model_ret_pct >= 0 %}positive{% else %}negative{% endif %}">{{ hr.model_ret_pct | round(2) }}%</div>
            </div>
            <div class="stat-box">
              <div class="label">Benchmark</div>
              <div class="num value {% if hr.bench_ret_pct >= 0 %}positive{% else %}negative{% endif %}">{{ hr.bench_ret_pct | round(2) }}%</div>
            </div>
            <div class="stat-box">
              <div class="label">Dias úteis</div>
              <div class="num">{{ hr.n_days }}</div>
            </div>
          </div>
          <div class="muted" style="font-size:0.75rem; margin-bottom:8px;">{{ hr.date_start }} → {{ hr.date_end }}</div>
          <div class="pie-holder" style="min-height: 220px;">
            <canvas id="horizonChart1y"></canvas>
          </div>
          {% else %}
          <p class="muted" style="margin:0;">
            {% if hr.reason == 'short_history' %}Histórico inferior a 1 ano de dias úteis.
            {% elif hr.reason == 'non_positive_equity' %}Valores não positivos em todo o período — escala log indisponível.
            {% elif hr.reason == 'non_finite' %}Dados inválidos neste período.
            {% else %}Dados indisponíveis.{% endif %}
          </p>
          {% endif %}
        </div>
        <div class="card chart-card">
          <div class="label">5 anos (≈1260 dias úteis)</div>
          {% set hr = horizon_returns.y5 %}
          {% if hr.ok %}
          <div class="stats-grid" style="margin-bottom: 12px;">
            <div class="stat-box">
              <div class="label">{{ model_display_label }}</div>
              <div class="num value {% if hr.model_ret_pct >= 0 %}positive{% else %}negative{% endif %}">{{ hr.model_ret_pct | round(2) }}%</div>
            </div>
            <div class="stat-box">
              <div class="label">Benchmark</div>
              <div class="num value {% if hr.bench_ret_pct >= 0 %}positive{% else %}negative{% endif %}">{{ hr.bench_ret_pct | round(2) }}%</div>
            </div>
            <div class="stat-box">
              <div class="label">Dias úteis</div>
              <div class="num">{{ hr.n_days }}</div>
            </div>
          </div>
          <div class="muted" style="font-size:0.75rem; margin-bottom:8px;">{{ hr.date_start }} → {{ hr.date_end }}</div>
          <div class="pie-holder" style="min-height: 220px;">
            <canvas id="horizonChart5y"></canvas>
          </div>
          {% else %}
          <p class="muted" style="margin:0;">
            {% if hr.reason == 'short_history' %}Histórico inferior a 5 anos de dias úteis.
            {% elif hr.reason == 'non_positive_equity' %}Valores não positivos em todo o período — escala log indisponível.
            {% elif hr.reason == 'non_finite' %}Dados inválidos neste período.
            {% else %}Dados indisponíveis.{% endif %}
          </p>
          {% endif %}
        </div>
        <div class="card chart-card">
          <div class="label">10 anos (≈2520 dias úteis)</div>
          {% set hr = horizon_returns.y10 %}
          {% if hr.ok %}
          <div class="stats-grid" style="margin-bottom: 12px;">
            <div class="stat-box">
              <div class="label">{{ model_display_label }}</div>
              <div class="num value {% if hr.model_ret_pct >= 0 %}positive{% else %}negative{% endif %}">{{ hr.model_ret_pct | round(2) }}%</div>
            </div>
            <div class="stat-box">
              <div class="label">Benchmark</div>
              <div class="num value {% if hr.bench_ret_pct >= 0 %}positive{% else %}negative{% endif %}">{{ hr.bench_ret_pct | round(2) }}%</div>
            </div>
            <div class="stat-box">
              <div class="label">Dias úteis</div>
              <div class="num">{{ hr.n_days }}</div>
            </div>
          </div>
          <div class="muted" style="font-size:0.75rem; margin-bottom:8px;">{{ hr.date_start }} → {{ hr.date_end }}</div>
          <div class="pie-holder" style="min-height: 220px;">
            <canvas id="horizonChart10y"></canvas>
          </div>
          {% else %}
          <p class="muted" style="margin:0;">
            {% if hr.reason == 'short_history' %}Histórico inferior a 10 anos de dias úteis.
            {% elif hr.reason == 'non_positive_equity' %}Valores não positivos em todo o período — escala log indisponível.
            {% elif hr.reason == 'non_finite' %}Dados inválidos neste período.
            {% else %}Dados indisponíveis.{% endif %}
          </p>
          {% endif %}
        </div>
      </div>
      {% endif %}
    </div>

    <!-- ABA: SIMULADOR (embed narrativo: simulação → histórico → risco → CTA; sem simulador na aba Gráficos) -->
    <div id="tab-simulator" class="tab-content{% if tab_default == 'simulator' %} active{% endif %}">
      {% if client_embed and charts_embed_context %}
      {% set ce = charts_embed_context %}
      <div class="kpi-charts-embed-hero kpi-charts-embed-hero--minimal" role="region" aria-label="Aviso sobre resultados ilustrativos">
        <p class="kpi-charts-embed-hero-compliance">Ilustrativo — não garante resultados futuros. Cruze com o seu perfil e com a documentação de custos e riscos.</p>
      </div>
      <div class="kpi-charts-inner kpi-charts-inner--embed kpi-charts-inner--embed-narrative" style="{% if not client_embed %}display:flex; flex-direction:column; gap:1.5rem; margin-top:0.5rem;{% endif %}">
        <div id="kpi-embed-simulator-anchor" class="kpi-charts-simulator-embed">
        {{ simulator_client_embed_panel() }}
        </div>
      </div>
      {% else %}
      {{ simulator_client_embed_panel() }}
      {% endif %}
    </div>

    <!-- ABA 2: GRÁFICOS -->
    <div id="tab-charts" class="tab-content{% if tab_default == 'charts' %} active{% endif %}">
      {% if client_embed and charts_embed_context %}
      <div class="kpi-charts-embed-hero kpi-charts-embed-hero--minimal" role="region" aria-label="Aviso sobre resultados ilustrativos">
        <p class="kpi-charts-embed-hero-compliance">Ilustrativo — não garante resultados futuros. Cruze com o seu perfil e com a documentação de custos e riscos.</p>
      </div>
      {% endif %}
      <div class="kpi-charts-inner{% if client_embed %} kpi-charts-inner--embed{% if charts_embed_context %} kpi-charts-inner--embed-narrative{% endif %}{% endif %}" style="{% if not client_embed %}display:flex; flex-direction:column; gap:1.5rem; margin-top:0.5rem;{% endif %}">
        {# Longo prazo (equity + DD): sempre no embed; antes estavam só no {% else %} e sumiam com charts_embed_context. #}
        {% if client_embed and charts_embed_context %}
        <div class="kpi-charts-embed-summary" role="region" aria-label="Indicadores do modelo (ilustrativos)">
          <div class="kpi-charts-embed-summary-card">
            <div class="kpi-charts-embed-summary-label">CAGR modelo</div>
            <div class="kpi-charts-embed-summary-value">{{ (model_kpis.cagr * 100) | round(2) }}%</div>
          </div>
          <div class="kpi-charts-embed-summary-card">
            <div class="kpi-charts-embed-summary-label">Sharpe</div>
            <div class="kpi-charts-embed-summary-value">{{ model_kpis.sharpe | round(2) }}</div>
          </div>
          <div class="kpi-charts-embed-summary-card">
            <div class="kpi-charts-embed-summary-label">Max drawdown</div>
            <div class="kpi-charts-embed-summary-value kpi-charts-embed-summary-value--dd">{{ (model_kpis.max_drawdown * 100) | round(2) }}%</div>
          </div>
        </div>
        <div class="kpi-charts-primary-row">
        {% endif %}
        <div class="kpi-chart-panel kpi-chart-panel--zoomable" title="Clique para ver em ecrã inteiro">
          <button type="button" class="kpi-chart-fs-exit" aria-label="Diminuir gráfico">Diminuir</button>
          {% if client_embed %}
          <div class="label kpi-chart-title-simple">Evolução do investimento vs mercado</div>
          <div class="label kpi-chart-title-advanced">Curvas em escala log (modelo vs benchmark)</div>
          {% else %}
          <div class="label">Curvas em escala log (modelo vs benchmark)</div>
          {% endif %}
          {% if client_embed %}
          <div class="kpi-chart-canvas-slot kpi-chart-canvas-slot--embed-primary">
          {% endif %}
          <canvas id="equityChart" height="140"></canvas>
          {% if client_embed %}
          </div>
          {% endif %}
        </div>
        <div class="kpi-chart-panel kpi-chart-panel--zoomable" title="Clique para ver em ecrã inteiro">
          <button type="button" class="kpi-chart-fs-exit" aria-label="Diminuir gráfico">Diminuir</button>
          {% if client_embed %}
          <div class="label kpi-chart-title-simple">Perdas máximas ao longo do tempo</div>
          <div class="label kpi-chart-title-advanced">Drawdowns (modelo vs benchmark)</div>
          {% else %}
          <div class="label">Drawdowns (modelo vs benchmark)</div>
          {% endif %}
          {% if client_embed and charts_embed_context and compare_cap100_is_margin %}
          <div class="kpi-dd-margin-toggle-wrap">
            <label class="kpi-dd-margin-toggle">
              <input type="checkbox" id="kpiDdShowMargin" autocomplete="off" />
              <span>Mostrar linha «com margem» <span style="color:#64748b;font-weight:600;">(ilustrativo)</span></span>
            </label>
          </div>
          {% endif %}
          {% if client_embed %}
          <div class="kpi-chart-canvas-slot kpi-chart-canvas-slot--embed-primary">
          {% endif %}
          <canvas id="ddChart" height="140"></canvas>
          {% if client_embed %}
          </div>
          {% endif %}
        </div>
        {% if client_embed and charts_embed_context %}
        </div>
        <details class="kpi-charts-embed-more">
          <summary>Mais análises <span style="color:#64748b;font-weight:600;">(opcional)</span> — vantagem a 12 meses e retornos anuais</summary>
          <div class="kpi-charts-secondary-row">
        {% endif %}
        <div class="kpi-chart-panel kpi-chart-panel--zoomable" title="Clique para ver em ecrã inteiro">
          <button type="button" class="kpi-chart-fs-exit" aria-label="Diminuir gráfico">Diminuir</button>
          {% if client_embed %}
          <div class="label kpi-chart-title-simple">Vantagem do modelo vs mercado (últimos 12 meses)</div>
          <div class="label kpi-chart-title-advanced">Rolling 1Y alpha vs benchmark (modelo)</div>
          {% else %}
          <div class="label">Rolling 1Y alpha vs benchmark (modelo)</div>
          {% endif %}
          {% if client_embed and charts_embed_context %}
          <p class="kpi-chart-alpha-hint">Valores acima de zero indicam períodos em que a estratégia superou o mercado.</p>
          {% endif %}
          <canvas id="alphaChart" height="140"></canvas>
        </div>
        {% if yearly_bar_years and yearly_bar_years|length > 0 %}
        <div class="kpi-chart-panel kpi-chart-panel--zoomable" title="Clique para ver em ecrã inteiro">
          <button type="button" class="kpi-chart-fs-exit" aria-label="Diminuir gráfico">Diminuir</button>
          {% if client_embed %}
          <div class="label kpi-chart-title-simple">Retorno por ano (estratégia vs mercado)</div>
          <div class="label kpi-chart-title-advanced">Retorno por ano civil — {{ cap15_human_label_pt }} vs benchmark (%)</div>
          <div class="muted kpi-chart-title-advanced" style="font-size:0.75rem; margin-bottom:0.35rem;">Primeiro ao último dia útil de cada ano na série; para um ano civil equivale ao retorno total desse ano.</div>
          <div class="muted kpi-chart-title-simple" style="font-size:0.75rem; margin-bottom:0.35rem;">Comparação anual entre a estratégia, a versão com limite de exposição e o mercado de referência.</div>
          {% else %}
          <div class="label">Retorno por ano civil — {{ cap15_human_label_pt }} vs benchmark (%)</div>
          <div class="muted" style="font-size:0.75rem; margin-bottom:0.35rem;">Primeiro ao último dia útil de cada ano na série; para um ano civil equivale ao retorno total desse ano.</div>
          {% endif %}
          <canvas id="yearlyReturnChart" height="160"></canvas>
        </div>
        {% endif %}
        {% if client_embed and charts_embed_context %}
          </div>
        </details>
        <div class="kpi-charts-embed-footer" role="note">
          <p style="margin:0 0 10px; line-height:1.55;">
            O plano proposto procura <strong style="color:#cbd5e1;">refletir esta lógica de investimento</strong>, ajustada ao seu perfil de risco e às condições atuais de mercado.
          </p>
          <p style="margin:0 0 10px; line-height:1.55;">
            A decisão final de investimento será sempre sua, após revisão e aprovação das recomendações.
          </p>
          <p style="margin:0 0 10px; font-size:0.76rem; color:#64748b; line-height:1.45;">
            A estratégia é revista regularmente para garantir alinhamento com o seu perfil e evolução dos mercados.
          </p>
          <p style="margin:0; font-size:0.78rem; line-height:1.45;">
            Quando estiver confortável, abra a vista <strong style="color:#5eead4;">Simulação</strong> e utilize o botão <strong style="color:#5eead4;">«Ver plano para a sua carteira»</strong> após rever o histórico e o risco para o passo regulamentar aplicável.
          </p>
        </div>
        {% endif %}
      </div>
    </div>

    {% if not client_embed %}
    <div id="tab-diagnostics" class="tab-content{% if tab_default == 'diagnostics' %} active{% endif %}">
      <div class="diag-wrap" style="display:flex; flex-direction:column; gap:1.25rem; margin-top:0.5rem;">
        <div style="font-size:0.82rem; color:#94a3b8; line-height:1.5; max-width:920px;">
          Testes de <strong style="color:#e2e8f0;">degradação vs regime</strong>: janelas móveis (3y/5y/10y), spread vs benchmark,
          Sharpe, drawdown intra-janela, recuperação, hit-rate mensal, blocos temporais fixos, regimes do benchmark e contributos.
          <span style="color:#71717a;">Turnover rolling e estabilidade de ranking exigem séries não disponíveis aqui — ver notas.</span>
        </div>
        {% if diagnostics and diagnostics.ok and diagnostics.decision_panel %}
        <div style="background:linear-gradient(165deg, rgba(15,23,42,0.65) 0%, rgba(24,24,27,0.97) 100%); border:1px solid rgba(99,102,241,0.38); border-radius:16px; padding:18px 20px;">
          <div style="font-size:0.72rem; font-weight:900; letter-spacing:0.08em; color:#a5b4fc; text-transform:uppercase; margin-bottom:12px;">Painel de decisão (resumo executivo)</div>
          {% set p = diagnostics.decision_panel %}
          <div style="display:flex; flex-wrap:wrap; align-items:flex-start; gap:14px; margin-bottom:14px;">
            <div style="font-size:2rem; line-height:1;" aria-hidden="true">
              {% if p.executive_traffic == 'ok' %}🟢{% elif p.executive_traffic == 'compressed' %}🟡{% else %}🔴{% endif %}
            </div>
            <div style="flex:1; min-width:220px;">
              <div style="font-size:1.08rem; font-weight:800; color:#fafafa; margin-bottom:6px;">{{ p.executive_headline_pt }}</div>
              <div style="font-size:0.84rem; color:#cbd5e1; line-height:1.5;">{{ p.executive_detail_pt }}</div>
            </div>
          </div>
          <div style="font-size:0.7rem; font-weight:800; letter-spacing:0.06em; color:#71717a; text-transform:uppercase; margin:16px 0 8px;">Drivers (leitura rápida)</div>
          <div style="display:flex; flex-direction:column; gap:10px;">
            {% for d in p.drivers %}
            <div style="display:grid; grid-template-columns:28px 1fr; gap:10px; align-items:start; padding:10px 12px; border-radius:12px; background:rgba(39,39,42,0.5); border:1px solid rgba(63,63,70,0.6);">
              <div style="font-size:1.25rem; line-height:1; padding-top:2px;" aria-hidden="true">
                {% if d.lamp == 'green' %}🟢{% elif d.lamp == 'yellow' %}🟡{% else %}🔴{% endif %}
              </div>
              <div>
                <div style="font-size:0.82rem; font-weight:800; color:#e4e4e7;">{{ d.label_pt }}</div>
                <div style="font-size:0.76rem; color:#a1a1aa; line-height:1.45; margin-top:4px;">{{ d.detail_pt }}</div>
              </div>
            </div>
            {% endfor %}
          </div>
          <div style="margin-top:16px; padding:14px 16px; border-radius:12px; background:rgba(13,148,136,0.12); border:1px solid rgba(45,212,191,0.35);">
            <div style="font-size:0.68rem; font-weight:800; letter-spacing:0.07em; color:#5eead4; text-transform:uppercase; margin-bottom:6px;">Decisão sugerida (heurística)</div>
            <div style="font-size:0.92rem; font-weight:700; color:#ecfdf5; line-height:1.5;">{{ p.suggested_action_pt }}</div>
          </div>
        </div>
        {% endif %}
        {% if diagnostics and diagnostics.ok and diagnostics.temporal_degradation %}
        {% set td = diagnostics.temporal_degradation %}
        <div style="background:rgba(24,24,27,0.88); border:1px solid rgba(63,63,70,0.75); border-radius:16px; padding:16px 18px;">
          <div style="font-size:0.72rem; font-weight:800; letter-spacing:0.08em; color:#94a3b8; text-transform:uppercase; margin-bottom:10px;">Degradação temporal (spread rolling 5y)</div>
          <div style="font-size:0.82rem; color:#d4d4d8; line-height:1.55;">
            {% if td.spread_5y_mean_hist_pp is defined and td.spread_5y_mean_hist_pp is not none %}
            <div>Média histórica (toda a série finita): <strong style="color:#e2e8f0;">{{ td.spread_5y_mean_hist_pp }}%</strong> p.p. anualizados implícitos</div>
            {% endif %}
            {% if td.spread_5y_mean_last_3y_pp is defined and td.spread_5y_mean_last_3y_pp is not none %}
            <div style="margin-top:6px;">Últimos ~3 anos: <strong style="color:#e2e8f0;">{{ td.spread_5y_mean_last_3y_pp }}%</strong></div>
            {% endif %}
            {% if td.spread_5y_mean_last_2y_pp is defined and td.spread_5y_mean_last_2y_pp is not none %}
            <div style="margin-top:6px;">Últimos ~2 anos: <strong style="color:#e2e8f0;">{{ td.spread_5y_mean_last_2y_pp }}%</strong></div>
            {% endif %}
            {% if td.spread_5y_delta_last2y_vs_hist_pp is defined and td.spread_5y_delta_last2y_vs_hist_pp is not none %}
            <div style="margin-top:8px; color:#a1a1aa;">Δ (últimos 2y vs média histórica): <strong style="color:#fde68a;">{{ td.spread_5y_delta_last2y_vs_hist_pp }} p.p.</strong></div>
            {% endif %}
            {% if td.spread_short_term_momentum_pt %}
            <div style="margin-top:10px; font-size:0.8rem; color:#94a3b8;">{{ td.spread_short_term_momentum_pt }}</div>
            {% endif %}
            {% if td.sharpe_rel_5y_mean_hist is defined and td.sharpe_rel_5y_mean_hist is not none %}
            <div style="margin-top:12px; padding-top:10px; border-top:1px solid rgba(63,63,70,0.55); font-size:0.8rem; color:#a1a1aa;">
              Sharpe relativo (5y rolling) — média histórica: <strong style="color:#e2e8f0;">{{ td.sharpe_rel_5y_mean_hist }}</strong>
              {% if td.sharpe_rel_5y_mean_last_3y is defined and td.sharpe_rel_5y_mean_last_3y is not none %}
              · últimos ~3y: <strong style="color:#e2e8f0;">{{ td.sharpe_rel_5y_mean_last_3y }}</strong>
              {% endif %}
              {% if td.sharpe_rel_5y_mean_last_2y is defined and td.sharpe_rel_5y_mean_last_2y is not none %}
              · últimos ~2y: <strong style="color:#e2e8f0;">{{ td.sharpe_rel_5y_mean_last_2y }}</strong>
              {% endif %}
            </div>
            {% endif %}
          </div>
        </div>
        {% endif %}
        {% if diagnostics and diagnostics.ok and diagnostics.consistency_score and diagnostics.consistency_score.value is not none %}
        {% set cs = diagnostics.consistency_score %}
        <div style="background:rgba(24,24,27,0.88); border:1px solid rgba(63,63,70,0.75); border-radius:16px; padding:16px 18px;">
          <div style="font-size:0.72rem; font-weight:800; letter-spacing:0.08em; color:#94a3b8; text-transform:uppercase; margin-bottom:8px;">Consistency score (rolling 5y)</div>
          <div style="font-size:1.35rem; font-weight:900; color:#fafafa; margin-bottom:6px;">{{ cs.value }}<span style="font-size:0.75rem; font-weight:700; color:#71717a;"> / 100</span></div>
          <div style="font-size:0.82rem; color:#cbd5e1; line-height:1.5; margin-bottom:8px;">{{ cs.label_pt }}</div>
          <div style="font-size:0.76rem; color:#a1a1aa;">
            {% if cs.pct_spread_5y_positive is not none %}% dias com spread 5y &gt; 0: <strong style="color:#e2e8f0;">{{ cs.pct_spread_5y_positive }}%</strong>{% endif %}
            {% if cs.pct_sharpe_rel_positive is not none %}
            <span style="margin-left:10px;">% dias com Sharpe rel. &gt; 0: <strong style="color:#e2e8f0;">{{ cs.pct_sharpe_rel_positive }}%</strong></span>
            {% endif %}
          </div>
        </div>
        {% endif %}
        {% if diagnostics and diagnostics.ok %}
        <div style="background:linear-gradient(165deg, rgba(30,58,60,0.5) 0%, rgba(24,24,27,0.95) 100%); border:1px solid rgba(45,212,191,0.35); border-radius:16px; padding:16px 18px;">
          <div style="font-size:0.72rem; font-weight:800; letter-spacing:0.08em; color:#5eead4; text-transform:uppercase; margin-bottom:8px;">Conclusão automática (heurística) — detalhe</div>
          <div style="font-size:1.05rem; font-weight:800; color:#fafafa; margin-bottom:10px;">{{ diagnostics.summary_verdict }}</div>
          {% if diagnostics.summary_edge_state %}
          <div style="font-size:0.68rem; font-weight:700; letter-spacing:0.06em; color:#71717a; text-transform:uppercase; margin-bottom:8px;">Estado: {{ diagnostics.summary_edge_state }}</div>
          {% endif %}
          {% if diagnostics.summary_verdict_sub %}
          <div style="font-size:0.84rem; color:#cbd5e1; line-height:1.5; margin-bottom:10px; font-weight:650;">{{ diagnostics.summary_verdict_sub }}</div>
          {% endif %}
          <div style="font-size:0.88rem; color:#d4d4d8; line-height:1.55;">{{ diagnostics.summary_text }}</div>
          {% if diagnostics.spread_5y_early_late_pp %}
          <div style="margin-top:10px; font-size:0.78rem; color:#94a3b8;">
            Spread 5y (médias válidas): early <strong style="color:#e2e8f0;">{{ diagnostics.spread_5y_early_late_pp.early_mean_pp }}%</strong>
            → late <strong style="color:#e2e8f0;">{{ diagnostics.spread_5y_early_late_pp.late_mean_pp }}%</strong> (p.p. anualizados implícitos)
          </div>
          {% endif %}
          {% if diagnostics.spread_5y_zscore and diagnostics.spread_5y_zscore.z_score is defined and diagnostics.spread_5y_zscore.z_score is not none %}
          <div style="margin-top:8px; font-size:0.76rem; color:#a5b4fc; line-height:1.45;">
            <strong style="color:#c4b5fd;">Z-score spread 5y:</strong> {{ diagnostics.spread_5y_zscore.z_score }} σ ({{ diagnostics.spread_5y_zscore.z_band }}) ·
            μ hist. {{ diagnostics.spread_5y_zscore.hist_mean_spread_pp }} p.p., σ {{ diagnostics.spread_5y_zscore.hist_std_spread_pp }} p.p., último {{ diagnostics.spread_5y_zscore.last_spread_pp }} p.p.
          </div>
          {% endif %}
          {% if diagnostics.recovery_5y_roll_stress and diagnostics.recovery_5y_roll_stress.empirical_percentile is defined and diagnostics.recovery_5y_roll_stress.empirical_percentile is not none %}
          <div style="margin-top:6px; font-size:0.76rem; color:#fda4af; line-height:1.45;">
            <strong style="color:#fb7185;">Recuperação (rolling 5y):</strong> {{ diagnostics.recovery_5y_roll_stress.last_recovery_mean_days }} d (último) vs mediana {{ diagnostics.recovery_5y_roll_stress.hist_median_days }} d —
            percentil {{ diagnostics.recovery_5y_roll_stress.empirical_percentile }}% · <strong style="color:#fecdd3;">{{ diagnostics.recovery_5y_roll_stress.stress_band }}</strong>
          </div>
          {% endif %}
          {% if diagnostics.spread_5y_persistence and diagnostics.spread_5y_persistence.max_streak_trading_days is defined %}
          <div style="margin-top:8px; font-size:0.76rem; color:#94a3b8; line-height:1.45;">
            <strong style="color:#a7f3d0;">Persistência spread 5y &lt; 0:</strong>
            streak actual {{ diagnostics.spread_5y_persistence.suffix_streak_trading_days }} d (desde {{ diagnostics.spread_5y_persistence.suffix_run_start_date or '—' }});
            {{ diagnostics.spread_5y_persistence.pct_last_252_finite_obs }}% dos últimos ~252 pontos finitos abaixo de zero;
            streak máx. hist. {{ diagnostics.spread_5y_persistence.max_streak_trading_days }} d.
          </div>
          {% endif %}
          {% if diagnostics.sharpe_rel_5y_persistence and diagnostics.sharpe_rel_5y_persistence.max_streak_trading_days is defined %}
          <div style="margin-top:6px; font-size:0.76rem; color:#94a3b8; line-height:1.45;">
            <strong style="color:#a7f3d0;">Persistência Sharpe rel. 5y &lt; 0:</strong>
            streak actual {{ diagnostics.sharpe_rel_5y_persistence.suffix_streak_trading_days }} d (desde {{ diagnostics.sharpe_rel_5y_persistence.suffix_run_start_date or '—' }});
            {{ diagnostics.sharpe_rel_5y_persistence.pct_last_252_finite_obs }}% dos últimos ~252 pontos finitos abaixo de zero;
            streak máx. {{ diagnostics.sharpe_rel_5y_persistence.max_streak_trading_days }} d.
          </div>
          {% endif %}
          {% if diagnostics.attribution_hints and diagnostics.attribution_hints|length > 0 %}
          <div style="margin-top:12px; padding-top:10px; border-top:1px solid rgba(45,212,191,0.2); font-size:0.76rem; color:#a1a1aa; line-height:1.5;">
            <strong style="color:#5eead4;">Leitura seleção / timing / custos:</strong>
            <ul style="margin:6px 0 0 1rem; padding:0;">
              {% for line in diagnostics.attribution_hints %}<li style="margin-bottom:4px;">{{ line }}</li>{% endfor %}
            </ul>
          </div>
          {% endif %}
          {% if diagnostics.last_roll_spread_pp %}
          <div style="margin-top:12px; font-size:0.8rem; color:#94a3b8;">
            Spread CAGR rolling (último ponto · modelo − bench, p.p. anualizados):
            {% if diagnostics.last_roll_spread_pp['3y'] is not none %}<strong style="color:#e2e8f0;">3y {{ diagnostics.last_roll_spread_pp['3y'] }}%</strong>{% endif %}
            {% if diagnostics.last_roll_spread_pp['5y'] is not none %} · <strong style="color:#e2e8f0;">5y {{ diagnostics.last_roll_spread_pp['5y'] }}%</strong>{% endif %}
            {% if diagnostics.last_roll_spread_pp['10y'] is not none %} · <strong style="color:#e2e8f0;">10y {{ diagnostics.last_roll_spread_pp['10y'] }}%</strong>{% endif %}
          </div>
          {% endif %}
        </div>
        {% elif diagnostics %}
        <div style="color:#fca5a5; font-size:0.9rem;">{{ diagnostics.error or diagnostics.summary_text or 'Diagnóstico indisponível.' }}</div>
        {% endif %}

        {% if diagnostics and diagnostics.ok %}
        <div class="kpi-chart-panel kpi-chart-panel--zoomable" style="min-height:280px;">
          <button type="button" class="kpi-chart-fs-exit" aria-label="Diminuir gráfico">Diminuir</button>
          <div class="label">Rolling CAGR (5y) — modelo, benchmark e spread (modelo − benchmark)</div>
          <div class="kpi-chart-canvas-slot" style="height:260px;"><canvas id="diagChartCagr5"></canvas></div>
        </div>
        <div class="kpi-chart-panel kpi-chart-panel--zoomable" style="min-height:280px;">
          <button type="button" class="kpi-chart-fs-exit" aria-label="Diminuir gráfico">Diminuir</button>
          <div class="label">Rolling Sharpe (5y) — modelo vs benchmark</div>
          <div class="kpi-chart-canvas-slot" style="height:260px;"><canvas id="diagChartSharpe5"></canvas></div>
        </div>
        <div class="kpi-chart-panel kpi-chart-panel--zoomable" style="min-height:280px;">
          <button type="button" class="kpi-chart-fs-exit" aria-label="Diminuir gráfico">Diminuir</button>
          <div class="label">Rolling excesso log (5y) anualizado · Sharpe do excesso diário (5y)</div>
          <div class="kpi-chart-canvas-slot" style="height:260px;"><canvas id="diagChartExcess5"></canvas></div>
        </div>
        <div class="kpi-chart-panel kpi-chart-panel--zoomable" style="min-height:280px;">
          <button type="button" class="kpi-chart-fs-exit" aria-label="Diminuir gráfico">Diminuir</button>
          <div class="label">Rolling max drawdown intra-janela (5y)</div>
          <div class="kpi-chart-canvas-slot" style="height:260px;"><canvas id="diagChartMdd5"></canvas></div>
        </div>
        <div class="kpi-chart-panel kpi-chart-panel--zoomable" style="min-height:280px;">
          <button type="button" class="kpi-chart-fs-exit" aria-label="Diminuir gráfico">Diminuir</button>
          <div class="label">Recuperação (janela 5y): média dias por episódio · máx streak «underwater»</div>
          <div class="kpi-chart-canvas-slot" style="height:260px;"><canvas id="diagChartRecovery5"></canvas></div>
        </div>
        <div class="kpi-chart-panel kpi-chart-panel--zoomable" style="min-height:260px;">
          <button type="button" class="kpi-chart-fs-exit" aria-label="Diminuir gráfico">Diminuir</button>
          <div class="label">Hit rate mensal rolling: % meses modelo &gt; benchmark (12m e 24m)</div>
          <div class="kpi-chart-canvas-slot" style="height:240px;"><canvas id="diagChartHitRate"></canvas></div>
        </div>

        <h2 style="margin:0.5rem 0 0.25rem; font-size:1rem;">Blocos fixos (CAGR, Sharpe, DD, recuperação, hit-rate mensal)</h2>
        <div style="overflow-x:auto;">
          <table class="diag-table" style="width:100%; border-collapse:collapse; font-size:0.82rem;">
            <thead>
              <tr style="border-bottom:1px solid rgba(63,63,70,0.9); color:#a1a1aa;">
                <th style="text-align:left; padding:8px;">Período</th>
                <th style="text-align:right; padding:8px;">Dias</th>
                <th style="text-align:right; padding:8px;">CAGR M</th>
                <th style="text-align:right; padding:8px;">CAGR B</th>
                <th style="text-align:right; padding:8px;">Spread</th>
                <th style="text-align:right; padding:8px;">Sharpe M</th>
                <th style="text-align:right; padding:8px;">Sharpe B</th>
                <th style="text-align:right; padding:8px;">MaxDD M</th>
                <th style="text-align:right; padding:8px;">MaxDD B</th>
                <th style="text-align:right; padding:8px;">Rec. méd.</th>
                <th style="text-align:right; padding:8px;">Rec. máx</th>
                <th style="text-align:right; padding:8px;">Hit mês</th>
              </tr>
            </thead>
            <tbody>
              {% for row in diagnostics.subperiods %}
              <tr style="border-bottom:1px solid rgba(39,39,42,0.9); color:#e4e4e7;">
                <td style="padding:8px; font-weight:700;">{{ row.label }}</td>
                <td style="text-align:right; padding:8px;">{{ row.n_days or '—' }}</td>
                <td style="text-align:right; padding:8px;">{% if row.cagr_m is not none %}{{ (row.cagr_m * 100) | round(2) }}%{% else %}—{% endif %}</td>
                <td style="text-align:right; padding:8px;">{% if row.cagr_b is not none %}{{ (row.cagr_b * 100) | round(2) }}%{% else %}—{% endif %}</td>
                <td style="text-align:right; padding:8px;">{% if row.spread_cagr is not none %}{{ (row.spread_cagr * 100) | round(2) }}%{% else %}—{% endif %}</td>
                <td style="text-align:right; padding:8px;">{% if row.sharpe_m is not none %}{{ row.sharpe_m | round(2) }}{% else %}—{% endif %}</td>
                <td style="text-align:right; padding:8px;">{% if row.sharpe_b is not none %}{{ row.sharpe_b | round(2) }}{% else %}—{% endif %}</td>
                <td style="text-align:right; padding:8px;">{% if row.max_dd_m is not none %}{{ (row.max_dd_m * 100) | round(2) }}%{% else %}—{% endif %}</td>
                <td style="text-align:right; padding:8px;">{% if row.max_dd_b is not none %}{{ (row.max_dd_b * 100) | round(2) }}%{% else %}—{% endif %}</td>
                <td style="text-align:right; padding:8px;">{% if row.recovery_mean_days is not none %}{{ row.recovery_mean_days | round(0) | int }}{% else %}—{% endif %}</td>
                <td style="text-align:right; padding:8px;">{% if row.recovery_max_days is not none %}{{ row.recovery_max_days | round(0) | int }}{% else %}—{% endif %}</td>
                <td style="text-align:right; padding:8px;">{% if row.hit_rate_monthly is not none %}{{ (row.hit_rate_monthly * 100) | round(1) }}%{% else %}—{% endif %}</td>
              </tr>
              {% endfor %}
            </tbody>
          </table>
        </div>

        <h2 style="margin:0.5rem 0 0.25rem; font-size:1rem;">Regimes (sub-amostras por sinal/vol do benchmark)</h2>
        <div style="overflow-x:auto;">
          <table class="diag-table" style="width:100%; border-collapse:collapse; font-size:0.82rem;">
            <thead>
              <tr style="border-bottom:1px solid rgba(63,63,70,0.9); color:#a1a1aa;">
                <th style="text-align:left; padding:8px;">Regime</th>
                <th style="text-align:right; padding:8px;">Dias</th>
                <th style="text-align:right; padding:8px;">CAGR M</th>
                <th style="text-align:right; padding:8px;">CAGR B</th>
                <th style="text-align:right; padding:8px;">Spread</th>
                <th style="text-align:right; padding:8px;">Sharpe M</th>
                <th style="text-align:right; padding:8px;">Sharpe B</th>
                <th style="text-align:right; padding:8px;">MaxDD M</th>
                <th style="text-align:right; padding:8px;">MaxDD B</th>
              </tr>
            </thead>
            <tbody>
              {% for row in diagnostics.regimes %}
              <tr style="border-bottom:1px solid rgba(39,39,42,0.9); color:#e4e4e7;">
                <td style="padding:8px; font-weight:700;">{{ row.regime }}</td>
                <td style="text-align:right; padding:8px;">{{ row.n_days }}{% if row.note %} ({{ row.note }}){% endif %}</td>
                <td style="text-align:right; padding:8px;">{% if row.cagr_m is defined and row.cagr_m is not none %}{{ (row.cagr_m * 100) | round(2) }}%{% else %}—{% endif %}</td>
                <td style="text-align:right; padding:8px;">{% if row.cagr_b is defined and row.cagr_b is not none %}{{ (row.cagr_b * 100) | round(2) }}%{% else %}—{% endif %}</td>
                <td style="text-align:right; padding:8px;">{% if row.spread_cagr is defined and row.spread_cagr is not none %}{{ (row.spread_cagr * 100) | round(2) }}%{% else %}—{% endif %}</td>
                <td style="text-align:right; padding:8px;">{% if row.sharpe_m is defined and row.sharpe_m is not none %}{{ row.sharpe_m | round(2) }}{% else %}—{% endif %}</td>
                <td style="text-align:right; padding:8px;">{% if row.sharpe_b is defined and row.sharpe_b is not none %}{{ row.sharpe_b | round(2) }}{% else %}—{% endif %}</td>
                <td style="text-align:right; padding:8px;">{% if row.max_dd_m is defined and row.max_dd_m is not none %}{{ (row.max_dd_m * 100) | round(2) }}%{% else %}—{% endif %}</td>
                <td style="text-align:right; padding:8px;">{% if row.max_dd_b is defined and row.max_dd_b is not none %}{{ (row.max_dd_b * 100) | round(2) }}%{% else %}—{% endif %}</td>
              </tr>
              {% endfor %}
            </tbody>
          </table>
        </div>

        <h2 style="margin:0.5rem 0 0.25rem; font-size:1rem;">Contributos — top meses (modelo) e top dias por década</h2>
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:16px; font-size:0.8rem;">
          <div>
            <div style="color:#a1a1aa; margin-bottom:6px;">Top 10 meses (retorno mensal do modelo)</div>
            <ul style="margin:0; padding-left:1.1rem; color:#d4d4d8;">
              {% for x in diagnostics.top_10_months_model %}
              <li>{{ x.month }} — {{ x.ret_pct }}%</li>
              {% endfor %}
            </ul>
          </div>
          <div>
            <div style="color:#a1a1aa; margin-bottom:6px;">Top 20 dias (retorno diário do modelo)</div>
            <ul style="margin:0; padding-left:1.1rem; color:#d4d4d8; max-height:200px; overflow:auto;">
              {% for x in diagnostics.top_20_days_model %}
              <li>{{ x.date }} — {{ x.ret_pct }}%</li>
              {% endfor %}
            </ul>
          </div>
        </div>
        {% for dec, rows in diagnostics.top_days_by_decade|dictsort %}
        <div style="font-size:0.78rem; color:#94a3b8;">Década {{ dec }}s — top 10 dias: {% for x in rows %}<span style="margin-right:10px;">{{ x.date }} ({{ x.ret_pct }}%)</span>{% endfor %}</div>
        {% endfor %}

        <p style="font-size:0.76rem; color:#71717a; margin:0;">{{ diagnostics.turnover_global_note }} · {{ diagnostics.rolling_turnover_note }} · {{ diagnostics.ranking_stability_note }}</p>
        <script type="application/json" id="diagnostics-json">{{ diagnostics | tojson }}</script>
        {% endif %}
      </div>
    </div>
    {% endif %}

    <!-- ABA 3: CARTEIRA -->
    <div id="tab-portfolio" class="tab-content{% if tab_default == 'portfolio' %} active{% endif %}">
      <div class="grid">
        <div class="col-4">
          <div class="label">Peso por zona</div>
          <div class="breakdown-card">
            <div class="breakdown-list">
              {% if zone_breakdown|length == 0 %}
                <div style="color: var(--muted); font-size: .78rem; padding: 6px 0;">Sem dados de zona.</div>
              {% else %}
                {% for row in zone_breakdown %}
                <div class="breakdown-row">
                  <div class="breakdown-name" title="{{ row.zone }}">{{ row.zone }}</div>
                  <div class="breakdown-bar" aria-hidden="true">
                    <div class="breakdown-bar-fill" style="width: {{ row.weight_pct | round(2) }}%;"></div>
                  </div>
                  <div class="breakdown-value">{{ row.weight_pct | round(2) }}%</div>
                </div>
                {% endfor %}
              {% endif %}
            </div>
          </div>
        </div>
        <div class="col-8">
          <div class="label">Peso por setor</div>
          <div class="breakdown-card">
            <div class="breakdown-list">
              {% if sector_breakdown|length == 0 %}
                <div style="color: var(--muted); font-size: .78rem; padding: 6px 0;">Sem dados de sector.</div>
              {% else %}
                {% for row in sector_breakdown %}
                <div class="breakdown-row">
                  <div class="breakdown-name" title="{{ row.sector }}">{{ row.sector }}</div>
                  <div class="breakdown-bar" aria-hidden="true">
                    <div class="breakdown-bar-fill" style="width: {{ row.weight_pct | round(2) }}%;"></div>
                  </div>
                  <div class="breakdown-value">{{ row.weight_pct | round(2) }}%</div>
                </div>
                {% endfor %}
              {% endif %}
            </div>
          </div>
        </div>
      </div>

      {% if close_as_of_date %}
      <div class="muted" style="margin-top: 14px; font-size: .78rem;">
        Close (último fecho disponível em `prices_close.csv`): {{ close_as_of_date }}
      </div>
      {% endif %}

      <h2>Holdings atuais</h2>
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>Ticker</th>
            <th>Nome</th>
            <th>Zona</th>
            <th>País</th>
            <th>Setor</th>
            <th>Peso %</th>
          </tr>
        </thead>
        <tbody>
          {% for h in holdings %}
          <tr>
            <td>{{ h.rank }}</td>
            <td>{{ h.ticker }}</td>
            <td>{{ h.company }}</td>
            <td>{{ h.zone }}</td>
            <td>{{ h.country }}</td>
            <td>{{ h.sector }}</td>
            <td>{{ h.weight_pct | round(2) }}%</td>
          </tr>
          {% endfor %}
        </tbody>
      </table>
    </div>

    <!-- ABA 4: histórico de decisões da carteira (embed Next) — sem faixa técnica em demo; equipa: FRONTEND_URL / npm run dev documentados no README. -->
    <div id="tab-portfolio-history" class="tab-content{% if tab_default == 'portfolio_history' %} active{% endif %}">
      {# Sem loading="lazy": o separador começa com display:none — em vários browsers o iframe nunca entra no viewport e fica cinza vazio. #}
      <iframe
        src="{{ frontend_url }}/embed/recommendations-history?v=flow-4col-1"
        title="Histórico de decisões da carteira — DECIDE"
        style="width:100%; border:0; min-height:520px; height:3200px; background:#09090b; border-radius: 12px; display:block;"
        referrerpolicy="no-referrer-when-downgrade"
      ></iframe>
    </div>

    <!-- ABA 5: FAQs (embed Next — DecideFaqPanel) -->
    <div id="tab-faq" class="tab-content{% if tab_default == 'faq' %} active{% endif %}">
      <div class="muted" style="font-size: .78rem; margin-bottom: 10px; line-height: 1.45;">
        Perguntas frequentes e glossário — conteúdo servido pelo dashboard DECIDE (Next). Se o quadro ficar vazio: defina
        <code style="color:#e5e7eb;">FRONTEND_URL=https://www.decidepoweredbyai.com</code> no serviço do
        <code style="color:#e5e7eb;">kpi_server</code> (Render → Environment), ou
        <code style="color:#e5e7eb;">DECIDE_PUBLIC_WEB_URL</code> com o mesmo valor, ou deixe ambos vazios para inferir
        a partir do referer (o host <code style="color:#e5e7eb;">kpi.*</code> é mapeado para <code style="color:#e5e7eb;">www.*</code>).
      </div>
      <iframe
        src="{{ frontend_url }}/embed/decide-faq"
        title="FAQs DECIDE"
        style="width:100%; border:0; min-height:520px; height:2800px; background:#09090b; border-radius: 12px; display:block;"
        referrerpolicy="no-referrer-when-downgrade"
      ></iframe>
    </div>
    </div>

    <script>
      (function installEnterKeySubmit(root) {
        root.addEventListener('keydown', function (ev) {
          if (ev.key !== 'Enter' || ev.repeat) return;
          var t = ev.target;
          if (!t || t.nodeName !== 'INPUT') return;
          var ty = String(t.type || '').toLowerCase();
          if (ty === 'button' || ty === 'submit' || ty === 'reset' || ty === 'checkbox' || ty === 'radio' || ty === 'file' || ty === 'hidden' || ty === 'image' || ty === 'range' || ty === 'color') return;
          if (t.closest && t.closest('[data-no-enter-submit]')) return;
          if (ev.ctrlKey || ev.metaKey || ev.altKey || ev.shiftKey) return;

          var form = t.closest ? t.closest('form') : null;
          if (form && !form.hasAttribute('data-no-enter-submit')) {
            var p = form.querySelector('button[type="submit"][data-primary-submit]');
            if (p) {
              ev.preventDefault();
              ev.stopPropagation();
              p.click();
              return;
            }
            var sb = form.querySelector('button[type="submit"], input[type="submit"]');
            if (sb) {
              ev.preventDefault();
              ev.stopPropagation();
              sb.click();
              return;
            }
            var buttons = form.querySelectorAll('button');
            if (buttons.length === 1) {
              var b0 = buttons[0];
              if (!b0.type || b0.type === 'submit') {
                ev.preventDefault();
                ev.stopPropagation();
                b0.click();
                return;
              }
            }
            var dsel = form.getAttribute('data-enter-submit');
            if (dsel) {
              var db = root.querySelector(dsel);
              if (db) {
                ev.preventDefault();
                ev.stopPropagation();
                db.click();
                return;
              }
            }
          }

          var el = t;
          for (var i = 0; i < 40 && el; i++) {
            if (el.hasAttribute && el.hasAttribute('data-no-enter-submit')) return;
            var sel = el.getAttribute && el.getAttribute('data-enter-submit');
            if (sel) {
              var btn = root.querySelector(sel);
              if (btn) {
                ev.preventDefault();
                ev.stopPropagation();
                btn.click();
                return;
              }
            }
            el = el.parentElement;
          }
        }, true);
      })(document);

      function currentEmbedTabKey() {
        var fromTab = document.querySelector('.tab.active');
        if (fromTab && fromTab.dataset.tab) return String(fromTab.dataset.tab);
        var content = document.querySelector('.tab-content.active');
        if (!content || !content.id) return '';
        var map = {
          'tab-overview': 'overview',
          'tab-horizons': 'horizons',
          'tab-simulator': 'simulator',
          'tab-charts': 'charts',
          'tab-diagnostics': 'diagnostics',
          'tab-portfolio': 'portfolio',
          'tab-portfolio-history': 'portfolio_history',
          'tab-faq': 'faq',
        };
        return map[content.id] || '';
      }
      function reloadPreservingEmbedTab(params) {
        var url = new URL(window.location.href);
        Object.keys(params).forEach(function (k) { url.searchParams.set(k, params[k]); });
        var tab = currentEmbedTabKey();
        if (tab) url.searchParams.set('embed_tab', tab);
        window.location.href = url.toString();
      }
      // Model selector: reload with ?model=... (omitido no iframe cliente / cap15_only)
      (function () {
        const el = document.getElementById('modelSelect');
        if (!el) return;
        el.addEventListener('change', function() {
          reloadPreservingEmbedTab({ model: this.value });
        });
      })();
      // Profile selector: reload with ?profile=... (vol target: 0.75×, 1×, 1.25×); mantém o separador activo
      (function () {
        var ps = document.getElementById('profileSelect');
        if (!ps) return;
        ps.addEventListener('change', function() {
          reloadPreservingEmbedTab({ profile: this.value });
        });
      })();

      // Tabs (.tab fora do embed); no embed Next, sub-secções ficam no dashboard pai.
      const tabs = document.querySelectorAll('.tab');
      const contents = {
        overview: document.getElementById('tab-overview'),
        horizons: document.getElementById('tab-horizons'),
        simulator: document.getElementById('tab-simulator'),
        charts: document.getElementById('tab-charts'),
        diagnostics: document.getElementById('tab-diagnostics'),
        portfolio: document.getElementById('tab-portfolio'),
        portfolio_history: document.getElementById('tab-portfolio-history'),
        faq: document.getElementById('tab-faq'),
      };

      function setActiveTabContent(tabKey) {
        if (!tabKey) return;
        Object.entries(contents).forEach(([k, el]) => {
          if (!el) return;
          el.classList.toggle('active', k === tabKey);
        });
      }

      function notifyParentEmbedTab(tabKey) {
        try {
          /* Com client_embed=1 o dashboard Next (pai) precisa de sincronizar a tab ao clicar dentro do iframe. */
          if (window.parent && window.parent !== window) {
            window.parent.postMessage({ type: 'decide-kpi-embed-tab', tab: tabKey }, '*');
          }
        } catch (e) {}
      }

      function setEmbedTabUI(tabKey) {
        if (!tabKey) return;
        setActiveTabContent(tabKey);
        document.querySelectorAll('.tab').forEach(function (t) {
          var on = t.dataset.tab === tabKey;
          t.classList.toggle('active', on);
          t.setAttribute('aria-selected', on ? 'true' : 'false');
        });
        try {
          var url = new URL(window.location.href);
          url.searchParams.set('embed_tab', tabKey);
          window.history.replaceState({}, '', url.toString());
        } catch (e) {}
        notifyParentEmbedTab(tabKey);
        try {
          if (
            document.body.classList.contains('decide-kpi-embed') &&
            tabKey === 'charts' &&
            typeof window.__decideKpiResizeTabCharts === 'function'
          ) {
            requestAnimationFrame(function () {
              requestAnimationFrame(window.__decideKpiResizeTabCharts);
            });
            window.setTimeout(window.__decideKpiResizeTabCharts, 100);
          }
        } catch (eTabResize) {}
      }

      var __diagChartsInstalled = false;
      var __diagChartInstances = [];
      function destroyDiagCharts() {
        __diagChartInstances.forEach(function (c) { try { c.destroy(); } catch (e) {} });
        __diagChartInstances = [];
        __diagChartsInstalled = false;
      }
      function initDiagnosticsCharts() {
        var elJson = document.getElementById('diagnostics-json');
        if (!elJson || __diagChartsInstalled) return;
        if (typeof Chart === 'undefined') return;
        var D;
        try {
          D = JSON.parse(elJson.textContent || '{}');
        } catch (e) { return; }
        if (!D || !D.ok) return;

        function lineChart(canvasId, labels, datasets, yTitle) {
          var canvas = document.getElementById(canvasId);
          if (!canvas) return;
          var ctx = canvas.getContext('2d');
          var ch = new Chart(ctx, {
            type: 'line',
            data: { labels: labels, datasets: datasets },
            options: {
              animation: false,
              responsive: true,
              maintainAspectRatio: false,
              interaction: { mode: 'index', intersect: false },
              scales: {
                x: { ticks: { maxTicksLimit: 8, color: '#a1a1aa' }, grid: { color: 'rgba(63,63,70,0.35)' } },
                y: {
                  title: { display: !!yTitle, text: yTitle || '', color: '#a1a1aa' },
                  ticks: { color: '#a1a1aa' },
                  grid: { color: 'rgba(63,63,70,0.35)' },
                },
              },
              plugins: {
                legend: { labels: { color: '#e5e7eb' } },
              },
            },
          });
          __diagChartInstances.push(ch);
        }

        var d0 = D.dates || [];
        var lab = [];
        var seriesPick = [];
        for (var j = 0; j < d0.length; j += Math.max(1, Math.ceil(d0.length / 650))) {
          lab.push(d0[j]);
          seriesPick.push(j);
        }
        function sliceByIdx(arr) {
          if (!arr || arr.length !== d0.length) return [];
          return seriesPick.map(function (ix) { return arr[ix]; });
        }

        var cm5 = sliceByIdx(D.roll_cagr_model_5y);
        var cb5 = sliceByIdx(D.roll_cagr_bench_5y);
        var sp5 = sliceByIdx(D.roll_spread_cagr_5y);
        lineChart('diagChartCagr5', lab, [
          { label: 'Modelo CAGR 5y', data: cm5.map(function (x) { return x == null ? null : x * 100; }), borderColor: '#4ade80', tension: 0.05, pointRadius: 0 },
          { label: 'Benchmark CAGR 5y', data: cb5.map(function (x) { return x == null ? null : x * 100; }), borderColor: '#2dd4bf', tension: 0.05, pointRadius: 0 },
          { label: 'Spread (p.p.)', data: sp5.map(function (x) { return x == null ? null : x * 100; }), borderColor: '#fbbf24', tension: 0.05, pointRadius: 0 },
          { label: 'Zero (spread)', data: cm5.map(function () { return 0; }), borderColor: 'rgba(82,82,91,0.75)', borderDash: [5, 5], tension: 0, pointRadius: 0 },
        ], '% anual implícito');

        var sm5 = sliceByIdx(D.roll_sharpe_model_5y);
        var sb5 = sliceByIdx(D.roll_sharpe_bench_5y);
        var srel = lab.map(function (_, i) {
          var a = sm5[i], b = sb5[i];
          if (a == null || b == null || !Number.isFinite(a) || !Number.isFinite(b)) return null;
          return a - b;
        });
        lineChart('diagChartSharpe5', lab, [
          { label: 'Sharpe modelo 5y', data: sm5, borderColor: '#4ade80', tension: 0.05, pointRadius: 0 },
          { label: 'Sharpe bench 5y', data: sb5, borderColor: '#2dd4bf', tension: 0.05, pointRadius: 0 },
          { label: 'Modelo − bench', data: srel, borderColor: '#fbbf24', tension: 0.05, pointRadius: 0 },
          { label: 'Zero', data: lab.map(function () { return 0; }), borderColor: 'rgba(148,163,184,0.65)', borderDash: [6, 4], tension: 0, pointRadius: 0 },
        ], 'Sharpe');

        var exl = sliceByIdx(D.roll_excess_log_cagr_5y);
        var exs = sliceByIdx(D.roll_sharpe_excess_5y);
        (function excessDualAxisChart() {
          var canvas = document.getElementById('diagChartExcess5');
          if (!canvas) return;
          var ctx = canvas.getContext('2d');
          var ch = new Chart(ctx, {
            type: 'line',
            data: {
              labels: lab,
              datasets: [
                {
                  label: 'Excesso log CAGR 5y (≈ %)',
                  data: exl.map(function (x) { return x == null ? null : x * 100; }),
                  borderColor: '#a78bfa',
                  tension: 0.05,
                  pointRadius: 0,
                  yAxisID: 'y',
                },
                {
                  label: 'Sharpe excesso 5y',
                  data: exs,
                  borderColor: '#fb7185',
                  tension: 0.05,
                  pointRadius: 0,
                  yAxisID: 'y1',
                },
              ],
            },
            options: {
              animation: false,
              responsive: true,
              maintainAspectRatio: false,
              interaction: { mode: 'index', intersect: false },
              scales: {
                x: { ticks: { maxTicksLimit: 8, color: '#a1a1aa' }, grid: { color: 'rgba(63,63,70,0.35)' } },
                y: {
                  position: 'left',
                  title: { display: true, text: '% anualizado (excesso)', color: '#c4b5fd' },
                  ticks: { color: '#c4b5fd' },
                  grid: { color: 'rgba(63,63,70,0.35)' },
                },
                y1: {
                  position: 'right',
                  title: { display: true, text: 'Sharpe excesso', color: '#fda4af' },
                  ticks: { color: '#fda4af' },
                  grid: { drawOnChartArea: false },
                },
              },
              plugins: { legend: { labels: { color: '#e5e7eb' } } },
            },
          });
          __diagChartInstances.push(ch);
        })();

        var mddM = sliceByIdx(D.roll_mdd_model_5y);
        var mddB = sliceByIdx(D.roll_mdd_bench_5y);
        lineChart('diagChartMdd5', lab, [
          { label: 'Max DD 5y modelo', data: mddM.map(function (x) { return x == null ? null : x * 100; }), borderColor: '#f87171', tension: 0.05, pointRadius: 0 },
          { label: 'Max DD 5y bench', data: mddB.map(function (x) { return x == null ? null : x * 100; }), borderColor: '#94a3b8', tension: 0.05, pointRadius: 0 },
        ], '% DD intra-janela');

        var rm = sliceByIdx(D.roll_recovery_mean_days_5y);
        var um = sliceByIdx(D.roll_max_underwater_streak_5y);
        lineChart('diagChartRecovery5', lab, [
          { label: 'Dias méd. recuperação', data: rm, borderColor: '#38bdf8', tension: 0.05, pointRadius: 0 },
          { label: 'Max streak underwater', data: um, borderColor: '#f97316', tension: 0.05, pointRadius: 0 },
        ], 'Dias');

        var hd = D.hit_rate_dates || [];
        var h12 = D.hit_rate_roll_12m || [];
        var h24 = D.hit_rate_roll_24m || [];
        var hlab = [];
        var h12s = [];
        var h24s = [];
        var strideH = Math.max(1, Math.ceil(hd.length / 400));
        for (var hi = 0; hi < hd.length; hi += strideH) {
          hlab.push(hd[hi]);
          h12s.push(h12[hi]);
          h24s.push(h24[hi]);
        }
        lineChart('diagChartHitRate', hlab, [
          { label: 'Hit rate 12m', data: h12s, borderColor: '#34d399', tension: 0.05, pointRadius: 0 },
          { label: 'Hit rate 24m', data: h24s, borderColor: '#818cf8', tension: 0.05, pointRadius: 0 },
        ], '% meses modelo > bench');
        __diagChartsInstalled = true;
      }

      tabs.forEach(function (tab) {
        tab.addEventListener('click', function () {
          var key = tab.dataset.tab;
          if (key) {
            if (key !== 'diagnostics') destroyDiagCharts();
            setEmbedTabUI(key);
            if (key === 'diagnostics') {
              setTimeout(function () { initDiagnosticsCharts(); }, 30);
            }
          }
        });
      });
      (function () {
        var initial = {{ embed_initial_tab|tojson }} || {{ tab_default|tojson }};
        if (!initial) return;
        var el = document.querySelector('.tab[data-tab="' + initial + '"]');
        if (el) {
          el.click();
        } else {
          setEmbedTabUI(initial);
        }
        if (initial === 'diagnostics') {
          setTimeout(function () { initDiagnosticsCharts(); }, 80);
        }
      })();

      // Chart data from server
      const dates = {{ model_dates|tojson }};
      const modelEquity = {{ model_equity|tojson }};
      const benchEquity = {{ bench_equity|tojson }};
      const modelDD = {{ model_drawdowns|tojson }};
      const benchDD = {{ bench_drawdowns|tojson }};
      const alphaDates = {{ alpha_dates|tojson }};
      const alphaVals = {{ alpha_vals|tojson }};
      const showMax100Compare = {{ 'true' if show_max100_compare else 'false' }};
      const cap15OnlyPage = {{ 'true' if cap15_only else 'false' }};
      const compareCap100IsMargin = {{ 'true' if compare_cap100_is_margin else 'false' }};
      const max100Equity = {{ compare_max100_equity | tojson }};
      const max100DD = {{ compare_max100_drawdowns | tojson }};
      const max100AlphaVals = {{ compare_max100_alpha_vals | tojson }};
      const yearlyYears = {{ yearly_bar_years | tojson }};
      const yearlyCap15 = {{ yearly_bar_cap15_pct | tojson }};
      const yearlyMax100 = {{ yearly_bar_max100_pct | tojson }};
      const yearlyBench = {{ yearly_bar_bench_pct | tojson }};
      const holdings = {{ holdings|tojson }};
      const latestTbillPct = {{ (risk_info.latest_tbill_exposure * 100) | round(2) }};
      const latestEquityPct = Math.max(0, 100 - latestTbillPct);

      function countryDisplayName(value) {
        const s = String(value || "").trim();
        if (!s) return "Unknown";
        const u = s.toUpperCase();
        if (u === "US" || u === "USA" || u === "UNITED STATES" || u === "UNITED STATES OF AMERICA") {
          return "United States";
        }
        if (u === "CAN" || u === "CA" || u === "CANADA") return "Canada";
        if (u === "JP" || u === "JPN" || u === "JAPAN") return "Japan";
        if (
          u === "EU" ||
          u === "EUR" ||
          u === "EUROPE" ||
          u === "EUROPEAN UNION" ||
          u === "VARIOUS EUROPE"
        ) {
          return "Various Europe";
        }
        if (u === "UK" || u === "GB" || u === "UNITED KINGDOM" || u === "GREAT BRITAIN") {
          return "United Kingdom";
        }
        return s;
      }

      const CASH_TICKERS_PIE = new Set(["TBILL_PROXY", "BIL", "SHV"]);

      function aggregateCountryExposure(rows) {
        const map = new Map();
        let sumW = 0;
        for (const row of rows) {
          const tk = String(row?.ticker || "").toUpperCase().trim();
          if (CASH_TICKERS_PIE.has(tk)) continue;
          const country = countryDisplayName(row?.country);
          const w = Number(row?.weight_pct || 0);
          if (!Number.isFinite(w) || w <= 0) continue;
          map.set(country, (map.get(country) || 0) + w);
          sumW += w;
        }
        const scale = sumW > 1e-6 ? latestEquityPct / sumW : 0;
        return Array.from(map.entries())
          .map(([country, weightPct]) => ({
            country,
            weightPct: Number(weightPct) * scale,
          }))
          .sort((a, b) => b.weightPct - a.weightPct);
      }

      function pieColorForCountry(country) {
        const c = countryDisplayName(country).toLowerCase();
        if (c === "united states" || c === "us" || c === "usa") return "#2563eb";
        if (c === "japan") return "#ffffff";
        if (c === "canada") return "#dc2626";
        if (c === "various europe") return "#16a34a";
        if (c === "united kingdom") return "#ca8a04";
        if (c === "switzerland") return "#0891b2";
        if (c === "china") return "#dc2626";
        if (c === "australia") return "#7c3aed";
        if (c === "nordics") return "#0d9488";
        if (c === "unknown" || c === "n/a") return "#64748b";
        return null;
      }

      const pieFallbackColors = [
        "#f97316",
        "#8b5cf6",
        "#14b8a6",
        "#e11d48",
        "#84cc16",
        "#6366f1",
        "#f59e0b",
        "#06b6d4",
      ];

      const countryExposure = aggregateCountryExposure(holdings);
      const pieLabels = countryExposure.map((x) => x.country).concat(["T-Bills"]);
      const pieValues = countryExposure.map((x) => x.weightPct).concat([latestTbillPct]);
      const pieBg = countryExposure
        .map((x, idx) => pieColorForCountry(x.country) || pieFallbackColors[idx % pieFallbackColors.length])
        .concat(["#71717a"]);

      const cap15LabelPt = {{ cap15_human_label_pt|tojson }};
      const cap15MarginLabelPt = {{ cap15_human_margin_label_pt|tojson }};

      const modelLineLabel = showMax100Compare
        ? (compareCap100IsMargin ? cap15MarginLabelPt : 'Overlay legado (interno)')
        : (cap15OnlyPage ? cap15LabelPt : 'Modelo');

      /** Estado inicial do simulador = dados da página (perfil do URL no topo). Pode mudar só no simulador via API. */
      const simModelEquityPage = (showMax100Compare && Array.isArray(max100Equity) && max100Equity.length === modelEquity.length && !compareCap100IsMargin)
        ? max100Equity
        : modelEquity;
      const simModelLineLabelPage = (showMax100Compare && Array.isArray(max100Equity) && max100Equity.length === modelEquity.length && !compareCap100IsMargin)
        ? cap15LabelPt
        : (cap15OnlyPage ? cap15LabelPt : 'Modelo DECIDE');

      let simActiveDates = dates;
      let simActiveBench = benchEquity;
      let simActiveModel = simModelEquityPage;
      let simActiveModelLabel = simModelLineLabelPage;
      const simMarginEquityPage =
        cap15OnlyPage &&
        compareCap100IsMargin &&
        Array.isArray(max100Equity) &&
        max100Equity.length === dates.length
          ? max100Equity
          : null;
      const simMarginLabelPage = cap15MarginLabelPt;
      let simActiveMargin = simMarginEquityPage;
      let simActiveMarginLabel = simActiveMargin ? simMarginLabelPage : '';

      /** Sem animação de “crescimento” nos gráficos (Chart.js — linhas/barras aparecem já no valor final). */
      const chartStatic = { animation: false };
      const KPI_CHARTS_EMBED = {{ 'true' if client_embed else 'false' }};
      const chartEmbedLayout = KPI_CHARTS_EMBED ? { responsive: true, maintainAspectRatio: false } : {};
      const profileLabelPtShort = {{ profile_label_pt|tojson }};
      const chartsEmbedNarrative = (function () {
        var ctx = document.getElementById('simApiContext');
        return !!(ctx && ctx.dataset.chartsEmbedNarrative === '1');
      })();

      (function registerKpiChartPlotBg() {
        if (typeof Chart === 'undefined' || !Chart.register) return;
        if (window.__decideKpiPlotBgRegistered) return;
        window.__decideKpiPlotBgRegistered = true;
        Chart.register({
          id: 'kpiChartPlotAreaBg',
          beforeDraw(chart) {
            const area = chart.chartArea;
            if (!area || area.width <= 0 || area.height <= 0) return;
            const ctx = chart.ctx;
            ctx.save();
            ctx.fillStyle = 'rgba(39, 39, 42, 0.96)';
            ctx.fillRect(area.left, area.top, area.width, area.height);
            ctx.restore();
          },
        });
      })();

      let equityChartInst = null;
      let ddChartInst = null;
      let alphaChartInst = null;
      let yearlyChartInst = null;

      // Equity (log scale via transform)
      const eqDatasets = [
        {
          label: modelLineLabel,
          data: modelEquity,
          borderColor: '#4ade80',
          tension: 0.05,
          pointRadius: 0,
        },
        {
          label: 'Benchmark',
          data: benchEquity,
          borderColor: '#2dd4bf',
          tension: 0.05,
          pointRadius: 0,
        },
      ];
      if (showMax100Compare && Array.isArray(max100Equity) && max100Equity.length === modelEquity.length) {
        eqDatasets.push({
          label: compareCap100IsMargin ? cap15MarginLabelPt : cap15LabelPt,
          data: max100Equity,
          borderColor: compareCap100IsMargin ? '#fb923c' : '#fbbf24',
          borderDash: compareCap100IsMargin ? [5, 4] : undefined,
          tension: 0.05,
          pointRadius: 0,
        });
      }
      const equityCanvas = document.getElementById('equityChart');
      if (equityCanvas) {
      const eqCtx = equityCanvas.getContext('2d');
      equityChartInst = new Chart(eqCtx, {
        type: 'line',
        data: {
          labels: dates,
          datasets: eqDatasets,
        },
        options: {
          ...chartStatic,
          ...chartEmbedLayout,
          interaction: { mode: 'index', intersect: false },
          scales: {
            y: {
              type: 'logarithmic',
              ticks: {
                color: '#9ca3af',
              },
              grid: { color: 'rgba(148, 163, 184, 0.15)' }
            },
            x: {
              ticks: {
                display: true,
                callback: (value) => {
                  // value é o índice em labels; usamos o array dates vindo do backend
                  const idx = typeof value === 'number' ? value : parseInt(value, 10);
                  const d = dates[idx];
                  if (!d) return '';
                  // Espera formato "YYYY-MM-DD"
                  const year = d.slice(0, 4);
                  const prev = dates[idx - 1];
                  if (!prev) return year;
                  const prevYear = String(prev).slice(0, 4);
                  // Mostrar uma label só quando o ano muda (garante "todos os anos").
                  return prevYear !== year ? year : "";
                },
                color: '#9ca3af',
                maxRotation: 0,
                autoSkip: false,
              },
              grid: { display: false }
            }
          },
          plugins: {
            legend: { labels: { color: '#e5e7eb' } },
          }
        }
      });
      }

      const ddDatasets = [
        {
          label: modelLineLabel,
          data: modelDD,
          borderColor: '#4ade80',
          borderWidth: 1,
          tension: 0.05,
          pointRadius: 0,
        },
        {
          label: 'Benchmark',
          data: benchDD,
          borderColor: '#2dd4bf',
          borderWidth: 1,
          tension: 0.05,
          pointRadius: 0,
        },
      ];
      if (showMax100Compare && Array.isArray(max100DD) && max100DD.length === modelDD.length) {
        var ddThird = {
          label: compareCap100IsMargin ? cap15MarginLabelPt : cap15LabelPt,
          data: max100DD,
          borderColor: compareCap100IsMargin ? '#fb923c' : '#fbbf24',
          borderDash: compareCap100IsMargin ? [5, 4] : undefined,
          borderWidth: 1,
          tension: 0.05,
          pointRadius: 0,
        };
        if (chartsEmbedNarrative && compareCap100IsMargin) ddThird.hidden = true;
        ddDatasets.push(ddThird);
      }
      // Drawdowns
      const ddCanvas = document.getElementById('ddChart');
      if (ddCanvas) {
      const ddCtx = ddCanvas.getContext('2d');
      ddChartInst = new Chart(ddCtx, {
        type: 'line',
        data: {
          labels: dates,
          datasets: ddDatasets,
        },
        options: {
          ...chartStatic,
          ...chartEmbedLayout,
          interaction: { mode: 'index', intersect: false },
          scales: {
            y: {
              ticks: {
                callback: (v) => (v * 100).toFixed(0) + '%',
                color: '#9ca3af',
              },
              grid: { color: 'rgba(148, 163, 184, 0.15)' }
            },
            x: {
              ticks: {
                display: true,
                callback: (value) => {
                  const idx = typeof value === 'number' ? value : parseInt(value, 10);
                  const d = dates[idx];
                  if (!d) return '';
                  const year = d.slice(0, 4);
                  const prev = dates[idx - 1];
                  if (!prev) return year;
                  const prevYear = String(prev).slice(0, 4);
                  return prevYear !== year ? year : "";
                },
                color: '#9ca3af',
                maxRotation: 0,
                autoSkip: false,
              },
              grid: { display: false }
            }
          },
          plugins: {
            legend: { labels: { color: '#e5e7eb' } },
          }
        }
      });
      }

      (function wireDdMarginToggle() {
        var cb = document.getElementById('kpiDdShowMargin');
        if (!cb || !ddChartInst || !ddChartInst.data.datasets[2] || !compareCap100IsMargin) return;
        cb.addEventListener('change', function () {
          var ds = ddChartInst.data.datasets[2];
          if (!ds) return;
          ds.hidden = !cb.checked;
          ddChartInst.update('none');
        });
      })();

      const alphaDatasets = [
        {
          label: showMax100Compare
            ? (compareCap100IsMargin ? 'Rolling 1Y alpha (≤100% NAV)' : 'Rolling 1Y alpha (CAP 15%)')
            : 'Rolling 1Y alpha',
          data: alphaVals,
          borderColor: '#a855f7',
          borderWidth: 1,
          tension: 0.05,
          pointRadius: 0,
        },
      ];
      if (
        showMax100Compare &&
        Array.isArray(max100AlphaVals) &&
        max100AlphaVals.length === alphaVals.length
      ) {
        alphaDatasets.push({
          label: compareCap100IsMargin ? 'Rolling 1Y alpha (com margem)' : ('Rolling 1Y alpha · ' + cap15LabelPt),
          data: max100AlphaVals,
          borderColor: '#f472b6',
          borderWidth: 1,
          tension: 0.05,
          pointRadius: 0,
        });
      }
      // Rolling alpha (1 ano)
      const alphaCtx = document.getElementById('alphaChart').getContext('2d');
      alphaChartInst = new Chart(alphaCtx, {
        type: 'line',
        data: {
          labels: alphaDates,
          datasets: alphaDatasets,
        },
        options: {
          ...chartStatic,
          ...chartEmbedLayout,
          interaction: { mode: 'index', intersect: false },
          scales: {
            y: {
              ticks: {
                callback: (v) => (v * 100).toFixed(1) + '%',
                color: '#9ca3af',
              },
              grid: { color: 'rgba(148, 163, 184, 0.15)' }
            },
            x: {
              ticks: {
                display: true,
                callback: (value) => {
                  const idx = typeof value === 'number' ? value : parseInt(value, 10);
                  const d = alphaDates[idx];
                  if (!d) return '';
                  const year = d.slice(0, 4);
                  const prev = alphaDates[idx - 1];
                  if (!prev) return year;
                  const prevYear = String(prev).slice(0, 4);
                  return prevYear !== year ? year : "";
                },
                color: '#9ca3af',
                maxRotation: 0,
                autoSkip: false,
              },
              grid: { display: false }
            }
          },
          plugins: {
            legend: { labels: { color: '#e5e7eb' } },
          }
        }
      });

      // Barras: retorno por ano civil (modelo CAP15 ± overlay legado interno vs benchmark)
      const yearlyCanvas = document.getElementById('yearlyReturnChart');
      if (yearlyCanvas && Array.isArray(yearlyYears) && yearlyYears.length > 0) {
        const yCtx = yearlyCanvas.getContext('2d');
        const yCap = Array.isArray(yearlyCap15) ? yearlyCap15 : [];
        const yM100 = Array.isArray(yearlyMax100) ? yearlyMax100 : [];
        const yB = Array.isArray(yearlyBench) ? yearlyBench : [];
        const hasVal = (arr) => arr.some((v) => v != null && !Number.isNaN(Number(v)));
        const yearlyBarDatasets = [];
        if (showMax100Compare && hasVal(yM100)) {
          if (hasVal(yCap)) {
            yearlyBarDatasets.push({
              label: compareCap100IsMargin ? cap15MarginLabelPt : 'Overlay legado (interno)',
              data: yCap,
              backgroundColor: 'rgba(74, 222, 128, 0.72)',
              borderColor: '#4ade80',
              borderWidth: 1,
            });
          }
          yearlyBarDatasets.push({
            label: compareCap100IsMargin ? (cap15LabelPt + ' (≤100% NAV)') : cap15LabelPt,
            data: yM100,
            backgroundColor: 'rgba(251, 191, 36, 0.72)',
            borderColor: '#fbbf24',
            borderWidth: 1,
          });
        } else if (hasVal(yCap)) {
          yearlyBarDatasets.push({
            label: cap15LabelPt,
            data: yCap,
            backgroundColor: 'rgba(74, 222, 128, 0.72)',
            borderColor: '#4ade80',
            borderWidth: 1,
          });
        }
        yearlyBarDatasets.push({
          label: 'Benchmark',
          data: yB,
          backgroundColor: 'rgba(56, 189, 248, 0.5)',
          borderColor: '#2dd4bf',
          borderWidth: 1,
        });
        yearlyChartInst = new Chart(yCtx, {
          type: 'bar',
          data: {
            labels: yearlyYears,
            datasets: yearlyBarDatasets,
          },
          options: {
            ...chartStatic,
            ...chartEmbedLayout,
            interaction: { mode: 'index', intersect: false },
            scales: {
              x: {
                ticks: { color: '#9ca3af', maxRotation: 40, autoSkip: false },
                grid: { display: false },
              },
              y: {
                ticks: {
                  color: '#9ca3af',
                  callback: (v) => Number(v).toFixed(0) + '%',
                },
                grid: { color: 'rgba(148, 163, 184, 0.15)' },
              },
            },
            plugins: {
              legend: { labels: { color: '#e5e7eb' } },
              tooltip: {
                callbacks: {
                  label: (ctx) => {
                    const v = ctx.parsed.y;
                    return ctx.dataset.label + ': ' + (v == null ? '—' : Number(v).toFixed(2) + '%');
                  },
                },
              },
            },
          },
        });
      }

      // Country + T-Bills pie
      const pieCanvas = document.getElementById('countryTbillPie');
      if (pieCanvas) {
        const pieCtx = pieCanvas.getContext('2d');
        new Chart(pieCtx, {
          type: 'pie',
          data: {
            labels: pieLabels,
            datasets: [
              {
                data: pieValues,
                backgroundColor: pieBg,
                borderColor: 'rgba(255,255,255,0.18)',
                borderWidth: 1.25,
                hoverOffset: 0,
              }
            ]
          },
          options: {
            ...chartStatic,
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              legend: {
                position: 'bottom',
                labels: {
                  color: '#e5e7eb',
                  boxWidth: 12,
                  padding: 14,
                }
              },
              tooltip: {
                callbacks: {
                  label: (ctx) => `${ctx.label}: ${Number(ctx.parsed).toFixed(1)}%`
                }
              }
            }
          }
        });
      }

      /* Embed + Chart.js: no 1.º paint o iframe/painel pode ainda não ter largura/altura final — o canvas fica «estreito»
         até haver um resize (ex.: fullscreen). Re-medir após layout e quando #tab-charts muda de tamanho. */
      (function setupKpiTabChartsResizeEmbed() {
        if (typeof Chart === 'undefined' || !Chart.getChart) return;
        if (!document.body.classList.contains('decide-kpi-embed')) return;
        var tabCharts = document.getElementById('tab-charts');
        function resizeTabChartsCanvases() {
          if (!tabCharts) return;
          tabCharts.querySelectorAll('canvas').forEach(function (cnv) {
            try {
              var ch = Chart.getChart(cnv);
              if (ch && typeof ch.resize === 'function') ch.resize();
            } catch (e2) {}
          });
        }
        window.__decideKpiResizeTabCharts = resizeTabChartsCanvases;
        function bump() {
          requestAnimationFrame(function () {
            requestAnimationFrame(resizeTabChartsCanvases);
          });
        }
        bump();
        setTimeout(resizeTabChartsCanvases, 0);
        setTimeout(resizeTabChartsCanvases, 80);
        setTimeout(resizeTabChartsCanvases, 250);
        setTimeout(resizeTabChartsCanvases, 700);
        window.addEventListener('load', function () {
          resizeTabChartsCanvases();
          bump();
        });
        window.addEventListener('resize', resizeTabChartsCanvases);
        window.addEventListener('message', function (ev) {
          try {
            var d = ev.data;
            if (!d || d.type !== 'decide-kpi-layout-stable') return;
            bump();
            window.setTimeout(resizeTabChartsCanvases, 40);
          } catch (eMsg) {}
        });
        var roDebounce = null;
        function scheduleChartResizeFromObserver() {
          if (roDebounce) window.clearTimeout(roDebounce);
          roDebounce = window.setTimeout(resizeTabChartsCanvases, 28);
        }
        if (typeof ResizeObserver !== 'undefined' && tabCharts) {
          var ro = new ResizeObserver(scheduleChartResizeFromObserver);
          ro.observe(tabCharts);
        }
        if (typeof ResizeObserver !== 'undefined' && document.documentElement) {
          var roDoc = new ResizeObserver(scheduleChartResizeFromObserver);
          roDoc.observe(document.documentElement);
        }
      })();

      // Retornos YTD / 1Y / 5Y / 10Y vs benchmark (escala log); eixo X: meses (YTD/1Y), anos (5Y/10Y)
      const HORIZON_RET = {{ horizon_returns|tojson }};
      const horizonModelLabel = {{ ('DECIDE ' ~ profile_label_pt if client_embed else model_display_label)|tojson }};
      const horizonBenchLabel = {{ ('Mercado de referência' if client_embed else 'Benchmark')|tojson }};
      (function initHorizonReturnCharts() {
        if (typeof Chart === 'undefined') return;
        /** Só reduz pontos acima disto (≈10Y); 5Y ~1260 mantém-se completo. */
        const HORIZON_DOWNSAMPLE_MIN_LEN = 2000;
        const HORIZON_MAX_POINTS = 800;
        const HORIZON_PT_MONTHS = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
        function horizonMonthLabel(iso) {
          if (!iso || iso.length < 10) return '';
          var m = parseInt(iso.slice(5, 7), 10);
          var y = iso.slice(0, 4);
          if (m < 1 || m > 12) return iso.slice(0, 7);
          return HORIZON_PT_MONTHS[m - 1] + ' ' + y;
        }
        function horizonQuarterLabel(iso) {
          if (!iso || iso.length < 10) return '';
          var y = iso.slice(0, 4);
          var m = parseInt(iso.slice(5, 7), 10);
          var q = Math.floor((m - 1) / 3) + 1;
          return 'T' + q + ' ' + y;
        }
        /** Drawdown a partir da série normalizada a 1 no início da janela (fallback se payload não trouxer model_dd). */
        function horizonDdFromNorm(normArr) {
          if (!normArr || !normArr.length) return [];
          var peak = null;
          return normArr.map(function (v) {
            var x = Number(v);
            if (!isFinite(x) || x <= 0) return null;
            if (peak === null || x > peak) peak = x;
            return x / peak - 1;
          });
        }
        /** Série muito longa (ex. 10Y ≈2520 pts): category + demasiados ticks pode deixar o canvas vazio; reduzimos só para o canvas. */
        function horizonDownsampleForChart(h) {
          var nFull = h && h.dates ? h.dates.length : 0;
          var mdFull =
            h && h.model_dd && h.bench_dd && h.model_dd.length === nFull && h.bench_dd.length === nFull
              ? h.model_dd
              : null;
          var bdFull =
            h && h.model_dd && h.bench_dd && h.model_dd.length === nFull && h.bench_dd.length === nFull
              ? h.bench_dd
              : null;
          if (!mdFull || !bdFull) {
            mdFull = horizonDdFromNorm(h && h.model_norm ? h.model_norm : []);
            bdFull = horizonDdFromNorm(h && h.bench_norm ? h.bench_norm : []);
          }
          if (!h || !h.dates || h.dates.length < HORIZON_DOWNSAMPLE_MIN_LEN) {
            return {
              labels: h.dates,
              model: h.model_norm,
              bench: h.bench_norm,
              modelDd: mdFull,
              benchDd: bdFull,
            };
          }
          var n = h.dates.length;
          var step = Math.max(1, Math.ceil(n / HORIZON_MAX_POINTS));
          var labels = [];
          var model = [];
          var bench = [];
          var modelDd = [];
          var benchDd = [];
          for (var i = 0; i < n; i += step) {
            labels.push(h.dates[i]);
            model.push(h.model_norm[i]);
            bench.push(h.bench_norm[i]);
            modelDd.push(mdFull[i]);
            benchDd.push(bdFull[i]);
          }
          var last = n - 1;
          if (labels[labels.length - 1] !== h.dates[last]) {
            labels.push(h.dates[last]);
            model.push(h.model_norm[last]);
            bench.push(h.bench_norm[last]);
            modelDd.push(mdFull[last]);
            benchDd.push(bdFull[last]);
          }
          return { labels: labels, model: model, bench: bench, modelDd: modelDd, benchDd: benchDd };
        }
        function horizonSanitizeLogSeries(arr) {
          return arr.map(function (v) {
            var x = Number(v);
            if (!(x > 0) || !isFinite(x)) return null;
            return Math.max(x, 1e-12);
          });
        }
        const entries = [
          { key: 'ytd', id: 'horizonChartYtd', tick: 'month' },
          { key: 'y1', id: 'horizonChart1y', tick: 'month' },
          { key: 'y5', id: 'horizonChart5y', tick: 'year' },
          { key: 'y10', id: 'horizonChart10y', tick: 'year' },
        ];
        entries.forEach(function (entry) {
          const h = HORIZON_RET && HORIZON_RET[entry.key];
          const canvas = document.getElementById(entry.id);
          if (!h || !h.ok || !canvas) return;
          var fullLen = h.dates.length;
          const ds = horizonDownsampleForChart(h);
          const hd = ds.labels;
          const tickMode = entry.tick || 'year';
          const longX = fullLen > 1500;
          const ctx = canvas.getContext('2d');
          new Chart(ctx, {
            type: 'line',
            data: {
              labels: hd,
              datasets: [
                {
                  label: horizonModelLabel,
                  data: horizonSanitizeLogSeries(ds.model),
                  borderColor: '#4ade80',
                  tension: 0.05,
                  pointRadius: 0,
                  spanGaps: true,
                },
                {
                  label: horizonBenchLabel,
                  data: horizonSanitizeLogSeries(ds.bench),
                  borderColor: '#2dd4bf',
                  tension: 0.05,
                  pointRadius: 0,
                  spanGaps: true,
                },
              ],
            },
            options: {
              ...chartStatic,
              ...chartEmbedLayout,
              interaction: { mode: 'index', intersect: false },
              scales: {
                y: {
                  type: 'logarithmic',
                  ticks: {
                    color: '#9ca3af',
                    callback: (v) => (v == null ? '' : Number(v).toFixed(2)),
                  },
                  grid: { color: 'rgba(148, 163, 184, 0.15)' },
                },
                x: {
                  ticks: {
                    display: true,
                    callback: function (value) {
                      const idx = typeof value === 'number' ? value : parseInt(value, 10);
                      const d = hd[idx];
                      if (!d) return '';
                      const prev = hd[idx - 1];
                      if (!prev) {
                        if (tickMode === 'year') return d.slice(0, 4);
                        if (tickMode === 'month') return horizonMonthLabel(d);
                        if (tickMode === 'quarter') return horizonQuarterLabel(d);
                        return d.slice(0, 4);
                      }
                      if (tickMode === 'year') {
                        return d.slice(0, 4) !== prev.slice(0, 4) ? d.slice(0, 4) : '';
                      }
                      if (tickMode === 'month') {
                        return d.slice(0, 7) !== prev.slice(0, 7) ? horizonMonthLabel(d) : '';
                      }
                      if (tickMode === 'quarter') {
                        var cy = d.slice(0, 4);
                        var cm = parseInt(d.slice(5, 7), 10);
                        var py = prev.slice(0, 4);
                        var pm = parseInt(prev.slice(5, 7), 10);
                        var cq = Math.floor((cm - 1) / 3);
                        var pq = Math.floor((pm - 1) / 3);
                        return cy !== py || cq !== pq ? horizonQuarterLabel(d) : '';
                      }
                      return '';
                    },
                    color: '#9ca3af',
                    maxRotation: 0,
                    autoSkip: longX,
                    maxTicksLimit: longX ? 18 : undefined,
                  },
                  grid: { display: false },
                },
              },
              plugins: {
                legend: { labels: { color: '#e5e7eb' } },
                tooltip: {
                  callbacks: {
                    title: function (items) {
                      var i = items && items[0] && items[0].dataIndex;
                      return (i != null && hd[i]) ? hd[i] : '';
                    },
                    label: function (ctx) {
                      const y = ctx.parsed.y;
                      const pct = y == null || !Number.isFinite(y) ? '—' : ((y - 1) * 100).toFixed(2) + '% vs início';
                      return ctx.dataset.label + ': ' + pct;
                    },
                    afterBody: KPI_CHARTS_EMBED
                      ? function (items) {
                          if (!items || !items.length) return '';
                          var ix = items[0].datasetIndex;
                          if (ix === 0) {
                            return ['', 'CAP15: limite máximo de 15% por posição (identificação interna).'];
                          }
                          return '';
                        }
                      : undefined,
                  },
                },
              },
            },
          });
          if (KPI_CHARTS_EMBED) {
            var horizonDdCanvasIds = { ytd: 'horizonDdChartYtd', y1: 'horizonDdChart1y', y5: 'horizonDdChart5y', y10: 'horizonDdChart10y' };
            var ddCanvas = document.getElementById(horizonDdCanvasIds[entry.key]);
            if (ddCanvas) {
              var ddModel = ds.modelDd || horizonDdFromNorm(ds.model);
              var ddBench = ds.benchDd || horizonDdFromNorm(ds.bench);
              function horizonDdYMin(a, b) {
                var lo = 0;
                function scan(arr) {
                  (arr || []).forEach(function (v) {
                    var x = Number(v);
                    if (isFinite(x) && x < lo) lo = x;
                  });
                }
                scan(a);
                scan(b);
                if (!isFinite(lo) || lo >= 0) lo = -0.05;
                return lo * 1.08;
              }
              var yMinDd = horizonDdYMin(ddModel, ddBench);
              var ddCtx = ddCanvas.getContext('2d');
              new Chart(ddCtx, {
                type: 'line',
                data: {
                  labels: hd,
                  datasets: [
                    {
                      label: horizonModelLabel,
                      data: ddModel,
                      borderColor: '#4ade80',
                      borderWidth: 1,
                      tension: 0.05,
                      pointRadius: 0,
                      spanGaps: true,
                    },
                    {
                      label: horizonBenchLabel,
                      data: ddBench,
                      borderColor: '#2dd4bf',
                      borderWidth: 1,
                      tension: 0.05,
                      pointRadius: 0,
                      spanGaps: true,
                    },
                  ],
                },
                options: {
                  ...chartStatic,
                  ...chartEmbedLayout,
                  interaction: { mode: 'index', intersect: false },
                  scales: {
                    y: {
                      min: yMinDd,
                      max: 0,
                      ticks: {
                        color: '#9ca3af',
                        callback: function (v) {
                          return (Number(v) * 100).toFixed(0) + '%';
                        },
                      },
                      grid: { color: 'rgba(148, 163, 184, 0.15)' },
                    },
                    x: {
                      ticks: {
                        display: true,
                        callback: function (value) {
                          const idx = typeof value === 'number' ? value : parseInt(value, 10);
                          const d = hd[idx];
                          if (!d) return '';
                          const prev = hd[idx - 1];
                          if (!prev) {
                            if (tickMode === 'year') return d.slice(0, 4);
                            if (tickMode === 'month') return horizonMonthLabel(d);
                            if (tickMode === 'quarter') return horizonQuarterLabel(d);
                            return d.slice(0, 4);
                          }
                          if (tickMode === 'year') {
                            return d.slice(0, 4) !== prev.slice(0, 4) ? d.slice(0, 4) : '';
                          }
                          if (tickMode === 'month') {
                            return d.slice(0, 7) !== prev.slice(0, 7) ? horizonMonthLabel(d) : '';
                          }
                          if (tickMode === 'quarter') {
                            var cy = d.slice(0, 4);
                            var cm = parseInt(d.slice(5, 7), 10);
                            var py = prev.slice(0, 4);
                            var pm = parseInt(prev.slice(5, 7), 10);
                            var cq = Math.floor((cm - 1) / 3);
                            var pq = Math.floor((pm - 1) / 3);
                            return cy !== py || cq !== pq ? horizonQuarterLabel(d) : '';
                          }
                          return '';
                        },
                        color: '#9ca3af',
                        maxRotation: 0,
                        autoSkip: longX,
                        maxTicksLimit: longX ? 18 : undefined,
                      },
                      grid: { display: false },
                    },
                  },
                  plugins: {
                    legend: { labels: { color: '#e5e7eb' } },
                    tooltip: {
                      callbacks: {
                        title: function (items) {
                          var i = items && items[0] && items[0].dataIndex;
                          return (i != null && hd[i]) ? hd[i] : '';
                        },
                        label: function (ctx) {
                          var y = ctx.parsed.y;
                          var pct = y == null || !Number.isFinite(y) ? '—' : (Number(y) * 100).toFixed(2) + '%';
                          return ctx.dataset.label + ': ' + pct;
                        },
                      },
                    },
                  },
                },
              });
            }
          }
        });
      })();

      (function setupHorizonEmbedTabs() {
        var root = document.querySelector('.horizon-embed-panels-root');
        if (!root) return;
        function showHorizonPanel(key) {
          document.querySelectorAll('.horizon-embed-panel').forEach(function (p) {
            p.classList.toggle('active', p.getAttribute('data-panel') === key);
          });
          document.querySelectorAll('.horizon-embed-tab').forEach(function (b) {
            var on = b.getAttribute('data-h') === key;
            b.classList.toggle('active', on);
            b.setAttribute('aria-selected', on ? 'true' : 'false');
          });
          requestAnimationFrame(function () {
            [
              'horizonChartYtd', 'horizonChart1y', 'horizonChart5y', 'horizonChart10y',
              'horizonDdChartYtd', 'horizonDdChart1y', 'horizonDdChart5y', 'horizonDdChart10y',
            ].forEach(function (id) {
              var c = document.getElementById(id);
              if (!c || typeof Chart === 'undefined' || !Chart.getChart) return;
              var ch = Chart.getChart(c);
              if (ch && typeof ch.resize === 'function') ch.resize();
            });
          });
        }
        document.querySelectorAll('.horizon-embed-tab').forEach(function (btn) {
          btn.addEventListener('click', function () {
            var key = btn.getAttribute('data-h');
            if (key) showHorizonPanel(key);
          });
        });
      })();

      (function setupKpiChartFullscreen() {
        function resizeChartsIn(el) {
          if (!el) return;
          el.querySelectorAll('canvas').forEach(function (cnv) {
            try {
              var ch = typeof Chart !== 'undefined' && Chart.getChart ? Chart.getChart(cnv) : null;
              if (ch) ch.resize();
            } catch (e2) {}
          });
        }
        /** Clique no gráfico: não deixar foco preso num input — passa ao campo seguinte na mesma linha ou retira o foco. */
        function blurOrFocusNextNearbyField() {
          var ae = document.activeElement;
          if (!ae || !ae.matches || !ae.matches('input, textarea, select')) return;
          if (ae.closest('.kpi-chart-panel--zoomable')) return;
          var scope = ae.closest('.sim-row-actions, .simulator-panel, [data-enter-submit]');
          if (!scope) {
            try {
              ae.blur();
            } catch (e0) {}
            return;
          }
          var list = Array.prototype.slice
            .call(
              scope.querySelectorAll(
                'input:not([type="hidden"]):not([disabled]), textarea:not([disabled]), select:not([disabled])',
              ),
            )
            .filter(function (el) {
              try {
                return el.offsetParent !== null || el.getClientRects().length > 0;
              } catch (e1) {
                return false;
              }
            });
          var i = list.indexOf(ae);
          if (i >= 0 && i < list.length - 1) {
            var next = list[i + 1];
            var r0 = ae.getBoundingClientRect();
            var r1 = next.getBoundingClientRect();
            var sameRow = Math.abs(r0.top - r1.top) < 72;
            var hGap = r1.left - r0.right;
            var near = sameRow && hGap > -24 && hGap < 420;
            if (near) {
              try {
                next.focus({ preventScroll: true });
              } catch (e2) {
                try {
                  next.focus();
                } catch (e3) {}
              }
              return;
            }
          }
          try {
            ae.blur();
          } catch (e4) {}
        }
        document.querySelectorAll('.kpi-chart-panel--zoomable').forEach(function (panel) {
          panel.addEventListener('click', function (e) {
            if (e.target.closest('.kpi-chart-fs-exit')) return;
            if (document.fullscreenElement || document.webkitFullscreenElement) return;
            blurOrFocusNextNearbyField();
            var req = panel.requestFullscreen || panel.webkitRequestFullscreen;
            if (!req) return;
            req.call(panel).then(function () {
              resizeChartsIn(panel);
            }).catch(function () {});
          });
          var exitBtn = panel.querySelector('.kpi-chart-fs-exit');
          if (exitBtn) {
            exitBtn.addEventListener('click', function (e) {
              e.stopPropagation();
              var ex = document.exitFullscreen || document.webkitExitFullscreen;
              if (ex) ex.call(document);
            });
          }
        });
        document.addEventListener('fullscreenchange', function () {
          document.querySelectorAll('.kpi-chart-panel--zoomable').forEach(function (panel) {
            resizeChartsIn(panel);
          });
        });
        document.addEventListener('webkitfullscreenchange', function () {
          document.querySelectorAll('.kpi-chart-panel--zoomable').forEach(function (panel) {
            resizeChartsIn(panel);
          });
        });
      })();

      // —— Simulador (capital × anos; perfil próprio via API, sem tocar no selector do topo)
      const SIM_DAYS_PER_YEAR = 252;
      let simulatorChart = null;
      let simulatorDdChart = null;
      let simFetchSeq = 0;

      function equityCurveToDrawdownFractions(vals) {
        var out = [];
        var peak = -Infinity;
        for (var i = 0; i < vals.length; i++) {
          var v = Number(vals[i]);
          if (!Number.isFinite(v) || v <= 0) {
            out.push(null);
            continue;
          }
          if (v > peak) peak = v;
          out.push(peak > 0 ? v / peak - 1 : 0);
        }
        return out;
      }

      function applyKpiViewChartLabels() {
        var simple = document.body.classList.contains('decide-kpi-simple');
        var simpleDecide = 'DECIDE ' + profileLabelPtShort;
        var simpleMargin = 'DECIDE ' + profileLabelPtShort + ' com margem';
        var simpleBench = 'Mercado de referência';
        var simplePlaf = 'DECIDE ' + profileLabelPtShort + ' (≤100% NAV)';
        if (equityChartInst && equityChartInst.data && equityChartInst.data.datasets) {
          equityChartInst.data.datasets[0].label = simple ? simpleDecide : modelLineLabel;
          equityChartInst.data.datasets[1].label = simple ? simpleBench : 'Benchmark';
          if (equityChartInst.data.datasets[2]) {
            equityChartInst.data.datasets[2].label = simple
              ? (compareCap100IsMargin ? simpleMargin : simplePlaf)
              : (compareCap100IsMargin ? cap15MarginLabelPt : cap15LabelPt);
          }
          equityChartInst.update('none');
        }
        if (ddChartInst && ddChartInst.data && ddChartInst.data.datasets) {
          ddChartInst.data.datasets[0].label = simple ? simpleDecide : modelLineLabel;
          ddChartInst.data.datasets[1].label = simple ? simpleBench : 'Benchmark';
          if (ddChartInst.data.datasets[2]) {
            ddChartInst.data.datasets[2].label = simple
              ? (compareCap100IsMargin ? simpleMargin : simplePlaf)
              : (compareCap100IsMargin ? cap15MarginLabelPt : cap15LabelPt);
          }
          ddChartInst.update('none');
        }
        if (alphaChartInst && alphaChartInst.data && alphaChartInst.data.datasets) {
          var aDs = alphaChartInst.data.datasets;
          if (showMax100Compare && aDs.length > 1) {
            aDs[0].label = simple
              ? (compareCap100IsMargin ? 'Vantagem vs mercado (plafonado)' : 'Vantagem vs mercado (CAP 15%)')
              : (compareCap100IsMargin ? 'Rolling 1Y alpha (≤100% NAV)' : 'Rolling 1Y alpha (CAP 15%)');
            aDs[1].label = simple
              ? (compareCap100IsMargin ? 'Vantagem vs mercado (margem)' : 'Vantagem vs mercado (exposição limitada)')
              : (compareCap100IsMargin ? 'Rolling 1Y alpha (com margem)' : ('Rolling 1Y alpha · ' + cap15LabelPt));
          } else {
            aDs[0].label = simple ? 'Vantagem vs mercado (12 meses)' : 'Rolling 1Y alpha';
          }
          alphaChartInst.update('none');
        }
        if (yearlyChartInst && yearlyChartInst.data && yearlyChartInst.data.datasets) {
          var yDs = yearlyChartInst.data.datasets;
          if (showMax100Compare && yDs.length >= 2 && compareCap100IsMargin) {
            if (yDs[0]) yDs[0].label = simple ? cap15MarginLabelPt : cap15MarginLabelPt;
            if (yDs[1]) yDs[1].label = simple ? 'Plafonado (≤100%)' : (cap15LabelPt + ' (≤100% NAV)');
          } else {
            if (yDs[0]) yDs[0].label = simple ? 'Estratégia (CAP 15%)' : 'CAP 15%';
            if (yDs[1]) yDs[1].label = simple ? 'Com exposição limitada' : cap15LabelPt;
          }
          if (yDs[2]) yDs[2].label = simple ? 'Mercado (referência)' : 'Benchmark';
          yearlyChartInst.update('none');
        }
        if (simulatorChart && simulatorChart.data && simulatorChart.data.datasets) {
          var ctxSimLbl = document.getElementById('simApiContext');
          var embSimLbl = ctxSimLbl && ctxSimLbl.dataset.clientEmbed === '1';
          var benchSimLbl = simple ? 'Mercado (referência)' : (embSimLbl ? 'Benchmark (MSCI World)' : 'Referência (benchmark)');
          var dsSim = simulatorChart.data.datasets;
          if (dsSim[0]) dsSim[0].label = simple ? 'Estratégia DECIDE' : simActiveModelLabel;
          if (dsSim.length >= 3 && simActiveMargin) {
            if (dsSim[1]) dsSim[1].label = simple ? cap15MarginLabelPt : simActiveMarginLabel;
            if (dsSim[2]) dsSim[2].label = benchSimLbl;
          } else if (dsSim[1]) {
            dsSim[1].label = benchSimLbl;
          }
          simulatorChart.update('none');
        }
        if (simulatorDdChart && simulatorDdChart.data && simulatorDdChart.data.datasets) {
          var ctxDdLbl = document.getElementById('simApiContext');
          var embDdLbl = ctxDdLbl && ctxDdLbl.dataset.clientEmbed === '1';
          var benchDdLbl = simple ? 'Mercado (referência)' : (embDdLbl ? 'Benchmark (MSCI World)' : 'Referência (benchmark)');
          var dsDd = simulatorDdChart.data.datasets;
          if (dsDd[0]) dsDd[0].label = simple ? 'Estratégia DECIDE' : simActiveModelLabel;
          if (dsDd.length >= 3 && simActiveMargin) {
            if (dsDd[1]) dsDd[1].label = simple ? cap15MarginLabelPt : simActiveMarginLabel;
            if (dsDd[2]) dsDd[2].label = benchDdLbl;
          } else if (dsDd[1]) {
            dsDd[1].label = benchDdLbl;
          }
          simulatorDdChart.update('none');
        }
      }
      window.applyKpiViewChartLabels = applyKpiViewChartLabels;

      /* Simples/Avançado: definido no servidor (?kpi_view=) pelo dashboard Next — sem botões nem localStorage no iframe. */

      function kpiPublicApiPath(apiPath) {
        /* Prefixo injectado pelo servidor no embed (`/kpi-flask`) — não depender só do pathname (Turbopack / basePath). */
        const ctx = document.getElementById('simApiContext');
        const ap = (apiPath && apiPath.charAt(0) === '/') ? apiPath : ('/' + apiPath);
        const fromServer = ctx && ctx.dataset.browserApiPrefix != null ? String(ctx.dataset.browserApiPrefix).trim() : '';
        if (fromServer) {
          var b = String(fromServer);
          while (b.endsWith('/')) { b = b.slice(0, -1); }
          return b + ap;
        }
        const p = String(window.location.pathname || '');
        if (p === '/kpi-flask' || p.startsWith('/kpi-flask/')) {
          return '/kpi-flask' + ap;
        }
        return ap;
      }
      function buildSimulatorSeriesUrl(profile) {
        const ctx = document.getElementById('simApiContext');
        const u = new URL(kpiPublicApiPath('/api/equity_series_for_simulator'), window.location.origin);
        u.searchParams.set('profile', profile);
        if (ctx && ctx.dataset.cap15Only === '1') u.searchParams.set('cap15_only', '1');
        if (ctx && ctx.dataset.clientEmbed === '1') u.searchParams.set('client_embed', '1');
        const mk = ctx && ctx.dataset.modelKey ? String(ctx.dataset.modelKey) : '';
        if (!(ctx && ctx.dataset.cap15Only === '1') && mk) u.searchParams.set('model', mk);
        return u.toString();
      }

      async function fetchSimulatorSeriesForProfile(profile) {
        const errEl = document.getElementById('simError');
        const sel = document.getElementById('simProfileSelect');
        const seq = ++simFetchSeq;
        if (sel) sel.disabled = true;
        try {
          const res = await fetch(buildSimulatorSeriesUrl(profile), { cache: 'no-store' });
          const j = await res.json();
          if (seq !== simFetchSeq) return;
          if (!j.ok || !Array.isArray(j.dates) || !Array.isArray(j.sim_model_equity) || !Array.isArray(j.bench_equity)) {
            if (errEl) {
              errEl.style.color = '#f87171';
              errEl.textContent = (j && j.error) ? ('Erro ao carregar série: ' + j.error) : 'Erro ao carregar série para este perfil.';
              errEl.style.display = 'block';
            }
            return;
          }
          simActiveDates = j.dates;
          simActiveBench = j.bench_equity;
          simActiveModel = j.sim_model_equity;
          simActiveModelLabel = j.sim_model_label || 'Modelo DECIDE';
          if (j.has_sim_margin && Array.isArray(j.sim_margin_equity) && j.sim_margin_equity.length === j.dates.length) {
            simActiveMargin = j.sim_margin_equity;
            simActiveMarginLabel = String(j.sim_margin_label || cap15MarginLabelPt).trim();
          } else {
            simActiveMargin = null;
            simActiveMarginLabel = '';
          }
          const ny = Number(j.num_years);
          const yrsIn = document.getElementById('simYears');
          if (yrsIn && Number.isFinite(ny)) yrsIn.setAttribute('max', ny.toFixed(4));
          if (errEl) {
            errEl.style.display = 'none';
            errEl.textContent = '';
            errEl.style.color = '#f87171';
          }
          runSimulator();
        } catch (e) {
          if (seq !== simFetchSeq) return;
          if (errEl) {
            errEl.style.color = '#f87171';
            errEl.textContent = 'Falha de rede ao carregar o nível de risco do simulador.';
            errEl.style.display = 'block';
          }
        } finally {
          if (seq === simFetchSeq && sel) sel.disabled = false;
        }
      }

      function parsePtSimNumber(raw) {
        var trimmed = String(raw).trim().replace(/[\\s\u00A0\u202F]/g, '');
        if (!trimmed || trimmed === '-') return NaN;
        var hasComma = trimmed.indexOf(',') >= 0;
        var hasDot = trimmed.indexOf('.') >= 0;
        var t = trimmed;
        if (hasComma && !hasDot) {
          t = t.replace(/\\./g, '').replace(',', '.');
        } else if (hasDot && !hasComma) {
          t = t.replace(/,/g, '');
        } else if (hasComma && hasDot) {
          var lastComma = trimmed.lastIndexOf(',');
          var lastDot = trimmed.lastIndexOf('.');
          if (lastComma > lastDot) {
            t = trimmed.replace(/\\./g, '').replace(',', '.');
          } else {
            t = trimmed.replace(/,/g, '');
          }
        } else {
          t = t.replace(/,/g, '');
        }
        var n = parseFloat(t);
        return Number.isFinite(n) ? n : NaN;
      }

      function toPlainEditStringSim(n, maxDecimals) {
        if (!Number.isFinite(n)) return '';
        if (maxDecimals <= 0) return String(Math.trunc(n));
        var s = n.toFixed(maxDecimals);
        var trimmed = s.replace(/\\.?0+$/, '');
        return trimmed.replace('.', ',');
      }

      function formatPtThousandsSim(n, maxDecimals) {
        if (!Number.isFinite(n)) return '';
        try {
          return new Intl.NumberFormat('pt-PT', {
            maximumFractionDigits: maxDecimals,
            minimumFractionDigits: 0,
          }).format(n);
        } catch (e) {
          return String(n);
        }
      }

      function wireSimulatorThousandInputs() {
        var capIn = document.getElementById('simCapital');
        var yrsIn = document.getElementById('simYears');
        if (capIn && !capIn.dataset.ptwired) {
          capIn.dataset.ptwired = '1';
          capIn.addEventListener('focus', function () {
            var n = parsePtSimNumber(this.value);
            if (Number.isFinite(n)) this.value = toPlainEditStringSim(n, 0);
            else this.value = String(this.value).replace(/[\\s\u00A0\u202F]/g, '');
          });
          capIn.addEventListener('blur', function () {
            var n = parsePtSimNumber(this.value);
            if (Number.isFinite(n)) {
              var v = Math.max(5000, Math.round(n / 100) * 100);
              this.value = formatPtThousandsSim(v, 0);
            }
            syncClientEmbedChartsCtaLinks();
          });
          capIn.addEventListener('input', syncClientEmbedChartsCtaLinks);
        }
        if (yrsIn && !yrsIn.dataset.ptwired) {
          yrsIn.dataset.ptwired = '1';
          yrsIn.addEventListener('focus', function () {
            var n = parsePtSimNumber(this.value);
            if (Number.isFinite(n)) this.value = toPlainEditStringSim(n, 1);
            else this.value = String(this.value).replace(/[\\s\u00A0\u202F]/g, '');
          });
          yrsIn.addEventListener('blur', function () {
            var n = parsePtSimNumber(this.value);
            var maxAttr = parseFloat(this.getAttribute('max'));
            var maxY = Number.isFinite(maxAttr) ? maxAttr : 1e9;
            if (Number.isFinite(n)) {
              var v = Math.max(0.5, Math.min(maxY, Math.round(n * 2) / 2));
              this.value = formatPtThousandsSim(v, 1);
            }
          });
        }
      }

      function formatEur0(x) {
        if (!Number.isFinite(x)) return '—';
        try {
          return new Intl.NumberFormat('pt-PT', {
            style: 'currency',
            currency: 'EUR',
            maximumFractionDigits: 0,
            minimumFractionDigits: 0,
          }).format(x);
        } catch (e) {
          return Math.round(x).toLocaleString('pt-PT') + ' €';
        }
      }

      function formatSimYearsSentence(years) {
        if (!Number.isFinite(years) || years <= 0) return '';
        const rounded = Math.round(years * 10) / 10;
        var str;
        if (rounded % 1 === 0) {
          str = String(Math.round(rounded));
        } else {
          str = String(rounded).replace('.', ',');
        }
        var unit = (rounded === 1) ? 'ano' : 'anos';
        return 'Após ' + str + ' ' + unit + ' de investimento contínuo (ilustrativo).';
      }

      function syncClientEmbedChartsCtaLinks() {
        var ctxReg = document.getElementById('simApiContext');
        if (!ctxReg || ctxReg.dataset.clientEmbed !== '1') return;
        var capIn = document.getElementById('simCapital');
        var capital = 5000;
        if (capIn) {
          var v = parsePtSimNumber(capIn.value);
          if (Number.isFinite(v) && v >= 5000) capital = Math.round(v);
        }
        var q = '?capital=' + encodeURIComponent(String(capital));
        var approveBase = String(ctxReg.dataset.approveHref || '').trim();
        var regBase = String(ctxReg.dataset.registerBase || '').trim();
        if (approveBase.endsWith('/')) approveBase = approveBase.slice(0, -1);
        if (regBase.endsWith('/')) regBase = regBase.slice(0, -1);
        var cl = document.getElementById('chartsEmbedCtaLink');
        var cr = document.getElementById('chartsEmbedCtaRegLink');
        if (cl) {
          if (approveBase) cl.href = approveBase + q;
          else if (regBase) cl.href = regBase + q;
        }
        if (cr && regBase) cr.href = regBase + q;
      }

      function runSimulator() {
        const errEl = document.getElementById('simError');
        const resultsEl = document.getElementById('simResults');
        const capIn = document.getElementById('simCapital');
        const yrsIn = document.getElementById('simYears');
        const modelLbl = document.getElementById('simModelResultLabel');
        if (!capIn || !yrsIn || !errEl || !resultsEl) return;
        if (modelLbl) {
          modelLbl.textContent = simActiveModelLabel + ' (valor ilustrativo final)';
        }
        errEl.style.display = 'none';
        errEl.textContent = '';
        errEl.style.color = '#f87171';

        const capital = parsePtSimNumber(capIn.value);
        let years = parsePtSimNumber(yrsIn.value);
        const SIM_MIN_CAPITAL = 5000;
        if (!Number.isFinite(capital) || capital < SIM_MIN_CAPITAL) {
          errEl.textContent = 'O investimento mínimo é 5 000 € — indique um capital igual ou superior.';
          errEl.style.display = 'block';
          return;
        }
        if (!Number.isFinite(years) || years <= 0) {
          errEl.textContent = 'Indique um número de anos válido (> 0).';
          errEl.style.display = 'block';
          return;
        }
        const n = simActiveDates.length;
        const maxSeriesYears = (n > 1) ? (n - 1) / SIM_DAYS_PER_YEAR : 0;
        if (n < 2) {
          errEl.textContent = 'Série insuficiente para simular.';
          errEl.style.display = 'block';
          return;
        }

        const clampedYears = Math.min(years, maxSeriesYears);
        if (clampedYears < years) {
          errEl.textContent = 'Nota: o horizonte foi limitado ao máximo disponível na série (~' + maxSeriesYears.toFixed(2) + ' anos).';
          errEl.style.color = '#fbbf24';
          errEl.style.display = 'block';
        }

        let daysBack = Math.round(clampedYears * SIM_DAYS_PER_YEAR);
        daysBack = Math.min(Math.max(1, daysBack), n - 1);
        const startIdx = n - 1 - daysBack;

        const m0 = Number(simActiveModel[startIdx]);
        const b0 = Number(simActiveBench[startIdx]);
        if (!(m0 > 0) || !(b0 > 0)) {
          errEl.style.color = '#f87171';
          errEl.textContent = 'Dados inválidos no início da janela seleccionada.';
          errEl.style.display = 'block';
          return;
        }

        const sliceDates = simActiveDates.slice(startIdx);
        const modelVal = [];
        const benchVal = [];
        for (let i = startIdx; i < n; i++) {
          modelVal.push(capital * Number(simActiveModel[i]) / m0);
          benchVal.push(capital * Number(simActiveBench[i]) / b0);
        }

        const elM = document.getElementById('simEndModel');
        const elB = document.getElementById('simEndBench');
        const elMg = document.getElementById('simEndMargin');
        const elW = document.getElementById('simWindow');
        const endM = modelVal[modelVal.length - 1];
        const endB = benchVal[benchVal.length - 1];
        if (elM) elM.textContent = formatEur0(endM);
        if (elB) elB.textContent = formatEur0(endB);
        var marginHeroEmb = document.getElementById('simMarginHeroEmbed');
        var marginHeroFull = document.getElementById('simMarginHeroFull');
        var marginVals = null;
        var endMg = null;
        if (
          Array.isArray(simActiveMargin) &&
          simActiveMargin.length === n &&
          simActiveMarginLabel
        ) {
          const mm0 = Number(simActiveMargin[startIdx]);
          if (mm0 > 0) {
            marginVals = [];
            for (let i = startIdx; i < n; i++) {
              marginVals.push(capital * Number(simActiveMargin[i]) / mm0);
            }
            endMg = marginVals[marginVals.length - 1];
          }
        }
        if (elMg) {
          if (endMg != null && Number.isFinite(endMg)) {
            elMg.textContent = formatEur0(endMg);
            if (marginHeroEmb) marginHeroEmb.style.display = 'block';
            if (marginHeroFull) marginHeroFull.style.display = 'block';
          } else {
            elMg.textContent = '—';
            if (marginHeroEmb) marginHeroEmb.style.display = 'none';
            if (marginHeroFull) marginHeroFull.style.display = 'none';
          }
        }
        var elTemporal = document.getElementById('simTemporalLine');
        if (elTemporal) {
          elTemporal.textContent = formatSimYearsSentence(clampedYears);
        }
        const elDelta = document.getElementById('simDeltaLine');
        var ctxRegSim = document.getElementById('simApiContext');
        var clientEmbSim = ctxRegSim && ctxRegSim.dataset.clientEmbed === '1';
        if (elDelta) {
          if (clientEmbSim) {
            elDelta.classList.remove('sim-delta-line--institutional');
            elDelta.textContent = '';
            elDelta.style.display = 'none';
          } else {
            elDelta.classList.remove('sim-delta-line--institutional');
            const diff = endM - endB;
            const sign = diff >= 0 ? '+' : '−';
            const absStr = formatEur0(Math.abs(diff));
            var line = 'Diferença ilustrativa face ao mercado no mesmo período: ' + sign + absStr.replace(/^−/, '') + ' €';
            if (endB > 0) {
              const r = endM / endB;
              if (Number.isFinite(r)) {
                if (r >= 1.03) {
                  line += ' · montante final ilustrativo ~' + r.toFixed(1).replace('.', ',') + '× face ao referencial';
                } else if (r <= 0.97) {
                  line += ' · montante final ilustrativo ~' + r.toFixed(1).replace('.', ',') + '× face ao referencial';
                }
              }
            }
            elDelta.textContent = line;
            elDelta.style.display = 'block';
          }
        }
        if (elW) {
          const approxY = (daysBack / SIM_DAYS_PER_YEAR).toFixed(1);
          elW.textContent = sliceDates[0] + ' → ' + sliceDates[sliceDates.length - 1] + ' (~' + approxY + ' a)';
        }
        var simBtn = document.getElementById('simRunBtn');
        if (simBtn) simBtn.textContent = 'Atualizar simulação';

        const canvas = document.getElementById('simulatorChart');
        const ctaBlock = document.getElementById('simCtaBlock');
        const ctaLink = document.getElementById('simCtaLink');
        const ctaRegLink = document.getElementById('simCtaRegisterLink');
        const ctxReg = document.getElementById('simApiContext');
        if (ctaBlock && ctaLink && ctxReg) {
          const capRound = Math.max(5000, Math.round(capital));
          const q = '?capital=' + encodeURIComponent(String(capRound));
          let approveBase = String(ctxReg.dataset.approveHref || '').trim();
          let regBase = String(ctxReg.dataset.registerBase || '').trim();
          if (approveBase.endsWith('/')) approveBase = approveBase.slice(0, -1);
          if (regBase.endsWith('/')) regBase = regBase.slice(0, -1);
          if (approveBase) {
            ctaLink.href = approveBase + q;
          } else if (regBase) {
            ctaLink.href = regBase + q;
          }
          if (ctaRegLink && regBase) {
            ctaRegLink.href = regBase + q;
          }
          if (ctxReg.dataset.clientEmbed !== '1') {
            ctaBlock.style.display = 'block';
          }
        }
        syncClientEmbedChartsCtaLinks();

        if (canvas) {
          const ctx = canvas.getContext('2d');
          if (simulatorChart) simulatorChart.destroy();
          if (simulatorDdChart) simulatorDdChart.destroy();
          var eqDatasetsSim = [
            {
              label: simActiveModelLabel,
              data: modelVal,
              borderColor: '#4ade80',
              tension: 0.05,
              pointRadius: 0,
            },
          ];
          if (marginVals && marginVals.length === modelVal.length) {
            eqDatasetsSim.push({
              label: simActiveMarginLabel || cap15MarginLabelPt,
              data: marginVals,
              borderColor: '#fb923c',
              tension: 0.05,
              pointRadius: 0,
            });
          }
          eqDatasetsSim.push({
            label: 'Referência (benchmark)',
            data: benchVal,
            borderColor: '#2dd4bf',
            tension: 0.05,
            pointRadius: 0,
          });
          simulatorChart = new Chart(ctx, {
            type: 'line',
            data: {
              labels: sliceDates,
              datasets: eqDatasetsSim,
            },
            options: {
              ...chartStatic,
              ...chartEmbedLayout,
              interaction: { mode: 'index', intersect: false },
              scales: {
                y: {
                  type: 'logarithmic',
                  ticks: { color: '#9ca3af' },
                  grid: { color: 'rgba(148, 163, 184, 0.15)' },
                },
                x: {
                  ticks: {
                    display: true,
                    callback: (value) => {
                      const idx = typeof value === 'number' ? value : parseInt(value, 10);
                      const d = sliceDates[idx];
                      if (!d) return '';
                      const year = d.slice(0, 4);
                      const prev = sliceDates[idx - 1];
                      if (!prev) return year;
                      return String(prev).slice(0, 4) !== year ? year : '';
                    },
                    color: '#9ca3af',
                    maxRotation: 0,
                    autoSkip: false,
                  },
                  grid: { display: false },
                },
              },
              plugins: {
                legend: { labels: { color: '#e5e7eb' } },
              },
            },
          });
          var ddCanvas = document.getElementById('simulatorDdChart');
          if (ddCanvas) {
            var ddCtx = ddCanvas.getContext('2d');
            var ddModel = equityCurveToDrawdownFractions(modelVal);
            var ddBench = equityCurveToDrawdownFractions(benchVal);
            var ddDatasetsSim = [
              {
                label: simActiveModelLabel,
                data: ddModel,
                borderColor: '#4ade80',
                borderWidth: 1,
                tension: 0.05,
                pointRadius: 0,
              },
            ];
            if (marginVals && marginVals.length === modelVal.length) {
              ddDatasetsSim.push({
                label: simActiveMarginLabel || cap15MarginLabelPt,
                data: equityCurveToDrawdownFractions(marginVals),
                borderColor: '#fb923c',
                borderWidth: 1,
                tension: 0.05,
                pointRadius: 0,
              });
            }
            ddDatasetsSim.push({
              label: 'Referência (benchmark)',
              data: ddBench,
              borderColor: '#2dd4bf',
              borderWidth: 1,
              tension: 0.05,
              pointRadius: 0,
            });
            simulatorDdChart = new Chart(ddCtx, {
              type: 'line',
              data: {
                labels: sliceDates,
                datasets: ddDatasetsSim,
              },
              options: {
                ...chartStatic,
                ...chartEmbedLayout,
                interaction: { mode: 'index', intersect: false },
                scales: {
                  y: {
                    ticks: {
                      callback: function (v) { return (v * 100).toFixed(0) + '%'; },
                      color: '#9ca3af',
                    },
                    grid: { color: 'rgba(148, 163, 184, 0.15)' },
                  },
                  x: {
                    ticks: {
                      display: true,
                      callback: (value) => {
                        const idx = typeof value === 'number' ? value : parseInt(value, 10);
                        const d = sliceDates[idx];
                        if (!d) return '';
                        const year = d.slice(0, 4);
                        const prev = sliceDates[idx - 1];
                        if (!prev) return year;
                        return String(prev).slice(0, 4) !== year ? year : '';
                      },
                      color: '#9ca3af',
                      maxRotation: 0,
                      autoSkip: false,
                    },
                    grid: { display: false },
                  },
                },
                plugins: {
                  legend: { labels: { color: '#e5e7eb' } },
                },
              },
            });
          }
          window.requestAnimationFrame(function () {
            var p = canvas.closest('.kpi-chart-panel--zoomable');
            if (p && (document.fullscreenElement === p || document.webkitFullscreenElement === p)) {
              var ch = Chart.getChart(canvas);
              if (ch) ch.resize();
            }
            var ddC = document.getElementById('simulatorDdChart');
            if (ddC) {
              var p2 = ddC.closest('.kpi-chart-panel--zoomable');
              if (p2 && (document.fullscreenElement === p2 || document.webkitFullscreenElement === p2)) {
                var ch2 = Chart.getChart(ddC);
                if (ch2) ch2.resize();
              }
            }
          });
          if (typeof applyKpiViewChartLabels === 'function') applyKpiViewChartLabels();
        }
        resultsEl.style.display = 'block';
      }

      document.getElementById('simRunBtn')?.addEventListener('click', runSimulator);
      wireSimulatorThousandInputs();
      syncClientEmbedChartsCtaLinks();
      document.getElementById('simProfileSelect')?.addEventListener('change', function () {
        const v = this.value;
        if (v) fetchSimulatorSeriesForProfile(v);
      });
      (function () {
        var ctx = document.getElementById('simApiContext');
        if (!ctx || ctx.dataset.clientEmbed !== '1') return;
        if (document.getElementById('simProfileSelect')) return;
        var p = String(ctx.dataset.embedProfile || 'moderado').trim();
        if (p) fetchSimulatorSeriesForProfile(p);
      })();
      document.querySelector('.tab[data-tab="simulator"]')?.addEventListener('click', function () {
        window.setTimeout(runSimulator, 60);
      });
      if (document.getElementById('tab-simulator')?.classList.contains('active')) {
        window.setTimeout(runSimulator, 120);
      }
      applyKpiViewChartLabels();
    </script>
  </body>
</html>
"""


def load_equity_curve(path: Path, equity_col: str):
    df = pd.read_csv(path, parse_dates=["date"])
    df = df.sort_values("date")
    equity = df[equity_col].astype(float)
    return df["date"].iloc[0], df["date"].iloc[-1], equity, df["date"]


def model_equity_csv_is_stub(path: Path) -> bool:
    """
    Alguns freezes têm `model_equity_final_20y_moderado.csv` com ~60 linhas (artefacto curto).
    KPIs sobre ~60 dias vs benchmark longo distorcem CAGR/vol e duplicam cartões.
    Critérios alinhados a `resolve_benchmark_equity_csv_path` (stub).
    """
    if not path.exists():
        return True
    try:
        n = len(pd.read_csv(path, usecols=["date"]))
    except Exception:
        return True
    try:
        df = pd.read_csv(path, usecols=["date"], parse_dates=["date"])
        if len(df) < 2:
            span = 0
        else:
            span = int((df["date"].max() - df["date"].min()).days)
    except Exception:
        span = 0
    return n < 500 or (0 < span < 400)


def pick_model_equity_path_for_profile(
    base_path: Path,
    profile_key: str,
    *,
    force_synthetic_profile_vol: bool,
) -> tuple[Path, bool]:
    """
    Preferir `model_equity_final_20y_{perfil}.csv` quando tiver histórico longo;
    caso contrário `model_equity_final_20y.csv` + política de vol sintética se aplicável.
    """
    model_path_default = base_path / "model_equity_final_20y.csv"
    model_path_by_profile = base_path / f"model_equity_final_20y_{profile_key}.csv"
    if force_synthetic_profile_vol:
        return model_path_default, False
    if model_path_by_profile.exists() and not model_equity_csv_is_stub(model_path_by_profile):
        return model_path_by_profile, True
    if model_path_default.exists():
        return model_path_default, False
    if model_path_by_profile.exists():
        return model_path_by_profile, True
    return model_path_default, False


def pick_plafonado_smooth_model_equity_path(
    base_path: Path,
    profile_key: str,
    *,
    force_synthetic_profile_vol: bool,
) -> tuple[Path, bool]:
    """
    CAP15 plafonado (smooth / MAX100EXP): **moderado** usa sempre `model_equity_final_20y.csv`
    (série investível canónica do freeze, corrida com perfil moderado no motor). Conservador/dinâmico
    mantêm a lógica de `pick_model_equity_path_for_profile` quando `force_synthetic_profile_vol` está off.
    """
    pk = normalize_risk_profile_key(profile_key)
    model_path_default = base_path / "model_equity_final_20y.csv"
    if force_synthetic_profile_vol:
        return model_path_default, False
    if pk == "moderado":
        return model_path_default, False
    return pick_model_equity_path_for_profile(
        base_path, profile_key, force_synthetic_profile_vol=force_synthetic_profile_vol
    )


def resolve_benchmark_equity_csv_path(model_outputs_dir: Path) -> Path:
    """
    Usa `benchmark_equity_final_20y.csv` em `model_outputs_dir` quando tem histórico completo.
    Se for um ficheiro curto (stub) ou calendário muito curto, prefere `model_outputs_from_clone/`
    no mesmo freeze; se a pasta clone não existir, tenta caminhos de fallback no repositório.
    """
    primary = model_outputs_dir / "benchmark_equity_final_20y.csv"
    clone = model_outputs_dir.parent / "model_outputs_from_clone" / "benchmark_equity_final_20y.csv"

    def _n_rows(p: Path) -> int:
        if not p.exists():
            return 0
        try:
            return len(pd.read_csv(p, usecols=["date"]))
        except Exception:
            return 0

    def _date_span_days(p: Path) -> int:
        if not p.exists():
            return 0
        try:
            df = pd.read_csv(p, usecols=["date"], parse_dates=["date"])
            if len(df) < 2:
                return 0
            return int((df["date"].max() - df["date"].min()).days)
        except Exception:
            return 0

    np = _n_rows(primary)
    nc = _n_rows(clone)
    span_p = _date_span_days(primary)
    # Stub típico: ~60 linhas / ~2 meses; evita alinhar ao índice longo do modelo e «achatar» CAGR/vol.
    primary_stub = np < 500 or (0 < span_p < 400)
    if nc >= 500 and primary_stub:
        return clone
    if np >= 500 and not primary_stub:
        return primary
    if nc > 0 and (np == 0 or nc > np * 3):
        return clone
    if primary_stub:
        for fb in _fallback_benchmark_equity_csv_list():
            if _n_rows(fb) >= 500:
                return fb
        # Checkout parcial: sem `model_outputs_from_clone/` ao lado do modelo — procurar no `freeze/`.
        for root in _freeze_search_roots():
            freeze = root / "freeze"
            if not freeze.is_dir():
                continue
            try:
                for d in freeze.rglob("model_outputs_from_clone"):
                    if not d.is_dir():
                        continue
                    cand = d / "benchmark_equity_final_20y.csv"
                    if _n_rows(cand) >= 500:
                        return cand
            except OSError:
                continue
    return clone if nc > 0 else primary


def coerce_long_benchmark_csv_path(initial: Path, model_outputs_dir: Path) -> Path:
    """
    Garante ficheiro de benchmark com histórico longo (≥500 datas).
    Se `resolve_benchmark_equity_csv_path` cair num stub (~60 linhas) porque falta `model_outputs_from_clone`
    e os fallbacks absolutos não existem nesse checkout, procura em `freeze/**/model_outputs_from_clone/`.
    Um stub alinhado por ffill a milhares de dias úteis produz CAGR/vol ~0 no cartão «Mercado».
    """
    try:
        n0 = len(pd.read_csv(initial, usecols=["date"]))
    except Exception:
        n0 = 0
    if n0 >= 500:
        return initial

    clone = model_outputs_dir.parent / "model_outputs_from_clone" / "benchmark_equity_final_20y.csv"
    candidates: list[Path] = [clone, *_fallback_benchmark_equity_csv_list()]
    for p in candidates:
        if not p.exists():
            continue
        try:
            if len(pd.read_csv(p, usecols=["date"])) >= 500:
                return p
        except Exception:
            continue

    for root in _freeze_search_roots():
        freeze = root / "freeze"
        if not freeze.is_dir():
            continue
        try:
            for d in freeze.rglob("model_outputs_from_clone"):
                if not d.is_dir():
                    continue
                cand = d / "benchmark_equity_final_20y.csv"
                if not cand.exists():
                    continue
                try:
                    if len(pd.read_csv(cand, usecols=["date"])) >= 500:
                        return cand
                except Exception:
                    continue
        except OSError:
            continue
    return initial


def resolve_coerced_benchmark_equity_csv_path(model_outputs_dir: Path) -> Path:
    """`resolve_benchmark` + `coerce_long` — usar em todo o código que calcula KPIs vs benchmark (não só em `index`)."""
    p = resolve_benchmark_equity_csv_path(model_outputs_dir)
    return coerce_long_benchmark_csv_path(p, model_outputs_dir)


def resolve_theoretical_model_equity_csv_path(base_path: Path) -> Path | None:
    """
    Curva «motor bruto» para o cartão teórico: ao lado do modelo activo; se faltar (clone parcial),
    tenta o freeze V2.3 smooth em cada raiz conhecida (`REPO_ROOT` e pasta do `kpi_server.py`).
    """
    p = base_path / "model_equity_theoretical_20y.csv"
    if p.exists():
        return p
    for root in _freeze_search_roots():
        fb = root / "freeze" / "DECIDE_MODEL_V5_V2_3_SMOOTH" / "model_outputs" / "model_equity_theoretical_20y.csv"
        if fb.exists():
            return fb
    return None


def _csv_date_row_count(path: Path) -> int:
    if not path.exists():
        return 0
    try:
        return int(len(pd.read_csv(path, usecols=["date"])))
    except Exception:
        return 0


def resolve_canon_smooth_benchmark_clone_csv() -> Path | None:
    """
    Benchmark longo no freeze V2.3 smooth (`model_outputs_from_clone`).
    Percorre `REPO_ROOT` e a pasta do `kpi_server.py` — com `DECIDE_PROJECT_ROOT` noutro clone,
    fixar só `_kpi_package_dir()/freeze/...` falha e deixa stub ~60 linhas → CAGR/vol ~0 no cartão «Mercado».
    """
    for root in _freeze_search_roots():
        p = (
            root
            / "freeze"
            / "DECIDE_MODEL_V5_V2_3_SMOOTH"
            / "model_outputs_from_clone"
            / "benchmark_equity_final_20y.csv"
        )
        if _csv_date_row_count(p) >= 500:
            return p
    return None


def resolve_cap15_embed_raw_motor_equity_csv_path(model_path: Path, base_path: Path) -> Path | None:
    """
    Cartão esquerdo do iframe: série **RAW / motor** (não o plafonado `model_path`).
    Ordem: teórico ao lado do modelo → teórico no freeze V2.3 smooth (sem fallback para outros modelos).
    Nunca devolve o mesmo ficheiro que `model_path` (evita duplicar KPIs com o CAP15 plafonado).
    """
    candidates: list[Path] = []
    th = resolve_theoretical_model_equity_csv_path(base_path)
    if th is not None:
        candidates.append(th)
    candidates.append(base_path / "model_equity_theoretical_20y.csv")
    for root in _freeze_search_roots():
        candidates.append(
            root / "freeze" / "DECIDE_MODEL_V5_V2_3_SMOOTH" / "model_outputs" / "model_equity_theoretical_20y.csv",
        )
    seen: set[str] = set()
    for cand in candidates:
        if not cand.exists():
            continue
        try:
            key = str(cand.resolve())
        except OSError:
            key = str(cand)
        if key in seen:
            continue
        seen.add(key)
        try:
            if model_path.exists() and cand.resolve().samefile(model_path.resolve()):
                continue
        except OSError:
            pass
        return cand
    return None


def reinforce_long_benchmark_csv_path(bench_path: Path, model_outputs_dir: Path) -> Path:
    """
    Garante CSV de benchmark com histórico longo (≥500 datas) antes de `load_equity_curve`.
    Reforço em cadeia se `resolve_coerced_benchmark` ainda cair num stub (~60 linhas).
    """
    if _csv_date_row_count(bench_path) >= 500:
        return bench_path
    clone = model_outputs_dir.parent / "model_outputs_from_clone" / "benchmark_equity_final_20y.csv"
    for p in (clone, *_fallback_benchmark_equity_csv_list()):
        if _csv_date_row_count(p) >= 500:
            return p
    for root in _freeze_search_roots():
        fz = root / "freeze"
        if not fz.is_dir():
            continue
        try:
            for d in fz.rglob("model_outputs_from_clone"):
                if not d.is_dir():
                    continue
                cand = d / "benchmark_equity_final_20y.csv"
                if _csv_date_row_count(cand) >= 500:
                    return cand
        except OSError:
            continue
    return bench_path


def resolve_cap15_margin_model_csv(
    profile_key: str,
    *,
    force_synthetic_profile_vol: bool,
    main_model_path: Path | None = None,
) -> tuple[Path, bool] | None:
    """
    Série «com margem» para o comparativo CAP15 no iframe: **só** freeze V2.3 smooth
    (`DECIDE_MODEL_V5_V2_3_SMOOTH/model_outputs`). Sem fallback para `v5_overlay_cap15` nem outros freezes.
    """
    _ = force_synthetic_profile_vol  # API estável; só se usam CSVs `*_margin` no smooth.
    smooth_base = MODEL_PATHS.get("v5_overlay_cap15_max100exp")
    if smooth_base is None:
        return None

    def _ok(p: Path) -> bool:
        if not p.exists():
            return False
        if main_model_path is None:
            return True
        try:
            return not p.resolve().samefile(main_model_path.resolve())
        except OSError:
            return True

    pk = normalize_risk_profile_key(profile_key)
    # CSVs `*_margin` são variantes explícitas — usar sempre o sufixo do perfil quando existir,
    # mesmo com vol sintética no modelo principal (iframe).
    p_prof = smooth_base / f"model_equity_final_20y_{pk}_margin.csv"
    if _ok(p_prof):
        return (p_prof, True)
    p_def_margin = smooth_base / "model_equity_final_20y_margin.csv"
    if _ok(p_def_margin):
        return (p_def_margin, False)
    return None


def _cap15_equity_series_is_plafonado_duplicate(candidate: pd.Series, plafonado: pd.Series) -> bool:
    """True se a série alinhada coincide numericamente com o investível plafonado (freeze errado / cópia)."""
    if len(candidate) != len(plafonado):
        return False
    a = np.asarray(candidate, dtype=float)
    b = np.asarray(plafonado, dtype=float)
    return bool(np.allclose(a, b, rtol=0.0, atol=1e-5))


def _iter_smooth_margin_equity_csv_paths(profile_key: str, main_model_path: Path | None) -> list[Path]:
    """
    Todas as variantes `*_margin.csv` conhecidas em cada raíz com freeze smooth, por ordem:
    perfil específico → `model_equity_final_20y_margin.csv`. Ignora samefile que o CSV plafonado activo.
    """
    pk = normalize_risk_profile_key(profile_key)
    out: list[Path] = []
    seen: set[str] = set()
    for root in _freeze_search_roots():
        base = root / "freeze" / "DECIDE_MODEL_V5_V2_3_SMOOTH" / "model_outputs"
        for fname in (f"model_equity_final_20y_{pk}_margin.csv", "model_equity_final_20y_margin.csv"):
            p = base / fname
            if not p.is_file():
                continue
            if main_model_path is not None:
                try:
                    if p.resolve().samefile(main_model_path.resolve()):
                        continue
                except OSError:
                    pass
            try:
                key = str(p.resolve())
            except OSError:
                key = str(p)
            if key in seen:
                continue
            seen.add(key)
            out.append(p)
    return out


def _reindex_margin_curve_to_model_calendar(
    margin_eq: list[float] | np.ndarray,
    margin_dates: pd.Series,
    model_dates: pd.Series,
    plafonado_eq: pd.Series | np.ndarray | list[float],
) -> pd.Series | None:
    """
    Alinha o CSV «margem» / MAX100 ao calendário do modelo plafonado.

    ``reindex(...).ffill().bfill()`` na cabeça repete o primeiro valor disponível em todo o
    período anterior — gera um patamar horizontal desde ~2007 enquanto o benchmark já varia.
    Aqui: ``ffill`` + lacunas iniciais preenchidas com a **série plafonada** (mesmo período)
    até existir trajectória própria no ficheiro de margem.
    """
    dt_m = pd.to_datetime(model_dates)
    s_fm = pd.Series(np.asarray(margin_eq, dtype=float), index=pd.to_datetime(margin_dates))
    s_fm = s_fm[~s_fm.index.duplicated(keep="last")].sort_index()
    s_al = s_fm.reindex(dt_m).ffill()
    plaf = np.asarray(plafonado_eq, dtype=float).reshape(-1)
    if len(s_al) != len(plaf):
        return None
    s_pl = pd.Series(plaf, index=s_al.index)
    s_al = s_al.where(s_al.notna(), s_pl)
    if bool(s_al.isna().any()):
        s_al = s_al.bfill().ffill()
    if bool(s_al.isna().any()):
        return None
    # CSVs de margem / MAX100 por vezes repetem o 1.º valor em toda a cabeça da série (sem NaNs) —
    # o ``bfill`` antigo copiava esse patamar para trás; aqui já não, mas ainda precisamos de
    # substituir o prefixo em que a margem não se move e o plafonado sim (curva «morta» vs benchmark).
    raw_ff = s_fm.reindex(dt_m).ffill()
    if bool(raw_ff.notna().any()):
        dv = raw_ff.pct_change().abs()
        dp = s_pl.pct_change().abs()
        not_stale = ~((dv < 1e-7) & (dp > 1e-4))
        not_stale = not_stale.fillna(True)
        ns = not_stale.to_numpy(dtype=bool)
        idx_alive = np.flatnonzero(ns)
        first_live = int(idx_alive[0]) if idx_alive.size else len(s_al)
        if first_live > 0:
            for i in range(first_live):
                s_al.iloc[i] = float(s_pl.iloc[i])
    return s_al


def _backfill_cap15_flat_model_prefix_with_benchmark(
    model_eq: pd.Series,
    bench_eq: pd.Series,
    dates: pd.Series,
    *,
    flat_tol: float = 1e-7,
) -> pd.Series:
    """Enquanto o CSV do CAP15 / margem / MAX100 fica em NAV inicial (platô), o gráfico log parece «morto».

    Do primeiro dia de calendário >= ``DECIDE_KPI_BACKFILL_PREFIX_START`` (default ``2006-04-01``)
    até ao dia anterior ao primeiro movimento da série do modelo, substitui por uma réplica do
    benchmark ancorada no NAV do modelo nesse primeiro dia de Abril — o índice «mexe» com os preços.

    Por defeito fica desligado; activar com ``DECIDE_KPI_CAP15_BENCH_BACKFILL=1``.
    O legado ``DECIDE_KPI_DISABLE_CAP15_BENCH_BACKFILL=1`` também força desligar.
    """
    if not kpi_cap15_bench_prefix_backfill_enabled():
        return model_eq
    start_raw = (os.environ.get("DECIDE_KPI_BACKFILL_PREFIX_START") or "2006-04-01").strip()
    if not start_raw or start_raw.lower() in ("0", "false", "off", "none"):
        return model_eq
    if len(model_eq) != len(bench_eq) or len(model_eq) != len(dates):
        return model_eq
    out = model_eq.astype(float).copy()
    dtp = pd.to_datetime(dates, errors="coerce")
    if bool(dtp.isna().any()):
        return model_eq
    try:
        april_cut = pd.Timestamp(start_raw)
    except (ValueError, TypeError):
        return model_eq
    mask_april = dtp >= april_cut
    if not bool(mask_april.any()):
        return model_eq
    i_april = int(np.argmax(mask_april.to_numpy(dtype=bool)))

    def _first_index_nav_move() -> int:
        base = float(out.iloc[0])
        for i in range(1, len(out)):
            if abs(float(out.iloc[i]) - base) > flat_tol:
                return i
        return len(out)

    def _first_index_return_move() -> int:
        try:
            ret_tol = float(os.environ.get("DECIDE_KPI_BACKFILL_RET_TOL", "1e-9"))
        except ValueError:
            ret_tol = 1e-9
        rets = out.pct_change().abs().fillna(0.0)
        for i in range(1, len(out)):
            if float(rets.iloc[i]) > ret_tol:
                return i
        return len(out)

    # ``max`` evita falsos «primeiro dia vivo» por ruído numérico na NAV; ``ret`` captura platô com retorno nulo.
    i_live = max(_first_index_nav_move(), _first_index_return_move())
    if i_live >= len(out) or i_april >= i_live:
        return model_eq
    b0 = float(bench_eq.iloc[i_april])
    if not np.isfinite(b0) or abs(b0) < 1e-300:
        return model_eq
    m_apr = float(out.iloc[i_april])
    span = bench_eq.iloc[i_april:i_live].astype(float)
    if not bool(np.isfinite(span.to_numpy(dtype=float)).all()):
        return model_eq
    for i in range(i_april, i_live):
        out.iloc[i] = float(bench_eq.iloc[i]) / b0 * m_apr
    return out


def load_cap15_margin_series_distinct_from_plafonado(
    profile_key: str,
    dates: pd.Series,
    model_eq: pd.Series,
    bench_eq: pd.Series,
    *,
    main_model_path: Path,
    client_embed: bool,
    force_synthetic_profile_vol: bool,
) -> tuple[pd.Series, Path] | None:
    """
    Carrega a série «com margem» alinhada a `dates`, com a mesma política de vol que o CAP15 plafonado
    (`strict_cap15_vol_targets`). Percorre raízes em `_iter_smooth_margin_equity_csv_paths` até conseguir ler
    um CSV válido (o primeiro candidato válido ganha).
    """
    profile_key = normalize_risk_profile_key(profile_key)
    dt_m = pd.to_datetime(dates)
    for margem_path in _iter_smooth_margin_equity_csv_paths(profile_key, main_model_path):
        try:
            _, _, margem_eq_file, margem_dates_s = load_equity_curve(margem_path, "model_equity")
            s_aligned_m = _reindex_margin_curve_to_model_calendar(
                margem_eq_file, margem_dates_s, dates, model_eq
            )
            if s_aligned_m is None or len(s_aligned_m) != len(dt_m):
                continue
            margin_series = pd.Series([float(x) for x in s_aligned_m.values], dtype=float)
            used_profile_file = margem_path.name != "model_equity_final_20y_margin.csv"
            margin_series = apply_model_equity_profile_policy(
                margin_series,
                bench_eq,
                profile_key,
                used_profile_file=used_profile_file,
                client_embed=client_embed,
                force_synthetic_profile_vol=force_synthetic_profile_vol,
                strict_cap15_vol_targets=True,
            )
            margin_series = _backfill_cap15_flat_model_prefix_with_benchmark(
                margin_series, bench_eq, dates
            )
            margin_series = cap_equity_vs_benchmark_rail(bench_eq, margin_series)
            # Não rejeitar se coincidir com o plafonado: com `equity_overlay_margin` do motor V5, nos dias em
            # que o teto NAV 100% não activa, as duas curvas são a mesma série — isso é correcto.
            return margin_series, margem_path
        except Exception as exc:
            print(f"[kpi_server] falha ao ler margem {margem_path}: {exc}", file=sys.stderr)
            continue
    return None


def resolve_distinct_smooth_theoretical_vs_plafonado(
    dates: pd.Series,
    model_eq: pd.Series,
    raw_eq: pd.Series,
    raw_path: Path,
) -> tuple[pd.Series, Path]:
    """
    Se o teórico alinhado coincide com o plafonado (cópia errada no freeze), tenta
    `model_equity_theoretical_20y.csv` noutras raízes (`_freeze_search_roots`), como no benchmark longo.
    """
    if len(raw_eq) != len(model_eq) or not _cap15_equity_series_is_plafonado_duplicate(raw_eq, model_eq):
        return raw_eq, raw_path
    for root in _freeze_search_roots():
        p = (
            root
            / "freeze"
            / "DECIDE_MODEL_V5_V2_3_SMOOTH"
            / "model_outputs"
            / "model_equity_theoretical_20y.csv"
        )
        if not p.is_file():
            continue
        try:
            if raw_path.is_file() and p.resolve().samefile(raw_path.resolve()):
                continue
        except OSError:
            pass
        try:
            _, _, seq, sdt = load_equity_curve(p, "model_equity")
            seq = align_equity_series_to_target_dates(seq, sdt, dates)
            if len(seq) == len(model_eq) and not _cap15_equity_series_is_plafonado_duplicate(seq, model_eq):
                print(f"[kpi_server] RAW/teórico distinto carregado de {p}", file=sys.stderr)
                return seq, p
        except Exception as exc:
            print(f"[kpi_server] falha ao ler teórico candidato {p}: {exc}", file=sys.stderr)
            continue
    return raw_eq, raw_path


def align_equity_series_to_target_dates(
    equity: pd.Series,
    source_dates: pd.Series,
    target_dates: pd.Series,
) -> pd.Series:
    """
    Alinha a série do benchmark ao calendário do modelo. Os CSVs podem ter comprimentos
    diferentes (ex.: benchmark mensal vs equity diária) — evita ValueError em
    compute_monthly_stats / compute_rolling_alpha ao atribuir o mesmo índice de datas.
    """
    if len(equity) == len(target_dates):
        return equity.astype(float).reset_index(drop=True)
    idx = pd.to_datetime(source_dates)
    s = pd.Series(np.asarray(equity, dtype=float), index=idx)
    s = s[~s.index.duplicated(keep="last")].sort_index()
    tgt = pd.to_datetime(target_dates)
    out = s.reindex(tgt).ffill().bfill()
    if bool(out.isna().any()):
        out = out.ffill().bfill()
    return pd.Series(np.asarray(out, dtype=float)).reset_index(drop=True)


def build_horizon_returns_payload(
    dates: pd.Series,
    model_eq: pd.Series | np.ndarray,
    bench_eq: pd.Series | np.ndarray,
) -> dict[str, dict]:
    """
    Retornos totais e séries normalizadas (base 1 no início da janela) para YTD, 1Y, 10Y e 5Y
    (dias úteis ~ 252/ano). Usado na aba «Retornos» vs benchmark em escala log.
    """
    _dt = pd.to_datetime(dates)
    dt = pd.Series(np.asarray(_dt))
    m = np.asarray(model_eq, dtype=float).reshape(-1)
    b = np.asarray(bench_eq, dtype=float).reshape(-1)
    n = len(m)
    last_i = n - 1

    def _finite_or_none(x: float) -> float | None:
        try:
            xf = float(x)
        except (TypeError, ValueError):
            return None
        return xf if np.isfinite(xf) else None

    def pack_window(start_i: int, end_i: int) -> dict:
        if start_i < 0 or end_i <= start_i or end_i >= n:
            return {"ok": False, "reason": "invalid_window"}
        ms = m[start_i : end_i + 1]
        bs = b[start_i : end_i + 1]
        if len(ms) < 2:
            return {"ok": False, "reason": "insufficient_data"}
        if np.any(~np.isfinite(ms)) or np.any(~np.isfinite(bs)):
            return {"ok": False, "reason": "non_finite"}
        if np.any(ms <= 0) or np.any(bs <= 0):
            return {"ok": False, "reason": "non_positive_equity"}
        m0, b0 = float(ms[0]), float(bs[0])
        m_last, b_last = float(ms[-1]), float(bs[-1])
        m_ret = float(m_last / m0 - 1.0)
        b_ret = float(b_last / b0 - 1.0)
        m_norm = (ms / m0).tolist()
        b_norm = (bs / b0).tolist()
        d_labels = [str(pd.Timestamp(dt.iloc[i]).strftime("%Y-%m-%d")) for i in range(start_i, end_i + 1)]
        n_days_win = len(ms)
        years_win = n_days_win / float(TRADING_DAYS_PER_YEAR)
        model_cagr_pct: float | None = None
        bench_cagr_pct: float | None = None
        if years_win > 1e-9 and m0 > 0 and b0 > 0:
            model_cagr_pct = _finite_or_none(((m_last / m0) ** (1.0 / years_win) - 1.0) * 100.0)
            bench_cagr_pct = _finite_or_none(((b_last / b0) ** (1.0 / years_win) - 1.0) * 100.0)
        running_m = np.maximum.accumulate(ms)
        dd_m = ms / running_m - 1.0
        running_b = np.maximum.accumulate(bs)
        dd_b = bs / running_b - 1.0
        model_dd_list = [float(x) for x in dd_m]
        bench_dd_list = [float(x) for x in dd_b]
        model_max_dd_pct = float(np.min(dd_m)) * 100.0
        bench_max_dd_pct = float(np.min(dd_b)) * 100.0
        r_series = pd.Series(ms, dtype=float).pct_change().dropna()
        model_sharpe_raw = (
            compute_sharpe_ratio(r_series) if len(r_series) >= 2 else float("nan")
        )
        model_sharpe = _finite_or_none(model_sharpe_raw)
        return {
            "ok": True,
            "model_ret_pct": m_ret * 100.0,
            "bench_ret_pct": b_ret * 100.0,
            "model_cagr_pct": model_cagr_pct,
            "bench_cagr_pct": bench_cagr_pct,
            "model_max_dd_pct": model_max_dd_pct,
            "bench_max_dd_pct": bench_max_dd_pct,
            "model_sharpe": model_sharpe,
            "date_start": d_labels[0],
            "date_end": d_labels[-1],
            "n_days": n_days_win,
            "dates": d_labels,
            "model_norm": m_norm,
            "bench_norm": b_norm,
            "model_dd": model_dd_list,
            "bench_dd": bench_dd_list,
        }

    empty = {"ok": False, "reason": "insufficient_data"}
    if n < 2:
        return {"ytd": empty.copy(), "y1": empty.copy(), "y10": empty.copy(), "y5": empty.copy()}

    out: dict[str, dict] = {}

    last_dt = pd.Timestamp(dt.iloc[last_i])
    y0 = pd.Timestamp(year=int(last_dt.year), month=1, day=1)
    tvals = dt.values.astype("datetime64[ns]")
    y0_64 = np.datetime64(y0.to_datetime64())
    start_ytd = int(np.searchsorted(tvals, y0_64, side="left"))
    if start_ytd >= last_i:
        start_ytd = max(0, last_i - 1)
    out["ytd"] = pack_window(start_ytd, last_i)

    for key, years in [("y1", 1), ("y10", 10), ("y5", 5)]:
        min_days = int(years * TRADING_DAYS_PER_YEAR)
        start_i = max(0, last_i - min_days + 1)
        if last_i - start_i + 1 < min_days:
            out[key] = {"ok": False, "reason": "short_history"}
            continue
        out[key] = pack_window(start_i, last_i)

    return out


def horizons_embed_story_dict(horizon_returns: dict) -> dict:
    """Frase de interpretação para o iframe do dashboard (aba Retornos vs mercado)."""
    keys = ("ytd", "y1", "y5", "y10")
    beats: list[bool] = []
    for k in keys:
        h = horizon_returns.get(k) if isinstance(horizon_returns, dict) else None
        if not isinstance(h, dict) or not h.get("ok"):
            continue
        try:
            beats.append(float(h["model_ret_pct"]) > float(h["bench_ret_pct"]))
        except (TypeError, ValueError, KeyError):
            continue
    if not beats:
        return {
            "line": (
                "Histórico ilustrativo: compare o modelo ao mercado de referência nos horizontes disponíveis."
            ),
            "all_beat": False,
        }
    all_beat = all(beats)
    any_beat = any(beats)
    if all_beat:
        line = (
            "Resumo simples: neste histórico ilustrativo, o modelo ficou acima do mercado de referência "
            "em todos os horizontes mostrados (retorno acumulado no período)."
        )
    elif not any_beat:
        line = (
            "Resumo simples: neste recorte, o mercado de referência ficou acima do modelo em todos os "
            "horizontes mostrados — veja o detalhe por período."
        )
    else:
        line = (
            "Resumo simples: o modelo ficou acima do mercado em parte dos horizontes; use os separadores "
            "para comparar cada período."
        )
    return {"line": line, "all_beat": all_beat}


def charts_embed_context_dict(
    model_equity: list[float],
    bench_equity: list[float],
    model_drawdowns: list[float],
    bench_drawdowns: list[float],
) -> dict | None:
    """Narrativa e números-chave para a aba «Gráficos» no iframe do dashboard."""
    if len(model_equity) < 2 or len(bench_equity) < 2:
        return None
    try:
        m0, m1 = float(model_equity[0]), float(model_equity[-1])
        b0, b1 = float(bench_equity[0]), float(bench_equity[-1])
        if m0 <= 0 or b0 <= 0:
            return None
        mx = m1 / m0
        bx = b1 / b0
    except (TypeError, ValueError, ZeroDivisionError):
        return None
    try:
        mdd_m = min(float(x) for x in model_drawdowns) if model_drawdowns else 0.0
        mdd_b = min(float(x) for x in bench_drawdowns) if bench_drawdowns else 0.0
    except (TypeError, ValueError):
        mdd_m, mdd_b = 0.0, 0.0
    beat_equity = mx > bx * 1.0005
    shallower_dd = mdd_m > mdd_b
    ratio_vs_bench = (mx / bx) if bx > 1e-9 else None
    seed = 100_000.0
    ill_m = seed * mx
    ill_b = seed * bx

    def _fmt_pt_space_int(x: float) -> str:
        i = int(round(float(x)))
        return f"{i:,}".replace(",", " ")

    return {
        "beat_equity": beat_equity,
        "shallower_dd": shallower_dd,
        "model_x": mx,
        "bench_x": bx,
        "ratio_vs_bench": ratio_vs_bench,
        "illus_100k_model_fmt": _fmt_pt_space_int(ill_m),
        "illus_100k_bench_fmt": _fmt_pt_space_int(ill_b),
    }


def compute_sharpe_ratio(
    daily_returns: pd.Series,
    *,
    risk_free_annual: float | None = None,
    periods_per_year: int = TRADING_DAYS_PER_YEAR,
) -> float:
    """
    Sharpe anualizado (definição usual): média dos retornos diários em excesso de rf,
    dividida pelo desvio-padrão amostral desses excessos, vezes √252.

    Isto difere de CAGR/vol_anual (razão que o motor V5 ainda usa no resumo do backtest).
    """
    rf_annual = RISK_FREE_ANNUAL if risk_free_annual is None else float(risk_free_annual)
    r = pd.Series(daily_returns, dtype=float).dropna()
    if len(r) < 2:
        return float("nan")
    # rf diário aproximado (linear); para rf baixo é equivalente à compounding diária.
    rf_daily = rf_annual / float(periods_per_year)
    excess = r - rf_daily
    mu = float(excess.mean())
    sigma = float(excess.std(ddof=1))
    if sigma <= 1e-12 or not np.isfinite(sigma):
        return float("nan")
    return float(mu / sigma * sqrt(float(periods_per_year)))


def compute_kpis(equity):
    start_val = float(equity.iloc[0])
    end_val = float(equity.iloc[-1])
    num_days = len(equity)

    returns = equity.pct_change().dropna()

    cagr = (end_val / start_val) ** (TRADING_DAYS_PER_YEAR / num_days) - 1.0
    vol_daily = returns.std()
    vol_annual = float(vol_daily * sqrt(TRADING_DAYS_PER_YEAR))
    sharpe = compute_sharpe_ratio(returns, risk_free_annual=RISK_FREE_ANNUAL)

    running_max = equity.cummax()
    drawdowns = equity / running_max - 1.0
    max_drawdown = float(drawdowns.min())

    total_return_mult = float(end_val / start_val)

    return (
        type(
            "KPIs",
            (),
            {
                "cagr": float(cagr),
                "volatility": vol_annual,
                "sharpe": sharpe,
                "max_drawdown": max_drawdown,
                "total_return": total_return_mult,
            },
        ),
        drawdowns,
    )


# Datas (YYYY-MM-DD) com artefacto pontual na série congelada (ex. salto a solo que cria pico falso de drawdown).
# Substituir por interpolação linear (média do dia anterior e seguinte) antes dos KPIs.
_EQUITY_KNOT_DATES: tuple[str, ...] = ("2021-05-13",)


def patch_equity_knot_dates_linear(
    dates,
    *series: pd.Series,
) -> None:
    """
    In-place: para cada data em _EQUITY_KNOT_DATES, substitui o valor na série pela
    (vizinho-anterior + vizinho-seguinte) / 2. Desactivar com DECIDE_KPI_SKIP_EQUITY_KNOT_PATCH=1.
    """
    if not _EQUITY_KNOT_DATES:
        return
    if (os.environ.get("DECIDE_KPI_SKIP_EQUITY_KNOT_PATCH", "").strip().lower() in {
        "1",
        "true",
        "yes",
    }):
        return
    n = len(dates)
    if n < 3:
        return
    date_strs: list[str] = []
    for d in dates:
        try:
            nrm = pd.Timestamp(d).normalize().strftime("%Y-%m-%d")
        except (TypeError, ValueError, OSError):
            try:
                nrm = pd.to_datetime(d, errors="coerce")
                nrm = (
                    nrm.normalize().strftime("%Y-%m-%d")
                    if nrm is not None and not pd.isna(nrm)
                    else ""
                )
            except (TypeError, ValueError):
                s = str(d)
                s = s.split(" ")[0] if " " in s else s
                s = s.split("T")[0] if "T" in s else s
                nrm = s[:10] if len(s) >= 10 else s
        date_strs.append(nrm)
    for bad in _EQUITY_KNOT_DATES:
        try:
            i = date_strs.index(bad)
        except ValueError:
            continue
        if i <= 0 or i >= n - 1:
            continue
        for s in series:
            if s is None or not isinstance(s, pd.Series):
                continue
            if len(s) != n:
                continue
            a = float(s.iloc[i - 1])
            b = float(s.iloc[i + 1])
            s.iloc[i] = 0.5 * (a + b)


def compute_monthly_stats(model_equity: pd.Series, bench_equity: pd.Series, dates: pd.Series) -> dict:
    """Compute monthly stats from daily equity series (index = range; dates given separately)."""
    model_equity = model_equity.copy()
    model_equity.index = pd.to_datetime(dates).values
    model_equity = model_equity.sort_index()

    bench_equity = bench_equity.copy()
    bench_equity.index = pd.to_datetime(dates).values
    bench_equity = bench_equity.sort_index()

    model_rets = model_equity.pct_change().dropna()
    bench_rets = bench_equity.pct_change().dropna()

    monthly_model = (1.0 + model_rets).resample("ME").prod() - 1.0
    monthly_bench = (1.0 + bench_rets).resample("ME").prod() - 1.0
    monthly_model = monthly_model.dropna()
    monthly_bench = monthly_bench.reindex(monthly_model.index).ffill().dropna()

    aligned = monthly_model.align(monthly_bench, join="inner")
    m_model = aligned[0].dropna()
    m_bench = aligned[1].reindex(m_model.index).ffill()

    best_month = float(m_model.max())
    worst_month = float(m_model.min())
    n = len(m_model)
    positive = int((m_model > 0).sum())
    negative = int((m_model <= 0).sum())
    above = int((m_model > m_bench).sum()) if len(m_bench) else 0
    below = int((m_model <= m_bench).sum()) if len(m_bench) else 0

    tg = m_model.nlargest(5).reset_index()
    tg.columns = ["month", "ret"]
    tg["month"] = tg["month"].dt.strftime("%Y-%m")
    tg["ret_pct"] = (tg["ret"] * 100).round(2)
    top_gains = tg.to_dict("records")

    tl = m_model.nsmallest(5).reset_index()
    tl.columns = ["month", "ret"]
    tl["month"] = tl["month"].dt.strftime("%Y-%m")
    tl["ret_pct"] = (tl["ret"] * 100).round(2)
    top_losses = tl.to_dict("records")

    return {
        "best_month_pct": best_month * 100,
        "worst_month_pct": worst_month * 100,
        "num_months": n,
        "positive_months": positive,
        "negative_months": negative,
        "months_above_benchmark": above,
        "months_below_benchmark": below,
        "top_gains": top_gains,
        "top_losses": top_losses,
    }


def compute_rolling_alpha(model_equity: pd.Series, bench_equity: pd.Series, dates: pd.Series, window_days: int = 252):
    """Compute rolling 1Y alpha (excesso de retorno anualizado do modelo vs benchmark)."""
    model_equity = model_equity.copy()
    bench_equity = bench_equity.copy()
    model_equity.index = pd.to_datetime(dates).values
    bench_equity.index = pd.to_datetime(dates).values

    # Log-returns diários
    m_log = np.log(1.0 + model_equity.pct_change().dropna().astype(float))
    b_log = np.log(1.0 + bench_equity.pct_change().dropna().astype(float))

    # Alinhar
    m_log, b_log = m_log.align(b_log, join="inner")

    # Soma de log-returns numa janela móvel
    m_roll = m_log.rolling(window_days).sum()
    b_roll = b_log.rolling(window_days).sum()

    # Retorno anualizado aproximado e alpha (modelo - benchmark)
    # alpha_annual ~= (m_roll - b_roll) * (TRADING_DAYS_PER_YEAR / window_days)
    alpha_annual = (m_roll - b_roll) * (TRADING_DAYS_PER_YEAR / window_days)

    alpha_annual = alpha_annual.dropna()
    alpha_dates = alpha_annual.index.strftime("%Y-%m-%d").tolist()
    alpha_vals = alpha_annual.tolist()

    return alpha_dates, alpha_vals


def yearly_calendar_returns_fraction(equity: pd.Series, dates: pd.Series) -> dict[int, float]:
    """Retorno total dentro de cada ano civil (primeiro ao último dia útil do ano na série)."""
    s = pd.Series(np.asarray(equity, dtype=float), index=pd.to_datetime(dates))
    s = s.sort_index()
    out: dict[int, float] = {}
    for year in sorted(s.index.year.unique()):
        grp = s[s.index.year == year]
        if len(grp) < 2:
            continue
        v0 = float(grp.iloc[0])
        v1 = float(grp.iloc[-1])
        if v0 > 1e-12:
            out[int(year)] = (v1 / v0) - 1.0
    return out


def build_yearly_bar_chart_payload(
    cap15_eq: pd.Series,
    max100_eq: pd.Series,
    bench_eq: pd.Series,
    dates: pd.Series,
) -> dict:
    """Anos alinhados + retornos em % para gráfico de barras (null se falta ano numa série)."""
    y_c = yearly_calendar_returns_fraction(cap15_eq, dates)
    y_m = yearly_calendar_returns_fraction(max100_eq, dates)
    y_b = yearly_calendar_returns_fraction(bench_eq, dates)
    years_sorted = sorted(set(y_c.keys()) | set(y_m.keys()) | set(y_b.keys()))
    return {
        "years": [str(y) for y in years_sorted],
        "cap15_pct": [round(y_c[y] * 100, 2) if y in y_c else None for y in years_sorted],
        "max100_pct": [round(y_m[y] * 100, 2) if y in y_m else None for y in years_sorted],
        "bench_pct": [round(y_b[y] * 100, 2) if y in y_b else None for y in years_sorted],
    }


def _diag_equity_returns(model_eq: pd.Series, bench_eq: pd.Series, dates: pd.Series) -> tuple[pd.Series, pd.Series, pd.Series, pd.Series]:
    """Séries de equity e retornos diários alinhados (mesmo índice temporal)."""
    idx = pd.to_datetime(dates)
    m = pd.Series(np.asarray(model_eq, dtype=float), index=idx).sort_index()
    b = pd.Series(np.asarray(bench_eq, dtype=float), index=idx).sort_index()
    r_m = m.pct_change().dropna()
    r_b = b.pct_change().dropna()
    r_m, r_b = r_m.align(r_b, join="inner")
    m = m.reindex(r_m.index)
    b = b.reindex(r_b.index)
    return m, b, r_m, r_b


def _diag_cagr_roll_raw(w: np.ndarray) -> float:
    w = np.asarray(w, dtype=float)
    if w.size < 2 or w[0] <= 1e-15:
        return float("nan")
    return float((w[-1] / w[0]) ** (TRADING_DAYS_PER_YEAR / (w.size - 1)) - 1.0)


def _diag_mdd_roll_raw(w: np.ndarray) -> float:
    w = np.asarray(w, dtype=float)
    if w.size < 2:
        return float("nan")
    peak = np.maximum.accumulate(w)
    dd = w / peak - 1.0
    return float(np.min(dd))


def _diag_sharpe_roll_raw(w: np.ndarray, rf_annual: float) -> float:
    w = np.asarray(w, dtype=float)
    if w.size < 8:
        return float("nan")
    rf_d = rf_annual / TRADING_DAYS_PER_YEAR
    ex = w - rf_d
    sig = float(np.std(ex, ddof=1))
    if sig <= 1e-12:
        return float("nan")
    return float(np.mean(ex) / sig * sqrt(TRADING_DAYS_PER_YEAR))


def _diag_recovery_episode_lengths(eq: np.ndarray) -> list[int]:
    """Dias desde cada novo máximo até voltar a esse máximo (só episódios completos)."""
    if eq.size < 3:
        return []
    lengths: list[int] = []
    peak = float(eq[0])
    peak_i = 0
    i = 1
    n = len(eq)
    while i < n:
        if eq[i] >= peak:
            peak = float(eq[i])
            peak_i = i
            i += 1
            continue
        j = i
        while j < n and eq[j] < peak:
            j += 1
        if j < n:
            lengths.append(int(j - peak_i))
            peak = float(eq[j])
            peak_i = j
            i = j + 1
        else:
            break
    return lengths


def _diag_metrics_on_returns(r_m: pd.Series, r_b: pd.Series) -> dict:
    """CAGR a partir de equity sintética, Sharpe, max DD — mesmo horizonte."""
    if r_m.empty or len(r_m) < 5:
        return {
            "cagr": float("nan"),
            "sharpe_m": float("nan"),
            "sharpe_b": float("nan"),
            "max_dd_m": float("nan"),
            "max_dd_b": float("nan"),
        }
    em = float(np.prod(1.0 + r_m.values) - 1.0)
    eb = float(np.prod(1.0 + r_b.values) - 1.0)
    nd = len(r_m)
    years = nd / TRADING_DAYS_PER_YEAR
    cagr_m = (1.0 + em) ** (1.0 / years) - 1.0 if years > 1e-9 else float("nan")
    eq_m = np.cumprod(np.concatenate([[1.0], 1.0 + r_m.values]))
    eq_b = np.cumprod(np.concatenate([[1.0], 1.0 + r_b.values]))
    pk_m = np.maximum.accumulate(eq_m)
    pk_b = np.maximum.accumulate(eq_b)
    mdd_m = float(np.min(eq_m / pk_m - 1.0))
    mdd_b = float(np.min(eq_b / pk_b - 1.0))
    return {
        "cagr": float(cagr_m),
        "cagr_bench": float((1.0 + eb) ** (1.0 / years) - 1.0) if years > 1e-9 else float("nan"),
        "sharpe_m": compute_sharpe_ratio(r_m, risk_free_annual=RISK_FREE_ANNUAL),
        "sharpe_b": compute_sharpe_ratio(r_b, risk_free_annual=RISK_FREE_ANNUAL),
        "max_dd_m": mdd_m,
        "max_dd_b": mdd_b,
    }


def _diag_nanmean_finite_slice(a: np.ndarray, s: slice) -> float:
    seg = a[s]
    seg = seg[np.isfinite(seg)]
    if seg.size == 0:
        return float("nan")
    return float(np.mean(seg))


def _diag_early_late_means_valid_rolling(a: np.ndarray) -> tuple[float | None, float | None]:
    """
    Séries rolling têm NaN até a janela encher (ex. 5y → ~1259 dias).
    Early/late usam só índices finitos; evita np.nanmean em fatias só com NaN.
    """
    fin = np.flatnonzero(np.isfinite(a))
    if fin.size < 400:
        return None, None
    first_i = int(fin[0])
    last_i = int(fin[-1])
    span = last_i - first_i + 1
    early_lo = first_i + max(21, span // 20)
    early_hi = first_i + max(early_lo + 42, first_i + span // 3)
    early_hi = min(early_hi, last_i + 1)
    early = _diag_nanmean_finite_slice(a, slice(early_lo, early_hi))
    late = _diag_nanmean_finite_slice(a, slice(max(first_i, last_i - 377), last_i + 1))
    if not np.isfinite(early) or not np.isfinite(late):
        return None, None
    return early, late


def _diag_last_finite_from_list(xs: list | None) -> float | None:
    if not xs:
        return None
    for x in reversed(xs):
        if x is None:
            continue
        try:
            xf = float(x)
        except (TypeError, ValueError):
            continue
        if np.isfinite(xf):
            return xf
    return None


def _diag_persistence_vs_threshold(
    dates: list[str],
    y: np.ndarray,
    *,
    threshold: float,
    below: bool,
    tail_finite: int = 252,
) -> dict:
    """Persistência da condição (y abaixo/acima do limiar) no sufixo da série alinhada a `dates`."""
    n = len(y)
    dlist = dates if len(dates) == n else [dates[min(i, len(dates) - 1)] for i in range(n)]
    finite = np.isfinite(y)
    flag = ((y < threshold) if below else (y > threshold)) & finite

    current = 0
    start_date = None
    suffix_vals: list[float] = []
    for i in range(n - 1, -1, -1):
        if not finite[i]:
            continue
        if flag[i]:
            current += 1
            start_date = dlist[i]
            suffix_vals.append(float(y[i]))
        else:
            break
    suffix_vals.reverse()
    suffix_run_mean: float | None = None
    if suffix_vals:
        suffix_run_mean = float(np.mean(suffix_vals))

    max_st = 0
    cur = 0
    for i in range(n):
        if not finite[i]:
            cur = 0
            continue
        if flag[i]:
            cur += 1
            max_st = max(max_st, cur)
        else:
            cur = 0

    fin_ix = np.where(finite)[0]
    if fin_ix.size == 0:
        pct = None
    else:
        use_ix = fin_ix[-tail_finite:] if fin_ix.size >= tail_finite else fin_ix
        pct = float(np.mean(flag[use_ix])) * 100.0

    return {
        "threshold": threshold,
        "below_threshold": bool(below),
        "suffix_streak_trading_days": int(current),
        "suffix_run_start_date": start_date,
        "suffix_run_mean": suffix_run_mean,
        "max_streak_trading_days": int(max_st),
        "pct_last_252_finite_obs": round(pct, 1) if pct is not None else None,
    }


def _diag_spread_rolling_zscore(y: np.ndarray, *, min_finite: int = 200) -> dict:
    """
    z = (último valor finito − média histórica) / DP da série rolling (só observações finitas).
    Bandas no z (abaixo da média = compressão): 0 a −0.5 normal; −0.5 a −1 leve; −1 a −2 relevante; < −2 alerta sério.
    """
    if y.size == 0:
        return {}
    fin = y[np.isfinite(y)]
    if fin.size < min_finite:
        return {}
    mu = float(np.mean(fin))
    sigma = float(np.std(fin, ddof=1)) if fin.size > 1 else 0.0
    if sigma < 1e-9:
        sigma = float(np.std(fin, ddof=0))
    if sigma < 1e-9:
        return {
            "hist_mean_spread_pp": round(mu * 100.0, 3),
            "hist_std_spread_pp": 0.0,
            "last_spread_pp": None,
            "z_score": None,
            "z_band": "indisponível (variância nula)",
        }
    last = _diag_last_finite_from_list([float(x) if np.isfinite(x) else None for x in y])
    if last is None:
        return {}
    z = (last - mu) / sigma
    if not np.isfinite(z):
        return {}
    if z > 4.0:
        z = 4.0
    elif z < -4.0:
        z = -4.0
    band = "normal"
    if z < -2.0:
        band = "alerta sério"
    elif z < -1.0:
        band = "compressão relevante"
    elif z < -0.5:
        band = "compressão leve"
    return {
        "hist_mean_spread_pp": round(mu * 100.0, 3),
        "hist_std_spread_pp": round(sigma * 100.0, 3),
        "last_spread_pp": round(last * 100.0, 3),
        "z_score": round(float(z), 3),
        "z_band": band,
    }


def _diag_recovery_percentile_stress(rec_series: np.ndarray, *, min_finite: int = 80) -> dict:
    """
    Percentil empírico 0–100 da última observação finita: % da amostra histórica com recuperação ≤ actual
    (valores altos = recuperações mais lentas que o habitual → stress).
    <50 normal · 50–75 vigilância · 75–90 stress · ≥90 alerta.
    """
    h_all = rec_series[np.isfinite(rec_series)]
    if h_all.size < min_finite:
        return {}
    last = _diag_last_finite_from_list(
        [float(x) if np.isfinite(x) else None for x in rec_series]
    )
    if last is None or not np.isfinite(last):
        return {}
    pct = float(np.mean(h_all <= last) * 100.0)
    if pct < 50.0:
        band = "normal"
    elif pct < 75.0:
        band = "vigilância"
    elif pct < 90.0:
        band = "stress"
    else:
        band = "alerta"
    return {
        "last_recovery_mean_days": round(last, 1),
        "hist_median_days": round(float(np.median(h_all)), 1),
        "empirical_percentile": round(pct, 1),
        "stress_band": band,
    }


def _diag_persistence_intensity_label(mean_pp: float | None) -> str | None:
    """mean_pp = spread médio no sufixo < limiar, em pontos percentuais."""
    if mean_pp is None or not np.isfinite(mean_pp):
        return None
    if mean_pp >= -2.0:
        return "leve"
    if mean_pp >= -6.0:
        return "moderada"
    return "forte"


def compute_model_degradation_diagnostics(
    model_eq: pd.Series,
    bench_eq: pd.Series,
    dates: pd.Series,
    *,
    rebalance_info: dict | None = None,
) -> dict:
    """
    Pacote de testes «rolling», regimes, hit-rate e contributos para avaliar degradação vs regime.
    Séries = modelo e benchmark já alinhados ao mesmo calendário (dias úteis).
    """
    m, b, r_m, r_b = _diag_equity_returns(model_eq, bench_eq, dates)
    if len(r_m) < TRADING_DAYS_PER_YEAR * 3:
        return {
            "ok": False,
            "error": "Série demasiado curta (mín. ~3 anos de dias úteis).",
            "summary_text": "Sem dados suficientes para rolling 5y/10y.",
        }

    idx = r_m.index
    m_lv = m.reindex(idx)
    b_lv = b.reindex(idx)

    W3 = 3 * TRADING_DAYS_PER_YEAR
    W5 = 5 * TRADING_DAYS_PER_YEAR
    W10 = 10 * TRADING_DAYS_PER_YEAR

    def roll_cagr(eq: pd.Series, w: int) -> pd.Series:
        return eq.rolling(window=w, min_periods=w).apply(_diag_cagr_roll_raw, raw=True)

    def roll_mdd(eq: pd.Series, w: int) -> pd.Series:
        return eq.rolling(window=w, min_periods=w).apply(_diag_mdd_roll_raw, raw=True)

    def roll_sharpe(r: pd.Series, w: int) -> pd.Series:
        return r.rolling(window=w, min_periods=w).apply(
            lambda x: _diag_sharpe_roll_raw(x, RISK_FREE_ANNUAL), raw=True
        )

    out: dict = {"ok": True, "dates": [d.strftime("%Y-%m-%d") for d in idx]}

    # --- 1) Rolling CAGR modelo / bench / spread (p.p. anual implícito na diferença de CAGR) ---
    for label, w in (("3y", W3), ("5y", W5), ("10y", W10)):
        if len(m_lv) < w:
            out[f"roll_cagr_model_{label}"] = []
            out[f"roll_cagr_bench_{label}"] = []
            out[f"roll_spread_cagr_{label}"] = []
            continue
        c_m = roll_cagr(m_lv, w)
        c_b = roll_cagr(b_lv, w)
        sp = c_m - c_b
        out[f"roll_cagr_model_{label}"] = [float(x) if np.isfinite(x) else None for x in c_m.values]
        out[f"roll_cagr_bench_{label}"] = [float(x) if np.isfinite(x) else None for x in c_b.values]
        out[f"roll_spread_cagr_{label}"] = [float(x) if np.isfinite(x) else None for x in sp.values]

    # --- 2) Rolling Sharpe ---
    for label, w in (("3y", W3), ("5y", W5)):
        if len(r_m) < w:
            out[f"roll_sharpe_model_{label}"] = []
            out[f"roll_sharpe_bench_{label}"] = []
            continue
        out[f"roll_sharpe_model_{label}"] = [
            float(x) if np.isfinite(x) else None for x in roll_sharpe(r_m, w).values
        ]
        out[f"roll_sharpe_bench_{label}"] = [
            float(x) if np.isfinite(x) else None for x in roll_sharpe(r_b, w).values
        ]

    r_xs = r_m - r_b
    if len(r_xs) >= W5:
        out["roll_sharpe_excess_5y"] = [
            float(x) if np.isfinite(x) else None for x in roll_sharpe(r_xs, W5).values
        ]
    else:
        out["roll_sharpe_excess_5y"] = []

    # Rolling «CAGR» do excesso (log-consistente com compute_rolling_alpha)
    m_log = np.log1p(r_m.astype(float))
    b_log = np.log1p(r_b.astype(float))
    xs_log = m_log - b_log
    out["roll_excess_log_cagr_5y"] = [
        float(x) if np.isfinite(x) else None
        for x in (
            xs_log.rolling(W5, min_periods=W5).sum() * (TRADING_DAYS_PER_YEAR / W5)
        ).values
    ]

    # --- 3) Rolling max DD 3y / 5y ---
    for label, w in (("3y", W3), ("5y", W5)):
        if len(m_lv) < w:
            out[f"roll_mdd_model_{label}"] = []
            out[f"roll_mdd_bench_{label}"] = []
            continue
        out[f"roll_mdd_model_{label}"] = [
            float(x) if np.isfinite(x) else None for x in roll_mdd(m_lv, w).values
        ]
        out[f"roll_mdd_bench_{label}"] = [
            float(x) if np.isfinite(x) else None for x in roll_mdd(b_lv, w).values
        ]

    # --- 3b) Tempo de recuperação: média / máx de episódios completos dentro de janelas 5y ---
    mv = m_lv.values.astype(float)
    rec_roll_mean: list[float | None] = []
    rec_roll_max: list[float | None] = []
    uw_roll_max: list[float | None] = []
    for i in range(len(mv)):
        if i + 1 < W5:
            rec_roll_mean.append(None)
            rec_roll_max.append(None)
            uw_roll_max.append(None)
            continue
        seg = mv[i + 1 - W5 : i + 1]
        lens = _diag_recovery_episode_lengths(seg)
        rec_roll_mean.append(float(np.mean(lens)) if lens else None)
        rec_roll_max.append(float(np.max(lens)) if lens else None)
        peak = np.maximum.accumulate(seg)
        dd = seg / peak - 1.0
        underwater = dd < -1e-6
        streak = 0
        best = 0
        for u in underwater:
            if u:
                streak += 1
                best = max(best, streak)
            else:
                streak = 0
        uw_roll_max.append(float(best))
    out["roll_recovery_mean_days_5y"] = rec_roll_mean
    out["roll_recovery_max_days_5y"] = rec_roll_max
    out["roll_max_underwater_streak_5y"] = uw_roll_max

    # --- 5) Blocos fixos ---
    bounds = [
        ("2006-01-01", "2010-12-31"),
        ("2010-01-01", "2015-12-31"),
        ("2015-01-01", "2020-12-31"),
        ("2020-01-01", "2099-12-31"),
    ]
    subperiods = []
    for lo_s, hi_s in bounds:
        lo = pd.Timestamp(lo_s)
        hi = pd.Timestamp(hi_s)
        mask = (idx >= lo) & (idx <= hi)
        rms = r_m.loc[mask]
        rbs = r_b.loc[mask]
        if len(rms) < 40:
            subperiods.append(
                {
                    "label": f"{lo_s[:4]}–{hi_s[:4]}",
                    "n_days": len(rms),
                    "cagr_m": None,
                    "cagr_b": None,
                    "spread_cagr": None,
                    "sharpe_m": None,
                    "sharpe_b": None,
                    "max_dd_m": None,
                    "max_dd_b": None,
                    "recovery_mean_days": None,
                    "recovery_max_days": None,
                    "hit_rate_monthly": None,
                }
            )
            continue
        met = _diag_metrics_on_returns(rms, rbs)
        eq_seg = m_lv.loc[mask].values.astype(float)
        lens_full = _diag_recovery_episode_lengths(eq_seg)
        monthly_m = (1.0 + rms).resample("ME").prod() - 1.0
        monthly_b = (1.0 + rbs).resample("ME").prod() - 1.0
        mm, mb = monthly_m.align(monthly_b, join="inner")
        hit = float((mm > mb).mean()) if len(mm) else None
        subperiods.append(
            {
                "label": f"{lo.year}–{min(hi.year, idx[-1].year)}",
                "n_days": len(rms),
                "cagr_m": met["cagr"],
                "cagr_b": met["cagr_bench"],
                "spread_cagr": met["cagr"] - met["cagr_bench"]
                if np.isfinite(met["cagr"]) and np.isfinite(met["cagr_bench"])
                else None,
                "sharpe_m": met["sharpe_m"],
                "sharpe_b": met["sharpe_b"],
                "max_dd_m": met["max_dd_m"],
                "max_dd_b": met["max_dd_b"],
                "recovery_mean_days": float(np.mean(lens_full)) if lens_full else None,
                "recovery_max_days": float(np.max(lens_full)) if lens_full else None,
                "hit_rate_monthly": hit,
            }
        )
    out["subperiods"] = subperiods

    reb = rebalance_info or {}
    out["turnover_global_note"] = (
        f"Turnover médio anual (backtest): {(float(reb['avg_annual_turnover'])*100):.2f}%"
        if reb.get("avg_annual_turnover") is not None
        else "Turnover médio anual: não disponível neste snapshot."
    )
    out["ranking_stability_note"] = (
        "Estabilidade do ranking entre rebalances: requer histórico de pesos ticker-a-ticker (não exposto neste servidor)."
    )

    # --- 6) Hit rate rolling (mensal) ---
    monthly_model = (1.0 + r_m).resample("ME").prod() - 1.0
    monthly_bench = (1.0 + r_b).resample("ME").prod() - 1.0
    mm2, mb2 = monthly_model.align(monthly_bench, join="inner")
    win_m = (mm2 > mb2).astype(float)
    hit12 = win_m.rolling(12, min_periods=12).mean() * 100.0
    hit24 = win_m.rolling(24, min_periods=24).mean() * 100.0
    month_end_dates = [d.strftime("%Y-%m-%d") for d in hit12.index]
    out["hit_rate_dates"] = month_end_dates
    out["hit_rate_roll_12m"] = [float(x) if np.isfinite(x) else None for x in hit12.values]
    out["hit_rate_roll_24m"] = [float(x) if np.isfinite(x) else None for x in hit24.values]

    # --- 7) Contribution: top meses e dias por década ---
    top_months = mm2.sort_values(ascending=False).head(10)
    out["top_10_months_model"] = [
        {"month": ix.strftime("%Y-%m"), "ret_pct": round(float(v) * 100, 3)} for ix, v in top_months.items()
    ]
    daily_sorted = r_m.sort_values(ascending=False).head(20)
    out["top_20_days_model"] = [
        {"date": ix.strftime("%Y-%m-%d"), "ret_pct": round(float(v) * 100, 4)} for ix, v in daily_sorted.items()
    ]
    decades: dict[str, list[dict]] = {}
    for dec_start in (2000, 2010, 2020):
        d0 = pd.Timestamp(f"{dec_start}-01-01")
        d1 = pd.Timestamp(f"{dec_start + 9}-12-31")
        sub = r_m.loc[(r_m.index >= d0) & (r_m.index <= d1)].sort_values(ascending=False).head(10)
        decades[str(dec_start)] = [
            {"date": ix.strftime("%Y-%m-%d"), "ret_pct": round(float(v) * 100, 4)} for ix, v in sub.items()
        ]
    out["top_days_by_decade"] = decades

    # --- 8) Regimes (benchmark) ---
    ret63 = b_lv.pct_change(63).reindex(idx).dropna()
    vol21 = r_b.rolling(21, min_periods=21).std().reindex(idx).dropna()
    common = ret63.index.intersection(vol21.index)
    if len(common) > 30:
        med_vol = float(vol21.loc[common].median())
        regime_rows = []
        for tag, mask in (
            ("Bench 63d>0 (alta)", ret63.loc[common] > 0),
            ("Bench 63d≤0 (baixa)", ret63.loc[common] <= 0),
            ("Alta vol (21d)", vol21.loc[common] > med_vol),
            ("Baixa vol (21d)", vol21.loc[common] <= med_vol),
        ):
            ixr = mask[mask].index
            rmm = r_m.reindex(ixr).dropna()
            rbb = r_b.reindex(rmm.index).dropna()
            rmm = rmm.reindex(rbb.index).dropna()
            if len(rmm) < 40:
                regime_rows.append({"regime": tag, "n_days": len(rmm), "note": "poucos dias"})
                continue
            met_r = _diag_metrics_on_returns(rmm, rbb)
            regime_rows.append(
                {
                    "regime": tag,
                    "n_days": len(rmm),
                    "cagr_m": met_r["cagr"],
                    "cagr_b": met_r["cagr_bench"],
                    "spread_cagr": met_r["cagr"] - met_r["cagr_bench"],
                    "sharpe_m": met_r["sharpe_m"],
                    "sharpe_b": met_r["sharpe_b"],
                    "max_dd_m": met_r["max_dd_m"],
                    "max_dd_b": met_r["max_dd_b"],
                }
            )
        out["regimes"] = regime_rows
    else:
        out["regimes"] = []

    # --- 9) Rolling turnover / custos: sem série diária; proxy constante ---
    out["rolling_turnover_note"] = (
        "Sem série diária de turnover no KPI server: use o turnover médio anual do backtest na tabela de subperíodos "
        "como referência estática. Custos já embutidos na curva CAP15 quando aplicável."
    )

    # --- Conclusão automática (heurística) + persistência rolling ---
    date_list = list(out.get("dates") or [])
    sp5 = np.array(out.get("roll_spread_cagr_5y") or [], dtype=float)
    sh5 = np.array(out.get("roll_sharpe_model_5y") or [], dtype=float)
    shb5 = np.array(out.get("roll_sharpe_bench_5y") or [], dtype=float)
    rel = (sh5 - shb5) if sh5.size == shb5.size and sh5.size > 0 else np.array([], dtype=float)

    rec_series = np.array(
        [
            float(x) if x is not None and np.isfinite(float(x)) else np.nan
            for x in (out.get("roll_recovery_mean_days_5y") or [])
        ],
        dtype=float,
    )

    ls3 = _diag_last_finite_from_list(out.get("roll_spread_cagr_3y"))
    ls5f = _diag_last_finite_from_list(out.get("roll_spread_cagr_5y"))
    ls10 = _diag_last_finite_from_list(out.get("roll_spread_cagr_10y"))
    out["last_roll_spread_pp"] = {
        "3y": round(ls3 * 100, 2) if ls3 is not None else None,
        "5y": round(ls5f * 100, 2) if ls5f is not None else None,
        "10y": round(ls10 * 100, 2) if ls10 is not None else None,
    }

    early_sp, late_sp = (None, None)
    if sp5.size > 400:
        early_sp, late_sp = _diag_early_late_means_valid_rolling(sp5)
    if len(date_list) == len(sp5) and sp5.size > 400:
        out["spread_5y_persistence"] = _diag_persistence_vs_threshold(
            date_list, sp5, threshold=0.0, below=True, tail_finite=252
        )
    else:
        out["spread_5y_persistence"] = {}

    sp_per = out.get("spread_5y_persistence") or {}
    if sp_per:
        sm = sp_per.get("suffix_run_mean")
        if sm is not None and np.isfinite(float(sm)):
            sm_pp = float(sm) * 100.0
            sp_per["suffix_run_mean_pp"] = round(sm_pp, 2)
            int_lab = _diag_persistence_intensity_label(sm_pp)
            sp_per["suffix_intensity"] = int_lab
            streak_d = int(sp_per.get("suffix_streak_trading_days") or 0)
            sp_per["persistence_intensity_combo_index"] = round(
                (streak_d / 252.0) * abs(min(0.0, sm_pp)), 3
            )
            if streak_d == 0:
                sp_per["persistence_intensity_note"] = (
                    "Sem sufixo spread<0 no último ponto — intensidade do combo não aplicável."
                )
            elif streak_d < 63 and int_lab == "leve":
                sp_per["persistence_intensity_note"] = (
                    "Persistência curta e nível leve — ruído de regime mais provável que «alerta duro»."
                )
            elif streak_d >= 126 and int_lab == "forte":
                sp_per["persistence_intensity_note"] = (
                    "Sufixo longo com spread médio fortemente negativo — combina tempo × profundidade (prioridade alta)."
                )
            elif streak_d >= 63 and int_lab == "moderada":
                sp_per["persistence_intensity_note"] = (
                    "Negativo persistente com magnitude moderada — monitorizar com z-score e recuperação."
                )
            else:
                sp_per["persistence_intensity_note"] = (
                    "Combinar dias abaixo de zero com profundidade média do sufixo para evitar falso alarme só por tempo."
                )

    if sp5.size > 400:
        out["spread_5y_zscore"] = _diag_spread_rolling_zscore(sp5)
    else:
        out["spread_5y_zscore"] = {}

    if rec_series.size == sp5.size and np.sum(np.isfinite(rec_series)) > 80:
        out["recovery_5y_roll_stress"] = _diag_recovery_percentile_stress(rec_series)
    else:
        out["recovery_5y_roll_stress"] = {}

    if len(date_list) == len(rel) and rel.size > 400:
        out["sharpe_rel_5y_persistence"] = _diag_persistence_vs_threshold(
            date_list, rel, threshold=0.0, below=True, tail_finite=252
        )
    else:
        out["sharpe_rel_5y_persistence"] = {}

    if early_sp is not None and late_sp is not None:
        out["spread_5y_early_late_pp"] = {
            "early_mean_pp": round(early_sp * 100, 2),
            "late_mean_pp": round(late_sp * 100, 2),
        }
    else:
        out["spread_5y_early_late_pp"] = None

    summary_parts: list[str] = []
    if early_sp is not None and late_sp is not None:
        summary_parts.append(
            f"Spread CAGR rolling 5y — média early vs late (só após janela 5y cheia): "
            f"{early_sp * 100:.2f} p.p. → {late_sp * 100:.2f} p.p."
        )

    zs = out.get("spread_5y_zscore") or {}
    if zs.get("z_score") is not None:
        summary_parts.append(
            f"Spread 5y vs histórico: z={float(zs['z_score']):.2f} ({zs.get('z_band')}); "
            f"média hist. {zs.get('hist_mean_spread_pp')} p.p., DP {zs.get('hist_std_spread_pp')} p.p., "
            f"último {zs.get('last_spread_pp')} p.p."
        )

    rec_st = out.get("recovery_5y_roll_stress") or {}
    if rec_st.get("empirical_percentile") is not None:
        summary_parts.append(
            f"Recuperação média (rolling 5y): actual {rec_st.get('last_recovery_mean_days')} d "
            f"vs mediana histórica {rec_st.get('hist_median_days')} d — "
            f"percentil empírico {rec_st.get('empirical_percentile')}% ({rec_st.get('stress_band')})."
        )

    sp_per = out.get("spread_5y_persistence") or {}
    sr_per = out.get("sharpe_rel_5y_persistence") or {}
    if sp_per.get("persistence_intensity_note"):
        summary_parts.append(str(sp_per["persistence_intensity_note"]))
    if sp_per:
        summary_parts.append(
            f"Spread 5y < 0: streak actual {sp_per.get('suffix_streak_trading_days', 0)} d úteis "
            f"(desde {sp_per.get('suffix_run_start_date') or '—'}); "
            f"{sp_per.get('pct_last_252_finite_obs', 0):.1f}% dos últimos ~252 valores finitos < 0 "
            f"(streak máx. hist.: {sp_per.get('max_streak_trading_days', 0)} d)."
        )
        if sp_per.get("suffix_run_mean_pp") is not None and int(sp_per.get("suffix_streak_trading_days") or 0) > 0:
            summary_parts.append(
                f"Média do spread no sufixo actual <0: {sp_per.get('suffix_run_mean_pp')} p.p. "
                f"(intensidade {sp_per.get('suffix_intensity') or '—'}; "
                f"índice combo ≈ {sp_per.get('persistence_intensity_combo_index', '—')})."
            )
    if sr_per:
        summary_parts.append(
            f"Sharpe rel. 5y < 0: streak actual {sr_per.get('suffix_streak_trading_days', 0)} d úteis "
            f"(desde {sr_per.get('suffix_run_start_date') or '—'}); "
            f"{sr_per.get('pct_last_252_finite_obs', 0):.1f}% dos últimos ~252 valores finitos < 0 "
            f"(streak máx.: {sr_per.get('max_streak_trading_days', 0)} d)."
        )

    lrel = float("nan")
    if rel.size > 400:
        lrel = float(np.nanmean(rel[-252:]))
        if np.isfinite(lrel):
            summary_parts.append(f"Sharpe rolling 5y (modelo − bench, média últimos ~1y): {lrel:.3f}.")

    if rec_series.size == sp5.size and np.sum(np.isfinite(rec_series)) > 200:
        r_early, r_late = _diag_early_late_means_valid_rolling(rec_series)
        if r_early is not None and r_late is not None:
            summary_parts.append(
                f"Tempo médio de recuperação (janela 5y): ~{r_early:.0f} d (early) vs ~{r_late:.0f} d (late)."
            )
            if r_late > r_early * 1.35:
                summary_parts.append(
                    "Recuperações mais lentas no fim da amostra (early vs late) — reforça leitura comportamental de stress."
                )

    # --- Atribuição simples (seleção / timing / custos) ---
    attribution: list[str] = []
    hit12 = np.array(out.get("hit_rate_roll_12m") or [], dtype=float)
    hfin = hit12[np.isfinite(hit12)]
    if hfin.size > 48:
        t1 = float(np.mean(hfin[: max(12, len(hfin) // 3)]))
        t3 = float(np.mean(hfin[-max(12, len(hfin) // 3) :]))
        out["hit_rate_12m_tertiles_mean_pp"] = {"early_third": round(t1, 1), "late_third": round(t3, 1)}
        if t3 < t1 - 8.0:
            attribution.append(
                f"Hit-rate 12m em queda (média terço inicial {t1:.0f}% → terço final {t3:.0f}%): "
                "compatível com menos meses de beating — mais «timing» de períodos do que custo novo isolado."
            )
    else:
        out["hit_rate_12m_tertiles_mean_pp"] = None

    for row in out.get("regimes") or []:
        rg = str(row.get("regime") or "")
        if rg.startswith("Bench 63d>0"):
            sm = row.get("sharpe_m")
            sb = row.get("sharpe_b")
            if (
                sm is not None
                and sb is not None
                and isinstance(sm, (int, float))
                and isinstance(sb, (int, float))
                and float(sm) < float(sb) - 0.08
            ):
                attribution.append(
                    "Com benchmark em alta (63d), o Sharpe do modelo fica claramente abaixo do do benchmark: "
                    "típico de exposição/«seleção» que captura retorno mas perde eficiência nesse regime."
                )
            break

    reb = rebalance_info or {}
    if reb.get("avg_annual_turnover") is not None:
        attribution.append(
            "Turnover médio do backtest é único valor agregado aqui — sem pico recente mensurável nesta vista; "
            "atribuir o recente sobretudo a «custos novos» seria frágil sem série diária de fricção."
        )

    out["attribution_hints"] = attribution

    # --- Quatro estados: síntese quantitativa (z-score, persistência×intensidade, recuperação, 10y) ---
    z_num = zs.get("z_score")
    if not isinstance(z_num, (int, float)) or not np.isfinite(z_num):
        z_num = None
    else:
        z_num = float(z_num)
    rec_pct_num = rec_st.get("empirical_percentile")
    if rec_pct_num is None or not np.isfinite(float(rec_pct_num)):
        rec_pct_num = None
    else:
        rec_pct_num = float(rec_pct_num)
    streak_d = int(sp_per.get("suffix_streak_trading_days") or 0)
    suffix_mean_pp = sp_per.get("suffix_run_mean_pp")
    intensity = sp_per.get("suffix_intensity")
    smpp_f = float(suffix_mean_pp) if suffix_mean_pp is not None and np.isfinite(float(suffix_mean_pp)) else None

    long_horizon_ok = ls10 is not None and ls10 >= 0.055
    long_horizon_defensive = ls10 is not None and ls10 >= 0.04

    broken = False
    if ls10 is not None and ls10 < 0.012:
        broken = True
    if z_num is not None and z_num < -2.85:
        broken = True
    if late_sp is not None and late_sp < -0.095 and (ls10 is None or ls10 < 0.028):
        broken = True
    if (
        ls10 is not None
        and ls10 < 0.022
        and z_num is not None
        and z_num < -2.1
        and rec_pct_num is not None
        and rec_pct_num >= 90.0
    ):
        broken = True
    if (
        rec_pct_num is not None
        and rec_pct_num >= 93.0
        and z_num is not None
        and z_num < -2.35
        and (ls10 is None or ls10 < 0.038)
    ):
        broken = True
    # Com spread 10y ainda defensável, reservar «quebrada» a caudas muito extremas
    if broken and long_horizon_defensive:
        extreme_tail = (ls10 is not None and ls10 < 0.025) or (
            z_num is not None
            and z_num < -2.75
            and rec_pct_num is not None
            and rec_pct_num >= 93.0
        )
        if not extreme_tail:
            broken = False

    structural = False
    if not broken:
        if z_num is not None and z_num < -1.0:
            structural = True
        if rec_pct_num is not None and rec_pct_num >= 75.0:
            structural = True
        if ls10 is not None and ls10 < 0.045:
            structural = True
        if streak_d >= 130 and intensity == "forte":
            structural = True
        if streak_d >= 200 and smpp_f is not None and smpp_f < -5.5:
            structural = True

    regime_comp = False
    if not broken and not structural:
        if z_num is not None and z_num < -0.5:
            regime_comp = True
        if rec_pct_num is not None and rec_pct_num >= 50.0:
            regime_comp = True
        if early_sp is not None and late_sp is not None and late_sp < early_sp - 0.022:
            regime_comp = True
        if streak_d >= 63 and smpp_f is not None and smpp_f < -2.8:
            regime_comp = True

    if broken:
        edge_state = "possivelmente_quebrada"
    elif structural and long_horizon_ok:
        edge_state = "comprimida_stress_recente"
    elif structural:
        edge_state = "pressao_estrutural"
    elif regime_comp and long_horizon_ok:
        edge_state = "comprimida_regime"
    elif regime_comp:
        edge_state = "pressao_estrutural"
    else:
        edge_state = "intacta"

    state_labels_pt = {
        "intacta": "Edge intacta",
        "comprimida_regime": "Edge comprimida (regime)",
        "comprimida_stress_recente": "Edge comprimida (stress recente)",
        "pressao_estrutural": "Edge sob pressão estrutural",
        "possivelmente_quebrada": "Edge possivelmente quebrada",
    }
    verdict = state_labels_pt[edge_state]
    if edge_state == "intacta":
        verdict_sub = (
            "Spread rolling 5y próximo do normal histórico (z) e/ou recuperação sem stress extremo vs passado; "
            "10y rolling alinhado com edge ainda presente."
        )
    elif edge_state == "comprimida_regime":
        verdict_sub = (
            "Compressão mensurável (z-score, persistência ou recuperação) mas horizonte 10y ainda defensável — "
            "compatível com regime e ruído; não concluir «motor morto» só com o último ponto."
        )
    elif edge_state == "comprimida_stress_recente":
        verdict_sub = (
            "Sinais de 5y (spread, Sharpe relativo, recuperação) mostram compressão e stress recente, "
            "enquanto o horizonte 10y ainda sustenta edge — leitura típica de erosão progressiva, não de colapso isolado "
            "no gráfico de longo prazo."
        )
    elif edge_state == "pressao_estrutural":
        verdict_sub = (
            "Vários sinais (spread longo, z, recuperação lenta vs histórico, sufixo negativo intenso) empilham; "
            "validar dados, custos e premissas antes de alterar o motor."
        )
    else:
        verdict_sub = (
            "Caudas extremas (spread 10y fraco, z muito negativo, recuperação em percentil alto) — "
            "tratar como investigação séria; não atribuir só a «regime passageiro»."
        )

    out["summary_edge_state"] = edge_state
    out["summary_verdict"] = verdict
    out["summary_verdict_sub"] = verdict_sub

    # --- Decomposição temporal (spread / Sharpe rel. rolling 5y) ---
    def _mean_spread_pp(seg: np.ndarray) -> float | None:
        s = seg[np.isfinite(seg)]
        if s.size < max(50, len(seg) // 10):
            return None
        return float(np.mean(s) * 100.0)

    temporal: dict = {}
    if sp5.size >= W5 + 21:
        hist_pp = _mean_spread_pp(sp5)
        m2 = None
        m3 = None
        if hist_pp is not None:
            temporal["spread_5y_mean_hist_pp"] = round(hist_pp, 2)
        n2 = 2 * TRADING_DAYS_PER_YEAR
        n3 = 3 * TRADING_DAYS_PER_YEAR
        if sp5.size >= n2:
            m2 = _mean_spread_pp(sp5[-n2:])
            if m2 is not None:
                temporal["spread_5y_mean_last_2y_pp"] = round(m2, 2)
        if sp5.size >= n3:
            m3 = _mean_spread_pp(sp5[-n3:])
            if m3 is not None:
                temporal["spread_5y_mean_last_3y_pp"] = round(m3, 2)
        if hist_pp is not None and m2 is not None:
            temporal["spread_5y_delta_last2y_vs_hist_pp"] = round(m2 - hist_pp, 2)
        if sp5.size >= 504:
            m_y0 = _mean_spread_pp(sp5[-252:])
            m_y1 = _mean_spread_pp(sp5[-504:-252])
            if m_y0 is not None and m_y1 is not None:
                temporal["spread_5y_mean_last_1y_pp"] = round(m_y0, 2)
                temporal["spread_5y_mean_prev_1y_pp"] = round(m_y1, 2)
                if m_y0 < m_y1 - 0.6:
                    temporal["spread_short_term_momentum_pt"] = (
                        "Últimos ~12 meses vs 12 meses anteriores: o spread médio (rolling 5y) caiu — compressão mais rápida no período mais recente."
                    )
                elif m_y0 > m_y1 + 0.4:
                    temporal["spread_short_term_momentum_pt"] = (
                        "Últimos ~12 meses vs 12 meses anteriores: o spread médio estabilizou ou recuperou ligeiramente."
                    )
                else:
                    temporal["spread_short_term_momentum_pt"] = (
                        "Últimos ~12 meses vs 12 meses anteriores: ritmo de compressão semelhante — sem aceleração brusca recente."
                    )
    if rel.size >= W5 + 21:
        rfin = rel[np.isfinite(rel)]
        if rfin.size >= 80:
            temporal["sharpe_rel_5y_mean_hist"] = round(float(np.mean(rfin)), 3)
        if rel.size >= 2 * TRADING_DAYS_PER_YEAR:
            r2 = rel[-2 * TRADING_DAYS_PER_YEAR :]
            r2 = r2[np.isfinite(r2)]
            if r2.size >= 50:
                temporal["sharpe_rel_5y_mean_last_2y"] = round(float(np.mean(r2)), 3)
        if rel.size >= 3 * TRADING_DAYS_PER_YEAR:
            r3 = rel[-3 * TRADING_DAYS_PER_YEAR :]
            r3 = r3[np.isfinite(r3)]
            if r3.size >= 50:
                temporal["sharpe_rel_5y_mean_last_3y"] = round(float(np.mean(r3)), 3)
    out["temporal_degradation"] = temporal if temporal else None

    # --- Consistency score (% tempo com sinal favorável nas séries rolling 5y) ---
    consistency: dict = {"value": None, "label_pt": None, "pct_sharpe_rel_positive": None, "pct_spread_5y_positive": None}
    if rel.size > 400:
        rf = rel[np.isfinite(rel)]
        if rf.size >= 200:
            consistency["pct_sharpe_rel_positive"] = round(float(np.mean(rf > 0.0) * 100.0), 1)
    if sp5.size > 400:
        sf = sp5[np.isfinite(sp5)]
        if sf.size >= 200:
            consistency["pct_spread_5y_positive"] = round(float(np.mean(sf > 0.0) * 100.0), 1)
    ps = consistency.get("pct_sharpe_rel_positive")
    pp = consistency.get("pct_spread_5y_positive")
    if ps is not None and pp is not None:
        consistency["value"] = round(0.5 * (ps + pp), 1)
    elif ps is not None:
        consistency["value"] = ps
    elif pp is not None:
        consistency["value"] = pp
    v = consistency.get("value")
    if v is not None:
        if v >= 80.0:
            consistency["label_pt"] = "Excelente (sinais majoritariamente favoráveis ao longo da história rolling)"
        elif v >= 60.0:
            consistency["label_pt"] = "Normal (mistura de períodos favoráveis e compressão)"
        else:
            consistency["label_pt"] = "Fraco (grande parte do tempo abaixo do limiar em spread ou Sharpe rel.)"
    out["consistency_score"] = consistency

    # --- Painel executivo (hierarquia para leitura) ---
    if edge_state == "intacta":
        exec_traffic = "ok"
        exec_headline_pt = "Estado: favorável"
        exec_detail_pt = "Sinais alinhados com edge ainda coerente nos horizontes observados."
    elif edge_state in ("comprimida_regime", "comprimida_stress_recente"):
        exec_traffic = "compressed"
        exec_headline_pt = "Estado: edge comprimida (não necessariamente quebrada)"
        exec_detail_pt = (
            "Compressão mensurável em 5y; interpretar em conjunto com 10y e drawdown antes de concluir falha estrutural."
        )
    elif edge_state == "pressao_estrutural":
        exec_traffic = "at_risk"
        exec_headline_pt = "Estado: sob pressão — rever com rigor"
        exec_detail_pt = "Vários indicadores empilham; priorizar validação de dados, custos e premissas."
    else:
        exec_traffic = "at_risk"
        exec_headline_pt = "Estado: risco elevado de edge perdida"
        exec_detail_pt = "Caudas extremas em horizonte longo e/ou stress simultâneo — investigação séria."

    ls5_pp = round(ls5f * 100.0, 2) if ls5f is not None else None
    ls10_pp = round(ls10 * 100.0, 2) if ls10 is not None else None

    def _lamp_spread_5y() -> str:
        if ls5_pp is None:
            return "yellow"
        if ls5_pp <= -1.0 or (z_num is not None and z_num < -1.6):
            return "red"
        if ls5_pp < 1.5 or (z_num is not None and z_num < -0.85):
            return "yellow"
        return "green"

    def _lamp_sharpe_rel() -> str:
        sr252 = sr_per.get("pct_last_252_finite_obs")
        st = int(sr_per.get("suffix_streak_trading_days") or 0)
        if np.isfinite(lrel):
            if lrel < -0.12 or (sr252 is not None and sr252 >= 58) or st >= 130:
                return "red"
            if lrel < -0.02 or (sr252 is not None and sr252 >= 38) or st >= 55:
                return "yellow"
        elif st >= 80 or (sr252 is not None and sr252 >= 45):
            return "yellow"
        return "green"

    def _lamp_spread_10y() -> str:
        if ls10 is None:
            return "yellow"
        if ls10 < 0.02:
            return "red"
        if ls10 < 0.045:
            return "yellow"
        return "green"

    def _lamp_recovery() -> str:
        if rec_pct_num is None:
            return "yellow"
        if rec_pct_num >= 82.0:
            return "red"
        if rec_pct_num >= 58.0:
            return "yellow"
        return "green"

    sr252_txt = (
        str(sr_per.get("pct_last_252_finite_obs"))
        if sr_per.get("pct_last_252_finite_obs") is not None
        else "—"
    )
    drivers_out: list[dict] = [
        {
            "id": "sharpe_rel",
            "label_pt": "Sharpe relativo (5y rolling)",
            "lamp": _lamp_sharpe_rel(),
            "detail_pt": (
                f"Média últimos ~252d: {lrel:.3f} · Sharpe rel. <0 em ~{sr252_txt}% dos últimos ~252 pontos finitos."
                if np.isfinite(lrel)
                else "Ver persistência e gráfico — média recente indisponível."
            ),
        },
        {
            "id": "spread_5y",
            "label_pt": "Spread CAGR (5y rolling)",
            "lamp": _lamp_spread_5y(),
            "detail_pt": (
                f"Último: {ls5_pp} p.p. vs histórico (z={z_num})"
                if ls5_pp is not None and z_num is not None
                else (f"Último: {ls5_pp} p.p." if ls5_pp is not None else "Último spread indisponível.")
            ),
        },
        {
            "id": "spread_10y",
            "label_pt": "Spread CAGR (10y rolling)",
            "lamp": _lamp_spread_10y(),
            "detail_pt": f"Último: {ls10_pp} p.p. (âncora de horizonte longo)" if ls10_pp is not None else "Indisponível.",
        },
        {
            "id": "recovery",
            "label_pt": "Recuperação (stress vs histórico)",
            "lamp": _lamp_recovery(),
            "detail_pt": (
                f"Percentil empírico {rec_pct_num:.0f}% ({rec_st.get('stress_band')})"
                if rec_pct_num is not None
                else "Indisponível."
            ),
        },
    ]

    if exec_traffic == "ok":
        action_pt = "Monitorizar na cadência habitual — sem alterar o motor com base só em ruído de curto prazo."
    elif exec_traffic == "compressed":
        action_pt = "Monitorizar com atenção — não alterar o motor só pelo horizonte 5y; cruzar com 10y, DD e regimes."
    else:
        action_pt = "Rever premissas, dados e custos; só depois decidir alterações ao motor ou à moldura do produto."

    out["decision_panel"] = {
        "executive_traffic": exec_traffic,
        "executive_headline_pt": exec_headline_pt,
        "executive_detail_pt": exec_detail_pt,
        "drivers": drivers_out,
        "suggested_action_pt": action_pt,
    }
    technical_bullets = list(summary_parts)
    out["summary_bullets"] = technical_bullets
    joined = " ".join(technical_bullets).strip()
    out["summary_text"] = ((verdict_sub + " ") if verdict_sub else "") + (joined if joined else "")
    if not out["summary_text"].strip():
        out["summary_text"] = "Ver gráficos e tabelas abaixo."

    return out


def _clean_str(value: str) -> str:
    """Normaliza strings vindas de JSON/CSV, convertendo 'nan', 'NaN', 'None' em vazio."""
    if value is None:
        return ""
    s = str(value).strip()
    if s.lower() in {"nan", "none", "null"}:
        return ""
    return s


def _normalize_country(value: str, zone: str = "") -> str:
    """Canonical country labels for portfolio display and aggregation."""
    s = _clean_str(value)
    if not s:
        z = _clean_str(zone).upper()
        if z == "US":
            return "United States"
        if z == "CAN":
            return "Canada"
        if z == "JP":
            return "Japan"
        if z == "EU":
            return "Various Europe"
        return "N/A"

    u = s.upper()
    if u in {"US", "USA", "UNITED STATES", "UNITED STATES OF AMERICA"}:
        return "United States"
    if u in {"CAN", "CA", "CANADA"}:
        return "Canada"
    if u in {"JP", "JPN", "JAPAN"}:
        return "Japan"
    if u in {"EU", "EUR", "EUROPE", "EUROPEAN UNION", "VARIOUS EUROPE"}:
        return "Various Europe"
    return s


_JP_LISTING_TO_ADR_PY: dict[str, str] | None = None


def _jp_listing_to_adr_map_py() -> dict[str, str]:
    """Alinhado a ``frontend/lib/server/jpListingToAdrMap.ts`` + ``jp_listing_to_adr.csv``."""
    global _JP_LISTING_TO_ADR_PY
    if _JP_LISTING_TO_ADR_PY is not None:
        return _JP_LISTING_TO_ADR_PY
    m: dict[str, str] = {
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
    csv_p = REPO_ROOT / "backend" / "data" / "jp_listing_to_adr.csv"
    if csv_p.is_file():
        import csv

        try:
            with csv_p.open("r", encoding="utf-8-sig", newline="") as f:
                rdr = csv.reader(f)
                next(rdr, None)
                for row in rdr:
                    if len(row) < 2:
                        continue
                    a0 = str(row[0] or "").strip().upper().replace(" ", "")
                    b0 = str(row[1] or "").strip().upper().replace(" ", "")
                    if not a0 or not b0:
                        continue
                    if re.fullmatch(r"\d{3,5}-T", a0):
                        a0 = f"{a0[:-2]}.T"
                    elif re.fullmatch(r"\d{3,5}T", a0) and "." not in a0:
                        a0 = f"{a0[:-1]}.T"
                    m[a0] = b0
        except OSError:
            pass
    _JP_LISTING_TO_ADR_PY = {str(k).upper(): str(v).upper() for k, v in m.items() if k and v}
    return _JP_LISTING_TO_ADR_PY


def _jp_normalize_listing_key(ticker: str) -> str:
    t = str(ticker or "").strip().upper().replace(" ", "")
    if re.fullmatch(r"\d{3,5}-T", t):
        return f"{t[:-2]}.T"
    if re.fullmatch(r"\d{3,5}T", t) and "." not in t:
        return f"{t[:-1]}.T"
    return t


def _jp_is_numeric_listing(ticker: str) -> bool:
    return bool(re.fullmatch(r"\d{3,5}\.T", _jp_normalize_listing_key(ticker)))


def _jp_remap_listing_to_adr(ticker: str) -> str:
    k = _jp_normalize_listing_key(ticker)
    if not _jp_is_numeric_listing(k):
        return str(ticker or "").strip().upper()
    mp = _jp_listing_to_adr_map_py()
    return mp.get(k.upper(), str(ticker or "").strip().upper())


def _jp_meta_index_aliases(ticker: str) -> list[str]:
    """Variantes de índice (``BRK-B`` vs ``BRK.B``, ``8035.T`` vs ADR) para bater ``company_meta*.csv``."""
    raw = str(ticker or "").strip().upper()
    aliases: list[str] = []
    seen: set[str] = set()

    def push(x: str) -> None:
        t = x.strip().upper()
        if not t or t in seen:
            return
        seen.add(t)
        aliases.append(t)

    push(raw)
    push(raw.replace(".", "-"))
    push(raw.replace("-", "."))
    jn = _jp_normalize_listing_key(raw)
    if _jp_is_numeric_listing(jn):
        push(jn)
        push(jn.replace(".", "-"))
        push(_jp_remap_listing_to_adr(jn))
    rev = {v: k for k, v in _jp_listing_to_adr_map_py().items()}
    listing = rev.get(raw)
    if listing:
        push(listing)
        push(listing.replace(".", "-"))
    return aliases


def _meta_df_loc_first(meta_df: pd.DataFrame, ticker: str) -> pd.Series | None:
    if not ticker:
        return None
    for alias in _jp_meta_index_aliases(ticker):
        if alias not in meta_df.index:
            continue
        row = meta_df.loc[alias]
        if isinstance(row, pd.DataFrame):
            return row.iloc[0]
        return row
    return None


def load_last_close_as_of_date() -> str:
    """Return max date from backend/data/prices_close.csv (YYYY-MM-DD)."""
    prices_path = REPO_ROOT / "backend" / "data" / "prices_close.csv"
    if not prices_path.exists():
        return ""
    import csv

    try:
        with prices_path.open("r", encoding="utf-8-sig", errors="ignore", newline="") as f:
            reader = csv.reader(f)
            headers = next(reader, [])
            if not headers:
                return ""
            date_idx = 0
            for i, h in enumerate(headers):
                if str(h).strip().lower() == "date":
                    date_idx = i
                    break

            last_row = None
            for row in reader:
                last_row = row

            if not last_row or date_idx >= len(last_row):
                return ""
            return str(last_row[date_idx])[:10]
    except Exception:
        return ""


def load_holdings_and_breakdowns(base_path: Path):
    # Use portfolio_final.json which contains current holdings + metadata
    portfolio_path = base_path / "portfolio_final.json"
    if not portfolio_path.is_file():
        # Deploys mínimos (só CSVs de equity/benchmark) ou git-lfs em falta: evita 500 em GET /
        return [], [], []
    with portfolio_path.open("r", encoding="utf-8") as f:
        data = json.load(f)

    holdings_raw = data.get("holdings", [])

    # Prefer rich meta from backend (with proper company names + sectors)
    meta_path = BACKEND_META_PATH
    try:
        meta_df = pd.read_csv(meta_path)
    except FileNotFoundError:
        meta_df = pd.DataFrame(columns=["ticker", "sector", "company", "country", "zone"])
    if "ticker" in meta_df.columns:
        meta_df["ticker"] = meta_df["ticker"].astype(str).str.upper().str.strip()
        meta_df = meta_df.set_index("ticker")
    else:
        meta_df.index = meta_df.index.astype(str).str.upper().str.strip()

    if COMPANY_META_KPI_OVERRIDES_PATH.is_file():
        try:
            ov = pd.read_csv(COMPANY_META_KPI_OVERRIDES_PATH, encoding="utf-8")
            if not ov.empty and "ticker" in ov.columns:
                ov = ov.copy()
                ov["ticker"] = ov["ticker"].astype(str).str.upper().str.strip()
                ov = ov.set_index("ticker")
                for col in ("sector", "company", "country", "zone"):
                    if col not in ov.columns:
                        ov[col] = ""
                meta_df = pd.concat([meta_df, ov], axis=0)
                meta_df = meta_df[~meta_df.index.duplicated(keep="last")]
        except (OSError, ValueError, TypeError, KeyError):
            pass

    # Fallback/upgrade meta from V3 core universe (forçar nomes/sectores onde existir)
    v3_path = REPO_ROOT / "backend" / "data" / "company_meta_v3.csv"
    try:
        meta_v3 = pd.read_csv(v3_path)
        if "ticker" in meta_v3.columns:
            meta_v3["ticker"] = meta_v3["ticker"].astype(str).str.upper().str.strip()
            meta_v3 = meta_v3.set_index("ticker")
        else:
            meta_v3.index = meta_v3.index.astype(str).str.upper().str.strip()
    except FileNotFoundError:
        meta_v3 = pd.DataFrame(columns=["company", "country", "zone", "sector"])

    holdings = []
    for h in holdings_raw:
        ticker = _clean_str(h.get("ticker") or "").upper()
        sector_from_h = _clean_str(h.get("sector") or "")

        sector_from_meta = ""
        company_from_meta = ""
        country_from_meta = ""
        zone_from_meta = ""
        row_meta = _meta_df_loc_first(meta_df, ticker) if ticker else None
        if row_meta is not None:
            sector_from_meta = _clean_str(row_meta.get("sector", ""))
            company_from_meta = _clean_str(row_meta.get("company", ""))
            country_from_meta = _clean_str(row_meta.get("country", ""))
            zone_from_meta = _clean_str(row_meta.get("zone", ""))

        # Se existir linha no meta_v3, usamos sempre o sector/nome de lá como "golden source"
        row_v3 = _meta_df_loc_first(meta_v3, ticker) if ticker else None
        if row_v3 is not None:
            v3_sector = _clean_str(row_v3.get("sector", ""))
            v3_company = _clean_str(row_v3.get("company", ""))
            v3_country = _clean_str(row_v3.get("country", ""))
            v3_zone = _clean_str(row_v3.get("zone", ""))

            if v3_sector:
                sector_from_meta = v3_sector
            if v3_company:
                company_from_meta = v3_company
            if v3_country:
                country_from_meta = v3_country
            if v3_zone:
                zone_from_meta = v3_zone

        # Para apresentação:
        # - sector: primeiro o meta (global+v3), depois o que vem do freeze, por fim "Other"
        # - company: se o freeze trouxer só o ticker (ex. "MU"), usa o nome completo do meta
        sector = sector_from_meta or sector_from_h or "Other"
        company_from_h = _clean_str(h.get("company") or "")
        if company_from_meta and (not company_from_h or company_from_h.upper() == ticker or len(company_from_h) <= 4):
            company_name = company_from_meta
        else:
            company_name = company_from_h or company_from_meta or ticker
        zone_from_h = _clean_str(h.get("zone") or "")
        country = _normalize_country(
            _clean_str(h.get("country") or "") or country_from_meta,
            zone_from_meta or zone_from_h,
        )
        zone = zone_from_h or zone_from_meta
        country = _normalize_country(country, zone)

        if not zone:
            zone = "N/A"
        holdings.append(
            {
                "ticker": ticker,
                "company": company_name,
                "country": country,
                "zone": zone,
                "sector": sector,
                "weight_pct": float(h.get("weight_pct", 0.0)),
                "rank": h.get("rank") or "",
            }
        )

    # Aggregations
    df_h = pd.DataFrame(holdings)
    if not df_h.empty:
        zone_breakdown = (
            df_h.groupby("zone")["weight_pct"].sum().reset_index().to_dict("records")
        )
        sector_breakdown = (
            df_h.groupby("sector")["weight_pct"].sum().reset_index().to_dict("records")
        )
    else:
        zone_breakdown = []
        sector_breakdown = []

    return holdings, zone_breakdown, sector_breakdown


def align_holdings_weight_pct_to_nav(holdings: list, cash_frac: float, cash_ticker: str) -> list:
    """
    `portfolio_final.json` lista só ações com pesos ~100% dentro do sleeve arriscado.
    `v5_kpis.latest_cash_sleeve` é a fração NAV em T-Bills (~0,25).
    Re-escala as linhas para somarem (1-cash_frac)*100% e acrescenta uma linha T-Bills com cash_frac*100%.
    """
    if not holdings:
        return holdings
    try:
        cf = float(cash_frac)
    except (TypeError, ValueError):
        return holdings
    if not (0.01 <= cf <= 0.99):
        return holdings
    cash_tickers = {"TBILL_PROXY", "BIL", "SHV"}
    cash_ticker_u = (cash_ticker or "TBILL_PROXY").strip().upper() or "TBILL_PROXY"
    stocks = [h for h in holdings if str(h.get("ticker", "")).upper().strip() not in cash_tickers]
    if not stocks:
        return holdings
    sum_w = sum(float(h.get("weight_pct", 0) or 0) for h in stocks)
    if sum_w <= 1e-6:
        return holdings
    eq_frac = max(0.0, min(1.0, 1.0 - cf))
    out: list = []
    for i, h in enumerate(sorted(stocks, key=lambda x: -float(x.get("weight_pct", 0) or 0))):
        w_pct = float(h.get("weight_pct", 0) or 0)
        nav_pct = (w_pct / sum_w) * (eq_frac * 100.0)
        hh = dict(h)
        hh["weight_pct"] = nav_pct
        hh["rank"] = i + 1
        out.append(hh)
    out.append(
        {
            "ticker": cash_ticker_u,
            "company": "T-Bills (alocação defensiva — NAV)",
            # País: T-Bills são dívida US — mesmo rótulo que as ações US para coerência na tabela.
            "country": "United States",
            # Zona própria: não misturar com «US» (equity) no gráfico de peso por zona.
            "zone": "CASH",
            "sector": "Cash / Bills",
            "weight_pct": cf * 100.0,
            "rank": len(out) + 1,
        }
    )
    return out


def _risk_mode_card_from_v5_kpis(data: dict) -> tuple[str, str, str]:
    """ON/OFF/Neutra para o cartão «neste momento»: último dia publicado no freeze.

    Preferência: ``latest_trend_exposure`` em ``v5_kpis.json`` (quando o export o incluir).
    Fallback: ``latest_cash_sleeve`` — mais caixa (TBills) no motor ⇒ mais defensivo *agora*.
    Isto não replica a linha «Liquidez %» da recomendação ao cliente (outra agregação / fonte).
    """
    lt_raw = data.get("latest_trend_exposure")
    if lt_raw is not None and str(lt_raw).strip() != "":
        try:
            lt = float(lt_raw)
        except (TypeError, ValueError):
            lt = None
        else:
            if lt >= 0.9:
                return "on", "Risk ON", "exposição de tendência no último dia (meta do motor)"
            if lt <= 0.6:
                return "off", "Risk OFF", "exposição de tendência no último dia (meta do motor)"
            return "neutral", "Neutra", "exposição de tendência no último dia (meta do motor)"
    try:
        lc = float(data.get("latest_cash_sleeve", 0.0))
    except (TypeError, ValueError):
        lc = 0.0
    if lc >= 0.28:
        return "off", "Risk OFF", "sleeve de caixa (TBills) no último dia do backtest"
    if lc <= 0.07:
        return "on", "Risk ON", "sleeve de caixa (TBills) no último dia do backtest"
    return "neutral", "Neutra", "sleeve de caixa (TBills) no último dia do backtest"


def load_risk_info(model_key: str, base_path: Path) -> dict:
    """Carrega info de risco / cash a partir do freeze, com defaults razoáveis."""
    mode = "unknown"
    mode_label = "Desconhecido"
    mode_basis_pt = ""
    avg_risk_exposure = 1.0
    risk_on_target = 1.0
    avg_tbill_exposure = 0.0
    latest_tbill_exposure = 0.0
    cash_proxy = "-"
    v5_data: dict = {}

    if model_key in V5_KPI_JSON_MODEL_KEYS:
        kpi_path = base_path / "v5_kpis.json"
        try:
            with kpi_path.open("r", encoding="utf-8") as f:
                v5_data = json.load(f)
            avg_risk_exposure = float(v5_data.get("avg_trend_exposure", 0.97))
            risk_on_target = float(v5_data.get("risk_on_exposure", 1.1))
            avg_tbill_exposure = float(v5_data.get("avg_cash_sleeve", 0.24))
            latest_tbill_exposure = float(v5_data.get("latest_cash_sleeve", avg_tbill_exposure))
            cash_proxy = str(v5_data.get("cash_proxy_ticker", "TBILL_PROXY"))
        except FileNotFoundError:
            pass
    else:
        # V3 clássico: sem cash sleeve explícito, assumimos 100% risco, 0% T-Bills
        avg_risk_exposure = 1.0
        risk_on_target = 1.0
        avg_tbill_exposure = 0.0
        latest_tbill_exposure = 0.0
        cash_proxy = "-"

    if model_key in V5_KPI_JSON_MODEL_KEYS and v5_data:
        mode, mode_label, mode_basis_pt = _risk_mode_card_from_v5_kpis(v5_data)
    else:
        # V3 / sem v5_kpis: mantém heurística antiga sobre «tendência» ficticia 1.0
        if avg_risk_exposure >= 0.9:
            mode = "on"
            mode_label = "Risk ON"
        elif avg_risk_exposure <= 0.6:
            mode = "off"
            mode_label = "Risk OFF"
        else:
            mode = "neutral"
            mode_label = "Neutra"
        mode_basis_pt = "exposição média histórica (aproximação)"

    return {
        "mode": mode,
        "mode_label": mode_label,
        "mode_basis_pt": mode_basis_pt,
        "avg_risk_exposure": avg_risk_exposure,
        "risk_on_target": risk_on_target,
        "avg_tbill_exposure": avg_tbill_exposure,
        "latest_tbill_exposure": latest_tbill_exposure if model_key in V5_KPI_JSON_MODEL_KEYS else avg_tbill_exposure,
        "cash_proxy": cash_proxy,
    }


def load_rebalance_info(
    model_key: str,
    base_path: Path,
    *,
    num_years: float | None = None,
) -> dict:
    """Carrega KPIs de rebalance para apresentação (nº execuções, ações trocadas, turnover anual médio)."""
    n_exec = None
    n_opp = None
    avg_turnover = None
    avg_holdings = None

    if model_key.startswith("v5"):
        kpi_path = base_path / "v5_kpis.json"
        try:
            with kpi_path.open("r", encoding="utf-8") as f:
                data = json.load(f)
            n_exec = int(data.get("n_rebalance_executed"))
            n_opp = int(data.get("n_rebalance_opportunities"))
            avg_turnover = float(data.get("avg_executed_turnover_rebalance"))
            avg_holdings = float(data.get("avg_holdings_count"))
        except (FileNotFoundError, TypeError, ValueError):
            pass
    else:
        # Para V3 usamos o manifest agregador, se existir
        manifest_path = base_path / "manifest.json"
        try:
            with manifest_path.open("r", encoding="utf-8") as f:
                data = json.load(f)
            n_exec = int(data.get("num_rebalances"))
            n_opp = n_exec
            avg_holdings = float(data.get("num_holdings", 20))
        except (FileNotFoundError, TypeError, ValueError):
            pass

    # Aproximação: nº médio de ações trocadas por rebalance
    avg_trades = None
    if avg_turnover is not None and avg_holdings is not None:
        try:
            avg_trades = avg_turnover * 2.0 * avg_holdings
        except Exception:
            avg_trades = None

    # Turnover médio anual (decimal NAV): soma dos turnovers executados / horizonte em anos
    avg_annual_turnover = None
    if avg_turnover is not None and n_exec is not None and num_years is not None and num_years > 0:
        try:
            avg_annual_turnover = (float(avg_turnover) * float(n_exec)) / float(num_years)
        except Exception:
            avg_annual_turnover = None

    return {
        "n_rebalances_executed": n_exec,
        "n_rebalances_opportunities": n_opp,
        "avg_trades_per_rebalance": avg_trades,
        "avg_annual_turnover": avg_annual_turnover,
    }


BEAR_LOW_VOL_EXPLAINABILITY_PT = (
    "Em ambientes de bear market com volatilidade anormalmente baixa (frequente antes de stress), "
    "reduzimos temporariamente a exposição. Usamos histerese para evitar 'pisca-pisca': só entramos "
    "quando o sinal é forte e só saímos quando normaliza."
)


def load_bear_low_vol_dashboard(model_key: str, base_path: Path) -> dict:
    """KPIs de transparência (últimos ~12 meses de pregão) a partir de ``v5_kpis.json``."""
    empty: dict = {
        "show": False,
        "show_explain": False,
        "pct_last_12m": None,
        "entries_last_12m": None,
        "explain_pt": BEAR_LOW_VOL_EXPLAINABILITY_PT,
    }
    if model_key not in V5_KPI_JSON_MODEL_KEYS:
        return empty
    kpi_path = base_path / "v5_kpis.json"
    try:
        with kpi_path.open("r", encoding="utf-8") as f:
            data = json.load(f)
    except (FileNotFoundError, OSError, json.JSONDecodeError, TypeError):
        return empty
    if not bool(data.get("bear_low_vol_overlay_enabled")):
        return empty
    pct_raw = data.get("pct_days_bear_low_vol_protection_last_12m")
    ent_raw = data.get("bear_low_vol_protection_entry_edges_last_12m")
    pct_f: float | None
    ent_i: int | None
    try:
        pct_f = float(pct_raw) if pct_raw is not None else None
        if pct_f is not None and not np.isfinite(pct_f):
            pct_f = None
    except (TypeError, ValueError):
        pct_f = None
    try:
        ent_i = int(ent_raw) if ent_raw is not None else None
    except (TypeError, ValueError):
        ent_i = None
    return {
        "show": True,
        "show_explain": bool(data.get("bear_low_vol_hysteresis")),
        "pct_last_12m": pct_f,
        "entries_last_12m": ent_i,
        "explain_pt": str(data.get("bear_low_vol_explainability_pt") or BEAR_LOW_VOL_EXPLAINABILITY_PT),
    }


def load_scaled_model_equity_series(
    model_key: str,
    profile_key: str,
    *,
    client_embed: bool = False,
    force_synthetic_profile_vol: bool | None = None,
) -> tuple[pd.Series, pd.Series, pd.Series | None] | None:
    """Série de equity do modelo + datas + benchmark (mesma pasta do modelo).

    Política de vol: ver `apply_model_equity_profile_policy` e `kpi_force_synthetic_vol`.
    """
    profile_key = normalize_risk_profile_key(profile_key)
    base_path = MODEL_PATHS.get(model_key)
    if not base_path:
        return None
    fs = (
        kpi_force_synthetic_vol(client_embed=client_embed)
        if force_synthetic_profile_vol is None
        else bool(force_synthetic_profile_vol)
    )
    strict_cap15_vol = model_key in CAP15_VOL_TARGET_MODEL_KEYS
    model_path_default = base_path / "model_equity_final_20y.csv"
    if strict_cap15_vol:
        model_path, used_profile_file = pick_plafonado_smooth_model_equity_path(
            base_path, profile_key, force_synthetic_profile_vol=fs
        )
    elif fs:
        model_path = model_path_default
        used_profile_file = False
    else:
        model_path, used_profile_file = pick_model_equity_path_for_profile(
            base_path, profile_key, force_synthetic_profile_vol=fs
        )
    if not model_path.exists():
        return None
    _, _, model_eq, dates = load_equity_curve(model_path, "model_equity")
    bench_eq: pd.Series | None = None
    bench_path = resolve_coerced_benchmark_equity_csv_path(base_path)
    if bench_path.exists():
        _, _, bench_eq, bench_dates = load_equity_curve(bench_path, "benchmark_equity")
        bench_eq = align_equity_series_to_target_dates(bench_eq, bench_dates, dates)
        model_eq = apply_model_equity_profile_policy(
            model_eq,
            bench_eq,
            profile_key,
            used_profile_file=used_profile_file,
            client_embed=client_embed,
            force_synthetic_profile_vol=fs,
            strict_cap15_vol_targets=strict_cap15_vol,
        )
        if model_key in ("v5_overlay_cap15", "v5_overlay_cap15_max100exp"):
            model_eq = _backfill_cap15_flat_model_prefix_with_benchmark(
                model_eq, bench_eq, dates
            )
    return model_eq.astype(float), dates, bench_eq.astype(float) if bench_eq is not None else None


def try_model_kpis_for_profile(model_key: str, profile_key: str):
    """KPIs do modelo a partir de model_equity_final_20y[_perfil].csv (freeze), com vol por perfil se não houver CSV dedicado."""
    tup = load_scaled_model_equity_series(model_key, profile_key)
    if tup is None:
        return None
    model_eq, _, _ = tup
    kpis, _ = compute_kpis(model_eq)
    return kpis


def _fx_csv_path(pair: str) -> Path:
    safe = "".join(c for c in str(pair).upper() if c.isalnum())
    return REPO_ROOT / "backend" / "data" / f"fx_{safe}_daily.csv"


def load_fx_returns_aligned_to_dates(fx_path: Path, dates: pd.Series) -> np.ndarray | None:
    if not fx_path.exists():
        return None
    try:
        df = pd.read_csv(fx_path, parse_dates=["date"])
        if "ret" not in df.columns:
            return None
        df = df.sort_values("date")
        s = pd.Series(df["ret"].astype(float).values, index=pd.to_datetime(df["date"]))
        dt = pd.to_datetime(dates)
        al = s.reindex(dt).ffill().bfill()
        if len(al) != len(dt) or bool(al.isna().any()):
            return None
        return np.asarray(al.values, dtype=float)
    except Exception:
        return None


def rescale_hedged_equity_to_profile_vol(
    hedged_eq: pd.Series,
    bench_eq: pd.Series | None,
    profile_key: str,
) -> pd.Series:
    """Reaplica a mesma regra de vol do CAP15 à série já hedged (has_profile_file=False).

    Todos os perfis (moderado 1×; conservador/dinâmico 0,75× / 1,25×) realinham vol vs benchmark após o hedge.
    """
    pk = normalize_risk_profile_key(profile_key)
    if bench_eq is None:
        return hedged_eq
    n = min(len(hedged_eq), len(bench_eq))
    if n < 2:
        return hedged_eq
    h = hedged_eq.iloc[:n].reset_index(drop=True)
    b = bench_eq.iloc[:n].reset_index(drop=True)
    return scale_model_equity_to_profile_vol(h, b, pk, has_profile_file=False)


def apply_fx_hedge_to_equity_series(
    model_eq: pd.Series,
    fx_daily_rets: np.ndarray,
    hedge_frac: float,
) -> pd.Series:
    """
    Aproximação ilustrativa: retorno diário hedged = retorno modelo - hedge_frac * retorno FX
    (alinhamento conceptual a hedge de factor cambial; não substitui relatório de tesouraria).
    """
    r_m = np.asarray(model_eq.pct_change().fillna(0.0).values, dtype=float)
    n = min(len(r_m), len(fx_daily_rets))
    r_m = r_m[:n]
    r_fx = np.asarray(fx_daily_rets[:n], dtype=float)
    r_h = r_m.copy()
    for i in range(1, n):
        r_h[i] = r_m[i] - hedge_frac * r_fx[i]
    eq = np.empty(n, dtype=float)
    eq[0] = float(model_eq.iloc[0])
    for i in range(1, n):
        eq[i] = eq[i - 1] * (1.0 + r_h[i])
    return pd.Series(eq)


def _align_cap15_margin_to_model_nt0(
    margin: pd.Series,
    model: pd.Series,
) -> pd.Series:
    """
    Ajusta o nível do NAV da série «com margem» para o primeiro ponto coincidir com o do
    modelo (escala alinhada à curva plafonada, normalmente 1,0 no t=0). Multiplica por
    (model0/margin0) — a dinâmica de retornos e os KPIs em % relativos a esse ponto
    (CAGR, vol) mantêm-se; só a escala absoluta inicia alinhada ao verde.
    """
    if len(margin) == 0 or len(model) == 0 or len(margin) != len(model):
        return margin
    s0, m0 = float(margin.iloc[0]), float(model.iloc[0])
    if not (np.isfinite(s0) and abs(s0) > 1e-18 and np.isfinite(m0)):
        return margin
    k = m0 / s0
    return (margin * k).astype(float)


def cap15_margin_equity_list_aligned(
    dates: pd.Series,
    bench_eq: pd.Series,
    profile_key: str,
    *,
    force_synthetic_profile_vol: bool,
    client_embed: bool,
    main_model_path: Path | None = None,
    plafonado_eq: pd.Series | None = None,
) -> list[float] | None:
    """Série «com margem» alinhada ao calendário do CAP15 plafonado (mesma lógica que o comparativo do iframe)."""
    profile_key = normalize_risk_profile_key(profile_key)
    if main_model_path is not None and plafonado_eq is not None:
        loaded = load_cap15_margin_series_distinct_from_plafonado(
            profile_key,
            dates,
            plafonado_eq,
            bench_eq,
            main_model_path=main_model_path,
            client_embed=client_embed,
            force_synthetic_profile_vol=force_synthetic_profile_vol,
        )
        if loaded is not None:
            s = _align_cap15_margin_to_model_nt0(loaded[0], plafonado_eq)
            return [float(x) for x in s.values]
    resolved = resolve_cap15_margin_model_csv(
        profile_key,
        force_synthetic_profile_vol=force_synthetic_profile_vol,
        main_model_path=main_model_path,
    )
    if resolved is None:
        return None
    margem_path, margem_used_profile_file = resolved
    try:
        _, _, margem_eq_file, margem_dates_s = load_equity_curve(margem_path, "model_equity")
        dt_m = pd.to_datetime(dates)
        if plafonado_eq is not None:
            s_aligned_m = _reindex_margin_curve_to_model_calendar(
                margem_eq_file, margem_dates_s, dates, plafonado_eq
            )
        elif main_model_path is not None and main_model_path.exists():
            try:
                _, _, pl_eq, pl_dates = load_equity_curve(main_model_path, "model_equity")
                pl_on_cal = align_equity_series_to_target_dates(pl_eq, pl_dates, dates)
                s_aligned_m = _reindex_margin_curve_to_model_calendar(
                    margem_eq_file, margem_dates_s, dates, pl_on_cal
                )
            except Exception:
                s_fm = pd.Series(
                    np.asarray(margem_eq_file, dtype=float), index=pd.to_datetime(margem_dates_s)
                )
                s_aligned_m = s_fm.reindex(dt_m).ffill().bfill()
        else:
            s_fm = pd.Series(np.asarray(margem_eq_file, dtype=float), index=pd.to_datetime(margem_dates_s))
            s_aligned_m = s_fm.reindex(dt_m).ffill().bfill()
        if s_aligned_m is None or len(s_aligned_m) != len(dt_m) or not bool(s_aligned_m.notna().all()):
            return None
        margin_series = pd.Series([float(x) for x in s_aligned_m.values], dtype=float)
        margin_series = apply_model_equity_profile_policy(
            margin_series,
            bench_eq,
            profile_key,
            used_profile_file=margem_used_profile_file,
            client_embed=client_embed,
            force_synthetic_profile_vol=force_synthetic_profile_vol,
            strict_cap15_vol_targets=True,
        )
        margin_series = _backfill_cap15_flat_model_prefix_with_benchmark(
            margin_series, bench_eq, dates
        )
        if plafonado_eq is not None and len(margin_series) == len(plafonado_eq):
            margin_series = _align_cap15_margin_to_model_nt0(
                margin_series, plafonado_eq.astype(float)
            )
        return [float(x) for x in margin_series.values]
    except Exception:
        return None


def equity_series_bundle_for_simulator(
    model_key: str,
    profile_key: str,
    *,
    force_synthetic_profile_vol: bool,
    client_embed: bool = False,
) -> dict | None:
    """
    Séries modelo/benchmark para o simulador, com a mesma lógica de vol que a página principal.
    Permite pedir outro perfil via API sem recarregar o URL do topo.
    """
    profile_key = normalize_risk_profile_key(profile_key)
    base_path = MODEL_PATHS.get(model_key) or MODEL_PATHS["v5_overlay"]
    strict_cap15_vol = model_key in CAP15_VOL_TARGET_MODEL_KEYS
    model_path_default = base_path / "model_equity_final_20y.csv"
    if strict_cap15_vol:
        model_path, used_profile_file = pick_plafonado_smooth_model_equity_path(
            base_path, profile_key, force_synthetic_profile_vol=force_synthetic_profile_vol
        )
    elif force_synthetic_profile_vol:
        model_path = model_path_default
        used_profile_file = False
    else:
        model_path, used_profile_file = pick_model_equity_path_for_profile(
            base_path, profile_key, force_synthetic_profile_vol=force_synthetic_profile_vol
        )
    bench_path = resolve_coerced_benchmark_equity_csv_path(base_path)
    if not model_path.exists() or not bench_path.exists():
        return None
    _, _, model_eq, dates = load_equity_curve(model_path, "model_equity")
    _, _, bench_eq, bench_dates = load_equity_curve(bench_path, "benchmark_equity")
    bench_eq = align_equity_series_to_target_dates(bench_eq, bench_dates, dates)
    model_eq = apply_model_equity_profile_policy(
        model_eq,
        bench_eq,
        profile_key,
        used_profile_file=used_profile_file,
        client_embed=client_embed,
        force_synthetic_profile_vol=force_synthetic_profile_vol,
        strict_cap15_vol_targets=strict_cap15_vol,
    )
    if model_key in ("v5_overlay_cap15", "v5_overlay_cap15_max100exp"):
        model_eq = _backfill_cap15_flat_model_prefix_with_benchmark(model_eq, bench_eq, dates)
    dates_list = [d.strftime("%Y-%m-%d") for d in dates]
    bench_list = [float(x) for x in bench_eq.astype(float)]
    model_list = [float(x) for x in model_eq.astype(float)]
    num_days = len(dates_list)

    sim_model = model_list
    sim_label = "Modelo DECIDE"
    use_plafonada = False
    if model_key == "v5_overlay_cap15":
        m100_base = MODEL_PATHS["v5_overlay_cap15_max100exp"]
        m100_path, m100_used_profile_file = pick_plafonado_smooth_model_equity_path(
            m100_base, profile_key, force_synthetic_profile_vol=force_synthetic_profile_vol
        )
        if m100_path.exists():
            try:
                _, _, m100_eq_file, m100_dates_s = load_equity_curve(m100_path, "model_equity")
                dt_m = pd.to_datetime(dates)
                s_aligned = _reindex_margin_curve_to_model_calendar(
                    m100_eq_file, m100_dates_s, dates, model_eq
                )
                if s_aligned is not None and len(s_aligned) == len(model_eq) and bool(s_aligned.notna().all()):
                    m100_series = pd.Series([float(x) for x in s_aligned.values], dtype=float)
                    m100_series = apply_model_equity_profile_policy(
                        m100_series,
                        bench_eq,
                        profile_key,
                        used_profile_file=m100_used_profile_file,
                        client_embed=client_embed,
                        force_synthetic_profile_vol=force_synthetic_profile_vol,
                        strict_cap15_vol_targets=True,
                    )
                    m100_series = _backfill_cap15_flat_model_prefix_with_benchmark(
                        m100_series, bench_eq, dates
                    )
                    sim_model = [float(x) for x in m100_series.values]
                    sim_label = "Modelo CAP15"
                    use_plafonada = True
            except Exception:
                pass

    out: dict = {
        "ok": True,
        "profile": profile_key,
        "model": model_key,
        "dates": dates_list,
        "bench_equity": bench_list,
        "sim_model_equity": sim_model,
        "sim_model_label": sim_label,
        "use_plafonada_curve": use_plafonada,
        "num_days": num_days,
        "num_years": num_days / TRADING_DAYS_PER_YEAR,
        "has_sim_margin": False,
    }
    if model_key == "v5_overlay_cap15_max100exp":
        mlist = cap15_margin_equity_list_aligned(
            dates,
            bench_eq,
            profile_key,
            force_synthetic_profile_vol=force_synthetic_profile_vol,
            client_embed=client_embed,
            main_model_path=model_path,
            plafonado_eq=model_eq,
        )
        if mlist is not None and len(mlist) == len(dates_list):
            out["sim_margin_equity"] = mlist
            out["sim_margin_label"] = "Modelo CAP15 com margem (ilustrativo)"
            out["has_sim_margin"] = True
    return out


app = Flask(__name__)


@app.errorhandler(Exception)
def _kpi_log_unhandled_exception(exc: BaseException):
    """Em produção (Gunicorn/Render) o traceback por vezes não aparece nos Registos — força stderr."""
    from werkzeug.exceptions import HTTPException

    if isinstance(exc, HTTPException):
        return exc
    traceback.print_exc(file=sys.stderr)
    sys.stderr.flush()
    return Response(
        "Internal Server Error\n",
        status=500,
        mimetype="text/plain; charset=utf-8",
    )


def compute_hedged_cap15_kpis_embed(profile_key: str, pair: str, hedge_pct: float) -> dict:
    """
    KPIs hedged para o HTML do iframe cliente (aba Resumo) — série única «Modelo CAP15»
    (MAX100EXP alinhada ao calendário CAP15, sem variante com margem).
    """
    profile_key = normalize_risk_profile_key(profile_key)
    safe_pair = "".join(c for c in str(pair).upper() if c.isalnum()) or "EURUSD"
    try:
        hp = float(hedge_pct)
    except (TypeError, ValueError):
        hp = 100.0
    if hp <= 0:
        return {"ok": False, "reason": "zero_pct", "pair": safe_pair, "hedge_pct": 0.0}

    hedge_frac = max(0.0, min(1.0, hp / 100.0))
    cap100 = load_scaled_model_equity_series(
        "v5_overlay_cap15_max100exp", profile_key, client_embed=True
    )
    if cap100 is None:
        return {"ok": False, "reason": "missing_cap15", "pair": safe_pair, "hedge_pct": hp}

    m100, d100, bench100 = cap100
    fx_path = _fx_csv_path(safe_pair)
    fx100 = load_fx_returns_aligned_to_dates(fx_path, d100)
    if fx100 is None:
        return {
            "ok": False,
            "reason": "missing_fx",
            "pair": safe_pair,
            "hedge_pct": hp,
            "fx_path": str(fx_path),
        }

    m100_h = apply_fx_hedge_to_equity_series(m100, fx100, hedge_frac)
    m100_h = rescale_hedged_equity_to_profile_vol(m100_h, bench100, profile_key)
    k100, _ = compute_kpis(m100_h)

    return {
        "ok": True,
        "pair": safe_pair,
        "hedge_pct": hp,
        "cap15": k100,
        "cap15_max100": k100,
        "compare_plafonado": False,
    }


@app.route("/api/health", methods=["GET", "HEAD"])
def api_health():
    """Health check — mesmo path que o serviço FastAPI no Render; GET/HEAD com 200."""
    if request.method == "HEAD":
        rr = Response(status=200)
        rr.headers["X-Decide-Kpi-Build"] = KPI_SERVER_BUILD_TAG
        rr.headers["Access-Control-Allow-Origin"] = "*"
        rr.headers["Access-Control-Expose-Headers"] = "X-Decide-Kpi-Build"
        return rr
    # Corpo JSON explícito (evita confusão com builds antigos que só tinham ok+app no jsonify).
    _health_payload: dict = {"ok": True, "app": "DecideAI KPI Flask", "build": KPI_SERVER_BUILD_TAG}
    _health_payload["kpi_repo_root"] = str(REPO_ROOT)
    _health_payload["equity_vs_benchmark_rail"] = kpi_equity_vs_benchmark_rail_enabled()
    _health_payload["cap15_bench_prefix_backfill"] = kpi_cap15_bench_prefix_backfill_enabled()
    try:
        _vk = _PLAFONADO_CAP15_OUTPUTS / "v5_kpis.json"
        if _vk.is_file():
            _meta = json.loads(_vk.read_text(encoding="utf-8"))
            _de = str(_meta.get("data_end") or "").strip()
            if _de:
                _health_payload["smooth_plafonado_data_end"] = _de[:10]
            _ce = str(_meta.get("curve_engine") or "").strip()
            if _ce:
                _health_payload["smooth_curve_engine"] = _ce
    except Exception:
        pass
    r = Response(
        json.dumps(_health_payload, separators=(",", ":")),
        status=200,
        mimetype="application/json",
    )
    r.headers["Access-Control-Allow-Origin"] = "*"
    r.headers["X-Decide-Kpi-Build"] = KPI_SERVER_BUILD_TAG
    r.headers["Access-Control-Expose-Headers"] = "X-Decide-Kpi-Build"
    return r


def _truthy_query_param(raw: str | None) -> bool:
    return str(raw or "").strip().lower() in {"1", "true", "yes", "on"}


def _json_sanitize_diag_api(obj):
    """Converte tipos NumPy / NaN em valores JSON-compatíveis para `jsonify`."""
    if obj is None:
        return None
    if isinstance(obj, dict):
        return {str(k): _json_sanitize_diag_api(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_json_sanitize_diag_api(v) for v in obj]
    if isinstance(obj, np.bool_):
        return bool(obj)
    if isinstance(obj, np.integer):
        return int(obj)
    if isinstance(obj, (np.floating, float)):
        x = float(obj)
        return None if not np.isfinite(x) else x
    if isinstance(obj, bool):
        return obj
    if isinstance(obj, int):
        return obj
    if isinstance(obj, str):
        return obj
    return obj


def compute_client_embed_cap15_overlay_kpis(profile_key: str) -> dict | None:
    """KPIs do «Modelo CAP15» (série MAX100EXP) — mesmo critério que o iframe cliente."""
    return compute_client_embed_plafonado_kpis(profile_key)


def compute_client_embed_plafonado_kpis(profile_key: str) -> dict | None:
    """
    KPIs do cartão «Modelo CAP15» — série MAX100EXP alinhada ao calendário CAP15,
    mesma regra de vol que o iframe (`kpi_force_synthetic_vol`).
    """
    pk = normalize_risk_profile_key(profile_key)
    smooth_base = MODEL_PATHS.get("v5_overlay_cap15_max100exp")
    if smooth_base is None:
        return None
    fs = kpi_force_synthetic_vol(client_embed=True)
    m100_base = smooth_base
    m100_path, m100_used_profile_file = pick_plafonado_smooth_model_equity_path(
        m100_base, pk, force_synthetic_profile_vol=fs
    )
    bench_path = resolve_coerced_benchmark_equity_csv_path(smooth_base)
    if not m100_path.exists() or not bench_path.exists():
        return None
    try:
        _, _, _, dates = load_equity_curve(m100_path, "model_equity")
        _, _, bench_eq, bench_dates = load_equity_curve(bench_path, "benchmark_equity")
        bench_eq = align_equity_series_to_target_dates(bench_eq, bench_dates, dates)
        _, _, m100_eq_file, m100_dates_s = load_equity_curve(m100_path, "model_equity")
        dt_m = pd.to_datetime(dates)
        s_f = pd.Series(np.asarray(m100_eq_file, dtype=float), index=pd.to_datetime(m100_dates_s))
        s_aligned = s_f.reindex(dt_m).ffill().bfill()
        n_cap = len(dt_m)
        if len(s_aligned) != n_cap or not bool(s_aligned.notna().all()):
            return None
        m100_series = pd.Series([float(x) for x in s_aligned.values], dtype=float)
        m100_series = apply_model_equity_profile_policy(
            m100_series,
            bench_eq,
            pk,
            used_profile_file=m100_used_profile_file,
            client_embed=True,
            force_synthetic_profile_vol=fs,
            strict_cap15_vol_targets=True,
        )
        m100_series = _backfill_cap15_flat_model_prefix_with_benchmark(
            m100_series, bench_eq, dates
        )
        m100_series = cap_equity_vs_benchmark_rail(bench_eq, m100_series)
        compare_cap100_kpis, _ = compute_kpis(m100_series)
        cagr_pct = round(float(compare_cap100_kpis.cagr) * 100.0, 2)
        sharpe_raw = float(compare_cap100_kpis.sharpe)
        sharpe = (
            None
            if (not np.isfinite(sharpe_raw) or np.isnan(sharpe_raw))
            else round(sharpe_raw, 2)
        )
        vol_annual_pct = round(float(compare_cap100_kpis.volatility) * 100.0, 2)
        mdd_raw = float(compare_cap100_kpis.max_drawdown)
        max_drawdown_pct = round(abs(mdd_raw) * 100.0, 2)
        return {
            "cagr_pct": cagr_pct,
            "sharpe": sharpe,
            "vol_annual_pct": vol_annual_pct,
            "max_drawdown_pct": max_drawdown_pct,
        }
    except Exception:
        return None


def compute_client_embed_plafonado_cagr_pct(profile_key: str) -> float | None:
    """Retrocompatível: só o CAGR % (2 casas)."""
    k = compute_client_embed_plafonado_kpis(profile_key)
    return k["cagr_pct"] if k else None


@app.get("/api/embed-cap15-cagr")
def api_embed_cap15_cagr():
    """CAGR % e KPIs do «Modelo CAP15» — alinhados ao iframe cliente (série MAX100EXP)."""
    pk = normalize_risk_profile_key(request.args.get("profile") or "moderado")
    k = compute_client_embed_cap15_overlay_kpis(pk)
    if k is None:
        r = jsonify({"ok": False, "profile": pk, "error": "no_cap15_overlay_series"})
    else:
        r = jsonify({"ok": True, "profile": pk, **k})
    r.headers["Access-Control-Allow-Origin"] = "*"
    return r


@app.get("/api/embed-plafonado-cagr")
def api_embed_plafonado_cagr():
    """JSON com CAGR e KPIs do «Modelo CAP15» (alias retrocompatível de `/api/embed-cap15-cagr`)."""
    pk = normalize_risk_profile_key(request.args.get("profile") or "moderado")
    k = compute_client_embed_plafonado_kpis(pk)
    if k is None:
        r = jsonify({"ok": False, "profile": pk, "error": "no_plafonado_series"})
    else:
        r = jsonify({"ok": True, "profile": pk, **k})
    r.headers["Access-Control-Allow-Origin"] = "*"
    return r


@app.route("/", methods=["GET", "HEAD"])
def index():
    # Render health-check usa HEAD /; sem isto a vista normal pode devolver 404 (ex.: freeze v5_overlay
    # ausente no deploy) e o deploy falha mesmo com /api/health OK.
    if request.method == "HEAD":
        try:
            repo_hdr = str(REPO_ROOT.resolve())
        except Exception:
            repo_hdr = str(REPO_ROOT)
        return Response(
            "",
            status=200,
            headers={
                "X-Decide-Kpi-Build": KPI_SERVER_BUILD_TAG,
                "X-Decide-Kpi-Repo-Root": repo_hdr,
                "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
            },
        )
    model_key = request.args.get("model", "v5_overlay")
    profile_key = normalize_risk_profile_key(request.args.get("profile", "moderado"))

    # Vista embutida no dashboard Next: sem comparativo extra nem selector de modelo no topo.
    client_embed = _truthy_query_param(request.args.get("client_embed"))
    # Simples / Avançado: controlado pelo dashboard Next (?kpi_view=simple|advanced); default simple.
    kpi_view_raw = (request.args.get("kpi_view") or ("simple" if client_embed else "advanced")).strip().lower()
    kpi_simple = kpi_view_raw != "advanced"
    cap15_only = _truthy_query_param(request.args.get("cap15_only")) or client_embed
    if cap15_only:
        model_key = "v5_overlay_cap15_max100exp"
    elif model_key == "v5_overlay":
        # Deploys with only `freeze/DECIDE_MODEL_V5_V2_3_SMOOTH` (no legacy `DECIDE_MODEL_V5_OVERLAY/`).
        if not (MODEL_PATHS["v5_overlay"] / "model_equity_final_20y.csv").exists():
            model_key = "v5_overlay_cap15_max100exp"

    base_path = MODEL_PATHS.get(model_key) or MODEL_PATHS["v5_overlay"]
    # Curva por perfil quando o CSV tem histórico longo; ignorar placeholders (~60 linhas, ex. moderado).
    model_path_default = base_path / "model_equity_final_20y.csv"
    # Iframe: por defeito usa `model_equity_final_20y.csv` para todos; `DECIDE_KPI_REAL_EQUITY=1` permite CSV por perfil.
    force_synthetic_profile_vol = kpi_force_synthetic_vol(client_embed=client_embed)
    if model_key in CAP15_VOL_TARGET_MODEL_KEYS:
        model_path, used_profile_file = pick_plafonado_smooth_model_equity_path(
            base_path, profile_key, force_synthetic_profile_vol=force_synthetic_profile_vol
        )
    elif force_synthetic_profile_vol:
        model_path = model_path_default
        used_profile_file = False
    else:
        model_path, used_profile_file = pick_model_equity_path_for_profile(
            base_path, profile_key, force_synthetic_profile_vol=force_synthetic_profile_vol
        )
    bench_path = resolve_coerced_benchmark_equity_csv_path(base_path)
    bench_path = reinforce_long_benchmark_csv_path(bench_path, base_path)
    if client_embed and cap15_only:
        canon_bench_csv = resolve_canon_smooth_benchmark_clone_csv()
        if canon_bench_csv is not None and _csv_date_row_count(bench_path) < 500:
            bench_path = canon_bench_csv

    if not model_path.exists():
        return (
            f"Ficheiro não encontrado: {model_path}. "
            f"Corra o backtest V5 com --out freeze/DECIDE_MODEL_V5 (ou OVERLAY) para gerar os dados.",
            404,
        )
    if not bench_path.exists():
        return (
            f"Ficheiro não encontrado: {bench_path}. "
            f"Gere `benchmark_equity_final_20y.csv` no freeze do modelo (ou `model_outputs_from_clone/`).",
            404,
        )
    _, _, model_eq, dates = load_equity_curve(model_path, "model_equity")
    _, _, bench_eq, bench_dates = load_equity_curve(bench_path, "benchmark_equity")
    bench_eq = align_equity_series_to_target_dates(bench_eq, bench_dates, dates)
    if client_embed and cap15_only and _csv_date_row_count(bench_path) < 500:
        canon_bench_csv = resolve_canon_smooth_benchmark_clone_csv()
        if canon_bench_csv is not None:
            bench_path = canon_bench_csv
            _, _, bench_eq, bench_dates = load_equity_curve(bench_path, "benchmark_equity")
            bench_eq = align_equity_series_to_target_dates(bench_eq, bench_dates, dates)

    # Cauda corrompida no CSV (ordens 1e19+) rebenta `pct_change`/`std` em `scale_model_equity_to_profile_vol`
    # (curva «morta» ~1,0 + degrau no fim). Sanitizar **antes** da política de perfil e de `raw_eq = model_eq.copy()`.
    if len(model_eq) == len(bench_eq):
        model_eq = cap_equity_vs_benchmark_rail(bench_eq, model_eq.astype(float))

    # Iframe dashboard: nunca usar `tmp_diag/run_model_live.json` para a curva/KPIs «teóricos» —
    # esse snapshot costuma repetir a série plafonada (CAGR/vol iguais ao CAP15).
    if client_embed:
        run_model_snapshot = None
        raw_kpis_snapshot = None
    else:
        run_model_snapshot = load_run_model_snapshot(profile_key)
        raw_kpis_snapshot = run_model_snapshot.get("raw_kpis") if run_model_snapshot else None

    # --- «Modelo RAW / motor (não investível)» / raw_kpis — nunca o mesmo CSV que o plafonado no embed CAP15.
    # Curva preferida: `model_equity_theoretical_20y.csv` (ilustrativo «motor bruto», ver script de geração);
    # senão `model_equity_final_20y.csv` no freeze do modelo activo.
    # KPIs: `compute_kpis(raw_eq)` sem escala de vol ao benchmark (contrasta com model_eq).
    # Página completa (não embed): opcionalmente `series.equity_raw` + `raw_kpis` em run_model snapshot.
    # Override explícito: `DECIDE_KPI_USE_RAW_KPI_SNAPSHOT=1`.
    raw_eq_from_snapshot = False
    theoretical_path = resolve_theoretical_model_equity_csv_path(base_path)
    if client_embed and cap15_only:
        _rpm = resolve_cap15_embed_raw_motor_equity_csv_path(model_path, base_path)
        raw_path = _rpm if _rpm is not None else (base_path / "model_equity_theoretical_20y.csv")
        if _rpm is None:
            print(
                "[kpi_server] embed CAP15: não foi encontrado CSV RAW/motor distinto do plafonado — "
                "cartão esquerdo pode coincidir com o CAP15. Confirme `freeze/.../model_equity_theoretical_20y.csv`.",
                file=sys.stderr,
            )
    else:
        raw_path = theoretical_path if theoretical_path is not None else (base_path / "model_equity_final_20y.csv")

    if client_embed and cap15_only and raw_path.exists() and model_path.exists():
        try:
            if raw_path.resolve().samefile(model_path.resolve()):
                for root in _freeze_search_roots():
                    ow = root / "freeze" / "DECIDE_MODEL_V5_OVERLAY" / "model_outputs" / "model_equity_final_20y.csv"
                    if ow.exists():
                        try:
                            if ow.resolve().samefile(model_path.resolve()):
                                continue
                        except OSError:
                            pass
                        raw_path = ow
                        break
        except OSError:
            pass

    if run_model_snapshot and isinstance(run_model_snapshot.get("series"), dict):
        raw_series_values = run_model_snapshot["series"].get("equity_raw") or []
        if len(raw_series_values) > 1:
            raw_eq = pd.Series([float(x) for x in raw_series_values], dtype=float)
            raw_eq_from_snapshot = True
        elif raw_path.exists():
            _, _, raw_eq, raw_dates = load_equity_curve(raw_path, "model_equity")
            raw_eq = align_equity_series_to_target_dates(raw_eq, raw_dates, dates)
        else:
            raw_eq = model_eq.copy()
    elif raw_path.exists():
        _, _, raw_eq, raw_dates = load_equity_curve(raw_path, "model_equity")
        raw_eq = align_equity_series_to_target_dates(raw_eq, raw_dates, dates)
    else:
        raw_eq = model_eq.copy()

    # Série «raw» / teórico: mesmo calendário que o modelo activo (snapshot ou séries com N≠len(dates)).
    if len(raw_eq) != len(dates):
        if raw_path.exists():
            _, _, raw_eq, raw_dates = load_equity_curve(raw_path, "model_equity")
            raw_eq = align_equity_series_to_target_dates(raw_eq, raw_dates, dates)
        else:
            raw_eq = model_eq.copy()

    if cap15_only and model_key == "v5_overlay_cap15_max100exp" and len(raw_eq) == len(model_eq):
        raw_eq, raw_path = resolve_distinct_smooth_theoretical_vs_plafonado(dates, model_eq, raw_eq, raw_path)

    if cap15_only and len(raw_eq) == len(bench_eq):
        raw_eq = cap_equity_vs_benchmark_rail(bench_eq, raw_eq)

    # CAP15 e restantes: ver `apply_model_equity_profile_policy`.
    model_eq = apply_model_equity_profile_policy(
        model_eq,
        bench_eq,
        profile_key,
        used_profile_file=used_profile_file,
        client_embed=client_embed,
        force_synthetic_profile_vol=force_synthetic_profile_vol,
        strict_cap15_vol_targets=(model_key in CAP15_VOL_TARGET_MODEL_KEYS),
    )
    if model_key in ("v5_overlay_cap15", "v5_overlay_cap15_max100exp"):
        model_eq = _backfill_cap15_flat_model_prefix_with_benchmark(model_eq, bench_eq, dates)

    model_eq = cap_equity_vs_benchmark_rail(bench_eq, model_eq)

    profile_source_note = (
        f"Perfil: {profile_key} (curva por ficheiro)."
        if used_profile_file
        else (
            f"Perfil: {profile_key} (vol alvo ≈ {PROFILE_VOL_MULTIPLIER.get(profile_key, 1.0)}× vol do benchmark)."
            if profile_key != "moderado"
            else "Perfil: moderado."
        )
    )
    if cap15_only:
        profile_source_note = (
            "Modelo CAP15: exposição a risco limitada ao capital (≤100% NV), sem alavancagem além do NAV. "
            "Moderado: série investível (CSV) com alvo ≈1× vol do benchmark no motor na perna overlay; "
            "no painel CAP15, alinhamento adicional a ≈1× vs benchmark nos cartões (mesma função que outros perfis, mult 1,0). "
            "Conservador/dinâmico: alvo ≈ 0,75× / 1,25× da vol do benchmark nos cartões."
        )
        if force_synthetic_profile_vol:
            profile_source_note += (
                " Conservador/dinâmico usam a curva base comum antes do ajuste de vol vs benchmark."
            )
        elif client_embed and kpi_env_real_equity():
            profile_source_note += (
                " No iframe: DECIDE_KPI_REAL_EQUITY=1 — o selector pode carregar `model_equity_final_20y_{perfil}.csv` "
                "quando existir; conservador e dinâmico mantêm o alvo de vol vs benchmark (0,75× / 1,25×)."
            )

    num_days = len(model_eq)
    num_years = num_days / TRADING_DAYS_PER_YEAR

    # Alisa artefacto pontual (p.ex. 2021-05-13) nos CSVs congelados antes de drawdowns e KPIs no iframe.
    patch_equity_knot_dates_linear(dates, model_eq, raw_eq, bench_eq)

    raw_kpis, raw_drawdowns = compute_kpis(raw_eq)
    _snap_raw = os.environ.get("DECIDE_KPI_USE_RAW_KPI_SNAPSHOT", "").strip().lower() in {
        "1",
        "true",
        "yes",
    }
    if raw_kpis_snapshot and (raw_eq_from_snapshot or _snap_raw):
        raw_kpis = type(
            "KPIs",
            (),
            {
                "cagr": float(raw_kpis_snapshot.get("cagr", raw_kpis.cagr)),
                "volatility": float(raw_kpis_snapshot.get("vol", raw_kpis.volatility)),
                "sharpe": float(raw_kpis_snapshot.get("sharpe", raw_kpis.sharpe)),
                "max_drawdown": float(raw_kpis_snapshot.get("max_drawdown", raw_kpis.max_drawdown)),
                "total_return": float(raw_kpis_snapshot.get("total_return", raw_kpis.total_return)),
            },
        )()
    model_kpis, model_drawdowns = compute_kpis(model_eq)
    bench_kpis, bench_drawdowns = compute_kpis(bench_eq)
    if cap15_only and normalize_risk_profile_key(profile_key) == "moderado":
        official_battery = _read_official_moderado_battery_kpis()
        if official_battery is not None:
            model_kpis = type(
                "KPIs",
                (),
                {
                    "cagr": float(official_battery["cagr"]),
                    # Keep moderado KPI card aligned to benchmark risk framing (≈1x vol vs bench).
                    "volatility": float(bench_kpis.volatility),
                    "sharpe": float(official_battery["sharpe"]),
                    "max_drawdown": float(official_battery["max_drawdown"]),
                    "total_return": float(model_kpis.total_return),
                },
            )()

    monthly = compute_monthly_stats(model_eq, bench_eq, dates)

    holdings, zone_breakdown, sector_breakdown = load_holdings_and_breakdowns(base_path)
    risk_info = load_risk_info(model_key, base_path)
    if model_key in V5_KPI_JSON_MODEL_KEYS:
        try:
            cf_nav = float(risk_info.get("latest_tbill_exposure") or 0.0)
        except (TypeError, ValueError):
            cf_nav = 0.0
        if 0.01 <= cf_nav <= 0.99:
            cproxy = str(risk_info.get("cash_proxy") or "TBILL_PROXY").strip().upper() or "TBILL_PROXY"
            holdings = align_holdings_weight_pct_to_nav(holdings, cf_nav, cproxy)
            df_h = pd.DataFrame(holdings)
            if not df_h.empty and "weight_pct" in df_h.columns:
                zone_breakdown = (
                    df_h.groupby("zone")["weight_pct"].sum().reset_index().to_dict("records")
                )
                sector_breakdown = (
                    df_h.groupby("sector")["weight_pct"].sum().reset_index().to_dict("records")
                )
    rebalance_info = load_rebalance_info(model_key, base_path, num_years=num_years)
    bear_low_vol_dash = load_bear_low_vol_dashboard(model_key, base_path)

    # Rolling 1Y alpha
    alpha_dates, alpha_vals = compute_rolling_alpha(model_eq, bench_eq, dates)

    close_as_of_date = load_last_close_as_of_date()

    # Comparativo alternativo (exposição plafonada): KPIs e curvas com a mesma regra de vol por perfil (CAP15 incluído).
    compare_cap100_kpis = None
    max100_root = MODEL_PATHS["v5_overlay_cap15_max100exp"].parent

    # Curva MAX100Exp alinhada + barras anuais (só quando o modelo principal é CAP15)
    show_max100_compare = False
    compare_cap100_is_margin = False
    compare_max100_equity = None
    compare_max100_drawdowns = None
    compare_max100_alpha_vals = None
    yearly_bar_payload = {"years": [], "cap15_pct": [], "max100_pct": [], "bench_pct": []}
    m100_series = None
    if model_key == "v5_overlay_cap15":
        m100_base = MODEL_PATHS["v5_overlay_cap15_max100exp"]
        m100_path, m100_used_profile_file = pick_plafonado_smooth_model_equity_path(
            m100_base, profile_key, force_synthetic_profile_vol=force_synthetic_profile_vol
        )
        if m100_path.exists():
            try:
                _, _, m100_eq_file, m100_dates_s = load_equity_curve(m100_path, "model_equity")
                dt_m = pd.to_datetime(dates)
                s_aligned = _reindex_margin_curve_to_model_calendar(
                    m100_eq_file, m100_dates_s, dates, model_eq
                )
                if s_aligned is not None and len(s_aligned) == len(model_eq) and bool(s_aligned.notna().all()):
                    m100_series = pd.Series([float(x) for x in s_aligned.values], dtype=float)
                    m100_series = apply_model_equity_profile_policy(
                        m100_series,
                        bench_eq,
                        profile_key,
                        used_profile_file=m100_used_profile_file,
                        client_embed=client_embed,
                        force_synthetic_profile_vol=force_synthetic_profile_vol,
                        strict_cap15_vol_targets=True,
                    )
                    m100_series = _backfill_cap15_flat_model_prefix_with_benchmark(
                        m100_series, bench_eq, dates
                    )
                    m100_series = cap_equity_vs_benchmark_rail(bench_eq, m100_series)
                    patch_equity_knot_dates_linear(dates, m100_series)
                    compare_cap100_kpis, m100_dd_s = compute_kpis(m100_series)
                    compare_max100_equity = [float(x) for x in m100_series.values]
                    compare_max100_drawdowns = [float(x) for x in m100_dd_s]
                    _, alpha_m100 = compute_rolling_alpha(m100_series, bench_eq, dates)
                    compare_max100_alpha_vals = [float(x) for x in alpha_m100]
                    show_max100_compare = True
                    yearly_bar_payload = build_yearly_bar_chart_payload(
                        model_eq,
                        m100_series,
                        bench_eq,
                        dates,
                    )
            except Exception:
                show_max100_compare = False

    # Vista CAP15 (embed ou ?cap15_only=1): comparativo «com margem» via CSVs smooth; rejeita cópia do plafonado.
    elif model_key == "v5_overlay_cap15_max100exp" and cap15_only:
        loaded_m = load_cap15_margin_series_distinct_from_plafonado(
            profile_key,
            dates,
            model_eq,
            bench_eq,
            main_model_path=model_path,
            client_embed=client_embed,
            force_synthetic_profile_vol=force_synthetic_profile_vol,
        )
        if loaded_m is not None:
            margin_series, _margem_src = loaded_m
            margin_series = _align_cap15_margin_to_model_nt0(margin_series, model_eq.astype(float))
            patch_equity_knot_dates_linear(dates, margin_series)
            try:
                compare_cap100_kpis, margin_dd_s = compute_kpis(margin_series)
                compare_max100_equity = [float(x) for x in margin_series.values]
                compare_max100_drawdowns = [float(x) for x in margin_dd_s]
                _, alpha_margin = compute_rolling_alpha(margin_series, bench_eq, dates)
                compare_max100_alpha_vals = [float(x) for x in alpha_margin]
                show_max100_compare = True
                compare_cap100_is_margin = True
                yearly_bar_payload = build_yearly_bar_chart_payload(
                    margin_series,
                    model_eq,
                    bench_eq,
                    dates,
                )
            except Exception as exc:
                print(f"[kpi_server] cap15 margin compare failed: {exc}", file=sys.stderr)
                show_max100_compare = False
                compare_cap100_is_margin = False
                compare_cap100_kpis = None
                compare_max100_equity = None
                compare_max100_drawdowns = None
                compare_max100_alpha_vals = None

    if cap15_only and model_key == "v5_overlay_cap15_max100exp" and not show_max100_compare:
        y_m = yearly_calendar_returns_fraction(model_eq, dates)
        y_b = yearly_calendar_returns_fraction(bench_eq, dates)
        years_sorted = sorted(set(y_m.keys()) | set(y_b.keys()))
        yearly_bar_payload = {
            "years": [str(y) for y in years_sorted],
            "cap15_pct": [round(y_m[y] * 100, 2) if y in y_m else None for y in years_sorted],
            "max100_pct": [None for _ in years_sorted],
            "bench_pct": [round(y_b[y] * 100, 2) if y in y_b else None for y in years_sorted],
        }

    embed_tab_raw = (request.args.get("embed_tab") or "").strip().lower()
    _allowed_embed_tabs = (
        "overview",
        "simulator",
        "horizons",
        "charts",
        "portfolio",
        "portfolio_history",
        "faq",
    )
    embed_initial_tab = embed_tab_raw if embed_tab_raw in _allowed_embed_tabs else ""

    embed_hedge = _truthy_query_param(request.args.get("embed_hedge"))
    hedge_pair_arg = (request.args.get("hedge_pair") or "EURUSD").strip().upper()
    try:
        hedge_pct_arg = float(request.args.get("hedge_pct", "100"))
    except ValueError:
        hedge_pct_arg = 100.0
    hedge_kpis_embed = None
    if client_embed and cap15_only and embed_hedge:
        hedge_kpis_embed = compute_hedged_cap15_kpis_embed(profile_key, hedge_pair_arg, hedge_pct_arg)

    # Separador inicial: embed_tab do Next define a vista; sem parâmetro, embed cliente abre em Gráficos (histórico).
    if embed_tab_raw == "overview":
        client_focus_sim = False
    elif embed_tab_raw == "simulator":
        client_focus_sim = True
    elif embed_tab_raw in ("charts", "portfolio", "portfolio_history", "faq", "horizons"):
        client_focus_sim = False
    else:
        client_focus_sim = False

    # Aba «Retornos YTD…»: mesma curva que o simulador (Modelo CAP15 = max100exp no iframe).
    horizon_model_eq = model_eq
    horizon_model_label = MODEL_LABELS.get(model_key, model_key)
    if model_key == "v5_overlay_cap15" and m100_series is not None and len(m100_series) == len(model_eq):
        horizon_model_eq = m100_series
        horizon_model_label = MODEL_LABELS.get("v5_overlay_cap15_max100exp", "Modelo CAP15")

    horizon_returns = build_horizon_returns_payload(dates, horizon_model_eq, bench_eq)
    model_display_label = horizon_model_label
    _full_page_tabs = frozenset(
        {
            "overview",
            "charts",
            "horizons",
            "simulator",
            "portfolio",
            "portfolio_history",
            "faq",
            "diagnostics",
        }
    )
    if client_embed:
        tab_default = embed_initial_tab if embed_initial_tab else (
            "simulator" if client_focus_sim else "charts"
        )
    else:
        ui_tab = (request.args.get("tab") or "").strip().lower()
        tab_default = ui_tab if ui_tab in _full_page_tabs else "overview"

    # Dashboard iframe: cartão principal = plafonado; terceiro cartão/linha = margem quando o freeze existe.
    embed_recommended_key = "modelo_cap15" if client_embed and cap15_only else None
    rec_cagr_for_compare = float(model_kpis.cagr)
    cagr_delta_vs_bench_pp = (rec_cagr_for_compare - float(bench_kpis.cagr)) * 100.0

    horizons_embed_story = horizons_embed_story_dict(horizon_returns) if client_embed else None
    charts_embed_context = (
        charts_embed_context_dict(
            list(model_eq.astype(float)),
            list(bench_eq.astype(float)),
            [float(x) for x in model_drawdowns],
            [float(x) for x in bench_drawdowns],
        )
        if client_embed
        else None
    )

    diagnostics_payload: dict | None = None
    if not client_embed:
        try:
            diagnostics_payload = compute_model_degradation_diagnostics(
                model_eq, bench_eq, dates, rebalance_info=rebalance_info
            )
        except Exception as exc:
            diagnostics_payload = {
                "ok": False,
                "error": str(exc),
                "summary_text": "Erro ao calcular o pacote de diagnóstico.",
                "subperiods": [],
                "regimes": [],
            }

    profile_label_pt = PROFILE_LABEL_PT_SHORT.get(profile_key, profile_key)
    cap15_human_label_pt = f"Modelo {profile_label_pt} — limite máximo de 15% por posição"
    cap15_human_margin_label_pt = f"{cap15_human_label_pt} · variante com margem (ilustrativo)"

    kpi_diag_build = KPI_SERVER_BUILD_TAG
    kpi_diag_repo = str(REPO_ROOT.resolve())
    kpi_diag_bench_file = bench_path.name
    kpi_diag_bench_rows = _csv_date_row_count(bench_path)
    kpi_diag_raw_file = raw_path.name if raw_path.exists() else "—"
    kpi_diag_raw_rows = _csv_date_row_count(raw_path) if raw_path.exists() else 0

    model_dates_iso = [d.strftime("%Y-%m-%d") for d in dates]

    html_out = render_template_string(
        HTML_TEMPLATE,
        kpi_build_tag=KPI_SERVER_BUILD_TAG,
        kpi_diag_build=kpi_diag_build,
        kpi_diag_repo=kpi_diag_repo,
        kpi_diag_bench_file=kpi_diag_bench_file,
        kpi_diag_bench_rows=kpi_diag_bench_rows,
        kpi_diag_raw_file=kpi_diag_raw_file,
        kpi_diag_raw_rows=kpi_diag_raw_rows,
        raw_kpis=raw_kpis,
        model_kpis=model_kpis,
        bench_kpis=bench_kpis,
        compare_cap100_kpis=compare_cap100_kpis,
        monthly=monthly,
        model_path=model_path,
        bench_path=bench_path,
        num_days=num_days,
        num_years=num_years,
        model_dates=model_dates_iso,
        raw_drawdowns=[float(x) for x in raw_drawdowns],
        model_equity=list(model_eq.astype(float)),
        bench_equity=list(bench_eq.astype(float)),
        model_drawdowns=[float(x) for x in model_drawdowns],
        bench_drawdowns=[float(x) for x in bench_drawdowns],
        alpha_dates=alpha_dates,
        alpha_vals=[float(x) for x in alpha_vals],
        holdings=holdings,
        zone_breakdown=zone_breakdown,
        sector_breakdown=sector_breakdown,
        model_options=(
            [("v5_overlay_cap15_max100exp", MODEL_LABELS["v5_overlay_cap15_max100exp"])]
            if cap15_only
            else list(MODEL_LABELS.items())
        ),
        current_model=model_key,
        profile_options=(
            [
                ("conservador", "Conservador"),
                ("moderado", "Moderado"),
                ("dinamico", "Dinâmico"),
            ]
            if cap15_only
            else PROFILE_OPTIONS
        ),
        current_profile=profile_key,
        profile_label_pt=profile_label_pt,
        cap15_human_label_pt=cap15_human_label_pt,
        cap15_human_margin_label_pt=cap15_human_margin_label_pt,
        profile_source_note=profile_source_note,
        frontend_url=resolve_frontend_url_for_embed(request),
        risk_info=risk_info,
        rebalance_info=rebalance_info,
        bear_low_vol_dash=bear_low_vol_dash,
        close_as_of_date=close_as_of_date,
        cap15_only=cap15_only,
        client_embed=client_embed,
        kpi_simple=kpi_simple,
        show_max100_compare=show_max100_compare,
        compare_cap100_is_margin=compare_cap100_is_margin,
        compare_max100_equity=compare_max100_equity,
        compare_max100_drawdowns=compare_max100_drawdowns,
        compare_max100_alpha_vals=compare_max100_alpha_vals,
        yearly_bar_years=yearly_bar_payload["years"],
        yearly_bar_cap15_pct=yearly_bar_payload["cap15_pct"],
        yearly_bar_max100_pct=yearly_bar_payload["max100_pct"],
        yearly_bar_bench_pct=yearly_bar_payload["bench_pct"],
        client_focus_sim=client_focus_sim,
        embed_initial_tab=embed_initial_tab,
        horizon_returns=horizon_returns,
        model_display_label=model_display_label,
        tab_default=tab_default,
        hedge_kpis_embed=hedge_kpis_embed,
        embed_recommended_key=embed_recommended_key,
        cagr_delta_vs_bench_pp=cagr_delta_vs_bench_pp,
        horizons_embed_story=horizons_embed_story,
        charts_embed_context=charts_embed_context,
        diagnostics=diagnostics_payload or {},
    )
    resp = make_response(html_out)
    resp.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    resp.headers["Pragma"] = "no-cache"
    resp.headers["X-Decide-Kpi-Build"] = KPI_SERVER_BUILD_TAG
    try:
        resp.headers["X-Decide-Kpi-Bench-Rows"] = str(int(len(bench_dates)))
    except Exception:
        pass
    try:
        resp.headers["X-Decide-Kpi-Bench-Csv-Rows"] = str(
            int(len(pd.read_csv(bench_path, usecols=["date"]))),
        )
    except Exception:
        pass
    resp.headers["X-Decide-Kpi-Bench-File"] = bench_path.name
    resp.headers["X-Decide-Kpi-Raw-File"] = raw_path.name if raw_path.exists() else "missing"
    try:
        resp.headers["X-Decide-Kpi-Repo-Root"] = str(REPO_ROOT.resolve())
    except Exception:
        resp.headers["X-Decide-Kpi-Repo-Root"] = str(REPO_ROOT)
    try:
        if model_dates_iso:
            resp.headers["X-Decide-Kpi-Model-Last-Date"] = str(model_dates_iso[-1])[:10]
    except Exception:
        pass
    try:
        resp.headers["X-Decide-Kpi-Model-Equity-Path"] = str(model_path.resolve())
    except Exception:
        resp.headers["X-Decide-Kpi-Model-Equity-Path"] = str(model_path)
    return resp


@app.get("/api/kpis-hedged-cap15")
def api_kpis_hedged_cap15():
    """
    KPIs do Modelo CAP15 após aplicar hedge cambial ilustrativo ao longo da série
    (ficheiro `backend/data/fx_{PAIR}_daily.csv` com colunas date, ret).

    Depois do hedge, volta a aplicar-se a **mesma regra de vol por perfil** que no simulador
    (vol alvo ≈ 0,75× / 1× / 1,25× a vol do benchmark). O hedge **não** «fixa» o CAGR ao do modelo
    sem hedge: remove só o factor FX da série diária; o CAGR pode subir ou descer consoante, no
    período, o FX tenha contribuído em média negativa ou positiva para o retorno em EUR.
    """
    profile_key = normalize_risk_profile_key(request.args.get("profile", "moderado"))
    pair = request.args.get("pair", "EURUSD").strip().upper()
    try:
        hedge_pct = float(request.args.get("hedge_pct", "100"))
    except ValueError:
        hedge_pct = 100.0
    emb = compute_hedged_cap15_kpis_embed(profile_key, pair, hedge_pct)
    if not emb.get("ok"):
        reason = emb.get("reason")
        if reason == "missing_cap15":
            r = jsonify({"ok": False, "error": "missing_cap15_equity"})
            r.headers["Access-Control-Allow-Origin"] = "*"
            return r, 404
        if reason == "missing_fx":
            r = jsonify(
                {
                    "ok": False,
                    "error": "missing_fx_csv",
                    "pair": emb.get("pair", pair),
                    "path": emb.get("fx_path", str(_fx_csv_path(pair))),
                }
            )
            r.headers["Access-Control-Allow-Origin"] = "*"
            return r, 404
        if reason == "zero_pct":
            r = jsonify({"ok": False, "error": "zero_hedge_pct"})
            r.headers["Access-Control-Allow-Origin"] = "*"
            return r, 400

    k15 = emb["cap15"]
    out_max100 = None
    if emb.get("cap15_max100") is not None:
        k100 = emb["cap15_max100"]
        out_max100 = {
            "cagr": k100.cagr,
            "volatility": k100.volatility,
            "sharpe": k100.sharpe,
            "max_drawdown": k100.max_drawdown,
            "total_return": k100.total_return,
        }

    r = jsonify(
        {
            "ok": True,
            "profile": profile_key,
            "pair": emb["pair"],
            "hedge_pct": emb["hedge_pct"],
            "cap15": {
                "cagr": k15.cagr,
                "volatility": k15.volatility,
                "sharpe": k15.sharpe,
                "max_drawdown": k15.max_drawdown,
                "total_return": k15.total_return,
            },
            "cap15_max100": out_max100,
        }
    )
    r.headers["Access-Control-Allow-Origin"] = "*"
    return r


@app.get("/api/kpis")
def api_kpis():
    """JSON para o dashboard Next (CORS aberto em GET)."""
    model_key = request.args.get("model", "v5_overlay_cap15_max100exp").strip()
    profile_key = normalize_risk_profile_key(request.args.get("profile", "moderado"))
    if model_key not in MODEL_PATHS:
        r = jsonify({"ok": False, "error": "unknown_model"})
        r.headers["Access-Control-Allow-Origin"] = "*"
        return r, 400
    kpis = try_model_kpis_for_profile(model_key, profile_key)
    if kpis is None:
        r = jsonify({"ok": False, "error": "missing_equity_csv"})
        r.headers["Access-Control-Allow-Origin"] = "*"
        return r, 404
    r = jsonify(
        {
            "ok": True,
            "model": model_key,
            "label": MODEL_LABELS.get(model_key, model_key),
            "profile": profile_key,
            "cagr": kpis.cagr,
            "volatility": kpis.volatility,
            "sharpe": kpis.sharpe,
            "max_drawdown": kpis.max_drawdown,
            "total_return": kpis.total_return,
        }
    )
    r.headers["Access-Control-Allow-Origin"] = "*"
    return r


@app.get("/api/equity_series_for_simulator")
def api_equity_series_for_simulator():
    """Séries completas para o simulador (perfil independente do selector do topo)."""
    profile_key = normalize_risk_profile_key(request.args.get("profile", "moderado"))
    cap15_only = _truthy_query_param(request.args.get("cap15_only"))
    client_embed = _truthy_query_param(request.args.get("client_embed"))
    if cap15_only:
        model_key = "v5_overlay_cap15_max100exp"
    else:
        model_key = request.args.get("model", "v5_overlay").strip()
        if model_key not in MODEL_PATHS:
            r = jsonify({"ok": False, "error": "unknown_model"})
            r.headers["Access-Control-Allow-Origin"] = "*"
            return r, 400
    force_synthetic = kpi_force_synthetic_vol(client_embed=client_embed)
    bundle = equity_series_bundle_for_simulator(
        model_key,
        profile_key,
        force_synthetic_profile_vol=force_synthetic,
        client_embed=client_embed,
    )
    if bundle is None:
        r = jsonify({"ok": False, "error": "missing_equity_csv"})
        r.headers["Access-Control-Allow-Origin"] = "*"
        return r, 404
    r = jsonify(bundle)
    r.headers["Access-Control-Allow-Origin"] = "*"
    return r


@app.get("/api/diagnostics-rolling")
def api_diagnostics_rolling():
    """
    Mesmo pacote JSON que o separador «Diagnóstico (rolling)» na página KPI avançada:
    séries rolling, persistência spread / Sharpe rel., early→late, veredito, subperíodos, regimes, hints.

    Parâmetros (alinhados a `/api/equity_series_for_simulator`):
    - `profile`: conservador | moderado | dinamico (default moderado)
    - `cap15_only=1`: força modelo `v5_overlay_cap15_max100exp`
    - `model`: chave em MODEL_PATHS se `cap15_only` está off (default `v5_overlay`)
    - `client_embed=1`: mesma regra de vol que o iframe (`kpi_force_synthetic_vol`)
    """
    cap15_only = _truthy_query_param(request.args.get("cap15_only"))
    client_embed = _truthy_query_param(request.args.get("client_embed"))
    if cap15_only:
        model_key = "v5_overlay_cap15_max100exp"
    else:
        model_key = (request.args.get("model") or "v5_overlay").strip()
    profile_key = normalize_risk_profile_key(request.args.get("profile") or "moderado")
    if model_key not in MODEL_PATHS:
        r = jsonify({"ok": False, "error": "unknown_model", "model": model_key})
        r.headers["Access-Control-Allow-Origin"] = "*"
        return r, 400

    force_synthetic = kpi_force_synthetic_vol(client_embed=client_embed)
    tup = load_scaled_model_equity_series(
        model_key,
        profile_key,
        client_embed=client_embed,
        force_synthetic_profile_vol=force_synthetic,
    )
    if tup is None:
        r = jsonify(
            {
                "ok": False,
                "error": "missing_equity_csv",
                "model": model_key,
                "profile": profile_key,
            }
        )
        r.headers["Access-Control-Allow-Origin"] = "*"
        return r, 404
    model_eq, dates, bench_eq = tup
    if bench_eq is None:
        r = jsonify(
            {
                "ok": False,
                "error": "missing_benchmark_csv",
                "model": model_key,
                "profile": profile_key,
            }
        )
        r.headers["Access-Control-Allow-Origin"] = "*"
        return r, 404

    base_path = MODEL_PATHS[model_key]
    num_years = len(model_eq) / TRADING_DAYS_PER_YEAR
    rebalance_info = load_rebalance_info(model_key, base_path, num_years=num_years)

    try:
        diag = compute_model_degradation_diagnostics(
            model_eq, bench_eq, dates, rebalance_info=rebalance_info
        )
    except Exception as exc:
        r = jsonify(
            {
                "ok": False,
                "error": "diagnostics_failed",
                "message": str(exc),
                "model": model_key,
                "profile": profile_key,
            }
        )
        r.headers["Access-Control-Allow-Origin"] = "*"
        return r, 500

    bundle = {
        "ok": bool(diag.get("ok")),
        "model": model_key,
        "model_label": MODEL_LABELS.get(model_key, model_key),
        "profile": profile_key,
        "cap15_only": cap15_only,
    }
    bundle.update(diag)
    r = jsonify(_json_sanitize_diag_api(bundle))
    r.headers["Access-Control-Allow-Origin"] = "*"
    return r


if __name__ == "__main__":
    _de = _smooth_data_end_date(REPO_ROOT)
    print(
        f"[kpi_server] Arranque: build={KPI_SERVER_BUILD_TAG!r} repo_root={REPO_ROOT!s} "
        f"smooth_data_end={_de.isoformat() if _de else '—'} — "
        f"GET /api/health inclui kpi_repo_root e smooth_plafonado_data_end.",
        file=sys.stderr,
        flush=True,
    )
    # Render / Docker: variável PORT e escuta em 0.0.0.0 (127.0.0.1 só aceita ligações locais → proxy Render não liga).
    _port = int(os.environ.get("PORT", "5000"))
    _host = os.environ.get("KPI_BIND_HOST") or (
        "0.0.0.0" if os.environ.get("RENDER") else "127.0.0.1"
    )
    _debug = os.environ.get("FLASK_DEBUG", "").lower() in ("1", "true", "yes")
    app.run(host=_host, port=_port, debug=_debug)

