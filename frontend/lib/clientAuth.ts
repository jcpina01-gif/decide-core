import { setNotifyPhone } from "./clientPortfolioSchedule";

/**
 * Contas demo em localStorage (browser). Não substitui a base formal no servidor:
 * email/telemóvel operacionais para CRM devem ser gravados só após requisitos IBKR
 * (ver `/api/client/formal-registry/record` + `clientFormalRegistryStore`).
 */
export type ClientUserRecord = {
  passwordHash: string;
  email?: string;
  /** E.164, ex. +351912345678 — obrigatório em contas novas */
  phone?: string;
  /** Só true após clicar no link do email de confirmação */
  emailVerified?: boolean;
  updatedAt: number;
};

export type ClientUsersDb = Record<string, ClientUserRecord>;

const USERS_KEY = "decide_client_users_v1";
const SESSION_USER_KEY = "decide_client_session_user";
const SESSION_OK_KEY = "decide_client_session_ok";

/** Disparado no mesmo separador após login/logout para o dashboard actualizar o estado. */
export const CLIENT_SESSION_CHANGED_EVENT = "decide_client_session_changed";

function notifyClientSessionChanged(): void {
  try {
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event(CLIENT_SESSION_CHANGED_EVENT));
    }
  } catch {
    // ignore
  }
}

/** Query string: destino same-origin após login (só paths internos validados). */
export const CLIENT_LOGIN_NEXT_QUERY_PARAM = "next";

export function resolveSafeInternalLoginNextParam(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const t = (() => {
    try {
      return decodeURIComponent(String(raw).trim());
    } catch {
      return String(raw).trim();
    }
  })();
  if (!t.startsWith("/")) return null;
  if (t.startsWith("//")) return null;
  if (t.includes("://")) return null;
  return t;
}

export function readLoginNextDestinationFromWindow(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const v = new URLSearchParams(window.location.search).get(CLIENT_LOGIN_NEXT_QUERY_PARAM);
    return resolveSafeInternalLoginNextParam(v);
  } catch {
    return null;
  }
}

/** URL da página de login com redireccionamento pós-login opcional (evita perder o contexto do funil). */
export function buildClientLoginUrl(returnPath?: string): string {
  const safe = returnPath ? resolveSafeInternalLoginNextParam(returnPath) : null;
  if (!safe) return "/client/login";
  return `/client/login?${CLIENT_LOGIN_NEXT_QUERY_PARAM}=${encodeURIComponent(safe)}`;
}

/** Normaliza telemóvel para E.164 (mínimo para Twilio). Aceita +351… ou 9XXXXXXXX em PT. */
export function normalizeClientPhone(raw: string): { ok: true; e164: string } | { ok: false; error: string } {
  let s = (raw || "").trim().replace(/\s+/g, "");
  if (!s) return { ok: false, error: "Telemóvel é obrigatório." };
  if (s.startsWith("+")) {
    if (!/^\+[1-9]\d{6,14}$/.test(s)) {
      return { ok: false, error: "Formato inválido. Utilize E.164, ex.: +351912345678" };
    }
    return { ok: true, e164: s };
  }
  if (/^9\d{8}$/.test(s)) return { ok: true, e164: `+351${s}` };
  if (/^3519\d{8}$/.test(s)) return { ok: true, e164: `+${s}` };
  return { ok: false, error: "Indique o número com código do país, ex.: +351912345678 ou 912345678" };
}

function normalizeUsername(u: string): string {
  return u.trim().toLowerCase();
}

/** Regras de password (demo local). */
export const CLIENT_PASSWORD_MIN_LENGTH = 10;

export type PasswordStrengthBreakdown = {
  ok: boolean;
  minLength: boolean;
  hasUpper: boolean;
  hasLower: boolean;
  hasDigit: boolean;
  hasSpecial: boolean;
};

