import type { NextApiRequest, NextApiResponse } from "next";
import { getPersonaStorageMode, listPersonaRecords } from "../../../lib/server/personaRecordsStore";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  if (getPersonaStorageMode() === "unconfigured") {
    return res.status(503).json({
      ok: false,
      error:
        "Armazenamento Persona não configurado: defina POSTGRES_URL ou DATABASE_URL (Neon) na Vercel.",
      records: [],
    });
  }

  const records = await listPersonaRecords();
  return res.status(200).json({ ok: true, records });
}
