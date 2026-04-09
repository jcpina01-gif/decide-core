/**
 * Constrói a mesma lista de «Alterações propostas» que o relatório cliente (merge CSV IBKR + modelo + conta).
 * Usado em /client/approve para a aprovação regulamentar alinhar com a tabela do relatório.
 */
import fs from "fs";
import path from "path";
import { fetchPlafonadoCagrPctFromKpiServer } from "./fetchPlafonadoCagrFromKpiServer";
import { recommendedCagrDisplayPercentFromModelPayload } from "../planDecisionKpiMath";
import { readPlafonadoM100CagrDisplayPercent } from "./readPlafonadoFreezeCagr";
import { FREEZE_PLAFONADO_MODEL_DIR } from "../freezePlafonadoDir";

export type ApprovalProposedTrade = {
  ticker: string;
  side: string;
  absQty: number;
  marketPrice: number;
  deltaValueEst: number;
  targetWeightPct: number;
  nameShort: string;
};

function safeNumber(x: unknown, fallback = 0): number {
  const v = typeof x === "number" ? x : Number(x);
  return Number.isFinite(v) ? v : fallback;
}

function safeString(x: unknown, fallback = ""): string {
  return typeof x === "string" ? x : fallback;
}

function trimmedCell(x: unknown): string {
  return typeof x === "string" ? x.trim() : "";
}

function pickRecommendedSector(p: { sector?: unknown }, metaSector: string | undefined): string {
  const fromMeta = trimmedCell(metaSector);
  const fromPayload = trimmedCell(
    typeof p.sector === "string" ? p.sector : p.sector != null ? String(p.sector) : "",
  );
  return fromMeta || fromPayload || "";
}

