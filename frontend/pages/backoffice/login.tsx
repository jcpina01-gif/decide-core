import Head from "next/head";
import { useRouter } from "next/router";
import { useState } from "react";
import { DecideBrandImage } from "../../components/DecideLogoHeader";

export default function BackofficeLoginPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const r = await fetch("/api/backoffice/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
        credentials: "same-origin",
      });
      const j = (await r.json()) as { ok?: boolean; error?: string };
      if (r.ok && j.ok) {
        const next = typeof router.query.next === "string" ? router.query.next : "/backoffice";
        await router.replace(next);
      } else {
        setError("Password incorrecta.");
      }
    } catch {
      setError("Erro de rede.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <Head>
        <title>Acesso — Back-office Decide</title>
        <meta name="robots" content="noindex,nofollow" />
      </Head>
      <div
        style={{
          minHeight: "100vh",
          background: "#080c14",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "'Nunito', system-ui, sans-serif",
        }}
      >
        <div
          style={{
            background: "rgba(15, 23, 42, 0.9)",
            border: "1px solid rgba(255,255,255,0.07)",
            borderRadius: 20,
            padding: "36px 40px",
            width: "100%",
            maxWidth: 380,
          }}
        >
          <div style={{ marginBottom: 20, display: "flex", justifyContent: "center" }}>
            <DecideBrandImage height={52} maxWidth="220px" sizes="220px" knockoutBackground={false} className="decide-logo-img--plain" />
          </div>
          <div style={{ fontSize: 11, color: "#475569", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 4, textAlign: "center" }}>
            Área interna
          </div>
          <div style={{ fontSize: 20, fontWeight: 800, color: "#f1f5f9", marginBottom: 24, textAlign: "center" }}>
            Back-office
          </div>

          <form onSubmit={(e) => void handleSubmit(e)}>
            <label style={{ display: "block", fontSize: 12, color: "#a1a1aa", marginBottom: 6 }}>
              Password de acesso
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoFocus
              style={{
                width: "100%",
                padding: "10px 12px",
                borderRadius: 10,
                border: "1px solid rgba(255,255,255,0.1)",
                background: "rgba(255,255,255,0.04)",
                color: "#f1f5f9",
                fontSize: 15,
                outline: "none",
                boxSizing: "border-box",
              }}
              placeholder="••••••••"
            />

            {error ? (
              <p style={{ color: "#f87171", fontSize: 13, marginTop: 10, marginBottom: 0 }}>{error}</p>
            ) : null}

            <button
              type="submit"
              disabled={loading || !password}
              style={{
                marginTop: 18,
                width: "100%",
                padding: "11px 0",
                borderRadius: 10,
                border: "none",
                background: loading || !password ? "rgba(255,255,255,0.06)" : "rgba(45,212,191,0.85)",
                color: loading || !password ? "#475569" : "#030712",
                fontSize: 15,
                fontWeight: 800,
                cursor: loading || !password ? "not-allowed" : "pointer",
                transition: "background 0.15s",
                fontFamily: "inherit",
              }}
            >
              {loading ? "A entrar…" : "Entrar"}
            </button>
          </form>
        </div>
      </div>
    </>
  );
}
