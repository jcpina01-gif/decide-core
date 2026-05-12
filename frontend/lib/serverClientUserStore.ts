/**
 * Server-side user store for client auth.
 *
 * Persistence strategy (in priority order):
 *  1. DECIDE_CLIENT_USERS_JSON env var — JSON string of { [username]: { passwordHash, email?, ... } }
 *     Set this in Vercel dashboard to persist users across deploys.
 *  2. DECIDE_CLIENT_USERS_SEED env var — comma-separated "user:hash" pairs for a quick seed.
 *     Example: DECIDE_CLIENT_USERS_SEED=jcpina01:h_abc123,admin:h_xyz456
 *  3. In-memory cache — lasts while the serverless function is warm (minutes to hours).
 *     Enough for same-session register → login flows.
 */

export type ServerUserRecord = {
  passwordHash: string;
  email?: string;
  phone?: string;
  emailVerified?: boolean;
  updatedAt: number;
};

export type ServerUsersDb = Record<string, ServerUserRecord>;

// Module-level cache — survives within a warm serverless instance
const _cache: ServerUsersDb = {};
let _cacheLoaded = false;

function loadFromEnv(): ServerUsersDb {
  const db: ServerUsersDb = {};

  // DECIDE_CLIENT_USERS_JSON — full JSON blob
  const jsonEnv = process.env.DECIDE_CLIENT_USERS_JSON;
  if (jsonEnv) {
    try {
      const parsed = JSON.parse(jsonEnv);
      if (parsed && typeof parsed === "object") {
        for (const [u, v] of Object.entries(parsed)) {
          if (v && typeof v === "object" && "passwordHash" in (v as object)) {
            db[u.toLowerCase()] = v as ServerUserRecord;
          }
        }
      }
    } catch {
      // malformed — ignore
    }
  }

  // DECIDE_CLIENT_USERS_SEED — simple "user:hash,user2:hash2" pairs
  const seedEnv = process.env.DECIDE_CLIENT_USERS_SEED;
  if (seedEnv) {
    for (const pair of seedEnv.split(",")) {
      const idx = pair.indexOf(":");
      if (idx < 1) continue;
      const u = pair.slice(0, idx).trim().toLowerCase();
      const h = pair.slice(idx + 1).trim();
      if (u && h && !db[u]) {
        db[u] = { passwordHash: h, updatedAt: 0 };
      }
    }
  }

  return db;
}

function ensureLoaded() {
  if (!_cacheLoaded) {
    const fromEnv = loadFromEnv();
    for (const [u, v] of Object.entries(fromEnv)) {
      _cache[u] = v;
    }
    _cacheLoaded = true;
  }
}

export function serverGetUser(username: string): ServerUserRecord | null {
  ensureLoaded();
  return _cache[username.toLowerCase()] ?? null;
}

export function serverUpsertUser(username: string, record: ServerUserRecord): void {
  ensureLoaded();
  _cache[username.toLowerCase()] = record;
}

export function serverCheckPassword(username: string, passwordHash: string): "ok" | "user_not_found" | "wrong_password" {
  ensureLoaded();
  const rec = _cache[username.toLowerCase()];
  if (!rec) return "user_not_found";
  if (rec.passwordHash !== passwordHash) return "wrong_password";
  return "ok";
}
