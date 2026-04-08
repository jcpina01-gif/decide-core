import React from "react";
import { DECIDE_DASHBOARD } from "../lib/decideClientTheme";

/** Único atalho no topo das páginas do fluxo cliente → dashboard Next (não Flask). */
export default function ClientFlowDashboardButton() {
  return (
    <a
      href="/client-dashboard?skipHedgeGate=1"
      style={{
        background: DECIDE_DASHBOARD.kpiMenuMainButtonBackground,
        color: DECIDE_DASHBOARD.kpiMenuMainButtonColor,
        borderRadius: 12,
        padding: "10px 18px",
        fontSize: 14,
        fontWeight: 800,
        textDecoration: "none",
        border: DECIDE_DASHBOARD.kpiMenuMainButtonBorder,
        display: "inline-block",
        whiteSpace: "nowrap",
        boxShadow: DECIDE_DASHBOARD.kpiMenuMainButtonShadow,
      }}
    >
      Ir para o dashboard
    </a>
  );
}
