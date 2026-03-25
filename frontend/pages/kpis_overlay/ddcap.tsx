import React, { useMemo, useState } from "react";

type AnyObj = any;

function Badge({ label, tone }: { label: string; tone?: "ok" | "err" | "info" }) {
  const base =
    "inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold border " +
    "backdrop-blur-sm";
  const cls =
    tone === "ok"
      ? "border-emerald-600/40 text-emerald-200 bg-emerald-900/20"
      : tone === "err"
      ? "border-rose-600/40 text-rose-200 bg-rose-900/20"
      : "border-zinc-600/40 text-zinc-200 bg-zinc-900/20";
  return <span className={`${base} ${cls}`}>{label}</span>;
}

function Card({ title, value }: { title: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-5 shadow-[0_10px_30px_rgba(0,0,0,0.35)]">
      <div className="text-xs text-zinc-400">{title}</div>
      <div className="mt-2 text-3xl font-semibold text-white">{value}</div>
    </div>
  );
}

async function postJson(url: string, body: AnyObj) {
  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  let json: AnyObj = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { ok: false, error: "invalid_json", detail: text };
  }
  if (!r.ok) {
    const msg = json?.detail ? JSON.stringify(json) : text;
    throw new Error(`HTTP ${r.status} ${r.statusText} | ${msg}`);
  }
  return json;
}

// --------- Robust extractors (to avoid "wrong curve") ----------

function isNum(x: any) {
  return typeof x === "number" && Number.isFinite(x);
}

function looksLikeNumArray(arr: any): arr is number[] {
  if (!Array.isArray(arr)) return false;
  if (arr.length < 50) return false;
  let ok = 0;
  for (let i = 0; i < Math.min(arr.length, 200); i++) if (isNum(arr[i])) ok++;
  return ok >= Math.min(arr.length, 200) * 0.95;
}

// DFS: find numeric arrays and keep their paths
function findNumericArrays(obj: any, path = "root", out: { path: string; arr: number[] }[] = []) {
  if (obj == null) return out;

  if (Array.isArray(obj)) {
    if (looksLikeNumArray(obj)) out.push({ path, arr: obj as number[] });
    return out;
  }
  if (typeof obj !== "object") return out;

  for (const k of Object.keys(obj)) {
    try {
      findNumericArrays(obj[k], `${path}.${k}`, out);
    } catch {}
  }
  return out;
}

function pickEquityCurve(coreJson: any) {
  const cands = findNumericArrays(coreJson);

  // Prefer "strategy/portfolio/equity/curve" but avoid obvious bench refs
  const prefer = /(equity|curve|portfolio|strategy|nav)/i;
  const avoid = /(bench|benchmark|spy|ref|index)/i;

  const good = cands
    .filter((c) => prefer.test(c.path) && !avoid.test(c.path))
    .sort((a, b) => b.arr.length - a.arr.length);

  if (good.length > 0) return { picked: good[0], all: cands };

  // fallback: pick largest non-bench array
  const nonBench = cands
    .filter((c) => !avoid.test(c.path))
    .sort((a, b) => b.arr.length - a.arr.length);
  if (nonBench.length > 0) return { picked: nonBench[0], all: cands };

  // last resort: biggest array
  const any = cands.sort((a, b) => b.arr.length - a.arr.length);
  if (any.length > 0) return { picked: any[0], all: cands };

  return { picked: null as any, all: cands };
}

function pickBenchCurve(coreJson: any) {
  const cands = findNumericArrays(coreJson);
  const prefer = /(bench|benchmark|spy|ref|index)/i;
  const good = cands
    .filter((c) => prefer.test(c.path))
    .sort((a, b) => b.arr.length - a.arr.length);
  if (good.length > 0) return good[0];
  return null;
}

