function queryParamTruthy(raw: unknown): boolean {
  const s = String(Array.isArray(raw) ? raw[0] : raw ?? "")
    .trim()
    .toLowerCase();
  return s === "1" || s === "true" || s === "yes" || s === "sim";
}

/**
 * Query string (relatório / aprovação): ``?alvo_entrada=1``, ``entrada_hoje=1``, ``constituir=1``, ``entrada=1``.
 * Módulo sem dependências de servidor — pode usar-se no browser.
 */
export function queryIndicatesDailyEntryPlanWeights(query: Record<string, unknown>): boolean {
  return (
    queryParamTruthy(query.alvo_entrada) ||
    queryParamTruthy(query.entrada_hoje) ||
    queryParamTruthy(query.constituir) ||
    queryParamTruthy(query.entrada)
  );
}

const ENTRY_QUERY_KEYS = ["alvo_entrada", "entrada_hoje", "constituir", "entrada"] as const;

/**
 * URL do relatório Plano com ou sem o modo «último CSV / entrada no dia».
 * Preserva outros parâmetros (ex.: ``exclude=``).
 */
export function clientReportHrefFromQuery(
  query: Record<string, string | string[] | undefined>,
  mode: "monthly" | "daily_entry",
): string {
  const parts: string[] = [];
  for (const [k, raw] of Object.entries(query)) {
    if ((ENTRY_QUERY_KEYS as readonly string[]).includes(k)) continue;
    if (raw === undefined) continue;
    const vals = Array.isArray(raw) ? raw : [raw];
    for (const v of vals) {
      if (v === undefined || v === "") continue;
      parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
    }
  }
  if (mode === "daily_entry") {
    parts.push("alvo_entrada=1");
  }
  const qs = parts.join("&");
  return qs ? `/client/report?${qs}` : "/client/report";
}
