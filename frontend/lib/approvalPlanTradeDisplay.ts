/**
 * Pure UI / agregação do plano — seguro para o bundle do browser (sem `fs`).
 * Mantém-se alinhado a `fillSyntheticEquityBuyQuantities` em `approvalTradePlan.ts`.
 */

function safeNumber(x: unknown, fallback = 0): number {
  const v = typeof x === "number" ? x : Number(x);
  return Number.isFinite(v) ? v : fallback;
}

/**
 * Compra de acção sem `absQty` nem `marketPrice`: não há último close em `prices_close.csv`
 * para converter peso alvo em quantidade. O `deltaValueEst` pode ainda ser peso×NAV.
 */
export function isBuyMissingEquityClosePrice(t: {
  side: string;
  absQty: number;
  marketPrice: number;
}): boolean {
  if (String(t.side || "").toUpperCase() !== "BUY") return false;
  const q = Math.floor(Math.abs(safeNumber(t.absQty, 0)));
  if (q > 0) return false;
  return !(safeNumber(t.marketPrice, 0) > 0);
}

/** Montante USD estimado das compras (qty × preço) — hedge EURUSD no mesmo envio que as ações. */
export function estimateUsdNotionalForBuyFxHedge(
  trades: Array<{
    side: string;
    ticker: string;
    absQty: number;
    marketPrice: number;
    deltaValueEst: number;
  }>,
): number {
  let sumPx = 0;
  let sumDelta = 0;
  for (const t of trades) {
    if (String(t.side).toUpperCase() !== "BUY") continue;
    const tick = String(t.ticker).toUpperCase();
    if (tick === "EURUSD" || tick === "TBILL_PROXY" || tick === "EUR_MM_PROXY") continue;
    const q = Math.floor(Math.abs(Number(t.absQty) || 0));
    const px = Number(t.marketPrice) || 0;
    if (q > 0 && px > 0) sumPx += q * px;
    if (!isBuyMissingEquityClosePrice(t)) {
      sumDelta += Math.abs(Number(t.deltaValueEst) || 0);
    }
  }
  const rounded = Math.round(sumPx * 100) / 100;
  const deltaUsd = Math.round(sumDelta * 100) / 100;
  return Math.max(rounded, deltaUsd);
}
