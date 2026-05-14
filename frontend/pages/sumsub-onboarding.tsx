import React, { useCallback, useEffect, useRef, useState } from "react";
import type { GetServerSideProps } from "next";
import Head from "next/head";
import { useRouter } from "next/router";
import OnboardingFlowBar, {
  ONBOARDING_LOCALSTORAGE_CHANGED_EVENT,
  ONBOARDING_STORAGE_KEYS,
} from "../components/OnboardingFlowBar";
import { getCurrentSessionUser, getCurrentSessionUserEmail } from "../lib/clientAuth";
import { buildSumsubExternalUserIdFromSession } from "../lib/sumsubReference";
import {
  DECIDE_ONBOARDING,
  ONBOARDING_PRIMARY_CTA_MAX_WIDTH_PX,
  ONBOARDING_SHELL_MAX_WIDTH_PX,
} from "../lib/decideClientTheme";
import { getNextOnboardingHref } from "../lib/onboardingProgress";

const LEVEL_NAME = process.env.NEXT_PUBLIC_SUMSUB_LEVEL_NAME || "basic-kyc-level";

function bumpOnboardingFlowBar() {
  try {
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event(ONBOARDING_LOCALSTORAGE_CHANGED_EVENT));
    }
  } catch {
    // ignore
  }
}

type SdkStatus =
  | "idle"
  | "loading-token"
  | "ready"
  | "submitted"
  | "approved"
  | "rejected"
  | "error";

