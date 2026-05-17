/**
 * GET /api/backoffice/vapi-calls
 * Proxies VAPI /call list to the back-office, adding auth guard.
 * Query params forwarded to VAPI: limit, page, phoneNumber, assistantId, createdAtGt, createdAtLt
 */
import type { NextApiRequest, NextApiResponse } from "next";
import { denyIfBackofficeDisabled } from "../../../lib/server/backofficeApiGuard";

const VAPI_BASE = "https://api.vapi.ai";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (denyIfBackofficeDisabled(res, req)) return;
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const key = process.env.VAPI_PRIVATE_API_KEY?.trim();
  if (!key) {
    return res.status(503).json({ ok: false, error: "VAPI_PRIVATE_API_KEY not configured" });
  }

  // Forward safe query params to VAPI
  const allowed = ["limit", "page", "phoneNumber", "assistantId", "createdAtGt", "createdAtLt"];
  const qs = new URLSearchParams();
  for (const k of allowed) {
    const v = req.query[k];
    if (typeof v === "string" && v) qs.set(k, v);
  }
  if (!qs.has("limit")) qs.set("limit", "50");

  try {
    const url = `${VAPI_BASE}/call?${qs.toString()}`;
    const r = await fetch(url, {
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    });
    const body = await r.json() as unknown;
    if (!r.ok) {
      return res.status(r.status).json({ ok: false, error: `VAPI ${r.status}`, detail: body });
    }
    return res.status(200).json({ ok: true, calls: body });
  } catch (e) {
    console.error("vapi-calls error:", e);
    return res.status(500).json({ ok: false, error: String(e) });
  }
}
