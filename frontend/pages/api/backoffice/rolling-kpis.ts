/**
 * GET /api/backoffice/rolling-kpis
 *
 * Lê o freeze CSV (moderado) e calcula:
 *   - CAGR rolling 5y e 10y (modelo e benchmark)
 *   - Spread rolling (modelo − benchmark)
 *   - Sharpe relativo rolling 5y
 *   - Z-score do spread 5y actual vs distribuição histórica
 *   - Percentil de recovery actual vs histórico
 *   - Decisão semáforo (verde / amarelo / vermelho)
 */
import type { NextApiRequest, NextApiResponse } from "next";
import fs from "fs";
import path from "path";
import { denyIfBackofficeDisabled } from "../../../lib/server/backofficeApiGuard";

const WINDOW_5Y = 252 * 5;
const WINDOW_10Y = 252 * 10;
const RF_DAILY = 0.02 / 252;

function readFreezeCsv(): { dates: string[]; equity: number[]; bench: number[] } | null {
  const csvPath = path.join(
    process.cwd(),
    "data",
    "landing",
    "freeze-cap15",
    "model_equity_final_20y.csv",
  );
  if (!fs.existsSync(csvPath)) return null;
  try {
    const lines = fs.readFileSync(csvPath, "utf8").split(/\r?\n/).filter(Boolean);
    if (lines.length < 2) return null;
    const headers = lines[0]!.split(",").map((h) => h.trim().toLowerCase());
    const dateIdx = headers.findIndex((h) => h.includes("date") || h === "ds");
    const eqIdx = headers.findIndex((h) =>
      h.includes("equity_overlayed") || h.includes("equity_final") || h.includes("model_eq"),
    );
    const bIdx = headers.findIndex((h) =>
      h.includes("benchmark") || h.includes("bench_eq") || h.includes("bench"),
    );
    if (dateIdx < 0 || eqIdx < 0) return null;

    const dates: string[] = [];
    const equity: number[] = [];
    const bench: number[] = [];
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i]!.split(",");
      const d = cols[dateIdx]?.trim() ?? "";
      const e = parseFloat(cols[eqIdx]?.trim() ?? "");
      const b = bIdx >= 0 ? parseFloat(cols[bIdx]?.trim() ?? "") : NaN;
      if (!d || !isFinite(e) || e <= 0) continue;
      dates.push(d);
      equity.push(e);
      bench.push(isFinite(b) && b > 0 ? b : e);
    }
    return { dates, equity, bench };
  } catch {
    return null;
  }
}

function cagr(eq: number[], years: number): number | null {
  if (years <= 0 || eq.length < 2) return null;
  const f = eq[0]!, l = eq[eq.length - 1]!;
  if (!(f > 0) || !(l > 0)) return null;
  return Math.pow(l / f, 1 / years) - 1;
}

function annSharpe(eq: number[]): number | null {
  if (eq.length < 20) return null;
  const rets: number[] = [];
  for (let i = 1; i < eq.length; i++) {
    const r = eq[i]! / eq[i - 1]! - 1;
    if (isFinite(r)) rets.push(r - RF_DAILY);
  }
  if (!rets.length) return null;
  const mu = rets.reduce((a, b) => a + b, 0) / rets.length;
  const ss = rets.reduce((a, b) => a + (b - mu) ** 2, 0);
  const sd = Math.sqrt(ss / (rets.length - 1));
  return sd > 0 ? (mu / sd) * Math.sqrt(252) : null;
}

function sharpeRelative(mEq: number[], bEq: number[]): number | null {
  if (mEq.length < 20 || bEq.length < 20) return null;
  const n = Math.min(mEq.length, bEq.length);
  const excess: number[] = [];
  for (let i = 1; i < n; i++) {
    const rm = mEq[i]! / mEq[i - 1]! - 1;
    const rb = bEq[i]! / bEq[i - 1]! - 1;
    if (isFinite(rm) && isFinite(rb)) excess.push(rm - rb);
  }
  const mu = excess.reduce((a, b) => a + b, 0) / excess.length;
  const ss = excess.reduce((a, b) => a + (b - mu) ** 2, 0);
  const sd = Math.sqrt(ss / (excess.length - 1));
  return sd > 0 ? (mu / sd) * Math.sqrt(252) : null;
}

