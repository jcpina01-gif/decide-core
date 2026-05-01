import Head from "next/head";
import Link from "next/link";
import React, { useEffect, useMemo, useState } from "react";

type ScenarioRow = {
  name: string;
  trial_profile_name?: string | null;
  overlayed_cagr?: number;
  overlayed_sharpe?: number;
  max_drawdown?: number;
  worst_day_p1?: number;
  cvar_daily_1pct?: number;
  avg_turnover?: number;
};

type ModelLabPayload = {
  scenarios?: ScenarioRow[];
};

function pct(v: unknown, digits = 2): string {
  if (typeof v !== "number" || !isFinite(v)) return "—";
  return `${(v * 100).toFixed(digits)}%`;
}

function num(v: unknown, digits = 3): string {
  if (typeof v !== "number" || !isFinite(v)) return "—";
  return v.toFixed(digits);
}

function titleFromKey(key: string): string {
  if (key === "baseline_3p3") return "Baseline 3+3";
  if (key === "baseline_5p5") return "Baseline 5+5";
  if (key === "moderado_trial_risk_control") return "Trial Risk Control";
  if (key === "vol_spike_3p3") return "Vol Spike 3+3";
  if (key === "concentration_control_3p3") return "Concentration Control 3+3";
  return key;
}

export default function ModelLabPage() {
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [rows, setRows] = useState<ScenarioRow[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setErr("");
      try {
        const r = await fetch("/api/client/model-lab-battery");
        const j = await r.json();
        if (!r.ok || !j?.ok) {
          throw new Error(j?.error || `HTTP ${r.status}`);
        }
        const payload = (j.payload || {}) as ModelLabPayload;
        const list = Array.isArray(payload.scenarios) ? payload.scenarios : [];
        if (!cancelled) setRows(list);
      } catch (e: any) {
        if (!cancelled) {
          setErr(String(e?.message || e || "Falha a carregar artefacto"));
          setRows([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const highlighted = useMemo(() => {
    const order = [
      "baseline_3p3",
      "baseline_5p5",
      "vol_spike_3p3",
      "concentration_control_3p3",
      "moderado_trial_risk_control",
    ];
    const map = new Map(rows.map((r) => [r.name, r] as const));
    return order.map((k) => map.get(k)).filter(Boolean) as ScenarioRow[];
  }, [rows]);

  return (
    <>
      <Head>
        <title>Model Lab | DECIDE</title>
      </Head>
      <main
        style={{
          minHeight: "100vh",
          background: "radial-gradient(circle at top, #0f172a 0%, #020617 45%, #020617 100%)",
          color: "#e5e7eb",
          padding: "24px 18px 40px",
        }}
      >
        <div style={{ maxWidth: 1200, margin: "0 auto" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
            <div>
              <h1 style={{ margin: 0, fontSize: 24, fontWeight: 900 }}>Model Lab</h1>
              <p style={{ marginTop: 8, color: "#9ca3af", fontSize: 13 }}>
                Comparação interna do perfil oficial vs trial (`moderado_trial_risk_control`).
              </p>
            </div>
            <Link
              href="/client-dashboard"
              style={{
                border: "1px solid rgba(148,163,184,0.35)",
                borderRadius: 10,
                padding: "8px 12px",
                color: "#e5e7eb",
                textDecoration: "none",
                fontWeight: 700,
                fontSize: 13,
              }}
            >
              Voltar ao dashboard
            </Link>
          </div>

          {loading ? <p style={{ color: "#94a3b8" }}>A carregar artefacto…</p> : null}
          {err ? <p style={{ color: "#fca5a5" }}>Erro: {err}</p> : null}

          {!loading && !err ? (
            <div
              style={{
                marginTop: 14,
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))",
                gap: 12,
              }}
            >
              {highlighted.map((row) => (
                <section
                  key={row.name}
                  style={{
                    border: "1px solid rgba(148,163,184,0.3)",
                    borderRadius: 12,
                    background: "rgba(15,23,42,0.55)",
                    padding: 12,
                  }}
                >
                  <div style={{ fontSize: 13, color: "#93c5fd", fontWeight: 800 }}>{titleFromKey(row.name)}</div>
                  <div style={{ marginTop: 8, fontSize: 13, lineHeight: 1.6 }}>
                    <div>CAGR: <strong>{pct(row.overlayed_cagr)}</strong></div>
                    <div>Sharpe: <strong>{num(row.overlayed_sharpe, 3)}</strong></div>
                    <div>Max DD: <strong>{pct(row.max_drawdown)}</strong></div>
                    <div>p1 diário: <strong>{pct(row.worst_day_p1)}</strong></div>
                    <div>CVaR1%: <strong>{pct(row.cvar_daily_1pct)}</strong></div>
                    <div>Turnover: <strong>{num(row.avg_turnover, 4)}</strong></div>
                  </div>
                </section>
              ))}
            </div>
          ) : null}
        </div>
      </main>
    </>
  );
}

