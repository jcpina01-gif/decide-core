/**
 * ClientGrowthNarrative — client-facing performance story.
 *
 * Replaces jargon (CAGR, Sharpe, MDD) with plain-language,
 * concrete-money metrics a non-financial investor understands.
 *
 * Fetches from /api/landing/freeze-cap15-backtest (same data as the dashboard
 * chart), then computes all stats client-side so the component is zero-deps
 * beyond React and the existing API.
 */

import React, { useEffect, useMemo, useState } from "react";
import { DECIDE_APP_FONT_FAMILY, DECIDE_DASHBOARD } from "../lib/decideClientTheme";

// ─── helpers ──────────────────────────────────────────────────────────────────

function approxCagr(equity: number[]): number | null {
  if (equity.length < 50) return null;
  const v0 = equity[0];
  const v1 = equity[equity.length - 1];
  if (!v0 || !v1 || v0 <= 0 || v1 <= 0) return null;
  const years = equity.length / 252;
  return Math.pow(v1 / v0, 1 / years) - 1;
}

function growthOf(equity: number[], seed: number): number | null {
  if (equity.length < 2) return null;
  const v0 = equity[0];
  const v1 = equity[equity.length - 1];
  if (!v0 || v0 <= 0) return null;
  return seed * (v1 / v0);
}

function maxDrawdown(equity: number[]): number {
  let peak = equity[0] ?? 0;
  let worst = 0;
  for (const v of equity) {
    if (v > peak) peak = v;
    if (peak > 0) {
      const dd = (v - peak) / peak;
      if (dd < worst) worst = dd;
    }
  }
  return worst;
}

function worstCalendarYear(dates: string[], equity: number[]): number | null {
  const byYear = new Map<number, { i0: number; i1: number }>();
  for (let i = 0; i < dates.length; i++) {
    const y = parseInt(String(dates[i]).slice(0, 4), 10);
    if (!isFinite(y)) continue;
    const cur = byYear.get(y);
    if (!cur) byYear.set(y, { i0: i, i1: i });
    else cur.i1 = i;
  }
  let worst: number | null = null;
  for (const { i0, i1 } of byYear.values()) {
    const v0 = equity[i0];
    const v1 = equity[i1];
    if (!v0 || !v1 || v0 <= 0) continue;
    const ret = v1 / v0 - 1;
    if (worst === null || ret < worst) worst = ret;
  }
  return worst;
}

function pctPositiveMonths(dates: string[], equity: number[]): { pos: number; n: number } {
  const byMonth = new Map<string, { i0: number; i1: number }>();
  for (let i = 0; i < dates.length; i++) {
    const m = String(dates[i]).slice(0, 7);
    const cur = byMonth.get(m);
    if (!cur) byMonth.set(m, { i0: i, i1: i });
    else cur.i1 = i;
  }
  let pos = 0;
  let n = 0;
  for (const { i0, i1 } of byMonth.values()) {
    const v0 = equity[i0];
    const v1 = equity[i1];
    if (!v0 || !v1 || v0 <= 0) continue;
    n++;
    if (v1 / v0 > 1) pos++;
  }
  return { pos, n };
}

function pctMonthsAboveBench(dates: string[], eq: number[], bench: number[]): { above: number; n: number } {
  const byMonth = new Map<string, { i0: number; i1: number }>();
  for (let i = 0; i < dates.length; i++) {
    const m = String(dates[i]).slice(0, 7);
    const cur = byMonth.get(m);
    if (!cur) byMonth.set(m, { i0: i, i1: i });
    else cur.i1 = i;
  }
  let above = 0;
  let n = 0;
  for (const { i0, i1 } of byMonth.values()) {
    const m0 = eq[i0]; const m1 = eq[i1];
    const b0 = bench[i0]; const b1 = bench[i1];
    if (!m0 || !m1 || !b0 || !b1 || m0 <= 0 || b0 <= 0) continue;
    n++;
    if (m1 / m0 > b1 / b0) above++;
  }
  return { above, n };
}

