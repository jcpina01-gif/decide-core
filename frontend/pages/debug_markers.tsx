import React, { useEffect, useMemo, useState } from "react";

type Markers = {
  _ddcap_marker_perf?: string;
  _ddcap_engine_marker?: string;
  _payload_hygiene_marker?: string;

  _ddcap_regimes_marker?: string;
  _ddcap_regimes_marker_source?: string;

  _ddcap_marker?: string;
};

type CallState<T> = {
  loading: boolean;
  error: string | null;
  data: T | null;
};

const DEFAULT_BODY = {
  profile: "dinamico",
  benchmark: "SPY",
  top_q: 20,
  lookback: 120,
  cap_per_ticker: 0.2,
  use_tws_raw: false,
};

function isNonEmpty(v: any): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

function pickMarkersTopLevel(resp: any): Markers {
  if (!resp || typeof resp !== "object") return {};
  const m: Markers = {};
  const keys: (keyof Markers)[] = [
    "_ddcap_marker_perf",
    "_ddcap_engine_marker",
    "_payload_hygiene_marker",
    "_ddcap_regimes_marker",
    "_ddcap_regimes_marker_source",
    "_ddcap_marker",
  ];
  for (const k of keys) {
    const v = (resp as any)[k];
    if (typeof v === "string") (m as any)[k] = v;
  }
  return m;
}

async function postJson(url: string, body: any, timeoutMs = 180000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ac.signal,
    });
    const text = await r.text();
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    if (!r.ok) {
      const msg = `HTTP ${r.status} ${r.statusText}${text ? " | " + text : ""}`;
      throw new Error(msg);
    }
    return json;
  } finally {
    clearTimeout(t);
  }
}

function Badge({ label }: { label: string }) {
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 8px",
        borderRadius: 999,
        border: "1px solid rgba(255,255,255,0.18)",
        background: "rgba(255,255,255,0.06)",
        fontSize: 12,
        marginRight: 8,
        marginBottom: 8,
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </span>
  );
}

function Row({ k, v }: { k: string; v?: string }) {
  const ok = isNonEmpty(v);
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "240px 1fr",
        gap: 12,
        padding: "10px 0",
        borderTop: "1px solid rgba(255,255,255,0.08)",
        alignItems: "center",
      }}
    >
      <div style={{ color: "rgba(255,255,255,0.75)", fontSize: 13 }}>{k}</div>
      <div
        style={{
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
          fontSize: 13,
          color: ok ? "rgba(255,255,255,0.92)" : "rgba(255,255,255,0.35)",
          wordBreak: "break-word",
        }}
      >
        {ok ? v : "(vazio)"}
      </div>
    </div>
  );
}

