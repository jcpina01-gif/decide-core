/**
 * Leitura das variáveis Persona expostas ao browser (NEXT_PUBLIC_*), definidas no build.
 * Compat: alguns dashboards usaram por engano `NEXT_PUBLIC_PERSONA_ENVIRONMENT` em vez de `..._ENVIRONMENT_ID`.
 */
export function getResolvedPersonaEnvironmentId(): string {
  const primary = String(process.env.NEXT_PUBLIC_PERSONA_ENVIRONMENT_ID || "").trim();
  if (primary) return primary;
  return String(process.env.NEXT_PUBLIC_PERSONA_ENVIRONMENT || "").trim();
}

export function getResolvedPersonaTemplateId(): string {
  return String(process.env.NEXT_PUBLIC_PERSONA_TEMPLATE_ID || "").trim();
}
