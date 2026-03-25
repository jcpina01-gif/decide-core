import type { NextApiRequest, NextApiResponse } from "next";
import { isSignupEmailVerifiedOnServer } from "../../../../lib/server/signupEmailVerifiedStore";

/**
 * GET ?email= — indica se o email foi confirmado pelo link (gravado em record-signup).
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  if (process.env.ALLOW_CLIENT_NOTIFY_API !== "1") {
    return res.status(503).json({ ok: false, error: "api_disabled" });
  }

  const email = String(req.query.email || "").trim().toLowerCase();
  if (!email.includes("@")) {
    return res.status(400).json({ ok: false, error: "email_required" });
  }

  const verified = isSignupEmailVerifiedOnServer(email);
  return res.status(200).json({ ok: true, verified });
}
