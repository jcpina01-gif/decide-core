import type { NextApiRequest, NextApiResponse } from "next";
import { serverCheckPassword, serverUpsertUser } from "../../../../lib/serverClientUserStore";

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });

  const { username, passwordHash } = req.body ?? {};
  if (!username || !passwordHash) {
    return res.status(400).json({ error: "missing_fields" });
  }

  const u = String(username).trim().toLowerCase();
  const h = String(passwordHash).trim();

  const result = serverCheckPassword(u, h);

  if (result === "ok") {
    // Refresh updatedAt on successful login (keeps record warm)
    const rec = { passwordHash: h, updatedAt: Date.now() };
    serverUpsertUser(u, rec);
    return res.status(200).json({ ok: true });
  }

  if (result === "wrong_password") {
    return res.status(401).json({ error: "wrong_password" });
  }

  // user_not_found
  return res.status(401).json({ error: "user_not_found" });
}