export function evaluatePasswordStrength(pw: string): PasswordStrengthBreakdown {
  const p = pw || "";
  const minLength = p.length >= CLIENT_PASSWORD_MIN_LENGTH;
  const hasUpper = /[A-Z]/.test(p);
  const hasLower = /[a-z]/.test(p);
  const hasDigit = /\d/.test(p);
  const hasSpecial = /[^A-Za-z0-9]/.test(p);
  const ok = minLength && hasUpper && hasLower && hasDigit && hasSpecial;
  return { ok, minLength, hasUpper, hasLower, hasDigit, hasSpecial };
}

export function passwordStrengthSummary(): string {
  return `Mínimo ${CLIENT_PASSWORD_MIN_LENGTH} caracteres, com pelo menos: uma maiúscula, uma minúscula, um algarismo e um símbolo (ex.: ! @ # $ %).`;
}

function hashPassword(pw: string): string {
  // Simple non-cryptographic hash for local demo storage.
  // Do NOT use this in production.
  let h = 5381;
  const s = pw || "";
  for (let i = 0; i < s.length; i += 1) h = (h * 33) ^ s.charCodeAt(i);
  return `h_${Math.abs(h >>> 0).toString(36)}`;
}

// ── Server prefs sync ─────────────────────────────────────────────────────────

const LS_PREFS_KEYS = [
  "decide_prefs_v1",
  "decide_fx_hedge_prefs_v1",
  "decide_onboarding_step5_hedge_done",
  "decide_client_segment_v1",
  "decide_client_fee_segment_v1",
  "decide_onboarding_montante_eur_v1",
  "decide_mifid_done_v1",
  "decide_kyc_done_v1",
  "decide_ibkr_prep_done_v1",
  "decide_onboarding_approved_v1",
];

/** Pull prefs from server and populate localStorage. Called after login. */
export async function syncPrefsFromServer(username: string, passwordHash: string): Promise<void> {
  try {
    const r = await fetch(
      `/api/client/prefs?username=${encodeURIComponent(username)}&passwordHash=${encodeURIComponent(passwordHash)}`,
      { signal: AbortSignal.timeout(8000) },
    );
    if (!r.ok) return;
    const j = (await r.json()) as { prefs?: Record<string, string> };
    if (!j.prefs || typeof j.prefs !== "object") return;
    for (const [k, v] of Object.entries(j.prefs)) {
      if (typeof v === "string" && v) {
        try { window.localStorage.setItem(k, v); } catch { /* ignore */ }
      }
    }
    // Ensure session is marked active after successful server sync
    try {
      window.localStorage.setItem(SESSION_USER_KEY, username);
      window.localStorage.setItem(SESSION_OK_KEY, "1");
    } catch { /* ignore */ }
    // Notify dashboard to re-read preferences
    window.dispatchEvent(new Event("decide_onboarding_ls_changed_v1"));
    notifyClientSessionChanged();
  } catch {
    // Non-critical — user can still use the app with defaults
  }
}

/** Push current localStorage prefs to server. Fire-and-forget. */
export async function pushPrefsToServer(username: string, passwordHash: string): Promise<void> {
  try {
    const prefs: Record<string, string> = {};
    for (const k of LS_PREFS_KEYS) {
      const v = window.localStorage.getItem(k);
      if (v) prefs[k] = v;
    }
    await fetch("/api/client/prefs", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, passwordHash, prefs }),
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    // Non-critical
  }
}

/**
 * Auto-repair: if the user has completed onboarding steps but lost the session flag
 * (e.g. new browser, cache clear), restore session_ok so they don't hit login walls.
 * Safe to call on every onboarding page mount.
 */
