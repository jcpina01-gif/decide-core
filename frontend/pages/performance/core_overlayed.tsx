import React, { useMemo, useState } from "react";
import Head from "next/head";
import ThousandsNumberInput, { asThousandsNumberChange } from "../../components/ThousandsNumberInput";
import { onThousandsFieldRowPointerDownCapture } from "../../lib/thousandsFieldRowFocus";
import { DECIDE_DASHBOARD } from "../../lib/decideClientTheme";

function firstFinite(arr) {
  for (const v of arr || []) {
    if (typeof v === "number" && isFinite(v) && v !== 0) return v;
  }
  return null;
}

function normalizeTo100(arr) {
  const base = firstFinite(arr);
  if (!base) return (arr || []).map((v) => (typeof v === "number" && isFinite(v) ? v : NaN));
  return (arr || []).map((v) => (typeof v === "number" && isFinite(v) ? (v / base) * 100 : NaN));
}

function buildChartData(series, normalize) {
  if (!series) return [];
  const n = (series.dates || []).length;

  const bench = normalize ? normalizeTo100(series.benchmark_equity || []) : (series.benchmark_equity || []);
  const raw = normalize ? normalizeTo100(series.equity_raw || []) : (series.equity_raw || []);
  const over = normalize ? normalizeTo100(series.equity_overlayed || []) : (series.equity_overlayed || []);
  const vm = normalize ? normalizeTo100(series.equity_raw_volmatched || []) : (series.equity_raw_volmatched || []);

  const out = [];
  for (let i = 0; i < n; i++) {
    out.push({
      date: series.dates[i],
      Benchmark: bench[i],
      "Modelo Raw": raw[i],
      "Modelo Overlayed": over[i],
      "Raw Vol-Matched": vm[i],
    });
  }
  return out;
}

function getOverlayFactor(resp) {
  const d = (resp && resp.detail) || {};
  const candidates = [
    d && d.ddcap && d.ddcap.cap_scale_factor_last,
    d && d.ddcap && d.ddcap.cap_scale_factor,
    d && d.ddcap && d.ddcap.factor_last,
    d && d.ddcap && d.ddcap.factor,
    d && d.cap_scale_factor_last,
    d && d.cap_scale_factor,
    d && d.overlay_factor_last,
    d && d.overlay_factor,
  ];
  for (const c of candidates) {
    if (typeof c === "number" && isFinite(c)) return c;
    if (Array.isArray(c) && c.length > 0) {
      const last = c[c.length - 1];
      if (typeof last === "number" && isFinite(last)) return last;
    }
  }
  return null;
}

function Legend({ color, label }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <span style={{ width: 10, height: 10, borderRadius: 999, background: color, display: "inline-block" }} />
      {label}
    </span>
  );
}

