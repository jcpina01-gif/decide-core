import React, { useEffect, useMemo, useState } from "react";
import { formatPtDate } from "../lib/clientPortfolioSchedule";
import { DECIDE_APP_FONT_FAMILY } from "../lib/decideClientTheme";
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
  priorThreeMonthReturns?: PriorMonthBar[];
  equityChartSource?: string;
  chronologicalIndex?: number;
};

function formatCompanyLine(r: FlowRow): string {
  const c = (r.company || "").trim();
  if (c && c !== r.ticker) return `${r.ticker} — ${c}`;
  return r.ticker;
}

function isCashSleeveTicker(ticker: string): boolean {
  const t = ticker.trim().toUpperCase();
  return t === "TBILL_PROXY" || t === "BIL" || t === "SHV";
}

/** Igual ao piso de sugestão BUY no plano: entradas/saídas com |Δ| &lt; 1% são ruído na lista lateral. */
const FLOW_SIDE_LIST_MIN_ABS_PCT = 1;

function filterFlowSideList(rows: FlowRow[]): { shown: FlowRow[]; omitted: number } {
  const shown = rows.filter((r) => {
    if (isCashSleeveTicker(r.ticker)) return true;
    const w = typeof r.weightPct === "number" && Number.isFinite(r.weightPct) ? Math.abs(r.weightPct) : 0;
    return w >= FLOW_SIDE_LIST_MIN_ABS_PCT - 1e-9;
  });
  return { shown, omitted: rows.length - shown.length };
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

export default function RecommendationsHistoryPanel() {
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [data, setData] = useState<HistResponse | null>(null);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setErr("");
      try {
        const r = await fetch("/api/client/recommendations-history");
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

  const monthsFiltered = useMemo(() => {
    const m = data?.months || [];
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
  }, [data?.months, filter]);

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
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 18, fontWeight: 900, color: "#f4f4f5" }}>
          Histórico de decisões da carteira
        </div>
        <div style={{ fontSize: 14, color: "#a1a1aa", marginTop: 6, lineHeight: 1.5, maxWidth: 560 }}>
          Evolução mensal da composição da sua carteira ao longo do tempo.
        </div>
        <div style={{ fontSize: 13, color: "#71717a", marginTop: 8, lineHeight: 1.45, maxWidth: 560 }}>
          A carteira é ajustada periodicamente para refletir as melhores oportunidades identificadas pelo modelo.{" "}
          <span style={{ color: "#52525b" }}>
            Só entram datas até hoje: linhas de rebalance com data futura no CSV do modelo não são listadas como
            histórico.
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
            const { shown: ent, omitted: entOmitted } = filterFlowSideList(entAll);
            const { shown: ex, omitted: exOmitted } = filterFlowSideList(exAll);
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
                        · +{entAll.length} entradas / −{exAll.length} saídas
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
                        <strong style={{ color: "#a1a1aa" }}>Comparativo entre rebalances do modelo:</strong>{" "}
                        <strong>Saídas</strong> são títulos que tinham peso no{" "}
                        <strong>mês anterior desta série</strong> e <strong>deixam de existir</strong> nesta data (saem
                        por completo do alvo). <strong>Entradas</strong> são títulos <strong>novos</strong> nesta data.
                        Reduções de peso sem o ticker desaparecer <strong>não</strong> aparecem nestas listas — só a
                        tabela completa abaixo reflecte o alvo do mês.
                      </p>
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
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
                          Entradas ({ent.length}
                          {entOmitted > 0 ? (
                            <span style={{ fontWeight: 600, color: "#71717a" }}> · {entOmitted} &lt;1%</span>
                          ) : null}
                          )
                        </div>
                        {entOmitted > 0 ? (
                          <div style={{ fontSize: 11, color: "#52525b", marginBottom: 6, lineHeight: 1.4 }}>
                            Lista lateral: só linhas com peso ≥1% (exc. liquidez). O total «+{entAll.length}» no cabeçalho
                            inclui todas.
                          </div>
                        ) : null}
                        {ent.length === 0 ? (
                          <div style={{ fontSize: 12, color: "#71717a" }}>—</div>
                        ) : (
                          <ul style={{ margin: 0, paddingLeft: 16, fontSize: 13, color: "#e4e4e7", lineHeight: 1.45 }}>
                            {ent.map((r) => (
                              <li
                                key={`e-${mo.date}-${r.ticker}`}
                                style={isCashSleeveTicker(r.ticker) ? { color: "#fafafa", fontWeight: 800 } : undefined}
                              >
                                <strong>{formatCompanyLine(r)}</strong>
                                {r.weightPct != null ? ` → ${r.weightPct.toFixed(2)}%` : ""}
                                {isCashSleeveTicker(r.ticker) ? " · Liquidez" : ""}
                              </li>
                            ))}
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
                          Saídas ({ex.length}
                          {exOmitted > 0 ? (
                            <span style={{ fontWeight: 600, color: "#71717a" }}> · {exOmitted} &lt;1%</span>
                          ) : null}
                          )
                        </div>
                        {exOmitted > 0 ? (
                          <div style={{ fontSize: 11, color: "#52525b", marginBottom: 6, lineHeight: 1.4 }}>
                            Lista lateral: só linhas com peso ≥1% (exc. liquidez). O total «−{exAll.length}» no cabeçalho
                            inclui todas.
                          </div>
                        ) : null}
                        {ex.length === 0 ? (
                          <div style={{ fontSize: 12, color: "#71717a" }}>—</div>
                        ) : (
                          <ul style={{ margin: 0, paddingLeft: 16, fontSize: 13, color: "#d4d4d8", lineHeight: 1.45 }}>
                            {ex.map((r) => (
                              <li
                                key={`x-${mo.date}-${r.ticker}`}
                                style={isCashSleeveTicker(r.ticker) ? { color: "#fafafa", fontWeight: 800 } : undefined}
                              >
                                <strong>{formatCompanyLine(r)}</strong>
                                {r.weightPct != null ? ` (era ${r.weightPct.toFixed(2)}%)` : ""}
                                {isCashSleeveTicker(r.ticker) ? " · Liquidez" : ""}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </div>
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
