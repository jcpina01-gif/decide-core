import Link from "next/link";
import type { ReactNode } from "react";
import { DECIDE_APP_FONT_FAMILY, DECIDE_DASHBOARD } from "../../lib/decideClientTheme";

export type BackofficeNavId =
  | "dashboard"
  | "clients"
  | "activity"
  | "monitoring"
  | "model-monitoring"
  | "kpi-diagnostics"
  | "audit"
  | "audit-guide";

const ITEMS: { id: BackofficeNavId; href: string; label: string }[] = [
  { id: "dashboard", href: "/backoffice", label: "Painel" },
  { id: "clients", href: "/backoffice/clients", label: "Clientes" },
  { id: "activity", href: "/backoffice/activity", label: "Atividade" },
  { id: "monitoring", href: "/backoffice/monitoring", label: "Monitorização" },
  { id: "model-monitoring", href: "/backoffice/model-monitoring", label: "Modelo (research)" },
  { id: "kpi-diagnostics", href: "/backoffice/kpi-diagnostics", label: "Diagnóstico KPI" },
  { id: "audit", href: "/backoffice/audit", label: "Auditoria" },
  { id: "audit-guide", href: "/backoffice/audit-logs", label: "Guia MiFID" },
];

export default function BackofficeShell({
  active,
  title,
  subtitle,
  children,
}: {
  active: BackofficeNavId;
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#09090b",
        color: "#fafafa",
        fontFamily: DECIDE_APP_FONT_FAMILY,
        boxSizing: "border-box",
      }}
    >
      <header
        style={{
          borderBottom: "1px solid rgba(63, 63, 70, 0.85)",
          padding: "16px 20px 12px",
          background: "rgba(9, 9, 11, 0.98)",
        }}
      >
        <div
          style={{
            maxWidth: 1200,
            margin: "0 auto",
            display: "flex",
            flexWrap: "wrap",
            alignItems: "baseline",
            justifyContent: "space-between",
            gap: 12,
          }}
        >
          <div>
            <div style={{ fontSize: 11, color: "#71717a", letterSpacing: "0.06em", marginBottom: 4 }}>
              DECIDE · Área interna
            </div>
            <div style={{ fontSize: 20, fontWeight: 800 }}>{title}</div>
            {subtitle ? (
              <div style={{ marginTop: 6, fontSize: 14, color: "#a1a1aa", maxWidth: 560, lineHeight: 1.5 }}>
                {subtitle}
              </div>
            ) : null}
          </div>
          <Link
            href="/"
            style={{
              fontSize: 13,
              color: "#71717a",
              textDecoration: "none",
              whiteSpace: "nowrap",
            }}
          >
            ← Site público
          </Link>
        </div>
        <nav
          style={{
            maxWidth: 1200,
            margin: "14px auto 0",
            display: "flex",
            flexWrap: "wrap",
            gap: 8,
          }}
          aria-label="Back-office"
        >
          {ITEMS.map((item) => {
            const on = item.id === active;
            return (
              <Link
                key={item.id}
                href={item.href}
                style={{
                  padding: "8px 14px",
                  borderRadius: 10,
                  fontSize: 13,
                  fontWeight: on ? 800 : 600,
                  textDecoration: "none",
                  color: on ? "#fff" : "#a1a1aa",
                  background: on ? "rgba(45, 212, 191, 0.15)" : "rgba(39, 39, 42, 0.6)",
                  border: on ? `1px solid ${DECIDE_DASHBOARD.accentSky}` : "1px solid transparent",
                }}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      </header>
      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "24px 20px 48px", boxSizing: "border-box" }}>
        {children}
      </div>
    </div>
  );
}
