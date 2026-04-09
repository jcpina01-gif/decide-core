import { useCallback, useEffect, useState } from "react";
import { CLIENT_SESSION_CHANGED_EVENT } from "../lib/clientAuth";
import { DECIDE_DASHBOARD_KPI_REFRESH_EVENT } from "../lib/decideDashboardEvents";
import { DECIDE_DASHBOARD } from "../lib/decideClientTheme";
import {
  deriveInvestedUninvested,
  formatMoneyIbkr,
  formatMoneyIbkrOrDash,
  IBKR_NO_STOCK_POSITIONS_LABEL_PT,
  ibkrSnapshotUnavailableHint,
  isIbkrSnapshotOk,
  safeNumber,
  type IbkrSnapshotPayload,
} from "../lib/ibkrSnapshotParse";
import { PLAFONADO_MODEL_INLINE_PT } from "../lib/freezePlafonadoDir";

type Props = {
  /** Bump externo (ex. botão «Atualizar recomendação» na mesma página). */
  refreshToken?: number;
  /** Quando true, remove margem inferior extra (uso em `ClientKpiEmbedWorkspace` / coluna principal). */
  embeddedInMainColumn?: boolean;
};

/**
 * Topo da página Carteira: património e liquidez na **conta IBKR** (real/paper),
 * distinto da recomendação do modelo no iframe.
 */
