/**
 * Agrega dados operacionais a partir de `tmp_diag/` e `backoffice_store.json` opcional.
 * Sem base de dados dedicada: primeiro passo para cockpit / auditoria até existir persistência formal.
 */

import fs from "fs";
import path from "path";

export type OnboardingStatus = "unknown" | "pending" | "complete";
export type MifidStatus = "unknown" | "pending" | "complete";
export type AccountStatus = "unknown" | "active" | "inactive";

export type BackofficeStoreV1 = {
  version?: number;
  clients?: Record<
    string,
    {
      displayName?: string;
      onboardingStatus?: OnboardingStatus;
      mifidStatus?: MifidStatus;
      accountStatus?: AccountStatus;
      riskProfile?: string;
      planApprovedAt?: string | null;
      lastRecommendationAt?: string | null;
      notes?: string;
    }
  >;
};

export type BackofficeClientSummary = {
  clientId: string;
  displayName: string;
  accountCode: string | null;
  onboardingStatus: OnboardingStatus;
  mifidStatus: MifidStatus;
  accountStatus: AccountStatus;
  riskProfile: string | null;
  navIbkr: number | null;
  navCurrency: string;
  lastRecommendationAt: string | null;
  tradePlanRowCount: number;
  tradePlanUpdatedAt: string | null;
  planApprovedAt: string | null;
  positionCount: number;
  dataSources: string[];
};

export type TimelineEvent = {
  id: string;
  ts: string;
  type: string;
  label: string;
  detail?: string;
};

export type RecommendationSnapshot = {
  id: string;
  generatedAt: string;
  source: string;
  modelHint?: string;
  positions: Array<{ ticker: string; weightPct?: number; side?: string; qty?: number }>;
};

export type OrderRow = {
  ticker: string;
  side?: string;
  qty?: number;
  status?: string;
  source: "trade_plan_csv" | "ibkr_status_json" | "demo";
  detail?: string;
  updatedAt?: string | null;
};

export type LogRow = {
  id: string;
  ts: string;
  level: "info" | "warn" | "error";
  source: string;
  message: string;
};

export type AlertRow = {
  id: string;
  severity: "warning" | "error" | "info";
  code: string;
  message: string;
  clientId?: string;
};

export type DriftRow = {
  clientId: string;
  windowLabel: string;
  modelReturnPct: number | null;
  accountReturnPct: number | null;
  gapPct: number | null;
  note: string;
};

export function projectRoot(): string {
  return path.resolve(process.cwd(), "..");
}

function tmpDir(root: string): string {
  return path.join(root, "tmp_diag");
}

function safeString(x: unknown, fb = ""): string {
  if (typeof x === "string") return x;
  if (typeof x === "number" && Number.isFinite(x)) return String(x);
  return fb;
}

function safeNumber(x: unknown, fb = 0): number {
  const n = typeof x === "number" ? x : Number(x);
  return Number.isFinite(n) ? n : fb;
}

function readJson<T>(filePath: string): T | null {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
  } catch {
    return null;
  }
}

function fileMtimeIso(filePath: string): string | null {
  try {
    const st = fs.statSync(filePath);
    return new Date(st.mtimeMs).toISOString();
  } catch {
    return null;
  }
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === "," && !inQuotes) {
      out.push(cur.trim());
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur.trim());
  return out;
}

function parseTradePlanCsv(filePath: string): { rows: Record<string, string>[]; headers: string[] } {
  if (!fs.existsSync(filePath)) return { rows: [], headers: [] };
  try {
    const text = fs.readFileSync(filePath, "utf8");
    const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length < 2) return { rows: [], headers: [] };
    const headers = splitCsvLine(lines[0]!).map((h) => h.trim().toLowerCase());
    const rows: Record<string, string>[] = [];
    for (let i = 1; i < lines.length; i++) {
      const cols = splitCsvLine(lines[i]!);
      const row: Record<string, string> = {};
      for (let j = 0; j < headers.length; j++) {
        row[headers[j]!] = cols[j] ?? "";
      }
      rows.push(row);
    }
    return { rows, headers };
  } catch {
    return { rows: [], headers: [] };
  }
}

