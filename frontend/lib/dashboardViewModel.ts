import {
  aggregateHoldings,
  calcAbsoluteZoneWeights,
  calcSectorWeightsAbsolute,
  type Holding,
} from "./portfolioAggregation";

function topSectorCards(sectorWeightsAbs: Array<{ sector: string; weight: number }>) {
  const cards = [...sectorWeightsAbs.slice(0, 4)];
  while (cards.length < 4) cards.push({ sector: "-", weight: 0 });
  return cards;
}

function firstFiniteNumber(...vals: unknown[]): number | null {
  for (const v of vals) {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

export function buildDashboardState(payload: any) {
  const meta = payload?.meta || {};
  const summary = payload?.summary || {};

  const kpisOriginal = payload?.kpis || {};
  const kpisConstrained = payload?.kpis_constrained || payload?.kpis || {};
  const benchmarkKpis = payload?.benchmark_kpis || {};

  const holdingsOriginal = payload?.latest_holdings_detailed || [];
  const holdingsConstrained = (payload?.latest_holdings_detailed_constrained || undefined) as Holding[] | undefined;
  const holdingsToShow = holdingsConstrained && holdingsConstrained.length > 0 ? holdingsConstrained : holdingsOriginal;
  const showingLabel = holdingsConstrained && holdingsConstrained.length > 0 ? "Constrained" : "Original";

  const aggregatedHoldings = aggregateHoldings(holdingsToShow);
  const rawHoldingsCount = holdingsToShow.length;
  const uniqueCompaniesCount = aggregatedHoldings.length;
  const displayedGross = aggregatedHoldings.reduce((a, h) => a + h.weight, 0);

  const top5 = aggregatedHoldings.slice(0, 5).reduce((acc, h) => acc + h.weight, 0);
  const top10 = aggregatedHoldings.slice(0, 10).reduce((acc, h) => acc + h.weight, 0);
  const maxPos = aggregatedHoldings.length > 0 ? aggregatedHoldings[0].weight : 0;
  const avgPos = aggregatedHoldings.length > 0 ? aggregatedHoldings.reduce((a, b) => a + b.weight, 0) / aggregatedHoldings.length : 0;

  const zoneWeightsAbs = calcAbsoluteZoneWeights(aggregatedHoldings);
  const sectorWeightsAbs = calcSectorWeightsAbsolute(aggregatedHoldings);
  const topSectorCardsList = topSectorCards(sectorWeightsAbs);

  const positiveMonths = Number(kpisConstrained.positive_months || 0);
  const negativeMonths = Number(kpisConstrained.negative_months || 0);
  const monthsTotal = positiveMonths + negativeMonths;
  const monthsAbove = Number(kpisConstrained.months_above_benchmark || 0);
  const monthsBelow = Math.max(0, monthsTotal - monthsAbove);

  const tbillsMedios = summary.avg_cash_sleeve_constrained ?? summary.avg_cash_sleeve;
  const tbillsMaximos = summary.max_cash_sleeve_constrained ?? summary.max_cash_sleeve;

  const tbillsAtuais = firstFiniteNumber(
    summary.current_cash_sleeve_constrained,
    summary.current_cash_sleeve,
    summary.latest_cash_sleeve_constrained,
    summary.latest_cash_sleeve,
    meta.latest_cash_sleeve,
  );

  let equityAtual = firstFiniteNumber(summary.current_equity_exposure_constrained, summary.current_equity_exposure);
  if (equityAtual == null && tbillsAtuais != null) {
    equityAtual = Math.max(0, Math.min(1, 1 - tbillsAtuais));
  }

  return {
    meta,
    summary,
    kpisOriginal,
    kpisConstrained,
    benchmarkKpis,
    holdingsOriginal,
    holdingsConstrained,
    holdingsToShow,
    showingLabel,
    aggregatedHoldings,
    rawHoldingsCount,
    uniqueCompaniesCount,
    displayedGross,
    top5,
    top10,
    maxPos,
    avgPos,
    zoneWeightsAbs,
    sectorWeightsAbs,
    topSectorCards: topSectorCardsList,
    positiveMonths,
    negativeMonths,
    monthsTotal,
    monthsAbove,
    monthsBelow,
    equityAtual,
    tbillsAtuais,
    tbillsMedios,
    tbillsMaximos,
  };
}
