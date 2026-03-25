import React, { useEffect, useMemo, useRef, useState } from "react";
import Head from "next/head";
import { useRouter } from "next/router";
import OnboardingFlowBar from "../../components/OnboardingFlowBar";
import type { RegisterClientUserErrorField } from "../../lib/clientAuth";
import {
  clearSignupPhoneVerifiedFlag,
  CLIENT_PASSWORD_MIN_LENGTH,
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
  normalizeClientPhone,
  passwordStrengthSummary,
  registerClientUser,
  requestEmailVerificationSend,
  requestEmailVerificationSignupSend,
} from "../../lib/clientAuth";
import { devConfirmationLinkUsesLoopback } from "../../lib/emailConfirmationDevLink";
import {
  DECIDE_MIN_INVEST_EUR,
  persistIntendedInvestEur,
  readIntendedInvestEur,
} from "../../lib/decideInvestPrefill";

function CheckRow({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        fontSize: 13,
        color: ok ? "#86efac" : "#64748b",
        fontWeight: ok ? 700 : 500,
      }}
    >
      <span style={{ fontSize: 16, lineHeight: 1 }}>{ok ? "✓" : "○"}</span>
      {label}
    </div>
  );
}

/** Requisitos de password em linha compacta (menos peso visual que caixa grande). */
function ReqPill({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: "0.02em",
        padding: "4px 9px",
        borderRadius: 999,
        background: ok ? "rgba(34,197,94,0.1)" : "rgba(15,23,42,0.55)",
        border: `1px solid ${ok ? "rgba(74,222,128,0.28)" : "rgba(51,65,85,0.65)"}`,
        color: ok ? "#86efac" : "#64748b",
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
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  inputStyle: React.CSSProperties;
}) {
  const [show, setShow] = useState(false);
  return (
    <div style={{ marginBottom: 6 }}>
      <div style={{ color: "#9fb3d1", fontSize: 14, marginBottom: 5 }}>{label}</div>
      <div style={{ display: "flex", gap: 8, alignItems: "stretch" }}>
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          type={show ? "text" : "password"}
          style={{ ...inputStyle, flex: 1 }}
          placeholder={placeholder}
          autoComplete="new-password"
        />
        <button
          type="button"
          onClick={() => setShow((s) => !s)}
          style={{
            flexShrink: 0,
            background: "#1e3a5f",
            color: "#e2e8f0",
            border: "1px solid #15305b",
            borderRadius: 12,
            padding: "0 14px",
            fontSize: 12,
            fontWeight: 800,
            cursor: "pointer",
            whiteSpace: "nowrap",
          }}
        >
          {show ? "Ocultar" : "Ver"}
        </button>
      </div>
    </div>
  );
}

const baseInput: React.CSSProperties = {
  width: "100%",
  background: "#020816",
  color: "#fff",
  border: "1px solid #15305b",
  borderRadius: 12,
  padding: 12,
  fontSize: 16,
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
  step: 1 | 2 | 3;
  email: string;
  phone: string;
  username: string;
  password: string;
  passwordConfirm: string;
  savedAt: number;
};

const MIN_INVESTIMENTO_EUR = DECIDE_MIN_INVEST_EUR;

function readRegisterWizardDraft(): RegisterWizardDraftV1 | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(REGISTER_WIZARD_DRAFT_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as RegisterWizardDraftV1;
    if (s.v !== 1 || (s.step !== 1 && s.step !== 2 && s.step !== 3)) return null;
    if (typeof s.savedAt !== "number" || Date.now() - s.savedAt > REGISTER_WIZARD_DRAFT_MAX_AGE_MS) {
      sessionStorage.removeItem(REGISTER_WIZARD_DRAFT_KEY);
      return null;
    }
    return s;
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

/** Largura da página (card exterior) — equilíbrio ~750–850px */
const REGISTER_PAGE_MAX_WIDTH = 800;
/** Coluna dos campos (~10–15% mais estreita que antes — sensação mais “controlada”) */
const REGISTER_FIELDS_MAX_PX = 448;
/** Largura máx. do bloco em 2 colunas (passo 2) */
const REGISTER_STEP2_MAX_PX = 680;
/** Botão principal: ligeiramente mais estreito que a coluna */
const REGISTER_CTA_MAX_PX = 340;
/** Espaçamento vertical entre blocos do passo 1 */
const REGISTER_STEP1_STACK_GAP_PX = 16;

const REGISTER_CARD_STYLE: React.CSSProperties = {
  background: "linear-gradient(165deg, rgba(18,36,77,0.98) 0%, rgba(10,22,48,0.99) 100%)",
  border: "1px solid rgba(59,130,246,0.22)",
  borderRadius: 20,
  padding: "36px 44px",
  boxShadow: "0 24px 48px rgba(0,0,0,0.35), 0 0 0 1px rgba(255,255,255,0.04) inset",
};

const registerFieldsColumn: React.CSSProperties = {
  maxWidth: REGISTER_FIELDS_MAX_PX,
  width: "100%",
  marginLeft: "auto",
  marginRight: "auto",
};

const registerPwTwoCol: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(min(200px, 100%), 1fr))",
  gap: "12px 18px",
  alignItems: "start",
};

const registerResponsiveGrid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
  gap: "22px 28px",
  alignItems: "start",
};

