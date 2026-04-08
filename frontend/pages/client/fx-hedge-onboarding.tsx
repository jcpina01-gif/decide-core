import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import React, { useEffect, useMemo, useState } from "react";
import OnboardingFlowBar, { ONBOARDING_LOCALSTORAGE_CHANGED_EVENT } from "../../components/OnboardingFlowBar";
import { isClientLoggedIn } from "../../lib/clientAuth";
import { isFxHedgeOnboardingApplicable } from "../../lib/clientSegment";
import DecideClientShell from "../../components/DecideClientShell";
import {
  DECIDE_APP_FONT_FAMILY,
  DECIDE_DASHBOARD,
  DECIDE_ONBOARDING,
  ONBOARDING_PRIMARY_CTA_MAX_WIDTH_PX,
  ONBOARDING_SHELL_MAX_WIDTH_PX,
} from "../../lib/decideClientTheme";
import {
  RESIDENCE_OPTIONS,
  fxPairChoicesForResidence,
  type FxHedgePairId,
} from "../../lib/fxHedgePairs";
import {
  readFxHedgePrefs,
  setHedgeOnboardingDone,
  writeFxHedgePrefs,
  type HedgePctOption,
} from "../../lib/fxHedgePrefs";
import { getNextOnboardingHref } from "../../lib/onboardingProgress";

