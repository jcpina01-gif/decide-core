import { normalizeKpiEmbedBaseUrl } from "../kpiEmbedNav";

export type RiskProfileKpi = "conservador" | "moderado" | "dinamico";

function isRiskProfileKpi(s: string): s is RiskProfileKpi {
  return s === "conservador" || s === "moderado" || s === "dinamico";
}

/**
 * Base URL do serviço KPI (Flask) para pedidos **server-side** (Next API).
 * Preferir `KPI_SERVER_INTERNAL_BASE` em Docker/Render; senão `NEXT_PUBLIC_KPI_EMBED_BASE`;
 * em desenvolvimento, fallback `http://127.0.0.1:5000`.
 */
export function kpiServerBaseUrlForServer(): string {
  const raw =
    process.env.KPI_SERVER_INTERNAL_BASE ||
    process.env.NEXT_PUBLIC_KPI_EMBED_BASE ||
    "";
  const fromEnv = normalizeKpiEmbedBaseUrl(String(raw));
  if (fromEnv) return fromEnv;
  if (process.env.NODE_ENV === "development") return "http://127.0.0.1:5000";
  return "";
}

export function normalizeRiskProfileForKpi(raw: unknown): RiskProfileKpi {
  const s = String(raw ?? "moderado")
    .trim()
    .toLowerCase();
  if (isRiskProfileKpi(s)) return s;
  return "moderado";
}

export type PlafonadoKpisFromKpiServer = {
  cagrPct: number;
  sharpe: number | null;
  volAnnualPct: number | null;
  maxDrawdownPct: number | null;
};

function numOrNull(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * CAGR, Sharpe, vol anual e max DD do cartão «Modelo CAP15» (iframe / `compute_kpis`).
 * Endpoint Flask `/api/embed-plafonado-cagr`.
 */
export async function fetchPlafonadoKpisFromKpiServer(
  profile: RiskProfileKpi,
): Promise<PlafonadoKpisFromKpiServer | null> {
  const base = kpiServerBaseUrlForServer();
  if (!base) return null;
  const url = `${base.replace(/\/+$/, "")}/api/embed-plafonado-cagr?profile=${encodeURIComponent(profile)}`;
  try {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 5000);
    const r = await fetch(url, {
      signal: ac.signal,
      headers: { Accept: "application/json" },
    });
    clearTimeout(t);
    if (!r.ok) return null;
    const j = (await r.json()) as {
      ok?: boolean;
      cagr_pct?: unknown;
      sharpe?: unknown;
      vol_annual_pct?: unknown;
      max_drawdown_pct?: unknown;
    };
    if (!j || j.ok !== true) return null;
    const cagrPct = numOrNull(j.cagr_pct);
    if (cagrPct == null) return null;
    return {
      cagrPct,
      sharpe: j.sharpe === null || j.sharpe === undefined ? null : numOrNull(j.sharpe),
      volAnnualPct:
        j.vol_annual_pct === null || j.vol_annual_pct === undefined ? null : numOrNull(j.vol_annual_pct),
      maxDrawdownPct:
        j.max_drawdown_pct === null || j.max_drawdown_pct === undefined
          ? null
          : numOrNull(j.max_drawdown_pct),
    };
  } catch {
    return null;
  }
}

/**
 * Mesmo CAGR % que o cartão «Modelo CAP15» no iframe (`/?client_embed=1`):
 * endpoint Flask `/api/embed-plafonado-cagr`.
 */
export async function fetchPlafonadoCagrPctFromKpiServer(
  profile: RiskProfileKpi,
): Promise<number | null> {
  const k = await fetchPlafonadoKpisFromKpiServer(profile);
  return k ? k.cagrPct : null;
}

/**
 * Retrocompatível: mesmo CAGR que `fetchPlafonadoCagrPctFromKpiServer` (Modelo CAP15 único).
 * O endpoint `/api/embed-cap15-cagr` no Flask é alias de `/api/embed-plafonado-cagr` (mesmo CAGR).
 */
export async function fetchCap15OverlayCagrPctFromKpiServer(
  profile: RiskProfileKpi,
): Promise<number | null> {
  return fetchPlafonadoCagrPctFromKpiServer(profile);
}