// Daily KPIs from equity curve (assume daily steps)
function calcKpisFromEquity(equity: number[]) {
  const n = equity.length;
  if (n < 50) return null;

  const rets: number[] = [];
  for (let i = 1; i < n; i++) {
    const a = equity[i - 1];
    const b = equity[i];
    if (!isNum(a) || !isNum(b) || a <= 0) continue;
    rets.push(b / a - 1);
  }
  if (rets.length < 30) return null;

  const mean = rets.reduce((s, x) => s + x, 0) / rets.length;
  const varr = rets.reduce((s, x) => s + (x - mean) * (x - mean), 0) / Math.max(1, rets.length - 1);
  const volDaily = Math.sqrt(Math.max(0, varr));
  const volAnn = volDaily * Math.sqrt(252);

  const first = equity[0];
  const last = equity[n - 1];
  const years = (n - 1) / 252;
  const cagr = first > 0 && last > 0 && years > 0 ? Math.pow(last / first, 1 / years) - 1 : NaN;

  // Sharpe (rf=0)
  const sharpe = volAnn > 0 ? (mean * 252) / volAnn : NaN;

  // Max drawdown
  let peak = equity[0];
  let maxdd = 0;
  for (let i = 0; i < n; i++) {
    const v = equity[i];
    if (!isNum(v)) continue;
    if (v > peak) peak = v;
    const dd = peak > 0 ? v / peak - 1 : 0;
    if (dd < maxdd) maxdd = dd;
  }

  return { cagr, volAnn, sharpe, maxdd, n };
}

function fmtPct(x: number) {
  if (!Number.isFinite(x)) return "—";
  return `${(x * 100).toFixed(2)}%`;
}
function fmtNum(x: number) {
  if (!Number.isFinite(x)) return "—";
  return x.toFixed(2);
}

function extractMarker(obj: any, key: string) {
  if (!obj) return "";
  if (obj[key]) return String(obj[key]);
  if (obj.result && obj.result[key]) return String(obj.result[key]);
  return "";
}

