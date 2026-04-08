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
    const msg = String(err?.message || err);
    const causeCode = err?.cause?.code || err?.cause?.errno;
    const unreachable =
      /fetch failed/i.test(msg) ||
      causeCode === "ECONNREFUSED" ||
      causeCode === "ENOTFOUND" ||
      causeCode === "ETIMEDOUT";
    console.error("[api/proxy] fetch failed:", targetUrl, msg, causeCode || "");
    res.status(500).json({
      ok: false,
      error: msg,
      ...(unreachable
        ? {
            hint:
              "O Next não conseguiu ligar ao FastAPI. Confirme que o backend está a correr na mesma URL que BACKEND_URL / DECIDE_BACKEND_URL (ex.: na pasta backend: py -3 -m uvicorn main:app --host 127.0.0.1 --port 8090). Reinicie o npm run dev após alterar .env.local.",
          }
        : {}),
      targetUrl: targetUrl || null,
      backendBase:
        process.env.DECIDE_BACKEND_URL ||
        process.env.NEXT_PUBLIC_DECIDE_BACKEND_URL ||
        process.env.BACKEND_URL ||
        process.env.NEXT_PUBLIC_BACKEND_URL ||
        null,
    });
  }
}