import type { NextApiRequest, NextApiResponse } from "next";
import { listSumsubRecords } from "../../../lib/server/sumsubRecordsStore";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    const records = await listSumsubRecords();
    return res.status(200).json({ ok: true, records });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return res.status(500).json({ ok: false, error: msg });
  }
}
