/**
 * DECIDE — Vapi voice assistant provisioning script
 *
 * Creates (or updates) the DECIDE voice concierge assistant on Vapi
 * and optionally imports your Twilio number into Vapi.
 *
 * Usage:
 *   node scripts/vapi-setup.mjs
 *
 * Required env vars in frontend/.env.local:
 *   VAPI_PRIVATE_KEY        — from https://dashboard.vapi.ai → API Keys
 *   NEXT_PUBLIC_APP_URL     — production URL, e.g. https://www.decidepoweredbyai.com
 *
 * Optional:
 *   VAPI_ASSISTANT_ID       — if set, updates that assistant instead of creating a new one
 *   VAPI_IMPORT_TWILIO=1    — also import the Twilio number into Vapi
 *   TWILIO_ACCOUNT_SID      — required if VAPI_IMPORT_TWILIO=1
 *   TWILIO_AUTH_TOKEN       — required if VAPI_IMPORT_TWILIO=1
 *   TWILIO_VOICE_NUMBER     — E.164 Twilio number, e.g. +351XXXXXXXXX
 */

import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Load .env.local ──────────────────────────────────────────────────────────
function loadEnv() {
  const envPath = resolve(__dirname, "../.env.local");
  try {
    const lines = readFileSync(envPath, "utf8").split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const [key, ...rest] = trimmed.split("=");
      const value = rest.join("=").replace(/^["']|["']$/g, "");
      if (key && value && !process.env[key]) {
        process.env[key] = value;
      }
    }
  } catch {
    console.warn("⚠  .env.local not found — using process environment only.");
  }
}
loadEnv();

// ── Vapi API helpers ─────────────────────────────────────────────────────────
const VAPI_BASE = "https://api.vapi.ai";
const PRIVATE_KEY = process.env.VAPI_PRIVATE_KEY;

if (!PRIVATE_KEY) {
  console.error("❌  VAPI_PRIVATE_KEY is not set. Add it to frontend/.env.local");
  process.exit(1);
}

async function vapiRequest(method, path, body) {
  const res = await fetch(`${VAPI_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${PRIVATE_KEY}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Vapi ${method} ${path} → ${res.status}: ${text}`);
  }
  return text ? JSON.parse(text) : null;
}

// ── Build assistant payload (mirrors vapiAssistantConfig.ts) ──────────────────
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://www.decidepoweredbyai.com";

const SYSTEM_PROMPT = `
Você é o assistente virtual da DECIDE — uma plataforma portuguesa de investimento baseada em inteligência artificial.
Responde sempre em Português de Portugal, a não ser que o utilizador fale em inglês, caso em que muda para inglês.

════════════════════════════════════════════
IDENTIDADE & TOM
════════════════════════════════════════════
• Apresenta-te sempre como "o assistente virtual da DECIDE" — nunca como humano.
• Tom: profissional, direto, caloroso. Não uses jargão excessivo.
• Respostas curtas ao telefone: 2-4 frases por turno. Sê conciso.
• Faz uma pergunta de cada vez quando precisas de mais informação.

════════════════════════════════════════════
O QUE É O DECIDE
════════════════════════════════════════════
A DECIDE é uma plataforma de investimento que combina modelos quantitativos proprietários com inteligência artificial para gerir carteiras de ações globais.

Pontos-chave:
• Modelo com 20 anos de backtest (desde 2006): CAGR ~25%/ano, Sharpe ~1,3.
• Mecanismo CAP15 que limita a volatilidade a níveis moderados (12-20% ao ano).
• Carteira de aproximadamente 20 posições em ações globais + liquidez em EUR.
• Recomendações mensais automáticas: Comprar, Reforçar, Vender, Reduzir, Manter.
• O cliente mantém controlo total: aprova cada recomendação antes da execução.
• Execução via Interactive Brokers — o maior broker online do mundo.
• Gestão em USD com cobertura cambial (FX hedge) disponível para minimizar risco EUR/USD.

════════════════════════════════════════════
PLANOS E PREÇOS
════════════════════════════════════════════
PLANO PREMIUM
• Mínimo: 5.000 € de investimento.
• Custo: 29 € por mês (taxa fixa, sem performance fee).

PLANO PRIVATE
• Mínimo: 50.000 € de investimento.
• Custo: 0,6% ao ano (0,05%/mês sobre o valor atual da carteira). Sem performance fee.

════════════════════════════════════════════
ONBOARDING (6 PASSOS)
════════════════════════════════════════════
1. Criar conta (email + telemóvel)
2. Valor a investir
3. Perfil de risco (MiFID II: Conservador, Moderado, Dinâmico)
4. KYC — verificação de identidade via Sumsub (BI/passaporte + selfie)
5. Hedge cambial EUR/USD
6. Plano e pagamento

Depois: abertura de conta IBKR + transferência de fundos (normalmente 1-2 semanas).

════════════════════════════════════════════
PERGUNTAS FREQUENTES
════════════════════════════════════════════
"O dinheiro fica onde?" → Na conta do cliente no Interactive Brokers. A DECIDE nunca detém fundos.
"Quem executa?" → O cliente aprova; a DECIDE submete ao IBKR; o IBKR executa.
"Posso cancelar?" → Sim, sem lock-up period.
"Qual o risco?" → Todos os investimentos têm risco. Max drawdown histórico ~-35% (2008). CAP15 limita volatilidade mas não elimina risco.
"É preciso saber de investimentos?" → Não. O modelo faz a análise; o cliente aprova.

════════════════════════════════════════════
CONTACTOS
════════════════════════════════════════════
Email: jcpina01@decidepoweredbyai.com
Morada: Av. Miguel Bombarda 26, 3º, 1050-165 Lisboa
Website: www.decidepoweredbyai.com

════════════════════════════════════════════
REGRAS CRÍTICAS
════════════════════════════════════════════
• NUNCA dês conselho de investimento personalizado.
• NUNCA prometas retornos. Backtest não garante resultados futuros.
• Para escalada, usa a função escalate_to_human.
`.trim();

