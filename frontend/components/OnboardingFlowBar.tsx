import React, { useEffect, useMemo, useState } from "react";
import {
  type OnboardingStepId,
  applyOnboardingBackNavigation,
  syncSessionMaxWithPage,
} from "../lib/onboardingFlowState";

export type { OnboardingStepId } from "../lib/onboardingFlowState";
export { ONBOARDING_FLOW_MAX_IDX_KEY } from "../lib/onboardingFlowState";

export const ONBOARDING_STORAGE_KEYS: Record<OnboardingStepId, string> = {
  auth: "",
  onboarding: "decide_onboarding_step1_done",
  mifid: "decide_onboarding_step2_done",
  kyc: "decide_onboarding_step3_done",
  approve: "decide_onboarding_step4_done",
};

export const ONBOARDING_MONTANTE_KEY = "decide_onboarding_montante_eur_v1";

/** Dispara na mesma aba após alterar chaves de onboarding no localStorage (o evento `storage` só existe entre abas). */
export const ONBOARDING_LOCALSTORAGE_CHANGED_EVENT = "decide_onboarding_ls_changed_v1";

type Step = {
  id: OnboardingStepId;
  n: number;
  label: string;
  href: string;
};

function buildSteps(authStepHref: string): Step[] {
  return [
    { id: "auth", n: 1, label: "Conta", href: authStepHref },
    { id: "onboarding", n: 2, label: "Valor a investir", href: "/client-montante" },
    { id: "mifid", n: 3, label: "Perfil de investidor", href: "/mifid-test" },
    { id: "kyc", n: 4, label: "Identidade", href: "/persona-onboarding" },
    { id: "approve", n: 5, label: "Corretora", href: "/client/ibkr-prep" },
  ];
}

const STEP_ACCENT: Record<OnboardingStepId, { solid: string; ring: string; soft: string; label: string }> = {
  auth: { solid: "#4f46e5", ring: "#818cf8", soft: "rgba(79,70,229,0.22)", label: "Conta" },
  onboarding: { solid: "#2563eb", ring: "#60a5fa", soft: "rgba(37,99,235,0.22)", label: "Valor a investir" },
  mifid: { solid: "#c2410c", ring: "#fb923c", soft: "rgba(194,65,12,0.22)", label: "Perfil de investidor" },
  kyc: { solid: "#0f766e", ring: "#2dd4bf", soft: "rgba(15,118,110,0.22)", label: "Identidade" },
  approve: { solid: "#be185d", ring: "#f472b6", soft: "rgba(190,24,93,0.2)", label: "Corretora" },
};

