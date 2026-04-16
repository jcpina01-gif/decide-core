export type CompanyMetaEntry = {
  name: string;
  country: string;
  zone: string;
  sector: string;
  /** GICS / sub-sector quando útil na grelha do plano. */
  industry?: string;
};

export const COMPANY_META: Record<string, CompanyMetaEntry> = {
  /** Classe C (ticker mais usado em índices / alguns payloads do modelo). */
  GOOG: { name: "Alphabet (Classe C)", country: "USA", zone: "US", sector: "Communication Services" },
  /** Classe A. */
  GOOGL: { name: "Alphabet (Classe A)", country: "USA", zone: "US", sector: "Communication Services" },
  ALPHABET: { name: "Alphabet", country: "USA", zone: "US", sector: "Communication Services" },
  MRNA: { name: "Moderna", country: "USA", zone: "US", sector: "Health Care" },
  MU: { name: "Micron Technology", country: "USA", zone: "US", sector: "Technology" },
  LRCX: { name: "Lam Research", country: "USA", zone: "US", sector: "Technology" },
  WBD: { name: "Warner Bros. Discovery", country: "USA", zone: "US", sector: "Communication Services" },
  ASML: { name: "ASML", country: "Europe", zone: "EU", sector: "Technology" },
  KLAC: { name: "KLA", country: "USA", zone: "US", sector: "Technology" },
  INTC: { name: "Intel", country: "USA", zone: "US", sector: "Technology" },
  ADI: { name: "Analog Devices", country: "USA", zone: "US", sector: "Technology" },
  BKR: { name: "Baker Hughes", country: "USA", zone: "US", sector: "Energy" },
  CSX: { name: "CSX", country: "USA", zone: "US", sector: "Industrials" },
  AMGN: { name: "Amgen", country: "USA", zone: "US", sector: "Health Care" },
  ROST: { name: "Ross Stores", country: "USA", zone: "US", sector: "Consumer Discretionary" },
  PCAR: { name: "PACCAR", country: "USA", zone: "US", sector: "Industrials" },
  GILD: { name: "Gilead", country: "USA", zone: "US", sector: "Health Care" },
  MNST: { name: "Monster Beverage", country: "USA", zone: "US", sector: "Consumer Staples" },
  BIIB: { name: "Biogen", country: "USA", zone: "US", sector: "Health Care" },
  MAR: { name: "Marriott", country: "USA", zone: "US", sector: "Consumer Discretionary" },
  TXN: { name: "Texas Instruments", country: "USA", zone: "US", sector: "Technology" },
  REGN: { name: "Regeneron", country: "USA", zone: "US", sector: "Health Care" },
  ILMN: { name: "Illumina", country: "USA", zone: "US", sector: "Health Care" },
  TEVA: { name: "Teva", country: "Israel", zone: "OTHER", sector: "Health Care" },
  SMTOY: { name: "Suntory", country: "Japan", zone: "JP", sector: "Consumer Staples" },
  GFI: { name: "Gold Fields", country: "South Africa", zone: "OTHER", sector: "Materials" },
  YPF: { name: "YPF", country: "Argentina", zone: "OTHER", sector: "Energy" },
  LLY: { name: "Eli Lilly", country: "USA", zone: "US", sector: "Health Care" },
  BCS: { name: "Barclays", country: "UK", zone: "EU", sector: "Financials" },
  NOK: { name: "Nokia", country: "Finland", zone: "EU", sector: "Technology" },
  CAT: { name: "Caterpillar", country: "USA", zone: "US", sector: "Industrials" },
  DLTR: { name: "Dollar Tree", country: "USA", zone: "US", sector: "Consumer Staples" },
  LVMUY: { name: "LVMH", country: "France", zone: "EU", sector: "Consumer Discretionary" },
  APH: { name: "Amphenol", country: "USA", zone: "US", sector: "Technology" },
  AMAT: { name: "Applied Materials", country: "USA", zone: "US", sector: "Technology" },
  CNQ: { name: "Canadian Natural", country: "Canada", zone: "CAN", sector: "Energy" },
  AEM: { name: "Agnico Eagle", country: "Canada", zone: "CAN", sector: "Materials" },
  WPM: { name: "Wheaton Precious", country: "Canada", zone: "CAN", sector: "Materials" },
  SU: { name: "Suncor", country: "Canada", zone: "CAN", sector: "Energy" },
  EQNR: { name: "Equinor", country: "Norway", zone: "EU", sector: "Energy" },
  E: { name: "ENI", country: "Italy", zone: "EU", sector: "Energy" },
  JXHLY: { name: "JX Holdings", country: "Japan", zone: "JP", sector: "Energy" },
  TOELY: { name: "Toyota", country: "Japan", zone: "JP", sector: "Consumer Discretionary" },
  XOM: { name: "Exxon Mobil", country: "USA", zone: "US", sector: "Energy" },
  CCI: { name: "Crown Castle", country: "USA", zone: "US", sector: "Real Estate" },
  CCJ: { name: "Cameco", country: "Canada", zone: "CAN", sector: "Materials" },
  /** Diamondback Energy (NASDAQ) — presente no universo DECIDE (não confundir com índice FANG+). */
  FANG: { name: "Diamondback Energy", country: "USA", zone: "US", sector: "Energy" },
  BDX: {
    name: "Becton Dickinson",
    country: "USA",
    zone: "US",
    sector: "Health Care",
    industry: "Medical equipment & supplies",
  },
  AFL: {
    name: "Aflac",
    country: "USA",
    zone: "US",
    sector: "Financials",
    industry: "Life & health insurance",
  },
  LIN: {
    name: "Linde",
    country: "USA",
    zone: "US",
    sector: "Materials",
    industry: "Industrial gases",
  },
};

/**
 * Preenche sectores / região / nome quando os CSV `company_meta_*.csv` não existem ou não cobrem o ticker.
 * Os CSV lidos no SSR sobrepõem estes valores quando trazem células preenchidas.
 */
export function seedMetaMapFromCompanyMeta(upsertMeta: (row: Record<string, string>) => void): void {
  for (const [ticker, entry] of Object.entries(COMPANY_META)) {
    upsertMeta({
      ticker,
      sector: entry.sector,
      zone: entry.zone,
      name_short: entry.name,
      industry: entry.industry ?? "",
    });
  }
}
