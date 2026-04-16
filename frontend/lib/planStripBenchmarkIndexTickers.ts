/**
 * Símbolos que são ETFs de índice amplo, proxies regionais de benchmark ou, no caso de DOW,
 * pedido explícito para não constar no plano (evitar confusão com o índice DJIA).
 * Retiram-se da carteira recomendada e o peso redistribui-se pelas restantes linhas de rácio.
 */
const PLAN_STRIP_INDEX_TICKERS = new Set(
  [
    "SPY",
    "QQQ",
    "DIA",
    "IWM",
    "VTI",
    "VOO",
    "IVV",
    "SCHX",
    "RSP",
    "IJH",
    "IJR",
    "MDY",
    "EFA",
    "EEM",
    "VEA",
    "IEFA",
    "IEMG",
    "ACWI",
    "VT",
    "VXUS",
    "ACWX",
    "VGK",
    "EWJ",
    "EWC",
    "SPDW",
    "URTH",
    "SCHB",
    "DOW",
  ].map((s) => s.toUpperCase()),
);

function normPlanTickerKey(ticker: string): string {
  return String(ticker ?? "")
    .trim()
    .toUpperCase()
    .replace(/\./g, "-");
}

export function isPlanStrippedIndexTicker(ticker: string): boolean {
  return PLAN_STRIP_INDEX_TICKERS.has(normPlanTickerKey(ticker));
}

type RowWithWeights = {
  ticker: string;
  weightPct: number;
  originalWeightPct: number;
};

/**
 * Remove linhas de índice/ETF de benchmark e reparte o peso removido
 * proporcionalmente pelas demais posições (exc. `TBILL_PROXY`). Se não houver
 * destinatários, o peso acumula no sleeve de caixa (`TBILL_PROXY`).
 */
export function stripPlanBenchmarkIndexRows<T extends RowWithWeights>(rows: T[]): T[] {
  if (!rows.length) return rows;
  let removedW = 0;
  let removedOw = 0;
  const kept: T[] = [];
  for (const r of rows) {
    if (isPlanStrippedIndexTicker(r.ticker)) {
      removedW += Number(r.weightPct) || 0;
      removedOw += Number(r.originalWeightPct) || 0;
    } else {
      kept.push({ ...r });
    }
  }
  if (removedW <= 1e-12 && removedOw <= 1e-12) return kept;

  const tbIdx = kept.findIndex((p) => p.ticker === "TBILL_PROXY");
  const recipIdx: number[] = [];
  let sumW = 0;
  for (let i = 0; i < kept.length; i += 1) {
    if (kept[i].ticker === "TBILL_PROXY") continue;
    const w = Number(kept[i].weightPct) || 0;
    if (w > 1e-12) {
      recipIdx.push(i);
      sumW += w;
    }
  }

  if (sumW <= 1e-12) {
    if (tbIdx >= 0) {
      const t = kept[tbIdx];
      kept[tbIdx] = {
        ...t,
        weightPct: (Number(t.weightPct) || 0) + removedW,
        originalWeightPct: (Number(t.originalWeightPct) || 0) + removedOw,
      };
    }
    return kept;
  }

  for (const i of recipIdx) {
    const r = kept[i];
    const w = Number(r.weightPct) || 0;
    const ow = Number(r.originalWeightPct) || 0;
    const share = w / sumW;
    kept[i] = {
      ...r,
      weightPct: w + share * removedW,
      originalWeightPct: ow + share * removedOw,
    };
  }
  return kept;
}
