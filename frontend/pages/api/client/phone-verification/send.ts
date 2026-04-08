import type { NextApiRequest, NextApiResponse } from "next";
import { normalizeClientPhoneE164 } from "../../../../lib/server/normalizeClientPhone";
import {
  canSendPhoneVerification,
  recordPhoneVerificationSend,
  savePendingCode,
} from "../../../../lib/server/phoneVerificationPendingStore";
import { isDevSignupSmsSimulate, isPhoneVerificationApiEnabled } from "../../../../lib/server/phoneVerificationGate";
import { createPhoneOtpProofToken } from "../../../../lib/server/phoneVerificationOtpProof";
import { sendTwilioSms, isTwilioSmsConfigured } from "../../../../lib/server/twilioSms";

type Body = { phone?: string };

type Out =
  | { ok: true; devOtp?: string; otpProof?: string }
  | { ok: false; error: string };

function randomSixDigit(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

export default async function handler(req: NextApiRequest, res: NextApiResponse<Out>) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }
  if (!isPhoneVerificationApiEnabled()) {
    return res.status(503).json({
      ok: false,
      error:
        "SMS de verificação desligado. Em produção: TWILIO_* + ALLOW_CLIENT_PHONE_VERIFY=1 em frontend/.env.local (reinicia o servidor). Em dev sem Twilio: DEV_SIGNUP_SMS_SIMULATE=1.",
    });
  }

  let body: Body = {};
  try {
    body = typeof req.body === "string" ? (JSON.parse(req.body) as Body) : (req.body as Body) || {};
  } catch {
    return res.status(400).json({ ok: false, error: "invalid_json" });
  }

  const norm = normalizeClientPhoneE164(String(body.phone || ""));
  if (!norm.ok) {
    return res.status(400).json({ ok: false, error: norm.error });
  }

  const rate = canSendPhoneVerification(norm.e164);
  if (!rate.ok) {
    return res.status(429).json({ ok: false, error: "Muitos pedidos. Tenta daqui a 1 hora." });
  }

  const code = randomSixDigit();
  const devSim = isDevSignupSmsSimulate();
  const twilioOk = isTwilioSmsConfigured();

  /** Dev sem Twilio: grava código só após «envio» simulado bem-sucedido. */
  if (devSim && !twilioOk) {
    savePendingCode(norm.e164, code);
    recordPhoneVerificationSend(norm.e164);
    const proof = createPhoneOtpProofToken(norm.e164, code);
    return res.status(200).json({ ok: true, devOtp: code, otpProof: proof || undefined });
  }

  const msg = `DECIDE: código de confirmação do telemóvel: ${code} (válido 10 min).`;
  const sent = await sendTwilioSms(norm.e164, msg);
  if (!sent.ok) {
    return res.status(502).json({
      ok: false,
      error: sent.error || "Falha ao contactar a Twilio. Confirme as chaves e veja o terminal onde corre npm run dev.",
    });
  }

  /** Só guardamos código e contador de rate depois do SMS aceite pela Twilio — evita bloquear o utilizador se o envio falhar. */
  savePendingCode(norm.e164, code);
  recordPhoneVerificationSend(norm.e164);

  const proof = createPhoneOtpProofToken(norm.e164, code);
  const out: { ok: true; devOtp?: string; otpProof?: string } = { ok: true, otpProof: proof || undefined };
  if (devSim && process.env.NODE_ENV === "development") out.devOtp = code;
  return res.status(200).json(out);
}
