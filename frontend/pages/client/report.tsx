import type { GetServerSideProps } from "next";
import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react";
import ClientFlowDashboardButton from "../../components/ClientFlowDashboardButton";
import { ONBOARDING_STORAGE_KEYS } from "../../components/OnboardingFlowBar";
import InlineLoadingDots from "../../components/InlineLoadingDots";
import { isFxHedgeOnboardingApplicable, syncFeeSegmentFromNavEur } from "../../lib/clientSegment";
import { isHedgeOnboardingDone, readFxHedgePrefs } from "../../lib/fxHedgePrefs";
import {
  clearDecideClientLocalTestState,
  isDecidePlanoDevResetVisibleInBrowser,
} from "../../lib/decideClientDevReset";
import {
  clientReportHrefFromQuery,
  queryIndicatesDailyEntryPlanWeights,
} from "../../lib/clientPlanDailyEntryQuery";
import { DECIDE_APP_FONT_FAMILY, DECIDE_DASHBOARD } from "../../lib/decideClientTheme";
import { getNextOnboardingHref } from "../../lib/onboardingProgress";
import {
  recordCancelOpenOrdersPaperResponse,
  recordExecutionSnapshotFromSyncedFills,
  recordFlattenPaperPortfolioResponse,
  recordPlanActivityFailure,
  recordPlanActivityInfo,
  recordSendOrdersResponse,
  recordUserAbortedSendOrders,
} from "../../lib/clientOrderActivityLog";
import {
  cashSleevePlanUiSubtitle,
  clientUsTbillProxyIbTicker,
  isDecideCashSleeveBrokerSymbol,
} from "../../lib/decideCashSleeveDisplay";
import {
  estimateUsdNotionalForBuyFxHedge,
  isBuyMissingEquityClosePrice,
} from "../../lib/approvalPlanTradeDisplay";
import { capPctDisplay, eurMmIbTicker, safeNumber, safeString } from "../../lib/clientReportCoreUtils";
import { lookupCompanyMetaEntry } from "../../lib/companyMeta";
import {
  applyJapaneseEquityDisplayFallback,
  displayGeoZoneFromTickerAndMeta,
  meaningfulGeoTableCell,
} from "../../lib/tickerGeoFallback";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";

export type SeriesPoint = {
  date: string;
  benchmark: number;
  raw: number;
  overlayed: number;
};

export type ActualPosition = {
  ticker: string;
  /** Nome curto (metadados CSV ou snapshot IBKR). */
  nameShort: string;
  sector: string;
  /** Indústria / sub-sector quando existir (IBKR ou CSV). */
  industry: string;
  /** País (etiqueta ou constituição) quando conhecido. */
  country: string;
  /** Zona geográfica (ex.: Ásia, Europa) — snapshot IBKR ou metadados. */
  zone: string;
  /** Bloco US / EU / JP / CAN do plano (metadados DECIDE), quando mapeável. */
  region: string;
  qty: number;
  marketPrice: number;
  /** null quando não há preço de fecho (JSON de GSSP não aceita undefined). */
  closePrice: number | null;
  value: number;
  weightPct: number;
  currency: string;
};

export type RecommendedPosition = {
  ticker: string;
  nameShort: string;
  region: string;
  /**
   * Zona macro do CSV oficial (US/EU/JP/CAN) para caps 1,3× vs benchmark.
   * A coluna ``region`` pode reflectir a listagem (ADR JP → US); não usar só isso nos caps.
   */
  csvBenchZone?: string;
  /** País de constituição / domicílio quando existe nos CSVs ou meta DECIDE. */
  country: string;
  /** Zona geográfica (continente / macro-região), quando existir. */
  geoZone: string;
  sector: string;
  /** GICS / sub-sector quando existe nos CSVs (ex.: Gold para NEM). */
  industry: string;
  score: number;
  weightPct: number;
  originalWeightPct: number;
  excluded: boolean;
};

export type ProposedTrade = {
  ticker: string;
  side: string;
  absQty: number;
  marketPrice: number;
  closePrice: number | null;
  deltaValueEst: number;
  targetWeightPct: number;
  nameShort: string;
};

export type LiveIbkrStructure = {
  netLiquidation: number;
  ccy: string;
  grossPositionsValue: number;
  financing: number;
  financingCcy: string;
};

/** Diagnóstico SSR: de onde vêm os pesos-alvo da grelha (evita cache/CDN a mostrar HTML antigo). */
export type PlanWeightsProvenance = {
  /**
   * - ``official_csv``: ``weights_by_rebalance`` (último mês ≤ hoje).
   * - ``live_model``: opt-in live com payload ``as_of`` = hoje.
   * - ``freeze_snapshot``: sem linhas no CSV no deploy — ``portfolio_final.json`` do freeze CAP15 (ilustrativo).
   * - ``model_positions_fallback``: payload ``current_portfolio`` sem ser o ramo live (ex.: só conta).
   */
  mode: "official_csv" | "live_model" | "freeze_snapshot" | "model_positions_fallback";
  rebalanceDate?: string;
  /** Quando a grelha usa CSV mais recente que o fecho mensal (constituição), data da série mensal. */
  officialCalendarRebalanceDate?: string;
  /** ``true`` quando o alvo da grelha segue o último export do CSV (entrada / constituição no dia). */
  dailyEntryPlanTargetApplied?: boolean;
  mergeSourcePath?: string;
  officialHistoryMonthsLoaded: number;
  recommendedLineCount: number;
  /** Limiares (%) aplicados no SSR — confirma deploy vs HTML em cache. */
  planDustExitPct?: number;
  planEntryMinPct?: number;
  /** Limiar de pó na grelha (em geral = saída ~0,5%); a grelha não funde ao mínimo de entrada. */
  planTableConsolidatePct?: number;
  /** Tecto % por linha de risco (ex.: 15%) — ``DECIDE_PLAN_MAX_WEIGHT_PCT_PER_TICKER``. */
  planPerTickerMaxPct?: number;
  /** ``true`` se ``DECIDE_DISABLE_PLAN_WEIGHT_ADJUSTMENTS`` — caps por zona/linha desligados. */
  planGeoAdjustmentsDisabled?: boolean;
  /** ``true`` se ``DECIDE_DISABLE_ZONE_CAP_VS_BENCHMARK`` — só o teto 1,3× por país fica OFF. */
  planZoneCapVsBenchmarkDisabled?: boolean;
  /** Multiplicador vs benchmark (por defeito 1,3). */
  planZoneCapMult?: number;
  /**
   * ``true`` se o SSR reaplicou **pó** e **tecto por linha** (e tectos duros associados) sobre a grelha.
   * ``false`` no modo ``official_csv`` por defeito (export já reflecte o motor).
   */
  planSsrGeometryRecutsRanOnGrid?: boolean;
  /**
   * ``true`` se o SSR aplicou o tecto **1,3× por zona vs benchmark** no sleeve de risco.
   * No ``official_csv`` corre por defeito (opt-out: ``DECIDE_SKIP_ZONE_CAP_ON_OFFICIAL_CSV``).
   */
  planSsrZoneCapRanOnGrid?: boolean;
};

export type ReportData = {
  generatedAt: string;
  accountCode: string;
  profile: string;
  modelDisplayName: string;
  navEur: number;
  /** Moeda do património líquido na conta IBKR (smoke test), p.ex. USD ou EUR — não é sempre euro. */
  accountBaseCurrency: string;
  cashEur: number;
  currentValueEur: number;
  totalReturnPct: number;
  benchmarkTotalReturnPct: number;
  cagrPct: number;
  benchmarkCagrPct: number;
  sharpe: number;
  benchmarkSharpe: number;
  volatilityPct: number;
  benchmarkVolatilityPct: number;
  maxDrawdownPct: number;
  benchmarkMaxDrawdownPct: number;
  /** Subtítulos de horizonte (CAGR vs gráfico/risco — mesmo período). */
  displayHorizonLabel: string;
  /** Subtítulo do cartão «CAGR do modelo». */
  displayCagrModelSubLabel: string;
  /** Subtítulo do cartão «CAGR do benchmark». */
  displayCagrBenchmarkSubLabel: string;
  planSummary: {
    strategyLabel: string;
    riskLabel: string;
    positionCount: number;
    /** Percentagem mostrada (em constituição inicial, limitada a 100% quando a técnica > 100%). */
    turnoverPct: number;
    /** Rotação técnica max(compras,vendas)/NAV antes do limite a constituição inicial. */
    turnoverPctTechnical?: number;
    /** Poucas vendas + compras relevantes — carteira a ser montada a partir de caixa. */
    initialConstitution?: boolean;
    buyCount: number;
    sellCount: number;
  };
  excludedTickersApplied: string[];
  exclusionCandidates: Array<{ ticker: string; nameShort: string }>;
  tbillsProxyWeightPct: number;
  proposedTradesCoverageNote: string;
  backendError: string;
  closeAsOfDate: string;
  actualPositions: ActualPosition[];
  recommendedPositions: RecommendedPosition[];
  proposedTrades: ProposedTrade[];
  series: SeriesPoint[];
  feeSegment: "A" | "B";
  monthlyFixedFeeEur: number;
  annualManagementFeePct: number;
  estimatedAnnualManagementFeeEur: number;
  estimatedMonthlyManagementFeeEur: number;
  estimatedPerformanceFeeEur: number;
  /** Símbolo IBKR para executar TBILL_PROXY (ex. BIL, SHV) — espelha TBILL_PROXY_IB_TICKER no backend. */
  tbillProxyIbTicker: string;
  /** Carteira/NAV via POST ao FastAPI quando não há tmp_diag (ex. Vercel → VM com IB Gateway). */
  initialIbkrStructure?: LiveIbkrStructure;
  /**
   * Data ISO (`YYYY-MM-DD`) de referência dos pesos-alvo: `rebalance_date` do CSV oficial em vigor,
   * ou `as_of_date` do motor quando a geração «de hoje» ainda não está no ficheiro de pesos.
   */
  planTargetRebalanceDate?: string;
  planWeightsProvenance?: PlanWeightsProvenance;
  /**
   * Identificador de build (SSR) — p.ex. commit Vercel curto + ambiente.
   * Se em produção não bater com o `git log` de `main`, ainda estão a carregar JavaScript antigo
   * ou o deploy do projecto Vercel não usou o último push.
   */
  clientUiBuildLabel: string;
};

export type PageProps = {
  reportData: ReportData;
};

/** Hidratação/serialização: garante listas e campos mínimos — evita a secção «Decisão final» a desaparecer. */
function normalizeReportDataForClient(d: ReportData): ReportData {
  const planSummary: ReportData["planSummary"] = d.planSummary ?? {
    strategyLabel: "—",
    riskLabel: "—",
    positionCount: 0,
    turnoverPct: 0,
    buyCount: 0,
    sellCount: 0,
  };
  return {
    ...d,
    planSummary,
    excludedTickersApplied: d.excludedTickersApplied ?? [],
    exclusionCandidates: d.exclusionCandidates ?? [],
    actualPositions: d.actualPositions ?? [],
    recommendedPositions: d.recommendedPositions ?? [],
    proposedTrades: (d.proposedTrades ?? []).filter(
      (t): t is ProposedTrade => t != null && typeof t === "object" && t !== null,
    ),
    series: d.series ?? [],
    clientUiBuildLabel: d.clientUiBuildLabel ?? "—",
  };
}

/**
 * Proximidade da carteira real aos pesos-alvo do plano (só linhas do plano com peso ≥ 0,05%).
 * Σ min(peso_actual, peso_alvo) / Σ peso_alvo — títulos fora do plano não penalizam.
 */
function computePortfolioVsPlanCoveragePct(
  recommended: RecommendedPosition[],
  actualRows: ActualPosition[],
): number | null {
  const actMap = new Map<string, number>();
  for (const a of actualRows) {
    const k = String(a.ticker || "").trim().toUpperCase();
    if (!k || k === "LIQUIDEZ") continue;
    const w = safeNumber(a.weightPct, 0);
    actMap.set(k, (actMap.get(k) || 0) + w);
  }
  let denom = 0;
  let num = 0;
  for (const r of recommended) {
    const t = String(r.ticker || "").trim().toUpperCase();
    if (!t || t === "EURUSD") continue;
    const wt = safeNumber(r.weightPct, 0);
    if (wt < 0.05) continue;
    denom += wt;
    const wa = actMap.get(t) ?? 0;
    num += Math.min(wa, wt);
  }
  if (denom <= 0) return null;
  return Math.min(100, Math.round((num / denom) * 1000) / 10);
}

/** Caixa/MM (CSH2, ETF T-Bills), proxies do plano e hedge EURUSD — fora do denominador «só títulos de risco» à direita. */
function isRecommendedCashOrHedgeRowTicker(ticker: string): boolean {
  const u = String(ticker || "").trim().toUpperCase();
  if (u === "EURUSD") return true;
  if (u === "TBILL_PROXY" || u === "EUR_MM_PROXY") return true;
  return isDecideCashSleeveBrokerSymbol(u);
}

/**
 * Split «Liquidez vs Acções» para PDF / texto (alinhado ao histórico do modelo).
 * - Liquidez: TBILL_PROXY, EUR_MM_PROXY, símbolos IBKR de caixa (CSH2…), não duplica após TBILL→CSH2 na UI.
 * - Acções: restantes; **EURUSD** (hedge IDEALPRO) não entra — é overlay % NAV, não parte da alocação modelo.
 * Renormaliza para os dois somarem ~100% (evita 61,7% + 139% quando a caixa ia para «acções» por ticker ≠ TBILL_PROXY).
 */
function planLiquidezVsAccoesPctFromRecommended(
  rows: RecommendedPosition[],
): { liquidezPct: number; acoesPct: number } | null {
  let liquidez = 0;
  let acoes = 0;
  for (const p of rows) {
    if (p.excluded) continue;
    const u = String(p.ticker || "").trim().toUpperCase();
    if (u === "EURUSD") continue;
    const w = safeNumber(p.weightPct, 0);
    if (w <= 0) continue;
    if (u === "TBILL_PROXY" || u === "EUR_MM_PROXY" || isDecideCashSleeveBrokerSymbol(u)) {
      liquidez += w;
    } else {
      acoes += w;
    }
  }
  const t = liquidez + acoes;
  if (t <= 1e-6) return null;
  return {
    liquidezPct: (liquidez / t) * 100,
    acoesPct: (acoes / t) * 100,
  };
}

/** TBILL_PROXY e ETF USD do sleeve (BIL, SHV, …) — fora do lote UCITS EUR. */
function isTbillProxyPlanTicker(ticker: string): boolean {
  const u = String(ticker || "").trim().toUpperCase();
  if (u === "TBILL_PROXY") return true;
  const us = clientUsTbillProxyIbTicker();
  if (us && u === us) return true;
  return false;
}

/**
 * UCITS «money market» em EUR (XEON, CSH2, EUR_MM_PROXY, …) — alinhado a `send_orders._KNOWN_EUR_MM_UCITS`
 * (incl. CSH2 explícito no plano com `EUR_MM_IB_TICKER=XEON` no env).
 * Negocia em horário Europeu; separado de TBILL_PROXY (USD) e de acções.
 */
function isEurMmUcitsPlanTicker(ticker: string): boolean {
  if (isTbillProxyPlanTicker(ticker)) return false;
  const u = String(ticker || "").trim().toUpperCase();
  if (u === "EUR_MM_PROXY" || u === "EURMM_PROXY" || u === "LQDE") return true;
  if (u === "CSH2" || u === "XEON") return true;
  const eurM = eurMmIbTicker();
  if (eurM && u === eurM) return true;
  return isDecideCashSleeveBrokerSymbol(ticker) && !isTbillProxyPlanTicker(ticker);
}

function formatEuro(v: number): string {
  return new Intl.NumberFormat("pt-PT", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(v);
}

function formatMoneyCompact(v: number, currency: string): string {
  const c = typeof currency === "string" && currency.length === 3 ? currency.toUpperCase() : "USD";
  try {
    return new Intl.NumberFormat("pt-PT", {
      style: "currency",
      currency: c,
      maximumFractionDigits: 0,
    }).format(v);
  } catch {
    return `${v.toFixed(0)} ${c}`;
  }
}

/** Avg fill from IBKR US equities — report in USD. */
function formatUsdPrice(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v) || v <= 0) {
    return "—";
  }
  return new Intl.NumberFormat("pt-PT", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(v);
}

/** Taxa EUR.USD (IDEALPRO) — não é preço de acção em USD. */
function formatEurUsdRate(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v) || v <= 0) {
    return "—";
  }
  return new Intl.NumberFormat("pt-PT", {
    minimumFractionDigits: 4,
    maximumFractionDigits: 6,
  }).format(v);
}

/**
 * Montante USD a enviar ao backend para EUR.USD (IDEALPRO): inclui compras de ações e de TBILL_PROXY
 * (resolve para BIL/SHV no envio). Se o cliente tiver preferência de hedge EUR/USD com % 50 ou 100,
 * aplica essa fracção ao notional; caso contrário usa o total das compras (comportamento anterior).
 */
function fxHedgeUsdNotionalForCoordinatedSend(
  trades: ProposedTrade[],
  prefs: ReturnType<typeof readFxHedgePrefs>,
): number {
  const base = estimateUsdNotionalForBuyFxHedge(trades);
  if (prefs && prefs.pct > 0 && prefs.pair === "EURUSD") {
    return Math.round(base * (prefs.pct / 100) * 100) / 100;
  }
  return base;
}

/** Só o par EUR/USD tem ordem FX na IBKR neste fluxo (`send_orders` → EURUSD). */
function hedgePrefsImplyCoordinatedFx(): boolean {
  try {
    const p = readFxHedgePrefs();
    return Boolean(p && p.pct > 0 && p.pair === "EURUSD");
  } catch {
    return false;
  }
}

function formatPct(v: number, digits = 2): string {
  return `${v.toFixed(digits)}%`;
}

function formatQty(v: number): string {
  return new Intl.NumberFormat("pt-PT", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(v);
}

/** Quantidade ainda por enviar / completar (pedido − preenchido). */
function remainingOrderQty(f: { requested_qty?: number; filled?: number }): number {
  const req = Math.floor(Number(f.requested_qty ?? 0));
  const done = Math.floor(Number(f.filled ?? 0));
  return Math.max(0, req - done);
}

/**
 * IBKR: estados como `PendingCancel` contêm a substring «cancel» mas **não** «cancelled»/«canceled» —
 * não são cancelamento terminal. Usar só palavras-chave de fim de ordem; evita «Cancelada» falsa.
 */
function ibkrStatusIsTerminalCancelled(stRaw: string): boolean {
  const st = String(stRaw ?? "").toLowerCase().trim();
  if (!st) return false;
  if (st.includes("pendingcancel")) return false;
  return st.includes("cancelled") || st.includes("canceled") || st.includes("bust");
}

/** Rótulos para o cliente (evita jargão IBKR tipo «Submitted»). */
function execStatusDisplay(f: {
  status?: string;
  requested_qty?: number;
  filled?: number;
}): string {
  const st = String(f.status ?? "").toLowerCase();
  const req = Number(f.requested_qty ?? 0);
  const fill = Number(f.filled ?? 0);
  if (ibkrStatusIsTerminalCancelled(f.status ?? "")) return "Cancelada";
  if (st.includes("skip_fx_below_min") || st.includes("skip_fx_size")) return "FX não enviada (limite)";
  if (st.includes("skip_sell_no_long")) return "Venda ignorada (sem long na IB — anti-short)";
  if (
    st.includes("not_qualified") ||
    st.includes("qualify_error") ||
    st.includes("place_error") ||
    st.includes("reject") ||
    st.includes("error")
  ) {
    return "Falhada";
  }
  if (req > 0 && fill > 0 && fill < req) return "Parcial";
  if (st.includes("filled") && ((req > 0 && fill >= req) || (req <= 0 && fill > 0))) {
    return "Executada";
  }
  if (req > 0 && fill + 1e-6 >= req && !ibkrStatusIsTerminalCancelled(f.status ?? "")) {
    return "Executada";
  }
  /** Ainda não enviada ao sistema da corretora — na TWS costuma aparecer só «Transmitir» (não «Cancelar»). */
  if (st === "pendingsubmit" || st === "apipending") {
    return "Pendente — confirmar na TWS (Transmitir)";
  }
  if (st.includes("submitted") || st.includes("presubmitted") || st.includes("pending")) {
    return "Em curso";
  }
  if (st.includes("filled")) return "Executada";
  return f.status ? String(f.status) : "—";
}

/**
 * Ordem com quantidade em falta e elegível para nova submissão.
 * Não duplicar: ordem já na fila (Submitted/PreSubmitted, 0 fill) → não reenviar ao clicar «Completar pendentes».
 */
function fillEligibleForCompletionRetry(f: { status?: string; requested_qty?: number; filled?: number }): boolean {
  if (remainingOrderQty(f) <= 0) return false;
  const st = String(f.status ?? "").toLowerCase();
  if (st.includes("skip_sell_no_long")) return false;
  if (st.includes("cancel") || st.includes("inactive")) return false;
  const fill = Math.floor(Number(f.filled ?? 0));
  const liveNoFill =
    fill <= 0 &&
    (st.includes("presubmitted") ||
      st.includes("pendingsubmit") ||
      st.includes("apipending") ||
      (st.includes("submitted") && !st.includes("unsubmitted")));
  if (liveNoFill) return false;
  return true;
}

function SummaryCard({
  title,
  value,
  sub,
}: {
  title: string;
  value: string;
  sub?: string;
}) {
  return (
    <div
      style={{
        background: DECIDE_DASHBOARD.clientPanelGradient,
        border: DECIDE_DASHBOARD.panelBorder,
        borderRadius: 16,
        padding: 18,
        boxShadow: DECIDE_DASHBOARD.clientPanelShadow,
      }}
    >
      <div style={{ color: "#9ca3af", fontSize: 13, marginBottom: 8 }}>{title}</div>
      <div style={{ color: "#ffffff", fontSize: 28, fontWeight: 700 }}>{value}</div>
      {sub ? (
        <div style={{ color: "#a1a1aa", fontSize: 13, marginTop: 8 }}>{sub}</div>
      ) : null}
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2
      style={{
        color: "#ffffff",
        fontSize: 22,
        fontWeight: 700,
        marginTop: 0,
        marginBottom: 16,
      }}
    >
      {children}
    </h2>
  );
}

/** Rótulo da linha sintética LIQUIDEZ (TotalCashValue IBKR): positivo ≈ caixa; negativo ≈ margem. */
function liquidezCashLabel(value: number): string {
  return Number.isFinite(value) && value < 0
    ? "Financiamento via margem (IBKR)"
    : "T-Bills (proxy)";
}

function formatLeverageMultiple(ratio: number): string {
  if (!Number.isFinite(ratio) || ratio <= 0) return "—";
  return `${ratio.toFixed(1).replace(".", ",")}×`;
}

/** Linha devolvida por POST /api/flatten-paper-portfolio (ib_insync / IB Gateway ou TWS). */
type FlattenCloseRow = {
  ticker?: string;
  status?: string;
  requested_qty?: number;
  filled?: number;
};

function categorizeFlattenCloseRow(r: FlattenCloseRow): "skipped" | "filled" | "pending" | "error" {
  const st = String(r.status ?? "").toLowerCase();
  if (st === "skipped") return "skipped";
  if (st === "error") return "error";
  const req = Number(r.requested_qty ?? 0);
  const fil = Number(r.filled ?? 0);
  if (req > 0 && fil >= req - 1e-6) return "filled";
  if (st === "filled") return "filled";
  if (
    st === "cancelled" ||
    st === "apicancelled" ||
    (st.includes("cancel") && !st.includes("pending")) ||
    st.includes("inactive") ||
    st.includes("reject") ||
    st.includes("fail")
  ) {
    return "error";
  }
  if (fil > 0 && req > 0 && fil < req) return "pending";
  if (
    st.includes("submit") ||
    st.includes("pending") ||
    st === "pendingsubmit" ||
    st === "presubmitted" ||
    st === "apisubmitted"
  ) {
    return "pending";
  }
  return "pending";
}

function summarizeFlattenCloses(closes: unknown[]) {
  let skipped = 0;
  let filled = 0;
  let pending = 0;
  let errors = 0;
  for (const row of closes) {
    if (!row || typeof row !== "object") continue;
    const cat = categorizeFlattenCloseRow(row as FlattenCloseRow);
    if (cat === "skipped") skipped += 1;
    else if (cat === "filled") filled += 1;
    else if (cat === "pending") pending += 1;
    else errors += 1;
  }
  const attempted = filled + pending + errors;
  return { skipped, filled, pending, errors, attempted, total: closes.length };
}

/** Mapeia `closes` do POST flatten-paper-portfolio para o mesmo formato que `send-orders` → grelha de execução. */
function flattenClosesToExecFills(closes: unknown[]): ReportExecFillRow[] {
  const out: ReportExecFillRow[] = [];
  for (const row of closes) {
    if (!row || typeof row !== "object") continue;
    const o = row as Record<string, unknown>;
    const ticker = String(o.ticker ?? "").trim();
    if (!ticker) continue;
    const status = String(o.status ?? "").trim();
    const stLower = status.toLowerCase();
    const sideRaw = String(o.side ?? "").trim().toUpperCase();
    if (stLower === "skipped" && sideRaw !== "BUY" && sideRaw !== "SELL") continue;
    const action = sideRaw === "SELL" || sideRaw === "BUY" ? sideRaw : "SELL";
    const requested = Math.max(0, Math.floor(Number(o.requested_qty ?? 0)));
    const filled = Math.max(0, Math.floor(Number(o.filled ?? 0)));
    const ap = o.avg_fill_price;
    const avg =
      typeof ap === "number" && Number.isFinite(ap) && ap > 0
        ? ap
        : null;
    const msg = typeof o.message === "string" ? o.message : null;
    const executedAs =
      typeof o.executed_as === "string" && o.executed_as.trim() ? String(o.executed_as).trim() : null;
    out.push({
      ticker,
      action,
      requested_qty: requested,
      filled,
      avg_fill_price: avg,
      status: status || "Submitted",
      message: msg,
      executed_as: executedAs,
      ib_order_id: typeof o.ib_order_id === "number" ? o.ib_order_id : null,
      ib_perm_id: typeof o.ib_perm_id === "number" ? o.ib_perm_id : null,
    });
  }
  return out;
}

function formatFlattenPortfolioUserMessage(
  sum: ReturnType<typeof summarizeFlattenCloses>,
  closes: unknown[],
): string {
  let fxBuy = 0;
  let fxSell = 0;
  let stkBuy = 0;
  let stkSell = 0;
  for (const row of closes) {
    if (!row || typeof row !== "object") continue;
    const o = row as Record<string, unknown>;
    const ex = String(o.executed_as ?? "").toUpperCase();
    const side = String(o.side ?? "").toUpperCase();
    const isFx = ex === "IDEALPRO" || ex === "CASH";
    if (isFx) {
      if (side === "BUY") fxBuy += 1;
      else if (side === "SELL") fxSell += 1;
    } else if (ex === "STK" || !ex) {
      if (side === "SELL") stkSell += 1;
      else if (side === "BUY") stkBuy += 1;
    }
  }
  const fxExplain =
    fxBuy + fxSell > 0
      ? ` Incluiu fecho **cambial** (ex. EUR.USD): ${fxSell} ordem(ns) SELL e ${fxBuy} ordem(ns) BUY. Na IB, **BUY em FX após ter vendido todas as acções** é normal — fecha a perna cambial (posição negativa em moeda), **não** é recomprar o livro de acções.`
      : "";

  if (sum.attempted === 0 && sum.skipped > 0) {
    return `Nenhuma ordem de mercado enviada (${sum.skipped} linha(s) ignoradas — p.ex. não-STK).`;
  }
  if (sum.errors === 0 && sum.pending === 0 && sum.filled === sum.attempted && sum.attempted > 0) {
    return (
      `Ordens de fecho executadas na corretora (${sum.filled}/${sum.attempted}). ` +
      (stkSell + stkBuy > 0
        ? `Acções: ${stkSell} SELL / ${stkBuy} BUY (BUY = apenas cobrir shorts em STK).`
        : "") +
      fxExplain +
      ` A carteira em baixo foi sincronizada com o snapshot IBKR — confirme no IB Gateway ou na TWS se quiser.`
    );
  }
  const bits: string[] = [
    `Pedidos enviados à corretora: ${sum.attempted} linha(s) com ordem (` +
      `executada(s): ${sum.filled}, em curso/parcial(is): ${sum.pending}, erro: ${sum.errors}` +
      (sum.skipped ? `, ignoradas: ${sum.skipped}` : "") +
      `).`,
  ];
  if (stkSell + stkBuy > 0) {
    bits.push(`Acções: ${stkSell} SELL / ${stkBuy} BUY (BUY STK = cobrir short).`);
  }
  if (fxExplain) bits.push(fxExplain.trim());
  bits.push(
    "Enviar não é o mesmo que executar: com mercado aberto ou latência, o IB Gateway ou a TWS pode ainda mostrar as posições até as ordens preencherem. A tabela só reflete o que o snapshot IBKR devolver — atualizámos agora e voltaremos a pedir dentro de segundos."
  );
  return bits.join(" ");
}

type CancelOpenRow = {
  ticker?: string;
  action?: string;
  result?: string;
  status_before?: string;
  status_after?: string;
  message?: string;
  still_open?: boolean | null;
  requested_qty?: number;
};

/** Linha da tabela de execução no Plano — partilhado entre helpers e estado do componente. */
type ReportExecFillRow = {
  ticker: string;
  action: string;
  requested_qty: number;
  filled: number;
  avg_fill_price?: number | null;
  status: string;
  message?: string | null;
  executed_as?: string | null;
  ib_order_id?: number | null;
  ib_perm_id?: number | null;
};

type ReportExecSummaryRow = {
  submitted: number;
  filled: number;
  partial: number;
  failed: number;
  total: number;
};

type SyncPaperExecMeta = {
  fills_changed?: boolean;
  sync_paper_exec_lines?: string;
  ib_client_id?: number;
};

/**
 * FastAPI devolve muitas falhas de negócio com **HTTP 200** + JSON `{ status: "rejected", error: "…" }`.
 * O fallback antigo «Falha (200)» aparecia quando `error`/`detail` não eram string ou `fills` não era lista.
 */
function formatSyncPaperExecResponseFailure(
  res: Response,
  data: { status?: string; error?: unknown; detail?: unknown; fills?: unknown },
  raw: string,
): string {
  const http = res.status;
  const err = data.error;
  if (typeof err === "string" && err.trim()) {
    const core = err.trim();
    if (res.ok && typeof data.status === "string" && data.status !== "ok") {
      return `${core} Nota: HTTP ${http} com status JSON «${data.status}» — o FastAPI usa 200 mesmo quando a IBKR ou a ligação falham; o importante é o texto acima.`;
    }
    return `${core} (HTTP ${http})`;
  }
  const detail = data.detail;
  if (typeof detail === "string" && detail.trim()) {
    return `${detail.trim()} (HTTP ${http})`;
  }
  if (Array.isArray(detail) && detail.length > 0) {
    return `${JSON.stringify(detail).slice(0, 400)} (HTTP ${http})`;
  }
  const st = typeof data.status === "string" ? data.status : "—";
  const fillsOk = Array.isArray(data.fills);
  const snippet = raw.replace(/\s+/g, " ").trim().slice(0, 260);
  if (!fillsOk) {
    return `Resposta inválida: campo «fills» não é uma lista (HTTP ${http}; status JSON: «${st}»). Trecho: ${snippet || "—"}`;
  }
  return `Sincronização não concluída (HTTP ${http}; status JSON: «${st}»). Trecho: ${snippet || "—"}`;
}

/** POST /api/sync-paper-exec-lines no browser — alinha a tabela de execução com ordens/execuções na IBKR. */
async function postSyncPaperExecLinesBrowser(
  fills: ReportExecFillRow[],
): Promise<{ fills: ReportExecFillRow[]; meta?: SyncPaperExecMeta }> {
  const res = await fetch(`${window.location.origin}/api/sync-paper-exec-lines`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ paper_mode: true, fills }),
    credentials: "same-origin",
    cache: "no-store",
  });
  const raw = await res.text();
  let data: {
    status?: string;
    error?: string;
    fills?: ReportExecFillRow[];
    meta?: SyncPaperExecMeta;
    detail?: unknown;
  };
  try {
    data = JSON.parse(raw) as typeof data;
  } catch {
    throw new Error(raw.slice(0, 200) || `Resposta inválida (${res.status})`);
  }
  if (!res.ok || data.status !== "ok" || !Array.isArray(data.fills)) {
    throw new Error(formatSyncPaperExecResponseFailure(res, data, raw));
  }
  return { fills: data.fills, meta: data.meta };
}