function col(row: Record<string, string>, names: string[]): string {
  for (const n of names) {
    const v = row[n.toLowerCase()];
    if (v != null && String(v).trim() !== "") return String(v).trim();
  }
  return "";
}

function loadSmoke(root: string): Record<string, unknown> | null {
  const p = path.join(tmpDir(root), "ibkr_paper_smoke_test.json");
  return readJson<Record<string, unknown>>(p);
}

function netFromSmoke(smoke: Record<string, unknown> | null): {
  value: number;
  ccy: string;
  accountCode: string | null;
  positions: unknown[];
} {
  if (!smoke) return { value: 0, ccy: "EUR", accountCode: null, positions: [] };
  const sel = smoke.selected as Record<string, unknown> | undefined;
  const att0 = Array.isArray(smoke.attempts) ? (smoke.attempts as unknown[])[0] : undefined;
  const a0 = att0 as Record<string, unknown> | undefined;
  const pick = sel || a0;
  const nl = pick?.netLiquidation as Record<string, unknown> | undefined;
  const val = safeNumber(nl?.value, 0);
  const ccy = safeString(nl?.currency, "EUR").toUpperCase() || "EUR";
  const accountCode = safeString(pick?.accountCode, "").trim() || null;
  const positions = Array.isArray(pick?.positions) ? (pick!.positions as unknown[]) : [];
  return { value: val, ccy, accountCode, positions };
}

function loadStatusJson(root: string): Record<string, unknown> | null {
  const p = path.join(tmpDir(root), "ibkr_order_status_and_cancel.json");
  return readJson<Record<string, unknown>>(p);
}

function loadStore(root: string): BackofficeStoreV1 {
  const p = path.join(tmpDir(root), "backoffice_store.json");
  const j = readJson<BackofficeStoreV1>(p);
  return j && typeof j === "object" ? j : {};
}

function normalizeClientId(accountCode: string | null): string {
  const base = (accountCode || "paper-unknown").replace(/[^a-zA-Z0-9._-]+/g, "-");
  return base || "paper-unknown";
}

export function listBackofficeClients(root: string): {
  clients: BackofficeClientSummary[];
  meta: { projectRoot: string; tmpDiag: string };
} {
  const smoke = loadSmoke(root);
  const store = loadStore(root);
  const tradePlanPath = path.join(tmpDir(root), "decide_trade_plan_ibkr.csv");
  const { rows: planRows } = parseTradePlanCsv(tradePlanPath);
  const planMtime = fileMtimeIso(tradePlanPath);
  const net = netFromSmoke(smoke);

  const clients: BackofficeClientSummary[] = [];

  if (net.accountCode || net.value > 0 || planRows.length) {
    const clientId = normalizeClientId(net.accountCode);
    const st = store.clients?.[clientId] ?? store.clients?.[net.accountCode || ""] ?? {};
    clients.push({
      clientId,
      displayName: safeString(st.displayName, net.accountCode || clientId),
      accountCode: net.accountCode,
      onboardingStatus: st.onboardingStatus ?? "unknown",
      mifidStatus: st.mifidStatus ?? "unknown",
      accountStatus: st.accountStatus ?? (net.value > 0 ? "active" : "unknown"),
      riskProfile: st.riskProfile ?? null,
      navIbkr: net.value > 0 ? net.value : null,
      navCurrency: net.ccy,
      lastRecommendationAt: st.lastRecommendationAt ?? planMtime,
      tradePlanRowCount: planRows.length,
      tradePlanUpdatedAt: planMtime,
      planApprovedAt: st.planApprovedAt ?? null,
      positionCount: net.positions.length,
      dataSources: [
        smoke ? "tmp_diag/ibkr_paper_smoke_test.json" : "",
        planRows.length ? "tmp_diag/decide_trade_plan_ibkr.csv" : "",
        Object.keys(st).length ? "tmp_diag/backoffice_store.json" : "",
      ].filter(Boolean),
    });
  }

  for (const [cid, st] of Object.entries(store.clients ?? {})) {
    if (clients.some((c) => c.clientId === cid)) continue;
    clients.push({
      clientId: cid,
      displayName: safeString(st.displayName, cid),
      accountCode: null,
      onboardingStatus: st.onboardingStatus ?? "unknown",
      mifidStatus: st.mifidStatus ?? "unknown",
      accountStatus: st.accountStatus ?? "unknown",
      riskProfile: st.riskProfile ?? null,
      navIbkr: null,
      navCurrency: "EUR",
      lastRecommendationAt: st.lastRecommendationAt ?? null,
      tradePlanRowCount: 0,
      tradePlanUpdatedAt: null,
      planApprovedAt: st.planApprovedAt ?? null,
      positionCount: 0,
      dataSources: ["tmp_diag/backoffice_store.json"],
    });
  }

  return {
    clients,
    meta: { projectRoot: root, tmpDiag: tmpDir(root) },
  };
}

