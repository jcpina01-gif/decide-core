/**

 * Copy — testes de robustez + ponte decisão (dashboard).

 * Não fixar CAGR por perfil em texto estático: diverge do simulador (horizonte, perfil, freeze).

 */



export type DashboardRiskProfile = "conservador" | "moderado" | "dinamico";



export const MODEL_ROBUSTNESS_DISCLAIMER =

  "Resultados passados não garantem resultados futuros.";



/** Rentabilidade histórica no modelo: custos de mercado estimados no backtest; sem impostos nem comissões DECIDE. */

export const DECIDE_CAGR_INCLUDES_MARKET_COSTS_PT =

  "Rentabilidade líquida de custos estimados de transação e slippage. Não inclui impostos nem comissões da plataforma.";



export const MODEL_ROBUSTNESS_DASHBOARD_TITLE = "Modelo testado em diferentes cenários";



export const MODEL_ROBUSTNESS_DETAILS_SUMMARY = "Ver detalhes dos testes";



export const MODEL_ROBUSTNESS_EXPAND_TITLE = "Resultados dos testes de robustez";



export const MODEL_ROBUSTNESS_METHODOLOGY_HREF = "/client/metodologia-robustez";



/** Percentagens já formatadas para PT (vírgula decimal onde aplicável). */

export type RobustnessNumbersForProfile = {

  historicLine: string;

  costsLine: string;

  lagLine: string;

  conservativeTitle: string;

  conservativeValue: string;

};



/** Rótulo do callout de stress — não usar «Conservador» sozinho (confunde com o perfil de risco). */

const STRESS_SIMULATION_BLOCK_TITLE = "Simulação pessimista (stress)";



/** Bullets sem percentagens estáticas — números vêm do simulador / KPI ao vivo. */

const BY_PROFILE: Record<DashboardRiskProfile, RobustnessNumbersForProfile> = {

  conservador: {

    historicLine:

      "Rentabilidade histórica (Conservador): CAGR nos cartões do simulador / Dashboard — Modelo CAP15, horizonte «Anos desde o investimento» e freeze activo.",

    costsLine:

      "Stress com custos de transação mais elevados: avaliação interna relativa ao baseline (magnitude depende do exercício e da série).",

    lagLine:

      "Stress com atraso na execução: impacto quantificado nos testes internos; não substitui o CAGR do cartão principal.",

    conservativeTitle: STRESS_SIMULATION_BLOCK_TITLE,

    conservativeValue:

      "Resultado numérico do stress depende do cenário; consultar relatórios de robustez ou a equipa — não há percentagem única estática aqui.",

  },

  moderado: {

    historicLine:

      "Rentabilidade histórica (Moderado): CAGR nos cartões do simulador / Dashboard (série do Modelo CAP15, horizonte e freeze actuais).",

    costsLine:

      "Stress com custos de transação mais elevados: leitura relativa ao baseline nos testes internos (valor exacto conforme série).",

    lagLine:

      "Stress com atraso na execução: degradação controlada em testes internos; magnitudes nos relatórios de robustez.",

    conservativeTitle: STRESS_SIMULATION_BLOCK_TITLE,

    conservativeValue:

      "Intervalo e nível dependem do tipo de stress e da série usada na corrida; o simulador mostra o CAGR histórico principal com transparência de janela.",

  },

  dinamico: {

    historicLine:

      "Rentabilidade histórica (Dinâmico): CAGR nos cartões do simulador / Dashboard (maior objectivo de vol que o Moderado, mesma lógica de série).",

    costsLine:

      "Stress com custos de transação mais elevados: leitura relativa ao baseline nos testes internos (valor exacto conforme série).",

    lagLine:

      "Stress com atraso na execução: ver análises de robustez para magnitudes; não confundir com o CAGR do cartão sem stress.",

    conservativeTitle: STRESS_SIMULATION_BLOCK_TITLE,

    conservativeValue:

      "Intervalo e nível dependem do tipo de stress e da série; o perfil Dinâmico altera o CAGR histórico no simulador — não usar percentagens de marketing fixas.",

  },

};



