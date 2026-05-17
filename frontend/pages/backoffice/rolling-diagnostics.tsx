import Head from "next/head";
import type { CSSProperties } from "react";
import { useCallback, useEffect, useState } from "react";
import BackofficeShell from "../../components/backoffice/BackofficeShell";
import { backofficeGetServerSideProps } from "../../lib/backofficePageProps";
import type { RollingKpisResult } from "../api/backoffice/rolling-kpis";

const panel: CSSProperties = {
  background: "rgba(24, 24, 27, 0.92)",
  border: "1px solid rgba(63, 63, 70, 0.75)",
  borderRadius: 16,
  padding: 20,
  marginBottom: 18,
};
const muted: CSSProperties = { color: "#a1a1aa", fontSize: 13, lineHeight: 1.6 };
const h2: CSSProperties = { fontSize: 15, fontWeight: 800, marginBottom: 14, color: "#e4e4e7" };

function pct(v: number | null | undefined, dec = 1): string {
  if (v == null || !isFinite(v)) return "—";
  return (v * 100).toFixed(dec) + "%";
}
function pp(v: number | null | undefined, dec = 1): string {
  if (v == null || !isFinite(v)) return "—";
  const s = v >= 0 ? "+" : "";
  return `${s}${(v * 100).toFixed(dec)}pp`;
}
function num(v: number | null | undefined, dec = 2): string {
  if (v == null || !isFinite(v)) return "—";
  return v.toFixed(dec);
}

type Signal = "verde" | "amarelo" | "vermelho";

const SIGNAL_COLOR: Record<Signal, string> = {
  verde: "#4ade80",
  amarelo: "#fbbf24",
  vermelho: "#f87171",
};
const SIGNAL_BG: Record<Signal, string> = {
  verde: "rgba(74,222,128,0.08)",
  amarelo: "rgba(251,191,36,0.08)",
  vermelho: "rgba(248,113,113,0.08)",
};
const SIGNAL_BORDER: Record<Signal, string> = {
  verde: "rgba(74,222,128,0.3)",
  amarelo: "rgba(251,191,36,0.3)",
  vermelho: "rgba(248,113,113,0.3)",
};
const SIGNAL_LABEL: Record<Signal, string> = {
  verde: "🟢 Verde — continuar sem alterar",
  amarelo: "🟡 Amarelo — monitorizar",
  vermelho: "🔴 Vermelho — considerar intervenção",
};

function KpiCard({
  label,
  value,
  sub,
  alert,
}: {
  label: string;
  value: string;
  sub?: string;
  alert?: boolean;
}) {
  return (
    <div
      style={{
        background: alert ? "rgba(248,113,113,0.07)" : "#18181b",
        border: `1px solid ${alert ? "rgba(248,113,113,0.4)" : "#3f3f46"}`,
        borderRadius: 10,
        padding: "12px 14px",
      }}
    >
      <div style={{ fontSize: 11, color: "#71717a", marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 800, color: alert ? "#f87171" : "#fafafa" }}>
        {value}
      </div>
      {sub ? <div style={{ fontSize: 11, color: "#52525b", marginTop: 2 }}>{sub}</div> : null}
    </div>
  );
}

