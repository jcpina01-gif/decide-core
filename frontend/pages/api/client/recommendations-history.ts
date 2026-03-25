/**
 * Histórico completo de recomendações mensais (pesos por data de rebalanceamento).
 * - Parser CSV com campos entre aspas (vírgulas dentro do nome não partem linhas).
 * - Vários CSVs: **primeira fonte por data ganha**; as seguintes só acrescentam datas em falta (ex. full.csv após CAP15).
 * - Meta empresa: vários CSVs (v3, combined, global…) — escolhe o nome mais informativo (não só o ticker).
 */
import fs from "fs";
import path from "path";
import type { NextApiRequest, NextApiResponse } from "next";

export type FlowRow = {
  ticker: string;
  company?: string;
  weightPct?: number;
};

export type PriorMonthBar = {
  month: string;
  label: string;
  retPct: number | null;
};

export type RecommendationRow = {
  ticker: string;
  weight: number;
  weightPct: number;
  company?: string;
  score?: number;
  sector?: string;
  rank?: number;
};

export type RecommendationMonth = {
  date: string;
  rows: RecommendationRow[];
  turnover?: number;
  grossExposurePct?: number;
  /** Soma dos pesos T-Bills / cash sleeve (TBILL_PROXY, BIL, SHV), em % do NAV modelo. */
  tbillsTotalPct?: number;
  /** Restante carteira (≈ ações), em %. */
  equitySleeveTotalPct?: number;
  entries?: FlowRow[];
  exits?: FlowRow[];
  priorThreeMonthReturns?: PriorMonthBar[];
  equityChartSource?: string;
  chronologicalIndex?: number;
};

/**
 * Ordem: **primeiro ficheiro com dados para uma dada data ganha** (pesos alinhados ao que publicas como CAP15).
 * Depois, ficheiros seguintes só acrescentam **meses em falta** (ex. `weights_by_rebalance_full.csv` até ao último pregão).
 */
const CANDIDATE_FILES = [
  "freeze/DECIDE_MODEL_V5_OVERLAY_CAP15/model_outputs/weights_by_rebalance.csv",
  "backend/data/weights_by_rebalance_full.csv",
  "backend/data/weights_by_rebalance.csv",
  "backend/data/weights_by_rebalance_normalized_long.csv",
  "freeze/latest_v3/weights_by_rebalance_latest.csv",
  "freeze/latest_v3_global_final/weights_by_rebalance.csv",
  "freeze/DECIDE_MODEL_V3_GLOBAL_OPT/model_outputs/weights_by_rebalance.csv",
  "freeze/DECIDE_MODEL_V3_GLOBAL_FINAL/model_outputs/weights_by_rebalance.csv",
  "freeze/DECIDE_MODEL_V3_GLOBAL_20Y_TWS/model_outputs/weights_by_rebalance.csv",
  "freeze/DECIDE_MODEL_V3_20Y_TWS/model_outputs/weights_by_rebalance.csv",
  "freeze/DECIDE_MODEL_V3_ZONE_BUFFER/model_outputs/weights_by_rebalance.csv",
  "freeze/DECIDE_MODEL_V2_CANDIDATE/model_outputs/weights_by_rebalance.csv",
] as const;

const DEFAULT_MODEL_EQUITY_REL = "freeze/DECIDE_MODEL_V5_OVERLAY_CAP15/model_outputs/model_equity_final_20y.csv";

const COMPANY_META_FILES = [
  "backend/data/company_meta_global_enriched.csv",
  "backend/data/company_meta_global.csv",
  "backend/data/company_meta_combined.csv",
  "backend/data/company_meta_v3.csv",
] as const;

function projectRoot(): string {
  return path.join(process.cwd(), "..");
}

function normalizeDate(raw: string): string {
  const s = String(raw).trim().replace(/^["']|["']$/g, "");
  const cut = s.includes("T") ? s.split("T")[0]! : s.slice(0, 10);
  return cut.length >= 10 ? cut.slice(0, 10) : s;
}

/** Uma linha CSV com suporte a "campo, com vírgula". */
function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (c === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
        continue;
      }
      inQuotes = !inQuotes;
      continue;
    }
    if (!inQuotes && c === ",") {
      out.push(cur.trim());
      cur = "";
      continue;
    }
    cur += c;
  }
  out.push(cur.trim());
  return out.map((cell) => {
    const s = cell.trim();
    if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) {
      return s.slice(1, -1).replace(/""/g, '"');
    }
    return s;
  });
}

