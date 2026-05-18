import type { GetServerSideProps } from "next";
import type { CSSProperties } from "react";
import Head from "next/head";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import BackofficeShell from "../../components/backoffice/BackofficeShell";
import { DECIDE_DASHBOARD } from "../../lib/decideClientTheme";
import { backofficeGetServerSideProps } from "../../lib/backofficePageProps";

const panel: CSSProperties = {
  background: "rgba(24, 24, 27, 0.92)",
  border: "1px solid rgba(63, 63, 70, 0.75)",
  borderRadius: 16,
  padding: 22,
  marginBottom: 18,
};

const TABLE_LABELS: Record<string, string> = {
  recommendations: "Recomendações",
  approvals: "Aprovações",
  orders: "Ordens",
  executions: "Execuções",
  funding: "Funding",
  config: "Config. alterações",
};

const TABLE_KEYS = Object.keys(TABLE_LABELS);

function btn(primary?: boolean, danger?: boolean): CSSProperties {
  return {
    padding: "10px 16px",
    borderRadius: 10,
    fontSize: 13,
    fontWeight: 700,
    cursor: "pointer",
    border: danger
      ? "1px solid #7f1d1d"
      : primary
        ? `1px solid ${DECIDE_DASHBOARD.accentSky}`
        : "1px solid #3f3f46",
    background: danger ? "#450a0a" : primary ? "rgba(45, 212, 191, 0.12)" : "#27272a",
    color: danger ? "#fca5a5" : "#fff",
    marginRight: 8,
    marginBottom: 8,
  };
}

type AuditRow = Record<string, unknown>;

