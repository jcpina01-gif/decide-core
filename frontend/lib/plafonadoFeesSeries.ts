/**
 * Série do simulador de custos alinhada ao Modelo CAP15 (`compute_client_embed_plafonado_kpis` no kpi_server):
 * calendário CAP15, valores m100 reindexados, depois política de vol no cliente (moderado 1×; conservador/dinâmico 0,75× / 1,25× vs benchmark, alinhado ao `kpi_server` strict CAP15).
 */

import fs from "fs";
import path from "path";

import { resolveDecideProjectRoot } from "./server/decideProjectRoot";
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

/** Igual a `normalize_risk_profile_key` no kpi_server (acentos, variantes PT/EN). */
function normalizeProfile(raw: string): "conservador" | "moderado" | "dinamico" {
  const rawS = String(raw ?? "moderado").trim();
  if (!rawS) return "moderado";
  const p = rawS
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
  if (
    p === "conservador" ||
    p === "conservative" ||
    p === "defensivo" ||
    p === "defensive"
  ) {
    return "conservador";
  }
  if (
    p === "dinamico" ||
    p === "dynamic" ||
    p === "agresivo" ||
    p === "agressivo" ||
    p === "arrojado"
  ) {
    return "dinamico";
  }
  if (
    p === "moderado" ||
    p === "moderate" ||
    p === "medio" ||
    p === "equilibrado" ||
    p === "balanced" ||
    p === "neutro" ||
    p === "neutral"
  ) {
    return "moderado";
  }
  return "moderado";
}

/** Para APIs Next / leitura de freeze — exportado para alinhar query params e ficheiros `_*_{perfil}.csv`. */
export function normalizeRiskProfileKeyForKpi(
  raw: string | undefined | null,
): "conservador" | "moderado" | "dinamico" {
  return normalizeProfile(String(raw ?? "moderado"));
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
  const pk = normalizeProfile(profileKey);
  const n = Math.min(modelEq.length, benchEq.length);
  if (n < 30) return modelEq.slice();
  const mult = PROFILE_VOL_MULT[pk] ?? 1.0;
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
  void opts;
  const pk = normalizeProfile(profileKey);
  return scaleModelEquityToProfileVol(modelEq, benchEq, pk);
}

/**
 * Alinhado ao CAP15 strict em `apply_model_equity_profile_policy` (kpi_server): moderado 1×; conservador/dinâmico 0,75× / 1,25×.
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

/** Alinhado a `resolve_benchmark` / `coerce_long` no kpi_server (stub ~60 linhas). */
const MIN_BENCHMARK_CSV_ROWS = 500;
/** CSVs `model_equity_final_20y_{perfil}.csv` placeholder (ex. moderado com ~60 linhas). */
const MIN_MODEL_EQUITY_PROFILE_ROWS = 500;

function countCsvDataRows(filePath: string): number {
  try {
    const text = fs.readFileSync(filePath, "utf8");
    const lines = text.replace(/\r/g, "").split("\n").filter((l) => l.trim().length > 0);
    return Math.max(0, lines.length - 1);
  } catch {
    return 0;
  }
}

function modelEquityCsvLooksComplete(filePath: string): boolean {
  return countCsvDataRows(filePath) >= MIN_MODEL_EQUITY_PROFILE_ROWS;
}

/**
 * Quando o CSV de `model_equity` rebenta numericamente na cauda (ex.: 1e19–1e23 com benchmark ~5),
 * log-scale e «Base 100» no cliente ficam ilegíveis. Isto **não** corrige o motor Python — só
 * limita a série servida ao cliente a um múltiplo plausível do benchmark e a um crescimento
 * diário coerente com o dia anterior (após o *clip*, o ponto i usa já `out[i-1]` *capped*).
 */
function capEquitySeriesVsBenchmarkRail(benchmark_equity: number[], equity: number[]): number[] {
  const MAX_MODEL_OVER_BENCH = 120;
  const MAX_DAILY_MULT = 1.22;

  const out = equity.slice();
  for (let i = 0; i < out.length; i += 1) {
    const b = benchmark_equity[i];
    if (!(typeof b === "number") || !Number.isFinite(b) || b <= 0) continue;

    let v = out[i];
    if (!(typeof v === "number") || !Number.isFinite(v) || v <= 0) continue;

    const hardCap = b * MAX_MODEL_OVER_BENCH;
    if (i === 0) {
      out[i] = Math.min(v, hardCap);
      continue;
    }

    const b0 = benchmark_equity[i - 1];
    const v0 = out[i - 1];
    if (!(typeof b0 === "number") || !Number.isFinite(b0) || b0 <= 0 || !(v0 > 0) || !Number.isFinite(v0)) {
      out[i] = Math.min(v, hardCap);
      continue;
    }

    const bRatio = b / b0;
    const benchLinked = v0 * Math.min(MAX_DAILY_MULT, Math.max(1 / MAX_DAILY_MULT, bRatio * 1.08));
    out[i] = Math.min(v, hardCap, benchLinked);
  }
  return out;
}

