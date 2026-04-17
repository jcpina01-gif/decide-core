/**
 * PDF «Recomendação mensal» gerado no browser (Plano → Documentos).
 * Dependências: jspdf, jspdf-autotable (carregadas por import dinâmico).
 */

import type { jsPDF } from "jspdf";

export type MonthlyRecPdfTrade = {
  ticker: string;
  side: string;
  absQty: number;
  nameShort: string;
  targetWeightPct: number;
};

export type MonthlyRecPdfPosition = {
  ticker: string;
  nameShort: string;
  weightPct: number;
  sector: string;
  industry: string;
  region: string;
  country?: string;
  geoZone?: string;
  excluded: boolean;
};

export type MonthlyRecommendationPdfInput = {
  /** URL absoluta do PNG em /public (ex.: origin + /images/...). */
  logoUrl?: string;
  generatedAtIso: string;
  accountCode: string;
  profile: string;
  modelDisplayName: string;
  closeAsOfDate: string;
  navFormatted: string;
  proposedTradesCoverageNote: string;
  planSummary: {
    buyCount: number;
    sellCount: number;
    turnoverPct: number;
    positionCount: number;
  };
  proposedTrades: MonthlyRecPdfTrade[];
  recommendedPositions: MonthlyRecPdfPosition[];
  /** Pesos-alvo: sleeve caixa/T-Bills vs resto (acções, etc.), como no histórico do dashboard. */
  liquidezPct?: number;
  acoesPct?: number;
};

/** Barra sob o logótipo (slate-900) — contraste para traços claros do PNG. */
const LOGO_BAR_FILL: [number, number, number] = [15, 23, 42];

function displayTickerLabel(ticker: string): string {
  const t = ticker.trim().toUpperCase();
  const c = t.replace(/\s+/g, "");
  if (c === "BRKB" || c === "BRK-B" || c === "BRK.B" || t === "BRK B") return "BRK.B";
  return ticker.trim();
}

