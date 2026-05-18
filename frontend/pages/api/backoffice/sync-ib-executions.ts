/**
 * POST /api/backoffice/sync-ib-executions?clientId=xxx
 * Fetches IB execution history from the backend and saves to execution_logs.
 * Used to backfill audit data for orders executed before instrumentation was deployed.
 */
import type { NextApiRequest, NextApiResponse } from "next";
import { denyIfBackofficeDisabled } from "../../../lib/server/backofficeApiGuard";
import { getDb } from "../../../lib/server/db";
import { createHash } from "crypto";

const BACKEND_URL = process.env.DECIDE_BACKEND_URL ?? "http://localhost:8000";

function makeId(execId: string) {
  return createHash("sha256")
    .update(`${execId}:${Math.random()}`)
    .digest("hex")
    .slice(0, 24);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (denyIfBackofficeDisabled(res, req)) return;
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const clientId = typeof req.query.clientId === "string" ? req.query.clientId : null;
  if (!clientId) return res.status(400).json({ ok: false, error: "missing clientId" });

  // 1. Fetch from IB backend
  let ibFills: Array<{
    ticker: string;
    side: string;
    qty_filled: number | null;
    price_executed: number | null;
    value_eur: number | null;
    commission: number | null;
    ibkr_exec_id: string | null;
    executed_at: string | null;
  }> = [];

  try {
    const backendRes = await fetch(`${BACKEND_URL}/api/ibkr-executions`, {
      signal: AbortSignal.timeout(35_000),
    });
    const backendData = await backendRes.json() as { ok: boolean; fills?: typeof ibFills; error?: string };
    if (!backendData.ok) {
      return res.status(502).json({ ok: false, error: backendData.error ?? "Backend returned error" });
    }
    ibFills = backendData.fills ?? [];
  } catch (e) {
    return res.status(502).json({ ok: false, error: `Cannot reach IB backend: ${String(e)}` });
  }

  if (ibFills.length === 0) {
    return res.status(200).json({ ok: true, saved: 0, skipped: 0, message: "Sem execuções na IB (sessão actual)." });
  }

  // 2. Save each fill into execution_logs (skip duplicates via ibkr_exec_id)
  const sql = getDb();
  let saved = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const fill of ibFills) {
    try {
      // Check for duplicate by ibkr_exec_id
      if (fill.ibkr_exec_id) {
        const existing = await sql(
          `SELECT id FROM execution_logs WHERE ibkr_exec_id = $1 LIMIT 1`,
          [fill.ibkr_exec_id],
        );
        if (existing.length > 0) { skipped++; continue; }
      }

      const side = fill.side?.toUpperCase() === "SELL" ? "SELL" : "BUY";
      const id = makeId(fill.ibkr_exec_id ?? `${fill.ticker}:${fill.executed_at ?? Date.now()}`);

      await sql(
        `INSERT INTO execution_logs
           (id, client_id, ticker, side, qty_filled, price_executed, commission, ibkr_exec_id, executed_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (id) DO NOTHING`,
        [
          id, clientId, (fill.ticker ?? "").toUpperCase(), side,
          fill.qty_filled ?? null, fill.price_executed ?? null,
          fill.commission ?? null, fill.ibkr_exec_id ?? null,
          fill.executed_at ? new Date(fill.executed_at).toISOString() : null,
        ],
      );
      saved++;
    } catch (e) {
      errors.push(String(e));
    }
  }

  return res.status(200).json({
    ok: true,
    total: ibFills.length,
    saved,
    skipped,
    errors: errors.length > 0 ? errors.slice(0, 5) : undefined,
  });
}