export default function DDCapKpisOverlayPage() {
  const [profile, setProfile] = useState("moderado");
  const [benchmark, setBenchmark] = useState("SPY");

  const [loading, setLoading] = useState(false);

  const [core, setCore] = useState<AnyObj>(null);
  const [reg, setReg] = useState<AnyObj>(null);

  const [coreErr, setCoreErr] = useState<string>("");
  const [regErr, setRegErr] = useState<string>("");

  const body = useMemo(
    () => ({
      profile,
      benchmark,
      top_q: 20,
      lookback: 120,
      cap_per_ticker: 0.2,
      use_tws_raw: false,
    }),
    [profile, benchmark]
  );

  const run = async () => {
    setLoading(true);
    setCoreErr("");
    setRegErr("");
    setCore(null);
    setReg(null);

    try {
      // Prefer proxy (stable) -> backend /api/...
      const coreJson = await postJson("/api/proxy/performance/core_overlayed", body);
      setCore(coreJson);
    } catch (e: any) {
      setCoreErr(String(e?.message || e));
    }

    try {
      const regJson = await postJson("/api/proxy/kpis_overlay/regimes/run", body);
      setReg(regJson);
    } catch (e: any) {
      setRegErr(String(e?.message || e));
    }

    setLoading(false);
  };

  const eqPick = useMemo(() => (core ? pickEquityCurve(core) : { picked: null, all: [] }), [core]);
  const benchPick = useMemo(() => (core ? pickBenchCurve(core) : null), [core]);

  const kpis = useMemo(() => {
    if (!eqPick?.picked?.arr) return null;
    return calcKpisFromEquity(eqPick.picked.arr);
  }, [eqPick]);

  const benchKpis = useMemo(() => {
    if (!benchPick?.arr) return null;
    return calcKpisFromEquity(benchPick.arr);
  }, [benchPick]);

  const markers = useMemo(() => {
    const coreObj = core || {};
    const regObj = reg || {};
    return {
      _ddcap_marker_perf: extractMarker(coreObj, "_ddcap_marker_perf"),
      _ddcap_engine_marker: extractMarker(coreObj, "_ddcap_engine_marker"),
      _payload_hygiene_marker: extractMarker(coreObj, "_payload_hygiene_marker"),
      _ddcap_regimes_marker: extractMarker(regObj, "_ddcap_regimes_marker"),
      _ddcap_regimes_marker_source: extractMarker(regObj, "_ddcap_regimes_marker_source"),
      _ddcap_marker_core: extractMarker(regObj, "_ddcap_marker") || extractMarker(coreObj, "_ddcap_marker"),
    };
  }, [core, reg]);

  const bg =
    "min-h-screen bg-[radial-gradient(ellipse_at_top,_rgba(255,255,255,0.08),_rgba(0,0,0,0)_45%),linear-gradient(to_bottom,_#05070c,_#04050a)]";

  return (
    <div className={bg}>
      <div className="mx-auto max-w-6xl px-6 py-8">
        <div className="flex flex-col gap-4">
          <div className="flex items-start justify-between gap-6">
            <div>
              <div className="text-4xl font-semibold text-white">DECIDE — KPIs Overlay</div>
              <div className="mt-2 text-sm text-zinc-300">
                Fonte: <b>core_overlayed</b> (KPIs pós-overlay) + <b>regimes/run</b> (regimes marker)
              </div>
            </div>

            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                <div className="text-sm text-zinc-300">profile</div>
                <select
                  value={profile}
                  onChange={(e) => setProfile(e.target.value)}
                  className="h-10 rounded-xl border border-white/10 bg-white/5 px-3 text-white outline-none"
                >
                  <option value="conservador">conservador</option>
                  <option value="moderado">moderado</option>
                  <option value="dinamico">dinamico</option>
                </select>
              </div>

              <div className="flex items-center gap-2">
                <div className="text-sm text-zinc-300">benchmark</div>
                <input
                  value={benchmark}
                  onChange={(e) => setBenchmark(e.target.value)}
                  className="h-10 w-40 rounded-xl border border-white/10 bg-white/5 px-3 text-white outline-none"
                />
              </div>

              <button
                onClick={run}
                disabled={loading}
                className="h-11 rounded-2xl border border-white/15 bg-white/10 px-5 text-white shadow hover:bg-white/15 disabled:opacity-60"
              >
                {loading ? "Running..." : "Run"}
              </button>
            </div>
          </div>

          {/* STATUS */}
          <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
            <div className="flex items-center justify-between">
              <div className="text-lg font-semibold text-white">Estado</div>
              <div className="flex items-center gap-2">
                <Badge
                  label={coreErr ? "core_overlayed: erro" : core ? "core_overlayed: ok" : "core_overlayed: idle"}
                  tone={coreErr ? "err" : core ? "ok" : "info"}
                />
                <Badge
                  label={regErr ? "regimes/run: erro" : reg ? "regimes/run: ok" : "regimes/run: idle"}
                  tone={regErr ? "err" : reg ? "ok" : "info"}
                />
              </div>
            </div>

            {(coreErr || regErr) && (
              <div className="mt-4 rounded-xl border border-rose-500/30 bg-rose-950/30 p-4 text-sm text-rose-100">
                <div className="font-semibold">Erros</div>
                {coreErr && <div className="mt-2"><b>core_overlayed:</b> {coreErr}</div>}
                {regErr && <div className="mt-2"><b>regimes/run:</b> {regErr}</div>}
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            {/* KPI CARDS */}
            <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
              <div className="text-lg font-semibold text-white">KPIs (pós-overlay)</div>

              <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2">
                <Card title="CAGR" value={kpis ? fmtPct(kpis.cagr) : "—"} />
                <Card title="Vol" value={kpis ? fmtPct(kpis.volAnn) : "—"} />
                <Card title="Sharpe" value={kpis ? fmtNum(kpis.sharpe) : "—"} />
                <Card title="Max Drawdown" value={kpis ? fmtPct(kpis.maxdd) : "—"} />
              </div>

              <div className="mt-4 text-xs text-zinc-400">
                <b>Fonte usada para KPIs:</b>{" "}
                {eqPick?.picked ? (
                  <>
                    <span className="text-zinc-200">{eqPick.picked.path}</span>{" "}
                    <span className="text-zinc-500">(len={eqPick.picked.arr.length})</span>
                  </>
                ) : (
                  "—"
                )}
              </div>

              {benchKpis && kpis && (
                <div className="mt-3 text-xs text-zinc-400">
                  <b>Benchmark detectado:</b>{" "}
                  {benchPick ? (
                    <>
                      <span className="text-zinc-200">{benchPick.path}</span>{" "}
                      <span className="text-zinc-500">(len={benchPick.arr.length})</span>
                    </>
                  ) : (
                    "—"
                  )}
                  <div className="mt-2">
                    <span className="text-zinc-300">KPIs bench (diagnóstico):</span>{" "}
                    <span className="text-zinc-200">
                      CAGR {fmtPct(benchKpis.cagr)} · Vol {fmtPct(benchKpis.volAnn)}
                    </span>
                  </div>

                  {Math.abs((kpis.cagr ?? 0) - (benchKpis.cagr ?? 0)) < 0.003 &&
                    Math.abs((kpis.volAnn ?? 0) - (benchKpis.volAnn ?? 0)) < 0.003 && (
                      <div className="mt-2 text-rose-200">
                        ALERTA: KPIs estão praticamente iguais ao benchmark — confirma que a equity curve da estratégia está a ser devolvida.
                      </div>
                    )}
                </div>
              )}

              <div className="mt-4 text-xs text-zinc-500">
                Nota: esta página calcula KPIs a partir da <b>equity curve da estratégia</b> (não do benchmark) para evitar o bug de “curva errada”.
              </div>
            </div>

            {/* MARKERS */}
            <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
              <div className="text-lg font-semibold text-white">Markers</div>

              <div className="mt-4 divide-y divide-white/5 rounded-xl border border-white/10">
                {[
                  ["_ddcap_marker_perf", markers._ddcap_marker_perf],
                  ["_ddcap_engine_marker", markers._ddcap_engine_marker],
                  ["_payload_hygiene_marker", markers._payload_hygiene_marker],
                  ["_ddcap_regimes_marker", markers._ddcap_regimes_marker],
                  ["_ddcap_regimes_marker_source", markers._ddcap_regimes_marker_source],
                  ["_ddcap_marker (core)", markers._ddcap_marker_core],
                ].map(([k, v]) => (
                  <div key={k} className="flex items-center justify-between gap-4 px-4 py-3">
                    <div className="text-sm text-zinc-300">{k}</div>
                    <div className="text-sm text-white">{v ? v : <span className="text-zinc-500">(vazio)</span>}</div>
                  </div>
                ))}
              </div>

              <div className="mt-4 text-xs text-zinc-500">
                Objetivo: confirmar rapidamente se estás na versão certa (perf/engine/hygiene/regimes) antes de mexer em mais nada.
              </div>
            </div>
          </div>

          {/* RAW JSON */}
          <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
            <div className="text-lg font-semibold text-white">Raw (debug rápido)</div>

            <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
              <div className="rounded-xl border border-white/10 bg-black/30 p-4">
                <div className="mb-2 text-xs text-zinc-400">core_overlayed (JSON)</div>
                <pre className="max-h-[360px] overflow-auto text-xs text-zinc-200">
                  {core ? JSON.stringify(core, null, 2) : "—"}
                </pre>
              </div>

              <div className="rounded-xl border border-white/10 bg-black/30 p-4">
                <div className="mb-2 text-xs text-zinc-400">regimes/run (JSON)</div>
                <pre className="max-h-[360px] overflow-auto text-xs text-zinc-200">
                  {reg ? JSON.stringify(reg, null, 2) : "—"}
                </pre>
              </div>
            </div>

            {core && (
              <div className="mt-4 text-xs text-zinc-500">
                <b>Equity arrays detectadas (top 6):</b>{" "}
                {eqPick.all
                  .slice()
                  .sort((a, b) => b.arr.length - a.arr.length)
                  .slice(0, 6)
                  .map((c) => `${c.path} (len=${c.arr.length})`)
                  .join(" | ")}
              </div>
            )}

            <div className="mt-4 text-xs text-zinc-500">URL: /kpis_overlay/ddcap</div>
          </div>
        </div>
      </div>
    </div>
  );
}