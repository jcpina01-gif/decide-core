import React, { useEffect, useMemo, useState } from "react";
import Head from "next/head";
import OnboardingFlowBar, {
  ONBOARDING_STORAGE_KEYS,
  ONBOARDING_MONTANTE_KEY,
} from "../components/OnboardingFlowBar";

type RiskProfile = "conservador" | "moderado" | "dinamico";

type ExperienceTier = "" | "pouca" | "alguma" | "muita";

function inferExperienceTier(
  a: number | "",
  p: string,
  o: number | "",
): ExperienceTier {
  if (typeof a !== "number" || !p || typeof o !== "number") return "";
  if (a === 1 && p === "poucos" && o === 3) return "pouca";
  if (a === 3 && p === "alguns" && o === 12) return "alguma";
  if (a === 7 && p === "muitos" && o === 25) return "muita";
  return "";
}

const MIFID_WIZARD_STEP_KEY = "decide_mifid_wizard_step_v1";
/** Último sub-passo concluído com «Continuar» (1–3). Ao retroceder, reduz-se para não mostrar verde no passo em edição. */
const MIFID_WIZARD_MAX_DONE_KEY = "decide_mifid_wizard_max_done_v1";

/** Campos MiFID do passo 1 (preenchidos via nível de experiência). */
const STEP1_MISSING_LABELS = new Set([
  "Anos de experiência",
  "Nº de tipos de produtos",
  "Operações por ano",
]);
const STEP2_MISSING_LABELS = new Set(["Compreende volatilidade", "Compreende drawdown"]);
const STEP3_MISSING_LABELS = new Set([
  "Perda máxima aceitável (%)",
  "Objetivo",
  "Horizonte (anos)",
  "Necessidade de liquidez",
  "Rendimentos estáveis",
  "Património financeiro (€)",
  "Montante do Registo",
]);

function profileLabelPt(p: RiskProfile): string {
  if (p === "conservador") return "Conservador";
  if (p === "moderado") return "Moderado";
  return "Dinâmico";
}

function profileExplanationPt(p: RiskProfile): string {
  if (p === "conservador") {
    return "Perfil com menor tolerância a oscilações. Foco em preservação de capital e estabilidade.";
  }
  if (p === "moderado") {
    return "Equilíbrio entre risco e retorno, com horizonte médio. Aceita alguma volatilidade dos mercados.";
  }
  return "Aceita volatilidade e procura crescimento ao longo do tempo, com tolerância a oscilações mais acentuadas.";
}

function sectionStyle(): React.CSSProperties {
  return {
    background: "#020b24",
    border: "1px solid #15305b",
    borderRadius: 22,
    padding: 20,
  };
}

function inputStyle(): React.CSSProperties {
  return {
    width: "100%",
    background: "#020816",
    color: "#fff",
    border: "1px solid #15305b",
    borderRadius: 12,
    padding: 12,
    fontSize: 16,
    outline: "none",
  };
}

