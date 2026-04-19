/**
 * Ajustes de pesos da carteira recomendada no relatório (SSR): teto por zona vs benchmark
 * e piso mínimo por linha — espelham a intenção de ``engine_v2.py`` no produto Next.
 */
import { eurMmIbTicker, safeNumber } from "../clientReportCoreUtils";
import { isDecideCashSleeveBrokerSymbol } from "../decideCashSleeveDisplay";
import { canonicalTickerForGeo, normalizeGeoTickerInput } from "../tickerGeoFallback";

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
  /** MSCI World (USD) — aproximação regional para teto vs plano. */
  URTH: { US: 0.58, EU: 0.22, JP: 0.09, CAN: 0.04, OTHER: 0.07 },
  ACWI: { US: 0.58, EU: 0.2, JP: 0.09, CAN: 0.04, OTHER: 0.09 },
  IWDA: { US: 0.58, EU: 0.22, JP: 0.09, CAN: 0.04, OTHER: 0.07 },
  "IWDA.AS": { US: 0.58, EU: 0.22, JP: 0.09, CAN: 0.04, OTHER: 0.07 },
};

/** Mistura mínima US/EU/JP/CAN quando o CSV não traz colunas suficientes para o composto 60/25/10/5. */
const BENCH_ZONE_FALLBACK_WORLD: Record<string, number> = {
  US: 0.55,
  EU: 0.22,
  JP: 0.14,
  CAN: 0.05,
  OTHER: 0.04,
};

function benchZonesNeedWorldFallback(z: Record<string, number>): boolean {
  const u = z.US ?? 0;
  const e = z.EU ?? 0;
  const j = z.JP ?? 0;
  return u < 1e-9 || e < 1e-9 || j < 1e-9;
}

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

/**
 * Chaves para ``Map`` ticker→zona no cap vs benchmark: alinha ``TOELY`` / ``TOELY IB`` / compactos e pontos,
 * para ``applyZoneCapsVsBenchmark`` não tratar linhas como ``OTHER`` por falta de match.
 */
export function planBenchmarkZoneLookupKeys(ticker: string): string[] {
  const keys = new Set<string>();
  const u0 = String(ticker || "").trim().toUpperCase();
  if (u0) keys.add(u0);
  const ng = normalizeGeoTickerInput(ticker).toUpperCase().trim();
  if (ng) keys.add(ng);
  const canon = canonicalTickerForGeo(ticker).toUpperCase();
  if (canon) keys.add(canon);
  if (u0) keys.add(u0.replace(/\s+/g, ""));
  if (ng) keys.add(ng.replace(/\s+/g, ""));
  const stripIb = (s: string) => s.replace(/\s+IB$/i, "").trim();
  const sb0 = stripIb(u0);
  if (sb0) keys.add(sb0);
  const sbn = stripIb(ng);
  if (sbn) keys.add(sbn);
  if (sb0) keys.add(sb0.replace(/\./g, "-"));
  if (sbn) keys.add(sbn.replace(/\./g, "-"));
  return [...keys].filter(Boolean);
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
    /* Coluna de benchmark desconhecida: ``{ US: 1 }`` desactivava o teto JP (bench.JP=0). */
    return normalizeZoneDict({ ...BENCH_ZONE_FALLBACK_WORLD });
  }
  const zsum: Record<string, number> = {};
  for (const [etf, w, zone] of DEFAULT_COMPOSITE) {
    if (cols.has(etf)) zsum[zone] = (zsum[zone] || 0) + w;
  }
  if (Object.keys(zsum).length === 0) {
    /* ``prices_close`` do deploy muitas vezes só tem acções — sem SPY/VGK/EWJ/EWC. */
    return normalizeZoneDict({ ...BENCH_ZONE_FALLBACK_WORLD });
  }
  const composite = normalizeZoneDict(zsum);
  /* Só SPY+VGK no CSV → JP=0 no «benchmark» e o cap por país para o Japão nunca corre. */
  if (benchZonesNeedWorldFallback(composite)) {
    return normalizeZoneDict({ ...BENCH_ZONE_FALLBACK_WORLD });
  }
  return composite;
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

/**
 * Tecto em **pontos percentuais** (ex.: 15 = 15%) para o cap por linha na grelha do plano.
 * Alinha ao CAP15 / ``cap_per_ticker`` do motor (fração do sleeve de risco, tipicamente 0,15).
 *
 * - Valor em ``(0,1]`` (ex.: ``0.15``) interpreta-se como **fração** → multiplica por 100.
 * - Valores inválidos ou absurdos (≥ 100 ou > 40) voltam ao **15** por defeito — nunca ``99`` (isso anulava o cap:
 * ``min(99, 0.99×S)`` ≈ 100% do sleeve e ninguém era cortado).
 *
 * O tecto **aplica-se sempre** no SSR do relatório; ``DECIDE_DISABLE_PLAN_PER_TICKER_MAX_CAP`` deixou de o desligar
 * (evita linhas a >15% por defeito quando o deploy tinha esse flag).
 */
