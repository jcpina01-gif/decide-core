import React, { useMemo } from "react";
import { DECIDE_DASHBOARD } from "../lib/decideClientTheme";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
  ResponsiveContainer,
} from "recharts";

type Props = {
  dates: string[];
  benchmark: number[];
  raw: number[];
  rawVolMatched: number[];
  overlayed: number[];
};

function fmtDate(x: string) {
  if (!x) return "";
  return String(x).slice(0, 10);
}

function fmtVal(v: any) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  return n.toFixed(2);
}

export default function EquityChart({
  dates,
  benchmark,
  raw,
  rawVolMatched,
  overlayed,
}: Props) {
  const data = useMemo(() => {
    const n = Math.min(
      dates?.length ?? 0,
      benchmark?.length ?? 0,
      raw?.length ?? 0,
      rawVolMatched?.length ?? 0,
      overlayed?.length ?? 0
    );

    const rows: Array<Record<string, any>> = [];
    for (let i = 0; i < n; i += 1) {
      const b = Number(benchmark[i]);
      const r = Number(raw[i]);
      const vm = Number(rawVolMatched[i]);
      const o = Number(overlayed[i]);

      if (
        Number.isFinite(b) && b > 0 &&
        Number.isFinite(r) && r > 0 &&
        Number.isFinite(vm) && vm > 0 &&
        Number.isFinite(o) && o > 0
      ) {
        rows.push({
          date: fmtDate(dates[i]),
          benchmark: b,
          raw: r,
          rawVolMatched: vm,
          overlayed: o,
        });
      }
    }
    return rows;
  }, [dates, benchmark, raw, rawVolMatched, overlayed]);

  if (!data.length) {
    return (
      <div className="rounded-3xl border border-slate-800 bg-slate-950/60 p-6">
        <h2 className="text-2xl font-semibold text-white">Curvas de Equity</h2>
        <div className="mt-2 text-lg text-slate-400">Escala logarítmica</div>
        <div className="mt-6 rounded-2xl border border-slate-800 bg-slate-950/40 p-8 text-slate-400">
          Sem dados válidos para desenhar o gráfico.
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-3xl border border-slate-800 bg-slate-950/60 p-6">
      <h2 className="text-2xl font-semibold text-white">Curvas de Equity</h2>
      <div className="mt-2 text-lg text-slate-400">Escala logarítmica</div>

      <div
        className="mt-6 w-full rounded-2xl border border-slate-800 bg-slate-950/40 p-4"
        style={{ height: 620, minHeight: 620 }}
      >
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 16, right: 20, left: 8, bottom: 16 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#3f3f46" />
            <XAxis dataKey="date" minTickGap={40} stroke="#a1a1aa" />
            <YAxis
              scale="log"
              domain={["dataMin", "dataMax"]}
              stroke="#a1a1aa"
              tickFormatter={(v) => fmtVal(v)}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "#18181b",
                border: "1px solid #3f3f46",
                borderRadius: 16,
                color: "#fff",
              }}
              formatter={(value: any, name: any) => [fmtVal(value), String(name)]}
            />
            <Legend />
            <Line type="monotone" dataKey="benchmark" name="Benchmark" dot={false} strokeWidth={2} stroke="#d4d4d4" />
            <Line type="monotone" dataKey="overlayed" name="Overlayed" dot={false} strokeWidth={2.5} stroke={DECIDE_DASHBOARD.flowTealChartStroke} />
            <Line type="monotone" dataKey="raw" name="Raw" dot={false} strokeWidth={2.5} stroke="#737373" />
            <Line type="monotone" dataKey="rawVolMatched" name="Raw Vol Matched" dot={false} strokeWidth={2.5} stroke="#a3a3a3" />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}