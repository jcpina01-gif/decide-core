import React, { useEffect, useMemo, useRef, useState } from "react";
import type { GetServerSideProps, GetServerSidePropsContext } from "next";
import Head from "next/head";
import OnboardingFlowBar, {
  ONBOARDING_LOCALSTORAGE_CHANGED_EVENT,
  ONBOARDING_STORAGE_KEYS,
} from "../components/OnboardingFlowBar";
import { getCurrentSessionUser, getCurrentSessionUserEmail, getCurrentSessionUserPhone } from "../lib/clientAuth";
import {
  getResolvedPersonaEnvironmentId,
  getResolvedPersonaTemplateId,
  normalizeNextPublicPersonaHostForSdk,
  sanitizePersonaPublicId,
} from "../lib/personaPublicEnv";
import { buildReferenceIdFromUserAndEmail } from "../lib/personaReference";
import {
  DECIDE_ONBOARDING,
  ONBOARDING_PRIMARY_CTA_MAX_WIDTH_PX,
  ONBOARDING_SHELL_MAX_WIDTH_PX,
} from "../lib/decideClientTheme";
import { getNextOnboardingHref } from "../lib/onboardingProgress";

function bumpOnboardingFlowBarFromLocalStorage() {
  try {
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event(ONBOARDING_LOCALSTORAGE_CHANGED_EVENT));
    }
  } catch {
    // ignore
  }
}

function formatPersonaSaveError(e: unknown): string {
  if (e instanceof Error && e.message.trim()) return e.message.trim();
  if (typeof e === "string" && e.trim()) return e.trim();
  if (e && typeof e === "object" && "message" in e) {
    const m = (e as { message?: unknown }).message;
    if (typeof m === "string" && m.trim()) return m.trim();
  }
  return "Erro desconhecido. Abra F12 → Rede → POST /api/persona/record, ou veja o terminal onde corre npm run dev.";
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
    background: DECIDE_ONBOARDING.cardBg,
    border: DECIDE_ONBOARDING.cardBorder,
    borderRadius: 18,
    padding: 14,
    boxShadow: DECIDE_ONBOARDING.cardShadow,
  };
}

function inputStyle(): React.CSSProperties {
  return {
    width: "100%",
    background: DECIDE_ONBOARDING.inputBg,
    color: DECIDE_ONBOARDING.text,
    border: DECIDE_ONBOARDING.inputBorder,
    borderRadius: 12,
    padding: 12,
    fontSize: 16,
    outline: "none",
  };
}