export default function BackofficeRollingDiagnosticsPage() {
  const [data, setData] = useState<RollingKpisResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const r = await fetch("/api/backoffice/rolling-kpis", { credentials: "same-origin" });
      const j = (await r.json()) as { ok?: boolean; result?: RollingKpisResult; error?: string };
      if (!r.ok || !j.ok) throw new Error(j.error ?? "Erro a carregar");
      setData(j.result ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const d = data;
  const sig = d?.signal ?? "amarelo";

  return (
    <>
      <Head>
        <title>Diagnóstico Rolling — Back-office Decide</title>
        <meta name="robots" content="noindex,nofollow" />
      </Head>
      <BackofficeShell
        active="rolling-diagnostics"
        title="Diagnóstico (rolling)"
        subtitle="Detectar degradação estrutural vs flutuação esperada — janelas móveis 5y e 10y, Sharpe relativo, spread, z-score, recovery."
      >
        {error ? <p style={{ color: "#f87171", marginBottom: 16 }}>{error}</p> : null}
        {loading ? <p style={{ color: "#a1a1aa", marginBottom: 16 }}>A calcular…</p> : null}

        {d ? (
          <>
            {/* ── Semáforo ─────────────────────────────────────────────── */}
            <div
              style={{
                ...panel,
                background: SIGNAL_BG[sig],
                borderColor: SIGNAL_BORDER[sig],
              }}
            >
              <div style={{ fontSize: 17, fontWeight: 800, color: SIGNAL_COLOR[sig], marginBottom: 10 }}>
                {SIGNAL_LABEL[sig]}
              </div>
              <div style={{ fontSize: 12, color: "#a1a1aa", marginBottom: d.signalReasons.length ? 10 : 0 }}>
                Freeze: {d.dataEnd} · {d.nObs} dias úteis
              </div>
              {d.signalReasons.length > 0 ? (
                <ul style={{ margin: 0, paddingLeft: 18 }}>
                  {d.signalReasons.map((r, i) => (
                    <li key={i} style={{ fontSize: 13, color: "#fcd34d", marginBottom: 4 }}>
                      {r}
                    </li>
                  ))}
                </ul>
              ) : (
                <p style={{ ...muted, margin: 0 }}>
                  Todos os indicadores dentro dos limites normais. Nenhuma acção recomendada.
                </p>
              )}
            </div>

            {/* ── Rolling 5y ───────────────────────────────────────────── */}
            <div style={panel}>
              <div style={h2}>Rolling 5 Anos (últimos ~1260 dias úteis)</div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))",
                  gap: 10,
                  marginBottom: 10,
                }}
              >
                <KpiCard label="CAGR Modelo" value={pct(d.rolling5y.cagrModel)} />
                <KpiCard label="CAGR Benchmark" value={pct(d.rolling5y.cagrBench)} />
                <KpiCard
                  label="Spread (modelo − bench)"
                  value={pp(d.rolling5y.spread)}
                  alert={d.rolling5y.spread !== null && d.rolling5y.spread < 0}
                />
                <KpiCard
                  label="Sharpe relativo 5y"
                  value={num(d.rolling5y.sharpeRelative)}
                  alert={d.rolling5y.sharpeRelative !== null && d.rolling5y.sharpeRelative < 0}
                  sub={`neg. em ${(d.rolling5y.pctNegativeSharpeRel * 100).toFixed(0)}% das janelas`}
                />
                <KpiCard label="Sharpe modelo (Rf 2%)" value={num(d.rolling5y.sharpeModel)} />
                <KpiCard
                  label="Z-score spread"
                  value={num(d.rolling5y.zScoreSpread)}
                  alert={d.rolling5y.zScoreSpread !== null && d.rolling5y.zScoreSpread < -1.5}
                  sub="vs distribuição histórica"
                />
                <KpiCard label="Max Drawdown" value={pct(d.rolling5y.mddModel)} />
              </div>
              <p style={{ ...muted, marginBottom: 0 }}>
                <strong style={{ color: "#e4e4e7" }}>Alerta:</strong> Sharpe relativo &lt; 0 persistente · Spread &lt; 0 · Z-score &lt; −2.{" "}
                <strong style={{ color: "#e4e4e7" }}>Normal:</strong> Z-score entre −1 e +1.
              </p>
            </div>

            {/* ── Rolling 10y ──────────────────────────────────────────── */}
            <div style={panel}>
              <div style={h2}>Rolling 10 Anos (âncora longa)</div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))",
                  gap: 10,
                  marginBottom: 10,
                }}
              >
                <KpiCard label="CAGR Modelo" value={pct(d.rolling10y.cagrModel)} />
                <KpiCard label="CAGR Benchmark" value={pct(d.rolling10y.cagrBench)} />
                <KpiCard
                  label="Spread (modelo − bench)"
                  value={pp(d.rolling10y.spread)}
                  alert={d.rolling10y.spread !== null && d.rolling10y.spread < 0.03}
                />
                <KpiCard label="Sharpe modelo (Rf 2%)" value={num(d.rolling10y.sharpeModel)} />
                <KpiCard label="Max Drawdown" value={pct(d.rolling10y.mddModel)} />
              </div>
              <p style={{ ...muted, marginBottom: 0 }}>
                A âncora de 10 anos é o indicador mais robusto de edge estrutural. Spread &gt; +5pp é saudável.
              </p>
            </div>

            {/* ── Recovery ─────────────────────────────────────────────── */}
            <div style={panel}>
              <div style={h2}>Recovery (tempo de recuperação)</div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
                  gap: 10,
                  marginBottom: 10,
                }}
              >
                <KpiCard
                  label="Em drawdown?"
                  value={d.recovery.inDrawdown ? "Sim" : "Não"}
                  sub={d.recovery.inDrawdown ? `${d.recovery.currentStreakDays} dias submerso` : "No topo histórico ou próximo"}
                />
                <KpiCard
                  label="Percentil recovery actual"
                  value={
                    d.recovery.inDrawdown && d.recovery.percentile != null
                      ? `P${(d.recovery.percentile * 100).toFixed(0)}`
                      : "—"
                  }
                  alert={
                    d.recovery.inDrawdown &&
                    d.recovery.percentile !== null &&
                    d.recovery.percentile > 0.8
                  }
                  sub="vs histórico de recoveries"
                />
              </div>
              <p style={{ ...muted, marginBottom: 0 }}>
                <strong style={{ color: "#e4e4e7" }}>Alerta:</strong> P &gt; 80.{" "}
                <strong style={{ color: "#e4e4e7" }}>Forte:</strong> P &gt; 90 — possível regime diferente.
              </p>
            </div>

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button
                type="button"
                onClick={() => void load()}
                disabled={loading}
                style={{
                  padding: "10px 16px",
                  borderRadius: 10,
                  border: "1px solid #3f3f46",
                  background: "#27272a",
                  color: "#fff",
                  fontWeight: 700,
                  cursor: loading ? "wait" : "pointer",
                }}
              >
                Recalcular
              </button>
              <p style={{ ...muted, alignSelf: "center", margin: 0 }}>
                Dados: freeze moderado · Rf 2% EUR · janela 5y = {WINDOW_5Y_LABEL} · janela 10y = {WINDOW_10Y_LABEL}
              </p>
            </div>
          </>
        ) : null}
      </BackofficeShell>
    </>
  );
}

const WINDOW_5Y_LABEL = "252×5 dias úteis";
const WINDOW_10Y_LABEL = "252×10 dias úteis";

export const getServerSideProps = backofficeGetServerSideProps;
