import type { GetServerSideProps } from "next";
import Head from "next/head";
import { useEffect, useState } from "react";
import BackofficeShell from "../../components/backoffice/BackofficeShell";
import { backofficeGetServerSideProps } from "../../lib/backofficePageProps";
import type { BackofficeClientSummary } from "../../lib/server/backofficeData";

// ── Fee constants (mirrors CustosPage in client-dashboard.tsx) ─────────────
const DECIDE_MONTHLY_PREMIUM = 29;     // €/month
const DECIDE_MGMT_PCT_PRIVATE = 0.60;  // % per year
const EXTERN_PCT = 0.12;               // % per year (custody + transactions + FX + other)
// Margin borrowing: IB charges ~4%/year on borrowed capital.
// With MARGIN_BOOST=1.35, avg leverage≈1.35x → avg borrow ≈35% of AUM.
const MARGIN_RATE_AA = 4.0;            // % per year (IB debit rate)
const MARGIN_AVG_BORROW_PCT = 35;      // % of AUM borrowed on average when margin active

type CostRow = {
  client: BackofficeClientSummary;
  plan: "premium" | "private";
  aum: number;
  mgmtAnnual: number;
  mgmtPct: number;
  externAnnual: number;
  marginAnnual: number;
  totalAnnual: number;
  totalPct: number;
  ytdMonths: number;
  ytdEstimate: number;
};

function computeCosts(client: BackofficeClientSummary, ytdMonths: number): CostRow {
  const aum = client.navIbkr ?? 0;
  const plan: "premium" | "private" =
    client.plan ?? (aum >= 50_000 ? "private" : "premium");

  const mgmtAnnual =
    plan === "private"
      ? aum * (DECIDE_MGMT_PCT_PRIVATE / 100)
      : DECIDE_MONTHLY_PREMIUM * 12;

  const mgmtPct =
    plan === "private" ? DECIDE_MGMT_PCT_PRIVATE : aum > 0 ? (DECIDE_MONTHLY_PREMIUM * 12 / aum) * 100 : 0;

  const externAnnual = aum * (EXTERN_PCT / 100);

  // Margin borrowing cost: only when margin is enabled
  const marginAnnual = client.marginEnabled
    ? aum * (MARGIN_AVG_BORROW_PCT / 100) * (MARGIN_RATE_AA / 100)
    : 0;

  const totalAnnual = mgmtAnnual + externAnnual + marginAnnual;
  const totalPct = aum > 0 ? (totalAnnual / aum) * 100 : 0;

  const mgmtYtd =
    plan === "private"
      ? mgmtAnnual * (ytdMonths / 12)
      : DECIDE_MONTHLY_PREMIUM * ytdMonths;
  const externYtd = externAnnual * (ytdMonths / 12);
  const marginYtd = marginAnnual * (ytdMonths / 12);
  const ytdEstimate = mgmtYtd + externYtd + marginYtd;

  return {
    client,
    plan,
    aum,
    mgmtAnnual,
    mgmtPct,
    externAnnual,
    marginAnnual,
    totalAnnual,
    totalPct,
    ytdMonths,
    ytdEstimate,
  };
}