export function repairSessionFromOnboardingFlags(): void {
  try {
    if (typeof window === "undefined") return;
    if (window.localStorage.getItem(SESSION_OK_KEY) === "1") return;
    const ONBOARDING_STEP_KEYS = [
      "decide_onboarding_step1_done",
      "decide_onboarding_step2_done",
      "decide_onboarding_step3_done",
      "decide_onboarding_step4_done",
      "decide_onboarding_stripe_checkout_v1",
      "decide_ibkr_prep_done_v1",
    ];
    const hasProgress = ONBOARDING_STEP_KEYS.some(
      k => window.localStorage.getItem(k) === "1",
    );
    if (!hasProgress) return;
    window.localStorage.setItem(SESSION_OK_KEY, "1");
    notifyClientSessionChanged();
  } catch {
    // ignore
  }
}

/**
 * Convenience: push prefs for the current session user.
 * Reads credentials from localStorage — call this whenever prefs change.
 */
export function pushCurrentSessionPrefs(): void {
  try {
    if (typeof window === "undefined") return;
    const u = window.localStorage.getItem(SESSION_USER_KEY);
    if (!u) return;
    const db = readDb();
    const ph = db[u]?.passwordHash;
    if (!ph) return;
    pushPrefsToServer(u, ph).catch(() => {/* ignore */});
  } catch {
    // ignore
  }
}

function readDb(): ClientUsersDb {
  try {
    if (typeof window === "undefined") return {};
    const raw = window.localStorage.getItem(USERS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    return parsed as ClientUsersDb;
  } catch {
    return {};
  }
}

function writeDb(db: ClientUsersDb) {
  try {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(USERS_KEY, JSON.stringify(db));
  } catch {
    // ignore
  }
}

export function getCurrentSessionUser(): string | null {
  try {
    if (typeof window === "undefined") return null;
    const ok = window.localStorage.getItem(SESSION_OK_KEY) === "1";
    if (!ok) return null;
    const u = window.localStorage.getItem(SESSION_USER_KEY);
    return u ? String(u) : null;
  } catch {
    return null;
  }
}

export function isClientLoggedIn(): boolean {
  try {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(SESSION_OK_KEY) === "1";
  } catch {
    return false;
  }
}

export function logoutClient() {
  try {
    if (typeof window === "undefined") return;
    window.localStorage.removeItem(SESSION_USER_KEY);
    window.localStorage.setItem(SESSION_OK_KEY, "0");
    notifyClientSessionChanged();
  } catch {
    // ignore
  }
}

const SIGNUP_EMAIL_VERIFIED_KEY = "decide_signup_email_verified_v1";

/** Gravado após abrir o link no email (fluxo pré-registo). Usa localStorage para funcionar entre separadores. */
export function setSignupEmailVerifiedFromServerEmail(email: string): void {
  try {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(
      SIGNUP_EMAIL_VERIFIED_KEY,
      JSON.stringify({ email: email.trim().toLowerCase(), ts: Date.now() }),
    );
  } catch {
    // ignore
  }
}

export function isSignupEmailVerifiedForInput(email: string): boolean {
  try {
    if (typeof window === "undefined") return false;
    const raw = window.localStorage.getItem(SIGNUP_EMAIL_VERIFIED_KEY);
    if (!raw) return false;
    const o = JSON.parse(raw) as { email?: string; ts?: number };
    if (!o.email || o.email !== email.trim().toLowerCase()) return false;
    if (typeof o.ts !== "number" || Date.now() - o.ts > 48 * 3600 * 1000) return false;
    return true;
  } catch {
    return false;
  }
}

/** Confirmação gravada no servidor (ex.: link aberto no telemóvel) — para sincronizar com o PC. */
export async function fetchSignupEmailVerifiedFromServer(email: string): Promise<boolean> {
  try {
    const em = email.trim().toLowerCase();
    if (!em.includes("@") || typeof window === "undefined") return false;
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 12_000);
    const r = await fetch(`/api/client/email-verification/status?email=${encodeURIComponent(em)}`, {
      signal: controller.signal,
    });
    window.clearTimeout(timer);
    const j = (await r.json()) as { verified?: boolean };
    return r.ok && j.verified === true;
  } catch {
    return false;
  }
}

