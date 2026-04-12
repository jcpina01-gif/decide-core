import { useEffect, useState } from "react";
import type { KpiFlaskHealthDebug } from "../lib/kpiFlaskHealthTypes";
import { getKpiEmbedBase, getKpiEmbedBaseForIframe } from "../lib/kpiEmbedNav";
import { isKpiFlaskBuildAcceptable, kpiFlaskMinBuildToken } from "../lib/kpiFlaskBuildGate";

type Props = {
  /** Muda quando o utilizador carrega «Atualizar recomendação» — volta a testar o Flask. */
  bump?: number;
};

type HealthPhase = "checking" | "ok" | "fail" | "stale";

/**
 * Aviso quando o browser não consegue falar com o serviço Flask dos KPIs (tipicamente :5000 parado),
 * ou quando o Flask responde mas é uma **versão antiga** (KPIs / rótulos errados no iframe).
 */
export default function KpiFlaskConnectivityBanner({ bump = 0 }: Props) {
  const [phase, setPhase] = useState<HealthPhase>("checking");
  const [reportedBuild, setReportedBuild] = useState<string | null>(null);
  /** Código/detalhe devolvido por `/api/kpi-flask-health` (ex. porta 5000 não é o Decide KPI). */
  const [healthDetail, setHealthDetail] = useState<string | null>(null);
  const [healthDebug, setHealthDebug] = useState<KpiFlaskHealthDebug | null>(null);

  useEffect(() => {
    const base = getKpiEmbedBaseForIframe();
    if (!base) {
      setPhase("fail");
      return;
    }
    let cancelled = false;
    setPhase("checking");
    setReportedBuild(null);
    setHealthDetail(null);
    setHealthDebug(null);
    const ctrl = new AbortController();
    const t = window.setTimeout(() => ctrl.abort(), 10_000);
    /**
     * Health via rota Next (`kpiServerBaseUrlForServer` → Flask em :5000 ou URL absoluta em env).
     * O pedido directo do browser a `/kpi-flask/api/health` falha frequentemente a expor JSON/`build`
     * (rewrite do middleware); o Node fala directamente com o Flask.
     */
    fetch("/api/kpi-flask-health", {
      method: "GET",
      cache: "no-store",
      signal: ctrl.signal,
    })
      .then(async (r) => {
        if (cancelled) return;
        if (!r.ok) {
          setPhase("fail");
          return;
        }
        let j: { reachable?: unknown; build?: unknown; error?: unknown; debug?: unknown };
        try {
          j = (await r.json()) as typeof j;
        } catch {
          setPhase("fail");
          return;
        }
        const dbg = j?.debug;
        if (dbg && typeof dbg === "object" && dbg !== null) {
          setHealthDebug(dbg as KpiFlaskHealthDebug);
        }
        const err =
          typeof j?.error === "string" && j.error.trim() ? j.error.trim() : null;
        if (err) setHealthDetail(err);
        const reachable = j?.reachable === true;
        const resolved =
          typeof j?.build === "string" && j.build.trim() ? j.build.trim() : undefined;
        setReportedBuild(resolved ?? null);
        if (!reachable) {
          setPhase("fail");
          return;
        }
        if (isKpiFlaskBuildAcceptable(resolved)) {
          setPhase("ok");
          return;
        }
        setPhase("stale");
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

  const raw = getKpiEmbedBase();
  const forIframe = getKpiEmbedBaseForIframe();
  const sameOriginMisconfig = Boolean(raw && !forIframe);
  const base = forIframe || raw || "http://127.0.0.1:5000";
  const minTok = kpiFlaskMinBuildToken();

  if (phase === "stale") {
    return (
      <div
        className="decide-app-kpi-flask-connectivity-banner decide-app-kpi-flask-stale-banner"
        role="alert"
        style={{
          marginBottom: 12,
          padding: "12px 14px",
          borderRadius: 12,
          border: "1px solid rgba(251,191,36,0.55)",
          background: "rgba(120,53,15,0.45)",
          color: "#fde68a",
          fontSize: 13,
          lineHeight: 1.55,
          maxWidth: "min(100%, 720px)",
        }}
      >
        <strong style={{ color: "#fff" }}>Flask de KPIs desactualizado.</strong> O iframe abaixo pode mostrar KPIs
        errados («Modelo teórico», benchmark ~0%, duplicados). O pedido interno{" "}
        <code style={{ color: "#fef3c7" }}>/api/kpi-flask-health</code> (Next → Flask na URL configurada para o KPI)
        reportou build{" "}
        <code style={{ color: "#fef3c7" }}>{reportedBuild ?? "(sem build)"}</code>
        {" "}
        (iframe: <code style={{ color: "#fef3c7" }}>{base}</code>).
        {minTok ? (
          <>
            {" "}
            Em dev o dashboard espera o build a incluir <code style={{ color: "#fef3c7" }}>{minTok}</code> (ou define{" "}
            <code style={{ color: "#fef3c7" }}>NEXT_PUBLIC_KPI_FLASK_MIN_BUILD</code> no <code style={{ color: "#fef3c7" }}>.env.local</code>).
          </>
        ) : null}
        <ul style={{ margin: "10px 0 0 0", paddingLeft: 18 }}>
          <li>
            Para na porta <strong style={{ color: "#fff" }}>5000</strong> o processo antigo, depois na{" "}
            <strong style={{ color: "#fff" }}>raiz do decide-core</strong> onde está o <code style={{ color: "#fef3c7" }}>kpi_server.py</code>{" "}
            actual: <code style={{ color: "#fef3c7" }}>npm run kpi</code>.
          </li>
          <li>
            Confirma <code style={{ color: "#fef3c7" }}>DECIDE_PROJECT_ROOT</code> / <code style={{ color: "#fef3c7" }}>DECIDE_KPI_REPO_ROOT</code>{" "}
            — não apontem para um clone sem <code style={{ color: "#fef3c7" }}>freeze/…/model_outputs_from_clone</code>.
          </li>
          <li>
            Clica <strong style={{ color: "#fff" }}>Atualizar recomendação</strong> depois de reiniciar o Flask.
          </li>
        </ul>
      </div>
    );
  }

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
      {healthDetail ? (
        <p style={{ margin: "10px 0 0 0", color: "#fda4af" }}>
          Diagnóstico: <code style={{ color: "#fecaca" }}>{healthDetail}</code>
          {healthDetail === "port_may_not_be_decide_kpi_flask" ? (
            <>
              {" "}
              — na porta 5000 pode estar outra aplicação. Garante que só o <code style={{ color: "#fecaca" }}>kpi_server</code>{" "}
              do decide-core escuta aí.
            </>
          ) : null}
          {healthDetail === "health_body_not_json" ? (
            <>
              {" "}
              — a resposta de <code style={{ color: "#fecaca" }}>/api/health</code> no Flask não é JSON válido (proxy ou
              serviço errado). Confirma <code style={{ color: "#fecaca" }}>KPI_SERVER_INTERNAL_BASE</code> / env.
            </>
          ) : null}
          {healthDetail === "kpi_health_missing_build" ? (
            <>
              {" "}
              — o processo em <code style={{ color: "#fecaca" }}>{healthDebug?.probeUrl || "…/api/health"}</code>{" "}
              respondeu 200 mas <strong style={{ color: "#fff" }}>sem</strong> campo{" "}
              <code style={{ color: "#fecaca" }}>build</code> nem header{" "}
              <code style={{ color: "#fecaca" }}>X-Decide-Kpi-Build</code>. É quase de certeza um{" "}
              <strong style={{ color: "#fff" }}>kpi_server.py antigo</strong> ou outro serviço. Para o processo nessa
              porta e corre <code style={{ color: "#fecaca" }}>npm run kpi</code> na raiz do decide-core.
            </>
          ) : null}
        </p>
      ) : null}
      {healthDetail === "kpi_health_missing_build" && healthDebug ? (
        <pre
          style={{
            marginTop: 10,
            padding: "10px 12px",
            borderRadius: 8,
            background: "rgba(0,0,0,0.35)",
            color: "#e2e8f0",
            fontSize: 11,
            lineHeight: 1.45,
            overflow: "auto",
            maxHeight: 140,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}
        >
          {JSON.stringify(healthDebug, null, 2)}
        </pre>
      ) : null}
      <ul style={{ margin: "10px 0 0 0", paddingLeft: 18 }}>
        <li>
          Em desenvolvimento: na raiz do repositório,{" "}
          <code style={{ color: "#e2e8f0" }}>npm run kpi</code> (pasta <code style={{ color: "#e2e8f0" }}>backend</code>) ou{" "}
          <code style={{ color: "#e2e8f0" }}>python kpi_server.py</code> — porta{" "}
          <strong style={{ color: "#fff" }}>5000</strong>. Se abres o dashboard pelo IP Wi‑Fi (ex.{" "}
          <code style={{ color: "#e2e8f0" }}>192.168…</code>), arranca o Flask em todas as interfaces:{" "}
          <code style={{ color: "#e2e8f0" }}>DECIDE_KPI_LAN=1 npm run kpi</code> (Windows PowerShell:{" "}
          <code style={{ color: "#e2e8f0" }}>$env:DECIDE_KPI_LAN=&quot;1&quot;; npm run kpi</code>).
        </li>
        <li>
          <code style={{ color: "#e2e8f0" }}>NEXT_PUBLIC_KPI_EMBED_BASE=/kpi-flask</code> — em dev o middleware envia
          para <code style={{ color: "#e2e8f0" }}>127.0.0.1:5000</code>; em produção defina também{" "}
          <code style={{ color: "#e2e8f0" }}>KPI_EMBED_UPSTREAM</code> (URL absoluta do Flask) e{" "}
          <code style={{ color: "#e2e8f0" }}>KPI_SERVER_INTERNAL_BASE</code> igual ao upstream para o diagnóstico
          <code style={{ color: "#e2e8f0" }}>/api/kpi-flask-health</code>.
          {sameOriginMisconfig ? (
            <>
              {" "}
              <strong style={{ color: "#fff" }}>Detecção:</strong> a variável aponta para o mesmo domínio que a app —
              o browser pede <code style={{ color: "#e2e8f0" }}>/?client_embed=1</code> ao Next e recebe{" "}
              <strong style={{ color: "#fff" }}>404</strong>.
            </>
          ) : null}{" "}
          Exemplo: <code style={{ color: "#e2e8f0" }}>{base}</code>.
        </li>
        <li>
          Depois de arrancar o Flask, use <strong style={{ color: "#fff" }}>Atualizar recomendação</strong> no topo.
        </li>
      </ul>
    </div>
  );
}
