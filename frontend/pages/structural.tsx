import React, { useEffect, useMemo, useState } from "react";

type StructuralRow = {
  asof: string;
  raw_state: "LOW" | "NEUTRAL" | "STRESS" | "RECOVERY" | string;
  smoothed_state: "LOW" | "NEUTRAL" | "STRESS" | "RECOVERY" | string;
  transition: number;
  signals?: Record<string, any>;
  details?: Record<string, any>;
};

type StateV1Response = {
  ok: boolean;
  asof: string;
  raw_state: string;
  state: string; // smoothed_state (backward friendly)
  smoothed_state: string;
  signals: Record<string, any>;
  details: Record<string, any>;
  tws_dir?: string;
  history_tail?: StructuralRow[];
  persistence?: Record<string, any>;
};

function stateColor(state: string): string {
  switch (state) {
    case "LOW":
      return "#22c55e";
    case "NEUTRAL":
      return "#eab308";
    case "STRESS":
      return "#ef4444";
    case "RECOVERY":
      return "#d4d4d4";
    default:
      return "#a1a1aa";
  }
}

function badgeStyle(): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    padding: "6px 10px",
    borderRadius: 999,
    background: "rgba(255,255,255,0.06)",
    border: `1px solid rgba(255,255,255,0.12)`,
    color: "#fff",
    fontSize: 12,
    lineHeight: "12px",
    userSelect: "none",
  };
}

function dotStyle(state: string): React.CSSProperties {
  return {
    width: 10,
    height: 10,
    borderRadius: 999,
    background: stateColor(state),
    boxShadow: `0 0 0 3px rgba(255,255,255,0.06)`,
  };
}

async function postJson<T>(url: string, body: any, timeoutMs = 180000): Promise<T> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const text = await res.text();
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = { raw_text: text };
    }
    if (!res.ok) {
      const msg = json?.detail ? JSON.stringify(json.detail) : JSON.stringify(json);
      throw new Error(`${res.status} ${res.statusText} - ${msg}`);
    }
    return json as T;
  } finally {
    clearTimeout(t);
  }
}

function fmtPct(x: any, digits = 1): string {
  const n = Number(x);
  if (!isFinite(n)) return "-";
  return `${(n * 100).toFixed(digits)}%`;
}
function fmtBps(x: any, digits = 0): string {
  const n = Number(x);
  if (!isFinite(n)) return "-";
  return `${n.toFixed(digits)} bps`;
}

type EnvelopeImpact = {
  mode: "BASE" | "STRESS" | "RECOVERY";
  capDelta: string;
  targetVolDelta: string;
  hedgeDelta: string;
  note: string;
};

function impactFromSignals(rawState: string, signals?: Record<string, any>): EnvelopeImpact {
  const nStress = Number(signals?.n_stress ?? 0);
  const nNorm = Number(signals?.n_norm ?? 0);

  if (rawState === "RECOVERY" || nNorm >= 2) {
    return {
      mode: "RECOVERY",
      capDelta: "+25–30%",
      targetVolDelta: "+20–30%",
      hedgeDelta: "↓",
      note: "Recovery mode (>=2 sinais de normalizacao).",
    };
  }
  if (rawState === "STRESS" || nStress >= 2) {
    return {
      mode: "STRESS",
      capDelta: "−25–30%",
      targetVolDelta: "−20–30%",
      hedgeDelta: "↑",
      note: "Stress high (>=2 sinais de stress).",
    };
  }
  return {
    mode: "BASE",
    capDelta: "0",
    targetVolDelta: "0",
    hedgeDelta: "0",
    note: "Sem alteracao estrutural (LOW/NEUTRAL).",
  };
}

