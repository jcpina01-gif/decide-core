import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Fecha o site inteiro com HTTP Basic Auth quando SITE_GATE_PASSWORD está definida.
 * Na Vercel: Settings → Environment Variables → Production:
 *   SITE_GATE_PASSWORD=...
 * Opcional: SITE_GATE_USER (default "decide")
 * Em dev o gate fica desligado salvo SITE_GATE_IN_DEV=1 (para testares localmente).
 */
const gateUser = () => (process.env.SITE_GATE_USER || "decide").trim();
const gatePassword = () => (process.env.SITE_GATE_PASSWORD || "").trim();

/** Rotas que têm de funcionar sem Basic Auth (link no email abre noutro browser / app de correio). */
function isSiteGateBypass(pathname: string): boolean {
  /** Proxy dev para Flask KPI — o iframe não envia Basic Auth; tem de contornar o site gate. */
  if (pathname === "/kpi-flask" || pathname.startsWith("/kpi-flask/")) return true;
  if (pathname.startsWith("/client/verify-email")) return true;
  if (pathname.startsWith("/api/client/email-verification/")) return true;
  /** OTP SMS no registo — mesmo racional que o email (fetch pode não levar credenciais Basic em alguns clientes). */
  if (pathname.startsWith("/api/client/phone-verification/")) return true;
  if (pathname.startsWith("/api/persona/")) return true;
  /** Rotas internas com `isBackofficeEnabled()` próprio; o fetch do browser não envia Basic Auth automaticamente. */
  if (pathname.startsWith("/api/backoffice")) return true;
  /**
   * Vistas /embed/* — iframes a partir do kpi_server (Flask) e pedidos a correr noutro contexto de navegação
   * não carregam credenciais Basic; sem bypass o gate devolve 401 e o browser mostra ecrã em branco /
   * «resposta inválida».
   * Conteúdo: noindex (histórico ilustrativo, FAQ) — a exposição fica alinhada ao desenho original do embed.
   */
  if (pathname === "/embed" || pathname.startsWith("/embed/")) return true;
  /** Iframe «Histórico de decisões» (embed) chama isto; mesmo racional que o HTML /embed — sem Basic no fetch. */
  if (pathname === "/api/client/recommendations-history") return true;
  return false;
}

export function middleware(req: NextRequest) {
  const pathname = req.nextUrl.pathname;

  /**
   * Dev + Turbopack: rewrites em `next.config.js` para 127.0.0.1:5000 são pouco fiáveis.
   * O middleware faz `rewrite` explícito para o Flask KPI (`npm run kpi`).
   */
  if (process.env.NODE_ENV === "development" && (pathname === "/kpi-flask" || pathname.startsWith("/kpi-flask/"))) {
    let suffix = pathname.slice("/kpi-flask".length);
    if (!suffix || suffix === "/") suffix = "/";
    else if (!suffix.startsWith("/")) suffix = `/${suffix}`;
    const target = new URL(`http://127.0.0.1:5000${suffix}`);
    target.search = req.nextUrl.search;
    return NextResponse.rewrite(target);
  }

  /**
   * Produção (ex. Vercel): mesmo padrão que em dev — o iframe usa `NEXT_PUBLIC_KPI_EMBED_BASE=/kpi-flask` e o
   * middleware encaminha para o `kpi_server` público. Defina `KPI_EMBED_UPSTREAM` com URL absoluta (https://…)
   * do serviço Flask (build alinhado ao repo — regras de vol / perfil como em local).
   */
  const kpiUpstreamProd = (process.env.KPI_EMBED_UPSTREAM || "").trim();
  if (
    process.env.NODE_ENV !== "development" &&
    kpiUpstreamProd &&
    (pathname === "/kpi-flask" || pathname.startsWith("/kpi-flask/"))
  ) {
    let suffix = pathname.slice("/kpi-flask".length);
    if (!suffix || suffix === "/") suffix = "/";
    else if (!suffix.startsWith("/")) suffix = `/${suffix}`;
    const base = kpiUpstreamProd.replace(/\/+$/, "");
    try {
      const target = new URL(suffix, `${base}/`);
      target.search = req.nextUrl.search;
      return NextResponse.rewrite(target);
    } catch {
      return NextResponse.next();
    }
  }

  if (isSiteGateBypass(pathname)) {
    return NextResponse.next();
  }

  const pass = gatePassword();
  if (!pass) {
    return NextResponse.next();
  }

  const inDev = process.env.NODE_ENV === "development";
  if (inDev && process.env.SITE_GATE_IN_DEV !== "1") {
    return NextResponse.next();
  }

  const auth = req.headers.get("authorization");
  if (auth) {
    const [scheme, encoded] = auth.split(" ");
    if (scheme === "Basic" && encoded) {
      try {
        const decoded = atob(encoded);
        const colon = decoded.indexOf(":");
        if (colon >= 0) {
          const u = decoded.slice(0, colon);
          const p = decoded.slice(colon + 1);
          if (u === gateUser() && p === pass) {
            return NextResponse.next();
          }
        }
      } catch {
        // credencial inválida
      }
    }
  }

  return new NextResponse("Autenticação necessária.", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="Decide"',
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
}

export const config = {
  /**
   * Não aplicar o gate a ficheiros Next (_next/static, _next/image) nem favicon.
   * Caso contrário, sem Basic Auth o browser não carrega JS/CSS e a página parece “erro” em branco.
   */
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
