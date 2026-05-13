/**
 * /api/portfolio-quality
 *
 * Reads FMP data from bundled JSON files (frontend/data/fmp_*.json).
 * No dependency on the FastAPI backend — works on Vercel standalone.
 *
 * POST body: { positions: [{ticker: string, weight: number}] }
 */
import type { NextApiRequest, NextApiResponse } from "next";
import path from "path";
import fs from "fs";

// ── types ────────────────────────────────────────────────────────────────────
type FundRow = Record<string, number | null>;
type SecRow  = { sector: string; industry: string; name: string; country: string };

// ── lazy loaders (cached in-process) ─────────────────────────────────────────
let _fund: Record<string, FundRow> | null = null;
let _sec:  Record<string, SecRow>  | null = null;

function loadFund(): Record<string, FundRow> {
  if (!_fund) {
    const p = path.join(process.cwd(), "data", "fmp_fundamentals.json");
    _fund = JSON.parse(fs.readFileSync(p, "utf8"));
  }
  return _fund!;
}

function loadSec(): Record<string, SecRow> {
  if (!_sec) {
    const p = path.join(process.cwd(), "data", "fmp_sectors.json");
    _sec = JSON.parse(fs.readFileSync(p, "utf8"));
  }
  return _sec!;
}

// ── helpers ───────────────────────────────────────────────────────────────────
function qualityLabel(roic: number | null | undefined): string {
  if (roic == null) return "n/d";
  if (roic > 0.25)  return "Alta";
  if (roic > 0.12)  return "Média";
  return "Baixa";
}

function buildTickerFundamentals(tickers: string[]) {
  const fund = loadFund();
  const sec  = loadSec();
  return tickers.map((tkr) => {
    const row: Record<string, unknown> = { ticker: tkr };
    const f = fund[tkr];
    if (f) {
      row.roic              = f.roic              ?? null;
      row.gross_margin      = f.gross_margin      ?? null;
      row.op_margin         = f.op_margin         ?? null;
      row.net_margin        = f.net_margin        ?? null;
      row.fcf_margin        = f.fcf_margin        ?? null;
      row.debt_equity       = f.debt_equity       ?? null;
      row.current_ratio     = f.current_ratio     ?? null;
      row.interest_coverage = f.interest_coverage ?? null;
      row.revenue_growth    = f.revenue_growth    ?? null;
      row.eps_stability     = f.eps_stability     ?? null;
      row.pe_ratio          = f.pe_ratio          ?? null;
      row.quality_label     = qualityLabel(f.roic ?? null);
    }
    const s = sec[tkr];
    if (s) {
      row.sector   = s.sector;
      row.industry = s.industry;
      row.name     = s.name;
      row.country  = s.country;
    }
    return row;
  });
}

function portfolioQualitySummary(tickers: string[], weights: Record<string, number>) {
  const fund = loadFund();
  const sec  = loadSec();

  const metrics = ["roic", "gross_margin", "op_margin", "net_margin", "debt_equity", "revenue_growth"] as const;
  const weighted: Record<string, number[]> = Object.fromEntries(metrics.map((m) => [m, []]));
  const wLists:   Record<string, number[]> = Object.fromEntries(metrics.map((m) => [m, []]));

  for (const tkr of tickers) {
    const f = fund[tkr];
    if (!f) continue;
    const w = weights[tkr] ?? 0;
    for (const m of metrics) {
      const v = f[m];
      if (v != null && isFinite(v)) {
        weighted[m].push(v * w);
        wLists[m].push(w);
      }
    }
  }

  const summary: Record<string, unknown> = {};
  for (const m of metrics) {
    const totalW = wLists[m].reduce((s, x) => s + x, 0);
    summary[m] = totalW > 0 ? Math.round((weighted[m].reduce((s, x) => s + x, 0) / totalW) * 10000) / 10000 : null;
  }

  // Sector exposure
  const sectorExp: Record<string, number> = {};
  for (const tkr of tickers) {
    const w = weights[tkr] ?? 0;
    const s = sec[tkr]?.sector ?? "Unknown";
    sectorExp[s] = Math.round(((sectorExp[s] ?? 0) + w) * 10000) / 10000;
  }
  summary.sector_exposure = Object.fromEntries(
    Object.entries(sectorExp).sort(([, a], [, b]) => b - a)
  );
  summary.portfolio_quality_label = qualityLabel(summary.roic as number | null);

  return summary;
}

// ── handler ───────────────────────────────────────────────────────────────────
export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const positions: { ticker: string; weight: number }[] = req.body?.positions ?? [];
    if (!positions.length) {
      return res.status(400).json({ error: "no positions" });
    }

    const tickers = positions.map((p) => p.ticker);
    const weights = Object.fromEntries(positions.map((p) => [p.ticker, p.weight]));

    const summary    = portfolioQualitySummary(tickers, weights);
    const tickerData = buildTickerFundamentals(tickers);

    return res.status(200).json({
      portfolio_summary: summary,
      tickers:           tickerData,
      n_positions:       tickers.length,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ error: msg });
  }
}
