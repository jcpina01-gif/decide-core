import type { NextApiRequest, NextApiResponse } from "next";
import { serverGetUser, serverUpsertUser } from "../../../../lib/serverClientUserStore";

function getBackendBase(): string | null {
  return (
    process.env.DECIDE_BACKEND_URL ||
    process.env.NEXT_PUBLIC_DECIDE_BACKEND_URL ||
    process.env.BACKEND_URL ||
    process.env.NEXT_PUBLIC_BACKEND_URL ||
    null
  );
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });

  const { username, passwordHash, email, phone, emailVerified } = req.body ?? {};
  if (!username || !passwordHash) {
    return res.status(400).json({ error: "missing_fields" });
  }

  const u = String(username).trim().toLowerCase();
  const h = String(passwordHash).trim();

  // 1. Persist on Render backend (durable store)
  const backendBase = getBackendBase();
  if (backendBase) {
    try {
      await fetch(`${backendBase}/api/client/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: u, passwordHash: h, email, phone, emailVerified }),
        signal: AbortSignal.timeout(8000),
      });
    } catch {
      // Network error — account still saved locally below
    }
  }

  // 2. Also save in local in-memory store (fast same-instance login)
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
