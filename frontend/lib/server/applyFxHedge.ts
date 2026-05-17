/**
 * applyFxHedge.ts
 *
 * Applies an EUR/USD hedge adjustment to a daily equity series.
 *
 * Logic:
 *   For each day t:
 *     ret_model[t]   = equity[t] / equity[t-1] - 1
 *     ret_adjusted[t] = ret_model[t] - hedge_pct × usd_exposure[t] × equity_pct[t] × fx_ret[t]
 *
 *   where fx_ret[t] is the daily return of EUR/USD  (positive = USD weakens vs EUR,
 *   which hurts an unhedged EUR investor in USD assets).
 *
 * hedge_pct:  0   = Aberta (no hedge)
 *             0.5 = Parcial (~50% hedged)
 *             0.9 = Protegida (~90% hedged)
 *
 * Returned: a new equity array (same length) re-indexed so equity[0] == original equity[0].
 */

import fs from "fs";
import path from "path";

import { resolveDecideProjectRoot } from "./decideProjectRoot";
import { FREEZE_PLAFONADO_MODEL_DIR } from "../freezePlafonadoDir";

export type FxExposureLevel = "aberta" | "parcial" | "protegida";

export const FX_HEDGE_PCT: Record<FxExposureLevel, number> = {
  aberta:    0.0,
  parcial:   0.5,
  protegida: 0.9,
};

// ── CSV parsers ──────────────────────────────────────────────────────────────

function parseCsvMap(
  text: string,
  dateCol: string,
  valueCol: string,
): Map<string, number> {
  const map = new Map<string, number>();
  const lines = text.replace(/\r/g, "").split("\n").filter(Boolean);
  if (lines.length < 2) return map;
  const headers = lines[0].split(",").map((h) => h.trim().toLowerCase());
  const dIdx = headers.indexOf(dateCol.toLowerCase());
  const vIdx = headers.indexOf(valueCol.toLowerCase());
  if (dIdx < 0 || vIdx < 0) return map;
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",");
    const d = (cols[dIdx] ?? "").trim().slice(0, 10);
    const v = parseFloat(cols[vIdx] ?? "");
    if (d && isFinite(v)) map.set(d, v);
  }
  return map;
}

// ── USD exposure from weights CSV ─────────────────────────────────────────────
// Returns a map: rebalance_date → fraction of portfolio in USD zone (0–1).

function buildUsdExposureMap(weightsPath: string): Map<string, number> | null {
  if (!fs.existsSync(weightsPath)) return null;
  let text: string;
  try { text = fs.readFileSync(weightsPath, "utf8"); } catch { return null; }
  const lines = text.replace(/\r/g, "").split("\n").filter(Boolean);
  if (lines.length < 2) return null;
  const headers = lines[0].split(",").map((h) => h.trim().toLowerCase());
  const dateIdx   = headers.indexOf("rebalance_date");
  const tickerIdx = headers.indexOf("ticker");
  const zoneIdx   = headers.indexOf("zone");
  const countryIdx = headers.indexOf("country");
  const weightIdx = headers.findIndex((h) => ["final_weight", "base_weight", "weight"].includes(h));
  if (dateIdx < 0 || weightIdx < 0) return null;

  const byDate = new Map<string, { usd: number; total: number }>();
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",");
    const d      = (cols[dateIdx] ?? "").trim();
    const ticker = (cols[tickerIdx] ?? "").trim().toUpperCase();
    const zone   = (cols[zoneIdx ?? -1] ?? "").trim().toUpperCase();
    const country = (cols[countryIdx ?? -1] ?? "").trim().toUpperCase();
    const w      = parseFloat(cols[weightIdx] ?? "");
    if (!d || !isFinite(w) || w <= 0) continue;
    // Skip cash/XEON
    if (ticker === "TBILL_PROXY" || ticker === "XEON" || ticker.startsWith("CASH") || ticker.startsWith("TBILL")) continue;
    const isUsd = zone === "US" || country === "US";
    const cur = byDate.get(d) ?? { usd: 0, total: 0 };
    byDate.set(d, { usd: cur.usd + (isUsd ? w : 0), total: cur.total + w });
  }

  const result = new Map<string, number>();
  for (const [d, { usd, total }] of byDate) {
    result.set(d, total > 0 ? usd / total : 0.70);
  }
  return result;
}

