/**
 * Série do simulador de custos alinhada ao Modelo CAP15 (`compute_client_embed_plafonado_kpis` no kpi_server):
 * calendário CAP15, valores m100 reindexados, depois política de vol (moderado cru; conservador/dinâmico vs benchmark).
 */

import fs from "fs";
import path from "path";

import { FREEZE_PLAFONADO_MODEL_DIR } from "./freezePlafonadoDir";

export type PlafonadoFeesSeriesResult = {
  dates: string[];
  benchmark_equity: number[];
  equity_overlayed: number[];
  equity_raw: number[];
  meta: {
    profile: string;
    aligned_cap15_m100: boolean;
    force_synthetic_vol: boolean;
    used_m100_profile_file: boolean;
  };
};

const PROFILE_VOL_MULT: Record<string, number> = {
  conservador: 0.75,
  moderado: 1.0,
  dinamico: 1.25,
};

function normalizeProfile(raw: string): "conservador" | "moderado" | "dinamico" {
  const p = String(raw || "moderado")
    .trim()
    .toLowerCase();
  if (p === "conservador" || p === "dinamico") return p;
  return "moderado";
}

function kpiEnvRealEquity(): boolean {
  const v = String(process.env.DECIDE_KPI_REAL_EQUITY ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

function kpiEnvSyntheticOverride(): boolean {
  const v = String(process.env.DECIDE_KPI_SYNTHETIC_PROFILE_VOL ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

/** Igual a `kpi_force_synthetic_vol(client_embed=True)` no kpi_server. */
export function kpiForceSyntheticVolClientEmbed(): boolean {
  if (kpiEnvSyntheticOverride()) return true;
  return !kpiEnvRealEquity();
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

export function parseEquityCsv(
  text: string,
  valueHeader: "model_equity" | "benchmark_equity",
): { dates: string[]; equity: number[] } {
  const dates: string[] = [];
  const equity: number[] = [];
  const lines = text
    .replace(/\r/g, "")
    .split("\n")
    .filter((l) => l.trim().length > 0);
  if (lines.length < 2) return { dates, equity };
  const headers = splitCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
  const dateIdx = headers.findIndex((h) => h === "date");
  const valIdx = headers.findIndex((h) => h === valueHeader);
  if (dateIdx < 0 || valIdx < 0) return { dates, equity };
  for (let li = 1; li < lines.length; li += 1) {
    const cols = splitCsvLine(lines[li]);
    const dRaw = String(cols[dateIdx] ?? "").trim();
    const v = Number(String(cols[valIdx] ?? "").trim());
    if (!Number.isFinite(v) || v <= 0) continue;
    const d = dRaw.length >= 10 ? dRaw.slice(0, 10) : dRaw;
    dates.push(d);
    equity.push(v);
  }
  return { dates, equity };
}

function normDateKey(s: string): string {
  return String(s).trim().slice(0, 10);
}

/** Reindex tipo `pd.Series.reindex(...).ffill().bfill()` para datas CAP15. */
function alignM100EquityToCapDates(
  capDates: string[],
  mDates: string[],
  mEq: number[],
): number[] | null {
  const map = new Map<string, number>();
  for (let i = 0; i < mDates.length; i += 1) {
    map.set(normDateKey(mDates[i]), mEq[i]);
  }
  const out: number[] = new Array(capDates.length);
  for (let i = 0; i < capDates.length; i += 1) {
    const k = normDateKey(capDates[i]);
    const v = map.get(k);
    out[i] = v !== undefined && Number.isFinite(v) && v > 0 ? v : NaN;
  }
  let last = NaN;
  for (let i = 0; i < out.length; i += 1) {
    if (Number.isFinite(out[i]) && out[i]! > 0) {
      last = out[i]!;
    } else if (Number.isFinite(last)) {
      out[i] = last;
    }
  }
  last = NaN;
  for (let i = out.length - 1; i >= 0; i -= 1) {
    if (Number.isFinite(out[i]) && out[i]! > 0) {
      last = out[i]!;
    } else if (Number.isFinite(last)) {
      out[i] = last;
    }
  }
  for (let i = 0; i < out.length; i += 1) {
    if (!Number.isFinite(out[i]) || out[i]! <= 0) return null;
  }
  return out;
}

function scaleModelEquityToProfileVol(
  modelEq: number[],
  benchEq: number[],
  profileKey: string,
): number[] {
  const n = Math.min(modelEq.length, benchEq.length);
  if (n < 30) return modelEq.slice();
  const mult = PROFILE_VOL_MULT[profileKey] ?? 1.0;
  const mR: number[] = [];
  const bR: number[] = [];
  for (let i = 1; i < n; i += 1) {
    const pm = modelEq[i - 1]!;
    const cm = modelEq[i]!;
    const pb = benchEq[i - 1]!;
    const cb = benchEq[i]!;
    if (pm > 0 && cm > 0 && pb > 0 && cb > 0) {
      mR.push(cm / pm - 1);
      bR.push(cb / pb - 1);
    }
  }
  if (mR.length < 30) return modelEq.slice();
  const meanM = mR.reduce((a, b) => a + b, 0) / mR.length;
  const meanB = bR.reduce((a, b) => a + b, 0) / bR.length;
  let vm = 0;
  for (const r of mR) vm += (r - meanM) ** 2;
  vm = Math.sqrt(vm / Math.max(1, mR.length - 1)) * Math.sqrt(252);
  let vb = 0;
  for (const r of bR) vb += (r - meanB) ** 2;
  vb = Math.sqrt(vb / Math.max(1, bR.length - 1)) * Math.sqrt(252);
  if (!(vm > 1e-12) || !(vb > 0)) return modelEq.slice();
  const targetVol = mult * vb;
  const scale = targetVol / vm;
  const out: number[] = [modelEq[0]!];
  for (let i = 1; i < n; i += 1) {
    const r = modelEq[i]! / modelEq[i - 1]! - 1;
    out.push(out[i - 1]! * (1 + r * scale));
  }
  for (let j = n; j < modelEq.length; j += 1) out.push(modelEq[j]!);
  return out;
}

function applyModelEquityProfilePolicy(
  modelEq: number[],
  benchEq: number[],
  profileKey: string,
  opts: {
    usedProfileFile: boolean;
    clientEmbed: boolean;
    forceSyntheticProfileVol: boolean;
  },
): number[] {
  if (opts.usedProfileFile) return modelEq.slice();
  const pk = normalizeProfile(profileKey);
  if (pk === "moderado") return modelEq.slice();
  if (opts.forceSyntheticProfileVol) {
    return scaleModelEquityToProfileVol(modelEq, benchEq, profileKey);
  }
  if (opts.clientEmbed) return modelEq.slice();
  return scaleModelEquityToProfileVol(modelEq, benchEq, profileKey);
}

/**
 * Alinhado a `apply_model_equity_profile_policy` no kpi_server: moderado = série sem reescala;
 * conservador/dinâmico = 0,75× / 1,25× vs benchmark quando o sintético está activo.
 */
export function applyPlafonadoProfileVolPolicy(
  modelEq: number[],
  benchEq: number[],
  profileKey: string,
  usedProfileFile: boolean,
): number[] {
  return applyModelEquityProfilePolicy(modelEq, benchEq, profileKey, {
    usedProfileFile,
    clientEmbed: true,
    forceSyntheticProfileVol: kpiForceSyntheticVolClientEmbed(),
  });
}

type DirPair = { cap15Dir: string; m100Dir: string };

function resolveCap15M100Dirs(cwd: string): DirPair | null {
  const cap15 = path.join(cwd, "..", "freeze", "DECIDE_MODEL_V5_OVERLAY_CAP15", "model_outputs");
  const m100 = path.join(cwd, "..", "freeze", FREEZE_PLAFONADO_MODEL_DIR, "model_outputs");
  const capBench = path.join(cap15, "benchmark_equity_final_20y.csv");
  const capModel = path.join(cap15, "model_equity_final_20y.csv");
  const m100Model = path.join(m100, "model_equity_final_20y.csv");
  if (fs.existsSync(capBench) && fs.existsSync(capModel) && fs.existsSync(m100Model)) {
    return { cap15Dir: cap15, m100Dir: m100 };
  }
  return null;
}

function resolveLandingDir(cwd: string): string | null {
  const d = path.join(cwd, "data", "landing", "freeze-cap15");
  const modelP = path.join(d, "model_equity_final_20y.csv");
  const benchP = path.join(d, "benchmark_equity_final_20y.csv");
  if (fs.existsSync(modelP) && fs.existsSync(benchP)) return d;
  return null;
}

/**
 * Constrói datas + benchmark + equity «overlay» como no iframe / `/api/embed-plafonado-cagr`.
 */
export function buildPlafonadoEmbedLikeSeries(
  profileKeyRaw: string,
  cwd: string,
): PlafonadoFeesSeriesResult | null {
  const pk = normalizeProfile(profileKeyRaw);
  const forceSyntheticVol = kpiForceSyntheticVolClientEmbed();

  const pair = resolveCap15M100Dirs(cwd);
  if (pair) {
    const capModelPath = path.join(pair.cap15Dir, "model_equity_final_20y.csv");
    const benchPath = path.join(pair.cap15Dir, "benchmark_equity_final_20y.csv");
    const m100Default = path.join(pair.m100Dir, "model_equity_final_20y.csv");
    const m100ByProfile = path.join(pair.m100Dir, `model_equity_final_20y_${pk}.csv`);
    let m100Path = m100Default;
    let usedProfileFile = false;
    if (!forceSyntheticVol && fs.existsSync(m100ByProfile)) {
      m100Path = m100ByProfile;
      usedProfileFile = true;
    }

    let capT: string;
    let benchT: string;
    let m100T: string;
    try {
      capT = fs.readFileSync(capModelPath, "utf8");
      benchT = fs.readFileSync(benchPath, "utf8");
      m100T = fs.readFileSync(m100Path, "utf8");
    } catch {
      return null;
    }

    const capM = parseEquityCsv(capT, "model_equity");
    const benchP = parseEquityCsv(benchT, "benchmark_equity");
    const m100P = parseEquityCsv(m100T, "model_equity");
    const nCap = Math.min(capM.dates.length, capM.equity.length, benchP.dates.length, benchP.equity.length);
    if (nCap < 50) return null;
    const capDates = capM.dates.slice(0, nCap);
    const benchmark_equity = benchP.equity.slice(0, nCap);

    const alignedRaw = alignM100EquityToCapDates(capDates, m100P.dates, m100P.equity);
    if (!alignedRaw) return null;

    const equity_raw = alignedRaw;
    const equity_overlayed = applyModelEquityProfilePolicy(equity_raw, benchmark_equity, pk, {
      usedProfileFile,
      clientEmbed: true,
      forceSyntheticProfileVol: forceSyntheticVol,
    });

    return {
      dates: capDates,
      benchmark_equity,
      equity_overlayed,
      equity_raw,
      meta: {
        profile: pk,
        aligned_cap15_m100: true,
        force_synthetic_vol: forceSyntheticVol,
        used_m100_profile_file: usedProfileFile,
      },
    };
  }

  const land = resolveLandingDir(cwd);
  if (!land) return null;

  const modelP = path.join(land, "model_equity_final_20y.csv");
  const benchP = path.join(land, "benchmark_equity_final_20y.csv");
  let modelT: string;
  let benchT: string;
  try {
    modelT = fs.readFileSync(modelP, "utf8");
    benchT = fs.readFileSync(benchP, "utf8");
  } catch {
    return null;
  }
  const m = parseEquityCsv(modelT, "model_equity");
  const b = parseEquityCsv(benchT, "benchmark_equity");
  const n = Math.min(m.dates.length, m.equity.length, b.dates.length, b.equity.length);
  if (n < 50) return null;
  const dates = m.dates.slice(0, n);
  const equity_raw = m.equity.slice(0, n);
  const benchmark_equity = b.equity.slice(0, n);

  const profileFile = path.join(land, `model_equity_final_20y_${pk}.csv`);
  let baseEq = equity_raw;
  let usedProfileFile = false;
  if (!forceSyntheticVol && fs.existsSync(profileFile)) {
    try {
      const pt = fs.readFileSync(profileFile, "utf8");
      const mp = parseEquityCsv(pt, "model_equity");
      const nn = Math.min(n, mp.equity.length, mp.dates.length);
      if (nn >= 50) {
        const aligned = alignM100EquityToCapDates(dates, mp.dates, mp.equity);
        if (aligned) {
          baseEq = aligned;
          usedProfileFile = true;
        }
      }
    } catch {
      /* keep baseEq */
    }
  }

  const equity_overlayed = applyModelEquityProfilePolicy(baseEq, benchmark_equity, pk, {
    usedProfileFile,
    clientEmbed: true,
    forceSyntheticProfileVol: forceSyntheticVol,
  });

  return {
    dates,
    benchmark_equity,
    equity_overlayed,
    equity_raw: equity_raw.slice(),
    meta: {
      profile: pk,
      aligned_cap15_m100: false,
      force_synthetic_vol: forceSyntheticVol,
      used_m100_profile_file: usedProfileFile,
    },
  };
}
