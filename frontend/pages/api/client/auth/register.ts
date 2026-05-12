import type { NextApiRequest, NextApiResponse } from "next";
import { serverGetUser, serverUpsertUser } from "../../../../lib/serverClientUserStore";

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });

  const { username, passwordHash, email, phone, emailVerified } = req.body ?? {};
  if (!username || !passwordHash) {
    return res.status(400).json({ error: "missing_fields" });
  }

  const u = String(username).trim().toLowerCase();
  const h = String(passwordHash).trim();
  const existing = serverGetUser(u);

  serverUpsertUser(u, {
    passwordHash: h,
    email: String(email ?? existing?.email ?? "").trim(),
    phone: String(phone ?? existing?.phone ?? "").trim(),
    emailVerified: emailVerified === true || existing?.emailVerified === true,
    updatedAt: Date.now(),
  });

  return res.status(200).json({ ok: true });
}