function MiniChart({ data, showVolMatched }) {
  const width = 1120;
  const height = 320;
  const pad = 24;

  function seriesOf(key) {
    return (data || [])
      .map((d) => (typeof d[key] === "number" ? d[key] : NaN))
      .filter((x) => isFinite(x));
  }

  const sBench = seriesOf("Benchmark");
  const sRaw = seriesOf("Modelo Raw");
  const sOver = seriesOf("Modelo Overlayed");
  const sVM = showVolMatched ? seriesOf("Raw Vol-Matched") : [];

  const all = [...sBench, ...sRaw, ...sOver, ...(showVolMatched ? sVM : [])].filter((x) => isFinite(x));
  if (!all.length) {
    return <div style={{ marginTop: 10, fontSize: 13, opacity: 0.8 }}>Sem dados válidos para desenhar.</div>;
  }

  const minY = Math.min(...all);
  const maxY = Math.max(...all);

  function toPath(key) {
    const pts = (data || [])
      .map((d, i) => {
        const yv = d[key];
        if (typeof yv !== "number" || !isFinite(yv)) return null;
        const x = pad + (i * (width - 2 * pad)) / Math.max(1, (data.length - 1));
        const y = pad + (maxY - yv) * (height - 2 * pad) / Math.max(1e-9, (maxY - minY));
        return { x, y };
      })
      .filter(Boolean);

    if (!pts.length) return "";
    let p = `M ${pts[0].x.toFixed(2)} ${pts[0].y.toFixed(2)}`;
    for (let i = 1; i < pts.length; i++) p += ` L ${pts[i].x.toFixed(2)} ${pts[i].y.toFixed(2)}`;
    return p;
  }

  const cBench = "#36d6b3";
  const cRaw = "var(--text-secondary)";
  const cOver = "var(--accent-primary)";
  const cVM = "var(--accent-warning)";

  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", fontSize: 12, opacity: 0.9 }}>
        <Legend color={cBench} label="Benchmark" />
        <Legend color={cRaw} label="Modelo Raw" />
        <Legend color={cOver} label="Modelo Overlayed" />
        {showVolMatched ? <Legend color={cVM} label="Raw Vol-Matched (perfil)" /> : null}
      </div>

      <svg
        width="100%"
        viewBox={`0 0 ${width} ${height}`}
        style={{ marginTop: 8, background: "var(--bg-main)", borderRadius: 12, border: "1px solid var(--border-soft)" }}
      >
        <path d={toPath("Benchmark")} stroke={cBench} strokeWidth="2" fill="none" opacity="0.95" />
        <path d={toPath("Modelo Raw")} stroke={cRaw} strokeWidth="2" fill="none" opacity="0.85" />
        <path d={toPath("Modelo Overlayed")} stroke={cOver} strokeWidth="2" fill="none" opacity="0.95" />
        {showVolMatched ? <path d={toPath("Raw Vol-Matched")} stroke={cVM} strokeWidth="2" fill="none" opacity="0.95" /> : null}
      </svg>
    </div>
  );
}

