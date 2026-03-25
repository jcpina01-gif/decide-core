import type { NextApiRequest } from "next";

function stripTrailingSlash(s: string): string {
  return s.replace(/\/$/, "");
}

/**
 * URL base dos links nos emails de confirmação (env).
 * EMAIL_LINK_BASE_URL tem prioridade (só servidor, .env.local — não precisa de rebuild).
 */
export function getEmailLinkBaseUrl(): string {
  const raw =
    process.env.EMAIL_LINK_BASE_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.SITE_URL ||
    "http://127.0.0.1:4701";
  return stripTrailingSlash(String(raw).trim());
}

/**
 * Base URL dos links de confirmação no email.
 * 1) Se `EMAIL_LINK_BASE_URL` estiver definido → usa **sempre** (telemóvel = mesmo URL; evita IP/porta errados por acaso do Host do pedido).
 * 2) Em dev, sem EMAIL_LINK_BASE_URL: tenta inferir do Host do pedido (LAN).
 * 3) Caso contrário: getEmailLinkBaseUrl().
 */
export function resolveEmailLinkBaseUrl(req: NextApiRequest | undefined): string {
  const explicit = stripTrailingSlash(String(process.env.EMAIL_LINK_BASE_URL || "").trim());
  if (explicit) {
    return explicit;
  }

  if (process.env.NODE_ENV === "production" || !req?.headers?.host) {
    return getEmailLinkBaseUrl();
  }
  const host = String(req.headers.host || "").trim().toLowerCase();
  if (!host) {
    return getEmailLinkBaseUrl();
  }
  const isLoopback =
    host.startsWith("127.0.0.1:") ||
    host.startsWith("localhost:") ||
    host === "localhost" ||
    host === "127.0.0.1";
  if (!isLoopback) {
    const xf = String(req.headers["x-forwarded-proto"] || "")
      .split(",")[0]
      ?.trim()
      .toLowerCase();
    const proto = xf === "https" || xf === "http" ? xf : "http";
    return stripTrailingSlash(`${proto}://${String(req.headers.host).trim()}`);
  }
  return getEmailLinkBaseUrl();
}

export function isLocalhostLinkBase(base: string): boolean {
  try {
    const u = new URL(base);
    const h = u.hostname.toLowerCase();
    return h === "localhost" || h === "127.0.0.1" || h === "::1";
  } catch {
    return /127\.0\.0\.1|localhost/i.test(base);
  }
}
