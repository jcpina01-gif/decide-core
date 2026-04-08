import { useEffect, useState } from "react";
import ClientFundDepositNavLink from "./ClientFundDepositNavLink";
import { FUNDING_STATUS_LS_KEY, type FundingStatus, readFundingStatus } from "../lib/fundingFlow";
import { ONBOARDING_LOCALSTORAGE_CHANGED_EVENT } from "./OnboardingFlowBar";

function fundingDotColor(s: FundingStatus): string {
  switch (s) {
    case "received":
      return "#4ade80";
    case "transferred":
      return "#facc15";
    default:
      return "#facc15";
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

/**
 * Estado de financiamento compacto para a barra superior (sem segunda faixa a ocupar altura).
 */
export default function ClientHeaderFundingPill() {
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

  if (!mounted) {
    return (
      <span style={{ fontSize: 11, color: "#71717a" }} aria-hidden>
        ···
      </span>
    );
  }

  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        flexWrap: "wrap",
        maxWidth: 220,
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
      <span style={{ fontSize: 11, fontWeight: 600, color: "#d4d4d8", lineHeight: 1.2 }}>
        {fundingShortLabel(funding)}
      </span>
      <ClientFundDepositNavLink
        href="/client/fund-account"
        style={{
          fontSize: 10,
          fontWeight: 700,
          color: "#d4d4d4",
          textDecoration: "underline",
          textUnderlineOffset: 2,
          whiteSpace: "nowrap",
        }}
      >
        Depositar Fundos
      </ClientFundDepositNavLink>
    </div>
  );
}
