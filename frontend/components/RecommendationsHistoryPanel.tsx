import type { ReactNode } from "react";
import React, { useEffect, useMemo, useState } from "react";
import { formatPtDate } from "../lib/clientPortfolioSchedule";
import { DECIDE_APP_FONT_FAMILY } from "../lib/decideClientTheme";
import { collapseHistMonthsToLatestPerCalendarMonth } from "../lib/recommendationsHistoryMonthCollapse";
import { yahooFinanceQuoteHref } from "../lib/yahooFinanceQuoteUrl";

function formatMonthHeadingPt(ymd: string): string {
  const raw = String(ymd || "").slice(0, 10);
  const d = new Date(`${raw}T12:00:00`);
  if (Number.isNaN(d.getTime())) return raw;
  try {
    const s = d.toLocaleDateString("pt-PT", { month: "long", year: "numeric" });
    return s.charAt(0).toUpperCase() + s.slice(1);
  } catch {
    return raw;
  }
}

type FlowRow = {
  ticker: string;
  company?: string;
  weightPct?: number;
  prevWeightPct?: number;
  deltaWeightPct?: number;
  kind?: "new" | "increase" | "decrease" | "remove" | "cash_synthetic";
};

type PriorMonthBar = {
  month: string;
  label: string;
  retPct: number | null;
};

type HistRow = {
  ticker: string;
  weight: number;
  weightPct: number;
  company?: string;
  score?: number;
  sector?: string;
  rank?: number;
};

type HistMonth = {
  date: string;
  rows: HistRow[];
  turnover?: number;
  grossExposurePct?: number;
  tbillsTotalPct?: number;
  equitySleeveTotalPct?: number;
  entries?: FlowRow[];
  exits?: FlowRow[];
  diffOverlapEquityTickerCount?: number;
  prevRebalanceYmdForDiff?: string;
  priorThreeMonthReturns?: PriorMonthBar[];
  equityChartSource?: string;
  chronologicalIndex?: number;
};

function formatCompanyLine(r: FlowRow): string {
  const c = (r.company || "").trim();
  if (c && c !== r.ticker) return `${r.ticker} — ${c}`;
  return r.ticker;
}

function isNovoNomeEntrada(e: FlowRow): boolean {
  return e.kind === "new" || (e.kind == null && e.ticker.trim().toUpperCase() !== "TBILL_PROXY");
}
function isReforcoEntrada(e: FlowRow): boolean {
  return e.kind === "increase";
}
function isSaidaTudoDoAlvo(e: FlowRow): boolean {
  return e.kind === "remove" || (e.kind == null && e.ticker.trim().toUpperCase() !== "TBILL_PROXY");
}
function isReduçãoPesoSaida(e: FlowRow): boolean {
  return e.kind === "decrease";
}

function isCashSleeveTicker(ticker: string): boolean {
  const t = ticker.trim().toUpperCase();
  return t === "TBILL_PROXY" || t === "BIL" || t === "SHV";
}

/** Só a caixa de **entradas**: títulos com |peso| abaixo disto (exc. liquidez) ficam fora. Saídas listam-se todas. */
const ENTRY_SIDE_LIST_MIN_ABS_PCT = 1;
/** Mínimo |Δ| p.p. para reforço/redução; alinhado com `OFFICIAL_HISTORY_REBALANCE_FLOW_MIN_ABS_PP` no build do histórico. */
const REBALANCE_REWEIGHT_MIN_PP = 0.5;
/** Altera ao mudar a UI do histórico: se o ecrã não mostrar isto, o browser está a outro build/host. */
const HISTORY_UI_BUILD = "4col-Δ0p5-2026-04-25";

function flowLiEntradaNovo(r: FlowRow, moDate: string): ReactNode {
  const w = r.weightPct;
  const wStr = w != null && Number.isFinite(w) ? ` → ${w.toFixed(2)}%` : "";
  const t = (r.ticker || "").trim().toUpperCase();
  const isSyn = r.kind === "cash_synthetic" || t === "TBILL_PROXY";
  const isNovo = r.kind === "new" || (r.kind == null && t !== "TBILL_PROXY" && !isSyn);
  const key = `e-n-${moDate}-${r.ticker}-${r.kind ?? "x"}`;
  return (
    <li
      key={key}
      style={isCashSleeveTicker(r.ticker) ? { color: "#fafafa", fontWeight: 800 } : undefined}
    >
      <strong>{formatCompanyLine(r)}</strong>
      {wStr}
      {isNovo ? " · Novo" : null}
      {isSyn && !isCashSleeveTicker(r.ticker) ? " · (ajuste agregado T-Bills)" : null}
      {isCashSleeveTicker(r.ticker) ? " · Liquidez" : null}
    </li>
  );
}

