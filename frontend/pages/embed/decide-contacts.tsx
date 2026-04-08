import Head from "next/head";
import React from "react";
import {
  DECIDE_CONTACTS_COPY_AFTER_EMAIL,
  DECIDE_CONTACTS_COPY_BEFORE_EMAIL,
  DECIDE_SUPPORT_EMAIL,
} from "../../lib/decideSupportContact";
import { DECIDE_APP_FONT_FAMILY } from "../../lib/decideClientTheme";

/** Página embed autónoma (ex.: bookmark); o dashboard usa o mesmo email em linha. */
export default function EmbedDecideContactsPage() {
  return (
    <>
      <Head>
        <title>DECIDE — Contactos</title>
        <meta name="robots" content="noindex,nofollow" />
      </Head>
      <div
        style={{
          minHeight: "100vh",
          boxSizing: "border-box",
          background: "#09090b",
          padding: "22px 24px 32px",
          color: "#d4d4d8",
          fontFamily: DECIDE_APP_FONT_FAMILY,
          fontSize: 15,
          lineHeight: 1.65,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div style={{ width: "100%", maxWidth: "100%", overflowX: "auto", textAlign: "center" }}>
          <p
            style={{
              margin: 0,
              display: "inline-block",
              whiteSpace: "nowrap",
            }}
          >
            {DECIDE_CONTACTS_COPY_BEFORE_EMAIL}
            <a
              href={`mailto:${DECIDE_SUPPORT_EMAIL}`}
              style={{ fontWeight: 800, color: "#d4d4d4", textDecoration: "none" }}
            >
              {DECIDE_SUPPORT_EMAIL}
            </a>
            {DECIDE_CONTACTS_COPY_AFTER_EMAIL}
          </p>
        </div>
      </div>
    </>
  );
}
