import type { NextApiRequest, NextApiResponse } from "next";
import { parseEmailVerificationToken } from "../../../../lib/server/emailVerificationToken";
import { recordSignupEmailVerified } from "../../../../lib/server/signupEmailVerifiedStore";

type Body = { token?: string };

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
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

  /** Gravar já aqui — o cliente também chama `/record-signup`, mas esse POST falha por vezes (rede, tab fechada) e o catch era silencioso. */
  if (parsed.flow === "signup") {
    try {
      recordSignupEmailVerified(parsed.email);
    } catch {
      // não bloquear a resposta JSON; record-signup ou próximo poll podem recuperar
    }
  }

  return res.status(200).json({
    ok: true,
    username: parsed.username,
    email: parsed.email,
    flow: parsed.flow,
    signupOnly: parsed.flow === "signup",
    prospectOnly: parsed.flow === "prospect",
    prospectSource: parsed.prospectSource,
  });
}
