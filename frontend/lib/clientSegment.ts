/**
 * Segmento comercial alinhado a `fees-client.tsx` (Premium vs Private).
 * Gravado em localStorage no registo — usado para hedge e UI condicional.
 */

import { DECIDE_MIN_INVEST_EUR } from "./decideInvestPrefill";

export type ClientSegment = "premium" | "private";

/** Patamares mínimos indicativos (UX registo) — Premium = mín. do simulador; Private = fee B / hedge (50k). */
export const SEGMENT_MIN_INVESTMENT_EUR: Record<ClientSegment, number> = {
  premium: DECIDE_MIN_INVEST_EUR,
  private: 50_000,
};

/** Nome do plano + montante mínimo indicativo (título curto). */
export function formatSegmentTitleLabel(seg: ClientSegment): string {
  const n = SEGMENT_MIN_INVESTMENT_EUR[seg];
  const fmt = `${n.toLocaleString("pt-PT")} €`;
  const name = seg === "premium" ? "Premium" : "Private";
  return `${name} — mín. ${fmt}`;
}

/** Uma linha por segmento (registo / escolha de plano). */
export function formatSegmentMinimumLine(seg: ClientSegment): string {
  const n = SEGMENT_MIN_INVESTMENT_EUR[seg];
  const fmt = `${n.toLocaleString("pt-PT")} €`;
  return seg === "premium"
    ? `Indicativo: carteiras desde ${fmt} (comissão fixa mensal).`
    : `Indicativo: orientado a carteiras a partir de ${fmt} (fee NAV + performance; hedge nos KPIs quando aplicável).`;
}

const SEGMENT_LS_KEY = "decide_client_segment_v1";

/** Espelha a regra do relatório (`feeSegment`): B = NAV modelo ≥ 50k €. */
export const FEE_SEGMENT_LS_KEY = "decide_client_fee_segment_v1";

/**
 * Grava A/B conforme NAV (mesma regra que `report.tsx` → fee B).
 * Chamar ao carregar aprovação/relatório e antes de decidir redireccionamentos do funil.
 */
export function syncFeeSegmentFromNavEur(navEur: number): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(FEE_SEGMENT_LS_KEY, navEur >= 50000 ? "B" : "A");
  } catch {
    // ignore
  }
}

/**
 * Quem deve completar o passo «Hedge cambial»: segmento Private **ou** fee B (NAV ≥ 50k),
 * alinhado ao relatório — não basta o rádio «Private» no registo.
 */
export function isFxHedgeOnboardingApplicable(): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (getClientSegment() === "private") return true;
    return window.localStorage.getItem(FEE_SEGMENT_LS_KEY) === "B";
  } catch {
    return false;
  }
}

export function getClientSegment(): ClientSegment {
  if (typeof window === "undefined") return "premium";
  try {
    const v = window.localStorage.getItem(SEGMENT_LS_KEY);
    if (v === "private") return "private";
    return "premium";
  } catch {
    return "premium";
  }
}

export function setClientSegment(s: ClientSegment): void {
  try {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(SEGMENT_LS_KEY, s);
  } catch {
    // ignore
  }
}

export function isPrivateSegment(): boolean {
  return getClientSegment() === "private";
}
