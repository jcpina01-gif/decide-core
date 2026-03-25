import { DECIDE_MIN_INVEST_EUR } from "./decideInvestPrefill";

export const TRADING_DAYS_PER_YEAR = 252;

export type SimulatorResult =
  | { ok: false; message: string }
  | {
      ok: true;
      sliceDates: string[];
      modelVal: number[];
      benchVal: number[];
      windowLabel: string;
      modelEnd: number;
      benchEnd: number;
      warn?: string;
    };

/**
 * Janela em dias úteis (~252/ano), alinhada ao simulador do KPI server e do dashboard.
 */
export function buildSimulatorSeries(
  dates: string[],
  modelEq: number[],
  benchEq: number[],
  years: number,
  capital: number,
  minCapitalEur: number = DECIDE_MIN_INVEST_EUR,
): SimulatorResult {
  const n = dates.length;
  if (n < 2) return { ok: false, message: "Série insuficiente." };
  if (!Number.isFinite(capital) || capital < minCapitalEur) {
    return {
      ok: false,
      message: `O investimento mínimo é ${minCapitalEur.toLocaleString("pt-PT")} €.`,
    };
  }
  if (!Number.isFinite(years) || years <= 0) return { ok: false, message: "Indique um número de anos > 0." };

  const maxYears = (n - 1) / TRADING_DAYS_PER_YEAR;
  const clampedYears = Math.min(years, maxYears);
  const warn = clampedYears < years ? `Horizonte limitado ao máximo da série (~${maxYears.toFixed(2)} anos).` : undefined;

  let daysBack = Math.round(clampedYears * TRADING_DAYS_PER_YEAR);
  daysBack = Math.min(Math.max(1, daysBack), n - 1);
  const startIdx = n - 1 - daysBack;

  const m0 = Number(modelEq[startIdx]);
  const b0 = Number(benchEq[startIdx]);
  if (!(m0 > 0) || !(b0 > 0)) return { ok: false, message: "Dados inválidos no início da janela." };

  const modelVal: number[] = [];
  const benchVal: number[] = [];
  for (let i = startIdx; i < n; i++) {
    modelVal.push(capital * (Number(modelEq[i]) / m0));
    benchVal.push(capital * (Number(benchEq[i]) / b0));
  }
  const sliceDates = dates.slice(startIdx);
  const approxY = (daysBack / TRADING_DAYS_PER_YEAR).toFixed(1);
  const windowLabel = `${sliceDates[0]} → ${sliceDates[sliceDates.length - 1]} (~${approxY} a)`;

  const out: Extract<SimulatorResult, { ok: true }> = {
    ok: true,
    sliceDates,
    modelVal,
    benchVal,
    windowLabel,
    modelEnd: modelVal[modelVal.length - 1],
    benchEnd: benchVal[benchVal.length - 1],
  };
  if (warn) out.warn = warn;
  return out;
}
