import { useEffect, useState } from "react";
import { getKpiEmbedBase } from "../lib/kpiEmbedNav";

type Props = {
  /** Muda quando o utilizador carrega «Atualizar recomendação» — volta a testar o Flask. */
  bump?: number;
};

/**
 * Aviso quando o browser não consegue falar com o serviço Flask dos KPIs (tipicamente :5000 parado).
 * O iframe pode ficar cinzento ou eternamente a «carregar» sem isto.
 */
export default function KpiFlaskConnectivityBanner({ bump = 0 }: Props) {
  const [phase, setPhase] = useState<"checking" | "ok" | "fail">("checking");

  useEffect(() => {
    const base = getKpiEmbedBase();
    if (!base) {
      setPhase("fail");
      return;
    }
    let cancelled = false;
    setPhase("checking");
    const ctrl = new AbortController();
    const t = window.setTimeout(() => ctrl.abort(), 10_000);
    fetch(`${base.replace(/\/+$/, "")}/api/health`, {
      method: "GET",
      mode: "cors",
      cache: "no-store",
      signal: ctrl.signal,
    })
      .then((r) => {
        if (!cancelled) setPhase(r.ok ? "ok" : "fail");
      })
      .catch(() => {
        if (!cancelled) setPhase("fail");
      })
      .finally(() => window.clearTimeout(t));
    return () => {
      cancelled = true;
      ctrl.abort();
    };
  }, [bump]);

  if (phase === "checking" || phase === "ok") return null;

  const base = getKpiEmbedBase() || "http://127.0.0.1:5000";

  return (
    <div
      className="decide-app-kpi-flask-connectivity-banner"
      role="alert"
      style={{
        marginBottom: 12,
        padding: "12px 14px",
        borderRadius: 12,
        border: "1px solid rgba(248,113,113,0.45)",
        background: "rgba(127,29,29,0.35)",
        color: "#fecaca",
        fontSize: 13,
        lineHeight: 1.55,
        maxWidth: "min(100%, 720px)",
      }}
    >
      <strong style={{ color: "#fff" }}>Serviço de KPIs (Flask) inacessível.</strong> O painel abaixo fica vazio ou a
      carregar sem fim se o simulador não estiver a correr.
      <ul style={{ margin: "10px 0 0 0", paddingLeft: 18 }}>
        <li>
          Em desenvolvimento: na raiz do repositório, arranque{" "}
          <code style={{ color: "#e2e8f0" }}>python kpi_server.py</code> (ou o comando que usa a porta{" "}
          <strong style={{ color: "#fff" }}>5000</strong>).
        </li>
        <li>
          Confirme <code style={{ color: "#e2e8f0" }}>NEXT_PUBLIC_KPI_EMBED_BASE</code> no{" "}
          <code style={{ color: "#e2e8f0" }}>.env.local</code> do frontend — esperado algo como{" "}
          <code style={{ color: "#e2e8f0" }}>{base}</code>.
        </li>
        <li>
          Depois de arrancar o Flask, use <strong style={{ color: "#fff" }}>Atualizar recomendação</strong> no topo.
        </li>
      </ul>
    </div>
  );
}
