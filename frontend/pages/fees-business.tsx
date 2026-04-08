import React, { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/router";
import ThousandsNumberInput, { asThousandsNumberChange } from "../components/ThousandsNumberInput";
import { onThousandsFieldRowPointerDownCapture } from "../lib/thousandsFieldRowFocus";
import { DECIDE_APP_FONT_FAMILY } from "../lib/decideClientTheme";

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

function KPIBox({ title, value, embed }: { title: string; value: string; embed?: boolean }) {
  return (
    <div
      style={{
        background: embed ? "rgba(24,24,27,0.9)" : "#18181b",
        border: embed ? "1px solid rgba(63,63,70,0.75)" : "1px solid rgba(63,63,70,0.75)",
        borderRadius: 18,
        padding: 18,
      }}
    >
      <div style={{ color: "#a1a1aa", fontSize: 14, marginBottom: 10 }}>{title}</div>
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
  const router = useRouter();
  const embed = router.isReady && router.query.embed === "1";
  const panelBg = embed ? "rgba(24,24,27,0.92)" : "#18181b";
  const panelBorder = "1px solid rgba(63,63,70,0.75)";
  const inputBg = embed ? "#0a0a0a" : "#27272a";
  const plotBg = embed ? "#18181b" : "#18181b";
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

  if (!router.isReady) {
    return (
      <div
        style={{
          minHeight: "100vh",
          background: "#09090b",
          color: "#a1a1aa",
          padding: 20,
          fontFamily: DECIDE_APP_FONT_FAMILY,
          fontSize: 13,
        }}
      >
        A carregar…
      </div>
    );
  }

  return (
    <div
      style={{
        minHeight: embed ? "min(100vh, 2400px)" : "100vh",
        background: embed ? "#09090b" : "#000",
        color: "#fff",
        padding: embed ? 16 : 32,
        fontFamily: DECIDE_APP_FONT_FAMILY,
      }}
    >
      {embed ? (
        <div style={{ color: "#d4d4d4", fontSize: 13, fontWeight: 800, marginBottom: 12 }}>
          Fiscalidade e economics (referência)
        </div>
      ) : (
        <div style={{ display: "flex", justifyContent: "space-between", gap: 20, marginBottom: 24 }}>
          <div>
            <div style={{ fontSize: 40, fontWeight: 800 }}>DECIDE — Fees Business</div>
            <div style={{ color: "#a1a1aa", fontSize: 18 }}>
              Página separada do core. Economics do produto com Segmento A e Segmento B.
            </div>
          </div>
          <div style={{ display: "flex", gap: 12 }}>
            <a href="http://localhost:5000/" style={{ color: "#d4d4d4", fontSize: 16 }}>
              Dashboard
            </a>
            <a href="/fees-client" style={{ color: "#d4d4d4", fontSize: 16 }}>
              Fees Client
            </a>
          </div>
        </div>
      )}

      <div
        onPointerDownCapture={onThousandsFieldRowPointerDownCapture}
        style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginBottom: 24 }}
      >
        <div style={{ background: panelBg, border: panelBorder, borderRadius: 18, padding: 18 }}>
          <div style={{ color: "#a1a1aa", marginBottom: 8 }}>Clientes Segmento A</div>
          <ThousandsNumberInput
            min={0}
            maxDecimals={0}
            value={clientsA}
            onChange={asThousandsNumberChange(setClientsA)}
            style={{ width: "100%", padding: 12, borderRadius: 12, border: panelBorder, background: inputBg, color: "#fff" }}
          />
        </div>

        <div style={{ background: panelBg, border: panelBorder, borderRadius: 18, padding: 18 }}>
          <div style={{ color: "#a1a1aa", marginBottom: 8 }}>AUM médio Segmento A (€)</div>
          <ThousandsNumberInput
            min={0}
            maxDecimals={0}
            value={avgAumA}
            onChange={asThousandsNumberChange(setAvgAumA)}
            style={{ width: "100%", padding: 12, borderRadius: 12, border: panelBorder, background: inputBg, color: "#fff" }}
          />
        </div>

        <div style={{ background: panelBg, border: panelBorder, borderRadius: 18, padding: 18 }}>
          <div style={{ color: "#a1a1aa", marginBottom: 8 }}>AUM Segmento B (€)</div>
          <ThousandsNumberInput
            min={0}
            maxDecimals={0}
            value={aumB}
            onChange={asThousandsNumberChange(setAumB)}
            style={{ width: "100%", padding: 12, borderRadius: 12, border: panelBorder, background: inputBg, color: "#fff" }}
          />
        </div>

        <div style={{ background: panelBg, border: panelBorder, borderRadius: 18, padding: 18 }}>
          <div style={{ color: "#a1a1aa", marginBottom: 8 }}>Outperformance média anual (%)</div>
          <ThousandsNumberInput
            maxDecimals={1}
            value={avgOutperformance}
            onChange={asThousandsNumberChange(setAvgOutperformance)}
            style={{ width: "100%", padding: 12, borderRadius: 12, border: panelBorder, background: inputBg, color: "#fff" }}
          />
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 16, marginBottom: 24 }}>
        <KPIBox embed={embed} title="AUM Segmento A" value={formatEuro(data.segmentAAum, 0)} />
        <KPIBox embed={embed} title="Receita Segmento A" value={formatEuro(data.segmentAMgmt, 0)} />
        <KPIBox embed={embed} title="Mgmt fee Segmento B" value={formatEuro(data.segmentBMgmt, 0)} />
        <KPIBox embed={embed} title="Perf fee Segmento B" value={formatEuro(data.perfFeeB, 0)} />
        <KPIBox embed={embed} title="Receita total" value={formatEuro(data.total, 0)} />
      </div>

      <div
        style={{
          background: panelBg,
          border: panelBorder,
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
            paper_bgcolor: plotBg,
            plot_bgcolor: plotBg,
            font: { color: "#dbeafe" },
            margin: { l: 70, r: 20, t: 20, b: 70 },
            xaxis: { title: "AUM Segmento B (M€)", gridcolor: "#3f3f46" },
            yaxis: { title: "Receita anual (€)", gridcolor: "#3f3f46" },
            legend: { orientation: "h", x: 0.5, xanchor: "center", y: -0.18 },
          }}
          config={{ responsive: true, displaylogo: false }}
          style={{ width: "100%" }}
        />
      </div>

      <div
        style={{
          background: panelBg,
          border: panelBorder,
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
            borderBottom: panelBorder,
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

        <div style={{ color: "#a1a1aa", marginTop: 16, fontSize: 14 }}>
          Segmento A: 20€/mês por cliente. Segmento B: 0,6% management fee + 15% da outperformance anual.
        </div>
        <div style={{ color: "#a1a1aa", marginTop: 6, fontSize: 14 }}>
          Esta página é apenas de economics e não altera o core do modelo.
        </div>
      </div>
    </div>
  );
}