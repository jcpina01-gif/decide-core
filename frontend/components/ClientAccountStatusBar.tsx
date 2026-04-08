import { useEffect, useState } from "react";
import ClientFundDepositNavLink from "./ClientFundDepositNavLink";
import { FUNDING_STATUS_LS_KEY, type FundingStatus, readFundingStatus } from "../lib/fundingFlow";
import { ONBOARDING_LOCALSTORAGE_CHANGED_EVENT, ONBOARDING_MONTANTE_KEY } from "./OnboardingFlowBar";

function formatEur(n: number): string {
  return new Intl.NumberFormat("pt-PT", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(n);
}

function fundingLabel(s: FundingStatus): string {
  switch (s) {
    case "transferred":
      return "Transferência indicada — aguardar liquidação";
    case "received":
      return "Fundos indicados como recebidos";
    default:
      return "A aguardar fundos / confirmação";
  }
}

/**
 * Faixa curta: investimento indicado + estado de financiamento (local).
 * Saldo real na IBKR continua a ser na corretora — evita prometer números que não temos em tempo real.
 */
export default function ClientAccountStatusBar() {
  const [mounted, setMounted] = useState(false);
  const [funding, setFunding] = useState<FundingStatus>("awaiting");
  const [montanteEur, setMontanteEur] = useState<number | null>(null);

  useEffect(() => {
    setMounted(true);
    const sync = () => {
      try {
        setFunding(readFundingStatus());
        const raw = window.localStorage.getItem(ONBOARDING_MONTANTE_KEY);
        const n = raw != null ? Math.round(Number(String(raw).replace(/\s/g, ""))) : NaN;
        setMontanteEur(Number.isFinite(n) && n >= 5000 ? n : null);
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

  if (!mounted) return null;

  return (
    <div
      role="status"
      style={{
        width: "100%",
        boxSizing: "border-box",
        padding: "6px clamp(12px, 2.2vw, 24px)",
        borderBottom: "1px solid rgba(63, 63, 70, 0.35)",
        background: "rgba(24, 24, 27, 0.92)",
        fontSize: 12,
        lineHeight: 1.45,
        color: "#d4d4d8",
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        justifyContent: "center",
        gap: "8px 16px",
      }}
    >
      <span>
        <strong style={{ color: "#f1f5f9", fontWeight: 700 }}>Investimento indicado:</strong>{" "}
        {montanteEur != null ? formatEur(montanteEur) : "—"}
      </span>
      <span style={{ color: "#71717a" }} aria-hidden>
        ·
      </span>
      <span>
        <strong style={{ color: "#f1f5f9", fontWeight: 700 }}>Depósito (app):</strong> {fundingLabel(funding)}
      </span>
      <span style={{ color: "#71717a" }} aria-hidden>
        ·
      </span>
      <ClientFundDepositNavLink
        href="/client/fund-account"
        style={{ color: "#d4d4d4", fontWeight: 700, textDecoration: "underline", textUnderlineOffset: 3 }}
      >
        Ver / actualizar depósito
      </ClientFundDepositNavLink>
      <span style={{ fontSize: 11, color: "#71717a" }}>
        (estado local <code style={{ color: "#a1a1aa" }}>{FUNDING_STATUS_LS_KEY}</code>)
      </span>
    </div>
  );
}
