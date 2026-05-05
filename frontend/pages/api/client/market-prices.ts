/**
 * Devolve preços actuais por ticker.
 * Fonte primária: snapshot IBKR via FastAPI (preço = market_value / qty).
 * Fallback: Yahoo Finance v8 chart API se o IB não estiver ligado.
 */
import type { NextApiRequest, NextApiResponse } from "next";
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
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yfTicker)}?interval=1d&range=5d&includePrePost=false`;
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0", "Accept": "application/json" },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return null;
    const data = await res.json() as any;
    const result = data?.chart?.result?.[0];
    if (!result) return null;
    const closes: number[] = result.indicators?.quote?.[0]?.close ?? [];
    const valid = closes.filter((c: number) => c != null && !isNaN(c));
    const price = valid[valid.length - 1];
    const currency: string = result.meta?.currency ?? "USD";
    if (!price) return null;
    return { price, currency };
  } catch {
    return null;
  }
}

async function fetchYahooPrices(tickers: string[]): Promise<PriceResult> {
  const results = await Promise.all(tickers.map(t => fetchYahooPrice(t)));
  const out: PriceResult = {};
  tickers.forEach((t, i) => {
    const r = results[i];
    out[t] = r ? { ...r, source: "yf" } : null;
  });
  return out;
}

// ── Handler ──────────────────────────────────────────────────────────────────

export default async function handler(req: NextApiRequest, res: NextApiResponse<PriceResult | { error: string }>) {
  if (req.method !== "GET") return res.status(405).json({ error: "method_not_allowed" });
  const raw = String(req.query.tickers ?? "").trim();
  if (!raw) return res.status(400).json({ error: "tickers_required" });

  const tickers = raw.split(",").map(t => t.trim().toUpperCase()).filter(Boolean).slice(0, 40);

  // 1. Try IB
  const ibkr = await fetchIbkrPrices(tickers);
  if (ibkr) {
    // Check if IB actually returned any prices (not all null)
    const hasAnyPrice = Object.values(ibkr).some(p => p !== null);
    if (hasAnyPrice) {
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("X-Price-Source", "ibkr");
      return res.status(200).json(ibkr);
    }
  }

  // 2. Fallback: Yahoo Finance
  const yf = await fetchYahooPrices(tickers);
  res.setHeader("Cache-Control", "public, max-age=300, s-maxage=300");
  res.setHeader("X-Price-Source", "yahoo");
  return res.status(200).json(yf);
}
