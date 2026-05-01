import fs from "fs";
import path from "path";

export type OfficialBatteryKpis = {
  scenarioName: string;
  cagrFraction: number | null;
  sharpe: number | null;
  maxDrawdownFraction: number | null;
  decisionNote: string | null;
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
