import type { NextApiRequest } from "next";

/** Base URL pública da app (Checkout success/cancel) — env / Vercel. */
export function stripeAppBaseUrl(): string {
  const u = (process.env.NEXT_PUBLIC_APP_URL || "").trim().replace(/\/$/, "");
  if (u) return u;
  const v = (process.env.VERCEL_URL || "").trim();
  if (v) return `https://${v}`.replace(/\/$/, "");
  return "http://127.0.0.1:4701";
}

/**
 * URL para success/cancel do Checkout: em **Preview** na Vercel usa o host do pedido
 * (`*.vercel.app`), para o regresso bater no mesmo domínio que o `localStorage` do onboarding.
 * Em **production** usa `NEXT_PUBLIC_APP_URL` / `stripeAppBaseUrl()` (evita confundir com deploys de preview).
 */
export function stripeCheckoutPublicBaseUrl(req: NextApiRequest): string {
  if (process.env.VERCEL_ENV === "preview") {
    const xfHost = (req.headers["x-forwarded-host"] as string | undefined)?.split(",")[0]?.trim();
    const host = xfHost || (req.headers.host as string | undefined)?.trim();
    const xfProto = (req.headers["x-forwarded-proto"] as string | undefined)?.split(",")[0]?.trim();
    const proto = xfProto === "http" || xfProto === "https" ? xfProto : "https";
    if (host && !/^localhost(:\d+)?$/i.test(host) && !/^127\.0\.0\.1(:\d+)?$/i.test(host)) {
      return `${proto}://${host}`.replace(/\/$/, "");
    }
  }
  return stripeAppBaseUrl();
}
