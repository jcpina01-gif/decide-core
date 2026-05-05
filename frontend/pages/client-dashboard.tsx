import Head from "next/head";
import { useRouter } from "next/router";
import React, { useEffect, useMemo, useState } from "react";
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, ReferenceLine,
} from "recharts";
import {
  LayoutDashboard, BookOpen, Briefcase, TrendingUp, ShieldCheck,
  Clock, Settings, LogOut, ChevronDown, Info, ArrowUpRight,
  ArrowDownRight, Minus, AlertCircle, Cpu,
} from "lucide-react";
import { isClientLoggedIn, getCurrentSessionUser } from "../lib/clientAuth";
import { useSyncedRiskProfileFromOnboarding } from "../hooks/useSyncedRiskProfileFromOnboarding";

/* ─── sector mapping ─────────────────────────────────────── */
const SECTOR: Record<string, string> = {
  AAPL:"Tecnologia", NVDA:"Tecnologia", MSFT:"Tecnologia", GOOGL:"Tecnologia",
  META:"Tecnologia", AVGO:"Tecnologia", AMD:"Tecnologia", CRM:"Tecnologia",
  ORCL:"Tecnologia", QCOM:"Tecnologia", TXN:"Tecnologia", AMAT:"Tecnologia",
  KLAC:"Tecnologia", LRCX:"Tecnologia", SNPS:"Tecnologia", CDNS:"Tecnologia",
  CTSH:"Tecnologia", NOW:"Tecnologia", ADBE:"Tecnologia", INTU:"Tecnologia",
  JPM:"Financeiro", GS:"Financeiro", MS:"Financeiro", BAC:"Financeiro",
  V:"Financeiro", MA:"Financeiro", AXP:"Financeiro", BLK:"Financeiro",
  SPGI:"Financeiro", ICE:"Financeiro", MCO:"Financeiro", COF:"Financeiro",
  BKNG:"Cons. Discr.", AMZN:"Cons. Discr.", TSLA:"Cons. Discr.",
  NKE:"Cons. Discr.", MCD:"Cons. Discr.", SBUX:"Cons. Discr.",
  TJX:"Cons. Discr.", LOW:"Cons. Discr.", HD:"Cons. Discr.",
  CAT:"Industrial", HON:"Industrial", MMM:"Industrial", GE:"Industrial",
  LMT:"Industrial", RTX:"Industrial", UNP:"Industrial", CSX:"Industrial",
  DE:"Industrial", EMR:"Industrial", ETN:"Industrial",
  UNH:"Saúde", JNJ:"Saúde", LLY:"Saúde", ABBV:"Saúde",
  MRK:"Saúde", PFE:"Saúde", TMO:"Saúde", ABT:"Saúde",
  XOM:"Energia", CVX:"Energia", COP:"Energia", EOG:"Energia",
  PXD:"Energia", SLB:"Energia", PSX:"Energia", VLO:"Energia",
  WMT:"Cons. Básico", PG:"Cons. Básico", KO:"Cons. Básico",
  PEP:"Cons. Básico", COST:"Cons. Básico", MDLZ:"Cons. Básico",
  NEE:"Utilities", DUK:"Utilities", SO:"Utilities",
  AMT:"Real Estate", PLD:"Real Estate", EQIX:"Real Estate",
};
function getSector(ticker: string): string {
  return SECTOR[ticker.toUpperCase()] ?? "Outros";
}

/* ─── maths helpers ──────────────────────────────────────── */
function cagr(start: number, end: number, years: number): number {
  if (!start || start <= 0 || years <= 0) return 0;
  return Math.pow(end / start, 1 / years) - 1;
}
function annualVol(returns: number[]): number {
  if (returns.length < 5) return 0;
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((a, b) => a + (b - mean) ** 2, 0) / (returns.length - 1);
  return Math.sqrt(variance) * Math.sqrt(252);
}
function sharpe(returns: number[], rf = 0): number {
  if (returns.length < 5) return 0;
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const vol = annualVol(returns) / Math.sqrt(252);
  if (!vol) return 0;
  return ((mean - rf / 252) / vol) * Math.sqrt(252);
}
function currentDrawdown(equity: number[]): number {
  if (!equity.length) return 0;
  let peak = equity[0];
  let dd = 0;
  for (const v of equity) {
    if (v > peak) peak = v;
    const d = (v - peak) / peak;
    if (d < dd) dd = d;
  }
  return dd;
}
function rollingDrawdownSeries(
  dates: string[], equity: number[], step = 7
): { date: string; dd: number }[] {
  const out: { date: string; dd: number }[] = [];
  let peak = equity[0] ?? 1;
  for (let i = 0; i < equity.length; i += step) {
    if (equity[i] > peak) peak = equity[i];
    out.push({ date: dates[i].slice(0, 7), dd: ((equity[i] - peak) / peak) * 100 });
  }
  return out;
}

