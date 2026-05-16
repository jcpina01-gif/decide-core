import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import Head from "next/head";
import { useRouter } from "next/router";
import OnboardingFlowBar from "../../components/OnboardingFlowBar";
import type { RegisterClientUserErrorField } from "../../lib/clientAuth";
import {
  clearSignupPhoneVerifiedFlag,
  CLIENT_PASSWORD_MIN_LENGTH,
  deriveClientUsernameFromEmail,
  evaluatePasswordStrength,
  fetchSignupPhoneVerifiedFromServer,
  getCurrentSessionUser,
  isClientLoggedIn,
  isSessionEmailVerified,
  fetchSignupEmailVerifiedFromServer,
  isSignupEmailVerifiedForInput,
  isSignupPhoneVerifiedForInput,
  setSignupEmailVerifiedFromServerEmail,
  setSignupPhoneVerifiedFromServerPhone,
  loginClientUser,
  loginClientUserAsync,
  normalizeClientPhone,
  passwordStrengthSummary,
  registerClientUser,
  registerClientUserAsync,
  requestEmailVerificationSend,
  suggestClientUsernameFromEmail,
  requestEmailVerificationSignupSend,
} from "../../lib/clientAuth";
import { devConfirmationLinkUsesLoopback } from "../../lib/emailConfirmationDevLink";
import {
  DECIDE_MIN_INVEST_EUR,
  persistIntendedInvestEur,
  readIntendedInvestEur,
} from "../../lib/decideInvestPrefill";
import {
  DECIDE_APP_FONT_FAMILY,
  DECIDE_DASHBOARD,
  DECIDE_ONBOARDING,
  ONBOARDING_SHELL_MAX_WIDTH_PX,
} from "../../lib/decideClientTheme";
import {
  type ClientSegment,
  formatSegmentTitleLabel,
  setClientSegment,
} from "../../lib/clientSegment";

/** HTTP na LAN (telemóvel → IP do PC): `navigator.clipboard` pode não existir — evita crash no «Copiar link». */
async function copyTextToClipboardSafe(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to legacy
  }
  try {
    if (typeof document === "undefined") return false;
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    ta.style.top = "0";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

/** Requisitos de password em linha compacta (menos peso visual que caixa grande). */
function ReqPill({
  ok,
  children,
  compact,
  title: titleAttr,
}: {
  ok: boolean;
  children: React.ReactNode;
  compact?: boolean;
  title?: string;
}) {
  const sm = !!compact;
  return (
    <span
      title={titleAttr}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: sm ? 4 : 5,
        fontSize: sm ? 11 : 11,
        fontWeight: 700,
        letterSpacing: "0.02em",
        padding: sm ? "3px 10px" : "4px 9px",
        lineHeight: sm ? 1.2 : 1.35,
        borderRadius: 999,
        flexShrink: 0,
        background: ok ? "rgba(34,197,94,0.1)" : "rgba(15,23,42,0.55)",
        border: `1px solid ${ok ? "rgba(74,222,128,0.28)" : "rgba(51,65,85,0.65)"}`,
        color: ok ? DECIDE_DASHBOARD.accentSky : "#71717a",
      }}
    >
      <span style={{ fontSize: 12, lineHeight: 1 }}>{ok ? "✓" : "○"}</span>
      {children}
    </span>
  );
}

function PasswordField({
  label,
  value,
  onChange,
  placeholder,
  inputStyle,
  inputRef,
  onInputKeyDown,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  inputStyle: React.CSSProperties;
  inputRef?: React.Ref<HTMLInputElement>;
  onInputKeyDown?: React.KeyboardEventHandler<HTMLInputElement>;
}) {
  const [show, setShow] = useState(false);
  const iconStroke = show ? "#38bdf8" : "#cbd5e1";
  return (
    <div style={{ marginBottom: 6 }}>
      <div style={{ color: "#a1a1aa", fontSize: 14, marginBottom: 5 }}>{label}</div>
      <div style={{ display: "flex", gap: 8, alignItems: "stretch" }}>
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onInputKeyDown}
          type={show ? "text" : "password"}
          style={{ ...inputStyle, flex: 1 }}
          placeholder={placeholder}
          autoComplete="new-password"
        />
        <button
          type="button"
          onClick={() => setShow((s) => !s)}
          aria-label={show ? "Ocultar palavra-passe" : "Mostrar palavra-passe"}
          title={show ? "Ocultar palavra-passe" : "Mostrar palavra-passe"}
          style={{
            flexShrink: 0,
            background: "#27272a",
            color: "#e2e8f0",
            border: "1px solid rgba(63,63,70,0.85)",
            borderRadius: 12,
            width: 44,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
          }}
        >
          {show ? (
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6-10-6-10-6Z"
                stroke={iconStroke}
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <circle cx="12" cy="12" r="3.2" stroke={iconStroke} strokeWidth="1.8" />
            </svg>
          ) : (
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6-10-6-10-6Z"
                stroke={iconStroke}
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <circle cx="12" cy="12" r="3.2" stroke={iconStroke} strokeWidth="1.8" />
              <path d="M4 4L20 20" stroke={iconStroke} strokeWidth="2" strokeLinecap="round" />
            </svg>
          )}
        </button>
      </div>
    </div>
  );
}

/** Texto técnico longo — visível ao passar o rato (ou foco) no «i». */
function DevCommentHoverIcon({ label, children }: { label: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <span
      style={{ position: "relative", display: "inline-flex", alignItems: "center", flexShrink: 0 }}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        tabIndex={0}
        onMouseEnter={() => setOpen(true)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        style={{
          width: 22,
          height: 22,
          borderRadius: "50%",
          border: "1px solid rgba(148,163,184,0.45)",
          background: "rgba(30,41,59,0.9)",
          color: "#a1a1aa",
          fontSize: 12,
          fontWeight: 900,
          fontStyle: "italic",
          cursor: "help",
          lineHeight: 1,
          padding: 0,
        }}
      >
        i
      </button>
      {open ? (
        <div
          role="tooltip"
          style={{
            position: "absolute",
            left: 0,
            top: "100%",
            marginTop: 8,
            zIndex: 80,
            minWidth: 260,
            maxWidth: "min(360px, 92vw)",
            padding: "12px 14px",
            borderRadius: 12,
            background: "rgba(15,23,42,0.98)",
            border: "1px solid rgba(71,85,105,0.75)",
            boxShadow: "0 12px 40px rgba(0,0,0,0.45)",
            fontSize: 12,
            lineHeight: 1.5,
            color: "#cbd5e1",
          }}
        >
          {children}
        </div>
      ) : null}
    </span>
  );
}

const baseInput: React.CSSProperties = {
  width: "100%",
  background: "#0d1118",
  color: "#e2e8f0",
  border: "1px solid #252a3a",
  borderRadius: 10,
  padding: "11px 14px",
  fontSize: 14,
  outline: "none",
};

function regInputStyle(base: React.CSSProperties, invalid: boolean): React.CSSProperties {
  if (!invalid) return base;
  return {
    ...base,
    border: "1px solid #f87171",
    boxShadow: "0 0 0 1px rgba(248, 113, 113, 0.45)",
  };
}

const PREFILL_MONTANTE_FROM_SIM_KEY = "decide_prefill_montante_from_sim_v1";
/** Rascunho do wizard (passo + campos) — sobrevive a F5 e a remontagens (ex. Fast Refresh). Tab/sessionStorage só. */
const REGISTER_WIZARD_DRAFT_KEY = "decide_client_register_wizard_draft_v1";
const REGISTER_WIZARD_DRAFT_MAX_AGE_MS = 48 * 3600000;

type RegisterWizardDraftV1 = {
  v: 1;
  step: 1 | 2;
  email: string;
  phone: string;
  username: string;
  password: string;
  passwordConfirm: string;
  /** Prova HMAC do último SMS — necessária na Vercel; sem isto, F5 apaga e a validação falha. */
  phoneOtpProof?: string;
  savedAt: number;
};

const MIN_INVESTIMENTO_EUR = DECIDE_MIN_INVEST_EUR;

function readRegisterWizardDraft(): RegisterWizardDraftV1 | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(REGISTER_WIZARD_DRAFT_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as RegisterWizardDraftV1;
    if (s.v !== 1) return null;
    const rawStep = s.step;
    const normalizedStep = rawStep === 3 ? 2 : rawStep;
    if (normalizedStep !== 1 && normalizedStep !== 2) return null;
    if (typeof s.savedAt !== "number" || Date.now() - s.savedAt > REGISTER_WIZARD_DRAFT_MAX_AGE_MS) {
      sessionStorage.removeItem(REGISTER_WIZARD_DRAFT_KEY);
      return null;
    }
    return { ...s, step: normalizedStep };
  } catch {
    return null;
  }
}

function writeRegisterWizardDraft(d: Omit<RegisterWizardDraftV1, "v" | "savedAt"> & { savedAt?: number }) {
  if (typeof window === "undefined") return;
  try {
    const payload: RegisterWizardDraftV1 = {
      v: 1,
      step: d.step,
      email: d.email,
      phone: d.phone,
      username: d.username,
      password: d.password,
      passwordConfirm: d.passwordConfirm,
      ...(d.phoneOtpProof && d.phoneOtpProof.length > 0 ? { phoneOtpProof: d.phoneOtpProof } : {}),
      savedAt: d.savedAt ?? Date.now(),
    };
    sessionStorage.setItem(REGISTER_WIZARD_DRAFT_KEY, JSON.stringify(payload));
  } catch {
    // quota / private mode
  }
}

function clearRegisterWizardDraft() {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.removeItem(REGISTER_WIZARD_DRAFT_KEY);
  } catch {
    // ignore
  }
}

/** Alinhado ao funil de onboarding (`OnboardingFlowBar`). */
const REGISTER_PAGE_MAX_WIDTH = ONBOARDING_SHELL_MAX_WIDTH_PX;
/** Coluna dos campos — Premium | Private + requisitos password sem scroll horizontal. */
const REGISTER_FIELDS_MAX_PX = 600;
/** Largura máx. do bloco em 2 colunas (passo 2) — cabe no shell alargado. */
const REGISTER_STEP2_MAX_PX = Math.min(920, ONBOARDING_SHELL_MAX_WIDTH_PX - 48);
/** Botão principal: ligeiramente mais estreito que a coluna */
const REGISTER_CTA_MAX_PX = 400;
/** Espaçamento vertical entre blocos do passo 1 (ligeiramente compacto — decisão rápida) */
const REGISTER_STEP1_STACK_GAP_PX = 10;

const REGISTER_CARD_STYLE: React.CSSProperties = {
  background: "#0b0f1a",
  border: "1px solid #1a1f2e",
  borderRadius: 20,
  padding: "28px max(20px, 3.5vw) 32px",
  maxWidth: 560,
  marginLeft: "auto",
  marginRight: "auto",
};

const registerFieldsColumn: React.CSSProperties = {
  maxWidth: REGISTER_FIELDS_MAX_PX,
  width: "100%",
  marginLeft: "auto",
  marginRight: "auto",
};

const registerPwTwoCol: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr)",
  gap: "8px",
  alignItems: "start",
};

const registerResponsiveGrid: React.CSSProperties = {
  display: "grid",
  /** `min(280px, 100%)` evita track mínimo maior que o ecrã em viewports estreitas (mobile). */
  gridTemplateColumns: "repeat(auto-fit, minmax(min(280px, 100%), 1fr))",
  gap: "22px 28px",
  alignItems: "start",
};

/** Passo 2: email = ação principal (destaque teal suave); telemóvel = secundário (cinzento). */
const REGISTER_STEP2_CARD_EMAIL: React.CSSProperties = {
  minWidth: 0,
  padding: "24px 22px",
  borderRadius: 16,
  background: "#0b0f1a",
  border: "1px solid #1a1f2e",
};

const REGISTER_STEP2_CARD_PHONE: React.CSSProperties = {
  minWidth: 0,
  padding: "24px 22px",
  borderRadius: 16,
  background: "#0b0f1a",
  border: "1px solid #1a1f2e",
};

