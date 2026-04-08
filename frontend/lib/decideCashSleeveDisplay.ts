/**
 * Liga símbolos reais na IBKR (MM EUR, ETF proxy) ao sleeve «caixa / T-Bills» do plano DECIDE
 * para cópia na UI (Plano, Atividade).
 */

function normSym(s: string): string {
  return String(s || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
}

/** UCITS MM EUR usado no envio (`EUR_MM_PROXY` → este ticker). */
export function clientEurMmIbTicker(): string {
  const v = (process.env.NEXT_PUBLIC_EUR_MM_IB_TICKER || "CSH2").trim().toUpperCase();
  return v || "CSH2";
}

/** ETF USD opcional (quando configurado); o relatório pode usar sobretudo MM EUR. */
export function clientUsTbillProxyIbTicker(): string | null {
  const v = (process.env.NEXT_PUBLIC_TBILL_PROXY_IB_TICKER || "").trim().toUpperCase();
  return v || null;
}

export function isDecideCashSleeveBrokerSymbol(ticker: string): boolean {
  const u = normSym(ticker);
  if (!u) return false;
  if (u === clientEurMmIbTicker()) return true;
  const us = clientUsTbillProxyIbTicker();
  if (us && u === us) return true;
  return false;
}

export function cashSleevePlanUiSubtitle(): string {
  return "Sleeve caixa / T-Bills do plano (DECIDE)";
}

/** Acrescentar ao campo `detail` em registos de Atividade. */
export function cashSleeveActivityExtraSentence(ticker: string): string | null {
  if (!isDecideCashSleeveBrokerSymbol(ticker)) return null;
  return "É o sleeve caixa / T-Bills do plano; «Submetida / em curso» na TWS é normal até execução (horário de mercado, liquidez).";
}

export function appendCashSleeveToDetail(ticker: string, baseDetail: string): string {
  const extra = cashSleeveActivityExtraSentence(ticker);
  if (!extra) return baseDetail;
  const b = baseDetail.trim();
  if (!b) return extra;
  if (b.includes(extra)) return b;
  return `${b} ${extra}`;
}
