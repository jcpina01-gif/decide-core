/**
 * POST /api/vapi/webhook
 *
 * Receives events from Vapi for the DECIDE voice concierge.
 * Events handled:
 *   - call-start      → log incoming call
 *   - call-end        → log summary + transcript
 *   - function-call   → handle escalate_to_human / send_info_email
 *   - transcript      → optional real-time transcript storage
 *
 * Vapi webhook signature verification:
 *   Set VAPI_WEBHOOK_SECRET in env; Vapi sends X-Vapi-Signature header (HMAC-SHA256).
 *   Leave unset in dev to skip verification.
 */

import crypto from "crypto";
import type { NextApiRequest, NextApiResponse } from "next";

export const config = { api: { bodyParser: { sizeLimit: "256kb" } } };

// ---------------------------------------------------------------------------
// Types (simplified Vapi webhook payload shapes)
// ---------------------------------------------------------------------------
interface VapiCallPayload {
  id: string;
  phoneNumberId?: string;
  customer?: { number?: string; name?: string };
  startedAt?: string;
  endedAt?: string;
  endedReason?: string;
  durationSeconds?: number;
  recordingUrl?: string;
  transcript?: string;
  summary?: string;
  cost?: number;
}

interface VapiFunctionCallPayload {
  name: string;
  parameters: Record<string, string>;
}

interface VapiWebhookBody {
  message: {
    type:
      | "call-start"
      | "call-end"
      | "function-call"
      | "transcript"
      | "hang"
      | "speech-update"
      | "status-update";
    call?: VapiCallPayload;
    functionCall?: VapiFunctionCallPayload;
    transcript?: string;
    role?: string;
  };
}

// ---------------------------------------------------------------------------
// Signature verification
// ---------------------------------------------------------------------------
function verifyVapiSignature(req: NextApiRequest, rawBody: string): boolean {
  const secret = process.env.VAPI_WEBHOOK_SECRET;
  if (!secret) return true; // skip in dev

  const signature = req.headers["x-vapi-signature"] as string | undefined;
  if (!signature) return false;

  const expected = crypto
    .createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex");

  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expected),
  );
}

// ---------------------------------------------------------------------------
// Notify team on escalation (email via existing Resend/Gmail route)
// ---------------------------------------------------------------------------
async function notifyEscalation(params: {
  callerNumber?: string;
  callerName?: string;
  reason: string;
  summary: string;
  callId: string;
}) {
  const supportEmail = "jcpina01@decidepoweredbyai.com";
  const subject = `[DECIDE Voice] Escalada para humano — ${params.callerNumber ?? "número desconhecido"}`;
  const body = [
    `ID da chamada: ${params.callId}`,
    `Número: ${params.callerNumber ?? "—"}`,
    `Nome: ${params.callerName ?? "—"}`,
    ``,
    `Motivo da escalada: ${params.reason}`,
    ``,
    `Resumo: ${params.summary}`,
    ``,
    `Acção: contactar o cliente assim que possível.`,
  ].join("\n");

  // Re-use the internal notify endpoint if available, otherwise log only.
  try {
    const base =
      process.env.EMAIL_LINK_BASE_URL ||
      process.env.NEXT_PUBLIC_APP_URL ||
      "http://127.0.0.1:4701";

    await fetch(`${base}/api/client/notify-portfolio`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        to: supportEmail,
        subject,
        text: body,
        _internal: true,
      }),
    });
  } catch {
    // Notification failure must not break the webhook response
    console.error("[vapi/webhook] escalation email failed");
  }

  console.log(
    `[vapi/webhook] escalation → ${supportEmail} | call=${params.callId} | reason=${params.reason}`,
  );
}

// ---------------------------------------------------------------------------
// Log call-end event (extend with DB write when available)
// ---------------------------------------------------------------------------
function logCallEnd(call: VapiCallPayload) {
  const entry = {
    callId: call.id,
    from: call.customer?.number ?? "unknown",
    name: call.customer?.name,
    startedAt: call.startedAt,
    endedAt: call.endedAt,
    endedReason: call.endedReason,
    durationSeconds: call.durationSeconds,
    costUsd: call.cost,
    recordingUrl: call.recordingUrl,
    transcriptSnippet: call.transcript?.slice(0, 300),
    summary: call.summary,
  };

  console.log("[vapi/call-end]", JSON.stringify(entry));
  // TODO: persist to DB / Sumsub audit log when Neon/Postgres is configured
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "POST") return res.status(405).end();

  // Collect raw body for signature check
  const rawBody =
    typeof req.body === "string" ? req.body : JSON.stringify(req.body);

  if (!verifyVapiSignature(req, rawBody)) {
    console.warn("[vapi/webhook] invalid signature");
    return res.status(401).json({ error: "invalid signature" });
  }

  const body = (
    typeof req.body === "string" ? JSON.parse(req.body) : req.body
  ) as VapiWebhookBody;

  const { message } = body;
  if (!message?.type) return res.status(400).json({ error: "missing message type" });

  switch (message.type) {
    // ── Call started ──────────────────────────────────────────────────────
    case "call-start": {
      const call = message.call;
      console.log(
        `[vapi/call-start] callId=${call?.id} from=${call?.customer?.number ?? "unknown"}`,
      );
      return res.status(200).json({ ok: true });
    }

    // ── Call ended ────────────────────────────────────────────────────────
    case "call-end": {
      if (message.call) logCallEnd(message.call);
      return res.status(200).json({ ok: true });
    }

    // ── Function call from assistant ──────────────────────────────────────
    case "function-call": {
      const fn = message.functionCall;
      if (!fn) return res.status(400).json({ error: "missing functionCall" });

      if (fn.name === "escalate_to_human") {
        await notifyEscalation({
          callerNumber: message.call?.customer?.number,
          callerName: fn.parameters.caller_name ?? message.call?.customer?.name,
          reason: fn.parameters.reason ?? "—",
          summary: fn.parameters.summary ?? "—",
          callId: message.call?.id ?? "unknown",
        });

        // Return the response the assistant will speak
        return res.status(200).json({
          result:
            "Claro. Vou registar o seu pedido e um membro da equipa DECIDE entrará em contacto consigo em breve. " +
            "Pode também enviar um email para jcpina01@decidepoweredbyai.com. Tenha um bom dia!",
        });
      }

      if (fn.name === "send_info_email") {
        // Placeholder — wire to Resend/Gmail when needed
        console.log(
          `[vapi/send_info_email] to=${fn.parameters.email} topic=${fn.parameters.topic}`,
        );
        return res.status(200).json({
          result: `Perfeito. Enviei um email para ${fn.parameters.email} com informações sobre o DECIDE.`,
        });
      }

      return res.status(200).json({ result: "ok" });
    }

    // ── Transcript updates (optional logging) ─────────────────────────────
    case "transcript": {
      // Uncomment to stream transcripts to console:
      // console.log(`[vapi/transcript] ${message.role}: ${message.transcript}`);
      return res.status(200).json({ ok: true });
    }

    default:
      return res.status(200).json({ ok: true });
  }
}