/** Lista de interessados (dashboard) — gravado em `prospect_leads.json` após clicar no link. */
export async function fetchProspectEmailVerifiedFromServer(email: string): Promise<boolean> {
  try {
    const em = email.trim().toLowerCase();
    if (!em.includes("@") || typeof window === "undefined") return false;
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 12_000);
    const r = await fetch(`/api/client/email-verification/status?email=${encodeURIComponent(em)}`, {
      signal: controller.signal,
    });
    window.clearTimeout(timer);
    const j = (await r.json()) as { prospectVerified?: boolean };
    return r.ok && j.prospectVerified === true;
  } catch {
    return false;
  }
}

export function clearSignupEmailVerifiedFlag(): void {
  try {
    if (typeof window === "undefined") return;
    window.localStorage.removeItem(SIGNUP_EMAIL_VERIFIED_KEY);
  } catch {
    // ignore
  }
}

const CLIENT_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Parte local do email em formato de utilizador (minúsculas, a-z 0-9 . _ -).
 * String vazia se não houver parte local válida com pelo menos 2 caracteres.
 */
export function deriveClientUsernameFromEmail(emailRaw: string): string {
  const em = (emailRaw || "").trim().toLowerCase();
  if (!em.includes("@")) return "";
  const local = em.split("@")[0]!;
  const s = local.replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return s.length >= 2 ? s : "";
}

/**
 * Sugestão no registo: igual a `deriveClientUsernameFromEmail`, ou identificador único
 * quando a parte local do email é demasiado curta (email válido).
 */
export function suggestClientUsernameFromEmail(emailRaw: string): string {
  const base = deriveClientUsernameFromEmail(emailRaw);
  if (base.length >= 2) return base;
  const em = (emailRaw || "").trim().toLowerCase();
  if (CLIENT_EMAIL_RE.test(em)) {
    return `cliente-${Math.random().toString(36).slice(2, 9)}`;
  }
  return "";
}

export type RegisterClientUserErrorField =
  | "email"
  | "phone"
  | "username"
  | "password"
  | "passwordConfirm"
  | "emailNotVerified"
  | "phoneNotVerified";

const SIGNUP_PHONE_VERIFIED_KEY = "decide_signup_phone_verified_v1";

/** Gravado após confirmar o código SMS (pré-registo). */
export function setSignupPhoneVerifiedFromServerPhone(e164: string): void {
  try {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(
      SIGNUP_PHONE_VERIFIED_KEY,
      JSON.stringify({ phone: e164.trim(), ts: Date.now() }),
    );
  } catch {
    // ignore
  }
}

export function isSignupPhoneVerifiedForInput(phoneRaw: string): boolean {
  try {
    const ph = normalizeClientPhone(phoneRaw);
    if (!ph.ok) return false;
    if (typeof window === "undefined") return false;
    const raw = window.localStorage.getItem(SIGNUP_PHONE_VERIFIED_KEY);
    if (!raw) return false;
    const o = JSON.parse(raw) as { phone?: string; ts?: number };
    if (!o.phone || o.phone !== ph.e164) return false;
    if (typeof o.ts !== "number" || Date.now() - o.ts > 48 * 3600 * 1000) return false;
    return true;
  } catch {
    return false;
  }
}

/** Sincroniza com o servidor (ex.: confirmaste o SMS doutro dispositivo). */
export async function fetchSignupPhoneVerifiedFromServer(phoneRaw: string): Promise<boolean> {
  try {
    const ph = normalizeClientPhone(phoneRaw);
    if (!ph.ok || typeof window === "undefined") return false;
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 12_000);
    const r = await fetch(`/api/client/phone-verification/status?phone=${encodeURIComponent(ph.e164)}`, {
      signal: controller.signal,
    });
    window.clearTimeout(timer);
    const j = (await r.json()) as { verified?: boolean };
    return r.ok && j.verified === true;
  } catch {
    return false;
  }
}

