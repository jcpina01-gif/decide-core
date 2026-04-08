/**
 * Registo local de eventos de ordens (envio / execução / cancelamento / falhas)
 * para a página Atividade. Persistência: localStorage (este browser).
 */

import { appendCashSleeveToDetail } from "./decideCashSleeveDisplay";

export type OrderActivityKind = "envio" | "execucao" | "cancelamento" | "falha" | "info";

export type OrderActivityEntry = {
  id: string;
  ts: string;
  kind: OrderActivityKind;
  ticker: string;
  side?: string;
  qty?: number;
  filled?: number;
  avgPrice?: number | null;
  status?: string;
  detail?: string;
  source?: string;
};

const STORAGE_KEY = "decide_client_order_activity_v1";
const MAX_ENTRIES = 400;

/** Dispara na mesma aba quando o registo é actualizado (localStorage não dispara `storage` na própria aba). */
export const ORDER_ACTIVITY_CHANGED_EVENT = "decide_order_activity_changed_v1";

function makeId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function readRaw(): OrderActivityEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (x): x is OrderActivityEntry =>
        x &&
        typeof x === "object" &&
        typeof (x as OrderActivityEntry).id === "string" &&
        typeof (x as OrderActivityEntry).ts === "string" &&
        typeof (x as OrderActivityEntry).kind === "string" &&
        typeof (x as OrderActivityEntry).ticker === "string",
    );
  } catch {
    return [];
  }
}

function writeRaw(entries: OrderActivityEntry[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(0, MAX_ENTRIES)));
  } catch {
    /* quota / private mode */
  }
}

export function readOrderActivityLog(): OrderActivityEntry[] {
  return readRaw().sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0));
}

