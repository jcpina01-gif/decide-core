import React, { useState } from "react";
import type { GetServerSideProps } from "next";
import Head from "next/head";
import Link from "next/link";
import OnboardingFlowBar, {
  ONBOARDING_STORAGE_KEYS,
} from "../../components/OnboardingFlowBar";
import path from "path";
import fs from "fs";

type ProposedTrade = {
  ticker: string;
  side: string;
  absQty: number;
  marketPrice: number;
  deltaValueEst: number;
  targetWeightPct: number;
  nameShort: string;
};

type PageProps = {
  navEur: number;
  trades: ProposedTrade[];
  ibkrOk: boolean;
  cashEur: number;
  accountCode: string;
};

const IBKR_PREP_DONE_KEY = "decide_onboarding_ibkr_prep_done_v1";

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];

    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (ch === "," && !inQuotes) {
      out.push(cur);
      cur = "";
      continue;
    }

    cur += ch;
  }

  out.push(cur);
  return out;
}

function parseCsv(text: string): Record<string, string>[] {
  const lines = text
    .replace(/\r/g, "")
    .split("\n")
    .filter((x) => x.trim().length > 0);

  if (lines.length === 0) return [];

  const headers = splitCsvLine(lines[0]).map((h) => h.trim());
  const rows: Record<string, string>[] = [];

  for (let i = 1; i < lines.length; i += 1) {
    const cols = splitCsvLine(lines[i]);
    const row: Record<string, string> = {};
    for (let j = 0; j < headers.length; j += 1) {
      row[headers[j]] = cols[j] ?? "";
    }
    rows.push(row);
  }

  return rows;
}

