import { useEffect, useRef, useState, type CSSProperties } from "react";
import ClientPendingTextLink from "./ClientPendingTextLink";
import ClientFundDepositNavLink from "./ClientFundDepositNavLink";
import { FUNDING_STATUS_LS_KEY, type FundingStatus, readFundingStatus } from "../lib/fundingFlow";
import { ONBOARDING_LOCALSTORAGE_CHANGED_EVENT } from "./OnboardingFlowBar";

function fundingDotColor(s: FundingStatus): string {
  switch (s) {
    case "received":
      return "#d4d4d4";
    case "transferred":
      return "#a3a3a3";
    default:
      return "#a3a3a3";
  }
}

function fundingShortLabel(s: FundingStatus): string {
  switch (s) {
    case "transferred":
      return "Liquidação pendente";
    case "received":
      return "Fundos indicados";
    default:
      return "A aguardar fundos";
  }
}

const menuPanelStyle: CSSProperties = {
  position: "absolute",
  right: 0,
  top: "100%",
  marginTop: 8,
  minWidth: 228,
  padding: 8,
  borderRadius: 10,
  background: "rgba(24, 24, 27, 0.98)",
  border: "1px solid rgba(255, 255, 255, 0.12)",
  boxShadow: "0 12px 32px rgba(0,0,0,0.45)",
  zIndex: 200,
  display: "flex",
  flexDirection: "column",
  gap: 4,
};

const menuItemLink: CSSProperties = {
  display: "flex",
  alignItems: "center",
  padding: "10px 12px",
  borderRadius: 8,
  fontSize: 13,
  fontWeight: 600,
  color: "var(--text-primary)",
  textDecoration: "none",
};

type ClientIbkrMenuProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/**
 * IBKR + estado de fundos + atalhos num único menu (substitui pílulas soltas no header).
 */
export default function ClientIbkrMenu({ open, onOpenChange }: ClientIbkrMenuProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);
  const [funding, setFunding] = useState<FundingStatus>("awaiting");

  useEffect(() => {
    setMounted(true);
    const sync = () => {
      try {
        setFunding(readFundingStatus());
      } catch {
        /* ignore */
      }
    };
    sync();
    window.addEventListener(ONBOARDING_LOCALSTORAGE_CHANGED_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(ONBOARDING_LOCALSTORAGE_CHANGED_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        onOpenChange(false);
      }
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open, onOpenChange]);

  return (
    <div ref={wrapRef} style={{ position: "relative", display: "inline-flex" }}>
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => onOpenChange(!open)}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          minHeight: 30,
          borderRadius: 8,
          border: "1px solid rgba(255, 255, 255, 0.12)",
          background: "rgba(255, 255, 255, 0.04)",
          color: "#a1a1aa",
          fontSize: 11,
          fontWeight: 800,
          letterSpacing: "0.06em",
          cursor: "pointer",
          padding: "4px 10px",
          fontFamily: "ui-monospace, monospace",
        }}
        title="Conta Interactive Brokers"
      >
        IBKR
        <span aria-hidden style={{ fontSize: 11, opacity: 0.85, lineHeight: 1 }}>
          ▾
        </span>
      </button>
      {open ? (
        <div role="menu" style={menuPanelStyle}>
          {mounted ? (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "8px 10px 10px",
                borderBottom: "1px solid rgba(255,255,255,0.08)",
                marginBottom: 2,
              }}
              title={`Estado local (${FUNDING_STATUS_LS_KEY})`}
            >
              <span
                aria-hidden
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: 999,
                  background: fundingDotColor(funding),
                  flexShrink: 0,
                }}
              />
              <span style={{ fontSize: 11, fontWeight: 600, color: "#d4d4d8", lineHeight: 1.3 }}>
                {fundingShortLabel(funding)}
              </span>
            </div>
          ) : (
            <div style={{ padding: "6px 10px", fontSize: 11, color: "#71717a" }} aria-hidden>
              ···
            </div>
          )}
          <ClientFundDepositNavLink
            href="/client/fund-account"
            role="menuitem"
            style={menuItemLink}
            onClick={() => onOpenChange(false)}
          >
            Depositar Fundos
          </ClientFundDepositNavLink>
          <ClientPendingTextLink
            href="/client-montante"
            role="menuitem"
            style={menuItemLink}
            onClick={() => onOpenChange(false)}
          >
            Ver conta
          </ClientPendingTextLink>
        </div>
      ) : null}
    </div>
  );
}