function pickRecommendedIndustry(p: { industry?: unknown }, metaIndustry: string | undefined): string {
  const fromMeta = trimmedCell(metaIndustry);
  const fromPayload = trimmedCell(
    typeof p.industry === "string" ? p.industry : p.industry != null ? String(p.industry) : "",
  );
  return fromMeta || fromPayload || "";
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
  payload: unknown | null;
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
      if (r.status === 405) {
        return {
          payload: null,
          error:
            "Backend respondeu 405 (GET não permitido). O serviço em DECIDE_BACKEND_URL está provavelmente a usar o stub `server:app` (só POST). Em Cloud Run / Docker use `uvicorn main:app` com o backend DECIDE completo.",
        };
      }
      return { payload: null, error: `Backend respondeu ${r.status}` };
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

function hasUsableModelPayload(payload: unknown): boolean {
  if (!payload || typeof payload !== "object") return false;
  const p = payload as Record<string, unknown>;
  const positions = (p.current_portfolio as Record<string, unknown> | undefined)?.positions;
  const dates = (p.series as Record<string, unknown> | undefined)?.dates;
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

function loadFreezeRunModelSnapshot(projectRoot: string): unknown | null {
  const dir = path.join(projectRoot, "freeze", FREEZE_PLAFONADO_MODEL_DIR, "model_outputs");
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
    equity_overlayed.push(overlayed.length > i ? safeNumber(overlayed[i], rawEq) : rawEq);
  }

  const positions = holdings.map((h: unknown) => {
    const hh = h as Record<string, unknown>;
    return {
      ticker: safeString(hh?.ticker, "").toUpperCase(),
      name_short: safeString(hh?.company ?? hh?.ticker, String(hh?.ticker)),
      region: safeString(hh?.zone || hh?.country, ""),
      sector: safeString(hh?.sector, ""),
      score: safeNumber(hh?.score, 0),
      weight_pct: safeNumber(hh?.weight_pct, 0),
    };
  });

  const ovr = equity_overlayed;
  const bench = benchmark_equity;
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

function exclusionTickerGroup(ticker: string): string {
  const t =
    ticker == null || typeof ticker !== "string"
      ? ""
      : ticker.trim().toUpperCase().replace(/\./g, "-");
  if (t === "GOOG" || t === "GOOGL") return "GOOG";
  return t;
}

function normalizeTickerKey(ticker: string): string {
  if (ticker == null || typeof ticker !== "string") return "";
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

/** UCITS «cash» em EUR na IBKR (ex. Lyxor Smart Overnight CSH2, Amundi XEON). */
function eurMmIbTicker(): string {
  const v = (
    process.env.NEXT_PUBLIC_EUR_MM_IB_TICKER ||
    process.env.EUR_MM_IB_TICKER ||
    "CSH2"
  )
    .trim()
    .toUpperCase();
  return v || "CSH2";
}

function fallbackEurMmPriceEur(ticker: string): number {
  const t = ticker.trim().toUpperCase();
  if (t === "CSH2") return 100.0;
  if (t === "XEON") return 52.0;
  return 100.0;
}

const MIN_FX_HEDGE_USD_ORDER = Number(
  process.env.DECIDE_MIN_FX_HEDGE_USD || process.env.NEXT_PUBLIC_DECIDE_MIN_FX_HEDGE_USD || 500,
);

function fxHedgeOrderPctFromEnv(): number {
  const raw = Number(
    process.env.DECIDE_FX_HEDGE_ORDER_PCT ?? process.env.NEXT_PUBLIC_DECIDE_FX_HEDGE_ORDER_PCT ?? 100,
  );
  return Number.isFinite(raw) ? Math.max(0, Math.min(100, raw)) : 100;
}

function eurusdMidHint(): number {
  const raw = Number(process.env.DECIDE_EURUSD_MID_HINT ?? process.env.NEXT_PUBLIC_DECIDE_EURUSD_MID_HINT ?? 1.08);
  return Number.isFinite(raw) && raw > 0 ? raw : 1.08;
}

function estimateUsdBuyNotionalForFxHedge(trades: InternalProposedTrade[]): number {
  let sumPx = 0;
  let sumDelta = 0;
  for (const t of trades) {
    if (String(t.side).toUpperCase() !== "BUY") continue;
    const tick = String(t.ticker).toUpperCase();
    if (tick === "EURUSD" || tick === "TBILL_PROXY" || tick === "EUR_MM_PROXY") continue;
    const q = Math.floor(Math.abs(Number(t.absQty) || 0));
    const px = Number(t.marketPrice) || 0;
    if (q > 0 && px > 0) sumPx += q * px;
    sumDelta += Math.abs(safeNumber(t.deltaValueEst, 0));
  }
  const rounded = Math.round(sumPx * 100) / 100;
  const deltaUsd = Math.round(sumDelta * 100) / 100;
  return Math.max(rounded, deltaUsd);
}

/**
 * Linhas BUY geradas só a partir do modelo (sem CSV IBKR ou com `abs_qty` vazio) tinham `absQty: 0`.
 * Preenche quantidade e preço a partir de Δvalor ou peso × NAV, usando último close em `prices_close`.
 */
export function fillSyntheticEquityBuyQuantities(
  trades: Array<{
    ticker: string;
    side: string;
    absQty: number;
    marketPrice: number;
    closePrice: number | null;
    deltaValueEst: number;
    targetWeightPct: number;
  }>,
  navFinal: number,
  getClosePrice: (ticker: string) => number,
): void {
  for (const t of trades) {
    if (String(t.side).toUpperCase() !== "BUY") continue;
    const tick = String(t.ticker).toUpperCase();
    if (tick === "EURUSD" || tick === "EUR_MM_PROXY" || tick === "TBILL_PROXY") continue;
    const q0 = Math.floor(Math.abs(safeNumber(t.absQty, 0)));
    if (q0 > 0) continue;
    let px = safeNumber(t.marketPrice, 0) > 0 ? safeNumber(t.marketPrice, 0) : 0;
    if (px <= 0 && t.closePrice != null && safeNumber(t.closePrice, 0) > 0) {
      px = safeNumber(t.closePrice, 0);
    }
    if (px <= 0) px = getClosePrice(t.ticker);
    if (!(px > 0)) continue;
    let notional = safeNumber(t.deltaValueEst, 0);
    if (notional <= 0 && navFinal > 0 && safeNumber(t.targetWeightPct, 0) > 0) {
      notional = (safeNumber(t.targetWeightPct, 0) / 100) * navFinal;
    }
    if (notional <= 0) continue;
    const q = Math.max(1, Math.floor(notional / px));
    t.absQty = q;
    t.marketPrice = px;
    t.closePrice = px;
    t.deltaValueEst = q * px;
  }
}

type RecommendedPosition = {
  ticker: string;
  nameShort: string;
  region: string;
  sector: string;
  industry: string;
  score: number;
  weightPct: number;
  originalWeightPct: number;
  excluded: boolean;
};

type InternalProposedTrade = {
  ticker: string;
  side: string;
  absQty: number;
  marketPrice: number;
  closePrice: number | null;
  deltaValueEst: number;
  targetWeightPct: number;
  nameShort: string;
};

type ActualPosition = {
  ticker: string;
  qty: number;
  marketPrice: number;
  closePrice: number | null;
  value: number;
  weightPct: number;
  currency: string;
};

export type LoadApprovalAlignedProposedTradesOptions = {
  /**
   * NAV em EUR só aplicado quando o smoke IBKR (`tmp_diag`) não traz património —
   * ex. Vercel sem ficheiros locais; alinha quantidades ao montante do onboarding.
   */
  navOverrideEur?: number;
};

export async function loadApprovalAlignedProposedTrades(
  projectRoot: string,
  options?: LoadApprovalAlignedProposedTradesOptions,
): Promise<{
  trades: ApprovalProposedTrade[];
  navEur: number;
  coverageNote: string;
  csvRowCount: number;
  /** CAGR overlay do mesmo `modelPayload` usado no plano (alinhado ao relatório / iframe). */
  recommendedCagrPct: number | null;
}> {
  try {
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
  const pricesClosePath = path.join(projectRoot, "backend", "data", "prices_close.csv");

  const smokeJson = readJsonIfExists<Record<string, unknown>>(smokePath);
  const statusJson = readJsonIfExists<Record<string, unknown>>(statusPath);
  const tradePlanRows = readCsvIfExists(tradePlanPath);

  const metaByTicker = new Map<string, { sector: string; region: string; nameShort: string; industry: string }>();
  const upsertMeta = (row: Record<string, string>) => {
    const tRaw = safeString(row.ticker || row.symbol).toUpperCase();
    const t = normalizeTickerKey(tRaw);
    if (!t) return;
    const curr = metaByTicker.get(t) || { sector: "", region: "", nameShort: "", industry: "" };
    const sectorFromRow = trimmedCell(row.sector || row.gics_sector || row.sector_name);
    const industryFromRow = trimmedCell(row.industry || row.gics_sub_industry || row.sub_industry || "");
    const nameCandidate = trimmedCell(row.name_short || row.name || row.company || "");
    const nameWeak =
      !nameCandidate ||
      normalizeTickerKey(nameCandidate) === t ||
      normalizeTickerKey(nameCandidate) === exclusionTickerGroup(t);
    const nextName = nameWeak ? curr.nameShort || nameCandidate : nameCandidate;
    const regionCandidate = trimmedCell(row.region || row.zone || row.country_group || "");
    const next = {
      sector: sectorFromRow || curr.sector,
      region: regionCandidate || curr.region,
      nameShort: nextName,
      industry: industryFromRow || curr.industry,
    };
    metaByTicker.set(t, next);
    const alt = t.includes("-") ? t.replace(/-/g, ".") : t.replace(/\./g, "-");
    if (alt && alt !== t) metaByTicker.set(alt, next);
  };
  for (const row of readCsvIfExists(companyMetaGlobalPath)) upsertMeta(row);
  for (const row of readCsvIfExists(companyMetaGlobalEnrichedPath)) upsertMeta(row);
  for (const row of readCsvIfExists(companyMetaV3Path)) upsertMeta(row);
  for (const row of readCsvIfExists(companyMetaPath)) upsertMeta(row);

  const metaForTicker = (ticker: string) => {
    const k = normalizeTickerKey(ticker);
    const direct = metaByTicker.get(k);
    if (direct) return direct;
    const alt = k.includes("-") ? k.replace(/-/g, ".") : k.replace(/\./g, "-");
    if (alt) return metaByTicker.get(alt);
    return undefined;
  };

  let closeAsOfDate = "";
  const closePricesByTicker = new Map<string, number>();

  function normalizeTickerForCloseCsv(ticker: string) {
    return ticker.trim().toUpperCase().replace(/\s+/g, "").replace(/\./g, "-");
  }

  function getClosePrice(ticker: string): number {
    const t = ticker.trim().toUpperCase();
    const candidates = [t, normalizeTickerForCloseCsv(t), t.replace(/-/g, ".")];
    for (const c of candidates) {
      const v = closePricesByTicker.get(c);
      if (typeof v === "number" && Number.isFinite(v) && v > 0) return v;
    }
    return 0;
  }

  try {
    if (fs.existsSync(pricesClosePath)) {
      const textRaw = fs.readFileSync(pricesClosePath, "utf-8");
      const text = textRaw.replace(/^\uFEFF/, "");
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
    /* ignore */
  }
  void closeAsOfDate;

  const excludedTickersApplied: string[] = [];

  let { payload: modelPayload } = await loadBackendModel("moderado", excludedTickersApplied);
  if (!hasUsableModelPayload(modelPayload)) {
    const snap = loadFreezeRunModelSnapshot(projectRoot);
    if (snap) modelPayload = snap;
  }

  const smoke = smokeJson as Record<string, unknown> | null;
  const sel = smoke?.selected as Record<string, unknown> | undefined;
  const att0 = Array.isArray(smoke?.attempts) ? (smoke.attempts as unknown[])[0] : undefined;
  const att0o = att0 as Record<string, unknown> | undefined;
  const navFromSmoke = safeNumber(
    (sel?.netLiquidation as Record<string, unknown> | undefined)?.value ??
      (att0o?.netLiquidation as Record<string, unknown> | undefined)?.value,
    0,
  );
  let navFinal = navFromSmoke;
  const overrideNav =
    options?.navOverrideEur != null ? safeNumber(options.navOverrideEur, 0) : 0;
  if (navFromSmoke <= 0 && overrideNav > 0) {
    navFinal = overrideNav;
  } else if (navFinal <= 0) {
    const envNav = safeNumber(process.env.DECIDE_APPROVAL_FALLBACK_NAV_EUR, 0);
    if (envNav > 0) navFinal = envNav;
  }

  const tradePlanByTicker = new Map<string, Record<string, string>>();
  for (const row of tradePlanRows) {
    const ticker = safeString(row.ticker).toUpperCase();
    if (ticker) tradePlanByTicker.set(ticker, row);
  }

  const rawPositions = Array.isArray(statusJson?.positions)
    ? statusJson.positions
    : Array.isArray((smokeJson?.selected as Record<string, unknown> | undefined)?.positions)
      ? (smokeJson?.selected as Record<string, unknown>).positions
      : [];

  const actualPositions: ActualPosition[] = (rawPositions as unknown[]).map((p: unknown) => {
    const pp = p as Record<string, unknown>;
    const ticker = safeString(pp.ticker ?? pp.symbol).toUpperCase();
    const qty = safeNumber(pp.position ?? pp.qty, 0);
    const tradePlanRow = tradePlanByTicker.get(ticker);
    const marketPrice = safeNumber((tradePlanRow as Record<string, string> | undefined)?.market_price, 0);
    const value = qty * marketPrice;
    const weightPct = navFinal > 0 ? (value / navFinal) * 100 : 0;
    const closePrice = getClosePrice(ticker);
    return {
      ticker,
      qty,
      marketPrice,
      closePrice: closePrice > 0 ? closePrice : null,
      value,
      weightPct,
      currency: safeString(pp.currency, safeString((tradePlanRow as Record<string, string> | undefined)?.currency, "USD")),
    };
  });

  const mp0 = modelPayload as Record<string, unknown> | null;
  const cashSleeveFracRaw = safeNumber(
    (mp0?.kpis as Record<string, unknown> | undefined)?.latest_cash_sleeve ??
      (mp0?.meta as Record<string, unknown> | undefined)?.latest_cash_sleeve ??
      (mp0?.summary as Record<string, unknown> | undefined)?.latest_cash_sleeve,
    0,
  );
  const cashSleeveFrac = cashSleeveFracRaw >= 0 && cashSleeveFracRaw <= 0.95 ? cashSleeveFracRaw : 0;
  const investedFrac = 1 - cashSleeveFrac;

  const mp = modelPayload as Record<string, unknown> | null;
  const positionsRaw = Array.isArray((mp?.current_portfolio as Record<string, unknown> | undefined)?.positions)
    ? ((mp?.current_portfolio as Record<string, unknown>).positions as unknown[])
    : [];

  const recommendedRaw: RecommendedPosition[] = positionsRaw.map((p: unknown) => {
    const pp = p as Record<string, unknown>;
    const t = safeString(pp.ticker).toUpperCase();
    const m = metaForTicker(t);
    return {
      ticker: t,
      nameShort: pickBestDisplayName(
        t,
        safeString(pp.name_short || pp.short_name || pp.ticker),
        safeString(m?.nameShort, ""),
      ),
      region: safeString(pp.region || m?.region, ""),
      sector: pickRecommendedSector(pp as { sector?: unknown }, m?.sector),
      industry: pickRecommendedIndustry(pp as { industry?: unknown }, m?.industry),
      score: safeNumber(pp.score, 0),
      weightPct: safeNumber(pp.weight_pct, 0) * investedFrac,
      originalWeightPct: safeNumber(pp.weight_pct, 0) * investedFrac,
      excluded: false,
    };
  });

  const dedupByTicker = new Map<string, RecommendedPosition>();
  for (const p of recommendedRaw) {
    const k = exclusionTickerGroup(normalizeTickerKey(p.ticker));
    const prev = dedupByTicker.get(k);
    if (!prev || safeNumber(p.weightPct, 0) > safeNumber(prev.weightPct, 0)) {
      dedupByTicker.set(k, { ...p, ticker: k });
    }
  }
  const recommendedRawUnique = Array.from(dedupByTicker.values());

  let recommendedPositions: RecommendedPosition[] = recommendedRawUnique.map((p) => ({
    ...p,
    excluded: excludedTickersApplied.includes(p.ticker),
  }));

  const recommendedWeightSumPct = recommendedPositions.reduce((acc, p) => acc + safeNumber(p.weightPct, 0), 0);
  const modelCashSleevePct = cashSleeveFrac * 100;
  const tbillsProxyWeightPct =
    modelCashSleevePct > 0 ? modelCashSleevePct : Math.max(0, 100 - recommendedWeightSumPct);
  const tbillIdx = recommendedPositions.findIndex((p) => p.ticker === "TBILL_PROXY");
  if (tbillIdx >= 0) {
    recommendedPositions[tbillIdx].nameShort = "T-Bills / Cash Sleeve";
    recommendedPositions[tbillIdx].sector = "Cash & T-Bills";
    recommendedPositions[tbillIdx].industry = "";
    recommendedPositions[tbillIdx].region = recommendedPositions[tbillIdx].region || "US";
  } else {
    recommendedPositions.push({
      ticker: "TBILL_PROXY",
      nameShort: "T-Bills / Cash Sleeve",
      region: "US",
      sector: "Cash & T-Bills",
      industry: "",
      score: 0,
      weightPct: tbillsProxyWeightPct,
      originalWeightPct: tbillsProxyWeightPct,
      excluded: false,
    });
  }

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
    for (const p of recommendedPositions) {
      if (p.ticker !== "TBILL_PROXY") p.weightPct = 0;
    }
    tbillPos.weightPct += totalNonTbPct;
  }

  recommendedPositions.sort((a, b) => b.weightPct - a.weightPct);

  const proposedTrades: InternalProposedTrade[] = tradePlanRows
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
          safeString(m?.nameShort, ""),
        );
      })(),
    }));

  for (const t of proposedTrades) {
    const cp = getClosePrice(t.ticker);
    if (cp > 0) t.closePrice = cp;
  }

  const targetWeightByTicker = new Map<string, number>(
    recommendedPositions.map((p) => [p.ticker, safeNumber(p.weightPct, 0)]),
  );
  for (const t of proposedTrades) {
    t.targetWeightPct = safeNumber(targetWeightByTicker.get(t.ticker), 0);
  }

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
    proposedTrades.map((t) => exclusionTickerGroup(normalizeTickerKey(t.ticker))),
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
      deltaValueEst: navFinal > 0 ? (r.weightPct / 100) * navFinal : 0,
      targetWeightPct: r.weightPct,
      nameShort: r.nameShort || r.ticker,
    });
    proposedByTicker.add(exclusionTickerGroup(normalizeTickerKey(r.ticker)));
  }

  const recommendedTickersActive = new Set(
    recommendedPositions
      .filter((p) => p.ticker !== "TBILL_PROXY" && safeNumber(p.weightPct, 0) > 0)
      .map((p) => p.ticker),
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

  fillSyntheticEquityBuyQuantities(proposedTrades, navFinal, getClosePrice);

  {
    for (let i = proposedTrades.length - 1; i >= 0; i -= 1) {
      if (proposedTrades[i].ticker === "TBILL_PROXY") proposedTrades.splice(i, 1);
    }
    const tbillW = tbillPos ? safeNumber(tbillPos.weightPct, 0) : 0;
    if (tbillW > 0 && navFinal > 0) {
      const pxRaw = getClosePrice(eurMmSym) || getClosePrice("EUR_MM_PROXY");
      const pxEur = pxRaw > 0 ? pxRaw : fallbackEurMmPriceEur(eurMmSym);
      const notional = (tbillW / 100) * navFinal;
      const q = Math.max(1, Math.floor(notional / pxEur));
      const existing = proposedTrades.find((t) => t.ticker === "EUR_MM_PROXY");
      if (existing) {
        if (existing.side !== "INACTIVE") {
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
    const hedgeUsdRaw = estimateUsdBuyNotionalForFxHedge(proposedTrades);
    const pct = fxHedgeOrderPctFromEnv();
    const hedgeUsd = (hedgeUsdRaw * pct) / 100;
    if (hedgeUsd >= MIN_FX_HEDGE_USD_ORDER) {
      const mid = eurusdMidHint();
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

  let coverageNote =
    tradePlanRows.length > 0
      ? "Mesma visão que «Alterações propostas» no plano: CSV IBKR + carteira recomendada + posições em conta."
      : "Sem CSV IBKR: lista a partir da diferença entre conta e recomendado (como no plano).";
  if (navFromSmoke <= 0 && navFinal > 0) {
    coverageNote += " NAV de referência sem ficheiro smoke IBKR no servidor.";
    if (overrideNav > 0) {
      coverageNote += " Usado o montante indicado no onboarding (pedido à API).";
    }
  }

  const trades: ApprovalProposedTrade[] = proposedTrades.map((t) => ({
    ticker: t.ticker,
    side: t.side,
    absQty: t.absQty,
    marketPrice: t.marketPrice,
    deltaValueEst: t.deltaValueEst,
    targetWeightPct: t.targetWeightPct,
    nameShort: t.nameShort,
  }));

  const recommendedCagrPct =
    (await fetchPlafonadoCagrPctFromKpiServer("moderado")) ??
    readPlafonadoM100CagrDisplayPercent(projectRoot) ??
    recommendedCagrDisplayPercentFromModelPayload(modelPayload);

  return {
    trades,
    navEur: navFinal,
    coverageNote,
    csvRowCount: tradePlanRows.length,
    recommendedCagrPct,
  };
  } catch (e: unknown) {
    console.error("[loadApprovalAlignedProposedTrades]", e);
    return {
      trades: [],
      navEur: 0,
      coverageNote:
        "Não foi possível construir o plano a partir de tmp_diag / modelo. Verifique os ficheiros e o backend.",
      csvRowCount: 0,
      recommendedCagrPct: null,
    };
  }
}
