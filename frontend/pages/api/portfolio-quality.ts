import type { NextApiRequest, NextApiResponse } from "next";
import { getBackendBase, copyHeaders, bodyFromReq } from "../../lib/apiProxy";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const base = getBackendBase();
  const url  = `${base}/api/portfolio-quality`;
  try {
    const headers = copyHeaders(req) as Record<string, string>;
    headers["content-type"] = "application/json";
    const upstream = await fetch(url, {
      method:  "POST",
      headers,
      body:    bodyFromReq(req, headers),
    });
    const data = await upstream.json();
    res.status(upstream.status).json(data);
  } catch (err: any) {
    res.status(500).json({ error: String(err?.message || err) });
  }
}
