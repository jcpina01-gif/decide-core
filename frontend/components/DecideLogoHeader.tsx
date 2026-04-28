import Link from "next/link";
import { useRouter } from "next/router";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { LogOut, Settings, User } from "lucide-react";
import {
  CLIENT_SESSION_CHANGED_EVENT,
  getCurrentSessionUser,
  isClientLoggedIn,
  logoutClient,
} from "../lib/clientAuth";
import ClientIbkrMenu from "./ClientIbkrMenu";
import ClientHedgeMicroLine from "./ClientHedgeMicroLine";
import ClientMainNav from "./ClientMainNav";
import ClientPendingTextLink from "./ClientPendingTextLink";
import ClientFundDepositNavLink from "./ClientFundDepositNavLink";

/**
 * **«Imagem final do logo Decide»** — `public/images/imagem-final-logo-decide.png` (RGBA).
 * Sincronizar: `scripts/copy-imagem-final-logo.ps1 -Source "<caminho\\Imagem final do logo Decide.png>"`
 * ou cópia manual; o build não inclui o ficheiro das pastas do Cursor — tem de estar em `public/images`.
 */
export const DECIDE_LOGO_SRC = "/images/imagem-final-logo-decide.png?v=13";

/** Dimensões em pixels do PNG (largura × altura). Alinhar ao ficheiro real. */
export const DECIDE_LOGO_INTRINSIC_WIDTH = 1024;
export const DECIDE_LOGO_INTRINSIC_HEIGHT = 682;

/** @deprecated — alias para compat. */
export const DECIDE_LOGO_SRC_2X = DECIDE_LOGO_SRC;

/** Fundo da barra do logo — transparente para o PNG integrar no fundo da página. */
export const DECIDE_HEADER_LOGO_BAR_BG = "transparent";

/** Barra de identidade compacta — layout compacto; escala visual extra no CSS (`decide-top-header--app`). */
export const DECIDE_HEADER_LOGO_HEIGHT = "clamp(80px, 13.5vw, 200px)";
export const DECIDE_HEADER_LOGO_MAX_WIDTH = "min(94vw, 1080px)";

/** Landing: hero sóbrio — escala moderada (evita «poster» promocional). */
export const DECIDE_LANDING_LOGO_HEIGHT = "clamp(132px, 22vw, 220px)";
export const DECIDE_LANDING_LOGO_MAX_WIDTH = "min(92vw, 640px)";

/**
 * Fallback para `paddingTop` antes do `ResizeObserver`.
 * Logo ~148px + padding vertical + borda.
 */
/** Referência aproximada para layouts (nav + hero KPI + hedge); ajustar se mudar o header. */
export const DECIDE_TOP_BAR_HEIGHT_PX = 128;

/** Largura útil opcional para conteúdo. */
export const DECIDE_HEADER_INNER_MAX_WIDTH_PX = 1400;

type DecideBrandImageProps = {
  priority?: boolean;
  height?: number | string;
  maxWidth?: number | string;
  className?: string;
  style?: CSSProperties;
  /** Lockup monocromático branco (#FFFFFF) sobre fundo escuro — `brightness(0) invert(1)`. */
  whiteLockup?: boolean;
  /**
   * Largura de exibição esperada (responsive) — melhora a escolha de densidade em ecrãs HiDPI.
   * Ex.: `(max-width: 830px) 94vw, 780px` no header.
   */
  sizes?: string;
  /**
   * Quando `true` (default), aplica máscara CSS (luminância) para remover caixa escura em PNGs opacos.
   * Defina `false` se o logótipo ficar com aspeto errado.
   */
  knockoutBackground?: boolean;
};

