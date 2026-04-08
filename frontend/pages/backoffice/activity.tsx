import type { GetServerSideProps } from "next";
import type { CSSProperties } from "react";
import Head from "next/head";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import BackofficeShell from "../../components/backoffice/BackofficeShell";
import { backofficeGetServerSideProps } from "../../lib/backofficePageProps";

const panel: CSSProperties = {
  background: "rgba(24, 24, 27, 0.92)",
  border: "1px solid rgba(63, 63, 70, 0.75)",
  borderRadius: 16,
  padding: 22,
};

type Ev = { id: string; ts: string; type: string; label: string; detail?: string; clientId?: string };

export default function BackofficeActivityPage() {
  const [events, setEvents] = useState<Ev[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const r = await fetch("/api/backoffice/activity", { credentials: "same-origin" });
      const j = (await r.json()) as { ok?: boolean; events?: Ev[] };
      if (!r.ok || !j.ok) throw new Error("Falha a carregar");
      setEvents(Array.isArray(j.events) ? j.events : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro");
      setEvents([]);
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
        <title>Atividade — Back-office Decide</title>
        <meta name="robots" content="noindex,nofollow" />
      </Head>
      <BackofficeShell
        active="activity"
        title="Atividade"
        subtitle="Eventos agregados por cliente (timeline). Até 500 entradas recentes."
      >
        <div style={panel}>
          {error ? <p style={{ color: "#f87171" }}>{error}</p> : null}
          {loading ? <p style={{ color: "#a1a1aa" }}>A carregar…</p> : null}
          {!loading && events.length === 0 ? (
            <p style={{ color: "#71717a" }}>Sem eventos.</p>
          ) : null}
          <ul style={{ margin: 0, paddingLeft: 0, listStyle: "none" }}>
            {events.map((e) => (
              <li
                key={`${e.clientId || ""}-${e.id}-${e.ts}`}
                style={{
                  borderLeft: "2px solid #3f3f46",
                  paddingLeft: 14,
                  marginBottom: 14,
                  fontSize: 14,
                  color: "#e4e4e7",
                }}
              >
                <div style={{ fontSize: 12, color: "#71717a" }}>
                  {e.ts}
                  {e.clientId ? (
                    <>
                      {" · "}
                      <Link href={`/backoffice/clients/${encodeURIComponent(e.clientId)}`} style={{ color: "#5eead4" }}>
                        {e.clientId}
                      </Link>
                    </>
                  ) : null}
                </div>
                <div style={{ fontWeight: 700 }}>{e.label}</div>
                {e.detail ? <div style={{ color: "#a1a1aa", marginTop: 4 }}>{e.detail}</div> : null}
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            style={{
              marginTop: 16,
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
        </div>
      </BackofficeShell>
    </>
  );
}

export const getServerSideProps = backofficeGetServerSideProps;
