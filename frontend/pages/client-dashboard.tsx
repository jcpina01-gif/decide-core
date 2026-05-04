import Head from "next/head";
import ClientPendingTextLink from "../components/ClientPendingTextLink";
import { useRouter } from "next/router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CLIENT_SESSION_CHANGED_EVENT,
  fetchProspectEmailVerifiedFromServer,
  getCurrentSessionUser,
  getCurrentSessionUserEmail,
  getCurrentSessionUserPhone,
  isClientLoggedIn,
  isSessionEmailVerified,
  normalizeClientPhone,
  requestEmailVerificationProspectSend,
  requestEmailVerificationSend,
  updateClientContact,
} from "../lib/clientAuth";
import {
  acknowledgeMonthlyReview,
  describeScheduleForUi,
  formatPtDate,
  getNotifyPhone,
  getPortfolioSchedule,
  setOnboardingSnapshotNow,
  toLocalYmd,
} from "../lib/clientPortfolioSchedule";
import { collapseHistMonthsToLatestPerCalendarMonth } from "../lib/recommendationsHistoryMonthCollapse";
import {
  DECIDE_NEXT_DEV_PORT,
  devConfirmationLinkUsesLoopback,
  devConfirmationLinkWrongPort,
} from "../lib/emailConfirmationDevLink";
import { DECIDE_APP_PAGE_BG, DECIDE_DASHBOARD } from "../lib/decideClientTheme";
import CarteiraIbkrSummary from "../components/CarteiraIbkrSummary";
import InlineLoadingDots from "../components/InlineLoadingDots";
import ClientKpiEmbedWorkspace from "../components/ClientKpiEmbedWorkspace";
import ClientKpiPageChrome from "../components/ClientKpiPageChrome";
import { DECIDE_DASHBOARD_KPI_REFRESH_EVENT } from "../lib/decideDashboardEvents";
import { ONBOARDING_LOCALSTORAGE_CHANGED_EVENT } from "../components/OnboardingFlowBar";
import { useClientKpiEmbed } from "../hooks/useClientKpiEmbed";
import { FLASK_KPI_EMBED_TABS, normalizeKpiEmbedTabId } from "../lib/kpiEmbedNav";
import { useSyncedRiskProfileFromOnboarding } from "../hooks/useSyncedRiskProfileFromOnboarding";
import {
  consumeSkipHedgeGateFromUrl,
  isFxHedgeGateOk,
  shouldSkipHedgeGateRedirect,
} from "../lib/fxHedgePrefs";
type SeriesPoint = {
  dates?: string[];
  equity_raw?: number[];
  equity_overlayed?: number[];
  equity_raw_volmatched?: number[];
  benchmark_equity?: number[];
};

type CoreOverlayedResp = {
  ok?: boolean;
  detail?: any;
  series?: SeriesPoint;
};

/** Alinhado a `ONBOARDING_STORAGE_KEYS.approve` — plano regulamentar aprovado no `/client/approve`. */
const CLIENT_PLAN_APPROVED_LS_KEY = "decide_onboarding_step4_done";

/** CTA secção recomendações / plano — verde acinzentado (tema principal) */
const PLAN_CTA_ORANGE: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: "100%",
  boxSizing: "border-box",
  padding: "9px 14px",
  borderRadius: 11,
  border: DECIDE_DASHBOARD.kpiMenuMainButtonBorder,
  background: DECIDE_DASHBOARD.kpiMenuMainButtonBackground,
  color: DECIDE_DASHBOARD.kpiMenuMainButtonColor,
  fontSize: 12,
  fontWeight: 900,
  textDecoration: "none",
  textAlign: "center",
  boxShadow: DECIDE_DASHBOARD.kpiMenuMainButtonShadow,
};

function getOverlayFactor(resp: CoreOverlayedResp | null) {
  const d = (resp && resp.detail) || {};
  const candidates = [
    d && d.ddcap && d.ddcap.cap_scale_factor_last,
    d && d.ddcap && d.ddcap.cap_scale_factor,
    d && d.ddcap && d.ddcap.factor_last,
    d && d.ddcap && d.ddcap.factor,
    d && d.cap_scale_factor_last,
    d && d.cap_scale_factor,
    d && d.overlay_factor_last,
    d && d.overlay_factor,
  ];
  for (const c of candidates) {
    if (typeof c === "number" && isFinite(c)) return c;
  }
  return null;
}