function parsePositiveIntFromQuery(raw: string | string[] | undefined): number | null {
  const s = Array.isArray(raw) ? raw[0] : raw;
  if (s == null || String(s).trim() === "") return null;
  const n = Math.round(Number(String(s).replace(/\s/g, "").replace(",", ".")));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Mostra destino do SMS sem expor todos os dígitos (ex.: +351 912 *** ***). */
function formatPhoneForDisplayMasked(e164: string): string {
  const d = (e164 || "").replace(/\D/g, "");
  if (d.startsWith("351") && d.length >= 12) {
    const rest = d.slice(3);
    if (rest.length >= 9) {
      return `+351 ${rest.slice(0, 3)} ${rest.slice(3, 6)} ***`;
    }
  }
  if (d.length >= 10) {
    return `+${d.slice(0, 3)} ${d.slice(3, 6)} ***`;
  }
  return e164 || "—";
}

/** Registo em localhost mas `EMAIL_LINK_BASE_URL` / `NEXT_PUBLIC_APP_URL` apontam para outro host — o poll `/status` vê outro servidor. */
function emailLinkPointsAwayFromLocalhost(linkBase: string): boolean {
  const raw = (linkBase || "").trim();
  if (!raw) return false;
  try {
    const normalized = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    const host = new URL(normalized).hostname.toLowerCase();
    return host !== "localhost" && host !== "127.0.0.1";
  } catch {
    return false;
  }
}

export default function ClientRegisterPage() {
  const router = useRouter();
  /** Só após mount: localStorage não existe no SSR — evita hydration mismatch em «Logado como». */
  const [sessionState, setSessionState] = useState<{ loggedIn: boolean; user: string | null }>({
    loggedIn: false,
    user: null,
  });
  useEffect(() => {
    setSessionState({
      loggedIn: isClientLoggedIn(),
      user: getCurrentSessionUser(),
    });
  }, []);

  const [browserHostIsLoopback, setBrowserHostIsLoopback] = useState(false);
  /** Hostname é IP de rede privada (ex. 192.168.x.x) — útil para avisar testes telemóvel ↔ PC. */
  const [privateLanHost, setPrivateLanHost] = useState(false);
  useEffect(() => {
    try {
      const h = window.location.hostname.toLowerCase();
      setBrowserHostIsLoopback(h === "localhost" || h === "127.0.0.1");
      setPrivateLanHost(
        /^192\.168\.\d{1,3}\.\d{1,3}$/.test(h) ||
          /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h) ||
          /^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/.test(h),
      );
    } catch {
      setBrowserHostIsLoopback(false);
      setPrivateLanHost(false);
    }
  }, []);

  /** Simulador KPI / landing: ?capital= — leva o valor para o passo «Montante». */
  useEffect(() => {
    if (!router.isReady) return;
    const c = parsePositiveIntFromQuery(router.query.capital ?? router.query.sim_capital);
    try {
      if (c != null) {
        const capped = Math.max(MIN_INVESTIMENTO_EUR, c);
        window.sessionStorage.setItem(PREFILL_MONTANTE_FROM_SIM_KEY, String(capped));
        persistIntendedInvestEur(capped);
      } else {
        window.sessionStorage.removeItem(PREFILL_MONTANTE_FROM_SIM_KEY);
      }
    } catch {
      // ignore
    }
  }, [router.isReady, router.query.capital, router.query.sim_capital]);

  function goToMontanteWithSimPrefill() {
    let url = "/client-montante";
    try {
      let cap = window.sessionStorage.getItem(PREFILL_MONTANTE_FROM_SIM_KEY);
      if (!cap) {
        const fromLs = readIntendedInvestEur();
        if (fromLs != null) cap = String(fromLs);
      }
      const n = cap != null ? Number(cap) : NaN;
      if (Number.isFinite(n) && n > 0) {
        const safe = Math.max(MIN_INVESTIMENTO_EUR, Math.round(n));
        url = `/client-montante?capital=${encodeURIComponent(String(safe))}`;
      }
    } catch {
      // ignore
    }
    window.location.href = url;
  }
  const loggedIn = sessionState.loggedIn;
  const currentUser = sessionState.user;

  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [clientSegment, setClientSegmentState] = useState<ClientSegment>("premium");

  const [msg, setMsg] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [regFieldErr, setRegFieldErr] = useState<Partial<Record<RegisterClientUserErrorField, boolean>>>({});
  const [storageTick, setStorageTick] = useState(0);
  const [signupSendBusy, setSignupSendBusy] = useState(false);
  /** Link exacto do último pedido (simulado ou enviado por email) — para verificar se não é 127.0.0.1 no telemóvel. */
  const [signupDevLink, setSignupDevLink] = useState<string | null>(null);
  /** Só true após «Criar conta» com email simulado — permite mostrar a caixa do link no passo 3 sem misturar com pré-registo. */
  const [postRegisterEmailLinkActive, setPostRegisterEmailLinkActive] = useState(false);
  const [emailLinkDiag, setEmailLinkDiag] = useState<{
    linkBase: string;
    localhost: boolean;
    hint: string;
  } | null>(null);
  const [smsVerificationEnabled, setSmsVerificationEnabled] = useState(false);
  /** Alinhado com GET /api/client/phone-verification/config → phoneSmsRequiredForSignup */
  const [phoneSmsRequiredForSignup, setPhoneSmsRequiredForSignup] = useState(false);
  const [phoneVerifyDiag, setPhoneVerifyDiag] = useState<{
    twilioConfigured: boolean;
    allowClientPhoneVerify: boolean;
    devSignupSmsSimulate: boolean;
    /** Servidor pode emitir otpProof (VERIFY_EMAIL_SECRET ≥ 16) — obrigatório em serverless. */
    phoneOtpProofEnabled: boolean;
  }>({
    twilioConfigured: false,
    allowClientPhoneVerify: false,
    devSignupSmsSimulate: false,
    phoneOtpProofEnabled: false,
  });
  const [phoneConfigLoading, setPhoneConfigLoading] = useState(false);
  /** True quando o GET da config falhou (rede, 5xx, etc.) — não confundir com «SMS desligado no servidor». */
  const [phoneConfigLoadFailed, setPhoneConfigLoadFailed] = useState(false);
  const [phoneOtp, setPhoneOtp] = useState("");
  /** Remonta o `<input>` do OTP ao pedir novo SMS — limpa autofill / extensões que repõem o valor. */
  const [phoneOtpInputMountKey, setPhoneOtpInputMountKey] = useState(0);
  /** Devolvido por POST send — obrigatório em Vercel (serverless sem disco partilhado). */
  const [phoneOtpProof, setPhoneOtpProof] = useState("");
  /** Painel DEV agrupado — fechado por defeito para não poluir o ecrã. */
  const [devToolsOpen, setDevToolsOpen] = useState(false);
  const [phoneSmsBusy, setPhoneSmsBusy] = useState(false);
  const [phoneVerifyBusy, setPhoneVerifyBusy] = useState(false);
  const [phoneSmsMsg, setPhoneSmsMsg] = useState("");
  const [phoneFormatHint, setPhoneFormatHint] = useState<{ ok: boolean; text: string } | null>(null);
  const [phoneVerifyFeedback, setPhoneVerifyFeedback] = useState<string>("");
  const phoneFeedbackRef = useRef<HTMLDivElement | null>(null);
  const phoneOtpInputRef = useRef<HTMLInputElement | null>(null);
  const registerEmailInputRef = useRef<HTMLInputElement | null>(null);
  const registerPhoneInputRef = useRef<HTMLInputElement | null>(null);
  const registerUsernameInputRef = useRef<HTMLInputElement | null>(null);
  const registerPasswordRef = useRef<HTMLInputElement | null>(null);
  const registerPasswordConfirmRef = useRef<HTMLInputElement | null>(null);

  /** Foco síncrono no OTP (obrigatório antes de qualquer `await` — senão Safari/mobile bloqueia). */
  function focusPhoneOtpField() {
    const el = phoneOtpInputRef.current;
    if (!el) return;
    try {
      el.focus({ preventScroll: true });
    } catch {
      el.focus();
    }
  }

  /** Após `key` no input (novo SMS), o ref liga-se no commit — reforça foco no layout. */
  useLayoutEffect(() => {
    if (phoneOtpInputMountKey === 0) return;
    const el = phoneOtpInputRef.current;
    if (!el) return;
    try {
      el.focus({ preventScroll: true });
    } catch {
      el.focus();
    }
  }, [phoneOtpInputMountKey]);

  const [signupEmailLinkSentOnce, setSignupEmailLinkSentOnce] = useState(false);
  const [smsResendCooldown, setSmsResendCooldown] = useState(0);
  const [phoneSent, setPhoneSent] = useState(false);

  /**
   * Painéis técnicos / URLs / [DEV]: apenas em desenvolvimento local com opt-in.
   * Em `next build` / produção é sempre false — nada de protótipo visível ao utilizador.
   */
  const registerDevUi =
    process.env.NODE_ENV !== "production" && process.env.NEXT_PUBLIC_DECIDE_REGISTER_DEV_UI === "1";
  /** Botão de reset de onboarding: activo sempre que NEXT_PUBLIC_DECIDE_REGISTER_DEV_UI=1, incluindo produção. */
  const devResetEnabled = process.env.NEXT_PUBLIC_DECIDE_REGISTER_DEV_UI === "1";
  /** O painel de código SMS (passo 2) só quando é obrigatório ou (dev) simulação de SMS. Evita textos a prometer SMS que não chega. */
  const showPhoneSmsInWizardStep2 = true;
  const [wizardStep, setWizardStep] = useState<1 | 2>(1);
  /** Depois de restaurar sessionStorage (ou confirmar que não há rascunho), gravamos alterações sem sobrescrever o draft antes da leitura. */
  const [registerDraftReady, setRegisterDraftReady] = useState(false);
  const [registerSubmitBusy, setRegisterSubmitBusy] = useState(false);

  const strength = useMemo(() => evaluatePasswordStrength(password), [password]);
  const passwordsMatch = password.length > 0 && password === passwordConfirm;

  function resetMsgs() {
    setMsg("");
    setError("");
  }

  const emailLooksValid = useMemo(() => {
    const em = email.trim();
    return em.length > 0 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em);
  }, [email]);

  const prevEmailForUsernameRef = useRef<string>("");
  /** Preenche o utilizador a partir do email (por defeito); mantém edição manual excepto quando ainda coincide com a sugestão antiga. */
  useEffect(() => {
    if (!registerDraftReady) return;
    const em = email.trim().toLowerCase();
    if (!emailLooksValid) {
      prevEmailForUsernameRef.current = em;
      return;
    }
    const prev = prevEmailForUsernameRef.current;
    prevEmailForUsernameRef.current = em;
    const suggested = suggestClientUsernameFromEmail(email);
    if (!suggested) return;
    setUsername((cur) => {
      const t = cur.trim().toLowerCase();
      if (!t) return suggested;
      if (!prev) return cur;
      const prevDerived = deriveClientUsernameFromEmail(prev);
      if (prevDerived.length >= 2 && t === prevDerived.toLowerCase()) return suggested;
      const prevSug = suggestClientUsernameFromEmail(prev);
      if (prevSug && t === prevSug.toLowerCase()) return suggested;
      return cur;
    });
  }, [registerDraftReady, email, emailLooksValid]);

  function validateRegisterUsernameInput(): string | null {
    const uRaw = username.trim().toLowerCase();
    if (!uRaw || uRaw.length < 2) {
      return "Indique o utilizador (login). É o valor a usar no descritivo da transferência para a IBKR.";
    }
    if (!/^[a-z0-9._-]+$/.test(uRaw)) {
      return "Utilizador só pode ter letras minúsculas, números, ponto, _ e hífen.";
    }
    return null;
  }

  function goWizardNextFromStep1() {
    resetMsgs();
    setRegFieldErr({});
    if (!emailLooksValid) {
      setRegFieldErr({ email: true });
      setError("Indique um email válido.");
      return;
    }
    const ph = normalizeClientPhone(phone);
    if (!ph.ok) {
      setRegFieldErr({ phone: true });
      setError(ph.error);
      return;
    }
    const userErr = validateRegisterUsernameInput();
    if (userErr) {
      setRegFieldErr({ username: true });
      setError(userErr);
      return;
    }
    if (!strength.ok) {
      setRegFieldErr({ password: true });
      setError(`Password fraca. ${passwordStrengthSummary()}`);
      return;
    }
    if (!passwordsMatch) {
      setRegFieldErr({ passwordConfirm: true });
      setError("As passwords não coincidem.");
      return;
    }
    // Mostrar verificação inline (sem mudar de passo/página)
    setWizardStep(2);
    // Enviar email automaticamente se ainda não foi enviado
    if (!signupEmailLinkSentOnce && !signupEmailOk) {
      void sendSignupVerification();
    }
  }

  async function goWizardNextFromStep2() {
    resetMsgs();
    // Email verification is recommended but no longer a hard blocker — account is created
    // immediately and verification can happen afterward via the link sent post-registration.
    if (phoneSmsRequiredForSignup && !signupPhoneOk) {
      setRegFieldErr((x) => ({ ...x, phoneNotVerified: true }));
      setError("Confirme o telemóvel por SMS antes de criar a conta.");
      return;
    }
    /** Link de confirmação *pré-registo* já cumpriu o papel — esconder caixa azul antes de criar conta. */
    setSignupDevLink(null);
    setPostRegisterEmailLinkActive(false);
    await submitRegister();
  }

  const signupEmailOk = useMemo(
    () => isSignupEmailVerifiedForInput(email),
    [email, storageTick],
  );

  const signupPhoneOk = useMemo(() => {
    if (!smsVerificationEnabled || !phoneSmsRequiredForSignup) return true;
    return isSignupPhoneVerifiedForInput(phone);
  }, [smsVerificationEnabled, phoneSmsRequiredForSignup, phone, storageTick]);

  const phoneMaskedForSms = useMemo(() => {
    const ph = normalizeClientPhone(phone);
    return ph.ok ? formatPhoneForDisplayMasked(ph.e164) : "";
  }, [phone]);

  /** Evita o mesmo texto no banner global e na caixa do SMS (estado antigo / race / build antigo). */
  const showGlobalErrorBanner = useMemo(() => {
    if (!error) return false;
    if (wizardStep !== 2 || !smsVerificationEnabled) return true;
    const fb = phoneVerifyFeedback;
    if (!fb || fb.startsWith("✓")) return true;
    if (error === fb) return false;
    const minLen = 28;
    if (error.length >= minLen && fb.startsWith(error)) return false;
    if (fb.length >= minLen && error.startsWith(fb)) return false;
    return true;
  }, [error, wizardStep, smsVerificationEnabled, phoneVerifyFeedback]);

  /** Remove `error` duplicado do painel SMS (evita estado «fantasma» noutros fluxos). */
  useEffect(() => {
    if (wizardStep !== 2 || !smsVerificationEnabled) return;
    const fb = phoneVerifyFeedback;
    if (!fb || fb.startsWith("✓")) return;
    setError((prev) => {
      if (!prev) return prev;
      if (prev === fb) return "";
      const minLen = 28;
      if (prev.length >= minLen && fb.startsWith(prev)) return "";
      if (fb.length >= minLen && prev.startsWith(fb)) return "";
      return prev;
    });
  }, [wizardStep, smsVerificationEnabled, phoneVerifyFeedback]);

  /** Restaura passo e campos após F5 / remount (evita voltar sempre ao passo 1). */
  useEffect(() => {
    const s = readRegisterWizardDraft();
    if (s) {
      setEmail(s.email || "");
      setPhone(s.phone || "");
      setUsername(s.username || "");
      setPassword(s.password || "");
      setPasswordConfirm(s.passwordConfirm || "");
      setPhoneOtpProof(typeof s.phoneOtpProof === "string" ? s.phoneOtpProof : "");
      let step: 1 | 2 = s.step;
      const em = (s.email || "").trim();
      const ph = normalizeClientPhone(s.phone || "");
      if (step >= 2) {
        const uOk = (s.username || "").trim().length >= 2;
        if (!em || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em) || !ph.ok || !uOk) {
          step = 1;
        }
      }
      setWizardStep(step);
    }
    setRegisterDraftReady(true);
  }, []);

  /** Grava rascunho (sessionStorage, só neste separador). */
  useEffect(() => {
    if (!registerDraftReady) return;
    writeRegisterWizardDraft({
      step: wizardStep,
      email,
      phone,
      username,
      password,
      passwordConfirm,
      phoneOtpProof,
    });
  }, [registerDraftReady, wizardStep, email, phone, username, password, passwordConfirm, phoneOtpProof]);

  const loadPhoneVerificationConfig = useCallback(async () => {
    setPhoneConfigLoading(true);
    try {
      const r = await fetch("/api/client/phone-verification/config");
      if (!r.ok) {
        setPhoneConfigLoadFailed(true);
        setSmsVerificationEnabled(false);
        setPhoneSmsRequiredForSignup(false);
        setPhoneVerifyDiag({
          twilioConfigured: false,
          allowClientPhoneVerify: false,
          devSignupSmsSimulate: false,
          phoneOtpProofEnabled: false,
        });
        return;
      }
      const j = (await r.json()) as {
        smsVerificationEnabled?: boolean;
        twilioConfigured?: boolean;
        allowClientPhoneVerify?: boolean;
        devSignupSmsSimulate?: boolean;
        phoneSmsRequiredForSignup?: boolean;
        phoneOtpProofEnabled?: boolean;
      };
      setPhoneConfigLoadFailed(false);
      const smsOn = j.smsVerificationEnabled === true;
      setSmsVerificationEnabled(smsOn);
      const req = typeof j.phoneSmsRequiredForSignup === "boolean" ? j.phoneSmsRequiredForSignup : false;
      setPhoneSmsRequiredForSignup(req);
      setPhoneVerifyDiag({
        twilioConfigured: j.twilioConfigured === true,
        allowClientPhoneVerify: j.allowClientPhoneVerify === true,
        devSignupSmsSimulate: j.devSignupSmsSimulate === true,
        phoneOtpProofEnabled: j.phoneOtpProofEnabled === true,
      });
    } catch {
      setPhoneConfigLoadFailed(true);
      setSmsVerificationEnabled(false);
      setPhoneSmsRequiredForSignup(false);
      setPhoneVerifyDiag({
        twilioConfigured: false,
        allowClientPhoneVerify: false,
        devSignupSmsSimulate: false,
        phoneOtpProofEnabled: false,
      });
    } finally {
      setPhoneConfigLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadPhoneVerificationConfig();
  }, [loadPhoneVerificationConfig]);

  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key === "decide_signup_email_verified_v1") {
        setStorageTick((t) => t + 1);
      }
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    void fetch("/api/client/email-link-base")
      .then((r) => r.json())
      .then((j: { ok?: boolean; linkBase?: string; localhost?: boolean; hint?: string }) => {
        if (j.ok && j.linkBase) {
          setEmailLinkDiag({
            linkBase: j.linkBase,
            localhost: Boolean(j.localhost),
            hint: j.hint || "",
          });
        }
      })
      .catch(() => {});
  }, []);

  /** Se confirmaste o email noutro dispositivo, o servidor regista — sincronizamos localStorage no PC. */
  useEffect(() => {
    const em = email.trim().toLowerCase();
    if (!em.includes("@")) return;
    let cancelled = false;
    async function poll() {
      if (cancelled || isSignupEmailVerifiedForInput(email)) return;
      const ok = await fetchSignupEmailVerifiedFromServer(em);
      if (cancelled || !ok) return;
      setSignupEmailVerifiedFromServerEmail(em);
      setStorageTick((t) => t + 1);
    }
    void poll();
    const id = window.setInterval(() => void poll(), 8000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [email]);

  /** Confirmação SMS noutro dispositivo — sincroniza localStorage (GET /phone-verification/status). */
  useEffect(() => {
    if (!smsVerificationEnabled) return;
    const ph = normalizeClientPhone(phone);
    if (!ph.ok) return;
    const phoneE164 = ph.e164;
    if (isSignupPhoneVerifiedForInput(phone)) return;
    let cancelled = false;
    async function poll() {
      if (cancelled || isSignupPhoneVerifiedForInput(phone)) return;
      const ok = await fetchSignupPhoneVerifiedFromServer(phone);
      if (cancelled || !ok) return;
      setSignupPhoneVerifiedFromServerPhone(phoneE164);
      setStorageTick((t) => t + 1);
    }
    void poll();
    /** 12s: menos ruído na aba Rede; resposta típica {"ok":true,"verified":false} até confirmares o código. */
    const id = window.setInterval(() => void poll(), 12_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [phone, smsVerificationEnabled]);

  /** Evita ficar preso em «A enviar…» se algo falhar sem correr o finally. */
  useEffect(() => {
    if (!signupSendBusy) return;
    const t = window.setTimeout(() => {
      setSignupSendBusy(false);
      setError(
        (prev) =>
          prev ||
          (registerDevUi
            ? "O pedido demorou demasiado. Recarregue a página, confirme que `npm run dev` está a correr e tente outra vez."
            : "O pedido demorou demasiado. Recarregue a página e tente outra vez."),
      );
    }, 95_000);
    return () => window.clearTimeout(t);
  }, [signupSendBusy, registerDevUi]);

  useEffect(() => {
    if (smsResendCooldown <= 0) return undefined;
    const id = window.setInterval(() => {
      setSmsResendCooldown((s) => (s <= 1 ? 0 : s - 1));
    }, 1000);
    return () => window.clearInterval(id);
  }, [smsResendCooldown]);

  const sendLinkInFlight = useRef(false);

  async function sendSignupVerification() {
    if (signupSendBusy || sendLinkInFlight.current) return;
    resetMsgs();
    setSignupDevLink(null);
    setRegFieldErr({});
    const em = email.trim();
    if (!em || !em.includes("@")) {
      setRegFieldErr({ email: true });
      setError("Indique um email válido.");
      return;
    }
    sendLinkInFlight.current = true;
    setSignupSendBusy(true);
    try {
      const vr = await requestEmailVerificationSignupSend(em);
      // Importante: window.prompt bloqueia a UI; o finally só corre depois — o botão ficava em «A enviar…».
      setSignupSendBusy(false);
      if (vr.link) {
        setSignupDevLink(vr.link);
        setSignupEmailLinkSentOnce(true);
        if (registerDevUi) void navigator.clipboard?.writeText(vr.link).catch(() => {});
      }
      if (vr.mode === "simulated" && vr.link) {
        setMsg(
          registerDevUi
            ? "Sem envio real para o Gmail — o servidor não tem Resend nem Gmail configurados. Utilize «Ferramentas de teste» para copiar o link no PC."
            : "Nenhum email foi enviado (modo simulado: o servidor não tem Resend nem Gmail). O Gmail no telemóvel fica vazio até configurar RESEND_API_KEY ou GMAIL_USER + GMAIL_APP_PASSWORD em frontend/.env.local, reiniciar npm run dev e carregar em Reenviar. Para ver o link de confirmação nesta página sem email, defina NEXT_PUBLIC_DECIDE_REGISTER_DEV_UI=1 e reinicie o servidor de desenvolvimento.",
        );
      } else if (!vr.ok) {
        const isApiDisabled = vr.error?.includes("api_disabled");
        setError(
          isApiDisabled
            ? "A verificação por email não está ativa neste servidor. Configure ALLOW_CLIENT_NOTIFY_API=1 e VERIFY_EMAIL_SECRET no frontend/.env.local e reinicie o servidor."
            : (vr.error || "Não foi possível enviar o email."),
        );
      } else {
        const outboundHint =
          registerDevUi && vr.outboundId
            ? vr.provider === "resend"
              ? ` ID Resend: ${vr.outboundId}. Em https://resend.com/emails confere o estado (delivered / bounced / delayed). `
              : ` ID envio: ${vr.outboundId}. `
            : "";
        setMsg(
          registerDevUi
            ? `O servidor aceitou o envio (${vr.provider || "email"}).${outboundHint}Se não aparecer no Gmail: Spam, Promoções, ou pesquise por «DECIDE». Noutro dispositivo na mesma rede, confirme nas ferramentas de teste se o link abre.`
            : "Enviámos um email com um link de confirmação.",
        );
      }
    } catch {
      setError("Erro inesperado ao pedir o link.");
    } finally {
      sendLinkInFlight.current = false;
      setSignupSendBusy(false);
    }
  }

  /** Sincroniza com o servidor após o utilizador abrir o link no email (outro separador / telemóvel). */
  async function handleAlreadyConfirmedEmailClick() {
    resetMsgs();
    const em = email.trim().toLowerCase();
    if (!em.includes("@")) return;
    try {
      const ok = await fetchSignupEmailVerifiedFromServer(em);
      if (ok) {
        setSignupEmailVerifiedFromServerEmail(em);
        setStorageTick((t) => t + 1);
        setMsg("Email confirmado.");
        return;
      }
    } catch {
      // fall through
    }
    window.location.reload();
  }

  async function sendPhoneVerificationSms() {
    if (phoneSmsBusy || smsResendCooldown > 0) return;

    const ph = normalizeClientPhone(phone);
    if (!ph.ok) {
      flushSync(() => {
        resetMsgs();
        setPhoneSmsMsg("");
        setPhoneVerifyFeedback("");
        setPhoneOtpProof("");
        setPhoneOtp("");
        setPhoneOtpInputMountKey((k) => k + 1);
        setRegFieldErr((x) => ({ ...x, phone: true }));
        setError(ph.error);
      });
      focusPhoneOtpField();
      return;
    }

    flushSync(() => {
      resetMsgs();
      setPhoneSmsMsg("");
      setPhoneVerifyFeedback("");
      setPhoneOtpProof("");
      setPhoneOtp("");
      setPhoneOtpInputMountKey((k) => k + 1);
      setRegFieldErr((x) => ({ ...x, phone: false, phoneNotVerified: false }));
      setPhoneSmsBusy(true);
    });
    focusPhoneOtpField();

    try {
      const r = await fetch("/api/client/phone-verification/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: ph.e164 }),
      });
      const text = await r.text();
      let j: { ok?: boolean; error?: string; devOtp?: string; otpProof?: string } = {};
      try {
        j = text
          ? (JSON.parse(text) as { ok?: boolean; error?: string; devOtp?: string; otpProof?: string })
          : {};
      } catch {
        const snippet = text.trim().slice(0, 140).replace(/\s+/g, " ");
        const looksHtml = /^\s*</.test(text) || /<html[\s>]/i.test(text.slice(0, 300));
        setError(
          registerDevUi
            ? `Resposta inválida (HTTP ${r.status}). Corpo: ${text.slice(0, 160).replace(/\s+/g, " ")}`
            : looksHtml
              ? `O servidor devolveu uma página de erro (HTTP ${r.status}), não JSON — típico de crash ou timeout na API. Veja «Functions» / Runtime logs deste deployment na Vercel ao carregar em «Enviar código SMS».`
              : snippet
                ? `Resposta inválida do servidor (HTTP ${r.status}): ${snippet}${text.length > 140 ? "…" : ""}`
                : `Resposta vazia ou inválida do servidor (HTTP ${r.status}). Verifique a ligação e os logs na Vercel.`,
        );
        return;
      }
      if (!r.ok || !j.ok) {
        setSmsResendCooldown(0);
        const api403Dev =
          "403 no pedido (ainda não chegou à Twilio). Tente a mesma URL do dev, desligue a VPN ou confirme que POST /api não está bloqueado.";
        const twilio502Dev = "O envio SMS falhou no servidor. Veja o terminal do npm run dev.";
        setError(
          j.error ||
            (r.status === 503
              ? registerDevUi
                ? "SMS desligado no servidor (veja DEV_SIGNUP_SMS_SIMULATE ou Twilio em .env.local)."
                : "Confirmação por SMS não está disponível neste momento."
              : r.status === 403
                ? registerDevUi
                  ? api403Dev
                  : "Pedido recusado. Atualize a página e tente outra vez."
                : r.status === 502
                  ? registerDevUi
                    ? twilio502Dev
                    : "Não foi possível enviar o SMS. Tente mais tarde."
                  : `Erro HTTP ${r.status}. Não foi possível enviar o SMS.`),
        );
        return;
      }
      if (typeof j.otpProof === "string" && j.otpProof.length > 0) {
        flushSync(() => {
          setPhoneOtpProof(j.otpProof);
        });
      }
      focusPhoneOtpField();
      const masked = formatPhoneForDisplayMasked(ph.e164);
      if (j.devOtp && /^\d{6}$/.test(String(j.devOtp))) {
        setPhoneSmsMsg(
          registerDevUi
            ? `Código para ${masked} (simulação, sem SMS real): ${j.devOtp} — válido 10 min.`
            : `Código de verificação para ${masked}. Introduza-o abaixo.`,
        );
      } else {
        setPhoneSmsMsg(`Código enviado para ${masked}. Introduza o SMS de 6 dígitos abaixo.`);
      }
      setSmsResendCooldown(30);
      setPhoneSent(true);
    } catch {
      setError("Erro de rede ao pedir o SMS.");
    } finally {
      setPhoneSmsBusy(false);
    }
  }

  async function verifyPhoneOtp() {
    if (phoneVerifyBusy) return;
    resetMsgs();
    setPhoneSmsMsg("");
    setPhoneVerifyFeedback("");
    setRegFieldErr((x) => ({ ...x, phone: false, phoneNotVerified: false }));
    const ph = normalizeClientPhone(phone);
    if (!ph.ok) {
      setRegFieldErr((x) => ({ ...x, phone: true }));
      setError(ph.error);
      return;
    }
    const code = phoneOtp
      .normalize("NFKC")
      .replace(/\D/g, "")
      .slice(0, 8);
    if (!/^\d{4,8}$/.test(code)) {
      const hint = "Introduza o código de algarismos que veio no SMS (sem espaços).";
      setError("");
      setPhoneVerifyFeedback(hint);
      return;
    }
    setPhoneVerifyBusy(true);
    const controller = new AbortController();
    const tmo = window.setTimeout(() => controller.abort(), 25_000);
    try {
      const r = await fetch("/api/client/phone-verification/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone: ph.e164,
          code,
          ...(phoneOtpProof ? { otpProof: phoneOtpProof } : {}),
        }),
        signal: controller.signal,
      });
      const text = await r.text();
      let j: { ok?: boolean; error?: string } = {};
      try {
        j = text ? (JSON.parse(text) as { ok?: boolean; error?: string }) : {};
      } catch {
        const snippet = text.trim().slice(0, 120).replace(/\s+/g, " ");
        const looksHtml = /^\s*</.test(text) || /<html[\s>]/i.test(text.slice(0, 300));
        const fb = registerDevUi
          ? snippet
            ? `Resposta inválida (${r.status}). ${snippet}`
            : `Resposta vazia (${r.status}). Reinicie o servidor de desenvolvimento.`
          : looksHtml
            ? `O servidor devolveu erro (HTTP ${r.status}), não JSON — veja os logs na Vercel no pedido de validar código.`
            : snippet
              ? `Resposta inválida (HTTP ${r.status}): ${snippet}${text.length > 120 ? "…" : ""}`
              : `Resposta vazia ou inválida (HTTP ${r.status}). Tente outra vez.`;
        setError("");
        setPhoneVerifyFeedback(fb);
        return;
      }
      if (!r.ok || j.ok !== true) {
        const base =
          j.error ||
          (r.status === 503 ? "Verificação SMS desligada no servidor." : "Não foi possível validar o código.");
        let err = r.status === 400 || j.error ? base : `${base} (HTTP ${r.status})`;
        if (
          phoneVerifyDiag.phoneOtpProofEnabled &&
          !phoneOtpProof &&
          /incorreto ou expirado/i.test(err)
        ) {
          err +=
            " Carregue em «Enviar código SMS» outra vez e utilize o código desse envio — falta a prova de sessão no browser (ex.: página recarregada ou separador novo).";
        }
        setError("");
        setPhoneVerifyFeedback(err);
        return;
      }
      setError("");
      setSignupPhoneVerifiedFromServerPhone(ph.e164);
      setStorageTick((t) => t + 1);
      setPhoneOtp("");
      setPhoneOtpProof("");
      const okMsg = "Telemóvel confirmado.";
      setMsg(okMsg);
      setPhoneVerifyFeedback("✓ Código aceite. Continue para o passo seguinte.");
      window.requestAnimationFrame(() => {
        phoneFeedbackRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      });
    } catch (e) {
      const aborted = e instanceof DOMException && e.name === "AbortError";
      const netMsg = aborted
        ? "O pedido demorou demasiado. Verifique a rede e tente outra vez."
        : "Erro de rede ao validar o código.";
      setError("");
      setPhoneVerifyFeedback(netMsg);
    } finally {
      window.clearTimeout(tmo);
      setPhoneVerifyBusy(false);
    }
  }

  async function submitRegister() {
    resetMsgs();
    setRegFieldErr({});
    const userErr = validateRegisterUsernameInput();
    if (userErr) {
      setRegFieldErr({ username: true });
      setError(userErr);
      setWizardStep(1);
      return;
    }
    const u = username.trim().toLowerCase();
    setUsername(u);
    setRegisterSubmitBusy(true);
    try {
      const res = registerClientUser(u, password, passwordConfirm, email, phone, {
        requirePhoneSms: phoneSmsRequiredForSignup,
      });
      if (!res.ok) {
        if (res.field) {
          setRegFieldErr({ [res.field]: true });
        }
        setError(res.error || "Falha ao criar conta.");
        return;
      }
      // Persist to server (fire-and-forget; localStorage is already written by registerClientUser)
      void registerClientUserAsync({
        username: u,
        password,
        email: email.trim(),
        phone: normalizeClientPhone(phone).ok
          ? (normalizeClientPhone(phone) as { ok: true; e164: string }).e164
          : phone,
        emailVerified: isSignupEmailVerifiedForInput(email.trim()),
      });
      setMsg("Conta criada. A iniciar sessão…");
      const loginRes = loginClientUser(u, password);
      if (!loginRes.ok) {
        setError(loginRes.error || "Falha ao fazer login após registo.");
        return;
      }
      clearRegisterWizardDraft();
      setClientSegment(clientSegment);
      if (isSessionEmailVerified()) {
        goToMontanteWithSimPrefill();
        return;
      }
      const normUser = u.trim().toLowerCase();
      const em = email.trim();
      setSignupDevLink(null);
      setPostRegisterEmailLinkActive(false);
      setMsg("A enviar email de confirmação da conta…");
      const vr = await requestEmailVerificationSend(normUser, em);
      if (vr.mode === "simulated" && vr.link) {
        // Não redireccionar: senão perdes o link (não há email real sem RESEND_API_KEY).
        setSignupDevLink(vr.link);
        setPostRegisterEmailLinkActive(true);
        setMsg(
          registerDevUi
            ? "Conta criada. Sem envio configurado: confirme com o link na caixa; só depois avance. Para Gmail, defina GMAIL_USER + GMAIL_APP_PASSWORD."
            : "Conta criada. Confirme o email com o link mostrado antes de continuar.",
        );
        void navigator.clipboard?.writeText(vr.link).catch(() => {});
        return;
      }
      if (!vr.ok) {
        setError(vr.error || "Não foi possível enviar o email de confirmação agora.");
        setMsg("Conta criada. Corrija o envio (mensagem acima) ou utilize «Reenviar» no dashboard.");
        return;
      }
      setMsg("Conta criada. Enviámos um email com o link de confirmação (válido 48h).");
      goToMontanteWithSimPrefill();
    } finally {
      setRegisterSubmitBusy(false);
    }
  }

  return (
    <>
      <Head>
        <title>Criar conta e começar a investir — DECIDE</title>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <style>{`html,body,#__next{background:#080c14!important;background-attachment:initial!important}`}</style>
      </Head>
      {/* Sticky header */}
      <OnboardingFlowBar currentStepId="auth" currentStepAlwaysActive />

      <div
        style={{
          minHeight: "100vh",
          background: "#080c14",
          color: "#e2e8f0",
          fontFamily: "'Nunito', 'Segoe UI', system-ui, sans-serif",
          padding: wizardStep === 1 ? "0 max(16px, 3vw) 40px" : "40px max(20px, 4vw) 60px",
          boxSizing: "border-box",
        }}
      >
        {/* Page heading — só no passo 2 */}
        {wizardStep === 2 && (
          <div style={{ maxWidth: 480, margin: "0 auto 32px", textAlign: "center" }}>
            <h1 style={{ fontSize: "clamp(24px, 4vw, 32px)", fontWeight: 800, lineHeight: 1.2, margin: "0 0 10px", color: "#f1f5f9" }}>
              Verificar email e telemóvel
            </h1>
            <p style={{ margin: 0, fontSize: 15, color: "#64748b", lineHeight: 1.6 }}>
              Confirme o email e o telemóvel para concluir o registo.
            </p>
          </div>
        )}

        <div>

          {wizardStep === 2 && privateLanHost ? (
            <div
              style={{
                fontSize: 12,
                color: "#71717a",
                lineHeight: 1.5,
                marginBottom: 14,
                maxWidth: 560,
                padding: "10px 12px",
                borderRadius: 12,
                background: "rgba(51, 65, 85, 0.25)",
                border: "1px solid rgba(148, 163, 184, 0.2)",
              }}
            >
              Rede local: se o telemóvel mostrar este IP como <strong>inacessível</strong>, o servidor no PC pode ter
              parado, o IP ter mudado (DHCP), ou o telemóvel não estar na mesma Wi‑Fi. No PC confirma{" "}
              <code style={{ color: "#a1a1aa" }}>ipconfig</code>, <code style={{ color: "#a1a1aa" }}>npm run dev:lan</code> e
              firewall (TCP 4701); alinha <code style={{ color: "#a1a1aa" }}>EMAIL_LINK_BASE_URL</code> com o IPv4 actual
              e volta a pedir o email de confirmação.
            </div>
          ) : null}

          {devResetEnabled ? (
            <div style={{ marginBottom: 12, display: "flex", justifyContent: "flex-end" }}>
              <button
                type="button"
                onClick={() => {
                  try {
                    Object.keys(window.localStorage)
                      .filter((k) => k.startsWith("decide_"))
                      .forEach((k) => window.localStorage.removeItem(k));
                    Object.keys(window.sessionStorage)
                      .filter((k) => k.startsWith("decide_"))
                      .forEach((k) => window.sessionStorage.removeItem(k));
                  } catch { /* ignore */ }
                  window.location.href = "/client/register";
                }}
                style={{
                  background: "transparent",
                  color: "#475569",
                  border: "1px solid #1e293b",
                  borderRadius: 8,
                  padding: "5px 12px",
                  fontWeight: 600,
                  fontSize: 11,
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                }}
              >
                Reiniciar onboarding
              </button>
            </div>
          ) : null}

          {registerDevUi ? (
            <div
              style={{
                marginBottom: 18,
                borderRadius: 14,
                border: "1px solid rgba(71, 85, 105, 0.55)",
                background: "rgba(15, 23, 42, 0.45)",
                overflow: "hidden",
                display: "none",
              }}
            >
              <button
                type="button"
                onClick={() => setDevToolsOpen((o) => !o)}
                style={{
                  width: "100%",
                  textAlign: "left",
                  padding: "12px 14px",
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                  color: "#a1a1aa",
                  fontWeight: 900,
                  fontSize: 12,
                  letterSpacing: "0.08em",
                }}
              >
                {devToolsOpen ? "Ferramentas de teste ▾" : "Ferramentas de teste ▸"}
              </button>
              {devToolsOpen ? (
                <div style={{ padding: "0 14px 16px", display: "flex", flexDirection: "column", gap: 16 }}>
                  <div
                    style={{
                      background: "rgba(15, 118, 110, 0.1)",
                      border: "1px solid rgba(45, 212, 191, 0.28)",
                      borderRadius: 12,
                      padding: 12,
                      fontSize: 13,
                      lineHeight: 1.55,
                      color: "#ccfbf1",
                    }}
                  >
                    <div style={{ fontWeight: 900, color: DECIDE_DASHBOARD.link, marginBottom: 8, fontSize: 12 }}>
                      SMS / Twilio
                    </div>
                    {smsVerificationEnabled ? (
                      phoneVerifyDiag.devSignupSmsSimulate && !phoneVerifyDiag.twilioConfigured ? (
                        <>
                          <code>DEV_SIGNUP_SMS_SIMULATE=1</code> em <code>.env.local</code> — código mostrado no ecrã, sem SMS real.
                        </>
                      ) : (
                        <>
                          <code>TWILIO_*</code> + <code>ALLOW_CLIENT_PHONE_VERIFY=1</code> para SMS real no registo.
                        </>
                      )
                    ) : (
                      <>
                        SMS no registo desligado.
                        {phoneVerifyDiag.twilioConfigured && !phoneVerifyDiag.allowClientPhoneVerify ? (
                          <span>
                            {" "}
                            Falta <code>ALLOW_CLIENT_PHONE_VERIFY=1</code>.
                          </span>
                        ) : null}
                      </>
                    )}
                    {wizardStep === 2 && !smsVerificationEnabled ? (
                      <div style={{ marginTop: 12, display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
                        <button
                          type="button"
                          onClick={() => {
                            resetMsgs();
                            setPhoneSmsMsg("");
                            const ph = normalizeClientPhone(phone);
                            if (!ph.ok) {
                              setPhoneFormatHint({ ok: false, text: ph.error });
                              setRegFieldErr((x) => ({ ...x, phone: true }));
                              return;
                            }
                            setPhoneFormatHint({
                              ok: true,
                              text: `Formato OK (${ph.e164}).`,
                            });
                            setRegFieldErr((x) => ({ ...x, phone: false }));
                          }}
                          style={{
                            background: "#334155",
                            color: "#e2e8f0",
                            borderRadius: 12,
                            padding: "8px 14px",
                            fontSize: 12,
                            fontWeight: 800,
                            border: "1px solid rgba(148,163,184,0.35)",
                            cursor: "pointer",
                          }}
                        >
                          Validar formato (tel.)
                        </button>
                        {phoneFormatHint ? (
                          <span
                            style={{
                              fontSize: 12,
                              fontWeight: 700,
                              color: phoneFormatHint.ok ? DECIDE_DASHBOARD.accentSky : "#fca5a5",
                            }}
                          >
                            {phoneFormatHint.text}
                          </span>
                        ) : null}
                      </div>
                    ) : null}
                  </div>

                  <div>
                    <div style={{ fontWeight: 900, marginBottom: 8, fontSize: 12, color: "#e2e8f0" }}>Links</div>
                    {emailLinkDiag?.localhost ? (
                      <div
                        style={{
                          background: "rgba(234, 179, 8, 0.1)",
                          border: "1px solid rgba(250, 204, 21, 0.4)",
                          borderRadius: 12,
                          padding: 12,
                          fontSize: 13,
                          lineHeight: 1.55,
                          color: "#fde68a",
                        }}
                      >
                        <div style={{ fontWeight: 900, color: "#fbbf24", marginBottom: 8 }}>
                          Teste no telemóvel: evitar endereço local no link
                        </div>
                        <div style={{ marginBottom: 10, color: "#e7e5e4" }}>
                          A base dos links aponta para um endereço que o telemóvel não consegue abrir como se fosse o seu PC. Utilize o IP da
                          máquina na rede e <code style={{ color: "#fef3c7" }}>npm run dev:lan</code>, depois volte a pedir o email.
                        </div>
                        <ol style={{ margin: 0, paddingLeft: 20, color: "#d6d3d1", fontSize: 12 }}>
                          <li>
                            No PC: <code style={{ color: "#fde68a" }}>ipconfig</code> → IPv4 (ex. 192.168.x.x).
                          </li>
                          <li>
                            Em <code style={{ color: "#fde68a" }}>.env.local</code>: base de links com esse IP e porta do Next.
                          </li>
                          <li>
                            Reinicie o servidor e peça de novo o email de confirmação.
                          </li>
                        </ol>
                      </div>
                    ) : emailLinkDiag && !emailLinkDiag.localhost ? (
                      <div
                        style={{
                          background: "rgba(51, 65, 85, 0.45)",
                          border: "1px solid rgba(148, 163, 184, 0.35)",
                          borderRadius: 12,
                          padding: 12,
                          fontSize: 12,
                          color: "#cbd5e1",
                        }}
                      >
                        Base de links configurada para rede local — adequado a <code style={{ color: "#e2e8f0" }}>dev:lan</code>.
                      </div>
                    ) : (
                      <div style={{ fontSize: 12, color: "#71717a", lineHeight: 1.45 }}>
                        Base de links: aparece após pedir um email de confirmação (ou reenvio).
                      </div>
                    )}
                  </div>

                  <div
                    style={{
                      background: "rgba(234, 179, 8, 0.08)",
                      border: "1px solid rgba(250, 204, 21, 0.35)",
                      borderRadius: 12,
                      padding: 12,
                      fontSize: 13,
                      lineHeight: 1.5,
                      color: "#fde68a",
                    }}
                  >
                    <div style={{ fontWeight: 900, color: "#fbbf24", marginBottom: 8, fontSize: 12 }}>Email (testes)</div>
                    <ul style={{ margin: 0, paddingLeft: 18 }}>
                      <li>
                        <code>.env.local</code>: <code>VERIFY_EMAIL_SECRET</code>, Resend ou <code>GMAIL_USER</code> +{" "}
                        <code>GMAIL_APP_PASSWORD</code> — veja <code>.env.local.example</code>.
                      </li>
                      <li>Sem provedor: copie o link na secção «Confirmação simulada» abaixo e abra no browser.</li>
                    </ul>
                  </div>

                  {signupDevLink && (wizardStep === 1 || wizardStep === 2 || postRegisterEmailLinkActive) ? (
                    <div
                      style={{
                        background: "rgba(51, 65, 85, 0.5)",
                        border: "1px solid rgba(148, 163, 184, 0.4)",
                        borderRadius: 12,
                        padding: 12,
                        fontSize: 12,
                        lineHeight: 1.5,
                        color: "#cbd5e1",
                      }}
                    >
                      <div style={{ fontWeight: 900, color: "#e2e8f0", marginBottom: 8, fontSize: 12 }}>
                        Confirmação simulada (sem envio real)
                      </div>
                      <p style={{ margin: "0 0 10px", color: "#a1a1aa" }}>
                        Copie o link, abra noutro separador ou no telemóvel; no ecrã principal utilize «Já confirmei o email».
                      </p>
                      {devConfirmationLinkUsesLoopback(signupDevLink) ? (
                        <div
                          style={{
                            marginBottom: 10,
                            padding: "8px 10px",
                            borderRadius: 10,
                            background: "rgba(234, 179, 8, 0.12)",
                            border: "1px solid rgba(250, 204, 21, 0.35)",
                            color: "#fde68a",
                            fontSize: 11,
                            lineHeight: 1.45,
                          }}
                        >
                          Para testar no telemóvel na mesma Wi‑Fi, o link não pode usar o endereço local da máquina — utilize o IP da rede e volte
                          a pedir o email.
                        </div>
                      ) : null}
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
                        <button
                          type="button"
                          onClick={() => {
                            void copyTextToClipboardSafe(signupDevLink).then((ok) =>
                              setMsg(
                                ok
                                  ? "Link copiado."
                                  : "Não foi possível copiar — seleccione o texto abaixo manualmente.",
                              ),
                            );
                          }}
                          style={{
                            background: DECIDE_DASHBOARD.buttonTealCta,
                            color: DECIDE_DASHBOARD.kpiMenuMainButtonColor,
                            border: DECIDE_DASHBOARD.kpiMenuMainButtonBorder,
                            borderRadius: 10,
                            padding: "8px 14px",
                            fontWeight: 800,
                            fontSize: 12,
                            cursor: "pointer",
                            boxShadow: DECIDE_DASHBOARD.kpiMenuMainButtonShadow,
                          }}
                        >
                          Copiar link
                        </button>
                      </div>
                      <code
                        style={{
                          display: "block",
                          fontSize: 10,
                          color: "#71717a",
                          wordBreak: "break-all",
                          lineHeight: 1.4,
                        }}
                      >
                        {signupDevLink}
                      </code>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}

          {showGlobalErrorBanner ? (
            <div style={{ background: "#2a0a0a", border: "1px solid #7f1d1d", borderRadius: 14, padding: 14, marginBottom: 12 }}>
              {error}
            </div>
          ) : null}
          {msg ? (
            <div
              style={{
                background: "rgba(5, 46, 26, 0.28)",
                border: "1px solid rgba(22, 101, 52, 0.45)",
                borderRadius: 12,
                padding: "10px 12px",
                marginBottom: 10,
                fontSize: 13,
                color: "#bbf7d0",
                lineHeight: 1.45,
              }}
            >
              {msg}
            </div>
          ) : null}

          <div>

            {/* ── PASSO 1: layout de duas colunas ── */}
            {wizardStep === 1 && (
              <div style={{
                display: "grid",
                gridTemplateColumns: "minmax(0, 360px) 1fr",
                maxWidth: "min(1200px, 100%)",
                margin: "0 auto",
                border: "1px solid #1a1f2e",
                borderTop: "none",
                overflow: "hidden",
                minHeight: "calc(100vh - 88px)",
              }}>

                {/* ── PAINEL ESQUERDO ── */}
                <div style={{ background: "#07090f", padding: "44px 36px", borderRight: "1px solid #1a1f2e", display: "flex", flexDirection: "column", gap: 20 }}>

                  {/* Título */}
                  <div>
                    <h1 style={{ fontSize: 24, fontWeight: 800, color: "#f1f5f9", margin: "0 0 8px", lineHeight: 1.25 }}>Criar conta</h1>
                    <p style={{ margin: "0 0 14px", fontSize: 14, color: "#64748b", lineHeight: 1.6 }}>Vamos começar com os seus dados.</p>
                    <div style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: "#334155", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 999, padding: "4px 14px" }}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
                      Demora cerca de 3–5 minutos
                    </div>
                  </div>

                  {/* Features */}
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: "#475569", letterSpacing: "0.07em", textTransform: "uppercase", marginBottom: 14 }}>O que inclui a sua conta</div>
                    {([
                      { color: "#2dd4bf", label: "AI & Research de classe institucional", sub: "Modelos proprietários e análise avançada." },
                      { color: "#60a5fa", label: "Controlo total, sempre", sub: "A decisão final é sempre sua." },
                      { color: "#a78bfa", label: "Relatórios e performance", sub: "Acompanhe, analise e otimize." },
                      { color: "#34d399", label: "Segurança e privacidade", sub: "Encriptação TLS e conformidade RGPD." },
                    ] as Array<{color: string; label: string; sub: string}>).map(f => (
                      <div key={f.label} style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 12 }}>
                        <div style={{ width: 30, height: 30, borderRadius: 8, background: `${f.color}1a`, border: `1px solid ${f.color}40`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                          <div style={{ width: 9, height: 9, borderRadius: "50%", background: f.color }} />
                        </div>
                        <div>
                          <div style={{ fontSize: 13, fontWeight: 600, color: "#e2e8f0", lineHeight: 1.3 }}>{f.label}</div>
                          <div style={{ fontSize: 12, color: "#475569", marginTop: 2 }}>{f.sub}</div>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Tipo de conta */}
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: "#475569", letterSpacing: "0.07em", textTransform: "uppercase", marginBottom: 10 }}>Escolha o seu tipo de conta</div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {(["premium", "private"] as const).map((seg) => {
                        const selected = clientSegment === seg;
                        const label = seg === "premium" ? "Premium" : "Private";
                        const minLabel = seg === "premium" ? "mín. 5 000 €" : "mín. 50 000 €";
                        const tagLine = seg === "premium" ? "Investimento disciplinado com custo fixo mensal" : "Para patrimónios mais elevados";
                        const detail = seg === "premium"
                          ? "€29/mês · sem performance fee · controlo total do portefólio."
                          : "0,6%/ano · hedge cambial · análise e acompanhamento avançado.";
                        return (
                          <label key={seg} style={{ display: "flex", flexDirection: "column", gap: 5, cursor: "pointer", padding: "12px 12px", borderRadius: 12, border: selected ? (seg==="private"?"1.5px solid #d97706":"1.5px solid #3b82f6") : "1px solid #1a1f2e", background: selected ? (seg==="private"?"rgba(217,119,6,0.08)":"rgba(59,130,246,0.10)") : "#0d1118", transition: "all 0.15s ease", position: "relative" }}>
                            <div style={{ position: "absolute", top: 10, right: 10, width: 16, height: 16, borderRadius: "50%", border: selected ? (seg==="private"?"2px solid #d97706":"2px solid #3b82f6") : "2px solid rgba(255,255,255,0.15)", background: selected ? (seg==="private"?"#d97706":"#3b82f6") : "transparent", display: "flex", alignItems: "center", justifyContent: "center" }}>
                              {selected && <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#fff" }} />}
                            </div>
                            <input type="radio" name="client_segment" checked={selected} onChange={() => setClientSegmentState(seg)} style={{ display: "none" }} />
                            <div style={{ fontWeight: 700, fontSize: 13, color: "#e2e8f0", paddingRight: 22 }}>
                              {label} — <span style={{ color: "#64748b", fontWeight: 500, fontSize: 11 }}>{minLabel}</span>
                            </div>
                            <div style={{ fontSize: 12, color: selected ? (seg==="private"?"#fbbf24":"#60a5fa") : "#475569", fontWeight: 600 }}>✔ {tagLine}</div>
                            <div style={{ fontSize: 11, color: "#475569", lineHeight: 1.4 }}>{detail}</div>
                          </label>
                        );
                      })}
                    </div>
                  </div>

                  {/* Suporte */}
                  <div style={{ marginTop: "auto", paddingTop: 16, borderTop: "1px solid #1a1f2e" }}>
                    <div style={{ fontSize: 12, color: "#475569", marginBottom: 6 }}>Dúvidas? Fale connosco</div>
                    <a href="mailto:support@decide.pt" style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, color: "#38bdf8", textDecoration: "none" }}>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                      support@decide.pt
                    </a>
                  </div>
                </div>

                {/* ── PAINEL DIREITO ── */}
                <div style={{ background: "#080c14", padding: "44px 44px", display: "flex", flexDirection: "column", gap: 20, borderLeft: "1px solid #1a1f2e" }}>

                  {/* ── Dados de acesso ── */}
                  <div>
                    <div style={{ fontSize: 16, fontWeight: 700, color: "#f1f5f9", marginBottom: 16, paddingBottom: 10, borderBottom: "1px solid rgba(255,255,255,0.06)" }}>Dados de acesso</div>
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                        gap: "12px 18px",
                        alignItems: "start",
                        marginBottom: 12,
                      }}
                    >
                      {/* ── Email + verificação inline ── */}
                      <div style={{ minWidth: 0 }}>
                        <div style={{ color: "#94a3b8", fontSize: 13, marginBottom: 5, fontWeight: 500 }}>Email</div>
                        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                          <input
                            ref={registerEmailInputRef}
                            value={email}
                            onChange={(e) => {
                              setEmail(e.target.value);
                              setRegFieldErr((x) => ({ ...x, email: false, emailNotVerified: false }));
                            }}
                            onKeyDown={(e) => {
                              if (e.key !== "Enter") return;
                              e.preventDefault();
                              registerPhoneInputRef.current?.focus();
                            }}
                            style={regInputStyle(
                              { ...baseInput, width: "100%", flex: 1 },
                              !!(regFieldErr.email || regFieldErr.emailNotVerified),
                            )}
                            placeholder="nome@exemplo.com"
                            autoComplete="email"
                            disabled={signupEmailOk}
                          />
                          {signupEmailOk ? (
                            <button type="button" style={{ flexShrink: 0, background: "rgba(34,197,94,0.12)", border: "1px solid rgba(74,222,128,0.35)", color: "#22c55e", borderRadius: 8, padding: "8px 10px", fontSize: 12, fontWeight: 700, cursor: "default", whiteSpace: "nowrap" }}>Verificado ✓</button>
                          ) : emailLooksValid && !signupEmailLinkSentOnce ? (
                            <button
                              type="button"
                              disabled={signupSendBusy}
                              onClick={() => void sendSignupVerification()}
                              style={{
                                flexShrink: 0,
                                background: "rgba(59,130,246,0.15)",
                                border: "1px solid rgba(59,130,246,0.4)",
                                color: "#60a5fa",
                                borderRadius: 8,
                                padding: "8px 10px",
                                fontSize: 12,
                                fontWeight: 700,
                                cursor: "pointer",
                                whiteSpace: "nowrap",
                              }}
                            >
                              {signupSendBusy ? "…" : "Verificar"}
                            </button>
                          ) : signupEmailLinkSentOnce && !signupEmailOk ? (
                            <button
                              type="button"
                              disabled={signupSendBusy}
                              onClick={() => void sendSignupVerification()}
                              style={{
                                flexShrink: 0,
                                background: "transparent",
                                border: "1px solid #252a3a",
                                color: "#475569",
                                borderRadius: 8,
                                padding: "8px 8px",
                                fontSize: 11,
                                cursor: "pointer",
                                whiteSpace: "nowrap",
                              }}
                            >
                              {signupSendBusy ? "…" : "Reenviar"}
                            </button>
                          ) : null}
                        </div>
                        {regFieldErr.email ? (
                          <div style={{ color: "#fca5a5", fontSize: 12, marginTop: 6 }}>Email em falta ou formato inválido.</div>
                        ) : signupEmailOk ? (
                          <div style={{ color: "#22c55e", fontSize: 11, marginTop: 5 }}>Email confirmado ✓</div>
                        ) : signupEmailLinkSentOnce && signupDevLink ? (
                          <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 4 }}>
                            <div style={{ color: "#94a3b8", fontSize: 11 }}>
                              Sem email real configurado — clique no link abaixo para confirmar:
                            </div>
                            <a
                              href={signupDevLink}
                              target="_blank"
                              rel="noopener noreferrer"
                              style={{
                                display: "inline-block",
                                background: "rgba(37,99,235,0.18)",
                                border: "1px solid rgba(59,130,246,0.4)",
                                borderRadius: 8,
                                padding: "5px 10px",
                                color: "#60a5fa",
                                fontSize: 11,
                                fontWeight: 600,
                                textDecoration: "none",
                                wordBreak: "break-all",
                              }}
                            >
                              Confirmar email (link de teste) →
                            </a>
                          </div>
                        ) : signupEmailLinkSentOnce && !signupEmailOk ? (
                          <div style={{ color: "#fbbf24", fontSize: 11, marginTop: 5 }}>
                            Link enviado — verifique o email para confirmar.
                          </div>
                        ) : null}
                      </div>

                      {/* ── Telemóvel + verificação SMS inline ── */}
                      <div style={{ minWidth: 0 }}>
                        <div style={{ color: "#94a3b8", fontSize: 13, marginBottom: 5, fontWeight: 500 }}>Telemóvel</div>
                        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                          {/* PT flag selector (decorativo) */}
                          <div style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 4, padding: "11px 10px", background: "#0d1118", border: "1px solid #252a3a", borderRadius: 10, color: "#e2e8f0", lineHeight: 1, cursor: "default", userSelect: "none" }}>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src="https://flagcdn.com/20x15/pt.png" alt="PT" width={20} height={15} style={{ display: "block", borderRadius: 2 }} />
                            <span style={{ fontSize: 11, color: "#94a3b8", fontWeight: 600, letterSpacing: "0.02em" }}>+351</span>
                            <span style={{ fontSize: 9, color: "#475569" }}>▾</span>
                          </div>
                          <input
                            ref={registerPhoneInputRef}
                            value={phone}
                            onChange={(e) => {
                              setPhone(e.target.value);
                              clearSignupPhoneVerifiedFlag();
                              setPhoneFormatHint(null);
                              setRegFieldErr((x) => ({ ...x, phone: false, phoneNotVerified: false }));
                            }}
                            onKeyDown={(e) => {
                              if (e.key !== "Enter") return;
                              e.preventDefault();
                              registerUsernameInputRef.current?.focus();
                            }}
                            style={regInputStyle(
                              { ...baseInput, width: "100%", flex: 1 },
                              !!(regFieldErr.phone || regFieldErr.phoneNotVerified),
                            )}
                            placeholder="912345678"
                            autoComplete="tel"
                            inputMode="tel"
                            disabled={signupPhoneOk}
                          />
                          {signupPhoneOk ? (
                            <button type="button" style={{ flexShrink: 0, background: "rgba(59,130,246,0.15)", border: "1px solid rgba(59,130,246,0.4)", color: "#60a5fa", borderRadius: 8, padding: "8px 10px", fontSize: 12, fontWeight: 700, cursor: "default", whiteSpace: "nowrap" }}>Verificar ✓</button>
                          ) : smsVerificationEnabled && normalizeClientPhone(phone).ok && !signupPhoneOk ? (
                            <button
                              type="button"
                              disabled={phoneSmsBusy || smsResendCooldown > 0}
                              onClick={() => void sendPhoneVerificationSms()}
                              style={{
                                flexShrink: 0,
                                background: "rgba(59,130,246,0.15)",
                                border: "1px solid rgba(59,130,246,0.4)",
                                color: "#60a5fa",
                                borderRadius: 8,
                                padding: "8px 10px",
                                fontSize: 12,
                                fontWeight: 700,
                                cursor: phoneSmsBusy || smsResendCooldown > 0 ? "not-allowed" : "pointer",
                                opacity: phoneSmsBusy || smsResendCooldown > 0 ? 0.5 : 1,
                                whiteSpace: "nowrap",
                              }}
                            >
                              {phoneSmsBusy ? "…" : smsResendCooldown > 0 ? `${smsResendCooldown}s` : "SMS"}
                            </button>
                          ) : null}
                        </div>
                        {phoneSent && !signupPhoneOk && smsVerificationEnabled ? (
                          <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                            <input
                              value={phoneOtp}
                              onChange={(e) => setPhoneOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
                              placeholder="Código SMS"
                              inputMode="numeric"
                              autoComplete="one-time-code"
                              style={{ ...baseInput, flex: 1, fontSize: 13, letterSpacing: 2, textAlign: "center" }}
                            />
                            <button
                              type="button"
                              disabled={phoneVerifyBusy || phoneOtp.length < 4}
                              onClick={() => void verifyPhoneOtp()}
                              style={{
                                background: "#2563eb",
                                color: "#fff",
                                border: "none",
                                borderRadius: 8,
                                padding: "8px 12px",
                                fontSize: 12,
                                fontWeight: 700,
                                cursor: phoneVerifyBusy || phoneOtp.length < 4 ? "not-allowed" : "pointer",
                                opacity: phoneVerifyBusy || phoneOtp.length < 4 ? 0.5 : 1,
                                whiteSpace: "nowrap",
                              }}
                            >
                              {phoneVerifyBusy ? "…" : "Confirmar"}
                            </button>
                          </div>
                        ) : null}
                        {regFieldErr.phone ? (
                          <div style={{ color: "#fca5a5", fontSize: 12, marginTop: 6 }}>
                            Número inválido. Utilize +351… ou 9XXXXXXXX.
                          </div>
                        ) : signupPhoneOk ? (
                          <div style={{ color: "#22c55e", fontSize: 11, marginTop: 5 }}>Telemóvel confirmado ✓</div>
                        ) : !smsVerificationEnabled ? (
                          <div style={{ color: "#475569", fontSize: 11, marginTop: 5 }}>
                            Número associado à conta no registo.
                          </div>
                        ) : null}
                      </div>
                    </div>

                    <div style={{ color: "#475569", fontSize: 12, marginTop: -6, marginBottom: 14 }}>Enviaremos um código por SMS.</div>

                    <div style={{ width: "100%", boxSizing: "border-box" }}>
                      <div style={{ color: "#94a3b8", fontSize: 13, marginBottom: 5, fontWeight: 500 }}>
                        Nome de utilizador <span style={{ color: "#ef4444" }}>*</span>
                      </div>
                      <input
                        ref={registerUsernameInputRef}
                        value={username}
                        onChange={(e) => {
                          setUsername(e.target.value);
                          setRegFieldErr((x) => ({ ...x, username: false }));
                        }}
                        onKeyDown={(e) => {
                          if (e.key !== "Enter") return;
                          e.preventDefault();
                          registerPasswordRef.current?.focus();
                        }}
                        style={regInputStyle({ ...baseInput, width: "100%" }, !!regFieldErr.username)}
                        placeholder="ex.: maria.silva"
                        autoComplete="username"
                        spellCheck={false}
                      />
                      {regFieldErr.username ? (
                        <div style={{ color: "#fca5a5", fontSize: 12, marginTop: 5 }}>
                          {validateRegisterUsernameInput() || "Indique um utilizador válido."}
                        </div>
                      ) : (
                        <div style={{ color: "#475569", fontSize: 11, marginTop: 5, lineHeight: 1.4 }}>
                          Use este id no descritivo da transferência IB. Sugestão automática a partir do email.
                        </div>
                      )}
                    </div>
                  </div>

                  {/* ── Segurança ── */}
                  <div>
                    <div style={{ fontSize: 16, fontWeight: 700, color: "#f1f5f9", marginBottom: 16, paddingBottom: 10, borderBottom: "1px solid rgba(255,255,255,0.06)" }}>Segurança</div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      <div style={{ minWidth: 0 }}>
                        <PasswordField
                          label="Palavra-passe"
                          value={password}
                          onChange={(v) => {
                            setPassword(v);
                            setRegFieldErr((x) => ({ ...x, password: false }));
                          }}
                          placeholder="••••••••"
                          inputStyle={regInputStyle(baseInput, !!regFieldErr.password)}
                          inputRef={registerPasswordRef}
                          onInputKeyDown={(e) => {
                            if (e.key !== "Enter") return;
                            e.preventDefault();
                            registerPasswordConfirmRef.current?.focus();
                          }}
                        />
                        {regFieldErr.password ? (
                          <div style={{ color: "#fca5a5", fontSize: 12, marginBottom: 4, marginTop: -2 }}>
                            Password não cumpre os requisitos.
                          </div>
                        ) : null}
                      </div>
                      <div style={{ minWidth: 0 }}>
                        <PasswordField
                          label="Repetir palavra-passe"
                          value={passwordConfirm}
                          onChange={(v) => {
                            setPasswordConfirm(v);
                            setRegFieldErr((x) => ({ ...x, passwordConfirm: false }));
                          }}
                          placeholder="••••••••"
                          inputStyle={regInputStyle(baseInput, !!regFieldErr.passwordConfirm)}
                          inputRef={registerPasswordConfirmRef}
                          onInputKeyDown={(e) => {
                            if (e.key !== "Enter") return;
                            e.preventDefault();
                            goWizardNextFromStep1();
                          }}
                        />
                        {regFieldErr.passwordConfirm ? (
                          <div style={{ color: "#fca5a5", fontSize: 12, marginBottom: 4, marginTop: -2 }}>
                            As passwords não coincidem.
                          </div>
                        ) : null}
                      </div>
                    </div>

                    {/* PW requirements */}
                    <div style={{ marginTop: 8, padding: "8px 10px 10px", borderRadius: 10, background: "rgba(5,46,26,0.06)", border: "1px solid rgba(34,197,94,0.14)" }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: "#71717a", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 10, textAlign: "center" }}>
                        Requisitos da palavra‑passe
                      </div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, rowGap: 6, alignItems: "center", justifyContent: "center" }}>
                        <ReqPill compact ok={strength.minLength} title={`≥ ${CLIENT_PASSWORD_MIN_LENGTH} caracteres`}>≥{CLIENT_PASSWORD_MIN_LENGTH}</ReqPill>
                        <ReqPill compact ok={strength.hasUpper} title="Maiúscula">A–Z</ReqPill>
                        <ReqPill compact ok={strength.hasLower} title="Minúscula">a–z</ReqPill>
                        <ReqPill compact ok={strength.hasDigit} title="Algarismo">0–9</ReqPill>
                        <ReqPill compact ok={strength.hasSpecial} title="Símbolo (#@&)">#@&</ReqPill>
                        <ReqPill compact ok={strength.ok} title="Requisitos cumpridos">OK</ReqPill>
                      </div>
                    </div>
                  </div>

                  {/* ── Trust badges ── */}
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 16, flexWrap: "wrap" }}>
                    {[
                      { icon: "🔒", title: "Encriptação TLS", sub: "Proteção de ponta a ponta" },
                      { icon: "🛡️", title: "Em conformidade com o RGPD", sub: "Os seus dados estão seguros" },
                      { icon: "🏦", title: "Parceiro Interactive Brokers", sub: "Infraestrutura institucional" },
                    ].map(b => (
                      <div key={b.title} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, flex: "1 1 0", minWidth: 120 }}>
                        <span style={{ fontSize: 18, flexShrink: 0 }}>{b.icon}</span>
                        <div>
                          <div style={{ color: "#94a3b8", fontWeight: 600, lineHeight: 1.3, fontSize: 12 }}>{b.title}</div>
                          <div style={{ color: "#334155", fontSize: 11 }}>{b.sub}</div>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* ── CTA ── */}
                  <button
                    type="button"
                    disabled={registerSubmitBusy}
                    onClick={() => {
                      resetMsgs();
                      setRegFieldErr({});
                      if (!emailLooksValid) { setRegFieldErr({ email: true }); setError("Indique um email válido."); return; }
                      const ph = normalizeClientPhone(phone);
                      if (!ph.ok) { setRegFieldErr({ phone: true }); setError(ph.error); return; }
                      const userErr = validateRegisterUsernameInput();
                      if (userErr) { setRegFieldErr({ username: true }); setError(userErr); return; }
                      if (!strength.ok) { setRegFieldErr({ password: true }); setError(`Password fraca. ${passwordStrengthSummary()}`); return; }
                      if (!passwordsMatch) { setRegFieldErr({ passwordConfirm: true }); setError("As passwords não coincidem."); return; }
                      void goWizardNextFromStep2();
                    }}
                    style={{
                      width: "100%",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 8,
                      background: registerSubmitBusy ? "#334155" : "#3b82f6",
                      color: "#fff",
                      borderRadius: 12,
                      padding: "15px 24px",
                      fontSize: 15,
                      fontWeight: 700,
                      border: "none",
                      cursor: registerSubmitBusy ? "wait" : "pointer",
                      boxShadow: registerSubmitBusy ? "none" : "0 4px 20px rgba(59,130,246,0.35)",
                      transition: "all 0.2s ease",
                      opacity: registerSubmitBusy ? 0.7 : 1,
                    }}
                  >
                    {registerSubmitBusy ? "A criar conta…" : "Continuar →"}
                  </button>
                  <p style={{ textAlign: "center", fontSize: 12, color: "#475569", margin: 0, lineHeight: 1.5 }}>
                    Ao continuar, aceita os{" "}
                    <a href="/terms" style={{ color: "#60a5fa", textDecoration: "underline" }}>Termos de Utilização</a>
                    {" "}e a{" "}
                    <a href="/privacy" style={{ color: "#60a5fa", textDecoration: "underline" }}>Política de Privacidade</a>.
                  </p>

                </div>
              </div>
            )}


            {/* ── Bloco dev: link de confirmação e ferramentas de teste ── */}
            {wizardStep === 2 && (
              <div style={{ marginTop: 16 }}>
                <>
                  {registerDevUi && emailLinkDiag && browserHostIsLoopback && emailLinkPointsAwayFromLocalhost(emailLinkDiag.linkBase) ? (
                    <div
                      style={{
                        marginBottom: 14,
                        padding: "14px 16px",
                        borderRadius: 14,
                        background: "rgba(234, 179, 8, 0.1)",
                        border: "1px solid rgba(250, 204, 21, 0.38)",
                        color: "#e7e5e4",
                        fontSize: 12,
                        lineHeight: 1.55,
                        maxWidth: REGISTER_STEP2_MAX_PX,
                        marginLeft: "auto",
                        marginRight: "auto",
                        width: "100%",
                      }}
                    >
                      <div style={{ fontWeight: 900, color: "#fbbf24", marginBottom: 6 }}>Atenção (ambiente de testes)</div>
                      <p style={{ margin: "0 0 10px" }}>
                        Abriu o registo em <strong>localhost</strong>, mas o <strong>link dentro do email</strong> aponta para{" "}
                        <strong>outro endereço</strong> (ex.: rede local ou produção). Isso não impede o email de chegar ao telemóvel — a
                        mesma mensagem costuma aparecer na app Gmail — mas pode impedir que{" "}
                        <strong>clicar no link no telemóvel</strong> abra o seu servidor de desenvolvimento, e a página no PC pode não
                        passar a «confirmado» até o fluxo bater no URL certo.
                      </p>
                      <p style={{ margin: 0 }}>
                        <strong>O que fazer:</strong> no PC, em <code style={{ fontSize: 11, color: "#fef3c7" }}>frontend/.env.local</code>, defina{" "}
                        <code style={{ fontSize: 11, color: "#fef3c7" }}>EMAIL_LINK_BASE_URL=http://«IPv4-do-PC»:4701</code> (veja o IP no{" "}
                        <code style={{ fontSize: 11, color: "#fef3c7" }}>ipconfig</code>), execute{" "}
                        <code style={{ fontSize: 11, color: "#fef3c7" }}>npm run dev:lan</code>, telemóvel na <strong>mesma Wi‑Fi</strong>, e
                        carregue em <strong>Reenviar email</strong> para gerar links novos.
                      </p>
                    </div>
                  ) : null}
                  <div
                    style={{
                      maxWidth: REGISTER_STEP2_MAX_PX,
                      width: "100%",
                      marginLeft: "auto",
                      marginRight: "auto",
                    }}
                  >
                  <div style={{ ...registerResponsiveGrid, marginBottom: 10 }}>
                  <div style={REGISTER_STEP2_CARD_EMAIL}>
                    <div style={{ fontWeight: 900, fontSize: 18, marginBottom: 6, color: "#f8fafc", letterSpacing: "-0.02em" }}>
                      Confirmar o seu email
                    </div>
                    <p style={{ color: "#a1a1aa", fontSize: 14, margin: "0 0 14px", lineHeight: 1.55 }}>
                      {signupEmailLinkSentOnce || signupEmailOk ? (
                        <>
                          Enviámos um email para <strong style={{ color: "#e2e8f0" }}>{email.trim() || "—"}</strong>. Clique no link
                          da mensagem para continuar.
                        </>
                      ) : (
                        <>
                          O endereço abaixo é onde enviaremos o <strong style={{ color: "#e2e8f0" }}>link de confirmação</strong>.
                        </>
                      )}
                    </p>
                    <label style={{ display: "block", marginBottom: 12 }}>
                      <input
                        readOnly
                        value={email.trim()}
                        onKeyDown={(e) => {
                          if (e.key !== "Enter") return;
                          e.preventDefault();
                          if (signupEmailOk || signupSendBusy) return;
                          if (!signupEmailLinkSentOnce) void sendSignupVerification();
                          else void handleAlreadyConfirmedEmailClick();
                        }}
                        aria-label="Endereço de email a confirmar"
                        style={regInputStyle({ ...baseInput, width: "100%", cursor: "default" }, false)}
                      />
                    </label>
                    {regFieldErr.emailNotVerified ? (
                      <div style={{ color: "#fca5a5", fontSize: 13, marginBottom: 12, fontWeight: 600 }}>
                        Confirme o email com o link que enviámos antes de continuar.
                      </div>
                    ) : null}
                    {signupEmailOk ? (
                      <div
                        style={{
                          padding: "14px 16px",
                          borderRadius: 14,
                          background: "rgba(34, 197, 94, 0.1)",
                          border: "1px solid rgba(74, 222, 128, 0.35)",
                          color: "#6ee7b7",
                          fontWeight: 800,
                          fontSize: 16,
                          textAlign: "center",
                        }}
                      >
                        ✓ Email confirmado
                      </div>
                    ) : !signupEmailLinkSentOnce ? (
                      <>
                        <button
                          type="button"
                          disabled={signupSendBusy}
                          onClick={() => void sendSignupVerification()}
                          style={{
                            width: "100%",
                            borderRadius: 14,
                            padding: "14px 18px",
                            fontSize: 16,
                            fontWeight: 900,
                            cursor: signupSendBusy ? "wait" : "pointer",
                            opacity: signupSendBusy ? 0.85 : 1,
                            background: DECIDE_DASHBOARD.buttonTealCta,
                            color: DECIDE_DASHBOARD.kpiMenuMainButtonColor,
                            border: DECIDE_DASHBOARD.kpiMenuMainButtonBorder,
                            boxShadow: DECIDE_DASHBOARD.kpiMenuMainButtonShadow,
                          }}
                        >
                          {signupSendBusy ? "A enviar…" : "Enviar email de confirmação"}
                        </button>
                        <p style={{ margin: "12px 0 0", fontSize: 12, color: "#71717a", lineHeight: 1.45, textAlign: "center" }}>
                          Se não receber, verifique o spam ou tente outra vez em seguida.
                        </p>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => void handleAlreadyConfirmedEmailClick()}
                          style={{
                            width: "100%",
                            borderRadius: 14,
                            padding: "14px 18px",
                            fontSize: 16,
                            fontWeight: 900,
                            cursor: "pointer",
                            marginBottom: 10,
                            background: DECIDE_DASHBOARD.buttonTealCta,
                            color: DECIDE_DASHBOARD.kpiMenuMainButtonColor,
                            border: DECIDE_DASHBOARD.kpiMenuMainButtonBorder,
                            boxShadow: `${DECIDE_DASHBOARD.kpiMenuMainButtonShadow}, 0 8px 28px rgba(13, 148, 136, 0.25)`,
                          }}
                        >
                          Já confirmei o email
                        </button>
                        <button
                          type="button"
                          disabled={signupSendBusy}
                          onClick={() => void sendSignupVerification()}
                          style={{
                            width: "100%",
                            borderRadius: 12,
                            padding: "11px 16px",
                            fontSize: 14,
                            fontWeight: 700,
                            cursor: signupSendBusy ? "wait" : "pointer",
                            background: "transparent",
                            color: "#a1a1aa",
                            border: "1px solid rgba(148, 163, 184, 0.35)",
                          }}
                        >
                          {signupSendBusy ? "A enviar…" : "Reenviar email"}
                        </button>
                        <p style={{ margin: "14px 0 0", fontSize: 12, color: "#71717a", lineHeight: 1.45, textAlign: "center" }}>
                          Se não recebeu o email, verifique a pasta de spam ou reenvie.
                        </p>
                      </>
                    )}
                  </div>

                  {showPhoneSmsInWizardStep2 ? (
                    <div style={REGISTER_STEP2_CARD_PHONE}>
                    <div
                      style={{
                        display: "flex",
                        flexWrap: "wrap",
                        alignItems: "baseline",
                        gap: "6px 10px",
                        marginBottom: 10,
                      }}
                    >
                      <div style={{ fontWeight: 900, fontSize: 16, color: "#e2e8f0" }}>Telemóvel (SMS)</div>
                      {signupEmailOk && smsVerificationEnabled ? (
                        phoneSmsRequiredForSignup ? (
                          <span
                            style={{
                              fontSize: 11,
                              fontWeight: 800,
                              color: "#fde68a",
                              letterSpacing: "0.04em",
                            }}
                          >
                            Obrigatório
                          </span>
                        ) : (
                          <span
                            style={{
                              fontSize: 11,
                              fontWeight: 800,
                              color: "#a1a1aa",
                              letterSpacing: "0.04em",
                            }}
                          >
                            Opcional
                          </span>
                        )
                      ) : null}
                    </div>
                    {!signupEmailOk ? (
                      <p style={{ color: "#a1a1aa", fontSize: 13, margin: 0, lineHeight: 1.55 }}>
                        {smsVerificationEnabled
                          ? phoneSmsRequiredForSignup
                            ? "Confirme primeiro o email. Depois poderá validar o telemóvel por SMS — passo obrigatório para criar a conta."
                            : "Confirme primeiro o email. O SMS é opcional para concluir o registo."
                          : "Confirme primeiro o email. O número indicado será associado à conta ao concluir o registo."}
                      </p>
                    ) : smsVerificationEnabled ? (
                      <>
                        {!phoneVerifyDiag.phoneOtpProofEnabled ? (
                          registerDevUi ? (
                            <div
                              style={{
                                marginBottom: 12,
                                padding: "8px 10px",
                                borderRadius: 10,
                                background: "rgba(127,29,29,0.28)",
                                border: "1px solid rgba(248,113,113,0.4)",
                                color: "#fecaca",
                                fontSize: 12,
                                lineHeight: 1.45,
                                display: "flex",
                                alignItems: "flex-start",
                                gap: 8,
                                flexWrap: "wrap",
                              }}
                            >
                              <span>
                                <strong>SMS em produção:</strong> falta <code style={{ color: "#fff", fontSize: 11 }}>VERIFY_EMAIL_SECRET</code>{" "}
                                (≥16 caracteres) para prova HMAC em serverless.
                              </span>
                              <DevCommentHoverIcon label="Detalhes sobre VERIFY_EMAIL_SECRET e validação SMS">
                                <strong>SMS em produção precisa de segredo:</strong> define{" "}
                                <code style={{ color: "#fff", fontSize: 11 }}>VERIFY_EMAIL_SECRET</code> com{" "}
                                <strong>pelo menos 16 caracteres</strong> (Vercel → Environment Variables). Sem isto, o servidor não
                                envia a prova necessária e o código correto é rejeitado em hosting serverless. Em{" "}
                                <code style={{ color: "#fff", fontSize: 11 }}>npm run dev</code> o ficheiro{" "}
                                <code style={{ color: "#fff", fontSize: 11 }}>.data/</code> pode dar a falsa sensação de que funciona.
                              </DevCommentHoverIcon>
                            </div>
                          ) : (
                            <div
                              style={{
                                marginBottom: 12,
                                padding: "10px 12px",
                                borderRadius: 10,
                                background: "rgba(127,29,29,0.32)",
                                border: "1px solid rgba(248,113,113,0.45)",
                                color: "#fecaca",
                                fontSize: 12,
                                lineHeight: 1.5,
                              }}
                            >
                              <strong>SMS em produção precisa de segredo:</strong> define{" "}
                              <code style={{ color: "#fff", fontSize: 11 }}>VERIFY_EMAIL_SECRET</code> com{" "}
                              <strong>pelo menos 16 caracteres</strong> (Vercel → Environment Variables). Sem isto, o servidor não
                              envia a prova necessária e o código correto é rejeitado em hosting serverless. Em{" "}
                              <code style={{ color: "#fff", fontSize: 11 }}>npm run dev</code> o ficheiro{" "}
                              <code style={{ color: "#fff", fontSize: 11 }}>.data/</code> pode dar a falsa sensação de que funciona.
                            </div>
                          )
                        ) : null}
                        {!phoneSmsRequiredForSignup ? (
                          <div
                            style={{
                              marginBottom: 12,
                              padding: "10px 12px",
                              borderRadius: 10,
                              background: "rgba(15,118,110,0.12)",
                              border: "1px solid rgba(45,212,191,0.28)",
                              color: "#ccfbf1",
                              fontSize: 12,
                              lineHeight: 1.45,
                            }}
                          >
                            <strong>Opcional</strong> — pode confirmar por SMS
                          </div>
                        ) : null}
                        <p style={{ color: "#a1a1aa", fontSize: 14, margin: "0 0 10px", lineHeight: 1.5 }}>
                          {phoneSmsRequiredForSignup
                            ? "Envie o código SMS para o número que indicou e introduza o código no campo abaixo."
                            : "Se desejar, envie um código SMS e introduza o código no campo abaixo."}
                          {phoneMaskedForSms ? (
                            <span style={{ display: "block", marginTop: 6, color: "#71717a", fontSize: 13 }}>
                              Destino: <strong style={{ color: "#cbd5e1" }}>{phoneMaskedForSms}</strong>
                            </span>
                          ) : null}
                        </p>
                        {regFieldErr.phoneNotVerified ? (
                          <div style={{ color: "#fca5a5", fontSize: 12, marginBottom: 8 }}>
                            Falta confirmar o código SMS.
                          </div>
                        ) : null}
                        <form
                          style={{ margin: 0, width: "100%" }}
                          onSubmit={(e) => {
                            e.preventDefault();
                            if (phoneVerifyBusy || phoneSmsBusy) return;
                            void verifyPhoneOtp();
                          }}
                        >
                          <div
                            style={{
                              display: "flex",
                              flexWrap: "wrap",
                              gap: 12,
                              alignItems: "center",
                              justifyContent: "center",
                              width: "100%",
                            }}
                          >
                            <button
                              type="button"
                              disabled={phoneSmsBusy || smsResendCooldown > 0}
                              onMouseDown={(e) => {
                                if (phoneSmsBusy || smsResendCooldown > 0) return;
                                e.preventDefault();
                              }}
                              onClick={() => {
                                if (phoneSmsBusy || smsResendCooldown > 0) return;
                                void sendPhoneVerificationSms();
                              }}
                              style={{
                                borderRadius: 12,
                                padding: phoneSmsRequiredForSignup ? "12px 20px" : "10px 18px",
                                fontSize: phoneSmsRequiredForSignup ? 15 : 14,
                                fontWeight: 800,
                                cursor: phoneSmsBusy || smsResendCooldown > 0 ? "not-allowed" : "pointer",
                                opacity: phoneSmsBusy || smsResendCooldown > 0 ? 0.65 : 1,
                                ...(phoneSmsRequiredForSignup
                                  ? {
                                      background: "#52525b",
                                      color: "#fff",
                                      border: "1px solid rgba(255,255,255,0.2)",
                                    }
                                  : {
                                      background: "rgba(51, 65, 85, 0.75)",
                                      color: "#e2e8f0",
                                      border: "1px solid rgba(100, 116, 139, 0.45)",
                                      boxShadow: "none",
                                    }),
                              }}
                            >
                              {phoneSmsBusy
                                ? "A enviar…"
                                : smsResendCooldown > 0
                                  ? `Reenviar em ${smsResendCooldown}s`
                                  : "Enviar código SMS"}
                            </button>
                            <input
                              key={`decide-sms-otp-${phoneOtpInputMountKey}`}
                              ref={phoneOtpInputRef}
                              value={phoneOtp}
                              onChange={(e) => setPhoneOtp(e.target.value.replace(/\D/g, "").slice(0, 8))}
                              placeholder="Código"
                              inputMode="numeric"
                              autoComplete="one-time-code"
                              name={`decide-sms-otp-${phoneOtpInputMountKey}`}
                              autoCorrect="off"
                              spellCheck={false}
                              data-lpignore="true"
                              data-1p-ignore
                              data-bwignore
                              style={{
                                ...baseInput,
                                width: 148,
                                maxWidth: "100%",
                                fontSize: 16,
                                letterSpacing: 2,
                              }}
                            />
                            <button
                              type="submit"
                              disabled={phoneVerifyBusy}
                              style={{
                                borderRadius: 12,
                                padding: phoneSmsRequiredForSignup ? "12px 20px" : "10px 18px",
                                fontSize: phoneSmsRequiredForSignup ? 15 : 14,
                                fontWeight: 800,
                                cursor: phoneVerifyBusy ? "wait" : "pointer",
                                opacity: phoneVerifyBusy ? 0.75 : 1,
                                ...(phoneSmsRequiredForSignup
                                  ? {
                                      background: DECIDE_DASHBOARD.buttonTealCta,
                                      color: DECIDE_DASHBOARD.kpiMenuMainButtonColor,
                                      border: DECIDE_DASHBOARD.kpiMenuMainButtonBorder,
                                      boxShadow: DECIDE_DASHBOARD.kpiMenuMainButtonShadow,
                                    }
                                  : {
                                      background: "rgba(15, 23, 42, 0.5)",
                                      color: DECIDE_DASHBOARD.accentSky,
                                      border: "1px solid rgba(45, 212, 191, 0.4)",
                                      boxShadow: "none",
                                    }),
                              }}
                            >
                              {phoneVerifyBusy ? "…" : "Validar código"}
                            </button>
                          </div>
                          {signupPhoneOk ? (
                            <div
                              style={{
                                marginTop: 10,
                                textAlign: "center",
                                color: DECIDE_DASHBOARD.accentSky,
                                fontSize: 14,
                                fontWeight: 800,
                              }}
                            >
                              ✓ Telemóvel confirmado
                            </div>
                          ) : null}
                        </form>
                        {phoneSmsMsg ? (
                          <div style={{ color: DECIDE_DASHBOARD.link, fontSize: 13, marginTop: 10, fontWeight: 600 }}>{phoneSmsMsg}</div>
                        ) : null}
                        <div ref={phoneFeedbackRef} style={{ marginTop: 8 }}>
                          {phoneVerifyFeedback ? (
                            <div
                              style={{
                                fontSize: 13,
                                fontWeight: 800,
                                lineHeight: 1.4,
                                color: phoneVerifyFeedback.startsWith("✓") ? DECIDE_DASHBOARD.accentSky : "#fca5a5",
                                padding: "8px 10px",
                                borderRadius: 10,
                                background: phoneVerifyFeedback.startsWith("✓")
                                  ? "rgba(34,197,94,0.12)"
                                  : "rgba(127,29,29,0.25)",
                                border: `1px solid ${phoneVerifyFeedback.startsWith("✓") ? "rgba(74,222,128,0.35)" : "rgba(248,113,113,0.4)"}`,
                              }}
                            >
                              {phoneVerifyFeedback}
                            </div>
                          ) : null}
                        </div>
                      </>
                    ) : (
                      <div>
                        {phoneConfigLoadFailed ? (
                          <p style={{ color: "#fecaca", fontSize: 14, margin: "0 0 12px", lineHeight: 1.55 }}>
                            {registerDevUi ? (
                              <>
                                Não foi possível ler a configuração SMS (rede ou HTTP). Confirme a ligação e abra o registo na
                                mesma origem que o servidor Next; tente «Recarregar estado SMS».
                              </>
                            ) : (
                              <>Não foi possível carregar a confirmação por SMS. Atualize a página ou tente mais tarde.</>
                            )}
                          </p>
                        ) : (
                          <p style={{ color: "#a1a1aa", fontSize: 14, margin: "0 0 12px", lineHeight: 1.55 }}>
                            {registerDevUi ? (
                              <>
                                Os botões de SMS só aparecem quando o servidor tem SMS configurado. Aqui o SMS está desligado — o
                                número fica guardado na conta ao concluir o registo.
                              </>
                            ) : (
                              <>A confirmação por SMS não está disponível neste momento. O número indicado será associado à conta.</>
                            )}
                          </p>
                        )}
                        {!phoneConfigLoadFailed ? (
                          registerDevUi ? (
                            <div
                              style={{
                                marginBottom: 12,
                                display: "flex",
                                alignItems: "flex-start",
                                gap: 8,
                                flexWrap: "wrap",
                                fontSize: 12,
                                color: "#a1a1aa",
                                lineHeight: 1.45,
                              }}
                            >
                              <span>
                                <strong style={{ color: "#cbd5e1" }}>Operador:</strong> Twilio / Vercel — variáveis em produção.
                              </span>
                              <DevCommentHoverIcon label="Variáveis Twilio e Vercel para SMS no registo">
                                <strong style={{ color: DECIDE_DASHBOARD.link }}>
                                  Quem gere o site (Vercel → Environment Variables → Production):
                                </strong>
                                <ul style={{ margin: "8px 0 0", paddingLeft: 18 }}>
                                  {!phoneVerifyDiag.twilioConfigured ? (
                                    <li style={{ marginBottom: 6 }}>
                                      Configurar Twilio:{" "}
                                      <code style={{ color: "#e2e8f0", fontSize: 11 }}>TWILIO_ACCOUNT_SID</code>,{" "}
                                      <code style={{ color: "#e2e8f0", fontSize: 11 }}>TWILIO_AUTH_TOKEN</code> e{" "}
                                      <code style={{ color: "#e2e8f0", fontSize: 11 }}>TWILIO_FROM_NUMBER</code> (E.164) ou{" "}
                                      <code style={{ color: "#e2e8f0", fontSize: 11 }}>TWILIO_MESSAGING_SERVICE_SID</code> (MG…).
                                    </li>
                                  ) : null}
                                  {!phoneVerifyDiag.allowClientPhoneVerify ? (
                                    <li style={{ marginBottom: 6 }}>
                                      Definir <code style={{ color: "#e2e8f0", fontSize: 11 }}>ALLOW_CLIENT_PHONE_VERIFY=1</code> e
                                      fazer <strong>Redeploy</strong> do projeto.
                                    </li>
                                  ) : null}
                                  {phoneVerifyDiag.twilioConfigured && phoneVerifyDiag.allowClientPhoneVerify ? (
                                    <li>
                                      A API reporta Twilio + flag OK — carregue em «Recarregar estado SMS» ou actualize a página; se
                                      persistir, veja{" "}
                                      <code style={{ color: "#e2e8f0", fontSize: 11 }}>/api/client/phone-verification/config</code>.
                                    </li>
                                  ) : null}
                                </ul>
                              </DevCommentHoverIcon>
                            </div>
                          ) : (
                            <div
                              style={{
                                fontSize: 12,
                                color: "#cbd5e1",
                                lineHeight: 1.5,
                                marginBottom: 12,
                                padding: "10px 12px",
                                borderRadius: 10,
                                background: "rgba(30,41,59,0.55)",
                                border: "1px solid rgba(71,85,105,0.55)",
                              }}
                            >
                              <strong style={{ color: DECIDE_DASHBOARD.link }}>
                                Quem gere o site (Vercel → Environment Variables → Production):
                              </strong>
                              <ul style={{ margin: "8px 0 0", paddingLeft: 18 }}>
                                {!phoneVerifyDiag.twilioConfigured ? (
                                  <li style={{ marginBottom: 6 }}>
                                    Configurar Twilio:{" "}
                                    <code style={{ color: "#e2e8f0", fontSize: 11 }}>TWILIO_ACCOUNT_SID</code>,{" "}
                                    <code style={{ color: "#e2e8f0", fontSize: 11 }}>TWILIO_AUTH_TOKEN</code> e{" "}
                                    <code style={{ color: "#e2e8f0", fontSize: 11 }}>TWILIO_FROM_NUMBER</code> (E.164) ou{" "}
                                    <code style={{ color: "#e2e8f0", fontSize: 11 }}>TWILIO_MESSAGING_SERVICE_SID</code> (MG…).
                                  </li>
                                ) : null}
                                {!phoneVerifyDiag.allowClientPhoneVerify ? (
                                  <li style={{ marginBottom: 6 }}>
                                    Definir <code style={{ color: "#e2e8f0", fontSize: 11 }}>ALLOW_CLIENT_PHONE_VERIFY=1</code> e fazer{" "}
                                    <strong>Redeploy</strong> do projeto.
                                  </li>
                                ) : null}
                                {phoneVerifyDiag.twilioConfigured && phoneVerifyDiag.allowClientPhoneVerify ? (
                                  <li>
                                    A API reporta Twilio + flag OK — carregue em «Recarregar estado SMS» ou actualize a página; se
                                    persistir, veja{" "}
                                    <code style={{ color: "#e2e8f0", fontSize: 11 }}>/api/client/phone-verification/config</code>.
                                  </li>
                                ) : null}
                              </ul>
                            </div>
                          )
                        ) : null}
                        <button
                          type="button"
                          disabled={phoneConfigLoading}
                          onClick={() => void loadPhoneVerificationConfig()}
                          style={{
                            background: "#334155",
                            color: "#e2e8f0",
                            borderRadius: 12,
                            padding: "10px 16px",
                            fontSize: 13,
                            fontWeight: 800,
                            border: "1px solid rgba(148,163,184,0.35)",
                            cursor: phoneConfigLoading ? "wait" : "pointer",
                            opacity: phoneConfigLoading ? 0.7 : 1,
                          }}
                        >
                          {phoneConfigLoading ? "A verificar…" : "Recarregar estado SMS"}
                        </button>
                      </div>
                    )}
                  </div>
                  ) : null}
                  </div>
                  </div>

                  <div
                    style={{
                      marginTop: 22,
                      paddingTop: 22,
                      borderTop: "1px solid rgba(148,163,184,0.12)",
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                    }}
                  >
                    {signupEmailOk ? (
                      <p
                        style={{
                          margin: "0 0 10px",
                          maxWidth: 420,
                          textAlign: "center",
                          fontSize: 14,
                          fontWeight: 800,
                          color: DECIDE_DASHBOARD.accentSky,
                          lineHeight: 1.45,
                        }}
                      >
                        ✔ Email confirmado — pode continuar
                      </p>
                    ) : (
                      <p
                        style={{
                          margin: "0 0 10px",
                          maxWidth: 420,
                          textAlign: "center",
                          fontSize: 13,
                          color: "#71717a",
                          lineHeight: 1.45,
                        }}
                      >
                        Confirme o email no cartão acima para continuar.
                      </p>
                    )}
                    <button
                      type="button"
                      onClick={() => void goWizardNextFromStep2()}
                      disabled={
                        !signupEmailOk ||
                        registerSubmitBusy ||
                        (phoneSmsRequiredForSignup && !signupPhoneOk)
                      }
                      style={{
                        width: "100%",
                        maxWidth: REGISTER_CTA_MAX_PX,
                        background:
                          !signupEmailOk || registerSubmitBusy || (phoneSmsRequiredForSignup && !signupPhoneOk)
                            ? "#334155"
                            : DECIDE_DASHBOARD.buttonRegister,
                        color: !signupEmailOk ? "#a1a1aa" : DECIDE_DASHBOARD.kpiMenuMainButtonColor,
                        borderRadius: 14,
                        padding: "14px 22px",
                        fontSize: 16,
                        fontWeight: 900,
                        border:
                          !signupEmailOk || registerSubmitBusy || (phoneSmsRequiredForSignup && !signupPhoneOk)
                            ? "1px solid rgba(255,255,255,0.1)"
                            : DECIDE_DASHBOARD.kpiMenuMainButtonBorder,
                        cursor:
                          !signupEmailOk || registerSubmitBusy || (phoneSmsRequiredForSignup && !signupPhoneOk)
                            ? "not-allowed"
                            : "pointer",
                        opacity:
                          !signupEmailOk || registerSubmitBusy || (phoneSmsRequiredForSignup && !signupPhoneOk)
                            ? 0.65
                            : 1,
                        boxShadow:
                          !signupEmailOk || registerSubmitBusy || (phoneSmsRequiredForSignup && !signupPhoneOk)
                            ? "none"
                            : `${DECIDE_DASHBOARD.kpiMenuMainButtonShadow}, 0 14px 36px rgba(13, 148, 136, 0.35)`,
                      }}
                    >
                      {registerSubmitBusy
                        ? "A criar conta…"
                        : "Continuar → valor a investir"}
                    </button>
                    {smsVerificationEnabled && phoneSmsRequiredForSignup && signupEmailOk && !signupPhoneOk ? (
                      <p
                        style={{
                          margin: "10px 0 0",
                          maxWidth: 380,
                          textAlign: "center",
                          fontSize: 12,
                          color: "#71717a",
                          lineHeight: 1.45,
                        }}
                      >
                        Confirme o telemóvel por SMS antes de continuar (obrigatório neste servidor).
                      </p>
                    ) : null}
                  </div>
                </>
              </div>
            )}

            <p style={{ textAlign: "center", color: "#475569", fontSize: 13, marginTop: 8 }}>
              <a href="/client-dashboard" style={{ color: "#71717a" }}>
                Painel DECIDE
              </a>
              {registerDevUi ? (
                <>
                  {" "}
                  · <span style={{ color: "#475569" }}>Logado: {loggedIn ? currentUser || "—" : "não"}</span>
                </>
              ) : null}
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
