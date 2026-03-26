/**
 * Códigos SMS de verificação (10 min). Hash do código — não armazena dígitos em claro.
 */
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { getVerifyEmailSecret } from "./emailVerificationToken";
import { getServerPersistDir } from "./persistDir";

const PENDING_TTL_MS = 10 * 60 * 1000;
const RATE_WINDOW_MS = 60 * 60 * 1000;
const MAX_SENDS_PER_HOUR = 5;

type PendingEntry = { codeHash: string; exp: number };
type RateEntry = { sends: number[] };

function pendingPath(): string {
  return path.join(getServerPersistDir(), "phone_verification_pending.json");
}

function ratePath(): string {
  return path.join(getServerPersistDir(), "phone_verification_rate.json");
}

function phoneHmac(phone: string): string {
  const secret = getVerifyEmailSecret() || "__dev_missing_VERIFY_EMAIL_SECRET__";
  return crypto.createHmac("sha256", secret).update(`pv:${phone.trim()}`).digest("hex");
}

export function hashVerificationCode(phone: string, code: string): string {
  const secret = getVerifyEmailSecret() || "__dev_missing_VERIFY_EMAIL_SECRET__";
  return crypto
    .createHash("sha256")
    .update(`${secret}|phone_otp|${phone.trim()}|${code.trim()}`)
    .digest("hex");
}

function readPending(): Record<string, PendingEntry> {
  const p = pendingPath();
  try {
    if (!fs.existsSync(p)) return {};
    return JSON.parse(fs.readFileSync(p, "utf8")) as Record<string, PendingEntry>;
  } catch {
    return {};
  }
}

function writePending(m: Record<string, PendingEntry>) {
  const p = pendingPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(m, null, 2), "utf8");
}

function prunePending(m: Record<string, PendingEntry>): Record<string, PendingEntry> {
  const now = Date.now();
  const out: Record<string, PendingEntry> = {};
  for (const [k, v] of Object.entries(m)) {
    if (v && typeof v.exp === "number" && v.exp > now) out[k] = v;
  }
  return out;
}

export function canSendPhoneVerification(phone: string): { ok: true } | { ok: false; error: string } {
  const key = phoneHmac(phone);
  const p = ratePath();
  let map: Record<string, RateEntry> = {};
  try {
    if (fs.existsSync(p)) {
      map = JSON.parse(fs.readFileSync(p, "utf8")) as Record<string, RateEntry>;
    }
  } catch {
    map = {};
  }
  const now = Date.now();
  const windowStart = now - RATE_WINDOW_MS;
  const entry = map[key] || { sends: [] };
  const recent = entry.sends.filter((t) => t > windowStart);
  if (recent.length >= MAX_SENDS_PER_HOUR) {
    return { ok: false, error: "rate_limited" };
  }
  return { ok: true };
}

export function recordPhoneVerificationSend(phone: string): void {
  const key = phoneHmac(phone);
  const p = ratePath();
  let map: Record<string, RateEntry> = {};
  try {
    if (fs.existsSync(p)) {
      map = JSON.parse(fs.readFileSync(p, "utf8")) as Record<string, RateEntry>;
    }
  } catch {
    map = {};
  }
  const now = Date.now();
  const windowStart = now - RATE_WINDOW_MS;
  const prev = map[key]?.sends || [];
  map[key] = { sends: [...prev.filter((t) => t > windowStart), now] };
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(map, null, 2), "utf8");
}

export function savePendingCode(phone: string, code: string): void {
  const key = phoneHmac(phone);
  const m = prunePending(readPending());
  m[key] = {
    codeHash: hashVerificationCode(phone, code),
    exp: Date.now() + PENDING_TTL_MS,
  };
  writePending(m);
}

export function verifyAndConsumePendingCode(phone: string, code: string): boolean {
  const key = phoneHmac(phone);
  const m = prunePending(readPending());
  const ent = m[key];
  if (!ent || !ent.codeHash) return false;
  if (Date.now() > ent.exp) {
    delete m[key];
    writePending(m);
    return false;
  }
  const tryHash = hashVerificationCode(phone, code);
  const a = Buffer.from(tryHash, "utf8");
  const b = Buffer.from(ent.codeHash, "utf8");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return false;
  }
  delete m[key];
  writePending(m);
  return true;
}
