import { neon } from "@neondatabase/serverless";

let _sql: ReturnType<typeof neon> | null = null;

export function getDb() {
  if (!_sql) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    _sql = neon(url);
  }
  return _sql;
}

export const MIGRATE_SQL = `
CREATE TABLE IF NOT EXISTS recommendation_snapshots (
  id            TEXT PRIMARY KEY,
  client_id     TEXT NOT NULL,
  generated_at  TIMESTAMPTZ NOT NULL,
  risk_profile  TEXT,
  model_version TEXT,
  model_hash    TEXT,
  positions     JSONB NOT NULL DEFAULT '[]',
  kpis          JSONB,
  raw_payload   JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_rec_client ON recommendation_snapshots(client_id);

CREATE TABLE IF NOT EXISTS client_approvals (
  id                  TEXT PRIMARY KEY,
  recommendation_id   TEXT REFERENCES recommendation_snapshots(id),
  client_id           TEXT NOT NULL,
  action              TEXT NOT NULL CHECK (action IN ('approved','rejected')),
  payload_hash        TEXT,
  ip_address          TEXT,
  user_agent          TEXT,
  approved_at         TIMESTAMPTZ NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_appr_client ON client_approvals(client_id);
CREATE INDEX IF NOT EXISTS idx_appr_rec    ON client_approvals(recommendation_id);

CREATE TABLE IF NOT EXISTS order_logs (
  id                TEXT PRIMARY KEY,
  recommendation_id TEXT,
  approval_id       TEXT REFERENCES client_approvals(id),
  client_id         TEXT NOT NULL,
  ticker            TEXT NOT NULL,
  side              TEXT NOT NULL CHECK (side IN ('BUY','SELL')),
  qty               NUMERIC,
  order_type        TEXT DEFAULT 'MKT',
  limit_price       NUMERIC,
  status            TEXT NOT NULL DEFAULT 'submitted',
  ibkr_order_id     TEXT,
  submitted_at      TIMESTAMPTZ,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ord_client ON order_logs(client_id);

CREATE TABLE IF NOT EXISTS execution_logs (
  id            TEXT PRIMARY KEY,
  order_id      TEXT REFERENCES order_logs(id),
  client_id     TEXT NOT NULL,
  ticker        TEXT NOT NULL,
  side          TEXT NOT NULL,
  qty_filled    NUMERIC,
  price_executed NUMERIC,
  commission    NUMERIC,
  ibkr_exec_id  TEXT,
  executed_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_exec_client ON execution_logs(client_id);
CREATE INDEX IF NOT EXISTS idx_exec_order  ON execution_logs(order_id);

CREATE TABLE IF NOT EXISTS funding_logs (
  id           TEXT PRIMARY KEY,
  client_id    TEXT NOT NULL,
  amount       NUMERIC NOT NULL,
  currency     TEXT NOT NULL DEFAULT 'EUR',
  type         TEXT NOT NULL CHECK (type IN ('deposit','withdrawal','internal_transfer')),
  source       TEXT,
  ibkr_ref     TEXT,
  occurred_at  TIMESTAMPTZ NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_fund_client ON funding_logs(client_id);

CREATE TABLE IF NOT EXISTS config_change_logs (
  id           TEXT PRIMARY KEY,
  client_id    TEXT,
  changed_by   TEXT NOT NULL CHECK (changed_by IN ('client','backoffice','system')),
  change_type  TEXT NOT NULL,
  old_value    JSONB,
  new_value    JSONB,
  changed_at   TIMESTAMPTZ NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_cfg_client ON config_change_logs(client_id);
`;

// Incremental ALTER TABLE migrations (idempotent — safe to run multiple times)
const ALTER_MIGRATIONS = [
  // Add fill_status to execution_logs to distinguish filled vs presubmitted
  `ALTER TABLE execution_logs ADD COLUMN IF NOT EXISTS fill_status TEXT DEFAULT 'filled'`,
];

export async function migrateDb(): Promise<void> {
  const sql = getDb();
  // CREATE TABLE / INDEX statements
  const stmts = MIGRATE_SQL.split(";")
    .map((s) => s.trim())
    .filter(Boolean);
  for (const stmt of stmts) {
    await sql(stmt);
  }
  // ALTER TABLE migrations
  for (const stmt of ALTER_MIGRATIONS) {
    await sql(stmt);
  }
}
