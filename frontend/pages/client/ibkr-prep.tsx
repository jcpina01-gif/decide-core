import React, { useEffect, useMemo, useState } from "react";
import type { GetServerSideProps } from "next";
import Head from "next/head";
import path from "path";
import fs from "fs";
import Link from "next/link";
import OnboardingFlowBar, { ONBOARDING_STORAGE_KEYS } from "../../components/OnboardingFlowBar";
import { buildPersonaReferenceIdFromSession } from "../../lib/personaReference";

function safeNumber(x: unknown, fallback = 0): number {
  if (typeof x === "number") return Number.isFinite(x) ? x : fallback;
  const v = Number(x as any);
  return Number.isFinite(v) ? v : fallback;
}

function safeString(x: unknown, fallback = ""): string {
  if (typeof x === "string") return x;
  if (typeof x === "number" && Number.isFinite(x)) return String(x);
  return fallback;
}

function formatEuro(v: number): string {
  return new Intl.NumberFormat("pt-PT", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(v);
}

function formatPtDateTime(iso: string | null): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "—";
    return new Intl.DateTimeFormat("pt-PT", {
      dateStyle: "short",
      timeStyle: "short",
    }).format(d);
  } catch {
    return "—";
  }
}

type PageProps = {
  navEur: number;
  ibkrOk: boolean;
  cashEur: number;
  accountCode: string;
  ibkrPort: number;
  diagUpdatedAt: string | null;
};

export const getServerSideProps: GetServerSideProps<PageProps> = async () => {
  const frontRoot = process.cwd();
  const projectRoot = path.resolve(frontRoot, "..");
  const tmpDir = path.join(projectRoot, "tmp_diag");

  const smokePath = path.join(tmpDir, "ibkr_paper_smoke_test.json");

  const smokeJson = fs.existsSync(smokePath) ? JSON.parse(fs.readFileSync(smokePath, "utf-8")) : null;

  const navEur = safeNumber(smokeJson?.selected?.netLiquidation?.value ?? smokeJson?.attempts?.[0]?.netLiquidation?.value);
  const ibkrOk = Boolean(smokeJson?.selected?.ok);
  const cashEur = safeNumber(smokeJson?.selected?.cash?.value ?? smokeJson?.attempts?.[0]?.cash?.value, 0);
  const accountCode = safeString(
    smokeJson?.selected?.accountCode ?? smokeJson?.attempts?.[0]?.accountCode,
    "",
  );
  const ibkrPort = safeNumber(smokeJson?.selected?.port ?? smokeJson?.attempts?.[0]?.port, 0);

  let diagUpdatedAt: string | null = null;
  try {
    if (fs.existsSync(smokePath)) {
      const st = fs.statSync(smokePath);
      diagUpdatedAt = st.mtime.toISOString();
    }
  } catch {
    diagUpdatedAt = null;
  }

  return {
    props: {
      navEur,
      ibkrOk,
      cashEur,
      accountCode,
      ibkrPort,
      diagUpdatedAt,
    },
  };
};

const IBKR_PREP_DONE_KEY = "decide_onboarding_ibkr_prep_done_v1";

/** Inferência discreta do tipo de conta (sem detalhes técnicos na UI). */
function accountTypeLabel(port: number): string {
  if (port === 7497) return "Conta de demonstração";
  if (port === 7496) return "Conta real (confirme na corretora se tiver dúvida)";
  if (port > 0) return "Conta ligada";
  return "Indisponível";
}

