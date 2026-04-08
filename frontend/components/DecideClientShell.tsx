import Link from "next/link";
import React from "react";
import { DECIDE_DASHBOARD } from "../lib/decideClientTheme";

type Props = {
  children: React.ReactNode;
  /** Barra com atalhos Dashboard / Plano. Em onboarding/registo usar `false` para modo focado. */
  showClientNav?: boolean;
  maxWidth?: number | string;
  padding?: string;
  /** Sobrepõe o fundo zinc liso (ex.: gradiente de onboarding). */
  pageBackground?: string;
  /**
   * CTA fixo ao fundo do ecrã (sempre visível enquanto scrolla). O conteúdo recebe `padding-bottom`
   * automático para não ficar por baixo da barra.
   */
  stickyBottomBar?: React.ReactNode;
  /** Reserva vertical para o conteúdo não ficar oculto atrás de `stickyBottomBar`. Predefinição: 96. */
  stickyBottomReservePx?: number;
};

const navLinkStyle: React.CSSProperties = {
  background: DECIDE_DASHBOARD.linkPillTeal,
  border: DECIDE_DASHBOARD.kpiMenuMainButtonBorder,
  color: "#99f6e4",
  textDecoration: "none",
  borderRadius: 999,
  padding: "8px 14px",
  fontWeight: 700,
  fontSize: 12,
  boxShadow: `${DECIDE_DASHBOARD.buttonShadowSoft}, inset 0 1px 0 rgba(255,255,255,0.06)`,
};

/**
 * Invólucro visual comum à área cliente DECIDE (fundo zinc, fonte Nunito, opcional nav).
 * Usar em onboarding, login, montante, etc. para alinhar com `/client-dashboard`.
 */
export default function DecideClientShell({
  children,
  showClientNav = true,
  maxWidth = 960,
  padding = "24px max(16px, 3vw) 40px",
  pageBackground,
  stickyBottomBar,
  stickyBottomReservePx = 128,
}: Props) {
  const mw = typeof maxWidth === "number" ? `${maxWidth}px` : maxWidth;
  const contentPadBottom = stickyBottomBar ? stickyBottomReservePx : 0;
  return (
    <div
      style={{
        minHeight: "100vh",
        background: pageBackground ?? DECIDE_DASHBOARD.pageBg,
        color: DECIDE_DASHBOARD.text,
        fontFamily: DECIDE_DASHBOARD.fontFamily,
        padding,
        boxSizing: "border-box",
      }}
    >
      {showClientNav ? (
        <nav
          style={{
            maxWidth: mw,
            margin: "0 auto 16px",
            display: "flex",
            flexWrap: "wrap",
            gap: 10,
            alignItems: "center",
            justifyContent: "flex-end",
          }}
          aria-label="Atalhos cliente"
        >
          <Link href="/client-dashboard?skipHedgeGate=1" style={navLinkStyle}>
            Dashboard
          </Link>
          <Link href="/client/report" style={navLinkStyle}>
            Plano
          </Link>
        </nav>
      ) : null}
      <div style={{ maxWidth: mw, margin: "0 auto", paddingBottom: contentPadBottom }}>{children}</div>
      {stickyBottomBar ? (
        <div
          role="region"
          aria-label="Ação principal"
          style={{
            position: "fixed",
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 100,
            display: "flex",
            flexDirection: "column",
            alignItems: "stretch",
            pointerEvents: "none",
          }}
        >
          {/* Faixa de fade curta (~48px): não “come” o conteúdo nem escurece o ecrã inteiro */}
          <div
            aria-hidden
            style={{
              height: 48,
              flexShrink: 0,
              background: "linear-gradient(to top, rgba(9,9,11,0.22) 0%, rgba(9,9,11,0.06) 45%, transparent 100%)",
            }}
          />
          <div
            style={{
              pointerEvents: "auto",
              paddingLeft: "max(16px, 3vw)",
              paddingRight: "max(16px, 3vw)",
              paddingTop: 8,
              paddingBottom: "calc(10px + env(safe-area-inset-bottom, 0px))",
              background: "rgba(9,9,11,0.97)",
              borderTop: "1px solid rgba(63,63,70,0.42)",
              boxShadow: "0 -6px 20px rgba(0,0,0,0.22)",
            }}
          >
            <div style={{ maxWidth: mw, margin: "0 auto", width: "100%", boxSizing: "border-box" }}>{stickyBottomBar}</div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
