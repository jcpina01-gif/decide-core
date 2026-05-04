import fs from "fs";
import path from "path";

export type OfficialBatteryKpis = {
  scenarioName: string;
  cagrFraction: number | null;
  sharpe: number | null;
  maxDrawdownFraction: number | null;
  decisionNote: string | null;
  cvar1Fraction?: number | null;
  turnover?: number | null;
};

type BatteryScenario = {
  name?: unknown;
  overlayed_cagr?: unknown;
  overlayed_sharpe?: unknown;
  max_drawdown?: unknown;
};

type BatteryPayload = {
  main_candidate?: unknown;
  decision_note?: unknown;
  scenarios?: unknown;
};

export type PreviewModelVersionKey =
  | "official_v6"
  | "v7_dynamic_light"
  | "v7_dynamic_medium"
  | "v6_combo_floor070_convex22";

type V7SummaryRow = {
  name?: unknown;
  cagr?: unknown;
  sharpe?: unknown;
  max_drawdown?: unknown;
  cvar1?: unknown;
  turnover?: unknown;
};

type V7SummaryPayload = {
  summary_table?: unknown;
};

function toNum(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/**
 * Official KPI source shared with Model Lab:
 * backend/data/moderado_trial_risk_control_battery.json
 */
export function readOfficialModelBatteryKpis(projectRoot: string): OfficialBatteryKpis | null {
  const p = path.join(
    projectRoot,
    "backend",
    "data",
    "moderado_trial_risk_control_battery.json",
  );
  try {
    if (!fs.existsSync(p)) return null;
    const payload = JSON.parse(fs.readFileSync(p, "utf8")) as BatteryPayload;
    const rows = Array.isArray(payload.scenarios)
      ? (payload.scenarios as BatteryScenario[])
      : [];
    if (!rows.length) return null;
    const mainNameRaw = String(payload.main_candidate ?? "").trim();
    const byName = (n: string) => rows.find((r) => String(r.name ?? "").trim() === n);
    const chosen =
      (mainNameRaw ? byName(mainNameRaw) : undefined) ??
      byName("official_trial_now") ??
      rows[0];
    const scenarioName = String(chosen.name ?? "").trim() || "official_trial_now";
    return {
      scenarioName,
      cagrFraction: toNum(chosen.overlayed_cagr),
      sharpe: toNum(chosen.overlayed_sharpe),
      maxDrawdownFraction: toNum(chosen.max_drawdown),
      decisionNote:
        typeof payload.decision_note === "string" && payload.decision_note.trim().length > 0
          ? payload.decision_note.trim()
          : null,
    };
  } catch {
    return null;
  }
}

function mapPreviewVersionToSummaryRowName(version: PreviewModelVersionKey): string | null {
  if (version === "v7_dynamic_light") return "V7_dynamic_light";
  if (version === "v7_dynamic_medium") return "V7_dynamic_medium";
  if (version === "v6_combo_floor070_convex22") return "V6_combo_floor070_convex22";
  return null;
}

export function readPreviewModelSummaryKpis(
  projectRoot: string,
  version: PreviewModelVersionKey,
): OfficialBatteryKpis | null {
  const rowName = mapPreviewVersionToSummaryRowName(version);
  if (!rowName) return null;
  const p = path.join(projectRoot, "backend", "data", "moderado_v7_candidate_summary.json");
  try {
    if (!fs.existsSync(p)) return null;
    const payload = JSON.parse(fs.readFileSync(p, "utf8")) as V7SummaryPayload;
    const rows = Array.isArray(payload.summary_table)
      ? (payload.summary_table as V7SummaryRow[])
      : [];
    if (!rows.length) return null;
    const chosen = rows.find((r) => String(r.name ?? "").trim() === rowName);
    if (!chosen) return null;
    return {
      scenarioName: rowName,
      cagrFraction: toNum(chosen.cagr),
      sharpe: toNum(chosen.sharpe),
      maxDrawdownFraction: toNum(chosen.max_drawdown),
      cvar1Fraction: toNum(chosen.cvar1),
      turnover: toNum(chosen.turnover),
      decisionNote:
        version === "v7_dynamic_medium"
          ? "Preview V7 defensivo: variante com controlo de risco adicional e maior postura defensiva."
          : "Preview V7: candidato com controlo dinâmico de risco e melhoria de cauda versus V6.",
    };
  } catch {
    return null;
  }
}
