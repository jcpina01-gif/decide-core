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
    const msg = String(err?.message || err);
    const causeCode = err?.cause?.code || err?.cause?.errno;
    const unreachable =
      /fetch failed/i.test(msg) ||
      causeCode === "ECONNREFUSED" ||
      causeCode === "ENOTFOUND" ||
      causeCode === "ETIMEDOUT";
    res.status(500).json({
      ok: false,
      error: msg,
      ...(unreachable
        ? {
            hint:
              "O Next não conseguiu ligar ao FastAPI. Arranca o backend (ex.: py -3 -m uvicorn main:app --host 127.0.0.1 --port 8090 na pasta backend) e confirma BACKEND_URL no .env.local.",
          }
        : {}),
      backendBase:
        process.env.DECIDE_BACKEND_URL ||
        process.env.NEXT_PUBLIC_DECIDE_BACKEND_URL ||
        process.env.BACKEND_URL ||
        process.env.NEXT_PUBLIC_BACKEND_URL ||
        null,
    });
  }
}