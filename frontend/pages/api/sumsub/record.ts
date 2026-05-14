import type { NextApiRequest, NextApiResponse } from "next";
import {
  getSumsubStorageMode,
  upsertSumsubRecord,
  type SumsubRecordInput,
} from "../../../lib/server/sumsubRecordsStore";

export const config = {
  api: { bodyParser: { sizeLimit: "4mb" } },
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const body = req.body as Record<string, unknown> | null | undefined;

  const external_user_id =
    typeof body?.external_user_id === "string"
      ? body.external_user_id.trim()
      : "";
  const rawStatus = body?.status;
  const status =
    typeof rawStatus === "string"
      ? rawStatus.trim()
      : rawStatus != null
        ? String(rawStatus).trim()
        : "";

  if (!external_user_id || !status) {
    return res.status(400).json({ ok: false, error: "Missing external_user_id or status" });
  }

  const fields =
    body?.fields &&
    typeof body.fields === "object" &&
    body.fields !== null &&
    !Array.isArray(body.fields)
      ? (body.fields as Record<string, unknown>)
      : undefined;

  const input: SumsubRecordInput = {
    external_user_id,
    status,
    applicant_id:
      typeof body?.applicant_id === "string" ? body.applicant_id.trim() : undefined,
    review_answer:
      typeof body?.review_answer === "string" ? body.review_answer.trim() : undefined,
    name: typeof body?.name === "string" ? body.name.trim() : undefined,
    email: typeof body?.email === "string" ? body.email.trim() : undefined,
    phone: typeof body?.phone === "string" ? body.phone.trim() : undefined,
    fields,
  };

  try {
    await upsertSumsubRecord(input);
    return res.status(200).json({ ok: true });
  } catch (e: unknown) {
    console.error("[api/sumsub/record] upsert failed", e);
    const msg = e instanceof Error ? e.message : String(e);
    if (getSumsubStorageMode() === "unconfigured") {
      return res.status(503).json({
        ok: false,
        error: msg || "Armazenamento não configurado",
        hint: "Em produção (Vercel) defina POSTGRES_URL ou DATABASE_URL (Neon) nas variáveis de ambiente.",
      });
    }
    return res.status(500).json({ ok: false, error: msg || "Falha ao gravar" });
  }
}