function formatCancelOpenOrdersUserMessage(rows: CancelOpenRow[]): string {
  if (!rows.length) {
    return "Nenhuma ordem em curso para cancelar (ou já estavam concluídas / inactivas na lista da IB).";
  }
  const n = rows.length;
  const legacyOk = rows.filter((r) => r.result === "cancel_requested").length;
  const globalOk = rows.filter((r) => r.result === "global_cancel_sent").length;
  const err = rows.filter((r) => r.result === "error").length;
  const stillOpen = rows.filter((r) => r.still_open === true).length;
  const tickers = rows.map((r) => String(r.ticker || "").trim()).filter(Boolean);
  const uniq = [...new Set(tickers)].slice(0, 10);
  const bits: string[] = [];
  if (globalOk > 0) {
    bits.push(
      `Foi enviado cancelamento global (reqGlobalCancel) à IB para ${n} ordem(ns) em aberto — inclui ordens criadas por outros clientes API ou pela TWS.`,
    );
    if (stillOpen > 0) {
      bits.push(
        `Ainda ${stillOpen} linha(s) aparecem abertas após ~3s — pode ser latência; actualize «Ordens» na TWS ou volte a tentar.`,
      );
    }
  } else {
    bits.push(
      `Pedido de cancelamento enviado à corretora para ${legacyOk} ordem(ns)${err ? ` (${err} com erro)` : ""}. Confirme o estado na janela «Ordens» do IB Gateway ou da TWS.`,
    );
  }
  if (uniq.length) bits.push(`Instrumentos: ${uniq.join(", ")}${tickers.length > 10 ? "…" : ""}.`);
  return bits.join(" ");
}

/** Igualar símbolos IB (EUR.USD, EURUSD) para cruzar linhas do cancelamento com `execFills`. */
function normalizeBrokerSymbolForCancelMerge(s: string): string {
  return String(s || "")
    .trim()
    .toUpperCase()
    .replace(/\./g, "")
    .replace(/\s+/g, "");
}

function fillLooksAwaitingBroker(f: {
  status?: string;
  requested_qty?: number;
  filled?: number;
}): boolean {
  if (ibkrStatusIsTerminalCancelled(f.status ?? "")) return false;
  const st = String(f.status || "").toLowerCase();
  const req = Number(f.requested_qty ?? 0);
  const fill = Number(f.filled ?? 0);
  if (st.includes("filled") && req > 0 && fill >= req) return false;
  if (st.includes("skip_fx")) return false;
  if (st.includes("skip_sell_no_long")) return false;
  if (st.includes("inactive")) return false;
  if (
    st.includes("not_qualified") ||
    st.includes("qualify_error") ||
    st.includes("place_error") ||
    st.includes("reject") ||
    (st.includes("error") && !st.includes("presubmitted"))
  ) {
    return false;
  }
  return true;
}

function buildExecSummaryFromFills(fills: ReportExecFillRow[]): ReportExecSummaryRow {
  let submitted = 0;
  let filled = 0;
  let partial = 0;
  let failed = 0;
  for (const f of fills) {
    const st = String(f.status || "").toLowerCase();
    const reqQty = Number(f.requested_qty || 0);
    const fillQty = Number(f.filled || 0);
    if (ibkrStatusIsTerminalCancelled(f.status || "")) continue;
    if (st.includes("inactive")) continue;
    if (reqQty > 0 && fillQty + 1e-6 >= reqQty) {
      filled += 1;
    } else if (fillQty > 0 && fillQty < reqQty) {
      partial += 1;
    } else if (
      st.includes("submitted") ||
      st.includes("presubmitted") ||
      st.includes("pending")
    ) {
      submitted += 1;
    } else if (st.includes("skip_fx") || st.includes("skip_sell_no_long")) {
      /* omitida por limite FX ou cap de venda (anti-short) */
    } else {
      failed += 1;
    }
  }
  return { submitted, filled, partial, failed, total: fills.length };
}

/** Ordens a enviar em «Completar ordens pendentes» — derivadas só do estado actual da tabela. */
function buildIncompleteRetryOrdersFromFills(fills: ReportExecFillRow[]): Array<{
  ticker: string;
  side: string;
  qty: number;
}> {
  return fills
    .filter((f) => fillEligibleForCompletionRetry(f))
    .map((f) => ({
      ticker: String(f.ticker || "").trim(),
      side: String(f.action || "BUY").toUpperCase(),
      qty: Math.max(1, remainingOrderQty(f)),
    }))
    .filter((o) => o.ticker.length > 0 && o.qty > 0);
}

/**
 * Quando o POST `send-orders` faz timeout, não há `fills` na resposta. Criamos linhas provisórias a partir do plano
 * para o utilizador poder usar «Actualizar estado (IBKR)» e depois «Completar ordens pendentes» sem reenviar o lote inteiro.
 * `PreSubmitted` + 0 fill mantém `fillEligibleForCompletionRetry` falso até sincronizar (evita duplicar na IB).
 */
function buildBootstrapExecFillsFromProposedTrades(
  trades: ProposedTrade[],
  resolveIbkrSendTicker: (t: string) => string,
): ReportExecFillRow[] {
  const rows: ReportExecFillRow[] = [];
  for (const t of trades) {
    if (t.side !== "BUY" && t.side !== "SELL") continue;
    const qty = Math.floor(Number(t.absQty) || 0);
    if (qty <= 0) continue;
    const sym = String(t.ticker || "").trim().toUpperCase();
    if (sym === "EURUSD") continue;
    rows.push({
      ticker: resolveIbkrSendTicker(t.ticker),
      action: String(t.side).toUpperCase(),
      requested_qty: qty,
      filled: 0,
      avg_fill_price: null,
      status: "PreSubmitted",
      message:
        "Sem resposta a tempo do servidor DECIDE — pode já existir ordem na IBKR. Use «Actualizar estado (IBKR)» na grelha antes de reenviar tudo.",
    });
  }
  rows.sort((a, b) => {
    const pa = String(a.action).toUpperCase() === "SELL" ? 0 : 1;
    const pb = String(b.action).toUpperCase() === "SELL" ? 0 : 1;
    if (pa !== pb) return pa - pb;
    return String(a.ticker).localeCompare(String(b.ticker));
  });
  return rows;
}

function execFillMergeKey(f: { ticker?: string; action?: string }): string {
  return `${String(f.ticker || "").toUpperCase()}_${String(f.action || "").toUpperCase()}`;
}

/** Segundo envio (UCITS EUR): substitui em `prev` as linhas com o mesmo par ticker+ação e junta o novo lote. */
function mergeExecFillsAppend(
  prev: ReportExecFillRow[],
  newFills: ReportExecFillRow[],
): ReportExecFillRow[] {
  const keys = new Set(newFills.map(execFillMergeKey));
  const kept = prev.filter((f) => !keys.has(execFillMergeKey(f)));
  return [...kept, ...newFills];
}

/**
 * Após cancelamento paper na IB: actualiza o instantâneo local da tabela (antes só `send-orders` gravava aqui).
 */
function applyPaperCancelRowsToExecFills(
  fills: ReportExecFillRow[],
  rows: CancelOpenRow[],
): ReportExecFillRow[] {
  if (!fills.length) return fills;

  const bySym = new Map<string, CancelOpenRow>();
  for (const r of rows) {
    const k = normalizeBrokerSymbolForCancelMerge(String(r.ticker || ""));
    if (k) bySym.set(k, r);
  }

  const hadGlobal = rows.some((r) => r.result === "global_cancel_sent");
  const anyStillOpen = rows.some((r) => r.still_open === true);

  return fills.map((f) => {
    if (!fillLooksAwaitingBroker(f)) return { ...f };

    const symKeys = [
      normalizeBrokerSymbolForCancelMerge(f.ticker),
      normalizeBrokerSymbolForCancelMerge(String(f.executed_as || "")),
    ].filter(Boolean);

    let row: CancelOpenRow | undefined;
    for (const k of symKeys) {
      const hit = bySym.get(k);
      if (hit) {
        row = hit;
        break;
      }
    }

    if (rows.length === 0) {
      return {
        ...f,
        status: "Cancelled",
        message: [f.message, "Sincronizado após cancelamento: a corretora não reportou ordens abertas."]
          .filter(Boolean)
          .join(" "),
      };
    }

    if (row) {
      if (row.still_open === true) {
        const after = String(row.status_after || f.status || "");
        return {
          ...f,
          ...(after ? { status: after } : {}),
          message: [f.message, "Cancelamento pedido — ainda visível como aberta na IB (latência)."]
            .filter(Boolean)
            .join(" "),
        };
      }
      const after = String(row.status_after || "Cancelled");
      return {
        ...f,
        status: after,
        message: [f.message, "Ordem cancelada na corretora (Decide)."].filter(Boolean).join(" "),
      };
    }

    if (hadGlobal && !anyStillOpen) {
      return {
        ...f,
        status: "Cancelled",
        message: [f.message, "Incluída no cancelamento global na corretora."].filter(Boolean).join(" "),
      };
    }

    if (hadGlobal && anyStillOpen) {
      return {
        ...f,
        message: [f.message, "Cancelamento global enviado — confirme estado na TWS / IB Gateway."]
          .filter(Boolean)
          .join(" "),
      };
    }

    return { ...f };
  });
}

/** Mantém o passo «Decisão final» (ex.: concluído / ver carteira) após refresh ou re-fetch da página. */
const EXEC_STATE_STORAGE_KEY = "decide_report_exec_v1";

/** Alinhado ao timeout do proxy `pages/api/send-orders.ts` (300s) + margem — o browser aborta depois do proxy. */
const SEND_ORDERS_FETCH_MS = 310_000;

/**
 * O proxy `pages/api/send-orders.ts` devolve 503 + JSON quando o upstream faz timeout — o browser **não** recebe
 * `AbortError`. Sem isto, a grelha mantém instantâneos antigos (ex. «Executada») embora este envio tenha falhado.
 */
function sendOrdersErrorLooksLikeUpstreamTimeout(msg: string): boolean {
  const m = String(msg ?? "").toLowerCase();
  if (!m.includes("timeout")) return false;
  return (
    m.includes("contactar o backend") ||
    m.includes("ligação ao backend falhou") ||
    m.includes("/api/send-orders")
  );
}

/** Evita mostrar HTML de erro (502/Cloudflare/nginx) no cartão «Detalhe». */
function sanitizeExecutionErrorForUi(raw: string): string {
  const s = String(raw || "").trim();
  if (!s) return "";
  const compact = s.replace(/^\uFEFF/, "").replace(/^\s+/, "");
  if (
    /^<!DOCTYPE\s+html/i.test(compact) ||
    /^<html[\s>]/i.test(compact) ||
    /<!DOCTYPE\s+html/i.test(s) ||
    (/<html[\s>]/i.test(s) && /<\/html>/i.test(s))
  ) {
    return (
      "Resposta HTML em vez de JSON (erro no proxy ou no backend). Confirme na Vercel o " +
      "`BACKEND_URL` / `DECIDE_BACKEND_URL`, logs do FastAPI na VM, e que o processo uvicorn/gunicorn está a correr."
    );
  }
  return s.length > 1200 ? `${s.slice(0, 1200)}…` : s;
}

/** Rótulo DECIDE/Yahoo: IB usa «BRK B»; alinhamos a BRK.B na UI. */
function displayTickerLabel(ticker: string): string {
  const t = ticker.trim().toUpperCase();
  const c = t.replace(/\s+/g, "");
  if (c === "BRKB" || c === "BRK-B" || c === "BRK.B" || t === "BRK B") return "BRK.B";
  return ticker.trim();
}

/** Símbolo na URL do Yahoo (BRK.B → BRK-B). */
function yahooQuotePathSymbol(ticker: string): string {
  const compact = ticker.trim().toUpperCase().replace(/\s+/g, "");
  if (compact === "BRKB" || compact === "BRK-B" || compact === "BRK.B") return "BRK-B";
  return ticker.trim().toUpperCase().replace(/\s+/g, "").replace(/\./g, "-");
}

/** Yahoo Finance + pesquisa IB; exclui proxies DECIDE. Símbolo Yahoo: pontos → hífen (ex. BRK.B → BRK-B). */
function reportPlanTickerLinks(ticker: string): { yf: string; ib: string } | null {
  const t = ticker.trim().toUpperCase();
  if (!t || t === "TBILL_PROXY" || t === "EUR_MM_PROXY" || t === "LIQUIDEZ") return null;
  if (t === "EURUSD") {
    return {
      yf: "https://finance.yahoo.com/quote/EURUSD%3DX",
      ib: "https://www.interactivebrokers.com/en/trading/products/forex.php",
    };
  }
  const yfSym = yahooQuotePathSymbol(ticker);
  const ibQ = displayTickerLabel(ticker);
  return {
    yf: `https://finance.yahoo.com/quote/${encodeURIComponent(yfSym)}`,
    ib: `https://www.interactivebrokers.com/en/search/?q=${encodeURIComponent(ibQ)}`,
  };
}

/** Alias para código ou merges que ainda chamam `tickerHref` (evita ReferenceError). */
const tickerHref = reportPlanTickerLinks;

function reportPlanTickerLinkPair(ticker: string, yfColor: string): ReactNode {
  const href = reportPlanTickerLinks(ticker);
  if (!href) return ticker;
  const hoverUnderline = (e: MouseEvent<HTMLAnchorElement>, on: boolean) => {
    e.currentTarget.style.textDecoration = on ? "underline" : "none";
  };
  return (
    <span style={{ display: "inline-flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
      <a
        href={href.yf}
        target="_blank"
        rel="noopener noreferrer"
        title="Cotação no Yahoo Finance"
        style={{ color: yfColor, textDecoration: "none", cursor: "pointer" }}
        onClick={(e) => e.stopPropagation()}
        onMouseEnter={(e) => hoverUnderline(e, true)}
        onMouseLeave={(e) => hoverUnderline(e, false)}
      >
        {displayTickerLabel(ticker)}
      </a>
      <a
        href={href.ib}
        target="_blank"
        rel="noopener noreferrer"
        title="Pesquisar na Interactive Brokers"
        style={{ color: "#71717a", textDecoration: "none", fontSize: 11, cursor: "pointer" }}
        onClick={(e) => e.stopPropagation()}
        onMouseEnter={(e) => hoverUnderline(e, true)}
        onMouseLeave={(e) => hoverUnderline(e, false)}
      >
        IB
      </a>
    </span>
  );
}

export const getServerSideProps: GetServerSideProps<PageProps> = async (ctx) => {
  const { getClientReportServerSideProps } = await import("../../lib/server/clientReportGetServerSideProps");
  return getClientReportServerSideProps(ctx);
};

type PlanoDevResetTestPanelProps = {
  onExecuteIbkr?: () => void;
  executeBusy?: boolean;
};

function PlanoDevResetTestPanel({ onExecuteIbkr, executeBusy }: PlanoDevResetTestPanelProps) {
  return (
    <div
      style={{
        marginTop: 16,
        maxWidth: 640,
        padding: "12px 14px",
        borderRadius: 12,
        border: "1px solid rgba(251,191,36,0.55)",
        background: "rgba(251,191,36,0.12)",
        fontSize: 13,
        lineHeight: 1.5,
        color: "#fef3c7",
      }}
    >
      <strong style={{ color: "#fde68a" }}>Teste (só este browser)</strong>
      <>
        {" — "}Limpa passos de onboarding, montante, MiFID/KYC em cache, hedge, aprovação do plano e o registo local do
        Plano/Atividade. <strong>Não</strong> altera a conta IBKR nem o servidor. Para <strong>ocultar</strong> este bloco
        (ex. site público final):{" "}
        <code style={{ color: "#e2e8f0" }}>NEXT_PUBLIC_DECIDE_PLANO_DEV_RESET=0</code> no deploy.
      </>
      {onExecuteIbkr ? (
        <div style={{ marginTop: 12 }}>
          <button
            type="button"
            disabled={executeBusy}
            onClick={onExecuteIbkr}
            style={{
              cursor: executeBusy ? "wait" : "pointer",
              borderRadius: 10,
              border: "2px solid #fde68a",
              background: "linear-gradient(180deg, #0d9488 0%, #0f766e 100%)",
              color: "#ecfdf5",
              fontWeight: 800,
              fontSize: 13,
              padding: "8px 14px",
              fontFamily: "inherit",
              width: "100%",
              maxWidth: 280,
              opacity: executeBusy ? 0.75 : 1,
              boxShadow: "0 2px 12px rgba(0,0,0,0.35)",
            }}
          >
            {executeBusy ? "A enviar ordens…" : "Atalho: 1.º lote (acções / TBILL USD / FX)"}
          </button>
          <div style={{ fontSize: 11, color: "#fde68a", marginTop: 6, lineHeight: 1.4, opacity: 0.92 }}>
            Os <strong>dois botões</strong> (acções+FX e liquidez EUR) estão no separador <strong>Execução</strong> — desça
            ou mude o separador. Este atalho confirma só o <strong>primeiro lote</strong> (igual ao botão verde principal
            nesse separador). Paper: IB Gateway/TWS + backend.
          </div>
        </div>
      ) : null}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 10 }}>
        <button
          type="button"
          onClick={() => {
            if (
              !window.confirm(
                "Repor onboarding e estado local do plano neste browser? Continua com a mesma sessão de login."
              )
            ) {
              return;
            }
            clearDecideClientLocalTestState();
            window.location.assign(getNextOnboardingHref());
          }}
          style={{
            cursor: "pointer",
            borderRadius: 10,
            border: "1px solid rgba(52,211,153,0.5)",
            background: "rgba(16,185,129,0.2)",
            color: "#d1fae5",
            fontWeight: 700,
            fontSize: 13,
            padding: "8px 12px",
          }}
        >
          Repor onboarding (manter login)
        </button>
        <button
          type="button"
          onClick={() => {
            if (!window.confirm("Repor tudo e sair da sessão demo? Será enviado para o login do cliente.")) {
              return;
            }
            clearDecideClientLocalTestState({ logout: true, redirectToLogin: true });
          }}
          style={{
            cursor: "pointer",
            borderRadius: 10,
            border: "1px solid rgba(248,113,113,0.55)",
            background: "rgba(239,68,68,0.15)",
            color: "#fecaca",
            fontWeight: 700,
            fontSize: 13,
            padding: "8px 12px",
          }}
        >
          Repor + sair (como cliente novo)
        </button>
      </div>
    </div>
  );
}