export function clearOrderActivityLog(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

export function appendOrderActivityEntries(entries: OrderActivityEntry[]): void {
  if (entries.length === 0 || typeof window === "undefined") return;
  const next = [...entries, ...readRaw()].slice(0, MAX_ENTRIES);
  writeRaw(next);
  try {
    window.dispatchEvent(new CustomEvent(ORDER_ACTIVITY_CHANGED_EVENT));
  } catch {
    /* ignore */
  }
}

type SendFillRow = {
  ticker?: string;
  action?: string;
  status?: string;
  requested_qty?: number;
  filled?: number;
  avg_fill_price?: number | null;
  message?: string;
};

function applyCashSleeveHints(entries: OrderActivityEntry[]): void {
  for (const e of entries) {
    if (e.ticker !== "—") e.detail = appendCashSleeveToDetail(e.ticker, e.detail || "");
  }
}

function eventsFromFill(f: SendFillRow, ts: string, source: string): OrderActivityEntry[] {
  const out: OrderActivityEntry[] = [];
  const ticker = String(f.ticker || "—").trim() || "—";
  const side = String(f.action || "").trim();
  const req = Number(f.requested_qty ?? 0);
  const filled = Number(f.filled ?? 0);
  const stRaw = String(f.status || "").trim();
  const st = stRaw.toLowerCase();
  const msg = typeof f.message === "string" && f.message.trim() ? f.message.trim() : undefined;

  const isSkip =
    st.startsWith("skip_") ||
    st === "contract_not_qualified" ||
    st === "skip_zero" ||
    st === "fx_contract_not_qualified";

  if (isSkip) {
    out.push({
      id: makeId(),
      ts,
      kind: "falha",
      ticker,
      side: side || undefined,
      qty: Number.isFinite(req) ? req : undefined,
      status: stRaw || undefined,
      detail: msg || `Não enviado ou rejeitado no envio — estado: ${stRaw || "—"}`,
      source,
    });
    for (const e of out) {
      if (e.ticker !== "—") e.detail = appendCashSleeveToDetail(e.ticker, e.detail || "");
    }
    return out;
  }

  if (st.includes("inactive") && filled <= 0) {
    out.push({
      id: makeId(),
      ts,
      kind: "envio",
      ticker,
      side: side || undefined,
      qty: Number.isFinite(req) ? req : undefined,
      status: stRaw || undefined,
      detail: msg || "Linha devolvida pela corretora após tentativa de submissão.",
      source,
    });
    out.push({
      id: makeId(),
      ts,
      kind: "falha",
      ticker,
      side: side || undefined,
      qty: Number.isFinite(req) ? req : undefined,
      status: stRaw || undefined,
      detail:
        "Inactive sem preenchimento — comum na conta paper (liquidez, horário, permissões US/ETF). Consulte a linha da ordem na TWS.",
      source,
    });
    applyCashSleeveHints(out);
    return out;
  }

  out.push({
    id: makeId(),
    ts,
    kind: "envio",
    ticker,
    side: side || undefined,
    qty: Number.isFinite(req) ? req : undefined,
    status: stRaw || undefined,
    detail: msg || `Resposta da corretora: ${stRaw || "—"}`,
    source,
  });

  /** Quantidade efectiva para linha «Execução»: IB por vezes devolve Filled com filled=0 no JSON. */
  let execQty = filled;
  if (execQty <= 0 && req > 0 && (st.includes("filled") || st === "filled")) {
    execQty = req;
  }
  if (req > 0 && filled + 1e-6 >= req) {
    execQty = Math.max(execQty, req);
  }

  if (execQty > 0) {
    const ap = f.avg_fill_price;
    out.push({
      id: makeId(),
      ts,
      kind: "execucao",
      ticker,
      side: side || undefined,
      qty: Number.isFinite(req) ? req : undefined,
      filled: execQty,
      avgPrice: typeof ap === "number" && Number.isFinite(ap) ? ap : ap == null ? null : Number(ap),
      status: stRaw || undefined,
      detail:
        req > 0 && execQty + 1e-6 >= req
          ? "Execução completa (quantidade preenchida)"
          : `Execução parcial — ${execQty} de ${req > 0 ? req : "?"} unidades`,
      source,
    });
  }

  if (st.includes("cancel")) {
    out.push({
      id: makeId(),
      ts,
      kind: "cancelamento",
      ticker,
      side: side || undefined,
      qty: Number.isFinite(req) ? req : undefined,
      filled: filled > 0 ? filled : undefined,
      status: stRaw || undefined,
      detail: msg || "Cancelamento registado na resposta da corretora (IBKR)",
      source,
    });
  }

  applyCashSleeveHints(out);
  return out;
}

/**
 * Regista um lote devolvido por POST /api/send-orders (proxy Next → FastAPI).
 */
export function recordSendOrdersResponse(
  payload: { fills?: unknown[]; status?: string; error?: string } | null,
  opts: { source?: string; batchError?: string } = {},
): void {
  const ts = new Date().toISOString();
  const source = opts.source ?? "Plano — DECISÃO FINAL";
  const entries: OrderActivityEntry[] = [];

  if (opts.batchError && (!payload || !Array.isArray(payload.fills) || payload.fills.length === 0)) {
    entries.push({
      id: makeId(),
      ts,
      kind: "falha",
      ticker: "—",
      detail: opts.batchError,
      source,
    });
    appendOrderActivityEntries(entries);
    return;
  }

  if (!payload || !Array.isArray(payload.fills)) {
    if (opts.batchError) {
      entries.push({
        id: makeId(),
        ts,
        kind: "falha",
        ticker: "—",
        detail: opts.batchError,
        source,
      });
      appendOrderActivityEntries(entries);
    }
    return;
  }

  if (payload.status && payload.status !== "ok") {
    entries.push({
      id: makeId(),
      ts,
      kind: "falha",
      ticker: "—",
      detail:
        typeof payload.error === "string" && payload.error
          ? `Lote rejeitado: ${payload.error}`
          : `Lote rejeitado (status ${payload.status})`,
      source,
    });
  }

  for (const row of payload.fills) {
    if (!row || typeof row !== "object") continue;
    entries.push(...eventsFromFill(row as SendFillRow, ts, source));
  }

  appendOrderActivityEntries(entries);
}

/** Utilizador cancelou o pedido HTTP em curso (abort). */
export function recordUserAbortedSendOrders(): void {
  const ts = new Date().toISOString();
  appendOrderActivityEntries([
    {
      id: makeId(),
      ts,
      kind: "cancelamento",
      ticker: "—",
      detail: "Cancelou o envio em curso (pedido interrompido antes da resposta da corretora).",
      source: "Plano — DECISÃO FINAL",
    },
  ]);
}

export type CancelOpenOrderActivityRow = {
  ticker?: string;
  action?: string;
  result?: string;
  status_before?: string;
  status_after?: string;
  message?: string;
  still_open?: boolean | null;
  requested_qty?: number;
};

/**
 * Regista o resultado de POST /api/cancel-open-orders-paper (cancelamento global / inventário IB).
 */
export function recordCancelOpenOrdersPaperResponse(
  rows: CancelOpenOrderActivityRow[],
  opts: { source?: string; error?: string } = {},
): void {
  const ts = new Date().toISOString();
  const source = opts.source ?? "Plano — cancelar ordens em aberto (paper)";

  if (opts.error) {
    appendOrderActivityEntries([
      {
        id: makeId(),
        ts,
        kind: "falha",
        ticker: "—",
        detail: `Cancelamento de ordens em aberto falhou: ${opts.error}`,
        source,
      },
    ]);
    return;
  }

  const entries: OrderActivityEntry[] = [];

  if (!rows.length) {
    entries.push({
      id: makeId(),
      ts,
      kind: "info",
      ticker: "—",
      detail:
        "Cancelamento paper: a corretora não reportou ordens abertas no momento do pedido (reqGlobalCancel não tinha alvo na listagem).",
      source,
    });
    appendOrderActivityEntries(entries);
    return;
  }

  for (const r of rows) {
    const ticker = String(r.ticker || "—").trim() || "—";
    const side = String(r.action || "").trim();
    const result = String(r.result || "");
    const before = String(r.status_before || "").trim();
    const after = String(r.status_after || "").trim();
    const reqQ = Number(r.requested_qty ?? NaN);
    const qty = Number.isFinite(reqQ) && reqQ > 0 ? Math.floor(reqQ) : undefined;

    let detail: string;
    if (result === "error") {
      detail =
        typeof r.message === "string" && r.message.trim()
          ? r.message.trim()
          : "Erro reportado ao cancelar esta linha.";
    } else if (result === "global_cancel_sent") {
      detail = `reqGlobalCancel (paper) — estado: ${before || "—"} → ${after || "—"}`;
      if (r.still_open === true) {
        detail += " · ainda listada como aberta após re-check (~3s)";
      }
    } else {
      detail = [result || "cancelamento", before && `antes: ${before}`, after && `depois: ${after}`]
        .filter(Boolean)
        .join(" · ");
    }

    entries.push({
      id: makeId(),
      ts,
      kind: result === "error" ? "falha" : "cancelamento",
      ticker,
      side: side || undefined,
      qty,
      status: after || before || undefined,
      detail,
      source,
    });
  }

  appendOrderActivityEntries(entries);
}

/**
 * Após «Actualizar estado (IBKR)» no Plano: regista linhas de execução para a página Atividade
 * (não duplica linhas de envio — só execução / estado sincronizado).
 */
export function recordExecutionSnapshotFromSyncedFills(
  fills: SendFillRow[],
  source = "Plano — actualizar estado (IBKR)",
): void {
  if (!fills.length) return;
  const ts = new Date().toISOString();
  const entries: OrderActivityEntry[] = [];

  for (const f of fills) {
    if (!f || typeof f !== "object") continue;
    const ticker = String(f.ticker || "—").trim() || "—";
    const side = String(f.action || "").trim();
    const req = Number(f.requested_qty ?? 0);
    const filled = Number(f.filled ?? 0);
    const stRaw = String(f.status || "").trim();
    const st = stRaw.toLowerCase();
    const isSkip =
      st.startsWith("skip_") ||
      st === "contract_not_qualified" ||
      st === "skip_zero" ||
      st === "fx_contract_not_qualified";
    if (isSkip) continue;

    let execQty = filled;
    if (execQty <= 0 && req > 0 && (st.includes("filled") || st === "filled")) {
      execQty = req;
    }
    if (req > 0 && filled + 1e-6 >= req) {
      execQty = Math.max(execQty, req);
    }
    if (execQty <= 0) continue;

    const ap = f.avg_fill_price;
    entries.push({
      id: makeId(),
      ts,
      kind: "execucao",
      ticker,
      side: side || undefined,
      qty: Number.isFinite(req) ? req : undefined,
      filled: execQty,
      avgPrice: typeof ap === "number" && Number.isFinite(ap) ? ap : ap == null ? null : Number(ap),
      status: stRaw || undefined,
      detail: appendCashSleeveToDetail(ticker, "Sincronizado com a IBKR (página Plano)."),
      source,
    });
  }

  if (entries.length) appendOrderActivityEntries(entries);
}
