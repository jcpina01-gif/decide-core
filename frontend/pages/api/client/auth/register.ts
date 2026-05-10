import type { NextApiRequest, NextApiResponse } from "next";
import {
  hashPasswordServer,
  normalizeUsernameServer,
  registerUserServer,
} from "../../../../lib/server/clientUserStore";

type Body = {
  username?: string;
  passwordHash?: string;
  email?: string;
  phone?: string;
  emailVerified?: boolean;
};

type Out =
  | { ok: true }
  | { ok: false; error: string; field?: string };

export default function handler(req: NextApiRequest, res: NextApiResponse<Out>) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  let body: Body = {};
  try {
    body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body as Body) || {};
  } catch {
    return res.status(400).json({ ok: false, error: "invalid_json" });
  }

  const u = normalizeUsernameServer(body.username || "");
  if (!u) return res.status(400).json({ ok: false, error: "username_required", field: "username" });

  // Accept either a pre-hashed password (from client) or a raw password to hash server-side.
  // The client sends passwordHash so the raw password never crosses the wire.
  const ph = body.passwordHash;
  if (!ph || typeof ph !== "string" || !ph.startsWith("h_")) {
    return res.status(400).json({ ok: false, error: "invalid_password_hash" });
  }

  const result = registerUserServer({
    username: u,
    passwordHash: ph,
    email: body.email,
    phone: body.phone,
    emailVerified: body.emailVerified,
  });

  if (!result.ok) {
    return res.status(400).json(result);
  }

  return res.status(200).json({ ok: true });
}
