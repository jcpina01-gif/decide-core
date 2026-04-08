import type { CSSProperties } from "react";
import { useMemo } from "react";
import ClientPendingTextLink from "./ClientPendingTextLink";
import { DECIDE_DASHBOARD } from "../lib/decideClientTheme";
import { FUND_DEPOSIT_BLOCKED_EXPLANATION, getNextOnboardingHref } from "../lib/onboardingProgress";

type Props = {
  open: boolean;
  onClose: () => void;
};

export default function ClientFundDepositBlockedDialog({ open, onClose }: Props) {
  const nextHref = useMemo(() => (typeof window !== "undefined" ? getNextOnboardingHref() : "/client-montante"), [open]);

  if (!open) return null;

  const btnStyle: CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 12,
    padding: "12px 18px",
    fontWeight: 800,
    fontSize: 14,
    textDecoration: "none",
    background: DECIDE_DASHBOARD.buttonRegister,
    color: DECIDE_DASHBOARD.kpiMenuMainButtonColor,
    border: DECIDE_DASHBOARD.kpiMenuMainButtonBorder,
    boxShadow: DECIDE_DASHBOARD.kpiMenuMainButtonShadow,
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="fund-deposit-blocked-title"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 10050,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
        background: "rgba(0,0,0,0.72)",
        boxSizing: "border-box",
      }}
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
    >
      <div
        style={{
          maxWidth: 520,
          width: "100%",
          borderRadius: 16,
          padding: "22px 22px 18px",
          background: "linear-gradient(180deg, rgba(39,39,42,0.99) 0%, rgba(24,24,27,0.99) 100%)",
          border: "1px solid rgba(82, 82, 91, 0.55)",
          boxShadow: "0 24px 60px rgba(0,0,0,0.55)",
          boxSizing: "border-box",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2
          id="fund-deposit-blocked-title"
          style={{ margin: "0 0 12px 0", fontSize: 18, fontWeight: 900, color: "#fafafa", lineHeight: 1.25 }}
        >
          Registo incompleto
        </h2>
        <p style={{ margin: "0 0 18px 0", fontSize: 13, lineHeight: 1.55, color: "#d4d4d8" }}>
          {FUND_DEPOSIT_BLOCKED_EXPLANATION}
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, justifyContent: "flex-end" }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              borderRadius: 10,
              padding: "10px 16px",
              fontWeight: 700,
              fontSize: 13,
              cursor: "pointer",
              border: "1px solid rgba(113,113,122,0.6)",
              background: "transparent",
              color: "#e4e4e7",
            }}
          >
            Fechar
          </button>
          <ClientPendingTextLink href={nextHref} style={btnStyle} onClick={onClose}>
            Continuar o registo
          </ClientPendingTextLink>
        </div>
      </div>
    </div>
  );
}
