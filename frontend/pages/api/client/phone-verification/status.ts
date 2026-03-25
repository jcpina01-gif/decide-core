import type { NextApiRequest, NextApiResponse } from "next";
import { normalizeClientPhoneE164 } from "../../../../lib/server/normalizeClientPhone";
import { isSignupPhoneVerifiedOnServer } from "../../../../lib/server/signupPhoneVerifiedStore";

type Out = { ok: boolean; verified?: boolean; error?: string };

export default function handler(req: NextApiRequest, res: NextApiResponse<Out>) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  const raw = typeof req.query.phone === "string" ? req.query.phone : "";
  const norm = normalizeClientPhoneE164(raw);
  if (!norm.ok) {
    return res.status(400).json({ ok: false, error: norm.error });
  }

  const verified = isSignupPhoneVerifiedOnServer(norm.e164);
  return res.status(200).json({ ok: true, verified });
}
