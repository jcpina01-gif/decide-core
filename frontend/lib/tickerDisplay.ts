/**
 * Mapa de tickers → nome de display mais legível.
 * Usado nas tabelas da UI em vez do código Bloomberg/IB bruto.
 */
const TICKER_DISPLAY: Record<string, string> = {
  GOOGL: "Alphabet A",
  GOOG:  "Alphabet C",
  BRK_B: "Berkshire B",
  "BRK.B": "Berkshire B",
  XEON:  "MM Euro",
};

/** Devolve o nome de display para um ticker, ou o próprio ticker se não houver mapeamento. */
export function displayTicker(ticker: string): string {
  return TICKER_DISPLAY[ticker] ?? ticker;
}