function flowLiReforco(r: FlowRow, moDate: string): ReactNode {
  if (r.deltaWeightPct == null || r.prevWeightPct == null) return null;
  const key = `e-r-${moDate}-${r.ticker}`;
  return (
    <li
      key={key}
      style={isCashSleeveTicker(r.ticker) ? { color: "#fafafa", fontWeight: 800 } : undefined}
    >
      <strong>{formatCompanyLine(r)}</strong>
      {` · +${r.deltaWeightPct.toFixed(2)} p.p. (era ${r.prevWeightPct.toFixed(2)}% → ${(r.weightPct ?? 0).toFixed(2)}%)`}
      {isCashSleeveTicker(r.ticker) ? " · Liquidez" : null}
    </li>
  );
}

function flowLiSaidaFimAlvo(r: FlowRow, moDate: string): ReactNode {
  const w = r.weightPct;
  const t = (r.ticker || "").trim().toUpperCase();
  const isSyn = r.kind === "cash_synthetic" || t === "TBILL_PROXY";
  const wStr = w != null && Number.isFinite(w) ? ` (era ${w.toFixed(2)}%)` : "";
  const key = `x-f-${moDate}-${r.ticker}-${r.kind ?? "x"}`;
  return (
    <li
      key={key}
      style={isCashSleeveTicker(r.ticker) ? { color: "#fafafa", fontWeight: 800 } : undefined}
    >
      <strong>{formatCompanyLine(r)}</strong>
      {wStr}
      {isSyn && !isCashSleeveTicker(r.ticker) ? " (ajuste agregado T-Bills)" : null}
      {isCashSleeveTicker(r.ticker) ? " · Liquidez" : null}
    </li>
  );
}

function flowLiSaidaReducao(r: FlowRow, moDate: string): ReactNode {
  if (r.deltaWeightPct == null || r.prevWeightPct == null) return null;
  const key = `x-d-${moDate}-${r.ticker}`;
  return (
    <li
      key={key}
      style={isCashSleeveTicker(r.ticker) ? { color: "#fafafa", fontWeight: 800 } : undefined}
    >
      <strong>{formatCompanyLine(r)}</strong>
      {` · ${r.deltaWeightPct.toFixed(2)} p.p. (era ${r.prevWeightPct.toFixed(2)}% → ${(r.weightPct ?? 0).toFixed(2)}%) — continua`}
      {isCashSleeveTicker(r.ticker) ? " · Liquidez" : null}
    </li>
  );
}

/** Peso alvo (%) alinhado à tabela do mês — a lista `entries` do API pode trazer resíduos &lt;1% que não batem com o alvo. */
function resolveEntradaPesoFromMonthTable(ticker: string, flow: FlowRow, rowByTicker: Map<string, HistRow>): number {
  const k = ticker.trim().toUpperCase();
  const hr = rowByTicker.get(k);
  if (hr) {
    if (typeof hr.weightPct === "number" && Number.isFinite(hr.weightPct)) {
      return Math.abs(hr.weightPct);
    }
    if (typeof hr.weight === "number" && Number.isFinite(hr.weight)) {
      return Math.abs(hr.weight) * 100;
    }
  }
  if (typeof flow.weightPct === "number" && Number.isFinite(flow.weightPct)) {
    return Math.abs(flow.weightPct);
  }
  return 0;
}

function buildRowMap(rows: HistRow[]): Map<string, HistRow> {
  const m = new Map<string, HistRow>();
  for (const r of rows) {
    m.set(r.ticker.trim().toUpperCase(), r);
  }
  return m;
}

/**
 * Entradas com |peso| ≥ 1%: filtro e texto «→ X%» com base na grelha `mo.rows` (mesma que em baixo), não só no
 * `weightPct` bruto de `entries[]`.
 */