function Label({ children }: { children: React.ReactNode }) {
  return <div style={{ color: DECIDE_ONBOARDING.textLabel, fontSize: 14, marginBottom: 8 }}>{children}</div>;
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
      type="button"
      style={{
        alignSelf: "flex-start",
        width: "auto",
        maxWidth: "min(100%, 280px)",
        background: disabled ? DECIDE_ONBOARDING.buttonDisabled : DECIDE_ONBOARDING.buttonPrimaryGradient,
        color: disabled ? "rgba(230, 237, 243, 0.75)" : DECIDE_ONBOARDING.text,
        border: disabled ? DECIDE_ONBOARDING.inputBorder : DECIDE_ONBOARDING.buttonPrimaryBorder,
        boxShadow: disabled ? undefined : "var(--shadow-button-primary-glow, 0 0 20px rgba(47, 191, 159, 0.25)), 0 4px 14px rgba(0, 0, 0, 0.28)",
        borderRadius: 14,
        padding: "11px 16px",
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

export type PersonaOnboardingPageProps = {
  personaTemplateId: string;
  personaEnvironmentId: string;
  personaTemplateVersionId: string;
  /** Host da barra de endereço (1º de x-forwarded-host) — aviso de domínio / Persona. */
  requestHost: string | null;
  /** p.ex. "preview" em deploy Vercel de branch — Persona muitas vezes exige allowlist do hostname. */
  vercelEnv: string | null;
};

/**
 * Injeta NEXT_PUBLIC_PERSONA_* no HTML em cada pedido. O bundle cliente embute essas variáveis na build;
 * se o ambiente só as definir em runtime (Docker, variáveis mudadas sem rebuild), sem isto o SDK Persona
 * recebia template/environment vazios → «template-id is blank» / misconfigured.
 */
function hostFromSsrContext(context: GetServerSidePropsContext): string {
  const xf = context.req.headers["x-forwarded-host"];
  const fromXf = typeof xf === "string" ? xf.split(",")[0]! : String(xf || "");
  const h = (fromXf && fromXf.trim() ? fromXf : String(context.req.headers.host || "")).trim();
  return h.toLowerCase() || "";
}

export const getServerSideProps: GetServerSideProps<PersonaOnboardingPageProps> = async (context) => {
  const requestHost = hostFromSsrContext(context);
  const vercelEnv = String(process.env.VERCEL_ENV || "").trim() || null;
  return {
    props: {
      personaTemplateId: sanitizePersonaPublicId(getResolvedPersonaTemplateId()),
      personaEnvironmentId: sanitizePersonaPublicId(getResolvedPersonaEnvironmentId()),
      personaTemplateVersionId: sanitizePersonaPublicId(
        String(process.env.NEXT_PUBLIC_PERSONA_TEMPLATE_VERSION_ID || "").trim(),
      ),
      requestHost: requestHost || null,
      vercelEnv,
    },
  };
};

export default function PersonaOnboardingPage({
  personaTemplateId,
  personaEnvironmentId,
  personaTemplateVersionId,
  requestHost,
  vercelEnv,
}: PersonaOnboardingPageProps) {
  const [externalUserId, setExternalUserId] = useState("");
  const [email, setEmail] = useState("");
  /** Nome extraído automaticamente do callback Persona (pode ficar vazio se `fields` vier {}). */
  const [verifiedFullName, setVerifiedFullName] = useState("");
  /** Se a Persona não devolver nome, o cliente confirma manualmente (como no documento). */
  const [manualFullName, setManualFullName] = useState("");
  /** Só quando já há nome da Persona: correção opcional (deixe vazio se o capturado estiver certo). */
  const [optionalNameCorrection, setOptionalNameCorrection] = useState("");

  // From Persona dashboard (inquiry template + environment) — valores vindos do servidor em cada pedido (ver getServerSideProps).
  const [templateId, setTemplateId] = useState(personaTemplateId);
  const [templateVersionId, setTemplateVersionId] = useState(personaTemplateVersionId);
  const [environmentId, setEnvironmentId] = useState(personaEnvironmentId);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [recordSaveWarning, setRecordSaveWarning] = useState("");
  /** Motivo técnico separado (evita depender de `\n` no texto — o detalhe mostra-se sempre). */
  const [recordSaveDetail, setRecordSaveDetail] = useState("");
  const [statusResult, setStatusResult] = useState<Record<string, any> | null>(null);
  /** Só true após `/api/persona/record` OK — única fonte para desbloquear IBKR e stepper. */
  const [backendSaveConfirmed, setBackendSaveConfirmed] = useState(false);
  const [persistInFlight, setPersistInFlight] = useState(false);
  const [manualBypassInFlight, setManualBypassInFlight] = useState(false);

  /** Alinha com `onboardingProgress`: Hedge cambial antes de «Plano e pagamento» quando o segmento exige. */
  const [postIdentityHref, setPostIdentityHref] = useState("/client/ibkr-prep");
  useEffect(() => {
    function syncPostIdentityHref() {
      try {
        setPostIdentityHref(getNextOnboardingHref());
      } catch {
        setPostIdentityHref("/client/ibkr-prep");
      }
    }
    syncPostIdentityHref();
    window.addEventListener(ONBOARDING_LOCALSTORAGE_CHANGED_EVENT, syncPostIdentityHref);
    window.addEventListener("storage", syncPostIdentityHref);
    return () => {
      window.removeEventListener(ONBOARDING_LOCALSTORAGE_CHANGED_EVENT, syncPostIdentityHref);
      window.removeEventListener("storage", syncPostIdentityHref);
    };
  }, []);

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
      setRecordSaveDetail("");
      const sessionEmail = getCurrentSessionUserEmail();
      setEmail(sessionEmail || "");

      /** Só usar LS quando os props do servidor vêm vazios — evita IDs de dev antigos a mascarar produção. */
      const t = window.localStorage.getItem("persona_templateId") || "";
      const tv = window.localStorage.getItem("persona_templateVersionId") || "";
      const e = window.localStorage.getItem("persona_environmentId") || "";
      if (!personaTemplateId.trim() && t.trim()) setTemplateId(sanitizePersonaPublicId(t));
      if (!personaTemplateVersionId.trim() && tv.trim()) setTemplateVersionId(sanitizePersonaPublicId(tv));
      if (!personaEnvironmentId.trim() && e.trim()) setEnvironmentId(sanitizePersonaPublicId(e));
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

  /** Props do `getServerSideProps` (env Vercel em cada pedido) têm prioridade sobre estado/LS. */
  useEffect(() => {
    if (personaTemplateId.trim()) {
      setTemplateId(sanitizePersonaPublicId(personaTemplateId));
      try {
        window.localStorage.setItem("persona_templateId", personaTemplateId.trim());
      } catch {
        // ignore
      }
    }
    if (personaEnvironmentId.trim()) {
      setEnvironmentId(sanitizePersonaPublicId(personaEnvironmentId));
      try {
        window.localStorage.setItem("persona_environmentId", personaEnvironmentId.trim());
      } catch {
        // ignore
      }
    }
    if (personaTemplateVersionId.trim()) {
      setTemplateVersionId(sanitizePersonaPublicId(personaTemplateVersionId));
      try {
        window.localStorage.setItem("persona_templateVersionId", personaTemplateVersionId.trim());
      } catch {
        // ignore
      }
    }
  }, [personaTemplateId, personaEnvironmentId, personaTemplateVersionId]);

  // Não redireccionar localhost → 127.0.0.1: o Domain Manager da Persona aceita «localhost» mas rejeita «127.0.0.1».

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
    const ref = (payload.reference_id || "").trim();
    if (!ref) {
      throw new Error("Sem reference_id — inicie sessão de novo e volte a este passo.");
    }
    let bodyJson: string;
    try {
      bodyJson = JSON.stringify({
        reference_id: ref,
        external_user_id: externalUserId || referenceId,
        name: (payload.nameOverride ?? effectiveFullName) || undefined,
        email: email || getCurrentSessionUserEmail() || undefined,
        phone: getCurrentSessionUserPhone() || undefined,
        inquiry_id: payload.inquiry_id,
        status: payload.status,
        fields: payload.fields || {},
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "JSON inválido";
      throw new Error(`Dados demasiado grandes ou inválidos para guardar (${msg}).`);
    }
    const res = await fetch("/api/persona/record", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: bodyJson,
    });
    const text = await res.text();
    let json: { ok?: boolean; error?: string; hint?: string } = {};
    try {
      json = text ? (JSON.parse(text) as typeof json) : {};
    } catch {
      const snippet = text.replace(/\s+/g, " ").trim().slice(0, 240);
      throw new Error(
        snippet ? `Resposta do servidor (${res.status}): ${snippet}` : `Resposta inválida (HTTP ${res.status}).`,
      );
    }
    if (!res.ok || !json.ok) {
      const parts = [typeof json?.error === "string" ? json.error : null, typeof json?.hint === "string" ? json.hint : null].filter(
        Boolean,
      ) as string[];
      throw new Error(parts.length ? parts.join(" — ") : `HTTP ${res.status}`);
    }
    return json;
  }

  async function retryPersistPersonaComplete() {
    const headline =
      "A verificação foi concluída, mas não conseguimos guardar a confirmação no sistema. Tente novamente — sem esta confirmação não pode avançar para o passo seguinte.";
    if (!referenceId.trim()) {
      setRecordSaveWarning(headline);
      setRecordSaveDetail("Falta sessão / reference_id — inicie sessão e volte a este passo.");
      return;
    }
    const last = lastPersonaCompleteRef.current;
    if (!last) {
      setRecordSaveWarning(headline);
      setRecordSaveDetail(
        "Não há dados do último Persona em memória — conclua outra vez o fluxo no ecrã (ou recarregue a página).",
      );
      return;
    }
    setPersistInFlight(true);
    setRecordSaveWarning("");
    setRecordSaveDetail("");
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
      setRecordSaveDetail("");
    } catch (e) {
      if (process.env.NODE_ENV === "development") console.error("[Persona] retry save", e);
      setBackendSaveConfirmed(false);
      try {
        window.localStorage.setItem(ONBOARDING_STORAGE_KEYS.kyc, "0");
        bumpOnboardingFlowBarFromLocalStorage();
      } catch {
        // ignore
      }
      setRecordSaveWarning(headline);
      setRecordSaveDetail(formatPersonaSaveError(e));
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

  async function continueWithManualReview() {
    if (!referenceId) return;
    setManualBypassInFlight(true);
    setRecordSaveWarning("");
    setRecordSaveDetail("");
    try {
      // Keep onboarding unblocked even if backend is temporarily unavailable.
      window.localStorage.setItem(ONBOARDING_STORAGE_KEYS.kyc, "1");
      window.localStorage.setItem("decide_kyc_manual_review_pending_v1", "1");
      bumpOnboardingFlowBarFromLocalStorage();
    } catch {
      // ignore
    }

    setStatusResult((prev) => ({
      ...(prev || {}),
      ok: true,
      stage: "persona-manual-pending",
      referenceId,
    }));
    setError("");
    setManualBypassInFlight(false);

    // Best-effort audit trail (do not block user progression).
    void savePersonaRecord({
      reference_id: referenceId,
      status: "manual_review_pending",
      fields: {
        reason: "persona_embed_unavailable",
        stage: String(statusResult?.stage || ""),
        ui_error: error || undefined,
      },
    }).catch(() => {
      // keep silent; user can proceed anyway
    });

    try {
      window.location.href = getNextOnboardingHref();
    } catch {
      // ignore
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

    /** Ordem: props SSR (Vercel) → estado → LS → bundle — nunca deixar LS de outro host mascarar IDs correctos. */
    let tid =
      sanitizePersonaPublicId(personaTemplateId) ||
      sanitizePersonaPublicId(templateId) ||
      "";
    let eid =
      sanitizePersonaPublicId(personaEnvironmentId) ||
      sanitizePersonaPublicId(environmentId) ||
      "";
    let tvid =
      sanitizePersonaPublicId(personaTemplateVersionId) ||
      sanitizePersonaPublicId(templateVersionId) ||
      "";
    try {
      if (!tid && typeof window !== "undefined") {
        tid = sanitizePersonaPublicId(window.localStorage.getItem("persona_templateId") || "");
      }
      if (!eid && typeof window !== "undefined") {
        eid = sanitizePersonaPublicId(window.localStorage.getItem("persona_environmentId") || "");
      }
      if (!tvid && typeof window !== "undefined") {
        tvid = sanitizePersonaPublicId(window.localStorage.getItem("persona_templateVersionId") || "");
      }
    } catch {
      // ignore
    }
    if (!tid) {
      tid = sanitizePersonaPublicId(getResolvedPersonaTemplateId());
    }
    if (!eid) {
      eid = sanitizePersonaPublicId(getResolvedPersonaEnvironmentId());
    }

    if (!tid.trim()) {
      setError("Não foi possível iniciar a verificação. Tente mais tarde ou contacte o suporte.");
      if (process.env.NODE_ENV === "development") console.warn("[Persona] Falta templateId em ENV");
      setStatusResult({ ok: false, stage: "missing-templateId", referenceId });
      return;
    }
    if (!eid.trim()) {
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
    if (tvid.trim() && !tvid.trim().startsWith("itmplv_")) {
      setError("Não foi possível iniciar a verificação. Tente mais tarde ou contacte o suporte.");
      if (process.env.NODE_ENV === "development") console.warn("[Persona] templateVersionId inválido");
      setStatusResult({ ok: false, stage: "invalid-templateVersionId", referenceId });
      return;
    }

    const idErr = validatePersonaPublicIds(tid, eid, tvid);
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

      const personaHostRaw = (process.env.NEXT_PUBLIC_PERSONA_HOST || "").trim();
      const pageHostname = typeof window !== "undefined" ? window.location.hostname.toLowerCase() : "";
      const isLocalPage =
        pageHostname === "localhost" ||
        pageHostname === "127.0.0.1" ||
        pageHostname === "[::1]" ||
        pageHostname === "::1";
      const parsedHost = normalizeNextPublicPersonaHostForSdk(personaHostRaw);
      /**
       * Sandbox Persona (`NEXT_PUBLIC_PERSONA_HOST=staging`): o SDK precisa de `host: staging` também em
       * `*.vercel.app` / produção — antes só passávamos `host` em localhost → widget 400 / domínio errado.
       * Com `host` omitido, o SDK assume production (inquiry.withpersona.com), correcto para env_id de produção.
       */
      const personaHostOpt =
        isLocalPage
          ? parsedHost
          : parsedHost === "staging" || parsedHost === "canary"
            ? parsedHost
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
        templateId: tid,
        ...(tvid.trim() ? { templateVersionId: tvid.trim() } : {}),
        environmentId: eid,
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
          const status =
            typeof payload?.status === "string" && payload.status.trim()
              ? payload.status.trim()
              : payload?.status != null && payload.status !== ""
                ? String(payload.status).trim()
                : "completed";
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
          setRecordSaveDetail("");
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
            setRecordSaveDetail("");
          } catch (e) {
            if (process.env.NODE_ENV === "development") console.error("[Persona] onComplete save", e);
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
            setRecordSaveDetail(formatPersonaSaveError(e));
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

  /** Nome manual ou da Persona; se a Persona concluiu mas não devolveu nome, ainda há `inquiryId` — não obrigar a refazer o fluxo completo só por falta de texto. */
  const lastInquiryId = (lastPersonaCompleteRef.current?.inquiryId || "").trim();
  const canConfirmKyc = effectiveFullName.length > 0 || Boolean(lastInquiryId && backendSaveConfirmed);
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

  const estadoDisplay =
    typeof estadoPrincipal === "string" ? estadoPrincipal : String(estadoPrincipal ?? "");

  const linkSecondary: React.CSSProperties = {
    display: "inline-block",
    padding: "11px 18px",
    fontSize: 14,
    fontWeight: 700,
    color: DECIDE_ONBOARDING.textLabel,
    border: DECIDE_ONBOARDING.inputBorder,
    borderRadius: 14,
    textDecoration: "none",
    background: "rgba(63, 63, 70, 0.35)",
  };

  const canContinueToIbkr = backendSaveConfirmed && canConfirmKyc;

  const confirmKycButton = canContinueToIbkr ? (
    <a
      href={postIdentityHref}
      onClick={() => {
        try {
          const nm = effectiveFullName.trim();
          if (nm) window.localStorage.setItem("decide_persona_verified_full_name_v1", nm);
        } catch {
          // ignore
        }
      }}
      style={{
        display: "block",
        marginLeft: "auto",
        marginRight: "auto",
        maxWidth: `min(100%, ${ONBOARDING_PRIMARY_CTA_MAX_WIDTH_PX}px)`,
        width: "100%",
        boxSizing: "border-box",
        background: DECIDE_ONBOARDING.buttonPrimaryGradient,
        color: DECIDE_ONBOARDING.text,
        border: DECIDE_ONBOARDING.buttonPrimaryBorder,
        boxShadow:
          "var(--shadow-button-primary-glow, 0 0 20px rgba(47, 191, 159, 0.25)), 0 4px 14px rgba(0, 0, 0, 0.28)",
        borderRadius: 14,
        padding: "11px 16px",
        fontSize: 15,
        fontWeight: 800,
        textDecoration: "none",
        textAlign: "center",
      }}
    >
      Continuar para o passo seguinte
    </a>
  ) : (
    <span
      style={{
        display: "inline-block",
        background: "#334155",
        color: "#a1a1aa",
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
  const embedBlockedByPersona =
    /refused to connect|recusou-se a ligar/i.test(error || "") ||
    (stageStr === "persona-sdk-error" &&
      /refused to connect|recusou-se a ligar|x-frame-options|frame-ancestors/i.test(
        String(statusResult?.error || ""),
      ));
  const manualFallbackActive = stageStr === "persona-manual-pending";
  const showPostPersonaPanel = stageStr === "persona-complete-saved" || stageStr === "persona-save-failed";
  const hideIniciarButton =
    !personaConfigOk ||
    loading ||
    persistInFlight ||
    backendSaveConfirmed ||
    stageStr === "persona-save-failed" ||
    stageStr === "persona-validating";

  /** Vercel: o ambiente *Production* pode servir ainda em <project>-<hash>-<team>.vercel.app. Persona exige o hostname exato na allowlist (como com localhost) — independentemente de o deploy ser Production ou Preview. */
  const personaAllowlistHost = (requestHost || "").split(":")[0] || "";
  const isVercelAppUrlHost =
    personaAllowlistHost.length > 0 && personaAllowlistHost.toLowerCase().endsWith(".vercel.app");
  const showPersonaVercelHostnameCallout = Boolean(
    personaAllowlistHost && (isVercelAppUrlHost || vercelEnv === "preview"),
  );

  return (
    <>
      <Head>
        <title>DECIDE — Verificação de identidade</title>
      </Head>
      <div
        style={{
          minHeight: "100vh",
          background: DECIDE_ONBOARDING.pageBackground,
          color: DECIDE_ONBOARDING.text,
          padding: "14px max(16px, 3vw) 20px",
          fontFamily: DECIDE_ONBOARDING.fontFamily,
          boxSizing: "border-box",
        }}
      >
        <header
          style={{
            maxWidth: ONBOARDING_SHELL_MAX_WIDTH_PX,
            margin: "0 auto 8px",
            width: "100%",
            paddingBottom: 10,
            borderBottom: "1px solid rgba(255, 255, 255, 0.06)",
          }}
        >
          <div style={{ fontSize: "clamp(20px, 3vw, 28px)", fontWeight: 800, lineHeight: 1.2 }}>
            Verificação de identidade
          </div>
          <div
            style={{
              color: DECIDE_ONBOARDING.textMuted,
              fontSize: 14,
              marginTop: 4,
              maxWidth: 560,
              lineHeight: 1.4,
            }}
          >
            Confirme a sua identidade para avançar — processo rápido.
          </div>
        </header>

        <div style={{ maxWidth: ONBOARDING_SHELL_MAX_WIDTH_PX, margin: "0 auto 8px", width: "100%" }}>
          <OnboardingFlowBar currentStepId="kyc" authStepHref="/client/login" compact />
        </div>

        {showPersonaVercelHostnameCallout ? (
          <div
            style={{
              ...cardStyle(),
              maxWidth: ONBOARDING_SHELL_MAX_WIDTH_PX,
              margin: "0 auto 16px",
              background: "rgba(251, 191, 36, 0.1)",
              border: "1px solid rgba(251, 191, 36, 0.4)",
            }}
          >
            <div style={{ fontWeight: 800, color: "#fde68a", fontSize: 14, marginBottom: 8 }}>
              Persona + {isVercelAppUrlHost ? "URL " : ""}Vercel{vercelEnv === "preview" ? " (pré-visualização de branch)" : ""}
            </div>
            <p style={{ margin: 0, color: "#fef3c7", fontSize: 13, lineHeight: 1.55 }}>
              Na Vercel, o site pode ser <strong>Production</strong> e continuar o endereço <code
                style={{ color: "#fef9c3" }}
              >
                *.vercel.app
              </code>{" "}
              — a Persona não trata isso de forma diferente: o <strong>hostname exato</strong> da barra de endereços
              (neste sítio: <code style={{ color: "#fef9c3" }}>{personaAllowlistHost}</code>) tem de constar na{" "}
              <strong>allowlist</strong> de domínios do embed (no mesmo sítio onde, em dev, se usa{" "}
              <code style={{ color: "#fef9c3" }}>localhost</code>; só o nome, sem{" "}
              <code style={{ color: "#fef9c3" }}>https://</code>). Cada URL de <strong>pré-visualização de branch</strong>{" "}
              é um hostname novo. Se tiverem um <strong>domínio personalizado</strong> de produção (p.ex.{" "}
              <code style={{ color: "#fef9c3" }}>app.empresa.pt</code>), a demo deve ser aí, ou com esse host também
              listado.
            </p>
          </div>
        ) : null}

        {error ? (
          <div
            style={{
              ...cardStyle(),
              maxWidth: ONBOARDING_SHELL_MAX_WIDTH_PX,
              margin: "0 auto 16px",
              color: "#fecaca",
              borderColor: "#7f1d1d",
            }}
          >
            {error}
          </div>
        ) : null}

        <div style={{ maxWidth: ONBOARDING_SHELL_MAX_WIDTH_PX, margin: "0 auto", display: "grid", gap: 10, width: "100%" }}>
          <div style={cardStyle()}>
            <div style={{ marginBottom: 10, display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px 12px" }}>
              <span style={{ color: DECIDE_ONBOARDING.textMuted, fontSize: 11, fontWeight: 800, letterSpacing: "0.06em" }}>
                ESTADO
              </span>
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "6px 12px",
                  borderRadius: 999,
                  fontSize: 14,
                  fontWeight: 700,
                  lineHeight: 1.3,
                  maxWidth: "100%",
                  border: "1px solid rgba(255, 255, 255, 0.12)",
                  background:
                    estadoDisplay.includes("verificad") || estadoDisplay.includes("confirmad")
                      ? "rgba(47, 191, 159, 0.12)"
                      : estadoDisplay.includes("indisponível") || estadoDisplay.includes("Não foi possível")
                        ? "rgba(251, 191, 36, 0.1)"
                        : "rgba(230, 237, 243, 0.07)",
                  color:
                    estadoDisplay.includes("verificad") || estadoDisplay.includes("confirmad")
                      ? "#a7f3d0"
                      : estadoDisplay.includes("indisponível") || estadoDisplay.includes("Não foi possível")
                        ? "#fde68a"
                        : "var(--text-primary, #e6edf3)",
                  boxShadow: "inset 0 1px 0 rgba(255, 255, 255, 0.06)",
                }}
              >
                <span aria-hidden style={{ opacity: 0.9 }}>
                  {estadoDisplay.includes("verificad") ? "✓" : "●"}
                </span>
                {estadoDisplay}
              </span>
            </div>

            <div style={{ margin: "0 0 14px", display: "flex", flexDirection: "column", gap: 6 }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 8,
                  color: "#d4d4d8",
                  fontSize: 13,
                  lineHeight: 1.4,
                }}
              >
                <span aria-hidden style={{ flexShrink: 0, fontSize: 16, lineHeight: 1.2 }}>
                  📄
                </span>
                <span>Documento de identificação válido</span>
              </div>
              <div
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 8,
                  color: "#d4d4d8",
                  fontSize: 13,
                  lineHeight: 1.4,
                }}
              >
                <span aria-hidden style={{ flexShrink: 0, fontSize: 16, lineHeight: 1.2 }}>
                  📷
                </span>
                <span>Câmara do telemóvel ou computador ativa</span>
              </div>
            </div>

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
                      Copie os IDs em dashboard.withpersona.com → Inquiry template / API. Se aparecer «This application is
                      misconfigured» / «template-id is blank»: confirme variáveis na Vercel (ou no servidor) e faça{" "}
                      <strong>redeploy</strong>; em fluxo embebido, na Persona (Domain Manager) use o campo <strong>só com
                      hostname</strong>, p.ex. <code style={{ color: "#d6d3d1" }}>localhost</code> — sem{" "}
                      <code style={{ color: "#d6d3d1" }}>http://</code> nem path. Abra a app em{" "}
                      <code style={{ color: "#d6d3d1" }}>http://localhost:4701</code> para coincidir com essa entrada; o painel
                      costuma <strong>rejeitar</strong> <code style={{ color: "#d6d3d1" }}>127.0.0.1</code> como domínio.
                      Se usou <code style={{ color: "#d6d3d1" }}>NEXT_PUBLIC_PERSONA_HOST=staging</code>, o{" "}
                      <code style={{ color: "#d6d3d1" }}>NEXT_PUBLIC_PERSONA_ENVIRONMENT_ID</code> tem de ser válido nesse
                      ambiente. Para «Could not load template», publique uma versão do template e, se necessário, defina{" "}
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
                {stageStr === "persona-save-failed" ? (
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
                      wordBreak: "break-word",
                    }}
                  >
                    <p style={{ margin: "0 0 10px" }}>
                      {recordSaveWarning.trim() ||
                        "A confirmação não foi gravada no servidor. Utilize o botão abaixo para tentar de novo."}
                    </p>
                    {recordSaveDetail.trim() ? (
                      <div
                        style={{
                          marginBottom: 12,
                          padding: 10,
                          borderRadius: 10,
                          background: "rgba(0,0,0,0.25)",
                          border: "1px solid rgba(248, 113, 113, 0.25)",
                        }}
                      >
                        <div style={{ fontSize: 12, fontWeight: 800, color: "#fda4af", marginBottom: 6 }}>
                          Detalhe técnico
                        </div>
                        <div style={{ fontSize: 13, color: "#fecdd3", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                          {recordSaveDetail}
                        </div>
                      </div>
                    ) : null}
                    <div style={{ marginTop: 4 }}>
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
                      <p style={{ margin: "10px 0 0", color: "#a1a1aa", fontSize: 13, lineHeight: 1.5 }}>
                        Este nome foi registado na verificação e no sistema. Não precisa de alterar nada se corresponder ao seu
                        documento; se estiver incorreto, contacte o suporte antes de continuar.
                      </p>
                    ) : null}
                    {stageStr === "persona-save-failed" ? (
                      <div style={{ marginTop: 14 }}>
                        <Label>Corrigir nome (opcional)</Label>
                        <div style={{ color: "#a1a1aa", fontSize: 12, marginBottom: 8, lineHeight: 1.45 }}>
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
                  <div style={{ color: "#a1a1aa", fontSize: 12, marginTop: 10 }}>Indique o nome completo para continuar.</div>
                ) : null}
              </div>
            ) : null}

            <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 12, alignItems: "center" }}>
              {!personaConfigOk ? (
                <>
                  <div
                    style={{
                      display: "inline-block",
                      alignSelf: "flex-start",
                      background: "#334155",
                      color: "#a1a1aa",
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
                  <p style={{ margin: 0, color: "#71717a", fontSize: 13, lineHeight: 1.5 }}>
                    Use os botões acima para voltar ao perfil ou atualizar a página — o botão só fica disponível quando tudo
                    estiver pronto.
                  </p>
                </>
              ) : hideIniciarButton ? (
                backendSaveConfirmed ? (
                  <p style={{ margin: 0, color: "#71717a", fontSize: 13, lineHeight: 1.5 }}>
                    A sua identidade foi verificada e confirmada. Pode continuar.
                  </p>
                ) : persistInFlight || stageStr === "persona-validating" ? (
                  <p style={{ margin: 0, color: "#a1a1aa", fontSize: 13, lineHeight: 1.5 }}>
                    Aguarde enquanto guardamos a confirmação no sistema…
                  </p>
                ) : stageStr === "persona-save-failed" ? (
                  <p style={{ margin: 0, color: "#a1a1aa", fontSize: 13, lineHeight: 1.5 }}>
                    Utilize «Tentar guardar confirmação» na caixa acima para concluir este passo.
                  </p>
                ) : loading ? (
                  <p style={{ margin: 0, color: "#a1a1aa", fontSize: 13, lineHeight: 1.5 }}>
                    A abrir o assistente de verificação…
                  </p>
                ) : null
              ) : (
                <>
                  <div style={{ textAlign: "center", width: "100%", marginBottom: 2 }}>
                    <div style={{ color: "#a1a1aa", fontSize: 12, fontWeight: 600, lineHeight: 1.35 }}>
                      Este passo demora ~2 minutos
                    </div>
                    <div style={{ color: "#d97706", fontSize: 11, fontWeight: 800, marginTop: 3, letterSpacing: "0.02em" }}>
                      Obrigatório para continuar
                    </div>
                  </div>
                  <div style={{ display: "flex", justifyContent: "center", width: "100%" }}>
                    <Button onClick={startFlow} disabled={loading}>
                      {loading ? "A abrir…" : "Iniciar verificação"}
                    </Button>
                  </div>
                </>
              )}
              {!backendSaveConfirmed && !manualFallbackActive ? (
                <button
                  type="button"
                  onClick={() => continueWithManualReview()}
                  disabled={manualBypassInFlight || persistInFlight}
                  style={{
                    display: "inline-block",
                    background: "transparent",
                    border: "none",
                    color: manualBypassInFlight ? "#57534e" : "#71717a",
                    fontSize: 12,
                    fontWeight: 500,
                    cursor: manualBypassInFlight ? "not-allowed" : "pointer",
                    textDecoration: manualBypassInFlight ? "none" : "underline",
                    textUnderlineOffset: 3,
                    padding: "4px 6px",
                    marginTop: 2,
                    fontFamily: "inherit",
                    lineHeight: 1.35,
                    maxWidth: "100%",
                  }}
                >
                  {manualBypassInFlight
                    ? "A registar modo manual..."
                    : "Continuar com validação manual"}
                </button>
              ) : null}
            </div>

            {showPostPersonaPanel ? (
              <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 10, alignItems: "center", width: "100%" }}>
                {confirmKycButton}
              </div>
            ) : null}

            {manualFallbackActive ? (
              <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 10, alignItems: "center", width: "100%" }}>
                <a
                  href={postIdentityHref}
                  style={{
                    display: "block",
                    marginLeft: "auto",
                    marginRight: "auto",
                    maxWidth: `min(100%, ${ONBOARDING_PRIMARY_CTA_MAX_WIDTH_PX}px)`,
                    width: "100%",
                    boxSizing: "border-box",
                    background: DECIDE_ONBOARDING.buttonPrimaryGradient,
                    color: DECIDE_ONBOARDING.text,
                    border: DECIDE_ONBOARDING.buttonPrimaryBorder,
                    boxShadow:
                      "var(--shadow-button-primary-glow, 0 0 20px rgba(47, 191, 159, 0.25)), 0 4px 14px rgba(0, 0, 0, 0.28)",
                    borderRadius: 14,
                    padding: "11px 16px",
                    fontSize: 15,
                    fontWeight: 800,
                    textDecoration: "none",
                    textAlign: "center",
                  }}
                >
                  Continuar (validação manual pendente)
                </a>
                <div style={{ color: "#a1a1aa", fontSize: 12, lineHeight: 1.5 }}>
                  O pedido ficou marcado para revisão manual. A aprovação final da identidade será confirmada pela equipa.
                </div>
              </div>
            ) : null}

            {!backendSaveConfirmed ? (
              <div style={{ color: "#71717a", fontSize: 11, lineHeight: 1.45, marginTop: 10 }}>
                O assistente abre como <strong>janela escura em ecrã completo</strong> (não só na caixa abaixo) — verifique se não ficou atrás do browser ou se o bloqueador não impediu o iframe.
                <div style={{ marginTop: 10, color: "#57534e", fontSize: 11 }}>
                  Se ficar em branco: o template na Persona precisa de <strong>versão publicada</strong> (na lista de templates,
                  «Last published» não pode estar vazio). A variável <code style={{ color: "#a8a29e" }}>NEXT_PUBLIC_PERSONA_TEMPLATE_VERSION_ID</code>{" "}
                  é opcional. <strong>Não</strong> use <code style={{ color: "#a8a29e" }}>NEXT_PUBLIC_PERSONA_HOST=development</code>: no SDK isso aponta o
                  iframe para <code style={{ color: "#a8a29e" }}>localhost:3000</code> (interno Persona). Sandbox usa <code style={{ color: "#a8a29e" }}>NEXT_PUBLIC_PERSONA_ENVIRONMENT_ID</code>{" "}
                  e, se precisar, <code style={{ color: "#a8a29e" }}>NEXT_PUBLIC_PERSONA_HOST=production</code> ou omita (omissão = production).{" "}
                  <strong>Rede (DevTools):</strong> se o pedido a <code style={{ color: "#a8a29e" }}>inquiry.withpersona.com</code> (documento
                  <code style={{ color: "#a8a29e" }}>widget?…</code>) tiver <strong>403 Forbidden</strong>, a origem (hostname da tua app){" "}
                  <strong>não</strong> está na allowlist da Persona: em dashboard.withpersona.com → <strong>Domain Manager</strong> (ou
                  definição equivalente de domínios do embed), adicione o hostname exato, p.ex. o{" "}
                  <code style={{ color: "#a8a29e" }}>*.vercel.app</code> concreto da barra de endereços — sem <code
                    style={{ color: "#a8a29e" }}
                  >
                    https://
                  </code>
                  .
                </div>
                {stageStr === "persona-iframe-mounted" ? (
                  <div
                    style={{
                      marginTop: 14,
                      padding: "12px 14px",
                      borderRadius: 12,
                      background: "rgba(14, 165, 233, 0.1)",
                      border: "1px solid rgba(56, 189, 248, 0.35)",
                      color: "#99f6e4",
                      fontSize: 12,
                      lineHeight: 1.55,
                    }}
                  >
                    <strong>Diagnóstico:</strong> o iframe da Persona está montado na página. Se a área escura continua vazia,
                    confira na consola Persona o template publicado e o mesmo ambiente que{" "}
                    <code style={{ color: "#d4d4d4" }}>NEXT_PUBLIC_PERSONA_ENVIRONMENT_ID</code>.
                    {" "}Se a mensagem for <strong>«localhost recusou-se a ligar»</strong>, não use{" "}
                    <code style={{ color: "#d4d4d4" }}>NEXT_PUBLIC_PERSONA_HOST=development</code> (o SDK usa{" "}
                    <code style={{ color: "#d4d4d4" }}>localhost:3000</code>). Se o Next só ouvir em{" "}
                    <code style={{ color: "#d4d4d4" }}>127.0.0.1</code> mas a Persona só permitir{" "}
                    <code style={{ color: "#d4d4d4" }}>localhost</code>, use <code style={{ color: "#d4d4d4" }}>npm run dev:lan</code>{" "}
                    (<code style={{ color: "#d4d4d4" }}>0.0.0.0</code>) ou abra <code style={{ color: "#d4d4d4" }}>http://localhost:4701</code>.
                    {" "}Se for <strong>«inquiry.withpersona.com recusou-se a ligar»</strong> (ou erro de ligação semelhante), o browser não está a conseguir HTTPS até aos servidores Persona: teste abrir{" "}
                    <a href="https://inquiry.withpersona.com/" target="_blank" rel="noopener noreferrer" style={{ color: "#7dd3fc" }}>
                      inquiry.withpersona.com
                    </a>{" "}
                    noutro separador; desative temporariamente bloqueadores, VPN ou inspecção HTTPS do antivírus; experimente outra rede ou{" "}
                    <code style={{ color: "#d4d4d4" }}>NEXT_PUBLIC_PERSONA_HOST=staging</code> em <code style={{ color: "#d4d4d4" }}>.env.local</code> (reinicie o Next). No Windows, falhas de verificação de revogação de certificado (proxy offline) também bloqueiam ligações TLS.
                    {" "}No DevTools → Rede, confirme se o pedido ao domínio Persona falha antes da resposta.
                  </div>
                ) : null}
                {embedBlockedByPersona && !manualFallbackActive ? (
                  <div
                    style={{
                      marginTop: 14,
                      padding: "12px 14px",
                      borderRadius: 12,
                      background: "rgba(251, 191, 36, 0.12)",
                      border: "1px solid rgba(251, 191, 36, 0.45)",
                      color: "#fef3c7",
                      fontSize: 12,
                      lineHeight: 1.55,
                    }}
                  >
                    O assistente automático pode falhar <strong>neste hostname</strong> (Persona embedded flow): na consola
                    Persona, no mesmo sítio onde definiu domínios para{" "}
                    <code style={{ color: "#fef9c3" }}>localhost</code>, adicione{" "}
                    {requestHost ? (
                      <code style={{ color: "#fef9c3" }}>{requestHost.split(":")[0]}</code>
                    ) : (
                      "o host da barra de endereços (só o nome, sem protocolo)"
                    )}
                    , ou abra a app no <strong>domínio de produção</strong> aprovado. Pode continuar em{" "}
                    <strong>modo manual</strong> (botão abaixo) e a equipa valida a identidade depois.
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>

          <div
            style={{
              position: "relative",
              border: "1px solid rgba(63, 63, 70, 0.65)",
              borderRadius: 16,
              overflow: "hidden",
              background: "linear-gradient(180deg, var(--bg-card) 0%, var(--bg-main) 100%)",
              boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)",
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

