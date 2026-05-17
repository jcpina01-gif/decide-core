import type { GetServerSideProps } from "next";
import type { CSSProperties } from "react";
import Head from "next/head";
import { useCallback, useEffect, useRef, useState } from "react";
import BackofficeShell from "../../components/backoffice/BackofficeShell";
import { DECIDE_DASHBOARD } from "../../lib/decideClientTheme";
import { backofficeGetServerSideProps } from "../../lib/backofficePageProps";

/* ── Types ──────────────────────────────────────────────────────────── */
interface VapiCall {
  id: string;
  createdAt: string;
  startedAt?: string;
  endedAt?: string;
  status: string;
  type?: string;
  endedReason?: string;
  phoneNumber?: { number?: string };
  customer?: { number?: string; name?: string };
  assistant?: { name?: string };
  cost?: number;
  costBreakdown?: Record<string, number>;
  recordingUrl?: string;
  stereoRecordingUrl?: string;
  transcript?: string;
  summary?: string;
  messages?: Array<{ role: string; message?: string; content?: string; time?: number }>;
}

/* ── Styles ─────────────────────────────────────────────────────────── */
const panel: CSSProperties = {
  background: "rgba(24,24,27,0.92)",
  border: "1px solid rgba(63,63,70,0.75)",
  borderRadius: 16,
  padding: 22,
  marginBottom: 16,
};

const chip = (color: string): CSSProperties => ({
  display: "inline-block",
  padding: "2px 10px",
  borderRadius: 6,
  fontSize: 11,
  fontWeight: 700,
  background: color + "22",
  color,
  border: `1px solid ${color}44`,
  whiteSpace: "nowrap",
});

function statusColor(s: string) {
  if (s === "ended") return "#4ade80";
  if (s === "in-progress") return "#facc15";
  if (s === "queued" || s === "ringing") return "#60a5fa";
  return "#71717a";
}

function fmtDur(start?: string, end?: string) {
  if (!start || !end) return "—";
  const s = Math.round((new Date(end).getTime() - new Date(start).getTime()) / 1000);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return m > 0 ? `${m}m ${sec}s` : `${sec}s`;
}

