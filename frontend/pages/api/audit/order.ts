/**
 * POST /api/audit/order
 * Records an order submitted to the broker.
 * Called from the back-office or automated execution pipeline.
 */
import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "../../../lib/server/db";
import { createHash } from "crypto";

function makeId(clientId: string, ticker: string) {
  return createHash("sha256")
    .update(`${clientId}:${ticker}:${Date.now()}:${Math.random()}`)
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
    approval_id,
    client_id,
    ticker,
    side,
    qty,
    order_type,
    limit_price,
    status,
    ibkr_order_id,
    submitted_at,
  } = req.body as Record<string, unknown>;

  if (!client_id || typeof client_id !== "string") {
    return res.status(400).json({ ok: false, error: "missing client_id" });
  }
  if (!ticker || typeof ticker !== "string") {
    return res.status(400).json({ ok: false, error: "missing ticker" });
  }
  if (side !== "BUY" && side !== "SELL") {
    return res.status(400).json({ ok: false, error: "side must be BUY or SELL" });
  }

  const id = makeId(client_id as string, ticker as string);

  try {
    const sql = getDb();
    await sql(
      `INSERT INTO order_logs
         (id, recommendation_id, approval_id, client_id, ticker, side, qty,
          order_type, limit_price, status, ibkr_order_id, submitted_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        id,
        recommendation_id ?? null,
        approval_id ?? null,
        client_id,
        (ticker as string).toUpperCase(),
        side,
        qty ?? null,
        order_type ?? "MKT",
        limit_price ?? null,
        status ?? "submitted",
        ibkr_order_id ?? null,
        submitted_at ?? null,
      ],
    );
    return res.status(201).json({ ok: true, id });
  } catch (e) {
    console.error("audit/order error:", e);
    return res.status(500).json({ ok: false, error: String(e) });
  }
}
