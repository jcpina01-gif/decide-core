import type { GetServerSideProps } from "next";
import Head from "next/head";
import Link from "next/link";
import { useEffect, useLayoutEffect, useMemo, useState } from "react";
import ClientFlowDashboardButton from "../../components/ClientFlowDashboardButton";
import path from "path";
import fs from "fs";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";

type SeriesPoint = {
  date: string;
  benchmark: number;
  raw: number;
  overlayed: number;
};

type ActualPosition = {
  ticker: string;
  qty: number;
  marketPrice: number;
  /** null quando não há preço de fecho (JSON de GSSP não aceita undefined). */
  closePrice: number | null;
  value: number;
  weightPct: number;
  currency: string;
};

type RecommendedPosition = {
  ticker: string;
  nameShort: string;
  region: string;
  sector: string;
  score: number;
  weightPct: number;
  originalWeightPct: number;
  excluded: boolean;
};

type ProposedTrade = {
  ticker: string;
  side: string;
  absQty: number;
  marketPrice: number;
  closePrice: number | null;
  deltaValueEst: number;
  targetWeightPct: number;
  nameShort: string;
};

type ReportData = {
  generatedAt: string;
  accountCode: string;
  profile: string;
  modelDisplayName: string;
  navEur: number;
  cashEur: number;
  currentValueEur: number;
  totalReturnPct: number;
  benchmarkTotalReturnPct: number;
  outperformancePct: number;
  cagrPct: number;
  benchmarkCagrPct: number;
  sharpe: number;
  benchmarkSharpe: number;
  volatilityPct: number;
  benchmarkVolatilityPct: number;
  maxDrawdownPct: number;
  benchmarkMaxDrawdownPct: number;
  /** Subtítulo nos KPIs (ex.: horizonte de 10 anos). */
  displayHorizonLabel: string;
  displayCagrLabel: string;
  planSummary: {
    strategyLabel: string;
    riskLabel: string;
    positionCount: number;
    turnoverPct: number;
    buyCount: number;
    sellCount: number;
  };
  excludedTickersApplied: string[];
  exclusionCandidates: Array<{ ticker: string; nameShort: string }>;
  tbillsProxyWeightPct: number;
  proposedTradesCoverageNote: string;
  backendError: string;
  closeAsOfDate: string;
  actualPositions: ActualPosition[];
  recommendedPositions: RecommendedPosition[];
  proposedTrades: ProposedTrade[];
  series: SeriesPoint[];
  feeSegment: "A" | "B";
  monthlyFixedFeeEur: number;
  annualManagementFeePct: number;
  estimatedAnnualManagementFeeEur: number;
  estimatedMonthlyManagementFeeEur: number;
  estimatedPerformanceFeeEur: number;
};

type PageProps = {
  reportData: ReportData;
};

function safeNumber(x: unknown, fallback = 0): number {
  const v = typeof x === "number" ? x : Number(x);
  return Number.isFinite(v) ? v : fallback;
}

function safeString(x: unknown, fallback = ""): string {
  return typeof x === "string" ? x : fallback;
}

function formatEuro(v: number): string {
  return new Intl.NumberFormat("pt-PT", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(v);
}

function formatMoneyCompact(v: number, currency: string): string {
  const c = typeof currency === "string" && currency.length === 3 ? currency.toUpperCase() : "USD";
  try {
    return new Intl.NumberFormat("pt-PT", {
      style: "currency",
      currency: c,
      maximumFractionDigits: 0,
    }).format(v);
  } catch {
    return `${v.toFixed(0)} ${c}`;
  }
}

/** Avg fill from IBKR US equities — report in USD. */
function formatUsdPrice(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v) || v <= 0) {
    return "—";
  }
  return new Intl.NumberFormat("pt-PT", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(v);
}

function formatPct(v: number, digits = 2): string {
  return `${v.toFixed(digits)}%`;
}

function formatQty(v: number): string {
  return new Intl.NumberFormat("pt-PT", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(v);
}

/** Quantidade ainda por enviar / completar (pedido − preenchido). */
function remainingOrderQty(f: { requested_qty?: number; filled?: number }): number {
  const req = Math.floor(Number(f.requested_qty ?? 0));
  const done = Math.floor(Number(f.filled ?? 0));
  return Math.max(0, req - done);
}

/** Rótulos para o cliente (evita jargão IBKR tipo «Submitted»). */
function execStatusDisplay(f: {
  status?: string;
  requested_qty?: number;
  filled?: number;
}): string {
  const st = String(f.status ?? "").toLowerCase();
  const req = Number(f.requested_qty ?? 0);
  const fill = Number(f.filled ?? 0);
  if (st.includes("cancel")) return "Cancelada";
  if (
    st.includes("not_qualified") ||
    st.includes("qualify_error") ||
    st.includes("place_error") ||
    st.includes("reject") ||
    st.includes("error")
  ) {
    return "Falhada";
  }
  if (req > 0 && fill > 0 && fill < req) return "Parcial";
  if (st.includes("filled") && ((req > 0 && fill >= req) || (req <= 0 && fill > 0))) {
    return "Executada";
  }
  if (st.includes("submitted") || st.includes("presubmitted") || st.includes("pending")) {
    return "Em curso";
  }
  if (st.includes("filled")) return "Executada";
  return f.status ? String(f.status) : "—";
}

/** Ordem com quantidade em falta e elegível para nova submissão (ex.: mercado fechado, parcial). */
function fillEligibleForCompletionRetry(f: { status?: string; requested_qty?: number; filled?: number }): boolean {
  if (remainingOrderQty(f) <= 0) return false;
  const st = String(f.status ?? "").toLowerCase();
  if (st.includes("cancel") || st.includes("inactive")) return false;
  return true;
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];

    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (ch === "," && !inQuotes) {
      out.push(cur);
      cur = "";
      continue;
    }

    cur += ch;
  }

  out.push(cur);
  return out;
}

function parseCsv(text: string): Record<string, string>[] {
  const lines = text
    .replace(/\r/g, "")
    .split("\n")
    .filter((x) => x.trim().length > 0);

  if (lines.length === 0) return [];

  const headers = splitCsvLine(lines[0]).map((h) => h.trim());
  const rows: Record<string, string>[] = [];

  for (let i = 1; i < lines.length; i += 1) {
    const cols = splitCsvLine(lines[i]);
    const row: Record<string, string> = {};
    for (let j = 0; j < headers.length; j += 1) {
      row[headers[j]] = cols[j] ?? "";
    }
    rows.push(row);
  }

  return rows;
}

function readJsonIfExists<T>(filePath: string): T | null {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8")) as T;
  } catch {
    return null;
  }
}

function readCsvIfExists(filePath: string): Record<string, string>[] {
  if (!fs.existsSync(filePath)) return [];
  try {
    return parseCsv(fs.readFileSync(filePath, "utf-8"));
  } catch {
    return [];
  }
}

function buildBackendRunModelUrl(profile: string, excludedTickers: string[] = []): string {
  const baseRaw =
    process.env.DECIDE_BACKEND_URL ||
    process.env.NEXT_PUBLIC_DECIDE_BACKEND_URL ||
    process.env.BACKEND_URL ||
    process.env.NEXT_PUBLIC_BACKEND_URL ||
    "http://127.0.0.1:8090";
  let base = String(baseRaw || "").trim().replace(/\/+$/, "");
  if (/\/api$/i.test(base)) base = base.replace(/\/api$/i, "");
  if (!base) base = "http://127.0.0.1:8090";
  const url = new URL(base);
  url.pathname = (url.pathname.replace(/\/+$/, "") + "/api/run-model").replace(/\/{2,}/g, "/");
  url.searchParams.set("profile", profile);
  if (excludedTickers.length > 0) {
    url.searchParams.set("exclude_tickers", excludedTickers.join(","));
  }
  return url.toString();
}

async function loadBackendModel(profile = "moderado", excludedTickers: string[] = []): Promise<{
  payload: any | null;
  error: string;
}> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 12_000);
    const r = await fetch(buildBackendRunModelUrl(profile, excludedTickers), {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: ctrl.signal,
    });
    clearTimeout(t);

    if (!r.ok) {
      return {
        payload: null,
        error: `Backend respondeu ${r.status}`,
      };
    }

    const payload = await r.json();
    return { payload, error: "" };
  } catch (e) {
    return {
      payload: null,
      error: e instanceof Error ? e.message : "Falha a ligar ao backend",
    };
  }
}

function hasUsableModelPayload(payload: any): boolean {
  if (!payload || typeof payload !== "object") return false;
  const positions = payload?.current_portfolio?.positions;
  const dates = payload?.series?.dates;
  const hasPositions = Array.isArray(positions) && positions.length > 0;
  const hasSeries = Array.isArray(dates) && dates.length >= 50;
  return hasPositions && hasSeries;
}

function dailyReturnsFromEquity(equity: number[]): number[] {
  const r: number[] = [];
  for (let i = 1; i < equity.length; i += 1) {
    const prev = equity[i - 1];
    if (prev > 0) r.push(equity[i] / prev - 1);
  }
  return r;
}

function annualizedVolFromDailyReturns(rets: number[]): number {
  if (rets.length < 2) return 0;
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  let s2 = 0;
  for (const x of rets) s2 += (x - mean) ** 2;
  const sd = Math.sqrt(s2 / (rets.length - 1));
  return sd * Math.sqrt(252);
}

function sharpeFromDailyReturns(rets: number[]): number {
  if (rets.length < 2) return 0;
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  let s2 = 0;
  for (const x of rets) s2 += (x - mean) ** 2;
  const sd = Math.sqrt(s2 / (rets.length - 1));
  if (sd <= 0) return 0;
  return (mean / sd) * Math.sqrt(252);
}

function maxDrawdownFraction(equity: number[]): number {
  if (equity.length === 0) return 0;
  let peak = equity[0] || 1;
  let maxDd = 0;
  for (const x of equity) {
    if (x > peak) peak = x;
    if (peak > 0) {
      const dd = (peak - x) / peak;
      if (dd > maxDd) maxDd = dd;
    }
  }
  return maxDd;
}

function totalReturnFraction(equity: number[]): number {
  if (equity.length < 2) return 0;
  const a = equity[0];
  const b = equity[equity.length - 1];
  if (!(a > 0) || !(b > 0)) return 0;
  return b / a - 1;
}

/** Horizonte mostrado ao cliente (evita % cumulativos de 20y que parecem “bug”). */
const DISPLAY_HORIZON_YEARS = 10;
const DISPLAY_CAGR_YEARS = 20;
const PCT_DISPLAY_CAP = 400;

function parseDateYmd(s: string): number {
  const t = Date.parse(String(s).slice(0, 10));
  return Number.isFinite(t) ? t : NaN;
}

function findHorizonStartIdx(dates: string[], n: number, years: number): number {
  if (n < 2) return 0;
  const last = parseDateYmd(String(dates[n - 1]));
  if (!Number.isFinite(last)) return 0;
  const cutoff = last - years * 365.25 * 24 * 3600 * 1000;
  for (let i = 0; i < n; i += 1) {
    const t = parseDateYmd(String(dates[i]));
    if (Number.isFinite(t) && t >= cutoff) return i;
  }
  return Math.max(0, n - Math.floor(252 * Math.min(years, 30)));
}

function yearsSpanBetween(dates: string[], startIdx: number, endIdx: number): number {
  const a = parseDateYmd(String(dates[startIdx]));
  const b = parseDateYmd(String(dates[endIdx]));
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return 0;
  return (b - a) / (365.25 * 24 * 3600 * 1000);
}

function capPctDisplay(p: number): number {
  if (!Number.isFinite(p)) return 0;
  return Math.max(-PCT_DISPLAY_CAP, Math.min(PCT_DISPLAY_CAP, p));
}

function cagrPctFromEquityWindow(equity: number[], years: number): number {
  if (equity.length < 2 || !(years > 0.08)) return 0;
  const a = equity[0];
  const b = equity[equity.length - 1];
  if (!(a > 0) || !(b > 0)) return 0;
  return (Math.pow(b / a, 1 / years) - 1) * 100;
}

function profileRiskLabel(profile: string): string {
  const p = profile.trim().toLowerCase();
  if (p.includes("conserv")) return "Conservador";
  if (p.includes("agress")) return "Agressivo";
  if (p.includes("moder")) return "Moderado";
  const t = profile.trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : "Moderado";
}

function exclusionTickerGroup(ticker: string): string {
  const t = ticker.trim().toUpperCase().replace(/\./g, "-");
  // Dual-class aliases that should appear only once in exclusion lists.
  if (t === "GOOG" || t === "GOOGL") return "GOOG";
  return t;
}

function normalizeTickerKey(ticker: string): string {
  return ticker.trim().toUpperCase().replace(/\./g, "-");
}

function pickBestDisplayName(ticker: string, candidate: string, fallback: string): string {
  const t = normalizeTickerKey(ticker);
  const c = safeString(candidate, "").trim();
  const f = safeString(fallback, "").trim();
  const isWeak = (v: string) => {
    if (!v) return true;
    const n = normalizeTickerKey(v);
    return n === t || n === exclusionTickerGroup(t);
  };
  if (!isWeak(c)) return c;
  if (!isWeak(f)) return f;
  return c || f || ticker;
}

/**
 * Quando o motor em 8090 está offline, usa o snapshot em
 * freeze/DECIDE_MODEL_V5_OVERLAY_CAP15_MAX100EXP/model_outputs/.
 */
