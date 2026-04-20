import Link from "next/link";
import { useRouter } from "next/router";
import { useCallback, useEffect, useState } from "react";
import InlineLoadingDots from "./InlineLoadingDots";
import { CLIENT_SESSION_CHANGED_EVENT } from "../lib/clientAuth";
import { DECIDE_DASHBOARD_KPI_REFRESH_EVENT } from "../lib/decideDashboardEvents";
import { DECIDE_CAGR_INCLUDES_MARKET_COSTS_PT } from "../lib/modelRobustnessCopy";
import { clientReportHrefFromQuery } from "../lib/clientPlanDailyEntryQuery";

type PlanKpisOk = {
  ok: true;
  recommendedModelLabel?: string;
  recommendedCagrPct?: number | null;
  historyYearRangeLabel?: string | null;
  activityPct?: number;
};

type PlanKpisErr = { ok: false; error: string };

function fmtPctPt(value: number): string {
  return new Intl.NumberFormat("pt-PT", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

type Props = {
  /** Alinhado ao selector de perfil do dashboard / iframe Flask (`profile=`). */
  riskProfile?: "conservador" | "moderado" | "dinamico";
};

function riskProfileLabelPt(profile: NonNullable<Props["riskProfile"]>): string {
  switch (profile) {
    case "conservador":
      return "Conservador";
    case "dinamico":
      return "Dinâmico";
    default:
      return "Moderado";
  }
}

/** Expectativa de risco curta, alinhada ao perfil — contextualiza o CAGR histórico. */
function riskVolatilityHintPt(profile: NonNullable<Props["riskProfile"]>): string {
  switch (profile) {
    case "conservador":
      return "Menor risco e volatilidade";
    case "dinamico":
      return "Maior risco e volatilidade";
    default:
      return "Risco e volatilidade moderados";
  }
}

function recommendedPlanStrategyLinePt(profile: NonNullable<Props["riskProfile"]>): string {
  switch (profile) {
    case "conservador":
      return "Estratégia com foco em preservação e volatilidade contida; exposição a risco ≤ 100% do NAV.";
    case "dinamico":
      return "Estratégia com maior objectivo de volatilidade e potencial de retorno; exposição a risco ≤ 100% do NAV.";
    default:
      return "Estratégia equilibrada entre crescimento e controlo de risco; exposição a risco ≤ 100% do NAV.";
  }
}

/**
 * Dashboard KPIs: plano recomendado (CAGR histórico, CTA). Carteira IBKR na página Carteira.
 */
export default function DecideRecommendedPlanCta({
  riskProfile = "moderado",
}: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<PlanKpisOk | null>(null);
  const [planNavPending, setPlanNavPending] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const rPlan = await fetch(
        `/api/client/plan-decision-kpis?profile=${encodeURIComponent(riskProfile)}`,
        { credentials: "same-origin", cache: "no-store" },
      );
      const j = (await rPlan.json()) as PlanKpisOk | PlanKpisErr;
      if (j && typeof j === "object" && j.ok === true) {
        setData(j);
      } else {
        setData(null);
      }
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [riskProfile]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const onRefresh = () => void load();
    window.addEventListener(DECIDE_DASHBOARD_KPI_REFRESH_EVENT, onRefresh);
    window.addEventListener(CLIENT_SESSION_CHANGED_EVENT, onRefresh);
    return () => {
      window.removeEventListener(DECIDE_DASHBOARD_KPI_REFRESH_EVENT, onRefresh);
      window.removeEventListener(CLIENT_SESSION_CHANGED_EVENT, onRefresh);
    };
  }, [load]);

  useEffect(() => {
    const onErr = () => setPlanNavPending(false);
    router.events?.on("routeChangeError", onErr);
    return () => router.events?.off("routeChangeError", onErr);
  }, [router]);

  const modelLabel = data?.recommendedModelLabel ?? "Modelo CAP15";
  const cagrPct = data?.recommendedCagrPct;
  const showCagr = typeof cagrPct === "number" && Number.isFinite(cagrPct);
  const yearRange =
    typeof data?.historyYearRangeLabel === "string" && data.historyYearRangeLabel.trim().length > 0
      ? data.historyYearRangeLabel.trim()
      : null;
  const profileLabel = riskProfileLabelPt(riskProfile);
  const riskHint = riskVolatilityHintPt(riskProfile);
  const strategyLine = recommendedPlanStrategyLinePt(riskProfile);

  return (
    <section className="decide-app-recommended-plan" aria-labelledby="decide-plan-title">
      <div className="decide-app-recommended-plan-inner">
        <div className="decide-app-recommended-plan-col decide-app-recommended-plan-col--decision">
          <div className="decide-app-recommended-plan-decision-panel decide-app-recommended-plan-decision-panel--emphasis">
            <div className="decide-app-recommended-plan-decision-body">
              <div className="decide-app-recommended-plan-decision-copy">
                <p className="decide-app-recommended-plan-kicker decide-app-recommended-plan-kicker--sentence">
                  Plano recomendado para o seu perfil {profileLabel}
                </p>
                <h2 id="decide-plan-title" className="decide-app-recommended-plan-title">
                  {modelLabel}
                </h2>
                <p className="decide-app-recommended-plan-model-strategy">{strategyLine}</p>
                <p className="decide-app-recommended-plan-cagr-costs-notice">{DECIDE_CAGR_INCLUDES_MARKET_COSTS_PT}</p>
              </div>
              <div className="decide-app-recommended-plan-decision-metric-col">
                <div className="decide-app-recommended-plan-metric" aria-live="polite">
                  {loading ? (
                    <span className="decide-app-recommended-plan-metric-muted" role="status">
                      A carregar
                      <InlineLoadingDots />
                    </span>
                  ) : showCagr ? (
                    <>
                      <p className="decide-app-recommended-plan-cagr-human">
                        <span className="decide-app-recommended-plan-cagr-human-label">
                          Rentabilidade anual (histórica)
                        </span>
                      </p>
                      <p className="decide-app-recommended-plan-cagr-value-line">
                        <span className="decide-app-recommended-plan-cagr-value">{fmtPctPt(cagrPct)}%</span>
                      </p>
                      {yearRange ? (
                        <p className="decide-app-recommended-plan-context">
                          Baseado em histórico do {modelLabel} ({yearRange})
                        </p>
                      ) : null}
                      <p className="decide-app-recommended-plan-risk-hint">{riskHint}</p>
                    </>
                  ) : (
                    <span className="decide-app-recommended-plan-metric-muted">
                      Indicadores completos no simulador abaixo
                    </span>
                  )}
                </div>
              </div>
            </div>

            {!loading ? (
              <div className="decide-app-recommended-plan-decision-footer">
                <div className="decide-app-recommended-plan-decision-footer-copy">
                  <p className="decide-app-recommended-plan-momentum-note">
                    Uma parte dos retornos ocorre em períodos curtos de forte valorização.
                  </p>
                  <p className="decide-app-recommended-plan-adjust-note">
                    Esta recomendação pode ser ajustada antes de qualquer execução.
                  </p>
                </div>
                <div className="decide-app-recommended-plan-decision-footer-cta">
                  <div className="decide-app-recommended-plan-cta-wrap decide-app-recommended-plan-cta-wrap--panel-right">
                    <Link
                      href={clientReportHrefFromQuery({}, "daily_entry")}
                      className="decide-app-recommended-plan-cta"
                      aria-busy={planNavPending}
                      style={
                        planNavPending
                          ? { opacity: 0.88, pointerEvents: "none" as const, cursor: "wait" }
                          : undefined
                      }
                      onClick={() => setPlanNavPending(true)}
                    >
                      {planNavPending ? (
                        <>
                          A abrir
                          <InlineLoadingDots />
                        </>
                      ) : (
                        "Ver plano detalhado"
                      )}
                    </Link>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}
