import React, { useCallback, useEffect, useRef, useState } from "react";
import InlineLoadingDots from "./InlineLoadingDots";
import { DECIDE_SUPPORT_EMAIL } from "../lib/decideSupportContact";

type ChatMessage = { role: "user" | "assistant"; content: string };

type AssistantDiag = {
  openaiConfigured: boolean;
  hints: string[];
  vercel: boolean;
  vercelEnv: string | null;
};

export default function DecideHelpAssistantPanel() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>("");
  const [diag, setDiag] = useState<AssistantDiag | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch("/api/help/assistant", { credentials: "same-origin" });
        const data = (await r.json()) as {
          ok?: boolean;
          openaiConfigured?: boolean;
          hints?: string[];
          vercel?: boolean;
          vercelEnv?: string | null;
        };
        if (cancelled || !data || data.ok !== true) return;
        setDiag({
          openaiConfigured: Boolean(data.openaiConfigured),
          hints: Array.isArray(data.hints) ? data.hints : [],
          vercel: Boolean(data.vercel),
          vercelEnv: data.vercelEnv ?? null,
        });
      } catch {
        // ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const scrollToBottom = useCallback(() => {
    try {
      bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    } catch {
      // ignore
    }
  }, []);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || busy) return;
    setError("");
    setInput("");
    const next: ChatMessage[] = [...messages, { role: "user", content: text }];
    setMessages(next);
    setBusy(true);
    requestAnimationFrame(scrollToBottom);

    try {
      const r = await fetch("/api/help/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ messages: next }),
      });
      const data = (await r.json()) as { ok?: boolean; error?: string; message?: string };
      if (!r.ok || !data.ok || !data.message) {
        setError(data.error || `Erro ${r.status}`);
        return;
      }
      setMessages([...next, { role: "assistant", content: data.message }]);
      requestAnimationFrame(scrollToBottom);
    } catch {
      setError("Não foi possível enviar o pedido.");
    } finally {
      setBusy(false);
    }
  }, [busy, input, messages, scrollToBottom]);

  return (
    <div
      style={{
        minHeight: 400,
        borderRadius: 12,
        border: "1px solid rgba(63,63,70,0.85)",
        background: "linear-gradient(180deg, rgba(39,39,42,0.98) 0%, rgba(24,24,27,0.98) 100%)",
        padding: "22px 24px 24px",
        boxSizing: "border-box",
        display: "flex",
        flexDirection: "column",
        gap: 14,
        maxHeight: "min(1240px, calc(100vh - 220px))",
      }}
    >
      <div>
        <div style={{ fontSize: 12, fontWeight: 800, color: "#71717a", letterSpacing: "0.06em", marginBottom: 6 }}>
          DECIDE AI · Ajuda
        </div>
        <h2 style={{ margin: "0 0 8px 0", fontSize: 20, fontWeight: 800, color: "var(--text-primary)" }}>Assistente</h2>
        <p style={{ margin: 0, fontSize: 12, color: "#a1a1aa", lineHeight: 1.55, maxWidth: 720 }}>
          Documentação DECIDE (fluxos, depósitos na IBKR, dashboard) e glossário; pode também explicar conceitos financeiros
          de forma geral, a título educativo.{" "}
          <strong style={{ color: "#d4d4d8" }}>Não é aconselhamento financeiro personalizado.</strong> Para questões
          sensíveis ou reclamações, utilize{" "}
          <a href={`mailto:${DECIDE_SUPPORT_EMAIL}`} style={{ color: "#d4d4d4" }}>
            {DECIDE_SUPPORT_EMAIL}
          </a>
          .
        </p>
        {diag && !diag.openaiConfigured ? (
          <div
            style={{
              marginTop: 12,
              padding: "12px 14px",
              borderRadius: 10,
              border: "1px solid rgba(251,191,36,0.45)",
              background: "rgba(120,53,15,0.25)",
              fontSize: 12,
              lineHeight: 1.55,
              color: "#fde68a",
            }}
          >
            <strong style={{ color: "#fef3c7" }}>O servidor ainda não vê a API key.</strong>{" "}
            {diag.vercel ? (
              <span>
                Vercel ({diag.vercelEnv || "ambiente ?"}): confirme <code style={{ color: "#fff" }}>OPENAI_API_KEY</code>{" "}
                para <strong>Production</strong> se estiver no domínio de produção, guarde e faça <strong>Redeploy</strong>.
              </span>
            ) : (
              <span>
                Local: ficheiro <code style={{ color: "#fff" }}>frontend/.env.local</code> com{" "}
                <code style={{ color: "#fff" }}>OPENAI_API_KEY=sk-...</code> e reinicia{" "}
                <code style={{ color: "#fff" }}>npm run dev</code>.
              </span>
            )}
            {diag.hints.length > 0 ? (
              <ul style={{ margin: "10px 0 0 0", paddingLeft: 18, color: "#fcd34d" }}>
                {diag.hints.map((h, i) => (
                  <li key={i} style={{ marginBottom: 4 }}>
                    {h}
                  </li>
                ))}
              </ul>
            ) : null}
            <div style={{ marginTop: 8, fontSize: 11, color: "#fbbf24", opacity: 0.9 }}>
              Pode confirmar em{" "}
              <a href="/api/help/assistant" target="_blank" rel="noreferrer" style={{ color: "#d4d4d4" }}>
                /api/help/assistant
              </a>{" "}
              — o JSON deve mostrar <code style={{ color: "#fff" }}>&quot;openaiConfigured&quot;: true</code>.
            </div>
          </div>
        ) : null}
      </div>

      <div
        style={{
          flex: 1,
          minHeight: 220,
          overflowY: "auto",
          borderRadius: 10,
          border: "1px solid rgba(63,63,70,0.75)",
          background: "rgba(9,9,11,0.5)",
          padding: "12px 14px",
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        {messages.length === 0 ? (
          <div style={{ color: "#71717a", fontSize: 13, lineHeight: 1.55, padding: "8px 4px" }}>
            Pergunta por exemplo: o que significa «carteira recomendada», como funciona o simulador, ou que passos tem o
            onboarding.
          </div>
        ) : (
          messages.map((m, i) => (
            <div
              key={`${m.role}-${i}`}
              style={{
                alignSelf: m.role === "user" ? "flex-end" : "flex-start",
                maxWidth: "min(100%, 640px)",
                padding: "10px 14px",
                borderRadius: 12,
                fontSize: 13,
                lineHeight: 1.55,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                background: m.role === "user" ? "rgba(15, 118, 110, 0.25)" : "rgba(63,63,70,0.55)",
                border: `1px solid ${m.role === "user" ? "rgba(45,212,191,0.35)" : "rgba(82,82,91,0.9)"}`,
                color: "#e4e4e7",
              }}
            >
              {m.content}
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>

      {error ? (
        <div style={{ fontSize: 12, color: "#fca5a5", lineHeight: 1.45 }}>{error}</div>
      ) : null}

      <div style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          placeholder="Escreva a sua dúvida… (Enter envia, Shift+Enter nova linha)"
          rows={3}
          disabled={busy}
          style={{
            flex: "1 1 240px",
            minWidth: 200,
            resize: "vertical",
            padding: "12px 14px",
            borderRadius: 12,
            border: "1px solid rgba(82,82,91,0.9)",
            background: "rgba(9,9,11,0.85)",
            color: "#e4e4e7",
            fontSize: 14,
            fontFamily: "inherit",
            lineHeight: 1.45,
            boxSizing: "border-box",
          }}
        />
        <button
          type="button"
          onClick={() => void send()}
          disabled={busy || !input.trim()}
          aria-busy={busy}
          style={{
            padding: "12px 20px",
            borderRadius: 12,
            fontWeight: 800,
            fontSize: 14,
            cursor: busy || !input.trim() ? "not-allowed" : "pointer",
            border: "1px solid rgba(45,212,191,0.45)",
            background: busy || !input.trim() ? "rgba(39,39,42,0.8)" : "rgba(20, 184, 166, 0.35)",
            color: "#ecfdf5",
          }}
        >
          {busy ? (
            <>
              A pensar
              <InlineLoadingDots />
            </>
          ) : (
            "Enviar"
          )}
        </button>
      </div>
    </div>
  );
}
