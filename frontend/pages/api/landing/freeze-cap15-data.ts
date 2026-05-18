/**
 * Landing / simulador de custos: série alinhada ao Modelo CAP15 (`compute_client_embed_plafonado_kpis` no kpi_server)
 * (CAP15 + m100; moderado alvo 1× no motor e alinhamento 1× no cliente como no KPI strict; conservador/dinâmico com alvo vs benchmark; no Flask `DECIDE_KPI_REAL_EQUITY=1` só mexe na escolha do CSV no embed).
 */

import type { NextApiRequest, NextApiResponse } from "next";
import { resolveNextFrontendAppDir } from "../../../lib/server/decideProjectRoot";
import {
  buildPlafonadoEmbedLikeSeries,
  normalizeRiskProfileKeyForKpi,
} from "../../../lib/plafonadoFeesSeries";
import {
  applyFxHedgeToSeries,
  FX_HEDGE_PCT,
  normalizeFxExposure,
} from "../../../lib/server/applyFxHedge";

const RISK_FREE_ANNUAL = 0.02; // EUR risk-free rate — matches client-dashboard.tsx

function srvAnnualVol(r: number[]): number {
  const clean = r.filter((x) => Number.isFinite(x));
  if (clean.length < 5) return 0;
  const m = clean.reduce((a, b) => a + b, 0) / clean.length;
  const v = Math.sqrt((clean.reduce((a, b) => a + (b - m) ** 2, 0) / (clean.length - 1)) * 252);
  return Number.isFinite(v) ? v : 0;
}

function srvScaleEquityCurve(equity: number[], factor: number): number[] {
  const out: number[] = [equity[0] || 1];
  for (let i = 1; i < equity.length; i++) {
    const r = equity[i]! / equity[i - 1]! - 1;
    if (r === 0) { out.push(out[i - 1]!); continue; }
    out.push(out[i - 1]! * (1 + r * factor));
  }
  return out;
}

/**
 * Mirrors the dashboard's volRuleScale + scaleEquityCurve + warmup detection + inception KPI calc.
 * Returns { ann, shp, ret, warmup_end_idx, s20_idx } so the client can use pre-computed values.
 */
function computeInceptionKpis(
  dates: string[],
  equity_overlayed: number[],
  benchmark_equity: number[],
  profileFactor: number,
): { ann: number; shp: number; ret: number; warmup_end_idx: number; s20_idx: number } | null {
  const n = equity_overlayed.length;
  if (n < 2 || dates.length < 2) return null;

  // Replicate dashboard volRuleScale = (benchVol * profileFactor) / modelVol
  const mRets = equity_overlayed.slice(1).map((v, i) =>
    (equity_overlayed[i] ?? 0) > 0 ? v / equity_overlayed[i]! - 1 : 0,
  );
  const bRets = benchmark_equity.slice(1).map((v, i) =>
    (benchmark_equity[i] ?? 0) > 0 ? v / benchmark_equity[i]! - 1 : 0,
  );
  const mVol = srvAnnualVol(mRets);
  const bVol = srvAnnualVol(bRets);
  const volRuleScale = mVol > 0 ? (bVol * profileFactor) / mVol : profileFactor;

  // Apply vol scaling — same as scaleEquityCurve in dashboard
  const activeEquity = srvScaleEquityCurve(equity_overlayed, volRuleScale);

  // Warmup end: scan from start for first non-flat index (same 1e-12 threshold)
  const initVal = activeEquity[0] ?? 1;
  let warmupEnd = 1;
  while (
    warmupEnd < n - 1 &&
    Math.abs((activeEquity[warmupEnd] ?? 0) - initVal) < 1e-12
  ) warmupEnd++;

  // 20-year rolling cut
  const lastDate = new Date(dates[n - 1]!);
  const cut20 = new Date(lastDate.getFullYear() - 20, lastDate.getMonth(), lastDate.getDate());
  let s20cut = dates.findIndex((d) => new Date(d) >= cut20);
  if (s20cut < 0) s20cut = 0;
  const s20 = Math.max(s20cut, warmupEnd);

  const sliceEq = activeEquity.slice(s20);
  const sliceDates = dates.slice(s20);
  const sliceBench = benchmark_equity.slice(s20);
  if (sliceEq.length < 2) return null;

  const calYears =
    (new Date(sliceDates[sliceDates.length - 1]!).getTime() -
      new Date(sliceDates[0]!).getTime()) /
    (365.25 * 24 * 3600 * 1000);
  if (!(calYears > 0)) return null;

  const eqStart = sliceEq[0]!;
  const eqEnd = sliceEq[sliceEq.length - 1]!;
  const ret = (eqEnd / eqStart - 1) * 100;
  const ann = (Math.pow(eqEnd / eqStart, 1 / calYears) - 1) * 100;

  // Sharpe with 2% EUR risk-free — mirrors dashboard sharpe()
  const rets = sliceEq.slice(1).map((v, i) => v / sliceEq[i]! - 1);
  const dailyVol = srvAnnualVol(rets) / Math.sqrt(252);
  const rfDaily = RISK_FREE_ANNUAL / 252;
  const meanRet = rets.reduce((a, b) => a + b, 0) / Math.max(1, rets.length);
  const shp = dailyVol > 0 ? ((meanRet - rfDaily) / dailyVol) * Math.sqrt(252) : 0;

  void sliceBench; // available but not needed for scalar KPIs
  return { ann, shp, ret, warmup_end_idx: warmupEnd, s20_idx: s20 };
}