function safeNumber(x: unknown, fallback = 0): number {
  if (typeof x === "number") {
    return Number.isFinite(x) ? x : fallback;
  }

  if (typeof x === "string") {
    // Remove símbolos como "€", espaços e letras
    let s = x.replace(/\s+/g, "").replace(/[^0-9,.\-]/g, "");

    // Caso típico PT: "1.234,56" → "1234.56"
    const commaCount = (s.match(/,/g) || []).length;
    const dotCount = (s.match(/\./g) || []).length;

    if (commaCount === 1 && dotCount === 0) {
      // "1234,56" → "1234.56"
      s = s.replace(",", ".");
    } else if (commaCount === 1 && dotCount === 1 && s.indexOf(".") < s.indexOf(",")) {
      // "1.234,56" → "1234.56"
      s = s.replace(".", "").replace(",", ".");
    }

    const v = Number(s);
    return Number.isFinite(v) ? v : fallback;
  }

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

function formatPct(v: number, digits = 2): string {
  return `${v.toFixed(digits)}%`;
}

export const getServerSideProps: GetServerSideProps<PageProps> = async () => {
  const frontRoot = process.cwd();
  const projectRoot = path.resolve(frontRoot, "..");
  const tmpDir = path.join(projectRoot, "tmp_diag");

  const smokePath = path.join(tmpDir, "ibkr_paper_smoke_test.json");
  const tradePlanPath = path.join(tmpDir, "decide_trade_plan_ibkr.csv");

  const smokeJson = fs.existsSync(smokePath)
    ? JSON.parse(fs.readFileSync(smokePath, "utf-8"))
    : null;

  const tradePlanRows = fs.existsSync(tradePlanPath)
    ? parseCsv(fs.readFileSync(tradePlanPath, "utf-8"))
    : [];

  const navEur = safeNumber(
    smokeJson?.selected?.netLiquidation?.value ??
      smokeJson?.attempts?.[0]?.netLiquidation?.value,
  );

  const ibkrOk = Boolean(smokeJson?.selected?.ok);
  const cashEur = safeNumber(
    smokeJson?.selected?.cash?.value ?? smokeJson?.attempts?.[0]?.cash?.value,
    0,
  );
  const accountCode = safeString(
    smokeJson?.selected?.accountCode ?? smokeJson?.attempts?.[0]?.accountCode,
    "",
  );

  const trades: ProposedTrade[] = tradePlanRows.map((row) => {
    const absQty = safeNumber(row.abs_qty ?? row.absQty ?? row.Qty);
    const marketPrice = safeNumber(row.market_price ?? row.MarketPrice);
    // CSV tem a coluna delta_value_est
    const rawDelta = safeNumber(
      row.delta_value_est ?? row.delta_val_est ?? row.DeltaValueEst,
    );

    // Se o delta vindo do backend for 0, recalculamos como qty * preço atual
    const deltaValueEst =
      Number.isFinite(rawDelta) && Math.abs(rawDelta) > 0
        ? rawDelta
        : absQty * marketPrice;

    return {
      ticker: row.ticker ?? row.Ticker ?? "",
      side: row.side ?? row.Side ?? "",
      absQty,
      marketPrice,
      deltaValueEst,
      targetWeightPct: safeNumber(row.target_weight_pct ?? row.TargetWeightPct),
      nameShort: (row.name_short ?? row.NameShort ?? row.Name ?? "").toString(),
    };
  });

  return {
    props: {
      navEur,
      trades,
      ibkrOk,
      cashEur,
      accountCode,
    },
  };
};

export default function ApprovePage({
  navEur,
  trades,
  ibkrOk,
  cashEur,
  accountCode,
}: PageProps) {
  const [flowReady, setFlowReady] = useState(false);
  const [mifidDone, setMifidDone] = useState(false);
  const [kycDone, setKycDone] = useState(false);
  const [ibkrPrepDone, setIbkrPrepDone] = useState(false);
  const [userApproved, setUserApproved] = useState(false);

  const [excludedTickers, setExcludedTickers] = useState<string[]>([]);

  const canExclude = navEur >= 50000;
  const maxExclusions = canExclude ? 5 : 0;

  const canApproveIbkr = ibkrOk && navEur > 0 && trades.length > 0;
  const canApproveAll = canApproveIbkr && mifidDone && kycDone && ibkrPrepDone;

  const handleToggle = (ticker: string) => {
    if (!canExclude) return;
    setExcludedTickers((prev) => {
      if (prev.includes(ticker)) {
        return prev.filter((t) => t !== ticker);
      }
      if (prev.length >= maxExclusions) {
        return prev;
      }
      return [...prev, ticker];
    });
  };

  const approvedTrades = trades.filter(
    (t) => !excludedTickers.includes(t.ticker),
  );

  // Antes de renderizar o fluxo (OnboardingFlowBar), garantimos que:
  // - resetamos o passo "approve" se ainda não for permitido
  // - e só marcamos "ordens aprovadas" depois do utilizador clicar.
  React.useEffect(() => {
    try {
      const mifid = window.localStorage.getItem(ONBOARDING_STORAGE_KEYS.mifid) === "1";
      const kyc = window.localStorage.getItem(ONBOARDING_STORAGE_KEYS.kyc) === "1";
      const approve = window.localStorage.getItem(ONBOARDING_STORAGE_KEYS.approve) === "1";
      const ibkrPrep = window.localStorage.getItem(IBKR_PREP_DONE_KEY) === "1";

      setMifidDone(mifid);
      setKycDone(kyc);
      setIbkrPrepDone(ibkrPrep);

      const allowed = canApproveIbkr && mifid && kyc && ibkrPrep;
      if (!allowed) {
        window.localStorage.setItem(ONBOARDING_STORAGE_KEYS.approve, "0");
        setUserApproved(false);
      } else {
        setUserApproved(approve);
      }
    } catch {
      setUserApproved(false);
      setMifidDone(false);
      setKycDone(false);
    } finally {
      setFlowReady(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canApproveIbkr]);

  const handleApprove = () => {
    if (!canApproveAll) {
      // eslint-disable-next-line no-alert
      alert(
        "Aprovação bloqueada: confirma primeiro MiFID + KYC (Persona), executa a preparação IBKR e só depois valida IBKR (paper) com NetLiquidation/saldo > 0."
      );
      return;
    }
    try {
      window.localStorage.setItem(ONBOARDING_STORAGE_KEYS.approve, "1");
    } catch {
      // ignore
    }
    setUserApproved(true);
    // Nesta fase a aprovação é só UI; o envio real é feito pelo micro-backend.
    // eslint-disable-next-line no-alert
    alert(
      `Aprovou ${approvedTrades.length} ordens${
        excludedTickers.length > 0
          ? ` (excluídas: ${excludedTickers.join(", ")})`
          : ""
      }.\n\nPara enviar para o TWS, corre:\npython backend/tools/send_trade_plan_to_tws.py`
    );
  };

  const handleReject = () => {
    try {
      window.localStorage.setItem(ONBOARDING_STORAGE_KEYS.approve, "0");
    } catch {}
    setUserApproved(false);
    // eslint-disable-next-line no-alert
    alert("Plano de rebalance não aprovado.");
  };

  const totalDelta = approvedTrades.reduce(
    (acc, t) => acc + t.deltaValueEst,
    0,
  );

  return (
    <>
      <Head>
        <title>DECIDE – Aprovação de recomendações</title>
      </Head>
      <main className="min-h-screen bg-slate-950 text-slate-50">
        <div className="mx-auto max-w-5xl px-6 py-10">
          {flowReady ? <OnboardingFlowBar currentStepId="approve" authStepHref="/client/login" /> : null}
          <header className="mb-8 border-b border-slate-800 pb-6">
            <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
              <div>
                <h1 className="text-2xl font-semibold tracking-tight">
                  Aprovação de recomendações
                </h1>
                <p className="mt-1 text-xs text-slate-500">
                  Dados baseados no último rebalance real disponível
                  (ficheiros em tmp_diag). Para atualizar, volte a correr o
                  processo de rebalance e reabra esta página.
                </p>
              </div>
              <div className="rounded-2xl border border-sky-700 bg-sky-950/40 px-5 py-3 text-right shadow-lg">
                <div className="text-[11px] uppercase tracking-wide text-sky-300">
                  Património atual estimado
                </div>
                <div className="mt-1 text-2xl font-semibold text-slate-50">
                  {navEur > 0 ? formatEuro(navEur) : "—"}
                </div>
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-4 text-xs text-slate-500">
              <div>
                Limite de exclusões:{" "}
                <span className="font-medium text-slate-100">
                  {canExclude ? `${maxExclusions} ordens` : "não aplicável"}
                </span>
                {!canExclude && (
                  <span className="ml-1">
                    · Clientes com património &ge; 50&nbsp;000&nbsp;€ podem
                    excluir até 5 ordens.
                  </span>
                )}
              </div>
              <Link
                href="/client/report"
                className="text-xs text-sky-400 hover:text-sky-300"
              >
                Ver relatório detalhado do rebalance
              </Link>
            </div>
          </header>

          <section className="mb-6 flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm text-slate-300">
              {canExclude ? (
                <>
                  Pode{" "}
                  <span className="font-semibold">
                    excluir até {maxExclusions} ordens
                  </span>
                  . Se não excluir, considera-se aprovação integral do plano.
                </>
              ) : (
                <>
                  Para este nível de património,{" "}
                  <span className="font-semibold">
                    o plano é aprovado ou não aprovado na totalidade
                  </span>
                  .
                </>
              )}
            </div>
            <Link
              href="/client/report"
              className="text-xs text-sky-400 hover:text-sky-300"
            >
              Ver relatório detalhado do rebalance
            </Link>
          </section>

          {flowReady && !canApproveAll && (
            <section className="mb-6 rounded-xl border border-amber-800 bg-amber-950/40 p-4">
              <div className="text-sm font-semibold text-amber-100">
                Aprovação bloqueada: precisa de IBKR + saldo
              </div>
              <div className="mt-1 text-xs text-amber-200">
                {!mifidDone && "Falta confirmar o Teste MiFID."}
                {!kycDone && " Falta confirmar o KYC (Persona)."}
                {mifidDone && kycDone && !ibkrPrepDone ? " Falta preparar IBKR (passo intermédio)." : null}
                {mifidDone && kycDone
                  ? canApproveIbkr
                    ? "Pode ser necessário atualizar as ordens do último rebalance."
                    : ibkrOk
                      ? navEur > 0
                        ? "O diagnóstico IBKR está ok, mas ainda não há ordens no último rebalance."
                        : `NetLiquidation/saldo insuficiente (${formatEuro(navEur)}).`
                      : "Não foi possível validar a ligação ao IBKR (paper). Executa o diagnóstico antes de aprovar."
                  : null}
                {accountCode ? ` Conta: ${accountCode}.` : ""}
                {cashEur > 0 ? ` Cash: ${formatEuro(cashEur)}.` : ""}
              </div>
            </section>
          )}

          <section className="mb-8 rounded-xl border border-slate-800 bg-slate-900/60 p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <div className="text-sm font-medium text-slate-100">
                Resumo da decisão{userApproved ? " (aprovado)" : ""}
              </div>
              <div className="text-xs text-slate-400">
                {userApproved ? "Ordens aprovadas: " : "Ordens candidatas: "}
                <span className="font-semibold text-slate-100">
                  {approvedTrades.length}/{trades.length}
                </span>{" "}
                · Excluídas:{" "}
                <span className="font-semibold text-slate-100">
                  {excludedTickers.length}
                </span>{" "}
                · Impacto líquido estimado:{" "}
                <span className="font-semibold text-slate-100">
                  {formatEuro(totalDelta)}
                </span>
              </div>
            </div>
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={handleApprove}
                disabled={!canApproveAll}
                className={`rounded-full px-4 py-2 text-sm font-medium text-emerald-950 hover:bg-emerald-400 ${
                  canApproveAll
                    ? "bg-emerald-500"
                    : "bg-emerald-900 opacity-50 cursor-not-allowed"
                }`}
              >
                Aprovar plano
                {excludedTickers.length > 0
                  ? " com exclusões"
                  : " (todas as ordens)"}
              </button>
              <button
                type="button"
                onClick={handleReject}
                className="rounded-full border border-slate-600 px-4 py-2 text-sm font-medium text-slate-100 hover:border-red-500 hover:text-red-200"
              >
                Não aprovar
              </button>
            </div>
          </section>

          <section>
            <div className="mb-3 text-sm font-medium text-slate-100">
              Ordens propostas
            </div>
            <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-900/60">
              <table className="min-w-full text-xs">
                <thead className="bg-slate-900/80 text-slate-400">
                  <tr>
                    <th className="px-3 py-2 text-left">
                      {canExclude ? "Excluir" : "#"}
                    </th>
                    <th className="px-3 py-2 text-left">Ticker</th>
                    <th className="px-3 py-2 text-left">Nome</th>
                    <th className="px-3 py-2 text-right">Sentido</th>
                    <th className="px-3 py-2 text-right">Quantidade</th>
                    <th className="px-3 py-2 text-right">Preço</th>
                    <th className="px-3 py-2 text-right">
                      Valor estimado (&Delta;)
                    </th>
                    <th className="px-3 py-2 text-right">Peso alvo</th>
                  </tr>
                </thead>
                <tbody>
                  {trades.map((t, idx) => {
                    const excluded = excludedTickers.includes(t.ticker);
                    const disableCheckbox =
                      !excluded &&
                      canExclude &&
                      excludedTickers.length >= maxExclusions;

                    return (
                      <tr
                        key={`${t.ticker}-${idx}`}
                        className={
                          excluded
                            ? "bg-slate-900/70 text-slate-500"
                            : "hover:bg-slate-800/60"
                        }
                      >
                        <td className="px-3 py-2">
                          {canExclude ? (
                            <input
                              type="checkbox"
                              checked={excluded}
                              disabled={disableCheckbox}
                              onChange={() => handleToggle(t.ticker)}
                            />
                          ) : (
                            idx + 1
                          )}
                        </td>
                        <td className="px-3 py-2 font-semibold text-slate-100">
                          {t.ticker}
                        </td>
                        <td className="px-3 py-2 text-slate-300">
                          {t.nameShort || "-"}
                        </td>
                        <td className="px-3 py-2 text-right">
                          {t.side.toUpperCase()}
                        </td>
                        <td className="px-3 py-2 text-right">
                          {t.absQty.toLocaleString("pt-PT")}
                        </td>
                        <td className="px-3 py-2 text-right">
                          {formatEuro(t.marketPrice)}
                        </td>
                        <td className="px-3 py-2 text-right">
                          {formatEuro(t.deltaValueEst)}
                        </td>
                        <td className="px-3 py-2 text-right">
                          {formatPct(t.targetWeightPct)}
                        </td>
                      </tr>
                    );
                  })}
                  {trades.length === 0 && (
                    <tr>
                      <td
                        colSpan={8}
                        className="px-3 py-5 text-center text-slate-400"
                      >
                        Não foram encontradas ordens no último rebalance
                        (ficheiro decide_trade_plan_ibkr.csv).
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </main>
    </>
  );
}

