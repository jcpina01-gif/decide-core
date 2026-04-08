import type { GetServerSideProps } from "next";
import type { CSSProperties } from "react";
import Head from "next/head";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import BackofficeShell from "../../components/backoffice/BackofficeShell";
import { backofficeGetServerSideProps } from "../../lib/backofficePageProps";

const panel: CSSProperties = {
  background: "rgba(24, 24, 27, 0.92)",
  border: "1px solid rgba(63, 63, 70, 0.75)",
  borderRadius: 16,
  padding: 20,
  marginBottom: 18,
};

const th: CSSProperties = {
  textAlign: "left",
  padding: "10px 12px",
  fontSize: 11,
  fontWeight: 800,
  color: "#a1a1aa",
  textTransform: "uppercase",
  borderBottom: "1px solid #3f3f46",
};

const td: CSSProperties = {
  padding: "12px",
  fontSize: 13,
  color: "#d4d4d8",
  borderBottom: "1px solid #27272a",
};

type Alert = { id: string; severity: string; code: string; message: string; clientId?: string };
type Drift = {
  clientId: string;
  windowLabel: string;
  modelReturnPct: number | null;
  accountReturnPct: number | null;
  gapPct: number | null;
  note: string;
};

export default function BackofficeMonitoringPage() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [drift, setDrift] = useState<Drift[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [ra, rd] = await Promise.all([
        fetch("/api/backoffice/alerts", { credentials: "same-origin" }),
        fetch("/api/backoffice/drift", { credentials: "same-origin" }),
      ]);
      const ja = (await ra.json()) as { ok?: boolean; alerts?: Alert[] };
      const jd = (await rd.json()) as { ok?: boolean; rows?: Drift[] };
      if (!ra.ok || !ja.ok) throw new Error("alerts");
      if (!rd.ok || !jd.ok) throw new Error("drift");
      setAlerts(Array.isArray(ja.alerts) ? ja.alerts : []);
      setDrift(Array.isArray(jd.rows) ? jd.rows : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro a carregar");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <>
      <Head>
        <title>Monitorização — Back-office Decide</title>
        <meta name="robots" content="noindex,nofollow" />
      </Head>
      <BackofficeShell
        active="monitoring"
        title="Monitorização"
        subtitle="Alertas derivados de ficheiros locais; drift requer séries históricas (placeholder)."
      >
        {error ? <p style={{ color: "#f87171" }}>{error}</p> : null}
        {loading ? <p style={{ color: "#a1a1aa", marginBottom: 16 }}>A carregar…</p> : null}

        <div style={panel}>
          <div style={{ fontSize: 15, fontWeight: 800, marginBottom: 12, color: "#fde68a" }}>Alertas</div>
          {alerts.length === 0 && !loading ? (
            <p style={{ color: "#71717a" }}>Nenhum alerta.</p>
          ) : (
            <ul style={{ margin: 0, paddingLeft: 18, color: "#d4d4d8", fontSize: 14, lineHeight: 1.65 }}>
              {alerts.map((a) => (
                <li key={a.id} style={{ marginBottom: 10 }}>
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 800,
                      color: a.severity === "error" ? "#f87171" : a.severity === "warning" ? "#fbbf24" : "#a1a1aa",
                    }}
                  >
                    {a.severity.toUpperCase()}
                  </span>{" "}
                  {a.code}: {a.message}
                  {a.clientId ? (
                    <>
                      {" "}
                      <Link href={`/backoffice/clients/${encodeURIComponent(a.clientId)}`} style={{ color: "#5eead4" }}>
                        {a.clientId}
                      </Link>
                    </>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div style={panel} id="drift">
          <div style={{ fontSize: 15, fontWeight: 800, marginBottom: 12, color: "#5eead4" }}>Drift modelo vs real</div>
          <div style={{ overflow: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 520 }}>
              <thead>
                <tr>
                  <th style={th}>Cliente</th>
                  <th style={th}>Janela</th>
                  <th style={th}>Modelo %</th>
                  <th style={th}>Conta %</th>
                  <th style={th}>Gap</th>
                </tr>
              </thead>
              <tbody>
                {drift.length === 0 && !loading ? (
                  <tr>
                    <td colSpan={5} style={{ ...td, color: "#52525b" }}>
                      Sem linhas.
                    </td>
                  </tr>
                ) : null}
                {drift.map((d) => (
                  <tr key={d.clientId}>
                    <td style={td}>
                      <Link href={`/backoffice/clients/${encodeURIComponent(d.clientId)}`} style={{ color: "#5eead4" }}>
                        {d.clientId}
                      </Link>
                    </td>
                    <td style={td}>{d.windowLabel}</td>
                    <td style={td}>{d.modelReturnPct == null ? "—" : `${d.modelReturnPct.toFixed(2)}%`}</td>
                    <td style={td}>{d.accountReturnPct == null ? "—" : `${d.accountReturnPct.toFixed(2)}%`}</td>
                    <td style={td}>{d.gapPct == null ? "—" : `${d.gapPct.toFixed(2)}%`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {drift[0]?.note ? (
            <p style={{ marginTop: 12, fontSize: 12, color: "#71717a" }}>{drift[0].note}</p>
          ) : null}
        </div>

        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          style={{
            padding: "10px 16px",
            borderRadius: 10,
            border: "1px solid #3f3f46",
            background: "#27272a",
            color: "#fff",
            fontWeight: 700,
            cursor: loading ? "wait" : "pointer",
          }}
        >
          Atualizar
        </button>
      </BackofficeShell>
    </>
  );
}

export const getServerSideProps = backofficeGetServerSideProps;
