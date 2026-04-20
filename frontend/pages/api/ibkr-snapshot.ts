import type { NextApiRequest, NextApiResponse } from "next";
import { getBackendBase, productionBackendLocalhostHint } from "../../lib/apiProxy";
import {
  buildIbkrRoutingHeaders,
  ibkrPerRequestRoutingEnabled,
  resolveIbkrSocketRoute,
} from "../../lib/server/ibkrInternalRouting";
import { respondJsonIfUpstreamHtmlError } from "../../lib/upstreamProxyCoerceJson";
import { tryBuildIbkrSnapshotFromTmpDiag } from "../../lib/server/ibkrSnapshotTmpDiagFallback";

/** Snapshot pode incluir reqContractDetails por posição (nome, sector, zona) — precisa de margem. */
const UPSTREAM_MS = 120_000;

/** Só com `DECIDE_IBKR_TMP_DIAG_FALLBACK=1` — por defeito desligado para não mascarar ausência do FastAPI (carteira real). */
function tmpDiagIbkrFallbackEnabled(): boolean {
  const v = (process.env.DECIDE_IBKR_TMP_DIAG_FALLBACK || "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

/**
 * Proxy explícito para POST /api/ibkr-snapshot no FastAPI.
 * Evita depender do catch-all /api/proxy/[...path] (alguns POSTs não preenchem bem req.query.path → 404 no upstream).
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === "GET") {
    const probeBase = getBackendBase();
    res.setHeader("X-Decide-Proxy-Backend", probeBase);
    return res.status(200).json({
      ok: true,
      proxy: "ibkr-snapshot",
      backendBase: probeBase,
    });
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ detail: "Method not allowed" });
  }

  const base = getBackendBase();
  const targetUrl = `${base.replace(/\/+$/, "")}/api/ibkr-snapshot`;

  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), UPSTREAM_MS);

  try {
    const bodyObj =
      typeof req.body === "object" && req.body !== null ? (req.body as Record<string, unknown>) : null;
    const paperMode = bodyObj && typeof bodyObj.paper_mode === "boolean" ? bodyObj.paper_mode : true;
    const payload =
      typeof req.body === "object" && req.body !== null
        ? JSON.stringify(req.body)
        : JSON.stringify({ paper_mode: true });

    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (ibkrPerRequestRoutingEnabled()) {
      const route = resolveIbkrSocketRoute();
      const rh = route ? buildIbkrRoutingHeaders(route, paperMode) : null;
      if (!route || !rh) {
        res.status(503).json({
          status: "rejected",
          error:
            "DECIDE_IBKR_PER_REQUEST_ROUTING is enabled but Next cannot resolve a route: set DECIDE_IBKR_INTERNAL_HMAC_SECRET and DECIDE_IBKR_ROUTE_MAP_JSON (and DECIDE_IBKR_ROUTE_KEY if not «default»).",
        });
        return;
      }
      Object.assign(headers, rh);
    }

    const upstream = await fetch(targetUrl, {
      method: "POST",
      headers,
      body: payload,
      signal: ac.signal,
    });

    const buf = Buffer.from(await upstream.arrayBuffer());
    if (
      respondJsonIfUpstreamHtmlError(res, upstream, buf, {
        targetUrl,
        backendBase: base,
        routeLabel: "/api/ibkr-snapshot",
        mode: "ibkr_snapshot_503",
      })
    ) {
      return;
    }
    res.status(upstream.status);
    res.setHeader("X-Decide-Proxy-Backend", base);
    const ct = upstream.headers.get("content-type");
    if (ct) res.setHeader("content-type", ct);
    res.send(buf);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    const isAbort = e instanceof Error && e.name === "AbortError";
    if (tmpDiagIbkrFallbackEnabled()) {
      const fb = tryBuildIbkrSnapshotFromTmpDiag();
      if (fb) {
        res.status(200);
        res.setHeader("content-type", "application/json; charset=utf-8");
        res.setHeader("X-Decide-Ibkr-Fallback", "tmp_diag");
        res.send(JSON.stringify(fb));
        return;
      }
    }
    const hint = productionBackendLocalhostHint();
    res.status(503).json({
      status: "rejected",
      backendBase: base,
      error: isAbort
        ? `Timeout (${UPSTREAM_MS / 1000}s) ao contactar o backend em ${targetUrl}. Confirme uvicorn e IB Gateway ou TWS.${hint}`
        : `Ligação ao backend falhou (${msg}). Confirme DECIDE_BACKEND_URL / BACKEND_URL e que o FastAPI está a correr.${hint}`,
    });
  } finally {
    clearTimeout(t);
  }
}
