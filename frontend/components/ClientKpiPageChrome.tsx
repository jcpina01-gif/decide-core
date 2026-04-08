import type { ReactNode } from "react";

type Props = {
  /** Título à esquerda da faixa (alinhado à coluna do sub-menu) — ex.: Dashboard, Carteira */
  title: string;
  /** Perfil, selects, botões — centrados na largura da página (entre título e trailing) */
  toolbar: ReactNode;
  /** Opcional: acções à direita da faixa KPI (o CTA «Depositar Fundos» está no header global). */
  toolbarTrailing?: ReactNode;
  /** `ClientKpiEmbedWorkspace` dentro do full-bleed */
  children: ReactNode;
  /** Usar `<main>` (Carteira) ou `<div>` (Dashboard, dentro de outro layout) */
  as?: "main" | "div";
  /** Opcional: faixa por baixo da grelha (ex.: erro no dashboard), largura total dentro do bleed */
  toolbarFooter?: ReactNode;
};

/**
 * Faixa cinza full-bleed: título à esquerda, toolbar ao centro, trailing à direita; depois workspace em bleed.
 */
export default function ClientKpiPageChrome({
  title,
  toolbar,
  toolbarTrailing,
  children,
  as = "main",
  toolbarFooter,
}: Props) {
  const Tag = as === "main" ? "main" : "div";
  const pageClass = [
    "decide-app-kpi-page",
    toolbarFooter ? "decide-app-kpi-page--toolbar-footer" : "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <Tag className={pageClass}>
      <div className="decide-app-kpi-toolbar-rail-bleed">
        <div className="decide-app-kpi-toolbar-rail-inner">
          <div className="decide-app-kpi-toolbar-rail-title">{title}</div>
          <div className="decide-app-kpi-toolbar-rail-center">{toolbar}</div>
          <div className="decide-app-kpi-toolbar-rail-trailing">{toolbarTrailing}</div>
        </div>
        {toolbarFooter ? <div className="decide-app-kpi-toolbar-rail-footer">{toolbarFooter}</div> : null}
      </div>
      {/* Reserva altura no fluxo: a faixa é position:fixed; sem isto o conteúdo cobria-se. */}
      <div className="decide-app-kpi-toolbar-rail-spacer" aria-hidden />
      <div className="decide-app-kpi-shell-bleed">{children}</div>
    </Tag>
  );
}
