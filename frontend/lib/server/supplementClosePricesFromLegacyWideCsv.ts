import fs from "fs";
import path from "path";

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === "," && !inQuotes) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out;
}

/**
 * `backend/data/prices_close.csv` (usado no SSR do plano) é um subconjunto de tickers.
 * `backend/prices_close.csv` tem colunas extra (ex. MRNA) — preenche só chaves ainda ausentes.
 */
export function supplementClosePricesMapFromLegacyWideCsv(
  closePricesByTicker: Map<string, number>,
  projectRoot: string,
): void {
  const legacyPath = path.join(projectRoot, "backend", "prices_close.csv");
  try {
    if (!fs.existsSync(legacyPath)) return;
    const textRaw = fs.readFileSync(legacyPath, "utf-8");
    const text = textRaw.replace(/^\uFEFF/, "");
    const firstNl = text.indexOf("\n");
    const lastNl = text.lastIndexOf("\n");
    const prevNl = text.lastIndexOf("\n", lastNl - 1);
    if (firstNl <= 0 || lastNl <= 0 || prevNl <= 0) return;

    const headerLine = text.slice(0, firstNl).replace(/\r/g, "").trim();
    const lastLine = text.slice(prevNl + 1, lastNl).replace(/\r/g, "").trim();
    const headers = splitCsvLine(headerLine).map((h) => h.trim());
    const values = splitCsvLine(lastLine);

    for (let i = 0; i < headers.length; i += 1) {
      const col = headers[i];
      if (!col || col.toLowerCase() === "date") continue;
      const u = col.toUpperCase();
      if (closePricesByTicker.has(u)) continue;
      const raw = values[i];
      const num = Number(raw);
      if (Number.isFinite(num) && num > 0) {
        closePricesByTicker.set(u, num);
      }
    }
  } catch {
    /* ignore */
  }
}
