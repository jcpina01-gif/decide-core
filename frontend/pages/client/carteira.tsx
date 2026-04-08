import Head from "next/head";
import { useCallback, useEffect, useRef, useState } from "react";
import ClientKpiEmbedWorkspace from "../../components/ClientKpiEmbedWorkspace";
import ClientKpiPageChrome from "../../components/ClientKpiPageChrome";
import { DECIDE_DASHBOARD_KPI_REFRESH_EVENT } from "../../lib/decideDashboardEvents";
import { useClientKpiEmbed } from "../../hooks/useClientKpiEmbed";
import { isClientLoggedIn } from "../../lib/clientAuth";
import { DECIDE_DASHBOARD } from "../../lib/decideClientTheme";
import { useSyncedRiskProfileFromOnboarding } from "../../hooks/useSyncedRiskProfileFromOnboarding";
import InlineLoadingDots from "../../components/InlineLoadingDots";
import { FLASK_KPI_EMBED_TABS, normalizeKpiEmbedTabId } from "../../lib/kpiEmbedNav";

/**
 * Carteira (navegação global no topo) — sub-menu local só IBKR: Carteira actual / Histórico (+ Custos / Fiscalidade / Ajuda).
 * KPIs / Gráficos / Simulação ficam no Dashboard. Estado `embed_tab` partilhado com `/client-dashboard` via session/query.
 */
export default function ClientCarteiraPage() {
  const [loggedIn, setLoggedIn] = useState(false);
  const { profile, setProfile } = useSyncedRiskProfileFromOnboarding();
  const [iframeRefresh, setIframeRefresh] = useState(0);
  const [kpiToolbarRefreshBusy, setKpiToolbarRefreshBusy] = useState(false);
  const kpiRefreshSafetyRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    setLoggedIn(isClientLoggedIn());
  }, []);

  const kpi = useClientKpiEmbed({ profile, loggedIn, iframeRefresh });

  const clearKpiToolbarRefreshBusy = useCallback(() => {
    if (kpiRefreshSafetyRef.current != null) {
      window.clearTimeout(kpiRefreshSafetyRef.current);
      kpiRefreshSafetyRef.current = undefined;
    }
    setKpiToolbarRefreshBusy(false);
  }, []);

  function refreshAnalysis() {
    clearKpiToolbarRefreshBusy();
    setKpiToolbarRefreshBusy(true);
    setIframeRefresh(Date.now());
    try {
      window.dispatchEvent(new Event(DECIDE_DASHBOARD_KPI_REFRESH_EVENT));
    } catch {
      /* ignore */
    }
    const expectsIframeReload =
      Boolean(kpi.kpiIframeSrc) &&
      (FLASK_KPI_EMBED_TABS.has(normalizeKpiEmbedTabId(kpi.kpiEmbedTab)) ||
        normalizeKpiEmbedTabId(kpi.kpiEmbedTab) === "fees_intro" ||
        normalizeKpiEmbedTabId(kpi.kpiEmbedTab) === "fees");
    kpiRefreshSafetyRef.current = window.setTimeout(
      () => clearKpiToolbarRefreshBusy(),
      expectsIframeReload ? 55_000 : 2_500,
    );
  }

  return (
    <>
      <Head>
        <title>Carteira | DECIDE</title>
      </Head>
      <ClientKpiPageChrome
        title="Carteira"
        toolbar={
          <>
            <label htmlFor="carteira-embed-profile" style={{ color: "#a1a1aa", fontSize: 12, fontWeight: 700 }}>
              Perfil de risco
            </label>
            <select
              id="carteira-embed-profile"
              value={profile}
              onChange={(e) => setProfile(e.target.value as "conservador" | "moderado" | "dinamico")}
              style={{
                background: "rgba(39,39,42,0.85)",
                color: "#fff",
                border: "1px solid rgba(255,255,255,0.2)",
                borderRadius: 12,
                padding: "8px 14px",
                fontWeight: 800,
                fontSize: 14,
                cursor: "pointer",
              }}
            >
              <option value="conservador">Conservador</option>
              <option value="moderado">Moderado</option>
              <option value="dinamico">Dinâmico</option>
            </select>
            <button
              type="button"
              onClick={refreshAnalysis}
              disabled={kpiToolbarRefreshBusy}
              aria-busy={kpiToolbarRefreshBusy}
              title="Atualizar recomendação e indicadores do simulador (o iframe KPI pode demorar a responder)"
              style={{
                background: DECIDE_DASHBOARD.refreshButton,
                color: DECIDE_DASHBOARD.refreshText,
                border: DECIDE_DASHBOARD.kpiMenuMainButtonBorder,
                borderRadius: 12,
                padding: "8px 14px",
                fontSize: 13,
                fontWeight: 800,
                cursor: kpiToolbarRefreshBusy ? "wait" : "pointer",
                opacity: kpiToolbarRefreshBusy ? 0.88 : 1,
                boxShadow: DECIDE_DASHBOARD.kpiMenuMainButtonShadow,
              }}
            >
              {kpiToolbarRefreshBusy ? (
                <>
                  A atualizar
                  <InlineLoadingDots />
                </>
              ) : (
                "Atualizar recomendação"
              )}
            </button>
          </>
        }
      >
        <ClientKpiEmbedWorkspace
          workspaceVariant="carteira"
          chrome="navLinked"
          riskProfile={profile}
          kpiEmbedTab={kpi.kpiEmbedTab}
          applyKpiEmbedTab={kpi.applyKpiEmbedTab}
          kpiViewMode={kpi.kpiViewMode}
          setKpiViewMode={kpi.setKpiViewMode}
          kpiIframeSrc={kpi.kpiIframeSrc}
          kpiIframeRef={kpi.kpiIframeRef}
          onKpiIframeReady={clearKpiToolbarRefreshBusy}
          kpiConnectivityBump={iframeRefresh}
          carteiraIbkrRefreshToken={iframeRefresh}
        />
      </ClientKpiPageChrome>
    </>
  );
}