export default function BackofficeAuditPage() {
  const [clientId, setClientId] = useState("jcpina01");
  const [activeTable, setActiveTable] = useState("recommendations");
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [exportBusy, setExportBusy] = useState(false);
  const [migrating, setMigrating] = useState(false);
  const [migrateMsg, setMigrateMsg] = useState("");

  const loadRows = useCallback(async (cid: string, table: string) => {
    if (!cid.trim()) return;
    setLoading(true);
    setError("");
    setRows([]);
    try {
      const r = await fetch(
        `/api/backoffice/audit-db?clientId=${encodeURIComponent(cid)}&table=${table}&limit=100`,
        { credentials: "same-origin" },
      );
      const j = (await r.json()) as { ok?: boolean; rows?: AuditRow[]; error?: string };
      if (!r.ok || !j.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      setRows(Array.isArray(j.rows) ? j.rows : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao carregar");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadRows(clientId, activeTable);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTable]);

  const handleSearch = () => void loadRows(clientId, activeTable);

  const runMigration = async () => {
    setMigrating(true);
    setMigrateMsg("");
    try {
      const r = await fetch("/api/backoffice/db-migrate", {
        method: "POST", credentials: "same-origin",
      });
      const j = (await r.json()) as { ok?: boolean; message?: string; error?: string };
      setMigrateMsg(j.ok ? `✓ ${j.message ?? "OK"}` : `✗ ${j.error ?? "Erro"}`);
    } catch (e) {
      setMigrateMsg("Erro: " + (e instanceof Error ? e.message : "falha"));
    } finally {
      setMigrating(false);
    }
  };

  const [testMsg, setTestMsg] = useState("");
  const runDbTest = async () => {
    setTestMsg("A testar…");
    try {
      const r = await fetch("/api/backoffice/audit-test", {
        method: "POST", credentials: "same-origin",
      });
      const j = await r.json() as Record<string, unknown>;
      setTestMsg(j.ok
        ? `✓ ${String(j.message)} | DATABASE_URL=${String(j.env && (j.env as Record<string,unknown>).DATABASE_URL_set)}`
        : `✗ ${String(j.error)} | DATABASE_URL=${String(j.env && (j.env as Record<string,unknown>).DATABASE_URL_set)}`);
    } catch (e) {
      setTestMsg("Erro de rede: " + (e instanceof Error ? e.message : "falha"));
    }
  };

  const [syncIbMsg, setSyncIbMsg] = useState("");
  const [syncing, setSyncing] = useState(false);
  const runSyncIb = async () => {
    setSyncing(true);
    setSyncIbMsg("A ligar à IB e buscar execuções…");
    try {
      const r = await fetch(
        `/api/backoffice/sync-ib-executions?clientId=${encodeURIComponent(clientId || "jcpina01")}`,
        { method: "POST", credentials: "same-origin" },
      );
      const j = await r.json() as { ok?: boolean; saved?: number; skipped?: number; total?: number; message?: string; error?: string };
      if (j.ok) {
        setSyncIbMsg(`✓ ${j.saved ?? 0} execuções guardadas · ${j.skipped ?? 0} ignoradas (duplicados) · total IB: ${j.total ?? 0}${j.message ? " · " + j.message : ""}`);
        if ((j.saved ?? 0) > 0) void loadRows(clientId || "jcpina01", "executions");
      } else {
        setSyncIbMsg(`✗ ${j.error ?? "Erro desconhecido"}`);
      }
    } catch (e) {
      setSyncIbMsg("Erro de rede: " + (e instanceof Error ? e.message : "falha"));
    } finally {
      setSyncing(false);
    }
  };

  const [writeTestMsg, setWriteTestMsg] = useState("");
  const runWriteTest = async () => {
    setWriteTestMsg("A escrever…");
    try {
      // 1. Write an approval
      const ar = await fetch("/api/audit/approval", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client_id: clientId || "jcpina01", action: "approved", recommendation_id: null }),
      });
      const aj = await ar.json() as { ok?: boolean; id?: string; error?: string };
      if (!ar.ok || !aj.ok) {
        setWriteTestMsg(`✗ approval falhou HTTP ${ar.status}: ${aj.error ?? "?"}`);
        return;
      }
      // 2. Write an order
      const or2 = await fetch("/api/audit/order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: clientId || "jcpina01",
          approval_id: aj.id,
          ticker: "TEST",
          side: "BUY",
          qty: 1,
          status: "submitted",
          submitted_at: new Date().toISOString(),
        }),
      });
      const oj = await or2.json() as { ok?: boolean; id?: string; error?: string };
      if (!or2.ok || !oj.ok) {
        setWriteTestMsg(`✗ order falhou HTTP ${or2.status}: ${oj.error ?? "?"}`);
        return;
      }
      // 3. Write a test execution
      const er = await fetch("/api/audit/execution", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: clientId || "jcpina01",
          order_id: oj.id,
          ticker: "TEST",
          side: "BUY",
          qty_filled: 1,
          price_executed: 100,
          commission: 1.25,
          executed_at: new Date().toISOString(),
        }),
      });
      const ej = await er.json() as { ok?: boolean; id?: string; error?: string };
      const execStatus = er.ok && ej.ok ? `exec=${ej.id?.slice(0,8)}` : `exec falhou: ${ej.error ?? "?"}`;
      setWriteTestMsg(`✓ approval=${aj.id?.slice(0,8)} order=${oj.id?.slice(0,8)} ${execStatus}`);
      // Auto-reload executions
      void loadRows(clientId || "jcpina01", "executions");
      setActiveTable("executions");
    } catch (e) {
      setWriteTestMsg("Erro de rede: " + (e instanceof Error ? e.message : "falha"));
    }
  };

  const downloadBundle = useCallback(async () => {
    const id = clientId.trim();
    if (!id) return;
    setExportBusy(true);
    try {
      const tables = await Promise.all(
        TABLE_KEYS.map(async (t) => {
          const r = await fetch(
            `/api/backoffice/audit-db?clientId=${encodeURIComponent(id)}&table=${t}&limit=1000`,
            { credentials: "same-origin" },
          );
          const j = (await r.json()) as { ok?: boolean; rows?: AuditRow[] };
          return { table: t, rows: j.rows ?? [] };
        }),
      );
      const bundle: Record<string, unknown> = {
        exportedAt: new Date().toISOString(),
        clientId: id,
        source: "neon_postgres",
      };
      for (const { table, rows: r } of tables) bundle[table] = r;
      const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `decide-audit-${id}-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export falhou");
    } finally {
      setExportBusy(false);
    }
  }, [clientId]);

  const colKeys = rows.length > 0 ? Object.keys(rows[0]!) : [];

  return (
    <>
      <Head>
        <title>Auditoria — Back-office Decide</title>
        <meta name="robots" content="noindex,nofollow" />
      </Head>
      <BackofficeShell
        active="audit"
        title="Auditoria"
        subtitle="Logs imutáveis em Neon Postgres — recomendações, aprovações, ordens, execuções, funding, alterações de config."
      >
        {/* Search + table selector */}
        <div style={panel}>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 16 }}>
            <div>
              <label style={{ display: "block", fontSize: 12, color: "#71717a", marginBottom: 6 }}>
                ID do cliente
              </label>
              <input
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                placeholder="ex. jcpina01"
                style={{
                  padding: "10px 14px", borderRadius: 10, border: "1px solid #3f3f46",
                  background: "#0a0a0a", color: "#fff", fontSize: 14, width: 260,
                }}
              />
            </div>
            <button style={btn(true)} onClick={handleSearch} disabled={loading}>
              {loading ? "A carregar…" : "Pesquisar"}
            </button>
            <button style={btn()} onClick={() => void downloadBundle()} disabled={exportBusy || loading}>
              {exportBusy ? "A exportar…" : "Exportar JSON completo"}
            </button>
          </div>

          {/* Table tabs */}
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 16 }}>
            {TABLE_KEYS.map((t) => (
              <button
                key={t}
                style={{
                  padding: "6px 14px", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer",
                  border: activeTable === t ? `1px solid ${DECIDE_DASHBOARD.accentSky}` : "1px solid #3f3f46",
                  background: activeTable === t ? "rgba(45,212,191,0.12)" : "#18181b",
                  color: activeTable === t ? DECIDE_DASHBOARD.accentSky : "#a1a1aa",
                }}
                onClick={() => { setActiveTable(t); void loadRows(clientId, t); }}
              >
                {TABLE_LABELS[t]}
              </button>
            ))}
          </div>

          {error && <p style={{ color: "#f87171", marginBottom: 12, fontSize: 13 }}>{error}</p>}

          {/* Results table */}
          {loading ? (
            <div style={{ color: "#52525b", padding: "24px 0", textAlign: "center", fontSize: 14 }}>A carregar…</div>
          ) : rows.length === 0 ? (
            <div style={{ color: "#52525b", padding: "24px 0", textAlign: "center", fontSize: 14 }}>
              Sem registos para este cliente nesta tabela.
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    {colKeys.map((k) => (
                      <th
                        key={k}
                        style={{
                          textAlign: "left", padding: "6px 10px", color: "#71717a",
                          fontWeight: 700, borderBottom: "1px solid #27272a", whiteSpace: "nowrap",
                        }}
                      >
                        {k}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, i) => (
                    <tr key={i} style={{ borderBottom: "1px solid #18181b" }}>
                      {colKeys.map((k) => {
                        const v = row[k];
                        const s = v === null || v === undefined
                          ? "—"
                          : typeof v === "object"
                            ? JSON.stringify(v).slice(0, 60) + (JSON.stringify(v).length > 60 ? "…" : "")
                            : String(v).slice(0, 80) + (String(v).length > 80 ? "…" : "");
                        return (
                          <td
                            key={k}
                            style={{ padding: "6px 10px", color: v === null ? "#3f3f46" : "#e4e4e7", verticalAlign: "top" }}
                            title={typeof v === "string" ? v : undefined}
                          >
                            {s}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
              <div style={{ fontSize: 11, color: "#52525b", marginTop: 10 }}>
                {rows.length} registo(s) mostrado(s)
              </div>
            </div>
          )}
        </div>

        {/* Utilities */}
        <div style={panel}>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>Utilitários</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <button style={btn()} onClick={() => void runMigration()} disabled={migrating}>
              {migrating ? "A executar…" : "Executar migrações DB"}
            </button>
            <button style={btn(true)} onClick={() => void runDbTest()}>
              Testar ligação DB
            </button>
            <button style={btn(false)} onClick={() => void runWriteTest()}>
              Testar escrita audit
            </button>
            <button
              style={{ ...btn(true), background: "rgba(52,211,153,0.1)", border: "1px solid rgba(52,211,153,0.3)", color: "#34d399" }}
              onClick={() => void runSyncIb()}
              disabled={syncing}
            >
              {syncing ? "A sincronizar…" : "↻ Sincronizar execuções IB"}
            </button>
            <Link
              href="/backoffice/audit-logs"
              style={{ color: DECIDE_DASHBOARD.accentSky, fontSize: 13, fontWeight: 600 }}
            >
              Guia de logs MiFID →
            </Link>
          </div>
          {migrateMsg && (
            <p style={{ marginTop: 10, fontSize: 13, color: migrateMsg.startsWith("✓") ? "#4ade80" : "#f87171" }}>
              {migrateMsg}
            </p>
          )}
          {testMsg && (
            <p style={{ marginTop: 10, fontSize: 12, color: testMsg.startsWith("✓") ? "#4ade80" : "#f87171", fontFamily: "monospace", wordBreak: "break-all" }}>
              {testMsg}
            </p>
          )}
          {syncIbMsg && (
            <p style={{ marginTop: 8, fontSize: 12, color: syncIbMsg.startsWith("✓") ? "#34d399" : "#f87171", fontFamily: "monospace", wordBreak: "break-all" }}>
              {syncIbMsg}
            </p>
          )}
          {writeTestMsg && (
            <p style={{ marginTop: 6, fontSize: 12, color: writeTestMsg.startsWith("✓") ? "#4ade80" : "#f87171", fontFamily: "monospace", wordBreak: "break-all" }}>
              {writeTestMsg}
            </p>
          )}
          <p style={{ marginTop: 12, fontSize: 11, color: "#3f3f46", lineHeight: 1.5 }}>
            As tabelas são criadas automaticamente na primeira migração. Corre uma vez após deploy inicial.
          </p>
        </div>
      </BackofficeShell>
    </>
  );
}

export const getServerSideProps: GetServerSideProps = backofficeGetServerSideProps;
