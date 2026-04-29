import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CLIENT_SESSION_CHANGED_EVENT } from "../lib/clientAuth";
import { DECIDE_DASHBOARD_KPI_REFRESH_EVENT } from "../lib/decideDashboardEvents";
import {
  buildIbkrPositionDisplayRows,
  formatIbkrQuantity,
  formatMoneyIbkr,
  IBKR_NO_STOCK_POSITIONS_LABEL_PT,
  ibkrSnapshotUnavailableHint,
  isIbkrSnapshotOk,
  tmpDiagIbkrFallbackUserNote,
  type IbkrPositionDisplayRow,
  type IbkrSnapshotPayload,
} from "../lib/ibkrSnapshotParse";
import { yahooFinanceQuoteHref } from "../lib/yahooFinanceQuoteUrl";
import InlineLoadingDots from "./InlineLoadingDots";

type Props = {
  /** Bump externo (ex. «Atualizar recomendação» na mesma página). */
  refreshToken?: number;
};

function IbkrTickerLink({ ticker }: { ticker: string }) {
  const href = yahooFinanceQuoteHref(ticker);
  if (!href) return <>{ticker}</>;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      style={{ color: "#e4e4e7", textDecoration: "none" }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLAnchorElement).style.textDecoration = "underline";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLAnchorElement).style.textDecoration = "none";
      }}
    >
      {ticker}
    </a>
  );
}

const RISK_COL_TOOLTIP_PT =
  "% risco exclui caixa e mede o peso relativo dentro da parte investida.";

/** Retorna mensagem curta se concentração em semicondutores ou US for alta (sleeve investido). */
function concentrationDemoNote(rows: IbkrPositionDisplayRow[]): string | null {
  let semiPct = 0;
  let usPct = 0;
  for (const r of rows) {
    const w = r.weightPctSecurities ?? 0;
    const sector = (r.sector || "").toLowerCase();
    const industry = (r.industry || "").toLowerCase();
    if (sector.includes("semiconductor") || industry.includes("semiconductor")) {
      semiPct += w;
    }
    const rm = (r.regionModel || "").trim().toUpperCase();
    if (rm === "US") {
      usPct += w;
    } else if (!rm) {
      const c = (r.country || "").toLowerCase();
      if (/\beua\b|estados unidos|u\.s\.|usa\b/.test(c)) usPct += w;
    }
  }
  const warnSemi = semiPct >= 18;
  const warnUs = usPct >= 38;
  if (!warnSemi && !warnUs) return null;
  const bits: string[] = [];
  if (warnSemi) bits.push("Semiconductors");
  if (warnUs) bits.push("US");
  return `Concentração actual em ${bits.join(" / ")} elevada no sleeve investido; a recomendação DECIDE no separador Plano poderá reduzir ou manter a exposição conforme o modelo.`;
}

/**
 * Lista de posições na conta IBKR (snapshot real) — substitui o separador Flask «Holdings» do modelo DECIDE
 * na página Carteira.
 */