function filterEntradasMin1UsingMonthTable(
  entAll: FlowRow[],
  mo: HistMonth,
): { shown: FlowRow[]; omitted: number } {
  if (entAll.length === 0) return { shown: [], omitted: 0 };
  const rowByTicker = buildRowMap(mo.rows);
  const enriched: FlowRow[] = entAll.map((e) => {
    const w = resolveEntradaPesoFromMonthTable(e.ticker, e, rowByTicker);
    return { ...e, weightPct: w };
  });
  const pass = enriched.filter((r) => {
    if (r.kind === "cash_synthetic") return true;
    if (isCashSleeveTicker(r.ticker)) return true;
    if (
      r.kind === "increase" &&
      typeof r.deltaWeightPct === "number" &&
      Number.isFinite(r.deltaWeightPct) &&
      Math.abs(r.deltaWeightPct) >= REBALANCE_REWEIGHT_MIN_PP - 1e-9
    ) {
      return true;
    }
    const w = typeof r.weightPct === "number" && Number.isFinite(r.weightPct) ? r.weightPct : 0;
    return w >= ENTRY_SIDE_LIST_MIN_ABS_PCT - 1e-9;
  });
  const sortKey = (r: FlowRow) => {
    if (r.kind === "increase" && typeof r.deltaWeightPct === "number") {
      return Math.max(r.weightPct ?? 0, r.deltaWeightPct);
    }
    return r.weightPct ?? 0;
  };
  pass.sort((a, b) => sortKey(b) - sortKey(a));
  return { shown: pass, omitted: entAll.length - pass.length };
}

