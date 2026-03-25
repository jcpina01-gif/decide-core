import type { NextApiRequest } from "next";

function stripTrailingSlash(s: string): string {
  return s.replace(/\/$/, "");
}

/**
 * URL base dos links nos emails de confirmação (env).
 * EMAIL_LINK_BASE_URL tem prioridade (só servidor, .env.local — não precisa de rebuild).
 */
export function getEmailLinkBaseUrl(): string {
  const fromEnv =
    process.env.EMAIL_LINK_BASE_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.SITE_URL ||
    "";
  const trimmed = stripTrailingSlash(String(fromEnv).trim());
  if (trimmed) return trimmed;

  /** Vercel define isto em cada deploy — evita links no email para 127.0.0.1. */
  const vercel = String(process.env.VERCEL_URL || "").trim();
  if (vercel && process.env.NODE_ENV === "production") {
    return stripTrailingSlash(`https://${vercel}`);
  }

  return "http://127.0.0.1:4701";
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

  const hostRaw = req?.headers?.host ? String(req.headers.host).trim() : "";
  const hostLc = hostRaw.toLowerCase();
  const isLoopback =
    !hostLc ||
    hostLc.startsWith("127.0.0.1:") ||
    hostLc.startsWith("localhost:") ||
    hostLc === "localhost" ||
    hostLc === "127.0.0.1";

  /**
   * Em produção na Vercel o Host é o domínio público (ex. www.decidepoweredbyai.com).
   * Antes: caíamos sempre em getEmailLinkBaseUrl() → 127.0.0.1 nos emails.
   */
  if (hostRaw && !isLoopback) {
    const xf = String(req.headers["x-forwarded-proto"] || "")
      .split(",")[0]
      ?.trim()
      .toLowerCase();
    const proto =
      xf === "https" || xf === "http"
        ? xf
        : process.env.NODE_ENV === "production"
          ? "https"
          : "http";
    return stripTrailingSlash(`${proto}://${hostRaw}`);
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
