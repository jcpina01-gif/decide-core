import React from "react";
import { formatNum, formatPct, KpiBlock as KpiBlockType } from "../services/api";

type Props = {
  title: string;
  subtitle?: string;
  block?: KpiBlockType | null;
};

export default function KPIBlock({ title, subtitle, block }: Props) {
  const volValue = block?.volatility ?? block?.vol ?? null;

  const rows = [
    { label: "CAGR", value: formatPct(block?.cagr ?? null) },
    { label: "Volatilidade", value: formatPct(volValue) },
    { label: "Sharpe", value: formatNum(block?.sharpe ?? null) },
    { label: "Max Drawdown", value: formatPct(block?.max_drawdown ?? null) },
    { label: "Total Return", value: formatPct(block?.total_return ?? null) },
  ];

  return (
    <div className="rounded-3xl border border-slate-800 bg-slate-950/60 p-6">
      <h2 className="text-2xl font-semibold text-white">{title}</h2>
      {subtitle ? <div className="mt-2 text-lg text-slate-400">{subtitle}</div> : null}

      <div className="mt-6 overflow-hidden rounded-2xl border border-slate-900">
        {rows.map((row) => (
          <div
            key={row.label}
            className="flex items-center justify-between border-b border-slate-900 px-5 py-5 last:border-b-0"
          >
            <div className="text-xl text-slate-200">{row.label}</div>
            <div className="text-xl font-semibold text-white">{row.value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}