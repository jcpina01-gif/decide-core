import type { NextApiRequest } from "next";

/**
 * Base do FastAPI (host:porta), **sem** sufixo `/api`.
 * Se `BACKEND_URL` for `http://127.0.0.1:8090/api`, os proxies fariam `/api/api/...` → 404.
 */
export function getBackendBase(): string {
  const v =
    process.env.DECIDE_BACKEND_URL ||
    process.env.NEXT_PUBLIC_DECIDE_BACKEND_URL ||
    process.env.BACKEND_URL ||
    process.env.NEXT_PUBLIC_BACKEND_URL ||
    "http://127.0.0.1:8090";

  if (typeof v !== "string" || !v.trim()) return "http://127.0.0.1:8090";
  let b = v.trim().replace(/\/+$/, "");
  if (/\/api$/i.test(b)) {
    b = b.replace(/\/api$/i, "");
  }
  return b.replace(/\/+$/, "") || "http://127.0.0.1:8090";
}

export function normalizePathParam(p: unknown): string[] {
  if (Array.isArray(p)) return p.map((x) => String(x)).filter(Boolean);
  if (typeof p === "string" && p.trim()) return [p.trim()];
  return [];
}

export function copyHeaders(req: NextApiRequest): HeadersInit {
  const headers: Record<string, string> = {};

  for (const [k, v] of Object.entries(req.headers || {})) {
    if (!k) continue;
    const key = k.toLowerCase();

    if (
      key === "host" ||
      key === "connection" ||
      key === "content-length" ||
      key === "accept-encoding" ||
      key === "transfer-encoding"
    ) {
      continue;
    }

    if (Array.isArray(v)) headers[key] = v.join(",");
    else if (typeof v === "string") headers[key] = v;
  }

  return headers;
}

export function bodyFromReq(req: NextApiRequest, headers: HeadersInit): BodyInit | undefined {
  const method = (req.method || "GET").toUpperCase();
  if (method === "GET" || method === "HEAD") return undefined;

  if (req.body === undefined || req.body === null) return undefined;

  if (typeof req.body === "string") return req.body;

  if (Buffer.isBuffer(req.body)) {
    return new Uint8Array(req.body) as unknown as BodyInit;
  }

  const s = JSON.stringify(req.body);
  const h = headers as any;
  if (!h["content-type"]) h["content-type"] = "application/json; charset=utf-8";
  return s;
}

export function buildTargetUrl(req: NextApiRequest, opts?: { prependApiPrefix?: boolean }): string {
  const backendBase = getBackendBase();
  const pathPartsRaw = normalizePathParam(req.query.path);
  const prependApiPrefix = Boolean(opts?.prependApiPrefix);

  const pathParts =
    prependApiPrefix && pathPartsRaw.length > 0 && pathPartsRaw[0].toLowerCase() === "api"
      ? pathPartsRaw
      : prependApiPrefix
        ? ["api", ...pathPartsRaw]
        : pathPartsRaw;

  const target = new URL(backendBase);
  const extraPath = pathParts.join("/");
  if (extraPath) {
    const basePath = target.pathname.replace(/\/+$/, "");
    target.pathname = `${basePath}/${extraPath}`.replace(/\/{2,}/g, "/");
  }

  for (const [k, v] of Object.entries(req.query || {})) {
    if (k === "path") continue;
    if (Array.isArray(v)) {
      for (const item of v) target.searchParams.append(k, String(item));
    } else if (v !== undefined && v !== null) {
      target.searchParams.set(k, String(v));
    }
  }

  return target.toString();
}

export function buildRunModelUrl(req: NextApiRequest): string {
  const backendBase = getBackendBase();
  const url = new URL(backendBase);
  url.pathname = (url.pathname.replace(/\/+$/, "") + "/api/run-model").replace(/\/{2,}/g, "/");

  for (const [k, v] of Object.entries(req.query || {})) {
    if (Array.isArray(v)) {
      for (const item of v) url.searchParams.append(k, String(item));
    } else if (v !== undefined && v !== null) {
      url.searchParams.set(k, String(v));
    }
  }

  return url.toString();
}
