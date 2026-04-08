import type { GetServerSideProps } from "next";
import type { CSSProperties } from "react";
import Head from "next/head";
import BackofficeShell from "../../components/backoffice/BackofficeShell";
import { backofficeKpiDiagnosticsPageUrl, resolveKpiEmbedBaseForBackoffice } from "../../lib/backofficeKpiBase";
import { isBackofficeEnabled } from "../../lib/backofficeGate";

const panel: CSSProperties = {
  background: "rgba(24, 24, 27, 0.92)",
  border: "1px solid rgba(63, 63, 70, 0.75)",
  borderRadius: 16,
  padding: 16,
  marginBottom: 16,
};

type Props = { kpiBase: string };

export default function BackofficeKpiDiagnosticsPage({ kpiBase }: Props) {
  const src = kpiBase ? backofficeKpiDiagnosticsPageUrl(kpiBase) : "";

  return (
    <>
      <Head>
        <title>Diagnóstico KPI — Back-office Decide</title>
        <meta name="robots" content="noindex,nofollow" />
      </Head>
      <BackofficeShell
        active="kpi-diagnostics"
        title="Diagnóstico KPI (Flask)"
        subtitle="Separador «Diagnóstico (rolling)» do serviço de KPIs — gráficos e métricas técnicas. O Flask tem de estar a correr."
      >
        {!kpiBase ? (
          <div style={panel}>
            <p style={{ margin: 0, color: "#a1a1aa", fontSize: 14, lineHeight: 1.6 }}>
              Não há URL do KPI configurada. Define <code style={{ color: "#a5b4fc" }}>NEXT_PUBLIC_KPI_EMBED_BASE</code>{" "}
              (ex. <code style={{ color: "#a5b4fc" }}>http://127.0.0.1:5000</code>) ou corre o frontend em{" "}
              <code style={{ color: "#a5b4fc" }}>development</code> com <code style={{ color: "#a5b4fc" }}>npm run kpi</code>{" "}
              na raiz do repo.
            </p>
          </div>
        ) : (
          <>
            <div style={panel}>
              <p style={{ margin: 0, color: "#a1a1aa", fontSize: 13, lineHeight: 1.55 }}>
                Origem: <code style={{ color: "#d4d4d8" }}>{kpiBase}</code> ·{" "}
                <a href={src} target="_blank" rel="noopener noreferrer" style={{ color: "#93c5fd" }}>
                  Abrir num separador
                </a>
              </p>
            </div>
            <div
              style={{
                borderRadius: 16,
                overflow: "hidden",
                border: "1px solid rgba(63, 63, 70, 0.75)",
                background: "#0c0c0e",
                minHeight: "min(85vh, 920px)",
              }}
            >
              <iframe
                title="Diagnóstico KPI Decide"
                src={src}
                style={{ width: "100%", height: "min(85vh, 920px)", border: "none", display: "block" }}
                sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
              />
            </div>
          </>
        )}
      </BackofficeShell>
    </>
  );
}

export const getServerSideProps: GetServerSideProps<Props> = async () => {
  if (!isBackofficeEnabled()) return { notFound: true };
  return { props: { kpiBase: resolveKpiEmbedBaseForBackoffice() } };
};
