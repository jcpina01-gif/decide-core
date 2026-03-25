import React, { useEffect, useMemo, useState } from "react";
import { formatPtDate } from "../lib/clientPortfolioSchedule";

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

function yahooQuoteHref(ticker: string): string {
  const sym = ticker.trim().toUpperCase().replace(/\s+/g, "").replace(/\./g, "-");
  return `https://finance.yahoo.com/quote/${encodeURIComponent(sym)}`;
}

function formatCompanyLine(r: FlowRow): string {
  const c = (r.company || "").trim();
  if (c && c !== r.ticker) return `${r.ticker} — ${c}`;
  return r.ticker;
}

function isCashSleeveTicker(ticker: string): boolean {
  const t = ticker.trim().toUpperCase();
  return t === "TBILL_PROXY" || t === "BIL" || t === "SHV";
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
      <div style={{ fontSize: 10, color: "#94a3b8", fontWeight: 700, marginBottom: 4 }}>
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
          const fill = v >= 0 ? "#4ade80" : "#f87171";
          const empty = b.retPct == null || !isFinite(b.retPct);
          return (
            <g key={b.month}>
              <rect
                x={x}
                y={empty ? midY - 1 : y}
                width={bw}
                height={empty ? 2 : Math.max(hBar, 2)}
                rx={3}
                fill={empty ? "#475569" : fill}
                opacity={empty ? 0.5 : 1}
              />
              <text
                x={x + bw / 2}
                y={h - 4}
                textAnchor="middle"
                fill="#94a3b8"
                fontSize={9}
                fontFamily="system-ui,sans-serif"
              >
                {b.label}
              </text>
              <text
                x={x + bw / 2}
                y={pos ? y - 4 : y + hBar + 11}
                textAnchor="middle"
                fill={empty ? "#64748b" : "#e2e8f0"}
                fontSize={9}
                fontWeight={700}
                fontFamily="system-ui,sans-serif"
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
      <div style={{ padding: 24, color: "#94a3b8", fontSize: 14 }}>
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
          fontSize: 13,
          lineHeight: 1.5,
        }}
      >
        <strong>Não foi possível carregar o histórico.</strong> {err}
        <div style={{ marginTop: 10, fontSize: 12, color: "#fcd34d" }}>
          Confirme que o servidor DECIDE está a correr e que os dados de carteira estão disponíveis. Se o problema
          persistir, contacte o suporte.
        </div>
      </div>
    );
  }

  if (!data?.months?.length) {
    return (
      <div style={{ padding: 20, color: "#94a3b8" }}>Sem dados de histórico no servidor.</div>
    );
  }

  return (
    <div
      style={{
        marginTop: 10,
        background: "#12244d",
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: 16,
        padding: "12px 14px 16px",
      }}
    >
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 15, fontWeight: 900, color: "#e2e8f0" }}>
          Histórico de decisões da carteira
        </div>
        <div style={{ fontSize: 12, color: "#cbd5e1", marginTop: 6, lineHeight: 1.5, maxWidth: 560 }}>
          Evolução mensal da composição da sua carteira ao longo do tempo.
        </div>
        <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 8, lineHeight: 1.45, maxWidth: 560 }}>
          A carteira é ajustada periodicamente para refletir as melhores oportunidades identificadas pelo modelo.
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
            background: "rgba(15,23,42,0.65)",
            border: "1px solid rgba(255,255,255,0.12)",
            borderRadius: 12,
            padding: "10px 12px",
            color: "#fff",
            fontSize: 13,
          }}
        />
      </div>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 10,
          marginTop: 4,
          borderLeft: "3px solid rgba(59,130,246,0.45)",
          paddingLeft: 12,
        }}
      >
        {monthsFiltered.length === 0 ? (
          <div style={{ color: "#94a3b8", fontSize: 13 }}>Nenhum mês corresponde ao filtro.</div>
        ) : (
          monthsFiltered.map((mo) => {
            const sumW = mo.rows.reduce((s, r) => s + r.weight, 0);
            const hasFlow = mo.entries !== undefined && mo.exits !== undefined;
            const ent = mo.entries ?? [];
            const ex = mo.exits ?? [];
            const chrono = mo.chronologicalIndex;
            const chartTooEarly = chrono != null && chrono < 2;
            const monthHeading = formatMonthHeadingPt(mo.date);
            const sleeveLine =
              typeof mo.tbillsTotalPct === "number" && isFinite(mo.tbillsTotalPct) ? (
                <span style={{ color: "#7dd3fc", fontWeight: 700 }}>
                  Liquidez {mo.tbillsTotalPct.toFixed(1)}%
                  {typeof mo.equitySleeveTotalPct === "number" && isFinite(mo.equitySleeveTotalPct)
                    ? ` · Ações ${mo.equitySleeveTotalPct.toFixed(1)}%`
                    : ""}
                </span>
              ) : null;
            return (
              <details
                key={mo.date}
                style={{
                  borderRadius: 12,
                  background: "rgba(15,23,42,0.55)",
                  border: "1px solid rgba(147,197,253,0.2)",
                }}
              >
                <summary
                  style={{
                    padding: "12px 14px",
                    cursor: "pointer",
                    listStyle: "none",
                  }}
                >
                  <div style={{ fontSize: 12, fontWeight: 800, color: "#94a3b8", marginBottom: 4, letterSpacing: "0.02em" }}>
                    {monthHeading}
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 800, color: "#e2e8f0", lineHeight: 1.35 }}>
                    {formatPtDate(mo.date)}
                    {sleeveLine ? (
                      <>
                        {" "}
                        — {sleeveLine}
                      </>
                    ) : null}
                  </div>
                  <div style={{ fontSize: 12, color: "#64748b", fontWeight: 600, marginTop: 6 }}>
                    Carteira total: {(sumW * 100).toFixed(1)}% · {mo.rows.length} posições
                    {hasFlow ? (
                      <span style={{ color: "#64748b" }}>
                        {" "}
                        · +{ent.length} entradas / −{ex.length} saídas
                      </span>
                    ) : null}
                  </div>
                </summary>
                <div style={{ padding: "0 8px 12px 8px", overflowX: "auto" }}>
                  {mo.priorThreeMonthReturns && mo.priorThreeMonthReturns.length > 0 ? (
                    <PriorThreeMonthChart bars={mo.priorThreeMonthReturns} />
                  ) : chartTooEarly ? (
                    <div style={{ fontSize: 10, color: "#64748b", marginTop: 8, marginBottom: 6 }}>
                      O gráfico dos três meses anteriores aparece a partir do terceiro mês da série.
                    </div>
                  ) : hasFlow ? (
                    <div style={{ fontSize: 10, color: "#64748b", marginTop: 8, marginBottom: 6 }}>
                      Gráfico dos meses anteriores indisponível para este período.
                    </div>
                  ) : (
                    <div style={{ fontSize: 10, color: "#64748b", marginTop: 8, marginBottom: 6 }}>
                      Gráfico dos meses anteriores disponível após os primeiros meses da série.
                    </div>
                  )}

                  {hasFlow ? (
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
                          border: "1px solid rgba(34,197,94,0.35)",
                          background: "rgba(22,101,52,0.2)",
                          padding: "8px 10px",
                        }}
                      >
                        <div style={{ fontSize: 11, fontWeight: 800, color: "#86efac", marginBottom: 6 }}>
                          Entradas ({ent.length})
                        </div>
                        {ent.length === 0 ? (
                          <div style={{ fontSize: 10, color: "#64748b" }}>—</div>
                        ) : (
                          <ul style={{ margin: 0, paddingLeft: 16, fontSize: 10, color: "#d1fae5", lineHeight: 1.45 }}>
                            {ent.map((r) => (
                              <li
                                key={`e-${mo.date}-${r.ticker}`}
                                style={isCashSleeveTicker(r.ticker) ? { color: "#a5f3fc", fontWeight: 800 } : undefined}
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
                          border: "1px solid rgba(248,113,113,0.35)",
                          background: "rgba(127,29,29,0.2)",
                          padding: "8px 10px",
                        }}
                      >
                        <div style={{ fontSize: 11, fontWeight: 800, color: "#fca5a5", marginBottom: 6 }}>
                          Saídas ({ex.length})
                        </div>
                        {ex.length === 0 ? (
                          <div style={{ fontSize: 10, color: "#64748b" }}>—</div>
                        ) : (
                          <ul style={{ margin: 0, paddingLeft: 16, fontSize: 10, color: "#fecaca", lineHeight: 1.45 }}>
                            {ex.map((r) => (
                              <li
                                key={`x-${mo.date}-${r.ticker}`}
                                style={isCashSleeveTicker(r.ticker) ? { color: "#a5f3fc", fontWeight: 800 } : undefined}
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
                  ) : (
                    <div style={{ fontSize: 10, color: "#64748b", marginBottom: 10 }}>
                      Sem comparativo de entradas/saídas (primeira data do histórico ou um único mês).
                    </div>
                  )}

                  <table
                    style={{
                      width: "100%",
                      borderCollapse: "collapse",
                      fontSize: 11,
                      color: "#e2e8f0",
                    }}
                  >
                    <thead>
                      <tr style={{ borderBottom: "1px solid rgba(148,163,184,0.25)" }}>
                        <th style={{ textAlign: "left", padding: "6px 8px", color: "#94a3b8" }}>#</th>
                        <th style={{ textAlign: "left", padding: "6px 8px", color: "#94a3b8" }}>Ticker</th>
                        <th style={{ textAlign: "left", padding: "6px 8px", color: "#94a3b8" }}>Empresa</th>
                        <th style={{ textAlign: "right", padding: "6px 8px", color: "#94a3b8" }}>Peso %</th>
                        <th style={{ textAlign: "right", padding: "6px 8px", color: "#94a3b8" }}>Score</th>
                        <th style={{ textAlign: "left", padding: "6px 8px", color: "#94a3b8" }}>Sector</th>
                      </tr>
                    </thead>
                    <tbody>
                      {mo.rows.map((r, i) => (
                        <tr
                          key={`${mo.date}-${r.ticker}-${i}`}
                          style={{
                            borderBottom: "1px solid rgba(30,41,59,0.9)",
                            background: isCashSleeveTicker(r.ticker) ? "rgba(14, 165, 233, 0.08)" : undefined,
                          }}
                        >
                          <td style={{ padding: "5px 8px", color: "#64748b" }}>{r.rank ?? i + 1}</td>
                          <td style={{ padding: "5px 8px", fontWeight: 800 }}>
                            <a
                              href={yahooQuoteHref(r.ticker)}
                              target="_blank"
                              rel="noopener noreferrer"
                              style={{ color: "#7dd3fc", textDecoration: "none" }}
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
                          <td style={{ padding: "5px 8px", color: "#cbd5e1", maxWidth: 260 }} title={r.company || r.ticker}>
                            {r.company?.trim() ? r.company.trim() : "—"}
                          </td>
                          <td style={{ padding: "5px 8px", textAlign: "right" }}>{r.weightPct.toFixed(2)}%</td>
                          <td style={{ padding: "5px 8px", textAlign: "right", color: "#94a3b8" }}>
                            {r.score != null && isFinite(r.score) ? r.score.toFixed(4) : "—"}
                          </td>
                          <td style={{ padding: "5px 8px", color: "#64748b" }}>{r.sector || "—"}</td>
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
