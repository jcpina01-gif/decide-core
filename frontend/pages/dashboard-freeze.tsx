import Head from "next/head";
import React, { useEffect, useMemo, useState } from "react";
import DashboardQuickLinks from "../components/DashboardQuickLinks";
import { DECIDE_APP_FONT_FAMILY } from "../lib/decideClientTheme";

type Holding = {
  ticker?: string;
  weight?: number;
  weight_pct?: number;
  short_name?: string;
  name?: string;
  country?: string;
  zone?: string;
  region?: string;
  sector?: string;
  score?: number | null;
  rank_momentum?: number | null;
  subindustry?: string;
};

type RunModelMeta = {
  engine?: string;
  latest_portfolio_date?: string;
  data_start?: string;
  data_end?: string;
  main_version?: string;
};

type Kpis = {
  cagr?: number | null;
  vol?: number | null;
  sharpe?: number | null;
  max_drawdown?: number | null;
  total_return?: number | null;
  best_month?: number | null;
  worst_month?: number | null;
  positive_months?: number | null;
  negative_months?: number | null;
  months_above_benchmark?: number | null;
};

type PortfolioKpis = {
  n_positions?: number;
  gross_exposure?: number;
  top1_weight?: number;
  top5_weight?: number;
  top10_weight?: number;
  hhi?: number;
  zones?: Record<string, number>;
  top_sectors?: Array<{ sector: string; weight: number }>;
};

type RunModelResponse = {
  meta?: RunModelMeta;

  kpis?: Kpis;
  kpis_constrained?: Kpis;
  benchmark_kpis?: Kpis;

  latest_holdings_detailed?: Holding[];
  latest_holdings_detailed_enriched?: Holding[];
  latest_holdings_detailed_constrained?: Holding[] | null;
  latest_portfolio_date?: string;

  portfolio_kpis_original?: PortfolioKpis;
  portfolio_kpis_constrained?: PortfolioKpis;
};

type AggregatedHolding = {
  key: string;
  displayTicker: string;
  companyShort: string;
  country: string;
  zone: string;
  sector: string;
  weight: number;
  weightPct: number;
  componentTickers: string[];
};

const COLORS = {
  bg: "#09090b",
  panel: "#18181b",
  panel2: "#1a2d59",
  line: "#d4d4d4",
  text: "#ffffff",
  muted: "#b7c3e0",
  border: "rgba(255,255,255,0.08)",
};

function pct(value?: number | null, decimals = 2): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "-";
  return `${(value * 100).toFixed(decimals)}%`;
}

function num(value?: number | null, decimals = 2): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "-";
  return value.toFixed(decimals);
}

function issuerKeyFromTicker(ticker: string): string {
  const t = (ticker || "").toUpperCase().trim();
  if (t === "GOOG" || t === "GOOGL") return "ALPHABET";
  return t;
}

function normalizeZone(value?: string): string {
  const z = (value || "").toUpperCase().trim();
  if (z === "US" || z === "USA") return "US";
  if (z === "EU" || z === "EUR" || z === "EUROPE") return "EU";
  if (z === "JP" || z === "JAPAN") return "JP";
  if (z === "CAN" || z === "CA" || z === "CANADA") return "CAN";
  if (!z) return "";
  return "OTHER";
}