export default function FxHedgeOnboardingPage() {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [residence, setResidence] = useState("PT");
  const [pair, setPair] = useState<FxHedgePairId>("EURUSD");
  const [pct, setPct] = useState<HedgePctOption>(100);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;
    if (!isClientLoggedIn()) {
      window.location.href = "/client/login";
      return;
    }
    if (!isFxHedgeOnboardingApplicable()) {
      window.location.href = "/client-dashboard";
      return;
    }
    const prev = readFxHedgePrefs();
    if (prev) {
      setPair(prev.pair);
      setPct(prev.pct);
      if (prev.residenceCountry) setResidence(prev.residenceCountry);
    }
  }, [mounted]);

  const pairChoices = useMemo(() => fxPairChoicesForResidence(residence), [residence]);

  const residenceLabel = useMemo(
    () => RESIDENCE_OPTIONS.find((o) => o.code === residence)?.label ?? residence,
    [residence],
  );

  const selectedPairLabel = useMemo(() => pairChoices.find((p) => p.id === pair)?.label ?? pair, [pairChoices, pair]);

  const hedgeSelectionHint = useMemo(() => {
    if (pct === 0) return "Sem hedge selecionado";
    if (pct === 50) return "Cobertura parcial (50%) selecionada";
    return "Cobertura total selecionada";
  }, [pct]);

  useEffect(() => {
    const ids = new Set(pairChoices.map((p) => p.id));
    if (!ids.has(pair)) {
      setPair(pairChoices[0]!.id);
    }
  }, [pairChoices, pair]);

  function saveAndContinue() {
    setMsg("");
    writeFxHedgePrefs({
      pair,
      pct,
      residenceCountry: residence,
    });
    setHedgeOnboardingDone(true);
    try {
      window.dispatchEvent(new Event(ONBOARDING_LOCALSTORAGE_CHANGED_EVENT));
    } catch {
      // ignore
    }
    void router.push(getNextOnboardingHref());
  }

  if (!mounted) {
    return (
      <>
        <Head>
          <title>Hedge cambial — DECIDE</title>
        </Head>
        <div
          style={{
            minHeight: "40vh",
            background: DECIDE_DASHBOARD.pageBg,
            color: DECIDE_DASHBOARD.textMuted,
            fontFamily: DECIDE_APP_FONT_FAMILY,
          }}
        />
      </>
    );
  }

  if (!isClientLoggedIn() || !isFxHedgeOnboardingApplicable()) {
    return null;
  }

  return (
    <>
      <Head>
        <title>Hedge cambial — DECIDE</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>
      <DecideClientShell
        showClientNav={false}
        maxWidth={ONBOARDING_SHELL_MAX_WIDTH_PX}
        padding="12px max(18px, 3.8vw) 16px"
        pageBackground={DECIDE_ONBOARDING.pageBackground}
        stickyBottomReservePx={140}
        stickyBottomBar={
          <div style={{ width: "100%" }}>
            {msg ? (
              <div style={{ color: "#fecaca", fontSize: 13, marginBottom: 10, textAlign: "center", lineHeight: 1.45 }}>{msg}</div>
            ) : null}
            <div
              style={{
                fontSize: 12,
                fontWeight: 700,
                color: "#d4d4d4",
                textAlign: "center",
                marginBottom: 10,
                letterSpacing: "0.02em",
              }}
            >
              {hedgeSelectionHint}
            </div>
            <button
              type="button"
              onClick={saveAndContinue}
              aria-label={
                pct === 0
                  ? "Guardar sem hedge nos indicadores e continuar o registo"
                  : "Guardar preferência de hedge e continuar o registo"
              }
              style={{
                width: "100%",
                maxWidth: ONBOARDING_PRIMARY_CTA_MAX_WIDTH_PX,
                margin: "0 auto",
                display: "block",
                boxSizing: "border-box",
                textAlign: "center",
                background: DECIDE_DASHBOARD.buttonRegister,
                color: DECIDE_DASHBOARD.kpiMenuMainButtonColor,
                border: DECIDE_DASHBOARD.kpiMenuMainButtonBorder,
                borderRadius: 14,
                padding: "14px 20px",
                fontSize: 16,
                fontWeight: 900,
                cursor: "pointer",
                boxShadow: DECIDE_DASHBOARD.kpiMenuMainButtonShadow,
              }}
            >
              Continuar para a corretora
            </button>
          </div>
        }
      >
        <div>
          <OnboardingFlowBar currentStepId="hedge" authStepHref="/client/login" compact />
          <p style={{ fontSize: 12, color: "#a1a1aa", marginBottom: 6 }}>
            <Link href={getNextOnboardingHref()} style={{ color: DECIDE_DASHBOARD.link }}>
              ← Voltar ao funil
            </Link>
          </p>
          <h1 style={{ fontSize: 26, fontWeight: 900, marginBottom: 8, letterSpacing: "-0.02em", lineHeight: 1.2 }}>
            Quer proteger a sua carteira das variações cambiais?
          </h1>
          <p style={{ color: "#e2e8f0", fontSize: 16, lineHeight: 1.55, marginBottom: 12, fontWeight: 600 }}>
            O hedge reduz o impacto do dólar (ou outras moedas) nos resultados que vê no dashboard — em{" "}
            <strong style={{ color: "#d4d4d4" }}>simulação</strong>, não na corretora.
          </p>

          <details
            style={{
              marginBottom: 14,
              borderRadius: 12,
              border: "1px solid rgba(51,65,85,0.85)",
              background: "rgba(15,23,42,0.45)",
              padding: "10px 14px",
            }}
          >
            <summary style={{ cursor: "pointer", fontSize: 13, fontWeight: 700, color: "#a1a1aa", listStyle: "none" }}>
              Saber mais — o que é isto, exactamente?
            </summary>
            <div style={{ marginTop: 12, fontSize: 12, color: "#a1a1aa", lineHeight: 1.6 }}>
              Clientes <strong style={{ color: "#cbd5e1" }}>fee B</strong> (NAV elevado) ou <strong style={{ color: "#cbd5e1" }}>Private</strong>{" "}
              escolhem como o <strong style={{ color: "#cbd5e1" }}>risco cambial</strong> é reflectido nos indicadores do
              dashboard (série do modelo ajustada ao par de referência).{" "}
              <strong style={{ color: "#cbd5e1" }}>Não envia ordens à IBKR</strong> — não compra nem vende moeda; não são
              forwards nem futuros. Um <strong style={{ color: "#cbd5e1" }}>hedge real na conta</strong> faz-se na corretora,
              com produtos próprios.
            </div>
          </details>

          <div
            style={{
              background: DECIDE_DASHBOARD.panelSlate,
              border: DECIDE_DASHBOARD.panelBorder,
              borderRadius: 16,
              padding: "16px 18px",
              marginBottom: 14,
            }}
          >
            <div style={{ fontSize: 14, fontWeight: 800, color: "#f1f5f9", marginBottom: 10 }}>Quanto deseja cobrir?</div>
            <div style={{ display: "grid", gap: 8 }}>
              {(
                [
                  {
                    n: 0 as const,
                    title: "Sem hedge",
                    badge: "0%",
                    line: "Mais volatilidade; mantém exposição cambial total nos indicadores.",
                  },
                  {
                    n: 50 as const,
                    title: "Cobertura parcial",
                    badge: "50%",
                    line: "Equilíbrio entre proteção ao câmbio e exposição.",
                  },
                  {
                    n: 100 as const,
                    title: "Cobertura total",
                    badge: "100%",
                    line: "Menos impacto do câmbio na simulação — resultados mais estáveis.",
                  },
                ] as const
              ).map(({ n, title, badge, line }) => (
                <label
                  key={n}
                  style={{
                    display: "flex",
                    gap: 14,
                    alignItems: "flex-start",
                    cursor: "pointer",
                    padding: "10px 14px",
                    borderRadius: 14,
                    border: pct === n ? "1px solid rgba(45,212,191,0.55)" : "1px solid rgba(63,63,70,0.75)",
                    background: pct === n ? "rgba(20,184,166,0.14)" : "rgba(39,39,42,0.45)",
                  }}
                >
                  <input type="radio" name="hedgepct" checked={pct === n} onChange={() => setPct(n)} style={{ marginTop: 4 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: 8 }}>
                      <span style={{ fontWeight: 900, color: "#f1f5f9", fontSize: 16 }}>{title}</span>
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 800,
                          color: "#d4d4d4",
                          letterSpacing: "0.04em",
                        }}
                      >
                        {badge}
                      </span>
                    </div>
                    <div style={{ fontSize: 12, color: "#a1a1aa", marginTop: 4, lineHeight: 1.45 }}>{line}</div>
                  </div>
                </label>
              ))}
            </div>
            <p style={{ fontSize: 12, color: "#71717a", marginTop: 10, lineHeight: 1.45 }}>
              Ajusta a <strong style={{ color: "#a1a1aa" }}>simulação de cobertura cambial</strong> nos resultados do
              dashboard; não executa operações na corretora.
            </p>
          </div>

          <p
            style={{
              fontSize: 14,
              color: "#cbd5e1",
              lineHeight: 1.55,
              marginBottom: 14,
              padding: "12px 14px",
              borderRadius: 12,
              background: "rgba(45,212,191,0.08)",
              border: "1px solid rgba(45,212,191,0.22)",
            }}
          >
            Baseado no seu país (<strong style={{ color: "#f1f5f9" }}>{residenceLabel}</strong>), usamos o par{" "}
            <strong style={{ color: "#d4d4d4" }}>{selectedPairLabel}</strong> na simulação dos seus indicadores «com hedge».
          </p>

          <details
            style={{
              marginBottom: 12,
              borderRadius: 16,
              border: DECIDE_DASHBOARD.panelBorder,
              background: DECIDE_DASHBOARD.panelSlate,
              padding: "14px 18px",
            }}
          >
            <summary style={{ cursor: "pointer", fontSize: 13, fontWeight: 800, color: DECIDE_DASHBOARD.link, listStyle: "none" }}>
              Definições avançadas — país e par cambial
            </summary>
            <div style={{ marginTop: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#a1a1aa", marginBottom: 8 }}>País de residência</div>
              <select
                value={residence}
                onChange={(e) => setResidence(e.target.value)}
                style={{
                  width: "100%",
                  maxWidth: 420,
                  padding: "12px 14px",
                  borderRadius: 12,
                  border: "1px solid #334155",
                  background: "#27272a",
                  color: "#f1f5f9",
                  fontSize: 15,
                  fontWeight: 600,
                  marginBottom: 18,
                }}
              >
                {RESIDENCE_OPTIONS.map((o) => (
                  <option key={o.code} value={o.code}>
                    {o.label}
                  </option>
                ))}
              </select>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#a1a1aa", marginBottom: 10 }}>Par cambial de referência</div>
              <div style={{ display: "grid", gap: 12 }}>
                {pairChoices.map((p) => (
                  <label
                    key={p.id}
                    style={{
                      display: "flex",
                      gap: 12,
                      alignItems: "flex-start",
                      cursor: "pointer",
                      padding: "10px 12px",
                      borderRadius: 12,
                      border: pair === p.id ? "1px solid rgba(45,212,191,0.55)" : "1px solid rgba(63,63,70,0.75)",
                      background: pair === p.id ? "rgba(20,184,166,0.12)" : "rgba(39,39,42,0.5)",
                    }}
                  >
                    <input
                      type="radio"
                      name="fxpair"
                      checked={pair === p.id}
                      onChange={() => setPair(p.id)}
                      style={{ marginTop: 4 }}
                    />
                    <div>
                      <div style={{ fontWeight: 800, color: "#e2e8f0" }}>{p.label}</div>
                      <div style={{ fontSize: 12, color: "#a1a1aa", marginTop: 4, lineHeight: 1.45 }}>{p.hint}</div>
                    </div>
                  </label>
                ))}
              </div>
            </div>
          </details>

        </div>
      </DecideClientShell>
    </>
  );
}
