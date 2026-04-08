import { normalizeKpiEmbedBaseUrl } from "./kpiEmbedNav";

/** Base URL do serviço Flask KPI para páginas do back-office (SSR). */
export function resolveKpiEmbedBaseForBackoffice(): string {
  const fromEnv = normalizeKpiEmbedBaseUrl(String(process.env.NEXT_PUBLIC_KPI_EMBED_BASE || ""));
  if (fromEnv) return fromEnv;
  if (process.env.NODE_ENV === "development") return "http://127.0.0.1:5000";
  return "";
}

/** Página completa do Flask no separador Diagnóstico (rolling), vista CAP15. */
export function backofficeKpiDiagnosticsPageUrl(base: string): string {
  const b = base.replace(/\/$/, "");
  return `${b}/?cap15_only=1&tab=diagnostics`;
}