function readStepDone(stepId: OnboardingStepId): boolean {
  try {
    if (typeof window === "undefined") return false;
    const key = ONBOARDING_STORAGE_KEYS[stepId];
    if (!key) return false;
    return window.localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

function authOkFromLs(): boolean {
  try {
    return typeof window !== "undefined" && window.localStorage.getItem("decide_client_session_ok") === "1";
  } catch {
    return false;
  }
}

/** Passos anteriores a `idx` estão concluídos no LS (para permitir saltos para a frente). */
function lsPrevAllComplete(steps: Step[], targetIdx: number): boolean {
  for (let i = 0; i < targetIdx; i++) {
    const id = steps[i].id;
    if (id === "auth") {
      if (!authOkFromLs()) return false;
    } else if (!readStepDone(id)) {
      return false;
    }
  }
  return true;
}

export type OnboardingFlowBarProps = {
  currentStepId: OnboardingStepId;
  authStepHref?: string;
  authStepPending?: boolean;
};

export default function OnboardingFlowBar({
  currentStepId,
  authStepHref = "/client/register",
  authStepPending = false,
}: OnboardingFlowBarProps) {
  const steps = useMemo(() => buildSteps(authStepHref), [authStepHref]);
  const currentIndex = useMemo(() => Math.max(0, steps.findIndex((s) => s.id === currentStepId)), [steps, currentStepId]);

  const [sessionMax, setSessionMax] = useState(-1);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const sm = syncSessionMaxWithPage(currentIndex);
    setSessionMax(sm);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentStepId, currentIndex, tick]);

  const displayDoneMap = useMemo((): Record<OnboardingStepId, boolean> => {
    const authDone = authOkFromLs();
    const onboardingBase = readStepDone("onboarding");
    const mifidBase = readStepDone("mifid");
    const kycBase = readStepDone("kyc");
    const approveBase = readStepDone("approve");
    const mifidDone = authDone && onboardingBase && mifidBase;
    const kycDone = authDone && onboardingBase && mifidDone && kycBase;
    const approveDone = authDone && onboardingBase && mifidDone && kycDone && approveBase;
    return {
      auth: authDone,
      onboarding: authDone && onboardingBase,
      mifid: mifidDone,
      kyc: kycDone,
      approve: approveDone,
    };
  }, [tick]);

  useEffect(() => {
    const bump = () => setTick((t) => t + 1);
    window.addEventListener("storage", bump);
    window.addEventListener(ONBOARDING_LOCALSTORAGE_CHANGED_EVENT, bump);
    return () => {
      window.removeEventListener("storage", bump);
      window.removeEventListener(ONBOARDING_LOCALSTORAGE_CHANGED_EVENT, bump);
    };
  }, []);

  const allFlowDone = useMemo(() => steps.every((s) => displayDoneMap[s.id]), [steps, displayDoneMap]);

  const boxBg = "#010816";
  const border = "#16315d";

  function stepVisualState(idx: number): "completed" | "active" | "upcoming" | "future_locked" {
    const stepId = steps[idx].id;
    // Passo atual já marcado como concluído no funil (ex.: KYC gravado no backend) → verde ✓ como os anteriores
    if (idx === currentIndex) {
      const doneInFunnel = displayDoneMap[stepId];
      if (doneInFunnel && !(authStepPending && stepId === "auth")) {
        return "completed";
      }
      return "active";
    }
    // Passos já ultrapassados no fluxo: nunca «bloqueados» — ou verde (concluído nesta sessão) ou acessível.
    if (idx < currentIndex) {
      const doneGreen = idx <= sessionMax && !(authStepPending && idx === 0);
      if (doneGreen) return "completed";
      return "upcoming";
    }
    if (idx > currentIndex && lsPrevAllComplete(steps, idx)) {
      return "upcoming";
    }
    return "future_locked";
  }

  return (
    <div
      style={{
        background: boxBg,
        border: `1px solid ${border}`,
        borderRadius: 22,
        padding: 16,
        marginBottom: 18,
      }}
    >
      <div
        role="navigation"
        aria-label="Passos do onboarding"
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: 6,
          marginBottom: 10,
        }}
      >
        {steps.map((s, idx) => {
          const accent = STEP_ACCENT[s.id];
          const vs = stepVisualState(idx);

          let background = "rgba(15,23,42,0.6)";
          let borderColor = "#475569";
          let color = "#cbd5e1";
          let boxShadow = "none";
          let fontWeight: 800 | 900 = 800;

          if (vs === "completed") {
            background = "linear-gradient(180deg, #16a34a 0%, #15803d 100%)";
            borderColor = "#4ade80";
            color = "#fff";
            fontWeight = 900;
            boxShadow = "0 0 0 3px rgba(34,197,94,0.25)";
          } else if (vs === "active") {
            background = `linear-gradient(180deg, ${accent.solid} 0%, ${accent.solid}dd 100%)`;
            borderColor = accent.ring;
            color = "#fff";
            fontWeight = 900;
            boxShadow = `0 0 0 4px ${accent.soft}, 0 6px 20px rgba(0,0,0,0.35)`;
          } else if (vs === "upcoming") {
            background = accent.soft;
            borderColor = accent.ring;
            color = "#f1f5f9";
            fontWeight = 800;
          } else {
            background = "rgba(15,23,42,0.35)";
            borderColor = "#334155";
            color = "#64748b";
          }

          const clickable =
            idx <= currentIndex || lsPrevAllComplete(steps, idx);

          return (
            <React.Fragment key={s.id}>
              {idx > 0 ? (
                <span
                  aria-hidden
                  style={{
                    color: "#475569",
                    fontSize: 14,
                    fontWeight: 900,
                    padding: "0 2px",
                    userSelect: "none",
                  }}
                >
                  →
                </span>
              ) : null}
              <a
                href={s.href}
                aria-current={idx === currentIndex ? "step" : undefined}
                onClick={() => {
                  applyOnboardingBackNavigation(idx, currentIndex);
                  setTick((t) => t + 1);
                }}
                title={`${accent.label}${
                  vs === "completed"
                    ? idx === currentIndex
                      ? " (concluído — está neste passo)"
                      : " (concluído)"
                    : vs === "active"
                      ? " (passo atual)"
                      : vs === "upcoming"
                        ? idx < currentIndex
                          ? " (voltar para rever ou alterar)"
                          : " (disponível)"
                        : " (complete os passos anteriores)"
                }`}
                style={{
                  textDecoration: "none",
                  background,
                  border: `2px solid ${borderColor}`,
                  borderRadius: 14,
                  padding: "10px 14px",
                  color,
                  fontSize: 12,
                  fontWeight,
                  lineHeight: 1.25,
                  maxWidth: 200,
                  opacity: clickable ? 1 : 0.55,
                  pointerEvents: clickable ? "auto" : "none",
                  cursor: clickable ? "pointer" : "not-allowed",
                  boxShadow,
                  transition: "transform 0.12s ease, box-shadow 0.12s ease",
                }}
              >
                <span style={{ display: "block", fontSize: 10, fontWeight: 800, opacity: 0.92, marginBottom: 2 }}>
                  Passo {s.n}
                </span>
                <span style={{ display: "block" }}>
                  {vs === "completed" ? "✓ " : ""}
                  {s.label}
                </span>
              </a>
            </React.Fragment>
          );
        })}
      </div>

      {allFlowDone ? (
        <div style={{ color: "#22c55e", fontSize: 13, fontWeight: 800 }}>Processo de onboarding completo.</div>
      ) : (
        <div style={{ color: "#64748b", fontSize: 13, lineHeight: 1.45 }}>
          Os passos anteriores ao atual estão sempre disponíveis para rever ou alterar. Ao retroceder no fluxo, os passos à
          frente deixam de aparecer como concluídos até voltar a avançar com os dados confirmados.
        </div>
      )}
    </div>
  );
}