function loadFreezeRunModelSnapshot(projectRoot: string): any | null {
  const dir = path.join(
    projectRoot,
    "freeze",
    "DECIDE_MODEL_V5_OVERLAY_CAP15_MAX100EXP",
    "model_outputs"
  );
  const pfPath = path.join(dir, "portfolio_final.json");
  const benchPath = path.join(dir, "benchmark_equity_final_20y.csv");
  const modelPathModerado = path.join(dir, "model_equity_final_20y_moderado.csv");
  const modelPathBase = path.join(dir, "model_equity_final_20y.csv");
  const modelPath = fs.existsSync(modelPathModerado) ? modelPathModerado : modelPathBase;
  const overlayPath = path.join(dir, "equity_overlayed.json");
  const kpisPath = path.join(dir, "v5_kpis.json");

  if (!fs.existsSync(pfPath) || !fs.existsSync(benchPath) || !fs.existsSync(modelPath)) {
    return null;
  }

  const pf = readJsonIfExists<{ holdings?: unknown[] }>(pfPath);
  const kpisMeta = readJsonIfExists<Record<string, unknown>>(kpisPath);
  const benchRows = readCsvIfExists(benchPath);
  const modelRows = readCsvIfExists(modelPath);

  let overlayed: number[] = [];
  if (fs.existsSync(overlayPath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(overlayPath, "utf8")) as unknown;
      if (Array.isArray(raw)) overlayed = raw.map((x) => safeNumber(Number(x), 0));
    } catch {
      overlayed = [];
    }
  }

  const nRaw = Math.min(benchRows.length, modelRows.length);
  const n = overlayed.length > 0 ? Math.min(nRaw, overlayed.length) : nRaw;
  const holdings = Array.isArray(pf?.holdings) ? pf!.holdings! : [];

  if (n < 50 || holdings.length === 0) return null;

  const dates: string[] = [];
  const benchmark_equity: number[] = [];
  const equity_raw: number[] = [];
  const equity_overlayed: number[] = [];

  for (let i = 0; i < n; i += 1) {
    const b = benchRows[i];
    const m = modelRows[i];
    const dRaw = String(b?.date ?? m?.date ?? "").trim();
    dates.push(dRaw.length >= 10 ? dRaw.slice(0, 10) : dRaw);
    benchmark_equity.push(safeNumber(Number(b?.benchmark_equity), 0));
    const rawEq = safeNumber(Number(m?.model_equity), 0);
    equity_raw.push(rawEq);
    equity_overlayed.push(
      overlayed.length > i ? safeNumber(overlayed[i], rawEq) : rawEq
    );
  }

  const positions = holdings.map((h: any) => ({
    ticker: safeString(h?.ticker, "").toUpperCase(),
    name_short: safeString(h?.company ?? h?.ticker, h?.ticker),
    region: safeString(h?.zone || h?.country, ""),
    sector: safeString(h?.sector, ""),
    score: safeNumber(h?.score, 0),
    weight_pct: safeNumber(h?.weight_pct, 0),
  }));

  const ovr = equity_overlayed;
  const bench = benchmark_equity;
  const rawEq = equity_raw;

  const retsO = dailyReturnsFromEquity(ovr);
  const retsB = dailyReturnsFromEquity(bench);

  const kpis = {
    total_return: totalReturnFraction(ovr),
    cagr: safeNumber(Number(kpisMeta?.overlayed_cagr), 0),
    sharpe:
      typeof kpisMeta?.overlayed_sharpe === "number"
        ? (kpisMeta.overlayed_sharpe as number)
        : sharpeFromDailyReturns(retsO),
    vol: annualizedVolFromDailyReturns(retsO),
    max_drawdown: maxDrawdownFraction(ovr),
    latest_cash_sleeve: safeNumber(Number(kpisMeta?.latest_cash_sleeve), 0),
  };

  const benchmark_kpis = {
    total_return: totalReturnFraction(bench),
    cagr: safeNumber(Number(kpisMeta?.benchmark_cagr), 0),
    sharpe: sharpeFromDailyReturns(retsB),
    vol: annualizedVolFromDailyReturns(retsB),
    max_drawdown: maxDrawdownFraction(bench),
  };

  return {
    meta: {
      profile: safeString(kpisMeta?.profile, "moderado"),
      data_source: "freeze_local_fallback_cap15_exp100",
      model_name: "DECIDE_MODEL_V5_OVERLAY_CAP15_MAX100EXP",
      latest_cash_sleeve: safeNumber(Number(kpisMeta?.latest_cash_sleeve), 0),
      freeze_dir: dir,
    },
    current_portfolio: { positions },
    series: {
      dates,
      benchmark_equity,
      equity_raw,
      equity_overlayed,
    },
    kpis,
    benchmark_kpis,
  };
}

