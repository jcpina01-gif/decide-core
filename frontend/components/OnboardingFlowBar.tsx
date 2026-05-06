import React, { useEffect, useMemo, useState } from "react";
import { DecideBrandImage } from "./DecideLogoHeader";
import { ONBOARDING_SHELL_MAX_WIDTH_PX } from "../lib/decideClientTheme";
import { isFxHedgeGateOk } from "../lib/fxHedgePrefs";
import {
  type OnboardingStepId,
  applyOnboardingBackNavigation,
  syncSessionMaxWithPage,
} from "../lib/onboardingFlowState";
import { ONBOARDING_STEP_6_LABEL } from "../lib/onboardingStep6Label";

export type { OnboardingStepId } from "../lib/onboardingFlowState";
export { ONBOARDING_FLOW_MAX_IDX_KEY } from "../lib/onboardingFlowState";

export const ONBOARDING_STORAGE_KEYS: Record<OnboardingStepId, string> = {
  auth: "",
  onboarding: "decide_onboarding_step1_done",
  mifid: "decide_onboarding_step2_done",
  kyc: "decide_onboarding_step3_done",
  approve: "decide_onboarding_step4_done",
  hedge: "decide_onboarding_step5_hedge_done",
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
    { id: "hedge", n: 5, label: "Hedge cambial", href: "/client/fx-hedge-onboarding" },
    { id: "approve", n: 6, label: ONBOARDING_STEP_6_LABEL, href: "/client/ibkr-prep" },
  ];
}

const STEP_ACCENT: Record<OnboardingStepId, { solid: string; ring: string; soft: string; label: string }> = {
  /** Verde acinzentado (teal) — alinhado aos CTAs principais */
  auth: { solid: "#2d6d66", ring: "#5eead4", soft: "rgba(45,212,191,0.22)", label: "Conta" },
  onboarding: { solid: "#2f7a72", ring: "#5eead4", soft: "rgba(45,212,191,0.2)", label: "Valor a investir" },
  mifid: { solid: "#2d7f76", ring: "#99f6e4", soft: "rgba(45,212,191,0.2)", label: "Perfil de investidor" },
  kyc: { solid: "#2d6d66", ring: "#5eead4", soft: "rgba(45,212,191,0.22)", label: "Identidade" },
  approve: { solid: "#2f7a72", ring: "#fafafa", soft: "rgba(94,234,212,0.18)", label: ONBOARDING_STEP_6_LABEL },
  hedge: { solid: "#2d6d66", ring: "#99f6e4", soft: "rgba(45,212,191,0.2)", label: "Hedge cambial" },
};

