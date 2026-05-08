import type { NextApiRequest, NextApiResponse } from "next";
import { getBackendBase } from "../../lib/apiProxy";

/** Proxy para POST /api/ibkr-orders no FastAPI (envia ordens para a IB). */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ detail: "Method not allowed" });
  }

  const base = getBackendBase();
  const targetUrl = `${base.replace(/\/+$/, "")}/api/ibkr-orders`;

  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 270_000); // 270s < maxDuration(300s) > backend(280s)

  try {
    const upstream = await fetch(targetUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: typeof req.body === "string" ? req.body : JSON.stringify(req.body),
      signal: ac.signal,
    });

    const buf = Buffer.from(await upstream.arrayBuffer());
    res.status(upstream.status);
    const ct = upstream.headers.get("content-type");
    if (ct) res.setHeader("content-type", ct);
    res.setHeader("X-Decide-Proxy-Backend", base);
    res.send(buf);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    const isAbort = e instanceof Error && e.name === "AbortError";
    res.status(503).json({
      status: "rejected",
      error: isAbort
        ? `Timeout ao contactar backend em ${targetUrl}.`
        : `Ligação falhou (${msg}). Confirme que o FastAPI e a IB Gateway estão activos.`,
    });
  } finally {
    clearTimeout(t);
  }
}