export const getServerSideProps: GetServerSideProps<PageProps> = async (ctx) => {
  const frontRoot = process.cwd();
  const projectRoot = path.resolve(frontRoot, "..");
  const tmpDir = path.join(projectRoot, "tmp_diag");

  const smokePath = path.join(tmpDir, "ibkr_paper_smoke_test.json");
  const statusPath = path.join(tmpDir, "ibkr_order_status_and_cancel.json");
  const tradePlanPath = path.join(tmpDir, "decide_trade_plan_ibkr.csv");
  const companyMetaPath = path.join(projectRoot, "backend", "data", "company_meta_combined.csv");
  const companyMetaV3Path = path.join(projectRoot, "backend", "data", "company_meta_v3.csv");
  const companyMetaGlobalPath = path.join(projectRoot, "backend", "data", "company_meta_global.csv");

  const smokeJson = readJsonIfExists<any>(smokePath);
  const statusJson = readJsonIfExists<any>(statusPath);
  const tradePlanRows = readCsvIfExists(tradePlanPath);
  const companyMetaRows = readCsvIfExists(companyMetaPath);
  const companyMetaV3Rows = readCsvIfExists(companyMetaV3Path);
  const companyMetaGlobalRows = readCsvIfExists(companyMetaGlobalPath);

  const metaByTicker = new Map<
    string,
    { sector: string; region: string; nameShort: string }
  >();
  const upsertMeta = (row: Record<string, string>) => {
    const tRaw = safeString(row.ticker || row.symbol).toUpperCase();
    const t = normalizeTickerKey(tRaw);
    if (!t) return;
    const curr = metaByTicker.get(t) || { sector: "", region: "", nameShort: "" };
    const next = {
      sector: safeString(row.sector || row.gics_sector || row.sector_name, curr.sector),
      region: safeString(row.region || row.zone || row.country_group, curr.region),
      nameShort: safeString(row.name_short || row.name || row.company, curr.nameShort),
    };
    metaByTicker.set(t, next);
    // Also index the dot/dash variant to avoid lookup misses (e.g. BRK.B vs BRK-B).
    const alt = t.includes("-") ? t.replace(/-/g, ".") : t.replace(/\./g, "-");
    if (alt && alt !== t) metaByTicker.set(alt, next);
  };
  for (const row of companyMetaGlobalRows) upsertMeta(row);
  for (const row of companyMetaV3Rows) upsertMeta(row);
  for (const row of companyMetaRows) upsertMeta(row);

  const metaForTicker = (ticker: string) => {
    const k = normalizeTickerKey(ticker);
    const direct = metaByTicker.get(k);
    if (direct) return direct;
    const alt = k.includes("-") ? k.replace(/-/g, ".") : k.replace(/\./g, "-");
    if (alt) return metaByTicker.get(alt);
    return undefined;
  };

  // "Last close" prices (for the "Preço" column). We only read the header + last line.
  const pricesClosePath = path.join(projectRoot, "backend", "data", "prices_close.csv");
  let closeAsOfDate = "";
  const closePricesByTicker = new Map<string, number>();

  function normalizeTickerForCloseCsv(ticker: string) {
    const s = ticker.trim().toUpperCase().replace(/\s+/g, "");
    // Attempt common IB->CSV normalization (e.g. BRK.B -> BRK-B).
    return s.replace(/\./g, "-");
  }

  function getClosePrice(ticker: string): number {
    const t = ticker.trim().toUpperCase();
    const candidates = [
      t,
      normalizeTickerForCloseCsv(t),
      // If CSV uses '.' instead of '-'
      t.replace(/-/g, "."),
    ];
    for (const c of candidates) {
      const v = closePricesByTicker.get(c);
      if (typeof v === "number" && Number.isFinite(v) && v > 0) return v;
    }
    return 0;
  }

  try {
    if (fs.existsSync(pricesClosePath)) {
      const textRaw = fs.readFileSync(pricesClosePath, "utf-8");
      const text = textRaw.replace(/^\uFEFF/, ""); // BOM safety

      const firstNl = text.indexOf("\n");
      const lastNl = text.lastIndexOf("\n");
      const prevNl = text.lastIndexOf("\n", lastNl - 1);

      if (firstNl > 0 && lastNl > 0 && prevNl > 0) {
        const headerLine = text.slice(0, firstNl).replace(/\r/g, "").trim();
        const lastLine = text.slice(prevNl + 1, lastNl).replace(/\r/g, "").trim();

        const headers = splitCsvLine(headerLine).map((h) => h.trim());
        const values = splitCsvLine(lastLine);

        const dateIdx = headers.findIndex((h) => h.toLowerCase() === "date");
        const dateVal = dateIdx >= 0 ? values[dateIdx] : values[0];
        closeAsOfDate = String(dateVal || "").slice(0, 10);

        for (let i = 0; i < headers.length; i += 1) {
          const col = headers[i];
          if (!col || col.toLowerCase() === "date") continue;
          const raw = values[i];
          const num = Number(raw);
          if (Number.isFinite(num) && num > 0) {
            closePricesByTicker.set(col.toUpperCase(), num);
          }
        }
      }
    }
  } catch {
    // If close CSV fails to parse, keep closeAsOfDate empty and close prices as 0.
  }

  const clearExclusions =
    safeString(ctx.query.clear, "") === "1" ||
    safeString(ctx.query.clear, "").toLowerCase() === "true";
  const rawExclude = clearExclusions ? "" : ctx.query.exclude;
  const excludeTokens = Array.isArray(rawExclude)
    ? rawExclude.join(",")
    : safeString(rawExclude, "");
  const excludedTickersApplied = Array.from(
    new Set(
      excludeTokens
        .split(",")
        .map((x) => x.trim().toUpperCase())
        .filter((x) => /^[A-Z0-9.\-]{1,16}$/.test(x))
    )
  ).slice(0, 5);

  let { payload: modelPayload, error: backendError } = await loadBackendModel(
    "moderado",
    excludedTickersApplied
  );
  if (!hasUsableModelPayload(modelPayload)) {
    const snap = loadFreezeRunModelSnapshot(projectRoot);
    if (snap) {
      modelPayload = snap;
      backendError = "";
    } else if (!backendError) {
      backendError = "Dados do backend incompletos (sem carteira/série).";
    }
  }

  const navEur = safeNumber(
    smokeJson?.selected?.netLiquidation?.value ??
      smokeJson?.attempts?.[0]?.netLiquidation?.value,
    0
  );

  const cashEur = safeNumber(
    smokeJson?.selected?.cash?.value ?? smokeJson?.attempts?.[0]?.cash?.value,
    0
  );

  const accountCode = safeString(
    smokeJson?.selected?.accountCode ??
      smokeJson?.attempts?.[0]?.accountCode,
    ""
  );

  const tradePlanByTicker = new Map<string, Record<string, string>>();
  for (const row of tradePlanRows) {
    const ticker = safeString(row.ticker).toUpperCase();
    if (ticker) tradePlanByTicker.set(ticker, row);
  }

  const rawPositions = Array.isArray(statusJson?.positions)
    ? statusJson.positions
    : Array.isArray(smokeJson?.selected?.positions)
    ? smokeJson.selected.positions
    : [];

  const actualPositions: ActualPosition[] = rawPositions.map((p: any) => {
    const ticker = safeString(p.ticker ?? p.symbol).toUpperCase();
    const qty = safeNumber(p.position ?? p.qty, 0);
    const tradePlanRow = tradePlanByTicker.get(ticker);
    const marketPrice = safeNumber(tradePlanRow?.market_price, 0);
    const value = qty * marketPrice;
    const weightPct = navEur > 0 ? (value / navEur) * 100 : 0;
    const closePrice = getClosePrice(ticker);

    return {
      ticker,
      qty,
      marketPrice,
      closePrice: closePrice > 0 ? closePrice : null,
      value,
      weightPct,
      currency: safeString(p.currency, safeString(tradePlanRow?.currency, "USD")),
    };
  });

  actualPositions.sort((a, b) => b.value - a.value);

  const cashSleeveFracRaw = safeNumber(
    modelPayload?.kpis?.latest_cash_sleeve ??
      modelPayload?.meta?.latest_cash_sleeve ??
      modelPayload?.summary?.latest_cash_sleeve,
    0
  );
  const cashSleeveFrac =
    cashSleeveFracRaw >= 0 && cashSleeveFracRaw <= 0.95 ? cashSleeveFracRaw : 0;
  const investedFrac = 1 - cashSleeveFrac;

  const recommendedRaw: RecommendedPosition[] = Array.isArray(
    modelPayload?.current_portfolio?.positions
  )
    ? modelPayload.current_portfolio.positions.map((p: any) => ({
        ticker: (() => {
          const t = safeString(p.ticker).toUpperCase();
          return t;
        })(),
        nameShort: (() => {
          const t = safeString(p.ticker).toUpperCase();
          const m = metaForTicker(t);
          return pickBestDisplayName(
            t,
            safeString(p.name_short || p.short_name || p.ticker),
            safeString(m?.nameShort, "")
          );
        })(),
        region: (() => {
          const t = safeString(p.ticker).toUpperCase();
          const m = metaForTicker(t);
          return safeString(p.region || m?.region, "");
        })(),
        sector: (() => {
          const t = safeString(p.ticker).toUpperCase();
          const m = metaForTicker(t);
          return safeString(p.sector || m?.sector, "");
        })(),
        score: safeNumber(p.score, 0),
        weightPct: safeNumber(p.weight_pct, 0) * investedFrac,
        originalWeightPct: safeNumber(p.weight_pct, 0) * investedFrac,
        excluded: false,
      }))
    : [];

  // Remover duplicados exatos por ticker (mantém o maior peso).
  const dedupByTicker = new Map<string, RecommendedPosition>();
  for (const p of recommendedRaw) {
    const k = exclusionTickerGroup(normalizeTickerKey(p.ticker));
    const prev = dedupByTicker.get(k);
    if (!prev || safeNumber(p.weightPct, 0) > safeNumber(prev.weightPct, 0)) {
      dedupByTicker.set(k, { ...p, ticker: k });
    }
  }
  const recommendedRawUnique = Array.from(dedupByTicker.values());

  // Lista de exclusão sem "títulos" duplicados (ex.: GOOG/GOOGL -> 1 entrada).
  const exclusionByTitle = new Map<string, { ticker: string; nameShort: string; weightPct: number }>();
  for (const p of recommendedRawUnique) {
    if (!p.ticker || p.ticker === "TBILL_PROXY") continue;
    const grp = exclusionTickerGroup(p.ticker);
    const dedupeKey = grp;
    const prev = exclusionByTitle.get(dedupeKey);
    if (!prev || safeNumber(p.weightPct, 0) > safeNumber(prev.weightPct, 0)) {
      exclusionByTitle.set(dedupeKey, {
        ticker: p.ticker,
        nameShort: p.nameShort || p.ticker,
        weightPct: safeNumber(p.weightPct, 0),
      });
    }
  }
  const exclusionCandidates = Array.from(exclusionByTitle.values())
    .sort((a, b) => b.weightPct - a.weightPct)
    .map((x) => ({ ticker: x.ticker, nameShort: x.nameShort }));

  const recommendedPositions: RecommendedPosition[] = recommendedRawUnique.map((p) => ({
    ...p,
    excluded: excludedTickersApplied.includes(p.ticker),
  }));

  const recommendedWeightSumPct = recommendedPositions.reduce(
    (acc, p) => acc + safeNumber(p.weightPct, 0),
    0
  );
  const modelCashSleevePct = cashSleeveFrac * 100;
  const tbillsProxyWeightPct =
    modelCashSleevePct > 0 ? modelCashSleevePct : Math.max(0, 100 - recommendedWeightSumPct);
  const tbillIdx = recommendedPositions.findIndex((p) => p.ticker === "TBILL_PROXY");
  if (tbillIdx >= 0) {
    recommendedPositions[tbillIdx].nameShort = "T-Bills / Cash Sleeve";
    recommendedPositions[tbillIdx].sector = "Cash & T-Bills";
    recommendedPositions[tbillIdx].region = recommendedPositions[tbillIdx].region || "US";
    recommendedPositions[tbillIdx].weightPct = safeNumber(
      recommendedPositions[tbillIdx].weightPct,
      0
    );
  } else {
    recommendedPositions.push({
      ticker: "TBILL_PROXY",
      nameShort: "T-Bills / Cash Sleeve",
      region: "US",
      sector: "Cash & T-Bills",
      score: 0,
      weightPct: tbillsProxyWeightPct,
      originalWeightPct: tbillsProxyWeightPct,
      excluded: false,
    });
  }

  // Reescalar proporcionalmente os títulos aprovados (não excluídos), mantendo excluídos visíveis mas a 0%.
  const nonTb = recommendedPositions.filter((p) => p.ticker !== "TBILL_PROXY");
  const totalNonTbPct = nonTb.reduce((acc, p) => acc + safeNumber(p.weightPct, 0), 0);
  const approvedNonTb = nonTb.filter((p) => !p.excluded);
  const approvedNonTbPct = approvedNonTb.reduce((acc, p) => acc + safeNumber(p.weightPct, 0), 0);
  const tbillPos = recommendedPositions.find((p) => p.ticker === "TBILL_PROXY");

  if (approvedNonTbPct > 0 && totalNonTbPct > 0) {
    const scale = totalNonTbPct / approvedNonTbPct;
    for (const p of recommendedPositions) {
      if (p.ticker === "TBILL_PROXY") continue;
      if (p.excluded) {
        p.weightPct = 0;
      } else {
        p.weightPct = p.weightPct * scale;
      }
    }
  } else if (tbillPos) {
    // Se excluiu tudo, o sleeve vai para T-Bills/Cash.
    for (const p of recommendedPositions) {
      if (p.ticker !== "TBILL_PROXY") p.weightPct = 0;
    }
    tbillPos.weightPct += totalNonTbPct;
  }

  recommendedPositions.sort((a, b) => b.weightPct - a.weightPct);

  const proposedTrades: ProposedTrade[] = tradePlanRows
    .filter((r) => {
      const side = safeString(r.side).toUpperCase();
      return side === "BUY" || side === "SELL";
    })
    .map((r) => ({
      ticker: safeString(r.ticker).toUpperCase(),
      side: safeString(r.side).toUpperCase(),
      absQty: safeNumber(r.abs_qty, 0),
      marketPrice: safeNumber(r.market_price, 0),
      closePrice: null as number | null,
      deltaValueEst: safeNumber(r.delta_value_est, 0),
      targetWeightPct: safeNumber(r.weight_pct, 0),
      nameShort: (() => {
        const t = safeString(r.ticker).toUpperCase();
        const m = metaForTicker(t);
        return pickBestDisplayName(
          t,
          safeString(r.name_short || r.name || r.ticker),
          safeString(m?.nameShort, "")
        );
      })(),
    }));

  for (const t of proposedTrades) {
    const cp = getClosePrice(t.ticker);
    if (cp > 0) t.closePrice = cp;
  }

  const targetWeightByTicker = new Map<string, number>(
    recommendedPositions.map((p) => [p.ticker, safeNumber(p.weightPct, 0)])
  );
  for (const t of proposedTrades) {
    t.targetWeightPct = safeNumber(targetWeightByTicker.get(t.ticker), 0);
  }
  // BUY sem peso-alvo:
  // - se foi excluído pelo cliente, manter visível como INATIVO;
  // - caso contrário, remover (stale rows do CSV antigo).
  for (let i = proposedTrades.length - 1; i >= 0; i -= 1) {
    const t = proposedTrades[i];
    if (t.side === "BUY" && t.targetWeightPct <= 0) {
      if (excludedTickersApplied.includes(t.ticker)) {
        t.side = "INACTIVE";
        t.absQty = 0;
        t.deltaValueEst = 0;
      } else {
        proposedTrades.splice(i, 1);
      }
    }
  }

  const proposedByTicker = new Set(
    proposedTrades.map((t) => exclusionTickerGroup(normalizeTickerKey(t.ticker)))
  );
  for (const r of recommendedPositions) {
    if (
      r.ticker === "TBILL_PROXY" ||
      safeNumber(r.weightPct, 0) <= 0 ||
      proposedByTicker.has(exclusionTickerGroup(normalizeTickerKey(r.ticker)))
    ) {
      continue;
    }
    proposedTrades.push({
      ticker: r.ticker,
      side: "BUY",
      absQty: 0,
      marketPrice: 0,
      closePrice: (() => {
        const cp = getClosePrice(r.ticker);
        return cp > 0 ? cp : null;
      })(),
      deltaValueEst: navEur > 0 ? (r.weightPct / 100) * navEur : 0,
      targetWeightPct: r.weightPct,
      nameShort: r.nameShort || r.ticker,
    });
    proposedByTicker.add(exclusionTickerGroup(normalizeTickerKey(r.ticker)));
  }

  const recommendedTickersActive = new Set(
    recommendedPositions
      .filter((p) => p.ticker !== "TBILL_PROXY" && safeNumber(p.weightPct, 0) > 0)
      .map((p) => p.ticker)
  );
  for (const a of actualPositions) {
    if (
      recommendedTickersActive.has(a.ticker) ||
      proposedByTicker.has(exclusionTickerGroup(normalizeTickerKey(a.ticker)))
    ) {
      continue;
    }
    proposedTrades.push({
      ticker: a.ticker,
      side: "SELL",
      absQty: Math.abs(a.qty),
      marketPrice: a.marketPrice,
      closePrice: a.closePrice,
      deltaValueEst: a.value,
      targetWeightPct: 0,
      nameShort: a.ticker,
    });
    proposedByTicker.add(exclusionTickerGroup(normalizeTickerKey(a.ticker)));
  }

  // Garantir 1 linha INATIVO por ticker excluído (mesmo que não existisse BUY prévio).
  for (const ex of excludedTickersApplied) {
    const exKey = exclusionTickerGroup(normalizeTickerKey(ex));
    if (proposedByTicker.has(exKey)) {
      const row = proposedTrades.find((t) => t.ticker === ex);
      if (row) {
        row.side = "INACTIVE";
        row.targetWeightPct = 0;
        row.absQty = 0;
        row.deltaValueEst = 0;
      }
      continue;
    }

    const ref = recommendedPositions.find((p) => p.ticker === ex);
    if (!ref) continue;
    const cp = getClosePrice(ex);
    proposedTrades.push({
      ticker: ex,
      side: "INACTIVE",
      absQty: 0,
      marketPrice: cp > 0 ? cp : 0,
      closePrice: cp > 0 ? cp : null,
      deltaValueEst: 0,
      targetWeightPct: 0,
      nameShort: ref.nameShort || ex,
    });
    proposedByTicker.add(exKey);
  }

  // Sleeve T-Bills do modelo (TBILL_PROXY) → execução na corretora como BIL: garantir BUY com qtd > 0.
  // Preço: último close em prices_close; se falhar (célula vazia), usa fallback ~último NAV do ETF BIL.
  const FALLBACK_BIL_USD = 91.5;
  {
    const tbillW = tbillPos ? safeNumber(tbillPos.weightPct, 0) : 0;
    if (tbillW > 0 && navEur > 0) {
      const pxRaw = getClosePrice("BIL") || getClosePrice("TBILL_PROXY");
      const pxBil = pxRaw > 0 ? pxRaw : FALLBACK_BIL_USD;
      const notional = (tbillW / 100) * navEur;
      const q = Math.max(1, Math.floor(notional / pxBil));
      const existing = proposedTrades.find((t) => t.ticker === "TBILL_PROXY");
      if (existing) {
        if (existing.side === "INACTIVE") {
          /* reservado: TBILL não é excluível pelo cliente */
        } else {
          existing.side = "BUY";
          existing.absQty = Math.max(safeNumber(existing.absQty, 0), q);
          existing.marketPrice = pxBil;
          existing.closePrice = pxBil > 0 ? pxBil : null;
          existing.deltaValueEst = notional;
          existing.targetWeightPct = tbillW;
          if (!existing.nameShort || existing.nameShort.trim() === "") {
            existing.nameShort = "T-Bills / Cash Sleeve (BIL)";
          }
        }
      } else {
        proposedTrades.push({
          ticker: "TBILL_PROXY",
          side: "BUY",
          absQty: q,
          marketPrice: pxBil,
          closePrice: pxBil > 0 ? pxBil : null,
          deltaValueEst: notional,
          targetWeightPct: tbillW,
          nameShort: "T-Bills / Cash Sleeve (BIL)",
        });
      }
    }
  }

  proposedTrades.sort((a, b) => Math.abs(b.deltaValueEst) - Math.abs(a.deltaValueEst));

  const dates: string[] = Array.isArray(modelPayload?.series?.dates)
    ? modelPayload.series.dates
    : [];
  const benchmark: number[] = Array.isArray(modelPayload?.series?.benchmark_equity)
    ? modelPayload.series.benchmark_equity.map((x: unknown) => safeNumber(x, 0))
    : [];
  const raw: number[] = Array.isArray(modelPayload?.series?.equity_raw)
    ? modelPayload.series.equity_raw.map((x: unknown) => safeNumber(x, 0))
    : [];
  const overlayed: number[] = Array.isArray(modelPayload?.series?.equity_overlayed)
    ? modelPayload.series.equity_overlayed.map((x: unknown) => safeNumber(x, 0))
    : [];

  const n = Math.min(dates.length, benchmark.length, raw.length, overlayed.length);
  const hStart =
    n >= 50 ? findHorizonStartIdx(dates, n, DISPLAY_HORIZON_YEARS) : 0;
  const hStartCagr =
    n >= 50 ? findHorizonStartIdx(dates, n, DISPLAY_CAGR_YEARS) : 0;
  const ySpanCagr = n >= 2 ? yearsSpanBetween(dates, hStartCagr, n - 1) : 0;

  const benchW = benchmark.slice(hStart, n);
  const ovrW = overlayed.slice(hStart, n);
  const benchCagrW = benchmark.slice(hStartCagr, n);
  const ovrCagrW = overlayed.slice(hStartCagr, n);

  const cagrPct = capPctDisplay(cagrPctFromEquityWindow(ovrCagrW, ySpanCagr));
  const benchmarkCagrPct = capPctDisplay(
    cagrPctFromEquityWindow(benchCagrW, ySpanCagr)
  );
  const totalReturnPct = cagrPct;
  const benchmarkTotalReturnPct = benchmarkCagrPct;
  const outperformancePct = capPctDisplay(cagrPct - benchmarkCagrPct);

  const retsO = dailyReturnsFromEquity(ovrW);
  const retsB = dailyReturnsFromEquity(benchW);
  const sharpe = sharpeFromDailyReturns(retsO);
  const benchmarkSharpe = sharpeFromDailyReturns(retsB);
  const volatilityPct = capPctDisplay(annualizedVolFromDailyReturns(retsO));
  const benchmarkVolatilityPct = capPctDisplay(
    annualizedVolFromDailyReturns(retsB)
  );
  const maxDrawdownPct = capPctDisplay(maxDrawdownFraction(ovrW) * 100);
  const benchmarkMaxDrawdownPct = capPctDisplay(
    maxDrawdownFraction(benchW) * 100
  );

  const displayHorizonLabel =
    n >= 50
      ? `Últimos ${DISPLAY_HORIZON_YEARS} anos (histórico do modelo; ilustrativo)`
      : "Horizonte limitado pelos dados disponíveis";
  const displayCagrLabel =
    n >= 50
      ? `CAGR anualizado dos últimos ${DISPLAY_CAGR_YEARS} anos`
      : "CAGR anualizado no período disponível";

  const series: SeriesPoint[] = [];
  const baseBench = benchmark[hStart] > 0 ? benchmark[hStart] : 1;
  const baseRaw = raw[hStart] > 0 ? raw[hStart] : 1;
  const baseOverlay = overlayed[hStart] > 0 ? overlayed[hStart] : 1;
  for (let i = hStart; i < n; i += 5) {
    series.push({
      date: String(dates[i]).slice(0, 10),
      benchmark: ((benchmark[i] / baseBench) - 1) * 100,
      raw: ((raw[i] / baseRaw) - 1) * 100,
      overlayed: ((overlayed[i] / baseOverlay) - 1) * 100,
    });
  }

  const currentValueEur =
    actualPositions.reduce((acc, p) => acc + p.value, 0) + cashEur;

  const profileLabel = safeString(modelPayload?.meta?.profile, "moderado");
  const buyCount = proposedTrades.filter((t) => t.side === "BUY").length;
  const sellCount = proposedTrades.filter((t) => t.side === "SELL").length;
  const turnoverAbs = proposedTrades.reduce(
    (acc, t) => acc + Math.abs(t.deltaValueEst),
    0
  );
  const turnoverPct =
    navEur > 0 ? capPctDisplay((turnoverAbs / navEur) * 100) : 0;

  const planSummary = {
    strategyLabel: "Ações globais (modelo DECIDE)",
    riskLabel: profileRiskLabel(profileLabel),
    positionCount: recommendedPositions.length,
    turnoverPct,
    buyCount,
    sellCount,
  };
  const proposedTradesCoverageNote =
    tradePlanRows.length > 0
      ? "Inclui ordens do plano IBKR e ajustes sintéticos para cobrir toda a carteira recomendada."
      : "Sem plano IBKR disponível: lista construída a partir da diferença entre carteira atual e recomendada.";
  const modelDisplayName = "Modelo com Exposição máxima <= 100%";

  const feeSegment: "A" | "B" = navEur >= 50000 ? "B" : "A";
  const monthlyFixedFeeEur = feeSegment === "A" ? 20 : 0;
  const annualManagementFeePct = feeSegment === "B" ? 0.6 : 0;
  const estimatedAnnualManagementFeeEur =
    feeSegment === "B" ? navEur * 0.006 : 0;
  const estimatedMonthlyManagementFeeEur =
    feeSegment === "B" ? estimatedAnnualManagementFeeEur / 12 : 20;

  /** 15% sobre excesso de CAGR anual vs benchmark, com teto para não alarmar o cliente. */
  const cagrExcessFrac = Math.max(
    0,
    cagrPct / 100 - benchmarkCagrPct / 100
  );
  const performanceFeeRaw =
    feeSegment === "B" ? navEur * Math.min(0.2, cagrExcessFrac) * 0.15 : 0;
  const estimatedPerformanceFeeEur = Math.min(
    performanceFeeRaw,
    navEur * 0.05
  );

  const reportData: ReportData = {
    generatedAt: new Date().toISOString(),
    accountCode,
    profile: profileLabel,
    modelDisplayName,
    navEur,
    cashEur,
    currentValueEur,
    totalReturnPct,
    benchmarkTotalReturnPct,
    outperformancePct,
    cagrPct,
    benchmarkCagrPct,
    sharpe,
    benchmarkSharpe,
    volatilityPct,
    benchmarkVolatilityPct,
    maxDrawdownPct,
    benchmarkMaxDrawdownPct,
    displayHorizonLabel,
    displayCagrLabel,
    planSummary,
    excludedTickersApplied,
    exclusionCandidates,
    tbillsProxyWeightPct,
    proposedTradesCoverageNote,
    backendError,
    closeAsOfDate,
    actualPositions,
    recommendedPositions,
    proposedTrades,
    series,
    feeSegment,
    monthlyFixedFeeEur,
    annualManagementFeePct,
    estimatedAnnualManagementFeeEur,
    estimatedMonthlyManagementFeeEur,
    estimatedPerformanceFeeEur,
  };

  return {
    props: {
      reportData,
    },
  };
};

