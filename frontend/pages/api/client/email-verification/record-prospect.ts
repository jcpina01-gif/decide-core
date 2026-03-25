import type { NextApiRequest, NextApiResponse } from "next";
import { parseEmailVerificationToken } from "../../../../lib/server/emailVerificationToken";
import { recordProspectLeadVerified } from "../../../../lib/server/prospectLeadsStore";

type Body = { token?: string };

/**
 * Após validar token `flow: prospect` em /client/verify-email — grava em prospect_leads.json.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  if (process.env.ALLOW_CLIENT_NOTIFY_API !== "1") {
    return res.status(503).json({ ok: false, error: "api_disabled" });
  }

  let body: Body = {};
  try {
    body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body as Body) || {};
  } catch {
    return res.status(400).json({ ok: false, error: "invalid_json" });
  }

  const token = String(body.token || "").trim();
  if (!token) return res.status(400).json({ ok: false, error: "token_required" });

  const parsed = parseEmailVerificationToken(token);
  if (!parsed || parsed.flow !== "prospect") {
    return res.status(400).json({ ok: false, error: "not_prospect_token" });
  }

  const src = parsed.prospectSource || "email_link";
  recordProspectLeadVerified(parsed.email, { source: src });
  return res.status(200).json({ ok: true, email: parsed.email });
}
