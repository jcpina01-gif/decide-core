import Head from "next/head";
import React, { useEffect, useState } from "react";
import { DECIDE_APP_FONT_FAMILY } from "../lib/decideClientTheme";
import type { SumsubRecordRow } from "../lib/server/sumsubRecordsStore";

function cardStyle(): React.CSSProperties {
  return {
    background: "rgba(24, 24, 27, 0.92)",
    border: "1px solid rgba(63, 63, 70, 0.75)",
    borderRadius: 22,
    padding: 20,
    boxShadow: "0 8px 30px rgba(0,0,0,0.18)",
  };
}

function statusBadge(status: string | null | undefined, reviewAnswer: string | null | undefined) {
  const ans = String(reviewAnswer || "").toUpperCase();
  const st = String(status || "").toLowerCase();
  if (ans === "GREEN") return { label: "Aprovado", color: "#34d399", bg: "rgba(16,185,129,0.12)" };
  if (ans === "RED") return { label: "Rejeitado", color: "#f87171", bg: "rgba(239,68,68,0.12)" };
  if (st === "completed") return { label: "Concluído", color: "#a78bfa", bg: "rgba(139,92,246,0.12)" };
  if (["pending", "prechecked", "queued"].includes(st)) return { label: "Em revisão", color: "#fbbf24", bg: "rgba(234,179,8,0.12)" };
  if (st === "onhold") return { label: "Em espera", color: "#fb923c", bg: "rgba(249,115,22,0.12)" };
  return { label: st || "—", color: "#a1a1aa", bg: "rgba(63,63,70,0.18)" };
}

function fmtDate(v: string | null | undefined): string {
  if (!v) return "—";
  try {
    return new Intl.DateTimeFormat("pt-PT", { dateStyle: "short", timeStyle: "short" }).format(new Date(v));
  } catch {
    return v;
  }
}