function parseCsvRows(text: string): { headers: string[]; rows: string[][] } {
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  if (!lines.length) return { headers: [], rows: [] };
  const headers = parseCsvLine(lines[0]!).map((h) => h.toLowerCase().replace(/^\ufeff/, ""));
  const rows: string[][] = [];
  for (let i = 1; i < lines.length; i++) {
    rows.push(parseCsvLine(lines[i]!));
  }
  return { headers, rows };
}

function colIdx(headers: string[], names: string[]): number {
  for (const n of names) {
    const i = headers.indexOf(n.toLowerCase());
    if (i >= 0) return i;
  }
  return -1;
}

/** Quanto maior, melhor o nome para mostrar ao utilizador. */
function companyNameQuality(company: string | undefined, ticker: string): number {
  const c = (company || "").trim();
  const t = ticker.trim().toUpperCase();
  if (!c) return 0;
  const cu = c.toUpperCase();
  if (cu === t) return 1;
  if (cu.replace(/\./g, "") === t.replace(/\./g, "")) return 1;
  if (c.length <= 5 && (cu === t.slice(0, c.length) || t.startsWith(cu))) return 1;
  return 2 + Math.min(c.length, 200);
}

function pickBetterCompany(a: string | undefined, b: string | undefined, ticker: string): string | undefined {
  const qa = companyNameQuality(a, ticker);
  const qb = companyNameQuality(b, ticker);
  if (qb > qa) return (b || "").trim() || undefined;
  return (a || "").trim() || undefined;
}

function loadCompanyLookup(root: string): Map<string, { company?: string; sector?: string }> {
  const m = new Map<string, { company?: string; sector?: string }>();

  for (const rel of COMPANY_META_FILES) {
    const abs = path.join(root, ...rel.split("/"));
    if (!fs.existsSync(abs)) continue;
    let text: string;
    try {
      text = fs.readFileSync(abs, "utf8");
    } catch {
      continue;
    }
    const { headers, rows } = parseCsvRows(text);
    const iT = colIdx(headers, ["ticker", "symbol"]);
    const iC = colIdx(headers, ["company", "name", "company_name", "security_name"]);
    const iS = colIdx(headers, ["sector"]);
    if (iT < 0) continue;

    for (const r of rows) {
      if (r.length <= iT) continue;
      const t = String(r[iT] || "").trim().toUpperCase();
      if (!t) continue;
      const co = iC >= 0 && r[iC] ? String(r[iC]).trim() : undefined;
      const se = iS >= 0 && r[iS] && String(r[iS]).trim() !== "nan" ? String(r[iS]).trim() : undefined;
      const prev = m.get(t) || {};
      const bestCo = pickBetterCompany(prev.company, co, t);
      const bestSe =
        prev.sector && prev.sector !== "nan"
          ? prev.sector
          : se || prev.sector;
      m.set(t, { company: bestCo, sector: bestSe });
    }
  }
  return m;
}

function enrichRow(row: RecommendationRow, lookup: Map<string, { company?: string; sector?: string }>): RecommendationRow {
  const k = row.ticker.trim().toUpperCase();
  const meta = lookup.get(k);
  const out = { ...row };
  out.company = pickBetterCompany(row.company, meta?.company, row.ticker);
  const secRow = row.sector && row.sector !== "nan" ? row.sector : undefined;
  const secMeta = meta?.sector && meta.sector !== "nan" ? meta.sector : undefined;
  out.sector = secRow || secMeta;
  return out;
}

/** Linha já presente no CSV (motor) vs. sleeve implícito acrescentado na API. */
const CASH_SLEEVE_TICKERS = new Set(["TBILL_PROXY", "BIL", "SHV"]);

function listHasExplicitCashSleeve(rows: RecommendationRow[]): boolean {
  return rows.some((r) => CASH_SLEEVE_TICKERS.has(r.ticker.trim().toUpperCase()));
}

function sumCashSleeveWeight(rows: RecommendationRow[]): number {
  return rows.reduce((s, x) => {
    const t = x.ticker.trim().toUpperCase();
    if (!CASH_SLEEVE_TICKERS.has(t)) return s;
    const w = typeof x.weight === "number" && isFinite(x.weight) ? x.weight : 0;
    return s + w;
  }, 0);
}

