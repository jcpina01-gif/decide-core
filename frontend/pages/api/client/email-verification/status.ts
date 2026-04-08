import type { NextApiRequest, NextApiResponse } from "next";
import { isProspectVerifiedOnServer } from "../../../../lib/server/prospectLeadsStore";
import { isSignupEmailVerifiedOnServer } from "../../../../lib/server/signupEmailVerifiedStore";

/**
 * GET ?email= — `verified` = pré-registo (signup); `prospectVerified` = lista de interessados (dashboard).
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  /**
   * Leitura do estado de verificação — não exige ALLOW_CLIENT_NOTIFY_API (só HMAC no ficheiro local).
   * Assim o poll no registo funciona mesmo com env incompleto; envios de email/SMS continuam protegidos noutras rotas.
   */
  const email = String(req.query.email || "").trim().toLowerCase();
  if (!email.includes("@")) {
    return res.status(400).json({ ok: false, error: "email_required" });
  }

  const verified = isSignupEmailVerifiedOnServer(email);
  const prospectVerified = isProspectVerifiedOnServer(email);
  return res.status(200).json({ ok: true, verified, prospectVerified });
}