export function clearSignupPhoneVerifiedFlag(): void {
  try {
    if (typeof window === "undefined") return;
    window.localStorage.removeItem(SIGNUP_PHONE_VERIFIED_KEY);
  } catch {
    // ignore
  }
}

export function registerClientUser(
  username: string,
  password: string,
  passwordConfirm: string,
  email: string,
  phone: string,
  opts?: { requirePhoneSms?: boolean },
): {
  ok: boolean;
  error?: string;
  field?: RegisterClientUserErrorField;
} {
  const u = normalizeUsername(username);
  const pw = password || "";
  const pwc = passwordConfirm || "";
  const emailTrim = (email || "").trim();
  const requirePhone = opts?.requirePhoneSms !== false;
  const ph = normalizeClientPhone(phone);
  if (requirePhone && !ph.ok) return { ok: false, error: ph.error, field: "phone" };

  if (!u) return { ok: false, error: "User é obrigatório.", field: "username" };
  if (!emailTrim || !emailTrim.includes("@")) {
    return { ok: false, error: "Email é obrigatório.", field: "email" };
  }
  if (!CLIENT_EMAIL_RE.test(emailTrim)) {
    return { ok: false, error: "Formato de email inválido.", field: "email" };
  }
  if (!evaluatePasswordStrength(pw).ok) {
    return {
      ok: false,
      error: `Password fraca. ${passwordStrengthSummary()}`,
      field: "password",
    };
  }
  if (pw !== pwc) return { ok: false, error: "As passwords não coincidem.", field: "passwordConfirm" };

  const db = readDb();
  const prev = db[u];
  const emailChanged =
    !prev || (prev.email || "").trim().toLowerCase() !== emailTrim.toLowerCase();
  const keepVerified = !!(prev && !emailChanged && prev.emailVerified === true);

  // Email verification is recommended but not required to create the account.
  // The account is created immediately; verification can happen afterward.
  const preVerifiedNow = isSignupEmailVerifiedForInput(emailTrim);

  if (opts?.requirePhoneSms && !isSignupPhoneVerifiedForInput(phone)) {
    return {
      ok: false,
      error:
        "Confirme o telemóvel: no passo «Confirmação» envie o SMS e introduza o código nesse passo — depois volte aqui para criar a conta.",
      field: "phoneNotVerified",
    };
  }

  // Demo UX: se o user já existir, atualiza email/password/telemóvel em vez de bloquear.
  db[u] = {
    passwordHash: hashPassword(pw),
    email: emailTrim,
    phone: ph.ok ? ph.e164 : "",
    emailVerified: keepVerified || preVerifiedNow,
    updatedAt: Date.now(),
  };
  writeDb(db);
  if (ph.ok) setNotifyPhone(u, ph.e164);
  clearSignupEmailVerifiedFlag();
  clearSignupPhoneVerifiedFlag();
  return { ok: true };
}

export function getCurrentSessionUserEmail(): string | null {
  try {
    const u = getCurrentSessionUser();
    if (!u) return null;
    const db = readDb();
    const rec = db[u];
    if (!rec) return null;
    return rec.email ? String(rec.email) : null;
  } catch {
    return null;
  }
}

export function getCurrentSessionUserPhone(): string | null {
  try {
    const u = getCurrentSessionUser();
    if (!u) return null;
    const rec = readDb()[u];
    if (!rec?.phone) return null;
    return String(rec.phone);
  } catch {
    return null;
  }
}