export default function ClientReportPage({ reportData: reportDataIn }: PageProps) {
  const reportData = normalizeReportDataForClient(reportDataIn);
  const router = useRouter();
  const dailyEntryQueryActive = queryIndicatesDailyEntryPlanWeights(router.query as Record<string, unknown>);
  const isClientB = reportData.feeSegment === "B";
  const tbillIb = reportData.tbillProxyIbTicker;
  const excludedTickers = reportData.excludedTickersApplied || [];
  type PostApprovalStage = "idle" | "approved" | "ready" | "executing" | "done" | "failed";
  type ExecSummary = ReportExecSummaryRow | null;
  type ExecFill = ReportExecFillRow;
  const [postApprovalStage, setPostApprovalStage] = useState<PostApprovalStage>("idle");
  const [executionMessage, setExecutionMessage] = useState<string>("");
  const [execSummary, setExecSummary] = useState<ExecSummary>(null);
  /** True quando esta corrida enviou só um subconjunto (ex.: completar falhadas) — não é o plano completo de uma só vez. */
  const [lastExecBatchResidual, setLastExecBatchResidual] = useState(false);
  const [execFills, setExecFills] = useState<ExecFill[]>([]);
  /** ``plan`` = último ``send-orders``; ``flatten`` = último «Zerar posições» (grelha alinhada a fechos / Trades). */
  const [execFillsBatchKind, setExecFillsBatchKind] = useState<"plan" | "flatten">("plan");
  const execFillsRef = useRef<ExecFill[]>([]);
  /** useLayoutEffect: ref alinhada ao DOM antes do paint — evita clique em «Actualizar estado» com ref vazia. */
  useLayoutEffect(() => {
    execFillsRef.current = execFills;
  }, [execFills]);
  const [liveActualPositions, setLiveActualPositions] = useState<ActualPosition[] | null>(null);
  const [liveIbkrStructure, setLiveIbkrStructure] = useState<LiveIbkrStructure | null>(
    () => reportData.initialIbkrStructure ?? null,
  );
  const [liveSnapshotError, setLiveSnapshotError] = useState<string>("");
  const [portfolioRefreshing, setPortfolioRefreshing] = useState(false);
  const [flattenBusy, setFlattenBusy] = useState(false);
  const [flattenMessage, setFlattenMessage] = useState<string | null>(null);
  const [cancelOpenBusy, setCancelOpenBusy] = useState(false);
  const [cancelOpenMessage, setCancelOpenMessage] = useState<string | null>(null);
  const [syncExecBusy, setSyncExecBusy] = useState(false);
  /** Feedback imediato sob o botão «Actualizar estado (IBKR)» (a mensagem global fica longe no separador Execução). */
  const [syncExecError, setSyncExecError] = useState<string | null>(null);
  const [syncExecNote, setSyncExecNote] = useState<string | null>(null);
  /** «Completar pendentes»: sincroniza com a IB antes de reenviar (evita 2ª ordem quando a 1ª já preencheu). */
  const [completePendingBusy, setCompletePendingBusy] = useState(false);
  /** Private: mostrar atalho explícito para o passo 6 (hedge) — o relatório não redirecciona sozinho. */
  const [showHedgeOnboardingCta, setShowHedgeOnboardingCta] = useState(false);
  /** Voltou de `/client/approve` — explicar ligação com a aprovação regulamentar. */
  const [fromApproveNotice, setFromApproveNotice] = useState(false);
  /** Voltou de `/client/fund-account` após «Já transferi fundos» — ligar financiamento à execução. */
  const [fromFundingNotice, setFromFundingNotice] = useState(false);
  /** Botão «zerar posições» — definir NEXT_PUBLIC_SHOW_FLATTEN_BUTTON=0 para ocultar. */
  const showFlattenDevButton = process.env.NEXT_PUBLIC_SHOW_FLATTEN_BUTTON !== "0";
  /** Enviar ordem FX EUR.USD (vender USD) no mesmo POST que as ações — backend `routers/send_orders`. */
  const [coordinateFxWithEquity, setCoordinateFxWithEquity] = useState(
    () => process.env.NEXT_PUBLIC_COORDINATE_FX_WITH_EQUITY !== "0",
  );
  /** Preferências de hedge após hidratação (useMemo [] falhava no SSR e fixava null). */
  const [fxHedgePrefsClient, setFxHedgePrefsClient] = useState<ReturnType<typeof readFxHedgePrefs> | null>(null);
  const [monthlyPdfBusy, setMonthlyPdfBusy] = useState(false);
  const [planoDevResetUi, setPlanoDevResetUi] = useState(false);

  type PlanPageTab = "resumo" | "alteracoes" | "execucao" | "documentos";
  const [planTab, setPlanTab] = useState<PlanPageTab>("resumo");

  /** Abort do fetch `/api/send-orders` — permite sair do estado «A processar…». */
  const sendOrdersAbortRef = useRef<AbortController | null>(null);
  /** Evita duplo envio se o utilizador carregar várias vezes em «Executar ordens» antes do re-render. */
  const sendOrdersInFlightRef = useRef(false);
  /** Último lote enviado (acções+FX vs UCITS EUR) — «Tentar novamente» repete o mesmo. */
  const lastExecuteBatchRef = useRef<"equities_fx" | "eur_mm">("equities_fx");
  /** true só quando o utilizador carrega «Cancelar envio» (distingue de timeout automático). */
  const executeCancelRequestedRef = useRef(false);

  /** Com hedge EUR/USD activo no dashboard, enviar cobertura no mesmo POST que acções + TBILL_PROXY. */
  useEffect(() => {
    if (hedgePrefsImplyCoordinatedFx()) setCoordinateFxWithEquity(true);
  }, []);

  useEffect(() => {
    try {
      setFxHedgePrefsClient(readFxHedgePrefs());
    } catch {
      setFxHedgePrefsClient(null);
    }
  }, []);

  /** Após hidratar preferências, activar cobertura FX no mesmo envio se o dashboard tiver hedge EUR/USD. */
  useEffect(() => {
    if (!fxHedgePrefsClient) return;
    if (fxHedgePrefsClient.pct > 0 && fxHedgePrefsClient.pair === "EURUSD") {
      setCoordinateFxWithEquity(true);
    }
  }, [fxHedgePrefsClient]);

  useEffect(() => {
    try {
      setShowHedgeOnboardingCta(isFxHedgeOnboardingApplicable() && !isHedgeOnboardingDone());
    } catch {
      setShowHedgeOnboardingCta(false);
    }
  }, []);

  useEffect(() => {
    setPlanoDevResetUi(isDecidePlanoDevResetVisibleInBrowser());
  }, [router.asPath]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const params = new URLSearchParams(window.location.search);
      const from = params.get("from");
      if (from === "approve") setFromApproveNotice(true);
      else if (from === "funding") setFromFundingNotice(true);
      if (from === "approve" || from === "funding") {
        params.delete("from");
        const q = params.toString();
        const pathOnly = q ? `${window.location.pathname}?${q}` : window.location.pathname;
        window.history.replaceState({}, "", pathOnly);
      }
    } catch {
      /* ignore */
    }
  }, []);

  useLayoutEffect(() => {
    if (typeof window === "undefined") return;
    let restoredFromSession = false;
    try {
      const raw = sessionStorage.getItem(EXEC_STATE_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as {
          v?: number;
          accountCode?: string;
          stage?: PostApprovalStage;
          executionMessage?: string;
          execSummary?: ExecSummary;
          execFills?: ExecFill[];
          lastExecBatchResidual?: boolean;
          execFillsBatchKind?: "plan" | "flatten";
        };
        if (parsed.v === 1 && parsed.accountCode === reportData.accountCode) {
          if (
            parsed.stage === "approved" ||
            parsed.stage === "ready" ||
            parsed.stage === "executing" ||
            parsed.stage === "done" ||
            parsed.stage === "failed"
          ) {
            let stage = parsed.stage;
            let msg = typeof parsed.executionMessage === "string" ? parsed.executionMessage : "";
            if (stage === "executing") {
              stage = "ready";
              msg =
                "A página foi recarregada durante o envio. Confirme no IB Gateway ou na TWS se as ordens concluíram; pode usar «Executar ordens» se algo ficou incompleto.";
            }
            setPostApprovalStage(stage);
            if (msg) setExecutionMessage(sanitizeExecutionErrorForUi(msg));
            if (parsed.execSummary !== undefined) setExecSummary(parsed.execSummary);
            if (Array.isArray(parsed.execFills)) setExecFills(parsed.execFills);
            if (typeof parsed.lastExecBatchResidual === "boolean") setLastExecBatchResidual(parsed.lastExecBatchResidual);
            if (parsed.execFillsBatchKind === "flatten" || parsed.execFillsBatchKind === "plan") {
              setExecFillsBatchKind(parsed.execFillsBatchKind);
            }
            restoredFromSession = true;
          }
        }
      }
    } catch {
      /* ignore */
    }

    /** Após `/client/approve` o LS `step4` fica a 1, mas este ecrã não sabia — ficava sem «Executar ordens». */
    if (restoredFromSession) return;
    try {
      if (window.localStorage.getItem(ONBOARDING_STORAGE_KEYS.approve) === "1") {
        setPostApprovalStage("ready");
      }
    } catch {
      /* ignore */
    }
  }, [reportData.accountCode]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (postApprovalStage === "idle") {
      try {
        sessionStorage.removeItem(EXEC_STATE_STORAGE_KEY);
      } catch {
        /* ignore */
      }
      return;
    }
    try {
      sessionStorage.setItem(
        EXEC_STATE_STORAGE_KEY,
        JSON.stringify({
          v: 1,
          accountCode: reportData.accountCode,
          stage: postApprovalStage,
          executionMessage,
          execSummary,
          execFills,
          lastExecBatchResidual,
          execFillsBatchKind,
          ts: Date.now(),
        })
      );
    } catch {
      /* ignore */
    }
  }, [
    postApprovalStage,
    executionMessage,
    execSummary,
    execFills,
    lastExecBatchResidual,
    execFillsBatchKind,
    reportData.accountCode,
  ]);

  const portfolioTablePositions = useMemo(() => {
    const src = liveActualPositions ?? reportData.actualPositions;
    if (liveIbkrStructure) {
      return src.filter((p) => p.ticker !== "LIQUIDEZ");
    }
    return src;
  }, [liveActualPositions, reportData.actualPositions, liveIbkrStructure]);

  /** Peso face à soma dos títulos (exclui caixa do denominador) — leitura mais próxima dos pesos do plano à direita. */
  const portfolioDisplayRows = useMemo(() => {
    const gross = portfolioTablePositions.reduce((a, p) => a + Math.abs(p.value), 0);
    return portfolioTablePositions.map((p) => {
      const jp = applyJapaneseEquityDisplayFallback(p.ticker, {
        country: p.country,
        zone: p.zone,
        region: p.region,
        sector: p.sector,
      });
      const countryOut = String(jp.country ?? p.country ?? "");
      const regionOut = String(jp.region ?? p.region ?? "");
      let zoneOut = String(jp.zone ?? p.zone ?? "").trim();
      if (!meaningfulGeoTableCell(zoneOut)) {
        zoneOut = displayGeoZoneFromTickerAndMeta(p.ticker, {
          country: countryOut,
          region: regionOut,
          zone: "",
        });
      }
      return {
        ...p,
        weightPctSecurities: gross > 1e-9 ? (Math.abs(p.value) / gross) * 100 : 0,
        country: countryOut,
        zone: zoneOut,
        region: regionOut,
        sector: String(jp.sector ?? p.sector ?? ""),
      };
    });
  }, [portfolioTablePositions]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const h = window.location.hash.replace(/^#/, "");
    if (h === "alteracoes-propostas" || h === "carteira-atual" || h === "comparacao") {
      setPlanTab("alteracoes");
    } else if (h === "decisao-final" || h === "execucao") {
      setPlanTab("execucao");
    } else if (h === "resumo" || h === "relatorio-performance") {
      setPlanTab("resumo");
    } else if (h === "documentos") {
      setPlanTab("documentos");
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const k = window.sessionStorage.getItem("decide_report_scroll");
    if (k !== "carteira-atual") return;
    window.sessionStorage.removeItem("decide_report_scroll");
    setPlanTab("alteracoes");
    const t = window.setTimeout(() => {
      document.getElementById("carteira-atual")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 350);
    return () => window.clearTimeout(t);
  }, []);

  const incompleteRetryFromFills = useMemo(() => buildIncompleteRetryOrdersFromFills(execFills), [execFills]);

  /** Linhas inactive / erro / not qualified com qtd em falta — mesmo critério que «Executar falhadas novamente» em estado failed. */
  const retryFailedOrInactiveFromFills = useMemo(
    () =>
      execFills
        .filter((f) => {
          const st = String(f.status || "").toLowerCase();
          const failedOnly =
            st.includes("error") ||
            st.includes("rejected") ||
            st.includes("inactive") ||
            st.includes("not_qualified") ||
            st.includes("qualify_error") ||
            st.includes("place_error") ||
            st.includes("skip_zero");
          return failedOnly && remainingOrderQty(f) > 0;
        })
        .map((f) => ({
          ticker: f.ticker,
          side: String(f.action || "BUY").toUpperCase(),
          qty: Math.max(1, remainingOrderQty(f)),
        })),
    [execFills]
  );

  /** Só «concluída» quando todas as linhas deste lote estão totalmente executadas (sem pendentes/parciais/falhas). */
  const executionFullyComplete = useMemo(() => {
    if (!execSummary || execSummary.total <= 0) return false;
    return (
      execSummary.filled === execSummary.total &&
      execSummary.partial === 0 &&
      execSummary.submitted === 0 &&
      execSummary.failed === 0
    );
  }, [execSummary]);

  useEffect(() => {
    if (postApprovalStage !== "approved") return;
    const t = setTimeout(() => setPostApprovalStage("ready"), 2200);
    return () => clearTimeout(t);
  }, [postApprovalStage]);

  const scrollToOrders = () => {
    setPlanTab("alteracoes");
    window.requestAnimationFrame(() => {
      document.getElementById("alteracoes-propostas")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  /** Alterações → secção «Carteira actual» (id `carteira-atual`); delay para o conteúdo do tab existir no DOM. */
  const scrollToCarteiraAtual = () => {
    setPlanTab("alteracoes");
    window.setTimeout(() => {
      document.getElementById("carteira-atual")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 350);
  };

  /**
   * Instantâneo do último POST /send-orders. Cancelamentos feitos **só** na TWS não actualizam esta tabela;
   * o botão «Cancelar ordens não executadas (paper)» no Decide sincroniza linhas e resumo após a resposta da IB.
   */
  const clearExecutionRecordFromBroker = useCallback(() => {
    setExecFills([]);
    setExecSummary(null);
    setLastExecBatchResidual(false);
    setExecFillsBatchKind("plan");
    setPostApprovalStage("ready");
    setSyncExecError(null);
    setSyncExecNote(null);
    setExecutionMessage(
      "Registo de execução nesta página foi limpo. Ordens canceladas ou concluídas na TWS / IB Gateway não actualizam esta tabela automaticamente — a corretora é a referência. Pode voltar a enviar o plano em «Alterações propostas» abaixo.",
    );
    recordPlanActivityInfo(
      "Limpeza manual da tabela de execução nesta página (o histórico em Atividade mantém-se; só a grelha local foi reposta).",
      "Plano — DECISÃO FINAL",
    );
  }, []);

  const refreshIbkrPositionsFromIb = async (opts?: { skipExecTableSync?: boolean }) => {
    setPortfolioRefreshing(true);
    setLiveSnapshotError("");
    try {
      if (!opts?.skipExecTableSync) {
        const fillsForSync = execFillsRef.current;
        if (typeof window !== "undefined" && fillsForSync.length > 0) {
          try {
            const { fills: updated, meta: syncMeta } = await postSyncPaperExecLinesBrowser(fillsForSync);
            setExecFills(updated);
            setExecSummary(buildExecSummaryFromFills(updated));
            recordExecutionSnapshotFromSyncedFills(updated);
            const syncHint =
              syncMeta?.fills_changed === false
                ? " (nenhum campo alterado face à IB — confirme clientId da sessão de envio, conta paper e aguarde 2–3 s se acabou de executar na TWS)"
                : "";
            setExecutionMessage((prev) =>
              [prev, `Tabela de ordens sincronizada com a IBKR (junto com a carteira).${syncHint}`]
                .filter(Boolean)
                .join(" "),
            );
          } catch (syncErr: unknown) {
            const syncMsg = syncErr instanceof Error ? syncErr.message : String(syncErr);
            recordPlanActivityFailure(
              `Sincronização da tabela de ordens com a IBKR: ${syncMsg}`,
              "Plano — actualizar carteira / estado",
            );
            setExecutionMessage((prev) =>
              [prev, `Sincronização da tabela de ordens: ${syncMsg}`].filter(Boolean).join(" "),
            );
          }
        }
      }
      const apiUrl =
        typeof window !== "undefined"
          ? `${window.location.origin}/api/ibkr-snapshot`
          : "/api/ibkr-snapshot";
      const res = await fetch(apiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paper_mode: true }),
        credentials: "same-origin",
        cache: "no-store",
      });
      const rawBody = await res.text();
      let data: {
        status?: string;
        error?: string;
        detail?: unknown;
        positions?: Array<{
          ticker?: string;
          name?: string;
          sector?: string;
          qty?: number;
          market_price?: number;
          value?: number;
          currency?: string;
          weight_pct?: number;
        }>;
        net_liquidation?: number;
        net_liquidation_ccy?: string;
        cash_ledger?: { tag?: string; value?: number; currency?: string; weight_pct?: number };
      };
      try {
        data = JSON.parse(rawBody) as typeof data;
      } catch {
        throw new Error(
          rawBody?.slice(0, 200) ||
            `Resposta inválida do servidor (${res.status}). Confirme que o Next.js está a correr e que /api/ibkr-snapshot existe.`
        );
      }
      const upstreamErr =
        (typeof data?.error === "string" && data.error) ||
        (typeof data?.detail === "string" && data.detail) ||
        (Array.isArray(data?.detail) ? JSON.stringify(data.detail) : null);
      if (!res.ok || data?.status !== "ok" || !Array.isArray(data.positions)) {
        throw new Error(
          upstreamErr ||
            (res.status === 404
              ? "Endpoint /api/ibkr-snapshot não encontrado no backend — reinicie o uvicorn (app_main) na porta configurada em BACKEND_URL."
              : `Falha ao ler conta IBKR (${res.status})`)
        );
      }
      const navCcy = safeString(data.net_liquidation_ccy, "USD");
      const netLiq = safeNumber(data.net_liquidation, 0);
      const snapshotRowsRaw = data.positions.filter((p) => {
        const t = safeString(p.ticker, "").trim();
        if (!t) return false;
        if (t.includes("<") || t.toLowerCase().includes("doctype")) return false;
        return true;
      });
      /* Soma com |valor|: FX/hedge (ex. EUR.USD) pode vir com sinal oposto às acções — soma assinada dava «exposição» negativa enganadora. */
      const grossPositionsValue = snapshotRowsRaw.reduce((acc, p) => acc + Math.abs(safeNumber(p.value, 0)), 0);

      const rows: ActualPosition[] = snapshotRowsRaw.map((p) => {
        const mpx = safeNumber(p.market_price, 0);
        const val = safeNumber(p.value, 0);
        const tick = safeString(p.ticker, "").toUpperCase();
        const nm = typeof p.name === "string" ? p.name.trim() : "";
        const sec = typeof p.sector === "string" ? p.sector.trim() : "";
        const ind =
          typeof (p as { industry?: string }).industry === "string"
            ? String((p as { industry?: string }).industry).trim()
            : typeof (p as { subcategory?: string }).subcategory === "string"
              ? String((p as { subcategory?: string }).subcategory).trim()
              : "";
        const ctry =
          typeof (p as { country?: string }).country === "string"
            ? String((p as { country?: string }).country).trim()
            : "";
        const zgeo =
          typeof (p as { zone?: string }).zone === "string" ? String((p as { zone?: string }).zone).trim() : "";
        const builtin = lookupCompanyMetaEntry(tick);
        const regionBench = (builtin?.zone ?? "").trim();
        const base: ActualPosition = {
          ticker: tick,
          nameShort: nm || displayTickerLabel(tick),
          sector: sec || (builtin?.sector ?? ""),
          industry: ind,
          country: ctry || (builtin?.country ?? ""),
          zone: zgeo,
          region: regionBench,
          qty: safeNumber(p.qty, 0),
          marketPrice: mpx,
          closePrice: mpx > 0 ? mpx : null,
          value: val,
          weightPct: safeNumber(p.weight_pct, 0),
          currency: safeString(p.currency, navCcy),
        };
        const jp = applyJapaneseEquityDisplayFallback(tick, {
          country: base.country,
          zone: base.zone,
          region: base.region,
          sector: base.sector,
        });
        const countryLive = String(jp.country ?? base.country ?? "");
        const regionLive = String(jp.region ?? base.region ?? "");
        let zoneLive = String(jp.zone ?? base.zone ?? "").trim();
        if (!meaningfulGeoTableCell(zoneLive)) {
          zoneLive = displayGeoZoneFromTickerAndMeta(tick, {
            country: countryLive,
            region: regionLive,
            zone: "",
          });
        }
        return {
          ...base,
          country: countryLive,
          zone: zoneLive,
          region: regionLive,
          sector: String(jp.sector ?? base.sector ?? ""),
        };
      });
      const cl = data.cash_ledger;
      let financing = 0;
      let financingCcy = navCcy;
      if (
        cl &&
        typeof cl.value === "number" &&
        Number.isFinite(cl.value) &&
        Math.abs(cl.value) > 0.0001
      ) {
        financing = cl.value;
        financingCcy = safeString(cl.currency, navCcy);
        rows.push({
          ticker: "LIQUIDEZ",
          nameShort: "Caixa e equivalentes",
          sector: "Liquidez",
          industry: "",
          country: "",
          zone: "",
          region: "",
          qty: 0,
          marketPrice: 0,
          closePrice: null,
          value: cl.value,
          weightPct: safeNumber(cl.weight_pct, 0),
          currency: financingCcy,
        });
      }
      rows.sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
      setLiveIbkrStructure({
        netLiquidation: netLiq,
        ccy: navCcy,
        grossPositionsValue,
        financing,
        financingCcy,
      });
      setLiveActualPositions(rows);
      if (typeof window !== "undefined") {
        window.requestAnimationFrame(() => {
          document.getElementById("carteira-atual")?.scrollIntoView({ behavior: "smooth", block: "start" });
        });
      }
    } catch (e: unknown) {
      const raw = e instanceof Error ? e.message : "Não foi possível atualizar a carteira.";
      const msg =
        raw === "Failed to fetch" || raw === "Load failed" || raw === "NetworkError when attempting to fetch resource."
          ? "Sem ligação ao servidor (Next/API). Confirme que o frontend está a correr (npm run dev), que utiliza a mesma origem (URL) e que a firewall não bloqueia. Se o erro persistir, reinicie o Next e o backend (uvicorn na porta de BACKEND_URL)."
          : raw;
      recordPlanActivityFailure(
        `Actualização da carteira IBKR (snapshot): ${msg}`,
        "Plano — actualizar carteira / estado",
      );
      setLiveSnapshotError(msg);
      if (typeof window !== "undefined") {
        window.requestAnimationFrame(() => {
          document.getElementById("carteira-atual")?.scrollIntoView({ behavior: "smooth", block: "start" });
        });
      }
    } finally {
      setPortfolioRefreshing(false);
    }
  };

  /** Ao abrir o relatório, sincronizar saldo com a conta IBKR — o cartão de topo deixava de usar só tmp_diag (soube desactualizado). */
  useEffect(() => {
    void refreshIbkrPositionsFromIb();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- executar uma vez ao montar; a função fecha sobre o estado actual
  }, []);

  const sanitizeProxyErrorUiMessage = (raw: string): string => {
    const t = raw.trimStart();
    if (t.startsWith("<!") || t.toLowerCase().startsWith("<html")) {
      return (
        "O servidor devolveu HTML em vez de JSON (p.ex. HTTP 502 do gateway). " +
        "Confirme DECIDE_BACKEND_URL / BACKEND_URL na Vercel e que o FastAPI responde em …/api/health."
      );
    }
    return t.length > 900 ? `${t.slice(0, 420)}…` : raw;
  };

  const flattenPaperPortfolioAll = async () => {
    if (typeof window === "undefined") return;
    let flattenActivityRecorded = false;
    const ok = window.confirm(
      `Conta IBKR paper (teste): enviar ordens de mercado para fechar TODAS as posições em ações (incl. ${tbillIb} / proxy T-Bills) e posições Forex em pares (CASH / IDEALPRO), p.ex. EUR.USD — para poder recomprar o plano e executar hedge FX limpo.\n\n` +
        "Ordem: primeiro SELL nos longos de acções; depois BUY só para shorts em acção; por fim fecho FX. " +
        "Nota: o fecho da perna cambial pode aparecer na IB como COMPRA (BUY) em EUR.USD mesmo depois de todas as vendas — é fechar FX, não é recomprar acções.\n\n" +
        "Saldo de caixa e linha de margem não são «zerados» — apenas fecho de títulos e FX.\n\nContinuar?"
    );
    if (!ok) return;
    setFlattenBusy(true);
    setFlattenMessage(null);
    try {
      const res = await fetch(`${window.location.origin}/api/flatten-paper-portfolio`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paper_mode: true }),
        credentials: "same-origin",
        cache: "no-store",
      });
      const raw = await res.text();
      let data: { status?: string; error?: string; closes?: unknown[] };
      try {
        data = JSON.parse(raw) as typeof data;
      } catch {
        throw new Error(sanitizeProxyErrorUiMessage(raw.slice(0, 400) || `Resposta inválida (${res.status})`));
      }
      if (!res.ok || data.status !== "ok") {
        const errMsg =
          typeof data.error === "string" && data.error
            ? sanitizeProxyErrorUiMessage(data.error)
            : `Falha ao fechar posições (${res.status})`;
        recordFlattenPaperPortfolioResponse([], { error: errMsg });
        flattenActivityRecorded = true;
        throw new Error(errMsg);
      }
      const closes = Array.isArray(data.closes) ? data.closes : [];
      recordFlattenPaperPortfolioResponse(closes);
      flattenActivityRecorded = true;
      const sum = summarizeFlattenCloses(closes);
      const ff = flattenClosesToExecFills(closes);
      if (ff.length > 0) {
        setExecFills(ff);
        setExecSummary(buildExecSummaryFromFills(ff));
        setExecFillsBatchKind("flatten");
      }
      setFlattenMessage("A sincronizar a carteira com o IBKR…");
      await refreshIbkrPositionsFromIb();
      setFlattenMessage(formatFlattenPortfolioUserMessage(sum, closes));
      if (sum.pending > 0) {
        window.setTimeout(() => {
          void refreshIbkrPositionsFromIb();
        }, 4000);
        window.setTimeout(() => {
          void refreshIbkrPositionsFromIb();
        }, 9000);
      }
    } catch (e: unknown) {
      const m = sanitizeProxyErrorUiMessage(e instanceof Error ? e.message : String(e));
      if (!flattenActivityRecorded) {
        recordFlattenPaperPortfolioResponse([], { error: m });
      }
      setFlattenMessage(m);
    } finally {
      setFlattenBusy(false);
    }
  };

  const cancelOpenOrdersPaper = async () => {
    if (typeof window === "undefined") return;
    const ok = window.confirm(
      "Conta IBKR paper (teste): cancelar TODAS as ordens ainda não concluídas (submetidas / em fila / parciais) que a IB mostrar como abertas. Não fecha posições já executadas — use «Zerar posições» para isso.\n\nContinuar?"
    );
    if (!ok) return;
    setCancelOpenBusy(true);
    setCancelOpenMessage(null);
    let cancelActivityRecorded = false;
    try {
      const res = await fetch(`${window.location.origin}/api/cancel-open-orders-paper`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paper_mode: true }),
        credentials: "same-origin",
        cache: "no-store",
      });
      const raw = await res.text();
      let data: { status?: string; error?: string; cancellations?: unknown[] };
      try {
        data = JSON.parse(raw) as typeof data;
      } catch {
        throw new Error(sanitizeProxyErrorUiMessage(raw.slice(0, 400) || `Resposta inválida (${res.status})`));
      }
      if (!res.ok || data.status !== "ok") {
        throw new Error(
          typeof data.error === "string" && data.error
            ? sanitizeProxyErrorUiMessage(data.error)
            : `Falha ao cancelar ordens (${res.status})`
        );
      }
      const rows = (Array.isArray(data.cancellations) ? data.cancellations : []) as CancelOpenRow[];
      recordCancelOpenOrdersPaperResponse(rows);
      cancelActivityRecorded = true;
      setCancelOpenMessage(formatCancelOpenOrdersUserMessage(rows));
      let mergedFills: ReportExecFillRow[] = [];
      setExecFills((prev) => {
        mergedFills = applyPaperCancelRowsToExecFills(prev, rows);
        return mergedFills;
      });
      setExecSummary(mergedFills.length ? buildExecSummaryFromFills(mergedFills) : null);
      setExecutionMessage((prev) =>
        mergedFills.length
          ? [prev, "Tabela de execução sincronizada com o cancelamento na corretora."]
              .filter(Boolean)
              .join(" ")
          : prev
      );
      await refreshIbkrPositionsFromIb();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!cancelActivityRecorded) {
        recordCancelOpenOrdersPaperResponse([], { error: msg });
      }
      setCancelOpenMessage(msg);
    } finally {
      setCancelOpenBusy(false);
    }
  };

  const syncExecFillsFromIb = async (): Promise<ReportExecFillRow[] | null> => {
    if (typeof window === "undefined") return null;
    const rows =
      execFillsRef.current.length > 0 ? execFillsRef.current : execFills;
    if (!rows.length) {
      setSyncExecError(
        "Não há linhas para sincronizar. Se a tabela aparece acima, recarregue a página (F5) e tente de novo.",
      );
      setSyncExecNote(null);
      recordPlanActivityInfo(
        "Sincronização manual da tabela de execução com a IBKR: sem linhas na grelha — nada a enviar ao backend.",
        "Plano — sincronizar execução (IBKR)",
      );
      return null;
    }
    setSyncExecError(null);
    setSyncExecNote(null);
    setSyncExecBusy(true);
    try {
      const { fills: updated, meta: syncMeta } = await postSyncPaperExecLinesBrowser(rows);
      setExecFills(updated);
      setExecSummary(buildExecSummaryFromFills(updated));
      recordExecutionSnapshotFromSyncedFills(updated);
      const syncHint =
        syncMeta?.fills_changed === false
          ? "Nenhuma linha foi alterada face à última leitura da IB — confirme o mesmo clientId que no envio (TWS_CLIENT_ID_SEND_ORDERS / TWS_CLIENT_ID_SYNC_EXEC), conta paper, BACKEND_URL + uvicorn, e volte a tentar após 2–3 s se acabou de executar na TWS."
          : "Sincronização concluída — a tabela reflecte a última leitura da IB.";
      setSyncExecNote(syncHint);
      setExecutionMessage((prev) =>
        [
          prev,
          `Tabela actualizada com o estado na IBKR (ordens abertas e execuções recentes).${
            syncMeta?.fills_changed === false
              ? " " +
                "Nenhuma linha alterada — confirme clientId, conta paper e ligação ao backend."
              : ""
          }`,
        ]
          .filter(Boolean)
          .join(" "),
      );
      await refreshIbkrPositionsFromIb({ skipExecTableSync: true });
      return updated;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      const friendly =
        msg.includes("fetch") || msg.includes("Load failed") || msg.includes("NetworkError")
          ? "Sem ligação ao Next ou ao backend. Confirme npm run dev, uvicorn (BACKEND_URL no .env.local) e porta livre (ex. não repetir 8090 ocupada)."
          : msg;
      recordPlanActivityFailure(
        `Sincronização manual da tabela de execução com a IBKR: ${friendly}`,
        "Plano — sincronizar execução (IBKR)",
      );
      setSyncExecError(friendly);
      setSyncExecNote(null);
      setExecutionMessage((prev) => [prev, `Sincronização IBKR: ${msg}`].filter(Boolean).join(" "));
      return null;
    } finally {
      setSyncExecBusy(false);
    }
  };

  /** Proxies: TBILL_PROXY → ETF USD; EUR_MM_PROXY → UCITS MM EUR (CSH2/XEON), nunca misturar com o sleeve T-Bills. */
  const resolveIbkrSendTicker = (ticker: string) => {
    const u = String(ticker || "").trim().toUpperCase();
    if (u === "TBILL_PROXY") {
      const sym = String(tbillIb || "SHV").trim().toUpperCase();
      return sym.length > 0 ? sym : "SHV";
    }
    if (u === "EUR_MM_PROXY") {
      return eurMmIbTicker();
    }
    /** Plano antigo com «CSH2» explícito: respeitar ``NEXT_PUBLIC_EUR_MM_IB_TICKER`` (ex. XEON). */
    if (u === "CSH2" && eurMmIbTicker() !== "CSH2") {
      return eurMmIbTicker();
    }
    const compact = u.replace(/\s+/g, "");
    if (compact === "BRK.B" || compact === "BRK-B" || compact === "BRKB" || u === "BRK B") {
      return "BRK B";
    }
    return u;
  };

  const executeOrdersNow = async (
    ordersOverride?: Array<{ ticker: string; side: string; qty: number }>,
    options?: { batch?: "equities_fx" | "eur_mm" },
  ) => {
    if (sendOrdersInFlightRef.current) return;
    sendOrdersInFlightRef.current = true;
    try {
    const override = Array.isArray(ordersOverride) ? ordersOverride : undefined;
    const batch: "equities_fx" | "eur_mm" =
      override && override.length > 0
        ? lastExecuteBatchRef.current
        : options?.batch ?? "equities_fx";
    if (!override || override.length === 0) {
      lastExecuteBatchRef.current = batch;
    }

    setLiveActualPositions(null);
    setLiveIbkrStructure(null);
    setLiveSnapshotError("");

    const planTradesForBatch =
      override && override.length > 0
        ? proposedTradesFiltered
        : proposedTradesFiltered.filter((t) => {
            const mm = isEurMmUcitsPlanTicker(String(t.ticker || ""));
            return batch === "eur_mm" ? mm : !mm;
          });

    const rawOrders =
      override && override.length > 0
        ? override.map((o) => ({
            ...o,
            ticker: resolveIbkrSendTicker(o.ticker),
            side: String(o.side || "BUY").toUpperCase(),
            qty: Math.max(0, Math.floor(Number(o.qty) || 0)),
          }))
        : planTradesForBatch
            .filter(
              (t) =>
                (t.side === "BUY" || t.side === "SELL") &&
                t.absQty > 0 &&
                String(t.ticker).toUpperCase() !== "EURUSD",
            )
            .map((t) => ({
              ticker: resolveIbkrSendTicker(t.ticker),
              side: t.side,
              qty: Math.floor(t.absQty),
            }))
            .filter((o) => o.qty > 0);

    // Contas com margem: IB Gateway/TWS exige reduzir exposição antes de novas compras — SELL sempre antes de BUY.
    const orders = [...rawOrders].sort((a, b) => {
      const pa = String(a.side).toUpperCase() === "SELL" ? 0 : 1;
      const pb = String(b.side).toUpperCase() === "SELL" ? 0 : 1;
      if (pa !== pb) return pa - pb;
      return String(a.ticker).localeCompare(String(b.ticker));
    });

    if (orders.length === 0) {
      setExecutionMessage(
        batch === "eur_mm"
          ? "Sem ordens UCITS EUR (liquidez, ex. XEON) para executar neste plano."
          : "Sem ordens de acções, T-Bills (USD) ou vendas respeitando este filtro — nada a enviar.",
      );
      setPostApprovalStage("failed");
      return;
    }

    setLastExecBatchResidual(Boolean(override && override.length > 0));

    setExecSummary(null);
    /** Lote acções+FX: limpar grelha. Lote UCITS EUR: manter linhas anteriores e juntar ao concluir. */
    if (!override || override.length === 0) {
      if (batch === "equities_fx") {
        setExecFills([]);
      }
      setExecFillsBatchKind("plan");
    }
    executeCancelRequestedRef.current = false;
    setExecutionMessage(
      batch === "eur_mm"
        ? "A enviar ordens UCITS EUR (caixa) para a corretora… (horário Europeu; pode diferir do US RTH)"
        : "A enviar ordens para a corretora (acções, T-Bills USD, FX opcional)… (até ~5 min — IB Gateway/TWS + qualificação)",
    );
    setPostApprovalStage("executing");

    const isBatchSend = !override || override.length === 0;
    const ac = new AbortController();
    sendOrdersAbortRef.current = ac;
    const abortTimer =
      typeof window !== "undefined"
        ? window.setTimeout(() => ac.abort(), SEND_ORDERS_FETCH_MS)
        : undefined;

    let sendOrdersPayload: { fills?: unknown[]; status?: string; error?: string } | null = null;
    try {
      const sendUrl =
        typeof window !== "undefined"
          ? `${window.location.origin}/api/send-orders`
          : "/api/send-orders";
      const prefs =
        typeof window !== "undefined"
          ? readFxHedgePrefs()
          : null;
      const equityTradesForFx = proposedTradesFiltered.filter(
        (t) => !isEurMmUcitsPlanTicker(String(t.ticker || "")),
      );
      const fxHedgeUsdEstimate =
        isBatchSend && batch === "equities_fx"
          ? fxHedgeUsdNotionalForCoordinatedSend(equityTradesForFx, prefs)
          : 0;
      /**
       * Só o primeiro lote (acções + TBILL USD + linha FX): UCITS MM EUR noutro POST — horário e percurso de qualificação distintos.
       * Envios residuais («completar falhadas») não repetem FX aqui.
       */
      const sendCoordinatedFx = isBatchSend && batch === "equities_fx";

      const res = await fetch(sendUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orders,
          paper_mode: true,
          coordinate_fx_hedge: sendCoordinatedFx,
          /** Envio completo: hedge FX por compra (TWS-style); retries residuais não repetem. */
          attach_fx_hedge_per_order: sendCoordinatedFx,
          fx_hedge_usd_estimate: isBatchSend && batch === "equities_fx" ? fxHedgeUsdEstimate : 0,
        }),
        credentials: "same-origin",
        cache: "no-store",
        signal: ac.signal,
      });

      const rawSend = await res.text();
      let payload: any;
      try {
        payload = JSON.parse(rawSend);
      } catch {
        const snippet = rawSend?.slice(0, 400) || "";
        throw new Error(
          sanitizeExecutionErrorForUi(snippet) ||
            `Resposta inválida do proxy (${res.status}). Tente recarregar a página.`
        );
      }
      sendOrdersPayload = payload;
      if (!res.ok || !payload || !Array.isArray(payload.fills)) {
        throw new Error(payload?.error || `Falha de execução (${res.status})`);
      }
      // FastAPI devolve 200 com status "rejected" (ex.: IB Gateway/TWS desligado, conta não paper).
      if (payload.status === "rejected" || (payload.status && payload.status !== "ok")) {
        throw new Error(
          typeof payload.error === "string" && payload.error
            ? payload.error
            : "Pedido rejeitado pela corretora ou pelo servidor."
        );
      }

      const fills = payload.fills as Array<{
        ticker?: string;
        action?: string;
        status?: string;
        requested_qty?: number;
        filled?: number;
        avg_fill_price?: number;
        message?: string;
        executed_as?: string;
      }>;
      if (batch === "eur_mm" && (!override || override.length === 0)) {
        setExecFills((prev) => {
          const next = mergeExecFillsAppend(
            prev as ReportExecFillRow[],
            fills as ReportExecFillRow[],
          );
          setExecSummary(buildExecSummaryFromFills(next));
          return next as ExecFill[];
        });
      } else {
        setExecFills(fills as ExecFill[]);
        setExecSummary(buildExecSummaryFromFills(fills as ReportExecFillRow[]));
      }
      setExecFillsBatchKind("plan");
      const execSum = buildExecSummaryFromFills(fills as ReportExecFillRow[]);
      const batchComplete =
        fills.length > 0 &&
        execSum.filled === fills.length &&
        execSum.partial === 0 &&
        execSum.submitted === 0 &&
        execSum.failed === 0;
      setExecutionMessage(
        batchComplete
          ? "Execução concluída com retorno da corretora."
          : "Resposta da corretora recebida — execução ainda incompleta (ordens em curso, parciais ou falhadas)."
      );
      setPostApprovalStage("done");
      recordSendOrdersResponse(payload, { source: "Plano — DECISÃO FINAL" });
    } catch (e: any) {
      if (executeCancelRequestedRef.current) {
        executeCancelRequestedRef.current = false;
        recordUserAbortedSendOrders();
        setExecutionMessage(
          "Envio cancelado. Pode voltar a carregar em «Executar ordens», ir ao dashboard ou fechar este separador."
        );
        setPostApprovalStage("ready");
        return;
      }
      const isAbort =
        e?.name === "AbortError" ||
        (typeof e?.message === "string" && e.message.includes("aborted"));
      const raw = e instanceof Error ? e.message : String(e);
      const lower = raw.toLowerCase();
      const looksLikeUpstreamTimeout = sendOrdersErrorLooksLikeUpstreamTimeout(raw);
      let bootstrappedAfterTimeout = false;
      if (isBatchSend && (isAbort || looksLikeUpstreamTimeout)) {
        const bootstrap = buildBootstrapExecFillsFromProposedTrades(planTradesForBatch, resolveIbkrSendTicker);
        if (bootstrap.length > 0) {
          if (batch === "eur_mm" && (!override || override.length === 0)) {
            setExecFills((prev) => {
              const next = mergeExecFillsAppend(prev as ReportExecFillRow[], bootstrap);
              setExecSummary(buildExecSummaryFromFills(next));
              return next as ExecFill[];
            });
          } else {
            setExecFills(bootstrap);
            setExecSummary(buildExecSummaryFromFills(bootstrap));
          }
          setExecFillsBatchKind("plan");
          bootstrappedAfterTimeout = true;
        }
      }
      const msg = isAbort || looksLikeUpstreamTimeout
        ? `${looksLikeUpstreamTimeout && !isAbort ? `Timeout ao contactar o backend — ${raw}` : `Tempo limite (~${Math.round(SEND_ORDERS_FETCH_MS / 1000)}s) — o servidor não concluiu a tempo.`} Confirme: IB Gateway ou TWS ligado (paper, porta 7497), backend FastAPI a correr (BACKEND_URL no .env.local), e tente de novo. Se o IB Gateway ou a TWS estiver bloqueado num diálogo, feche-o e volte a executar.${
            bootstrappedAfterTimeout
              ? " Foram criadas linhas provisórias na tabela (a partir do plano) — na grelha abaixo use primeiro «Actualizar estado (IBKR)»; se após sincronizar aparecer quantidade em falta, use «Completar ordens pendentes» em vez de reenviar o lote completo."
              : ""
          }`
        : lower === "failed to fetch" ||
            lower === "fetch failed" ||
            lower.includes("networkerror") ||
            lower === "load failed"
          ? "Sem ligação ao Next ou ao backend. Confirme: (1) npm run dev na pasta frontend (porta 4701), (2) uvicorn na porta de BACKEND_URL no .env.local (ex. 8090), (3) firewall/antivírus a não bloquear localhost."
          : raw;
      const safeMsg = sanitizeExecutionErrorForUi(msg || "Falha ao enviar ordens para a corretora.");
      setExecutionMessage(safeMsg);
      setPostApprovalStage("failed");
      recordSendOrdersResponse(sendOrdersPayload, {
        source: "Plano — DECISÃO FINAL",
        batchError: safeMsg,
      });
    } finally {
      if (typeof abortTimer === "number") window.clearTimeout(abortTimer);
      sendOrdersAbortRef.current = null;
    }
    } finally {
      sendOrdersInFlightRef.current = false;
    }
  };

  const handleCompletePendingOrders = async () => {
    if (incompleteRetryFromFills.length === 0) return;
    setCompletePendingBusy(true);
    try {
      const updated = await syncExecFillsFromIb();
      if (!updated) return;
      const retry = buildIncompleteRetryOrdersFromFills(updated);
      if (retry.length === 0) {
        setExecutionMessage((prev) =>
          [
            prev,
            "Depois de sincronizar com a IBKR, as ordens já estavam concluídas — não foi enviada nova ordem (evita duplicar compras parciais).",
          ]
            .filter(Boolean)
            .join(" "),
        );
        return;
      }
      await executeOrdersNow(retry);
    } finally {
      setCompletePendingBusy(false);
    }
  };

  const cancelExecuteOrdersSend = () => {
    executeCancelRequestedRef.current = true;
    sendOrdersAbortRef.current?.abort();
  };
  const enforceMaxExclusions = (e: { currentTarget: HTMLInputElement }) => {
    const form = e.currentTarget.form;
    if (!form) return;
    const checked = form.querySelectorAll('input[name="exclude"]:checked').length;
    if (checked > 5) {
      e.currentTarget.checked = false;
    }
  };

  const recommendedFiltered = useMemo(() => {
    const src = reportData.recommendedPositions || [];
    return src.map((p) => {
      const jp = applyJapaneseEquityDisplayFallback(
        p.ticker,
        {
          country: p.country,
          geoZone: p.geoZone,
          region: p.region,
          sector: p.sector,
        } as Record<string, unknown>,
        { country: "country", zone: "geoZone", region: "region", sector: "sector" },
      );
      const p1 = {
        ...p,
        country: String(jp.country ?? p.country ?? ""),
        geoZone: String(jp.geoZone ?? p.geoZone ?? ""),
        region: String(jp.region ?? p.region ?? ""),
        sector: String(jp.sector ?? p.sector ?? ""),
      };
      const gz = (p1.geoZone || "").trim();
      if (meaningfulGeoTableCell(gz)) return p1;
      const filled = displayGeoZoneFromTickerAndMeta(p.ticker, {
        country: p1.country,
        region: p1.region,
        zone: p1.geoZone,
      });
      if (!filled) return p1;
      return { ...p1, geoZone: filled };
    });
  }, [reportData.recommendedPositions]);
  const proposedTradesFiltered = reportData.proposedTrades || [];
  const proposedTradesEquitiesFx = useMemo(
    () => proposedTradesFiltered.filter((t) => !isEurMmUcitsPlanTicker(String(t.ticker || ""))),
    [proposedTradesFiltered],
  );
  const proposedTradesEurMm = useMemo(
    () => proposedTradesFiltered.filter((t) => isEurMmUcitsPlanTicker(String(t.ticker || ""))),
    [proposedTradesFiltered],
  );
  const equityFxExecutableCount = useMemo(
    () =>
      proposedTradesEquitiesFx.filter(
        (t) =>
          (t.side === "BUY" || t.side === "SELL") &&
          t.absQty > 0 &&
          String(t.ticker).toUpperCase() !== "EURUSD",
      ).length,
    [proposedTradesEquitiesFx],
  );
  const eurMmExecutableCount = useMemo(
    () =>
      proposedTradesEurMm.filter(
        (t) =>
          (t.side === "BUY" || t.side === "SELL") &&
          t.absQty > 0 &&
          String(t.ticker).toUpperCase() !== "EURUSD",
      ).length,
    [proposedTradesEurMm],
  );

  const handleDownloadMonthlyRecommendationPdf = useCallback(async () => {
    if (typeof window === "undefined") return;
    setMonthlyPdfBusy(true);
    try {
      const { downloadMonthlyRecommendationPdf } = await import("../../lib/monthlyRecommendationPdf");
      const sleeve = planLiquidezVsAccoesPctFromRecommended(recommendedFiltered);
      const liquidezPct =
        sleeve?.liquidezPct ?? safeNumber(reportData.tbillsProxyWeightPct, 0);
      const acoesPct =
        sleeve?.acoesPct ?? Math.max(0, Math.min(100, 100 - liquidezPct));

      await downloadMonthlyRecommendationPdf({
        logoUrl: `${window.location.origin}/images/imagem-final-logo-decide.png`,
        generatedAtIso: reportData.generatedAt,
        accountCode: reportData.accountCode,
        profile: reportData.profile,
        modelDisplayName: reportData.modelDisplayName,
        closeAsOfDate: reportData.closeAsOfDate,
        navFormatted: formatMoneyCompact(reportData.navEur, reportData.accountBaseCurrency),
        proposedTradesCoverageNote: reportData.proposedTradesCoverageNote,
        planSummary: reportData.planSummary,
        liquidezPct,
        acoesPct,
        proposedTrades: proposedTradesFiltered.map((t) => ({
          ticker: t.ticker,
          side: t.side,
          absQty: t.absQty,
          nameShort: t.nameShort,
          targetWeightPct: t.targetWeightPct,
        })),
        recommendedPositions: recommendedFiltered.map((p) => ({
          ticker: p.ticker,
          nameShort: p.nameShort,
          weightPct: p.weightPct,
          sector: p.sector,
          industry: p.industry,
          region: p.region,
          country: p.country,
          geoZone: p.geoZone,
          excluded: p.excluded,
        })),
      });
    } catch (err) {
      console.error(err);
      window.alert(
        "Não foi possível gerar o PDF. Confirme o logótipo em /public/images/imagem-final-logo-decide.png e tente novamente.",
      );
    } finally {
      setMonthlyPdfBusy(false);
    }
  }, [reportData, proposedTradesFiltered, recommendedFiltered]);

  /** Soma dos pesos «Peso» no plano excluindo CSH2/MM, T-Bills proxy e EURUSD — base para «% só títulos (plano)». */
  const recommendedEquitySleeveDenomPct = useMemo(() => {
    let s = 0;
    for (const p of recommendedFiltered) {
      if (p.excluded) continue;
      if (isRecommendedCashOrHedgeRowTicker(p.ticker)) continue;
      s += safeNumber(p.weightPct, 0);
    }
    return s;
  }, [recommendedFiltered]);

  const portfolioVsPlanAlignmentPct = useMemo(
    () => computePortfolioVsPlanCoveragePct(recommendedFiltered, portfolioTablePositions),
    [recommendedFiltered, portfolioTablePositions],
  );

  /** Só as linhas da tabela de execução (útil em envio residual — não confundir com alinhamento da carteira). */
  const execTableFillProgressPct = useMemo(() => {
    if (!execFills.length) return null as number | null;
    let req = 0;
    let fil = 0;
    for (const f of execFills) {
      const r = Number(f.requested_qty ?? 0);
      const x = Number(f.filled ?? 0);
      if (r > 0) {
        req += r;
        fil += Math.min(x, r);
      }
    }
    if (req <= 0) return null;
    return Math.min(100, Math.round((fil / req) * 1000) / 10);
  }, [execFills]);

  const fxCoordinatedUsdEstimate = useMemo(
    () => fxHedgeUsdNotionalForCoordinatedSend(proposedTradesEquitiesFx, fxHedgePrefsClient),
    [proposedTradesEquitiesFx, fxHedgePrefsClient],
  );

  const planTradeCount = proposedTradesFiltered.length;
  const execResponseLineCount = execFills.length;
  const cashSleeveOrdersInProgress = useMemo(() => {
    if (postApprovalStage !== "done") return false;
    return execFills.some(
      (f) =>
        isDecideCashSleeveBrokerSymbol(String(f.ticker || "")) &&
        execStatusDisplay(f) === "Em curso",
    );
  }, [postApprovalStage, execFills]);
  const showPlanVsExecResponseMismatch =
    postApprovalStage === "done" &&
    !lastExecBatchResidual &&
    execFillsBatchKind !== "flatten" &&
    planTradeCount > 0 &&
    execResponseLineCount > 0 &&
    execResponseLineCount !== planTradeCount;

  const tradeVolumeGrossAbs = proposedTradesFiltered.reduce((acc, t) => {
    if (t.side === "BUY" && isBuyMissingEquityClosePrice(t)) return acc;
    return acc + Math.abs(t.deltaValueEst);
  }, 0);
  const buyNotionalAbs = proposedTradesFiltered
    .filter((t) => t.side === "BUY")
    .reduce(
      (acc, t) => acc + (isBuyMissingEquityClosePrice(t) ? 0 : Math.abs(t.deltaValueEst)),
      0,
    );
  const sellNotionalAbs = proposedTradesFiltered
    .filter((t) => t.side === "SELL")
    .reduce((acc, t) => acc + Math.abs(t.deltaValueEst), 0);
  /** Alinhar com planSummary.turnoverPct: maior perna vs NAV (não soma de todas as linhas). */
  const planTurnoverNotional = Math.max(buyNotionalAbs, sellNotionalAbs);
  const buyCountVisible = proposedTradesFiltered.filter((t) => t.side === "BUY").length;
  const sellCountVisible = proposedTradesFiltered.filter((t) => t.side === "SELL").length;
  const turnoverPctRaw =
    reportData.navEur > 0 ? (planTurnoverNotional / reportData.navEur) * 100 : 0;
  const initialConstitutionClient =
    reportData.navEur > 0 &&
    sellNotionalAbs / reportData.navEur < 0.06 &&
    buyNotionalAbs > reportData.navEur * 0.25;
  const turnoverPctVisible = capPctDisplay(
    initialConstitutionClient && turnoverPctRaw > 100 ? Math.min(100, turnoverPctRaw) : turnoverPctRaw,
  );
  const ccy = reportData.accountBaseCurrency || "EUR";
  /** Património líquido / moeda: preferir snapshot IBKR em tempo real; o SSR usa ibkr_paper_smoke_test.json em tmp_diag. */
  const summaryNavLiquidation = liveIbkrStructure?.netLiquidation ?? reportData.navEur;
  const summaryNavCcy = liveIbkrStructure?.ccy ?? ccy;
  const summaryCashSubtitle = (() => {
    if (liveIbkrStructure && Math.abs(liveIbkrStructure.financing) > 1e-4) {
      const neg = liveIbkrStructure.financing < 0;
      return `${neg ? "Financiamento margem (IBKR)" : "Caixa à ordem (IBKR)"}: ${formatMoneyCompact(
        liveIbkrStructure.financing,
        liveIbkrStructure.financingCcy,
      )}`;
    }
    if (liveIbkrStructure) {
      return `Caixa (último plano): ${formatMoneyCompact(reportData.cashEur, summaryNavCcy)} · liquidez em «Carteira atual»`;
    }
    return `Cash (snapshot em tmp_diag): ${formatMoneyCompact(reportData.cashEur, ccy)}`;
  })();

  const sectorWeights = (() => {
    const map = new Map<string, number>();
    for (const p of recommendedFiltered || []) {
      const sectorRaw = safeString(p.sector, "").trim();
      const sector = sectorRaw || "—";
      const w = Number.isFinite(p.weightPct) ? p.weightPct : 0;
      map.set(sector, (map.get(sector) || 0) + w);
    }
    return Array.from(map.entries())
      .map(([sector, weightPct]) => ({ sector, weightPct }))
      .sort((a, b) => b.weightPct - a.weightPct);
  })();

  const sectorTop10 = sectorWeights.slice(0, 10);

  const runExecuteOrdersFromUi = () => {
    if (postApprovalStage === "executing") return;
    if (equityFxExecutableCount < 1) {
      window.alert("Neste plano não há ordens de acções / T-Bills (USD) — use o outro botão se houver liquidez UCITS EUR (XEON, …).");
      return;
    }
    if (
      !window.confirm(
        "Enviar acções, sleeve T-Bills (USD) e, se activo, cobertura FX na mesma operação. UCITS de liquidez em EUR (XEON) fica de fora — use o segundo botão noutro horário se precisar.\n\nConta paper IBKR. Confirme: IB Gateway ou TWS, backend DECIDE acessível.",
      )
    ) {
      return;
    }
    setPlanTab("execucao");
    void executeOrdersNow(undefined, { batch: "equities_fx" });
  };

  const runExecuteEurMmFromUi = () => {
    if (postApprovalStage === "executing") return;
    if (eurMmExecutableCount < 1) {
      window.alert(
        "Não há ordens de liquidez UCITS EUR (EUR_MM_PROXY, XEON, …) neste plano — nada a enviar neste lote.",
      );
      return;
    }
    if (
      !window.confirm(
        "Enviar só o money market em EUR (p.ex. XEON) — listagem/horário Europeu, distinto de acções em USD e T-Bills.\n\nConta paper IBKR.",
      )
    ) {
      return;
    }
    setPlanTab("execucao");
    void executeOrdersNow(undefined, { batch: "eur_mm" });
  };

  return (
    <>
      <Head>
        <title>DECIDE | Plano do Cliente</title>
      </Head>

      <div
        style={{
          minHeight: "100vh",
          background: DECIDE_DASHBOARD.pageBg,
          color: DECIDE_DASHBOARD.text,
          padding: "24px 24px 48px 24px",
          fontFamily: DECIDE_APP_FONT_FAMILY,
        }}
      >
        <div style={{ maxWidth: 1440, margin: "0 auto" }}>
          {fromApproveNotice ? (
            <div
              style={{
                marginBottom: 22,
                padding: "16px 20px",
                borderRadius: 16,
                border: DECIDE_DASHBOARD.flowTealCardBorderStrong,
                background: DECIDE_DASHBOARD.flowTealPanelGradientSoft,
                color: "#ccfbf1",
                fontSize: 14,
                lineHeight: 1.6,
                maxWidth: 900,
              }}
            >
              <strong style={{ color: "#ffffff" }}>Continuação natural do passo «Aprovação de recomendações».</strong>{" "}
              Nesta página usa-se o <strong style={{ color: "#e2e8f0" }}>mesmo plano</strong> (ficheiros em{" "}
              <code style={{ color: DECIDE_DASHBOARD.accentSky }}>tmp_diag</code>) que acabou de aprovar. No separador{" "}
              <strong style={{ color: "#e2e8f0" }}>Execução</strong> revê as ordens e pode enviá-las à corretora; o{" "}
              <Link href="/client-dashboard" style={{ color: DECIDE_DASHBOARD.link, fontWeight: 700 }}>dashboard</Link>{" "}
              resume a conta, não substitui este documento.
            </div>
          ) : null}
          {fromFundingNotice ? (
            <div
              style={{
                marginBottom: 22,
                padding: "16px 20px",
                borderRadius: 16,
                border: DECIDE_DASHBOARD.flowTealCardBorderStrong,
                background: DECIDE_DASHBOARD.flowTealPanelGradientSoft,
                color: "#ccfbf1",
                fontSize: 14,
                lineHeight: 1.6,
                maxWidth: 900,
              }}
            >
              <strong style={{ color: "#ffffff" }}>Próximo passo após o financiamento.</strong> Quando os fundos estiverem
              disponíveis na sua conta IBKR, abra o separador <strong style={{ color: "#e2e8f0" }}>Execução</strong> nesta
              página para rever e enviar as ordens do plano. Se ainda não vê saldo suficiente, aguarde a liquidação da
              transferência (normalmente 1–2 dias úteis).
            </div>
          ) : null}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: 20,
              alignItems: "flex-start",
              flexWrap: "wrap",
              marginBottom: 24,
            }}
          >
            <div>
              <div style={{ color: DECIDE_DASHBOARD.accentSky, fontSize: 14, fontWeight: 700, marginBottom: 8 }}>
                DECIDE AI
              </div>
              <h1
                style={{
                  fontSize: 34,
                  lineHeight: 1.1,
                  margin: 0,
                  color: "#ffffff",
                }}
              >
                Plano do Cliente
              </h1>
              <div
                style={{
                  marginTop: 14,
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 10,
                  alignItems: "center",
                }}
              >
                <span style={{ color: "#71717a", fontSize: 13, fontWeight: 700 }}>Pesos do modelo</span>
                <Link
                  href={clientReportHrefFromQuery(router.query, "monthly")}
                  style={{
                    fontSize: 13,
                    fontWeight: 700,
                    textDecoration: "none",
                    borderRadius: 999,
                    padding: "6px 12px",
                    border: dailyEntryQueryActive
                      ? "1px solid rgba(63,63,70,0.75)"
                      : "1px solid rgba(153,246,228,0.55)",
                    color: dailyEntryQueryActive ? "#a1a1aa" : "#99f6e4",
                    background: dailyEntryQueryActive ? "rgba(39,39,42,0.72)" : "rgba(20,83,45,0.25)",
                  }}
                >
                  Fecho mensal (série)
                </Link>
                <Link
                  href={clientReportHrefFromQuery(router.query, "daily_entry")}
                  style={{
                    fontSize: 13,
                    fontWeight: 700,
                    textDecoration: "none",
                    borderRadius: 999,
                    padding: "6px 12px",
                    border: dailyEntryQueryActive
                      ? "1px solid rgba(153,246,228,0.55)"
                      : "1px solid rgba(63,63,70,0.75)",
                    color: dailyEntryQueryActive ? "#99f6e4" : "#a1a1aa",
                    background: dailyEntryQueryActive ? "rgba(20,83,45,0.25)" : "rgba(39,39,42,0.72)",
                  }}
                >
                  Constituição hoje (último CSV)
                </Link>
              </div>
              <div style={{ color: "#a1a1aa", marginTop: 10, fontSize: 15 }}>
                Conta IBKR: {reportData.accountCode || "—"} · Perfil:{" "}
                {reportData.profile || "moderado"} · {reportData.modelDisplayName} · Gerado em{" "}
                {reportData.generatedAt.slice(0, 19).replace("T", " ")}
                {reportData.closeAsOfDate ? (
                  <>
                    {" "}
                    · Close até: {reportData.closeAsOfDate}
                  </>
                ) : null}
                {reportData.planWeightsProvenance ? (
                  <>
                    {" "}
                    · Pesos-alvo SSR:{" "}
                    <strong style={{ color: "#fde68a" }}>
                      {reportData.planWeightsProvenance.mode === "official_csv"
                        ? "CSV oficial (último rebalance)"
                        : reportData.planWeightsProvenance.mode === "live_model"
                          ? "motor live (as_of hoje)"
                          : reportData.planWeightsProvenance.mode === "freeze_snapshot"
                            ? "snapshot freeze CAP15 (CSV oficial em falta)"
                            : "payload motor (fallback)"}
                    </strong>
                    {reportData.planWeightsProvenance.rebalanceDate
                      ? ` · data ${reportData.planWeightsProvenance.rebalanceDate}`
                      : ""}
                    {reportData.planWeightsProvenance.officialCalendarRebalanceDate ? (
                      <>
                        {" "}
                        · série mensal (referência):{" "}
                        {reportData.planWeightsProvenance.officialCalendarRebalanceDate}
                      </>
                    ) : null}
                    {reportData.planWeightsProvenance.dailyEntryPlanTargetApplied ? (
                      <>
                        {" "}
                        · alvo entrada (último CSV até hoje vs fecho mensal)
                      </>
                    ) : null}
                    {reportData.planWeightsProvenance.mergeSourcePath ? (
                      <>
                        {" "}
                        · merge:{" "}
                        <span style={{ color: "#a3a3a3", wordBreak: "break-all" }}>
                          {reportData.planWeightsProvenance.mergeSourcePath}
                        </span>
                      </>
                    ) : null}
                    {" "}
                    · meses no histórico: {reportData.planWeightsProvenance.officialHistoryMonthsLoaded} · linhas
                    grelha: {reportData.planWeightsProvenance.recommendedLineCount}
                    {typeof reportData.planWeightsProvenance.planGeoAdjustmentsDisabled === "boolean" ? (
                      <>
                        {" "}
                        · cap zona vs índice:{" "}
                        <strong style={{ color: "#fde68a" }}>
                          {reportData.planWeightsProvenance.planGeoAdjustmentsDisabled
                            ? "OFF (ajustes plano)"
                            : reportData.planWeightsProvenance.planZoneCapVsBenchmarkDisabled
                              ? "OFF (1,3×)"
                              : `${reportData.planWeightsProvenance.planZoneCapMult ?? 1.3}× activo`}
                        </strong>
                      </>
                    ) : null}
                  </>
                ) : null}
              </div>
              <div
                style={{
                  marginTop: 10,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                  borderRadius: 999,
                  border: DECIDE_DASHBOARD.flowTealCardBorder,
                  background: DECIDE_DASHBOARD.flowTealBadgeBg,
                  color: "#99f6e4",
                  fontSize: 12,
                  fontWeight: 800,
                  padding: "6px 10px",
                }}
              >
                Modelo ativo: {reportData.modelDisplayName}
              </div>
              {reportData.backendError ? (
                <div style={{ color: "#fca5a5", marginTop: 12, fontSize: 14 }}>
                  Aviso backend: {reportData.backendError}
                </div>
              ) : null}
              {planoDevResetUi ? (
                <PlanoDevResetTestPanel
                  onExecuteIbkr={runExecuteOrdersFromUi}
                  executeBusy={postApprovalStage === "executing"}
                />
              ) : null}
            </div>

            <div
              style={{
                display: "flex",
                gap: 12,
                flexWrap: "wrap",
                alignItems: "center",
              }}
            >
              <ClientFlowDashboardButton />
              {showHedgeOnboardingCta ? (
                <Link
                  href="/client/fx-hedge-onboarding"
                  style={{
                    background: DECIDE_DASHBOARD.kpiMenuMainButtonBackground,
                    border: DECIDE_DASHBOARD.kpiMenuMainButtonBorder,
                    color: DECIDE_DASHBOARD.kpiMenuMainButtonColor,
                    textDecoration: "none",
                    borderRadius: 12,
                    padding: "10px 18px",
                    fontWeight: 800,
                    fontSize: 14,
                    whiteSpace: "nowrap",
                    boxShadow: DECIDE_DASHBOARD.kpiMenuMainButtonShadow,
                  }}
                >
                  Hedge cambial (passo 6)
                </Link>
              ) : null}
            </div>
          </div>

          <div
            style={{
              marginBottom: 20,
              padding: "14px 16px",
              borderRadius: 14,
              border: DECIDE_DASHBOARD.flowTealCardBorder,
              background: DECIDE_DASHBOARD.flowTealPanelGradient,
              display: "flex",
              flexWrap: "wrap",
              gap: 12,
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <div style={{ fontSize: 13, color: "#cbd5e1", lineHeight: 1.5, maxWidth: 560 }}>
              <strong style={{ color: "#ecfdf5" }}>Navegação do plano:</strong> use os separadores{" "}
              <strong style={{ color: "#fff" }}>Resumo</strong>, <strong style={{ color: "#fff" }}>Alterações</strong>,{" "}
              <strong style={{ color: "#fff" }}>Execução</strong> e <strong style={{ color: "#fff" }}>Documentos</strong>{" "}
              abaixo — evita scroll longo e separa decisão, comparação, envio à corretora e arquivo formal do plano. A{" "}
              <strong style={{ color: "#fff" }}>aprovação regulamentar</strong> continua na página dedicada.
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
              <button
                type="button"
                onClick={() => setPlanTab("alteracoes")}
                style={{
                  background: DECIDE_DASHBOARD.kpiMenuMainButtonBackground,
                  color: DECIDE_DASHBOARD.kpiMenuMainButtonColor,
                  borderRadius: 12,
                  padding: "10px 16px",
                  fontWeight: 800,
                  fontSize: 13,
                  border: DECIDE_DASHBOARD.kpiMenuMainButtonBorder,
                  whiteSpace: "nowrap",
                  boxShadow: DECIDE_DASHBOARD.kpiMenuMainButtonShadow,
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                Ir para Alterações
              </button>
              <Link
                href="/client/approve"
                style={{
                  background: "transparent",
                  color: "#99f6e4",
                  textDecoration: "none",
                  borderRadius: 12,
                  padding: "10px 16px",
                  fontWeight: 800,
                  fontSize: 13,
                  border: DECIDE_DASHBOARD.flowTealCardBorderStrong,
                  whiteSpace: "nowrap",
                }}
              >
                Aprovar plano (regulamentar)
              </Link>
            </div>
          </div>

          <div
            style={{
              display: "flex",
              gap: 12,
              flexWrap: "wrap",
              alignItems: "center",
              marginBottom: 24,
            }}
          >
            <Link
              href="/client/ibkr-prep"
              style={{
                background: DECIDE_DASHBOARD.linkPillTeal,
                border: DECIDE_DASHBOARD.kpiMenuMainButtonBorder,
                color: "#99f6e4",
                textDecoration: "none",
                borderRadius: 999,
                padding: "10px 16px",
                fontWeight: 600,
                fontSize: 13,
                boxShadow: `${DECIDE_DASHBOARD.buttonShadowSoft}, inset 0 1px 0 rgba(255,255,255,0.06)`,
              }}
            >
              Preparar abertura IBKR
            </Link>
            {showHedgeOnboardingCta ? (
              <Link
                href="/client/fx-hedge-onboarding"
                style={{
                  background: "rgba(6, 78, 74, 0.28)",
                  border: DECIDE_DASHBOARD.flowTealCardBorder,
                  color: "#99f6e4",
                  textDecoration: "none",
                  borderRadius: 999,
                  padding: "10px 16px",
                  fontWeight: 600,
                  fontSize: 13,
                  boxShadow: `${DECIDE_DASHBOARD.buttonShadowSoft}, inset 0 1px 0 rgba(255,255,255,0.06)`,
                }}
              >
                Preferências de hedge cambial
              </Link>
            ) : null}
          </div>
          {showHedgeOnboardingCta ? (
            <p style={{ margin: "0 0 20px 0", fontSize: 13, color: "#a1a1aa", lineHeight: 1.55, maxWidth: 720 }}>
              Segmento <strong style={{ color: "#e2e8f0" }}>fee B</strong> (NAV ≥ 50k) ou{" "}
              <strong style={{ color: "#e2e8f0" }}>Private</strong>: esta página não avança sozinha para o hedge.
              Use o botão acima para o passo <strong style={{ color: DECIDE_DASHBOARD.link }}>Hedge cambial</strong> (KPIs com cobertura
              FX no dashboard).
            </p>
          ) : null}

          <>
          <div
            role="tablist"
            aria-label="Secções do plano"
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 8,
              marginBottom: 24,
              padding: 6,
              borderRadius: 14,
              background: "rgba(24,24,27,0.72)",
              border: DECIDE_DASHBOARD.panelBorder,
            }}
          >
            {(
              [
                { id: "resumo" as const, label: "Resumo" },
                { id: "alteracoes" as const, label: "Alterações" },
                { id: "execucao" as const, label: "Execução" },
                { id: "documentos" as const, label: "Documentos" },
              ] as const
            ).map((t) => {
              const active = planTab === t.id;
              const execAttention =
                t.id === "execucao" &&
                (postApprovalStage === "ready" ||
                  postApprovalStage === "executing" ||
                  postApprovalStage === "failed" ||
                  (postApprovalStage === "done" && !executionFullyComplete));
              return (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setPlanTab(t.id)}
                  style={{
                    borderRadius: 10,
                    padding: "10px 18px",
                    fontWeight: 800,
                    fontSize: 14,
                    cursor: "pointer",
                    border: active ? DECIDE_DASHBOARD.kpiMenuMainButtonBorder : "1px solid transparent",
                    background: active ? DECIDE_DASHBOARD.kpiMenuMainButtonBackground : "transparent",
                    color: active ? DECIDE_DASHBOARD.kpiMenuMainButtonColor : "#a1a1aa",
                    boxShadow: active ? DECIDE_DASHBOARD.kpiMenuMainButtonShadow : undefined,
                    fontFamily: "inherit",
                  }}
                >
                  {t.label}
                  {execAttention ? (
                    <span
                      style={{ marginLeft: 8, fontSize: 11, color: "#fbbf24", fontWeight: 700 }}
                      title="Estado de execução em curso ou para rever"
                    >
                      ●
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
          {postApprovalStage === "ready" && planTab !== "execucao" ? (
            <div
              style={{
                marginTop: 0,
                marginBottom: 20,
                padding: "12px 16px",
                borderRadius: 12,
                border: "1px solid rgba(45, 212, 191, 0.35)",
                background: "rgba(6, 78, 74, 0.2)",
                color: "#a7f3d0",
                fontSize: 14,
                lineHeight: 1.55,
                maxWidth: 820,
              }}
            >
              <strong style={{ color: "#ecfdf5" }}>Envio em dois lotes (acções + T-Bills USD + FX / separado, EUR):</strong> abra
              o separador{" "}
              <button
                type="button"
                onClick={() => setPlanTab("execucao")}
                style={{
                  display: "inline",
                  margin: "0 4px",
                  padding: "3px 12px",
                  borderRadius: 8,
                  border: "1px solid #2dd4bf",
                  background: "rgba(45, 212, 191, 0.15)",
                  color: "#5eead4",
                  fontWeight: 800,
                  cursor: "pointer",
                  fontSize: 13,
                  fontFamily: "inherit",
                }}
              >
                Execução
              </button>{" "}
              (secção <strong style={{ color: "#e2e8f0" }}>Decisão final</strong>) — a caixa de teste amarela no topo é só
              atalho para o 1.º lote; o 2.º lote (liquidez EUR) está nesse separador.
            </div>
          ) : null}

          {planTab === "resumo" ? (
          <>
          <div
            style={{
              background: DECIDE_DASHBOARD.clientPanelGradient,
              border: DECIDE_DASHBOARD.panelBorder,
              borderRadius: 18,
              padding: "22px 24px",
              marginBottom: 28,
              boxShadow: DECIDE_DASHBOARD.clientPanelShadowMedium,
            }}
          >
            <div
              style={{
                color: DECIDE_DASHBOARD.accentSky,
                fontSize: 12,
                fontWeight: 800,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                marginBottom: 10,
              }}
            >
              Resumo do plano
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
                gap: 18,
                fontSize: 15,
                lineHeight: 1.55,
                color: "#e2e8f0",
              }}
            >
              <div>
                <div style={{ color: "#a1a1aa", fontSize: 13, marginBottom: 4 }}>Estratégia</div>
                <div style={{ fontWeight: 700, color: "#ffffff" }}>
                  {reportData.planSummary.strategyLabel}
                </div>
              </div>
              <div>
                <div style={{ color: "#a1a1aa", fontSize: 13, marginBottom: 4 }}>Perfil de risco</div>
                <div style={{ fontWeight: 700, color: "#ffffff" }}>
                  {reportData.planSummary.riskLabel}
                </div>
              </div>
              <div>
                <div style={{ color: "#a1a1aa", fontSize: 13, marginBottom: 4 }}>Posições alvo</div>
                <div style={{ fontWeight: 700, color: "#ffffff" }}>
                  {reportData.planSummary.positionCount}
                </div>
                <div style={{ color: "#a1a1aa", fontSize: 12, marginTop: 4 }}>
                  Caixa / MM EUR ({reportData.tbillProxyIbTicker}): {formatPct(reportData.tbillsProxyWeightPct)}
                </div>
              </div>
              <div>
                <div style={{ color: "#a1a1aa", fontSize: 13, marginBottom: 4 }}>Rotação proposta</div>
                <div style={{ fontWeight: 700, color: "#ffffff" }}>
                  ~{formatPct(reportData.planSummary.turnoverPct)} do NAV de referência do plano (estimativa)
                </div>
                <div style={{ color: "#a1a1aa", fontSize: 12, marginTop: 4, lineHeight: 1.45, maxWidth: 420 }}>
                  {reportData.planSummary.initialConstitution &&
                  (reportData.planSummary.turnoverPctTechnical ?? 0) > 100 ? (
                    <>
                      <strong style={{ color: "#cbd5e1" }}>Constituição inicial (a partir de caixa):</strong> o objectivo é
                      alocar o património de referência do modelo (~100%). A percentagem técnica das ordens de compra
                      (soma dos Δ, várias moedas e linhas) pode ultrapassar 100% — mostramos{" "}
                      <strong style={{ color: "#e2e8f0" }}>até 100%</strong> aqui; o cálculo bruto seria ~
                      {formatPct(reportData.planSummary.turnoverPctTechnical ?? 0)}.
                    </>
                  ) : (
                    <>Inclui reestruturação inicial da carteira quando aplicável.</>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
              gap: 16,
              marginBottom: 28,
            }}
          >
            <SummaryCard
              title={liveIbkrStructure ? "Valor atual da conta (IBKR)" : "Valor atual da conta"}
              value={formatMoneyCompact(summaryNavLiquidation, summaryNavCcy)}
              sub={summaryCashSubtitle}
            />
            <SummaryCard
              title="CAGR do modelo"
              value={formatPct(reportData.totalReturnPct)}
              sub={reportData.displayCagrModelSubLabel}
            />
            <SummaryCard
              title="CAGR do benchmark"
              value={formatPct(reportData.benchmarkCagrPct)}
              sub={reportData.displayCagrBenchmarkSubLabel}
            />
            <SummaryCard
              title="Fee segment"
              value={reportData.feeSegment}
              sub={
                reportData.feeSegment === "A"
                  ? "20 € / mês"
                  : "0,6% / ano + 15% performance fee"
              }
            />
          </div>

          <div
            id="relatorio-performance"
            style={{
              background: DECIDE_DASHBOARD.clientPanelGradient,
              border: DECIDE_DASHBOARD.panelBorder,
              borderRadius: 18,
              padding: 20,
              marginBottom: 28,
              boxShadow: DECIDE_DASHBOARD.clientPanelShadow,
            }}
          >
            <SectionTitle>Performance</SectionTitle>
            <p
              style={{
                color: "#a1a1aa",
                fontSize: 14,
                marginTop: -8,
                marginBottom: 18,
                lineHeight: 1.55,
              }}
            >
              {reportData.displayHorizonLabel}. Valores passados não garantem resultados futuros.
            </p>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                gap: 14,
                marginBottom: 18,
              }}
            >
              <div style={{ color: "#cbd5e1" }}>
                <strong style={{ color: "#ffffff" }}>Sharpe:</strong>{" "}
                {reportData.sharpe.toFixed(2)}
              </div>
              <div style={{ color: "#cbd5e1" }}>
                <strong style={{ color: "#ffffff" }}>Volatilidade:</strong>{" "}
                {formatPct(reportData.volatilityPct)}
              </div>
              <div style={{ color: "#cbd5e1" }}>
                <strong style={{ color: "#ffffff" }}>Max Drawdown:</strong>{" "}
                {formatPct(reportData.maxDrawdownPct)}
              </div>
              <div style={{ color: "#cbd5e1" }}>
                <strong style={{ color: "#ffffff" }}>Sharpe benchmark:</strong>{" "}
                {reportData.benchmarkSharpe.toFixed(2)}
              </div>
            </div>

            <div style={{ width: "100%", height: 420 }}>
              <ResponsiveContainer>
                <LineChart data={reportData.series}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                  <XAxis dataKey="date" stroke="#a1a1aa" />
                  <YAxis
                    stroke="#a1a1aa"
                    domain={["auto", "auto"]}
                    allowDataOverflow={false}
                    tickFormatter={(v) => `${Number(v).toFixed(0)}%`}
                  />
                  <Tooltip
                    contentStyle={{
                      background: DECIDE_DASHBOARD.clientChartTooltipBg,
                      border: "1px solid #334155",
                      borderRadius: 12,
                      color: "#ffffff",
                    }}
                  />
                  <Legend />
                  <Line
                    type="monotone"
                    dataKey="benchmark"
                    name="Benchmark"
                    dot={false}
                    stroke="#a1a1aa"
                    strokeWidth={2}
                  />
                  <Line
                    type="monotone"
                    dataKey="overlayed"
                    name={reportData.modelDisplayName}
                    dot={false}
                    stroke={DECIDE_DASHBOARD.flowTealChartStroke}
                    strokeWidth={3}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div
            style={{
              marginTop: 4,
              marginBottom: 0,
              padding: "14px 18px",
              borderRadius: 14,
              border: DECIDE_DASHBOARD.flowTealCardBorder,
              background: "rgba(6, 78, 74, 0.2)",
              maxWidth: 720,
            }}
          >
            <p style={{ margin: 0, fontSize: 14, color: "#cbd5e1", lineHeight: 1.55 }}>
              <strong style={{ color: "#ecfdf5" }}>Próximo passo:</strong> comparar carteiras e trades no separador{" "}
              <button
                type="button"
                onClick={() => setPlanTab("alteracoes")}
                style={{
                  background: "transparent",
                  border: "none",
                  color: DECIDE_DASHBOARD.accentSky,
                  fontWeight: 800,
                  cursor: "pointer",
                  textDecoration: "underline",
                  fontFamily: "inherit",
                  fontSize: "inherit",
                  padding: 0,
                }}
              >
                Alterações
              </button>
              ; depois confirme e envie ordens em{" "}
              <button
                type="button"
                onClick={() => setPlanTab("execucao")}
                style={{
                  background: "transparent",
                  border: "none",
                  color: DECIDE_DASHBOARD.accentSky,
                  fontWeight: 800,
                  cursor: "pointer",
                  textDecoration: "underline",
                  fontFamily: "inherit",
                  fontSize: "inherit",
                  padding: 0,
                }}
              >
                Execução
              </button>
              .
            </p>
          </div>
          </>
          ) : null}

          {planTab === "alteracoes" ? (
          <>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)",
              gap: 16,
              marginBottom: 28,
            }}
          >
            <div
              id="carteira-atual"
              style={{
                background: DECIDE_DASHBOARD.clientPanelGradient,
                border: DECIDE_DASHBOARD.panelBorder,
                borderRadius: 18,
                padding: "16px 12px",
                overflowX: "auto",
                minWidth: 0,
                boxShadow: DECIDE_DASHBOARD.clientPanelShadow,
              }}
            >
              <h2
                style={{
                  color: "#ffffff",
                  fontSize: 22,
                  fontWeight: 700,
                  margin: "0 0 16px 0",
                  lineHeight: 1.2,
                }}
              >
                Carteira atual (IBKR real)
              </h2>
              <p style={{ margin: "0 0 14px 0", fontSize: 12, color: "#71717a", lineHeight: 1.5, maxWidth: 560 }}>
                Quando o servidor alcança a API IBKR, esta tabela usa o <strong style={{ color: "#a1a1aa" }}>mesmo</strong>{" "}
                snapshot live que a aba <strong style={{ color: "#a1a1aa" }}>Carteira</strong> — não a lista longa
                de <code style={{ color: "#a1a1aa" }}>tmp_diag</code> (export de ordens / testes). Se o backend estiver
                indisponível no carregamento inicial, o plano pode cair nesse fallback até sincronizar. Depois de
                executar ordens, use <strong style={{ color: "#a1a1aa" }}>Ver carteira atualizada</strong> no bloco de
                execução: leva a este separador <strong style={{ color: "#a1a1aa" }}>Alterações</strong> ·{" "}
                <strong style={{ color: "#a1a1aa" }}>Carteira atual</strong>, sincroniza posições na IBKR e, se houver
                linhas de execução nessa página, actualiza também «Em curso» / «Executada».
              </p>
              {liveActualPositions ? (
                <p style={{ margin: "0 0 12px 0", fontSize: 12, color: DECIDE_DASHBOARD.accentSky, fontWeight: 600 }}>
                  A mostrar a carteira em tempo real (IBKR).
                </p>
              ) : null}
              {liveSnapshotError ? (
                <p style={{ margin: "0 0 12px 0", fontSize: 12, color: "#fca5a5" }}>{liveSnapshotError}</p>
              ) : null}
              {liveIbkrStructure ? (
                <div
                  style={{
                    margin: "0 0 16px 0",
                    padding: "14px 16px",
                    background: "linear-gradient(180deg, rgba(39,39,42,0.9) 0%, rgba(24,24,27,0.95) 100%)",
                    border: "1px solid rgba(148,163,184,0.35)",
                    borderRadius: 14,
                    maxWidth: "100%",
                  }}
                >
                  <div style={{ fontSize: 14, fontWeight: 700, color: "#e2e8f0", marginBottom: 12 }}>
                    Estrutura da carteira (IBKR)
                  </div>
                  <div style={{ display: "grid", gap: 10, fontSize: 12, color: "#cbd5e1" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
                      <span style={{ color: "#a1a1aa" }}>Capital próprio (valor líquido)</span>
                      <strong style={{ color: "#f8fafc" }}>
                        {formatMoneyCompact(liveIbkrStructure.netLiquidation, liveIbkrStructure.ccy)}
                      </strong>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
                      <span style={{ color: "#a1a1aa" }}>Exposição em títulos</span>
                      <strong style={{ color: "#f8fafc" }}>
                        {formatMoneyCompact(liveIbkrStructure.grossPositionsValue, liveIbkrStructure.ccy)}
                      </strong>
                    </div>
                    {Math.abs(liveIbkrStructure.financing) > 1e-4 ? (
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
                        <span style={{ color: "#a1a1aa" }}>
                          {liveIbkrStructure.financing < 0
                            ? "Financiamento via margem (IBKR)"
                            : "Saldo de caixa (IBKR, proxy T-Bills)"}
                        </span>
                        <strong style={{ color: liveIbkrStructure.financing < 0 ? "#fca5a5" : DECIDE_DASHBOARD.accentSky }}>
                          {formatMoneyCompact(liveIbkrStructure.financing, liveIbkrStructure.financingCcy)}
                        </strong>
                      </div>
                    ) : null}
                    {liveIbkrStructure.netLiquidation > 1e-6 && liveIbkrStructure.grossPositionsValue > 1e-6 ? (
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
                        <span style={{ color: "#a1a1aa" }}>Alavancagem implícita (exposição ÷ capital próprio)</span>
                        <strong style={{ color: DECIDE_DASHBOARD.accentSky }}>
                          {formatLeverageMultiple(liveIbkrStructure.grossPositionsValue / liveIbkrStructure.netLiquidation)}
                        </strong>
                      </div>
                    ) : null}
                  </div>
                  <p style={{ margin: "10px 0 0 0", fontSize: 11, color: "#71717a", lineHeight: 1.45 }}>
                    «Exposição em títulos» = soma dos <strong style={{ color: "#a1a1aa" }}>valores absolutos</strong> das
                    linhas do snapshot (acções, ETF, FX). O hedge <strong style={{ color: "#a1a1aa" }}>EURUSD</strong> pode
                    dominar o somatório assinado antigo; a tabela abaixo continua a listar cada linha com o sinal da
                    corretora.
                  </p>
                  {liveIbkrStructure.financing < -1e-4 ? (
                    <p style={{ margin: "12px 0 0 0", fontSize: 12, color: "#a1a1aa", lineHeight: 1.5 }}>
                      Valor negativo indica financiamento automático da corretora para suportar exposição superior ao
                      capital disponível. Não é uma posição vendida em T-Bills; o sleeve T-Bills do plano executa como ETF{" "}
                      <strong style={{ color: "#cbd5e1" }}>{tbillIb}</strong> na ordem «TBILL_PROXY».
                    </p>
                  ) : Math.abs(liveIbkrStructure.financing) > 1e-4 ? (
                    <p style={{ margin: "12px 0 0 0", fontSize: 12, color: "#a1a1aa", lineHeight: 1.5 }}>
                      Saldo à ordem (IBKR <code style={{ color: "#a1a1aa" }}>TotalCashValue</code>), não um título. O
                      sleeve T-Bills do plano executa como ETF <strong style={{ color: "#cbd5e1" }}>{tbillIb}</strong> na ordem
                      «TBILL_PROXY».
                    </p>
                  ) : null}
                </div>
              ) : null}
              {liveIbkrStructure ? (
                <p style={{ margin: "0 0 12px 0", fontSize: 11, color: "#71717a", lineHeight: 1.45, maxWidth: 560 }}>
                  A tabela seguinte lista <strong style={{ color: "#a1a1aa" }}>só títulos</strong>. Caixa e financiamento
                  via margem estão no bloco «Estrutura da carteira».
                </p>
              ) : null}
              <p style={{ margin: "0 0 12px 0", fontSize: 11, color: "#71717a", lineHeight: 1.45, maxWidth: "100%" }}>
                <strong style={{ color: "#a1a1aa" }}>Pesos:</strong> «% do capital» = valor da posição ÷ património
                líquido total na IBKR (a caixa entra no denominador e dilui cada título). «% só títulos» = valor ÷ soma
                dos títulos nesta tabela (sem caixa). Para comparar com o plano, use a coluna{" "}
                <strong style={{ color: "#a1a1aa" }}>«% só títulos (plano)»</strong> à direita — o «Peso» do plano inclui
                ainda <strong style={{ color: "#a1a1aa" }}>CSH2</strong> / caixa e o hedge <strong style={{ color: "#a1a1aa" }}>EURUSD</strong>, por isso sozinho parece mais baixo que «% só títulos» daqui. Se
                executou quase todo o plano e só vê poucas linhas de <strong style={{ color: "#a1a1aa" }}>acções</strong>,
                confirme na TWS/Gateway linhas <strong style={{ color: "#a1a1aa" }}>FX</strong>, ordens inactivas ou outra
                conta/subconta — o snapshot reflecte o que a API IBKR devolve neste momento.
              </p>
              <div style={{ overflowX: "auto", maxWidth: "100%", WebkitOverflowScrolling: "touch" }}>
              <table
                style={{
                  minWidth: 1180,
                  width: "100%",
                  borderCollapse: "collapse",
                  fontSize: 12,
                }}
              >
                <thead>
                  <tr style={{ color: "#a1a1aa", textAlign: "left" }}>
                    <th style={{ padding: "6px 4px", width: "9%", lineHeight: 1.2 }}>Ticker</th>
                    <th style={{ padding: "6px 4px", width: "14%", lineHeight: 1.2 }}>Empresa</th>
                    <th style={{ padding: "6px 4px", width: "8%", lineHeight: 1.2 }}>País</th>
                    <th style={{ padding: "6px 4px", width: "8%", lineHeight: 1.2 }}>Zona</th>
                    <th style={{ padding: "6px 4px", width: "8%", lineHeight: 1.2 }}>Região</th>
                    <th style={{ padding: "6px 4px", width: "10%", lineHeight: 1.2 }}>Sector</th>
                    <th style={{ padding: "6px 4px", width: "10%", lineHeight: 1.2 }}>Indústria</th>
                    <th style={{ padding: "6px 4px", width: "7%", lineHeight: 1.2 }}>Qtd</th>
                    <th style={{ padding: "6px 4px", width: "8%", lineHeight: 1.2 }}>Preço</th>
                    <th style={{ padding: "6px 4px", width: "9%", lineHeight: 1.2 }}>Valor</th>
                    <th style={{ padding: "6px 4px", width: "5%", lineHeight: 1.2 }}>% cap.</th>
                    <th style={{ padding: "6px 4px", width: "6%", lineHeight: 1.2 }}>% risco</th>
                  </tr>
                </thead>
                <tbody>
                  {portfolioDisplayRows.length === 0 ? (
                    <tr>
                      <td colSpan={12} style={{ padding: 12, color: "#a1a1aa" }}>
                        Sem posições reais disponíveis.
                      </td>
                    </tr>
                  ) : (
                    portfolioDisplayRows.map((p, idx) => (
                      <tr key={`${p.ticker}-${idx}`} style={{ borderTop: DECIDE_DASHBOARD.panelBorder }}>
                        <td style={{ padding: "6px 4px", color: "#ffffff", fontWeight: 700, wordBreak: "break-word" }}>
                          {(() => {
                            const label =
                              p.ticker === "BIL" ||
                              p.ticker === "SHV" ||
                              p.ticker === "SGOV" ||
                              p.ticker === tbillIb
                                ? `${displayTickerLabel(p.ticker)} (T-Bills)`
                                : p.ticker === "LIQUIDEZ"
                                ? liquidezCashLabel(Number(p.value))
                                : displayTickerLabel(p.ticker);
                            const href = reportPlanTickerLinks(p.ticker);
                            return href ? (
                              <a href={href.yf} target="_blank" rel="noreferrer" style={{ color: DECIDE_DASHBOARD.accentSky, textDecoration: "none" }}>
                                {label}
                              </a>
                            ) : (
                              label
                            );
                          })()}
                        </td>
                        <td
                          style={{
                            padding: "6px 4px",
                            color: "#d4d4d8",
                            wordBreak: "break-word",
                            overflowWrap: "anywhere",
                          }}
                        >
                          {p.ticker === "LIQUIDEZ" ? "—" : p.nameShort || "—"}
                        </td>
                        <td style={{ padding: "6px 4px", color: "#a1a1aa", wordBreak: "break-word" }}>
                          {p.ticker === "LIQUIDEZ" ? "—" : p.country || "—"}
                        </td>
                        <td style={{ padding: "6px 4px", color: "#a1a1aa", wordBreak: "break-word" }}>
                          {p.ticker === "LIQUIDEZ" ? "—" : p.zone || "—"}
                        </td>
                        <td style={{ padding: "6px 4px", color: "#a1a1aa", wordBreak: "break-word" }}>
                          {p.ticker === "LIQUIDEZ" ? "—" : p.region || "—"}
                        </td>
                        <td style={{ padding: "6px 4px", color: "#a1a1aa", wordBreak: "break-word" }}>
                          {p.ticker === "LIQUIDEZ" ? "—" : p.sector || "—"}
                        </td>
                        <td style={{ padding: "6px 4px", color: "#a1a1aa", wordBreak: "break-word" }}>
                          {p.ticker === "LIQUIDEZ" ? "—" : p.industry || "—"}
                        </td>
                        <td style={{ padding: "6px 4px", fontVariantNumeric: "tabular-nums" }}>
                          {p.ticker === "LIQUIDEZ" ? "—" : formatQty(p.qty)}
                        </td>
                        <td style={{ padding: "6px 4px", fontVariantNumeric: "tabular-nums", wordBreak: "break-word" }}>
                          {p.ticker === "LIQUIDEZ"
                            ? "—"
                            : typeof p.closePrice === "number" && p.closePrice > 0
                            ? p.closePrice.toFixed(2)
                            : "—"}
                          {p.ticker === "LIQUIDEZ" ? "" : ` ${p.currency}`}
                        </td>
                        <td style={{ padding: "6px 4px", fontVariantNumeric: "tabular-nums" }}>
                          {formatMoneyCompact(p.value, p.currency)}
                        </td>
                        <td style={{ padding: "6px 4px", fontVariantNumeric: "tabular-nums" }}>{formatPct(p.weightPct)}</td>
                        <td style={{ padding: "6px 4px", fontVariantNumeric: "tabular-nums" }}>
                          {formatPct(p.weightPctSecurities)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
              </div>
              {showFlattenDevButton ? (
                <div
                  style={{
                    marginTop: 16,
                    padding: "12px 14px",
                    borderRadius: 12,
                    border: "1px solid rgba(248,113,113,0.45)",
                    background: "rgba(127,29,29,0.25)",
                  }}
                >
                  <div style={{ fontSize: 12, fontWeight: 700, color: "#fecaca", marginBottom: 6 }}>
                    Temporário (testes) — zerar posições na paper
                  </div>
                  <p style={{ margin: "0 0 10px 0", fontSize: 12, color: "#fca5a5", lineHeight: 1.45 }}>
                    Envia ordens de mercado para fechar <strong style={{ color: "#fef2f2" }}>todas</strong> as posições em
                    ações (STK), incluindo {tbillIb}, e depois posições <strong style={{ color: "#fef2f2" }}>Forex</strong>{" "}
                    (EUR.USD, etc.) para ficar limpo a recomprar e executar o FX no mesmo envio. Ordem no IB Gateway ou na TWS:{" "}
                    <strong style={{ color: "#fef2f2" }}>SELL</strong> (longos) primeiro; só depois{" "}
                    <strong style={{ color: "#fef2f2" }}>BUY</strong> para shorts em acção — depois pausa e{" "}
                    <strong style={{ color: "#fef2f2" }}>fecho FX</strong> (pode ser <strong style={{ color: "#fef2f2" }}>BUY</strong> em EUR.USD
                    na corretora: é fechar a perna cambial, não recomprar acções). A tabela só actualiza quando o snapshot IBKR mostrar quantidades a
                    zero. O botão laranja pede à IB um{" "}
                    <strong style={{ color: "#fef2f2" }}>cancelamento global</strong> de todas as ordens ainda abertas
                    (inclui ordens criadas por outro cliente API ou na TWS). Conta{" "}
                    <strong style={{ color: "#fef2f2" }}>paper</strong> apenas.
                  </p>
                  <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      gap: 10,
                      alignItems: "center",
                    }}
                  >
                    <button
                      type="button"
                      disabled={flattenBusy || cancelOpenBusy || portfolioRefreshing}
                      onClick={() => void flattenPaperPortfolioAll()}
                      style={{
                        background: flattenBusy ? "#7f1d1d" : "#b91c1c",
                        border: "1px solid rgba(252,165,165,0.6)",
                        color: "#fff7ed",
                        borderRadius: 10,
                        padding: "10px 14px",
                        fontWeight: 800,
                        fontSize: 13,
                        cursor: flattenBusy || cancelOpenBusy || portfolioRefreshing ? "wait" : "pointer",
                      }}
                    >
                      {flattenBusy ? (
                        <>
                          A enviar ordens de fecho
                          <InlineLoadingDots />
                        </>
                      ) : (
                        "Zerar todas as posições (paper)"
                      )}
                    </button>
                    <button
                      type="button"
                      disabled={flattenBusy || cancelOpenBusy || portfolioRefreshing}
                      onClick={() => void cancelOpenOrdersPaper()}
                      style={{
                        background: cancelOpenBusy ? "rgba(154,52,18,0.5)" : "rgba(234,88,12,0.35)",
                        border: "1px solid rgba(251,146,60,0.65)",
                        color: "#ffedd5",
                        borderRadius: 10,
                        padding: "10px 14px",
                        fontWeight: 800,
                        fontSize: 13,
                        cursor: flattenBusy || cancelOpenBusy || portfolioRefreshing ? "wait" : "pointer",
                      }}
                    >
                      {cancelOpenBusy ? (
                        <>
                          A cancelar ordens
                          <InlineLoadingDots />
                        </>
                      ) : (
                        "Cancelar ordens não executadas (paper)"
                      )}
                    </button>
                  </div>
                  {flattenMessage ? (
                    <p style={{ margin: "10px 0 0 0", fontSize: 12, color: "#fecaca", lineHeight: 1.45 }}>
                      {flattenMessage}
                    </p>
                  ) : null}
                  {cancelOpenMessage ? (
                    <p
                      style={{
                        margin: flattenMessage ? "8px 0 0 0" : "10px 0 0 0",
                        fontSize: 12,
                        color: "#fdba74",
                        lineHeight: 1.45,
                      }}
                    >
                      {cancelOpenMessage}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>

            <div
              style={{
                background: DECIDE_DASHBOARD.clientPanelGradient,
                border: DECIDE_DASHBOARD.panelBorder,
                borderRadius: 18,
                padding: "16px 12px",
                overflowX: "auto",
                minWidth: 0,
                boxShadow: DECIDE_DASHBOARD.clientPanelShadow,
              }}
            >
              <SectionTitle>Carteira recomendada (DECIDE)</SectionTitle>
              <p style={{ margin: "0 0 14px 0", fontSize: 12, color: "#71717a", lineHeight: 1.5, maxWidth: 720 }}>
                Os pesos em <strong style={{ color: "#a1a1aa" }}>Peso</strong> são alvos do modelo sobre a{" "}
                <strong style={{ color: "#a1a1aa" }}>carteira completa</strong> (acções + caixa/MM tipo{" "}
                <strong style={{ color: "#a1a1aa" }}>CSH2</strong> + hedge <strong style={{ color: "#a1a1aa" }}>EURUSD</strong>{" "}
                quando existir). A coluna <strong style={{ color: "#a1a1aa" }}>% só títulos (plano)</strong> volta a
                dividir só pelas linhas de <em>risco</em> (exclui CSH2, T-Bills na corretora e EURUSD), para alinhar com
                «% só títulos» na carteira IBKR à esquerda — aí as percentagens devem aproximar-se, salvo drift e títulos
                que ainda não tem na conta.
              </p>
              {reportData.planTargetRebalanceDate ? (
                <p style={{ margin: "0 0 14px 0", fontSize: 12, color: "#86efac", lineHeight: 1.5, maxWidth: 720 }}>
                  Data de referência do alvo:{" "}
                  <strong style={{ color: "#bbf7d0" }}>{reportData.planTargetRebalanceDate}</strong>. Ordem: (1)
                  pesos oficiais com <code style={{ color: "#d9f99d" }}>rebalance_date</code> = hoje; (2) senão o
                  último rebalance no CSV ≤ hoje. Só com{" "}
                  <code style={{ color: "#d9f99d" }}>DECIDE_PLAN_USE_LIVE_MODEL_WHEN_OFFICIAL_DATE_BEFORE_TODAY=1</code>{" "}
                  no deploy se usa o motor em vez do CSV quando o último export ainda não inclui o dia corrente.
                </p>
              ) : null}
              <div style={{ overflowX: "auto", maxWidth: "100%", WebkitOverflowScrolling: "touch" }}>
              <table
                style={{
                  minWidth: 960,
                  width: "100%",
                  borderCollapse: "collapse",
                  fontSize: 12,
                }}
              >
                <thead>
                  <tr style={{ color: "#a1a1aa", textAlign: "left" }}>
                    <th style={{ padding: "6px 4px", width: "11%", lineHeight: 1.2 }}>Ticker</th>
                    <th style={{ padding: "6px 4px", width: "18%", lineHeight: 1.2 }}>Empresa</th>
                    <th style={{ padding: "6px 4px", width: "9%", lineHeight: 1.2 }}>País</th>
                    <th style={{ padding: "6px 4px", width: "9%", lineHeight: 1.2 }}>Zona</th>
                    <th
                      style={{ padding: "6px 4px", width: "8%", lineHeight: 1.2 }}
                      title="Alvo do modelo em % do património total (NAV), incluindo caixa/MM nas linhas respectivas."
                    >
                      Peso
                    </th>
                    <th
                      style={{ padding: "6px 4px", width: "8%", lineHeight: 1.2 }}
                      title={
                        "Parte desta linha na soma só de títulos de risco (exclui caixa, MM, T-Bills proxy e EURUSD). " +
                        "Quando quase todo o NAV está em liquidez, esta coluna pode parecer «grande» em poucas linhas — " +
                        "olhe sempre também «Peso» (% NAV) à esquerda; não é peso no índice de referência."
                      }
                    >
                      % só títulos (plano)
                    </th>
                    <th style={{ padding: "6px 4px", width: "12%", lineHeight: 1.2 }}>Sector</th>
                    <th style={{ padding: "6px 4px", width: "12%", lineHeight: 1.2 }}>Indústria</th>
                    <th style={{ padding: "6px 4px", width: "9%", lineHeight: 1.2 }}>Região</th>
                  </tr>
                </thead>
                <tbody>
                  {recommendedFiltered.map((p) => (
                    <tr
                      key={p.ticker}
                      style={{
                        borderTop: DECIDE_DASHBOARD.panelBorder,
                        opacity: p.excluded ? 0.55 : 1,
                      }}
                    >
                      <td style={{ padding: "6px 4px", color: "#ffffff", fontWeight: 700, wordBreak: "break-word" }}>
                        {(() => {
                          const href = reportPlanTickerLinks(p.ticker);
                          if (!href) return displayTickerLabel(p.ticker);
                          return (
                            <span style={{ display: "inline-flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                              <a href={href.yf} target="_blank" rel="noreferrer" style={{ color: DECIDE_DASHBOARD.accentSky, textDecoration: "none" }}>
                                {displayTickerLabel(p.ticker)}
                              </a>
                              <a href={href.ib} target="_blank" rel="noreferrer" style={{ color: "#71717a", textDecoration: "none", fontSize: 11 }}>
                                IB
                              </a>
                            </span>
                          );
                        })()}
                      </td>
                      <td style={{ padding: "6px 4px", wordBreak: "break-word", overflowWrap: "anywhere" }}>
                        {p.nameShort || p.ticker}
                        {p.excluded ? (
                          <span
                            style={{
                              marginLeft: 8,
                              fontSize: 11,
                              color: "#fca5a5",
                              border: "1px solid #7f1d1d",
                              borderRadius: 999,
                              padding: "2px 6px",
                            }}
                          >
                            Desativado
                          </span>
                        ) : null}
                      </td>
                      <td style={{ padding: "6px 4px", color: "#d4d4d8", wordBreak: "break-word" }}>{p.country || "—"}</td>
                      <td style={{ padding: "6px 4px", color: "#d4d4d8", wordBreak: "break-word" }}>{p.geoZone || "—"}</td>
                      <td style={{ padding: "6px 4px", fontVariantNumeric: "tabular-nums" }}>
                        {formatPct(p.weightPct)}
                        {p.excluded && p.originalWeightPct > 0 ? (
                          <span style={{ marginLeft: 6, fontSize: 11, color: "#a1a1aa" }}>
                            (antes {formatPct(p.originalWeightPct)})
                          </span>
                        ) : null}
                      </td>
                      <td style={{ padding: "6px 4px", color: "#d4d4d8", fontVariantNumeric: "tabular-nums" }}>
                        {isRecommendedCashOrHedgeRowTicker(p.ticker) ? (
                          <span style={{ color: "#71717a" }} title="Fora do denominador (caixa, MM, T-Bills ou hedge FX)">
                            —
                          </span>
                        ) : recommendedEquitySleeveDenomPct > 1e-6 ? (
                          formatPct((safeNumber(p.weightPct, 0) / recommendedEquitySleeveDenomPct) * 100)
                        ) : (
                          "—"
                        )}
                      </td>
                      <td style={{ padding: "6px 4px", wordBreak: "break-word" }}>{p.sector || "—"}</td>
                      <td style={{ padding: "6px 4px", wordBreak: "break-word" }}>{p.industry || "—"}</td>
                      <td style={{ padding: "6px 4px", wordBreak: "break-word" }}>{p.region || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
              {reportData.planWeightsProvenance?.planTableConsolidatePct != null &&
              reportData.planWeightsProvenance?.planEntryMinPct != null ? (
                <>
                <p style={{ margin: "10px 0 0 0", fontSize: 11, color: "#71717a", lineHeight: 1.45, maxWidth: 720 }}>
                  {reportData.planWeightsProvenance?.mode === "official_csv" &&
                  reportData.planWeightsProvenance?.planSsrGeometryRecutsRanOnGrid === false ? (
                    <span style={{ color: "#a8a29e" }}>
                      <strong style={{ color: "#d6d3d1" }}>Modo official_csv (opt-out):</strong> (1) pó e (3) tecto por
                      linha <strong>não</strong> correram no SSR — definiu-se{" "}
                      <code style={{ color: "#d9f99d" }}>DECIDE_SKIP_SSR_LINE_GEOMETRY_ON_OFFICIAL_CSV=1</code> no
                      deploy.
                    </span>
                  ) : null}
                  Regras de peso (servidor): (1) na grelha, fundir só pó abaixo de{" "}
                  {formatPct(reportData.planWeightsProvenance.planDustExitPct ?? 0.5, 2)} (
                  <code style={{ color: "#d9f99d" }}>DECIDE_PLAN_EXIT_WEIGHT_PCT</code>); (2) sugestão de compra (BUY)
                  só para alvo estritamente superior a{" "}
                  {formatPct(reportData.planWeightsProvenance.planEntryMinPct, 2)} (
                  <code style={{ color: "#d9f99d" }}>DECIDE_PLAN_ENTRY_MIN_WEIGHT_PCT</code> /{" "}
                  <code style={{ color: "#d9f99d" }}>DECIDE_PLAN_MIN_WEIGHT_PCT</code>) — linhas entre o limiar de saída
                  e esse mínimo <strong style={{ color: "#a1a1aa" }}>mantêm-se na tabela</strong> (até ~20 tickers do
                  modelo).
                  {typeof reportData.planWeightsProvenance.planPerTickerMaxPct === "number" ? (
                    <>
                      {" "}
                      (3) tecto por linha de risco{" "}
                      {formatPct(reportData.planWeightsProvenance.planPerTickerMaxPct, 2)} — em cada passo{" "}
                      <code style={{ color: "#d9f99d" }}>min(% NAV, % da soma do sleeve de risco)</code>; excesso
                      redistribuído pelo <strong style={{ color: "#a1a1aa" }}>score</strong> do modelo (peso{" "}
                      <code style={{ color: "#d9f99d" }}>√score</code>
                      ), não para caixa/MM, excepto uma única linha de risco no plano.{" "}
                      <code style={{ color: "#d9f99d" }}>DECIDE_PLAN_MAX_WEIGHT_PCT_PER_TICKER</code> (15 ou 0,15 para
                      15%).
                    </>
                  ) : null}
                </p>
                <p
                  style={{
                    margin: "8px 0 0 0",
                    fontSize: 11,
                    color: "#86efac",
                    lineHeight: 1.45,
                    maxWidth: 720,
                    borderLeft: "3px solid #22c55e",
                    paddingLeft: 10,
                  }}
                >
                  <strong style={{ color: "#bbf7d0" }}>(4) Tecto por zona vs benchmark (país macro US/EU/JP/CAN):</strong>{" "}
                  no sleeve de risco (sem caixa/MM/hedge), a soma das linhas de cada zona não pode exceder{" "}
                  {reportData.planWeightsProvenance.planGeoAdjustmentsDisabled ? (
                    <span style={{ color: "#fca5a5" }}>
                      — <strong>OFF</strong> com <code style={{ color: "#d9f99d" }}>DECIDE_DISABLE_PLAN_WEIGHT_ADJUSTMENTS</code>
                    </span>
                  ) : reportData.planWeightsProvenance.planZoneCapVsBenchmarkDisabled ? (
                    <span style={{ color: "#fca5a5" }}>
                      — <strong>OFF</strong> com <code style={{ color: "#d9f99d" }}>DECIDE_DISABLE_ZONE_CAP_VS_BENCHMARK</code>
                    </span>
                  ) : reportData.planWeightsProvenance.planSsrZoneCapRanOnGrid === false &&
                    reportData.planWeightsProvenance.mode === "official_csv" ? (
                    <span style={{ color: "#fde047" }}>
                      neste modo (<code style={{ color: "#d9f99d" }}>official_csv</code>) desactivámos o tecto{" "}
                      <strong>(4)</strong> 1,3× vs benchmark no SSR (
                      <code style={{ color: "#d9f99d" }}>DECIDE_SKIP_ZONE_CAP_ON_OFFICIAL_CSV=1</code>
                      ). (1) pó e (3) tecto por linha continuam a reflectir só o export salvo que force o opt-in:{" "}
                      <code style={{ color: "#d9f99d" }}>DECIDE_APPLY_SSR_PLAN_CAPS_TO_OFFICIAL_CSV=1</code> ou{" "}
                      <code style={{ color: "#d9f99d" }}>DECIDE_APPLY_ZONE_CAP_TO_OFFICIAL_CSV=1</code>.
                    </span>
                  ) : (
                    <>
                      <strong style={{ color: "#fef08a" }}>
                        {(reportData.planWeightsProvenance.planZoneCapMult ?? 1.3).toLocaleString("pt-PT", {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                        ×
                      </strong>{" "}
                      a fatia dessa zona no benchmark (ficheiro{" "}
                      <code style={{ color: "#d9f99d" }}>backend/data/prices_close.csv</code> — colunas SPY, VGK, EWJ,
                      EWC; fallback se faltar zona). Excesso → outras zonas com folga e/ou caixa. Env:{" "}
                      <code style={{ color: "#d9f99d" }}>DECIDE_ZONE_CAP_VS_BENCHMARK_MULT</code>.
                    </>
                  )}
                </p>
                </>
              ) : null}
              {recommendedFiltered.some((p) => String(p.ticker).toUpperCase() === "EURUSD") ? (
                <p style={{ margin: "12px 0 0 0", fontSize: 12, color: "#71717a", lineHeight: 1.5, maxWidth: 720 }}>
                  <strong style={{ color: "#a1a1aa" }}>EUR/USD:</strong> o peso mostrado é o montante de hedge estimado
                  face ao património da conta (operacional), não uma alocação estratégica extra do modelo — a soma dos
                  pesos na tabela pode ultrapassar 100%.
                </p>
              ) : null}
            </div>

            <div
              style={{
                background: DECIDE_DASHBOARD.clientPanelGradient,
                border: DECIDE_DASHBOARD.panelBorder,
                borderRadius: 18,
                padding: 20,
                overflow: "hidden",
                boxShadow: DECIDE_DASHBOARD.clientPanelShadow,
              }}
            >
              <SectionTitle>Pesos por sector (DECIDE)</SectionTitle>
              <div style={{ color: "#a1a1aa", fontSize: 13, marginBottom: 14, lineHeight: 1.5 }}>
                Top {sectorTop10.length} sectores por peso na carteira recomendada.
                {excludedTickers.length > 0 ? " (recalculado após exclusões)." : ""}
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1.1fr 1.4fr auto",
                  gap: 12,
                  alignItems: "center",
                  color: "#71717a",
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: "0.03em",
                  textTransform: "uppercase",
                  marginBottom: 8,
                }}
              >
                <div>Sector</div>
                <div style={{ textAlign: "left" }}>Peso (%)</div>
                <div style={{ textAlign: "right" }}>%</div>
              </div>

              <div style={{ display: "grid", gap: 10 }}>
                {sectorTop10.length === 0 ? (
                  <div style={{ color: "#a1a1aa", fontSize: 13 }}>Sem dados de sector.</div>
                ) : (
                  sectorTop10.map((r) => {
                    const w = Math.max(0, Math.min(100, r.weightPct));
                    return (
                      <div key={r.sector} style={{ display: "grid", gridTemplateColumns: "1.1fr 1.4fr auto", gap: 12, alignItems: "center" }}>
                        <div style={{ color: "#ffffff", fontWeight: 700, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {r.sector}
                        </div>
                        <div style={{ width: "100%", height: 10, borderRadius: 999, background: DECIDE_DASHBOARD.clientProgressTrackBg, border: DECIDE_DASHBOARD.panelBorder, overflow: "hidden" }}>
                          <div style={{ width: `${w}%`, height: "100%", background: DECIDE_DASHBOARD.flowTealBarFill }} />
                        </div>
                        <div style={{ color: "#ffffff", fontWeight: 800, fontSize: 13 }}>
                          {formatPct(r.weightPct)}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>

          <div
            id="alteracoes-propostas"
            style={{
              background: DECIDE_DASHBOARD.clientPanelGradient,
              border: DECIDE_DASHBOARD.panelBorder,
              borderRadius: 18,
              padding: 20,
              overflowX: "auto",
              marginBottom: 28,
              scrollMarginTop: 96,
              boxShadow: DECIDE_DASHBOARD.clientPanelShadow,
            }}
          >
            <SectionTitle>Alterações propostas</SectionTitle>
            {isClientB ? (
              <div style={{ color: "#cbd5e1", fontSize: 13, marginBottom: 10 }}>
                Cliente B: pode excluir até 5 títulos (caixa antes do ticker) e aplicar.
                <span style={{ color: "#a1a1aa" }}> Exclusões ativas: {excludedTickers.length}/5.</span>
                <span style={{ color: "#a1a1aa" }}> T-Bills não é excluível.</span>
              </div>
            ) : null}
            <div style={{ color: "#a1a1aa", fontSize: 13, marginBottom: 10 }}>
              {reportData.proposedTradesCoverageNote}
            </div>
            {proposedTradesFiltered.length > 0 ? (
              <>
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: 12,
                    marginBottom: 12,
                    padding: "14px 16px",
                    background: DECIDE_DASHBOARD.clientPanelGradient,
                    borderRadius: 14,
                    border: DECIDE_DASHBOARD.panelBorder,
                    fontSize: 14,
                  }}
                >
                  <span style={{ color: DECIDE_DASHBOARD.accentSky, fontWeight: 700 }}>
                    Compras: {buyCountVisible}
                  </span>
                  <span style={{ color: "#fca5a5", fontWeight: 700 }}>
                    Vendas: {sellCountVisible}
                  </span>
                  <span style={{ color: "#cbd5e1" }}>
                    Rotação estimada (maior perna compra/venda):{" "}
                    <strong style={{ color: "#ffffff" }}>
                      {formatMoneyCompact(planTurnoverNotional, ccy)}
                    </strong>
                  </span>
                  <span style={{ color: "#a1a1aa" }}>
                    ≈ {formatPct(turnoverPctVisible)} do valor da conta · soma bruta |Δ| (todas as linhas):{" "}
                    {formatMoneyCompact(tradeVolumeGrossAbs, ccy)}
                  </span>
                </div>
                <p
                  style={{
                    margin: "0 0 16px 0",
                    fontSize: 11,
                    color: "#71717a",
                    lineHeight: 1.55,
                    maxWidth: 720,
                  }}
                >
                  <strong style={{ color: "#a1a1aa" }}>NAV de referência do plano</strong> (
                  {formatMoneyCompact(reportData.navEur, ccy)}) vem do último rebalance em{" "}
                  <code style={{ color: "#a1a1aa" }}>tmp_diag</code>. A{" "}
                  <strong style={{ color: "#a1a1aa" }}>soma das compras (Δ)</strong> é volume bruto de ordens de compra —
                  pode ultrapassar esse NAV. O <strong style={{ color: "#a1a1aa" }}>património na IBKR</strong> é o valor
                  real da conta; <strong style={{ color: "#a1a1aa" }}>não</strong> volta a coincidir com o NAV do plano só
                  porque cancelou ordens — é preciso novo rebalance com o NAV que quiser como base.
                </p>
              </>
            ) : null}
            <form method="get" action="/client/report">
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
              <thead>
                <tr style={{ color: "#a1a1aa", textAlign: "left" }}>
                  {isClientB ? <th style={{ padding: "10px 8px" }}>Excluir</th> : null}
                  <th style={{ padding: "10px 8px" }}>Ação</th>
                  <th style={{ padding: "10px 8px" }}>Ticker</th>
                  <th style={{ padding: "10px 8px" }}>Empresa</th>
                  <th style={{ padding: "10px 8px" }}>Quantidade</th>
                  <th style={{ padding: "10px 8px" }}>Preço (close)</th>
                  <th style={{ padding: "10px 8px" }}>Impacto</th>
                  <th style={{ padding: "10px 8px" }}>Peso alvo</th>
                </tr>
              </thead>
              <tbody>
                {proposedTradesFiltered.length === 0 ? (
                  <tr>
                    <td colSpan={isClientB ? 8 : 7} style={{ padding: 12, color: "#a1a1aa" }}>
                      Sem alterações propostas disponíveis.
                    </td>
                  </tr>
                ) : (
                  proposedTradesFiltered.map((t, idx) => (
                    <tr key={`${t.ticker}-${idx}`} style={{ borderTop: DECIDE_DASHBOARD.panelBorder }}>
                      {isClientB ? (
                        <td style={{ padding: "10px 8px" }}>
                          {(t.side === "BUY" || t.side === "INACTIVE") &&
                          t.ticker !== "TBILL_PROXY" ? (
                            <input
                              type="checkbox"
                              name="exclude"
                              value={t.ticker}
                              defaultChecked={
                                t.side === "INACTIVE" || excludedTickers.includes(t.ticker)
                              }
                              onChange={enforceMaxExclusions}
                              disabled={
                                t.side === "INACTIVE" ||
                                excludedTickers.length >= 5 &&
                                !excludedTickers.includes(t.ticker)
                              }
                            />
                          ) : null}
                        </td>
                      ) : null}
                      <td
                        style={{
                          padding: "10px 8px",
                          color:
                            t.side === "BUY"
                              ? DECIDE_DASHBOARD.accentSky
                              : t.side === "SELL"
                              ? "#fca5a5"
                              : "#a1a1aa",
                          fontWeight: 700,
                        }}
                      >
                        {t.side === "INACTIVE" ? "INATIVO" : t.side}
                      </td>
                      <td style={{ padding: "10px 8px", color: "#ffffff", fontWeight: 700 }}>
                        {(() => {
                          const href = reportPlanTickerLinks(t.ticker);
                          if (!href) return t.ticker;
                          return (
                            <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                              <a href={href.yf} target="_blank" rel="noreferrer" style={{ color: DECIDE_DASHBOARD.accentSky, textDecoration: "none" }}>
                                {t.ticker}
                              </a>
                              <a href={href.ib} target="_blank" rel="noreferrer" style={{ color: "#71717a", textDecoration: "none", fontSize: 11 }}>
                                IB
                              </a>
                            </span>
                          );
                        })()}
                      </td>
                      <td style={{ padding: "10px 8px" }}>{t.nameShort || t.ticker}</td>
                      <td style={{ padding: "10px 8px" }}>{formatQty(t.absQty)}</td>
                      <td style={{ padding: "10px 8px" }}>
                        {typeof t.closePrice === "number" && t.closePrice > 0
                          ? t.closePrice.toFixed(2)
                          : "—"}
                      </td>
                      <td style={{ padding: "10px 8px" }}>
                        {isBuyMissingEquityClosePrice(t) ? (
                          <span
                            style={{ color: "#71717a" }}
                            title="Sem preço de fecho para este ticker em backend/data/prices_close.csv — não é possível calcular quantidade nem impacto executável."
                          >
                            —
                          </span>
                        ) : (
                          formatMoneyCompact(Math.abs(t.deltaValueEst), ccy)
                        )}
                      </td>
                      <td style={{ padding: "10px 8px" }}>{formatPct(t.targetWeightPct)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
            {isClientB ? (
              <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 10 }}>
                <button
                  type="submit"
                  style={{
                    background: DECIDE_DASHBOARD.kpiMenuMainButtonBackground,
                    border: DECIDE_DASHBOARD.kpiMenuMainButtonBorder,
                    color: DECIDE_DASHBOARD.kpiMenuMainButtonColor,
                    borderRadius: 10,
                    padding: "8px 12px",
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: "pointer",
                    boxShadow: DECIDE_DASHBOARD.kpiMenuMainButtonShadow,
                  }}
                >
                  Aplicar exclusões
                </button>
                <span style={{ color: "#a1a1aa", fontSize: 12 }}>
                  Exclusões ativas: {excludedTickers.length}/5
                </span>
                <button
                  type="submit"
                  name="clear"
                  value="1"
                  style={{
                    background: DECIDE_DASHBOARD.clientChartTooltipBg,
                    border: "1px solid #475569",
                    color: "#cbd5e1",
                    borderRadius: 10,
                    padding: "8px 12px",
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  Limpar exclusões
                </button>
              </div>
            ) : null}
            </form>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
              gap: 20,
              marginBottom: 28,
            }}
          >
            <div
              style={{
                background: DECIDE_DASHBOARD.clientPanelGradient,
                border: DECIDE_DASHBOARD.panelBorder,
                borderRadius: 18,
                padding: 20,
                boxShadow: DECIDE_DASHBOARD.clientPanelShadow,
              }}
            >
              <SectionTitle>Fees estimadas</SectionTitle>
              <p style={{ color: "#a1a1aa", fontSize: 13, lineHeight: 1.55, marginTop: -6, marginBottom: 14 }}>
                Valores indicativos com base no valor da conta e no segmento. Não substituem
                contrato ou faturação real.
              </p>
              <div style={{ display: "grid", gap: 12, fontSize: 15 }}>
                <div>
                  <strong style={{ color: "#ffffff" }}>Segmento:</strong> {reportData.feeSegment}
                </div>
                <div>
                  <strong style={{ color: "#ffffff" }}>Fee fixa mensal:</strong>{" "}
                  {formatEuro(reportData.monthlyFixedFeeEur)}
                </div>
                <div>
                  <strong style={{ color: "#ffffff" }}>Management fee anual:</strong>{" "}
                  {formatPct(reportData.annualManagementFeePct)}
                </div>
                <div>
                  <strong style={{ color: "#ffffff" }}>Management fee estimada / ano:</strong>{" "}
                  {formatEuro(reportData.estimatedAnnualManagementFeeEur)}
                </div>
                <div>
                  <strong style={{ color: "#ffffff" }}>Management fee estimada / mês:</strong>{" "}
                  {formatEuro(reportData.estimatedMonthlyManagementFeeEur)}
                </div>
                <div>
                  <strong style={{ color: "#ffffff" }}>Performance fee (estimativa anual):</strong>{" "}
                  {formatEuro(reportData.estimatedPerformanceFeeEur)}
                </div>
                <div style={{ color: "#a1a1aa", fontSize: 13, lineHeight: 1.55 }}>
                  15% sobre o excesso de retorno anual do modelo face ao benchmark (regra
                  típica; aqui aproximada ao CAGR do horizonte mostrado). Teto de exibição
                  aplicado para evitar valores fora de contexto.
                </div>
              </div>
            </div>

            <div
              style={{
                background: DECIDE_DASHBOARD.clientPanelGradient,
                border: DECIDE_DASHBOARD.panelBorder,
                borderRadius: 18,
                padding: 20,
                boxShadow: DECIDE_DASHBOARD.clientPanelShadow,
              }}
            >
              <SectionTitle>Como interpretar este plano</SectionTitle>
              <div style={{ color: "#cbd5e1", fontSize: 15, lineHeight: 1.7 }}>
                A carteira atual reflete as posições reais da conta paper IBKR. A carteira
                recomendada mostra a alocação alvo do modelo DECIDE. As alterações propostas
                traduzem a diferença entre a carteira atual e a carteira recomendada, ficando
                prontas para aprovação do cliente antes de qualquer execução.
              </div>
            </div>
          </div>
          </>
          ) : null}

          {planTab === "execucao" ? (
          <div
            id="decisao-final"
            style={{
              position: "relative",
              zIndex: 10,
              marginTop: 8,
              padding: "32px 28px 36px",
              borderRadius: 20,
              background: DECIDE_DASHBOARD.clientPanelGradientVertical,
              border: DECIDE_DASHBOARD.panelBorder,
              boxShadow: DECIDE_DASHBOARD.clientPanelShadowAccent,
            }}
          >
            <div
              style={{
                fontSize: 12,
                fontWeight: 800,
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                color: DECIDE_DASHBOARD.accentSky,
                marginBottom: 12,
              }}
            >
              Decisão final
            </div>
            <div
              style={{
                fontSize: 11,
                color: "#64748b",
                margin: "0 0 12px 0",
                letterSpacing: 0.02,
              }}
              title="Identificador do build no servidor (Vercel). Deve alinhar com o último deploy de main; se não, o browser pode estar a usar JavaScript em cache."
            >
              Build: <code style={{ color: "#94a3b8" }}>{reportData.clientUiBuildLabel}</code>
            </div>
            <h2
              style={{
                margin: "0 0 14px 0",
                fontSize: 26,
                fontWeight: 800,
                color: "#ffffff",
                lineHeight: 1.2,
              }}
            >
              {postApprovalStage === "idle"
                ? "Confirme o plano proposto?"
                : postApprovalStage === "approved"
                ? "Plano aprovado"
                : postApprovalStage === "ready"
                ? "Tudo pronto para executar"
                : postApprovalStage === "executing"
                ? "A executar ordens"
                : postApprovalStage === "failed"
                ? "Execução falhou"
                : postApprovalStage === "done" && !executionFullyComplete
                ? "Execução incompleta"
                : "Execução concluída"}
            </h2>
            {reportData.navEur < 500 && (
              <div
                style={{
                  margin: "0 0 18px 0",
                  padding: "14px 16px",
                  borderRadius: 14,
                  border: "1px solid rgba(251, 191, 36, 0.42)",
                  background: "linear-gradient(145deg, rgba(120, 53, 15, 0.35) 0%, rgba(24, 24, 27, 0.75) 100%)",
                  color: "#fde68a",
                  fontSize: 14,
                  lineHeight: 1.58,
                  maxWidth: 760,
                }}
              >
                <strong style={{ color: "#fffbeb" }}>
                  Património líquido indicado: {formatMoneyCompact(reportData.navEur, ccy)}.
                </strong>{" "}
                Com saldo mínimo (ex.: ~1 USD) a corretora não consegue executar o plano de ações e T-Bills — é preciso
                capital na conta IBKR. Na conta <strong style={{ color: "#fffbeb" }}>paper</strong>, confira no IB Gateway ou em TWS /
                Account Management se o saldo virtual está correcto (por vezes é preciso ajustar ou depositar fundos de
                teste).
                <br />
                <br />
                <strong style={{ color: "#fffbeb" }}>Onde “comprar” na DECIDE:</strong> não é no dashboard de KPIs. Abra o{" "}
                <strong style={{ color: "#fffbeb" }}>plano</strong> (esta página), separador{" "}
                <strong style={{ color: "#fffbeb" }}>Execução</strong>, secção <strong style={{ color: "#fffbeb" }}>Decisão final</strong>:{" "}
                primeiro <strong>Aprovar plano</strong> → depois <strong>Executar acções…</strong> e/ou{" "}
                <strong>Executar liquidez EUR</strong> (envia para o IB
                Gateway ou TWS).
              </div>
            )}
            {postApprovalStage === "idle" ? (
              <>
                <p style={{ color: "#cbd5e1", fontSize: 16, lineHeight: 1.65, margin: "0 0 20px 0", maxWidth: 720 }}>
                  Revimos a sua carteira e propomos as alterações acima.{" "}
                  <strong style={{ color: "#f8fafc" }}>Nenhuma ordem será executada sem a sua aprovação.</strong>
                </p>
                <p
                  style={{
                    color: "#a1a1aa",
                    fontSize: 14,
                    lineHeight: 1.6,
                    margin: "0 0 14px 0",
                    maxWidth: 720,
                    padding: "12px 14px",
                    background: "rgba(24,24,27,0.85)",
                    borderRadius: 12,
                    border: DECIDE_DASHBOARD.panelBorder,
                  }}
                >
                  <strong style={{ color: "#e2e8f0" }}>Compreende as alterações propostas.</strong>
                  <br />
                  Pretende avançar para execução.
                </p>
                <div
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 8,
                    color: "#cbd5e1",
                    fontSize: 14,
                    margin: "0 0 20px 0",
                    maxWidth: 720,
                    padding: "8px 12px",
                    borderRadius: 10,
                    background: "rgba(39,39,42,0.55)",
                    border: "1px solid #334155",
                  }}
                >
                  <span aria-hidden>i</span>
                  <span>Pode alterar ou cancelar antes da execução final.</span>
                </div>
                <p style={{ color: "#cbd5e1", fontSize: 14, margin: "0 0 28px 0", maxWidth: 720 }}>
                  Nenhuma ordem será executada automaticamente.
                </p>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 14, alignItems: "center" }}>
                  <button
                    type="button"
                    onClick={() => setPostApprovalStage("approved")}
                    style={{
                      background: DECIDE_DASHBOARD.kpiMenuMainButtonBackground,
                      border: DECIDE_DASHBOARD.kpiMenuMainButtonBorder,
                      color: DECIDE_DASHBOARD.kpiMenuMainButtonColor,
                      borderRadius: 14,
                      padding: "16px 28px",
                      fontWeight: 800,
                      fontSize: 16,
                      cursor: "pointer",
                      boxShadow: DECIDE_DASHBOARD.kpiMenuMainButtonShadow,
                    }}
                  >
                    Aprovar plano
                  </button>
                  <div style={{ display: "grid", gap: 6, justifyItems: "center" }}>
                    <button
                      type="button"
                      style={{
                        background: "transparent",
                        border: "1px solid #334155",
                        color: "#a1a1aa",
                        borderRadius: 12,
                        padding: "12px 18px",
                        fontWeight: 600,
                        fontSize: 14,
                        cursor: "pointer",
                      }}
                    >
                      Manter carteira atual
                    </button>
                  </div>
                </div>
                <p style={{ color: "#a1a1aa", fontSize: 13, margin: "10px 0 0 0" }}>
                  Preparar execução será o próximo passo.
                </p>
              </>
            ) : (
              <>
                <p style={{ color: "#cbd5e1", fontSize: 16, lineHeight: 1.65, margin: "0 0 16px 0", maxWidth: 760 }}>
                  {postApprovalStage === "approved" &&
                    "O seu plano foi aprovado. Estamos agora a preparar a execução na sua conta."}
                  {postApprovalStage === "ready" &&
                    "As ordens foram preparadas, mas ainda não foram executadas. Nada é executado automaticamente."}
                  {postApprovalStage === "executing" && executionMessage}
                  {postApprovalStage === "done" &&
                    (executionFullyComplete
                      ? "Todas as ordens deste envio foram executadas na totalidade pedida. Pode usar «Ver carteira atualizada» para confirmar a carteira em tempo real."
                      : incompleteRetryFromFills.length > 0
                      ? "A corretora aceitou o envio, mas nem todas as ordens deste lote estão concluídas. Pode usar «Completar ordens pendentes» (só quando há quantidade em falta elegível para novo envio) ou «Ver carteira atualizada»."
                      : `A corretora aceitou o envio, mas nem todas as ordens estão concluídas. Ordens «em curso» com 0% executado não são reenviadas aqui (evita duplicar no IB Gateway ou na TWS). Linhas «Inactive» ou com erro de qualificação (ex. TBILL_PROXY/${tbillIb}) têm de ser resolvidas no IB Gateway ou na TWS. Use «Ver carteira atualizada» para sincronizar.`)}
                  {postApprovalStage === "failed" && (
                    <>
                      Não foi possível executar as ordens. Pode rever ordens e tentar novamente.
                      {executionMessage ? (
                        <span
                          style={{
                            display: "block",
                            marginTop: 12,
                            padding: "12px 14px",
                            background: "rgba(127,29,29,0.35)",
                            border: "1px solid rgba(248,113,113,0.45)",
                            borderRadius: 12,
                            color: "#fecaca",
                            fontSize: 14,
                            lineHeight: 1.5,
                          }}
                        >
                          <strong style={{ color: "#ffffff" }}>Detalhe:</strong> {executionMessage}
                        </span>
                      ) : null}
                    </>
                  )}
                </p>
                <div style={{ display: "grid", gap: 8, marginBottom: 18, maxWidth: 520 }}>
                  <div style={{ color: DECIDE_DASHBOARD.accentSky }}>✔ Plano aprovado</div>
                  <div
                    style={{
                      color:
                        postApprovalStage === "approved"
                          ? "#fbbf24"
                          : postApprovalStage === "ready" ||
                            postApprovalStage === "executing" ||
                            postApprovalStage === "done" ||
                            postApprovalStage === "failed"
                          ? DECIDE_DASHBOARD.accentSky
                          : "#71717a",
                    }}
                  >
                    {postApprovalStage === "approved" ? "⏳ Ordens preparadas" : "✔ Ordens preparadas"}
                  </div>
                  <div
                    style={{
                      color:
                        postApprovalStage === "approved"
                          ? "#fbbf24"
                          : postApprovalStage === "ready" ||
                            postApprovalStage === "executing" ||
                            postApprovalStage === "done" ||
                            postApprovalStage === "failed"
                          ? DECIDE_DASHBOARD.accentSky
                          : "#71717a",
                    }}
                  >
                    {postApprovalStage === "approved" ? "⏳ Conta verificada" : "✔ Conta verificada"}
                  </div>
                  <div
                    style={{
                      color:
                        postApprovalStage === "failed"
                          ? "#fca5a5"
                          : postApprovalStage === "done"
                          ? executionFullyComplete
                            ? DECIDE_DASHBOARD.accentSky
                            : "#fbbf24"
                          : postApprovalStage === "ready" || postApprovalStage === "executing"
                          ? DECIDE_DASHBOARD.accentSky
                          : "#71717a",
                    }}
                  >
                    {postApprovalStage === "failed"
                      ? "✖ Execução falhou"
                      : postApprovalStage === "done"
                      ? executionFullyComplete
                        ? "✔ Execução concluída"
                        : "⚠ Execução incompleta"
                      : "✔ Pronto para execução"}
                  </div>
                </div>
                {postApprovalStage === "ready" && (
                  <div style={{ color: "#a1a1aa", fontSize: 14, marginBottom: 18 }}>
                    Ordens preparadas: <strong style={{ color: "#ffffff" }}>{planTradeCount}</strong> · Rotação estimada
                    (maior perna): <strong style={{ color: "#ffffff" }}> {formatMoneyCompact(planTurnoverNotional, ccy)}</strong>{" "}
                    · Impacto na carteira: <strong style={{ color: "#ffffff" }}> {formatPct(turnoverPctVisible)}</strong> (inclui
                    reestruturação inicial)
                  </div>
                )}
                {postApprovalStage === "done" && (
                  <div style={{ color: "#a1a1aa", fontSize: 14, marginBottom: 18 }}>
                    <div>
                      Plano: <strong style={{ color: "#ffffff" }}>{planTradeCount}</strong> ordens · Rotação
                      estimada (maior perna): <strong style={{ color: "#ffffff" }}>{formatMoneyCompact(planTurnoverNotional, ccy)}</strong>{" "}
                      · Impacto: <strong style={{ color: "#ffffff" }}>{formatPct(turnoverPctVisible)}</strong>
                    </div>
                    {execSummary ? (
                      <div style={{ marginTop: 8 }}>
                        {execFillsBatchKind === "flatten"
                          ? "Linhas do último «Zerar posições» (flatten):"
                          : "Resposta da corretora neste envio:"}{" "}
                        <strong style={{ color: "#ffffff" }}>{execResponseLineCount}</strong> linha
                        {execResponseLineCount === 1 ? "" : "s"} (tabela abaixo)
                        {lastExecBatchResidual ? (
                          <span style={{ color: "#71717a" }}> — apenas ordens em falta nesta tentativa.</span>
                        ) : null}
                      </div>
                    ) : null}
                    {showPlanVsExecResponseMismatch ? (
                      <p
                        style={{
                          margin: "10px 0 0 0",
                          fontSize: 13,
                          color: "#fcd34d",
                          lineHeight: 1.55,
                          maxWidth: 720,
                        }}
                      >
                        O número de linhas acima não coincide com o plano completo: a tabela mostra só o que a API da
                        corretora devolveu para <strong style={{ color: "#fef3c7" }}>este envio</strong>, não a lista
                        inteira das {planTradeCount} ordens do plano. Ordens «em curso» ou inativas no IB Gateway ou na TWS podem
                        aparecer aqui mesmo quando o resto do lote já foi tratado antes ou fica pendente.{" "}
                        <strong style={{ color: "#e7e5e4" }}>Cancelar na TWS não actualiza esta página</strong> — use
                        «Limpar tabela» abaixo se já tratou as ordens na corretora.
                      </p>
                    ) : null}
                  </div>
                )}
                {postApprovalStage === "done" && execSummary && (
                  <div style={{ color: "#a1a1aa", fontSize: 14, marginBottom: 18 }}>
                    <div style={{ color: "#cbd5e1", fontWeight: 700, marginBottom: 8 }}>
                      Execução desta ação
                      {lastExecBatchResidual ? (
                        <span style={{ color: "#a1a1aa", fontWeight: 600 }}> (residual)</span>
                      ) : null}
                    </div>
                    <div>
                      Executadas: <strong style={{ color: DECIDE_DASHBOARD.accentSky }}>{execSummary.filled}</strong> · Parciais:{" "}
                      <strong style={{ color: "#fbbf24" }}>{execSummary.partial}</strong> · Em curso:{" "}
                      <strong style={{ color: DECIDE_DASHBOARD.accentSky }}>{execSummary.submitted}</strong> · Falhadas:{" "}
                      <strong style={{ color: "#fca5a5" }}>{execSummary.failed}</strong> · Total:{" "}
                      <strong style={{ color: "#ffffff" }}>{execSummary.total}</strong>
                    </div>
                    {lastExecBatchResidual ? (
                      <p style={{ margin: "10px 0 0 0", fontSize: 12, color: "#71717a", lineHeight: 1.5, maxWidth: 560 }}>
                        As restantes ordens do plano já foram executadas anteriormente.
                      </p>
                    ) : null}
                    {cashSleeveOrdersInProgress ? (
                      <p
                        style={{
                          margin: "10px 0 0 0",
                          fontSize: 13,
                          color: "#fcd34d",
                          lineHeight: 1.55,
                          maxWidth: 680,
                        }}
                      >
                        Ordem(ns) do <strong style={{ color: "#fef3c7" }}>sleeve caixa / T-Bills</strong> ({tbillIb}){" "}
                        <strong style={{ color: "#fef3c7" }}>em curso</strong>: na TWS pode aparecer como «Submetida» sem
                        parecer «executada» — é habitual até ao horário de negociação do instrumento (ex. UCITS em Xetra)
                        ou enquanto a corretora não preenche. A linha na tabela abaixo já está identificada como sleeve do
                        plano.
                      </p>
                    ) : null}
                  </div>
                )}
                {postApprovalStage === "done" && portfolioVsPlanAlignmentPct != null && (
                  <div
                    style={{
                      color: "#cbd5e1",
                      fontSize: 14,
                      fontWeight: 600,
                      marginBottom: 14,
                    }}
                  >
                    Carteira próxima da alocação do plano: ~{portfolioVsPlanAlignmentPct}%
                    <span style={{ display: "block", fontWeight: 400, color: "#71717a", fontSize: 12, marginTop: 4 }}>
                      Compara os pesos da secção «Carteira actual» (IBKR ou último snapshot) aos pesos-alvo do plano, só
                      para os tickers do plano. Não é o progresso das quantidades na tabela de execução acima.
                      {lastExecBatchResidual && execTableFillProgressPct != null ? (
                        <>
                          {" "}
                          Envio residual nesta página: ~{execTableFillProgressPct}% do pedido nas linhas mostradas.
                        </>
                      ) : null}
                    </span>
                  </div>
                )}
                {postApprovalStage === "done" &&
                  portfolioVsPlanAlignmentPct == null &&
                  execTableFillProgressPct != null &&
                  execFills.length > 0 && (
                    <div
                      style={{
                        color: "#cbd5e1",
                        fontSize: 14,
                        fontWeight: 600,
                        marginBottom: 14,
                      }}
                    >
                      Progresso das ordens nesta tabela: ~{execTableFillProgressPct}%
                      <span style={{ display: "block", fontWeight: 400, color: "#71717a", fontSize: 12, marginTop: 4 }}>
                        {lastExecBatchResidual
                          ? "Com envio residual, este valor reflecte só as linhas visíveis — use «Ver carteira actualizada» para ver pesos reais."
                          : showPlanVsExecResponseMismatch
                          ? `A tabela pode ter menos linhas que as ${planTradeCount} ordens do plano completo.`
                          : "Percentagem = quantidade executada / pedida nas linhas deste envio."}
                      </span>
                    </div>
                  )}
                {(postApprovalStage === "done" || postApprovalStage === "failed") &&
                  execFills.length > 0 && (
                    <div
                      style={{
                        marginBottom: 18,
                        border: DECIDE_DASHBOARD.panelBorder,
                        borderRadius: 12,
                        overflow: "hidden",
                        maxWidth: 720,
                      }}
                    >
                      <div
                        style={{
                          padding: "10px 14px",
                          background: "#18181b",
                          color: "#cbd5e1",
                          fontSize: 13,
                          fontWeight: 700,
                        }}
                      >
                        {execFillsBatchKind === "flatten"
                          ? "Fecho «Zerar posições» na paper (último flatten)"
                          : lastExecBatchResidual
                            ? "Detalhe desta execução"
                            : showPlanVsExecResponseMismatch
                              ? "Resposta da corretora (este envio — não é o plano completo)"
                              : "Detalhe das execuções deste envio"}
                        <div
                          style={{
                            marginTop: 8,
                            fontWeight: 400,
                            fontSize: 11,
                            color: "#71717a",
                            lineHeight: 1.45,
                          }}
                        >
                          {execFillsBatchKind === "flatten" ? (
                            <>
                              Estas linhas vêm do último <strong style={{ color: "#e2e8f0" }}>POST flatten-paper-portfolio</strong>{" "}
                              (fechos na IB). Alinham com o separador <strong style={{ color: "#e2e8f0" }}>Trades</strong> do
                              Client Portal (execuções concluídas). O separador <strong style={{ color: "#e2e8f0" }}>Orders</strong>{" "}
                              mostra sobretudo ordens <em>activas</em> — vendas a mercado já preenchidas deixam de aparecer aí
                              rapidamente.
                            </>
                          ) : (
                            <>
                              Esta grelha reflecta o último «Executar ordens» do plano (envio via{" "}
                              <code style={{ color: "#a1a1aa" }}>send-orders</code>). Após reforçar o plano, quase
                              todas as linhas tendem a ser <strong style={{ color: "#e2e8f0" }}>BUY</strong> até a
                              carteira se aproximar do alvo. No{" "}
                              <strong style={{ color: "#e2e8f0" }}>Client Portal (paper)</strong>, abra a página
                              <strong style={{ color: "#e2e8f0" }}>«Orders &amp; Trades»</strong> e use o separador
                              <strong style={{ color: "#e2e8f0" }}>Trades</strong> para cruzar execuções já concluídas. O
                              separador <strong style={{ color: "#e2e8f0" }}>Orders</strong> mostra sobretudo ordens
                              ainda em aberto: compras a mercado preenchidas podem deixar de figurar aí muito
                              cedo. Depois de «Zerar posições», a grelha abaixo passa a reflectir o fecho
                              (vendas) até haver um novo «Executar ordens».
                            </>
                          )}
                        </div>
                      </div>
                      <div style={{ overflowX: "auto" }}>
                        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                          <thead>
                            <tr style={{ color: "#a1a1aa", textAlign: "left" }}>
                              <th style={{ padding: "8px 12px", borderBottom: DECIDE_DASHBOARD.panelBorder }}>Título</th>
                              <th style={{ padding: "8px 12px", borderBottom: DECIDE_DASHBOARD.panelBorder }}>Lado</th>
                              <th style={{ padding: "8px 12px", borderBottom: DECIDE_DASHBOARD.panelBorder }}>Qtd pedida</th>
                              <th style={{ padding: "8px 12px", borderBottom: DECIDE_DASHBOARD.panelBorder }}>Executada</th>
                              <th style={{ padding: "8px 12px", borderBottom: DECIDE_DASHBOARD.panelBorder }}>Preço médio</th>
                              <th style={{ padding: "8px 12px", borderBottom: DECIDE_DASHBOARD.panelBorder }}>Estado</th>
                            </tr>
                          </thead>
                          <tbody>
                            {execFills.map((f, i) => (
                              <tr key={`${f.ticker}-${f.action}-${i}`} style={{ color: "#e2e8f0" }}>
                                <td style={{ padding: "8px 12px", borderBottom: DECIDE_DASHBOARD.panelBorder, verticalAlign: "top" }}>
                                  <div style={{ fontWeight: 600 }}>
                                    {(() => {
                                      const tick = String(f.ticker || "");
                                      const href = reportPlanTickerLinks(tick);
                                      if (!href) return displayTickerLabel(f.ticker);
                                      return (
                                        <span
                                          style={{
                                            display: "inline-flex",
                                            gap: 6,
                                            alignItems: "center",
                                            flexWrap: "wrap",
                                          }}
                                        >
                                          <a
                                            href={href.yf}
                                            target="_blank"
                                            rel="noreferrer"
                                            style={{
                                              color: DECIDE_DASHBOARD.accentSky,
                                              textDecoration: "none",
                                            }}
                                          >
                                            {displayTickerLabel(f.ticker)}
                                          </a>
                                          <a
                                            href={href.ib}
                                            target="_blank"
                                            rel="noreferrer"
                                            style={{ color: "#71717a", textDecoration: "none", fontSize: 11 }}
                                          >
                                            IB
                                          </a>
                                        </span>
                                      );
                                    })()}
                                  </div>
                                  {isDecideCashSleeveBrokerSymbol(String(f.ticker || "")) ? (
                                    <div style={{ color: "#c4b5fd", fontSize: 11, marginTop: 3, fontWeight: 600 }}>
                                      {cashSleevePlanUiSubtitle()}
                                    </div>
                                  ) : null}
                                  {f.executed_as && f.executed_as !== f.ticker ? (
                                    <div style={{ color: "#71717a", fontSize: 11, marginTop: 2 }}>
                                      Executado como {f.executed_as}
                                    </div>
                                  ) : null}
                                </td>
                                <td style={{ padding: "8px 12px", borderBottom: DECIDE_DASHBOARD.panelBorder }}>
                                  {String(f.action || "—")}
                                </td>
                                <td style={{ padding: "8px 12px", borderBottom: DECIDE_DASHBOARD.panelBorder }}>
                                  {formatQty(Number(f.requested_qty || 0))}
                                </td>
                                <td style={{ padding: "8px 12px", borderBottom: DECIDE_DASHBOARD.panelBorder }}>
                                  {formatQty(Number(f.filled || 0))}
                                </td>
                                <td style={{ padding: "8px 12px", borderBottom: DECIDE_DASHBOARD.panelBorder }}>
                                  {String(f.ticker).toUpperCase() === "EURUSD"
                                    ? formatEurUsdRate(f.avg_fill_price)
                                    : formatUsdPrice(f.avg_fill_price)}
                                </td>
                                <td style={{ padding: "8px 12px", borderBottom: DECIDE_DASHBOARD.panelBorder }}>
                                  <div>{execStatusDisplay(f)}</div>
                                  {typeof f.message === "string" && f.message.trim() ? (
                                    <div
                                      style={{
                                        marginTop: 6,
                                        fontSize: 11,
                                        lineHeight: 1.4,
                                        color: "#71717a",
                                        maxWidth: 280,
                                      }}
                                    >
                                      {f.message}
                                    </div>
                                  ) : null}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <p style={{ margin: 0, padding: "8px 14px 12px", color: "#71717a", fontSize: 11, lineHeight: 1.45 }}>
                        Preços: mercado EUA em USD; UCITS / ETF em EUR quando aplicável. Esta lista reflecte o último envio a
                        partir do DECIDE; <strong style={{ color: "#a1a1aa" }}>«Cancelar ordens não executadas (paper)»</strong>{" "}
                        actualiza estados aqui com a resposta da IB. Cancelamentos ou conclusões feitos{" "}
                        <strong>só</strong> na TWS não actualizam a tabela — use «Limpar tabela» abaixo se quiser repor a vista.
                      </p>
                      <p style={{ margin: 0, padding: "0 14px 12px", color: "#71717a", fontSize: 11, lineHeight: 1.45 }}>
                        <strong style={{ color: "#a1a1aa" }}>TWS — «Transmitir» vs «Cancelar»:</strong>{" "}
                        <strong style={{ color: "#cbd5e1" }}>Transmitir</strong> só aparece quando a ordem ainda{" "}
                        <em>não</em> foi enviada ao sistema da corretora (rascunho / pendente de envio). Se vê{" "}
                        <strong style={{ color: "#cbd5e1" }}>0/158</strong> e <strong>só «Cancelar»</strong>, a ordem{" "}
                        <strong>já está activa</strong> na IB (submetida / à espera de execução) — não é um bug: a TWS não
                        oferece «reenviar» para não duplicar. Pode estar à espera de{" "}
                        <strong style={{ color: "#a1a1aa" }}>horário de mercado</strong> (ex.: UCITS CSH2 em IBIS/Xetra),{" "}
                        liquidez, ou confirmação na janela de mensagens. O DECIDE também{" "}
                        <strong>não</strong> volta a enviar linhas «em curso» com 0% executado por essa mesma razão; se
                        cancelar na TWS, pode usar <strong style={{ color: "#a1a1aa" }}>«Repetir falhadas ou inactivas»</strong>{" "}
                        ou um novo envio do plano. Linhas <strong>EUR.USD</strong> com ícone de aviso são frequentemente o{" "}
                        hedge cambial associado — confira o texto ao passar o rato ou em Mensagens.
                      </p>
                      {postApprovalStage === "done" ? (
                        <p style={{ margin: 0, padding: "0 14px 12px", color: "#71717a", fontSize: 11, lineHeight: 1.45 }}>
                          <strong style={{ color: "#a1a1aa" }}>EUR/USD (hedge):</strong> num <strong>envio completo</strong> do
                          plano, o pedido inclui sempre uma linha <strong>EURUSD</strong> na resposta (executada, em curso ou
                          «não enviada» se o montante USD estimado for &lt; ~500). Envios residuais (ex.: completar uma
                          falhada) não repetem o bloco FX aqui.{" "}
                          <strong style={{ color: "#a1a1aa" }}>TWS / paper:</strong> o IBKR mostra{" "}
                          <strong>vários</strong> avisos diferentes sobre Forex (alavancagem, confirmação de leitura, política
                          de saldos em moeda, etc.): «não mostrar de novo» costuma aplicar-se{" "}
                          <em>só àquele</em> texto — outro diálogo pode voltar a aparecer. Se surgir{" "}
                          <strong>«Ordem rejeitada»</strong> em inglês sobre saldo negativo em moeda ou CFD, é uma{" "}
                          <strong>regra da conta</strong> (paper/live), não do DECIDE: spot FX pode ser recusado até haver
                          margem/USD compatível; confirme na TWS (Ordens / mensagens) e em Conta → permissões de trading. O
                          IDEALPRO aparece no fim do lote — filtre <strong>Forex</strong> ou pesquise <strong>EUR.USD</strong> em{" "}
                          <strong>Atividade → Ordens</strong> (TWS clássica). O módulo <strong>FXTrader</strong> pode mostrar
                          «sem ordens» mesmo quando a API enviou FX — confirme sempre na grelha global de ordens e no registo
                          de execução / mensagens; se a IB rejeitar o spot, não haverá linha activa em lado nenhum.
                        </p>
                      ) : null}
                      <div style={{ padding: "0 14px 14px" }}>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
                          <button
                            type="button"
                            onClick={() => void syncExecFillsFromIb()}
                            disabled={syncExecBusy || cancelOpenBusy || execFills.length === 0}
                            aria-busy={syncExecBusy}
                            title={
                              cancelOpenBusy
                                ? "Aguarde a operação de cancelamento a terminar."
                                : execFills.length === 0
                                ? "Só disponível quando há linhas na tabela de resposta da corretora."
                                : "Lê ordens abertas e execuções na IBKR (via backend FastAPI)."
                            }
                            style={{
                              padding: "8px 14px",
                              borderRadius: 10,
                              fontSize: 13,
                              fontWeight: 600,
                              cursor:
                                syncExecBusy || cancelOpenBusy || execFills.length === 0 ? "not-allowed" : "pointer",
                              border: "1px solid rgba(94, 234, 212, 0.45)",
                              background: syncExecBusy ? "rgba(6, 78, 74, 0.35)" : "rgba(6, 78, 74, 0.55)",
                              color: "#ccfbf1",
                              opacity: execFills.length === 0 ? 0.5 : 1,
                            }}
                          >
                            {syncExecBusy ? (
                              <>
                                A sincronizar com a IBKR
                                <InlineLoadingDots />
                              </>
                            ) : (
                              "Actualizar estado (IBKR)"
                            )}
                          </button>
                          <button
                            type="button"
                            onClick={() => clearExecutionRecordFromBroker()}
                            style={{
                              padding: "8px 14px",
                              borderRadius: 10,
                              fontSize: 13,
                              fontWeight: 600,
                              cursor: "pointer",
                              border: "1px solid rgba(148, 163, 184, 0.45)",
                              background: "rgba(39, 39, 42, 0.9)",
                              color: "#e2e8f0",
                            }}
                          >
                            Limpar tabela (já cancelei ou concluí na TWS)
                          </button>
                        </div>
                        {syncExecError ? (
                          <p
                            role="alert"
                            style={{
                              margin: "10px 0 0",
                              padding: "10px 12px",
                              borderRadius: 10,
                              fontSize: 12,
                              lineHeight: 1.5,
                              color: "#fecaca",
                              background: "rgba(127, 29, 29, 0.35)",
                              border: "1px solid rgba(248, 113, 113, 0.4)",
                              maxWidth: 640,
                            }}
                          >
                            {syncExecError}
                          </p>
                        ) : null}
                        {syncExecNote && !syncExecError ? (
                          <p
                            style={{
                              margin: "10px 0 0",
                              padding: "8px 12px",
                              borderRadius: 10,
                              fontSize: 12,
                              lineHeight: 1.5,
                              color: "#a1a1aa",
                              background: "rgba(39, 39, 42, 0.75)",
                              border: "1px solid rgba(113, 113, 122, 0.45)",
                              maxWidth: 640,
                            }}
                          >
                            {syncExecNote}
                          </p>
                        ) : null}
                        <p style={{ margin: "10px 0 0 0", fontSize: 11, color: "#71717a", lineHeight: 1.45, maxWidth: 620 }}>
                          <strong style={{ color: "#94a3b8" }}>Significado de «Em curso»:</strong> na grelha significa que a
                          última leitura (ou linha provisória após timeout do envio) indica ordem ainda activa na IB
                          (Submitted, PreSubmitted, Pending, etc.) <strong style={{ color: "#a1a1aa" }}>ou</strong> que ainda
                          não temos confirmação fiável — <strong style={{ color: "#a1a1aa" }}>não</strong> implica por si só
                          que a IB já registou uma ordem; após timeout use sempre «Actualizar estado».
                          <span style={{ display: "block", marginTop: 8 }} />
                          <strong style={{ color: "#94a3b8" }}>Actualizar estado:</strong> lê ordens abertas e execuções
                          recentes na conta paper — útil quando já executou na TWS mas a tabela ainda mostra «Em curso».
                          <span style={{ color: "#64748b" }}> </span>
                          <strong style={{ color: "#94a3b8" }}>Limpar tabela:</strong> repõe o passo «Decisão final» para{" "}
                          <strong style={{ color: "#a1a1aa" }}>pronto para execução</strong> e remove as linhas. Não envia
                          ordens nem altera a TWS.
                        </p>
                      </div>
                    </div>
                  )}
                {(postApprovalStage === "done" || postApprovalStage === "failed") &&
                  execFills.length > 0 &&
                  execFills.some((f) => {
                    const st = String(f.status || "").toLowerCase();
                    return (
                      st.includes("error") ||
                      st.includes("rejected") ||
                      ibkrStatusIsTerminalCancelled(f.status || "") ||
                      st.includes("inactive") ||
                      st.includes("not_qualified")
                    );
                  }) && (
                    <div style={{ color: "#a1a1aa", fontSize: 13, marginBottom: 14 }}>
                      {lastExecBatchResidual
                        ? "Detalhe desta execução — alertas: "
                        : "Detalhe das ordens executadas — alertas: "}
                      {execFills
                        .filter((f) => {
                          const st = String(f.status || "").toLowerCase();
                          return (
                            st.includes("error") ||
                            st.includes("rejected") ||
                            ibkrStatusIsTerminalCancelled(f.status || "") ||
                            st.includes("inactive") ||
                            st.includes("not_qualified")
                          );
                        })
                        .slice(0, 5)
                        .map((f) => `${f.ticker} (${execStatusDisplay(f)})`)
                        .join(" · ")}
                    </div>
                  )}
                {postApprovalStage === "ready" && (
                  <p style={{ color: "#cbd5e1", fontSize: 14, margin: "0 0 14px 0", maxWidth: 760 }}>
                    Há <strong style={{ color: "#e2e8f0" }}>dois envios</strong> (dois botões abaixo): o primeiro trata
                    <strong style={{ color: "#e2e8f0" }}> acções, T-Bills em USD (TBILL_PROXY → {tbillIb}) e FX</strong>{" "}
                    se activo; o segundo trata <strong style={{ color: "#e2e8f0" }}>só a liquidez em EUR</strong> (UCITS, p.ex.
                    XEON) — listagens/horário diferentes. Depois de confirmar, com margem elevada cada lote faz{" "}
                    <strong style={{ color: "#e2e8f0" }}>SELL</strong> antes de <strong style={{ color: "#e2e8f0" }}>BUY</strong>.
                  </p>
                )}
                <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-start" }}>
                  {postApprovalStage === "ready" && (
                    <>
                      <div
                        style={{
                          flexBasis: "100%",
                          marginBottom: 4,
                          maxWidth: 760,
                          padding: "12px 14px",
                          borderRadius: 12,
                          border: DECIDE_DASHBOARD.flowTealCardBorder,
                          background: "rgba(6, 78, 74, 0.26)",
                        }}
                      >
                        <label
                          style={{
                            display: "flex",
                            gap: 12,
                            alignItems: "flex-start",
                            cursor: "pointer",
                            fontSize: 13,
                            color: "#cbd5e1",
                            lineHeight: 1.55,
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={coordinateFxWithEquity}
                            onChange={(e) => setCoordinateFxWithEquity(e.target.checked)}
                            style={{ marginTop: 4, width: 18, height: 18, flexShrink: 0 }}
                          />
                          <span>
                            <strong style={{ color: "#ecfdf5" }}>Cobertura FX no 1.º lote (acções / TBILL USD):</strong> no
                            mesmo envio do <strong>primeiro botão</strong>, após as ordens de acções e do{" "}
                            <strong style={{ color: "#e2e8f0" }}>TBILL_PROXY</strong> (→ ETF {tbillIb} em USD, não o UCITS
                            EUR), o backend pode submeter <strong style={{ color: DECIDE_DASHBOARD.accentSky }}>EUR.USD</strong>{" "}
                            (IDEALPRO) com montante a partir das <strong>compras</strong> em USD (qty × preço) desse lote. Se tiver{" "}
                            <strong style={{ color: "#e2e8f0" }}>preferência de hedge EUR/USD</strong> no dashboard (50% ou
                            100%), essa percentagem aplica-se ao montante das compras e a opção fica normalmente activada
                            aqui. Outros pares no onboarding afectam só os KPIs ilustrativos; neste envio a ordem na IBKR é
                            sempre <strong style={{ color: "#e2e8f0" }}>EUR.USD</strong>. Requer permissões FX e mercado
                            aberto; mín. ~500 USD para a corretora aceitar a ordem. No <strong>primeiro lote</strong>, a
                            linha EURUSD aparece na tabela (se abaixo do mínimo, verá o motivo «não enviada»).{" "}
                            {fxCoordinatedUsdEstimate >= 500 ? (
                              <span style={{ color: DECIDE_DASHBOARD.accentSky }}>
                                Estimativa a cobrir: ~{formatUsdPrice(fxCoordinatedUsdEstimate)}.
                              </span>
                            ) : (
                              <span style={{ color: "#fbbf24" }}>
                                Estimativa &lt; 500 USD — a linha EURUSD aparece na mesma; a ordem pode não ser submetida na
                                IBKR até o montante passar o mínimo.
                              </span>
                            )}
                          </span>
                        </label>
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-start" }}>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
                          <button
                            type="button"
                            onClick={() => void executeOrdersNow(undefined, { batch: "equities_fx" })}
                            disabled={equityFxExecutableCount < 1}
                            title="Acções, TBILL (USD) e linha FX coerente. O envio fala com o IB Gateway/TWS (vários minutos com muitas linhas)."
                            style={{
                              background:
                                equityFxExecutableCount < 1
                                  ? "#334155"
                                  : DECIDE_DASHBOARD.kpiMenuMainButtonBackground,
                              border:
                                equityFxExecutableCount < 1
                                  ? "1px solid #475569"
                                  : DECIDE_DASHBOARD.kpiMenuMainButtonBorder,
                              color: equityFxExecutableCount < 1 ? "#a1a1aa" : DECIDE_DASHBOARD.kpiMenuMainButtonColor,
                              borderRadius: 14,
                              padding: "14px 22px",
                              fontWeight: 800,
                              fontSize: 15,
                              cursor: equityFxExecutableCount < 1 ? "not-allowed" : "pointer",
                              boxShadow: equityFxExecutableCount < 1 ? undefined : DECIDE_DASHBOARD.kpiMenuMainButtonShadow,
                            }}
                          >
                            Executar acções, T-Bills (USD) e FX
                            {equityFxExecutableCount > 0 ? ` (${equityFxExecutableCount})` : ""}
                          </button>
                          <button
                            type="button"
                            onClick={() => void executeOrdersNow(undefined, { batch: "eur_mm" })}
                            disabled={eurMmExecutableCount < 1}
                            title="Só UCITS de caixa em EUR (p.ex. XEON) — negociação em horário/venues Europeus, separado de US RTH."
                            style={{
                              background: eurMmExecutableCount < 1 ? "#334155" : "rgba(20, 83, 45, 0.35)",
                              border: eurMmExecutableCount < 1 ? "1px solid #475569" : "1px solid rgba(34, 197, 94, 0.45)",
                              color: eurMmExecutableCount < 1 ? "#a1a1aa" : "#a7f3d0",
                              borderRadius: 14,
                              padding: "14px 22px",
                              fontWeight: 800,
                              fontSize: 15,
                              cursor: eurMmExecutableCount < 1 ? "not-allowed" : "pointer",
                            }}
                          >
                            Executar liquidez EUR (UCITS)
                            {eurMmExecutableCount > 0 ? ` (${eurMmExecutableCount})` : ""}
                          </button>
                        </div>
                        <p style={{ margin: 0, maxWidth: 640, fontSize: 12, lineHeight: 1.5, color: "#64748b" }}>
                          Não existe, na prática, o mesmo instrumento de caixa em EUR e líquido só em horário US: o proxy do
                          plano para euros é UCITS; use o <strong style={{ color: "#94a3b8" }}>segundo botão</strong> alinhado
                          a Xetra/UE. O <strong style={{ color: "#94a3b8" }}>primeiro</strong> trata T-Bills/ETF USD e acções
                          (e FX) no mesmo lote.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={scrollToOrders}
                        style={{
                          background: "transparent",
                          border: "1px solid #334155",
                          color: "#cbd5e1",
                          borderRadius: 12,
                          padding: "12px 18px",
                          fontWeight: 600,
                          fontSize: 14,
                          cursor: "pointer",
                        }}
                      >
                        Rever ordens
                      </button>
                    </>
                  )}
                  {postApprovalStage === "executing" && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 10, alignItems: "flex-start" }}>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
                        <button
                          type="button"
                          style={{
                            background: "transparent",
                            border: "1px solid #334155",
                            color: "#a1a1aa",
                            borderRadius: 12,
                            padding: "12px 18px",
                            fontWeight: 600,
                            fontSize: 14,
                            cursor: "not-allowed",
                          }}
                          disabled
                          aria-busy
                        >
                          A processar
                          <InlineLoadingDots />
                        </button>
                        <button
                          type="button"
                          onClick={() => cancelExecuteOrdersSend()}
                          style={{
                            background: "rgba(127,29,29,0.45)",
                            border: "1px solid rgba(248,113,113,0.55)",
                            color: "#fecaca",
                            borderRadius: 12,
                            padding: "12px 18px",
                            fontWeight: 700,
                            fontSize: 14,
                            cursor: "pointer",
                          }}
                        >
                          Cancelar envio
                        </button>
                        <Link
                          href="/client-dashboard"
                          style={{
                            textDecoration: "none",
                            border: "1px solid #475569",
                            color: "#cbd5e1",
                            borderRadius: 12,
                            padding: "12px 18px",
                            fontWeight: 600,
                            fontSize: 14,
                          }}
                        >
                          Ir ao dashboard
                        </Link>
                      </div>
                      <p
                        style={{
                          margin: 0,
                          maxWidth: 560,
                          fontSize: 12,
                          lineHeight: 1.5,
                          color: "#71717a",
                        }}
                      >
                        «Cancelar envio» interrompe o pedido nesta página (o backend pode ainda estar a falar com o IB Gateway ou a TWS —
                        confirme no IB Gateway ou na TWS). O pedido corta sozinho ao fim de ~2 min se não houver resposta. Confirme IB Gateway ou TWS
                        (paper, 7497) e <strong style={{ color: "#a1a1aa" }}>uvicorn</strong> na porta de
                        BACKEND_URL.
                      </p>
                    </div>
                  )}
                  {postApprovalStage === "failed" && (
                    <>
                      <button
                        type="button"
                        onClick={() => void executeOrdersNow(undefined, { batch: lastExecuteBatchRef.current })}
                        style={{
                          background: "#b91c1c",
                          border: "1px solid #dc2626",
                          color: "#ffffff",
                          borderRadius: 12,
                          padding: "12px 18px",
                          fontWeight: 700,
                          fontSize: 14,
                          cursor: "pointer",
                        }}
                      >
                        Tentar novamente
                      </button>
                      <button
                        type="button"
                        onClick={() => executeOrdersNow(retryFailedOrInactiveFromFills)}
                        disabled={retryFailedOrInactiveFromFills.length === 0}
                        style={{
                          background:
                            retryFailedOrInactiveFromFills.length === 0
                              ? "#334155"
                              : DECIDE_DASHBOARD.kpiMenuMainButtonBackground,
                          border:
                            retryFailedOrInactiveFromFills.length === 0
                              ? "1px solid #475569"
                              : DECIDE_DASHBOARD.kpiMenuMainButtonBorder,
                          color:
                            retryFailedOrInactiveFromFills.length === 0
                              ? "#e2e8f0"
                              : DECIDE_DASHBOARD.kpiMenuMainButtonColor,
                          borderRadius: 12,
                          padding: "12px 18px",
                          fontWeight: 700,
                          fontSize: 14,
                          cursor: retryFailedOrInactiveFromFills.length === 0 ? "not-allowed" : "pointer",
                          boxShadow:
                            retryFailedOrInactiveFromFills.length === 0
                              ? undefined
                              : DECIDE_DASHBOARD.kpiMenuMainButtonShadow,
                        }}
                      >
                        Executar falhadas novamente
                      </button>
                      <button
                        type="button"
                        onClick={scrollToOrders}
                        style={{
                          background: "transparent",
                          border: "1px solid #334155",
                          color: "#cbd5e1",
                          borderRadius: 12,
                          padding: "12px 18px",
                          fontWeight: 600,
                          fontSize: 14,
                          cursor: "pointer",
                        }}
                      >
                        Rever ordens
                      </button>
                      {execFills.length > 0 && (
                        <button
                          type="button"
                          disabled={portfolioRefreshing}
                          onClick={() => {
                            void refreshIbkrPositionsFromIb();
                            scrollToCarteiraAtual();
                          }}
                          style={{
                            background: portfolioRefreshing ? "#334155" : DECIDE_DASHBOARD.kpiMenuMainButtonBackground,
                            border: portfolioRefreshing
                              ? "1px solid #475569"
                              : DECIDE_DASHBOARD.kpiMenuMainButtonBorder,
                            color: portfolioRefreshing ? "#e2e8f0" : DECIDE_DASHBOARD.kpiMenuMainButtonColor,
                            borderRadius: 12,
                            padding: "12px 18px",
                            fontWeight: 700,
                            fontSize: 14,
                            cursor: portfolioRefreshing ? "wait" : "pointer",
                            boxShadow: portfolioRefreshing ? undefined : DECIDE_DASHBOARD.kpiMenuMainButtonShadow,
                          }}
                        >
                          {portfolioRefreshing ? (
                            <>
                              A atualizar a carteira
                              <InlineLoadingDots />
                            </>
                          ) : (
                            "Ver carteira atualizada"
                          )}
                        </button>
                      )}
                      {incompleteRetryFromFills.length > 0 && (
                        <button
                          type="button"
                          disabled={portfolioRefreshing || syncExecBusy || completePendingBusy}
                          onClick={() => void handleCompletePendingOrders()}
                          style={{
                            background:
                              portfolioRefreshing || syncExecBusy || completePendingBusy
                                ? "#334155"
                                : DECIDE_DASHBOARD.kpiMenuMainButtonBackground,
                            border:
                              portfolioRefreshing || syncExecBusy || completePendingBusy
                                ? "1px solid #475569"
                                : DECIDE_DASHBOARD.kpiMenuMainButtonBorder,
                            color:
                              portfolioRefreshing || syncExecBusy || completePendingBusy
                                ? "#e2e8f0"
                                : DECIDE_DASHBOARD.kpiMenuMainButtonColor,
                            borderRadius: 12,
                            padding: "12px 18px",
                            fontWeight: 700,
                            fontSize: 14,
                            cursor:
                              portfolioRefreshing || syncExecBusy || completePendingBusy
                                ? "not-allowed"
                                : "pointer",
                            boxShadow:
                              portfolioRefreshing || syncExecBusy || completePendingBusy
                                ? undefined
                                : DECIDE_DASHBOARD.kpiMenuMainButtonShadow,
                          }}
                        >
                          {completePendingBusy || syncExecBusy ? (
                            <>
                              A sincronizar com a IBKR
                              <InlineLoadingDots />
                            </>
                          ) : (
                            `Completar ordens pendentes (${incompleteRetryFromFills.length})`
                          )}
                        </button>
                      )}
                    </>
                  )}
                  {postApprovalStage === "done" && liveSnapshotError ? (
                    <p
                      style={{
                        margin: "0 0 14px 0",
                        padding: "12px 14px",
                        fontSize: 13,
                        color: "#fecaca",
                        lineHeight: 1.5,
                        maxWidth: 720,
                        borderRadius: 12,
                        border: "1px solid rgba(248,113,113,0.45)",
                        background: "rgba(127,29,29,0.35)",
                      }}
                    >
                      <strong style={{ color: "#ffffff" }}>Carteira IBKR:</strong> {liveSnapshotError}
                    </p>
                  ) : null}
                  {postApprovalStage === "done" && (
                    <>
                      <button
                        type="button"
                        disabled={portfolioRefreshing}
                        onClick={() => {
                          void refreshIbkrPositionsFromIb();
                          scrollToCarteiraAtual();
                        }}
                        style={{
                          background: portfolioRefreshing ? "#334155" : DECIDE_DASHBOARD.kpiMenuMainButtonBackground,
                          border: portfolioRefreshing
                            ? "1px solid #475569"
                            : DECIDE_DASHBOARD.kpiMenuMainButtonBorder,
                          color: portfolioRefreshing ? "#e2e8f0" : DECIDE_DASHBOARD.kpiMenuMainButtonColor,
                          borderRadius: 12,
                          padding: "12px 18px",
                          fontWeight: 700,
                          fontSize: 14,
                          cursor: portfolioRefreshing ? "wait" : "pointer",
                          boxShadow: portfolioRefreshing ? undefined : DECIDE_DASHBOARD.kpiMenuMainButtonShadow,
                        }}
                      >
                        {portfolioRefreshing ? (
                          <>
                            A atualizar a carteira
                            <InlineLoadingDots />
                          </>
                        ) : (
                          "Ver carteira atualizada"
                        )}
                      </button>
                      {incompleteRetryFromFills.length > 0 && (
                        <button
                          type="button"
                          disabled={portfolioRefreshing || syncExecBusy || completePendingBusy}
                          onClick={() => void handleCompletePendingOrders()}
                          style={{
                            background:
                              portfolioRefreshing || syncExecBusy || completePendingBusy
                                ? "#334155"
                                : DECIDE_DASHBOARD.kpiMenuMainButtonBackground,
                            border:
                              portfolioRefreshing || syncExecBusy || completePendingBusy
                                ? "1px solid #475569"
                                : DECIDE_DASHBOARD.kpiMenuMainButtonBorder,
                            color:
                              portfolioRefreshing || syncExecBusy || completePendingBusy
                                ? "#e2e8f0"
                                : DECIDE_DASHBOARD.kpiMenuMainButtonColor,
                            borderRadius: 12,
                            padding: "12px 18px",
                            fontWeight: 700,
                            fontSize: 14,
                            cursor:
                              portfolioRefreshing || syncExecBusy || completePendingBusy
                                ? "not-allowed"
                                : "pointer",
                            boxShadow:
                              portfolioRefreshing || syncExecBusy || completePendingBusy
                                ? undefined
                                : DECIDE_DASHBOARD.kpiMenuMainButtonShadow,
                          }}
                        >
                          {completePendingBusy || syncExecBusy ? (
                            <>
                              A sincronizar com a IBKR
                              <InlineLoadingDots />
                            </>
                          ) : (
                            `Completar ordens pendentes (${incompleteRetryFromFills.length})`
                          )}
                        </button>
                      )}
                      {!executionFullyComplete && retryFailedOrInactiveFromFills.length > 0 && (
                        <button
                          type="button"
                          disabled={portfolioRefreshing}
                          onClick={() => executeOrdersNow(retryFailedOrInactiveFromFills)}
                          style={{
                            background: portfolioRefreshing ? "#334155" : DECIDE_DASHBOARD.kpiMenuMainButtonBackground,
                            border: portfolioRefreshing
                              ? "1px solid #475569"
                              : DECIDE_DASHBOARD.kpiMenuMainButtonBorder,
                            color: portfolioRefreshing ? "#e2e8f0" : DECIDE_DASHBOARD.kpiMenuMainButtonColor,
                            borderRadius: 12,
                            padding: "12px 18px",
                            fontWeight: 700,
                            fontSize: 14,
                            cursor: portfolioRefreshing ? "not-allowed" : "pointer",
                            boxShadow: portfolioRefreshing ? undefined : DECIDE_DASHBOARD.kpiMenuMainButtonShadow,
                          }}
                        >
                          Repetir falhadas ou inactivas ({retryFailedOrInactiveFromFills.length})
                        </button>
                      )}
                      {!executionFullyComplete && (
                        <button
                          type="button"
                          onClick={scrollToOrders}
                          style={{
                            background: "transparent",
                            border: "1px solid #334155",
                            color: "#cbd5e1",
                            borderRadius: 12,
                            padding: "12px 18px",
                            fontWeight: 600,
                            fontSize: 14,
                            cursor: "pointer",
                          }}
                        >
                          Rever ordens do plano
                        </button>
                      )}
                      <Link
                        href="/client-dashboard"
                        style={{
                          textDecoration: "none",
                          background: "transparent",
                          border: "1px solid #334155",
                          color: "#cbd5e1",
                          borderRadius: 12,
                          padding: "12px 18px",
                          fontWeight: 600,
                          fontSize: 14,
                        }}
                      >
                        Ir para dashboard
                      </Link>
                    </>
                  )}
                </div>
                <p style={{ color: "#a1a1aa", fontSize: 13, margin: "12px 0 0 0" }}>
                  {postApprovalStage === "done"
                    ? executionFullyComplete
                      ? "Pode acompanhar a evolução da carteira no dashboard."
                      : incompleteRetryFromFills.length > 0 || retryFailedOrInactiveFromFills.length > 0
                      ? "«Completar ordens pendentes» sincroniza primeiro com a IBKR e só reenvia o que ainda falta — evita uma 2ª ordem quando a 1ª já tinha continuado a preencher (ex.: GOLD 249 + 149). Use «Repetir falhadas» só para linhas inactivas/erro. Linhas «Em curso» com 0% executado não são reenviadas aqui."
                      : "Sem reenvio automático para linhas já submetidas ou inactivas — confirme no IB Gateway ou na TWS e use «Ver carteira atualizada»."
                    : postApprovalStage === "failed"
                    ? execFills.length > 0
                      ? "Com linhas na tabela (incl. após timeout do envio): sincronize com «Actualizar estado (IBKR)» na grelha; use «Completar ordens pendentes» só quando o botão aparecer com contagem > 0. «Tentar novamente» reenvia o plano completo — confirme na TWS se já há ordens activas."
                      : "Pode tentar de novo ou rever as ordens antes de submeter."
                    : "Pode executar ou rever as ordens antes de decidir."}
                </p>
              </>
            )}
          </div>
          ) : null}

          {planTab === "documentos" ? (
            <div
              style={{
                marginTop: 8,
                display: "grid",
                gap: 22,
                maxWidth: 900,
              }}
            >
              <div
                style={{
                  padding: "18px 20px",
                  borderRadius: 16,
                  border: DECIDE_DASHBOARD.flowTealCardBorder,
                  background: DECIDE_DASHBOARD.flowTealPanelGradientSoft,
                  color: "#cbd5e1",
                  fontSize: 14,
                  lineHeight: 1.65,
                }}
              >
                <strong style={{ color: "#f8fafc" }}>Documentos do plano</strong> — camada transversal ao fluxo principal:
                necessários para compliance e arquivo, sem ocupar o menu superior. A simulação e a recomendação continuam
                no <strong style={{ color: "#e2e8f0" }}>Dashboard</strong> e nos separadores{" "}
                <strong style={{ color: "#e2e8f0" }}>Resumo</strong> / <strong style={{ color: "#e2e8f0" }}>Alterações</strong>.
              </div>

              <div
                style={{
                  background: DECIDE_DASHBOARD.clientPanelGradient,
                  border: DECIDE_DASHBOARD.panelBorder,
                  borderRadius: 18,
                  padding: 22,
                  boxShadow: DECIDE_DASHBOARD.clientPanelShadowMedium,
                }}
              >
                <SectionTitle>Relatório mensal</SectionTitle>
                <p style={{ color: "#a1a1aa", fontSize: 14, lineHeight: 1.6, margin: "8px 0 16px 0" }}>
                  PDF com o logótipo DECIDE, a justificação das alterações (contexto do plano + lista das operações propostas) e
                  a tabela da carteira recomendada (pesos, sectores e regiões) conforme esta página.
                </p>
                <button
                  type="button"
                  disabled={monthlyPdfBusy}
                  onClick={() => void handleDownloadMonthlyRecommendationPdf()}
                  style={{
                    background: monthlyPdfBusy ? "#334155" : DECIDE_DASHBOARD.kpiMenuMainButtonBackground,
                    border: monthlyPdfBusy ? "1px solid #475569" : DECIDE_DASHBOARD.kpiMenuMainButtonBorder,
                    color: monthlyPdfBusy ? "#e2e8f0" : DECIDE_DASHBOARD.kpiMenuMainButtonColor,
                    borderRadius: 12,
                    padding: "12px 20px",
                    fontWeight: 800,
                    fontSize: 14,
                    cursor: monthlyPdfBusy ? "wait" : "pointer",
                    boxShadow: monthlyPdfBusy ? undefined : DECIDE_DASHBOARD.kpiMenuMainButtonShadow,
                  }}
                >
                  {monthlyPdfBusy ? (
                    <>
                      A gerar PDF
                      <InlineLoadingDots />
                    </>
                  ) : (
                    "Descarregar recomendação mensal (PDF)"
                  )}
                </button>
              </div>

              <div
                style={{
                  background: DECIDE_DASHBOARD.clientPanelGradient,
                  border: DECIDE_DASHBOARD.panelBorder,
                  borderRadius: 18,
                  padding: 22,
                  boxShadow: DECIDE_DASHBOARD.clientPanelShadowMedium,
                }}
              >
                <SectionTitle>Adequação (suitability)</SectionTitle>
                <p style={{ color: "#a1a1aa", fontSize: 14, lineHeight: 1.6, margin: "8px 0 16px 0" }}>
                  Registo do perfil, avisos e aceitações associados à recomendação. O fluxo formal de aprovação mantém-se na
                  página dedicada.
                </p>
                <Link
                  href="/client/approve"
                  style={{
                    display: "inline-block",
                    textDecoration: "none",
                    background: DECIDE_DASHBOARD.kpiMenuMainButtonBackground,
                    border: DECIDE_DASHBOARD.kpiMenuMainButtonBorder,
                    color: DECIDE_DASHBOARD.kpiMenuMainButtonColor,
                    borderRadius: 12,
                    padding: "12px 18px",
                    fontWeight: 700,
                    fontSize: 14,
                    boxShadow: DECIDE_DASHBOARD.kpiMenuMainButtonShadow,
                  }}
                >
                  Abrir aprovação regulamentar
                </Link>
              </div>

              <div
                style={{
                  background: DECIDE_DASHBOARD.clientPanelGradient,
                  border: DECIDE_DASHBOARD.panelBorder,
                  borderRadius: 18,
                  padding: 22,
                  boxShadow: DECIDE_DASHBOARD.clientPanelShadowMedium,
                }}
              >
                <SectionTitle>PDFs e declarações</SectionTitle>
                <p style={{ color: "#a1a1aa", fontSize: 14, lineHeight: 1.6, margin: "8px 0 0 0" }}>
                  Contratos, informações pré-contratuais e extracts arquivados por data. Enquanto a API de ficheiros não
                  estiver ligada, use o back-office ou o suporte para cópias oficiais.
                </p>
              </div>
            </div>
          ) : null}
          </>
        </div>
      </div>
    </>
  );
}