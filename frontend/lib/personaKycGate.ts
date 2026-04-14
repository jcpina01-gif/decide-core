/**
 * Regra única: quando o registo Persona no servidor desbloqueia o passo Corretora (IBKR prep).
 * Antes só `completed` era aceite — a Persona pode gravar `approved`, `pending`, etc. após o fluxo no widget,
 * e o bypass DECIDE usa `manual_review_pending`.
 */
export type PersonaRecordLike = {
  status?: string | null;
  inquiry_id?: string | null;
};

const DENY = new Set(
  ["failed", "cancelled", "canceled", "declined", "expired", "error"].map((s) => s.toLowerCase()),
);

const ALLOW_ALWAYS = new Set(
  [
    "completed",
    "approved",
    "passed",
    "manual_review_pending",
    "needs_review",
    "submitted",
  ].map((s) => s.toLowerCase()),
);

/** Estados «em curso» só contam se já existe inquiry (evita registo vazio). */
const ALLOW_WITH_INQUIRY = new Set(["pending", "processing", "queued"].map((s) => s.toLowerCase()));

export function personaRecordAllowsIbkrPrep(record: PersonaRecordLike | null | undefined): boolean {
  if (!record) return false;
  const st = String(record.status ?? "").trim().toLowerCase();
  if (!st || DENY.has(st)) return false;
  if (ALLOW_ALWAYS.has(st)) return true;
  const inq = String(record.inquiry_id ?? "").trim();
  if (!inq) return false;
  return ALLOW_WITH_INQUIRY.has(st);
}
