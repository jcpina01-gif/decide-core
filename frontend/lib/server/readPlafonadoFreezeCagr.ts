import fs from "fs";
import path from "path";
import {
  applyPlafonadoProfileVolPolicy,
  buildPlafonadoEmbedLikeSeries,
  kpiForceSyntheticVolClientEmbed,
  parseEquityCsv,
} from "../plafonadoFeesSeries";
import {
  cagrFractionFromEquityLikeKpiServer,
  overlayedCagrToDisplayPercent,
} from "../planDecisionKpiMath";
import { FREEZE_PLAFONADO_MODEL_DIR } from "../freezePlafonadoDir";

/** Mesmo freeze que `MODEL_PATHS["v5_overlay_cap15_max100exp"]` no kpi_server. */
const FREEZE_MODEL_OUTPUTS = ["freeze", FREEZE_PLAFONADO_MODEL_DIR, "model_outputs"] as const;

/** Legado interno `v5_overlay_cap15` (não usar como referência de produto; preferir MAX100EXP). */
const FREEZE_CAP15_OVERLAY_OUTPUTS = [
  "freeze",
  "DECIDE_MODEL_V5_OVERLAY_CAP15",
  "model_outputs",
] as const;

const MIN_EQUITY_POINTS = 50;

function normalizePlafonadoProfile(
  raw: string | undefined,
): "conservador" | "moderado" | "dinamico" {
  const p = String(raw ?? "moderado")
    .trim()
    .toLowerCase();
  if (p === "conservador" || p === "dinamico") return p;
  return "moderado";
}

function resolveNextFrontendCwd(projectRoot: string): string {
  const front = path.join(projectRoot, "frontend");
  try {
    if (fs.existsSync(path.join(front, "package.json"))) return front;
  } catch {
    /* ignore */
  }
  return projectRoot;
}

function cagrDisplayFromEquity(eq: number[]): number | null {
  if (eq.length < MIN_EQUITY_POINTS) return null;
  const frac = cagrFractionFromEquityLikeKpiServer(eq);
  if (frac == null) return null;
  return overlayedCagrToDisplayPercent(frac);
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

function parseModelEquityColumn(text: string): number[] {
  const lines = text
    .replace(/\r/g, "")
    .split("\n")
    .filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];
  const headers = splitCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
  const idx = headers.findIndex(
    (h) => h === "model_equity" || h.endsWith("model_equity"),
  );
  if (idx < 0) return [];
  const out: number[] = [];
  for (let i = 1; i < lines.length; i += 1) {
    const cols = splitCsvLine(lines[i]);
    const v = Number(String(cols[idx] ?? "").trim());
    if (Number.isFinite(v) && v > 0) out.push(v);
  }
  return out;
}

/**
 * CAGR em % alinhado ao iframe / `buildPlafonadoEmbedLikeSeries`: mesma série (CAP15 + m100 + política de vol
 * moderado = série sem filtro de vol; outros perfis com alvo vs benchmark quando aplicável), não `overlayed_cagr` do JSON isolado.
 */
export function readPlafonadoM100CagrDisplayPercent(
  projectRoot: string,
  profileRaw?: string,
): number | null {
  const profile = normalizePlafonadoProfile(profileRaw);
  const cwd = resolveNextFrontendCwd(projectRoot);
  const built = buildPlafonadoEmbedLikeSeries(profile, cwd);
  if (built?.equity_overlayed?.length >= MIN_EQUITY_POINTS) {
    const pct = cagrDisplayFromEquity(built.equity_overlayed);
    if (pct != null) return pct;
  }

  const dir = path.join(projectRoot, ...FREEZE_MODEL_OUTPUTS);
  const benchPath = path.join(dir, "benchmark_equity_final_20y.csv");
  if (!fs.existsSync(benchPath)) return null;
  const forceSyn = kpiForceSyntheticVolClientEmbed();
  const byProfile = path.join(dir, `model_equity_final_20y_${profile}.csv`);
  const baseModel = path.join(dir, "model_equity_final_20y.csv");
  let modelPath = baseModel;
  let usedProfileFile = false;
  if (!forceSyn && fs.existsSync(byProfile)) {
    modelPath = byProfile;
    usedProfileFile = true;
  } else if (!fs.existsSync(baseModel)) return null;

  try {
    const benchT = fs.readFileSync(benchPath, "utf8");
    const modelT = fs.readFileSync(modelPath, "utf8");
    const b = parseEquityCsv(benchT, "benchmark_equity");
    const m = parseEquityCsv(modelT, "model_equity");
    const n = Math.min(b.equity.length, m.equity.length);
    if (n < MIN_EQUITY_POINTS) return null;
    const benchEq = b.equity.slice(0, n);
    const modelEq = m.equity.slice(0, n);
    const adjusted = applyPlafonadoProfileVolPolicy(modelEq, benchEq, profile, usedProfileFile);
    return cagrDisplayFromEquity(adjusted);
  } catch {
    return null;
  }
}

/**
 * CAGR em % a partir do freeze legado `DECIDE_MODEL_V5_OVERLAY_CAP15` (caminho interno).
 * Preferir `readPlafonadoM100CagrDisplayPercent` para alinhar ao Modelo CAP15 em produção.
 */
export function readCap15OverlayCagrDisplayPercent(projectRoot: string): number | null {
  const dir = path.join(projectRoot, ...FREEZE_CAP15_OVERLAY_OUTPUTS);
  const tryFiles = ["model_equity_final_20y.csv", "model_equity_final_20y_moderado.csv"];
  for (const f of tryFiles) {
    const p = path.join(dir, f);
    if (!fs.existsSync(p)) continue;
    try {
      const eq = parseModelEquityColumn(fs.readFileSync(p, "utf8"));
      if (eq.length < 50) continue;
      const frac = cagrFractionFromEquityLikeKpiServer(eq);
      if (frac == null) continue;
      return overlayedCagrToDisplayPercent(frac);
    } catch {
      /* ignore */
    }
  }
  return null;
}

/**
 * CAGR em % com a mesma política de vol que o iframe, a partir do artefacto embebido
 * `frontend/data/landing/freeze-cap15/` (quando o par CAP15+m100 do repo não está disponível).
 */
export function readLandingEmbeddedFreezeCap15CagrDisplayPercent(
  nextJsCwdFrontend: string,
  profileRaw?: string,
): number | null {
  const profile = normalizePlafonadoProfile(profileRaw);
  const built = buildPlafonadoEmbedLikeSeries(profile, nextJsCwdFrontend);
  if (built?.equity_overlayed?.length >= MIN_EQUITY_POINTS) {
    return cagrDisplayFromEquity(built.equity_overlayed);
  }
  return null;
}
