/**
 * Estado local do passo «Financiar conta» (antes da execução no relatório).
 * Não substitui confirmação real de saldo na IBKR — é orientação + UX.
 */

export const FUNDING_STATUS_LS_KEY = "decide_funding_status_v1";

export type FundingStatus = "awaiting" | "transferred" | "received";

export function readFundingStatus(): FundingStatus {
  if (typeof window === "undefined") return "awaiting";
  try {
    const raw = window.localStorage.getItem(FUNDING_STATUS_LS_KEY);
    if (raw === "transferred" || raw === "received" || raw === "awaiting") return raw;
  } catch {
    // ignore
  }
  return "awaiting";
}

export function writeFundingStatus(status: FundingStatus): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(FUNDING_STATUS_LS_KEY, status);
  } catch {
    // ignore
  }
}