/** Atualiza email e telemóvel da conta com sessão iniciada (ex.: conta antiga sem telemóvel). */
export function updateClientContact(
  email: string,
  phone: string,
): { ok: boolean; error?: string; phoneE164?: string } {
  const u = getCurrentSessionUser();
  if (!u) return { ok: false, error: "Precisas de estar com login." };
  const ph = normalizeClientPhone(phone);
  if (!ph.ok) return { ok: false, error: ph.error };
  const db = readDb();
  const rec = db[u];
  if (!rec) return { ok: false, error: "User não encontrado." };
  const emailParam = (email || "").trim();
  const emailTrim =
    emailParam && emailParam.includes("@") ? emailParam : (rec.email || "").trim();
  if (!emailTrim || !emailTrim.includes("@")) {
    return {
      ok: false,
      error:
        "É preciso email na conta para gravar o telemóvel. Complete o registo ou o email em /client/register.",
    };
  }
  const emailChanged = (rec.email || "").trim().toLowerCase() !== emailTrim.toLowerCase();
  db[u] = {
    ...rec,
    email: emailTrim,
    phone: ph.e164,
    emailVerified: emailChanged ? false : rec.emailVerified === true,
    updatedAt: Date.now(),
  };
  writeDb(db);
  setNotifyPhone(u, ph.e164);
  return { ok: true, phoneE164: ph.e164 };
}

/** Email da sessão considerado válido para alertas (confirmado por link). */
export function isSessionEmailVerified(): boolean {
  try {
    const u = getCurrentSessionUser();
    if (!u) return false;
    const rec = readDb()[u];
    return rec?.emailVerified === true;
  } catch {
    return false;
  }
}

/** Marca email confirmado no browser (após API validar o token). */
export function markEmailVerified(username: string, email: string): { ok: boolean; error?: string } {
  const u = normalizeUsername(username);
  const em = (email || "").trim().toLowerCase();
  const db = readDb();
  const rec = db[u];
  if (!rec) return { ok: false, error: "no_local_account" };
  if ((rec.email || "").trim().toLowerCase() !== em) return { ok: false, error: "email_mismatch" };
  db[u] = { ...rec, emailVerified: true, updatedAt: Date.now() };
  writeDb(db);
  return { ok: true };
}

/** 90s: 1.º pedido a uma API route no `next dev` pode demorar a compilar. */
const NOTIFY_FETCH_MS = 90_000;

async function notifyFetch(url: string, init: RequestInit): Promise<Response> {
  if (typeof AbortController === "undefined") {
    return fetch(url, init);
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), NOTIFY_FETCH_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function fetchNotifyError(e: unknown): string {
  const name = e && typeof e === "object" && "name" in e ? String((e as { name?: string }).name) : "";
  if (name === "AbortError" || name === "TimeoutError") {
    return "O pedido expirou. Se acabou de arrancar o Next, aguarde ~1 min pela compilação e tente outra vez.";
  }
  return "Sem ligação ao servidor.";
}

/** Link de confirmação antes de existir conta (só email no token). */
export async function requestEmailVerificationSignupSend(
  email: string,
): Promise<{
  ok: boolean;
  error?: string;
  mode?: string;
  link?: string;
  linkBase?: string;
  provider?: string;
  outboundId?: string;
}> {
  try {
    const r = await notifyFetch("/api/client/email-verification/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: email.trim(), signupOnly: true }),
    });
    const j = (await r.json()) as {
      ok?: boolean;
      error?: string;
      hint?: string;
      mode?: string;
      link?: string;
      linkBase?: string;
      message?: string;
      provider?: string;
      id?: string;
    };
    if (!r.ok) {
      const parts = [j.hint, j.error].filter((x): x is string => Boolean(x && String(x).trim()));
      const dedup = parts[0] === parts[1] ? [parts[0]] : parts;
      return { ok: false, error: dedup.join(" — ") || `Erro ${r.status}` };
    }
    if (j.mode === "simulated" && j.link) {
      return { ok: true, mode: j.mode, link: j.link, error: j.message, linkBase: j.linkBase };
    }
    if (j.mode === "sent" && j.link) {
      return {
        ok: true,
        mode: j.mode,
        link: j.link,
        linkBase: j.linkBase,
        provider: j.provider,
        outboundId: j.id,
      };
    }
    return { ok: true, mode: j.mode };
  } catch (e) {
    return { ok: false, error: fetchNotifyError(e) };
  }
}

