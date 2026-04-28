import React, { useEffect, useMemo, useState } from "react";
import type { GetServerSideProps } from "next";
import dynamic from "next/dynamic";
import { useRouter } from "next/router";
import ClientFlowDashboardButton from "../components/ClientFlowDashboardButton";
import ThousandsNumberInput, { asThousandsNumberChange } from "../components/ThousandsNumberInput";
import { onThousandsFieldRowPointerDownCapture } from "../lib/thousandsFieldRowFocus";
import { DECIDE_APP_FONT_FAMILY } from "../lib/decideClientTheme";
import { buildSimulatorSeries } from "../lib/decideSimulator";
import { computeKpisFromSeries } from "../lib/computeKpisFromSeries";
import { DECIDE_PREMIUM_MONTHLY_FEE_EUR } from "../lib/decidePremiumFeeEur";

const Plot = dynamic(() => import("react-plotly.js"), { ssr: false });

function parseProfileQuery(p: unknown): "conservador" | "moderado" | "dinamico" | null {
  const s = typeof p === "string" ? p.trim().toLowerCase() : "";
  if (s === "conservador" || s === "moderado" || s === "dinamico") return s;
  return null;
}

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
type ClientSegment = "Premium" | "Private";

/** Séries e totais de fees alinhados à janela móvel (Anos). */
type FeesUiSlice = {
  chartDates: string[];
  chartGross: number[];
  chartNet: number[];
  chartBench: number[];
  mgmtFeeCum: number[];
  perfFeeCum: number[];
  totalFeeCum: number[];
  totalMgmtFees: number;
  totalPerfFees: number;
  totalFees: number;
  segment: ClientSegment;
};

/** Série bruta: freeze V5 (oficial) ou motor legacy só em fallback / pedido explícito na query. */
type FeesDataSource = "v5_cap15_freeze" | "run_model_v2";

/** Mínimo do campo «Capital» nesta página; alinhado a buildSimulatorSeries para a janela móvel. */
const FEES_SIM_MIN_EUR = 1000;

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

function lastTradingDayOfMonthInSeries(dates: string[], i: number): boolean {
  if (!dates.length || i < 0 || i >= dates.length) return false;
  if (i === dates.length - 1) return true;
  return monthKey(dates[i]) !== monthKey(dates[i + 1]);
}

function lastTradingDayOfYearInSeries(dates: string[], i: number): boolean {
  if (!dates.length || i < 0 || i >= dates.length) return false;
  if (i === dates.length - 1) return true;
  return yearKey(dates[i]) !== yearKey(dates[i + 1]);
}

/**
 * `grossEquityScaled` = curva do modelo (freeze/run-model), já com custos de mercado estimados no backtest.
 * Aqui só se aplicam comissões DECIDE (Premium / Private), sem voltar a descontar slippage/comissão de bolsa.
 */
