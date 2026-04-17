/**
 * Ajustes de pesos da carteira recomendada no relatório (SSR): teto por zona vs benchmark
 * e piso mínimo por linha — espelham a intenção de ``engine_v2.py`` no produto Next.
 */
import { safeNumber } from "../clientReportCoreUtils";

const DEFAULT_COMPOSITE: readonly (readonly [string, number, "US" | "EU" | "JP" | "CAN"])[] = [
  ["SPY", 0.6, "US"],
  ["VGK", 0.25, "EU"],
  ["EWJ", 0.1, "JP"],
  ["EWC", 0.05, "CAN"],
];

const SINGLE_ETF_ZONE_PRIOR: Record<string, Partial<Record<"US" | "EU" | "JP" | "CAN" | "OTHER", number>>> = {
  SPY: { US: 0.72, EU: 0.14, JP: 0.08, CAN: 0.03, OTHER: 0.03 },
  VOO: { US: 0.72, EU: 0.14, JP: 0.08, CAN: 0.03, OTHER: 0.03 },
  IVV: { US: 0.72, EU: 0.14, JP: 0.08, CAN: 0.03, OTHER: 0.03 },
  QQQ: { US: 0.76, EU: 0.12, JP: 0.07, CAN: 0.02, OTHER: 0.03 },
  VGK: { EU: 1 },
  EZU: { EU: 1 },
  EWJ: { JP: 1 },
  EWC: { CAN: 1 },
};

function normalizeZoneDict(raw: Record<string, number>): Record<string, number> {
  const acc: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw)) {
    const z = String(k || "")
      .trim()
      .toUpperCase();
    if (!z || !Number.isFinite(v) || v <= 0) continue;
    acc[z] = (acc[z] || 0) + v;
  }
  const s = Object.values(acc).reduce((a, b) => a + b, 0);
  if (s <= 1e-12) return { US: 1 };
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(acc)) out[k] = v / s;
  return out;
}

/** Mesma regra que ``benchmark_zone_weights`` em ``engine_v2.py`` (coluna única vs composto). */
export function benchmarkZoneWeightsFromPriceHeaders(
  headerColsUpper: Set<string>,
  explicitBenchmarkColumn?: string,
): Record<string, number> {
  const cols = headerColsUpper;
  const bc = (explicitBenchmarkColumn || "").trim().toUpperCase();
  if (bc && cols.has(bc)) {
    const prior = SINGLE_ETF_ZONE_PRIOR[bc];
    if (prior) {
      const flat: Record<string, number> = {};
      for (const [z, w] of Object.entries(prior)) {
        if (typeof w === "number" && w > 0) flat[z] = w;
      }
      return normalizeZoneDict(flat);
    }
    return { US: 1 };
  }
  const zsum: Record<string, number> = {};
  for (const [etf, w, zone] of DEFAULT_COMPOSITE) {
    if (cols.has(etf)) zsum[zone] = (zsum[zone] || 0) + w;
  }
  if (Object.keys(zsum).length === 0) {
    /* ``prices_close`` do deploy muitas vezes só tem acções — sem SPY/VGK/EWJ/EWC o teto JP ficava inactivo ({US:1}). */
    return normalizeZoneDict({
      US: 0.55,
      EU: 0.22,
      JP: 0.14,
      CAN: 0.05,
      OTHER: 0.04,
    });
  }
  return normalizeZoneDict(zsum);
}

export function canonZoneForCountryCap(regionRaw: string): "US" | "EU" | "JP" | "CAN" | "OTHER" {
  const s = String(regionRaw || "")
    .trim()
    .toUpperCase();
  if (!s || s === "FX" || s === "N/A") return "OTHER";
  if (s === "US" || s === "USA") return "US";
  if (s === "EU" || s === "UK" || s === "EUROPE") return "EU";
  if (s === "JP" || s === "JAPAN" || s === "JPN") return "JP";
  if (s === "CAN" || s === "CANADA" || s === "CA") return "CAN";
  return "OTHER";
}

