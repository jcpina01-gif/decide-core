/**
 * POST /api/audit/config-change
 * Records any change to client config or model parameters.
 * Call this whenever risk_profile, universe, hedge overlay, or other policy changes.
 */
import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "../../../lib/server/db";
import { createHash } from "crypto";

function makeId(clientId: string, changeType: string) {
  return createHash("sha256")
    .update(`${clientId}:${changeType}:${Date.now()}:${Math.random()}`)
    .digest("hex")
    .slice(0, 24);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const {
    client_id,
    changed_by,
    change_type,
    old_value,
    new_value,
    changed_at,
  } = req.body as Record<string, unknown>;

  if (!change_type || typeof change_type !== "string") {
    return res.status(400).json({ ok: false, error: "missing change_type" });
  }
  const changer = (changed_by as string) ?? "system";
  if (!["client", "backoffice", "system"].includes(changer)) {
    return res.status(400).json({ ok: false, error: "changed_by must be client | backoffice | system" });
  }

  const id = makeId((client_id as string) ?? "system", change_type as string);

  try {
    const sql = getDb();
    await sql(
      `INSERT INTO config_change_logs
         (id, client_id, changed_by, change_type, old_value, new_value, changed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        id,
        client_id ?? null,
        changer,
        change_type,
        old_value ? JSON.stringify(old_value) : null,
        new_value ? JSON.stringify(new_value) : null,
        (changed_at as string) ?? new Date().toISOString(),
      ],
    );
    return res.status(201).json({ ok: true, id });
  } catch (e) {
    console.error("audit/config-change error:", e);
    return res.status(500).json({ ok: false, error: String(e) });
  }
}
