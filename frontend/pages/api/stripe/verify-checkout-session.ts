import type { NextApiRequest, NextApiResponse } from "next";
import Stripe from "stripe";

/**
 * Valida a sessão após o redirect de sucesso (GET com `session_id` da query string do Checkout).
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  const id = typeof req.query.session_id === "string" ? req.query.session_id : "";
  if (!id) {
    return res.status(400).json({ ok: false, error: "missing_session_id" });
  }

  const key = (process.env.STRIPE_SECRET_KEY || "").trim();
  if (!key) {
    return res.status(503).json({ ok: false, error: "stripe_not_configured" });
  }

  const stripe = new Stripe(key, { apiVersion: "2024-11-20.acacia" });
  try {
    const s = await stripe.checkout.sessions.retrieve(id);
    const complete = s.status === "complete";
    return res.status(200).json({
      ok: true,
      complete,
      payment_status: s.payment_status,
      status: s.status,
      customer_email: s.customer_details?.email ?? s.customer_email ?? null,
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e instanceof Error ? e.message : "error" });
  }
}
