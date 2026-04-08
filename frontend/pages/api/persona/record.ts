import type { NextApiRequest, NextApiResponse } from "next";
import { extractDisplayNameFromPersonaRecord } from "../../../lib/personaDisplayName";
import { getPersonaStorageMode, upsertPersonaRecord, type PersonaRecordInput } from "../../../lib/server/personaRecordsStore";

export const config = {
  api: {
    bodyParser: {
      sizeLimit: "4mb",
    },
  },
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const body = req.body as Record<string, unknown> | null | undefined;
  const reference_id =
    typeof body?.reference_id === "string"
      ? body.reference_id.trim()
      : body?.reference_id != null
        ? String(body.reference_id).trim()
        : "";
  const rawStatus = body?.status;
  const status =
    typeof rawStatus === "string"
      ? rawStatus.trim()
      : rawStatus != null && rawStatus !== ""
        ? String(rawStatus).trim()
        : "";
  if (!reference_id || !status) {
    return res.status(400).json({ ok: false, error: "Missing reference_id or status" });
  }

  const fields =
    body?.fields && typeof body.fields === "object" && body.fields !== null && !Array.isArray(body.fields)
      ? (body.fields as Record<string, unknown>)
      : undefined;

  let nameIn = typeof body?.name === "string" ? body.name.trim() : "";
  if (!nameIn && fields) {
    nameIn = extractDisplayNameFromPersonaRecord({ name: null, fields });
  }

  const input: PersonaRecordInput = {
    reference_id,
    status,
    external_user_id: typeof body?.external_user_id === "string" ? body.external_user_id.trim() : undefined,
    inquiry_id: typeof body?.inquiry_id === "string" ? body.inquiry_id.trim() : undefined,
    name: nameIn || undefined,
    email: typeof body?.email === "string" ? body.email.trim() : undefined,
    phone: typeof body?.phone === "string" ? body.phone.trim() : undefined,
    fields,
  };

  try {
    await upsertPersonaRecord(input);
    return res.status(200).json({ ok: true });
  } catch (e: unknown) {
    console.error("[api/persona/record] upsert failed", e);
    const msg = e instanceof Error ? e.message : String(e);
    if (getPersonaStorageMode() === "unconfigured") {
      return res.status(503).json({
        ok: false,
        error: msg || "Armazenamento não configurado",
        hint: "Em produção (Vercel) defina POSTGRES_URL ou DATABASE_URL (Neon) nas variáveis de ambiente.",
      });
    }
    return res.status(500).json({ ok: false, error: msg || "Falha ao gravar" });
  }
}
