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
 *
 * - **Produção:** `EMAIL_LINK_BASE_URL` ou Host público (Vercel).
 * - **Dev (predefinição):** se o pedido vier com `Host` LAN/público (não loopback), usa esse host — o link no email
 *   coincide com o endereço que abriste no browser (evita `.env` com IP errado, ex. 192.168.1.249 inacessível).
 * - **Dev estrito:** `EMAIL_LINK_BASE_URL_STRICT=1` força sempre `EMAIL_LINK_BASE_URL` quando definido.
 */
export function resolveEmailLinkBaseUrl(req: NextApiRequest | undefined): string {
  const hostRaw = req?.headers?.host ? String(req.headers.host).trim() : "";
  const hostLc = hostRaw.toLowerCase();
  const isLoopback =
    !hostLc ||
    hostLc.startsWith("127.0.0.1:") ||
    hostLc.startsWith("localhost:") ||
    hostLc === "localhost" ||
    hostLc === "127.0.0.1";

  const strict = String(process.env.EMAIL_LINK_BASE_URL_STRICT || "").trim() === "1";
  const explicit = stripTrailingSlash(String(process.env.EMAIL_LINK_BASE_URL || "").trim());

  if (strict && explicit) {
    return explicit;
  }

  /**
   * Em dev, preferir o Host do pedido (mesmo IP/porta que o utilizador usou no registo).
   */
  if (process.env.NODE_ENV !== "production" && hostRaw && !isLoopback) {
    const xf = String(req?.headers?.["x-forwarded-proto"] || "")
      .split(",")[0]
      ?.trim()
      .toLowerCase();
    const proto = xf === "https" || xf === "http" ? xf : "http";
    return stripTrailingSlash(`${proto}://${hostRaw}`);
  }

  if (explicit) {
    return explicit;
  }

  if (hostRaw && !isLoopback) {
    const xf = String(req?.headers?.["x-forwarded-proto"] || "")
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
