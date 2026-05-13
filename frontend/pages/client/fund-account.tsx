import React, { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import type { GetServerSideProps } from "next";
import Head from "next/head";
import { useRouter } from "next/router";
import OnboardingFlowBar, {
  ONBOARDING_LOCALSTORAGE_CHANGED_EVENT,
  ONBOARDING_MONTANTE_KEY,
} from "../../components/OnboardingFlowBar";
import { DECIDE_DASHBOARD, ONBOARDING_SHELL_MAX_WIDTH_PX } from "../../lib/decideClientTheme";
import { loadApprovalAlignedProposedTrades } from "../../lib/server/approvalTradePlan";
import { resolveDecideProjectRoot } from "../../lib/server/decideProjectRoot";
import { FUNDING_STATUS_LS_KEY, type FundingStatus, readFundingStatus, writeFundingStatus } from "../../lib/fundingFlow";
import { readDefaultRiskProfileFromOnboarding, LS_MIFID_FIELDS } from "../../lib/decideOnboardingRiskProfile";
import {
  CLIENT_SESSION_CHANGED_EVENT,
  deriveClientUsernameFromEmail,
  getCurrentSessionUser,
  getCurrentSessionUserEmail,
  isClientLoggedIn,
  repairSessionFromOnboardingFlags,
} from "../../lib/clientAuth";
import {
  FUND_DEPOSIT_BLOCKED_EXPLANATION,
  getNextOnboardingHref,
  isClientEligibleToDepositFunds,
  isOnboardingFlowComplete,
} from "../../lib/onboardingProgress";
import ClientPendingTextLink from "../../components/ClientPendingTextLink";

type PageProps = {
  navEur: number;
  /** Soma das pernas BUY do plano (acções, caixa, FX, etc.) — volume operacional bruto; não é capital a depositar. */
  grossBuyOrderVolumeEur: number;
  /** Soma BUY excluindo pernas puramente cambiais (ex.: EUR.USD hedge), para contexto sem dupla contagem FX. */
  equityBuyVolumeEur: number;
};

const EMPTY: PageProps = {
  navEur: 0,
  grossBuyOrderVolumeEur: 0,
  equityBuyVolumeEur: 0,
};

const MIN_FUNDING_DISPLAY_EUR = 5000;

function safeNumber(x: unknown, fallback = 0): number {
  const v = typeof x === "number" ? x : Number(x);
  return Number.isFinite(v) ? v : fallback;
}

function formatEuro(v: number): string {
  return new Intl.NumberFormat("pt-PT", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(v);
}

/** IBAN para colar no banco: sem espaços, maiúsculas (aceite universalmente em SEPA). */
function ibanForClipboard(raw: string): string {
  return raw.replace(/\s/g, "").toUpperCase();
}

/** Só para ecrã: grupos de 4 caracteres (o valor transmitido/copiado continua «tudo junto»). */
function ibanForGroupedDisplay(compactNoSpaces: string): string {
  const c = compactNoSpaces.replace(/\s/g, "").toUpperCase();
  if (!c) return "";
  return c.replace(/(.{4})/g, "$1 ").trim();
}

/** O URL antigo `index.php?f=458` devolve 404; suporte oficial de funding. */
const DEFAULT_IBKR_DEPOSIT_HELP_URL = "https://www.interactivebrokers.com/en/support/fund-my-account.php";

/** Guia SEPA no portal de documentação IBKR (instruções passo a passo no Client Portal). */
const IBKR_SEPA_GUIDE_URL = "https://www.ibkrguides.com/orgportal/transferandpay/sepa-transfer.htm";

export const getServerSideProps: GetServerSideProps<PageProps> = async () => {
  try {
    const projectRoot = resolveDecideProjectRoot();
    const { trades, navEur } = await loadApprovalAlignedProposedTrades(projectRoot);
    let grossBuyOrderVolumeEur = 0;
    let equityBuyVolumeEur = 0;
    for (const t of trades) {
      const side = String((t as { side?: string }).side || "").toUpperCase();
      if (side !== "BUY") continue;
      const ticker = String((t as { ticker?: string }).ticker || "").toUpperCase();
      const d = safeNumber((t as { deltaValueEst?: number }).deltaValueEst, 0);
      grossBuyOrderVolumeEur += d;
      if (ticker !== "EURUSD") equityBuyVolumeEur += d;
    }

    return {
      props: {
        navEur,
        grossBuyOrderVolumeEur,
        equityBuyVolumeEur,
      },
    };
  } catch (e) {
    console.error("[fund-account] getServerSideProps", e);
    return { props: EMPTY };
  }
};

function CopyIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

const fundExitNavBtnClass =
  "inline-flex min-w-[118px] items-center justify-center rounded-xl px-4 py-2.5 text-sm font-bold no-underline ring-2 ring-zinc-500/35 transition hover:brightness-110";

function FundAccountExitNav({ className }: { className?: string }) {
  const exitBtnStyle: React.CSSProperties = {
    background: DECIDE_DASHBOARD.buttonRegister,
    color: DECIDE_DASHBOARD.kpiMenuMainButtonColor,
    border: DECIDE_DASHBOARD.kpiMenuMainButtonBorder,
    boxShadow: DECIDE_DASHBOARD.kpiMenuMainButtonShadow,
  };
  return (
    <nav
      className={["flex flex-wrap justify-end gap-2", className].filter(Boolean).join(" ")}
      aria-label="Saída para outras áreas"
    >
      <ClientPendingTextLink href="/client-dashboard" className={fundExitNavBtnClass} style={exitBtnStyle}>
        Dashboard
      </ClientPendingTextLink>
      <ClientPendingTextLink href="/client/report" className={fundExitNavBtnClass} style={exitBtnStyle}>
        Plano
      </ClientPendingTextLink>
    </nav>
  );
}

function resolveFundingTransferDescritivo(): string {
  const u = (getCurrentSessionUser() || "").trim().toLowerCase();
  if (u) return u;
  const email = (getCurrentSessionUserEmail() || "").trim();
  const fromEmail = deriveClientUsernameFromEmail(email);
  if (fromEmail) return fromEmail;
  return "Utilizador da conta em falta — volte a iniciar sessão ou contacte o suporte.";
}

export default function FundAccountPage({
  navEur,
  grossBuyOrderVolumeEur,
  equityBuyVolumeEur,
}: PageProps) {
  const router = useRouter();
  const [fundGateReady, setFundGateReady] = useState(false);
  const [depositUnlocked, setDepositUnlocked] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [fundingStatus, setFundingStatus] = useState<FundingStatus>("awaiting");
  const [copyMsg, setCopyMsg] = useState("");
  const [stepsOpen, setStepsOpen] = useState(false);
  /** Mesmo valor que o cliente escolheu no registo (login); obrigatório no descritivo SEPA para a IBKR. */
  const [transferDescritivo, setTransferDescritivo] = useState("");
  /** Montante confirmado no passo «Valor a investir» (`/client-montante`). */
  const [onboardingMontanteEur, setOnboardingMontanteEur] = useState<number | null>(null);
  /** Quando o funil regulamentar já terminou, a página de depósito fica sem a barra de passos (vista isolada). */
  const [onboardingFlowComplete, setOnboardingFlowComplete] = useState(false);
  /** Perfil de risco MiFID para enriquecer o bloco de montante. */
  const [mifidProfile, setMifidProfile] = useState<"conservador" | "moderado" | "dinamico" | null>(null);
  /** Horizonte em anos (do questionário MiFID). */
  const [mifidHorizonte, setMifidHorizonte] = useState(0);

  const iban = (process.env.NEXT_PUBLIC_IBKR_DEPOSIT_IBAN || "").trim();
  const hasIban = iban.length > 0;
  /** Sem espaços — o mesmo valor que o botão «Copiar IBAN» cola no homebanking. */
  const ibanCompact = hasIban ? ibanForClipboard(iban) : "";
  const ibanGroupedDisplay = hasIban ? ibanForGroupedDisplay(ibanCompact) : "";
  const beneficiary = (process.env.NEXT_PUBLIC_IBKR_DEPOSIT_BENEFICIARY || "Interactive Brokers").trim();
  const helpUrl =
    (process.env.NEXT_PUBLIC_IBKR_DEPOSIT_HELP_URL || "").trim() || DEFAULT_IBKR_DEPOSIT_HELP_URL;

  /** Fallback quando não há montante no onboarding: NAV do plano, depois compras (sem usar volume bruto com FX). */
  const fallbackSuggestedEur = useMemo(() => {
    const nav = Math.round(Math.max(0, navEur));
    if (nav > 0) return nav;
    return Math.round(Math.max(0, equityBuyVolumeEur));
  }, [navEur, equityBuyVolumeEur]);

  const suggestedEur = onboardingMontanteEur ?? fallbackSuggestedEur;
  const suggestedFromOnboardingStep = onboardingMontanteEur != null;

  useLayoutEffect(() => {
    repairSessionFromOnboardingFlags();
    if (!isClientLoggedIn()) {
      window.location.href = "/client/register";
      return;
    }
    setDepositUnlocked(isClientEligibleToDepositFunds());
    setFundGateReady(true);
    setTransferDescritivo(resolveFundingTransferDescritivo());
    setMounted(true);
    setOnboardingFlowComplete(isOnboardingFlowComplete());
    setFundingStatus(readFundingStatus());
    try {
      const raw = window.localStorage.getItem(ONBOARDING_MONTANTE_KEY);
      const n = raw != null ? Math.round(Number(String(raw).replace(/\s/g, ""))) : NaN;
      if (Number.isFinite(n) && n >= MIN_FUNDING_DISPLAY_EUR) setOnboardingMontanteEur(n);
    } catch {
      /* ignore */
    }
    try {
      const profile = readDefaultRiskProfileFromOnboarding();
      if (profile) setMifidProfile(profile);
      const mifidRaw = window.localStorage.getItem(LS_MIFID_FIELDS);
      if (mifidRaw) {
        const parsed = JSON.parse(mifidRaw) as Record<string, unknown>;
        const h = Number(parsed.horizonte);
        if (Number.isFinite(h) && h > 0) setMifidHorizonte(h);
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    if (!fundGateReady) return;
    const sync = () => {
      try {
        setDepositUnlocked(isClientEligibleToDepositFunds());
      } catch {
        setDepositUnlocked(false);
      }
    };
    window.addEventListener(ONBOARDING_LOCALSTORAGE_CHANGED_EVENT, sync);
    window.addEventListener(CLIENT_SESSION_CHANGED_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(ONBOARDING_LOCALSTORAGE_CHANGED_EVENT, sync);
      window.removeEventListener(CLIENT_SESSION_CHANGED_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, [fundGateReady]);

  const persistStatus = useCallback((s: FundingStatus) => {
    writeFundingStatus(s);
    setFundingStatus(s);
    try {
      window.dispatchEvent(new Event(ONBOARDING_LOCALSTORAGE_CHANGED_EVENT));
    } catch {
      // ignore
    }
  }, []);

  const copyToClipboard = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopyMsg("Copiado ✓");
      window.setTimeout(() => setCopyMsg(""), 2000);
    } catch {
      setCopyMsg("Não foi possível copiar automaticamente — seleccione o texto manualmente.");
      window.setTimeout(() => setCopyMsg(""), 3500);
    }
  }, []);

  const onTransferred = () => {
    persistStatus("transferred");
    void router.push("/client/report?from=funding");
  };

  const onMarkReceived = () => {
    persistStatus("received");
  };

  const scrollToDetails = () => {
    const el = document.getElementById("instrucoes-detalhadas");
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const continueRegistoBtnStyle: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 12,
    padding: "12px 18px",
    fontWeight: 800,
    fontSize: 14,
    textDecoration: "none",
    background: DECIDE_DASHBOARD.buttonRegister,
    color: DECIDE_DASHBOARD.kpiMenuMainButtonColor,
    border: DECIDE_DASHBOARD.kpiMenuMainButtonBorder,
    boxShadow: DECIDE_DASHBOARD.kpiMenuMainButtonShadow,
  };

  if (!fundGateReady) {
    return (
      <>
        <Head>
          <title>DECIDE — Depositar na sua conta</title>
        </Head>
        <main
          className="min-h-screen text-slate-50"
          style={{ background: DECIDE_DASHBOARD.pageBg, fontFamily: DECIDE_DASHBOARD.fontFamily }}
        >
          <div className="mx-auto px-6 py-10" style={{ maxWidth: ONBOARDING_SHELL_MAX_WIDTH_PX, width: "100%" }}>
            <p className="text-sm text-slate-500">A preparar…</p>
          </div>
        </main>
      </>
    );
  }

  if (!depositUnlocked) {
    return (
      <>
        <Head>
          <title>DECIDE — Depositar na sua conta</title>
        </Head>
        <main
          className="min-h-screen text-slate-50"
          style={{ background: DECIDE_DASHBOARD.pageBg, fontFamily: DECIDE_DASHBOARD.fontFamily }}
        >
          <div className="mx-auto px-6 py-10" style={{ maxWidth: ONBOARDING_SHELL_MAX_WIDTH_PX, width: "100%" }}>
            <header className="mb-8 border-b border-slate-800 pb-6">
              <div className="flex flex-wrap items-center justify-between gap-3 gap-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Financiamento</p>
                <FundAccountExitNav />
              </div>
              <h1 className="mt-4 text-2xl font-semibold tracking-tight text-slate-50">Depositar na sua conta</h1>
            </header>
            <div
              role="alert"
              className="max-w-2xl rounded-xl border px-5 py-5"
              style={{
                borderColor: "rgba(234, 179, 8, 0.45)",
                background: "rgba(234, 179, 8, 0.1)",
              }}
            >
              <p className="text-base font-bold text-amber-100">Registo incompleto</p>
              <p className="mt-3 text-sm leading-relaxed text-amber-50/90">{FUND_DEPOSIT_BLOCKED_EXPLANATION}</p>
              <div className="mt-5">
                <ClientPendingTextLink href={getNextOnboardingHref()} style={continueRegistoBtnStyle}>
                  Continuar o registo
                </ClientPendingTextLink>
              </div>
            </div>
          </div>
        </main>
      </>
    );
  }

  return (
    <>
      <Head>
        <title>DECIDE — Depositar na sua conta</title>
      </Head>
      <main
        className="min-h-screen text-slate-50"
        style={{ background: DECIDE_DASHBOARD.pageBg, fontFamily: DECIDE_DASHBOARD.fontFamily }}
      >
        <div className="mx-auto px-6 py-10" style={{ maxWidth: ONBOARDING_SHELL_MAX_WIDTH_PX, width: "100%" }}>
          {mounted && !onboardingFlowComplete ? (
            <OnboardingFlowBar currentStepId="approve" authStepHref="/client/register" currentStepAlwaysActive />
          ) : null}

          <header className="mb-9 border-b border-slate-800 pb-6">
            <div className="flex flex-wrap items-center justify-between gap-3 gap-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Financiamento</p>
              <FundAccountExitNav />
            </div>
            <h1 className="mt-4 text-2xl font-semibold tracking-tight text-slate-50">Depositar na sua conta</h1>
            <p className="mt-3 max-w-2xl text-base font-medium leading-snug text-slate-100">
              <span className="font-semibold text-zinc-300">Próximo passo:</span> faça uma transferência para ativar o
              plano.
            </p>
            <p className="mt-3 max-w-2xl text-sm leading-relaxed text-slate-400">
              Para executar o plano, é necessário adicionar fundos à sua conta na corretora. A transferência é feita{" "}
              <strong className="text-slate-200">directamente para a IBKR</strong> — a DECIDE não recebe o seu
              dinheiro.
            </p>
          </header>

          {mounted ? (
            <div className="mb-9 flex max-w-2xl flex-col gap-3">
              {/* Funding progress tracker */}
              <div className="rounded-xl border border-slate-700/50 bg-slate-900/40 px-4 py-4">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-500 mb-3">Progresso do onboarding</p>
                <ol className="space-y-2">
                  {[
                    { label: "Conta criada", done: true },
                    { label: "Perfil validado (MiFID)", done: true },
                    { label: "Identidade verificada", done: true },
                    { label: "Financiamento da conta", done: fundingStatus === "received", active: fundingStatus === "awaiting" || fundingStatus === "transferred" },
                    { label: "Plano pronto para execução", done: false, active: false },
                  ].map((step, i) => (
                    <li key={i} className="flex items-center gap-3">
                      <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${step.done ? "bg-emerald-500/20 text-emerald-400" : step.active ? "border border-amber-500/50 text-amber-400 bg-amber-950/30" : "border border-slate-700 text-slate-600"}`}>
                        {step.done ? "✓" : step.active ? "⏳" : "○"}
                      </span>
                      <span className={`text-sm ${step.done ? "text-slate-300" : step.active ? "font-semibold text-amber-100" : "text-slate-600"}`}>
                        {step.label}
                      </span>
                    </li>
                  ))}
                </ol>
              </div>

              {fundingStatus === "awaiting" ? (
                <div
                  className="rounded-xl border px-4 py-3"
                  style={{
                    borderColor: "rgba(234, 179, 8, 0.4)",
                    background: "rgba(234, 179, 8, 0.06)",
                  }}
                >
                  <p className="text-sm font-bold text-amber-100">Próximo passo: realizar a sua transferência</p>
                  <p className="mt-1 text-sm leading-relaxed text-amber-100/80">
                    Use os dados abaixo para transferir diretamente para a Interactive Brokers.
                  </p>
                </div>
              ) : null}
              {fundingStatus === "transferred" ? (
                <div
                  className="rounded-xl border px-4 py-3"
                  style={{
                    borderColor: "rgba(255, 255, 255, 0.14)",
                    background: "rgba(0, 0, 0, 0.25)",
                  }}
                >
                  <p className="text-sm font-bold text-zinc-200">⏳ Transferência indicada por si</p>
                  <p className="mt-1.5 text-sm leading-relaxed text-zinc-400">
                    Confirme no Client Portal IBKR quando o saldo estiver disponível (tipicamente 1–2 dias úteis).
                  </p>
                </div>
              ) : null}
              {fundingStatus === "received" ? (
                <div
                  className="rounded-xl border px-4 py-3"
                  style={{
                    borderColor: "rgba(255, 255, 255, 0.16)",
                    background: "rgba(39, 39, 42, 0.55)",
                  }}
                >
                  <p className="text-sm font-bold text-zinc-100">✓ Fundos recebidos (confirmado por si)</p>
                  <p className="mt-1.5 text-sm leading-relaxed text-zinc-400">
                    Pode avançar para o plano e executar as ordens.
                  </p>
                </div>
              ) : null}
            </div>
          ) : null}

          <section
            className={`mb-9 rounded-2xl border p-5 ${mounted ? "mt-2.5" : ""}`}
            style={{
              borderColor: "rgba(255, 255, 255, 0.1)",
              background: DECIDE_DASHBOARD.clientPanelGradient,
              boxShadow: DECIDE_DASHBOARD.clientPanelShadow,
            }}
          >
            <h2 className="text-sm font-bold uppercase tracking-wide text-zinc-400">Simulação do plano inicial</h2>
            <p className="mt-1 text-xs text-slate-500">
              {suggestedFromOnboardingStep
                ? "Montante definido no passo 2 do onboarding."
                : "Valor ilustrativo a partir do plano — confirme o montante em «Valor a investir»."}
            </p>
            <p className="mt-4 text-3xl font-bold tabular-nums tracking-tight text-white">
              {suggestedEur > 0 ? formatEuro(suggestedEur) : "—"}
            </p>
            {/* Profile-derived simulation context */}
            {mifidProfile && suggestedEur > 0 && (
              <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                {[
                  {
                    label: "Perfil",
                    value: mifidProfile === "dinamico" ? "Dinâmico" : mifidProfile === "moderado" ? "Moderado" : "Conservador",
                  },
                  {
                    label: "Estratégia",
                    value: mifidProfile === "dinamico" ? "Ações globais" : mifidProfile === "moderado" ? "Mista" : "Defensiva",
                  },
                  {
                    label: "Horizonte",
                    value: mifidHorizonte > 0 ? `${mifidHorizonte} anos` : "Longo prazo",
                  },
                  {
                    label: "Volatilidade est.",
                    value: mifidProfile === "dinamico" ? "~26% a.a." : mifidProfile === "moderado" ? "~15% a.a." : "~8% a.a.",
                  },
                ].map(({ label, value }) => (
                  <div key={label} className="rounded-lg border border-slate-700/40 bg-slate-950/50 px-3 py-2">
                    <div className="text-[10px] font-medium uppercase tracking-wide text-slate-500">{label}</div>
                    <div className="mt-0.5 text-sm font-semibold text-slate-200">{value}</div>
                  </div>
                ))}
              </div>
            )}
            {suggestedEur > 0 ? (
              <p className="mt-3 max-w-xl text-sm font-medium leading-relaxed text-zinc-300">
                {suggestedFromOnboardingStep
                  ? "Transferir este montante permite executar o plano sem ajustes."
                  : "Montante ilustrativo. Transferir este valor aproximado permite executar o plano sem ajustes."}
              </p>
            ) : null}
            {/* Custody note */}
            <div className="mt-4 rounded-lg border border-slate-700/40 bg-slate-950/30 px-3 py-2.5 text-xs leading-relaxed text-slate-400">
              <strong className="text-slate-200">A conta Interactive Brokers está em seu nome.</strong>{" "}
              O DECIDE não detém os seus fundos — os activos permanecem custodiados directamente na Interactive Brokers, regulada pelos supervisores aplicáveis.
            </div>
            {suggestedFromOnboardingStep && grossBuyOrderVolumeEur > suggestedEur * 1.02 ? (
              <p className="mt-3 max-w-xl text-xs leading-relaxed text-slate-500">
                O plano pode gerar{" "}
                <strong className="text-slate-400">volume de ordens superior</strong> ao montante acima (inclui, por
                exemplo, operações cambiais e rebalanceamento). Isso{" "}
                <strong className="text-slate-400">não significa</strong> que precise de depositar mais do que o valor
                que indicou — é volume operacional interno na corretora.
              </p>
            ) : null}
            {grossBuyOrderVolumeEur > 0 ? (
              <details className="mt-4 max-w-xl rounded-lg border border-slate-700/50 bg-slate-950/30 px-3 py-2.5 text-left">
                <summary className="cursor-pointer list-none text-xs font-semibold text-slate-500 marker:content-none hover:text-slate-400 [&::-webkit-details-marker]:hidden">
                  Volume total de ordens (detalhe técnico)
                </summary>
                <div className="mt-3 space-y-3 border-t border-slate-700/50 pt-3 text-xs leading-relaxed text-slate-500">
                  <p>
                    Soma ilustrativa das pernas <strong className="text-slate-400">BUY</strong> do plano (acções, caixa,
                    hedge cambial EUR/USD quando existir, etc.). Serve para execução interna —{" "}
                    <strong className="text-slate-400">não é</strong> o dinheiro que precisa de enviar a mais além do
                    montante indicado em «Valor a investir».
                  </p>
                  <div className="rounded-md border border-slate-700/60 bg-slate-900/50 px-3 py-2 font-mono text-sm tabular-nums text-slate-400">
                    {formatEuro(Math.round(grossBuyOrderVolumeEur))}
                  </div>
                  {equityBuyVolumeEur > 0 && Math.abs(equityBuyVolumeEur - grossBuyOrderVolumeEur) > 1 ? (
                    <p>
                      Para referência, soma de compras <strong className="text-slate-400">sem</strong> a perna cambial
                      EUR/USD (quando presente):{" "}
                      <span className="font-mono text-slate-400">{formatEuro(Math.round(equityBuyVolumeEur))}</span>
                    </p>
                  ) : null}
                </div>
              </details>
            ) : null}
          </section>

          <section className="mb-9">
            <h2 className="text-lg font-semibold text-slate-100">Transferência bancária (IBKR)</h2>
            <p className="mt-2 text-sm text-slate-400">
              Use estes dados no seu banco (homebanking). Copie cada campo para evitar erros.
            </p>
            <div className="mt-4 space-y-3 rounded-xl border border-slate-700/80 bg-slate-900/40 p-4">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Beneficiário</div>
                  <div className="mt-1 font-mono text-sm text-slate-100">{beneficiary}</div>
                </div>
                <button
                  type="button"
                  className="inline-flex shrink-0 items-center justify-center gap-2 self-start rounded-lg px-3.5 py-2.5 text-xs font-bold text-zinc-50 shadow-md ring-2 ring-zinc-500/35 transition hover:brightness-110 sm:mt-5"
                  style={{
                    background: DECIDE_DASHBOARD.buttonRegister,
                    boxShadow: "0 2px 12px rgba(0, 0, 0, 0.4)",
                  }}
                  onClick={() => void copyToClipboard(beneficiary)}
                >
                  <CopyIcon className="opacity-95" />
                  Copiar
                </button>
              </div>
              <div className="border-t border-slate-700/80 pt-3">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">IBAN</div>
                    {hasIban ? (
                      <>
                        <div className="mt-1 break-all font-mono text-sm font-semibold tracking-wide text-slate-100">
                          {ibanGroupedDisplay}
                        </div>
                        <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
                          «Copiar IBAN» cola o número completo, sem espaços.
                        </p>
                        <p className="mt-2 text-xs leading-relaxed text-slate-500">
                          Instruções oficiais:{" "}
                          <a
                            href={helpUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-semibold text-zinc-400 underline-offset-2 hover:text-zinc-300 hover:underline"
                          >
                            Fundir a conta (IBKR)
                          </a>
                          {" · "}
                          <a
                            href={IBKR_SEPA_GUIDE_URL}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-semibold text-zinc-400 underline-offset-2 hover:text-zinc-300 hover:underline"
                          >
                            Guia transferência SEPA
                          </a>{" "}
                          (nova janela).
                        </p>
                      </>
                    ) : (
                      <p className="mt-1 text-sm leading-relaxed text-slate-400">
                        Obtenha o IBAN correcto no{" "}
                        <a
                          href={helpUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-semibold text-teal-300/95 underline-offset-2 hover:text-teal-200 hover:underline"
                        >
                          site IBKR — Fundir a conta
                        </a>{" "}
                        ou no{" "}
                        <a
                          href={IBKR_SEPA_GUIDE_URL}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-semibold text-teal-300/95 underline-offset-2 hover:text-teal-200 hover:underline"
                        >
                          guia SEPA (Client Portal)
                        </a>
                        .
                      </p>
                    )}
                  </div>
                  <button
                    type="button"
                    disabled={!hasIban}
                    className="inline-flex shrink-0 items-center justify-center gap-2 self-start rounded-lg px-3.5 py-2.5 text-xs font-bold text-zinc-50 shadow-md ring-2 ring-zinc-500/35 transition hover:brightness-110 enabled:cursor-pointer disabled:cursor-not-allowed disabled:opacity-45 sm:mt-5"
                    style={{
                      background: DECIDE_DASHBOARD.buttonRegister,
                      boxShadow: "0 2px 12px rgba(0, 0, 0, 0.4)",
                    }}
                    title={hasIban ? undefined : "Defina o IBAN no ambiente ou use o link da IBKR"}
                    aria-label={hasIban ? "Copiar IBAN" : "IBAN indisponível — use a página da IBKR"}
                    onClick={() => {
                      if (!hasIban) return;
                      void copyToClipboard(ibanCompact);
                    }}
                  >
                    <CopyIcon className="opacity-95" />
                    Copiar IBAN
                  </button>
                </div>
              </div>
              <div className="border-t border-slate-700/80 pt-3">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="inline-flex items-center rounded-md bg-teal-500/15 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-teal-100 ring-1 ring-teal-400/35">
                        Descritivo obrigatório
                      </span>
                      <span className="text-xs text-slate-500">— o seu utilizador DECIDE (login), para creditar na IBKR</span>
                    </div>
                    <p className="mt-2 max-w-xl text-xs leading-relaxed text-teal-100/90">
                      Use <strong className="text-teal-50">exactamente</strong> este texto: é o mesmo utilizador com que entra na DECIDE
                      (definido no registo; por defeito alinhado com o email). Sem este descritivo, o banco pode não associar o
                      depósito à sua conta na corretora.
                    </p>
                    <div
                      className="mt-2 rounded-lg border px-3 py-2.5 font-mono text-sm font-semibold tracking-tight text-teal-50"
                      style={{
                        borderColor: "rgba(45, 212, 191, 0.35)",
                        background: "rgba(15, 118, 110, 0.22)",
                        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.06)",
                      }}
                    >
                      {transferDescritivo || "…"}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="inline-flex shrink-0 items-center justify-center gap-2 self-start rounded-lg px-3.5 py-2.5 text-xs font-bold text-zinc-50 shadow-md ring-2 ring-zinc-500/35 transition hover:brightness-110 sm:mt-8"
                    style={{
                      background: DECIDE_DASHBOARD.buttonRegister,
                      boxShadow: "0 2px 12px rgba(0, 0, 0, 0.4)",
                    }}
                    onClick={() =>
                      void copyToClipboard(transferDescritivo.trim() || resolveFundingTransferDescritivo())
                    }
                  >
                    <CopyIcon className="opacity-95" />
                    Copiar descritivo
                  </button>
                </div>
              </div>
            </div>
            {copyMsg ? <p className="mt-2 text-xs text-zinc-400">{copyMsg}</p> : null}
          </section>

          <details
            className="mb-9 max-w-2xl rounded-xl border px-4 py-3 text-sm"
            style={{
              borderColor: "rgba(255, 255, 255, 0.1)",
              background: "linear-gradient(135deg, rgba(39, 39, 42, 0.5) 0%, rgba(24, 24, 27, 0.92) 100%)",
              color: "#d4d4d8",
            }}
          >
            <summary className="cursor-pointer list-none font-semibold text-slate-200 marker:content-none [&::-webkit-details-marker]:hidden">
              Conta regulada — segurança dos seus activos{" "}
              <span className="text-xs font-normal text-slate-500">(clique para expandir)</span>
            </summary>
            <p className="mt-3 leading-relaxed">
              <strong className="text-slate-100">Conta regulada.</strong> A Interactive Brokers está sujeita à
              supervisão dos reguladores aplicáveis; os seus activos ficam segregados nos termos da corretora.
            </p>
          </details>

          <section className="mb-9">
            <div className="flex flex-wrap items-end justify-between gap-3 border-b border-slate-800/80 pb-3">
              <h2 className="text-lg font-semibold text-slate-100">Passo a passo</h2>
              <button
                type="button"
                className="text-sm font-semibold text-zinc-400 underline-offset-4 hover:text-zinc-300 hover:underline"
                aria-expanded={stepsOpen}
                onClick={() => setStepsOpen((o) => !o)}
              >
                {stepsOpen ? "Ocultar passos detalhados" : "Ver passos detalhados"}
              </button>
            </div>
            {stepsOpen ? (
              <ol className="mt-4 list-decimal space-y-3 pl-5 text-sm leading-relaxed text-slate-300">
                <li>Inicie uma transferência SEPA no seu banco.</li>
                <li>Cole o beneficiário, o IBAN e o descritivo indicados acima.</li>
                <li>Inclua sempre o descritivo (o seu utilizador DECIDE) para o crédito ser aplicado sem atrasos.</li>
                <li>Aguarde a confirmação na IBKR (tipicamente 1–2 dias úteis).</li>
              </ol>
            ) : (
              <p className="mt-3 text-sm text-slate-500">
                Resumo: transfira do seu banco para os dados IBKR acima e inclua o descritivo obrigatório.
              </p>
            )}
          </section>

          <div id="instrucoes-detalhadas" className="mb-11 scroll-mt-24 rounded-xl border border-slate-700/60 bg-slate-900/30 p-4">
            <h3 className="text-sm font-bold text-slate-200">Instruções detalhadas</h3>
            <p className="mt-2 text-sm text-slate-400">
              Os dados exactos (moeda, banco correspondente, referência adicional) podem variar por país. Use as
              páginas oficiais:
            </p>
            <div className="mt-3 flex flex-col gap-2 text-sm font-semibold">
              <a
                href={helpUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-zinc-400 underline-offset-4 hover:text-zinc-300 hover:underline"
              >
                Fundir a conta — Interactive Brokers (nova janela)
              </a>
              <a
                href={IBKR_SEPA_GUIDE_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="text-zinc-400 underline-offset-4 hover:text-zinc-300 hover:underline"
              >
                Guia Bank Transfer / SEPA — IBKR (nova janela)
              </a>
            </div>
          </div>

          {/* Operational timeline */}
          <div className="mb-9 rounded-xl border border-slate-700/50 bg-slate-900/30 px-5 py-5">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-500 mb-4">Após a transferência — o que acontece</p>
            <ol className="relative space-y-0">
              {[
                { title: "A IBKR confirma a receção", desc: "Tipicamente 1–2 dias úteis após a transferência SEPA." },
                { title: "O DECIDE prepara as ordens", desc: "O plano personalizado fica disponível para revisão." },
                { title: "Revê e aprova o rebalanceamento", desc: "Nada é executado sem a sua confirmação explícita." },
                { title: "Execução ocorre na corretora", desc: "As ordens são enviadas ao IB Gateway e executadas a mercado." },
              ].map((step, i, arr) => (
                <li key={i} className="flex gap-4">
                  <div className="flex flex-col items-center">
                    <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-slate-600 bg-slate-800 text-[10px] font-bold text-slate-300">
                      {i + 1}
                    </div>
                    {i < arr.length - 1 && <div className="mt-1 w-px flex-1 bg-slate-700/60" style={{ minHeight: 24 }} />}
                  </div>
                  <div className="pb-5">
                    <p className="text-sm font-medium text-slate-200">{step.title}</p>
                    <p className="mt-0.5 text-xs text-slate-500">{step.desc}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>

          <div className="flex max-w-xl flex-col gap-4">
            {fundingStatus === "awaiting" ? (
              <>
                <button
                  type="button"
                  className="w-full rounded-2xl px-8 py-4 text-base font-bold text-zinc-50 shadow-lg transition hover:brightness-110 sm:w-auto sm:min-w-[300px]"
                  style={{
                    background: DECIDE_DASHBOARD.buttonRegister,
                    boxShadow: "0 6px 28px rgba(0, 0, 0, 0.5)",
                  }}
                  onClick={onTransferred}
                >
                  Confirmar transferência enviada
                </button>
                <details className="max-w-xl rounded-xl border border-slate-700/50 bg-slate-900/30 px-4 py-3">
                  <summary className="cursor-pointer text-sm font-semibold text-slate-400 hover:text-slate-300">
                    Como fazer a transferência
                  </summary>
                  <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm leading-relaxed text-slate-300">
                    <li>Inicie uma transferência SEPA no seu banco (homebanking).</li>
                    <li>Cole o beneficiário <strong className="text-slate-100">Interactive Brokers</strong> e o IBAN acima.</li>
                    <li>No campo descritivo/referência, use <strong className="text-teal-200">exactamente</strong> o seu utilizador DECIDE (obrigatório para creditação).</li>
                    <li>Aguarde a confirmação na IBKR — tipicamente 1–2 dias úteis.</li>
                  </ol>
                </details>
              </>
            ) : null}
            {fundingStatus === "transferred" ? (
              <>
                <p className="text-sm text-slate-400">
                  Quando o saldo aparecer na IBKR, confirme abaixo. Depois pode abrir o plano para executar ordens.
                </p>
                <button
                  type="button"
                  className="w-full rounded-xl px-6 py-3.5 text-sm font-bold text-zinc-50 shadow-lg transition hover:brightness-105 sm:w-auto sm:min-w-[280px]"
                  style={{
                    background: DECIDE_DASHBOARD.buttonRegister,
                    border: DECIDE_DASHBOARD.kpiMenuMainButtonBorder,
                    boxShadow: `${DECIDE_DASHBOARD.kpiMenuMainButtonShadow}, 0 4px 18px rgba(0, 0, 0, 0.35)`,
                  }}
                  onClick={onMarkReceived}
                >
                  Confirmo: fundos já visíveis na IBKR
                </button>
                <button
                  type="button"
                  className="self-start text-sm font-semibold text-zinc-400 underline-offset-4 hover:text-zinc-300 hover:underline"
                  onClick={() => void router.push("/client/report?from=funding")}
                >
                  Ir para o plano
                </button>
              </>
            ) : null}
            {fundingStatus === "received" ? (
              <button
                type="button"
                className="self-start text-sm font-semibold text-zinc-400 underline-offset-4 hover:text-zinc-300 hover:underline"
                onClick={() => void router.push("/client/report")}
              >
                Abrir plano para executar ordens
              </button>
            ) : null}
          </div>

          <p className="mt-8 text-xs leading-relaxed text-slate-500">
            {fundingStatus === "awaiting"
              ? "Ao clicar em «Já fiz a transferência», o fluxo segue para o plano para preparar ordens — o saldo não é verificado em tempo real."
              : fundingStatus === "transferred"
                ? "O estado indica que já iniciou a transferência; confirme quando vir o saldo na IBKR."
                : "Estado de financiamento guardado neste browser."}{" "}
            O estado fica guardado neste browser (
            <code className="text-slate-400">{FUNDING_STATUS_LS_KEY}</code>).
          </p>

          <FundAccountExitNav className="mt-10 border-t border-slate-800 pt-6" />
        </div>
      </main>
    </>
  );
}
