import fs from "fs";
import path from "path";
import type { NextApiRequest, NextApiResponse } from "next";
import { resolveDecideProjectRoot } from "../../../lib/server/decideProjectRoot";

type ApiResp =
  | { ok: true; source_path: string; payload: unknown }
  | { ok: false; error: string; source_path?: string };

export default function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResp>,
) {
  if (req.method !== "GET") {
    res.status(405).json({ ok: false, error: "Method not allowed" });
    return;
  }

  const repoRoot = resolveDecideProjectRoot();
  const variant = String(req.query.variant ?? "").trim().toLowerCase();
  const jsonPath =
    variant === "v7"
      ? path.join(repoRoot, "backend", "data", "moderado_v7_candidate_summary.json")
      : path.join(repoRoot, "backend", "data", "moderado_trial_risk_control_battery.json");

  try {
    const txt = fs.readFileSync(jsonPath, "utf-8");
    const payload = JSON.parse(txt);
    res.status(200).json({ ok: true, source_path: jsonPath, payload });
  } catch (err: any) {
    res.status(200).json({
      ok: false,
      error: err?.message || "Failed to read model lab battery",
      source_path: jsonPath,
    });
  }
}