/** Mini-gráfico: retorno mensal do modelo (%) nos 3 meses civis antes do mês do rebalance. */
function PriorThreeMonthChart({ bars }: { bars: PriorMonthBar[] }) {
  const w = 300;
  const h = 100;
  const padL = 36;
  const padR = 8;
  const padT = 10;
  const padB = 22;
  const innerW = w - padL - padR;
  const innerH = h - padT - padB;
  const n = bars.length;
  const gap = 6;
  const bw = n > 0 ? (innerW - gap * (n - 1)) / n : 0;

  const vals = bars.map((b) => (b.retPct != null && isFinite(b.retPct) ? b.retPct : 0));
  const maxAbs = Math.max(1, ...vals.map((v) => Math.abs(v)), 0.01);
  const midY = padT + innerH / 2;

  return (
    <div style={{ marginTop: 10, marginBottom: 6 }}>
      <div style={{ fontSize: 12, color: "#a1a1aa", fontWeight: 700, marginBottom: 4 }}>
        Retorno do modelo nos três meses anteriores a cada ajuste (indicativo)
        <span style={{ fontWeight: 600, color: "#52525b" }}> · Mais recente à esquerda</span>
      </div>
      <svg width={w} height={h} style={{ display: "block", maxWidth: "100%" }} aria-hidden>
        <line
          x1={padL}
          x2={w - padR}
          y1={midY}
          y2={midY}
          stroke="rgba(148,163,184,0.35)"
          strokeWidth={1}
        />
        {bars.map((b, i) => {
          const v = b.retPct != null && isFinite(b.retPct) ? b.retPct : 0;
          const hBar = (Math.abs(v) / maxAbs) * (innerH / 2 - 2);
          const x = padL + i * (bw + gap);
          const pos = v >= 0;
          const y = pos ? midY - hBar : midY;
          const fill = v >= 0 ? "#52525b" : "#a1a1aa";
          const empty = b.retPct == null || !isFinite(b.retPct);
          return (
            <g key={b.month}>
              <rect
                x={x}
                y={empty ? midY - 1 : y}
                width={bw}
                height={empty ? 2 : Math.max(hBar, 2)}
                rx={3}
                fill={empty ? "#52525b" : fill}
                opacity={empty ? 0.5 : 1}
              />
              <text
                x={x + bw / 2}
                y={h - 4}
                textAnchor="middle"
                fill="#a1a1aa"
                fontSize={11}
                fontFamily={DECIDE_APP_FONT_FAMILY}
              >
                {b.label}
              </text>
              <text
                x={x + bw / 2}
                y={pos ? y - 4 : y + hBar + 11}
                textAnchor="middle"
                fill={empty ? "#71717a" : "#e2e8f0"}
                fontSize={11}
                fontWeight={700}
                fontFamily={DECIDE_APP_FONT_FAMILY}
              >
                {empty ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

type HistResponse = {
  ok?: boolean;
  error?: string;
  sourcePath?: string;
  /** Ficheiros de pesos agregados (união de meses). */
  sourceFiles?: string[];
  nMonths?: number;
  months?: HistMonth[];
};

function isLocalNextHost(host: string | null): boolean {
  if (!host) return false;
  return host.startsWith("127.0.0.1") || host.startsWith("localhost");
}

export default function RecommendationsHistoryPanel() {
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [data, setData] = useState<HistResponse | null>(null);
  const [filter, setFilter] = useState("");
  const [clientHost, setClientHost] = useState<string | null>(null);

  useEffect(() => {
    setClientHost(typeof window !== "undefined" ? window.location.host : null);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setErr("");
      try {
        const r = await fetch("/api/client/recommendations-history", { cache: "no-store" });
        const j = (await r.json()) as HistResponse;
        if (cancelled) return;
        if (!r.ok || j.ok === false) {
          setErr(j.error || `Erro HTTP ${r.status}`);
          setData(null);
        } else {
          setData(j);
        }
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : "Falha de rede");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const monthsCollapsed = useMemo(
    () => collapseHistMonthsToLatestPerCalendarMonth(data?.months ?? []),
    [data?.months],
  );

  const monthsFiltered = useMemo(() => {
    const m = monthsCollapsed;
    const q = filter.trim().toLowerCase();
    if (!q) return m;
    return m.filter(
      (mo) =>
        mo.date.includes(q) ||
        mo.rows.some(
          (r) =>
            r.ticker.toLowerCase().includes(q) ||
            (r.company && r.company.toLowerCase().includes(q)) ||
            (r.sector && r.sector.toLowerCase().includes(q)),
        ),
    );
  }, [monthsCollapsed, filter]);

  if (loading) {
    return (
      <div style={{ padding: 24, color: "#a1a1aa", fontSize: 16 }}>
        A carregar o histórico da carteira…
      </div>
    );
  }

  if (err) {
    return (
      <div
        style={{
          marginTop: 10,
          padding: 16,
          borderRadius: 14,
          background: "rgba(127,29,29,0.35)",
          border: "1px solid rgba(248,113,113,0.45)",
          color: "#fecaca",
          fontSize: 15,
          lineHeight: 1.5,
        }}
      >
        <strong>Não foi possível carregar o histórico.</strong> {err}
        <div style={{ marginTop: 10, fontSize: 14, color: "#fcd34d" }}>
          Confirme que o servidor DECIDE está a correr e que os dados de carteira estão disponíveis. Se o problema
          persistir, contacte o suporte.
        </div>
      </div>
    );
  }

  if (!data?.months?.length) {
    return (
      <div style={{ padding: 20, color: "#a1a1aa", fontSize: 15 }}>Sem dados de histórico no servidor.</div>
    );
  }

  return (
    <div
      style={{
        marginTop: 10,
        background: "linear-gradient(180deg, rgba(39,39,42,0.98) 0%, rgba(24,24,27,0.98) 100%)",
        border: "1px solid rgba(63,63,70,0.75)",
        borderRadius: 16,
        padding: "12px 14px 16px",
      }}
    >
      {clientHost && !isLocalNextHost(clientHost) ? (
        <div
          style={{
            fontSize: 13,
            lineHeight: 1.5,
            color: "#fef3c7",
            background: "rgba(120, 53, 15, 0.45)",
            border: "1px solid rgba(245, 158, 11, 0.55)",
            borderRadius: 10,
            padding: "10px 12px",
            marginBottom: 12,
          }}
        >
          <strong>Host actual:</strong> {clientHost} — a vista antiga (duas caixas) costuma vir de um{" "}
          <strong>deploy ainda sem as últimas alterações</strong> do repositório. O código com{" "}
          <strong>4 colunas e reforço/redução (Δ ≥ 0,5 p.p.)</strong> corre em{" "}
          <code style={{ color: "#fbbf24" }}>http://127.0.0.1:4701</code> com <code style={{ color: "#fbbf24" }}>npm run dev</code>{" "}
          no <code style={{ color: "#fbbf24" }}>frontend/</code> e, no painel Flask,{" "}
          <code style={{ color: "#fbbf24" }}>FRONTEND_URL=http://127.0.0.1:4701</code>.
        </div>
      ) : clientHost && isLocalNextHost(clientHost) ? (
        <div style={{ fontSize: 12, color: "#22c55e", marginBottom: 8 }}>Next local · {clientHost} · 4 colunas ativas</div>
      ) : null}
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 18, fontWeight: 900, color: "#f4f4f5" }}>Histórico de decisões da carteira</div>
        <div
          style={{ fontSize: 11, color: "#3f3f46", fontFamily: "ui-monospace, Consolas, monospace", marginTop: 4 }}
          title="Se não vires esta linha, o painel ainda aponta para outro build ou cache antigo (Ctrl+F5 no iframe)."
        >
          {HISTORY_UI_BUILD} · Novos e reforços (entradas) + saídas e reduções (4 colunas)
        </div>
        <div style={{ fontSize: 14, color: "#a1a1aa", marginTop: 6, lineHeight: 1.5, maxWidth: 560 }}>
          Evolução mensal da composição da sua carteira ao longo do tempo.
        </div>
        <div style={{ fontSize: 13, color: "#71717a", marginTop: 8, lineHeight: 1.45, maxWidth: 560 }}>
          A carteira é ajustada periodicamente para refletir as melhores oportunidades identificadas pelo modelo.{" "}
          <span style={{ color: "#52525b" }}>
            Por mês civil mostra-se só a data mais tardia desse mês no CSV (ex.: 27 fev em vez de 4 fev). Só entram
            meses até ao mês civil actual (UTC); meses futuros não são listados.
          </span>
        </div>
        <input
          type="search"
          placeholder="Filtrar por data, empresa ou ticker…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          style={{
            marginTop: 10,
            width: "100%",
            maxWidth: 420,
            boxSizing: "border-box",
            background: "rgba(9,9,11,0.75)",
            border: "1px solid rgba(63,63,70,0.85)",
            borderRadius: 12,
            padding: "11px 13px",
            color: "#e4e4e7",
            fontSize: 15,
          }}
        />
      </div>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 10,
          marginTop: 4,
          borderLeft: "3px solid rgba(113,113,122,0.65)",
          paddingLeft: 12,
        }}
      >
        {monthsFiltered.length === 0 ? (
          <div style={{ color: "#a1a1aa", fontSize: 15 }}>Nenhum mês corresponde ao filtro.</div>
        ) : (
          monthsFiltered.map((mo, idx) => {
            const sumW = mo.rows.reduce((s, r) => s + r.weight, 0);
            const hasFlow = mo.entries !== undefined && mo.exits !== undefined;
            const entAll = mo.entries ?? [];
            const exAll = mo.exits ?? [];
            const nEntNovoNome = entAll.filter(isNovoNomeEntrada).length;
            const nEntReforco = entAll.filter(isReforcoEntrada).length;
            const nExSaiuAlvo = exAll.filter(isSaidaTudoDoAlvo).length;
            const nExReduPeso = exAll.filter(isReduçãoPesoSaida).length;
            const { shown: ent, omitted: entOmitted } = filterEntradasMin1UsingMonthTable(entAll, mo);
            const ex = exAll;
            const chrono = mo.chronologicalIndex;
            const chartTooEarly = chrono != null && chrono < 2;
            const monthHeading = formatMonthHeadingPt(mo.date);
            const stripeBg = idx % 2 === 0 ? "rgba(39,39,42,0.72)" : "rgba(63,63,70,0.38)";
            const sleeveLine =
              typeof mo.tbillsTotalPct === "number" && isFinite(mo.tbillsTotalPct) ? (
                <span style={{ color: "#d4d4d8", fontWeight: 700 }}>
                  Liquidez {mo.tbillsTotalPct.toFixed(1)}%
                  {typeof mo.equitySleeveTotalPct === "number" && isFinite(mo.equitySleeveTotalPct)
                    ? ` · Acções ${mo.equitySleeveTotalPct.toFixed(1)}%`
                    : ""}
                </span>
              ) : null;
            return (
              <details
                key={mo.date}
                style={{
                  borderRadius: 12,
                  background: stripeBg,
                  border: "1px solid rgba(82,82,91,0.65)",
                }}
              >
                <summary
                  style={{
                    padding: "12px 14px",
                    cursor: "pointer",
                    listStyle: "none",
                  }}
                >
                  <div style={{ fontSize: 14, fontWeight: 800, color: "#a1a1aa", marginBottom: 4, letterSpacing: "0.02em" }}>
                    {monthHeading}
                  </div>
                  <div style={{ fontSize: 17, fontWeight: 800, color: "#e4e4e7", lineHeight: 1.35 }}>
                    {formatPtDate(mo.date)}
                    {sleeveLine ? (
                      <>
                        {" "}
                        — {sleeveLine}
                      </>
                    ) : null}
                  </div>
                  <div style={{ fontSize: 14, color: "#71717a", fontWeight: 600, marginTop: 6 }}>
                    Carteira total: {(sumW * 100).toFixed(1)}% · {mo.rows.length} posições
                    {hasFlow ? (
                      <span style={{ color: "#71717a" }}>
                        {" "}
                        · Diff: {entAll.length} em entradas ({nEntNovoNome} nome{nEntNovoNome === 1 ? "" : "s"} novos
                        {nEntReforco > 0
                          ? `, ${nEntReforco} reforço${nEntReforco === 1 ? "" : "s"} de peso`
                          : ""}
                        ) — {exAll.length} em saídas
                        {nExSaiuAlvo + nExReduPeso > 0
                          ? ` (${nExSaiuAlvo} saída${nExSaiuAlvo === 1 ? "" : "s"} do alvo${
                              nExReduPeso > 0
                                ? `, ${nExReduPeso} redução${nExReduPeso === 1 ? "" : "ões"} de peso (continua no alvo)`
                                : ""
                            })`
                          : ""}
                        {mo.prevRebalanceYmdForDiff
                          ? ` (vs. mês de ${mo.prevRebalanceYmdForDiff})`
                          : " (vs. mês anterior no CSV)"}
                        {typeof mo.diffOverlapEquityTickerCount === "number" ? (
                          <>
                            {" "}
                            · {mo.diffOverlapEquityTickerCount} título
                            {mo.diffOverlapEquityTickerCount === 1 ? "" : "s"} de risco
                            {mo.prevRebalanceYmdForDiff ? ` já em ${mo.prevRebalanceYmdForDiff}` : " no mês anterior"}{" "}
                            (sem alteração de nome, só ajuste de %)
                          </>
                        ) : null}
                        {" · "}
                        tabela: {mo.rows.length} posições
                      </span>
                    ) : null}
                  </div>
                </summary>
                <div style={{ padding: "0 8px 12px 8px", overflowX: "auto" }}>
                  {mo.priorThreeMonthReturns && mo.priorThreeMonthReturns.length > 0 ? (
                    <PriorThreeMonthChart bars={mo.priorThreeMonthReturns} />
                  ) : chartTooEarly ? (
                    <div style={{ fontSize: 12, color: "#71717a", marginTop: 8, marginBottom: 6 }}>
                      O gráfico dos três meses anteriores aparece a partir do terceiro mês da série.
                    </div>
                  ) : hasFlow ? (
                    <div style={{ fontSize: 12, color: "#71717a", marginTop: 8, marginBottom: 6 }}>
                      Gráfico dos meses anteriores indisponível para este período.
                    </div>
                  ) : (
                    <div style={{ fontSize: 12, color: "#71717a", marginTop: 8, marginBottom: 6 }}>
                      Gráfico dos meses anteriores disponível após os primeiros meses da série.
                    </div>
                  )}

                  {hasFlow ? (
                    <>
                      <p
                        style={{
                          fontSize: 12,
                          color: "#71717a",
                          lineHeight: 1.5,
                          margin: "8px 0 10px 0",
                          maxWidth: 720,
                        }}
                      >
                        <strong style={{ color: "#a1a1aa" }}>O que entra nestas listas (não é a tabela inteira):</strong>{" "}
                        <strong>Entradas</strong> = nomes <strong>novos</strong> (inexistentes no ficheiro do mês
                        anterior) e <strong>reforços</strong> (aumento ≥{REBALANCE_REWEIGHT_MIN_PP} p.p. no alvo, mesmo
                        ticker mês a mês). <strong>Saídas</strong> = títulos que <strong>deixam o alvo</strong> e{" "}
                        <strong>reduções de peso</strong> (≥{REBALANCE_REWEIGHT_MIN_PP} p.p.) em títulos que
                        se mantêm no alvo. Se
                        contares 16
                        títulos com {">"}1% nesse alvo, a maior parte
                        {typeof mo.diffOverlapEquityTickerCount === "number" ? (
                          <span>
                            {" "}
                            ({mo.diffOverlapEquityTickerCount} títulos de risco já constavam no ficheiro anterior){" "}
                          </span>
                        ) : null}
                        : a maior parte são <strong>posições de continuação</strong> (sem nome novo, sem
                        ajuste ≥{REBALANCE_REWEIGHT_MIN_PP} p.p.). A grelha abaixo tem {mo.rows.length} posições. Os
                        alvos a listar (≥{ENTRY_SIDE_LIST_MIN_ABS_PCT}%) vêm alinhados à grelha; ajuste de peso
                        mexe-se (≥{REBALANCE_REWEIGHT_MIN_PP} p.p.) ainda com alvo abaixo de{" "}
                        {ENTRY_SIDE_LIST_MIN_ABS_PCT}%. Liquidez (TBILL/BIL/SHV) segue a regra reservada acima.
                      </p>
                    {(() => {
                      const entNovoFilt = ent.filter((e) => e.kind !== "increase");
                      const entRefFilt = ent.filter((e) => e.kind === "increase");
                      const exFimFilt = ex.filter((e) => e.kind !== "decrease");
                      const exRedFilt = ex.filter((e) => e.kind === "decrease");
                      return (
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
                        gap: 10,
                        marginBottom: 12,
                        marginTop: 4,
                      }}
                    >
                      <div
                        style={{
                          borderRadius: 10,
                          border: "1px solid rgba(113,113,122,0.65)",
                          background: "rgba(63,63,70,0.35)",
                          padding: "8px 10px",
                        }}
                      >
                        <div style={{ fontSize: 13, fontWeight: 800, color: "#d4d4d8", marginBottom: 6 }}>
                          1 · Nomes <strong>novos</strong> (e caixa){" "}
                          <span style={{ fontWeight: 600, color: "#a1a1aa", fontSize: 12 }}>
                            ({entNovoFilt.length} mostrados, alvo ≥{ENTRY_SIDE_LIST_MIN_ABS_PCT}
                            {entOmitted > 0 ? (
                              <span style={{ color: "#71717a" }}> · +{entOmitted} fora do critério</span>
                            ) : null}
                            )
                          </span>
                        </div>
                        <div
                          style={{
                            fontSize: 11,
                            color: "#71717a",
                            lineHeight: 1.4,
                            marginBottom: 8,
                          }}
                        >
                          Ticker inexistente no ficheiro do mês anterior (ou ajuste TBILL agregado); pesa a grelha
                          (≥{ENTRY_SIDE_LIST_MIN_ABS_PCT}% alvo) para o filtro de lista.
                        </div>
                        {entOmitted > 0 ? (
                          <div style={{ fontSize: 11, color: "#52525b", marginBottom: 6, lineHeight: 1.4 }}>
                            Há {entOmitted} com alvo abaixo de {ENTRY_SIDE_LIST_MIN_ABS_PCT}% entre as {entAll.length} linhas
                            brutas do diff — vê tabela.
                          </div>
                        ) : null}
                        {entNovoFilt.length === 0 ? (
                          <div style={{ fontSize: 12, color: "#71717a" }}>—</div>
                        ) : (
                          <ul style={{ margin: 0, paddingLeft: 16, fontSize: 13, color: "#e4e4e7", lineHeight: 1.45 }}>
                            {entNovoFilt.map((r) => flowLiEntradaNovo(r, mo.date))}
                          </ul>
                        )}
                      </div>
                      <div
                        style={{
                          borderRadius: 10,
                          border: "1px solid rgba(52, 211, 153, 0.35)",
                          background: "rgba(20, 83, 45, 0.18)",
                          padding: "8px 10px",
                        }}
                      >
                        <div style={{ fontSize: 13, fontWeight: 800, color: "#d4d4d8", marginBottom: 6 }}>
                          2 · <strong>Reforços</strong> (mesmo ticker){" "}
                          <span style={{ fontWeight: 600, color: "#a1a1aa", fontSize: 12 }}>({entRefFilt.length} · |Δ| ≥{REBALANCE_REWEIGHT_MIN_PP} p.p.)</span>
                        </div>
                        <div style={{ fontSize: 11, color: "#71717a", lineHeight: 1.4, marginBottom: 8 }}>
                          Aumento de peso face ao mês de comparação; permanece no alvo.
                        </div>
                        {entRefFilt.length === 0 ? (
                          <div style={{ fontSize: 12, color: "#71717a" }}>—</div>
                        ) : (
                          <ul style={{ margin: 0, paddingLeft: 16, fontSize: 13, color: "#e4e4e7", lineHeight: 1.45 }}>
                            {entRefFilt.map((r) => flowLiReforco(r, mo.date))}
                          </ul>
                        )}
                      </div>
                      <div
                        style={{
                          borderRadius: 10,
                          border: "1px solid rgba(82,82,91,0.85)",
                          background: "rgba(24,24,27,0.65)",
                          padding: "8px 10px",
                        }}
                      >
                        <div style={{ fontSize: 13, fontWeight: 800, color: "#a1a1aa", marginBottom: 6 }}>
                          3 · Deixou o <strong>alvo</strong>{" "}
                          <span style={{ fontWeight: 600, color: "#a1a1aa", fontSize: 12 }}>({exFimFilt.length} linhas)</span>
                        </div>
                        {exFimFilt.length === 0 ? (
                          <div style={{ fontSize: 12, color: "#71717a" }}>—</div>
                        ) : (
                          <ul style={{ margin: 0, paddingLeft: 16, fontSize: 13, color: "#d4d4d8", lineHeight: 1.45 }}>
                            {exFimFilt.map((r) => flowLiSaidaFimAlvo(r, mo.date))}
                          </ul>
                        )}
                      </div>
                      <div
                        style={{
                          borderRadius: 10,
                          border: "1px solid rgba(248, 113, 113, 0.3)",
                          background: "rgba(88, 28, 28, 0.22)",
                          padding: "8px 10px",
                        }}
                      >
                        <div style={{ fontSize: 13, fontWeight: 800, color: "#a1a1aa", marginBottom: 6 }}>
                          4 · <strong>Reduções</strong> (ainda no alvo){" "}
                          <span style={{ fontWeight: 600, color: "#a1a1aa", fontSize: 12 }}>({exRedFilt.length} · |Δ| ≥{REBALANCE_REWEIGHT_MIN_PP} p.p.)</span>
                        </div>
                        <div style={{ fontSize: 11, color: "#71717a", lineHeight: 1.4, marginBottom: 8 }}>
                          Diminuiu o peso alvo; o nome continua na tabela.
                        </div>
                        {exRedFilt.length === 0 ? (
                          <div style={{ fontSize: 12, color: "#71717a" }}>—</div>
                        ) : (
                          <ul style={{ margin: 0, paddingLeft: 16, fontSize: 13, color: "#d4d4d8", lineHeight: 1.45 }}>
                            {exRedFilt.map((r) => flowLiSaidaReducao(r, mo.date))}
                          </ul>
                        )}
                      </div>
                    </div>
                    );
                    })()}
                    </>
                  ) : (
                    <div style={{ fontSize: 12, color: "#71717a", marginBottom: 10 }}>
                      Sem comparativo de entradas/saídas (primeira data do histórico ou um único mês).
                    </div>
                  )}

                  <table
                    style={{
                      width: "100%",
                      borderCollapse: "collapse",
                      fontSize: 14,
                      color: "#e4e4e7",
                    }}
                  >
                    <thead>
                      <tr style={{ borderBottom: "1px solid rgba(82,82,91,0.75)", background: "rgba(24,24,27,0.6)" }}>
                        <th style={{ textAlign: "left", padding: "8px 10px", color: "#a1a1aa" }}>#</th>
                        <th style={{ textAlign: "left", padding: "8px 10px", color: "#a1a1aa" }}>Ticker</th>
                        <th style={{ textAlign: "left", padding: "8px 10px", color: "#a1a1aa" }}>Empresa</th>
                        <th style={{ textAlign: "right", padding: "8px 10px", color: "#a1a1aa" }}>Peso %</th>
                        <th style={{ textAlign: "right", padding: "8px 10px", color: "#a1a1aa" }}>Score</th>
                        <th style={{ textAlign: "left", padding: "8px 10px", color: "#a1a1aa" }}>Sector</th>
                      </tr>
                    </thead>
                    <tbody>
                      {mo.rows.map((r, i) => (
                        <tr
                          key={`${mo.date}-${r.ticker}-${i}`}
                          style={{
                            borderBottom: "1px solid rgba(63,63,70,0.65)",
                            background: isCashSleeveTicker(r.ticker)
                              ? "rgba(82,82,91,0.35)"
                              : i % 2 === 0
                                ? "rgba(39,39,42,0.35)"
                                : "rgba(63,63,70,0.22)",
                          }}
                        >
                          <td style={{ padding: "7px 10px", color: "#71717a" }}>{r.rank ?? i + 1}</td>
                          <td style={{ padding: "7px 10px", fontWeight: 800 }}>
                            <a
                              href={yahooFinanceQuoteHref(r.ticker) ?? "#"}
                              target="_blank"
                              rel="noopener noreferrer"
                              style={{ color: "#d4d4d8", textDecoration: "none" }}
                              onMouseEnter={(e) => {
                                (e.currentTarget as HTMLAnchorElement).style.textDecoration = "underline";
                              }}
                              onMouseLeave={(e) => {
                                (e.currentTarget as HTMLAnchorElement).style.textDecoration = "none";
                              }}
                              onClick={(e) => e.stopPropagation()}
                            >
                              {r.ticker}
                            </a>
                          </td>
                          <td style={{ padding: "7px 10px", color: "#a1a1aa", maxWidth: 260 }} title={r.company || r.ticker}>
                            {r.company?.trim() ? r.company.trim() : "—"}
                          </td>
                          <td style={{ padding: "7px 10px", textAlign: "right" }}>{r.weightPct.toFixed(2)}%</td>
                          <td style={{ padding: "7px 10px", textAlign: "right", color: "#a1a1aa" }}>
                            {r.score != null && isFinite(r.score) ? r.score.toFixed(4) : "—"}
                          </td>
                          <td style={{ padding: "7px 10px", color: "#71717a" }}>{r.sector || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            );
          })
        )}
      </div>
    </div>
  );
}
