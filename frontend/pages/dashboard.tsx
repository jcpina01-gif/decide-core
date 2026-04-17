import Head from "next/head";
import Link from "next/link";
import React, { useEffect, useMemo, useState } from "react";
import ThousandsNumberInput, { asThousandsNumberChange } from "../components/ThousandsNumberInput";
import { onThousandsFieldRowPointerDownCapture } from "../lib/thousandsFieldRowFocus";
import { buildSimulatorSeries, TRADING_DAYS_PER_YEAR } from "../lib/decideSimulator";
import { DECIDE_DEFAULT_INVEST_EUR, DECIDE_MIN_INVEST_EUR } from "../lib/decideInvestPrefill";
import EquityCurvesChart from "../components/EquityCurvesChart";
import DashboardQuickLinks from "../components/DashboardQuickLinks";
import DecideFaqPanel from "../components/DecideFaqPanel";
import { DECIDE_APP_FONT_FAMILY } from "../lib/decideClientTheme";
import { applyJapaneseEquityDashboardHoldingPatch } from "../lib/tickerGeoFallback";

type Holding = {
  ticker?: string;
  weight?: number;
  weight_pct?: number;
  short_name?: string;
  name_short?: string;
  name?: string;
  company?: string;
  country?: string;
  zone?: string;
  region?: string;
  sector?: string;
  subindustry?: string;
  score?: number | null;
  rank_momentum?: number | null;
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

type RunModelSummary = {
  current_equity_exposure?: number | null;
  current_cash_sleeve?: number | null;
  /** Motor v5: mesmo valor que `current_cash_sleeve` quando este não vem preenchido. */
  latest_cash_sleeve?: number | null;
  avg_cash_sleeve?: number | null;
  max_cash_sleeve?: number | null;

  current_equity_exposure_constrained?: number | null;
  current_cash_sleeve_constrained?: number | null;
  latest_cash_sleeve_constrained?: number | null;
  avg_cash_sleeve_constrained?: number | null;
  max_cash_sleeve_constrained?: number | null;
};

type RunModelMeta = {
  engine?: string;
  data_file_used?: string;
  data_start?: string;
  data_end?: string;
  latest_portfolio_date?: string;
  latest_cash_sleeve?: number | null;
  constraints_applied?: boolean;
  constraints_source?: string;
};

type RunModelSeries = {
  dates?: string[];
  equity_raw?: number[];
  equity_raw_volmatched?: number[];
  equity_overlayed?: number[];
  equity_overlayed_constrained?: number[];
  benchmark_equity?: number[];
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
  summary?: RunModelSummary;

  kpis?: Kpis;
  kpis_constrained?: Kpis;

  benchmark_kpis?: Kpis;
  raw_kpis?: Kpis;
  raw_volmatched_kpis?: Kpis;
  overlay_pre_vol_kpis?: Kpis;

  latest_holdings_detailed?: Holding[];
  latest_holdings_detailed_constrained?: Holding[];

  portfolio_kpis_original?: PortfolioKpis;
  portfolio_kpis_constrained?: PortfolioKpis;

  latest_portfolio_date?: string;
  series?: RunModelSeries;
};

type TabKey = "kpis" | "simulador" | "performance" | "carteira" | "faq";

const SIM_MIN_CAPITAL_EUR = DECIDE_MIN_INVEST_EUR;

function fmtEur0(n: number): string {
  if (!Number.isFinite(n)) return "—";
  try {
    return new Intl.NumberFormat("pt-PT", {
      style: "currency",
      currency: "EUR",
      maximumFractionDigits: 0,
      minimumFractionDigits: 0,
    }).format(n);
  } catch {
    return `${Math.round(n).toLocaleString("pt-PT")} €`;
  }
}
type RiskProfileKey = "conservador" | "moderado" | "dinamico";
type PortfolioViewKey = "original" | "constrained";

const COLORS = {
  bg: "#09090b",
  panel: "#18181b",
  panel2: "#1a2d59",
  line: "#d4d4d4",
  text: "#ffffff",
  muted: "#b7c3e0",
  border: "rgba(255,255,255,0.08)",
};

const PROFILE_LABELS: Record<RiskProfileKey, string> = {
  conservador: "Conservador",
  moderado: "Moderado",
  dinamico: "Dinâmico",
};

function pct(value?: number | null, decimals = 2): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "-";
  return `${(value * 100).toFixed(decimals)}%`;
}

function num(value?: number | null, decimals = 2): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "-";
  return value.toFixed(decimals);
}

function intNum(value?: number | null): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "-";
  return String(Math.round(value));
}

function clampNumber(x: number, lo: number, hi: number): number {
  if (!Number.isFinite(x)) return lo;
  return Math.max(lo, Math.min(hi, x));
}

function pctSafeFromWeight(value?: number | null, decimals = 2): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "-";
  const v = clampNumber(Number(value), -10, 10);
  return `${(v * 100).toFixed(decimals)}%`;
}

function fmtGross(value?: number | null, decimals = 2): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "-";
  const v = clampNumber(Number(value), 0, 2);
  const snapped = Math.abs(v - 1.0) < 1e-10 ? 1.0 : v;
  return `${(snapped * 100).toFixed(decimals)}%`;
}

function isCashSleeveTicker(t?: string): boolean {
  const u = String(t || "").toUpperCase().trim();
  return u === "TBILL_PROXY" || u === "BIL" || u === "SHV";
}

/**
 * Os pesos do backend são muitas vezes **só dentro do sleeve acionista** (somam ~100% em ações).
 * «Equity atual» e «T-Bills atuais» no painel de KPIs são **frações do NAV total** (overlay).
 * Esta função re-escala as ações para `equityFrac` e acrescenta uma linha T-Bills com `cashFrac`.
 */
