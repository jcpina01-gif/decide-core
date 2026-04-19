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

/** Monorepo ``freeze/...`` e cópia embebida em ``frontend/data/landing/freeze-cap15/`` (Vercel file-tracing). */
function portfolioFinalJsonCandidates(projectRoot: string, frontendRoot?: string): string[] {
  const out: string[] = [
    path.join(projectRoot, "freeze", FREEZE_PLAFONADO_MODEL_DIR, "model_outputs", "portfolio_final.json"),
  ];
  if (frontendRoot) {
    out.push(path.join(frontendRoot, "data", "landing", "freeze-cap15", "portfolio_final.json"));
  }
  return out;
}

function v5KpisJsonCandidates(projectRoot: string, frontendRoot?: string): string[] {
  const out: string[] = [
    path.join(projectRoot, "freeze", FREEZE_PLAFONADO_MODEL_DIR, "model_outputs", "v5_kpis.json"),
  ];
  if (frontendRoot) {
    out.push(path.join(frontendRoot, "data", "landing", "freeze-cap15", "v5_kpis.json"));
  }
  return out;
}

function holdingsFromPortfolioFinalPath(pfPath: string): Record<string, unknown>[] | null {
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

/**
 * Holdings de ``portfolio_final.json`` — formato alinhado a ``current_portfolio.positions`` do ``run-model``.
 *
 * ``frontendRoot``: pasta ``frontend/`` da app Next (``process.cwd()`` no SSR); tenta cópia embebida quando
 * o ``freeze/`` do monorepo não entra no bundle serverless da Vercel.
 */
export function tryFreezeHoldingsAsModelPositions(
  projectRoot: string,
  frontendRoot?: string,
): Record<string, unknown>[] | null {
  for (const pfPath of portfolioFinalJsonCandidates(projectRoot, frontendRoot)) {
    const rows = holdingsFromPortfolioFinalPath(pfPath);
    if (rows?.length) return rows;
  }
  return null;
}

export function freezeKpisDataEndYmd(projectRoot: string, frontendRoot?: string): string | null {
  for (const kpPath of v5KpisJsonCandidates(projectRoot, frontendRoot)) {
    const k = readJsonIfExists<{ data_end?: unknown }>(kpPath);
    const d = String(k?.data_end ?? "").trim().slice(0, 10);
    if (d.length === 10 && d[4] === "-" && d[7] === "-") return d;
  }
  return null;
}

export function freezeKpisLatestCashSleeveFrac(projectRoot: string, frontendRoot?: string): number | null {
  for (const kpPath of v5KpisJsonCandidates(projectRoot, frontendRoot)) {
    const k = readJsonIfExists<{ latest_cash_sleeve?: unknown }>(kpPath);
    const v = safeNumber(k?.latest_cash_sleeve, NaN);
    if (v >= 0 && v <= 0.95 && Number.isFinite(v)) return v;
  }
  return null;
}
