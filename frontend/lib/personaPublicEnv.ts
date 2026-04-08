/**
 * Leitura das variáveis Persona expostas ao browser (NEXT_PUBLIC_*), definidas no build.
 * Compat: alguns dashboards usaram por engano `NEXT_PUBLIC_PERSONA_ENVIRONMENT` em vez de `..._ENVIRONMENT_ID`.
 */

/** Remove BOM e espaços invisíveis — cópias do dashboard por vezes corrompem o prefixo `itmpl_`. */
export function sanitizePersonaPublicId(raw: string): string {
  return String(raw ?? "")
    .replace(/^\uFEFF/, "")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .trim();
}

export function getResolvedPersonaEnvironmentId(): string {
  const primary = String(process.env.NEXT_PUBLIC_PERSONA_ENVIRONMENT_ID || "").trim();
  if (primary) return primary;
  return String(process.env.NEXT_PUBLIC_PERSONA_ENVIRONMENT || "").trim();
}

export function getResolvedPersonaTemplateId(): string {
  return String(process.env.NEXT_PUBLIC_PERSONA_TEMPLATE_ID || "").trim();
}

/**
 * Valor de `host` para `Persona.Client` a partir de `NEXT_PUBLIC_PERSONA_HOST`.
 *
 * No SDK 5.x, a palavra-chave `development` não significa «sandbox»: o iframe aponta para
 * `http://localhost:3000` (servidor interno da Persona). Integrações normais com `environmentId`
 * de sandbox na consola devem usar o iframe alojado (`production` = inquiry.withpersona.com).
 *
 * Mantemos compatibilidade: se alguém definiu `NEXT_PUBLIC_PERSONA_HOST=development` seguindo
 * documentação antiga ou confusão de nomes, normalizamos para `production`.
 */
export function normalizeNextPublicPersonaHostForSdk(
  raw: string,
): "development" | "staging" | "canary" | "production" | string | undefined {
  const h = raw.trim().toLowerCase();
  if (!h) return undefined;
  if (h === "development") return "production";
  if (h === "staging" || h === "canary" || h === "production") {
    return h as "staging" | "canary" | "production";
  }
  return h;
}
