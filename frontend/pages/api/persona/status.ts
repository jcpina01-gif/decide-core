import type { NextApiRequest, NextApiResponse } from "next";
import { getPersonaRecordByReference, getPersonaStorageMode } from "../../../lib/server/personaRecordsStore";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const referenceId = typeof req.query.reference_id === "string" ? req.query.reference_id.trim() : "";
  if (!referenceId) {
    return res.status(400).json({ ok: false, error: "Missing reference_id", record: null });
  }

  if (getPersonaStorageMode() === "unconfigured") {
    return res.status(503).json({
      ok: false,
      error:
        "Armazenamento Persona não configurado: defina POSTGRES_URL ou DATABASE_URL (Neon) na Vercel.",
      record: null,
    });
  }

  const record = await getPersonaRecordByReference(referenceId);
  if (!record) {
    return res.status(404).json({ ok: false, error: "Not found", record: null });
  }

  return res.status(200).json({ ok: true, record });
}