function navAlignedHoldingsFromSummary(
  rows: Holding[],
  equityFrac: number | null | undefined,
  cashFrac: number | null | undefined,
): Holding[] | null {
  const E = Number(equityFrac);
  const C = Number(cashFrac);
  if (!Number.isFinite(E) || !Number.isFinite(C)) return null;
  if (E < 0 || C < 0) return null;
  const sumEC = E + C;
  if (sumEC < 0.85 || sumEC > 1.15) return null;
  const stocks = rows.filter((r) => !isCashSleeveTicker(r.ticker));
  const riskySum = stocks.reduce((a, r) => a + Number(r.weight || 0), 0);
  if (!(riskySum > 1e-9)) return null;
  const scaled: Holding[] = stocks
    .map((r) => {
      const w = Number(r.weight || 0);
      const wNav = (w / riskySum) * E;
      return { ...r, weight: wNav, weight_pct: wNav * 100 };
    })
    .sort((a, b) => (Number(b.weight) || 0) - (Number(a.weight) || 0));
  scaled.push({
    ticker: "TBILL_PROXY",
    weight: C,
    weight_pct: C * 100,
    short_name: "T-Bills",
    name: "T-Bills (sleeve defensiva — alinhado ao modelo)",
    sector: "Cash / Bills",
    region: "US",
    country: "United States",
    zone: "CASH",
    score: null,
    rank_momentum: null,
  });
  return scaled;
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

const statLabelStyle: React.CSSProperties = {
  color: COLORS.muted,
  fontSize: 12,
  marginBottom: 6,
  textAlign: "left",
};

const statValueStyle: React.CSSProperties = {
  fontSize: 18,
  fontWeight: 800,
  lineHeight: 1.15,
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

function KpiColumnCard({ title, items }: { title: string; items: Array<{ label: string; value: string }> }) {
  return (
    <div style={panelStyle}>
      <div style={sectionTitleStyle}>{title}</div>
      <div style={{ display: "grid", gap: 12, marginTop: 10 }}>
        {items.map((item) => (
          <div
            key={item.label}
            style={{
              background: COLORS.panel2,
              borderRadius: 16,
              padding: 14,
              border: `1px solid ${COLORS.border}`,
              textAlign: "left",
            }}
          >
            <div style={statLabelStyle}>{item.label}</div>
            <div style={statValueStyle}>{item.value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function SmallMetricCard({ title, value, subtitle }: { title: string; value: string; subtitle?: string }) {
  return (
    <div style={{ ...panelStyle, textAlign: "left" }}>
      <div style={smallMetricLabelStyle}>{title}</div>
      <div style={smallMetricValueStyle}>{value}</div>
      {subtitle ? <div style={{ ...smallMetricLabelStyle, marginTop: 10 }}>{subtitle}</div> : null}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        background: active ? COLORS.line : COLORS.panel2,
        color: COLORS.text,
        border: active ? "1px solid rgba(255,255,255,0.35)" : `1px solid ${COLORS.border}`,
        borderRadius: 14,
        padding: "11px 18px",
        fontSize: 14,
        fontWeight: 800,
        cursor: "pointer",
        fontFamily: DECIDE_APP_FONT_FAMILY,
      }}
    >
      {children}
    </button>
  );
}

function safeArray<T>(x: any): T[] {
  return Array.isArray(x) ? (x as T[]) : [];
}

function firstFiniteNumber(...vals: unknown[]): number | null {
  for (const v of vals) {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function holdingDisplayName(h: Holding): string {
  const a = String(h.short_name || "").trim();
  const b = String((h as any).name_short || "").trim();
  const c = String(h.name || "").trim();
  const d = String((h as any).company || "").trim();
  return a || b || c || d || String(h.ticker || "").trim();
}

function zoneKey(z?: string | null): string {
  const v = String(z || "").trim().toUpperCase();
  if (!v) return "OTHER";
  if (v === "CASH" || v === "TBILLS" || v === "BILLS") return "CASH";
  if (v === "USA" || v === "US") return "US";
  if (v === "EU" || v === "EUR" || v === "EUROPE") return "EU";
  if (v === "JP" || v === "JPN" || v === "JAPAN") return "JP";
  if (v === "CAN" || v === "CA" || v === "CANADA") return "CAN";
  if (v === "OTHER") return "OTHER";
  return v;
}

type ZoneBucket = "US" | "EU" | "JP" | "CAN" | "CASH" | "OTHER";

function zoneAggregateKey(z?: string | null): ZoneBucket {
  const k = zoneKey(z);
  if (k === "US" || k === "EU" || k === "JP" || k === "CAN" || k === "CASH" || k === "OTHER") return k;
  return "OTHER";
}

function zonesFromHoldingsRows(rows: Holding[]): Record<ZoneBucket, number> {
  const out: Record<ZoneBucket, number> = { US: 0, EU: 0, JP: 0, CAN: 0, CASH: 0, OTHER: 0 };
  for (const h of rows) {
    const w = Number(h.weight || 0);
    if (!Number.isFinite(w)) continue;
    const b = zoneAggregateKey(h.zone || h.region);
    out[b] += w;
  }
  return out;
}

function countryKey(value?: string | null, zone?: string | null): string {
  const v = String(value || "").trim();
  const u = v.toUpperCase();
  if (!v) {
    const z = zoneKey(zone);
    if (z === "US") return "United States";
    if (z === "CAN") return "Canada";
    if (z === "JP") return "Japan";
    if (z === "EU") return "Various Europe";
    return "N/A";
  }
  if (u === "US" || u === "USA" || u === "UNITED STATES" || u === "UNITED STATES OF AMERICA") {
    return "United States";
  }
  if (u === "CAN" || u === "CA" || u === "CANADA") return "Canada";
  if (u === "JP" || u === "JPN" || u === "JAPAN") return "Japan";
  if (u === "EU" || u === "EUR" || u === "EUROPE" || u === "EUROPEAN UNION" || u === "VARIOUS EUROPE") {
    return "Various Europe";
  }
  return v;
}

export default function DashboardPage() {
  const [activeTab, setActiveTab] = useState<TabKey>("kpis");
  const [selectedProfile, setSelectedProfile] = useState<RiskProfileKey>("moderado");
  const [payload, setPayload] = useState<RunModelResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  const [portfolioView, setPortfolioView] = useState<PortfolioViewKey>("constrained");
  const [simCapital, setSimCapital] = useState(DECIDE_DEFAULT_INVEST_EUR);
  const [simYears, setSimYears] = useState(20);

  async function loadAll(profile: RiskProfileKey) {
    setLoading(true);
    setErrorMsg("");
    try {
      // ✅ IMPORTANT: proxy must include /api/* because backend routes are /api/health and /api/run-model
      const res = await fetch(`/api/proxy/api/run-model?profile=${encodeURIComponent(profile)}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`Falha /api/proxy/api/run-model (${res.status})`);
      setPayload((await res.json()) as RunModelResponse);
    } catch (err: any) {
      setErrorMsg(err?.message || "Erro ao carregar dados.");
      setPayload(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAll(selectedProfile);
  }, [selectedProfile]);

  const meta = payload?.meta || {};
  const summary = payload?.summary || {};
  const series = payload?.series || {};

  const kpisOriginal = payload?.kpis || {};
  const kpisConstrained = payload?.kpis_constrained || {};
  const benchmarkKpis = payload?.benchmark_kpis || {};

  const hasConstrainedSeries = Boolean((series.equity_overlayed_constrained || []).length);
  const hasConstrainedKpis = Boolean(kpisConstrained && kpisConstrained.cagr !== undefined && kpisConstrained.cagr !== null);
  const hasConstrained = Boolean(meta.constraints_applied) && (hasConstrainedSeries || hasConstrainedKpis);

  useEffect(() => {
    if (!hasConstrained) setPortfolioView("original");
    else setPortfolioView("constrained");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasConstrained, selectedProfile]);

  const kpisForStats = hasConstrained ? kpisConstrained : kpisOriginal;

  const positiveMonths = Number(kpisForStats.positive_months || 0);
  const negativeMonths = Number(kpisForStats.negative_months || 0);
  const monthsTotal = positiveMonths + negativeMonths;
  const monthsAbove = Number(kpisForStats.months_above_benchmark || 0);
  const monthsBelow = Math.max(0, monthsTotal - monthsAbove);

  const tbillsMedios = hasConstrained ? (summary.avg_cash_sleeve_constrained ?? summary.avg_cash_sleeve) : summary.avg_cash_sleeve;
  const tbillsMaximos = hasConstrained ? (summary.max_cash_sleeve_constrained ?? summary.max_cash_sleeve) : summary.max_cash_sleeve;

  const tbillsAtuais = hasConstrained
    ? firstFiniteNumber(
        summary.current_cash_sleeve_constrained,
        summary.current_cash_sleeve,
        summary.latest_cash_sleeve_constrained,
        summary.latest_cash_sleeve,
        meta.latest_cash_sleeve,
      )
    : firstFiniteNumber(summary.current_cash_sleeve, summary.latest_cash_sleeve, meta.latest_cash_sleeve);

  let equityAtual = hasConstrained
    ? firstFiniteNumber(summary.current_equity_exposure_constrained, summary.current_equity_exposure)
    : firstFiniteNumber(summary.current_equity_exposure);
  if (equityAtual == null && tbillsAtuais != null) {
    equityAtual = Math.max(0, Math.min(1, 1 - tbillsAtuais));
  }

  const chartLines = useMemo(() => {
    const dates = series.dates || [];
    const model = series.equity_overlayed || [];
    const bench = series.benchmark_equity || [];
    const con = series.equity_overlayed_constrained || [];
    const vm = series.equity_raw_volmatched || [];

    return {
      dates,
      lines: [
        { name: "Benchmark", values: bench, color: "#d4d4d4" },
        { name: "Overlayed Original", values: model, color: "#4ade80" },
        ...(hasConstrainedSeries ? [{ name: "Overlayed Constraints", values: con, color: "#c084fc" }] : []),
        { name: "Raw Vol-Matched", values: vm, color: "#fb923c" },
      ],
    };
  }, [series, hasConstrainedSeries]);

  /** Mesma lógica que KPIs: constrained quando existir, senão overlay original. */
  const modelSeriesForSim = useMemo(() => {
    if (hasConstrained && (series.equity_overlayed_constrained || []).length > 0) {
      return series.equity_overlayed_constrained as number[];
    }
    return (series.equity_overlayed || []) as number[];
  }, [series.equity_overlayed, series.equity_overlayed_constrained, hasConstrained]);

  const benchSeriesForSim = (series.benchmark_equity || []) as number[];
  const simDates = series.dates || [];

  const simResult = useMemo(
    () => buildSimulatorSeries(simDates, modelSeriesForSim, benchSeriesForSim, simYears, simCapital),
    [simDates, modelSeriesForSim, benchSeriesForSim, simYears, simCapital],
  );

  const maxSimYears = useMemo(() => {
    const n = simDates.length;
    if (n < 2) return 100;
    return (n - 1) / TRADING_DAYS_PER_YEAR;
  }, [simDates]);

  const simModelLabel = hasConstrained ? "Modelo DECIDE (constraints)" : "Modelo DECIDE (overlay)";

  const simRegisterHref = useMemo(() => {
    const c = Math.max(SIM_MIN_CAPITAL_EUR, Math.round(Number(simCapital) || 0));
    return `/client/register?capital=${encodeURIComponent(String(c))}`;
  }, [simCapital]);

  const simDeltaLine = useMemo(() => {
    if (!simResult.ok) return null;
    return "Diferença ilustrativa face ao mercado no mesmo período. Os montantes finais estão nos cartões acima.";
  }, [simResult.ok]);

  const portfolioOriginalRows = safeArray<Holding>(payload?.latest_holdings_detailed);
  const portfolioConstrainedRows = safeArray<Holding>(payload?.latest_holdings_detailed_constrained);

  const portfolioRows: Holding[] = useMemo(() => {
    if (portfolioView === "constrained" && hasConstrained) return portfolioConstrainedRows;
    return portfolioOriginalRows;
  }, [portfolioView, hasConstrained, portfolioOriginalRows, portfolioConstrainedRows]);

  const portfolioKpisOriginal: PortfolioKpis = payload?.portfolio_kpis_original || {};
  const portfolioKpisConstrained: PortfolioKpis = payload?.portfolio_kpis_constrained || {};

  const portfolioKpis: PortfolioKpis = useMemo(() => {
    if (portfolioView === "constrained" && hasConstrained) return portfolioKpisConstrained;
    return portfolioKpisOriginal;
  }, [portfolioView, hasConstrained, portfolioKpisOriginal, portfolioKpisConstrained]);

  const portfolioTitle = useMemo(() => {
    if (portfolioView === "constrained" && hasConstrained) return "Carteira (Constraints)";
    return "Carteira (Original)";
  }, [portfolioView, hasConstrained]);

  const grossShown = portfolioKpis?.gross_exposure ?? portfolioRows.reduce((a, r) => a + Number(r.weight || 0), 0);
  const top1 = portfolioKpis?.top1_weight ?? 0;
  const top5 = portfolioKpis?.top5_weight ?? 0;
  const top10 = portfolioKpis?.top10_weight ?? 0;
  const hhi = portfolioKpis?.hhi ?? 0;
  const npos = portfolioKpis?.n_positions ?? portfolioRows.length;

  const topSectors = safeArray<{ sector: string; weight: number }>(portfolioKpis?.top_sectors).slice(0, 4);
  while (topSectors.length < 4) topSectors.push({ sector: "-", weight: 0 });

  const navAlignedPortfolioRows = useMemo(
    () => navAlignedHoldingsFromSummary(portfolioRows, equityAtual, tbillsAtuais),
    [portfolioRows, equityAtual, tbillsAtuais],
  );

  const holdingsTableRows = navAlignedPortfolioRows ?? portfolioRows;

  const holdingsTableRowsForUi = useMemo(
    () => holdingsTableRows.map((h) => applyJapaneseEquityDashboardHoldingPatch(h)),
    [holdingsTableRows],
  );

  const zonesApi = portfolioKpis?.zones || {};
  const zonesFromTable = useMemo(() => zonesFromHoldingsRows(holdingsTableRowsForUi), [holdingsTableRowsForUi]);
  const zones = useMemo(() => {
    const zApi = zonesApi as Record<string, number>;
    // Com alinhamento NAV, a linha T-Bills usa zona CASH — o backend muitas vezes não a devolve em portfolio_kpis.
    if (navAlignedPortfolioRows) return zonesFromTable;
    return {
      US: Number(zApi.US || 0),
      EU: Number(zApi.EU || 0),
      JP: Number(zApi.JP || 0),
      CAN: Number(zApi.CAN || 0),
      CASH: Number(zApi.CASH || 0),
      OTHER: Number(zApi.OTHER || 0),
    };
  }, [zonesApi, navAlignedPortfolioRows, zonesFromTable]);
  const zoneUS = zones.US;
  const zoneEU = zones.EU;
  const zoneJP = zones.JP;
  const zoneCAN = zones.CAN;
  const zoneCASH = zones.CASH;
  const zoneOTHER = zones.OTHER;

  const holdingsTableSumWeight = useMemo(
    () => holdingsTableRowsForUi.reduce((a, r) => a + Number(r.weight || 0), 0),
    [holdingsTableRowsForUi],
  );

  const hasTBillsRawResidual = useMemo(() => {
    return portfolioRows.some((r) => String(r.ticker || "").toUpperCase().trim() === "TBILL_PROXY");
  }, [portfolioRows]);

  const tbillRowRaw = useMemo(() => {
    return portfolioRows.find((r) => String(r.ticker || "").toUpperCase().trim() === "TBILL_PROXY");
  }, [portfolioRows]);

  return (
    <>
      <Head>
        <title>DECIDE Dashboard</title>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>

      <div style={pageStyle}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 18, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 54, fontWeight: 800, letterSpacing: "-0.03em", lineHeight: 1 }}>DECIDE Dashboard</div>
            <div style={{ color: COLORS.muted, fontSize: 17, marginTop: 12 }}>
              KPIs, performance e carteira (original vs constraints).
            </div>
          </div>

          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <button
              onClick={() => loadAll(selectedProfile)}
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
          </div>
        </div>

        <div style={{ marginTop: 20, marginBottom: 10 }}>
          <DashboardQuickLinks />
        </div>

        <div style={{ display: "flex", gap: 12, marginTop: 24, flexWrap: "wrap", alignItems: "center" }}>
          <TabButton active={activeTab === "kpis"} onClick={() => setActiveTab("kpis")}>KPIs</TabButton>
          <TabButton active={activeTab === "simulador"} onClick={() => setActiveTab("simulador")}>Simulador</TabButton>
          <TabButton active={activeTab === "performance"} onClick={() => setActiveTab("performance")}>Performance</TabButton>
          <TabButton active={activeTab === "carteira"} onClick={() => setActiveTab("carteira")}>
            Carteira detalhada
          </TabButton>
          <TabButton active={activeTab === "faq"} onClick={() => setActiveTab("faq")}>
            FAQs
          </TabButton>

          <div
            style={{
              marginLeft: 8,
              background: COLORS.panel2,
              border: `1px solid ${COLORS.border}`,
              borderRadius: 14,
              padding: "8px 12px",
              display: "flex",
              alignItems: "center",
              gap: 10,
            }}
          >
            <span style={{ color: COLORS.muted, fontSize: 13, fontWeight: 700 }}>Nível de risco</span>
            <select
              value={selectedProfile}
              onChange={(e) => setSelectedProfile(e.target.value as RiskProfileKey)}
              style={{
                background: "transparent",
                color: COLORS.text,
                border: "none",
                outline: "none",
                fontSize: 14,
                fontWeight: 800,
                fontFamily: DECIDE_APP_FONT_FAMILY,
                cursor: "pointer",
              }}
            >
              <option value="conservador" style={{ color: "#000" }}>Conservador</option>
              <option value="moderado" style={{ color: "#000" }}>Moderado</option>
              <option value="dinamico" style={{ color: "#000" }}>Dinâmico</option>
            </select>
          </div>

          {activeTab === "carteira" ? (
            <div
              style={{
                marginLeft: 0,
                background: COLORS.panel2,
                border: `1px solid ${COLORS.border}`,
                borderRadius: 14,
                padding: "8px 12px",
                display: "flex",
                alignItems: "center",
                gap: 10,
              }}
            >
              <span style={{ color: COLORS.muted, fontSize: 13, fontWeight: 700 }}>Vista</span>
              <select
                value={portfolioView}
                onChange={(e) => setPortfolioView(e.target.value as PortfolioViewKey)}
                disabled={!hasConstrained}
                style={{
                  background: "transparent",
                  color: COLORS.text,
                  border: "none",
                  outline: "none",
                  fontSize: 14,
                  fontWeight: 800,
                  fontFamily: DECIDE_APP_FONT_FAMILY,
                  cursor: hasConstrained ? "pointer" : "not-allowed",
                }}
              >
                <option value="original" style={{ color: "#000" }}>Original</option>
                <option value="constrained" style={{ color: "#000" }}>Constraints</option>
              </select>
            </div>
          ) : null}
        </div>

        {errorMsg ? <div style={{ ...panelStyle, marginTop: 18, color: "#ffd5d5" }}>{errorMsg}</div> : null}

        {activeTab === "kpis" && (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16, marginTop: 18 }}>
              <KpiColumnCard
                title={`KPIs do Modelo Original — ${PROFILE_LABELS[selectedProfile]}`}
                items={[
                  { label: "CAGR", value: pct(kpisOriginal.cagr) },
                  { label: "Sharpe", value: num(kpisOriginal.sharpe) },
                  { label: "Vol", value: pct(kpisOriginal.vol) },
                  { label: "Max DD", value: pct(kpisOriginal.max_drawdown) },
                ]}
              />

              <KpiColumnCard
                title={`KPIs do Modelo com Constraints — ${PROFILE_LABELS[selectedProfile]}`}
                items={[
                  { label: "CAGR", value: hasConstrained ? pct(kpisConstrained.cagr) : "-" },
                  { label: "Sharpe", value: hasConstrained ? num(kpisConstrained.sharpe) : "-" },
                  { label: "Vol", value: hasConstrained ? pct(kpisConstrained.vol) : "-" },
                  { label: "Max DD", value: hasConstrained ? pct(kpisConstrained.max_drawdown) : "-" },
                ]}
              />

              <KpiColumnCard
                title="KPIs do Benchmark"
                items={[
                  { label: "CAGR", value: pct(benchmarkKpis.cagr) },
                  { label: "Sharpe", value: num(benchmarkKpis.sharpe) },
                  { label: "Vol", value: pct(benchmarkKpis.vol) },
                  { label: "Max DD", value: pct(benchmarkKpis.max_drawdown) },
                ]}
              />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 16, marginTop: 16 }}>
              <SmallMetricCard title="Melhor mês" value={pct(kpisForStats.best_month)} />
              <SmallMetricCard title="Pior mês" value={pct(kpisForStats.worst_month)} />
              <SmallMetricCard title="Meses positivos" value={intNum(kpisForStats.positive_months)} subtitle={hasConstrained ? "Modelo com constraints" : "Modelo original"} />
              <SmallMetricCard title="Meses negativos" value={intNum(kpisForStats.negative_months)} subtitle={hasConstrained ? "Modelo com constraints" : "Modelo original"} />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 16, marginTop: 16 }}>
              <SmallMetricCard title="Acima benchmark" value={intNum(kpisForStats.months_above_benchmark)} subtitle="Meses acima do bench" />
              <SmallMetricCard title="Abaixo benchmark" value={intNum(monthsBelow)} subtitle="Meses abaixo do bench" />
              <SmallMetricCard title="Constraints ativas" value={meta.constraints_applied ? "Sim" : "Não"} subtitle={meta.constraints_source || "—"} />
              <SmallMetricCard title="Modelo" value={meta.engine || "-"} subtitle="engine" />
            </div>

            <div style={{ ...panelStyle, marginTop: 16 }}>
              <div style={sectionTitleStyle}>Exposição do Modelo {hasConstrained ? "com Constraints" : "Original"}</div>
              <div style={{ color: COLORS.muted, fontSize: 12, textAlign: "left" }}>
                Equity/T-Bills atuais e métricas defensivas.
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 16, marginTop: 16 }}>
                <SmallMetricCard title="Equity atual" value={pctSafeFromWeight(equityAtual)} subtitle="Exposição atual" />
                <SmallMetricCard title="T-Bills atuais" value={pctSafeFromWeight(tbillsAtuais)} subtitle="Sleeve defensiva" />
                <SmallMetricCard title="T-Bills médios" value={pctSafeFromWeight(tbillsMedios)} subtitle="Média histórica" />
                <SmallMetricCard title="T-Bills máximos" value={pctSafeFromWeight(tbillsMaximos)} subtitle="Máximo histórico" />
              </div>
            </div>
          </>
        )}

        {activeTab === "simulador" && (
          <div style={{ marginTop: 18, display: "grid", gap: 16 }}>
            <div style={panelStyle}>
              <div
                style={{
                  fontSize: "clamp(1.05rem, 2.2vw, 1.35rem)",
                  fontWeight: 900,
                  color: COLORS.text,
                  marginBottom: 10,
                  lineHeight: 1.25,
                }}
              >
                Veja quanto poderia ter crescido o seu capital
              </div>
              <p
                style={{
                  color: "#e2e8f0",
                  fontSize: 15,
                  fontWeight: 700,
                  textAlign: "left",
                  lineHeight: 1.45,
                  margin: "0 0 12px",
                }}
              >
                Ajuste o valor e veja o impacto.
                <span
                  title="Valores baseados em histórico. O nível de risco no topo recarrega o modelo (moderado: alvo ≈1× vol do referencial no motor; conservador/dinâmico: alvo vs benchmark). A curva segue o overlay dos KPIs. Os valores atualizam ao alterar os campos."
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: 18,
                    height: 18,
                    marginLeft: 8,
                    borderRadius: 999,
                    fontSize: 11,
                    fontWeight: 900,
                    color: "#042f2e",
                    background: "rgba(45,212,191,0.85)",
                    cursor: "help",
                    verticalAlign: "middle",
                  }}
                >
                  i
                </span>
              </p>
              <div
                style={{
                  marginTop: 0,
                  padding: "12px 16px",
                  borderRadius: 12,
                  background: "rgba(39, 39, 42, 0.65)",
                  border: "1px solid rgba(255, 255, 255, 0.1)",
                  color: "#d4d4d8",
                  fontSize: 14,
                  fontWeight: 700,
                  boxShadow: "0 2px 10px rgba(0, 0, 0, 0.35)",
                }}
              >
                <strong style={{ color: "#f4f4f5" }}>Exemplo pré-preenchido:</strong>{" "}
                <strong style={{ color: "#e4e4e7" }}>
                  {DECIDE_DEFAULT_INVEST_EUR.toLocaleString("pt-PT")} €
                </strong>{" "}
                durante{" "}
                <strong style={{ color: "#e4e4e7" }}>20 anos</strong>. Pode alterar os campos abaixo.
              </div>
              <div
                onPointerDownCapture={onThousandsFieldRowPointerDownCapture}
                style={{ display: "flex", flexWrap: "wrap", gap: 16, marginTop: 16, alignItems: "flex-end" }}
              >
                <label style={{ display: "flex", flexDirection: "column", gap: 6, color: COLORS.muted, fontSize: 12, fontWeight: 700 }}>
                  Capital inicial (€) — mín. 5 000 €
                  <ThousandsNumberInput
                    min={SIM_MIN_CAPITAL_EUR}
                    maxDecimals={0}
                    value={simCapital}
                    onChange={asThousandsNumberChange(setSimCapital)}
                    style={{
                      background: COLORS.panel2,
                      border: `1px solid ${COLORS.border}`,
                      borderRadius: 12,
                      padding: "10px 12px",
                      color: COLORS.text,
                      fontSize: 15,
                      fontWeight: 800,
                      minWidth: 160,
                    }}
                  />
                </label>
                <label style={{ display: "flex", flexDirection: "column", gap: 6, color: COLORS.muted, fontSize: 12, fontWeight: 700 }}>
                  Anos (desde o investimento)
                  <ThousandsNumberInput
                    min={0.5}
                    max={maxSimYears}
                    maxDecimals={1}
                    value={simYears}
                    onChange={asThousandsNumberChange(setSimYears)}
                    style={{
                      background: COLORS.panel2,
                      border: `1px solid ${COLORS.border}`,
                      borderRadius: 12,
                      padding: "10px 12px",
                      color: COLORS.text,
                      fontSize: 15,
                      fontWeight: 800,
                      minWidth: 120,
                    }}
                  />
                </label>
              </div>
            </div>

            {!simResult.ok ? (
              <div style={{ ...panelStyle, color: "#fecaca" }}>{simResult.message}</div>
            ) : (
              <>
                {simResult.warn ? (
                  <div style={{ ...panelStyle, color: "#fcd34d", fontSize: 14 }}>{simResult.warn}</div>
                ) : null}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 16 }}>
                  <div
                    style={{
                      ...panelStyle,
                      textAlign: "center",
                      border: "1px solid rgba(82, 82, 91, 0.55)",
                      background: "linear-gradient(165deg, rgba(42, 42, 44, 0.95), rgba(24, 24, 27, 0.98))",
                      boxShadow: "0 2px 14px rgba(0, 0, 0, 0.4)",
                    }}
                  >
                    <div style={{ color: COLORS.muted, fontSize: 12, fontWeight: 800 }}>{simModelLabel} — valor final</div>
                    <div
                      style={{
                        marginTop: 10,
                        fontSize: "clamp(1.5rem, 4.2vw, 2.15rem)",
                        fontWeight: 900,
                        letterSpacing: "-0.03em",
                        color: "#e4e4e7",
                        textShadow: "none",
                      }}
                    >
                      {fmtEur0(simResult.modelEnd)}
                    </div>
                    <div style={{ color: COLORS.muted, fontSize: 11, marginTop: 6 }}>ilustrativo</div>
                  </div>
                  <div
                    style={{
                      ...panelStyle,
                      textAlign: "center",
                      border: "1px solid rgba(82, 82, 91, 0.5)",
                      background: "linear-gradient(180deg, rgba(39,39,42,0.9) 0%, rgba(24,24,27,0.95) 100%)",
                    }}
                  >
                    <div style={{ color: COLORS.muted, fontSize: 12, fontWeight: 800 }}>Benchmark — valor final</div>
                    <div
                      style={{
                        marginTop: 10,
                        fontSize: "clamp(1.35rem, 3.8vw, 1.95rem)",
                        fontWeight: 900,
                        letterSpacing: "-0.03em",
                        color: "#d4d4d4",
                        textShadow: "none",
                      }}
                    >
                      {fmtEur0(simResult.benchEnd)}
                    </div>
                    <div style={{ color: COLORS.muted, fontSize: 11, marginTop: 6 }}>mesmo período</div>
                  </div>
                </div>
                {simDeltaLine ? (
                  <div
                    style={{
                      textAlign: "center",
                      fontSize: 13,
                      fontWeight: 500,
                      color: "#94a3b8",
                      padding: "10px 14px",
                      borderRadius: 12,
                      background: "rgba(24, 24, 27, 0.55)",
                      border: "1px solid rgba(63, 63, 70, 0.4)",
                      lineHeight: 1.5,
                    }}
                  >
                    {simDeltaLine}
                  </div>
                ) : null}
                <p
                  style={{
                    textAlign: "center",
                    fontSize: 15,
                    fontStyle: "italic",
                    fontWeight: 600,
                    color: "#cbd5e1",
                    lineHeight: 1.45,
                    margin: "0 0 16px",
                    padding: "0 8px",
                  }}
                >
                  Uma diferença que só o tempo e a disciplina revelam.
                </p>
                <SmallMetricCard title="Janela" value={simResult.windowLabel} subtitle="datas da série" />
                <div
                  style={{
                    ...panelStyle,
                    textAlign: "center",
                    border: "1px solid rgba(251,146,60,0.35)",
                    background: "linear-gradient(145deg, rgba(30,58,138,0.25), rgba(18,36,77,0.92))",
                  }}
                >
                  <p style={{ margin: "0 0 14px", fontSize: 16, fontWeight: 800, color: COLORS.text, lineHeight: 1.45 }}>
                    Quer começar agora com o seu capital?
                  </p>
                  <p style={{ margin: "0 0 12px", fontSize: 13, color: "#cbd5e1", fontWeight: 600, lineHeight: 1.45 }}>
                    Investimento mínimo{" "}
                    <strong style={{ color: "#e2e8f0" }}>{SIM_MIN_CAPITAL_EUR.toLocaleString("pt-PT")} €</strong>.
                  </p>
                  <Link
                    href={simRegisterHref}
                    style={{
                      display: "inline-block",
                      background: "linear-gradient(180deg, #fdba74 0%, #f97316 45%, #ea580c 100%)",
                      color: "#1c1917",
                      fontWeight: 900,
                      fontSize: 15,
                      padding: "14px 28px",
                      borderRadius: 14,
                      textDecoration: "none",
                      border: "1px solid rgba(255,237,213,0.45)",
                      boxShadow: "0 2px 12px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.2)",
                    }}
                  >
                    Começar com este valor
                  </Link>
                  <p style={{ margin: "12px 0 0", fontSize: 13, color: "#a1a1aa", fontWeight: 600, lineHeight: 1.5 }}>
                    Pode começar em poucos minutos.
                  </p>
                  <p style={{ margin: "4px 0 0", fontSize: 13, color: "#a1a1aa", fontWeight: 600, lineHeight: 1.5 }}>
                    Comece hoje — decide sempre.
                  </p>
                </div>
                <div style={panelStyle}>
                  <div style={sectionTitleStyle}>Evolução do capital (log)</div>
                  <div style={{ marginTop: 12 }}>
                    <EquityCurvesChart
                      dates={simResult.sliceDates}
                      series={[
                        { name: simModelLabel, values: simResult.modelVal, color: "#4ade80" },
                        { name: "Benchmark", values: simResult.benchVal, color: "#d4d4d4" },
                      ]}
                      logScale={true}
                    />
                  </div>
                </div>
                <p style={{ color: COLORS.muted, fontSize: 12, lineHeight: 1.5, margin: 0 }}>
                  Indicativo — não é garantia nem aconselhamento; resultados futuros podem diferir materialmente.
                </p>
              </>
            )}
          </div>
        )}

        {activeTab === "performance" && (
          <div style={{ marginTop: 18, display: "grid", gap: 16 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16 }}>
              <SmallMetricCard title="Data início" value={meta.data_start || "-"} />
              <SmallMetricCard title="Data fim" value={meta.data_end || "-"} />
              <SmallMetricCard title="Engine" value={meta.engine || "-"} />
            </div>

            <div style={panelStyle}>
              <div style={sectionTitleStyle}>Performance (escala log)</div>
              <div style={{ color: COLORS.muted, fontSize: 12, textAlign: "left" }}>
                Curvas: Benchmark, Overlayed Original, Overlayed Constraints (se existir), Raw Vol-Matched.
              </div>

              <div style={{ marginTop: 14 }}>
                <EquityCurvesChart dates={chartLines.dates} series={chartLines.lines} logScale={true} />
              </div>
            </div>
          </div>
        )}

        {activeTab === "faq" && (
          <div style={{ marginTop: 18 }}>
            <DecideFaqPanel />
          </div>
        )}

        {activeTab === "carteira" && (
          <div style={{ marginTop: 18, display: "grid", gap: 16 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr 1fr", gap: 16 }}>
              <SmallMetricCard title="Posições" value={intNum(npos)} subtitle={portfolioTitle} />
              <SmallMetricCard title="Gross" value={fmtGross(grossShown)} subtitle="soma dos pesos" />
              <SmallMetricCard title="Top 1" value={pctSafeFromWeight(top1)} subtitle="maior posição" />
              <SmallMetricCard title="Top 5" value={pctSafeFromWeight(top5)} subtitle="concentração" />
              <SmallMetricCard title="HHI" value={num(hhi, 4)} subtitle="concentração" />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 16 }}>
              <SmallMetricCard title="US" value={pctSafeFromWeight(zoneUS)} subtitle="equity zona" />
              <SmallMetricCard title="EU" value={pctSafeFromWeight(zoneEU)} subtitle="equity zona" />
              <SmallMetricCard title="JP" value={pctSafeFromWeight(zoneJP)} subtitle="equity zona" />
              <SmallMetricCard title="CAN" value={pctSafeFromWeight(zoneCAN)} subtitle="equity zona" />
              <SmallMetricCard title="Caixa (T-Bills)" value={pctSafeFromWeight(zoneCASH)} subtitle="zona CASH" />
              <SmallMetricCard title="Other" value={pctSafeFromWeight(zoneOTHER)} subtitle="peso absoluto" />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 16 }}>
              <SmallMetricCard title={topSectors[0].sector} value={pctSafeFromWeight(topSectors[0].weight)} subtitle="setor" />
              <SmallMetricCard title={topSectors[1].sector} value={pctSafeFromWeight(topSectors[1].weight)} subtitle="setor" />
              <SmallMetricCard title={topSectors[2].sector} value={pctSafeFromWeight(topSectors[2].weight)} subtitle="setor" />
              <SmallMetricCard title={topSectors[3].sector} value={pctSafeFromWeight(topSectors[3].weight)} subtitle="setor" />
            </div>

            {navAlignedPortfolioRows ? null : hasTBillsRawResidual ? (
              <div style={{ ...panelStyle, border: "1px solid rgba(255,255,255,0.14)" }}>
                <div style={sectionTitleStyle}>Residual em T-Bills (ficheiro bruto)</div>
                <div style={{ color: COLORS.muted, fontSize: 12, textAlign: "left" }}>
                  Linha opcional no CSV quando Σ ações &lt; 100% — <strong>não</strong> é a mesma coisa que «T-Bills atuais»
                  no bloco de exposição (esse valor vem do overlay no <b>summary</b>).
                </div>
                <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16 }}>
                  <SmallMetricCard title="Ticker" value="TBILL_PROXY" subtitle="proxy" />
                  <SmallMetricCard title="Peso" value={pctSafeFromWeight(tbillRowRaw?.weight)} subtitle="residual" />
                  <SmallMetricCard title="Peso (raw)" value={num(tbillRowRaw?.weight, 6)} subtitle="decimal" />
                </div>
              </div>
            ) : null}

            <div style={panelStyle}>
              <div style={sectionTitleStyle}>{portfolioTitle}</div>
              <div style={{ color: COLORS.muted, marginBottom: 16, fontSize: 13, textAlign: "left" }}>
                Modelo: {meta?.engine || "-"} | Data: {payload?.latest_portfolio_date || meta?.latest_portfolio_date || "-"}
                {navAlignedPortfolioRows ? (
                  <span>
                    {" "}
                    · <strong>Pesos na tabela = % do NAV</strong> (ações re-escaladas para «Equity atual» + linha T-Bills =
                    «T-Bills atuais»).
                  </span>
                ) : null}
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
                    {holdingsTableRowsForUi.map((h, idx) => {
                      const tk = String(h.ticker || "").toUpperCase().trim();
                      const company = holdingDisplayName(h);
                      const country = countryKey(h.country, h.zone || h.region);
                      const zone = zoneKey(h.zone || h.region);
                      const sector = String(h.sector || "").trim() || "Other";
                      const w = Number(h.weight || 0);
                      const wp = h.weight_pct !== undefined && h.weight_pct !== null ? Number(h.weight_pct) : w * 100;

                      return (
                        <tr key={`${tk}_${idx}`} style={{ borderBottom: `1px solid ${COLORS.border}` }}>
                          <td style={{ padding: "12px 10px", textAlign: "left" }}>{idx + 1}</td>
                          <td style={{ padding: "12px 10px", fontWeight: 800, textAlign: "left" }}>{tk || "-"}</td>
                          <td style={{ padding: "12px 10px", textAlign: "left" }}>{company}</td>
                          <td style={{ padding: "12px 10px", textAlign: "left" }}>{country || "-"}</td>
                          <td style={{ padding: "12px 10px", textAlign: "left" }}>{zone}</td>
                          <td style={{ padding: "12px 10px", textAlign: "left" }}>{sector}</td>
                          <td style={{ padding: "12px 10px", textAlign: "left" }}>{num(w, 6)}</td>
                          <td style={{ padding: "12px 10px", textAlign: "left" }}>{num(wp, 2)}%</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div style={{ marginTop: 14, color: COLORS.muted, fontSize: 13, textAlign: "left" }}>
                Σ pesos na tabela: <b>{fmtGross(holdingsTableSumWeight)}</b>
                {navAlignedPortfolioRows ? (
                  <>
                    {" "}
                    (alinhado a Equity atual + T-Bills atuais). Gross / geografia / setores nos cartões acima continuam a vir
                    de <b>portfolio_kpis_*</b> no backend.
                  </>
                ) : (
                  <>
                    {" "}
                    · Os pesos brutos costumam ser <b>só dentro do sleeve acionista</b> (~100% em ações); «Equity atual»
                    (~74%) e «T-Bills atuais» (~26%) descrevem o <b>NAV total</b> no overlay — por isso uma linha TBILL de
                    ~2,5% no CSV não contradiz os ~26%: são escalas diferentes até alinharmos (ou usar esta vista quando o
                    summary tiver os dois valores).
                  </>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}