/**
 * Benchmark longo para o mesmo `model_outputs/` que o iframe (`benchmark_equity_final_20y.csv` ou clone).
 * O `cwd` da série (`resolveDecideProjectRoot`) é a mesma convenção que nas outras rotas: monorepo em
 * dev e raiz de *deploy* (ex. `/var/task` com `freeze/`) com *file tracing* da Vercel.
 */
function resolveCoercedBenchmarkPath(repoRoot: string, modelOutputsDir: string): string {
  const primary = path.join(modelOutputsDir, "benchmark_equity_final_20y.csv");
  const clone = path.join(path.dirname(modelOutputsDir), "model_outputs_from_clone", "benchmark_equity_final_20y.csv");
  if (countCsvDataRows(primary) >= MIN_BENCHMARK_CSV_ROWS) return primary;
  if (fs.existsSync(clone) && countCsvDataRows(clone) >= MIN_BENCHMARK_CSV_ROWS) return clone;
  const smoothClone = path.join(
    repoRoot,
    "freeze",
    FREEZE_PLAFONADO_MODEL_DIR,
    "model_outputs_from_clone",
    "benchmark_equity_final_20y.csv",
  );
  if (fs.existsSync(smoothClone) && countCsvDataRows(smoothClone) >= MIN_BENCHMARK_CSV_ROWS) {
    return smoothClone;
  }
  return primary;
}

function resolveCap15M100Dirs(cwd: string): DirPair | null {
  const repoRoot = resolveDecideProjectRoot(cwd);
  const smooth = path.join(repoRoot, "freeze", FREEZE_PLAFONADO_MODEL_DIR, "model_outputs");
  const m100Model = path.join(smooth, "model_equity_final_20y.csv");
  const capModelSmooth = path.join(smooth, "model_equity_final_20y.csv");
  const benchP = resolveCoercedBenchmarkPath(repoRoot, smooth);
  if (
    fs.existsSync(capModelSmooth) &&
    fs.existsSync(m100Model) &&
    countCsvDataRows(benchP) >= MIN_BENCHMARK_CSV_ROWS
  ) {
    return { cap15Dir: smooth, m100Dir: smooth };
  }
  return null;
}

function resolveLandingDir(cwd: string): string | null {
  const repoRoot = resolveDecideProjectRoot(cwd);
  const candidates = [path.join(cwd, "data", "landing", "freeze-cap15"), path.join(repoRoot, "frontend", "data", "landing", "freeze-cap15")];
  for (const d of candidates) {
    const modelP = path.join(d, "model_equity_final_20y.csv");
    const benchP = path.join(d, "benchmark_equity_final_20y.csv");
    if (fs.existsSync(modelP) && fs.existsSync(benchP)) return d;
  }
  return null;
}

/**
 * Série a partir de `frontend/data/landing/freeze-cap15/` (artefacto embebido; não depende do freeze do repo).
 */
