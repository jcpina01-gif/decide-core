/**
 * Persiste o montante simulado / escolhido no onboarding (Next, mesmo origin).
 * O painel Flask (:5000) não partilha localStorage com o Next — o registo grava aqui via ?capital=.
 */
export const DECIDE_INTENDED_INVEST_LS_KEY = "decide_intended_invest_eur_v1";

export const DECIDE_MIN_INVEST_EUR = 5000;

/** Simulador e passo «Valor a investir» quando não há ?capital= nem prefill em localStorage. */
export const DECIDE_DEFAULT_INVEST_EUR = 50_000;

export function persistIntendedInvestEur(eur: number): void {
  const n = Math.round(eur);
  if (!Number.isFinite(n) || n < DECIDE_MIN_INVEST_EUR) return;
  try {
    window.localStorage.setItem(DECIDE_INTENDED_INVEST_LS_KEY, String(n));
  } catch {
    // ignore
  }
}

export function readIntendedInvestEur(): number | null {
  try {
    const raw = window.localStorage.getItem(DECIDE_INTENDED_INVEST_LS_KEY);
    const n = raw != null ? Math.round(Number(raw)) : NaN;
    if (Number.isFinite(n) && n >= DECIDE_MIN_INVEST_EUR) return n;
  } catch {
    // ignore
  }
  return null;
}

export function clearIntendedInvestEur(): void {
  try {
    window.localStorage.removeItem(DECIDE_INTENDED_INVEST_LS_KEY);
  } catch {
    // ignore
  }
}
