import Head from "next/head";
import { useRouter } from "next/router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { markEmailVerified, setSignupEmailVerifiedFromServerEmail } from "../../lib/clientAuth";
import { devConfirmationLinkUsesLoopback } from "../../lib/emailConfirmationDevLink";
import { DECIDE_APP_FONT_FAMILY, DECIDE_DASHBOARD, DECIDE_ONBOARDING } from "../../lib/decideClientTheme";

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
  const [pageOrigin, setPageOrigin] = useState("");
  const tokenRef = useRef<string>("");

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setPageOrigin(window.location.origin);
  }, []);

  const runVerifyFlow = useCallback(async (token: string) => {
    if (!token) {
      setStatus("err");
      setDetail("Falta o token no link. Abra o endereço completo que veio no email.");
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
        setDetail(j.error || "Token inválido ou expirado (48h). Solicite um novo email na página de registo.");
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
          "Este telemóvel ainda não tem a conta guardada (é normal). Toque em «Tentar de novo» depois de fazer login neste browser, ou abra o mesmo link no PC onde criou a conta.",
        );
        return;
      }
      setStatus("err");
      setDetail(m.error || "Não foi possível confirmar.");
    } catch {
      setStatus("err");
      setDetail("Erro de rede ao validar o token. Verifique a ligação e toque em «Tentar de novo».");
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
        "Falta o token no link (a app de email pode ter cortado o endereço). Abra o email noutro browser: toque nos três pontos → «Abrir no Chrome/Safari» — ou copie o link completo para o PC.",
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
    fontFamily: DECIDE_APP_FONT_FAMILY,
    WebkitFontSmoothing: "antialiased",
  };

  const themeColor =
    status === "ok" ? "#18181b" : status === "err" ? "#1c1917" : DECIDE_DASHBOARD.pageBg;

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
            background: DECIDE_ONBOARDING.pageBackground,
            color: DECIDE_ONBOARDING.text,
          }}
        >
          <div style={{ width: "100%", maxWidth: 400, textAlign: "center" }}>
            <div style={{ fontSize: 20, fontWeight: 800, letterSpacing: "-0.02em", marginBottom: 10 }}>
              Confirmar o email
            </div>
            <p style={{ margin: "0 0 24px", fontSize: 14, color: "#a1a1aa", lineHeight: 1.55 }}>
              Carregue no botão abaixo para concluir. Algumas apps de email não permitem a confirmação automática ao
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
                Este endereço utiliza <strong>127.0.0.1</strong> ou <strong>localhost</strong>. Num telemóvel isso{" "}
                <strong>não é o seu PC</strong> — mesmo após confirmar, o servidor pode estar inacessível. Para testar no
                telemóvel, configure <code style={{ color: "#fff" }}>EMAIL_LINK_BASE_URL</code> com o IP da rede (ex.{" "}
                <code style={{ color: "#fde68a" }}>http://192.168.1.x:4701</code>) e gere um link novo no dashboard/registo.
              </div>
            ) : null}
            <form
              style={{ margin: 0 }}
              onSubmit={(e) => {
                e.preventDefault();
                void runVerifyFlow(tokenRef.current);
              }}
            >
              <button
                type="submit"
                autoFocus
                style={{
                  display: "block",
                  width: "100%",
                  boxSizing: "border-box",
                  padding: "18px 22px",
                  borderRadius: 14,
                  background: DECIDE_DASHBOARD.buttonRegister,
                  color: DECIDE_DASHBOARD.kpiMenuMainButtonColor,
                  fontSize: 17,
                  fontWeight: 800,
                  border: DECIDE_DASHBOARD.kpiMenuMainButtonBorder,
                  boxShadow: `${DECIDE_DASHBOARD.kpiMenuMainButtonShadow}, 0 12px 32px rgba(13, 148, 136, 0.32)`,
                  cursor: "pointer",
                }}
              >
                Confirmar email agora
              </button>
            </form>
            <p style={{ marginTop: 20, fontSize: 12, color: "#71717a", lineHeight: 1.45 }}>
              Se o link utilizar <code style={{ color: "#a1a1aa" }}>127.0.0.1</code> e não funcionar no telemóvel, defina{" "}
              <code style={{ color: "#a1a1aa" }}>EMAIL_LINK_BASE_URL</code> com o IP do PC e reenvie o email.
            </p>
          </div>
        </div>
      ) : null}

      {status === "loading" ? (
        <div
          style={{
            ...shell,
            background: DECIDE_ONBOARDING.pageBackground,
            color: DECIDE_ONBOARDING.text,
          }}
        >
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: "50%",
              border: "3px solid rgba(148,163,184,0.25)",
              borderTopColor: "#52525b",
              animation: "decideSpin 0.85s linear infinite",
              marginBottom: 24,
            }}
          />
          <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: "-0.02em" }}>A confirmar o email…</div>
          <div style={{ marginTop: 10, fontSize: 14, color: "#a1a1aa", maxWidth: 280, textAlign: "center" }}>
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
              "radial-gradient(ellipse 140% 90% at 50% -20%, rgba(45,212,191,0.2) 0%, transparent 50%), radial-gradient(120% 70% at 50% 100%, rgba(13,148,136,0.12) 0%, transparent 45%), linear-gradient(165deg, #18181b 0%, #09090b 100%)",
            color: DECIDE_DASHBOARD.text,
          }}
        >
          <div style={{ width: "100%", maxWidth: 400, textAlign: "center" }}>
            <div
              style={{
                width: 72,
                height: 72,
                margin: "0 auto 20px",
                borderRadius: "50%",
                background: "linear-gradient(145deg, rgba(45,212,191,0.28), rgba(13,148,136,0.2))",
                border: "1px solid rgba(45,212,191,0.45)",
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
            <p style={{ margin: "0 0 20px", fontSize: 15, color: "#a1a1aa", lineHeight: 1.5 }}>
              {okKind === "prospect"
                ? "O seu email ficou na nossa lista para receber novidades e informações sobre a DECIDE (sem conta criada)."
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
                color: "var(--text-primary)",
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
                    color: "#d4d4d8",
                    lineHeight: 1.55,
                    textAlign: "left",
                  }}
                >
                  <strong>No computador</strong>, a página de registo DECIDE deve mostrar o email como confirmado em
                  poucos segundos (ou recarregue). <strong>Não precisa</strong> de voltar ao registo aqui no telemóvel.
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
                    background: DECIDE_DASHBOARD.buttonRegister,
                    color: DECIDE_DASHBOARD.kpiMenuMainButtonColor,
                    fontSize: 16,
                    fontWeight: 800,
                    textAlign: "center",
                    border: DECIDE_DASHBOARD.kpiMenuMainButtonBorder,
                    boxShadow: `${DECIDE_DASHBOARD.kpiMenuMainButtonShadow}, 0 12px 28px rgba(13, 148, 136, 0.3)`,
                    cursor: "pointer",
                  }}
                >
                  OK — concluído
                </button>
                {mobileDoneHint ? (
                  <p style={{ marginTop: 14, fontSize: 13, color: "#a1a1aa", lineHeight: 1.45 }}>
                    Pode <strong>fechar este separador</strong> (ou voltar atrás). Continue o registo no PC.
                  </p>
                ) : null}
                <div
                  style={{
                    marginTop: 14,
                    marginBottom: 8,
                    padding: "12px 14px",
                    borderRadius: 12,
                    background: "rgba(51, 65, 85, 0.45)",
                    border: "1px solid rgba(148, 163, 184, 0.3)",
                    fontSize: 12,
                    color: "#d4d4d8",
                    lineHeight: 1.5,
                    textAlign: "left",
                  }}
                >
                  Se ao continuar o browser disser que o endereço (ex. <strong>192.168.x.x</strong>) está{" "}
                  <strong>inacessível</strong>: o Next.js no PC pode ter parado, o <strong>IP do PC mudou</strong>, o
                  telemóvel saiu da <strong>mesma Wi‑Fi</strong>, ou a <strong>firewall</strong> bloqueia a porta. Confirme
                  no PC <code style={{ color: "#e2e8f0" }}>ipconfig</code>, volte a executar <code style={{ color: "#e2e8f0" }}>npm run dev:lan</code>, e
                  solicite um <strong>novo email</strong> de confirmação se alterou o IP em <code style={{ color: "#e2e8f0" }}>.env.local</code>.
                </div>
                <a
                  href={pageOrigin ? `${pageOrigin}/client/register` : "/client/register"}
                  style={{
                    display: "block",
                    marginTop: 18,
                    fontSize: 14,
                    fontWeight: 600,
                    color: DECIDE_DASHBOARD.link,
                    textAlign: "center",
                  }}
                >
                  Prefiro criar a conta neste telemóvel →
                </a>
              </>
            ) : (
              <>
                <a
                  href={
                    okKind === "signup"
                      ? pageOrigin
                        ? `${pageOrigin}/client/register`
                        : "/client/register"
                      : pageOrigin
                        ? `${pageOrigin}/client-dashboard`
                        : "/client-dashboard"
                  }
                  style={{
                    display: "block",
                    width: "100%",
                    boxSizing: "border-box",
                    padding: "16px 22px",
                    borderRadius: 14,
                    background: DECIDE_DASHBOARD.buttonRegister,
                    color: DECIDE_DASHBOARD.kpiMenuMainButtonColor,
                    fontSize: 16,
                    fontWeight: 800,
                    textDecoration: "none",
                    textAlign: "center",
                    border: DECIDE_DASHBOARD.kpiMenuMainButtonBorder,
                    boxShadow: `${DECIDE_DASHBOARD.kpiMenuMainButtonShadow}, 0 12px 32px rgba(13, 148, 136, 0.32)`,
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
                      color: "#d4d4d4",
                      textAlign: "center",
                    }}
                  >
                    Quando quiser, crie a sua conta →
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
                    color: "#a1a1aa",
                    padding: "10px 0",
                    listStyle: "none",
                  }}
                >
                  Abriu no telemóvel?
                </summary>
                <p style={{ margin: "0 0 10px", fontSize: 13, color: "#d4d4d8", lineHeight: 1.55 }}>
                  A confirmação ficou registada no servidor. No <strong>PC</strong>, na página de registo, o estado deve
                  actualizar em poucos segundos — ou recarregue a página.
                </p>
                <p style={{ margin: 0, fontSize: 12, color: "#71717a", lineHeight: 1.5 }}>
                  Link no email com <code style={{ color: "#a1a1aa" }}>127.0.0.1</code> não abre no telemóvel; utilize{" "}
                  <code style={{ color: "#a1a1aa" }}>EMAIL_LINK_BASE_URL</code> com o IP do PC e{" "}
                  <code style={{ color: "#a1a1aa" }}>npm run dev:lan</code>.
                </p>
              </details>
            ) : null}

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
                  background: DECIDE_DASHBOARD.buttonRegister,
                  color: DECIDE_DASHBOARD.kpiMenuMainButtonColor,
                  fontWeight: 800,
                  fontSize: 16,
                  border: DECIDE_DASHBOARD.kpiMenuMainButtonBorder,
                  cursor: "pointer",
                  boxShadow: DECIDE_DASHBOARD.kpiMenuMainButtonShadow,
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
                      setCopyHint("Link copiado — pode colar no Safari/Chrome ou no PC.");
                    });
                  }}
                  style={{
                    display: "block",
                    width: "100%",
                    marginTop: 10,
                    padding: "12px 16px",
                    borderRadius: 12,
                    background: "transparent",
                    color: "#d4d4d4",
                    fontWeight: 700,
                    fontSize: 14,
                    border: "1px solid rgba(45,212,191,0.35)",
                    cursor: "pointer",
                  }}
                >
                  Copiar este link (abrir doutro browser ou no PC)
                </button>
                {copyHint ? (
                  <p style={{ marginTop: 10, fontSize: 13, color: DECIDE_DASHBOARD.accentSky, lineHeight: 1.4 }}>{copyHint}</p>
                ) : null}
              </>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  );
}
