import type { NextApiRequest, NextApiResponse } from "next";
import {
  getSumsubRecordByUserId,
  getSumsubStorageMode,
} from "../../../lib/server/sumsubRecordsStore";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const externalUserId =
    typeof req.query.external_user_id === "string"
      ? req.query.external_user_id.trim()
      : "";
  if (!externalUserId) {
    return res
      .status(400)
      .json({ ok: false, error: "Missing external_user_id", record: null });
  }

  if (getSumsubStorageMode() === "unconfigured") {
    return res.status(503).json({
      ok: false,
      error:
        "Armazenamento Sumsub não configurado: defina POSTGRES_URL ou DATABASE_URL (Neon) na Vercel.",
      record: null,
    });
  }

  const record = await getSumsubRecordByUserId(externalUserId);
  if (!record) {
    return res.status(404).json({ ok: false, error: "Not found", record: null });
  }

  return res.status(200).json({ ok: true, record });
}
