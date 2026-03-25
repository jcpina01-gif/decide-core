import React, { useEffect, useState } from "react";
import Head from "next/head";
import OnboardingFlowBar from "../../components/OnboardingFlowBar";
import {
  getCurrentSessionUser,
  isClientLoggedIn,
  loginClientUser,
} from "../../lib/clientAuth";
import { getNextOnboardingHref, isOnboardingFlowComplete } from "../../lib/onboardingProgress";

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
      <div style={{ minHeight: "100vh", background: "#000", color: "#fff", padding: 32, fontFamily: "Inter, Arial, sans-serif" }}>
        <div style={{ maxWidth: 920, margin: "0 auto" }}>
          {!(loggedIn && onboardingComplete) ? (
            <OnboardingFlowBar
              currentStepId="auth"
              authStepHref="/client/login"
              authStepPending={loggedIn && !onboardingComplete}
            />
          ) : null}

          <div style={{ maxWidth: 520, marginTop: 20 }}>
            {!loggedIn ? (
              <>
                <div style={{ fontSize: 34, fontWeight: 800, marginBottom: 6 }}>DECIDE — Login</div>
                <div style={{ color: "#94a3b8", marginBottom: 20, fontSize: 15, lineHeight: 1.5 }}>
                  Introduza o utilizador e a palavra-passe para continuar.
                </div>
              </>
            ) : null}

            {loggedIn && !onboardingComplete ? (
              <>
                <div style={{ fontSize: 34, fontWeight: 800, marginBottom: 10 }}>Conta criada com sucesso</div>
                <div style={{ color: "#94a3b8", marginBottom: 8, fontSize: 15, lineHeight: 1.55 }}>
                  Vamos configurar o seu perfil de investimento.
                </div>
                <div style={{ color: "#64748b", fontSize: 13, marginBottom: 20 }}>
                  Sessão: <strong style={{ color: "#cbd5e1" }}>{currentUser || "—"}</strong>
                </div>
              </>
            ) : null}

            {loggedIn && onboardingComplete ? (
              <>
                <div style={{ fontSize: 34, fontWeight: 800, marginBottom: 10 }}>Bem-vindo de volta</div>
                <div style={{ color: "#94a3b8", marginBottom: 8, fontSize: 15, lineHeight: 1.55 }}>
                  O registo e o onboarding estão concluídos para esta sessão.
                </div>
                <div style={{ color: "#64748b", fontSize: 13, marginBottom: 20 }}>
                  <strong style={{ color: "#cbd5e1" }}>{currentUser || "—"}</strong>
                </div>
              </>
            ) : null}

            {loggedIn && onboardingComplete ? (
              <div style={{ background: "#12244d", border: "1px solid #15305b", borderRadius: 18, padding: 16, marginBottom: 16 }}>
                <a
                  href="/client-dashboard"
                  style={{
                    display: "inline-block",
                    background: "#3f73ff",
                    color: "#fff",
                    borderRadius: 14,
                    padding: "12px 20px",
                    textDecoration: "none",
                    border: "1px solid rgba(255,255,255,0.28)",
                    fontWeight: 900,
                  }}
                >
                  Ir para o dashboard
                </a>
              </div>
            ) : null}

            {!loggedIn ? (
              <div style={{ background: "#12244d", border: "1px solid #15305b", borderRadius: 18, padding: 16 }}>
                <div style={{ marginBottom: 12 }}>
                  <div style={{ color: "#9fb3d1", fontSize: 14, marginBottom: 8 }}>User</div>
                  <input
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    style={{
                      width: "100%",
                      background: "#020816",
                      color: "#fff",
                      border: "1px solid #15305b",
                      borderRadius: 12,
                      padding: 12,
                      fontSize: 16,
                      outline: "none",
                    }}
                    placeholder="ex: client-001"
                  />
                </div>

                <div style={{ marginBottom: 14 }}>
                  <div style={{ color: "#9fb3d1", fontSize: 14, marginBottom: 8 }}>Password</div>
                  <input
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    type="password"
                    style={{
                      width: "100%",
                      background: "#020816",
                      color: "#fff",
                      border: "1px solid #15305b",
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
                      background: "#3f73ff",
                      color: "#fff",
                      borderRadius: 14,
                      padding: "12px 18px",
                      fontSize: 15,
                      fontWeight: 900,
                      border: "1px solid rgba(255,255,255,0.28)",
                      cursor: "pointer",
                    }}
                  >
                    Entrar
                  </button>
                  <a
                    href="/client/register"
                    style={{
                      background: "#12244d",
                      color: "#fff",
                      borderRadius: 14,
                      padding: "12px 18px",
                      fontSize: 15,
                      fontWeight: 900,
                      border: "1px solid rgba(255,255,255,0.18)",
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

          {loggedIn && !onboardingComplete ? (
            <div
              style={{
                display: "flex",
                justifyContent: "center",
                width: "100%",
                marginTop: 8,
                marginBottom: 24,
              }}
            >
              <div
                style={{
                  background: "#12244d",
                  border: "1px solid #15305b",
                  borderRadius: 18,
                  padding: 20,
                  width: "100%",
                  maxWidth: 400,
                  boxSizing: "border-box",
                }}
              >
                <a
                  href={getNextOnboardingHref()}
                  style={{
                    display: "block",
                    width: "100%",
                    textAlign: "center",
                    boxSizing: "border-box",
                    background: "linear-gradient(180deg, #7eb0ff 0%, #3558f5 100%)",
                    color: "#fff",
                    borderRadius: 14,
                    padding: "14px 18px",
                    textDecoration: "none",
                    border: "2px solid rgba(255,255,255,0.35)",
                    fontWeight: 900,
                    fontSize: 16,
                    boxShadow: "0 10px 28px rgba(53, 88, 245, 0.45)",
                  }}
                >
                  Continuar
                </a>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </>
  );
}
