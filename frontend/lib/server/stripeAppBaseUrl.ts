/** Base URL pública da app (Checkout success/cancel). */
export function stripeAppBaseUrl(): string {
  const u = (process.env.NEXT_PUBLIC_APP_URL || "").trim().replace(/\/$/, "");
  if (u) return u;
  const v = (process.env.VERCEL_URL || "").trim();
  if (v) return `https://${v}`.replace(/\/$/, "");
  return "http://127.0.0.1:4701";
}