export function getDemoClient(): BackofficeClientSummary {
  return {
    clientId: "demo-user",
    displayName: "Cliente (demo UI)",
    accountCode: "DEMO",
    onboardingStatus: "complete",
    mifidStatus: "complete",
    accountStatus: "active",
    riskProfile: "moderado",
    navIbkr: 200_000,
    navCurrency: "EUR",
    lastRecommendationAt: new Date().toISOString(),
    tradePlanRowCount: 12,
    tradePlanUpdatedAt: new Date().toISOString(),
    planApprovedAt: null,
    positionCount: 8,
    dataSources: ["synthetic/demo"],
  };
}

export function getClientDetail(root: string, clientId: string): BackofficeClientSummary | null {
  if (clientId === "demo-user") return getDemoClient();
  const { clients } = listBackofficeClients(root);
  return clients.find((c) => c.clientId === clientId) ?? null;
}

export function buildTimeline(root: string, clientId: string): TimelineEvent[] {
  if (clientId === "demo-user") {
    const t = new Date().toISOString();
    return [
      { id: "d1", ts: t, type: "onboarding", label: "Onboarding concluído", detail: "Demonstração" },
      { id: "d2", ts: t, type: "profile", label: "Perfil moderado atribuído", detail: "" },
      { id: "d3", ts: t, type: "recommendation", label: "Recomendação gerada", detail: "Plano Modelo CAP15" },
    ];
  }
  const detail = getClientDetail(root, clientId);
  if (!detail) return [];

  const events: TimelineEvent[] = [];
  const tradePlanPath = path.join(tmpDir(root), "decide_trade_plan_ibkr.csv");
  const planMtime = fileMtimeIso(tradePlanPath);

  if (detail.onboardingStatus === "complete") {
    events.push({
      id: "onb",
      ts: planMtime || new Date().toISOString(),
      type: "onboarding",
      label: "Onboarding (estado: completo)",
      detail: "Definido em backoffice_store.json",
    });
  }
  if (detail.riskProfile) {
    events.push({
      id: "prof",
      ts: planMtime || new Date().toISOString(),
      type: "profile",
      label: `Perfil: ${detail.riskProfile}`,
      detail: "",
    });
  }
  if (detail.tradePlanRowCount > 0 && planMtime) {
    events.push({
      id: "rec",
      ts: planMtime,
      type: "recommendation",
      label: "Plano IBKR (CSV) actualizado",
      detail: `${detail.tradePlanRowCount} linhas em decide_trade_plan_ibkr.csv`,
    });
  }
  if (detail.planApprovedAt) {
    events.push({
      id: "appr",
      ts: detail.planApprovedAt,
      type: "approval",
      label: "Plano aprovado (registo interno)",
      detail: "",
    });
  }

  events.sort((a, b) => (a.ts < b.ts ? -1 : 1));
  return events;
}

