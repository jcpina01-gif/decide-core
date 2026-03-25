/**

 * Landing pública: modelo plafonado (≤100% NV) a partir do freeze MAX100EXP.

 * A série devolvida em `equity_overlayed` já tem vol ajustada à do benchmark

 * (equivalente ao perfil moderado no kpi_server / 1× vol do bench), como nos KPIs do cartão plafonado.

 */

import fs from "fs";

import path from "path";

import type { NextApiRequest, NextApiResponse } from "next";



const FREEZE_SEG = ["..", "freeze", "DECIDE_MODEL_V5_OVERLAY_CAP15_MAX100EXP", "model_outputs"] as const;



function parseEquityCsv(text: string): { dates: string[]; equity: number[] } {

  const dates: string[] = [];

  const equity: number[] = [];

  const lines = text.split(/\r?\n/);

  for (let li = 1; li < lines.length; li++) {

    const line = lines[li].trim();

    if (!line) continue;

    const comma = line.indexOf(",");

    if (comma < 0) continue;

    const dRaw = line.slice(0, comma).trim();

    const vRaw = line.slice(comma + 1).trim();

    const v = parseFloat(vRaw);

    if (!isFinite(v)) continue;

    const d = dRaw.length >= 10 ? dRaw.slice(0, 10) : dRaw;

    dates.push(d);

    equity.push(v);

  }

  return { dates, equity };

}



function volAnnualized(dailyEquity: number[]): number | null {

  const rets: number[] = [];

  for (let i = 1; i < dailyEquity.length; i++) {

    const a = dailyEquity[i - 1];

    const b = dailyEquity[i];

    if (a > 0 && b > 0) rets.push(b / a - 1);

  }

  if (rets.length < 30) return null;

  const mean = rets.reduce((s, x) => s + x, 0) / rets.length;

  let v = 0;

  for (const r of rets) v += (r - mean) * (r - mean);

  const sd = Math.sqrt(v / Math.max(1, rets.length - 1));

  return sd * Math.sqrt(252);

}



/** Igual à landing / kpi_server moderado: σ_modelo → σ_benchmark na amostra. */

function scaleModelEquityToBenchVol(modelEq: number[], benchEq: number[]): number[] {

  const n = Math.min(modelEq.length, benchEq.length);

  if (n < 50) return modelEq;

  const m = modelEq.slice(0, n);

  const b = benchEq.slice(0, n);

  const volM = volAnnualized(m);

  const volB = volAnnualized(b);

  if (volM === null || volB === null || volM <= 1e-12) return modelEq;

  const scale = volB / volM;

  const out: number[] = [m[0]];

  for (let i = 1; i < n; i++) {

    const r = m[i] / m[i - 1] - 1;

    out.push(out[i - 1] * (1 + r * scale));

  }

  for (let j = n; j < modelEq.length; j++) out.push(modelEq[j]);

  return out;

}



export default function handler(req: NextApiRequest, res: NextApiResponse) {

  if (req.method !== "GET" && req.method !== "POST") {

    res.setHeader("Allow", "GET, POST");

    return res.status(405).json({ ok: false, error: "Method not allowed" });

  }



  const dir = path.join(process.cwd(), ...FREEZE_SEG);

  const modelP = path.join(dir, "model_equity_final_20y.csv");

  const benchP = path.join(dir, "benchmark_equity_final_20y.csv");



  if (!fs.existsSync(modelP) || !fs.existsSync(benchP)) {

    return res.status(404).json({

      ok: false,

      error:

        "Freeze modelo plafonado (≤100% NV) não encontrado em ../freeze/DECIDE_MODEL_V5_OVERLAY_CAP15_MAX100EXP/model_outputs/. Usa o fallback core-overlayed ou gera o freeze.",

    });

  }



  let modelT: string;

  let benchT: string;

  try {

    modelT = fs.readFileSync(modelP, "utf8");

    benchT = fs.readFileSync(benchP, "utf8");

  } catch (e: unknown) {

    const msg = e instanceof Error ? e.message : String(e);

    return res.status(500).json({ ok: false, error: msg });

  }



  const m = parseEquityCsv(modelT);

  const b = parseEquityCsv(benchT);

  const n = Math.min(m.dates.length, m.equity.length, b.dates.length, b.equity.length);

  if (n < 50) {

    return res.status(500).json({ ok: false, error: "Série demasiado curta após parse dos CSV." });

  }



  const dates = m.dates.slice(0, n);

  const benchmark_equity = b.equity.slice(0, n);

  const equity_native = m.equity.slice(0, n);

  const equity_overlayed = scaleModelEquityToBenchVol(equity_native, benchmark_equity);



  return res.status(200).json({

    ok: true,

    series: {

      dates,

      benchmark_equity,

      equity_overlayed,

      equity_raw: equity_native,

    },

    result: {

      kind: "freeze_v5_overlay_cap15_max100exp",

      note:

        "Modelo plafonado (≤100% NV); vol da série do modelo ajustada à do benchmark (perfil moderado / 1×), alinhado ao cartão plafonado no KPI :5000.",

      vol_matched_for_landing: true,

      landing_vol_profile: "moderado",

    },

  });

}


