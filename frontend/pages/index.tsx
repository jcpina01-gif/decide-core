import Head from "next/head";
import Link from "next/link";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { DecideLogoLockupEmbeddedRecolor, decideHeaderNavLinkStyle } from "../components/DecideLogoHeader";
import { DECIDE_DEFAULT_INVEST_EUR, DECIDE_MIN_INVEST_EUR } from "../lib/decideInvestPrefill";
import ThousandsNumberInput, { asThousandsNumberChange } from "../components/ThousandsNumberInput";
import { onThousandsFieldRowPointerDownCapture } from "../lib/thousandsFieldRowFocus";
import { buildSimulatorSeries, TRADING_DAYS_PER_YEAR } from "../lib/decideSimulator";
import { DECIDE_APP_FONT_FAMILY, DECIDE_DASHBOARD } from "../lib/decideClientTheme";

/** Valores iniciais do exemplo (50k · 20a) — alinhados ao simulador do dashboard. */
const LANDING_SIM_CAPITAL_EUR = DECIDE_DEFAULT_INVEST_EUR;
const LANDING_SIM_YEARS_DEFAULT = 20;

/** Largura útil da landing (desktop); simulador usa ~100% disto. */
const LANDING_MAIN_MAX_WIDTH = 1400;
const LANDING_HEADLINE_MAX_WIDTH = 800;

type SeriesPack = {
  dates?: string[];
  benchmark_equity?: number[];
  equity_raw?: number[];
  equity_overlayed?: number[];
};

type CoreOverlayResp = {
  ok?: boolean;
  series?: SeriesPack;
  error?: string;
  result?: Record<string, unknown>;
};

function firstFinite(arr: number[] | undefined): number | null {
  for (const v of arr || []) {
    if (typeof v === "number" && isFinite(v) && v > 0) return v;
  }
  return null;
}

function normalizeTo100(arr: number[] | undefined): number[] {
  const base = firstFinite(arr);
  if (!base) return (arr || []).map((v) => (typeof v === "number" && isFinite(v) ? v : NaN));
  return (arr || []).map((v) => (typeof v === "number" && isFinite(v) ? (v / base) * 100 : NaN));
}

function maxDrawdown(equity: number[]): number {
  if (!equity.length) return 0;
  let peak = equity[0];
  let m = 0;
  for (const x of equity) {
    if (x > peak) peak = x;
    if (peak > 0) {
      const dd = (x - peak) / peak;
      if (dd < m) m = dd;
    }
  }
  return m;
}

function approxCagr(totalMult: number, tradingDays: number): number | null {
  if (!isFinite(totalMult) || totalMult <= 0 || tradingDays < 50) return null;
  const years = tradingDays / 252;
  return Math.pow(totalMult, 1 / years) - 1;
}

function volAnnualized(dailyEquity: number[]): number | null {
  const rets: number[] = [];
  for (let i = 1; i < dailyEquity.length; i++) {
    const a = dailyEquity[i - 1];
    const b = dailyEquity[i];
    if (a > 0 && b > 0) rets.push(b / a - 1);
  }
  if (rets.length < 30) return null;
  const mean = rets.reduce((s, x) => s + x, 0) / rets.length;
  let v = 0;
  for (const r of rets) v += (r - mean) * (r - mean);
  const sd = Math.sqrt(v / Math.max(1, rets.length - 1));
  return sd * Math.sqrt(252);
}

/** Sharpe anual (rf ≈ 0), alinhado ao kpi_server com DECIDE_KPI_RISK_FREE_ANNUAL=0. */
function sharpeAnnualized(dailyEquity: number[]): number | null {
  const rets: number[] = [];
  for (let i = 1; i < dailyEquity.length; i++) {
    const a = dailyEquity[i - 1];
    const b = dailyEquity[i];
    if (a > 0 && b > 0) rets.push(b / a - 1);
  }
  if (rets.length < 30) return null;
  const mean = rets.reduce((s, x) => s + x, 0) / rets.length;
  let v = 0;
  for (const r of rets) v += (r - mean) * (r - mean);
  const sd = Math.sqrt(v / Math.max(1, rets.length - 1));
  if (sd <= 1e-12) return null;
  return (mean / sd) * Math.sqrt(252);
}

/** CAGR em formato PT (vírgula decimal), sem sufixo %. */
function fmtPctPt(x: number | null | undefined, digits = 1): string {
  if (x === null || x === undefined || !isFinite(x)) return "—";
  return (x * 100).toFixed(digits).replace(".", ",");
}

/**
 * Por mês civil (primeiro→último dia útil na série): % meses com retorno modelo > 0 e % com retorno modelo > bench.
 */
function monthlyWinStats(dates: string[], modelEq: number[], benchEq: number[]): {
  pctPositive: number;
  pctAboveBench: number;
  nMonths: number;
} | null {
  if (dates.length !== modelEq.length || benchEq.length !== modelEq.length) return null;
  type Bucket = { i0: number; i1: number };
  const byMonth = new Map<string, Bucket>();
  for (let i = 0; i < dates.length; i++) {
    const d = String(dates[i]).slice(0, 7);
    if (d.length < 7) continue;
    const m = modelEq[i];
    const b = benchEq[i];
    if (!isFinite(m) || !isFinite(b) || m <= 0 || b <= 0) continue;
    const cur = byMonth.get(d);
    if (!cur) byMonth.set(d, { i0: i, i1: i });
    else cur.i1 = i;
  }
  let n = 0;
  let pos = 0;
  let above = 0;
  for (const { i0, i1 } of byMonth.values()) {
    const m0 = modelEq[i0];
    const m1 = modelEq[i1];
    const b0 = benchEq[i0];
    const b1 = benchEq[i1];
    if (m0 <= 0 || b0 <= 0) continue;
    const rM = m1 / m0 - 1;
    const rB = b1 / b0 - 1;
    n++;
    if (rM > 0) pos++;
    if (rM > rB) above++;
  }
  if (n === 0) return null;
  return { pctPositive: (pos / n) * 100, pctAboveBench: (above / n) * 100, nMonths: n };
}

/**
 * Vol anual do modelo → igual à do benchmark: multiplica cada retorno diário por (σ_bench / σ_modelo).
 * Alinha a vol realizada do modelo à do benchmark quando o payload não vem já final (fallback).
 */
function scaleModelEquityToBenchVol(modelEq: number[], benchEq: number[]): number[] {
  const n = Math.min(modelEq.length, benchEq.length);
  if (n < 50) return modelEq;
  const m = modelEq.slice(0, n);
  const b = benchEq.slice(0, n);
  const volM = volAnnualized(m);
  const volB = volAnnualized(b);
  if (volM === null || volB === null || volM <= 1e-12) return modelEq;
  const scale = volB / volM;
  const out: number[] = [m[0]];
  for (let i = 1; i < n; i++) {
    const r = m[i] / m[i - 1] - 1;
    out.push(out[i - 1] * (1 + r * scale));
  }
  for (let j = n; j < modelEq.length; j++) out.push(modelEq[j]);
  return out;
}

function extractKpisFromSeries(series: SeriesPack | undefined): {
  modelCagr: number | null;
  modelVol: number | null;
  modelMaxDd: number | null;
  modelSharpe: number | null;
  benchCagr: number | null;
  benchVol: number | null;
  benchMaxDd: number | null;
  benchSharpe: number | null;
  pctMonthsPositiveModel: number | null;
  pctMonthsAboveBench: number | null;
  nMonths: number | null;
  n: number;
} | null {
  if (!series?.equity_overlayed?.length) return null;
  const over = series.equity_overlayed.filter((x) => typeof x === "number" && isFinite(x));
  const bench = (series.benchmark_equity || []).filter((x) => typeof x === "number" && isFinite(x));
  const n = over.length;
  if (n < 50) return null;
  const trM = over[n - 1] / over[0];
  const trB = bench.length >= n ? bench[n - 1] / bench[0] : null;
  const benchSlice = bench.length >= n ? bench.slice(0, n) : [];
  const dates = (series.dates || []).slice(0, n);
  const month =
    dates.length === n ? monthlyWinStats(dates, over, benchSlice) : null;
  return {
    modelCagr: approxCagr(trM, n),
    modelVol: volAnnualized(over),
    modelMaxDd: maxDrawdown(over),
    modelSharpe: sharpeAnnualized(over),
    benchCagr: trB !== null && isFinite(trB) ? approxCagr(trB, n) : null,
    benchVol: benchSlice.length >= 50 ? volAnnualized(benchSlice) : null,
    benchMaxDd: benchSlice.length >= n ? maxDrawdown(benchSlice) : null,
    benchSharpe: benchSlice.length >= 50 ? sharpeAnnualized(benchSlice) : null,
    pctMonthsPositiveModel: month ? month.pctPositive : null,
    pctMonthsAboveBench: month ? month.pctAboveBench : null,
    nMonths: month ? month.nMonths : null,
    n,
  };
}

