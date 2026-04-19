/**
 * Parse e totais a partir da resposta JSON de `/api/ibkr-snapshot` (proxy para o backend).
 * Usado no dashboard (Carteira / total) e na página Carteira.
 */

import {
  applyJapaneseEquityDisplayFallback,
  displayGeoZoneFromTickerAndMeta,
  meaningfulGeoTableCell,
} from "./tickerGeoFallback";

export type IbkrSnapshotPosition = {
  value?: number;
  market_value?: number;
  marketValue?: number;
  position_value?: number;
  /** Unidades detidas (IBKR `portfolio().position`). */
  qty?: number;
  position?: number;
  shares?: number;
  size?: number;
  ticker?: string;
  symbol?: string;
  name?: string;
  longName?: string;
  long_name?: string;
  company?: string;
  companyName?: string;
  description?: string;
  sector?: string;
  industry?: string;
  category?: string;
  subcategory?: string;
  country?: string;
  zone?: string;
  weight_pct?: number;
  weight?: number;
};

const TMP_DIAG_IBKR_FALLBACK_SOURCE = "tmp_diag_fallback";

export type IbkrSnapshotPayload = {
  status?: string;
  /** Devolvido pelo proxy Next em 503 quando não há ligação ao FastAPI (diagnóstico). */
  backendBase?: string;
  /** Alguns erros do proxy Next ou do FastAPI. */
  error?: string;
  detail?: unknown;
  net_liquidation?: number;
  net_liquidation_ccy?: string;
  positions?: IbkrSnapshotPosition[];
  cash_ledger?: { value?: number; currency?: string };
  /** Metadados do FastAPI ou do fallback `tmp_diag` (ver `ibkrSnapshotTmpDiagFallback.ts`). */
  meta?: {
    decide_snapshot_source?: string;
    decide_snapshot_fallback_note?: string;
    [key: string]: unknown;
  };
};

/** Resposta reconstruída a partir de `tmp_diag/` quando o proxy não alcança o FastAPI. */
export function isTmpDiagIbkrFallbackSnapshot(snap: IbkrSnapshotPayload): boolean {
  return snap.meta?.decide_snapshot_source === TMP_DIAG_IBKR_FALLBACK_SOURCE;
}

export function tmpDiagIbkrFallbackUserNote(snap: IbkrSnapshotPayload): string {
  const n = snap.meta?.decide_snapshot_fallback_note;
  return typeof n === "string" && n.trim() ? n.trim() : "";
}

/**
 * True quando o snapshot tem dados de conta utilizáveis.
 * Aceita `status: "ok"` (contrato normal) ou, em builds antigos, NAV finito sem `status`.
 */
export function isIbkrSnapshotOk(snap: IbkrSnapshotPayload, httpOk: boolean): boolean {
  if (!httpOk) return false;
  if (snap.status === "ok") return true;
  const nav = snap.net_liquidation;
  if (
    (snap.status === undefined || snap.status === null || snap.status === "") &&
    typeof nav === "number" &&
    Number.isFinite(nav)
  ) {
    return true;
  }
  return false;
}

function detailToString(d: unknown): string | null {
  if (typeof d === "string" && d.trim()) return d.trim();
  if (Array.isArray(d) && d.length > 0) {
    try {
      return JSON.stringify(d);
    } catch {
      return null;
    }
  }
  return null;
}

