import React from "react";

type LinkCardProps = {
  href: string;
  title: string;
  description: string;
};

function LinkCard({ href, title, description }: LinkCardProps) {
  return (
    <a
      href={href}
      style={{
        display: "block",
        textDecoration: "none",
        background: "#020b24",
        border: "1px solid #15305b",
        borderRadius: 18,
        padding: 18,
        color: "#fff",
      }}
    >
      <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 8 }}>{title}</div>
      <div style={{ fontSize: 14, color: "#9fb3d1", lineHeight: 1.45 }}>{description}</div>
    </a>
  );
}

export default function DashboardQuickLinks() {
  return (
    <div
      style={{
        background: "#010816",
        border: "1px solid #16315d",
        borderRadius: 22,
        padding: 20,
        marginBottom: 24,
      }}
    >
      <div style={{ fontSize: 22, fontWeight: 800, color: "#fff", marginBottom: 8 }}>
        Navegação rápida
      </div>

      <div style={{ fontSize: 14, color: "#9fb3d1", marginBottom: 16 }}>
        Acesso direto às páginas comerciais e regulamentares, separadas do core do modelo.
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
          gap: 14,
        }}
      >
        <LinkCard
          href="/client-montante"
          title="Valor a investir"
          description="Indique quanto pretende investir — adequação ao seu perfil."
        />
        <LinkCard
          href="/mifid-test"
          title="Perfil de investidor"
          description="Questionário de adequação e conhecimentos."
        />
        <LinkCard
          href="/persona-onboarding"
          title="Identidade"
          description="Identificação e verificação (câmara + documentos)."
        />
        <LinkCard
          href="/client/approve"
          title="Abrir/Enviar para TWS"
          description="Aprova a recomendação e segue o plano para o TWS."
        />
        <LinkCard
          href="/fees-client"
          title="Fees Client"
          description="Impacto das comissões no cliente: curva bruta, líquida e fees acumuladas."
        />
        <LinkCard
          href="/fees-business"
          title="Fees Business"
          description="Economics da gestora: receita por segmento, AUM e cenários."
        />
      </div>
    </div>
  );
}