/* ─── types ──────────────────────────────────────────────── */
type WeightRow = { ticker: string; weight: number; weightPct: number; score: number };
type RecoMonth  = { date?: string; rebalance_date?: string; rows: WeightRow[]; tbillsTotalPct?: number; equitySleeveTotalPct?: number };

/* ─── sidebar ────────────────────────────────────────────── */
const NAV = [
  { id:"dashboard", label:"Dashboard",      Icon:LayoutDashboard },
  { id:"reco",      label:"Recomendações",  Icon:BookOpen        },
  { id:"carteira",  label:"Carteira",       Icon:Briefcase       },
  { id:"perf",      label:"Performance",    Icon:TrendingUp      },
  { id:"risco",     label:"Risco",          Icon:ShieldCheck     },
  { id:"historico", label:"Histórico",      Icon:Clock           },
  { id:"defs",      label:"Definições",     Icon:Settings        },
];

function Sidebar({ user, profile, active }: { user:string|null; profile:string; active:string }) {
  const router = useRouter();
  const initials = user ? user.slice(0,2).toUpperCase() : "JC";
  const profilePt = profile === "conservador" ? "Conservador" : profile === "dinamico" ? "Dinâmico" : "Moderado";
  return (
    <aside className="flex flex-col w-56 min-h-screen bg-[#0b1629] border-r border-[#1e2d45] shrink-0">
      {/* logo */}
      <div className="px-5 py-5 border-b border-[#1e2d45]">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-teal-500 flex items-center justify-center">
            <Cpu size={16} className="text-white" />
          </div>
          <div>
            <div className="text-white font-bold text-sm leading-tight">DECIDE</div>
            <div className="text-slate-400 text-[10px] leading-tight">Advisory Quantitativo</div>
          </div>
        </div>
      </div>
      {/* nav */}
      <nav className="flex-1 px-3 py-4 space-y-0.5">
        {NAV.map(({ id, label, Icon }) => {
          const isActive = active === id;
          return (
            <button
              key={id}
              onClick={() => { if (id === "dashboard") router.push("/client-dashboard"); }}
              className={[
                "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
                isActive
                  ? "bg-teal-500/15 text-teal-400 border border-teal-500/25"
                  : "text-slate-400 hover:text-slate-200 hover:bg-white/5",
              ].join(" ")}
            >
              <Icon size={16} />
              {label}
            </button>
          );
        })}
      </nav>
      {/* user */}
      <div className="px-3 py-4 border-t border-[#1e2d45] space-y-1">
        <div className="flex items-center gap-3 px-3 py-2">
          <div className="w-8 h-8 rounded-full bg-teal-600 flex items-center justify-center text-white font-bold text-xs shrink-0">
            {initials}
          </div>
          <div className="min-w-0">
            <div className="text-slate-200 text-xs font-semibold truncate">{user ?? "João Cliente"}</div>
            <div className="text-slate-400 text-[10px]">Perfil: {profilePt}</div>
          </div>
        </div>
        <button
          onClick={() => router.push("/client/logout")}
          className="w-full flex items-center gap-3 px-3 py-2 text-slate-500 hover:text-slate-300 text-xs rounded-lg hover:bg-white/5 transition-colors"
        >
          <LogOut size={14} />
          Sair
        </button>
      </div>
    </aside>
  );
}

/* ─── stat badge ─────────────────────────────────────────── */
function ActionBadge({ label, count, color }: { label:string; count:number; color:string }) {
  const Icon = label === "COMPRAR" ? ArrowUpRight
    : label === "VENDER" ? ArrowDownRight
    : label === "REDUZIR" ? ArrowDownRight
    : Minus;
  const bar = label === "COMPRAR" ? "bg-emerald-500"
    : label === "VENDER" ? "bg-red-500"
    : label === "REDUZIR" ? "bg-amber-500"
    : "bg-slate-500";
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1.5">
        <span className={`text-3xl font-black ${color}`}>{count}</span>
        <Icon size={20} className={color} />
      </div>
      <div className="text-slate-400 text-[11px] font-semibold tracking-wide">{label}</div>
      <div className={`h-0.5 rounded-full ${bar} opacity-60`} />
    </div>
  );
}

