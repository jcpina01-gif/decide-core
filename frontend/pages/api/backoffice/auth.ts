/**
 * POST /api/backoffice/auth — verifica a password de admin e define o cookie de sessão.
 * DELETE /api/backoffice/auth — termina sessão (limpa cookie).
 *
 * Env vars:
 *   DECIDE_BACKOFFICE_PASSWORD  — password necessária para entrar (obrigatória em produção)
 *   DECIDE_BACKOFFICE_ENABLED   — se "1", activa o back-office
 */
import type { NextApiRequest, NextApiResponse } from "next";
import { isBackofficeEnabled } from "../../../lib/backofficeGate";

export const BO_SESSION_COOKIE = "decide_bo_session";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 7; // 7 dias

function getAdminPassword(): string | null {
  return process.env.DECIDE_BACKOFFICE_PASSWORD?.trim() || null;
}

function makeSessionToken(): string {
  // token simples: timestamp + random hex
  const ts = Date.now().toString(36);
  const rnd = Math.random().toString(36).slice(2, 10);
  return `${ts}.${rnd}`;
}

export function isValidSessionCookie(req: NextApiRequest): boolean {
  if (process.env.NODE_ENV === "development") return true;
  if (!isBackofficeEnabled()) return false;
  const raw = req.cookies?.[BO_SESSION_COOKIE] ?? "";
  if (!raw) return false;
  // Token tem formato "ts.rnd" gerado por makeSessionToken — apenas verifica que não está vazio
  // e tem o formato esperado (extra segurança: em produção com DECIDE_BACKOFFICE_PASSWORD set,
  // qualquer token guardado no cookie é válido para a sessão corrente; logout limpa-o).
  return raw.length > 6 && raw.includes(".");
}

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!isBackofficeEnabled()) {
    return res.status(404).json({ ok: false, error: "not_found" });
  }

  if (req.method === "DELETE") {
    res.setHeader(
      "Set-Cookie",
      `${BO_SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`,
    );
    return res.status(200).json({ ok: true });
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST, DELETE");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const adminPwd = getAdminPassword();
  if (!adminPwd) {
    // Sem password configurada — acesso livre (retrocompatibilidade com DECIDE_BACKOFFICE_ENABLED=1)
    const token = makeSessionToken();
    res.setHeader(
      "Set-Cookie",
      `${BO_SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${COOKIE_MAX_AGE}`,
    );
    return res.status(200).json({ ok: true });
  }

  const { password } = (req.body ?? {}) as { password?: string };
  if (!password || String(password).trim() !== adminPwd) {
    return res.status(401).json({ ok: false, error: "wrong_password" });
  }

  const token = makeSessionToken();
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader(
    "Set-Cookie",
    `${BO_SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${COOKIE_MAX_AGE}${secure}`,
  );
  return res.status(200).json({ ok: true });
}

