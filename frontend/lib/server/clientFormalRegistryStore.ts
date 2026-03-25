/**
 * Base formal de clientes (servidor): só deve receber PII após requisitos cumpridos.
 * Ficheiro `.data/client_registry_formal.json` — não confundir com pré-registo / marketing.
 */
import fs from "fs";
import path from "path";

const MIN_BALANCE_EUR = 5000;

export type FormalClientRecord = {
  username: string;
  email: string;
  phone?: string;
  ibkrAccountId?: string;
  balanceEurAtCommit: number;
  recordedAt: number;
};

type FileShape = Record<string, FormalClientRecord>;

function filePath(): string {
  return path.join(process.cwd(), ".data", "client_registry_formal.json");
}

function readAll(): FileShape {
  const p = filePath();
  try {
    if (!fs.existsSync(p)) return {};
    const o = JSON.parse(fs.readFileSync(p, "utf8")) as FileShape;
    return o && typeof o === "object" ? o : {};
  } catch {
    return {};
  }
}

function writeAll(data: FileShape): void {
  const p = filePath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data, null, 2), "utf8");
}

export type CommitFormalClientInput = {
  username: string;
  email: string;
  phone?: string;
  ibkrAccountId?: string;
  /** Fluxo de onboarding concluído (ex.: KYC / contratos) */
  flowCompleted: boolean;
  /** Conta IBKR aberta e operacional */
  ibkrAccountOpened: boolean;
  /** Saldo em EUR na conta IBKR (ou equivalente convertido no upstream) */
  balanceEur: number;
};

/**
 * Grava ou atualiza registo formal só se todas as condições forem satisfeitas.
 */
export function commitFormalClientRecord(input: CommitFormalClientInput): { ok: true } | { ok: false; error: string } {
  const u = String(input.username || "").trim().toLowerCase();
  const em = String(input.email || "").trim().toLowerCase();
  if (!u) return { ok: false, error: "username_required" };
  if (!em.includes("@")) return { ok: false, error: "email_required" };
  if (!input.flowCompleted) return { ok: false, error: "flow_not_completed" };
  if (!input.ibkrAccountOpened) return { ok: false, error: "ibkr_not_opened" };
  const bal = Number(input.balanceEur);
  if (!Number.isFinite(bal) || bal < MIN_BALANCE_EUR) {
    return { ok: false, error: "balance_below_minimum" };
  }

  const all = readAll();
  all[u] = {
    username: u,
    email: em,
    phone: input.phone?.trim() || undefined,
    ibkrAccountId: input.ibkrAccountId?.trim() || undefined,
    balanceEurAtCommit: bal,
    recordedAt: Date.now(),
  };
  writeAll(all);
  return { ok: true };
}

export const FORMAL_CLIENT_MIN_BALANCE_EUR = MIN_BALANCE_EUR;