export default function MifidTestPage() {
  const [anosExperiencia, setAnosExperiencia] = useState<number | "">("");
  const [nProdutos, setNProdutos] = useState("");
  const [nOperacoesAno, setNOperacoesAno] = useState<number | "">("");
  const [entendeVolatilidade, setEntendeVolatilidade] = useState("");
  const [entendeDrawdown, setEntendeDrawdown] = useState("");
  const [aceitaPerda, setAceitaPerda] = useState<number | "">("");
  const [objetivo, setObjetivo] = useState("");
  const [horizonte, setHorizonte] = useState<number | "">("");
  const [liquidez, setLiquidez] = useState("");
  const [rendimentosEstaveis, setRendimentosEstaveis] = useState("");
  const [patrimonio, setPatrimonio] = useState<number | "">("");
  const [montante, setMontante] = useState<number | "">("");
  const [experienceTier, setExperienceTier] = useState<ExperienceTier>("");

  const [confirmAttempted, setConfirmAttempted] = useState(false);
  const [wizardStep, setWizardStep] = useState(1);
  /** Sub-passos já validados com «Continuar» (0 = nenhum, 1 = passo 1, …, 3 = até passo 3). */
  const [wizardMaxDone, setWizardMaxDone] = useState(0);
  /** Passo de onde o utilizador tentou avançar sem dados (para realçar campos). */
  const [attemptedFromStep, setAttemptedFromStep] = useState(0);

  const ONBOARDING_MIFID_FIELDS_KEY = "decide_onboarding_mifid_fields_v1";

  useEffect(() => {
    try {
      const s = sessionStorage.getItem(MIFID_WIZARD_STEP_KEY);
      let step = 1;
      if (s && /^[1-4]$/.test(s)) step = parseInt(s, 10);
      setWizardStep(step);
      const m = sessionStorage.getItem(MIFID_WIZARD_MAX_DONE_KEY);
      const mn = m != null ? parseInt(m, 10) : NaN;
      if (Number.isFinite(mn) && mn >= 0 && mn <= 3) {
        setWizardMaxDone(Math.min(mn, Math.max(0, step - 1)));
      } else {
        setWizardMaxDone(Math.max(0, step - 1));
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    try {
      sessionStorage.setItem(MIFID_WIZARD_STEP_KEY, String(wizardStep));
    } catch {
      // ignore
    }
  }, [wizardStep]);

  useEffect(() => {
    try {
      sessionStorage.setItem(MIFID_WIZARD_MAX_DONE_KEY, String(wizardMaxDone));
    } catch {
      // ignore
    }
  }, [wizardMaxDone]);

  useEffect(() => {
    // Se o utilizador voltar ao MiFID, invalida a preparação IBKR anterior.
    try {
      window.localStorage.setItem("decide_onboarding_ibkr_prep_done_v1", "0");
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    // Montante vem do passo 1 (registo montante) e não deve ser pedido novamente.
    try {
      const raw = window.localStorage.getItem(ONBOARDING_MONTANTE_KEY);
      if (!raw) return;
      const n = Number(raw);
      if (Number.isFinite(n) && n > 0) setMontante(n);
    } catch {
      // ignore
    }
  }, []);

  function coerceNumOrBlank(x: unknown): number | "" {
    const n = typeof x === "number" ? x : Number(x);
    return Number.isFinite(n) && n > 0 ? n : "";
  }

  // Pré-carregar campos guardados se o utilizador voltar a esta página.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(ONBOARDING_MIFID_FIELDS_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      setAnosExperiencia(coerceNumOrBlank(parsed?.anosExperiencia));
      setNProdutos(typeof parsed?.nProdutos === "string" ? parsed.nProdutos : "");
      setNOperacoesAno(coerceNumOrBlank(parsed?.nOperacoesAno));
      setEntendeVolatilidade(typeof parsed?.entendeVolatilidade === "string" ? parsed.entendeVolatilidade : "");
      setEntendeDrawdown(typeof parsed?.entendeDrawdown === "string" ? parsed.entendeDrawdown : "");
      setAceitaPerda(coerceNumOrBlank(parsed?.aceitaPerda));
      setObjetivo(typeof parsed?.objetivo === "string" ? parsed.objetivo : "");
      setHorizonte(coerceNumOrBlank(parsed?.horizonte));
      setLiquidez(typeof parsed?.liquidez === "string" ? parsed.liquidez : "");
      setRendimentosEstaveis(typeof parsed?.rendimentosEstaveis === "string" ? parsed.rendimentosEstaveis : "");
      setPatrimonio(coerceNumOrBlank(parsed?.patrimonio));
      const et = parsed?.experienceTier;
      let tier: ExperienceTier = "";
      if (et === "pouca" || et === "alguma" || et === "muita") {
        tier = et;
      } else {
        const a = coerceNumOrBlank(parsed?.anosExperiencia);
        const p = typeof parsed?.nProdutos === "string" ? parsed.nProdutos : "";
        const o = coerceNumOrBlank(parsed?.nOperacoesAno);
        tier = inferExperienceTier(
          typeof a === "number" ? a : "",
          p,
          typeof o === "number" ? o : "",
        );
      }
      setExperienceTier(tier);
    } catch {
      // ignore
    }
    // Load once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function parseRequiredNumber(next: string): number | "" {
    const t = next.trim();
    if (!t) return "";
    const n = Number(t);
    return Number.isFinite(n) ? n : "";
  }

  function hasValueString(v: string): boolean {
    return v.trim().length > 0;
  }

  const result = useMemo(() => {
    const anosExpNum = typeof anosExperiencia === "number" ? anosExperiencia : 0;
    const nOperacoesNum = typeof nOperacoesAno === "number" ? nOperacoesAno : 0;
    const aceitaPerdaNum = typeof aceitaPerda === "number" ? aceitaPerda : 0;
    const horizonteNum = typeof horizonte === "number" ? horizonte : 0;
    const patrimonioNum = typeof patrimonio === "number" ? patrimonio : 0;
    const montanteNum = typeof montante === "number" ? montante : 0;

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

    if (!mifidComplete) {
      return {
        knowledgeScore: 0,
        riskScore: 0,
        total: 0,
        profile: "moderado" as RiskProfile,
        investmentRatio: 0,
        warnings: [] as string[],
        mifidComplete: false,
      };
    }

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

    const investimentoSobrePatrimonio = patrimonioNum > 0 ? montanteNum / patrimonioNum : 0;

    let profile: RiskProfile = "moderado";
    const total = knowledgeScore + riskScore;

    if (total <= 5) profile = "conservador";
    else if (total >= 10) profile = "dinamico";

    const warnings: string[] = [];
    if (knowledgeScore <= 2) {
      warnings.push("Conhecimento/experiência limitada para produtos de maior risco.");
    }
    if (investimentoSobrePatrimonio > 0.7) {
      warnings.push("Montante proposto demasiado elevado face ao património financeiro.");
    }
    if (liquidez === "alta" && horizonteNum >= 7) {
      warnings.push("Necessidade de liquidez elevada não é consistente com horizonte longo.");
    }

    return {
      knowledgeScore,
      riskScore,
      total,
      profile,
      investmentRatio: investimentoSobrePatrimonio,
      warnings,
    };
  }, [
    anosExperiencia,
    nProdutos,
    nOperacoesAno,
    entendeVolatilidade,
    entendeDrawdown,
    aceitaPerda,
    objetivo,
    horizonte,
    liquidez,
    rendimentosEstaveis,
    patrimonio,
    montante,
  ]);

  const missingMifidFields = useMemo(() => {
    const anosExpNum = typeof anosExperiencia === "number" ? anosExperiencia : 0;
    const nOperacoesNum = typeof nOperacoesAno === "number" ? nOperacoesAno : 0;
    const aceitaPerdaNum = typeof aceitaPerda === "number" ? aceitaPerda : 0;
    const horizonteNum = typeof horizonte === "number" ? horizonte : 0;
    const patrimonioNum = typeof patrimonio === "number" ? patrimonio : 0;
    const montanteNum = typeof montante === "number" ? montante : 0;

    const missing: string[] = [];
    if (!(anosExpNum > 0)) missing.push("Anos de experiência");
    if (!hasValueString(nProdutos)) missing.push("Nº de tipos de produtos");
    if (!(nOperacoesNum > 0)) missing.push("Operações por ano");
    if (!hasValueString(entendeVolatilidade)) missing.push("Compreende volatilidade");
    if (!hasValueString(entendeDrawdown)) missing.push("Compreende drawdown");
    if (!(aceitaPerdaNum > 0)) missing.push("Perda máxima aceitável (%)");
    if (!hasValueString(objetivo)) missing.push("Objetivo");
    if (!(horizonteNum > 0)) missing.push("Horizonte (anos)");
    if (!hasValueString(liquidez)) missing.push("Necessidade de liquidez");
    if (!hasValueString(rendimentosEstaveis)) missing.push("Rendimentos estáveis");
    if (!(patrimonioNum > 0)) missing.push("Património financeiro (€)");
    if (!(montanteNum > 0)) missing.push("Montante do Registo");
    // Exige escolha explícita de nível quando os três indicadores já estão preenchidos (ex.: dados antigos).
    const trioOk = anosExpNum > 0 && hasValueString(nProdutos) && nOperacoesNum > 0;
    if (!experienceTier && trioOk) missing.push("Nível de experiência");
    return missing;
  }, [
    experienceTier,
    anosExperiencia,
    nProdutos,
    nOperacoesAno,
    entendeVolatilidade,
    entendeDrawdown,
    aceitaPerda,
    objetivo,
    horizonte,
    liquidez,
    rendimentosEstaveis,
    patrimonio,
    montante,
  ]);

  const canConfirmMifid = missingMifidFields.length === 0;
  const missingSet = useMemo(() => new Set(missingMifidFields), [missingMifidFields]);

  const step1MissingFields = useMemo(() => {
    if (!experienceTier) return ["Nível de experiência"];
    return [];
  }, [experienceTier]);
  const step2MissingFields = useMemo(
    () => missingMifidFields.filter((x) => STEP2_MISSING_LABELS.has(x)),
    [missingMifidFields],
  );
  const step3MissingFields = useMemo(
    () => missingMifidFields.filter((x) => STEP3_MISSING_LABELS.has(x)),
    [missingMifidFields],
  );
  const step3ReadyForSummary = step3MissingFields.length === 0;

  /** Uma só resposta no UI quando ambos os campos MiFID coincidem (passo 2 fundido). */
  const mercadosConfortoUnificado = useMemo(() => {
    if (entendeVolatilidade && entendeVolatilidade === entendeDrawdown) return entendeVolatilidade;
    return "";
  }, [entendeVolatilidade, entendeDrawdown]);

  const aceitaPerdaNumLive = typeof aceitaPerda === "number" ? aceitaPerda : 0;
  const lossZero =
    aceitaPerda === "" || aceitaPerdaNumLive <= 0;

  function fieldStyleIfMissing(missingKey: string): React.CSSProperties {
    const stepErr =
      (attemptedFromStep === 1 && STEP1_MISSING_LABELS.has(missingKey)) ||
      (attemptedFromStep === 2 && STEP2_MISSING_LABELS.has(missingKey)) ||
      (attemptedFromStep === 3 && STEP3_MISSING_LABELS.has(missingKey));
    const err = missingSet.has(missingKey) && (confirmAttempted || stepErr);
    return {
      ...inputStyle(),
      border: err ? "1px solid #f87171" : "1px solid #15305b",
      boxShadow: err ? "0 0 0 3px rgba(248,113,113,0.14)" : "none",
    };
  }

  function tryWizardNext(fromStep: number) {
    if (fromStep === 1) {
      if (step1MissingFields.length > 0) {
        setAttemptedFromStep(1);
        return;
      }
      setAttemptedFromStep(0);
      setWizardMaxDone((m) => Math.max(m, 1));
      setWizardStep(2);
      return;
    }
    if (fromStep === 2) {
      if (step2MissingFields.length > 0) {
        setAttemptedFromStep(2);
        return;
      }
      setAttemptedFromStep(0);
      setWizardMaxDone((m) => Math.max(m, 2));
      setWizardStep(3);
      return;
    }
    if (fromStep === 3) {
      // Só valida campos do passo 3 aqui. `canConfirmMifid` pode falhar por motivos fora deste ecrã
      // (ex.: nível de experiência) — bloquear aqui sem mensagem gerava clique “morto”.
      if (step3MissingFields.length > 0) {
        setAttemptedFromStep(3);
        setConfirmAttempted(true);
        return;
      }
      setAttemptedFromStep(0);
      setWizardMaxDone((m) => Math.max(m, 3));
      setWizardStep(4);
    }
  }

  function wizardBack() {
    setAttemptedFromStep(0);
    const next = Math.max(1, wizardStep - 1);
    setWizardMaxDone(Math.max(0, next - 1));
    setWizardStep(next);
  }

  function selectExperienceTier(tier: "pouca" | "alguma" | "muita") {
    setExperienceTier(tier);
    if (tier === "pouca") {
      setAnosExperiencia(1);
      setNProdutos("poucos");
      setNOperacoesAno(3);
    } else if (tier === "alguma") {
      setAnosExperiencia(3);
      setNProdutos("alguns");
      setNOperacoesAno(12);
    } else {
      setAnosExperiencia(7);
      setNProdutos("muitos");
      setNOperacoesAno(25);
    }
  }

  function confirmAndGoKyc() {
    setConfirmAttempted(true);
    if (!canConfirmMifid) return;
    try {
      // Gravar campos para voltar com a informação preenchida.
      window.localStorage.setItem(
        ONBOARDING_MIFID_FIELDS_KEY,
        JSON.stringify({
          experienceTier,
          anosExperiencia,
          nProdutos,
          nOperacoesAno,
          entendeVolatilidade,
          entendeDrawdown,
          aceitaPerda,
          objetivo,
          horizonte,
          liquidez,
          rendimentosEstaveis,
          patrimonio,
          montante,
        })
      );
      window.localStorage.setItem(ONBOARDING_STORAGE_KEYS.mifid, "1");
      // Identidade tem de ser reconfirmada após novo perfil; o passo 4 só fica OK após gravação no backend.
      window.localStorage.setItem(ONBOARDING_STORAGE_KEYS.kyc, "0");
    } catch {
      // ignore
    }
    window.location.href = "/persona-onboarding";
  }

  const btnPrimary: React.CSSProperties = {
    background: "linear-gradient(180deg, #7eb0ff 0%, #3558f5 100%)",
    color: "#fff",
    border: "2px solid rgba(255,255,255,0.35)",
    borderRadius: 14,
    padding: "14px 22px",
    fontSize: 16,
    fontWeight: 900,
    cursor: "pointer",
    boxShadow: "0 10px 28px rgba(53, 88, 245, 0.4)",
  };
  const btnPrimaryFull: React.CSSProperties = {
    ...btnPrimary,
    width: "100%",
    minHeight: 52,
    boxSizing: "border-box",
    display: "block",
  };
  const btnGhost: React.CSSProperties = {
    background: "rgba(148,163,184,0.1)",
    color: "#cbd5e1",
    border: "1px solid rgba(148,163,184,0.5)",
    borderRadius: 14,
    padding: "14px 20px",
    fontSize: 15,
    fontWeight: 800,
    cursor: "pointer",
  };
  /** Voltar: secundário, menos peso que o CTA (consistente em todos os passos). */
  const btnGhostSecondary: React.CSSProperties = {
    ...btnGhost,
    alignSelf: "flex-start",
    width: "auto",
    maxWidth: "100%",
    minHeight: 44,
    padding: "11px 18px",
    fontSize: 14,
    fontWeight: 700,
    background: "transparent",
    border: "1px solid rgba(148,163,184,0.4)",
  };
  const wizardActions: React.CSSProperties = {
    display: "flex",
    flexDirection: "column",
    gap: 12,
    marginTop: 24,
    width: "100%",
    alignItems: "stretch",
  };

  return (
    <>
      <Head>
        <title>DECIDE — Perfil de investidor</title>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>
      <div
        style={{
          minHeight: "100vh",
          background: "#000",
          color: "#fff",
          padding: "32px max(20px, 4vw)",
          fontFamily: "Inter, Arial, sans-serif",
        }}
      >
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: "clamp(28px, 4vw, 40px)", fontWeight: 800, lineHeight: 1.15 }}>Perfil de investidor</div>
          <div style={{ color: "#94a3b8", fontSize: 16, marginTop: 8, maxWidth: 560, lineHeight: 1.55 }}>
            Algumas perguntas para adequarmos o serviço ao seu perfil. Leva só alguns minutos.
          </div>
        </div>

        <OnboardingFlowBar currentStepId="mifid" authStepHref="/client/login" />

        <div style={{ marginBottom: 20 }}>
          <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
            {[1, 2, 3, 4].map((i) => {
              const completed = i < wizardStep && i <= wizardMaxDone;
              const active = i === wizardStep;
              const bg = completed ? "#22c55e" : active ? "#3b82f6" : "#1e293b";
              return (
                <div
                  key={i}
                  style={{
                    flex: 1,
                    height: 4,
                    borderRadius: 4,
                    background: bg,
                    transition: "background 0.2s ease",
                  }}
                />
              );
            })}
          </div>
          <div style={{ color: "#64748b", fontSize: 13, fontWeight: 700 }}>Passo {wizardStep} de 4</div>
        </div>

        {((wizardStep === 1 && !experienceTier) || (wizardStep === 3 && lossZero)) ? (
        <div
          style={{
            marginBottom: 20,
            padding: 16,
            borderRadius: 16,
            background: "rgba(251, 191, 36, 0.12)",
            border: "1px solid rgba(251, 191, 36, 0.45)",
            color: "#fef3c7",
            lineHeight: 1.6,
            fontSize: 14,
          }}
        >
          <div style={{ fontWeight: 900, marginBottom: 8, color: "#fde68a" }}>Antes de continuar</div>
          {wizardStep === 1 && !experienceTier ? (
            <div style={{ marginBottom: 6 }}>
              Escolha o nível de experiência que melhor o descreve — é rápido e ajuda-nos a adequar o serviço.
            </div>
          ) : null}
          {wizardStep === 3 && lossZero ? (
            <div>
              • <strong>Perda máxima aceitável (%)</strong> tem de ser <strong>maior que 0</strong>.
            </div>
          ) : null}
        </div>
      ) : null}

      <div style={{ maxWidth: 720, margin: "0 auto" }}>
        {wizardStep === 1 ? (
          <div style={sectionStyle()}>
            <div style={{ color: "#fff", fontSize: 22, fontWeight: 800, marginBottom: 8 }}>A sua experiência</div>
            <div style={{ color: "#94a3b8", fontSize: 14, marginBottom: 20, lineHeight: 1.55 }}>
              Indique o nível que melhor reflete a sua prática. Usamos isto para mapear anos, produtos e frequência de forma
              consistente com o questionário.
            </div>
            <div style={{ display: "grid", gap: 12 }}>
              {(
                [
                  {
                    id: "pouca" as const,
                    title: "Pouca experiência",
                    sub: "Estou a começar ou invisto poucas vezes por ano.",
                  },
                  {
                    id: "alguma" as const,
                    title: "Alguma experiência",
                    sub: "Já investi por algum tempo e conheço o essencial.",
                  },
                  {
                    id: "muita" as const,
                    title: "Muita experiência",
                    sub: "Invisto com regularidade e já utilizei vários tipos de produtos.",
                  },
                ] as const
              ).map(({ id, title, sub }) => {
                const selected = experienceTier === id;
                const err = attemptedFromStep === 1 && !experienceTier;
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => selectExperienceTier(id)}
                    style={{
                      textAlign: "left",
                      padding: 18,
                      borderRadius: 16,
                      border: err ? "1px solid rgba(248,113,113,0.55)" : selected ? "2px solid #60a5fa" : "1px solid #15305b",
                      background: selected ? "rgba(59,130,246,0.14)" : "#020816",
                      cursor: "pointer",
                      color: "#fff",
                      boxShadow: selected ? "0 0 0 3px rgba(59,130,246,0.22)" : err ? "0 0 0 3px rgba(248,113,113,0.12)" : "none",
                      transition: "border 0.15s ease, box-shadow 0.15s ease, background 0.15s ease",
                    }}
                  >
                    <div style={{ fontWeight: 900, fontSize: 16, marginBottom: 6 }}>{title}</div>
                    <div style={{ color: "#94a3b8", fontSize: 14, lineHeight: 1.5 }}>{sub}</div>
                  </button>
                );
              })}
            </div>
            {attemptedFromStep === 1 && !experienceTier ? (
              <div
                style={{
                  marginTop: 16,
                  background: "#2a0a0a",
                  border: "1px solid #7f1d1d",
                  borderRadius: 14,
                  padding: 14,
                  color: "#fee2e2",
                  fontSize: 14,
                  lineHeight: 1.5,
                }}
              >
                Selecione uma das opções acima para continuar.
              </div>
            ) : null}
            <div style={wizardActions}>
              <button type="button" onClick={() => tryWizardNext(1)} style={btnPrimaryFull}>
                Continuar
              </button>
            </div>
          </div>
        ) : null}

        {wizardStep === 2 ? (
          <div style={sectionStyle()}>
            <div style={{ color: "#fff", fontSize: 22, fontWeight: 800, marginBottom: 8 }}>Como lê os mercados</div>
            <div style={{ color: "#94a3b8", fontSize: 14, marginBottom: 20, lineHeight: 1.55 }}>
              Oscilações no dia a dia e perdas temporárias fazem parte do investimento. Indique o que melhor o descreve.
            </div>
            <div>
              <div style={{ color: "#9fb3d1", marginBottom: 8 }}>
                Sente-se confortável com oscilações e com possíveis perdas temporárias antes de recuperação?
              </div>
              <select
                value={mercadosConfortoUnificado}
                onChange={(e) => {
                  const v = e.target.value;
                  setEntendeVolatilidade(v);
                  setEntendeDrawdown(v);
                }}
                style={(() => {
                  const step2Err =
                    (missingSet.has("Compreende volatilidade") || missingSet.has("Compreende drawdown")) &&
                    (confirmAttempted || attemptedFromStep === 2);
                  return {
                    ...inputStyle(),
                    border: step2Err ? "1px solid #f87171" : "1px solid #15305b",
                    boxShadow: step2Err ? "0 0 0 3px rgba(248,113,113,0.14)" : "none",
                  };
                })()}
              >
                <option value="">Selecionar…</option>
                <option value="sim">Sim</option>
                <option value="nao">Não</option>
              </select>
            </div>
            <div style={wizardActions}>
              <button type="button" onClick={wizardBack} style={btnGhostSecondary}>
                Voltar
              </button>
              <button type="button" onClick={() => tryWizardNext(2)} style={btnPrimaryFull}>
                Continuar
              </button>
            </div>
          </div>
        ) : null}

        {wizardStep === 3 ? (
          <div style={sectionStyle()}>
            <div style={{ color: "#fff", fontSize: 22, fontWeight: 800, marginBottom: 8 }}>Os seus objetivos</div>
            <div style={{ color: "#94a3b8", fontSize: 14, marginBottom: 20, lineHeight: 1.55 }}>
              Tolerância a perdas, horizonte e situação financeira ajudam-nos a adequar o serviço.
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              <div>
                <div style={{ color: "#9fb3d1", marginBottom: 8 }}>Perda máxima aceitável (%)</div>
                <input
                  type="number"
                  value={aceitaPerda}
                  onChange={(e) => setAceitaPerda(parseRequiredNumber(e.target.value))}
                  style={fieldStyleIfMissing("Perda máxima aceitável (%)")}
                />
              </div>
              <div>
                <div style={{ color: "#9fb3d1", marginBottom: 8 }}>Objetivo principal</div>
                <select value={objetivo} onChange={(e) => setObjetivo(e.target.value)} style={fieldStyleIfMissing("Objetivo")}>
                  <option value="">Selecionar…</option>
                  <option value="preservacao">Preservação</option>
                  <option value="equilibrio">Equilíbrio</option>
                  <option value="crescimento">Crescimento</option>
                </select>
              </div>
              <div>
                <div style={{ color: "#9fb3d1", marginBottom: 8 }}>Horizonte de investimento (anos)</div>
                <input
                  type="number"
                  value={horizonte}
                  onChange={(e) => setHorizonte(parseRequiredNumber(e.target.value))}
                  style={fieldStyleIfMissing("Horizonte (anos)")}
                />
              </div>
              <div>
                <div style={{ color: "#9fb3d1", marginBottom: 8 }}>Necessidade de liquidez</div>
                <select value={liquidez} onChange={(e) => setLiquidez(e.target.value)} style={fieldStyleIfMissing("Necessidade de liquidez")}>
                  <option value="">Selecionar…</option>
                  <option value="baixa">Baixa</option>
                  <option value="media">Média</option>
                  <option value="alta">Alta</option>
                </select>
              </div>
              <div>
                <div style={{ color: "#9fb3d1", marginBottom: 8 }}>Rendimentos regulares estáveis</div>
                <select
                  value={rendimentosEstaveis}
                  onChange={(e) => setRendimentosEstaveis(e.target.value)}
                  style={fieldStyleIfMissing("Rendimentos estáveis")}
                >
                  <option value="">Selecionar…</option>
                  <option value="sim">Sim</option>
                  <option value="nao">Não</option>
                </select>
              </div>
              <div>
                <div style={{ color: "#9fb3d1", marginBottom: 8 }}>Património financeiro total (€)</div>
                <input
                  type="number"
                  value={patrimonio}
                  onChange={(e) => setPatrimonio(parseRequiredNumber(e.target.value))}
                  style={fieldStyleIfMissing("Património financeiro (€)")}
                />
              </div>
              <div style={{ gridColumn: "1 / -1" }}>
                <div style={{ color: "#9fb3d1", marginBottom: 8 }}>Valor a investir (confirmado no passo anterior)</div>
                <input
                  type="number"
                  value={montante}
                  disabled
                  style={{
                    ...fieldStyleIfMissing("Montante do Registo"),
                    opacity: 0.65,
                  }}
                />
              </div>
            </div>
            {(attemptedFromStep === 3 || confirmAttempted) && step3MissingFields.length > 0 ? (
              <div
                style={{
                  marginTop: 16,
                  background: "#2a0a0a",
                  border: "1px solid #7f1d1d",
                  borderRadius: 14,
                  padding: 14,
                  color: "#fee2e2",
                  fontSize: 14,
                  lineHeight: 1.5,
                }}
              >
                Falta completar: {step3MissingFields.join(" · ")}.
              </div>
            ) : null}
            {!step3ReadyForSummary ? (
              <div style={{ marginTop: 12, color: "#64748b", fontSize: 13, lineHeight: 1.5 }}>
                Preencha todos os campos obrigatórios deste passo para ver o resumo.
              </div>
            ) : null}
            <div style={wizardActions}>
              <button type="button" onClick={wizardBack} style={btnGhostSecondary}>
                Voltar
              </button>
              <button
                type="button"
                disabled={!step3ReadyForSummary}
                aria-disabled={!step3ReadyForSummary}
                title={!step3ReadyForSummary ? "Complete os campos em falta" : undefined}
                onClick={() => tryWizardNext(3)}
                style={{
                  ...btnPrimaryFull,
                  opacity: step3ReadyForSummary ? 1 : 0.48,
                  cursor: step3ReadyForSummary ? "pointer" : "not-allowed",
                  boxShadow: step3ReadyForSummary ? btnPrimary.boxShadow : "none",
                }}
              >
                Ver resumo
              </button>
            </div>
          </div>
        ) : null}

        {wizardStep === 4 && !canConfirmMifid ? (
          <div style={sectionStyle()}>
            <div style={{ color: "#fff", fontSize: 20, fontWeight: 800, marginBottom: 12 }}>Resumo indisponível</div>
            <p style={{ color: "#94a3b8", lineHeight: 1.6, marginBottom: 12 }}>
              Ainda faltam respostas para calcular o perfil. Volte aos passos anteriores para as completar.
            </p>
            {missingMifidFields.length > 0 ? (
              <div
                style={{
                  marginBottom: 20,
                  padding: 14,
                  borderRadius: 14,
                  background: "rgba(251, 191, 36, 0.1)",
                  border: "1px solid rgba(251, 191, 36, 0.4)",
                  color: "#fef3c7",
                  fontSize: 14,
                  lineHeight: 1.55,
                }}
              >
                <strong style={{ color: "#fde68a" }}>Em falta:</strong> {missingMifidFields.join(" · ")}
              </div>
            ) : null}
            <button type="button" onClick={() => setWizardStep(3)} style={btnPrimaryFull}>
              Voltar ao questionário
            </button>
          </div>
        ) : null}

        {wizardStep === 4 && canConfirmMifid ? (
          <div style={{ display: "grid", gap: 20 }}>
            <div style={sectionStyle()}>
              <div style={{ color: "#94a3b8", fontSize: 13, fontWeight: 700, marginBottom: 8 }}>O SEU PERFIL</div>
              <div style={{ color: "#fff", fontSize: 32, fontWeight: 900, marginBottom: 12 }}>{profileLabelPt(result.profile)}</div>
              <p style={{ color: "#cbd5e1", fontSize: 16, lineHeight: 1.65, margin: 0 }}>{profileExplanationPt(result.profile)}</p>
              <div
                style={{
                  marginTop: 18,
                  padding: 14,
                  borderRadius: 14,
                  background: "rgba(37,99,235,0.12)",
                  border: "1px solid rgba(59,130,246,0.35)",
                  color: "#bfdbfe",
                  fontSize: 15,
                  lineHeight: 1.55,
                }}
              >
                O valor que indicou investir representa cerca de{" "}
                <strong style={{ color: "#fff" }}>{(result.investmentRatio * 100).toFixed(1)}%</strong> do património financeiro
                indicado.
              </div>
            </div>

            <div style={sectionStyle()}>
              <div style={{ color: "#fff", fontSize: 18, fontWeight: 800, marginBottom: 12 }}>Resumo e validação</div>
              {result.warnings.length ? (
                <div
                  style={{
                    background: "#2a0a0a",
                    border: "1px solid #7f1d1d",
                    borderRadius: 14,
                    padding: 14,
                    color: "#fee2e2",
                  }}
                >
                  {result.warnings.map((warning, idx) => (
                    <div key={idx} style={{ marginBottom: 8 }}>
                      • {warning}
                    </div>
                  ))}
                </div>
              ) : (
                <div
                  style={{
                    background: "#052e1a",
                    border: "1px solid #166534",
                    borderRadius: 14,
                    padding: 14,
                    color: "#dcfce7",
                  }}
                >
                  Com base nas respostas, não foram detetados alertas críticos neste preenchimento.
                </div>
              )}
            </div>

            <details style={{ ...sectionStyle(), cursor: "pointer" }}>
              <summary style={{ color: "#94a3b8", fontWeight: 700, fontSize: 14 }}>Detalhes do cálculo (opcional)</summary>
              <div style={{ marginTop: 14, color: "#64748b", fontSize: 13, lineHeight: 1.6 }}>
                <p style={{ margin: "0 0 10px" }}>
                  <strong style={{ color: "#94a3b8" }}>Regra interna do perfil (soma dos indicadores):</strong> até 5 → conservador · 6
                  a 9 → moderado · 10 ou mais → dinâmico. O resultado depende do conjunto das respostas.
                </p>
                <div style={{ color: "#cbd5e1" }}>
                  Indicador conhecimento: {result.knowledgeScore} · Indicador objetivo/risco: {result.riskScore} · Total: {result.total}
                </div>
              </div>
            </details>

            {confirmAttempted && missingMifidFields.length > 0 ? (
              <div
                style={{
                  background: "#2a0a0a",
                  border: "1px solid #7f1d1d",
                  borderRadius: 14,
                  padding: 14,
                  color: "#fee2e2",
                  lineHeight: 1.6,
                }}
              >
                Faltam preencher: {missingMifidFields.join(", ")}.
              </div>
            ) : null}

            <div style={{ ...wizardActions, marginTop: 0 }}>
              <button type="button" onClick={wizardBack} style={btnGhostSecondary}>
                Voltar e editar
              </button>
              <button
                type="button"
                onClick={confirmAndGoKyc}
                disabled={!canConfirmMifid}
                style={{
                  ...btnPrimaryFull,
                  opacity: canConfirmMifid ? 1 : 0.45,
                  cursor: canConfirmMifid ? "pointer" : "not-allowed",
                  boxShadow: canConfirmMifid ? btnPrimary.boxShadow : "none",
                }}
              >
                Continuar para verificação
              </button>
              <div style={{ color: "#64748b", fontSize: 12, lineHeight: 1.5, textAlign: "center" }}>
                Seguimos agora para a verificação de identidade. A ligação à corretora fica num passo posterior.
              </div>
            </div>
          </div>
        ) : null}
      </div>
      </div>
    </>
  );
}