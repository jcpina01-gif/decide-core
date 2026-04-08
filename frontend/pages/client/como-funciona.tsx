import Head from "next/head";
import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { CLIENT_ONBOARDING_START_HREF } from "../../components/ClientMainNav";
import { DECIDE_MIN_INVEST_EUR } from "../../lib/decideInvestPrefill";
import { DECIDE_DASHBOARD } from "../../lib/decideClientTheme";

const IB_HOME_HREF = "https://www.interactivebrokers.com";

const minInvestLabel = `${DECIDE_MIN_INVEST_EUR.toLocaleString("pt-PT")} €`;

const panel: React.CSSProperties = {
  background: DECIDE_DASHBOARD.clientPanelGradient,
  border: DECIDE_DASHBOARD.panelBorder,
  borderRadius: 18,
  padding: 20,
  boxShadow: DECIDE_DASHBOARD.clientPanelShadow,
};

const h2: React.CSSProperties = {
  margin: "0 0 12px",
  fontSize: 17,
  fontWeight: 800,
  color: "#fafafa",
};

const body: React.CSSProperties = {
  margin: 0,
  fontSize: 14,
  lineHeight: 1.65,
  color: "#d4d4d8",
};

const list: React.CSSProperties = {
  margin: "10px 0 0",
  paddingLeft: 20,
  fontSize: 14,
  lineHeight: 1.65,
  color: "#d4d4d8",
};

const ctaPrimary: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "12px 20px",
  borderRadius: 12,
  fontWeight: 800,
  fontSize: 14,
  textDecoration: "none",
  background: DECIDE_DASHBOARD.buttonTealCta,
  color: DECIDE_DASHBOARD.kpiMenuMainButtonColor,
  border: DECIDE_DASHBOARD.kpiMenuMainButtonBorder,
  boxShadow: DECIDE_DASHBOARD.kpiMenuMainButtonShadow,
};

const ctaSecondary: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "11px 18px",
  borderRadius: 12,
  fontWeight: 700,
  fontSize: 13,
  textDecoration: "none",
  background: "rgba(39,39,42,0.9)",
  color: "#e4e4e7",
  border: "1px solid rgba(255,255,255,0.12)",
};

