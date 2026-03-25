import type { NextApiRequest, NextApiResponse } from "next";
import path from "path";
import type { BackendPortfolio } from "../../../lib/performanceSeries";
import { alignSeries, normalizeBase100, parseCsvSeries } from "../../../lib/performanceSeries";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const backendUrl = "http://127.0.0.1:8090/api/portfolio/current";
    const backendRes = await fetch(backendUrl);
    if (!backendRes.ok) {
      return res.status(backendRes.status).json({
        ok: false,
        error: `Backend portfolio endpoint failed: ${backendRes.status}`,
      });
    }

    const portfolio = (await backendRes.json()) as BackendPortfolio;
    const sourceFile = portfolio.source_file;

    if (!sourceFile) {
      return res.status(500).json({
        ok: false,
        error: "Missing source_file in backend payload",
      });
    }

    const sourceDir = path.dirname(sourceFile);
    const modelFile = path.join(sourceDir, "model_equity_final_20y.csv");
    const benchFile = path.join(sourceDir, "benchmark_equity_final_20y.csv");

    const modelRaw = parseCsvSeries(modelFile, ["equity", "model", "value", "nav", "close"]);
    const benchRaw = parseCsvSeries(benchFile, ["equity", "benchmark", "value", "nav", "close"]);

    const model = normalizeBase100(modelRaw);
    const benchmark = normalizeBase100(benchRaw);
    const points = alignSeries(model, benchmark);

    return res.status(200).json({
      ok: true,
      model_version: portfolio.model_version || "",
      source_dir: sourceDir,
      points,
    });
  } catch (err: any) {
    return res.status(500).json({
      ok: false,
      error: err?.message || "Unknown error in /api/performance/series",
    });
  }
}