/**
 * POST /api/audit/approval
 * Records explicit client consent for a specific recommendation snapshot.
 * Called from the client dashboard when the user approves/rejects.
 */
import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "../../../lib/server/db";
import { createHash } from "crypto";

function makeId(clientId: string, recId: string) {
  return createHash("sha256")
    .update(`${clientId}:${recId}:${Date.now()}:${Math.random()}`)
    .digest("hex")
    .slice(0, 24);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const {
    recommendation_id,
    client_id,
    action,
    payload_hash,
  } = req.body as Record<string, unknown>;

  if (!client_id || typeof client_id !== "string") {
    return res.status(400).json({ ok: false, error: "missing client_id" });
  }
  if (action !== "approved" && action !== "rejected") {
    return res.status(400).json({ ok: false, error: "action must be 'approved' or 'rejected'" });
  }

  const id = makeId(client_id as string, (recommendation_id as string) ?? "none");
  const ip =
    (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ??
    req.socket?.remoteAddress ??
    null;
  const ua = (req.headers["user-agent"] as string) ?? null;

  try {
    const sql = getDb();
    await sql(
      `INSERT INTO client_approvals
         (id, recommendation_id, client_id, action, payload_hash, ip_address, user_agent, approved_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())`,
      [
        id,
        recommendation_id ?? null,
        client_id,
        action,
        payload_hash ?? null,
        ip,
        ua,
      ],
    );
    return res.status(201).json({ ok: true, id });
  } catch (e) {
    console.error("audit/approval error:", e);
    return res.status(500).json({ ok: false, error: String(e) });
  }
}
