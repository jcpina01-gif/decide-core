/** Alinhado com `ONBOARDING_STORAGE_KEYS` em OnboardingFlowBar (sem import lib→components). */
const LS = {
  onboarding: "decide_onboarding_step1_done",
  mifid: "decide_onboarding_step2_done",
  kyc: "decide_onboarding_step3_done",
  approve: "decide_onboarding_step4_done",
} as const;

/**
 * Próximo destino no funil (client-side, após login).
 * Ordem: Valor → MiFID → Identidade → Corretora → dashboard.
 */
export function getNextOnboardingHref(): string {
  if (typeof window === "undefined") return "/client-montante";
  try {
    const authOk = window.localStorage.getItem("decide_client_session_ok") === "1";
    if (!authOk) return "/client/login";

    const onboardingDone = window.localStorage.getItem(LS.onboarding) === "1";
    const mifidDone = window.localStorage.getItem(LS.mifid) === "1";
    const kycDone = window.localStorage.getItem(LS.kyc) === "1";
    const approveDone = window.localStorage.getItem(LS.approve) === "1";

    if (!onboardingDone) return "/client-montante";
    if (!mifidDone) return "/mifid-test";
    if (!kycDone) return "/persona-onboarding";
    if (!approveDone) return "/client/ibkr-prep";
    return "/client-dashboard";
  } catch {
    return "/client-montante";
  }
}

/** Onboarding regulamentar concluído (todos os passos gravados). */
export function isOnboardingFlowComplete(): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (window.localStorage.getItem("decide_client_session_ok") !== "1") return false;
    return (
      window.localStorage.getItem(LS.onboarding) === "1" &&
      window.localStorage.getItem(LS.mifid) === "1" &&
      window.localStorage.getItem(LS.kyc) === "1" &&
      window.localStorage.getItem(LS.approve) === "1"
    );
  } catch {
    return false;
  }
}
