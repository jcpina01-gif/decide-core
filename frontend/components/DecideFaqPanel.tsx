import { useMemo, useState } from "react";
import { type FaqCategoryId, FAQ_ITEMS } from "../lib/decideFaqData";

const CATEGORIES: { id: FaqCategoryId | "all"; label: string; hint: string }[] = [
  { id: "all", label: "Todas", hint: "" },
  { id: "conta", label: "Conta & Execução", hint: "" },
  { id: "carteira", label: "Carteira & Estratégia", hint: "" },
  { id: "risco", label: "Risco & Performance", hint: "" },
  { id: "custos", label: "Custos & Fees", hint: "" },
  { id: "plataforma", label: "Plataforma & modelo", hint: "" },
  { id: "adequacao", label: "Adequação & identificação", hint: "" },
  { id: "geral", label: "Termos financeiros gerais", hint: "" },
];

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function Highlight({ text, query }: { text: string; query: string }) {
  const q = query.trim();
  if (!q) return <>{text}</>;
  try {
    const parts = text.split(new RegExp(`(${escapeRegExp(q)})`, "gi"));
    return (
      <>
        {parts.map((part, i) =>
          part.toLowerCase() === q.toLowerCase() ? (
            <mark
              key={i}
              style={{
                background: "rgba(161, 161, 170, 0.45)",
                color: "var(--text-primary)",
                padding: "0 3px",
                borderRadius: 4,
              }}
            >
              {part}
            </mark>
          ) : (
            <span key={i}>{part}</span>
          )
        )}
      </>
    );
  } catch {
    return <>{text}</>;
  }
}

export default function DecideFaqPanel() {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<FaqCategoryId | "all">("all");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return FAQ_ITEMS.filter((item) => {
      if (category !== "all" && item.categoryId !== category) return false;
      if (!q) return true;
      const hay = `${item.term} ${item.body}`.toLowerCase();
      return hay.includes(q);
    });
  }, [query, category]);

  return (
    <div
      style={{
        background: "linear-gradient(180deg, rgba(12,12,14,0.99) 0%, rgba(9,9,11,0.995) 100%)",
        border: "1px solid rgba(48,48,52,0.92)",
        borderRadius: 18,
        padding: "22px 24px 28px",
        marginBottom: 28,
        boxShadow: "0 0 0 1px rgba(9,9,11,0.95), 0 12px 36px rgba(0,0,0,0.42)",
      }}
    >
      <div style={{ color: "#a1a1aa", fontSize: 13, fontWeight: 800, letterSpacing: "0.06em", marginBottom: 8 }}>
        DECIDE AI · Ajuda
      </div>
      <h2 style={{ margin: "0 0 8px 0", fontSize: 26, color: "var(--text-primary)", fontWeight: 800 }}>
        FAQs — glossário e conceitos
      </h2>
      <p style={{ margin: "0 0 18px 0", fontSize: 14, color: "#a1a1aa", lineHeight: 1.55, maxWidth: 640 }}>
        Pesquisa em tempo real no <strong style={{ color: "#d4d4d8" }}>termo</strong> e na{" "}
        <strong style={{ color: "#d4d4d8" }}>descrição</strong>. Passe o rato sobre cada entrada para ver o resumo no
        tooltip do browser.
      </p>

      <label style={{ display: "block", marginBottom: 10, fontSize: 13, color: "#a1a1aa", fontWeight: 600 }}>
        Procurar termos
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Procurar termos (ex: Sharpe, margem, CAGR…)"
          autoComplete="off"
          style={{
            display: "block",
            width: "100%",
            maxWidth: 480,
            marginTop: 8,
            padding: "12px 14px",
            borderRadius: 12,
            border: "1px solid rgba(63,63,70,0.95)",
            background: "rgba(9,9,11,0.92)",
            color: "#e4e4e7",
            fontSize: 16,
            outline: "none",
            boxSizing: "border-box",
          }}
        />
      </label>

      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: "#71717a", textTransform: "uppercase", marginBottom: 8 }}>
          Categorias
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {CATEGORIES.map((c) => {
            const active = category === c.id;
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => setCategory(c.id)}
                style={{
                  background: active ? "rgba(48,48,52,0.92)" : "rgba(24,24,27,0.88)",
                  border: `1px solid ${active ? "rgba(130,130,138,0.55)" : "rgba(48,48,52,0.95)"}`,
                  color: active ? "var(--text-primary)" : "#a1a1aa",
                  borderRadius: 999,
                  padding: "9px 15px",
                  fontSize: 13,
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                {c.label}
              </button>
            );
          })}
        </div>
      </div>

      <div style={{ fontSize: 13, color: "#71717a", marginBottom: 12 }}>
        {filtered.length === FAQ_ITEMS.length && !query.trim() && category === "all"
          ? `${FAQ_ITEMS.length} entradas`
          : `${filtered.length} resultado(s)`}
      </div>

      <div style={{ display: "grid", gap: 8 }}>
        {filtered.length === 0 ? (
          <div style={{ color: "#a1a1aa", fontSize: 15, padding: "16px 0" }}>Sem resultados. Tente outro termo ou categoria.</div>
        ) : (
          filtered.map((item, idx) => (
            <details
              key={item.id}
              style={{
                border: "1px solid rgba(48,48,52,0.88)",
                borderRadius: 12,
                background: idx % 2 === 0 ? "rgba(18,18,20,0.92)" : "rgba(24,24,27,0.88)",
                overflow: "hidden",
              }}
            >
              <summary
                title={item.body}
                style={{
                  cursor: "pointer",
                  padding: "14px 16px",
                  fontWeight: 700,
                  color: "#e4e4e7",
                  fontSize: 16,
                  listStyle: "none",
                }}
              >
                <Highlight text={item.term} query={query} />
              </summary>
              <div
                style={{
                  padding: "0 16px 16px 16px",
                  fontSize: 15,
                  color: "#a1a1aa",
                  lineHeight: 1.6,
                  borderTop: "1px solid rgba(48,48,52,0.75)",
                }}
              >
                <Highlight text={item.body} query={query} />
              </div>
            </details>
          ))
        )}
      </div>
    </div>
  );
}