function depositGrowth(seed: number, years: number, rateAnnual = 0.025): number {
  return seed * Math.pow(1 + rateAnnual, years);
}

function fmtEur(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(2).replace(".", ",")} M€`;
  if (v >= 10_000) return `${Math.round(v / 1000)}\u202fk€`;
  return new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(v);
}

function fmtPct(v: number, sign = false): string {
  const s = sign && v >= 0 ? "+" : "";
  return `${s}${(v * 100).toFixed(1).replace(".", ",")}%`;
}

// ─── types ────────────────────────────────────────────────────────────────────

type SeriesResp = {
  ok?: boolean;
  series?: {
    dates?: string[];
    equity_overlayed?: number[];
    benchmark_equity?: number[];
  };
};

type Stats = {
  seed: number;
  years: number;
  modelFinal: number;
  benchFinal: number;
  depositFinal: number;
  modelCagr: number;
  benchCagr: number;
  modelMdd: number;
  benchMdd: number;
  worstYearModel: number | null;
  worstYearBench: number | null;
  posMonthsPct: number;
  aboveBenchPct: number;
  nMonths: number;
  startYear: number;
  endYear: number;
};

const SEED = 10_000;

// ─── mini stat pill ───────────────────────────────────────────────────────────

function Pill({ label, value, sub, color = "#6ee7b7", big = false }: {
  label: string; value: string; sub?: string; color?: string; big?: boolean;
}) {
  return (
    <div style={{
      background: "rgba(15,23,42,0.75)",
      border: "1px solid rgba(45,212,191,0.18)",
      borderRadius: 14,
      padding: "14px 16px",
      minWidth: 0,
      flex: "1 1 140px",
    }}>
      <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.06em", color: "#71717a", textTransform: "uppercase", marginBottom: 8 }}>
        {label}
      </div>
      <div style={{ fontSize: big ? 22 : 18, fontWeight: 900, color, lineHeight: 1.15, letterSpacing: "-0.02em" }}>
        {value}
      </div>
      {sub && <div style={{ marginTop: 5, fontSize: 11, color: "#71717a", lineHeight: 1.35 }}>{sub}</div>}
    </div>
  );
}

// ─── growth bar ───────────────────────────────────────────────────────────────

function GrowthBar({ model, bench, deposit, years }: {
  model: number; bench: number; deposit: number; years: number;
}) {
  const max = Math.max(model, bench, deposit, 1);
  const bar = (v: number, color: string, label: string, sub: string) => (
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
      <div style={{ width: 110, fontSize: 11, color: "#a1a1aa", fontWeight: 700, flexShrink: 0, textAlign: "right" }}>{label}</div>
      <div style={{ flex: 1, background: "rgba(255,255,255,0.06)", borderRadius: 6, height: 22, position: "relative", overflow: "hidden" }}>
        <div style={{
          position: "absolute", left: 0, top: 0, bottom: 0,
          width: `${Math.max(2, (v / max) * 100).toFixed(1)}%`,
          background: color, borderRadius: 6, transition: "width 0.8s cubic-bezier(0.4,0,0.2,1)",
        }} />
      </div>
      <div style={{ width: 80, fontSize: 12, fontWeight: 900, color: "#f8fafc", flexShrink: 0 }}>{sub}</div>
    </div>
  );
  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ fontSize: 10, fontWeight: 800, color: "#71717a", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 10 }}>
        {fmtEur(SEED)} ao fim de ~{Math.round(years)} anos (ilustrativo)
      </div>
      {bar(model,   "rgba(74,222,128,0.75)",  "DECIDE",      fmtEur(model))}
      {bar(bench,   "rgba(148,163,184,0.55)", "Mercado ref.", fmtEur(bench))}
      {bar(deposit, "rgba(100,116,139,0.4)",  "Depósito 2.5%", fmtEur(deposit))}
    </div>
  );
}

// ─── main component ───────────────────────────────────────────────────────────

type Props = { riskProfile?: string };

export default function ClientGrowthNarrative({ riskProfile = "moderado" }: Props) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setErr("");
      try {
        const r = await fetch(`/api/landing/freeze-cap15-backtest?profile=${encodeURIComponent(riskProfile)}`, { cache: "no-store" });
        const j = (await r.json()) as SeriesResp;
        if (cancelled) return;
        if (!j?.ok || !j.series?.equity_overlayed?.length) {
          setErr("Sem dados.");
          return;
        }
        const { dates = [], equity_overlayed = [], benchmark_equity = [] } = j.series;
        const eq = equity_overlayed as number[];
        const bq = benchmark_equity as number[];
        const n = eq.length;
        const years = n / 252;
        const mc = approxCagr(eq);
        const bc = approxCagr(bq.length >= n ? bq : bq);
        const mf = growthOf(eq, SEED);
        const bf = bq.length >= n ? growthOf(bq, SEED) : null;
        const df = depositGrowth(SEED, years);
        const { pos, n: nm } = pctPositiveMonths(dates as string[], eq);
        const { above } = pctMonthsAboveBench(dates as string[], eq, bq);
        const wy_m = worstCalendarYear(dates as string[], eq);
        const wy_b = worstCalendarYear(dates as string[], bq);
        const startYear = parseInt(String((dates as string[])[0]).slice(0, 4), 10);
        const endYear   = parseInt(String((dates as string[])[n - 1]).slice(0, 4), 10);
        if (!mc || !mf || !bf) { setErr("Dados insuficientes."); return; }
        setStats({
          seed: SEED, years,
          modelFinal: mf, benchFinal: bf, depositFinal: df,
          modelCagr: mc, benchCagr: bc ?? 0,
          modelMdd: maxDrawdown(eq),
          benchMdd: bq.length >= n ? maxDrawdown(bq) : 0,
          worstYearModel: wy_m, worstYearBench: wy_b,
          posMonthsPct: nm > 0 ? (pos / nm) * 100 : 0,
          aboveBenchPct: nm > 0 ? (above / nm) * 100 : 0,
          nMonths: nm,
          startYear: isFinite(startYear) ? startYear : 2006,
          endYear:   isFinite(endYear)   ? endYear   : 2026,
        });
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : "Erro");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [riskProfile]);

  const extraVsDeposit = useMemo(() => {
    if (!stats) return null;
    return stats.modelFinal - stats.depositFinal;
  }, [stats]);

  const extraVsBench = useMemo(() => {
    if (!stats) return null;
    return stats.modelFinal - stats.benchFinal;
  }, [stats]);

  if (loading) {
    return (
      <div style={{ padding: "16px 0", fontSize: 12, color: "#71717a", fontFamily: DECIDE_APP_FONT_FAMILY }}>
        A carregar dados históricos…
      </div>
    );
  }

  if (err || !stats) {
    return null;
  }

  const depositAdvantage = stats.modelFinal / stats.depositFinal;

  return (
    <div style={{
      fontFamily: DECIDE_APP_FONT_FAMILY,
      marginBottom: 16,
      borderRadius: 18,
      overflow: "hidden",
      border: "1px solid rgba(45,212,191,0.18)",
      background: "linear-gradient(165deg, rgba(15,30,48,0.96) 0%, rgba(12,20,34,0.99) 100%)",
      boxShadow: "0 4px 28px rgba(0,0,0,0.38)",
    }}>
      {/* Header */}
      <div style={{
        padding: "16px 20px 12px",
        borderBottom: "1px solid rgba(45,212,191,0.12)",
        display: "flex",
        flexWrap: "wrap",
        alignItems: "baseline",
        gap: "6px 16px",
      }}>
        <div style={{ fontSize: 13, fontWeight: 900, color: "#e2e8f0", letterSpacing: "-0.01em" }}>
          O que o modelo fez desde {stats.startYear}
        </div>
        <div style={{ fontSize: 11, color: "#4b5563", fontWeight: 600 }}>
          {stats.startYear}–{stats.endYear} · histórico ilustrativo · não é garantia de resultados futuros
        </div>
      </div>

      <div style={{ padding: "18px 20px 20px" }}>

        {/* Hero statement */}
        <div style={{
          marginBottom: 18,
          padding: "14px 18px",
          borderRadius: 14,
          background: "rgba(74,222,128,0.07)",
          border: "1px solid rgba(74,222,128,0.2)",
        }}>
          <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.06em", color: "#4ade80", textTransform: "uppercase", marginBottom: 8 }}>
            Crescimento ilustrativo
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 20px", alignItems: "baseline" }}>
            <span style={{ fontSize: 26, fontWeight: 900, color: "#f0fdf4", letterSpacing: "-0.03em" }}>
              {fmtEur(SEED)} → <span style={{ color: "#4ade80" }}>{fmtEur(stats.modelFinal)}</span>
            </span>
            <span style={{ fontSize: 13, color: "#6ee7b7", fontWeight: 700 }}>
              ({fmtPct(stats.modelCagr, true)}/ano · ~{Math.round(stats.years)} anos)
            </span>
          </div>
          <div style={{ marginTop: 8, fontSize: 12, color: "#a7f3d0", lineHeight: 1.45 }}>
            <strong>{depositAdvantage.toFixed(1)}×</strong> mais que um depósito a 2,5%/ano ({fmtEur(stats.depositFinal)}) —
            {" "}<strong>{fmtEur(extraVsDeposit ?? 0)} extra</strong> por cada {fmtEur(SEED)} investidos.
          </div>
        </div>

        {/* Pills grid */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 16 }}>
          <Pill
            label="Meses com ganho"
            value={`${stats.posMonthsPct.toFixed(0)}%`}
            sub={`de ${stats.nMonths} meses`}
            color="#6ee7b7"
          />
          <Pill
            label="Bateu o mercado"
            value={`${stats.aboveBenchPct.toFixed(0)}% dos meses`}
            sub="vs S&P 500"
            color="#67e8f9"
          />
          <Pill
            label="Pior ano do modelo"
            value={stats.worstYearModel !== null ? fmtPct(stats.worstYearModel) : "—"}
            sub={`vs mercado ${stats.worstYearBench !== null ? fmtPct(stats.worstYearBench) : "—"} no pior ano`}
            color={stats.worstYearModel !== null && stats.worstYearModel < -0.15 ? "#fca5a5" : "#fde68a"}
          />
          <Pill
            label="Queda máxima histórica"
            value={fmtPct(stats.modelMdd)}
            sub={`mercado: ${fmtPct(stats.benchMdd)}`}
            color="#fde68a"
          />
          <Pill
            label="Extra vs mercado"
            value={extraVsBench !== null && extraVsBench > 0 ? `+${fmtEur(extraVsBench)}` : "—"}
            sub={`por ${fmtEur(SEED)} investidos`}
            color="#c4b5fd"
          />
        </div>

        {/* Bar chart */}
        <GrowthBar
          model={stats.modelFinal}
          bench={stats.benchFinal}
          deposit={stats.depositFinal}
          years={stats.years}
        />

        {/* Footnote */}
        <div style={{ marginTop: 14, fontSize: 10, color: "#374151", lineHeight: 1.5 }}>
          Depósito calculado a 2,5%/ano fixo (estimativa histórica PT). Dados do modelo: freeze CAP15 Moderado ≤100% NAV.
          Histórico ilustrativo — não constitui aconselhamento nem promessa de resultados futuros.
          Cada investimento comporta riscos, incluindo perda de capital.
        </div>
      </div>
    </div>
  );
}