function parseEquityCsv(text: string): { dates: string[]; equity: number[] } {
  const dates: string[] = [];
  const equity: number[] = [];
  const lines = text.split(/\r?\n/);
  for (let li = 1; li < lines.length; li++) {
    const line = lines[li]!.trim();
    if (!line) continue;
    const comma = line.indexOf(",");
    if (comma < 0) continue;
    const dRaw = line.slice(0, comma).trim();
    const vRaw = line.slice(comma + 1).trim();
    const v = parseFloat(vRaw);
    if (!isFinite(v)) continue;
    const d = dRaw.length >= 10 ? dRaw.slice(0, 10) : dRaw;
    dates.push(d);
    equity.push(v);
  }
  return { dates, equity };
}

function monthEndEquityMap(dates: string[], equity: number[]): Map<string, number> {
  const map = new Map<string, number>();
  for (let i = 0; i < dates.length; i++) {
    const d = dates[i]!.slice(0, 10);
    const ym = d.slice(0, 7);
    map.set(ym, equity[i]!);
  }
  return map;
}

function monthlyModelReturns(monthEnd: Map<string, number>): Map<string, number> {
  const keys = [...monthEnd.keys()].sort();
  const ret = new Map<string, number>();
  for (let i = 1; i < keys.length; i++) {
    const ym = keys[i]!;
    const prevYm = keys[i - 1]!;
    const cur = monthEnd.get(ym);
    const prev = monthEnd.get(prevYm);
    if (cur != null && prev != null && prev > 0 && isFinite(cur)) {
      ret.set(ym, cur / prev - 1);
    }
  }
  return ret;
}

