/**
 * POST /api/audit/funding
 * Records a deposit, withdrawal, or internal transfer event.
 */
import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "../../../lib/server/db";
import { createHash } from "crypto";

function makeId(clientId: string) {
  return createHash("sha256")
    .update(`${clientId}:${Date.now()}:${Math.random()}`)
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
    amount,
    currency,
    type,
    source,
    ibkr_ref,
    occurred_at,
  } = req.body as Record<string, unknown>;

  if (!client_id || typeof client_id !== "string") {
    return res.status(400).json({ ok: false, error: "missing client_id" });
  }
  if (type !== "deposit" && type !== "withdrawal" && type !== "internal_transfer") {
    return res.status(400).json({ ok: false, error: "type must be deposit | withdrawal | internal_transfer" });
  }
  if (amount === undefined || amount === null) {
    return res.status(400).json({ ok: false, error: "missing amount" });
  }

  const id = makeId(client_id as string);

  try {
    const sql = getDb();
    await sql(
      `INSERT INTO funding_logs
         (id, client_id, amount, currency, type, source, ibkr_ref, occurred_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        id,
        client_id,
        amount,
        (currency as string) ?? "EUR",
        type,
        source ?? null,
        ibkr_ref ?? null,
        (occurred_at as string) ?? new Date().toISOString(),
      ],
    );
    return res.status(201).json({ ok: true, id });
  } catch (e) {
    console.error("audit/funding error:", e);
    return res.status(500).json({ ok: false, error: String(e) });
  }
}
