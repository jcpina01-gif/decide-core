import type { NextApiRequest, NextApiResponse } from "next";
import { hasOutboundEmailConfigured } from "../../../lib/server/outboundEmail";
import { isTwilioSmsConfigured } from "../../../lib/server/twilioSms";

/**
 * GET — indica que canais de envio estão configurados (sem revelar chaves).
 * Abre no browser: /api/client/channels-status
 */
export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  return res.status(200).json({
    ok: true,
    /** Envio de email (Gmail ou Resend) para confirmação / notificações */
    emailOutbound: hasOutboundEmailConfigured(),
    /** SMS via Twilio (alertas + OTP registo se ALLOW_CLIENT_PHONE_VERIFY=1 ou DEV_SIGNUP_SMS_SIMULATE=1 em dev) */
    twilioSmsConfigured: isTwilioSmsConfigured(),
    notifyApiEnabled: process.env.ALLOW_CLIENT_NOTIFY_API === "1",
    verifySecretOk: !!(process.env.VERIFY_EMAIL_SECRET && process.env.VERIFY_EMAIL_SECRET.length >= 16),
  });
}
