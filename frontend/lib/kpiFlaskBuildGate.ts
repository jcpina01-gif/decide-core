/**
 * Gate de versão do `kpi_server.py` vs o que o dashboard espera.
 * Manter alinhado com `MIN_BUILD_SUBSTRING` em `frontend/scripts/run-kpi.cjs`.
 */
/** Fragmento presente em `KPI_SERVER_BUILD_TAG` desde a correcção margem vs plafonado (v19+). */
export const KPI_FLASK_BUILD_MIN_TOKEN = "margin-csv-and-kpi-loader";

/**
 * Query `embed_src_rev` no URL do iframe — alterar quando mudares o `KPI_SERVER_BUILD_TAG` no Flask
 * e o browser mostrar HTML antigo (cache / SW). Manter em sintonia com o sufixo do build em produção.
 */
export const KPI_IFRAME_SRC_REV = "v49-v7-smooth-execution";

/**
 * Query `fees_embed_rev` em `/fees-client?embed=1` (dashboard → Custos → Simulador).
 * Bump quando mudar copy/simulador Premium para evitar iframe preso a HTML antigo — sem isto o `src`
 * pode ficar estável (`iframeRefresh` só acrescenta `t=` após «Atualizar recomendação»).
 */
export const FEES_CLIENT_EMBED_CACHE_REV = "premium-25-r6-literal-ssr";

/**
 * `NEXT_PUBLIC_KPI_FLASK_MIN_BUILD` — substring obrigatória no campo `build` de `/api/health`.
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