export default function StructuralPage() {
  const [creditRisk, setCreditRisk] = useState("HYG");
  const [creditSafe, setCreditSafe] = useState("LQD");
  const [vixProxy, setVixProxy] = useState("VXX");
  const [ratesProxy, setRatesProxy] = useState("IEF");

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [stateV1, setStateV1] = useState<StateV1Response | null>(null);
  const [rows, setRows] = useState<StructuralRow[]>([]);

  const endpointState = "/api/proxy/api/structural/state_v1";
  const endpointSim = "/api/proxy/api/structural/simulate_series_v1";

  const reqBase = useMemo(
    () => ({
      credit_risk: creditRisk,
      credit_safe: creditSafe,
      vix_proxy: vixProxy,
      rates_proxy: ratesProxy,
      use_tws_raw: true,
    }),
    [creditRisk, creditSafe, vixProxy, ratesProxy]
  );

  async function refresh() {
    setLoading(true);
    setErr(null);
    try {
      const s = await postJson<StateV1Response>(endpointState, reqBase, 180000);
      setStateV1(s);

      const sim = await postJson<{ ok: boolean; rows: StructuralRow[] }>(
        endpointSim,
        { ...reqBase, max_rows: 520 },
        180000
      );
      const all = Array.isArray(sim.rows) ? sim.rows : [];
      setRows(all);
    } catch (e: any) {
      setErr(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const tail = useMemo(() => {
    const n = 90;
    if (!rows || rows.length === 0) return [];
    return rows.slice(Math.max(0, rows.length - n));
  }, [rows]);

  const latest = useMemo(() => {
    if (tail.length > 0) return tail[tail.length - 1];
    return null;
  }, [tail]);

  const rawNow = stateV1?.raw_state || latest?.raw_state || "-";
  const smoothNow = stateV1?.smoothed_state || stateV1?.state || latest?.smoothed_state || "-";
  const asof = stateV1?.asof || latest?.asof || "-";

  const signalsNow = stateV1?.signals || latest?.signals || {};
  const detailsNow = stateV1?.details || latest?.details || {};

  const impact = useMemo(() => impactFromSignals(rawNow, signalsNow), [rawNow, signalsNow]);

  const ratesBps = detailsNow?.rates?.move_bps_15d_proxy;
  const creditRel = detailsNow?.credit?.rel_20d;
  const creditDD = detailsNow?.credit?.dd_10d;
  const vixPct = detailsNow?.vix?.pct_1y;
  const vixSpike = detailsNow?.vix?.spike_10d;
  const vixCompress = detailsNow?.vix?.compress_30d_from_peak;

  return (
    <div style={{ minHeight: "100vh", background: "#09090b", color: "#e5e7eb" }}>
      <div style={{ maxWidth: 1120, margin: "0 auto", padding: "24px 16px 56px" }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 20, fontWeight: 800, color: "#fff" }}>DECIDE · Camada Estrutural (v1.0)</div>
            <div style={{ marginTop: 6, fontSize: 12, color: "#9ca3af" }}>
              Estado suavizado (persistencia/histerese/cooldown) + simulacao multi-dia para regime bar
            </div>
          </div>

          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <button
              onClick={refresh}
              disabled={loading}
              style={{
                padding: "10px 12px",
                borderRadius: 10,
                border: "1px solid rgba(255,255,255,0.12)",
                background: loading ? "rgba(255,255,255,0.06)" : "rgba(45,212,191,0.15)",
                color: "#fff",
                cursor: loading ? "not-allowed" : "pointer",
                fontWeight: 700,
              }}
              title="Recarregar estado e simulacao"
            >
              {loading ? "A carregar..." : "Recarregar"}
            </button>
          </div>
        </div>

        <div style={{ marginTop: 16, display: "grid", gridTemplateColumns: "1fr", gap: 12 }}>
          <div style={cardStyle}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(140px, 1fr))", gap: 10 }}>
              <div>
                <div style={labelStyle}>Credito (risk)</div>
                <input value={creditRisk} onChange={(e) => setCreditRisk(e.target.value)} style={inpStyle} />
              </div>
              <div>
                <div style={labelStyle}>Credito (safe)</div>
                <input value={creditSafe} onChange={(e) => setCreditSafe(e.target.value)} style={inpStyle} />
              </div>
              <div>
                <div style={labelStyle}>VIX proxy</div>
                <input value={vixProxy} onChange={(e) => setVixProxy(e.target.value)} style={inpStyle} />
              </div>
              <div>
                <div style={labelStyle}>Rates proxy</div>
                <input value={ratesProxy} onChange={(e) => setRatesProxy(e.target.value)} style={inpStyle} />
              </div>
            </div>

            <div style={{ marginTop: 10, fontSize: 12, color: "#9ca3af" }}>
              Endpoints via proxy: <span style={{ color: "#cbd5e1" }}>{endpointState}</span> ·{" "}
              <span style={{ color: "#cbd5e1" }}>{endpointSim}</span>
            </div>
          </div>

          <div style={cardStyle}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <span style={badgeStyle()}>
                  <span style={dotStyle(smoothNow)} />
                  <span style={{ fontWeight: 900 }}>SMOOTHED</span>
                  <span style={{ opacity: 0.92 }}>{smoothNow}</span>
                </span>

                <span style={badgeStyle()}>
                  <span style={dotStyle(rawNow)} />
                  <span style={{ fontWeight: 900 }}>RAW</span>
                  <span style={{ opacity: 0.92 }}>{rawNow}</span>
                </span>

                <span style={{ fontSize: 12, color: "#9ca3af" }}>
                  asof: <span style={{ color: "#e5e7eb" }}>{asof}</span>
                </span>
              </div>

              {err ? (
                <div style={{ color: "#fecaca", fontSize: 12, maxWidth: 760, whiteSpace: "pre-wrap" }}>ERRO: {err}</div>
              ) : (
                <div style={{ fontSize: 12, color: "#9ca3af" }}>
                  {stateV1?.tws_dir ? (
                    <>
                      tws_dir: <span style={{ color: "#e5e7eb" }}>{stateV1.tws_dir}</span>
                    </>
                  ) : null}
                </div>
              )}
            </div>

            <div style={{ marginTop: 14 }}>
              <div style={{ fontSize: 12, color: "#9ca3af", marginBottom: 8 }}>
                Regime bar (ultimos {tail.length} dias) · quadrados = smoothed_state · risca branca = transition · hover para detalhe
              </div>

              <div style={{ display: "flex", gap: 2, alignItems: "center", flexWrap: "nowrap", overflowX: "auto", paddingBottom: 8 }}>
                {tail.length === 0 ? (
                  <div style={{ color: "#9ca3af", fontSize: 12 }}>Sem dados (simulacao vazia)</div>
                ) : (
                  tail.map((r, idx) => {
                    const c = stateColor(r.smoothed_state);
                    const isTr = Number(r.transition) === 1;

                    const nStress = r.signals?.n_stress ?? "-";
                    const nNorm = r.signals?.n_norm ?? "-";
                    const rbps = r.details?.rates?.move_bps_15d_proxy;

                    const title =
                      `${r.asof}\n` +
                      `raw: ${r.raw_state} | smoothed: ${r.smoothed_state} | transition: ${r.transition}\n` +
                      `n_stress: ${nStress} | n_norm: ${nNorm}\n` +
                      `rates_bps_15d: ${fmtBps(rbps)}\n` +
                      `credit_rel_20d: ${fmtPct(r.details?.credit?.rel_20d)} | credit_dd_10d: ${fmtPct(r.details?.credit?.dd_10d)}\n` +
                      `vix_pct_1y: ${String(r.details?.vix?.pct_1y ?? "-")} | vix_spike_10d: ${fmtPct(r.details?.vix?.spike_10d)}\n`;

                    return (
                      <div
                        key={`${r.asof}-${idx}`}
                        title={title}
                        style={{
                          width: 10,
                          height: 26,
                          borderRadius: 3,
                          background: c,
                          position: "relative",
                          flex: "0 0 auto",
                          outline: "1px solid rgba(0,0,0,0.25)",
                        }}
                      >
                        {isTr ? (
                          <div
                            style={{
                              position: "absolute",
                              left: "50%",
                              top: 2,
                              transform: "translateX(-50%)",
                              width: 2,
                              height: 22,
                              background: "rgba(255,255,255,0.9)",
                              borderRadius: 2,
                            }}
                          />
                        ) : null}
                      </div>
                    );
                  })
                )}
              </div>

              <div style={{ marginTop: 6, display: "flex", gap: 12, flexWrap: "wrap", fontSize: 12, color: "#9ca3af" }}>
                {["LOW", "NEUTRAL", "STRESS", "RECOVERY"].map((s) => (
                  <span key={s} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                    <span style={{ width: 10, height: 10, borderRadius: 3, background: stateColor(s) }} />
                    {s}
                  </span>
                ))}
              </div>
            </div>
          </div>

          <div style={cardStyle}>
            <div style={{ fontSize: 13, fontWeight: 800, color: "#fff" }}>Impacto no envelope (v1.0 · display)</div>
            <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 10 }}>
              <div style={miniCard}>
                <div style={miniLabel}>Modo</div>
                <div style={miniValue}>{impact.mode}</div>
                <div style={miniHint}>{impact.note}</div>
              </div>
              <div style={miniCard}>
                <div style={miniLabel}>Cap max</div>
                <div style={miniValue}>{impact.capDelta}</div>
                <div style={miniHint}>Ajuste relativo ao cap base do perfil</div>
              </div>
              <div style={miniCard}>
                <div style={miniLabel}>Target Vol</div>
                <div style={miniValue}>{impact.targetVolDelta}</div>
                <div style={miniHint}>Ajuste relativo ao target base do perfil</div>
              </div>
              <div style={miniCard}>
                <div style={miniLabel}>Hedge</div>
                <div style={miniValue}>{impact.hedgeDelta}</div>
                <div style={miniHint}>Direcao do ajuste (nao aplica magnitudes aqui)</div>
              </div>
            </div>

            <div style={{ marginTop: 10, fontSize: 12, color: "#9ca3af" }}>
              Sinais atuais: n_stress=<span style={{ color: "#e5e7eb" }}>{String(signalsNow?.n_stress ?? "-")}</span> · n_norm=
              <span style={{ color: "#e5e7eb" }}> {String(signalsNow?.n_norm ?? "-")}</span> · rates_bps_15d=
              <span style={{ color: "#e5e7eb" }}> {fmtBps(ratesBps)}</span>
            </div>
          </div>

          <div style={cardStyle}>
            <div style={{ fontSize: 13, fontWeight: 800, color: "#fff" }}>Diagnostico rapido</div>
            <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 10 }}>
              <div style={miniCard}>
                <div style={miniLabel}>Credit rel (20d)</div>
                <div style={miniValue}>{fmtPct(creditRel, 2)}</div>
                <div style={miniHint}>HYG vs LQD</div>
              </div>
              <div style={miniCard}>
                <div style={miniLabel}>Credit DD (10d)</div>
                <div style={miniValue}>{fmtPct(creditDD, 2)}</div>
                <div style={miniHint}>Drawdown HYG</div>
              </div>
              <div style={miniCard}>
                <div style={miniLabel}>VIX pct (1y)</div>
                <div style={miniValue}>{isFinite(Number(vixPct)) ? Number(vixPct).toFixed(3) : "-"}</div>
                <div style={miniHint}>Percentil do proxy</div>
              </div>
              <div style={miniCard}>
                <div style={miniLabel}>Rates move (15d)</div>
                <div style={miniValue}>{fmtBps(ratesBps)}</div>
                <div style={miniHint}>Proxy ETF - abs(pct)*10000</div>
              </div>
            </div>

            <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 }}>
              <div style={miniCard}>
                <div style={miniLabel}>VIX spike (10d)</div>
                <div style={miniValue}>{fmtPct(vixSpike, 2)}</div>
                <div style={miniHint}>
                  Stress se &gt;= 40%
                </div>
              </div>
              <div style={miniCard}>
                <div style={miniLabel}>VIX compress (30d peak)</div>
                <div style={miniValue}>{fmtPct(vixCompress, 2)}</div>
                <div style={miniHint}>
                  Norm se &lt;= -20%
                </div>
              </div>
            </div>
          </div>

          <div style={cardStyle}>
            <div style={{ fontSize: 13, fontWeight: 800, color: "#fff" }}>Detalhe (sinais / thresholds)</div>
            <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 }}>
              <pre style={preStyle}>{JSON.stringify(stateV1?.signals ?? {}, null, 2)}</pre>
              <pre style={preStyle}>{JSON.stringify(stateV1?.details?.thresholds ?? {}, null, 2)}</pre>
            </div>
          </div>
        </div>

        <div style={{ marginTop: 14, fontSize: 12, color: "#9ca3af" }}>
          Nota: esta pagina usa <code>/api/proxy</code>. Se o proxy mudar, ajusto no ficheiro completo.
        </div>
      </div>
    </div>
  );
}

