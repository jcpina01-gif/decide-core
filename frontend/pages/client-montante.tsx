import React, { useEffect, useMemo, useRef, useState } from "react";
import Head from "next/head";
import { useRouter } from "next/router";
import OnboardingFlowBar, {
  ONBOARDING_MONTANTE_KEY,
  ONBOARDING_STORAGE_KEYS,
} from "../components/OnboardingFlowBar";
import {
  clearIntendedInvestEur,
  DECIDE_DEFAULT_INVEST_EUR,
  DECIDE_MIN_INVEST_EUR,
  readIntendedInvestEur,
} from "../lib/decideInvestPrefill";
import DecideClientShell from "../components/DecideClientShell";
import {
  DECIDE_DASHBOARD,
  DECIDE_ONBOARDING,
  ONBOARDING_PRIMARY_CTA_MAX_WIDTH_PX,
  ONBOARDING_SHELL_MAX_WIDTH_PX,
} from "../lib/decideClientTheme";

/** Input secundário (fallback) — menos destaque que as sugestões. */
function fallbackInputStyle(): React.CSSProperties {
  return {
    width: "100%",
    background: "#27272a",
    color: "#d4d4d8",
    border: "1px solid rgba(63,63,70,0.85)",
    borderRadius: 12,
    padding: "11px 14px",
    fontSize: 16,
    outline: "none",
  };
}

const MIN_INVESTIMENTO_EUR = DECIDE_MIN_INVEST_EUR;

/** Destaque suave — valores frequentemente escolhidos (sem impor). */
const COMMON_PRESET_AMOUNTS = new Set([25_000, 50_000]);

/** Sugestões rápidas (filtradas ao mínimo do produto). */
function suggestedAmountsEur(minEur: number): number[] {
  return [5000, 10_000, 25_000, 50_000, 100_000, 250_000, 500_000].filter((n) => n >= minEur);
}

