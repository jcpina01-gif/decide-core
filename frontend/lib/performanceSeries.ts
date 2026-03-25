import fs from "fs";

export type BackendPortfolio = {
  ok?: boolean;
  model_version?: string;
  source_file?: string;
};

export type CsvPoint = {
  date: string;
  value: number;
};

export type ApiPoint = {
  date: string;
  model: number;
  benchmark: number;
  alpha_pct: number;
  model_drawdown: number;
  benchmark_drawdown: number;
};

function splitCsvLine(line: string): string[] {
  return line.split(",").map((s) => s.trim());
}

export function parseCsvSeries(filePath: string, preferredNames: string[]): CsvPoint[] {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing file: ${filePath}`);
  }

  const raw = fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "").trim();
  if (!raw) {
    throw new Error(`Empty file: ${filePath}`);
  }

  const lines = raw.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) {
    throw new Error(`Too few lines: ${filePath}`);
  }

  const headers = splitCsvLine(lines[0]);
  const headerLower = headers.map((h) => h.toLowerCase());

  let dateIdx = headerLower.findIndex((h) => h === "date" || h === "datetime" || h === "time" || h === "index");
  if (dateIdx < 0) dateIdx = 0;

  let valueIdx = -1;
  for (const pref of preferredNames) {
    const idx = headerLower.findIndex((h) => h === pref.toLowerCase());
    if (idx >= 0) {
      valueIdx = idx;
      break;
    }
  }

  if (valueIdx < 0) {
    for (let i = headers.length - 1; i >= 0; i--) {
      if (i === dateIdx) continue;
      const sample = splitCsvLine(lines[Math.min(1, lines.length - 1)])[i];
      if (sample !== undefined && sample !== "" && Number.isFinite(Number(sample))) {
        valueIdx = i;
        break;
      }
    }
  }

  if (valueIdx < 0) {
    throw new Error(`Could not infer value column: ${filePath}`);
  }

  const out: CsvPoint[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = splitCsvLine(lines[i]);
    const date = cols[dateIdx];
    const value = Number(cols[valueIdx]);

    if (!date || !Number.isFinite(value)) continue;

    out.push({ date, value });
  }

  out.sort((a, b) => a.date.localeCompare(b.date));
  return out;
}

export function normalizeBase100(points: CsvPoint[]): CsvPoint[] {
  if (points.length === 0) return [];
  const first = points[0].value;
  if (!Number.isFinite(first) || first === 0) {
    throw new Error("Invalid first value for normalization");
  }

  return points.map((p) => ({
    date: p.date,
    value: (p.value / first) * 100,
  }));
}

export function drawdownSeries(points: CsvPoint[]): CsvPoint[] {
  let peak = -Infinity;
  return points.map((p) => {
    if (p.value > peak) peak = p.value;
    const dd = peak > 0 ? p.value / peak - 1 : 0;
    return { date: p.date, value: dd };
  });
}

export function alignSeries(modelPoints: CsvPoint[], benchPoints: CsvPoint[]): ApiPoint[] {
  const benchMap = new Map<string, number>();
  for (const p of benchPoints) benchMap.set(p.date, p.value);

  const modelDd = drawdownSeries(modelPoints);
  const benchDd = drawdownSeries(benchPoints);

  const modelDdMap = new Map<string, number>();
  const benchDdMap = new Map<string, number>();

  for (const p of modelDd) modelDdMap.set(p.date, p.value);
  for (const p of benchDd) benchDdMap.set(p.date, p.value);

  const out: ApiPoint[] = [];

  for (const mp of modelPoints) {
    const b = benchMap.get(mp.date);
    if (b === undefined) continue;

    const alphaPct = b !== 0 ? ((mp.value / b) - 1) * 100 : 0;

    out.push({
      date: mp.date,
      model: Number(mp.value.toFixed(6)),
      benchmark: Number(b.toFixed(6)),
      alpha_pct: Number(alphaPct.toFixed(6)),
      model_drawdown: Number((modelDdMap.get(mp.date) ?? 0).toFixed(6)),
      benchmark_drawdown: Number((benchDdMap.get(mp.date) ?? 0).toFixed(6)),
    });
  }

  return out;
}
