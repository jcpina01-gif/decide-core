import fs from "fs";
import path from "path";
import { safeNumber, safeString } from "../clientReportCoreUtils";
import { FREEZE_PLAFONADO_MODEL_DIR } from "../freezePlafonadoDir";

function readJsonIfExists<T>(filePath: string): T | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
  } catch {
    return null;
  }
}

/**
 * Holdings de ``portfolio_final.json`` no freeze CAP15 — formato alinhado a
 * ``current_portfolio.positions`` do ``run-model`` (para reutilizar o mesmo map SSR).
 *
 * Usado quando **não** há mês oficial no CSV mas o payload traz só a conta (ex.: CSH2).
 */
export function tryFreezeHoldingsAsModelPositions(projectRoot: string): Record<string, unknown>[] | null {
  const pfPath = path.join(
    projectRoot,
    "freeze",
    FREEZE_PLAFONADO_MODEL_DIR,
    "model_outputs",
    "portfolio_final.json",
  );
  const pf = readJsonIfExists<{ holdings?: unknown[] }>(pfPath);
  const h = pf?.holdings;
  if (!Array.isArray(h) || h.length === 0) return null;
  const out: Record<string, unknown>[] = [];
  for (const raw of h) {
    const x = raw as Record<string, unknown>;
    const ticker = safeString(x?.ticker, "").trim().toUpperCase();
    if (!ticker) continue;
    const wp0 = safeNumber(x?.weight_pct, NaN);
    const wt = safeNumber(x?.weight, 0);
    const weight_pct =
      Number.isFinite(wp0) && Math.abs(wp0) > 1e-18 ? wp0 : wt > 0 && wt <= 1 + 1e-9 ? wt * 100 : wt;
    out.push({
      ticker,
      name_short: safeString(x?.company ?? x?.ticker, ticker),
      country: safeString(x?.country, ""),
      zone: safeString(x?.zone, ""),
      geo_zone: safeString(x?.zone, ""),
      region: safeString(x?.region, ""),
      sector: safeString(x?.sector, ""),
      industry: safeString(x?.industry, ""),
      score: safeNumber(x?.score, 0),
      weight_pct,
    });
  }
  return out.length ? out : null;
}

export function freezeKpisDataEndYmd(projectRoot: string): string | null {
  const kpPath = path.join(
    projectRoot,
    "freeze",
    FREEZE_PLAFONADO_MODEL_DIR,
    "model_outputs",
    "v5_kpis.json",
  );
  const k = readJsonIfExists<{ data_end?: unknown }>(kpPath);
  const d = String(k?.data_end ?? "").trim().slice(0, 10);
  return d.length === 10 && d[4] === "-" && d[7] === "-" ? d : null;
}

export function freezeKpisLatestCashSleeveFrac(projectRoot: string): number | null {
  const kpPath = path.join(
    projectRoot,
    "freeze",
    FREEZE_PLAFONADO_MODEL_DIR,
    "model_outputs",
    "v5_kpis.json",
  );
  const k = readJsonIfExists<{ latest_cash_sleeve?: unknown }>(kpPath);
  const v = safeNumber(k?.latest_cash_sleeve, NaN);
  return v >= 0 && v <= 0.95 && Number.isFinite(v) ? v : null;
}
