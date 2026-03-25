/**
 * Estado de verificação de email antes de criar conta (pré-registo).
 * NÃO é a base formal de clientes — não grava email em claro: chave = HMAC(email).
 * TTL alinhado com o token (48h). Dev/local; em produção usar BD com política equivalente.
 */
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { getVerifyEmailSecret } from "./emailVerificationToken";

const TTL_MS = 48 * 3600 * 1000;

function filePath(): string {
  return path.join(process.cwd(), ".data", "signup_email_verified.json");
}

/** HMAC do email normalizado — o ficheiro não contém endereços em claro. */
function storeKeyForEmail(email: string): string {
  const em = email.trim().toLowerCase();
  const secret = getVerifyEmailSecret() || "__dev_missing_VERIFY_EMAIL_SECRET__";
  return crypto.createHmac("sha256", secret).update(`signup_pre_reg:${em}`).digest("hex");
}

function prune(map: Record<string, number>): Record<string, number> {
  const now = Date.now();
  const out: Record<string, number> = {};
  for (const [k, ts] of Object.entries(map)) {
    if (typeof ts === "number" && now - ts <= TTL_MS) out[k] = ts;
  }
  return out;
}

export function recordSignupEmailVerified(email: string): void {
  const em = email.trim().toLowerCase();
  if (!em.includes("@")) return;
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
  const key = storeKeyForEmail(em);
  map[key] = Date.now();
  // Remove legado em claro (migração silenciosa)
  if (map[em] != null) delete map[em];
  fs.writeFileSync(p, JSON.stringify(map, null, 2), "utf8");
}

export function isSignupEmailVerifiedOnServer(email: string): boolean {
  const em = email.trim().toLowerCase();
  if (!em.includes("@")) return false;
  const p = filePath();
  try {
    if (!fs.existsSync(p)) return false;
    const map = prune(JSON.parse(fs.readFileSync(p, "utf8")) as Record<string, number>);
    fs.writeFileSync(p, JSON.stringify(map, null, 2), "utf8");
    const key = storeKeyForEmail(em);
    const ts = map[key] ?? map[em];
    return typeof ts === "number" && Date.now() - ts <= TTL_MS;
  } catch {
    return false;
  }
}
