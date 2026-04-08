import type { GetServerSideProps } from "next";
import type { CSSProperties } from "react";
import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import { useCallback, useEffect, useState } from "react";
import BackofficeShell from "../../../components/backoffice/BackofficeShell";
import { DECIDE_DASHBOARD } from "../../../lib/decideClientTheme";
import { backofficeGetServerSideProps } from "../../../lib/backofficePageProps";
import type {
  BackofficeClientSummary,
  LogRow,
  OrderRow,
  RecommendationSnapshot,
  TimelineEvent,
} from "../../../lib/server/backofficeData";

type TabId = "overview" | "timeline" | "recommendations" | "orders" | "logs";

const TABS: { id: TabId; label: string }[] = [
  { id: "overview", label: "Visão geral" },
  { id: "timeline", label: "Timeline" },
  { id: "recommendations", label: "Recomendações" },
  { id: "orders", label: "Ordens" },
  { id: "logs", label: "Registos" },
];

const panel: CSSProperties = {
  background: "rgba(24, 24, 27, 0.92)",
  border: "1px solid rgba(63, 63, 70, 0.75)",
  borderRadius: 16,
  padding: 20,
  marginTop: 16,
};

export default function BackofficeClientDetailPage() {
  const router = useRouter();
  const clientIdRaw = router.query.clientId;
  const clientId = typeof clientIdRaw === "string" ? clientIdRaw : "";
  const tabRaw = typeof router.query.tab === "string" ? router.query.tab : "overview";
  const tab = TABS.some((t) => t.id === tabRaw) ? (tabRaw as TabId) : "overview";

  const [detail, setDetail] = useState<BackofficeClientSummary | null>(null);
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const [recommendations, setRecommendations] = useState<RecommendationSnapshot[]>([]);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);

  function setTab(id: TabId) {
    void router.replace({ pathname: router.pathname, query: { ...router.query, tab: id } }, undefined, {
      shallow: true,
    });
  }

  const basePath = clientId ? `/api/backoffice/clients/${encodeURIComponent(clientId)}` : "";

  const loadAll = useCallback(async () => {
    if (!clientId) return;
    setLoading(true);
    setErr("");
    try {
      const [r0, r1, r2, r3, r4] = await Promise.all([
        fetch(`${basePath}`, { credentials: "same-origin" }),
        fetch(`${basePath}/timeline`, { credentials: "same-origin" }),
        fetch(`${basePath}/recommendations`, { credentials: "same-origin" }),
        fetch(`${basePath}/orders`, { credentials: "same-origin" }),
        fetch(`${basePath}/logs`, { credentials: "same-origin" }),
      ]);
      const j0 = (await r0.json()) as { ok?: boolean; client?: BackofficeClientSummary };
      if (!r0.ok || !j0.ok || !j0.client) throw new Error("Cliente não encontrado");
      setDetail(j0.client);
      const j1 = (await r1.json()) as { events?: TimelineEvent[] };
      setTimeline(Array.isArray(j1.events) ? j1.events : []);
      const j2 = (await r2.json()) as { recommendations?: RecommendationSnapshot[] };
      setRecommendations(Array.isArray(j2.recommendations) ? j2.recommendations : []);
      const j3 = (await r3.json()) as { orders?: OrderRow[] };
      setOrders(Array.isArray(j3.orders) ? j3.orders : []);
      const j4 = (await r4.json()) as { logs?: LogRow[] };
      setLogs(Array.isArray(j4.logs) ? j4.logs : []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Erro");
      setDetail(null);
    } finally {
      setLoading(false);
    }
  }, [basePath, clientId]);

  useEffect(() => {
    if (!router.isReady || !clientId) return;
    void loadAll();
  }, [router.isReady, clientId, loadAll]);

  return (
    <>
      <Head>
        <title>{clientId || "Cliente"} — Back-office Decide</title>
        <meta name="robots" content="noindex,nofollow" />
      </Head>
      <BackofficeShell
        active="clients"
        title={`Cliente · ${clientId || "…"}`}
        subtitle="Dados agregados a partir de tmp_diag e backoffice_store.json."
      >
        <p style={{ margin: "0 0 8px", fontSize: 13 }}>
          <Link href="/backoffice/clients" style={{ color: "#a1a1aa" }}>
            ← Todos os clientes
          </Link>
        </p>

        {err ? <p style={{ color: "#f87171" }}>{err}</p> : null}
        {loading ? <p style={{ color: "#a1a1aa" }}>A carregar…</p> : null}

        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {TABS.map((t) => {
            const on = t.id === tab;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                style={{
                  padding: "8px 14px",
                  borderRadius: 10,
                  fontSize: 13,
                  fontWeight: on ? 800 : 600,
                  cursor: "pointer",
                  color: on ? "#fff" : "#a1a1aa",
                  background: on ? "rgba(45, 212, 191, 0.15)" : "rgba(39, 39, 42, 0.6)",
                  border: on ? `1px solid ${DECIDE_DASHBOARD.accentSky}` : "1px solid #3f3f46",
                }}
              >
                {t.label}
              </button>
            );
          })}
        </div>

        {tab === "overview" && detail ? (
          <div style={panel}>
            <ul style={{ margin: 0, paddingLeft: 20, color: "#d4d4d8", fontSize: 14, lineHeight: 1.8 }}>
              <li>ID: {detail.clientId}</li>
              <li>Conta IB: {detail.accountCode ?? "—"}</li>
              <li>Onboarding: {detail.onboardingStatus}</li>
              <li>MiFID: {detail.mifidStatus}</li>
              <li>Perfil: {detail.riskProfile ?? "—"}</li>
              <li>
                NAV: {detail.navIbkr != null ? `${detail.navIbkr} ${detail.navCurrency}` : "—"}
              </li>
              <li>Linhas plano CSV: {detail.tradePlanRowCount}</li>
              <li>Aprovação registada: {detail.planApprovedAt ?? "—"}</li>
            </ul>
            <p style={{ marginTop: 14, fontSize: 12, color: "#52525b" }}>
              Fontes: {detail.dataSources.join(", ")}
            </p>
          </div>
        ) : null}

        {tab === "timeline" ? (
          <div style={panel}>
            {timeline.length === 0 ? (
              <p style={{ color: "#71717a" }}>Sem eventos.</p>
            ) : (
              <ul style={{ margin: 0, paddingLeft: 0, listStyle: "none" }}>
                {timeline.map((e) => (
                  <li
                    key={e.id}
                    style={{
                      borderLeft: "2px solid #3f3f46",
                      paddingLeft: 14,
                      marginBottom: 14,
                      fontSize: 14,
                      color: "#e4e4e7",
                    }}
                  >
                    <div style={{ fontSize: 12, color: "#71717a" }}>{e.ts}</div>
                    <div style={{ fontWeight: 700 }}>{e.label}</div>
                    {e.detail ? <div style={{ color: "#a1a1aa", marginTop: 4 }}>{e.detail}</div> : null}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : null}

        {tab === "recommendations" ? (
          <div style={panel}>
            {recommendations.length === 0 ? (
              <p style={{ color: "#71717a" }}>Sem snapshots.</p>
            ) : (
              recommendations.map((rec) => (
                <div key={rec.id} style={{ marginBottom: 20 }}>
                  <div style={{ fontSize: 12, color: "#71717a" }}>{rec.generatedAt}</div>
                  <div style={{ fontWeight: 800 }}>{rec.source}</div>
                  {rec.modelHint ? <div style={{ color: "#a1a1aa", fontSize: 13 }}>{rec.modelHint}</div> : null}
                  <pre
                    style={{
                      marginTop: 10,
                      padding: 12,
                      background: "#0a0a0a",
                      borderRadius: 10,
                      fontSize: 11,
                      overflow: "auto",
                      color: "#a1a1aa",
                    }}
                  >
                    {JSON.stringify(rec.positions.slice(0, 40), null, 2)}
                    {rec.positions.length > 40 ? "\n…" : ""}
                  </pre>
                </div>
              ))
            )}
          </div>
        ) : null}

        {tab === "orders" ? (
          <div style={panel}>
            {orders.length === 0 ? (
              <p style={{ color: "#71717a" }}>Sem ordens.</p>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ color: "#a1a1aa", textAlign: "left" }}>
                    <th style={{ padding: 8 }}>Ticker</th>
                    <th style={{ padding: 8 }}>Lado</th>
                    <th style={{ padding: 8 }}>Qty</th>
                    <th style={{ padding: 8 }}>Estado</th>
                    <th style={{ padding: 8 }}>Fonte</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map((o, i) => (
                    <tr key={`${o.ticker}-${i}`} style={{ borderTop: "1px solid #27272a" }}>
                      <td style={{ padding: 8 }}>{o.ticker}</td>
                      <td style={{ padding: 8 }}>{o.side ?? "—"}</td>
                      <td style={{ padding: 8 }}>{o.qty ?? "—"}</td>
                      <td style={{ padding: 8 }}>{o.status ?? "—"}</td>
                      <td style={{ padding: 8, color: "#71717a" }}>{o.source}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        ) : null}

        {tab === "logs" ? (
          <div style={panel}>
            {logs.length === 0 ? (
              <p style={{ color: "#71717a" }}>Sem registos (opcional: tmp_diag/backoffice_events.jsonl).</p>
            ) : (
              <ul style={{ margin: 0, paddingLeft: 0, listStyle: "none", fontSize: 13 }}>
                {logs.map((l) => (
                  <li key={l.id} style={{ marginBottom: 12, color: "#d4d4d8" }}>
                    <span style={{ color: "#71717a" }}>{l.ts}</span> [{l.level}] {l.source}: {l.message}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : null}

        {!loading && detail ? (
          <button
            type="button"
            onClick={() => void loadAll()}
            style={{
              marginTop: 16,
              padding: "10px 16px",
              borderRadius: 10,
              border: "1px solid #3f3f46",
              background: "#27272a",
              color: "#fff",
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            Atualizar
          </button>
        ) : null}
      </BackofficeShell>
    </>
  );
}

export const getServerSideProps = backofficeGetServerSideProps;
