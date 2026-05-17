/**
 * GET /api/backoffice/audit-db?clientId=xxx&table=recommendations|approvals|orders|executions|funding|config
 * Returns paginated audit records from Neon for the back-office audit page.
 */
import type { NextApiRequest, NextApiResponse } from "next";
import { denyIfBackofficeDisabled } from "../../../lib/server/backofficeApiGuard";
import { getDb } from "../../../lib/server/db";

const ALLOWED_TABLES = ["recommendations", "approvals", "orders", "executions", "funding", "config"] as const;
type TableKey = (typeof ALLOWED_TABLES)[number];

// Known aliases: back-office client_id ↔ IBKR account codes
// When searching, include both so records saved under either ID are returned.
const DEFAULT_CLIENT = process.env.AUDIT_DEFAULT_CLIENT_ID ?? "jcpina01";
const CLIENT_ALIASES: Record<string, string[]> = {
  jcpina01: ["jcpina01", "DUM504002", "unknown"],
  DUM504002: ["DUM504002", "jcpina01", "unknown"],
  unknown: [DEFAULT_CLIENT, "DUM504002", "unknown"],
};
function cids(cid: string): string[] {
  return CLIENT_ALIASES[cid] ?? [cid];
}

const TABLE_SQL: Record<TableKey, (clientId: string, limit: number, offset: number) => [string, unknown[]]> = {
  recommendations: (cid, lim, off) => [
    `SELECT id, client_id, generated_at, risk_profile, model_version, model_hash, positions, kpis, created_at
     FROM recommendation_snapshots WHERE client_id = ANY($1) ORDER BY generated_at DESC LIMIT $2 OFFSET $3`,
    [cids(cid), lim, off],
  ],
  approvals: (cid, lim, off) => [
    `SELECT ca.id, ca.recommendation_id, ca.client_id, ca.action, ca.payload_hash,
            ca.ip_address, ca.approved_at, ca.created_at
     FROM client_approvals ca WHERE ca.client_id = ANY($1) ORDER BY ca.approved_at DESC LIMIT $2 OFFSET $3`,
    [cids(cid), lim, off],
  ],
  orders: (cid, lim, off) => [
    `SELECT id, recommendation_id, approval_id, client_id, ticker, side, qty,
            order_type, limit_price, status, ibkr_order_id, submitted_at, updated_at, created_at
     FROM order_logs WHERE client_id = ANY($1) ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
    [cids(cid), lim, off],
  ],
  executions: (cid, lim, off) => [
    `SELECT id, order_id, client_id, ticker, side, qty_filled, price_executed,
            commission, ibkr_exec_id, executed_at, created_at
     FROM execution_logs WHERE client_id = ANY($1) ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
    [cids(cid), lim, off],
  ],
  funding: (cid, lim, off) => [
    `SELECT id, client_id, amount, currency, type, source, ibkr_ref, occurred_at, created_at
     FROM funding_logs WHERE client_id = ANY($1) ORDER BY occurred_at DESC LIMIT $2 OFFSET $3`,
    [cids(cid), lim, off],
  ],
  config: (cid, lim, off) => [
    `SELECT id, client_id, changed_by, change_type, old_value, new_value, changed_at, created_at
     FROM config_change_logs WHERE (client_id = ANY($1) OR client_id IS NULL) ORDER BY changed_at DESC LIMIT $2 OFFSET $3`,
    [cids(cid), lim, off],
  ],
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (denyIfBackofficeDisabled(res, req)) return;
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const clientId = typeof req.query.clientId === "string" ? req.query.clientId : "";
  const table = typeof req.query.table === "string" ? req.query.table : "recommendations";
  const limit = Math.min(parseInt(String(req.query.limit ?? "50")), 200);
  const offset = parseInt(String(req.query.offset ?? "0"));

  if (!clientId) return res.status(400).json({ ok: false, error: "missing clientId" });
  if (!ALLOWED_TABLES.includes(table as TableKey)) {
    return res.status(400).json({ ok: false, error: `table must be one of: ${ALLOWED_TABLES.join(", ")}` });
  }

  try {
    const sql = getDb();
    const [query, params] = TABLE_SQL[table as TableKey](clientId, limit, offset);
    const rows = await sql(query, params as string[]);
    return res.status(200).json({ ok: true, table, clientId, rows, limit, offset });
  } catch (e) {
    console.error("audit-db error:", e);
    return res.status(500).json({ ok: false, error: String(e) });
  }
}
