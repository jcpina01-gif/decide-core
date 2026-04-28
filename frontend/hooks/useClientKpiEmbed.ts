import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/router";
import { isFxHedgeOnboardingApplicable } from "../lib/clientSegment";
import { readFxHedgePrefs } from "../lib/fxHedgePrefs";
import { FEES_CLIENT_EMBED_CACHE_REV, KPI_IFRAME_SRC_REV } from "../lib/kpiFlaskBuildGate";
import {
  ALLOWED_KPI_EMBED_TABS,
  FLASK_KPI_EMBED_TABS,
  KPI_EMBED_TAB_STORAGE_KEY,
  KPI_EMBED_TABS_ALLOWED_ON_CARTEIRA_PAGE,
  getKpiEmbedBaseForIframe,
  normalizeKpiEmbedTabId,
} from "../lib/kpiEmbedNav";

const ROUTES_WITH_EMBED = new Set(["/client-dashboard", "/client/carteira"]);

/** Não gravar estes separadores em sessionStorage — evita reabrir Ajuda/Assistente em cada visita após redireccionamento de onboarding. */
const KPI_EMBED_TABS_SKIP_SESSION_PERSIST = new Set(["help_assistant", "help_contacts"]);

function shouldPersistKpiTabToSession(tab: string): boolean {
  return !KPI_EMBED_TABS_SKIP_SESSION_PERSIST.has(normalizeKpiEmbedTabId(tab));
}

export type UseClientKpiEmbedOptions = {
  profile: "conservador" | "moderado" | "dinamico";
  loggedIn: boolean;
  /** Bump (ex.: `Date.now()`) para cache-bust do iframe Flask. */
  iframeRefresh: number;
};

/**
 * Estado das tabs do simulador (KPI / gráficos / …), sincronização com `?embed_tab=`,
 * sessionStorage, e mensagens `postMessage` do iframe Flask.
 */
