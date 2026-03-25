import type { NextApiRequest, NextApiResponse } from "next";

export const config = {
  api: { bodyParser: { sizeLimit: "2mb" } },
};

function backendBase(): string {
  return (
    process.env.DECIDE_BACKEND_URL ||
    process.env.NEXT_PUBLIC_DECIDE_BACKEND_URL ||
    process.env.BACKEND_URL ||
    "http://127.0.0.1:8090"
  );
}

async function readJsonBody(req: NextApiRequest): Promise<any> {
  if (req.body && typeof req.body === "object") return req.body;
  try {
    const raw = await new Promise<string>((resolve) => {
      let data = "";
      req.on("data", (c) => (data += c));
      req.on("end", () => resolve(data));
    });
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "method_not_allowed" });
    return;
  }

  const base = backendBase();
  const url = base.replace(/\/$/, "") + "/api/performance/simulated_real";

  try {
    const body = await readJsonBody(req);

    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
    });

    const text = await r.text();
    let j: any = null;
    try { j = text ? JSON.parse(text) : {}; } catch { j = { ok: false, error: "backend_non_json", raw: text }; }

    res.status(r.status).json(j);
  } catch (e: any) {
    res.status(500).json({
      ok: false,
      error: "simulated_real_proxy_failed",
      backend_url: url,
      message: e?.message || "fetch failed",
    });
  }
}