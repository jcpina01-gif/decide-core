export type FaqCategoryId =
  | "conta"
  | "carteira"
  | "risco"
  | "custos"
  | "geral"
  | "plataforma"
  | "adequacao";

export type FaqEntry = {
  id: string;
  categoryId: FaqCategoryId;
  term: string;
  body: string;
};

export const FAQ_ITEMS: FaqEntry[] = [
  {
    id: "conta-ibkr",
    categoryId: "conta",
    term: "Conta IBKR",
    body: "Conta real do cliente na Interactive Brokers onde as posições são executadas e mantidas.",
  },
  {
    id: "conta-paper",
    categoryId: "conta",
    term: "Conta Paper IBKR",
    body: "Conta de simulação usada para testes, sem dinheiro real.",
  },
  {
    id: "execucao",
    categoryId: "conta",
    term: "Execução",
    body: "Envio de ordens para a corretora (IBKR). Só acontece após aprovação do cliente.",
  },
  {
    id: "execucao-residual",
    categoryId: "conta",
    term: "Execução residual",
    body: "Execução parcial de ordens que ficaram pendentes ou não executadas anteriormente.",
  },
  {
    id: "ordens-preparadas",
    categoryId: "conta",
    term: "Ordens preparadas",
    body: "Ordens calculadas pelo modelo, prontas para execução mas ainda não enviadas.",
  },
  {
    id: "execucao-concluida",
    categoryId: "conta",
    term: "Execução concluída",
    body: "Todas as ordens desta ação foram enviadas e executadas com sucesso.",
  },
  {
    id: "ordens-parciais",
    categoryId: "conta",
    term: "Ordens parciais",
    body: "Ordens que foram apenas parcialmente executadas (ex.: liquidez insuficiente).",
  },
  {
    id: "ver-carteira",
    categoryId: "conta",
    term: "Ver carteira atualizada",
    body: "Sincroniza posições com a IBKR e leva ao separador Plano → Alterações → secção «Carteira atual» para ver a tabela actualizada; se estiver na página de execução, também actualiza o estado das linhas de ordens quando aplicável.",
  },
  {
    id: "depositar-fundos-decide",
    categoryId: "plataforma",
    term: "Como depositar fundos na DECIDE",
    body: "A DECIDE não recebe nem custodia o dinheiro do cliente. Deposita-se por transferência bancária (ex.: SEPA) para os dados da Interactive Brokers (IBKR) indicados na app. Com sessão iniciada, utilize «Depositar Fundos» no cabeçalho (ou o atalho equivalente no menu da conta) para abrir «Depositar na sua conta»: IBAN do beneficiário, montante sugerido e descritivo obrigatório. O dinheiro fica na sua conta na corretora; prazos e comissões dependem do seu banco e da IBKR.",
  },
  {
    id: "descritivo-sepa-ibkr",
    categoryId: "conta",
    term: "Descritivo da transferência para a IBKR",
    body: "No homebanking, no campo de referência / descritivo da transferência para a IBKR deve constar exactamente o seu utilizador (login) da DECIDE — o mesmo definido no registo (por defeito sugerido a partir do email). Sem esse texto, o depósito pode não ser associado à sua conta na corretora.",
  },
  {
    id: "decide-vs-ibkr-dinheiro",
    categoryId: "geral",
    term: "Onde fica o meu dinheiro",
    body: "Os activos e a liquidez ficam na conta titulada pelo cliente na Interactive Brokers. A DECIDE é uma camada de software e de recomendações; não é instituição de depósitos.",
  },
  {
    id: "etf-educativo",
    categoryId: "geral",
    term: "ETF (fundo negociado em bolsa)",
    body: "Instrumento que replica ou segue um índice ou cestos de activos, negociado em bolsa como uma acção. Permite diversificar com um único título; ainda assim há risco de mercado, cambial e de contraparte da corretora. Definição geral — não constitui recomendação de produto.",
  },
  {
    id: "ordem-stop-educativo",
    categoryId: "geral",
    term: "Ordem stop (conceito)",
    body: "Instrução para vender (ou comprar) quando o preço atinge um nível definido, frequentemente usada para limitar perdas ou automatizar saídas. O preço de execução final pode diferir em mercados rápidos (gaps). Explicação genérica; na DECIDE/IBKR o tipo exacto de ordem disponível segue as regras da corretora.",
  },
  {
    id: "carteira-atual",
    categoryId: "carteira",
    term: "Carteira atual (IBKR real)",
    body: "Posições reais da conta do cliente na corretora.",
  },
  {
    id: "carteira-recomendada",
    categoryId: "carteira",
    term: "Carteira recomendada (DECIDE)",
    body: "Alocação ótima calculada pelo modelo com base na estratégia definida.",
  },
  {
    id: "alteracoes-propostas",
    categoryId: "carteira",
    term: "Alterações propostas",
    body: "Diferença entre a carteira atual e a recomendada (ordens de compra/venda).",
  },
  {
    id: "peso",
    categoryId: "carteira",
    term: "Peso",
    body: "Percentagem de cada ativo na carteira total.",
  },
  {
    id: "exposicao",
    categoryId: "carteira",
    term: "Exposição",
    body: "Valor total investido (inclui capital próprio + margem).",
  },
  {
    id: "tbills-sleeve",
    categoryId: "carteira",
    term: "T-Bills / Cash Sleeve",
    body: "Componente defensiva da carteira (liquidez ou equivalentes de caixa).",
  },
  {
    id: "financiamento-margem",
    categoryId: "carteira",
    term: "Financiamento via margem (IBKR)",
    body: "Valor emprestado pela corretora para suportar investimento acima do capital disponível.",
  },
  {
    id: "rotacao",
    categoryId: "carteira",
    term: "Rotação da carteira",
    body: "Percentagem da carteira que é alterada numa execução.",
  },
  {
    id: "cagr",
    categoryId: "risco",
    term: "CAGR (Taxa de Crescimento Anual Composta)",
    body: "Retorno médio anual ao longo do tempo, assumindo reinvestimento.",
  },
  {
    id: "sharpe",
    categoryId: "risco",
    term: "Sharpe Ratio",
    body: "Medida de retorno ajustado ao risco. Quanto maior, melhor.",
  },
  {
    id: "volatilidade",
    categoryId: "risco",
    term: "Volatilidade",
    body: "Medida de variação dos retornos (risco).",
  },
  {
    id: "max-dd",
    categoryId: "risco",
    term: "Max Drawdown",
    body: "Maior perda acumulada desde um pico até ao mínimo.",
  },
  {
    id: "outperformance",
    categoryId: "risco",
    term: "Outperformance",
    body: "Retorno adicional do modelo face ao benchmark.",
  },
  {
    id: "benchmark",
    categoryId: "risco",
    term: "Benchmark",
    body: "Índice de referência usado para comparar performance (ex.: S&P 500).",
  },
  {
    id: "equity-curve",
    categoryId: "risco",
    term: "Equity Curve",
    body: "Evolução do valor da carteira ao longo do tempo.",
  },
  {
    id: "management-fee",
    categoryId: "custos",
    term: "Management Fee",
    body: "Comissão anual pela gestão da carteira (ex.: 0,60%).",
  },
  {
    id: "performance-fee",
    categoryId: "custos",
    term: "Performance Fee",
    body: "Percentagem cobrada sobre ganhos acima do benchmark.",
  },
  {
    id: "fee-mensal",
    categoryId: "custos",
    term: "Fee mensal estimada",
    body: "Estimativa do custo mensal com base no valor atual da carteira.",
  },
  {
    id: "segmento",
    categoryId: "custos",
    term: "Segmento",
    body: "Classificação do cliente (ex.: A, B, etc.) que determina estrutura de custos.",
  },
  {
    id: "alavancagem",
    categoryId: "geral",
    term: "Alavancagem",
    body: "Uso de capital emprestado para aumentar exposição.",
  },
  {
    id: "margem",
    categoryId: "geral",
    term: "Margem",
    body: "Empréstimo fornecido pela corretora para financiar posições.",
  },
  {
    id: "liquidez",
    categoryId: "geral",
    term: "Liquidez",
    body: "Facilidade de comprar/vender um ativo sem impactar o preço.",
  },
  {
    id: "ordem-market",
    categoryId: "geral",
    term: "Ordem Market",
    body: "Ordem executada imediatamente ao melhor preço disponível.",
  },
  {
    id: "ordem-limit",
    categoryId: "geral",
    term: "Ordem Limit",
    body: "Ordem executada apenas a um preço específico ou melhor.",
  },
  {
    id: "testes-robustez-modelo",
    categoryId: "geral",
    term: "Testes de robustez do modelo",
    body: "No dashboard, no sub-menu à esquerda, escolha «Robustez» (a seguir a «Simulação»). Aí encontra o resumo, «Ver detalhes dos testes» e o link «Metodologia completa». Resultados passados não garantem resultados futuros.",
  },
  {
    id: "long",
    categoryId: "geral",
    term: "Posição Long",
    body: "Compra de um ativo esperando valorização.",
  },
  {
    id: "short",
    categoryId: "geral",
    term: "Posição Short",
    body: "Venda de um ativo esperando desvalorização.",
  },
  {
    id: "rebalanceamento",
    categoryId: "geral",
    term: "Rebalanceamento",
    body: "Ajuste periódico da carteira para manter os pesos definidos.",
  },
  {
    id: "diversificacao",
    categoryId: "geral",
    term: "Diversificação",
    body: "Distribuição do investimento por vários ativos para reduzir risco.",
  },
  {
    id: "turnover",
    categoryId: "geral",
    term: "Turnover",
    body: "Percentagem da carteira negociada num período.",
  },
  {
    id: "dashboard-cliente",
    categoryId: "plataforma",
    term: "Dashboard cliente",
    body: "Área autenticada da app DECIDE com KPIs (painel embed), gráficos longos, simulador, carteira IBKR, custos, fiscalidade e ajuda (FAQs, assistente, contactos).",
  },
  {
    id: "painel-kpi-flask",
    categoryId: "plataforma",
    term: "Painel KPI (serviço Flask)",
    body: "Separadores como Resumo, Simulador, Gráficos e Carteira servidos por um iframe do servidor KPI quando configurado; o perfil de risco escolhido no dashboard alimenta pedidos a esse serviço.",
  },
  {
    id: "vista-simples-avancada-kpi",
    categoryId: "plataforma",
    term: "Vista Simples / Avançada (KPIs)",
    body: "Controla quanto detalhe estatístico aparece no painel de indicadores: na vista simples mostram-se menos linhas auxiliares; na avançada surgem métricas adicionais (vol, Sharpe, etc.) onde aplicável.",
  },
  {
    id: "modelo-base-kpi",
    categoryId: "plataforma",
    term: "Modelo teórico (não investível)",
    body: "Referência técnica do motor antes das molduras do produto (overlay CAP15, limites de drawdown, vol por perfil). Não corresponde ao produto investível — o Modelo CAP15 ao lado incorpora custos de mercado estimados e critérios de implementação no backtest.",
  },
  {
    id: "cap15-plafonado",
    categoryId: "plataforma",
    term: "Modelo CAP15",
    body: "Versão investível: overlay CAP15, exposição a risco limitada a 100% do NAV; no moderado o motor aplica alvo ≈1× vol do benchmark na perna overlay, em conservador/dinâmico há alvo de vol vs benchmark (0,75× / 1,25×). Os KPIs reflectem custos de mercado estimados e pressupostos de execução realista no backtest (não incluem comissões DECIDE nem impostos). Informação indicativa.",
  },
  {
    id: "hedge-cambial-kpis",
    categoryId: "plataforma",
    term: "Hedge cambial nos KPIs",
    body: "Para alguns segmentos, pode definir-se par FX e percentagem para ver métricas históricas ajustadas ao risco cambial; é ilustrativo na documentação de KPIs e não envia ordens, forwards nem futuros à IBKR.",
  },
  {
    id: "tbill-proxy-inactive-ibkr",
    categoryId: "plataforma",
    term: "TBILL proxy (SHV/BIL) «Inactive» na execução",
    body: "Inactive é um estado devolvido pela corretora, não pela app. Verifique no IB Gateway ou na TWS: horário de mercado US para o ETF, permissões da conta (paper) para ações/ETFs nos EUA, e mensagens de erro na linha da ordem. O servidor DECIDE qualifica SHV/BIL/SGOV em ARCA e SMART. Se continuar, experimente o outro ETF em NEXT_PUBLIC_TBILL_PROXY_IB_TICKER ou submeta manualmente no IB Gateway ou na TWS.",
  },
  {
    id: "total-return-metrica",
    categoryId: "risco",
    term: "Total return (múltiplo)",
    body: "Factor acumulado pelo qual o valor inicial cresceria ao longo da série (ex.: 2,5×). Complementa o CAGR para ver escala do desempenho no horizonte disponível.",
  },
  {
    id: "simulador-capital-kpi",
    categoryId: "plataforma",
    term: "Simulador de capital (KPI)",
    body: "Projecção de capital ao longo do tempo com base na série do modelo e no perfil; requer o serviço KPI correctamente configurado. Não substitui planificação pessoal nem garante resultados futuros.",
  },
  {
    id: "graficos-longos-horizontes",
    categoryId: "plataforma",
    term: "Gráficos longos e horizontes (YTD · 1Y · 5Y · 10Y)",
    body: "O dashboard separa curvas de longo prazo (~vários anos) de quadros de retorno por horizonte (ano civil, 12 meses, 5 e 10 anos) para comparar modelo e benchmark no mesmo recorte.",
  },
  {
    id: "historico-decisoes",
    categoryId: "plataforma",
    term: "Histórico de decisões",
    body: "Registo de recomendações e estados de execução ao longo do tempo na app; ajuda a auditar rotações e acompanhar o fluxo até à IBKR.",
  },
  {
    id: "fees-paginas-embed",
    categoryId: "plataforma",
    term: "Custos — Descrição e Simulador",
    body: "No dashboard, Custos inclui (1) custos de mercado e de simulação histórica no modelo (transação, slippage, FX aproximado, turnover, execução) e (2) comissões DECIDE Premium vs Private no simulador; tudo ilustrativo e sem substituir contrato ou RIIPS.",
  },
  {
    id: "fiscalidade-painel",
    categoryId: "plataforma",
    term: "Painel Fiscalidade",
    body: "Texto informativo sobre impostos e encargos comuns em contexto português; não substitui assessor fiscal nem contabilidade individual.",
  },
  {
    id: "assistente-decide",
    categoryId: "plataforma",
    term: "Assistente DECIDE",
    body: "Chat de ajuda com o glossário DECIDE, guias de fluxo (dashboard, onboarding, depósitos na IBKR, plano e execução) e explicações educativas sobre conceitos financeiros gerais. Não acede à conta nem a posições em tempo real; não recomenda comprar ou vender ativos concretos nem quantidades; não substitui assessor financeiro, fiscal ou jurídico.",
  },
  {
    id: "landing-simulador-publico",
    categoryId: "plataforma",
    term: "Simulador da página inicial",
    body: "Demonstração pública com parâmetros típicos de capital e horizonte; utiliza as mesmas ideias de série do motor que o dashboard mas não está ligado à sessão do cliente.",
  },
  {
    id: "freeze-curvas",
    categoryId: "plataforma",
    term: "Freeze de curvas",
    body: "Conjunto de séries históricas versionadas usadas nos KPIs e relatórios para garantir comparabilidade entre ecrãs; não muda intraday com o mercado ao vivo.",
  },
  {
    id: "perfil-risco-tres",
    categoryId: "risco",
    term: "Perfis conservador, moderado e dinâmico",
    body: "Conservador: menor tolerância a oscilações, vol alvo ≈0,75× a do benchmark nos KPIs. Moderado: alvo ≈1× a vol do benchmark no motor na overlay (sem multiplicador 0,75× / 1,25×). Dinâmico: vol alvo ≈1,25× a do benchmark. A escolha afecta os cartões CAP15 e similares.",
  },
  {
    id: "segmento-fee-a-b",
    categoryId: "custos",
    term: "Segmento de fee A / B",
    body: "Classificação interna ligada ao NAV modelo: a partir de 50k € passa a B para efeitos de fluxo (ex.: passo de hedge cambial nos KPIs). Não confundir com os nomes comerciais Premium e Private.",
  },
  {
    id: "premium-vs-private",
    categoryId: "custos",
    term: "Premium e Private (segmentos)",
    body: "Segmentos comerciais escolhidos no registo: estruturas de fee e simuladores ilustrativos diferem (ex.: Premium com modelo simplificado, Private com componentes mensais e de performance no simulador de fees-página).",
  },
  {
    id: "montante-minimo-produto",
    categoryId: "adequacao",
    term: "Montante mínimo a investir",
    body: "No onboarding é pedido um valor mínimo de investimento pretendido alinhado ao produto (ex.: 5.000 €); valores abaixo do mínimo não prosseguem no fluxo.",
  },
  {
    id: "funil-onboarding",
    categoryId: "adequacao",
    term: "Funil de onboarding",
    body: "Sequência típica: montante e dados, questionário MiFID, verificação KYC, preparação IBKR quando aplicável, aprovação e — para certos segmentos — preferência de hedge cambial nos KPIs. O progresso aparece na barra de passos.",
  },
  {
    id: "mifid-adequacao",
    categoryId: "adequacao",
    term: "MiFID II e questionário de adequação",
    body: "Questionário sobre experiência, objectivos, horizonte, perda máxima aceitável e liquidez, entre outros, para mapear o perfil de investidor e documentar a adequação do serviço.",
  },
  {
    id: "kyc-verificacao",
    categoryId: "adequacao",
    term: "KYC (verificação de identidade)",
    body: "Identificação do cliente através de fornecedor integrado (ex.: Sumsub ou Persona conforme configuração), com documentos e controlos anti-fraude antes de operações reais.",
  },
  {
    id: "aprovacao-operacoes-reais",
    categoryId: "adequacao",
    term: "Aprovação antes de operações reais",
    body: "Passo de revisão após KYC e dados contratuais; até à aprovação pode usar-se ambiente de testes (Paper IBKR) sem dinheiro real.",
  },
  {
    id: "ibkr-prep",
    categoryId: "conta",
    term: "Preparação IBKR",
    body: "Passos informativos ou de ligação à Interactive Brokers antes de executar na conta real, conforme o fluxo configurado.",
  },
  {
    id: "verificacao-email",
    categoryId: "conta",
    term: "Verificação de email",
    body: "Confirmação do endereço de correio para activar comunicações e, em alguns fluxos, desbloquear áreas da app.",
  },
  {
    id: "relatorio-cliente-pdf",
    categoryId: "plataforma",
    term: "Plano cliente",
    body: "Documento ou ecrã de resumo com métricas e segmentação de fees; pode sincronizar o segmento de fee (A/B) com o armazenamento local usado no dashboard.",
  },
  {
    id: "alpha-rolling",
    categoryId: "risco",
    term: "Alpha rolling",
    body: "Medida de retorno extra do modelo face ao benchmark ao longo de janelas móveis; útil para ver consistência da sobreperformance no tempo, não só no ponto final.",
  },
  {
    id: "nv-nav",
    categoryId: "carteira",
    term: "NAV (valor líquido do activo)",
    body: "Valor total da carteira após passivos; no Modelo CAP15 a exposição a risco compara-se com 100% do NAV para limitar alavancagem.",
  },
  {
    id: "rebalanceamento-agendado",
    categoryId: "plataforma",
    term: "Calendário de carteira / revisão",
    body: "O cliente pode configurar lembretes ou datas de revisão mensal na app; não substitui a decisão de investimento nem a execução na corretora.",
  },
];