function parsePositiveIntFromQuery(raw: string | string[] | undefined): number | null {
  const s = Array.isArray(raw) ? raw[0] : raw;
  if (s == null || String(s).trim() === "") return null;
  const n = Math.round(Number(String(s).replace(/\s/g, "").replace(",", ".")));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Sugestão de username a partir do email (evita pedir isto no passo 1). */
function deriveClientUsernameFromEmail(emailRaw: string): string {
  const em = (emailRaw || "").trim().toLowerCase();
  const local = em.includes("@") ? em.split("@")[0]! : em;
  const s = local.replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  if (s.length >= 2) return s;
  return `cliente-${Math.random().toString(36).slice(2, 9)}`;
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
  }>({ twilioConfigured: false, allowClientPhoneVerify: false, devSignupSmsSimulate: false });
  const [phoneOtp, setPhoneOtp] = useState("");
  const [phoneSmsBusy, setPhoneSmsBusy] = useState(false);
  const [phoneVerifyBusy, setPhoneVerifyBusy] = useState(false);
  const [phoneSmsMsg, setPhoneSmsMsg] = useState("");
  const [phoneFormatHint, setPhoneFormatHint] = useState<{ ok: boolean; text: string } | null>(null);
  const [phoneVerifyFeedback, setPhoneVerifyFeedback] = useState<string>("");
  const phoneFeedbackRef = useRef<HTMLDivElement | null>(null);
  const [signupEmailLinkSentOnce, setSignupEmailLinkSentOnce] = useState(false);
  const [smsResendCooldown, setSmsResendCooldown] = useState(0);

  /** Painéis [Dev] e textos técnicos: opt-in (`NEXT_PUBLIC_DECIDE_REGISTER_DEV_UI=1` + npm run dev). */
  const registerDevUi =
    process.env.NODE_ENV === "development" && process.env.NEXT_PUBLIC_DECIDE_REGISTER_DEV_UI === "1";
  const [wizardStep, setWizardStep] = useState<1 | 2 | 3>(1);
  /** Depois de restaurar sessionStorage (ou confirmar que não há rascunho), gravamos alterações sem sobrescrever o draft antes da leitura. */
  const [registerDraftReady, setRegisterDraftReady] = useState(false);

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

  function goWizardNextFromStep1() {
    resetMsgs();
    setRegFieldErr({});
    if (!emailLooksValid) {
      setRegFieldErr({ email: true });
      setError("Indica um email válido.");
      return;
    }
    const ph = normalizeClientPhone(phone);
    if (!ph.ok) {
      setRegFieldErr({ phone: true });
      setError(ph.error);
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
    setWizardStep(2);
  }

  function goWizardNextFromStep2() {
    resetMsgs();
    if (!signupEmailOk) {
      setRegFieldErr((x) => ({ ...x, emailNotVerified: true }));
      setError("Confirma o email: abre o link que te enviámos ou pede um novo abaixo.");
      return;
    }
    /** SMS continua obrigatório ao criar a conta se o servidor o exigir; aqui só precisas do email confirmado para avançar. */
    setUsername((u) => (u.trim() ? u : deriveClientUsernameFromEmail(email)));
    /** Link de confirmação *pré-registo* já cumpriu o papel — esconder caixa azul no passo 3 (evita misturar com revisão final). */
    setSignupDevLink(null);
    setPostRegisterEmailLinkActive(false);
    setWizardStep(3);
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

  /** Restaura passo e campos após F5 / remount (evita voltar sempre ao passo 1). */
  useEffect(() => {
    const s = readRegisterWizardDraft();
    if (s) {
      setEmail(s.email || "");
      setPhone(s.phone || "");
      setUsername(s.username || "");
      setPassword(s.password || "");
      setPasswordConfirm(s.passwordConfirm || "");
      let step: 1 | 2 | 3 = s.step;
      const em = (s.email || "").trim();
      const ph = normalizeClientPhone(s.phone || "");
      if (step >= 2) {
        if (!em || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em) || !ph.ok) {
          step = 1;
        } else if (step === 3 && !isSignupEmailVerifiedForInput(em)) {
          step = 2;
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
    });
  }, [registerDraftReady, wizardStep, email, phone, username, password, passwordConfirm]);

  /** SMS opcional no servidor: não deixar erros de «obriga SMS» presos no passo 3 (sem campos SMS aqui). */
  useEffect(() => {
    if (wizardStep !== 3 || phoneSmsRequiredForSignup) return;
    setError((prev) => {
      if (!prev) return prev;
      const t = prev.toLowerCase();
      if (
        /telemóvel|sms|código/.test(t) &&
        (/confirma/.test(t) || /introduz/.test(t) || /recebe/.test(t))
      ) {
        return "";
      }
      return prev;
    });
    setRegFieldErr((r) => ({ ...r, phoneNotVerified: false }));
  }, [wizardStep, phoneSmsRequiredForSignup]);

  useEffect(() => {
    void fetch("/api/client/phone-verification/config")
      .then(async (r) => {
        if (!r.ok) return null;
        return (await r.json()) as {
          smsVerificationEnabled?: boolean;
          twilioConfigured?: boolean;
          allowClientPhoneVerify?: boolean;
          devSignupSmsSimulate?: boolean;
          phoneSmsRequiredForSignup?: boolean;
        };
      })
      .then((j) => {
        if (!j) {
          setSmsVerificationEnabled(false);
          setPhoneSmsRequiredForSignup(false);
          return;
        }
        const smsOn = j.smsVerificationEnabled === true;
        setSmsVerificationEnabled(smsOn);
        const req =
          typeof j.phoneSmsRequiredForSignup === "boolean" ? j.phoneSmsRequiredForSignup : smsOn;
        setPhoneSmsRequiredForSignup(req);
        setPhoneVerifyDiag({
          twilioConfigured: j.twilioConfigured === true,
          allowClientPhoneVerify: j.allowClientPhoneVerify === true,
          devSignupSmsSimulate: j.devSignupSmsSimulate === true,
        });
      })
      .catch(() => {
        setSmsVerificationEnabled(false);
        setPhoneSmsRequiredForSignup(false);
        setPhoneVerifyDiag({ twilioConfigured: false, allowClientPhoneVerify: false, devSignupSmsSimulate: false });
      });
  }, []);

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
            ? "O pedido demorou demasiado. Recarrega a página, confirma que `npm run dev` está a correr e tenta outra vez."
            : "O pedido demorou demasiado. Recarrega a página e tenta outra vez."),
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
      setError("Indica um email válido.");
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
            ? "Sem envio configurado (Resend ou Gmail): usa o link na caixa abaixo. Para email real, vê .env.local.example."
            : "Usa o botão abaixo para abrires a página de confirmação do email.",
        );
      } else if (!vr.ok) {
        setError(vr.error || "Não foi possível enviar o email.");
      } else {
        setMsg(
          registerDevUi
            ? "Email enviado. Se testares no telemóvel na mesma Wi‑Fi, o link não pode ser 127.0.0.1 — vê painel técnico em baixo ou define EMAIL_LINK_BASE_URL + npm run dev:lan."
            : "Enviámos um email com um link de confirmação. Abre a caixa de correio e clica no link (válido 48 horas).",
        );
      }
    } catch {
      setError("Erro inesperado ao pedir o link.");
    } finally {
      sendLinkInFlight.current = false;
      setSignupSendBusy(false);
    }
  }

  async function sendPhoneVerificationSms() {
    if (phoneSmsBusy || smsResendCooldown > 0) return;
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
    setPhoneSmsBusy(true);
    try {
      const r = await fetch("/api/client/phone-verification/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: ph.e164 }),
      });
      const text = await r.text();
      let j: { ok?: boolean; error?: string; devOtp?: string } = {};
      try {
        j = text ? (JSON.parse(text) as { ok?: boolean; error?: string; devOtp?: string }) : {};
      } catch {
        setError(
          registerDevUi
            ? `Resposta inválida (HTTP ${r.status}). Corpo: ${text.slice(0, 160).replace(/\s+/g, " ")}`
            : "Não foi possível contactar o servidor. Verifica a ligação e tenta outra vez.",
        );
        return;
      }
      if (!r.ok || !j.ok) {
        setSmsResendCooldown(0);
        const api403Dev =
          "403 no pedido (ainda não chegou à Twilio). Tenta a mesma URL do dev, desliga VPN ou confirma que POST /api não está bloqueado.";
        const twilio502Dev = "O envio SMS falhou no servidor. Vê o terminal do npm run dev.";
        setError(
          j.error ||
            (r.status === 503
              ? registerDevUi
                ? "SMS desligado no servidor (vê DEV_SIGNUP_SMS_SIMULATE ou Twilio em .env.local)."
                : "Confirmação por SMS não está disponível neste momento."
              : r.status === 403
                ? registerDevUi
                  ? api403Dev
                  : "Pedido recusado. Atualiza a página e tenta outra vez."
                : r.status === 502
                  ? registerDevUi
                    ? twilio502Dev
                    : "Não foi possível enviar o SMS. Tenta mais tarde."
                  : `Erro HTTP ${r.status}. Não foi possível enviar o SMS.`),
        );
        return;
      }
      const masked = formatPhoneForDisplayMasked(ph.e164);
      if (j.devOtp && /^\d{6}$/.test(String(j.devOtp))) {
        setPhoneSmsMsg(
          registerDevUi
            ? `Código para ${masked} (simulação, sem SMS real): ${j.devOtp} — válido 10 min.`
            : `Código de verificação para ${masked}. Introduz-o abaixo.`,
        );
      } else {
        setPhoneSmsMsg(`Código enviado para ${masked}. Introduz o SMS de 6 dígitos abaixo.`);
      }
      setSmsResendCooldown(30);
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
      const hint = "Introduz o código de algarismos que veio no SMS (sem espaços).";
      setError(hint);
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
        body: JSON.stringify({ phone: ph.e164, code }),
        signal: controller.signal,
      });
      const text = await r.text();
      let j: { ok?: boolean; error?: string } = {};
      try {
        j = text ? (JSON.parse(text) as { ok?: boolean; error?: string }) : {};
      } catch {
        const snippet = text.slice(0, 120).replace(/\s+/g, " ");
        setError(
          registerDevUi
            ? snippet
              ? `Resposta inválida (${r.status}). ${snippet}`
              : `Resposta vazia (${r.status}). Reinicia o servidor de desenvolvimento.`
            : "Resposta inválida do servidor. Tenta outra vez.",
        );
        setPhoneVerifyFeedback("Falha ao ler a resposta do servidor.");
        return;
      }
      if (!r.ok || j.ok !== true) {
        const base =
          j.error ||
          (r.status === 503 ? "Verificação SMS desligada no servidor." : "Não foi possível validar o código.");
        const err = r.status === 400 || j.error ? base : `${base} (HTTP ${r.status})`;
        setError(err);
        setPhoneVerifyFeedback(err);
        return;
      }
      setSignupPhoneVerifiedFromServerPhone(ph.e164);
      setStorageTick((t) => t + 1);
      setPhoneOtp("");
      const okMsg = "Telemóvel confirmado.";
      setMsg(okMsg);
      setPhoneVerifyFeedback("✓ Código aceite. Continua para o passo seguinte.");
      window.requestAnimationFrame(() => {
        phoneFeedbackRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      });
    } catch (e) {
      const aborted = e instanceof DOMException && e.name === "AbortError";
      setError(
        aborted
          ? "O pedido demorou demasiado. Verifica a rede e tenta outra vez."
          : "Erro de rede ao validar o código.",
      );
      setPhoneVerifyFeedback(aborted ? "Pedido cancelado por timeout." : "Erro de rede.");
    } finally {
      window.clearTimeout(tmo);
      setPhoneVerifyBusy(false);
    }
  }

  async function submitRegister() {
    resetMsgs();
    setRegFieldErr({});
    const res = registerClientUser(username, password, passwordConfirm, email, phone, {
      requirePhoneSms: phoneSmsRequiredForSignup,
    });
    if (!res.ok) {
      if (res.field) {
        setRegFieldErr({ [res.field]: true });
      }
      setError(res.error || "Falha ao criar conta.");
      return;
    }
    setMsg("Conta criada. A iniciar sessão…");
    const loginRes = loginClientUser(username, password);
    if (!loginRes.ok) {
      setError(loginRes.error || "Falha ao fazer login após registo.");
      return;
    }
    clearRegisterWizardDraft();
    if (isSessionEmailVerified()) {
      goToMontanteWithSimPrefill();
      return;
    }
    const normUser = username.trim().toLowerCase();
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
          ? "Conta criada. Sem envio configurado: confirma com o link na caixa; só depois avança. Para Gmail, define GMAIL_USER + GMAIL_APP_PASSWORD."
          : "Conta criada. Confirma o email com o link mostrado antes de continuar.",
      );
      void navigator.clipboard?.writeText(vr.link).catch(() => {});
      return;
    }
    if (!vr.ok) {
      setError(vr.error || "Não foi possível enviar o email de confirmação agora.");
      setMsg("Conta criada. Corrige o envio (mensagem acima) ou usa «Reenviar» no dashboard.");
      return;
    }
    setMsg("Conta criada. Enviámos um email com o link de confirmação (válido 48h).");
    goToMontanteWithSimPrefill();
  }

  return (
    <>
      <Head>
        <title>Criar conta — DECIDE</title>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>
      <div
        style={{
          minHeight: "100vh",
          background: "radial-gradient(ellipse 120% 80% at 50% -20%, #1e3a5f 0%, #020617 45%, #000 100%)",
          color: "#fff",
          padding: "32px max(20px, 4vw)",
          fontFamily: "Inter, system-ui, Arial, sans-serif",
        }}
      >
        <div style={{ maxWidth: REGISTER_PAGE_MAX_WIDTH, margin: "0 auto" }}>
          <OnboardingFlowBar currentStepId="auth" />
          <div style={{ fontSize: 32, fontWeight: 900, marginBottom: 8, letterSpacing: "-0.02em" }}>Criar conta</div>
          <div style={{ color: "#94a3b8", fontSize: 16, marginBottom: 20, lineHeight: 1.55, maxWidth: "100%" }}>
            {wizardStep === 1 && "Indica email, telemóvel e password. No passo seguinte confirmamos o contacto."}
            {wizardStep === 2 ? (
              smsVerificationEnabled ? (
                phoneSmsRequiredForSignup ? (
                  <>
                    Confirma o <strong style={{ color: "#e2e8f0" }}>email</strong> (link na caixa de correio) e o{" "}
                    <strong style={{ color: "#e2e8f0" }}>telemóvel</strong> com o código SMS — ambos são necessários para criar a
                    conta neste servidor.
                  </>
                ) : (
                  <>
                    Confirma o <strong style={{ color: "#e2e8f0" }}>email</strong> (link na mensagem). O bloco de SMS é opcional:
                    podes testar o envio, mas <strong style={{ color: "#e2e8f0" }}>não precisas</strong> de código para concluir o
                    registo aqui.
                  </>
                )
              ) : (
                "Confirma o email (link na caixa de correio)."
              )
            ) : null}
            {wizardStep === 3 ? (
              phoneSmsRequiredForSignup ? (
                <>
                  Revisa o nome de utilizador. Se o telemóvel ainda não estiver confirmado por SMS, usa{" "}
                  <strong style={{ color: "#e2e8f0" }}>«Voltar à confirmação»</strong> — o código só pode ser pedido nesse passo.
                </>
              ) : (
                "Revisa o nome de utilizador e conclui o registo — neste servidor o SMS não bloqueia a criação da conta."
              )
            ) : null}
          </div>

          <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
            {([1, 2, 3] as const).map((s) => (
              <div
                key={s}
                style={{
                  flex: 1,
                  height: 4,
                  borderRadius: 4,
                  background: wizardStep >= s ? "#3b82f6" : "#1e293b",
                  transition: "background 0.2s ease",
                }}
              />
            ))}
          </div>
          <div style={{ color: "#64748b", fontSize: 12, fontWeight: 700, marginBottom: 14, textTransform: "uppercase", letterSpacing: "0.06em" }}>
            Passo {wizardStep} de 3
          </div>

          {registerDevUi ? (
            <>
              <div
                style={{
                  background: "rgba(59, 130, 246, 0.12)",
                  border: "1px solid rgba(96, 165, 250, 0.45)",
                  borderRadius: 14,
                  padding: 14,
                  marginBottom: 18,
                  fontSize: 13,
                  lineHeight: 1.55,
                  color: "#bfdbfe",
                }}
              >
                <div style={{ fontWeight: 900, color: "#93c5fd", marginBottom: 8 }}>[Dev] SMS / Twilio</div>
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
                      <span> Falta <code>ALLOW_CLIENT_PHONE_VERIFY=1</code>.</span>
                    ) : null}
                  </>
                )}
              </div>
            </>
          ) : null}

          {registerDevUi && emailLinkDiag?.localhost ? (
            <div
              style={{
                background: "rgba(127, 29, 29, 0.35)",
                border: "1px solid rgba(248, 113, 113, 0.55)",
                borderRadius: 14,
                padding: 14,
                marginBottom: 14,
                fontSize: 13,
                lineHeight: 1.55,
                color: "#fecaca",
              }}
            >
              <div style={{ fontWeight: 900, color: "#fca5a5", marginBottom: 8 }}>Telemóvel: o link no email NÃO pode ser 127.0.0.1</div>
              <div style={{ marginBottom: 10 }}>
                O servidor está a usar <code style={{ color: "#fff" }}>{emailLinkDiag.linkBase}</code> nos links. No telemóvel isso{" "}
                <strong>não abre</strong> (é o próprio telemóvel, não o teu PC).
              </div>
              <ol style={{ margin: 0, paddingLeft: 20 }}>
                <li>
                  No PC: <code style={{ color: "#fde68a" }}>ipconfig</code> → anota <strong>IPv4</strong> (ex. 192.168.1.80).
                </li>
                <li>
                  Em <code style={{ color: "#fde68a" }}>frontend/.env.local</code> adiciona:{" "}
                  <code style={{ color: "#fff" }}>EMAIL_LINK_BASE_URL=http://192.168.1.80:4701</code> (o teu IP).
                </li>
                <li>
                  Corre <code style={{ color: "#fde68a" }}>npm run dev:lan</code> na pasta <code style={{ color: "#fde68a" }}>frontend</code> (não só{" "}
                  <code style={{ color: "#fde68a" }}>npm run dev</code>).
                </li>
                <li>
                  Reinicia o servidor, volta a clicar <strong>«Enviar link»</strong> (o email antigo continua com o link errado).
                </li>
                <li>
                  Se ainda falhar: no Windows, abre a firewall para TCP 4701 (PowerShell como admin):{" "}
                  <code style={{ color: "#e2e8f0", fontSize: 11 }}>
                    netsh advfirewall firewall add rule name=&quot;Next 4701&quot; dir=in action=allow protocol=TCP localport=4701
                  </code>
                </li>
              </ol>
            </div>
          ) : registerDevUi && emailLinkDiag && !emailLinkDiag.localhost ? (
            <div
              style={{
                background: "rgba(22, 101, 52, 0.2)",
                border: "1px solid rgba(74, 222, 128, 0.35)",
                borderRadius: 14,
                padding: 12,
                marginBottom: 14,
                fontSize: 12,
                color: "#bbf7d0",
              }}
            >
              [Dev] Links usam <code style={{ color: "#fff" }}>{emailLinkDiag.linkBase}</code> — útil com <code>dev:lan</code>.
            </div>
          ) : null}

          {registerDevUi ? (
            <div
              style={{
                background: "rgba(234, 179, 8, 0.12)",
                border: "1px solid rgba(250, 204, 21, 0.45)",
                borderRadius: 14,
                padding: 14,
                marginBottom: 14,
                fontSize: 13,
                lineHeight: 1.5,
                color: "#fde68a",
              }}
            >
              <div style={{ fontWeight: 900, color: "#fbbf24", marginBottom: 8 }}>[Dev] Email não chega?</div>
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                <li>
                  <code>.env.local</code>: <code>VERIFY_EMAIL_SECRET</code>, Resend ou <code>GMAIL_USER</code> +{" "}
                  <code>GMAIL_APP_PASSWORD</code> — vê <code>.env.local.example</code>.
                </li>
                <li>Sem provedor: usa a caixa azul com o link de confirmação.</li>
              </ul>
            </div>
          ) : null}

          {error ? (
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
          {signupDevLink && (wizardStep < 3 || postRegisterEmailLinkActive) ? (
            <div
              style={{
                background: "rgba(37, 99, 235, 0.07)",
                border: "1px solid rgba(96, 165, 250, 0.22)",
                borderRadius: 16,
                padding: "16px 18px",
                marginBottom: 14,
                fontSize: 13,
                lineHeight: 1.45,
              }}
            >
              <div style={{ fontWeight: 800, fontSize: 13, color: "#94a3b8", marginBottom: 6, letterSpacing: "0.04em" }}>
                {postRegisterEmailLinkActive ? "CONFIRMAÇÃO DE EMAIL DA CONTA" : "CONFIRMAÇÃO DE EMAIL"}
              </div>
              <p style={{ margin: "0 0 14px", color: "#cbd5e1", fontSize: 13, lineHeight: 1.5 }}>
                {registerDevUi ? (
                  <>
                    Sem Resend/Gmail configurado, <strong>não há envio real</strong>. Abre o link no mesmo dispositivo ou copia
                    para o telemóvel (com <code>EMAIL_LINK_BASE_URL</code> correcto).
                  </>
                ) : (
                  <>Abre o botão principal para confirmares o endereço. Se já clicaste no link (neste ou noutro dispositivo),
                    atualiza a página em baixo.</>
                )}
              </p>
              {registerDevUi && devConfirmationLinkUsesLoopback(signupDevLink) ? (
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
                  <strong>Telemóvel:</strong> <code>127.0.0.1</code> não funciona fora do PC — define{" "}
                  <code>EMAIL_LINK_BASE_URL</code> + <code>npm run dev:lan</code>.
                </div>
              ) : null}
              <a
                href={signupDevLink}
                style={{
                  display: "block",
                  textAlign: "center",
                  padding: "16px 20px",
                  borderRadius: 14,
                  background: "linear-gradient(180deg, #22c55e 0%, #15803d 100%)",
                  color: "#fff",
                  fontWeight: 900,
                  fontSize: 16,
                  textDecoration: "none",
                  border: "1px solid rgba(255,255,255,0.22)",
                  boxShadow:
                    "0 0 0 1px rgba(34,197,94,0.25), 0 12px 32px rgba(22,163,74,0.35), 0 0 40px rgba(34,197,94,0.12)",
                }}
              >
                Abrir página de confirmação
              </a>
              {registerDevUi ? (
                <div style={{ fontSize: 11, color: "#64748b", lineHeight: 1.35, marginTop: 8 }}>
                  Dica: mesmo separador costuma funcionar melhor no telemóvel.
                </div>
              ) : null}
              <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", marginTop: 14 }}>
                <button
                  type="button"
                  disabled={signupSendBusy}
                  onClick={() => void sendSignupVerification()}
                  style={{
                    background: "transparent",
                    color: "#93c5fd",
                    border: "1px solid rgba(147,197,253,0.35)",
                    borderRadius: 10,
                    padding: "9px 16px",
                    fontWeight: 800,
                    fontSize: 13,
                    cursor: signupSendBusy ? "wait" : "pointer",
                    opacity: signupSendBusy ? 0.7 : 1,
                  }}
                >
                  {signupSendBusy ? "A enviar…" : "Reenviar email"}
                </button>
                {registerDevUi ? (
                  <button
                    type="button"
                    onClick={() => void navigator.clipboard.writeText(signupDevLink).then(() => setMsg("Link copiado."))}
                    style={{
                      background: "#1e3a5f",
                      color: "#e2e8f0",
                      border: "1px solid #334155",
                      borderRadius: 10,
                      padding: "9px 14px",
                      fontWeight: 700,
                      fontSize: 12,
                      cursor: "pointer",
                    }}
                  >
                    Copiar link [Dev]
                  </button>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => {
                  window.location.reload();
                }}
                style={{
                  display: "block",
                  width: "100%",
                  maxWidth: 360,
                  marginTop: 14,
                  background: "rgba(15,23,42,0.6)",
                  color: "#e2e8f0",
                  border: "1px solid rgba(148,163,184,0.25)",
                  borderRadius: 10,
                  padding: "10px 16px",
                  fontWeight: 800,
                  fontSize: 14,
                  cursor: "pointer",
                }}
              >
                Continuar
              </button>
              <p style={{ margin: "8px 0 0", fontSize: 11, color: "#64748b", lineHeight: 1.4, maxWidth: 420 }}>
                Se confirmaste o email noutro dispositivo, este botão atualiza a página para sincronizar o estado e mostrar «Email
                confirmado».
              </p>
              {registerDevUi ? (
                <div style={{ marginTop: 10, fontSize: 10, color: "#475569", wordBreak: "break-all" }}>{signupDevLink}</div>
              ) : null}
            </div>
          ) : null}

          <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 20 }}>
            <div style={REGISTER_CARD_STYLE}>
              {wizardStep === 1 ? (
                <div
                  style={{
                    ...registerFieldsColumn,
                    display: "flex",
                    flexDirection: "column",
                    gap: REGISTER_STEP1_STACK_GAP_PX,
                  }}
                >
                  <div>
                    <div style={{ color: "#cbd5e1", fontSize: 14, marginBottom: 5, fontWeight: 600 }}>Email</div>
                    <input
                      value={email}
                      onChange={(e) => {
                        setEmail(e.target.value);
                        setRegFieldErr((x) => ({ ...x, email: false, emailNotVerified: false }));
                      }}
                      style={regInputStyle({ ...baseInput, width: "100%" }, !!(regFieldErr.email || regFieldErr.emailNotVerified))}
                      placeholder="nome@exemplo.com"
                      autoComplete="email"
                    />
                    {regFieldErr.email ? (
                      <div style={{ color: "#fca5a5", fontSize: 12, marginTop: 6 }}>Email em falta ou formato inválido.</div>
                    ) : null}
                  </div>

                  <div>
                    <div style={{ color: "#cbd5e1", fontSize: 14, marginBottom: 5, fontWeight: 600 }}>Telemóvel</div>
                    <input
                      value={phone}
                      onChange={(e) => {
                        setPhone(e.target.value);
                        clearSignupPhoneVerifiedFlag();
                        setPhoneFormatHint(null);
                        setRegFieldErr((x) => ({ ...x, phone: false, phoneNotVerified: false }));
                      }}
                      style={regInputStyle(
                        { ...baseInput, width: "100%" },
                        !!(regFieldErr.phone || regFieldErr.phoneNotVerified),
                      )}
                      placeholder="+351912345678 ou 912345678"
                      autoComplete="tel"
                      inputMode="tel"
                    />
                    {regFieldErr.phone ? (
                      <div style={{ color: "#fca5a5", fontSize: 12, marginTop: 6 }}>
                        Número inválido. Usa +351… ou 9XXXXXXXX (Portugal).
                      </div>
                    ) : (
                      <div style={{ color: "#64748b", fontSize: 12, marginTop: 6 }}>
                        Com indicativo do país. Ex.: <code style={{ color: "#94a3b8" }}>+351912345678</code>
                      </div>
                    )}
                  </div>

                  <div style={registerPwTwoCol}>
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
                    />
                    {regFieldErr.password ? (
                      <div style={{ color: "#fca5a5", fontSize: 12, marginBottom: 6, marginTop: -4 }}>
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
                    />
                    {regFieldErr.passwordConfirm ? (
                      <div style={{ color: "#fca5a5", fontSize: 12, marginBottom: 6, marginTop: -4 }}>
                        As passwords não coincidem.
                      </div>
                    ) : null}
                  </div>
                  </div>

                  <div
                    style={{
                      marginTop: -4,
                      padding: "8px 10px 10px",
                      borderRadius: 10,
                      background: "rgba(5,46,26,0.06)",
                      border: "1px solid rgba(34,197,94,0.14)",
                    }}
                  >
                    <div
                      style={{
                        fontSize: 11,
                        fontWeight: 700,
                        color: "#64748b",
                        textTransform: "uppercase",
                        letterSpacing: "0.05em",
                        marginBottom: 6,
                      }}
                    >
                      Requisitos da palavra‑passe
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 7px", alignItems: "center" }}>
                      <ReqPill ok={strength.minLength}>≥ {CLIENT_PASSWORD_MIN_LENGTH} caracteres</ReqPill>
                      <ReqPill ok={strength.hasUpper}>Maiúscula</ReqPill>
                      <ReqPill ok={strength.hasLower}>Minúscula</ReqPill>
                      <ReqPill ok={strength.hasDigit}>Algarismo</ReqPill>
                      <ReqPill ok={strength.hasSpecial}>Símbolo</ReqPill>
                      <ReqPill ok={strength.ok}>Password válida</ReqPill>
                      <ReqPill ok={passwordsMatch}>Confirmação igual</ReqPill>
                    </div>
                  </div>

                  <div
                    style={{
                      marginTop: 4,
                      paddingTop: 18,
                      borderTop: "1px solid rgba(148,163,184,0.12)",
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      gap: 12,
                    }}
                  >
                    <button
                      type="button"
                      onClick={goWizardNextFromStep1}
                      style={{
                        width: "100%",
                        maxWidth: REGISTER_CTA_MAX_PX,
                        background: "linear-gradient(180deg, #3b82f6 0%, #1d4ed8 100%)",
                        color: "#fff",
                        borderRadius: 14,
                        padding: "14px 22px",
                        fontSize: 16,
                        fontWeight: 900,
                        border: "1px solid rgba(255,255,255,0.28)",
                        cursor: "pointer",
                        boxShadow:
                          "0 0 0 1px rgba(59,130,246,0.35), 0 14px 36px rgba(37,99,235,0.5), 0 0 48px rgba(59,130,246,0.22)",
                      }}
                    >
                      Continuar
                    </button>
                    <a
                      href="/client/login"
                      style={{
                        color: "#93c5fd",
                        fontSize: 15,
                        fontWeight: 700,
                        textDecoration: "none",
                        textAlign: "center",
                      }}
                    >
                      Já tenho conta — iniciar sessão
                    </a>
                  </div>
                </div>
              ) : wizardStep === 2 ? (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      resetMsgs();
                      setWizardStep(1);
                    }}
                    style={{
                      background: "transparent",
                      color: "#94a3b8",
                      border: "1px solid #334155",
                      borderRadius: 10,
                      padding: "8px 14px",
                      fontSize: 13,
                      fontWeight: 700,
                      cursor: "pointer",
                      marginBottom: 18,
                    }}
                  >
                    ← Alterar email ou telemóvel
                  </button>

                  <div
                    style={{
                      maxWidth: REGISTER_STEP2_MAX_PX,
                      width: "100%",
                      marginLeft: "auto",
                      marginRight: "auto",
                    }}
                  >
                  <div style={{ ...registerResponsiveGrid, marginBottom: 12 }}>
                  <div
                    style={{
                      minWidth: 0,
                      padding: "20px 22px",
                      borderRadius: 16,
                      background: "rgba(15,23,42,0.55)",
                      border: "1px solid rgba(51,65,85,0.55)",
                    }}
                  >
                    <div style={{ fontWeight: 900, fontSize: 16, marginBottom: 8, color: "#f1f5f9" }}>Confirmar email</div>
                    <p style={{ color: "#94a3b8", fontSize: 14, margin: "0 0 12px", lineHeight: 1.5 }}>
                      Enviámos um link para <strong style={{ color: "#e2e8f0" }}>{email.trim() || "…"}</strong>. Abre a mensagem e
                      clica em confirmar. Se não recebeste, pede um novo link.
                    </p>
                    {regFieldErr.emailNotVerified ? (
                      <div style={{ color: "#fca5a5", fontSize: 12, marginBottom: 10 }}>
                        Ainda falta confirmar o email com o link.
                      </div>
                    ) : null}
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
                      <button
                        type="button"
                        disabled={signupSendBusy}
                        onClick={() => void sendSignupVerification()}
                        style={{
                          background: "#2563eb",
                          color: "#fff",
                          borderRadius: 12,
                          padding: "10px 16px",
                          fontSize: 14,
                          fontWeight: 900,
                          border: "1px solid rgba(255,255,255,0.2)",
                          cursor: signupSendBusy ? "wait" : "pointer",
                          opacity: signupSendBusy ? 0.75 : 1,
                        }}
                      >
                        {signupSendBusy ? "A enviar…" : signupEmailLinkSentOnce ? "Reenviar email" : "Enviar link de confirmação"}
                      </button>
                      {signupEmailOk ? (
                        <span style={{ color: "#86efac", fontSize: 14, fontWeight: 800 }}>✓ Email confirmado</span>
                      ) : (
                        <span style={{ color: "#64748b", fontSize: 13 }}>Aguardamos a confirmação do link.</span>
                      )}
                    </div>
                  </div>

                  <div
                    style={{
                      minWidth: 0,
                      padding: "20px 22px",
                      borderRadius: 16,
                      background: "rgba(15,23,42,0.55)",
                      border: "1px solid rgba(51,65,85,0.55)",
                    }}
                  >
                    <div style={{ fontWeight: 900, fontSize: 16, marginBottom: 8, color: "#f1f5f9" }}>Confirmar telemóvel</div>
                    {smsVerificationEnabled ? (
                      <>
                        {!phoneSmsRequiredForSignup ? (
                          <div
                            style={{
                              marginBottom: 12,
                              padding: "10px 12px",
                              borderRadius: 10,
                              background: "rgba(59,130,246,0.1)",
                              border: "1px solid rgba(96,165,250,0.25)",
                              color: "#bfdbfe",
                              fontSize: 12,
                              lineHeight: 1.45,
                            }}
                          >
                            Neste servidor o SMS é <strong>opcional</strong> para concluir o registo — podes avançar e criar a
                            conta sem código. Ainda podes testar o envio abaixo (ex.: Twilio).
                          </div>
                        ) : null}
                        <p style={{ color: "#94a3b8", fontSize: 14, margin: "0 0 10px", lineHeight: 1.5 }}>
                          Envia o código SMS para o número que indicaste e introduz-o abaixo.
                          {phoneMaskedForSms ? (
                            <span style={{ display: "block", marginTop: 6, color: "#64748b", fontSize: 13 }}>
                              Destino: <strong style={{ color: "#cbd5e1" }}>{phoneMaskedForSms}</strong>
                            </span>
                          ) : null}
                        </p>
                        {regFieldErr.phoneNotVerified ? (
                          <div style={{ color: "#fca5a5", fontSize: 12, marginBottom: 8 }}>
                            Falta confirmar o código SMS.
                          </div>
                        ) : null}
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
                          <button
                            type="button"
                            disabled={phoneSmsBusy || smsResendCooldown > 0}
                            onClick={() => void sendPhoneVerificationSms()}
                            style={{
                              background: "#0d9488",
                              color: "#fff",
                              borderRadius: 12,
                              padding: "10px 16px",
                              fontSize: 14,
                              fontWeight: 900,
                              border: "1px solid rgba(255,255,255,0.2)",
                              cursor: phoneSmsBusy || smsResendCooldown > 0 ? "not-allowed" : "pointer",
                              opacity: phoneSmsBusy || smsResendCooldown > 0 ? 0.65 : 1,
                            }}
                          >
                            {phoneSmsBusy
                              ? "A enviar…"
                              : smsResendCooldown > 0
                                ? `Reenviar em ${smsResendCooldown}s`
                                : "Enviar código SMS"}
                          </button>
                          <input
                            value={phoneOtp}
                            onChange={(e) => setPhoneOtp(e.target.value.replace(/\D/g, "").slice(0, 8))}
                            placeholder="Código"
                            inputMode="numeric"
                            autoComplete="one-time-code"
                            style={{
                              ...baseInput,
                              width: 140,
                              maxWidth: "100%",
                              fontSize: 16,
                              letterSpacing: 2,
                            }}
                          />
                          <button
                            type="button"
                            disabled={phoneVerifyBusy}
                            onClick={() => void verifyPhoneOtp()}
                            style={{
                              background: "#2563eb",
                              color: "#fff",
                              borderRadius: 12,
                              padding: "10px 16px",
                              fontSize: 14,
                              fontWeight: 900,
                              border: "1px solid rgba(255,255,255,0.2)",
                              cursor: phoneVerifyBusy ? "wait" : "pointer",
                              opacity: phoneVerifyBusy ? 0.75 : 1,
                            }}
                          >
                            {phoneVerifyBusy ? "…" : "Validar código"}
                          </button>
                          {signupPhoneOk ? (
                            <span style={{ color: "#86efac", fontSize: 14, fontWeight: 800 }}>✓ Telemóvel confirmado</span>
                          ) : null}
                        </div>
                        {phoneSmsMsg ? (
                          <div style={{ color: "#7dd3fc", fontSize: 13, marginTop: 10, fontWeight: 600 }}>{phoneSmsMsg}</div>
                        ) : null}
                        <div ref={phoneFeedbackRef} style={{ marginTop: 8 }}>
                          {phoneVerifyFeedback ? (
                            <div
                              style={{
                                fontSize: 13,
                                fontWeight: 800,
                                lineHeight: 1.4,
                                color: phoneVerifyFeedback.startsWith("✓") ? "#86efac" : "#fca5a5",
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
                      <p style={{ color: "#94a3b8", fontSize: 14, margin: 0, lineHeight: 1.5 }}>
                        A confirmação por SMS não está activa. O número será guardado na tua conta.
                      </p>
                    )}
                    {registerDevUi && !smsVerificationEnabled ? (
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
                          [Dev] Validar formato
                        </button>
                        {phoneFormatHint ? (
                          <span
                            style={{
                              fontSize: 12,
                              fontWeight: 700,
                              color: phoneFormatHint.ok ? "#86efac" : "#fca5a5",
                            }}
                          >
                            {phoneFormatHint.text}
                          </span>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                  </div>
                  </div>

                  <div
                    style={{
                      marginTop: 28,
                      paddingTop: 28,
                      borderTop: "1px solid rgba(148,163,184,0.12)",
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                    }}
                  >
                    <button
                      type="button"
                      onClick={goWizardNextFromStep2}
                      disabled={!signupEmailOk}
                      style={{
                        width: "100%",
                        maxWidth: REGISTER_CTA_MAX_PX,
                        background: !signupEmailOk ? "#334155" : "linear-gradient(180deg, #3b82f6 0%, #1d4ed8 100%)",
                        color: "#fff",
                        borderRadius: 14,
                        padding: "14px 22px",
                        fontSize: 16,
                        fontWeight: 900,
                        border: "1px solid rgba(255,255,255,0.22)",
                        cursor: !signupEmailOk ? "not-allowed" : "pointer",
                        opacity: !signupEmailOk ? 0.65 : 1,
                        boxShadow: !signupEmailOk
                          ? "none"
                          : "0 0 0 1px rgba(59,130,246,0.35), 0 14px 36px rgba(37,99,235,0.5), 0 0 48px rgba(59,130,246,0.2)",
                      }}
                    >
                      Continuar
                    </button>
                    {smsVerificationEnabled && phoneSmsRequiredForSignup && signupEmailOk && !signupPhoneOk ? (
                      <p
                        style={{
                          margin: "10px 0 0",
                          maxWidth: 380,
                          textAlign: "center",
                          fontSize: 12,
                          color: "#64748b",
                          lineHeight: 1.45,
                        }}
                      >
                        Podes avançar já; confirma o telemóvel antes de «Criar conta» (SMS obrigatório neste servidor).
                      </p>
                    ) : null}
                  </div>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      resetMsgs();
                      setWizardStep(2);
                    }}
                    style={{
                      background: "transparent",
                      color: "#94a3b8",
                      border: "1px solid #334155",
                      borderRadius: 10,
                      padding: "8px 14px",
                      fontSize: 13,
                      fontWeight: 700,
                      cursor: "pointer",
                      marginBottom: 18,
                    }}
                  >
                    ← Voltar à confirmação
                  </button>

                  <div style={{ ...registerFieldsColumn, display: "flex", flexDirection: "column", gap: 0 }}>
                  <div style={{ color: "#9fb3d1", fontSize: 14, marginBottom: 8 }}>Nome de utilizador</div>
                <input
                  value={username}
                  onChange={(e) => {
                    setUsername(e.target.value);
                    setRegFieldErr((x) => ({ ...x, username: false }));
                  }}
                  style={regInputStyle({ ...baseInput, width: "100%" }, !!regFieldErr.username)}
                  placeholder="ex: client-001"
                  autoComplete="username"
                />
                {regFieldErr.username ? (
                  <div style={{ color: "#fca5a5", fontSize: 12, marginTop: 6 }}>Indica um nome de utilizador.</div>
                ) : null}
                  <p style={{ color: "#64748b", fontSize: 13, margin: "12px 0 16px", lineHeight: 1.55 }}>
                    Usa letras minúsculas, números ou hífen. A palavra-passe que definiste no primeiro passo será usada para
                    iniciar sessão.
                  </p>
                  {phoneSmsRequiredForSignup && !signupPhoneOk ? (
                    <div
                      style={{
                        marginBottom: 16,
                        padding: "12px 14px",
                        borderRadius: 12,
                        background: "rgba(30,58,138,0.2)",
                        border: "1px solid rgba(96,165,250,0.3)",
                        color: "#bfdbfe",
                        fontSize: 13,
                        lineHeight: 1.5,
                      }}
                    >
                      Falta confirmar o telemóvel por SMS. Usa <strong style={{ color: "#fff" }}>«Voltar à confirmação»</strong>{" "}
                      para enviar o código e validar — só depois podes criar a conta neste servidor.
                    </div>
                  ) : null}
                  <div
                    style={{
                      marginBottom: 20,
                      padding: 12,
                      borderRadius: 12,
                      background: "#052e1a22",
                      border: "1px solid rgba(34,197,94,0.25)",
                    }}
                  >
                    <CheckRow ok={strength.ok && passwordsMatch} label="Palavra-passe definida e confirmada" />
                  </div>

                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16, marginTop: 8 }}>
                  <button
                    type="button"
                    onClick={submitRegister}
                    disabled={phoneSmsRequiredForSignup && !signupPhoneOk}
                    style={{
                      width: "100%",
                      maxWidth: REGISTER_CTA_MAX_PX,
                      background:
                        phoneSmsRequiredForSignup && !signupPhoneOk
                          ? "#334155"
                          : "linear-gradient(180deg, #22c55e 0%, #15803d 100%)",
                      color: "#fff",
                      borderRadius: 14,
                      padding: "14px 22px",
                      fontSize: 16,
                      fontWeight: 900,
                      border: "1px solid rgba(255,255,255,0.26)",
                      cursor: phoneSmsRequiredForSignup && !signupPhoneOk ? "not-allowed" : "pointer",
                      opacity: phoneSmsRequiredForSignup && !signupPhoneOk ? 0.65 : 1,
                      boxShadow:
                        phoneSmsRequiredForSignup && !signupPhoneOk
                          ? "none"
                          : "0 0 0 1px rgba(34,197,94,0.35), 0 14px 36px rgba(22,163,74,0.42), 0 0 40px rgba(34,197,94,0.18)",
                    }}
                  >
                    Criar conta
                  </button>
                  <div style={{ color: "#64748b", fontSize: 13, textAlign: "center" }}>
                    Já tens conta?{" "}
                    <a href="/client/login" style={{ color: "#93c5fd", fontWeight: 700 }}>
                      Iniciar sessão
                    </a>
                  </div>
                  </div>
                  </div>
                </>
              )}
            </div>

            <p style={{ textAlign: "center", color: "#475569", fontSize: 13, marginTop: 8 }}>
              <a href="/client-dashboard" style={{ color: "#64748b" }}>
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