/* ─── section header ─────────────────────────────────────── */
function SectionHeader({ title }: { title: string }) {
  return (
    <div className="flex items-center gap-2 mb-4">
      <h2 className="text-slate-200 text-sm font-bold tracking-wide uppercase">{title}</h2>
      <Info size={13} className="text-slate-500" />
    </div>
  );
}

/* ─── performance period tabs ────────────────────────────── */
const PERIODS = ["YTD","1 Ano","3 Anos","5 Anos","Desde início"] as const;
type Period = (typeof PERIODS)[number];

function periodSlice(dates: string[], equity: number[], bench: number[], period: Period) {
  if (!dates.length) return { dates:[], equity:[], bench:[] };
  const last = new Date(dates[dates.length-1]);
  let cutoff: Date;
  if (period === "YTD") cutoff = new Date(last.getFullYear(), 0, 1);
  else if (period === "1 Ano") cutoff = new Date(last.getFullYear()-1, last.getMonth(), last.getDate());
  else if (period === "3 Anos") cutoff = new Date(last.getFullYear()-3, last.getMonth(), last.getDate());
  else if (period === "5 Anos") cutoff = new Date(last.getFullYear()-5, last.getMonth(), last.getDate());
  else cutoff = new Date(dates[0]);
  const idx = dates.findIndex(d => new Date(d) >= cutoff);
  const start = idx < 0 ? 0 : idx;
  const base = equity[start] || 1;
  const bbase = bench[start] || 1;
  // subsample to ~200 pts max for chart performance
  const slice = dates.slice(start);
  const step = Math.max(1, Math.floor(slice.length / 200));
  const out = { dates:[] as string[], equity:[] as number[], bench:[] as number[] };
  for (let i = 0; i < slice.length; i += step) {
    out.dates.push(slice[i]);
    out.equity.push(((equity[start+i] ?? equity[start]) / base - 1) * 100);
    out.bench.push(((bench[start+i] ?? bench[start]) / bbase - 1) * 100);
  }
  return out;
}

function periodMetrics(equity: number[], bench: number[], period: Period) {
  if (equity.length < 2) return { ret:0, annRet:0, sharpeVal:0, benchRet:0 };
  const years = period === "YTD" ? (new Date().getMonth()+1)/12
    : period === "1 Ano" ? 1 : period === "3 Anos" ? 3 : period === "5 Anos" ? 5
    : (equity.length / 252);
  const totalRet = (equity[equity.length-1] / equity[0]) - 1;
  const totalBench = (bench[bench.length-1] / bench[0]) - 1;
  const annRet = cagr(equity[0], equity[equity.length-1], years);
  const rets = equity.slice(1).map((v,i) => v/equity[i]-1);
  const shp = sharpe(rets);
  return { ret: totalRet*100, annRet: annRet*100, sharpeVal: shp, benchRet: totalBench*100 };
}

const PIE_COLORS = ["#14b8a6","#3b82f6","#f59e0b","#8b5cf6","#22c55e","#ef4444","#64748b"];

/* ─── custom tooltip ─────────────────────────────────────── */
function PerfTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-xs">
      <div className="text-slate-300 mb-1">{label}</div>
      {payload.map((p: any) => (
        <div key={p.dataKey} style={{ color: p.color }}>
          {p.name}: {p.value?.toFixed(1)}%
        </div>
      ))}
    </div>
  );
}