function applyFeesToEquity(
  dates: string[],
  grossEquityScaled: number[],
  benchmarkEquityScaled: number[],
  planMode: PlanMode,
): { points: FeeBreakdownPoint[]; segment: ClientSegment } {
  const points: FeeBreakdownPoint[] = [];
  const segment: ClientSegment = planMode === "segment_a_fixed" ? "Premium" : "Private";
  if (!dates.length || !grossEquityScaled.length || dates.length !== grossEquityScaled.length) {
    return { points, segment };
  }

  let net = safeNumber(grossEquityScaled[0], 0);
  let mgmtFeeCum = 0;
  let perfFeeCum = 0;

  const isPrivate = segment === "Private";
  let monthNetSum = 0;
  let monthNetCount = 0;
  const bench0 = safeNumber(benchmarkEquityScaled[0], 0);
  let hwmRatio =
    isPrivate && bench0 > 0 ? net / bench0 : 0;

  if (isPrivate) {
    monthNetSum = net;
    monthNetCount = 1;
  }

  const applyPrivateMonthEnd = () => {
    if (!isPrivate || monthNetCount <= 0) return;
    const avgNav = monthNetSum / monthNetCount;
    const mgmtM = avgNav * 0.0005;
    net = Math.max(0, net - mgmtM);
    mgmtFeeCum += mgmtM;
    monthNetSum = 0;
    monthNetCount = 0;
  };

  if (isPrivate && lastTradingDayOfMonthInSeries(dates, 0)) {
    applyPrivateMonthEnd();
  }

  if (segment === "Premium" && lastTradingDayOfMonthInSeries(dates, 0)) {
    const fee = DECIDE_PREMIUM_MONTHLY_FEE_EUR;
    net = Math.max(0, net - fee);
    mgmtFeeCum += fee;
  }

  if (isPrivate && lastTradingDayOfYearInSeries(dates, 0)) {
    const bench = safeNumber(benchmarkEquityScaled[0], 0);
    if (bench > 0) {
      const r = net / bench;
      const excess = Math.max(0, r - hwmRatio);
      const lucroAlpha = excess * bench;
      const perfFee = 0.15 * lucroAlpha;
      if (perfFee > 0) {
        net = Math.max(0, net - perfFee);
        perfFeeCum += perfFee;
      }
      if (excess > 0) {
        hwmRatio = r;
      }
    }
  }

  points.push({
    date: dates[0],
    gross: safeNumber(grossEquityScaled[0], 0),
    net,
    mgmtFeeCum,
    perfFeeCum,
    totalFeesCum: mgmtFeeCum + perfFeeCum,
  });

  for (let i = 1; i < dates.length; i += 1) {
    const date = dates[i];
    const gross = safeNumber(grossEquityScaled[i], 0);
    const bench = safeNumber(
      benchmarkEquityScaled[i],
      benchmarkEquityScaled[Math.min(i, benchmarkEquityScaled.length - 1)] ?? 0,
    );

    const prevGross = safeNumber(grossEquityScaled[i - 1], 0);
    const grossRet = prevGross > 0 ? gross / prevGross - 1 : 0;
    net = net * (1 + grossRet);

    if (isPrivate) {
      monthNetSum += net;
      monthNetCount += 1;
    }

    if (isPrivate && lastTradingDayOfMonthInSeries(dates, i)) {
      applyPrivateMonthEnd();
    }

    if (segment === "Premium" && lastTradingDayOfMonthInSeries(dates, i)) {
      const fee = DECIDE_PREMIUM_MONTHLY_FEE_EUR;
      net = Math.max(0, net - fee);
      mgmtFeeCum += fee;
    }

    if (isPrivate && lastTradingDayOfYearInSeries(dates, i) && bench > 0) {
      const r = net / bench;
      const excess = Math.max(0, r - hwmRatio);
      const lucroAlpha = excess * bench;
      const perfFee = 0.15 * lucroAlpha;
      if (perfFee > 0) {
        net = Math.max(0, net - perfFee);
        perfFeeCum += perfFee;
      }
      if (excess > 0) {
        hwmRatio = r;
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

function KPIBox({
  title,
  value,
  embed,
}: {
  title: string;
  value: string;
  embed?: boolean;
}) {
  return (
    <div
      style={{
        background: embed ? "rgba(24,24,27,0.9)" : "#18181b",
        border: embed ? "1px solid rgba(63,63,70,0.75)" : "1px solid rgba(45,212,191,0.25)",
        borderRadius: 18,
        padding: 18,
      }}
    >
      <div style={{ color: "#fafafa", fontSize: 14, marginBottom: 10 }}>{title}</div>
      <div style={{ color: "#ffffff", fontSize: 28, fontWeight: 700 }}>{value}</div>
    </div>
  );
}

export default function FeesClientPage() {
  const router = useRouter();
  const embed = router.isReady && router.query.embed === "1";
  /** No dashboard: `fees_tab=intro` = texto; `fees_tab=sim` ou ausente = simulador. */
  const feesEmbedView =
    embed && router.isReady && String(router.query.fees_tab || "").toLowerCase() === "intro"
      ? "intro"
      : embed
        ? "sim"
        : "page";
  const panelBg = embed ? "rgba(24,24,27,0.92)" : "rgba(24,24,27,0.96)";
  const panelBorder = embed ? "1px solid rgba(63,63,70,0.75)" : "1px solid rgba(63,63,70,0.75)";
  const inputBg = embed ? "#0a0a0a" : "#18181b";
  const plotBg = embed ? "#18181b" : "#18181b";
  const [payload, setPayload] = useState<DashboardPayload | null>(null);
  const [error, setError] = useState("");
  const [profile, setProfile] = useState<"conservador" | "moderado" | "dinamico">(() => {
    if (typeof window === "undefined") return "moderado";
    const q = parseProfileQuery(new URLSearchParams(window.location.search).get("profile"));
    return q ?? "moderado";
  });
  const [planMode, setPlanMode] = useState<PlanMode>("segment_a_fixed");
  const [capitalInvestido, setCapitalInvestido] = useState(20000);
  /** Mesma lógica que o simulador do dashboard: ~252 × N dias úteis a contar do fim da série. */
  const [kpiHorizonYears, setKpiHorizonYears] = useState(20);
  /** Por defeito V5; `run_model` só se o freeze falhar ou query pedir motor legacy. */
  const [dataSource, setDataSource] = useState<FeesDataSource>("v5_cap15_freeze");
  const [runModelIsFallback, setRunModelIsFallback] = useState(false);

  /** No embed do dashboard o `src` do iframe inclui `?profile=` — manter o selector alinhado. */
  useEffect(() => {
    if (!router.isReady || !embed) return;
    const q = parseProfileQuery(router.query.profile);
    if (q) setProfile(q);
  }, [router.isReady, embed, router.query.profile]);

  useEffect(() => {
    if (feesEmbedView === "intro") return;
    let cancelled = false;

    const qSeries = router.isReady ? String(router.query.series || "").toLowerCase() : "";
    const qEngine = router.isReady
      ? String(router.query.fees_engine || router.query.engine || "").toLowerCase()
      : "";
    /** Forçar motor v2 (ex.: diagnóstico). Por defeito usa sempre o freeze V5. */
    const forceRunModel =
      router.isReady &&
      (qSeries === "run_model" ||
        qSeries === "v2" ||
        qEngine === "v2" ||
        qEngine === "run_model");

    async function loadRunModel(): Promise<void> {
      const q = `profile=${encodeURIComponent(profile)}`;
      let res = await fetch(`/api/proxy/api/run-model?${q}`, { cache: "no-store" });
      if (!res.ok) {
        res = await fetch(`/api/run-model?${q}`, { cache: "no-store" });
      }
      const text = await res.text();
      if (!res.ok) {
        let detail = "";
        try {
          const errBody = JSON.parse(text) as {
            error?: string;
            message?: string;
            hint?: string;
            backendBase?: string | null;
            ok?: boolean;
          };
          detail = (errBody.error || errBody.message || "").trim();
          if (errBody.hint) {
            detail = detail ? `${detail}. ${errBody.hint}` : errBody.hint;
          } else if (detail.toLowerCase() === "fetch failed" && errBody.backendBase) {
            detail = `${detail} (BACKEND_URL esperado: ${errBody.backendBase})`;
          }
        } catch {
          /* ignore */
        }
        throw new Error(detail ? `HTTP ${res.status}: ${detail}` : `HTTP ${res.status}`);
      }
      const json = JSON.parse(text) as DashboardPayload;
      if (!cancelled) setPayload(json);
    }

    async function load() {
      try {
        setError("");

        if (!forceRunModel) {
          const res = await fetch(
            `/api/landing/freeze-cap15-backtest?profile=${encodeURIComponent(profile)}`,
            { cache: "no-store" },
          );
          const text = await res.text();
          if (res.ok) {
            try {
              const data = JSON.parse(text) as {
                series?: { dates: string[]; benchmark_equity: number[]; equity_overlayed: number[] };
              };
              const s = data.series;
              if (s?.dates?.length && s.equity_overlayed?.length && s.benchmark_equity?.length) {
                if (!cancelled) {
                  setPayload({
                    series: {
                      dates: s.dates,
                      equity_overlayed: s.equity_overlayed,
                      benchmark_equity: s.benchmark_equity,
                    },
                    meta: { profile },
                  });
                  setDataSource("v5_cap15_freeze");
                  setRunModelIsFallback(false);
                }
                return;
              }
            } catch {
              /* continua para run-model */
            }
          }
          if (!cancelled) {
            setRunModelIsFallback(true);
          }
        } else {
          if (!cancelled) setRunModelIsFallback(false);
        }

        await loadRunModel();
        if (!cancelled) {
          setDataSource("run_model_v2");
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Erro a carregar");
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [
    profile,
    feesEmbedView,
    router.isReady,
    router.query.series,
    router.query.fees_engine,
    router.query.engine,
    router.query.profile,
    router.query.t,
  ]);

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

  const windowKpis = useMemo(() => {
    const empty = { cagr: 0, vol: 0, sharpe: 0, maxDD: 0, totalReturn: 0 };
    const n = dates.length;
    if (n < 2 || grossEquityBase.length < 2 || benchmarkEquityBase.length < 2) {
      return {
        grossKpis: empty,
        netKpis: empty,
        windowLabel: "—",
        warn: undefined as string | undefined,
        feesUi: null as FeesUiSlice | null,
      };
    }

    const cap = Math.max(FEES_SIM_MIN_EUR, capitalInvestido);
    /** Tem de ser ≥ minCapitalEur; o CAGR é invariante à escala (curva rebaseada ao início da janela). */
    const simNorm = buildSimulatorSeries(
      dates,
      grossEquityBase,
      benchmarkEquityBase,
      kpiHorizonYears,
      FEES_SIM_MIN_EUR,
      FEES_SIM_MIN_EUR,
    );

    const fullGross = computeKpisFromSeries(dates, grossEquity);
    const fullNet = computeKpisFromSeries(dates, netEquity);

    if (!simNorm.ok) {
      return {
        grossKpis: fullGross
          ? { cagr: fullGross.cagr, vol: fullGross.vol, sharpe: fullGross.sharpe, maxDD: fullGross.mdd, totalReturn: fullGross.totalReturn }
          : empty,
        netKpis: fullNet
          ? { cagr: fullNet.cagr, vol: fullNet.vol, sharpe: fullNet.sharpe, maxDD: fullNet.mdd, totalReturn: fullNet.totalReturn }
          : empty,
        windowLabel: `${dates[0]} → ${dates[n - 1]} (série completa)`,
        warn: simNorm.message,
        feesUi: null as FeesUiSlice | null,
      };
    }

    const gWin = computeKpisFromSeries(simNorm.sliceDates, simNorm.modelVal);
    const capSim = buildSimulatorSeries(
      dates,
      grossEquityBase,
      benchmarkEquityBase,
      kpiHorizonYears,
      cap,
      FEES_SIM_MIN_EUR,
    );

    if (!capSim.ok) {
      return {
        grossKpis: fullGross
          ? { cagr: fullGross.cagr, vol: fullGross.vol, sharpe: fullGross.sharpe, maxDD: fullGross.mdd, totalReturn: fullGross.totalReturn }
          : empty,
        netKpis: fullNet
          ? { cagr: fullNet.cagr, vol: fullNet.vol, sharpe: fullNet.sharpe, maxDD: fullNet.mdd, totalReturn: fullNet.totalReturn }
          : empty,
        windowLabel: `${dates[0]} → ${dates[n - 1]} (série completa)`,
        warn: capSim.message,
        feesUi: null as FeesUiSlice | null,
      };
    }

    const feeSlice = applyFeesToEquity(capSim.sliceDates, capSim.modelVal, capSim.benchVal, planMode);
    const netSlice = feeSlice.points.map((p) => p.net);
    const nWin = computeKpisFromSeries(capSim.sliceDates, netSlice);
    const lastPt = feeSlice.points[feeSlice.points.length - 1];
    const feesUi: FeesUiSlice = {
      chartDates: capSim.sliceDates,
      chartGross: capSim.modelVal,
      chartNet: feeSlice.points.map((p) => p.net),
      chartBench: capSim.benchVal,
      mgmtFeeCum: feeSlice.points.map((p) => p.mgmtFeeCum),
      perfFeeCum: feeSlice.points.map((p) => p.perfFeeCum),
      totalFeeCum: feeSlice.points.map((p) => p.totalFeesCum),
      totalMgmtFees: lastPt?.mgmtFeeCum ?? 0,
      totalPerfFees: lastPt?.perfFeeCum ?? 0,
      totalFees: lastPt?.totalFeesCum ?? 0,
      segment: feeSlice.segment,
    };

    const approxTradingYears = ((n - 1) / 252).toFixed(1);
    const windowCoversFullSeries =
      simNorm.sliceDates.length >= n - 1 && String(simNorm.sliceDates[0]) === String(dates[0]);
    const fullSeriesNote = windowCoversFullSeries
      ? `Esta resposta do motor tem ~${approxTradingYears} anos úteis no total; pediste ${kpiHorizonYears} a, mas a janela cobre (quase) toda a série — o CAGR fica igual ao do histórico completo. Um CAGR «maior nos últimos 20a» só aparece quando o backtest tem **mais** histórico do que esses ~${kpiHorizonYears} a (ex.: freeze CAP15 longo) e comparas só o troço final.`
      : undefined;

    return {
      grossKpis: gWin
        ? { cagr: gWin.cagr, vol: gWin.vol, sharpe: gWin.sharpe, maxDD: gWin.mdd, totalReturn: gWin.totalReturn }
        : empty,
      netKpis: nWin
        ? { cagr: nWin.cagr, vol: nWin.vol, sharpe: nWin.sharpe, maxDD: nWin.mdd, totalReturn: nWin.totalReturn }
        : empty,
      windowLabel: simNorm.windowLabel,
      warn: [simNorm.warn, fullSeriesNote].filter(Boolean).join(" ") || undefined,
      feesUi,
    };
  }, [
    dates,
    grossEquityBase,
    benchmarkEquityBase,
    grossEquity,
    netEquity,
    capitalInvestido,
    kpiHorizonYears,
    planMode,
  ]);

  const grossKpis = windowKpis.grossKpis;
  const netKpis = windowKpis.netKpis;
  const feesUi = windowKpis.feesUi;

  const displayDates = feesUi?.chartDates ?? dates;
  const displayGross = feesUi?.chartGross ?? grossEquity;
  const displayNet = feesUi?.chartNet ?? netEquity;
  const displayBench = feesUi?.chartBench ?? benchmarkEquity;
  const displayMgmtCum = feesUi?.mgmtFeeCum ?? mgmtFeeCum;
  const displayPerfCum = feesUi?.perfFeeCum ?? perfFeeCum;
  const displayTotalCum = feesUi?.totalFeeCum ?? totalFeeCum;

  const totalMgmtFees = feesUi?.totalMgmtFees ?? (mgmtFeeCum.length ? mgmtFeeCum[mgmtFeeCum.length - 1] : 0);
  const totalPerfFees = feesUi?.totalPerfFees ?? (perfFeeCum.length ? perfFeeCum[perfFeeCum.length - 1] : 0);
  const totalFees = feesUi?.totalFees ?? (totalFeeCum.length ? totalFeeCum[totalFeeCum.length - 1] : 0);
  const planSegmentLabel = feesUi?.segment ?? feeResult.segment;
  const impactCagr = netKpis.cagr - grossKpis.cagr;

  const seriesHint =
    dataSource === "v5_cap15_freeze"
      ? " Trajetória: Modelo CAP15 — mesma série que o cartão / embed-plafonado-cagr (calendário CAP15 + m100 + vol por perfil)."
      : runModelIsFallback
        ? " Trajetória: motor legacy v2 (run-model) — fallback porque o freeze V5 não está disponível (ex.: deploy sem CSV)."
        : " Trajetória: motor legacy v2 (run-model) — pedido explícito na URL (?series=run_model ou fees_engine=v2).";

  const kpiBrutoHint =
    `CAGR bruto / Sharpe bruto / Max DD bruto: série do modelo já inclui custos de transacção e fricção estimados no motor; ` +
    `«líquido» subtrai só as comissões DECIDE simuladas (não há segunda camada de custos de bolsa). ` +
    `Mesma janela móvel ~${kpiHorizonYears} a (~${Math.round(kpiHorizonYears * 252)} dias úteis), ` +
    `alinhada ao simulador do dashboard. Janela: ${windowKpis.windowLabel}. ` +
    (feesUi
      ? "Cartões e gráficos de custos recalculam só nesse período."
      : "Fees nos cartões/gráficos usam a série completa (janela indisponível — veja o aviso acima).") +
    seriesHint +
    (windowKpis.warn ? ` ${windowKpis.warn}` : "");

  if (!router.isReady) {
    return (
      <div
        style={{
          minHeight: "100vh",
          background: "#09090b",
          color: "#fafafa",
          padding: 20,
          fontFamily: DECIDE_APP_FONT_FAMILY,
          fontSize: 13,
        }}
      >
        A carregar…
      </div>
    );
  }

  return (
    <div
      style={{
        minHeight: embed ? (feesEmbedView === "intro" ? "100vh" : "min(100vh, 2400px)") : "100vh",
        background: embed ? "#09090b" : "#000",
        color: "#fff",
        padding: embed ? (feesEmbedView === "intro" ? "12px 14px 16px" : 16) : 32,
        fontFamily: DECIDE_APP_FONT_FAMILY,
        boxSizing: "border-box",
        display: feesEmbedView === "intro" ? "flex" : undefined,
        flexDirection: feesEmbedView === "intro" ? "column" : undefined,
      }}
    >
      {embed ? null : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr auto",
            gap: 20,
            marginBottom: 24,
            alignItems: "start",
          }}
        >
          <div style={{ textAlign: "center", maxWidth: "100%" }}>
            <div style={{ color: "#e2e8f0", fontSize: 22, fontWeight: 800 }}>Fees Client</div>
            <div style={{ color: "#fafafa", fontSize: 18, opacity: 0.92, marginTop: 6 }}>
              Página separada do core. Simulação líquida de comissões sobre a curva overlayed.
            </div>
          </div>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center", justifySelf: "end" }}>
            <ClientFlowDashboardButton />
          </div>
        </div>
      )}
      {embed ? (
        <div
          style={{
            color: "#fafafa",
            fontSize: 15,
            fontWeight: 800,
            marginBottom: feesEmbedView === "intro" ? 10 : 12,
            flexShrink: 0,
          }}
        >
          {feesEmbedView === "intro"
            ? "Custos — simulação e comissões DECIDE"
            : "Custos e comissões (simulação)"}
        </div>
      ) : null}

      {feesEmbedView === "intro" ? (
        <div
          style={{
            flex: 1,
            minHeight: 0,
            display: "flex",
            flexDirection: "column",
            width: "100%",
          }}
        >
        <div
          style={{
            background: panelBg,
            border: panelBorder,
            borderRadius: 18,
            padding: embed ? "22px 24px 28px" : "24px 28px 32px",
            color: "#d4d4d8",
            fontSize: embed ? 16 : 14,
            lineHeight: 1.65,
            maxWidth: embed ? "100%" : "min(1080px, 100%)",
            width: "100%",
            margin: embed ? 0 : "0 auto",
            boxSizing: "border-box",
            flex: 1,
            minHeight: embed ? "min(calc(100vh - 52px), 3200px)" : "min(calc(100vh - 200px), 3200px)",
            overflowY: "auto",
            WebkitOverflowScrolling: "touch",
          }}
        >
          <p
            style={{
              margin: "0 0 8px",
              color: "#f8fafc",
              fontWeight: 800,
              fontSize: embed ? 19 : 17,
            }}
            title="Incluem comissões de negociação estimadas, FX, turnover e efeitos de execução no modelo. Não incluem impostos nem custos específicos da conta."
          >
            Custos
          </p>
          <p
            style={{
              margin: "0 0 22px",
              fontSize: embed ? 14 : 12.5,
              color: "#a1a1aa",
              lineHeight: 1.5,
            }}
          >
            Os resultados históricos no simulador incorporam custos de mercado estimados; abaixo seguem as comissões DECIDE
            (Premium / Private).
          </p>

          <div
            style={{
              marginBottom: 26,
              padding: "18px 20px 20px",
              borderRadius: 14,
              background: "rgba(13, 148, 136, 0.08)",
              border: "1px solid rgba(45, 212, 191, 0.22)",
            }}
          >
            <p style={{ margin: "0 0 14px", color: "#5eead4", fontWeight: 800, fontSize: embed ? 17 : 15 }}>
              Custos considerados na simulação histórica
            </p>
            <p style={{ margin: "0 0 18px", color: "#e4e4e7" }}>
              Os indicadores do modelo incorporam uma estimativa conservadora dos principais custos associados à
              implementação e manutenção da estratégia (backtest). São{" "}
              <strong style={{ color: "#fafafa" }}>ilustrativos</strong> e podem diferir da execução real.
            </p>

            <div style={{ marginBottom: 18 }}>
              <p style={{ margin: "0 0 8px", color: "#fafafa", fontWeight: 700, fontSize: embed ? 15.5 : 14 }}>
                Custos de transação (acções)
              </p>
              <p style={{ margin: 0, color: "#d4d4d8" }}>
                No motor, a fricção é modelada de forma <strong style={{ color: "#fafafa" }}>linear no turnover</strong>{" "}
                (soma das alterações de peso) nos dias de rebalanço: comissão estimada, slippage e um termo adicional
                opcional de conversão cambial. Isto aproxima spread, impacto e comissões sem simular livro de ordens.
              </p>
            </div>

            <div style={{ marginBottom: 18 }}>
              <p style={{ margin: "0 0 8px", color: "#fafafa", fontWeight: 700, fontSize: embed ? 15.5 : 14 }}>
                Custos cambiais (FX)
              </p>
              <p style={{ margin: 0, color: "#d4d4d8" }}>
                A componente FX no backtest é uma <strong style={{ color: "#fafafa" }}>aproximação em bps sobre o turnover</strong>
                , não uma simulação perna-a-perna EUR/USD. Execução real (spread, timing, hedge) pode diferir.
              </p>
            </div>

            <div style={{ marginBottom: 18 }}>
              <p style={{ margin: "0 0 8px", color: "#fafafa", fontWeight: 700, fontSize: embed ? 15.5 : 14 }}>
                Custos de rebalanceamento
              </p>
              <p style={{ margin: 0, color: "#d4d4d8" }}>
                A rotação da carteira ao longo do tempo acumula custos nos dias em que há troca de posições; o turnover
                médio e os picos em rebalanços mensais influenciam o drag total.
              </p>
            </div>

            <div style={{ marginBottom: 18 }}>
              <p style={{ margin: "0 0 8px", color: "#fafafa", fontWeight: 700, fontSize: embed ? 15.5 : 14 }}>
                Execução e atrasos
              </p>
              <p style={{ margin: 0, color: "#d4d4d8" }}>
                O modelo assume decisão com informação até ao fecho e execução com desfasamento explícito (lag) em relação
                ao sinal; pode acrescentar-se lag adicional nos testes. Isto aproxima o intervalo entre decisão e preço
                efectivo sem microestrutura.
              </p>
            </div>

            <div
              style={{
                marginBottom: 16,
                padding: "12px 14px",
                borderRadius: 10,
                background: "rgba(0,0,0,0.25)",
                border: "1px solid rgba(63, 63, 70, 0.6)",
              }}
            >
              <p style={{ margin: "0 0 8px", color: "#fde68a", fontWeight: 800, fontSize: embed ? 15 : 13 }}>
                Pressupostos numéricos (referência)
              </p>
              <p style={{ margin: "0 0 8px", color: "#d4d4d8", fontSize: embed ? 15 : 13.5, lineHeight: 1.55 }}>
                Configuração típica de fricção no motor: da ordem de{" "}
                <strong style={{ color: "#fafafa" }}>3 + 3 = 6 bps</strong> sobre o turnover por dia em que há negociação
                (comissão + slippage), ajustável por cenário. Na suíte de robustez pode stressar custos agregados até
                valores da ordem de <strong style={{ color: "#fafafa" }}>20–50 bps</strong> para ver a sensibilidade do
                CAGR — útil para comparar com a sua realidade de execução.
              </p>
              <p style={{ margin: 0, fontSize: embed ? 14 : 12.5, color: "#a1a1aa", lineHeight: 1.5 }}>
                Valores exactos dependem do ficheiro de freeze / parâmetros activos; estes intervalos são orientadores.
              </p>
            </div>

            <div style={{ marginBottom: 16 }}>
              <p style={{ margin: "0 0 8px", color: "#fca5a5", fontWeight: 800, fontSize: embed ? 16 : 14 }}>
                O que não está incluído no backtest
              </p>
              <ul style={{ margin: 0, paddingLeft: 20, color: "#d4d4d8" }}>
                <li style={{ marginBottom: 8 }}>Impostos sobre mais-valias ou dividendos.</li>
                <li style={{ marginBottom: 8 }}>Custos específicos da sua conta (custódia, dados de mercado, etc.).</li>
                <li style={{ margin: 0 }}>Encargos do broker fora do pacote standard de execução que definir.</li>
              </ul>
            </div>

            <p style={{ margin: 0, fontSize: embed ? 14.5 : 13, color: "#a1a1aa", lineHeight: 1.55 }}>
              <strong style={{ color: "#e4e4e7" }}>Nota:</strong> os resultados são líquidos das fricções modeladas na
              simulação histórica; os custos reais variam com mercado, liquidez, dimensão das ordens e método de execução.
            </p>
          </div>

          <p
            style={{
              margin: "0 0 18px",
              color: "#e4e4e7",
              fontWeight: 800,
              fontSize: embed ? 17 : 15,
              paddingTop: 4,
              borderTop: "1px solid rgba(63, 63, 70, 0.75)",
            }}
          >
            Comissões DECIDE — segmentos comerciais
          </p>

          <div style={{ marginBottom: 22 }}>
            <p style={{ margin: "0 0 10px", color: "#e4e4e7", fontWeight: 800, fontSize: embed ? 17 : 15 }}>
              Segmento Premium
            </p>
            <p style={{ margin: 0 }}>
              <strong style={{ color: "#fafafa" }}>Comissão de gestão</strong> — montante fixo de{" "}
              <strong style={{ color: "#fafafa" }}>{DECIDE_PREMIUM_MONTHLY_FEE_EUR} €</strong> por mês, cobrado no{" "}
              <strong style={{ color: "#fafafa" }}>final de cada mês</strong>, independentemente do valor da carteira.
            </p>
          </div>

          <div
            style={{
              marginBottom: 22,
              paddingTop: 18,
              borderTop: "1px solid rgba(63, 63, 70, 0.75)",
            }}
          >
            <p style={{ margin: "0 0 10px", color: "#e4e4e7", fontWeight: 800, fontSize: embed ? 17 : 15 }}>
              Segmento Private
            </p>
            <p style={{ margin: "0 0 12px" }}>
              <strong style={{ color: "#fafafa" }}>Comissão de gestão fixa</strong> — 0,6% anuais sobre o valor da
              carteira, cobrados mensalmente (0,05% / mês) sobre o valor médio da carteira em cada mês.
            </p>
            <p style={{ margin: 0 }}>
              <strong style={{ color: "#fafafa" }}>Comissão de performance</strong> — anual, calculada face ao benchmark
              composto e com high watermark relativo, conforme descrito mais abaixo.
            </p>
          </div>

          <div
            style={{
              marginBottom: 22,
              paddingTop: 18,
              borderTop: "1px solid rgba(63, 63, 70, 0.75)",
            }}
          >
            <p style={{ margin: "0 0 10px", color: "#e4e4e7", fontWeight: 800, fontSize: embed ? 17 : 15 }}>
              Benchmark composto (pesos fixos)
            </p>
            <p style={{ margin: "0 0 12px" }}>
              O referencial combina, com pesos fixos, quatro blocos regionais:{" "}
              <strong style={{ color: "#fafafa" }}>60%</strong> Estados Unidos (S&amp;P 500),{" "}
              <strong style={{ color: "#fafafa" }}>25%</strong> Europa, <strong style={{ color: "#fafafa" }}>10%</strong>{" "}
              Japão e <strong style={{ color: "#fafafa" }}>5%</strong> Canadá.
            </p>
            <p style={{ margin: "0 0 12px" }}>
              Em cada <strong style={{ color: "#fafafa" }}>dia útil</strong>, o retorno do benchmark é a soma dos
              retornos de cada bloco, cada um multiplicado pelo respetivo peso. A curva do índice composto obtém-se ao
              longo do tempo, acumulando esses retornos dia após dia: o valor de hoje resulta do valor de ontem ajustado
              pelo retorno do dia.
            </p>
            <p style={{ margin: 0, fontSize: embed ? 14.5 : 13, color: "#a1a1aa" }}>
              Na implementação usam-se ETFs cotados como proxy de cada região, com cotações e valores reunidos em{" "}
              <strong style={{ color: "#e4e4e7" }}>euros</strong>. A regra acima é a definição conceptual do benchmark.
            </p>
          </div>

          <div
            style={{
              marginBottom: 22,
              paddingTop: 18,
              borderTop: "1px solid rgba(63, 63, 70, 0.75)",
            }}
          >
            <p style={{ margin: "0 0 10px", color: "#e4e4e7", fontWeight: 800, fontSize: embed ? 17 : 15 }}>
              Comissão de gestão fixa (Segmento Private)
            </p>
            <p style={{ margin: "0 0 12px" }}>
              A taxa anual de <strong style={{ color: "#fafafa" }}>0,6%</strong> reparte-se por doze meses: em cada mês
              aplica-se aproximadamente <strong style={{ color: "#fafafa" }}>0,05%</strong> sobre a base acordada.
            </p>
            <p style={{ margin: "0 0 12px" }}>
              A base de cobrança é o <strong style={{ color: "#fafafa" }}>valor médio do NAV ao longo de cada mês</strong>
              .
            </p>
            <p style={{ margin: 0 }}>
              O montante da comissão deve ser tratado como <strong style={{ color: "#fafafa" }}>encargo em numerário</strong>{" "}
              (saída de caixa), e não como um “mau retorno” arbitrário misturado na curva do modelo — assim a evolução da
              carteira continua interpretável.
            </p>
          </div>

          <div
            style={{
              marginBottom: 22,
              paddingTop: 18,
              borderTop: "1px solid rgba(63, 63, 70, 0.75)",
            }}
          >
            <p style={{ margin: "0 0 10px", color: "#e4e4e7", fontWeight: 800, fontSize: embed ? 17 : 15 }}>
              Comissão de performance anual (alpha face ao benchmark, high watermark relativo)
            </p>
            <p style={{ margin: "0 0 12px" }}>
              Considera-se o valor da carteira do cliente <em>já depois</em> das comissões de gestão fixas desse período, e
              o valor do <strong style={{ color: "#fafafa" }}>benchmark composto</strong> nos mesmos instantes, na escala
              de referência <strong style={{ color: "#fafafa" }}>base 100</strong>.
            </p>
            <p style={{ margin: "0 0 12px" }}>
              Em cada data define-se a <strong style={{ color: "#fafafa" }}>razão entre carteira e benchmark</strong>{" "}
              (quanto o NAV representa face ao índice de referência naquele momento). O{" "}
              <strong style={{ color: "#fafafa" }}>high watermark relativo</strong> é o máximo histórico dessa razão nas
              datas de cristalização em <strong style={{ color: "#fafafa" }}>fecho</strong>.
            </p>
            <p style={{ margin: "0 0 12px" }}>
              Na data anual de liquidação, <strong style={{ color: "#fafafa" }}>31 de dezembro</strong>, calcula-se o
              excesso da razão atual sobre esse máximo anterior; só a parte positiva conta. Esse excesso traduz-se em
              euros no equivalente ao ganho de valor
              que a carteira tem <em>além</em> do que teria se, desde o último máximo relativo, tivesse apenas acompanhado
              o benchmark — ou seja, a <strong style={{ color: "#fafafa" }}>alpha acumulada</strong> em relação ao
              referencial.
            </p>
            <p style={{ margin: "0 0 12px" }}>
              Aplica-se <strong style={{ color: "#fafafa" }}>15%</strong> sobre esse montante de alpha; o high watermark
              relativo passa a reflectir o nível em que ficou a razão após essa liquidação anual.
            </p>
            <p style={{ margin: 0, fontSize: embed ? 14.5 : 13, color: "#a1a1aa" }}>
              Com isto só há performance fee quando a carteira supera o melhor nível <em>relativo ao benchmark</em> já
              atingido no passado, evitando cobrar apenas porque o mercado subiu em geral sem valor acrescentado da
              gestão.
            </p>
          </div>

          <div
            style={{
              marginBottom: 18,
              paddingTop: 18,
              borderTop: "1px solid rgba(63, 63, 70, 0.75)",
            }}
          >
            <p style={{ margin: "0 0 10px", color: "#e4e4e7", fontWeight: 800, fontSize: embed ? 17 : 15 }}>
              Calendário e bases (produto / termos)
            </p>
            <ul style={{ margin: 0, paddingLeft: 20, color: "#d4d4d8" }}>
              <li style={{ marginBottom: 10 }}>
                <strong style={{ color: "#fafafa" }}>Comissão de gestão fixa:</strong> liquidada mensalmente no{" "}
                <strong style={{ color: "#fafafa" }}>dia 1 do mês seguinte</strong>, com{" "}
                <strong style={{ color: "#fafafa" }}>pró-rata</strong> se a entrada ou alteração ocorrer a meio do mês.
              </li>
              <li style={{ marginBottom: 10 }}>
                <strong style={{ color: "#fafafa" }}>Comissão de performance:</strong> calculada anualmente a{" "}
                <strong style={{ color: "#fafafa" }}>31 de dezembro</strong> e cobrada no{" "}
                <strong style={{ color: "#fafafa" }}>início de janeiro</strong>, segundo a regra de high watermark relativo
                ao benchmark.
              </li>
              <li style={{ margin: 0 }}>
                <strong style={{ color: "#fafafa" }}>Bases:</strong> NAV após comissões de gestão fixas; benchmark
                composto com os pesos fixos indicados; high watermark sempre{" "}
                <strong style={{ color: "#fafafa" }}>relativo ao benchmark</strong> — este último ponto é o que alinha a
                cobrança ao valor acrescentado face ao mercado de referência.
              </li>
            </ul>
          </div>

          <p style={{ margin: 0, fontSize: embed ? 14.5 : 13, color: "#71717a", lineHeight: 1.55 }}>
            Informação indicativa. No separador <strong style={{ color: "#d4d4d4" }}>Simulador</strong> pode modelar o
            impacto das regras sobre uma trajetória ilustrativa. Não substitui contrato, RIIPS ou proposta comercial.
          </p>
        </div>
        </div>
      ) : null}

      {feesEmbedView !== "intro" && error ? (
        <div
          style={{
            background: "#2a0a0a",
            border: "1px solid #7f1d1d",
            padding: 16,
            borderRadius: 14,
            color: "#fafafa",
          }}
        >
          Erro: {error}
        </div>
      ) : null}

      {feesEmbedView !== "intro" && runModelIsFallback && payload && !error ? (
        <div
          style={{
            background: "rgba(120, 53, 15, 0.28)",
            border: "1px solid rgba(251, 191, 36, 0.45)",
            padding: 14,
            borderRadius: 14,
            color: "#fcd34d",
            fontSize: 13,
            lineHeight: 1.5,
            marginBottom: 16,
          }}
        >
          O freeze <strong style={{ color: "#fef3c7" }}>V5 Modelo CAP15</strong> não está disponível neste ambiente
          (ficheiros em falta). A mostrar o motor legacy <strong style={{ color: "#fef3c7" }}>v2</strong> via{" "}
          <code style={{ color: "#fde68a" }}>/api/run-model</code> — métricas podem diferir do modelo apresentado ao
          cliente.
        </div>
      ) : null}

      {feesEmbedView === "intro" ? null : (
        <>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
          gap: 16,
          marginBottom: 24,
        }}
      >
        <div style={{ background: panelBg, border: panelBorder, borderRadius: 18, padding: 18 }}>
          <div style={{ color: "#fafafa", marginBottom: 8 }}>Perfil</div>
          <select
            value={profile}
            onChange={(e) => setProfile(e.target.value as "conservador" | "moderado" | "dinamico")}
            style={{
              width: "100%",
              background: inputBg,
              color: "#fff",
              border: panelBorder,
              borderRadius: 12,
              padding: 12,
              fontSize: 16,
            }}
            title="Freeze Modelo CAP15: moderado com alvo ≈1× vol do referencial no motor; conservador/dinâmico com alvo vs benchmark (0,75× / 1,25×)."
          >
            <option value="moderado">Moderado</option>
            <option value="conservador">Conservador</option>
            <option value="dinamico">Dinâmico</option>
          </select>
        </div>

        <div style={{ background: panelBg, border: panelBorder, borderRadius: 18, padding: 18 }}>
          <div style={{ color: "#fafafa", marginBottom: 8 }}>Plano de comissões</div>
          <select
            value={planMode}
            onChange={(e) => {
              const next = e.target.value as PlanMode;
              setPlanMode(next);
              if (next === "segment_b_mgmt_pf") {
                setCapitalInvestido(50000);
              } else if (next === "segment_a_fixed") {
                setCapitalInvestido(20000);
              }
            }}
            style={{
              width: "100%",
              background: inputBg,
              color: "#fff",
              border: panelBorder,
              borderRadius: 12,
              padding: 12,
              fontSize: 16,
            }}
          >
            <option value="segment_a_fixed">
              Premium — {DECIDE_PREMIUM_MONTHLY_FEE_EUR}€/mês (fixo no fim do mês)
            </option>
            <option value="segment_b_mgmt_pf">Private — 0,6% NAV médio + 15% performance (HWM relativo)</option>
          </select>
        </div>

        <div onPointerDownCapture={onThousandsFieldRowPointerDownCapture} style={{ display: "contents" }}>
          <div style={{ background: panelBg, border: panelBorder, borderRadius: 18, padding: 18 }}>
            <div style={{ color: "#fafafa", marginBottom: 8 }}>Capital investido (€)</div>
            <ThousandsNumberInput
              min={1000}
              maxDecimals={0}
              value={capitalInvestido}
              onChange={asThousandsNumberChange(setCapitalInvestido)}
              style={{
                width: "100%",
                background: inputBg,
                color: "#fff",
                border: panelBorder,
                borderRadius: 12,
                padding: 12,
                fontSize: 16,
              }}
            />
          </div>

          <div style={{ background: panelBg, border: panelBorder, borderRadius: 18, padding: 18 }}>
            <div style={{ color: "#fafafa", marginBottom: 8 }}>Anos (janela: CAGR, Sharpe, fees e gráficos)</div>
            <ThousandsNumberInput
              min={0.5}
              maxDecimals={1}
              value={kpiHorizonYears}
              onChange={asThousandsNumberChange(setKpiHorizonYears)}
              title="Recua ~252×N dias úteis a partir do fim da série: métricas, custos acumulados e curvas usam o mesmo troço."
              style={{
                width: "100%",
                background: inputBg,
                color: "#fff",
                border: panelBorder,
                borderRadius: 12,
                padding: 12,
                fontSize: 16,
              }}
            />
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 16, marginBottom: 24 }}>
        <KPIBox embed={embed} title="Capital investido" value={formatEuro(capitalInvestido, 0)} />
        <KPIBox embed={embed} title="Management fee acumulada" value={formatEuro(totalMgmtFees, 0)} />
        <KPIBox embed={embed} title="Performance fee acumulada" value={formatEuro(totalPerfFees, 0)} />
        <KPIBox embed={embed} title="Fees totais" value={formatEuro(totalFees, 0)} />
        <KPIBox embed={embed} title="Plano" value={planSegmentLabel} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gap: 16, marginBottom: 10 }}>
        <KPIBox embed={embed} title="CAGR bruto" value={formatPct(grossKpis.cagr)} />
        <KPIBox embed={embed} title="CAGR líquido" value={formatPct(netKpis.cagr)} />
        <KPIBox embed={embed} title="Impacto no CAGR" value={formatPct(impactCagr)} />
        <KPIBox embed={embed} title="Sharpe bruto" value={formatNumber(grossKpis.sharpe)} />
        <KPIBox embed={embed} title="Sharpe líquido" value={formatNumber(netKpis.sharpe)} />
        <KPIBox embed={embed} title="Max DD bruto" value={formatPct(grossKpis.maxDD)} />
        <KPIBox embed={embed} title="Max DD líquido" value={formatPct(netKpis.maxDD)} />
      </div>
      <div style={{ color: "#e4e4e7", fontSize: 12, marginBottom: 24, lineHeight: 1.5 }}>{kpiBrutoHint}</div>

      <div
        style={{
          background: panelBg,
          border: panelBorder,
          borderRadius: 22,
          padding: 20,
          marginBottom: 24,
        }}
      >
        <div style={{ fontSize: 24, fontWeight: 800, marginBottom: 8, color: "#fafafa" }}>Curva bruta vs líquida</div>
        <div style={{ color: "#fafafa", marginBottom: 14, opacity: 0.95 }}>
          A curva líquida é calculada apenas no frontend, separadamente do core do modelo.
          {feesUi ? (
            <span> Troço mostrado = mesma janela que «Anos» (CAGR / fees).</span>
          ) : null}
          {dataSource === "v5_cap15_freeze" ? (
            <span> Curva bruta = V5 Modelo CAP15 (freeze).</span>
          ) : null}
        </div>
        <Plot
          data={[
            {
              x: displayDates,
              y: displayGross,
              type: "scatter",
              mode: "lines",
              name: "Modelo bruto",
              line: { width: 3, color: "#22c55e" },
            },
            {
              x: displayDates,
              y: displayNet,
              type: "scatter",
              mode: "lines",
              name: "Modelo líquido",
              line: { width: 3, color: "#f59e0b" },
            },
            {
              x: displayDates,
              y: displayBench,
              type: "scatter",
              mode: "lines",
              name: "Benchmark",
              line: { width: 2, color: "#a1a1aa" },
            },
          ]}
          layout={{
            autosize: true,
            height: 520,
            paper_bgcolor: plotBg,
            plot_bgcolor: plotBg,
            font: { color: "#fafafa" },
            margin: { l: 70, r: 20, t: 20, b: 70 },
            yaxis: { type: "log", gridcolor: embed ? "#3f3f46" : "#3f3f46", color: "#fafafa" },
            xaxis: { gridcolor: embed ? "#3f3f46" : "#3f3f46", color: "#fafafa" },
            legend: {
              orientation: "h",
              x: 0.5,
              xanchor: "center",
              y: -0.15,
              font: { color: "#fafafa" },
            },
          }}
          config={{ responsive: true, displaylogo: false }}
          style={{ width: "100%" }}
        />
      </div>

      <div
        style={{
          background: panelBg,
          border: panelBorder,
          borderRadius: 22,
          padding: 20,
        }}
      >
        <div style={{ fontSize: 24, fontWeight: 800, marginBottom: 8, color: "#fafafa" }}>Fees acumuladas</div>
        <Plot
          data={[
            {
              x: displayDates,
              y: displayMgmtCum,
              type: "scatter",
              mode: "lines",
              name: "Management fee acumulada",
              line: { width: 3, color: "#d4d4d4" },
            },
            {
              x: displayDates,
              y: displayPerfCum,
              type: "scatter",
              mode: "lines",
              name: "Performance fee acumulada",
              line: { width: 3, color: "#ef4444" },
            },
            {
              x: displayDates,
              y: displayTotalCum,
              type: "scatter",
              mode: "lines",
              name: "Fees totais",
              line: { width: 3, color: "#f59e0b" },
            },
          ]}
          layout={{
            autosize: true,
            height: 420,
            paper_bgcolor: plotBg,
            plot_bgcolor: plotBg,
            font: { color: "#fafafa" },
            margin: { l: 70, r: 20, t: 20, b: 70 },
            yaxis: { gridcolor: "#3f3f46", color: "#fafafa" },
            xaxis: { gridcolor: "#3f3f46", color: "#fafafa" },
            legend: {
              orientation: "h",
              x: 0.5,
              xanchor: "center",
              y: -0.18,
              font: { color: "#fafafa" },
            },
          }}
          config={{ responsive: true, displaylogo: false }}
          style={{ width: "100%" }}
        />
      </div>
        </>
      )}
    </div>
  );
}

/** Evita HTML estático/CDN a servir copy antiga; valor Premium vem do bundle + SSR fresco. */
export const getServerSideProps: GetServerSideProps = async ({ res }) => {
  res.setHeader("Cache-Control", "private, no-store, must-revalidate");
  return { props: {} };
};