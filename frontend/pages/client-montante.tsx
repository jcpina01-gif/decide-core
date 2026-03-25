import React, { useEffect, useMemo, useState } from "react";
import Head from "next/head";
import { useRouter } from "next/router";
import OnboardingFlowBar, {
  ONBOARDING_MONTANTE_KEY,
  ONBOARDING_STORAGE_KEYS,
} from "../components/OnboardingFlowBar";
import {
  clearIntendedInvestEur,
  DECIDE_MIN_INVEST_EUR,
  readIntendedInvestEur,
} from "../lib/decideInvestPrefill";

/** Input secundário (fallback) — menos destaque que as sugestões. */
function fallbackInputStyle(): React.CSSProperties {
  return {
    width: "100%",
    background: "rgba(2,8,22,0.65)",
    color: "#cbd5e1",
    border: "1px solid rgba(21,48,91,0.85)",
    borderRadius: 12,
    padding: "11px 14px",
    fontSize: 16,
    outline: "none",
  };
}

const MIN_INVESTIMENTO_EUR = DECIDE_MIN_INVEST_EUR;

/** Sugestões rápidas (filtradas ao mínimo do produto). */
function suggestedAmountsEur(minEur: number): number[] {
  return [5000, 10_000, 25_000, 50_000, 100_000, 500_000].filter((n) => n >= minEur);
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
  const [montanteInvestir, setMontanteInvestir] = useState<number | "">("");
  const [confirmAttempted, setConfirmAttempted] = useState(false);

  useEffect(() => {
    try {
      window.localStorage.setItem(ONBOARDING_STORAGE_KEYS.onboarding, "0");
      window.localStorage.setItem(ONBOARDING_STORAGE_KEYS.mifid, "0");
      window.localStorage.setItem(ONBOARDING_STORAGE_KEYS.kyc, "0");
      window.localStorage.setItem(ONBOARDING_STORAGE_KEYS.approve, "0");
      window.localStorage.setItem("decide_onboarding_ibkr_prep_done_v1", "0");
    } catch {
      // ignore
    }
  }, []);

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

      <div
        style={{
          minHeight: "100vh",
          background: "#000",
          color: "#fff",
          padding: "32px max(20px, 4vw)",
          fontFamily: "Inter, Arial, sans-serif",
        }}
      >
        <div style={{ maxWidth: 900, margin: "0 auto" }}>
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: "#64748b", letterSpacing: "0.06em", marginBottom: 8 }}>
              VALOR A INVESTIR
            </div>
            <div style={{ fontSize: "clamp(28px, 5vw, 40px)", fontWeight: 800, lineHeight: 1.15 }}>
              Quanto pretende investir?
            </div>
          </div>

          <OnboardingFlowBar currentStepId="onboarding" authStepHref="/client/login" />

          <div
            style={{
              marginTop: 8,
              background: "#12244d",
              border: "1px solid #15305b",
              borderRadius: 22,
              padding: "28px max(20px, 4vw)",
              width: "100%",
              maxWidth: 900,
              marginLeft: "auto",
              marginRight: "auto",
              boxSizing: "border-box",
            }}
          >
            <div style={{ color: "#94a3b8", fontSize: 15, lineHeight: 1.55, marginBottom: 16 }}>
              Pode alterar este valor mais tarde.
            </div>

            <details style={{ marginBottom: 20, color: "#64748b", fontSize: 12, lineHeight: 1.55 }}>
              <summary style={{ cursor: "pointer", color: "#94a3b8", fontWeight: 700 }}>
                Porque pedimos este valor?
              </summary>
              <div style={{ marginTop: 8 }}>
                O valor indicado é usado para verificação de adequação (suitability) e para o processo regulamentar. Não constitui
                aconselhamento de investimento.
              </div>
            </details>

            <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 18 }}>
              {suggestedAmountsEur(MIN_INVESTIMENTO_EUR).map((n) => {
                const active = montanteNum === n;
                return (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setMontanteInvestir(n)}
                    style={{
                      padding: "11px 22px",
                      borderRadius: 999,
                      fontSize: 15,
                      fontWeight: 800,
                      cursor: "pointer",
                      border: active ? "3px solid #bfdbfe" : "1px solid rgba(148,163,184,0.4)",
                      background: active
                        ? "linear-gradient(180deg, rgba(37,99,235,0.55) 0%, rgba(29,78,216,0.45) 100%)"
                        : "rgba(15,23,42,0.55)",
                      color: active ? "#fff" : "#cbd5e1",
                      boxShadow: active
                        ? "0 0 0 1px rgba(255,255,255,0.12) inset, 0 4px 18px rgba(37,99,235,0.35)"
                        : "none",
                      transition: "border 0.15s ease, background 0.15s ease, box-shadow 0.15s ease",
                    }}
                  >
                    {active ? <span style={{ marginRight: 6 }}>✓</span> : null}
                    {formatEurPt(n)} €
                  </button>
                );
              })}
              <span
                title="Pode indicar qualquer valor no campo abaixo"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  padding: "11px 16px",
                  borderRadius: 999,
                  fontSize: 16,
                  fontWeight: 800,
                  color: "#64748b",
                  userSelect: "none",
                }}
                aria-hidden
              >
                …
              </span>
            </div>
            <div style={{ color: "#64748b", fontSize: 12, fontWeight: 700, marginBottom: 8 }}>
              Ou introduza outro valor
            </div>
            <input
              type="text"
              inputMode="numeric"
              autoComplete="off"
              value={inputDisplay}
              onChange={(e) => setMontanteInvestir(digitsToInt(e.target.value))}
              style={fallbackInputStyle()}
              placeholder="Ex: 10 000 €"
              aria-label="Outro valor a investir, em euros"
              aria-invalid={confirmAttempted && !canConfirm}
              aria-describedby="montante-min-hint"
            />
            <div
              id="montante-min-hint"
              style={{
                marginTop: 10,
                fontSize: 13,
                fontWeight: 600,
                color: montanteNum <= 0 ? "#64748b" : minOk ? "#86efac" : "#fbbf24",
              }}
            >
              Mínimo: {formatEurPt(MIN_INVESTIMENTO_EUR)} €
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

            <div style={{ marginTop: 24 }}>
              <button
                type="button"
                onClick={confirmAndGoNext}
                disabled={!canConfirm}
                style={{
                  width: "100%",
                  background: canConfirm
                    ? "linear-gradient(180deg, #7eb0ff 0%, #4d74ff 38%, #3558f5 100%)"
                    : "#2d3748",
                  color: canConfirm ? "#fff" : "#94a3b8",
                  border: canConfirm ? "2px solid rgba(255,255,255,0.45)" : "1px solid rgba(255,255,255,0.1)",
                  borderRadius: 16,
                  padding: "18px 24px",
                  fontSize: 17,
                  fontWeight: 900,
                  letterSpacing: "0.03em",
                  cursor: canConfirm ? "pointer" : "not-allowed",
                  boxShadow: canConfirm
                    ? "0 0 0 1px rgba(255,255,255,0.2) inset, 0 8px 0 rgba(15,23,42,0.35), 0 16px 40px rgba(53, 88, 245, 0.55), 0 0 48px rgba(99, 140, 255, 0.35)"
                    : "inset 0 1px 0 rgba(255,255,255,0.06)",
                }}
              >
                Continuar
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
