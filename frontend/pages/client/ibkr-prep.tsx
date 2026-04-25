import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import OnboardingFlowBar, {
  ONBOARDING_LOCALSTORAGE_CHANGED_EVENT,
  ONBOARDING_STORAGE_KEYS,
} from "../../components/OnboardingFlowBar";
import { buildPersonaReferenceIdFromSession } from "../../lib/personaReference";
import { extractDisplayNameFromPersonaRecord } from "../../lib/personaDisplayName";
import { isFxHedgeOnboardingApplicable } from "../../lib/clientSegment";
import { isHedgeOnboardingDone } from "../../lib/fxHedgePrefs";
import { personaRecordAllowsIbkrPrep } from "../../lib/personaKycGate";
import { ONBOARDING_STEP_6_LABEL } from "../../lib/onboardingStep6Label";

const STRIPE_ONBOARDING_OK_KEY = "decide_onboarding_stripe_checkout_v1";
const STRIPE_UI_ENABLED = process.env.NEXT_PUBLIC_STRIPE_ONBOARDING === "1";

function safeNumber(x: unknown, fallback = 0): number {
  if (typeof x === "number") return Number.isFinite(x) ? x : fallback;
  const v = Number(x as any);
  return Number.isFinite(v) ? v : fallback;
}

function normalizeCcy(ccy: string): string {
  const u = (ccy || "USD").toUpperCase();
  if (u === "BASE") return "EUR";
  return u;
}

function formatMoney(v: number, ccy: string): string {
  const c = normalizeCcy(ccy);
  try {
    return new Intl.NumberFormat("pt-PT", { style: "currency", currency: c, maximumFractionDigits: 2 }).format(v);
  } catch {
    return `${v.toFixed(2)} ${c}`;
  }
}

function formatPtDateTime(iso: string | null): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "—";
    return new Intl.DateTimeFormat("pt-PT", {
      dateStyle: "short",
      timeStyle: "short",
    }).format(d);
  } catch {
    return "—";
  }
}

/** Tipo de conta a partir do código IB (ex.: DU… = paper). */
function accountTypeLabelFromCode(accountCode: string): string {
  const a = accountCode.trim().toUpperCase();
  if (a.startsWith("DU")) return "Conta de demonstração (paper)";
  if (a.length > 0) return "Conta ligada";
  return "Indisponível";
}

const IBKR_PREP_DONE_KEY = "decide_onboarding_ibkr_prep_done_v1";

type IbkrLiveState = {
  loading: boolean;
  error: string;
  ok: boolean;
  nav: number;
  navCcy: string;
  cash: number;
  cashCcy: string;
  accountCode: string;
  updatedAt: string | null;
};

const initialLive: IbkrLiveState = {
  loading: true,
  error: "",
  ok: false,
  nav: 0,
  navCcy: "EUR",
  cash: 0,
  cashCcy: "EUR",
  accountCode: "",
  updatedAt: null,
};

/** Atualizar leitura IBKR — estilo técnico / secundário (sem competir com o CTA principal). */
function ibkrRefreshButtonStyle(loading: boolean): React.CSSProperties {
  return {
    display: "inline-block",
    marginTop: 10,
    padding: "6px 12px",
    fontSize: 11,
    lineHeight: 1.35,
    fontWeight: 600,
    fontFamily: "inherit",
    color: "#a1a1aa",
    background: "rgba(24, 24, 27, 0.75)",
    border: "1px solid rgba(63, 63, 70, 0.85)",
    borderRadius: 8,
    cursor: loading ? "wait" : "pointer",
    opacity: loading ? 0.7 : 1,
    boxSizing: "border-box",
    WebkitAppearance: "none",
  };
}