function fmtEur(n: number): string {
  return n.toLocaleString("pt-PT", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function fmtPct(n: number): string {
  return n.toFixed(2) + "%";
}

type RealCommission = {
  client_id: string;
  commission_total: number;
  commission_ytd: number;
  execution_count: number;
  execution_count_ytd: number;
  last_execution: string | null;
};

type RealOrderCount = {
  client_id: string;
  order_count: number;
  order_count_ytd: number;
  last_order: string | null;
};

export default function BackofficeCustosPage() {
  const [clients, setClients] = useState<BackofficeClientSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [realCommissions, setRealCommissions] = useState<RealCommission[]>([]);
  const [realOrders, setRealOrders] = useState<RealOrderCount[]>([]);
  const [realLoading, setRealLoading] = useState(true);

  const ytdMonths = new Date().getMonth() + 1;

  useEffect(() => {
    fetch("/api/backoffice/clients")
      .then((r) => r.json())
      .then((d) => {
        if (d?.clients) setClients(d.clients);
        else setError("Sem dados de clientes.");
      })
      .catch(() => setError("Erro ao carregar clientes."))
      .finally(() => setLoading(false));

    fetch("/api/backoffice/client-costs")
      .then((r) => r.json())
      .then((d) => {
        if (d?.ok) {
          setRealCommissions(d.commissions ?? []);
          setRealOrders(d.orders ?? []);
        }
      })
      .catch(() => {})
      .finally(() => setRealLoading(false));
  }, []);

  const rows = clients.map((c) => computeCosts(c, ytdMonths));

  // Build lookup: clientId → real commission data (try exact + known aliases)
  const KNOWN_ALIASES: Record<string, string[]> = {
    jcpina01: ["jcpina01", "DUM504002", "unknown"],
    DUM504002: ["DUM504002", "jcpina01", "unknown"],
  };
  function getRealComm(clientId: string): RealCommission | null {
    const aliases = KNOWN_ALIASES[clientId] ?? [clientId];
    for (const alias of aliases) {
      const found = realCommissions.find((r) => r.client_id === alias);
      if (found) return found;
    }
    return null;
  }
  function getRealOrders(clientId: string): RealOrderCount | null {
    const aliases = KNOWN_ALIASES[clientId] ?? [clientId];
    for (const alias of aliases) {
      const found = realOrders.find((r) => r.client_id === alias);
      if (found) return found;
    }
    return null;
  }

  const totalAum = rows.reduce((s, r) => s + r.aum, 0);
  const totalMgmt = rows.reduce((s, r) => s + r.mgmtAnnual, 0);
  const totalExtern = rows.reduce((s, r) => s + r.externAnnual, 0);
  const totalMargin = rows.reduce((s, r) => s + r.marginAnnual, 0);
  const totalCost = rows.reduce((s, r) => s + r.totalAnnual, 0);
  const totalYtd = rows.reduce((s, r) => s + r.ytdEstimate, 0);
  const anyMargin = rows.some((r) => r.client.marginEnabled);

  // Real commission totals (from execution_logs)
  const totalRealCommYtd = realCommissions.reduce((s, r) => s + (r.commission_ytd ?? 0), 0);
  const totalRealCommAll = realCommissions.reduce((s, r) => s + (r.commission_total ?? 0), 0);
  const hasAnyRealComm = totalRealCommAll > 0;

  return (
    <>
      <Head>
        <title>Custos de clientes — Back-office Decide</title>
        <meta name="robots" content="noindex,nofollow" />
      </Head>
      <BackofficeShell
        active="custos"
        title="Custos por cliente"
        subtitle="Encargos reais (comissões IB de execuções registadas) e estimados (custódia, margem, gestão) por cliente."
      >
        {loading && (
          <p style={{ color: "#64748b", fontSize: 14 }}>A carregar clientes…</p>
        )}
        {error && (
          <div style={{ color: "#f87171", fontSize: 14, marginBottom: 16 }}>{error}</div>
        )}

        {!loading && rows.length === 0 && !error && (
          <div
            style={{
              background: "rgba(245,158,11,0.08)",
              border: "1px solid rgba(245,158,11,0.2)",
              borderRadius: 12,
              padding: "20px 24px",
              color: "#fbbf24",
              fontSize: 14,
            }}
          >
            Nenhum cliente encontrado. Verifica <code>tmp_diag/backoffice_store.json</code> ou o ficheiro de smoke test IB.
          </div>
        )}

        {!loading && rows.length > 0 && (
          <>
            {/* ── Real commissions banner ─────────────────────────────────── */}
            {!realLoading && (
              <div
                style={{
                  background: hasAnyRealComm
                    ? "rgba(52,211,153,0.06)"
                    : "rgba(245,158,11,0.06)",
                  border: `1px solid ${hasAnyRealComm ? "rgba(52,211,153,0.2)" : "rgba(245,158,11,0.2)"}`,
                  borderRadius: 10,
                  padding: "12px 18px",
                  marginBottom: 20,
                  display: "flex",
                  alignItems: "center",
                  gap: 14,
                  flexWrap: "wrap",
                }}
              >
                <span style={{ fontSize: 12, fontWeight: 800, color: hasAnyRealComm ? "#34d399" : "#fbbf24" }}>
                  {hasAnyRealComm ? "✓ Comissões reais disponíveis" : "⚠ Sem dados reais de execuções ainda"}
                </span>
                {hasAnyRealComm ? (
                  <>
                    <span style={{ fontSize: 12, color: "#94a3b8" }}>
                      Total acumulado: <strong style={{ color: "#e2e8f0" }}>€ {fmtEur(totalRealCommAll)}</strong>
                    </span>
                    <span style={{ fontSize: 12, color: "#94a3b8" }}>
                      YTD {new Date().getFullYear()}: <strong style={{ color: "#34d399" }}>€ {fmtEur(totalRealCommYtd)}</strong>
                    </span>
                  </>
                ) : (
                  <span style={{ fontSize: 11, color: "#71717a" }}>
                    As comissões reais serão registadas automaticamente após a próxima execução de ordens pelo dashboard.
                  </span>
                )}
              </div>
            )}

            {/* ── Summary cards ──────────────────────────────────────────── */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
                gap: 12,
                marginBottom: 28,
              }}
            >
              {[
                { label: "AUM total", value: `€ ${fmtEur(totalAum)}`, sub: `${clients.length} cliente${clients.length !== 1 ? "s" : ""}`, color: "#38bdf8" },
                { label: "Receita gestão (ano)", value: `€ ${fmtEur(totalMgmt)}`, sub: "fees DECIDE anuais estimados", color: "#34d399" },
                ...(hasAnyRealComm
                  ? [{ label: "Comissões IB reais (YTD)", value: `€ ${fmtEur(totalRealCommYtd)}`, sub: "comissões reais registadas", color: "#34d399" }]
                  : [{ label: "Custos externos (ano)", value: `€ ${fmtEur(totalExtern)}`, sub: `${fmtPct(EXTERN_PCT)} do AUM (estimado)`, color: "#94a3b8" }]
                ),
                ...(anyMargin ? [{ label: "Custo margem (ano)", value: `€ ${fmtEur(totalMargin)}`, sub: `~${MARGIN_AVG_BORROW_PCT}% AUM × ${MARGIN_RATE_AA}% (estimado)`, color: "#f472b6" }] : []),
                { label: "Total encargos (ano)", value: `€ ${fmtEur(totalCost)}`, sub: anyMargin ? "gestão + externos + margem" : "gestão + externos (est.)", color: "#fb923c" },
                { label: `YTD estimado (${ytdMonths}m)`, value: `€ ${fmtEur(totalYtd)}`, sub: `pro-rata ${ytdMonths}/12 do ano`, color: "#a78bfa" },
              ].map((k) => (
                <div
                  key={k.label}
                  style={{
                    background: "rgba(24,24,27,0.92)",
                    border: "1px solid rgba(63,63,70,0.6)",
                    borderRadius: 12,
                    padding: "16px 18px",
                  }}
                >
                  <div style={{ fontSize: 10, fontWeight: 800, color: "#52525b", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>
                    {k.label}
                  </div>
                  <div style={{ fontSize: 22, fontWeight: 900, color: k.color, letterSpacing: "-0.02em" }}>
                    {k.value}
                  </div>
                  <div style={{ fontSize: 11, color: "#71717a", marginTop: 4 }}>{k.sub}</div>
                </div>
              ))}
            </div>

            {/* ── Per-client cost table ───────────────────────────────────── */}
            <div
              style={{
                background: "rgba(15,15,20,0.95)",
                border: "1px solid rgba(63,63,70,0.5)",
                borderRadius: 14,
                overflow: "hidden",
              }}
            >
              <div style={{ padding: "16px 20px", borderBottom: "1px solid rgba(63,63,70,0.4)" }}>
                <span style={{ fontSize: 13, fontWeight: 800, color: "#e2e8f0" }}>
                  Encargos detalhados por cliente
                </span>
                <span style={{ fontSize: 11, color: "#52525b", marginLeft: 10 }}>
                  comissões: dados reais (IB) · custódia + margem: estimado
                </span>
              </div>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 980 }}>
                  <thead>
                    <tr style={{ background: "rgba(0,0,0,0.3)" }}>
                      {[
                        "Cliente", "Plano", "AUM (€)", "Gestão DECIDE",
                        "Comissões IB",
                        "Custódia + outros",
                        ...(anyMargin ? ["Custo margem"] : []),
                        "Total encargos", "% total do AUM", "YTD estimado",
                      ].map((h) => (
                        <th
                          key={h}
                          style={{
                            padding: "10px 16px",
                            textAlign: "left",
                            fontSize: 10,
                            fontWeight: 800,
                            color: "#64748b",
                            textTransform: "uppercase",
                            letterSpacing: "0.05em",
                            borderBottom: "1px solid rgba(63,63,70,0.4)",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => {
                      const isPrivate = r.plan === "private";
                      const realComm = getRealComm(r.client.clientId);
                      const realOrd = getRealOrders(r.client.clientId);
                      const hasReal = (realComm?.commission_total ?? 0) > 0;
                      // Custody = total external minus transaction commissions (0.04% of AUM)
                      const custodyAnnual = r.aum * ((EXTERN_PCT - 0.04) / 100);
                      return (
                        <tr
                          key={r.client.clientId}
                          style={{
                            background: i % 2 === 0 ? "transparent" : "rgba(255,255,255,0.015)",
                            borderBottom: "1px solid rgba(63,63,70,0.2)",
                          }}
                        >
                          {/* Cliente */}
                          <td style={{ padding: "14px 16px" }}>
                            <div style={{ fontSize: 14, fontWeight: 700, color: "#e2e8f0" }}>
                              {r.client.displayName}
                            </div>
                            {r.client.accountCode && (
                              <div style={{ fontSize: 11, color: "#52525b", marginTop: 2 }}>
                                {r.client.accountCode}
                              </div>
                            )}
                            {r.client.riskProfile && (
                              <div style={{ fontSize: 10, color: "#475569", marginTop: 1 }}>
                                Perfil: {r.client.riskProfile}
                              </div>
                            )}
                          </td>

                          {/* Plano */}
                          <td style={{ padding: "14px 16px" }}>
                            <span
                              style={{
                                display: "inline-block",
                                padding: "3px 10px",
                                borderRadius: 6,
                                fontSize: 11,
                                fontWeight: 800,
                                background: isPrivate ? "rgba(245,158,11,0.12)" : "rgba(56,189,248,0.12)",
                                color: isPrivate ? "#fbbf24" : "#38bdf8",
                                border: isPrivate ? "1px solid rgba(245,158,11,0.25)" : "1px solid rgba(56,189,248,0.25)",
                              }}
                            >
                              {isPrivate ? "PRIVATE" : "PREMIUM"}
                            </span>
                            {r.client.plan == null && (
                              <div style={{ fontSize: 9, color: "#52525b", marginTop: 4 }}>auto</div>
                            )}
                          </td>

                          {/* AUM */}
                          <td style={{ padding: "14px 16px", fontVariantNumeric: "tabular-nums" }}>
                            {r.aum > 0 ? (
                              <>
                                <div style={{ fontSize: 15, fontWeight: 700, color: "#e2e8f0" }}>
                                  € {fmtEur(r.aum)}
                                </div>
                                <div style={{ fontSize: 10, color: "#52525b", marginTop: 2 }}>
                                  {r.client.navCurrency}
                                </div>
                              </>
                            ) : (
                              <span style={{ color: "#52525b" }}>—</span>
                            )}
                          </td>

                          {/* Gestão DECIDE */}
                          <td style={{ padding: "14px 16px", fontVariantNumeric: "tabular-nums" }}>
                            <div style={{ fontSize: 14, fontWeight: 700, color: "#34d399" }}>
                              € {fmtEur(r.mgmtAnnual)}
                              <span style={{ fontSize: 10, fontWeight: 400, color: "#52525b", marginLeft: 4 }}>
                                /ano
                              </span>
                            </div>
                            <div style={{ fontSize: 10, color: "#52525b", marginTop: 2 }}>
                              {isPrivate
                                ? `${fmtPct(DECIDE_MGMT_PCT_PRIVATE)}/ano`
                                : `€${DECIDE_MONTHLY_PREMIUM}/mês`}
                            </div>
                          </td>

                          {/* Comissões IB – real */}
                          <td style={{ padding: "14px 16px", fontVariantNumeric: "tabular-nums" }}>
                            {hasReal ? (
                              <>
                                <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                                  <div style={{ fontSize: 14, fontWeight: 700, color: "#34d399" }}>
                                    € {fmtEur(realComm!.commission_ytd)}
                                  </div>
                                  <span style={{ fontSize: 9, fontWeight: 800, background: "rgba(52,211,153,0.15)", color: "#34d399", border: "1px solid rgba(52,211,153,0.3)", borderRadius: 4, padding: "1px 5px" }}>REAL</span>
                                </div>
                                <div style={{ fontSize: 10, color: "#52525b", marginTop: 2 }}>
                                  YTD · {realComm!.execution_count_ytd} exec.
                                </div>
                                {(realComm!.commission_total ?? 0) > (realComm!.commission_ytd ?? 0) && (
                                  <div style={{ fontSize: 9, color: "#3f3f46", marginTop: 1 }}>
                                    All-time: € {fmtEur(realComm!.commission_total)}
                                  </div>
                                )}
                              </>
                            ) : (
                              <>
                                <div style={{ fontSize: 13, color: "#52525b" }}>
                                  {realOrd && (realOrd.order_count_ytd ?? 0) > 0
                                    ? `${realOrd.order_count_ytd} ord. YTD`
                                    : "—"}
                                </div>
                                <div style={{ fontSize: 9, color: "#3f3f46", marginTop: 2 }}>
                                  {realOrd && (realOrd.order_count_ytd ?? 0) > 0
                                    ? "execuções não registadas"
                                    : "sem execuções"}
                                </div>
                              </>
                            )}
                          </td>

                          {/* Custódia + outros – estimado */}
                          <td style={{ padding: "14px 16px", fontVariantNumeric: "tabular-nums" }}>
                            {r.aum > 0 ? (
                              <>
                                <div style={{ fontSize: 14, fontWeight: 700, color: "#94a3b8" }}>
                                  € {fmtEur(custodyAnnual)}
                                  <span style={{ fontSize: 10, fontWeight: 400, color: "#52525b", marginLeft: 4 }}>
                                    /ano
                                  </span>
                                </div>
                                <div style={{ fontSize: 10, color: "#52525b", marginTop: 2 }}>
                                  {fmtPct(EXTERN_PCT - 0.04)}/ano est.
                                </div>
                              </>
                            ) : (
                              <span style={{ color: "#52525b" }}>—</span>
                            )}
                          </td>

                          {/* Custo margem (only rendered when any client has margin) */}
                          {anyMargin && (
                            <td style={{ padding: "14px 16px", fontVariantNumeric: "tabular-nums" }}>
                              {r.client.marginEnabled ? (
                                <>
                                  <div style={{ fontSize: 14, fontWeight: 700, color: "#f472b6" }}>
                                    € {fmtEur(r.marginAnnual)}
                                    <span style={{ fontSize: 10, fontWeight: 400, color: "#52525b", marginLeft: 4 }}>
                                      /ano
                                    </span>
                                  </div>
                                  <div style={{ fontSize: 10, color: "#52525b", marginTop: 2 }}>
                                    ~{MARGIN_AVG_BORROW_PCT}% AUM × {MARGIN_RATE_AA}%
                                  </div>
                                </>
                              ) : (
                                <span style={{ color: "#3f3f46", fontSize: 12 }}>Sem margem</span>
                              )}
                            </td>
                          )}

                          {/* Total */}
                          <td style={{ padding: "14px 16px", fontVariantNumeric: "tabular-nums" }}>
                            <div style={{ fontSize: 15, fontWeight: 900, color: "#fb923c" }}>
                              € {fmtEur(r.totalAnnual)}
                              <span style={{ fontSize: 10, fontWeight: 400, color: "#52525b", marginLeft: 4 }}>
                                /ano
                              </span>
                            </div>
                          </td>

                          {/* % AUM */}
                          <td style={{ padding: "14px 16px", fontVariantNumeric: "tabular-nums" }}>
                            {r.aum > 0 ? (
                              <div
                                style={{
                                  fontSize: 14,
                                  fontWeight: 700,
                                  color: r.totalPct > 1.5 ? "#f87171" : r.totalPct > 0.9 ? "#fbbf24" : "#34d399",
                                }}
                              >
                                {fmtPct(r.totalPct)}
                              </div>
                            ) : (
                              <span style={{ color: "#52525b" }}>—</span>
                            )}
                          </td>

                          {/* YTD */}
                          <td style={{ padding: "14px 16px", fontVariantNumeric: "tabular-nums" }}>
                            <div style={{ fontSize: 14, fontWeight: 700, color: "#a78bfa" }}>
                              € {fmtEur(r.ytdEstimate)}
                            </div>
                            <div style={{ fontSize: 10, color: "#52525b", marginTop: 2 }}>
                              {ytdMonths} meses
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>

                  {/* Totals row */}
                  {rows.length > 1 && (
                    <tfoot>
                      <tr style={{ background: "rgba(0,0,0,0.4)", borderTop: "2px solid rgba(63,63,70,0.5)" }}>
                        <td colSpan={2} style={{ padding: "12px 16px", fontSize: 11, fontWeight: 800, color: "#64748b", textTransform: "uppercase" }}>
                          Total ({rows.length} clientes)
                        </td>
                        <td style={{ padding: "12px 16px", fontSize: 14, fontWeight: 900, color: "#38bdf8" }}>
                          € {fmtEur(totalAum)}
                        </td>
                        <td style={{ padding: "12px 16px", fontSize: 14, fontWeight: 900, color: "#34d399" }}>
                          € {fmtEur(totalMgmt)}
                        </td>
                        {/* Comissões IB total */}
                        <td style={{ padding: "12px 16px", fontSize: 14, fontWeight: 900, color: hasAnyRealComm ? "#34d399" : "#52525b" }}>
                          {hasAnyRealComm ? `€ ${fmtEur(totalRealCommYtd)}` : "—"}
                        </td>
                        {/* Custódia total */}
                        <td style={{ padding: "12px 16px", fontSize: 14, fontWeight: 900, color: "#94a3b8" }}>
                          € {fmtEur(rows.reduce((s, r) => s + r.aum * ((EXTERN_PCT - 0.04) / 100), 0))}
                        </td>
                        {anyMargin && (
                          <td style={{ padding: "12px 16px", fontSize: 14, fontWeight: 900, color: "#f472b6" }}>
                            € {fmtEur(totalMargin)}
                          </td>
                        )}
                        <td style={{ padding: "12px 16px", fontSize: 15, fontWeight: 900, color: "#fb923c" }}>
                          € {fmtEur(totalCost)}
                        </td>
                        <td style={{ padding: "12px 16px", fontSize: 14, fontWeight: 900, color: "#94a3b8" }}>
                          {totalAum > 0 ? fmtPct((totalCost / totalAum) * 100) : "—"}
                        </td>
                        <td style={{ padding: "12px 16px", fontSize: 14, fontWeight: 900, color: "#a78bfa" }}>
                          € {fmtEur(totalYtd)}
                        </td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </div>

            {/* ── Fee structure reference ─────────────────────────────────── */}
            <div
              style={{
                marginTop: 24,
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
                gap: 14,
              }}
            >
              {[
                {
                  title: "Plano PREMIUM",
                  color: "#38bdf8",
                  lines: [
                    { k: "Gestão DECIDE", v: "€29 / mês (€348 / ano)" },
                    { k: "Performance fee", v: "Não aplicável" },
                    { k: "Custos externos", v: "0,12% / ano (broker)" },
                    { k: "Típico para AUM", v: "€5 000 – €50 000" },
                  ],
                },
                {
                  title: "Plano PRIVATE",
                  color: "#fbbf24",
                  lines: [
                    { k: "Gestão DECIDE", v: "0,6% / ano (0,05%/mês)" },
                    { k: "Performance fee", v: "Não aplicável" },
                    { k: "Custos externos", v: "0,12% / ano (broker)" },
                    { k: "Típico para AUM", v: "≥ €50 000" },
                  ],
                },
                {
                  title: "Custos externos (todos os planos)",
                  color: "#94a3b8",
                  lines: [
                    { k: "Custódia (IB)", v: "≈ 0,06% / ano (est.)" },
                    { k: "Comissões negociação", v: "real · max(€1,25; 0,05% × trade)" },
                    { k: "Câmbio (FX spread)", v: "≈ 0,01% / ano (est.)" },
                    { k: "Taxas regulatórias", v: "≈ 0,01% / ano (est.)" },
                  ],
                },
                {
                  title: "Custo de margem (se ativa)",
                  color: "#f472b6",
                  lines: [
                    { k: "Taxa IB (debit rate)", v: `${MARGIN_RATE_AA}% / ano` },
                    { k: "Capital médio emprestado", v: `~${MARGIN_AVG_BORROW_PCT}% do AUM` },
                    { k: "Custo anual estimado", v: `~${((MARGIN_AVG_BORROW_PCT / 100) * MARGIN_RATE_AA).toFixed(2)}% do AUM` },
                    { k: "Configurar em", v: "backoffice_store.json" },
                  ],
                },
              ].map((card) => (
                <div
                  key={card.title}
                  style={{
                    background: "rgba(15,15,20,0.95)",
                    border: `1px solid rgba(63,63,70,0.5)`,
                    borderRadius: 12,
                    padding: "18px 20px",
                  }}
                >
                  <div style={{ fontSize: 11, fontWeight: 800, color: card.color, marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                    {card.title}
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                    {card.lines.map((l) => (
                      <div key={l.k} style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                        <span style={{ fontSize: 12, color: "#71717a" }}>{l.k}</span>
                        <span style={{ fontSize: 12, fontWeight: 700, color: "#cbd5e1" }}>{l.v}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <p style={{ marginTop: 20, fontSize: 11, color: "#3f3f46", lineHeight: 1.6 }}>
              <strong style={{ color: "#52525b" }}>Comissões IB</strong>: valores reais calculados automaticamente no momento da execução de ordens (max(€1,25; 0,05% × valor da transação)). Acumulam-se na base de dados a cada ordem executada.{" "}
              <strong style={{ color: "#52525b" }}>Custódia + outros</strong>: estimativa baseada em 0,08%/ano (custódia IB + FX + taxas regulatórias).{" "}
              <strong style={{ color: "#52525b" }}>Margem</strong>: assume alavancagem média de ~{MARGIN_AVG_BORROW_PCT}% do AUM a {MARGIN_RATE_AA}%/ano; o valor real varia com a alavancagem diária.{" "}
              Plano e margem configuráveis em <code style={{ color: "#52525b" }}>backoffice_store.json</code>: campos <code style={{ color: "#52525b" }}>plan</code> e <code style={{ color: "#52525b" }}>marginEnabled</code>.
            </p>
          </>
        )}
      </BackofficeShell>
    </>
  );
}

export const getServerSideProps: GetServerSideProps = backofficeGetServerSideProps;
