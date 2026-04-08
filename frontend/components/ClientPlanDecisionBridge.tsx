import React from "react";
import { planDecisionBridgeText, type DashboardRiskProfile } from "../lib/modelRobustnessCopy";

type Props = {
  profile: DashboardRiskProfile;
};

/** Liga o bloco de robustez ao plano recomendado (fluxo confiança → decisão). */
export default function ClientPlanDecisionBridge({ profile }: Props) {
  return (
    <p className="decide-app-plan-decision-bridge" role="note">
      {planDecisionBridgeText(profile)}
    </p>
  );
}
