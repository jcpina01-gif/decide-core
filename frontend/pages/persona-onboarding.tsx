import React, { useEffect, useMemo, useRef, useState } from "react";
import Head from "next/head";
import OnboardingFlowBar, {
  ONBOARDING_LOCALSTORAGE_CHANGED_EVENT,
  ONBOARDING_STORAGE_KEYS,
} from "../components/OnboardingFlowBar";
import { getCurrentSessionUser, getCurrentSessionUserEmail, getCurrentSessionUserPhone } from "../lib/clientAuth";
import { getResolvedPersonaEnvironmentId, getResolvedPersonaTemplateId } from "../lib/personaPublicEnv";
import { buildReferenceIdFromUserAndEmail } from "../lib/personaReference";

function bumpOnboardingFlowBarFromLocalStorage() {
  try {
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event(ONBOARDING_LOCALSTORAGE_CHANGED_EVENT));
    }
  } catch {
    // ignore
  }
}

type PersonaCompletePayload = {
  inquiryId?: string;
  status?: string;
  fields?: Record<string, any>;
  [key: string]: any;
};

type LastPersonaComplete = {
  inquiryId: string;
  status: string;
  fields: Record<string, any>;
  fullName: string;
};

function cardStyle(): React.CSSProperties {
  return {
    background: "#020b24",
    border: "1px solid #15305b",
    borderRadius: 22,
    padding: 20,
    boxShadow: "0 8px 30px rgba(0,0,0,0.18)",
  };
}

function inputStyle(): React.CSSProperties {
  return {
    width: "100%",
    background: "#020816",
    color: "#fff",
    border: "1px solid #15305b",
    borderRadius: 12,
    padding: 12,
    fontSize: 16,
    outline: "none",
  };
}

