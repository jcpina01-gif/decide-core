import type { NextApiRequest, NextApiResponse } from "next";

type PriceResult = Record<string, { price: number; currency: string; name?: string } | null>;

async function fetchYahooPrice(ticker: string): Promise<{ price: number; currency: string } | null> {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=5d&includePrePost=false`;
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0", "Accept": "application/json" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const data = await res.json() as any;
    const result = data?.chart?.result?.[0];
    if (!result) return null;
    const closes: number[] = result.indicators?.quote?.[0]?.close ?? [];
    const validCloses = closes.filter((c: number) => c != null && !isNaN(c));
    const price = validCloses[validCloses.length - 1];
    const currency: string = result.meta?.currency ?? "USD";
    if (!price) return null;
    return { price, currency };
  } catch {
    return null;
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse<PriceResult | { error: string }>) {
  if (req.method !== "GET") return res.status(405).json({ error: "method_not_allowed" });
  const raw = String(req.query.tickers ?? "").trim();
  if (!raw) return res.status(400).json({ error: "tickers_required" });

  const tickers = raw.split(",").map(t => t.trim().toUpperCase()).filter(Boolean).slice(0, 30);

  // Fetch all in parallel
  const results = await Promise.all(tickers.map(t => fetchYahooPrice(t)));
  const out: PriceResult = {};
  tickers.forEach((t, i) => { out[t] = results[i]; });

  res.setHeader("Cache-Control", "public, max-age=300, s-maxage=300"); // 5-min cache
  return res.status(200).json(out);
}
