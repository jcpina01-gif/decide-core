import type { NextApiRequest, NextApiResponse } from "next";
import { getBackendBase } from "../../lib/apiProxy";

const UPSTREAM_MS = 120_000;

/**
 * Proxy para POST /api/paper-demo-orders (FastAPI) — demo EUR.USD + UCITS EUR (CSH2/XEON).
 * Requer no backend: DECIDE_PAPER_DEMO_ORDERS=1 e IB Gateway/TWS paper.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === "GET") {
    return res.status(200).json({
      ok: true,
      proxy: "paper-demo-orders",
      backendBase: getBackendBase(),
    });
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ detail: "Method not allowed" });
  }

  const base = getBackendBase();
  const targetUrl = `${base.replace(/\/+$/, "")}/api/paper-demo-orders`;

  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), UPSTREAM_MS);

  try {
    const payload =
      typeof req.body === "object" && req.body !== null
        ? JSON.stringify(req.body)
        : "{}";

    const upstream = await fetch(targetUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payload,
      signal: ac.signal,
    });

    const buf = Buffer.from(await upstream.arrayBuffer());
    res.status(upstream.status);
    const ct = upstream.headers.get("content-type");
    if (ct) res.setHeader("content-type", ct);
    res.send(buf);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    const isAbort = e instanceof Error && e.name === "AbortError";
    res.status(503).json({
      status: "rejected",
      error: isAbort
        ? `Timeout (${UPSTREAM_MS / 1000}s) ao contactar o backend em ${targetUrl}.`
        : `Ligação ao backend falhou (${msg}).`,
    });
  } finally {
    clearTimeout(t);
  }
}
