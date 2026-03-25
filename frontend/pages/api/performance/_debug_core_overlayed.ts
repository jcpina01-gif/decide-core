import type { NextApiRequest, NextApiResponse } from "next";

type AnyObj = Record<string, any>;

function firstEnv(...keys: string[]): string {
  for (const k of keys) {
    const v = process.env[k];
    if (v && String(v).trim()) return String(v).trim();
  }
  return "";
}

function toBool(v: any, def: boolean): boolean {
  if (v === undefined || v === null || v === "") return def;
  if (typeof v === "boolean") return v;
  const s = String(v).toLowerCase().trim();
  if (["1", "true", "yes", "y", "on"].includes(s)) return true;
  if (["0", "false", "no", "n", "off"].includes(s)) return false;
  return def;
}

function toNum(v: any, def: number): number {
  if (v === undefined || v === null || v === "") return def;
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

function normalizeProfile(p: any): string {
  const s = String(p ?? "moderado").toLowerCase().trim();
  return s || "moderado";
}

function normalizeTicker(t: any): string {
  const s = String(t ?? "SPY").trim();
  return s || "SPY";
}

function buildPayload(req: NextApiRequest): AnyObj {
  // body pode vir como object, string, ou vazio (em GET)
  let body: AnyObj = {};
  try {
    if (req.body && typeof req.body === "object") body = req.body as AnyObj;
    else if (typeof req.body === "string" && req.body.trim()) body = JSON.parse(req.body);
  } catch {
    body = {};
  }

  const q = req.query || {};

  const profile = normalizeProfile(body.profile ?? q.profile);
  const benchmark = normalizeTicker(body.benchmark ?? q.benchmark);

  const top_q = toNum(body.top_q ?? q.top_q, 20);
  const lookback_days = toNum(body.lookback_days ?? q.lookback_days, 120);
  const cap_per_ticker = toNum(body.cap_per_ticker ?? q.cap_per_ticker, 0.2);

  const use_tws_raw = toBool(body.use_tws_raw ?? q.use_tws_raw, false);

  // ✅ Regra: include_series default TRUE (a menos que venha explicitamente false)
  const include_series = toBool(body.include_series ?? q.include_series, true);

  // include_debug default FALSE
  const include_debug = toBool(body.include_debug ?? q.include_debug, false);

  // voltarget
  const voltarget_enabled = toBool(body.voltarget_enabled ?? q.voltarget_enabled, true);
  const voltarget_window = toNum(body.voltarget_window ?? q.voltarget_window, 60);

  return {
    profile,
    benchmark,
    top_q,
    lookback_days,
    cap_per_ticker,
    use_tws_raw,
    include_series,
    include_debug,
    voltarget_enabled,
    voltarget_window,
  };
}

async function proxyToBackend(payload: AnyObj): Promise<Response> {
  const backend =
    firstEnv("DECIDE_BACKEND_URL", "NEXT_PUBLIC_BACKEND_URL", "NEXT_PUBLIC_DECIDE_BACKEND_URL") ||
    "http://127.0.0.1:8090";

  const url = backend.replace(/\/+$/, "") + "/api/performance/core_overlayed";

  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    // Permitimos GET e POST (GET vira payload via querystring)
    if (req.method !== "GET" && req.method !== "POST") {
      res.setHeader("Allow", "GET, POST");
      return res.status(405).json({ error: "method_not_allowed" });
    }

    const payload = buildPayload(req);

    // No-cache em dev (evita “fantasmas”)
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");

    const r = await proxyToBackend(payload);
    const text = await r.text();

    // Pass-through status se backend não ok
    res.status(r.status);

    // Sempre devolvemos JSON se possível
    try {
      const j = JSON.parse(text);
      return res.json(j);
    } catch {
      return res.json({ ok: false, error: "backend_non_json", raw: text, payload_sent: payload });
    }
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: "frontend_api_proxy_failed", message: e?.message || String(e) });
  }
}