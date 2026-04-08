import type { NextApiRequest, NextApiResponse } from "next";
import { getBackendBase } from "../../lib/apiProxy";

/** Snapshot pode incluir reqContractDetails por posição (nome, sector, zona) — precisa de margem. */
const UPSTREAM_MS = 120_000;

/**
 * Proxy explícito para POST /api/ibkr-snapshot no FastAPI.
 * Evita depender do catch-all /api/proxy/[...path] (alguns POSTs não preenchem bem req.query.path → 404 no upstream).
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === "GET") {
    return res.status(200).json({
      ok: true,
      proxy: "ibkr-snapshot",
      backendBase: getBackendBase(),
    });
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ detail: "Method not allowed" });
  }

  const base = getBackendBase();
  const targetUrl = `${base.replace(/\/+$/, "")}/api/ibkr-snapshot`;

  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), UPSTREAM_MS);

  try {
    const payload =
      typeof req.body === "object" && req.body !== null
        ? JSON.stringify(req.body)
        : JSON.stringify({ paper_mode: true });

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
        ? `Timeout (${UPSTREAM_MS / 1000}s) ao contactar o backend em ${targetUrl}. Confirme uvicorn e IB Gateway ou TWS.`
        : `Ligação ao backend falhou (${msg}). Confirme BACKEND_URL e que o FastAPI está a correr (ex.: porta 8090).`,
    });
  } finally {
    clearTimeout(t);
  }
}
