/**
 * Devolve preços actuais por ticker.
 * Fonte primária: snapshot IBKR via FastAPI (preço = market_value / qty).
 * Fallback: Yahoo Finance v8 chart API se o IB não estiver ligado.
 */
import type { NextApiRequest, NextApiResponse } from "next";

// Extend Vercel serverless timeout for this route (batched YF fetches need ~5-8 s)
export const config = { api: { responseLimit: false }, maxDuration: 30 };
import { getBackendBase } from "../../../lib/apiProxy";

export type PriceEntry = { price: number; currency: string; qty?: number; value?: number; source?: "ibkr" | "yf" } | null;
export type PriceResult = Record<string, PriceEntry>;

// ── IB snapshot ──────────────────────────────────────────────────────────────

async function fetchIbkrPrices(tickers: string[]): Promise<PriceResult | null> {
  const base = getBackendBase();
  const url = `${base.replace(/\/+$/, "")}/api/ibkr-snapshot`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paper_mode: true }),
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return null;
    const snap = await res.json() as {
      status?: string;
      positions?: Array<{
        ticker?: string; symbol?: string;
        value?: number; market_value?: number; marketValue?: number; position_value?: number;
        qty?: number; position?: number; shares?: number; size?: number;
        currency?: string; ccy?: string;
      }>;
    };
    if (!snap || !Array.isArray(snap.positions) || !snap.positions.length) return null;

    const result: PriceResult = {};
    const tickerSet = new Set(tickers.map(t => t.toUpperCase()));

    for (const pos of snap.positions) {
      const sym = (pos.ticker ?? pos.symbol ?? "").toUpperCase().trim();
      if (!sym || !tickerSet.has(sym)) continue;
      const val = [pos.value, pos.market_value, pos.marketValue, pos.position_value]
        .map(Number).find(n => Number.isFinite(n) && n > 0) ?? 0;
      const qty = [pos.qty, pos.position, pos.shares, pos.size]
        .map(Number).find(n => Number.isFinite(n) && Math.abs(n) > 1e-9);
      const currency = (pos.currency ?? pos.ccy ?? "USD").toUpperCase();
      const price = qty && qty > 0 && val > 0 ? val / qty : null;
      result[sym] = price && price > 0 ? { price, currency, qty: qty ?? undefined, value: val, source: "ibkr" } : null;
    }
    // tickers not found in IB → null
    tickers.forEach(t => { if (!(t in result)) result[t] = null; });
    return result;
  } catch {
    return null;
  }
}

// ── Yahoo Finance fallback ────────────────────────────────────────────────────

// Some tickers need a YF alias (e.g. BATS is the exchange; BTI is the stock)
const YF_ALIAS: Record<string, string> = {
  SQ: "XYZ",       // Block Inc. rebranded ticker from SQ → XYZ
  BATS: "BTI",
  SFTBY: "9984.T",
  MRAAY: "6981.T",
  IFNNY: "IFX.DE",
  JXHLY: "7832.T",
  MSBHF: "8316.T",
  MARUY: "8002.T",
  NMR: "NMR",
};

async function fetchYahooPrice(ticker: string): Promise<{ price: number; currency: string } | null> {
  const yfTicker = YF_ALIAS[ticker] ?? ticker;
  // Try query1 first, fallback to query2 if blocked
  const hosts = ["query1.finance.yahoo.com", "query2.finance.yahoo.com"];
  for (const host of hosts) {
    try {
      const url = `https://${host}/v8/finance/chart/${encodeURIComponent(yfTicker)}?interval=1d&range=5d&includePrePost=false`;
      const res = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36", "Accept": "application/json" },
        signal: AbortSignal.timeout(12_000),
      });
      if (!res.ok) continue;
      const data = await res.json() as any;
      const result = data?.chart?.result?.[0];
      if (!result) continue;
      // Prefer regularMarketPrice from meta (most current), fallback to last close
      const metaPrice: number | undefined = result.meta?.regularMarketPrice;
      const closes: number[] = result.indicators?.quote?.[0]?.close ?? [];
      const valid = closes.filter((c: number) => c != null && !isNaN(c));
      const price = (metaPrice && metaPrice > 0) ? metaPrice : valid[valid.length - 1];
      const currency: string = result.meta?.currency ?? "USD";
      if (!price) continue;
      return { price, currency };
    } catch {
      continue;
    }
  }
  return null;
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function fetchYahooPrices(tickers: string[]): Promise<PriceResult> {
  const out: PriceResult = {};
  // Batch requests to avoid Yahoo Finance rate-limiting (groups of 5, 200ms apart)
  const BATCH = 5;
  for (let i = 0; i < tickers.length; i += BATCH) {
    const batch = tickers.slice(i, i + BATCH);
    const results = await Promise.all(batch.map(t => fetchYahooPrice(t)));
    batch.forEach((t, j) => { out[t] = results[j] ? { ...results[j]!, source: "yf" } : null; });
    if (i + BATCH < tickers.length) await sleep(200);
  }
  return out;
}

// ── Handler ──────────────────────────────────────────────────────────────────

export default async function handler(req: NextApiRequest, res: NextApiResponse<PriceResult | { error: string }>) {
  if (req.method !== "GET") return res.status(405).json({ error: "method_not_allowed" });
  const raw = String(req.query.tickers ?? "").trim();
  if (!raw) return res.status(400).json({ error: "tickers_required" });

  const tickers = raw.split(",").map(t => t.trim().toUpperCase()).filter(Boolean).slice(0, 40);

  // 1. Try IB snapshot (only covers tickers held in IB portfolio)
  const ibkr = await fetchIbkrPrices(tickers);

  // Tickers that IB did NOT price → fetch from Yahoo Finance
  const missingFromIb = tickers.filter(t => !ibkr || ibkr[t] === null);

  if (missingFromIb.length === 0 && ibkr) {
    // All covered by IB
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Price-Source", "ibkr");
    return res.status(200).json(ibkr);
  }

  // 2. Yahoo Finance for any missing tickers
  const yf = await fetchYahooPrices(missingFromIb);

  const merged: PriceResult = {};
  tickers.forEach(t => {
    merged[t] = (ibkr && ibkr[t] !== null ? ibkr[t] : yf[t]) ?? null;
  });

  const hasIbkr = ibkr && Object.values(ibkr).some(p => p !== null);
  res.setHeader("Cache-Control", hasIbkr ? "no-store" : "public, max-age=300, s-maxage=300");
  res.setHeader("X-Price-Source", hasIbkr ? "ibkr+yahoo" : "yahoo");
  return res.status(200).json(merged);
}