export default function SumsubOnboardingPage() {
  const router = useRouter();

  const [externalUserId, setExternalUserId] = useState("");
  const [sdkStatus, setSdkStatus] = useState<SdkStatus>("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [saveError, setSaveError] = useState("");
  const [kycDoneAlready, setKycDoneAlready] = useState(false);

  const sdkContainerRef = useRef<HTMLDivElement | null>(null);
  const sdkInstanceRef = useRef<{ destroy?: () => void } | null>(null);

  useEffect(() => {
    const uid = buildSumsubExternalUserIdFromSession();
    setExternalUserId(uid);
    try {
      const done = window.localStorage.getItem(ONBOARDING_STORAGE_KEYS.kyc) === "1";
      setKycDoneAlready(done);
    } catch {
      // ignore
    }
  }, []);

  const fetchToken = useCallback(async (): Promise<string> => {
    if (!externalUserId) return "";
    const res = await fetch("/api/sumsub/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ external_user_id: externalUserId, level_name: LEVEL_NAME, ttl_secs: 1800 }),
    });
    const json = (await res.json()) as { ok?: boolean; token?: string; error?: string };
    if (!res.ok || !json.ok || !json.token) {
      throw new Error(json.error || `HTTP ${res.status}`);
    }
    return json.token;
  }, [externalUserId]);

  const saveRecord = useCallback(
    async (opts: {
      status: string;
      review_answer?: string;
      applicant_id?: string;
      name?: string;
      fields?: Record<string, unknown>;
    }) => {
      try {
        await fetch("/api/sumsub/record", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            external_user_id: externalUserId,
            email: getCurrentSessionUserEmail() || undefined,
            ...opts,
          }),
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setSaveError(msg);
      }
    },
    [externalUserId],
  );

  const markKycDone = useCallback(() => {
    try {
      window.localStorage.setItem(ONBOARDING_STORAGE_KEYS.kyc, "1");
      bumpOnboardingFlowBar();
      setKycDoneAlready(true);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    if (!externalUserId) return;
    let cancelled = false;

    async function launch() {
      setSdkStatus("loading-token");
      setErrorMsg("");
      setSaveError("");

      let token: string;
      try {
        token = await fetchToken();
      } catch (e) {
        if (!cancelled) {
          setErrorMsg(e instanceof Error ? e.message : "Erro ao gerar token Sumsub");
          setSdkStatus("error");
        }
        return;
      }
      if (cancelled) return;

      try {
        const mod = await import("@sumsub/websdk");
        if (cancelled || !sdkContainerRef.current) return;

        const snsWebSdk = (mod as { default?: unknown }).default ?? mod;
        if (sdkContainerRef.current) sdkContainerRef.current.innerHTML = "";

        /* eslint-disable @typescript-eslint/no-explicit-any */
        const instance = (snsWebSdk as any)
          .init(token, async () => {
            try { return await fetchToken(); } catch { return ""; }
          })
          .withConf({ lang: "pt", theme: "dark" })
          .withOptions({ addViewportTag: false, adaptIframeHeight: true })
          .on("idCheck.onApplicantLoaded", (p: any) => {
            if (!cancelled) setSdkStatus("ready");
            void saveRecord({
              status: "init",
              applicant_id: String(p?.applicantId || p?.id || ""),
            });
          })
          .on("idCheck.onApplicantStatusChanged", (p: any) => {
            const reviewStatus: string = p?.reviewStatus || "";
            const reviewAnswer: string = p?.reviewResult?.reviewAnswer || "";
            if (!cancelled) {
              if (reviewAnswer === "GREEN") setSdkStatus("approved");
              else if (reviewAnswer === "RED") setSdkStatus("rejected");
              else if (reviewStatus) setSdkStatus("submitted");
            }
            void saveRecord({
              status: reviewStatus || "pending",
              review_answer: reviewAnswer || undefined,
              applicant_id: String(p?.applicantId || ""),
              fields: p ?? undefined,
            });
            if (reviewAnswer === "GREEN" || ["completed", "prechecked", "queued", "onhold"].includes(reviewStatus.toLowerCase())) {
              markKycDone();
            }
          })
          .on("idCheck.onComplete", (p: any) => {
            const reviewStatus: string = p?.reviewStatus || "completed";
            const reviewAnswer: string = p?.reviewResult?.reviewAnswer || "";
            if (!cancelled) {
              if (reviewAnswer === "GREEN") setSdkStatus("approved");
              else setSdkStatus("submitted");
            }
            void saveRecord({
              status: reviewStatus,
              review_answer: reviewAnswer || undefined,
              applicant_id: String(p?.applicantId || ""),
              fields: p ?? undefined,
            });
            markKycDone();
          })
          .on("idCheck.onError", (p: any) => {
            if (!cancelled) {
              setErrorMsg(p?.message || "Erro no processo de verificação Sumsub");
              setSdkStatus("error");
            }
          })
          .build();
        /* eslint-enable @typescript-eslint/no-explicit-any */

        instance.launch("#sumsub-sdk-container");
        sdkInstanceRef.current = instance as { destroy?: () => void };
        if (!cancelled) setSdkStatus("ready");
      } catch (e) {
        if (!cancelled) {
          setErrorMsg(e instanceof Error ? e.message : "Falha a inicializar o Sumsub WebSDK");
          setSdkStatus("error");
        }
      }
    }

    void launch();

    return () => {
      cancelled = true;
      if (sdkInstanceRef.current?.destroy) {
        try { sdkInstanceRef.current.destroy(); } catch { /* ignore */ }
      }
      sdkInstanceRef.current = null;
      if (sdkContainerRef.current) sdkContainerRef.current.innerHTML = "";
    };
  }, [externalUserId, fetchToken, saveRecord, markKycDone]);

  function handleContinue() {
    void router.push(getNextOnboardingHref());
  }

  const isError = sdkStatus === "error";
  const isDone = kycDoneAlready || sdkStatus === "approved" || sdkStatus === "submitted";

  return (
    <>
      <Head>
        <title>DECIDE | Verificação de identidade</title>
      </Head>
      <div
        style={{
          minHeight: "100vh",
          background: DECIDE_ONBOARDING.pageBg,
          color: DECIDE_ONBOARDING.text,
          fontFamily: "Inter, system-ui, sans-serif",
        }}
      >
        <OnboardingFlowBar currentStep="kyc" />

        <div
          style={{
            maxWidth: ONBOARDING_SHELL_MAX_WIDTH_PX,
            margin: "0 auto",
            padding: "32px 20px 80px",
          }}
        >
          {/* Header */}
          <div style={{ marginBottom: 28 }}>
            <div style={{ fontSize: 26, fontWeight: 800, marginBottom: 6 }}>
              Verificação de identidade
            </div>
            <div style={{ color: DECIDE_ONBOARDING.textLabel, fontSize: 15, lineHeight: 1.55 }}>
              Para cumprimento regulamentar (MiFID II / AML), precisamos de confirmar a sua
              identidade. O processo demora cerca de 3 minutos.
            </div>
          </div>

          {/* Already done banner */}
          {kycDoneAlready && sdkStatus !== "rejected" && (
            <div
              style={{
                background: "rgba(16,185,129,0.08)",
                border: "1px solid rgba(16,185,129,0.35)",
                borderRadius: 14,
                padding: "14px 18px",
                marginBottom: 20,
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
                flexWrap: "wrap",
              }}
            >
              <div style={{ color: "#34d399", fontWeight: 700, fontSize: 15 }}>
                ✓ Verificação de identidade concluída
              </div>
              <button
                onClick={handleContinue}
                style={{
                  background: "rgba(16,185,129,0.18)",
                  border: "1px solid rgba(16,185,129,0.45)",
                  borderRadius: 10,
                  color: "#34d399",
                  fontWeight: 700,
                  fontSize: 14,
                  padding: "8px 18px",
                  cursor: "pointer",
                }}
              >
                Continuar →
              </button>
            </div>
          )}

          {/* Error banner */}
          {isError && errorMsg && (
            <div
              style={{
                background: "rgba(239,68,68,0.08)",
                border: "1px solid rgba(239,68,68,0.35)",
                borderRadius: 14,
                padding: "14px 18px",
                marginBottom: 20,
                color: "#fca5a5",
              }}
            >
              <strong>Erro:</strong> {errorMsg}
              <div style={{ marginTop: 6, fontSize: 13, color: DECIDE_ONBOARDING.textLabel }}>
                Verifique a ligação à internet e recarregue a página. Se o problema persistir,
                contacte o suporte DECIDE.
              </div>
            </div>
          )}

          {/* Save error (non-blocking) */}
          {saveError && (
            <div
              style={{
                background: "rgba(234,179,8,0.08)",
                border: "1px solid rgba(234,179,8,0.3)",
                borderRadius: 12,
                padding: "10px 16px",
                marginBottom: 16,
                color: "#fde047",
                fontSize: 13,
              }}
            >
              Aviso: não foi possível gravar o registo no servidor ({saveError}). O processo de
              verificação continua normalmente.
            </div>
          )}

          {/* Loading token */}
          {sdkStatus === "loading-token" && (
            <div
              style={{
                color: DECIDE_ONBOARDING.textLabel,
                fontSize: 14,
                marginBottom: 16,
                animationDuration: "1.5s",
              }}
            >
              A inicializar verificação…
            </div>
          )}

          {/* SDK container */}
          <div
            id="sumsub-sdk-container"
            ref={sdkContainerRef}
            style={{
              borderRadius: 18,
              overflow: "hidden",
              border: "1px solid rgba(63,63,70,0.7)",
              background: "#060d1a",
              minHeight: sdkStatus === "idle" || sdkStatus === "loading-token" ? 0 : 640,
            }}
          />

          {/* Approved / submitted state CTA */}
          {isDone && (
            <div style={{ marginTop: 28, maxWidth: ONBOARDING_PRIMARY_CTA_MAX_WIDTH_PX }}>
              <button
                onClick={handleContinue}
                style={{
                  width: "100%",
                  background: DECIDE_ONBOARDING.buttonPrimaryBg,
                  border: DECIDE_ONBOARDING.buttonPrimaryBorder,
                  borderRadius: 14,
                  color: "#fff",
                  fontWeight: 800,
                  fontSize: 16,
                  padding: "14px 24px",
                  cursor: "pointer",
                }}
              >
                Continuar →
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

export const getServerSideProps: GetServerSideProps = async () => {
  return { props: {} };
};
