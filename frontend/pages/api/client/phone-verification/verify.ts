import type { NextApiRequest, NextApiResponse } from "next";
import { normalizeClientPhoneE164 } from "../../../../lib/server/normalizeClientPhone";
import { verifyPhoneOtpProofToken } from "../../../../lib/server/phoneVerificationOtpProof";
import { verifyAndConsumePendingCode } from "../../../../lib/server/phoneVerificationPendingStore";
import { isPhoneVerificationApiEnabled } from "../../../../lib/server/phoneVerificationGate";
import { recordSignupPhoneVerified } from "../../../../lib/server/signupPhoneVerifiedStore";

type Body = { phone?: string; code?: string; otpProof?: string };

type Out = { ok: boolean; error?: string };

function sanitizeOtpDigits(raw: unknown): string {
  return String(raw ?? "")
    .normalize("NFKC")
    .replace(/\D/g, "")
    .slice(0, 8);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse<Out>) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }
  if (!isPhoneVerificationApiEnabled()) {
    return res.status(503).json({
      ok: false,
      error: "Verificação SMS desligada no servidor (reinicie o Next após .env.local).",
    });
  }

  let body: Body = {};
  try {
    body = typeof req.body === "string" ? (JSON.parse(req.body) as Body) : (req.body as Body) || {};
  } catch {
    return res.status(400).json({ ok: false, error: "invalid_json" });
  }

  try {
    const norm = normalizeClientPhoneE164(String(body.phone || ""));
    if (!norm.ok) {
      return res.status(400).json({ ok: false, error: norm.error });
    }
    const code = sanitizeOtpDigits(body.code);
    if (!/^\d{4,8}$/.test(code)) {
      return res.status(400).json({ ok: false, error: "Código inválido — utilize só os algarismos (4 a 8 dígitos)." });
    }

    const proofRaw = typeof body.otpProof === "string" ? body.otpProof.trim() : "";
    const okProof = proofRaw.length > 0 && verifyPhoneOtpProofToken(proofRaw, norm.e164, code);
    const okFile = verifyAndConsumePendingCode(norm.e164, code);
    const ok = okProof || okFile;
    if (!ok) {
      return res.status(400).json({
        ok: false,
        error:
          "Código incorreto ou expirado (10 min). Se alterou VERIFY_EMAIL_SECRET na Vercel, solicite um SMS novo. Em produção serverless é normal precisar do último SMS após cada deploy.",
      });
    }

    recordSignupPhoneVerified(norm.e164);
    return res.status(200).json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "verify_failed";
    console.error("[phone-verification/verify]", msg);
    return res.status(500).json({ ok: false, error: "Erro interno ao validar. Tente de novo ou solicite novo SMS." });
  }
}
