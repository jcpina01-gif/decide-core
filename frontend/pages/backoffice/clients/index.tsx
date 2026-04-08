import type { GetServerSideProps } from "next";
import type { CSSProperties } from "react";
import Head from "next/head";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import BackofficeShell from "../../../components/backoffice/BackofficeShell";
import { backofficeGetServerSideProps } from "../../../lib/backofficePageProps";
import type { BackofficeClientSummary } from "../../../lib/server/backofficeData";

const th: CSSProperties = {
  textAlign: "left",
  padding: "10px 12px",
  fontSize: 11,
  fontWeight: 800,
  color: "#a1a1aa",
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  borderBottom: "1px solid #3f3f46",
};

const td: CSSProperties = {
  padding: "12px",
  fontSize: 14,
  color: "#d4d4d8",
  borderBottom: "1px solid #27272a",
};

function fmtMoney(n: number | null, ccy: string): string {
  if (n == null || !Number.isFinite(n)) return "—";
  try {
    return new Intl.NumberFormat("pt-PT", { style: "currency", currency: ccy || "EUR" }).format(n);
  } catch {
    return `${n.toFixed(0)} ${ccy}`;
  }
}

function fmtIso(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Intl.DateTimeFormat("pt-PT", { dateStyle: "short", timeStyle: "short" }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function statusPt(s: string): string {
  switch (s) {
    case "complete":
      return "Completo";
    case "pending":
      return "Pendente";
    default:
      return "—";
  }
}

export default function BackofficeClientsPage() {
  const [clients, setClients] = useState<BackofficeClientSummary[]>([]);
  const [meta, setMeta] = useState<{ tmpDiag?: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const r = await fetch("/api/backoffice/clients", { credentials: "same-origin" });
      const j = (await r.json()) as { ok?: boolean; clients?: BackofficeClientSummary[]; meta?: { tmpDiag: string } };
      if (!r.ok || !j.ok) throw new Error((j as { error?: string }).error || `HTTP ${r.status}`);
      setClients(Array.isArray(j.clients) ? j.clients : []);
      setMeta(j.meta ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro a carregar");
      setClients([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <>
      <Head>
        <title>Clientes — Back-office Decide</title>
        <meta name="robots" content="noindex,nofollow" />
      </Head>
      <BackofficeShell
        active="clients"
        title="Clientes"
        subtitle="Fonte: tmp_diag/ibkr_paper_smoke_test.json, decide_trade_plan_ibkr.csv e opcionalmente tmp_diag/backoffice_store.json."
      >
        {error ? (
          <p style={{ color: "#f87171", marginBottom: 16 }}>{error}</p>
        ) : null}
        {loading ? <p style={{ color: "#a1a1aa" }}>A carregar…</p> : null}
        {!loading && meta?.tmpDiag ? (
          <p style={{ fontSize: 12, color: "#52525b", marginBottom: 12 }}>
            tmp_diag: <code style={{ color: "#71717a" }}>{meta.tmpDiag}</code>
          </p>
        ) : null}

        <div
          style={{
            background: "rgba(24, 24, 27, 0.92)",
            border: "1px solid rgba(63, 63, 70, 0.75)",
            borderRadius: 16,
            overflow: "auto",
            marginBottom: 16,
          }}
        >
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 900 }}>
            <thead>
              <tr>
                <th style={th}>Cliente</th>
                <th style={th}>Onboarding</th>
                <th style={th}>MiFID</th>
                <th style={th}>Estado</th>
                <th style={th}>Perfil</th>
                <th style={th}>NAV (IB)</th>
                <th style={th}>Última recomendação</th>
              </tr>
            </thead>
            <tbody>
              {clients.length === 0 && !loading ? (
                <tr>
                  <td colSpan={7} style={{ ...td, textAlign: "center", color: "#71717a", padding: "28px 16px" }}>
                    Nenhum cliente derivado de ficheiros locais.{" "}
                    <Link href="/backoffice/clients/demo-user" style={{ color: "#2dd4bf" }}>
                      Ver ficha demo
                    </Link>
                  </td>
                </tr>
              ) : null}
              {clients.map((c) => (
                <tr key={c.clientId}>
                  <td style={td}>
                    <Link
                      href={`/backoffice/clients/${encodeURIComponent(c.clientId)}`}
                      style={{ color: "#5eead4", fontWeight: 700, textDecoration: "none" }}
                    >
                      {c.displayName}
                    </Link>
                    <div style={{ fontSize: 11, color: "#71717a", marginTop: 4 }}>{c.clientId}</div>
                  </td>
                  <td style={td}>{statusPt(c.onboardingStatus)}</td>
                  <td style={td}>{statusPt(c.mifidStatus)}</td>
                  <td style={td}>{c.accountStatus === "active" ? "Activo" : c.accountStatus}</td>
                  <td style={td}>{c.riskProfile ?? "—"}</td>
                  <td style={td}>{fmtMoney(c.navIbkr, c.navCurrency)}</td>
                  <td style={td}>{fmtIso(c.lastRecommendationAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          style={{
            padding: "10px 16px",
            borderRadius: 10,
            border: "1px solid #3f3f46",
            background: "#27272a",
            color: "#fff",
            fontWeight: 700,
            cursor: loading ? "wait" : "pointer",
          }}
        >
          Atualizar
        </button>
      </BackofficeShell>
    </>
  );
}

export const getServerSideProps = backofficeGetServerSideProps;
