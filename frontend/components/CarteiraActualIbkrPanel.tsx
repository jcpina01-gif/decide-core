import { useCallback, useEffect, useState } from "react";
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
  type IbkrSnapshotPayload,
} from "../lib/ibkrSnapshotParse";
import { yahooFinanceQuoteHref } from "../lib/yahooFinanceQuoteUrl";
import InlineLoadingDots from "./InlineLoadingDots";
import { PLAFONADO_MODEL_INLINE_PT } from "../lib/freezePlafonadoDir";

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

/**
 * Lista de posições na conta IBKR (snapshot real) — substitui o separador Flask «Holdings» do modelo DECIDE
 * na página Carteira.
 */
export default function CarteiraActualIbkrPanel({ refreshToken = 0 }: Props) {
  const [loading, setLoading] = useState(true);
  const [ok, setOk] = useState(false);
  const [ccy, setCcy] = useState("EUR");
  const [rows, setRows] = useState<ReturnType<typeof buildIbkrPositionDisplayRows>>([]);
  const [hint, setHint] = useState<string>("");
  const [fallbackNote, setFallbackNote] = useState<string>("");

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
        setRows(buildIbkrPositionDisplayRows(snap));
      } else {
        setFallbackNote("");
        setHint(ibkrSnapshotUnavailableHint(snap, r.ok, r.status));
        setOk(false);
        setRows([]);
      }
    } catch {
      setFallbackNote("");
      setHint("Erro de rede ao pedir o snapshot IBKR.");
      setOk(false);
      setRows([]);
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

  return (
    <div className="decide-app-embed-panel-inner decide-app-embed-panel-inner--carteira-ibkr-positions">
      <p className="decide-app-muted-label" style={{ marginBottom: 6 }}>
        Posições na conta
      </p>
      <h2 className="decide-app-panel-title" style={{ marginTop: 0, marginBottom: 10 }}>
        Activos (IBKR)
      </h2>
      <p style={{ margin: "0 0 16px", fontSize: 13, lineHeight: 1.5, color: "#a1a1aa", maxWidth: 820 }}>
        Lista sincronizada com a sua conta na corretora (TWS / IB Gateway), pelo mesmo{" "}
        <strong style={{ color: "#e4e4e7" }}>snapshot IBKR</strong> que o Plano usa quando o backend responde — não
        confunda com ficheiros <code style={{ color: "#a1a1aa" }}>tmp_diag</code> de testes ou com a grelha de{" "}
        <strong style={{ color: "#e4e4e7" }}>alterações / ordens</strong> (muitas linhas). Não é a carteira recomendada
        pelo {PLAFONADO_MODEL_INLINE_PT} — use o <strong style={{ color: "#e4e4e7" }}>Dashboard</strong> para ver KPIs
        e composição do plano sugerido. O teto <strong style={{ color: "#e4e4e7" }}>CAP15</strong> (máx. 15% por
        título) aplica-se aos <strong style={{ color: "#e4e4e7" }}>pesos-alvo do modelo</strong>, não a esta lista:
        aqui veja o que está efectivamente na conta (compras manuais, execução parcial ou drift).
      </p>
      <p style={{ margin: "0 0 14px", fontSize: 12, lineHeight: 1.5, color: "#71717a", maxWidth: 820 }}>
        <strong style={{ color: "#a1a1aa" }}>Pesos:</strong> «Peso %» utiliza o património líquido total (NAV) como
        denominador. «% só títulos» divide só pelo valor agregado das posições em títulos (exclui caixa) — útil para
        ver concentração na parte accionista, mas <strong style={{ color: "#a1a1aa" }}>não</strong> implica validação
        CAP15; para isso compare com a carteira recomendada no <strong style={{ color: "#a1a1aa" }}>Plano</strong>.
      </p>
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
        <div style={{ overflowX: "auto", borderRadius: 12, border: "1px solid rgba(255,255,255,0.08)" }}>
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              fontSize: 13,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            <thead>
              <tr style={{ background: "rgba(39,39,42,0.6)", textAlign: "left" }}>
                <th style={{ padding: "10px 12px", fontWeight: 700, color: "#a1a1aa" }}>#</th>
                <th style={{ padding: "10px 12px", fontWeight: 700, color: "#a1a1aa" }}>Ticker</th>
                <th style={{ padding: "10px 12px", fontWeight: 700, color: "#a1a1aa", textAlign: "right" }}>
                  Qtd. (u.)
                </th>
                <th style={{ padding: "10px 12px", fontWeight: 700, color: "#a1a1aa" }}>Nome</th>
                <th style={{ padding: "10px 12px", fontWeight: 700, color: "#a1a1aa" }}>Zona</th>
                <th style={{ padding: "10px 12px", fontWeight: 700, color: "#a1a1aa" }}>País</th>
                <th style={{ padding: "10px 12px", fontWeight: 700, color: "#a1a1aa" }}>Setor</th>
                <th style={{ padding: "10px 12px", fontWeight: 700, color: "#a1a1aa" }}>Indústria</th>
                <th style={{ padding: "10px 12px", fontWeight: 700, color: "#a1a1aa" }}>Região (modelo)</th>
                <th style={{ padding: "10px 12px", fontWeight: 700, color: "#a1a1aa", textAlign: "right" }}>
                  Valor
                </th>
                <th style={{ padding: "10px 12px", fontWeight: 700, color: "#a1a1aa", textAlign: "right" }}>
                  Peso % (NAV)
                </th>
                <th style={{ padding: "10px 12px", fontWeight: 700, color: "#a1a1aa", textAlign: "right" }}>
                  % só títulos
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={`${row.rank}-${row.ticker}`}
                  style={{ borderTop: "1px solid rgba(255,255,255,0.06)", color: "#e4e4e7" }}
                >
                  <td style={{ padding: "9px 12px", color: "#71717a" }}>{row.rank}</td>
                  <td style={{ padding: "9px 12px", fontWeight: 600 }}>
                    <IbkrTickerLink ticker={row.ticker} />
                  </td>
                  <td style={{ padding: "9px 12px", textAlign: "right", color: "#d4d4d8" }}>
                    {formatIbkrQuantity(row.quantity)}
                  </td>
                  <td style={{ padding: "9px 12px", maxWidth: 280 }}>{row.name}</td>
                  <td style={{ padding: "9px 12px", color: "#a1a1aa" }}>{row.zone ?? "—"}</td>
                  <td style={{ padding: "9px 12px", color: "#a1a1aa" }}>{row.country ?? "—"}</td>
                  <td style={{ padding: "9px 12px", color: "#a1a1aa" }}>{row.sector ?? "—"}</td>
                  <td style={{ padding: "9px 12px", color: "#a1a1aa" }}>{row.industry ?? "—"}</td>
                  <td style={{ padding: "9px 12px", color: "#a1a1aa" }}>{row.regionModel ?? "—"}</td>
                  <td style={{ padding: "9px 12px", textAlign: "right", fontWeight: 600 }}>
                    {formatMoneyIbkr(row.value, ccy)}
                  </td>
                  <td style={{ padding: "9px 12px", textAlign: "right" }}>{fmtPct(row.weightPct)}</td>
                  <td style={{ padding: "9px 12px", textAlign: "right" }}>{fmtPct(row.weightPctSecurities)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