function aggregateHoldings(holdings: Holding[] = []): AggregatedHolding[] {
  const map = new Map<string, AggregatedHolding>();

  for (const item of holdings) {
    const ticker = String(item.ticker || "").toUpperCase().trim();
    if (!ticker) continue;

    const key = issuerKeyFromTicker(ticker);
    const weight = Number(item.weight || 0);

    const companyShort = String(item.short_name || item.name || key).trim() || key;

    const country =
      String(item.country || "").trim() ||
      (item.region && String(item.region).length > 2 ? String(item.region).trim() : "") ||
      "";

    const zone = normalizeZone(item.zone) || normalizeZone(item.region) || "OTHER";
    const sector = String(item.sector || "").trim() || "Other";

    if (!map.has(key)) {
      map.set(key, {
        key,
        displayTicker: key,
        companyShort,
        country,
        zone,
        sector,
        weight: 0,
        weightPct: 0,
        componentTickers: [],
      });
    }

    const row = map.get(key)!;
    row.weight += weight;

    if (!row.country && country) row.country = country;
    if ((!row.zone || row.zone === "OTHER") && zone) row.zone = zone;
    if ((!row.sector || row.sector === "Other") && sector) row.sector = sector;
    if ((!row.companyShort || row.companyShort === key) && companyShort) row.companyShort = companyShort;

    if (!row.componentTickers.includes(ticker)) row.componentTickers.push(ticker);
  }

  return Array.from(map.values())
    .map((row) => {
      row.componentTickers.sort();
      row.weightPct = row.weight * 100;
      return row;
    })
    .sort((a, b) => b.weight - a.weight);
}

const pageStyle: React.CSSProperties = {
  minHeight: "100vh",
  background: COLORS.bg,
  color: COLORS.text,
  padding: "20px 20px 30px 20px",
  fontFamily: DECIDE_APP_FONT_FAMILY,
};

const panelStyle: React.CSSProperties = {
  background: COLORS.panel,
  borderRadius: 22,
  padding: 18,
  border: `1px solid ${COLORS.border}`,
  boxShadow: "0 8px 30px rgba(0,0,0,0.18)",
};

const sectionTitleStyle: React.CSSProperties = {
  fontSize: 16,
  fontWeight: 800,
  marginBottom: 8,
  textAlign: "left",
};

const smallMetricLabelStyle: React.CSSProperties = {
  color: COLORS.muted,
  fontSize: 11,
  marginBottom: 6,
  textAlign: "left",
};

const smallMetricValueStyle: React.CSSProperties = {
  fontSize: 16,
  fontWeight: 800,
  lineHeight: 1.1,
  textAlign: "left",
};

function SmallMetricCard({ title, value, subtitle }: { title: string; value: string; subtitle?: string }) {
  return (
    <div style={{ ...panelStyle, textAlign: "left" }}>
      <div style={smallMetricLabelStyle}>{title}</div>
      <div style={smallMetricValueStyle}>{value}</div>
      {subtitle ? <div style={{ ...smallMetricLabelStyle, marginTop: 10 }}>{subtitle}</div> : null}
    </div>
  );
}

function KpiColumn({
  title,
  kpis,
}: {
  title: string;
  kpis: Kpis;
}) {
  return (
    <div style={panelStyle}>
      <div style={sectionTitleStyle}>{title}</div>
      <div style={{ display: "grid", gap: 12, marginTop: 10 }}>
        <div style={{ background: COLORS.panel2, borderRadius: 16, padding: 14, border: `1px solid ${COLORS.border}` }}>
          <div style={smallMetricLabelStyle}>CAGR</div>
          <div style={smallMetricValueStyle}>{pct(kpis.cagr)}</div>
        </div>
        <div style={{ background: COLORS.panel2, borderRadius: 16, padding: 14, border: `1px solid ${COLORS.border}` }}>
          <div style={smallMetricLabelStyle}>Sharpe</div>
          <div style={smallMetricValueStyle}>{num(kpis.sharpe)}</div>
        </div>
        <div style={{ background: COLORS.panel2, borderRadius: 16, padding: 14, border: `1px solid ${COLORS.border}` }}>
          <div style={smallMetricLabelStyle}>Vol</div>
          <div style={smallMetricValueStyle}>{pct(kpis.vol)}</div>
        </div>
        <div style={{ background: COLORS.panel2, borderRadius: 16, padding: 14, border: `1px solid ${COLORS.border}` }}>
          <div style={smallMetricLabelStyle}>Max DD</div>
          <div style={smallMetricValueStyle}>{pct(kpis.max_drawdown)}</div>
        </div>
      </div>
    </div>
  );
}

