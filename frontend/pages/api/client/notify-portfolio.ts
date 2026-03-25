/**
 * Envia email (Resend ou Gmail SMTP) e SMS (Twilio) quando o cliente tem constituição / rebalance.
 *
 * Env (frontend/.env.local):
 *   ALLOW_CLIENT_NOTIFY_API=1
 *   Email: RESEND_API_KEY (+ NOTIFY_FROM_EMAIL) **ou** GMAIL_USER + GMAIL_APP_PASSWORD (palavra-passe de app)
 *   TWILIO_ACCOUNT_SID=...
 *   TWILIO_AUTH_TOKEN=...
 *   TWILIO_FROM_NUMBER=+351XXXXXXXXX
 *
 * Sem email/Twilio: responde ok com mode=simulated (útil em dev).
 */

import type { NextApiRequest, NextApiResponse } from "next";
import { hasOutboundEmailConfigured, sendOutboundEmail } from "../../../lib/server/outboundEmail";
import { isTwilioSmsConfigured, sendTwilioSms } from "../../../lib/server/twilioSms";

export type NotifyPortfolioBody = {
  event?: "constitution" | "monthly_review";
  email?: string;
  phone?: string;
  clientLabel?: string;
};

type NotifyResult = {
  ok: boolean;
  mode: "live" | "simulated";
  email?: { sent: boolean; error?: string; id?: string };
  sms?: { sent: boolean; error?: string; sid?: string };
  message?: string;
};

function buildCopy(event: "constitution" | "monthly_review", clientLabel: string): { subject: string; text: string } {
  const who = clientLabel ? ` (${clientLabel})` : "";
  if (event === "constitution") {
    return {
      subject: `DECIDE — Constituição da carteira${who}`,
      text:
        `Olá,\n\n` +
        `Tens uma ação de constituição da carteira DECIDE pendente. Consulta o dashboard cliente e o separador Carteira no painel de KPIs para a composição sugerida.\n\n` +
        `Este alerta foi gerado a partir do botão de notificação do dashboard.\n`,
    };
  }
  return {
    subject: `DECIDE — Revisão mensal / rebalance${who}`,
    text:
      `Olá,\n\n` +
      `Hoje é dia de revisão mensal (ciclo global) da estratégia DECIDE. Consulta o separador Carteira no painel de KPIs e ajusta as tuas ordens conforme o perfil.\n\n` +
      `Este alerta foi gerado a partir do botão de notificação do dashboard.\n`,
  };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse<NotifyResult>) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, mode: "simulated", message: "method_not_allowed" });
  }

  if (process.env.ALLOW_CLIENT_NOTIFY_API !== "1") {
    return res.status(503).json({
      ok: false,
      mode: "simulated",
      message:
        "API desligada. Define ALLOW_CLIENT_NOTIFY_API=1 em frontend/.env.local (e Gmail ou Resend + Twilio para envio real).",
    });
  }

  let body: NotifyPortfolioBody = {};
  try {
    body = typeof req.body === "string" ? (JSON.parse(req.body) as NotifyPortfolioBody) : (req.body as NotifyPortfolioBody) || {};
  } catch {
    return res.status(400).json({ ok: false, mode: "simulated", message: "invalid_json" });
  }

  const event = body.event === "monthly_review" ? "monthly_review" : "constitution";
  const clientLabel = (body.clientLabel || "").trim();
  const { subject, text } = buildCopy(event, clientLabel);
  const smsText =
    event === "constitution"
      ? `DECIDE: constituição da carteira pendente. Vê o dashboard cliente (Carteira).`
      : `DECIDE: revisão mensal hoje. Vê o dashboard cliente (Carteira).`;

  const email = (body.email || "").trim();
  const phone = (body.phone || "").trim();

  const hasEmail = hasOutboundEmailConfigured();
  const hasTwilio = isTwilioSmsConfigured();

  const out: NotifyResult = {
    ok: true,
    mode: hasEmail || hasTwilio ? "live" : "simulated",
    email: { sent: false },
    sms: { sent: false },
  };

  if (!email && !phone) {
    return res.status(400).json({
      ok: false,
      mode: out.mode,
      message: "Indica pelo menos email (registo) ou telemóvel no dashboard.",
    });
  }

  if (!hasEmail && !hasTwilio) {
    out.mode = "simulated";
    out.ok = true;
    out.message = `Simulação: email → ${email || "—"} | SMS → ${phone || "—"}. Configura Resend ou Gmail (GMAIL_USER + GMAIL_APP_PASSWORD) e/ou Twilio para envio real.`;
    out.email = { sent: false, error: "simulated" };
    out.sms = { sent: false, error: "simulated" };
    return res.status(200).json(out);
  }

  if (email) {
    if (hasEmail) {
      const er = await sendOutboundEmail({ to: email, subject, text });
      out.email = er.ok ? { sent: true, id: er.id } : { sent: false, error: er.error };
    } else {
      out.email = { sent: false, error: "email_provider_not_configured" };
    }
  } else {
    out.email = { sent: false, error: "no_email" };
  }

  if (phone) {
    if (hasTwilio) {
      const sr = await sendTwilioSms(phone, smsText);
      out.sms = sr.ok ? { sent: true, sid: sr.sid } : { sent: false, error: sr.error };
    } else {
      out.sms = { sent: false, error: "twilio_not_configured" };
    }
  } else {
    out.sms = { sent: false, error: "no_phone" };
  }

  const needEmail = !!email && hasEmail;
  const needSms = !!phone && hasTwilio;
  const emailFail = needEmail && !out.email?.sent;
  const smsFail = needSms && !out.sms?.sent;
  if (emailFail || smsFail) {
    out.ok = false;
    out.message = "Envio parcial ou falhou — vê detalhes (email/sms).";
    return res.status(502).json(out);
  }

  out.ok = true;
  out.message = "Notificações processadas (canais configurados).";
  return res.status(200).json(out);
}