export function planPerTickerMaxWeightPct(): number {
  const raw = (process.env.DECIDE_PLAN_MAX_WEIGHT_PCT_PER_TICKER || "").trim();
  let n = raw ? Number(raw) : 15;
  if (!Number.isFinite(n) || n <= 0) n = 15;
  /** ``0.15`` no deploy = 15% (fração); ``1`` = 1% (não multiplicar). */
  if (n > 0 && n < 1) n *= 100;
  if (n >= 100 || n > 40) n = 15;
  return n;
}

export type MutablePlanWeightRow = {
  ticker: string;
  weightPct: number;
  originalWeightPct?: number;
  excluded?: boolean;
  /** Momento / ranking do modelo (CSV ou payload) — usado na redistribuição do cap por ticker. */
  score?: number;
};

/** Peso para alocar excesso do cap: ``sqrt(score)`` se ``score > 0``, senão uniforme mínima (alinhado a ``build_weights`` no motor). */
function planRankAllocationWeight(r: MutablePlanWeightRow): number {
  const s = safeNumber((r as { score?: unknown }).score, 0);
  if (s > 1e-18) return Math.sqrt(s);
  return 1e-6;
}

/**
 * Redistribui ``excess`` só até cada linha atingir ``capLine``, com peso ``headroom × sqrt(score)``.
 * Devolve o excesso que não coube (para sink ou nova ronda).
 */
function redistributeExcessBoundedByRank(
  recipients: MutablePlanWeightRow[],
  excess: number,
  capLine: number,
): number {
  if (excess <= 1e-12 || recipients.length === 0) return excess;
  let rem = excess;
  for (let round = 0; round < 250 && rem > 1e-9; round += 1) {
    const alloc = recipients.map((r) => {
      const w = safeNumber(r.weightPct, 0);
      const head = Math.max(0, capLine - w);
      return head * planRankAllocationWeight(r);
    });
    const s = alloc.reduce((a, b) => a + b, 0);
    if (s <= 1e-18) break;
    let applied = 0;
    for (let i = 0; i < recipients.length; i += 1) {
      const r = recipients[i];
      const w = safeNumber(r.weightPct, 0);
      const head = Math.max(0, capLine - w);
      if (head <= 1e-12) continue;
      const proposal = rem * (alloc[i] / s);
      const add = Math.min(proposal, head);
      if (add <= 1e-12) continue;
      r.weightPct = w + add;
      if (r.originalWeightPct !== undefined) {
        const ow = safeNumber(r.originalWeightPct, w);
        r.originalWeightPct = ow + add * (ow / w || 1);
      }
      applied += add;
    }
    if (applied <= 1e-9) break;
    rem -= applied;
  }
  return rem;
}

/** Linha onde acumular excesso do cap (TBILL no JSON, MM EUR na UI, BIL/SHV). */
export function planWeightSinkRow(rows: MutablePlanWeightRow[]): MutablePlanWeightRow | undefined {
  const u = (t: string) =>
    String(t || "")
      .trim()
      .toUpperCase();
  const want = (tickers: string[]) => {
    for (const w of tickers) {
      const hit = rows.find((r) => u(r.ticker) === w);
      if (hit) return hit;
    }
    return undefined;
  };
  const mm = eurMmIbTicker();
  return (
    want(["TBILL_PROXY", "EUR_MM_PROXY", "BIL", "SHV", mm]) ||
    rows.find((r) => isDecideCashSleeveBrokerSymbol(String(r.ticker || "")))
  );
}

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
  if (dust <= 1e-9) return;
  /** Sem linhas ≥ limiar: o pó não pode evaporar — acumula no sleeve de caixa (TBILL) como no ``stripPlanBenchmarkIndexRows``. */
  if (keepers.length === 0) {
    const tb = rows.find((r) => String(r.ticker || "").trim().toUpperCase() === "TBILL_PROXY");
    if (tb) {
      const prevW = safeNumber(tb.weightPct, 0);
      const prevOw = tb.originalWeightPct !== undefined ? safeNumber(tb.originalWeightPct, prevW) : undefined;
      tb.weightPct = prevW + dust;
      if (tb.originalWeightPct !== undefined) {
        tb.originalWeightPct = (prevOw ?? prevW) + dust;
      }
    }
    return;
  }
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
    for (const k of planBenchmarkZoneLookupKeys(ticker)) {
      const z = tickerToZone.get(k);
      if (z && (zones as readonly string[]).includes(z)) return z;
    }
    return "OTHER";
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

