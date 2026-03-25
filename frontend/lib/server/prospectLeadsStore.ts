/**
 * Emails confirmados na lista de interessados (sem conta).
 * Lista de interessados / novidades — não é a base formal de clientes (ver `clientFormalRegistryStore`).
 * Ficheiro separado de `signup_email_verified.json` (pré-registo antes de criar user).
 * Persistência local em `.data/` — adequado a dev; em produção migrar para BD com política de retenção explícita.
 */
import fs from "fs";
import path from "path";

export type ProspectLeadRecord = {
  email: string;
  verifiedAt: number;
  source?: string;
};

function filePath(): string {
  return path.join(process.cwd(), ".data", "prospect_leads.json");
}

type FileShape = {
  leads: Record<string, ProspectLeadRecord>;
};

function readFile(): FileShape {
  const p = filePath();
  try {
    if (!fs.existsSync(p)) return { leads: {} };
    const raw = JSON.parse(fs.readFileSync(p, "utf8")) as FileShape;
    if (!raw || typeof raw !== "object" || !raw.leads || typeof raw.leads !== "object") {
      return { leads: {} };
    }
    return raw;
  } catch {
    return { leads: {} };
  }
}

function writeFile(data: FileShape): void {
  const p = filePath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data, null, 2), "utf8");
}

/** Grava ou actualiza lead confirmado por email (chave = email normalizado). */
export function recordProspectLeadVerified(email: string, meta?: { source?: string }): void {
  const em = email.trim().toLowerCase();
  if (!em.includes("@")) return;
  const data = readFile();
  const prev = data.leads[em];
  data.leads[em] = {
    email: em,
    verifiedAt: Date.now(),
    source: meta?.source || prev?.source || "verify_email",
  };
  writeFile(data);
}

export function isProspectVerifiedOnServer(email: string): boolean {
  const em = email.trim().toLowerCase();
  if (!em.includes("@")) return false;
  const data = readFile();
  return Boolean(data.leads[em]);
}
