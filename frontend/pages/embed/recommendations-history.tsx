import Head from "next/head";
import React from "react";
import RecommendationsHistoryPanel from "../../components/RecommendationsHistoryPanel";

/**
 * Vista mínima para iframe dentro do painel Flask (kpi_server) — separador «Histórico de carteiras».
 */
export default function EmbedRecommendationsHistoryPage() {
  return (
    <>
      <Head>
        <title>DECIDE — Histórico de decisões da carteira</title>
        <meta name="robots" content="noindex,nofollow" />
      </Head>
      <div
        style={{
          minHeight: "100vh",
          boxSizing: "border-box",
          background: "#0b1220",
          padding: "8px 10px 20px",
        }}
      >
        <RecommendationsHistoryPanel />
      </div>
    </>
  );
}
