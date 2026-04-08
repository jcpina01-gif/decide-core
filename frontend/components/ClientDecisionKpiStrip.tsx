import React, { useCallback, useEffect, useState } from "react";
import { ONBOARDING_MONTANTE_KEY } from "./OnboardingFlowBar";
import { changeBandLabelPt, type ChangeBand } from "../lib/planDecisionKpiMath";
import { readFxHedgePrefs } from "../lib/fxHedgePrefs";

type ApiOk = {
  ok: true;
  navEur: number;
  assetCount: number;
  activityPct: number;
  changeBand: ChangeBand;
  grossBuyOrderVolumeEur: number;
  equityBuyVolumeEur: number;
  orderLegCount: number;
  totalAbsFlowEur: number;
};

type Props = {
  /** Quando o calendário já tem constituição — texto «rebalance» vs «constituição». */
  hasPortfolioOnboarding: boolean;
  /** Bump para voltar a pedir dados (ex.: iframe KPI atualizado). */
  refreshToken: number;
};

function formatEur(n: number): string {
  return new Intl.NumberFormat("pt-PT", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(n);
}

export default function ClientDecisionKpiStrip({ hasPortfolioOnboarding, refreshToken }: Props) {
  const [data, setData] = useState<ApiOk | null>(null);
  const [investEur, setInvestEur] = useState<number | null>(null);
  const [hedgeLine, setHedgeLine] = useState<string>("—");

  const load = useCallback(async () => {
    try {
      const raw = window.localStorage.getItem(ONBOARDING_MONTANTE_KEY);
      const n = raw != null ? Math.round(Number(String(raw).replace(/\s/g, ""))) : NaN;
      if (Number.isFinite(n) && n >= 5000) setInvestEur(n);
      else setInvestEur(null);
    } catch {
      setInvestEur(null);
    }
    try {
      const p = readFxHedgePrefs();
      if (!p) setHedgeLine("—");
      else {
        const pct = Math.round(p.pct);
        if (pct <= 0) setHedgeLine("Inactivo");
        else setHedgeLine(`Ativo (${pct}%)`);
      }
    } catch {
      setHedgeLine("—");
    }
    try {
      const r = await fetch("/api/client/plan-decision-kpis", { method: "GET" });
      const j = (await r.json()) as ApiOk | { ok: false };
      if (j && "ok" in j && j.ok) setData(j);
      else setData(null);
    } catch {
      setData(null);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshToken]);

  const opLabel = hasPortfolioOnboarding ? "Rebalanceamento mensal" : "Constituição de carteira";

  const cellStyle: React.CSSProperties = {
    padding: "10px 12px",
    borderRadius: 12,
    background: "rgba(24, 24, 27, 0.75)",
    border: "1px solid rgba(45, 212, 191, 0.2)",
    minWidth: 0,
  };

  const labelStyle: React.CSSProperties = {
    fontSize: 10,
    fontWeight: 800,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    color: "#d4d4d4",
    marginBottom: 6,
  };

  const valueStyle: React.CSSProperties = {
    fontSize: 16,
    fontWeight: 800,
    color: "#f8fafc",
    lineHeight: 1.25,
  };

  return (
    <div
      style={{
        marginBottom: 10,
        padding: "12px 12px 10px",
        borderRadius: 14,
        background: "linear-gradient(135deg, rgba(13,148,136,0.12) 0%, rgba(24,24,27,0.92) 100%)",
        border: "1px solid rgba(45, 212, 191, 0.28)",
        boxShadow: "0 4px 22px rgba(0,0,0,0.25)",
      }}
    >
      <div
        style={{
          fontSize: 11,
          fontWeight: 900,
          letterSpacing: "0.06em",
          color: "#a1a1aa",
          marginBottom: 10,
          textAlign: "center",
        }}
      >
        A sua decisão (resumo)
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
          gap: 10,
        }}
      >
        <div style={cellStyle}>
          <div style={labelStyle}>O seu investimento</div>
          <div style={valueStyle}>{investEur != null ? formatEur(investEur) : "—"}</div>
          <div style={{ marginTop: 6, fontSize: 10, color: "#71717a", lineHeight: 1.35 }}>
            Valor indicado no passo «Valor a investir».
          </div>
        </div>
        <div style={cellStyle}>
          <div style={labelStyle}>Número de ativos</div>
          <div style={valueStyle}>{data && data.assetCount > 0 ? data.assetCount : "—"}</div>
          <div style={{ marginTop: 6, fontSize: 10, color: "#71717a", lineHeight: 1.35 }}>
            Linhas no plano ilustrativo (tmp_diag).
          </div>
        </div>
        <div style={cellStyle}>
          <div style={labelStyle}>Tipo de operação</div>
          <div style={{ ...valueStyle, fontSize: 14 }}>{opLabel}</div>
        </div>
        <div style={cellStyle}>
          <div style={labelStyle}>Hedge cambial</div>
          <div style={{ ...valueStyle, fontSize: 14 }}>{hedgeLine}</div>
        </div>
        <div style={{ ...cellStyle, gridColumn: "1 / -1" }}>
          <div style={labelStyle}>Alterações na carteira</div>
          <div style={valueStyle}>
            {data ? (
              <>
                {changeBandLabelPt(data.changeBand)}
                <span style={{ fontWeight: 600, color: "#a1a1aa", fontSize: 14 }}>
                  {" "}
                  (~{data.activityPct}% do plano movimentado)
                </span>
              </>
            ) : (
              "—"
            )}
          </div>
          <div style={{ marginTop: 6, fontSize: 10, color: "#71717a", lineHeight: 1.4 }}>
            Indicador simples de quanto o plano propõe mexer na carteira (não é volume de transferência nem dinheiro
            extra).
          </div>
        </div>
      </div>

      {data && data.grossBuyOrderVolumeEur > 0 ? (
        <details style={{ marginTop: 12, fontSize: 11, color: "#a1a1aa" }}>
          <summary
            style={{
              cursor: "pointer",
              fontWeight: 700,
              color: "#71717a",
              listStyle: "none",
            }}
          >
            Detalhes técnicos (opcional)
          </summary>
          <div
            style={{
              marginTop: 8,
              padding: "10px 12px",
              borderRadius: 10,
              background: "rgba(0,0,0,0.2)",
              border: "1px solid rgba(63,63,70,0.6)",
              lineHeight: 1.5,
            }}
          >
            <div>
              <strong style={{ color: "#d4d4d8" }}>Volume bruto de ordens (inclui FX):</strong>{" "}
              <span style={{ fontFamily: "ui-monospace, monospace" }}>{formatEur(data.grossBuyOrderVolumeEur)}</span>
            </div>
            {data.equityBuyVolumeEur > 0 && data.equityBuyVolumeEur !== data.grossBuyOrderVolumeEur ? (
              <div style={{ marginTop: 6 }}>
                <strong style={{ color: "#d4d4d8" }}>Soma BUY sem perna EUR/USD:</strong>{" "}
                <span style={{ fontFamily: "ui-monospace, monospace" }}>{formatEur(data.equityBuyVolumeEur)}</span>
              </div>
            ) : null}
            <div style={{ marginTop: 6 }}>
              <strong style={{ color: "#d4d4d8" }}>Pernas de ordem (ilustrativo):</strong> {data.orderLegCount}
            </div>
            <p style={{ margin: "8px 0 0", fontSize: 10, color: "#71717a" }}>
              Inclui compras, vendas e operações cambiais necessárias à execução — não confundir com capital a depositar.
            </p>
          </div>
        </details>
      ) : null}
    </div>
  );
}
