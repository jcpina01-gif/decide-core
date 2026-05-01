import Head from "next/head";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { isClientLoggedIn } from "../../lib/clientAuth";

type ScenarioRow = {
  name: string;
  overlayed_cagr: number;
  overlayed_sharpe: number;
  max_drawdown: number;
  worst_day_p1: number;
  cvar_daily_1pct: number;
  avg_turnover: number;
  pct_days_crash_overlay_active?: number;
  crash_overlay_entry_edges?: number;
};

type AcceptanceRow = {
  name: string;
  accepted: boolean;
  checks?: Record<string, boolean>;
};

type BatteryPayload = {
  decision_note?: string;
  main_candidate?: string;
  lab_references?: string[];
  scenarios?: ScenarioRow[];
  acceptance_evaluation?: AcceptanceRow[];
};

const pct = (v?: number) =>
  typeof v === "number" && Number.isFinite(v) ? `${(v * 100).toFixed(2)}%` : "—";
const num = (v?: number, d = 3) =>
  typeof v === "number" && Number.isFinite(v) ? v.toFixed(d) : "—";

export default function ModelLabPage() {
  const [loggedIn, setLoggedIn] = useState(false);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [data, setData] = useState<BatteryPayload | null>(null);

  useEffect(() => {
    setLoggedIn(isClientLoggedIn());
  }, []);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setLoading(true);
      setErr("");
      try {
        const r = await fetch("/api/client/model-lab-battery", { cache: "no-store" });
        const j = await r.json();
        if (!cancelled) {
          if (!j?.ok) setErr(j?.error || "Erro ao carregar bateria.");
          setData((j?.payload || null) as BatteryPayload | null);
        }
      } catch (e: any) {
        if (!cancelled) setErr(e?.message || "Erro de rede.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, []);

  const scenarios = useMemo(() => data?.scenarios || [], [data]);
  const checks = useMemo(() => data?.acceptance_evaluation || [], [data]);

  if (!loggedIn) {
    return (
      <main style={{ maxWidth: 880, margin: "24px auto", padding: 16 }}>
        <Head>
          <title>Model Lab</title>
        </Head>
        <h1 style={{ marginBottom: 8 }}>Model Lab</h1>
        <p>Esta página é interna e requer sessão iniciada.</p>
        <Link href="/client-dashboard">Voltar ao dashboard</Link>
      </main>
    );
  }

  return (
    <main style={{ maxWidth: 1100, margin: "18px auto", padding: 16 }}>
      <Head>
        <title>Model Lab</title>
      </Head>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <h1 style={{ margin: 0 }}>Model Lab</h1>
        <Link href="/client-dashboard">Voltar ao dashboard</Link>
      </div>

      {loading ? <p style={{ marginTop: 12 }}>A carregar resultados…</p> : null}
      {err ? <p style={{ marginTop: 12, color: "#fecaca" }}>Erro: {err}</p> : null}

      {data?.decision_note ? (
        <div style={{ marginTop: 12, padding: 10, border: "1px solid #475569", borderRadius: 10 }}>
          <strong>Nota:</strong> {data.decision_note}
        </div>
      ) : null}
      <div style={{ marginTop: 8, color: "#94a3b8", fontSize: 13 }}>
        Candidato principal: <strong>{data?.main_candidate || "—"}</strong>
        {" · "}Referências lab: <strong>{(data?.lab_references || []).join(", ") || "—"}</strong>
      </div>

      <div
        style={{
          marginTop: 14,
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
          gap: 10,
        }}
      >
        {scenarios.map((r) => (
          <section
            key={r.name}
            style={{ border: "1px solid #334155", borderRadius: 10, padding: 10, background: "rgba(15,23,42,0.35)" }}
          >
            <div style={{ fontWeight: 800, marginBottom: 8 }}>{r.name}</div>
            <div>CAGR: <strong>{pct(r.overlayed_cagr)}</strong></div>
            <div>Sharpe: <strong>{num(r.overlayed_sharpe, 4)}</strong></div>
            <div>Max DD: <strong>{pct(r.max_drawdown)}</strong></div>
            <div>p1 diário: <strong>{pct(r.worst_day_p1)}</strong></div>
            <div>CVaR1%: <strong>{pct(r.cvar_daily_1pct)}</strong></div>
            <div>Turnover: <strong>{num(r.avg_turnover, 4)}</strong></div>
            <div>% dias crash ativo: <strong>{num(r.pct_days_crash_overlay_active, 2)}%</strong></div>
            <div>Entradas crash: <strong>{r.crash_overlay_entry_edges ?? "—"}</strong></div>
          </section>
        ))}
      </div>

      {checks.length ? (
        <div style={{ marginTop: 16 }}>
          <h2 style={{ fontSize: 18, marginBottom: 8 }}>Acceptance check</h2>
          {checks.map((c) => (
            <div key={c.name} style={{ marginBottom: 6 }}>
              <strong>{c.name}</strong>:{" "}
              <span style={{ color: c.accepted ? "#86efac" : "#fca5a5" }}>{c.accepted ? "PASS" : "FAIL"}</span>
            </div>
          ))}
        </div>
      ) : null}
    </main>
  );
}
