/**
 * Temas da área cliente DECIDE — alinhados a `globals.css` (:root).
 * Botões principais: verde acinzentado (teal). Excepções explícitas: `buttonAmberCta`, `buttonLogout`,
 * estados disabled / secundários neutros onde o copy o exige.
 */

export const DECIDE_APP_FONT_FAMILY =
  '"Nunito", "Segoe UI", system-ui, -apple-system, Arial, sans-serif';

/** Botão principal / KPI / CTA — gradiente verde acinzentado + highlight subtil */
const KPI_MENU_MAIN_BTN_BG =
  "linear-gradient(180deg, rgba(255, 255, 255, 0.12) 0%, transparent 46%), linear-gradient(180deg, #3f9e93 0%, #2d7f76 48%, #1e5c56 100%)";

const KPI_MENU_MAIN_BTN_BORDER = "1px solid rgba(255, 255, 255, 0.14)";
const KPI_MENU_MAIN_BTN_SHADOW =
  "0 2px 10px rgba(0, 0, 0, 0.45), inset 0 1px 0 rgba(255, 255, 255, 0.08)";

/** Secundário — mesmo tom, mais escuro (sub-CTAs) */
const SECONDARY_BTN_GRAD =
  "linear-gradient(180deg, #357a72 0%, #265f59 42%, #1a4540 100%)";

const SLATE_CTA_GRAD =
  "linear-gradient(180deg, #2f6b64 0%, #235a54 48%, #183f3a 100%)";

const LINK_PILL_TEAL =
  "linear-gradient(180deg, rgba(255,255,255,0.06) 0%, transparent 42%), linear-gradient(165deg, rgba(63, 63, 70, 0.45) 0%, rgba(39, 39, 42, 0.95) 100%)";

/**
 * Fundo base área app cliente — alinhar a `globals.css` (`--app-shell-bg`).
 * Usado em `useEffect` em `documentElement`/`body` para evitar flash antes do CSS.
 */
export const DECIDE_APP_PAGE_BG =
  "linear-gradient(180deg, #18181a 0%, #121214 48%, #0c0c0e 100%)";

const ACCENT_LINE = "rgba(94, 234, 212, 0.22)";
const ACCENT_SOFT = "rgba(45, 212, 191, 0.1)";

export const DECIDE_DASHBOARD = {
  fontFamily: DECIDE_APP_FONT_FAMILY,
  topNavStripBg: DECIDE_APP_PAGE_BG,
  pageBg: DECIDE_APP_PAGE_BG,
  text: "var(--text-primary)",
  textMuted: "var(--text-secondary)",
  headerPanel: "var(--bg-card)",
  headerBorder: "1px solid var(--border-soft)",
  accentSky: "var(--accent-primary)",
  buttonOutlineTeal: "var(--accent-primary)",
  kpiMenuMainButtonBackground: KPI_MENU_MAIN_BTN_BG,
  kpiMenuMainButtonBorder: KPI_MENU_MAIN_BTN_BORDER,
  kpiMenuSeparatorBorder: "2px solid rgba(255, 255, 255, 0.08)",
  kpiMenuMainButtonColor: "#fafafa",
  kpiMenuMainButtonShadow: KPI_MENU_MAIN_BTN_SHADOW,
  buttonRegister: KPI_MENU_MAIN_BTN_BG,
  buttonSecondary: SECONDARY_BTN_GRAD,
  buttonLogout: "linear-gradient(180deg, #3f3f46 0%, #2e2e32 50%, #18181b 100%)",
  buttonTealCta: KPI_MENU_MAIN_BTN_BG,
  /** Excepção: aviso / acção especial — mantém âmbar */
  buttonAmberCta: "linear-gradient(180deg, #fde047 0%, #eab308 38%, #ca8a04 92%)",
  buttonSlateCta: SLATE_CTA_GRAD,
  linkPillTeal: LINK_PILL_TEAL,
  refreshButton: KPI_MENU_MAIN_BTN_BG,
  refreshText: "#fafafa",
  buttonShadowRaised: "0 4px 16px rgba(0,0,0,0.38), inset 0 1px 0 rgba(255,255,255,0.2)",
  buttonShadowSoft: "0 2px 10px rgba(0,0,0,0.28), inset 0 1px 0 rgba(255,255,255,0.1)",
  link: "var(--accent-primary)",
  iframeBg: "var(--bg-card)",
  panelSlate: "rgba(40, 40, 42, 0.78)",
  panelBorder: "1px solid rgba(255, 255, 255, 0.08)",
  flowTealCardBorder: `1px solid ${ACCENT_LINE}`,
  flowTealCardBorderStrong: `1px solid rgba(255, 255, 255, 0.12)`,
  flowTealPanelGradient:
    "linear-gradient(165deg, rgba(48, 48, 50, 0.55) 0%, rgba(28, 28, 30, 0.98) 100%)",
  flowTealPanelGradientSoft:
    "linear-gradient(135deg, rgba(48, 48, 50, 0.35) 0%, rgba(36, 36, 38, 0.96) 100%)",
  flowTealBadgeBg: ACCENT_SOFT,
  flowInnerCardBorderTeal: `1px solid ${ACCENT_LINE}`,
  flowTealBarFill: "var(--accent-primary)",
  flowTealChartStroke: "#d4d4d4",
  clientPanelGradient:
    "linear-gradient(165deg, rgba(42, 42, 44, 0.97) 0%, rgba(30, 30, 32, 0.99) 100%)",
  clientPanelGradientVertical:
    "linear-gradient(180deg, rgba(42, 42, 44, 0.96) 0%, rgba(32, 32, 34, 0.98) 45%, var(--bg-main) 100%)",
  clientPanelShadow: "0 4px 24px rgba(0, 0, 0, 0.42)",
  clientPanelShadowMedium:
    "0 4px 28px rgba(0, 0, 0, 0.45), inset 0 1px 0 rgba(255, 255, 255, 0.04)",
  clientPanelShadowAccent:
    "0 0 0 1px rgba(255, 255, 255, 0.06), 0 16px 40px rgba(0, 0, 0, 0.48), inset 0 1px 0 rgba(255,255,255,0.04)",
  clientChartTooltipBg: "#27272a",
  clientProgressTrackBg: "#18181b",
  clientSubCardGradient:
    "linear-gradient(165deg, rgba(63, 63, 70, 0.2) 0%, rgba(36, 36, 38, 0.94) 100%)",
} as const;

