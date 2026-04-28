import React, { useEffect, useMemo, useState } from "react";
import { DECIDE_DASHBOARD, ONBOARDING_SHELL_MAX_WIDTH_PX } from "../lib/decideClientTheme";
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

  /** ~15–20% mais baixo que antes — CTA fixo no funil depende de menos scroll. */
  const boxPad = compact ? 8 : 12;
  const boxMb = compact ? 8 : 14;
  const boxRadius = compact ? 16 : 20;
  const navGap = compact ? 6 : 8;
  const navMb = compact ? 5 : 8;
  const navPb = compact ? 2 : 3;
  const stepPad = compact ? "6px 4px" : "8px 6px";
  const stepNumFs = compact ? 12 : 13;
  const stepLabelFs = compact ? 10 : 11;
  const footFs = compact ? 12 : 13;
  const footLh = compact ? 1.35 : 1.45;

  const boxBg = "#18181b";
  const border = "rgba(63, 63, 70, 0.75)";

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

  if (appearance === "minimal") {
    return (
      <div
        style={{
          background: boxBg,
          border: `1px solid ${border}`,
          borderRadius: 12,
          padding: "8px 10px 10px",
          marginBottom: compact ? 10 : 16,
          maxWidth: shellMaxWidthPx,
          marginLeft: "auto",
          marginRight: "auto",
          width: "100%",
          boxSizing: "border-box",
        }}
      >
        <div
          style={{
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            color: "#71717a",
            marginBottom: 6,
          }}
        >
          Onboarding
        </div>
        <div
          style={{
            height: 4,
            borderRadius: 4,
            background: "rgba(39,39,42,0.95)",
            overflow: "hidden",
            marginBottom: 8,
          }}
        >
          <div
            style={{
              width: `${progressPct}%`,
              height: "100%",
              borderRadius: 4,
              background: "linear-gradient(90deg, #2d7f76 0%, #5eead4 100%)",
              transition: "width 0.2s ease",
            }}
          />
        </div>
        <div
          role="navigation"
          aria-label="Passos do onboarding"
          style={{
            display: "flex",
            flexWrap: "nowrap",
            gap: 6,
            overflowX: "auto",
            paddingBottom: 2,
            WebkitOverflowScrolling: "touch",
          }}
        >
          {steps.map((s, idx) => {
            const vs = stepVisualState(idx);
            const accent = STEP_ACCENT[s.id];
            const clickable = idx <= currentIndex || lsPrevAllComplete(steps, idx, mounted);
            let bg = "#27272a";
            let bd = "rgba(255,255,255,0.08)";
            let fg = "#71717a";
            if (vs === "completed") {
              bg = "#2d6d66";
              bd = "rgba(94, 234, 212, 0.35)";
              fg = "#ecfdf5";
            } else if (vs === "active") {
              bg = "rgba(255,255,255,0.06)";
              bd = accent.ring;
              fg = "#fafafa";
            } else if (vs === "upcoming") {
              bg = "rgba(39,39,42,0.95)";
              bd = accent.ring;
              fg = "#d4d4d4";
            }
            return (
              <a
                key={s.id}
                href={s.href}
                aria-current={idx === currentIndex ? "step" : undefined}
                onClick={() => {
                  applyOnboardingBackNavigation(idx, currentIndex);
                  setTick((t) => t + 1);
                }}
                title={s.label}
                style={{
                  flex: "0 0 auto",
                  minWidth: 28,
                  height: 28,
                  borderRadius: 8,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 10,
                  fontWeight: 800,
                  textDecoration: "none",
                  background: bg,
                  border: `1px solid ${bd}`,
                  color: fg,
                  opacity: clickable ? 1 : 0.45,
                  pointerEvents: clickable ? "auto" : "none",
                  cursor: clickable ? "pointer" : "not-allowed",
                  boxSizing: "border-box",
                }}
              >
                {vs === "completed" ? "✓" : s.n}
              </a>
            );
          })}
        </div>
        <div style={{ fontSize: 10, color: "#71717a", marginTop: 6, lineHeight: 1.35 }}>
          Passo {currentIndex + 1} de {totalSteps}:{" "}
          <span style={{ color: "#a1a1aa" }}>{steps[currentIndex]?.label ?? "—"}</span>
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        background: boxBg,
        border: `1px solid ${border}`,
        borderRadius: boxRadius,
        padding: boxPad,
        marginBottom: boxMb,
        maxWidth: shellMaxWidthPx,
        marginLeft: "auto",
        marginRight: "auto",
        width: "100%",
        boxSizing: "border-box",
      }}
    >
      <div
        role="navigation"
        aria-label="Passos do onboarding"
        style={{
          display: "flex",
          flexWrap: "nowrap",
          alignItems: "stretch",
          justifyContent: "center",
          gap: navGap,
          marginBottom: navMb,
          width: "100%",
          overflowX: "auto",
          paddingBottom: navPb,
          WebkitOverflowScrolling: "touch",
        }}
      >
        {steps.map((s, idx) => {
          const accent = STEP_ACCENT[s.id];
          const vs = stepVisualState(idx);

          let background = "rgba(39, 39, 42, 0.65)";
          let borderColor = "#52525b";
          let color = "#cbd5e1";
          let boxShadow = "none";
          let fontWeight: 800 | 900 = 800;

          if (vs === "completed") {
            /* Concluído: verde acinzentado + rebordo teal. */
            background = "linear-gradient(180deg, #3f9e93 0%, #2d7f76 52%, #1a524f 100%)";
            borderColor = "rgba(94, 234, 212, 0.42)";
            color = "#f4f4f5";
            fontWeight = 900;
            boxShadow = "0 2px 12px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.06)";
          } else if (vs === "active") {
            /* Passo actual: rebordo na cor do passo, texto branco, sem preenchimento cheio. */
            background = "rgba(15, 15, 18, 0.96)";
            borderColor = accent.ring;
            color = "#ffffff";
            fontWeight = 900;
            boxShadow = "none";
          } else if (vs === "upcoming") {
            /* Acessível mas ainda não concluído: mesmo critério (rebordo + branco). */
            background = "rgba(15, 15, 18, 0.96)";
            borderColor = accent.ring;
            color = "#ffffff";
            fontWeight = 800;
            boxShadow = "none";
          } else {
            /* Ainda bloqueado: rebordo na cor do passo + texto branco (caixa mais discreta). */
            background = "rgba(15, 15, 18, 0.88)";
            borderColor = accent.ring;
            color = "#ffffff";
            fontWeight = 800;
            boxShadow = "none";
          }

          const clickable =
            idx <= currentIndex || lsPrevAllComplete(steps, idx, mounted);

          return (
            <React.Fragment key={s.id}>
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
                  borderRadius: compact ? 12 : 14,
                  padding: stepPad,
                  color,
                  fontSize: 12,
                  fontWeight,
                  lineHeight: 1.25,
                  boxSizing: "border-box",
                  flex: "1 1 0",
                  minWidth: 0,
                  textAlign: "center",
                  opacity: clickable ? 1 : 0.72,
                  pointerEvents: clickable ? "auto" : "none",
                  cursor: clickable ? "pointer" : "not-allowed",
                  boxShadow,
                  transition: "transform 0.12s ease, box-shadow 0.12s ease",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <span
                  style={{
                    display: "block",
                    fontSize: stepNumFs,
                    fontWeight: 900,
                    letterSpacing: "0.02em",
                    marginBottom: compact ? 1 : 3,
                    color: vs === "completed" ? "inherit" : "#ffffff",
                    opacity: vs === "completed" ? 1 : 0.95,
                    textAlign: "center",
                  }}
                >
                  {s.n}/{totalSteps}
                </span>
                <span
                  style={{
                    display: "block",
                    textAlign: "center",
                    wordBreak: "break-word",
                    fontSize: stepLabelFs,
                    lineHeight: compact ? 1.25 : 1.3,
                  }}
                >
                  {vs === "completed" ? "✓ " : ""}
                  {s.label}
                </span>
              </a>
            </React.Fragment>
          );
        })}
      </div>

      {allFlowDone ? (
        <div style={{ color: "#a1a1aa", fontSize: footFs, fontWeight: 800, textAlign: "center" }}>
          Processo de onboarding completo.
        </div>
      ) : (
        <div style={{ color: "#71717a", fontSize: footFs, lineHeight: footLh, textAlign: "center" }}>
          Os passos anteriores ao atual estão sempre disponíveis para rever ou alterar. Ao retroceder no fluxo, os passos à
          frente deixam de aparecer como concluídos até voltar a avançar com os dados confirmados.
        </div>
      )}
    </div>
  );
}
