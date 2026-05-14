import { getCurrentSessionUser, getCurrentSessionUserEmail } from "./clientAuth";

/**
 * Produz um `external_user_id` estável para o utilizador atual da sessão.
 * Usa o mesmo algoritmo do personaReference para garantir consistência.
 */
function simpleHash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = (h * 33) ^ s.charCodeAt(i);
  return Math.abs(h >>> 0).toString(36);
}

export function sanitizeSumsubUserId(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return "";
  const lowered = trimmed.toLowerCase();
  const compacted = lowered.replace(/\s+/g, "-");
  const safeOnly = compacted.replace(/[^a-z0-9-_]/g, "");
  if (safeOnly) return safeOnly;
  return `ref-${simpleHash(trimmed)}`;
}

export function buildSumsubExternalUserIdFromSession(): string {
  const user = sanitizeSumsubUserId(getCurrentSessionUser() || "");
  if (user) return user;
  const email = sanitizeSumsubUserId(getCurrentSessionUserEmail() || "");
  if (email) return `sumsub-${email}`;
  return "";
}