function Label({ children }: { children: React.ReactNode }) {
  return <div style={{ color: "#9fb3d1", fontSize: 14, marginBottom: 8 }}>{children}</div>;
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
        background: disabled ? "#334155" : "#3f73ff",
        color: "#fff",
        border: "1px solid rgba(255,255,255,0.28)",
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

function safeFieldString(v: any): string {
  // Persona may return fields as primitives or as objects like { value: "..." }.
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  if (typeof v === "object") {
    if (typeof v.value === "string") return v.value;
    if (typeof v.value === "number" && Number.isFinite(v.value)) return String(v.value);
  }
  return "";
}

function guessFullNameFromPersonaFields(fieldsOut: Record<string, any>): string {
  const entries = Object.entries(fieldsOut || {});
  const byKey = (key: string) => {
    const found = entries.find(([k]) => k.toLowerCase() === key.toLowerCase());
    return found ? safeFieldString(fieldsOut[found[0]]) : "";
  };

  // Common "full name" keys first
  const fullCandidates = ["full_name", "fullname", "fullName", "name", "complete_name", "customer_name"];
  for (const k of fullCandidates) {
    const v = byKey(k);
    if (v.trim()) return v.trim();
  }

  // Then try first+last style keys
  const firstCandidates = ["first_name", "firstname", "firstName", "given_name", "givenName"];
  const lastCandidates = ["last_name", "lastname", "lastName", "family_name", "familyName"];

  let first = "";
  for (const k of firstCandidates) {
    const v = byKey(k);
    if (v.trim()) {
      first = v.trim();
      break;
    }
  }

  let last = "";
  for (const k of lastCandidates) {
    const v = byKey(k);
    if (v.trim()) {
      last = v.trim();
      break;
    }
  }

  const combined = `${first} ${last}`.trim();
  if (combined) return combined;

  return "";
}

/** Tenta obter nome completo mesmo com estruturas aninhadas da Persona. */
function extractFullNameFromPersonaFields(fieldsOut: Record<string, any>): string {
  const direct = guessFullNameFromPersonaFields(fieldsOut);
  if (direct) return direct;

  const walk = (obj: any, depth: number): string => {
    if (!obj || depth > 6) return "";
    if (typeof obj === "string") {
      const t = obj.trim();
      if (t.length >= 3 && t.length < 200 && /\s/.test(t)) return t;
    }
    if (typeof obj !== "object" || Array.isArray(obj)) return "";
    for (const [k, v] of Object.entries(obj)) {
      const kl = k.toLowerCase();
      if (
        kl.includes("name") ||
        kl.includes("nome") ||
        kl === "full_name" ||
        kl === "legal_name"
      ) {
        const s = safeFieldString(v);
        if (s.trim()) return s.trim();
      }
    }
    for (const v of Object.values(obj)) {
      const nested = walk(v, depth + 1);
      if (nested) return nested;
    }
    return "";
  };

  return walk(fieldsOut, 0);
}

/** Junta raiz do callback com `fields` — por vezes a Persona coloca chaves fora de `fields`. */
function extractFullNameFromPersonaPayload(payload: PersonaCompletePayload | null | undefined): string {
  if (!payload || typeof payload !== "object") return "";
  const fields = payload.fields && typeof payload.fields === "object" ? payload.fields : {};
  const merged: Record<string, any> = { ...fields };
  for (const [k, v] of Object.entries(payload)) {
    if (k === "fields" || k === "inquiryId" || k === "status") continue;
    if (merged[k] === undefined) merged[k] = v;
  }
  return extractFullNameFromPersonaFields(merged);
}

/** Validação leve dos IDs — erros comuns → 400 "Could not load template". */
function validatePersonaPublicIds(templateId: string, environmentId: string, templateVersionId: string): string | null {
  const t = templateId.trim();
  const e = environmentId.trim();
  if (!t.startsWith("itmpl_") && !t.startsWith("tmpl_")) {
    return "O templateId tem de começar por itmpl_ ou tmpl_ (Persona Dashboard → Inquiry templates → copiar ID).";
  }
  if (!e.startsWith("env_")) {
    return "O environmentId tem de começar por env_ (Dashboard → Settings → API → Environment ID).";
  }
  const tv = templateVersionId.trim();
  if (tv && !tv.startsWith("itmplv_")) {
    return "O templateVersionId tem de começar por itmplv_ (versão publicada do template).";
  }
  return null;
}

export default function PersonaOnboardingPage() {
  const [externalUserId, setExternalUserId] = useState("");
  const [email, setEmail] = useState("");
  /** Nome extraído automaticamente do callback Persona (pode ficar vazio se `fields` vier {}). */
  const [verifiedFullName, setVerifiedFullName] = useState("");
  /** Se a Persona não devolver nome, o cliente confirma manualmente (como no documento). */
  const [manualFullName, setManualFullName] = useState("");
  /** Só quando já há nome da Persona: correção opcional (deixe vazio se o capturado estiver certo). */
  const [optionalNameCorrection, setOptionalNameCorrection] = useState("");

  // From Persona dashboard (inquiry template + environment)
  const [templateId, setTemplateId] = useState(getResolvedPersonaTemplateId());
  const [templateVersionId, setTemplateVersionId] = useState(process.env.NEXT_PUBLIC_PERSONA_TEMPLATE_VERSION_ID || "");
  const [environmentId, setEnvironmentId] = useState(getResolvedPersonaEnvironmentId());

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [recordSaveWarning, setRecordSaveWarning] = useState("");
  const [statusResult, setStatusResult] = useState<Record<string, any> | null>(null);
  /** Só true após `/api/persona/record` OK — única fonte para desbloquear IBKR e stepper. */
  const [backendSaveConfirmed, setBackendSaveConfirmed] = useState(false);
  const [persistInFlight, setPersistInFlight] = useState(false);

  const personaClientRef = useRef<any>(null);
  const lastPersonaCompleteRef = useRef<LastPersonaComplete | null>(null);

  const referenceId = useMemo(
    () => buildReferenceIdFromUserAndEmail(externalUserId, email),
    [externalUserId, email],
  );

  /** Se preencheu correção (ex.: após falha ao guardar), essa versão prevalece sobre o nome capturado. */
  const effectiveFullName = useMemo(() => {
    const opt = optionalNameCorrection.trim();
    if (opt) return opt;
    return (verifiedFullName.trim() || manualFullName.trim()).trim();
  }, [optionalNameCorrection, verifiedFullName, manualFullName]);

  useEffect(() => {
    // Remember Persona template/environment locally to avoid manual re-entry.
    try {
      const sessionUser = getCurrentSessionUser();
      if (sessionUser) setExternalUserId(sessionUser);

      setVerifiedFullName("");
      setManualFullName("");
      setOptionalNameCorrection("");
      setRecordSaveWarning("");
      const sessionEmail = getCurrentSessionUserEmail();
      setEmail(sessionEmail || "");

      const t = window.localStorage.getItem("persona_templateId") || "";
      const tv = window.localStorage.getItem("persona_templateVersionId") || "";
      const e = window.localStorage.getItem("persona_environmentId") || "";
      if (!templateId.trim() && t.trim()) setTemplateId(t);
      if (!templateVersionId.trim() && tv.trim()) setTemplateVersionId(tv);
      if (!environmentId.trim() && e.trim()) setEnvironmentId(e);
    } catch {}

    return () => {
      try {
        personaClientRef.current?.destroy?.();
      } catch {}
      personaClientRef.current = null;
    };
    // Intentionally run once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Para evitar mismatches de origem (127.0.0.1 vs localhost) no embedded flow:
  // se o utilizador abriu a página via 127.0.0.1, redireciona para localhost.
  useEffect(() => {
    try {
      if (typeof window === "undefined") return;
      if (window.location.hostname === "127.0.0.1") {
        window.location.replace(window.location.href.replace("127.0.0.1", "localhost"));
      }
    } catch {
      // ignore
    }
  }, []);

  // KYC no localStorage só passa a "1" após gravação bem-sucedida no backend (onComplete).
  // Ao entrar: repor aprovação IBKR; não limpar kyc aqui (permite refresh após sucesso).
  useEffect(() => {
    try {
      window.localStorage.setItem(ONBOARDING_STORAGE_KEYS.approve, "0");
      window.localStorage.setItem("decide_onboarding_ibkr_prep_done_v1", "0");
      bumpOnboardingFlowBarFromLocalStorage();
    } catch {
      // ignore
    }
  }, []);

  async function savePersonaRecord(payload: {
    reference_id: string;
    inquiry_id?: string;
    status: string;
    fields?: Record<string, any>;
    nameOverride?: string;
  }) {
    const res = await fetch("/api/persona/record", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        reference_id: payload.reference_id,
        external_user_id: externalUserId || referenceId,
        name: (payload.nameOverride ?? effectiveFullName) || undefined,
        email: email || getCurrentSessionUserEmail() || undefined,
        phone: getCurrentSessionUserPhone() || undefined,
        inquiry_id: payload.inquiry_id,
        status: payload.status,
        fields: payload.fields || {},
      }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.ok) {
      const parts = [typeof json?.error === "string" ? json.error : null, typeof json?.hint === "string" ? json.hint : null].filter(
        Boolean
      ) as string[];
      throw new Error(parts.length ? parts.join(" — ") : `HTTP ${res.status}`);
    }
    return json;
  }

  async function retryPersistPersonaComplete() {
    const last = lastPersonaCompleteRef.current;
    if (!last || !referenceId) return;
    setPersistInFlight(true);
    setRecordSaveWarning("");
    try {
      await savePersonaRecord({
        reference_id: referenceId,
        inquiry_id: last.inquiryId,
        status: last.status,
        fields: last.fields,
        nameOverride: (effectiveFullName || last.fullName) || undefined,
      });
      setBackendSaveConfirmed(true);
      setOptionalNameCorrection("");
      try {
        window.localStorage.setItem(ONBOARDING_STORAGE_KEYS.kyc, "1");
        bumpOnboardingFlowBarFromLocalStorage();
      } catch {
        // ignore
      }
      setStatusResult({
        ok: true,
        stage: "persona-complete-saved",
        inquiryId: last.inquiryId,
        status: last.status,
        fields: last.fields,
        verifiedFullName: verifiedFullName.trim() || manualFullName.trim() || last.fullName,
      });
    } catch {
      setBackendSaveConfirmed(false);
      try {
        window.localStorage.setItem(ONBOARDING_STORAGE_KEYS.kyc, "0");
        bumpOnboardingFlowBarFromLocalStorage();
      } catch {
        // ignore
      }
      setRecordSaveWarning(
        "A verificação foi concluída, mas não conseguimos guardar a confirmação no sistema. Tente novamente — sem esta confirmação não pode avançar para o passo seguinte.",
      );
      setStatusResult((prev) => ({
        ...(prev || {}),
        ok: false,
        stage: "persona-save-failed",
        inquiryId: last.inquiryId,
        status: last.status,
        fields: last.fields,
      }));
    } finally {
      setPersistInFlight(false);
    }
  }

  async function startFlow() {
    setError("");
    setManualFullName("");
    setStatusResult({
      ok: false,
      stage: "starting",
      referenceId,
    });

    if (!templateId.trim()) {
      setError("Não foi possível iniciar a verificação. Tente mais tarde ou contacte o suporte.");
      if (process.env.NODE_ENV === "development") console.warn("[Persona] Falta templateId em ENV");
      setStatusResult({ ok: false, stage: "missing-templateId", referenceId });
      return;
    }
    if (!environmentId.trim()) {
      setError("Não foi possível iniciar a verificação. Tente mais tarde ou contacte o suporte.");
      if (process.env.NODE_ENV === "development") console.warn("[Persona] Falta environmentId em ENV");
      setStatusResult({ ok: false, stage: "missing-environmentId", referenceId });
      return;
    }
    if (!referenceId) {
      setError("Inicie sessão novamente para continuar a verificação de identidade.");
      setStatusResult({ ok: false, stage: "missing-referenceId", referenceId });
      return;
    }
    if (templateVersionId.trim() && !templateVersionId.trim().startsWith("itmplv_")) {
      setError("Não foi possível iniciar a verificação. Tente mais tarde ou contacte o suporte.");
      if (process.env.NODE_ENV === "development") console.warn("[Persona] templateVersionId inválido");
      setStatusResult({ ok: false, stage: "invalid-templateVersionId", referenceId });
      return;
    }

    const idErr = validatePersonaPublicIds(templateId, environmentId, templateVersionId);
    if (idErr) {
      setError("Não foi possível iniciar a verificação. Tente mais tarde ou contacte o suporte.");
      if (process.env.NODE_ENV === "development") console.warn("[Persona]", idErr);
      setStatusResult({ ok: false, stage: "invalid-persona-ids", referenceId });
      return;
    }

    // Cleanup previous client if any
    try {
      personaClientRef.current?.destroy?.();
    } catch {}
    personaClientRef.current = null;

    setLoading(true);
    try {
      const PersonaMod: any = await import("persona");
      const Persona = PersonaMod?.default ? PersonaMod.default : PersonaMod;

      /**
       * Só preenchemos chaves que existam no teu template (API name no Persona).
       * Se a chave não existir no fluxo, o widget pode responder 400 — por isso é opt-in via env.
       */
      const fields: Record<string, string> = {};
      const phoneFieldKey = (process.env.NEXT_PUBLIC_PERSONA_PREFILL_PHONE_FIELD || "").trim();
      const sessionPhone = getCurrentSessionUserPhone();
      if (phoneFieldKey && sessionPhone) {
        fields[phoneFieldKey] = sessionPhone;
      }
      const emailFieldKey = (process.env.NEXT_PUBLIC_PERSONA_PREFILL_EMAIL_FIELD || "").trim();
      const sessionEmailNow = getCurrentSessionUserEmail();
      if (emailFieldKey && sessionEmailNow) {
        fields[emailFieldKey] = sessionEmailNow;
      }

      let client: any;

      const personaHostRaw = (process.env.NEXT_PUBLIC_PERSONA_HOST || "").trim().toLowerCase();
      const personaHostOpt =
        personaHostRaw === "development" ||
        personaHostRaw === "staging" ||
        personaHostRaw === "canary" ||
        personaHostRaw === "production"
          ? (personaHostRaw as "development" | "staging" | "canary" | "production")
          : personaHostRaw
            ? personaHostRaw
            : undefined;

      /** O SDK Persona cria um overlay fullscreen; não aninhar dentro de #persona-flow-container (overflow:hidden / caixa pequena) — o modal ficava invisível ou sem «open». */
      const embedParent = typeof document !== "undefined" ? document.body : undefined;
      let opened = false;
      const tryOpenPersona = (reason: string) => {
        try {
          if (opened) return;
          if (!client || typeof client.open !== "function") return;
          opened = true;
          client.open();
          setStatusResult((prev: any) => ({
            ...(prev || {}),
            ok: false,
            stage: "persona-open-invoked",
            openReason: reason,
            referenceId,
          }));
        } catch {
          // keep callback-specific handlers as source of user-facing errors
        }
      };
      const pageOrigin =
        typeof window !== "undefined" ? window.location.origin : "http://localhost:4701";
      // messageTargetOrigin tem de coincidir com a origem real do parent window.
      const personaOrigin = pageOrigin;

      client = new Persona.Client({
        templateId,
        ...(templateVersionId.trim() ? { templateVersionId: templateVersionId.trim() } : {}),
        environmentId,
        referenceId,
        fields,
        ...(personaHostOpt ? { host: personaHostOpt } : {}),
        parent: embedParent,
        // Fixes postMessage target-origin mismatch by explicitly matching our allowed origin.
        messageTargetOrigin: personaOrigin,
        onLoad: () => {
          try {
            setStatusResult({ ok: false, stage: "persona-load", referenceId });
            // Some browsers never emit onReady consistently; try opening on load too.
            window.setTimeout(() => tryOpenPersona("onLoad"), 120);
          } catch (e) {
            setError(e instanceof Error ? e.message : "Falha ao abrir Persona flow");
          }
        },
        onReady: () => {
          try {
            setStatusResult({ ok: false, stage: "persona-ready", referenceId });
            tryOpenPersona("onReady");
          } catch (e) {
            setError(e instanceof Error ? e.message : "Falha ao abrir Persona flow");
          }
        },
        onEvent: (eventName: any, metadata?: any) => {
          try {
            setStatusResult({
              ok: false,
              stage: "persona-event",
              event: String(eventName || "unknown"),
              metadata: metadata || {},
            });
          } catch {}
        },
        onComplete: async (payload: PersonaCompletePayload) => {
          const inquiryId = payload?.inquiryId || "";
          const status = payload?.status || "completed";
          const fieldsOut = payload?.fields || {};

          let fullName = "";
          try {
            fullName =
              extractFullNameFromPersonaFields(fieldsOut) || extractFullNameFromPersonaPayload(payload);
          } catch {
            fullName = "";
          }
          setVerifiedFullName(fullName);
          setManualFullName("");
          setOptionalNameCorrection("");
          setRecordSaveWarning("");
          setBackendSaveConfirmed(false);
          lastPersonaCompleteRef.current = {
            inquiryId,
            status,
            fields: fieldsOut,
            fullName,
          };

          setStatusResult({
            ok: false,
            stage: "persona-validating",
            inquiryId,
            status,
            fields: fieldsOut,
            verifiedFullName: fullName,
          });

          setPersistInFlight(true);
          try {
            await savePersonaRecord({
              reference_id: referenceId,
              inquiry_id: inquiryId,
              status,
              fields: fieldsOut,
              nameOverride: fullName || undefined,
            });
            setBackendSaveConfirmed(true);
            setOptionalNameCorrection("");
            try {
              window.localStorage.setItem(ONBOARDING_STORAGE_KEYS.kyc, "1");
              bumpOnboardingFlowBarFromLocalStorage();
            } catch {
              // ignore
            }
            setStatusResult({
              ok: true,
              stage: "persona-complete-saved",
              inquiryId,
              status,
              fields: fieldsOut,
              verifiedFullName: fullName,
            });
          } catch {
            setBackendSaveConfirmed(false);
            try {
              window.localStorage.setItem(ONBOARDING_STORAGE_KEYS.kyc, "0");
              bumpOnboardingFlowBarFromLocalStorage();
            } catch {
              // ignore
            }
            setRecordSaveWarning(
              "A verificação foi concluída, mas não conseguimos guardar a confirmação no sistema. Tente novamente — sem esta confirmação não pode avançar para o passo seguinte.",
            );
            setStatusResult({
              ok: false,
              stage: "persona-save-failed",
              inquiryId,
              status,
              fields: fieldsOut,
              verifiedFullName: fullName,
            });
          } finally {
            setPersistInFlight(false);
          }
        },
        onCancel: async (payload: { inquiryId?: string; sessionToken?: string }) => {
          const inquiryId = payload?.inquiryId || "";
          setStatusResult({ ok: false, stage: "persona-cancelled", inquiryId, status: "cancelled" });
          try {
            await savePersonaRecord({
              reference_id: referenceId,
              inquiry_id: inquiryId,
              status: "cancelled",
            });
          } catch {
            // opcional
          }
        },
        onError: async (err: any) => {
          let msg = "Persona error";
          try {
            if (err?.message) msg = String(err.message);
            else if (typeof err === "string") msg = err;
            else msg = JSON.stringify(err);
          } catch {
            // keep fallback msg
          }
          const code = err && typeof err === "object" && "code" in err ? String((err as { code?: string }).code || "") : "";
          const inactive =
            code === "inactive_template" ||
            /inactive_template|no published versions|published version/i.test(msg);
          setError(
            inactive
              ? "Este modelo de verificação (template) na Persona não tem versão publicada ou está inactivo. Na consola Persona → Inquiry Templates, publique uma versão ou use o template que mostra «Last published» com data — e copie o itmpl_ correcto para NEXT_PUBLIC_PERSONA_TEMPLATE_ID (redeploy na Vercel)."
              : "Ocorreu um problema durante a verificação. Tente iniciar de novo.",
          );
          if (process.env.NODE_ENV === "development") console.error("[Persona SDK]", msg);
          setStatusResult({
            ok: false,
            stage: inactive ? "persona-inactive-template" : "persona-sdk-error",
            error: msg,
            code: code || undefined,
            referenceId,
          });
          try {
            await savePersonaRecord({
              reference_id: referenceId,
              status: "error",
              fields: { error: msg },
            });
          } catch {
            // opcional
          }
        },
      });

      personaClientRef.current = client;
      // Defensive fallback: invoke open shortly after client creation.
      window.setTimeout(() => tryOpenPersona("post-init"), 800);

      // Diagnostic: iframe fica sob document.body (overlay Persona), não dentro de #persona-flow-container.
      const checkWidgetIframe = () => {
        try {
          const iframe = document.querySelector(
            ".persona-widget__overlay iframe.persona-widget__iframe",
          ) as HTMLIFrameElement | null;
          const src = iframe?.getAttribute("src") || "";
          if (iframe) {
            setStatusResult((prev: any) => ({
              ...(prev || {}),
              ok: false,
              stage: "persona-iframe-mounted",
              iframeSrc: src,
              referenceId,
            }));
          } else {
            setStatusResult((prev: any) => ({
              ...(prev || {}),
              ok: false,
              stage: "persona-iframe-not-found",
              referenceId,
            }));
          }
        } catch {
          // ignore
        }
      };
      window.setTimeout(checkWidgetIframe, 7000);
    } catch (e) {
      setError("Não foi possível abrir a verificação. Atualize a página e tente novamente.");
      if (process.env.NODE_ENV === "development") console.error(e);
    } finally {
      setLoading(false);
    }
  }

  const canConfirmKyc = effectiveFullName.length > 0;
  const personaConfigOk = Boolean(templateId.trim() && environmentId.trim() && referenceId);

  const personaPrepIssue = useMemo((): "session" | "config" | null => {
    if (!referenceId) return "session";
    if (!templateId.trim() || !environmentId.trim()) return "config";
    return null;
  }, [referenceId, templateId, environmentId]);

  useEffect(() => {
    if (process.env.NODE_ENV !== "development") return;
    if (personaPrepIssue === "config") {
      console.warn(
        "[DECIDE] Verificação de identidade: defina NEXT_PUBLIC_PERSONA_TEMPLATE_ID e NEXT_PUBLIC_PERSONA_ENVIRONMENT_ID em .env.local e reinicie o servidor de desenvolvimento.",
      );
    }
    if (personaPrepIssue === "session") {
      console.warn("[DECIDE] Verificação de identidade: sem referência de utilizador — confirme sessão/login.");
    }
  }, [personaPrepIssue]);

  const verificationStateLabel = useMemo(() => {
    if (loading) return "A preparar…";
    if (persistInFlight) return "A validar confirmação no sistema…";
    if (!statusResult) return "Não iniciada";
    const stage = String((statusResult as { stage?: string }).stage || "");
    if (stage === "persona-complete-saved") return "Identidade verificada";
    if (stage === "persona-save-failed") return "Verificação feita — confirmação pendente";
    if (stage === "persona-validating") return "A validar confirmação…";
    if (stage === "persona-cancelled") return "Interrompida — pode voltar a iniciar";
    if (stage === "persona-sdk-error") return "Não foi possível concluir";
    if (stage === "persona-inactive-template") return "Template Persona sem versão publicada";
    if (stage === "persona-iframe-not-found") return "Janela Persona não carregou (rede ou bloqueador)";
    if (stage === "persona-iframe-mounted") return "Verificação em curso";
    if (stage === "starting") return "A iniciar…";
    if (stage === "persona-load" || stage === "persona-ready") return "A carregar o assistente…";
    if (stage.includes("persona")) return "Em curso";
    return "Em curso";
  }, [statusResult, loading, persistInFlight]);

  const estadoPrincipal = !personaConfigOk && !loading && !statusResult
    ? "Verificação indisponível neste momento"
    : verificationStateLabel;

  const linkSecondary: React.CSSProperties = {
    display: "inline-block",
    padding: "11px 18px",
    fontSize: 14,
    fontWeight: 700,
    color: "#cbd5e1",
    border: "1px solid rgba(148,163,184,0.45)",
    borderRadius: 14,
    textDecoration: "none",
    background: "rgba(148,163,184,0.08)",
  };

  const canContinueToIbkr = backendSaveConfirmed && canConfirmKyc;

  const confirmKycButton = canContinueToIbkr ? (
    <a
      href="/client/ibkr-prep"
      onClick={() => {
        try {
          window.localStorage.setItem("decide_persona_verified_full_name_v1", effectiveFullName);
        } catch {
          // ignore
        }
      }}
      style={{
        display: "inline-block",
        background: "#3f73ff",
        color: "#fff",
        border: "1px solid rgba(255,255,255,0.28)",
        borderRadius: 14,
        padding: "12px 18px",
        fontSize: 15,
        fontWeight: 800,
        textDecoration: "none",
      }}
    >
      Continuar para o passo seguinte
    </a>
  ) : (
    <span
      style={{
        display: "inline-block",
        background: "#334155",
        color: "#94a3b8",
        border: "1px solid rgba(255,255,255,0.12)",
        borderRadius: 14,
        padding: "12px 18px",
        fontSize: 15,
        fontWeight: 800,
        cursor: "not-allowed",
        maxWidth: "100%",
        lineHeight: 1.4,
      }}
    >
      {!backendSaveConfirmed
        ? String(statusResult?.stage) === "persona-save-failed"
          ? "Guarde primeiro a confirmação no sistema (botão abaixo)."
          : "A aguardar confirmação no sistema após a verificação."
        : "Indique o nome completo (como no documento) para continuar."}
    </span>
  );

  const stageStr = String(statusResult?.stage || "");
  const showPostPersonaPanel = stageStr === "persona-complete-saved" || stageStr === "persona-save-failed";
  const hideIniciarButton =
    !personaConfigOk ||
    loading ||
    persistInFlight ||
    backendSaveConfirmed ||
    stageStr === "persona-save-failed" ||
    stageStr === "persona-validating";

  return (
    <>
      <Head>
        <title>DECIDE — Verificação de identidade</title>
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
        <div style={{ maxWidth: 720, margin: "0 auto 24px" }}>
          <div style={{ fontSize: "clamp(28px, 4vw, 36px)", fontWeight: 800, lineHeight: 1.15 }}>Verificação de identidade</div>
          <div style={{ color: "#94a3b8", fontSize: 16, marginTop: 10, maxWidth: 560, lineHeight: 1.55 }}>
            Para continuar, precisamos de confirmar a sua identidade. O processo demora apenas alguns minutos.
          </div>
        </div>

        <div style={{ maxWidth: 900, margin: "0 auto" }}>
          <OnboardingFlowBar currentStepId="kyc" authStepHref="/client/login" />
        </div>

        {error ? (
          <div
            style={{
              ...cardStyle(),
              maxWidth: 720,
              margin: "0 auto 16px",
              color: "#fecaca",
              borderColor: "#7f1d1d",
            }}
          >
            {error}
          </div>
        ) : null}

        <div style={{ maxWidth: 720, margin: "0 auto", display: "grid", gap: 20 }}>
          <div style={cardStyle()}>
            <div style={{ color: "#64748b", fontSize: 12, fontWeight: 800, marginBottom: 8 }}>ESTADO</div>
            <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 16 }}>{estadoPrincipal}</div>

            <ul style={{ color: "#94a3b8", fontSize: 14, lineHeight: 1.65, margin: "0 0 20px", paddingLeft: 20 }}>
              <li>Documento de identificação válido</li>
              <li>Câmara do telemóvel ou computador</li>
            </ul>

            {!personaConfigOk ? (
              <div
                style={{
                  marginBottom: 20,
                  padding: 16,
                  borderRadius: 14,
                  background: "rgba(251, 191, 36, 0.08)",
                  border: "1px solid rgba(251, 191, 36, 0.45)",
                  color: "#fef3c7",
                  fontSize: 14,
                  lineHeight: 1.6,
                }}
              >
                <div style={{ fontWeight: 800, color: "#fde68a", marginBottom: 8 }}>O que pode fazer</div>
                {personaPrepIssue === "session" ? (
                  <p style={{ margin: "0 0 14px" }}>
                    Não conseguimos associar a sua conta a este passo. Inicie sessão (ou volte ao registo) e abra de novo a
                    verificação de identidade. Também pode atualizar a página depois de entrar.
                  </p>
                ) : (
                  <p style={{ margin: "0 0 14px" }}>
                    O assistente externo (Persona) <strong>não está configurado</strong> neste site ou o último deploy foi feito{" "}
                    <strong>antes</strong> de definirem as variáveis — voltar ao passo 3 não resolve isto.
                  </p>
                )}
                {personaPrepIssue === "session" ? (
                  <p style={{ margin: "0 0 14px", color: "#fcd34d", fontSize: 13 }}>
                    Confirme que tem sessão iniciada (nome de utilizador visível no fluxo cliente).
                  </p>
                ) : (
                  <>
                    <p style={{ margin: "0 0 10px", color: "#fcd34d", fontSize: 13, lineHeight: 1.55 }}>
                      Na Vercel: <strong>Project → Settings → Environment Variables → Production</strong>. Depois{" "}
                      <strong>Redeploy</strong> (obrigatório para <code style={{ color: "#fef9c3" }}>NEXT_PUBLIC_*</code>).
                    </p>
                    <ul style={{ margin: "0 0 14px", paddingLeft: 18, color: "#fcd34d", fontSize: 12, lineHeight: 1.55 }}>
                      {!templateId.trim() ? (
                        <li>
                          Falta <strong>template</strong> (ID começa por <code style={{ color: "#fef9c3" }}>itmpl_</code>).
                        </li>
                      ) : null}
                      {!environmentId.trim() ? (
                        <li>
                          Falta <strong>environment</strong> (ID começa por <code style={{ color: "#fef9c3" }}>env_</code>).
                        </li>
                      ) : null}
                    </ul>
                    <p style={{ margin: 0, color: "#a8a29e", fontSize: 12, lineHeight: 1.5 }}>
                      Copie os IDs em dashboard.withpersona.com → Inquiry template / API. Se o modal Persona disser «Could not
                      load template», publique uma versão do template e opcionalmente defina{" "}
                      <code style={{ color: "#d6d3d1" }}>NEXT_PUBLIC_PERSONA_TEMPLATE_VERSION_ID</code>.
                    </p>
                  </>
                )}
                <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
                  <a href="/mifid-test" style={linkSecondary}>
                    Voltar ao perfil de investidor
                  </a>
                  {personaPrepIssue === "session" ? (
                    <a href="/client/login" style={linkSecondary}>
                      Iniciar sessão
                    </a>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => window.location.reload()}
                    style={{
                      ...linkSecondary,
                      cursor: "pointer",
                      fontFamily: "inherit",
                    }}
                  >
                    Atualizar página
                  </button>
                </div>
              </div>
            ) : null}

            {showPostPersonaPanel ? (
              <div
                style={{
                  marginBottom: 18,
                  padding: 16,
                  borderRadius: 16,
                  background:
                    stageStr === "persona-complete-saved" ? "#052e1a33" : "rgba(251, 191, 36, 0.08)",
                  border:
                    stageStr === "persona-complete-saved"
                      ? "1px solid rgba(34, 197, 94, 0.35)"
                      : "1px solid rgba(251, 191, 36, 0.45)",
                }}
              >
                {stageStr === "persona-save-failed" && recordSaveWarning ? (
                  <div
                    style={{
                      marginBottom: 14,
                      padding: 12,
                      borderRadius: 12,
                      background: "rgba(127, 29, 29, 0.25)",
                      border: "1px solid rgba(248, 113, 113, 0.35)",
                      color: "#fecaca",
                      fontSize: 14,
                      lineHeight: 1.55,
                    }}
                  >
                    {recordSaveWarning}
                    <div style={{ marginTop: 12 }}>
                      <Button onClick={() => retryPersistPersonaComplete()} disabled={persistInFlight}>
                        {persistInFlight ? "A guardar…" : "Tentar guardar confirmação"}
                      </Button>
                    </div>
                  </div>
                ) : null}
                <div style={{ color: stageStr === "persona-complete-saved" ? "#86efac" : "#fde68a", fontSize: 12, fontWeight: 800, marginBottom: 6 }}>
                  {stageStr === "persona-complete-saved" ? "NOME CONFIRMADO" : "NOME NA VERIFICAÇÃO"}
                </div>
                {verifiedFullName.trim() ? (
                  <>
                    <div style={{ color: "#fff", fontSize: 22, fontWeight: 800, lineHeight: 1.3 }}>{effectiveFullName}</div>
                    {stageStr === "persona-complete-saved" ? (
                      <p style={{ margin: "10px 0 0", color: "#94a3b8", fontSize: 13, lineHeight: 1.5 }}>
                        Este nome foi registado na verificação e no sistema. Não precisa de alterar nada se corresponder ao seu
                        documento; se estiver incorreto, contacte o suporte antes de continuar.
                      </p>
                    ) : null}
                    {stageStr === "persona-save-failed" ? (
                      <div style={{ marginTop: 14 }}>
                        <Label>Corrigir nome (opcional)</Label>
                        <div style={{ color: "#94a3b8", fontSize: 12, marginBottom: 8, lineHeight: 1.45 }}>
                          Só preencha se o nome capturado estiver errado. Depois utilize «Tentar guardar confirmação» acima.
                        </div>
                        <input
                          value={optionalNameCorrection}
                          onChange={(e) => setOptionalNameCorrection(e.target.value)}
                          style={inputStyle()}
                          placeholder="Deixe vazio para manter o nome mostrado"
                          autoComplete="name"
                          disabled={persistInFlight}
                        />
                      </div>
                    ) : null}
                  </>
                ) : manualFullName.trim() ? (
                  <div style={{ color: "#fff", fontSize: 22, fontWeight: 800, lineHeight: 1.3 }}>{manualFullName.trim()}</div>
                ) : (
                  <div style={{ color: "#fecaca", fontSize: 14, lineHeight: 1.5 }}>
                    Confirme o seu nome completo tal como consta no documento — use o campo abaixo.
                  </div>
                )}
                {!verifiedFullName.trim() ? (
                  <div style={{ marginTop: 14 }}>
                    <Label>Nome completo (obrigatório se a verificação não devolver nome)</Label>
                    <input
                      value={manualFullName}
                      onChange={(e) => setManualFullName(e.target.value)}
                      style={inputStyle()}
                      placeholder="Como no documento de identificação"
                      autoComplete="name"
                    />
                  </div>
                ) : null}
                {backendSaveConfirmed && !canConfirmKyc ? (
                  <div style={{ color: "#94a3b8", fontSize: 12, marginTop: 10 }}>Indique o nome completo para continuar.</div>
                ) : null}
              </div>
            ) : null}

            <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 12 }}>
              {!personaConfigOk ? (
                <>
                  <div
                    style={{
                      display: "inline-block",
                      alignSelf: "flex-start",
                      background: "#334155",
                      color: "#94a3b8",
                      border: "1px solid rgba(255,255,255,0.12)",
                      borderRadius: 14,
                      padding: "12px 18px",
                      fontSize: 15,
                      fontWeight: 800,
                      cursor: "not-allowed",
                      maxWidth: "100%",
                    }}
                    aria-disabled
                  >
                    Não foi possível iniciar a verificação
                  </div>
                  <p style={{ margin: 0, color: "#64748b", fontSize: 13, lineHeight: 1.5 }}>
                    Use os botões acima para voltar ao perfil ou atualizar a página — o botão só fica disponível quando tudo
                    estiver pronto.
                  </p>
                </>
              ) : hideIniciarButton ? (
                backendSaveConfirmed ? (
                  <p style={{ margin: 0, color: "#64748b", fontSize: 13, lineHeight: 1.5 }}>
                    A sua identidade foi verificada e confirmada. Pode continuar.
                  </p>
                ) : persistInFlight || stageStr === "persona-validating" ? (
                  <p style={{ margin: 0, color: "#94a3b8", fontSize: 13, lineHeight: 1.5 }}>
                    Aguarde enquanto guardamos a confirmação no sistema…
                  </p>
                ) : stageStr === "persona-save-failed" ? (
                  <p style={{ margin: 0, color: "#94a3b8", fontSize: 13, lineHeight: 1.5 }}>
                    Utilize «Tentar guardar confirmação» na caixa acima para concluir este passo.
                  </p>
                ) : loading ? (
                  <p style={{ margin: 0, color: "#94a3b8", fontSize: 13, lineHeight: 1.5 }}>
                    A abrir o assistente de verificação…
                  </p>
                ) : null
              ) : (
                <Button onClick={startFlow} disabled={loading}>
                  {loading ? "A abrir…" : "Iniciar verificação"}
                </Button>
              )}
            </div>

            {showPostPersonaPanel ? (
              <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 10 }}>{confirmKycButton}</div>
            ) : null}

            {!backendSaveConfirmed ? (
              <div style={{ color: "#64748b", fontSize: 12, lineHeight: 1.5, marginTop: 16 }}>
                O assistente abre como <strong>janela escura em ecrã completo</strong> (não só na caixa abaixo) — verifique se não ficou atrás do browser ou se o bloqueador não impediu o iframe.
                <div style={{ marginTop: 10, color: "#57534e", fontSize: 11 }}>
                  Se ficar em branco: o template na Persona precisa de <strong>versão publicada</strong> (na lista de templates,
                  «Last published» não pode estar vazio). A 3.ª variável <code style={{ color: "#a8a29e" }}>NEXT_PUBLIC_PERSONA_TEMPLATE_VERSION_ID</code>{" "}
                  é opcional; em sandbox, se a Persona o pedir, defina também{" "}
                  <code style={{ color: "#a8a29e" }}>NEXT_PUBLIC_PERSONA_HOST=development</code> na Vercel e redeploy.
                </div>
                {stageStr === "persona-iframe-mounted" ? (
                  <div
                    style={{
                      marginTop: 14,
                      padding: "12px 14px",
                      borderRadius: 12,
                      background: "rgba(14, 165, 233, 0.1)",
                      border: "1px solid rgba(56, 189, 248, 0.35)",
                      color: "#bae6fd",
                      fontSize: 12,
                      lineHeight: 1.55,
                    }}
                  >
                    <strong>Diagnóstico:</strong> o iframe da Persona está montado na página. Se a área escura continua vazia,
                    trate de configuração na consola Persona (template publicado, mesmo ambiente que o{" "}
                    <code style={{ color: "#7dd3fc" }}>NEXT_PUBLIC_PERSONA_ENVIRONMENT_ID</code>) e, em Sandbox,{" "}
                    <code style={{ color: "#7dd3fc" }}>NEXT_PUBLIC_PERSONA_HOST=development</code> + redeploy. Confirme também no
                    DevTools → Rede se há pedidos bloqueados.
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>

          <div
            style={{
              position: "relative",
              border: "1px solid #1e3a5f",
              borderRadius: 16,
              overflow: "hidden",
              background: "linear-gradient(180deg, #0c1929 0%, #061126 100%)",
              minHeight: 480,
            }}
          >
            <div
              style={{
                position: "absolute",
                inset: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                pointerEvents: "none",
                color: "#475569",
                fontSize: 14,
                textAlign: "center",
                padding: 24,
                zIndex: 0,
              }}
            >
              A verificação aparece aqui depois de iniciar
            </div>
            <div id="persona-flow-container" style={{ position: "relative", zIndex: 1, minHeight: 480 }} />
          </div>
        </div>
      </div>
    </>
  );
}

