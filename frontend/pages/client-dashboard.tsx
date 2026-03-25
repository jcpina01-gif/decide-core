import Head from "next/head";
import { useRouter } from "next/router";
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  CLIENT_SESSION_CHANGED_EVENT,
  getCurrentSessionUser,
  getCurrentSessionUserEmail,
  getCurrentSessionUserPhone,
  isClientLoggedIn,
  isSessionEmailVerified,
  logoutClient,
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
import {
  DECIDE_NEXT_DEV_PORT,
  devConfirmationLinkUsesLoopback,
  devConfirmationLinkWrongPort,
} from "../lib/emailConfirmationDevLink";
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

/** Separador activo no iframe Flask (kpi_server) — preservado ao mudar perfil. */
const KPI_EMBED_TAB_STORAGE_KEY = "decide_kpi_embed_tab_v1";
const ALLOWED_KPI_EMBED_TABS = new Set([
  "overview",
  "simulator",
  "horizons",
  "charts",
  "portfolio",
  "portfolio_history",
  "faq",
]);

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
  const [profile, setProfile] = useState<"conservador" | "moderado" | "dinamico">("moderado");
  const [loading, setLoading] = useState(false);
  const [errMsg, setErrMsg] = useState<string>("");
  const [resp, setResp] = useState<CoreOverlayedResp | null>(null);
  const [iframeRefresh, setIframeRefresh] = useState(0);
  const [kpiEmbedTab, setKpiEmbedTab] = useState<string>("simulator");
  /** Força releitura do calendário de carteira após gravar no localStorage */
  const [portfolioScheduleRev, setPortfolioScheduleRev] = useState(0);
  const [notifyPhoneInput, setNotifyPhoneInput] = useState("");
  /** Erro ou aviso do envio automático (antes do rebalance); o botão grande não dispara envio. */
  const [preadviceMsg, setPreadviceMsg] = useState("");
  const [verifyResendBusy, setVerifyResendBusy] = useState(false);
  const [verifyBannerNote, setVerifyBannerNote] = useState("");
  const [prospectEmail, setProspectEmail] = useState("");
  const [prospectBusy, setProspectBusy] = useState(false);
  const [prospectErr, setProspectErr] = useState("");
  const [prospectMsg, setProspectMsg] = useState("");
  const [prospectDevLink, setProspectDevLink] = useState<string | null>(null);
  const prospectSendInFlight = useRef(false);
  const kpiIframeRef = useRef<HTMLIFrameElement | null>(null);
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

  useLayoutEffect(() => {
    setMounted(true);
    syncClientSession();
  }, [syncClientSession]);

  useLayoutEffect(() => {
    if (!mounted) return;
    try {
      const v = sessionStorage.getItem(KPI_EMBED_TAB_STORAGE_KEY);
      if (v && ALLOWED_KPI_EMBED_TABS.has(v)) setKpiEmbedTab(v);
    } catch {
      // ignore
    }
  }, [mounted]);

  useEffect(() => {
    if (!mounted) return;
    function onMsg(e: MessageEvent) {
      const d = e.data as { type?: string; tab?: string } | null;
      if (!d || d.type !== "decide-kpi-embed-tab" || typeof d.tab !== "string") return;
      if (!ALLOWED_KPI_EMBED_TABS.has(d.tab)) return;
      setKpiEmbedTab(d.tab);
      try {
        sessionStorage.setItem(KPI_EMBED_TAB_STORAGE_KEY, d.tab);
      } catch {
        // ignore
      }
    }
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [mounted]);

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
      setProspectErr((prev) => prev || "O pedido demorou demasiado. Recarrega a página e tenta outra vez.");
    }, 95_000);
    return () => window.clearTimeout(t);
  }, [prospectBusy]);

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
        const months = j.months;
        setLatestModelMonth(months[months.length - 1]!);
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
    setProspectMsg("");
    setProspectDevLink(null);
    const em = prospectEmail.trim();
    if (!em || !em.includes("@")) {
      setProspectErr("Indica um email válido.");
      return;
    }
    prospectSendInFlight.current = true;
    setProspectBusy(true);
    try {
      const vr = await requestEmailVerificationProspectSend(em, { prospectSource: "dashboard" });
      setProspectBusy(false);
      if (vr.link) {
        setProspectDevLink(vr.link);
        void navigator.clipboard?.writeText(vr.link).catch(() => {});
      }
      if (vr.mode === "simulated" && vr.link) {
        setProspectMsg(
          "Sem envio configurado (Resend ou Gmail): usa o link na caixa azul abaixo. O email fica na lista de interessados só depois de clicares no link.",
        );
      } else if (!vr.ok) {
        setProspectErr(vr.error || "Não foi possível enviar o email.");
      } else {
        setProspectMsg(
          "Email enviado. Abre o link que recebeste para confirmares — só assim entras na lista para novidades. Se testas no telemóvel, o link tem de usar o IP do PC (EMAIL_LINK_BASE_URL + npm run dev:lan), como no registo.",
        );
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

  useEffect(() => {
    if (!mounted || !sessionUser) {
      setNotifyPhoneInput("");
      return;
    }
    const fromAccount = getCurrentSessionUserPhone();
    const loose = getNotifyPhone(sessionUser);
    setNotifyPhoneInput(fromAccount || loose || "");
  }, [mounted, sessionUser, portfolioScheduleRev]);

  useEffect(() => {
    // Keep state consistent after login/logout without refresh.
    setErrMsg("");
  }, []);

  /** Recarrega o iframe Flask (cache-bust). Útil se o :5000 acabou de arrancar ou queres forçar refresh. */
  function refreshKpiIframe() {
    setErrMsg("");
    setIframeRefresh(Date.now());
  }

  /** Só abre o painel (carteira); os alertas são enviados automaticamente ao entrar no dia de ação. */
  function openPortfolioRecommendationsPanel() {
    if (!portfolioScheduleUi.actionRequired) return;
    refreshKpiIframe();
    setTimeout(() => {
      kpiIframeRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 200);
  }

  /** Envio automático 1× por dia (local), antes do cliente operar o rebalanceamento. */
  useEffect(() => {
    if (!mounted || !sessionUser || !portfolioScheduleUi.actionRequired) return;
    const email = (getCurrentSessionUserEmail() || "").trim();
    const phone = (getCurrentSessionUserPhone() || getNotifyPhone(sessionUser)).trim();
    if (!email || !phone) {
      setPreadviceMsg(
        "Completa email e telemóvel ao criar a conta (registo) para os alertas automáticos.",
      );
      return;
    }
    if (!isSessionEmailVerified()) {
      setPreadviceMsg(
        "Confirma o email (link enviado no registo) para ativar alertas automáticos. Reenvia em /client/register se precisares.",
      );
      return;
    }
    setPreadviceMsg("");
    const event = !portfolioScheduleUi.hasOnboarding ? "constitution" : "monthly_review";
    const dayKey = toLocalYmd(new Date());
    const lsKey = `decide_preadvice_sent_v1_${sessionUser.toLowerCase()}_${dayKey}_${event}`;
    try {
      if (typeof window !== "undefined" && window.localStorage.getItem(lsKey) === "1") return;
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
          try {
            window.localStorage.setItem(lsKey, "1");
          } catch {
            // ignore
          }
        } else if (r.status === 503) {
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
      } catch {
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

  const chartData = useMemo(() => {
    const series = resp?.series || {};
    const dates = series.dates || [];

    return {
      dates,
      seriesLines: [
        {
          name: "Benchmark",
          values: series.benchmark_equity || [],
          color: "#38bdf8",
        },
        {
          name: "Modelo base (técnico)",
          values: series.equity_raw || [],
          color: "#e879f9",
        },
        {
          name: "Estratégia cliente (overlay)",
          values: series.equity_overlayed || [],
          color: "#4ade80",
        },
        {
          name: "Raw Vol-Matched",
          values: series.equity_raw_volmatched || [],
          color: "#fb923c",
          visible: true,
        },
      ],
    };
  }, [resp]);

  const flaskCap15Url = useMemo(() => {
    const t = iframeRefresh ? `&t=${iframeRefresh}` : "";
    const tab = `&embed_tab=${encodeURIComponent(kpiEmbedTab)}`;
    // Usar 127.0.0.1: Flask está em host 127.0.0.1; "localhost" pode ir para ::1 e falhar no iframe.
    return `http://127.0.0.1:5000/?client_embed=1&profile=${encodeURIComponent(profile)}${tab}${t}`;
  }, [profile, iframeRefresh, kpiEmbedTab]);

  return (
    <>
      <Head>
        <title>Decide Cliente — Dashboard</title>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <style>{`
          @keyframes decidePortfolioPulse {
            0%, 100% { box-shadow: 0 0 0 0 rgba(234, 88, 12, 0.45); }
            50% { box-shadow: 0 0 28px 6px rgba(249, 115, 22, 0.28); }
          }
          details > summary { list-style: none; }
          details > summary::-webkit-details-marker { display: none; }
        `}</style>
      </Head>

      <div
        style={{
          minHeight: "100vh",
          overflowX: "hidden",
          overflowY: "auto",
          background: "#06163a",
          color: "#ffffff",
          padding: "8px 12px 20px",
          fontFamily: "Nunito, Segoe UI, Arial, sans-serif",
          boxSizing: "border-box",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 10,
            flexWrap: "wrap",
            flexShrink: 0,
            marginBottom: 4,
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 25, fontWeight: 800, letterSpacing: "-0.02em", lineHeight: 1.15 }}>
              Decide Cliente
            </div>
            <div style={{ color: "#94a3b8", marginTop: 2, fontSize: 11, lineHeight: 1.3 }}>
              {mounted && loggedIn
                ? "Sessão iniciada · simule o seu cenário abaixo · alertas e revisões de carteira"
                : "Página pública · simule o seu cenário abaixo · login para alertas e revisões de carteira"}
            </div>
          </div>

          <div
            style={{
              display: "flex",
              gap: 8,
              flexWrap: "wrap",
              alignItems: "center",
              justifyContent: "flex-end",
            }}
          >
            {loggedIn ? (
              <div
                style={{
                  background: "#12244d",
                  border: "1px solid rgba(255,255,255,0.18)",
                  borderRadius: 10,
                  padding: "5px 10px",
                  fontSize: 11,
                  fontWeight: 800,
                  color: "#93c5fd",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  maxWidth: 220,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
                title={sessionUser || undefined}
              >
                {sessionUser || "—"}
              </div>
            ) : null}

            <a
              href={loggedIn ? "/client-montante" : "/client/register"}
              style={{
                background: "#3f73ff",
                color: "#fff",
                border: "1px solid rgba(255,255,255,0.28)",
                borderRadius: 10,
                padding: "7px 12px",
                fontSize: 12,
                fontWeight: 800,
                textDecoration: "none",
              }}
            >
              Registo
            </a>

            <a
              href={loggedIn ? "/client-montante" : "/client/login"}
              style={{
                background: "#12244d",
                color: "#fff",
                border: "1px solid rgba(255,255,255,0.18)",
                borderRadius: 10,
                padding: "7px 12px",
                fontSize: 12,
                fontWeight: 800,
                textDecoration: "none",
              }}
            >
              Login
            </a>

            <button
              type="button"
              onClick={() => {
                if (!loggedIn) return;
                logoutClient();
                window.location.reload();
              }}
              disabled={!loggedIn}
              style={{
                background: "#0f172a",
                color: "#fff",
                border: "1px solid rgba(255,255,255,0.18)",
                borderRadius: 10,
                padding: "7px 12px",
                fontSize: 12,
                fontWeight: 800,
                cursor: !loggedIn ? "not-allowed" : "pointer",
                opacity: !loggedIn ? 0.6 : 1,
              }}
            >
              Logout
            </button>
          </div>
          </div>

        {mounted && !loggedIn ? (
          <div
            role="status"
            style={{
              marginTop: 18,
              marginBottom: 4,
              padding: "10px 14px",
              borderRadius: 14,
              background: "rgba(37,99,235,0.12)",
              border: "1px solid rgba(59,130,246,0.28)",
              fontSize: 12,
              lineHeight: 1.35,
              color: "#cbd5e1",
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
              <strong style={{ color: "#e2e8f0", whiteSpace: "nowrap" }}>Resumo:</strong> o histórico ilustrativo permite comparar a estratégia DECIDE com o mercado de referência ao longo do tempo — não é garantia de resultados futuros.
            </span>
          </div>
        ) : null}

        {mounted && !loggedIn ? (
          <div
            style={{
              marginTop: 8,
              marginBottom: 2,
              padding: "8px 12px",
              borderRadius: 10,
              background: "rgba(120,53,15,0.28)",
              border: "1px solid rgba(251,191,36,0.38)",
              fontSize: 11,
              lineHeight: 1.45,
              color: "#fcd34d",
            }}
          >
            <strong>Sessão noutro endereço?</strong> Se já iniciaste sessão mas vês «página pública» e o bloco de email,
            abre o dashboard no <strong>mesmo</strong> URL que usaste no login (<code style={{ fontSize: 10 }}>localhost</code>{" "}
            <em>ou</em> <code style={{ fontSize: 10 }}>127.0.0.1</code>) — o browser guarda a sessão separadamente por
            «origem».
          </div>
        ) : null}

        {mounted && !loggedIn ? (
          <div
            style={{
              marginTop: 10,
              padding: "12px 14px",
              borderRadius: 16,
              background: "rgba(30,58,138,0.35)",
              border: "1px solid rgba(147,197,253,0.25)",
              flexShrink: 0,
            }}
          >
            <div style={{ fontSize: 14, fontWeight: 900, color: "#e0e7ff", marginBottom: 6 }}>
              Registar email no dashboard
            </div>
            <div style={{ fontSize: 12, color: "#cbd5e1", lineHeight: 1.5, marginBottom: 10 }}>
              <strong>Validação só por email</strong> — não pedimos telemóvel nem password. Processo: (1) indica o email
              abaixo; (2) recebes um link; (3) clicas no link para confirmares. Só depois disso o endereço fica registado
              para comunicações (lista de interessados, separada do registo de conta e da base formal de clientes).
            </div>
            <div style={{ fontSize: 12, color: "#94a3b8", lineHeight: 1.45, marginBottom: 10 }}>
              <strong>Não é conta cliente</strong> — para operar carteira e alertas usa{" "}
              <a href="/client/register" style={{ color: "#93c5fd", fontWeight: 800 }}>
                Registo
              </a>
              .
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
              <input
                type="email"
                value={prospectEmail}
                onChange={(e) => setProspectEmail(e.target.value)}
                placeholder="o.teu@email.com"
                autoComplete="email"
                style={{
                  flex: "1 1 220px",
                  maxWidth: 320,
                  background: "rgba(15,23,42,0.75)",
                  border: "1px solid rgba(255,255,255,0.12)",
                  borderRadius: 12,
                  padding: "10px 12px",
                  color: "#fff",
                  fontSize: 14,
                }}
              />
              <button
                type="button"
                disabled={prospectBusy}
                onClick={() => void sendProspectListVerification()}
                style={{
                  background: "#2563eb",
                  color: "#fff",
                  border: "1px solid rgba(255,255,255,0.2)",
                  borderRadius: 12,
                  padding: "10px 16px",
                  fontSize: 13,
                  fontWeight: 900,
                  cursor: prospectBusy ? "wait" : "pointer",
                  opacity: prospectBusy ? 0.8 : 1,
                }}
              >
                {prospectBusy ? "A enviar…" : "Enviar link de confirmação"}
              </button>
            </div>
            {prospectErr ? (
              <div style={{ marginTop: 10, fontSize: 12, color: "#fca5a5" }}>{prospectErr}</div>
            ) : null}
            {prospectMsg ? (
              <div style={{ marginTop: 10, fontSize: 12, color: "#86efac" }}>{prospectMsg}</div>
            ) : null}
            {prospectDevLink ? (
              <div
                style={{
                  marginTop: 12,
                  background: "rgba(37, 99, 235, 0.15)",
                  border: "1px solid rgba(147, 197, 253, 0.45)",
                  borderRadius: 14,
                  padding: 12,
                  fontSize: 12,
                  lineHeight: 1.45,
                }}
              >
                <div style={{ fontWeight: 900, color: "#93c5fd", marginBottom: 8 }}>
                  Modo desenvolvimento — email não foi enviado
                </div>
                <p style={{ margin: "0 0 12px", color: "#cbd5e1", fontSize: 12, lineHeight: 1.5 }}>
                  Não há <strong>Resend</strong> nem <strong>Gmail</strong> configurados no servidor, por isso{" "}
                  <strong>nenhuma mensagem foi enviada à caixa de entrada</strong>. O endereço abaixo é o mesmo que iria no
                  email — serve só para testes locais. Toca no botão verde para abrir <strong>no mesmo separador</strong>{" "}
                  (evita o menu «Abrir com…» no Android). Com envio real configurado, este bloco deixa de aparecer.
                </p>
                {devConfirmationLinkUsesLoopback(prospectDevLink) ? (
                  <div
                    style={{
                      marginBottom: 12,
                      padding: 10,
                      borderRadius: 10,
                      background: "rgba(127,29,29,0.35)",
                      border: "1px solid rgba(248,113,113,0.45)",
                      color: "#fecaca",
                      fontSize: 11,
                      lineHeight: 1.45,
                    }}
                  >
                    <strong>Atenção (telemóvel):</strong> este link usa <code style={{ color: "#fff" }}>127.0.0.1</code> ou{" "}
                    <code style={{ color: "#fff" }}>localhost</code> — no telemóvel isso <strong>não é o teu PC</strong> e o
                    browser mostra erro de ligação. No <code style={{ color: "#fde68a" }}>frontend/.env.local</code> define{" "}
                    <code style={{ color: "#fff" }}>EMAIL_LINK_BASE_URL=http://IP-DO-PC:4701</code>, corre{" "}
                    <code style={{ color: "#fde68a" }}>npm run dev:lan</code> e volta a pedir o link.
                  </div>
                ) : null}
                {!devConfirmationLinkUsesLoopback(prospectDevLink) && devConfirmationLinkWrongPort(prospectDevLink) ? (
                  <div
                    style={{
                      marginBottom: 12,
                      padding: 10,
                      borderRadius: 10,
                      background: "rgba(120,53,15,0.35)",
                      border: "1px solid rgba(251,191,36,0.45)",
                      color: "#fde68a",
                      fontSize: 11,
                      lineHeight: 1.45,
                    }}
                  >
                    <strong>Porta errada no link:</strong> o Next deste projeto usa a porta{" "}
                    <code style={{ color: "#fff" }}>{DECIDE_NEXT_DEV_PORT}</code> (<code style={{ color: "#fde68a" }}>npm run dev:lan</code>
                    ). Se o link mostra outra porta (ex. <strong>4000</strong>), o telemóvel abre um servidor que{" "}
                    <strong>não existe</strong> → página de erro.                     Abre o dashboard em{" "}
                    <code style={{ color: "#fff" }}>{`http://<IP-LAN>:${DECIDE_NEXT_DEV_PORT}`}</code>, volta a enviar o link, ou
                    corrige <code style={{ color: "#fff" }}>EMAIL_LINK_BASE_URL</code> para essa porta.
                  </div>
                ) : null}
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {/*
                    Sem target="_blank": no Android evita o menu «Abrir com…» (Chrome/Firefox/etc.) e mantém a navegação
                    na mesma app (email ou browser) onde o utilizador já está.
                  */}
                  <a
                    href={prospectDevLink}
                    style={{
                      display: "block",
                      textAlign: "center",
                      boxSizing: "border-box",
                      padding: "14px 18px",
                      borderRadius: 12,
                      background: "linear-gradient(180deg, #22c55e 0%, #16a34a 100%)",
                      color: "#fff",
                      fontWeight: 900,
                      fontSize: 15,
                      textDecoration: "none",
                      border: "1px solid rgba(255,255,255,0.12)",
                    }}
                  >
                    Abrir página de confirmação
                  </a>
                  <div style={{ fontSize: 10, color: "#64748b", lineHeight: 1.35, marginTop: -4 }}>
                    Abre <strong>no mesmo separador</strong> — no telemóvel não pede para escolheres outro browser.
                  </div>
                  <button
                    type="button"
                    onClick={() => void navigator.clipboard.writeText(prospectDevLink).then(() => setProspectMsg("Link copiado."))}
                    style={{
                      background: "#1d4ed8",
                      color: "#fff",
                      border: "none",
                      borderRadius: 10,
                      padding: "10px 14px",
                      fontWeight: 800,
                      cursor: "pointer",
                    }}
                  >
                    Copiar link
                  </button>
                </div>
                <div style={{ marginTop: 10, fontSize: 10, color: "#64748b", wordBreak: "break-all" }}>{prospectDevLink}</div>
              </div>
            ) : null}
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
            <strong>Confirma o email</strong> para ativares os alertas automáticos por email. Abre o link do último email que
            enviámos ou{" "}
            <a href="/client/register" style={{ color: "#fff", fontWeight: 800 }}>
              vai à página de registo
            </a>
            .
            <div style={{ marginTop: 8, fontSize: 11, color: "#fcd34d", lineHeight: 1.45 }}>
              <strong>Reenviar email de confirmação</strong> manda <em>outro</em> email com o mesmo tipo de link (útil se não
              encontraste o primeiro ou expirou). Sem clicar nesse link, o servidor continua a tratar o email como não
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
                    setVerifyBannerNote("Preenche o email na conta (registo).");
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
                        setVerifyBannerNote("Enviámos outro email. Verifica a caixa de entrada.");
                      }
                    } finally {
                      setVerifyResendBusy(false);
                    }
                  })();
                }}
                style={{
                  background: "#ca8a04",
                  color: "#0f172a",
                  border: "none",
                  borderRadius: 12,
                  padding: "8px 14px",
                  fontSize: 12,
                  fontWeight: 900,
                  cursor: verifyResendBusy ? "wait" : "pointer",
                  opacity: verifyResendBusy ? 0.75 : 1,
                }}
              >
                {verifyResendBusy ? "A enviar…" : "Reenviar email de confirmação"}
              </button>
              {verifyBannerNote ? <span style={{ fontSize: 12, color: "#fef9c3" }}>{verifyBannerNote}</span> : null}
            </div>
          </div>
        ) : null}

        {loggedIn && mounted ? (
          <div
            style={{
              marginTop: 8,
              flexShrink: 0,
              display: "flex",
              flexDirection: "column",
              alignItems: "stretch",
              gap: 8,
              width: "100%",
            }}
          >
            <div
              style={{
                display: "flex",
                flexDirection: "row",
                flexWrap: "wrap",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
                width: "100%",
              }}
            >
              <div
                role="status"
                style={{
                  margin: 0,
                  padding: "10px 14px",
                  borderRadius: 14,
                  background: "rgba(37,99,235,0.12)",
                  border: "1px solid rgba(59,130,246,0.28)",
                  fontSize: 12,
                  lineHeight: 1.35,
                  color: "#cbd5e1",
                  flex: "1 1 200px",
                  minWidth: 0,
                  maxWidth: "100%",
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
                  <strong style={{ color: "#e2e8f0", whiteSpace: "nowrap" }}>Resumo:</strong> o histórico ilustrativo permite comparar a estratégia DECIDE com o mercado de referência ao longo do tempo — não é garantia de resultados futuros.
                </span>
              </div>
              <div style={{ flex: "0 0 auto", display: "flex", alignItems: "center", justifyContent: "flex-end" }}>
                {portfolioScheduleUi.actionRequired ? (
                  <button
                    type="button"
                    onClick={openPortfolioRecommendationsPanel}
                    style={{
                      width: "auto",
                      maxWidth: "min(100%, 320px)",
                      boxSizing: "border-box",
                      padding: "8px 16px",
                      borderRadius: 12,
                      border: "2px solid rgba(249,115,22,0.9)",
                      background: "linear-gradient(180deg, #fb923c 0%, #ea580c 100%)",
                      color: "#0f172a",
                      fontSize: 13,
                      fontWeight: 900,
                      fontFamily: "inherit",
                      lineHeight: 1.25,
                      textAlign: "center",
                      cursor: "pointer",
                      animation: "decidePortfolioPulse 2.2s ease-in-out infinite",
                    }}
                  >
                    {!portfolioScheduleUi.hasOnboarding
                      ? "Ver o que fazer agora (constituir carteira)"
                      : "Ver o que fazer agora (revisão mensal)"}
                  </button>
                ) : (
                  <div
                    role="status"
                    style={{
                      maxWidth: "min(100%, 380px)",
                      padding: "6px 12px",
                      borderRadius: 10,
                      background: "rgba(30, 41, 59, 0.92)",
                      border: "1px solid rgba(148, 163, 184, 0.5)",
                      boxShadow: "0 1px 0 rgba(255,255,255,0.06) inset",
                      color: "#f1f5f9",
                      fontSize: 12,
                      fontWeight: 800,
                      fontFamily: "inherit",
                      lineHeight: 1.35,
                      textAlign: "right",
                    }}
                  >
                    Sem ação urgente — próxima revisão:{" "}
                    <span style={{ color: "#bae6fd", fontWeight: 900 }}>
                      {portfolioScheduleUi.nextReviewPt || "—"}
                    </span>
                  </div>
                )}
              </div>
            </div>
            {preadviceMsg ? (
              <div
                style={{
                  fontSize: 12,
                  color: preadviceMsg.includes("desligados") || preadviceMsg.includes("Não foi") || preadviceMsg.includes("Sem ligação")
                    ? "#fca5a5"
                    : "#94a3b8",
                  lineHeight: 1.4,
                }}
              >
                {preadviceMsg}
              </div>
            ) : null}
          </div>
        ) : null}

        <div
          style={{
            marginTop: 10,
            width: "100%",
          }}
        >
          {loggedIn ? (
            <div
              style={{
                background: "#12244d",
                border: "1px solid rgba(255,255,255,0.08)",
                borderRadius: 16,
                padding: "10px 12px 12px",
                display: "flex",
                flexDirection: "column",
                gap: 8,
              }}
            >
              <details
                style={{
                  borderRadius: 12,
                  background: "rgba(15,23,42,0.45)",
                  border: "1px solid rgba(147,197,253,0.22)",
                }}
              >
                <summary
                  style={{
                    padding: "8px 10px",
                    fontSize: 12,
                    fontWeight: 900,
                    color: "#93c5fd",
                    cursor: "pointer",
                    listStyle: "none",
                  }}
                >
                  Recomendações de carteira (expandir)
                </summary>
                <div style={{ padding: "0 10px 10px" }}>
                <div style={{ fontSize: 11, color: "#cbd5e1", lineHeight: 1.45, marginBottom: 10 }}>
                  {portfolioScheduleUi.ruleSummary} Usa o separador <strong>Carteira</strong> no painel abaixo para a
                  composição sugerida.
                </div>
                {latestModelMonth &&
                typeof latestModelMonth.tbillsTotalPct === "number" &&
                isFinite(latestModelMonth.tbillsTotalPct) ? (
                  <div
                    style={{
                      marginBottom: 12,
                      padding: "10px 12px",
                      borderRadius: 12,
                      background: "rgba(14, 165, 233, 0.12)",
                      border: "1px solid rgba(56, 189, 248, 0.35)",
                      fontSize: 12,
                      lineHeight: 1.5,
                      color: "#e0f2fe",
                    }}
                  >
                    <strong style={{ color: "#7dd3fc" }}>Carteira modelo (última data)</strong>{" "}
                    <span style={{ color: "#94a3b8" }}>({formatPtDate(latestModelMonth.date)})</span>
                    <div style={{ marginTop: 6 }}>
                      <span style={{ fontWeight: 900, color: "#38bdf8" }}>
                        T-Bills {latestModelMonth.tbillsTotalPct.toFixed(1)}%
                      </span>
                      {typeof latestModelMonth.equitySleeveTotalPct === "number" &&
                      isFinite(latestModelMonth.equitySleeveTotalPct) ? (
                        <span style={{ fontWeight: 700, color: "#cbd5e1" }}>
                          {" "}
                          · Ações {latestModelMonth.equitySleeveTotalPct.toFixed(1)}%
                        </span>
                      ) : null}
                    </div>
                  </div>
                ) : null}
                <div style={{ marginBottom: 10, display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                  <span style={{ fontSize: 11, color: "#94a3b8", fontWeight: 700 }}>Telemóvel (conta)</span>
                  <input
                    type="tel"
                    placeholder="+351912345678"
                    value={notifyPhoneInput}
                    onChange={(e) => setNotifyPhoneInput(e.target.value)}
                    onBlur={() => {
                      if (!sessionUser) return;
                      const em = getCurrentSessionUserEmail();
                      if (!em) return;
                      const r = updateClientContact(em, notifyPhoneInput);
                      if (r.ok) setPortfolioScheduleRev((n) => n + 1);
                    }}
                    style={{
                      flex: "1 1 200px",
                      maxWidth: 280,
                      background: "rgba(15,23,42,0.6)",
                      border: "1px solid rgba(255,255,255,0.12)",
                      borderRadius: 10,
                      padding: "6px 10px",
                      color: "#fff",
                      fontSize: 12,
                    }}
                  />
                  <span style={{ fontSize: 10, color: "#64748b" }}>
                    Email na conta: {getCurrentSessionUserEmail() || "—"} · ao sair do campo, grava email+telemóvel
                  </span>
                </div>
                {!portfolioScheduleUi.hasOnboarding ? (
                  <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
                    <span style={{ fontSize: 11, color: "#94a3b8" }}>
                      Ainda não marcaste a <strong>constituição inicial</strong>. Faz-o no dia em que começares a operar.
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        if (!sessionUser) return;
                        setOnboardingSnapshotNow(sessionUser, profile);
                        setPortfolioScheduleRev((n) => n + 1);
                      }}
                      style={{
                        background: "#2563eb",
                        color: "#fff",
                        border: "1px solid rgba(255,255,255,0.2)",
                        borderRadius: 12,
                        padding: "8px 14px",
                        fontSize: 12,
                        fontWeight: 800,
                        cursor: "pointer",
                      }}
                    >
                      Marcar constituição inicial (hoje)
                    </button>
                  </div>
                ) : (
                  <div style={{ fontSize: 12, color: "#e2e8f0", lineHeight: 1.55 }}>
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
                          background: "rgba(34,197,94,0.15)",
                          border: "1px solid rgba(34,197,94,0.45)",
                          color: "#bbf7d0",
                          fontSize: 11,
                          fontWeight: 700,
                        }}
                      >
                        Hoje coincide com o dia de revisão mensal — consulta a carteira recomendada no iframe e ajusta
                        encomendas conforme o teu perfil ({profile}).
                      </div>
                    ) : null}
                    <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                      <button
                        type="button"
                        onClick={() => {
                          if (!sessionUser) return;
                          acknowledgeMonthlyReview(sessionUser);
                          setPortfolioScheduleRev((n) => n + 1);
                        }}
                        style={{
                          background: "transparent",
                          color: "#93c5fd",
                          border: "1px solid rgba(147,197,253,0.4)",
                          borderRadius: 10,
                          padding: "6px 12px",
                          fontSize: 11,
                          fontWeight: 700,
                          cursor: "pointer",
                        }}
                      >
                        Confirmar revisão mensal aplicada / lida
                      </button>
                      <span style={{ fontSize: 10, color: "#64748b" }}>
                        (Registo opcional; não altera as datas do ciclo global.)
                      </span>
                    </div>
                  </div>
                )}
                </div>
              </details>
            </div>
          ) : null}

          {mounted ? (
            <div
              style={{
                background: "#12244d",
                border: "1px solid rgba(255,255,255,0.08)",
                borderRadius: 16,
                padding: "10px 12px 12px",
                display: "flex",
                flexDirection: "column",
                gap: 8,
                marginTop: loggedIn ? 10 : 0,
              }}
            >
              <div style={{ marginBottom: 10, flexShrink: 0, textAlign: "center", width: "100%" }}>
                <div style={{ fontSize: 15, fontWeight: 900, color: "#f8fafc", letterSpacing: "-0.02em" }}>
                  Simule o seu capital
                </div>
                <div
                  style={{
                    color: "#94a3b8",
                    marginTop: 4,
                    fontSize: 12,
                    lineHeight: 1.45,
                    maxWidth: 520,
                    marginLeft: "auto",
                    marginRight: "auto",
                  }}
                >
                  Um único foco: quanto o histórico ilustrativo sugere para o seu perfil e volatilidade alvo.
                </div>
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 12,
                    marginTop: 14,
                  }}
                >
                  <label
                    htmlFor="client-dash-profile"
                    style={{ color: "#b7c3e0", fontSize: 14, fontWeight: 800, letterSpacing: "0.02em" }}
                  >
                    Perfil de risco
                  </label>
                  <select
                    id="client-dash-profile"
                    value={profile}
                    onChange={(e) => setProfile(e.target.value as any)}
                    style={{
                      background: "rgba(15,23,42,0.75)",
                      color: "#fff",
                      border: "1px solid rgba(255,255,255,0.2)",
                      borderRadius: 14,
                      padding: "12px 18px",
                      fontWeight: 900,
                      fontSize: 16,
                      minWidth: 220,
                      cursor: "pointer",
                      boxShadow: "0 1px 0 rgba(255,255,255,0.06) inset",
                    }}
                  >
                    <option value="conservador">Conservador</option>
                    <option value="moderado">Moderado</option>
                    <option value="dinamico">Dinâmico</option>
                  </select>
                  <button
                    type="button"
                    onClick={refreshKpiIframe}
                    title="Recarregar a análise no ecrã"
                    style={{
                      background: "#1e4a8c",
                      color: "#e2e8f0",
                      border: "1px solid rgba(255,255,255,0.22)",
                      borderRadius: 12,
                      padding: "10px 16px",
                      fontSize: 13,
                      fontWeight: 800,
                      cursor: "pointer",
                    }}
                  >
                    Atualizar
                  </button>
                </div>
              </div>

              {errMsg ? (
                <div
                  style={{
                    marginBottom: 8,
                    background: "#2a0f12",
                    border: "1px solid #7f1d1d",
                    borderRadius: 12,
                    padding: 10,
                    fontSize: 13,
                    flexShrink: 0,
                  }}
                >
                  <b>Erro:</b> {errMsg}
                </div>
              ) : null}

              {/*
                Altura ~viewport: gráficos no Flask (modo embed) em grelha 2×2 compacta; evita iframe de 3600px.
              */}
              <iframe
                ref={kpiIframeRef}
                src={flaskCap15Url}
                title="KPIs DECIDE (Flask)"
                allowFullScreen
                style={{
                  width: "100%",
                  display: "block",
                  minHeight: 720,
                  height: "min(1240px, calc(100vh - 220px))",
                  border: 0,
                  borderRadius: 12,
                  background: "#020b24",
                }}
                sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-downloads"
              />
            </div>
          ) : null}
        </div>

        {mounted && !loggedIn ? (
          <div
            style={{
              marginTop: 12,
              flexShrink: 0,
              background: "rgba(15,23,42,0.55)",
              border: "1px solid rgba(148,163,184,0.2)",
              borderRadius: 16,
              padding: "12px 14px",
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 800, color: "#e2e8f0" }}>Funcionalidades com conta</div>
            <div style={{ color: "#94a3b8", marginTop: 6, fontSize: 12, lineHeight: 1.45 }}>
              A análise acima é pública. Com{" "}
              <a href="/client/login" style={{ color: "#93c5fd", fontWeight: 800 }}>
                login
              </a>{" "}
              ou{" "}
              <a href="/client/register" style={{ color: "#93c5fd", fontWeight: 800 }}>
                registo
              </a>{" "}
              podes receber alertas, gerir revisões de carteira e gravar contactos.
            </div>
          </div>
        ) : null}
      </div>
    </>
  );
}

