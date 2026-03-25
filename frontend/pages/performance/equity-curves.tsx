import dynamic from "next/dynamic";
import Head from "next/head";
import { useEffect, useMemo, useState } from "react";

const Plot = dynamic(() => import("react-plotly.js"), { ssr: false });

type Dataset = "live" | "backtest15y";
type Period = "1Y" | "3Y" | "5Y" | "10Y" | "15Y" | "MAX";

type KpiBlock = {
  total_return_pct: number | null;
  annualized_return_pct: number | null;
  volatility_pct: number | null;
  max_drawdown_pct: number | null;
  sharpe: number | null;
};

type ApiRow = {
  date: string;
  benchmark: number | null;
  equity_model?: number | null;
  raw?: number | null;
  overlayed?: number | null;
};

type SeriesMeta = {
  raw_available: boolean;
  overlayed_available: boolean;
  equity_available: boolean;
  overlayed_equals_equity: boolean;
  raw_equals_overlayed: boolean;
  raw_equals_equity: boolean;
  recommended_model_key: "equity_model" | "overlayed";
  notes: string[];
};

type ApiResponse = {
  dataset?: Dataset | string;
  source_file?: string;
  period?: Period | string;
  points?: number;
  start_date?: string | null;
  end_date?: string | null;
  years_covered?: number | null;
  series?: ApiRow[];
  series_meta?: SeriesMeta;
  kpis?: {
    benchmark?: KpiBlock;
    equity_model?: KpiBlock;
    raw?: KpiBlock | null;
    overlayed?: KpiBlock | null;
  };
};

const PERIODS: Period[] = ["1Y", "3Y", "5Y", "10Y", "15Y", "MAX"];
const BACKEND_BASE = "http://127.0.0.1:8011";

const EMPTY_KPI_BLOCK: KpiBlock = {
  total_return_pct: null,
  annualized_return_pct: null,
  volatility_pct: null,
  max_drawdown_pct: null,
  sharpe: null,
};

function fmtPct(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return `${value.toFixed(2)}%`;
}

function fmtNum(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return value.toFixed(2);
}

function KpiCard({ title, block }: { title: string; block: KpiBlock }) {
  return (
    <div
      style={{
        background: "#111827",
        border: "1px solid #1f2937",
        borderRadius: 12,
        padding: 16,
      }}
    >
      <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 12 }}>{title}</div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <div>
          <div style={{ color: "#9ca3af", fontSize: 12 }}>Retorno Total</div>
          <div style={{ fontSize: 18, fontWeight: 600 }}>{fmtPct(block.total_return_pct)}</div>
        </div>

        <div>
          <div style={{ color: "#9ca3af", fontSize: 12 }}>Retorno Anualizado</div>
          <div style={{ fontSize: 18, fontWeight: 600 }}>{fmtPct(block.annualized_return_pct)}</div>
        </div>

        <div>
          <div style={{ color: "#9ca3af", fontSize: 12 }}>Volatilidade</div>
          <div style={{ fontSize: 18, fontWeight: 600 }}>{fmtPct(block.volatility_pct)}</div>
        </div>

        <div>
          <div style={{ color: "#9ca3af", fontSize: 12 }}>Max Drawdown</div>
          <div style={{ fontSize: 18, fontWeight: 600 }}>{fmtPct(block.max_drawdown_pct)}</div>
        </div>

        <div style={{ gridColumn: "1 / -1" }}>
          <div style={{ color: "#9ca3af", fontSize: 12 }}>Sharpe</div>
          <div style={{ fontSize: 18, fontWeight: 600 }}>{fmtNum(block.sharpe)}</div>
        </div>
      </div>
    </div>
  );
}

