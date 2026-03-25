/**
 * Envio transaccional: Resend (API) ou Gmail (SMTP com App Password).
 *
 * Gmail (.env.local):
 *   GMAIL_USER=teu.email@gmail.com
 *   GMAIL_APP_PASSWORD=xxxx xxxx xxxx xxxx   # Conta Google → Segurança → palavras-passe de app
 *
 * Resend (opcional):
 *   RESEND_API_KEY=re_...
 *   NOTIFY_FROM_EMAIL=DECIDE <onboarding@resend.dev>
 *
 * Prioridade por defeito: Gmail se GMAIL_USER + GMAIL_APP_PASSWORD; senão Resend se RESEND_API_KEY.
 * Forçar: EMAIL_TRANSPORT=gmail | resend
 */

import nodemailer from "nodemailer";

export type OutboundEmailResult =
  | { ok: true; provider: "resend" | "gmail"; id?: string }
  | { ok: false; error: string; hint?: string };

/** Dicas em PT para erros frequentes da API Resend. */
export function hintForResendMessage(message: string): string | undefined {
  const m = (message || "").toLowerCase();
  if (!m) return undefined;
  if (m.includes("only send") || m.includes("testing emails") || m.includes("verify a domain")) {
    return (
      "Resend em modo de testes: com onboarding@resend.dev só podes enviar para o email da tua conta Resend. " +
      "Alternativa: configura GMAIL_USER + GMAIL_APP_PASSWORD para enviar pelo teu Gmail."
    );
  }
  if (m.includes("domain") && (m.includes("not verified") || m.includes("verify"))) {
    return "Verifica o domínio do remetente na Resend ou usa Gmail (GMAIL_USER + GMAIL_APP_PASSWORD).";
  }
  if (m.includes("invalid") && m.includes("from")) {
    return "NOTIFY_FROM_EMAIL inválido para a Resend — corrige ou usa Gmail.";
  }
  if (m.includes("api key") || m.includes("unauthorized") || m.includes("401")) {
    return "RESEND_API_KEY inválida — ou remove-a e usa Gmail (GMAIL_USER + GMAIL_APP_PASSWORD).";
  }
  return undefined;
}

async function sendViaResend(
  to: string,
  subject: string,
  text: string,
  html?: string,
): Promise<OutboundEmailResult> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.NOTIFY_FROM_EMAIL || "onboarding@resend.dev";
  if (!key) return { ok: false, error: "missing_resend" };

  const signal = AbortSignal.timeout(25_000);
  let r: Response;
  try {
    r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from,
        to: [to],
        subject,
        text,
        ...(html ? { html } : {}),
      }),
      signal,
    });
  } catch (e: unknown) {
    const name = e && typeof e === "object" && "name" in e ? String((e as { name?: string }).name) : "";
    if (name === "AbortError" || name === "TimeoutError") {
      return { ok: false, error: "resend_timeout", hint: "Resend não respondeu a tempo. Tenta Gmail ou outra rede." };
    }
    return { ok: false, error: "resend_network", hint: "Não foi possível contactar a API Resend." };
  }

  const j = (await r.json().catch(() => ({}))) as { id?: string; message?: string };
  if (!r.ok) {
    const msg = j.message || `http_${r.status}`;
    return { ok: false, error: msg, hint: hintForResendMessage(msg) };
  }
  return { ok: true, provider: "resend", id: j.id };
}

async function sendViaGmail(
  to: string,
  subject: string,
  text: string,
  html?: string,
): Promise<OutboundEmailResult> {
  const user = (process.env.GMAIL_USER || "").trim();
  const appPass = (process.env.GMAIL_APP_PASSWORD || "").replace(/\s/g, "");
  if (!user || !appPass) {
    return { ok: false, error: "missing_gmail", hint: "Define GMAIL_USER e GMAIL_APP_PASSWORD em .env.local (palavra-passe de app Google)." };
  }

  const fromName = (process.env.NOTIFY_FROM_NAME || "DECIDE").trim() || "DECIDE";

  /** Em redes com proxy/antivírus que reencriptam o tráfego, o Node pode falhar com "self-signed certificate in certificate chain". */
  const tlsRejectUnauthorized = process.env.GMAIL_TLS_REJECT_UNAUTHORIZED !== "0";

  try {
    const transporter = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      auth: { user, pass: appPass },
      tls: { rejectUnauthorized: tlsRejectUnauthorized },
    });

    const info = await transporter.sendMail({
      from: `"${fromName.replace(/"/g, "")}" <${user}>`,
      to,
      subject,
      text,
      ...(html ? { html } : {}),
    });

    return { ok: true, provider: "gmail", id: info.messageId };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    const low = msg.toLowerCase();
    let hint: string | undefined;
    if (low.includes("invalid login") || low.includes("535") || low.includes("authentication")) {
      hint =
        "Falha de login Gmail: confirma GMAIL_USER (email completo) e GMAIL_APP_PASSWORD (16 caracteres da palavra-passe de app, não a password normal). Ativa verificação em 2 passos na Google.";
    } else if (low.includes("gmail") && low.includes("blocked")) {
      hint = "A Google pode bloquear login SMTP pouco habitual — verifica email de alerta da Google ou https://accounts.google.com/DisplayUnlockCaptcha";
    } else if (low.includes("self-signed certificate") || low.includes("certificate chain")) {
      hint =
        "Rede/proxy/antivírus a interceptar SSL (certificado próprio). Tenta outra rede ou desliga VPN. Só em desenvolvimento: GMAIL_TLS_REJECT_UNAUTHORIZED=0 em .env.local e reinicia npm run dev (menos seguro).";
    }
    return { ok: false, error: msg || "gmail_send_failed", hint };
  }
}

export async function sendOutboundEmail(opts: {
  to: string;
  subject: string;
  text: string;
  html?: string;
}): Promise<OutboundEmailResult> {
  const { to, subject, text, html } = opts;
  if (!to?.includes("@")) {
    return { ok: false, error: "invalid_to" };
  }

  const prefer = (process.env.EMAIL_TRANSPORT || "").trim().toLowerCase();
  const hasResend = !!process.env.RESEND_API_KEY;
  const hasGmail = !!(process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD);

  if (prefer === "resend") {
    if (hasResend) return sendViaResend(to, subject, text, html);
    if (hasGmail) return sendViaGmail(to, subject, text, html);
  } else if (prefer === "gmail") {
    if (hasGmail) return sendViaGmail(to, subject, text, html);
    if (hasResend) return sendViaResend(to, subject, text, html);
  } else {
    // Por defeito: Gmail primeiro (conta pessoal @gmail.com sem domínio próprio).
    if (hasGmail) return sendViaGmail(to, subject, text, html);
    if (hasResend) return sendViaResend(to, subject, text, html);
  }

  return {
    ok: false,
    error: "no_email_provider",
    hint:
      "Configura RESEND_API_KEY ou então GMAIL_USER + GMAIL_APP_PASSWORD (Gmail → Segurança → palavras-passe de app). Opcional: EMAIL_TRANSPORT=gmail ou resend para forçar.",
  };
}

export function hasOutboundEmailConfigured(): boolean {
  return !!(process.env.RESEND_API_KEY || (process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD));
}
