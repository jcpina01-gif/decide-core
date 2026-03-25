import { useMemo, useState } from "react";

type FaqCategoryId = "conta" | "carteira" | "risco" | "custos" | "geral";

type FaqEntry = {
  id: string;
  categoryId: FaqCategoryId;
  term: string;
  body: string;
};

const CATEGORIES: { id: FaqCategoryId | "all"; label: string; hint: string }[] = [
  { id: "all", label: "Todas", hint: "" },
  { id: "conta", label: "Conta & Execução", hint: "" },
  { id: "carteira", label: "Carteira & Estratégia", hint: "" },
  { id: "risco", label: "Risco & Performance", hint: "" },
  { id: "custos", label: "Custos & Fees", hint: "" },
  { id: "geral", label: "Termos financeiros gerais", hint: "" },
];

const FAQ_ITEMS: FaqEntry[] = [
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
    body: "Atualiza posições diretamente da IBKR (dados reais em tempo quase real).",
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
];

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function Highlight({ text, query }: { text: string; query: string }) {
  const q = query.trim();
  if (!q) return <>{text}</>;
  try {
    const parts = text.split(new RegExp(`(${escapeRegExp(q)})`, "gi"));
    return (
      <>
        {parts.map((part, i) =>
          part.toLowerCase() === q.toLowerCase() ? (
            <mark
              key={i}
              style={{
                background: "rgba(250, 204, 21, 0.35)",
                color: "#fef9c3",
                padding: "0 3px",
                borderRadius: 4,
              }}
            >
              {part}
            </mark>
          ) : (
            <span key={i}>{part}</span>
          )
        )}
      </>
    );
  } catch {
    return <>{text}</>;
  }
}

export default function DecideFaqPanel() {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<FaqCategoryId | "all">("all");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return FAQ_ITEMS.filter((item) => {
      if (category !== "all" && item.categoryId !== category) return false;
      if (!q) return true;
      const hay = `${item.term} ${item.body}`.toLowerCase();
      return hay.includes(q);
    });
  }, [query, category]);

  return (
    <div
      style={{
        background: "linear-gradient(145deg, #0c1629 0%, #0a0f1c 100%)",
        border: "1px solid rgba(59,130,246,0.35)",
        borderRadius: 18,
        padding: "22px 24px 28px",
        marginBottom: 28,
        boxShadow: "0 0 0 1px rgba(15,23,42,0.8), 0 18px 40px rgba(0,0,0,0.35)",
      }}
    >
      <div style={{ color: "#60a5fa", fontSize: 12, fontWeight: 800, letterSpacing: "0.06em", marginBottom: 8 }}>
        DECIDE AI · Ajuda
      </div>
      <h2 style={{ margin: "0 0 8px 0", fontSize: 24, color: "#ffffff", fontWeight: 800 }}>
        FAQs — glossário e conceitos
      </h2>
      <p style={{ margin: "0 0 18px 0", fontSize: 13, color: "#94a3b8", lineHeight: 1.55, maxWidth: 640 }}>
        Pesquisa em tempo real no <strong style={{ color: "#cbd5e1" }}>termo</strong> e na{" "}
        <strong style={{ color: "#cbd5e1" }}>descrição</strong>. Passe o rato sobre cada entrada para ver o resumo no
        tooltip do browser.
      </p>

      <label style={{ display: "block", marginBottom: 10, fontSize: 12, color: "#94a3b8", fontWeight: 600 }}>
        Procurar termos
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Procurar termos (ex: Sharpe, margem, CAGR…)"
          autoComplete="off"
          style={{
            display: "block",
            width: "100%",
            maxWidth: 480,
            marginTop: 8,
            padding: "12px 14px",
            borderRadius: 12,
            border: "1px solid #334155",
            background: "#0f172a",
            color: "#f1f5f9",
            fontSize: 15,
            outline: "none",
            boxSizing: "border-box",
          }}
        />
      </label>

      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: "#64748b", textTransform: "uppercase", marginBottom: 8 }}>
          Categorias
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {CATEGORIES.map((c) => {
            const active = category === c.id;
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => setCategory(c.id)}
                style={{
                  background: active ? "rgba(37,99,235,0.35)" : "#0f172a",
                  border: `1px solid ${active ? "#3b82f6" : "#334155"}`,
                  color: active ? "#e0f2fe" : "#94a3b8",
                  borderRadius: 999,
                  padding: "8px 14px",
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                {c.label}
              </button>
            );
          })}
        </div>
      </div>

      <div style={{ fontSize: 12, color: "#64748b", marginBottom: 12 }}>
        {filtered.length === FAQ_ITEMS.length && !query.trim() && category === "all"
          ? `${FAQ_ITEMS.length} entradas`
          : `${filtered.length} resultado(s)`}
      </div>

      <div style={{ display: "grid", gap: 8 }}>
        {filtered.length === 0 ? (
          <div style={{ color: "#94a3b8", fontSize: 14, padding: "16px 0" }}>Sem resultados. Tente outro termo ou categoria.</div>
        ) : (
          filtered.map((item) => (
            <details
              key={item.id}
              style={{
                border: "1px solid #1f2937",
                borderRadius: 12,
                background: "#111827",
                overflow: "hidden",
              }}
            >
              <summary
                title={item.body}
                style={{
                  cursor: "pointer",
                  padding: "12px 14px",
                  fontWeight: 700,
                  color: "#e2e8f0",
                  fontSize: 14,
                  listStyle: "none",
                }}
              >
                <Highlight text={item.term} query={query} />
              </summary>
              <div
                style={{
                  padding: "0 14px 14px 14px",
                  fontSize: 13,
                  color: "#cbd5e1",
                  lineHeight: 1.6,
                  borderTop: "1px solid #1f2937",
                }}
              >
                <Highlight text={item.body} query={query} />
              </div>
            </details>
          ))
        )}
      </div>
    </div>
  );
}