export default function IbkrPrepPage({ navEur, ibkrOk, cashEur, accountCode, ibkrPort, diagUpdatedAt }: PageProps) {
  const [mifidDone, setMifidDone] = useState(false);
  const [kycDone, setKycDone] = useState(false);
  /** null = a verificar no backend; só true se existir registo Persona com status completed. */
  const [serverKycOk, setServerKycOk] = useState<boolean | null>(null);
  /** Nome no registo de identidade (servidor DECIDE), quando existir. */
  const [personaNameOnRecord, setPersonaNameOnRecord] = useState<string | null>(null);
  const [ibkrPrepDone, setIbkrPrepDone] = useState(false);
  const [preparing, setPreparing] = useState(false);

  useEffect(() => {
    try {
      setIbkrPrepDone(window.localStorage.getItem(IBKR_PREP_DONE_KEY) === "1");
    } catch {
      setIbkrPrepDone(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let m = false;
      let k = false;
      try {
        m = window.localStorage.getItem(ONBOARDING_STORAGE_KEYS.mifid) === "1";
        k = window.localStorage.getItem(ONBOARDING_STORAGE_KEYS.kyc) === "1";
      } catch {
        m = false;
        k = false;
      }
      if (cancelled) return;
      setMifidDone(m);
      setKycDone(k);

      if (!k) {
        setServerKycOk(false);
        setPersonaNameOnRecord(null);
        return;
      }

      const ref = buildPersonaReferenceIdFromSession();
      if (!ref) {
        setServerKycOk(false);
        setPersonaNameOnRecord(null);
        try {
          window.localStorage.setItem(ONBOARDING_STORAGE_KEYS.kyc, "0");
          setKycDone(false);
        } catch {
          // ignore
        }
        return;
      }

      try {
        const r = await fetch(`/api/persona/status?reference_id=${encodeURIComponent(ref)}`);
        const j = await r.json().catch(() => ({}));
        if (cancelled) return;
        const rec = j?.record;
        const st = String(rec?.status ?? "").toLowerCase();
        const verified = Boolean(j?.ok && rec && st === "completed");
        const nm = typeof rec?.name === "string" ? rec.name.trim() : "";
        setPersonaNameOnRecord(verified && nm ? nm : verified ? "" : null);
        if (!verified) {
          try {
            window.localStorage.setItem(ONBOARDING_STORAGE_KEYS.kyc, "0");
            setKycDone(false);
          } catch {
            // ignore
          }
        }
        setServerKycOk(verified);
      } catch {
        if (cancelled) return;
        setServerKycOk(false);
        setPersonaNameOnRecord(null);
        try {
          window.localStorage.setItem(ONBOARDING_STORAGE_KEYS.kyc, "0");
          setKycDone(false);
        } catch {
          // ignore
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const canPrepare = mifidDone && kycDone && serverKycOk === true;
  /** Só mostramos o atalho para aprovação depois de «Preparar» (evita saltar o passo). */
  const canGoToApprove = canPrepare && ibkrPrepDone;

  const stepStateLabel = useMemo(() => {
    if (!canPrepare) return "Bloqueado — complete os passos anteriores";
    if (preparing) return "A preparar…";
    if (ibkrPrepDone) return "Preparado neste dispositivo";
    return "Pronto para preparar";
  }, [canPrepare, preparing, ibkrPrepDone]);

  const canPrepareNote = useMemo(() => {
    if (!mifidDone) return "Falta confirmar o perfil de investidor (MiFID).";
    if (!kycDone) return "Falta concluir a verificação de identidade.";
    if (serverKycOk === null) return "A validar a identidade no servidor…";
    if (!serverKycOk)
      return "A identidade não está confirmada no sistema. Volte ao passo «Identidade» e conclua a verificação (incluindo guardar a confirmação).";
    return "";
  }, [mifidDone, kycDone, serverKycOk]);

  function handlePrepareIbkr() {
    if (!canPrepare || preparing) return;
    setPreparing(true);
    try {
      window.localStorage.setItem(IBKR_PREP_DONE_KEY, "1");
      window.localStorage.setItem(ONBOARDING_STORAGE_KEYS.approve, "0");
    } catch {
      // ignore
    }
    window.location.href = "/client/approve";
  }

  return (
    <>
      <Head>
        <title>DECIDE — Preparar a sua conta para investir</title>
      </Head>
      <main className="min-h-screen bg-slate-950 text-slate-50">
        <div className="mx-auto max-w-5xl px-6 py-10">
          <OnboardingFlowBar currentStepId="approve" authStepHref="/client/login" />

          <header className="mb-8 border-b border-slate-800 pb-8">
            <p className="text-xs font-semibold uppercase tracking-wide text-sky-400">Passo corretora</p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
              Preparar a sua conta para investir
            </h1>
            <p className="mt-2 text-sm font-medium text-sky-300/90">Ligada à Interactive Brokers</p>
            <p className="mt-3 max-w-2xl text-sm leading-relaxed text-slate-300">
              Vamos organizar a sua conta para, mais à frente, poder <strong>ver e aprovar</strong> o plano de investimento.
              Nada é executado automaticamente — a decisão é sempre sua.
            </p>
            <p className="mt-2 text-xs text-slate-500">
              Estado deste passo: <span className="text-slate-400">{stepStateLabel}</span>
            </p>
          </header>

          {/* Bloco 1 — Resumo da conta */}
          <section className="mb-6 rounded-2xl border border-slate-800 bg-slate-900/50 p-5 shadow-lg">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Conta Interactive Brokers</h2>
            <p className="mt-1 text-xs text-slate-500">
              Resumo dos valores que temos da sua conta.{" "}
              <span className="text-slate-400">Dados atualizados automaticamente</span> quando há nova informação.
            </p>
            <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
              <div className="rounded-xl border border-slate-800/80 bg-slate-950/60 px-4 py-3">
                <dt className="text-xs text-slate-500">Estado da ligação</dt>
                <dd className="mt-1 font-semibold text-white">{ibkrOk ? "Conta ligada" : "Sem ligação neste momento"}</dd>
              </div>
              <div className="rounded-xl border border-slate-800/80 bg-slate-950/60 px-4 py-3">
                <dt className="text-xs text-slate-500">Tipo de conta</dt>
                <dd className="mt-1 font-semibold text-white">{accountTypeLabel(ibkrPort)}</dd>
              </div>
              <div className="rounded-xl border border-slate-800/80 bg-slate-950/60 px-4 py-3">
                <dt className="text-xs text-slate-500">Património líquido</dt>
                <dd className="mt-1 text-lg font-semibold text-sky-100">{navEur > 0 ? formatEuro(navEur) : "—"}</dd>
              </div>
              <div className="rounded-xl border border-slate-800/80 bg-slate-950/60 px-4 py-3">
                <dt className="text-xs text-slate-500">Dinheiro disponível</dt>
                <dd className="mt-1 font-semibold text-white">{cashEur > 0 ? formatEuro(cashEur) : "—"}</dd>
              </div>
              <div className="rounded-xl border border-slate-800/80 bg-slate-950/60 px-4 py-3 sm:col-span-2">
                <dt className="text-xs text-slate-500">Conta · última atualização</dt>
                <dd className="mt-1 text-slate-200">
                  {accountCode ? <span className="font-mono">{accountCode}</span> : <span>—</span>}
                  <span className="text-slate-500"> · </span>
                  <span className="text-slate-400">{formatPtDateTime(diagUpdatedAt)}</span>
                </dd>
              </div>
            </dl>
          </section>

          {/* Identidade confirmada no servidor DECIDE */}
          {serverKycOk === true ? (
            <section className="mb-6 rounded-2xl border border-emerald-900/50 bg-emerald-950/20 p-5">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-emerald-400/90">Identidade no sistema</h2>
              <p className="mt-2 text-sm text-emerald-100/90">
                Nome associado ao registo de verificação:{" "}
                <strong className="text-white">{personaNameOnRecord && personaNameOnRecord.length > 0 ? personaNameOnRecord : "—"}</strong>
              </p>
              {personaNameOnRecord === "" && (
                <p className="mt-2 text-xs text-emerald-200/70">
                  A identidade está confirmada; o nome completo pode não aparecer aqui. Se precisar de rever ou corrigir, use o
                  passo «Identidade».
                </p>
              )}
            </section>
          ) : null}

          {!canPrepare ? (
            <section className="mb-6 rounded-xl border border-amber-800 bg-amber-950/40 p-4">
              <div className="text-sm font-semibold text-amber-100">Não é possível avançar ainda</div>
              <div className="mt-1 text-xs text-amber-200">{canPrepareNote}</div>
            </section>
          ) : null}

          {/* Bloco 2 — O que acontece (preparação vs aprovação) */}
          <section className="mb-6 rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
            <h2 className="text-lg font-semibold text-white">O que acontece neste passo</h2>
            <ul className="mt-4 list-inside list-disc space-y-1.5 text-sm font-medium leading-relaxed text-slate-200">
              <li>Validamos a sua conta</li>
              <li>Preparamos o seu plano</li>
              <li>Poderá rever antes de decidir</li>
            </ul>

            <div className="mt-8 flex flex-wrap items-center gap-3 border-t border-slate-800 pt-6">
              <button
                type="button"
                onClick={handlePrepareIbkr}
                disabled={!canPrepare || preparing}
                className={`rounded-full px-5 py-2.5 text-sm font-semibold transition ${
                  canPrepare && !preparing
                    ? "bg-emerald-500 text-emerald-950 hover:bg-emerald-400"
                    : "cursor-not-allowed bg-emerald-900/50 text-emerald-800/80 opacity-60"
                }`}
              >
                {preparing ? "A redirecionar…" : "Preparar conta"}
              </button>
              <Link
                href="/client/report"
                className="rounded-full border border-slate-600 px-4 py-2 text-sm font-medium text-slate-100 hover:border-slate-400"
              >
                Ver plano sugerido
              </Link>
            </div>
          </section>

          {/* Bloco 3 — Aprovação: só após preparar neste dispositivo */}
          <section className="mb-10 rounded-2xl border border-violet-900/40 bg-violet-950/20 p-6">
            <h2 className="text-lg font-semibold text-violet-100">Aprovar o plano</h2>
            <p className="mt-2 text-sm font-medium text-violet-100/95">Este é o passo onde decide se quer investir.</p>
            <p className="mt-2 text-sm text-violet-200/85">
              Depois de preparar a conta, poderá rever e aprovar o seu plano.
            </p>
            <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
              {canGoToApprove ? (
                <Link
                  href="/client/approve"
                  className="inline-flex w-fit rounded-full border border-violet-400/50 bg-violet-500/10 px-5 py-2.5 text-sm font-semibold text-violet-100 hover:bg-violet-500/20"
                >
                  Ir para aprovar o plano
                </Link>
              ) : (
                <span className="inline-flex w-fit cursor-not-allowed rounded-full border border-slate-700 bg-slate-900/60 px-5 py-2.5 text-sm font-semibold text-slate-500">
                  Ir para aprovar o plano
                </span>
              )}
            </div>
            {!canPrepare ? (
              <p className="mt-3 text-xs text-slate-500">Complete primeiro o perfil e a identidade para desbloquear este passo.</p>
            ) : !ibkrPrepDone ? (
              <p className="mt-3 text-xs text-violet-300/80">Prepare a conta antes de avançar — use o botão verde acima.</p>
            ) : null}
          </section>
        </div>
      </main>
    </>
  );
}
