import fs from "fs";
import path from "path";
import type { NextApiRequest, NextApiResponse } from "next";
import { resolveDecideProjectRoot } from "../../../lib/server/decideProjectRoot";

type ApiResp =
  | {
      ok: true;
      source_path: string;
      payload: unknown;
    }
  | {
      ok: false;
      error: string;
      source_path?: string;
    };

export default function handler(req: NextApiRequest, res: NextApiResponse<ApiResp>) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const repoRoot = resolveDecideProjectRoot();
  const jsonPath = path.join(repoRoot, "backend", "data", "moderado_trial_risk_control_battery.json");

  try {
    if (!fs.existsSync(jsonPath)) {
      return res.status(404).json({
        ok: false,
        error: "Artifact not found. Run run_v5_sharpe_levers_battery.py first.",
        source_path: jsonPath,
      });
    }
    const raw = fs.readFileSync(jsonPath, "utf-8");
    const parsed = JSON.parse(raw);
    res.setHeader("Cache-Control", "private, no-store, no-cache, must-revalidate");
    return res.status(200).json({ ok: true, source_path: jsonPath, payload: parsed });
  } catch (err: any) {
    return res.status(500).json({
      ok: false,
      error: String(err?.message || err || "Failed to read model lab artifact"),
      source_path: jsonPath,
    });
  }
}

