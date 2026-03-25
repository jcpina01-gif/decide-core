import type { NextApiRequest, NextApiResponse } from "next";

/** Proxy GET status → microserviço Persona (mesma base que /api/persona/record). */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const referenceId = typeof req.query.reference_id === "string" ? req.query.reference_id.trim() : "";
  if (!referenceId) {
    return res.status(400).json({ ok: false, error: "Missing reference_id" });
  }

  const base = (
    process.env.PERSONA_API_URL ||
    process.env.NEXT_PUBLIC_PERSONA_API_URL ||
    "http://127.0.0.1:8101"
  )
    .toString()
    .replace(/\/$/, "");

  try {
    const url = `${base}/api/persona/status?reference_id=${encodeURIComponent(referenceId)}`;
    const upstream = await fetch(url);
    const json = await upstream.json().catch(() => ({ ok: false, error: "Invalid JSON from upstream" }));
    return res.status(upstream.status).json(json);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Upstream unreachable";
    return res.status(502).json({ ok: false, error: msg, record: null });
  }
}
