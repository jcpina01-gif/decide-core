/**
 * Entrada numérica com separadores pt-PT (espaço nos milhares; vírgula ou ponto decimal).
 */

const NBSP = /[\s\u00A0\u202F]/g;

/** Remove agrupadores e normaliza decimal para parseFloat. */
export function parsePtNumberInput(raw: string): number {
  const t = String(raw)
    .trim()
    .replace(NBSP, "")
    .replace(/\./g, "")
    .replace(",", ".");
  if (t === "" || t === "-" || t === ".") return Number.NaN;
  const n = Number(t);
  return Number.isFinite(n) ? n : Number.NaN;
}

/** Versão que aceita ponto como decimal se não houver vírgula (hábito EN). */
export function parsePtNumberInputLoose(raw: string): number {
  const trimmed = String(raw).trim().replace(NBSP, "");
  if (trimmed === "" || trimmed === "-") return Number.NaN;
  const hasComma = trimmed.includes(",");
  const hasDot = trimmed.includes(".");
  let t = trimmed;
  if (hasComma && !hasDot) {
    t = t.replace(/\./g, "").replace(",", ".");
  } else if (hasDot && !hasComma) {
    t = t.replace(/,/g, "");
  } else if (hasComma && hasDot) {
    const lastComma = trimmed.lastIndexOf(",");
    const lastDot = trimmed.lastIndexOf(".");
    if (lastComma > lastDot) {
      t = trimmed.replace(/\./g, "").replace(",", ".");
    } else {
      t = trimmed.replace(/,/g, "");
    }
  } else {
    t = trimmed.replace(/,/g, "");
  }
  const n = Number(t);
  return Number.isFinite(n) ? n : Number.NaN;
}

export function formatPtThousands(n: number, maxDecimals: number): string {
  if (!Number.isFinite(n)) return "";
  return new Intl.NumberFormat("pt-PT", {
    maximumFractionDigits: maxDecimals,
    minimumFractionDigits: 0,
  }).format(n);
}

/** Edição sem separadores de milhares (vírgula só como decimal). */
export function toPlainEditString(n: number, maxDecimals: number): string {
  if (!Number.isFinite(n)) return "";
  if (maxDecimals <= 0) return String(Math.trunc(n));
  const s = n.toFixed(maxDecimals);
  const trimmed = s.replace(/\.?0+$/, "");
  return trimmed.replace(".", ",");
}

export function clampNumber(n: number, min?: number, max?: number): number {
  let x = n;
  if (min !== undefined && x < min) x = min;
  if (max !== undefined && x > max) x = max;
  return x;
}
