/**

 * Navegação do simulador KPI (tabs no dashboard / carteira) + URLs do iframe Flask / Next.

 *

 * Regra de produto: o menu **lateral** é sub-menu **contextual** desta página — não repete

 * Dashboard / Carteira / Plano / Atividade (isso é só o topo).

 * - **Dashboard**: KPIs, Gráficos, Simulação, Robustez (+ Custos / Fiscalidade / Ajuda).

 * - **Carteira**: só vistas da carteira IBKR (actual + histórico) + os mesmos apoios.

 */



export const KPI_EMBED_TAB_STORAGE_KEY = "decide_kpi_embed_tab_v2";



export const ALLOWED_KPI_EMBED_TABS = new Set([

  "overview",

  "simulator",

  "horizons",

  "charts",

  "portfolio",

  "portfolio_history",

  "faq",

  "help_contacts",

  "help_assistant",

  "fees_intro",

  "fees",

  "fiscal",

  /** Painel Next-only — testes de robustez / metodologia (dashboard). */
  "model_robustness",

]);



/** Separadores servidos pelo Flask `kpi_server` (resto = Next embebido ou painel). */

export const FLASK_KPI_EMBED_TABS = new Set([

  "overview",

  "simulator",

  "horizons",

  "charts",

  "portfolio",

  "portfolio_history",

  "faq",

]);



/** Dashboard: separadores onde mostramos o bloco «Recomendado para si» acima do iframe. */

/** Cartão «modelo / plano» e ponte de decisão: só na aba KPIs (Resumo), não em Gráficos/Simulação. */
export const KPI_EMBED_TABS_RECOMMENDED_BLOCK = new Set(["overview"]);



export type KpiEmbedNavSection = {

  id: string;

  label: string;

  tabs: { id: string; label: string }[];

};



/** Painel Next-only no dashboard — a seguir a «Simulação» no sub-menu; não usado na página Carteira. */

export const KPI_EMBED_NAV_DASHBOARD_ROBUSTNESS_SECTION: KpiEmbedNavSection = {

  id: "model_robustness",

  label: "Robustez",

  tabs: [{ id: "model_robustness", label: "Robustez do modelo" }],

};



/** Sub-menu local em `/client-dashboard` — análise (sem «Carteira»; isso é navegação global no topo). */

export const KPI_EMBED_NAV_PRIMARY_SECTIONS_DASHBOARD: KpiEmbedNavSection[] = [

  { id: "kpis", label: "KPIs", tabs: [{ id: "overview", label: "Resumo" }] },

  {

    id: "charts",

    label: "Gráficos",

    tabs: [

      { id: "charts", label: "Gráficos (longo prazo)" },

      { id: "horizons", label: "Retornos" },

    ],

  },

  { id: "sim", label: "Simulação", tabs: [{ id: "simulator", label: "Simulador" }] },

  KPI_EMBED_NAV_DASHBOARD_ROBUSTNESS_SECTION,

];



/**

 * Sub-menu local em `/client/carteira` — só IBKR (rótulos distintos do item global «Carteira» no topo).

 * Secções de uma tab: clique vai directamente para essa vista (sem grupo extra «Carteira»).

 */

export const KPI_EMBED_NAV_PRIMARY_SECTIONS_CARTEIRA: KpiEmbedNavSection[] = [

  {

    id: "portfolio_now",

    label: "Carteira actual",

    tabs: [{ id: "portfolio", label: "Carteira actual" }],

  },

  {

    id: "portfolio_hist",

    label: "Histórico de decisões",

    tabs: [{ id: "portfolio_history", label: "Histórico de decisões" }],

  },

];



/** Alias — preferir `KPI_EMBED_NAV_PRIMARY_SECTIONS_DASHBOARD` em código novo. */

export const KPI_EMBED_NAV_PRIMARY_SECTIONS = KPI_EMBED_NAV_PRIMARY_SECTIONS_DASHBOARD;



/** Informação / apoio (sidebar inferior, separado). */

export const KPI_EMBED_NAV_SECONDARY_SECTIONS: KpiEmbedNavSection[] = [

  {

    id: "fees",

    label: "Custos",

    tabs: [

      { id: "fees_intro", label: "Descrição" },

      { id: "fees", label: "Simulador" },

    ],

  },

  { id: "fiscal", label: "Fiscalidade", tabs: [{ id: "fiscal", label: "Fiscalidade" }] },

  {

    id: "help",

    label: "Ajuda",

    tabs: [

      { id: "faq", label: "Perguntas frequentes" },

      { id: "help_assistant", label: "Assistente" },

      { id: "help_contacts", label: "Contactos" },

    ],

  },

];



