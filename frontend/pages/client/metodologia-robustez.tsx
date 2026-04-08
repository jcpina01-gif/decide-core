import type { GetServerSideProps } from "next";

import Head from "next/head";

import Link from "next/link";

import React, { useEffect } from "react";

import DecideClientShell from "../../components/DecideClientShell";

import { DECIDE_APP_PAGE_BG, DECIDE_DASHBOARD } from "../../lib/decideClientTheme";

import {

  MODEL_ROBUSTNESS_DISCLAIMER,

  MODEL_ROBUSTNESS_EXPAND_TITLE,

  MODEL_ROBUSTNESS_METHODOLOGY_EXAMPLE_BULLETS,

  MODEL_ROBUSTNESS_TECH_TITLE,

  modelRobustnessClosingLine,

  modelRobustnessTechParagraphs,

} from "../../lib/modelRobustnessCopy";



const h1: React.CSSProperties = {

  margin: 0,

  fontSize: 22,

  fontWeight: 900,

  color: "var(--text-primary)",

};



const h2: React.CSSProperties = {

  margin: "24px 0 10px",

  fontSize: 15,

  fontWeight: 800,

  color: "#e4e4e7",

};



const p: React.CSSProperties = {

  margin: "0 0 12px",

  fontSize: 14,

  lineHeight: 1.6,

  color: "#d4d4d8",

};



type PageProps = {

  embeddedFullSeriesCagrPt: string | null;

};



export const getServerSideProps: GetServerSideProps<PageProps> = async () => {
  const pathMod = await import("path");
  const frontRoot = process.cwd();
  const projectRoot = pathMod.resolve(frontRoot, "..");

  const { fetchPlafonadoKpisFromKpiServer } = await import(
    "../../lib/server/fetchPlafonadoCagrFromKpiServer"
  );
  const { readPlafonadoM100CagrDisplayPercent, readLandingEmbeddedFreezeCap15CagrDisplayPercent } =
    await import("../../lib/server/readPlafonadoFreezeCagr");

  /** Mesma prioridade que o relatório Plano / cartão CAGR: KPI vivo → freeze repo → CSV embebido na build (fallback). */
  const fromKpi = await fetchPlafonadoKpisFromKpiServer("moderado");
  const pctRaw =
    fromKpi?.cagrPct ??
    readPlafonadoM100CagrDisplayPercent(projectRoot, "moderado") ??
    readLandingEmbeddedFreezeCap15CagrDisplayPercent(frontRoot, "moderado");

  const embeddedFullSeriesCagrPt =
    pctRaw != null && Number.isFinite(pctRaw)
      ? pctRaw.toLocaleString("pt-PT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      : null;

  return { props: { embeddedFullSeriesCagrPt } };
};



export default function MetodologiaRobustezPage({ embeddedFullSeriesCagrPt }: PageProps) {

  const techParagraphs = modelRobustnessTechParagraphs({ embeddedFullSeriesCagrPt });



  useEffect(() => {

    document.documentElement.style.background = DECIDE_APP_PAGE_BG;

    document.body.style.background = DECIDE_APP_PAGE_BG;

  }, []);



  return (

    <>

      <Head>

        <title>Metodologia — testes de robustez | DECIDE</title>

      </Head>

      <DecideClientShell showClientNav={false} maxWidth={720} padding="20px max(16px, 3vw) 48px">

        <nav style={{ marginBottom: 14 }} aria-label="Navegação secundária">

          <Link href="/client-dashboard" style={{ color: DECIDE_DASHBOARD.link, fontWeight: 700, fontSize: 13 }}>

            ← Dashboard

          </Link>

        </nav>

        <h1 style={h1}>{MODEL_ROBUSTNESS_TECH_TITLE}</h1>

        <p style={{ ...p, marginTop: 10, fontSize: 13, color: "#a1a1aa" }}>

          Documento de apoio à comunicação institucional sobre validação do modelo.

        </p>



        {techParagraphs.map((para, i) => (

          <p key={i} style={p}>

            {para}

          </p>

        ))}



        <h2 style={h2}>{MODEL_ROBUSTNESS_EXPAND_TITLE}</h2>

        <p style={{ ...p, marginBottom: 8, fontSize: 12, color: "#a1a1aa" }}>

          Exemplo alinhado ao perfil Moderado; no dashboard, os detalhes seguem o perfil activo e o horizonte do

          simulador.

        </p>

        <ul style={{ ...p, paddingLeft: 20, marginTop: 0 }}>

          {MODEL_ROBUSTNESS_METHODOLOGY_EXAMPLE_BULLETS.map((line, i) => (

            <li key={i} style={{ marginBottom: 8 }}>

              {line}

            </li>

          ))}

        </ul>

        <p style={p}>{modelRobustnessClosingLine()}</p>



        <p

          style={{

            ...p,

            marginTop: 28,

            paddingTop: 16,

            borderTop: "1px solid rgba(63, 63, 70, 0.75)",

            fontSize: 13,

            fontStyle: "italic",

            color: "#a1a1aa",

          }}

        >

          {MODEL_ROBUSTNESS_DISCLAIMER}

        </p>

      </DecideClientShell>

    </>

  );

}


