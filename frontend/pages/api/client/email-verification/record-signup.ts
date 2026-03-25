import type { NextApiRequest, NextApiResponse } from "next";
import { parseEmailVerificationToken } from "../../../../lib/server/emailVerificationToken";
import { recordSignupEmailVerified } from "../../../../lib/server/signupEmailVerifiedStore";

type Body = { token?: string };

/**
 * Chamado pela página /client/verify-email após validar o token (pré-registo).
 * Grava no servidor para a página de registo no PC detetar via /status.
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
  if (!parsed) {
    return res.status(400).json({ ok: false, error: "invalid_or_expired_token" });
  }

  if (parsed.username != null && parsed.username !== "") {
    return res.status(400).json({ ok: false, error: "not_signup_token" });
  }
  if (parsed.flow !== "signup") {
    return res.status(400).json({ ok: false, error: "not_signup_token" });
  }

  recordSignupEmailVerified(parsed.email);
  return res.status(200).json({ ok: true, email: parsed.email });
}
