import crypto from "crypto";

const SIGN_VERSION = "v1";

export type IbkrSocketRoute = { host: string; port: number; clientId: number };

function truthyEnv(v: string | undefined): boolean {
  const s = (v || "").trim().toLowerCase();
  return s === "1" || s === "true" || s === "yes" || s === "on";
}

export function ibkrPerRequestRoutingEnabled(): boolean {
  return truthyEnv(process.env.DECIDE_IBKR_PER_REQUEST_ROUTING);
}

function routingSecret(): string {
  return (process.env.DECIDE_IBKR_INTERNAL_HMAC_SECRET || "").trim();
}

function canonicalMessage(params: {
  tsMs: number;
  nonce: string;
  paperMode: boolean;
  host: string;
  port: number;
  clientId: number;
}): string {
  const pm = params.paperMode ? "1" : "0";
  return `${SIGN_VERSION}\n${params.tsMs}\n${params.nonce}\n${pm}\n${params.host}\n${params.port}\n${params.clientId}\n`;
}

export function parseIbkrRouteMap(): Record<string, IbkrSocketRoute> {
  const raw = (process.env.DECIDE_IBKR_ROUTE_MAP_JSON || "").trim();
  if (!raw) return {};
  try {
    const o = JSON.parse(raw) as unknown;
    if (!o || typeof o !== "object") return {};
    const out: Record<string, IbkrSocketRoute> = {};
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
      if (!k || !v || typeof v !== "object") continue;
      const rec = v as Record<string, unknown>;
      const host = String(rec.host || "").trim();
      const port = Number(rec.port);
      const clientId = Number(rec.clientId);
      if (!host || !Number.isFinite(port) || !Number.isFinite(clientId)) continue;
      out[k] = { host, port: Math.trunc(port), clientId: Math.trunc(clientId) };
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * Resolve destino IBKR no servidor Next (sem store): mapa JSON + chave em env.
 * Chave: ``DECIDE_IBKR_ROUTE_KEY`` (default ``default``).
 */
export function resolveIbkrSocketRoute(): IbkrSocketRoute | null {
  const map = parseIbkrRouteMap();
  const key = (process.env.DECIDE_IBKR_ROUTE_KEY || "default").trim() || "default";
  return map[key] ?? map["default"] ?? null;
}

export function buildIbkrRoutingHeaders(
  route: IbkrSocketRoute,
  paperMode: boolean
): Record<string, string> | null {
  const secret = routingSecret();
  if (!secret) return null;

  const tsMs = Date.now();
  const nonce = crypto.randomBytes(16).toString("hex");
  const msg = canonicalMessage({
    tsMs,
    nonce,
    paperMode,
    host: route.host,
    port: route.port,
    clientId: route.clientId,
  });
  const signature = crypto.createHmac("sha256", secret).update(msg, "utf8").digest("hex");

  return {
    "X-Decide-Ibkr-Sign-Version": SIGN_VERSION,
    "X-Decide-Ibkr-Ts": String(tsMs),
    "X-Decide-Ibkr-Nonce": nonce,
    "X-Decide-Ibkr-Host": route.host,
    "X-Decide-Ibkr-Port": String(route.port),
    "X-Decide-Ibkr-Client-Id": String(route.clientId),
    "X-Decide-Ibkr-Signature": signature,
  };
}