/** Lista de interessados: confirma email para comunicações sem criar conta (gravado noutro ficheiro no servidor). */
export async function requestEmailVerificationProspectSend(
  email: string,
  opts?: { prospectSource?: string },
): Promise<{ ok: boolean; error?: string; mode?: string; link?: string; linkBase?: string }> {
  try {
    const body: Record<string, unknown> = { email: email.trim(), prospectOnly: true };
    if (opts?.prospectSource) body.prospectSource = opts.prospectSource;
    const r = await notifyFetch("/api/client/email-verification/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const j = (await r.json()) as {
      ok?: boolean;
      error?: string;
      hint?: string;
      mode?: string;
      link?: string;
      linkBase?: string;
      message?: string;
    };
    if (!r.ok) {
      const parts = [j.hint, j.error].filter((x): x is string => Boolean(x && String(x).trim()));
      const dedup = parts[0] === parts[1] ? [parts[0]] : parts;
      return { ok: false, error: dedup.join(" — ") || `Erro ${r.status}` };
    }
    if (j.mode === "simulated" && j.link) {
      return { ok: true, mode: j.mode, link: j.link, error: j.message, linkBase: j.linkBase };
    }
    if (j.mode === "sent" && j.link) {
      return { ok: true, mode: j.mode, link: j.link, linkBase: j.linkBase };
    }
    return { ok: true, mode: j.mode };
  } catch (e) {
    return { ok: false, error: fetchNotifyError(e) };
  }
}

/** Pedido ao Next para enviar email com link de confirmação (conta já com user). */
export async function requestEmailVerificationSend(
  username: string,
  email: string,
): Promise<{ ok: boolean; error?: string; mode?: string; link?: string }> {
  try {
    const r = await notifyFetch("/api/client/email-verification/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: username.trim().toLowerCase(), email: email.trim() }),
    });
    const j = (await r.json()) as {
      ok?: boolean;
      error?: string;
      hint?: string;
      mode?: string;
      link?: string;
      linkBase?: string;
      message?: string;
    };
    if (!r.ok) {
      const parts = [j.hint, j.error].filter((x): x is string => Boolean(x && String(x).trim()));
      const dedup = parts[0] === parts[1] ? [parts[0]] : parts;
      return { ok: false, error: dedup.join(" — ") || `Erro ${r.status}` };
    }
    if (j.mode === "simulated" && j.link) {
      return { ok: true, mode: j.mode, link: j.link, error: j.message, linkBase: j.linkBase };
    }
    if (j.mode === "sent" && j.link) {
      return { ok: true, mode: j.mode, link: j.link, linkBase: j.linkBase };
    }
    return { ok: true, mode: j.mode };
  } catch (e) {
    return { ok: false, error: fetchNotifyError(e) };
  }
}

export function loginClientUser(username: string, password: string): {
  ok: boolean;
  error?: string;
} {
  const u = normalizeUsername(username);
  const pw = password || "";
  if (!u) return { ok: false, error: "User é obrigatório." };
  if (!pw) return { ok: false, error: "Password é obrigatória." };

  const db = readDb();
  const rec = db[u];
  if (!rec) return { ok: false, error: "User não encontrado." };
  if (rec.passwordHash !== hashPassword(pw)) return { ok: false, error: "Password incorreta." };

  try {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(SESSION_USER_KEY, u);
      window.localStorage.setItem(SESSION_OK_KEY, "1");
      notifyClientSessionChanged();
    }
  } catch {
    // ignore
  }

  return { ok: true };
}

/**
 * Async login: checks server first, falls back to localStorage.
 * The server is the source of truth — works across browsers/devices/cache clears.
 */