export default function CarteiraIbkrSummary({
  refreshToken = 0,
  embeddedInMainColumn = false,
}: Props) {
  const [loading, setLoading] = useState(true);
  const [ok, setOk] = useState(false);
  const [nav, setNav] = useState<number | null>(null);
  const [ccy, setCcy] = useState("EUR");
  const [invested, setInvested] = useState<number | null>(null);
  const [uninvested, setUninvested] = useState<number | null>(null);
  const [hint, setHint] = useState<string>("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/ibkr-snapshot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paper_mode: true }),
        credentials: "same-origin",
        cache: "no-store",
      });
      const raw = await r.text();
      let snap: IbkrSnapshotPayload = {};
      try {
        snap = raw ? (JSON.parse(raw) as IbkrSnapshotPayload) : {};
      } catch {
        snap = {};
      }
      if (isIbkrSnapshotOk(snap, r.ok)) {
        setHint("");
        setNav(safeNumber(snap.net_liquidation, 0));
        setCcy(typeof snap.net_liquidation_ccy === "string" ? snap.net_liquidation_ccy : "EUR");
        setOk(true);
        const d = deriveInvestedUninvested(snap);
        setInvested(d.invested);
        setUninvested(d.uninvested);
      } else {
        setHint(ibkrSnapshotUnavailableHint(snap, r.ok, r.status));
        setOk(false);
        setNav(null);
        setInvested(null);
        setUninvested(null);
      }
    } catch {
      setHint("Erro de rede ao pedir o snapshot IBKR.");
      setOk(false);
      setNav(null);
      setInvested(null);
      setUninvested(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshToken]);

  useEffect(() => {
    const bump = () => void load();
    window.addEventListener(DECIDE_DASHBOARD_KPI_REFRESH_EVENT, bump);
    window.addEventListener(CLIENT_SESSION_CHANGED_EVENT, bump);
    return () => {
      window.removeEventListener(DECIDE_DASHBOARD_KPI_REFRESH_EVENT, bump);
      window.removeEventListener(CLIENT_SESSION_CHANGED_EVENT, bump);
    };
  }, [load]);

  const compact = embeddedInMainColumn;

  return (
    <section
      className={["carteira-ibkr-summary", compact ? "carteira-ibkr-summary--compact" : ""].filter(Boolean).join(" ")}
      aria-labelledby="carteira-ibkr-summary-title"
      style={{
        marginBottom: embeddedInMainColumn ? 0 : 16,
        padding: compact ? undefined : "14px 16px 16px",
        borderRadius: compact ? undefined : 14,
        border: DECIDE_DASHBOARD.panelBorder,
        background: DECIDE_DASHBOARD.clientPanelGradient,
        boxShadow: DECIDE_DASHBOARD.clientPanelShadow,
        boxSizing: "border-box",
      }}
    >
      <h2
        id="carteira-ibkr-summary-title"
        className={compact ? "carteira-ibkr-summary-kicker" : undefined}
        style={{
          margin: compact ? "0 0 6px" : "0 0 4px",
          fontSize: 13,
          fontWeight: 800,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: "#737373",
        }}
      >
        Conta IBKR — carteira actual
      </h2>
      {!compact ? (
        <p style={{ margin: "0 0 12px", fontSize: 14, lineHeight: 1.5, color: "#a1a1aa", maxWidth: 720 }}>
          Valores reportados pela corretora (ligação TWS / IB Gateway). Abaixo segue o detalhe das posições na mesma
          conta; o plano recomendado pelo {PLAFONADO_MODEL_INLINE_PT} está no{" "}
          <strong style={{ color: "#e4e4e7" }}>Dashboard</strong>.
        </p>
      ) : null}
      {loading ? (
        <p style={{ margin: 0, fontSize: compact ? 15 : 16, color: "#71717a" }}>A carregar dados da conta…</p>
      ) : !ok || nav == null ? (
        <p style={{ margin: 0, fontSize: compact ? 13 : 14, lineHeight: 1.5, color: "#a1a1aa", maxWidth: 720 }}>
          {hint ||
            "Sem leitura da conta IBKR. Confirme TWS/Gateway e o backend; os totais aparecem aqui quando a ligação estiver activa."}
        </p>
      ) : compact ? (
        <div className="carteira-ibkr-summary-metrics">
          <p style={{ margin: "0 0 10px", fontSize: 13, lineHeight: 1.45, color: "#a1a1aa", maxWidth: 720 }}>
            Valores da <strong style={{ color: "#e4e4e7" }}>conta IBKR</strong> (TWS/Gateway). Abaixo, a lista
            detalhada das posições na mesma conta (não é a carteira recomendada do modelo — veja o Dashboard para o
            plano DECIDE).
          </p>
          <div className="carteira-ibkr-summary-total-block">
            <div style={{ fontSize: 12, fontWeight: 700, color: "#71717a", marginBottom: 2 }}>
              Carteira (valor total)
            </div>
            <div
              className="carteira-ibkr-summary-total-value"
              style={{
                fontSize: "clamp(1.3rem, 2.55vw, 1.62rem)",
                fontWeight: 800,
                fontVariantNumeric: "tabular-nums",
                color: "#f4f4f5",
              }}
            >
              {formatMoneyIbkr(nav, ccy)}
            </div>
          </div>
          {invested != null && uninvested != null ? (
            <div
              className="carteira-ibkr-summary-split"
              style={{ fontWeight: 600, color: "#d4d4d8", fontVariantNumeric: "tabular-nums" }}
            >
              <span>
                Investido:{" "}
                {invested <= 0 ? IBKR_NO_STOCK_POSITIONS_LABEL_PT : formatMoneyIbkrOrDash(invested, ccy)}
              </span>
              <span>Liquidez disponível: {formatMoneyIbkrOrDash(uninvested, ccy)}</span>
            </div>
          ) : null}
          {ccy.toUpperCase() !== "EUR" ? (
            <p style={{ margin: 0, flex: "1 1 100%", fontSize: 12, color: "#71717a" }}>
              Moeda: {ccy.toUpperCase()}
            </p>
          ) : null}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#71717a", marginBottom: 2 }}>Carteira (valor total)</div>
            <div
              style={{
                fontSize: "clamp(1.3rem, 2.55vw, 1.62rem)",
                fontWeight: 800,
                fontVariantNumeric: "tabular-nums",
                color: "#f4f4f5",
              }}
            >
              {formatMoneyIbkr(nav, ccy)}
            </div>
          </div>
          {invested != null && uninvested != null ? (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 4,
                fontSize: 15,
                fontWeight: 600,
                color: "#d4d4d8",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              <span>
                Investido: {invested <= 0 ? IBKR_NO_STOCK_POSITIONS_LABEL_PT : formatMoneyIbkrOrDash(invested, ccy)}
              </span>
              <span>Liquidez disponível: {formatMoneyIbkrOrDash(uninvested, ccy)}</span>
            </div>
          ) : null}
          {ccy.toUpperCase() !== "EUR" ? (
            <p style={{ margin: "4px 0 0", fontSize: 13, color: "#71717a" }}>
              Moeda base do snapshot: {ccy.toUpperCase()}; conversões no plano quando aplicável.
            </p>
          ) : null}
        </div>
      )}
    </section>
  );
}
