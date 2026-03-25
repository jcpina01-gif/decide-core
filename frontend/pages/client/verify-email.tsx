import Head from "next/head";
import { useRouter } from "next/router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { markEmailVerified, setSignupEmailVerifiedFromServerEmail } from "../../lib/clientAuth";
import { devConfirmationLinkUsesLoopback } from "../../lib/emailConfirmationDevLink";

/**
 * Pedir confirmação com toque: in-app mail / browsers em telemóvel ou tablet (incl. ecrãs >640px)
 * e dispositivos com pointer grosso.
 */
function useManualConfirmTrigger(): { useManualButton: boolean; ready: boolean } {
  const [useManualButton, setUse] = useState(false);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const narrow = window.matchMedia("(max-width: 768px)");
    const coarse = window.matchMedia("(pointer: coarse)");
    const apply = () => setUse(narrow.matches || coarse.matches);
    apply();
    setReady(true);
    narrow.addEventListener("change", apply);
    coarse.addEventListener("change", apply);
    return () => {
      narrow.removeEventListener("change", apply);
      coarse.removeEventListener("change", apply);
    };
  }, []);
  return { useManualButton, ready };
}

type VerifyStatus = "loading" | "pending_action" | "ok" | "err";

export default function ClientVerifyEmailPage() {
  const router = useRouter();
  const { useManualButton: touchStyleConfirm, ready: viewportReady } = useManualConfirmTrigger();
  const [mounted, setMounted] = useState(false);
  const [status, setStatus] = useState<VerifyStatus>("loading");
  const [detail, setDetail] = useState("");
  const [okKind, setOkKind] = useState<"signup" | "account" | "prospect">("account");
  const [mobileDoneHint, setMobileDoneHint] = useState(false);
  const [copyHint, setCopyHint] = useState("");
  const tokenRef = useRef<string>("");

  useEffect(() => {
    setMounted(true);
  }, []);

  const runVerifyFlow = useCallback(async (token: string) => {
    if (!token) {
      setStatus("err");
      setDetail("Falta o token no link. Abre o endereço completo que veio no email.");
      return;
    }

    setStatus("loading");
    setDetail("");
    setCopyHint("");

    try {
      const r = await fetch("/api/client/email-verification/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const j = (await r.json()) as {
        ok?: boolean;
        flow?: "account" | "signup" | "prospect";
        signupOnly?: boolean;
        prospectOnly?: boolean;
        username?: string | null;
        email?: string;
        error?: string;
      };
      if (!r.ok || !j.ok || !j.email) {
        setStatus("err");
        setDetail(j.error || "Token inválido ou expirado (48h). Pede um novo email na página de registo.");
        return;
      }
      const flow: "account" | "signup" | "prospect" =
        j.flow ||
        (j.prospectOnly ? "prospect" : j.signupOnly ? "signup" : j.username ? "account" : "signup");

      if (flow === "prospect") {
        try {
          await fetch("/api/client/email-verification/record-prospect", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token }),
          });
        } catch {
          // ignore
        }
        setOkKind("prospect");
        setStatus("ok");
        setDetail(j.email);
        return;
      }

      if (flow === "signup") {
        setSignupEmailVerifiedFromServerEmail(j.email);
        try {
          await fetch("/api/client/email-verification/record-signup", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token }),
          });
        } catch {
          // ignore
        }
        setOkKind("signup");
        setStatus("ok");
        setDetail(j.email);
        return;
      }

      const m = markEmailVerified(j.username!, j.email);
      if (m.ok) {
        setOkKind("account");
        setStatus("ok");
        setDetail(j.email);
        return;
      }
      if (m.error === "no_local_account") {
        setStatus("err");
        setDetail(
          "Este telemóvel ainda não tem a conta guardada (é normal). Toca em «Tentar de novo» depois de fazer login neste browser, ou abre o mesmo link no PC onde criaste a conta.",
        );
        return;
      }
      setStatus("err");
      setDetail(m.error || "Não foi possível confirmar.");
    } catch {
      setStatus("err");
      setDetail("Erro de rede ao validar o token. Verifica a ligação e toca em «Tentar de novo».");
    }
  }, []);

  useEffect(() => {
    if (!router.isReady || !viewportReady) return;
    const tokenRaw = router.query.token;
    let token = typeof tokenRaw === "string" ? tokenRaw : Array.isArray(tokenRaw) ? tokenRaw[0] : "";
    // Gmail / in-app browsers: por vezes o query string existe na barra mas o router ainda não expôs o token.
    if (!token && typeof window !== "undefined") {
      try {
        const fromSearch = new URLSearchParams(window.location.search).get("token");
        if (fromSearch) token = fromSearch;
      } catch {
        // ignore
      }
    }
    tokenRef.current = token;

    if (!token) {
      setStatus("err");
      setDetail(
        "Falta o token no link (a app de email pode ter cortado o endereço). Abre o email noutro browser: toca nos três pontos → «Abrir no Chrome/Safari» — ou copia o link completo para o PC.",
      );
      return;
    }

    // Telemóvel: confirmação com toque (evita falhas em browsers in-app / pedidos automáticos bloqueados).
    if (touchStyleConfirm) {
      setStatus("pending_action");
      return;
    }

    void runVerifyFlow(token);
  }, [router.isReady, router.query.token, touchStyleConfirm, viewportReady, runVerifyFlow]);

  const shell: React.CSSProperties = {
    minHeight: "100vh",
    margin: 0,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    padding: "28px 20px 40px",
    boxSizing: "border-box",
    fontFamily: 'system-ui, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    WebkitFontSmoothing: "antialiased",
  };

  const themeColor =
    status === "ok" ? "#0f172a" : status === "err" ? "#1c1917" : "#0c1222";

  return (
    <>
      <Head>
        <title>DECIDE — Confirmar email</title>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <meta name="theme-color" content={themeColor} />
        <style>{`details > summary { list-style: none; } details > summary::-webkit-details-marker { display: none; }`}</style>
      </Head>

      {status === "pending_action" ? (
        <div
          style={{
            ...shell,
            background: "radial-gradient(120% 80% at 50% 0%, #1e3a5f 0%, #0c1222 55%, #050810 100%)",
            color: "#e2e8f0",
          }}
        >
          <div style={{ width: "100%", maxWidth: 400, textAlign: "center" }}>
            <div style={{ fontSize: 20, fontWeight: 800, letterSpacing: "-0.02em", marginBottom: 10 }}>
              Confirmar o teu email
            </div>
            <p style={{ margin: "0 0 24px", fontSize: 14, color: "#94a3b8", lineHeight: 1.55 }}>
              Carrega no botão abaixo para concluir. Algumas apps de email não permitem a confirmação automática ao
              abrir o link.
            </p>
            {typeof window !== "undefined" && devConfirmationLinkUsesLoopback(window.location.href) ? (
              <div
                style={{
                  marginBottom: 20,
                  padding: 12,
                  borderRadius: 12,
                  background: "rgba(127,29,29,0.45)",
                  border: "1px solid rgba(248,113,113,0.5)",
                  color: "#fecaca",
                  fontSize: 12,
                  lineHeight: 1.5,
                  textAlign: "left",
                }}
              >
                Este endereço usa <strong>127.0.0.1</strong> ou <strong>localhost</strong>. Num telemóvel isso{" "}
                <strong>não é o teu PC</strong> — mesmo após confirmar, o servidor pode estar inacessível. Para testar no
                telemóvel, configura <code style={{ color: "#fff" }}>EMAIL_LINK_BASE_URL</code> com o IP da rede (ex.{" "}
                <code style={{ color: "#fde68a" }}>http://192.168.1.x:4701</code>) e gera um link novo no dashboard/registo.
              </div>
            ) : null}
            <button
              type="button"
              onClick={() => void runVerifyFlow(tokenRef.current)}
              style={{
                display: "block",
                width: "100%",
                boxSizing: "border-box",
                padding: "18px 22px",
                borderRadius: 14,
                background: "linear-gradient(180deg, #3b82f6 0%, #2563eb 100%)",
                color: "#fff",
                fontSize: 17,
                fontWeight: 800,
                border: "1px solid rgba(255,255,255,0.12)",
                boxShadow: "0 12px 32px rgba(37,99,235,0.35)",
                cursor: "pointer",
              }}
            >
              Confirmar email agora
            </button>
            <p style={{ marginTop: 20, fontSize: 12, color: "#64748b", lineHeight: 1.45 }}>
              Se o link usar <code style={{ color: "#94a3b8" }}>127.0.0.1</code> e não funcionar no telemóvel, define{" "}
              <code style={{ color: "#94a3b8" }}>EMAIL_LINK_BASE_URL</code> com o IP do PC e reenvia o email.
            </p>
          </div>
        </div>
      ) : null}

      {status === "loading" ? (
        <div
          style={{
            ...shell,
            background: "radial-gradient(120% 80% at 50% 0%, #1e3a5f 0%, #0c1222 55%, #050810 100%)",
            color: "#e2e8f0",
          }}
        >
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: "50%",
              border: "3px solid rgba(148,163,184,0.25)",
              borderTopColor: "#38bdf8",
              animation: "decideSpin 0.85s linear infinite",
              marginBottom: 24,
            }}
          />
          <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: "-0.02em" }}>A confirmar o teu email…</div>
          <div style={{ marginTop: 10, fontSize: 14, color: "#94a3b8", maxWidth: 280, textAlign: "center" }}>
            Só um momento.
          </div>
          <style>{`@keyframes decideSpin { to { transform: rotate(360deg); } }`}</style>
        </div>
      ) : null}

      {status === "ok" ? (
        <div
          style={{
            ...shell,
            background:
              "radial-gradient(ellipse 140% 90% at 50% -20%, rgba(34,197,94,0.22) 0%, transparent 50%), radial-gradient(120% 70% at 50% 100%, rgba(59,130,246,0.12) 0%, transparent 45%), linear-gradient(165deg, #0f172a 0%, #020617 100%)",
            color: "#f8fafc",
          }}
        >
          <div style={{ width: "100%", maxWidth: 400, textAlign: "center" }}>
            <div
              style={{
                width: 72,
                height: 72,
                margin: "0 auto 20px",
                borderRadius: "50%",
                background: "linear-gradient(145deg, rgba(34,197,94,0.35), rgba(22,163,74,0.15))",
                border: "1px solid rgba(74,222,128,0.45)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 36,
                lineHeight: 1,
              }}
              aria-hidden
            >
              ✓
            </div>
            <h1
              style={{
                margin: "0 0 8px",
                fontSize: 26,
                fontWeight: 800,
                letterSpacing: "-0.03em",
                lineHeight: 1.2,
              }}
            >
              Está feito
            </h1>
            <p style={{ margin: "0 0 20px", fontSize: 15, color: "#94a3b8", lineHeight: 1.5 }}>
              {okKind === "prospect"
                ? "Ficas na nossa lista para receberes novidades e informações sobre a DECIDE (sem conta criada)."
                : "O endereço foi confirmado com sucesso."}
            </p>
            <div
              style={{
                display: "inline-block",
                maxWidth: "100%",
                padding: "10px 16px",
                borderRadius: 999,
                background: "rgba(15,23,42,0.85)",
                border: "1px solid rgba(148,163,184,0.25)",
                fontSize: 14,
                fontWeight: 600,
                color: "#e2e8f0",
                wordBreak: "break-all",
                marginBottom: 20,
              }}
            >
              {detail}
            </div>

            {okKind === "signup" && touchStyleConfirm ? (
              <>
                <p
                  style={{
                    margin: "0 0 20px",
                    fontSize: 14,
                    color: "#cbd5e1",
                    lineHeight: 1.55,
                    textAlign: "left",
                  }}
                >
                  <strong>No computador</strong>, a página de registo DECIDE deve mostrar o email como confirmado em
                  poucos segundos (ou recarrega). <strong>Não precisas</strong> de voltar ao registo aqui no telemóvel.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    try {
                      window.close();
                    } catch {
                      // ignore
                    }
                    setTimeout(() => {
                      if (typeof window !== "undefined" && window.history.length > 1) {
                        window.history.back();
                      }
                      setMobileDoneHint(true);
                    }, 150);
                  }}
                  style={{
                    display: "block",
                    width: "100%",
                    boxSizing: "border-box",
                    padding: "16px 22px",
                    borderRadius: 14,
                    background: "linear-gradient(180deg, #22c55e 0%, #16a34a 100%)",
                    color: "#fff",
                    fontSize: 16,
                    fontWeight: 800,
                    textAlign: "center",
                    border: "1px solid rgba(255,255,255,0.15)",
                    boxShadow: "0 12px 28px rgba(22,163,74,0.35)",
                    cursor: "pointer",
                  }}
                >
                  OK — concluído
                </button>
                {mobileDoneHint ? (
                  <p style={{ marginTop: 14, fontSize: 13, color: "#94a3b8", lineHeight: 1.45 }}>
                    Podes <strong>fechar este separador</strong> (ou voltar atrás). Continua o registo no PC.
                  </p>
                ) : null}
                <a
                  href="/client/register"
                  style={{
                    display: "block",
                    marginTop: 18,
                    fontSize: 14,
                    fontWeight: 600,
                    color: "#93c5fd",
                    textAlign: "center",
                  }}
                >
                  Prefiro criar a conta neste telemóvel →
                </a>
              </>
            ) : (
              <>
                <a
                  href={okKind === "signup" ? "/client/register" : "/client-dashboard"}
                  style={{
                    display: "block",
                    width: "100%",
                    boxSizing: "border-box",
                    padding: "16px 22px",
                    borderRadius: 14,
                    background: "linear-gradient(180deg, #3b82f6 0%, #2563eb 100%)",
                    color: "#fff",
                    fontSize: 16,
                    fontWeight: 800,
                    textDecoration: "none",
                    textAlign: "center",
                    border: "1px solid rgba(255,255,255,0.12)",
                    boxShadow: "0 12px 32px rgba(37,99,235,0.35)",
                  }}
                >
                  {okKind === "signup"
                    ? "Continuar o registo na DECIDE"
                    : okKind === "prospect"
                      ? "Ir para o dashboard"
                      : "Ir para o dashboard"}
                </a>
                {okKind === "prospect" ? (
                  <a
                    href="/client/register"
                    style={{
                      display: "block",
                      marginTop: 14,
                      fontSize: 14,
                      fontWeight: 600,
                      color: "#93c5fd",
                      textAlign: "center",
                    }}
                  >
                    Quando quiseres, cria a tua conta →
                  </a>
                ) : null}
              </>
            )}

            {okKind === "signup" && !touchStyleConfirm ? (
              <details
                style={{
                  marginTop: 28,
                  textAlign: "left",
                  borderRadius: 12,
                  border: "1px solid rgba(148,163,184,0.2)",
                  background: "rgba(15,23,42,0.5)",
                  padding: "4px 14px 12px",
                }}
              >
                <summary
                  style={{
                    cursor: "pointer",
                    fontSize: 13,
                    fontWeight: 700,
                    color: "#94a3b8",
                    padding: "10px 0",
                    listStyle: "none",
                  }}
                >
                  Abriste no telemóvel?
                </summary>
                <p style={{ margin: "0 0 10px", fontSize: 13, color: "#cbd5e1", lineHeight: 1.55 }}>
                  A confirmação ficou registada no servidor. No <strong>PC</strong>, na página de registo, o estado deve
                  actualizar em poucos segundos — ou recarrega a página.
                </p>
                <p style={{ margin: 0, fontSize: 12, color: "#64748b", lineHeight: 1.5 }}>
                  Link no email com <code style={{ color: "#94a3b8" }}>127.0.0.1</code> não abre no telemóvel; usa{" "}
                  <code style={{ color: "#94a3b8" }}>EMAIL_LINK_BASE_URL</code> com o IP do PC e{" "}
                  <code style={{ color: "#94a3b8" }}>npm run dev:lan</code>.
                </p>
              </details>
            ) : null}

            <p style={{ marginTop: 24, fontSize: 11, color: "#475569", letterSpacing: "0.06em" }}>DECIDE</p>
          </div>
        </div>
      ) : null}

      {status === "err" ? (
        <div
          style={{
            ...shell,
            background: "linear-gradient(165deg, #1c1917 0%, #0c0a09 100%)",
            color: "#fecaca",
          }}
        >
          <div style={{ width: "100%", maxWidth: 400, textAlign: "center" }}>
            <div
              style={{
                width: 64,
                height: 64,
                margin: "0 auto 18px",
                borderRadius: "50%",
                background: "rgba(127,29,29,0.35)",
                border: "1px solid rgba(248,113,113,0.35)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 30,
              }}
              aria-hidden
            >
              !
            </div>
            <h1 style={{ margin: "0 0 12px", fontSize: 22, fontWeight: 800, color: "#fef2f2" }}>
              Não deu para confirmar
            </h1>
            <p style={{ margin: "0 0 20px", fontSize: 14, lineHeight: 1.55, color: "#fca5a5", textAlign: "left" }}>
              {detail}
            </p>
            {tokenRef.current ? (
              <button
                type="button"
                onClick={() => void runVerifyFlow(tokenRef.current)}
                style={{
                  display: "block",
                  width: "100%",
                  boxSizing: "border-box",
                  marginBottom: 12,
                  padding: "16px 20px",
                  borderRadius: 14,
                  background: "linear-gradient(180deg, #3b82f6 0%, #2563eb 100%)",
                  color: "#fff",
                  fontWeight: 800,
                  fontSize: 16,
                  border: "1px solid rgba(255,255,255,0.12)",
                  cursor: "pointer",
                }}
              >
                Tentar confirmar de novo
              </button>
            ) : null}
            <a
              href="/client/register"
              style={{
                display: "block",
                padding: "14px 20px",
                borderRadius: 14,
                background: "#292524",
                color: "#fef2f2",
                fontWeight: 800,
                textDecoration: "none",
                border: "1px solid rgba(255,255,255,0.1)",
              }}
            >
              Voltar ao registo
            </a>
            {mounted ? (
              <>
                <button
                  type="button"
                  onClick={() => {
                    const href = typeof window !== "undefined" ? window.location.href : "";
                    if (!href) return;
                    void navigator.clipboard?.writeText(href).then(() => {
                      setCopyHint("Link copiado — podes colar no Safari/Chrome ou no PC.");
                    });
                  }}
                  style={{
                    display: "block",
                    width: "100%",
                    marginTop: 10,
                    padding: "12px 16px",
                    borderRadius: 12,
                    background: "transparent",
                    color: "#93c5fd",
                    fontWeight: 700,
                    fontSize: 14,
                    border: "1px solid rgba(147,197,253,0.35)",
                    cursor: "pointer",
                  }}
                >
                  Copiar este link (abrir doutro browser ou no PC)
                </button>
                {copyHint ? (
                  <p style={{ marginTop: 10, fontSize: 13, color: "#86efac", lineHeight: 1.4 }}>{copyHint}</p>
                ) : null}
              </>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  );
}