export async function loginClientUserAsync(
  username: string,
  password: string,
): Promise<{ ok: boolean; error?: string }> {
  const u = normalizeUsername(username);
  const pw = password || "";
  if (!u) return { ok: false, error: "User é obrigatório." };
  if (!pw) return { ok: false, error: "Password é obrigatória." };

  const ph = hashPassword(pw);

  // 1. Try server
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    const r = await fetch("/api/client/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: u, passwordHash: ph }),
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (r.ok) {
      // Sync to localStorage so future calls work offline
      try {
        const db = readDb();
        if (!db[u]) {
          db[u] = { passwordHash: ph, updatedAt: Date.now() };
          writeDb(db);
        }
      } catch { /* ignore */ }

      try {
        if (typeof window !== "undefined") {
          window.localStorage.setItem(SESSION_USER_KEY, u);
          window.localStorage.setItem(SESSION_OK_KEY, "1");
          notifyClientSessionChanged();
          // Pull user preferences from server into localStorage
          syncPrefsFromServer(u, ph).catch(() => {/* ignore */});
        }
      } catch { /* ignore */ }
      return { ok: true };
    }

    if (r.status === 401) {
      const j = (await r.json()) as { error?: string };
      // wrong_password is authoritative (user exists on server but pw is wrong)
      if (j.error === "wrong_password") {
        return { ok: false, error: "Password incorreta." };
      }
      // user_not_found on server → fall through to localStorage
      // (user may have been registered locally only, or server store was reset)
    }
    // Server error or user_not_found — fall through to localStorage
  } catch {
    // Network error — fall through to localStorage
  }

  // 2. Fallback: localStorage (offline / dev)
  const localResult = loginClientUser(username, password);
  if (localResult.ok && typeof window !== "undefined") {
    syncPrefsFromServer(u, ph).catch(() => {/* ignore */});
  }
  return localResult;
}

/**
 * Async register: saves to server AND localStorage.
 * Server is the source of truth; localStorage acts as local cache.
 */
export async function registerClientUserAsync(params: {
  username: string;
  password: string;
  email: string;
  phone?: string;
  emailVerified?: boolean;
}): Promise<{ ok: boolean; error?: string; field?: RegisterClientUserErrorField }> {
  const u = normalizeUsername(params.username);
  const pw = params.password || "";
  if (!u) return { ok: false, error: "User é obrigatório.", field: "username" };
  if (!pw) return { ok: false, error: "Password é obrigatória.", field: "password" };

  const ph = hashPassword(pw);

  // Try to persist on server (non-blocking: failure is silent, localStorage still works)
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    await fetch("/api/client/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: u,
        passwordHash: ph,
        email: params.email,
        phone: params.phone,
        emailVerified: params.emailVerified ?? false,
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);
  } catch {
    // Network error — account still saved locally below
  }

  // Always save to localStorage as well
  const db = readDb();
  const existing = db[u];
  db[u] = {
    passwordHash: ph,
    email: params.email || existing?.email || "",
    phone: params.phone || existing?.phone || "",
    emailVerified: params.emailVerified ?? existing?.emailVerified ?? false,
    updatedAt: Date.now(),
  };
  writeDb(db);

  return { ok: true };
}

export function changeClientPassword(params: {
  username: string;
  currentPassword: string;
  newPassword: string;
  newPasswordConfirm: string;
}): { ok: boolean; error?: string } {
  const u = normalizeUsername(params.username);
  const current = params.currentPassword || "";
  const next = params.newPassword || "";
  const nextC = params.newPasswordConfirm || "";

  if (!u) return { ok: false, error: "User é obrigatório." };
  if (current.length < 1) return { ok: false, error: "Password atual é obrigatória." };
  if (!evaluatePasswordStrength(next).ok) {
    return { ok: false, error: `Nova password fraca. ${passwordStrengthSummary()}` };
  }
  if (next !== nextC) return { ok: false, error: "As novas passwords não coincidem." };

  const db = readDb();
  const rec = db[u];
  if (!rec) return { ok: false, error: "User não encontrado." };
  if (rec.passwordHash !== hashPassword(current)) return { ok: false, error: "Password atual incorreta." };

  db[u] = { ...rec, passwordHash: hashPassword(next), updatedAt: Date.now() };
  writeDb(db);
  return { ok: true };
}

