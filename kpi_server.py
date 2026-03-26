from __future__ import annotations

from math import sqrt
from pathlib import Path
import json
import os

import numpy as np
import pandas as pd
from flask import Flask, jsonify, render_template_string, request

TRADING_DAYS_PER_YEAR = 252

# Sharpe “clássico”: retornos diários em excesso da taxa livre de risco, anualizado com √252.
# Em papers de factor / comparação de estratégias usa-se muitas vezes rf=0; fundos e relatórios
# institucionais costumam usar T-Bills (ex. ~2–5% anual conforme o período). Override: env DECIDE_KPI_RISK_FREE_ANNUAL=0.04
try:
    RISK_FREE_ANNUAL = float(os.environ.get("DECIDE_KPI_RISK_FREE_ANNUAL", "0"))
except ValueError:
    RISK_FREE_ANNUAL = 0.0

REPO_ROOT = Path(__file__).resolve().parent
BACKEND_META_PATH = REPO_ROOT / "backend" / "data" / "company_meta_global_enriched.csv"

MODEL_PATHS = {
    "v5": REPO_ROOT / "freeze" / "DECIDE_MODEL_V5" / "model_outputs",
    "v5_constrained": REPO_ROOT / "freeze" / "DECIDE_MODEL_V5_CONSTRAINED_GLOBAL" / "model_outputs",
    "v5_overlay": REPO_ROOT / "freeze" / "DECIDE_MODEL_V5_OVERLAY" / "model_outputs",
    "v5_overlay_cap15": REPO_ROOT / "freeze" / "DECIDE_MODEL_V5_OVERLAY_CAP15" / "model_outputs",
    "v5_overlay_cap15_max100exp": REPO_ROOT
    / "freeze"
    / "DECIDE_MODEL_V5_OVERLAY_CAP15_MAX100EXP"
    / "model_outputs",
}
MODEL_LABELS = {
    "v5": "V5",
    "v5_constrained": "V5 Constrained (US≈60% / setores≈bench, in-motor)",
    "v5_overlay": "V5 Overlay (US≈60% / países+setores)",
    "v5_overlay_cap15": "V5 Overlay (estratégia cliente)",
    "v5_overlay_cap15_max100exp": "V5 Overlay (exposição plafonada)",
}

# Modelos com v5_kpis.json no freeze (sleeve / meta)
V5_KPI_JSON_MODEL_KEYS = (
    "v5",
    "v5_constrained",
    "v5_overlay",
    "v5_overlay_cap15",
    "v5_overlay_cap15_max100exp",
)

# Frontend Next.js base URL (para links rápidos no dashboard Flask)
# Ex.: http://127.0.0.1:4701
FRONTEND_URL = (os.environ.get("FRONTEND_URL") or "http://127.0.0.1:4701").rstrip("/")
# Perfil = só vol target realizado: 0.75× (conservador), 1× (moderado), 1.25× (dinâmico)
PROFILE_OPTIONS = [
    ("conservador", "Conservador (0.75× vol)"),
    ("moderado", "Moderado (1× vol)"),
    ("dinamico", "Dinâmico (1.25× vol)"),
]
PROFILE_VOL_MULTIPLIER = {"conservador": 0.75, "moderado": 1.0, "dinamico": 1.25}


