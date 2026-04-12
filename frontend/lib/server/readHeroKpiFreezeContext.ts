import fs from "fs";
import path from "path";
import { FREEZE_PLAFONADO_MODEL_DIR } from "../freezePlafonadoDir";
import {
  cagrFractionFromEquityLikeKpiServer,
  overlayedCagrToDisplayPercent,
} from "../planDecisionKpiMath";

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === "," && !inQuotes) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out;
}

function parseIsoishDate(raw: string): Date | null {
  const s = raw.trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T12:00:00`);
  return Number.isFinite(d.getTime()) ? d : null;
}

function formatPtMonthYear(d: Date): string {
  return d.toLocaleDateString("pt-PT", { month: "short", year: "numeric" });
}

/**
 * Primeira / última data da série do benchmark no freeze + CAGR histórico da mesma curva
 * (alinhado ao `compute_kpis` do kpi_server sobre `benchmark_equity`).
 */
export function readHeroKpiFreezeContext(projectRoot: string): {
  historyPeriodLabel: string | null;
  /** Ex.: `2006–2026` para microcopy no dashboard. */
  historyYearRangeLabel: string | null;
  benchmarkCagrPct: number | null;
} {
  const smoothOut = path.join(projectRoot, "freeze", FREEZE_PLAFONADO_MODEL_DIR, "model_outputs");
  const smoothKpis = path.join(smoothOut, "v5_kpis.json");
  try {
    if (fs.existsSync(smoothKpis)) {
      const raw = fs.readFileSync(smoothKpis, "utf8");
      const meta = JSON.parse(raw) as {
        benchmark_cagr?: unknown;
        data_start?: unknown;
        data_end?: unknown;
      };
      const benchmarkCagrPct = overlayedCagrToDisplayPercent(meta.benchmark_cagr);
      if (benchmarkCagrPct != null) {
        const ds = String(meta.data_start ?? "").trim().slice(0, 10);
        const de = String(meta.data_end ?? "").trim().slice(0, 10);
        const d0 = parseIsoishDate(ds);
        const d1 = parseIsoishDate(de);
        const historyPeriodLabel =
          d0 && d1 ? `${formatPtMonthYear(d0)} – ${formatPtMonthYear(d1)}` : null;
        const y0 = d0?.getFullYear();
        const y1 = d1?.getFullYear();
        const historyYearRangeLabel =
          y0 != null && y1 != null ? (y0 === y1 ? `${y0}` : `${y0}–${y1}`) : null;
        return { historyPeriodLabel, historyYearRangeLabel, benchmarkCagrPct };
      }
    }
  } catch {
    /* fall through to CSV */
  }

  const smoothCloneBench = path.join(
    projectRoot,
    "freeze",
    FREEZE_PLAFONADO_MODEL_DIR,
    "model_outputs_from_clone",
    "benchmark_equity_final_20y.csv",
  );
  const smoothPrimaryBench = path.join(smoothOut, "benchmark_equity_final_20y.csv");

  const tryRel = [
    [smoothCloneBench],
    [smoothPrimaryBench],
    [path.join(projectRoot, "frontend", "data", "landing", "freeze-cap15", "benchmark_equity_final_20y.csv")],
  ];
  for (const parts of tryRel) {
    const p = parts[0];
    if (!p || !fs.existsSync(p)) continue;
    try {
      const text = fs.readFileSync(p, "utf8");
      const lines = text
        .replace(/\r/g, "")
        .split("\n")
        .filter((l) => l.trim().length > 0);
      if (lines.length < 3) continue;
      const headers = splitCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
      const dateIdx = headers.findIndex((h) => h === "date");
      const benchIdx = headers.findIndex(
        (h) => h === "benchmark_equity" || h.includes("benchmark"),
      );
      if (dateIdx < 0 || benchIdx < 0) continue;
      const equity: number[] = [];
      let firstDate: Date | null = null;
      let lastDate: Date | null = null;
      for (let i = 1; i < lines.length; i += 1) {
        const cols = splitCsvLine(lines[i]);
        const ds = cols[dateIdx] ?? "";
        const d = parseIsoishDate(ds);
        const v = Number(String(cols[benchIdx] ?? "").trim());
        if (!Number.isFinite(v) || v <= 0) continue;
        if (!firstDate && d) firstDate = d;
        if (d) lastDate = d;
        equity.push(v);
      }
      if (equity.length < 500 || !firstDate || !lastDate) continue;
      const frac = cagrFractionFromEquityLikeKpiServer(equity);
      const benchmarkCagrPct =
        frac != null ? overlayedCagrToDisplayPercent(frac) : null;
      const historyPeriodLabel = `${formatPtMonthYear(firstDate)} – ${formatPtMonthYear(lastDate)}`;
      const y0 = firstDate.getFullYear();
      const y1 = lastDate.getFullYear();
      const historyYearRangeLabel = y0 === y1 ? `${y0}` : `${y0}–${y1}`;
      return { historyPeriodLabel, historyYearRangeLabel, benchmarkCagrPct };
    } catch {
      /* next path */
    }
  }
  return { historyPeriodLabel: null, historyYearRangeLabel: null, benchmarkCagrPct: null };
}
