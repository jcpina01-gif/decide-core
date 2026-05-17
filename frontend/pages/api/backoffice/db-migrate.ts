import type { NextApiRequest, NextApiResponse } from "next";
import { denyIfBackofficeDisabled } from "../../../lib/server/backofficeApiGuard";
import { migrateDb } from "../../../lib/server/db";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (denyIfBackofficeDisabled(res, req)) return;
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }
  try {
    await migrateDb();
    return res.status(200).json({ ok: true, message: "Migration complete" });
  } catch (e) {
    console.error("Migration error:", e);
    return res.status(500).json({ ok: false, error: String(e) });
  }
}