function readStepDone(stepId: OnboardingStepId): boolean {
  try {
    if (typeof window === "undefined") return false;
    if (stepId === "hedge") {
      return isFxHedgeGateOk();
    }
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
function lsPrevAllComplete(steps: Step[], targetIdx: number, mounted: boolean): boolean {
  if (!mounted) return false;
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
  /** Largura máxima do contentor (alinhada ao `maxWidth` da página). Predefinição: tema onboarding. */
  shellMaxWidthPx?: number;
  /** Menos padding e tipografia mais pequena — páginas onde o ecrã deve ser mais denso (ex. KYC). */
  compact?: boolean;
  /**
   * `minimal` — barra fina + indicadores pequenos (contexto secundário, ex. página de aprovação).
   * `default` — cartões por passo.
   */
  appearance?: "default" | "minimal";
  /**
   * Quando o passo já está «feito» no localStorage mas o utilizador ainda está nesta página
   * (ex.: aprovação de plano com decisão já gravada), evita mostrar o passo atual como ✓ verde:
   * caso contrário o passo seguinte (ex. hedge) parece ser o «ativo».
   */
  currentStepAlwaysActive?: boolean;
};

export default function OnboardingFlowBar({
  currentStepId,
  authStepHref = "/client/register",
  authStepPending = false,
  shellMaxWidthPx = ONBOARDING_SHELL_MAX_WIDTH_PX,
  compact = false,
  appearance = "default",
  currentStepAlwaysActive = false,
}: OnboardingFlowBarProps) {
  const steps = useMemo(() => buildSteps(authStepHref), [authStepHref]);
  const currentIndex = useMemo(() => Math.max(0, steps.findIndex((s) => s.id === currentStepId)), [steps, currentStepId]);

  /** Evita erro de hidratação: no servidor e no 1.º paint do cliente não lemos localStorage (só após mount). */
  const [mounted, setMounted] = useState(false);

  const [tick, setTick] = useState(0);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    const prev = document.body.style.background;
    document.body.style.background = "#080c14";
    document.body.style.backgroundAttachment = "initial";
    document.documentElement.style.background = "#080c14";
    document.documentElement.style.backgroundAttachment = "initial";
    return () => {
      document.body.style.background = prev;
      document.documentElement.style.background = "";
    };
  }, []);

  useEffect(() => {
    if (!mounted) return;
    void syncSessionMaxWithPage(currentIndex);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentStepId, currentIndex, tick, mounted]);

  const displayDoneMap = useMemo((): Record<OnboardingStepId, boolean> => {
    if (!mounted) {
      return {
        auth: false,
        onboarding: false,
        mifid: false,
        kyc: false,
        approve: false,
        hedge: false,
      };
    }
    const authDone = authOkFromLs();
    const onboardingBase = readStepDone("onboarding");
    const mifidBase = readStepDone("mifid");
    const kycBase = readStepDone("kyc");
    const approveBase = readStepDone("approve");
    /**
     * Cada cartão reflecte só a sua chave no LS (e hedge «N/A» quando não aplicável).
     * Cadeias tipo `auth && onboarding && …` faziam o ✓ de Identidade desaparecer quando
     * `step1_done` ou `session_ok` estavam desalinhados, embora `decide_onboarding_step3_done` fosse 1.
     */
    return {
      auth: authDone || onboardingBase || mifidBase || kycBase,
      onboarding: onboardingBase,
      /** KYC/corretora concluídos implicam MiFID percorrido — evita ✓ em falta por LS desalinhado. */
      mifid: mifidBase || kycBase || approveBase,
      kyc: kycBase,
      approve: approveBase,
      hedge: readStepDone("hedge"),
    };
  }, [tick, mounted]);

  useEffect(() => {
    if (!mounted) return;
    const bump = () => setTick((t) => t + 1);
    window.addEventListener("storage", bump);
    window.addEventListener(ONBOARDING_LOCALSTORAGE_CHANGED_EVENT, bump);
    window.addEventListener("focus", bump);
    return () => {
      window.removeEventListener("storage", bump);
      window.removeEventListener(ONBOARDING_LOCALSTORAGE_CHANGED_EVENT, bump);
      window.removeEventListener("focus", bump);
    };
  }, [mounted]);

  const allFlowDone = useMemo(() => steps.every((s) => displayDoneMap[s.id]), [steps, displayDoneMap]);
  const totalSteps = steps.length;


  function stepVisualState(idx: number): "completed" | "active" | "upcoming" | "future_locked" {
    const stepId = steps[idx].id;
    const doneInFunnel = displayDoneMap[stepId];
    // Passo atual já marcado como concluído no funil (ex.: KYC gravado no backend) → verde ✓ como os anteriores
    if (idx === currentIndex) {
      if (
        doneInFunnel &&
        !currentStepAlwaysActive &&
        !(authStepPending && stepId === "auth")
      ) {
        return "completed";
      }
      return "active";
    }
    // Concluído no funil (`displayDoneMap` / localStorage) — mostrar ✓ mesmo após voltar atrás no stepper.
    if (doneInFunnel && !(authStepPending && stepId === "auth")) {
      return "completed";
    }
    // Passos antes do actual: **não** usar só `sessionMax` — sessionStorage pode ficar alto (ex.: após limpar LS ou
    // `step4_done` sem `step3_done`) e mostrar ✓ em Identidade enquanto `/client/approve` lê KYC em falta.
    if (idx < currentIndex) {
      return "upcoming";
    }
    if (idx > currentIndex && lsPrevAllComplete(steps, idx, mounted)) {
      return "upcoming";
    }
    return "future_locked";
  }

  const progressPct =
    totalSteps <= 1 ? 100 : Math.min(100, Math.max(0, ((currentIndex + 1) / totalSteps) * 100));

  return (
    <div
      style={{
        position: "sticky",
        top: 0,
        zIndex: 50,
        background: "#07090f",
        borderBottom: "1px solid #1a1f2e",
      }}
      role="banner"
    >
      <div
        style={{
          maxWidth: shellMaxWidthPx,
          margin: "0 auto",
          padding: "14px max(20px, 3vw) 16px",
          display: "flex",
          alignItems: "center",
          gap: 24,
        }}
      >
        {/* Logo oficial */}
        <a href="/" style={{ flexShrink: 0, textDecoration: "none", lineHeight: 0 }}>
          <DecideBrandImage
            priority
            height={72}
            maxWidth="220px"
            sizes="220px"
            knockoutBackground
          />
        </a>

        {/* Stepper com círculos numerados */}
        <div
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            gap: 0,
            minWidth: 0,
            overflowX: "auto",
          }}
        >
          {steps.map((step, idx) => {
            const state = stepVisualState(idx);
            const isCompleted = state === "completed";
            const isActive = state === "active";
            const isLast = idx === steps.length - 1;

            const circleBg = isCompleted || isActive ? "#2563eb" : "#111827";
            const circleBorder = isCompleted || isActive ? "#3b82f6" : "#252a3a";
            const numColor = isCompleted || isActive ? "#fff" : "#475569";
            const labelColor = isActive ? "#e2e8f0" : isCompleted ? "#94a3b8" : "#374151";
            const lineColor = isCompleted ? "#2563eb" : "#1a1f2e";

            return (
              <React.Fragment key={step.id}>
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: 4,
                    flexShrink: 0,
                  }}
                >
                  {/* Círculo */}
                  <div
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: "50%",
                      background: circleBg,
                      border: `2px solid ${circleBorder}`,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 11,
                      fontWeight: 700,
                      color: numColor,
                      transition: "all 0.2s ease",
                      flexShrink: 0,
                    }}
                  >
                    {isCompleted ? "✓" : step.n}
                  </div>
                  {/* Label abaixo */}
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: isActive ? 700 : 500,
                      color: labelColor,
                      whiteSpace: "nowrap",
                      letterSpacing: "0.01em",
                    }}
                  >
                    {step.label}
                  </span>
                </div>

                {/* Linha de ligação */}
                {!isLast && (
                  <div
                    style={{
                      flex: 1,
                      height: 2,
                      background: lineColor,
                      minWidth: 16,
                      marginBottom: 14,
                      transition: "background 0.2s ease",
                    }}
                  />
                )}
              </React.Fragment>
            );
          })}
        </div>

        {/* Indicador compacto à direita */}
        <div style={{ flexShrink: 0 }}>
          {allFlowDone ? (
            <span style={{ fontSize: 12, fontWeight: 700, color: "#22c55e" }}>Concluído ✓</span>
          ) : (
            <span style={{ fontSize: 12, fontWeight: 600, color: "#475569", whiteSpace: "nowrap" }}>
              {currentIndex + 1} / {totalSteps}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
