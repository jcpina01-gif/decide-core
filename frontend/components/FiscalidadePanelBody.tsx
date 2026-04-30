import React from "react";

const muted = "#b0b0b8";
const dim = "#7c7c86";

type CardVariant = "default" | "legal";

function FiscalCard({
  title,
  variant = "default",
  children,
}: {
  title: string;
  variant?: CardVariant;
  children: React.ReactNode;
}) {
  const isLegal = variant === "legal";
  return (
    <section
      style={{
        width: "100%",
        maxWidth: "100%",
        boxSizing: "border-box",
        marginBottom: 16,
        padding: "18px 22px 20px",
        borderRadius: 14,
        border: isLegal
          ? "1px solid rgba(251, 191, 36, 0.45)"
          : "1px solid rgba(255, 255, 255, 0.12)",
        background: isLegal
          ? "linear-gradient(145deg, rgba(120, 53, 15, 0.32) 0%, rgba(22, 22, 26, 0.88) 100%)"
          : "linear-gradient(180deg, rgba(44, 44, 48, 0.72) 0%, rgba(24, 24, 28, 0.92) 100%)",
        boxShadow: isLegal
          ? "0 0 0 1px rgba(0,0,0,0.35), 0 12px 32px rgba(0,0,0,0.35)"
          : "0 0 0 1px rgba(0,0,0,0.28), 0 10px 28px rgba(0,0,0,0.32)",
      }}
    >
      <h3
        style={{
          margin: "0 0 12px 0",
          fontSize: 14,
          fontWeight: 800,
          color: isLegal ? "#fef3c7" : "#fafafa",
          letterSpacing: "0.02em",
          lineHeight: 1.3,
        }}
      >
        {title}
      </h3>
      <div style={{ color: muted, fontSize: 12.5, lineHeight: 1.62, width: "100%" }}>{children}</div>
    </section>
  );
}

function P({ children }: { children: React.ReactNode }) {
  return <p style={{ margin: "0 0 12px 0", color: muted, maxWidth: "100%" }}>{children}</p>;
}

function Ul({ children }: { children: React.ReactNode }) {
  return (
    <ul
      style={{
        margin: "0 0 0 0",
        paddingLeft: "1.25em",
        color: muted,
        maxWidth: "100%",
      }}
    >
      {children}
    </ul>
  );
}

function CountryMiniCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        padding: "14px 16px",
        borderRadius: 12,
        border: "1px solid rgba(255, 255, 255, 0.1)",
        background: "rgba(18, 18, 22, 0.65)",
        minWidth: 0,
      }}
    >
      <div style={{ fontWeight: 800, color: "#e4e4e7", marginBottom: 8, fontSize: 12.5 }}>{title}</div>
      <div style={{ fontSize: 12.5, color: muted, lineHeight: 1.62 }}>{children}</div>
    </div>
  );
}

function UkPracticalCard() {
  return (
    <FiscalCard title="Reino Unido (UK) — visão prática">
      <Ul>
        <li style={{ marginBottom: 10 }}>
          <strong style={{ color: "#d4d4d8" }}>Contas com vantagens fiscais:</strong>{" "}
          <strong style={{ color: "#d4d4d8" }}>ISA</strong> e pensões (por exemplo{" "}
          <strong style={{ color: "#d4d4d8" }}>SIPP</strong>) podem oferecer{" "}
          <strong style={{ color: "#d4d4d8" }}>tratamento fiscal favorável dentro da conta</strong>, conforme regras do
          Reino Unido e limites anuais.
        </li>
        <li style={{ marginBottom: 10 }}>
          <strong style={{ color: "#d4d4d8" }}>Dividendos:</strong> existe{" "}
          <strong style={{ color: "#d4d4d8" }}>Dividend Allowance</strong> (isenção até um limite anual); acima disso
          aplicam-se <strong style={{ color: "#d4d4d8" }}>taxas por escalão</strong> (basic, higher, additional).
        </li>
        <li style={{ marginBottom: 10 }}>
          <strong style={{ color: "#d4d4d8" }}>Mais-valias:</strong>{" "}
          <strong style={{ color: "#d4d4d8" }}>Annual Exempt Amount</strong> (isenção anual até limite) e{" "}
          <strong style={{ color: "#d4d4d8" }}>CGT</strong> conforme escalão e tipo de ativo.
        </li>
        <li>
          <strong style={{ color: "#d4d4d8" }}>Juros:</strong> frequentemente envolve{" "}
          <strong style={{ color: "#d4d4d8" }}>Personal Savings Allowance</strong> e taxas por escalão, conforme o perfil
          do contribuinte.
        </li>
      </Ul>
    </FiscalCard>
  );
}

/**
 * Conteúdo informativo da aba Fiscalidade (PT). Não é aconselhamento fiscal.
 */
