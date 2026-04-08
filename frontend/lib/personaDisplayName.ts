/**
 * Nome para UI a partir do registo Persona gravado no servidor.
 * O campo `name` nem sempre é preenchido pelo callback; o nome costuma estar em `fields`.
 */

function safeFieldString(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  if (typeof v === "object") {
    const o = v as { value?: unknown };
    if (typeof o.value === "string") return o.value;
    if (typeof o.value === "number" && Number.isFinite(o.value)) return String(o.value);
  }
  return "";
}

function guessFullNameFromPersonaFields(fieldsOut: Record<string, unknown>): string {
  const entries = Object.entries(fieldsOut || {});
  const byKey = (key: string) => {
    const found = entries.find(([k]) => k.toLowerCase() === key.toLowerCase());
    return found ? safeFieldString(fieldsOut[found[0]]) : "";
  };

  const fullCandidates = ["full_name", "fullname", "fullName", "name", "complete_name", "customer_name"];
  for (const k of fullCandidates) {
    const v = byKey(k);
    if (v.trim()) return v.trim();
  }

  const firstCandidates = ["first_name", "firstname", "firstName", "given_name", "givenName"];
  const lastCandidates = ["last_name", "lastname", "lastName", "family_name", "familyName"];

  let first = "";
  for (const k of firstCandidates) {
    const v = byKey(k);
    if (v.trim()) {
      first = v.trim();
      break;
    }
  }

  let last = "";
  for (const k of lastCandidates) {
    const v = byKey(k);
    if (v.trim()) {
      last = v.trim();
      break;
    }
  }

  const combined = `${first} ${last}`.trim();
  if (combined) return combined;

  return "";
}

function extractFullNameFromPersonaFields(fieldsOut: Record<string, unknown>): string {
  const direct = guessFullNameFromPersonaFields(fieldsOut);
  if (direct) return direct;

  const walk = (obj: unknown, depth: number): string => {
    if (!obj || depth > 6) return "";
    if (typeof obj === "string") {
      const t = obj.trim();
      if (t.length >= 3 && t.length < 200 && /\s/.test(t)) return t;
    }
    if (typeof obj !== "object" || Array.isArray(obj)) return "";
    const o = obj as Record<string, unknown>;
    for (const [k, v] of Object.entries(o)) {
      const kl = k.toLowerCase();
      if (kl.includes("name") || kl.includes("nome") || kl === "full_name" || kl === "legal_name") {
        const s = safeFieldString(v);
        if (s.trim()) return s.trim();
      }
    }
    for (const v of Object.values(o)) {
      const nested = walk(v, depth + 1);
      if (nested) return nested;
    }
    return "";
  };

  return walk(fieldsOut, 0);
}

/** Usado em `/client/ibkr-prep` e noutros ecrãs que leem `/api/persona/status`. */
export function extractDisplayNameFromPersonaRecord(rec: unknown): string {
  if (!rec || typeof rec !== "object") return "";
  const r = rec as { name?: string | null; fields?: Record<string, unknown> | null };
  const n = typeof r.name === "string" ? r.name.trim() : "";
  if (n) return n;
  const f = r.fields && typeof r.fields === "object" && !Array.isArray(r.fields) ? r.fields : {};
  return extractFullNameFromPersonaFields(f);
}
