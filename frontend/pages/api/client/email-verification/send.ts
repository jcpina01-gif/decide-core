import type { NextApiRequest, NextApiResponse } from "next";
import { resolveEmailLinkBaseUrl } from "../../../../lib/server/emailLinkBase";
import { createEmailVerificationToken } from "../../../../lib/server/emailVerificationToken";
import { hasOutboundEmailConfigured, sendOutboundEmail } from "../../../../lib/server/outboundEmail";
import {
  buildVerificationEmailHtml,
  buildVerificationEmailTextAppendix,
} from "../../../../lib/server/verificationEmailTemplate";

type Body = {
  username?: string;
  email?: string;
  signupOnly?: boolean;
  prospectOnly?: boolean;
  /** Gravado em prospect_leads (ex. dashboard) */
  prospectSource?: string;
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  if (process.env.ALLOW_CLIENT_NOTIFY_API !== "1") {
    return res.status(503).json({
      ok: false,
      error: "api_disabled",
      hint: "ALLOW_CLIENT_NOTIFY_API=1 e VERIFY_EMAIL_SECRET (16+ chars) em .env.local",
    });
  }

  let body: Body = {};
  try {
    body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body as Body) || {};
  } catch {
    return res.status(400).json({ ok: false, error: "invalid_json" });
  }

  const signupOnly = Boolean(body.signupOnly);
  const prospectOnly = Boolean(body.prospectOnly);
  const username = String(body.username || "").trim().toLowerCase();
  const email = String(body.email || "").trim();
  if (!email.includes("@")) {
    return res.status(400).json({ ok: false, error: "email_required" });
  }
  if (signupOnly && prospectOnly) {
    return res.status(400).json({ ok: false, error: "signup_or_prospect_not_both" });
  }
  if (prospectOnly) {
    // lista de interessados: sem user, sem misturar com pré-registo
  } else if (!signupOnly && !username) {
    return res.status(400).json({ ok: false, error: "username_and_email_required" });
  }

  if (!process.env.VERIFY_EMAIL_SECRET || process.env.VERIFY_EMAIL_SECRET.length < 16) {
    return res.status(503).json({
      ok: false,
      error: "verify_secret_missing",
      hint: "Defina VERIFY_EMAIL_SECRET com pelo menos 16 caracteres aleatórios.",
    });
  }

  const token = prospectOnly
    ? createEmailVerificationToken(email, null, {
        prospect: true,
        prospectSource: String(body.prospectSource || "").trim() || undefined,
      })
    : createEmailVerificationToken(email, signupOnly ? null : username);
  if (!token) {
    return res.status(500).json({ ok: false, error: "token_create_failed" });
  }

  const linkBase = resolveEmailLinkBaseUrl(req);
  const link = `${linkBase}/client/verify-email?token=${encodeURIComponent(token)}`;
  const subject = prospectOnly
    ? "DECIDE — Confirme o email para receber novidades"
    : "DECIDE — Confirme o email";
  const textBase = prospectOnly
    ? `Olá,\n\nClique no botão no email (versão HTML) ou abra o link abaixo para confirmar que deseja receber comunicações da DECIDE (sem criar conta):\n\n${link}\n\n` +
      `O link expira em 48 horas. Se mais tarde criar conta, o registo continua independente desta lista.\n`
    : signupOnly
      ? `Olá,\n\nClique no botão no email (versão HTML) ou abra o link abaixo para confirmar o seu endereço de email antes de concluir o registo DECIDE:\n\n${link}\n\n` +
        `O link expira em 48 horas.\n`
      : `Olá,\n\nClique no botão no email (versão HTML) ou abra o link abaixo para confirmar o email da sua conta DECIDE (user: ${username}):\n\n${link}\n\n` +
        `O link expira em 48 horas.\n`;
  const text = textBase + buildVerificationEmailTextAppendix(link);

  const htmlKind = prospectOnly ? "prospect" : signupOnly ? "signup" : "account";
  const html = buildVerificationEmailHtml({
    link,
    kind: htmlKind,
    username: signupOnly || prospectOnly ? undefined : username,
  });

  if (!hasOutboundEmailConfigured()) {
    return res.status(200).json({
      ok: true,
      mode: "simulated",
      message:
        "Sem RESEND_API_KEY nem Gmail (GMAIL_USER + GMAIL_APP_PASSWORD) — email não enviado. Link de teste:",
      link,
      linkBase,
    });
  }

  const sent = await sendOutboundEmail({ to: email, subject, text, html });
  if (!sent.ok) {
    const hint =
      sent.hint ||
      (sent.error === "resend_timeout"
        ? "Resend não respondeu a tempo (rede/firewall)."
        : sent.error === "resend_network"
          ? "Não foi possível contactar a API Resend."
          : undefined);
    if (process.env.NODE_ENV === "development") {
      // eslint-disable-next-line no-console
      console.warn("[email-verification] Envio falhou:", sent.error, hint ? `| ${hint}` : "");
    }
    return res.status(502).json({
      ok: false,
      error: sent.error || "send_failed",
      hint,
    });
  }

  if (process.env.NODE_ENV === "development") {
    // eslint-disable-next-line no-console
    console.log("[email-verification] OK via", sent.provider, "→", email, sent.id || "");
  }

  return res.status(200).json({
    ok: true,
    mode: "sent",
    provider: sent.provider,
    id: sent.id,
    link,
    linkBase,
  });
}
