import React, { useEffect, useMemo, useState } from "react";
import type { GetServerSideProps } from "next";
import OnboardingFlowBar, {
  ONBOARDING_STORAGE_KEYS,
} from "../components/OnboardingFlowBar";
import ThousandsNumberInput from "../components/ThousandsNumberInput";
import {
  DECIDE_APP_FONT_FAMILY,
  DECIDE_DASHBOARD,
  DECIDE_ONBOARDING,
  ONBOARDING_SHELL_MAX_WIDTH_PX,
} from "../lib/decideClientTheme";

type InvestorProfile = "conservador" | "moderado" | "dinamico";

function safeNumber(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function KPIBox({ title, value }: { title: string; value: string }) {
  return (
    <div
      style={{
        background: "rgba(24, 24, 27, 0.92)",
        border: "1px solid rgba(63, 63, 70, 0.75)",
        borderRadius: 18,
        padding: 18,
      }}
    >
      <div style={{ color: "#a1a1aa", fontSize: 14, marginBottom: 10 }}>{title}</div>
      <div style={{ color: "#fff", fontSize: 24, fontWeight: 800 }}>{value}</div>
    </div>
  );
}

function InputLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ color: "#a1a1aa", fontSize: 14, marginBottom: 8 }}>
      {children}
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        background: "rgba(24, 24, 27, 0.92)",
        border: "1px solid rgba(63, 63, 70, 0.75)",
        borderRadius: 22,
        padding: 20,
      }}
    >
      <div style={{ color: "#fff", fontSize: 24, fontWeight: 800, marginBottom: 16 }}>
        {title}
      </div>
      {children}
    </div>
  );
}

function baseInputStyle(): React.CSSProperties {
  return {
    width: "100%",
    background: "#27272a",
    color: "#fff",
    border: "1px solid rgba(63, 63, 70, 0.85)",
    borderRadius: 12,
    padding: 12,
    fontSize: 16,
    outline: "none",
  };
}

