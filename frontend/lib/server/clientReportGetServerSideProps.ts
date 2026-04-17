import type { GetServerSideProps, GetServerSidePropsContext } from "next";
import fs from "fs";
import path from "path";
import {
  fillSyntheticEquityBuyQuantities,
  loadApprovalAlignedProposedTrades,
} from "./approvalTradePlan";
import {
  fetchPlafonadoKpisFromKpiServer,
  normalizeRiskProfileForKpi,
  planPlafonadoModeradoCagrFallbackPct,
} from "./fetchPlafonadoCagrFromKpiServer";
import {
  readLandingEmbeddedFreezeCap15CagrDisplayPercent,
  readPlafonadoM100CagrDisplayPercent,
} from "./readPlafonadoFreezeCagr";
import { readHeroKpiFreezeContext } from "./readHeroKpiFreezeContext";
import { resolveDecideProjectRoot } from "./decideProjectRoot";
import {
  isJpNumericListingTicker,
  normalizeJpListingKey,
  remapAdrToJpListingTicker,
  remapJpListingToAdrTicker,
} from "./jpListingToAdrMap";
import { applyJapaneseEquityDisplayFallback } from "../tickerGeoFallback";
import {
  buildOfficialRecommendationMonthsThroughToday,
  pickPlanMonthPreferringTodayFromMonths,
  shouldUseLiveModelWeightsInsteadOfOfficialBook,
  modelPayloadAsOfDateYmd,
  sumCashSleeveWeight,
} from "./buildRecommendationOfficialHistory";
import { supplementClosePricesMapFromLegacyWideCsv } from "./supplementClosePricesFromLegacyWideCsv";
import { FREEZE_PLAFONADO_MODEL_DIR, PLAFONADO_MODEL_DISPLAY_NAME_PT } from "../freezePlafonadoDir";
import {
  estimateUsdNotionalForBuyFxHedge,
  isBuyMissingEquityClosePrice,
} from "../approvalPlanTradeDisplay";
import { capPctDisplay, eurMmIbTicker, safeNumber, safeString } from "../clientReportCoreUtils";
import { lookupCompanyMetaEntry, seedMetaMapFromCompanyMeta } from "../companyMeta";
import { stripPlanBenchmarkIndexRows } from "../planStripBenchmarkIndexTickers";
import {
  applyZoneCapsVsBenchmark,
  benchmarkZoneWeightsFromPriceHeaders,
  canonZoneForCountryCap,
  consolidateWeightsBelowMinimum,
  planEntryMinWeightPct,
  planExitWeightPct,
  planZoneCapMultiplier,
} from "./planWeightAdjustments";
import type {
  ActualPosition,
  LiveIbkrStructure,
  PageProps,
  PlanWeightsProvenance,
  ProposedTrade,
  RecommendedPosition,
  ReportData,
  SeriesPoint,
} from "../../pages/client/report";

function trimmedCell(x: unknown): string {
  return typeof x === "string" ? x.trim() : "";
}

/** Evita página 500 no `/client/report` se algum passo do SSR lançar — o cliente vê `backendError` na UI. */
function buildSsrFailureReportData(backendError: string): ReportData {
  const eurMmSym = eurMmIbTicker();
  const entryMin = planEntryMinWeightPct();
  return {
    generatedAt: new Date().toISOString(),
    accountCode: "",
    profile: "moderado",
    modelDisplayName: PLAFONADO_MODEL_DISPLAY_NAME_PT,
    navEur: 0,
    accountBaseCurrency: "EUR",
    cashEur: 0,
    currentValueEur: 0,
    totalReturnPct: 0,
    benchmarkTotalReturnPct: 0,
    cagrPct: 0,
    benchmarkCagrPct: 0,
    sharpe: 0,
    benchmarkSharpe: 0,
    volatilityPct: 0,
    benchmarkVolatilityPct: 0,
    maxDrawdownPct: 0,
    benchmarkMaxDrawdownPct: 0,
    displayHorizonLabel: "—",
    displayCagrModelSubLabel: "—",
    displayCagrBenchmarkSubLabel: "—",
    planSummary: {
      strategyLabel: "Ações globais (DECIDE V2.3 smooth)",
      riskLabel: "Moderado",
      positionCount: 0,
      turnoverPct: 0,
      buyCount: 0,
      sellCount: 0,
    },
    excludedTickersApplied: [],
    exclusionCandidates: [],
    tbillsProxyWeightPct: 0,
    proposedTradesCoverageNote: "",
    backendError: backendError.length > 500 ? `${backendError.slice(0, 500)}…` : backendError,
    closeAsOfDate: "",
    actualPositions: [],
    recommendedPositions: [],
    proposedTrades: [],
    series: [],
    feeSegment: "A",
    monthlyFixedFeeEur: 20,
    annualManagementFeePct: 0,
    estimatedAnnualManagementFeeEur: 0,
    estimatedMonthlyManagementFeeEur: 20,
    estimatedPerformanceFeeEur: 0,
    tbillProxyIbTicker: eurMmSym,
    planWeightsProvenance: {
      mode: "model_fallback",
      officialHistoryMonthsLoaded: 0,
      recommendedLineCount: 0,
      planDustExitPct: planExitWeightPct(),
      planEntryMinPct: entryMin,
      planTableConsolidatePct: entryMin,
    },
  };
}

/** Células CSV/UI com ``-`` / ``—`` / ``n/a`` não devem sobrepor meta útil. */
function meaningfulTextCell(x: unknown): string {
  const s = trimmedCell(x);
  if (!s || s === "-" || s === "—" || s.toLowerCase() === "n/a" || s.toLowerCase() === "nan") return "";
  return s;
}

function pickRecommendedSector(p: { sector?: unknown }, metaSector: string | undefined): string {
  const fromMeta = meaningfulTextCell(metaSector);
  const fromPayload = meaningfulTextCell(
    typeof p.sector === "string" ? p.sector : p.sector != null ? String(p.sector) : "",
  );
  return fromMeta || fromPayload || "";
}

function pickRecommendedIndustry(p: { industry?: unknown }, metaIndustry: string | undefined): string {
  const fromMeta = meaningfulTextCell(metaIndustry);
  const fromPayload = meaningfulTextCell(
    typeof p.industry === "string" ? p.industry : p.industry != null ? String(p.industry) : "",
  );
  return fromMeta || fromPayload || "";
}

/** CSV oficial muitas vezes traz sector vazio ou errado; meta CSV pode falhar — builtin ``COMPANY_META`` a seguir. */
function displaySectorTriplet(
  payloadSector: unknown,
  metaSector: string | undefined,
  builtin: ReturnType<typeof lookupCompanyMetaEntry>,
): string {
  return (
    meaningfulTextCell(metaSector) ||
    meaningfulTextCell(builtin?.sector) ||
    meaningfulTextCell(
      typeof payloadSector === "string" ? payloadSector : payloadSector != null ? String(payloadSector) : "",
    )
  );
}

function displayIndustryTriplet(
  payloadIndustry: unknown,
  metaIndustry: string | undefined,
  builtin: ReturnType<typeof lookupCompanyMetaEntry>,
): string {
  return (
    meaningfulTextCell(metaIndustry) ||
    meaningfulTextCell(builtin?.industry) ||
    meaningfulTextCell(
      typeof payloadIndustry === "string"
        ? payloadIndustry
        : payloadIndustry != null
          ? String(payloadIndustry)
          : "",
    )
  );
}

/** Bloco US / EU / JP / CAN / FX do plano — não confundir com país (nome) nem zona geográfica. */
function displayRegionTriplet(
  metaRegion: string | undefined,
  rowBenchZone: unknown,
  rowCountryGroup: unknown,
  builtin: ReturnType<typeof lookupCompanyMetaEntry>,
): string {
  return (
    meaningfulTextCell(metaRegion) ||
    meaningfulTextCell(builtin?.zone) ||
    meaningfulTextCell(typeof rowBenchZone === "string" ? rowBenchZone : "") ||
    meaningfulTextCell(typeof rowCountryGroup === "string" ? rowCountryGroup : "") ||
    ""
  );
}

