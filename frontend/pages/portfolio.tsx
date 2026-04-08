import React, { useEffect, useState } from "react";
import PortfolioTable from "../components/PortfolioTable";
import { PortfolioPayload, fetchPortfolioData } from "../services/api";

export default function PortfolioPage() {
  const [loading, setLoading] = useState(true);
  const [portfolio, setPortfolio] = useState<PortfolioPayload | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        setLoading(true);
        const p = await fetchPortfolioData();
        if (cancelled) return;
        setPortfolio(p);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#030712",
        padding: "24px 0",
      }}
    >
      <div style={{ width: "min(1400px, calc(100% - 32px))", margin: "0 auto" }}>
        <div style={{ marginBottom: 20 }}>
          <div style={{ color: "#ffffff", fontSize: 30, fontWeight: 800 }}>DECIDE Portfolio</div>
          <div style={{ color: "#a1a1aa", marginTop: 4 }}>
            Carteira atual, concentração, exposição e tabela de posições
          </div>
        </div>

        {loading ? (
          <div
            style={{
              background: "#111827",
              border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: 16,
              padding: 18,
              color: "#e5e7eb",
            }}
          >
            A carregar carteira...
          </div>
        ) : (
          <PortfolioTable portfolio={portfolio} />
        )}
      </div>
    </div>
  );
}