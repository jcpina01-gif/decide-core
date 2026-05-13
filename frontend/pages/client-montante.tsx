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
import { DECIDE_ONBOARDING } from "../lib/decideClientTheme";


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

      {/* Sticky header (logo + progress) */}
      <OnboardingFlowBar currentStepId="onboarding" authStepHref="/client/register" />

      {/* Page body */}
      <div style={{
        minHeight: "calc(100vh - 55px)",
        background: "#080c14",
        color: "#f1f5f9",
        fontFamily: DECIDE_ONBOARDING.fontFamily,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "48px max(20px, 4vw) 80px",
      }}>
        {/* Heading */}
        <div style={{ maxWidth: 480, width: "100%", textAlign: "center", marginBottom: 36 }}>
          <h1 style={{ fontSize: "clamp(26px, 5vw, 36px)", fontWeight: 800, lineHeight: 1.15, margin: "0 0 10px", color: "#f1f5f9" }}>
            Quanto pretende investir?
          </h1>
          <p style={{ margin: "0 0 12px", fontSize: 15, color: "#64748b", lineHeight: 1.6 }}>
            Pode ajustar mais tarde. Este valor ajuda-nos a calibrar as posições e o perfil de risco.
          </p>
        </div>

        {/* Card */}
        <div style={{
          maxWidth: 480,
          width: "100%",
          background: "rgba(255,255,255,0.03)",
          border: "1px solid rgba(255,255,255,0.07)",
          borderRadius: 20,
          padding: "28px 24px 24px",
        }}>
          {/* Preset amounts */}
          <div style={{ fontSize: 12, fontWeight: 600, color: "#475569", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 14 }}>
            Seleccione um valor
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(118px, 1fr))", gap: 10, marginBottom: 24 }}>
            {suggestedAmountsEur(MIN_INVESTIMENTO_EUR).map((n) => {
              const active = montanteNum === n;
              const isCommon = COMMON_PRESET_AMOUNTS.has(n);
              return (
                <button
                  key={n}
                  type="button"
                  onClick={() => setMontanteInvestir(n)}
                  style={{
                    padding: "13px 12px",
                    borderRadius: 12,
                    fontSize: 14,
                    fontWeight: 700,
                    cursor: "pointer",
                    border: active ? "1.5px solid #3b82f6" : "1px solid rgba(255,255,255,0.08)",
                    background: active ? "rgba(59,130,246,0.15)" : "rgba(255,255,255,0.04)",
                    color: active ? "#93c5fd" : "#94a3b8",
                    transition: "all 0.15s ease",
                    textAlign: "center",
                    position: "relative",
                  }}
                >
                  {active && (
                    <span style={{ position: "absolute", top: 5, right: 8, fontSize: 10, color: "#60a5fa" }}>✓</span>
                  )}
                  <div>{formatEurPt(n)} €</div>
                  {isCommon && !active && (
                    <div style={{ fontSize: 9, color: "#334155", letterSpacing: "0.05em", textTransform: "uppercase", marginTop: 3 }}>
                      Comum
                    </div>
                  )}
                </button>
              );
            })}
          </div>

          {/* Divider */}
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
            <div style={{ flex: 1, height: 1, background: "rgba(255,255,255,0.07)" }} />
            <span style={{ fontSize: 11, color: "#334155", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em" }}>ou introduza outro valor</span>
            <div style={{ flex: 1, height: 1, background: "rgba(255,255,255,0.07)" }} />
          </div>

          {/* Custom input */}
          <div style={{
            display: "flex",
            alignItems: "stretch",
            borderRadius: 12,
            overflow: "hidden",
            border: `1px solid ${confirmAttempted && !canConfirm ? "rgba(239,68,68,0.5)" : "rgba(255,255,255,0.1)"}`,
            background: "rgba(255,255,255,0.04)",
            marginBottom: 10,
          }}>
            <span style={{
              display: "flex",
              alignItems: "center",
              padding: "0 16px",
              fontSize: 16,
              fontWeight: 700,
              color: "#475569",
              borderRight: "1px solid rgba(255,255,255,0.07)",
              userSelect: "none",
            }} aria-hidden>
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
                flex: 1,
                minWidth: 0,
                background: "transparent",
                color: "#e2e8f0",
                border: "none",
                outline: "none",
                padding: "15px 16px",
                fontSize: 16,
                fontWeight: 600,
              }}
              placeholder={`Ex.: ${formatEurPt(50_000)}`}
              aria-label="Outro valor a investir, em euros"
              aria-invalid={confirmAttempted && !canConfirm}
              aria-describedby="montante-min-hint"
            />
          </div>

          {/* Hint */}
          <div id="montante-min-hint" style={{ fontSize: 13, color: minOk ? "#4ade80" : "#475569", marginBottom: 24, display: "flex", alignItems: "center", gap: 5 }}>
            {minOk ? (
              <>
                <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M3 8l3.5 3.5L13 4.5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                {formatEurPt(montanteNum)} € — OK para continuar
              </>
            ) : (
              `Mínimo: ${formatEurPt(MIN_INVESTIMENTO_EUR)} €${montanteNum > 0 && !minOk ? " — valor insuficiente" : ""}`
            )}
          </div>

          {/* Preview instantâneo */}
          {minOk && (()=>{
            const positions = montanteNum >= 100_000 ? "~20" : montanteNum >= 50_000 ? "~18" : montanteNum >= 25_000 ? "~15" : "~10";
            const horizon = montanteNum >= 50_000 ? "5–10 anos" : "5+ anos";
            const profile = montanteNum >= 50_000 ? "Moderado / Dinâmico" : "Conservador / Moderado";
            return (
              <div style={{ marginBottom: 20, padding: "12px 16px", borderRadius: 12, background: "rgba(59,130,246,0.05)", border: "1px solid rgba(59,130,246,0.12)" }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#334155", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 10 }}>O que isto significa</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
                  {[
                    { label: "Posições", val: positions },
                    { label: "Perfil típico", val: profile },
                    { label: "Horizonte", val: horizon },
                  ].map(k => (
                    <div key={k.label} style={{ textAlign: "center" }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: "#e2e8f0" }}>{k.val}</div>
                      <div style={{ fontSize: 10, color: "#475569", marginTop: 2 }}>{k.label}</div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}

          {/* Validation error */}
          {confirmAttempted && missing.length > 0 && (
            <div style={{
              marginBottom: 16,
              background: "rgba(127,29,29,0.2)",
              border: "1px solid rgba(239,68,68,0.3)",
              borderRadius: 12,
              padding: "12px 16px",
              color: "#fca5a5",
              fontSize: 14,
              lineHeight: 1.5,
            }}>
              {missing.join(" ")}
            </div>
          )}

          {/* CTA */}
          <button
            type="button"
            onClick={confirmAndGoNext}
            disabled={!canConfirm}
            aria-label="Continuar para o teste MiFID"
            style={{
              width: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              background: canConfirm ? "#3b82f6" : "rgba(255,255,255,0.05)",
              color: canConfirm ? "#fff" : "#475569",
              border: "none",
              borderRadius: 12,
              padding: "15px 24px",
              fontSize: 15,
              fontWeight: 700,
              cursor: canConfirm ? "pointer" : "not-allowed",
              opacity: canConfirm ? 1 : 0.5,
              transition: "all 0.2s ease",
            }}
          >
            Continuar
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
              <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>

          <div style={{ marginTop: 16, textAlign: "center" }}>
            <div style={{ fontSize: 11, color: "#1e293b", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>Próximo passo</div>
            <div style={{ fontSize: 13, color: "#334155" }}>Perfil de investimento e preferências de risco</div>
          </div>
        </div>
      </div>
    </>
  );
}
