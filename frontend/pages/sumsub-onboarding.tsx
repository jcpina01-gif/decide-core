import Head from "next/head";
import React, { useEffect, useMemo, useRef, useState } from "react";
import ClientFlowDashboardButton from "../components/ClientFlowDashboardButton";
import { useRouter } from "next/router";
import { DECIDE_APP_FONT_FAMILY, DECIDE_DASHBOARD, DECIDE_ONBOARDING } from "../lib/decideClientTheme";

type CreateResult = {
  ok?: boolean;
  record?: Record<string, any>;
  applicant?: Record<string, any>;
  error?: string;
};

type TokenResult = {
  ok?: boolean;
  token?: string;
  error?: string;
};

type StatusResult = {
  ok?: boolean;
  status?: Record<string, any>;
  error?: string;
};

const API_BASE = "http://127.0.0.1:8101";

function cardStyle(): React.CSSProperties {
  return {
    background: "rgba(24, 24, 27, 0.92)",
    border: "1px solid rgba(63, 63, 70, 0.75)",
    borderRadius: 22,
    padding: 20,
    boxShadow: "0 8px 30px rgba(0,0,0,0.18)",
  };
}

function inputStyle(): React.CSSProperties {
  return {
    width: "100%",
    background: "#27272a",
    color: "#fff",
    border: "1px solid rgba(63, 63, 70, 0.85)",
    borderRadius: 12,
    padding: 12,
    fontSize: 16,
    outline: "none",
  };
}

function Label({ children }: { children: React.ReactNode }) {
  return <div style={{ color: "#a1a1aa", fontSize: 14, marginBottom: 8 }}>{children}</div>;
}

function Button({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void | Promise<void>;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        background: disabled ? DECIDE_ONBOARDING.buttonDisabled : DECIDE_DASHBOARD.buttonRegister,
        color: "#fff",
        border: disabled ? DECIDE_ONBOARDING.inputBorder : DECIDE_ONBOARDING.buttonPrimaryBorder,
        borderRadius: 14,
        padding: "12px 18px",
        fontSize: 15,
        fontWeight: 800,
        cursor: disabled ? "not-allowed" : "pointer",
      }}
    >
      {children}
    </button>
  );
}