export function DecideBrandImage({
  priority,
  height = 40,
  maxWidth = "min(90vw, 320px)",
  className,
  style,
  whiteLockup,
  sizes = "(max-width: 900px) 96vw, 820px",
  knockoutBackground = true,
}: DecideBrandImageProps) {
  const maxH = typeof height === "number" ? `${height}px` : height;
  const maxW = typeof maxWidth === "number" ? `${maxWidth}px` : maxWidth;
  const src = DECIDE_LOGO_SRC;
  const iw = DECIDE_LOGO_INTRINSIC_WIDTH;
  const ih = DECIDE_LOGO_INTRINSIC_HEIGHT;
  const logoPath = src.split("?")[0] || "";
  const isSvg = logoPath.endsWith(".svg");
  const srcSet = isSvg ? undefined : `${DECIDE_LOGO_SRC.split("?")[0]} ${iw}w`;

  const imgClass = [
    "decide-logo-img",
    knockoutBackground ? "" : "decide-logo-img--plain",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <img
      src={src}
      srcSet={srcSet}
      sizes={isSvg ? undefined : sizes}
      alt="DECIDE"
      className={imgClass}
      width={iw}
      height={ih}
      // Atributo HTML real é `fetchpriority` (minúsculas); `fetchPriority` em camelCase avisa no React 18.
      {...(priority ? { fetchpriority: "high" as const } : {})}
      style={{
        display: "block",
        maxHeight: maxH,
        maxWidth: maxW,
        width: "auto",
        height: "auto",
        ...(whiteLockup ? { filter: "brightness(0) invert(1)" } : {}),
        ...style,
      }}
      loading={priority ? "eager" : "lazy"}
      decoding={priority ? "sync" : "async"}
    />
  );
}

/** Lockup com escala CSS (sem overlay de recolor — evitava artefactos tipo faixa branca no topo). */
export function DecideLogoLockupEmbeddedRecolor({
  priority,
  sizes,
  variant,
}: {
  priority?: boolean;
  sizes: string;
  variant: "header" | "landing";
}) {
  const scaleClass = `decide-logo-lockup-scale decide-logo-lockup-scale--${variant}`;
  const heightProp = variant === "header" ? DECIDE_HEADER_LOGO_HEIGHT : DECIDE_LANDING_LOGO_HEIGHT;
  const maxWProp = variant === "header" ? DECIDE_HEADER_LOGO_MAX_WIDTH : DECIDE_LANDING_LOGO_MAX_WIDTH;

  return (
    <div className={scaleClass}>
      <DecideBrandImage
        priority={priority}
        height={heightProp}
        maxWidth={maxWProp}
        sizes={sizes}
        knockoutBackground={false}
        className="decide-logo-img--plain"
      />
    </div>
  );
}

/** CTA secundário no header (registo / login). */
export const decideHeaderNavLinkStyle: CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: "var(--text-secondary)",
  textDecoration: "none",
  padding: "5px 11px",
  borderRadius: 8,
  border: "1px solid rgba(255, 255, 255, 0.1)",
  background: "rgba(255, 255, 255, 0.04)",
  lineHeight: 1.2,
  whiteSpace: "nowrap",
};

const accountMenuPanelStyle: CSSProperties = {
  position: "absolute",
  right: 0,
  top: "100%",
  marginTop: 8,
  minWidth: 220,
  padding: 8,
  borderRadius: 10,
  background: "rgba(24, 24, 27, 0.98)",
  border: "1px solid rgba(255, 255, 255, 0.12)",
  boxShadow: "0 12px 32px rgba(0,0,0,0.45)",
  zIndex: 200,
  display: "flex",
  flexDirection: "column",
  gap: 2,
};

const accountMenuItemLink: CSSProperties = {
  display: "block",
  padding: "10px 12px",
  borderRadius: 8,
  fontSize: 14,
  fontWeight: 600,
  color: "var(--text-primary)",
  textDecoration: "none",
};

const accountMenuItemButton: CSSProperties = {
  ...accountMenuItemLink,
  width: "100%",
  textAlign: "left",
  background: "transparent",
  border: "none",
  cursor: "pointer",
  font: "inherit",
  color: "#fecaca",
};