function SummaryCard({
  title,
  value,
  sub,
}: {
  title: string;
  value: string;
  sub?: string;
}) {
  return (
    <div
      style={{
        background: "#111827",
        border: "1px solid #1f2937",
        borderRadius: 16,
        padding: 18,
      }}
    >
      <div style={{ color: "#9ca3af", fontSize: 13, marginBottom: 8 }}>{title}</div>
      <div style={{ color: "#ffffff", fontSize: 28, fontWeight: 700 }}>{value}</div>
      {sub ? (
        <div style={{ color: "#94a3b8", fontSize: 13, marginTop: 8 }}>{sub}</div>
      ) : null}
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2
      style={{
        color: "#ffffff",
        fontSize: 22,
        fontWeight: 700,
        marginTop: 0,
        marginBottom: 16,
      }}
    >
      {children}
    </h2>
  );
}

type LiveIbkrStructure = {
  netLiquidation: number;
  ccy: string;
  grossPositionsValue: number;
  financing: number;
  financingCcy: string;
};

/** Rótulo da linha sintética LIQUIDEZ (TotalCashValue IBKR): positivo ≈ caixa; negativo ≈ margem. */
function liquidezCashLabel(value: number): string {
  return Number.isFinite(value) && value < 0
    ? "Financiamento via margem (IBKR)"
    : "T-Bills (proxy)";
}

function formatLeverageMultiple(ratio: number): string {
  if (!Number.isFinite(ratio) || ratio <= 0) return "—";
  return `${ratio.toFixed(1).replace(".", ",")}×`;
}

/** Mantém o passo «Decisão final» (ex.: concluído / ver carteira) após refresh ou re-fetch da página. */
const EXEC_STATE_STORAGE_KEY = "decide_report_exec_v1";

