/**
 * Armazenamento de registos Persona (KYC) no próprio Next:
 * - Produção (Vercel): PostgreSQL via Neon (`POSTGRES_URL` ou `DATABASE_URL`).
 * - Desenvolvimento local: ficheiro JSON em `.data/persona_state.json` (sem Postgres).
 */
import fs from "fs/promises";
import path from "path";
import { neon } from "@neondatabase/serverless";

export type PersonaRecordInput = {
  reference_id: string;
  external_user_id?: string;
  inquiry_id?: string;
  name?: string;
  email?: string;
  phone?: string;
  status: string;
  fields?: Record<string, unknown>;
};

export type PersonaRecordRow = {
  reference_id: string;
  external_user_id?: string | null;
  inquiry_id?: string | null;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  status?: string | null;
  fields?: Record<string, unknown>;
  updated_at?: string | null;
  created_at?: string | null;
};

function getDatabaseUrl(): string | null {
  const u = (process.env.POSTGRES_URL || process.env.DATABASE_URL || "").trim();
  return u || null;
}

function fileStorePath(): string {
  return path.join(process.cwd(), ".data", "persona_state.json");
}

async function readFileStore(): Promise<Record<string, PersonaRecordRow>> {
  try {
    const raw = await fs.readFile(fileStorePath(), "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, PersonaRecordRow>;
    }
  } catch {
    // missing or invalid
  }
  return {};
}

async function writeFileStore(map: Record<string, PersonaRecordRow>): Promise<void> {
  const dir = path.dirname(fileStorePath());
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(fileStorePath(), JSON.stringify(map, null, 2), "utf8");
}

function rowFromInput(input: PersonaRecordInput, prev?: PersonaRecordRow): PersonaRecordRow {
  const now = new Date().toISOString();
  const mergedFields = { ...(prev?.fields || {}), ...(input.fields || {}) };
  return {
    reference_id: input.reference_id,
    external_user_id: input.external_user_id ?? prev?.external_user_id ?? null,
    inquiry_id: input.inquiry_id ?? prev?.inquiry_id ?? null,
    name: input.name ?? prev?.name ?? null,
    email: input.email ?? prev?.email ?? null,
    phone: input.phone ?? prev?.phone ?? null,
    status: input.status,
    fields: mergedFields,
    updated_at: now,
    created_at: prev?.created_at ?? now,
  };
}

export function getPersonaStorageMode(): "postgres" | "file" | "unconfigured" {
  /** Força `.data/persona_state.json` mesmo com DATABASE_URL (ex.: Neon inválido em `.env.local`). */
  if ((process.env.PERSONA_STORAGE || "").trim().toLowerCase() === "file") return "file";
  if (getDatabaseUrl()) return "postgres";
  if (process.env.VERCEL) return "unconfigured";
  return "file";
}

let tableEnsured = false;

