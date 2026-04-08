import type { NextApiRequest, NextApiResponse } from "next";
import { buildHelpAssistantSystemPrompt } from "../../../lib/server/helpAssistantContext";

type ChatRole = "user" | "assistant";

type ChatMessage = { role: ChatRole; content: string };

const MAX_USER_MSG = 8000;
const MAX_ASSISTANT_MSG = 12000;
const MAX_MESSAGES = 24;

function sanitizeMessages(raw: unknown): ChatMessage[] {
  if (!Array.isArray(raw)) return [];
  const out: ChatMessage[] = [];
  for (const m of raw.slice(-MAX_MESSAGES)) {
    if (!m || typeof m !== "object") continue;
    const role = (m as { role?: string }).role;
    const content = String((m as { content?: unknown }).content ?? "").trim();
    if (role !== "user" && role !== "assistant") continue;
    const cap = role === "user" ? MAX_USER_MSG : MAX_ASSISTANT_MSG;
    if (!content) continue;
    out.push({ role, content: content.slice(0, cap) });
  }
  return out;
}

type OpenAIChatResponse = {
  choices?: { message?: { role?: string; content?: string | null } }[];
  error?: { message?: string };
};

function resolveOpenAIApiKey(): string {
  const raw =
    process.env.OPENAI_API_KEY ||
    process.env.OPENAI_KEY ||
    process.env.OPENAI_SECRET_KEY ||
    "";
  return String(raw)
    .trim()
    .replace(/^\uFEFF/, "")
    .replace(/^["']|["']$/g, "");
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === "GET") {
    const openaiConfigured = Boolean(resolveOpenAIApiKey());
    return res.status(200).json({
      ok: true,
      openaiConfigured,
      nodeEnv: process.env.NODE_ENV || null,
      vercel: Boolean(process.env.VERCEL),
      vercelEnv: process.env.VERCEL_ENV || null,
      hints: openaiConfigured
        ? []
        : [
            "Nome exacto da variável: OPENAI_API_KEY (ou OPENAI_KEY / OPENAI_SECRET_KEY como alternativa).",
            process.env.VERCEL
              ? "Na Vercel: marca a variável para o ambiente correcto (Production vs Preview), guarda e faz Redeploy do último deployment."
              : "Em local: ficheiro .env.local dentro da pasta frontend/ (não na raiz do repositório), depois para e volta a arrancar npm run dev.",
          ],
    });
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const apiKey = resolveOpenAIApiKey();
  if (!apiKey) {
    return res.status(503).json({
      ok: false,
      error:
        "Assistente não configurado: o servidor não vê OPENAI_API_KEY. Abra GET /api/help/assistant no browser para diagnóstico (openaiConfigured). Em Vercel: Production + Redeploy. Em local: frontend/.env.local + reiniciar dev.",
    });
  }

  const messages = sanitizeMessages(req.body?.messages);
  if (messages.length === 0) {
    return res.status(400).json({ ok: false, error: "Mensagens em falta ou inválidas." });
  }
  if (messages[messages.length - 1].role !== "user") {
    return res.status(400).json({ ok: false, error: "A última mensagem tem de ser do utilizador." });
  }

  const model = String(process.env.OPENAI_HELP_MODEL || "gpt-4o-mini").trim() || "gpt-4o-mini";
  const system = buildHelpAssistantSystemPrompt();

  const body = {
    model,
    temperature: 0.35,
    max_tokens: 1400,
    messages: [{ role: "system" as const, content: system }, ...messages],
  };

  let openaiRes: Response;
  try {
    openaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });
  } catch {
    return res.status(502).json({ ok: false, error: "Falha de rede ao contactar o serviço de IA." });
  }

  const json = (await openaiRes.json()) as OpenAIChatResponse;
  if (!openaiRes.ok) {
    const detail = json?.error?.message || openaiRes.statusText;
    return res.status(502).json({ ok: false, error: `OpenAI: ${detail}` });
  }

  const text = json?.choices?.[0]?.message?.content?.trim() || "";
  if (!text) {
    return res.status(502).json({ ok: false, error: "Resposta vazia do modelo." });
  }

  return res.status(200).json({ ok: true, message: text, model });
}