export default function SumsubAdminPage() {
  const [records, setRecords] = useState<SumsubRecordRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [lookupId, setLookupId] = useState("");
  const [lookupResult, setLookupResult] = useState<SumsubRecordRow | null>(null);
  const [lookupError, setLookupError] = useState("");
  const [lookupLoading, setLookupLoading] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const r = await fetch("/api/sumsub/records");
        const j = await r.json() as { ok?: boolean; records?: SumsubRecordRow[]; error?: string };
        if (!r.ok || !j.ok) throw new Error(j.error || `HTTP ${r.status}`);
        setRecords(j.records || []);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function lookup() {
    if (!lookupId.trim()) return;
    setLookupLoading(true);
    setLookupError("");
    setLookupResult(null);
    try {
      const r = await fetch(`/api/sumsub/status?external_user_id=${encodeURIComponent(lookupId.trim())}`);
      const j = await r.json() as { ok?: boolean; record?: SumsubRecordRow; error?: string };
      if (!r.ok || !j.ok) throw new Error(j.error || `HTTP ${r.status}`);
      setLookupResult(j.record || null);
    } catch (e) {
      setLookupError(e instanceof Error ? e.message : String(e));
    } finally {
      setLookupLoading(false);
    }
  }

  return (
    <>
      <Head>
        <title>DECIDE Admin | Sumsub KYC</title>
      </Head>
      <div
        style={{
          minHeight: "100vh",
          background: "#000",
          color: "#fff",
          padding: "32px 24px 80px",
          fontFamily: DECIDE_APP_FONT_FAMILY,
        }}
      >
        <div style={{ maxWidth: 1100, margin: "0 auto" }}>
          <div style={{ marginBottom: 32 }}>
            <div style={{ fontSize: 32, fontWeight: 800 }}>DECIDE — Sumsub Admin</div>
            <div style={{ color: "#a1a1aa", fontSize: 16, marginTop: 4 }}>
              Registos KYC guardados localmente após verificação Sumsub.
            </div>
          </div>

          {/* Lookup */}
          <div style={{ ...cardStyle(), marginBottom: 24 }}>
            <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 14 }}>Consultar por external_user_id</div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <input
                value={lookupId}
                onChange={(e) => setLookupId(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") void lookup(); }}
                placeholder="ex.: joao-silva ou sumsub-joao@email.com"
                style={{
                  flex: 1,
                  minWidth: 220,
                  background: "#18181b",
                  color: "#fff",
                  border: "1px solid rgba(63,63,70,0.8)",
                  borderRadius: 10,
                  padding: "10px 14px",
                  fontSize: 14,
                  outline: "none",
                }}
              />
              <button
                onClick={() => void lookup()}
                disabled={lookupLoading || !lookupId.trim()}
                style={{
                  background: "#1d4ed8",
                  border: "none",
                  borderRadius: 10,
                  color: "#fff",
                  fontWeight: 700,
                  fontSize: 14,
                  padding: "10px 20px",
                  cursor: lookupLoading || !lookupId.trim() ? "not-allowed" : "pointer",
                  opacity: lookupLoading || !lookupId.trim() ? 0.6 : 1,
                }}
              >
                {lookupLoading ? "A consultar…" : "Consultar"}
              </button>
            </div>
            {lookupError && <div style={{ color: "#fca5a5", marginTop: 10, fontSize: 13 }}>{lookupError}</div>}
            {lookupResult && (
              <pre
                style={{
                  marginTop: 14,
                  background: "#0a0a0a",
                  border: "1px solid rgba(63,63,70,0.6)",
                  borderRadius: 10,
                  padding: 14,
                  fontSize: 12,
                  color: "#d4d4d8",
                  overflow: "auto",
                  maxHeight: 260,
                }}
              >
                {JSON.stringify(lookupResult, null, 2)}
              </pre>
            )}
          </div>

          {/* Records table */}
          <div style={cardStyle()}>
            <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 14 }}>
              Todos os registos ({loading ? "…" : records.length})
            </div>
            {error && <div style={{ color: "#fca5a5", marginBottom: 12 }}>{error}</div>}
            {loading && <div style={{ color: "#a1a1aa", fontSize: 14 }}>A carregar…</div>}
            {!loading && records.length === 0 && !error && (
              <div style={{ color: "#a1a1aa", fontSize: 14 }}>Sem registos ainda.</div>
            )}
            {!loading && records.length > 0 && (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead>
                    <tr style={{ color: "#71717a", textAlign: "left" }}>
                      {["external_user_id", "applicant_id", "Nome", "Email", "Estado", "Resposta", "Atualizado"].map((h) => (
                        <th key={h} style={{ padding: "6px 10px", borderBottom: "1px solid rgba(63,63,70,0.5)", whiteSpace: "nowrap" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {records.map((r) => {
                      const badge = statusBadge(r.status, r.review_answer);
                      return (
                        <tr key={r.external_user_id} style={{ borderBottom: "1px solid rgba(63,63,70,0.25)" }}>
                          <td style={{ padding: "8px 10px", color: "#e4e4e7", fontFamily: "monospace", fontSize: 12 }}>{r.external_user_id}</td>
                          <td style={{ padding: "8px 10px", color: "#71717a", fontFamily: "monospace", fontSize: 11 }}>{r.applicant_id || "—"}</td>
                          <td style={{ padding: "8px 10px" }}>{r.name || "—"}</td>
                          <td style={{ padding: "8px 10px", color: "#71717a" }}>{r.email || "—"}</td>
                          <td style={{ padding: "8px 10px" }}>
                            <span style={{ background: badge.bg, color: badge.color, borderRadius: 6, padding: "2px 8px", fontSize: 12, fontWeight: 600 }}>
                              {badge.label}
                            </span>
                          </td>
                          <td style={{ padding: "8px 10px", color: r.review_answer === "GREEN" ? "#34d399" : r.review_answer === "RED" ? "#f87171" : "#71717a" }}>
                            {r.review_answer || "—"}
                          </td>
                          <td style={{ padding: "8px 10px", color: "#71717a", whiteSpace: "nowrap" }}>{fmtDate(r.updated_at)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
