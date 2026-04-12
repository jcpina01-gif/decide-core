/**
 * Quando o FastAPI (uvicorn) não está acessível, reconstrói um payload compatível com
 * `/api/ibkr-snapshot` a partir de `tmp_diag/ibkr_paper_smoke_test.json` e, em alternativa,
 * posições em `tmp_diag/ibkr_order_status_and_cancel.json` — o mesmo espírito do SSR do relatório.
 */

import fs from "fs";
import path from "path";
import { resolveDecideProjectRoot } from "./decideProjectRoot";

const TMP_DIAG_FALLBACK_SOURCE = "tmp_diag_fallback";

function safeNumber(n: unknown, fallback = 0): number {
  const x = typeof n === "number" ? n : Number(n);
  return Number.isFinite(x) ? x : fallback;
}

function safeString(s: unknown, fallback = ""): string {
  return typeof s === "string" ? s : fallback;
}

function readJsonIfExists(filePath: string): Record<string, unknown> | null {
  if (!fs.existsSync(filePath)) return null;
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const j = JSON.parse(raw) as unknown;
    return j && typeof j === "object" && !Array.isArray(j) ? (j as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

type SmokePick = Record<string, unknown> | undefined;

function pickSmokeRecord(smoke: Record<string, unknown> | null): SmokePick {
  if (!smoke) return undefined;
  const sel = smoke.selected as Record<string, unknown> | undefined;
  if (sel && typeof sel === "object") return sel;
  const att = smoke.attempts;
  if (Array.isArray(att) && att.length > 0) {
    const a0 = att[0];
    if (a0 && typeof a0 === "object" && !Array.isArray(a0)) return a0 as Record<string, unknown>;
  }
  return undefined;
}

function netFromPick(pick: SmokePick): { nav: number; ccy: string } {
  if (!pick) return { nav: 0, ccy: "EUR" };
  const nl = pick.netLiquidation as Record<string, unknown> | undefined;
  return {
    nav: safeNumber(nl?.value, 0),
    ccy: safeString(nl?.currency, "EUR").toUpperCase() || "EUR",
  };
}

function mapRawPosition(p: Record<string, unknown>): Record<string, unknown> {
  const ticker = safeString(p.ticker ?? p.symbol, "").trim();
  const qty = safeNumber(p.position ?? p.qty ?? p.shares ?? p.size, 0);
  const value = safeNumber(
    p.marketValue ?? p.market_value ?? p.value ?? p.position_value ?? p.positionValue,
    0,
  );
  const row: Record<string, unknown> = {
    ticker: ticker || safeString(p.symbol, "—"),
    symbol: ticker || safeString(p.symbol, "—"),
    qty,
    position: qty,
    value,
    market_value: value,
  };
  const name = safeString(p.name ?? p.companyName ?? p.company ?? p.longName ?? p.long_name, "");
  if (name) row.name = name;
  const sector = safeString(p.sector ?? p.gics_sector, "");
  if (sector) row.sector = sector;
  return row;
}

/**
 * Devolve um corpo JSON para responder como snapshot OK, ou null se não houver dados úteis.
 */
export function tryBuildIbkrSnapshotFromTmpDiag(): Record<string, unknown> | null {
  const root = resolveDecideProjectRoot();
  const tmp = path.join(root, "tmp_diag");
  const smokePath = path.join(tmp, "ibkr_paper_smoke_test.json");
  const statusPath = path.join(tmp, "ibkr_order_status_and_cancel.json");

  const smoke = readJsonIfExists(smokePath);
  const status = readJsonIfExists(statusPath);
  if (!smoke && !status) return null;

  const pick = pickSmokeRecord(smoke);
  const { nav, ccy } = netFromPick(pick);
  const accountCode = safeString(pick?.accountCode, "").trim();

  let rawPositions: unknown[] = [];
  if (status && Array.isArray(status.positions)) rawPositions = status.positions as unknown[];
  else if (pick && Array.isArray(pick.positions)) rawPositions = pick.positions as unknown[];

  const positions: Record<string, unknown>[] = [];
  for (const rp of rawPositions) {
    if (!rp || typeof rp !== "object" || Array.isArray(rp)) continue;
    const row = mapRawPosition(rp as Record<string, unknown>);
    const v = safeNumber(row.value, 0);
    const q = safeNumber(row.qty, 0);
    if (v > 0 || q !== 0) positions.push(row);
  }

  const cashVal = safeNumber(
    (pick?.cash as Record<string, unknown> | undefined)?.value ??
      (pick?.cash as number | undefined),
    0,
  );

  if (!(nav > 0) && positions.length === 0) return null;

  const cashWeightPct = nav > 0 ? (cashVal / nav) * 100 : 0;

  return {
    status: "ok",
    net_liquidation: nav,
    net_liquidation_ccy: ccy,
    account_code: accountCode,
    positions,
    cash_ledger: {
      tag: "TotalCashValue",
      value: cashVal,
      currency: ccy,
      weight_pct: cashWeightPct,
    },
    meta: {
      decide_snapshot_source: TMP_DIAG_FALLBACK_SOURCE,
      decide_snapshot_fallback_note:
        "Último snapshot em tmp_diag (backend FastAPI offline). Arranque uvicorn para dados em tempo real.",
    },
  };
}
