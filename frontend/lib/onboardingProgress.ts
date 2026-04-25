import { isFxHedgeOnboardingApplicable } from "./clientSegment";
import { isHedgeOnboardingDone } from "./fxHedgePrefs";

/** Alinhado com `ONBOARDING_STORAGE_KEYS` em OnboardingFlowBar (sem import lib→components). */
const LS = {
  onboarding: "decide_onboarding_step1_done",
  mifid: "decide_onboarding_step2_done",
  kyc: "decide_onboarding_step3_done",
  approve: "decide_onboarding_step4_done",
} as const;

/** Mesma chave que `ibkr-prep.tsx` / `approve.tsx` — preparação IBKR concluída. */
const IBKR_PREP_DONE_KEY = "decide_onboarding_ibkr_prep_done_v1";

/**
 * Próximo destino no funil (client-side, após login).
 * Ordem: Valor → MiFID → Identidade → **Hedge cambial** (se aplicável) → Plano e pagamento (IBKR + Stripe) → Aprovar plano → dashboard.
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
    const ibkrPrepDone = window.localStorage.getItem(IBKR_PREP_DONE_KEY) === "1";

    if (!onboardingDone) return "/client-montante";
    if (!mifidDone) return "/mifid-test";
    if (!kycDone) return "/persona-onboarding";
    /** Antes do passo 6 (plano e pagamento): escolha 0% / 50% / 100% (só segmentos elegíveis). */
    if (isFxHedgeOnboardingApplicable() && !isHedgeOnboardingDone()) return "/client/fx-hedge-onboarding";
    /**
     * `approveDone` = decisão de aprovação do plano gravada.
     * Antes disso: se já passou pelo passo 6 (prep IBKR / subscrição), o passo correcto é **Aprovar plano**,
     * não voltar eternamente a `/client/ibkr-prep`.
     */
    if (!approveDone) {
      return ibkrPrepDone ? "/client/approve" : "/client/ibkr-prep";
    }
    return "/client-dashboard";
  } catch {
    return "/client-montante";
  }
}

/**
 * Após «Aprovação de recomendações» (`/client/approve`): depósito na IBKR.
 * O hedge cambial (quando aplicável) já foi escolhido antes do passo 6 (plano e pagamento) — não voltar a esse passo aqui.
 */
export function getHrefAfterTradePlanApprovalStep(): string {
  return "/client/fund-account?from=approve";
}

/** Onboarding regulamentar concluído (todos os passos gravados). */
export function isOnboardingFlowComplete(): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (window.localStorage.getItem("decide_client_session_ok") !== "1") return false;
    const base =
      window.localStorage.getItem(LS.onboarding) === "1" &&
      window.localStorage.getItem(LS.mifid) === "1" &&
      window.localStorage.getItem(LS.kyc) === "1" &&
      window.localStorage.getItem(LS.approve) === "1";
    if (!base) return false;
    if (isFxHedgeOnboardingApplicable() && !isHedgeOnboardingDone()) return false;
    return true;
  } catch {
    return false;
  }
}

/**
 * Depósitos dirigem-se à conta IBKR do cliente — só faz sentido após registo completo e passo de preparação IBKR na app.
 * (Chave partilhada com `ibkr-prep.tsx` / `approve.tsx`.)
 */
export function isClientEligibleToDepositFunds(): boolean {
  if (typeof window === "undefined") return false;
  if (!isOnboardingFlowComplete()) return false;
  try {
    return window.localStorage.getItem(IBKR_PREP_DONE_KEY) === "1";
  } catch {
    return false;
  }
}

/** Mensagem quando o cliente tenta depositar antes de cumprir o registo (incl. IBKR). */
export const FUND_DEPOSIT_BLOCKED_EXPLANATION =
  "Para depositar fundos tem de concluir o registo na DECIDE: montante a investir, questionário MiFID, verificação de identidade (KYC), preferência de hedge cambial nos KPIs (se a sua conta estiver sujeita a esse passo), preparação e abertura da conta na Interactive Brokers, e aprovação do plano. O dinheiro é transferido para a sua conta na IBKR — só faz sentido depositar depois destes passos. Utilize a barra de progresso do onboarding para continuar.";
