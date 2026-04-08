/**
 * URL da cotação no Yahoo Finance para um ticker (formato alinhado ao usado no histórico de recomendações).
 */
export function yahooFinanceQuoteHref(ticker: string): string | null {
  const sym = ticker.trim().toUpperCase().replace(/\s+/g, "").replace(/\./g, "-");
  if (!sym || sym === "—") return null;
  return `https://finance.yahoo.com/quote/${encodeURIComponent(sym)}`;
}
