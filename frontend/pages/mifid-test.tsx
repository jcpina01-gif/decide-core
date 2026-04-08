import React, { useEffect, useMemo, useState } from "react";
import Head from "next/head";
import { useRouter } from "next/router";
import OnboardingFlowBar, {
  ONBOARDING_STORAGE_KEYS,
  ONBOARDING_MONTANTE_KEY,
} from "../components/OnboardingFlowBar";
import { DECIDE_CLIENT, ONBOARDING_PRIMARY_CTA_MAX_WIDTH_PX } from "../lib/decideClientTheme";
import { persistOnboardingRiskProfile } from "../lib/decideOnboardingRiskProfile";
import { getNextOnboardingHref } from "../lib/onboardingProgress";

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

/** Normaliza o JSON gravado para comparar confirmações — evita invalidar KYC quando o utilizador só reconfirma o mesmo perfil. */
function normalizeMifidSnapshotForCompare(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const num = (x: unknown): number | "" => {
    const n = typeof x === "number" ? x : Number(x);
    return Number.isFinite(n) && n > 0 ? n : "";
  };
  const anos = num(o.anosExperiencia);
  const nProd = typeof o.nProdutos === "string" ? o.nProdutos.trim() : String(o.nProdutos ?? "").trim();
  const nOp = num(o.nOperacoesAno);
  let tier: ExperienceTier = "";
  if (o.experienceTier === "pouca" || o.experienceTier === "alguma" || o.experienceTier === "muita") {
    tier = o.experienceTier;
  } else {
    tier = inferExperienceTier(
      typeof anos === "number" ? anos : "",
      nProd,
      typeof nOp === "number" ? nOp : "",
    );
  }
  return {
    experienceTier: tier,
    anosExperiencia: anos,
    nProdutos: nProd,
    nOperacoesAno: nOp,
    entendeVolatilidade: typeof o.entendeVolatilidade === "string" ? o.entendeVolatilidade.trim() : "",
    entendeDrawdown: typeof o.entendeDrawdown === "string" ? o.entendeDrawdown.trim() : "",
    aceitaPerda: num(o.aceitaPerda),
    objetivo: typeof o.objetivo === "string" ? o.objetivo.trim() : "",
    horizonte: num(o.horizonte),
    liquidez: typeof o.liquidez === "string" ? o.liquidez.trim() : "",
    rendimentosEstaveis: typeof o.rendimentosEstaveis === "string" ? o.rendimentosEstaveis.trim() : "",
    patrimonio: num(o.patrimonio),
    montante: num(o.montante),
  };
}

function mifidPayloadsMateriallyEqual(a: unknown, b: unknown): boolean {
  const na = normalizeMifidSnapshotForCompare(a);
  const nb = normalizeMifidSnapshotForCompare(b);
  if (!na || !nb) return false;
  return JSON.stringify(na) === JSON.stringify(nb);
}

/** v3: assistente em 6 passos (objetivos em dois ecrãs). */
const MIFID_WIZARD_STEP_KEY = "decide_mifid_wizard_step_v3";
/** Último sub-passo concluído com «Continuar» (1–5 antes do resumo). */
const MIFID_WIZARD_MAX_DONE_KEY = "decide_mifid_wizard_max_done_v3";
/** Total de passos do assistente (sempre alinhado com a barra e «Passo X de Y»). */
const MIFID_WIZARD_TOTAL_STEPS = 6;
/** Largura útil maior que o shell onboarding por defeito — cartões MiFID em linha (passos 4–5). */
const MIFID_PAGE_MAX_WIDTH_PX = 1520;

function parseWizardStepFromQuery(stepStr: string | undefined): number | null {
  if (typeof stepStr !== "string" || !/^\d{1,2}$/.test(stepStr.trim())) return null;
  const n = parseInt(stepStr, 10);
  if (n >= 1 && n <= MIFID_WIZARD_TOTAL_STEPS) return n;
  return null;
}

/** Campos MiFID do passo 1 (preenchidos via nível de experiência). */
const STEP1_MISSING_LABELS = new Set([
  "Anos de experiência",
  "Nº de tipos de produtos",
  "Operações por ano",
]);
const STEP_VOL_MISSING_LABELS = new Set(["Compreende volatilidade"]);
const STEP_DD_MISSING_LABELS = new Set(["Compreende drawdown"]);
const STEP_OBJ4A_MISSING_LABELS = new Set([
  "Perda máxima aceitável (%)",
  "Objetivo",
  "Horizonte (anos)",
]);
const STEP_OBJ4B_MISSING_LABELS = new Set([
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
    return "Menor tolerância a oscilações; foco em estabilidade.";
  }
  if (p === "moderado") {
    return "Equilíbrio entre risco e retorno; aceita alguma volatilidade.";
  }
  return "Maior tolerância a oscilações; orientado a crescimento ao longo do tempo.";
}

function objetivoLabelPt(v: string): string {
  if (v === "preservacao") return "preservação de capital";
  if (v === "equilibrio") return "equilíbrio entre risco e retorno";
  if (v === "crescimento") return "crescimento";
  return v;
}

/** Uma linha — passo 6 (sem scroll excessivo). */
function mifidWhyCompactOneLine(args: {
  objetivo: string;
  horizonteNum: number;
  aceitaPerdaNum: number;
}): string {
  const { objetivo, horizonteNum, aceitaPerdaNum } = args;
  const parts: string[] = [];
  if (objetivo.trim().length > 0) {
    if (objetivo === "preservacao") parts.push("Preservação de capital");
    else if (objetivo === "equilibrio") parts.push("Equilíbrio risco/retorno");
    else if (objetivo === "crescimento") parts.push("Crescimento");
    else parts.push(objetivoLabelPt(objetivo));
  }
  if (horizonteNum > 0) {
    parts.push(`Horizonte ${horizonteNum} anos`);
  }
  if (aceitaPerdaNum > 0) {
    parts.push(`Quedas até ~${aceitaPerdaNum}%`);
  }
  return parts.join(" · ");
}

/** Significado prático numa linha — passo 6 compacto. */
function profilePracticalOneLinePt(p: RiskProfile): string {
  if (p === "conservador") {
    return "Instrumentos mais estáveis · Oscilações mais contidas · Foco em preservação";
  }
  if (p === "moderado") {
    return "Equilíbrio risco/retorno · Volatilidade moderada · Crescimento alinhado ao horizonte";
  }
  return "Mais exposição a ações · Volatilidade a curto prazo · Potencial a longo prazo";
}

function sectionStyle(): React.CSSProperties {
  return {
    background: DECIDE_CLIENT.cardGradient,
    border: DECIDE_CLIENT.cardBorder,
    borderRadius: 18,
    padding: 16,
    boxShadow: DECIDE_CLIENT.cardShadow,
  };
}

function inputStyle(): React.CSSProperties {
  return {
    width: "100%",
    background: DECIDE_CLIENT.inputBg,
    color: DECIDE_CLIENT.text,
    border: DECIDE_CLIENT.inputBorder,
    borderRadius: 12,
    padding: 12,
    fontSize: 16,
    outline: "none",
  };
}

/** Passo 4 — cartões; valores numéricos mantêm o cálculo de perfil existente. */
const MIFID_LOSS_CARD_CHOICES = [
  { id: "p10" as const, label: "Até 10%", sub: "Quedas moderadas; maior foco em estabilidade.", value: 8 },
  { id: "p20" as const, label: "Até 20%", sub: "Oscilações mais marcadas, com um limite claro.", value: 15 },
  { id: "p30" as const, label: "Até 30%", sub: "Tolerância elevada a períodos difíceis.", value: 30 },
  { id: "p35" as const, label: "Mais de 30%", sub: "Cenários de stress mais profundos antes de rever a estratégia.", value: 35 },
] as const;