function normalizeProfileParam(raw: unknown): string {
  return normalizeRiskProfileKeyForKpi(
    raw === undefined || raw === null ? undefined : String(raw),
  );
}

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const profile = normalizeProfileParam(
    typeof req.query.profile === "string" ? req.query.profile : undefined,
  );

  const fxExposure = normalizeFxExposure(
    typeof req.query.fx_exposure === "string" ? req.query.fx_exposure : "aberta",
  );
  const hedgePct = FX_HEDGE_PCT[fxExposure];

  res.setHeader("Cache-Control", "no-store, no-cache, max-age=0, s-maxage=0, must-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.setHeader("Surrogate-Control", "no-store");
  res.setHeader("Vercel-CDN-Cache-Control", "no-store");

  const built = buildPlafonadoEmbedLikeSeries(profile, resolveNextFrontendAppDir());
  if (!built) {
    return res.status(404).json({
      ok: false,
      error:
        "Freeze CAP15 / m100 ou landing freeze-cap15 não encontrado. Coloca os CSV no monorepo ou em frontend/data/landing/freeze-cap15/.",
    });
  }

  const cwd = resolveNextFrontendAppDir();
  const equity_overlayed = hedgePct > 0
    ? applyFxHedgeToSeries(built.dates, built.equity_overlayed, hedgePct, cwd)
    : built.equity_overlayed;

  const equity_overlayed_margin = built.equity_overlayed_margin
    ? (hedgePct > 0
        ? applyFxHedgeToSeries(built.dates, built.equity_overlayed_margin, hedgePct, cwd)
        : built.equity_overlayed_margin)
    : null;

  const lastD =
    built.dates.length > 0 ? String(built.dates[built.dates.length - 1]) : null;
  const m = lastD && lastD.match(/(\d{4}-\d{2}-\d{2})/);
  const seriesEndYmd = m ? m[1] : lastD;
  const seriesDataSource = built.meta.aligned_cap15_m100
    ? "freeze_model_outputs"
    : "landing_freeze_cap15";

  // Profile vol multiplier mirrors dashboard profileFactor
  const pk = profile || "moderado";
  const profileFactor = pk === "conservador" ? 0.75 : pk === "dinamico" ? 1.25 : 1.0;

  // Pre-compute inception KPIs server-side — eliminates client-side warmup detection issues.
  // The client reads these directly for the Performance table "20 Anos" row.
  const inceptionKpis = computeInceptionKpis(
    built.dates,
    equity_overlayed,
    built.benchmark_equity,
    profileFactor,
  );

  return res.status(200).json({
    ok: true,
    series: {
      dates: built.dates,
      benchmark_equity: built.benchmark_equity,
      equity_overlayed,
      equity_overlayed_margin,
      equity_raw: built.equity_raw,
    },
    result: {
      kind: "freeze_v5_plafonado_embed_aligned",
      series_end: seriesEndYmd,
      series_data_source: seriesDataSource,
      profile: built.meta.profile,
      fx_exposure: fxExposure,
      fx_hedge_pct: hedgePct,
      note:
        "Mesma construção que o cartão «Modelo CAP15» / `/api/embed-plafonado-cagr` (kpi_server): CAP15 + m100 plafonado; moderado ≈1× vol ref. (motor + alinhamento no cliente); conservador/dinâmico com alvo vs benchmark.",
      aligned_cap15_m100: built.meta.aligned_cap15_m100,
      force_synthetic_vol: built.meta.force_synthetic_vol,
      used_m100_profile_file: built.meta.used_m100_profile_file,
      /** Evita segundo filtro de vol no cliente (landing); a série do API já está final. */
      vol_matched_for_landing: true,
      /** KPIs de inception pré-calculados no servidor (desde o fim do warmup, janela rolante 20A).
       *  ann = CAGR%, shp = Sharpe (Rf=2%), ret = retorno total%; warmup_end_idx / s20_idx = índices debug. */
      inception_kpis: inceptionKpis,
    },
  });
}