// Given a series date, find the most recent rebal date <= it
function interpolateUsdExposure(
  date: string,
  rebalDates: string[],
  usdMap: Map<string, number>,
  defaultExposure = 0.70,
): number {
  let expo = defaultExposure;
  for (const d of rebalDates) {
    if (d > date) break;
    expo = usdMap.get(d) ?? expo;
  }
  return expo;
}

// ── Simple module-level cache (avoids re-reading on every API call) ──────────

let _fxCache: Map<string, number> | null = null;
let _usdMapCache: Map<string, number> | null = null;
let _rebalDatesCache: string[] | null = null;

function getCachedFxMap(fxPath: string): Map<string, number> {
  if (!_fxCache) {
    try {
      const text = fs.readFileSync(fxPath, "utf8");
      _fxCache = parseCsvMap(text, "date", "ret");
    } catch {
      _fxCache = new Map();
    }
  }
  return _fxCache;
}

function getCachedUsdMap(weightsPath: string): { map: Map<string, number>; rebalDates: string[] } {
  if (!_usdMapCache || !_rebalDatesCache) {
    _usdMapCache = buildUsdExposureMap(weightsPath) ?? new Map();
    _rebalDatesCache = [..._usdMapCache.keys()].sort();
  }
  return { map: _usdMapCache, rebalDates: _rebalDatesCache };
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Applies FX hedge adjustment to an equity overlay series.
 * Returns the series unchanged if hedgePct === 0 (Aberta) or data unavailable.
 *
 * @param dates          ISO date strings parallel to equitySeries
 * @param equitySeries   Cumulative equity index (e.g. starts at 1.0)
 * @param hedgePct       0 = no hedge, 0.5 = partial, 0.9 = protected
 * @param cwd            Project working directory (to resolve data paths)
 */
export function applyFxHedgeToSeries(
  dates: string[],
  equitySeries: number[],
  hedgePct: number,
  cwd: string,
): number[] {
  if (hedgePct === 0 || dates.length < 2 || equitySeries.length < 2) {
    return equitySeries; // Nothing to do for "Aberta"
  }

  const root       = resolveDecideProjectRoot(cwd);
  const fxPath     = path.join(root, "backend", "data", "fx_EURUSD_daily.csv");
  const weightsPath = path.join(root, "freeze", FREEZE_PLAFONADO_MODEL_DIR, "model_outputs", "weights_by_rebalance.csv");

  const fxMap              = getCachedFxMap(fxPath);
  const { map: usdMap, rebalDates } = getCachedUsdMap(weightsPath);

  const n = Math.min(dates.length, equitySeries.length);
  const adjusted = [equitySeries[0]]; // keep start value

  for (let i = 1; i < n; i++) {
    const date     = (dates[i] ?? "").slice(0, 10);
    const prevNav  = equitySeries[i - 1];
    const nav      = equitySeries[i];
    if (prevNav <= 0) { adjusted.push(nav); continue; }

    const dailyRet = nav / prevNav - 1;
    const fxRet    = fxMap.get(date) ?? 0; // daily EUR/USD return
    const usdExp   = interpolateUsdExposure(date, rebalDates, usdMap);

    // The equity_overlayed series already has XEON accounted for (sometimes up to 30-40%).
    // We approximate the equity sleeve as 1 – XEON via a conservative estimate of ~0.70
    // (monthly weights give daily XEON; without that data we use the long-run average).
    // usdExp already reflects only equity portion of USD stocks (XEON excluded in weights CSV).
    const hedgeAdj = hedgePct * usdExp * fxRet;

    const adjRet   = dailyRet - hedgeAdj;
    adjusted.push(adjusted[adjusted.length - 1] * (1 + adjRet));
  }

  return adjusted;
}

export function normalizeFxExposure(raw: unknown): FxExposureLevel {
  const s = String(raw ?? "aberta").toLowerCase().trim();
  if (s === "protegida" || s === "protected" || s === "hedged") return "protegida";
  if (s === "parcial" || s === "partial") return "parcial";
  return "aberta";
}
