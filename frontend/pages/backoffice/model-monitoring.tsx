import type { GetServerSideProps } from "next";
import type { CSSProperties, ReactNode } from "react";
import Head from "next/head";
import Link from "next/link";
import BackofficeShell from "../../components/backoffice/BackofficeShell";
import { backofficeKpiDiagnosticsPageUrl, resolveKpiEmbedBaseForBackoffice } from "../../lib/backofficeKpiBase";
import { isBackofficeEnabled } from "../../lib/backofficeGate";

const panel: CSSProperties = {
  background: "rgba(24, 24, 27, 0.92)",
  border: "1px solid rgba(63, 63, 70, 0.75)",
  borderRadius: 16,
  padding: 20,
  marginBottom: 18,
};

const h2: CSSProperties = {
  fontSize: 15,
  fontWeight: 800,
  marginBottom: 12,
  color: "#e4e4e7",
};

const muted: CSSProperties = { color: "#a1a1aa", fontSize: 13, lineHeight: 1.6 };
const li: CSSProperties = { marginBottom: 10, color: "#d4d4d8", fontSize: 14, lineHeight: 1.55 };

function TrafficRow({
  color,
  title,
  children,
}: {
  color: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(0, 100px) 1fr",
        gap: 14,
        alignItems: "start",
        padding: "14px 0",
        borderBottom: "1px solid #27272a",
      }}
    >
      <div
        style={{
          fontSize: 12,
          fontWeight: 900,
          letterSpacing: "0.04em",
          color,
          textTransform: "uppercase",
        }}
      >
        {title}
      </div>
      <div style={{ ...muted, margin: 0 }}>{children}</div>
    </div>
  );
}

function MetricBlock({
  n,
  title,
  detail,
  triggers,
}: {
  n: string;
  title: string;
  detail: string;
  triggers: { level: "warn" | "bad"; text: string }[];
}) {
  return (
    <div
      style={{
        padding: "14px 0",
        borderBottom: "1px solid #27272a",
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 800, color: "#fafafa", marginBottom: 6 }}>
        {n} {title}
      </div>
      <p style={{ ...muted, margin: "0 0 10px" }}>{detail}</p>
      <ul style={{ margin: 0, paddingLeft: 18 }}>
        {triggers.map((t, i) => (
          <li
            key={i}
            style={{
              ...li,
              color: t.level === "bad" ? "#fca5a5" : "#fcd34d",
              marginBottom: 6,
            }}
          >
            {t.level === "bad" ? "Forte: " : "Alerta: "}
            {t.text}
          </li>
        ))}
      </ul>
    </div>
  );
}

type Props = { kpiBase: string };

