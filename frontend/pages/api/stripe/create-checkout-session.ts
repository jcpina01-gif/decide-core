import type { NextApiRequest, NextApiResponse } from "next";
import Stripe from "stripe";
import { stripeCheckoutPublicBaseUrl } from "../../../lib/server/stripeAppBaseUrl";

type Body = { priceId?: string; modeOverride?: string };

/**
 * Cria um Stripe Checkout no final do onboarding (passo 6).
 * Env: `STRIPE_SECRET_KEY`, `STRIPE_ONBOARDING_PRICE_ID`; opcional `STRIPE_ONBOARDING_CHECKOUT_MODE` = `subscription` | `payment`.
 * Em deploy **Preview**, as URLs de regresso usam o host do pedido (mesmo `localStorage` que o onboarding).
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  const key = (process.env.STRIPE_SECRET_KEY || "").trim();
  let priceId = (process.env.STRIPE_ONBOARDING_PRICE_ID || "").trim();
  let body: Body = {};
  try {
    body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body as Body) || {};
  } catch {
    body = {};
  }
  if (typeof body.priceId === "string" && body.priceId.trim().length > 0) {
    if ((process.env.STRIPE_ONBOARDING_ALLOW_CLIENT_PRICE || "").trim() === "1") {
      priceId = body.priceId.trim();
    }
  }

  if (!key || !priceId) {
    return res.status(503).json({ ok: false, error: "stripe_not_configured" });
  }

  const site = stripeCheckoutPublicBaseUrl(req);
  const modeRaw = (body.modeOverride || process.env.STRIPE_ONBOARDING_CHECKOUT_MODE || "subscription").trim();
  const mode: Stripe.Checkout.SessionCreateParams.Mode =
    modeRaw === "payment" ? "payment" : "subscription";

  const stripe = new Stripe(key, { apiVersion: "2024-11-20.acacia" });

  try {
    const session = await stripe.checkout.sessions.create({
      mode,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${site}/client/ibkr-prep?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${site}/client/ibkr-prep?checkout=cancelled`,
    });
    if (!session.url) {
      return res.status(500).json({ ok: false, error: "no_checkout_url" });
    }
    return res.status(200).json({ ok: true, url: session.url });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "stripe_error";
    return res.status(500).json({ ok: false, error: "stripe_error", detail: msg });
  }
}
