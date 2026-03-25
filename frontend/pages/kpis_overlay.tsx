import React, { useMemo, useState } from "react";

type AnyObj = Record<string, any>;

function safeNum(x: any): number | null {
  if (x === null || x === undefined) return null;
  const n = typeof x === "number" ? x : Number(x);
  return Number.isFinite(n) ? n : null;
}

function parseYmd(s: string): Date | null {
  if (!s) return null;
  // Accept YYYY-MM-DD or YYYY-MM-DDTHH:...
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s));
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]) - 1, d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo, d, 0, 0, 0));
  return Number.isFinite(dt.getTime()) ? dt : null;
}

function yearsBetween(d0: Date, d1: Date): number | null {
  const t0 = d0.getTime();
  const t1 = d1.getTime();
  if (!Number.isFinite(t0) || !Number.isFinite(t1) || t1 <= t0) return null;
  const days = (t1 - t0) / (1000 * 60 * 60 * 24);
  return days / 365.25;
}

function returnsFromEquity(eq: number[]): number[] {
  const r: number[] = [];
  for (let i = 1; i < eq.length; i++) {
    const a = eq[i - 1];
    const b = eq[i];
    if (!(a > 0) || !Number.isFinite(a) || !Number.isFinite(b)) continue;
    r.push(b / a - 1);
  }
  return r;
}

function mean(x: number[]): number | null {
  if (!x.length) return null;
  let s = 0;
  for (const v of x) s += v;
  return s / x.length;
}

function stdev(x: number[]): number | null {
  if (x.length < 2) return null;
  const m = mean(x);
  if (m === null) return null;
  let ss = 0;
  for (const v of x) {
    const d = v - m;
    ss += d * d;
  }
  return Math.sqrt(ss / (x.length - 1));
}

function corr(a: number[], b: number[]): number | null {
  const n = Math.min(a.length, b.length);
  if (n < 10) return null;
  const aa = a.slice(0, n);
  const bb = b.slice(0, n);
  const ma = mean(aa), mb = mean(bb);
  if (ma === null || mb === null) return null;
  let sxx = 0, syy = 0, sxy = 0;
  for (let i = 0; i < n; i++) {
    const x = aa[i] - ma;
    const y = bb[i] - mb;
    sxx += x * x;
    syy += y * y;
    sxy += x * y;
  }
  if (sxx <= 0 || syy <= 0) return null;
  return sxy / Math.sqrt(sxx * syy);
}

function maxDrawdown(eq: number[]): number | null {
  if (!eq.length) return null;
  let peak = eq[0];
  let mdd = 0;
  for (const v of eq) {
    if (v > peak) peak = v;
    const dd = peak > 0 ? (v / peak - 1) : 0;
    if (dd < mdd) mdd = dd;
  }
  return mdd;
}

function computeKpisFromSeries(dates: string[], equity: number[]) {
  if (!dates?.length || !equity?.length) return null;
  const n = Math.min(dates.length, equity.length);
  const d0 = parseYmd(dates[0]);
  const d1 = parseYmd(dates[n - 1]);
  if (!d0 || !d1) return null;

  const years = yearsBetween(d0, d1);
  if (!years || years <= 0) return null;

  const eq = equity.slice(0, n).map(v => Number(v));
  const first = eq[0];
  const last = eq[eq.length - 1];
  if (!(first > 0) || !(last > 0)) return null;

  const cagr = Math.pow(last / first, 1 / years) - 1;

  const rets = returnsFromEquity(eq);
  const mu = mean(rets);
  const sd = stdev(rets);

  const annVol = sd === null ? null : sd * Math.sqrt(252);
  const annSharpe = (mu === null || sd === null || sd === 0) ? null : (mu / sd) * Math.sqrt(252);
  const mdd = maxDrawdown(eq);

  return { cagr, vol: annVol, sharpe: annSharpe, mdd, years, n: eq.length };
}

function fmtPct(x: number | null | undefined): string {
  if (x === null || x === undefined || !Number.isFinite(x)) return "—";
  return (x * 100).toFixed(2) + "%";
}
function fmtNum(x: number | null | undefined, dec = 2): string {
  if (x === null || x === undefined || !Number.isFinite(x)) return "—";
  return x.toFixed(dec);
}