export default function BackofficeModelMonitoringPage({ kpiBase }: Props) {
  const diagnosticsHref = kpiBase ? backofficeKpiDiagnosticsPageUrl(kpiBase) : "";
  return (
    <>
      <Head>
        <title>Painel do modelo — Back-office Decide</title>
        <meta name="robots" content="noindex,nofollow" />
      </Head>
      <BackofficeShell
        active="model-monitoring"
        title="Painel do modelo (research)"
        subtitle="Ruído normal vs necessidade real de afinar. Usar vários sinais em conjunto — nunca um indicador isolado."
      >
        <div style={panel}>
          <div style={h2}>Objectivo</div>
          <p style={muted}>
            Distinguir <strong style={{ color: "#e4e4e7" }}>flutuação esperada</strong> de{" "}
            <strong style={{ color: "#e4e4e7" }}>degradação estrutural</strong> que justifica rever o motor, dados ou
            moldura do produto.
          </p>
        </div>

        <div style={panel}>
          <div style={{ ...h2, color: "#fde68a" }}>Semáforo de decisão</div>
          <TrafficRow color="#4ade80" title="Verde — não mexer">
            10y continua sólido; 1–2 métricas fraquejam sem <strong>persistência</strong> clara.
          </TrafficRow>
          <TrafficRow color="#fbbf24" title="Amarelo — observar">
            5y fraco, z-score baixo ou recovery a piorar — mas ainda sem conjunto de sinais alinhados.
          </TrafficRow>
          <TrafficRow color="#f87171" title="Vermelho — considerar mexer">
            <strong>Três ou mais</strong> destes em simultâneo: Sharpe relativo (5y rolling) negativo persistente; z-score
            do spread 5y &lt; -2; recovery &gt; P90; subperíodo recente claramente pior; hit-rate em queda clara vs
            histórico.
          </TrafficRow>
        </div>

        <div style={panel}>
          <div style={h2}>Indicadores principais (obrigatórios)</div>
          <MetricBlock
            n="1."
            title="Sharpe relativo (modelo vs benchmark) — rolling 5y"
            detail="O mais importante. Está negativo? Há quanto tempo?"
            triggers={[
              { level: "warn", text: "negativo ~3 meses" },
              { level: "bad", text: "persistente (ex.: muitos meses / centenas de dias úteis)" },
            ]}
          />
          <MetricBlock
            n="2."
            title="Spread de retorno rolling (CAGR) — modelo − benchmark"
            detail="Horizontes: 3y, 5y, 10y."
            triggers={[
              { level: "warn", text: "5y ≈ 0 ou negativo" },
              { level: "bad", text: "10y a degradar (muito relevante)" },
            ]}
          />
          <MetricBlock
            n="3."
            title="Z-score do spread (5y)"
            detail="Posição do spread actual vs distribuição histórica."
            triggers={[
              { level: "warn", text: "&lt; -1 σ" },
              { level: "bad", text: "&lt; -2 σ" },
            ]}
          />
          <MetricBlock
            n="4."
            title="Recovery (tempo de recuperação em drawdown)"
            detail="Quanto tempo para sair de DD vs histórico."
            triggers={[
              { level: "warn", text: "&gt; percentil 80" },
              { level: "bad", text: "&gt; percentil 90" },
            ]}
          />
          <MetricBlock
            n="5."
            title="Drawdown — nível, duração e frequência"
            detail="O DD pode não ser o pior de sempre; alerta se as fases submersas durarem mais ou forem mais frequentes."
            triggers={[
              { level: "warn", text: "duração submerso a aumentar vs histórico" },
              { level: "bad", text: "padrão repetido com recovery lento" },
            ]}
          />
        </div>

        <div style={panel}>
          <div style={h2}>Confirmação (secundários)</div>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            <li style={li}>
              <strong style={{ color: "#e4e4e7" }}>6.</strong> Persistência do Sharpe relativo &lt; 0 — alerta &gt; 60%
              do tempo; forte &gt; 75%.
            </li>
            <li style={li}>
              <strong style={{ color: "#e4e4e7" }}>7.</strong> Hit-rate (modelo &gt; benchmark) mensal ou rolling —
              queda clara vs histórico (ex. 60% → 50%).
            </li>
            <li style={li}>
              <strong style={{ color: "#e4e4e7" }}>8.</strong> Subperíodos — bloco recente claramente pior que blocos
              anteriores.
            </li>
            <li style={li}>
              <strong style={{ color: "#e4e4e7" }}>9.</strong> Cauda / melhores dias — dependência excessiva de poucos
              dias; piora neste teste.
            </li>
            <li style={li}>
              <strong style={{ color: "#e4e4e7" }}>10.</strong> Turnover e custos — aumento de fricção sem melhoria de
              retorno.
            </li>
          </ul>
        </div>

        <div style={panel}>
          <div style={h2}>Cadência sugerida</div>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            <li style={li}>
              <strong style={{ color: "#5eead4" }}>Mensal (leve):</strong> Sharpe relativo, spread resumido, DD.
            </li>
            <li style={li}>
              <strong style={{ color: "#5eead4" }}>Trimestral:</strong> rolling completo, recovery, persistência.
            </li>
            <li style={li}>
              <strong style={{ color: "#5eead4" }}>Anual:</strong> revisão global, subperíodos, bateria completa de
              testes.
            </li>
          </ul>
        </div>

        <div style={panel}>
          <div style={h2}>Serviço KPI (Flask) — como abrir</div>
          <p style={muted}>
            O back-office é Next.js; os gráficos e o separador <strong style={{ color: "#e4e4e7" }}>Diagnóstico
            (rolling)</strong> vivem no <strong style={{ color: "#e4e4e7" }}>kpi_server.py</strong> (Flask), na raiz do
            repo — outro processo e outra porta. Mantém-se separado para não duplicar dezenas de endpoints e templates
            Python dentro do frontend; o painel BO concentra o <em>guia</em>; o Flask continua a fonte dos números.
          </p>
          <ul style={{ margin: "12px 0 0", paddingLeft: 18 }}>
            <li style={li}>
              Na raiz do clone: <code style={{ color: "#a5b4fc" }}>npm run kpi</code> (script que usa{" "}
              <code style={{ color: "#a5b4fc" }}>backend\.venv</code> e liberta a porta 5000), ou{" "}
              <code style={{ color: "#a5b4fc" }}>.\tools\start_kpi_server_5000.ps1</code>.
            </li>
            <li style={li}>
              Alternativa: activar o venv e{" "}
              <code style={{ color: "#a5b4fc" }}>python kpi_server.py</code> — fica em{" "}
              <code style={{ color: "#a5b4fc" }}>http://127.0.0.1:5000/</code>.
            </li>
            <li style={li}>
              Em produção, o Next utiliza <code style={{ color: "#a5b4fc" }}>NEXT_PUBLIC_KPI_EMBED_BASE</code> para apontar
              para o mesmo host onde o Flask está exposto.
            </li>
          </ul>
          {diagnosticsHref ? (
            <p style={{ ...muted, marginTop: 14, marginBottom: 0 }}>
              Vista embebida no back-office:{" "}
              <Link href="/backoffice/kpi-diagnostics" style={{ color: "#93c5fd" }}>
                Diagnóstico KPI
              </Link>
              . Abrir só o Flask noutro separador:{" "}
              <a href={diagnosticsHref} target="_blank" rel="noopener noreferrer" style={{ color: "#93c5fd" }}>
                link directo
              </a>
              .
            </p>
          ) : (
            <p style={{ ...muted, marginTop: 14, marginBottom: 0 }}>
              Para um link directo aqui, defina <code style={{ color: "#a5b4fc" }}>NEXT_PUBLIC_KPI_EMBED_BASE</code> (ou
              execute o frontend em <code style={{ color: "#a5b4fc" }}>development</code>, com fallback para{" "}
              <code style={{ color: "#a5b4fc" }}>127.0.0.1:5000</code>).
            </p>
          )}
        </div>

        <div style={panel}>
          <div style={h2}>Onde ver números no repo</div>
          <p style={muted}>
            No serviço Flask de KPIs, aba <strong style={{ color: "#e4e4e7" }}>Diagnóstico (rolling)</strong> — rolling
            5y/10y, spread, z-score, recovery, hit-rate, persistência, etc. Este painel é o guia interpretativo; os
            gráficos continuam na mesma vista técnica.
          </p>
        </div>

        <div style={panel}>
          <div style={h2}>Nota (V2.3 smooth)</div>
          <p style={muted}>
            Degradação com Sharpe relativo persistente, z-score extremo e recovery muito alto foi parte da justificação
            para iterar o modelo. Com <strong style={{ color: "#e4e4e7" }}>momentum smooth</strong>, espera-se Sharpe
            mais estável, recovery menos extremo e z-score menos negativo — isso valida o processo de revisão, não
            elimina a necessidade de continuar a monitorizar com esta grelha.
          </p>
        </div>
      </BackofficeShell>
    </>
  );
}

export const getServerSideProps: GetServerSideProps<Props> = async () => {
  if (!isBackofficeEnabled()) return { notFound: true };
  return { props: { kpiBase: resolveKpiEmbedBaseForBackoffice() } };
};
