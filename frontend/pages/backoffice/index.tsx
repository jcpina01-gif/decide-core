import type { GetServerSideProps } from "next";
import type { CSSProperties } from "react";
import Head from "next/head";
import Link from "next/link";
import BackofficeShell from "../../components/backoffice/BackofficeShell";
import { DECIDE_DASHBOARD } from "../../lib/decideClientTheme";
import { backofficeGetServerSideProps } from "../../lib/backofficePageProps";

const card: CSSProperties = {
  background: "rgba(24, 24, 27, 0.92)",
  border: "1px solid rgba(63, 63, 70, 0.75)",
  borderRadius: 16,
  padding: 18,
};

export default function BackofficeDashboardPage() {
  return (
    <>
      <Head>
        <title>Painel — Back-office Decide</title>
        <meta name="robots" content="noindex,nofollow" />
      </Head>
      <BackofficeShell
        active="dashboard"
        title="Painel operacional"
        subtitle="Controlo e auditabilidade. Os dados abaixo são placeholders até ligação à API / base de dados."
      >
        <div
          style={{
            ...card,
            borderColor: "rgba(45, 212, 191, 0.35)",
            background: "rgba(6, 78, 59, 0.12)",
            marginBottom: 22,
          }}
        >
          <div style={{ fontSize: 12, fontWeight: 800, color: "#5eead4", marginBottom: 8 }}>Pergunta-chave (10 s)</div>
          <p style={{ margin: 0, fontSize: 15, lineHeight: 1.6, color: "#e4e4e7" }}>
            «O cliente X já aprovou? Já executou? Está investido?» —{" "}
            <Link href="/backoffice/clients" style={{ color: DECIDE_DASHBOARD.accentSky }}>
              ver clientes
            </Link>
          </p>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
            gap: 14,
            marginBottom: 22,
          }}
        >
          <Link href="/backoffice/clients" style={{ ...card, textDecoration: "none", color: "inherit" }}>
            <div style={{ color: DECIDE_DASHBOARD.accentSky, fontSize: 11, fontWeight: 800 }}>1</div>
            <div style={{ fontSize: 16, fontWeight: 800, margin: "6px 0" }}>Gestão de clientes</div>
            <p style={{ margin: 0, fontSize: 13, color: "#a1a1aa", lineHeight: 1.5 }}>
              Lista, estado (onboarding, MiFID, activo), perfil, NAV IB, última recomendação.
            </p>
          </Link>
          <Link href="/backoffice/activity" style={{ ...card, textDecoration: "none", color: "inherit" }}>
            <div style={{ color: DECIDE_DASHBOARD.accentSky, fontSize: 11, fontWeight: 800 }}>2</div>
            <div style={{ fontSize: 16, fontWeight: 800, margin: "6px 0" }}>Timeline</div>
            <p style={{ margin: 0, fontSize: 13, color: "#a1a1aa", lineHeight: 1.5 }}>
              Por cliente: onboarding, perfil, recomendação, aprovação, ordens, execução.
            </p>
          </Link>
          <Link href="/backoffice/monitoring" style={{ ...card, textDecoration: "none", color: "inherit" }}>
            <div style={{ color: DECIDE_DASHBOARD.accentSky, fontSize: 11, fontWeight: 800 }}>3</div>
            <div style={{ fontSize: 16, fontWeight: 800, margin: "6px 0" }}>Monitor de problemas</div>
            <p style={{ margin: 0, fontSize: 13, color: "#a1a1aa", lineHeight: 1.5 }}>
              Ordens falhadas, sem fundos, não aprovados, divergência modelo vs execução.
            </p>
          </Link>
          <Link href="/backoffice/monitoring#drift" style={{ ...card, textDecoration: "none", color: "inherit" }}>
            <div style={{ color: DECIDE_DASHBOARD.accentSky, fontSize: 11, fontWeight: 800 }}>4</div>
            <div style={{ fontSize: 16, fontWeight: 800, margin: "6px 0" }}>Drift modelo vs real</div>
            <p style={{ margin: 0, fontSize: 13, color: "#a1a1aa", lineHeight: 1.5 }}>
              Retorno modelo esperado vs IB, tracking error por cliente.
            </p>
          </Link>
          <Link href="/backoffice/audit" style={{ ...card, textDecoration: "none", color: "inherit" }}>
            <div style={{ color: DECIDE_DASHBOARD.accentSky, fontSize: 11, fontWeight: 800 }}>5</div>
            <div style={{ fontSize: 16, fontWeight: 800, margin: "6px 0" }}>Auditoria exportável</div>
            <p style={{ margin: 0, fontSize: 13, color: "#a1a1aa", lineHeight: 1.5 }}>
              Export JSON / PDF do histórico regulatório do cliente.
            </p>
          </Link>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 14 }}>
          <div style={card}>
            <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 10, color: "#fde68a" }}>Clientes bloqueados</div>
            <ul style={{ margin: 0, paddingLeft: 18, color: "#a1a1aa", fontSize: 13, lineHeight: 1.6 }}>
              <li>Sem funding / saldo insuficiente</li>
              <li>Com recomendação, sem aprovação</li>
              <li>Execução incompleta vs plano</li>
            </ul>
            <p style={{ margin: "12px 0 0", fontSize: 12, color: "#52525b" }}>
              Lista operacional: ligar a <code style={{ color: "#71717a" }}>GET /api/backoffice/alerts</code> (a definir).
            </p>
          </div>
          <div style={card}>
            <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 10, color: "#fde68a" }}>
              Recomendação pendente
            </div>
            <p style={{ margin: 0, fontSize: 13, color: "#a1a1aa", lineHeight: 1.55 }}>
              Quem recebeu plano e ainda não aprovou — conversão e compliance. Filtrar na lista de clientes com estado
              «plano pendente».
            </p>
          </div>
        </div>

        <p style={{ marginTop: 28, fontSize: 12, color: "#52525b", lineHeight: 1.5 }}>
          Produção: activar com <code style={{ color: "#71717a" }}>DECIDE_BACKOFFICE_ENABLED=1</code>. Alertas automáticos
          (USD vs plano, FX, ordens pendentes) entram na página Monitorização após integração.
        </p>
      </BackofficeShell>
    </>
  );
}

export const getServerSideProps = backofficeGetServerSideProps;
