/**
 * Regra de gate Sumsub: quando o registo desbloqueia «Plano e pagamento» (IBKR prep).
 *
 * reviewStatus Sumsub:
 *   init        — ainda não submetido
 *   pending     — em revisão automática
 *   prechecked  — passou verificação automática, aguarda revisão manual
 *   queued      — na fila de revisão manual
 *   completed   — revisão concluída (resultado em reviewAnswer)
 *   onHold      — em espera (ex. documentos em falta)
 *
 * reviewAnswer (só quando completed):
 *   GREEN — aprovado
 *   RED   — rejeitado
 */
export type SumsubRecordLike = {
  status?: string | null;
  review_answer?: string | null;
  applicant_id?: string | null;
};

const DENY_ANSWERS = new Set(["RED"].map((s) => s.toLowerCase()));

const ALLOW_STATUSES = new Set(
  ["completed", "prechecked", "queued", "onhold"].map((s) => s.toLowerCase()),
);

/** Estados em curso que só contam se já existe applicant_id (evita registo vazio). */
const ALLOW_WITH_APPLICANT = new Set(
  ["pending", "init"].map((s) => s.toLowerCase()),
);

export function sumsubRecordAllowsIbkrPrep(
  record: SumsubRecordLike | null | undefined,
): boolean {
  if (!record) return false;
  const st = String(record.status ?? "").trim().toLowerCase();
  const ans = String(record.review_answer ?? "").trim().toLowerCase();
  if (!st) return false;
  if (DENY_ANSWERS.has(ans)) return false;
  if (ALLOW_STATUSES.has(st)) return true;
  const appId = String(record.applicant_id ?? "").trim();
  if (!appId) return false;
  return ALLOW_WITH_APPLICANT.has(st);
}

export function extractNameFromSumsubRecord(
  record: SumsubRecordLike & { name?: string | null; fields?: Record<string, unknown> } | null | undefined,
): string {
  if (!record) return "";
  if (typeof record.name === "string" && record.name.trim()) return record.name.trim();
  const f = record.fields || {};
  for (const key of ["fullName", "full_name", "firstName", "first_name", "name"]) {
    const v = f[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}