const ASSISTANT_PAYLOAD = {
  name: "DECIDE Voice Concierge",

  voice: {
    provider: "11labs",
    voiceId: "pNInz6obpgDQGcFmaJgB", // Adam — professional male, multilingual
    stability: 0.5,
    similarityBoost: 0.75,
  },

  transcriber: {
    provider: "deepgram",
    model: "nova-2",
    language: "pt",
    smartFormat: true,
  },

  model: {
    provider: "openai",
    model: "gpt-4o",
    temperature: 0.4,
    maxTokens: 300,
    messages: [{ role: "system", content: SYSTEM_PROMPT }],
    tools: [
      {
        type: "function",
        function: {
          name: "escalate_to_human",
          description:
            "Escalar a chamada para a equipa DECIDE quando o cliente pede explicitamente falar com uma pessoa ou a questão é demasiado complexa.",
          parameters: {
            type: "object",
            properties: {
              reason: { type: "string", description: "Motivo da escalada." },
              caller_name: { type: "string", description: "Nome do chamador, se fornecido." },
              summary: { type: "string", description: "Resumo de 1-2 frases do que o cliente perguntou." },
            },
            required: ["reason", "summary"],
          },
        },
      },
    ],
  },

  firstMessage:
    "Bem-vindo ao DECIDE. Sou o assistente virtual da plataforma. " +
    "Posso ajudá-lo com informações sobre onboarding, planos, custos e funcionamento. " +
    "Como posso ajudar?",

  endCallMessage: "Obrigado por contactar a DECIDE. Tenha um bom dia!",
  endCallPhrases: ["adeus", "tchau", "obrigado adeus", "goodbye", "bye"],

  silenceTimeoutSeconds: 20,
  maxDurationSeconds: 600,
  recordingEnabled: true,
  backgroundSound: "office",

  serverUrl: `${APP_URL}/api/vapi/webhook`,
};

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n🎙  DECIDE — Vapi voice assistant setup\n${"─".repeat(50)}`);
  console.log(`APP_URL  : ${APP_URL}`);
  console.log(`Webhook  : ${APP_URL}/api/vapi/webhook\n`);

  let assistant;
  const existingId = process.env.VAPI_ASSISTANT_ID;

  if (existingId) {
    console.log(`📝  Updating existing assistant ${existingId}…`);
    assistant = await vapiRequest("PATCH", `/assistant/${existingId}`, ASSISTANT_PAYLOAD);
    console.log(`✅  Assistant updated: ${assistant.id}`);
  } else {
    console.log("✨  Creating new assistant…");
    assistant = await vapiRequest("POST", "/assistant", ASSISTANT_PAYLOAD);
    console.log(`✅  Assistant created: ${assistant.id}`);
    console.log(`\n👉  Add this to your .env.local (and Vercel env vars):`);
    console.log(`   VAPI_ASSISTANT_ID=${assistant.id}\n`);
  }

  // ── Import Twilio number ─────────────────────────────────────────────────
  if (process.env.VAPI_IMPORT_TWILIO === "1") {
    const sid = process.env.TWILIO_ACCOUNT_SID;
    const token = process.env.TWILIO_AUTH_TOKEN;
    const number = process.env.TWILIO_VOICE_NUMBER;

    if (!sid || !token || !number) {
      console.warn(
        "⚠  VAPI_IMPORT_TWILIO=1 but TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_VOICE_NUMBER are missing — skipping.",
      );
    } else {
      console.log(`📞  Importing Twilio number ${number} into Vapi…`);
      const phonePayload = {
        provider: "twilio",
        number,
        twilioAccountSid: sid,
        twilioAuthToken: token,
        assistantId: assistant.id,
        name: "DECIDE PT",
      };
      try {
        const phone = await vapiRequest("POST", "/phone-number", phonePayload);
        console.log(`✅  Phone number imported: ${phone.id} (${phone.number})`);
        console.log(`\n👉  Add this to your .env.local:`);
        console.log(`   VAPI_PHONE_NUMBER_ID=${phone.id}\n`);
      } catch (err) {
        console.error("❌  Phone import failed:", err.message);
        console.log(
          "\nAlternative: in the Vapi dashboard → Phone Numbers → Import → Twilio\n" +
          `and set the assistant to "${ASSISTANT_PAYLOAD.name}" (ID: ${assistant.id}).`,
        );
      }
    }
  } else {
    console.log("ℹ  Skipping Twilio import (set VAPI_IMPORT_TWILIO=1 to import).\n");
    console.log("Manual steps to connect your Twilio number:");
    console.log("  1. Go to https://dashboard.vapi.ai → Phone Numbers");
    console.log("  2. Click «Import» → Twilio");
    console.log("  3. Enter your Twilio Account SID + Auth Token");
    console.log("  4. Select your Portuguese number");
    console.log(`  5. Set Assistant → «DECIDE Voice Concierge» (${assistant.id})\n`);
  }

  console.log("─".repeat(50));
  console.log("🏁  Done!\n");
}

main().catch((err) => {
  console.error("❌", err.message);
  process.exit(1);
});
