import React, { useMemo } from "react";

type SeriesLine = {
  name: string;
  values: number[];
  color?: string; // opcional (se não derem cor, fica default no SVG)
  visible?: boolean;
};

type Props = {
  dates: string[];
  series: SeriesLine[];
  width?: number;
  height?: number;
  padding?: number;
  logScale?: boolean; // default true
};

function safeLog(x: number): number {
  if (!Number.isFinite(x) || x <= 0) return Math.log(1e-9);
  return Math.log(x);
}

function buildPolylinePoints(
  values: number[],
  w: number,
  h: number,
  pad: number,
  yMin: number,
  yMax: number,
  useLog: boolean
): string {
  const n = values.length;
  if (n <= 1) return "";

  const x0 = pad;
  const x1 = w - pad;
  const y0 = pad;
  const y1 = h - pad;

  const spanX = Math.max(1, x1 - x0);
  const spanY = Math.max(1, y1 - y0);
  const denom = Math.max(1e-12, yMax - yMin);

  const pts: string[] = [];
  for (let i = 0; i < n; i++) {
    const x = x0 + (i * spanX) / (n - 1);
    const rawY = Number(values[i] ?? 0);
    const yy = useLog ? safeLog(rawY) : rawY;
    const t = (yy - yMin) / denom;
    const y = y1 - t * spanY;
    if (Number.isFinite(x) && Number.isFinite(y)) pts.push(`${x.toFixed(2)},${y.toFixed(2)}`);
  }
  return pts.join(" ");
}

function normalizeSeriesLength(values: number[] = [], n: number): number[] {
  if (!Array.isArray(values)) return [];
  if (values.length === n) return values.map((x) => Number(x ?? 0));
  if (values.length > n) return values.slice(0, n).map((x) => Number(x ?? 0));
  const out = values.slice(0).map((x) => Number(x ?? 0));
  while (out.length < n) out.push(out.length ? out[out.length - 1] : 0);
  return out;
}

export default function EquityCurvesChart(props: Props) {
  const width = props.width ?? 980;
  const height = props.height ?? 380;
  const padding = props.padding ?? 30;
  const logScale = props.logScale ?? true;

  const dates = Array.isArray(props.dates) ? props.dates : [];
  const rawSeries = Array.isArray(props.series) ? props.series : [];

  const n = useMemo(() => {
    const lens = [dates.length, ...rawSeries.map((s) => (Array.isArray(s.values) ? s.values.length : 0))];
    const minLen = Math.min(...lens.filter((x) => x > 0));
    return Number.isFinite(minLen) && minLen > 1 ? minLen : 0;
  }, [dates, rawSeries]);

  const prepared = useMemo(() => {
    if (n <= 1) return { yMin: 0, yMax: 1, lines: [] as Array<{ name: string; pts: string; color: string }> };

    const visibleSeries = rawSeries.filter((s) => s.visible !== false);

    const norm = visibleSeries.map((s) => ({
      name: s.name,
      color: s.color || "#ffffff",
      values: normalizeSeriesLength(s.values || [], n),
    }));

    const all: number[] = [];
    for (const s of norm) {
      for (const v of s.values) {
        if (Number.isFinite(v) && v > 0) all.push(logScale ? safeLog(v) : v);
      }
    }

    const yMin = all.length ? Math.min(...all) : (logScale ? safeLog(1) : 1);
    const yMax = all.length ? Math.max(...all) : (logScale ? safeLog(2) : 2);

    const lines = norm.map((s) => ({
      name: s.name,
      color: s.color,
      pts: buildPolylinePoints(s.values, width, height, padding, yMin, yMax, logScale),
    }));

    return { yMin, yMax, lines };
  }, [n, rawSeries, width, height, padding, logScale]);

  if (n <= 1) {
    return (
      <div style={{ padding: 12, color: "#b7c3e0", fontSize: 12 }}>
        Sem dados suficientes para desenhar o gráfico.
      </div>
    );
  }

  return (
    <div style={{ overflowX: "auto" }}>
      <svg
        width={width}
        height={height}
        style={{
          background: "#1a2d59",
          borderRadius: 16,
          border: "1px solid rgba(255,255,255,0.08)",
        }}
      >
        {prepared.lines.map((l) => (
          <polyline
            key={l.name}
            points={l.pts}
            fill="none"
            stroke={l.color}
            strokeWidth={2}
            opacity={0.95}
          />
        ))}
      </svg>
    </div>
  );
}