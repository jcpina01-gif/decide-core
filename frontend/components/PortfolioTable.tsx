import React from "react";
import { CurrentPortfolio } from "../services/api";

export default function PortfolioTable({ portfolio }: { portfolio: CurrentPortfolio | null }) {
  const p = portfolio ?? {
    as_of: null,
    n_positions: 0,
    max_weight_pct: 0,
    top5_weight_pct: 0,
    hhi: 0,
    gross_exposure_pct: 0,
    turnover_pct: 0,
    positions: [],
  };

  return (
    <div className="rounded-3xl border border-slate-800 bg-slate-950/60 p-6">
      <h2 className="text-3xl font-semibold text-white">Carteira Atual</h2>

      <div className="mt-6 grid gap-4 md:grid-cols-3 xl:grid-cols-7">
        <Card label="Data" value={p.as_of || "—"} />
        <Card label="Nº posições" value={String(p.n_positions ?? 0)} />
        <Card label="Peso máximo" value={fmtPct(p.max_weight_pct, true)} />
        <Card label="Top 5 peso" value={fmtPct(p.top5_weight_pct, true)} />
        <Card label="Concentração HHI" value={fmtNum(p.hhi, 4)} />
        <Card label="Exposição bruta" value={fmtPct(p.gross_exposure_pct, true)} />
        <Card label="Turnover" value={fmtPct(p.turnover_pct, true)} />
      </div>

      <div className="mt-8 overflow-x-auto rounded-3xl border border-slate-800">
        <table className="min-w-full">
          <thead className="bg-slate-950/50">
            <tr className="border-b border-slate-800">
              <Th>Ticker</Th>
              <Th>Nome curto</Th>
              <Th>Nome</Th>
              <Th>Peso</Th>
              <Th>Score</Th>
              <Th>Rank Momentum</Th>
              <Th>Região</Th>
              <Th>Sector</Th>
            </tr>
          </thead>

          <tbody>
            {(p.positions ?? []).length === 0 ? (
              <tr>
                <td colSpan={8} className="px-6 py-8 text-left text-xl text-slate-400">
                  Sem posições disponíveis no snapshot atual do motor.
                </td>
              </tr>
            ) : (
              p.positions.map((row, idx) => (
                <tr key={`${row.ticker}-${idx}`} className="border-b border-slate-900/60">
                  <Td strong>{row.ticker}</Td>
                  <Td>{row.short_name || row.name_short || row.ticker}</Td>
                  <Td>{row.name || row.short_name || row.ticker}</Td>
                  <Td>{fmtPct(row.weight_pct, true)}</Td>
                  <Td>{row.score === null ? "—" : fmtNum(row.score, 4)}</Td>
                  <Td>{row.rank_momentum === null ? "—" : String(row.rank_momentum)}</Td>
                  <Td>{row.region || "—"}</Td>
                  <Td>{row.sector || "—"}</Td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Card({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
      <div className="mb-2 text-sm text-slate-400">{label}</div>
      <div className="text-2xl font-semibold text-white">{value}</div>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="px-4 py-4 text-left text-xl font-semibold text-slate-300">{children}</th>;
}

function Td({ children, strong = false }: { children: React.ReactNode; strong?: boolean }) {
  return <td className={`px-4 py-4 text-xl ${strong ? "font-semibold text-white" : "text-white"}`}>{children}</td>;
}

function fmtPct(x: any, alreadyPercent = false) {
  const n = Number(x);
  if (!Number.isFinite(n)) return "—";
  return alreadyPercent ? `${n.toFixed(2)}%` : `${(n * 100).toFixed(2)}%`;
}

function fmtNum(x: any, digits = 2) {
  const n = Number(x);
  if (!Number.isFinite(n)) return "—";
  return n.toFixed(digits);
}