export default function ClientDashboardPage() {
  const router = useRouter();
  const modelVersion =
    typeof router.query.model_version === "string" &&
    (router.query.model_version === "v7_dynamic_light" ||
      router.query.model_version === "v7_dynamic_medium")
      ? (router.query.model_version as "v7_dynamic_light" | "v7_dynamic_medium")
      : "official_v6";
  const [planPageNavPending, setPlanPageNavPending] = useState(false);
  const setModelVersion = useCallback(
    (next: "official_v6" | "v7_dynamic_light" | "v7_dynamic_medium") => {
      const q = { ...router.query } as Record<string, string>;
      if (next === "official_v6") {
        delete q.model_version;
      } else {
        q.model_version = next;
      }
      void router.replace({ pathname: router.pathname, query: q }, undefined, { shallow: true });
      try {
        window.dispatchEvent(new Event(DECIDE_DASHBOARD_KPI_REFRESH_EVENT));
      } catch {
        /* ignore */
      }
      setIframeRefresh(Date.now());
    },
    [router],
  );
  const goToApprovePlan = useCallback(() => {
    setPlanPageNavPending(true);
    void router.push("/client/approve").catch(() => {
      setPlanPageNavPending(false);
    });
  }, [router]);

  useEffect(() => {
    const onNavError = () => setPlanPageNavPending(false);
    router.events?.on("routeChangeError", onNavError);
    return () => router.events?.off("routeChangeError", onNavError);
  }, [router]);
  const { profile, setProfile } = useSyncedRiskProfileFromOnboarding();
  const [loading, setLoading] = useState(false);
  const [errMsg, setErrMsg] = useState<string>("");
  const [resp, setResp] = useState<CoreOverlayedResp | null>(null);
  const [iframeRefresh, setIframeRefresh] = useState(0);
  const [kpiToolbarRefreshBusy, setKpiToolbarRefreshBusy] = useState(false);
  const kpiRefreshSafetyRef = useRef<number | undefined>(undefined);
  /** Força releitura do calendário de carteira após gravar no localStorage */
  const [portfolioScheduleRev, setPortfolioScheduleRev] = useState(0);
  const [notifyPhoneInput, setNotifyPhoneInput] = useState("");
  /** Feedback ao gravar telemóvel (onBlur falha em muitos browsers móveis). */
  const [notifyPhoneSaveFeedback, setNotifyPhoneSaveFeedback] = useState("");
  /** Erro ou aviso do envio automático (antes do rebalance); o botão grande não dispara envio. */
  const [preadviceMsg, setPreadviceMsg] = useState("");
  const [verifyResendBusy, setVerifyResendBusy] = useState(false);
  const [verifyBannerNote, setVerifyBannerNote] = useState("");
  const [prospectEmail, setProspectEmail] = useState("");
  const [prospectBusy, setProspectBusy] = useState(false);
  const [prospectErr, setProspectErr] = useState("");
  const [prospectDevLink, setProspectDevLink] = useState<string | null>(null);
  const [prospectListVerified, setProspectListVerified] = useState(false);
  const [prospectListStatusLoading, setProspectListStatusLoading] = useState(false);
  /** Email (normalizado) para o qual o último envio teve sucesso — mostra «link enviado» até confirmar ou mudar o email. */
  const [prospectListLinkSentEmail, setProspectListLinkSentEmail] = useState<string | null>(null);
  const prospectSendInFlight = useRef(false);
  /** Último mês do histórico de pesos (modelo) — T-Bills vs ações na “carteira actual” recomendada. */
  const [latestModelMonth, setLatestModelMonth] = useState<{
    date: string;
    tbillsTotalPct?: number;
    equitySleeveTotalPct?: number;
  } | null>(null);

  // Importante para evitar "hydration mismatch": no server sem window.
  const [mounted, setMounted] = useState(false);
  const [sessionUser, setSessionUser] = useState<string | null>(null);
  const [loggedIn, setLoggedIn] = useState(false);

  const {
    kpiEmbedTab,
    applyKpiEmbedTab,
    kpiViewMode,
    setKpiViewMode,
    kpiIframeSrc,
    kpiIframeRef,
  } = useClientKpiEmbed({ profile, loggedIn, iframeRefresh });

  const syncClientSession = useCallback(() => {
    try {
      if (typeof window === "undefined") return;
      setSessionUser(getCurrentSessionUser());
      setLoggedIn(isClientLoggedIn());
    } catch {
      setSessionUser(null);
      setLoggedIn(false);
    }
  }, []);

  useEffect(() => {
    setMounted(true);
    syncClientSession();
  }, [syncClientSession]);

  useEffect(() => {
    consumeSkipHedgeGateFromUrl();
  }, []);

  useEffect(() => {
    if (!mounted || !loggedIn || isFxHedgeGateOk()) return;
    if (shouldSkipHedgeGateRedirect()) return;
    void router.replace("/client/fx-hedge-onboarding");
  }, [mounted, loggedIn, router]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    document.documentElement.style.background = DECIDE_APP_PAGE_BG;
    document.body.style.background = DECIDE_APP_PAGE_BG;
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onFocus = () => syncClientSession();
    const onStorage = () => syncClientSession();
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) syncClientSession();
    };
    const onSessionCustom = () => syncClientSession();
    const onVisibility = () => {
      if (document.visibilityState === "visible") syncClientSession();
    };
    window.addEventListener("focus", onFocus);
    window.addEventListener("storage", onStorage);
    window.addEventListener("pageshow", onPageShow);
    window.addEventListener(CLIENT_SESSION_CHANGED_EVENT, onSessionCustom);
    document.addEventListener("visibilitychange", onVisibility);
    const onRoute = () => syncClientSession();
    router.events?.on("routeChangeComplete", onRoute);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("pageshow", onPageShow);
      window.removeEventListener(CLIENT_SESSION_CHANGED_EVENT, onSessionCustom);
      document.removeEventListener("visibilitychange", onVisibility);
      router.events?.off("routeChangeComplete", onRoute);
    };
  }, [router, syncClientSession]);

  useEffect(() => {
    if (!prospectBusy) return;
    const t = window.setTimeout(() => {
      setProspectBusy(false);
      setProspectErr((prev) => prev || "O pedido demorou demasiado. Recarregue a página e tente outra vez.");
    }, 95_000);
    return () => window.clearTimeout(t);
  }, [prospectBusy]);

  useEffect(() => {
    if (!mounted || loggedIn) return;
    const em = prospectEmail.trim().toLowerCase();
    if (!em.includes("@")) {
      setProspectListVerified(false);
      setProspectListStatusLoading(false);
      return;
    }
    setProspectListStatusLoading(true);
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const v = await fetchProspectEmailVerifiedFromServer(em);
          setProspectListVerified(v);
          if (v) setProspectListLinkSentEmail(null);
        } catch {
          setProspectListVerified(false);
        } finally {
          setProspectListStatusLoading(false);
        }
      })();
    }, 450);
    return () => window.clearTimeout(timer);
  }, [mounted, loggedIn, prospectEmail]);

  useEffect(() => {
    if (!mounted || loggedIn) return;
    const onVis = () => {
      if (document.visibilityState !== "visible") return;
      const em = prospectEmail.trim().toLowerCase();
      if (!em.includes("@")) return;
      void fetchProspectEmailVerifiedFromServer(em).then((v) => {
        setProspectListVerified(v);
        if (v) setProspectListLinkSentEmail(null);
      });
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [mounted, loggedIn, prospectEmail]);

  useEffect(() => {
    if (!mounted || !loggedIn) {
      setLatestModelMonth(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch("/api/client/recommendations-history");
        const j = (await r.json()) as {
          ok?: boolean;
          months?: { date: string; tbillsTotalPct?: number; equitySleeveTotalPct?: number }[];
        };
        if (cancelled) return;
        if (!r.ok || j.ok === false || !j.months?.length) {
          setLatestModelMonth(null);
          return;
        }
        const months = collapseHistMonthsToLatestPerCalendarMonth(j.months ?? []);
        setLatestModelMonth(months[0] ?? null);
      } catch {
        if (!cancelled) setLatestModelMonth(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mounted, loggedIn]);

  async function sendProspectListVerification() {
    if (prospectBusy || prospectSendInFlight.current) return;
    setProspectErr("");
    setProspectDevLink(null);
    const em = prospectEmail.trim();
    if (!em || !em.includes("@")) {
      setProspectErr("Indique um email válido.");
      return;
    }
    prospectSendInFlight.current = true;
    setProspectBusy(true);
    try {
      const vr = await requestEmailVerificationProspectSend(em, { prospectSource: "dashboard" });
      setProspectBusy(false);
      if (vr.mode === "simulated" && vr.link) {
        setProspectDevLink(vr.link);
        void navigator.clipboard?.writeText(vr.link).catch(() => {});
        setProspectListLinkSentEmail(em.toLowerCase());
      } else if (!vr.ok) {
        setProspectErr(vr.error || "Não foi possível enviar o email.");
        setProspectListLinkSentEmail(null);
      } else {
        setProspectDevLink(null);
        setProspectListLinkSentEmail(em.toLowerCase());
        setProspectListVerified(false);
      }
    } catch {
      setProspectErr("Erro inesperado ao pedir o link.");
    } finally {
      prospectSendInFlight.current = false;
      setProspectBusy(false);
    }
  }

  const portfolioScheduleUi = useMemo(() => {
    if (!mounted || !sessionUser) {
      return describeScheduleForUi(null);
    }
    const sch = getPortfolioSchedule(sessionUser);
    return describeScheduleForUi(sch);
  }, [mounted, sessionUser, portfolioScheduleRev]);

  /** Plano aprovado em `/client/approve` (localStorage). Enquanto `false`, mostramos CTA para constituir carteira. */
  const clientPlanApproved = useMemo(() => {
    if (!mounted || typeof window === "undefined") return false;
    try {
      return window.localStorage.getItem(CLIENT_PLAN_APPROVED_LS_KEY) === "1";
    } catch {
      return false;
    }
  }, [mounted, portfolioScheduleRev]);

  useEffect(() => {
    if (!mounted || typeof window === "undefined") return;
    const bump = () => setPortfolioScheduleRev((n) => n + 1);
    window.addEventListener(ONBOARDING_LOCALSTORAGE_CHANGED_EVENT, bump);
    return () => window.removeEventListener(ONBOARDING_LOCALSTORAGE_CHANGED_EVENT, bump);
  }, [mounted]);

  /** Só ao mudar sessão — não depender de portfolioScheduleRev (senão apaga o número a meio da edição). */
  useEffect(() => {
    if (!mounted || !sessionUser) {
      setNotifyPhoneInput("");
      return;
    }
    const fromAccount = getCurrentSessionUserPhone();
    const loose = getNotifyPhone(sessionUser);
    setNotifyPhoneInput(fromAccount || loose || "");
  }, [mounted, sessionUser]);

  const persistNotifyPhone = useCallback(() => {
    if (!sessionUser) {
      setNotifyPhoneSaveFeedback("Inicia sessão para gravar o telemóvel.");
      return;
    }
    const phTry = normalizeClientPhone(notifyPhoneInput);
    const current = (getCurrentSessionUserPhone() || "").trim();
    if (phTry.ok && phTry.e164 === current) {
      setNotifyPhoneSaveFeedback("");
      return;
    }
    setNotifyPhoneSaveFeedback("");
    const em = (getCurrentSessionUserEmail() || "").trim();
    const r = updateClientContact(em, notifyPhoneInput);
    if (r.ok) {
      if (r.phoneE164) setNotifyPhoneInput(r.phoneE164);
      setPortfolioScheduleRev((n) => n + 1);
      setNotifyPhoneSaveFeedback("Telemóvel guardado.");
      window.setTimeout(() => setNotifyPhoneSaveFeedback(""), 5000);
    } else {
      setNotifyPhoneSaveFeedback(r.error || "Não foi possível gravar.");
    }
  }, [sessionUser, notifyPhoneInput]);

  useEffect(() => {
    // Keep state consistent after login/logout without refresh.
    setErrMsg("");
  }, []);

  const clearKpiToolbarRefreshBusy = useCallback(() => {
    if (kpiRefreshSafetyRef.current != null) {
      window.clearTimeout(kpiRefreshSafetyRef.current);
      kpiRefreshSafetyRef.current = undefined;
    }
    setKpiToolbarRefreshBusy(false);
  }, []);

  /** Recarrega o iframe Flask (cache-bust). Útil se o :5000 acabou de arrancar ou queres forçar refresh. */
  function refreshKpiIframe() {
    setErrMsg("");
    clearKpiToolbarRefreshBusy();
    setKpiToolbarRefreshBusy(true);
    setIframeRefresh(Date.now());
    try {
      window.dispatchEvent(new Event(DECIDE_DASHBOARD_KPI_REFRESH_EVENT));
    } catch {
      /* ignore */
    }
    const expectsIframeReload =
      Boolean(kpiIframeSrc) &&
      (FLASK_KPI_EMBED_TABS.has(normalizeKpiEmbedTabId(kpiEmbedTab)) ||
        normalizeKpiEmbedTabId(kpiEmbedTab) === "fees_intro" ||
        normalizeKpiEmbedTabId(kpiEmbedTab) === "fees");
    kpiRefreshSafetyRef.current = window.setTimeout(
      () => clearKpiToolbarRefreshBusy(),
      expectsIframeReload ? 55_000 : 2_500,
    );
  }

  /** Carteira IBKR = página global «Carteira» (sub-menu local), não o embed do Dashboard. */
  function openPortfolioRecommendationsPanel() {
    if (!portfolioScheduleUi.actionRequired) return;
    void router.push({ pathname: "/client/carteira", query: { embed_tab: "portfolio" } });
  }

  /** Envio automático 1× por dia (local), antes do cliente operar o rebalanceamento. */
  useEffect(() => {
    if (!mounted || !sessionUser || !portfolioScheduleUi.actionRequired) return;
    const email = (getCurrentSessionUserEmail() || "").trim();
    const phone = (getCurrentSessionUserPhone() || getNotifyPhone(sessionUser)).trim();
    if (!email || !phone) {
      setPreadviceMsg(
        "Complete email e telemóvel ao criar a conta (registo) para os alertas automáticos.",
      );
      return;
    }
    if (!isSessionEmailVerified()) {
      setPreadviceMsg(
        "Confirme o email (link enviado no registo) para ativar alertas automáticos. Reenvie em /client/register se precisar.",
      );
      return;
    }
    setPreadviceMsg("");
    const event = !portfolioScheduleUi.hasOnboarding ? "constitution" : "monthly_review";
    const dayKey = toLocalYmd(new Date());
    const lsKey = `decide_preadvice_sent_v1_${sessionUser.toLowerCase()}_${dayKey}_${event}`;
    try {
      if (typeof window !== "undefined" && window.localStorage.getItem(lsKey) === "1") return;
      /* Reserva o slot **antes** do await: evita duplicar SMS/email no React Strict Mode ou quando o efeito re-corre. */
      if (typeof window !== "undefined") window.localStorage.setItem(lsKey, "1");
    } catch {
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const r = await fetch("/api/client/notify-portfolio", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            event,
            email: email || undefined,
            phone: phone || undefined,
            clientLabel: sessionUser,
          }),
        });
        const j = (await r.json().catch(() => ({}))) as {
          ok?: boolean;
          mode?: string;
          message?: string;
          email?: { sent?: boolean; error?: string };
          sms?: { sent?: boolean; error?: string };
        };
        if (cancelled) return;
        if (r.ok && j.ok !== false) {
          /* chave já estava a 1 — nada a fazer */
        } else {
          try {
            window.localStorage.removeItem(lsKey);
          } catch {
            // ignore
          }
          if (r.status === 503) {
            setPreadviceMsg("Alertas automáticos desligados no servidor (ALLOW_CLIENT_NOTIFY_API).");
          } else {
            let detail = j.message || "Não foi possível registar o alerta do dia.";
            const parts: string[] = [];
            if (j.email && j.email.sent === false && j.email.error && j.email.error !== "no_email") {
              parts.push(`Email: ${j.email.error}`);
            }
            if (j.sms && j.sms.sent === false && j.sms.error && j.sms.error !== "no_phone") {
              parts.push(`SMS: ${j.sms.error}`);
            }
            if (parts.length) detail = `${detail} ${parts.join(" · ")}`;
            setPreadviceMsg(detail);
          }
        }
      } catch {
        try {
          window.localStorage.removeItem(lsKey);
        } catch {
          // ignore
        }
        if (!cancelled) {
          setPreadviceMsg("Sem ligação ao servidor Next — alerta automático não enviado.");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [mounted, sessionUser, portfolioScheduleUi.actionRequired, portfolioScheduleUi.hasOnboarding, portfolioScheduleRev]);

  const overlayFactor = useMemo(() => getOverlayFactor(resp), [resp]);
  const overlayActive = overlayFactor !== null ? Math.abs(overlayFactor - 1.0) > 1e-6 : false;

  /* equity_raw: alinha ao cartão «Modelo teórico» no kpi_server (CSV model_equity_final_20y.csv / snapshot raw_kpis). */
  const chartData = useMemo(() => {
    const series = resp?.series || {};
    const dates = series.dates || [];

    return {
      dates,
      seriesLines: [
        {
          name: "Benchmark",
          values: series.benchmark_equity || [],
          color: "#d4d4d4",
        },
        {
          name: "Modelo teórico (não investível)",
          values: series.equity_raw || [],
          color: "#a3a3a3",
        },
        {
          name: "Estratégia cliente (overlay)",
          values: series.equity_overlayed || [],
          color: "#fafafa",
        },
        {
          name: "Raw Vol-Matched",
          values: series.equity_raw_volmatched || [],
          color: "#737373",
          visible: true,
        },
      ],
    };
  }, [resp]);

  return (
    <>
      <Head>
        <title>Dashboard</title>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <style>{`
          details > summary { list-style: none; }
          details > summary::-webkit-details-marker { display: none; }
          /* Fundo cinzento: decide-app-client + DECIDE_APP_PAGE_BG em globals / theme */
        `}</style>
      </Head>

      <div
        style={{
          minHeight: "100vh",
          overflowY: "auto",
          background: DECIDE_DASHBOARD.pageBg,
          color: DECIDE_DASHBOARD.text,
          padding: "0 12px 32px",
          fontFamily: DECIDE_DASHBOARD.fontFamily,
          boxSizing: "border-box",
        }}
      >
        {mounted && !loggedIn ? (
          <>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 12,
                alignItems: "center",
                marginTop: 0,
                marginBottom: 6,
              }}
            >
              <input
                type="email"
                value={prospectEmail}
                onChange={(e) => {
                  const v = e.target.value;
                  setProspectEmail(v);
                  if (prospectErr) setProspectErr("");
                  const norm = v.trim().toLowerCase();
                  if (prospectListLinkSentEmail && norm !== prospectListLinkSentEmail) {
                    setProspectListLinkSentEmail(null);
                  }
                }}
                placeholder="nome@email.com"
                autoComplete="email"
                style={{
                  flex: "1 1 200px",
                  minWidth: 0,
                  maxWidth: 340,
                  background: "rgba(39,39,42,0.85)",
                  border: "1px solid rgba(255,255,255,0.14)",
                  borderRadius: 12,
                  padding: "10px 14px",
                  color: "#fff",
                  fontSize: 14,
                }}
              />
              <button
                type="button"
                disabled={prospectBusy}
                onClick={() => void sendProspectListVerification()}
                style={{
                  background: DECIDE_DASHBOARD.buttonTealCta,
                  color: DECIDE_DASHBOARD.kpiMenuMainButtonColor,
                  border: DECIDE_DASHBOARD.kpiMenuMainButtonBorder,
                  borderRadius: 12,
                  padding: "10px 18px",
                  fontSize: 13,
                  fontWeight: 900,
                  cursor: prospectBusy ? "wait" : "pointer",
                  opacity: prospectBusy ? 0.8 : 1,
                  boxShadow: DECIDE_DASHBOARD.kpiMenuMainButtonShadow,
                  flexShrink: 0,
                }}
              >
                {prospectBusy ? (
                  <>
                    A enviar
                    <InlineLoadingDots />
                  </>
                ) : (
                  "Enviar link de confirmação"
                )}
              </button>
            </div>
            <div
              style={{
                fontSize: 12,
                lineHeight: 1.5,
                color: prospectErr
                  ? "#fca5a5"
                  : prospectBusy
                    ? "#a1a1aa"
                    : prospectListStatusLoading
                      ? "#a1a1aa"
                      : !prospectEmail.trim().includes("@")
                        ? "#a1a1aa"
                        : prospectListVerified
                          ? DECIDE_DASHBOARD.accentSky
                          : prospectDevLink
                            ? "#fde68a"
                            : prospectListLinkSentEmail === prospectEmail.trim().toLowerCase()
                              ? "#fde68a"
                              : "#a1a1aa",
                marginBottom: prospectDevLink ? 8 : 10,
                maxWidth: 640,
              }}
            >
              {prospectErr
                ? prospectErr
                : prospectBusy ? (
                  <>
                    A enviar o link
                    <InlineLoadingDots />
                  </>
                ) : prospectListStatusLoading ? (
                  <>
                    A verificar se o email já foi confirmado
                    <InlineLoadingDots />
                  </>
                ) : !prospectEmail.trim().includes("@")
                      ? "Indique o seu email e peça o link para confirmar a subscrição."
                      : prospectListVerified
                        ? "Email confirmado — estás na lista para novidades."
                        : prospectDevLink
                          ? "Sem envio real (desenvolvimento) — confirme com o link abaixo."
                          : prospectListLinkSentEmail === prospectEmail.trim().toLowerCase()
                            ? "Link enviado — abra o email e confirme para concluir."
                            : "Ainda não confirmado — carregue em «Enviar link de confirmação»."}
            </div>
            {prospectDevLink ? (
              <div
                style={{
                  marginBottom: 12,
                  background: "rgba(13, 148, 136, 0.14)",
                  border: "1px solid rgba(45, 212, 191, 0.35)",
                  borderRadius: 12,
                  padding: 12,
                  fontSize: 11,
                  lineHeight: 1.45,
                  maxWidth: 640,
                }}
              >
                {devConfirmationLinkUsesLoopback(prospectDevLink) ? (
                  <div
                    style={{
                      marginBottom: 10,
                      padding: 8,
                      borderRadius: 8,
                      background: "rgba(127,29,29,0.35)",
                      border: "1px solid rgba(248,113,113,0.45)",
                      color: "#fecaca",
                    }}
                  >
                    <strong>Telemóvel:</strong> link com <code style={{ color: "#fff" }}>127.0.0.1</code> não abre fora do PC —
                    defina <code style={{ color: "#fff" }}>EMAIL_LINK_BASE_URL</code> e <code style={{ color: "#fde68a" }}>npm run dev:lan</code>.
                  </div>
                ) : null}
                {!devConfirmationLinkUsesLoopback(prospectDevLink) && devConfirmationLinkWrongPort(prospectDevLink) ? (
                  <div
                    style={{
                      marginBottom: 10,
                      padding: 8,
                      borderRadius: 8,
                      background: "rgba(120,53,15,0.35)",
                      border: "1px solid rgba(251,191,36,0.45)",
                      color: "#fde68a",
                    }}
                  >
                    Porta no link deve ser <code style={{ color: "#fff" }}>{DECIDE_NEXT_DEV_PORT}</code> — vê{" "}
                    <code style={{ color: "#fff" }}>EMAIL_LINK_BASE_URL</code>.
                  </div>
                ) : null}
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                  <button
                    type="button"
                    onClick={() => void navigator.clipboard.writeText(prospectDevLink)}
                    style={{
                      background: DECIDE_DASHBOARD.buttonTealCta,
                      color: DECIDE_DASHBOARD.kpiMenuMainButtonColor,
                      border: DECIDE_DASHBOARD.kpiMenuMainButtonBorder,
                      borderRadius: 10,
                      padding: "8px 12px",
                      fontWeight: 800,
                      cursor: "pointer",
                      fontSize: 12,
                      boxShadow: DECIDE_DASHBOARD.kpiMenuMainButtonShadow,
                    }}
                  >
                    Copiar link
                  </button>
                  <span style={{ color: "#71717a", wordBreak: "break-all", flex: "1 1 200px" }}>{prospectDevLink}</span>
                </div>
              </div>
            ) : null}
          </>
        ) : null}

        {loggedIn && mounted && preadviceMsg ? (
          <div
            style={{
              marginTop: 6,
              marginBottom: 6,
              fontSize: 11,
              color: preadviceMsg.includes("desligados") || preadviceMsg.includes("Não foi") || preadviceMsg.includes("Sem ligação")
                ? "#fca5a5"
                : "#a1a1aa",
              lineHeight: 1.4,
              maxWidth: 720,
            }}
          >
            {preadviceMsg}
          </div>
        ) : null}

        {mounted && !loggedIn ? (
          <div
            role="status"
            style={{
              marginTop: 0,
              marginBottom: 12,
              padding: "10px 14px",
              borderRadius: 14,
              background: "rgba(13,148,136,0.14)",
              border: "1px solid rgba(45,212,191,0.28)",
              fontSize: 12,
              lineHeight: 1.35,
              color: "#d4d4d8",
              width: "100%",
              maxWidth: "100%",
              minWidth: 0,
              boxSizing: "border-box",
              overflowX: "auto",
              overflowY: "hidden",
              WebkitOverflowScrolling: "touch",
              scrollbarWidth: "thin",
            }}
          >
            <span
              style={{
                display: "inline-block",
                whiteSpace: "nowrap",
                width: "max-content",
                maxWidth: "none",
                wordBreak: "normal",
              }}
            >
              <span aria-hidden style={{ marginRight: 6 }}>
                💡
              </span>
              <strong style={{ color: "var(--text-primary)", whiteSpace: "nowrap" }}>Resumo:</strong> o histórico ilustrativo permite comparar a estratégia DECIDE com o mercado de referência ao longo do tempo — não é garantia de resultados futuros.
            </span>
          </div>
        ) : null}

        {loggedIn && mounted && !isSessionEmailVerified() ? (
          <div
            style={{
              marginTop: 8,
              padding: "8px 10px",
              borderRadius: 12,
              background: "rgba(234,179,8,0.14)",
              border: "1px solid rgba(250,204,21,0.4)",
              color: "#fde68a",
              fontSize: 12,
              lineHeight: 1.4,
              flexShrink: 0,
            }}
          >
            <strong>Confirme o email</strong> para ativar os alertas automáticos por email. Abra o link do último email que
            enviámos ou{" "}
            <a href="/client/register" style={{ color: "#fff", fontWeight: 800 }}>
              vá à página de registo
            </a>
            .
            <div style={{ marginTop: 8, fontSize: 11, color: "#fcd34d", lineHeight: 1.45 }}>
              <strong>Reenviar email de confirmação</strong> envia <em>outro</em> email com o mesmo tipo de link (útil caso não
              tenha encontrado o primeiro ou o link tenha expirado). Sem clicar nesse link, o servidor continua a tratar o email como não
              confirmado.
            </div>
            <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
              <button
                type="button"
                disabled={verifyResendBusy}
                onClick={() => {
                  const u = sessionUser;
                  const em = (getCurrentSessionUserEmail() || "").trim();
                  if (!u || !em.includes("@")) {
                    setVerifyBannerNote("Preencha o email na conta (registo).");
                    return;
                  }
                  setVerifyResendBusy(true);
                  setVerifyBannerNote("");
                  void (async () => {
                    try {
                      const vr = await requestEmailVerificationSend(u, em);
                      if (vr.mode === "simulated" && vr.link && typeof window !== "undefined") {
                        window.prompt("Link de confirmação (dev):", vr.link);
                      } else if (!vr.ok) {
                        setVerifyBannerNote(vr.error || "Falha ao reenviar.");
                      } else {
                        setVerifyBannerNote("Enviámos outro email. Verifique a caixa de entrada.");
                      }
                    } finally {
                      setVerifyResendBusy(false);
                    }
                  })();
                }}
                style={{
                  background: DECIDE_DASHBOARD.buttonAmberCta,
                  color: "#18181b",
                  border: "1px solid rgba(255,255,255,0.22)",
                  borderRadius: 12,
                  padding: "8px 14px",
                  fontSize: 12,
                  fontWeight: 900,
                  cursor: verifyResendBusy ? "wait" : "pointer",
                  opacity: verifyResendBusy ? 0.75 : 1,
                  boxShadow: DECIDE_DASHBOARD.buttonShadowSoft,
                }}
              >
                {verifyResendBusy ? (
                  <>
                    A enviar
                    <InlineLoadingDots />
                  </>
                ) : (
                  "Reenviar email de confirmação"
                )}
              </button>
              {verifyBannerNote ? <span style={{ fontSize: 12, color: "#fef9c3" }}>{verifyBannerNote}</span> : null}
            </div>
          </div>
        ) : null}

        <div
          style={{
            marginTop: 0,
            width: "100%",
            display: "flex",
            flexDirection: "column",
          }}
        >
          {loggedIn ? (
            <div
              style={{
                background: DECIDE_DASHBOARD.headerPanel,
                border: "1px solid rgba(255,255,255,0.08)",
                borderRadius: 16,
                padding: "10px 12px 12px",
                display: "flex",
                flexDirection: "column",
                gap: 8,
                order: 2,
                marginTop: mounted ? 6 : 0,
              }}
            >
              {sessionUser && (!portfolioScheduleUi.hasOnboarding || !clientPlanApproved) ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {!portfolioScheduleUi.hasOnboarding ? (
                    <div
                      style={{
                        display: "flex",
                        flexWrap: "wrap",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 12,
                        padding: "12px 14px",
                        borderRadius: 12,
                        background: "linear-gradient(135deg, rgba(48,48,50,0.65) 0%, rgba(24,24,27,0.96) 100%)",
                        border: "1px solid rgba(255,255,255,0.1)",
                        boxShadow: "0 2px 12px rgba(0,0,0,0.4)",
                      }}
                    >
                      <div style={{ flex: "1 1 220px", minWidth: 0 }}>
                        <div style={{ fontSize: 11, fontWeight: 900, letterSpacing: "0.06em", color: "#d4d4d4" }}>
                          CALENDÁRIO — CONSTITUIÇÃO INICIAL
                        </div>
                        <p style={{ margin: "6px 0 0", fontSize: 12, lineHeight: 1.45, color: "#e4e4e7" }}>
                          Marque o dia em que começa a seguir o plano (hoje). Isto regista o calendário de revisões mensais —{" "}
                          <strong style={{ color: "#d4d4d8" }}>não substitui</strong> aprovar o plano nem executar ordens. Pode
                          utilizar os atalhos para o plano e revisões na página Plano e no fluxo de aprovação quando estiverem
                          disponíveis.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          const u = sessionUser || getCurrentSessionUser();
                          if (!u) return;
                          setOnboardingSnapshotNow(u, profile);
                          setPortfolioScheduleRev((n) => n + 1);
                        }}
                        style={{
                          flex: "0 0 auto",
                          background: DECIDE_DASHBOARD.buttonRegister,
                          color: "#fde68a",
                          border: "1px solid rgba(251,191,36,0.55)",
                          borderRadius: 12,
                          padding: "10px 18px",
                          fontSize: 13,
                          fontWeight: 900,
                          cursor: "pointer",
                          boxShadow: `${DECIDE_DASHBOARD.buttonShadowSoft}, 0 4px 20px rgba(251,191,36,0.15)`,
                        }}
                      >
                        Marcar início (hoje)
                      </button>
                    </div>
                  ) : null}
                  {!clientPlanApproved ? (
                    <div
                      style={{
                        display: "flex",
                        flexWrap: "wrap",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 12,
                        padding: "12px 14px",
                        borderRadius: 12,
                        background: "linear-gradient(135deg, rgba(120,53,15,0.35) 0%, rgba(24,24,27,0.96) 100%)",
                        border: "1px solid rgba(251,191,36,0.42)",
                        boxShadow: "0 4px 24px rgba(0,0,0,0.35)",
                      }}
                    >
                      <div style={{ flex: "1 1 220px", minWidth: 0 }}>
                        <div style={{ fontSize: 11, fontWeight: 900, letterSpacing: "0.06em", color: "#fde68a" }}>
                          CONSTITUIR CARTEIRA (PLANO)
                        </div>
                        <p style={{ margin: "6px 0 0", fontSize: 12, lineHeight: 1.45, color: "#e4e4e7" }}>
                          Enquanto o plano não for <strong style={{ color: "#d4d4d8" }}>aprovado</strong> neste fluxo, a carteira
                          não fica constituída ao nível regulamentar. Abra a página do plano recomendado para rever e confirmar —
                          não depende do dia de revisão mensal.
                        </p>
                      </div>
                      <button
                        type="button"
                        aria-busy={planPageNavPending}
                        disabled={planPageNavPending}
                        onClick={goToApprovePlan}
                        style={{
                          ...PLAN_CTA_ORANGE,
                          flex: "0 0 auto",
                          width: "auto",
                          padding: "10px 18px",
                          fontSize: 13,
                          border: "none",
                          fontFamily: "inherit",
                          cursor: planPageNavPending ? "wait" : "pointer",
                          opacity: planPageNavPending ? 0.9 : 1,
                        }}
                      >
                        {planPageNavPending ? (
                          <>
                            A abrir
                            <InlineLoadingDots />
                          </>
                        ) : (
                          "Ver plano para a sua carteira"
                        )}
                      </button>
                    </div>
                  ) : null}
                </div>
              ) : null}
              {(() => {
                const t = normalizeKpiEmbedTabId(kpiEmbedTab);
                if (t === "charts" || t === "simulator") return null;
                return (
              <details
                style={{
                  borderRadius: 12,
                  background: "rgba(39,39,42,0.5)",
                  border: "1px solid rgba(255,255,255,0.08)",
                }}
              >
                <summary
                  style={{
                    padding: "8px 10px",
                    fontSize: 12,
                    fontWeight: 900,
                    color: "#d4d4d4",
                    cursor: "pointer",
                    listStyle: "none",
                  }}
                >
                  {portfolioScheduleUi.hasOnboarding
                    ? "Recomendações de carteira (expandir)"
                    : "Recomendações de carteira (telemóvel, alertas — expandir)"}
                </summary>
                <div style={{ padding: "0 10px 10px" }}>
                <div style={{ fontSize: 11, color: "#d4d4d8", lineHeight: 1.45, marginBottom: 10 }}>
                  {portfolioScheduleUi.ruleSummary} Abra a página <strong>Carteira</strong> no menu superior (vista IBKR
                  e composição sugerida).
                </div>
                {latestModelMonth &&
                typeof latestModelMonth.tbillsTotalPct === "number" &&
                isFinite(latestModelMonth.tbillsTotalPct) ? (
                  <div
                    style={{
                      marginBottom: 12,
                      padding: "10px 12px",
                      borderRadius: 12,
                      background: "rgba(39, 39, 42, 0.55)",
                      border: "1px solid rgba(255, 255, 255, 0.08)",
                      fontSize: 12,
                      lineHeight: 1.5,
                      color: "#e4e4e7",
                    }}
                  >
                    <strong style={{ color: "#d4d4d4" }}>Carteira modelo (última data)</strong>{" "}
                    <span style={{ color: "#a1a1aa" }}>({formatPtDate(latestModelMonth.date)})</span>
                    <div style={{ marginTop: 6 }}>
                      <span style={{ fontWeight: 900, color: "#c4c4c4" }}>
                        T-Bills {latestModelMonth.tbillsTotalPct.toFixed(1)}%
                      </span>
                      {typeof latestModelMonth.equitySleeveTotalPct === "number" &&
                      isFinite(latestModelMonth.equitySleeveTotalPct) ? (
                        <span style={{ fontWeight: 700, color: "#d4d4d8" }}>
                          {" "}
                          · Acções {latestModelMonth.equitySleeveTotalPct.toFixed(1)}%
                        </span>
                      ) : null}
                    </div>
                  </div>
                ) : null}
                <div style={{ marginBottom: 10, display: "flex", flexDirection: "column", gap: 6 }}>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                    <span style={{ fontSize: 11, color: "#a1a1aa", fontWeight: 700 }}>Telemóvel (conta)</span>
                    <input
                      type="tel"
                      inputMode="tel"
                      autoComplete="tel"
                      placeholder="+351912345678 ou 912345678"
                      value={notifyPhoneInput}
                      onChange={(e) => {
                        setNotifyPhoneInput(e.target.value);
                        if (notifyPhoneSaveFeedback) setNotifyPhoneSaveFeedback("");
                      }}
                      onBlur={() => {
                        if (!sessionUser) return;
                        persistNotifyPhone();
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          persistNotifyPhone();
                        }
                      }}
                      style={{
                        flex: "1 1 200px",
                        maxWidth: 280,
                        background: "rgba(24,24,27,0.75)",
                        border: "1px solid rgba(255,255,255,0.12)",
                        borderRadius: 10,
                        padding: "6px 10px",
                        color: "#fff",
                        fontSize: 12,
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => persistNotifyPhone()}
                      style={{
                        background: DECIDE_DASHBOARD.buttonSlateCta,
                        color: "var(--text-primary)",
                        border: "1px solid rgba(255,255,255,0.22)",
                        borderRadius: 10,
                        padding: "6px 14px",
                        fontSize: 12,
                        fontWeight: 800,
                        cursor: "pointer",
                        boxShadow: DECIDE_DASHBOARD.buttonShadowSoft,
                      }}
                    >
                      Guardar telemóvel
                    </button>
                  </div>
                  {notifyPhoneSaveFeedback ? (
                    <div
                      style={{
                        fontSize: 11,
                        fontWeight: 700,
                        color: notifyPhoneSaveFeedback.startsWith("Telemóvel guardado")
                          ? DECIDE_DASHBOARD.accentSky
                          : "#fca5a5",
                        maxWidth: 420,
                        lineHeight: 1.4,
                      }}
                    >
                      {notifyPhoneSaveFeedback}
                    </div>
                  ) : null}
                  <span style={{ fontSize: 10, color: "#71717a" }}>
                    Email na conta: {getCurrentSessionUserEmail() || "—"} · no telemóvel utilize «Guardar» ou Enter (só sair do
                    campo por vezes não grava)
                  </span>
                </div>
                {portfolioScheduleUi.hasOnboarding ? (
                  <div style={{ fontSize: 12, color: "var(--text-primary)", lineHeight: 1.55 }}>
                    <div>
                      <strong>Constituição inicial:</strong>{" "}
                      {portfolioScheduleUi.onboardingYmd ? formatPtDate(portfolioScheduleUi.onboardingYmd) : "—"}
                    </div>
                    <div>
                      <strong>Próxima revisão mensal</strong> (1.º dia útil do mês, ciclo global):{" "}
                      {portfolioScheduleUi.nextReviewPt || "—"}
                    </div>
                    {portfolioScheduleUi.isReviewDueToday ? (
                      <div
                        style={{
                          marginTop: 8,
                          padding: "8px 10px",
                          borderRadius: 10,
                          background: "rgba(39, 39, 42, 0.75)",
                          border: "1px solid rgba(255, 255, 255, 0.1)",
                          color: "#e4e4e7",
                          fontSize: 11,
                          fontWeight: 700,
                        }}
                      >
                        Hoje coincide com o dia de revisão mensal — consulte a carteira recomendada no iframe e ajuste
                        encomendas conforme o seu perfil ({profile}).
                      </div>
                    ) : null}
                    <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8, maxWidth: 520 }}>
                      <button
                        type="button"
                        aria-busy={planPageNavPending}
                        disabled={planPageNavPending}
                        onClick={goToApprovePlan}
                        style={{
                          ...PLAN_CTA_ORANGE,
                          alignSelf: "flex-start",
                          width: "auto",
                          padding: "10px 18px",
                          fontSize: 13,
                          border: "none",
                          fontFamily: "inherit",
                          cursor: planPageNavPending ? "wait" : "pointer",
                          opacity: planPageNavPending ? 0.9 : 1,
                        }}
                      >
                        {planPageNavPending ? (
                          <>
                            A abrir
                            <InlineLoadingDots />
                          </>
                        ) : (
                          "Ver proposta de investimento (regulamentar)"
                        )}
                      </button>
                      <p style={{ margin: 0, fontSize: 10, color: "#a1a1aa", lineHeight: 1.45 }}>
                        <strong>Onde aprovar:</strong> a confirmação regulamentar das ordens do último rebalance faz-se nesta página
                        (mesmos dados que o plano e o ficheiro <code style={{ color: "var(--text-primary)" }}>decide_trade_plan_ibkr.csv</code>
                        ). O botão «Confirmar revisão mensal aplicada / lida» abaixo é só um registo opcional de que viste a
                        recomendação no dashboard — não substitui a aprovação do plano.
                      </p>
                    </div>
                    <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                      <button
                        type="button"
                        onClick={() => {
                          if (!sessionUser) return;
                          acknowledgeMonthlyReview(sessionUser);
                          setPortfolioScheduleRev((n) => n + 1);
                        }}
                        style={{
                          background:
                            "linear-gradient(165deg, rgba(63,63,70,0.5) 0%, rgba(39,39,42,0.9) 100%)",
                          color: "#d4d4d4",
                          border: "1px solid rgba(255,255,255,0.12)",
                          borderRadius: 10,
                          padding: "6px 12px",
                          fontSize: 11,
                          fontWeight: 700,
                          cursor: "pointer",
                          boxShadow: "inset 0 1px 0 rgba(255,255,255,0.06), 0 2px 8px rgba(0,0,0,0.35)",
                        }}
                      >
                        Confirmar revisão mensal aplicada / lida
                      </button>
                      <span style={{ fontSize: 10, color: "#71717a" }}>
                        (Registo opcional; não altera as datas do ciclo global.)
                      </span>
                    </div>
                  </div>
                ) : (
                  <p style={{ margin: "10px 0 0", fontSize: 11, color: "#71717a", lineHeight: 1.45 }}>
                    {clientPlanApproved ? (
                      <>
                        A <strong style={{ color: "#a1a1aa" }}>constituição inicial</strong> marca-se com o botão acima («Marcar
                        início») — não precisas de abrir esta secção para isso.
                      </>
                    ) : (
                      <>
                        Se já marcaste o início no calendário, falta <strong style={{ color: "#a1a1aa" }}>constituir a carteira</strong>{" "}
                        (aprovar o plano em{" "}
                        <button
                          type="button"
                          disabled={planPageNavPending}
                          onClick={goToApprovePlan}
                          style={{
                            color: "#fb923c",
                            fontWeight: 800,
                            background: "none",
                            border: "none",
                            padding: 0,
                            cursor: planPageNavPending ? "wait" : "pointer",
                            textDecoration: "underline",
                            fontSize: "inherit",
                            fontFamily: "inherit",
                          }}
                        >
                          {planPageNavPending ? (
                            <>
                              A abrir
                              <InlineLoadingDots />
                            </>
                          ) : (
                            "Ver proposta de investimento"
                          )}
                        </button>
                        ).
                      </>
                    )}
                  </p>
                )}
                </div>
              </details>
                );
              })()}
            </div>
          ) : null}

          {mounted ? (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 0,
                marginTop: 0,
                order: 1,
              }}
            >
              <p
                style={{
                  fontSize: 12,
                  color: "#71717a",
                  margin: "0 0 10px",
                  lineHeight: 1.45,
                  maxWidth: 800,
                }}
              >
                Este serviço gera recomendações. A execução depende sempre da sua aprovação.{" "}
                <ClientPendingTextLink href="/client/como-funciona" style={{ color: "#a1a1aa", fontWeight: 700 }}>
                  Como funciona
                </ClientPendingTextLink>
              </p>
              <ClientKpiPageChrome
                as="div"
                title="Dashboard"
                toolbar={
                  <>
                    <label
                      htmlFor={loggedIn ? "client-dash-profile" : "client-dash-profile-guest"}
                      style={{ color: "#a1a1aa", fontSize: 12, fontWeight: 700 }}
                    >
                      Perfil de risco
                    </label>
                    <select
                      id={loggedIn ? "client-dash-profile" : "client-dash-profile-guest"}
                      value={profile}
                      onChange={(e) => setProfile(e.target.value as "conservador" | "moderado" | "dinamico")}
                      style={{
                        background: "rgba(39,39,42,0.85)",
                        color: "#fff",
                        border: "1px solid rgba(255,255,255,0.2)",
                        borderRadius: 12,
                        padding: "8px 14px",
                        fontWeight: 800,
                        fontSize: 14,
                        cursor: "pointer",
                      }}
                    >
                      <option value="conservador">Conservador</option>
                      <option value="moderado">Moderado</option>
                      <option value="dinamico">Dinâmico</option>
                    </select>
                    <button
                      type="button"
                      onClick={refreshKpiIframe}
                      disabled={kpiToolbarRefreshBusy}
                      aria-busy={kpiToolbarRefreshBusy}
                      title="Atualizar recomendação e indicadores do simulador (o iframe KPI pode demorar a responder)"
                      style={{
                        background: DECIDE_DASHBOARD.refreshButton,
                        color: DECIDE_DASHBOARD.refreshText,
                        border: DECIDE_DASHBOARD.kpiMenuMainButtonBorder,
                        borderRadius: 12,
                        padding: "8px 14px",
                        fontSize: 13,
                        fontWeight: 800,
                        cursor: kpiToolbarRefreshBusy ? "wait" : "pointer",
                        opacity: kpiToolbarRefreshBusy ? 0.88 : 1,
                        boxShadow: DECIDE_DASHBOARD.kpiMenuMainButtonShadow,
                      }}
                    >
                      {kpiToolbarRefreshBusy ? (
                        <>
                          A atualizar
                          <InlineLoadingDots />
                        </>
                      ) : (
                        "Atualizar recomendação"
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => void router.push("/client/model-lab")}
                      title="Abrir laboratório interno de cenários do motor"
                      style={{
                        background: "rgba(39,39,42,0.82)",
                        color: "#e2e8f0",
                        border: "1px solid rgba(148,163,184,0.35)",
                        borderRadius: 12,
                        padding: "8px 14px",
                        fontSize: 13,
                        fontWeight: 800,
                        cursor: "pointer",
                      }}
                    >
                      Model Lab
                    </button>
                    <button
                      type="button"
                      onClick={() => setModelVersion("v7_dynamic_light")}
                      title="Ativar preview do novo modelo V7 (light)"
                      style={{
                        background:
                          modelVersion === "v7_dynamic_light"
                            ? "rgba(30,58,138,0.72)"
                            : "rgba(39,39,42,0.82)",
                        color: "#e2e8f0",
                        border: "1px solid rgba(96,165,250,0.45)",
                        borderRadius: 12,
                        padding: "8px 14px",
                        fontSize: 13,
                        fontWeight: 800,
                        cursor: "pointer",
                      }}
                    >
                      Novo modelo (V7)
                    </button>
                    <button
                      type="button"
                      onClick={() => setModelVersion("official_v6")}
                      title="Voltar à referência oficial V6"
                      style={{
                        background:
                          modelVersion === "official_v6"
                            ? "rgba(63,63,70,0.9)"
                            : "rgba(39,39,42,0.82)",
                        color: "#e2e8f0",
                        border: "1px solid rgba(148,163,184,0.35)",
                        borderRadius: 12,
                        padding: "8px 14px",
                        fontSize: 13,
                        fontWeight: 800,
                        cursor: "pointer",
                      }}
                    >
                      Referência (V6)
                    </button>
                  </>
                }
                toolbarFooter={
                  errMsg ? (
                    <div
                      style={{
                        background: "#2a0f12",
                        border: "1px solid #7f1d1d",
                        borderRadius: 12,
                        padding: 10,
                        fontSize: 13,
                        maxWidth: "min(100%, 720px)",
                        marginLeft: "auto",
                      }}
                    >
                      <b>Erro:</b> {errMsg}
                    </div>
                  ) : undefined
                }
              >
                <ClientKpiEmbedWorkspace
                  chrome="navLinked"
                  riskProfile={profile}
                  modelVersion={modelVersion}
                  kpiEmbedTab={kpiEmbedTab}
                  applyKpiEmbedTab={applyKpiEmbedTab}
                  kpiViewMode={kpiViewMode}
                  setKpiViewMode={setKpiViewMode}
                  kpiIframeSrc={kpiIframeSrc}
                  kpiIframeRef={kpiIframeRef}
                  onKpiIframeReady={clearKpiToolbarRefreshBusy}
                  kpiConnectivityBump={iframeRefresh}
                  mainTopSlot={
                    normalizeKpiEmbedTabId(kpiEmbedTab) === "overview" ? (
                      <CarteiraIbkrSummary refreshToken={iframeRefresh} embeddedInMainColumn />
                    ) : undefined
                  }
                />
              </ClientKpiPageChrome>
            </div>
          ) : null}
        </div>

        {mounted && !loggedIn ? (
          <div
            style={{
              marginTop: 12,
              flexShrink: 0,
              background: "rgba(24,24,27,0.65)",
              border: "1px solid rgba(148,163,184,0.2)",
              borderRadius: 16,
              padding: "12px 14px",
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 800, color: "var(--text-primary)" }}>Funcionalidades com conta</div>
            <div style={{ color: "#a1a1aa", marginTop: 6, fontSize: 12, lineHeight: 1.45 }}>
              A análise acima é pública. Com{" "}
              <a href="/client/login" style={{ color: "#d4d4d4", fontWeight: 800 }}>
                login
              </a>{" "}
              ou{" "}
              <a href="/client/register" style={{ color: "#d4d4d4", fontWeight: 800 }}>
                registo
              </a>{" "}
              pode receber alertas, gerir revisões de carteira e gravar contactos.
            </div>
          </div>
        ) : null}
      </div>
    </>
  );
}

