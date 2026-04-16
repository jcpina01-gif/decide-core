/**
 * Listagens Yahoo / ficheiros ``NNNN.T`` ou ``NNNN-T`` = Tóquio (JPY). Para plano e IBKR em USD,
 * mapear para ADRs/OTC equivalentes (ver ``backend/data/jp_listing_to_adr.csv``).
 */
import fs from "fs";
import path from "path";

import { resolveDecideProjectRoot } from "./decideProjectRoot";

const CSV_REL = "backend/data/jp_listing_to_adr.csv";

/** Fallback se o CSV não existir no deploy. */
/** Só pares com coluna ``adr`` presente em ``prices_close.csv`` (evita símbolo inexistente no motor). */
const BUILTIN: Record<string, string> = {
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

let cachedMap: Map<string, string> | null = null;

export function normalizeJpListingKey(ticker: string): string {
  let t = String(ticker || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
  if (/^\d{3,5}-T$/.test(t)) {
    t = `${t.slice(0, -2)}.T`;
  } else if (/^\d{3,5}T$/.test(t)) {
    /* Yahoo / exportes sem ponto: ``8035T`` */
    t = `${t.slice(0, -1)}.T`;
  }
  return t;
}

export function isJpNumericListingTicker(ticker: string): boolean {
  return /^\d{3,5}\.T$/.test(normalizeJpListingKey(ticker));
}

function loadMapFromDisk(): Map<string, string> {
  const m = new Map<string, string>();
  for (const [k, v] of Object.entries(BUILTIN)) {
    m.set(k.toUpperCase(), v.toUpperCase());
  }
  const root = resolveDecideProjectRoot(process.cwd());
  const abs = path.join(root, ...CSV_REL.split("/"));
  if (!fs.existsSync(abs)) return m;
  try {
    const text = fs.readFileSync(abs, "utf8");
    const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length < 2) return m;
    for (let i = 1; i < lines.length; i += 1) {
      const parts = lines[i]!.split(",");
      if (parts.length < 2) continue;
      const listing = normalizeJpListingKey(parts[0] || "");
      const adr = String(parts[1] || "")
        .trim()
        .toUpperCase();
      if (!listing || !adr) continue;
      m.set(listing, adr);
    }
  } catch {
    /* keep builtin */
  }
  return m;
}

export function jpListingToAdrMap(): Map<string, string> {
  if (!cachedMap) cachedMap = loadMapFromDisk();
  return cachedMap;
}

/** @internal tests */
export function _resetJpListingToAdrMapCacheForTests(): void {
  cachedMap = null;
}

export function remapJpListingToAdrTicker(ticker: string): string {
  if ((process.env.DECIDE_DISABLE_JP_T_TO_ADR_REMAP || "").trim() === "1") return ticker;
  const k = normalizeJpListingKey(ticker);
  if (!isJpNumericListingTicker(k)) return ticker.trim();
  const adr = jpListingToAdrMap().get(k);
  return adr || ticker.trim();
}