function sideLabelPt(side: string): string {
  const u = side.toUpperCase();
  if (u === "BUY") return "Compra";
  if (u === "SELL") return "Venda";
  if (u === "INACTIVE") return "Inactivo";
  return side;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunk = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

type DocWithTable = jsPDF & { lastAutoTable?: { finalY: number } };

function justifyEntrada(input: MonthlyRecommendationPdfInput): string {
  return `Entrada para aproximar a carteira do peso-alvo do ${input.modelDisplayName} (perfil ${input.profile}), após selecção e tectos por título (ex.: CAP15), em linha com o rebalanceamento quantitativo do modelo.`;
}

function justifySaida(): string {
  return `Saída para reduzir ou eliminar exposição a títulos em desalinhamento com a carteira recomendada, libertando capital para novas alocações e controlo de risco agregado.`;
}

function justifyEurUsd(side: string): string {
  return `Operação de cobertura cambial (${sideLabelPt(side)}) alinhada ao plano quando há exposição em USD e caixa em EUR, conforme parâmetros do modelo e da conta.`;
}

function justifyInactivo(): string {
  return `Título excluído pelo cliente nas preferências do plano; não gera ordem activa neste envio.`;
}

export async function downloadMonthlyRecommendationPdf(
  input: MonthlyRecommendationPdfInput,
): Promise<void> {
  const [{ default: jsPDF }, autoTableMod] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
  ]);
  const autoTable = autoTableMod.default;

  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const pageH = doc.internal.pageSize.getHeight();
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 14;
  /** Barra do cabeçalho de ponta a ponta (largura total da página). */
  const yHeaderTop = 0;
  let y = margin;

  const addFooters = () => {
    const total = doc.getNumberOfPages();
    for (let i = 1; i <= total; i += 1) {
      doc.setPage(i);
      doc.setFontSize(7);
      doc.setTextColor(110);
      doc.setFont("helvetica", "normal");
      doc.text(`DECIDE - documento informativo - ${i}/${total}`, margin, pageH - 8);
    }
  };

  /** Inset mínimo à esquerda (barra vai de ponta a ponta; logo encostado ao canto). */
  const logoInsetLeft = 4;
  const imgW = 68;
  const imgH = (imgW * 28) / 50;
  const barPad = 3;
  const barH = Math.max(imgH + barPad * 2, 11);

  const drawHeaderBarFullWidth = () => {
    doc.setFillColor(...LOGO_BAR_FILL);
    doc.rect(0, yHeaderTop, pageW, barH, "F");
  };

  if (input.logoUrl) {
    try {
      const res = await fetch(input.logoUrl);
      if (res.ok) {
        const buf = await res.arrayBuffer();
        const b64 = arrayBufferToBase64(buf);
        drawHeaderBarFullWidth();
        const imgY = yHeaderTop + (barH - imgH) / 2;
        doc.addImage(
          `data:image/png;base64,${b64}`,
          "PNG",
          logoInsetLeft,
          imgY,
          imgW,
          imgH,
        );
        y = yHeaderTop + barH + 6;
      } else {
        throw new Error("logo http");
      }
    } catch {
      drawHeaderBarFullWidth();
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(12);
      doc.setFont("helvetica", "bold");
      doc.text("DECIDE", logoInsetLeft, yHeaderTop + barH * 0.62);
      doc.setTextColor(0, 0, 0);
      y = yHeaderTop + barH + 6;
    }
  } else {
    drawHeaderBarFullWidth();
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(12);
    doc.setFont("helvetica", "bold");
    doc.text("DECIDE", logoInsetLeft, yHeaderTop + barH * 0.62);
    doc.setTextColor(0, 0, 0);
    y = yHeaderTop + barH + 6;
  }

  doc.setTextColor(0, 0, 0);
  doc.setFontSize(16);
  doc.setFont("helvetica", "bold");
  doc.text("Recomendação mensal", margin, y);
  y += 7;
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  const gen = input.generatedAtIso.slice(0, 19).replace("T", " ");
  const L = input.liquidezPct;
  const A = input.acoesPct;
  const sleeveSuffix =
    L != null &&
    A != null &&
    Number.isFinite(L) &&
    Number.isFinite(A)
      ? ` — Liquidez ${L.toFixed(1)}% · Acções ${A.toFixed(1)}%`
      : "";
  const emitidoLine = `Emitido: ${gen} UTC${sleeveSuffix}`;
  const emitidoLines = doc.splitTextToSize(emitidoLine, pageW - 2 * margin);
  doc.text(emitidoLines, margin, y);
  y += emitidoLines.length * 4;
  doc.text(
    `Conta: ${input.accountCode || "—"} · Perfil: ${input.profile} · Modelo: ${input.modelDisplayName}`,
    margin,
    y,
  );
  y += 4;
  if (input.closeAsOfDate) {
    doc.text(`Preços de referência (close) até: ${input.closeAsOfDate}`, margin, y);
    y += 4;
  }
  doc.text(`Património líquido de referência (NAV): ${input.navFormatted}`, margin, y);
  y += 8;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text("1. Justificação das alterações", margin, y);
  y += 5;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  const noteLines = doc.splitTextToSize(input.proposedTradesCoverageNote, pageW - 2 * margin);
  doc.text(noteLines, margin, y);
  y += noteLines.length * 4 + 3;

  const ctx = `Neste plano: ${input.planSummary.buyCount} linha(s) de compra e ${input.planSummary.sellCount} de venda. Rotação indicativa face ao NAV de referência: cerca de ${input.planSummary.turnoverPct.toFixed(1)}%. As alterações reflectem a saída quantitativa do modelo DECIDE (rebalanceamento e alinhamento à carteira recomendada de ${input.planSummary.positionCount} linhas).`;
  const ctxLines = doc.splitTextToSize(ctx, pageW - 2 * margin);
  doc.text(ctxLines, margin, y);
  y += ctxLines.length * 4 + 3;

  const introOps = doc.splitTextToSize(
    "As operações abaixo encontram-se em duas tabelas alinhadas: Entradas (compras e reforços, incluindo cobertura cambial quando aplicável) e Saídas (vendas ou reduções). A coluna «Justificação» resume o racional de investimento associado a cada linha neste documento.",
    pageW - 2 * margin,
  );
  doc.text(introOps, margin, y);
  y += introOps.length * 4 + 4;

  type OpRow = [string, string, string, string, string];

  const rowsEntradas: OpRow[] = [];
  const rowsSaidas: OpRow[] = [];
  const rowsInactivos: [string, string, string][] = [];

  for (const t of input.proposedTrades) {
    const side = String(t.side || "").toUpperCase();
    const tick = displayTickerLabel(t.ticker);
    const name = String(t.nameShort || tick).slice(0, 40);

    if (tick === "EURUSD") {
      const tw = Number.isFinite(t.targetWeightPct) ? t.targetWeightPct : 0;
      const qStr =
        t.absQty > 0 ? `${Number.isInteger(t.absQty) ? Math.floor(t.absQty) : t.absQty.toFixed(2)}` : "—";
      rowsEntradas.push([
        "EUR.USD",
        qStr,
        `${tw.toFixed(2)}%`,
        "Cobertura cambial (IDEALPRO)",
        justifyEurUsd(side),
      ]);
      continue;
    }

    if (side === "INACTIVE") {
      rowsInactivos.push([tick, name.slice(0, 36), justifyInactivo()]);
      continue;
    }

    if (side === "BUY" && t.absQty > 0) {
      const q = Math.floor(t.absQty);
      const tw = Number.isFinite(t.targetWeightPct) ? t.targetWeightPct : 0;
      rowsEntradas.push([tick, String(q), `${tw.toFixed(2)}%`, name, justifyEntrada(input)]);
      continue;
    }

    if (side === "SELL" && t.absQty > 0) {
      const q = Math.floor(t.absQty);
      const tw = Number.isFinite(t.targetWeightPct) ? t.targetWeightPct : 0;
      rowsSaidas.push([tick, String(q), `${tw.toFixed(2)}%`, name, justifySaida()]);
    }
  }

  const tableMargin = { left: margin, right: margin };
  const opColStyles = {
    0: { cellWidth: 22, halign: "left" as const },
    1: { cellWidth: 16, halign: "right" as const },
    2: { cellWidth: 18, halign: "right" as const },
    3: { cellWidth: 38, halign: "left" as const },
    4: { cellWidth: pageW - 2 * margin - 22 - 16 - 18 - 38, halign: "left" as const },
  };

  const drawOpTable = (title: string, head: string[][], body: OpRow[]) => {
    if (body.length === 0) return;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(0, 0, 0);
    if (y > pageH - 40) {
      doc.addPage();
      y = margin;
    }
    doc.text(title, margin, y);
    y += 4;
    doc.setFont("helvetica", "normal");
    autoTable(doc, {
      startY: y,
      head,
      body,
      styles: { fontSize: 7, cellPadding: 1.4, textColor: [20, 20, 20], valign: "top" },
      headStyles: { fillColor: [30, 58, 95], textColor: 255, fontStyle: "bold" },
      columnStyles: opColStyles,
      margin: tableMargin,
      showHead: "everyPage",
    });
    const d = doc as DocWithTable;
    y = (d.lastAutoTable?.finalY ?? y) + 6;
  };

  drawOpTable("1.1 Entradas (compras e cobertura cambial)", [
    ["Ticker", "Qtd (u.)", "Peso-alvo", "Nome", "Justificação"],
  ], rowsEntradas);

  drawOpTable("1.2 Saídas (vendas e reduções)", [["Ticker", "Qtd (u.)", "Peso-alvo", "Nome", "Justificação"]], rowsSaidas);

  if (rowsInactivos.length > 0) {
    if (y > pageH - 35) {
      doc.addPage();
      y = margin;
    }
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text("1.3 Títulos inactivos no plano (sem ordem)", margin, y);
    y += 4;
    doc.setFont("helvetica", "normal");
    autoTable(doc, {
      startY: y,
      head: [["Ticker", "Nome", "Justificação"]],
      body: rowsInactivos,
      styles: { fontSize: 7, cellPadding: 1.4, textColor: [20, 20, 20], valign: "top" },
      headStyles: { fillColor: [51, 65, 85], textColor: 255, fontStyle: "bold" },
      columnStyles: {
        0: { cellWidth: 24 },
        1: { cellWidth: 50 },
        2: { cellWidth: pageW - 2 * margin - 74 },
      },
      margin: tableMargin,
      showHead: "everyPage",
    });
    const d2 = doc as DocWithTable;
    y = (d2.lastAutoTable?.finalY ?? y) + 6;
  }

  if (rowsEntradas.length === 0 && rowsSaidas.length === 0 && rowsInactivos.length === 0) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.text("Sem linhas de ordem quantificáveis neste snapshot.", margin, y);
    y += 8;
  }

  if (y > pageH - 55) {
    doc.addPage();
    y = margin;
  }

  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(0, 0, 0);
  doc.text("2. Carteira recomendada (alvos do modelo)", margin, y);
  y += 4;

  const tableBody = input.recommendedPositions.map((p) => [
    displayTickerLabel(p.ticker),
    String(p.nameShort || p.ticker).slice(0, 28),
    String(p.country || "—").slice(0, 14),
    String(p.geoZone || "—").slice(0, 12),
    `${p.weightPct.toFixed(2)}%`,
    p.excluded ? "Sim" : "Não",
    String(p.sector || "—").slice(0, 18),
    String(p.industry || "—").slice(0, 16),
    String(p.region || "—").slice(0, 8),
  ]);

  autoTable(doc, {
    startY: y,
    head: [["Ticker", "Empresa", "País", "Zona", "Peso", "Excl.", "Sector", "Ind.", "Reg."]],
    body: tableBody,
    styles: { fontSize: 7, cellPadding: 1.2, textColor: [20, 20, 20] },
    headStyles: { fillColor: [30, 41, 59], textColor: 255 },
    margin: tableMargin,
    showHead: "everyPage",
  });

  const d3 = doc as DocWithTable;
  y = (d3.lastAutoTable?.finalY ?? y) + 6;

  doc.setFontSize(7);
  doc.setTextColor(90);
  doc.setFont("helvetica", "italic");
  const disc = doc.splitTextToSize(
    "Aviso: este documento resume a recomendação do sistema DECIDE na data indicada. Não substitui informação regulamentar, contratual nem aconselhamento personalizado. Investimentos envolvem risco de perda.",
    pageW - 2 * margin,
  );
  if (y + disc.length * 3.2 > pageH - 14) {
    doc.addPage();
    y = margin;
  }
  doc.text(disc, margin, y);

  addFooters();

  const fname = input.generatedAtIso.slice(0, 10);
  doc.save(`DECIDE_recomendacao_mensal_${fname}.pdf`);
}