const cardStyle: React.CSSProperties = {
  background: "rgba(255,255,255,0.04)",
  border: "1px solid rgba(255,255,255,0.10)",
  borderRadius: 16,
  padding: 16,
};

const labelStyle: React.CSSProperties = {
  fontSize: 12,
  color: "#9ca3af",
  marginBottom: 6,
};

const inpStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px 10px",
  borderRadius: 10,
  border: "1px solid rgba(255,255,255,0.12)",
  background: "rgba(255,255,255,0.06)",
  color: "#fff",
  outline: "none",
  fontSize: 13,
};

const preStyle: React.CSSProperties = {
  margin: 0,
  padding: 12,
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.10)",
  background: "rgba(0,0,0,0.25)",
  color: "#e5e7eb",
  overflowX: "auto",
  maxHeight: 260,
};

const miniCard: React.CSSProperties = {
  background: "rgba(0,0,0,0.18)",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 14,
  padding: 12,
};

const miniLabel: React.CSSProperties = {
  fontSize: 12,
  color: "#9ca3af",
};

const miniValue: React.CSSProperties = {
  marginTop: 6,
  fontSize: 16,
  fontWeight: 800,
  color: "#fff",
};

const miniHint: React.CSSProperties = {
  marginTop: 6,
  fontSize: 12,
  color: "#9ca3af",
};