export default function OnboardingPage() {
  // Passo 1 foi separado para a nova página /client-montante.
  useEffect(() => {
    try {
      window.location.href = "/client-montante";
    } catch {}
  }, []);

  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [idade, setIdade] = useState<number | "">("");
  const [pais, setPais] = useState("");
  const [patrimonioFinanceiro, setPatrimonioFinanceiro] = useState<number | "">("");
  const [montanteInvestir, setMontanteInvestir] = useState<number | "">("");
  const [horizonteAnos, setHorizonteAnos] = useState<number | "">("");
  const [objetivo, setObjetivo] = useState("");
  const [liquidez, setLiquidez] = useState("");
  const [aceitaPerda, setAceitaPerda] = useState<number | "">("");
  const [experiencia, setExperiencia] = useState("");
  const [conhecimento, setConhecimento] = useState("");
  const [rendimentoEstavel, setRendimentoEstavel] = useState("");
  const [precisaLiquidezCurtoPrazo, setPrecisaLiquidezCurtoPrazo] = useState("");

  const [confirmAttempted, setConfirmAttempted] = useState(false);

  function hasValueString(v: string): boolean {
    return v.trim().length > 0;
  }

  const suitability = useMemo(() => {
    const idadeNum = typeof idade === "number" ? idade : 0;
    const patrimonioNum = typeof patrimonioFinanceiro === "number" ? patrimonioFinanceiro : 0;
    const montanteNum = typeof montanteInvestir === "number" ? montanteInvestir : 0;
    const horizonteNum = typeof horizonteAnos === "number" ? horizonteAnos : 0;
    const aceitaPerdaNum = typeof aceitaPerda === "number" ? aceitaPerda : 0;

    const onboardingComplete =
      hasValueString(nome) &&
      hasValueString(email) &&
      idadeNum > 0 &&
      hasValueString(pais) &&
      patrimonioNum > 0 &&
      montanteNum > 0 &&
      hasValueString(rendimentoEstavel) &&
      hasValueString(precisaLiquidezCurtoPrazo) &&
      horizonteNum > 0 &&
      hasValueString(objetivo) &&
      hasValueString(liquidez) &&
      hasValueString(experiencia) &&
      hasValueString(conhecimento) &&
      aceitaPerdaNum > 0;

    if (!onboardingComplete) {
      return {
        score: 0,
        perfil: "moderado" as InvestorProfile,
        montanteVsPatrimonio: 0,
        redFlags: [],
      };
    }

    let score = 0;

    if (horizonteNum >= 7) score += 2;
    else if (horizonteNum >= 4) score += 1;

    if (aceitaPerdaNum >= 30) score += 2;
    else if (aceitaPerdaNum >= 15) score += 1;

    if (experiencia === "elevada") score += 2;
    else if (experiencia === "alguma") score += 1;

    if (conhecimento === "elevado") score += 2;
    else if (conhecimento === "medio") score += 1;

    if (liquidez === "baixa") score += 2;
    else if (liquidez === "media") score += 1;

    if (precisaLiquidezCurtoPrazo === "nao") score += 1;
    if (rendimentoEstavel === "sim") score += 1;

    let perfil: InvestorProfile = "moderado";
    if (score <= 4) perfil = "conservador";
    else if (score >= 9) perfil = "dinamico";

    const montanteVsPatrimonio = patrimonioNum > 0 ? montanteNum / patrimonioNum : 0;

    const redFlags: string[] = [];
    if (montanteVsPatrimonio > 0.7) {
      redFlags.push("Montante a investir representa uma parte muito elevada do património financeiro.");
    }
    if (precisaLiquidezCurtoPrazo === "sim") {
      redFlags.push("Foi indicada necessidade potencial de liquidez no curto prazo.");
    }
    if (idadeNum >= 75 && perfil === "dinamico") {
      redFlags.push("Perfil resultante dinâmico com idade elevada — rever suitability.");
    }

    return {
      score,
      perfil,
      montanteVsPatrimonio,
      redFlags,
    };
  }, [
    horizonteAnos,
    aceitaPerda,
    experiencia,
    conhecimento,
    liquidez,
    precisaLiquidezCurtoPrazo,
    rendimentoEstavel,
    patrimonioFinanceiro,
    montanteInvestir,
    idade,
    nome,
    email,
    pais,
    objetivo,
  ]);

  const missingOnboardingFields = useMemo(() => {
    const idadeNum = typeof idade === "number" ? idade : 0;
    const patrimonioNum = typeof patrimonioFinanceiro === "number" ? patrimonioFinanceiro : 0;
    const montanteNum = typeof montanteInvestir === "number" ? montanteInvestir : 0;
    const horizonteNum = typeof horizonteAnos === "number" ? horizonteAnos : 0;
    const aceitaPerdaNum = typeof aceitaPerda === "number" ? aceitaPerda : 0;

    const missing: string[] = [];
    if (!hasValueString(nome)) missing.push("Nome");
    if (!hasValueString(email)) missing.push("Email");
    if (!(idadeNum > 0)) missing.push("Idade");
    if (!hasValueString(pais)) missing.push("País");
    if (!(patrimonioNum > 0)) missing.push("Património financeiro (€)");
    if (!(montanteNum > 0)) missing.push("Montante a investir (€)");
    if (!hasValueString(rendimentoEstavel)) missing.push("Rendimento estável");
    if (!hasValueString(precisaLiquidezCurtoPrazo)) missing.push("Necessidade de liquidez (curto prazo)");
    if (!(horizonteNum > 0)) missing.push("Horizonte de investimento (anos)");
    if (!hasValueString(objetivo)) missing.push("Objetivo principal");
    if (!hasValueString(liquidez)) missing.push("Necessidade de liquidez");
    if (!hasValueString(experiencia)) missing.push("Experiência em investimento");
    if (!hasValueString(conhecimento)) missing.push("Conhecimento financeiro");
    if (!(aceitaPerdaNum > 0)) missing.push("Perda máxima aceitável (%)");
    return missing;
  }, [
    nome,
    email,
    idade,
    pais,
    patrimonioFinanceiro,
    montanteInvestir,
    rendimentoEstavel,
    precisaLiquidezCurtoPrazo,
    horizonteAnos,
    objetivo,
    liquidez,
    experiencia,
    conhecimento,
    aceitaPerda,
  ]);

  const canConfirmOnboarding = missingOnboardingFields.length === 0;
  const missingSet = useMemo(() => new Set(missingOnboardingFields), [missingOnboardingFields]);

  function fieldStyleIfMissing(missingKey: string): React.CSSProperties {
    const err = confirmAttempted && missingSet.has(missingKey);
    return {
      ...baseInputStyle(),
      border: err ? "1px solid #f87171" : "1px solid rgba(63, 63, 70, 0.85)",
      boxShadow: err ? "0 0 0 3px rgba(248,113,113,0.14)" : "none",
    };
  }

  function confirmAndGoNext() {
    setConfirmAttempted(true);
    if (!canConfirmOnboarding) return;
    try {
      window.localStorage.setItem(ONBOARDING_STORAGE_KEYS.onboarding, "1");
    } catch {
      // ignore
    }
    window.location.href = "/mifid-test";
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        background: DECIDE_ONBOARDING.pageBackground,
        color: "#fff",
        padding: 32,
        fontFamily: DECIDE_APP_FONT_FAMILY,
      }}
    >
      <div style={{ maxWidth: ONBOARDING_SHELL_MAX_WIDTH_PX, margin: "0 auto", width: "100%" }}>
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 40, fontWeight: 800 }}>DECIDE — Onboarding</div>
        <div style={{ color: "#a1a1aa", fontSize: 18 }}>
          Página comercial e regulamentar separada do core do modelo.
        </div>
      </div>

      <OnboardingFlowBar currentStepId="onboarding" authStepHref="/client/login" />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginBottom: 24 }}>
        <KPIBox title="Perfil sugerido" value={suitability.perfil} />
        <KPIBox title="Suitability score" value={String(suitability.score)} />
        <KPIBox
          title="% do património a investir"
          value={`${(suitability.montanteVsPatrimonio * 100).toFixed(1)}%`}
        />
        <KPIBox
          title="Red flags"
          value={suitability.redFlags.length ? String(suitability.redFlags.length) : "0"}
        />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: 20 }}>
        <div style={{ display: "grid", gap: 20 }}>
          <Section title="Dados do cliente">
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              <div>
                <InputLabel>Nome</InputLabel>
                <input value={nome} onChange={(e) => setNome(e.target.value)} style={fieldStyleIfMissing("Nome")} />
              </div>
              <div>
                <InputLabel>Email</InputLabel>
                <input value={email} onChange={(e) => setEmail(e.target.value)} style={fieldStyleIfMissing("Email")} />
              </div>
              <div>
                <InputLabel>Idade</InputLabel>
                <ThousandsNumberInput
                  allowEmpty
                  min={0}
                  max={120}
                  maxDecimals={0}
                  value={idade}
                  onChange={setIdade}
                  style={fieldStyleIfMissing("Idade")}
                />
              </div>
              <div>
                <InputLabel>País</InputLabel>
                <input
                  value={pais}
                  onChange={(e) => setPais(e.target.value)}
                  placeholder="Selecione/Escreva o país"
                  style={fieldStyleIfMissing("País")}
                />
              </div>
            </div>
          </Section>

          <Section title="Situação financeira">
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              <div>
                <InputLabel>Património financeiro (€)</InputLabel>
                <ThousandsNumberInput
                  allowEmpty
                  min={0}
                  maxDecimals={0}
                  value={patrimonioFinanceiro}
                  onChange={setPatrimonioFinanceiro}
                  style={fieldStyleIfMissing("Património financeiro (€)")}
                />
              </div>
              <div>
                <InputLabel>Montante a investir (€)</InputLabel>
                <ThousandsNumberInput
                  allowEmpty
                  min={0}
                  maxDecimals={0}
                  value={montanteInvestir}
                  onChange={setMontanteInvestir}
                  style={fieldStyleIfMissing("Montante a investir (€)")}
                />
              </div>
              <div>
                <InputLabel>Rendimento estável</InputLabel>
                <select
                  value={rendimentoEstavel}
                  onChange={(e) => setRendimentoEstavel(e.target.value)}
                  style={fieldStyleIfMissing("Rendimento estável")}
                >
                  <option value="">Selecionar...</option>
                  <option value="sim">Sim</option>
                  <option value="nao">Não</option>
                </select>
              </div>
              <div>
                <InputLabel>Necessidade de liquidez no curto prazo</InputLabel>
                <select
                  value={precisaLiquidezCurtoPrazo}
                  onChange={(e) => setPrecisaLiquidezCurtoPrazo(e.target.value)}
                  style={fieldStyleIfMissing("Necessidade de liquidez (curto prazo)")}
                >
                  <option value="">Selecionar...</option>
                  <option value="nao">Não</option>
                  <option value="sim">Sim</option>
                </select>
              </div>
            </div>
          </Section>

          <Section title="Objetivos e restrições">
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16 }}>
              <div>
                <InputLabel>Horizonte de investimento (anos)</InputLabel>
                <ThousandsNumberInput
                  allowEmpty
                  min={0}
                  maxDecimals={1}
                  value={horizonteAnos}
                  onChange={setHorizonteAnos}
                  style={fieldStyleIfMissing("Horizonte de investimento (anos)")}
                />
              </div>
              <div>
                <InputLabel>Objetivo principal</InputLabel>
                <select
                  value={objetivo}
                  onChange={(e) => setObjetivo(e.target.value)}
                  style={fieldStyleIfMissing("Objetivo principal")}
                >
                  <option value="">Selecionar...</option>
                  <option value="crescimento">Crescimento</option>
                  <option value="equilibrio">Equilíbrio</option>
                  <option value="preservacao">Preservação</option>
                </select>
              </div>
              <div>
                <InputLabel>Necessidade de liquidez</InputLabel>
                <select value={liquidez} onChange={(e) => setLiquidez(e.target.value)} style={fieldStyleIfMissing("Necessidade de liquidez")}>
                  <option value="">Selecionar...</option>
                  <option value="baixa">Baixa</option>
                  <option value="media">Média</option>
                  <option value="alta">Alta</option>
                </select>
              </div>
            </div>
          </Section>

          <Section title="Conhecimento, experiência e risco">
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16 }}>
              <div>
                <InputLabel>Experiência em investimento</InputLabel>
                <select
                  value={experiencia}
                  onChange={(e) => setExperiencia(e.target.value)}
                  style={fieldStyleIfMissing("Experiência em investimento")}
                >
                  <option value="">Selecionar...</option>
                  <option value="nenhuma">Nenhuma</option>
                  <option value="alguma">Alguma</option>
                  <option value="elevada">Elevada</option>
                </select>
              </div>
              <div>
                <InputLabel>Conhecimento financeiro</InputLabel>
                <select value={conhecimento} onChange={(e) => setConhecimento(e.target.value)} style={fieldStyleIfMissing("Conhecimento financeiro")}>
                  <option value="">Selecionar...</option>
                  <option value="baixo">Baixo</option>
                  <option value="medio">Médio</option>
                  <option value="elevado">Elevado</option>
                </select>
              </div>
              <div>
                <InputLabel>Perda máxima aceitável (%)</InputLabel>
                <ThousandsNumberInput
                  allowEmpty
                  min={0}
                  max={100}
                  maxDecimals={1}
                  value={aceitaPerda}
                  onChange={setAceitaPerda}
                  style={fieldStyleIfMissing("Perda máxima aceitável (%)")}
                />
              </div>
            </div>
          </Section>
        </div>

        <div style={{ display: "grid", gap: 20 }}>
          <Section title="Resumo do onboarding">
            <div style={{ display: "grid", gap: 12, color: "#dbeafe" }}>
              <div><strong>Cliente:</strong> {nome || "—"}</div>
              <div><strong>Email:</strong> {email || "—"}</div>
              <div><strong>País:</strong> {pais || "—"}</div>
              <div><strong>Montante a investir:</strong> {typeof montanteInvestir === "number" ? montanteInvestir.toLocaleString("pt-PT") : "—"}€</div>
              <div><strong>Horizonte:</strong> {typeof horizonteAnos === "number" ? horizonteAnos : "—"} anos</div>
              <div><strong>Objetivo:</strong> {objetivo}</div>
              <div><strong>Liquidez:</strong> {liquidez}</div>
              <div><strong>Perda máxima aceitável:</strong> {typeof aceitaPerda === "number" ? aceitaPerda : "—"}%</div>
              <div><strong>Perfil sugerido:</strong> {suitability.perfil}</div>
            </div>
          </Section>

          <Section title="Conclusão preliminar">
            <div style={{ color: "#dbeafe", lineHeight: 1.6 }}>
              <div style={{ marginBottom: 10 }}>
                Esta página serve como base de onboarding e suitability. O resultado é indicativo e pode
                ser depois ligado ao fluxo regulamentar e ao motor DECIDE.
              </div>

              {suitability.redFlags.length ? (
                <div
                  style={{
                    background: "#2a0a0a",
                    border: "1px solid #7f1d1d",
                    borderRadius: 14,
                    padding: 14,
                  }}
                >
                  <div style={{ fontWeight: 800, marginBottom: 8 }}>Alertas</div>
                  {suitability.redFlags.map((flag, idx) => (
                    <div key={idx} style={{ marginBottom: 6 }}>
                      • {flag}
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
                  }}
                >
                  Sem alertas críticos neste preenchimento.
                </div>
              )}
            </div>
          </Section>
        </div>
      </div>

      <div
        style={{
          marginTop: 20,
          background: "rgba(24, 24, 27, 0.92)",
          border: "1px solid rgba(63, 63, 70, 0.85)",
          borderRadius: 22,
          padding: 20,
        }}
      >
        <div style={{ color: "#fff", fontSize: 22, fontWeight: 800, marginBottom: 10 }}>
          Confirmar Registo / Onboarding (Passo 1)
        </div>
        <div style={{ color: "#a1a1aa", fontSize: 14, marginBottom: 16 }}>
          Preenche todos os campos obrigatórios e confirma para avançar para o Teste MiFID.
        </div>

        {confirmAttempted && missingOnboardingFields.length > 0 ? (
          <div
            style={{
              background: "#2a0a0a",
              border: "1px solid #7f1d1d",
              borderRadius: 14,
              padding: 14,
              color: "#fee2e2",
              marginBottom: 14,
            }}
          >
            Faltam preencher: {missingOnboardingFields.join(", ")}.
          </div>
        ) : null}

        <button
          type="button"
          onClick={confirmAndGoNext}
          disabled={!canConfirmOnboarding}
          style={{
            background: canConfirmOnboarding ? DECIDE_DASHBOARD.buttonRegister : DECIDE_ONBOARDING.buttonDisabled,
            color: "#fff",
            border: canConfirmOnboarding ? DECIDE_ONBOARDING.buttonPrimaryBorder : DECIDE_ONBOARDING.inputBorder,
            borderRadius: 14,
            padding: "12px 18px",
            fontSize: 15,
            fontWeight: 800,
            cursor: canConfirmOnboarding ? "pointer" : "not-allowed",
          }}
        >
          Continuar
        </button>
      </div>
      </div>
    </div>
  );
}

export const getServerSideProps: GetServerSideProps = async () => {
  return {
    redirect: {
      destination: "/client-montante",
      permanent: false,
    },
  };
};