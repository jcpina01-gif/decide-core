/**
 * Perfil de risco MiFID (onboarding) alinhado ao cálculo em `pages/mifid-test.tsx` (`result` useMemo).
 * Usado como valor por defeito no selector do dashboard / Carteira.
 */

export type DecideRiskProfile = "conservador" | "moderado" | "dinamico";

export const LS_RISK_PROFILE = "decide_onboarding_risk_profile_v1";
export const LS_MIFID_FIELDS = "decide_onboarding_mifid_fields_v1";
export const LS_MIFID_STEP_DONE = "decide_onboarding_step2_done";

/** Chaves que alteram o perfil lido por `readDefaultRiskProfileFromOnboarding` (ex.: sync entre separadores). */
export const ONBOARDING_LS_KEYS_SYNC_RISK_PROFILE: readonly string[] = [
  LS_RISK_PROFILE,
  LS_MIFID_FIELDS,
  LS_MIFID_STEP_DONE,
];

function hasValueString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

function readPositiveNum(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v) && v > 0) return v;
  if (typeof v === "string") {
    const n = Number(v);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 0;
}

/**
 * Replica o cálculo de `result.profile` em mifid-test para dados já gravados em localStorage.
 * Devolve `null` se os campos estiverem incompletos.
 */
export function computeRiskProfileFromMifidFieldsPayload(raw: unknown): DecideRiskProfile | null {
  if (raw == null || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;

  const anosExpNum = readPositiveNum(o.anosExperiencia);
  const nOperacoesNum = readPositiveNum(o.nOperacoesAno);
  const aceitaPerdaNum = readPositiveNum(o.aceitaPerda);
  const horizonteNum = readPositiveNum(o.horizonte);
  const patrimonioNum = readPositiveNum(o.patrimonio);
  const montanteNum = readPositiveNum(o.montante);
  const nProdutos = typeof o.nProdutos === "string" ? o.nProdutos : "";
  const entendeVolatilidade = typeof o.entendeVolatilidade === "string" ? o.entendeVolatilidade : "";
  const entendeDrawdown = typeof o.entendeDrawdown === "string" ? o.entendeDrawdown : "";
  const objetivo = typeof o.objetivo === "string" ? o.objetivo : "";
  const liquidez = typeof o.liquidez === "string" ? o.liquidez : "";
  const rendimentosEstaveis = typeof o.rendimentosEstaveis === "string" ? o.rendimentosEstaveis : "";

  const mifidComplete =
    anosExpNum > 0 &&
    hasValueString(nProdutos) &&
    nOperacoesNum > 0 &&
    hasValueString(entendeVolatilidade) &&
    hasValueString(entendeDrawdown) &&
    aceitaPerdaNum > 0 &&
    hasValueString(objetivo) &&
    horizonteNum > 0 &&
    hasValueString(liquidez) &&
    hasValueString(rendimentosEstaveis) &&
    patrimonioNum > 0 &&
    montanteNum > 0;

  if (!mifidComplete) return null;

  let knowledgeScore = 0;
  let riskScore = 0;

  if (anosExpNum >= 5) knowledgeScore += 2;
  else if (anosExpNum >= 2) knowledgeScore += 1;

  if (nProdutos === "muitos") knowledgeScore += 2;
  else if (nProdutos === "alguns") knowledgeScore += 1;

  if (nOperacoesNum >= 20) knowledgeScore += 2;
  else if (nOperacoesNum >= 5) knowledgeScore += 1;

  if (entendeVolatilidade === "sim") knowledgeScore += 1;
  if (entendeDrawdown === "sim") knowledgeScore += 1;

  if (aceitaPerdaNum >= 30) riskScore += 3;
  else if (aceitaPerdaNum >= 15) riskScore += 2;
  else if (aceitaPerdaNum >= 8) riskScore += 1;

  if (horizonteNum >= 7) riskScore += 2;
  else if (horizonteNum >= 4) riskScore += 1;

  if (objetivo === "crescimento") riskScore += 2;
  else if (objetivo === "equilibrio") riskScore += 1;

  if (liquidez === "baixa") riskScore += 2;
  else if (liquidez === "media") riskScore += 1;

  if (rendimentosEstaveis === "sim") riskScore += 1;

  const total = knowledgeScore + riskScore;
  let profile: DecideRiskProfile = "moderado";
  if (total <= 5) profile = "conservador";
  else if (total >= 10) profile = "dinamico";

  return profile;
}

/** Grava o perfil após confirmar o MiFID (e mantém alinhado com o modelo recomendado). */
export function persistOnboardingRiskProfile(profile: DecideRiskProfile): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(LS_RISK_PROFILE, profile);
    try {
      window.dispatchEvent(new Event("decide_onboarding_risk_profile_changed"));
    } catch {
      /* ignore */
    }
  } catch {
    /* ignore */
  }
}

/**
 * Perfil por defeito: chave dedicada; senão recalcula a partir de `decide_onboarding_mifid_fields_v1`
 * se o passo MiFID estiver concluído.
 */
export function readDefaultRiskProfileFromOnboarding(): DecideRiskProfile | null {
  if (typeof window === "undefined") return null;
  try {
    const quick = localStorage.getItem(LS_RISK_PROFILE);
    if (quick === "conservador" || quick === "moderado" || quick === "dinamico") {
      return quick;
    }
  } catch {
    /* ignore */
  }

  try {
    if (localStorage.getItem(LS_MIFID_STEP_DONE) !== "1") return null;
    const raw = localStorage.getItem(LS_MIFID_FIELDS);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    return computeRiskProfileFromMifidFieldsPayload(parsed);
  } catch {
    return null;
  }
}
