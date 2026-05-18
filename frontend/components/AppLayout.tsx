import { useRouter } from "next/router";
import type { ReactNode } from "react";
import { useLayoutEffect, useRef } from "react";
import DecideLogoHeader from "./DecideLogoHeader";

export default function AppLayout({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const router = useRouter();
  const nextRootRef = useRef<HTMLElement | null>(null);
  const isLanding = router.pathname === "/";
  /** Iframes: `/embed/*` e `/fees-client?embed=1` — sem header; o shell pai já mostra logo e menu. */
  const isFeesClientEmbed =
    router.pathname === "/fees-client" && String(router.query.embed ?? "") === "1";
  /** Dashboard v2 tem sidebar própria — sem header global */
  const isDashboardWithOwnNav = router.pathname === "/client-dashboard";
  /** Páginas de onboarding têm o OnboardingFlowBar próprio — sem header global */
  const isOnboardingPage = [
    "/client/register",
    "/client/RegisterForm",
    "/client-montante",
    "/mifid-test",
    "/sumsub-onboarding",
    "/client/fx-hedge-onboarding",
    "/client/ibkr-prep",
    "/client/approve",
    "/client/fund-account",
    "/onboarding",
    "/client/login",
    "/client/verify-email",
  ].includes(router.pathname);
  /** Back-office tem o seu próprio shell com logo e nav — sem header global duplicado */
  const isBackoffice = router.pathname.startsWith("/backoffice");
  const isEmbedChromeless = router.pathname.startsWith("/embed/") || isFeesClientEmbed || isDashboardWithOwnNav || isOnboardingPage || isBackoffice;

  /** Dashboard: impedir scroll no documento — só o <main> da página faz scroll (barra título+config fixa). */
  useLayoutEffect(() => {
    if (!isDashboardWithOwnNav || typeof document === "undefined") return;
    const html = document.documentElement;
    const body = document.body;
    const nextRoot = document.getElementById("__next") as HTMLElement | null;
    nextRootRef.current = nextRoot;

    const snap = {
      htmlOverflow: html.style.overflow,
      htmlHeight: html.style.height,
      bodyOverflow: body.style.overflow,
      bodyHeight: body.style.height,
      nextOverflow: nextRoot?.style.overflow ?? "",
      nextHeight: nextRoot?.style.height ?? "",
      nextMinH: nextRoot?.style.minHeight ?? "",
    };

    html.style.overflow = "hidden";
    html.style.height = "100dvh";
    body.style.overflow = "hidden";
    body.style.height = "100dvh";
    if (nextRoot) {
      nextRoot.style.overflow = "hidden";
      nextRoot.style.height = "100dvh";
      nextRoot.style.minHeight = "0";
    }

    return () => {
      html.style.overflow = snap.htmlOverflow;
      html.style.height = snap.htmlHeight;
      body.style.overflow = snap.bodyOverflow;
      body.style.height = snap.bodyHeight;
      const nr = nextRootRef.current;
      if (nr) {
        nr.style.overflow = snap.nextOverflow;
        nr.style.height = snap.nextHeight;
        nr.style.minHeight = snap.nextMinH;
      }
    };
  }, [isDashboardWithOwnNav]);

  const shellStyle =
    isDashboardWithOwnNav
      ? ({
          boxSizing: "border-box" as const,
          height: "100dvh",
          minHeight: 0,
          maxHeight: "100dvh",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
        } as const)
      : ({
          minHeight: "100%",
          boxSizing: "border-box" as const,
        } as const);

  return (
    <div
      className={[className, !isLanding ? "decide-app-client" : ""].filter(Boolean).join(" ")}
      style={shellStyle}
    >
      {!isLanding && !isEmbedChromeless ? <DecideLogoHeader /> : null}
      {isDashboardWithOwnNav ? (
        <div
          className="flex min-h-0 flex-1 flex-col overflow-hidden"
          style={{ WebkitOverflowScrolling: "touch" }}
        >
          {children}
        </div>
      ) : (
        children
      )}
    </div>
  );
}