export function buildRecommendations(root: string, clientId: string): RecommendationSnapshot[] {
  if (clientId === "demo-user") {
    return [
      {
        id: "demo-rec-1",
        generatedAt: new Date().toISOString(),
        source: "demo",
        modelHint: "Modelo CAP15",
        positions: [
          { ticker: "VUAA", weightPct: 12, side: "BUY" },
          { ticker: "CSPX", weightPct: 10, side: "BUY" },
        ],
      },
    ];
  }
  const tradePlanPath = path.join(tmpDir(root), "decide_trade_plan_ibkr.csv");
  const { rows } = parseTradePlanCsv(tradePlanPath);
  const mtime = fileMtimeIso(tradePlanPath);
  if (!rows.length || !mtime) return [];

  const positions = rows.map((r) => ({
    ticker: col(r, ["ticker", "symbol"]).toUpperCase(),
    weightPct: safeNumber(col(r, ["target_weight_pct", "weight_pct", "weight"]), NaN) || undefined,
    side: col(r, ["side", "action"]) || undefined,
    qty: safeNumber(col(r, ["qty", "quantity", "abs_qty"]), NaN) || undefined,
  }));

  return [
    {
      id: `trade-plan-${mtime}`,
      generatedAt: mtime,
      source: "tmp_diag/decide_trade_plan_ibkr.csv",
      modelHint: "Derivado do CSV de plano (não é snapshot imutável completo)",
      positions,
    },
  ];
}

export function buildOrders(root: string, clientId: string): OrderRow[] {
  if (clientId === "demo-user") {
    return [
      { ticker: "VUAA", side: "BUY", qty: 10, status: "filled", source: "demo", updatedAt: new Date().toISOString() },
    ];
  }
  const tradePlanPath = path.join(tmpDir(root), "decide_trade_plan_ibkr.csv");
  const { rows } = parseTradePlanCsv(tradePlanPath);
  const mtime = fileMtimeIso(tradePlanPath);
  const planned: OrderRow[] = rows.map((r, i) => ({
    ticker: col(r, ["ticker", "symbol"]).toUpperCase(),
    side: col(r, ["side", "action"]) || undefined,
    qty: safeNumber(col(r, ["qty", "quantity", "abs_qty"]), NaN) || undefined,
    status: "planned",
    source: "trade_plan_csv",
    updatedAt: mtime,
    detail: `row ${i + 1}`,
  }));

  const statusJson = loadStatusJson(root);
  const extra: OrderRow[] = [];
  if (statusJson && Array.isArray(statusJson.orders)) {
    for (const o of statusJson.orders as unknown[]) {
      const oo = o as Record<string, unknown>;
      extra.push({
        ticker: safeString(oo.ticker || oo.symbol, "—").toUpperCase(),
        side: safeString(oo.side || oo.action, ""),
        qty: safeNumber(oo.qty || oo.quantity, NaN) || undefined,
        status: safeString(oo.status || oo.order_status, "unknown"),
        source: "ibkr_status_json",
        updatedAt: safeString(oo.updated_at || oo.as_of, "") || null,
        detail: safeString(oo.message, ""),
      });
    }
  }

  return [...planned, ...extra];
}

export function buildLogs(root: string, clientId: string): LogRow[] {
  if (clientId === "demo-user") {
    return [
      {
        id: "lg1",
        ts: new Date().toISOString(),
        level: "info",
        source: "demo",
        message: "Evento de exemplo — ligar a ficheiro backoffice_events.jsonl ou API de auditoria.",
      },
    ];
  }
  const logs: LogRow[] = [];
  const eventsPath = path.join(tmpDir(root), "backoffice_events.jsonl");
  if (fs.existsSync(eventsPath)) {
    try {
      const lines = fs.readFileSync(eventsPath, "utf8").split(/\r?\n/).filter(Boolean);
      let i = 0;
      for (const line of lines.slice(-200)) {
        i++;
        try {
          const j = JSON.parse(line) as {
            ts?: string;
            clientId?: string;
            level?: string;
            source?: string;
            message?: string;
          };
          if (j.clientId && j.clientId !== clientId) continue;
          logs.push({
            id: `jsonl-${i}`,
            ts: j.ts || new Date().toISOString(),
            level: j.level === "error" || j.level === "warn" ? j.level : "info",
            source: j.source || "backoffice_events.jsonl",
            message: j.message || line.slice(0, 500),
          });
        } catch {
          /* skip line */
        }
      }
    } catch {
      /* ignore */
    }
  }
  return logs.sort((a, b) => (a.ts < b.ts ? 1 : -1));
}