function buildChartRows(series: SeriesPack | undefined, normalize: boolean) {
  if (!series?.dates?.length) return [];
  const n = series.dates.length;
  const bench = normalize ? normalizeTo100(series.benchmark_equity) : series.benchmark_equity || [];
  const over = normalize ? normalizeTo100(series.equity_overlayed) : series.equity_overlayed || [];
  const rows: { date: string; Benchmark: number; Modelo: number }[] = [];
  for (let i = 0; i < n; i++) {
    rows.push({
      date: String(series.dates[i]),
      Benchmark: bench[i] as number,
      Modelo: over[i] as number,
    });
  }
  return rows;
}

function LandingChart({
  data,
}: {
  data: { date: string; Benchmark: number; Modelo: number }[];
}) {
  const width = 1200;
  const height = 340;
  const padX = 22;
  const padTop = 20;
  const padBottom = 42;
  const plotH = height - padTop - padBottom;
  const plotW = width - 2 * padX;

  function seriesOf(key: "Benchmark" | "Modelo") {
    return (data || [])
      .map((d) => (typeof d[key] === "number" && isFinite(d[key]) ? d[key] : NaN))
      .filter((x) => isFinite(x));
  }

  const sB = seriesOf("Benchmark");
  const sM = seriesOf("Modelo");
  const all = [...sB, ...sM].filter((x) => x > 0);
  if (!all.length) {
    return <div style={{ fontSize: 14, color: "#a1a1aa" }}>Sem dados para o gráfico.</div>;
  }
  const minY = Math.max(Math.min(...all), 1e-9);
  const maxY = Math.max(...all);
  const logMin = Math.log(minY);
  const logMax = Math.log(maxY);
  const logRange = Math.max(1e-12, logMax - logMin);

  function yForValue(v: number): number {
    const lv = Math.log(Math.max(v, 1e-9));
    return padTop + ((logMax - lv) / logRange) * plotH;
  }

  function xForIndex(i: number): number {
    return padX + (i * plotW) / Math.max(1, data.length - 1);
  }

  /** Um rótulo por ano civil (primeira observação de cada ano na série). */
  const yearTicks: { year: number; x: number }[] = [];
  if (data.length > 0) {
    const y0 = parseInt(String(data[0].date).slice(0, 4), 10);
    const y1 = parseInt(String(data[data.length - 1].date).slice(0, 4), 10);
    if (isFinite(y0) && isFinite(y1) && y1 >= y0) {
      for (let y = y0; y <= y1; y++) {
        const idx = data.findIndex((row) => parseInt(String(row.date).slice(0, 4), 10) === y);
        if (idx < 0) continue;
        yearTicks.push({ year: y, x: xForIndex(idx) });
      }
    }
  }

  /** Grelha horizontal em espaço log (ticks uniformes em ln). */
  const gridLines: { y: number; label: string }[] = [];
  const nGrid = 5;
  for (let g = 0; g <= nGrid; g++) {
    const t = g / nGrid;
    const lv = logMin + t * logRange;
    const val = Math.exp(lv);
    const y = padTop + (1 - t) * plotH;
    const label =
      val >= 1000
        ? `${(val / 1000).toFixed(1)}k`
        : val >= 100
          ? val.toFixed(0)
          : val >= 10
            ? val.toFixed(1)
            : val.toFixed(2);
    gridLines.push({ y, label });
  }

  function toPath(key: "Benchmark" | "Modelo") {
    const pts = (data || [])
      .map((d, i) => {
        const yv = d[key];
        if (typeof yv !== "number" || !isFinite(yv) || yv <= 0) return null;
        const x = xForIndex(i);
        const y = yForValue(yv);
        return { x, y };
      })
      .filter(Boolean) as { x: number; y: number }[];

    if (!pts.length) return "";
    let p = `M ${pts[0].x.toFixed(2)} ${pts[0].y.toFixed(2)}`;
    for (let i = 1; i < pts.length; i++) p += ` L ${pts[i].x.toFixed(2)} ${pts[i].y.toFixed(2)}`;
    return p;
  }

  return (
    <div style={{ width: "100%", overflow: "hidden" }}>
      <svg
        width="100%"
        viewBox={`0 0 ${width} ${height}`}
        style={{ display: "block", background: "rgba(24,24,27,0.75)", borderRadius: 16, border: "1px solid rgba(255,255,255,0.1)" }}
      >
        {yearTicks.map((yt, i) => (
          <line
            key={`vy-${yt.year}-${i}`}
            x1={yt.x}
            y1={padTop}
            x2={yt.x}
            y2={padTop + plotH}
            stroke="rgba(255,255,255,0.06)"
            strokeWidth={1}
          />
        ))}
        {gridLines.map((gl, i) => (
          <g key={i}>
            <line
              x1={padX}
              y1={gl.y}
              x2={width - padX}
              y2={gl.y}
              stroke="rgba(255,255,255,0.1)"
              strokeDasharray="4 6"
            />
            <text
              x={padX + 4}
              y={Math.max(gl.y - 4, padTop + 10)}
              fill="rgba(161,161,170,0.65)"
              fontSize={10}
              fontFamily={DECIDE_APP_FONT_FAMILY}
            >
              {gl.label}
            </text>
          </g>
        ))}
        <path d={toPath("Benchmark")} stroke="#d4d4d4" strokeWidth="2" fill="none" opacity="0.9" />
        <path d={toPath("Modelo")} stroke="#a3a3a3" strokeWidth="2.5" fill="none" opacity="0.95" />
        {yearTicks.map((yt, i) => (
          <text
            key={`yl-${yt.year}-${i}`}
            x={yt.x}
            y={height - 12}
            textAnchor="middle"
            fill="rgba(212,212,216,0.85)"
            fontSize={10}
            fontFamily={DECIDE_APP_FONT_FAMILY}
          >
            {yt.year}
          </text>
        ))}
        <text
          x={width - padX}
          y={padTop + 12}
          textAnchor="end"
          fill="rgba(161,161,170,0.65)"
          fontSize={10}
          fontFamily={DECIDE_APP_FONT_FAMILY}
        >
          Base 100 · longo prazo
        </text>
      </svg>
      <div style={{ display: "flex", gap: 16, marginTop: 10, fontSize: 12, color: "#a1a1aa", flexWrap: "wrap" }}>
        <span>
          <span style={{ color: "#a3a3a3", fontWeight: 800 }}>●</span> Modelo CAP15
        </span>
        <span>
          <span style={{ color: "#d4d4d4", fontWeight: 800 }}>●</span> Mercado de referência
        </span>
      </div>
    </div>
  );
}

function KpiCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        background: "rgba(15,23,42,0.75)",
        border: "1px solid rgba(45,212,191,0.18)",
        borderRadius: 16,
        padding: "18px 20px",
        minHeight: 120,
      }}
    >
      <div style={{ fontSize: 11, fontWeight: 800, color: "#d4d4d4", letterSpacing: "0.04em", textTransform: "uppercase" }}>
        {title}
      </div>
      {subtitle ? (
        <div style={{ fontSize: 11, color: "#71717a", marginTop: 4, lineHeight: 1.35 }}>{subtitle}</div>
      ) : null}
      <div style={{ marginTop: 12 }}>{children}</div>
    </div>
  );
}