async function postJson(url: string, body: any) {
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const text = await r.text();
  let j: any = null;
  try { j = JSON.parse(text); } catch { /* ignore */ }
  if (!r.ok) {
    return { ok: false, status: r.status, text, json: j };
  }
  return { ok: true, status: r.status, text, json: j };
}

export default function KPIsOverlayPage() {
  const [profile, setProfile] = useState("moderado");
  const [benchmark, setBenchmark] = useState("SPY");
  const [busy, setBusy] = useState(false);

  const [errCore, setErrCore] = useState<string | null>(null);
  const [errReg, setErrReg] = useState<string | null>(null);

  const [coreJson, setCoreJson] = useState<AnyObj | null>(null);
  const [regJson, setRegJson] = useState<AnyObj | null>(null);

  const body = useMemo(() => ({
    profile,
    benchmark,
    top_q: 20,
    lookback: 120,
    cap_per_ticker: 0.2,
    use_tws_raw: false
  }), [profile, benchmark]);

  const series = coreJson?.result?.series ?? null;
  const dates: string[] = (series?.dates ?? []) as string[];
  const eq: number[] = (series?.equity ?? []) as number[];
  const beq: number[] = (series?.benchmark_equity ?? []) as number[];

  const kpiStrat = useMemo(() => (dates.length && eq.length) ? computeKpisFromSeries(dates, eq) : null, [dates, eq]);
  const kpiBench = useMemo(() => (dates.length && beq.length) ? computeKpisFromSeries(dates, beq) : null, [dates, beq]);

  const corrEqBench = useMemo(() => {
    if (!eq.length || !beq.length) return null;
    const r1 = returnsFromEquity(eq);
    const r2 = returnsFromEquity(beq);
    return corr(r1, r2);
  }, [eq, beq]);

  const pointJan20 = useMemo(() => {
    const target = "2026-01-20";
    if (!dates?.length) return null;
    const idx = dates.findIndex(d => String(d).startsWith(target));
    if (idx < 0) return null;
    const out: AnyObj = { date: target, idx };
    if (eq?.length > idx) out.equity = eq[idx];
    if (beq?.length > idx) out.benchmark_equity = beq[idx];
    return out;
  }, [dates, eq, beq]);

  async function run() {
    setBusy(true);
    setErrCore(null);
    setErrReg(null);

    const core = await postJson("/api/proxy/performance/core_overlayed", body);
    if (!core.ok) {
      setErrCore(`HTTP ${core.status} | ${core.json ? JSON.stringify(core.json) : core.text}`);
      setCoreJson(core.json ?? null);
    } else {
      setCoreJson(core.json ?? null);
    }

    const reg = await postJson("/api/proxy/kpis_overlay/regimes/run", body);
    if (!reg.ok) {
      setErrReg(`HTTP ${reg.status} | ${reg.json ? JSON.stringify(reg.json) : reg.text}`);
      setRegJson(reg.json ?? null);
    } else {
      setRegJson(reg.json ?? null);
    }

    setBusy(false);
  }

  // markers: top-level promoted by main.py patch
  const markers = useMemo(() => {
    const out: AnyObj = {};
    const top = coreJson ?? {};
    const reg = regJson ?? {};
    const keys = [
      "_ddcap_marker_perf",
      "_ddcap_engine_marker",
      "_payload_hygiene_marker",
      "_ddcap_regimes_marker",
      "_ddcap_regimes_marker_source",
      "_ddcap_marker"
    ];
    for (const k of keys) {
      out[k] = (top as any)[k] ?? (reg as any)[k] ?? null;
    }
    return out;
  }, [coreJson, regJson]);

  const okCore = !errCore && !!coreJson;
  const okReg = !errReg && !!regJson;

  return (
    <div style={{ minHeight: "100vh", background: "#0b0f14", color: "#e6eef7", padding: 24, fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16 }}>
        <div>
          <div style={{ fontSize: 34, fontWeight: 800, letterSpacing: 0.2 }}>DECIDE — KPIs Overlay</div>
          <div style={{ marginTop: 6, opacity: 0.85 }}>
            Fonte: <b>core_overlayed</b> (KPIs calculados a partir de <b>series.equity + series.dates</b>) + <b>regimes/run</b> (regimes marker)
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ opacity: 0.85 }}>profile</div>
            <select value={profile} onChange={e => setProfile(e.target.value)} style={{ background: "#0f141b", color: "#e6eef7", border: "1px solid #2a3441", borderRadius: 10, padding: "8px 10px" }}>
              <option value="conservador">conservador</option>
              <option value="moderado">moderado</option>
              <option value="dinamico">dinamico</option>
            </select>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ opacity: 0.85 }}>benchmark</div>
            <input value={benchmark} onChange={e => setBenchmark(e.target.value)} style={{ width: 140, background: "#0f141b", color: "#e6eef7", border: "1px solid #2a3441", borderRadius: 10, padding: "8px 10px" }} />
          </div>

          <button onClick={run} disabled={busy} style={{ background: "#1f2937", color: "#fff", border: "1px solid #334155", borderRadius: 12, padding: "10px 16px", fontWeight: 700, cursor: busy ? "not-allowed" : "pointer" }}>
            {busy ? "Running..." : "Run"}
          </button>
        </div>
      </div>

      <div style={{ marginTop: 18, padding: 14, border: "1px solid #1f2937", borderRadius: 18, background: "rgba(255,255,255,0.03)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
          <div style={{ fontSize: 18, fontWeight: 800 }}>Estado</div>
          <div style={{ display: "flex", gap: 10 }}>
            <span style={{ padding: "6px 10px", borderRadius: 999, border: "1px solid #2a3441", background: okCore ? "rgba(16,185,129,0.12)" : "rgba(239,68,68,0.12)", color: okCore ? "#34d399" : "#fb7185", fontWeight: 700 }}>
              core_overlayed: {okCore ? "ok" : "erro"}
            </span>
            <span style={{ padding: "6px 10px", borderRadius: 999, border: "1px solid #2a3441", background: okReg ? "rgba(16,185,129,0.12)" : "rgba(239,68,68,0.12)", color: okReg ? "#34d399" : "#fb7185", fontWeight: 700 }}>
              regimes/run: {okReg ? "ok" : "erro"}
            </span>
          </div>
        </div>

        {(errCore || errReg) && (
          <div style={{ marginTop: 12, padding: 12, borderRadius: 14, border: "1px solid rgba(239,68,68,0.35)", background: "rgba(239,68,68,0.10)" }}>
            <div style={{ fontWeight: 800, marginBottom: 6 }}>Erros</div>
            {errCore && <div style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace", whiteSpace: "pre-wrap" }}>core_overlayed: {errCore}</div>}
            {errReg && <div style={{ marginTop: 8, fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace", whiteSpace: "pre-wrap" }}>regimes/run: {errReg}</div>}
          </div>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: 16, marginTop: 16 }}>
        <div style={{ padding: 16, border: "1px solid #1f2937", borderRadius: 18, background: "rgba(255,255,255,0.03)" }}>
          <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 10 }}>KPIs (estratégia — pós overlay)</div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div style={{ padding: 14, borderRadius: 16, border: "1px solid #233041", background: "rgba(255,255,255,0.02)" }}>
              <div style={{ opacity: 0.75, fontSize: 12 }}>CAGR</div>
              <div style={{ fontSize: 28, fontWeight: 900 }}>{fmtPct(kpiStrat?.cagr ?? null)}</div>
            </div>
            <div style={{ padding: 14, borderRadius: 16, border: "1px solid #233041", background: "rgba(255,255,255,0.02)" }}>
              <div style={{ opacity: 0.75, fontSize: 12 }}>Vol</div>
              <div style={{ fontSize: 28, fontWeight: 900 }}>{fmtPct(kpiStrat?.vol ?? null)}</div>
            </div>
            <div style={{ padding: 14, borderRadius: 16, border: "1px solid #233041", background: "rgba(255,255,255,0.02)" }}>
              <div style={{ opacity: 0.75, fontSize: 12 }}>Sharpe</div>
              <div style={{ fontSize: 28, fontWeight: 900 }}>{fmtNum(kpiStrat?.sharpe ?? null, 2)}</div>
            </div>
            <div style={{ padding: 14, borderRadius: 16, border: "1px solid #233041", background: "rgba(255,255,255,0.02)" }}>
              <div style={{ opacity: 0.75, fontSize: 12 }}>Max Drawdown</div>
              <div style={{ fontSize: 28, fontWeight: 900 }}>{fmtPct(kpiStrat?.mdd ?? null)}</div>
            </div>
          </div>

          <div style={{ marginTop: 12, opacity: 0.9, fontSize: 13 }}>
            <div><b>Fonte usada:</b> root.result.series.equity + root.result.series.dates (len={Math.min(dates?.length ?? 0, eq?.length ?? 0)})</div>
            <div><b>Benchmark:</b> root.result.series.benchmark_equity (len={Math.min(dates?.length ?? 0, beq?.length ?? 0)})</div>
            <div><b>KPIs benchmark:</b> CAGR {fmtPct(kpiBench?.cagr ?? null)} · Vol {fmtPct(kpiBench?.vol ?? null)} · Sharpe {fmtNum(kpiBench?.sharpe ?? null, 2)} · MDD {fmtPct(kpiBench?.mdd ?? null)}</div>
            <div><b>Corr(returns eq, bench):</b> {corrEqBench === null ? "—" : corrEqBench.toFixed(3)}</div>
            {pointJan20 && (
              <div style={{ marginTop: 6 }}>
                <b>Ponto 2026-01-20:</b> idx={pointJan20.idx} · equity={pointJan20.equity?.toFixed?.(6) ?? pointJan20.equity} · bench={pointJan20.benchmark_equity?.toFixed?.(6) ?? pointJan20.benchmark_equity}
              </div>
            )}
          </div>

          <div style={{ marginTop: 10, opacity: 0.75, fontSize: 12 }}>
            Nota: se estes KPIs ainda não baterem com o “correto” (~19% com vol semelhante), então a curva em <b>series.equity</b> está a ser preenchida com a série errada no backend — mas aqui já eliminámos o bug clássico de “usar returns do benchmark”.
          </div>
        </div>

        <div style={{ padding: 16, border: "1px solid #1f2937", borderRadius: 18, background: "rgba(255,255,255,0.03)" }}>
          <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 10 }}>Markers</div>

          <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace", fontSize: 12 }}>
            <tbody>
              {Object.entries(markers).map(([k, v]) => (
                <tr key={k} style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
                  <td style={{ padding: "10px 8px", color: "#cbd5e1", width: "45%" }}>{k}</td>
                  <td style={{ padding: "10px 8px", color: "#e6eef7" }}>{v ? String(v) : "(vazio)"}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div style={{ marginTop: 10, opacity: 0.75, fontSize: 12 }}>
            Objetivo: confirmar rapidamente que estás na versão certa (perf/engine/hygiene/regimes) antes de mexer em mais nada.
          </div>
        </div>
      </div>

      <div style={{ marginTop: 16, padding: 16, border: "1px solid #1f2937", borderRadius: 18, background: "rgba(255,255,255,0.03)" }}>
        <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 10 }}>Raw (debug rápido)</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div>
            <div style={{ opacity: 0.8, marginBottom: 6 }}>core_overlayed (JSON)</div>
            <textarea readOnly value={coreJson ? JSON.stringify(coreJson, null, 2) : ""} style={{ width: "100%", height: 260, background: "#0f141b", color: "#e6eef7", border: "1px solid #233041", borderRadius: 14, padding: 10, fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace", fontSize: 12 }} />
          </div>
          <div>
            <div style={{ opacity: 0.8, marginBottom: 6 }}>regimes/run (JSON)</div>
            <textarea readOnly value={regJson ? JSON.stringify(regJson, null, 2) : ""} style={{ width: "100%", height: 260, background: "#0f141b", color: "#e6eef7", border: "1px solid #233041", borderRadius: 14, padding: 10, fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace", fontSize: 12 }} />
          </div>
        </div>
      </div>

      <div style={{ marginTop: 14, opacity: 0.6, fontSize: 12 }}>
        URL: /kpis_overlay
      </div>
    </div>
  );
}