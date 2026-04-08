import Head from "next/head";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  clearOrderActivityLog,
  ORDER_ACTIVITY_CHANGED_EVENT,
  readOrderActivityLog,
  type OrderActivityEntry,
  type OrderActivityKind,
} from "../../lib/clientOrderActivityLog";
import { isDecideCashSleeveBrokerSymbol } from "../../lib/decideCashSleeveDisplay";

function kindLabelPt(k: OrderActivityKind): string {
  switch (k) {
    case "envio":
      return "Envio";
    case "execucao":
      return "Execução";
    case "cancelamento":
      return "Cancelamento";
    case "falha":
      return "Falha";
    default:
      return "Informação";
  }
}

function kindAccentColor(k: OrderActivityKind): string {
  switch (k) {
    case "envio":
      return "#38bdf8";
    case "execucao":
      return "#34d399";
    case "cancelamento":
      return "#fbbf24";
    case "falha":
      return "#f87171";
    default:
      return "#a1a1aa";
  }
}

function formatWhen(iso: string): string {
  try {
    const d = new Date(iso);
    return new Intl.DateTimeFormat("pt-PT", {
      dateStyle: "short",
      timeStyle: "medium",
    }).format(d);
  } catch {
    return iso;
  }
}

/** Hora só — o cabeçalho do dia já mostra a data. */
function formatTimeOnly(iso: string): string {
  try {
    return new Intl.DateTimeFormat("pt-PT", { timeStyle: "medium" }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function rowSummaryLine(e: OrderActivityEntry): string {
  const parts: string[] = [
    isDecideCashSleeveBrokerSymbol(e.ticker) ? `${e.ticker} (sleeve caixa/T-Bills)` : e.ticker,
  ];
  if (e.side) parts.push(e.side);
  if (typeof e.qty === "number" && Number.isFinite(e.qty) && e.qty > 0) parts.push(`${e.qty} u.`);
  let s = parts.join(" · ");
  if (typeof e.filled === "number" && e.filled > 0) {
    s += ` → ${e.filled}`;
    if (typeof e.avgPrice === "number" && Number.isFinite(e.avgPrice)) s += ` @ ${e.avgPrice}`;
  }
  return s;
}

/**
 * Histórico de ordens de bolsa (envio, execução, cancelamento) a partir do registo local
 * preenchido no Plano ao executar ordens e ao usar «Cancelar ordens não executadas (paper)».
 * Cancelamentos feitos só na TWS não aparecem aqui.
 */
export default function ClientAtividadePage() {
  const [entries, setEntries] = useState<OrderActivityEntry[]>([]);
  const [mounted, setMounted] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());
  const [refreshHint, setRefreshHint] = useState<string>("");

  const reloadFromStorage = useCallback(() => {
    setEntries(readOrderActivityLog());
  }, []);

  useEffect(() => {
    setMounted(true);
    reloadFromStorage();
  }, [reloadFromStorage]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.addEventListener(ORDER_ACTIVITY_CHANGED_EVENT, reloadFromStorage);
    return () => window.removeEventListener(ORDER_ACTIVITY_CHANGED_EVENT, reloadFromStorage);
  }, [reloadFromStorage]);

  const onManualRefresh = useCallback(() => {
    reloadFromStorage();
    try {
      setRefreshHint(
        `Lista relida às ${new Intl.DateTimeFormat("pt-PT", { timeStyle: "medium" }).format(new Date())} — só o registo deste browser (localStorage); não há ligação à corretora.`,
      );
    } catch {
      setRefreshHint("Lista relida — dados locais apenas.");
    }
  }, [reloadFromStorage]);

  const empty = mounted && entries.length === 0;

  const grouped = useMemo(() => {
    const map = new Map<string, OrderActivityEntry[]>();
    for (const e of entries) {
      const day = e.ts.slice(0, 10);
      const arr = map.get(day) || [];
      arr.push(e);
      map.set(day, arr);
    }
    return Array.from(map.entries()).sort((a, b) => (a[0] < b[0] ? 1 : a[0] > b[0] ? -1 : 0));
  }, [entries]);

  const onClear = () => {
    if (typeof window === "undefined") return;
    if (!window.confirm("Apagar todo o histórico de atividade de ordens neste browser?")) return;
    clearOrderActivityLog();
    setExpandedIds(new Set());
    reloadFromStorage();
  };

  const toggleRow = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <>
      <Head>
        <title>Atividade | DECIDE</title>
      </Head>
      <main
        style={{
          padding: "16px clamp(12px, 3vw, 28px) 32px",
          maxWidth: 880,
          margin: "0 auto",
          boxSizing: "border-box",
        }}
      >
        <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>Atividade</h1>
        <p style={{ color: "#a1a1aa", marginTop: 10, lineHeight: 1.55, fontSize: 14 }}>
          Registo de <strong style={{ color: "#e4e4e7" }}>envio</strong>,{" "}
          <strong style={{ color: "#e4e4e7" }}>execução</strong> e{" "}
          <strong style={{ color: "#e4e4e7" }}>cancelamento</strong> de ordens de bolsa (resposta do
          IBKR no{" "}
          <Link href="/client/report" style={{ color: "#d4d4d4", fontWeight: 700 }}>
            Plano
          </Link>
          : executar plano e cancelar ordens em aberto paper). Os dados ficam só neste browser
          (localStorage); alterações feitas apenas na TWS / IB Gateway não são sincronizadas
          automaticamente. Para gravar <strong style={{ color: "#e4e4e7" }}>execuções</strong> que só apareceram
          depois na IB, use <strong style={{ color: "#e4e4e7" }}>«Actualizar estado (IBKR)»</strong> no{" "}
          <Link href="/client/report" style={{ color: "#d4d4d4", fontWeight: 700 }}>
            Plano
          </Link>{" "}
          — isso acrescenta linhas verdes de execução aqui quando houver preenchimento sincronizado.
        </p>

        <div style={{ marginTop: 18, display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
          <button
            type="button"
            onClick={onManualRefresh}
            style={{
              padding: "8px 14px",
              borderRadius: 10,
              border: "1px solid #3f3f46",
              background: "#18181b",
              color: "#fafafa",
              fontWeight: 600,
              fontSize: 13,
              cursor: "pointer",
            }}
          >
            Actualizar lista
          </button>
          <button
            type="button"
            onClick={onClear}
            style={{
              padding: "8px 14px",
              borderRadius: 10,
              border: "1px solid #7f1d1d",
              background: "transparent",
              color: "#fca5a5",
              fontWeight: 600,
              fontSize: 13,
              cursor: "pointer",
            }}
          >
            Limpar histórico
          </button>
        </div>
        {refreshHint ? (
          <p style={{ margin: "12px 0 0", fontSize: 12, color: "#71717a", lineHeight: 1.5, maxWidth: 720 }}>
            {refreshHint}
          </p>
        ) : null}

        {!mounted ? (
          <p style={{ color: "#71717a", marginTop: 28, fontSize: 14 }}>A carregar…</p>
        ) : empty ? (
          <p style={{ color: "#71717a", marginTop: 28, fontSize: 14, lineHeight: 1.6 }}>
            Ainda não há eventos. Em{" "}
            <Link href="/client/report" style={{ color: "#d4d4d4", fontWeight: 700 }}>
              Plano
            </Link>
            , após executar ordens ou cancelar ordens em aberto (paper), o registo aparece aqui.
          </p>
        ) : (
          <div style={{ marginTop: 28 }}>
            {grouped.map(([day, dayEntries]) => (
              <section key={day} style={{ marginBottom: 28 }}>
                <h2
                  style={{
                    fontSize: 13,
                    fontWeight: 700,
                    color: "#71717a",
                    textTransform: "uppercase",
                    letterSpacing: "0.04em",
                    margin: "0 0 12px",
                  }}
                >
                  {day}
                </h2>
                <ul
                  style={{
                    listStyle: "none",
                    margin: 0,
                    padding: 0,
                    display: "flex",
                    flexDirection: "column",
                    gap: 4,
                  }}
                >
                  {dayEntries.map((e) => {
                    const open = expandedIds.has(e.id);
                    const panelId = `atividade-detalhe-${e.id}`;
                    return (
                      <li
                        key={e.id}
                        style={{
                          borderRadius: 10,
                          border: "1px solid #27272a",
                          background: "#0c0c0e",
                          overflow: "hidden",
                        }}
                      >
                        <button
                          type="button"
                          id={`atividade-linha-${e.id}`}
                          aria-expanded={open}
                          aria-controls={panelId}
                          onClick={() => toggleRow(e.id)}
                          style={{
                            width: "100%",
                            margin: 0,
                            padding: "10px 12px",
                            display: "flex",
                            flexWrap: "nowrap",
                            alignItems: "center",
                            gap: 10,
                            border: "none",
                            background: open ? "rgba(39,39,42,0.35)" : "transparent",
                            color: "inherit",
                            cursor: "pointer",
                            textAlign: "left",
                            font: "inherit",
                            boxSizing: "border-box",
                            minWidth: 0,
                          }}
                        >
                          <span
                            aria-hidden
                            style={{
                              fontSize: 10,
                              color: "#71717a",
                              lineHeight: 1,
                              flexShrink: 0,
                              width: 14,
                            }}
                          >
                            {open ? "▼" : "▶"}
                          </span>
                          <span
                            style={{
                              fontSize: 10,
                              fontWeight: 800,
                              textTransform: "uppercase",
                              letterSpacing: "0.05em",
                              color: kindAccentColor(e.kind),
                              whiteSpace: "nowrap",
                              flexShrink: 0,
                              minWidth: "7.5em",
                            }}
                          >
                            {kindLabelPt(e.kind)}
                          </span>
                          <span
                            style={{
                              color: "#71717a",
                              fontSize: 12,
                              fontVariantNumeric: "tabular-nums",
                              whiteSpace: "nowrap",
                              flexShrink: 0,
                            }}
                          >
                            {formatTimeOnly(e.ts)}
                          </span>
                          <span
                            style={{
                              fontSize: 14,
                              fontWeight: 600,
                              color: "#fafafa",
                              minWidth: 0,
                              flex: "1 1 120px",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                            title={`${rowSummaryLine(e)}${e.status ? ` · ${e.status}` : ""}`}
                          >
                            {rowSummaryLine(e)}
                            {e.status ? (
                              <span style={{ color: "#71717a", fontWeight: 500 }}>
                                {" "}
                                · <span style={{ color: "#a1a1aa" }}>{e.status}</span>
                              </span>
                            ) : null}
                          </span>
                          <span
                            style={{
                              fontSize: 11,
                              color: "#52525b",
                              whiteSpace: "nowrap",
                              flexShrink: 0,
                            }}
                          >
                            {open ? "Fechar" : "Detalhe"}
                          </span>
                        </button>
                        {open ? (
                          <div
                            id={panelId}
                            role="region"
                            aria-labelledby={`atividade-linha-${e.id}`}
                            style={{
                              borderTop: "1px solid #27272a",
                              padding: "12px 14px 14px 38px",
                              fontSize: 13,
                              lineHeight: 1.55,
                              color: "#a1a1aa",
                            }}
                          >
                            <p style={{ margin: 0, fontSize: 12, color: "#71717a" }}>
                              {formatWhen(e.ts)}
                            </p>
                            {e.status ? (
                              <p style={{ margin: "10px 0 0" }}>
                                <span style={{ color: "#71717a" }}>Estado IBKR:</span>{" "}
                                <code style={{ color: "#e4e4e7", fontSize: 12 }}>{e.status}</code>
                              </p>
                            ) : null}
                            {(typeof e.qty === "number" && e.qty > 0) ||
                            (typeof e.filled === "number" && e.filled > 0) ? (
                              <p style={{ margin: "8px 0 0" }}>
                                {typeof e.qty === "number" && e.qty > 0 ? (
                                  <>
                                    Quantidade pedida: <strong style={{ color: "#e4e4e7" }}>{e.qty}</strong>
                                  </>
                                ) : null}
                                {typeof e.filled === "number" && e.filled > 0 ? (
                                  <>
                                    {typeof e.qty === "number" && e.qty > 0 ? " · " : null}
                                    Preenchido:{" "}
                                    <strong style={{ color: "#86efac" }}>{e.filled}</strong>
                                    {typeof e.avgPrice === "number" && Number.isFinite(e.avgPrice) ? (
                                      <>
                                        {" "}
                                        @ <strong style={{ color: "#e4e4e7" }}>{e.avgPrice}</strong>
                                      </>
                                    ) : null}
                                  </>
                                ) : null}
                              </p>
                            ) : null}
                            {e.detail ? (
                              <p style={{ margin: "10px 0 0", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                                {e.detail}
                              </p>
                            ) : null}
                            {e.source ? (
                              <p style={{ margin: "12px 0 0", fontSize: 11, color: "#52525b" }}>{e.source}</p>
                            ) : null}
                          </div>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>
        )}
      </main>
    </>
  );
}
