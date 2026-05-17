/**
 * POST /api/backoffice/audit-test
 * Inserts a test record into order_logs and reads it back.
 * Used to verify the full DB pipeline from the browser.
 */
import type { NextApiRequest, NextApiResponse } from "next";
import { denyIfBackofficeDisabled } from "../../../lib/server/backofficeApiGuard";
import { getDb } from "../../../lib/server/db";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (denyIfBackofficeDisabled(res, req)) return;
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const testId = `test-${Date.now()}`;
  const defaultClient = process.env.AUDIT_DEFAULT_CLIENT_ID ?? "jcpina01";

  try {
    const sql = getDb();

    // 1. Insert
    await sql(
      `INSERT INTO order_logs (id, client_id, ticker, side, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, NOW(), NOW())`,
      [testId, defaultClient, "TEST", "SELL", "submitted"],
    );

    // 2. Read back
    const rows = await sql(
      `SELECT id, client_id, ticker, status FROM order_logs WHERE id = $1`,
      [testId],
    );

    // 3. Cleanup
    await sql(`DELETE FROM order_logs WHERE id = $1`, [testId]);

    return res.status(200).json({
      ok: true,
      message: `DB write+read+delete OK for client_id="${defaultClient}"`,
      row: rows[0] ?? null,
      env: {
        DATABASE_URL_set: !!process.env.DATABASE_URL,
        AUDIT_DEFAULT_CLIENT_ID: defaultClient,
      },
    });
  } catch (e) {
    console.error("audit-test error:", e);
    return res.status(500).json({
      ok: false,
      error: String(e),
      env: {
        DATABASE_URL_set: !!process.env.DATABASE_URL,
        AUDIT_DEFAULT_CLIENT_ID: process.env.AUDIT_DEFAULT_CLIENT_ID ?? "(not set)",
      },
    });
  }
}
