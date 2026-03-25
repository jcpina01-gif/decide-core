import type { NextApiRequest, NextApiResponse } from "next";
import { buildTargetUrl, copyHeaders as copyProxyHeaders } from "../../../lib/apiProxy";

export const config = {
  api: {
    bodyParser: false,
  },
};

async function readRawBody(req: NextApiRequest): Promise<Uint8Array> {
  const chunks: Buffer[] = [];
  const buf = await new Promise<Buffer>((resolve, reject) => {
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
  // BodyInit compat for fetch typings
  return new Uint8Array(buf);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  let targetUrl = "";
  try {
    targetUrl = buildTargetUrl(req);

    const method = (req.method || "GET").toUpperCase();
    const headers = copyProxyHeaders(req) as Record<string, string>;

    const init: RequestInit = {
      method,
      headers,
    };

    if (method !== "GET" && method !== "HEAD") {
      init.body = await readRawBody(req) as unknown as BodyInit;
    }

    const upstream = await fetch(targetUrl, init);

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
      targetUrl: targetUrl || null,
      backendBase: process.env.BACKEND_URL || process.env.NEXT_PUBLIC_BACKEND_URL || null,
    });
  }
}