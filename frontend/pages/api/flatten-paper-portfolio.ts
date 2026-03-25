import type { NextApiRequest, NextApiResponse } from "next";
import { getBackendBase } from "../../lib/apiProxy";

const UPSTREAM_MS = 120_000;

/**
 * Proxy para POST /api/flatten-paper-portfolio (fecha posições STK na conta paper).
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === "GET") {
    return res.status(200).json({
      ok: true,
      proxy: "flatten-paper-portfolio",
      backendBase: getBackendBase(),
    });
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ detail: "Method not allowed" });
  }

  const base = getBackendBase();
  const targetUrl = `${base.replace(/\/+$/, "")}/api/flatten-paper-portfolio`;

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

    if (upstream.status === 404) {
      return res.status(200).json({
        status: "rejected",
        error:
          `Backend devolveu 404 em ${targetUrl}. Confirme: (1) na pasta backend: ` +
          `\`python -m uvicorn main:app --host 127.0.0.1 --port 8090 --reload\`, ` +
          `(2) no browser abra GET ${base}/api/flatten-paper-portfolio — deve devolver JSON com "ok":true; ` +
          `(3) BACKEND_URL no .env.local só com host (sem /api no fim); reinicie o Next.`,
        closes: [],
      });
    }

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
      closes: [],
    });
  } finally {
    clearTimeout(t);
  }
}
