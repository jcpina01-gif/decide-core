import type { NextApiRequest, NextApiResponse } from "next";
import {
  fetchPlafonadoCagrPctFromKpiServer,
  normalizeRiskProfileForKpi,
} from "../../../lib/server/fetchPlafonadoCagrFromKpiServer";
import { loadApprovalAlignedProposedTrades } from "../../../lib/server/approvalTradePlan";
import { resolveDecideProjectRoot } from "../../../lib/server/decideProjectRoot";
import {
  computePlanActivity,
  overlayedCagrToDisplayPercent,
} from "../../../lib/planDecisionKpiMath";
import {
  readPlafonadoM100CagrDisplayPercent,
  readPlanRecommendedCagrDisplayPercent,
} from "../../../lib/server/readPlafonadoFreezeCagr";
import { readHeroKpiFreezeContext } from "../../../lib/server/readHeroKpiFreezeContext";
import {
  readOfficialModelBatteryKpis,
  readPreviewModelSummaryKpis,
  type PreviewModelVersionKey,
} from "../../../lib/server/readOfficialModelBattery";

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
  recommendedSharpe: number | null;
  recommendedMaxDdPct: number | null;
  officialScenarioName: string | null;
  officialKpiNote: string | null;
  modelVersionKey: string;
  modelVersionPreview: boolean;
  adjustedEmbedLikeCagrPct: number | null;
  /** Intervalo de datas da série do benchmark no freeze (KPIs / histórico). */
  historyPeriodLabel: string | null;
  /** Anos inicial–final (ex. `2006–2026`) para contexto curto no dashboard. */
  historyYearRangeLabel: string | null;
  /** CAGR histórico da curva benchmark no freeze (mesma lógica que o iframe). */
  benchmarkCagrPct: number | null;
};

type ErrBody = { ok: false; error: string };

function normalizeModelVersion(raw: unknown): PreviewModelVersionKey {
  const v = String(raw ?? "").trim().toLowerCase();
  if (v === "v7_dynamic_light") return "v7_dynamic_light";
  if (v === "v7_dynamic_medium") return "v7_dynamic_medium";
  if (v === "v6_combo_floor070_convex22") return "v6_combo_floor070_convex22";
  return "official_v6";
}

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
    const requestedModelVersion = normalizeModelVersion(req.query.model_version);
    const envDefaultVersion = normalizeModelVersion(process.env.DECIDE_DEFAULT_MODEL_VERSION);
    const selectedModelVersion =
      requestedModelVersion !== "official_v6" ? requestedModelVersion : envDefaultVersion;
    const previewBattery =
      selectedModelVersion === "official_v6"
        ? null
        : readPreviewModelSummaryKpis(projectRoot, selectedModelVersion);
    const battery = previewBattery ?? readOfficialModelBatteryKpis(projectRoot);
    const modelVersionPreview = Boolean(previewBattery);
    const recommendedModelLabel = modelVersionPreview
      ? `Modelo ${profilePt} — preview ${selectedModelVersion}`
      : `Modelo ${profilePt} — KPI oficial do artefacto versionado`;
    const adjustedEmbedLikeCagrPct =
      readPlafonadoM100CagrDisplayPercent(projectRoot, profile) ??
      (await fetchPlafonadoCagrPctFromKpiServer(profile)) ??
      readPlanRecommendedCagrDisplayPercent(projectRoot, profile) ??
      cagrFromModel;
    const recommendedCagrPct =
      battery?.cagrFraction != null
        ? overlayedCagrToDisplayPercent(battery.cagrFraction)
        : adjustedEmbedLikeCagrPct;
    const recommendedSharpe = battery?.sharpe ?? null;
    const recommendedMaxDdPct =
      battery?.maxDrawdownFraction != null ? battery.maxDrawdownFraction * 100.0 : null;
    const { historyPeriodLabel, historyYearRangeLabel, benchmarkCagrPct } =
      readHeroKpiFreezeContext(projectRoot);
    res.status(200).json({
      ok: true,
      navEur,
      ...m,
      recommendedModelLabel,
      recommendedCagrPct,
      recommendedSharpe,
      recommendedMaxDdPct,
      officialScenarioName: battery?.scenarioName ?? null,
      officialKpiNote:
        battery?.decisionNote ??
        (modelVersionPreview
          ? "Preview V7 ativo. Esta vista não altera o modelo oficial em produção."
          : "KPIs oficiais calculados a partir do último artefacto de bateria versionado. Variantes ajustadas podem diferir."),
      modelVersionKey: selectedModelVersion,
      modelVersionPreview,
      adjustedEmbedLikeCagrPct,
      historyPeriodLabel,
      historyYearRangeLabel,
      benchmarkCagrPct,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(200).json({ ok: false, error: msg });
  }
}
