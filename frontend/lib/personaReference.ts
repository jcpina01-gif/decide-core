import { getCurrentSessionUser, getCurrentSessionUserEmail } from "./clientAuth";

function simpleHash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = (h * 33) ^ s.charCodeAt(i);
  return Math.abs(h >>> 0).toString(36);
}

export function sanitizeReferenceIdPart(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return "";
  const lowered = trimmed.toLowerCase();
  const compacted = lowered.replace(/\s+/g, "-");
  const safeOnly = compacted.replace(/[^a-z0-9-_]/g, "");
  if (safeOnly) return safeOnly;
  return `ref-${simpleHash(trimmed)}`;
}

/** Mesma regra que na página Persona: userId da sessão ou email derivado. */
export function buildReferenceIdFromUserAndEmail(user: string, email: string): string {
  const id = sanitizeReferenceIdPart(user);
  if (id) return id;
  const e = sanitizeReferenceIdPart(email);
  if (e) return `persona-${e}`;
  return "";
}

export function buildPersonaReferenceIdFromSession(): string {
  return buildReferenceIdFromUserAndEmail(getCurrentSessionUser() || "", getCurrentSessionUserEmail() || "");
}