export function useClientKpiEmbed({ profile, loggedIn, iframeRefresh }: UseClientKpiEmbedOptions) {
  const router = useRouter();
  /** Por omissão: Gráficos (prova histórica) antes da Simulação — credibilidade primeiro. */
  const [kpiEmbedTab, setKpiEmbedTab] = useState<string>("charts");
  const [kpiViewMode, setKpiViewMode] = useState<"simple" | "advanced">("simple");
  const kpiIframeRef = useRef<HTMLIFrameElement | null>(null);

  const applyKpiEmbedTab = useCallback(
    (id: string) => {
      const t = normalizeKpiEmbedTabId(id);
      if (!ALLOWED_KPI_EMBED_TABS.has(t)) return;
      setKpiEmbedTab(t);
      if (shouldPersistKpiTabToSession(t)) {
        try {
          sessionStorage.setItem(KPI_EMBED_TAB_STORAGE_KEY, t);
        } catch {
          /* ignore */
        }
      }
      const path = router.pathname || "";
      if (!ROUTES_WITH_EMBED.has(path)) return;
      try {
        void router.replace(
          { pathname: path, query: { ...router.query, embed_tab: t } },
          undefined,
          { shallow: true },
        );
      } catch {
        /* ignore */
      }
    },
    [router],
  );

  useEffect(() => {
    try {
      const v = localStorage.getItem("decide_kpi_view_v1");
      if (v === "advanced") setKpiViewMode("advanced");
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    if (!router.isReady) return;
    const raw = router.query.embed_tab;
    const fromQuery = typeof raw === "string" ? normalizeKpiEmbedTabId(raw) : "";
    if (fromQuery && ALLOWED_KPI_EMBED_TABS.has(fromQuery)) {
      setKpiEmbedTab(fromQuery);
      if (shouldPersistKpiTabToSession(fromQuery)) {
        try {
          sessionStorage.setItem(KPI_EMBED_TAB_STORAGE_KEY, fromQuery);
        } catch {
          /* ignore */
        }
      }
      return;
    }
    try {
      const v = sessionStorage.getItem(KPI_EMBED_TAB_STORAGE_KEY);
      if (!v) return;
      const stored = normalizeKpiEmbedTabId(v);
      if (!ALLOWED_KPI_EMBED_TABS.has(stored)) return;
      if (!shouldPersistKpiTabToSession(stored)) {
        sessionStorage.removeItem(KPI_EMBED_TAB_STORAGE_KEY);
        return;
      }
      setKpiEmbedTab(stored);
    } catch {
      /* ignore */
    }
  }, [router.isReady, router.query.embed_tab]);

  /** Página Carteira: só tabs de carteira/apoio; `overview`/KPIs/Gráficos/Simulação vêm do Dashboard. */
  useEffect(() => {
    if (!router.isReady) return;
    if (router.pathname !== "/client/carteira") return;
    const t = normalizeKpiEmbedTabId(kpiEmbedTab);
    if (t === "overview") {
      applyKpiEmbedTab("portfolio");
      return;
    }
    if (!KPI_EMBED_TABS_ALLOWED_ON_CARTEIRA_PAGE.has(t)) applyKpiEmbedTab("portfolio");
  }, [router.isReady, router.pathname, kpiEmbedTab, applyKpiEmbedTab]);

  /** Dashboard: separador Carteira IBKR está na página Carteira — não manter `portfolio` aqui. */
  useEffect(() => {
    if (!router.isReady) return;
    if (router.pathname !== "/client-dashboard") return;
    const t = normalizeKpiEmbedTabId(kpiEmbedTab);
    if (t === "portfolio" || t === "portfolio_history") applyKpiEmbedTab("overview");
  }, [router.isReady, router.pathname, kpiEmbedTab, applyKpiEmbedTab]);

  useEffect(() => {
    function onMsg(e: MessageEvent) {
      const d = e.data as { type?: string; tab?: string } | null;
      if (!d || d.type !== "decide-kpi-embed-tab" || typeof d.tab !== "string") return;
      const nt = normalizeKpiEmbedTabId(d.tab);
      if (!ALLOWED_KPI_EMBED_TABS.has(nt)) return;
      const iframeWin = kpiIframeRef.current?.contentWindow;
      if (!iframeWin || e.source !== iframeWin) return;
      if (!FLASK_KPI_EMBED_TABS.has(nt)) return;
      applyKpiEmbedTab(nt);
    }
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [applyKpiEmbedTab]);

  const kpiIframeSrc = useMemo(() => {
    const tab = normalizeKpiEmbedTabId(kpiEmbedTab);
    const feesT = iframeRefresh ? `&t=${iframeRefresh}` : "";
    const feesProfile = `&profile=${encodeURIComponent(profile)}`;
    const feesEmbedRev = `&fees_embed_rev=${encodeURIComponent(FEES_CLIENT_EMBED_CACHE_REV)}`;
    if (tab === "fees_intro") return `/fees-client?embed=1&fees_tab=intro${feesProfile}${feesT}${feesEmbedRev}`;
    if (tab === "fees") return `/fees-client?embed=1&fees_tab=sim${feesProfile}${feesT}${feesEmbedRev}`;
    if (tab === "help_contacts") return "";
    if (tab === "help_assistant") return "";
    if (tab === "fiscal") return "";
    /** Página Carteira: «Carteira actual» = posições IBKR em Next (não iframe Flask do modelo). */
    if (router.pathname === "/client/carteira" && tab === "portfolio") return "";
    const base = getKpiEmbedBaseForIframe();
    if (!base) return "";
    if (!FLASK_KPI_EMBED_TABS.has(tab)) return "";
    const t = iframeRefresh ? `&t=${iframeRefresh}` : "";
    let hedgeQs = "";
    if (
      typeof window !== "undefined" &&
      loggedIn &&
      isFxHedgeOnboardingApplicable() &&
      kpiViewMode === "advanced"
    ) {
      const prefs = readFxHedgePrefs();
      hedgeQs = "&embed_hedge=1";
      const pct = prefs?.pct ?? 100;
      if (pct === 0) hedgeQs += "&hedge_pct=0";
      else if (pct === 50) hedgeQs += "&hedge_pct=50";
      else hedgeQs += "&hedge_pct=100";
      hedgeQs += `&hedge_pair=${encodeURIComponent(prefs?.pair || "EURUSD")}`;
    }
    /** Força novo URL do iframe após mudanças no Flask (cache agressivo / SW). Ver `KPI_IFRAME_SRC_REV`. */
    const embedRev = `&embed_src_rev=${encodeURIComponent(KPI_IFRAME_SRC_REV)}`;
    return `${base}/?client_embed=1&profile=${encodeURIComponent(profile)}&embed_tab=${encodeURIComponent(
      tab,
    )}&kpi_view=${encodeURIComponent(kpiViewMode)}${embedRev}${t}${hedgeQs}`;
  }, [profile, iframeRefresh, kpiEmbedTab, kpiViewMode, loggedIn, router.pathname]);

  return {
    kpiEmbedTab,
    applyKpiEmbedTab,
    kpiViewMode,
    setKpiViewMode,
    kpiIframeSrc,
    kpiIframeRef,
  };
}
