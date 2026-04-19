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

/** Normaliza espaços (incl. NBSP) e compat Unicode antes de regras geo. */
export function normalizeGeoTickerInput(ticker: string): string {
  return String(ticker || "")
    .trim()
    .normalize("NFKC")
    .replace(/[\u00a0\u1680\u2000-\u200a\u202f\u205f\u3000\ufeff]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Símbolo base para regras geo (ex. «MFG IB» → MFG; mantém 8035.T, BRK.B). */
export function canonicalTickerForGeo(ticker: string): string {
  let t = normalizeGeoTickerInput(ticker).toUpperCase();
  if (!t) return "";
  /** Export / gateways: «TOELYIB», «RMS-PAIB» (IB colado — quebra KNOWN_JP_ADRS se não separar). */
  const gluedIb = /^([A-Z0-9][A-Z0-9.\-]{2,})IB$/i.exec(t.replace(/\s+/g, ""));
  if (gluedIb) {
    t = gluedIb[1].replace(/\./g, "-");
  }
  const parts = t.split(/\s+/).filter(Boolean);
  if (parts.length === 2 && parts[1] === "IB") return parts[0].replace(/\./g, "-");
  /**
   * IBKR / exportes: «TOELY US», «NTDOY SMART», etc.
   * Não colar o 2.º token ao símbolo — senão «TOELY»+«US» vira «TOELYUS» e deixa de bater com
   * ``KNOWN_JP_ADRS`` (o cap JP vs benchmark no relatório falha e o plano fica «quase tudo JP»).
   */
  if (parts.length >= 2) {
    const p0 = parts[0].replace(/\./g, "-");
    const p1 = parts[1];
    if (/^[A-Z0-9.\-]{1,12}$/.test(p0) && /^[A-Z]{2,6}$/.test(p1)) {
      return p0;
    }
  }
  return t.replace(/\s+/g, "");
}

function asciiFold(s: string): string {
  return String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

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
  const raw = normalizeGeoTickerInput(ticker).toUpperCase();
  if (!raw) return false;
  const geoKey = canonicalTickerForGeo(ticker);
  const firstSeg = raw.split(/\s+/)[0]?.replace(/\./g, "-").toUpperCase() ?? "";
  if (isTokyoNumericListing(raw)) return true;
  if (/^\d{3,5}-T$/i.test(raw.replace(/\s+/g, ""))) return true;
  const adr = remapTokyoListingToAdr(raw);
  if (adr !== raw && KNOWN_JP_ADRS.has(adr)) return true;
  if (KNOWN_JP_ADRS.has(raw)) return true;
  if (KNOWN_JP_ADRS.has(geoKey)) return true;
  if (firstSeg && KNOWN_JP_ADRS.has(firstSeg)) return true;
  return false;
}

function nonEmpty(s: unknown): s is string {
  return typeof s === "string" && s.trim().length > 0;
}

/** Células «—» / «-» / n/a da UI ou da API não contam como dado geo — permitem inferência. */
export function meaningfulGeoTableCell(s: unknown): boolean {
  if (!nonEmpty(s)) return false;
  const t = String(s).trim();
  const n = t.normalize("NFKC");
  /** Só traços / espaços / pontuação mínima (homóglifos de «—» vindos de CSV/API). */
  if (!/[A-Za-z\u00c0-\u024f\u1e00-\u1eff]/.test(n)) return false;
  if (t === "-" || t === "—" || t === "–" || t === "\u2212") return false;
  const u = t.toLowerCase();
  if (u === "n/a" || u === "nan" || u === "null") return false;
  return true;
}

/** IBKR devolve «EUA» / América do Norte para ADRs cotados em NY — não é a sede da empresa. */
function looksLikeUsListingVenue(country: string, zone: string): boolean {
  const c = asciiFold(String(country || "").trim());
  const z = asciiFold(String(zone || "").trim());
  if (/\b(eua|usa|united states|estados unidos|u\.s\.a\.?|u\.s\.?)\b/.test(c)) return true;
  if (/\b(north america)\b/.test(z)) return true;
  /* «América do Norte» sem acento após NFD; também LATAM «Americas» + norte */
  if (/\b(america|americas)\b/.test(z) && /\b(norte|north)\b/.test(z)) return true;
  return false;
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
 * Rótulo para a coluna «Zona» (continente / macro) quando a IBKR não envia ``zone``/geo mas há região do plano,
 * país ou ticker JP conhecido — alinha com os rótulos do SSR do relatório.
 */
export function displayGeoZoneFromTickerAndMeta(
  ticker: string,
  meta: { country?: string; region?: string; zone?: string },
): string {
  const z0 = normalizeGeoTickerInput(String(meta.zone || ""));
  if (meaningfulGeoTableCell(z0)) return z0;
  const r = String(meta.region || "").trim().toUpperCase();
  if (r === "JP" || r === "JAPAN" || r === "JPN") return "Ásia (JP)";
  if (r === "US" || r === "USA") return "América do Norte";
  if (r === "EU" || r === "UK" || r === "EUROPE" || r === "EMU") return "Europa";
  if (r === "CAN" || r === "CANADA" || r === "CA") return "Canadá";
  if (isJapaneseEquityTicker(ticker)) return "Ásia (JP)";
  const tk = normalizeGeoTickerInput(String(ticker || "")).toUpperCase();
  const tkCompact = tk.replace(/\s+/g, "");
  /** Euronext Paris / suffixos .PA / -PA (mesmo com «SYM IB» já reduzido em ``canonicalTickerForGeo``). */
  if (/(?:\.|-)PA$/i.test(tkCompact) || /(?:\.|-)PA$/i.test(canonicalTickerForGeo(ticker))) return "Europa";
  const co = String(meta.country || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  if (/\bjapan\b|\bjapao\b|\bjapon\b|nippon|\btokyo\b/.test(co)) return "Ásia (JP)";
  if (
    /\bfrance\b|\bfrancia\b|\bunited kingdom\b|\bengland\b|reino unido|inglaterra|wales|scotland|\buk\b/.test(co)
  ) {
    return "Europa";
  }
  if (/\bunited states\b|\busa\b|estados unidos|\beua\b/.test(co)) return "América do Norte";
  if (/\bcanada\b|canad[aá]\b/.test(co)) return "Canadá";
  return "";
}

/**
 * Para ADRs japoneses conhecidos com país/zona de listagem EUA/América do Norte, normaliza país/zona/região
 * para alinhar ao plano (Japão / Ásia / JP). Nos restantes casos, preenche só campos ainda vazios.
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
  const tu = canonicalTickerForGeo(ticker);
  if (KNOWN_JP_ADRS.has(tu)) {
    const curC = String(out[kc] ?? "").trim();
    const curZ = String(out[kz] ?? "").trim();
    const curZUse = meaningfulGeoTableCell(curZ) ? curZ : "";
    if (looksLikeUsListingVenue(curC, curZUse)) {
      out[kc] = "Japão (ADR EUA)";
      out[kz] = fb.geoZone;
      out[kr] = fb.regionModel;
      if (!nonEmpty(out[ks])) out[ks] = fb.sector;
    }
  }
  if (!meaningfulGeoTableCell(out[kc])) out[kc] = fb.country;
  if (!meaningfulGeoTableCell(out[kz])) out[kz] = fb.geoZone;
  if (!meaningfulGeoTableCell(out[kr])) out[kr] = fb.regionModel;
  if (!nonEmpty(out[ks])) out[ks] = fb.sector;
  return out;
}
