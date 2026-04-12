import type { NextApiRequest, NextApiResponse } from "next";
import type { KpiFlaskHealthDebug } from "../../lib/kpiFlaskHealthTypes";
import { kpiServerBaseUrlForServer } from "../../lib/server/fetchPlafonadoCagrFromKpiServer";

type Out = {
  /** HTTP OK e payload reconhecido como `/api/health` do Decide KPI Flask. */
  reachable: boolean;
  /** Valor de `build` no JSON de `/api/health` ou header `X-Decide-Kpi-Build`. */
  build: string | null;
  upstreamStatus?: number;
  error?: string;
  /** Só em desenvolvimento — diagnóstico (URL usada pelo Node). */
  baseUsed?: string;
  debug?: KpiFlaskHealthDebug;
};

/**
 * Health do Flask KPI visto **do servidor Next** (`127.0.0.1:5000` ou `KPI_SERVER_INTERNAL_BASE` / env).
 * Evita o browser pedir `/kpi-flask/api/health` (middleware / corpo que às vezes não expõe JSON ao cliente).
 */
function wantDebug(req: NextApiRequest): boolean {
  if (process.env.NODE_ENV === "development") return true;
  const q = req.query?.debug;
  return q === "1" || q === "true";
}

function safePreview(s: string, max = 220): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length <= max ? t : `${t.slice(0, max)}…`;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse<Out>) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ reachable: false, build: null, error: "method_not_allowed" });
  }

  const base = kpiServerBaseUrlForServer();
  if (!base) {
    return res.status(200).json({
      reachable: false,
      build: null,
      error: "no_kpi_base_configured",
    });
  }

  const url = `${base.replace(/\/+$/, "")}/api/health`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12_000);
  try {
    const readHdrBuild = (resp: Response) => (resp.headers.get("x-decide-kpi-build") || "").trim();

    /** Corpo GET por vezes vem vazio/corrompido; o `HEAD` do mesmo endpoint envia só headers com o build. */
    let headBuild = "";
    let headOk = false;
    try {
      const headCtrl = new AbortController();
      const headT = setTimeout(() => headCtrl.abort(), 5000);
      try {
        const hr = await fetch(url, {
          method: "HEAD",
          signal: headCtrl.signal,
          cache: "no-store",
        });
        headOk = hr.ok;
        headBuild = readHdrBuild(hr);
      } finally {
        clearTimeout(headT);
      }
    } catch {
      /* ignorar — seguimos com GET */
    }

    const r = await fetch(url, {
      method: "GET",
      signal: ctrl.signal,
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    clearTimeout(timer);

    const hdrBuildGet = readHdrBuild(r);
    const text = await r.text();
    const trimmed = text.replace(/^\uFEFF/, "").trim();

    let j: Record<string, unknown> | null = null;
    try {
      j = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      j = null;
    }

    let build: string | null =
      j != null && typeof j.build === "string" && j.build.trim() ? j.build.trim() : null;
    if (!build && hdrBuildGet) build = hdrBuildGet;
    if (!build && headBuild) build = headBuild;
    /* `JSON.parse` pode falhar (BOM já removido, proxy, corpo truncado); o build ainda aparece como texto. */
    if (!build) {
      const m = trimmed.match(/"build"\s*:\s*"([^"]*)"/);
      if (m?.[1]) build = m[1].trim();
    }

    /**
     * Exige token `build` (JSON, header GET/HEAD ou regex no corpo).
     * Não aceitar só `{ ok, app }` — serviços antigos / proxies imitam isso sem `embed-diag-canon-v*`,
     * gerando banner âmbar «(sem build)» e iframe errado.
     */
    const hasBuildToken = Boolean(build);

    const out: Out = {
      reachable: r.ok && hasBuildToken,
      build,
      upstreamStatus: r.status,
    };
    if (r.ok && !hasBuildToken) {
      out.error = "kpi_health_missing_build";
    } else if (!r.ok) {
      out.error = `upstream_http_${r.status}`;
    }
    if (process.env.NODE_ENV === "development") out.baseUsed = base;
    if (wantDebug(req) && r.ok && !hasBuildToken) {
      out.debug = {
        probeUrl: url,
        headOk,
        headBuildLen: headBuild.length,
        getHdrBuildLen: hdrBuildGet.length,
        contentType: String(r.headers.get("content-type") || ""),
        bodyLength: trimmed.length,
        bodyPreview: safePreview(trimmed),
      };
    }
    return res.status(200).json(out);
  } catch (e) {
    clearTimeout(timer);
    const out: Out = {
      reachable: false,
      build: null,
      error: e instanceof Error ? e.message : String(e),
    };
    if (process.env.NODE_ENV === "development") out.baseUsed = base;
    return res.status(200).json(out);
  }
}
