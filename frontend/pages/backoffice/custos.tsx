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

type CostRow = {
  client: BackofficeClientSummary;
  plan: "premium" | "private";
  aum: number;
  mgmtAnnual: number;
  mgmtPct: number;
  externAnnual: number;
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
  const totalAnnual = mgmtAnnual + externAnnual;
  const totalPct = aum > 0 ? (totalAnnual / aum) * 100 : 0;

  const mgmtYtd =
    plan === "private"
      ? mgmtAnnual * (ytdMonths / 12)
      : DECIDE_MONTHLY_PREMIUM * ytdMonths;
  const externYtd = externAnnual * (ytdMonths / 12);
  const ytdEstimate = mgmtYtd + externYtd;

  return {
    client,
    plan,
    aum,
    mgmtAnnual,
    mgmtPct,
    externAnnual,
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

export default function BackofficeCustosPage() {
  const [clients, setClients] = useState<BackofficeClientSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
  }, []);

  const rows = clients.map((c) => computeCosts(c, ytdMonths));

  const totalAum = rows.reduce((s, r) => s + r.aum, 0);
  const totalMgmt = rows.reduce((s, r) => s + r.mgmtAnnual, 0);
  const totalExtern = rows.reduce((s, r) => s + r.externAnnual, 0);
  const totalCost = rows.reduce((s, r) => s + r.totalAnnual, 0);
  const totalYtd = rows.reduce((s, r) => s + r.ytdEstimate, 0);

  return (
    <>
      <Head>
        <title>Custos de clientes — Back-office Decide</title>
        <meta name="robots" content="noindex,nofollow" />
      </Head>
      <BackofficeShell
        active="custos"
        title="Custos por cliente"
        subtitle="Estimativa de encargos anuais e YTD por cliente. Baseado no NAV IB e plano atribuído (Premium €29/mês | Private 0,6%/ano). Custos externos: 0,12%/ano (custódia + transações + FX)."
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
                { label: "Custos externos (ano)", value: `€ ${fmtEur(totalExtern)}`, sub: `${fmtPct(EXTERN_PCT)} do AUM total`, color: "#94a3b8" },
                { label: "Total encargos (ano)", value: `€ ${fmtEur(totalCost)}`, sub: "gestão + externos", color: "#fb923c" },
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
                  valores anuais estimados · plano auto-detetado pelo NAV se não configurado
                </span>
              </div>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 900 }}>
                  <thead>
                    <tr style={{ background: "rgba(0,0,0,0.3)" }}>
                      {[
                        "Cliente", "Plano", "AUM (€)", "Gestão DECIDE", "Custos externos", "Total encargos", "% total do AUM", "YTD estimado",
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

                          {/* Custos externos */}
                          <td style={{ padding: "14px 16px", fontVariantNumeric: "tabular-nums" }}>
                            {r.aum > 0 ? (
                              <>
                                <div style={{ fontSize: 14, fontWeight: 700, color: "#94a3b8" }}>
                                  € {fmtEur(r.externAnnual)}
                                  <span style={{ fontSize: 10, fontWeight: 400, color: "#52525b", marginLeft: 4 }}>
                                    /ano
                                  </span>
                                </div>
                                <div style={{ fontSize: 10, color: "#52525b", marginTop: 2 }}>
                                  {fmtPct(EXTERN_PCT)}/ano (broker)
                                </div>
                              </>
                            ) : (
                              <span style={{ color: "#52525b" }}>—</span>
                            )}
                          </td>

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
                        <td style={{ padding: "12px 16px", fontSize: 14, fontWeight: 900, color: "#94a3b8" }}>
                          € {fmtEur(totalExtern)}
                        </td>
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
                    { k: "Custódia (IB)", v: "≈ 0,06% / ano" },
                    { k: "Comissões negociação", v: "≈ 0,04% / ano" },
                    { k: "Câmbio (FX spread)", v: "≈ 0,01% / ano" },
                    { k: "Taxas regulatórias", v: "≈ 0,01% / ano" },
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
              Valores estimados com base no NAV IBKR atual. Custos externos são estimativas médias — o valor real depende do número de transações, câmbios efectuados e taxas regulatórias variáveis. O plano é auto-detetado pelo NAV se não configurado em <code style={{ color: "#52525b" }}>backoffice_store.json</code>.
            </p>
          </>
        )}
      </BackofficeShell>
    </>
  );
}

export const getServerSideProps: GetServerSideProps = backofficeGetServerSideProps;