export const ONBOARDING_SHELL_MAX_WIDTH_PX = 1280;

/** Botões «Continuar» / «Seguinte» no funil: mesma largura máxima, centrados (MiFID, montante, Persona, etc.). */
export const ONBOARDING_PRIMARY_CTA_MAX_WIDTH_PX = 300;

export const DECIDE_ONBOARDING = {
  fontFamily: DECIDE_APP_FONT_FAMILY,
  shellMaxWidthPx: ONBOARDING_SHELL_MAX_WIDTH_PX,
  pageBackground: "var(--page-gradient)",
  text: "var(--text-primary)",
  textMuted: "var(--text-secondary)",
  textLabel: "var(--text-secondary)",
  cardBg:
    "linear-gradient(165deg, rgba(42, 42, 44, 0.96) 0%, rgba(30, 30, 32, 0.99) 100%)",
  cardBorder: "1px solid rgba(255, 255, 255, 0.08)",
  cardShadow: "0 24px 48px rgba(0,0,0,0.35), 0 0 0 1px rgba(255,255,255,0.04) inset",
  inputBg: "#343436",
  inputBorder: "1px solid rgba(255, 255, 255, 0.1)",
  buttonPrimaryGradient: KPI_MENU_MAIN_BTN_BG,
  buttonPrimaryBorder: KPI_MENU_MAIN_BTN_BORDER,
  buttonDisabled: "#3f3f46",
  link: "var(--accent-primary)",
} as const;

/**
 * Tokens usados em páginas cliente com formulários longos (ex. `mifid-test.tsx`).
 * Alias semântico sobre `DECIDE_ONBOARDING` / `DECIDE_DASHBOARD` para não duplicar valores.
 */
export const DECIDE_CLIENT = {
  fontFamily: DECIDE_ONBOARDING.fontFamily,
  pageGradient: DECIDE_ONBOARDING.pageBackground,
  text: DECIDE_ONBOARDING.text,
  textLabel: DECIDE_ONBOARDING.textLabel,
  cardGradient: DECIDE_ONBOARDING.cardBg,
  cardBorder: DECIDE_ONBOARDING.cardBorder,
  cardShadow: DECIDE_ONBOARDING.cardShadow,
  inputBg: DECIDE_ONBOARDING.inputBg,
  inputBorder: DECIDE_ONBOARDING.inputBorder,
  panelBorder: DECIDE_DASHBOARD.panelBorder,
  buttonPrimaryGradient: DECIDE_ONBOARDING.buttonPrimaryGradient,
  buttonPrimaryBorder: DECIDE_ONBOARDING.buttonPrimaryBorder,
  buttonPrimaryGlow: DECIDE_DASHBOARD.kpiMenuMainButtonShadow,
  infoBg: "rgba(255, 255, 255, 0.05)",
  infoBorder: "1px solid rgba(255, 255, 255, 0.12)",
  infoText: "var(--text-secondary)",
} as const;
