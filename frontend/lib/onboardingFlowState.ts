export type OnboardingStepId = "auth" | "onboarding" | "mifid" | "kyc" | "approve";

/** Índice 0-based no array de passos do `OnboardingFlowBar`. Sincronizado com cliques e avanços. */
export const ONBOARDING_FLOW_MAX_IDX_KEY = "decide_onboarding_flow_max_idx_v1";

const AUTH_OK_KEY = "decide_client_session_ok";

function readLsFlag(key: string): boolean {
  try {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

/**
 * Último índice de passo considerado “concluído” só com base em localStorage (sem session).
 * auth=0, onboarding=1, mifid=2, kyc=3, approve=4. -1 = não autenticado.
 */
export function inferMaxCompletedIndexFromLocalStorage(): number {
  if (typeof window === "undefined") return -1;
  try {
    if (window.localStorage.getItem(AUTH_OK_KEY) !== "1") return -1;
    let max = 0;
    if (!readLsFlag("decide_onboarding_step1_done")) return max;
    max = 1;
    if (!readLsFlag("decide_onboarding_step2_done")) return max;
    max = 2;
    if (!readLsFlag("decide_onboarding_step3_done")) return max;
    max = 3;
    if (!readLsFlag("decide_onboarding_step4_done")) return max;
    return 4;
  } catch {
    return -1;
  }
}

export function readSessionMaxCompletedIndex(): number | null {
  try {
    if (typeof window === "undefined") return null;
    const raw = window.sessionStorage.getItem(ONBOARDING_FLOW_MAX_IDX_KEY);
    if (raw == null || raw === "") return null;
    const n = parseInt(raw, 10);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

export function writeSessionMaxCompletedIndex(n: number): void {
  try {
    window.sessionStorage.setItem(ONBOARDING_FLOW_MAX_IDX_KEY, String(n));
  } catch {
    // ignore
  }
}

/** Ao clicar num passo anterior no stepper: invalida o que vinha à frente. */
export function applyOnboardingBackNavigation(targetIndex: number, currentIndex: number): void {
  if (targetIndex < currentIndex) {
    writeSessionMaxCompletedIndex(targetIndex - 1);
  }
}

/**
 * Sincroniza o máximo da sessão com a página onde o utilizador está e com o LS.
 * Nunca reduz o valor da sessão excepto via `applyOnboardingBackNavigation`.
 */
export function syncSessionMaxWithPage(currentIndex: number): number {
  const lsMax = inferMaxCompletedIndexFromLocalStorage();
  let sm = readSessionMaxCompletedIndex();
  if (sm === null) {
    sm = Math.min(lsMax, Math.max(-1, currentIndex - 1));
  }
  const forwardCap = Math.min(lsMax, currentIndex > 0 ? currentIndex - 1 : -1);
  if (forwardCap > sm) sm = forwardCap;
  writeSessionMaxCompletedIndex(sm);
  return sm;
}

