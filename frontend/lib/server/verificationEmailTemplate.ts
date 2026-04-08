/**
 * HTML de email com botão CTA (tabelas + estilos inline — compatível com Gmail/Outlook mobile).
 * Não usamos target="_blank" no &lt;a&gt;: em muitos clientes reduz pedidos extra de «abrir com…».
 */
import { isLocalhostLinkBase } from "./emailLinkBase";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Escapa só o que é preciso para atributo href (query com &). */
function hrefForHtmlAttribute(url: string): string {
  return url.replace(/&/g, "&amp;");
}

export type VerificationEmailKind = "prospect" | "signup" | "account";

export function buildVerificationEmailHtml(params: {
  link: string;
  kind: VerificationEmailKind;
  username?: string;
}): string {
  const { link, kind, username } = params;
  const linkBase = (() => {
    try {
      return new URL(link).origin;
    } catch {
      return "";
    }
  })();
  const loopback = linkBase ? isLocalhostLinkBase(linkBase) : false;

  const intro =
    kind === "prospect"
      ? "Clique no botão abaixo para confirmar que deseja <strong>receber novidades da DECIDE</strong> (sem criar conta)."
      : kind === "signup"
        ? "Clique no botão abaixo para confirmar o seu email <strong>antes de concluir o registo</strong> na DECIDE."
        : `Clique no botão abaixo para confirmar o email da conta DECIDE (<strong>${escapeHtml(String(username || "").trim())}</strong>).`;

  const devWarning = loopback
    ? `<table role="presentation" width="100%" style="margin:0 0 20px;border-collapse:collapse;"><tr><td style="background:#fef3c7;border:1px solid #f59e0b;border-radius:12px;padding:14px 16px;font-size:14px;line-height:1.5;color:#78350f;">
<strong>Para funcionar no telemóvel em testes:</strong> este convite utiliza <code style="background:#fff;padding:2px 6px;border-radius:4px;font-size:12px;">127.0.0.1</code> ou <code style="background:#fff;padding:2px 6px;border-radius:4px;font-size:12px;">localhost</code> — no telemóvel <strong>não é o seu PC</strong> e surge erro de ligação. No PC, no ficheiro <code style="font-size:12px;">frontend/.env.local</code>, defina <code style="font-size:12px;">EMAIL_LINK_BASE_URL=http://O-SEU-IP:4701</code> (veja o IPv4 no <code style="font-size:12px;">ipconfig</code>), execute <code style="font-size:12px;">npm run dev:lan</code> e solicite um <strong>novo</strong> email de confirmação.
</td></tr></table>`
    : "";

  const btnLabel =
    kind === "prospect" ? "Confirmar email — lista DECIDE" : "Confirmar email — DECIDE";

  const href = hrefForHtmlAttribute(link);

  return `<!DOCTYPE html>
<html lang="pt">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#e4e4e7;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#e4e4e7;padding:20px 10px;">
<tr><td align="center">
<table role="presentation" width="100%" style="max-width:480px;background:#ffffff;border-radius:16px;border-collapse:separate;box-shadow:0 8px 30px rgba(24,24,27,0.12);">
<tr><td style="padding:28px 22px 24px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;font-size:16px;line-height:1.55;color:#18181b;">
<p style="margin:0 0 8px;">Olá,</p>
<p style="margin:0 0 18px;">${intro}</p>
${devWarning}
<table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center" style="margin:8px auto 22px;border-collapse:separate;">
<tr><td align="center" style="border-radius:14px;background:linear-gradient(165deg,#3f9e93 0%,#2d7f76 45%,#1e5c56 100%);">
<a href="${href}" style="display:inline-block;padding:18px 36px;font-size:17px;font-weight:800;color:#ffffff;text-decoration:none;border-radius:14px;line-height:1.2;-webkit-text-size-adjust:none;">
${btnLabel}
</a>
</td></tr></table>
<p style="margin:0 0 8px;font-size:13px;color:#71717a;">Se o botão não responder, copie este endereço para o browser:</p>
<p style="margin:0;font-size:12px;word-break:break-all;color:#475569;line-height:1.4;">${escapeHtml(link)}</p>
<p style="margin:22px 0 0;font-size:13px;color:#a1a1aa;">O link expira em 48 horas.</p>
</td></tr></table>
<p style="margin:18px 0 0;font-size:11px;color:#71717a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">DECIDE</p>
</td></tr></table>
</body></html>`;
}

export function buildVerificationEmailTextAppendix(link: string): string {
  let base = "";
  try {
    base = new URL(link).origin;
  } catch {
    return "";
  }
  if (!isLocalhostLinkBase(base)) return "";
  return (
    "\n\n---\n" +
    "TELEMÓVEL (teste local): Se o link tiver 127.0.0.1 ou localhost, no telemóvel NÃO abre (não é o seu PC). " +
    "Defina EMAIL_LINK_BASE_URL com o IP da rede (ex. http://192.168.1.80:4701) em frontend/.env.local, execute npm run dev:lan e solicite um NOVO email.\n"
  );
}
