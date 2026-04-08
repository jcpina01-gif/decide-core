import Link from "next/link";
import React from "react";
import { DECIDE_DASHBOARD } from "../lib/decideClientTheme";
import {
  getRobustnessNumbersForProfile,
  MODEL_ROBUSTNESS_DASHBOARD_TITLE,
  MODEL_ROBUSTNESS_DETAILS_SUMMARY,
  MODEL_ROBUSTNESS_DISCLAIMER,
  MODEL_ROBUSTNESS_EXPAND_TITLE,
  MODEL_ROBUSTNESS_METHODOLOGY_HREF,
  modelRobustnessClosingLine,
  modelRobustnessDashboardLead,
  type DashboardRiskProfile,
} from "../lib/modelRobustnessCopy";

const pStyle: React.CSSProperties = {
  margin: "0 0 10px",
  fontSize: 13,
  lineHeight: 1.55,
  color: "#d4d4d8",
};

type Props = {
  riskProfile?: DashboardRiskProfile;
};

/**
 * Dashboard — resumo + detalhe (accordion); números alinhados ao perfil activo.
 */
export default function ClientModelRobustnessNotice({ riskProfile = "moderado" }: Props) {
  const nums = getRobustnessNumbersForProfile(riskProfile);

  return (
    <section className="decide-app-model-robustness" aria-labelledby="model-robustness-title">
      <h2
        id="model-robustness-title"
        className="decide-app-model-robustness-title"
        style={{
          margin: "0 0 8px",
          fontSize: 15,
          fontWeight: 900,
          color: "var(--text-primary)",
          letterSpacing: "-0.02em",
        }}
      >
        {MODEL_ROBUSTNESS_DASHBOARD_TITLE}
      </h2>
      {modelRobustnessDashboardLead().map((t, i) => (
        <p key={i} style={pStyle}>
          {t}
        </p>
      ))}

      <details className="decide-app-model-robustness-details">
        <summary className="decide-app-model-robustness-summary">{MODEL_ROBUSTNESS_DETAILS_SUMMARY}</summary>
        <div className="decide-app-model-robustness-details-body">
          <h3 className="decide-app-model-robustness-expand-heading">{MODEL_ROBUSTNESS_EXPAND_TITLE}</h3>
          <ul className="decide-app-model-robustness-list">
            <li>{nums.historicLine}</li>
            <li>{nums.costsLine}</li>
            <li>{nums.lagLine}</li>
          </ul>
          <div className="decide-app-robustness-conservative-callout" role="status">
            <div className="decide-app-robustness-conservative-callout-label">{nums.conservativeTitle}</div>
            <div className="decide-app-robustness-conservative-callout-value">{nums.conservativeValue}</div>
          </div>
          <p className="decide-app-model-robustness-closing">{modelRobustnessClosingLine()}</p>
          <p style={{ ...pStyle, marginTop: 14, marginBottom: 0 }}>
            <Link
              href={MODEL_ROBUSTNESS_METHODOLOGY_HREF}
              style={{ color: DECIDE_DASHBOARD.link, fontWeight: 800 }}
            >
              Metodologia completa
            </Link>
            <span style={{ color: "#71717a" }}> — detalhe técnico e contexto.</span>
          </p>
        </div>
      </details>

      <p className="decide-app-model-robustness-disclaimer">{MODEL_ROBUSTNESS_DISCLAIMER}</p>
    </section>
  );
}
