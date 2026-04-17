export type PortfolioPosition = {
  ticker: string;
  name_short: string;
  name?: string;
  weight: number;
  weight_pct: number;
  score: number | null;
  rank_momentum: number | null;
  /** Zona geográfica (ex.: Ásia, Europa) quando existir nos dados do motor. */
  zone: string;
  /** País de constituição / domicílio ou etiqueta equivalente. */
  country: string;
  /** Bloco do modelo (US, EU, JP, CAN, …). */
  region: string;
  sector: string;
  /** Indústria / sub-sector GICS quando existir. */
  industry: string;
};

export type CurrentPortfolio = {
  profile?: string;
  as_of?: string | null;
  n_positions: number;
  max_weight: number;
  max_weight_pct: number;
  top5_weight: number;
  top5_weight_pct: number;
  gross_exposure: number;
  gross_exposure_pct: number;
  turnover: number;
  turnover_pct: number;
  hhi: number;
  positions: PortfolioPosition[];
};

export type KpiBlock = {
  cagr?: number | null;
  vol?: number | null;
  volatility?: number | null;
  sharpe?: number | null;
  max_drawdown?: number | null;
  total_return?: number | null;
  best_month?: number | null;
  worst_month?: number | null;
  positive_months?: number | null;
  negative_months?: number | null;
  months_above_benchmark?: number | null;
  [key: string]: any;
};

export type RunModelResponse = {
  meta: Record<string, any>;
  series: {
    dates: string[];
    equity_raw: number[];
    equity_raw_volmatched: number[];
    equity_overlayed: number[];
    benchmark_equity: number[];
  };
  kpis: KpiBlock;
  benchmark_kpis: KpiBlock;
  raw_kpis: KpiBlock;
  raw_volmatched_kpis: KpiBlock;
  overlay_pre_vol_kpis: KpiBlock;
  current_portfolio: CurrentPortfolio;
};

export type DashboardPayload = RunModelResponse;
export type PortfolioPayload = CurrentPortfolio;
export type KpiBlockType = KpiBlock;