export default function ComoFuncionaPage() {
  return (
    <>
      <Head>
        <title>Como funciona | DECIDE</title>
      </Head>
      <main
        style={{
          padding: "16px clamp(12px, 3vw, 32px) 40px",
          maxWidth: 960,
          margin: "0 auto",
          boxSizing: "border-box",
        }}
      >
        <h1 style={{ fontSize: 24, fontWeight: 900, margin: "0 0 14px", letterSpacing: "-0.02em" }}>
          Como funciona
        </h1>

        <div style={{ ...panel, marginBottom: 18 }}>
          <p style={{ ...body, fontSize: 18, fontWeight: 800, color: "#fafafa", lineHeight: 1.35 }}>
            Invista com decisões informadas — mas sempre com controlo total.
          </p>
        </div>

        <div
          role="status"
          style={{
            marginBottom: 20,
            padding: "12px 16px",
            borderRadius: 14,
            background: "rgba(45,212,191,0.12)",
            border: "1px solid rgba(45,212,191,0.35)",
            fontSize: 14,
            fontWeight: 700,
            color: "#ccfbf1",
            lineHeight: 1.5,
            display: "flex",
            alignItems: "flex-start",
            gap: 12,
          }}
        >
          <ShieldCheck
            aria-hidden
            width={24}
            height={24}
            strokeWidth={2.25}
            style={{ flexShrink: 0, color: "#5eead4", marginTop: 1 }}
          />
          <span>Nada é executado sem a sua aprovação.</span>
        </div>

        <div style={{ ...panel, marginBottom: 18 }}>
          <h2 style={h2}>Como funciona (3 passos)</h2>
          <ol style={{ ...list, listStyle: "decimal" }}>
            <li style={{ marginBottom: 10 }}>
              <strong style={{ color: "#fafafa" }}>O modelo analisa</strong> — O sistema avalia milhares de dados e
              identifica oportunidades.
            </li>
            <li style={{ marginBottom: 10 }}>
              <strong style={{ color: "#fafafa" }}>Recebe uma recomendação</strong> — Simples, transparente e com racional.
            </li>
            <li>
              <strong style={{ color: "#fafafa" }}>Decide executar</strong> — Com um clique — nada acontece sem si.
            </li>
          </ol>
        </div>

        <div style={{ ...panel, marginBottom: 18 }}>
          <p style={body}>
            O DECIDE analisa o mercado com modelos quantitativos e propõe investimentos. A execução só acontece se
            aprovar.
          </p>
        </div>

        <div style={{ ...panel, marginBottom: 18 }}>
          <h2 style={h2}>O que é / o que não é</h2>
          <p style={{ ...body, fontWeight: 700, color: "#a7f3d0", marginBottom: 8 }}>O que é</p>
          <ul style={list}>
            <li>Um serviço de aconselhamento de investimento</li>
            <li>Baseado em modelos quantitativos</li>
            <li>Com recomendações claras e periódicas</li>
            <li>Onde decide sempre se executa ou não</li>
          </ul>
          <p style={{ ...body, fontWeight: 700, color: "#fca5a5", marginTop: 16, marginBottom: 8 }}>O que não é</p>
          <ul style={{ ...list, color: "#d4d4d8" }}>
            <li>Não é uma corretora e não custodia o seu dinheiro</li>
            <li>Não executa operações sem a sua aprovação</li>
            <li>Não promete retornos garantidos</li>
          </ul>
        </div>

        <div style={{ ...panel, marginBottom: 18 }}>
          <h2 style={h2}>Para quem é</h2>
          <ul style={list}>
            <li>Quer investir melhor</li>
            <li>Quer disciplina e método</li>
            <li>Mas não quer perder controlo</li>
          </ul>
        </div>

        <div style={{ ...panel, marginBottom: 18 }}>
          <h2 style={h2}>Onde está o dinheiro — Interactive Brokers</h2>
          <p style={body}>
            O investimento é realizado na{" "}
            <a
              href={IB_HOME_HREF}
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: DECIDE_DASHBOARD.accentSky, fontWeight: 700 }}
            >
              Interactive Brokers
            </a>
            , uma das maiores corretoras do mundo, regulada e com presença global. O seu património fica numa{" "}
            <strong style={{ color: "#e4e4e7" }}>conta em seu nome na IB</strong>; terá de{" "}
            <strong style={{ color: "#e4e4e7" }}>transferir fundos para a Interactive Brokers</strong> para investir
            segundo o plano. O DECIDE não recebe o seu dinheiro: apenas gera recomendações; a execução é na IB, com a
            sua aprovação.
          </p>
          <p style={{ ...body, marginTop: 14 }}>
            Montante mínimo de investimento considerado pelo serviço:{" "}
            <strong style={{ color: "#e4e4e7" }}>{minInvestLabel}</strong> (alinhado ao questionário de adequação e ao
            modelo).
          </p>
        </div>

        <div style={{ ...panel, marginBottom: 18 }}>
          <h2 style={h2}>Resultados em backtesting</h2>
          <p style={body}>
            Os modelos foram avaliados em histórico longo (backtesting): o desempenho simulado{" "}
            <strong style={{ color: "#e4e4e7" }}>foi superior ao mercado de referência em várias janelas históricas</strong>.
            Isto descreve o passado hipotético do modelo — <strong style={{ color: "#e4e4e7" }}>não garante</strong>{" "}
            resultados futuros (ver secção Riscos).
          </p>
        </div>

        <div style={{ ...panel, marginBottom: 22 }}>
          <h2 style={h2}>Riscos</h2>
          <p style={body}>
            Investir envolve risco. O valor pode oscilar e pode perder capital. Resultados passados não garantem resultados
            futuros.
          </p>
        </div>

        <p style={{ ...body, margin: "0 0 20px", fontSize: 13, color: "#a1a1aa", maxWidth: 820 }}>
          Quer ver gráficos, simulador e mais pormenores antes de avançar? Abra o{" "}
          <Link href="/client-dashboard" style={{ color: DECIDE_DASHBOARD.accentSky, fontWeight: 800 }}>
            Dashboard
          </Link>
          .
        </p>

        <div style={{ ...panel, marginBottom: 16 }}>
          <h2 style={{ ...h2, marginBottom: 14 }}>Próximo passo</h2>
          <p style={{ ...body, marginBottom: 16 }}>
            Criar conta, validar perfil de risco e começar a receber recomendações.
          </p>
          <p
            style={{
              ...body,
              marginBottom: 14,
              fontSize: 13,
              color: "#a1a1aa",
              fontStyle: "italic",
              maxWidth: 520,
            }}
          >
            Pode explorar primeiro — nada será executado sem a sua aprovação.
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 12, alignItems: "flex-start" }}>
            <Link href={CLIENT_ONBOARDING_START_HREF} style={ctaPrimary}>
              Iniciar registo
            </Link>
            <p style={{ ...body, fontSize: 12, color: "#71717a", margin: 0 }}>
              Já tem sessão? Continue em{" "}
              <Link href="/client-montante" style={{ color: DECIDE_DASHBOARD.accentSky, fontWeight: 700 }}>
                Valor a investir
              </Link>{" "}
              ou{" "}
              <Link href="/persona-onboarding" style={{ color: DECIDE_DASHBOARD.accentSky, fontWeight: 700 }}>
                Identidade (KYC)
              </Link>
              .
            </p>
            <Link href="/client/report" style={ctaSecondary}>
              Ver exemplo de recomendação (Plano)
            </Link>
            <Link href="/client-dashboard" style={ctaSecondary}>
              Abrir o Dashboard (mais detalhe)
            </Link>
            <p style={{ ...body, fontSize: 12, color: "#71717a", margin: 0, maxWidth: 640 }}>
              No Plano veja um exemplo de recomendação. No Dashboard veja análise e simulador com mais contexto; parte do
              conteúdo está disponível antes de concluir todos os passos de onboarding.
            </p>
          </div>
        </div>
      </main>
    </>
  );
}
