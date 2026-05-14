/**
 * POST /api/sumsub/token
 * Gera um access token Sumsub para o SDK WebSDK do cliente.
 *
 * Body: { external_user_id: string; level_name?: string; ttl_secs?: number }
 *
 * Requer variáveis de ambiente:
 *   SUMSUB_APP_TOKEN   — App token do painel Sumsub (Developers → App tokens)
 *   SUMSUB_SECRET_KEY  — Secret key par do App token (nunca exposta ao browser)
 *   SUMSUB_LEVEL_NAME  — Nome do verification level por defeito (ex. "basic-kyc-level")
 *   SUMSUB_BASE_URL    — Opcional; por defeito https://api.sumsub.com
 */
import type { NextApiRequest, NextApiResponse } from "next";
import crypto from "crypto";

const SUMSUB_BASE_URL = (process.env.SUMSUB_BASE_URL || "https://api.sumsub.com").replace(/\/$/, "");
const DEFAULT_LEVEL = process.env.SUMSUB_LEVEL_NAME || "basic-kyc-level";
const DEFAULT_TTL = 600;

function sign(secret: string, method: string, urlPath: string, bodyStr: string): { ts: number; sig: string } {
  const ts = Math.floor(Date.now() / 1000);
  const payload = String(ts) + method.toUpperCase() + urlPath + bodyStr;
  const sig = crypto.createHmac("sha256", secret).update(payload).digest("hex");
  return { ts, sig };
}

async function sumsubRequest(
  method: "GET" | "POST",
  urlPath: string,
  body: Record<string, unknown> | null,
): Promise<{ ok: boolean; status: number; data: unknown }> {
  const appToken = process.env.SUMSUB_APP_TOKEN?.trim() || "";
  const secretKey = process.env.SUMSUB_SECRET_KEY?.trim() || "";
  if (!appToken || !secretKey) {
    return { ok: false, status: 500, data: { description: "SUMSUB_APP_TOKEN / SUMSUB_SECRET_KEY não configurados" } };
  }

  const bodyStr = body ? JSON.stringify(body) : "";
  const { ts, sig } = sign(secretKey, method, urlPath, bodyStr);

  const headers: Record<string, string> = {
    "X-App-Token": appToken,
    "X-App-Access-Ts": String(ts),
    "X-App-Access-Sig": sig,
    Accept: "application/json",
  };
  if (body) headers["Content-Type"] = "application/json";

  const res = await fetch(`${SUMSUB_BASE_URL}${urlPath}`, {
    method,
    headers,
    body: body ? bodyStr : undefined,
  });

  let data: unknown;
  try {
    data = await res.json();
  } catch {
    data = { description: `HTTP ${res.status}` };
  }
  return { ok: res.ok, status: res.status, data };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const body = req.body as Record<string, unknown> | null | undefined;
  const externalUserId =
    typeof body?.external_user_id === "string" ? body.external_user_id.trim() : "";
  if (!externalUserId) {
    return res.status(400).json({ ok: false, error: "Missing external_user_id" });
  }

  const levelName =
    typeof body?.level_name === "string" && body.level_name.trim()
      ? body.level_name.trim()
      : DEFAULT_LEVEL;
  const ttlSecs =
    typeof body?.ttl_secs === "number" && body.ttl_secs > 0
      ? Math.round(body.ttl_secs)
      : DEFAULT_TTL;

  const urlPath = `/resources/accessTokens?userId=${encodeURIComponent(externalUserId)}&levelName=${encodeURIComponent(levelName)}&ttlInSecs=${ttlSecs}`;

  try {
    const { ok, status, data } = await sumsubRequest("POST", urlPath, null);
    if (!ok) {
      const msg = (data as Record<string, string>)?.description || `Sumsub HTTP ${status}`;
      console.error("[api/sumsub/token] Sumsub error", status, data);
      return res.status(502).json({ ok: false, error: msg });
    }
    const token = (data as Record<string, string>)?.token ?? "";
    if (!token) {
      console.error("[api/sumsub/token] token vazio na resposta", data);
      return res.status(502).json({ ok: false, error: "Sumsub não devolveu token" });
    }
    return res.status(200).json({ ok: true, token });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[api/sumsub/token] fetch failed", e);
    return res.status(500).json({ ok: false, error: msg });
  }
}
