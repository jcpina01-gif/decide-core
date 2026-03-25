import type { NextApiRequest, NextApiResponse } from "next";
import { bodyFromReq, buildTargetUrl, copyHeaders } from "../../../lib/apiProxy";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  let targetUrl = "";
  try {
    targetUrl = buildTargetUrl(req, { prependApiPrefix: true });

    const method = (req.method || "GET").toUpperCase();
    const headers = copyHeaders(req);

    const init: RequestInit = {
      method,
      headers,
      body: bodyFromReq(req, headers),
    };

    const upstream = await fetch(targetUrl, init);

    const buf = Buffer.from(await upstream.arrayBuffer());

    res.status(upstream.status);

    // Copiar só cabeçalhos “seguros”: reencaminhar tudo pode fazer `setHeader` rebentar no Node
    // (ex.: nomes inválidos, valores com caracteres proibidos) → 500 na rota proxy.
    const ct = upstream.headers.get("content-type");
    if (ct) {
      res.setHeader("content-type", ct);
    }

    res.send(buf);
  } catch (err: any) {
    console.error("[api/proxy] fetch failed:", targetUrl, err?.message || err);
    res.status(500).json({
      ok: false,
      error: String(err?.message || err),
      targetUrl: targetUrl || null,
      backendBase: process.env.BACKEND_URL || process.env.NEXT_PUBLIC_BACKEND_URL || null,
    });
  }
}