function lossTierIdFromValue(n: number | ""): (typeof MIFID_LOSS_CARD_CHOICES)[number]["id"] | "" {
  if (typeof n !== "number" || !(n > 0)) return "";
  if (n <= 10) return "p10";
  if (n <= 20) return "p20";
  if (n <= 30) return "p30";
  return "p35";
}

const MIFID_OBJETIVO_CARDS = [
  {
    id: "preservacao" as const,
    label: "Preservação de capital",
    sub: "Prioridade em limitar perdas; retorno mais modesto.",
  },
  {
    id: "equilibrio" as const,
    label: "Equilíbrio",
    sub: "Combinar crescimento com alguma estabilidade.",
  },
  {
    id: "crescimento" as const,
    label: "Crescimento",
    sub: "Aceitar mais volatilidade em troca de potencial de valorização.",
  },
] as const;

const MIFID_HORIZONTE_CARDS = [
  { id: "h1" as const, label: "Menos de 4 anos", sub: "Pode precisar do dinheiro a médio prazo.", value: 3 },
  { id: "h2" as const, label: "4 a 7 anos", sub: "Horizonte intermédio para o seu projecto.", value: 5 },
  { id: "h3" as const, label: "7 anos ou mais", sub: "Pode manter o investimento alinhado no tempo.", value: 8 },
] as const;

function horizonteTierFromValue(n: number | ""): (typeof MIFID_HORIZONTE_CARDS)[number]["id"] | "" {
  if (typeof n !== "number" || !(n > 0)) return "";
  if (n < 4) return "h1";
  if (n < 7) return "h2";
  return "h3";
}

const MIFID_LIQUIDEZ_CARDS = [
  { id: "baixa" as const, label: "Baixa", sub: "Sem necessidade urgente de levantar o dinheiro." },
  { id: "media" as const, label: "Média", sub: "Pode precisar de parte do valor ocasionalmente." },
  { id: "alta" as const, label: "Alta", sub: "A liquidez frequente é importante para si." },
] as const;

const MIFID_PATRIMONIO_CARDS = [
  { id: "pat1" as const, label: "Até 50 000 €", sub: "Ordem de grandeza do património financeiro total.", value: 40_000 },
  { id: "pat2" as const, label: "50 000 € a 100 000 €", sub: "Estimativa por intervalos — não precisa do valor exacto.", value: 75_000 },
  { id: "pat3" as const, label: "100 000 € a 500 000 €", sub: "Útil para dimensionar o risco face ao seu contexto.", value: 250_000 },
  { id: "pat4" as const, label: "Mais de 500 000 €", sub: "Património elevado; mantemos a mesma lógica de perfil.", value: 750_000 },
] as const;

function patrimonioTierFromValue(n: number | ""): (typeof MIFID_PATRIMONIO_CARDS)[number]["id"] | "" {
  if (typeof n !== "number" || !(n > 0)) return "";
  if (n < 50_000) return "pat1";
  if (n < 100_000) return "pat2";
  if (n < 500_000) return "pat3";
  return "pat4";
}

function experienceTierShortPt(tier: ExperienceTier): string {
  if (tier === "pouca") return "Pouca experiência";
  if (tier === "alguma") return "Alguma experiência";
  if (tier === "muita") return "Muita experiência";
  return "";
}

/** Resumo único das escolhas já feitas — feedback global no rodapé do cartão. */
function buildPerfilAtualLine(args: {
  experienceTier: ExperienceTier;
  entendeVolatilidade: string;
  entendeDrawdown: string;
  aceitaPerda: number | "";
  objetivo: string;
  horizonte: number | "";
  liquidez: string;
  rendimentosEstaveis: string;
  patrimonio: number | "";
  montante: number | "";
}): string | null {
  const parts: string[] = [];
  const ex = experienceTierShortPt(args.experienceTier);
  if (ex) parts.push(ex);
  if (args.entendeVolatilidade === "sim") parts.push("Curto prazo: confortável com variações");
  else if (args.entendeVolatilidade === "nao") parts.push("Curto prazo: prefere menos oscilação");
  if (args.entendeDrawdown === "sim") parts.push("Quedas temporárias: compreende o risco");
  else if (args.entendeDrawdown === "nao") parts.push("Quedas temporárias: menor tolerância");
  if (typeof args.aceitaPerda === "number" && args.aceitaPerda > 0) {
    const lid = lossTierIdFromValue(args.aceitaPerda);
    const lc = MIFID_LOSS_CARD_CHOICES.find((c) => c.id === lid);
    parts.push(lc ? `Tolerância ${lc.label}` : `Tolerância até ${args.aceitaPerda}%`);
  }
  if (args.objetivo) {
    const o = MIFID_OBJETIVO_CARDS.find((c) => c.id === args.objetivo);
    parts.push(o ? o.label : objetivoLabelPt(args.objetivo));
  }
  if (typeof args.horizonte === "number" && args.horizonte > 0) {
    const hid = horizonteTierFromValue(args.horizonte);
    const h = MIFID_HORIZONTE_CARDS.find((c) => c.id === hid);
    parts.push(h ? `Horizonte: ${h.label}` : `Horizonte ${args.horizonte} anos`);
  }
  if (args.liquidez) {
    const L = MIFID_LIQUIDEZ_CARDS.find((c) => c.id === args.liquidez);
    parts.push(L ? `Liquidez: ${L.label}` : `Liquidez ${args.liquidez}`);
  }
  if (args.rendimentosEstaveis === "sim") parts.push("Rendimentos regulares: sim");
  else if (args.rendimentosEstaveis === "nao") parts.push("Rendimentos regulares: foco em valorização");
  if (typeof args.patrimonio === "number" && args.patrimonio > 0) {
    const pid = patrimonioTierFromValue(args.patrimonio);
    const p = MIFID_PATRIMONIO_CARDS.find((c) => c.id === pid);
    parts.push(p ? `Património ${p.label}` : "Património indicado");
  }
  if (typeof args.montante === "number" && args.montante > 0) {
    parts.push(`Montante a investir ${args.montante.toLocaleString("pt-PT")} €`);
  }
  if (parts.length === 0) return null;
  return parts.join(" • ");
}

/** Passo 5 — resumo em lista (liquidez, rendimento, património, montante). */
function buildResumoAtualLinhas(args: {
  liquidez: string;
  rendimentosEstaveis: string;
  patrimonio: number | "";
  montante: number | "";
}): { label: string; value: string }[] {
  const out: { label: string; value: string }[] = [];
  if (args.liquidez) {
    const L = MIFID_LIQUIDEZ_CARDS.find((c) => c.id === args.liquidez);
    out.push({ label: "Liquidez", value: L?.label ?? args.liquidez });
  }
  if (args.rendimentosEstaveis === "sim") {
    out.push({ label: "Rendimento", value: "Regular (complemento ou pagamentos periódicos)" });
  } else if (args.rendimentosEstaveis === "nao") {
    out.push({ label: "Rendimento", value: "Crescimento / valorização (sem dependência de rendimento regular)" });
  }
  if (typeof args.patrimonio === "number" && args.patrimonio > 0) {
    const pid = patrimonioTierFromValue(args.patrimonio);
    const p = MIFID_PATRIMONIO_CARDS.find((c) => c.id === pid);
    out.push({ label: "Património", value: p?.label ?? "—" });
  }
  if (typeof args.montante === "number" && args.montante > 0) {
    out.push({ label: "Montante a investir", value: `${args.montante.toLocaleString("pt-PT")} €` });
  }
  return out;
}

