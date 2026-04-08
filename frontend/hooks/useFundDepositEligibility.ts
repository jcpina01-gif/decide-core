import { useEffect, useState } from "react";
import { CLIENT_SESSION_CHANGED_EVENT } from "../lib/clientAuth";
import { isClientEligibleToDepositFunds } from "../lib/onboardingProgress";
import { ONBOARDING_LOCALSTORAGE_CHANGED_EVENT } from "../components/OnboardingFlowBar";

function readEligible(): boolean {
  try {
    return isClientEligibleToDepositFunds();
  } catch {
    return false;
  }
}

/**
 * `true` quando o funil (incl. IBKR prep na app) permite mostrar a página de depósito.
 * Actualiza ao mudar localStorage (mesma aba ou outra).
 */
export function useFundDepositEligibility(): boolean {
  const [ok, setOk] = useState(() => (typeof window !== "undefined" ? readEligible() : false));

  useEffect(() => {
    const sync = () => setOk(readEligible());
    sync();
    window.addEventListener(ONBOARDING_LOCALSTORAGE_CHANGED_EVENT, sync);
    window.addEventListener(CLIENT_SESSION_CHANGED_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(ONBOARDING_LOCALSTORAGE_CHANGED_EVENT, sync);
      window.removeEventListener(CLIENT_SESSION_CHANGED_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  return ok;
}
