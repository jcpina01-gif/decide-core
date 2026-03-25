export type TickerNameMap = Record<string, string>;

/**
 * Mapa simples de nomes.
 * (Podemos ir enriquecendo ao longo do tempo.)
 */
export const TICKER_NAMES: TickerNameMap = {
  "SPY": "SPDR S&P 500 ETF Trust",
  "QQQ": "Invesco QQQ Trust",
  "IWM": "iShares Russell 2000 ETF",

  "MU": "Micron Technology",
  "LRCX": "Lam Research",
  "INTC": "Intel",
  "ASML": "ASML Holding",
  "NVDA": "NVIDIA",
  "MSFT": "Microsoft",
  "AAPL": "Apple",
  "AMZN": "Amazon",
  "GOOGL": "Alphabet (Class A)",
  "META": "Meta Platforms",
  "TSLA": "Tesla",
};

export function getTickerName(ticker: string): string {
  if (!ticker) return "";
  const t = ticker.trim().toUpperCase();
  return TICKER_NAMES[t] ?? t; // fallback: o próprio ticker
}