function readPlanEnvFloat(name: string, fallback: number): number {
  const raw = (process.env[name] || "").trim();
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function planZoneCapMultiplier(): number {
  return readPlanEnvFloat("DECIDE_ZONE_CAP_VS_BENCHMARK_MULT", 1.3);
}

/** Piso para **entrar** no plano / linha BUY sugerida (default 1%; estrito ``>`` no relatório). */
export function planEntryMinWeightPct(): number {
  const raw = (process.env.DECIDE_PLAN_ENTRY_MIN_WEIGHT_PCT || "").trim();
  if (raw) {
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return readPlanEnvFloat("DECIDE_PLAN_MIN_WEIGHT_PCT", 1);
}

/** Só **sai** / funde pó quando o peso cai abaixo disto (default 0,5%) — histerese vs entrada. */
export function planExitWeightPct(): number {
  return readPlanEnvFloat("DECIDE_PLAN_EXIT_WEIGHT_PCT", 0.5);
}

/** @deprecated usar ``planEntryMinWeightPct`` / ``planExitWeightPct``. */
export function planMinWeightPct(): number {
  return planEntryMinWeightPct();
}

export function planGeoAdjustmentsDisabled(): boolean {
  const v = (process.env.DECIDE_DISABLE_PLAN_WEIGHT_ADJUSTMENTS || "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

export function planZoneCapDisabled(): boolean {
  const v = (process.env.DECIDE_DISABLE_ZONE_CAP_VS_BENCHMARK || "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

export type MutablePlanWeightRow = {
  ticker: string;
  weightPct: number;
  originalWeightPct?: number;
  excluded?: boolean;
};

/**
 * Remove peso só de linhas **abaixo do limiar de saída** (default 0,5%) e redistribui pelas restantes.
 * Linhas entre 0,5% e 1% **mantêm-se** até caírem abaixo de 0,5%. A regra de **entrada** (> 1%) é aplicada
 * noutro sítio (ex.: BUY sugerido no relatório).
 */
export function consolidateWeightsBelowMinimum(
  rows: MutablePlanWeightRow[],
  exitBelowPct: number,
  isProtected: (r: MutablePlanWeightRow) => boolean,
): void {
  if (exitBelowPct <= 0 || exitBelowPct >= 50 || planGeoAdjustmentsDisabled()) return;
  const elig = rows.filter((r) => !r.excluded && !isProtected(r) && safeNumber(r.weightPct, 0) > 0);
  let dust = 0;
  const keepers: MutablePlanWeightRow[] = [];
  for (const r of elig) {
    const w = safeNumber(r.weightPct, 0);
    if (w < exitBelowPct - 1e-9) {
      dust += w;
      r.weightPct = 0;
      if (r.originalWeightPct !== undefined) r.originalWeightPct = 0;
    } else {
      keepers.push(r);
    }
  }
  if (dust <= 1e-9 || keepers.length === 0) return;
  const sum = keepers.reduce((a, r) => a + safeNumber(r.weightPct, 0), 0);
  if (sum <= 1e-9) return;
  for (const r of keepers) {
    const w = safeNumber(r.weightPct, 0);
    const add = dust * (w / sum);
    const nw = w + add;
    r.weightPct = nw;
    if (r.originalWeightPct !== undefined) {
      const ow = safeNumber(r.originalWeightPct, w);
      r.originalWeightPct = ow + add * (ow / w || 1);
    }
  }
}

/**
 * Garante ``sum_{i in Z} w_i <= mult * bench[Z]`` quando ``bench[Z] > 0`` (iteração).
 * Preserva a soma em % das linhas **não protegidas** (ex.: sleeve T-Bills / caixa).
 */
export function applyZoneCapsVsBenchmark(
  rows: MutablePlanWeightRow[],
  tickerToZone: Map<string, "US" | "EU" | "JP" | "CAN" | "OTHER">,
  benchZones: Record<string, number>,
  multiplier: number,
  isProtected: (r: MutablePlanWeightRow) => boolean,
): void {
  if (planGeoAdjustmentsDisabled() || planZoneCapDisabled() || multiplier <= 0) return;
  const bench = normalizeZoneDict(
    Object.fromEntries(Object.entries(benchZones).map(([k, v]) => [k.toUpperCase(), v])) as Record<
      string,
      number
    >,
  );
  const zones = ["US", "EU", "JP", "CAN", "OTHER"] as const;

  const zoneOfTicker = (ticker: string): (typeof zones)[number] => {
    const z = tickerToZone.get(ticker.trim().toUpperCase());
    return z && (zones as readonly string[]).includes(z) ? z : "OTHER";
  };

  const eqRows = rows.filter((r) => !r.excluded && !isProtected(r));
  const scaleTotal = eqRows.reduce((a, r) => a + Math.max(0, safeNumber(r.weightPct, 0)), 0);
  if (scaleTotal <= 1e-9) return;

  const fr = new Map<MutablePlanWeightRow, number>();
  for (const r of eqRows) {
    fr.set(r, Math.max(0, safeNumber(r.weightPct, 0)) / scaleTotal);
  }

  const exposureFrac = (): Record<string, number> => {
    const ex: Record<string, number> = { US: 0, EU: 0, JP: 0, CAN: 0, OTHER: 0 };
    for (const r of eqRows) {
      const f = fr.get(r) || 0;
      if (f <= 0) continue;
      ex[zoneOfTicker(r.ticker)] += f;
    }
    return ex;
  };

  for (let it = 0; it < 500; it += 1) {
    const ex = exposureFrac();
    const factors: Record<string, number> = { US: 1, EU: 1, JP: 1, CAN: 1, OTHER: 1 };
    let tightened = false;
    for (const z of zones) {
      const b = bench[z] || 0;
      if (b < 1e-12) continue;
      const cap = multiplier * b;
      if (ex[z] > cap + 1e-9) {
        factors[z] = cap / ex[z];
        tightened = true;
      }
    }
    if (!tightened) break;
    for (const r of eqRows) {
      const z = zoneOfTicker(r.ticker);
      const fac = factors[z] ?? 1;
      fr.set(r, Math.max(0, (fr.get(r) || 0) * fac));
    }
    const s = Array.from(fr.values()).reduce((a, v) => a + v, 0);
    if (s > 1e-18) {
      for (const r of eqRows) {
        fr.set(r, (fr.get(r) || 0) / s);
      }
    }
  }

  for (const r of eqRows) {
    const oldW = safeNumber(r.weightPct, 0);
    const nw = (fr.get(r) || 0) * scaleTotal;
    r.weightPct = nw;
    if (r.originalWeightPct !== undefined) {
      const ow0 = safeNumber(r.originalWeightPct, oldW);
      r.originalWeightPct = oldW > 1e-9 ? (nw / oldW) * ow0 : nw;
    }
  }
}