function pctNegative(values: (number | null)[]): number {
  const valid = values.filter((v): v is number => v !== null && isFinite(v));
  if (!valid.length) return 0;
  return valid.filter((v) => v < 0).length / valid.length;
}

function percentile(arr: number[], value: number): number {
  if (!arr.length) return 0.5;
  const below = arr.filter((v) => v <= value).length;
  return below / arr.length;
}

function maxDD(eq: number[]): number {
  let peak = eq[0]!, dd = 0;
  for (const v of eq) {
    if (v > peak) peak = v;
    const d = peak > 0 ? (v / peak - 1) : 0;
    if (d < dd) dd = d;
  }
  return dd;
}

function recoveryDays(eq: number[]): number[] {
  let peak = eq[0]!, peakIdx = 0;
  const recoveries: number[] = [];
  for (let i = 1; i < eq.length; i++) {
    if (eq[i]! >= peak) {
      if (eq[i]! > eq[peakIdx]!) {
        recoveries.push(i - peakIdx);
        peak = eq[i]!;
        peakIdx = i;
      }
    }
  }
  return recoveries;
}

function zScore(value: number, values: number[]): number | null {
  if (values.length < 5) return null;
  const mu = values.reduce((a, b) => a + b, 0) / values.length;
  const ss = values.reduce((a, b) => a + (b - mu) ** 2, 0);
  const sd = Math.sqrt(ss / (values.length - 1));
  return sd > 0 ? (value - mu) / sd : null;
}

export type RollingKpisResult = {
  dataEnd: string;
  nObs: number;
  rolling5y: {
    cagrModel: number | null;
    cagrBench: number | null;
    spread: number | null;
    sharpeRelative: number | null;
    sharpeModel: number | null;
    zScoreSpread: number | null;
    pctNegativeSharpeRel: number;
    mddModel: number | null;
  };
  rolling10y: {
    cagrModel: number | null;
    cagrBench: number | null;
    spread: number | null;
    sharpeModel: number | null;
    mddModel: number | null;
  };
  recovery: {
    currentStreakDays: number;
    percentile: number | null;
    inDrawdown: boolean;
  };
  signal: "verde" | "amarelo" | "vermelho";
  signalReasons: string[];
};