function mifidRendimentoCardStyle(selected: boolean, err: boolean, variant: "income" | "growth"): React.CSSProperties {
  const base = mifidChoiceCardBase(selected, err);
  if (err) return base;
  const income = variant === "income";
  return {
    ...base,
    background: selected
      ? income
        ? "rgba(251, 191, 36, 0.16)"
        : "rgba(16, 185, 129, 0.13)"
      : income
        ? "rgba(251, 191, 36, 0.07)"
        : "rgba(16, 185, 129, 0.07)",
    border: selected
      ? income
        ? "2px solid rgba(251, 191, 36, 0.78)"
        : "2px solid rgba(34, 197, 94, 0.72)"
      : income
        ? "1px solid rgba(251, 191, 36, 0.38)"
        : "1px solid rgba(34, 197, 94, 0.38)",
    boxShadow: selected
      ? income
        ? "0 0 0 3px rgba(251, 191, 36, 0.22), 0 0 26px rgba(251, 191, 36, 0.12)"
        : "0 0 0 3px rgba(34, 197, 94, 0.2), 0 0 28px rgba(16, 185, 129, 0.14)"
      : "none",
    transform: selected ? "scale(1.012)" : "scale(1)",
  };
}

const mifidStep4BlockTitle: React.CSSProperties = {
  color: "#f1f5f9",
  fontSize: 12,
  fontWeight: 800,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  marginBottom: 6,
  marginTop: 0,
};

const mifidChoiceInlineRow: React.CSSProperties = {
  display: "flex",
  flexDirection: "row",
  flexWrap: "nowrap",
  gap: 8,
  width: "100%",
  alignItems: "stretch",
};

const mifidChoiceInlineBtn: React.CSSProperties = {
  flex: "1 1 0",
  minWidth: 0,
  boxSizing: "border-box",
};

const mifidChoiceCardBase = (selected: boolean, err: boolean): React.CSSProperties => ({
  textAlign: "left",
  padding: "10px 12px",
  borderRadius: 14,
  border: err
    ? "1px solid rgba(248,113,113,0.55)"
    : selected
      ? "2px solid rgba(45, 212, 191, 0.85)"
      : DECIDE_CLIENT.panelBorder,
  background: selected ? "rgba(45, 212, 191, 0.14)" : DECIDE_CLIENT.inputBg,
  cursor: "pointer",
  color: DECIDE_CLIENT.text,
  boxShadow: selected
    ? "0 0 0 3px rgba(45, 212, 191, 0.28), 0 0 28px rgba(45, 212, 191, 0.18)"
    : err
      ? "0 0 0 3px rgba(248,113,113,0.12)"
      : "none",
  transform: selected ? "scale(1.012)" : "scale(1)",
  transition:
    "border 0.2s ease, box-shadow 0.28s ease, background 0.2s ease, transform 0.22s cubic-bezier(0.34, 1.45, 0.64, 1)",
});