export default function DashboardFreeze() {
  const [payload, setPayload] = useState<RunModelResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  async function load() {
    setLoading(true);
    setErrorMsg("");
    try {
      const res = await fetch(`/api/proxy/api/run-model?profile=moderado`, { cache: "no-store" });
      if (!res.ok) throw new Error(`Falha /api/proxy/api/run-model (${res.status})`);
      setPayload((await res.json()) as RunModelResponse);
    } catch (e: any) {
      setErrorMsg(e?.message || "Erro ao carregar dados.");
      setPayload(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const meta = payload?.meta || {};

  const holdingsOriginal =
    payload?.latest_holdings_detailed_enriched ||
    payload?.latest_holdings_detailed ||
    [];

  const holdingsConstrained = (payload?.latest_holdings_detailed_constrained || undefined) as Holding[] | undefined;
  const holdingsToShow = holdingsConstrained && holdingsConstrained.length > 0 ? holdingsConstrained : holdingsOriginal;
  const showingLabel = holdingsConstrained && holdingsConstrained.length > 0 ? "Constrained" : "Original";

  const kpisPortfolio =
    (holdingsConstrained && holdingsConstrained.length > 0 ? payload?.portfolio_kpis_constrained : payload?.portfolio_kpis_original) ||
    (payload?.portfolio_kpis_constrained || payload?.portfolio_kpis_original) ||
    {};

  const kpisOriginal = payload?.kpis || {};
  const kpisConstrained = payload?.kpis_constrained || payload?.kpis || {};
  const kpisBench = payload?.benchmark_kpis || {};

  const aggregated = useMemo(() => aggregateHoldings(holdingsToShow), [holdingsToShow]);

  const zones = kpisPortfolio?.zones || {};
  const topSectors = kpisPortfolio?.top_sectors || [];

  return (
    <>
      <Head>
        <title>DECIDE Dashboard (Freeze)</title>
        <meta charSet="utf-8" />
      </Head>

      <div style={pageStyle}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 18, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 54, fontWeight: 800, letterSpacing: "-0.03em", lineHeight: 1 }}>DECIDE Dashboard</div>
            <div style={{ color: COLORS.muted, fontSize: 17, marginTop: 12 }}>Carteira freeze com KPIs de performance e carteira.</div>
          </div>

          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <button
              onClick={load}
              style={{
                background: COLORS.line,
                color: "#fff",
                border: "1px solid rgba(255,255,255,0.3)",
                borderRadius: 14,
                padding: "13px 22px",
                fontSize: 15,
                fontWeight: 800,
                cursor: "pointer",
                fontFamily: DECIDE_APP_FONT_FAMILY,
              }}
            >
              {loading ? "A atualizar..." : "Atualizar"}
            </button>

            <div
              style={{
                background: COLORS.panel2,
                border: `1px solid ${COLORS.border}`,
                borderRadius: 14,
                padding: "13px 16px",
                fontSize: 13,
                fontWeight: 800,
                color: COLORS.text,
              }}
            >
              A mostrar: <span style={{ color: "#fff" }}>{showingLabel}</span>
            </div>
          </div>
        </div>

        <div style={{ marginTop: 20, marginBottom: 10 }}>
          <DashboardQuickLinks />
        </div>

        {errorMsg ? <div style={{ ...panelStyle, marginTop: 18, color: "#ffd5d5" }}>{errorMsg}</div> : null}

        {/* KPIs de performance */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16, marginTop: 18 }}>
          <KpiColumn title="KPIs Performance — Original" kpis={kpisOriginal} />
          <KpiColumn title="KPIs Performance — Constrained" kpis={kpisConstrained} />
          <KpiColumn title="KPIs Performance — Benchmark" kpis={kpisBench} />
        </div>

        {/* KPIs de carteira */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 16, marginTop: 18 }}>
          <SmallMetricCard title="Posições" value={String(kpisPortfolio.n_positions ?? aggregated.length ?? "-")} subtitle="n_positions" />
          <SmallMetricCard title="Gross" value={pct(kpisPortfolio.gross_exposure)} subtitle="gross_exposure" />
          <SmallMetricCard title="Top 1" value={pct(kpisPortfolio.top1_weight)} subtitle="top1_weight" />
          <SmallMetricCard title="HHI" value={num(kpisPortfolio.hhi, 4)} subtitle="concentração" />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 16, marginTop: 16 }}>
          <SmallMetricCard title="Top 5" value={pct(kpisPortfolio.top5_weight)} subtitle="top5_weight" />
          <SmallMetricCard title="Top 10" value={pct(kpisPortfolio.top10_weight)} subtitle="top10_weight" />
          <SmallMetricCard title="US" value={pct(zones["US"])} subtitle="peso absoluto" />
          <SmallMetricCard title="EU" value={pct(zones["EU"])} subtitle="peso absoluto" />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 16, marginTop: 16 }}>
          <SmallMetricCard title="JP" value={pct(zones["JP"])} subtitle="peso absoluto" />
          <SmallMetricCard title="CAN" value={pct(zones["CAN"])} subtitle="peso absoluto" />
          <SmallMetricCard title="Other" value={pct(zones["OTHER"])} subtitle="peso absoluto" />
          <SmallMetricCard title="Build backend" value={meta.main_version || "-"} subtitle="main_version" />
        </div>

        <div style={{ ...panelStyle, marginTop: 16 }}>
          <div style={sectionTitleStyle}>Top setores</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 12 }}>
            {topSectors.slice(0, 8).map((s) => (
              <div
                key={s.sector}
                style={{
                  background: COLORS.panel2,
                  borderRadius: 16,
                  padding: 14,
                  border: `1px solid ${COLORS.border}`,
                  textAlign: "left",
                }}
              >
                <div style={{ color: COLORS.muted, fontSize: 12, fontWeight: 700 }}>{s.sector}</div>
                <div style={{ fontSize: 16, fontWeight: 800, marginTop: 6 }}>{pct(s.weight)}</div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ ...panelStyle, marginTop: 16 }}>
          <div style={sectionTitleStyle}>Carteira ({showingLabel})</div>
          <div style={{ color: COLORS.muted, marginBottom: 16, fontSize: 13, textAlign: "left" }}>
            Modelo: {meta.engine || "-"} | Data: {payload?.latest_portfolio_date || meta.latest_portfolio_date || "-"} | build: {meta.main_version || "-"}
          </div>

          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
              <thead>
                <tr style={{ textAlign: "left", borderBottom: `1px solid ${COLORS.border}` }}>
                  <th style={{ padding: "12px 10px" }}>Rank</th>
                  <th style={{ padding: "12px 10px" }}>Ticker</th>
                  <th style={{ padding: "12px 10px" }}>Empresa</th>
                  <th style={{ padding: "12px 10px" }}>País</th>
                  <th style={{ padding: "12px 10px" }}>Zona</th>
                  <th style={{ padding: "12px 10px" }}>Setor</th>
                  <th style={{ padding: "12px 10px" }}>Peso</th>
                  <th style={{ padding: "12px 10px" }}>Peso %</th>
                </tr>
              </thead>
              <tbody>
                {aggregated.map((h, idx) => (
                  <tr key={h.key} style={{ borderBottom: `1px solid ${COLORS.border}` }}>
                    <td style={{ padding: "12px 10px" }}>{idx + 1}</td>
                    <td style={{ padding: "12px 10px", fontWeight: 800 }}>{h.displayTicker}</td>
                    <td style={{ padding: "12px 10px" }}>{h.companyShort}</td>
                    <td style={{ padding: "12px 10px" }}>{h.country}</td>
                    <td style={{ padding: "12px 10px" }}>{h.zone}</td>
                    <td style={{ padding: "12px 10px" }}>{h.sector}</td>
                    <td style={{ padding: "12px 10px" }}>{h.weight.toFixed(6)}</td>
                    <td style={{ padding: "12px 10px" }}>{h.weightPct.toFixed(2)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ marginTop: 14, color: "#ffd5d5", fontSize: 13, textAlign: "left" }}>
            Nota: os KPIs “Constrained” de performance só ficam diferentes quando fizermos o backtest histórico constrained (pesos constrained por data).
          </div>
        </div>
      </div>
    </>
  );
}