export default function FiscalidadePanelBody() {
  return (
    <div
      style={{
        width: "100%",
        maxWidth: "100%",
        maxHeight: "min(1240px, calc(100vh - 220px))",
        overflowY: "auto",
        overflowX: "hidden",
        paddingRight: 4,
        boxSizing: "border-box",
      }}
    >
      <div
        style={{
          width: "100%",
          display: "block",
        }}
      >
      <FiscalCard title="Aviso legal" variant="legal">
        <p style={{ margin: 0, color: "#fcd34d", fontSize: 12.5, lineHeight: 1.62 }}>
          A fiscalidade depende da residência fiscal do cliente, do tipo de instrumento (ETF UCITS, ações, CFD, etc.), da
          moeda e das regras locais. Esta página é informativa e{" "}
          <strong style={{ color: "#fef3c7" }}>não constitui aconselhamento fiscal, jurídico ou contabilístico</strong>.
          Confirme sempre com o seu contabilista ou consultor fiscal.
        </p>
      </FiscalCard>

      <FiscalCard title="O DECIDE e os impostos (advisory não-discricionário)">
        <P>
          No modelo <strong style={{ color: "#d4d4d8" }}>não-discricionário</strong>, o DECIDE apoia com recomendações;{" "}
          <strong style={{ color: "#d4d4d8" }}>quem aprova e executa é o cliente</strong>, na sua conta junto do broker.
          Em regra, <strong style={{ color: "#d4d4d8" }}>o DECIDE não retém impostos</strong> sobre o património do
          cliente. Quando existe retenção, costuma vir{" "}
          <strong style={{ color: "#d4d4d8" }}>do pagador do rendimento</strong> ou{" "}
          <strong style={{ color: "#d4d4d8" }}>do país de origem</strong> do dividendo ou dos juros. O cliente{" "}
          <strong style={{ color: "#d4d4d8" }}>declara</strong> conforme a lei do seu país, muitas vezes com base em{" "}
          <strong style={{ color: "#d4d4d8" }}>extratos e relatórios do broker</strong>.
        </P>
      </FiscalCard>

      <FiscalCard title="União Europeia — visão geral">
        <P>
          <strong style={{ color: "#d4d4d8" }}>1) Quem paga e onde?</strong> Regra prática: o investidor é tributado no{" "}
          <strong style={{ color: "#d4d4d8" }}>país onde é residente fiscal</strong> (IRS/IRPF ou imposto sobre o
          rendimento local). Na UE <strong style={{ color: "#d4d4d8" }}>não há uma taxa única europeia</strong>: a
          tributação é sobretudo <strong style={{ color: "#d4d4d8" }}>nacional</strong>.
        </P>
        <P style={{ marginBottom: 8 }}>
          <strong style={{ color: "#d4d4d8" }}>2) Tipos de rendimento (em geral)</strong>
        </P>
        <Ul>
          <li style={{ marginBottom: 8 }}>
            <strong style={{ color: "#d4d4d8" }}>Mais-valias:</strong> lucro na venda de ações ou ETFs (e instrumentos
            equivalentes); em regra, tratadas no <strong style={{ color: "#d4d4d8" }}>país do investidor</strong>.
          </li>
          <li style={{ marginBottom: 8 }}>
            <strong style={{ color: "#d4d4d8" }}>Dividendos:</strong> podem ter{" "}
            <strong style={{ color: "#d4d4d8" }}>retenção na fonte no país de origem</strong> e tributação no{" "}
            <strong style={{ color: "#d4d4d8" }}>país do investidor</strong>, com possível{" "}
            <strong style={{ color: "#d4d4d8" }}>crédito de imposto</strong> ou mecanismos de{" "}
            <strong style={{ color: "#d4d4d8" }}>eliminação da dupla tributação</strong>, conforme tratados e regras locais.
          </li>
          <li>
            <strong style={{ color: "#d4d4d8" }}>Juros:</strong> lógica semelhante à dos dividendos; o detalhe varia por
            país e por instrumento.
          </li>
        </Ul>
        <P style={{ marginTop: 12, marginBottom: 0 }}>
          <strong style={{ color: "#d4d4d8" }}>3) Retenção transfronteiriça (“withholding”).</strong> A UE tem trabalhado
          em <strong style={{ color: "#d4d4d8" }}>processos mais rápidos e normalizados</strong> (incluindo alívio na
          fonte e reembolsos), mas a experiência prática continua a depender do{" "}
          <strong style={{ color: "#d4d4d8" }}>país de origem</strong>, do{" "}
          <strong style={{ color: "#d4d4d8" }}>intermediário</strong> e da{" "}
          <strong style={{ color: "#d4d4d8" }}>documentação</strong>.
        </P>
      </FiscalCard>

      <UkPracticalCard />

      <FiscalCard title="Exemplos por país">
        <p style={{ margin: "0 0 12px 0", fontSize: 12, color: dim, maxWidth: "100%" }}>
          Texto geral; não substitui análise individual.
        </p>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 300px), 1fr))",
            gap: 14,
            width: "100%",
          }}
        >
          <CountryMiniCard title="Portugal (residentes)">
            Dividendos e juros enquadram-se frequentemente em{" "}
            <strong style={{ color: "#d4d4d8" }}>rendimentos de capitais</strong>, com{" "}
            <strong style={{ color: "#d4d4d8" }}>taxas liberatórias</strong> no regime geral e possibilidade de{" "}
            <strong style={{ color: "#d4d4d8" }}>englobamento</strong> em certos casos. As{" "}
            <strong style={{ color: "#d4d4d8" }}>mais-valias</strong> em ações ou ETFs são, em regra, consideradas em{" "}
            <strong style={{ color: "#d4d4d8" }}>IRS</strong>, com nuances (incluindo englobamento parcial ou total em
            alguns cenários).
            <div style={{ marginTop: 10, fontStyle: "italic", color: "#9ca3af", fontSize: 12 }}>
              “Em Portugal, dividendos e mais-valias são tipicamente tributados em IRS; a taxa efetiva depende do regime
              aplicável e do perfil do contribuinte.”
            </div>
          </CountryMiniCard>

          <CountryMiniCard title="Espanha (residentes)">
            Em linha com o IRPF, rendimentos de <strong style={{ color: "#d4d4d8" }}>capital mobiliário</strong>{" "}
            (dividendos, juros) e <strong style={{ color: "#d4d4d8" }}>mais-valias</strong> costumam integrar a
            tributação anual, com regras específicas por tipo de rendimento e possíveis{" "}
            <strong style={{ color: "#d4d4d8" }}>retenções</strong> e <strong style={{ color: "#d4d4d8" }}>ajustes</strong>{" "}
            conforme o caso.
          </CountryMiniCard>

          <CountryMiniCard title="França (residentes)">
            Dividendos e mais-valias seguem normalmente o{" "}
            <strong style={{ color: "#d4d4d8" }}>imposto sobre o rendimento</strong>, com mecanismos adicionais em certos
            rendimentos de capital (por exemplo, <strong style={{ color: "#d4d4d8" }}>prélèvements sociaux</strong>),
            conforme enquadramento. A retenção estrangeira pode ser objeto de{" "}
            <strong style={{ color: "#d4d4d8" }}>crédito</strong> dentro dos limites legais.
          </CountryMiniCard>

          <CountryMiniCard title="Alemanha (residentes)">
            Dividendos e mais-valias são tipicamente reportados na{" "}
            <strong style={{ color: "#d4d4d8" }}>declaração anual</strong>; podem aplicar-se{" "}
            <strong style={{ color: "#d4d4d8" }}>abatimentos, isenções parciais ou regras específicas</strong> (por exemplo,
            participações qualificadas), conforme o caso concreto.
          </CountryMiniCard>
        </div>
      </FiscalCard>

      <FiscalCard title="Checklist anual (cliente)">
        <ol
          style={{
            margin: 0,
            paddingLeft: "1.25em",
            color: muted,
            lineHeight: 1.65,
            maxWidth: "100%",
          }}
        >
          <li style={{ marginBottom: 8 }}>Descarregar extratos e relatórios do broker.</li>
          <li style={{ marginBottom: 8 }}>Listar dividendos e juros recebidos e retenções aplicadas.</li>
          <li style={{ marginBottom: 8 }}>Apurar mais-valias e perdas (datas, custos, moeda).</li>
          <li>Cruzar com tratados e créditos aplicáveis com o consultor fiscal.</li>
        </ol>
      </FiscalCard>

      <FiscalCard title="Perguntas frequentes">
        <P>
          <strong style={{ color: "#d4d4d8" }}>O DECIDE paga impostos por mim?</strong> Não. O DECIDE fornece
          recomendações; o cliente executa no broker e cumpre as obrigações fiscais na sua jurisdição.
        </P>
        <P style={{ marginBottom: 0 }}>
          <strong style={{ color: "#d4d4d8" }}>O que é “retenção na fonte”?</strong> É imposto retido{" "}
          <strong style={{ color: "#d4d4d8" }}>no país de origem</strong> do rendimento antes do valor líquido chegar à
          conta; depois pode haver <strong style={{ color: "#d4d4d8" }}>crédito ou reembolso</strong> no país de residência,
          conforme regras e tratados.
        </P>
      </FiscalCard>

      <FiscalCard title="Próximo passo">
        <P style={{ marginBottom: 0 }}>
          <strong style={{ color: "#d4d4d8" }}>Consulte o seu contabilista ou consultor fiscal</strong> antes de decisões
          com efeitos fiscais. Para questões sobre a plataforma, use o <strong style={{ color: "#d4d4d8" }}>FAQ ou o
          suporte</strong> (sem aconselhamento fiscal).
        </P>
      </FiscalCard>
      </div>
    </div>
  );
}
