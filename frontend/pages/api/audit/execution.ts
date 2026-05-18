/**
 * POST /api/audit/execution
 * Records a broker execution confirmation (fill).
 */
import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "../../../lib/server/db";
import { createHash } from "crypto";

function makeId(orderId: string) {
  return createHash("sha256")
    .update(`${orderId}:${Date.now()}:${Math.random()}`)
    .digest("hex")
    .slice(0, 24);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const {
    order_id,
    client_id,
    ticker,
    side,
    qty_filled,
    price_executed,
    commission,
    ibkr_exec_id,
    executed_at,
    fill_status,
  } = req.body as Record<string, unknown>;

  if (!client_id || typeof client_id !== "string") {
    return res.status(400).json({ ok: false, error: "missing client_id" });
  }
  // Resolve "unknown" to the default client (same as order.ts)
  const resolvedClientId = client_id === "unknown"
    ? (process.env.AUDIT_DEFAULT_CLIENT_ID ?? client_id)
    : client_id;
  if (!ticker || typeof ticker !== "string") {
    return res.status(400).json({ ok: false, error: "missing ticker" });
  }

  const id = makeId((order_id as string) ?? "none");

  const resolvedFillStatus =
    (fill_status as string | null) ?? ((qty_filled && Number(qty_filled) > 0) ? "filled" : "presubmitted");

  try {
    const sql = getDb();
    // Ensure fill_status column exists (idempotent ALTER)
    await sql(`ALTER TABLE execution_logs ADD COLUMN IF NOT EXISTS fill_status TEXT DEFAULT 'filled'`);
    await sql(
      `INSERT INTO execution_logs
         (id, order_id, client_id, ticker, side, qty_filled, price_executed,
          commission, ibkr_exec_id, executed_at, fill_status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        id,
        order_id ?? null,
        resolvedClientId,
        (ticker as string).toUpperCase(),
        side ?? null,
        qty_filled ?? null,
        price_executed ?? null,
        commission ?? null,
        ibkr_exec_id ?? null,
        executed_at ?? null,
        resolvedFillStatus,
      ],
    );
    return res.status(201).json({ ok: true, id });
  } catch (e) {
    console.error("audit/execution error:", e);
    return res.status(500).json({ ok: false, error: String(e) });
  }
}
