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
  MU: {
    name: "Micron Technology",
    country: "USA",
    zone: "US",
    sector: "Technology",
    industry: "Semiconductors (memory & storage)",
  },
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
  HON: { name: "Honeywell International", country: "USA", zone: "US", sector: "Industrials" },
  AEP: { name: "American Electric Power", country: "USA", zone: "US", sector: "Utilities" },
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
  NOK: {
    name: "Nokia",
    country: "Finland",
    zone: "EU",
    sector: "Technology",
    industry: "Communications equipment",
  },
  CAT: { name: "Caterpillar", country: "USA", zone: "US", sector: "Industrials" },
  DLTR: { name: "Dollar Tree", country: "USA", zone: "US", sector: "Consumer Staples" },
  LVMUY: { name: "LVMH", country: "France", zone: "EU", sector: "Consumer Discretionary" },
  APH: { name: "Amphenol", country: "USA", zone: "US", sector: "Technology" },
  AMAT: {
    name: "Applied Materials",
    country: "USA",
    zone: "US",
    sector: "Technology",
    industry: "Semiconductor materials & equipment",
  },
  CNQ: {
    name: "Canadian Natural Resources",
    country: "Canada",
    zone: "CAN",
    sector: "Energy",
    industry: "Integrated oil & gas / oil sands",
  },
  AEM: { name: "Agnico Eagle", country: "Canada", zone: "CAN", sector: "Materials" },
  WPM: { name: "Wheaton Precious", country: "Canada", zone: "CAN", sector: "Materials" },
  SU: { name: "Suncor", country: "Canada", zone: "CAN", sector: "Energy" },
  EQNR: {
    name: "Equinor",
    country: "Norway",
    zone: "EU",
    sector: "Energy",
    industry: "Integrated oil & gas",
  },
  E: {
    name: "Eni",
    country: "Italy",
    zone: "EU",
    sector: "Energy",
    industry: "Integrated oil & gas",
  },
  JXHLY: { name: "JX Holdings", country: "Japan", zone: "JP", sector: "Energy" },
  /** ADR OTC — Tokyo Electron (8035.T); não confundir com Toyota (TM). */
  TOELY: {
    name: "Tokyo Electron",
    country: "Japan",
    zone: "JP",
    sector: "Technology",
    industry: "Semiconductor production equipment",
  },
  FRCOY: {
    name: "Fast Retailing (Uniqlo)",
    country: "Japan",
    zone: "JP",
    sector: "Consumer Discretionary",
    industry: "Apparel retail",
  },
  NTDOY: {
    name: "Nintendo",
    country: "Japan",
    zone: "JP",
    sector: "Communication Services",
    industry: "Interactive entertainment / games",
  },
  /** 8411.T — Mizuho Financial Group (ADR ``MFG``). */
  MFG: {
    name: "Mizuho Financial Group",
    country: "Japan",
    zone: "JP",
    sector: "Financials",
    industry: "Diversified banks",
  },
  FANUY: {
    name: "Fanuc",
    country: "Japan",
    zone: "JP",
    sector: "Industrials",
    industry: "Industrial automation & robotics",
  },
  MARUY: {
    name: "Marubeni",
    country: "Japan",
    zone: "JP",
    sector: "Industrials",
    industry: "Trading companies & distributors",
  },
  SMFG: {
    name: "Sumitomo Mitsui Financial Group",
    country: "Japan",
    zone: "JP",
    sector: "Financials",
    industry: "Diversified banks",
  },
  HTHIY: {
    name: "Hitachi",
    country: "Japan",
    zone: "JP",
    sector: "Industrials",
    industry: "Industrial conglomerate",
  },
  MSBHF: {
    name: "Mitsubishi Corporation",
    country: "Japan",
    zone: "JP",
    sector: "Industrials",
    industry: "Trading companies & distributors",
  },
  /** 6981.T — Murata Manufacturing. */
  MRAAY: {
    name: "Murata Manufacturing",
    country: "Japan",
    zone: "JP",
    sector: "Technology",
    industry: "Electronic components",
  },
  SFTBY: {
    name: "SoftBank Group",
    country: "Japan",
    zone: "JP",
    sector: "Communication Services",
    industry: "Telecommunications / holding",
  },
  TM: {
    name: "Toyota Motor",
    country: "Japan",
    zone: "JP",
    sector: "Consumer Discretionary",
    industry: "Automobiles",
  },
  SONY: {
    name: "Sony Group",
    country: "Japan",
    zone: "JP",
    sector: "Technology",
    industry: "Consumer electronics & entertainment",
  },
  MUFG: {
    name: "Mitsubishi UFJ Financial Group",
    country: "Japan",
    zone: "JP",
    sector: "Financials",
    industry: "Diversified banks",
  },
  KDDIY: {
    name: "KDDI",
    country: "Japan",
    zone: "JP",
    sector: "Communication Services",
    industry: "Wireless telecommunications",
  },
  /** Itochu (8001.T) quando o payload ainda usa a listagem Tóquio. */
  "8001.T": {
    name: "Itochu",
    country: "Japan",
    zone: "JP",
    sector: "Industrials",
    industry: "Trading companies & distributors",
  },
  /** Denso (6902.T). */
  "6902.T": {
    name: "Denso",
    country: "Japan",
    zone: "JP",
    sector: "Consumer Discretionary",
    industry: "Automotive components",
  },
  /** Hermès — Euronext Paris. */
  "RMS.PA": {
    name: "Hermès International",
    country: "France",
    zone: "EU",
    sector: "Consumer Discretionary",
    industry: "Luxury goods",
  },
  CSH2: {
    name: "Money market UCITS (EUR)",
    country: "European Economic Area",
    zone: "EU",
    sector: "Cash & equivalents",
    industry: "Short-term EUR money market",
  },
  XOM: {
    name: "Exxon Mobil",
    country: "USA",
    zone: "US",
    sector: "Energy",
    industry: "Integrated oil & gas",
  },
  CCI: { name: "Crown Castle", country: "USA", zone: "US", sector: "Real Estate" },
  CCJ: { name: "Cameco", country: "Canada", zone: "CAN", sector: "Materials" },
  /** Diamondback Energy (NASDAQ) — presente no universo DECIDE (não confundir com índice FANG+). */
  FANG: { name: "Diamondback Energy", country: "USA", zone: "US", sector: "Energy" },
  VLO: {
    name: "Valero Energy",
    country: "USA",
    zone: "US",
    sector: "Energy",
    industry: "Oil & gas refining & marketing",
  },
  OXY: {
    name: "Occidental Petroleum",
    country: "USA",
    zone: "US",
    sector: "Energy",
    industry: "Oil & gas exploration & production",
  },
  IMO: {
    name: "Imperial Oil",
    country: "Canada",
    zone: "CAN",
    sector: "Energy",
    industry: "Integrated oil & gas",
  },
  TTE: {
    name: "TotalEnergies",
    country: "France",
    zone: "EU",
    sector: "Energy",
    industry: "Integrated oil & gas",
  },
  TRGP: {
    name: "Targa Resources",
    country: "USA",
    zone: "US",
    sector: "Energy",
    industry: "Oil & gas storage & transportation",
  },
  SLB: {
    name: "SLB",
    country: "USA",
    zone: "US",
    sector: "Energy",
    industry: "Oil & gas equipment & services",
  },
  GOLD: {
    name: "Barrick Gold",
    country: "Canada",
    zone: "CAN",
    sector: "Materials",
    industry: "Gold mining",
  },
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
      country: entry.country,
      name_short: entry.name,
      industry: entry.industry ?? "",
    });
  }
}

/** Lookup robusto (ADR, ``BRK-B``, ``8001.T``, ``HON IB`` compactado) para preencher grelha do plano / relatório. */
export function lookupCompanyMetaEntry(ticker: string): CompanyMetaEntry | undefined {
  const raw0 = String(ticker || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
  if (!raw0) return undefined;
  const stripIbkrSuffix = (s: string): string => {
    let x = s;
    for (const suf of ["IB", "US", "LSE", "PA", "DE", "AS", "CN", "HK"]) {
      if (x.endsWith(suf) && x.length > suf.length + 1) {
        x = x.slice(0, -suf.length);
        break;
      }
    }
    return x;
  };
  const candidates = Array.from(new Set([raw0, stripIbkrSuffix(raw0)]));
  const tab = COMPANY_META as Record<string, CompanyMetaEntry>;
  for (const raw of candidates) {
    const keys = [raw, raw.replace(/\./g, "-"), raw.replace(/-/g, ".")];
    for (const k of keys) {
      const hit = tab[k];
      if (hit) return hit;
    }
  }
  return undefined;
}
