import type { FxHedgePairId } from "./fxHedgePairs";

export type HedgePctOption = 0 | 50 | 100;

export type FxHedgePrefs = {
  /** Par cambial escolhido (ficheiro FX no backend). */
  pair: FxHedgePairId;
  /** 0 = sem hedge nos KPIs ilustrativos; 50 / 100 = nível de neutralização FX na série do modelo. */
  pct: HedgePctOption;
  /** País de residência (ISO-2 ou código interno) para contexto. */
  residenceCountry?: string;
};

const PREFS_KEY = "decide_fx_hedge_prefs_v1";
const STEP_KEY = "decide_onboarding_step5_hedge_done";

export function readFxHedgePrefs(): FxHedgePrefs | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(PREFS_KEY);
    if (!raw) return null;
    const j = JSON.parse(raw) as Partial<FxHedgePrefs>;
    if (!j.pair || (j.pct !== 0 && j.pct !== 50 && j.pct !== 100)) return null;
    return {
      pair: j.pair as FxHedgePairId,
      pct: j.pct,
      residenceCountry: typeof j.residenceCountry === "string" ? j.residenceCountry : undefined,
    };
  } catch {
    return null;
  }
}

export function writeFxHedgePrefs(p: FxHedgePrefs): void {
  try {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  } catch {
    // ignore
  }
}

export function isHedgeOnboardingDone(): boolean {
  try {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(STEP_KEY) === "1";
  } catch {
    return false;
  }
}

export function setHedgeOnboardingDone(done: boolean): void {
  try {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(STEP_KEY, done ? "1" : "0");
  } catch {
    // ignore
  }
}

/** sessionStorage: utilizador abriu o dashboard pelo atalho (?skipHedgeGate=1) — não forçar redirect ao passo hedge. */
export const SKIP_HEDGE_GATE_SESSION_KEY = "decide_skip_hedge_redirect_v1";

export function shouldSkipHedgeGateRedirect(): boolean {
  try {
    if (typeof window === "undefined") return false;
    return sessionStorage.getItem(SKIP_HEDGE_GATE_SESSION_KEY) === "1";
  } catch {
    return false;
  }
}

/** Lê `?skipHedgeGate=1`, grava sessionStorage e remove o query da barra de endereço. */
export function consumeSkipHedgeGateFromUrl(): void {
  if (typeof window === "undefined") return;
  const params = new URLSearchParams(window.location.search);
  if (params.get("skipHedgeGate") !== "1") return;
  try {
    sessionStorage.setItem(SKIP_HEDGE_GATE_SESSION_KEY, "1");
  } catch {
    // ignore
  }
  params.delete("skipHedgeGate");
  const qs = params.toString();
  const next = `${window.location.pathname}${qs ? `?${qs}` : ""}${window.location.hash || ""}`;
  window.history.replaceState(null, "", next);
}