/** Mensagem curta para mostrar quando o património IBKR não está disponível. */
export function ibkrSnapshotUnavailableHint(
  snap: IbkrSnapshotPayload,
  httpOk: boolean,
  httpStatus: number,
): string {
  if (!httpOk) {
    if (httpStatus === 503) {
      const b = typeof snap.backendBase === "string" && snap.backendBase.trim() ? snap.backendBase.trim() : "";
      const tail = b ? ` Base configurada (proxy): ${b}.` : "";
      const proxyErr =
        typeof snap.error === "string" && snap.error.trim() ? ` ${snap.error.trim()}` : "";
      const noDetail =
        !proxyErr &&
        b &&
        !/127\.0\.0\.1|localhost/i.test(b) &&
        ` A API em produção devolveu 503 (sem JSON de erro) — o container/VM pode estar parado, em cold start falhado, ou o Cloudflare não está a alcançar a origem. Confirme em ${b}/api/health no browser.`;
      return `Não foi possível contactar o backend (IBKR).${proxyErr}${noDetail || ""} Se a API estiver OK, confirme IB Gateway ou TWS acessível a partir do servidor onde corre o FastAPI (não só no seu PC).${tail}`;
    }
    if (httpStatus === 404) {
      return "Endpoint IBKR não encontrado no backend — confirme a versão do FastAPI e a rota /api/ibkr-snapshot.";
    }
    return `Ligação ao servidor falhou (HTTP ${httpStatus}). Confirme o backend e a sessão na app.`;
  }
  const err =
    (typeof snap.error === "string" && snap.error.trim()) || detailToString(snap.detail);
  if (err) return err;
  if (snap.status && snap.status !== "ok") {
    return `Estado da conta: ${snap.status}. Confirme a ligação paper/live e permissões na IBKR.`;
  }
  return "Conta IBKR sem dados neste momento — confirme IB Gateway/TWS ligado e conta paper activa.";
}

/** Linha normalizada para tabela «Carteira actual» (IBKR). */
export type IbkrPositionDisplayRow = {
  rank: number;
  ticker: string;
  name: string;
  /** Quantidade em unidades (accões/ETF/etc.); pode ser fraccionária. */
  quantity: number | null;
  value: number;
  weightPct: number | null;
  /** Valor da linha ÷ soma dos valores das posição(s) em títulos × 100 — comparável ao sleeve investido do plano. */
  weightPctSecurities: number | null;
  sector: string | null;
  industry: string | null;
  /** US / EU / JP / CAN inferido a partir das etiquetas IB (heurística). */
  regionModel: string | null;
  country: string | null;
  zone: string | null;
};

/** Heurística para coluna «Região (modelo)» quando não há CSV DECIDE no browser. */
export function inferDecideRegionFromIbkrGeoLabels(country: string | null, zone: string | null): string | null {
  const blob = `${country || ""} ${zone || ""}`.toLowerCase();
  if (!blob.trim()) return null;
  if (/\bjap|japão|nihon|tokyo|tsej|\.t\b/.test(blob)) return "JP";
  if (/\bcanad/.test(blob)) return "CAN";
  if (/\bestados unidos|\beua\b|\bu\.s\.|\busa\b|\bamerica do norte\b/.test(blob) && !/\bm[eé]xico\b|\bcanad/.test(blob))
    return "US";
  if (
    /\beuropa\b|\bfran|alem|reino|su[ií]c|portugal|espan|italia|norue|suec|finl|b[eé]lg|autr|pol[oó]n|chec|gr[eé]c|irland|dinamar|pa[ií]ses baix|holand|luxem|island|liechtenstein/.test(
      blob,
    )
  )
    return "EU";
  return null;
}

