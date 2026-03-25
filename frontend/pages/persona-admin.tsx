import Head from "next/head";
import Link from "next/link";
import React, { useEffect, useMemo, useState } from "react";

const API_BASE = "http://127.0.0.1:8101";

type PersonaRecord = {
  reference_id: string;
  external_user_id?: string;
  name?: string;
  email?: string;
  phone?: string;
  inquiry_id?: string;
  status?: string;
  updated_at?: string;
  created_at?: string;
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

export default function PersonaAdminPage() {
  const [externalUserId, setExternalUserId] = useState("");
  const [records, setRecords] = useState<PersonaRecord[]>([]);
  const [lookupResult, setLookupResult] = useState<{ ok: boolean; record?: PersonaRecord } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function loadRecords() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${API_BASE}/api/persona/records`);
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setRecords(Array.isArray(json.records) ? json.records : []);
    } catch (e: any) {
      setError(e?.message || "Erro a carregar registos");
    } finally {
      setLoading(false);
    }
  }

  async function lookupStatus() {
    if (!externalUserId.trim()) {
      setError("Indica um reference_id (ou externalUserId usado como referenceId).");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const url = `${API_BASE}/api/persona/status?reference_id=${encodeURIComponent(externalUserId.trim())}`;
      const res = await fetch(url);
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setLookupResult(json);
    } catch (e: any) {
      setLookupResult(null);
      setError(e?.message || "Erro a consultar estado");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadRecords();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectedRecord = useMemo(() => {
    const key = externalUserId.trim();
    if (!key) return null;
    return records.find((r) => r.reference_id === key) || null;
  }, [records, externalUserId]);

  return (
    <>
      <Head>
        <title>DECIDE | Persona Admin</title>
      </Head>
      <div
        style={{
          minHeight: "100vh",
          background: "#000",
          color: "#fff",
          padding: 32,
          fontFamily: "Inter, Arial, sans-serif",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", gap: 20, marginBottom: 24, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 40, fontWeight: 800 }}>DECIDE — Persona Admin</div>
            <div style={{ color: "#9fb3d1", fontSize: 18 }}>Consulta de estado e histórico local</div>
          </div>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <Link href="/persona-onboarding" style={{ color: "#93c5fd", fontSize: 16 }}>Onboarding Persona</Link>
            <a href="http://localhost:5000/" style={{ color: "#93c5fd", fontSize: 16 }}>Dashboard</a>
            <Link href="/client-montante" style={{ color: "#93c5fd", fontSize: 16 }}>Onboarding interno</Link>
          </div>
        </div>

        {error ? (
          <div style={{ ...cardStyle(), marginBottom: 16, color: "#fecaca", borderColor: "#7f1d1d" }}>{error}</div>
        ) : null}

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1.2fr", gap: 20 }}>
          <div style={{ display: "grid", gap: 20 }}>
            <div style={cardStyle()}>
              <div style={{ fontSize: 24, fontWeight: 800, marginBottom: 16 }}>Lookup de status</div>
              <Label>reference_id</Label>
              <input
                value={externalUserId}
                onChange={(e) => setExternalUserId(e.target.value)}
                style={inputStyle()}
                placeholder="cliente-001"
              />
              <div style={{ display: "flex", gap: 12, marginTop: 18, flexWrap: "wrap" }}>
                <Button onClick={lookupStatus} disabled={loading}>Consultar estado</Button>
                <Button onClick={loadRecords} disabled={loading}>Recarregar registos</Button>
              </div>
            </div>

            <div style={cardStyle()}>
              <div style={{ fontSize: 24, fontWeight: 800, marginBottom: 8 }}>Estado atual</div>
              <pre style={{ ...inputStyle(), whiteSpace: "pre-wrap", margin: 0, minHeight: 260, overflow: "auto" }}>
                {JSON.stringify(lookupResult || selectedRecord || { ok: false, info: "Sem resultado." }, null, 2)}
              </pre>
            </div>
          </div>

          <div style={cardStyle()}>
            <div style={{ fontSize: 24, fontWeight: 800, marginBottom: 8 }}>Applicants recentes</div>
            <div style={{ color: "#9fb3d1", marginBottom: 14, marginTop: 2 }}>
              Histórico local em `backend/data/persona_state.json`.
            </div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
                <thead>
                  <tr style={{ textAlign: "left", borderBottom: "1px solid #15305b" }}>
                    <th style={{ padding: "12px 10px" }}>reference_id</th>
                    <th style={{ padding: "12px 10px" }}>inquiryId</th>
                    <th style={{ padding: "12px 10px" }}>status</th>
                    <th style={{ padding: "12px 10px" }}>email</th>
                    <th style={{ padding: "12px 10px" }}>updated</th>
                  </tr>
                </thead>
                <tbody>
                  {records.map((rec) => (
                    <tr key={rec.reference_id} style={{ borderBottom: "1px solid #10284f" }}>
                      <td style={{ padding: "12px 10px", fontWeight: 800 }}>{rec.reference_id}</td>
                      <td style={{ padding: "12px 10px" }}>{rec.inquiry_id || "-"}</td>
                      <td style={{ padding: "12px 10px" }}>{rec.status || "-"}</td>
                      <td style={{ padding: "12px 10px" }}>{rec.email || "-"}</td>
                      <td style={{ padding: "12px 10px" }}>{rec.updated_at || rec.created_at || "-"}</td>
                    </tr>
                  ))}
                  {!records.length ? (
                    <tr>
                      <td colSpan={5} style={{ padding: 18, color: "#9fb3d1" }}>
                        Ainda não há records guardados.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

