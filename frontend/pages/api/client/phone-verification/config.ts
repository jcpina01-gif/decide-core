import type { NextApiRequest, NextApiResponse } from "next";
import { getVerifyEmailSecret } from "../../../../lib/server/emailVerificationToken";
import {
  isDevSignupSmsSimulate,
  isPhoneVerificationApiEnabled,
  isPhoneSmsRequiredForClientSignup,
} from "../../../../lib/server/phoneVerificationGate";
import { isTwilioSmsConfigured } from "../../../../lib/server/twilioSms";

type Out = {
  ok: boolean;
  smsVerificationEnabled?: boolean;
  /** Twilio SMS (SID/token/from) preenchidos */
  twilioConfigured?: boolean;
  /** ALLOW_CLIENT_PHONE_VERIFY=1 */
  allowClientPhoneVerify?: boolean;
  /** Dev: OTP na resposta do send, sem SMS real se não houver Twilio */
  devSignupSmsSimulate?: boolean;
  /**
   * Se false, o UI conclui o registo sem código SMS. True só com Twilio+API e `REQUIRE_PHONE_SMS_FOR_SIGNUP=1`
   * (ou `ALLOW_SIGNUP_WITHOUT_PHONE_SMS=0` na lógica de gate; ver phoneVerificationGate).
   */
  phoneSmsRequiredForSignup?: boolean;
  /** VERIFY_EMAIL_SECRET ≥ 16 — sem isto, em Vercel/serverless o POST verify não tem prova HMAC nem ficheiro partilhado. */
  phoneOtpProofEnabled?: boolean;
};

/**
 * Indica se o UI deve pedir confirmação por SMS.
 * Produção: TWILIO_* + ALLOW_CLIENT_PHONE_VERIFY=1
 * Dev opcional: DEV_SIGNUP_SMS_SIMULATE=1 (sem Twilio mostra código na API)
 */
export default function handler(req: NextApiRequest, res: NextApiResponse<Out>) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false });
  }
  const twilio = isTwilioSmsConfigured();
  const flag = process.env.ALLOW_CLIENT_PHONE_VERIFY === "1";
  const devSim = isDevSignupSmsSimulate();
  return res.status(200).json({
    ok: true,
    smsVerificationEnabled: isPhoneVerificationApiEnabled(),
    twilioConfigured: twilio,
    allowClientPhoneVerify: flag,
    devSignupSmsSimulate: devSim,
    phoneSmsRequiredForSignup: isPhoneSmsRequiredForClientSignup(),
    phoneOtpProofEnabled: getVerifyEmailSecret() != null,
  });
}
