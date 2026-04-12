import type { NextApiRequest, NextApiResponse } from "next";
import { kpiServerBaseUrlForServer } from "../../lib/server/fetchPlafonadoCagrFromKpiServer";

/**
 * Proxy GET → Flask `/api/equity_series_for_simulator` (simulador no iframe).
 * Evita 404 quando JS antigo ou cache pede `/api/equity_series_for_simulator` na origem do Next
 * em vez de `/kpi-flask/api/...`.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const base = kpiServerBaseUrlForServer();
  if (!base) {
    return res.status(503).json({
      ok: false,
      error:
        "Servidor KPI Flask não configurado (defina KPI_SERVER_INTERNAL_BASE ou arranque kpi_server em :5000).",
    });
  }

  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(req.query)) {
    const val = Array.isArray(v) ? v[0] : v;
    if (val !== undefined && val !== null) qs.append(k, String(val));
  }
  const qstr = qs.toString();
  const url = `${base.replace(/\/+$/, "")}/api/equity_series_for_simulator${qstr ? `?${qstr}` : ""}`;

  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 30_000);
  try {
    const upstream = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: ac.signal,
    });
    clearTimeout(t);
    const buf = Buffer.from(await upstream.arrayBuffer());
    res.status(upstream.status);
    const ct = upstream.headers.get("content-type");
    if (ct) res.setHeader("content-type", ct);
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.send(buf);
  } catch (e: unknown) {
    clearTimeout(t);
    const msg = e instanceof Error ? e.message : String(e);
    res.status(503).json({ ok: false, error: msg, upstream: url });
  }
}
