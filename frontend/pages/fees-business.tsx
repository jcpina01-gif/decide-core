import React, { useMemo, useState } from "react";
import dynamic from "next/dynamic";

const Plot = dynamic(() => import("react-plotly.js"), { ssr: false });

function safeNumber(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function formatEuro(value: unknown, decimals = 0): string {
  const n = safeNumber(value, NaN);
  if (!Number.isFinite(n)) return "—";
  return `${n.toLocaleString("pt-PT", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}€`;
}

function formatPct(value: unknown, decimals = 2): string {
  const n = safeNumber(value, NaN);
  if (!Number.isFinite(n)) return "—";
  return `${n.toFixed(decimals)}%`;
}

function KPIBox({ title, value }: { title: string; value: string }) {
  return (
    <div
      style={{
        background: "#020b24",
        border: "1px solid #15305b",
        borderRadius: 18,
        padding: 18,
      }}
    >
      <div style={{ color: "#9fb3d1", fontSize: 14, marginBottom: 10 }}>{title}</div>
      <div style={{ color: "#fff", fontSize: 28, fontWeight: 700 }}>{value}</div>
    </div>
  );
}

type RevenueRow = {
  aum: number;
  mgmtA: number;
  mgmtB: number;
  perfB: number;
  total: number;
};

export default function FeesBusinessPage() {
  const [clientsA, setClientsA] = useState(150);
  const [avgAumA, setAvgAumA] = useState(20000);
  const [aumB, setAumB] = useState(10000000);
  const [avgOutperformance, setAvgOutperformance] = useState(8);

  const data = useMemo(() => {
    const segmentAAum = clientsA * avgAumA;
    const segmentAMgmt = clientsA * 240;
    const segmentBMgmt = aumB * 0.006;
    const perfFeeB = aumB * (Math.max(avgOutperformance, 0) / 100) * 0.15;
    const total = segmentAMgmt + segmentBMgmt + perfFeeB;

    return {
      segmentAAum,
      segmentAMgmt,
      segmentBMgmt,
      perfFeeB,
      total,
    };
  }, [clientsA, avgAumA, aumB, avgOutperformance]);

  const scenarios: RevenueRow[] = useMemo(() => {
    const aums = [1000000, 5000000, 10000000, 25000000, 50000000, 100000000];
    return aums.map((aum) => {
      const mgmtA = clientsA * 240;
      const mgmtB = aum * 0.006;
      const perfB = aum * (Math.max(avgOutperformance, 0) / 100) * 0.15;
      return {
        aum,
        mgmtA,
        mgmtB,
        perfB,
        total: mgmtA + mgmtB + perfB,
      };
    });
  }, [clientsA, avgOutperformance]);

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#000",
        color: "#fff",
        padding: 32,
        fontFamily: "Inter, Arial, sans-serif",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 20, marginBottom: 24 }}>
        <div>
          <div style={{ fontSize: 40, fontWeight: 800 }}>DECIDE — Fees Business</div>
          <div style={{ color: "#9fb3d1", fontSize: 18 }}>
            Página separada do core. Economics do produto com Segmento A e Segmento B.
          </div>
        </div>
        <div style={{ display: "flex", gap: 12 }}>
          <a href="http://localhost:5000/" style={{ color: "#93c5fd", fontSize: 16 }}>Dashboard</a>
          <a href="/fees-client" style={{ color: "#93c5fd", fontSize: 16 }}>Fees Client</a>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginBottom: 24 }}>
        <div style={{ background: "#020b24", border: "1px solid #15305b", borderRadius: 18, padding: 18 }}>
          <div style={{ color: "#9fb3d1", marginBottom: 8 }}>Clientes Segmento A</div>
          <input
            type="number"
            value={clientsA}
            onChange={(e) => setClientsA(safeNumber(e.target.value, 0))}
            style={{ width: "100%", padding: 12, borderRadius: 12, border: "1px solid #15305b", background: "#020816", color: "#fff" }}
          />
        </div>

        <div style={{ background: "#020b24", border: "1px solid #15305b", borderRadius: 18, padding: 18 }}>
          <div style={{ color: "#9fb3d1", marginBottom: 8 }}>AUM médio Segmento A (€)</div>
          <input
            type="number"
            value={avgAumA}
            onChange={(e) => setAvgAumA(safeNumber(e.target.value, 0))}
            style={{ width: "100%", padding: 12, borderRadius: 12, border: "1px solid #15305b", background: "#020816", color: "#fff" }}
          />
        </div>

        <div style={{ background: "#020b24", border: "1px solid #15305b", borderRadius: 18, padding: 18 }}>
          <div style={{ color: "#9fb3d1", marginBottom: 8 }}>AUM Segmento B (€)</div>
          <input
            type="number"
            value={aumB}
            onChange={(e) => setAumB(safeNumber(e.target.value, 0))}
            style={{ width: "100%", padding: 12, borderRadius: 12, border: "1px solid #15305b", background: "#020816", color: "#fff" }}
          />
        </div>

        <div style={{ background: "#020b24", border: "1px solid #15305b", borderRadius: 18, padding: 18 }}>
          <div style={{ color: "#9fb3d1", marginBottom: 8 }}>Outperformance média anual (%)</div>
          <input
            type="number"
            step="0.1"
            value={avgOutperformance}
            onChange={(e) => setAvgOutperformance(safeNumber(e.target.value, 0))}
            style={{ width: "100%", padding: 12, borderRadius: 12, border: "1px solid #15305b", background: "#020816", color: "#fff" }}
          />
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 16, marginBottom: 24 }}>
        <KPIBox title="AUM Segmento A" value={formatEuro(data.segmentAAum, 0)} />
        <KPIBox title="Receita Segmento A" value={formatEuro(data.segmentAMgmt, 0)} />
        <KPIBox title="Mgmt fee Segmento B" value={formatEuro(data.segmentBMgmt, 0)} />
        <KPIBox title="Perf fee Segmento B" value={formatEuro(data.perfFeeB, 0)} />
        <KPIBox title="Receita total" value={formatEuro(data.total, 0)} />
      </div>

      <div
        style={{
          background: "#020b24",
          border: "1px solid #15305b",
          borderRadius: 22,
          padding: 20,
          marginBottom: 24,
        }}
      >
        <div style={{ fontSize: 24, fontWeight: 800, marginBottom: 8 }}>Receita por cenário de AUM Segmento B</div>
        <Plot
          data={[
            {
              x: scenarios.map((x) => x.aum / 1000000),
              y: scenarios.map((x) => x.mgmtB),
              type: "bar",
              name: "Management fee B",
            },
            {
              x: scenarios.map((x) => x.aum / 1000000),
              y: scenarios.map((x) => x.perfB),
              type: "bar",
              name: "Performance fee B",
            },
            {
              x: scenarios.map((x) => x.aum / 1000000),
              y: scenarios.map((x) => x.mgmtA),
              type: "bar",
              name: "Segmento A",
            },
          ]}
          layout={{
            barmode: "stack",
            autosize: true,
            height: 480,
            paper_bgcolor: "#020b24",
            plot_bgcolor: "#020b24",
            font: { color: "#dbeafe" },
            margin: { l: 70, r: 20, t: 20, b: 70 },
            xaxis: { title: "AUM Segmento B (M€)", gridcolor: "#16315d" },
            yaxis: { title: "Receita anual (€)", gridcolor: "#16315d" },
            legend: { orientation: "h", x: 0.5, xanchor: "center", y: -0.18 },
          }}
          config={{ responsive: true, displaylogo: false }}
          style={{ width: "100%" }}
        />
      </div>

      <div
        style={{
          background: "#020b24",
          border: "1px solid #15305b",
          borderRadius: 22,
          padding: 20,
        }}
      >
        <div style={{ fontSize: 24, fontWeight: 800, marginBottom: 12 }}>Tabela de cenários</div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr 1fr 1fr 1fr",
            gap: 12,
            padding: "12px 0",
            fontWeight: 700,
            borderBottom: "1px solid #15305b",
            marginBottom: 8,
          }}
        >
          <div>AUM B</div>
          <div>Mgmt A</div>
          <div>Mgmt B</div>
          <div>Perf B</div>
          <div>Total</div>
        </div>

        {scenarios.map((row) => (
          <div
            key={row.aum}
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr 1fr 1fr 1fr",
              gap: 12,
              padding: "12px 0",
              borderBottom: "1px solid #10284f",
            }}
          >
            <div>{formatEuro(row.aum, 0)}</div>
            <div>{formatEuro(row.mgmtA, 0)}</div>
            <div>{formatEuro(row.mgmtB, 0)}</div>
            <div>{formatEuro(row.perfB, 0)}</div>
            <div>{formatEuro(row.total, 0)}</div>
          </div>
        ))}

        <div style={{ color: "#9fb3d1", marginTop: 16, fontSize: 14 }}>
          Segmento A: 20€/mês por cliente. Segmento B: 0,6% management fee + 15% da outperformance anual.
        </div>
        <div style={{ color: "#9fb3d1", marginTop: 6, fontSize: 14 }}>
          Esta página é apenas de economics e não altera o core do modelo.
        </div>
      </div>
    </div>
  );
}