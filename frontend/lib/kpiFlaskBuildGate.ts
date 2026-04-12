/**
 * Gate de versão do `kpi_server.py` vs o que o dashboard espera.
 * Manter alinhado com `KPI_SERVER_BUILD_TAG` em `kpi_server.py` (substring estável por release).
 */
export const KPI_FLASK_BUILD_MIN_TOKEN = "embed-diag-canon-v13";

/**
 * `NEXT_PUBLIC_KPI_FLASK_MIN_BUILD` — substring obrigatória no campo `build` de `/api/health` (ex. `embed-diag-canon-v13`).
 * Em desenvolvimento, se não estiver definida, usa-se `KPI_FLASK_BUILD_MIN_TOKEN` para evitar iframe preso a Flask antigo.
 */
export function kpiFlaskMinBuildToken(): string {
  const fromEnv = String(process.env.NEXT_PUBLIC_KPI_FLASK_MIN_BUILD ?? "").trim();
  if (fromEnv) return fromEnv;
  if (process.env.NODE_ENV === "development") return KPI_FLASK_BUILD_MIN_TOKEN;
  return "";
}

export function isKpiFlaskBuildAcceptable(build: unknown): boolean {
  const need = kpiFlaskMinBuildToken();
  if (!need) return true;
  return typeof build === "string" && build.includes(need);
}
