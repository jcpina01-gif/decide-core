/**
 * Parse e totais a partir da resposta JSON de `/api/ibkr-snapshot` (proxy para o backend).
 * Usado no dashboard (Carteira / total) e na página Carteira.
 */

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
  country?: string;
  zone?: string;
  weight_pct?: number;
  weight?: number;
};

export type IbkrSnapshotPayload = {
  status?: string;
  /** Alguns erros do proxy Next ou do FastAPI. */
  error?: string;
  detail?: unknown;
  net_liquidation?: number;
  net_liquidation_ccy?: string;
  positions?: IbkrSnapshotPosition[];
  cash_ledger?: { value?: number; currency?: string };
};

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
      return "Não foi possível contactar o backend (IBKR). Confirme BACKEND_URL / uvicorn e IB Gateway ou TWS em execução.";
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
  country: string | null;
  zone: string | null;
};

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
    let weightPct: number | null = null;
    if (nav > IBKR_MONEY_EPS) {
      weightPct = Math.min(100, (v / nav) * 100);
    } else if (sumSec > 0) {
      weightPct = (v / sumSec) * 100;
    }
    return {
      ticker,
      name,
      quantity: ibkrPositionQuantity(p),
      value: v,
      weightPct,
      weightPctSecurities: null,
      sector: strField(o, "sector", "industry"),
      country: strField(o, "country"),
      zone: strField(o, "zone"),
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
