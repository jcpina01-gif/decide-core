/**
 * GET /api/backoffice/client-costs
 * Aggregates real transaction costs per client from execution_logs.
 * Returns: commission sums by client, order counts, YTD breakdown.
 */
import type { NextApiRequest, NextApiResponse } from "next";
import { denyIfBackofficeDisabled } from "../../../lib/server/backofficeApiGuard";
import { getDb } from "../../../lib/server/db";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (denyIfBackofficeDisabled(res, req)) return;
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    const sql = getDb();
    const thisYear = new Date().getFullYear();
    const ytdStart = `${thisYear}-01-01`;

    // Commission totals per client (all time + YTD)
    const commissionRows = await sql(`
      SELECT
        client_id,
        COALESCE(SUM(commission), 0)::float                                          AS commission_total,
        COALESCE(SUM(CASE WHEN executed_at >= $1 THEN commission ELSE 0 END), 0)::float AS commission_ytd,
        COUNT(*)::int                                                                AS execution_count,
        COUNT(CASE WHEN executed_at >= $1 THEN 1 END)::int                          AS execution_count_ytd,
        MIN(executed_at)                                                             AS first_execution,
        MAX(executed_at)                                                             AS last_execution
      FROM execution_logs
      GROUP BY client_id
      ORDER BY commission_total DESC
    `, [ytdStart]);

    // Order counts per client (for clients without execution data yet)
    const orderRows = await sql(`
      SELECT
        client_id,
        COUNT(*)::int                                                                 AS order_count,
        COUNT(CASE WHEN created_at >= $1 THEN 1 END)::int                           AS order_count_ytd,
        MIN(submitted_at)                                                             AS first_order,
        MAX(submitted_at)                                                             AS last_order
      FROM order_logs
      GROUP BY client_id
      ORDER BY order_count DESC
    `, [ytdStart]);

    return res.status(200).json({
      ok: true,
      year: thisYear,
      ytd_start: ytdStart,
      commissions: commissionRows,
      orders: orderRows,
    });
  } catch (e) {
    console.error("client-costs error:", e);
    return res.status(500).json({ ok: false, error: String(e) });
  }
}
