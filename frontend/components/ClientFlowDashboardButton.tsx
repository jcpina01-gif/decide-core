import React from "react";

/** Único atalho no topo das páginas do fluxo cliente → dashboard Next (não Flask). */
export default function ClientFlowDashboardButton() {
  return (
    <a
      href="/client-dashboard"
      style={{
        background: "#3f73ff",
        color: "#fff",
        borderRadius: 12,
        padding: "10px 18px",
        fontSize: 14,
        fontWeight: 800,
        textDecoration: "none",
        border: "1px solid rgba(255,255,255,0.22)",
        display: "inline-block",
        whiteSpace: "nowrap",
      }}
    >
      Ir para o dashboard
    </a>
  );
}