/** Todas as secções possíveis (validação / lookup). */

export const KPI_EMBED_NAV_SECTIONS: KpiEmbedNavSection[] = [

  ...KPI_EMBED_NAV_PRIMARY_SECTIONS_DASHBOARD,

  ...KPI_EMBED_NAV_PRIMARY_SECTIONS_CARTEIRA,

  ...KPI_EMBED_NAV_SECONDARY_SECTIONS,

];



/** Tabs de embed permitidas na página Carteira (Flask portfolio + apoio embebido). */

export const KPI_EMBED_TABS_ALLOWED_ON_CARTEIRA_PAGE = new Set([

  "portfolio",

  "portfolio_history",

  "fees_intro",

  "fees",

  "fiscal",

  "faq",

  "help_assistant",

  "help_contacts",

]);



export function normalizeKpiEmbedTabId(tab: string): string {

  return String(tab || "")

    .trim()

    .toLowerCase()

    .normalize("NFC");

}



export function isKpiNavSectionActive(

  section: { tabs: { id: string }[] },

  kpiEmbedTab: string,

): boolean {

  const t = normalizeKpiEmbedTabId(kpiEmbedTab);

  return section.tabs.some((x) => normalizeKpiEmbedTabId(x.id) === t);

}



export function normalizeKpiEmbedBaseUrl(input: string): string {

  const s = input.trim();

  if (!s) return "";

  /* `/kpi-flask` + `https://` → `https:///kpi-flask` → host fictício `kpi-flask` no iframe. */
  if (s.startsWith("/")) return s.replace(/\/+$/, "") || "/";

  try {

    const hasScheme = /^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(s);

    const localLike = /^(127\.0\.0\.1|localhost)(\:|$)/i.test(s);

    const candidate = hasScheme ? s : localLike ? `http://${s}` : `https://${s}`;

    const u = new URL(candidate);

    return `${u.protocol}//${u.host}`;

  } catch {

    return s.replace(/\/+$/, "");

  }

}

/**
 * O iframe KPI usa `/?client_embed=1` no **servidor Flask**. Se `NEXT_PUBLIC_KPI_EMBED_BASE` apontar
 * para o mesmo domínio que o Next (ex. só o site Vercel), o pedido dá **404** — devolve "" para mostrar
 * o aviso de conectividade em vez de um iframe partido.
 */
export function kpiEmbedBaseRejectSameOriginAsApp(base: string): string {
  if (!base.trim() || typeof window === "undefined") return base;
  try {
    const u =
      base.startsWith("http://") || base.startsWith("https://")
        ? new URL(base)
        : new URL(base, window.location.origin);
    if (u.origin !== window.location.origin) return base;
    const p = u.pathname;
    if (p === "/kpi-flask" || p.startsWith("/kpi-flask/")) return base;
    return "";
  } catch {
    return base;
  }
}



export function getKpiEmbedBase(): string {
  /**
   * Em dev o browser usa o proxy do Next (`middleware.ts` → 127.0.0.1:5000).
   * Em produção com `KPI_EMBED_UPSTREAM` + `NEXT_PUBLIC_KPI_EMBED_BASE=/kpi-flask`, o middleware reencaminha
   * para o mesmo `kpi_server` que em local (regras de vol / perfil idênticas ao build deployado).
   */
  if (process.env.NODE_ENV === "development") {
    return "/kpi-flask";
  }

  const fromEnv = normalizeKpiEmbedBaseUrl(String(process.env.NEXT_PUBLIC_KPI_EMBED_BASE || ""));

  if (fromEnv) return fromEnv;

  if (typeof window === "undefined") return "";

  const h = window.location.hostname;

  if (h === "localhost" || h === "127.0.0.1") return "http://127.0.0.1:5000";

  return "";

}

/** Base segura para iframes / health-check no browser (bloqueia URL = próprio site Next → 404 em `/?client_embed=1`). */
export function getKpiEmbedBaseForIframe(): string {
  return kpiEmbedBaseRejectSameOriginAsApp(getKpiEmbedBase());
}