export function ibkrPositionMarketValue(p: IbkrSnapshotPosition): number {
  const o = p as Record<string, unknown>;
  const candidates = [o.value, o.market_value, o.marketValue, o.position_value];
  for (const c of candidates) {
    const n = typeof c === "number" ? c : Number(c);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

/** Unidades detidas quando o payload as inclui (ex. `qty` do snapshot FastAPI). */
export function ibkrPositionQuantity(p: IbkrSnapshotPosition): number | null {
  const o = p as Record<string, unknown>;
  for (const k of ["qty", "position", "shares", "size"] as const) {
    const v = o[k];
    const n = typeof v === "number" ? v : Number(v);
    if (Number.isFinite(n) && Math.abs(n) > 1e-12) return n;
  }
  return null;
}

export function safeNumber(n: unknown, fallback = 0): number {
  const x = typeof n === "number" ? n : Number(n);
  return Number.isFinite(x) ? x : fallback;
}

export function formatMoneyIbkr(n: number, ccy: string): string {
  const code = ccy.length === 3 ? ccy.toUpperCase() : "EUR";
  try {
    return new Intl.NumberFormat("pt-PT", {
      style: "currency",
      currency: code,
      maximumFractionDigits: 0,
    }).format(n);
  } catch {
    return `${n.toFixed(0)} ${code}`;
  }
}

/** Quantidade de títulos para a tabela Carteira (u.). */
export function formatIbkrQuantity(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const rounded = Math.round(n);
  if (Math.abs(n - rounded) < 1e-6) return String(rounded);
  return new Intl.NumberFormat("pt-PT", { maximumFractionDigits: 6 }).format(n);
}

/** Limiar ~0 € para evitar «0 €» quando o utilizador deve ver «ainda não aplicado». */
const IBKR_MONEY_EPS = 0.005;

/** Cópia quando o snapshot indica ~0 € em títulos (conta IBKR). */
export const IBKR_NO_STOCK_POSITIONS_LABEL_PT = "Não tem posições neste momento";

/**
 * Formata moeda; devolve «—» em vez de 0 € quando o montante é ~zero
 * (ex.: nada investido em títulos ou liquidez nula — mais claro que zero).
 */
export function formatMoneyIbkrOrDash(n: number, ccy: string): string {
  if (!Number.isFinite(n) || Math.abs(n) < IBKR_MONEY_EPS) return "\u2014";
  return formatMoneyIbkr(n, ccy);
}

/**
 * Valor investido ≈ soma do valor de mercado das posições (títulos).
 * Valor não investido ≈ liquidez (residual do total ou `cash_ledger` quando só este existe).
 */
export function deriveInvestedUninvested(snap: IbkrSnapshotPayload): {
  invested: number | null;
  uninvested: number | null;
} {
  const total = safeNumber(snap.net_liquidation, NaN);
  if (!Number.isFinite(total) || total <= 0) return { invested: null, uninvested: null };

  const positions = Array.isArray(snap.positions) ? snap.positions : [];
  const sumSecurities = positions.reduce((acc, p) => acc + Math.max(0, ibkrPositionMarketValue(p)), 0);

  if (positions.length > 0) {
    const invested = Math.max(0, sumSecurities);
    const uninvested = Math.max(0, total - invested);
    return { invested, uninvested };
  }

  const cl = snap.cash_ledger;
  if (cl && typeof cl.value === "number" && Number.isFinite(cl.value)) {
    const uninvested = Math.max(0, cl.value);
    const invested = Math.max(0, total - uninvested);
    return { invested, uninvested };
  }

  return { invested: null, uninvested: null };
}

function strField(o: Record<string, unknown>, ...keys: string[]): string | null {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

/** IBKR usa «BRK B»; alinhar a BRK.B na UI (Carteira). */
function normalizeBrkTickerDisplay(ticker: string): string {
  const t = ticker.trim().toUpperCase();
  const c = t.replace(/\s+/g, "");
  if (c === "BRKB" || c === "BRK-B" || c === "BRK.B" || t === "BRK B") return "BRK.B";
  return ticker.trim();
}

/**
 * A IB pode devolver o mesmo símbolo em mais do que uma linha (ex.: rotas / contratos).
 * Somamos valor e quantidade; o peso % final vem do NAV (ver `buildIbkrPositionDisplayRows`).
 */
function mergeIbkrDisplayRowsByTicker(
  rows: Omit<IbkrPositionDisplayRow, "rank">[],
): Omit<IbkrPositionDisplayRow, "rank">[] {
  const m = new Map<string, Omit<IbkrPositionDisplayRow, "rank">>();
  for (const r of rows) {
    const key = normalizeBrkTickerDisplay(String(r.ticker || "")).toUpperCase() || "—";
    if (key === "—") {
      m.set(`${key}-${m.size}`, { ...r });
      continue;
    }
    const ex = m.get(key);
    if (!ex) {
      m.set(key, { ...r, ticker: key });
      continue;
    }
    const q1 = ex.quantity;
    const q2 = r.quantity;
    let quantity: number | null = null;
    if (q1 != null && q2 != null) quantity = q1 + q2;
    else if (q1 != null) quantity = q1;
    else if (q2 != null) quantity = q2;
    const value = ex.value + r.value;
    m.set(key, {
      ...ex,
      value,
      quantity,
      weightPct: null,
      weightPctSecurities: null,
      name: String(ex.name || "").length >= String(r.name || "").length ? ex.name : r.name,
      sector: ex.sector ?? r.sector,
      industry: ex.industry ?? r.industry,
      regionModel: ex.regionModel ?? r.regionModel,
      country: ex.country ?? r.country,
      zone: ex.zone ?? r.zone,
    });
  }
  return [...m.values()].sort((a, b) => b.value - a.value);
}

/**
 * Posições com valor > 0, ordenadas por valor decrescente.
 * Peso % (NAV) = valor da linha / património líquido × 100 quando `net_liquidation` existe
 * (alinhado ao FastAPI `ibkr_snapshot`). Não usar `weight_pct < 1 ⇒ ×100`: 0,95 significa 0,95% do NAV.
 * `% só títulos` = valor da linha / soma dos valores das posições × 100 (denominador sem caixa).
 */
export function buildIbkrPositionDisplayRows(snap: IbkrSnapshotPayload): IbkrPositionDisplayRow[] {
  const positions = Array.isArray(snap.positions) ? snap.positions : [];
  const withVal = positions.map((p) => ({ p, v: ibkrPositionMarketValue(p) })).filter((x) => x.v > IBKR_MONEY_EPS);
  const sumSec = withVal.reduce((acc, x) => acc + x.v, 0);
  const nav = safeNumber(snap.net_liquidation, 0);

  const rawRows: Omit<IbkrPositionDisplayRow, "rank">[] = withVal.map(({ p, v }) => {
    const o = p as Record<string, unknown>;
    const tickerRaw = strField(o, "ticker", "symbol") ?? "";
    const ticker = tickerRaw ? normalizeBrkTickerDisplay(tickerRaw) : "—";
    const name =
      strField(o, "name", "companyName", "company", "description") ?? (tickerRaw || "—");
    let country = strField(o, "country");
    let zone = strField(o, "zone");
    let weightPct: number | null = null;
    if (nav > IBKR_MONEY_EPS) {
      weightPct = Math.min(100, (v / nav) * 100);
    } else if (sumSec > 0) {
      weightPct = (v / sumSec) * 100;
    }
    let sector = strField(o, "sector") ?? strField(o, "category");
    const industry = strField(o, "industry") ?? strField(o, "subcategory");
    let regionModel = inferDecideRegionFromIbkrGeoLabels(country, zone);
    const jp = applyJapaneseEquityDisplayFallback(ticker, {
      country,
      zone,
      sector: sector ?? "",
      region: regionModel ?? "",
    });
    if (typeof jp.country === "string" && jp.country.trim()) country = jp.country.trim();
    if (typeof jp.zone === "string" && jp.zone.trim()) zone = jp.zone.trim();
    if (typeof jp.sector === "string" && jp.sector.trim()) sector = jp.sector.trim();
    if (typeof jp.region === "string" && jp.region.trim()) regionModel = jp.region.trim();

    const zoneTrim = (zone || "").trim();
    if (!meaningfulGeoTableCell(zoneTrim)) {
      const inferred = displayGeoZoneFromTickerAndMeta(ticker, {
        country,
        region: regionModel ?? "",
        zone: zone ?? "",
      });
      zone = inferred.trim() ? inferred : zone;
    }

    return {
      ticker,
      name,
      quantity: ibkrPositionQuantity(p),
      value: v,
      weightPct,
      weightPctSecurities: null,
      sector,
      industry,
      regionModel,
      country,
      zone,
    };
  });

  const merged = mergeIbkrDisplayRowsByTicker(rawRows);
  const grossMerged = merged.reduce((acc, r) => acc + r.value, 0);

  const withWeights =
    nav > IBKR_MONEY_EPS
      ? merged.map((r) => ({
          ...r,
          weightPct: Math.min(100, (r.value / nav) * 100),
          weightPctSecurities:
            grossMerged > IBKR_MONEY_EPS ? Math.min(100, (r.value / grossMerged) * 100) : null,
        }))
      : merged.map((r) => ({
          ...r,
          weightPct:
            r.weightPct ??
            (sumSec > 0 ? Math.min(100, (r.value / sumSec) * 100) : null),
          weightPctSecurities:
            grossMerged > IBKR_MONEY_EPS ? Math.min(100, (r.value / grossMerged) * 100) : null,
        }));

  return withWeights.map((r, i) => ({ ...r, rank: i + 1 }));
}