export default function ClientReportPage({ reportData }: PageProps) {
  const isClientB = reportData.feeSegment === "B";
  const excludedTickers = reportData.excludedTickersApplied || [];
  type PostApprovalStage = "idle" | "approved" | "ready" | "executing" | "done" | "failed";
  type ExecSummary = {
    submitted: number;
    filled: number;
    partial: number;
    failed: number;
    total: number;
  } | null;
  type ExecFill = {
    ticker: string;
    action: string;
    requested_qty: number;
    filled: number;
    avg_fill_price?: number | null;
    status: string;
    message?: string | null;
    /** IB symbol used when the request ticker is a proxy (e.g. TBILL_PROXY → BIL). */
    executed_as?: string | null;
  };
  const [postApprovalStage, setPostApprovalStage] = useState<PostApprovalStage>("idle");
  const [executionMessage, setExecutionMessage] = useState<string>("");
  const [execSummary, setExecSummary] = useState<ExecSummary>(null);
  /** True quando esta corrida enviou só um subconjunto (ex.: completar falhadas) — não é o plano completo de uma só vez. */
  const [lastExecBatchResidual, setLastExecBatchResidual] = useState(false);
  const [execFills, setExecFills] = useState<ExecFill[]>([]);
  const [liveActualPositions, setLiveActualPositions] = useState<ActualPosition[] | null>(null);
  const [liveIbkrStructure, setLiveIbkrStructure] = useState<LiveIbkrStructure | null>(null);
  const [liveSnapshotError, setLiveSnapshotError] = useState<string>("");
  const [portfolioRefreshing, setPortfolioRefreshing] = useState(false);
  const [flattenBusy, setFlattenBusy] = useState(false);
  const [flattenMessage, setFlattenMessage] = useState<string | null>(null);
  /** Botão «zerar posições» — definir NEXT_PUBLIC_SHOW_FLATTEN_BUTTON=0 para ocultar. */
  const showFlattenDevButton = process.env.NEXT_PUBLIC_SHOW_FLATTEN_BUTTON !== "0";

  useLayoutEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = sessionStorage.getItem(EXEC_STATE_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as {
        v?: number;
        accountCode?: string;
        stage?: PostApprovalStage;
        executionMessage?: string;
        execSummary?: ExecSummary;
        execFills?: ExecFill[];
        lastExecBatchResidual?: boolean;
      };
      if (parsed.v !== 1 || parsed.accountCode !== reportData.accountCode) return;
      if (
        parsed.stage !== "approved" &&
        parsed.stage !== "ready" &&
        parsed.stage !== "executing" &&
        parsed.stage !== "done" &&
        parsed.stage !== "failed"
      ) {
        return;
      }
      let stage = parsed.stage;
      let msg = typeof parsed.executionMessage === "string" ? parsed.executionMessage : "";
      if (stage === "executing") {
        stage = "ready";
        msg =
          "A página foi recarregada durante o envio. Confirme na TWS se as ordens concluíram; pode usar «Executar ordens» se algo ficou incompleto.";
      }
      setPostApprovalStage(stage);
      if (msg) setExecutionMessage(msg);
      if (parsed.execSummary !== undefined) setExecSummary(parsed.execSummary);
      if (Array.isArray(parsed.execFills)) setExecFills(parsed.execFills);
      if (typeof parsed.lastExecBatchResidual === "boolean") setLastExecBatchResidual(parsed.lastExecBatchResidual);
    } catch {
      /* ignore */
    }
  }, [reportData.accountCode]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (postApprovalStage === "idle") {
      try {
        sessionStorage.removeItem(EXEC_STATE_STORAGE_KEY);
      } catch {
        /* ignore */
      }
      return;
    }
    try {
      sessionStorage.setItem(
        EXEC_STATE_STORAGE_KEY,
        JSON.stringify({
          v: 1,
          accountCode: reportData.accountCode,
          stage: postApprovalStage,
          executionMessage,
          execSummary,
          execFills,
          lastExecBatchResidual,
          ts: Date.now(),
        })
      );
    } catch {
      /* ignore */
    }
  }, [
    postApprovalStage,
    executionMessage,
    execSummary,
    execFills,
    lastExecBatchResidual,
    reportData.accountCode,
  ]);

  const portfolioTablePositions = useMemo(() => {
    const src = liveActualPositions ?? reportData.actualPositions;
    if (liveIbkrStructure) {
      return src.filter((p) => p.ticker !== "LIQUIDEZ");
    }
    return src;
  }, [liveActualPositions, reportData.actualPositions, liveIbkrStructure]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const k = window.sessionStorage.getItem("decide_report_scroll");
    if (k !== "carteira-atual") return;
    window.sessionStorage.removeItem("decide_report_scroll");
    const t = window.setTimeout(() => {
      document.getElementById("carteira-atual")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 350);
    return () => window.clearTimeout(t);
  }, []);

  const planExecutionAlignmentPct = useMemo(() => {
    if (!execFills.length) return null as number | null;
    let req = 0;
    let fil = 0;
    for (const f of execFills) {
      const r = Number(f.requested_qty ?? 0);
      const x = Number(f.filled ?? 0);
      if (r > 0) {
        req += r;
        fil += Math.min(x, r);
      }
    }
    if (req <= 0) return null;
    return Math.min(100, Math.round((fil / req) * 1000) / 10);
  }, [execFills]);

  const incompleteRetryFromFills = useMemo(
    () =>
      execFills
        .filter((f) => fillEligibleForCompletionRetry(f))
        .map((f) => ({
          ticker: f.ticker,
          side: String(f.action || "BUY").toUpperCase(),
          qty: Math.max(1, remainingOrderQty(f)),
        })),
    [execFills]
  );

  useEffect(() => {
    if (postApprovalStage !== "approved") return;
    const t = setTimeout(() => setPostApprovalStage("ready"), 2200);
    return () => clearTimeout(t);
  }, [postApprovalStage]);

  const scrollToOrders = () => {
    const el = document.getElementById("alteracoes-propostas");
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const refreshIbkrPositionsFromIb = async () => {
    setPortfolioRefreshing(true);
    setLiveSnapshotError("");
    try {
      const apiUrl =
        typeof window !== "undefined"
          ? `${window.location.origin}/api/ibkr-snapshot`
          : "/api/ibkr-snapshot";
      const res = await fetch(apiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paper_mode: true }),
        credentials: "same-origin",
        cache: "no-store",
      });
      const rawBody = await res.text();
      let data: {
        status?: string;
        error?: string;
        detail?: unknown;
        positions?: Array<{
          ticker?: string;
          qty?: number;
          market_price?: number;
          value?: number;
          currency?: string;
          weight_pct?: number;
        }>;
        net_liquidation?: number;
        net_liquidation_ccy?: string;
        cash_ledger?: { tag?: string; value?: number; currency?: string; weight_pct?: number };
      };
      try {
        data = JSON.parse(rawBody) as typeof data;
      } catch {
        throw new Error(
          rawBody?.slice(0, 200) ||
            `Resposta inválida do servidor (${res.status}). Confirme que o Next.js está a correr e que /api/ibkr-snapshot existe.`
        );
      }
      const upstreamErr =
        (typeof data?.error === "string" && data.error) ||
        (typeof data?.detail === "string" && data.detail) ||
        (Array.isArray(data?.detail) ? JSON.stringify(data.detail) : null);
      if (!res.ok || data?.status !== "ok" || !Array.isArray(data.positions)) {
        throw new Error(
          upstreamErr ||
            (res.status === 404
              ? "Endpoint /api/ibkr-snapshot não encontrado no backend — reinicie o uvicorn (app_main) na porta configurada em BACKEND_URL."
              : `Falha ao ler conta IBKR (${res.status})`)
        );
      }
      const navCcy = safeString(data.net_liquidation_ccy, "USD");
      const netLiq = safeNumber(data.net_liquidation, 0);
      const grossPositionsValue = data.positions.reduce((acc, p) => acc + safeNumber(p.value, 0), 0);

      const rows: ActualPosition[] = data.positions.map((p) => {
        const mpx = safeNumber(p.market_price, 0);
        const val = safeNumber(p.value, 0);
        return {
          ticker: safeString(p.ticker, "").toUpperCase(),
          qty: safeNumber(p.qty, 0),
          marketPrice: mpx,
          closePrice: mpx > 0 ? mpx : null,
          value: val,
          weightPct: safeNumber(p.weight_pct, 0),
          currency: safeString(p.currency, navCcy),
        };
      });
      const cl = data.cash_ledger;
      let financing = 0;
      let financingCcy = navCcy;
      if (
        cl &&
        typeof cl.value === "number" &&
        Number.isFinite(cl.value) &&
        Math.abs(cl.value) > 0.0001
      ) {
        financing = cl.value;
        financingCcy = safeString(cl.currency, navCcy);
        rows.push({
          ticker: "LIQUIDEZ",
          qty: 0,
          marketPrice: 0,
          closePrice: null,
          value: cl.value,
          weightPct: safeNumber(cl.weight_pct, 0),
          currency: financingCcy,
        });
      }
      rows.sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
      setLiveIbkrStructure({
        netLiquidation: netLiq,
        ccy: navCcy,
        grossPositionsValue,
        financing,
        financingCcy,
      });
      setLiveActualPositions(rows);
      if (typeof window !== "undefined") {
        window.requestAnimationFrame(() => {
          document.getElementById("carteira-atual")?.scrollIntoView({ behavior: "smooth", block: "start" });
        });
      }
    } catch (e: unknown) {
      const raw = e instanceof Error ? e.message : "Não foi possível atualizar a carteira.";
      const msg =
        raw === "Failed to fetch" || raw === "Load failed" || raw === "NetworkError when attempting to fetch resource."
          ? "Sem ligação ao servidor (Next/API). Confirme que o frontend está a correr (npm run dev), que abre a mesma origem (URL) e que a firewall não bloqueia. Se o erro persistir, reinicie o Next e o backend (uvicorn na porta de BACKEND_URL)."
          : raw;
      setLiveSnapshotError(msg);
    } finally {
      setPortfolioRefreshing(false);
    }
  };

  const flattenPaperPortfolioAll = async () => {
    if (typeof window === "undefined") return;
    const ok = window.confirm(
      "Conta IBKR paper (teste): enviar ordens de mercado para fechar TODAS as posições em ações do portfolio (incl. BIL / proxy T-Bills).\n\n" +
        "A linha de caixa/margem (TotalCashValue) não é zerada por aqui — apenas títulos.\n\nContinuar?"
    );
    if (!ok) return;
    setFlattenBusy(true);
    setFlattenMessage(null);
    try {
      const res = await fetch(`${window.location.origin}/api/flatten-paper-portfolio`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paper_mode: true }),
        credentials: "same-origin",
        cache: "no-store",
      });
      const raw = await res.text();
      let data: { status?: string; error?: string; closes?: unknown[] };
      try {
        data = JSON.parse(raw) as typeof data;
      } catch {
        throw new Error(raw.slice(0, 200) || `Resposta inválida (${res.status})`);
      }
      if (!res.ok || data.status !== "ok") {
        throw new Error(
          typeof data.error === "string" && data.error
            ? data.error
            : `Falha ao fechar posições (${res.status})`
        );
      }
      const n = Array.isArray(data.closes) ? data.closes.length : 0;
      setFlattenMessage(`Pedidos enviados: ${n} linha(s). A sincronizar a carteira…`);
      await refreshIbkrPositionsFromIb();
      setFlattenMessage(`Concluído: ${n} linha(s) processada(s). Confirme na TWS / tabela acima.`);
    } catch (e: unknown) {
      setFlattenMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setFlattenBusy(false);
    }
  };

  const executeOrdersNow = async (ordersOverride?: Array<{ ticker: string; side: string; qty: number }>) => {
    const override = Array.isArray(ordersOverride) ? ordersOverride : undefined;
    setLiveActualPositions(null);
    setLiveIbkrStructure(null);
    setLiveSnapshotError("");
    const rawOrders =
      override && override.length > 0
        ? override
        : proposedTradesFiltered
            .filter((t) => (t.side === "BUY" || t.side === "SELL") && t.absQty > 0)
            .map((t) => ({
              ticker: t.ticker,
              side: t.side,
              qty: Math.floor(t.absQty),
            }))
            .filter((o) => o.qty > 0);

    // Contas com margem: TWS exige reduzir exposição antes de novas compras — SELL sempre antes de BUY.
    const orders = [...rawOrders].sort((a, b) => {
      const pa = String(a.side).toUpperCase() === "SELL" ? 0 : 1;
      const pb = String(b.side).toUpperCase() === "SELL" ? 0 : 1;
      if (pa !== pb) return pa - pb;
      return String(a.ticker).localeCompare(String(b.ticker));
    });

    if (orders.length === 0) {
      setExecutionMessage("Sem ordens válidas para executar.");
      setPostApprovalStage("failed");
      return;
    }

    setLastExecBatchResidual(Boolean(override && override.length > 0));

    setExecSummary(null);
    setExecutionMessage("A enviar ordens para a corretora...");
    setPostApprovalStage("executing");

    try {
      const sendUrl =
        typeof window !== "undefined"
          ? `${window.location.origin}/api/send-orders`
          : "/api/send-orders";
      const res = await fetch(sendUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orders, paper_mode: true }),
        credentials: "same-origin",
        cache: "no-store",
      });

      const rawSend = await res.text();
      let payload: any;
      try {
        payload = JSON.parse(rawSend);
      } catch {
        throw new Error(
          rawSend?.slice(0, 200) ||
            `Resposta inválida do proxy (${res.status}). Tente recarregar a página.`
        );
      }
      if (!res.ok || !payload || !Array.isArray(payload.fills)) {
        throw new Error(payload?.error || `Falha de execução (${res.status})`);
      }
      // FastAPI devolve 200 com status "rejected" (ex.: TWS desligado, conta não paper).
      if (payload.status === "rejected" || (payload.status && payload.status !== "ok")) {
        throw new Error(
          typeof payload.error === "string" && payload.error
            ? payload.error
            : "Pedido rejeitado pela corretora ou pelo servidor."
        );
      }

      const fills = payload.fills as Array<{
        ticker?: string;
        action?: string;
        status?: string;
        requested_qty?: number;
        filled?: number;
        avg_fill_price?: number;
        message?: string;
        executed_as?: string;
      }>;
      setExecFills(fills as ExecFill[]);

      let submitted = 0;
      let filled = 0;
      let partial = 0;
      let failed = 0;

      for (const f of fills) {
        const st = String(f.status || "").toLowerCase();
        const reqQty = Number(f.requested_qty || 0);
        const fillQty = Number(f.filled || 0);
        if (st.includes("filled") && fillQty >= reqQty && reqQty > 0) {
          filled += 1;
        } else if (fillQty > 0 && fillQty < reqQty) {
          partial += 1;
        } else if (
          st.includes("submitted") ||
          st.includes("presubmitted") ||
          st.includes("pending")
        ) {
          submitted += 1;
        } else {
          failed += 1;
        }
      }

      setExecSummary({
        submitted,
        filled,
        partial,
        failed,
        total: fills.length,
      });
      setExecutionMessage("Execução concluída com retorno da corretora.");
      setPostApprovalStage("done");
    } catch (e: any) {
      const raw = e instanceof Error ? e.message : String(e);
      const lower = raw.toLowerCase();
      const msg =
        lower === "failed to fetch" ||
        lower === "fetch failed" ||
        lower.includes("networkerror") ||
        lower === "load failed"
          ? "Sem ligação ao Next ou ao backend. Confirme: (1) npm run dev na pasta frontend (porta 4701), (2) uvicorn na porta de BACKEND_URL no .env.local (ex. 8090), (3) firewall/antivírus a não bloquear localhost."
          : raw;
      setExecutionMessage(msg || "Falha ao enviar ordens para a corretora.");
      setPostApprovalStage("failed");
    }
  };
  const enforceMaxExclusions = (e: { currentTarget: HTMLInputElement }) => {
    const form = e.currentTarget.form;
    if (!form) return;
    const checked = form.querySelectorAll('input[name="exclude"]:checked').length;
    if (checked > 5) {
      e.currentTarget.checked = false;
    }
  };

  const tickerHref = (ticker: string) => {
    const t = ticker.trim().toUpperCase();
    if (!t || t === "TBILL_PROXY" || t === "LIQUIDEZ") return null;
    return {
      yf: `https://finance.yahoo.com/quote/${encodeURIComponent(t)}`,
      ib: `https://www.interactivebrokers.com/en/search/?q=${encodeURIComponent(t)}`,
    };
  };
  const recommendedFiltered = reportData.recommendedPositions || [];
  const proposedTradesFiltered = reportData.proposedTrades || [];

  const tradeVolumeAbsEur = proposedTradesFiltered.reduce(
    (acc, t) => acc + Math.abs(t.deltaValueEst),
    0
  );
  const buyCountVisible = proposedTradesFiltered.filter((t) => t.side === "BUY").length;
  const sellCountVisible = proposedTradesFiltered.filter((t) => t.side === "SELL").length;
  const turnoverPctVisible =
    reportData.navEur > 0 ? (tradeVolumeAbsEur / reportData.navEur) * 100 : 0;

  const sectorWeights = (() => {
    const map = new Map<string, number>();
    for (const p of recommendedFiltered || []) {
      const sectorRaw = safeString(p.sector, "").trim();
      const sector = sectorRaw || "—";
      const w = Number.isFinite(p.weightPct) ? p.weightPct : 0;
      map.set(sector, (map.get(sector) || 0) + w);
    }
    return Array.from(map.entries())
      .map(([sector, weightPct]) => ({ sector, weightPct }))
      .sort((a, b) => b.weightPct - a.weightPct);
  })();

  const sectorTop10 = sectorWeights.slice(0, 10);

  return (
    <>
      <Head>
        <title>DECIDE | Relatório do Cliente</title>
      </Head>

      <div
        style={{
          minHeight: "100vh",
          background: "#030712",
          color: "#e5e7eb",
          padding: "24px 24px 48px 24px",
          fontFamily:
            'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        }}
      >
        <div style={{ maxWidth: 1440, margin: "0 auto" }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: 20,
              alignItems: "flex-start",
              flexWrap: "wrap",
              marginBottom: 24,
            }}
          >
            <div>
              <div style={{ color: "#60a5fa", fontSize: 14, fontWeight: 700, marginBottom: 8 }}>
                DECIDE AI
              </div>
              <h1
                style={{
                  fontSize: 34,
                  lineHeight: 1.1,
                  margin: 0,
                  color: "#ffffff",
                }}
              >
                Relatório do Cliente
              </h1>
              <div style={{ color: "#94a3b8", marginTop: 10, fontSize: 15 }}>
                Conta IBKR: {reportData.accountCode || "—"} · Perfil:{" "}
                {reportData.profile || "moderado"} · {reportData.modelDisplayName} · Gerado em{" "}
                {reportData.generatedAt.slice(0, 19).replace("T", " ")}
                {reportData.closeAsOfDate ? (
                  <>
                    {" "}
                    · Close até: {reportData.closeAsOfDate}
                  </>
                ) : null}
              </div>
              <div
                style={{
                  marginTop: 10,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                  borderRadius: 999,
                  border: "1px solid #2563eb",
                  background: "rgba(37,99,235,0.12)",
                  color: "#bfdbfe",
                  fontSize: 12,
                  fontWeight: 800,
                  padding: "6px 10px",
                }}
              >
                Modelo ativo: {reportData.modelDisplayName}
              </div>
              {reportData.backendError ? (
                <div style={{ color: "#fca5a5", marginTop: 12, fontSize: 14 }}>
                  Aviso backend: {reportData.backendError}
                </div>
              ) : null}
            </div>

            <div
              style={{
                display: "flex",
                gap: 12,
                flexWrap: "wrap",
                alignItems: "center",
              }}
            >
              <ClientFlowDashboardButton />
            </div>
          </div>

          <div
            style={{
              display: "flex",
              gap: 12,
              flexWrap: "wrap",
              alignItems: "center",
              marginBottom: 24,
            }}
          >
            <Link
              href="/client/ibkr-prep"
              style={{
                background: "#0b1120",
                border: "1px solid #1d4ed8",
                color: "#bfdbfe",
                textDecoration: "none",
                borderRadius: 999,
                padding: "10px 16px",
                fontWeight: 600,
                fontSize: 13,
              }}
            >
              Preparar abertura IBKR
            </Link>
          </div>

          <>
          <div
            style={{
              background: "linear-gradient(145deg, #0c1629 0%, #0a0f1c 100%)",
              border: "1px solid rgba(59,130,246,0.35)",
              borderRadius: 18,
              padding: "22px 24px",
              marginBottom: 28,
              boxShadow: "0 0 0 1px rgba(15,23,42,0.8), 0 18px 40px rgba(0,0,0,0.35)",
            }}
          >
            <div
              style={{
                color: "#60a5fa",
                fontSize: 12,
                fontWeight: 800,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                marginBottom: 10,
              }}
            >
              Resumo do plano
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
                gap: 18,
                fontSize: 15,
                lineHeight: 1.55,
                color: "#e2e8f0",
              }}
            >
              <div>
                <div style={{ color: "#94a3b8", fontSize: 13, marginBottom: 4 }}>Estratégia</div>
                <div style={{ fontWeight: 700, color: "#ffffff" }}>
                  {reportData.planSummary.strategyLabel}
                </div>
              </div>
              <div>
                <div style={{ color: "#94a3b8", fontSize: 13, marginBottom: 4 }}>Perfil de risco</div>
                <div style={{ fontWeight: 700, color: "#ffffff" }}>
                  {reportData.planSummary.riskLabel}
                </div>
              </div>
              <div>
                <div style={{ color: "#94a3b8", fontSize: 13, marginBottom: 4 }}>Posições alvo</div>
                <div style={{ fontWeight: 700, color: "#ffffff" }}>
                  {reportData.planSummary.positionCount}
                </div>
                <div style={{ color: "#94a3b8", fontSize: 12, marginTop: 4 }}>
                  T-Bills / Cash Sleeve: {formatPct(reportData.tbillsProxyWeightPct)}
                </div>
              </div>
              <div>
                <div style={{ color: "#94a3b8", fontSize: 13, marginBottom: 4 }}>Rotação proposta</div>
                <div style={{ fontWeight: 700, color: "#ffffff" }}>
                  ~{formatPct(reportData.planSummary.turnoverPct)} do valor da conta (estimativa)
                </div>
                <div style={{ color: "#94a3b8", fontSize: 12, marginTop: 4 }}>
                  Inclui reestruturação inicial da carteira.
                </div>
              </div>
            </div>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
              gap: 16,
              marginBottom: 28,
            }}
          >
            <SummaryCard
              title="Valor atual da conta"
              value={formatEuro(reportData.navEur)}
              sub={`Cash disponível: ${formatEuro(reportData.cashEur)}`}
            />
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <SummaryCard
                title="CAGR do modelo"
                value={formatPct(reportData.totalReturnPct)}
                sub={`Benchmark: ${formatPct(
                  reportData.benchmarkTotalReturnPct
                )} · ${reportData.displayCagrLabel}`}
              />
            </div>
            <SummaryCard
              title="Outperformance"
              value={formatPct(reportData.outperformancePct)}
              sub={`Spread CAGR vs benchmark · ${reportData.displayCagrLabel}`}
            />
            <SummaryCard
              title="Fee segment"
              value={reportData.feeSegment}
              sub={
                reportData.feeSegment === "A"
                  ? "20 € / mês"
                  : "0,6% / ano + 15% performance fee"
              }
            />
          </div>

          <div
            id="alteracoes-propostas"
            style={{
              background: "#111827",
              border: "1px solid #1f2937",
              borderRadius: 18,
              padding: 20,
              marginBottom: 28,
            }}
          >
            <SectionTitle>Performance</SectionTitle>
            <p
              style={{
                color: "#94a3b8",
                fontSize: 14,
                marginTop: -8,
                marginBottom: 18,
                lineHeight: 1.55,
              }}
            >
              {reportData.displayHorizonLabel}. Valores passados não garantem resultados futuros.
            </p>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                gap: 14,
                marginBottom: 18,
              }}
            >
              <div style={{ color: "#cbd5e1" }}>
                <strong style={{ color: "#ffffff" }}>Sharpe:</strong>{" "}
                {reportData.sharpe.toFixed(2)}
              </div>
              <div style={{ color: "#cbd5e1" }}>
                <strong style={{ color: "#ffffff" }}>Volatilidade:</strong>{" "}
                {formatPct(reportData.volatilityPct)}
              </div>
              <div style={{ color: "#cbd5e1" }}>
                <strong style={{ color: "#ffffff" }}>Max Drawdown:</strong>{" "}
                {formatPct(reportData.maxDrawdownPct)}
              </div>
              <div style={{ color: "#cbd5e1" }}>
                <strong style={{ color: "#ffffff" }}>Sharpe benchmark:</strong>{" "}
                {reportData.benchmarkSharpe.toFixed(2)}
              </div>
            </div>

            <div style={{ width: "100%", height: 420 }}>
              <ResponsiveContainer>
                <LineChart data={reportData.series}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                  <XAxis dataKey="date" stroke="#94a3b8" />
                  <YAxis
                    stroke="#94a3b8"
                    domain={["auto", "auto"]}
                    allowDataOverflow={false}
                    tickFormatter={(v) => `${Number(v).toFixed(0)}%`}
                  />
                  <Tooltip
                    contentStyle={{
                      background: "#0f172a",
                      border: "1px solid #334155",
                      borderRadius: 12,
                      color: "#ffffff",
                    }}
                  />
                  <Legend />
                  <Line
                    type="monotone"
                    dataKey="benchmark"
                    name="Benchmark"
                    dot={false}
                    stroke="#94a3b8"
                    strokeWidth={2}
                  />
                  <Line
                    type="monotone"
                    dataKey="overlayed"
                    name="Modelo Overlayed"
                    dot={false}
                    stroke="#22c55e"
                    strokeWidth={3}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 20,
              marginBottom: 28,
            }}
          >
            <div
              id="carteira-atual"
              style={{
                background: "#111827",
                border: "1px solid #1f2937",
                borderRadius: 18,
                padding: 20,
                overflowX: "auto",
              }}
            >
              <h2
                style={{
                  color: "#ffffff",
                  fontSize: 22,
                  fontWeight: 700,
                  margin: "0 0 16px 0",
                  lineHeight: 1.2,
                }}
              >
                Carteira atual (IBKR real)
              </h2>
              <p style={{ margin: "0 0 14px 0", fontSize: 12, color: "#64748b", lineHeight: 1.5, maxWidth: 560 }}>
                Por defeito mostra a última sincronização ao gerar o relatório (dados em{" "}
                <code style={{ color: "#94a3b8" }}>tmp_diag</code>
                ). Depois de executar ordens, use <strong style={{ color: "#94a3b8" }}>Ver carteira atualizada</strong>{" "}
                no bloco final para <strong style={{ color: "#94a3b8" }}>ver a carteira atualizada em tempo real</strong>.
              </p>
              {liveActualPositions ? (
                <p style={{ margin: "0 0 12px 0", fontSize: 12, color: "#86efac", fontWeight: 600 }}>
                  A mostrar a carteira em tempo real (IBKR).
                </p>
              ) : null}
              {liveSnapshotError ? (
                <p style={{ margin: "0 0 12px 0", fontSize: 12, color: "#fca5a5" }}>{liveSnapshotError}</p>
              ) : null}
              {liveIbkrStructure ? (
                <div
                  style={{
                    margin: "0 0 16px 0",
                    padding: "14px 16px",
                    background: "linear-gradient(180deg, rgba(30,41,59,0.9) 0%, rgba(15,23,42,0.95) 100%)",
                    border: "1px solid rgba(148,163,184,0.35)",
                    borderRadius: 14,
                    maxWidth: 560,
                  }}
                >
                  <div style={{ fontSize: 14, fontWeight: 700, color: "#e2e8f0", marginBottom: 12 }}>
                    Estrutura da carteira (IBKR)
                  </div>
                  <div style={{ display: "grid", gap: 10, fontSize: 13, color: "#cbd5e1" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
                      <span style={{ color: "#94a3b8" }}>Capital próprio (valor líquido)</span>
                      <strong style={{ color: "#f8fafc" }}>
                        {formatMoneyCompact(liveIbkrStructure.netLiquidation, liveIbkrStructure.ccy)}
                      </strong>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
                      <span style={{ color: "#94a3b8" }}>Exposição em títulos</span>
                      <strong style={{ color: "#f8fafc" }}>
                        {formatMoneyCompact(liveIbkrStructure.grossPositionsValue, liveIbkrStructure.ccy)}
                      </strong>
                    </div>
                    {Math.abs(liveIbkrStructure.financing) > 1e-4 ? (
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
                        <span style={{ color: "#94a3b8" }}>
                          {liveIbkrStructure.financing < 0
                            ? "Financiamento via margem (IBKR)"
                            : "Saldo de caixa (IBKR, proxy T-Bills)"}
                        </span>
                        <strong style={{ color: liveIbkrStructure.financing < 0 ? "#fca5a5" : "#86efac" }}>
                          {formatMoneyCompact(liveIbkrStructure.financing, liveIbkrStructure.financingCcy)}
                        </strong>
                      </div>
                    ) : null}
                    {liveIbkrStructure.netLiquidation > 1e-6 && liveIbkrStructure.grossPositionsValue > 0 ? (
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
                        <span style={{ color: "#94a3b8" }}>Alavancagem implícita (exposição ÷ capital próprio)</span>
                        <strong style={{ color: "#93c5fd" }}>
                          {formatLeverageMultiple(liveIbkrStructure.grossPositionsValue / liveIbkrStructure.netLiquidation)}
                        </strong>
                      </div>
                    ) : null}
                  </div>
                  {liveIbkrStructure.financing < -1e-4 ? (
                    <p style={{ margin: "12px 0 0 0", fontSize: 12, color: "#94a3b8", lineHeight: 1.5 }}>
                      Valor negativo indica financiamento automático da corretora para suportar exposição superior ao
                      capital disponível. Não é uma posição vendida em T-Bills; o sleeve T-Bills do plano executa como ETF{" "}
                      <strong style={{ color: "#cbd5e1" }}>BIL</strong> na ordem «TBILL_PROXY».
                    </p>
                  ) : Math.abs(liveIbkrStructure.financing) > 1e-4 ? (
                    <p style={{ margin: "12px 0 0 0", fontSize: 12, color: "#94a3b8", lineHeight: 1.5 }}>
                      Saldo à ordem (IBKR <code style={{ color: "#94a3b8" }}>TotalCashValue</code>), não um título. O
                      sleeve T-Bills do plano executa como ETF <strong style={{ color: "#cbd5e1" }}>BIL</strong> na ordem
                      «TBILL_PROXY».
                    </p>
                  ) : null}
                </div>
              ) : null}
              {liveIbkrStructure ? (
                <p style={{ margin: "0 0 12px 0", fontSize: 11, color: "#64748b", lineHeight: 1.45, maxWidth: 560 }}>
                  A tabela seguinte lista <strong style={{ color: "#94a3b8" }}>só títulos</strong>. Caixa e financiamento
                  via margem estão no bloco «Estrutura da carteira».
                </p>
              ) : null}
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
                <thead>
                  <tr style={{ color: "#94a3b8", textAlign: "left" }}>
                    <th style={{ padding: "10px 8px" }}>Ticker</th>
                    <th style={{ padding: "10px 8px" }}>Qtd</th>
                    <th style={{ padding: "10px 8px" }}>Preço (close)</th>
                    <th style={{ padding: "10px 8px" }}>Valor</th>
                    <th style={{ padding: "10px 8px" }}>Peso</th>
                  </tr>
                </thead>
                <tbody>
                  {portfolioTablePositions.length === 0 ? (
                    <tr>
                      <td colSpan={5} style={{ padding: 12, color: "#94a3b8" }}>
                        Sem posições reais disponíveis.
                      </td>
                    </tr>
                  ) : (
                    portfolioTablePositions.map((p, idx) => (
                      <tr key={`${p.ticker}-${idx}`} style={{ borderTop: "1px solid #1f2937" }}>
                        <td style={{ padding: "10px 8px", color: "#ffffff", fontWeight: 700 }}>
                          {(() => {
                            const label =
                              p.ticker === "BIL"
                                ? "BIL (T-Bills)"
                                : p.ticker === "LIQUIDEZ"
                                ? liquidezCashLabel(Number(p.value))
                                : p.ticker;
                            const href = tickerHref(p.ticker);
                            return href ? (
                              <a href={href.yf} target="_blank" rel="noreferrer" style={{ color: "#93c5fd", textDecoration: "none" }}>
                                {label}
                              </a>
                            ) : (
                              label
                            );
                          })()}
                        </td>
                        <td style={{ padding: "10px 8px" }}>
                          {p.ticker === "LIQUIDEZ" ? "—" : formatQty(p.qty)}
                        </td>
                        <td style={{ padding: "10px 8px" }}>
                          {p.ticker === "LIQUIDEZ"
                            ? "—"
                            : typeof p.closePrice === "number" && p.closePrice > 0
                            ? p.closePrice.toFixed(2)
                            : "—"}
                          {p.ticker === "LIQUIDEZ" ? "" : ` ${p.currency}`}
                        </td>
                        <td style={{ padding: "10px 8px" }}>{formatMoneyCompact(p.value, p.currency)}</td>
                        <td style={{ padding: "10px 8px" }}>{formatPct(p.weightPct)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
              {showFlattenDevButton ? (
                <div
                  style={{
                    marginTop: 16,
                    padding: "12px 14px",
                    borderRadius: 12,
                    border: "1px solid rgba(248,113,113,0.45)",
                    background: "rgba(127,29,29,0.25)",
                  }}
                >
                  <div style={{ fontSize: 12, fontWeight: 700, color: "#fecaca", marginBottom: 6 }}>
                    Temporário (testes) — zerar posições na paper
                  </div>
                  <p style={{ margin: "0 0 10px 0", fontSize: 12, color: "#fca5a5", lineHeight: 1.45 }}>
                    Envia ordens de mercado para fechar <strong style={{ color: "#fef2f2" }}>todas</strong> as posições em
                    ações (STK), incluindo BIL. Ordem na TWS: <strong style={{ color: "#fef2f2" }}>SELL</strong> (longos)
                    primeiro; só depois <strong style={{ color: "#fef2f2" }}>BUY</strong> para cobrir shorts — assim a
                    margem liberta antes de novas compras. Não “anula” sozinho o saldo de margem na corretora. Conta{" "}
                    <strong style={{ color: "#fef2f2" }}>paper</strong> apenas.
                  </p>
                  <button
                    type="button"
                    disabled={flattenBusy || portfolioRefreshing}
                    onClick={() => void flattenPaperPortfolioAll()}
                    style={{
                      background: flattenBusy ? "#7f1d1d" : "#b91c1c",
                      border: "1px solid rgba(252,165,165,0.6)",
                      color: "#fff7ed",
                      borderRadius: 10,
                      padding: "10px 14px",
                      fontWeight: 800,
                      fontSize: 13,
                      cursor: flattenBusy || portfolioRefreshing ? "wait" : "pointer",
                    }}
                  >
                    {flattenBusy ? "A enviar ordens de fecho…" : "Zerar todas as posições (paper)"}
                  </button>
                  {flattenMessage ? (
                    <p style={{ margin: "10px 0 0 0", fontSize: 12, color: "#fecaca", lineHeight: 1.45 }}>
                      {flattenMessage}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>

            <div
              style={{
                background: "#111827",
                border: "1px solid #1f2937",
                borderRadius: 18,
                padding: 20,
                overflowX: "auto",
              }}
            >
              <SectionTitle>Carteira recomendada (DECIDE)</SectionTitle>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
                <thead>
                  <tr style={{ color: "#94a3b8", textAlign: "left" }}>
                    <th style={{ padding: "10px 8px" }}>Ticker</th>
                    <th style={{ padding: "10px 8px" }}>Empresa</th>
                    <th style={{ padding: "10px 8px" }}>Peso</th>
                    <th style={{ padding: "10px 8px" }}>Sector</th>
                    <th style={{ padding: "10px 8px" }}>Região</th>
                  </tr>
                </thead>
                <tbody>
                  {recommendedFiltered.map((p) => (
                    <tr
                      key={p.ticker}
                      style={{
                        borderTop: "1px solid #1f2937",
                        opacity: p.excluded ? 0.55 : 1,
                      }}
                    >
                      <td style={{ padding: "10px 8px", color: "#ffffff", fontWeight: 700 }}>
                        {(() => {
                          const href = tickerHref(p.ticker);
                          if (!href) return p.ticker;
                          return (
                            <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                              <a href={href.yf} target="_blank" rel="noreferrer" style={{ color: "#93c5fd", textDecoration: "none" }}>
                                {p.ticker}
                              </a>
                              <a href={href.ib} target="_blank" rel="noreferrer" style={{ color: "#64748b", textDecoration: "none", fontSize: 11 }}>
                                IB
                              </a>
                            </span>
                          );
                        })()}
                      </td>
                      <td style={{ padding: "10px 8px" }}>
                        {p.nameShort || p.ticker}
                        {p.excluded ? (
                          <span
                            style={{
                              marginLeft: 8,
                              fontSize: 11,
                              color: "#fca5a5",
                              border: "1px solid #7f1d1d",
                              borderRadius: 999,
                              padding: "2px 6px",
                            }}
                          >
                            Desativado
                          </span>
                        ) : null}
                      </td>
                      <td style={{ padding: "10px 8px" }}>
                        {formatPct(p.weightPct)}
                        {p.excluded && p.originalWeightPct > 0 ? (
                          <span style={{ marginLeft: 6, fontSize: 11, color: "#94a3b8" }}>
                            (antes {formatPct(p.originalWeightPct)})
                          </span>
                        ) : null}
                      </td>
                      <td style={{ padding: "10px 8px" }}>{p.sector || "—"}</td>
                      <td style={{ padding: "10px 8px" }}>{p.region || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div
              style={{
                background: "#111827",
                border: "1px solid #1f2937",
                borderRadius: 18,
                padding: 20,
                overflow: "hidden",
              }}
            >
              <SectionTitle>Pesos por sector (DECIDE)</SectionTitle>
              <div style={{ color: "#94a3b8", fontSize: 13, marginBottom: 14, lineHeight: 1.5 }}>
                Top {sectorTop10.length} sectores por peso na carteira recomendada.
                {excludedTickers.length > 0 ? " (recalculado após exclusões)." : ""}
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1.1fr 1.4fr auto",
                  gap: 12,
                  alignItems: "center",
                  color: "#64748b",
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: "0.03em",
                  textTransform: "uppercase",
                  marginBottom: 8,
                }}
              >
                <div>Sector</div>
                <div style={{ textAlign: "left" }}>Peso (%)</div>
                <div style={{ textAlign: "right" }}>%</div>
              </div>

              <div style={{ display: "grid", gap: 10 }}>
                {sectorTop10.length === 0 ? (
                  <div style={{ color: "#94a3b8", fontSize: 13 }}>Sem dados de sector.</div>
                ) : (
                  sectorTop10.map((r) => {
                    const w = Math.max(0, Math.min(100, r.weightPct));
                    return (
                      <div key={r.sector} style={{ display: "grid", gridTemplateColumns: "1.1fr 1.4fr auto", gap: 12, alignItems: "center" }}>
                        <div style={{ color: "#ffffff", fontWeight: 700, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {r.sector}
                        </div>
                        <div style={{ width: "100%", height: 10, borderRadius: 999, background: "#0f172a", border: "1px solid #1f2937", overflow: "hidden" }}>
                          <div style={{ width: `${w}%`, height: "100%", background: "#3f73ff" }} />
                        </div>
                        <div style={{ color: "#ffffff", fontWeight: 800, fontSize: 13 }}>
                          {formatPct(r.weightPct)}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>

          <div
            style={{
              background: "#111827",
              border: "1px solid #1f2937",
              borderRadius: 18,
              padding: 20,
              overflowX: "auto",
              marginBottom: 28,
            }}
          >
            <SectionTitle>Alterações propostas</SectionTitle>
            {isClientB ? (
              <div style={{ color: "#cbd5e1", fontSize: 13, marginBottom: 10 }}>
                Cliente B: pode excluir até 5 títulos (caixa antes do ticker) e aplicar.
                <span style={{ color: "#94a3b8" }}> Exclusões ativas: {excludedTickers.length}/5.</span>
                <span style={{ color: "#94a3b8" }}> T-Bills não é excluível.</span>
              </div>
            ) : null}
            <div style={{ color: "#94a3b8", fontSize: 13, marginBottom: 10 }}>
              {reportData.proposedTradesCoverageNote}
            </div>
            {proposedTradesFiltered.length > 0 ? (
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 12,
                  marginBottom: 16,
                  padding: "14px 16px",
                  background: "#0f172a",
                  borderRadius: 14,
                  border: "1px solid #1e293b",
                  fontSize: 14,
                }}
              >
                <span style={{ color: "#86efac", fontWeight: 700 }}>
                  Compras: {buyCountVisible}
                </span>
                <span style={{ color: "#fca5a5", fontWeight: 700 }}>
                  Vendas: {sellCountVisible}
                </span>
                <span style={{ color: "#cbd5e1" }}>
                  Volume ajustado (soma dos impactos):{" "}
                  <strong style={{ color: "#ffffff" }}>{formatEuro(tradeVolumeAbsEur)}</strong>
                </span>
                <span style={{ color: "#94a3b8" }}>
                  ≈ {formatPct(turnoverPctVisible)} do valor da conta
                </span>
              </div>
            ) : null}
            <form method="get" action="/client/report">
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
              <thead>
                <tr style={{ color: "#94a3b8", textAlign: "left" }}>
                  {isClientB ? <th style={{ padding: "10px 8px" }}>Excluir</th> : null}
                  <th style={{ padding: "10px 8px" }}>Ação</th>
                  <th style={{ padding: "10px 8px" }}>Ticker</th>
                  <th style={{ padding: "10px 8px" }}>Empresa</th>
                  <th style={{ padding: "10px 8px" }}>Quantidade</th>
                  <th style={{ padding: "10px 8px" }}>Preço (close)</th>
                  <th style={{ padding: "10px 8px" }}>Impacto</th>
                  <th style={{ padding: "10px 8px" }}>Peso alvo</th>
                </tr>
              </thead>
              <tbody>
                {proposedTradesFiltered.length === 0 ? (
                  <tr>
                    <td colSpan={isClientB ? 8 : 7} style={{ padding: 12, color: "#94a3b8" }}>
                      Sem alterações propostas disponíveis.
                    </td>
                  </tr>
                ) : (
                  proposedTradesFiltered.map((t, idx) => (
                    <tr key={`${t.ticker}-${idx}`} style={{ borderTop: "1px solid #1f2937" }}>
                      {isClientB ? (
                        <td style={{ padding: "10px 8px" }}>
                          {(t.side === "BUY" || t.side === "INACTIVE") &&
                          t.ticker !== "TBILL_PROXY" ? (
                            <input
                              type="checkbox"
                              name="exclude"
                              value={t.ticker}
                              defaultChecked={
                                t.side === "INACTIVE" || excludedTickers.includes(t.ticker)
                              }
                              onChange={enforceMaxExclusions}
                              disabled={
                                t.side === "INACTIVE" ||
                                excludedTickers.length >= 5 &&
                                !excludedTickers.includes(t.ticker)
                              }
                            />
                          ) : null}
                        </td>
                      ) : null}
                      <td
                        style={{
                          padding: "10px 8px",
                          color:
                            t.side === "BUY"
                              ? "#86efac"
                              : t.side === "SELL"
                              ? "#fca5a5"
                              : "#94a3b8",
                          fontWeight: 700,
                        }}
                      >
                        {t.side === "INACTIVE" ? "INATIVO" : t.side}
                      </td>
                      <td style={{ padding: "10px 8px", color: "#ffffff", fontWeight: 700 }}>
                        {(() => {
                          const href = tickerHref(t.ticker);
                          if (!href) return t.ticker;
                          return (
                            <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                              <a href={href.yf} target="_blank" rel="noreferrer" style={{ color: "#93c5fd", textDecoration: "none" }}>
                                {t.ticker}
                              </a>
                              <a href={href.ib} target="_blank" rel="noreferrer" style={{ color: "#64748b", textDecoration: "none", fontSize: 11 }}>
                                IB
                              </a>
                            </span>
                          );
                        })()}
                      </td>
                      <td style={{ padding: "10px 8px" }}>{t.nameShort || t.ticker}</td>
                      <td style={{ padding: "10px 8px" }}>{formatQty(t.absQty)}</td>
                      <td style={{ padding: "10px 8px" }}>
                        {typeof t.closePrice === "number" && t.closePrice > 0
                          ? t.closePrice.toFixed(2)
                          : "—"}
                      </td>
                      <td style={{ padding: "10px 8px" }}>{formatEuro(Math.abs(t.deltaValueEst))}</td>
                      <td style={{ padding: "10px 8px" }}>{formatPct(t.targetWeightPct)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
            {isClientB ? (
              <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 10 }}>
                <button
                  type="submit"
                  style={{
                    background: "#1d4ed8",
                    border: "1px solid #2563eb",
                    color: "#ffffff",
                    borderRadius: 10,
                    padding: "8px 12px",
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  Aplicar exclusões
                </button>
                <span style={{ color: "#94a3b8", fontSize: 12 }}>
                  Exclusões ativas: {excludedTickers.length}/5
                </span>
                <button
                  type="submit"
                  name="clear"
                  value="1"
                  style={{
                    background: "#111827",
                    border: "1px solid #475569",
                    color: "#cbd5e1",
                    borderRadius: 10,
                    padding: "8px 12px",
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  Limpar exclusões
                </button>
              </div>
            ) : null}
            </form>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
              gap: 20,
              marginBottom: 28,
            }}
          >
            <div
              style={{
                background: "#111827",
                border: "1px solid #1f2937",
                borderRadius: 18,
                padding: 20,
              }}
            >
              <SectionTitle>Fees estimadas</SectionTitle>
              <p style={{ color: "#94a3b8", fontSize: 13, lineHeight: 1.55, marginTop: -6, marginBottom: 14 }}>
                Valores indicativos com base no valor da conta e no segmento. Não substituem
                contrato ou faturação real.
              </p>
              <div style={{ display: "grid", gap: 12, fontSize: 15 }}>
                <div>
                  <strong style={{ color: "#ffffff" }}>Segmento:</strong> {reportData.feeSegment}
                </div>
                <div>
                  <strong style={{ color: "#ffffff" }}>Fee fixa mensal:</strong>{" "}
                  {formatEuro(reportData.monthlyFixedFeeEur)}
                </div>
                <div>
                  <strong style={{ color: "#ffffff" }}>Management fee anual:</strong>{" "}
                  {formatPct(reportData.annualManagementFeePct)}
                </div>
                <div>
                  <strong style={{ color: "#ffffff" }}>Management fee estimada / ano:</strong>{" "}
                  {formatEuro(reportData.estimatedAnnualManagementFeeEur)}
                </div>
                <div>
                  <strong style={{ color: "#ffffff" }}>Management fee estimada / mês:</strong>{" "}
                  {formatEuro(reportData.estimatedMonthlyManagementFeeEur)}
                </div>
                <div>
                  <strong style={{ color: "#ffffff" }}>Performance fee (estimativa anual):</strong>{" "}
                  {formatEuro(reportData.estimatedPerformanceFeeEur)}
                </div>
                <div style={{ color: "#94a3b8", fontSize: 13, lineHeight: 1.55 }}>
                  15% sobre o excesso de retorno anual do modelo face ao benchmark (regra
                  típica; aqui aproximada ao CAGR do horizonte mostrado). Teto de exibição
                  aplicado para evitar valores fora de contexto.
                </div>
              </div>
            </div>

            <div
              style={{
                background: "#111827",
                border: "1px solid #1f2937",
                borderRadius: 18,
                padding: 20,
              }}
            >
              <SectionTitle>Como interpretar este relatório</SectionTitle>
              <div style={{ color: "#cbd5e1", fontSize: 15, lineHeight: 1.7 }}>
                A carteira atual reflete as posições reais da conta paper IBKR. A carteira
                recomendada mostra a alocação alvo do modelo DECIDE. As alterações propostas
                traduzem a diferença entre a carteira atual e a carteira recomendada, ficando
                prontas para aprovação do cliente antes de qualquer execução.
              </div>
            </div>
          </div>

          <div
            style={{
              marginTop: 8,
              padding: "32px 28px 36px",
              borderRadius: 20,
              background: "linear-gradient(180deg, #0f172a 0%, #020617 100%)",
              border: "2px solid rgba(37,99,235,0.55)",
              boxShadow:
                "0 0 0 1px rgba(30,64,175,0.35), 0 24px 48px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.04)",
            }}
          >
            <div
              style={{
                fontSize: 12,
                fontWeight: 800,
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                color: "#60a5fa",
                marginBottom: 12,
              }}
            >
              Decisão final
            </div>
            <h2
              style={{
                margin: "0 0 14px 0",
                fontSize: 26,
                fontWeight: 800,
                color: "#ffffff",
                lineHeight: 1.2,
              }}
            >
              {postApprovalStage === "idle"
                ? "Confirma o plano proposto?"
                : postApprovalStage === "approved"
                ? "Plano aprovado"
                : postApprovalStage === "ready"
                ? "Tudo pronto para executar"
                : postApprovalStage === "executing"
                ? "A executar ordens"
                : postApprovalStage === "failed"
                ? "Execução falhou"
                : "Execução concluída"}
            </h2>
            {postApprovalStage === "idle" ? (
              <>
                <p style={{ color: "#cbd5e1", fontSize: 16, lineHeight: 1.65, margin: "0 0 20px 0", maxWidth: 720 }}>
                  Revimos a sua carteira e propomos as alterações acima.{" "}
                  <strong style={{ color: "#f8fafc" }}>Nenhuma ordem será executada sem a sua aprovação.</strong>
                </p>
                <p
                  style={{
                    color: "#94a3b8",
                    fontSize: 14,
                    lineHeight: 1.6,
                    margin: "0 0 14px 0",
                    maxWidth: 720,
                    padding: "12px 14px",
                    background: "rgba(15,23,42,0.85)",
                    borderRadius: 12,
                    border: "1px solid #1e293b",
                  }}
                >
                  <strong style={{ color: "#e2e8f0" }}>Compreende as alterações propostas.</strong>
                  <br />
                  Pretende avançar para execução.
                </p>
                <div
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 8,
                    color: "#cbd5e1",
                    fontSize: 14,
                    margin: "0 0 20px 0",
                    maxWidth: 720,
                    padding: "8px 12px",
                    borderRadius: 10,
                    background: "rgba(30,41,59,0.55)",
                    border: "1px solid #334155",
                  }}
                >
                  <span aria-hidden>i</span>
                  <span>Pode alterar ou cancelar antes da execução final.</span>
                </div>
                <p style={{ color: "#cbd5e1", fontSize: 14, margin: "0 0 28px 0", maxWidth: 720 }}>
                  Nenhuma ordem será executada automaticamente.
                </p>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 14, alignItems: "center" }}>
                  <button
                    type="button"
                    onClick={() => setPostApprovalStage("approved")}
                    style={{
                      background: "linear-gradient(180deg, #22c55e 0%, #16a34a 100%)",
                      border: "1px solid rgba(34,197,94,0.5)",
                      color: "#052e16",
                      borderRadius: 14,
                      padding: "16px 28px",
                      fontWeight: 800,
                      fontSize: 16,
                      cursor: "pointer",
                      boxShadow: "0 8px 24px rgba(22,163,74,0.35)",
                    }}
                  >
                    Aprovar plano
                  </button>
                  <div style={{ display: "grid", gap: 6, justifyItems: "center" }}>
                    <button
                      type="button"
                      style={{
                        background: "transparent",
                        border: "1px solid #334155",
                        color: "#94a3b8",
                        borderRadius: 12,
                        padding: "12px 18px",
                        fontWeight: 600,
                        fontSize: 14,
                        cursor: "pointer",
                      }}
                    >
                      Manter carteira atual
                    </button>
                  </div>
                </div>
                <p style={{ color: "#94a3b8", fontSize: 13, margin: "10px 0 0 0" }}>
                  Preparar execução será o próximo passo.
                </p>
              </>
            ) : (
              <>
                <p style={{ color: "#cbd5e1", fontSize: 16, lineHeight: 1.65, margin: "0 0 16px 0", maxWidth: 760 }}>
                  {postApprovalStage === "approved" &&
                    "O seu plano foi aprovado. Estamos agora a preparar a execução na sua conta."}
                  {postApprovalStage === "ready" &&
                    "As ordens foram preparadas, mas ainda não foram executadas. Nada é executado automaticamente."}
                  {postApprovalStage === "executing" && executionMessage}
                  {postApprovalStage === "done" &&
                    "Ordens enviadas com sucesso. Use «Ver carteira atualizada» para ver a sua carteira em tempo real e completar ordens parciais ou em curso, quando fizer sentido."}
                  {postApprovalStage === "failed" && (
                    <>
                      Não foi possível executar as ordens. Pode rever ordens e tentar novamente.
                      {executionMessage ? (
                        <span
                          style={{
                            display: "block",
                            marginTop: 12,
                            padding: "12px 14px",
                            background: "rgba(127,29,29,0.35)",
                            border: "1px solid rgba(248,113,113,0.45)",
                            borderRadius: 12,
                            color: "#fecaca",
                            fontSize: 14,
                            lineHeight: 1.5,
                          }}
                        >
                          <strong style={{ color: "#ffffff" }}>Detalhe:</strong> {executionMessage}
                        </span>
                      ) : null}
                    </>
                  )}
                </p>
                <div style={{ display: "grid", gap: 8, marginBottom: 18, maxWidth: 520 }}>
                  <div style={{ color: "#86efac" }}>✔ Plano aprovado</div>
                  <div
                    style={{
                      color:
                        postApprovalStage === "approved"
                          ? "#fbbf24"
                          : postApprovalStage === "ready" ||
                            postApprovalStage === "executing" ||
                            postApprovalStage === "done" ||
                            postApprovalStage === "failed"
                          ? "#86efac"
                          : "#64748b",
                    }}
                  >
                    {postApprovalStage === "approved" ? "⏳ Ordens preparadas" : "✔ Ordens preparadas"}
                  </div>
                  <div
                    style={{
                      color:
                        postApprovalStage === "approved"
                          ? "#fbbf24"
                          : postApprovalStage === "ready" ||
                            postApprovalStage === "executing" ||
                            postApprovalStage === "done" ||
                            postApprovalStage === "failed"
                          ? "#86efac"
                          : "#64748b",
                    }}
                  >
                    {postApprovalStage === "approved" ? "⏳ Conta verificada" : "✔ Conta verificada"}
                  </div>
                  <div
                    style={{
                      color:
                        postApprovalStage === "failed"
                          ? "#fca5a5"
                          : postApprovalStage === "done"
                          ? "#86efac"
                          : postApprovalStage === "ready" || postApprovalStage === "executing"
                          ? "#86efac"
                          : "#64748b",
                    }}
                  >
                    {postApprovalStage === "failed"
                      ? "✖ Execução falhou"
                      : postApprovalStage === "done"
                      ? "✔ Execução concluída"
                      : "✔ Pronto para execução"}
                  </div>
                </div>
                {(postApprovalStage === "ready" || postApprovalStage === "done") && (
                  <div style={{ color: "#94a3b8", fontSize: 14, marginBottom: 18 }}>
                    Ordens preparadas: <strong style={{ color: "#ffffff" }}>{proposedTradesFiltered.length}</strong> ·
                    Valor total estimado: <strong style={{ color: "#ffffff" }}> {formatEuro(tradeVolumeAbsEur)}</strong> ·
                    Impacto na carteira: <strong style={{ color: "#ffffff" }}> {formatPct(turnoverPctVisible)}</strong> (inclui reestruturação inicial)
                  </div>
                )}
                {postApprovalStage === "done" && execSummary && (
                  <div style={{ color: "#94a3b8", fontSize: 14, marginBottom: 18 }}>
                    <div style={{ color: "#cbd5e1", fontWeight: 700, marginBottom: 8 }}>
                      Execução desta ação
                      {lastExecBatchResidual ? (
                        <span style={{ color: "#94a3b8", fontWeight: 600 }}> (residual)</span>
                      ) : null}
                    </div>
                    <div>
                      Executadas: <strong style={{ color: "#86efac" }}>{execSummary.filled}</strong> · Parciais:{" "}
                      <strong style={{ color: "#fbbf24" }}>{execSummary.partial}</strong> · Em curso:{" "}
                      <strong style={{ color: "#93c5fd" }}>{execSummary.submitted}</strong> · Falhadas:{" "}
                      <strong style={{ color: "#fca5a5" }}>{execSummary.failed}</strong> · Total:{" "}
                      <strong style={{ color: "#ffffff" }}>{execSummary.total}</strong>
                    </div>
                    {lastExecBatchResidual ? (
                      <p style={{ margin: "10px 0 0 0", fontSize: 12, color: "#64748b", lineHeight: 1.5, maxWidth: 560 }}>
                        As restantes ordens do plano já foram executadas anteriormente.
                      </p>
                    ) : null}
                  </div>
                )}
                {postApprovalStage === "done" && planExecutionAlignmentPct != null && (
                  <div
                    style={{
                      color: "#cbd5e1",
                      fontSize: 14,
                      fontWeight: 600,
                      marginBottom: 14,
                    }}
                  >
                    Carteira alinhada com o plano: ~{planExecutionAlignmentPct}%
                    <span style={{ display: "block", fontWeight: 400, color: "#64748b", fontSize: 12, marginTop: 4 }}>
                      Os valores podem variar ligeiramente face ao plano.
                    </span>
                  </div>
                )}
                {(postApprovalStage === "done" || postApprovalStage === "failed") &&
                  execFills.length > 0 && (
                    <div
                      style={{
                        marginBottom: 18,
                        border: "1px solid #1e293b",
                        borderRadius: 12,
                        overflow: "hidden",
                        maxWidth: 720,
                      }}
                    >
                      <div
                        style={{
                          padding: "10px 14px",
                          background: "#0f172a",
                          color: "#cbd5e1",
                          fontSize: 13,
                          fontWeight: 700,
                        }}
                      >
                        {lastExecBatchResidual ? "Detalhe desta execução" : "Detalhe das ordens executadas"}
                      </div>
                      <div style={{ overflowX: "auto" }}>
                        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                          <thead>
                            <tr style={{ color: "#94a3b8", textAlign: "left" }}>
                              <th style={{ padding: "8px 12px", borderBottom: "1px solid #1e293b" }}>Título</th>
                              <th style={{ padding: "8px 12px", borderBottom: "1px solid #1e293b" }}>Lado</th>
                              <th style={{ padding: "8px 12px", borderBottom: "1px solid #1e293b" }}>Qtd pedida</th>
                              <th style={{ padding: "8px 12px", borderBottom: "1px solid #1e293b" }}>Executada</th>
                              <th style={{ padding: "8px 12px", borderBottom: "1px solid #1e293b" }}>Preço médio</th>
                              <th style={{ padding: "8px 12px", borderBottom: "1px solid #1e293b" }}>Estado</th>
                            </tr>
                          </thead>
                          <tbody>
                            {execFills.map((f, i) => (
                              <tr key={`${f.ticker}-${f.action}-${i}`} style={{ color: "#e2e8f0" }}>
                                <td style={{ padding: "8px 12px", borderBottom: "1px solid #1e293b", verticalAlign: "top" }}>
                                  <div style={{ fontWeight: 600 }}>{f.ticker}</div>
                                  {f.executed_as && f.executed_as !== f.ticker ? (
                                    <div style={{ color: "#64748b", fontSize: 11, marginTop: 2 }}>
                                      Executado como {f.executed_as}
                                    </div>
                                  ) : null}
                                </td>
                                <td style={{ padding: "8px 12px", borderBottom: "1px solid #1e293b" }}>
                                  {String(f.action || "—")}
                                </td>
                                <td style={{ padding: "8px 12px", borderBottom: "1px solid #1e293b" }}>
                                  {formatQty(Number(f.requested_qty || 0))}
                                </td>
                                <td style={{ padding: "8px 12px", borderBottom: "1px solid #1e293b" }}>
                                  {formatQty(Number(f.filled || 0))}
                                </td>
                                <td style={{ padding: "8px 12px", borderBottom: "1px solid #1e293b" }}>
                                  {formatUsdPrice(f.avg_fill_price)}
                                </td>
                                <td style={{ padding: "8px 12px", borderBottom: "1px solid #1e293b" }}>
                                  {execStatusDisplay(f)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <p style={{ margin: 0, padding: "8px 14px 12px", color: "#64748b", fontSize: 11 }}>
                        Preços em USD (mercado EUA). Algumas ordens ainda estão em execução — o preço final pode variar.
                      </p>
                    </div>
                  )}
                {(postApprovalStage === "done" || postApprovalStage === "failed") &&
                  execFills.length > 0 &&
                  execFills.some((f) => {
                    const st = String(f.status || "").toLowerCase();
                    return (
                      st.includes("error") ||
                      st.includes("rejected") ||
                      st.includes("cancel") ||
                      st.includes("inactive") ||
                      st.includes("not_qualified")
                    );
                  }) && (
                    <div style={{ color: "#94a3b8", fontSize: 13, marginBottom: 14 }}>
                      {lastExecBatchResidual
                        ? "Detalhe desta execução — alertas: "
                        : "Detalhe das ordens executadas — alertas: "}
                      {execFills
                        .filter((f) => {
                          const st = String(f.status || "").toLowerCase();
                          return (
                            st.includes("error") ||
                            st.includes("rejected") ||
                            st.includes("cancel") ||
                            st.includes("inactive") ||
                            st.includes("not_qualified")
                          );
                        })
                        .slice(0, 5)
                        .map((f) => `${f.ticker} (${execStatusDisplay(f)})`)
                        .join(" · ")}
                    </div>
                  )}
                {postApprovalStage === "ready" && (
                  <p style={{ color: "#cbd5e1", fontSize: 14, margin: "0 0 14px 0", maxWidth: 760 }}>
                    As ordens serão enviadas para a corretora apenas após confirmação. Com margem elevada, o envio faz-se
                    por fases: <strong style={{ color: "#e2e8f0" }}>vendas (SELL) primeiro</strong>, breve pausa, depois{" "}
                    <strong style={{ color: "#e2e8f0" }}>compras (BUY)</strong>, para a TWS aceitar o lote.
                  </p>
                )}
                <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                  {postApprovalStage === "ready" && (
                    <>
                      <button
                        type="button"
                        onClick={() => void executeOrdersNow()}
                        style={{
                          background: "linear-gradient(180deg, #22c55e 0%, #16a34a 100%)",
                          border: "1px solid rgba(34,197,94,0.5)",
                          color: "#052e16",
                          borderRadius: 14,
                          padding: "14px 22px",
                          fontWeight: 800,
                          fontSize: 15,
                          cursor: "pointer",
                        }}
                      >
                        Executar ordens
                      </button>
                      <button
                        type="button"
                        onClick={scrollToOrders}
                        style={{
                          background: "transparent",
                          border: "1px solid #334155",
                          color: "#cbd5e1",
                          borderRadius: 12,
                          padding: "12px 18px",
                          fontWeight: 600,
                          fontSize: 14,
                          cursor: "pointer",
                        }}
                      >
                        Rever ordens
                      </button>
                    </>
                  )}
                  {postApprovalStage === "executing" && (
                    <button
                      type="button"
                      style={{
                        background: "transparent",
                        border: "1px solid #334155",
                        color: "#94a3b8",
                        borderRadius: 12,
                        padding: "12px 18px",
                        fontWeight: 600,
                        fontSize: 14,
                        cursor: "not-allowed",
                      }}
                      disabled
                    >
                      A processar...
                    </button>
                  )}
                  {postApprovalStage === "failed" && (
                    <>
                      <button
                        type="button"
                        onClick={() => void executeOrdersNow()}
                        style={{
                          background: "#b91c1c",
                          border: "1px solid #dc2626",
                          color: "#ffffff",
                          borderRadius: 12,
                          padding: "12px 18px",
                          fontWeight: 700,
                          fontSize: 14,
                          cursor: "pointer",
                        }}
                      >
                        Tentar novamente
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const retry = execFills
                            .filter((f) => {
                              const st = String(f.status || "").toLowerCase();
                              const needs =
                                st.includes("submitted") ||
                                st.includes("presubmitted") ||
                                st.includes("pending") ||
                                st.includes("partial") ||
                                st.includes("error") ||
                                st.includes("rejected") ||
                                st.includes("inactive") ||
                                st.includes("not_qualified");
                              return needs && remainingOrderQty(f) > 0;
                            })
                            .map((f) => ({
                              ticker: f.ticker,
                              side: String(f.action || "BUY").toUpperCase(),
                              qty: Math.max(1, remainingOrderQty(f)),
                            }));
                          executeOrdersNow(retry);
                        }}
                        style={{
                          background: "#1e3a8a",
                          border: "1px solid #2563eb",
                          color: "#ffffff",
                          borderRadius: 12,
                          padding: "12px 18px",
                          fontWeight: 700,
                          fontSize: 14,
                          cursor: "pointer",
                        }}
                      >
                        Executar falhadas novamente
                      </button>
                      <button
                        type="button"
                        onClick={scrollToOrders}
                        style={{
                          background: "transparent",
                          border: "1px solid #334155",
                          color: "#cbd5e1",
                          borderRadius: 12,
                          padding: "12px 18px",
                          fontWeight: 600,
                          fontSize: 14,
                          cursor: "pointer",
                        }}
                      >
                        Rever ordens
                      </button>
                    </>
                  )}
                  {postApprovalStage === "done" && (
                    <>
                      <button
                        type="button"
                        disabled={portfolioRefreshing}
                        onClick={() => refreshIbkrPositionsFromIb()}
                        style={{
                          background: portfolioRefreshing ? "#334155" : "#2563eb",
                          border: `1px solid ${portfolioRefreshing ? "#475569" : "#1d4ed8"}`,
                          color: "#ffffff",
                          borderRadius: 12,
                          padding: "12px 18px",
                          fontWeight: 700,
                          fontSize: 14,
                          cursor: portfolioRefreshing ? "wait" : "pointer",
                        }}
                      >
                        {portfolioRefreshing ? "A atualizar a carteira…" : "Ver carteira atualizada"}
                      </button>
                      {incompleteRetryFromFills.length > 0 && (
                        <button
                          type="button"
                          disabled={portfolioRefreshing}
                          onClick={() => executeOrdersNow(incompleteRetryFromFills)}
                          style={{
                            background: portfolioRefreshing ? "#334155" : "#1e3a8a",
                            border: `1px solid ${portfolioRefreshing ? "#475569" : "#2563eb"}`,
                            color: "#ffffff",
                            borderRadius: 12,
                            padding: "12px 18px",
                            fontWeight: 700,
                            fontSize: 14,
                            cursor: portfolioRefreshing ? "not-allowed" : "pointer",
                          }}
                        >
                          Completar ordens pendentes ({incompleteRetryFromFills.length})
                        </button>
                      )}
                      <Link
                        href="/dashboard"
                        style={{
                          textDecoration: "none",
                          background: "transparent",
                          border: "1px solid #334155",
                          color: "#cbd5e1",
                          borderRadius: 12,
                          padding: "12px 18px",
                          fontWeight: 600,
                          fontSize: 14,
                        }}
                      >
                        Ir para dashboard
                      </Link>
                    </>
                  )}
                </div>
                <p style={{ color: "#94a3b8", fontSize: 13, margin: "12px 0 0 0" }}>
                  {postApprovalStage === "done"
                    ? "Pode acompanhar a evolução da carteira no dashboard."
                    : postApprovalStage === "failed"
                    ? "Pode tentar de novo ou rever as ordens antes de submeter."
                    : "Pode executar ou rever as ordens antes de decidir."}
                </p>
              </>
            )}
          </div>
            </>
        </div>
      </div>
    </>
  );
}