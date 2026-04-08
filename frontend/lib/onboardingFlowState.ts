export type OnboardingStepId = "auth" | "onboarding" | "mifid" | "kyc" | "approve" | "hedge";

/** Índice 0-based no array de passos do `OnboardingFlowBar`. Sincronizado com cliques e avanços. */
export const ONBOARDING_FLOW_MAX_IDX_KEY = "decide_onboarding_flow_max_idx_v1";

import { isFxHedgeOnboardingApplicable } from "./clientSegment";

const AUTH_OK_KEY = "decide_client_session_ok";
const HEDGE_DONE_KEY = "decide_onboarding_step5_hedge_done";

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
 * auth=0, onboarding=1, mifid=2, kyc=3, approve=4, hedge=5. -1 = não autenticado.
 */
export function inferMaxCompletedIndexFromLocalStorage(): number {
  if (typeof window === "undefined") return -1;
  try {
    if (window.localStorage.getItem(AUTH_OK_KEY) !== "1") return -1;
    if (!readLsFlag("decide_onboarding_step1_done")) return 0;
    let max = 1;
    if (readLsFlag("decide_onboarding_step2_done")) max = 2;
    /** Passos à frente no LS implicam progressão — evita «buracos» (ex.: step3 sem step2) e stepper desalinhado. */
    const kycDone = readLsFlag("decide_onboarding_step3_done");
    if (kycDone) max = Math.max(max, 3);
    /** Ordem no stepper: KYC → hedge (se aplicável) → Corretora/aprovação. */
    const hedgeApplicable = isFxHedgeOnboardingApplicable();
    const hedgeDone = window.localStorage.getItem(HEDGE_DONE_KEY) === "1";
    const hedgeResolved = !hedgeApplicable || hedgeDone;
    if (kycDone && hedgeResolved) max = Math.max(max, 4);
    if (readLsFlag("decide_onboarding_step4_done") && kycDone && hedgeResolved) max = Math.max(max, 5);
    return max;
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
    if (typeof window === "undefined") return;
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

