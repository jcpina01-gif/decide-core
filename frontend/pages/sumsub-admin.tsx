import Head from "next/head";
import Link from "next/link";
import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import { DECIDE_APP_FONT_FAMILY, DECIDE_DASHBOARD, DECIDE_ONBOARDING } from "../lib/decideClientTheme";

const API_BASE = "http://127.0.0.1:8101";

type SumsubRecord = {
  external_user_id: string;
  applicant_id?: string;
  name?: string;
  email?: string;
  phone?: string;
  level_name?: string;
  created_at?: string;
  updated_at?: string;
  last_status?: Record<string, any>;
  last_status_at?: string;
};

function cardStyle(): React.CSSProperties {
  return {
    background: "rgba(24, 24, 27, 0.92)",
    border: "1px solid rgba(63, 63, 70, 0.75)",
    borderRadius: 22,
    padding: 20,
    boxShadow: "0 8px 30px rgba(0,0,0,0.18)",
  };
}

function inputStyle(): React.CSSProperties {
  return {
    width: "100%",
    background: "#27272a",
    color: "#fff",
    border: "1px solid rgba(63, 63, 70, 0.85)",
    borderRadius: 12,
    padding: 12,
    fontSize: 16,
    outline: "none",
  };
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
        background: disabled ? DECIDE_ONBOARDING.buttonDisabled : DECIDE_DASHBOARD.buttonRegister,
        color: "#fff",
        border: disabled ? DECIDE_ONBOARDING.inputBorder : DECIDE_ONBOARDING.buttonPrimaryBorder,
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

function Label({ children }: { children: React.ReactNode }) {
  return <div style={{ color: "#a1a1aa", fontSize: 14, marginBottom: 8 }}>{children}</div>;
}

export default function SumsubAdminPage() {
  const router = useRouter();
  useEffect(() => {
    // Redirect legacy Sumsub Admin route to Persona Admin.
    router.replace("/persona-admin");
  }, [router]);

  const [externalUserId, setExternalUserId] = useState("");
  const [records, setRecords] = useState<SumsubRecord[]>([]);
  const [lookupResult, setLookupResult] = useState<Record<string, any> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function loadRecords() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${API_BASE}/api/sumsub/records`);
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setRecords(Array.isArray(json.records) ? json.records : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro a carregar registos");
    } finally {
      setLoading(false);
    }
  }

  async function lookupStatus() {
    if (!externalUserId.trim()) {
      setError("Indique um externalUserId.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const url = `${API_BASE}/api/sumsub/status?external_user_id=${encodeURIComponent(externalUserId.trim())}`;
      const res = await fetch(url);
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setLookupResult(json);
    } catch (e) {
      setLookupResult(null);
      setError(e instanceof Error ? e.message : "Erro a consultar estado");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadRecords();
  }, []);

  const selectedRecord = useMemo(() => {
    const key = externalUserId.trim();
    return records.find((r) => r.external_user_id === key) || null;
  }, [records, externalUserId]);

  return (
    <>
      <Head>
        <title>DECIDE | Sumsub Admin</title>
      </Head>
      <div
        style={{
          minHeight: "100vh",
          background: "#000",
          color: "#fff",
          padding: 32,
          fontFamily: DECIDE_APP_FONT_FAMILY,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", gap: 20, marginBottom: 24, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 40, fontWeight: 800 }}>DECIDE — Sumsub Admin</div>
            <div style={{ color: "#a1a1aa", fontSize: 18 }}>
              Consulta de estado KYC e histórico local de applicants.
            </div>
          </div>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <Link href="/sumsub-onboarding" style={{ color: "#d4d4d4", fontSize: 16 }}>Onboarding Sumsub</Link>
            <a href="http://localhost:5000/" style={{ color: "#d4d4d4", fontSize: 16 }}>Dashboard</a>
            <Link href="/client-montante" style={{ color: "#d4d4d4", fontSize: 16 }}>Onboarding interno</Link>
          </div>
        </div>

        {error ? (
          <div style={{ ...cardStyle(), marginBottom: 16, color: "#fecaca", borderColor: "#7f1d1d" }}>
            {error}
          </div>
        ) : null}

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1.2fr", gap: 20 }}>
          <div style={{ display: "grid", gap: 20 }}>
            <div style={cardStyle()}>
              <div style={{ fontSize: 24, fontWeight: 800, marginBottom: 16 }}>Lookup de estado</div>
              <Label>externalUserId</Label>
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
              <div style={{ fontSize: 24, fontWeight: 800, marginBottom: 16 }}>Estado atual</div>
              <pre style={{ ...inputStyle(), whiteSpace: "pre-wrap", margin: 0, minHeight: 260, overflow: "auto" }}>
{JSON.stringify(lookupResult || selectedRecord || { ok: false, info: "Sem resultado ainda." }, null, 2)}
              </pre>
            </div>
          </div>

          <div style={cardStyle()}>
            <div style={{ fontSize: 24, fontWeight: 800, marginBottom: 8 }}>Applicants recentes</div>
            <div style={{ color: "#a1a1aa", marginBottom: 14 }}>
              Histórico local guardado em `backend/data/sumsub_state.json`.
            </div>

            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
                <thead>
                  <tr style={{ textAlign: "left", borderBottom: "1px solid rgba(63, 63, 70, 0.75)" }}>
                    <th style={{ padding: "12px 10px" }}>externalUserId</th>
                    <th style={{ padding: "12px 10px" }}>Applicant ID</th>
                    <th style={{ padding: "12px 10px" }}>Email</th>
                    <th style={{ padding: "12px 10px" }}>Nível</th>
                    <th style={{ padding: "12px 10px" }}>Atualizado</th>
                  </tr>
                </thead>
                <tbody>
                  {records.map((rec) => (
                    <tr key={rec.external_user_id} style={{ borderBottom: "1px solid #10284f" }}>
                      <td style={{ padding: "12px 10px", fontWeight: 800 }}>{rec.external_user_id}</td>
                      <td style={{ padding: "12px 10px" }}>{rec.applicant_id || "-"}</td>
                      <td style={{ padding: "12px 10px" }}>{rec.email || "-"}</td>
                      <td style={{ padding: "12px 10px" }}>{rec.level_name || "-"}</td>
                      <td style={{ padding: "12px 10px" }}>{rec.updated_at || rec.created_at || "-"}</td>
                    </tr>
                  ))}
                  {!records.length && (
                    <tr>
                      <td colSpan={5} style={{ padding: 18, color: "#a1a1aa" }}>
                        Ainda não há applicants guardados.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

