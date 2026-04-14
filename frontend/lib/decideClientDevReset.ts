/**
 * Reset local (localStorage / sessionStorage) para testes no Plano — **não** apaga dados no servidor.
 * O painel no Plano fica **visível por defeito** (dev, preview e produção). Para ocultar: `NEXT_PUBLIC_DECIDE_PLANO_DEV_RESET=0`.
 */

import { ORDER_ACTIVITY_CHANGED_EVENT } from "./clientOrderActivityLog";
import { CLIENT_SESSION_CHANGED_EVENT } from "./clientAuth";
import { LS_MIFID_FIELDS, LS_RISK_PROFILE } from "./decideOnboardingRiskProfile";
import { ONBOARDING_FLOW_MAX_IDX_KEY } from "./onboardingFlowState";
import {
  ONBOARDING_LOCALSTORAGE_CHANGED_EVENT,
  ONBOARDING_MONTANTE_KEY,
  ONBOARDING_STORAGE_KEYS,
} from "../components/OnboardingFlowBar";

const IBKR_PREP_DONE_KEY = "decide_onboarding_ibkr_prep_done_v1";

const EXTRA_LS_KEYS = [
  LS_RISK_PROFILE,
  LS_MIFID_FIELDS,
  "decide_fx_hedge_prefs_v1",
  "decide_kyc_manual_review_pending_v1",
  "decide_persona_verified_full_name_v1",
  "decide_client_order_activity_v1",
] as const;

/**
 * Visibilidade do painel (build-time): **ligado por defeito**; só `NEXT_PUBLIC_DECIDE_PLANO_DEV_RESET=0` desliga.
 */
export function isDecidePlanoDevResetEnabled(): boolean {
  const v = (process.env.NEXT_PUBLIC_DECIDE_PLANO_DEV_RESET || "").trim().toLowerCase();
  if (v === "0" || v === "false" || v === "off" || v === "no") return false;
  return true;
}

/**
 * Visibilidade no browser após o mount: alinhada a `isDecidePlanoDevResetEnabled` (mesma env).
 * Opcional: `?decideDevReset=1` não é necessário com o novo defeito, mas mantém-se como documentação de atalho.
 */
export function isDecidePlanoDevResetVisibleInBrowser(): boolean {
  if (typeof window === "undefined") return false;
  const v = (process.env.NEXT_PUBLIC_DECIDE_PLANO_DEV_RESET || "").trim().toLowerCase();
  if (v === "0" || v === "false" || v === "off" || v === "no") return false;
  try {
    const q = new URLSearchParams(window.location.search);
    const flag = q.get("decideDevReset") || q.get("planoDevReset");
    if (flag === "1" || String(flag || "").toLowerCase() === "true") return true;
  } catch {
    /* ignore */
  }
  return true;
}

/**
 * Limpa passos de onboarding, montante, MiFID/KYC em cache, hedge, prep IBKR, aprovação do plano,
 * registo de actividade do Plano e o índice do stepper na sessão.
 *
 * @param options.logout — também remove a sessão demo (`decide_client_session_*`) e redirecciona para login se `redirectToLogin` for true.
 */
export function clearDecideClientLocalTestState(options?: {
  logout?: boolean;
  redirectToLogin?: boolean;
}): void {
  if (typeof window === "undefined") return;

  const stepKeys = [
    ONBOARDING_STORAGE_KEYS.onboarding,
    ONBOARDING_STORAGE_KEYS.mifid,
    ONBOARDING_STORAGE_KEYS.kyc,
    ONBOARDING_STORAGE_KEYS.approve,
    ONBOARDING_STORAGE_KEYS.hedge,
  ].filter(Boolean);

  for (const k of stepKeys) {
    try {
      window.localStorage.removeItem(k);
    } catch {
      /* ignore */
    }
  }

  for (const k of [ONBOARDING_MONTANTE_KEY, IBKR_PREP_DONE_KEY, ...EXTRA_LS_KEYS]) {
    try {
      window.localStorage.removeItem(k);
    } catch {
      /* ignore */
    }
  }

  try {
    window.sessionStorage.removeItem(ONBOARDING_FLOW_MAX_IDX_KEY);
  } catch {
    /* ignore */
  }

  if (options?.logout) {
    try {
      window.localStorage.removeItem("decide_client_session_ok");
      window.localStorage.removeItem("decide_client_session_user");
    } catch {
      /* ignore */
    }
    try {
      window.dispatchEvent(new Event(CLIENT_SESSION_CHANGED_EVENT));
    } catch {
      /* ignore */
    }
  }

  try {
    window.dispatchEvent(new Event(ONBOARDING_LOCALSTORAGE_CHANGED_EVENT));
  } catch {
    /* ignore */
  }
  try {
    window.dispatchEvent(new Event(ORDER_ACTIVITY_CHANGED_EVENT));
  } catch {
    /* ignore */
  }

  if (options?.redirectToLogin && options?.logout) {
    try {
      window.location.assign("/client/login");
    } catch {
      /* ignore */
    }
  }
}
