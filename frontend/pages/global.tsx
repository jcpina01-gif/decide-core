import { useMemo } from "react";
import Head from "next/head";
import EquityChart from "../components/EquityChart";

type KpiBlock = {
  ret_annual: number | null;
  vol: number | null;
  sharpe: number | null;
  max_dd: number | null;
};

type PageProps = {
  dates: string[];
  benchmark: number[];
  raw: number[];
  rawVolMatched: number[];
  overlayed: number[];
  kpis: {
    benchmark: KpiBlock;
    raw: KpiBlock;
    overlayed: KpiBlock;
  };
};

// Placeholder estático para desbloquear o build;
// pode ser ligado depois aos dados globais reais.
const demoData: PageProps = {
  dates: [],
  benchmark: [],
  raw: [],
  rawVolMatched: [],
  overlayed: [],
  kpis: {
    benchmark: { ret_annual: null, vol: null, sharpe: null, max_dd: null },
    raw: { ret_annual: null, vol: null, sharpe: null, max_dd: null },
    overlayed: { ret_annual: null, vol: null, sharpe: null, max_dd: null },
  },
};

export default function GlobalPage() {
  const data = useMemo(() => demoData, []);

  return (
    <>
      <Head>
        <title>DECIDE – Global</title>
      </Head>
      <main className="min-h-screen bg-slate-950 text-slate-50">
        <div className="mx-auto max-w-5xl px-6 py-10">
          <header className="mb-8 border-b border-slate-800 pb-4">
            <h1 className="text-xl font-semibold tracking-tight">
              Vista global (placeholder)
            </h1>
            <p className="mt-1 text-sm text-slate-400">
              Esta página está criada apenas para desbloquear o build. Podemos
              ligá-la aos dados globais reais numa próxima iteração.
            </p>
          </header>

          <EquityChart
            dates={data.dates}
            benchmark={data.benchmark}
            raw={data.raw}
            rawVolMatched={data.rawVolMatched}
            overlayed={data.overlayed}
          />
        </div>
      </main>
    </>
  );
}

