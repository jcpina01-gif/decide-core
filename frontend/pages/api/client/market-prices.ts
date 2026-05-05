/**
 * Devolve preços actuais por ticker usando o snapshot IBKR como fonte primária.
 * Sem fallback para Yahoo Finance — se IB não estiver ligado, os preços ficam null.
 * Preço unitário = market_value / quantity (derivado do snapshot).
 */
import type { NextApiRequest, NextApiResponse } from "next";
import { getBackendBase } from "../../../lib/apiProxy";

export type PriceEntry = { price: number; currency: string; qty?: number; value?: number } | null;
export type PriceResult = Record<string, PriceEntry>;

async function fetchIbkrPrices(tickers: string[]): Promise<PriceResult | null> {
  const base = getBackendBase();
  const url = `${base.replace(/\/+$/, "")}/api/ibkr-snapshot`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paper_mode: true }),
      signal: AbortSignal.timeout(15_000),
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
    if (!snap || !Array.isArray(snap.positions)) return null;

    const result: PriceResult = {};
    const tickerSet = new Set(tickers.map(t => t.toUpperCase()));

    for (const pos of snap.positions) {
      const sym = (pos.ticker ?? pos.symbol ?? "").toUpperCase().trim();
      if (!sym || !tickerSet.has(sym)) continue;

      // market value
      const val = [pos.value, pos.market_value, pos.marketValue, pos.position_value]
        .map(Number).find(n => Number.isFinite(n) && n > 0) ?? 0;

      // quantity
      const qty = [pos.qty, pos.position, pos.shares, pos.size]
        .map(Number).find(n => Number.isFinite(n) && Math.abs(n) > 1e-9);

      const currency = (pos.currency ?? pos.ccy ?? "USD").toUpperCase();
      const price = qty && qty > 0 && val > 0 ? val / qty : null;

      if (price && price > 0) {
        result[sym] = { price, currency, qty: qty ?? undefined, value: val };
      } else {
        result[sym] = null;
      }
    }

    // tickers not found in IB → null
    tickers.forEach(t => { if (!(t in result)) result[t] = null; });
    return result;
  } catch {
    return null;
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse<PriceResult | { error: string }>) {
  if (req.method !== "GET") return res.status(405).json({ error: "method_not_allowed" });
  const raw = String(req.query.tickers ?? "").trim();
  if (!raw) return res.status(400).json({ error: "tickers_required" });

  const tickers = raw.split(",").map(t => t.trim().toUpperCase()).filter(Boolean).slice(0, 40);

  const ibkr = await fetchIbkrPrices(tickers);
  if (ibkr) {
    res.setHeader("Cache-Control", "no-store"); // IB prices are real-time
    res.setHeader("X-Price-Source", "ibkr");
    return res.status(200).json(ibkr);
  }

  // IB not available → return nulls for all tickers
  const empty: PriceResult = {};
  tickers.forEach(t => { empty[t] = null; });
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Price-Source", "unavailable");
  return res.status(200).json(empty);
}
