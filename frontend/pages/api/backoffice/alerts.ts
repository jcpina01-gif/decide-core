import type { NextApiRequest, NextApiResponse } from "next";
import { denyIfBackofficeDisabled } from "../../../lib/server/backofficeApiGuard";
import { buildAlerts, projectRoot } from "../../../lib/server/backofficeData";

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (denyIfBackofficeDisabled(res)) return;
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }
  const alerts = buildAlerts(projectRoot());
  return res.status(200).json({ ok: true, alerts });
}