export default function DecideLogoHeader() {
  const router = useRouter();
  const accountWrapRef = useRef<HTMLDivElement>(null);
  const [accountOpen, setAccountOpen] = useState(false);
  const [ibkrOpen, setIbkrOpen] = useState(false);
  const [loggedIn, setLoggedIn] = useState(false);
  const [sessionUser, setSessionUser] = useState("");

  const pathname = router.pathname || "";
  const showClientChrome =
    loggedIn &&
    pathname !== "/" &&
    pathname !== "/client/login" &&
    !pathname.startsWith("/client/register");

  const syncSession = () => {
    if (typeof window === "undefined") return;
    setLoggedIn(isClientLoggedIn());
    setSessionUser(getCurrentSessionUser() || "");
  };

  useEffect(() => {
    syncSession();
    window.addEventListener(CLIENT_SESSION_CHANGED_EVENT, syncSession);
    return () => window.removeEventListener(CLIENT_SESSION_CHANGED_EVENT, syncSession);
  }, []);

  useEffect(() => {
    if (!accountOpen) return;
    const close = (e: MouseEvent) => {
      if (accountWrapRef.current && !accountWrapRef.current.contains(e.target as Node)) {
        setAccountOpen(false);
      }
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [accountOpen]);

  const logoHref = loggedIn ? "/client-dashboard" : "/";

  return (
    <header
      className="decide-top-header decide-top-header--app"
      style={{
        position: "sticky",
        top: 0,
        zIndex: 100,
        boxSizing: "border-box",
        width: "100%",
        background: "transparent",
        backgroundColor: "rgba(0,0,0,0)",
        padding: 0,
        margin: 0,
      }}
    >
      <div
        className="decide-app-header-row"
        style={{
          display: "grid",
          /* Com chrome cliente: linha 1 = logo | conta; linha 2 = menu (sempre abaixo do logo) */
          gridTemplateColumns: showClientChrome ? "minmax(0, 1fr) auto" : "auto minmax(0, 1fr) auto",
          gridTemplateRows: showClientChrome ? "auto auto" : "auto",
          columnGap: showClientChrome ? 8 : 10,
          rowGap: showClientChrome ? 0 : 0,
          alignItems: "start",
          width: "100%",
          padding: "0 6px 0 0",
          boxSizing: "border-box",
        }}
      >
        <Link
          href={logoHref}
          style={{
            display: "inline-flex",
            flexDirection: "column",
            alignItems: "flex-start",
            justifyContent: "flex-start",
            lineHeight: 0,
            flexShrink: 0,
            overflow: "visible",
            alignSelf: "start",
            gridRow: 1,
            gridColumn: 1,
            marginTop: -12,
            marginLeft: -22,
            marginRight: 0,
            marginBottom: 0,
            padding: 0,
            maxWidth: "min(98vw, 1160px)",
          }}
          aria-label="DECIDE — início"
        >
          <DecideBrandImage
            priority
            height={200}
            maxWidth="min(98vw, 1080px)"
            sizes="(max-width: 640px) 96vw, 1080px"
            className="decide-header-brand-mark decide-logo-img--plain decide-logo-img--header-lockup"
            knockoutBackground={false}
          />
        </Link>

        <div
          ref={accountWrapRef}
          style={{
            gridRow: 1,
            gridColumn: showClientChrome ? 2 : 3,
            justifySelf: "end",
            alignSelf: "start",
            paddingTop: 0,
            display: "flex",
            alignItems: "center",
            gap: 10,
            flexWrap: "wrap",
            justifyContent: "flex-end",
            minWidth: 0,
            position: "relative",
          }}
        >
          {loggedIn && showClientChrome ? (
            <ClientIbkrMenu
              open={ibkrOpen}
              onOpenChange={(v) => {
                setIbkrOpen(v);
                if (v) setAccountOpen(false);
              }}
            />
          ) : null}
          {loggedIn ? (
            <>
              <button
                type="button"
                aria-expanded={accountOpen}
                aria-haspopup="menu"
                onClick={() => {
                  setIbkrOpen(false);
                  setAccountOpen((o) => !o);
                }}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  minHeight: 30,
                  borderRadius: 8,
                  border: "1px solid rgba(255, 255, 255, 0.12)",
                  background: "rgba(255, 255, 255, 0.04)",
                  color: "#e4e4e7",
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: "pointer",
                  maxWidth: "min(220px, 100%)",
                  fontFamily: "inherit",
                  boxSizing: "border-box",
                  padding: "4px 10px",
                }}
                title={sessionUser || "Conta"}
              >
                <span
                  style={{
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {sessionUser || "Conta"}
                </span>
                <span aria-hidden style={{ fontSize: 12, opacity: 0.85, lineHeight: 1 }}>
                  ▾
                </span>
              </button>
              {accountOpen ? (
                <div role="menu" style={accountMenuPanelStyle}>
                  <Link
                    href="/client-montante"
                    role="menuitem"
                    style={{ ...accountMenuItemLink, display: "flex", alignItems: "center", gap: 10 }}
                    onClick={() => setAccountOpen(false)}
                  >
                    <User width={16} height={16} strokeWidth={2} aria-hidden />
                    Conta
                  </Link>
                  <Link
                    href="/client/register"
                    role="menuitem"
                    style={{ ...accountMenuItemLink, display: "flex", alignItems: "center", gap: 10 }}
                    onClick={() => setAccountOpen(false)}
                  >
                    <Settings width={16} height={16} strokeWidth={2} aria-hidden />
                    Definições
                  </Link>
                  <button
                    type="button"
                    role="menuitem"
                    style={{ ...accountMenuItemButton, display: "flex", alignItems: "center", gap: 10 }}
                    onClick={() => {
                      setAccountOpen(false);
                      logoutClient();
                      window.location.reload();
                    }}
                  >
                    <LogOut width={16} height={16} strokeWidth={2} aria-hidden />
                    Logout
                  </button>
                </div>
              ) : null}
            </>
          ) : (
            <>
              <Link href="/client/register" style={decideHeaderNavLinkStyle}>
                Registo
              </Link>
              <Link href="/client/login" style={{ ...decideHeaderNavLinkStyle, fontWeight: 700 }}>
                Login
              </Link>
            </>
          )}
        </div>

        {showClientChrome ? (
          <div
            className="decide-app-header-main-nav-wrap"
            style={{
              gridRow: 2,
              gridColumn: "1 / -1",
              minWidth: 0,
              width: "100%",
              paddingTop: 0,
              marginTop: 0,
              /* Compensa logo maior + margem negativa — menu junto ao bloco sem empurrar a página */
              transform: "translateY(-40px)",
              position: "relative",
              zIndex: 2,
              display: "flex",
              justifyContent: "center",
              boxSizing: "border-box",
            }}
          >
            <div
              className="decide-app-header-nav-row"
              style={{
                width: "100%",
                maxWidth: 1100,
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                alignContent: "center",
                gap: "10px 16px",
                flexWrap: "wrap",
                boxSizing: "border-box",
              }}
            >
              <div
                style={{
                  flex: "1 1 220px",
                  display: "flex",
                  justifyContent: "center",
                  minWidth: 0,
                }}
              >
                <ClientMainNav headerStrip />
              </div>
              <ClientFundDepositNavLink
                className="decide-app-header-fund-cta"
                style={{ flexShrink: 0, marginLeft: "auto" }}
              >
                Depositar Fundos
              </ClientFundDepositNavLink>
            </div>
          </div>
        ) : (
          <div aria-hidden style={{ gridRow: 1, gridColumn: 2, minWidth: 0 }} />
        )}
      </div>

      {showClientChrome ? <ClientHedgeMicroLine /> : null}
    </header>
  );
}