export default function CarteiraActualIbkrPanel({ refreshToken = 0 }: Props) {
  const [loading, setLoading] = useState(true);
  const [ok, setOk] = useState(false);
  const [ccy, setCcy] = useState("EUR");
  const [rows, setRows] = useState<IbkrPositionDisplayRow[]>([]);
  const [hint, setHint] = useState<string>("");
  const [fallbackNote, setFallbackNote] = useState<string>("");
  const [netLiquidation, setNetLiquidation] = useState<number | null>(null);
  /** % do NAV em caixa — quando o backend envia `cash_ledger.weight_pct`. */
  const [cashWeightPctNav, setCashWeightPctNav] = useState<number | null>(null);

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
        setFallbackNote(tmpDiagIbkrFallbackUserNote(snap));
        setOk(true);
        setCcy(typeof snap.net_liquidation_ccy === "string" ? snap.net_liquidation_ccy : "EUR");
        const navN =
          typeof snap.net_liquidation === "number" && Number.isFinite(snap.net_liquidation)
            ? snap.net_liquidation
            : null;
        setNetLiquidation(navN);
        const cl = snap.cash_ledger as { weight_pct?: unknown } | undefined;
        const cw =
          cl && typeof cl.weight_pct === "number" && Number.isFinite(cl.weight_pct)
            ? cl.weight_pct
            : null;
        setCashWeightPctNav(cw);
        setRows(buildIbkrPositionDisplayRows(snap));
      } else {
        setFallbackNote("");
        setHint(ibkrSnapshotUnavailableHint(snap, r.ok, r.status));
        setOk(false);
        setRows([]);
        setNetLiquidation(null);
        setCashWeightPctNav(null);
      }
    } catch {
      setFallbackNote("");
      setHint("Erro de rede ao pedir o snapshot IBKR.");
      setOk(false);
      setRows([]);
      setNetLiquidation(null);
      setCashWeightPctNav(null);
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

  function fmtPct(n: number | null): string {
    if (n == null || !Number.isFinite(n)) return "—";
    return `${n.toFixed(2)}%`;
  }

  const grossSecurities = useMemo(() => rows.reduce((acc, r) => acc + r.value, 0), [rows]);

  const summarySplit = useMemo(() => {
    const nav = netLiquidation;
    if (nav == null || nav <= 0 || !Number.isFinite(nav)) {
      return { pctTitlesNav: null as number | null, pctCashNav: null as number | null };
    }
    const pctT = Math.min(100, (grossSecurities / nav) * 100);
    const pctC =
      cashWeightPctNav != null && Number.isFinite(cashWeightPctNav)
        ? Math.min(100, Math.max(0, cashWeightPctNav))
        : Math.min(100, Math.max(0, 100 - pctT));
    return { pctTitlesNav: pctT, pctCashNav: pctC };
  }, [netLiquidation, grossSecurities, cashWeightPctNav]);

  const cashAbsEstimate = useMemo(() => {
    if (netLiquidation == null || !Number.isFinite(netLiquidation)) return null;
    if (cashWeightPctNav != null && Number.isFinite(cashWeightPctNav)) {
      return (netLiquidation * cashWeightPctNav) / 100;
    }
    return Math.max(0, netLiquidation - grossSecurities);
  }, [netLiquidation, grossSecurities, cashWeightPctNav]);

  const concentrationMsg = useMemo(() => (rows.length ? concentrationDemoNote(rows) : null), [rows]);

  return (
    <div className="decide-app-embed-panel-inner decide-app-embed-panel-inner--carteira-ibkr-positions">
      <p className="decide-app-muted-label" style={{ marginBottom: 6 }}>
        Posições na conta
      </p>
      <h2 className="decide-app-panel-title" style={{ marginTop: 0, marginBottom: 10 }}>
        Activos (IBKR)
      </h2>
      <ul
        style={{
          margin: "0 0 18px",
          paddingLeft: 20,
          fontSize: 13,
          lineHeight: 1.55,
          color: "#a1a1aa",
          maxWidth: 720,
        }}
      >
        <li style={{ marginBottom: 6 }}>Dados sincronizados da conta IBKR.</li>
        <li style={{ marginBottom: 6 }}>Pesos calculados sobre o NAV total.</li>
        <li style={{ marginBottom: 0 }}>
          Esta página mostra posições actuais; a recomendação está no separador{" "}
          <Link href="/client/report" style={{ color: "#5eead4", fontWeight: 700 }}>
            Plano
          </Link>
          .
        </li>
      </ul>
      {ok && fallbackNote && !loading ? (
        <p style={{ margin: "0 0 14px", fontSize: 13, lineHeight: 1.45, color: "#a78bfa", maxWidth: 820 }}>
          {fallbackNote}
        </p>
      ) : null}
      {loading ? (
        <p style={{ margin: 0, fontSize: 14, color: "#71717a" }} role="status">
          A carregar posições
          <InlineLoadingDots />
        </p>
      ) : !ok ? (
        <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5, color: "#a1a1aa", maxWidth: 820 }}>
          {hint ||
            "Sem leitura da conta IBKR. Confirme TWS/Gateway e o backend; a lista aparece quando a ligação estiver activa."}
        </p>
      ) : rows.length === 0 ? (
        <p style={{ margin: 0, fontSize: 14, color: "#d4d4d8" }}>{IBKR_NO_STOCK_POSITIONS_LABEL_PT}</p>
      ) : (
        <>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(148px, 1fr))",
              gap: 12,
              marginBottom: concentrationMsg ? 12 : 16,
              maxWidth: 920,
            }}
          >
            <div
              style={{
                borderRadius: 12,
                border: "1px solid rgba(255,255,255,0.1)",
                background: "rgba(39,39,42,0.55)",
                padding: "12px 14px",
              }}
            >
              <div style={{ fontSize: 11, fontWeight: 700, color: "#71717a", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                Valor da carteira
              </div>
              <div style={{ marginTop: 6, fontSize: 18, fontWeight: 800, color: "#fafafa" }}>
                {netLiquidation != null ? formatMoneyIbkr(netLiquidation, ccy) : "—"}
              </div>
              <div style={{ marginTop: 4, fontSize: 11, color: "#71717a" }}>NAV (IBKR)</div>
            </div>
            <div
              style={{
                borderRadius: 12,
                border: "1px solid rgba(255,255,255,0.1)",
                background: "rgba(39,39,42,0.55)",
                padding: "12px 14px",
              }}
            >
              <div style={{ fontSize: 11, fontWeight: 700, color: "#71717a", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                Nº de posições
              </div>
              <div style={{ marginTop: 6, fontSize: 18, fontWeight: 800, color: "#fafafa" }}>{rows.length}</div>
              <div style={{ marginTop: 4, fontSize: 11, color: "#71717a" }}>Linhas na lista</div>
            </div>
            <div
              style={{
                borderRadius: 12,
                border: "1px solid rgba(255,255,255,0.1)",
                background: "rgba(39,39,42,0.55)",
                padding: "12px 14px",
              }}
            >
              <div style={{ fontSize: 11, fontWeight: 700, color: "#71717a", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                Caixa disponível
              </div>
              <div style={{ marginTop: 6, fontSize: 18, fontWeight: 800, color: "#fafafa" }}>
                {cashAbsEstimate != null ? formatMoneyIbkr(cashAbsEstimate, ccy) : "—"}
              </div>
              <div style={{ marginTop: 4, fontSize: 11, color: "#71717a" }}>
                {cashWeightPctNav != null ? "Reportado pela IBKR" : "Estimado (NAV − títulos)"}
              </div>
            </div>
            <div
              style={{
                borderRadius: 12,
                border: "1px solid rgba(255,255,255,0.1)",
                background: "rgba(39,39,42,0.55)",
                padding: "12px 14px",
              }}
            >
              <div style={{ fontSize: 11, fontWeight: 700, color: "#71717a", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                Alocação (NAV)
              </div>
              <div style={{ marginTop: 6, fontSize: 15, fontWeight: 700, color: "#e4e4e7", lineHeight: 1.35 }}>
                {summarySplit.pctTitlesNav != null ? fmtPct(summarySplit.pctTitlesNav) : "—"}{" "}
                <span style={{ color: "#71717a", fontWeight: 600 }}>títulos</span>
              </div>
              <div style={{ marginTop: 4, fontSize: 15, fontWeight: 700, color: "#e4e4e7" }}>
                {summarySplit.pctCashNav != null ? fmtPct(summarySplit.pctCashNav) : "—"}{" "}
                <span style={{ color: "#71717a", fontWeight: 600 }}>caixa</span>
              </div>
            </div>
          </div>
          {concentrationMsg ? (
            <div
              style={{
                marginBottom: 16,
                maxWidth: 920,
                padding: "12px 14px",
                borderRadius: 12,
                border: "1px solid rgba(251, 191, 36, 0.35)",
                background: "rgba(120, 53, 15, 0.22)",
                fontSize: 13,
                lineHeight: 1.5,
                color: "#fcd34d",
              }}
            >
              <strong style={{ color: "#fef3c7" }}>Concentração:</strong> {concentrationMsg}
            </div>
          ) : null}
          <div
            style={{
              overflowX: "auto",
              maxWidth: "100%",
              borderRadius: 12,
              border: "1px solid rgba(255,255,255,0.08)",
              WebkitOverflowScrolling: "touch",
            }}
          >
            <table
              style={{
                minWidth: 960,
                width: "100%",
                borderCollapse: "collapse",
                fontSize: 12,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              <thead>
                <tr style={{ background: "rgba(39,39,42,0.6)", textAlign: "left" }}>
                  <th style={{ padding: "6px 6px", fontWeight: 700, color: "#a1a1aa", width: "4%", lineHeight: 1.2 }}>#</th>
                  <th style={{ padding: "6px 6px", fontWeight: 700, color: "#a1a1aa", width: "9%", lineHeight: 1.2 }}>Ticker</th>
                  <th style={{ padding: "6px 6px", fontWeight: 700, color: "#a1a1aa", textAlign: "right", width: "8%", lineHeight: 1.2 }}>
                    Qtd.
                  </th>
                  <th style={{ padding: "6px 6px", fontWeight: 700, color: "#a1a1aa", width: "15%", lineHeight: 1.2 }}>Nome</th>
                  <th style={{ padding: "6px 6px", fontWeight: 700, color: "#a1a1aa", width: "9%", lineHeight: 1.2 }}>País</th>
                  <th style={{ padding: "6px 6px", fontWeight: 700, color: "#a1a1aa", width: "10%", lineHeight: 1.2 }}>Setor</th>
                  <th style={{ padding: "6px 6px", fontWeight: 700, color: "#a1a1aa", width: "10%", lineHeight: 1.2 }}>Indústria</th>
                  <th style={{ padding: "6px 6px", fontWeight: 700, color: "#a1a1aa", width: "8%", lineHeight: 1.2 }}>
                    Zona DECIDE
                  </th>
                  <th style={{ padding: "6px 6px", fontWeight: 700, color: "#a1a1aa", textAlign: "right", width: "9%", lineHeight: 1.2 }}>
                    Valor
                  </th>
                  <th style={{ padding: "6px 6px", fontWeight: 700, color: "#a1a1aa", textAlign: "right", width: "6%", lineHeight: 1.2 }}>
                    % NAV
                  </th>
                  <th
                    style={{
                      padding: "6px 6px",
                      fontWeight: 700,
                      color: "#a1a1aa",
                      textAlign: "right",
                      width: "8%",
                      lineHeight: 1.2,
                      cursor: "help",
                    }}
                    title={RISK_COL_TOOLTIP_PT}
                  >
                    <abbr title={RISK_COL_TOOLTIP_PT} style={{ textDecoration: "underline dotted", textUnderlineOffset: 2 }}>
                      % risco
                    </abbr>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={`${row.rank}-${row.ticker}`}
                    style={{ borderTop: "1px solid rgba(255,255,255,0.06)", color: "#e4e4e7" }}
                  >
                    <td style={{ padding: "6px 6px", color: "#71717a" }}>{row.rank}</td>
                    <td style={{ padding: "6px 6px", fontWeight: 600, wordBreak: "break-word" }}>
                      <IbkrTickerLink ticker={row.ticker} />
                    </td>
                    <td style={{ padding: "6px 6px", textAlign: "right", color: "#d4d4d8" }}>
                      {formatIbkrQuantity(row.quantity)}
                    </td>
                    <td
                      style={{
                        padding: "6px 6px",
                        wordBreak: "break-word",
                        overflowWrap: "anywhere",
                      }}
                    >
                      {row.name}
                    </td>
                    <td style={{ padding: "6px 6px", color: "#a1a1aa", wordBreak: "break-word" }}>{row.country ?? "—"}</td>
                    <td style={{ padding: "6px 6px", color: "#a1a1aa", wordBreak: "break-word" }}>{row.sector ?? "—"}</td>
                    <td style={{ padding: "6px 6px", color: "#a1a1aa", wordBreak: "break-word" }}>{row.industry ?? "—"}</td>
                    <td style={{ padding: "6px 6px", color: "#a1a1aa", wordBreak: "break-word", fontWeight: 600 }}>
                      {row.regionModel ?? "—"}
                    </td>
                    <td style={{ padding: "6px 6px", textAlign: "right", fontWeight: 600 }}>
                      {formatMoneyIbkr(row.value, ccy)}
                    </td>
                    <td style={{ padding: "6px 6px", textAlign: "right" }}>{fmtPct(row.weightPct)}</td>
                    <td style={{ padding: "6px 6px", textAlign: "right" }}>{fmtPct(row.weightPctSecurities)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
