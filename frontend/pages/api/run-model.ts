import type { NextApiRequest, NextApiResponse } from "next";
import { buildRunModelUrl } from "../../lib/apiProxy";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const upstream = await fetch(buildRunModelUrl(req), {
      method: "GET",
      headers: {
        accept: "application/json",
      },
    });

    res.status(upstream.status);
    upstream.headers.forEach((value, key) => {
      const k = key.toLowerCase();
      if (k === "transfer-encoding" || k === "content-encoding") return;
      res.setHeader(key, value);
    });

    const buf = Buffer.from(await upstream.arrayBuffer());
    res.send(buf);
  } catch (err: any) {
    res.status(500).json({
      ok: false,
      error: String(err?.message || err),
    });
  }
}