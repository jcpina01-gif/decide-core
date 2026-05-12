import type { NextApiRequest, NextApiResponse } from "next";

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
  const backendBase = getBackendBase();
  if (!backendBase) return res.status(503).json({ error: "backend_unavailable" });

  // POST without `prefs` field = fetch prefs (credentials in body, not query string)
  if (req.method === "POST") {
    const { username, passwordHash } = req.body ?? {};
    if (!username || !passwordHash) return res.status(400).json({ error: "missing_fields" });
    try {
      const r = await fetch(`${backendBase}/api/client/prefs/fetch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: String(username), passwordHash: String(passwordHash) }),
        signal: AbortSignal.timeout(8000),
      });
      const j = await r.json();
      return res.status(r.status).json(j);
    } catch {
      return res.status(502).json({ error: "backend_error" });
    }
  }

  if (req.method === "PUT") {
    const { username, passwordHash, prefs } = req.body ?? {};
    if (!username || !passwordHash || prefs == null) return res.status(400).json({ error: "missing_fields" });
    try {
      const r = await fetch(`${backendBase}/api/client/prefs`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, passwordHash, prefs }),
        signal: AbortSignal.timeout(8000),
      });
      const j = await r.json();
      return res.status(r.status).json(j);
    } catch {
      return res.status(502).json({ error: "backend_error" });
    }
  }

  return res.status(405).json({ error: "method_not_allowed" });
}