export function riskProfileLabelPt(profile: DashboardRiskProfile): string {

  switch (profile) {

    case "conservador":

      return "Conservador";

    case "dinamico":

      return "Dinâmico";

    default:

      return "Moderado";

  }

}



export function getRobustnessNumbersForProfile(

  profile: DashboardRiskProfile,

): RobustnessNumbersForProfile {

  return BY_PROFILE[profile] ?? BY_PROFILE.moderado;

}



export function modelRobustnessDashboardLead(): string[] {

  return [

    "O modelo foi testado em múltiplos contextos de mercado, incluindo períodos de crise, custos de transação mais elevados e atrasos na execução.",

    "Os resultados mantiveram-se consistentes em todos os testes, indicando uma abordagem robusta e adaptável a diferentes condições.",

    "Uma parte dos retornos ocorre em períodos curtos de forte valorização.",

  ];

}



export function modelRobustnessClosingLine(): string {

  return "O modelo foi também testado em diferentes períodos de mercado e universos de investimento, mantendo resultados positivos em todos os cenários analisados.";

}



/** Ponte entre bloco de robustez e o plano recomendado. */

export function planDecisionBridgeText(profile: DashboardRiskProfile): string {

  const pl = riskProfileLabelPt(profile);

  return `Com base no histórico do modelo e nos testes de robustez, esta recomendação procura equilibrar rentabilidade e risco de acordo com o seu perfil ${pl}.`;

}



export const MODEL_ROBUSTNESS_TECH_TITLE = "Metodologia de teste";



export type ModelRobustnessTechParagraphsOpts = {

  /** CAGR % já em formato pt-PT (ex. "21,31"); vem do KPI / freeze alinhados ao Dashboard (Moderado). */

  embeddedFullSeriesCagrPt?: string | null;

};



export function modelRobustnessTechParagraphs(

  opts?: ModelRobustnessTechParagraphsOpts,

): string[] {

  const cagrPt = opts?.embeddedFullSeriesCagrPt?.trim();

  const referencePara =

    cagrPt && cagrPt.length > 0

      ? `Para o perfil Moderado, o CAGR anualizado do Modelo CAP15 com a mesma convenção que o serviço KPI e o cartão principal do Dashboard (série e freeze activos no servidor) é ${cagrPt}% ao ano. O número mostrado no Dashboard muda ao reduzir o horizonte em «Anos desde o investimento», ao alterar o perfil de risco (Conservador / Moderado / Dinâmico) ou quando o freeze ou o motor são actualizados.`

      : `O CAGR e as métricas históricas correctas são sempre as mostradas no Dashboard e no simulador: dependem do horizonte seleccionado, do perfil de risco e do freeze activo. Percentagens fixas em documentação antiga ficam rapidamente desactualizadas e não devem ser usadas como referência numérica.`;



  return [

    "O modelo foi submetido a um conjunto alargado de testes de robustez, incluindo análise por subperíodos, stress de custos, atrasos de execução, simulações Monte Carlo e variações no universo de investimento.",

    "Os resultados mostram consistência temporal, estabilidade face a pequenas perturbações nos dados e resistência a fricções operacionais.",

    referencePara,

    "Nas simulações pessimistas (stress) de custos e atrasos, os testes internos medem sobrevivência e degradação relativamente ao cenário base; não confundir esses exercícios com o CAGR histórico do cartão principal sem stress.",

    "Uma parte relevante dos retornos é gerada em períodos específicos de forte valorização, o que é consistente com estratégias de momentum e tendência.",

  ];

}



function robustnessExpandBullets(profile: DashboardRiskProfile): string[] {

  const n = getRobustnessNumbersForProfile(profile);

  return [

    n.historicLine,

    n.costsLine,

    n.lagLine,

    `${n.conservativeTitle}: ${n.conservativeValue}`,

  ];

}



/** Exemplo institucional (perfil Moderado) — bullets antes do fecho narrativo. */

export const MODEL_ROBUSTNESS_METHODOLOGY_EXAMPLE_BULLETS = robustnessExpandBullets("moderado");