function parseCapitalQuery(raw: string | string[] | undefined): number | null {
  const s = Array.isArray(raw) ? raw[0] : raw;
  if (s == null || String(s).trim() === "") return null;
  const n = Math.round(Number(String(s).replace(/\s/g, "").replace(",", ".")));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Apenas dígitos → inteiro (para input formatado em pt-PT). */
function digitsToInt(raw: string): number | "" {
  const d = raw.replace(/\D/g, "");
  if (!d) return "";
  const n = parseInt(d, 10);
  return Number.isFinite(n) ? n : "";
}

function formatEurPt(n: number): string {
  return n.toLocaleString("pt-PT");
}

export default function ClientMontantePage() {
  const router = useRouter();
  const otherValueInputRef = useRef<HTMLInputElement>(null);
  const [montanteInvestir, setMontanteInvestir] = useState<number | "">(DECIDE_DEFAULT_INVEST_EUR);
  const [confirmAttempted, setConfirmAttempted] = useState(false);

  useEffect(() => {
    if (!router.isReady) return;
    const c = parseCapitalQuery(router.query.capital);
    if (c != null) {
      setMontanteInvestir(Math.max(MIN_INVESTIMENTO_EUR, Math.round(c)));
      return;
    }
    const fromLs = readIntendedInvestEur();
    if (fromLs != null) setMontanteInvestir(fromLs);
  }, [router.isReady, router.query.capital]);

  const montanteNum = typeof montanteInvestir === "number" ? montanteInvestir : 0;

  const missing = useMemo(() => {
    const out: string[] = [];
    if (!(montanteNum > 0)) out.push("Indique quanto pretende investir.");
    else if (montanteNum < MIN_INVESTIMENTO_EUR) {
      out.push(`O valor mínimo é ${formatEurPt(MIN_INVESTIMENTO_EUR)} €.`);
    }
    return out;
  }, [montanteNum]);

  const canConfirm = missing.length === 0;
  const minOk = montanteNum >= MIN_INVESTIMENTO_EUR && montanteNum > 0;

  function confirmAndGoNext() {
    setConfirmAttempted(true);
    if (!canConfirm) return;

    try {
      window.localStorage.setItem(ONBOARDING_MONTANTE_KEY, String(montanteNum));
      window.localStorage.setItem(ONBOARDING_STORAGE_KEYS.onboarding, "1");
      clearIntendedInvestEur();
    } catch {
      // ignore
    }

    window.location.href = "/mifid-test";
  }

  const inputDisplay =
    typeof montanteInvestir === "number" && montanteInvestir > 0 ? formatEurPt(montanteInvestir) : "";

  return (
    <>
      <Head>
        <title>DECIDE — Valor a investir</title>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>

      <DecideClientShell
        showClientNav={false}
        maxWidth={ONBOARDING_SHELL_MAX_WIDTH_PX}
        padding="12px max(18px, 3.8vw) 16px"
        pageBackground={DECIDE_ONBOARDING.pageBackground}
        stickyBottomReservePx={124}
        stickyBottomBar={
          <button
            type="button"
            onClick={confirmAndGoNext}
            disabled={!canConfirm}
            aria-label="Continuar para o teste MiFID"
            style={{
              width: "100%",
              maxWidth: ONBOARDING_PRIMARY_CTA_MAX_WIDTH_PX,
              margin: "0 auto",
              display: "block",
              background: canConfirm ? DECIDE_DASHBOARD.buttonRegister : "#3f3f46",
              color: canConfirm ? DECIDE_DASHBOARD.kpiMenuMainButtonColor : "#a1a1aa",
              border: canConfirm ? DECIDE_DASHBOARD.kpiMenuMainButtonBorder : "1px solid rgba(255,255,255,0.1)",
              borderRadius: 16,
              padding: "14px 22px",
              fontSize: 16,
              fontWeight: 900,
              letterSpacing: "0.03em",
              cursor: canConfirm ? "pointer" : "not-allowed",
              opacity: canConfirm ? 1 : 0.55,
              boxShadow: canConfirm
                ? `${DECIDE_DASHBOARD.kpiMenuMainButtonShadow}, 0 12px 32px rgba(13, 148, 136, 0.32)`
                : "inset 0 1px 0 rgba(255,255,255,0.06)",
            }}
          >
            Continuar
          </button>
        }
      >
        <div>
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: "#71717a", letterSpacing: "0.06em", marginBottom: 8 }}>
              VALOR A INVESTIR
            </div>
            <div style={{ fontSize: "clamp(28px, 5vw, 40px)", fontWeight: 800, lineHeight: 1.15 }}>
              Quanto pretende investir?
            </div>
            <p
              style={{
                margin: "12px 0 0",
                fontSize: 15,
                color: "#a1a1aa",
                lineHeight: 1.55,
                maxWidth: "min(100%, 960px)",
                fontWeight: 500,
              }}
            >
              Usamos este valor para ajustar o risco e as recomendações ao seu perfil.
            </p>
            <p style={{ margin: "8px 0 0", fontSize: 14, color: "#71717a", lineHeight: 1.5, maxWidth: "min(100%, 960px)" }}>
              Pode alterar mais tarde.
            </p>
          </div>

          <OnboardingFlowBar currentStepId="onboarding" authStepHref="/client/login" compact />

          <div
            style={{
              marginTop: 8,
              background: DECIDE_DASHBOARD.panelSlate,
              border: DECIDE_DASHBOARD.panelBorder,
              borderRadius: 20,
              padding: "22px max(18px, 3.8vw)",
              width: "100%",
              maxWidth: ONBOARDING_SHELL_MAX_WIDTH_PX,
              marginLeft: "auto",
              marginRight: "auto",
              boxSizing: "border-box",
            }}
          >
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 18, alignItems: "flex-start" }}>
              {suggestedAmountsEur(MIN_INVESTIMENTO_EUR).map((n) => {
                const active = montanteNum === n;
                const isCommon = COMMON_PRESET_AMOUNTS.has(n);
                return (
                  <div
                    key={n}
                    style={{
                      display: "inline-flex",
                      flexDirection: "column",
                      alignItems: "center",
                      gap: 5,
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => setMontanteInvestir(n)}
                      style={{
                        padding: "11px 22px",
                        borderRadius: 999,
                        fontSize: 15,
                        fontWeight: 800,
                        cursor: "pointer",
                        border: active
                          ? "3px solid rgba(45,212,191,0.65)"
                          : isCommon
                            ? "1px solid rgba(45,212,191,0.42)"
                            : "1px solid rgba(148,163,184,0.4)",
                        background: active
                          ? "linear-gradient(165deg, rgba(20,184,166,0.45) 0%, rgba(15,118,110,0.5) 100%)"
                          : "rgba(24,24,27,0.72)",
                        color: active ? "#fff" : "#d4d4d8",
                        boxShadow: active
                          ? "0 0 0 1px rgba(255,255,255,0.1) inset, 0 4px 18px rgba(15,118,110,0.4)"
                          : isCommon
                            ? "0 0 22px rgba(13, 148, 136, 0.18), 0 0 0 1px rgba(45,212,191,0.08) inset"
                            : "none",
                        transition: "border 0.15s ease, background 0.15s ease, box-shadow 0.15s ease",
                      }}
                    >
                      {active ? <span style={{ marginRight: 6 }}>✓</span> : null}
                      {formatEurPt(n)} €
                    </button>
                    <div
                      style={{
                        minHeight: 18,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      {isCommon ? (
                        <span
                          style={{
                            fontSize: 10,
                            fontWeight: 800,
                            letterSpacing: "0.06em",
                            textTransform: "uppercase",
                            color: active ? "#d4d4d4" : "#71717a",
                          }}
                        >
                          Mais comum
                        </span>
                      ) : null}
                    </div>
                  </div>
                );
              })}
              <div
                style={{
                  display: "inline-flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 5,
                }}
              >
                <button
                  type="button"
                  title="Indicar outro montante no campo abaixo"
                  onClick={() => {
                    otherValueInputRef.current?.focus();
                    try {
                      otherValueInputRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
                    } catch {
                      // ignore
                    }
                  }}
                  style={{
                    padding: "11px 18px",
                    borderRadius: 999,
                    fontSize: 14,
                    fontWeight: 800,
                    cursor: "pointer",
                    border: "1px dashed rgba(100,116,139,0.55)",
                    background: "transparent",
                    color: "#a1a1aa",
                  }}
                >
                  Outro valor
                </button>
                <div style={{ minHeight: 18 }} aria-hidden />
              </div>
            </div>
            <div style={{ color: "#71717a", fontSize: 12, fontWeight: 700, marginBottom: 8 }}>
              Ou indique outro valor
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "stretch",
                borderRadius: 12,
                overflow: "hidden",
                border: "1px solid rgba(63,63,70,0.85)",
                background: "#27272a",
                maxWidth: "100%",
              }}
            >
              <span
                style={{
                  display: "flex",
                  alignItems: "center",
                  padding: "0 14px",
                  fontSize: 16,
                  fontWeight: 800,
                  color: "#a1a1aa",
                  background: "rgba(0,0,0,0.2)",
                  borderRight: "1px solid rgba(63,63,70,0.65)",
                  userSelect: "none",
                }}
                aria-hidden
              >
                €
              </span>
              <input
                ref={otherValueInputRef}
                type="text"
                inputMode="numeric"
                autoComplete="off"
                value={inputDisplay}
                onChange={(e) => setMontanteInvestir(digitsToInt(e.target.value))}
                style={{
                  ...fallbackInputStyle(),
                  flex: 1,
                  minWidth: 0,
                  border: "none",
                  borderRadius: 0,
                }}
                placeholder={`Ex.: ${formatEurPt(50_000)}`}
                aria-label="Outro valor a investir, em euros"
                aria-invalid={confirmAttempted && !canConfirm}
                aria-describedby="montante-min-hint"
              />
            </div>
            <div
              id="montante-min-hint"
              style={{
                marginTop: 10,
                fontSize: 13,
                fontWeight: 600,
                color: montanteNum <= 0 ? "#71717a" : minOk ? "#d4d4d4" : "#a3a3a3",
              }}
            >
              Mínimo: {formatEurPt(MIN_INVESTIMENTO_EUR)} € (pode ajustar mais tarde)
              {montanteNum > 0 && !minOk ? " — aumente o valor para continuar." : null}
              {minOk ? " — OK para continuar." : null}
            </div>

            {confirmAttempted && missing.length > 0 ? (
              <div
                style={{
                  marginTop: 14,
                  background: "#2a0a0a",
                  border: "1px solid #7f1d1d",
                  borderRadius: 14,
                  padding: 14,
                  color: "#fee2e2",
                  lineHeight: 1.6,
                }}
              >
                {missing.join(" ")}
              </div>
            ) : null}

          </div>
        </div>
      </DecideClientShell>
    </>
  );
}
