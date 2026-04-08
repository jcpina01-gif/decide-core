/**
 * Disparar após atualizar o iframe KPI / dados do plano — o bloco resumo do dashboard
 * (`DecideRecommendedPlanCta`) deve voltar a pedir dados.
 *
 * Mantém o mesmo nome de evento histórico (`decide-hero-kpi-refresh`) para não partir
 * chamadas existentes.
 */
export const DECIDE_DASHBOARD_KPI_REFRESH_EVENT = "decide-hero-kpi-refresh";
