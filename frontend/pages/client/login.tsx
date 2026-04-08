import React, { useEffect, useState } from "react";
import Head from "next/head";
import OnboardingFlowBar from "../../components/OnboardingFlowBar";
import {
  getCurrentSessionUser,
  isClientLoggedIn,
  loginClientUser,
} from "../../lib/clientAuth";
import { getNextOnboardingHref, isOnboardingFlowComplete } from "../../lib/onboardingProgress";
import DecideClientShell from "../../components/DecideClientShell";
import { DECIDE_DASHBOARD, DECIDE_ONBOARDING, ONBOARDING_SHELL_MAX_WIDTH_PX } from "../../lib/decideClientTheme";

export default function ClientLoginPage() {
  /** SSR/localStorage: evita hydration mismatch. */
  const [sessionState, setSessionState] = useState<{
    loggedIn: boolean;
    user: string | null;
    onboardingComplete: boolean;
  }>({
    loggedIn: false,
    user: null,
    onboardingComplete: false,
  });

  useEffect(() => {
    const loggedIn = isClientLoggedIn();
    setSessionState({
      loggedIn,
      user: getCurrentSessionUser(),
      onboardingComplete: loggedIn ? isOnboardingFlowComplete() : false,
    });
  }, []);

  const { loggedIn, user: currentUser, onboardingComplete } = sessionState;

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string>("");

  function submit() {
    setError("");
    const res = loginClientUser(username, password);
    if (!res.ok) {
      setError(res.error || "Falha ao fazer login.");
      return;
    }
    window.location.href = getNextOnboardingHref();
  }

  return (
    <>
      <Head>
        <title>DECIDE — Conta e sessão</title>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>
      <DecideClientShell
        showClientNav={false}
        maxWidth={ONBOARDING_SHELL_MAX_WIDTH_PX}
        padding="12px max(16px, 3vw) 16px"
        pageBackground={DECIDE_ONBOARDING.pageBackground}
        stickyBottomReservePx={116}
        stickyBottomBar={
          loggedIn && !onboardingComplete ? (
            <a
              href={getNextOnboardingHref()}
              style={{
                display: "block",
                width: "100%",
                maxWidth: 400,
                margin: "0 auto",
                textAlign: "center",
                boxSizing: "border-box",
                background: DECIDE_DASHBOARD.buttonRegister,
                color: DECIDE_DASHBOARD.kpiMenuMainButtonColor,
                borderRadius: 14,
                padding: "14px 18px",
                textDecoration: "none",
                border: DECIDE_DASHBOARD.kpiMenuMainButtonBorder,
                fontWeight: 900,
                fontSize: 16,
                boxShadow: `${DECIDE_DASHBOARD.kpiMenuMainButtonShadow}, 0 10px 28px rgba(13, 148, 136, 0.32)`,
              }}
            >
              Continuar →
            </a>
          ) : undefined
        }
      >
        <div>
          {loggedIn && !onboardingComplete ? (
            <OnboardingFlowBar
              currentStepId="auth"
              authStepHref="/client/login"
              authStepPending
              compact
            />
          ) : null}

          <div style={{ maxWidth: 520, marginTop: 20 }}>
            {!loggedIn ? (
              <>
                <div style={{ marginBottom: 10 }}>
                  <div style={{ fontSize: 20, fontWeight: 800, color: "#f1f5f9" }}>Login</div>
                </div>
                <div style={{ color: "#a1a1aa", marginBottom: 20, fontSize: 15, lineHeight: 1.5 }}>
                  Introduza o utilizador e a palavra-passe para continuar.
                </div>
              </>
            ) : null}

            {loggedIn && !onboardingComplete ? (
              <>
                <div style={{ fontSize: 34, fontWeight: 800, marginBottom: 10 }}>Conta criada com sucesso</div>
                <div style={{ color: "#a1a1aa", marginBottom: 8, fontSize: 15, lineHeight: 1.55 }}>
                  Vamos configurar o seu perfil de investimento.
                </div>
                <div style={{ color: "#71717a", fontSize: 13, marginBottom: 20 }}>
                  Sessão: <strong style={{ color: "#d4d4d8" }}>{currentUser || "—"}</strong>
                </div>
              </>
            ) : null}

            {loggedIn && onboardingComplete ? (
              <>
                <div style={{ fontSize: 34, fontWeight: 800, marginBottom: 10 }}>Bem-vindo de volta</div>
                <div style={{ color: "#a1a1aa", marginBottom: 8, fontSize: 15, lineHeight: 1.55 }}>
                  O registo e o onboarding estão concluídos para esta sessão.
                </div>
                <div style={{ color: "#71717a", fontSize: 13, marginBottom: 20 }}>
                  <strong style={{ color: "#d4d4d8" }}>{currentUser || "—"}</strong>
                </div>
              </>
            ) : null}

            {loggedIn && onboardingComplete ? (
              <div
                style={{
                  background: DECIDE_DASHBOARD.panelSlate,
                  border: DECIDE_DASHBOARD.panelBorder,
                  borderRadius: 18,
                  padding: 16,
                  marginBottom: 16,
                }}
              >
                <a
                  href="/client-dashboard"
                  style={{
                    display: "inline-block",
                    background: DECIDE_DASHBOARD.buttonRegister,
                    color: DECIDE_DASHBOARD.kpiMenuMainButtonColor,
                    borderRadius: 14,
                    padding: "12px 20px",
                    textDecoration: "none",
                    border: DECIDE_DASHBOARD.kpiMenuMainButtonBorder,
                    fontWeight: 900,
                    boxShadow: DECIDE_DASHBOARD.kpiMenuMainButtonShadow,
                  }}
                >
                  Ir para o dashboard
                </a>
              </div>
            ) : null}

            {!loggedIn ? (
              <div
                style={{
                  background: DECIDE_DASHBOARD.panelSlate,
                  border: DECIDE_DASHBOARD.panelBorder,
                  borderRadius: 18,
                  padding: 16,
                }}
              >
                <div style={{ marginBottom: 12 }}>
                  <div style={{ color: DECIDE_DASHBOARD.textMuted, fontSize: 14, marginBottom: 8 }}>User</div>
                  <input
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    style={{
                      width: "100%",
                      background: "#27272a",
                      color: "#fff",
                      border: "1px solid rgba(63,63,70,0.85)",
                      borderRadius: 12,
                      padding: 12,
                      fontSize: 16,
                      outline: "none",
                    }}
                    placeholder="ex: client-001"
                  />
                </div>

                <div style={{ marginBottom: 14 }}>
                  <div style={{ color: DECIDE_DASHBOARD.textMuted, fontSize: 14, marginBottom: 8 }}>Password</div>
                  <input
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    type="password"
                    style={{
                      width: "100%",
                      background: "#27272a",
                      color: "#fff",
                      border: "1px solid rgba(63,63,70,0.85)",
                      borderRadius: 12,
                      padding: 12,
                      fontSize: 16,
                      outline: "none",
                    }}
                    placeholder="••••••••"
                  />
                </div>

                {error ? (
                  <div
                    style={{
                      background: "#2a0a0a",
                      border: "1px solid #7f1d1d",
                      borderRadius: 14,
                      padding: 12,
                      marginBottom: 12,
                      color: "#fee2e2",
                    }}
                  >
                    {error}
                  </div>
                ) : null}

                <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                  <button
                    type="button"
                    onClick={submit}
                    style={{
                      background: DECIDE_DASHBOARD.buttonRegister,
                      color: DECIDE_DASHBOARD.kpiMenuMainButtonColor,
                      borderRadius: 14,
                      padding: "12px 18px",
                      fontSize: 15,
                      fontWeight: 900,
                      border: DECIDE_DASHBOARD.kpiMenuMainButtonBorder,
                      cursor: "pointer",
                      boxShadow: DECIDE_DASHBOARD.kpiMenuMainButtonShadow,
                    }}
                  >
                    Entrar
                  </button>
                  <a
                    href="/client/register"
                    style={{
                      background: DECIDE_DASHBOARD.buttonSecondary,
                      color: "#e4e4e7",
                      borderRadius: 14,
                      padding: "12px 18px",
                      fontSize: 15,
                      fontWeight: 900,
                      border: "1px solid rgba(63,63,70,0.75)",
                      textDecoration: "none",
                      alignSelf: "center",
                    }}
                  >
                    Registo
                  </a>
                </div>
              </div>
            ) : null}
          </div>

        </div>
      </DecideClientShell>
    </>
  );
}
