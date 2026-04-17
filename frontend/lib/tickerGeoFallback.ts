/**
 * Preenche país / zona / região quando o motor ou o snapshot IBKR não trazem meta
 * (caso típico: ADRs japoneses e listagens .T / -T).
 * Mantém-se alinhado a ``lib/server/jpListingToAdrMap.ts`` (BUILTIN) sem ler ficheiros no browser.
 */

const JP_LISTING_TO_ADR: Record<string, string> = {
  "8035.T": "TOELY",
  "7974.T": "NTDOY",
  "8411.T": "MFG",
  "7203.T": "TM",
  "6758.T": "SONY",
  "8306.T": "MUFG",
  "8316.T": "SMFG",
  "9433.T": "KDDIY",
  "9984.T": "SFTBY",
  "6501.T": "HTHIY",
  "9983.T": "FRCOY",
  "6954.T": "FANUY",
  "8002.T": "MARUY",
  "8058.T": "MSBHF",
  "6981.T": "MRAAY",
};

const KNOWN_JP_ADRS = new Set(
  [...Object.values(JP_LISTING_TO_ADR)].map((s) => s.trim().toUpperCase()).filter(Boolean),
);

export function normalizeTokyoListingKey(ticker: string): string {
  let t = String(ticker || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
  if (/^\d{3,5}-T$/.test(t)) {
    t = `${t.slice(0, -2)}.T`;
  } else if (/^\d{3,5}T$/.test(t)) {
    t = `${t.slice(0, -1)}.T`;
  }
  return t;
}

export function isTokyoNumericListing(ticker: string): boolean {
  return /^\d{3,5}\.T$/.test(normalizeTokyoListingKey(ticker));
}

/** Listagem Tóquio (8035.T) → ADR OTC (TOELY) quando conhecido; senão devolve o ticker normalizado. */
export function remapTokyoListingToAdr(ticker: string): string {
  const k = normalizeTokyoListingKey(ticker);
  if (!isTokyoNumericListing(k)) return String(ticker || "").trim().toUpperCase();
  return JP_LISTING_TO_ADR[k] || String(ticker || "").trim().toUpperCase();
}

export function isJapaneseEquityTicker(ticker: string): boolean {
  const raw = String(ticker || "").trim().toUpperCase();
  if (!raw) return false;
  if (isTokyoNumericListing(raw)) return true;
  if (/^\d{3,5}-T$/i.test(raw.replace(/\s+/g, ""))) return true;
  const adr = remapTokyoListingToAdr(raw);
  if (adr !== raw && KNOWN_JP_ADRS.has(adr)) return true;
  if (KNOWN_JP_ADRS.has(raw)) return true;
  return false;
}

function nonEmpty(s: unknown): s is string {
  return typeof s === "string" && s.trim().length > 0;
}

export type GeoFallbackPatch = {
  country: string;
  geoZone: string;
  regionModel: string;
  sector?: string;
};

/** Etiquetas PT para colunas de país / zona geográfica / bloco US-EU-JP-CAN. */
export function japanEquityDisplayFallback(): GeoFallbackPatch {
  return {
    country: "Japão",
    geoZone: "Ásia",
    regionModel: "JP",
    sector: "Acções — Japão",
  };
}

/** Carteira detalhada (dashboard): ``zone``/``region`` = códigos US/EU/JP para cartões de exposição. */
export function applyJapaneseEquityDashboardHoldingPatch<T extends { ticker?: string; country?: string; zone?: string; region?: string; sector?: string }>(
  h: T,
): T {
  const tk = String(h.ticker || "");
  if (!isJapaneseEquityTicker(tk)) return h;
  return {
    ...h,
    country: nonEmpty(h.country) ? h.country : "Japan",
    zone: nonEmpty(h.zone) ? h.zone : "JP",
    region: nonEmpty(h.region) ? h.region : "JP",
    sector: nonEmpty(h.sector) ? h.sector : "Acções — Japão",
  };
}

export type FallbackFieldNames = {
  country?: string;
  zone?: string;
  region?: string;
  sector?: string;
};

/**
 * Preenche só campos ainda vazios (não sobrepõe IBKR nem CSV).
 * `fieldNames` permite mapear chaves (ex.: `geoZone` em vez de `zone`).
 */
export function applyJapaneseEquityDisplayFallback(
  ticker: string,
  row: Record<string, unknown>,
  fieldNames: FallbackFieldNames = {},
): Record<string, unknown> {
  if (!isJapaneseEquityTicker(ticker)) return row;
  const fb = japanEquityDisplayFallback();
  const out = { ...row };
  const kc = fieldNames.country || "country";
  const kz = fieldNames.zone || "zone";
  const kr = fieldNames.region || "region";
  const ks = fieldNames.sector || "sector";
  if (!nonEmpty(out[kc])) out[kc] = fb.country;
  if (!nonEmpty(out[kz])) out[kz] = fb.geoZone;
  if (!nonEmpty(out[kr])) out[kr] = fb.regionModel;
  if (!nonEmpty(out[ks])) out[ks] = fb.sector;
  return out;
}
