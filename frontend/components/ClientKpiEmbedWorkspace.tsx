import {
  Fragment,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import type { LucideIcon } from "lucide-react";
import {
  AreaChart,
  BookOpen,
  Calculator,
  Coins,
  HelpCircle,
  History,
  Layers,
  LayoutGrid,
  LineChart,
  Mail,
  MessageCircleQuestion,
  Scale,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  TrendingUp,
  Wallet,
} from "lucide-react";
import DecideHelpAssistantPanel from "./DecideHelpAssistantPanel";
import FiscalidadePanelBody from "./FiscalidadePanelBody";
import {
  DECIDE_CONTACTS_COPY_AFTER_EMAIL,
  DECIDE_CONTACTS_COPY_BEFORE_EMAIL,
  DECIDE_SUPPORT_EMAIL,
} from "../lib/decideSupportContact";
import { DECIDE_CAGR_INCLUDES_MARKET_COSTS_PT } from "../lib/modelRobustnessCopy";
import {
  type KpiEmbedNavSection,
  FLASK_KPI_EMBED_TABS,
  KPI_EMBED_NAV_PRIMARY_SECTIONS_CARTEIRA,
  KPI_EMBED_NAV_PRIMARY_SECTIONS_DASHBOARD,
  KPI_EMBED_NAV_SECONDARY_SECTIONS,
  KPI_EMBED_TABS_RECOMMENDED_BLOCK,
  isKpiNavSectionActive,
  normalizeKpiEmbedTabId,
} from "../lib/kpiEmbedNav";
import ClientModelRobustnessNotice from "./ClientModelRobustnessNotice";
import ClientPlanDecisionBridge from "./ClientPlanDecisionBridge";
import DecideRecommendedPlanCta from "./DecideRecommendedPlanCta";
import CarteiraActualIbkrPanel from "./CarteiraActualIbkrPanel";
import InlineLoadingDots from "./InlineLoadingDots";
import KpiFlaskConnectivityBanner from "./KpiFlaskConnectivityBanner";

const SIDEBAR_SECTION_ICONS: Record<string, LucideIcon> = {
  kpis: LayoutGrid,
  charts: LineChart,
  sim: SlidersHorizontal,
  portfolio_now: Wallet,
  portfolio_hist: History,
  fees: Coins,
  fiscal: Scale,
  help: HelpCircle,
  model_robustness: ShieldCheck,
};

const EMBED_SUB_TAB_ICONS: Record<string, LucideIcon> = {
  overview: LayoutGrid,
  horizons: TrendingUp,
  charts: AreaChart,
  portfolio: Wallet,
  portfolio_history: History,
  fees_intro: BookOpen,
  fees: Calculator,
  faq: MessageCircleQuestion,
  help_assistant: Sparkles,
  help_contacts: Mail,
};

const SIDEBAR_ICON_SIZE = 12;
const SIDEBAR_NESTED_ICON_SIZE = 12;
const SIDEBAR_NESTED_ICON_STROKE = 1.85;

export type ClientKpiEmbedWorkspaceProps = {
  /**
   * `dashboard`: sub-menu local = KPIs / Gráficos / Simulação (sem Carteira IBKR — isso é a página Carteira no topo).
   * `carteira`: sub-menu local = Carteira actual / Histórico (+ Custos / Fiscalidade / Ajuda).
   */
  workspaceVariant?: "dashboard" | "carteira";
  /** Perfil de risco (mesmo que o iframe Flask) — CAGR do cartão recomendado = Modelo CAP15 (`/api/embed-plafonado-cagr`). */
  riskProfile?: "conservador" | "moderado" | "dinamico";
  /** Versão do modelo para KPI card no dashboard (rollout controlado). */
  modelVersion?: "official_v6" | "v7_dynamic_light" | "v7_dynamic_medium";
  kpiEmbedTab: string;
  applyKpiEmbedTab: (id: string) => void;
  kpiViewMode: "simple" | "advanced";
  setKpiViewMode: (m: "simple" | "advanced") => void;
  kpiIframeSrc: string;
  kpiIframeRef: RefObject<HTMLIFrameElement | null>;
  /**
   * Conteúdo opcional no topo da coluna principal (ex.: resumo IBKR na página Carteira).
   * Fica à direita da sidebar — não empurra o sub-menu para baixo.
   */
  mainTopSlot?: ReactNode;
  /**
   * `navLinked` — sub-menu à esquerda no shell Next (fora do iframe), faixa superior alinhada ao menu principal;
   * só a coluna direita (resumo + iframe) fica em cartão.
   */
  chrome?: "default" | "navLinked";
  /**
   * Só na coluna direita (ex.: Perfil + Atualizar no dashboard), por baixo do hedge e ao lado da sidebar —
   * evita empurrar o sub-menu para baixo.
   */
  mainHeaderSlot?: ReactNode;
  /** Só `workspaceVariant="carteira"`: sincronizar reload do painel de posições IBKR com «Atualizar recomendação». */
  carteiraIbkrRefreshToken?: number;
  /** Chamado quando o iframe Flask fica visível após carregar (ex.: para desligar estado «busy» no botão de refresh). */
  onKpiIframeReady?: () => void;
  /** Bump (ex. `iframeRefresh` do dashboard) para repetir o teste de saúde ao Flask em `/api/health`. */
  kpiConnectivityBump?: number;
};

/** Sub-tabs da secção na coluna esquerda — faixa azul à esquerda quando activo (`globals.css`). */
function renderSidebarNestedGreenTabs(
  section: KpiEmbedNavSection,
  kpiEmbedTab: string,
  applyKpiEmbedTab: (id: string) => void,
) {
  if (section.tabs.length <= 1) return null;
  if (!isKpiNavSectionActive(section, kpiEmbedTab)) return null;
  return (
    <div className="decide-app-kpi-sidebar-nested" role="tablist" aria-label={section.label}>
      {section.tabs.map((st) => {
        const subOn = normalizeKpiEmbedTabId(kpiEmbedTab) === normalizeKpiEmbedTabId(st.id);
        const SubIcon = EMBED_SUB_TAB_ICONS[st.id];
        return (
          <button
            key={st.id}
            type="button"
            role="tab"
            className="decide-app-kpi-sidebar-nested-btn decide-app-kpi-sidebar-nested-btn--green"
            data-active={subOn ? "true" : "false"}
            aria-selected={subOn}
            onClick={() => applyKpiEmbedTab(st.id)}
          >
            {SubIcon ? (
              <SubIcon
                className="decide-app-kpi-sidebar-nested-icon"
                width={SIDEBAR_NESTED_ICON_SIZE}
                height={SIDEBAR_NESTED_ICON_SIZE}
                strokeWidth={SIDEBAR_NESTED_ICON_STROKE}
                aria-hidden
              />
            ) : null}
            <span className="decide-app-kpi-sidebar-nested-label">{st.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function renderSidebarSectionButtons(
  sections: KpiEmbedNavSection[],
  kpiEmbedTab: string,
  applyKpiEmbedTab: (id: string) => void,
) {
  return sections.map((section) => {
    const active = isKpiNavSectionActive(section, kpiEmbedTab);
    const first = section.tabs[0];
    if (!first) return null;
    const Icon = SIDEBAR_SECTION_ICONS[section.id];
    return (
      <button
        key={section.id}
        type="button"
        className="decide-app-kpi-sidebar-primary"
        data-active={active ? "true" : "false"}
        aria-current={active ? "true" : undefined}
        onClick={() => applyKpiEmbedTab(first.id)}
      >
        {Icon ? (
          <Icon
            className="decide-app-kpi-sidebar-icon"
            width={SIDEBAR_ICON_SIZE}
            height={SIDEBAR_ICON_SIZE}
            strokeWidth={1.75}
            aria-hidden
          />
        ) : null}
        <span className="decide-app-kpi-sidebar-label">{section.label}</span>
      </button>
    );
  });
}

const KPI_EMBED_LOAD_MIN_MS = 500;
/** Depois do evento `load` do iframe, o Flask ainda pode mostrar um ecrã cinzento / ícone — manter o nosso overlay mais um pouco. */
const KPI_EMBED_POST_LOAD_HOLD_MS = 1100;
const KPI_EMBED_POST_LOAD_HOLD_FEES_MS = 500;
const KPI_EMBED_SLOW_HINT_MS = 8000;
/** Se o `load` do iframe nunca concluir (Flask parado, rede, ou página presa). */
/** Primeira carga do `kpi_server.py` (pandas/plotly) pode demorar >40s em discos lentos / antivírus. */
const KPI_EMBED_IFRAME_MAX_WAIT_MS = 120_000;

function withIframeRetryParam(raw: string, retryNonce: number): string {
  if (!raw || retryNonce <= 0) return raw;
  const origin =
    typeof window !== "undefined" ? window.location.origin : "http://localhost";
  try {
    const u =
      raw.startsWith("http://") || raw.startsWith("https://")
        ? new URL(raw)
        : new URL(raw, origin);
    u.searchParams.set("_decide_retry", String(retryNonce));
    if (raw.startsWith("http://") || raw.startsWith("https://")) {
      return u.toString();
    }
    return `${u.pathname}${u.search}${u.hash}`;
  } catch {
    const sep = raw.includes("?") ? "&" : "?";
    return `${raw}${sep}_decide_retry=${encodeURIComponent(String(retryNonce))}`;
  }
}

function KpiEmbedIframe({
  tab,
  portfolioHistoryMode = false,
  src,
  iframeRef,
  onReady,
}: {
  tab: string;
  /** Histórico embebido: sem dicas técnicas (portas, npm) durante o carregamento — vista demo. */
  portfolioHistoryMode?: boolean;
  src: string;
  iframeRef: RefObject<HTMLIFrameElement | null>;
  onReady?: () => void;
}) {
  const [loaded, setLoaded] = useState(false);
  const [slowHint, setSlowHint] = useState(false);
  const [loadTimedOut, setLoadTimedOut] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);
  const loadStartedAtRef = useRef(0);
  const revealTimerRef = useRef<number | undefined>(undefined);
  const maxWaitTimerRef = useRef<number | undefined>(undefined);
  const loadGenRef = useRef(0);
  const isFees = tab === "fees_intro" || tab === "fees";
  const iframeSrcEffective = withIframeRetryParam(src, retryNonce);

  useEffect(() => {
    loadGenRef.current += 1;
    const gen = loadGenRef.current;
    setLoaded(false);
    setSlowHint(false);
    setLoadTimedOut(false);
    loadStartedAtRef.current = Date.now();
    if (revealTimerRef.current != null) {
      window.clearTimeout(revealTimerRef.current);
      revealTimerRef.current = undefined;
    }
    if (maxWaitTimerRef.current != null) {
      window.clearTimeout(maxWaitTimerRef.current);
      maxWaitTimerRef.current = undefined;
    }
    const tSlow = window.setTimeout(() => {
      if (loadGenRef.current === gen) setSlowHint(true);
    }, KPI_EMBED_SLOW_HINT_MS);
    maxWaitTimerRef.current = window.setTimeout(() => {
      maxWaitTimerRef.current = undefined;
      if (loadGenRef.current === gen) setLoadTimedOut(true);
    }, KPI_EMBED_IFRAME_MAX_WAIT_MS);
    return () => {
      window.clearTimeout(tSlow);
      if (maxWaitTimerRef.current != null) {
        window.clearTimeout(maxWaitTimerRef.current);
        maxWaitTimerRef.current = undefined;
      }
      if (revealTimerRef.current != null) window.clearTimeout(revealTimerRef.current);
    };
  }, [src, tab, retryNonce]);

  const loadingTitle = isFees ? "A carregar simulador de custos" : "A carregar indicadores (serviço KPI)";

  return (
    <div className="decide-app-kpi-iframe-scale-wrap">
      {!loaded ? (
        <div className="decide-app-kpi-iframe-loading" aria-busy="true" aria-live="polite">
          <div className="decide-app-kpi-iframe-loading-visual" aria-hidden />
          <p className="decide-app-kpi-iframe-loading-title">
            {loadingTitle}
            <InlineLoadingDots minWidth="1.35em" />
          </p>
          <p className="decide-app-kpi-iframe-loading-sub">
            Aguarde — após o primeiro pedido, o simulador ainda pode preparar o ecrã durante mais um instante.
          </p>
          {slowHint ? (
            <p className="decide-app-kpi-iframe-loading-hint">
              {portfolioHistoryMode ? (
                <>A carregar o histórico de decisões — pode demorar um momento na primeira vez.</>
              ) : (
                <>
                  Se o ecrã ficar vazio, confirme que o <strong>Flask KPI</strong> está a correr em{" "}
                  <code>127.0.0.1:5000</code> (ex. <code>npm run kpi</code> na pasta <code>backend</code>). Em dev o Next
                  encaminha <code>/kpi-flask</code> para esse serviço.
                </>
              )}
            </p>
          ) : null}
        </div>
      ) : null}
      {loadTimedOut ? (
        <div
          className="decide-app-kpi-iframe-stuck-overlay"
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 6,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 14,
            padding: 24,
            textAlign: "center",
            background: "linear-gradient(180deg, rgba(24,24,27,0.97) 0%, rgba(12,12,14,0.98) 100%)",
            border: "1px solid rgba(248,113,113,0.35)",
          }}
        >
          <p style={{ margin: 0, maxWidth: 400, fontSize: 14, lineHeight: 1.55, color: "#fecaca" }}>
            {portfolioHistoryMode ? (
              <>
                O histórico não terminou de carregar a tempo. Tente recarregar o painel ou volte mais tarde.
              </>
            ) : (
              <>
                O simulador não terminou de carregar a tempo. Em dev confirme{" "}
                <code style={{ color: "#e2e8f0" }}>npm run kpi</code> (Flask em{" "}
                <code style={{ color: "#e2e8f0" }}>127.0.0.1:5000</code>) e que o Next encaminha{" "}
                <code style={{ color: "#e2e8f0" }}>/kpi-flask</code> para aí.
              </>
            )}
          </p>
          <button
            type="button"
            onClick={() => {
              setLoadTimedOut(false);
              setRetryNonce((n) => n + 1);
            }}
            style={{
              padding: "10px 18px",
              borderRadius: 10,
              fontWeight: 700,
              fontSize: 13,
              cursor: "pointer",
              border: "1px solid rgba(94, 234, 212, 0.45)",
              background: "rgba(6, 78, 74, 0.45)",
              color: "#ccfbf1",
            }}
          >
            Tentar recarregar o painel
          </button>
        </div>
      ) : null}
      <iframe
        key={`kpi-${tab}-${iframeSrcEffective}`}
        ref={iframeRef as RefObject<HTMLIFrameElement>}
        src={iframeSrcEffective}
        loading="eager"
        title={isFees ? "Custos DECIDE" : "KPIs DECIDE (Flask)"}
        allowFullScreen
        className={`decide-app-kpi-iframe${loaded ? " decide-app-kpi-iframe--visible" : ""}`}
        onLoad={() => {
          const genAtFire = loadGenRef.current;
          const elapsed = Date.now() - loadStartedAtRef.current;
          const postHold = isFees ? KPI_EMBED_POST_LOAD_HOLD_FEES_MS : KPI_EMBED_POST_LOAD_HOLD_MS;
          const wait = Math.max(0, KPI_EMBED_LOAD_MIN_MS - elapsed) + postHold;
          if (revealTimerRef.current != null) window.clearTimeout(revealTimerRef.current);
          revealTimerRef.current = window.setTimeout(() => {
            revealTimerRef.current = undefined;
            if (loadGenRef.current === genAtFire) {
              if (maxWaitTimerRef.current != null) {
                window.clearTimeout(maxWaitTimerRef.current);
                maxWaitTimerRef.current = undefined;
              }
              setLoadTimedOut(false);
              setLoaded(true);
              onReady?.();
              try {
                const w = iframeRef.current?.contentWindow;
                if (w && !isFees) {
                  w.postMessage({ type: "decide-kpi-layout-stable" }, "*");
                  window.requestAnimationFrame(() => {
                    try {
                      w.postMessage({ type: "decide-kpi-layout-stable" }, "*");
                    } catch {
                      /* ignore */
                    }
                  });
                }
              } catch {
                /* ignore */
              }
            }
          }, wait);
        }}
        {...(isFees
          ? {}
          : {
              sandbox:
                "allow-scripts allow-same-origin allow-forms allow-popups allow-downloads allow-top-navigation-by-user-activation",
            })}
      />
    </div>
  );
}

/**
 * Nível 2: sidebar esquerda em dois grupos (análise | informação) + painel à direita.
 */
export default function ClientKpiEmbedWorkspace({
  workspaceVariant = "dashboard",
  riskProfile = "moderado",
  modelVersion = "official_v6",
  kpiEmbedTab,
  applyKpiEmbedTab,
  kpiViewMode,
  setKpiViewMode,
  kpiIframeSrc,
  kpiIframeRef,
  mainTopSlot,
  chrome = "default",
  mainHeaderSlot,
  carteiraIbkrRefreshToken = 0,
  onKpiIframeReady,
  kpiConnectivityBump = 0,
}: ClientKpiEmbedWorkspaceProps) {
  const tab = normalizeKpiEmbedTabId(kpiEmbedTab);
  const showCarteiraActualIbkr = workspaceVariant === "carteira" && tab === "portfolio";
  const navLinked = chrome === "navLinked";
  const primaryNavSections =
    workspaceVariant === "carteira"
      ? KPI_EMBED_NAV_PRIMARY_SECTIONS_CARTEIRA
      : KPI_EMBED_NAV_PRIMARY_SECTIONS_DASHBOARD;
  const onDashboardRobustnessPanel = workspaceVariant === "dashboard" && tab === "model_robustness";
  const showRecommendedBlock =
    workspaceVariant === "dashboard" &&
    Boolean(kpiIframeSrc) &&
    KPI_EMBED_TABS_RECOMMENDED_BLOCK.has(tab);
  const showPlanBridgeAboveCta =
    workspaceVariant === "dashboard" &&
    Boolean(kpiIframeSrc) &&
    KPI_EMBED_TABS_RECOMMENDED_BLOCK.has(tab);

  const showCagrCostsCallout =
    workspaceVariant === "dashboard" &&
    Boolean(kpiIframeSrc) &&
    FLASK_KPI_EMBED_TABS.has(tab) &&
    tab !== "faq";

  const layoutClass = [
    "decide-app-kpi-workspace-layout",
    navLinked ? "decide-app-kpi-workspace-layout--nav-linked" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const asideClass = [
    "decide-app-kpi-sidebar",
    "decide-app-kpi-sidebar--with-secondary-at-footer",
    navLinked ? "decide-app-kpi-sidebar--nav-linked" : "",
    navLinked ? "decide-app-kpi-sidebar--sticky" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const feesEmbedActive =
    Boolean(kpiIframeSrc) && (tab === "fees_intro" || tab === "fees");
  const portfolioHistoryEmbed =
    tab === "portfolio_history" ||
    (Boolean(kpiIframeSrc) && String(kpiIframeSrc).includes("embed_tab=portfolio_history"));
  const embedPanelClass = [
    "decide-app-embed-panel",
    feesEmbedActive ? "decide-app-embed-panel--fees-embed" : "",
    portfolioHistoryEmbed ? "decide-app-embed-panel--portfolio-history" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const mainColumn = (
    <>
      {mainTopSlot ? <div className="decide-app-kpi-main-top-slot">{mainTopSlot}</div> : null}
      {onDashboardRobustnessPanel ? (
        <div className="decide-app-kpi-robustness-panel">
          <ClientModelRobustnessNotice riskProfile={riskProfile} />
        </div>
      ) : showPlanBridgeAboveCta ? (
        <ClientPlanDecisionBridge profile={riskProfile} />
      ) : null}
      {showCagrCostsCallout ? (
        <div className="decide-app-cagr-costs-callout" role="note">
          {DECIDE_CAGR_INCLUDES_MARKET_COSTS_PT}
        </div>
      ) : null}
      {showRecommendedBlock ? (
        <DecideRecommendedPlanCta riskProfile={riskProfile} modelVersion={modelVersion} />
      ) : null}

      {!onDashboardRobustnessPanel &&
      FLASK_KPI_EMBED_TABS.has(tab) &&
      kpiIframeSrc &&
      !portfolioHistoryEmbed ? (
        <KpiFlaskConnectivityBanner bump={kpiConnectivityBump} />
      ) : null}

      {onDashboardRobustnessPanel ? null : (
      <div className={embedPanelClass}>
        {showCarteiraActualIbkr ? (
          <CarteiraActualIbkrPanel refreshToken={carteiraIbkrRefreshToken} />
        ) : tab === "fiscal" ? (
          <div className="decide-app-embed-panel-inner decide-app-embed-panel-inner--prose">
            <p className="decide-app-muted-label">Fiscalidade</p>
            <h2 className="decide-app-panel-title">Fiscalidade (UE e Reino Unido)</h2>
            <FiscalidadePanelBody />
          </div>
        ) : tab === "help_contacts" ? (
          <div className="decide-app-embed-panel-inner decide-app-embed-panel-inner--center">
            <p className="decide-app-contact-line">
              {DECIDE_CONTACTS_COPY_BEFORE_EMAIL}
              <a className="decide-app-link" href={`mailto:${DECIDE_SUPPORT_EMAIL}`}>
                {DECIDE_SUPPORT_EMAIL}
              </a>
              {DECIDE_CONTACTS_COPY_AFTER_EMAIL}
            </p>
          </div>
        ) : tab === "help_assistant" ? (
          <DecideHelpAssistantPanel />
        ) : kpiIframeSrc ? (
          <KpiEmbedIframe
            tab={tab}
            portfolioHistoryMode={portfolioHistoryEmbed}
            src={kpiIframeSrc}
            iframeRef={kpiIframeRef}
            onReady={onKpiIframeReady}
          />
        ) : (
          <div className="decide-app-embed-panel-inner decide-app-embed-fallback">
            <div className="decide-app-panel-title">Simulador (KPI) não configurado</div>
            <p>
              O painel usa um serviço <strong>Flask</strong> separado. Em localhost:{" "}
              <code>127.0.0.1:5000</code>. Em produção defina <code>NEXT_PUBLIC_KPI_EMBED_BASE</code>.
            </p>
            <p className="decide-app-hint-muted">
              Custos e contactos não dependem do Flask. Assistente: <code>OPENAI_API_KEY</code> no servidor.
            </p>
          </div>
        )}
      </div>
      )}

      {!onDashboardRobustnessPanel &&
      FLASK_KPI_EMBED_TABS.has(tab) &&
      kpiIframeSrc &&
      !portfolioHistoryEmbed ? (
        <p className="decide-app-flask-hint">
          <strong>Not Found</strong> no iframe? Confirme <code>NEXT_PUBLIC_KPI_EMBED_BASE</code> como raiz do Flask (sem
          <code>/api</code>) e redeploy.
        </p>
      ) : null}
    </>
  );

  const sidebarInner = (
    <>
        <div className="decide-app-kpi-sidebar-group decide-app-kpi-sidebar-group--primary">
          <nav
            className="decide-app-kpi-sidebar-block"
            aria-label={workspaceVariant === "carteira" ? "Carteira IBKR" : "Análise e simulador"}
          >
            {primaryNavSections.map((section) => {
              const kpiSectionActive =
                section.id === "kpis" && isKpiNavSectionActive(section, kpiEmbedTab);
              return (
              <Fragment key={section.id}>
                {renderSidebarSectionButtons([section], kpiEmbedTab, applyKpiEmbedTab)}
                {workspaceVariant === "dashboard" && section.id === "kpis" && kpiSectionActive ? (
                  <div
                    className="decide-app-kpi-sidebar-nested"
                    role="tablist"
                    aria-label="Vista do simulador"
                  >
                    {(["simple", "advanced"] as const).map((mode) => {
                      const KpiIcon = mode === "simple" ? LayoutGrid : Layers;
                      const on = kpiViewMode === mode;
                      const showBlueActive = on && kpiSectionActive;
                      return (
                        <button
                          key={mode}
                          type="button"
                          role="tab"
                          className="decide-app-kpi-sidebar-nested-btn decide-app-kpi-sidebar-nested-btn--blue"
                          data-active={showBlueActive ? "true" : "false"}
                          aria-selected={showBlueActive}
                          aria-label={mode === "simple" ? "Vista KPI simples" : "Vista KPI avançada"}
                          onClick={() => {
                            setKpiViewMode(mode);
                            try {
                              localStorage.setItem("decide_kpi_view_v1", mode);
                            } catch {
                              /* ignore */
                            }
                          }}
                        >
                          <KpiIcon
                            className="decide-app-kpi-sidebar-nested-icon"
                            width={SIDEBAR_NESTED_ICON_SIZE}
                            height={SIDEBAR_NESTED_ICON_SIZE}
                            strokeWidth={SIDEBAR_NESTED_ICON_STROKE}
                            aria-hidden
                          />
                          <span className="decide-app-kpi-sidebar-nested-label">
                            {mode === "simple" ? "Simples" : "Avançado"}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ) : null}
                {renderSidebarNestedGreenTabs(section, kpiEmbedTab, applyKpiEmbedTab)}
              </Fragment>
              );
            })}
          </nav>
        </div>
        <div className="decide-app-kpi-sidebar-spacer" aria-hidden />
        <div className="decide-app-kpi-sidebar-sep decide-app-kpi-sidebar-sep--before-secondary" aria-hidden />
        <nav
          className="decide-app-kpi-sidebar-block decide-app-kpi-sidebar-block--secondary"
          aria-label="Informação"
        >
          {KPI_EMBED_NAV_SECONDARY_SECTIONS.map((section) => (
            <Fragment key={section.id}>
              {renderSidebarSectionButtons([section], kpiEmbedTab, applyKpiEmbedTab)}
              {renderSidebarNestedGreenTabs(section, kpiEmbedTab, applyKpiEmbedTab)}
            </Fragment>
          ))}
        </nav>
    </>
  );

  return (
    <div className={layoutClass}>
      <aside
        className={asideClass}
        aria-label={
          workspaceVariant === "dashboard" ? "Dashboard — navegação local" : "Sub-menu desta página"
        }
      >
        {navLinked ? (
          <div className="decide-app-kpi-sidebar--nav-linked-scroll">{sidebarInner}</div>
        ) : (
          sidebarInner
        )}
      </aside>

      <div className={navLinked ? "decide-app-kpi-main decide-app-kpi-main--nav-linked" : "decide-app-kpi-main"}>
        {navLinked && mainHeaderSlot ? (
          <div className="decide-app-kpi-main-toolbar">{mainHeaderSlot}</div>
        ) : null}
        {navLinked ? (
          <div className="decide-app-kpi-main-surface">{mainColumn}</div>
        ) : (
          mainColumn
        )}
      </div>
    </div>
  );
}
