import type { CSSProperties, ReactNode } from "react";
import Head from "next/head";
import Link from "next/link";
import BackofficeShell from "../../components/backoffice/BackofficeShell";
import { DECIDE_DASHBOARD } from "../../lib/decideClientTheme";
import { backofficeGetServerSideProps } from "../../lib/backofficePageProps";

const panel: CSSProperties = {
  background: "rgba(24, 24, 27, 0.92)",
  border: "1px solid rgba(63, 63, 70, 0.75)",
  borderRadius: 16,
  padding: "20px 22px",
  marginBottom: 18,
};

const ul: CSSProperties = {
  margin: "10px 0 0",
  paddingLeft: 22,
  color: "#d4d4d8",
  fontSize: 14,
  lineHeight: 1.65,
};

function Section({
  kicker,
  title,
  children,
}: {
  kicker: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section style={panel}>
      <div style={{ color: DECIDE_DASHBOARD.accentSky, fontSize: 11, fontWeight: 800, letterSpacing: "0.06em" }}>
        {kicker}
      </div>
      <h2 style={{ margin: "6px 0 12px", fontSize: 18, fontWeight: 800, color: "#fafafa" }}>{title}</h2>
      {children}
    </section>
  );
}

export default function BackofficeAuditLogsPage() {
  return (
    <>
      <Head>
        <title>Logs para auditorias — Back-office Decide</title>
        <meta name="robots" content="noindex,nofollow" />
      </Head>
      <BackofficeShell
        active="audit-guide"
        title="Guia — logs para auditorias"
        subtitle="MiFID / advisory: o que persistir de forma imutável. Objectivo: provar recomendação, base, aprovação e execução."
      >
        <Section kicker="1 — Obrigatório" title="Log de recomendações (snapshot auditável)">
          <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6, color: "#d4d4d8" }}>
            Cada recomendação tal como foi apresentada ao cliente (nunca só o «estado actual» recalculado).
          </p>
          <ul style={ul}>
            <li>Timestamp de geração</li>
            <li>Perfil de risco (ex.: moderado, dinâmico)</li>
            <li>Parâmetros do motor (lookback, top Q, hedge, exclusões, etc.)</li>
            <li>Lista de activos recomendados e pesos (%)</li>
            <li>Versão do modelo (identificador estável: ex. CAP15, hash ou tag de release)</li>
            <li>KPIs mostrados ao cliente (CAGR, volatilidade, drawdown, horizonte)</li>
          </ul>
        </Section>

        <Section kicker="2 — Obrigatório" title="Log de aprovação do cliente">
          <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6, color: "#d4d4d8" }}>
            Em modelo não discricionário, não deve existir execução sem registo explícito de consentimento sobre um
            plano concreto.
          </p>
          <ul style={ul}>
            <li>Timestamp da aprovação</li>
            <li>ID da recomendação aprovada (ligação ao snapshot)</li>
            <li>Identificação do cliente (conta / user id conforme política de dados)</li>
            <li>Evidência da acção (submissão de formulário, checkbox, assinatura digital, etc.)</li>
            <li>Versão imutável do plano aprovado (ou hash do payload)</li>
          </ul>
        </Section>

        <Section kicker="3 — Obrigatório" title="Log de ordens e execução">
          <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6, color: "#d4d4d8" }}>
            Ligação clara entre recomendação aprovada e o que foi enviado ao broker.
          </p>
          <ul style={ul}>
            <li>Timestamp de envio</li>
            <li>Activo, quantidade, lado, tipo de ordem</li>
            <li>Preço limite / referência e, quando existir, preço executado</li>
            <li>Estado (submitted, filled, rejected, cancelled)</li>
            <li>ID da ordem no broker (ex. IBKR order id)</li>
            <li>Mapping: recommendation_id → order_id(s)</li>
          </ul>
        </Section>

        <Section kicker="4 — Obrigatório" title="Log de funding (depósitos / levantamentos)">
          <ul style={ul}>
            <li>Timestamp</li>
            <li>Montante e moeda</li>
            <li>Tipo: depósito, levantamento, transferência interna</li>
            <li>Origem / destino (IBKR, transferência bancária, etc.)</li>
          </ul>
          <p style={{ margin: "12px 0 0", fontSize: 13, color: "#a1a1aa", lineHeight: 1.55 }}>
            Útil para reconciliar NAV com recomendações e comissões.
          </p>
        </Section>

        <Section kicker="5 — Obrigatório" title="Log de configurações e alterações">
          <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6, color: "#d4d4d8" }}>
            Tudo o que altera o comportamento percebido pelo cliente ou pelo motor.
          </p>
          <ul style={ul}>
            <li>Alteração de perfil de risco</li>
            <li>Mudança de parâmetros de modelo ou universo investível</li>
            <li>Ativação / desativação de hedge cambial ou outras políticas</li>
            <li>Quem alterou e quando (auditoria de back-office)</li>
          </ul>
        </Section>

        <Section kicker="Recomendado" title="Extensões fortes">
          <ul style={ul}>
            <li>
              <strong style={{ color: "#fafafa" }}>Versões do modelo:</strong> versão de código ou artefacto,
              hash, data de deployment — para provar com que build foi gerada cada recomendação.
            </li>
            <li>
              <strong style={{ color: "#fafafa" }}>Dados de mercado usados:</strong> fonte, as-of, e referência de
              preços (ou snapshot) para evitar disputas do tipo «nesse dia o preço era outro».
            </li>
            <li>
              <strong style={{ color: "#fafafa" }}>Comunicações:</strong> relatórios enviados, notificações e
              emails materialmente relevantes (confirmações regulatórias).
            </li>
          </ul>
        </Section>

        <Section kicker="Modelo de dados" title="Encadeamento por IDs">
          <pre
            style={{
              margin: "12px 0 0",
              padding: 14,
              background: "#0a0a0a",
              borderRadius: 12,
              border: "1px solid #27272a",
              fontSize: 12,
              color: "#a1a1aa",
              overflow: "auto",
              lineHeight: 1.5,
            }}
          >
            {`client_id
  └── recommendation_id
        ├── snapshot.json
        ├── approval.json
        ├── orders.json
        └── execution.json`}
          </pre>
        </Section>

        <Section kicker="Erro frequente" title="Não recalcular o passado com dados actuais">
          <p style={{ margin: 0, fontSize: 14, lineHeight: 1.65, color: "#d4d4d8" }}>
            Não reconstruir recomendações antigas com preços ou parâmetros de hoje. O snapshot apresentado ao cliente
            deve ser persistido e é a fonte de verdade para auditoria.
          </p>
        </Section>

        <Section kicker="Mínimo viável" title="Três ficheiros ou tabelas que já cobrem a maior parte">
          <ul style={ul}>
            <li>
              <code style={{ color: "#fde68a" }}>recommendation_snapshot</code> (JSON imutável)
            </li>
            <li>
              <code style={{ color: "#fde68a" }}>client_approval</code>
            </li>
            <li>
              <code style={{ color: "#fde68a" }}>orders_log</code>
            </li>
          </ul>
        </Section>

        <Section kicker="Produto" title="Ligação à área cliente">
          <p style={{ margin: 0, fontSize: 14, lineHeight: 1.65, color: "#d4d4d8" }}>
            A vista <strong style={{ color: "#fff" }}>Atividade</strong> no dashboard pode evoluir para uma leitura
            legível destes eventos (decisões, aprovações, execuções), com filtros por data e tipo — sem substituir o
            arquivo técnico imutável no backend.
          </p>
        </Section>

        <div
          style={{
            ...panel,
            borderColor: "rgba(45, 212, 191, 0.35)",
            background: "rgba(6, 78, 59, 0.12)",
          }}
        >
          <p style={{ margin: 0, fontSize: 15, fontWeight: 700, color: "#5eead4" }}>Pergunta-chave de auditoria</p>
          <p style={{ margin: "10px 0 0", fontSize: 15, lineHeight: 1.6, color: "#e4e4e7" }}>
            «O que recomendaste, quando, com base em quê, o cliente aprovou, e o que foi executado?»
          </p>
        </div>

        <p style={{ marginTop: 24, fontSize: 13, color: "#52525b" }}>
          <Link href="/backoffice/audit" style={{ color: "#71717a" }}>
            ← Auditoria (export)
          </Link>
        </p>
      </BackofficeShell>
    </>
  );
}

export const getServerSideProps = backofficeGetServerSideProps;
