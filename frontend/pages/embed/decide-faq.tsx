import Head from "next/head";
import React from "react";
import DecideFaqPanel from "../../components/DecideFaqPanel";

/**
 * Vista mínima para iframe no painel Flask (kpi_server) — separador «FAQs» junto a KPIs, Simulador, …
 */
export default function EmbedDecideFaqPage() {
  return (
    <>
      <Head>
        <title>DECIDE — FAQs</title>
        <meta name="robots" content="noindex,nofollow" />
      </Head>
      <div
        style={{
          minHeight: "100vh",
          boxSizing: "border-box",
          background: "#09090b",
          padding: "12px 14px 28px",
        }}
      >
        <DecideFaqPanel />
      </div>
    </>
  );
}