export function buildLandingFreezeCap15Series(
  profileKeyRaw: string,
  cwd: string,
): PlafonadoFeesSeriesResult | null {
  const pk = normalizeProfile(profileKeyRaw);
  const forceSyntheticVol = kpiForceSyntheticVolClientEmbed();
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
  if (pk !== "moderado" && !forceSyntheticVol && fs.existsSync(profileFile)) {
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

  let equity_overlayed = applyModelEquityProfilePolicy(baseEq, benchmark_equity, pk, {
    usedProfileFile,
    clientEmbed: true,
    forceSyntheticProfileVol: forceSyntheticVol,
  });
  equity_overlayed = capEquitySeriesVsBenchmarkRail(benchmark_equity, equity_overlayed);
  const equity_rawCapped = capEquitySeriesVsBenchmarkRail(benchmark_equity, equity_raw.slice());

  return {
    dates,
    benchmark_equity,
    equity_overlayed,
    equity_raw: equity_rawCapped,
    meta: {
      profile: pk,
      aligned_cap15_m100: false,
      force_synthetic_vol: forceSyntheticVol,
      used_m100_profile_file: usedProfileFile,
    },
  };
}

/**
 * Rentabilidade anual do «Plano recomendado» — quando existem *freeze* e *landing* com a mesma
 * construção, escolhe a série que acaba numa data mais recente (evita landing em git desactualizado
 * a ganhar se o *freeze* local/traçado estiver nessa frente, e o contrário após o Passo 2.5
 * a actualizar o embed).
 */
export function buildPlanHeroPlafonadoSeries(
  profileKeyRaw: string,
  cwd: string,
): PlafonadoFeesSeriesResult | null {
  return pickNewerPlafonadoSeries(
    buildPlafonadoEmbedLikeSeriesFromFreezeOnly(profileKeyRaw, cwd),
    buildLandingFreezeCap15Series(profileKeyRaw, cwd),
  );
}

/** Série a partir do `freeze/` do repo (paridade com o iframe Flask); sem fallback landing. */
function buildPlafonadoEmbedLikeSeriesFromFreezeOnly(
  profileKeyRaw: string,
  cwd: string,
): PlafonadoFeesSeriesResult | null {
  const pk = normalizeProfile(profileKeyRaw);
  const forceSyntheticVol = kpiForceSyntheticVolClientEmbed();
  const pair = resolveCap15M100Dirs(cwd);
  if (!pair) return null;

  const repoRoot = resolveDecideProjectRoot(cwd);
  const capModelPath = path.join(pair.cap15Dir, "model_equity_final_20y.csv");
  const benchPath = resolveCoercedBenchmarkPath(repoRoot, pair.cap15Dir);
  const m100Default = path.join(pair.m100Dir, "model_equity_final_20y.csv");
  const m100ByProfile = path.join(pair.m100Dir, `model_equity_final_20y_${pk}.csv`);
  let m100Path = m100Default;
  let usedProfileFile = false;
  if (
    pk !== "moderado" &&
    !forceSyntheticVol &&
    fs.existsSync(m100ByProfile) &&
    modelEquityCsvLooksComplete(m100ByProfile)
  ) {
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

  const equity_rawAligned = alignedRaw;
  let equity_overlayed = applyModelEquityProfilePolicy(equity_rawAligned, benchmark_equity, pk, {
    usedProfileFile,
    clientEmbed: true,
    forceSyntheticProfileVol: forceSyntheticVol,
  });
  equity_overlayed = capEquitySeriesVsBenchmarkRail(benchmark_equity, equity_overlayed);
  const equity_rawCapped = capEquitySeriesVsBenchmarkRail(benchmark_equity, equity_rawAligned);

  return {
    dates: capDates,
    benchmark_equity,
    equity_overlayed,
    equity_raw: equity_rawCapped,
    meta: {
      profile: pk,
      aligned_cap15_m100: true,
      force_synthetic_vol: forceSyntheticVol,
      used_m100_profile_file: usedProfileFile,
    },
  };
}

/** Datas alinhadas a `YYYY-MM-DD` para comparação lexicográfica. */
function lastYmdInSeries(ser: PlafonadoFeesSeriesResult | null): string {
  if (!ser?.dates?.length) return "";
  const t = String(ser.dates[ser.dates.length - 1]);
  const m = t.match(/(\d{4}-\d{2}-\d{2})/);
  if (m) return m[1];
  return t;
}

function pickNewerPlafonadoSeries(
  a: PlafonadoFeesSeriesResult | null,
  b: PlafonadoFeesSeriesResult | null,
): PlafonadoFeesSeriesResult | null {
  if (a && !b) return a;
  if (b && !a) return b;
  if (!a && !b) return null;
  return lastYmdInSeries(b) > lastYmdInSeries(a) ? b! : a!;
}

/**
 * Constrói datas + benchmark + equity «overlay» como no iframe / `/api/embed-plafonado-cagr`.
 * Há *freeze* (repo ou traçado) e *landing*: usa a série que acaba numa data mais recente.
 */
export function buildPlafonadoEmbedLikeSeries(
  profileKeyRaw: string,
  cwd: string,
): PlafonadoFeesSeriesResult | null {
  return pickNewerPlafonadoSeries(
    buildPlafonadoEmbedLikeSeriesFromFreezeOnly(profileKeyRaw, cwd),
    buildLandingFreezeCap15Series(profileKeyRaw, cwd),
  );
}
