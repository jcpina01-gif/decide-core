/** Mesmas regras que `normalizeClientPhone` em `clientAuth` (API routes não devem importar código de browser). */

export function normalizeClientPhoneE164(raw: string): { ok: true; e164: string } | { ok: false; error: string } {
  let s = (raw || "").trim().replace(/\s+/g, "");
  if (!s) return { ok: false, error: "Telemóvel é obrigatório." };
  if (s.startsWith("+")) {
    if (!/^\+[1-9]\d{6,14}$/.test(s)) {
      return { ok: false, error: "Formato inválido. Usa E.164, ex.: +351912345678" };
    }
    return { ok: true, e164: s };
  }
  if (/^9\d{8}$/.test(s)) return { ok: true, e164: `+351${s}` };
  if (/^3519\d{8}$/.test(s)) return { ok: true, e164: `+${s}` };
  return { ok: false, error: "Indica o número com código do país, ex.: +351912345678 ou 912345678" };
}