export function buildActivityFeed(root: string): Array<TimelineEvent & { clientId?: string }> {
  const { clients } = listBackofficeClients(root);
  const out: Array<TimelineEvent & { clientId?: string }> = [];
  for (const c of clients) {
    for (const e of buildTimeline(root, c.clientId)) {
      out.push({ ...e, clientId: c.clientId });
    }
  }
  out.sort((a, b) => (a.ts < b.ts ? 1 : -1));
  return out.slice(0, 500);
}

export function buildAlerts(root: string): AlertRow[] {
  const alerts: AlertRow[] = [];
  const { clients } = listBackofficeClients(root);

  for (const c of clients) {
    if (c.tradePlanRowCount > 0 && !c.planApprovedAt) {
      alerts.push({
        id: `pend-appr-${c.clientId}`,
        severity: "warning",
        code: "PLAN_NOT_APPROVED",
        message: "Existe plano IBKR (CSV) sem registo de aprovação em backoffice_store.json.",
        clientId: c.clientId,
      });
    }
    if (c.navIbkr != null && c.navIbkr < 1000) {
      alerts.push({
        id: `low-nav-${c.clientId}`,
        severity: "info",
        code: "LOW_NAV",
        message: `NAV IBKR baixo (${c.navIbkr} ${c.navCurrency}) — verificar funding.`,
        clientId: c.clientId,
      });
    }
  }

  const orders = buildOrders(root, clients[0]?.clientId || "");
  const failed = orders.filter((o) => /fail|reject|error/i.test(o.status || ""));
  for (const o of failed.slice(0, 20)) {
    alerts.push({
      id: `ord-${o.ticker}-${o.status}`,
      severity: "error",
      code: "ORDER_ISSUE",
      message: `${o.ticker}: ${o.status || "?"} (${o.source})`,
      clientId: clients[0]?.clientId,
    });
  }

  if (clients.length === 0) {
    alerts.push({
      id: "no-clients",
      severity: "info",
      code: "NO_TMP_DIAG_CLIENT",
      message:
        "Sem ibkr_paper_smoke_test.json nem entradas em backoffice_store.json — cockpit vazio. Gera smoke test ou edita tmp_diag/backoffice_store.json.",
    });
  }

  return alerts;
}

export function buildDrift(root: string): DriftRow[] {
  const { clients } = listBackofficeClients(root);
  return clients.map((c) => ({
    clientId: c.clientId,
    windowLabel: "Últimos ~21 dias úteis (placeholder)",
    modelReturnPct: null,
    accountReturnPct: null,
    gapPct: null,
    note:
      "Cálculo de drift requer série histórica de NAV IB e mesma janela no modelo — não disponível só com snapshot único.",
  }));
}

export function buildAuditExport(root: string, clientId: string): Record<string, unknown> | null {
  if (clientId === "demo-user") {
    const c = getDemoClient();
    return {
      exportedAt: new Date().toISOString(),
      client: c,
      recommendations: buildRecommendations(root, clientId),
      timeline: buildTimeline(root, clientId),
      orders: buildOrders(root, clientId),
      logs: buildLogs(root, clientId),
      note: "Bundle demo — substituir por dados reais persistidos.",
    };
  }
  const c = getClientDetail(root, clientId);
  if (!c) return null;
  return {
    exportedAt: new Date().toISOString(),
    client: c,
    recommendations: buildRecommendations(root, clientId),
    timeline: buildTimeline(root, clientId),
    orders: buildOrders(root, clientId),
    logs: buildLogs(root, clientId),
  };
}
