import type { NextApiRequest, NextApiResponse } from "next";

export const config = { api: { bodyParser: { sizeLimit: "64kb" } }, maxDuration: 30 };

const SYSTEM_PROMPT = `És o assistente de IA da plataforma DECIDE — uma plataforma portuguesa de gestão de carteira de investimentos baseada em modelos quantitativos.

Sobre o DECIDE:
- Modelo quantitativo de momentum e qualidade com 20 anos de backtest (desde 2006).
- CAGR histórico de ~25% ao ano, Sharpe ~1.3, Max Drawdown ~-35%.
- Mecanismo CAP15: limita a volatilidade da carteira ao nível Moderado (12–20% aa).
- Recomendações mensais: Comprar, Reforçar, Vender, Reduzir, Manter.
- Carteira de ~20 posições de acções globais + posição em XEON (liquidez EUR).
- Benchmark: composição mista (60% EUA / 25% EU+UK / 10% JP / 5% CAN).
- Integração com Interactive Brokers para execução de ordens.
- Páginas: Dashboard, Recomendações, Carteira, Performance, Risco, Histórico, Ajuda, Contactos.

Regras de resposta:
- Responde sempre em Português de Portugal (não Brasil).
- Sê conciso, claro e profissional. Usa linguagem acessível.
- Para questões financeiras gerais, dá explicações educativas e equilibradas.
- Nunca dês conselho de investimento personalizado. Se alguém pedir recomendação sobre um activo específico, explica que o modelo DECIDE gere isso automaticamente.
- Para questões sobre a plataforma, refere as páginas e funcionalidades disponíveis.
- Limita as respostas a ~200 palavras excepto quando maior detalhe for claramente necessário.`;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).end();

  const { messages } = req.body as { messages: { role: string; content: string }[] };
  if (!messages?.length) return res.status(400).json({ error: "messages required" });

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return res.status(200).json({
      content: "O assistente de IA não está configurado neste momento. Para questões, contacta a equipa DECIDE através da página Contactos ou envia um email para geral@decide.pt."
    });
  }

  try {
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        max_tokens: 400,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          ...messages.slice(-8), // keep last 8 turns for context
        ],
      }),
    });
    if (!r.ok) {
      const err = await r.text();
      console.error("OpenAI error:", err);
      return res.status(200).json({ content: "Erro ao contactar o assistente. Tenta novamente." });
    }
    const data = await r.json();
    const content = data.choices?.[0]?.message?.content ?? "Sem resposta.";
    return res.status(200).json({ content });
  } catch (e) {
    console.error("ai-chat error:", e);
    return res.status(200).json({ content: "Erro de ligação ao assistente. Tenta novamente." });
  }
}
