import Link from "next/link";
import type { ReactNode } from "react";
import { useState } from "react";
import { DecideBrandImage } from "../DecideLogoHeader";

export type BackofficeNavId =
  | "dashboard"
  | "clients"
  | "activity"
  | "monitoring"
  | "model-monitoring"
  | "rolling-diagnostics"
  | "kpi-diagnostics"
  | "calls"
  | "audit"
  | "audit-guide";

const ITEMS: { id: BackofficeNavId; href: string; label: string }[] = [
  { id: "dashboard", href: "/backoffice", label: "Painel" },
  { id: "clients", href: "/backoffice/clients", label: "Clientes" },
  { id: "activity", href: "/backoffice/activity", label: "Atividade" },
  { id: "monitoring", href: "/backoffice/monitoring", label: "Monitorização" },
  { id: "model-monitoring", href: "/backoffice/model-monitoring", label: "Modelo" },
  { id: "rolling-diagnostics", href: "/backoffice/rolling-diagnostics", label: "Diagnóstico" },
  { id: "calls", href: "/backoffice/calls", label: "Chamadas" },
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
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#080c14",
        color: "#e4e4e7",
        fontFamily: "'Nunito', system-ui, sans-serif",
        boxSizing: "border-box",
      }}
    >
      {/* ── Top bar — same pattern as client app ───────────────────── */}
      <header
        style={{
          borderBottom: "1px solid rgba(255,255,255,0.06)",
          background: "rgba(8, 12, 20, 0.97)",
          position: "sticky",
          top: 0,
          zIndex: 60,
        }}
      >
        <div
          style={{
            maxWidth: 1280,
            margin: "0 auto",
            padding: "0 20px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
          }}
        >
          {/* Logo */}
          <Link href="/backoffice" style={{ display: "flex", alignItems: "center", textDecoration: "none", flexShrink: 0 }}>
            <DecideBrandImage
              priority
              height={52}
              maxWidth="140px"
              sizes="140px"
              knockoutBackground={false}
              className="decide-logo-img--plain"
            />
          </Link>

          {/* Desktop nav */}
          <nav
            aria-label="Back-office"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 4,
              flexWrap: "nowrap",
              overflowX: "auto",
              flex: 1,
              justifyContent: "center",
            }}
          >
            {ITEMS.map((item) => {
              const on = item.id === active;
              return (
                <Link
                  key={item.id}
                  href={item.href}
                  style={{
                    padding: "8px 12px",
                    borderRadius: 8,
                    fontSize: 13,
                    fontWeight: on ? 800 : 600,
                    textDecoration: "none",
                    whiteSpace: "nowrap",
                    color: on ? "#2dd4bf" : "#94a3b8",
                    background: on ? "rgba(45,212,191,0.1)" : "transparent",
                    border: on ? "1px solid rgba(45,212,191,0.25)" : "1px solid transparent",
                    transition: "all 0.12s",
                  }}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>

          {/* Right: back to site */}
          <Link
            href="/"
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: "#64748b",
              textDecoration: "none",
              whiteSpace: "nowrap",
              padding: "6px 12px",
              borderRadius: 8,
              border: "1px solid rgba(255,255,255,0.07)",
              background: "rgba(255,255,255,0.03)",
              flexShrink: 0,
            }}
          >
            ← Site
          </Link>
        </div>
      </header>

      {/* ── Page heading ────────────────────────────────────────────── */}
      <div
        style={{
          maxWidth: 1280,
          margin: "0 auto",
          padding: "32px 20px 8px",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            justifyContent: "space-between",
            gap: 16,
            marginBottom: subtitle ? 6 : 20,
          }}
        >
          <h1
            style={{
              fontSize: 26,
              fontWeight: 900,
              color: "#f1f5f9",
              margin: 0,
              letterSpacing: "-0.02em",
            }}
          >
            {title}
          </h1>
          <span
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: "#334155",
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              whiteSpace: "nowrap",
            }}
          >
            Área interna
          </span>
        </div>
        {subtitle ? (
          <p
            style={{
              fontSize: 13,
              color: "#64748b",
              margin: "0 0 24px",
              lineHeight: 1.55,
              maxWidth: 620,
            }}
          >
            {subtitle}
          </p>
        ) : (
          <div style={{ marginBottom: 24 }} />
        )}
      </div>

      {/* ── Content ─────────────────────────────────────────────────── */}
      <main
        style={{
          maxWidth: 1280,
          margin: "0 auto",
          padding: "0 20px 64px",
          boxSizing: "border-box",
        }}
      >
        {children}
      </main>
    </div>
  );
}
