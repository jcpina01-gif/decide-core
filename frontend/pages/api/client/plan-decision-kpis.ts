import type { NextApiRequest, NextApiResponse } from "next";
import {
  fetchPlafonadoCagrPctFromKpiServer,
  normalizeRiskProfileForKpi,
} from "../../../lib/server/fetchPlafonadoCagrFromKpiServer";
import { loadApprovalAlignedProposedTrades } from "../../../lib/server/approvalTradePlan";
import { resolveDecideProjectRoot } from "../../../lib/server/decideProjectRoot";
import { computePlanActivity } from "../../../lib/planDecisionKpiMath";
import {
  readPlafonadoM100CagrDisplayPercent,
  readPlanRecommendedCagrDisplayPercent,
} from "../../../lib/server/readPlafonadoFreezeCagr";
import { readHeroKpiFreezeContext } from "../../../lib/server/readHeroKpiFreezeContext";

type OkBody = {
  ok: true;
  navEur: number;
  assetCount: number;
  activityPct: number;
  changeBand: "elevadas" | "moderadas" | "reduzidas";
  grossBuyOrderVolumeEur: number;
  equityBuyVolumeEur: number;
  orderLegCount: number;
  totalAbsFlowEur: number;
  recommendedModelLabel: string;
  recommendedCagrPct: number | null;
  /** Intervalo de datas da série do benchmark no freeze (KPIs / histórico). */
  historyPeriodLabel: string | null;
  /** Anos inicial–final (ex. `2006–2026`) para contexto curto no dashboard. */
  historyYearRangeLabel: string | null;
  /** CAGR histórico da curva benchmark no freeze (mesma lógica que o iframe). */
  benchmarkCagrPct: number | null;
};

type ErrBody = { ok: false; error: string };

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<OkBody | ErrBody>,
) {
  if (req.method !== "GET") {
    res.status(405).json({ ok: false, error: "Method not allowed" });
    return;
  }
  try {
    const projectRoot = resolveDecideProjectRoot();
    const profile = normalizeRiskProfileForKpi(
      typeof req.query.profile === "string" ? req.query.profile : undefined,
    );
    const { trades, navEur, recommendedCagrPct: cagrFromModel } =
      await loadApprovalAlignedProposedTrades(projectRoot);
    const m = computePlanActivity(trades, navEur);
    /**
     * Hero = CAGR do **CAP15 plafonado** (mesma lógica que o cartão no iframe): freeze + série tipo embed,
     * depois Flask; só depois landing / plano de aprovação.
     */
    const profilePt =
      profile === "conservador"
        ? "Conservador"
        : profile === "dinamico"
          ? "Dinâmico"
          : "Moderado";
    const recommendedModelLabel = `Modelo ${profilePt} — limite máximo de 15% por posição`;
    const recommendedCagrPct =
      readPlafonadoM100CagrDisplayPercent(projectRoot, profile) ??
      (await fetchPlafonadoCagrPctFromKpiServer(profile)) ??
      readPlanRecommendedCagrDisplayPercent(projectRoot, profile) ??
      cagrFromModel;
    const { historyPeriodLabel, historyYearRangeLabel, benchmarkCagrPct } =
      readHeroKpiFreezeContext(projectRoot);
    res.status(200).json({
      ok: true,
      navEur,
      ...m,
      recommendedModelLabel,
      recommendedCagrPct,
      historyPeriodLabel,
      historyYearRangeLabel,
      benchmarkCagrPct,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(200).json({ ok: false, error: msg });
  }
}
