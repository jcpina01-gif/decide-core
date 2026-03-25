import { COMPANY_META } from "./companyMeta";

export type Holding = {
  ticker?: string;
  weight?: number;
  weight_pct?: number;
  short_name?: string;
  name?: string;
  country?: string;
  zone?: string;
  region?: string;
  sector?: string;
  score?: number | null;
  rank_momentum?: number | null;
};

export type AggregatedHolding = {
  key: string;
  displayTicker: string;
  companyShort: string;
  country: string;
  zone: string;
  sector: string;
  weight: number;
  weightPct: number;
  componentTickers: string[];
};

export type ZoneWeights = {
  us: number;
  eu: number;
  jp: number;
  can: number;
  other: number;
};

export type SectorWeight = {
  sector: string;
  weight: number;
};

export function issuerKeyFromTicker(ticker: string): string {
  const t = (ticker || "").toUpperCase().trim();
  if (t === "GOOG" || t === "GOOGL") return "ALPHABET";
  return t;
}

export function normalizeZone(value?: string): string {
  const z = (value || "").toUpperCase().trim();
  if (z === "US" || z === "USA") return "US";
  if (z === "EU" || z === "EUR" || z === "EUROPE") return "EU";
  if (z === "JP" || z === "JAPAN") return "JP";
  if (z === "CAN" || z === "CA" || z === "CANADA") return "CAN";
  if (!z) return "";
  return "OTHER";
}

export function aggregateHoldings(holdings: Holding[] = []): AggregatedHolding[] {
  const map = new Map<string, AggregatedHolding>();

  for (const item of holdings) {
    const ticker = String(item.ticker || "").toUpperCase().trim();
    if (!ticker) continue;

    const key = issuerKeyFromTicker(ticker);
    const weight = Number(item.weight || 0);
    const fallback = COMPANY_META[key] || { name: key, country: "", zone: "OTHER", sector: "Other" };

    const companyShort = String(item.short_name || item.name || "").trim() || fallback.name || key;

    const country =
      String(item.country || "").trim() ||
      (item.region && String(item.region).length > 2 ? String(item.region).trim() : "") ||
      fallback.country ||
      "";

    const zone = normalizeZone(item.zone) || normalizeZone(item.region) || normalizeZone(fallback.zone) || "OTHER";
    const sector = String(item.sector || "").trim() || fallback.sector || "Other";

    if (!map.has(key)) {
      map.set(key, {
        key,
        displayTicker: key,
        companyShort,
        country,
        zone,
        sector,
        weight: 0,
        weightPct: 0,
        componentTickers: [],
      });
    }

    const row = map.get(key)!;
    row.weight += weight;

    if (!row.country && country) row.country = country;
    if ((!row.zone || row.zone === "OTHER") && zone) row.zone = zone;
    if ((!row.sector || row.sector === "Other") && sector) row.sector = sector;
    if ((!row.companyShort || row.companyShort === key) && companyShort) row.companyShort = companyShort;

    if (!row.componentTickers.includes(ticker)) {
      row.componentTickers.push(ticker);
    }
  }

  return Array.from(map.values())
    .map((row) => {
      row.componentTickers.sort();
      row.weightPct = row.weight * 100;
      return row;
    })
    .sort((a, b) => b.weight - a.weight);
}

export function calcAbsoluteZoneWeights(holdings: AggregatedHolding[]): ZoneWeights {
  const us = holdings.filter((h) => h.zone === "US").reduce((a, h) => a + h.weight, 0);
  const eu = holdings.filter((h) => h.zone === "EU").reduce((a, h) => a + h.weight, 0);
  const jp = holdings.filter((h) => h.zone === "JP").reduce((a, h) => a + h.weight, 0);
  const can = holdings.filter((h) => h.zone === "CAN").reduce((a, h) => a + h.weight, 0);
  const other = holdings.filter((h) => h.zone === "OTHER").reduce((a, h) => a + h.weight, 0);
  return { us, eu, jp, can, other };
}

export function calcSectorWeightsAbsolute(holdings: AggregatedHolding[]): SectorWeight[] {
  const map = new Map<string, number>();
  for (const h of holdings) {
    map.set(h.sector || "Other", (map.get(h.sector || "Other") || 0) + h.weight);
  }

  return Array.from(map.entries())
    .map(([sector, weight]) => ({ sector, weight }))
    .sort((a, b) => b.weight - a.weight);
}
