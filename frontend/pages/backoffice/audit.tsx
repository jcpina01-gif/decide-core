import type { GetServerSideProps } from "next";
import type { CSSProperties } from "react";
import Head from "next/head";
import Link from "next/link";
import { useCallback, useState } from "react";
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

function btn(primary?: boolean): CSSProperties {
  return {
    padding: "12px 18px",
    borderRadius: 12,
    fontSize: 14,
    fontWeight: 800,
    cursor: "pointer",
    border: primary ? `1px solid ${DECIDE_DASHBOARD.accentSky}` : "1px solid #3f3f46",
    background: primary ? "rgba(45, 212, 191, 0.12)" : "#27272a",
    color: "#fff",
    marginRight: 10,
    marginBottom: 10,
  };
}

export default function BackofficeAuditPage() {
  const [clientId, setClientId] = useState("");
  const [exportBusy, setExportBusy] = useState(false);
  const [exportErr, setExportErr] = useState("");

  const downloadServerBundle = useCallback(async () => {
    const id = clientId.trim();
    if (!id) {
      setExportErr("Indique o ID do cliente.");
      return;
    }
    setExportBusy(true);
    setExportErr("");
    try {
      const r = await fetch(`/api/backoffice/clients/${encodeURIComponent(id)}/audit-export`, {
        credentials: "same-origin",
      });
      const j = (await r.json()) as Record<string, unknown>;
      if (!r.ok || !j.ok) throw new Error(String(j.error || `HTTP ${r.status}`));
      const blob = new Blob([JSON.stringify(j, null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      const ex = typeof j.exportedAt === "string" ? j.exportedAt.slice(0, 10) : "export";
      a.download = `decide-audit-bundle-${id}-${ex}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      setExportErr(e instanceof Error ? e.message : "Falha no export");
    } finally {
      setExportBusy(false);
    }
  }, [clientId]);

  const downloadPlaceholderJson = useCallback(() => {
    const id = clientId.trim() || "CLIENT_ID";
    const payload = {
      exportedAt: new Date().toISOString(),
      clientId: id,
      note: "Estrutura vazia (sem chamada à API)",
      recommendations: [] as unknown[],
      approvals: [] as unknown[],
      orders: [] as unknown[],
      executions: [] as unknown[],
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `decide-audit-${id}-${payload.exportedAt.slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }, [clientId]);

  return (
    <>
      <Head>
        <title>Auditoria — Back-office Decide</title>
        <meta name="robots" content="noindex,nofollow" />
      </Head>
      <BackofficeShell
        active="audit"
        title="Auditoria"
        subtitle="Export JSON agrega cliente, recomendações (CSV), timeline, ordens e registos a partir de tmp_diag."
      >
        <div style={panel}>
          <label style={{ display: "block", fontSize: 13, color: "#a1a1aa", marginBottom: 8 }}>
            ID do cliente (obrigatório para export do servidor; usar demo-user para demo)
          </label>
          <input
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            placeholder="ex. jcpina01 ou UUID interno"
            style={{
              width: "100%",
              maxWidth: 400,
              padding: "12px 14px",
              borderRadius: 12,
              border: "1px solid #3f3f46",
              background: "#0a0a0a",
              color: "#fff",
              fontSize: 15,
              marginBottom: 16,
            }}
          />
          {exportErr ? <p style={{ color: "#f87171", marginBottom: 12 }}>{exportErr}</p> : null}
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center" }}>
            <button type="button" style={btn(true)} onClick={() => void downloadServerBundle()} disabled={exportBusy}>
              {exportBusy ? "A exportar…" : "Exportar JSON (servidor)"}
            </button>
            <button type="button" style={btn()} onClick={downloadPlaceholderJson} disabled={exportBusy}>
              JSON vazio (offline)
            </button>
            <button type="button" style={btn()} disabled title="Gerar PDF no servidor (a implementar)">
              Exportar PDF
            </button>
          </div>
          <p style={{ margin: "14px 0 0", fontSize: 12, color: "#52525b", lineHeight: 1.5 }}>
            O bundle do servidor reflecte o estado actual dos ficheiros em <code style={{ color: "#71717a" }}>tmp_diag</code>.
            Para auditoria regulatória completa, persistir snapshots imutáveis no backend quando o cliente aprovar /
            executar.
          </p>
        </div>

        <div style={panel}>
          <div style={{ fontSize: 15, fontWeight: 800, marginBottom: 8 }}>Referência regulatória</div>
          <p style={{ margin: "0 0 12px", fontSize: 14, color: "#a1a1aa", lineHeight: 1.55 }}>
            Lista de campos obrigatórios e recomendados para MiFID / advisory.
          </p>
          <Link
            href="/backoffice/audit-logs"
            style={{ color: DECIDE_DASHBOARD.accentSky, fontSize: 14, fontWeight: 700 }}
          >
            Abrir guia de logs para auditorias →
          </Link>
        </div>
      </BackofficeShell>
    </>
  );
}

export const getServerSideProps = backofficeGetServerSideProps;