def scale_model_equity_to_profile_vol(
    model_eq: pd.Series,
    bench_eq: pd.Series,
    profile_key: str,
    *,
    has_profile_file: bool,
) -> pd.Series:
    """
    Quando não existe CSV dedicado por perfil, escala retornos diários para que a vol
    anual da curva fique ≈ multiplier × vol do benchmark (0.75 / 1 / 1.25).
    Moderado = 1× vol do benchmark (alinhado à landing, que igual modelo ao bench em risco).
    Com ficheiro `model_equity_final_20y_{perfil}.csv`, a série mantém-se (assume gerada offline).
    """
    if has_profile_file:
        return model_eq.astype(float)
    mult = PROFILE_VOL_MULTIPLIER.get(profile_key, 1.0)
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
            if m_vol > 0 and b_vol > 0:
                target_vol = mult * b_vol
                scale = target_vol / m_vol
                ret_scaled = m_ret * scale
                eq_new = model_eq.copy()
                for i in range(1, len(eq_new)):
                    eq_new.iloc[i] = eq_new.iloc[i - 1] * (1.0 + float(ret_scaled.iloc[i - 1]))
                return eq_new
    return model_eq.astype(float)


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
    <title>DECIDE</title>
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <style>
      :root{
        --bg0:#020617;
        --bg1:#04102a;
        --card:#071120;
        --border:#1b2840;
        --text:#e5e7eb;
        --muted:#a0aec0;
        --muted2:#7b8798;
        --good:#16a34a;
        --bad:#dc2626;
        --accent:#3b82f6;
        --shadow: 0 10px 35px rgba(0,0,0,.45);
      }
      *{ box-sizing:border-box; }
      body{
        font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        margin: 0;
        background:
          radial-gradient(1200px 800px at 10% -20%, rgba(30,64,175,.20), transparent 62%),
          radial-gradient(1000px 700px at 100% 0%, rgba(37,99,235,.12), transparent 58%),
          radial-gradient(900px 600px at 50% 110%, rgba(14,165,233,.06), transparent 55%),
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
        background: linear-gradient(90deg, rgba(5,8,22,.96), rgba(7,17,35,.96));
        border-bottom: 1px solid rgba(27,40,64,.9);
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
        background: rgba(9,16,31,.96);
        color: var(--text);
        border: 1px solid rgba(27,40,64,.95);
        border-radius: 999px;
        padding: 8px 14px;
        font-size: .9rem;
        outline: none;
      }
      select:focus{ border-color: rgba(96,165,250,.9); box-shadow: 0 0 0 3px rgba(96,165,250,.15); }
      h2{
        margin-top: 32px;
        margin-bottom: 14px;
        font-size: 1.02rem;
        color: #d9e2ef;
      }
      .tabs{
        display:flex;
        gap: 14px;
        margin-top: 4px;
        margin-bottom: 6px;
        padding: 12px 0 16px;
        border-bottom: 2px solid rgba(59,130,246,.4);
        flex-wrap: wrap;
        align-items: center;
      }
      .tab{
        padding: 14px 26px;
        border-radius: 14px;
        border: 2px solid rgba(59,130,246,.45);
        cursor: pointer;
        font-size: 1.08rem;
        font-weight: 800;
        letter-spacing: .04em;
        color: #bfdbfe;
        background: rgba(15,23,42,.92);
        box-shadow: 0 4px 16px rgba(0,0,0,.35);
        transition: border-color .15s, color .15s, background .15s, box-shadow .15s;
      }
      .tab:hover{
        color: #fff;
        border-color: rgba(96,165,250,.95);
        background: rgba(30,58,138,.55);
        box-shadow: 0 6px 20px rgba(37,99,235,.2);
      }
      .tab.active{
        background: linear-gradient(180deg, #2563eb 0%, #1d4ed8 100%);
        color: #fff;
        border-color: #93c5fd;
        box-shadow: 0 0 0 4px rgba(37,99,235,.28), 0 10px 28px rgba(29,78,216,.35);
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
        background: linear-gradient(180deg, rgba(10,18,36,.98) 0%, rgba(5,10,24,.98) 100%);
        padding: 20px 20px;
        border-radius: 18px;
        border: 1px solid rgba(59,130,246,.18);
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
      .value{ font-size: 1.65rem; font-weight: 700; margin-top: 6px; }
      .value.positive{ color: var(--good); }
      .value.negative{ color: var(--bad); }
      .kpi-line{ margin-top: 8px; font-size: 1.05rem; font-weight: 650; line-height: 1.35; color: #dbe7fb; }
      .muted{ color: var(--muted2); font-size: .82rem; margin-top: 6px; }
      .pill{
        display:inline-flex;
        align-items:center;
        gap: 6px;
        padding: 4px 10px;
        border-radius: 999px;
        background: rgba(8,14,28,.9);
        border: 1px solid rgba(59,130,246,.16);
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
        border: 1px solid rgba(59,130,246,.18);
        background: linear-gradient(180deg, rgba(10,18,36,.98) 0%, rgba(5,10,24,.98) 100%);
        color: var(--text);
        font-size: .82rem;
        text-decoration:none;
      }
      .chip:hover{ border-color: rgba(96,165,250,.85); box-shadow: 0 0 0 3px rgba(96,165,250,.12); }
      .stats-grid{ display:grid; grid-template-columns: repeat(12, 1fr); gap: 14px; margin-top: 16px; }
      .stat-box{ grid-column: span 4; background: linear-gradient(180deg, rgba(10,18,36,.98) 0%, rgba(5,10,24,.98) 100%); padding: 14px 16px; border-radius: 16px; border: 1px solid rgba(59,130,246,.18); }
      @media (max-width: 920px){ .stat-box{ grid-column: span 6; } }
      @media (max-width: 560px){ .stat-box{ grid-column: span 12; } }
      .stat-box .label{ font-size: .72rem; }
      .stat-box .num{ font-size: 1.05rem; font-weight: 700; margin-top: 2px; }
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
        border-bottom: 1px solid rgba(27,40,64,.55);
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
      table{ border-collapse: collapse; margin-top: 16px; width: 100%; background: rgba(9,16,31,.96); border-radius: 16px; overflow: hidden; border: 1px solid rgba(27,40,64,.95); }
      th, td{ padding: 11px 14px; text-align: right; }
      th{ background: rgba(11,18,32,.9); font-weight: 650; font-size: .72rem; color: var(--muted); letter-spacing: .02em; text-transform: uppercase; }
      tr:hover td{ background: rgba(96,165,250,.06); }
      /* Carteira: linhas alternadas mais legíveis */
      #tab-portfolio table tbody tr:nth-child(odd) td{
        background: rgba(15,23,42,.45);
      }
      #tab-portfolio table tbody tr:nth-child(even) td{
        background: rgba(148,163,184,.11);
      }
      #tab-portfolio table tbody tr:hover td{
        background: rgba(96,165,250,.14) !important;
      }
      td:first-child, th:first-child{ text-align: left; }
      canvas{ background: rgba(9,16,31,.96); border-radius: 18px; padding: 14px; border: 1px solid rgba(27,40,64,.95); box-shadow: var(--shadow); }

      /* Clique no painel → ecrã inteiro; «Diminuir» ou Esc para sair */
      .kpi-chart-panel--zoomable {
        position: relative;
        cursor: zoom-in;
      }
      .kpi-chart-panel--zoomable:fullscreen {
        cursor: default;
        background: #020b24;
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
        background: #020b24;
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
        border-color: rgba(96,165,250,0.85);
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
        background: rgba(9,16,31,.96);
        border-radius: 16px;
        border: 1px solid rgba(27,40,64,.95);
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
        background: #0f172a;
        border: 1px solid rgba(31,41,55,.9);
        overflow: hidden;
      }
      .breakdown-bar-fill{
        height: 100%;
        width: 0%;
        background: linear-gradient(90deg, rgba(63,115,255,.95), rgba(59,130,246,.60));
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
      /* 2 cartões (modelo + bench): metade cada; 3 cartões (+ plafonado): 4+4+4 */
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
        border: 1px solid rgba(59,130,246,.22);
        background: rgba(15,23,42,.55);
        font-size: .78rem;
        line-height: 1.55;
        color: #94a3b8;
      }
      body.decide-kpi-simple .kpi-simple-summary { display: block !important; }
      .kpi-view-toggle-wrap {
        display: none;
        align-items: stretch;
        gap: 0;
        flex-wrap: nowrap;
        margin: 6px 0 10px;
        border-radius: 12px;
        border: 1px solid rgba(59,130,246,.38);
        overflow: hidden;
        background: rgba(15,23,42,.9);
        width: fit-content;
        max-width: 100%;
      }
      body.decide-kpi-embed .kpi-view-toggle-wrap { display: inline-flex; }
      .kpi-view-btn{
        padding: 8px 16px;
        border-radius: 0;
        border: none;
        border-right: 1px solid rgba(59,130,246,.22);
        background: transparent;
        color: #94a3b8;
        font-size: .78rem;
        font-weight: 800;
        cursor: pointer;
        font-family: inherit;
      }
      .kpi-view-btn:last-child{ border-right: none; }
      .kpi-view-btn.active{
        color: #f0f9ff;
        background: rgba(37,99,235,.5);
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
      /* Modo embutido (dashboard Next): cabeçalho e tabs mais baixos para KPIs/gráficos aparecerem cedo */
      .container{ max-width: 100%; padding: 8px 12px 24px; }
      .topbar{ position: relative; }
      .topbar-inner{ padding: 6px 12px; gap: 8px; }
      .brand{ min-width: 0; gap: 8px; }
      .subtitle{ font-size: .65rem; margin-top: 0; max-width: 100%; line-height: 1.25; }
      .controls{ gap: 6px 10px; }
      .control{ font-size: .7rem; gap: 6px; }
      select{ padding: 4px 10px; font-size: .78rem; }
      .tab-nav-label{ margin-bottom: 0; font-size: .62rem; }
      .tabs{ padding: 4px 0 6px; margin-top: 2px; margin-bottom: 2px; gap: 6px; }
      .tab{ padding: 6px 11px; font-size: .78rem; border-radius: 10px; border-width: 1px; }
      .tab.active{
        box-shadow: 0 0 0 2px rgba(37,99,235,.22), 0 5px 14px rgba(29,78,216,.28);
      }
      h2{ margin-top: 12px; margin-bottom: 6px; font-size: .85rem; }
      .grid{ margin-top: 6px; gap: 8px; }
      .card{ padding: 10px 12px; border-radius: 14px; }
      .value{ font-size: 1.15rem; margin-top: 4px; }
      .kpi-line{ margin-top: 5px; font-size: .92rem; }
      .tab-content{ padding-top: 10px; }
      body.decide-kpi-embed #tab-horizons .horizon-intro-one-line{
        overflow-x: auto !important;
        overflow-y: hidden !important;
      }
      body.decide-kpi-embed #tab-horizons .horizon-intro-inner{
        white-space: nowrap !important;
        width: max-content;
        max-width: none;
      }
      /* Gráficos (aba «Gráficos»): 2×2 compacto para caber no iframe do dashboard */
      #tab-charts .kpi-charts-inner--embed {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 10px 12px;
        margin-top: 0.5rem;
      }
      @media (max-width: 720px) {
        #tab-charts .kpi-charts-inner--embed {
          grid-template-columns: 1fr;
        }
      }
      body.decide-kpi-embed #tab-charts .kpi-chart-panel {
        position: relative;
        height: clamp(232px, 30vh, 288px);
        min-height: 0;
        display: flex;
        flex-direction: column;
      }
      body.decide-kpi-embed #tab-charts .kpi-chart-panel .label {
        font-size: 0.68rem;
        flex-shrink: 0;
      }
      body.decide-kpi-embed #tab-charts .kpi-chart-panel canvas {
        flex: 1 1 auto;
        min-height: 0;
        max-height: 100%;
      }
      body.decide-kpi-embed #tab-simulator .kpi-chart-panel--sim {
        position: relative;
        height: clamp(232px, 32vh, 320px);
        min-height: 0;
        display: flex;
        flex-direction: column;
        margin-top: 0.75rem;
      }
      body.decide-kpi-embed #tab-simulator .kpi-chart-panel--sim canvas {
        flex: 1 1 auto;
        min-height: 0;
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
        color: #93c5fd;
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
        background: rgba(15,23,42,.55);
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
        background: rgba(2,8,22,0.94);
        border: 2px solid rgba(96,165,250,0.65);
        color: #fff;
        box-shadow: 0 4px 24px rgba(37,99,235,0.12);
      }
      .sim-row-actions .sim-years-label input{
        background: rgba(8,15,35,0.92);
        border: 2px solid rgba(96,165,250,0.5);
        color: #f8fafc;
        box-shadow: 0 4px 20px rgba(37,99,235,0.1);
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
        background: linear-gradient(180deg,#3b82f6,#2563eb);
        color:#fff;
        border:1px solid rgba(147,197,253,0.35);
        border-radius:12px;
        padding: 0 20px;
        font-weight:900;
        font-size: clamp(14px, 1.35vw, 16px);
        line-height: 1.2;
        cursor:pointer;
        letter-spacing: -0.01em;
        box-shadow: 0 10px 32px rgba(37,99,235,.28);
        white-space: nowrap;
        box-sizing: border-box;
      }
      #simRunBtn:hover{ filter: brightness(1.07); box-shadow: 0 12px 36px rgba(37,99,235,.5), 0 0 0 1px rgba(96,165,250,.35); }
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
        background: rgba(147,197,253,.85);
        cursor: help;
        vertical-align: middle;
        line-height: 1;
      }
      .sim-example-hint{
        font-size: 0.88rem;
        color: #bfdbfe;
        font-weight: 700;
        margin: 0 0 14px;
        padding: 12px 14px;
        border-radius: 12px;
        background: rgba(59,130,246,.22);
        border: 1px solid rgba(147,197,253,.38);
        box-shadow: 0 4px 20px rgba(37,99,235,.12);
      }
      .sim-results-hero{
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
        gap: 14px;
        margin-bottom: 10px;
      }
      .sim-emotional-line{
        text-align: center;
        font-size: 0.95rem;
        font-weight: 600;
        font-style: italic;
        color: #cbd5e1;
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
        background: linear-gradient(165deg, rgba(34,197,94,.26), rgba(15,23,42,.94));
        border-color: rgba(74,222,128,.55);
        box-shadow: 0 0 52px rgba(34,197,94,.2), 0 0 0 1px rgba(74,222,128,.15);
      }
      .sim-hero-bench{
        background: rgba(15,23,42,.75);
        border-color: rgba(56,189,248,.28);
      }
      .sim-big-value{
        font-size: clamp(1.55rem, 4.8vw, 2.35rem);
        font-weight: 900;
        letter-spacing: -0.03em;
        line-height: 1.08;
        margin-top: 8px;
        color: #d1fae5;
        text-shadow: 0 0 36px rgba(74,222,128,.45), 0 0 60px rgba(34,197,94,.2);
      }
      .sim-delta-line{
        text-align: center;
        font-size: clamp(1.08rem, 2.6vw, 1.22rem);
        font-weight: 900;
        color: #bbf7d0;
        margin: 0 0 14px;
        padding: 14px 16px;
        border-radius: 16px;
        background: linear-gradient(180deg, rgba(22,163,74,.32), rgba(22,163,74,.12));
        border: 1px solid rgba(74,222,128,.5);
        line-height: 1.4;
        letter-spacing: -0.02em;
        box-shadow: 0 0 0 1px rgba(74,222,128,.12), 0 0 28px rgba(34,197,94,.35), 0 0 48px rgba(74,222,128,.18);
        text-shadow: 0 0 22px rgba(74,222,128,.55), 0 0 40px rgba(34,197,94,.25);
      }
      .sim-big-value-bench{
        color: #7dd3fc;
        text-shadow: 0 0 22px rgba(56,189,248,.2);
      }
      .sim-window-card .num{ font-size: .88rem !important; color: #cbd5e1 !important; }
      #simCtaBlock{
        margin-top: 22px;
        padding: 20px 18px;
        border-radius: 16px;
        background: linear-gradient(145deg, rgba(30,58,138,.35), rgba(15,23,42,.9));
        border: 1px solid rgba(251,146,60,.35);
        text-align: center;
      }
      #simCtaBlock p{
        margin: 0 0 14px;
        font-size: 1rem;
        font-weight: 700;
        color: #e2e8f0;
        line-height: 1.45;
      }
      #simCtaLink{
        display: inline-block;
        background: linear-gradient(180deg,#fdba74 0%,#f97316 45%,#ea580c 100%);
        color: #0f172a;
        font-weight: 900;
        font-size: .95rem;
        padding: 14px 28px;
        border-radius: 14px;
        text-decoration: none;
        border: 1px solid rgba(255,237,213,.55);
        box-shadow: 0 0 0 1px rgba(251,146,60,.4), 0 0 28px rgba(249,115,22,.45), 0 14px 36px rgba(234,88,12,.4);
      }
      #simCtaLink:hover{ filter: brightness(1.05); }
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
  <body{% if client_embed %} class="decide-kpi-embed decide-kpi-simple{% if tab_default == 'simulator' %} decide-kpi-start-sim{% endif %}"{% endif %}>
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
        <a class="chip" href="{{ frontend_url }}/client-dashboard" target="_blank" rel="noreferrer" style="border-color:#60a5fa;color:#e0f2fe;font-weight:600;">Dashboard Cliente</a>
        <a class="chip" href="{{ frontend_url }}/fees-client" target="_blank" rel="noreferrer">Fees Client</a>
        <a class="chip" href="{{ frontend_url }}/fees-business" target="_blank" rel="noreferrer">Fees Business</a>
        <a class="chip" href="{{ frontend_url }}/onboarding" target="_blank" rel="noreferrer">Onboarding</a>
        <a class="chip" href="{{ frontend_url }}/mifid-test" target="_blank" rel="noreferrer">Teste MiFID</a>
      </div>
    </div>
    {% endif %}

    <div class="tab-nav-label">Conteúdo do dashboard</div>
    {% if client_embed %}
    <div class="kpi-view-toggle-wrap" role="group" aria-label="Modo de visualização">
      <button type="button" class="kpi-view-btn active" data-kpi-view="simple">Simples</button>
      <button type="button" class="kpi-view-btn" data-kpi-view="advanced">Avançado</button>
    </div>
    {% endif %}
    <div class="tabs" role="tablist" aria-label="Secções do dashboard">
      <button type="button" class="tab{% if tab_default == 'overview' %} active{% endif %}" data-tab="overview" role="tab" aria-selected="{% if tab_default == 'overview' %}true{% else %}false{% endif %}">KPIs</button>
      <button type="button" class="tab{% if tab_default == 'horizons' %} active{% endif %}" data-tab="horizons" role="tab" aria-selected="{% if tab_default == 'horizons' %}true{% else %}false{% endif %}">Retornos YTD · 1Y · 5Y · 10Y</button>
      <button type="button" class="tab{% if tab_default == 'simulator' %} active{% endif %}" data-tab="simulator" role="tab" aria-selected="{% if tab_default == 'simulator' %}true{% else %}false{% endif %}">Simulador</button>
      <button type="button" class="tab{% if tab_default == 'charts' %} active{% endif %}" data-tab="charts" role="tab" aria-selected="{% if tab_default == 'charts' %}true{% else %}false{% endif %}">Gráficos</button>
      <button type="button" class="tab{% if tab_default == 'portfolio' %} active{% endif %}" data-tab="portfolio" role="tab" aria-selected="{% if tab_default == 'portfolio' %}true{% else %}false{% endif %}">Carteira</button>
      <button type="button" class="tab{% if tab_default == 'portfolio_history' %} active{% endif %}" data-tab="portfolio_history" role="tab" aria-selected="{% if tab_default == 'portfolio_history' %}true{% else %}false{% endif %}">Histórico de decisões</button>
      <button type="button" class="tab{% if tab_default == 'faq' %} active{% endif %}" data-tab="faq" role="tab" aria-selected="{% if tab_default == 'faq' %}true{% else %}false{% endif %}">FAQs</button>
    </div>

    <!-- ABA 1: OVERVIEW KPIs -->
    <div id="tab-overview" class="tab-content{% if tab_default == 'overview' %} active{% endif %}">
      <div class="grid{% if compare_cap100_kpis %} grid-has-plafonada{% endif %}">
        <div class="card {{ 'col-3' if compare_cap100_kpis else 'col-4' }} kpi-advanced-only">
          <div class="label">Modelo base (não ajustado a risco)</div>
          <div class="value positive">{{ (raw_kpis.cagr * 100) | round(2) }}% <span class="muted" style="font-size:0.75rem;">CAGR</span></div>
          <div class="kpi-line">Vol {{ (raw_kpis.volatility * 100) | round(2) }}%</div>
          <div class="kpi-line">Sharpe {{ raw_kpis.sharpe | round(2) }}</div>
          <div class="kpi-line value negative">Max DD {{ (raw_kpis.max_drawdown * 100) | round(2) }}%</div>
          <div class="muted">Total return {{ raw_kpis.total_return | round(2) }}x</div>
          <div class="muted" style="margin-top:12px; padding-top:10px; border-top:1px solid rgba(59,130,246,.22); font-size:0.72rem; line-height:1.45; color:#9ca3af;">
            <strong style="color:#cbd5e1;">O que é:</strong> desempenho da carteira/curva <strong>antes</strong> de regras de overlay, limites de drawdown (cap), vol-matching e outras molduras aplicadas ao “Modelo” apresentado ao cliente. Serve de base técnica para ver o efeito das camadas de risco em cima do motor.
          </div>
        </div>
        <div class="card {{ 'col-3' if compare_cap100_kpis else 'col-4' }} kpi-main-compare">
          <div class="label">{% if current_model == 'v5_overlay_cap15' %}Modelo CAP15 (risco nativo){% else %}Modelo (estratégia apresentada){% endif %}</div>
          <div class="value positive">{{ (model_kpis.cagr * 100) | round(2) }}% <span class="muted" style="font-size:0.75rem;">CAGR</span></div>
          <div class="kpi-line kpi-advanced-only">Vol {{ (model_kpis.volatility * 100) | round(2) }}%</div>
          <div class="kpi-line kpi-advanced-only">Sharpe {{ model_kpis.sharpe | round(2) }}</div>
          <div class="kpi-line value negative">Max DD {{ (model_kpis.max_drawdown * 100) | round(2) }}%</div>
          <div class="muted kpi-advanced-only">Total return {{ model_kpis.total_return | round(2) }}x</div>
          {% if current_model == 'v5_overlay_cap15' %}
          <div class="muted kpi-advanced-only" style="margin-top:12px; padding-top:10px; border-top:1px solid rgba(59,130,246,.22); font-size:0.72rem; line-height:1.45; color:#9ca3af;">
            <strong style="color:#cbd5e1;">O que é:</strong> desempenho da curva <strong>CAP15</strong> no freeze com <strong>volatilidade nativa</strong> da estratégia (sem reescalar ao benchmark — possível utilização de margem). Compara retorno e risco no estado «real» da estratégia apresentada. Não é aconselhamento.
          </div>
          {% endif %}
        </div>
        {% if compare_cap100_kpis %}
        <div class="card col-3 kpi-main-compare">
          <div class="label">Modelo plafonado (≤100% investido)</div>
          <div class="value positive">{{ (compare_cap100_kpis.cagr * 100) | round(2) }}% <span class="muted" style="font-size:0.75rem;">CAGR</span></div>
          <div class="kpi-line kpi-advanced-only">Vol {{ (compare_cap100_kpis.volatility * 100) | round(2) }}%</div>
          <div class="kpi-line kpi-advanced-only">Sharpe {{ compare_cap100_kpis.sharpe | round(2) }}</div>
          <div class="kpi-line value negative">Max DD {{ (compare_cap100_kpis.max_drawdown * 100) | round(2) }}%</div>
          <div class="muted kpi-advanced-only">Total return {{ compare_cap100_kpis.total_return | round(2) }}x</div>
          <div class="muted kpi-advanced-only" style="margin-top:12px; padding-top:10px; border-top:1px solid rgba(59,130,246,.22); font-size:0.72rem; line-height:1.45; color:#9ca3af;">
            <strong style="color:#cbd5e1;">Nota:</strong> exposição a risco limitada a <strong>100%</strong> do NAV (sem alavancagem além do capital).
            {% if current_profile == 'moderado' %}
            A <strong>volatilidade</strong> desta série foi <strong>ajustada para igualar à do mercado de referência</strong> (perfil moderado), o mesmo critério da landing pública.
            {% elif current_profile == 'conservador' %}
            A volatilidade foi ajustada para ≈ <strong>0,75×</strong> a vol do benchmark (perfil conservador).
            {% else %}
            A volatilidade foi ajustada para ≈ <strong>1,25×</strong> a vol do benchmark (perfil dinâmico).
            {% endif %}
            Não é aconselhamento.
          </div>
        </div>
        {% endif %}
        <div class="card {{ 'col-3' if compare_cap100_kpis else 'col-4' }} kpi-main-compare">
          <div class="label">Benchmark</div>
          <div class="value positive">{{ (bench_kpis.cagr * 100) | round(2) }}% <span class="muted" style="font-size:0.75rem;">CAGR</span></div>
          <div class="kpi-line kpi-advanced-only">Vol {{ (bench_kpis.volatility * 100) | round(2) }}%</div>
          <div class="kpi-line kpi-advanced-only">Sharpe {{ bench_kpis.sharpe | round(2) }}</div>
          <div class="kpi-line value negative">Max DD {{ (bench_kpis.max_drawdown * 100) | round(2) }}%</div>
          <div class="muted kpi-advanced-only">Total return {{ bench_kpis.total_return | round(2) }}x</div>
          <div class="muted kpi-advanced-only" style="margin-top:12px; padding-top:10px; border-top:1px solid rgba(59,130,246,.22); font-size:0.72rem; line-height:1.45; color:#9ca3af;">
            <strong style="color:#cbd5e1;">O que é:</strong> referência <strong>passiva</strong> (série histórica em <code style="color:#e5e7eb;font-size:0.68rem;">{{ bench_path.name }}</code>) usada para comparar o modelo: retorno, risco, meses acima/abaixo e alpha rolling. Não é recomendação nem produto investível — é só o “termómetro” de comparação no mesmo horizonte temporal.
          </div>
        </div>
      </div>

      <div class="kpi-simple-summary">
        {% if cap15_only %}
        <strong style="color:#e5e7eb;">CAP15</strong> com <strong style="color:#e5e7eb;">risco nativo</strong> (margem possível).
        <strong style="color:#e5e7eb;">Modelo plafonado</strong> (≤100% NV) com vol <strong>ajustada ao benchmark</strong> no perfil seleccionado
        (<strong>igual à do bench no moderado</strong>, como na landing). O benchmark mantém a sua vol de mercado.
        {% else %}
        Comparação em horizonte longo com <strong style="color:#e5e7eb;">volatilidade alinhada ao benchmark</strong> (0,75× / 1× / 1,25× conforme o perfil).
        <strong style="color:#e5e7eb;">CAGR</strong> e <strong style="color:#e5e7eb;">queda máxima</strong> lado a lado com o benchmark{% if compare_cap100_kpis %} e com o <strong style="color:#e5e7eb;">modelo plafonado</strong>{% endif %}.
        {% endif %}
        Para simular capital ao longo do tempo (com o seu perfil), abra <strong style="color:#93c5fd;">Simulador</strong>.
        Para curvas completas e drawdowns, abra <strong style="color:#93c5fd;">Gráficos</strong>.
        Informação indicativa — não é aconselhamento nem promessa de resultados futuros.
      </div>

      <div class="kpi-advanced-only">
      <h2>Indicadores mensais (modelo)</h2>
      <div class="stats-grid">
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
            <div class="muted">Baseado na exposição média a risco</div>
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
          <div class="pie-holder">
            <canvas id="countryTbillPie"></canvas>
          </div>
        </div>
      </div>

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

    <!-- ABA: RETORNOS (YTD, 1Y, 5Y, 10Y vs benchmark, escala log) -->
    <div id="tab-horizons" class="tab-content{% if tab_default == 'horizons' %} active{% endif %}">
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
    </div>

    <!-- ABA: SIMULADOR (perfil próprio; não altera o selector do topo) -->
    <div id="tab-simulator" class="tab-content{% if tab_default == 'simulator' %} active{% endif %}">
      <div id="simApiContext"
        data-cap15-only="{% if cap15_only %}1{% else %}0{% endif %}"
        data-client-embed="{% if client_embed %}1{% else %}0{% endif %}"
        data-model-key="{{ current_model }}"
        data-register-base="{{ frontend_url }}/client/register"
        style="display:none"
        aria-hidden="true"></div>
      <div class="card" style="margin-top:0.5rem;">
        <h2 class="sim-headline">Veja quanto poderia ter crescido o seu capital</h2>
        <p class="sim-lead">
          Ajuste o valor e veja o impacto.
          <span class="sim-info-tip" title="Valores baseados em histórico. O nível de risco desta simulação não altera o selector do topo.{% if show_max100_compare %} Com CAP15, a curva do modelo é a DECIDE plafonada (≤100%% NV).{% endif %}">i</span>
        </p>
        <p class="sim-example-hint">
          <strong style="color:#fff;">Exemplo pré-preenchido:</strong>
          <strong style="color:#e0f2fe;">10 000 €</strong> durante <strong style="color:#e0f2fe;">20 anos</strong>.
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
            <input type="number" id="simCapital" min="5000" step="100" value="10000" inputmode="decimal" />
          </label>
          <label class="sim-years-label">
            Anos (desde o investimento)
            <input type="number" id="simYears" min="0.5" step="0.5" value="20" max="{{ num_years|round(3) }}" inputmode="decimal" />
          </label>
          <div class="sim-run-as-field">
            <span class="sim-run-spacer" aria-hidden="true">.</span>
            <button type="button" id="simRunBtn">Ver quanto teria hoje</button>
          </div>
        </div>
        <div id="simError" style="color:#f87171; margin-top:10px; font-size:0.82rem; display:none;"></div>
        <div id="simResults" style="display:none; margin-top:18px;">
          <div class="sim-results-hero">
            <div class="sim-hero-card sim-hero-model">
              <div class="label" id="simModelResultLabel">Modelo DECIDE (valor ilustrativo final)</div>
              <div class="sim-big-value" id="simEndModel">—</div>
            </div>
            <div class="sim-hero-card sim-hero-bench">
              <div class="label">Referência / benchmark (mesmo período)</div>
              <div class="sim-big-value sim-big-value-bench" id="simEndBench">—</div>
            </div>
          </div>
          <p class="sim-delta-line" id="simDeltaLine" style="display:none;" role="status"></p>
          <p class="sim-emotional-line">Uma diferença que só o tempo e a disciplina revelam.</p>
          <div class="stats-grid" style="margin-bottom:0;">
            <div class="stat-box sim-window-card">
              <div class="label">Janela simulada</div>
              <div class="num" id="simWindow">—</div>
            </div>
          </div>
          <div id="simCtaBlock" style="display:none;">
            <p>Quer começar agora com o seu capital?</p>
            <p class="sim-cta-micro" style="margin:0 0 12px; color:#cbd5e1;">Investimento mínimo <strong style="color:#e2e8f0;">5 000 €</strong>.</p>
            <a id="simCtaLink" href="{{ frontend_url }}/client/register" target="_blank" rel="noopener noreferrer">Começar com este valor</a>
            <p class="sim-cta-micro">Pode começar em poucos minutos.</p>
            <p class="sim-cta-micro">Comece hoje — decide sempre.</p>
          </div>
          <div class="{% if client_embed %}kpi-chart-panel kpi-chart-panel--sim{% endif %} kpi-chart-panel--zoomable" style="{% if not client_embed %}margin-top:1.1rem;{% endif %}" title="Clique para ver em ecrã inteiro">
            <button type="button" class="kpi-chart-fs-exit" aria-label="Diminuir gráfico">Diminuir</button>
            {% if client_embed %}
            <div class="label kpi-chart-title-simple">Evolução do seu capital (ilustrativo)</div>
            <div class="label kpi-chart-title-advanced">Evolução do capital (escala log)</div>
            <div class="muted kpi-chart-title-simple" style="font-size:0.72rem; margin-bottom:0.35rem;">Mesmo ponto de partida nos dois cenários; crescimento ao longo do tempo na janela escolhida.</div>
            <div class="muted kpi-chart-title-advanced" style="font-size:0.72rem; margin-bottom:0.35rem;">Mesmo ponto de partida nos dois cenários; crescimento composto ao longo dos dias úteis da janela.</div>
            {% else %}
            <div class="label">Evolução do capital (escala log)</div>
            <div class="muted" style="font-size:0.72rem; margin-bottom:0.35rem;">Mesmo ponto de partida nos dois cenários; crescimento composto ao longo dos dias úteis da janela.</div>
            {% endif %}
            <canvas id="simulatorChart" height="160"></canvas>
          </div>
          <p class="muted" style="font-size:0.7rem; line-height:1.45; margin:14px 0 0;">
            Valores indicativos com base em histórico — não constituem garantia nem aconselhamento; resultados futuros podem diferir materialmente.
          </p>
        </div>
      </div>
    </div>

    <!-- ABA 2: GRÁFICOS -->
    <div id="tab-charts" class="tab-content{% if tab_default == 'charts' %} active{% endif %}">
      <div class="kpi-charts-inner{% if client_embed %} kpi-charts-inner--embed{% endif %}" style="{% if not client_embed %}display:flex; flex-direction:column; gap:1.5rem; margin-top:0.5rem;{% endif %}">
        <div class="kpi-chart-panel kpi-chart-panel--zoomable" title="Clique para ver em ecrã inteiro">
          <button type="button" class="kpi-chart-fs-exit" aria-label="Diminuir gráfico">Diminuir</button>
          {% if client_embed %}
          <div class="label kpi-chart-title-simple">Evolução do investimento vs mercado</div>
          <div class="label kpi-chart-title-advanced">Curvas em escala log (modelo vs benchmark{% if show_max100_compare %} + exposição plafonada{% endif %})</div>
          {% else %}
          <div class="label">Curvas em escala log (modelo vs benchmark{% if show_max100_compare %} + exposição plafonada{% endif %})</div>
          {% endif %}
          <canvas id="equityChart" height="140"></canvas>
        </div>
        <div class="kpi-chart-panel kpi-chart-panel--zoomable" title="Clique para ver em ecrã inteiro">
          <button type="button" class="kpi-chart-fs-exit" aria-label="Diminuir gráfico">Diminuir</button>
          {% if client_embed %}
          <div class="label kpi-chart-title-simple">Perdas máximas ao longo do tempo</div>
          <div class="label kpi-chart-title-advanced">Drawdowns (modelo vs benchmark{% if show_max100_compare %} + exposição plafonada{% endif %})</div>
          {% else %}
          <div class="label">Drawdowns (modelo vs benchmark{% if show_max100_compare %} + exposição plafonada{% endif %})</div>
          {% endif %}
          <canvas id="ddChart" height="140"></canvas>
        </div>
        <div class="kpi-chart-panel kpi-chart-panel--zoomable" title="Clique para ver em ecrã inteiro">
          <button type="button" class="kpi-chart-fs-exit" aria-label="Diminuir gráfico">Diminuir</button>
          {% if client_embed %}
          <div class="label kpi-chart-title-simple">Vantagem do modelo vs mercado (últimos 12 meses)</div>
          <div class="label kpi-chart-title-advanced">Rolling 1Y alpha vs benchmark (modelo{% if show_max100_compare %} + exposição plafonada{% endif %})</div>
          {% else %}
          <div class="label">Rolling 1Y alpha vs benchmark (modelo{% if show_max100_compare %} + exposição plafonada{% endif %})</div>
          {% endif %}
          <canvas id="alphaChart" height="140"></canvas>
        </div>
        {% if yearly_bar_years and yearly_bar_years|length > 0 %}
        <div class="kpi-chart-panel kpi-chart-panel--zoomable" title="Clique para ver em ecrã inteiro">
          <button type="button" class="kpi-chart-fs-exit" aria-label="Diminuir gráfico">Diminuir</button>
          {% if client_embed %}
          <div class="label kpi-chart-title-simple">Retorno por ano (estratégia vs mercado)</div>
          <div class="label kpi-chart-title-advanced">Retorno por ano civil — CAP 15% vs exposição plafonada vs benchmark (%)</div>
          <div class="muted kpi-chart-title-advanced" style="font-size:0.75rem; margin-bottom:0.35rem;">Primeiro ao último dia útil de cada ano na série; para um ano civil equivale ao retorno total desse ano.</div>
          <div class="muted kpi-chart-title-simple" style="font-size:0.75rem; margin-bottom:0.35rem;">Comparação anual entre a estratégia, a versão com limite de exposição e o mercado de referência.</div>
          {% else %}
          <div class="label">Retorno por ano civil — CAP 15% vs exposição plafonada vs benchmark (%)</div>
          <div class="muted" style="font-size:0.75rem; margin-bottom:0.35rem;">Primeiro ao último dia útil de cada ano na série; para um ano civil equivale ao retorno total desse ano.</div>
          {% endif %}
          <canvas id="yearlyReturnChart" height="160"></canvas>
        </div>
        {% endif %}
      </div>
    </div>

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

    <!-- ABA 4: histórico de decisões da carteira (embed Next) -->
    <div id="tab-portfolio-history" class="tab-content{% if tab_default == 'portfolio_history' %} active{% endif %}">
      {# Sem loading="lazy": o separador começa com display:none — em vários browsers o iframe nunca entra no viewport e fica cinza vazio. #}
      <iframe
        src="{{ frontend_url }}/embed/recommendations-history"
        title="Histórico de decisões da carteira — DECIDE"
        style="width:100%; border:0; min-height:520px; height:3200px; background:#0f172a; border-radius: 12px; display:block;"
        referrerpolicy="no-referrer-when-downgrade"
      ></iframe>
    </div>

    <!-- ABA 5: FAQs (embed Next — DecideFaqPanel) -->
    <div id="tab-faq" class="tab-content{% if tab_default == 'faq' %} active{% endif %}">
      <div class="muted" style="font-size: .78rem; margin-bottom: 10px; line-height: 1.45;">
        Perguntas frequentes e glossário — conteúdo servido pelo dashboard DECIDE (Next). Confirme que o frontend está a correr
        e que <code style="color:#e5e7eb;">FRONTEND_URL</code> no arranque do <code style="color:#e5e7eb;">kpi_server</code>
        coincide com o URL que usas no browser.
      </div>
      <iframe
        src="{{ frontend_url }}/embed/decide-faq"
        title="FAQs DECIDE"
        style="width:100%; border:0; min-height:520px; height:2800px; background:#0f172a; border-radius: 12px; display:block;"
        referrerpolicy="no-referrer-when-downgrade"
      ></iframe>
    </div>
    </div>

    <script>
      function currentEmbedTabKey() {
        var active = document.querySelector('.tab.active');
        return active && active.dataset.tab ? String(active.dataset.tab) : '';
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

      // Tabs
      const tabs = document.querySelectorAll('.tab');
      const contents = {
        overview: document.getElementById('tab-overview'),
        horizons: document.getElementById('tab-horizons'),
        simulator: document.getElementById('tab-simulator'),
        charts: document.getElementById('tab-charts'),
        portfolio: document.getElementById('tab-portfolio'),
        portfolio_history: document.getElementById('tab-portfolio-history'),
        faq: document.getElementById('tab-faq'),
      };

      function notifyParentEmbedTab(tabKey) {
        try {
          if (window.parent && window.parent !== window) {
            window.parent.postMessage({ type: 'decide-kpi-embed-tab', tab: tabKey }, '*');
          }
        } catch (e) {}
      }
      tabs.forEach(tab => {
        tab.addEventListener('click', () => {
          tabs.forEach(t => {
            t.classList.remove('active');
            t.setAttribute('aria-selected', 'false');
          });
          tab.classList.add('active');
          tab.setAttribute('aria-selected', 'true');
          const key = tab.dataset.tab;
          Object.entries(contents).forEach(([k, el]) => {
            if (!el) return;
            el.classList.toggle('active', k === key);
          });
          if (key) notifyParentEmbedTab(key);
        });
      });
      (function () {
        var initial = {{ embed_initial_tab|tojson }};
        if (!initial) return;
        var el = document.querySelector('.tab[data-tab="' + initial + '"]');
        if (el) el.click();
      })();
      (function () {
        var t = currentEmbedTabKey();
        if (t) notifyParentEmbedTab(t);
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
        if (c === "japan") return "#ea580c";
        if (c === "canada") return "#db2777";
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
        .concat(["#fef9e8"]);

      const modelLineLabel = showMax100Compare ? 'CAP 15%' : 'Modelo';

      /** Estado inicial do simulador = dados da página (perfil do URL no topo). Pode mudar só no simulador via API. */
      const simModelEquityPage = (showMax100Compare && Array.isArray(max100Equity) && max100Equity.length === modelEquity.length)
        ? max100Equity
        : modelEquity;
      const simModelLineLabelPage = (showMax100Compare && Array.isArray(max100Equity) && max100Equity.length === modelEquity.length)
        ? 'Modelo DECIDE (plafonado)'
        : 'Modelo DECIDE';

      let simActiveDates = dates;
      let simActiveBench = benchEquity;
      let simActiveModel = simModelEquityPage;
      let simActiveModelLabel = simModelLineLabelPage;

      /** Sem animação de “crescimento” nos gráficos (Chart.js — linhas/barras aparecem já no valor final). */
      const chartStatic = { animation: false };
      const KPI_CHARTS_EMBED = {{ 'true' if client_embed else 'false' }};
      const chartEmbedLayout = KPI_CHARTS_EMBED ? { responsive: true, maintainAspectRatio: false } : {};

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
          borderColor: '#38bdf8',
          tension: 0.05,
          pointRadius: 0,
        },
      ];
      if (showMax100Compare && Array.isArray(max100Equity) && max100Equity.length === modelEquity.length) {
        eqDatasets.push({
          label: 'Exposição plafonada',
          data: max100Equity,
          borderColor: '#fbbf24',
          tension: 0.05,
          pointRadius: 0,
        });
      }
      const eqCtx = document.getElementById('equityChart').getContext('2d');
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

      const ddDatasets = [
        {
          label: modelLineLabel,
          data: modelDD,
          borderColor: '#f97373',
          borderWidth: 1,
          tension: 0.05,
          pointRadius: 0,
        },
        {
          label: 'Benchmark',
          data: benchDD,
          borderColor: '#fde047',
          borderWidth: 1,
          tension: 0.05,
          pointRadius: 0,
        },
      ];
      if (showMax100Compare && Array.isArray(max100DD) && max100DD.length === modelDD.length) {
        ddDatasets.push({
          label: 'Exposição plafonada',
          data: max100DD,
          borderColor: '#fb923c',
          borderWidth: 1,
          tension: 0.05,
          pointRadius: 0,
        });
      }
      // Drawdowns
      const ddCtx = document.getElementById('ddChart').getContext('2d');
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

      const alphaDatasets = [
        {
          label: showMax100Compare ? 'Rolling 1Y alpha (CAP 15%)' : 'Rolling 1Y alpha',
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
          label: 'Rolling 1Y alpha (plafonada)',
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

      // Barras: retorno por ano civil (CAP15 vs plafonada vs bench)
      const yearlyCanvas = document.getElementById('yearlyReturnChart');
      if (yearlyCanvas && Array.isArray(yearlyYears) && yearlyYears.length > 0) {
        const yCtx = yearlyCanvas.getContext('2d');
        yearlyChartInst = new Chart(yCtx, {
          type: 'bar',
          data: {
            labels: yearlyYears,
            datasets: [
              {
                label: 'CAP 15%',
                data: yearlyCap15,
                backgroundColor: 'rgba(74, 222, 128, 0.72)',
                borderColor: '#4ade80',
                borderWidth: 1,
              },
              {
                label: 'Exposição plafonada',
                data: yearlyMax100,
                backgroundColor: 'rgba(251, 191, 36, 0.72)',
                borderColor: '#fbbf24',
                borderWidth: 1,
              },
              {
                label: 'Benchmark',
                data: yearlyBench,
                backgroundColor: 'rgba(56, 189, 248, 0.5)',
                borderColor: '#38bdf8',
                borderWidth: 1,
              },
            ],
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

      // Retornos YTD / 1Y / 5Y / 10Y vs benchmark (escala log); eixo X: meses (YTD/1Y), anos (5Y/10Y)
      const HORIZON_RET = {{ horizon_returns|tojson }};
      const horizonModelLabel = {{ model_display_label|tojson }};
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
        /** Série muito longa (ex. 10Y ≈2520 pts): category + demasiados ticks pode deixar o canvas vazio; reduzimos só para o canvas. */
        function horizonDownsampleForChart(h) {
          if (!h || !h.dates || h.dates.length < HORIZON_DOWNSAMPLE_MIN_LEN) {
            return {
              labels: h.dates,
              model: h.model_norm,
              bench: h.bench_norm,
            };
          }
          var n = h.dates.length;
          var step = Math.max(1, Math.ceil(n / HORIZON_MAX_POINTS));
          var labels = [];
          var model = [];
          var bench = [];
          for (var i = 0; i < n; i += step) {
            labels.push(h.dates[i]);
            model.push(h.model_norm[i]);
            bench.push(h.bench_norm[i]);
          }
          var last = n - 1;
          if (labels[labels.length - 1] !== h.dates[last]) {
            labels.push(h.dates[last]);
            model.push(h.model_norm[last]);
            bench.push(h.bench_norm[last]);
          }
          return { labels: labels, model: model, bench: bench };
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
                  label: 'Benchmark',
                  data: horizonSanitizeLogSeries(ds.bench),
                  borderColor: '#38bdf8',
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
                  },
                },
              },
            },
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
        document.querySelectorAll('.kpi-chart-panel--zoomable').forEach(function (panel) {
          panel.addEventListener('click', function (e) {
            if (e.target.closest('.kpi-chart-fs-exit')) return;
            if (document.fullscreenElement || document.webkitFullscreenElement) return;
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
      let simFetchSeq = 0;

      function applyKpiViewChartLabels() {
        var simple = document.body.classList.contains('decide-kpi-simple');
        if (equityChartInst && equityChartInst.data && equityChartInst.data.datasets) {
          equityChartInst.data.datasets[0].label = simple ? 'Estratégia DECIDE' : modelLineLabel;
          equityChartInst.data.datasets[1].label = simple ? 'Mercado (referência)' : 'Benchmark';
          if (equityChartInst.data.datasets[2]) {
            equityChartInst.data.datasets[2].label = simple ? 'Com exposição limitada (100%)' : 'Exposição plafonada';
          }
          equityChartInst.update('none');
        }
        if (ddChartInst && ddChartInst.data && ddChartInst.data.datasets) {
          ddChartInst.data.datasets[0].label = simple ? 'Estratégia DECIDE' : modelLineLabel;
          ddChartInst.data.datasets[1].label = simple ? 'Mercado (referência)' : 'Benchmark';
          if (ddChartInst.data.datasets[2]) {
            ddChartInst.data.datasets[2].label = simple ? 'Com exposição limitada (100%)' : 'Exposição plafonada';
          }
          ddChartInst.update('none');
        }
        if (alphaChartInst && alphaChartInst.data && alphaChartInst.data.datasets) {
          var aDs = alphaChartInst.data.datasets;
          if (showMax100Compare && aDs.length > 1) {
            aDs[0].label = simple ? 'Vantagem vs mercado (CAP 15%)' : 'Rolling 1Y alpha (CAP 15%)';
            aDs[1].label = simple ? 'Vantagem vs mercado (exposição limitada)' : 'Rolling 1Y alpha (plafonada)';
          } else {
            aDs[0].label = simple ? 'Vantagem vs mercado (12 meses)' : 'Rolling 1Y alpha';
          }
          alphaChartInst.update('none');
        }
        if (yearlyChartInst && yearlyChartInst.data && yearlyChartInst.data.datasets) {
          var yDs = yearlyChartInst.data.datasets;
          if (yDs[0]) yDs[0].label = simple ? 'Estratégia (CAP 15%)' : 'CAP 15%';
          if (yDs[1]) yDs[1].label = simple ? 'Com exposição limitada' : 'Exposição plafonada';
          if (yDs[2]) yDs[2].label = simple ? 'Mercado (referência)' : 'Benchmark';
          yearlyChartInst.update('none');
        }
        if (simulatorChart && simulatorChart.data && simulatorChart.data.datasets) {
          simulatorChart.data.datasets[0].label = simple ? 'Estratégia DECIDE' : simActiveModelLabel;
          simulatorChart.data.datasets[1].label = simple ? 'Mercado (referência)' : 'Referência (benchmark)';
          simulatorChart.update('none');
        }
      }
      window.applyKpiViewChartLabels = applyKpiViewChartLabels;

      // Simples / Avançado (iframe cliente) — após applyKpiViewChartLabels existir (gráficos já criados ou a seguir)
      (function () {
        try {
          var embed = {{ 'true' if client_embed else 'false' }};
          if (!embed) return;
          var KEY = 'decide_kpi_view_v1';
          function setMode(mode) {
            var simple = mode === 'simple';
            document.body.classList.toggle('decide-kpi-simple', simple);
            try { localStorage.setItem(KEY, mode); } catch (e) {}
            document.querySelectorAll('.kpi-view-btn').forEach(function (b) {
              b.classList.toggle('active', b.getAttribute('data-kpi-view') === mode);
            });
            if (typeof window.applyKpiViewChartLabels === 'function') {
              window.applyKpiViewChartLabels();
            }
          }
          var stored = null;
          try { stored = localStorage.getItem(KEY); } catch (e2) {}
          setMode(stored === 'advanced' ? 'advanced' : 'simple');
          document.querySelectorAll('.kpi-view-btn').forEach(function (b) {
            b.addEventListener('click', function () {
              var m = b.getAttribute('data-kpi-view');
              if (m) setMode(m);
            });
          });
        } catch (e3) {}
      })();

      function buildSimulatorSeriesUrl(profile) {
        const ctx = document.getElementById('simApiContext');
        const u = new URL('/api/equity_series_for_simulator', window.location.origin);
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

      function runSimulator() {
        const errEl = document.getElementById('simError');
        const resultsEl = document.getElementById('simResults');
        const capIn = document.getElementById('simCapital');
        const yrsIn = document.getElementById('simYears');
        const modelLbl = document.getElementById('simModelResultLabel');
        if (!capIn || !yrsIn || !errEl || !resultsEl) return;
        if (modelLbl) modelLbl.textContent = simActiveModelLabel + ' (valor ilustrativo final)';
        errEl.style.display = 'none';
        errEl.textContent = '';
        errEl.style.color = '#f87171';

        const capital = parseFloat(String(capIn.value).replace(',', '.'));
        let years = parseFloat(String(yrsIn.value).replace(',', '.'));
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
        const elW = document.getElementById('simWindow');
        const endM = modelVal[modelVal.length - 1];
        const endB = benchVal[benchVal.length - 1];
        if (elM) elM.textContent = formatEur0(endM);
        if (elB) elB.textContent = formatEur0(endB);
        const elDelta = document.getElementById('simDeltaLine');
        if (elDelta) {
          const diff = endM - endB;
          const sign = diff >= 0 ? '+' : '−';
          const absStr = formatEur0(Math.abs(diff));
          elDelta.textContent = sign + absStr.replace(/^−/, '') + ' face ao mercado no mesmo período';
          elDelta.style.display = 'block';
        }
        if (elW) {
          const approxY = (daysBack / SIM_DAYS_PER_YEAR).toFixed(1);
          elW.textContent = sliceDates[0] + ' → ' + sliceDates[sliceDates.length - 1] + ' (~' + approxY + ' a)';
        }

        const canvas = document.getElementById('simulatorChart');
        const ctaBlock = document.getElementById('simCtaBlock');
        const ctaLink = document.getElementById('simCtaLink');
        const ctxReg = document.getElementById('simApiContext');
        if (ctaBlock && ctaLink && ctxReg && ctxReg.dataset.registerBase) {
          let base = String(ctxReg.dataset.registerBase || '');
          if (base.endsWith('/')) base = base.slice(0, -1);
          const capRound = Math.max(5000, Math.round(capital));
          ctaLink.href = base + '?capital=' + encodeURIComponent(String(capRound));
          ctaBlock.style.display = 'block';
        }

        if (canvas) {
          const ctx = canvas.getContext('2d');
          if (simulatorChart) simulatorChart.destroy();
          simulatorChart = new Chart(ctx, {
            type: 'line',
            data: {
              labels: sliceDates,
              datasets: [
                {
                  label: simActiveModelLabel,
                  data: modelVal,
                  borderColor: '#4ade80',
                  tension: 0.05,
                  pointRadius: 0,
                },
                {
                  label: 'Referência (benchmark)',
                  data: benchVal,
                  borderColor: '#38bdf8',
                  tension: 0.05,
                  pointRadius: 0,
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
          window.requestAnimationFrame(function () {
            var p = canvas.closest('.kpi-chart-panel--zoomable');
            if (p && (document.fullscreenElement === p || document.webkitFullscreenElement === p)) {
              var ch = Chart.getChart(canvas);
              if (ch) ch.resize();
            }
          });
          if (typeof applyKpiViewChartLabels === 'function') applyKpiViewChartLabels();
        }
        resultsEl.style.display = 'block';
      }

      document.getElementById('simRunBtn')?.addEventListener('click', runSimulator);
      document.getElementById('simProfileSelect')?.addEventListener('change', function () {
        const v = this.value;
        if (v) fetchSimulatorSeriesForProfile(v);
      });
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
        m_ret = float(ms[-1] / m0 - 1.0)
        b_ret = float(bs[-1] / b0 - 1.0)
        m_norm = (ms / m0).tolist()
        b_norm = (bs / b0).tolist()
        d_labels = [str(pd.Timestamp(dt.iloc[i]).strftime("%Y-%m-%d")) for i in range(start_i, end_i + 1)]
        return {
            "ok": True,
            "model_ret_pct": m_ret * 100.0,
            "bench_ret_pct": b_ret * 100.0,
            "date_start": d_labels[0],
            "date_end": d_labels[-1],
            "n_days": len(ms),
            "dates": d_labels,
            "model_norm": m_norm,
            "bench_norm": b_norm,
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
        if ticker and ticker in meta_df.index:
            row = meta_df.loc[ticker]
            sector_from_meta = _clean_str(row.get("sector", ""))
            company_from_meta = _clean_str(row.get("company", ""))
            country_from_meta = _clean_str(row.get("country", ""))
            zone_from_meta = _clean_str(row.get("zone", ""))

        # Se existir linha no meta_v3, usamos sempre o sector/nome de lá como "golden source"
        if ticker and ticker in meta_v3.index:
            row_v3 = meta_v3.loc[ticker]
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
        country = _normalize_country(_clean_str(h.get("country") or "") or country_from_meta, zone_from_meta or zone)
        zone = _clean_str(h.get("zone") or "") or zone_from_meta
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


def load_risk_info(model_key: str, base_path: Path) -> dict:
    """Carrega info de risco / cash a partir do freeze, com defaults razoáveis."""
    mode = "unknown"
    mode_label = "Desconhecido"
    avg_risk_exposure = 1.0
    risk_on_target = 1.0
    avg_tbill_exposure = 0.0
    latest_tbill_exposure = 0.0
    cash_proxy = "-"

    if model_key in V5_KPI_JSON_MODEL_KEYS:
        kpi_path = base_path / "v5_kpis.json"
        try:
            with kpi_path.open("r", encoding="utf-8") as f:
                data = json.load(f)
            avg_risk_exposure = float(data.get("avg_trend_exposure", 0.97))
            risk_on_target = float(data.get("risk_on_exposure", 1.1))
            avg_tbill_exposure = float(data.get("avg_cash_sleeve", 0.24))
            latest_tbill_exposure = float(data.get("latest_cash_sleeve", avg_tbill_exposure))
            cash_proxy = str(data.get("cash_proxy_ticker", "TBILL_PROXY"))
        except FileNotFoundError:
            pass
    else:
        # V3 clássico: sem cash sleeve explícito, assumimos 100% risco, 0% T-Bills
        avg_risk_exposure = 1.0
        risk_on_target = 1.0
        avg_tbill_exposure = 0.0
        latest_tbill_exposure = 0.0
        cash_proxy = "-"

    # Heurística simples para modo de risco
    if avg_risk_exposure >= 0.9:
        mode = "on"
        mode_label = "Risk ON"
    elif avg_risk_exposure <= 0.6:
        mode = "off"
        mode_label = "Risk OFF"
    else:
        mode = "neutral"
        mode_label = "Neutral"

    return {
        "mode": mode,
        "mode_label": mode_label,
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


def try_model_kpis_for_profile(model_key: str, profile_key: str):
    """KPIs do modelo a partir de model_equity_final_20y[_perfil].csv (freeze), com vol por perfil se não houver CSV dedicado."""
    base_path = MODEL_PATHS.get(model_key)
    if not base_path:
        return None
    model_path_by_profile = base_path / f"model_equity_final_20y_{profile_key}.csv"
    model_path_default = base_path / "model_equity_final_20y.csv"
    model_path = model_path_by_profile if model_path_by_profile.exists() else model_path_default
    if not model_path.exists():
        return None
    _, _, model_eq, _ = load_equity_curve(model_path, "model_equity")
    bench_path = base_path / "benchmark_equity_final_20y.csv"
    if bench_path.exists():
        _, _, bench_eq, _ = load_equity_curve(bench_path, "benchmark_equity")
        used_profile_file = model_path_by_profile.exists()
        if model_key != "v5_overlay_cap15":
            model_eq = scale_model_equity_to_profile_vol(
                model_eq, bench_eq, profile_key, has_profile_file=used_profile_file
            )
    kpis, _ = compute_kpis(model_eq)
    return kpis


def equity_series_bundle_for_simulator(
    model_key: str,
    profile_key: str,
    *,
    force_synthetic_profile_vol: bool,
) -> dict | None:
    """
    Séries modelo/benchmark para o simulador, com a mesma lógica de vol por perfil que a página principal.
    Permite pedir outro perfil via API sem recarregar o URL do topo.
    """
    allowed_profiles = {p[0] for p in PROFILE_OPTIONS}
    if profile_key not in allowed_profiles:
        profile_key = "moderado"
    base_path = MODEL_PATHS.get(model_key) or MODEL_PATHS["v5_overlay"]
    model_path_by_profile = base_path / f"model_equity_final_20y_{profile_key}.csv"
    model_path_default = base_path / "model_equity_final_20y.csv"
    if force_synthetic_profile_vol:
        model_path = model_path_default
        used_profile_file = False
    else:
        model_path = model_path_by_profile if model_path_by_profile.exists() else model_path_default
        used_profile_file = model_path_by_profile.exists()
    bench_path = base_path / "benchmark_equity_final_20y.csv"
    if not model_path.exists() or not bench_path.exists():
        return None
    _, _, model_eq, dates = load_equity_curve(model_path, "model_equity")
    _, _, bench_eq, _ = load_equity_curve(bench_path, "benchmark_equity")
    if model_key == "v5_overlay_cap15":
        model_eq = model_eq.astype(float)
    else:
        model_eq = scale_model_equity_to_profile_vol(
            model_eq, bench_eq, profile_key, has_profile_file=used_profile_file
        )
    dates_list = [d.strftime("%Y-%m-%d") for d in dates]
    bench_list = [float(x) for x in bench_eq.astype(float)]
    model_list = [float(x) for x in model_eq.astype(float)]
    num_days = len(dates_list)

    sim_model = model_list
    sim_label = "Modelo DECIDE"
    use_plafonada = False
    if model_key == "v5_overlay_cap15":
        m100_base = MODEL_PATHS["v5_overlay_cap15_max100exp"]
        if force_synthetic_profile_vol:
            m100_path = m100_base / "model_equity_final_20y.csv"
            m100_used_profile_file = False
        else:
            m100_path_by = m100_base / f"model_equity_final_20y_{profile_key}.csv"
            m100_path = m100_path_by if m100_path_by.exists() else m100_base / "model_equity_final_20y.csv"
            m100_used_profile_file = m100_path_by.exists()
        if m100_path.exists():
            try:
                _, _, m100_eq_file, m100_dates_s = load_equity_curve(m100_path, "model_equity")
                dt_m = pd.to_datetime(dates)
                s_f = pd.Series(np.asarray(m100_eq_file, dtype=float), index=pd.to_datetime(m100_dates_s))
                s_aligned = s_f.reindex(dt_m).ffill().bfill()
                if len(s_aligned) == len(model_eq) and bool(s_aligned.notna().all()):
                    m100_series = pd.Series([float(x) for x in s_aligned.values], dtype=float)
                    m100_series = scale_model_equity_to_profile_vol(
                        m100_series,
                        bench_eq,
                        profile_key,
                        has_profile_file=m100_used_profile_file,
                    )
                    sim_model = [float(x) for x in m100_series.values]
                    sim_label = "Modelo DECIDE (plafonado)"
                    use_plafonada = True
            except Exception:
                pass

    return {
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
    }


app = Flask(__name__)


def _truthy_query_param(raw: str | None) -> bool:
    return str(raw or "").strip().lower() in {"1", "true", "yes", "on"}


@app.route("/")
def index():
    model_key = request.args.get("model", "v5_overlay")
    profile_key = request.args.get("profile", "moderado").strip().lower()
    if profile_key not in [p[0] for p in PROFILE_OPTIONS]:
        profile_key = "moderado"

    # Vista embutida no dashboard Next: sem comparativo extra nem selector de modelo no topo.
    client_embed = _truthy_query_param(request.args.get("client_embed"))
    cap15_only = _truthy_query_param(request.args.get("cap15_only")) or client_embed
    if cap15_only:
        model_key = "v5_overlay_cap15"

    base_path = MODEL_PATHS.get(model_key) or MODEL_PATHS["v5_overlay"]
    # Curva por perfil (vol target): model_equity_final_20y_conservador.csv etc.; fallback = model_equity_final_20y.csv
    model_path_by_profile = base_path / f"model_equity_final_20y_{profile_key}.csv"
    model_path_default = base_path / "model_equity_final_20y.csv"
    # No iframe cliente os CSV por perfil no freeze costumam ser cópias da mesma curva e desativavam a regra
    # 0,75× / 1× / 1,25× vol do benchmark. Forçamos sempre a curva base + escala sintética.
    force_synthetic_profile_vol = client_embed or (
        str(os.environ.get("DECIDE_KPI_SYNTHETIC_PROFILE_VOL", "")).strip().lower()
        in {"1", "true", "yes", "on"}
    )
    if force_synthetic_profile_vol:
        model_path = model_path_default
        used_profile_file = False
    else:
        model_path = model_path_by_profile if model_path_by_profile.exists() else model_path_default
        used_profile_file = model_path_by_profile.exists()
    bench_path = base_path / "benchmark_equity_final_20y.csv"

    if not model_path.exists():
        return (
            f"Ficheiro não encontrado: {model_path}. "
            f"Corra o backtest V5 com --out freeze/DECIDE_MODEL_V5 (ou OVERLAY) para gerar os dados.",
            404,
        )
    _, _, model_eq, dates = load_equity_curve(model_path, "model_equity")
    _, _, bench_eq, _ = load_equity_curve(bench_path, "benchmark_equity")

    run_model_snapshot = load_run_model_snapshot(profile_key)
    raw_kpis_snapshot = run_model_snapshot.get("raw_kpis") if run_model_snapshot else None

    raw_path = base_path / "model_equity_final_20y.csv"
    if run_model_snapshot and isinstance(run_model_snapshot.get("series"), dict):
        raw_series_values = run_model_snapshot["series"].get("equity_raw") or []
        if len(raw_series_values) > 1:
            raw_eq = pd.Series([float(x) for x in raw_series_values], dtype=float)
        elif raw_path.exists():
            _, _, raw_eq, _ = load_equity_curve(raw_path, "model_equity")
        else:
            raw_eq = model_eq.copy()
    elif raw_path.exists():
        _, _, raw_eq, _ = load_equity_curve(raw_path, "model_equity")
    else:
        raw_eq = model_eq.copy()

    # CAP15: risco nativo da estratégia no freeze (sem escalar vol ao benchmark). Outros modelos mantêm escala por perfil.
    if model_key == "v5_overlay_cap15":
        model_eq = model_eq.astype(float)
    else:
        model_eq = scale_model_equity_to_profile_vol(
            model_eq, bench_eq, profile_key, has_profile_file=used_profile_file
        )

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
            "CAP15: volatilidade nativa da estratégia (margem possível). "
            "Modelo plafonado: vol ajustada ao benchmark conforme o perfil (1× no moderado, como na landing)."
        )
        if force_synthetic_profile_vol:
            profile_source_note += f" Perfil «{profile_key}» no topo não altera o CAP15 nativo; altera o ajuste de vol do plafonado."

    num_days = len(model_eq)
    num_years = num_days / TRADING_DAYS_PER_YEAR

    raw_kpis, raw_drawdowns = compute_kpis(raw_eq)
    if raw_kpis_snapshot:
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

    # Rolling 1Y alpha
    alpha_dates, alpha_vals = compute_rolling_alpha(model_eq, bench_eq, dates)

    close_as_of_date = load_last_close_as_of_date()

    # Comparativo alternativo (exposição plafonada): KPIs e curvas com a mesma regra de vol por perfil que o CAP15.
    compare_cap100_kpis = None
    max100_root = MODEL_PATHS["v5_overlay_cap15_max100exp"].parent

    # Curva MAX100Exp alinhada + barras anuais (só quando o modelo principal é CAP15)
    show_max100_compare = False
    compare_max100_equity = None
    compare_max100_drawdowns = None
    compare_max100_alpha_vals = None
    yearly_bar_payload = {"years": [], "cap15_pct": [], "max100_pct": [], "bench_pct": []}
    m100_series = None
    if model_key == "v5_overlay_cap15":
        m100_base = MODEL_PATHS["v5_overlay_cap15_max100exp"]
        if force_synthetic_profile_vol:
            m100_path = m100_base / "model_equity_final_20y.csv"
            m100_used_profile_file = False
        else:
            m100_path_by = m100_base / f"model_equity_final_20y_{profile_key}.csv"
            m100_path = m100_path_by if m100_path_by.exists() else m100_base / "model_equity_final_20y.csv"
            m100_used_profile_file = m100_path_by.exists()
        if m100_path.exists():
            try:
                _, _, m100_eq_file, m100_dates_s = load_equity_curve(m100_path, "model_equity")
                dt_m = pd.to_datetime(dates)
                s_f = pd.Series(np.asarray(m100_eq_file, dtype=float), index=pd.to_datetime(m100_dates_s))
                s_aligned = s_f.reindex(dt_m).ffill().bfill()
                if len(s_aligned) == len(model_eq) and bool(s_aligned.notna().all()):
                    m100_series = pd.Series([float(x) for x in s_aligned.values], dtype=float)
                    m100_series = scale_model_equity_to_profile_vol(
                        m100_series,
                        bench_eq,
                        profile_key,
                        has_profile_file=m100_used_profile_file,
                    )
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

    # Separador inicial no HTML: deve respeitar embed_tab (antes era ignorado → iframe punha sempre Simulador activo).
    start_kpis = _truthy_query_param(request.args.get("start_kpis"))
    default_sim_first = bool(client_embed) and not start_kpis
    if embed_tab_raw == "overview":
        client_focus_sim = False
    elif embed_tab_raw == "simulator":
        client_focus_sim = True
    elif embed_tab_raw in ("charts", "portfolio", "portfolio_history", "faq", "horizons"):
        client_focus_sim = False
    else:
        # Sem embed_tab (ou legado): iframe abre no Simulador — menos ruído. ?start_kpis=1 força KPIs.
        client_focus_sim = default_sim_first

    # Aba «Retornos YTD…»: mesma curva que o simulador com CAP15 — plafonada ≤100% (max100exp) quando disponível.
    horizon_model_eq = model_eq
    horizon_model_label = MODEL_LABELS.get(model_key, model_key)
    if model_key == "v5_overlay_cap15" and m100_series is not None and len(m100_series) == len(model_eq):
        horizon_model_eq = m100_series
        horizon_model_label = MODEL_LABELS.get("v5_overlay_cap15_max100exp", "Modelo plafonado")

    horizon_returns = build_horizon_returns_payload(dates, horizon_model_eq, bench_eq)
    model_display_label = horizon_model_label
    tab_default = embed_initial_tab if embed_initial_tab else (
        "simulator" if client_focus_sim else "overview"
    )

    return render_template_string(
        HTML_TEMPLATE,
        raw_kpis=raw_kpis,
        model_kpis=model_kpis,
        bench_kpis=bench_kpis,
        compare_cap100_kpis=compare_cap100_kpis,
        monthly=monthly,
        model_path=model_path,
        bench_path=bench_path,
        num_days=num_days,
        num_years=num_years,
        model_dates=[d.strftime("%Y-%m-%d") for d in dates],
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
            [("v5_overlay_cap15", MODEL_LABELS["v5_overlay_cap15"])]
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
        profile_source_note=profile_source_note,
        frontend_url=FRONTEND_URL,
        risk_info=risk_info,
        rebalance_info=rebalance_info,
        close_as_of_date=close_as_of_date,
        cap15_only=cap15_only,
        client_embed=client_embed,
        show_max100_compare=show_max100_compare,
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
    )


@app.get("/api/kpis")
def api_kpis():
    """JSON para o dashboard Next (CORS aberto em GET)."""
    model_key = request.args.get("model", "v5_overlay_cap15").strip()
    profile_key = request.args.get("profile", "moderado").strip().lower()
    allowed_profiles = {p[0] for p in PROFILE_OPTIONS}
    if profile_key not in allowed_profiles:
        profile_key = "moderado"
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
    profile_key = request.args.get("profile", "moderado").strip().lower()
    allowed_profiles = {p[0] for p in PROFILE_OPTIONS}
    if profile_key not in allowed_profiles:
        profile_key = "moderado"
    cap15_only = _truthy_query_param(request.args.get("cap15_only"))
    client_embed = _truthy_query_param(request.args.get("client_embed"))
    if cap15_only:
        model_key = "v5_overlay_cap15"
    else:
        model_key = request.args.get("model", "v5_overlay").strip()
        if model_key not in MODEL_PATHS:
            r = jsonify({"ok": False, "error": "unknown_model"})
            r.headers["Access-Control-Allow-Origin"] = "*"
            return r, 400
    force_synthetic = client_embed or (
        str(os.environ.get("DECIDE_KPI_SYNTHETIC_PROFILE_VOL", "")).strip().lower()
        in {"1", "true", "yes", "on"}
    )
    bundle = equity_series_bundle_for_simulator(
        model_key, profile_key, force_synthetic_profile_vol=force_synthetic
    )
    if bundle is None:
        r = jsonify({"ok": False, "error": "missing_equity_csv"})
        r.headers["Access-Control-Allow-Origin"] = "*"
        return r, 404
    r = jsonify(bundle)
    r.headers["Access-Control-Allow-Origin"] = "*"
    return r


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5000, debug=True)

