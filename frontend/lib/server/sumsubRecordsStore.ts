/**
 * Armazenamento de registos Sumsub (KYC) no próprio Next:
 * - Produção (Vercel): PostgreSQL via Neon (`POSTGRES_URL` ou `DATABASE_URL`).
 * - Desenvolvimento local: ficheiro JSON em `.data/sumsub_state.json` (sem Postgres).
 */
import fs from "fs/promises";
import path from "path";
import { neon } from "@neondatabase/serverless";

export type SumsubRecordInput = {
  external_user_id: string;
  applicant_id?: string;
  name?: string;
  email?: string;
  phone?: string;
  /** reviewStatus da Sumsub: init | pending | prechecked | queued | completed | onHold */
  status: string;
  /** reviewResult.reviewAnswer da Sumsub: GREEN | RED | undefined */
  review_answer?: string;
  fields?: Record<string, unknown>;
};

export type SumsubRecordRow = {
  external_user_id: string;
  applicant_id?: string | null;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  status?: string | null;
  review_answer?: string | null;
  fields?: Record<string, unknown>;
  updated_at?: string | null;
  created_at?: string | null;
};

function getDatabaseUrl(): string | null {
  const u = (process.env.POSTGRES_URL || process.env.DATABASE_URL || "").trim();
  return u || null;
}

function fileStorePath(): string {
  return path.join(process.cwd(), ".data", "sumsub_state.json");
}

async function readFileStore(): Promise<Record<string, SumsubRecordRow>> {
  try {
    const raw = await fs.readFile(fileStorePath(), "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, SumsubRecordRow>;
    }
  } catch {
    // missing or invalid
  }
  return {};
}

async function writeFileStore(map: Record<string, SumsubRecordRow>): Promise<void> {
  const dir = path.dirname(fileStorePath());
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(fileStorePath(), JSON.stringify(map, null, 2), "utf8");
}

function rowFromInput(input: SumsubRecordInput, prev?: SumsubRecordRow): SumsubRecordRow {
  const now = new Date().toISOString();
  const mergedFields = { ...(prev?.fields || {}), ...(input.fields || {}) };
  return {
    external_user_id: input.external_user_id,
    applicant_id: input.applicant_id ?? prev?.applicant_id ?? null,
    name: input.name ?? prev?.name ?? null,
    email: input.email ?? prev?.email ?? null,
    phone: input.phone ?? prev?.phone ?? null,
    status: input.status,
    review_answer: input.review_answer ?? prev?.review_answer ?? null,
    fields: mergedFields,
    updated_at: now,
    created_at: prev?.created_at ?? now,
  };
}

export function getSumsubStorageMode(): "postgres" | "file" | "unconfigured" {
  if ((process.env.SUMSUB_STORAGE || "").trim().toLowerCase() === "file") return "file";
  if (getDatabaseUrl()) return "postgres";
  if (process.env.VERCEL) return "unconfigured";
  return "file";
}

let tableEnsured = false;

