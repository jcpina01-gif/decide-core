import React, { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import type { GetServerSideProps } from "next";
import Head from "next/head";
import Link from "next/link";
import OnboardingFlowBar, {
  ONBOARDING_LOCALSTORAGE_CHANGED_EVENT,
  ONBOARDING_MONTANTE_KEY,
  ONBOARDING_STORAGE_KEYS,
} from "../../components/OnboardingFlowBar";
import InlineLoadingDots from "../../components/InlineLoadingDots";
import { isFxHedgeOnboardingApplicable, syncFeeSegmentFromNavEur } from "../../lib/clientSegment";
import { isHedgeOnboardingDone } from "../../lib/fxHedgePrefs";
import { getHrefAfterTradePlanApprovalStep } from "../../lib/onboardingProgress";
import { DECIDE_DASHBOARD, ONBOARDING_SHELL_MAX_WIDTH_PX } from "../../lib/decideClientTheme";
import { DECIDE_MIN_INVEST_EUR } from "../../lib/decideInvestPrefill";
import { isBuyMissingEquityClosePrice } from "../../lib/approvalPlanTradeDisplay";
import { queryIndicatesDailyEntryPlanWeights } from "../../lib/server/buildRecommendationOfficialHistory";
import { loadApprovalAlignedProposedTrades } from "../../lib/server/approvalTradePlan";
import { resolveDecideProjectRoot } from "../../lib/server/decideProjectRoot";
import path from "path";
import fs from "fs";

type ProposedTrade = {
  ticker: string;
  side: string;
  absQty: number;
  marketPrice: number;
  deltaValueEst: number;
  targetWeightPct: number;
  nameShort: string;
};

type PageProps = {
  navEur: number;
  trades: ProposedTrade[];
  coverageNote: string;
  csvRowCount: number;
  ibkrOk: boolean;
  cashEur: number;
  accountCode: string;
};

const IBKR_PREP_DONE_KEY = "decide_onboarding_ibkr_prep_done_v1";

function safeNumber(x: unknown, fallback = 0): number {
  const v = typeof x === "number" ? x : Number(x);
  return Number.isFinite(v) ? v : fallback;
}

function safeString(x: unknown, fallback = ""): string {
  if (typeof x === "string") return x;
  if (typeof x === "number" && Number.isFinite(x)) return String(x);
  return fallback;
}

function formatEuro(v: number): string {
  return new Intl.NumberFormat("pt-PT", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(v);
}

function formatPct(v: number, digits = 2): string {
  return `${v.toFixed(digits)}%`;
}

function normalizeCcy(ccy: string): string {
  const u = (ccy || "USD").toUpperCase();
  if (u === "BASE") return "EUR";
  return u;
}

function formatMoney(v: number, ccy: string): string {
  const c = normalizeCcy(ccy);
  try {
    return new Intl.NumberFormat("pt-PT", {
      style: "currency",
      currency: c,
      maximumFractionDigits: 2,
    }).format(v);
  } catch {
    return `${v.toFixed(2)} ${c}`;
  }
}

type IbkrLiveState = {
  loading: boolean;
  error: string;
  ok: boolean;
  nav: number;
  navCcy: string;
  updatedAt: string | null;
};

const initialIbkrLive: IbkrLiveState = {
  loading: true,
  error: "",
  ok: false,
  nav: 0,
  navCcy: "EUR",
  updatedAt: null,
};

/** Pista EUR.USD para converter NAV USD → EUR (alinhado ao hint do backend). */
function eurusdMidClient(): number {
  const raw = Number(process.env.NEXT_PUBLIC_DECIDE_EURUSD_MID_HINT ?? "1.08");
  return Number.isFinite(raw) && raw > 0 ? raw : 1.08;
}

/** Liquidez da conta IBKR em EUR equivalente (só EUR e USD — outras moedas não validam aqui). */
function ibkrNavEurEquivalent(live: IbkrLiveState): number | null {
  if (!live.ok || live.nav <= 0) return null;
  const ccy = normalizeCcy(live.navCcy);
  if (ccy === "EUR") return live.nav;
  if (ccy === "USD") return live.nav / eurusdMidClient();
  return null;
}

/**
 * Confirmação de fundos via leitura **paper** (TWS/Gateway): liquidez ≥ mínimo do produto
 * e ≥ 85 % do NAV de referência do plano (montante / rebalance).
 */
function ibkrPaperFundsCoverPlan(live: IbkrLiveState, planNavEur: number): boolean {
  const eq = ibkrNavEurEquivalent(live);
  if (eq == null) return false;
  if (eq < DECIDE_MIN_INVEST_EUR) return false;
  if (planNavEur > 0 && eq < planNavEur * 0.85) return false;
  return true;
}

/** Leitura IBKR utilizável para a regra dos fundos (só EUR/USD → equivalente EUR). */
function ibkrLiveSupportsFundsCheck(live: IbkrLiveState): boolean {
  if (!live.ok || live.nav <= 0) return false;
  const ccy = normalizeCcy(live.navCcy);
  return ccy === "EUR" || ccy === "USD";
}

/** Resumo legível do foco sectorial (heurística a partir de nomes/tickers). */
function summarizePortfolioTheme(trades: ProposedTrade[]): string {
  const parts: string[] = [];
  const blob = trades
    .map((t) => `${safeString(t.nameShort, "")} ${safeString(t.ticker, "")}`)
    .join(" ");
  for (const t of trades) {
    const tick = safeString(t.ticker, "").toUpperCase();
    if (tick === "TBILL_PROXY" || tick === "EUR_MM_PROXY" || tick.includes("TBILL")) {
      if (!parts.includes("liquidez / caixa")) parts.push("liquidez / caixa");
    }
    if (tick === "EURUSD") {
      if (!parts.includes("hedge cambial")) parts.push("hedge cambial");
    }
  }
  if (/micron|asml|lam |nvidia|amd|semiconductor|intel|tsmc|technology|tech\b/i.test(blob)) {
    parts.push("énfase em tecnologia");
  }
  if (/sanofi|utility|staples|health care|consumer defensive|defensive/i.test(blob)) {
    parts.push("exposição mais defensiva");
  }
  if (parts.length === 0) return "alocação alinhada ao modelo de risco";
  return parts.slice(0, 3).join(" · ");
}

function countPortfolioImpact(trades: ProposedTrade[]) {
  let nBuy = 0;
  let nSell = 0;
  let buyNotional = 0;
  let sellNotional = 0;
  for (const t of trades) {
    const s = safeString(t.side, "").toUpperCase();
    if (s === "BUY") {
      nBuy += 1;
      if (!isBuyMissingEquityClosePrice(t)) {
        buyNotional += safeNumber(t.deltaValueEst, 0);
      }
    } else if (s === "SELL") {
      nSell += 1;
      sellNotional += Math.abs(safeNumber(t.deltaValueEst, 0));
    }
  }
  return { nBuy, nSell, buyNotional, sellNotional };
}

const EMPTY_APPROVE_PROPS: PageProps = {
  navEur: 0,
  trades: [],
  coverageNote:
    "Não foi possível carregar o plano. Confirme ficheiros em tmp_diag, o modelo em freeze ou o backend, e recarregue.",
  csvRowCount: 0,
  ibkrOk: false,
  cashEur: 0,
  accountCode: "",
};

export const getServerSideProps: GetServerSideProps<PageProps> = async (ctx) => {
  try {
    const projectRoot = resolveDecideProjectRoot();
    const tmpDir = path.join(projectRoot, "tmp_diag");
    const smokePath = path.join(tmpDir, "ibkr_paper_smoke_test.json");
    let smokeJson: Record<string, unknown> | null = null;
    if (fs.existsSync(smokePath)) {
      try {
        smokeJson = JSON.parse(fs.readFileSync(smokePath, "utf-8")) as Record<string, unknown>;
      } catch {
        smokeJson = null;
      }
    }

    const selected = smokeJson?.selected as Record<string, unknown> | undefined;
    const attempts0 = Array.isArray(smokeJson?.attempts)
      ? (smokeJson!.attempts as unknown[])[0]
      : undefined;
    const att0 = attempts0 && typeof attempts0 === "object" ? (attempts0 as Record<string, unknown>) : undefined;

    const { trades, navEur, coverageNote, csvRowCount } =
      await loadApprovalAlignedProposedTrades(projectRoot, {
        queryWantsDailyEntryTarget: queryIndicatesDailyEntryPlanWeights(ctx.query as Record<string, unknown>),
      });

    return {
      props: {
        navEur,
        trades,
        coverageNote,
        csvRowCount,
        ibkrOk: Boolean(selected?.ok),
        cashEur: safeNumber(
          (selected?.cash as Record<string, unknown> | undefined)?.value ??
            (att0?.cash as Record<string, unknown> | undefined)?.value,
          0,
        ),
        accountCode: safeString(selected?.accountCode ?? att0?.accountCode, ""),
      },
    };
  } catch (e) {
    console.error("[approve] getServerSideProps", e);
    return { props: EMPTY_APPROVE_PROPS };
  }
};

export default function ApprovePage({
  navEur,
  trades,
  coverageNote,
  csvRowCount,
  ibkrOk,
  cashEur,
  accountCode,
}: PageProps) {
  const [flowReady, setFlowReady] = useState(false);
  const [mifidDone, setMifidDone] = useState(false);
  const [kycDone, setKycDone] = useState(false);
  const [ibkrPrepDone, setIbkrPrepDone] = useState(false);
  /** Hedge cambial (0/50/100%) concluído antes da corretora — segmentos elegíveis. */
  const [hedgeGateOk, setHedgeGateOk] = useState(false);
  const [userApproved, setUserApproved] = useState(false);
  /** Confirmação explícita (MiFID / conversão) antes de registar aprovação. */
  const [confirmReview, setConfirmReview] = useState(false);
  /** Navegação para o relatório após aprovar — feedback até o Next carregar a página seguinte. */
  const [approveBusy, setApproveBusy] = useState(false);

  /** Sem smoke IBKR no servidor (ex. Vercel): plano alinhado ao montante em `ONBOARDING_MONTANTE_KEY`. */
  const [clientRefPlan, setClientRefPlan] = useState<{
    navEur: number;
    trades: ProposedTrade[];
    coverageNote: string;
    csvRowCount: number;
  } | null>(null);
  const [clientRefPlanBusy, setClientRefPlanBusy] = useState(false);
  const [clientRefPlanError, setClientRefPlanError] = useState("");

  const [excludedTickers, setExcludedTickers] = useState<string[]>([]);
  const [ibkrLive, setIbkrLive] = useState<IbkrLiveState>(initialIbkrLive);
  /** Linha da tabela em foco (clique para destacar). */
  const [tableFocusIdx, setTableFocusIdx] = useState<number | null>(null);

  const displayTrades = useMemo(() => {
    if (clientRefPlan?.trades?.length) return clientRefPlan.trades;
    return trades;
  }, [clientRefPlan, trades]);

  const displayNavEur = useMemo(() => {
    if (clientRefPlan != null && clientRefPlan.navEur > 0) return clientRefPlan.navEur;
    return navEur;
  }, [clientRefPlan, navEur]);

  const displayCoverageNote = useMemo(() => {
    if (clientRefPlan?.trades?.length) return clientRefPlan.coverageNote;
    return coverageNote;
  }, [clientRefPlan, coverageNote]);

  const displayCsvRowCount = useMemo(() => {
    if (clientRefPlan?.trades?.length) return clientRefPlan.csvRowCount;
    return csvRowCount;
  }, [clientRefPlan, csvRowCount]);

  /** NAV em EUR para taxas / exclusões: conta paper (TWS) se vier em EUR, senão último NAV do plano (tmp_diag). */
  const navEurForFees = useMemo(() => {
    if (ibkrLive.ok && ibkrLive.nav > 0 && normalizeCcy(ibkrLive.navCcy) === "EUR") {
      return ibkrLive.nav;
    }
    return displayNavEur;
  }, [ibkrLive.ok, ibkrLive.nav, ibkrLive.navCcy, displayNavEur]);

  const canExclude = navEurForFees >= 50000;
  const maxExclusions = canExclude ? 5 : 0;

  /** Plano de ordens disponível (CSV rebalance) + NAV — não exige smoke IBKR `ok` para desbloquear o botão. */
  const hasTradePlan = displayNavEur > 0 && displayTrades.length > 0;
  /** Diagnóstico IBKR em tmp_diag (opcional para UI de aviso). */
  const ibkrSmokeOk = ibkrOk;

  const paperFundsVerified = useMemo(
    () => ibkrPaperFundsCoverPlan(ibkrLive, displayNavEur),
    [ibkrLive, displayNavEur],
  );

  const canApproveAll =
    hasTradePlan &&
    mifidDone &&
    kycDone &&
    hedgeGateOk &&
    ibkrPrepDone &&
    !ibkrLive.loading &&
    paperFundsVerified;

  const handleToggle = (ticker: string) => {
    if (!canExclude) return;
    if (ticker === "TBILL_PROXY" || ticker === "EUR_MM_PROXY") return;
    setConfirmReview(false);
    setExcludedTickers((prev) => {
      if (prev.includes(ticker)) {
        return prev.filter((t) => t !== ticker);
      }
      if (prev.length >= maxExclusions) {
        return prev;
      }
      return [...prev, ticker];
    });
  };

  const approvedTrades = displayTrades.filter(
    (t) => !excludedTickers.includes(t.ticker),
  );

  const portfolioImpact = useMemo(() => {
    const { nBuy, nSell, buyNotional, sellNotional } = countPortfolioImpact(approvedTrades);
    return {
      nBuy,
      nSell,
      buyNotional,
      sellNotional,
      theme: summarizePortfolioTheme(approvedTrades),
    };
  }, [approvedTrades]);

  const soleSellTicker = useMemo(() => {
    const sells = approvedTrades.filter((t) => safeString(t.side, "").toUpperCase() === "SELL");
    return sells.length === 1 ? safeString(sells[0].ticker, "").toUpperCase() : null;
  }, [approvedTrades]);

  /** Frases curtas de convicção (o que isto significa na prática). */
  const interpretationLines = useMemo(() => {
    if (!hasTradePlan || approvedTrades.length === 0) return [];
    const { nBuy, nSell, buyNotional, theme } = portfolioImpact;
    const lines: string[] = [];
    if (theme && theme.trim()) {
      lines.push(`Plano orientado ao modelo DECIDE — foco: ${theme}.`);
    }
    if (buyNotional >= 500) {
      lines.push("Volume de compras estimado no modelo é relevante — o montante técnico está no plano, não aqui.");
    }
    if (nSell === 0) {
      lines.push("Sem vendas neste rebalance — baixa rotação no lado das saídas.");
    } else if (nSell === 1) {
      lines.push("Baixa rotação: apenas 1 venda no conjunto.");
    } else {
      lines.push(`${nSell} vendas previstas — rotação mais activa.`);
    }
    if (nBuy > 0) {
      lines.push(`${nBuy} ordens de compra propostas.`);
    }
    return lines.slice(0, 4);
  }, [hasTradePlan, approvedTrades.length, portfolioImpact]);

  // Antes de renderizar o fluxo (OnboardingFlowBar), garantimos que:
  // - resetamos o passo "approve" se ainda não for permitido
  // - e só marcamos "ordens aprovadas" depois do utilizador clicar.
  const syncApprovalGatesFromLocalStorage = useCallback(() => {
    try {
      const mifid = window.localStorage.getItem(ONBOARDING_STORAGE_KEYS.mifid) === "1";
      const kyc = window.localStorage.getItem(ONBOARDING_STORAGE_KEYS.kyc) === "1";
      const approve = window.localStorage.getItem(ONBOARDING_STORAGE_KEYS.approve) === "1";
      const ibkrPrep = window.localStorage.getItem(IBKR_PREP_DONE_KEY) === "1";
      const hedgeOk = !isFxHedgeOnboardingApplicable() || isHedgeOnboardingDone();

      setMifidDone(mifid);
      setKycDone(kyc);
      setIbkrPrepDone(ibkrPrep);
      setHedgeGateOk(hedgeOk);

      const fundsOk =
        ibkrLive.loading || ibkrPaperFundsCoverPlan(ibkrLive, displayNavEur);
      const allowed = hasTradePlan && mifid && kyc && hedgeOk && ibkrPrep && fundsOk;
      if (!allowed) {
        window.localStorage.setItem(ONBOARDING_STORAGE_KEYS.approve, "0");
        setUserApproved(false);
      } else {
        setUserApproved(approve);
      }
    } catch {
      setUserApproved(false);
      setMifidDone(false);
      setKycDone(false);
      setHedgeGateOk(false);
    } finally {
      setFlowReady(true);
    }
  }, [hasTradePlan, ibkrLive.loading, ibkrLive.ok, ibkrLive.nav, ibkrLive.navCcy, displayNavEur]);

  useEffect(() => {
    syncApprovalGatesFromLocalStorage();
  }, [syncApprovalGatesFromLocalStorage]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const bump = () => syncApprovalGatesFromLocalStorage();
    window.addEventListener("storage", bump);
    window.addEventListener(ONBOARDING_LOCALSTORAGE_CHANGED_EVENT, bump);
    window.addEventListener("focus", bump);
    return () => {
      window.removeEventListener("storage", bump);
      window.removeEventListener(ONBOARDING_LOCALSTORAGE_CHANGED_EVENT, bump);
      window.removeEventListener("focus", bump);
    };
  }, [syncApprovalGatesFromLocalStorage]);

  const refreshIbkrSnapshot = useCallback(async () => {
    setIbkrLive((s) => ({ ...s, loading: true, error: "" }));
    try {
      const res = await fetch("/api/ibkr-snapshot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paper_mode: true }),
        credentials: "same-origin",
        cache: "no-store",
      });
      const raw = await res.text();
      let data: {
        status?: string;
        error?: string;
        net_liquidation?: number;
        net_liquidation_ccy?: string;
      } = {};
      try {
        data = raw ? (JSON.parse(raw) as typeof data) : {};
      } catch {
        throw new Error("Resposta inválida do servidor.");
      }
      if (!res.ok || data.status !== "ok") {
        const msg =
          (typeof data.error === "string" && data.error) ||
          `Falha ao ler a conta IBKR (${res.status}). Confirme TWS ligado, conta paper, e o backend acessível.`;
        setIbkrLive({
          loading: false,
          error: msg,
          ok: false,
          nav: 0,
          navCcy: "EUR",
          updatedAt: null,
        });
        return;
      }
      const nav = safeNumber(data.net_liquidation, 0);
      const navCcy =
        typeof data.net_liquidation_ccy === "string" ? data.net_liquidation_ccy : "USD";
      setIbkrLive({
        loading: false,
        error: "",
        ok: true,
        nav,
        navCcy,
        updatedAt: new Date().toISOString(),
      });
    } catch (e) {
      setIbkrLive({
        loading: false,
        error: e instanceof Error ? e.message : "Erro ao contactar o servidor.",
        ok: false,
        nav: 0,
        navCcy: "EUR",
        updatedAt: null,
      });
    }
  }, []);

  useEffect(() => {
    void refreshIbkrSnapshot();
  }, [refreshIbkrSnapshot]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const serverOk = navEur > 0 && trades.length > 0;
    if (serverOk) return;

    let montante = 0;
    try {
      const raw = window.localStorage.getItem(ONBOARDING_MONTANTE_KEY);
      montante =
        raw != null ? safeNumber(Number(String(raw).replace(/\s/g, "").replace(",", ".")), 0) : 0;
    } catch {
      montante = 0;
    }
    if (!(montante > 0)) return;

    let cancelled = false;
    setClientRefPlanBusy(true);
    setClientRefPlanError("");
    void fetch("/api/client/approval-plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ referenceNavEur: Math.round(montante) }),
      credentials: "same-origin",
      cache: "no-store",
    })
      .then(async (res) => {
        const rawText = await res.text();
        let data: {
          ok?: boolean;
          error?: string;
          trades?: ProposedTrade[];
          navEur?: number;
          coverageNote?: string;
          csvRowCount?: number;
        } = {};
        try {
          data = rawText ? (JSON.parse(rawText) as typeof data) : {};
        } catch {
          throw new Error("Resposta inválida do servidor.");
        }
        if (!res.ok || data.ok === false) {
          throw new Error(
            typeof data.error === "string" && data.error
              ? data.error
              : `Falha ao carregar plano (${res.status}).`,
          );
        }
        return data;
      })
      .then((data) => {
        if (cancelled) return;
        if (
          Array.isArray(data.trades) &&
          data.trades.length > 0 &&
          typeof data.navEur === "number" &&
          data.navEur > 0
        ) {
          setClientRefPlan({
            navEur: data.navEur,
            trades: data.trades,
            coverageNote: typeof data.coverageNote === "string" ? data.coverageNote : "",
            csvRowCount: typeof data.csvRowCount === "number" ? data.csvRowCount : 0,
          });
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setClientRefPlanError(e instanceof Error ? e.message : "Erro ao carregar plano");
        }
      })
      .finally(() => {
        if (!cancelled) setClientRefPlanBusy(false);
      });

    return () => {
      cancelled = true;
    };
  }, [navEur, trades.length]);

  useLayoutEffect(() => {
    if (typeof window === "undefined") return;
    syncFeeSegmentFromNavEur(navEurForFees);
  }, [navEurForFees]);

  const handleApprove = () => {
    if (approveBusy) return;
    if (!hasTradePlan) {
      // eslint-disable-next-line no-alert
      alert(
        "Não há plano para aprovar: confirma património > 0 e dados do modelo / plano (backend ou freeze + tmp_diag).",
      );
      return;
    }
    if (!mifidDone || !kycDone) {
      // eslint-disable-next-line no-alert
      alert("Aprovação bloqueada: confirme primeiro o MiFID e o KYC (Persona).");
      return;
    }
    if (isFxHedgeOnboardingApplicable() && !isHedgeOnboardingDone()) {
      // eslint-disable-next-line no-alert
      alert(
        "Aprovação bloqueada: conclua primeiro o passo «Hedge cambial» (0%, 50% ou 100% nos indicadores), antes da corretora.",
      );
      return;
    }
    if (!ibkrPrepDone) {
      // eslint-disable-next-line no-alert
      alert("Aprovação bloqueada: confirme a preparação IBKR (passo Corretora).");
      return;
    }
    if (ibkrLive.loading) {
      // eslint-disable-next-line no-alert
      alert("Aguarde a leitura da conta IBKR paper (TWS / Gateway).");
      return;
    }
    if (!paperFundsVerified) {
      if (!ibkrLive.ok) {
        // eslint-disable-next-line no-alert
        alert(
          `Aprovação bloqueada: não há leitura válida da conta paper na IBKR. ${ibkrLive.error ? ibkrLive.error + " " : ""}Confirme TWS/IB Gateway e use «Atualizar leitura (TWS)».`,
        );
        return;
      }
      if (!ibkrLiveSupportsFundsCheck(ibkrLive)) {
        // eslint-disable-next-line no-alert
        alert(
          "Aprovação bloqueada: nesta página só validamos património quando a conta paper está em EUR ou USD (base). Ajuste na IBKR ou contacte suporte.",
        );
        return;
      }
      const eq = ibkrNavEurEquivalent(ibkrLive);
      const eqStr = eq != null ? formatEuro(eq) : "—";
      // eslint-disable-next-line no-alert
      alert(
        `Aprovação bloqueada: património líquido total na paper (${eqStr}) tem de ser ≥ ${formatEuro(
          DECIDE_MIN_INVEST_EUR,
        )} e ≥ ~85 % do NAV de referência do plano (${formatEuro(displayNavEur)}). Alinhe o montante do onboarding ao que tem na conta ou deposite na paper.`,
      );
      return;
    }
    if (!confirmReview) {
      // eslint-disable-next-line no-alert
      alert("Marque a confirmação: reviu a proposta e compreende os riscos associados.");
      return;
    }
    setApproveBusy(true);
    syncFeeSegmentFromNavEur(navEurForFees);
    try {
      window.localStorage.setItem(ONBOARDING_STORAGE_KEYS.approve, "1");
      window.dispatchEvent(new Event(ONBOARDING_LOCALSTORAGE_CHANGED_EVENT));
    } catch {
      // ignore
    }
    setUserApproved(true);

    /** Após aprovar: página de depósito (IBKR); o hedge já foi escolhido antes da corretora. */
    let nextHref = "/client/fund-account?from=approve";
    try {
      nextHref = getHrefAfterTradePlanApprovalStep();
    } catch {
      nextHref = "/client/fund-account?from=approve";
    }
    if (typeof window !== "undefined") {
      window.location.assign(nextHref);
    }
  };

  const handleReject = () => {
    try {
      window.localStorage.setItem(ONBOARDING_STORAGE_KEYS.approve, "0");
      window.dispatchEvent(new Event(ONBOARDING_LOCALSTORAGE_CHANGED_EVENT));
    } catch {}
    setUserApproved(false);
    // eslint-disable-next-line no-alert
    alert("Decisão registada como «não aprovar». Pode rever o plano na página Plano e voltar aqui quando quiser.");
  };

  /** Porque o botão «Aprovar» está desactivo — feedback visível (o `title` do botão nem sempre é óbvio). */
  const approveButtonHint = useMemo(() => {
    if (approveBusy) return null;
    if (!hasTradePlan) {
      return "Botão desactivo: falta plano de ordens ou NAV de referência válido (Plano / tmp_diag ou montante no onboarding).";
    }
    if (!mifidDone) return "Botão desactivo: falta concluir o teste MiFID.";
    if (!kycDone) return "Botão desactivo: falta concluir o KYC (Persona).";
    if (!hedgeGateOk) return "Botão desactivo: falta concluir o passo «Hedge cambial» (0%, 50% ou 100%).";
    if (!ibkrPrepDone) return "Botão desactivo: falta concluir a preparação IBKR (passo Corretora).";
    if (ibkrLive.loading) return "Botão desactivo: a ler liquidez na conta IBKR paper…";
    if (!paperFundsVerified) {
      if (ibkrLive.loading) {
        return "Botão desactivo: a ler património na conta IBKR paper…";
      }
      if (!ibkrLive.ok) {
        return ibkrLive.error
          ? `Botão desactivo: leitura IBKR falhou — ${ibkrLive.error.slice(0, 120)}${ibkrLive.error.length > 120 ? "…" : ""}`
          : "Botão desactivo: sem leitura da conta paper — confirme TWS/IB Gateway, backend e carregue em «Atualizar leitura (TWS)».";
      }
      if (!ibkrLiveSupportsFundsCheck(ibkrLive)) {
        return "Botão desactivo: a validação de fundos só aceita conta base em EUR ou USD na paper (ajuste na IBKR ou contacte suporte).";
      }
      return `Botão desactivo: património líquido total na paper tem de ser ≥ ${formatEuro(DECIDE_MIN_INVEST_EUR)} e ≥ ~85 % do NAV de referência do plano (${formatEuro(displayNavEur)}).`;
    }
    if (!confirmReview) return "Botão desactivo: marque a confirmação de que reviu a proposta e os riscos (caixa acima).";
    return null;
  }, [
    approveBusy,
    hasTradePlan,
    mifidDone,
    kycDone,
    hedgeGateOk,
    ibkrPrepDone,
    confirmReview,
    ibkrLive.loading,
    ibkrLive.ok,
    ibkrLive.error,
    paperFundsVerified,
    displayNavEur,
  ]);

  return (
    <>
      <Head>
        <title>DECIDE — Confirmar plano para a sua carteira</title>
      </Head>
      <main
        className="min-h-screen text-slate-50"
        style={{ background: DECIDE_DASHBOARD.pageBg, fontFamily: DECIDE_DASHBOARD.fontFamily }}
      >
        <div
          className="mx-auto px-6 py-10"
          style={{ maxWidth: ONBOARDING_SHELL_MAX_WIDTH_PX, width: "100%" }}
        >
          {flowReady ? (
            <OnboardingFlowBar
              currentStepId="approve"
              authStepHref="/client/login"
              currentStepAlwaysActive
            />
          ) : null}

          {clientRefPlanBusy ? (
            <p className="mb-4 rounded-lg border border-slate-700/80 bg-slate-900/50 px-4 py-3 text-xs text-slate-400">
              A alinhar o plano ao montante que indicou no onboarding
              <InlineLoadingDots />
            </p>
          ) : null}
          {clientRefPlanError && !clientRefPlanBusy ? (
            <p className="mb-4 rounded-lg border border-amber-800/60 bg-amber-950/30 px-4 py-3 text-xs text-amber-200/95">
              {clientRefPlanError}
            </p>
          ) : null}

          <header className="mb-6 border-b border-slate-800 pb-5">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Aprovação do plano</p>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-400">
              Contexto regulamentar e alinhamento com o plano. A decisão principal está na secção seguinte.
            </p>
            <details className="mt-4 rounded-lg border border-slate-800/80 bg-slate-900/40 px-4 py-3">
              <summary className="cursor-pointer text-sm font-medium text-zinc-400 hover:text-zinc-300">
                Ver detalhe técnico
              </summary>
              <div className="mt-3 space-y-3 text-xs leading-relaxed text-slate-500">
                <p>
                  Confirmação regulamentar sobre as <strong className="text-slate-300">mesmas ordens</strong> do{" "}
                  <Link href="/client/report" className="text-zinc-400 hover:text-zinc-300">
                    plano de rebalance
                  </Link>{" "}
                  (ficheiros em <code className="rounded bg-slate-950 px-1 text-slate-400">tmp_diag</code>, incl.{" "}
                  <code className="rounded bg-slate-950 px-1 text-slate-400">decide_trade_plan_ibkr.csv</code>). Para
                  atualizar números, volte a correr o rebalance.
                </p>
                <p>
                  <strong className="text-slate-400">Alinhamento:</strong> {displayCoverageNote} CSV IBKR:{" "}
                  <strong className="text-slate-300">{displayCsvRowCount}</strong> linhas · aqui:{" "}
                  <strong className="text-slate-300">{displayTrades.length}</strong>. Comparar com{" "}
                  <Link href="/client/report" className="text-zinc-400 hover:text-zinc-300">
                    «Alterações propostas»
                  </Link>{" "}
                  no plano.
                </p>
              </div>
            </details>
            <div className="mt-4 text-xs">
              <Link href="/client/report" className="text-zinc-400 hover:text-zinc-300">
                Abrir plano detalhado do rebalance
              </Link>
            </div>
          </header>

          {flowReady && !canApproveAll && (
            <section className="mb-6 rounded-xl border border-amber-800 bg-amber-950/40 p-4">
              <div className="text-sm font-semibold text-amber-100">
                Aprovação bloqueada: passos em falta ou sem plano
              </div>
              <div className="mt-1 text-xs text-amber-200">
                {!mifidDone && "Falta confirmar o Teste MiFID."}
                {!kycDone && " Falta confirmar o KYC (Persona)."}
                {mifidDone && kycDone && !hedgeGateOk
                  ? " Falta concluir o hedge cambial (0%, 50% ou 100% nos indicadores)."
                  : null}
                {mifidDone && kycDone && hedgeGateOk && !ibkrPrepDone ? " Falta preparar IBKR (passo Corretora)." : null}
                {mifidDone && kycDone && hedgeGateOk && ibkrPrepDone && !hasTradePlan
                  ? displayNavEur <= 0
                    ? `Património inválido (${formatEuro(displayNavEur)}).`
                    : "Sem linhas de plano (confirma backend/freeze do modelo e tmp_diag)."
                  : null}
                {mifidDone && kycDone && hedgeGateOk && ibkrPrepDone && hasTradePlan && ibkrLive.loading
                  ? " A confirmar liquidez na conta IBKR paper…"
                  : null}
                {mifidDone &&
                kycDone &&
                hedgeGateOk &&
                ibkrPrepDone &&
                hasTradePlan &&
                !ibkrLive.loading &&
                !paperFundsVerified
                  ? !ibkrLive.ok
                    ? ` Não foi possível ler o património na conta paper. ${ibkrLive.error ? ibkrLive.error : "Confirme IB Gateway/TWS (paper, API activa), o backend DECIDE e carregue em «Atualizar leitura (TWS)»."}`
                    : !ibkrLiveSupportsFundsCheck(ibkrLive)
                      ? " A validação nesta página usa o património líquido total (Net Liquidation) em conta base EUR ou USD. Outras moedas base não são aceites aqui — altere a visualização/base na IBKR ou peça apoio."
                      : ` Património na paper insuficiente face ao plano: o valor líquido total da conta (não só «caixa») tem de ser ≥ ${formatEuro(
                          DECIDE_MIN_INVEST_EUR,
                        )} e ≥ ~85 % do NAV de referência (${formatEuro(
                          displayNavEur,
                        )}). Aumente o saldo na paper, alinhe o montante do onboarding ao que tem na conta, ou actualize a leitura na TWS.`
                  : null}
                {accountCode ? ` Conta: ${accountCode}.` : ""}
                {cashEur > 0 ? ` Cash: ${formatEuro(cashEur)}.` : ""}
              </div>
            </section>
          )}

          {flowReady && canApproveAll && !ibkrSmokeOk ? (
            <section className="mb-6 rounded-xl border border-zinc-700/60 bg-zinc-900/35 p-4">
              <div className="text-sm font-semibold text-zinc-200">
                Aviso: diagnóstico IBKR (paper) não está assinalado como OK
              </div>
              <div className="mt-1 text-xs text-zinc-400">
                Mesmo assim pode <strong className="text-zinc-100">aprovar o plano</strong> gerado a partir do CSV do último
                rebalance. Para envio real ao IB Gateway ou TWS, confirme a ligação IBKR e execute o fluxo de diagnóstico em{" "}
                <code className="text-zinc-400">tmp_diag</code>.
              </div>
            </section>
          ) : null}

          <section
            className="relative mb-8 overflow-hidden rounded-2xl border-2 px-6 py-9 sm:px-12 lg:px-14"
            style={{
              borderColor: "rgba(255, 255, 255, 0.12)",
              background: DECIDE_DASHBOARD.clientPanelGradient,
              boxShadow:
                "0 0 0 1px rgba(255, 255, 255, 0.06), 0 24px 56px rgba(0, 0, 0, 0.5), 0 0 64px -24px rgba(0, 0, 0, 0.55)",
            }}
          >
            <div
              className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-zinc-500/35 to-transparent"
              aria-hidden
            />

            {/* (A) Decisão — foco: o que acontece à carteira (ordens), não volume técnico em destaque */}
            <div className="mx-auto max-w-[min(96vw,48rem)] text-center">
              <h1 className="text-2xl font-semibold tracking-tight text-white sm:text-[1.7rem]">
                Confirmar plano para a sua carteira
              </h1>
              <p className="mt-4 text-sm leading-relaxed text-slate-400">
                Regista a sua <strong className="font-medium text-slate-200">decisão informada</strong>. A execução em
                mercado depende sempre do corretor (TWS / IB Gateway).
              </p>
              <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-slate-300">
                Pode usar <strong className="text-slate-200">«Ver ordens detalhadas»</strong> mais abaixo para rever cada
                linha —{" "}
                <strong className="font-semibold text-zinc-200">
                  nada é executado na sua conta sem a sua confirmação no corretor.
                </strong>
              </p>
            </div>

            {/* (B) Resumo — rebalanceamento por ordens (sem valor € em destaque) */}
            {hasTradePlan ? (
              <div className="mx-auto mt-8 w-full max-w-[min(96vw,48rem)]">
                <div className="rounded-xl border border-zinc-600/35 bg-slate-950/55 px-5 py-5 text-left shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] sm:px-6 sm:py-6">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
                    Rebalanceamento da carteira
                  </p>
                  <p className="mt-3 text-lg font-semibold text-white sm:text-xl">
                    {approvedTrades.length}{" "}
                    {approvedTrades.length === 1 ? "ordem proposta" : "ordens propostas"}
                    {displayTrades.length !== approvedTrades.length ? (
                      <span className="text-sm font-normal text-slate-500">
                        {" "}
                        ({displayTrades.length} no ficheiro do plano)
                      </span>
                    ) : null}
                  </p>
                  <ul className="mt-3 list-none space-y-1.5 text-sm text-slate-300">
                    <li>
                      <span className="font-semibold text-slate-200">{portfolioImpact.nBuy}</span>{" "}
                      {portfolioImpact.nBuy === 1 ? "compra" : "compras"}
                    </li>
                    <li>
                      <span className="font-semibold text-slate-200">{portfolioImpact.nSell}</span>{" "}
                      {portfolioImpact.nSell === 1 ? "venda" : "vendas"}
                    </li>
                  </ul>
                  {excludedTickers.length > 0 ? (
                    <p className="mt-3 text-xs text-slate-500">
                      Ordens excluídas desta aprovação:{" "}
                      <span className="font-medium text-slate-400">{excludedTickers.length}</span>
                    </p>
                  ) : null}
                  <p className="mt-4 border-t border-slate-700/60 pt-4 text-xs leading-relaxed text-slate-500">
                    Montantes por linha (volume técnico do modelo) estão no{" "}
                    <Link href="/client/report" className="font-medium text-zinc-400 underline-offset-2 hover:text-zinc-300">
                      plano
                    </Link>
                    — não são o valor da carteira.
                  </p>
                </div>
              </div>
            ) : null}

            {/* (C) Confirmação explícita — antes dos botões principais */}
            {hasTradePlan ? (
              <div className="mx-auto mt-8 w-full max-w-[min(92vw,40rem)]">
                <div className="rounded-xl border border-slate-600/55 bg-slate-950/55 px-5 py-6 text-left shadow-[inset_0_1px_0_rgba(148,163,184,0.08)] sm:px-7 sm:py-7">
                  <p className="text-sm leading-relaxed text-slate-300">
                    Está prestes a aprovar um plano de investimento com base em recomendações geradas pelo sistema. A execução
                    só ocorrerá após a sua confirmação junto da corretora.
                  </p>
                  {canApproveAll ? (
                    <label className="mt-6 flex cursor-pointer items-start gap-4 text-base leading-relaxed text-slate-100">
                      <input
                        type="checkbox"
                        className="mt-0.5 h-5 w-5 shrink-0 rounded border-slate-500 bg-slate-900 text-zinc-400 focus:ring-2 focus:ring-zinc-500/35"
                        checked={confirmReview}
                        onChange={(e) => setConfirmReview(e.target.checked)}
                      />
                      <span>Confirmo que revi a proposta e compreendo os riscos associados.</span>
                    </label>
                  ) : (
                    <p className="mt-5 text-sm text-slate-500">
                      Complete os passos em falta (MiFID, KYC, corretora e plano disponível) para poder confirmar.
                    </p>
                  )}
                </div>
              </div>
            ) : null}

            <div className="mx-auto mt-10 flex w-full max-w-[min(96vw,48rem)] flex-col items-stretch gap-4 sm:flex-row sm:items-stretch sm:justify-center sm:gap-6 lg:gap-10">
              <button
                type="button"
                onClick={handleApprove}
                disabled={!canApproveAll || !confirmReview || approveBusy}
                aria-busy={approveBusy}
                title={
                  !canApproveAll
                    ? !hasTradePlan
                      ? "Sem plano de ordens ou NAV — gere rebalance e actualize tmp_diag"
                      : "Complete MiFID, KYC e preparação IBKR"
                    : !confirmReview
                      ? "Confirme que reviu a proposta e os riscos"
                      : !ibkrSmokeOk
                        ? "Pode aprovar; diagnóstico IBKR em ficheiro não está OK"
                        : "Aprovar plano e preparar execução"
                }
                className="order-1 min-h-[54px] flex-1 rounded-full px-10 text-lg font-bold tracking-tight transition-[transform,box-shadow] hover:enabled:scale-[1.02] hover:enabled:brightness-110 active:enabled:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-55 sm:order-none sm:min-h-[56px] sm:max-w-[min(100%,28rem)] sm:flex-[1.35]"
                style={{
                  ...(canApproveAll
                    ? {
                        background: DECIDE_DASHBOARD.kpiMenuMainButtonBackground,
                        color: DECIDE_DASHBOARD.kpiMenuMainButtonColor,
                        border: DECIDE_DASHBOARD.kpiMenuMainButtonBorder,
                        boxShadow: `${DECIDE_DASHBOARD.kpiMenuMainButtonShadow}, 0 14px 40px rgba(0, 0, 0, 0.45)`,
                        cursor: approveBusy ? "wait" : "pointer",
                      }
                    : {
                        background: "rgba(39, 39, 42, 0.55)",
                        color: "rgba(161, 161, 170, 0.55)",
                        border: "1px solid rgba(255, 255, 255, 0.08)",
                        cursor: "not-allowed",
                      }),
                }}
              >
                {approveBusy ? (
                  <>
                    A abrir plano
                    <InlineLoadingDots />
                  </>
                ) : excludedTickers.length > 0 ? (
                  "Aprovar plano (com exclusões)"
                ) : (
                  "Aprovar plano"
                )}
              </button>
              <Link
                href="/client/report"
                className="order-2 flex min-h-[48px] flex-1 items-center justify-center rounded-full border-2 border-slate-500/75 bg-slate-900/70 px-7 text-center text-[0.95rem] font-semibold text-slate-200/95 transition hover:border-slate-400 hover:bg-slate-800/90 sm:order-none sm:max-w-[13rem] sm:flex-none sm:self-stretch"
              >
                Rever detalhes
              </Link>
            </div>
            {approveBusy ? (
              <p
                className="mx-auto mt-4 max-w-lg px-2 text-center text-xs leading-relaxed text-zinc-400"
                role="status"
              >
                A processar
                <InlineLoadingDots />
              </p>
            ) : approveButtonHint ? (
              <p
                className="mx-auto mt-4 max-w-lg px-2 text-center text-xs leading-relaxed text-zinc-400"
                role="status"
              >
                {approveButtonHint}
              </p>
            ) : null}
            <div className="mx-auto mt-4 max-w-[min(96vw,48rem)] text-center">
              <button
                type="button"
                onClick={handleReject}
                className="text-xs font-medium text-slate-500 underline-offset-4 hover:text-slate-400 hover:underline"
              >
                Não aprovar neste momento
              </button>
            </div>
            <p className="mx-auto mt-5 max-w-lg text-center text-xs leading-relaxed text-slate-500">
              Nada será executado sem a sua confirmação final na corretora.
            </p>
          </section>

          {hasTradePlan ? (
            <section className="mb-6 mt-14 rounded-2xl border border-slate-800/55 bg-slate-950/30 px-6 py-6 sm:px-8">
              <h2 className="text-base font-semibold tracking-tight text-slate-500">
                O que isto representa para si
              </h2>
              <p className="mt-1 text-xs text-slate-600">Contexto — não faz parte da decisão acima.</p>
              {interpretationLines.length > 0 ? (
                <ul className="mt-4 list-inside list-disc space-y-2 text-sm leading-relaxed text-slate-400/90">
                  {interpretationLines.map((line, i) => (
                    <li key={i}>{line}</li>
                  ))}
                </ul>
              ) : null}
              <h3 className="mt-6 text-sm font-semibold uppercase tracking-wide text-slate-500">
                Resumo numérico
              </h3>
              <p className="mt-1 text-xs text-slate-500">
                Ordens em candidatura após exclusões (se as aplicar).
              </p>
              <div
                className="mt-4 rounded-xl border border-zinc-700/40 bg-zinc-950/30 px-4 py-3 text-left text-xs leading-relaxed text-slate-400"
                role="note"
              >
                <p className="font-semibold text-zinc-300">Porque três valores diferentes?</p>
                <ul className="mt-2 list-inside list-disc space-y-2 text-slate-400/95">
                  <li>
                    <strong className="text-slate-300">Valor estimado em compras (Δ)</strong> — soma dos valores
                    estimados das <strong className="text-slate-200">ordens de compra</strong> deste plano (volume{" "}
                    <em>bruto</em> de compras no modelo).{" "}
                    <strong className="text-slate-300">Não é</strong> o seu património total nem o saldo da conta; pode ser{" "}
                    <strong className="text-slate-300">maior que o NAV de calibração</strong> quando há muitas linhas de
                    compra ou rotação relevante.
                  </li>
                  <li>
                    <strong className="text-slate-300">Património (conta paper)</strong> — valor líquido{" "}
                    <strong className="text-slate-200">real</strong> lido da IBKR neste momento. Cancelar ou completar ordens
                    na TWS altera a carteira, mas <strong className="text-slate-300">não recalibra</strong> o ficheiro do
                    plano em <code className="text-slate-500">tmp_diag</code>.
                  </li>
                  <li>
                    <strong className="text-slate-300">NAV de referência do plano</strong> («plano calibrado a…») — património
                    usado quando o <strong className="text-slate-200">último rebalance</strong> gerou o CSV. Mantém-se até
                    correr de novo o modelo com um NAV actualizado; por isso a diferença face à TWS{" "}
                    <strong className="text-slate-300">não desaparece</strong> só por criar/cancelar posições.
                  </li>
                </ul>
              </div>
              <div className="mt-4 grid max-w-md gap-3 sm:grid-cols-2">
                <div className="rounded-xl border border-slate-700/60 bg-slate-950/40 px-4 py-3">
                  <div className="text-[11px] uppercase tracking-wide text-slate-500">Compras</div>
                  <div className="mt-1 text-xl font-semibold tabular-nums text-zinc-200">
                    {portfolioImpact.nBuy}
                  </div>
                </div>
                <div className="rounded-xl border border-slate-700/60 bg-slate-950/40 px-4 py-3">
                  <div className="text-[11px] uppercase tracking-wide text-slate-500">Vendas</div>
                  <div className="mt-1 text-xl font-semibold tabular-nums text-red-300/90">
                    {portfolioImpact.nSell}
                  </div>
                </div>
              </div>
              <p className="mt-3 text-xs text-slate-500">
                Totais em euros (volume técnico) apenas no{" "}
                <Link href="/client/report" className="text-zinc-400 underline-offset-2 hover:text-zinc-300">
                  plano
                </Link>
                .
              </p>
              <p className="mt-4 text-sm leading-relaxed text-slate-400">
                <span className="font-medium text-slate-200">Foco do modelo:</span> {portfolioImpact.theme}
              </p>
            </section>
          ) : null}

          <div className="mb-8 rounded-xl border border-slate-800/70 bg-slate-950/40 px-4 py-3 sm:flex sm:items-center sm:justify-between sm:gap-4">
            <div className="min-w-0 max-w-xl">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                {ibkrLive.ok ? "Património (conta paper)" : "Património de referência (plano)"}
              </div>
              <div className="mt-0.5 text-lg font-semibold text-slate-200">
                {ibkrLive.loading && !ibkrLive.ok ? (
                  <span className="text-slate-500">…</span>
                ) : ibkrLive.ok && ibkrLive.nav > 0 ? (
                  formatMoney(ibkrLive.nav, ibkrLive.navCcy)
                ) : displayNavEur > 0 ? (
                  formatEuro(displayNavEur)
                ) : (
                  "—"
                )}
              </div>
              {displayNavEur > 0 ? (
                <div className="mt-1.5 space-y-1 text-[10px] leading-snug text-slate-500">
                  {ibkrLive.ok && ibkrLive.nav > 0 ? (
                    <>
                      <div>
                        <span className="text-slate-600">NAV de referência do plano (último rebalance): </span>
                        <span className="font-medium text-slate-400">{formatEuro(displayNavEur)}</span>
                      </div>
                      {normalizeCcy(ibkrLive.navCcy) === "EUR" &&
                      Math.abs(ibkrLive.nav - displayNavEur) > Math.max(500, displayNavEur * 0.02) ? (
                        <div className="text-slate-500">
                          A conta (~{formatEuro(ibkrLive.nav)}) e o plano (~{formatEuro(displayNavEur)}) usam referências
                          diferentes; isso é esperado até voltar a correr o rebalance com o NAV que pretende como base.
                        </div>
                      ) : null}
                    </>
                  ) : (
                    <div>
                      <span className="text-slate-600">NAV de referência do plano (sem leitura TWS): </span>
                      <span className="font-medium text-slate-400">{formatEuro(displayNavEur)}</span>
                    </div>
                  )}
                </div>
              ) : null}
              {ibkrLive.error ? (
                <div className="mt-1 max-w-xs text-[10px] text-amber-500/95">{ibkrLive.error}</div>
              ) : null}
              <p className="mt-2 max-w-xl text-[10px] leading-snug text-slate-600">
                O backend só aceita envio de ordens com <strong className="font-medium text-slate-500">paper_mode</strong> e
                conta <strong className="font-medium text-slate-500">paper (DU*)</strong> quando a protecção está activa —
                não envia para conta real.
              </p>
            </div>
            <button
              type="button"
              onClick={() => void refreshIbkrSnapshot()}
              disabled={ibkrLive.loading}
              className="mt-3 shrink-0 rounded-lg border border-slate-600/80 bg-slate-900/80 px-3 py-1.5 text-[11px] font-medium text-slate-400 hover:border-slate-500 hover:text-slate-300 disabled:cursor-wait disabled:opacity-70 sm:mt-0"
            >
              {ibkrLive.loading ? (
                <>
                  A ler TWS
                  <InlineLoadingDots />
                </>
              ) : (
                "Atualizar leitura (TWS)"
              )}
            </button>
          </div>

          {flowReady && canExclude ? (
            <section
              className="mb-6 rounded-xl border border-zinc-600/40 px-5 py-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]"
              style={{
                background: DECIDE_DASHBOARD.flowTealPanelGradientSoft,
                borderColor: "rgba(255, 255, 255, 0.1)",
              }}
            >
              <div className="text-sm font-semibold tracking-tight text-zinc-200">
                Quer ajustar o plano?
              </div>
              <p className="mt-1.5 max-w-3xl text-sm leading-relaxed text-slate-300">
                Pode <strong className="text-slate-100">remover até {maxExclusions} ordens</strong> na tabela de ordens
                detalhadas (expandir em baixo; caixas «Excluir»). Cada exclusão deixa de integrar a aprovação; se não
                excluir nada, considera-se <strong className="text-slate-100">aprovação integral</strong> do plano.
              </p>
            </section>
          ) : null}

          {flowReady && !canExclude && hasTradePlan ? (
            <section className="mb-6 rounded-xl border border-slate-700/80 bg-slate-900/40 px-5 py-3">
              <p className="text-sm text-slate-400">
                Para este património de referência, o plano é{" "}
                <span className="font-semibold text-slate-200">aprovado ou não aprovado na totalidade</span>{" "}
                (sem exclusões parciais). Clientes com NAV ≥ 50&nbsp;000&nbsp;€ podem remover até 5 ordens.
              </p>
            </section>
          ) : null}

          <section className="mt-2 border-t border-slate-800/90 pt-8">
            <details className="group rounded-xl border border-slate-800/80 bg-slate-900/30">
              <summary className="cursor-pointer list-none px-4 py-3 text-sm font-semibold text-zinc-300 marker:content-none [&::-webkit-details-marker]:hidden">
                <span className="inline-flex items-center gap-2">
                  Ver ordens detalhadas
                  <span className="text-xs font-normal text-slate-500 group-open:hidden">— expandir</span>
                  <span className="hidden text-xs font-normal text-slate-500 group-open:inline">— ocultar</span>
                </span>
              </summary>
              <div className="border-t border-slate-800/80 px-4 pb-4 pt-2">
            <div className="mb-3 text-xs text-slate-500">
              Mesma lógica que «Alterações propostas» no plano (quantidade 0 = alvo sem ordem IBKR exportada). Clique
              numa linha para destacar.
            </div>
            <div className="max-h-[min(70vh,560px)] overflow-auto rounded-xl border border-slate-800 bg-slate-900/60 shadow-inner">
              <table className="min-w-full border-collapse text-xs">
                <thead className="sticky top-0 z-20 border-b border-slate-700/80 bg-slate-900/95 text-slate-400 shadow-[0_4px_12px_rgba(0,0,0,0.35)] backdrop-blur-sm">
                  <tr>
                    <th className="px-3 py-2.5 text-left">
                      {canExclude ? "Excluir" : "#"}
                    </th>
                    <th className="px-3 py-2.5 text-left">Ticker</th>
                    <th className="px-3 py-2.5 text-left">Nome</th>
                    <th className="px-3 py-2.5 text-right">Sentido</th>
                    <th className="px-3 py-2.5 text-right">Quantidade</th>
                    <th className="px-3 py-2.5 text-right">Preço</th>
                    <th className="px-3 py-2.5 text-right">
                      Valor estimado (&Delta;)
                    </th>
                    <th className="px-3 py-2.5 text-right">Peso alvo</th>
                  </tr>
                </thead>
                <tbody>
                  {displayTrades.map((t, idx) => {
                    const excluded = excludedTickers.includes(t.ticker);
                    const sideU = safeString(t.side, "").toUpperCase();
                    const isInactive = sideU === "INACTIVE";
                    const isSell = sideU === "SELL";
                    const isSoleSellRow = isSell && soleSellTicker === t.ticker.toUpperCase();
                    const canShowExcludeCheckbox =
                      canExclude &&
                      t.ticker !== "TBILL_PROXY" &&
                      t.ticker !== "EUR_MM_PROXY" &&
                      t.ticker !== "EURUSD" &&
                      (sideU === "BUY" || isInactive);
                    const disableCheckbox =
                      isInactive ||
                      (!excluded && canExclude && excludedTickers.length >= maxExclusions);
                    const rowFocused = tableFocusIdx === idx;

                    return (
                      <tr
                        key={`${t.ticker}-${idx}`}
                        role="button"
                        tabIndex={0}
                        onClick={() => setTableFocusIdx(idx)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            setTableFocusIdx(idx);
                          }
                        }}
                        className={[
                          "border-t border-slate-800/80 transition-colors",
                          excluded
                            ? "bg-slate-900/70 text-slate-500"
                            : "cursor-pointer hover:bg-slate-800/55",
                          rowFocused && !excluded
                            ? "bg-slate-800/75 ring-1 ring-inset ring-zinc-500/35"
                            : "",
                          isSell && !excluded
                            ? isSoleSellRow
                              ? "border-l-[3px] border-l-red-500 bg-red-950/25 hover:bg-red-950/35"
                              : "border-l-2 border-l-red-500/80 bg-red-950/10 hover:bg-red-950/20"
                            : "",
                        ].join(" ")}
                      >
                        <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                          {canExclude ? (
                            canShowExcludeCheckbox ? (
                              <input
                                type="checkbox"
                                checked={excluded}
                                disabled={disableCheckbox}
                                onChange={() => handleToggle(t.ticker)}
                              />
                            ) : null
                          ) : (
                            idx + 1
                          )}
                        </td>
                        <td className="px-3 py-2 font-semibold text-zinc-200">
                          {t.ticker}
                        </td>
                        <td className="px-3 py-2 text-slate-300">
                          {t.nameShort || "-"}
                        </td>
                        <td
                          className={`px-3 py-2 text-right font-semibold ${
                            sideU === "BUY"
                              ? "text-zinc-300"
                              : sideU === "SELL"
                                ? "text-red-200"
                                : "text-slate-400"
                          }`}
                        >
                          <span className="inline-flex flex-wrap items-center justify-end gap-1.5">
                            {isInactive ? (
                              "INATIVO"
                            ) : (
                              <>
                                <span>{sideU}</span>
                                {isSell ? (
                                  <span
                                    className={`rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white ${
                                      isSoleSellRow ? "bg-red-600 shadow-sm shadow-red-900/50" : "bg-red-700/90"
                                    }`}
                                  >
                                    {isSoleSellRow ? "Única venda" : "Venda"}
                                  </span>
                                ) : null}
                              </>
                            )}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-slate-200">
                          {t.absQty.toLocaleString("pt-PT")}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-slate-200">
                          {t.marketPrice > 0 ? t.marketPrice.toFixed(2) : "—"}
                        </td>
                        <td className="px-3 py-2 text-right">
                          {isBuyMissingEquityClosePrice(t) ? (
                            <span
                              className="text-slate-500"
                              title="Sem preço de fecho para este ticker em backend/data/prices_close.csv — não é possível calcular quantidade nem impacto executável. Atualize o ficheiro de closes ou use preço da corretora."
                            >
                              —
                            </span>
                          ) : (
                            formatEuro(t.deltaValueEst)
                          )}
                        </td>
                        <td className="px-3 py-2 text-right">
                          {formatPct(t.targetWeightPct)}
                        </td>
                      </tr>
                    );
                  })}
                  {displayTrades.length === 0 && (
                    <tr>
                      <td
                        colSpan={8}
                        className="px-3 py-5 text-center text-slate-400"
                      >
                        Não há linhas no plano (NAV em falta ou modelo indisponível). Abra o{" "}
                        <Link href="/client/report" className="text-zinc-400 underline">
                          plano
                        </Link>{" "}
                        e confirme que «Alterações propostas» tem dados.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
              </div>
            </details>
          </section>

        </div>
      </main>
    </>
  );
}

