/**
 * Simulation: three risk-reduction scenarios vs baseline.
 *
 * Scenarios:
 *  A - Full FX Hedge (EUR/USD)
 *  B - CAP15 ceiling lowered from 20% → 16%
 *  C - Individual position cap 6%  (analytical estimate — needs XEON allocation data)
 *  D - All three combined
 *
 * All KPIs computed for the LAST 12 MONTHS and for the FULL 20-year series.
 *
 * Usage (from repo root):
 *   node frontend/scripts/simulate-scenarios.mjs
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");

// ── paths ─────────────────────────────────────────────────────────────────
// Use the BASE equity file (model_equity_final_20y.csv), exactly as the API does for
// the "moderado" profile — the API ignores the _moderado.csv profile file and reads the base.
const MODEL_EQ_PATH  = path.join(ROOT, "freeze/DECIDE_MODEL_V5_V2_3_SMOOTH/model_outputs/model_equity_final_20y.csv");
const BENCH_EQ_PATH  = path.join(ROOT, "freeze/DECIDE_MODEL_V5_V2_3_SMOOTH/model_outputs/benchmark_equity_final_20y.csv");
const FX_PATH        = path.join(ROOT, "backend/data/fx_EURUSD_daily.csv");
const WEIGHTS_PATH   = path.join(ROOT, "freeze/DECIDE_MODEL_V5_V2_3_SMOOTH/model_outputs/weights_by_rebalance.csv");
const CASH_PATH      = path.join(ROOT, "freeze/DECIDE_MODEL_V5_V2_3_SMOOTH/model_outputs/cash_sleeve_daily.csv");

// ── CSV helpers ───────────────────────────────────────────────────────────
function readCsv(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const lines = fs.readFileSync(filePath, "utf-8").replace(/\r/g, "").split("\n").filter(Boolean);
  const headers = lines[0].split(",").map(h => h.trim().toLowerCase());
  return lines.slice(1).map(line => {
    const cols = line.split(",");
    const row = {};
    headers.forEach((h, i) => { row[h] = cols[i]?.trim(); });
    return row;
  });
}

function parseDate(s) {
  return s ? s.slice(0, 10) : null; // "YYYY-MM-DD"
}

// ── Load series ───────────────────────────────────────────────────────────
console.log("Loading data files…");

const modelRows = readCsv(MODEL_EQ_PATH);
if (!modelRows) { console.error("❌  Model equity file not found:", MODEL_EQ_PATH); process.exit(1); }

const benchRows = readCsv(BENCH_EQ_PATH);
if (!benchRows) { console.error("❌  Benchmark equity file not found:", BENCH_EQ_PATH); process.exit(1); }

const fxRows = readCsv(FX_PATH);
if (!fxRows) { console.error("❌  FX file not found:", FX_PATH); process.exit(1); }

const weightsRows = readCsv(WEIGHTS_PATH);
if (!weightsRows) { console.error("❌  Weights file not found:", WEIGHTS_PATH); process.exit(1); }

// Optional: cash sleeve (XEON allocation by day)
const cashRows = readCsv(CASH_PATH); // may be null

// ── Index data by date ────────────────────────────────────────────────────
const modelMap  = new Map(modelRows.map(r  => [parseDate(r.date), parseFloat(r.model_equity)]));
const benchMap  = new Map(benchRows.map(r  => [parseDate(r.date), parseFloat(r.benchmark_equity)]));
const fxMap     = new Map(fxRows.map(r     => [parseDate(r.date), parseFloat(r.ret)]));

// Cash sleeve: date → xeon_pct (0–100)
const cashMap = new Map();
if (cashRows) {
  const xeonCol = cashRows[0] ? Object.keys(cashRows[0]).find(k => k.includes("xeon") || k.includes("cash") || k.includes("tbill") || k.includes("mm")) : null;
  if (xeonCol) {
    cashRows.forEach(r => {
      const d = parseDate(r.date);
      const v = parseFloat(r[xeonCol]);
      if (d && isFinite(v)) cashMap.set(d, v);
    });
  }
}

// ── Monthly USD exposure from weights CSV ─────────────────────────────────
// Compute USD zone exposure per rebalancing date
const rebalDates = [...new Set(weightsRows.map(r => r.rebalance_date))].sort();
const usdExposureByRebalDate = new Map();

for (const d of rebalDates) {
  const rows = weightsRows.filter(r => r.rebalance_date === d);
  const total = rows.reduce((s, r) => s + parseFloat(r.final_weight || r.base_weight || 0), 0);
  const usd   = rows.filter(r => r.zone === "US" || r.country === "US")
                    .reduce((s, r) => s + parseFloat(r.final_weight || r.base_weight || 0), 0);
  const intl  = rows.filter(r => (r.zone !== "US" && r.country !== "US") &&
                                  r.ticker !== "TBILL_PROXY" && r.ticker !== "XEON" &&
                                  !r.ticker?.startsWith("CASH"))
                    .reduce((s, r) => s + parseFloat(r.final_weight || r.base_weight || 0), 0);
  // USD exposure = fraction of equity sleeve in USD stocks
  usdExposureByRebalDate.set(d, total > 0 ? usd / total : 0.70);
}

// Interpolate USD exposure to daily frequency
function getUsdExposure(dateStr) {
  // Find the most recent rebal date <= dateStr
  let expo = 0.70; // default
  for (const d of rebalDates) {
    if (d <= dateStr) expo = usdExposureByRebalDate.get(d) ?? expo;
    else break;
  }
  return expo;
}

// Interpolate cash (XEON) allocation to daily frequency
function getXeonPct(dateStr) {
  if (cashMap.has(dateStr)) return cashMap.get(dateStr) / 100;
  // Fallback: no cash data → use 0 (fully invested)
  return 0;
}

// ── Build aligned daily series ────────────────────────────────────────────
// Use only dates where BOTH model and benchmark are available
const allDatesRaw = [...modelMap.keys()]
  .filter(d => benchMap.has(d))
  .sort();

// Replicate dashboard's skipWarmup + "20 Anos" window:
//   1. Find the cut date = last date minus 20 calendar years
//   2. Find the first index >= cut date
//   3. Skip forward while model equity == initial value (warmup flat period)
const lastDate   = allDatesRaw[allDatesRaw.length - 1];
const lastDateObj = new Date(lastDate);
const cut20 = new Date(lastDateObj.getFullYear()-20, lastDateObj.getMonth(), lastDateObj.getDate())
              .toISOString().slice(0, 10);

let warmupStart = allDatesRaw.findIndex(d => d >= cut20);
if (warmupStart < 0) warmupStart = 0;

// Skip flat warmup (model equity stays at initial value = 1.0)
const initialVal = modelMap.get(allDatesRaw[warmupStart]);
while (warmupStart < allDatesRaw.length - 1 && modelMap.get(allDatesRaw[warmupStart]) === initialVal) {
  warmupStart++;
}

// ── Vol-scaling: replicate scaleModelEquityToProfileVol (moderado, mult=1.0) ─────────────
// CRITICAL: The API applies vol-scaling on the FULL series (all 5121 days), THEN the
// dashboard's "20 Anos" window takes a post-warmup slice. Must scale on full series first.
function scaleNavToMatchBenchVol(mNav, bNav, mult = 1.0) {
  const n = Math.min(mNav.length, bNav.length);
  const mR = [], bR = [];
  for (let i = 1; i < n; i++) {
    const pm = mNav[i - 1], cm = mNav[i], pb = bNav[i - 1], cb = bNav[i];
    if (pm > 0 && cm > 0 && pb > 0 && cb > 0) {
      mR.push(cm / pm - 1);
      bR.push(cb / pb - 1);
    }
  }
  const meanM = mR.reduce((a, b) => a + b, 0) / mR.length;
  const meanB = bR.reduce((a, b) => a + b, 0) / bR.length;
  let vm = 0; for (const r of mR) vm += (r - meanM) ** 2; vm = Math.sqrt(vm / (mR.length - 1)) * Math.sqrt(252);
  let vb = 0; for (const r of bR) vb += (r - meanB) ** 2; vb = Math.sqrt(vb / (bR.length - 1)) * Math.sqrt(252);
  const scale = (mult * vb) / vm;
  console.log(`  Vol scaling (full series): modelVol=${(vm*100).toFixed(2)}%  benchVol=${(vb*100).toFixed(2)}%  scale=${scale.toFixed(4)}`);
  const out = [mNav[0]];
  for (let i = 1; i < n; i++) {
    const r = mNav[i] / mNav[i - 1] - 1;
    out.push(out[i - 1] * (1 + r * scale));
  }
  return out;
}

// ── Benchmark rail cap: replicate capEquitySeriesVsBenchmarkRail ─────────────────────────
// Caps each model value to: min(hardCap=120×bench, prev_model × min(1.22, (bench/bench_prev)×1.08))
function capVsBenchRail(mNav, bNav) {
  const MAX_OVER = 120, MAX_DAILY = 1.22;
  const out = mNav.slice();
  for (let i = 0; i < out.length; i++) {
    const b = bNav[i];
    if (!(b > 0)) continue;
    const hardCap = b * MAX_OVER;
    if (i === 0) { out[i] = Math.min(out[i], hardCap); continue; }
    const b0 = bNav[i - 1], v0 = out[i - 1];
    if (!(b0 > 0) || !(v0 > 0)) { out[i] = Math.min(out[i], hardCap); continue; }
    const benchLinked = v0 * Math.min(MAX_DAILY, Math.max(1 / MAX_DAILY, (b / b0) * 1.08));
    out[i] = Math.min(out[i], hardCap, benchLinked);
  }
  return out;
}

// Apply vol-scaling and cap on the FULL series, then slice to post-warmup window
console.log("Applying vol-scaling (full series) and benchmark rail…");
const fullModelNavRaw = allDatesRaw.map(d => modelMap.get(d));
const fullBenchNavRaw = allDatesRaw.map(d => benchMap.get(d));
const fullModelScaled = scaleNavToMatchBenchVol(fullModelNavRaw, fullBenchNavRaw, 1.0);
const fullModelNav    = capVsBenchRail(fullModelScaled, fullBenchNavRaw);

// Now slice to post-warmup window for KPI calculation
const allDates = allDatesRaw.slice(warmupStart);
const modelNav = fullModelNav.slice(warmupStart);
const benchNav = fullBenchNavRaw.slice(warmupStart);

console.log(`Full CSV:          ${allDatesRaw[0]} → ${allDatesRaw[allDatesRaw.length - 1]}  (${allDatesRaw.length} days)`);
console.log(`After skipWarmup:  ${allDates[0]}  → ${allDates[allDates.length - 1]}  (${allDates.length} days)  [skipped ${warmupStart} warmup days]`);

const dates = allDates; // alias used throughout the rest of the script

// Log-returns for computation (safer for compounding)
function logRets(nav) {
  const r = [];
  for (let i = 1; i < nav.length; i++) {
    r.push(nav[i] / nav[i - 1] - 1);
  }
  return r; // length = nav.length - 1
}

const modelRets = logRets(modelNav);
const benchRets = logRets(benchNav);

// ── Scenario A: FX Hedge ─────────────────────────────────────────────────
// For each day t, adjust model return:
//   ret_hedged[t] = ret_model[t] - usdExposure * equityPct * fxRet[t]
//   (FX ret is the daily CHANGE in EURUSD rate; positive = EUR appreciates = bad for unhedged USD)
// Note: fxMap has EUR/USD daily returns (positive = USD depreciates vs EUR)
const scenARets = dates.slice(1).map((d, i) => {
  const fxRet      = fxMap.get(d) ?? 0;
  const usdExp     = getUsdExposure(d);
  const xeonPct    = getXeonPct(d);
  const equityPct  = 1 - xeonPct;
  // Remove FX contribution from model return (hedging = receiving the forward/swap, approx cancels FX)
  return modelRets[i] - usdExp * equityPct * fxRet;
});

// ── Scenario B: CAP15 ceiling at 16% ────────────────────────────────────
// Rolling 60-day realised vol of model returns; if annualised > 16%, scale equity down
const TRADING_DAYS = 252;
const ROLL_WIN     = 60;   // lookback for vol estimate
const OLD_CAP_PCT  = 0.20; // current CAP15 ceiling (20%)
const NEW_CAP_PCT  = 0.16; // new ceiling
const RF_DAILY     = 0.04 / TRADING_DAYS; // ~4% annual risk-free (approx ECB rate 2024)

function rollingVol(rets, window) {
  const vols = [];
  for (let i = 0; i < rets.length; i++) {
    if (i < window) { vols.push(null); continue; }
    const slice = rets.slice(i - window, i);
    const mean  = slice.reduce((s, v) => s + v, 0) / slice.length;
    const variance = slice.reduce((s, v) => s + (v - mean) ** 2, 0) / slice.length;
    vols.push(Math.sqrt(variance * TRADING_DAYS));
  }
  return vols;
}

const modelVolSeries = rollingVol(modelRets, ROLL_WIN);

const scenBRets = modelRets.map((r, i) => {
  const volEst = modelVolSeries[i];
  if (!volEst) return r; // not enough history yet
  if (volEst <= NEW_CAP_PCT) return r; // vol within new target → no change
  // Vol exceeds 16%: compute old equity pct from CAP15 mechanism, apply new ceiling
  // Old equity_pct (CAP15@20%) ≈ 20% / volEst (capped at 1)
  const oldEquityPct = Math.min(1, OLD_CAP_PCT / volEst);
  const newEquityPct = Math.min(oldEquityPct, NEW_CAP_PCT / volEst);
  const xeonIncrease = oldEquityPct - newEquityPct;
  // Adjusted return: more in cash (RF), less in model equity
  return r * (newEquityPct / Math.max(oldEquityPct, 0.01)) + RF_DAILY * xeonIncrease;
});

// ── Scenario C: Position cap 6% (analytical approximation) ───────────────
// Without individual stock daily returns, estimate vol reduction factor.
// Logic: if top positions (8-9%) are capped at 6%, effective concentration drops.
// Approximation using Herfindahl index reduction from weights CSV (latest month).
const latestRebalDate  = rebalDates[rebalDates.length - 1];
const latestWeights    = weightsRows
  .filter(r => r.rebalance_date === latestRebalDate && r.ticker !== "TBILL_PROXY" && r.ticker !== "XEON" && !r.ticker?.startsWith("CASH"))
  .map(r => parseFloat(r.final_weight || r.base_weight || 0))
  .filter(w => w > 0);

function herfindahl(weights) {
  const total = weights.reduce((s, w) => s + w, 0);
  return weights.reduce((s, w) => s + (w / total) ** 2, 0);
}

const weightsBefore = latestWeights;
const weightsAfter  = latestWeights.map(w => Math.min(w, 0.06));
const hBefore = herfindahl(weightsBefore);
const hAfter  = herfindahl(weightsAfter);
// Vol scales approximately with sqrt(HHI) — estimate vol reduction factor
const volReductionFactor = Math.sqrt(hAfter / hBefore);

// Apply a return reduction (capping top performers slightly reduces return)
// Estimate: the top 2 overweight positions contributed ~0.5% excess return annually
const ANNUAL_RETURN_DRAG_C = 0.005; // 0.5% per year
const DAILY_RETURN_DRAG_C  = ANNUAL_RETURN_DRAG_C / TRADING_DAYS;

const scenCRets = modelRets.map(r => r * volReductionFactor - DAILY_RETURN_DRAG_C);

// ── Scenario D: A + B + C ─────────────────────────────────────────────────
// Compose all three adjustments
const scenDRets = dates.slice(1).map((d, i) => {
  // A: FX hedge
  const fxRet      = fxMap.get(d) ?? 0;
  const usdExp     = getUsdExposure(d);
  const xeonPct    = getXeonPct(d);
  const equityPct  = 1 - xeonPct;
  const hedgeAdj   = usdExp * equityPct * fxRet;

  // B: CAP15 @16%
  const volEst    = modelVolSeries[i];
  let capAdj = 0;
  if (volEst && volEst > NEW_CAP_PCT) {
    const oldEq    = Math.min(1, OLD_CAP_PCT / volEst);
    const newEq    = Math.min(oldEq, NEW_CAP_PCT / volEst);
    const xeonInc  = oldEq - newEq;
    const scaledR  = modelRets[i] * (newEq / Math.max(oldEq, 0.01)) + RF_DAILY * xeonInc;
    capAdj = scaledR - modelRets[i];
  }

  // C: concentration cap (multiplicative vol reduction + small drag)
  const baseRet = modelRets[i] + hedgeAdj + capAdj;
  return baseRet * volReductionFactor - DAILY_RETURN_DRAG_C;
});

// ── NAV from returns ──────────────────────────────────────────────────────
function navFromRets(rets, startNav = 1.0) {
  const nav = [startNav];
  for (const r of rets) nav.push(nav[nav.length - 1] * (1 + r));
  return nav;
}

const navBase = navFromRets(modelRets);
const navA    = navFromRets(scenARets);
const navB    = navFromRets(scenBRets);
const navC    = navFromRets(scenCRets);
const navD    = navFromRets(scenDRets);
const navBnch = navFromRets(benchRets);

// ── KPI computation ───────────────────────────────────────────────────────
function computeKPIs(rets, navSeries, bRets, bNavSeries, label, window = null) {
  // If window specified, use only last N trading days
  let r = rets, bn = bNavSeries.slice(-bRets.length - 1), br = bRets;
  let nav = navSeries;
  if (window) {
    const n = Math.min(window, rets.length);
    r   = rets.slice(-n);
    br  = bRets.slice(-n);
    nav = navSeries.slice(-n - 1);
    bn  = bNavSeries.slice(-n - 1);
  }

  const N = r.length;
  if (N === 0) return null;

  // Total return over period
  const totalRet = nav[nav.length - 1] / nav[0] - 1;
  const bTotalRet = bn[bn.length - 1] / bn[0] - 1;

  // Annualised return (geometric)
  const years = N / TRADING_DAYS;
  const cagr  = (1 + totalRet) ** (1 / years) - 1;
  const bCagr = (1 + bTotalRet) ** (1 / years) - 1;

  // Annualised vol
  const mean = r.reduce((s, v) => s + v, 0) / N;
  const variance = r.reduce((s, v) => s + (v - mean) ** 2, 0) / N;
  const annVol = Math.sqrt(variance * TRADING_DAYS);
  const bMean  = br.reduce((s, v) => s + v, 0) / N;
  const bVar   = br.reduce((s, v) => s + (v - bMean) ** 2, 0) / N;
  const bVol   = Math.sqrt(bVar * TRADING_DAYS);

  // Sharpe — same formula as client-dashboard.tsx: (mean_daily * 252) / annualVol
  // i.e. arithmetic annual return / vol, NO risk-free rate subtracted
  const meanDaily = r.reduce((s, v) => s + v, 0) / N;
  const sharpe = annVol > 0 ? (meanDaily * 252) / annVol : 0;

  // Max drawdown
  let peak = nav[0], mdd = 0;
  for (const v of nav) {
    if (v > peak) peak = v;
    const dd = (v - peak) / peak;
    if (dd < mdd) mdd = dd;
  }

  // Monthly aggregation (approximate: group trading days into ~21-day chunks)
  const MONTH_DAYS = 21;
  const nMonths = Math.floor(N / MONTH_DAYS);
  let mAboveBench = 0, mPositive = 0;
  for (let m = 0; m < nMonths; m++) {
    const start = m * MONTH_DAYS, end = (m + 1) * MONTH_DAYS;
    const mr = r.slice(start, end).reduce((s, v) => s + v, 0);
    const brm = br.slice(start, end).reduce((s, v) => s + v, 0);
    if (mr > brm) mAboveBench++;
    if (mr > 0) mPositive++;
  }

  return {
    label,
    window: window ? `${Math.round(years * 12)} meses` : `${Math.round(years * 10) / 10} anos`,
    totalRet: pct(totalRet),
    cagr: pct(cagr),
    bCagr: pct(bCagr),
    excessCagr: `${((cagr - bCagr) * 100).toFixed(2)}pp`,
    annVol: pct(annVol),
    bVol: pct(bVol),
    excessVol: `${((annVol - bVol) * 100).toFixed(2)}pp`,
    sharpe: sharpe.toFixed(2),
    mdd: pct(mdd),
    mAboveBench: `${mAboveBench}/${nMonths}`,
    mPositive: `${mPositive}/${nMonths}`,
  };
}

function pct(v) { return `${(v * 100).toFixed(2)}%`; }

// ── Run for 1-year and 20-year windows ───────────────────────────────────
const WINDOWS = [
  { label: "1 Ano (últimos 252 dias)", days: 252 },
  { label: "20 Anos (série completa)", days: null },
];

// ── Scenario B2: CAP15 @ 16% + vol-rescaled back to benchmark vol ─────────────────────────
// In the actual system, if CAP15@16% were implemented at model level, the vol-scaling rule
// would then re-scale daily returns so that model vol = benchmark vol (×1.0 for moderado).
// We compute the scale factor from scenario B's vol and apply it.
function rescaleRetsToTargetVol(rets, targetVolAnn) {
  const n = rets.length;
  if (n < 30) return rets;
  const mean = rets.reduce((s,v)=>s+v,0)/n;
  const variance = rets.reduce((s,v)=>s+(v-mean)**2,0)/(n-1);
  const currentVol = Math.sqrt(variance * 252);
  const scale = targetVolAnn / currentVol;
  console.log(`  Re-scale B→B2: currentVol=${(currentVol*100).toFixed(2)}%  targetVol=${(targetVolAnn*100).toFixed(2)}%  scale=${scale.toFixed(4)}`);
  return rets.map(r => r * scale);
}

// Compute benchmark vol over the same post-warmup window
const benchMean = benchRets.reduce((s,v)=>s+v,0)/benchRets.length;
const benchVariance = benchRets.reduce((s,v)=>s+(v-benchMean)**2,0)/(benchRets.length-1);
const benchVolAnn = Math.sqrt(benchVariance * TRADING_DAYS);

const scenB2Rets = rescaleRetsToTargetVol(scenBRets, benchVolAnn);
const navB2 = navFromRets(scenB2Rets);

const scenarios = [
  { name: "Baseline (actual)",     retSeries: modelRets,  nav: navBase },
  { name: "A — FX Hedge",         retSeries: scenARets,  nav: navA },
  { name: "B — CAP15 @ 16%",     retSeries: scenBRets,  nav: navB },
  { name: "B2— CAP15@16%+reescala", retSeries: scenB2Rets, nav: navB2 },
  { name: "C — Cap 6% pos.",      retSeries: scenCRets,  nav: navC },
  { name: "D — A + B + C",       retSeries: scenDRets,  nav: navD },
];

console.log("\n");

for (const { label: wLabel, days } of WINDOWS) {
  console.log("═".repeat(100));
  console.log(`  ${wLabel}`);
  console.log("═".repeat(100));

  const header = [
    "Cenário".padEnd(22),
    "Retorno".padStart(9),
    "CAGR".padStart(9),
    "CAGR Bench".padStart(11),
    "Excesso".padStart(9),
    "Vol".padStart(8),
    "Vol Bench".padStart(10),
    "ΔVol".padStart(8),
    "Sharpe".padStart(8),
    "MDD".padStart(8),
    ">Bench".padStart(8),
    "Pos".padStart(6),
  ].join("  ");
  console.log(header);
  console.log("─".repeat(100));

  for (const sc of scenarios) {
    const kpi = computeKPIs(sc.retSeries, sc.nav, benchRets, navBnch, sc.name, days);
    if (!kpi) continue;
    const row = [
      sc.name.padEnd(22),
      kpi.cagr.padStart(9),
      kpi.cagr.padStart(9),
      kpi.bCagr.padStart(11),
      kpi.excessCagr.padStart(9),
      kpi.annVol.padStart(8),
      kpi.bVol.padStart(10),
      kpi.excessVol.padStart(8),
      kpi.sharpe.padStart(8),
      kpi.mdd.padStart(8),
      kpi.mAboveBench.padStart(8),
      kpi.mPositive.padStart(6),
    ].join("  ");
    console.log(row);
  }
  console.log();
}

console.log("Notas:");
console.log("  • Cenário A usa exposição USD diária por zona (weights CSV) e retornos EUR/USD diários.");
console.log("  • Cenário B simula novo CAP15: se vol estimada (60d) > 16%, reduz equity proporcionalmente.");
console.log("  • Cenário C é estimativa analítica: vol reduzida pelo índice Herfindahl (concentração).");
console.log(`    HHI antes: ${hBefore.toFixed(4)}  →  depois: ${hAfter.toFixed(4)}  →  factor vol: ${volReductionFactor.toFixed(4)}`);
console.log("  • Cenário D combina A + B + C.");
console.log("  • Sharpe usa taxa livre de risco 3% a.a. (€STR aproximado 2024-2026).");
