import type { NextApiResponse } from "next";

/** Respostas de erro do upstream (Cloudflare, nginx, Vercel) vêm frequentemente em HTML. */
export function upstreamErrorBodyLooksNonJson(buf: Buffer, contentType: string | null): boolean {
  const ct = (contentType || "").toLowerCase();
  if (ct.includes("application/json")) {
    const t = buf.toString("utf-8").trimStart();
    return !(t.startsWith("{") || t.startsWith("["));
  }
  const head = buf.toString("utf-8", 0, Math.min(buf.length, 32)).trimStart().toLowerCase();
  if (!head.length) return true;
  return head.startsWith("<!") || head.startsWith("<html");
}

export function upstreamProxyHtmlFailureMessage(
  upstreamStatus: number,
  targetUrl: string,
  backendBase: string,
  routeLabel: string,
): string {
  const healthHint = `${backendBase.replace(/\/+$/, "")}/api/health`;
  if (upstreamStatus === 502 || upstreamStatus === 503) {
    return (
      `HTTP ${upstreamStatus} em ${routeLabel}: o proxy recebeu HTML (ou corpo vazio) em vez de JSON do FastAPI. ` +
      `Confirme que o backend está a correr e que DECIDE_BACKEND_URL / BACKEND_URL aponta para um URL público ` +
      `(não localhost em produção). Teste ${healthHint} no browser. ` +
      `IB Gateway/TWS tem de estar acessível a partir do servidor onde corre o uvicorn.`
    );
  }
  return (
    `HTTP ${upstreamStatus} em ${targetUrl}: corpo não é JSON. Confirme a versão do backend e a rota ${routeLabel}.`
  );
}

/**
 * Se o upstream devolveu erro com HTML, responde já em JSON e devolve **true** (handler deve fazer ``return``).
 */
export function respondJsonIfUpstreamHtmlError(
  res: NextApiResponse,
  upstream: { status: number; headers: { get(name: string): string | null } },
  buf: Buffer,
  p: {
    targetUrl: string;
    backendBase: string;
    routeLabel: string;
    mode: "ibkr_snapshot_503" | "flatten_200" | "cancel_orders_200";
  },
): boolean {
  const ct = upstream.headers.get("content-type");
  if (upstream.status < 400 || !upstreamErrorBodyLooksNonJson(buf, ct)) {
    return false;
  }
  const msg = upstreamProxyHtmlFailureMessage(upstream.status, p.targetUrl, p.backendBase, p.routeLabel);
  if (p.mode === "ibkr_snapshot_503") {
    res.status(503).json({
      status: "rejected",
      error: msg,
      backendBase: p.backendBase,
    });
    return true;
  }
  if (p.mode === "flatten_200") {
    res.status(200).json({ status: "rejected", error: msg, closes: [] });
    return true;
  }
  res.status(200).json({ status: "rejected", error: msg, cancellations: [] });
  return true;
}
