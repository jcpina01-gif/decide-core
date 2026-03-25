import type { NextApiRequest, NextApiResponse } from "next";

const BACKEND_URL = "http://127.0.0.1:8088/api/run-model-multi-stock-v1";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const t0 = Date.now();
  try {
    const payload = req.body ?? {};
    const r = await fetch(BACKEND_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const txt = await r.text();
    const data = JSON.parse(txt);

    res.status(200).json(data);
  } catch (err: any) {
    res.status(200).json({
      ok: false,
      error: "proxy_failed",
      message: String(err?.message ?? err),
      backend_url: BACKEND_URL,
      elapsed_ms: Date.now() - t0,
    });
  }
}
