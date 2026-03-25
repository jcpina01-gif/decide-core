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
  if (pathname.startsWith("/client/verify-email")) return true;
  if (pathname.startsWith("/api/client/email-verification/")) return true;
  /** OTP SMS no registo — mesmo racional que o email (fetch pode não levar credenciais Basic em alguns clientes). */
  if (pathname.startsWith("/api/client/phone-verification/")) return true;
  return false;
}

export function middleware(req: NextRequest) {
  if (isSiteGateBypass(req.nextUrl.pathname)) {
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