export default function DebugMarkersPage() {
  const [body, setBody] = useState<any>(DEFAULT_BODY);

  const [core, setCore] = useState<CallState<any>>({ loading: false, error: null, data: null });
  const [reg, setReg] = useState<CallState<any>>({ loading: false, error: null, data: null });

  const coreMarkers = useMemo(() => pickMarkersTopLevel(core.data), [core.data]);
  const regMarkers = useMemo(() => pickMarkersTopLevel(reg.data), [reg.data]);

  const merged: Markers = useMemo(() => {
    // Prefer core markers for perf/engine/hygiene; prefer regimes/run for regimes marker/source
    return {
      _ddcap_marker_perf: coreMarkers._ddcap_marker_perf,
      _ddcap_engine_marker: coreMarkers._ddcap_engine_marker,
      _payload_hygiene_marker: coreMarkers._payload_hygiene_marker,
      _ddcap_marker: coreMarkers._ddcap_marker || regMarkers._ddcap_marker,

      _ddcap_regimes_marker: regMarkers._ddcap_regimes_marker,
      _ddcap_regimes_marker_source: regMarkers._ddcap_regimes_marker_source,
    };
  }, [coreMarkers, regMarkers]);

  async function runAll() {
    setCore({ loading: true, error: null, data: null });
    setReg({ loading: true, error: null, data: null });

    try {
      const coreResp = await postJson("/api/proxy/performance/core_overlayed", body);
      setCore({ loading: false, error: null, data: coreResp });
    } catch (e: any) {
      setCore({ loading: false, error: e?.message || String(e), data: null });
    }

    try {
      const regResp = await postJson("/api/proxy/kpis_overlay/regimes/run", body);
      setReg({ loading: false, error: null, data: regResp });
    } catch (e: any) {
      setReg({ loading: false, error: e?.message || String(e), data: null });
    }
  }

  useEffect(() => {
    runAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pageStyle: React.CSSProperties = {
    minHeight: "100vh",
    background: "#0b0f17",
    color: "white",
    padding: "24px",
    fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif",
  };

  const cardStyle: React.CSSProperties = {
    borderRadius: 16,
    border: "1px solid rgba(255,255,255,0.10)",
    background: "rgba(255,255,255,0.04)",
    boxShadow: "0 10px 30px rgba(0,0,0,0.35)",
    padding: 18,
    maxWidth: 980,
  };

  const btnStyle: React.CSSProperties = {
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.18)",
    background: "rgba(255,255,255,0.08)",
    color: "white",
    padding: "10px 14px",
    cursor: "pointer",
    fontWeight: 600,
  };

  const inputStyle: React.CSSProperties = {
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.18)",
    background: "rgba(0,0,0,0.35)",
    color: "white",
    padding: "10px 12px",
    width: 220,
    outline: "none",
  };

  return (
    <div style={pageStyle}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: 0.2 }}>DECIDE — Debug Markers</div>
          <div style={{ marginTop: 6, color: "rgba(255,255,255,0.70)", fontSize: 13 }}>
            Fonte: <b>core_overlayed</b> (perf/engine/hygiene) + <b>regimes/run</b> (regimes marker)
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <label style={{ fontSize: 12, color: "rgba(255,255,255,0.75)" }}>
            profile
            <input
              style={{ ...inputStyle, marginLeft: 8, width: 160 }}
              value={body.profile ?? ""}
              onChange={(e) => setBody((b: any) => ({ ...b, profile: e.target.value }))}
            />
          </label>

          <label style={{ fontSize: 12, color: "rgba(255,255,255,0.75)" }}>
            benchmark
            <input
              style={{ ...inputStyle, marginLeft: 8, width: 120 }}
              value={body.benchmark ?? ""}
              onChange={(e) => setBody((b: any) => ({ ...b, benchmark: e.target.value }))}
            />
          </label>

          <button onClick={runAll} style={btnStyle}>
            {core.loading || reg.loading ? "A correr..." : "Run"}
          </button>
        </div>
      </div>

      <div style={{ marginTop: 16, ...cardStyle }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
          <div style={{ fontSize: 16, fontWeight: 800 }}>Debug Markers</div>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <Badge label={core.loading ? "core_overlayed: loading" : core.error ? "core_overlayed: erro" : "core_overlayed: ok"} />
            <Badge label={reg.loading ? "regimes/run: loading" : reg.error ? "regimes/run: erro" : "regimes/run: ok"} />
          </div>
        </div>

        {(core.error || reg.error) && (
          <div style={{ marginTop: 12, borderRadius: 12, padding: 12, background: "rgba(255,80,80,0.10)", border: "1px solid rgba(255,80,80,0.25)" }}>
            <div style={{ fontWeight: 800, marginBottom: 6 }}>Erros</div>
            {core.error && <div style={{ fontSize: 12, color: "rgba(255,255,255,0.85)" }}><b>core_overlayed:</b> {core.error}</div>}
            {reg.error && <div style={{ fontSize: 12, color: "rgba(255,255,255,0.85)", marginTop: 6 }}><b>regimes/run:</b> {reg.error}</div>}
          </div>
        )}

        <div style={{ marginTop: 14 }}>
          <Row k="_ddcap_marker_perf" v={merged._ddcap_marker_perf} />
          <Row k="_ddcap_engine_marker" v={merged._ddcap_engine_marker} />
          <Row k="_payload_hygiene_marker" v={merged._payload_hygiene_marker} />
          <Row k="_ddcap_regimes_marker" v={merged._ddcap_regimes_marker} />
          <Row k="_ddcap_regimes_marker_source" v={merged._ddcap_regimes_marker_source} />
          <Row k="_ddcap_marker (core)" v={merged._ddcap_marker} />
        </div>

        <div style={{ marginTop: 14, color: "rgba(255,255,255,0.65)", fontSize: 12, lineHeight: 1.4 }}>
          <b>Nota:</b> é normal o endpoint <code>core_overlayed</code> não trazer regimes marker (ele não passa pela rota de regimes).
          O regimes marker mostrado aqui vem de <code>regimes/run</code>, que é a “fonte única” que acabámos de estabilizar.
        </div>
      </div>

      <div style={{ marginTop: 16, color: "rgba(255,255,255,0.55)", fontSize: 12 }}>
        URL: <span style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace" }}>/debug_markers</span>
      </div>
    </div>
  );
}