function computeRollingKpis(
  dates: string[],
  equity: number[],
  bench: number[],
): RollingKpisResult {
  const n = dates.length;
  const dataEnd = dates[n - 1] ?? "";

  // ── 5y window ──────────────────────────────────────────────────────
  const start5 = Math.max(0, n - WINDOW_5Y);
  const eq5 = equity.slice(start5);
  const bq5 = bench.slice(start5);
  const years5 = eq5.length / 252;

  const cagrModel5 = cagr(eq5, years5);
  const cagrBench5 = cagr(bq5, years5);
  const spread5 = cagrModel5 != null && cagrBench5 != null ? cagrModel5 - cagrBench5 : null;
  const sharpeMod5 = annSharpe(eq5);
  const sharpeRel5 = sharpeRelative(eq5, bq5);
  const mdd5 = maxDD(eq5);

  // z-score: compute rolling 5y spread over all available 252-day steps
  const historicalSpreads: number[] = [];
  const historicalSharpeRels: number[] = [];
  const step = 21;
  for (let i = WINDOW_5Y; i <= n; i += step) {
    const s = i - WINDOW_5Y;
    const eSlice = equity.slice(s, i);
    const bSlice = bench.slice(s, i);
    const yrs = eSlice.length / 252;
    const cm = cagr(eSlice, yrs);
    const cb = cagr(bSlice, yrs);
    if (cm != null && cb != null) historicalSpreads.push(cm - cb);
    const sr = sharpeRelative(eSlice, bSlice);
    if (sr != null) historicalSharpeRels.push(sr);
  }
  const zSpread5 = spread5 != null ? zScore(spread5, historicalSpreads) : null;
  const pctNegSharpeRel = pctNegative(historicalSharpeRels);

  // ── 10y window ─────────────────────────────────────────────────────
  const start10 = Math.max(0, n - WINDOW_10Y);
  const eq10 = equity.slice(start10);
  const bq10 = bench.slice(start10);
  const years10 = eq10.length / 252;
  const cagrModel10 = cagr(eq10, years10);
  const cagrBench10 = cagr(bq10, years10);
  const spread10 = cagrModel10 != null && cagrBench10 != null ? cagrModel10 - cagrBench10 : null;
  const sharpeMod10 = annSharpe(eq10);
  const mdd10 = maxDD(eq10);

  // ── Recovery ───────────────────────────────────────────────────────
  const allRecoveries = recoveryDays(equity);
  let peak = equity[0]!;
  for (const v of equity) if (v > peak) peak = v;
  const lastVal = equity[n - 1]!;
  const inDD = lastVal < peak * 0.999;
  let streak = 0;
  if (inDD) {
    for (let i = n - 1; i >= 0; i--) {
      if (equity[i]! >= peak * 0.999) break;
      streak++;
    }
  }
  const recovPct = allRecoveries.length
    ? percentile(allRecoveries, streak)
    : null;

  // ── Semáforo ───────────────────────────────────────────────────────
  const reasons: string[] = [];
  let reds = 0, yellows = 0;

  if (sharpeRel5 !== null && sharpeRel5 < 0) {
    yellows++;
    reasons.push(`Sharpe relativo 5y negativo (${sharpeRel5.toFixed(2)})`);
    if (pctNegSharpeRel > 0.6) {
      reds++;
      reasons.push(`Sharpe relativo negativo em ${(pctNegSharpeRel * 100).toFixed(0)}% do tempo (>60%)`);
    }
  }
  if (zSpread5 !== null && zSpread5 < -1) {
    yellows++;
    reasons.push(`Z-score spread 5y = ${zSpread5.toFixed(2)} (< −1σ)`);
    if (zSpread5 < -2) { reds++; reasons.push(`Z-score spread 5y < −2σ (degradação anómala)`); }
  }
  if (spread5 !== null && spread5 < 0) {
    reds++;
    reasons.push(`Spread CAGR 5y negativo (${(spread5 * 100).toFixed(1)}pp)`);
  }
  if (spread10 !== null && spread10 < 0.03) {
    yellows++;
    reasons.push(`Spread CAGR 10y comprimido (${(spread10! * 100).toFixed(1)}pp)`);
  }
  if (recovPct !== null && recovPct > 0.8) {
    yellows++;
    reasons.push(`Recovery no percentil ${(recovPct * 100).toFixed(0)} vs histórico`);
    if (recovPct > 0.9) { reds++; reasons.push(`Recovery > P90 (prolongado)`); }
  }

  const signal: "verde" | "amarelo" | "vermelho" =
    reds >= 3 ? "vermelho" : yellows >= 1 || reds >= 1 ? "amarelo" : "verde";

  return {
    dataEnd,
    nObs: n,
    rolling5y: {
      cagrModel: cagrModel5,
      cagrBench: cagrBench5,
      spread: spread5,
      sharpeRelative: sharpeRel5,
      sharpeModel: sharpeMod5,
      zScoreSpread: zSpread5,
      pctNegativeSharpeRel: pctNegSharpeRel,
      mddModel: mdd5,
    },
    rolling10y: {
      cagrModel: cagrModel10,
      cagrBench: cagrBench10,
      spread: spread10,
      sharpeModel: sharpeMod10,
      mddModel: mdd10,
    },
    recovery: {
      currentStreakDays: streak,
      percentile: recovPct,
      inDrawdown: inDD,
    },
    signal,
    signalReasons: reasons,
  };
}

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (denyIfBackofficeDisabled(res, req)) return;
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const data = readFreezeCsv();
  if (!data) {
    return res.status(500).json({ ok: false, error: "freeze_csv_not_found" });
  }

  const result = computeRollingKpis(data.dates, data.equity, data.bench);
  return res.status(200).json({ ok: true, result });
}
