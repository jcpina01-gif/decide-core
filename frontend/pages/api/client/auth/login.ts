import type { NextApiRequest, NextApiResponse } from "next";
import { serverCheckPassword, serverUpsertUser } from "../../../../lib/serverClientUserStore";

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

  const { username, passwordHash } = req.body ?? {};
  if (!username || !passwordHash) {
    return res.status(400).json({ error: "missing_fields" });
  }

  const u = String(username).trim().toLowerCase();
  const h = String(passwordHash).trim();

  // 1. Try Render backend (persistent store)
  const backendBase = getBackendBase();
  if (backendBase) {
    try {
      const r = await fetch(`${backendBase}/api/client/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: u, passwordHash: h }),
        signal: AbortSignal.timeout(8000),
      });
      if (r.ok) {
        // Cache in local in-memory store for fast subsequent checks
        serverUpsertUser(u, { passwordHash: h, updatedAt: Date.now() });
        return res.status(200).json({ ok: true });
      }
      if (r.status === 401) {
        const j = (await r.json()) as { error?: string };
        return res.status(401).json({ error: j.error ?? "user_not_found" });
      }
      // Backend returned other error — fall through to local store
    } catch {
      // Network error — fall through to local store
    }
  }

  // 2. Fallback: local in-memory store (env var seed / same warm instance)
  const result = serverCheckPassword(u, h);
  if (result === "ok") return res.status(200).json({ ok: true });
  if (result === "wrong_password") return res.status(401).json({ error: "wrong_password" });
  return res.status(401).json({ error: "user_not_found" });
}
