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
 * URL para success/cancel do Checkout.
 *
 * Com `NEXT_PUBLIC_APP_URL` definida (p.ex. `https://www.…`) usamo-la por defeito: cada **Preview** Vercel tem
 * outro `*.vercel.app`; a Persona exige o domínio no painel — o KYC/iframe quebra em subdomínios ainda não listados.
 * Regresso para o domínio canónico evita isso após o pagamento.
 *
 * Para testar **só** no preview (mesmo `localStorage` que o início do fluxo): `STRIPE_CHECKOUT_USE_PREVIEW_HOST=1` na
 * Vercel, e na Persona autorize esse host ou padrão que usem.
 */
export function stripeCheckoutPublicBaseUrl(req: NextApiRequest): string {
  const app = (process.env.NEXT_PUBLIC_APP_URL || "").trim().replace(/\/$/, "");
  if (app && (process.env.STRIPE_CHECKOUT_USE_PREVIEW_HOST || "").trim() !== "1") {
    return app;
  }
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
