import type { NextApiRequest, NextApiResponse } from "next";

type HealthOut = {
  ok: boolean;
  service: string;
  backend: string;
  nodeEnv: string | null;
  vercelEnv: string | null;
  /** qa | staging | production | dev — definir na Vercel para identificar o deployment (só diagnóstico). */
  decideDeployment: string | null;
  backendProbe?: {
    ok: boolean;
    status?: number;
    latencyMs?: number;
    body?: unknown;
    error?: string;
  };
};

export default async function handler(req: NextApiRequest, res: NextApiResponse<HealthOut>) {
  const backend =
    process.env.DECIDE_BACKEND_URL ||
    process.env.NEXT_PUBLIC_DECIDE_BACKEND_URL ||
    process.env.BACKEND_URL ||
    process.env.NEXT_PUBLIC_BACKEND_URL ||
    "http://127.0.0.1:8090";

  const decideDeployment =
    (process.env.NEXT_PUBLIC_DECIDE_DEPLOYMENT || process.env.DECIDE_DEPLOYMENT || "").trim() || null;

  const wantProbe =
    req.query.probe === "1" ||
    req.query.probe === "true" ||
    String(req.query.deep || "") === "1";

  const out: HealthOut = {
    ok: true,
    service: "decide-frontend",
    backend,
    nodeEnv: process.env.NODE_ENV || null,
    vercelEnv: process.env.VERCEL_ENV || null,
    decideDeployment,
  };

  if (wantProbe) {
    const base = backend.replace(/\/+$/, "");
    const url = `${base}/api/health`;
    const t0 = Date.now();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4500);
    try {
      const r = await fetch(url, { signal: ctrl.signal, headers: { Accept: "application/json" } });
      clearTimeout(timer);
      const latencyMs = Date.now() - t0;
      let body: unknown = null;
      try {
        body = await r.json();
      } catch {
        body = null;
      }
      out.backendProbe = { ok: r.ok, status: r.status, latencyMs, body };
    } catch (e) {
      clearTimeout(timer);
      out.backendProbe = {
        ok: false,
        latencyMs: Date.now() - t0,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }

  res.status(200).json(out);
}