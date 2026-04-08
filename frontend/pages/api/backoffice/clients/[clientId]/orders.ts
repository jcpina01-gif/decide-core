import type { NextApiRequest, NextApiResponse } from "next";
import { denyIfBackofficeDisabled } from "../../../../../lib/server/backofficeApiGuard";
import { buildOrders, projectRoot } from "../../../../../lib/server/backofficeData";

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (denyIfBackofficeDisabled(res)) return;
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }
  const clientId = typeof req.query.clientId === "string" ? req.query.clientId : "";
  if (!clientId) return res.status(400).json({ ok: false, error: "missing_client_id" });
  const orders = buildOrders(projectRoot(), clientId);
  return res.status(200).json({ ok: true, orders });
}
