import React, { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import ClientFlowDashboardButton from "../components/ClientFlowDashboardButton";

const Plot = dynamic(() => import("react-plotly.js"), { ssr: false });

type SeriesPayload = {
  dates: string[];
  equity_overlayed: number[];
  benchmark_equity: number[];
};

type MetaPayload = {
  profile?: string;
  data_start?: string;
  data_end?: string;
};

type DashboardPayload = {
  meta?: MetaPayload;
  series?: SeriesPayload;
};

type PlanMode = "segment_a_fixed" | "segment_b_mgmt_pf";
type ClientSegment = "A" | "B";

type FeeBreakdownPoint = {
  date: string;
  gross: number;
  net: number;
  mgmtFeeCum: number;
  perfFeeCum: number;
  totalFeesCum: number;
};

function safeNumber(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function formatPct(value: unknown, decimals = 2): string {
  const n = safeNumber(value, NaN);
  if (!Number.isFinite(n)) return "—";
  return `${(n * 100).toFixed(decimals)}%`;
}

function formatEuro(value: unknown, decimals = 0): string {
  const n = safeNumber(value, NaN);
  if (!Number.isFinite(n)) return "—";
  return `${n.toLocaleString("pt-PT", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}€`;
}

function formatNumber(value: unknown, decimals = 2): string {
  const n = safeNumber(value, NaN);
  if (!Number.isFinite(n)) return "—";
  return n.toFixed(decimals);
}

function annualizedReturnFromEquity(equity: number[], dates: string[]): number {
  if (equity.length < 2 || dates.length < 2) return 0;
  const start = safeNumber(equity[0], 0);
  const end = safeNumber(equity[equity.length - 1], 0);
  if (start <= 0 || end <= 0) return 0;

  const startDate = new Date(dates[0]);
  const endDate = new Date(dates[dates.length - 1]);
  const years = Math.max((endDate.getTime() - startDate.getTime()) / (365.25 * 24 * 3600 * 1000), 0);
  if (years <= 0) return 0;

  return Math.pow(end / start, 1 / years) - 1;
}

function dailyReturnsFromEquity(equity: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < equity.length; i += 1) {
    const prev = safeNumber(equity[i - 1], 0);
    const curr = safeNumber(equity[i], 0);
    out.push(prev > 0 ? curr / prev - 1 : 0);
  }
  return out;
}

function annualizedVolFromEquity(equity: number[]): number {
  const r = dailyReturnsFromEquity(equity);
  if (r.length < 2) return 0;
  const mean = r.reduce((a, b) => a + b, 0) / r.length;
  const variance = r.reduce((a, b) => a + (b - mean) ** 2, 0) / r.length;
  return Math.sqrt(variance) * Math.sqrt(252);
}

function sharpeFromEquity(equity: number[], dates: string[]): number {
  const cagr = annualizedReturnFromEquity(equity, dates);
  const vol = annualizedVolFromEquity(equity);
  return vol > 0 ? cagr / vol : 0;
}

function maxDrawdownFromEquity(equity: number[]): number {
  if (!equity.length) return 0;
  let peak = safeNumber(equity[0], 0);
  let worst = 0;
  for (const v0 of equity) {
    const v = safeNumber(v0, 0);
    if (v > peak) peak = v;
    const dd = peak > 0 ? v / peak - 1 : 0;
    if (dd < worst) worst = dd;
  }
  return worst;
}

function totalReturnFromEquity(equity: number[]): number {
  if (equity.length < 2) return 0;
  const start = safeNumber(equity[0], 0);
  const end = safeNumber(equity[equity.length - 1], 0);
  return start > 0 ? end / start - 1 : 0;
}

function monthKey(d: string): string {
  return String(d).slice(0, 7);
}

function yearKey(d: string): string {
  return String(d).slice(0, 4);
}

function scaleEquityByCapital(equity: number[], capital: number): number[] {
  const c = Math.max(1, safeNumber(capital, 20000));
  return equity.map((x) => safeNumber(x, 0) * c);
}

function applyFeesToEquity(
  dates: string[],
  grossEquityScaled: number[],
  benchmarkEquityScaled: number[],
  planMode: PlanMode,
): { points: FeeBreakdownPoint[]; segment: ClientSegment } {
  const points: FeeBreakdownPoint[] = [];
  if (!dates.length || !grossEquityScaled.length || dates.length !== grossEquityScaled.length) {
    return { points, segment: planMode === "segment_a_fixed" ? "A" : "B" };
  }

  let net = safeNumber(grossEquityScaled[0], 0);
  let mgmtFeeCum = 0;
  let perfFeeCum = 0;

  const segment: ClientSegment = planMode === "segment_a_fixed" ? "A" : "B";
  const dailyMgmtRate = segment === "B" ? 0.006 / 252 : 0;

  let currentYear = yearKey(dates[0]);
  let yearStartNet = net;
  let yearStartBench = safeNumber(benchmarkEquityScaled[0], 0);

  for (let i = 0; i < dates.length; i += 1) {
    const date = dates[i];
    const gross = safeNumber(grossEquityScaled[i], 0);
    const bench = safeNumber(
      benchmarkEquityScaled[i],
      benchmarkEquityScaled[Math.min(i, benchmarkEquityScaled.length - 1)] ?? 0,
    );

    if (i === 0) {
      points.push({
        date,
        gross,
        net,
        mgmtFeeCum,
        perfFeeCum,
        totalFeesCum: mgmtFeeCum + perfFeeCum,
      });
      continue;
    }

    const prevGross = safeNumber(grossEquityScaled[i - 1], 0);
    const grossRet = prevGross > 0 ? gross / prevGross - 1 : 0;
    net = net * (1 + grossRet);

    if (segment === "B") {
      const mgmtFeeToday = net * dailyMgmtRate;
      net -= mgmtFeeToday;
      mgmtFeeCum += mgmtFeeToday;
    }

    const prevMonth = monthKey(dates[i - 1]);
    const currMonth = monthKey(date);
    if (segment === "A" && prevMonth !== currMonth) {
      const fixedMonthly = 20;
      net = Math.max(0, net - fixedMonthly);
      mgmtFeeCum += fixedMonthly;
    }

    const nextYear = i < dates.length - 1 ? yearKey(dates[i + 1]) : null;
    const thisYear = yearKey(date);
    const isYearEnd = nextYear !== thisYear;

    if (segment === "B") {
      if (thisYear !== currentYear) {
        currentYear = thisYear;
        yearStartNet = points[points.length - 1].net;
        yearStartBench = safeNumber(benchmarkEquityScaled[i - 1], yearStartBench);
      }

      if (isYearEnd) {
        const portRet = yearStartNet > 0 ? net / yearStartNet - 1 : 0;
        const benchRet = yearStartBench > 0 ? bench / yearStartBench - 1 : 0;
        const outperformance = portRet - benchRet;

        if (portRet > 0 && outperformance > 0) {
          const perfFee = net * (0.15 * outperformance);
          net -= perfFee;
          perfFeeCum += perfFee;
        }
      }
    }

    points.push({
      date,
      gross,
      net,
      mgmtFeeCum,
      perfFeeCum,
      totalFeesCum: mgmtFeeCum + perfFeeCum,
    });
  }

  return { points, segment };
}

function KPIBox({ title, value }: { title: string; value: string }) {
  return (
    <div
      style={{
        background: "#020b24",
        border: "1px solid #15305b",
        borderRadius: 18,
        padding: 18,
      }}
    >
      <div style={{ color: "#9fb3d1", fontSize: 14, marginBottom: 10 }}>{title}</div>
      <div style={{ color: "#fff", fontSize: 28, fontWeight: 700 }}>{value}</div>
    </div>
  );
}

export default function FeesClientPage() {
  const [payload, setPayload] = useState<DashboardPayload | null>(null);
  const [error, setError] = useState("");
  const [profile, setProfile] = useState("moderado");
  const [planMode, setPlanMode] = useState<PlanMode>("segment_a_fixed");
  const [capitalInvestido, setCapitalInvestido] = useState(20000);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        setError("");
        const res = await fetch(`/api/proxy/run-model?profile=${encodeURIComponent(profile)}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as DashboardPayload;
        if (!cancelled) setPayload(json);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Erro a carregar");
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [profile]);

  const dates = payload?.series?.dates ?? [];
  const grossEquityBase = payload?.series?.equity_overlayed ?? [];
  const benchmarkEquityBase = payload?.series?.benchmark_equity ?? [];

  const grossEquity = useMemo(
    () => scaleEquityByCapital(grossEquityBase, capitalInvestido),
    [grossEquityBase, capitalInvestido],
  );

  const benchmarkEquity = useMemo(
    () => scaleEquityByCapital(benchmarkEquityBase, capitalInvestido),
    [benchmarkEquityBase, capitalInvestido],
  );

  const feeResult = useMemo(
    () => applyFeesToEquity(dates, grossEquity, benchmarkEquity, planMode),
    [dates, grossEquity, benchmarkEquity, planMode],
  );

  const netEquity = feeResult.points.map((p) => p.net);
  const mgmtFeeCum = feeResult.points.map((p) => p.mgmtFeeCum);
  const perfFeeCum = feeResult.points.map((p) => p.perfFeeCum);
  const totalFeeCum = feeResult.points.map((p) => p.totalFeesCum);

  const grossKpis = useMemo(
    () => ({
      cagr: annualizedReturnFromEquity(grossEquity, dates),
      vol: annualizedVolFromEquity(grossEquity),
      sharpe: sharpeFromEquity(grossEquity, dates),
      maxDD: maxDrawdownFromEquity(grossEquity),
      totalReturn: totalReturnFromEquity(grossEquity),
    }),
    [grossEquity, dates],
  );

  const netKpis = useMemo(
    () => ({
      cagr: annualizedReturnFromEquity(netEquity, dates),
      vol: annualizedVolFromEquity(netEquity),
      sharpe: sharpeFromEquity(netEquity, dates),
      maxDD: maxDrawdownFromEquity(netEquity),
      totalReturn: totalReturnFromEquity(netEquity),
    }),
    [netEquity, dates],
  );

  const totalMgmtFees = mgmtFeeCum.length ? mgmtFeeCum[mgmtFeeCum.length - 1] : 0;
  const totalPerfFees = perfFeeCum.length ? perfFeeCum[perfFeeCum.length - 1] : 0;
  const totalFees = totalFeeCum.length ? totalFeeCum[totalFeeCum.length - 1] : 0;
  const impactCagr = netKpis.cagr - grossKpis.cagr;

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#000",
        color: "#fff",
        padding: 32,
        fontFamily: "Inter, Arial, sans-serif",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 20, marginBottom: 24 }}>
        <div>
          <div style={{ fontSize: 40, fontWeight: 800 }}>DECIDE — Fees Client</div>
          <div style={{ color: "#9fb3d1", fontSize: 18 }}>
            Página separada do core. Simulação líquida de comissões sobre a curva overlayed.
          </div>
        </div>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
          <ClientFlowDashboardButton />
        </div>
      </div>

      {error ? (
        <div style={{ background: "#2a0a0a", border: "1px solid #7f1d1d", padding: 16, borderRadius: 14 }}>
          Erro: {error}
        </div>
      ) : null}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr 1fr",
          gap: 16,
          marginBottom: 24,
        }}
      >
        <div style={{ background: "#020b24", border: "1px solid #15305b", borderRadius: 18, padding: 18 }}>
          <div style={{ color: "#9fb3d1", marginBottom: 8 }}>Perfil</div>
          <select
            value={profile}
            onChange={(e) => setProfile(e.target.value)}
            style={{
              width: "100%",
              background: "#020816",
              color: "#fff",
              border: "1px solid #15305b",
              borderRadius: 12,
              padding: 12,
              fontSize: 16,
            }}
          >
            <option value="moderado">Moderado</option>
            <option value="conservador">Conservador</option>
            <option value="dinamico">Dinâmico</option>
          </select>
        </div>

        <div style={{ background: "#020b24", border: "1px solid #15305b", borderRadius: 18, padding: 18 }}>
          <div style={{ color: "#9fb3d1", marginBottom: 8 }}>Plano de comissões</div>
          <select
            value={planMode}
            onChange={(e) => setPlanMode(e.target.value as PlanMode)}
            style={{
              width: "100%",
              background: "#020816",
              color: "#fff",
              border: "1px solid #15305b",
              borderRadius: 12,
              padding: 12,
              fontSize: 16,
            }}
          >
            <option value="segment_a_fixed">Segmento A — 20€/mês</option>
            <option value="segment_b_mgmt_pf">Segmento B — 0,6% + 15% outperformance</option>
          </select>
        </div>

        <div style={{ background: "#020b24", border: "1px solid #15305b", borderRadius: 18, padding: 18 }}>
          <div style={{ color: "#9fb3d1", marginBottom: 8 }}>Capital investido (€)</div>
          <input
            type="number"
            min={1000}
            step={1000}
            value={capitalInvestido}
            onChange={(e) => setCapitalInvestido(Math.max(1000, safeNumber(e.target.value, 20000)))}
            style={{
              width: "100%",
              background: "#020816",
              color: "#fff",
              border: "1px solid #15305b",
              borderRadius: 12,
              padding: 12,
              fontSize: 16,
            }}
          />
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 16, marginBottom: 24 }}>
        <KPIBox title="Capital investido" value={formatEuro(capitalInvestido, 0)} />
        <KPIBox title="Management fee acumulada" value={formatEuro(totalMgmtFees, 0)} />
        <KPIBox title="Performance fee acumulada" value={formatEuro(totalPerfFees, 0)} />
        <KPIBox title="Fees totais" value={formatEuro(totalFees, 0)} />
        <KPIBox title="Segmento" value={feeResult.segment} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 16, marginBottom: 24 }}>
        <KPIBox title="CAGR bruto" value={formatPct(grossKpis.cagr)} />
        <KPIBox title="CAGR líquido" value={formatPct(netKpis.cagr)} />
        <KPIBox title="Impacto no CAGR" value={formatPct(impactCagr)} />
        <KPIBox title="Sharpe bruto" value={formatNumber(grossKpis.sharpe)} />
        <KPIBox title="Sharpe líquido" value={formatNumber(netKpis.sharpe)} />
        <KPIBox title="Max DD líquido" value={formatPct(netKpis.maxDD)} />
      </div>

      <div
        style={{
          background: "#020b24",
          border: "1px solid #15305b",
          borderRadius: 22,
          padding: 20,
          marginBottom: 24,
        }}
      >
        <div style={{ fontSize: 24, fontWeight: 800, marginBottom: 8 }}>Curva bruta vs líquida</div>
        <div style={{ color: "#9fb3d1", marginBottom: 14 }}>
          A curva líquida é calculada apenas no frontend, separadamente do core do modelo.
        </div>
        <Plot
          data={[
            {
              x: dates,
              y: grossEquity,
              type: "scatter",
              mode: "lines",
              name: "Modelo bruto",
              line: { width: 3, color: "#22c55e" },
            },
            {
              x: dates,
              y: netEquity,
              type: "scatter",
              mode: "lines",
              name: "Modelo líquido",
              line: { width: 3, color: "#f59e0b" },
            },
            {
              x: dates,
              y: benchmarkEquity,
              type: "scatter",
              mode: "lines",
              name: "Benchmark",
              line: { width: 2, color: "#94a3b8" },
            },
          ]}
          layout={{
            autosize: true,
            height: 520,
            paper_bgcolor: "#020b24",
            plot_bgcolor: "#020b24",
            font: { color: "#dbeafe" },
            margin: { l: 70, r: 20, t: 20, b: 70 },
            yaxis: { type: "log", gridcolor: "#16315d" },
            xaxis: { gridcolor: "#16315d" },
            legend: { orientation: "h", x: 0.5, xanchor: "center", y: -0.15 },
          }}
          config={{ responsive: true, displaylogo: false }}
          style={{ width: "100%" }}
        />
      </div>

      <div
        style={{
          background: "#020b24",
          border: "1px solid #15305b",
          borderRadius: 22,
          padding: 20,
        }}
      >
        <div style={{ fontSize: 24, fontWeight: 800, marginBottom: 8 }}>Fees acumuladas</div>
        <Plot
          data={[
            {
              x: dates,
              y: mgmtFeeCum,
              type: "scatter",
              mode: "lines",
              name: "Management fee acumulada",
              line: { width: 3, color: "#38bdf8" },
            },
            {
              x: dates,
              y: perfFeeCum,
              type: "scatter",
              mode: "lines",
              name: "Performance fee acumulada",
              line: { width: 3, color: "#ef4444" },
            },
            {
              x: dates,
              y: totalFeeCum,
              type: "scatter",
              mode: "lines",
              name: "Fees totais",
              line: { width: 3, color: "#f59e0b" },
            },
          ]}
          layout={{
            autosize: true,
            height: 420,
            paper_bgcolor: "#020b24",
            plot_bgcolor: "#020b24",
            font: { color: "#dbeafe" },
            margin: { l: 70, r: 20, t: 20, b: 70 },
            yaxis: { gridcolor: "#16315d" },
            xaxis: { gridcolor: "#16315d" },
            legend: { orientation: "h", x: 0.5, xanchor: "center", y: -0.18 },
          }}
          config={{ responsive: true, displaylogo: false }}
          style={{ width: "100%" }}
        />
      </div>
    </div>
  );
}