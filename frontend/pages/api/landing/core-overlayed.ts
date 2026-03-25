import type { NextApiRequest, NextApiResponse } from "next";
import fs from "fs";
import path from "path";

type SeriesPack = {
  dates: string[];
  benchmark_equity: number[];
  equity_overlayed: number[];
  equity_raw: number[];
};

function normalizeSnapshot(raw: unknown): SeriesPack {
  if (Array.isArray(raw)) {
    const dates: string[] = [];
    const benchmark_equity: number[] = [];
    const equity_overlayed: number[] = [];
    const equity_raw: number[] = [];
    for (const row of raw) {
      if (!row || typeof row !== "object") continue;
      const r = row as Record<string, unknown>;
      dates.push(String(r.date ?? ""));
      benchmark_equity.push(Number(r.benchmark_equity));
      const eq = r.equity;
      equity_overlayed.push(Number(r.equity_overlayed ?? eq));
      equity_raw.push(Number(r.equity_raw ?? eq));
    }
    return { dates, benchmark_equity, equity_overlayed, equity_raw };
  }
  if (raw && typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    if (Array.isArray(o.dates)) {
      return {
        dates: o.dates as string[],
        benchmark_equity: (o.benchmark_equity as number[]) || [],
        equity_overlayed: (o.equity_overlayed as number[]) || [],
        equity_raw: (o.equity_raw as number[]) || [],
      };
    }
    const s = o.series as Record<string, unknown> | undefined;
    if (s && Array.isArray(s.dates)) {
      return {
        dates: s.dates as string[],
        benchmark_equity: (s.benchmark_equity as number[]) || [],
        equity_overlayed: (s.equity_overlayed as number[]) || [],
        equity_raw: (s.equity_raw as number[]) || [],
      };
    }
  }
  return { dates: [], benchmark_equity: [], equity_overlayed: [], equity_raw: [] };
}

function loadLocalSnapshot(): { series: SeriesPack; source: string } | null {
  const snap = path.join(
    process.cwd(),
    "..",
    "backend",
    "data",
    "equity_curves",
    "core_overlayed",
    "core_overlayed_latest.json",
  );
  if (!fs.existsSync(snap)) return null;
  const raw = JSON.parse(fs.readFileSync(snap, "utf8")) as unknown;
  const series = normalizeSnapshot(raw);
  return { series, source: snap };
}

/**
 * Landing: tenta o backend (8090); se estiver offline, usa o snapshot no repo (mesmo ficheiro que o FastAPI lê).
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const backendBase = (
    process.env.BACKEND_URL ||
    process.env.NEXT_PUBLIC_BACKEND_URL ||
    "http://127.0.0.1:8090"
  )
    .trim()
    .replace(/\/+$/, "");

  const bodyObj =
    req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)
      ? (req.body as object)
      : {};

  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    const r = await fetch(`${backendBase}/api/performance/core_overlayed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(bodyObj),
      signal: ctrl.signal,
    });
    clearTimeout(t);
    const text = await r.text();
    if (r.ok) {
      try {
        const j = JSON.parse(text) as { ok?: boolean; series?: SeriesPack };
        const n = j?.series?.dates?.length ?? 0;
        if (j && j.ok !== false && n >= 50) {
          return res.status(200).json(j);
        }
      } catch {
        /* fall through */
      }
    }
  } catch {
    /* backend down or timeout */
  }

  const local = loadLocalSnapshot();
  if (local && local.series.dates.length >= 50) {
    return res.status(200).json({
      ok: true,
      series: local.series,
      result: {
        source_file: local.source,
        kind: "next_repo_fallback",
        note: "Backend indisponível; dados do snapshot local.",
      },
    });
  }

  return res.status(503).json({
    ok: false,
    error:
      "Motor em 8090 offline e snapshot local não encontrado. Arranca o backend ou coloca core_overlayed_latest.json em backend/data/equity_curves/core_overlayed/",
    series: local?.series ?? { dates: [], benchmark_equity: [], equity_overlayed: [], equity_raw: [] },
  });
}