import { applyJapaneseEquityDisplayFallback } from "../lib/tickerGeoFallback";

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} at ${url}`);
  }
  return res.json();
}

function num(x: any, fallback = 0): number {
  const v = Number(x);
  return Number.isFinite(v) ? v : fallback;
}

function nullableNum(x: any): number | null {
  if (x === null || x === undefined || x === "") return null;
  const v = Number(x);
  return Number.isFinite(v) ? v : null;
}

function normalizePosition(row: any): PortfolioPosition {
  let weight = num(row?.weight, 0);
  let weightPct =
    row?.weight_pct !== undefined && row?.weight_pct !== null
      ? num(row.weight_pct, weight * 100)
      : weight * 100;

  if (weight > 1.000001 && weightPct <= 1.000001) {
    weightPct = weight;
    weight = weight / 100;
  }

  const ticker = String(row?.ticker ?? "");
  const merged = applyJapaneseEquityDisplayFallback(ticker, {
    zone: row?.zone ?? row?.geo_zone ?? "",
    country:
      row?.country ?? row?.country_incorporation ?? row?.domicile_country ?? row?.incorporation_country ?? "",
    region: row?.region ?? row?.country_group ?? row?.benchmark_zone ?? "",
    sector: row?.sector ?? "",
  });
  const industryRaw = row?.industry ?? row?.subcategory ?? row?.gics_sub_industry ?? "";
  return {
    ticker,
    name_short: String(row?.name_short ?? row?.short_name ?? row?.name ?? row?.ticker ?? ""),
    name: String(row?.name ?? row?.name_short ?? row?.short_name ?? row?.ticker ?? ""),
    weight,
    weight_pct: weightPct,
    score: row?.score === null || row?.score === undefined ? null : num(row.score, 0),
    rank_momentum:
      row?.rank_momentum === null || row?.rank_momentum === undefined
        ? null
        : num(row.rank_momentum, 0),
    zone: String(merged.zone ?? ""),
    country: String(merged.country ?? ""),
    region: String(merged.region ?? ""),
    sector: String(merged.sector ?? ""),
    industry: String(industryRaw ?? ""),
  };
}

function normalizePortfolio(raw: any): CurrentPortfolio {
  const positions = Array.isArray(raw?.positions) ? raw.positions.map(normalizePosition) : [];

  return {
    profile: raw?.profile ? String(raw.profile) : undefined,
    as_of: raw?.as_of ?? raw?.date ?? null,
    n_positions: num(raw?.n_positions, positions.length),
    max_weight: num(raw?.max_weight, 0),
    max_weight_pct: num(raw?.max_weight_pct, 0),
    top5_weight: num(raw?.top5_weight, 0),
    top5_weight_pct: num(raw?.top5_weight_pct, 0),
    gross_exposure: num(raw?.gross_exposure, 0),
    gross_exposure_pct: num(raw?.gross_exposure_pct, 0),
    turnover: num(raw?.turnover, 0),
    turnover_pct: num(raw?.turnover_pct, 0),
    hhi: num(raw?.hhi, 0),
    positions,
  };
}

function normalizeKpis(raw: any): KpiBlock {
  return {
    ...raw,
    cagr: nullableNum(raw?.cagr),
    vol: nullableNum(raw?.vol),
    volatility: nullableNum(raw?.volatility ?? raw?.vol),
    sharpe: nullableNum(raw?.sharpe),
    max_drawdown: nullableNum(raw?.max_drawdown),
    total_return: nullableNum(raw?.total_return),
    best_month: nullableNum(raw?.best_month),
    worst_month: nullableNum(raw?.worst_month),
    positive_months: nullableNum(raw?.positive_months),
    negative_months: nullableNum(raw?.negative_months),
    months_above_benchmark: nullableNum(raw?.months_above_benchmark),
  };
}

export function formatPct(x: number | null | undefined, digits = 2): string {
  if (x === null || x === undefined || Number.isNaN(Number(x))) return "—";
  return `${(Number(x) * 100).toFixed(digits)}%`;
}

export function formatNum(x: number | null | undefined, digits = 2): string {
  if (x === null || x === undefined || Number.isNaN(Number(x))) return "—";
  return Number(x).toFixed(digits);
}

export async function fetchRunModel(profile = "moderado"): Promise<RunModelResponse> {
  const raw = await getJson<any>(`/api/proxy/run-model?profile=${encodeURIComponent(profile)}`);

  return {
    meta: raw?.meta ?? {},
    series: {
      dates: Array.isArray(raw?.series?.dates) ? raw.series.dates : [],
      equity_raw: Array.isArray(raw?.series?.equity_raw) ? raw.series.equity_raw.map((x: any) => num(x)) : [],
      equity_raw_volmatched: Array.isArray(raw?.series?.equity_raw_volmatched)
        ? raw.series.equity_raw_volmatched.map((x: any) => num(x))
        : [],
      equity_overlayed: Array.isArray(raw?.series?.equity_overlayed)
        ? raw.series.equity_overlayed.map((x: any) => num(x))
        : [],
      benchmark_equity: Array.isArray(raw?.series?.benchmark_equity)
        ? raw.series.benchmark_equity.map((x: any) => num(x))
        : [],
    },
    kpis: normalizeKpis(raw?.kpis ?? {}),
    benchmark_kpis: normalizeKpis(raw?.benchmark_kpis ?? {}),
    raw_kpis: normalizeKpis(raw?.raw_kpis ?? {}),
    raw_volmatched_kpis: normalizeKpis(raw?.raw_volmatched_kpis ?? {}),
    overlay_pre_vol_kpis: normalizeKpis(raw?.overlay_pre_vol_kpis ?? {}),
    current_portfolio: normalizePortfolio(raw?.current_portfolio ?? {}),
  };
}

export async function fetchCurrentPortfolio(profile = "moderado"): Promise<CurrentPortfolio> {
  const fromRun = await fetchRunModel(profile);
  if ((fromRun.current_portfolio?.positions ?? []).length > 0) {
    return fromRun.current_portfolio;
  }

  const raw = await getJson<any>(`/api/proxy/portfolio/current?profile=${encodeURIComponent(profile)}`);
  return normalizePortfolio(raw);
}

export async function fetchDashboardData(profile = "moderado"): Promise<DashboardPayload> {
  return fetchRunModel(profile);
}

export async function fetchPortfolioData(profile = "moderado"): Promise<PortfolioPayload> {
  return fetchCurrentPortfolio(profile);
}