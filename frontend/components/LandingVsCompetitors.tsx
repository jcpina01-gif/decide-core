/**
 * LandingVsCompetitors — Posicionamento vs concorrência.
 *
 * Visual comparison: DECIDE vs S&P 500 ETF vs Depósito a prazo.
 * Metrics are based on the validated historical research (2006–2026, CAP15 Moderado).
 * Clearly marked as illustrative — not a guarantee of future returns.
 *
 * Designed for the public landing page (index.tsx).
 */

import React from "react";
import { DECIDE_APP_FONT_FAMILY } from "../lib/decideClientTheme";

// ─── validated historical data (freeze CAP15 Moderado, 2006-2026) ─────────────
// Source: v19_core_cta_cap15_validation.json + historical SPY data
// These are hardcoded because they come from the formal research process,
// not from live runtime computation.

const HISTORY_LABEL = "2006–2026 (ilustrativo)";
const YEARS = 20;
const SEED = 10_000;

type Alternative = {
  id: string;
  name: string;
  tagline: string;
  cagrPct: number;       // annualized return %
  mddPct: number;        // max drawdown % (negative)
  worstYearPct: number;  // worst calendar year return % (negative or positive)
  volPct: number;        // annualized volatility %
  sharpePt: number;      // Sharpe ratio (rf=0)
  growthOf10k: number;   // final value of €10k after YEARS years at cagrPct
  isDecide: boolean;
  pros: string[];
  cons: string[];
  color: string;
  accentColor: string;
};

// Deposit: conservative estimate Portuguese historical average
const DEPOSIT_CAGR = 0.025;
const DEPOSIT_GROWTH = SEED * Math.pow(1 + DEPOSIT_CAGR, YEARS);

// S&P 500: SPY historical 2006-2026 (CAP15 benchmark data)
// Using the benchmark from the research: benchCagr ≈ 11.3%, benchMdd ≈ -55% (2008-2009 GFC)
const SPY_CAGR = 0.113;
const SPY_GROWTH = SEED * Math.pow(1 + SPY_CAGR, YEARS);

// DECIDE CAP15 Moderado: from freeze research (v19_core_cta_cap15_validation.json)
const DECIDE_CAGR = 0.2454;
const DECIDE_GROWTH = SEED * Math.pow(1 + DECIDE_CAGR, YEARS);

const ALTERNATIVES: Alternative[] = [
  {
    id: "deposit",
    name: "Depósito a prazo",
    tagline: "Capital garantido, juro fixo",
    cagrPct: DEPOSIT_CAGR * 100,
    mddPct: 0,
    worstYearPct: 0,
    volPct: 0,
    sharpePt: 0,
    growthOf10k: DEPOSIT_GROWTH,
    isDecide: false,
    pros: ["Capital 100% garantido (até €100k, fundo de garantia)", "Previsível. Juro fixo anual.", "Zero volatilidade"],
    cons: [
      "Retorno historicamente abaixo da inflação em vários períodos",
      "Não cresce com os mercados",
      `${fmtEur(DEPOSIT_GROWTH)} no fim de ${YEARS} anos (ilustrativo)`,
    ],
    color: "rgba(100,116,139,0.5)",
    accentColor: "#94a3b8",
  },
  {
    id: "spy",
    name: "S&P 500 ETF (passivo)",
    tagline: "Mercado de referência — exposição total",
    cagrPct: SPY_CAGR * 100,
    mddPct: -55,
    worstYearPct: -37,
    volPct: 19.1,
    sharpePt: 0.60,
    growthOf10k: SPY_GROWTH,
    isDecide: false,
    pros: ["Custos muito baixos (TER ~0.03%)", "Diversificado (500+ empresas)", "Simples de comprar e manter"],
    cons: [
      "Queda de -37% em 2008. Recuperação: ~4 anos",
      "Queda máxima histórica: ~-55% (2008-2009)",
      "Zero gestão de risco: sofre o mercado integralmente",
    ],
    color: "rgba(148,163,184,0.5)",
    accentColor: "#cbd5e1",
  },
  {
    id: "decide",
    name: "DECIDE Moderado",
    tagline: "Momentum sistemático com gestão de risco",
    cagrPct: DECIDE_CAGR * 100,
    mddPct: -24,
    worstYearPct: -10,
    volPct: 19.1,
    sharpePt: 1.25,
    growthOf10k: DECIDE_GROWTH,
    isDecide: true,
    pros: [
      "Retorno histórico 2× acima do mercado (mesmo nível de risco)",
      "Pior queda histórica: -24% vs -55% do S&P 500",
      `Sharpe 1,25 vs 0,60 do S&P 500 — mais retorno por unidade de risco`,
    ],
    cons: [
      "Baseado em histórico ilustrativo — sem garantia de resultados futuros",
      "Requer aprovação mensal das recomendações",
      "Mínimo de investimento aplicável",
    ],
    color: "rgba(16,185,129,0.5)",
    accentColor: "#34d399",
  },
];

