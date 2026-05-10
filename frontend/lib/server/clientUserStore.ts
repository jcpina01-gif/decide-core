/**
 * Server-side user credential store — persists to .data/client_users.json
 * Credentials (username + password hash) are stored on the server so they
 * survive browser cache clears and work across all devices/browsers.
 *
 * Password is hashed with the same deterministic hash used client-side
 * (NOT cryptographic — suitable only for this demo/internal tool).
 */
import fs from "fs";
import path from "path";

export type ServerUserRecord = {
  passwordHash: string;
  email?: string;
  phone?: string;
  emailVerified?: boolean;
  createdAt: number;
  updatedAt: number;
};

type UsersFileShape = Record<string, ServerUserRecord>;

function filePath(): string {
  return path.join(process.cwd(), ".data", "client_users.json");
}

function readAll(): UsersFileShape {
  const p = filePath();
  try {
    if (!fs.existsSync(p)) return {};
    const raw = fs.readFileSync(p, "utf8");
    const parsed = JSON.parse(raw) as UsersFileShape;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeAll(data: UsersFileShape): void {
  const p = filePath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data, null, 2), "utf8");
}

/** Same non-cryptographic hash as clientAuth.ts — must stay in sync. */
export function hashPasswordServer(pw: string): string {
  let h = 5381;
  const s = pw || "";
  for (let i = 0; i < s.length; i += 1) h = (h * 33) ^ s.charCodeAt(i);
  return `h_${Math.abs(h >>> 0).toString(36)}`;
}

export function normalizeUsernameServer(u: string): string {
  return (u || "").trim().toLowerCase();
}

export type RegisterServerResult =
  | { ok: true }
  | { ok: false; error: string; field?: string };

export function registerUserServer(params: {
  username: string;
  passwordHash: string;
  email?: string;
  phone?: string;
  emailVerified?: boolean;
}): RegisterServerResult {
  const u = normalizeUsernameServer(params.username);
  if (!u) return { ok: false, error: "username_required", field: "username" };

  const db = readAll();
  const now = Date.now();
  const existing = db[u];
  db[u] = {
    passwordHash: params.passwordHash,
    email: params.email || existing?.email || "",
    phone: params.phone || existing?.phone || "",
    emailVerified: params.emailVerified ?? existing?.emailVerified ?? false,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  writeAll(db);
  return { ok: true };
}

export type LoginServerResult =
  | { ok: true; user: string }
  | { ok: false; error: string };

export function loginUserServer(params: {
  username: string;
  passwordHash: string;
}): LoginServerResult {
  const u = normalizeUsernameServer(params.username);
  if (!u) return { ok: false, error: "username_required" };

  const db = readAll();
  const rec = db[u];
  if (!rec) return { ok: false, error: "user_not_found" };
  if (rec.passwordHash !== params.passwordHash)
    return { ok: false, error: "wrong_password" };

  return { ok: true, user: u };
}

export function getUserServer(username: string): ServerUserRecord | null {
  const u = normalizeUsernameServer(username);
  if (!u) return null;
  return readAll()[u] ?? null;
}
