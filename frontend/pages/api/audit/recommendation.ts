/**
 * POST /api/audit/recommendation
 * Saves an immutable recommendation snapshot.
 * Called server-side when a recommendation is generated/presented to the client.
 */
import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "../../../lib/server/db";
import { createHash } from "crypto";

function makeId(clientId: string, ts: string) {
  return createHash("sha256")
    .update(`${clientId}:${ts}:${Math.random()}`)
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
    generated_at,
    risk_profile,
    model_version,
    model_hash,
    positions,
    kpis,
    raw_payload,
  } = req.body as Record<string, unknown>;

  if (!client_id || typeof client_id !== "string") {
    return res.status(400).json({ ok: false, error: "missing client_id" });
  }

  const ts = (generated_at as string) || new Date().toISOString();
  const id = makeId(client_id, ts);

  try {
    const sql = getDb();
    await sql(
      `INSERT INTO recommendation_snapshots
         (id, client_id, generated_at, risk_profile, model_version, model_hash, positions, kpis, raw_payload)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (id) DO NOTHING`,
      [
        id,
        client_id,
        ts,
        risk_profile ?? null,
        model_version ?? null,
        model_hash ?? null,
        JSON.stringify(positions ?? []),
        kpis ? JSON.stringify(kpis) : null,
        raw_payload ? JSON.stringify(raw_payload) : null,
      ],
    );
    return res.status(201).json({ ok: true, id });
  } catch (e) {
    console.error("audit/recommendation error:", e);
    return res.status(500).json({ ok: false, error: String(e) });
  }
}
