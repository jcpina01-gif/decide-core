import type { NextApiRequest, NextApiResponse } from "next";
import { getBackendBase } from "../../lib/apiProxy";

/** Ordens podem demorar (vários contratos + IB Gateway/TWS). */
const UPSTREAM_MS = 120_000;

/**
 * Proxy explícito para POST /api/send-orders no FastAPI.
 * Evita o catch-all /api/proxy/[...path] em POST (path por vezes vazio → upstream errado).
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === "GET") {
    return res.status(200).json({
      ok: true,
      proxy: "send-orders",
      backendBase: getBackendBase(),
    });
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ detail: "Method not allowed" });
  }

  const base = getBackendBase();
  const targetUrl = `${base.replace(/\/+$/, "")}/api/send-orders`;

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
        ? `Timeout (${UPSTREAM_MS / 1000}s) ao contactar o backend em ${targetUrl}. IB Gateway ou TWS pode estar ocupado com muitas ordens.`
        : `Ligação ao backend falhou (${msg}). Confirme BACKEND_URL no .env.local e que o uvicorn está a correr (ex.: python -m uvicorn main:app --host 127.0.0.1 --port 8090).`,
    });
  } finally {
    clearTimeout(t);
  }
}
