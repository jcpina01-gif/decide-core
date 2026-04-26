import Head from "next/head";
import type { GetServerSideProps } from "next";
import React from "react";
import RecommendationsHistoryPanel from "../../components/RecommendationsHistoryPanel";

/**
 * Vista mínima para iframe dentro do painel Flask (kpi_server) — separador «Histórico de carteiras».
 * `Cache-Control: no-store` + query `?v=` no iframe a evitar HTML/JS antigo após deploy.
 */
export const getServerSideProps: GetServerSideProps = async ({ res }) => {
  res.setHeader("Cache-Control", "private, no-store, max-age=0, must-revalidate");
  return { props: {} };
};

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
          background: "#09090b",
          padding: "8px 10px 20px",
        }}
      >
        <RecommendationsHistoryPanel />
      </div>
    </>
  );
}