async function ensurePostgresTable(sql: ReturnType<typeof neon>): Promise<void> {
  if (tableEnsured) return;
  await sql`
    CREATE TABLE IF NOT EXISTS sumsub_records (
      external_user_id TEXT PRIMARY KEY,
      applicant_id TEXT,
      name TEXT,
      email TEXT,
      phone TEXT,
      status TEXT NOT NULL,
      review_answer TEXT,
      fields_text TEXT NOT NULL DEFAULT '{}',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;
  tableEnsured = true;
}

export async function upsertSumsubRecord(input: SumsubRecordInput): Promise<void> {
  const mode = getSumsubStorageMode();
  if (mode === "unconfigured") {
    throw new Error(
      "Armazenamento Sumsub não configurado em produção: defina POSTGRES_URL ou DATABASE_URL (Neon / Vercel Postgres) nas variáveis de ambiente.",
    );
  }

  if (mode === "file") {
    const map = await readFileStore();
    const prev = map[input.external_user_id];
    map[input.external_user_id] = rowFromInput(input, prev);
    await writeFileStore(map);
    return;
  }

  const url = getDatabaseUrl();
  if (!url) throw new Error("POSTGRES_URL / DATABASE_URL em falta");
  const sql = neon(url);
  await ensurePostgresTable(sql);

  const prevRows = await sql`SELECT fields_text, created_at, review_answer FROM sumsub_records WHERE external_user_id = ${input.external_user_id} LIMIT 1`;
  let prev: SumsubRecordRow | undefined;
  if (prevRows.length > 0) {
    const r = prevRows[0] as { fields_text: string; created_at: string; review_answer: string | null };
    let fields: Record<string, unknown> = {};
    try {
      fields = JSON.parse(r.fields_text || "{}") as Record<string, unknown>;
    } catch {
      fields = {};
    }
    prev = {
      external_user_id: input.external_user_id,
      fields,
      review_answer: r.review_answer,
      created_at: r.created_at,
    };
  }
  const row = rowFromInput(input, prev);
  const fieldsText = JSON.stringify(row.fields ?? {});

  await sql`
    INSERT INTO sumsub_records (
      external_user_id, applicant_id, name, email, phone, status, review_answer, fields_text
    ) VALUES (
      ${row.external_user_id},
      ${row.applicant_id ?? null},
      ${row.name ?? null},
      ${row.email ?? null},
      ${row.phone ?? null},
      ${row.status},
      ${row.review_answer ?? null},
      ${fieldsText}
    )
    ON CONFLICT (external_user_id) DO UPDATE SET
      applicant_id = COALESCE(EXCLUDED.applicant_id, sumsub_records.applicant_id),
      name = COALESCE(EXCLUDED.name, sumsub_records.name),
      email = COALESCE(EXCLUDED.email, sumsub_records.email),
      phone = COALESCE(EXCLUDED.phone, sumsub_records.phone),
      status = EXCLUDED.status,
      review_answer = COALESCE(EXCLUDED.review_answer, sumsub_records.review_answer),
      fields_text = EXCLUDED.fields_text,
      updated_at = NOW()
  `;
}

export type SumsubDbRow = {
  external_user_id: string;
  applicant_id: string | null;
  name: string | null;
  email: string | null;
  phone: string | null;
  status: string | null;
  review_answer: string | null;
  fields_text: string;
  updated_at: string | Date | null;
  created_at: string | Date | null;
};

function tsToIso(v: string | Date | null | undefined): string | null {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

function rowToApi(r: SumsubDbRow): SumsubRecordRow {
  let fields: Record<string, unknown> = {};
  try {
    fields = JSON.parse(r.fields_text || "{}") as Record<string, unknown>;
  } catch {
    fields = {};
  }
  return {
    external_user_id: r.external_user_id,
    applicant_id: r.applicant_id,
    name: r.name,
    email: r.email,
    phone: r.phone,
    status: r.status,
    review_answer: r.review_answer,
    fields,
    updated_at: tsToIso(r.updated_at),
    created_at: tsToIso(r.created_at),
  };
}

export async function getSumsubRecordByUserId(externalUserId: string): Promise<SumsubRecordRow | null> {
  const mode = getSumsubStorageMode();
  if (mode === "unconfigured") return null;

  if (mode === "file") {
    const map = await readFileStore();
    return map[externalUserId] ?? null;
  }

  const url = getDatabaseUrl();
  if (!url) return null;
  const sql = neon(url);
  await ensurePostgresTable(sql);
  const rows = await sql`
    SELECT external_user_id, applicant_id, name, email, phone, status, review_answer, fields_text, updated_at, created_at
    FROM sumsub_records WHERE external_user_id = ${externalUserId} LIMIT 1
  `;
  if (!rows.length) return null;
  return rowToApi(rows[0] as SumsubDbRow);
}

export async function listSumsubRecords(): Promise<SumsubRecordRow[]> {
  const mode = getSumsubStorageMode();
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
    SELECT external_user_id, applicant_id, name, email, phone, status, review_answer, fields_text, updated_at, created_at
    FROM sumsub_records ORDER BY updated_at DESC
  `;
  return (rows as SumsubDbRow[]).map((r) => rowToApi(r));
}
