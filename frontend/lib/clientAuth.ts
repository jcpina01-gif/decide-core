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

/** Normaliza telemóvel para E.164 (mínimo para Twilio). Aceita +351… ou 9XXXXXXXX em PT. */
export function normalizeClientPhone(raw: string): { ok: true; e164: string } | { ok: false; error: string } {
  let s = (raw || "").trim().replace(/\s+/g, "");
  if (!s) return { ok: false, error: "Telemóvel é obrigatório." };
  if (s.startsWith("+")) {
    if (!/^\+[1-9]\d{6,14}$/.test(s)) {
      return { ok: false, error: "Formato inválido. Usa E.164, ex.: +351912345678" };
    }
    return { ok: true, e164: s };
  }
  if (/^9\d{8}$/.test(s)) return { ok: true, e164: `+351${s}` };
  if (/^3519\d{8}$/.test(s)) return { ok: true, e164: `+${s}` };
  return { ok: false, error: "Indica o número com código do país, ex.: +351912345678 ou 912345678" };
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

export function clearSignupEmailVerifiedFlag(): void {
  try {
    if (typeof window === "undefined") return;
    window.localStorage.removeItem(SIGNUP_EMAIL_VERIFIED_KEY);
  } catch {
    // ignore
  }
}

const CLIENT_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
  const ph = normalizeClientPhone(phone);
  if (!ph.ok) return { ok: false, error: ph.error, field: "phone" };

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

  if (!keepVerified && !isSignupEmailVerifiedForInput(emailTrim)) {
    return {
      ok: false,
      error: "Confirma o email: abre o link que enviámos antes de criar a conta.",
      field: "emailNotVerified",
    };
  }

  if (opts?.requirePhoneSms && !isSignupPhoneVerifiedForInput(phone)) {
    return {
      ok: false,
      error:
        "Confirma o telemóvel: no passo «Confirmação» envia o SMS e introduz o código lá — depois volta aqui para criar a conta.",
      field: "phoneNotVerified",
    };
  }

  const preVerified = isSignupEmailVerifiedForInput(emailTrim);

  // Demo UX: se o user já existir, atualiza email/password/telemóvel em vez de bloquear.
  db[u] = {
    passwordHash: hashPassword(pw),
    email: emailTrim,
    phone: ph.e164,
    emailVerified: keepVerified || preVerified,
    updatedAt: Date.now(),
  };
  writeDb(db);
  setNotifyPhone(u, ph.e164);
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
export function updateClientContact(email: string, phone: string): { ok: boolean; error?: string } {
  const u = getCurrentSessionUser();
  if (!u) return { ok: false, error: "Precisas de estar com login." };
  const emailTrim = (email || "").trim();
  if (!emailTrim || !emailTrim.includes("@")) return { ok: false, error: "Email é obrigatório." };
  const ph = normalizeClientPhone(phone);
  if (!ph.ok) return { ok: false, error: ph.error };
  const db = readDb();
  const rec = db[u];
  if (!rec) return { ok: false, error: "User não encontrado." };
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
  return { ok: true };
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
    return "O pedido expirou. Se acabaste de arrancar o Next, espera ~1 min pela compilação e tenta outra vez.";
  }
  return "Sem ligação ao servidor.";
}

/** Link de confirmação antes de existir conta (só email no token). */
export async function requestEmailVerificationSignupSend(
  email: string,
): Promise<{ ok: boolean; error?: string; mode?: string; link?: string }> {
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