export default function IbkrPrepPage() {
  const [mifidDone, setMifidDone] = useState(false);
  const [kycDone, setKycDone] = useState(false);
  /** Passos posteriores no funil implicam MiFID percorrido — alinha com `OnboardingFlowBar` quando `step2` falha no LS. */
  const [approveDone, setApproveDone] = useState(false);
  /** null = a verificar no backend; true se existir registo Persona com estado suficiente (ver `personaRecordAllowsIbkrPrep`). */
  const [serverKycOk, setServerKycOk] = useState<boolean | null>(null);
  /** Nome no registo de identidade (servidor DECIDE), quando existir. */
  const [personaNameOnRecord, setPersonaNameOnRecord] = useState<string | null>(null);
  const [ibkrPrepDone, setIbkrPrepDone] = useState(false);
  /** Hedge (0/50/100%) antes de «Plano e pagamento» — segmentos elegíveis. */
  const [hedgeGateOk, setHedgeGateOk] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [ibkrLive, setIbkrLive] = useState<IbkrLiveState>(initialLive);
  const [stripeRedirecting, setStripeRedirecting] = useState(false);
  const [stripeFeedback, setStripeFeedback] = useState<null | "success" | "cancel" | "fail">(null);
  const [stripeCheckoutDoneLs, setStripeCheckoutDoneLs] = useState(false);
  const router = useRouter();
  const stripeReturnInFlight = useRef(false);

  const refreshOnboardingFlagsFromLs = useCallback(() => {
    try {
      setIbkrPrepDone(window.localStorage.getItem(IBKR_PREP_DONE_KEY) === "1");
    } catch {
      setIbkrPrepDone(false);
    }
    try {
      setStripeCheckoutDoneLs(window.localStorage.getItem(STRIPE_ONBOARDING_OK_KEY) === "1");
    } catch {
      setStripeCheckoutDoneLs(false);
    }
    try {
      setHedgeGateOk(!isFxHedgeOnboardingApplicable() || isHedgeOnboardingDone());
    } catch {
      setHedgeGateOk(false);
    }
    try {
      setMifidDone(window.localStorage.getItem(ONBOARDING_STORAGE_KEYS.mifid) === "1");
      setKycDone(window.localStorage.getItem(ONBOARDING_STORAGE_KEYS.kyc) === "1");
      setApproveDone(window.localStorage.getItem(ONBOARDING_STORAGE_KEYS.approve) === "1");
    } catch {
      setMifidDone(false);
      setKycDone(false);
      setApproveDone(false);
    }
  }, []);

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
        account_code?: string;
        cash_ledger?: { value?: number; currency?: string };
      } = {};
      try {
        data = raw ? (JSON.parse(raw) as typeof data) : {};
      } catch {
        throw new Error("Resposta inválida do servidor.");
      }
      if (!res.ok || data.status !== "ok") {
        const msg =
          (typeof data.error === "string" && data.error) ||
          `Falha ao ler a conta IBKR (${res.status}). Confirme TWS ligado, conta paper, e o backend (uvicorn) acessível.`;
        setIbkrLive({
          loading: false,
          error: msg,
          ok: false,
          nav: 0,
          navCcy: "EUR",
          cash: 0,
          cashCcy: "EUR",
          accountCode: "",
          updatedAt: null,
        });
        return;
      }
      const nav = safeNumber(data.net_liquidation, 0);
      const navCcy = typeof data.net_liquidation_ccy === "string" ? data.net_liquidation_ccy : "USD";
      const cl = data.cash_ledger;
      const cash = safeNumber(cl?.value, 0);
      const cashCcy = typeof cl?.currency === "string" ? cl.currency : navCcy;
      const accountCode = typeof data.account_code === "string" ? data.account_code : "";
      setIbkrLive({
        loading: false,
        error: "",
        ok: true,
        nav,
        navCcy,
        cash,
        cashCcy,
        accountCode,
        updatedAt: new Date().toISOString(),
      });
    } catch (e) {
      setIbkrLive({
        loading: false,
        error: e instanceof Error ? e.message : "Erro ao contactar o servidor.",
        ok: false,
        nav: 0,
        navCcy: "EUR",
        cash: 0,
        cashCcy: "EUR",
        accountCode: "",
        updatedAt: null,
      });
    }
  }, []);

  const startStripeCheckout = useCallback(async () => {
    if (stripeRedirecting) return;
    setStripeRedirecting(true);
    setStripeFeedback(null);
    try {
      const r = await fetch("/api/stripe/create-checkout-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
        credentials: "same-origin",
      });
      const j = (await r.json().catch(() => ({}))) as { ok?: boolean; url?: string };
      if (j?.ok && j?.url) {
        window.location.href = j.url;
        return;
      }
      setStripeFeedback("fail");
    } catch {
      setStripeFeedback("fail");
    } finally {
      setStripeRedirecting(false);
    }
  }, [stripeRedirecting]);

  useLayoutEffect(() => {
    refreshOnboardingFlagsFromLs();
  }, [refreshOnboardingFlagsFromLs]);

  useEffect(() => {
    const bump = () => refreshOnboardingFlagsFromLs();
    window.addEventListener("storage", bump);
    window.addEventListener(ONBOARDING_LOCALSTORAGE_CHANGED_EVENT, bump);
    return () => {
      window.removeEventListener("storage", bump);
      window.removeEventListener(ONBOARDING_LOCALSTORAGE_CHANGED_EVENT, bump);
    };
  }, [refreshOnboardingFlagsFromLs]);

  useEffect(() => {
    void refreshIbkrSnapshot();
  }, [refreshIbkrSnapshot]);

  /** Redirect Stripe Checkout: confirmar sessão e limpar query. */
  useEffect(() => {
    if (!router.isReady) return;
    if (stripeReturnInFlight.current) return;
    const ch = router.query.checkout;
    if (ch === "cancelled") {
      stripeReturnInFlight.current = true;
      setStripeFeedback("cancel");
      void router.replace({ pathname: "/client/ibkr-prep" }, undefined, { shallow: true });
      return;
    }
    if (ch !== "success" || typeof router.query.session_id !== "string" || !router.query.session_id) {
      return;
    }
    stripeReturnInFlight.current = true;
    const sid = router.query.session_id;
    let dead = false;
    (async () => {
      try {
        const r = await fetch(`/api/stripe/verify-checkout-session?session_id=${encodeURIComponent(sid)}`);
        const j = (await r.json().catch(() => ({}))) as { ok?: boolean; complete?: boolean };
        if (dead) return;
        if (j?.ok && j?.complete) {
          try {
            window.localStorage.setItem(STRIPE_ONBOARDING_OK_KEY, "1");
            window.dispatchEvent(new Event(ONBOARDING_LOCALSTORAGE_CHANGED_EVENT));
            setStripeCheckoutDoneLs(true);
          } catch {
            // ignore
          }
          setStripeFeedback("success");
        } else {
          setStripeFeedback("fail");
        }
      } catch {
        if (!dead) setStripeFeedback("fail");
      }
      void router.replace({ pathname: "/client/ibkr-prep" }, undefined, { shallow: true });
    })();
    return () => {
      dead = true;
    };
  }, [router.isReady, router.query, router]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let k = false;
      try {
        k = window.localStorage.getItem(ONBOARDING_STORAGE_KEYS.kyc) === "1";
      } catch {
        k = false;
      }
      if (cancelled) return;
      setKycDone(k);

      if (!k) {
        setServerKycOk(false);
        setPersonaNameOnRecord(null);
        return;
      }

      const ref = buildPersonaReferenceIdFromSession();
      if (!ref) {
        // Sem referência não conseguimos validar no servidor; não apagar o passo «Identidade» no LS
        // (o stepper deixa de mostrar ✓ e o utilizador fica bloqueado sem motivo claro).
        setServerKycOk(false);
        setPersonaNameOnRecord(null);
        return;
      }

      try {
        const r = await fetch(`/api/persona/status?reference_id=${encodeURIComponent(ref)}`);
        const j = await r.json().catch(() => ({}));
        if (cancelled) return;
        const rec = j?.record;
        const verified = Boolean(j?.ok && rec && personaRecordAllowsIbkrPrep(rec));
        /** `name` na BD pode estar vazio mesmo com Persona concluído — o nome vem muitas vezes só em `fields`. */
        const nm = extractDisplayNameFromPersonaRecord(rec);
        setPersonaNameOnRecord(verified && nm ? nm : verified ? "" : null);
        if (verified) {
          // Garantir LS alinhado com o servidor (e stepper com ✓) sem voltar ao passo Identidade.
          try {
            window.localStorage.setItem(ONBOARDING_STORAGE_KEYS.kyc, "1");
            /** Funil linear: identidade confirmada implica MiFID percorrido — repara `step2` em falta no LS. */
            if (window.localStorage.getItem(ONBOARDING_STORAGE_KEYS.mifid) !== "1") {
              window.localStorage.setItem(ONBOARDING_STORAGE_KEYS.mifid, "1");
            }
            window.dispatchEvent(new Event(ONBOARDING_LOCALSTORAGE_CHANGED_EVENT));
            setKycDone(true);
            setMifidDone(true);
          } catch {
            // ignore
          }
        }
        setServerKycOk(verified);
      } catch {
        if (cancelled) return;
        // Erro de rede/API: não limpar KYC no cliente; `canPrepare` fica false até o servidor responder.
        setServerKycOk(false);
        setPersonaNameOnRecord(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const mifidSatisfied = mifidDone || kycDone || approveDone;

  const canPrepare = mifidSatisfied && kycDone && serverKycOk === true && hedgeGateOk;
  /** Só mostramos o atalho para aprovação depois de «Preparar» (evita saltar o passo). */
  const canGoToApprove = canPrepare && ibkrPrepDone;

  const stepStateLabel = useMemo(() => {
    if (!canPrepare) {
      if (kycDone && serverKycOk !== true) {
        return serverKycOk === null
          ? "A validar identidade no sistema…"
          : "Pendente — identidade ainda não confirmada no servidor";
      }
      if (kycDone && serverKycOk === true && !hedgeGateOk) {
        return "Pendente — falta escolher o hedge cambial (0%, 50% ou 100%)";
      }
      if (!kycDone) return "Pendente — falta concluir a identidade";
      if (!mifidSatisfied) return "Pendente — falta confirmar o perfil de investidor";
      return "Pendente — verifique perfil e identidade";
    }
    if (preparing) return "A preparar…";
    if (ibkrPrepDone) return "Preparado neste dispositivo";
    return "Pronto para preparar";
  }, [canPrepare, preparing, ibkrPrepDone, kycDone, serverKycOk, mifidSatisfied, hedgeGateOk]);

  /** Aviso accionável: o que falta, onde ir, botão directo (nunca só texto técnico). */
  const prepareBlocker = useMemo((): {
    title: string;
    body: string;
    ctaHref: string | null;
    ctaLabel: string | null;
  } | null => {
    if (canPrepare) return null;
    if (!mifidSatisfied) {
      return {
        title: "Falta confirmar o perfil de investidor",
        body: "Precisa de confirmar o questionário no passo «Perfil de investidor» para continuar (último passo do questionário, antes da identidade).",
        ctaHref: "/mifid-test",
        ctaLabel: "Ir para Perfil de Investidor",
      };
    }
    if (!kycDone) {
      return {
        title: "Falta concluir a verificação de identidade",
        body: "Conclua o passo «Identidade» e guarde a confirmação no sistema para desbloquear a preparação da conta.",
        ctaHref: "/persona-onboarding",
        ctaLabel: "Ir para Identidade",
      };
    }
    if (serverKycOk === null) {
      return {
        title: "A validar a identidade no sistema",
        body: "Aguarde um momento enquanto confirmamos o registo de identidade.",
        ctaHref: null,
        ctaLabel: null,
      };
    }
    if (serverKycOk !== true) {
      return {
        title: "Identidade ainda não confirmada no sistema",
        body: "Volte ao passo «Identidade», conclua a verificação e assegure que a confirmação fica guardada no servidor.",
        ctaHref: "/persona-onboarding",
        ctaLabel: "Ir para Identidade",
      };
    }
    if (!hedgeGateOk) {
      return {
        title: "Falta o passo «Hedge cambial»",
        body: "Indique 0%, 50% ou 100% para a simulação de cobertura nos indicadores do dashboard (não envia ordens à IBKR). Este passo vem antes do passo de plano e pagamento (conta e subscrição).",
        ctaHref: "/client/fx-hedge-onboarding",
        ctaLabel: "Ir para Hedge cambial",
      };
    }
    return {
      title: "Não é possível preparar ainda",
      body: "Verifique os passos anteriores do onboarding. Se o problema persistir, volte ao painel e reabra esta página.",
      ctaHref: "/client-dashboard",
      ctaLabel: "Ir para o painel",
    };
  }, [canPrepare, mifidSatisfied, kycDone, serverKycOk, hedgeGateOk]);

  function handlePrepareIbkr() {
    if (!canPrepare || preparing) return;
    setPreparing(true);
    try {
      window.localStorage.setItem(IBKR_PREP_DONE_KEY, "1");
      window.localStorage.setItem(ONBOARDING_STORAGE_KEYS.approve, "0");
    } catch {
      // ignore
    }
    window.location.href = "/client/approve";
  }

  const connectionLabel = ibkrLive.loading
    ? "A ligar…"
    : ibkrLive.ok
      ? "Conta ligada (leitura via TWS)"
      : ibkrLive.error
        ? "Sem leitura neste momento"
        : "—";

  return (
    <>
      <Head>
        <title>DECIDE — {ONBOARDING_STEP_6_LABEL}</title>
      </Head>
      <main className="min-h-screen bg-zinc-950 text-zinc-50">
        <div className="mx-auto max-w-5xl px-6 py-8">
          <OnboardingFlowBar currentStepId="approve" authStepHref="/client/login" compact />

          {stripeFeedback === "success" ? (
            <div className="mb-4 rounded-xl border border-emerald-500/40 bg-emerald-950/35 px-4 py-3 text-sm text-emerald-100" role="status">
              Pagamento concluído. O registo do Checkout Stripe foi validado; pode continuar a preparar a conta IBKR e
              aprovar o plano.
            </div>
          ) : null}
          {stripeFeedback === "cancel" ? (
            <div className="mb-4 rounded-xl border border-zinc-600/50 bg-zinc-900/50 px-4 py-3 text-sm text-zinc-300" role="status">
              Pagamento anulado — nada foi cobrado. Pode voltar a tentar quando quiser, na secção abaixo.
            </div>
          ) : null}
          {stripeFeedback === "fail" ? (
            <div className="mb-4 rounded-xl border border-amber-500/35 bg-amber-950/30 px-4 py-3 text-sm text-amber-100" role="alert">
              Não foi possível concluir o pagamento com Stripe. Confirme as chaves e o Price no servidor (variáveis de
              ambiente) ou tente outra vez.
            </div>
          ) : null}

          {/* 1 — Estado / bloqueio: primeira coisa visível após o stepper */}
          {!canPrepare && prepareBlocker ? (
            <section className="mb-5 rounded-xl border border-amber-500/35 bg-amber-950/30 p-4 shadow-md ring-1 ring-amber-900/30 sm:p-5">
              <div className="flex flex-wrap items-start gap-2">
                <span className="text-lg leading-none" aria-hidden>
                  ⚠️
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-base font-bold tracking-tight text-amber-50">{prepareBlocker.title}</div>
                  <p className="mt-2 max-w-2xl text-sm leading-relaxed text-amber-100/90">{prepareBlocker.body}</p>
                  {prepareBlocker.ctaHref && prepareBlocker.ctaLabel ? (
                    <Link
                      href={prepareBlocker.ctaHref}
                      className="mt-4 inline-flex min-h-[44px] items-center justify-center rounded-xl border-2 border-amber-400/60 bg-amber-950/60 px-5 text-sm font-bold text-white shadow-sm transition hover:border-amber-300/70 hover:bg-amber-900/50"
                    >
                      {prepareBlocker.ctaLabel}
                    </Link>
                  ) : null}
                </div>
              </div>
            </section>
          ) : (
            <section className="mb-5 rounded-xl border border-zinc-600/40 bg-zinc-900/40 px-4 py-4 shadow-sm ring-1 ring-white/5 sm:px-5">
              <p className="text-base font-bold tracking-tight text-zinc-100">Tudo pronto para continuar</p>
              <p className="mt-1.5 text-sm font-medium leading-snug text-zinc-400">
                Pode avançar para preparar a conta — o passo seguinte é um clique.
              </p>
              <p className="mt-2 text-[11px] text-zinc-500">
                Estado: <span className="text-zinc-400">{stepStateLabel}</span>
              </p>
            </section>
          )}

          {/* Título compacto — decisão, não manual */}
          <header className="mb-5 border-b border-zinc-800 pb-5">
            <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{ONBOARDING_STEP_6_LABEL}</p>
            <h1 className="mt-1 text-xl font-semibold tracking-tight text-white sm:text-2xl">
              Preparar a sua conta e subscrição
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-zinc-400">
              Interactive Brokers — organizamos a conta; no fim deste passo pode activar a subscrição (comissões) via
              Stripe. A seguir, <strong className="text-zinc-300">rever e aprovar</strong> o plano. Nada é executado sem
              a sua decisão. O depósito de investimento continua a ser feito perante a IBKR, à parte deste pagamento
              à DECIDE.
            </p>
          </header>

          {/* 2 — Próximos passos: uma única secção de ação */}
          <section className="mb-6 rounded-xl border border-zinc-800/90 bg-zinc-950/50 p-5 sm:p-6">
            <h2 className="text-base font-semibold text-zinc-100">Próximos passos</h2>
            <ul className="mt-3 list-inside list-disc space-y-1.5 text-sm leading-relaxed text-zinc-400">
              <li>Ligamos a leitura da sua conta IBKR (paper) ao DECIDE</li>
              <li>Geramos um plano ajustado ao seu perfil MiFID</li>
              <li>Pode rever e aprovar o plano — o investimento só avança com a sua decisão</li>
            </ul>

            <div className="mt-6 border-t border-zinc-800/80 pt-5">
              {canPrepare && !preparing ? (
                <p className="mb-4 text-center text-sm font-semibold text-zinc-200">
                  Avançar agora desbloqueia a preparação e o plano personalizado.
                </p>
              ) : !canPrepare ? (
                <p className="mb-4 text-center text-sm text-zinc-500">
                  A ação principal está no aviso <strong className="text-zinc-400">acima</strong> até concluir perfil e identidade.
                </p>
              ) : null}

              <div className="flex flex-col items-center gap-3 sm:flex-row sm:flex-wrap sm:justify-center">
                {canPrepare ? (
                  <button
                    type="button"
                    onClick={handlePrepareIbkr}
                    disabled={preparing}
                    className={`rounded-full px-6 py-2.5 text-sm font-bold transition ${
                      !preparing
                        ? "border border-teal-400/35 bg-teal-700 text-white shadow-md shadow-teal-900/30 hover:bg-teal-600"
                        : "cursor-wait border border-teal-500/20 bg-teal-900/90 text-teal-50"
                    }`}
                  >
                    {preparing ? "A redirecionar…" : "Avançar para preparar conta"}
                  </button>
                ) : null}

                {canPrepare ? (
                  <Link
                    href="/client/report"
                    className="rounded-full border border-white/20 px-4 py-2 text-sm font-medium text-zinc-200 transition hover:border-white/35 hover:text-white"
                  >
                    Ver exemplo de plano
                  </Link>
                ) : (
                  <span className="text-center text-xs text-zinc-600">
                    O exemplo de plano fica disponível quando puder preparar a conta.
                  </span>
                )}

                {canGoToApprove ? (
                  <Link
                    href="/client/approve"
                    className="rounded-full border border-teal-500/45 bg-teal-950/35 px-5 py-2.5 text-sm font-semibold text-teal-100 transition hover:border-teal-400/70 hover:bg-teal-900/45"
                  >
                    Ir para aprovar o plano
                  </Link>
                ) : null}
              </div>

              {!canPrepare ? (
                <p className="mt-4 text-center text-xs text-zinc-600">
                  O botão «Avançar para preparar conta» aparece aqui quando o passo estiver desbloqueado.
                </p>
              ) : !ibkrPrepDone ? (
                <p className="mt-4 text-center text-xs text-zinc-600">Depois de avançar, poderá rever e aprovar o plano.</p>
              ) : null}
            </div>
          </section>

          {/* 3 — Dados IBKR (detalhe técnico; contraste baixo) */}
          <section className="mb-6 rounded-xl border border-zinc-800/50 bg-zinc-950/50 p-4 sm:p-5">
            <h2 className="text-[11px] font-semibold uppercase tracking-wide text-zinc-600">Dados da conta (IBKR)</h2>
            <p className="mt-1 max-w-2xl text-[11px] leading-relaxed text-zinc-600">
              Leitura em tempo real na conta paper via TWS — servidor DECIDE. TWS ligado; backend (
              <code className="rounded bg-zinc-800 px-1 text-[11px]">uvicorn</code>) acessível.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1">
              <button
                type="button"
                data-testid="ibkr-refresh-values"
                aria-label="Atualizar leitura dos valores via TWS na Interactive Brokers"
                onClick={() => void refreshIbkrSnapshot()}
                disabled={ibkrLive.loading}
                style={ibkrRefreshButtonStyle(ibkrLive.loading)}
              >
                {ibkrLive.loading ? "A atualizar…" : "Atualizar leitura (TWS)"}
              </button>
              <span className="max-w-md text-xs font-medium leading-relaxed text-zinc-500">
                Atualiza património e caixa reportados pelo TWS.
              </span>
            </div>
            {ibkrLive.error ? (
              <p className="mt-3 rounded-lg border border-amber-800/60 bg-amber-950/30 px-3 py-2 text-xs text-amber-100/90">
                {ibkrLive.error}
              </p>
            ) : null}
            <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
              <div className="rounded-lg border border-zinc-800/60 bg-zinc-950/40 px-3 py-2.5">
                <dt className="text-[11px] text-zinc-600">Estado da ligação</dt>
                <dd className="mt-0.5 text-sm font-medium text-zinc-300">{connectionLabel}</dd>
              </div>
              <div className="rounded-lg border border-zinc-800/60 bg-zinc-950/40 px-3 py-2.5">
                <dt className="text-[11px] text-zinc-600">Tipo de conta</dt>
                <dd className="mt-0.5 text-sm font-medium text-zinc-300">{accountTypeLabelFromCode(ibkrLive.accountCode)}</dd>
              </div>
              <div className="rounded-lg border border-zinc-800/60 bg-zinc-950/40 px-3 py-2.5">
                <dt className="text-[11px] text-zinc-600">Património líquido (NetLiquidation)</dt>
                <dd className="mt-0.5 text-[15px] font-medium leading-tight tracking-tight text-zinc-300 sm:text-base">
                  {ibkrLive.loading ? (
                    <span className="text-zinc-600">…</span>
                  ) : ibkrLive.ok ? (
                    formatMoney(ibkrLive.nav, ibkrLive.navCcy)
                  ) : (
                    "—"
                  )}
                </dd>
              </div>
              <div className="rounded-lg border border-zinc-800/60 bg-zinc-950/40 px-3 py-2.5">
                <dt className="text-[11px] text-zinc-600">Dinheiro disponível</dt>
                <dd className="mt-0.5 text-[15px] font-medium leading-tight tracking-tight text-zinc-300 sm:text-base">
                  {ibkrLive.loading ? (
                    <span className="text-zinc-600">…</span>
                  ) : ibkrLive.ok ? (
                    formatMoney(ibkrLive.cash, ibkrLive.cashCcy)
                  ) : (
                    "—"
                  )}
                </dd>
              </div>
              <div className="rounded-lg border border-zinc-800/60 bg-zinc-950/40 px-3 py-2.5 sm:col-span-2">
                <dt className="text-[11px] text-zinc-600">Conta · última leitura</dt>
                <dd className="mt-0.5 text-sm text-zinc-400">
                  {ibkrLive.accountCode ? <span className="font-mono">{ibkrLive.accountCode}</span> : <span>—</span>}
                  <span className="text-zinc-500"> · </span>
                  <span className="text-zinc-400">{formatPtDateTime(ibkrLive.updatedAt)}</span>
                </dd>
              </div>
            </dl>
          </section>

          {/* Identidade — resumo curto, após dados técnicos */}
          {serverKycOk === true ? (
            <section
              className="mb-8 rounded-xl border border-zinc-700/60 bg-zinc-950/50 p-4 sm:p-5"
            >
              <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Identidade no sistema</h2>
              {(personaNameOnRecord ?? "").trim().length > 0 ? (
                <p className="mt-2 text-sm text-zinc-300">
                  Nome no registo:{" "}
                  <strong className="font-medium text-zinc-100">{(personaNameOnRecord ?? "").trim()}</strong>
                </p>
              ) : (
                <p className="mt-2 text-sm text-zinc-400">Nome não disponível neste momento.</p>
              )}
              {personaNameOnRecord === "" && (
                <p className="mt-2 text-xs leading-relaxed text-zinc-500">
                  Identidade confirmada; o nome pode não aparecer aqui. Para rever, use o passo «Identidade».
                </p>
              )}
            </section>
          ) : null}

          {STRIPE_UI_ENABLED ? (
            <section className="mb-8 rounded-xl border border-violet-500/25 bg-zinc-900/50 p-5 sm:p-6" aria-labelledby="ibkr-prep-stripe-h2">
              <h2 id="ibkr-prep-stripe-h2" className="text-base font-semibold text-zinc-100">
                Pagamento da subscrição (Stripe)
              </h2>
              <p className="mt-2 max-w-2xl text-sm leading-relaxed text-zinc-400">
                No fim do registo, active o pagamento seguro de comissões (subscrição Premium) com cartão. Isto é
                independente do <strong className="text-zinc-300">depósito de investimento</strong> na Interactive
                Brokers — o dinheiro alocado ao plano continua a ser transferido para a corretora como já documentámos.
              </p>
              {stripeCheckoutDoneLs ? (
                <p className="mt-3 text-sm font-medium text-emerald-400" role="status">
                  Último checkout Stripe validado neste dispositivo.
                </p>
              ) : null}
              <div className="mt-5 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => void startStripeCheckout()}
                  disabled={stripeRedirecting}
                  className={
                    !stripeRedirecting
                      ? "min-h-[44px] rounded-full border border-violet-400/45 bg-violet-800/50 px-6 text-sm font-bold text-violet-50 shadow-md shadow-violet-950/30 transition hover:bg-violet-700/50"
                      : "min-h-[44px] cursor-wait rounded-full border border-violet-500/20 bg-violet-900/30 px-6 text-sm font-bold text-violet-200/80"
                  }
                >
                  {stripeRedirecting ? "A abrir o Stripe…" : "Pagar com cartão (Stripe)"}
                </button>
              </div>
            </section>
          ) : null}
        </div>
      </main>
    </>
  );
}