async function ensurePostgresTable(sql: ReturnType<typeof neon>): Promise<void> {
  if (tableEnsured) return;
  await sql`
    CREATE TABLE IF NOT EXISTS persona_records (
      reference_id TEXT PRIMARY KEY,
      external_user_id TEXT,
      inquiry_id TEXT,
      name TEXT,
      email TEXT,
      phone TEXT,
      status TEXT NOT NULL,
      fields_text TEXT NOT NULL DEFAULT '{}',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;
  tableEnsured = true;
}

export async function upsertPersonaRecord(input: PersonaRecordInput): Promise<void> {
  const mode = getPersonaStorageMode();
  if (mode === "unconfigured") {
    throw new Error(
      "Armazenamento Persona não configurado em produção: defina POSTGRES_URL ou DATABASE_URL (Neon / Vercel Postgres) nas variáveis de ambiente.",
    );
  }

  if (mode === "file") {
    const map = await readFileStore();
    const prev = map[input.reference_id];
    map[input.reference_id] = rowFromInput(input, prev);
    await writeFileStore(map);
    return;
  }

  const url = getDatabaseUrl();
  if (!url) throw new Error("POSTGRES_URL / DATABASE_URL em falta");
  const sql = neon(url);
  await ensurePostgresTable(sql);

  const prevRows = await sql`SELECT fields_text, created_at FROM persona_records WHERE reference_id = ${input.reference_id} LIMIT 1`;
  let prev: PersonaRecordRow | undefined;
  if (prevRows.length > 0) {
    const r = prevRows[0] as { fields_text: string; created_at: string };
    let fields: Record<string, unknown> = {};
    try {
      fields = JSON.parse(r.fields_text || "{}") as Record<string, unknown>;
    } catch {
      fields = {};
    }
    prev = {
      reference_id: input.reference_id,
      fields,
      created_at: r.created_at,
    };
  }
  const row = rowFromInput(input, prev);
  const fieldsText = JSON.stringify(row.fields ?? {});

  await sql`
    INSERT INTO persona_records (
      reference_id, external_user_id, inquiry_id, name, email, phone, status, fields_text
    ) VALUES (
      ${row.reference_id},
      ${row.external_user_id ?? null},
      ${row.inquiry_id ?? null},
      ${row.name ?? null},
      ${row.email ?? null},
      ${row.phone ?? null},
      ${row.status},
      ${fieldsText}
    )
    ON CONFLICT (reference_id) DO UPDATE SET
      external_user_id = COALESCE(EXCLUDED.external_user_id, persona_records.external_user_id),
      inquiry_id = COALESCE(EXCLUDED.inquiry_id, persona_records.inquiry_id),
      name = COALESCE(EXCLUDED.name, persona_records.name),
      email = COALESCE(EXCLUDED.email, persona_records.email),
      phone = COALESCE(EXCLUDED.phone, persona_records.phone),
      status = EXCLUDED.status,
      fields_text = EXCLUDED.fields_text,
      updated_at = NOW()
  `;
}

export type PersonaDbRow = {
  reference_id: string;
  external_user_id: string | null;
  inquiry_id: string | null;
  name: string | null;
  email: string | null;
  phone: string | null;
  status: string | null;
  fields_text: string;
  updated_at: string | Date | null;
  created_at: string | Date | null;
};

function tsToIso(v: string | Date | null | undefined): string | null {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

function rowToApi(r: PersonaDbRow): PersonaRecordRow {
  let fields: Record<string, unknown> = {};
  try {
    fields = JSON.parse(r.fields_text || "{}") as Record<string, unknown>;
  } catch {
    fields = {};
  }
  return {
    reference_id: r.reference_id,
    external_user_id: r.external_user_id,
    inquiry_id: r.inquiry_id,
    name: r.name,
    email: r.email,
    phone: r.phone,
    status: r.status,
    fields,
    updated_at: tsToIso(r.updated_at),
    created_at: tsToIso(r.created_at),
  };
}

export async function getPersonaRecordByReference(referenceId: string): Promise<PersonaRecordRow | null> {
  const mode = getPersonaStorageMode();
  if (mode === "unconfigured") return null;

  if (mode === "file") {
    const map = await readFileStore();
    return map[referenceId] ?? null;
  }

  const url = getDatabaseUrl();
  if (!url) return null;
  const sql = neon(url);
  await ensurePostgresTable(sql);
  const rows = await sql`
    SELECT reference_id, external_user_id, inquiry_id, name, email, phone, status, fields_text, updated_at, created_at
    FROM persona_records WHERE reference_id = ${referenceId} LIMIT 1
  `;
  if (!rows.length) return null;
  return rowToApi(rows[0] as PersonaDbRow);
}

export async function listPersonaRecords(): Promise<PersonaRecordRow[]> {
  const mode = getPersonaStorageMode();
  if (mode === "unconfigured") return [];

  if (mode === "file") {
    const map = await readFileStore();
    return Object.values(map).sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
  }

  const url = getDatabaseUrl();
  if (!url) return [];
  const sql = neon(url);
  await ensurePostgresTable(sql);
  const rows = await sql`
    SELECT reference_id, external_user_id, inquiry_id, name, email, phone, status, fields_text, updated_at, created_at
    FROM persona_records ORDER BY updated_at DESC
  `;
  return (rows as PersonaDbRow[]).map((r) => rowToApi(r));
}