export default function DecideLandingPage() {
  const [resp, setResp] = useState<CoreOverlayResp | null>(null);
  const [loadErr, setLoadErr] = useState<string>("");
  const [loading, setLoading] = useState(true);

  const [simDraftCapital, setSimDraftCapital] = useState(LANDING_SIM_CAPITAL_EUR);
  const [simDraftYears, setSimDraftYears] = useState(LANDING_SIM_YEARS_DEFAULT);
  const [simBlockError, setSimBlockError] = useState("");
  /** Incrementa após “Ver resultado” com sucesso — re-dispara animação do bloco de resultados. */
  const [simOutcomeAnimKey, setSimOutcomeAnimKey] = useState(0);
  /** Pulso visual no bloco do simulador após scroll desde o CTA do hero. */
  const [landingSimHighlight, setLandingSimHighlight] = useState(false);
  const landingScrollTimersRef = useRef<{ tOn?: number; tOff?: number }>({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setLoadErr("");
      try {
        const body = {
          profile: "moderado",
          benchmark: "SPY",
          lookback_days: 120,
          top_q: 20,
          cap_per_ticker: 0.2,
          include_series: true,
          voltarget_enabled: true,
          voltarget_window: 60,
          raw_volmatch_enabled: true,
          raw_volmatch_window: null,
          raw_volmatch_k_min: 0.0,
          raw_volmatch_k_max: 4.0,
        };
        // 1) Freeze Modelo CAP15 (≤100% NV) — alinhado ao cartão no kpi_server (:5000)
        let r = await fetch("/api/landing/freeze-cap15-backtest", { method: "GET" });
        let j = (await r.json()) as CoreOverlayResp;
        if (cancelled) return;
        if (!r.ok || j?.ok === false) {
          r = await fetch("/api/landing/core-overlayed", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });
          j = (await r.json()) as CoreOverlayResp;
        }
        if (cancelled) return;
        if (!r.ok || j?.ok === false) {
          setLoadErr((j as any)?.error || (j as any)?.detail || `Erro HTTP ${r.status}`);
          setResp(null);
        } else {
          setResp(j);
        }
      } catch (e) {
        if (!cancelled) {
          setLoadErr(e instanceof Error ? e.message : "Falha de rede");
          setResp(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * Modelo CAP15: KPIs = série final do freeze API (moderado = vol do modelo; sem segundo filtro se `vol_matched_for_landing`).
   * Fallback core-overlayed: aplicar ajuste de vol ao benchmark se necessário.
   */
  const displaySeries = useMemo((): SeriesPack | undefined => {
    const s = resp?.series;
    if (!s?.equity_overlayed?.length || !s.benchmark_equity?.length) return s;
    if (resp?.result && (resp.result as { vol_matched_for_landing?: boolean }).vol_matched_for_landing === true) {
      return s;
    }
    const scaled = scaleModelEquityToBenchVol(s.equity_overlayed, s.benchmark_equity);
    return { ...s, equity_overlayed: scaled };
  }, [resp]);


  const chartData = useMemo(() => buildChartRows(displaySeries, true), [displaySeries]);
  const kpis = useMemo(() => extractKpisFromSeries(displaySeries), [displaySeries]);

  const simSeriesDates = displaySeries?.dates ?? [];
  const simModelEq = displaySeries?.equity_overlayed ?? [];
  const simBenchEq = displaySeries?.benchmark_equity ?? [];

  const simResult = useMemo(
    () =>
      buildSimulatorSeries(
        simSeriesDates as string[],
        simModelEq as number[],
        simBenchEq as number[],
        simDraftYears,
        simDraftCapital,
      ),
    [simSeriesDates, simModelEq, simBenchEq, simDraftYears, simDraftCapital],
  );

  const maxSimYears = useMemo(() => {
    const n = simSeriesDates.length;
    if (n < 2) return LANDING_SIM_YEARS_DEFAULT;
    return (n - 1) / TRADING_DAYS_PER_YEAR;
  }, [simSeriesDates.length]);

  const fmtEur0 = (x: number) =>
    new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(x);

  const landingDeltaLine = useMemo(() => {
    if (!simResult.ok) return null;
    return "Diferença ilustrativa face ao mercado no mesmo período. Os montantes finais estão nos cartões acima.";
  }, [simResult.ok]);

  const registerWithExampleHref = useMemo(
    () =>
      `/client/register?capital=${encodeURIComponent(
        String(Math.max(DECIDE_MIN_INVEST_EUR, Math.round(Number(simDraftCapital) || 0))),
      )}`,
    [simDraftCapital],
  );

  useEffect(() => {
    if (simResult.ok) setSimBlockError("");
  }, [simResult.ok]);

  useEffect(() => {
    return () => {
      const { tOn, tOff } = landingScrollTimersRef.current;
      if (tOn) window.clearTimeout(tOn);
      if (tOff) window.clearTimeout(tOff);
    };
  }, []);

  function runLandingSimulation() {
    setSimBlockError("");
    const cap = Number(simDraftCapital);
    const yrs = Number(simDraftYears);
    if (!Number.isFinite(cap) || cap < DECIDE_MIN_INVEST_EUR) {
      setSimBlockError(`O investimento mínimo é ${DECIDE_MIN_INVEST_EUR.toLocaleString("pt-PT")} €.`);
      return;
    }
    if (!Number.isFinite(yrs) || yrs <= 0) {
      setSimBlockError("Indique um número de anos válido (> 0).");
      return;
    }
    setSimOutcomeAnimKey((k) => k + 1);
    requestAnimationFrame(() => {
      try {
        document.getElementById("landing-sim-results")?.scrollIntoView({ behavior: "smooth", block: "start" });
      } catch {
        // ignore
      }
    });
  }

  function onSimInputKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      runLandingSimulation();
    }
  }

  function scrollToLandingSimulator() {
    if (typeof document === "undefined" || typeof window === "undefined") return;
    const prefersReduced = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;
    const focusEl = document.getElementById("landing-sim-focus");
    const wrapEl = document.getElementById("landing-simulator");
    const { tOn, tOff } = landingScrollTimersRef.current;
    if (tOn) window.clearTimeout(tOn);
    if (tOff) window.clearTimeout(tOff);
    landingScrollTimersRef.current.tOn = undefined;
    landingScrollTimersRef.current.tOff = undefined;
    setLandingSimHighlight(false);

    const scrollSmooth = !prefersReduced;
    const offsetPx = Math.min(160, Math.max(100, Math.round(window.innerHeight * 0.12)));

    try {
      if (focusEl) {
        if (scrollSmooth) {
          focusEl.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
        } else {
          const rect = focusEl.getBoundingClientRect();
          const top = rect.top + window.scrollY - (window.innerHeight / 2 - rect.height / 2);
          window.scrollTo({ top: Math.max(0, top), behavior: "auto" });
        }
      } else if (wrapEl) {
        if (scrollSmooth) {
          const rect = wrapEl.getBoundingClientRect();
          const y = rect.top + window.scrollY - offsetPx;
          window.scrollTo({ top: Math.max(0, y), behavior: "smooth" });
        } else {
          wrapEl.scrollIntoView({ behavior: "auto", block: "start" });
        }
      } else {
        return;
      }
    } catch {
      wrapEl?.scrollIntoView();
    }

    const delayOn = prefersReduced ? 40 : 720;
    const highlightMs = prefersReduced ? 320 : 2000;
    landingScrollTimersRef.current.tOn = window.setTimeout(() => {
      setLandingSimHighlight(true);
      landingScrollTimersRef.current.tOff = window.setTimeout(() => {
        setLandingSimHighlight(false);
        landingScrollTimersRef.current.tOn = undefined;
        landingScrollTimersRef.current.tOff = undefined;
      }, highlightMs);
    }, delayOn);
  }

  const fmtPct = (x: number | null | undefined, digits = 1) =>
    x === null || x === undefined || !isFinite(x) ? "—" : `${(x * 100).toFixed(digits)}%`;

  const fmtSharpe = (x: number | null | undefined) =>
    x === null || x === undefined || !isFinite(x) ? "—" : x.toFixed(2);

  /** Já em % (0–100), p.ex. meses positivos. */
  const fmtRatePct = (x: number | null | undefined) =>
    x === null || x === undefined || !isFinite(x) ? "—" : `${x.toFixed(1)}%`;

  useEffect(() => {
    if (typeof document === "undefined") return;
    if (
      kpis?.modelCagr != null &&
      kpis?.benchCagr != null &&
      isFinite(kpis.modelCagr) &&
      isFinite(kpis.benchCagr)
    ) {
      const sign = kpis.modelCagr >= 0 ? "+" : "";
      document.title = `DECIDE — ${sign}${fmtPctPt(kpis.modelCagr, 1)}% vs ${fmtPctPt(kpis.benchCagr, 1)}% · Modelo CAP15 (ilustrativo)`;
    } else if (!loading) {
      document.title = "DECIDE — Modelo CAP15 vs benchmark (ilustrativo)";
    }
  }, [kpis, loading]);

  return (
    <>
      <Head>
        <title>DECIDE — Modelo CAP15 vs benchmark (histórico ilustrativo)</title>
        <meta
          name="description"
          content="DECIDE: histórico ilustrativo do Modelo CAP15 (≤100% NAV) vs benchmark; no perfil moderado a vol segue o modelo. Recomendações com a sua aprovação."
        />
        <style
          dangerouslySetInnerHTML={{
            __html: `
@keyframes landing-sim-outcome-in {
  from { opacity: 0.35; transform: translateY(12px); }
  to { opacity: 1; transform: translateY(0); }
}
@keyframes landing-sim-outcome-glow {
  0% { box-shadow: 0 0 0 0 rgba(74,222,128,0.45), inset 0 0 0 1px rgba(74,222,128,0.35); }
  55% { box-shadow: 0 0 0 14px rgba(74,222,128,0), inset 0 0 0 1px rgba(74,222,128,0.2); }
  100% { box-shadow: 0 0 0 0 rgba(74,222,128,0), inset 0 0 0 1px rgba(148,163,184,0.12); }
}
.landing-sim-outcome-anim {
  animation: landing-sim-outcome-in 0.48s ease-out forwards, landing-sim-outcome-glow 1s ease-out;
}
.landing-hero-cta {
  display: inline-block;
  background: linear-gradient(180deg, #fdba74 0%, #f97316 42%, #ea580c 100%);
  color: #1c1917;
  font-weight: 900;
  font-size: clamp(16px, 2.1vw, 18px);
  padding: 17px 40px;
  border-radius: 16px;
  border: 2px solid rgba(255,247,237,0.65);
  box-shadow:
    0 0 0 1px rgba(251,146,60,0.55),
    0 0 0 8px rgba(249,115,22,0.12),
    0 0 48px rgba(249,115,22,0.55),
    0 0 80px rgba(251,146,60,0.22),
    0 18px 44px rgba(234,88,12,0.5);
  cursor: pointer;
  font-family: inherit;
  letter-spacing: -0.02em;
  line-height: 1.2;
  transition: transform 0.2s ease, box-shadow 0.22s ease, filter 0.2s ease;
}
.landing-hero-cta:hover {
  transform: scale(1.02);
  filter: brightness(1.08);
  box-shadow:
    0 0 0 1px rgba(251,146,60,0.72),
    0 0 0 14px rgba(249,115,22,0.14),
    0 0 64px rgba(249,115,22,0.62),
    0 0 110px rgba(251,146,60,0.3),
    0 22px 52px rgba(234,88,12,0.58);
}
.landing-hero-cta:active {
  transform: scale(0.98);
  filter: brightness(0.96);
  box-shadow:
    0 0 0 1px rgba(251,146,60,0.5),
    0 0 32px rgba(249,115,22,0.42),
    0 12px 36px rgba(234,88,12,0.48);
}
.landing-simulator-wrap {
  scroll-margin-top: 24px;
  border-radius: 22px;
}
@keyframes landing-sim-wrap-glow {
  0% {
    filter: drop-shadow(0 0 0 rgba(249,115,22,0)) drop-shadow(0 -6px 36px rgba(249,115,22,0.38));
  }
  40% {
    filter: drop-shadow(0 0 22px rgba(45,212,191,0.18)) drop-shadow(0 -4px 48px rgba(249,115,22,0.28));
  }
  100% {
    filter: drop-shadow(0 0 0 rgba(0,0,0,0));
  }
}
.landing-simulator-wrap.landing-sim-highlight {
  animation: landing-sim-wrap-glow 1.65s ease-out;
}
`,
          }}
        />
      </Head>

      <div
        style={{
          minHeight: "100vh",
          width: "100%",
          overflowX: "hidden",
          background: "var(--page-gradient)",
          color: "var(--text-primary)",
          fontFamily: DECIDE_APP_FONT_FAMILY,
        }}
      >
        <header
          className="decide-top-header decide-top-header--landing"
          style={{
            position: "relative",
            width: "100%",
            boxSizing: "border-box",
            background: "transparent",
            backgroundColor: "rgba(0,0,0,0)",
          }}
        >
          <div
            style={{
              position: "relative",
              width: "100%",
              margin: "0 auto",
              padding: "8px clamp(12px, 2.8vw, 24px) 8px",
              boxSizing: "border-box",
            }}
          >
            <nav
              style={{
                position: "absolute",
                top: 4,
                right: "clamp(12px, 2.8vw, 24px)",
                zIndex: 2,
                display: "flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              <Link href="/client/register" style={decideHeaderNavLinkStyle}>
                Registo
              </Link>
              <Link href="/client/login" style={{ ...decideHeaderNavLinkStyle, fontWeight: 700 }}>
                Login
              </Link>
            </nav>
            <div
              style={{
                display: "flex",
                justifyContent: "center",
                alignItems: "center",
                width: "100%",
              }}
            >
              <Link
                href="/"
                style={{
                  display: "inline-flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  lineHeight: 0,
                }}
                aria-label="DECIDE — Powered by AI — início"
              >
                <DecideLogoLockupEmbeddedRecolor
                  priority
                  sizes="(max-width: 1600px) 99vw, 1600px"
                  variant="landing"
                />
              </Link>
            </div>
          </div>
        </header>

        <main
          style={{
            maxWidth: LANDING_MAIN_MAX_WIDTH,
            margin: "0 auto",
            padding: "32px clamp(16px, 4vw, 40px) 56px",
            width: "100%",
            boxSizing: "border-box",
          }}
        >
          <section style={{ margin: "0 0 36px", width: "100%", maxWidth: "100%", boxSizing: "border-box" }}>
            <div
              style={{
                textAlign: "center",
                maxWidth: LANDING_HEADLINE_MAX_WIDTH,
                margin: "0 auto 28px",
              }}
            >
            <h1
              style={{
                fontSize: "clamp(1.5rem, 3.8vw, 2.05rem)",
                fontWeight: 800,
                lineHeight: 1.22,
                margin: "0 0 18px",
                letterSpacing: "-0.02em",
                color: "#f8fafc",
              }}
            >
              Invista com decisões baseadas em dados,{" "}
              <span style={{ color: "#86efac" }}>sempre com a sua aprovação</span>.
            </h1>
            <p
              style={{
                fontSize: "clamp(1.35rem, 3.5vw, 1.85rem)",
                fontWeight: 900,
                margin: "0 0 14px",
                letterSpacing: "-0.02em",
                color: "var(--text-primary)",
              }}
            >
              <span
                style={{
                  display: "block",
                  fontSize: "0.42em",
                  fontWeight: 800,
                  letterSpacing: "0.1em",
                  color: "#71717a",
                  marginBottom: 10,
                  textTransform: "uppercase",
                }}
              >
                Histórico ilustrativo · Modelo CAP15 vs mercado de referência
              </span>
              <span style={{ fontSize: "0.42em", fontWeight: 700, color: "#a1a1aa", display: "block", marginBottom: 6 }}>
                CAGR indicativo (moderado: vol do modelo, sem igualar ao benchmark)
              </span>
              <span style={{ color: "#86efac", fontSize: "0.5em", fontWeight: 700 }}>Modelo CAP15 </span>
              <span style={{ color: "#4ade80" }}>
                {kpis?.modelCagr != null && isFinite(kpis.modelCagr)
                  ? `${kpis.modelCagr >= 0 ? "+" : ""}${fmtPctPt(kpis.modelCagr, 1)}%`
                  : loading
                    ? "…"
                    : "—"}
              </span>
              <span style={{ color: "#71717a", fontWeight: 700, fontSize: "0.85em" }}> vs </span>
              <span style={{ color: "#d4d4d4", fontSize: "0.5em", fontWeight: 700 }}>Mercado ref. </span>
              <span style={{ color: "#d4d4d4" }}>
                {kpis?.benchCagr != null && isFinite(kpis.benchCagr) ? `${fmtPctPt(kpis.benchCagr, 1)}%` : loading ? "…" : "—"}
              </span>
              <span style={{ fontWeight: 600, fontSize: "0.5em", display: "block", marginTop: 10, color: "#71717a", lineHeight: 1.45 }}>
                Exposição a risco ≤100% do NAV (freeze MAX100EXP). Indicativo — não é promessa de resultados futuros.
              </span>
            </p>
            <div
              style={{
                marginTop: 36,
                marginBottom: 10,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 14,
              }}
            >
              <button type="button" onClick={scrollToLandingSimulator} className="landing-hero-cta">
                Começar com o meu capital
              </button>
              <p
                style={{
                  margin: 0,
                  fontSize: 13,
                  fontWeight: 600,
                  color: "#a1a1aa",
                  letterSpacing: "0.02em",
                  textAlign: "center",
                  maxWidth: 360,
                  lineHeight: 1.45,
                }}
              >
                Sem compromisso. Decide sempre.
              </p>
              <p
                style={{
                  margin: 0,
                  fontSize: 12,
                  fontWeight: 600,
                  color: "#71717a",
                  letterSpacing: "0.01em",
                  textAlign: "center",
                  maxWidth: 400,
                  lineHeight: 1.45,
                }}
              >
                Risco alinhado com o mercado. Sem alavancagem oculta.
              </p>
            </div>
            </div>

            <div
              id="landing-simulator"
              className={`landing-simulator-wrap${landingSimHighlight ? " landing-sim-highlight" : ""}`}
            >
            {loading || simSeriesDates.length > 1 ? (
              <div
                style={{
                  width: "100%",
                  maxWidth: "100%",
                  margin: "0 0 32px",
                  boxSizing: "border-box",
                  padding: "clamp(22px, 3.2vw, 40px) clamp(20px, 5vw, 52px)",
                  paddingTop: "clamp(28px, 4vw, 48px)",
                  borderRadius: 20,
                  background: `
                    linear-gradient(180deg, rgba(249,115,22,0.16) 0%, rgba(249,115,22,0.04) 14%, transparent 38%),
                    linear-gradient(180deg, rgba(15,23,42,0.96) 0%, rgba(15,23,42,0.86) 50%, rgba(30,41,59,0.65) 100%)
                  `,
                  border: "1px solid rgba(45,212,191,0.14)",
                  boxShadow:
                    "0 -20px 48px -28px rgba(249,115,22,0.22), 0 20px 56px rgba(0,0,0,0.42), 0 0 80px rgba(15,118,110,0.06)",
                  overflow: "visible",
                }}
              >
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 800,
                    letterSpacing: "0.08em",
                    color: "#71717a",
                    textTransform: "uppercase",
                    marginBottom: 14,
                    textAlign: "center",
                  }}
                >
                  Valor ilustrativo · mesma janela para ambas as curvas
                </div>
                <div
                  style={{
                    marginBottom: 22,
                    paddingBottom: 18,
                    borderBottom: "1px solid rgba(148,163,184,0.1)",
                  }}
                >
                  <p
                    style={{
                      margin: 0,
                      color: "#ccfbf1",
                      fontSize: "clamp(13px, 1.5vw, 15px)",
                      fontWeight: 700,
                      textAlign: "center",
                      lineHeight: 1.55,
                    }}
                  >
                    <strong style={{ color: "#fff" }}>Exemplo para começar:</strong>{" "}
                    <strong style={{ color: "#ecfdf5" }}>{fmtEur0(LANDING_SIM_CAPITAL_EUR)}</strong> durante{" "}
                    <strong style={{ color: "#ecfdf5" }}>~{LANDING_SIM_YEARS_DEFAULT} anos</strong>. Ajuste abaixo e carregue em{" "}
                    <strong style={{ color: "#ecfdf5" }}>Ver resultado</strong>.
                  </p>
                </div>

                <div
                  id="landing-sim-focus"
                  tabIndex={-1}
                  style={{ outline: "none", scrollMarginTop: "min(20vh, 160px)" }}
                >
                  <p
                    style={{
                      margin: "0 0 clamp(14px, 2.5vw, 20px)",
                      textAlign: "center",
                      fontSize: "clamp(13px, 1.45vw, 15px)",
                      fontWeight: 700,
                      color: "#fcd34d",
                      letterSpacing: "0.02em",
                      lineHeight: 1.45,
                    }}
                  >
                    Teste com o seu valor — demora 2 segundos
                  </p>
                  <div style={{ textAlign: "center", marginBottom: "clamp(20px, 3vw, 28px)" }}>
                    <div
                      style={{
                        fontSize: "clamp(1.15rem, 2.6vw, 1.5rem)",
                        fontWeight: 900,
                        color: "#f8fafc",
                        letterSpacing: "-0.02em",
                        lineHeight: 1.2,
                      }}
                    >
                      Veja quanto poderia ter hoje,
                    </div>
                    <div
                      style={{
                        marginTop: 8,
                        fontSize: "clamp(0.98rem, 2vw, 1.15rem)",
                        fontWeight: 700,
                        color: "#d4d4d4",
                        lineHeight: 1.35,
                      }}
                    >
                      com o mesmo risco do mercado
                    </div>
                  </div>

                  <div
                    onPointerDownCapture={onThousandsFieldRowPointerDownCapture}
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      gap: "clamp(10px, 1.6vw, 16px)",
                      rowGap: 12,
                      alignItems: "flex-end",
                      justifyContent: "center",
                      width: "100%",
                      maxWidth: 920,
                      marginLeft: "auto",
                      marginRight: "auto",
                      marginBottom: 4,
                      boxSizing: "border-box",
                    }}
                  >
                  <label
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 8,
                      color: "#d4d4d8",
                      fontSize: 14,
                      fontWeight: 800,
                      letterSpacing: "-0.01em",
                      flex: "5.5 1 0",
                      minWidth: "min(100%, 220px)",
                      maxWidth: "min(100%, 620px)",
                      boxSizing: "border-box",
                    }}
                  >
                    Capital inicial (€)
                    <ThousandsNumberInput
                      min={DECIDE_MIN_INVEST_EUR}
                      maxDecimals={0}
                      value={simDraftCapital}
                      onChange={asThousandsNumberChange(setSimDraftCapital)}
                      onKeyDown={onSimInputKeyDown}
                      style={{
                        width: "100%",
                        height: 56,
                        minHeight: 56,
                        lineHeight: "52px",
                        background: "rgba(2,8,22,0.94)",
                        border: "2px solid rgba(45,212,191,0.55)",
                        borderRadius: 12,
                        padding: "0 16px",
                        margin: 0,
                        color: "#fff",
                        fontSize: "clamp(17px, 2.15vw, 22px)",
                        fontWeight: 900,
                        letterSpacing: "-0.02em",
                        boxSizing: "border-box",
                        boxShadow: "0 4px 24px rgba(15,118,110,0.12)",
                        verticalAlign: "middle",
                      }}
                    />
                  </label>
                  <label
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 8,
                      color: "#f8fafc",
                      fontSize: 14,
                      fontWeight: 900,
                      letterSpacing: "-0.02em",
                      flex: "2.15 1 0",
                      minWidth: "min(100%, 172px)",
                      maxWidth: "min(100%, 248px)",
                      boxSizing: "border-box",
                    }}
                  >
                    Anos
                    <ThousandsNumberInput
                      min={0.5}
                      max={maxSimYears}
                      maxDecimals={1}
                      value={simDraftYears}
                      onChange={asThousandsNumberChange(setSimDraftYears)}
                      onKeyDown={onSimInputKeyDown}
                      style={{
                        width: "100%",
                        height: 56,
                        minHeight: 56,
                        lineHeight: "52px",
                        background: "rgba(8,15,35,0.92)",
                        border: "2px solid rgba(45,212,191,0.45)",
                        borderRadius: 12,
                        padding: "0 16px",
                        margin: 0,
                        color: "#f8fafc",
                        fontSize: "clamp(17px, 2.05vw, 21px)",
                        fontWeight: 900,
                        letterSpacing: "-0.02em",
                        boxSizing: "border-box",
                        boxShadow: "0 4px 20px rgba(15,118,110,0.1)",
                        verticalAlign: "middle",
                      }}
                    />
                  </label>
                  <button
                    type="button"
                    onClick={runLandingSimulation}
                    style={{
                      height: 56,
                      minHeight: 56,
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      background: DECIDE_DASHBOARD.buttonRegister,
                      color: "#fff",
                      fontWeight: 900,
                      fontSize: "clamp(14px, 1.35vw, 16px)",
                      lineHeight: 1.2,
                      padding: "0 20px",
                      margin: 0,
                      marginLeft: 12,
                      borderRadius: 12,
                      border: DECIDE_DASHBOARD.kpiMenuMainButtonBorder,
                      cursor: "pointer",
                      boxShadow: DECIDE_DASHBOARD.kpiMenuMainButtonShadow,
                      whiteSpace: "nowrap",
                      flex: "0 0 clamp(168px, 22vw, 215px)",
                      minWidth: 168,
                      maxWidth: 220,
                      alignSelf: "flex-end",
                      boxSizing: "border-box",
                    }}
                  >
                    Ver resultado
                  </button>
                </div>
                </div>
                {simBlockError ? (
                  <p style={{ color: "#f87171", fontSize: 13, marginTop: 12, textAlign: "center", marginBottom: 0 }}>
                    {simBlockError}
                  </p>
                ) : null}

                <div
                  id="landing-sim-results"
                  style={{
                    marginTop: simBlockError ? 16 : 20,
                    paddingTop: 20,
                    borderTop: "1px solid rgba(148,163,184,0.1)",
                  }}
                >
                  {loading ? (
                    <p style={{ margin: "0 0 12px", fontSize: 12, color: "#71717a", textAlign: "center" }}>…</p>
                  ) : !simResult.ok ? (
                    <p style={{ margin: "0 0 12px", fontSize: 12, color: "#f87171", textAlign: "center", lineHeight: 1.45 }}>
                      {simResult.message}
                    </p>
                  ) : (
                    <div
                      key={simOutcomeAnimKey}
                      className={simOutcomeAnimKey > 0 ? "landing-sim-outcome-anim" : undefined}
                    >
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 300px), 1fr))",
                      gap: "clamp(14px, 2.5vw, 28px)",
                      marginBottom: 16,
                      width: "100%",
                      maxWidth: "none",
                      marginLeft: "auto",
                      marginRight: "auto",
                    }}
                  >
                    <div
                      style={{
                        padding: "clamp(22px, 3.2vw, 36px) clamp(18px, 2.8vw, 32px)",
                        borderRadius: 18,
                        background: "linear-gradient(165deg, rgba(34,197,94,0.22), rgba(15,23,42,0.55))",
                        border: "none",
                        textAlign: "center",
                        boxShadow: "0 0 0 1px rgba(74,222,128,0.12), 0 12px 48px rgba(34,197,94,0.18), 0 0 64px rgba(74,222,128,0.15)",
                      }}
                    >
                      <div
                        style={{
                          fontSize: "clamp(10px, 1.1vw, 12px)",
                          fontWeight: 800,
                          color: "#86efac",
                          letterSpacing: "0.08em",
                          marginBottom: 12,
                          textTransform: "uppercase",
                        }}
                      >
                        Modelo CAP15
                      </div>
                      <div
                        style={{
                          fontSize: "clamp(1.75rem, 5vw, 2.85rem)",
                          fontWeight: 900,
                          color: "#f0fdf4",
                          letterSpacing: "-0.035em",
                          lineHeight: 1.05,
                          textShadow:
                            "0 0 48px rgba(74,222,128,0.45), 0 0 80px rgba(34,197,94,0.2), 0 2px 20px rgba(0,0,0,0.35)",
                        }}
                      >
                        {fmtEur0(simResult.modelEnd)}
                      </div>
                      <div style={{ fontSize: 11, color: "#71717a", marginTop: 12 }}>Vol ≈ referência</div>
                    </div>
                    <div
                      style={{
                        padding: "clamp(18px, 2.6vw, 28px) clamp(16px, 2.2vw, 26px)",
                        borderRadius: 18,
                        background: "linear-gradient(165deg, rgba(30,41,59,0.85), rgba(15,23,42,0.65))",
                        border: "none",
                        textAlign: "center",
                        boxShadow: "0 0 0 1px rgba(148,163,184,0.08), 0 8px 32px rgba(0,0,0,0.2)",
                        opacity: 0.95,
                      }}
                    >
                      <div
                        style={{
                          fontSize: "clamp(10px, 1vw, 11px)",
                          fontWeight: 700,
                          color: "#71717a",
                          letterSpacing: "0.06em",
                          marginBottom: 10,
                          textTransform: "uppercase",
                        }}
                      >
                        Mercado de referência
                      </div>
                      <div
                        style={{
                          fontSize: "clamp(1.2rem, 3.2vw, 1.72rem)",
                          fontWeight: 800,
                          color: "#a1a1aa",
                          letterSpacing: "-0.025em",
                          lineHeight: 1.12,
                        }}
                      >
                        {fmtEur0(simResult.benchEnd)}
                      </div>
                      <div style={{ fontSize: 10, color: "#71717a", marginTop: 10 }}>Mesmo período</div>
                    </div>
                  </div>
                  {landingDeltaLine ? (
                    <div
                      style={{
                        textAlign: "center",
                        fontSize: "clamp(0.82rem, 1.9vw, 0.92rem)",
                        fontWeight: 500,
                        color: "#94a3b8",
                        padding: "12px 14px",
                        borderRadius: 12,
                        marginBottom: 6,
                        maxWidth: "none",
                        width: "100%",
                        boxSizing: "border-box",
                        background: "rgba(24,24,27,0.55)",
                        border: "1px solid rgba(63,63,70,0.4)",
                        lineHeight: 1.5,
                        letterSpacing: "0",
                      }}
                    >
                      {landingDeltaLine}
                    </div>
                  ) : null}
                  <p
                    style={{
                      margin: "10px 0 0",
                      fontSize: 10,
                      fontWeight: 500,
                      color: "rgba(148,163,184,0.72)",
                      textAlign: "center",
                      lineHeight: 1.5,
                      letterSpacing: "0.02em",
                    }}
                  >
                    Histórico ilustrativo — sem garantia de resultados futuros.
                  </p>

                  <p
                    style={{ margin: "14px 0 6px", fontSize: 12, color: "#71717a", textAlign: "center", lineHeight: 1.45 }}
                  >
                    {simResult.windowLabel}
                  </p>
                  {simResult.warn ? (
                    <p
                      style={{
                        margin: "0 0 10px",
                        fontSize: 12,
                        color: "#fcd34d",
                        textAlign: "center",
                        lineHeight: 1.45,
                      }}
                    >
                      {simResult.warn}
                    </p>
                  ) : null}
                  <p
                    style={{
                      margin: "0 0 4px",
                      fontSize: 11,
                      fontWeight: 600,
                      color: "#71717a",
                      textAlign: "center",
                      lineHeight: 1.45,
                    }}
                  >
                    Com{" "}
                    <span style={{ color: "#a1a1aa" }}>{fmtEur0(simDraftCapital)}</span>
                    {" · "}
                    <span style={{ color: "#a1a1aa" }}>
                      ~{simDraftYears} {simDraftYears === 1 ? "ano" : "anos"}
                    </span>
                    {" · "}
                    ilustrativo no fim do período
                  </p>
                    </div>
                  )}

                  <p
                    style={{
                      margin: "0 0 8px",
                      fontSize: 11,
                      color: "#71717a",
                      textAlign: "center",
                      lineHeight: 1.45,
                    }}
                  >
                    Horizonte máximo nesta série: ~{maxSimYears.toFixed(1)} anos ({simSeriesDates.length} dias úteis).
                  </p>
                  <p style={{ margin: 0, fontSize: 13, color: "#a1a1aa", textAlign: "center", lineHeight: 1.5 }}>
                    <Link href="/client-dashboard" style={{ color: "#d4d4d4", fontWeight: 800 }}>
                      Ver análise completa no dashboard
                    </Link>
                  </p>
                  </div>
                <div
                  style={{
                    maxWidth: 560,
                    margin: "0 auto",
                    padding: "0 8px",
                  }}
                >
                  <p style={{ margin: "0 0 8px", fontSize: 14, color: "#d4d4d8", lineHeight: 1.55, textAlign: "center" }}>
                    Crescimento composto ao longo do tempo, com risco alinhado ao mercado de referência.
                  </p>
                  <p
                    style={{
                      margin: "0 0 10px",
                      fontSize: 13,
                      fontWeight: 700,
                      color: "#a1a1aa",
                      lineHeight: 1.45,
                      textAlign: "center",
                      fontStyle: "italic",
                    }}
                  >
                    Uma diferença que só o tempo e a disciplina revelam.
                  </p>
                  <p style={{ margin: 0, fontSize: 10, color: "#71717a", lineHeight: 1.45, textAlign: "center", opacity: 0.88 }}>
                    Indicativo — não é aconselhamento. Leia a informação regulamentar antes de investir.
                  </p>
                </div>
              </div>
            ) : (
              <div
                style={{
                  margin: "0 0 32px",
                  padding: "28px 20px",
                  borderRadius: 20,
                  textAlign: "center",
                  color: "#a1a1aa",
                  fontSize: 15,
                  fontWeight: 600,
                  border: "1px solid rgba(148,163,184,0.2)",
                  background: "rgba(15,23,42,0.5)",
                }}
              >
                Simulador indisponível neste momento. Atualize a página ou tente mais tarde.
              </div>
            )}
            </div>

            <p
              style={{
                fontSize: 16,
                color: "#a1a1aa",
                lineHeight: 1.6,
                margin: "0 auto 26px",
                maxWidth: 520,
                padding: "0 12px",
              }}
            >
              O modelo sugere. Decide. Nada é executado sem a sua aprovação.
            </p>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
              <p
                style={{
                  margin: 0,
                  fontSize: 13,
                  color: "#d4d4d8",
                  fontWeight: 600,
                  lineHeight: 1.45,
                  textAlign: "center",
                  maxWidth: 420,
                }}
              >
                Investimento mínimo{" "}
                <strong style={{ color: "var(--text-primary)" }}>{DECIDE_MIN_INVEST_EUR.toLocaleString("pt-PT")} €</strong>.
              </p>
              <Link
                href={registerWithExampleHref}
                style={{
                  display: "inline-block",
                  background: "linear-gradient(180deg, #fdba74 0%, #f97316 45%, #ea580c 100%)",
                  color: "#1c1917",
                  fontWeight: 900,
                  fontSize: 17,
                  padding: "16px 36px",
                  borderRadius: 16,
                  textDecoration: "none",
                  border: "1px solid rgba(255,237,213,0.55)",
                  boxShadow:
                    "0 0 0 1px rgba(251,146,60,0.45), 0 0 32px rgba(249,115,22,0.55), 0 18px 48px rgba(234,88,12,0.5)",
                  width: "100%",
                  maxWidth: 420,
                  textAlign: "center",
                  boxSizing: "border-box",
                  minWidth: 0,
                }}
              >
                Começar com este valor
              </Link>
              <p style={{ margin: 0, fontSize: 12, color: "#a1a1aa", fontWeight: 600, letterSpacing: "0.01em" }}>
                Pode começar em poucos minutos.
              </p>
              <p style={{ margin: 0, fontSize: 12, color: "#a1a1aa", fontWeight: 600, letterSpacing: "0.01em" }}>
                Comece hoje — decide sempre.
              </p>
              <Link
                href="/client/login"
                style={{ color: "#d4d4d4", fontWeight: 700, fontSize: 14, textDecoration: "underline", textUnderlineOffset: 4 }}
              >
                Já tenho conta - Entrar
              </Link>
            </div>
          </section>

          <section
            style={{
              marginBottom: 36,
              padding: "24px 22px",
              borderRadius: 18,
              background: "rgba(15,23,42,0.65)",
              border: "1px solid rgba(45,212,191,0.2)",
            }}
          >
            <h2 style={{ margin: "0 0 16px", fontSize: 18, fontWeight: 900, color: "#f1f5f9", textAlign: "center" }}>
              Como funciona
            </h2>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
                gap: 18,
                textAlign: "center",
              }}
            >
              {[
                { n: "1", t: "O modelo prepara a decisão mensal", d: "Análise sistemática, alinhada ao seu perfil." },
                { n: "2", t: "Recebe uma recomendação clara", d: "O que mudar, quando — sem jargão desnecessário." },
                { n: "3", t: "Aprova ou rejeita", d: "Controlo total. Nada executa sem o seu ok." },
              ].map((step) => (
                <div key={step.n} style={{ padding: "8px 6px" }}>
                  <div
                    style={{
                      width: 36,
                      height: 36,
                      margin: "0 auto 10px",
                      borderRadius: "50%",
                      background: "rgba(63,115,255,0.35)",
                      border: "1px solid rgba(45,212,191,0.4)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontWeight: 900,
                      color: "#d4d4d4",
                    }}
                  >
                    {step.n}
                  </div>
                  <div style={{ fontWeight: 800, fontSize: 15, color: "var(--text-primary)", marginBottom: 6 }}>{step.t}</div>
                  <div style={{ fontSize: 13, color: "#a1a1aa", lineHeight: 1.5 }}>{step.d}</div>
                </div>
              ))}
            </div>
            <div
              style={{
                marginTop: 22,
                paddingTop: 20,
                borderTop: "1px solid rgba(148,163,184,0.15)",
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                gap: 12,
                fontSize: 13,
                color: "#d4d4d8",
                lineHeight: 1.5,
              }}
            >
              <div style={{ fontWeight: 800 }}>
                <span style={{ color: "#86efac" }}>✓</span> Verificação de identidade no registo (2 min.)
              </div>
              <div style={{ fontWeight: 800 }}>
                <span style={{ color: "#86efac" }}>✓</span> Ligação à sua conta na corretora (IBKR)
              </div>
              <div style={{ fontWeight: 800 }}>
                <span style={{ color: "#86efac" }}>✓</span> Controlo total — você decide cada passo
              </div>
            </div>
            <div style={{ textAlign: "center", marginTop: 22 }}>
              <Link
                href={registerWithExampleHref}
                style={{
                  display: "inline-block",
                  background: "linear-gradient(180deg, #fb923c 0%, #ea580c 100%)",
                  color: "#1c1917",
                  fontWeight: 900,
                  fontSize: 17,
                  padding: "16px 36px",
                  borderRadius: 16,
                  textDecoration: "none",
                  border: "1px solid rgba(255,255,255,0.35)",
                  boxShadow: "0 14px 44px rgba(234,88,12,0.38)",
                  minWidth: 220,
                }}
              >
                Começar registo seguro
              </Link>
            </div>
          </section>

          <section style={{ marginBottom: 36 }}>
            <h2 style={{ fontSize: 13, fontWeight: 800, color: "#d4d4d4", letterSpacing: "0.06em", margin: "0 0 8px" }}>
              NÚMEROS DE REFERÊNCIA
            </h2>
            <p
              style={{
                fontSize: 15,
                color: "#d4d4d8",
                margin: "0 0 8px",
                lineHeight: 1.55,
                maxWidth: 680,
              }}
            >
              ~20 anos, <strong>Modelo CAP15</strong> (≤100% do NAV, freeze V2.3 smooth). No <strong>moderado</strong>, a
              volatilidade da série segue o <strong>próprio modelo</strong> (sem reescala ao benchmark), alinhado ao painel KPI.
              Indicativo.
            </p>
            <details style={{ marginBottom: 18, fontSize: 11, color: "#71717a" }}>
              <summary
                style={{
                  cursor: "pointer",
                  color: "#71717a",
                  fontWeight: 500,
                  listStyle: "none",
                }}
              >
                Detalhes técnicos (opcional)
              </summary>
              <p style={{ marginTop: 10, lineHeight: 1.55, color: "#71717a" }}>
                Base: freeze ~20Y{" "}
                <code style={{ color: "#787f8a" }}>DECIDE_MODEL_V5_V2_3_SMOOTH</code>. A API da landing
                no <strong style={{ color: "#a1a1aa" }}>moderado</strong> usa a vol do modelo (sem igualar ao benchmark) para CAGR e
                gráficos. No painel KPI (:5000): moderado com vol do modelo; conservador/dinâmico com alvo vs benchmark. Métricas avançadas na{" "}
                <Link href="/client-dashboard" style={{ color: "#787f8a", textDecoration: "underline", textUnderlineOffset: 2 }}>
                  área de cliente
                </Link>
                .
              </p>
            </details>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
                gap: 14,
              }}
            >
              <KpiCard title="Modelo CAP15" subtitle="≤100% NAV · moderado: vol do modelo">
                <div style={{ fontSize: 26, fontWeight: 900, color: "#fff" }}>{fmtPct(kpis?.modelCagr, 1)}</div>
                <div style={{ fontSize: 12, color: "#a1a1aa", marginTop: 4 }}>Crescimento anualizado (indicativo)</div>
                <div style={{ fontSize: 14, color: "#d4d4d8", marginTop: 10, lineHeight: 1.55 }}>
                  Oscilação ≈ {fmtPct(kpis?.modelVol, 1)} · Queda máx. ≈ {fmtPct(kpis?.modelMaxDd, 1)}
                  <br />
                  Qualidade risco/retorno ≈ {fmtSharpe(kpis?.modelSharpe)}
                  <br />
                  Meses a subir: {fmtRatePct(kpis?.pctMonthsPositiveModel)}
                  <br />
                  Meses a ganhar ao mercado: {fmtRatePct(kpis?.pctMonthsAboveBench)}
                  <span style={{ color: "#71717a", fontSize: 11 }}>
                    {kpis?.nMonths != null ? ` · ${kpis.nMonths} meses` : ""}
                  </span>
                </div>
              </KpiCard>
              <KpiCard title="Mercado de referência" subtitle="Mesma linha temporal">
                <div style={{ fontSize: 26, fontWeight: 900, color: "#d4d4d4" }}>{fmtPct(kpis?.benchCagr, 1)}</div>
                <div style={{ fontSize: 12, color: "#a1a1aa", marginTop: 4 }}>Crescimento anualizado (indicativo)</div>
                <div style={{ fontSize: 14, color: "#d4d4d8", marginTop: 10, lineHeight: 1.55 }}>
                  Oscilação ≈ {fmtPct(kpis?.benchVol, 1)} · Queda máx. ≈ {fmtPct(kpis?.benchMaxDd, 1)}
                  <br />
                  Qualidade risco/retorno ≈ {fmtSharpe(kpis?.benchSharpe)}
                </div>
              </KpiCard>
              <KpiCard title="No seu dashboard" subtitle="Depois de entrar">
                <div style={{ fontSize: 15, color: "var(--text-primary)", lineHeight: 1.55 }}>
                  Gráficos completos, carteira sugerida e cenários com <strong>limites de exposição</strong> ao capital — para
                  alinhar o modelo à sua realidade.
                </div>
              </KpiCard>
            </div>
            {loading ? (
              <p style={{ marginTop: 14, fontSize: 13, color: "#71717a" }}>A carregar indicadores…</p>
            ) : loadErr ? (
              <p style={{ marginTop: 14, fontSize: 13, color: "#fca5a5" }}>
                Não foi possível carregar os dados agora. Pode mesmo assim{" "}
                <Link href={registerWithExampleHref} style={{ color: "#fca5a5", fontWeight: 700 }}>
                  criar conta
                </Link>
                . <span style={{ opacity: 0.85 }}>({loadErr})</span>
              </p>
            ) : kpis ? (
              <p style={{ marginTop: 12, fontSize: 12, color: "#71717a" }}>
                Amostra: ~{kpis.n} dias úteis. Gráfico abaixo: evolução indexada (base 100).
              </p>
            ) : null}
          </section>

          <section
            style={{
              background: "rgba(30,58,138,0.2)",
              border: "1px solid rgba(45,212,191,0.2)",
              borderRadius: 20,
              padding: "22px 22px 26px",
              marginBottom: 40,
            }}
          >
            <h2 style={{ margin: "0 0 8px", fontSize: 22, fontWeight: 900 }}>Evolução do modelo vs mercado</h2>
            <p
              style={{
                margin: "0 0 18px",
                fontSize: 15,
                color: "#a1a1aa",
                lineHeight: 1.55,
                maxWidth: 720,
              }}
            >
              Evolução clara ao longo do tempo, com risco alinhado ao mercado de referência.
            </p>
            {chartData.length > 0 ? (
              <LandingChart data={chartData} />
            ) : (
              <div style={{ padding: 40, textAlign: "center", color: "#71717a", fontSize: 14 }}>
                {loading ? "A carregar gráfico…" : "Gráfico indisponível sem dados do motor."}
              </div>
            )}
          </section>

          <section
            style={{
              textAlign: "center",
              padding: "40px 24px",
              borderRadius: 20,
              background: "linear-gradient(145deg, rgba(22,163,74,0.22) 0%, rgba(30,58,138,0.45) 45%, rgba(15,23,42,0.95) 100%)",
              border: "1px solid rgba(45,212,191,0.4)",
            }}
          >
            <h2 style={{ margin: "0 0 14px", fontSize: "clamp(1.35rem, 3.5vw, 1.75rem)", fontWeight: 900, color: "#fff" }}>
              Começar é simples
            </h2>
            <p style={{ margin: "0 auto 26px", maxWidth: 520, fontSize: 16, color: "var(--text-primary)", lineHeight: 1.65 }}>
              Crie a sua conta e comece a receber decisões claras, com total controlo — da verificação à corretora.
            </p>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
              <p style={{ margin: 0, fontSize: 13, color: "#d4d4d8", fontWeight: 600, lineHeight: 1.45, textAlign: "center" }}>
                Investimento mínimo{" "}
                <strong style={{ color: "var(--text-primary)" }}>{DECIDE_MIN_INVEST_EUR.toLocaleString("pt-PT")} €</strong>.
              </p>
              <div style={{ display: "flex", gap: 14, justifyContent: "center", flexWrap: "wrap", alignItems: "center" }}>
                <Link
                  href={registerWithExampleHref}
                  style={{
                    display: "inline-block",
                    background: "linear-gradient(180deg, #fdba74 0%, #f97316 45%, #ea580c 100%)",
                    color: "#1c1917",
                    fontWeight: 900,
                    fontSize: 17,
                    padding: "16px 36px",
                    borderRadius: 16,
                    textDecoration: "none",
                    boxShadow:
                      "0 0 0 1px rgba(251,146,60,0.45), 0 0 32px rgba(249,115,22,0.55), 0 18px 48px rgba(234,88,12,0.5)",
                    border: "1px solid rgba(255,237,213,0.55)",
                    minWidth: 220,
                  }}
                >
                  Começar com este valor
                </Link>
              </div>
              <p style={{ margin: 0, fontSize: 12, color: "#a1a1aa", fontWeight: 600 }}>
                Pode começar em poucos minutos.
              </p>
              <p style={{ margin: 0, fontSize: 12, color: "#a1a1aa", fontWeight: 600 }}>
                Comece hoje — decide sempre.
              </p>
            </div>
          </section>

          <footer style={{ marginTop: 48, paddingTop: 24, borderTop: "1px solid rgba(255,255,255,0.08)", fontSize: 12, color: "#71717a" }}>
            <p style={{ margin: 0, lineHeight: 1.6 }}>
              DECIDE — informação meramente indicativa. Investimentos envolvem risco de perda. Leia a documentação
              contratual e regulamentar antes de subscrever qualquer serviço.
            </p>
          </footer>
        </main>
      </div>
    </>
  );
}
