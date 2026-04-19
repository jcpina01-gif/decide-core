/**
 * Liga símbolos reais na IBKR (MM EUR, ETF proxy) ao sleeve «caixa / T-Bills» do plano DECIDE
 * para cópia na UI (Plano, Atividade).
 */
import { eurMmIbTicker } from "./clientReportCoreUtils";

function normSym(s: string): string {
  return String(s || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
}

/**
 * UCITS MM EUR usado no envio (`EUR_MM_PROXY` → este ticker).
 * Usa a mesma cadeia de env que `eurMmIbTicker` no SSR (`NEXT_PUBLIC_*` **e** `EUR_MM_IB_TICKER`)
 * para a linha de caixa ser **protegida** nos caps por zona — só `NEXT_PUBLIC_*` quebrava o teto JP.
 */
export function clientEurMmIbTicker(): string {
  return eurMmIbTicker();
}

/** ETF USD opcional (quando configurado); o relatório pode usar sobretudo MM EUR. */
export function clientUsTbillProxyIbTicker(): string | null {
  const v = (
    process.env.NEXT_PUBLIC_TBILL_PROXY_IB_TICKER ||
    process.env.TBILL_PROXY_IB_TICKER ||
    ""
  )
    .trim()
    .toUpperCase();
  return v || null;
}

export function isDecideCashSleeveBrokerSymbol(ticker: string): boolean {
  const u = normSym(ticker);
  if (!u) return false;
  /** Proxies do plano — sempre fora do sleeve de risco nos caps (independentemente de env MM). */
  if (u === "TBILL_PROXY" || u === "EUR_MM_PROXY") return true;
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