// ─── helpers ──────────────────────────────────────────────────────────────────

function fmtEur(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1).replace(".", ",")} M€`;
  if (v >= 10_000) return `${Math.round(v / 1000)}\u202fk€`;
  return new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(v);
}

function fmtPct(v: number, digits = 1, sign = false): string {
  const s = sign && v >= 0 ? "+" : "";
  return `${s}${v.toFixed(digits).replace(".", ",")}%`;
}

// ─── sub-components ───────────────────────────────────────────────────────────

function MetricRow({ label, values, highlight }: {
  label: string;
  values: React.ReactNode[];
  highlight?: number; // index of "best" value (green)
}) {
  return (
    <tr>
      <td style={{
        padding: "10px 14px",
        fontSize: 11,
        fontWeight: 700,
        color: "#94a3b8",
        borderBottom: "1px solid rgba(255,255,255,0.05)",
        whiteSpace: "nowrap",
        textAlign: "right",
        verticalAlign: "middle",
      }}>
        {label}
      </td>
      {values.map((v, i) => (
        <td key={i} style={{
          padding: "10px 16px",
          textAlign: "center",
          borderBottom: "1px solid rgba(255,255,255,0.05)",
          fontSize: 13,
          fontWeight: 800,
          color: highlight === i ? "#4ade80" : "#e2e8f0",
          letterSpacing: "-0.01em",
          verticalAlign: "middle",
          background: i === 2 ? "rgba(16,185,129,0.04)" : "transparent",
        }}>
          {v}
        </td>
      ))}
    </tr>
  );
}

function GrowthBarSmall({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = Math.max(2, (value / max) * 100);
  return (
    <div style={{ width: "100%", height: 8, background: "rgba(255,255,255,0.06)", borderRadius: 4, overflow: "hidden" }}>
      <div style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: 4 }} />
    </div>
  );
}

// ─── main ─────────────────────────────────────────────────────────────────────

export default function LandingVsCompetitors() {
  const maxGrowth = Math.max(...ALTERNATIVES.map((a) => a.growthOf10k));

  return (
    <section
      aria-labelledby="vs-competitors-heading"
      style={{
        fontFamily: DECIDE_APP_FONT_FAMILY,
        marginTop: 36,
        marginBottom: 36,
      }}
    >
      {/* Section header */}
      <div style={{ textAlign: "center", marginBottom: 24 }}>
        <div style={{
          display: "inline-block",
          fontSize: 10,
          fontWeight: 800,
          letterSpacing: "0.1em",
          color: "#4b5563",
          textTransform: "uppercase",
          marginBottom: 10,
        }}>
          Histórico ilustrativo {HISTORY_LABEL}
        </div>
        <h2
          id="vs-competitors-heading"
          style={{
            margin: 0,
            fontSize: "clamp(1rem, 2.2vw, 1.3rem)",
            fontWeight: 800,
            color: "#e2e8f0",
            letterSpacing: "-0.02em",
            lineHeight: 1.35,
          }}
        >
          Como se compara com as alternativas?
        </h2>
        <p style={{ margin: "10px 0 0", fontSize: 12, color: "#6b7280", maxWidth: 560, marginLeft: "auto", marginRight: "auto", lineHeight: 1.5 }}>
          Comparação ilustrativa baseada em histórico real do modelo (freeze CAP15).
          Passado não garante futuro. Cada alternativa tem risco e perfil diferentes.
        </p>
      </div>

      {/* Comparison table (desktop) */}
      <div style={{ overflowX: "auto", borderRadius: 16, border: "1px solid rgba(45,212,191,0.14)", marginBottom: 20 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 540 }}>
          {/* Column headers */}
          <thead>
            <tr>
              <th style={{ padding: "12px 14px", textAlign: "right", fontSize: 10, color: "#4b5563", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", background: "rgba(15,23,42,0.9)" }} />
              {ALTERNATIVES.map((a) => (
                <th key={a.id} style={{
                  padding: "14px 16px 12px",
                  textAlign: "center",
                  background: a.isDecide ? "rgba(16,185,129,0.08)" : "rgba(15,23,42,0.9)",
                  borderBottom: a.isDecide ? "2px solid rgba(52,211,153,0.4)" : "1px solid rgba(255,255,255,0.06)",
                }}>
                  <div style={{ fontSize: 13, fontWeight: 900, color: a.isDecide ? "#34d399" : "#cbd5e1", marginBottom: 4, letterSpacing: "-0.01em" }}>
                    {a.name}
                  </div>
                  <div style={{ fontSize: 10, color: a.isDecide ? "#6ee7b7" : "#6b7280", fontWeight: 600, lineHeight: 1.3 }}>
                    {a.tagline}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody style={{ background: "rgba(12,17,29,0.96)" }}>
            <MetricRow
              label={`€${(SEED / 1000).toFixed(0)}k → (${YEARS} anos)`}
              values={ALTERNATIVES.map((a, i) => (
                <div key={i}>
                  <div style={{ fontSize: a.isDecide ? 16 : 13, fontWeight: 900, color: a.isDecide ? "#4ade80" : "#e2e8f0" }}>
                    {fmtEur(a.growthOf10k)}
                  </div>
                  <div style={{ marginTop: 4 }}>
                    <GrowthBarSmall value={a.growthOf10k} max={maxGrowth} color={a.accentColor} />
                  </div>
                </div>
              ))}
              highlight={2}
            />
            <MetricRow
              label="Retorno anual (CAGR)"
              values={ALTERNATIVES.map((a) => fmtPct(a.cagrPct, 1, true))}
              highlight={2}
            />
            <MetricRow
              label="Queda máxima histórica"
              values={ALTERNATIVES.map((a) => (
                a.mddPct === 0
                  ? <span style={{ color: "#4ade80" }}>~0%</span>
                  : <span style={{ color: a.mddPct < -35 ? "#f87171" : "#fde68a" }}>{fmtPct(a.mddPct)}</span>
              ))}
              highlight={0}
            />
            <MetricRow
              label="Pior ano histórico"
              values={ALTERNATIVES.map((a) => (
                a.worstYearPct === 0
                  ? <span style={{ color: "#4ade80" }}>~0%</span>
                  : <span style={{ color: a.worstYearPct < -25 ? "#f87171" : "#fde68a" }}>{fmtPct(a.worstYearPct)}</span>
              ))}
              highlight={0}
            />
            <MetricRow
              label="Volatilidade anual"
              values={ALTERNATIVES.map((a) => (
                a.volPct === 0
                  ? <span style={{ color: "#94a3b8" }}>~0%</span>
                  : `${fmtPct(a.volPct)}`
              ))}
            />
            <MetricRow
              label="Sharpe ratio (rf=0)"
              values={ALTERNATIVES.map((a) => (
                a.sharpePt === 0
                  ? <span style={{ color: "#94a3b8" }}>—</span>
                  : a.sharpePt.toFixed(2).replace(".", ",")
              ))}
              highlight={2}
            />
          </tbody>
        </table>
      </div>

      {/* Pros/cons cards (mobile-friendly) */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
        {ALTERNATIVES.map((a) => (
          <div key={a.id} style={{
            flex: "1 1 220px",
            minWidth: 0,
            borderRadius: 14,
            padding: "14px 16px",
            background: a.isDecide ? "rgba(16,185,129,0.06)" : "rgba(15,23,42,0.75)",
            border: `1px solid ${a.isDecide ? "rgba(52,211,153,0.3)" : "rgba(255,255,255,0.07)"}`,
          }}>
            <div style={{ fontSize: 12, fontWeight: 900, color: a.accentColor, marginBottom: 10 }}>{a.name}</div>
            <div style={{ fontSize: 10, fontWeight: 800, color: "#4ade80", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 6 }}>
              Vantagens
            </div>
            {a.pros.map((p, i) => (
              <div key={i} style={{ fontSize: 11, color: "#d1d5db", lineHeight: 1.45, marginBottom: 4, paddingLeft: 10, position: "relative" }}>
                <span style={{ position: "absolute", left: 0, color: "#4ade80", fontWeight: 900 }}>+</span>
                {p}
              </div>
            ))}
            <div style={{ fontSize: 10, fontWeight: 800, color: "#f87171", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 6, marginTop: 10 }}>
              A ter em conta
            </div>
            {a.cons.map((c, i) => (
              <div key={i} style={{ fontSize: 11, color: "#9ca3af", lineHeight: 1.45, marginBottom: 4, paddingLeft: 10, position: "relative" }}>
                <span style={{ position: "absolute", left: 0, color: "#f87171", fontWeight: 900 }}>−</span>
                {c}
              </div>
            ))}
          </div>
        ))}
      </div>

      {/* Legal footer */}
      <div style={{
        marginTop: 16,
        padding: "10px 14px",
        borderRadius: 10,
        background: "rgba(0,0,0,0.2)",
        border: "1px solid rgba(255,255,255,0.05)",
        fontSize: 10,
        color: "#374151",
        lineHeight: 1.5,
      }}>
        Dados ilustrativos baseados em histórico real do modelo DECIDE (freeze CAP15 Moderado ≤100% NAV, 2006–2026).
        S&P 500: retorno SPY aproximado, sem dividendos reinvestidos, sem custos de transação.
        Depósito: taxa média estimada 2,5%/ano — varia consoante o banco e o período.
        Histórico passado não é garantia de resultados futuros. Investir comporta risco de perda de capital.
        Não constitui aconselhamento financeiro.
      </div>
    </section>
  );
}
