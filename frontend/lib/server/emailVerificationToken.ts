/**
 * Token assinado (HMAC) para confirmar email sem base de dados.
 * Usar apenas em rotas API (Node).
 */
import crypto from "crypto";

export function getVerifyEmailSecret(): string | null {
  const s = process.env.VERIFY_EMAIL_SECRET;
  if (!s || String(s).length < 16) return null;
  return String(s);
}

export type EmailVerificationFlow = "account" | "signup" | "prospect";

export type ParsedEmailVerificationToken = {
  username: string | null;
  email: string;
  flow: EmailVerificationFlow;
  /** Origem do pedido (ex. dashboard), só em tokens prospect */
  prospectSource?: string;
};

/**
 * @param username Se vazio/omitido, token só confirma o email (pré-registo ou lista de contacto).
 * @param opts.prospect — lista de interessados (sem conta); gravação em ficheiro separado do pré-registo.
 */
export function createEmailVerificationToken(
  email: string,
  username?: string | null,
  opts?: { prospect?: boolean; prospectSource?: string },
): string | null {
  const secret = getVerifyEmailSecret();
  if (!secret) return null;
  const exp = Math.floor(Date.now() / 1000) + 48 * 3600;
  const u = username != null && String(username).trim() ? String(username).trim().toLowerCase() : "";
  let payload: string;
  if (u) {
    payload = JSON.stringify({ u, e: email.trim(), exp });
  } else if (opts?.prospect) {
    const o: Record<string, string | number> = { e: email.trim(), exp, t: "prospect" };
    if (opts.prospectSource) {
      const s = String(opts.prospectSource).replace(/[^a-z0-9_-]/gi, "").slice(0, 48);
      if (s) o.src = s;
    }
    payload = JSON.stringify(o);
  } else {
    payload = JSON.stringify({ e: email.trim(), exp });
  }
  const sig = crypto.createHmac("sha256", secret).update(payload).digest("base64url");
  const bundle = JSON.stringify({ p: payload, s: sig });
  return Buffer.from(bundle, "utf8").toString("base64url");
}

export function parseEmailVerificationToken(token: string): ParsedEmailVerificationToken | null {
  const secret = getVerifyEmailSecret();
  if (!secret) return null;
  try {
    const bundle = Buffer.from(token, "base64url").toString("utf8");
    const { p, s } = JSON.parse(bundle) as { p: string; s: string };
    const sig2 = crypto.createHmac("sha256", secret).update(p).digest("base64url");
    if (s !== sig2) return null;
    const data = JSON.parse(p) as { u?: string; e: string; exp: number; t?: string; src?: string };
    if (!data.e || typeof data.exp !== "number") return null;
    if (data.exp < Math.floor(Date.now() / 1000)) return null;
    const emailNorm = String(data.e).trim();
    const username =
      data.u != null && String(data.u).trim() ? String(data.u).trim().toLowerCase() : null;
    if (username) {
      return { username, email: emailNorm, flow: "account" };
    }
    if (data.t === "prospect") {
      const src = typeof data.src === "string" && data.src.trim() ? data.src.trim() : undefined;
      return { username: null, email: emailNorm, flow: "prospect", prospectSource: src };
    }
    return { username: null, email: emailNorm, flow: "signup" };
  } catch {
    return null;
  }
}
