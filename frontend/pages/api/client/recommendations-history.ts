/**
 * API: histórico de recomendações oficiais (pesos por `rebalance_date`).
 * Lógica partilhada em `lib/server/buildRecommendationOfficialHistory.ts`.
 */
import path from "path";
import type { NextApiRequest, NextApiResponse } from "next";

import { resolveDecideProjectRoot } from "../../../lib/server/decideProjectRoot";
import {
  buildOfficialRecommendationMonthsThroughToday,
  RECOMMENDATION_WEIGHTS_CANDIDATE_FILES,
} from "../../../lib/server/buildRecommendationOfficialHistory";

export type {
  FlowRow,
  PriorMonthBar,
  RecommendationMonth,
  RecommendationRow,
} from "../../../lib/server/buildRecommendationOfficialHistory";

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  res.setHeader("Cache-Control", "private, no-store, max-age=0, must-revalidate");

  const root = resolveDecideProjectRoot(process.cwd());
  const built = buildOfficialRecommendationMonthsThroughToday(root);
  if (!built) {
    return res.status(404).json({
      ok: false,
      error:
        "Nenhum CSV de histórico encontrado (weights_by_rebalance*.csv). Coloca um em backend/data/ ou freeze/.",
      tried: [...RECOMMENDATION_WEIGHTS_CANDIDATE_FILES].map((r) => r.split("/").join(path.sep)),
    });
  }

  return res.status(200).json({
    ok: true,
    sourcePath: built.sourcePath,
    sourceFiles: built.sourceFiles,
    nMonths: built.months.length,
    months: built.months,
  });
}