/**
 * Tecto por **ticker**: em cada passo ``capLine = min(maxPct, maxFrac × S)`` (NAV vs % do sleeve de risco).
 * Corta linhas acima do tecto e redistribui o excesso com **ranking** (``headroom × sqrt(score)``), **sem** ultrapassar
 * ``capLine`` na mesma ronda (evita devolver peso aos mesmos mega-cap). O que não couber vai para o sink de caixa.
 */
export function applyPerTickerMaxWeightPct(
  rows: MutablePlanWeightRow[],
  maxPct: number,
  isProtected: (r: MutablePlanWeightRow) => boolean,
): void {
  const maxPctClamped = Math.min(Math.max(maxPct, 1e-6), 40);
  if (!(maxPctClamped > 0) || maxPctClamped >= 100) return;
  const maxFrac = maxPctClamped / 100;

  for (let it = 0; it < 120; it += 1) {
    const elig = rows.filter((r) => !isProtected(r) && safeNumber(r.weightPct, 0) > 1e-12);
    if (elig.length === 0) break;

    const sleeveSum = elig.reduce((a, r) => a + safeNumber(r.weightPct, 0), 0);
    if (sleeveSum <= 1e-9) break;

    const capLine = Math.min(maxPctClamped, maxFrac * sleeveSum);
    const over = elig.filter((r) => safeNumber(r.weightPct, 0) > capLine + 1e-9);
    if (over.length === 0) break;

    let excess = 0;
    for (const r of over) {
      const w = safeNumber(r.weightPct, 0);
      excess += w - capLine;
      r.weightPct = capLine;
      if (r.originalWeightPct !== undefined) {
        const ow = safeNumber(r.originalWeightPct, w);
        r.originalWeightPct = w > 1e-9 ? (capLine / w) * ow : capLine;
      }
    }

    const under = elig.filter((r) => safeNumber(r.weightPct, 0) < capLine - 1e-9);
    const recipients = under.length > 0 ? under : elig;

    if (elig.length === 1) {
      const tb = planWeightSinkRow(rows);
      if (tb) {
        const prevW = safeNumber(tb.weightPct, 0);
        const prevOw = tb.originalWeightPct !== undefined ? safeNumber(tb.originalWeightPct, prevW) : undefined;
        tb.weightPct = prevW + excess;
        if (tb.originalWeightPct !== undefined) {
          tb.originalWeightPct = (prevOw ?? prevW) + excess;
        }
      }
      continue;
    }

    const leftover = redistributeExcessBoundedByRank(recipients, excess, capLine);
    if (leftover > 1e-4) {
      const tb = planWeightSinkRow(rows);
      if (tb) {
        const prevW = safeNumber(tb.weightPct, 0);
        const prevOw = tb.originalWeightPct !== undefined ? safeNumber(tb.originalWeightPct, prevW) : undefined;
        tb.weightPct = prevW + leftover;
        if (tb.originalWeightPct !== undefined) {
          tb.originalWeightPct = (prevOw ?? prevW) + leftover;
        }
      }
    }
  }
}

/**
 * Garantia final: nenhuma linha de risco acima de ``maxPct`` (pontos %), independentemente de
 * renormalizações em ``applyZoneCapsVsBenchmark``. O excesso **não** vai para caixa/MM: redistribui-se pelas
 * outras linhas de risco com **headroom × sqrt(score)** (igual a ``applyPerTickerMaxWeightPct``), favorecendo
 * títulos com factor/ranking mais alto. Linhas protegidas (caixa, overlay, excluídas) ficam de fora.
 */
export function enforceAbsolutePerTickerCeiling(
  rows: MutablePlanWeightRow[],
  maxPct: number,
  isProtected: (r: MutablePlanWeightRow) => boolean,
): void {
  const cap = Math.min(Math.max(maxPct, 1e-6), 40);
  if (cap >= 100) return;
  let excess = 0;
  for (const r of rows) {
    if (isProtected(r)) continue;
    const w = safeNumber(r.weightPct, 0);
    if (w > cap + 1e-9) {
      excess += w - cap;
      r.weightPct = cap;
      if (r.originalWeightPct !== undefined) {
        const ow = safeNumber(r.originalWeightPct, w);
        r.originalWeightPct = w > 1e-9 ? (cap / w) * ow : cap;
      }
    }
  }
  if (excess <= 1e-9) return;

  let rem = excess;
  for (let pass = 0; pass < 8; pass += 1) {
    if (rem <= 1e-9) break;
    const before = rem;
    const elig = rows.filter((r) => !isProtected(r) && safeNumber(r.weightPct, 0) > 1e-12);
    const under = elig.filter((r) => safeNumber(r.weightPct, 0) < cap - 1e-9);
    const recipients = under.length > 0 ? under : elig;
    if (recipients.length === 0) break;
    rem = redistributeExcessBoundedByRank(recipients, rem, cap);
    if (rem >= before - 1e-12) break;
  }
}
