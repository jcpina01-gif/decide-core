/**
 * Verificação de telemóvel antes de criar conta (pré-registo), espelhando o fluxo do email.
 * Chave = HMAC(telefone normalizado) — não guarda número em claro no JSON.
 */
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { getVerifyEmailSecret } from "./emailVerificationToken";

const TTL_MS = 48 * 3600 * 1000;

function filePath(): string {
  return path.join(process.cwd(), ".data", "signup_phone_verified.json");
}

function storeKeyForPhone(e164: string): string {
  const ph = e164.trim();
  const secret = getVerifyEmailSecret() || "__dev_missing_VERIFY_EMAIL_SECRET__";
  return crypto.createHmac("sha256", secret).update(`signup_pre_reg_phone:${ph}`).digest("hex");
}

function prune(map: Record<string, number>): Record<string, number> {
  const now = Date.now();
  const out: Record<string, number> = {};
  for (const [k, ts] of Object.entries(map)) {
    if (typeof ts === "number" && now - ts <= TTL_MS) out[k] = ts;
  }
  return out;
}

export function recordSignupPhoneVerified(e164: string): void {
  const ph = e164.trim();
  if (!ph.startsWith("+")) return;
  const p = filePath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  let map: Record<string, number> = {};
  try {
    if (fs.existsSync(p)) {
      map = JSON.parse(fs.readFileSync(p, "utf8")) as Record<string, number>;
    }
  } catch {
    map = {};
  }
  map = prune(map);
  map[storeKeyForPhone(ph)] = Date.now();
  fs.writeFileSync(p, JSON.stringify(map, null, 2), "utf8");
}

export function isSignupPhoneVerifiedOnServer(e164: string): boolean {
  const ph = e164.trim();
  if (!ph.startsWith("+")) return false;
  const p = filePath();
  try {
    if (!fs.existsSync(p)) return false;
    const map = prune(JSON.parse(fs.readFileSync(p, "utf8")) as Record<string, number>);
    fs.writeFileSync(p, JSON.stringify(map, null, 2), "utf8");
    const ts = map[storeKeyForPhone(ph)];
    return typeof ts === "number" && Date.now() - ts <= TTL_MS;
  } catch {
    return false;
  }
}
