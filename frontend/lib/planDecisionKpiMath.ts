/**
 * Métricas para o painel de decisão (dashboard): linguagem simples, sem confundir
 * volume bruto de ordens (incl. FX) com capital a investir.
 */

export type ChangeBand = "elevadas" | "moderadas" | "reduzidas";

export type PlanActivityInput = {
  side?: string;
  ticker?: string;
  deltaValueEst?: number;
};

export function computePlanActivity(
  trades: PlanActivityInput[],
  navEur: number,
): {
  assetCount: number;
  activityPct: number;
  changeBand: ChangeBand;
  grossBuyOrderVolumeEur: number;
  equityBuyVolumeEur: number;
  orderLegCount: number;
  totalAbsFlowEur: number;
} {
  let grossBuy = 0;
  let equityBuy = 0;
  const tickers = new Set<string>();
  let totalAbs = 0;
  let legs = 0;

  for (const t of trades) {
    const side = String(t.side || "").toUpperCase();
    if (side === "INACTIVE" || !side) continue;
    const ticker = String(t.ticker || "").toUpperCase();
    if (ticker) tickers.add(ticker);
    const raw = Number(t.deltaValueEst);
    const d = Number.isFinite(raw) ? raw : 0;
    totalAbs += Math.abs(d);
    legs += 1;
    if (side === "BUY") {
      grossBuy += d;
      if (ticker !== "EURUSD") equityBuy += d;
    }
  }

  const nav = Math.max(navEur, 1);
  /** Movimento de carteira vs NAV (ilustrativo; inclui várias pernas por activo). */
  const activityPct = Math.min(100, Math.round((totalAbs / (2 * nav)) * 100));

  let changeBand: ChangeBand = "reduzidas";
  if (activityPct >= 36) changeBand = "elevadas";
  else if (activityPct >= 14) changeBand = "moderadas";

  return {
    assetCount: tickers.size,
    activityPct,
    changeBand,
    grossBuyOrderVolumeEur: Math.round(Math.max(0, grossBuy)),
    equityBuyVolumeEur: Math.round(Math.max(0, equityBuy)),
    orderLegCount: legs,
    totalAbsFlowEur: Math.round(totalAbs),
  };
}

export function changeBandLabelPt(band: ChangeBand): string {
  switch (band) {
    case "elevadas":
      return "Elevadas";
    case "moderadas":
      return "Moderadas";
    default:
      return "Reduzidas";
  }
}

/**
 * Converte `overlayed_cagr` do modelo / v5_kpis: em geral fração (ex. 0,302 → 30,2 na UI com "%").
 * Se já estiver em percentagem (1–100), devolve sem multiplicar — alinhado ao motor v5.
 */
export function overlayedCagrToDisplayPercent(raw: unknown): number | null {
  const v = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(v) || v <= 0) return null;
  if (v > 1 && v <= 100) return v;
  return v * 100;
}

const TRADING_DAYS_PER_YEAR = 252;
/** Mínimo de pontos para CAGR a partir da série (como no iframe KPI). */
const MIN_EQUITY_POINTS_FOR_CAGR = 50;

/**
 * Mesma regra que `compute_kpis` no kpi_server (CAGR a partir da curva de equity).
 * Diferente de `annualized_return` sobre retornos diários no motor — evita divergência vs cartão/iframe.
 */
export function cagrFractionFromEquityLikeKpiServer(equity: number[]): number | null {
  if (equity.length < 2) return null;
  const startVal = equity[0];
  const endVal = equity[equity.length - 1];
  if (!(startVal > 0) || !(endVal > 0)) return null;
  const numDays = equity.length;
  const cagr = (endVal / startVal) ** (TRADING_DAYS_PER_YEAR / numDays) - 1;
  return Number.isFinite(cagr) ? cagr : null;
}

/**
 * CAGR de fallback a partir do payload do modelo (sem CSV do freeze).
 * O cartão Modelo CAP15 no iframe usa `compute_kpis` sobre a série m100 alinhada — preferir
 * `readPlafonadoM100CagrDisplayPercent` (série com política de vol do iframe) em `approvalTradePlan` / `plan-decision-kpis`.
 */
export function recommendedCagrDisplayPercentFromModelPayload(modelPayload: unknown): number | null {
  const p = modelPayload as Record<string, unknown> | null;
  if (!p || typeof p !== "object") return null;

  const kpisObj = p.kpis as Record<string, unknown> | undefined;
  const fromKpis = overlayedCagrToDisplayPercent(kpisObj?.cagr);
  if (fromKpis != null) return fromKpis;

  const summary = p.summary as Record<string, unknown> | undefined;
  const fromSummary = overlayedCagrToDisplayPercent(summary?.overlayed_cagr);
  if (fromSummary != null) return fromSummary;

  const series = p.series as Record<string, unknown> | undefined;
  const raw = series?.equity_overlayed;
  if (Array.isArray(raw) && raw.length >= MIN_EQUITY_POINTS_FOR_CAGR) {
    const eq = raw.map((x) => Number(x)).filter((x) => Number.isFinite(x));
    if (eq.length >= MIN_EQUITY_POINTS_FOR_CAGR) {
      const frac = cagrFractionFromEquityLikeKpiServer(eq);
      if (frac != null && Number.isFinite(frac)) {
        const pct = overlayedCagrToDisplayPercent(frac);
        if (pct != null) return pct;
      }
    }
  }

  return null;
}