/* ─── main page ──────────────────────────────────────────── */
export default function ClientDashboardPage() {
  const router = useRouter();
  const { profile } = useSyncedRiskProfileFromOnboarding();
  const [mounted, setMounted] = useState(false);
  const [sessionUser, setSessionUser] = useState<string|null>(null);
  const [loggedIn, setLoggedIn] = useState(false);
  const [period, setPeriod] = useState<Period>("5 Anos");

  // freeze series
  const [dates, setDates] = useState<string[]>([]);
  const [equityRaw, setEquityRaw] = useState<number[]>([]);
  const [benchRaw, setBenchRaw] = useState<number[]>([]);

  // recommendations
  const [recoMonths, setRecoMonths] = useState<RecoMonth[]>([]);
  const [recoLoading, setRecoLoading] = useState(true);

  /* auth */
  useEffect(() => {
    setMounted(true);
    try {
      setSessionUser(getCurrentSessionUser());
      setLoggedIn(isClientLoggedIn());
    } catch { /* */ }
  }, []);

  useEffect(() => {
    if (mounted && !loggedIn) {
      void router.replace("/client/login");
    }
  }, [mounted, loggedIn, router]);

  /* fetch freeze series */
  useEffect(() => {
    fetch("/api/landing/freeze-cap15-backtest")
      .then(r => r.json())
      .then((d: any) => {
        if (d?.series) {
          setDates(d.series.dates ?? []);
          setEquityRaw(d.series.equity_overlayed ?? []);
          setBenchRaw(d.series.benchmark_equity ?? []);
        }
      })
      .catch(() => {});
  }, []);

  /* fetch recommendations */
  useEffect(() => {
    setRecoLoading(true);
    fetch("/api/client/recommendations-history")
      .then(r => r.json())
      .then((d: any) => {
        if (d?.months) setRecoMonths(d.months);
      })
      .catch(() => {})
      .finally(() => setRecoLoading(false));
  }, []);

  /* ── derived: latest 2 reco months ── */
  const latestMonth = recoMonths[recoMonths.length - 1];
  const prevMonth   = recoMonths[recoMonths.length - 2];

  /* ── action counts (comprar/reduzir/vender/manter) ── */
  const actionCounts = useMemo(() => {
    if (!latestMonth || !prevMonth) return { comprar:0, reduzir:0, vender:0, manter:0, rows:[] as {ticker:string;prev:number;cur:number;delta:number;action:string}[] };
    const prevMap = new Map(prevMonth.rows.map(r => [r.ticker, r.weightPct]));
    const curMap  = new Map(latestMonth.rows.map(r => [r.ticker, r.weightPct]));
    const allTickers = new Set([...prevMap.keys(), ...curMap.keys()].filter(t => t !== "TBILL_PROXY"));
    let comprar=0, reduzir=0, vender=0, manter=0;
    const rows: {ticker:string;prev:number;cur:number;delta:number;action:string}[] = [];
    allTickers.forEach(t => {
      const p = prevMap.get(t) ?? 0;
      const c = curMap.get(t) ?? 0;
      const delta = c - p;
      let action = "Manter";
      if (p === 0 && c > 0)            { action="Comprar"; comprar++; }
      else if (c === 0 && p > 0)       { action="Vender";  vender++;  }
      else if (delta >  0.3)           { action="Comprar"; comprar++; }
      else if (delta < -0.3)           { action="Reduzir"; reduzir++; }
      else                              { action="Manter";  manter++;  }
      if (action !== "Manter")
        rows.push({ ticker:t, prev:p, cur:c, delta, action });
    });
    // also count unchanged positions as manter
    manter = allTickers.size - comprar - reduzir - vender;
    return { comprar, reduzir, vender, manter, rows: rows.sort((a,b) => Math.abs(b.delta)-Math.abs(a.delta)).slice(0,6) };
  }, [latestMonth, prevMonth]);

  /* ── sector allocation ── */
  const sectorData = useMemo(() => {
    if (!latestMonth) return [];
    const map = new Map<string, number>();
    latestMonth.rows.forEach(r => {
      if (r.ticker === "TBILL_PROXY") return;
      const s = getSector(r.ticker);
      map.set(s, (map.get(s) ?? 0) + r.weightPct);
    });
    const total = [...map.values()].reduce((a,b) => a+b, 0) || 1;
    return [...map.entries()]
      .map(([name, pct]) => ({ name, value: Math.round(pct/total*100) }))
      .sort((a,b) => b.value-a.value);
  }, [latestMonth]);

  /* ── performance slice ── */
  const perfSlice = useMemo(() => {
    if (!dates.length) return null;
    const slice = periodSlice(dates, equityRaw, benchRaw, period);
    // raw equity for the same period (unsampled, for metrics)
    const last = new Date(dates[dates.length-1]);
    const periodYears = period === "YTD" ? (new Date().getMonth()+1)/12
      : period === "1 Ano" ? 1 : period === "3 Anos" ? 3 : period === "5 Anos" ? 5
      : dates.length / 252;
    const cutoff = period === "YTD"
      ? new Date(last.getFullYear(), 0, 1)
      : period === "Desde início"
      ? new Date(dates[0])
      : new Date(last.getFullYear() - periodYears, last.getMonth(), last.getDate());
    const startIdx = Math.max(0, dates.findIndex(d => new Date(d) >= cutoff));
    const eSlice = equityRaw.slice(startIdx);
    const bSlice = benchRaw.slice(startIdx);
    const totalRet  = eSlice.length > 1 ? (eSlice[eSlice.length-1] / eSlice[0] - 1) * 100 : 0;
    const annRet    = eSlice.length > 1 ? cagr(eSlice[0], eSlice[eSlice.length-1], periodYears) * 100 : 0;
    const rets      = eSlice.slice(1).map((v,i) => v/eSlice[i]-1);
    const shp       = sharpe(rets);
    const benchRet  = bSlice.length > 1 ? (bSlice[bSlice.length-1] / bSlice[0] - 1) * 100 : 0;
    // current vol + drawdown (rolling 252d)
    const allRets   = equityRaw.slice(1).map((v,i) => v/equityRaw[i]-1);
    const curVol    = annualVol(allRets.slice(-252)) * 100;
    const curDD     = currentDrawdown(equityRaw.slice(-252*3)) * 100;
    return { slice, totalRet, annRet, shp, benchRet, curVol, curDD };
  }, [dates, equityRaw, benchRaw, period]);

  /* ── current period chart data ── */
  const chartData = useMemo(() => {
    if (!perfSlice) return [];
    return perfSlice.slice.dates.map((d,i) => ({
      date: d.slice(0,7),
      modelo: +perfSlice.slice.equity[i].toFixed(2),
      bench:  +perfSlice.slice.bench[i].toFixed(2),
    }));
  }, [perfSlice]);

  /* ── drawdown chart ── */
  const ddChartData = useMemo(() => {
    if (!dates.length) return [];
    const last = new Date(dates[dates.length-1]);
    const cutoff = new Date(last.getFullYear()-5, last.getMonth(), last.getDate());
    const idx = dates.findIndex(d => new Date(d) >= cutoff);
    const s = idx < 0 ? 0 : idx;
    return rollingDrawdownSeries(dates.slice(s), equityRaw.slice(s), 10);
  }, [dates, equityRaw]);

  /* ── "o que mudou" bullets ── */
  const whatChanged = useMemo(() => {
    if (!actionCounts.rows.length) return [
      { icon:"📈", title:"Modelo mantém posicionamento", desc:"Sem alterações significativas este mês." },
    ];
    const bought  = actionCounts.rows.filter(r => r.action==="Comprar").map(r => r.ticker).slice(0,3);
    const sold    = actionCounts.rows.filter(r => r.action==="Vender"  || r.action==="Reduzir").map(r => r.ticker).slice(0,3);
    const bsectors = [...new Set(bought.map(getSector))];
    const ssectors = [...new Set(sold.map(getSector))];
    const bullets: {icon:string;title:string;desc:string}[] = [];
    if (bought.length)  bullets.push({ icon:"📈", title:`Aumentámos exposição a ${bsectors[0] ?? "ativos"}`, desc:`${bought.join(", ")} com momentum positivo.` });
    if (sold.length)    bullets.push({ icon:"📉", title:`Reduzimos ${ssectors[0] ?? "posições"}`, desc:`${sold.join(", ")} com deterioração de tendências.` });
    bullets.push({ icon:"🌍", title:"Mercado com tendência moderada", desc:"Ambiente favorável a ativos de risco no curto prazo." });
    bullets.push({ icon:"〰", title:"Volatilidade controlada", desc:`Vol atual ${perfSlice?.curVol?.toFixed(1) ?? "—"}% anual — nível Moderado.` });
    return bullets.slice(0,4);
  }, [actionCounts.rows, perfSlice]);

  /* ── reco month label ── */
  const recoLabel = useMemo(() => {
    const raw = latestMonth?.date ?? latestMonth?.rebalance_date ?? "";
    if (!raw) return "Última recomendação";
    try {
      const d = new Date(raw);
      return d.toLocaleDateString("pt-PT", { month:"long", year:"numeric" });
    } catch { return raw; }
  }, [latestMonth]);

  if (!mounted) return null;
  if (!loggedIn) return null;

  const fmt = (n: number, sign=false) =>
    `${sign && n>=0?"+":""}${n.toFixed(1)}%`;

  return (
    <>
      <Head><title>Dashboard — DECIDE</title></Head>
      <div className="flex min-h-screen bg-[#0d1b2e] text-slate-200" style={{ fontFamily:"'Nunito', system-ui, sans-serif" }}>
        <Sidebar user={sessionUser} profile={profile} active="dashboard" />

        {/* main */}
        <main className="flex-1 overflow-y-auto">
          {/* top bar */}
          <div className="flex items-center justify-between px-8 py-5 border-b border-[#1e2d45]">
            <div>
              <h1 className="text-xl font-black text-white">Dashboard</h1>
              <p className="text-slate-400 text-xs mt-0.5">Visão geral da sua carteira e recomendações</p>
            </div>
            <button className="flex items-center gap-2 bg-[#1a2d42] border border-[#2a3d55] rounded-lg px-4 py-2 text-sm text-slate-300 hover:bg-[#1e3349] transition-colors">
              <span className="text-slate-400 text-xs">📅</span>
              Recomendação de {recoLabel}
              <ChevronDown size={14} className="text-slate-400" />
            </button>
          </div>

          <div className="px-8 py-6 space-y-5">

            {/* ── 1. recomendação deste mês ── */}
            <div className="bg-[#0f2034] border border-[#1e3352] rounded-xl p-5">
              <SectionHeader title="Recomendação deste mês" />
              <div className="flex items-start gap-8">
                <div className="flex gap-8">
                  <ActionBadge label="COMPRAR" count={recoLoading ? 0 : actionCounts.comprar} color="text-emerald-400" />
                  <ActionBadge label="REDUZIR" count={recoLoading ? 0 : actionCounts.reduzir} color="text-amber-400"   />
                  <ActionBadge label="VENDER"  count={recoLoading ? 0 : actionCounts.vender}  color="text-red-400"     />
                  <ActionBadge label="MANTER"  count={recoLoading ? 0 : actionCounts.manter}  color="text-slate-300"   />
                </div>
                <div className="ml-auto flex flex-col gap-2 min-w-[180px]">
                  <button className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold px-4 py-2.5 rounded-lg flex items-center justify-center gap-2 transition-colors">
                    ✓ Aprovar recomendações
                  </button>
                  <button className="bg-[#1a2d42] border border-[#2a3d55] hover:bg-[#1e3349] text-slate-300 text-xs font-semibold px-4 py-2.5 rounded-lg transition-colors">
                    Rever alterações
                  </button>
                </div>
              </div>
              <div className="mt-4 flex items-center gap-4 text-xs text-slate-400 pt-4 border-t border-[#1e3352]">
                <span className="font-semibold">Impacto esperado</span>
                <span>Risco: <span className="text-emerald-400">↓ Ligeiro</span></span>
                <span className="text-slate-600">|</span>
                <span>Retorno esperado: <span className="text-teal-400">↑ Moderado</span></span>
              </div>
            </div>

            {/* ── 2+3: o que mudou + nível de risco ── */}
            <div className="grid grid-cols-2 gap-5">
              {/* o que mudou */}
              <div className="bg-[#0f2034] border border-[#1e3352] rounded-xl p-5">
                <SectionHeader title="O que mudou" />
                <div className="space-y-4">
                  {whatChanged.map((b, i) => (
                    <div key={i} className="flex gap-3">
                      <div className="text-lg mt-0.5 shrink-0">{b.icon}</div>
                      <div>
                        <div className="text-slate-200 text-sm font-semibold">{b.title}</div>
                        <div className="text-slate-400 text-xs mt-0.5">{b.desc}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* nível de risco */}
              <div className="bg-[#0f2034] border border-[#1e3352] rounded-xl p-5">
                <SectionHeader title="O seu nível de risco" />
                <div className="flex gap-6">
                  <div className="space-y-4">
                    <div>
                      <div className="text-slate-400 text-xs mb-1">Volatilidade (anual)</div>
                      <div className="text-2xl font-black text-white">{perfSlice ? `${perfSlice.curVol.toFixed(1)}%` : "—"}</div>
                      <div className="text-slate-400 text-xs">Média</div>
                    </div>
                    <div>
                      <div className="text-slate-400 text-xs mb-1">Drawdown actual</div>
                      <div className="text-2xl font-black text-red-400">{perfSlice ? `${perfSlice.curDD.toFixed(1)}%` : "—"}</div>
                    </div>
                    <div>
                      <div className="text-slate-400 text-xs mb-1">Nível de risco</div>
                      <div className="text-teal-400 font-bold text-sm">Moderado</div>
                      <div className="mt-1.5 h-2 rounded-full bg-slate-700 w-28">
                        <div className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-teal-400" style={{ width:"55%" }} />
                      </div>
                    </div>
                  </div>
                  <div className="flex-1">
                    <div className="text-slate-400 text-xs mb-2">Evolução do drawdown</div>
                    <ResponsiveContainer width="100%" height={130}>
                      <LineChart data={ddChartData} margin={{ top:4, right:4, left:-24, bottom:0 }}>
                        <XAxis dataKey="date" tick={{ fontSize:9, fill:"#64748b" }} tickLine={false} axisLine={false}
                          tickFormatter={d => d.slice(0,4)} interval={Math.floor(ddChartData.length/4)} />
                        <YAxis tick={{ fontSize:9, fill:"#64748b" }} tickLine={false} axisLine={false}
                          tickFormatter={v => `${v.toFixed(0)}%`} domain={["dataMin", 0]} />
                        <Tooltip content={<PerfTooltip />} />
                        <ReferenceLine y={0} stroke="#334155" strokeDasharray="3 3" />
                        <Line type="monotone" dataKey="dd" stroke="#14b8a6" strokeWidth={1.5} dot={false} name="DD" />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>
            </div>

            {/* ── 4+5: alterações + alocação ── */}
            <div className="grid grid-cols-2 gap-5">
              {/* alterações na carteira */}
              <div className="bg-[#0f2034] border border-[#1e3352] rounded-xl p-5">
                <div className="flex items-center justify-between mb-4">
                  <SectionHeader title="Alterações na carteira" />
                  <button className="text-teal-400 text-xs hover:underline flex items-center gap-1 -mt-4">
                    Ver carteira completa <ArrowUpRight size={12} />
                  </button>
                </div>
                {recoLoading ? (
                  <div className="text-slate-500 text-sm text-center py-6">A carregar…</div>
                ) : actionCounts.rows.length === 0 ? (
                  <div className="text-slate-500 text-sm text-center py-6">Sem alterações este mês</div>
                ) : (
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-slate-500 border-b border-[#1e3352]">
                        <th className="text-left pb-2 font-semibold">Ativo</th>
                        <th className="text-left pb-2 font-semibold">Setor</th>
                        <th className="text-right pb-2 font-semibold">Actual</th>
                        <th className="text-right pb-2 font-semibold">Novo</th>
                        <th className="text-right pb-2 font-semibold">Δ</th>
                        <th className="text-right pb-2 font-semibold">Ação</th>
                      </tr>
                    </thead>
                    <tbody>
                      {actionCounts.rows.map(r => {
                        const actionColor = r.action==="Comprar" ? "text-emerald-400"
                          : r.action==="Vender" ? "text-red-400" : "text-amber-400";
                        const deltaColor = r.delta>0 ? "text-emerald-400" : "text-red-400";
                        return (
                          <tr key={r.ticker} className="border-b border-[#1a2d40] hover:bg-white/[0.02]">
                            <td className="py-2.5 font-bold text-slate-200">{r.ticker}</td>
                            <td className="py-2.5 text-slate-400">{getSector(r.ticker)}</td>
                            <td className="py-2.5 text-right text-slate-300">{r.prev.toFixed(1)}%</td>
                            <td className="py-2.5 text-right text-slate-300">{r.cur.toFixed(1)}%</td>
                            <td className={`py-2.5 text-right font-semibold ${deltaColor}`}>
                              {r.delta>0?"+":""}{r.delta.toFixed(1)}%
                            </td>
                            <td className={`py-2.5 text-right font-bold ${actionColor}`}>{r.action}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>

              {/* alocação por setor */}
              <div className="bg-[#0f2034] border border-[#1e3352] rounded-xl p-5">
                <div className="flex items-center justify-between mb-4">
                  <SectionHeader title="Alocação por setor" />
                  <button className="text-teal-400 text-xs hover:underline flex items-center gap-1 -mt-4">
                    Ver alocação completa <ArrowUpRight size={12} />
                  </button>
                </div>
                {sectorData.length === 0 ? (
                  <div className="text-slate-500 text-sm text-center py-6">A carregar…</div>
                ) : (
                  <div className="flex items-center gap-4">
                    <ResponsiveContainer width={160} height={160}>
                      <PieChart>
                        <Pie data={sectorData} cx="50%" cy="50%" innerRadius={48} outerRadius={72}
                          dataKey="value" strokeWidth={0}>
                          {sectorData.map((_,i) => (
                            <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip formatter={(v: number) => `${v}%`} contentStyle={{ background:"#1e293b", border:"1px solid #334155", borderRadius:8, fontSize:11 }} />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="flex-1 space-y-2">
                      {sectorData.map((s, i) => (
                        <div key={s.name} className="flex items-center justify-between text-xs">
                          <div className="flex items-center gap-2">
                            <div className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: PIE_COLORS[i % PIE_COLORS.length] }} />
                            <span className="text-slate-300">{s.name}</span>
                          </div>
                          <span className="text-slate-400 font-semibold">{s.value}%</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* ── 6. performance ── */}
            <div className="bg-[#0f2034] border border-[#1e3352] rounded-xl p-5">
              <div className="flex items-center justify-between mb-4">
                <SectionHeader title="Performance" />
                {/* period tabs */}
                <div className="flex gap-1 -mt-4">
                  {PERIODS.map(p => (
                    <button key={p} onClick={() => setPeriod(p)}
                      className={["px-3 py-1 rounded text-xs font-semibold transition-colors",
                        period===p ? "bg-teal-500/20 text-teal-400 border border-teal-500/30"
                                   : "text-slate-400 hover:text-slate-200"].join(" ")}>
                      {p}
                    </button>
                  ))}
                </div>
              </div>
              {/* metrics */}
              {perfSlice && (
                <div className="flex gap-8 mb-4">
                  <div>
                    <div className="text-slate-400 text-xs mb-0.5">Retorno ({period})</div>
                    <div className={`text-2xl font-black ${perfSlice.totalRet>=0?"text-emerald-400":"text-red-400"}`}>
                      {fmt(perfSlice.totalRet, true)}
                    </div>
                  </div>
                  <div>
                    <div className="text-slate-400 text-xs mb-0.5">Retorno anualizado</div>
                    <div className={`text-2xl font-black ${perfSlice.annRet>=0?"text-emerald-400":"text-red-400"}`}>
                      {fmt(perfSlice.annRet, true)}
                    </div>
                  </div>
                  <div>
                    <div className="text-slate-400 text-xs mb-0.5">Sharpe</div>
                    <div className="text-2xl font-black text-white">{perfSlice.shp.toFixed(2)}</div>
                  </div>
                </div>
              )}
              {/* chart */}
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={chartData} margin={{ top:4, right:4, left:-16, bottom:0 }}>
                  <XAxis dataKey="date" tick={{ fontSize:10, fill:"#64748b" }} tickLine={false} axisLine={false}
                    interval={Math.floor(chartData.length/6)} />
                  <YAxis tick={{ fontSize:10, fill:"#64748b" }} tickLine={false} axisLine={false}
                    tickFormatter={v => `${v.toFixed(0)}%`} />
                  <Tooltip content={<PerfTooltip />} />
                  <ReferenceLine y={0} stroke="#334155" strokeDasharray="3 3" />
                  <Line type="monotone" dataKey="modelo" stroke="#14b8a6" strokeWidth={2} dot={false} name="Modelo" />
                  <Line type="monotone" dataKey="bench"  stroke="#64748b"  strokeWidth={1.5} dot={false} name="Benchmark" strokeDasharray="4 2" />
                </LineChart>
              </ResponsiveContainer>
              <div className="flex items-center gap-4 mt-3">
                <div className="flex items-center gap-2 text-xs text-slate-400"><div className="w-5 h-0.5 bg-teal-400 rounded" /> Modelo</div>
                <div className="flex items-center gap-2 text-xs text-slate-400"><div className="w-5 h-px bg-slate-400 rounded" style={{ borderTop:"1px dashed #64748b" }} /> Benchmark</div>
              </div>
              <p className="text-slate-600 text-[10px] mt-3 text-center">
                As recomendações não constituem aconselhamento personalizado de investimento.
              </p>
            </div>

          </div>
        </main>
      </div>
    </>
  );
}