function fallbackEurMmPriceEur(ticker: string): number {
  const t = ticker.trim().toUpperCase();
  if (t === "CSH2") return 100.0;
  if (t === "XEON") return 52.0;
  return 100.0;
}

const MIN_FX_HEDGE_USD_ORDER_REPORT = Number(
  process.env.DECIDE_MIN_FX_HEDGE_USD || process.env.NEXT_PUBLIC_DECIDE_MIN_FX_HEDGE_USD || 500,
);

function fxHedgeOrderPctFromEnvReport(): number {
  const raw = Number(
    process.env.DECIDE_FX_HEDGE_ORDER_PCT ?? process.env.NEXT_PUBLIC_DECIDE_FX_HEDGE_ORDER_PCT ?? 100,
  );
  return Number.isFinite(raw) ? Math.max(0, Math.min(100, raw)) : 100;
}

function eurusdMidHintReport(): number {
  const raw = Number(process.env.DECIDE_EURUSD_MID_HINT ?? process.env.NEXT_PUBLIC_DECIDE_EURUSD_MID_HINT ?? 1.08);
  return Number.isFinite(raw) && raw > 0 ? raw : 1.08;
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

function benchmarkCsvSpanDays(filePath: string): number {
  const rows = readCsvIfExists(filePath);
  if (rows.length < 2) return 0;
  const t0 = Date.parse(freezeCsvDateKey(String(rows[0]?.date ?? "")));
  const t1 = Date.parse(freezeCsvDateKey(String(rows[rows.length - 1]?.date ?? "")));
  if (!Number.isFinite(t0) || !Number.isFinite(t1)) return 0;
  return Math.round((t1 - t0) / 86_400_000);
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

/** Mesmo host que run-model: em Vercel não há tmp_diag — hidrata NAV/carteira no SSR. */
async function loadIbkrSnapshotFromDecideBackend(): Promise<{
  ok: boolean;
  net_liquidation?: number;
  net_liquidation_ccy?: string;
  account_code?: string;
  cash_ledger?: { value?: number; currency?: string };
  positions?: Array<{
    ticker?: string;
    name?: string;
    sector?: string;
    industry?: string;
    subcategory?: string;
    country?: string;
    zone?: string;
    qty?: number;
    market_price?: number;
    value?: number;
    currency?: string;
    weight_pct?: number;
  }>;
  error?: string;
} | null> {
  const baseRaw =
    process.env.DECIDE_BACKEND_URL ||
    process.env.NEXT_PUBLIC_DECIDE_BACKEND_URL ||
    process.env.BACKEND_URL ||
    process.env.NEXT_PUBLIC_BACKEND_URL ||
    "";
  let base = String(baseRaw || "").trim().replace(/\/+$/, "");
  if (!base) return null;
  if (/\/api$/i.test(base)) base = base.replace(/\/api$/i, "");
  const url = `${base.replace(/\/+$/, "")}/api/ibkr-snapshot`;
  try {
    const ctrl = new AbortController();
    // Partilha orçamento com run-model no mesmo SSR (maxDuration 120s na Vercel).
    const t = setTimeout(() => ctrl.abort(), 45_000);
    const r = await fetch(url, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ paper_mode: true }),
      signal: ctrl.signal,
    });
    clearTimeout(t);
    let data: Record<string, unknown>;
    try {
      data = (await r.json()) as Record<string, unknown>;
    } catch {
      return { ok: false, error: "Resposta IBKR-snapshot não é JSON válido." };
    }
    const positions = data.positions;
    if (!r.ok || data.status !== "ok" || !Array.isArray(positions)) {
      const err =
        (typeof data.error === "string" && data.error) ||
        (typeof data.detail === "string" && data.detail) ||
        `HTTP ${r.status}`;
      return { ok: false, error: err };
    }
    return {
      ok: true,
      net_liquidation: safeNumber(data.net_liquidation, 0),
      net_liquidation_ccy: safeString(data.net_liquidation_ccy, "USD"),
      account_code: safeString(data.account_code, ""),
      cash_ledger:
        data.cash_ledger && typeof data.cash_ledger === "object"
          ? (data.cash_ledger as { value?: number; currency?: string })
          : undefined,
      positions,
    };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

async function loadBackendModel(profile = "moderado", excludedTickers: string[] = []): Promise<{
  payload: any | null;
  error: string;
}> {
  try {
    const ctrl = new AbortController();
    // run-model pode demorar >12s (Vercel→VM, cold start, JSON grande); abort cedo gera "This operation was aborted" sem 4xx na Rede.
    const t = setTimeout(() => ctrl.abort(), 120_000);
    const r = await fetch(buildBackendRunModelUrl(profile, excludedTickers), {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: ctrl.signal,
    });
    clearTimeout(t);

    if (!r.ok) {
      if (r.status === 405) {
        return {
          payload: null,
          error:
            "Backend respondeu 405 (GET não permitido). O URL configurado (DECIDE_BACKEND_URL / BACKEND_URL) aponta para um backend que só aceita POST em /api/run-model (ex.: `server:app` no Docker). Faça deploy com `uvicorn main:app` e a pasta `backend/` completa.",
        };
      }
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

/** engine_v2 devolve `selection` + `series` sem `current_portfolio`; o gráfico espera `equity_raw` alinhado a `equity_overlayed`. */
function normalizeBackendModelPayloadForReport(payload: any | null): any | null {
  if (!payload || typeof payload !== "object") return payload;
  const out: any = { ...payload };
  const prevSeries = out.series && typeof out.series === "object" ? out.series : {};
  const baseSeries = { ...prevSeries };
  const overlayed = baseSeries.equity_overlayed;
  const raw = baseSeries.equity_raw;
  const hasOverlay = Array.isArray(overlayed) && overlayed.length > 0;
  const rawEmpty = !Array.isArray(raw) || raw.length === 0;
  if (hasOverlay && rawEmpty) {
    baseSeries.equity_raw = overlayed.map((x: unknown) => safeNumber(x, 0));
  }
  if (Object.keys(baseSeries).length > 0) {
    out.series = baseSeries;
  }
  if (hasUsableModelPayload(out)) return out;

  const dates = out.series?.dates;
  const sel = out.selection;
  if (!Array.isArray(dates) || dates.length < 50 || !Array.isArray(sel) || sel.length === 0) {
    return out;
  }

  const builtPositions = sel.map((s: any) => ({
    ticker: safeString(s.ticker, "").toUpperCase(),
    weight_pct: safeNumber(s.weight, 0) * 100,
    score: safeNumber(s.score, 0),
    name_short: safeString(s.ticker, ""),
    country: "",
    zone: "",
    region: "",
    sector: "",
    industry: "",
  }));

  return {
    ...out,
    current_portfolio: { positions: builtPositions },
  };
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

/**
 * Horizonte único do relatório: gráfico, CAGR nos cartões e métricas de risco (Sharpe, vol, MDD)
 * alinhados à mesma janela móvel no fim da série.
 */
const DISPLAY_REPORT_YEARS = 20;

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

function freezeCsvDateKey(raw: string): string {
  const s = String(raw ?? "").trim();
  return s.length >= 10 ? s.slice(0, 10) : s;
}

/** Alinhado a `resolve_benchmark_equity_csv_path` no kpi_server (stub em `model_outputs` vs clone completo). */
function resolveFreezeBenchmarkCsvPathForReport(modelOutputsDir: string): string | null {
  const primary = path.join(modelOutputsDir, "benchmark_equity_final_20y.csv");
  const clone = path.join(path.dirname(modelOutputsDir), "model_outputs_from_clone", "benchmark_equity_final_20y.csv");
  const np = readCsvIfExists(primary).length;
  const nc = readCsvIfExists(clone).length;
  const spanP = benchmarkCsvSpanDays(primary);
  const primaryStub = np < 500 || (spanP > 0 && spanP < 400);
  if (nc >= 500 && primaryStub) return clone;
  if (np >= 500 && !primaryStub) return primary;
  if (nc > 0 && (np === 0 || nc > np * 3)) return clone;

  const repoRoot = path.resolve(modelOutputsDir, "..", "..", "..");
  const fallbacks = [
    path.join(repoRoot, "freeze", "DECIDE_MODEL_V5_V2_3_SMOOTH", "model_outputs_from_clone", "benchmark_equity_final_20y.csv"),
    path.join(
      repoRoot,
      "freeze",
      "DECIDE_MODEL_V5_OVERLAY_CAP15_MAX100EXP",
      "model_outputs_from_clone",
      "benchmark_equity_final_20y.csv",
    ),
  ];
  if (primaryStub) {
    for (const fb of fallbacks) {
      if (readCsvIfExists(fb).length >= 500) return fb;
    }
  }
  if (fs.existsSync(primary)) return primary;
  if (fs.existsSync(clone)) return clone;
  return null;
}

function resolveFreezePrimaryModelCsvPathForReport(modelOutputsDir: string): string | null {
  const cloneDir = path.join(path.dirname(modelOutputsDir), "model_outputs_from_clone");
  const candidates = [
    path.join(modelOutputsDir, "model_equity_final_20y_moderado.csv"),
    path.join(modelOutputsDir, "model_equity_final_20y.csv"),
    path.join(cloneDir, "model_equity_final_20y_moderado.csv"),
    path.join(cloneDir, "model_equity_final_20y.csv"),
  ];
  for (const p of candidates) {
    if (readCsvIfExists(p).length >= 500) return p;
  }
  return null;
}

/** Teórico (`model_equity_theoretical_20y.csv`) se existir; senão série base do modelo. */
function resolveFreezeTheoreticalOrRawCsvForReport(modelOutputsDir: string): string | null {
  const cloneDir = path.join(path.dirname(modelOutputsDir), "model_outputs_from_clone");
  const theoretical = path.join(modelOutputsDir, "model_equity_theoretical_20y.csv");
  if (readCsvIfExists(theoretical).length >= 500) return theoretical;
  const base = path.join(modelOutputsDir, "model_equity_final_20y.csv");
  if (readCsvIfExists(base).length >= 500) return base;
  const cb = path.join(cloneDir, "model_equity_final_20y.csv");
  if (readCsvIfExists(cb).length >= 500) return cb;
  return null;
}

/**
 * Quando o motor em 8090 está offline, usa o snapshot em
 * `freeze/<FREEZE_PLAFONADO_MODEL_DIR>/model_outputs/` (CAP15 plafonado, V2.3 smooth).
 */
function loadFreezeRunModelSnapshot(projectRoot: string): any | null {
  const dir = path.join(projectRoot, "freeze", FREEZE_PLAFONADO_MODEL_DIR, "model_outputs");
  const pfPath = path.join(dir, "portfolio_final.json");
  const overlayPath = path.join(dir, "equity_overlayed.json");
  const kpisPath = path.join(dir, "v5_kpis.json");

  const benchPath = resolveFreezeBenchmarkCsvPathForReport(dir);
  const modelPath = resolveFreezePrimaryModelCsvPathForReport(dir);
  const rawPathResolved = resolveFreezeTheoreticalOrRawCsvForReport(dir);

  if (!fs.existsSync(pfPath) || !benchPath || !modelPath || !rawPathResolved) {
    return null;
  }

  const pf = readJsonIfExists<{ holdings?: unknown[] }>(pfPath);
  const kpisMeta = readJsonIfExists<Record<string, unknown>>(kpisPath);
  const benchRows = readCsvIfExists(benchPath);
  const modelRows = readCsvIfExists(modelPath);
  const rawRows = readCsvIfExists(rawPathResolved);

  const benchByDate = new Map<string, number>();
  for (const row of benchRows) {
    const dk = freezeCsvDateKey(String(row.date ?? ""));
    const v = safeNumber(Number(row.benchmark_equity), 0);
    if (dk && v > 0) benchByDate.set(dk, v);
  }

  const rawByDate = new Map<string, number>();
  for (const row of rawRows) {
    const dk = freezeCsvDateKey(String(row.date ?? ""));
    const v = safeNumber(Number(row.model_equity), 0);
    if (dk && v > 0) rawByDate.set(dk, v);
  }

  let overlayed: number[] = [];
  if (fs.existsSync(overlayPath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(overlayPath, "utf8")) as unknown;
      if (Array.isArray(raw)) overlayed = raw.map((x) => safeNumber(Number(x), 0));
    } catch {
      overlayed = [];
    }
  }

  const holdings = Array.isArray(pf?.holdings) ? pf!.holdings! : [];
  if (holdings.length === 0) return null;

  const dates: string[] = [];
  const benchmark_equity: number[] = [];
  const equity_raw: number[] = [];
  const equity_overlayed: number[] = [];

  let lastBench = 0;
  let lastRaw = 0;
  for (let i = 0; i < modelRows.length; i += 1) {
    const m = modelRows[i];
    const dk = freezeCsvDateKey(String(m?.date ?? ""));
    if (!dk) continue;
    const meq = safeNumber(Number(m?.model_equity), 0);
    if (!(meq > 0)) continue;
    if (benchByDate.has(dk)) lastBench = benchByDate.get(dk) ?? lastBench;
    if (rawByDate.has(dk)) lastRaw = rawByDate.get(dk) ?? lastRaw;
    if (!(lastBench > 0)) continue;

    dates.push(dk);
    benchmark_equity.push(lastBench);
    equity_overlayed.push(meq);
    equity_raw.push(lastRaw > 0 ? lastRaw : meq);
  }

  const n = dates.length;
  if (n < 500) return null;

  if (overlayed.length >= n) {
    for (let i = 0; i < n; i += 1) {
      equity_overlayed[i] = safeNumber(overlayed[i], equity_overlayed[i]);
    }
  }

  const positions = holdings.map((h: any) => ({
    ticker: safeString(h?.ticker, "").toUpperCase(),
    name_short: safeString(h?.company ?? h?.ticker, h?.ticker),
    country: safeString(h?.country || h?.domicile_country, ""),
    zone: safeString(h?.geo_zone || h?.continent, ""),
    region: safeString(h?.region || h?.country_group || h?.zone, ""),
    sector: safeString(h?.sector, ""),
    industry: safeString(h?.industry || h?.gics_sub_industry, ""),
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
      data_source: "freeze_local_fallback_cap15_v23_smooth",
      model_name: FREEZE_PLAFONADO_MODEL_DIR,
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

export const getClientReportServerSideProps: GetServerSideProps<PageProps> = async (ctx) => {
  if (ctx.res) {
    ctx.res.setHeader("Cache-Control", "private, no-store, max-age=0, must-revalidate");
  }
  try {
    return await getClientReportServerSidePropsImpl(ctx);
  } catch (e: unknown) {
    console.error("[client/report getServerSideProps]", e);
    const msg =
      e instanceof Error
        ? `${e.name}: ${e.message}`
        : typeof e === "string"
          ? e
          : "Erro desconhecido no servidor ao montar o plano.";
    return { props: { reportData: buildSsrFailureReportData(msg) } };
  }
};

async function getClientReportServerSidePropsImpl(
  ctx: GetServerSidePropsContext,
): Promise<{ props: PageProps }> {
  const frontRoot = process.cwd();
  /** Evita `..` errado quando o Next corre com `cwd` = raiz do monorepo (não `frontend/`). */
  const projectRoot = resolveDecideProjectRoot(frontRoot);
  const tmpDir = path.join(projectRoot, "tmp_diag");
  const eurMmSym = eurMmIbTicker();

  const smokePath = path.join(tmpDir, "ibkr_paper_smoke_test.json");
  const statusPath = path.join(tmpDir, "ibkr_order_status_and_cancel.json");
  const tradePlanPath = path.join(tmpDir, "decide_trade_plan_ibkr.csv");
  const companyMetaPath = path.join(projectRoot, "backend", "data", "company_meta_combined.csv");
  const companyMetaV3Path = path.join(projectRoot, "backend", "data", "company_meta_v3.csv");
  const companyMetaGlobalPath = path.join(projectRoot, "backend", "data", "company_meta_global.csv");
  const companyMetaGlobalEnrichedPath = path.join(
    projectRoot,
    "backend",
    "data",
    "company_meta_global_enriched.csv",
  );

  const smokeJson = readJsonIfExists<any>(smokePath);
  const statusJson = readJsonIfExists<any>(statusPath);
  const tradePlanRows = readCsvIfExists(tradePlanPath);
  const companyMetaRows = readCsvIfExists(companyMetaPath);
  const companyMetaV3Rows = readCsvIfExists(companyMetaV3Path);
  const companyMetaGlobalRows = readCsvIfExists(companyMetaGlobalPath);
  const companyMetaGlobalEnrichedRows = readCsvIfExists(companyMetaGlobalEnrichedPath);

  type RowMeta = {
    sector: string;
    region: string;
    nameShort: string;
    industry: string;
    country: string;
    geoZone: string;
  };
  const emptyMeta = (): RowMeta => ({
    sector: "",
    region: "",
    nameShort: "",
    industry: "",
    country: "",
    geoZone: "",
  });
  const metaByTicker = new Map<string, RowMeta>();
  const upsertMeta = (row: Record<string, string>) => {
    const tRaw = safeString(row.ticker || row.symbol).toUpperCase();
    const t = normalizeTickerKey(tRaw);
    if (!t) return;
    const curr = metaByTicker.get(t) || emptyMeta();
    const sectorFromRow = meaningfulTextCell(row.sector || row.gics_sector || row.sector_name);
    const industryFromRow = meaningfulTextCell(row.industry || row.gics_sub_industry || row.sub_industry || "");
    const nameCandidate = trimmedCell(row.name_short || row.name || row.company || "");
    const nameWeak =
      !nameCandidate ||
      normalizeTickerKey(nameCandidate) === t ||
      normalizeTickerKey(nameCandidate) === exclusionTickerGroup(t);
    const nextName = nameWeak ? curr.nameShort || nameCandidate : nameCandidate;
    const regionCandidate = meaningfulTextCell(
      row.region || row.benchmark_zone || row.country_group || row.zone || "",
    );
    const countryFromRow = meaningfulTextCell(
      row.country || row.domicile_country || row.country_name || row.incorporation_country || "",
    );
    const geoFromRow = meaningfulTextCell(
      row.geo_zone || row.continent || row.continent_pt || row.zone_label || "",
    );
    const next = {
      sector: sectorFromRow || curr.sector,
      region: regionCandidate || curr.region,
      nameShort: nextName,
      industry: industryFromRow || curr.industry,
      country: countryFromRow || curr.country,
      geoZone: geoFromRow || curr.geoZone,
    };
    metaByTicker.set(t, next);
    // Also index the dot/dash variant to avoid lookup misses (e.g. BRK.B vs BRK-B).
    const alt = t.includes("-") ? t.replace(/-/g, ".") : t.replace(/\./g, "-");
    if (alt && alt !== t) metaByTicker.set(alt, next);
  };
  for (const row of companyMetaGlobalRows) upsertMeta(row);
  for (const row of companyMetaGlobalEnrichedRows) upsertMeta(row);
  for (const row of companyMetaV3Rows) upsertMeta(row);
  for (const row of companyMetaRows) upsertMeta(row);
  /** Por último: CSVs frequentemente trazem ``-`` ou sectores errados; o builtin prevalece onde definido. */
  seedMetaMapFromCompanyMeta(upsertMeta);

  const brkMeta: RowMeta = {
    sector: "Conglomerados / Holdings financeiros",
    region: "US",
    nameShort: "Berkshire Hathaway (Classe B)",
    industry: "Holding multi-setor (seguros, energia, transportes)",
    country: "Estados Unidos",
    geoZone: "",
  };
  {
    const nk = normalizeTickerKey("BRK.B");
    const cur = metaByTicker.get(nk) || emptyMeta();
    const merged: RowMeta = {
      sector: cur.sector || brkMeta.sector,
      region: cur.region || brkMeta.region,
      industry: cur.industry || brkMeta.industry,
      nameShort:
        cur.nameShort && cur.nameShort !== nk && cur.nameShort !== "BRK.B"
          ? cur.nameShort
          : brkMeta.nameShort,
      country: cur.country || brkMeta.country,
      geoZone: cur.geoZone || brkMeta.geoZone,
    };
    metaByTicker.set(nk, merged);
    metaByTicker.set("BRK.B", merged);
  }

  const metaKeyCandidates = (ticker: string): string[] => {
    const raw = String(ticker || "").trim();
    const k = normalizeTickerKey(raw);
    const out: string[] = [];
    const push = (x: string) => {
      const nk = normalizeTickerKey(x);
      if (nk && !out.includes(nk)) out.push(nk);
    };
    push(k);
    if (k.includes("-")) push(k.replace(/-/g, "."));
    else if (k.includes(".")) push(k.replace(/\./g, "-"));

    const jpNorm = normalizeJpListingKey(raw);
    if (isJpNumericListingTicker(jpNorm)) {
      push(jpNorm);
      push(normalizeTickerKey(jpNorm));
      push(remapJpListingToAdrTicker(jpNorm));
    }

    const listingFromAdr = remapAdrToJpListingTicker(k);
    if (listingFromAdr) {
      push(listingFromAdr);
      push(normalizeTickerKey(listingFromAdr));
    }
    return out;
  };

  const metaForTicker = (ticker: string) => {
    const useful = (m: RowMeta | undefined) =>
      Boolean(
        m &&
          (meaningfulTextCell(m.sector) ||
            meaningfulTextCell(m.region) ||
            meaningfulTextCell(m.nameShort) ||
            meaningfulTextCell(m.industry) ||
            meaningfulTextCell(m.country) ||
            meaningfulTextCell(m.geoZone)),
      );

    for (const key of metaKeyCandidates(ticker)) {
      const m = metaByTicker.get(key);
      if (useful(m)) return m;
    }

    const k = normalizeTickerKey(ticker);
    const compact = k.replace(/\s+/g, "");
    if (compact === "BRKB" || k.trim().toUpperCase() === "BRK B") {
      return metaByTicker.get("BRK-B") ?? metaByTicker.get("BRK.B");
    }
    return undefined;
  };

  // "Last close" prices (for the "Preço" column). We only read the header + last line.
  const pricesClosePath = path.join(projectRoot, "backend", "data", "prices_close.csv");
  let closeAsOfDate = "";
  const closePricesByTicker = new Map<string, number>();
  const priceCsvHeaderColsUpper = new Set<string>();

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
          priceCsvHeaderColsUpper.add(col.trim().toUpperCase());
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
  supplementClosePricesMapFromLegacyWideCsv(closePricesByTicker, projectRoot);

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
  modelPayload = normalizeBackendModelPayloadForReport(modelPayload);
  if (!hasUsableModelPayload(modelPayload)) {
    const snap = loadFreezeRunModelSnapshot(projectRoot);
    if (snap) {
      modelPayload = snap;
      backendError = "";
    } else if (!backendError) {
      backendError = "Dados do backend incompletos (sem carteira/série).";
    }
  }

  let navEur = safeNumber(
    smokeJson?.selected?.netLiquidation?.value ??
      smokeJson?.attempts?.[0]?.netLiquidation?.value,
    0
  );

  const netLiqCurrency = (o: Record<string, unknown> | undefined): string => {
    const nl = o?.netLiquidation;
    if (nl && typeof nl === "object" && nl !== null && "currency" in nl) {
      return safeString((nl as { currency?: string }).currency, "").trim().toUpperCase();
    }
    return "";
  };
  const sel = smokeJson?.selected as Record<string, unknown> | undefined;
  const att0 = smokeJson?.attempts?.[0] as Record<string, unknown> | undefined;
  let accountBaseCurrency =
    netLiqCurrency(sel) || netLiqCurrency(att0) || "EUR";

  let cashEur = safeNumber(
    smokeJson?.selected?.cash?.value ?? smokeJson?.attempts?.[0]?.cash?.value,
    0
  );

  let accountCode = safeString(
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

  let actualPositions: ActualPosition[] = rawPositions.map((p: any) => {
    const ticker = safeString(p.ticker ?? p.symbol).toUpperCase();
    const qty = safeNumber(p.position ?? p.qty, 0);
    const tradePlanRow = tradePlanByTicker.get(ticker);
    const marketPrice = safeNumber(tradePlanRow?.market_price, 0);
    const value = qty * marketPrice;
    const weightPct = navEur > 0 ? (value / navEur) * 100 : 0;
    const closePrice = getClosePrice(ticker);
    const m = metaForTicker(ticker);
    const nameShort = pickBestDisplayName(
      ticker,
      safeString(p.name ?? p.companyName ?? p.short_name, ""),
      safeString(m?.nameShort, ""),
    );
    const sector = trimmedCell(m?.sector) || trimmedCell(p.sector ?? p.gics_sector);
    const industry = trimmedCell(m?.industry) || trimmedCell(p.industry ?? p.subcategory);
    let country = trimmedCell(p.country) || trimmedCell(m?.country);
    let zoneGeo = trimmedCell(p.zone) || trimmedCell(m?.geoZone);
    let regionBench = trimmedCell(m?.region);
    let sectorOut = sector;
    const jpPatch = applyJapaneseEquityDisplayFallback(ticker, {
      country,
      zone: zoneGeo,
      region: regionBench,
      sector: sectorOut,
    });
    country = trimmedCell(jpPatch.country) || country;
    zoneGeo = trimmedCell(jpPatch.zone) || zoneGeo;
    regionBench = trimmedCell(jpPatch.region) || regionBench;
    sectorOut = trimmedCell(jpPatch.sector) || sectorOut;

    return {
      ticker,
      nameShort,
      sector: sectorOut,
      industry,
      country,
      zone: zoneGeo,
      region: regionBench,
      qty,
      marketPrice,
      closePrice: closePrice > 0 ? closePrice : null,
      value,
      weightPct,
      currency: safeString(p.currency, safeString(tradePlanRow?.currency, "USD")),
    };
  });

  actualPositions.sort((a, b) => b.value - a.value);

  let initialIbkrStructure: LiveIbkrStructure | null = null;
  if (navEur <= 0 && actualPositions.length === 0) {
    const ib = await loadIbkrSnapshotFromDecideBackend();
    if (ib?.ok && Array.isArray(ib.positions)) {
      const navCcy = safeString(ib.net_liquidation_ccy, "USD");
      const nav = safeNumber(ib.net_liquidation, 0);
      navEur = nav;
      accountBaseCurrency = navCcy || accountBaseCurrency;
      accountCode = safeString(ib.account_code, accountCode);
      const cl = ib.cash_ledger;
      if (cl && typeof cl.value === "number" && Number.isFinite(cl.value)) {
        cashEur = safeNumber(cl.value, 0);
      }
      const grossPositionsValue = ib.positions.reduce(
        (acc, p) => acc + Math.abs(safeNumber(p.value, 0)),
        0,
      );
      let financing = 0;
      let financingCcy = navCcy;
      if (
        cl &&
        typeof cl.value === "number" &&
        Number.isFinite(cl.value) &&
        Math.abs(cl.value) > 1e-4
      ) {
        financing = cl.value;
        financingCcy = safeString(cl.currency, navCcy);
      }
      initialIbkrStructure = {
        netLiquidation: nav,
        ccy: navCcy,
        grossPositionsValue,
        financing,
        financingCcy,
      };
      actualPositions = ib.positions.map((p) => {
        const ticker = safeString(p.ticker, "").toUpperCase();
        const qty = safeNumber(p.qty, 0);
        const marketPrice = safeNumber(p.market_price, 0);
        const value = safeNumber(p.value, qty * marketPrice);
        const weightPct = nav > 0 ? (value / nav) * 100 : 0;
        const closePrice = getClosePrice(ticker);
        const m = metaForTicker(ticker);
        const nameShort = pickBestDisplayName(
          ticker,
          safeString(p.name, ""),
          safeString(m?.nameShort, ""),
        );
        const sector = trimmedCell(m?.sector) || trimmedCell(p.sector);
        const industry = trimmedCell(m?.industry) || trimmedCell(p.industry ?? p.subcategory);
        let country = trimmedCell(p.country) || trimmedCell(m?.country);
        let zoneGeo = trimmedCell(p.zone) || trimmedCell(m?.geoZone);
        let regionBench = trimmedCell(m?.region);
        let sectorOut = sector;
        const jpPatch = applyJapaneseEquityDisplayFallback(ticker, {
          country,
          zone: zoneGeo,
          region: regionBench,
          sector: sectorOut,
        });
        country = trimmedCell(jpPatch.country) || country;
        zoneGeo = trimmedCell(jpPatch.zone) || zoneGeo;
        regionBench = trimmedCell(jpPatch.region) || regionBench;
        sectorOut = trimmedCell(jpPatch.sector) || sectorOut;
        return {
          ticker,
          nameShort,
          sector: sectorOut,
          industry,
          country,
          zone: zoneGeo,
          region: regionBench,
          qty,
          marketPrice,
          closePrice: closePrice > 0 ? closePrice : null,
          value,
          weightPct,
          currency: safeString(p.currency, navCcy),
        };
      });
      if (
        cl &&
        typeof cl.value === "number" &&
        Number.isFinite(cl.value) &&
        Math.abs(cl.value) > 1e-4
      ) {
        actualPositions.push({
          ticker: "LIQUIDEZ",
          nameShort: "Caixa e equivalentes",
          sector: "Liquidez",
          industry: "",
          country: "",
          zone: "",
          region: "",
          qty: 0,
          marketPrice: 0,
          closePrice: null,
          value: cl.value,
          weightPct: nav > 0 ? (cl.value / nav) * 100 : 0,
          currency: financingCcy,
        });
      }
      actualPositions.sort((a, b) => b.value - a.value);
    }
  }

  const cashSleeveFracRawModel = safeNumber(
    modelPayload?.kpis?.latest_cash_sleeve ??
      modelPayload?.meta?.latest_cash_sleeve ??
      modelPayload?.summary?.latest_cash_sleeve,
    0
  );
  let cashSleeveFrac =
    cashSleeveFracRawModel >= 0 && cashSleeveFracRawModel <= 0.95 ? cashSleeveFracRawModel : 0;

  const builtWeights = buildOfficialRecommendationMonthsThroughToday(projectRoot);
  const officialMonth = builtWeights
    ? pickPlanMonthPreferringTodayFromMonths(builtWeights.months)
    : null;
  const preferLiveWeights = shouldUseLiveModelWeightsInsteadOfOfficialBook(officialMonth, modelPayload);
  let planTargetRebalanceDate: string | undefined;

  let recommendedRaw: RecommendedPosition[];
  if (!preferLiveWeights && officialMonth?.rows?.length) {
    planTargetRebalanceDate = String(officialMonth.date || "").slice(0, 10);
    const cashFromRows = sumCashSleeveWeight(officialMonth.rows);
    if (cashFromRows >= 0 && cashFromRows <= 0.95) {
      cashSleeveFrac = cashFromRows;
    }
    recommendedRaw = officialMonth.rows
      .filter((row) => Boolean(safeString((row as { ticker?: unknown })?.ticker, "").trim()))
      .map((row) => {
      const t = remapJpListingToAdrTicker(safeString(row.ticker, "").trim().toUpperCase());
      const m = metaForTicker(t);
      const b = lookupCompanyMetaEntry(t);
      const rowAny = row as {
        zone?: string;
        country?: string;
        country_group?: string;
        industry?: string;
        geo_zone?: string;
      };
      return {
        ticker: t,
        nameShort: pickBestDisplayName(
          t,
          safeString(row.company || row.ticker, row.ticker),
          safeString(m?.nameShort, b?.name ?? ""),
        ),
        region: displayRegionTriplet(m?.region, rowAny.zone, rowAny.country_group, b),
        country:
          meaningfulTextCell(rowAny.country) ||
          meaningfulTextCell(m?.country) ||
          (b?.country ?? ""),
        geoZone: meaningfulTextCell(rowAny.geo_zone) || meaningfulTextCell(m?.geoZone) || "",
        sector: displaySectorTriplet(row.sector, m?.sector, b),
        industry: displayIndustryTriplet(rowAny.industry, m?.industry, b),
        score: safeNumber(row.score, 0),
        weightPct: safeNumber(row.weightPct, 0),
        originalWeightPct: safeNumber(row.weightPct, 0),
        excluded: false,
      };
    });
  } else {
    const investedFrac = 1 - cashSleeveFrac;
    recommendedRaw = Array.isArray(modelPayload?.current_portfolio?.positions)
      ? modelPayload.current_portfolio.positions.map((p: any) => ({
          ticker: (() => {
            const t = remapJpListingToAdrTicker(safeString(p.ticker).toUpperCase());
            return t;
          })(),
          nameShort: (() => {
            const t = remapJpListingToAdrTicker(safeString(p.ticker).toUpperCase());
            const m = metaForTicker(t);
            const b = lookupCompanyMetaEntry(t);
            return pickBestDisplayName(
              t,
              safeString(p.name_short || p.short_name || p.ticker),
              safeString(m?.nameShort, b?.name ?? ""),
            );
          })(),
          region: (() => {
            const t = remapJpListingToAdrTicker(safeString(p.ticker).toUpperCase());
            const m = metaForTicker(t);
            const b = lookupCompanyMetaEntry(t);
            return displayRegionTriplet(
              m?.region,
              (p as { zone?: unknown }).zone,
              (p as { country_group?: unknown }).country_group,
              b,
            );
          })(),
          country: (() => {
            const t = remapJpListingToAdrTicker(safeString(p.ticker).toUpperCase());
            const m = metaForTicker(t);
            const b = lookupCompanyMetaEntry(t);
            const pc = (p as { country?: unknown }).country;
            return (
              meaningfulTextCell(typeof pc === "string" ? pc : "") ||
              meaningfulTextCell(m?.country) ||
              (b?.country ?? "")
            );
          })(),
          geoZone: (() => {
            const t = remapJpListingToAdrTicker(safeString(p.ticker).toUpperCase());
            const m = metaForTicker(t);
            const gz = (p as { geo_zone?: unknown }).geo_zone;
            return meaningfulTextCell(typeof gz === "string" ? gz : "") || meaningfulTextCell(m?.geoZone) || "";
          })(),
          sector: (() => {
            const t = remapJpListingToAdrTicker(safeString(p.ticker).toUpperCase());
            const m = metaForTicker(t);
            const b = lookupCompanyMetaEntry(t);
            return displaySectorTriplet(p.sector, m?.sector, b);
          })(),
          industry: (() => {
            const t = remapJpListingToAdrTicker(safeString(p.ticker).toUpperCase());
            const m = metaForTicker(t);
            const b = lookupCompanyMetaEntry(t);
            return displayIndustryTriplet(p.industry, m?.industry, b);
          })(),
          score: safeNumber(p.score, 0),
          weightPct: safeNumber(p.weight_pct, 0) * investedFrac,
          originalWeightPct: safeNumber(p.weight_pct, 0) * investedFrac,
          excluded: false,
        }))
      : [];
    planTargetRebalanceDate =
      modelPayloadAsOfDateYmd(modelPayload) ?? planTargetRebalanceDate;
  }

  // Remover duplicados exatos por ticker (mantém o maior peso).
  const dedupByTicker = new Map<string, RecommendedPosition>();
  for (const p of recommendedRaw) {
    const k = exclusionTickerGroup(normalizeTickerKey(p.ticker));
    const prev = dedupByTicker.get(k);
    if (!prev || safeNumber(p.weightPct, 0) > safeNumber(prev.weightPct, 0)) {
      dedupByTicker.set(k, { ...p, ticker: k });
    }
  }
  const recommendedRawUnique = stripPlanBenchmarkIndexRows(Array.from(dedupByTicker.values()));

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
    recommendedPositions[tbillIdx].industry = "";
    recommendedPositions[tbillIdx].region = recommendedPositions[tbillIdx].region || "US";
    recommendedPositions[tbillIdx].country = recommendedPositions[tbillIdx].country || "";
    recommendedPositions[tbillIdx].geoZone = recommendedPositions[tbillIdx].geoZone || "";
    recommendedPositions[tbillIdx].weightPct = safeNumber(
      recommendedPositions[tbillIdx].weightPct,
      0
    );
  } else {
    recommendedPositions.push({
      ticker: "TBILL_PROXY",
      nameShort: "T-Bills / Cash Sleeve",
      region: "US",
      country: "",
      geoZone: "",
      sector: "Cash & T-Bills",
      industry: "",
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

  {
    const isPlanWeightProtected = (p: (typeof recommendedPositions)[number]) =>
      p.ticker === "TBILL_PROXY" || !!p.excluded;
    const benchZones = benchmarkZoneWeightsFromPriceHeaders(priceCsvHeaderColsUpper, undefined);
    const zoneForConcentration = (ticker: string, prefRegion: string): "US" | "EU" | "JP" | "CAN" | "OTHER" => {
      const r =
        meaningfulTextCell(prefRegion) || meaningfulTextCell(metaForTicker(ticker)?.region);
      let z = canonZoneForCountryCap(r);
      if (z !== "OTHER") return z;
      const nk = normalizeTickerKey(ticker);
      if (remapAdrToJpListingTicker(nk)) return "JP";
      if (isJpNumericListingTicker(normalizeJpListingKey(ticker))) return "JP";
      if (/[-.]PA$/i.test(ticker.trim())) return "EU";
      return "OTHER";
    };
    const zoneByTicker = new Map<string, "US" | "EU" | "JP" | "CAN" | "OTHER">();
    for (const p of recommendedPositions) {
      if (isPlanWeightProtected(p)) continue;
      const z = zoneForConcentration(p.ticker, p.region);
      if (z !== "OTHER") zoneByTicker.set(p.ticker.trim().toUpperCase(), z);
    }
    applyZoneCapsVsBenchmark(
      recommendedPositions,
      zoneByTicker,
      benchZones,
      planZoneCapMultiplier(),
      isPlanWeightProtected,
    );
    /* Grelha do plano: fundir linhas < **entrada** (1% por defeito). O limiar de saída 0,5% aplica-se a outras regras (env). */
    consolidateWeightsBelowMinimum(recommendedPositions, planEntryMinWeightPct(), isPlanWeightProtected);
    recommendedPositions.sort((a, b) => b.weightPct - a.weightPct);
  }

  for (let i = recommendedPositions.length - 1; i >= 0; i -= 1) {
    const p = recommendedPositions[i];
    if (p.excluded) continue;
    const u = p.ticker.trim().toUpperCase();
    if (u === "TBILL_PROXY") continue;
    if (safeNumber(p.weightPct, 0) <= 1e-6) recommendedPositions.splice(i, 1);
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
  const entryMinPct = planEntryMinWeightPct();
  for (const r of recommendedPositions) {
    if (
      r.ticker === "TBILL_PROXY" ||
      safeNumber(r.weightPct, 0) <= 0 ||
      proposedByTicker.has(exclusionTickerGroup(normalizeTickerKey(r.ticker)))
    ) {
      continue;
    }
    /* Entrada: só linha BUY sugerida se alvo **estritamente** > mínimo (default 1%). */
    if (!(safeNumber(r.weightPct, 0) > entryMinPct + 1e-12)) continue;
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
      nameShort: a.nameShort || a.ticker,
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

  fillSyntheticEquityBuyQuantities(proposedTrades, navEur, getClosePrice);

  // Sleeve caixa do modelo (TBILL_PROXY no JSON) → ordens como UCITS MM em EUR (`EUR_MM_PROXY` → CSH2/XEON).
  {
    for (let i = proposedTrades.length - 1; i >= 0; i -= 1) {
      if (proposedTrades[i].ticker === "TBILL_PROXY") proposedTrades.splice(i, 1);
    }
    const tbillW = tbillPos ? safeNumber(tbillPos.weightPct, 0) : 0;
    if (tbillW > 0 && navEur > 0) {
      const pxRaw = getClosePrice(eurMmSym) || getClosePrice("EUR_MM_PROXY");
      const pxEur = pxRaw > 0 ? pxRaw : fallbackEurMmPriceEur(eurMmSym);
      const notional = (tbillW / 100) * navEur;
      const q = Math.max(1, Math.floor(notional / pxEur));
      const existing = proposedTrades.find((t) => t.ticker === "EUR_MM_PROXY");
      if (existing) {
        if (existing.side === "INACTIVE") {
          /* reservado */
        } else {
          existing.side = "BUY";
          existing.ticker = "EUR_MM_PROXY";
          existing.absQty = Math.max(safeNumber(existing.absQty, 0), q);
          existing.marketPrice = pxEur;
          existing.closePrice = pxEur > 0 ? pxEur : null;
          existing.deltaValueEst = notional;
          existing.targetWeightPct = tbillW;
          existing.nameShort = `MM EUR / caixa (${eurMmSym})`;
        }
      } else {
        proposedTrades.push({
          ticker: "EUR_MM_PROXY",
          side: "BUY",
          absQty: q,
          marketPrice: pxEur,
          closePrice: pxEur > 0 ? pxEur : null,
          deltaValueEst: notional,
          targetWeightPct: tbillW,
          nameShort: `MM EUR / caixa (${eurMmSym})`,
        });
      }
    }
  }

  {
    const hedgeUsdRaw = estimateUsdNotionalForBuyFxHedge(proposedTrades as ProposedTrade[]);
    const pct = fxHedgeOrderPctFromEnvReport();
    const hedgeUsd = (hedgeUsdRaw * pct) / 100;
    if (hedgeUsd >= MIN_FX_HEDGE_USD_ORDER_REPORT) {
      const mid = eurusdMidHintReport();
      const eurQty = Math.round((hedgeUsd / mid) * 100) / 100;
      if (eurQty >= 1) {
        proposedTrades.push({
          ticker: "EURUSD",
          side: "BUY",
          absQty: eurQty,
          marketPrice: mid,
          closePrice: mid,
          deltaValueEst: hedgeUsd,
          targetWeightPct: 0,
          nameShort: "Hedge cambial EUR.USD (IDEALPRO)",
        });
      }
    }
  }

  proposedTrades.sort((a, b) => Math.abs(b.deltaValueEst) - Math.abs(a.deltaValueEst));

  // Carteira recomendada (UI): o modelo usa TBILL_PROXY no JSON; na execução vira MM EUR (UCITS). Mostrar CSH2/XEON + EURUSD quando existir hedge no plano.
  {
    const tbIdx = recommendedPositions.findIndex((p) => p.ticker === "TBILL_PROXY");
    if (tbIdx >= 0) {
      const prev = recommendedPositions[tbIdx];
      const w = safeNumber(prev.weightPct, 0);
      const ow = safeNumber(prev.originalWeightPct, w);
      const excl = prev.excluded;
      recommendedPositions.splice(tbIdx, 1);
      recommendedPositions.push({
        ticker: eurMmSym,
        nameShort: `MM EUR / caixa (${eurMmSym})`,
        region: "EU",
        country: "",
        geoZone: "",
        sector: "Money market UCITS (EUR)",
        industry: "",
        score: 0,
        weightPct: w,
        originalWeightPct: ow,
        excluded: excl,
      });
    }
    const fxRow = proposedTrades.find((t) => t.ticker === "EURUSD");
    if (fxRow && navEur > 0) {
      const hedgeUsd = safeNumber(fxRow.deltaValueEst, 0);
      const wFx = capPctDisplay((hedgeUsd / navEur) * 100);
      recommendedPositions.push({
        ticker: "EURUSD",
        nameShort: fxRow.nameShort || "Hedge cambial EUR.USD (IDEALPRO)",
        region: "FX",
        country: "",
        geoZone: "",
        sector: "Cobertura cambial (operacional)",
        industry: "",
        score: 0,
        weightPct: wFx,
        originalWeightPct: wFx,
        excluded: false,
      });
    }
    recommendedPositions.sort((a, b) => b.weightPct - a.weightPct);
  }

  {
    const skipDisplayEnrich = (t: string) => {
      const u = t.trim().toUpperCase();
      if (u === "EURUSD" || u === "EUR_MM_PROXY") return true;
      if (u === eurMmSym.trim().toUpperCase()) return true;
      return false;
    };
    for (const p of recommendedPositions) {
      if (skipDisplayEnrich(p.ticker)) continue;
      const m = metaForTicker(p.ticker);
      const b = lookupCompanyMetaEntry(p.ticker);
      if (!meaningfulTextCell(p.sector)) {
        p.sector = pickRecommendedSector({ sector: p.sector }, m?.sector) || (b?.sector ?? "");
      }
      if (!meaningfulTextCell(p.industry)) {
        p.industry = pickRecommendedIndustry({}, m?.industry) || (b?.industry ?? "");
      }
      if (!meaningfulTextCell(p.region)) {
        p.region =
          meaningfulTextCell(m?.region) ||
          (b?.zone ?? "") ||
          (() => {
            if (remapAdrToJpListingTicker(normalizeTickerKey(p.ticker))) return "JP";
            if (isJpNumericListingTicker(normalizeJpListingKey(p.ticker))) return "JP";
            if (/[-.]PA$/i.test(p.ticker.trim())) return "EU";
            return "";
          })();
      }
      if (!meaningfulTextCell(p.country)) {
        p.country = meaningfulTextCell(m?.country) || (b?.country ?? "");
      }
      if (!meaningfulTextCell(p.geoZone)) {
        p.geoZone = meaningfulTextCell(m?.geoZone) || "";
      }
      if (
        !meaningfulTextCell(p.nameShort) ||
        normalizeTickerKey(p.nameShort) === normalizeTickerKey(p.ticker)
      ) {
        p.nameShort = pickBestDisplayName(
          p.ticker,
          p.nameShort || p.ticker,
          safeString(m?.nameShort, b?.name ?? ""),
        );
      }
    }
  }

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
  const hStart = n >= 50 ? findHorizonStartIdx(dates, n, DISPLAY_REPORT_YEARS) : 0;
  const ySpanCagr = n >= 2 ? yearsSpanBetween(dates, hStart, n - 1) : 0;

  const benchW = benchmark.slice(hStart, n);
  const ovrW = overlayed.slice(hStart, n);

  const profileLabel = safeString(modelPayload?.meta?.profile, "moderado");
  const kpiProfile = normalizeRiskProfileForKpi(profileLabel);
  /** Mesma regra que `/api/client/plan-decision-kpis` e o cartão no dashboard. */
  const planPlafonado = kpiProfile === "conservador" || kpiProfile === "moderado";

  const overlayModelCagrPct = capPctDisplay(cagrPctFromEquityWindow(ovrW, ySpanCagr));
  const overlayBenchmarkCagrPct = capPctDisplay(cagrPctFromEquityWindow(benchW, ySpanCagr));

  const { recommendedCagrPct: cagrFromModel } = await loadApprovalAlignedProposedTrades(projectRoot);
  const freezeHero = readHeroKpiFreezeContext(projectRoot);
  const embedModelKpis = await fetchPlafonadoKpisFromKpiServer(kpiProfile);

  const plafonadoCardCagrFromFiles =
    readPlafonadoM100CagrDisplayPercent(projectRoot, kpiProfile) ??
    readLandingEmbeddedFreezeCap15CagrDisplayPercent(frontRoot, kpiProfile);

  /** Perfil conservador/moderado: não usar CAGR da curva `engine_v2` no cartão (diverge do Modelo CAP15 / iframe). */
  const cagrPct = planPlafonado
    ? capPctDisplay(
        embedModelKpis?.cagrPct ??
          plafonadoCardCagrFromFiles ??
          (kpiProfile === "moderado" ? planPlafonadoModeradoCagrFallbackPct() : null) ??
          overlayModelCagrPct,
      )
    : capPctDisplay(
        embedModelKpis?.cagrPct ??
          plafonadoCardCagrFromFiles ??
          cagrFromModel ??
          overlayModelCagrPct,
      );

  const benchmarkCagrPct =
    freezeHero.benchmarkCagrPct != null
      ? capPctDisplay(freezeHero.benchmarkCagrPct)
      : overlayBenchmarkCagrPct;

  const totalReturnPct = cagrPct;
  const benchmarkTotalReturnPct = benchmarkCagrPct;

  const retsO = dailyReturnsFromEquity(ovrW);
  const retsB = dailyReturnsFromEquity(benchW);
  let sharpe = sharpeFromDailyReturns(retsO);
  const benchmarkSharpe = sharpeFromDailyReturns(retsB);
  let volatilityPct = capPctDisplay(annualizedVolFromDailyReturns(retsO));
  const benchmarkVolatilityPct = capPctDisplay(
    annualizedVolFromDailyReturns(retsB)
  );
  let maxDrawdownPct = capPctDisplay(maxDrawdownFraction(ovrW) * 100);
  const benchmarkMaxDrawdownPct = capPctDisplay(
    maxDrawdownFraction(benchW) * 100
  );

  if (planPlafonado && embedModelKpis) {
    if (embedModelKpis.sharpe != null) sharpe = embedModelKpis.sharpe;
    if (embedModelKpis.volAnnualPct != null) {
      volatilityPct = capPctDisplay(embedModelKpis.volAnnualPct);
    }
    if (embedModelKpis.maxDrawdownPct != null) {
      maxDrawdownPct = capPctDisplay(embedModelKpis.maxDrawdownPct);
    }
  }

  const displayHorizonLabel =
    n >= 50
      ? `Últimos ${DISPLAY_REPORT_YEARS} anos (histórico do modelo; ilustrativo)`
      : "Horizonte limitado pelos dados disponíveis";
  const cagrYearRangeInParens =
    freezeHero.historyYearRangeLabel != null &&
    String(freezeHero.historyYearRangeLabel).trim() !== ""
      ? String(freezeHero.historyYearRangeLabel).trim()
      : null;
  const displayCagrModelSubLabel = cagrYearRangeInParens
    ? `Retorno anualizado da carteira modelo (${cagrYearRangeInParens})`
    : n >= 50
      ? `CAGR anualizado da carteira modelo — últimos ${DISPLAY_REPORT_YEARS} anos`
      : "CAGR anualizado da carteira modelo no período disponível";
  const displayCagrBenchmarkSubLabel = cagrYearRangeInParens
    ? `Retorno anualizado do benchmark (${cagrYearRangeInParens})`
    : n >= 50
      ? `CAGR anualizado do benchmark — últimos ${DISPLAY_REPORT_YEARS} anos`
      : "CAGR anualizado do benchmark no período disponível";

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

  const buyCount = proposedTrades.filter((t) => t.side === "BUY").length;
  const sellCount = proposedTrades.filter((t) => t.side === "SELL").length;
  const buyAbsPlan = proposedTrades
    .filter((t) => t.side === "BUY")
    .reduce(
      (acc, t) => acc + (isBuyMissingEquityClosePrice(t) ? 0 : Math.abs(t.deltaValueEst)),
      0,
    );
  const sellAbsPlan = proposedTrades
    .filter((t) => t.side === "SELL")
    .reduce((acc, t) => acc + Math.abs(t.deltaValueEst), 0);
  /** Maior perna compra/venda — evita impacto % artificial >100% pela soma de todos os |Δ|. */
  const turnoverAbs = Math.max(buyAbsPlan, sellAbsPlan);
  const turnoverPctTechnical =
    navEur > 0 ? capPctDisplay((turnoverAbs / navEur) * 100) : 0;
  /**
   * Constituição inicial: sobretudo caixa → alvo; poucas vendas. A soma das compras em valor estimado pode
   * exceder 100% do NAV de referência (USD+EUR+FX/MM); para o cliente, o que importa é alocar o património
   * de referência (~100%), não a percentagem técnica bruta.
   */
  const initialConstitutionLikely =
    navEur > 0 &&
    sellAbsPlan / navEur < 0.06 &&
    buyAbsPlan > navEur * 0.25;
  const turnoverPct =
    initialConstitutionLikely && turnoverPctTechnical > 100
      ? capPctDisplay(100)
      : turnoverPctTechnical;

  const planSummary = {
    strategyLabel: "Ações globais (DECIDE V2.3 smooth)",
    riskLabel: profileRiskLabel(profileLabel),
    positionCount: recommendedPositions.length,
    turnoverPct,
    turnoverPctTechnical,
    initialConstitution: initialConstitutionLikely,
    buyCount,
    sellCount,
  };
  const proposedTradesCoverageNote =
    tradePlanRows.length > 0
      ? "Inclui ordens do plano IBKR e ajustes sintéticos para cobrir toda a carteira recomendada."
      : "Sem plano IBKR disponível: lista construída a partir da diferença entre carteira atual e recomendada.";
  const modelDisplayName = PLAFONADO_MODEL_DISPLAY_NAME_PT;

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

  const usingOfficialWeightsForPlan =
    !preferLiveWeights && !!officialMonth?.rows?.length;
  const planWeightsProvenance: PlanWeightsProvenance = {
    mode: usingOfficialWeightsForPlan ? "official_csv" : "model_fallback",
    rebalanceDate: usingOfficialWeightsForPlan
      ? String(officialMonth!.date || "").slice(0, 10)
      : modelPayloadAsOfDateYmd(modelPayload) ?? undefined,
    mergeSourcePath: builtWeights?.sourcePath,
    officialHistoryMonthsLoaded: builtWeights?.months.length ?? 0,
    recommendedLineCount: recommendedPositions.length,
    planDustExitPct: planExitWeightPct(),
    planEntryMinPct: entryMinPct,
    planTableConsolidatePct: planEntryMinWeightPct(),
  };

  const reportData: ReportData = {
    generatedAt: new Date().toISOString(),
    accountCode,
    profile: profileLabel,
    modelDisplayName,
    navEur,
    accountBaseCurrency,
    cashEur,
    currentValueEur,
    totalReturnPct,
    benchmarkTotalReturnPct,
    cagrPct,
    benchmarkCagrPct,
    sharpe,
    benchmarkSharpe,
    volatilityPct,
    benchmarkVolatilityPct,
    maxDrawdownPct,
    benchmarkMaxDrawdownPct,
    displayHorizonLabel,
    displayCagrModelSubLabel,
    displayCagrBenchmarkSubLabel,
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
    tbillProxyIbTicker: eurMmSym,
    ...(initialIbkrStructure ? { initialIbkrStructure } : {}),
    ...(planTargetRebalanceDate ? { planTargetRebalanceDate } : {}),
    planWeightsProvenance,
  };

  return {
    props: {
      reportData,
    },
  };
}
