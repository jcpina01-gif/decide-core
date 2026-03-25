import type { NextApiRequest, NextApiResponse } from "next";

/**
 * Proxy para o microserviço Persona (evita "Failed to fetch" por CORS/origem
 * e permite o Next falar com 127.0.0.1:8101 mesmo quando o browser está em localhost:4701).
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const base = (
    process.env.PERSONA_API_URL ||
    process.env.NEXT_PUBLIC_PERSONA_API_URL ||
    "http://127.0.0.1:8101"
  )
    .toString()
    .replace(/\/$/, "");

  try {
    const upstream = await fetch(`${base}/api/persona/record`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req.body),
    });
    const json = await upstream.json().catch(() => ({ ok: false, error: "Invalid JSON from upstream" }));
    return res.status(upstream.status).json(json);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Upstream unreachable";
    return res.status(502).json({
      ok: false,
      error: msg,
      hint:
        `Liga o microserviço Persona em ${base} (ex.: uvicorn em micro_persona_api) ou define PERSONA_API_URL no .env.local do frontend.`,
    });
  }
}
