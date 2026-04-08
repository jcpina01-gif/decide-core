import Link from "next/link";
import { useRouter } from "next/router";
import type { LucideIcon } from "lucide-react";
import { Activity, BookOpen, Briefcase, FileText, LayoutDashboard } from "lucide-react";
import { useEffect, useState } from "react";
import InlineLoadingDots from "./InlineLoadingDots";

const STROKE = 2;

/** Navegação principal cliente — ícone outline + texto (Lucide). «Depositar Fundos» fica à direita na mesma linha (`DecideLogoHeader`). */
export const CLIENT_MAIN_NAV_ITEMS: { href: string; label: string; icon: LucideIcon }[] = [
  { href: "/client/como-funciona", label: "Como funciona", icon: BookOpen },
  { href: "/client-dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/client/carteira", label: "Carteira", icon: Briefcase },
  { href: "/client/report", label: "Plano", icon: FileText },
  { href: "/client/atividade", label: "Atividade", icon: Activity },
];

/** Export para IBKR menu / CTAs — mesmo destino que antes no nav inline. */
export const CLIENT_FUND_ACCOUNT_HREF = "/client/fund-account";

/** Início do fluxo de onboarding (conta → montante → MiFID → …). */
export const CLIENT_ONBOARDING_START_HREF = "/client/register";

function navActive(pathname: string, href: string): boolean {
  if (href === "/client-dashboard") return pathname === "/client-dashboard";
  if (href === "/client/como-funciona") return pathname === "/client/como-funciona";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Caminho sem query — `routeChangeStart` pode incluir `?…`. */
function pathOnlyFromRouteUrl(url: string): string {
  if (url.startsWith("http://") || url.startsWith("https://")) {
    try {
      return new URL(url).pathname || url;
    } catch {
      /* fall through */
    }
  }
  const q = url.indexOf("?");
  return q >= 0 ? url.slice(0, q) : url;
}

function navItemMatchesPendingUrl(href: string, pendingRaw: string | null): boolean {
  if (!pendingRaw) return false;
  const pending = pathOnlyFromRouteUrl(pendingRaw);
  if (pending === href) return true;
  if (href === "/client-dashboard") return pending === "/client-dashboard";
  if (href === "/client/como-funciona") return pending === "/client/como-funciona";
  return pending.startsWith(`${href}/`);
}

type Props = {
  /** Secções compactas (ex.: `DecideClientShell`). */
  dense?: boolean;
  /** Segunda linha do header — padding mínimo (evita «buraco» vertical). */
  headerStrip?: boolean;
};

export default function ClientMainNav({ dense, headerStrip }: Props) {
  const router = useRouter();
  const pathname = router.pathname || "";
  const [pendingRouteUrl, setPendingRouteUrl] = useState<string | null>(null);
  const iconSize = dense ? 18 : headerStrip ? 16 : 22;

  useEffect(() => {
    const onStart = (url: string) => setPendingRouteUrl(url);
    const onEnd = () => setPendingRouteUrl(null);
    router.events?.on("routeChangeStart", onStart);
    router.events?.on("routeChangeComplete", onEnd);
    router.events?.on("routeChangeError", onEnd);
    return () => {
      router.events?.off("routeChangeStart", onStart);
      router.events?.off("routeChangeComplete", onEnd);
      router.events?.off("routeChangeError", onEnd);
    };
  }, [router]);

  const navPadding = dense
    ? "6px 0"
    : headerStrip
      ? "0 clamp(6px, 2vw, 16px) 0"
      : "10px clamp(12px, 2.2vw, 24px) 12px";

  const navClass = [
    "decide-app-main-nav",
    headerStrip ? "decide-app-main-nav--header-strip" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <nav
      aria-label="Navegação principal cliente"
      style={{
        width: "100%",
        boxSizing: "border-box",
        padding: navPadding,
        borderTop: dense ? "none" : "none",
        background: dense ? "transparent" : "transparent",
      }}
    >
      <div className={navClass} style={{ justifyContent: dense ? "center" : "center" }}>
        {CLIENT_MAIN_NAV_ITEMS.map(({ href, label, icon: Icon }) => {
          const active = navActive(pathname, href);
          const pendingHere = navItemMatchesPendingUrl(href, pendingRouteUrl);
          return (
            <Link
              key={href}
              href={href}
              data-active={active ? "true" : "false"}
              aria-busy={pendingHere}
              style={{
                padding: dense ? "8px 12px" : headerStrip ? "2px 6px" : "10px 16px",
                fontSize: dense ? 13 : headerStrip ? 12 : 15,
                fontWeight: 600,
                cursor: pendingHere ? "wait" : undefined,
              }}
            >
              <span className="decide-app-main-nav-icon-wrap" aria-hidden>
                <Icon width={iconSize} height={iconSize} strokeWidth={STROKE} />
              </span>
              <span className="decide-app-main-nav-text">
                {label}
                {pendingHere ? (
                  <span
                    style={{
                      marginLeft: 5,
                      display: "inline-flex",
                      alignItems: "center",
                      verticalAlign: "middle",
                      opacity: 0.92,
                    }}
                  >
                    <InlineLoadingDots minWidth="0.95em" style={{ fontSize: "0.92em" }} />
                  </span>
                ) : null}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