export default function PerformanceCoreOverlayed() {
  const [profile, setProfile] = useState("moderado");
  const [benchmark, setBenchmark] = useState("SPY");
  const [lookbackDays, setLookbackDays] = useState(120);
  const [topQ, setTopQ] = useState(20);
  const [capPerTicker, setCapPerTicker] = useState(0.2);

  const [voltargetEnabled, setVoltargetEnabled] = useState(true);
  const [voltargetWindow, setVoltargetWindow] = useState(60);

  const [showRawVolMatched, setShowRawVolMatched] = useState(true);
  const [normalizeCurves, setNormalizeCurves] = useState(true);

  const [loading, setLoading] = useState(false);
  const [resp, setResp] = useState(null);
  const [err, setErr] = useState(null);

  const chartData = useMemo(() => buildChartData(resp && resp.series, normalizeCurves), [resp, normalizeCurves]);

  const hasVolMatched =
    !!(resp && resp.series && resp.series.equity_raw_volmatched) &&
    ((resp && resp.series && resp.series.equity_raw_volmatched && resp.series.equity_raw_volmatched.length) || 0) > 0;

  const overlayFactor = useMemo(() => getOverlayFactor(resp), [resp]);
  const overlayActive = overlayFactor !== null ? Math.abs(overlayFactor - 1.0) > 1e-6 : false;

  async function run() {
    setLoading(true);
    setErr(null);
    setResp(null);

    try {
      const body = {
        profile,
        benchmark,
        lookback_days: lookbackDays,
        top_q: topQ,
        cap_per_ticker: capPerTicker,
        include_series: true,
        voltarget_enabled: voltargetEnabled,
        voltarget_window: voltargetWindow,
        raw_volmatch_enabled: true,
        raw_volmatch_window: null,
        raw_volmatch_k_min: 0.0,
        raw_volmatch_k_max: 4.0,
      };

      const r = await fetch("/api/proxy/performance/core_overlayed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const j = await r.json();

      if (!r.ok) {
        throw new Error((j && j.detail) || `HTTP ${r.status}`);
      }

      setResp(j);
    } catch (e) {
      setErr((e && e.message) || String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <Head>
        <title>DECIDE — Performance (core_overlayed)</title>
      </Head>

      <div style={{ minHeight: "100vh", background: "var(--page-gradient)", color: "var(--text-primary)", padding: 16 }}>
        <div style={{ maxWidth: 1200, margin: "0 auto" }}>
          <h1 style={{ margin: "8px 0 12px 0", fontSize: 22 }}>Performance — core_overlayed</h1>

          <div
            onPointerDownCapture={onThousandsFieldRowPointerDownCapture}
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(6, minmax(0, 1fr))",
              gap: 10,
              background: "var(--bg-card)",
              border: "1px solid var(--border-soft)",
              borderRadius: 14,
              padding: 12,
            }}
          >
            <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={{ fontSize: 12, opacity: 0.85 }}>Perfil</span>
              <select
                value={profile}
                onChange={(e) => setProfile(e.target.value)}
                style={{ background: "var(--bg-main)", color: "var(--text-primary)", padding: 8, borderRadius: 10, border: "1px solid var(--border-soft)" }}
              >
                <option value="conservador">Conservador</option>
                <option value="moderado">Moderado</option>
                <option value="dinamico">Dinâmico</option>
              </select>
            </label>

            <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={{ fontSize: 12, opacity: 0.85 }}>Benchmark</span>
              <input
                value={benchmark}
                onChange={(e) => setBenchmark(e.target.value)}
                style={{ background: "var(--bg-main)", color: "var(--text-primary)", padding: 8, borderRadius: 10, border: "1px solid var(--border-soft)" }}
              />
            </label>

            <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={{ fontSize: 12, opacity: 0.85 }}>Lookback (dias)</span>
              <ThousandsNumberInput
                min={1}
                maxDecimals={0}
                value={lookbackDays}
                onChange={asThousandsNumberChange(setLookbackDays)}
                style={{ background: "var(--bg-main)", color: "var(--text-primary)", padding: 8, borderRadius: 10, border: "1px solid var(--border-soft)" }}
              />
            </label>

            <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={{ fontSize: 12, opacity: 0.85 }}>Top Q</span>
              <ThousandsNumberInput
                min={1}
                maxDecimals={0}
                value={topQ}
                onChange={asThousandsNumberChange(setTopQ)}
                style={{ background: "var(--bg-main)", color: "var(--text-primary)", padding: 8, borderRadius: 10, border: "1px solid var(--border-soft)" }}
              />
            </label>

            <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={{ fontSize: 12, opacity: 0.85 }}>Cap por ticker</span>
              <ThousandsNumberInput
                min={0}
                max={1}
                maxDecimals={2}
                value={capPerTicker}
                onChange={asThousandsNumberChange(setCapPerTicker)}
                style={{ background: "var(--bg-main)", color: "var(--text-primary)", padding: 8, borderRadius: 10, border: "1px solid var(--border-soft)" }}
              />
            </label>

            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <button
                onClick={run}
                disabled={loading}
                style={{
                  padding: "10px 12px",
                  borderRadius: 12,
                  border: "1px solid var(--border-soft)",
                  background: loading ? DECIDE_DASHBOARD.clientProgressTrackBg : "var(--accent-brand-subtle)",
                  color: "var(--text-primary)",
                  cursor: loading ? "not-allowed" : "pointer",
                }}
              >
                {loading ? "A correr…" : "Run Model"}
              </button>

              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, opacity: 0.9 }}>
                <input
                  type="checkbox"
                  checked={showRawVolMatched}
                  onChange={(e) => setShowRawVolMatched(e.target.checked)}
                />
                Mostrar “Raw Vol-Matched”
              </label>
            </div>

            <div style={{ gridColumn: "span 6", display: "flex", gap: 10, flexWrap: "wrap", marginTop: 6 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, opacity: 0.9 }}>
                <input
                  type="checkbox"
                  checked={voltargetEnabled}
                  onChange={(e) => setVoltargetEnabled(e.target.checked)}
                />
                VolTarget (overlay)
              </label>

              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, opacity: 0.9 }}>
                Window:
                <ThousandsNumberInput
                  min={1}
                  maxDecimals={0}
                  value={voltargetWindow}
                  onChange={asThousandsNumberChange(setVoltargetWindow)}
                  style={{ width: 90, background: "var(--bg-main)", color: "var(--text-primary)", padding: 6, borderRadius: 10, border: "1px solid var(--border-soft)" }}
                />
              </label>

              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, opacity: 0.9 }}>
                <input
                  type="checkbox"
                  checked={normalizeCurves}
                  onChange={(e) => setNormalizeCurves(e.target.checked)}
                />
                Normalizar curvas (base=100)
              </label>

              <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
                <span
                  style={{
                    fontSize: 12,
                    padding: "6px 10px",
                    borderRadius: 999,
                    border: "1px solid var(--border-soft)",
                    background: overlayActive ? "rgba(217, 164, 65, 0.12)" : "rgba(47, 191, 159, 0.1)",
                  }}
                  title="Cap/Overlay ativo (quando existir factor)"
                >
                  {overlayFactor === null ? "Overlay: n/d" : `Overlay factor: ${overlayFactor.toFixed(2)} (${overlayActive ? "ativo" : "inativo"})`}
                </span>

                {resp && resp._mw_volmatch_raw_error ? (
                  <span style={{ fontSize: 12, padding: "6px 10px", borderRadius: 999, border: "1px solid #7f1d1d", background: "#2a0f12" }}>
                    VolMatch RAW erro
                  </span>
                ) : (
                  <span style={{ fontSize: 12, padding: "6px 10px", borderRadius: 999, border: "1px solid var(--border-soft)", background: "var(--accent-brand-subtle)" }}>
                    VolMatch RAW: {(resp && resp._mw_volmatch_raw_mult) ?? "—"}× (W={(resp && resp._mw_volmatch_raw_window) ?? "—"})
                  </span>
                )}
              </div>
            </div>
          </div>

          {err ? (
            <div style={{ marginTop: 12, padding: 12, borderRadius: 12, border: "1px solid #7f1d1d", background: "#2a0f12" }}>
              <b>Erro:</b> {err}
            </div>
          ) : null}

          {resp && resp._mw_curve_error ? (
            <div style={{ marginTop: 12, padding: 12, borderRadius: 12, border: "1px solid #7f1d1d", background: "#2a0f12" }}>
              <b>Contrato quebrado:</b> {resp._mw_curve_error}
            </div>
          ) : null}

          <div
            style={{
              marginTop: 12,
              background: "var(--bg-card)",
              border: "1px solid var(--border-soft)",
              borderRadius: 14,
              padding: 12,
              overflow: "hidden",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <h2 style={{ margin: 0, fontSize: 16 }}>Curvas (Benchmark / Raw / Overlayed)</h2>
              <span style={{ fontSize: 12, opacity: 0.7 }}>
                {resp && resp.series && resp.series.dates ? `${resp.series.dates.length} pontos` : "—"}
              </span>
            </div>

            {chartData.length ? (
              <MiniChart data={chartData} showVolMatched={showRawVolMatched && hasVolMatched} />
            ) : (
              <div style={{ marginTop: 10, fontSize: 13, opacity: 0.8 }}>Sem dados ainda. Carrega em “Run Model”.</div>
            )}
          </div>

          <div style={{ marginTop: 12, fontSize: 12, opacity: 0.75 }}>
            Labels inequívocos: <b>Benchmark</b>, <b>Modelo Raw</b>, <b>Modelo Overlayed</b>
            {showRawVolMatched ? ", e opcionalmente Raw Vol-Matched." : "."}
            {normalizeCurves ? " (Normalizado base=100)" : " (Escala original)"}
          </div>
        </div>
      </div>
    </>
  );
}