export default function MifidTestPage() {
  const router = useRouter();
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
  /** `decide_onboarding_step2_done` — passo MiFID concluído no funil (perfil já confirmado alguma vez). */
  const [mifidPreviouslyConfirmed, setMifidPreviouslyConfirmed] = useState(false);
  const [wizardStep, setWizardStep] = useState(1);
  /** Sub-passos já validados com «Continuar» (0 = nenhum … 5 = segundo ecrã de objetivos antes do resumo). */
  const [wizardMaxDone, setWizardMaxDone] = useState(0);
  /** Passo de onde o utilizador tentou avançar sem dados (para realçar campos). */
  const [attemptedFromStep, setAttemptedFromStep] = useState(0);

  const ONBOARDING_MIFID_FIELDS_KEY = "decide_onboarding_mifid_fields_v1";

  /** Sincroniza passo interno: prioridade a `?step=` na URL, depois sessionStorage (retoma onde ficou). */
  useEffect(() => {
    if (!router.isReady) return;
    try {
      const raw = router.query.step;
      const stepStr = Array.isArray(raw) ? raw[0] : raw;
      const fromQuery = typeof stepStr === "string" ? parseWizardStepFromQuery(stepStr) : null;

      if (fromQuery != null) {
        setWizardStep(fromQuery);
        const m = sessionStorage.getItem(MIFID_WIZARD_MAX_DONE_KEY);
        const mn = m != null ? parseInt(m, 10) : NaN;
        if (Number.isFinite(mn) && mn >= 0 && mn <= MIFID_WIZARD_TOTAL_STEPS - 1) {
          setWizardMaxDone(Math.min(mn, Math.max(0, fromQuery - 1)));
        } else {
          setWizardMaxDone(Math.max(0, fromQuery - 1));
        }
        sessionStorage.setItem(MIFID_WIZARD_STEP_KEY, String(fromQuery));
        return;
      }

      const s = sessionStorage.getItem(MIFID_WIZARD_STEP_KEY);
      let step = 1;
      const parsed = s != null ? parseWizardStepFromQuery(s) : null;
      if (parsed != null) step = parsed;
      setWizardStep(step);
      const m = sessionStorage.getItem(MIFID_WIZARD_MAX_DONE_KEY);
      const mn = m != null ? parseInt(m, 10) : NaN;
      if (Number.isFinite(mn) && mn >= 0 && mn <= MIFID_WIZARD_TOTAL_STEPS - 1) {
        setWizardMaxDone(Math.min(mn, Math.max(0, step - 1)));
      } else {
        setWizardMaxDone(Math.max(0, step - 1));
      }
    } catch {
      // ignore
    }
  }, [router.isReady, router.query.step]);

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
    try {
      setMifidPreviouslyConfirmed(window.localStorage.getItem(ONBOARDING_STORAGE_KEYS.mifid) === "1");
    } catch {
      setMifidPreviouslyConfirmed(false);
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

  const whyProfileCompactLine = useMemo(() => {
    const h = typeof horizonte === "number" ? horizonte : 0;
    const a = typeof aceitaPerda === "number" ? aceitaPerda : 0;
    return mifidWhyCompactOneLine({ objetivo, horizonteNum: h, aceitaPerdaNum: a });
  }, [objetivo, horizonte, aceitaPerda]);

  const step1MissingFields = useMemo(() => {
    if (!experienceTier) return ["Nível de experiência"];
    return [];
  }, [experienceTier]);
  const stepVolMissingFields = useMemo(
    () => missingMifidFields.filter((x) => STEP_VOL_MISSING_LABELS.has(x)),
    [missingMifidFields],
  );
  const stepDdMissingFields = useMemo(
    () => missingMifidFields.filter((x) => STEP_DD_MISSING_LABELS.has(x)),
    [missingMifidFields],
  );
  const stepObj4aMissingFields = useMemo(
    () => missingMifidFields.filter((x) => STEP_OBJ4A_MISSING_LABELS.has(x)),
    [missingMifidFields],
  );
  const stepObj4bMissingFields = useMemo(
    () => missingMifidFields.filter((x) => STEP_OBJ4B_MISSING_LABELS.has(x)),
    [missingMifidFields],
  );
  const step4aReady = stepObj4aMissingFields.length === 0;
  const step4bReady = stepObj4bMissingFields.length === 0;

  const aceitaPerdaNumLive = typeof aceitaPerda === "number" ? aceitaPerda : 0;
  const lossZero =
    aceitaPerda === "" || aceitaPerdaNumLive <= 0;

  const perfilAtualLinha = useMemo(
    () =>
      buildPerfilAtualLine({
        experienceTier,
        entendeVolatilidade,
        entendeDrawdown,
        aceitaPerda,
        objetivo,
        horizonte,
        liquidez,
        rendimentosEstaveis,
        patrimonio,
        montante,
      }),
    [
      experienceTier,
      entendeVolatilidade,
      entendeDrawdown,
      aceitaPerda,
      objetivo,
      horizonte,
      liquidez,
      rendimentosEstaveis,
      patrimonio,
      montante,
    ],
  );

  function fieldStyleIfMissing(missingKey: string): React.CSSProperties {
    const stepErr =
      (attemptedFromStep === 1 && STEP1_MISSING_LABELS.has(missingKey)) ||
      (attemptedFromStep === 2 && STEP_VOL_MISSING_LABELS.has(missingKey)) ||
      (attemptedFromStep === 3 && STEP_DD_MISSING_LABELS.has(missingKey)) ||
      (attemptedFromStep === 4 && STEP_OBJ4A_MISSING_LABELS.has(missingKey)) ||
      (attemptedFromStep === 5 && STEP_OBJ4B_MISSING_LABELS.has(missingKey));
    const err = missingSet.has(missingKey) && (confirmAttempted || stepErr);
    return {
      ...inputStyle(),
      border: err ? "1px solid #f87171" : DECIDE_CLIENT.panelBorder,
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
      if (stepVolMissingFields.length > 0) {
        setAttemptedFromStep(2);
        return;
      }
      setAttemptedFromStep(0);
      setWizardMaxDone((m) => Math.max(m, 2));
      setWizardStep(3);
      return;
    }
    if (fromStep === 3) {
      if (stepDdMissingFields.length > 0) {
        setAttemptedFromStep(3);
        return;
      }
      setAttemptedFromStep(0);
      setWizardMaxDone((m) => Math.max(m, 3));
      setWizardStep(4);
      return;
    }
    if (fromStep === 4) {
      if (stepObj4aMissingFields.length > 0) {
        setAttemptedFromStep(4);
        setConfirmAttempted(true);
        return;
      }
      setAttemptedFromStep(0);
      setWizardMaxDone((m) => Math.max(m, 4));
      setWizardStep(5);
      return;
    }
    if (fromStep === 5) {
      if (stepObj4bMissingFields.length > 0) {
        setAttemptedFromStep(5);
        setConfirmAttempted(true);
        return;
      }
      setAttemptedFromStep(0);
      setWizardMaxDone((m) => Math.max(m, 5));
      setWizardStep(6);
    }
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
    const newPayload = {
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
    };
    try {
      let previousRaw: string | null = null;
      try {
        previousRaw = window.localStorage.getItem(ONBOARDING_MIFID_FIELDS_KEY);
      } catch {
        previousRaw = null;
      }
      let previousParsed: unknown = null;
      if (previousRaw) {
        try {
          previousParsed = JSON.parse(previousRaw);
        } catch {
          previousParsed = null;
        }
      }
      const kycWasDone = window.localStorage.getItem(ONBOARDING_STORAGE_KEYS.kyc) === "1";
      const unchanged =
        previousParsed != null && mifidPayloadsMateriallyEqual(previousParsed, newPayload);

      window.localStorage.setItem(ONBOARDING_MIFID_FIELDS_KEY, JSON.stringify(newPayload));
      persistOnboardingRiskProfile(result.profile);
      window.localStorage.setItem(ONBOARDING_STORAGE_KEYS.mifid, "1");
      // Só invalida identidade se o perfil MiFID mudou (ou é a primeira gravação). Reconfirmar os mesmos dados não pode apagar KYC.
      if (!kycWasDone || !unchanged) {
        window.localStorage.setItem(ONBOARDING_STORAGE_KEYS.kyc, "0");
      }
    } catch {
      // ignore
    }
    let authed = false;
    try {
      authed = window.localStorage.getItem("decide_client_session_ok") === "1";
    } catch {
      authed = false;
    }
    if (!authed) {
      window.location.href = "/client/login";
      return;
    }
    /** Após gravar MiFID: identidade pendente → Persona; se KYC já estava válido e o perfil não foi invalidado, segue o funil. */
    let kycDoneNow = false;
    try {
      kycDoneNow = window.localStorage.getItem(ONBOARDING_STORAGE_KEYS.kyc) === "1";
    } catch {
      kycDoneNow = false;
    }
    window.location.href = !kycDoneNow ? "/persona-onboarding" : getNextOnboardingHref();
  }

  const btnPrimary: React.CSSProperties = {
    background: DECIDE_CLIENT.buttonPrimaryGradient,
    color: DECIDE_CLIENT.text,
    border: DECIDE_CLIENT.buttonPrimaryBorder,
    borderRadius: 12,
    padding: "11px 18px",
    fontSize: 15,
    fontWeight: 900,
    cursor: "pointer",
    boxShadow: DECIDE_CLIENT.buttonPrimaryGlow,
  };
  const btnPrimaryCta: React.CSSProperties = {
    ...btnPrimary,
    width: "100%",
    maxWidth: ONBOARDING_PRIMARY_CTA_MAX_WIDTH_PX,
    minHeight: 46,
    boxSizing: "border-box",
    display: "block",
    textAlign: "center",
    flexShrink: 0,
  };

  const perfilAtualFooterStyle: React.CSSProperties = {
    marginTop: 14,
    paddingTop: 12,
    borderTop: "1px solid rgba(148, 163, 184, 0.22)",
    color: "#a1a1aa",
    fontSize: 12,
    lineHeight: 1.5,
  };

  /** Rodapé do cartão: CTA único centrado (navegação atrás = funil global). */
  const wizardActionsSticky: React.CSSProperties = {
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    marginTop: "auto",
    paddingTop: 12,
    marginLeft: -16,
    marginRight: -16,
    marginBottom: -16,
    paddingLeft: 16,
    paddingRight: 16,
    paddingBottom: 12,
    boxSizing: "border-box",
    width: "100%",
    position: "sticky",
    bottom: 0,
    zIndex: 2,
    background: "linear-gradient(180deg, rgba(17,22,28,0) 0%, rgba(17,22,28,0.82) 14%, rgba(17,22,28,0.97) 100%)",
    borderTop: "1px solid rgba(255,255,255,0.06)",
    borderRadius: "0 0 18px 18px",
  };

  const wizardActionsStickyPageButtonRow: React.CSSProperties = {
    display: "flex",
    justifyContent: "center",
    width: "100%",
  };

  /** Passo 6: CTA sempre visível (conversão). */
  const mifidStep6FixedCtaBar: React.CSSProperties = {
    position: "fixed",
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 50,
    padding: "8px max(12px, 2vw) max(10px, env(safe-area-inset-bottom, 0px))",
    background: "linear-gradient(180deg, rgba(11,15,20,0) 0%, rgba(11,15,20,0.9) 22%, rgba(11,15,20,0.99) 100%)",
    borderTop: "1px solid rgba(255,255,255,0.08)",
    boxSizing: "border-box",
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
          background: DECIDE_CLIENT.pageGradient,
          color: DECIDE_CLIENT.text,
          padding: "18px max(12px, 2vw) 22px",
          fontFamily: DECIDE_CLIENT.fontFamily,
          fontSize: "clamp(14px, 1.05vw, 15px)",
        }}
      >
        <OnboardingFlowBar currentStepId="mifid" authStepHref="/client/login" shellMaxWidthPx={MIFID_PAGE_MAX_WIDTH_PX} />

        <div style={{ marginBottom: 12, marginTop: 12 }}>
          <div style={{ fontSize: "clamp(22px, 3.2vw, 34px)", fontWeight: 800, lineHeight: 1.12 }}>Definir o seu perfil de investidor</div>
          <div style={{ color: "#cbd5e1", fontSize: "max(14px, 0.95em)", marginTop: 6, maxWidth: "min(100%, 960px)", lineHeight: 1.45, fontWeight: 500 }}>
            Com estas escolhas, definimos o seu perfil de investimento e a estratégia mais adequada.
          </div>
          <div style={{ color: "#71717a", fontSize: "max(12px, 0.88em)", marginTop: 6, maxWidth: "min(100%, 960px)", lineHeight: 1.45 }}>
            Enquadramento MiFID com linguagem clara — ajuste mais tarde se o seu contexto mudar.
          </div>
          {mifidPreviouslyConfirmed ? (
            <div
              style={{
                marginTop: 12,
                padding: "10px 14px",
                borderRadius: 12,
                background: "rgba(45, 212, 191, 0.1)",
                border: "1px solid rgba(45, 212, 191, 0.35)",
                color: "#99f6e4",
                fontSize: 14,
                lineHeight: 1.45,
                maxWidth: "min(100%, 960px)",
              }}
            >
              <strong style={{ color: "#ecfdf5" }}>Perfil já confirmado.</strong> Se alterar respostas, confirme outra vez no último passo para aplicar.
            </div>
          ) : (
            <div style={{ color: "#71717a", fontSize: 13, marginTop: 10, maxWidth: "min(100%, 960px)", lineHeight: 1.45 }}>
              Respostas em rascunho neste dispositivo até confirmar no passo final.
            </div>
          )}
        </div>

        <div style={{ marginBottom: 12 }}>
          <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
            {Array.from({ length: MIFID_WIZARD_TOTAL_STEPS }, (_, idx) => idx + 1).map((i) => {
              const completed = i < wizardStep && i <= wizardMaxDone;
              const active = i === wizardStep;
              const bg = completed ? "#2d6d66" : active ? "#3f9e93" : "#1a3d39";
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
          <div
            style={{
              color: "#f1f5f9",
              fontSize: "clamp(14px, 2.8vw, 17px)",
              fontWeight: 800,
              letterSpacing: "0.04em",
              textTransform: "uppercase",
            }}
          >
            Passo {wizardStep} de {MIFID_WIZARD_TOTAL_STEPS}
          </div>
        </div>

        {((wizardStep === 1 && !experienceTier) || (wizardStep === 4 && lossZero)) ? (
        <div
          style={{
            marginBottom: 12,
            padding: 12,
            borderRadius: 14,
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
          {wizardStep === 4 && lossZero ? (
            <div>
              • <strong>Perda máxima aceitável (%)</strong> tem de ser <strong>maior que 0</strong>.
            </div>
          ) : null}
        </div>
      ) : null}

      <div style={{ maxWidth: MIFID_PAGE_MAX_WIDTH_PX, margin: "0 auto", width: "100%" }}>
        {wizardStep === 1 ? (
          <div style={{ ...sectionStyle(), display: "flex", flexDirection: "column" }}>
            <div style={{ color: "#fff", fontSize: 22, fontWeight: 800, marginBottom: 8 }}>A sua experiência</div>
            <div style={{ color: "#a1a1aa", fontSize: 14, marginBottom: 20, lineHeight: 1.5 }}>
              Uma escolha: o nível que melhor o descreve. A partir daqui alinhamos os indicadores regulamentares (anos, produtos,
              frequência).
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
                    sub: "Já invisto há algum tempo e conheço o essencial.",
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
                      padding: "10px 12px",
                      borderRadius: 16,
                      border: err
                        ? "1px solid rgba(248,113,113,0.55)"
                        : selected
                          ? "2px solid rgba(45, 212, 191, 0.75)"
                          : DECIDE_CLIENT.panelBorder,
                      background: selected ? "rgba(45, 212, 191, 0.12)" : DECIDE_CLIENT.inputBg,
                      cursor: "pointer",
                      color: DECIDE_CLIENT.text,
                      boxShadow: selected
                        ? "0 0 0 3px rgba(45, 212, 191, 0.28), 0 0 28px rgba(45, 212, 191, 0.18)"
                        : err
                          ? "0 0 0 3px rgba(248,113,113,0.12)"
                          : "none",
                      transform: selected ? "scale(1.012)" : "scale(1)",
                      transition:
                        "border 0.2s ease, box-shadow 0.28s ease, background 0.2s ease, transform 0.22s cubic-bezier(0.34, 1.45, 0.64, 1)",
                    }}
                  >
                    <div style={{ fontWeight: 900, fontSize: 16, marginBottom: 6 }}>{title}</div>
                    <div style={{ color: "#a1a1aa", fontSize: 14, lineHeight: 1.5 }}>{sub}</div>
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
            {perfilAtualLinha ? (
              <div style={perfilAtualFooterStyle}>
                <span style={{ color: "#d4d4d4", fontWeight: 800 }}>Perfil atual: </span>
                {perfilAtualLinha}
              </div>
            ) : null}
            <div style={wizardActionsSticky}>
              <button type="button" onClick={() => tryWizardNext(1)} style={btnPrimaryCta}>
                Continuar
              </button>
            </div>
          </div>
        ) : null}

        {wizardStep === 2 ? (
          <div style={{ ...sectionStyle(), display: "flex", flexDirection: "column" }}>
            <div style={{ color: "#fff", fontSize: 22, fontWeight: 800, marginBottom: 8 }}>Como reagem os mercados</div>
            <div style={{ color: "#a1a1aa", fontSize: 14, marginBottom: 10, lineHeight: 1.5 }}>
              Preços sobem e descem no dia a dia — esta escolha define se está alinhado com essa realidade.
            </div>
            <div style={{ color: "#71717a", fontSize: 12, marginBottom: 12, lineHeight: 1.45 }}>
              Isto ajuda-nos a definir o nível de risco adequado.
            </div>
            <div style={{ color: "#e2e8f0", fontSize: 15, fontWeight: 800, marginBottom: 14, lineHeight: 1.4 }}>
              Está confortável com variações no valor do investimento no curto prazo?
            </div>
            <div style={{ display: "grid", gap: 12 }}>
              {(
                [
                  {
                    id: "sim" as const,
                    title: "Sim, estou confortável",
                    sub: "Aceito que o valor possa variar de dia para dia.",
                  },
                  {
                    id: "nao" as const,
                    title: "Não, prefiro evitar oscilações",
                    sub: "Quero menor movimento no curto prazo.",
                  },
                ] as const
              ).map(({ id, title, sub }) => {
                const selected = entendeVolatilidade === id;
                const step2Err =
                  missingSet.has("Compreende volatilidade") && (confirmAttempted || attemptedFromStep === 2);
                const err = step2Err && !entendeVolatilidade;
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setEntendeVolatilidade(id)}
                    style={{
                      textAlign: "left",
                      padding: "10px 12px",
                      borderRadius: 16,
                      border: err
                        ? "1px solid rgba(248,113,113,0.55)"
                        : selected
                          ? "2px solid rgba(45, 212, 191, 0.75)"
                          : DECIDE_CLIENT.panelBorder,
                      background: selected ? "rgba(45, 212, 191, 0.12)" : DECIDE_CLIENT.inputBg,
                      cursor: "pointer",
                      color: DECIDE_CLIENT.text,
                      boxShadow: selected
                        ? "0 0 0 3px rgba(45, 212, 191, 0.28), 0 0 28px rgba(45, 212, 191, 0.18)"
                        : err
                          ? "0 0 0 3px rgba(248,113,113,0.12)"
                          : "none",
                      transform: selected ? "scale(1.012)" : "scale(1)",
                      transition:
                        "border 0.2s ease, box-shadow 0.28s ease, background 0.2s ease, transform 0.22s cubic-bezier(0.34, 1.45, 0.64, 1)",
                    }}
                  >
                    <div style={{ fontWeight: 900, fontSize: 16, marginBottom: 6 }}>{title}</div>
                    <div style={{ color: "#a1a1aa", fontSize: 14, lineHeight: 1.5 }}>{sub}</div>
                  </button>
                );
              })}
            </div>
            {attemptedFromStep === 2 && stepVolMissingFields.length > 0 ? (
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
                Escolha uma das opções acima para continuar.
              </div>
            ) : null}
            {perfilAtualLinha ? (
              <div style={perfilAtualFooterStyle}>
                <span style={{ color: "#d4d4d4", fontWeight: 800 }}>Perfil atual: </span>
                {perfilAtualLinha}
              </div>
            ) : null}
            <div style={wizardActionsSticky}>
              <button type="button" onClick={() => tryWizardNext(2)} style={btnPrimaryCta}>
                Continuar
              </button>
            </div>
          </div>
        ) : null}

        {wizardStep === 3 ? (
          <div style={{ ...sectionStyle(), display: "flex", flexDirection: "column" }}>
            <div style={{ color: "#fff", fontSize: 22, fontWeight: 800, marginBottom: 8 }}>Quedas antes de recuperar</div>
            <div style={{ color: "#a1a1aa", fontSize: 14, marginBottom: 10, lineHeight: 1.5 }}>
              Às vezes a carteira cai e só recupera mais tarde — precisamos de saber se compreende esse risco.
            </div>
            <div style={{ color: "#71717a", fontSize: 12, marginBottom: 12, lineHeight: 1.45 }}>
              Isto ajuda-nos a calibrar a tolerância a quedas temporárias (drawdown).
            </div>
            <div style={{ color: "#e2e8f0", fontSize: 15, fontWeight: 800, marginBottom: 14, lineHeight: 1.4 }}>
              Aceita que pode haver períodos em que perde valor antes de voltar a subir?
            </div>
            <div style={{ display: "grid", gap: 12 }}>
              {(
                [
                  {
                    id: "sim" as const,
                    title: "Sim, compreendo",
                    sub: "Sei que investir implica períodos em que o valor pode cair antes de recuperar.",
                  },
                  {
                    id: "nao" as const,
                    title: "Não, não estou confortável com isso",
                    sub: "Prefiro evitar cenários com quedas prolongadas antes de recuperação.",
                  },
                ] as const
              ).map(({ id, title, sub }) => {
                const selected = entendeDrawdown === id;
                const step3Err =
                  missingSet.has("Compreende drawdown") && (confirmAttempted || attemptedFromStep === 3);
                const err = step3Err && !entendeDrawdown;
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setEntendeDrawdown(id)}
                    style={{
                      textAlign: "left",
                      padding: "10px 12px",
                      borderRadius: 16,
                      border: err
                        ? "1px solid rgba(248,113,113,0.55)"
                        : selected
                          ? "2px solid rgba(45, 212, 191, 0.75)"
                          : DECIDE_CLIENT.panelBorder,
                      background: selected ? "rgba(45, 212, 191, 0.12)" : DECIDE_CLIENT.inputBg,
                      cursor: "pointer",
                      color: DECIDE_CLIENT.text,
                      boxShadow: selected
                        ? "0 0 0 3px rgba(45, 212, 191, 0.28), 0 0 28px rgba(45, 212, 191, 0.18)"
                        : err
                          ? "0 0 0 3px rgba(248,113,113,0.12)"
                          : "none",
                      transform: selected ? "scale(1.012)" : "scale(1)",
                      transition:
                        "border 0.2s ease, box-shadow 0.28s ease, background 0.2s ease, transform 0.22s cubic-bezier(0.34, 1.45, 0.64, 1)",
                    }}
                  >
                    <div style={{ fontWeight: 900, fontSize: 16, marginBottom: 6 }}>{title}</div>
                    <div style={{ color: "#a1a1aa", fontSize: 14, lineHeight: 1.5 }}>{sub}</div>
                  </button>
                );
              })}
            </div>
            {attemptedFromStep === 3 && stepDdMissingFields.length > 0 ? (
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
                Escolha uma das opções acima para continuar.
              </div>
            ) : null}
            {perfilAtualLinha ? (
              <div style={perfilAtualFooterStyle}>
                <span style={{ color: "#d4d4d4", fontWeight: 800 }}>Perfil atual: </span>
                {perfilAtualLinha}
              </div>
            ) : null}
            <div style={wizardActionsSticky}>
              <button type="button" onClick={() => tryWizardNext(3)} style={btnPrimaryCta}>
                Continuar
              </button>
            </div>
          </div>
        ) : null}

        {wizardStep === 4 ? (
          <div style={{ ...sectionStyle(), display: "flex", flexDirection: "column" }}>
            <div style={{ color: "#fff", fontSize: 22, fontWeight: 800, marginBottom: 8 }}>Objetivos e tolerância ao risco</div>
            <div style={{ color: "#cbd5e1", fontSize: 15, marginBottom: 8, lineHeight: 1.5, maxWidth: "min(100%, 960px)" }}>
              Estas respostas definem o seu perfil e a estratégia sugerida — alinham risco, horizonte e objetivo ao serviço
              DECIDE (enquadramento MiFID).
            </div>
            <div style={{ color: "#71717a", fontSize: 13, marginBottom: 12, lineHeight: 1.5, maxWidth: "min(100%, 960px)" }}>
              Não precisa de valores exactos: escolha o que melhor o descreve em cada linha.
            </div>

            <div style={{ marginBottom: 12 }}>
              <div style={mifidStep4BlockTitle}>Tolerância a quedas da carteira</div>
              <div style={{ color: "#a1a1aa", fontSize: 13, marginBottom: 8, lineHeight: 1.45 }}>
                Até que queda estaria preparado para tolerar, em cenários adversos?
              </div>
              <div style={mifidChoiceInlineRow}>
                {MIFID_LOSS_CARD_CHOICES.map(({ id, label, sub, value }) => {
                  const selected = lossTierIdFromValue(typeof aceitaPerda === "number" ? aceitaPerda : "") === id;
                  const err =
                    missingSet.has("Perda máxima aceitável (%)") && (confirmAttempted || attemptedFromStep === 4) && !aceitaPerda;
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setAceitaPerda(value)}
                      style={{ ...mifidChoiceCardBase(selected, err), ...mifidChoiceInlineBtn }}
                    >
                      <div style={{ fontWeight: 900, fontSize: 14, marginBottom: 4, lineHeight: 1.25 }}>{label}</div>
                      <div style={{ color: "#a1a1aa", fontSize: 12, lineHeight: 1.35 }}>{sub}</div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div style={{ marginBottom: 12 }}>
              <div style={mifidStep4BlockTitle}>Objetivo principal</div>
              <div style={mifidChoiceInlineRow}>
                {MIFID_OBJETIVO_CARDS.map(({ id, label, sub }) => {
                  const selected = objetivo === id;
                  const err = missingSet.has("Objetivo") && (confirmAttempted || attemptedFromStep === 4) && !objetivo;
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setObjetivo(id)}
                      style={{ ...mifidChoiceCardBase(selected, err), ...mifidChoiceInlineBtn }}
                    >
                      <div style={{ fontWeight: 900, fontSize: 14, marginBottom: 4, lineHeight: 1.25 }}>{label}</div>
                      <div style={{ color: "#a1a1aa", fontSize: 12, lineHeight: 1.35 }}>{sub}</div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div style={{ marginBottom: 12 }}>
              <div style={mifidStep4BlockTitle}>Horizonte de investimento</div>
              <div style={{ color: "#a1a1aa", fontSize: 13, marginBottom: 8, lineHeight: 1.45 }}>
                Durante quanto tempo pode manter o investimento sem precisar desse dinheiro?
              </div>
              <div style={mifidChoiceInlineRow}>
                {MIFID_HORIZONTE_CARDS.map(({ id, label, sub, value }) => {
                  const selected = horizonteTierFromValue(typeof horizonte === "number" ? horizonte : "") === id;
                  const err =
                    missingSet.has("Horizonte (anos)") && (confirmAttempted || attemptedFromStep === 4) && !horizonte;
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setHorizonte(value)}
                      style={{ ...mifidChoiceCardBase(selected, err), ...mifidChoiceInlineBtn }}
                    >
                      <div style={{ fontWeight: 900, fontSize: 14, marginBottom: 4, lineHeight: 1.25 }}>{label}</div>
                      <div style={{ color: "#a1a1aa", fontSize: 12, lineHeight: 1.35 }}>{sub}</div>
                    </button>
                  );
                })}
              </div>
            </div>

            {(attemptedFromStep === 4 || confirmAttempted) && stepObj4aMissingFields.length > 0 ? (
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
                Falta completar: {stepObj4aMissingFields.join(" · ")}.
              </div>
            ) : null}
            {!step4aReady ? (
              <div style={{ marginTop: 12, color: "#71717a", fontSize: 13, lineHeight: 1.5 }}>
                Complete uma opção em cada linha para continuar.
              </div>
            ) : null}
            {perfilAtualLinha ? (
              <div style={perfilAtualFooterStyle}>
                <span style={{ color: "#d4d4d4", fontWeight: 800 }}>Perfil atual: </span>
                {perfilAtualLinha}
              </div>
            ) : null}
            <div style={wizardActionsSticky}>
              <button
                type="button"
                disabled={!step4aReady}
                aria-disabled={!step4aReady}
                title={!step4aReady ? "Complete as escolhas em falta" : undefined}
                onClick={() => tryWizardNext(4)}
                style={{
                  ...btnPrimaryCta,
                  opacity: step4aReady ? 1 : 0.48,
                  cursor: step4aReady ? "pointer" : "not-allowed",
                  boxShadow: step4aReady ? btnPrimary.boxShadow : "none",
                }}
              >
                Continuar
              </button>
            </div>
          </div>
        ) : null}

        {wizardStep === 5 ? (
          <div style={{ ...sectionStyle(), display: "flex", flexDirection: "column" }}>
            <div style={{ color: "#fff", fontSize: 22, fontWeight: 800, marginBottom: 8 }}>Liquidez, rendimentos e património</div>
            <div style={{ color: "#cbd5e1", fontSize: 15, marginBottom: 8, lineHeight: 1.5, maxWidth: "min(100%, 960px)" }}>
              Estas respostas completam o enquadramento MiFID — situação financeira e necessidades de liquidez.
            </div>
            <div style={{ color: "#71717a", fontSize: 13, marginBottom: 12, lineHeight: 1.5, maxWidth: "min(100%, 960px)" }}>
              Escolha o que melhor o descreve; em ecrãs estreitos pode deslizar horizontalmente em cada linha.
            </div>

            <div style={{ marginBottom: 12 }}>
              <div style={mifidStep4BlockTitle}>Necessidade de liquidez</div>
              <div style={mifidChoiceInlineRow}>
                {MIFID_LIQUIDEZ_CARDS.map(({ id, label, sub }) => {
                  const selected = liquidez === id;
                  const err =
                    missingSet.has("Necessidade de liquidez") &&
                    (confirmAttempted || attemptedFromStep === 5) &&
                    !liquidez;
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setLiquidez(id)}
                      style={{ ...mifidChoiceCardBase(selected, err), ...mifidChoiceInlineBtn }}
                    >
                      <div style={{ fontWeight: 900, fontSize: 14, marginBottom: 4, lineHeight: 1.25 }}>{label}</div>
                      <div style={{ color: "#a1a1aa", fontSize: 12, lineHeight: 1.35 }}>{sub}</div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div style={{ marginBottom: 12 }}>
              <div style={mifidStep4BlockTitle}>Rendimentos regulares</div>
              <div style={{ color: "#a1a1aa", fontSize: 13, marginBottom: 8, lineHeight: 1.45 }}>
                Depende de rendimentos regulares deste investimento?
              </div>
              <div style={mifidChoiceInlineRow}>
                {(
                  [
                    {
                      id: "sim" as const,
                      title: "Sim, preciso de rendimento regular",
                      sub: "Ex.: complemento de rendimentos ou pagamentos periódicos.",
                    },
                    {
                      id: "nao" as const,
                      title: "Não, foco no crescimento",
                      sub: "Reinvestimento ou valorização ao longo do tempo.",
                    },
                  ] as const
                ).map(({ id, title, sub }) => {
                  const selected = rendimentosEstaveis === id;
                  const err =
                    missingSet.has("Rendimentos estáveis") &&
                    (confirmAttempted || attemptedFromStep === 5) &&
                    !rendimentosEstaveis;
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setRendimentosEstaveis(id)}
                      style={{ ...mifidChoiceCardBase(selected, err), ...mifidChoiceInlineBtn }}
                    >
                      <div style={{ fontWeight: 900, fontSize: 13, marginBottom: 4, lineHeight: 1.25 }}>{title}</div>
                      <div style={{ color: "#a1a1aa", fontSize: 12, lineHeight: 1.35 }}>{sub}</div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div style={{ marginBottom: 12 }}>
              <div style={mifidStep4BlockTitle}>Património financeiro total (estimativa)</div>
              <div style={mifidChoiceInlineRow}>
                {MIFID_PATRIMONIO_CARDS.map(({ id, label, sub, value }) => {
                  const selected = patrimonioTierFromValue(typeof patrimonio === "number" ? patrimonio : "") === id;
                  const err =
                    missingSet.has("Património financeiro (€)") &&
                    (confirmAttempted || attemptedFromStep === 5) &&
                    !patrimonio;
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setPatrimonio(value)}
                      style={{ ...mifidChoiceCardBase(selected, err), ...mifidChoiceInlineBtn }}
                    >
                      <div style={{ fontWeight: 900, fontSize: 13, marginBottom: 4, lineHeight: 1.25 }}>{label}</div>
                      <div style={{ color: "#a1a1aa", fontSize: 11, lineHeight: 1.35 }}>{sub}</div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div
              style={{
                marginBottom: 8,
                padding: 14,
                borderRadius: 14,
                background: "rgba(15, 23, 42, 0.65)",
                border: "1px solid rgba(148, 163, 184, 0.25)",
              }}
            >
              <div style={{ color: "#a1a1aa", fontSize: 12, fontWeight: 700, marginBottom: 6, letterSpacing: "0.04em" }}>
                Valor a investir (passo anterior)
              </div>
              {typeof montante === "number" && montante > 0 ? (
                <div style={{ color: "#f8fafc", fontSize: 20, fontWeight: 800 }}>
                  {montante.toLocaleString("pt-PT")} €
                </div>
              ) : (
                <div style={{ color: "#fb923c", fontSize: 14 }}>
                  Montante em falta — conclua primeiro o passo «Valor a investir» no funil.
                </div>
              )}
            </div>

            {(attemptedFromStep === 5 || confirmAttempted) && stepObj4bMissingFields.length > 0 ? (
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
                Falta completar: {stepObj4bMissingFields.join(" · ")}.
              </div>
            ) : null}
            {!step4bReady ? (
              <div style={{ marginTop: 12, color: "#71717a", fontSize: 13, lineHeight: 1.5 }}>
                Complete uma opção em cada linha (e o montante no funil, se aplicável) para ver o resumo do perfil.
              </div>
            ) : null}
            {perfilAtualLinha ? (
              <div style={perfilAtualFooterStyle}>
                <span style={{ color: "#d4d4d4", fontWeight: 800 }}>Perfil atual: </span>
                {perfilAtualLinha}
              </div>
            ) : null}
            <div style={wizardActionsSticky}>
              <button
                type="button"
                disabled={!step4bReady}
                aria-disabled={!step4bReady}
                title={!step4bReady ? "Complete as escolhas em falta" : undefined}
                onClick={() => tryWizardNext(5)}
                style={{
                  ...btnPrimaryCta,
                  opacity: step4bReady ? 1 : 0.48,
                  cursor: step4bReady ? "pointer" : "not-allowed",
                  boxShadow: step4bReady ? btnPrimary.boxShadow : "none",
                }}
              >
                Ver o seu perfil
              </button>
            </div>
          </div>
        ) : null}

        {wizardStep === 6 && !canConfirmMifid ? (
          <div style={sectionStyle()}>
            <div style={{ color: "#fff", fontSize: 20, fontWeight: 800, marginBottom: 12 }}>Resumo indisponível</div>
            <p style={{ color: "#a1a1aa", lineHeight: 1.6, marginBottom: 12 }}>
              Ainda faltam respostas para calcular o perfil. Utilize a navegação do funil no topo para rever os passos
              anteriores.
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
            {perfilAtualLinha ? (
              <div style={{ ...perfilAtualFooterStyle, marginTop: 0 }}>
                <span style={{ color: "#d4d4d4", fontWeight: 800 }}>Perfil atual: </span>
                {perfilAtualLinha}
              </div>
            ) : null}
          </div>
        ) : null}

        {wizardStep === 6 && canConfirmMifid ? (
          <>
            <div
              style={{
                display: "grid",
                gap: 8,
                paddingBottom: "calc(96px + env(safe-area-inset-bottom, 0px))",
                boxSizing: "border-box",
              }}
            >
              <div
                style={{
                  ...sectionStyle(),
                  padding: "14px 14px 12px",
                  border: "1px solid rgba(45, 212, 191, 0.4)",
                  boxShadow: `${DECIDE_CLIENT.cardShadow}, 0 0 0 1px rgba(45, 212, 191, 0.18), 0 0 40px rgba(45, 212, 191, 0.1)`,
                }}
              >
                <div style={{ color: "#d4d4d4", fontSize: 10, fontWeight: 800, letterSpacing: "0.1em", marginBottom: 8 }}>
                  PERFIL CALCULADO PARA SI
                </div>
                <div
                  style={{
                    color: "#e2e8f0",
                    fontSize: "clamp(16px, 2.1vw, 18px)",
                    fontWeight: 700,
                    lineHeight: 1.25,
                    marginBottom: 8,
                  }}
                >
                  Este é o seu perfil de investidor
                </div>
                <div
                  style={{
                    padding: "12px 12px 14px",
                    marginBottom: 10,
                    borderRadius: 14,
                    background:
                      "radial-gradient(ellipse 90% 140% at 50% 0%, rgba(45, 212, 191, 0.14) 0%, transparent 58%)",
                    border: "1px solid rgba(45, 212, 191, 0.28)",
                    boxShadow: "0 0 36px rgba(45, 212, 191, 0.09), inset 0 1px 0 rgba(255,255,255,0.05)",
                  }}
                >
                  <div
                    style={{
                      color: "#fff",
                      fontSize: "clamp(28px, 6vw, 40px)",
                      fontWeight: 900,
                      lineHeight: 1.05,
                      letterSpacing: "-0.03em",
                      textShadow: "0 0 36px rgba(45, 212, 191, 0.32), 0 2px 20px rgba(0,0,0,0.35)",
                    }}
                  >
                    {profileLabelPt(result.profile)}
                  </div>
                </div>
                <p style={{ color: "#cbd5e1", fontSize: 14, lineHeight: 1.45, margin: "0 0 8px" }}>
                  {profileExplanationPt(result.profile)}
                </p>

                <div
                  style={{
                    marginBottom: 8,
                    padding: "8px 10px",
                    borderRadius: 10,
                    background: "rgba(15, 23, 42, 0.55)",
                    border: "1px solid rgba(148, 163, 184, 0.2)",
                  }}
                >
                  <div style={{ color: "#e2e8f0", fontSize: 12, fontWeight: 800, marginBottom: 4, lineHeight: 1.3 }}>
                    O que isto significa para si
                  </div>
                  <p style={{ margin: 0, color: "#a1a1aa", fontSize: 12, lineHeight: 1.4 }}>
                    {profilePracticalOneLinePt(result.profile)}
                  </p>
                </div>

                <div style={{ marginBottom: 8 }}>
                  <div style={{ color: "#71717a", fontSize: 11, fontWeight: 800, marginBottom: 3 }}>Resumo das escolhas</div>
                  <p style={{ margin: 0, color: "#a1a1aa", fontSize: 12, lineHeight: 1.4 }}>{whyProfileCompactLine}</p>
                </div>

                <div
                  style={{
                    padding: "8px 10px",
                    borderRadius: 10,
                    background: DECIDE_CLIENT.infoBg,
                    border: DECIDE_CLIENT.infoBorder,
                    color: DECIDE_CLIENT.infoText,
                    fontSize: 13,
                    lineHeight: 1.4,
                  }}
                >
                  O montante representa ~<strong style={{ color: "#fff" }}>{(result.investmentRatio * 100).toFixed(1)}%</strong> do
                  seu património.
                </div>
              </div>

              {result.warnings.length ? (
                <div style={{ ...sectionStyle(), padding: "10px 12px" }}>
                  <div style={{ color: "#fff", fontSize: 14, fontWeight: 800, marginBottom: 6 }}>Coerência</div>
                  <div
                    style={{
                      background: "#2a0a0a",
                      border: "1px solid #7f1d1d",
                      borderRadius: 10,
                      padding: 10,
                      color: "#fee2e2",
                      fontSize: 13,
                      lineHeight: 1.45,
                    }}
                  >
                    {result.warnings.map((warning, idx) => (
                      <div key={idx} style={{ marginBottom: idx < result.warnings.length - 1 ? 6 : 0 }}>
                        • {warning}
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <p style={{ color: "#86efac", fontSize: 12, fontWeight: 700, margin: "0 0 2px", lineHeight: 1.35 }}>
                  Perfil validado sem alertas.
                </p>
              )}

              <details
                style={{
                  ...sectionStyle(),
                  padding: "8px 12px",
                  cursor: "pointer",
                  marginTop: 0,
                }}
              >
                <summary style={{ color: "#a1a1aa", fontWeight: 700, fontSize: 13, listStyle: "none" }}>
                  Como chegámos a este perfil
                </summary>
                <div style={{ marginTop: 8, color: "#71717a", fontSize: 12, lineHeight: 1.45 }}>
                  <p style={{ margin: "0 0 6px" }}>
                    Soma de indicadores: até 5 → conservador · 6 a 9 → moderado · 10+ → dinâmico.
                  </p>
                  <div style={{ color: "#a1a1aa" }}>
                    Conhecimento {result.knowledgeScore} · Risco/objetivo {result.riskScore} · Total {result.total}
                  </div>
                </div>
              </details>

              {confirmAttempted && missingMifidFields.length > 0 ? (
                <div
                  style={{
                    background: "#2a0a0a",
                    border: "1px solid #7f1d1d",
                    borderRadius: 12,
                    padding: 12,
                    color: "#fee2e2",
                    lineHeight: 1.5,
                    fontSize: 13,
                  }}
                >
                  Faltam preencher: {missingMifidFields.join(", ")}.
                </div>
              ) : null}
            </div>

            <div style={mifidStep6FixedCtaBar}>
              <div style={{ maxWidth: MIFID_PAGE_MAX_WIDTH_PX, margin: "0 auto", width: "100%", boxSizing: "border-box" }}>
                <div style={wizardActionsStickyPageButtonRow}>
                  <button
                    type="button"
                    onClick={confirmAndGoKyc}
                    disabled={!canConfirmMifid}
                    style={{
                      ...btnPrimaryCta,
                      opacity: canConfirmMifid ? 1 : 0.45,
                      cursor: canConfirmMifid ? "pointer" : "not-allowed",
                      boxShadow: canConfirmMifid ? btnPrimary.boxShadow : "none",
                    }}
                  >
                    Confirmar perfil e avançar
                  </button>
                </div>
                <div style={{ color: "#71717a", fontSize: 10, lineHeight: 1.35, textAlign: "center", width: "100%", marginTop: 4 }}>
                  A seguir: identidade · corretora depois
                </div>
              </div>
            </div>
          </>
        ) : null}
      </div>
      </div>
    </>
  );
}