export default function EquityCurvesPage() {
  const [dataset, setDataset] = useState<Dataset>("backtest15y");
  const [period, setPeriod] = useState<Period>("15Y");
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  useEffect(() => {
    const controller = new AbortController();

    async function load() {
      try {
        setLoading(true);
        setError("");

        const url =
          `${BACKEND_BASE}/api/performance/equity-curves-v2` +
          `?dataset=${encodeURIComponent(dataset)}` +
          `&period=${encodeURIComponent(period)}`;

        const res = await fetch(url, {
          method: "GET",
          signal: controller.signal,
          headers: {
            Accept: "application/json",
          },
        });

        const text = await res.text();

        if (!res.ok) {
          throw new Error(text || `HTTP ${res.status}`);
        }

        const json: ApiResponse = JSON.parse(text);
        setData(json);
      } catch (err: any) {
        if (err?.name === "AbortError") return;
        setError(err?.message || "Erro a carregar equity curves.");
        setData(null);
      } finally {
        setLoading(false);
      }
    }

    load();
    return () => controller.abort();
  }, [dataset, period]);

  const plotData = useMemo(() => {
    const series = data?.series ?? [];
    const meta = data?.series_meta;

    if (series.length === 0) return [];

    const x = series.map((r) => r.date);
    const traces: any[] = [];

    traces.push({
      x,
      y: series.map((r) => r.benchmark),
      type: "scatter",
      mode: "lines",
      name: "Benchmark",
      connectgaps: false,
      line: { width: 2 },
    });

    if (dataset === "backtest15y") {
      if (meta?.raw_available) {
        traces.push({
          x,
          y: series.map((r) => r.raw ?? null),
          type: "scatter",
          mode: "lines",
          name: "Modelo Raw",
          connectgaps: false,
          line: { width: 2 },
        });
      }

      if (meta?.overlayed_available) {
        traces.push({
          x,
          y: series.map((r) => r.overlayed ?? null),
          type: "scatter",
          mode: "lines",
          name: "Modelo Overlayed",
          connectgaps: false,
          line: { width: 3 },
        });
      } else {
        traces.push({
          x,
          y: series.map((r) => r.equity_model ?? null),
          type: "scatter",
          mode: "lines",
          name: "Modelo",
          connectgaps: false,
          line: { width: 3 },
        });
      }
    } else {
      const modelKey = meta?.recommended_model_key ?? "equity_model";
      traces.push({
        x,
        y: series.map((r) => (modelKey === "overlayed" ? r.overlayed ?? null : r.equity_model ?? null)),
        type: "scatter",
        mode: "lines",
        name: "Modelo",
        connectgaps: false,
        line: { width: 3 },
      });
    }

    return traces;
  }, [data, dataset]);

  const benchmarkKpis = data?.kpis?.benchmark ?? EMPTY_KPI_BLOCK;
  const modelKpis =
    (dataset === "backtest15y"
      ? data?.kpis?.overlayed ?? data?.kpis?.equity_model
      : data?.series_meta?.recommended_model_key === "overlayed"
        ? data?.kpis?.overlayed
        : data?.kpis?.equity_model) ?? EMPTY_KPI_BLOCK;

  const rawKpis = data?.kpis?.raw ?? EMPTY_KPI_BLOCK;

  const yearsCovered = data?.years_covered ?? null;
  const realStart = data?.start_date ?? "—";
  const realEnd = data?.end_date ?? "—";

  const allowedPeriods = useMemo(() => {
    const yrs = yearsCovered ?? 0;
    return {
      "1Y": yrs >= 1,
      "3Y": yrs >= 3,
      "5Y": yrs >= 5,
      "10Y": yrs >= 10,
      "15Y": yrs >= 14.5,
      "MAX": true,
    } as Record<Period, boolean>;
  }, [yearsCovered]);

  return (
    <>
      <Head>
        <title>DECIDE | Equity Curves</title>
      </Head>

      <div
        style={{
          minHeight: "100vh",
          background: "#030712",
          color: "#f9fafb",
          padding: "24px",
        }}
      >
        <div style={{ maxWidth: 1600, margin: "0 auto" }}>
          <div style={{ marginBottom: 20 }}>
            <h1 style={{ margin: 0, fontSize: 28, fontWeight: 800 }}>Performance</h1>
            <div style={{ color: "#9ca3af", marginTop: 8 }}>
              {dataset === "backtest15y" ? "Backtest 15Y" : "Live Track"}
            </div>
            <div style={{ color: "#94a3b8", marginTop: 8 }}>
              Intervalo real: {realStart} → {realEnd} {yearsCovered !== null ? `(${yearsCovered} anos)` : ""}
            </div>
          </div>

          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 10,
              marginBottom: 16,
            }}
          >
            <button
              onClick={() => {
                setDataset("backtest15y");
                setPeriod("15Y");
              }}
              style={{
                padding: "10px 14px",
                borderRadius: 10,
                border: dataset === "backtest15y" ? "1px solid #60a5fa" : "1px solid #374151",
                background: dataset === "backtest15y" ? "#1d4ed8" : "#111827",
                color: "#f9fafb",
                cursor: "pointer",
                fontWeight: 600,
              }}
            >
              BACKTEST 15Y
            </button>

            <button
              onClick={() => {
                setDataset("live");
                setPeriod("MAX");
              }}
              style={{
                padding: "10px 14px",
                borderRadius: 10,
                border: dataset === "live" ? "1px solid #60a5fa" : "1px solid #374151",
                background: dataset === "live" ? "#1d4ed8" : "#111827",
                color: "#f9fafb",
                cursor: "pointer",
                fontWeight: 600,
              }}
            >
              LIVE TRACK
            </button>
          </div>

          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 10,
              marginBottom: 20,
            }}
          >
            {PERIODS.map((p) => {
              const active = p === period;
              const enabled = allowedPeriods[p];

              return (
                <button
                  key={p}
                  disabled={!enabled}
                  onClick={() => enabled && setPeriod(p)}
                  style={{
                    padding: "10px 14px",
                    borderRadius: 10,
                    border: active ? "1px solid #60a5fa" : "1px solid #374151",
                    background: active ? "#1d4ed8" : "#111827",
                    color: enabled ? "#f9fafb" : "#6b7280",
                    cursor: enabled ? "pointer" : "not-allowed",
                    fontWeight: 600,
                    opacity: enabled ? 1 : 0.5,
                  }}
                  title={enabled ? p : `Indisponível: ficheiro só cobre ${yearsCovered ?? 0} anos`}
                >
                  {p}
                </button>
              );
            })}
          </div>

          <div
            style={{
              background: "#111827",
              border: "1px solid #1f2937",
              borderRadius: 12,
              padding: 16,
              marginBottom: 20,
            }}
          >
            {loading && <div>A carregar gráfico...</div>}

            {!loading && error && (
              <div style={{ color: "#fca5a5", whiteSpace: "pre-wrap" }}>
                {error}
              </div>
            )}

            {!loading && !error && plotData.length > 0 && (
              <Plot
                data={plotData as any}
                layout={{
                  autosize: true,
                  height: 620,
                  paper_bgcolor: "#111827",
                  plot_bgcolor: "#111827",
                  font: { color: "#f9fafb" },
                  legend: { orientation: "h" },
                  margin: { l: 60, r: 20, t: 20, b: 60 },
                  xaxis: {
                    title: "Data",
                    type: "date",
                    gridcolor: "#1f2937",
                    zerolinecolor: "#1f2937",
                  },
                  yaxis: {
                    title: "Equity Curve",
                    gridcolor: "#1f2937",
                    zerolinecolor: "#1f2937",
                  },
                  hovermode: "x unified",
                }}
                style={{ width: "100%" }}
                useResizeHandler
                config={{ responsive: true, displayModeBar: false }}
              />
            )}

            {!loading && !error && plotData.length === 0 && (
              <div style={{ color: "#9ca3af" }}>Sem dados para desenhar o gráfico.</div>
            )}
          </div>

          {!loading && !error && data && (
            <>
              <div
                style={{
                  color: "#9ca3af",
                  marginBottom: 10,
                  fontSize: 13,
                  wordBreak: "break-all",
                }}
              >
                Dataset: {data.dataset ?? dataset} | Período: {data.period ?? period} | Pontos: {data.points ?? 0} | Fonte: {data.source_file ?? "—"}
              </div>

              <div
                style={{
                  color: "#94a3b8",
                  marginBottom: 16,
                  fontSize: 13,
                }}
              >
                {data.series_meta?.notes?.join(" | ") ?? ""}
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
                  gap: 16,
                }}
              >
                <KpiCard title="Benchmark" block={benchmarkKpis} />
                {dataset === "backtest15y" && data.series_meta?.raw_available && (
                  <KpiCard title="Modelo Raw" block={rawKpis} />
                )}
                <KpiCard title={dataset === "backtest15y" ? "Modelo Overlayed" : "Modelo"} block={modelKpis} />
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}