function ymAddMonths(ym: string, delta: number): string {
  const [ys, ms] = ym.split("-");
  const y = parseInt(ys!, 10);
  const mo = parseInt(ms!, 10);
  const d = new Date(Date.UTC(y, mo - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function formatMonthLabelPt(ym: string): string {
  const [ys, ms] = ym.split("-");
  const mo = parseInt(ms!, 10);
  const names = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
  const n = names[mo - 1] || ms;
  return `${n}/${ys}`;
}

function threeCalendarMonthsBeforeRebalance(rebalanceYmd: string): string[] {
  const d = normalizeDate(rebalanceYmd);
  const ym = d.slice(0, 7);
  return [ymAddMonths(ym, -3), ymAddMonths(ym, -2), ymAddMonths(ym, -1)];
}

type CashDailyPoint = { d: string; v: number };

/**
 * `cash_sleeve_daily.csv` na pasta do CAP15 (gerado por `backend/tools/export_cash_sleeve_daily.py`) — uma linha
 * por dia de pregão, fração NAV em T-Bills (overlay V5). Cruzamos cada `rebalance_date` do CSV de pesos com o
 * valor nessa data (ou último dia ≤ rebalance).
 */
function loadCashSleeveDailySorted(root: string): CashDailyPoint[] | null {
  const dirParts = DEFAULT_MODEL_EQUITY_REL.split("/").slice(0, -1);
  const abs = path.join(root, ...dirParts, "cash_sleeve_daily.csv");
  if (!fs.existsSync(abs)) return null;
  try {
    const text = fs.readFileSync(abs, "utf8");
    const { headers, rows } = parseCsvRows(text);
    const iD = colIdx(headers, ["date", "rebalance_date", "as_of"]);
    const iC = colIdx(headers, ["cash_sleeve", "cash", "tbill_weight"]);
    if (iD < 0 || iC < 0) return null;
    const out: CashDailyPoint[] = [];
    for (const r of rows) {
      if (r.length <= Math.max(iD, iC)) continue;
      const ds = normalizeDate(r[iD] || "").slice(0, 10);
      if (ds.length < 10) continue;
      const v = parseFloat(String(r[iC] || "").replace(",", "."));
      if (!isFinite(v)) continue;
      out.push({ d: ds, v: Math.max(0, Math.min(1, v)) });
    }
    out.sort((a, b) => a.d.localeCompare(b.d));
    return out.length ? out : null;
  } catch {
    return null;
  }
}

function cashSleeveOnOrBefore(sorted: CashDailyPoint[], ymd: string): number | null {
  const t = normalizeDate(ymd).slice(0, 10);
  if (t.length < 10 || !sorted.length) return null;
  if (t < sorted[0]!.d) return sorted[0]!.v;
  const last = sorted[sorted.length - 1]!;
  if (t > last.d) return last.v;
  let lo = 0;
  let hi = sorted.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid]!.d <= t) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans >= 0 ? sorted[ans]!.v : null;
}

/** Fallback se não existir `cash_sleeve_daily.csv` (último mês ≈ aba Carteira). */
function loadV5LatestNavCash(root: string): number | null {
  const dirParts = DEFAULT_MODEL_EQUITY_REL.split("/").slice(0, -1);
  const kpisPath = path.join(root, ...dirParts, "v5_kpis.json");
  if (!fs.existsSync(kpisPath)) return null;
  try {
    const raw = fs.readFileSync(kpisPath, "utf8");
    const j = JSON.parse(raw) as { latest_cash_sleeve?: number };
    const latest = Number(j.latest_cash_sleeve);
    if (!isFinite(latest) || latest < 0 || latest > 1) return null;
    return latest;
  } catch {
    return null;
  }
}

function clamp01(x: number): number {
  if (!isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

/** Normaliza só ações a somar 1 na sleeve, depois reparte NAV: equity × (1−navCash) + TBILL_PROXY × navCash. */
function applyV5NavCashOverlay(
  list: RecommendationRow[],
  navCashRaw: number,
  lookup: Map<string, { company?: string; sector?: string }>,
): RecommendationRow[] {
  const nav = clamp01(navCashRaw);
  const eq = 1 - nav;
  const stocks = list.filter((r) => !CASH_SLEEVE_TICKERS.has(r.ticker.trim().toUpperCase()));
  const sumS = stocks.reduce((s, x) => s + (typeof x.weight === "number" && isFinite(x.weight) ? x.weight : 0), 0);
  if (sumS <= 1e-12) return list;
  const norm = stocks.map((row) => {
    const nw = row.weight / sumS;
    return enrichRow({ ...row, weight: nw, weightPct: nw * 100 }, lookup);
  });
  const scaled = norm.map((row) => {
    const w = row.weight * eq;
    return enrichRow({ ...row, weight: w, weightPct: w * 100 }, lookup);
  });
  const cashRow: RecommendationRow = {
    ticker: "TBILL_PROXY",
    weight: nav,
    weightPct: nav * 100,
    score: 0,
  };
  return [...scaled, enrichRow(cashRow, lookup)].sort((a, b) => (b.weight || 0) - (a.weight || 0));
}

/** Apenas ações, pesos normalizados a somar 1 (=100% da sleeve de risco do CSV; sem linha T-Bills / NAV). */
function normalizeEquitySleeveWeightsOnly(
  list: RecommendationRow[],
  lookup: Map<string, { company?: string; sector?: string }>,
): RecommendationRow[] {
  const stocks = list.filter((r) => !CASH_SLEEVE_TICKERS.has(r.ticker.trim().toUpperCase()));
  const sumS = stocks.reduce((s, x) => s + (typeof x.weight === "number" && isFinite(x.weight) ? x.weight : 0), 0);
  if (sumS <= 1e-12) return list;
  return stocks
    .map((row) => {
      const nw = row.weight / sumS;
      return enrichRow({ ...row, weight: nw, weightPct: nw * 100 }, lookup);
    })
    .sort((a, b) => (b.weight || 0) - (a.weight || 0));
}

function loadMonthlyReturns(root: string): { returns: Map<string, number>; sourceRel: string } | null {
  const abs = path.join(root, ...DEFAULT_MODEL_EQUITY_REL.split("/"));
  if (!fs.existsSync(abs)) return null;
  let text: string;
  try {
    text = fs.readFileSync(abs, "utf8");
  } catch {
    return null;
  }
  const { dates, equity } = parseEquityCsv(text);
  if (dates.length < 30) return null;
  const monthEnd = monthEndEquityMap(dates, equity);
  return { returns: monthlyModelReturns(monthEnd), sourceRel: DEFAULT_MODEL_EQUITY_REL };
}

function weightMap(rows: RecommendationRow[]): Map<string, RecommendationRow> {
  const m = new Map<string, RecommendationRow>();
  for (const r of rows) {
    m.set(r.ticker.trim().toUpperCase(), r);
  }
  return m;
}

type ParsedWeightsFile = {
  byDate: Map<string, RecommendationRow[]>;
  turnoverByDate: Map<string, number>;
};

function parseWeightsFile(absPath: string, lookup: Map<string, { company?: string; sector?: string }>): ParsedWeightsFile | null {
  if (!fs.existsSync(absPath)) return null;
  let text: string;
  try {
    text = fs.readFileSync(absPath, "utf8");
  } catch {
    return null;
  }
  const { headers, rows } = parseCsvRows(text);
  if (!headers.length || !rows.length) return null;

  const iDate = colIdx(headers, ["rebalance_date", "date", "as_of"]);
  const iTicker = colIdx(headers, ["ticker", "symbol"]);
  const iBaseWeight = colIdx(headers, ["base_weight"]);
  const iWeight = colIdx(headers, ["final_weight", "weight", "target_weight", "w"]);
  const iCompany = colIdx(headers, ["company", "company_name", "name", "security_name", "empresa"]);
  const iScore = colIdx(headers, ["score"]);
  const iSector = colIdx(headers, ["sector"]);
  const iRank = colIdx(headers, ["rank"]);
  const iTurn = colIdx(headers, ["turnover"]);

  if (iDate < 0 || iTicker < 0 || iWeight < 0) return null;

  const byDate = new Map<string, RecommendationRow[]>();
  const turnoverByDate = new Map<string, number>();

  for (const r of rows) {
    if (r.length <= Math.max(iDate, iTicker, iWeight)) continue;
    const d = normalizeDate(r[iDate] || "");
    if (!d || d.length < 8) continue;
    const ticker = String(r[iTicker] || "").trim();
    if (!ticker) continue;
    let w: number | null = null;
    if (iBaseWeight >= 0 && r[iBaseWeight]) {
      const b = parseFloat(String(r[iBaseWeight]).replace(",", "."));
      if (isFinite(b) && b >= 0) w = b;
    }
    if (w === null) {
      const fw = parseFloat(String(r[iWeight] || "").replace(",", "."));
      if (!isFinite(fw)) continue;
      w = fw;
    }
    const row: RecommendationRow = {
      ticker,
      weight: w,
      weightPct: w * 100,
    };
    if (iCompany >= 0 && r[iCompany]) row.company = String(r[iCompany]).trim();
    if (iScore >= 0 && r[iScore]) {
      const sc = parseFloat(String(r[iScore]).replace(",", "."));
      if (isFinite(sc)) row.score = sc;
    }
    if (iSector >= 0 && r[iSector] && r[iSector] !== "nan") row.sector = String(r[iSector]).trim();
    if (iRank >= 0 && r[iRank]) {
      const rk = parseInt(String(r[iRank]), 10);
      if (isFinite(rk)) row.rank = rk;
    }
    if (iTurn >= 0 && r[iTurn] && !turnoverByDate.has(d)) {
      const t = parseFloat(String(r[iTurn]).replace(",", "."));
      if (isFinite(t)) turnoverByDate.set(d, t);
    }
    const enriched = enrichRow(row, lookup);
    if (!byDate.has(d)) byDate.set(d, []);
    byDate.get(d)!.push(enriched);
  }

  if (byDate.size === 0) return null;
  return { byDate, turnoverByDate };
}

function mergeWeightSources(
  root: string,
  lookup: Map<string, { company?: string; sector?: string }>,
): { merged: Map<string, RecommendationRow[]>; turnoverByDate: Map<string, number>; sourcesUsed: string[] } | null {
  const merged = new Map<string, RecommendationRow[]>();
  const turnoverByDate = new Map<string, number>();
  const sourcesUsed: string[] = [];

  for (const rel of CANDIDATE_FILES) {
    const abs = path.join(root, ...rel.split("/"));
    const parsed = parseWeightsFile(abs, lookup);
    if (!parsed) continue;
    sourcesUsed.push(rel);

    for (const [d, rows] of parsed.byDate) {
      if (merged.has(d)) continue;
      const incoming = rows.map((r) => enrichRow({ ...r }, lookup));
      merged.set(d, incoming);
      const t = parsed.turnoverByDate.get(d);
      if (t != null) turnoverByDate.set(d, t);
    }
  }

  if (merged.size === 0) return null;
  return { merged, turnoverByDate, sourcesUsed };
}

function buildMonthsFromMerged(
  byDate: Map<string, RecommendationRow[]>,
  turnoverByDate: Map<string, number>,
  lookup: Map<string, { company?: string; sector?: string }>,
  root: string,
): RecommendationMonth[] {
  const months: RecommendationMonth[] = [];
  const cashDailySorted = loadCashSleeveDailySorted(root);
  const v5LatestNavCash = loadV5LatestNavCash(root);
  const sortedDates = Array.from(byDate.keys()).sort();
  const maxRebalanceDate = sortedDates.length ? sortedDates[sortedDates.length - 1]! : "";

  for (const [date, list0] of byDate) {
    const list = list0.map((row) => enrichRow(row, lookup)).sort((a, b) => (b.weight || 0) - (a.weight || 0));
    const turnover = turnoverByDate.get(date);
    const sumW = list.reduce((s, x) => s + (typeof x.weight === "number" && isFinite(x.weight) ? x.weight : 0), 0);
    let grossExposurePct: number | undefined;
    const tol = 0.002;
    let rowsOut: RecommendationRow[];
    const hasExplicitCash = listHasExplicitCashSleeve(list);
    const isLatestRebalance = date === maxRebalanceDate;

    if (!hasExplicitCash) {
      let navRaw: number | null =
        cashDailySorted && cashDailySorted.length > 0 ? cashSleeveOnOrBefore(cashDailySorted, date) : null;
      if (navRaw == null && isLatestRebalance && v5LatestNavCash != null) navRaw = v5LatestNavCash;

      if (navRaw != null && isFinite(navRaw)) {
        const navCashFrac = clamp01(navRaw);
        if (sumW <= 1e-9) {
          rowsOut = list;
        } else if (sumW > 1 + tol) {
          const renorm = list.map((row) => {
            const nw = row.weight / sumW;
            return enrichRow({ ...row, weight: nw, weightPct: nw * 100 }, lookup);
          });
          rowsOut = applyV5NavCashOverlay(renorm, navCashFrac, lookup);
        } else {
          rowsOut = applyV5NavCashOverlay(list, navCashFrac, lookup);
        }
      } else {
        if (sumW <= 1e-9) {
          rowsOut = list;
        } else if (sumW > 1 + tol) {
          const renorm = list.map((row) => {
            const nw = row.weight / sumW;
            return enrichRow({ ...row, weight: nw, weightPct: nw * 100 }, lookup);
          });
          rowsOut = normalizeEquitySleeveWeightsOnly(renorm, lookup);
        } else {
          rowsOut = normalizeEquitySleeveWeightsOnly(list, lookup);
        }
      }
    } else if (sumW <= 1e-9) {
      rowsOut = list;
    } else if (sumW > 1 + tol) {
      rowsOut = list.map((row) => {
        const nw = row.weight / sumW;
        return enrichRow({ ...row, weight: nw, weightPct: nw * 100 }, lookup);
      });
    } else if (sumW < 1 - tol) {
      grossExposurePct = sumW * 100;
      if (!hasExplicitCash && sumW >= 0.92) {
        // Gap pequeno: pesos são da sleeve de ações (~100% entre tickers), não "falta" de NAV em T-Bills.
        rowsOut = list.map((row) => {
          const nw = row.weight / sumW;
          return enrichRow({ ...row, weight: nw, weightPct: nw * 100 }, lookup);
        });
      } else if (!hasExplicitCash) {
        const cashW = 1 - sumW;
        const cashRow: RecommendationRow = {
          ticker: "TBILL_PROXY",
          weight: cashW,
          weightPct: cashW * 100,
          score: 0,
        };
        rowsOut = [...list, enrichRow(cashRow, lookup)].sort((a, b) => (b.weight || 0) - (a.weight || 0));
      } else {
        rowsOut = list;
      }
    } else {
      rowsOut = list;
    }
    const cashW = sumCashSleeveWeight(rowsOut);
    const hasCashTickerRow = rowsOut.some((r) => CASH_SLEEVE_TICKERS.has(r.ticker.trim().toUpperCase()));
    /** Só mostramos % T-Bills / % ações no NAV quando há linha de caixa (último mês com v5 ou CSV explícito / legado). */
    const tbillsTotalPct = hasCashTickerRow ? cashW * 100 : undefined;
    const equitySleeveTotalPct = hasCashTickerRow
      ? Math.max(0, Math.min(100, (1 - cashW) * 100))
      : undefined;
    months.push({
      date,
      rows: rowsOut,
      turnover,
      grossExposurePct,
      ...(hasCashTickerRow ? { tbillsTotalPct, equitySleeveTotalPct } : {}),
    });
  }

  const asc = [...months].sort((a, b) => a.date.localeCompare(b.date));
  const monthlyModel = loadMonthlyReturns(root);

  for (let i = 0; i < asc.length; i++) {
    const cur = asc[i]!;
    cur.chronologicalIndex = i;
    if (i > 0) {
      const prev = asc[i - 1]!;
      const pm = weightMap(prev.rows);
      const cm = weightMap(cur.rows);
      const entries: FlowRow[] = [];
      const exits: FlowRow[] = [];
      for (const [t, row] of cm) {
        if (!pm.has(t)) {
          entries.push({
            ticker: row.ticker,
            company: row.company,
            weightPct: row.weightPct,
          });
        }
      }
      for (const [t, row] of pm) {
        if (!cm.has(t)) {
          exits.push({
            ticker: row.ticker,
            company: row.company,
            weightPct: row.weightPct,
          });
        }
      }
      const tbillInTickerFlows =
        entries.some((e) => CASH_SLEEVE_TICKERS.has(e.ticker.trim().toUpperCase())) ||
        exits.some((e) => CASH_SLEEVE_TICKERS.has(e.ticker.trim().toUpperCase()));
      const prevCash = sumCashSleeveWeight(prev.rows);
      const curCash = sumCashSleeveWeight(cur.rows);
      const cashDeltaPct = (curCash - prevCash) * 100;
      if (Math.abs(cashDeltaPct) >= 0.05 && !tbillInTickerFlows) {
        if (cashDeltaPct > 0) {
          entries.push({
            ticker: "TBILL_PROXY",
            company: "T-Bills (ajuste vs. mês anterior)",
            weightPct: cashDeltaPct,
          });
        } else {
          exits.push({
            ticker: "TBILL_PROXY",
            company: "T-Bills (ajuste vs. mês anterior)",
            weightPct: -cashDeltaPct,
          });
        }
      }
      entries.sort((a, b) => (b.weightPct || 0) - (a.weightPct || 0));
      exits.sort((a, b) => (b.weightPct || 0) - (a.weightPct || 0));
      cur.entries = entries;
      cur.exits = exits;
    }

    if (i >= 2 && monthlyModel) {
      const yms = threeCalendarMonthsBeforeRebalance(cur.date);
      cur.priorThreeMonthReturns = yms.map((month) => ({
        month,
        label: formatMonthLabelPt(month),
        retPct: monthlyModel.returns.has(month) ? monthlyModel.returns.get(month)! * 100 : null,
      }));
      cur.equityChartSource = monthlyModel.sourceRel;
    }
  }

  /** Mais antigo primeiro — o histórico “começa” no 1.º mês; o mini-gráfico continua só quando há 3.º rebalance + equity. */
  asc.sort((a, b) => a.date.localeCompare(b.date));
  return asc;
}

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const root = projectRoot();
  const lookup = loadCompanyLookup(root);
  const pack = mergeWeightSources(root, lookup);
  if (!pack || pack.merged.size === 0) {
    return res.status(404).json({
      ok: false,
      error:
        "Nenhum CSV de histórico encontrado (weights_by_rebalance*.csv). Coloca um em backend/data/ ou freeze/.",
      tried: [...CANDIDATE_FILES].map((r) => r.split("/").join(path.sep)),
    });
  }

  const months = buildMonthsFromMerged(pack.merged, pack.turnoverByDate, lookup, root);
  const sourcePath =
    pack.sourcesUsed.length === 1
      ? pack.sourcesUsed[0]!
      : `merge:${pack.sourcesUsed.length} ficheiros (${pack.sourcesUsed.slice(0, 3).join(", ")}${pack.sourcesUsed.length > 3 ? "…" : ""})`;

  return res.status(200).json({
    ok: true,
    sourcePath: sourcePath.replace(/\\/g, "/"),
    sourceFiles: pack.sourcesUsed,
    nMonths: months.length,
    months,
  });
}
