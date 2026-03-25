/**
 * Prova HMAC do OTP de SMS, enviada ao cliente após o envio — necessária em hosting serverless (ex. Vercel),
 * onde `.data/phone_verification_pending.json` não é partilhado entre pedidos «send» e «verify».
 */
import crypto from "crypto";
import { getVerifyEmailSecret } from "./emailVerificationToken";
import { hashVerificationCode } from "./phoneVerificationPendingStore";

const PROOF_VERSION = 1;

export function createPhoneOtpProofToken(phone: string, code: string): string | null {
  const secret = getVerifyEmailSecret();
  if (!secret || secret.length < 16) return null;
  const p = phone.trim();
  const exp = Date.now() + 10 * 60 * 1000;
  const h = hashVerificationCode(p, code);
  const payload = `${PROOF_VERSION}|${exp}|${p}|${h}`;
  const sig = crypto.createHmac("sha256", secret).update(payload).digest("hex");
  const blob = JSON.stringify({ exp, p, h, sig });
  return Buffer.from(blob, "utf8").toString("base64url");
}

export function verifyPhoneOtpProofToken(token: string, phone: string, code: string): boolean {
  const secret = getVerifyEmailSecret();
  if (!secret || secret.length < 16) return false;
  let o: { exp: number; p: string; h: string; sig: string };
  try {
    o = JSON.parse(Buffer.from(token, "base64url").toString("utf8")) as {
      exp: number;
      p: string;
      h: string;
      sig: string;
    };
  } catch {
    return false;
  }
  if (
    !o ||
    typeof o.exp !== "number" ||
    typeof o.p !== "string" ||
    typeof o.h !== "string" ||
    typeof o.sig !== "string"
  ) {
    return false;
  }
  if (o.p !== phone.trim()) return false;
  if (Date.now() > o.exp) return false;
  const payload = `${PROOF_VERSION}|${o.exp}|${o.p}|${o.h}`;
  const expected = crypto.createHmac("sha256", secret).update(payload).digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(String(o.sig), "utf8");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  const tryHash = hashVerificationCode(phone, code);
  const ah = Buffer.from(tryHash, "utf8");
  const bh = Buffer.from(o.h, "utf8");
  if (ah.length !== bh.length) return false;
  return crypto.timingSafeEqual(ah, bh);
}
