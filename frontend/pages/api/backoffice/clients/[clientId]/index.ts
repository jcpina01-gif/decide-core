import type { NextApiRequest, NextApiResponse } from "next";
import { denyIfBackofficeDisabled } from "../../../../../lib/server/backofficeApiGuard";
import { getClientDetail, projectRoot } from "../../../../../lib/server/backofficeData";

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (denyIfBackofficeDisabled(res)) return;
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }
  const clientId = typeof req.query.clientId === "string" ? req.query.clientId : "";
  if (!clientId) return res.status(400).json({ ok: false, error: "missing_client_id" });
  const c = getClientDetail(projectRoot(), clientId);
  if (!c) return res.status(404).json({ ok: false, error: "client_not_found" });
  return res.status(200).json({ ok: true, client: c });
}