export default function SumsubOnboardingPage() {
  const router = useRouter();
  useEffect(() => {
    // Redirect legacy Sumsub route to Persona onboarding.
    router.replace("/persona-onboarding");
  }, [router]);

  const [externalUserId, setExternalUserId] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [levelName, setLevelName] = useState("basic-kyc-level");
  const [fixedInfoText, setFixedInfoText] = useState("{\n  \"country\": \"PT\"\n}");
  const [loading, setLoading] = useState(false);
  const [createResult, setCreateResult] = useState<CreateResult | null>(null);
  const [tokenResult, setTokenResult] = useState<TokenResult | null>(null);
  const [statusResult, setStatusResult] = useState<StatusResult | null>(null);
  const [error, setError] = useState("");
  const sdkContainerRef = useRef<HTMLDivElement | null>(null);

  const currentExternalUserId = useMemo(() => {
    return externalUserId.trim() || (createResult?.record?.external_user_id as string) || "";
  }, [externalUserId, createResult]);

  async function createApplicant() {
    setLoading(true);
    setError("");
    setTokenResult(null);
    setStatusResult(null);
    try {
      let fixedInfo: Record<string, any> | undefined;
      if (fixedInfoText.trim()) {
        fixedInfo = JSON.parse(fixedInfoText);
      }
      const res = await fetch(`${API_BASE}/api/sumsub/create-applicant`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          external_user_id: externalUserId || undefined,
          name,
          email,
          phone,
          level_name: levelName,
          fixed_info: fixedInfo,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        throw new Error(json.error || `HTTP ${res.status}`);
      }
      setCreateResult(json);
      if (!externalUserId && json.record?.external_user_id) {
        setExternalUserId(String(json.record.external_user_id));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao criar applicant");
    } finally {
      setLoading(false);
    }
  }

  async function fetchSdkToken(): Promise<string> {
    const id = currentExternalUserId;
    if (!id) {
      setError("Cria ou introduz primeiro um externalUserId.");
      return "";
    }
    setLoading(true);
    setError("");
    try {
      const url = `${API_BASE}/api/sumsub/sdk-token?external_user_id=${encodeURIComponent(id)}&level_name=${encodeURIComponent(levelName)}&ttl_secs=600`;
      const res = await fetch(url);
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setTokenResult(json);
      return String(json.token || "");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao gerar token");
      return "";
    } finally {
      setLoading(false);
    }
  }

  async function getSdkToken() {
    await fetchSdkToken();
  }

  async function refreshStatus() {
    const id = currentExternalUserId;
    if (!id) {
      setError("Cria ou introduz primeiro um externalUserId.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const url = `${API_BASE}/api/sumsub/status?external_user_id=${encodeURIComponent(id)}`;
      const res = await fetch(url);
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setStatusResult(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao obter estado");
    } finally {
      setLoading(false);
    }
  }

  async function copyToken() {
    const token = tokenResult?.token || "";
    if (!token) return;
    await navigator.clipboard.writeText(token);
  }

  useEffect(() => {
    let cancelled = false;

    async function mountSdk() {
      const token = tokenResult?.token;
      if (!token || !sdkContainerRef.current) {
        if (sdkContainerRef.current) sdkContainerRef.current.innerHTML = "";
        return;
      }

      try {
        const mod = await import("@sumsub/websdk");
        if (cancelled || !sdkContainerRef.current) return;

        const snsWebSdk = (mod as any).default || mod;
        sdkContainerRef.current.innerHTML = "";

        const instance = snsWebSdk
          .init(token, async () => fetchSdkToken())
          .withConf({
            lang: "pt",
            theme: "dark",
          })
          .withOptions({
            addViewportTag: false,
            adaptIframeHeight: true,
          })
          .on("idCheck.onStepCompleted", (payload: any) => {
            setStatusResult({ ok: true, status: { sdk_event: "idCheck.onStepCompleted", payload } });
          })
          .on("idCheck.onError", (payload: any) => {
            setStatusResult({ ok: false, error: "Sumsub SDK error", status: payload });
          })
          .build();

        instance.launch("#sumsub-websdk-container");
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Falha a inicializar o Sumsub WebSDK");
        }
      }
    }

    void mountSdk();

    return () => {
      cancelled = true;
      if (sdkContainerRef.current) {
        sdkContainerRef.current.innerHTML = "";
      }
    };
  }, [tokenResult?.token, levelName, currentExternalUserId]);

  return (
    // Route is immediately replaced; this is a fallback UI.
    <>
      <Head>
        <title>DECIDE | Sumsub Onboarding</title>
      </Head>
      <div
        style={{
          minHeight: "100vh",
          background: "#000",
          color: "#fff",
          padding: 32,
          fontFamily: DECIDE_APP_FONT_FAMILY,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", gap: 20, marginBottom: 24, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 40, fontWeight: 800 }}>DECIDE — Sumsub Onboarding</div>
            <div style={{ color: "#a1a1aa", fontSize: 18 }}>
              Fluxo sandbox para criar applicant, gerar SDK token e acompanhar o estado KYC.
            </div>
          </div>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
            <ClientFlowDashboardButton />
          </div>
        </div>

        {error ? (
          <div style={{ ...cardStyle(), marginBottom: 16, color: "#fecaca", borderColor: "#7f1d1d" }}>
            {error}
          </div>
        ) : null}

        <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: 20 }}>
          <div style={{ display: "grid", gap: 20 }}>
            <div style={cardStyle()}>
              <div style={{ fontSize: 24, fontWeight: 800, marginBottom: 16 }}>Dados do cliente</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                <div>
                  <Label>externalUserId (opcional)</Label>
                  <input value={externalUserId} onChange={(e) => setExternalUserId(e.target.value)} style={inputStyle()} placeholder="cliente-001" />
                </div>
                <div>
                  <Label>Nível Sumsub</Label>
                  <input value={levelName} onChange={(e) => setLevelName(e.target.value)} style={inputStyle()} placeholder="basic-kyc-level" />
                </div>
                <div>
                  <Label>Nome</Label>
                  <input value={name} onChange={(e) => setName(e.target.value)} style={inputStyle()} placeholder="João Silva" />
                </div>
                <div>
                  <Label>Email</Label>
                  <input value={email} onChange={(e) => setEmail(e.target.value)} style={inputStyle()} placeholder="joao@empresa.pt" />
                </div>
                <div>
                  <Label>Telefone</Label>
                  <input value={phone} onChange={(e) => setPhone(e.target.value)} style={inputStyle()} placeholder="+351..." />
                </div>
                <div>
                  <Label>Fixed info JSON</Label>
                  <textarea
                    value={fixedInfoText}
                    onChange={(e) => setFixedInfoText(e.target.value)}
                    rows={4}
                    style={{ ...inputStyle(), resize: "vertical" }}
                  />
                </div>
              </div>
              <div style={{ display: "flex", gap: 12, marginTop: 18, flexWrap: "wrap" }}>
                <Button onClick={createApplicant} disabled={loading}>{loading ? "A criar..." : "Criar applicant"}</Button>
                <Button onClick={getSdkToken} disabled={loading}>Gerar SDK token</Button>
                <Button onClick={refreshStatus} disabled={loading}>Atualizar estado</Button>
              </div>
            </div>

            <div style={cardStyle()}>
              <div style={{ fontSize: 24, fontWeight: 800, marginBottom: 16 }}>Sumsub SDK</div>
              <div style={{ color: "#a1a1aa", marginBottom: 12 }}>
                O token abaixo pode ser passado ao WebSDK do Sumsub quando a sandbox estiver pronta.
              </div>
              <div style={{ display: "grid", gap: 12 }}>
                <div>
                  <Label>externalUserId atual</Label>
                  <div style={{ ...inputStyle(), display: "flex", alignItems: "center", minHeight: 48 }}>
                    {currentExternalUserId || "—"}
                  </div>
                </div>
                <div>
                  <Label>SDK token</Label>
                  <pre
                    style={{
                      ...inputStyle(),
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-all",
                      minHeight: 120,
                      margin: 0,
                    }}
                  >
                    {tokenResult?.token || "—"}
                  </pre>
                </div>
                <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                  <Button onClick={copyToken} disabled={!tokenResult?.token}>Copiar token</Button>
                </div>
                <div
                  id="sumsub-websdk-container"
                  ref={sdkContainerRef}
                  style={{
                    marginTop: 8,
                    minHeight: 720,
                    borderRadius: 16,
                    overflow: "hidden",
                    border: "1px solid rgba(63, 63, 70, 0.85)",
                    background: "#061126",
                  }}
                />
              </div>
            </div>
          </div>

          <div style={{ display: "grid", gap: 20 }}>
            <div style={cardStyle()}>
              <div style={{ fontSize: 24, fontWeight: 800, marginBottom: 16 }}>Resultado do create applicant</div>
              <pre style={{ ...inputStyle(), whiteSpace: "pre-wrap", margin: 0, minHeight: 300, overflow: "auto" }}>
{JSON.stringify(createResult || { ok: false, info: "Ainda sem criação." }, null, 2)}
              </pre>
            </div>

            <div style={cardStyle()}>
              <div style={{ fontSize: 24, fontWeight: 800, marginBottom: 16 }}>Estado KYC atual</div>
              <pre style={{ ...inputStyle(), whiteSpace: "pre-wrap", margin: 0, minHeight: 220, overflow: "auto" }}>
{JSON.stringify(statusResult || { ok: false, info: "Ainda sem consulta de estado." }, null, 2)}
              </pre>
            </div>

            <div style={cardStyle()}>
              <div style={{ fontSize: 24, fontWeight: 800, marginBottom: 16 }}>Passos seguintes</div>
              <div style={{ color: "#dbeafe", lineHeight: 1.7 }}>
                <div>1. Criar applicant no sandbox.</div>
                <div>2. Gerar SDK token e inicializar o WebSDK no frontend.</div>
                <div>3. Acompanhar o estado em `Sumsub Admin` ou via webhook.</div>
                <div style={{ marginTop: 10, color: "#a1a1aa" }}>
                  Quando tiver o email de empresa, trocamos o sandbox por credenciais de teste apropriadas e ligamos o fluxo ao seu onboarding real.
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