function fmtTs(ts?: string) {
  if (!ts) return "—";
  return new Date(ts).toLocaleString("pt-PT", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

/* ── Component ──────────────────────────────────────────────────────── */
export default function BackofficeCallsPage() {
  const [calls, setCalls] = useState<VapiCall[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<VapiCall | null>(null);
  const [showTranscript, setShowTranscript] = useState(false);
  const [filterPhone, setFilterPhone] = useState("");
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const load = useCallback(async (phone?: string) => {
    setLoading(true);
    setError("");
    try {
      const qs = new URLSearchParams({ limit: "100" });
      if (phone?.trim()) qs.set("phoneNumber", phone.trim());
      const r = await fetch(`/api/backoffice/vapi-calls?${qs}`, { credentials: "same-origin" });
      const j = (await r.json()) as { ok?: boolean; calls?: VapiCall[]; error?: string };
      if (!r.ok || !j.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      const list = Array.isArray(j.calls) ? j.calls : [];
      setCalls(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao carregar chamadas");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const handleSearch = () => void load(filterPhone);

  const totalCost = calls.reduce((s, c) => s + (c.cost ?? 0), 0);
  const ended = calls.filter((c) => c.status === "ended").length;

  return (
    <>
      <Head>
        <title>Chamadas — Back-office Decide</title>
        <meta name="robots" content="noindex,nofollow" />
      </Head>
      <BackofficeShell
        active="calls"
        title="Chamadas"
        subtitle="Histórico de chamadas VAPI — gravações, transcrições e metadata."
      >
        {/* Stats */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12, marginBottom: 16 }}>
          {[
            { label: "Total chamadas", value: calls.length },
            { label: "Concluídas", value: ended },
            { label: "Custo total", value: `$${totalCost.toFixed(4)}` },
          ].map((s) => (
            <div key={s.label} style={{ ...panel, padding: 16, marginBottom: 0, textAlign: "center" }}>
              <div style={{ fontSize: 22, fontWeight: 900, color: DECIDE_DASHBOARD.accentSky }}>{s.value}</div>
              <div style={{ fontSize: 11, color: "#71717a", marginTop: 4 }}>{s.label}</div>
            </div>
          ))}
        </div>

        {/* Filter */}
        <div style={{ ...panel, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <input
            value={filterPhone}
            onChange={(e) => setFilterPhone(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            placeholder="Filtrar por número (ex. +351910000000)"
            style={{
              flex: 1, minWidth: 240, padding: "10px 14px", borderRadius: 10,
              border: "1px solid #3f3f46", background: "#0a0a0a", color: "#fff", fontSize: 14,
            }}
          />
          <button
            onClick={handleSearch}
            style={{
              padding: "10px 18px", borderRadius: 10, fontSize: 13, fontWeight: 700,
              cursor: "pointer", border: `1px solid ${DECIDE_DASHBOARD.accentSky}`,
              background: "rgba(45,212,191,0.12)", color: "#fff",
            }}
          >
            Pesquisar
          </button>
          <button
            onClick={() => { setFilterPhone(""); void load(); }}
            style={{
              padding: "10px 14px", borderRadius: 10, fontSize: 13, fontWeight: 600,
              cursor: "pointer", border: "1px solid #3f3f46", background: "#27272a", color: "#a1a1aa",
            }}
          >
            Limpar
          </button>
        </div>

        {/* Error */}
        {error && (
          <div style={{ ...panel, borderColor: "#7f1d1d", background: "#450a0a", color: "#fca5a5", fontSize: 13 }}>
            {error}
          </div>
        )}

        {/* Call list */}
        <div style={panel}>
          {loading ? (
            <div style={{ color: "#52525b", textAlign: "center", padding: "32px 0" }}>A carregar chamadas…</div>
          ) : calls.length === 0 ? (
            <div style={{ color: "#52525b", textAlign: "center", padding: "32px 0" }}>Sem chamadas registadas.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
              {calls.map((c) => {
                const phone = c.customer?.number ?? c.phoneNumber?.number ?? "—";
                const dur = fmtDur(c.startedAt, c.endedAt);
                const isSelected = selected?.id === c.id;
                return (
                  <div
                    key={c.id}
                    onClick={() => { setSelected(isSelected ? null : c); setShowTranscript(false); }}
                    style={{
                      padding: "14px 16px",
                      borderRadius: 10,
                      cursor: "pointer",
                      background: isSelected ? "rgba(45,212,191,0.07)" : "rgba(255,255,255,0.02)",
                      border: isSelected
                        ? `1px solid ${DECIDE_DASHBOARD.accentSky}55`
                        : "1px solid rgba(63,63,70,0.4)",
                      marginBottom: 4,
                      transition: "background 0.15s",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                        <span style={chip(statusColor(c.status))}>{c.status}</span>
                        <span style={{ fontSize: 14, fontWeight: 700, color: "#e4e4e7" }}>{phone}</span>
                        {c.customer?.name && (
                          <span style={{ fontSize: 12, color: "#a1a1aa" }}>{c.customer.name}</span>
                        )}
                        {c.assistant?.name && (
                          <span style={{ fontSize: 11, color: "#52525b" }}>Assistente: {c.assistant.name}</span>
                        )}
                      </div>
                      <div style={{ display: "flex", gap: 16, alignItems: "center", flexShrink: 0 }}>
                        <span style={{ fontSize: 12, color: "#71717a" }}>{dur}</span>
                        <span style={{ fontSize: 12, color: "#52525b" }}>{fmtTs(c.startedAt ?? c.createdAt)}</span>
                        {c.cost != null && (
                          <span style={{ fontSize: 11, color: "#3f3f46" }}>${c.cost.toFixed(4)}</span>
                        )}
                      </div>
                    </div>

                    {/* Expanded detail */}
                    {isSelected && (
                      <div
                        style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid rgba(63,63,70,0.4)" }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        {/* Summary */}
                        {c.summary && (
                          <div style={{ marginBottom: 14 }}>
                            <div style={{ fontSize: 11, color: "#71717a", fontWeight: 700, marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                              Resumo
                            </div>
                            <p style={{ fontSize: 13, color: "#d4d4d8", lineHeight: 1.6, margin: 0 }}>{c.summary}</p>
                          </div>
                        )}

                        {/* End reason */}
                        {c.endedReason && (
                          <div style={{ marginBottom: 14, fontSize: 12, color: "#71717a" }}>
                            Motivo de encerramento: <span style={{ color: "#a1a1aa" }}>{c.endedReason}</span>
                          </div>
                        )}

                        {/* Audio player */}
                        {(c.recordingUrl ?? c.stereoRecordingUrl) && (
                          <div style={{ marginBottom: 14 }}>
                            <div style={{ fontSize: 11, color: "#71717a", fontWeight: 700, marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                              Gravação
                            </div>
                            <audio
                              ref={audioRef}
                              controls
                              src={c.stereoRecordingUrl ?? c.recordingUrl}
                              style={{ width: "100%", borderRadius: 8, accentColor: DECIDE_DASHBOARD.accentSky }}
                            />
                          </div>
                        )}

                        {/* Transcript toggle */}
                        {c.transcript && (
                          <div style={{ marginBottom: 8 }}>
                            <button
                              onClick={() => setShowTranscript((v) => !v)}
                              style={{
                                padding: "7px 14px", borderRadius: 8, fontSize: 12, fontWeight: 600,
                                cursor: "pointer", border: "1px solid #3f3f46",
                                background: "#27272a", color: "#a1a1aa", marginBottom: 10,
                              }}
                            >
                              {showTranscript ? "Ocultar transcrição" : "Ver transcrição completa"}
                            </button>
                            {showTranscript && (
                              <div
                                style={{
                                  maxHeight: 320, overflowY: "auto", padding: 14,
                                  background: "#0a0a0a", borderRadius: 10, border: "1px solid #27272a",
                                  fontSize: 12, color: "#a1a1aa", lineHeight: 1.7, whiteSpace: "pre-wrap",
                                }}
                              >
                                {c.transcript}
                              </div>
                            )}
                          </div>
                        )}

                        {/* Messages */}
                        {!c.transcript && c.messages && c.messages.length > 0 && (
                          <div>
                            <div style={{ fontSize: 11, color: "#71717a", fontWeight: 700, marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                              Mensagens ({c.messages.length})
                            </div>
                            <div style={{ maxHeight: 300, overflowY: "auto", display: "flex", flexDirection: "column", gap: 6 }}>
                              {c.messages.map((m, i) => (
                                <div
                                  key={i}
                                  style={{
                                    padding: "8px 12px", borderRadius: 8, fontSize: 12,
                                    background: m.role === "bot" || m.role === "assistant"
                                      ? "rgba(45,212,191,0.06)"
                                      : "rgba(255,255,255,0.03)",
                                    border: "1px solid rgba(63,63,70,0.3)",
                                  }}
                                >
                                  <span style={{ fontSize: 10, color: "#52525b", fontWeight: 700, textTransform: "uppercase", marginRight: 8 }}>
                                    {m.role}
                                  </span>
                                  <span style={{ color: "#d4d4d8" }}>
                                    {m.message ?? m.content ?? ""}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* ID */}
                        <div style={{ marginTop: 12, fontSize: 10, color: "#27272a", fontFamily: "monospace" }}>
                          ID: {c.id}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </BackofficeShell>
    </>
  );
}

export const getServerSideProps: GetServerSideProps = backofficeGetServerSideProps;
