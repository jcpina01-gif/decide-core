import type { NextApiRequest, NextApiResponse } from "next";
import {
  normalizeUsernameServer,
  loginUserServer,
} from "../../../../lib/server/clientUserStore";

type Body = {
  username?: string;
  passwordHash?: string;
};

type Out =
  | { ok: true; user: string }
  | { ok: false; error: string };

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
  if (!u) return res.status(400).json({ ok: false, error: "username_required" });

  const ph = body.passwordHash;
  if (!ph || typeof ph !== "string" || !ph.startsWith("h_")) {
    return res.status(400).json({ ok: false, error: "invalid_password_hash" });
  }

  const result = loginUserServer({ username: u, passwordHash: ph });
  if (!result.ok) {
    return res.status(401).json({ ok: false, error: result.error });
  }

  return res.status(200).json({ ok: true, user: result.user });
}
