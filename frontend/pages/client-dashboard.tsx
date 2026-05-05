import Head from "next/head";
import { useRouter } from "next/router";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, ReferenceLine,
  BarChart, Bar, CartesianGrid,
} from "recharts";
import {
  LayoutDashboard, BookOpen, Briefcase, TrendingUp, TrendingDown,
  ShieldCheck, Clock, Settings, LogOut, ChevronDown, Info,
  ArrowUpRight, ArrowDownRight, Minus, X, Eye, EyeOff,
  Globe, Activity, HelpCircle, Mail, Phone, MapPin, Send,
  CheckCircle2,
} from "lucide-react";
import {
  isClientLoggedIn, getCurrentSessionUser,
  registerClientUser, loginClientUser,
} from "../lib/clientAuth";
import { useSyncedRiskProfileFromOnboarding } from "../hooks/useSyncedRiskProfileFromOnboarding";
import { KPI_IFRAME_SRC_REV } from "../lib/kpiFlaskBuildGate";

/* ─── native simulator ──────────────────────────────────────── */
const PRAZO_OPTS=[1,3,5,10,15,20] as const; // v2
function NativeSimulator({dates,equity,bench,onRegister,loggedIn}:{
  dates:string[];equity:number[];bench:number[];onRegister:()=>void;loggedIn:boolean;
}) {
  const [capital,setCapital]=React.useState(10000);
  const [capInput,setCapInput]=React.useState("10000");
  const [prazo,setPrazo]=React.useState(20); // anos de horizonte

  // Slice de dados para o prazo seleccionado (com skipWarmup)
  const slice=React.useMemo(()=>{
    if(!equity.length||!dates.length) return {eq:equity,bch:bench,dts:dates};
    const last=new Date(dates[dates.length-1]);
    const cut=new Date(last.getFullYear()-prazo,last.getMonth(),last.getDate());
    let s=dates.findIndex(d=>new Date(d)>=cut);
    if(s<0) s=0;
    // skip warmup flat period
    const v0=equity[s];
    while(s<equity.length-1&&equity[s]===v0) s++;
    return {eq:equity.slice(s),bch:bench.slice(s),dts:dates.slice(s)};
  },[equity,bench,dates,prazo]);

  // CAGR usa o prazo seleccionado como denominador (igual ao gráfico de performance)
  const cagrHist=React.useMemo(()=>
    slice.eq.length>1?cagrFn(slice.eq[0],slice.eq[slice.eq.length-1],prazo)*100:0
  ,[slice,prazo]);

  const simData=React.useMemo(()=>{
    if(!slice.eq.length||!slice.dts.length) return [];
    const step=Math.max(1,Math.floor(slice.eq.length/300));
    const base=slice.eq[0]||1;
    const bbase=slice.bch[0]||1; // base separada para benchmark
    return slice.dts.filter((_,i)=>i%step===0).map((d,i)=>({
      date:d.slice(0,4),
      modelo:Math.round((slice.eq[i*step]/base)*capital),
      bench: Math.round((slice.bch[i*step]/bbase)*capital),
    }));
  },[slice,capital]);

  const finalVal=simData[simData.length-1]?.modelo??capital;
  const benchFinal=simData[simData.length-1]?.bench??capital;
  const gain=finalVal-capital;
  const fmt=(n:number)=>n>=1e6?`\u20AC${(n/1e6).toFixed(2)}M`:`\u20AC${n.toLocaleString("pt-PT")}`;

  const simTooltip=({active,payload,label}:any)=>{
    if(!active||!payload?.length) return null;
    return (
      <div className="bg-[#111827] border border-[#252a3a] rounded-lg px-3 py-2 text-xs">
        <div className="text-slate-400 mb-1">{label}</div>
        {payload.map((p:any)=>(
          <div key={p.dataKey} style={{color:p.color}} className="font-semibold">
            {p.name}: {fmt(p.value)}
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-6">
        <label className="flex flex-col gap-1.5 text-xs text-slate-400 font-semibold">
          Capital inicial
          <div className="flex items-center gap-2">
            <input
              type="number" min={1000} step={1000} value={capInput}
              onChange={e=>{setCapInput(e.target.value);const n=Number(e.target.value);if(n>=100)setCapital(n);}}
              className="bg-[#0d1118] border border-[#252a3a] text-slate-200 text-sm rounded-lg px-3 py-2.5 w-36 outline-none focus:border-blue-500 transition-colors"
            />
            <span className="text-slate-500 text-sm">&euro;</span>
          </div>
        </label>
        <label className="flex flex-col gap-1.5 text-xs text-slate-400 font-semibold">
          Prazo
          <div className="flex gap-1">
            {PRAZO_OPTS.map(y=>(
              <button key={y} onClick={()=>setPrazo(y)}
                className={`px-3 py-2 rounded-lg text-xs font-bold transition-colors border ${prazo===y?"bg-blue-600 border-blue-500 text-white":"bg-[#0d1118] border-[#252a3a] text-slate-400 hover:border-blue-700 hover:text-slate-200"}`}>
                {y}a
              </button>
            ))}
          </div>
        </label>
        <div className="flex gap-6 pb-1 flex-wrap">
          {[
            {l:"Ganho total",v:`${gain>=0?"+":""}${fmt(gain)}`,c:gain>=0?"text-emerald-400":"text-red-400"},
            {l:"Valor final",v:fmt(finalVal),c:"text-white"},
            {l:"CAGR hist\u00f3rico",v:`+${cagrHist.toFixed(1)}%/ano`,c:"text-blue-400"},
            {l:"vs MSCI World",v:fmt(benchFinal),c:"text-slate-400"},
          ].map(({l,v,c})=>(
            <div key={l}>
              <div className="text-slate-500 text-[10px] uppercase tracking-wide mb-0.5">{l}</div>
              <div className={`text-lg font-black ${c}`}>{v}</div>
            </div>
          ))}
        </div>
      </div>
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={simData} margin={{top:4,right:8,left:8,bottom:0}}>
          <XAxis dataKey="date" tick={{fontSize:10,fill:"#64748b"}} tickLine={false} axisLine={false}
            interval={Math.floor(simData.length/8)}/>
          <YAxis scale="log" domain={["auto","auto"]} allowDataOverflow
            tick={{fontSize:9,fill:"#64748b"}} tickLine={false} axisLine={false}
            tickFormatter={v=>v>=1e6?`\u20AC${(v/1e6).toFixed(1)}M`:v>=1000?`\u20AC${(v/1000).toFixed(0)}k`:`\u20AC${v}`}/>
          <Tooltip content={simTooltip}/>
          <ReferenceLine y={capital} stroke="#334155" strokeDasharray="3 3"/>
          <Line type="monotone" dataKey="modelo" stroke="#60a5fa" strokeWidth={2.5} dot={false} name="DECIDE"/>
          <Line type="monotone" dataKey="bench" stroke="#475569" strokeWidth={1.5} dot={false} name="MSCI World" strokeDasharray="4 2"/>
        </LineChart>
      </ResponsiveContainer>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-5 text-xs text-slate-400">
          <span className="flex items-center gap-1.5"><span className="w-5 h-0.5 bg-blue-400 inline-block rounded"/>DECIDE</span>
          <span className="flex items-center gap-1.5"><span className="w-5 h-px bg-slate-500 inline-block rounded"/>MSCI World</span>
        </div>
        {!loggedIn&&(
          <button onClick={onRegister}
            className="text-xs px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-lg transition-colors">
            Guardar e executar esta estrat\u00e9gia &rarr;
          </button>
        )}
      </div>
      <p className="text-slate-600 text-[10px]">Simulação baseada em dados históricos reais (últimos {prazo} anos). Rendimentos passados não garantem resultados futuros.</p>
    </div>
  );
}


/* â”€â”€â”€ iframe base (same logic as getKpiEmbedBase) â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
const _TS = typeof window !== "undefined" ? Math.floor(Date.now() / 60000) : 0;
function buildSimulatorSrc(profile: string): string {
  if (typeof window === "undefined") return "";
  const base =
    process.env.NODE_ENV === "development" ? "/kpi-flask"
    : (process.env.NEXT_PUBLIC_KPI_EMBED_BASE || "")
    || (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
        ? "http://127.0.0.1:5000" : "/kpi-flask");
  const rev = encodeURIComponent(KPI_IFRAME_SRC_REV);
  return `${base}?client_embed=1&profile=${encodeURIComponent(profile)}&embed_tab=simulator&kpi_view=simple&embed_src_rev=${rev}&_ts=${_TS}`;
}

/* â”€â”€â”€ sector map â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
const SECTOR: Record<string, string> = {
  AAPL:"Tecnologia",NVDA:"Tecnologia",MSFT:"Tecnologia",GOOGL:"Tecnologia",
  META:"Tecnologia",AVGO:"Tecnologia",AMD:"Tecnologia",CRM:"Tecnologia",
  ORCL:"Tecnologia",QCOM:"Tecnologia",TXN:"Tecnologia",AMAT:"Tecnologia",
  KLAC:"Tecnologia",LRCX:"Tecnologia",SNPS:"Tecnologia",CDNS:"Tecnologia",
  CTSH:"Tecnologia",NOW:"Tecnologia",ADBE:"Tecnologia",INTU:"Tecnologia",
  JPM:"Financeiro",GS:"Financeiro",MS:"Financeiro",BAC:"Financeiro",
  V:"Financeiro",MA:"Financeiro",AXP:"Financeiro",BLK:"Financeiro",
  SPGI:"Financeiro",ICE:"Financeiro",MCO:"Financeiro",COF:"Financeiro",
  BKNG:"Cons. Discr.",AMZN:"Cons. Discr.",TSLA:"Cons. Discr.",
  NKE:"Cons. Discr.",MCD:"Cons. Discr.",SBUX:"Cons. Discr.",
  TJX:"Cons. Discr.",LOW:"Cons. Discr.",HD:"Cons. Discr.",
  CAT:"Industrial",HON:"Industrial",MMM:"Industrial",GE:"Industrial",
  LMT:"Industrial",RTX:"Industrial",UNP:"Industrial",CSX:"Industrial",
  DE:"Industrial",EMR:"Industrial",ETN:"Industrial",
  UNH:"Saúde",JNJ:"Saúde",LLY:"Saúde",ABBV:"Saúde",
  MRK:"Saúde",PFE:"Saúde",TMO:"Saúde",ABT:"Saúde",
  XOM:"Energia",CVX:"Energia",COP:"Energia",EOG:"Energia",
  PXD:"Energia",SLB:"Energia",PSX:"Energia",VLO:"Energia",
  WMT:"Cons. Básico",PG:"Cons. Básico",KO:"Cons. Básico",
  PEP:"Cons. Básico",COST:"Cons. Básico",MDLZ:"Cons. Básico",
};
const getSector = (t: string) => SECTOR[t.toUpperCase()] ?? "Outros";

const ZONE:Record<string,string>={
  AAPL:"EUA",NVDA:"EUA",MSFT:"EUA",GOOGL:"EUA",META:"EUA",AVGO:"EUA",
  AMD:"EUA",CRM:"EUA",ORCL:"EUA",QCOM:"EUA",TXN:"EUA",AMAT:"EUA",
  MRVL:"EUA",KLAC:"EUA",ON:"EUA",MU:"EUA",INTC:"EUA",LRCX:"EUA",
  SQ:"EUA",CAT:"EUA",NEM:"EUA",GOLD:"EUA",WBD:"EUA",GOOG:"EUA",
  BATS:"Europa",NOK:"Europa",E:"Europa",BAYRY:"Europa",MARUY:"Asia",
};
const getZone=(t:string)=>ZONE[t.toUpperCase()]??"Outros";

type Page="dashboard"|"reco"|"carteira"|"perf"|"risco"|"historico"|"ajuda"|"contactos";

/* â”€â”€â”€ maths â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
function cagrFn(s: number, e: number, y: number) { return s > 0 && y > 0 ? Math.pow(e/s,1/y)-1 : 0; }
function annualVol(r: number[]) {
  if (r.length < 5) return 0;
  const m = r.reduce((a,b)=>a+b,0)/r.length;
  return Math.sqrt(r.reduce((a,b)=>a+(b-m)**2,0)/(r.length-1)*252);
}
function sharpe(r: number[]) {
  const v = annualVol(r)/Math.sqrt(252); return v ? (r.reduce((a,b)=>a+b,0)/r.length/v)*Math.sqrt(252) : 0;
}
function currentDD(eq: number[]) {
  let pk=eq[0]??1, dd=0;
  for (const v of eq) { if(v>pk)pk=v; const d=(v-pk)/pk; if(d<dd)dd=d; }
  return dd;
}
function rollingDD(dates: string[], eq: number[], step=10) {
  let pk=eq[0]??1;
  return dates.filter((_,i)=>i%step===0).map((d,j)=>{
    const v=eq[j*step]??eq[eq.length-1];
    if(v>pk)pk=v;
    return { date:d.slice(0,7), dd:((v-pk)/pk)*100 };
  });
}

/* â”€â”€â”€ period slice â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
type Period="YTD"|"1 Ano"|"3 Anos"|"5 Anos"|"20 Anos"|"Desde início";
const PERIODS:Period[]=["YTD","1 Ano","3 Anos","5 Anos","20 Anos","Desde início"];

function periodStart(dates:string[], period:Period) {
  if(period==="Desde início") return 0;
  const last=new Date(dates[dates.length-1]);
  const yrs=period==="YTD"?0:period==="1 Ano"?1:period==="3 Anos"?3:period==="5 Anos"?5:20;
  const cut=period==="YTD"
    ? new Date(last.getFullYear(),0,1)
    : new Date(last.getFullYear()-yrs,last.getMonth(),last.getDate());
  const i=dates.findIndex(d=>new Date(d)>=cut);
  return i<0?0:i;
}
function skipWarmup(eq:number[], from:number) {
  const v0=eq[from]; let i=from;
  while(i<eq.length-1&&eq[i]===v0) i++;
  return i;
}
function makeChartData(dates:string[], eq:number[], bench:number[], period:Period) {
  const s=skipWarmup(eq,periodStart(dates,period));
  const base=eq[s]||1, bb=bench[s]||1;
  const step=Math.max(1,Math.floor((dates.length-s)/200));
  return dates.slice(s).filter((_,i)=>i%step===0).map((d,i)=>({
    date:d.slice(0,7),
    modelo:+((eq[s+i*step]/base)*100).toFixed(3),
    bench:+((bench[s+i*step]/bb)*100).toFixed(3),
  }));
}
function periodMetrics(eq:number[], bench:number[], period:Period) {
  const y=period==="YTD"?(new Date().getMonth()+1)/12
    :period==="1 Ano"?1:period==="3 Anos"?3:period==="5 Anos"?5
    :period==="20 Anos"?20:eq.length/252;
  if(eq.length<2) return {ret:0,ann:0,shp:0,bench:0};
  const ret=(eq[eq.length-1]/eq[0]-1)*100;
  const ann=cagrFn(eq[0],eq[eq.length-1],y)*100;
  const rets=eq.slice(1).map((v,i)=>v/eq[i]-1);
  return {ret,ann,shp:sharpe(rets),bench:(bench[bench.length-1]/bench[0]-1)*100};
}

/* â”€â”€â”€ types â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
type WRow={ticker:string;weight:number;weightPct:number;score:number};
type RecoMonth={date?:string;rebalance_date?:string;rows:WRow[];tbillsTotalPct?:number};

/* â”€â”€â”€ sidebar â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
const NAV=[
  {id:"dashboard", label:"Dashboard",      Icon:LayoutDashboard},
  {id:"reco",      label:"Recomendações",  Icon:BookOpen},
  {id:"carteira",  label:"Carteira",       Icon:Briefcase},
  {id:"perf",      label:"Performance",    Icon:TrendingUp},
  {id:"risco",     label:"Risco",          Icon:ShieldCheck},
  {id:"historico", label:"Histórico",      Icon:Clock},
  {id:"ajuda",     label:"Ajuda",          Icon:HelpCircle},
  {id:"contactos", label:"Contactos",      Icon:Mail},
];
function Sidebar({user,profile,loggedIn,onRegister,activePage,onNavigate}:{
  user:string|null;profile:string;loggedIn:boolean;onRegister:()=>void;
  activePage:Page;onNavigate:(p:Page)=>void;
}) {
  const router=useRouter();
  const initials=(user??"JC").slice(0,2).toUpperCase();
  const profilePt=profile==="conservador"?"Conservador":profile==="dinamico"?"Dinâmico":"Moderado";
  return (
    <aside className="flex flex-col w-56 min-h-screen bg-[#07090f] border-r border-[#1a1f2e] shrink-0">
      <div className="border-b border-[#1a1f2e]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/images/logo-decide.png" alt="DECIDE" className="w-full h-16 object-cover object-left" />
      </div>
      <nav className="flex-1 px-3 py-4 space-y-0.5">
        {NAV.map(({id,label,Icon})=>(
          <button key={id} onClick={()=>onNavigate(id as Page)}
            className={["w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
              activePage===id?"bg-blue-600/15 text-blue-400 border border-blue-500/25":"text-slate-400 hover:text-slate-200 hover:bg-white/5"].join(" ")}>
            <Icon size={16}/>{label}
          </button>
        ))}
      </nav>
      <div className="px-3 py-4 border-t border-[#1a1f2e] space-y-1">
        {loggedIn ? (
          <>
            <div className="flex items-center gap-3 px-3 py-2">
              <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center text-white font-bold text-xs shrink-0">{initials}</div>
              <div className="min-w-0">
                <div className="text-slate-200 text-xs font-semibold truncate">{user??"Utilizador"}</div>
                <div className="text-slate-400 text-[10px]">Perfil: {profilePt}</div>
              </div>
            </div>
            <button onClick={()=>void router.push("/client/logout")}
              className="w-full flex items-center gap-3 px-3 py-2 text-slate-500 hover:text-slate-300 text-xs rounded-lg hover:bg-white/5 transition-colors">
              <LogOut size={14}/>Sair
            </button>
          </>
        ) : (
          <button onClick={onRegister}
            className="w-full px-3 py-2.5 bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs rounded-lg transition-colors">
            Criar conta grátis
          </button>
        )}
      </div>
    </aside>
  );
}

/* â”€â”€â”€ conversion banner (public mode) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
function ConversionBanner({onRegister}:{onRegister:()=>void}) {
  const [dismissed,setDismissed]=useState(false);
  if(dismissed) return null;
  return (
    <div className="bg-gradient-to-r from-blue-950/80 to-slate-900/80 border-b border-blue-800/40 px-8 py-2.5 flex items-center gap-4">
      <div className="text-xs text-slate-300 flex-1">
        <span className="text-blue-400 font-semibold">Está a ver uma simulação ao vivo.</span>
        {" "}Crie conta gratuita para guardar e executar esta estratégia na sua carteira.
      </div>
      <button onClick={onRegister}
        className="shrink-0 px-4 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold rounded-lg transition-colors">
        Criar conta grátis
      </button>
      <button onClick={()=>setDismissed(true)} className="text-slate-500 hover:text-slate-300 transition-colors">
        <X size={14}/>
      </button>
    </div>
  );
}

/* â”€â”€â”€ register modal â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
function RegisterModal({onClose,onSuccess}:{onClose:()=>void;onSuccess:(user:string)=>void}) {
  const [email,setEmail]=useState("");
  const [pw,setPw]=useState("");
  const [showPw,setShowPw]=useState(false);
  const [err,setErr]=useState("");
  const [busy,setBusy]=useState(false);
  const emailRef=useRef<HTMLInputElement>(null);

  useEffect(()=>{ emailRef.current?.focus(); },[]);

  function submit(e:React.FormEvent) {
    e.preventDefault();
    setErr(""); setBusy(true);
    const emailTrim=email.trim();
    const username=emailTrim.split("@")[0].replace(/[^a-z0-9_]/gi,"_").slice(0,24)||"user";
    const r=registerClientUser(username,pw,pw,emailTrim,"",{requirePhoneSms:false});
    if(!r.ok) { setErr(r.error??"Erro no registo."); setBusy(false); return; }
    const l=loginClientUser(username,pw);
    if(!l.ok) { setErr("Conta criada mas erro no login. Tenta entrar manualmente."); setBusy(false); return; }
    setBusy(false);
    onSuccess(username);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={e=>{ if(e.target===e.currentTarget) onClose(); }}>
      <div className="bg-[#0b0f1a] border border-[#1a1f2e] rounded-2xl shadow-2xl w-full max-w-sm mx-4 p-7">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-white font-black text-lg">Criar conta grátis</h2>
            <p className="text-slate-400 text-xs mt-1">Sem cartão de crédito. Cancela quando quiseres.</p>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300 transition-colors"><X size={18}/></button>
        </div>

        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="block text-xs text-slate-400 mb-1.5 font-semibold">Email</label>
            <input ref={emailRef} type="email" value={email} onChange={e=>setEmail(e.target.value)}
              placeholder="o.teu@email.com" required
              className="w-full bg-[#111827] border border-[#252a3a] text-slate-200 text-sm rounded-lg px-3 py-2.5 outline-none focus:border-blue-500 transition-colors placeholder:text-slate-600"/>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1.5 font-semibold">Password</label>
            <div className="relative">
              <input type={showPw?"text":"password"} value={pw} onChange={e=>setPw(e.target.value)}
                placeholder="Mínimo 8 caracteres" required minLength={8}
                className="w-full bg-[#111827] border border-[#252a3a] text-slate-200 text-sm rounded-lg px-3 py-2.5 pr-10 outline-none focus:border-blue-500 transition-colors placeholder:text-slate-600"/>
              <button type="button" onClick={()=>setShowPw(v=>!v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300">
                {showPw?<EyeOff size={14}/>:<Eye size={14}/>}
              </button>
            </div>
          </div>
          {err && <p className="text-red-400 text-xs bg-red-900/20 border border-red-800/40 rounded-lg px-3 py-2">{err}</p>}
          <button type="submit" disabled={busy}
            className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-white font-bold text-sm py-3 rounded-lg transition-colors">
            {busy?"A criar conta…":"Criar conta e aplicar estratégia →"}
          </button>
        </form>

        <p className="text-slate-600 text-[10px] text-center mt-4">
          Ao criar conta aceitas os <span className="underline cursor-pointer text-slate-500">Termos de Serviço</span>. Os dados são processados com segurança.
        </p>
      </div>
    </div>
  );
}

/* â”€â”€â”€ small components â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
function ActionBadge({label,count,color}:{label:string;count:number;color:string}) {
  const Icon=label==="COMPRAR"||label==="AUMENTAR"?ArrowUpRight:label==="VENDER"||label==="REDUZIR"?ArrowDownRight:Minus;
  const bar=label==="COMPRAR"?"bg-emerald-500":label==="AUMENTAR"?"bg-cyan-500":label==="VENDER"?"bg-red-500":label==="REDUZIR"?"bg-amber-500":"bg-slate-500";
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1.5"><span className={`text-3xl font-black ${color}`}>{count}</span><Icon size={20} className={color}/></div>
      <div className="text-slate-400 text-[11px] font-semibold tracking-wide">{label}</div>
      <div className={`h-0.5 rounded-full ${bar} opacity-60`}/>
    </div>
  );
}
function SH({title}:{title:string}) {
  return (
    <div className="flex items-center gap-2 mb-4">
      <h2 className="text-slate-200 text-sm font-bold tracking-wide uppercase">{title}</h2>
      <Info size={13} className="text-slate-500"/>
    </div>
  );
}
const PIE_COLORS=["#14b8a6","#3b82f6","#f59e0b","#8b5cf6","#22c55e","#ef4444","#64748b"];
function PerfTooltip({active,payload,label}:any) {
  if(!active||!payload?.length) return null;
  return (
    <div className="bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-xs">
      <div className="text-slate-300 mb-1">{label}</div>
      {payload.map((p:any)=>{
        const v=Number(p.value);
        // equity-index values (≥50 means normalized to 100 at start → show as return %)
        const display = v >= 50
          ? `${v>=100?"+":""}${((v/100-1)*100).toFixed(1)}%`
          : `${v.toFixed(1)}%`;
        return <div key={p.dataKey} style={{color:p.color}}>{p.name}: {display}</div>;
      })}
    </div>
  );
}

/* â”€â”€â”€ main â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
export default function ClientDashboardPage() {
  const router=useRouter();
  const {profile}=useSyncedRiskProfileFromOnboarding();
  const [mounted,setMounted]=useState(false);
  const [sessionUser,setSessionUser]=useState<string|null>(null);
  const [loggedIn,setLoggedIn]=useState(false);
  const [showRegModal,setShowRegModal]=useState(false);
  const [period,setPeriod]=useState<Period>("20 Anos");
  const [regSuccess,setRegSuccess]=useState(false);
  const [activePage,setActivePage]=useState<Page>("reco");
  const [contactForm,setContactForm]=useState({nome:"",email:"",assunto:"",msg:""});
  const [contactSent,setContactSent]=useState(false);

  // freeze series
  const [dates,setDates]=useState<string[]>([]);
  const [equityRaw,setEquityRaw]=useState<number[]>([]);
  const [benchRaw,setBenchRaw]=useState<number[]>([]);

  // recommendations
  const [recoMonths,setRecoMonths]=useState<RecoMonth[]>([]);
  const [recoLoading,setRecoLoading]=useState(true);

  const syncSession=()=>{ try{ setSessionUser(getCurrentSessionUser()); setLoggedIn(isClientLoggedIn()); }catch{} };

  useEffect(()=>{ setMounted(true); syncSession(); },[]);
  // NO redirect — public dashboard shows to all

  useEffect(()=>{
    fetch("/api/landing/freeze-cap15-backtest").then(r=>r.json())
      .then((d:any)=>{ if(d?.series){ setDates(d.series.dates??[]); setEquityRaw(d.series.equity_overlayed??[]); setBenchRaw(d.series.benchmark_equity??[]); } })
      .catch(()=>{});
  },[]);

  useEffect(()=>{
    setRecoLoading(true);
    fetch("/api/client/recommendations-history").then(r=>r.json())
      .then((d:any)=>{ if(d?.months) setRecoMonths(d.months); })
      .catch(()=>{}).finally(()=>setRecoLoading(false));
  },[]);

  // API devolve meses ordenados do mais antigo para o mais recente — último = mais recente
  const sortedMonths=useMemo(()=>[...recoMonths].sort((a,b)=>{
    const da=a.date??a.rebalance_date??"";
    const db=b.date??b.rebalance_date??"";
    return da<db?-1:da>db?1:0;
  }),[recoMonths]);
  const latestMonth=sortedMonths[sortedMonths.length-1];
  const prevMonth=sortedMonths[sortedMonths.length-2];

  const actionCounts=useMemo(()=>{
    if(!latestMonth||!prevMonth) return {comprar:0,aumentar:0,reduzir:0,vender:0,manter:0,rows:[] as {ticker:string;prev:number;cur:number;delta:number;action:string}[]};
    const N_POS=20; // número máximo de posições do modelo
    const DMIN=1.0; // variação mínima para Comprar/Reduzir (pp)
    const pm=new Map(prevMonth.rows.map(r=>[r.ticker,r.weightPct]));
    const cm=new Map(latestMonth.rows.map(r=>[r.ticker,r.weightPct]));
    // Top-N tickers por peso máximo entre os dois meses (sem cash/tbill)
    const candidates=[...new Set([...pm.keys(),...cm.keys()])]
      .filter(t=>t!=="TBILL_PROXY"&&!t.startsWith("CASH")&&!t.startsWith("TBILL"));
    const ranked=candidates
      .map(t=>({t,w:Math.max(pm.get(t)??0,cm.get(t)??0)}))
      .sort((a,b)=>b.w-a.w).slice(0,N_POS).map(x=>x.t);
    const all=new Set(ranked);
    let c=0,au=0,rd=0,v=0,m=0;
    const rows:{ticker:string;prev:number;cur:number;delta:number;action:string}[]=[];
    all.forEach(t=>{
      const p=pm.get(t)??0,cur=cm.get(t)??0,delta=cur-p;
      let action="Manter";
      if(p===0&&cur>0){action="Comprar";c++;}
      else if(cur===0&&p>0){action="Vender";v++;}
      else if(delta>=DMIN){action="Aumentar";au++;}  // posição existente a aumentar
      else if(delta<=-DMIN){action="Reduzir";rd++;}
      else{action="Manter";m++;}
      rows.push({ticker:t,prev:p,cur,delta,action});
    });
    return {comprar:c,aumentar:au,reduzir:rd,vender:v,manter:m,
      rows:rows.filter(r=>r.action!=="Manter").sort((a,b)=>Math.abs(b.delta)-Math.abs(a.delta)).slice(0,8)};
  },[latestMonth,prevMonth]);

  const sectorData=useMemo(()=>{
    if(!latestMonth) return [];
    const map=new Map<string,number>();
    latestMonth.rows.forEach(r=>{ if(r.ticker==="TBILL_PROXY") return; const s=getSector(r.ticker); map.set(s,(map.get(s)??0)+r.weightPct); });
    const total=[...map.values()].reduce((a,b)=>a+b,0)||1;
    return [...map.entries()].map(([name,pct])=>({name,value:Math.round(pct/total*100)})).sort((a,b)=>b.value-a.value);
  },[latestMonth]);

  const perfData=useMemo(()=>{
    if(!dates.length) return null;
    // Apply skipWarmup so the start is identical to what NativeSimulator uses
    const s=skipWarmup(equityRaw,periodStart(dates,period));
    const chart=makeChartData(dates,equityRaw,benchRaw,period);
    const m=periodMetrics(equityRaw.slice(s),benchRaw.slice(s),period);
    const allRets=equityRaw.slice(1).map((v,i)=>v/equityRaw[i]-1);
    const curVol=annualVol(allRets.slice(-252))*100;
    const curDD=currentDD(equityRaw.slice(-252*3))*100;
    const ddChart=rollingDD(dates,equityRaw,10);
    const dd5Start=skipWarmup(equityRaw,periodStart(dates,"20 Anos"));
    const dd5=rollingDD(dates.slice(dd5Start),equityRaw.slice(dd5Start),10);
    return {chart,m,curVol,curDD,ddChart:dd5};
  },[dates,equityRaw,benchRaw,period]);

  // Annual returns from equity series
  const annualReturns=useMemo(()=>{
    if(!dates.length||!equityRaw.length) return [];
    const byYear=new Map<number,number[]>();
    dates.forEach((d,i)=>{ const y=new Date(d).getFullYear(); if(!byYear.has(y))byYear.set(y,[]); byYear.get(y)!.push(equityRaw[i]); });
    const benchByYear=new Map<number,number[]>();
    dates.forEach((d,i)=>{ const y=new Date(d).getFullYear(); if(!benchByYear.has(y))benchByYear.set(y,[]); benchByYear.get(y)!.push(benchRaw[i]); });
    const curY=new Date().getFullYear();
    return [...byYear.entries()].filter(([y])=>y>=curY-7&&y<=curY)
      .map(([year,vals])=>({
        year,
        modelo:+((vals[vals.length-1]/vals[0]-1)*100).toFixed(1),
        bench:+(((benchByYear.get(year)??[1])[( benchByYear.get(year)??[1]).length-1]/(benchByYear.get(year)??[1])[0]-1)*100).toFixed(1),
      }));
  },[dates,equityRaw,benchRaw]);

  // Geographic exposure from current positions
  const geoData=useMemo(()=>{
    if(!latestMonth) return [];
    const map=new Map<string,number>();
    latestMonth.rows.forEach(r=>{
      if(r.ticker==="TBILL_PROXY") return;
      const z=getZone(r.ticker);
      map.set(z,(map.get(z)??0)+r.weightPct);
    });
    const total=[...map.values()].reduce((a,b)=>a+b,0)||1;
    return [...map.entries()].map(([name,pct])=>({name,value:Math.round(pct/total*100)})).sort((a,b)=>b.value-a.value);
  },[latestMonth]);

  // Risk metrics: VaR 95%, Beta
  const riskMetrics=useMemo(()=>{
    if(equityRaw.length<252) return {var95:0,beta:0};
    const mRets=equityRaw.slice(1).map((v,i)=>v/equityRaw[i]-1);
    const bRets=benchRaw.slice(1).map((v,i)=>v/(benchRaw[i]||1)-1);
    const sorted=[...mRets].sort((a,b)=>a-b);
    const var95=sorted[Math.floor(sorted.length*0.05)]??0;
    const n=Math.min(mRets.length,bRets.length);
    const bMean=bRets.slice(0,n).reduce((a,b)=>a+b,0)/n;
    const bVar=bRets.slice(0,n).reduce((a,b)=>a+(b-bMean)**2,0)/n;
    const cov=mRets.slice(0,n).reduce((a,m,i)=>a+(m-mRets.slice(0,n).reduce((x,y)=>x+y,0)/n)*(bRets[i]!-bMean),0)/n;
    return {var95:var95*100,beta:bVar>0?+(cov/bVar).toFixed(2):0};
  },[equityRaw,benchRaw]);

  const recoLabel=useMemo(()=>{
    const raw=latestMonth?.date??latestMonth?.rebalance_date??"";
    if(!raw) return "Última recomendação";
    try{ return new Date(raw).toLocaleDateString("pt-PT",{month:"long",year:"numeric"}); }catch{ return raw; }
  },[latestMonth]);

  const whatChanged=useMemo(()=>{
    if(!actionCounts.rows.length) return [{icon:"up",title:"Modelo mantém posicionamento",desc:"Sem alterações significativas este mês."}];
    const bought=actionCounts.rows.filter(r=>r.action==="Comprar"||r.action==="Aumentar").map(r=>r.ticker).slice(0,3);
    const sold=actionCounts.rows.filter(r=>r.action==="Vender"||r.action==="Reduzir").map(r=>r.ticker).slice(0,3);
    const bs=[...new Set(bought.map(getSector))],ss=[...new Set(sold.map(getSector))];
    return [
      bought.length&&{icon:"up",title:`Aumentámos exposição a ${bs[0]??"ativos"}`,desc:`${bought.join(", ")} com momentum positivo.`},
      sold.length&&{icon:"down",title:`Reduzimos ${ss[0]??"posições"}`,desc:`${sold.join(", ")} com deterioração de tendências.`},
      {icon:"globe",title:"Mercado com tendência moderada",desc:"Ambiente favorável a ativos de risco no curto prazo."},
      {icon:"wave",title:"Volatilidade controlada",desc:`Vol actual ${perfData?.curVol?.toFixed(1)??"—"}% anual — nível Moderado.`},
    ].filter(Boolean).slice(0,4) as {icon:string;title:string;desc:string}[];
  },[actionCounts.rows,perfData]);

  const simulatorSrc=useMemo(()=>mounted?buildSimulatorSrc(profile):"",[mounted,profile]);

  const handleRegisterSuccess=(user:string)=>{
    setShowRegModal(false); setRegSuccess(true);
    setSessionUser(user); setLoggedIn(true);
  };

  if(!mounted) return null;

  const fmt=(n:number,sign=false)=>`${sign&&n>=0?"+":""}${n.toFixed(1)}%`;

  return (
    <>
      <Head><title>Dashboard — DECIDE</title></Head>
      {showRegModal&&<RegisterModal onClose={()=>setShowRegModal(false)} onSuccess={handleRegisterSuccess}/>}

      <div className="flex min-h-screen bg-[#080c14] text-slate-200" style={{fontFamily:"'Nunito',system-ui,sans-serif"}}>
        <Sidebar user={sessionUser} profile={profile} loggedIn={loggedIn} onRegister={()=>setShowRegModal(true)}
          activePage={activePage} onNavigate={p=>{setActivePage(p);}}/>

        <div className="flex-1 flex flex-col overflow-hidden">
          {/* discrete top bar for guests */}
          {!loggedIn&&<div className="bg-blue-950/60 border-b border-blue-800/30 px-8 py-2 flex items-center gap-3 text-xs text-slate-400">
            <span className="text-blue-400">●</span>
            Está a ver uma simulação ao vivo — dados reais, carteira não executada.
          </div>}
          {regSuccess&&(
            <div className="bg-emerald-900/50 border-b border-emerald-700/40 px-8 py-2 text-xs text-emerald-300 font-semibold">
              ✓ Conta criada com sucesso! Bem-vindo(a) ao DECIDE.
            </div>
          )}

          <main className="flex-1 overflow-y-auto">
            {/* top bar */}
            <div className="flex items-center justify-between px-8 py-5 border-b border-[#1a1f2e]">
              <div>
                <h1 className="text-xl font-black text-white">{
                  activePage==="dashboard"?"Dashboard":activePage==="reco"?"Recomendações":
                  activePage==="carteira"?"Carteira":activePage==="perf"?"Performance":
                  activePage==="risco"?"Risco":activePage==="historico"?"Histórico":
                  activePage==="ajuda"?"Ajuda":"Contactos"
                }</h1>
                <p className="text-slate-400 text-xs mt-0.5">{
                  activePage==="dashboard"?"Visão geral da carteira e recomendações":
                  activePage==="reco"?"Recomendação mensal do modelo":
                  activePage==="carteira"?"Composição e alocação da carteira":
                  activePage==="perf"?"Análise de performance histórica":
                  activePage==="risco"?"Métricas e análise de risco":
                  activePage==="historico"?"Histórico de recomendações":
                  activePage==="ajuda"?"Perguntas frequentes e recursos":
                  "Fale connosco"
                }</p>
              </div>
              <div className="flex items-center gap-3">
                <button onClick={()=>document.querySelector('[data-section="reco"]')?.scrollIntoView({behavior:"smooth"})} className="flex items-center gap-2 bg-[#111827] border border-[#252a3a] rounded-lg px-4 py-2 text-sm text-slate-300 hover:bg-[#151929] transition-colors">
                  📅 Recomendação de {recoLabel}
                  <ChevronDown size={14} className="text-slate-400"/>
                </button>
                {loggedIn ? (
                  <button onClick={()=>void router.push("/client/logout")}
                    className="flex items-center gap-2 px-3 py-2 text-slate-400 hover:text-slate-200 text-xs rounded-lg border border-[#1a1f2e] hover:bg-white/5 transition-colors">
                    <LogOut size={13}/>Sair
                  </button>
                ) : (
                  <button onClick={()=>setShowRegModal(true)}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold rounded-lg transition-colors shadow-lg shadow-blue-900/30">
                    Criar conta grátis
                  </button>
                )}
              </div>
            </div>

            <div className="px-8 py-6 space-y-5">

              {/* ── DASHBOARD OVERVIEW ── */}
              {activePage==="dashboard"&&(
                <div className="space-y-5">
                  <div className="grid grid-cols-4 gap-4">
                    {[
                      {label:"CAGR histórico (20a)",val:perfData?`+${perfData.m.ann.toFixed(1)}%`:"—",sub:"Retorno anualizado",c:"text-emerald-400"},
                      {label:"Sharpe",val:perfData?perfData.m.shp.toFixed(2):"—",sub:"Risco-retorno",c:"text-blue-400"},
                      {label:"Drawdown máx.",val:perfData?`${perfData.curDD.toFixed(1)}%`:"—",sub:"Actual (3 anos)",c:"text-amber-400"},
                      {label:"Posições",val:actionCounts.comprar+actionCounts.aumentar+actionCounts.reduzir+actionCounts.vender+actionCounts.manter||"—",sub:"Carteira actual",c:"text-white"},
                    ].map(({label,val,sub,c})=>(
                      <div key={label} className="bg-[#0b0f1a] border border-[#1a1f2e] rounded-xl p-5">
                        <div className="text-slate-400 text-xs mb-2">{label}</div>
                        <div className={`text-3xl font-black ${c}`}>{val}</div>
                        <div className="text-slate-500 text-xs mt-1">{sub}</div>
                      </div>
                    ))}
                  </div>
                  <div className="grid grid-cols-4 gap-4">
                    {[
                      {id:"reco",label:"Recomendações",desc:"Ver recomendação de "+recoLabel,Icon:BookOpen,c:"text-emerald-400"},
                      {id:"carteira",label:"Carteira",desc:"Posições e alocação sectorial",Icon:Briefcase,c:"text-blue-400"},
                      {id:"perf",label:"Performance",desc:"Gráficos e retornos anuais",Icon:TrendingUp,c:"text-cyan-400"},
                      {id:"risco",label:"Risco",desc:"VaR, volatilidade e drawdown",Icon:ShieldCheck,c:"text-amber-400"},
                    ].map(({id,label,desc,Icon,c})=>(
                      <button key={id} onClick={()=>setActivePage(id as Page)}
                        className="bg-[#0b0f1a] border border-[#1a1f2e] rounded-xl p-5 text-left hover:border-blue-500/40 transition-colors group">
                        <Icon size={20} className={`${c} mb-3`}/>
                        <div className="text-slate-200 font-semibold text-sm">{label}</div>
                        <div className="text-slate-500 text-xs mt-1">{desc}</div>
                      </button>
                    ))}
                  </div>
                  <div className="bg-[#0b0f1a] border border-[#1a1f2e] rounded-xl p-5">
                    <div className="text-slate-200 font-bold text-sm mb-4">Performance (20 Anos)</div>
                    <ResponsiveContainer width="100%" height={160}>
                      <LineChart data={perfData?.chart??[]} margin={{top:4,right:8,left:-4,bottom:0}}>
                        <XAxis dataKey="date" tick={{fontSize:9,fill:"#64748b"}} tickLine={false} axisLine={false} interval={Math.floor((perfData?.chart.length??1)/6)}/>
                        <YAxis scale="log" domain={["auto","auto"]} allowDataOverflow tick={{fontSize:9,fill:"#64748b"}} tickLine={false} axisLine={false} tickFormatter={v=>{const r=(Number(v)/100-1)*100;return `${r>=0?"+":""}${r.toFixed(0)}%`;}}/>
                        <Tooltip content={<PerfTooltip/>}/>
                        <ReferenceLine y={100} stroke="#334155" strokeDasharray="3 3"/>
                        <Line type="monotone" dataKey="modelo" stroke="#60a5fa" strokeWidth={2} dot={false} name="Modelo"/>
                        <Line type="monotone" dataKey="bench" stroke="#475569" strokeWidth={1.5} dot={false} name="Benchmark" strokeDasharray="4 2"/>
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}

              {/* ── RECOMENDAÇÕES ── */}
              {activePage==="reco"&&(
              <>{/* 1. recomendação */}
              <div data-section="reco" className="bg-[#0b0f1a] border border-[#1a1f2e] rounded-xl p-5">
                <SH title="Recomendação deste mês"/>
                <div className="flex items-start gap-8">
                  <div className="flex gap-8">
                    <ActionBadge label="COMPRAR"  count={recoLoading?0:actionCounts.comprar}  color="text-emerald-400"/>
                    <ActionBadge label="AUMENTAR" count={recoLoading?0:actionCounts.aumentar} color="text-cyan-400"/>
                    <ActionBadge label="REDUZIR"  count={recoLoading?0:actionCounts.reduzir}  color="text-amber-400"/>
                    <ActionBadge label="VENDER"   count={recoLoading?0:actionCounts.vender}   color="text-red-400"/>
                    <ActionBadge label="MANTER"   count={recoLoading?0:actionCounts.manter}   color="text-slate-300"/>
                  </div>
                  <div className="ml-auto flex flex-col gap-2 min-w-[200px]">
                    {loggedIn ? (
                      <button className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold px-4 py-2.5 rounded-lg flex items-center justify-center gap-2 transition-colors">
                        ✓ Aprovar recomendações
                      </button>
                    ) : (
                      <button onClick={()=>setShowRegModal(true)}
                        className="bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold px-4 py-2.5 rounded-lg flex items-center justify-center gap-2 transition-colors">
                        Criar conta para aplicar →
                      </button>
                    )}
                    <button className="bg-[#111827] border border-[#252a3a] hover:bg-[#151929] text-slate-300 text-xs font-semibold px-4 py-2.5 rounded-lg transition-colors">
                      Rever alterações
                    </button>
                  </div>
                </div>
                <div className="mt-4 flex items-center gap-4 text-xs text-slate-400 pt-4 border-t border-[#1a1f2e]">
                  <span className="font-semibold">Impacto esperado</span>
                  <span>Risco: <span className="text-emerald-400">↓ Ligeiro</span></span>
                  <span className="text-slate-600">|</span>
                  <span>Retorno esperado: <span className="text-blue-400">↑ Moderado</span></span>
                </div>
              </div>

              {/* 2+3 */}
              <div className="grid grid-cols-2 gap-5">
                <div className="bg-[#0b0f1a] border border-[#1a1f2e] rounded-xl p-5">
                  <SH title="O que mudou"/>
                  <div className="space-y-4">
                    {whatChanged.map((b,i)=>(
                      <div key={i} className="flex gap-3">
                        <div className="mt-0.5 shrink-0">
                          {b.icon==="up"&&<TrendingUp size={18} className="text-emerald-400"/>}
                          {b.icon==="down"&&<TrendingDown size={18} className="text-red-400"/>}
                          {b.icon==="globe"&&<Globe size={18} className="text-blue-400"/>}
                          {b.icon==="wave"&&<Activity size={18} className="text-slate-400"/>}
                        </div>
                        <div><div className="text-slate-200 text-sm font-semibold">{b.title}</div><div className="text-slate-400 text-xs mt-0.5">{b.desc}</div></div>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="bg-[#0b0f1a] border border-[#1a1f2e] rounded-xl p-5">
                  <SH title="O seu nível de risco"/>
                  <div className="flex gap-6">
                    <div className="space-y-4">
                      <div>
                        <div className="text-slate-400 text-xs mb-1">Volatilidade (anual)</div>
                        <div className="text-2xl font-black text-white">{perfData?`${perfData.curVol.toFixed(1)}%`:"—"}</div>
                        <div className="text-slate-400 text-xs">Média</div>
                      </div>
                      <div>
                        <div className="text-slate-400 text-xs mb-1">Drawdown actual</div>
                        <div className="text-2xl font-black text-red-400">{perfData?`${perfData.curDD.toFixed(1)}%`:"—"}</div>
                      </div>
                      <div>
                        <div className="text-slate-400 text-xs mb-1">Nível de risco</div>
                        <div className="text-amber-400 font-bold text-sm">Moderado</div>
                        {/* gauge: verde → amarelo → encarnado */}
                        <div className="mt-2 w-32">
                          <div className="relative h-3 rounded-full overflow-hidden"
                            style={{background:"linear-gradient(to right,#22c55e,#f59e0b 50%,#ef4444)"}}>
                            {/* pointer at 55% (Moderado) */}
                            <div className="absolute top-0 bottom-0 w-0.5 bg-white/90 rounded-full shadow-sm" style={{left:"55%"}}/>
                          </div>
                          <div className="flex justify-between text-[9px] mt-0.5">
                            <span className="text-emerald-400">Baixo</span>
                            <span className="text-amber-400 font-semibold">Médio</span>
                            <span className="text-red-400">Alto</span>
                          </div>
                        </div>
                      </div>
                    </div>
                    <div className="flex-1">
                      <div className="text-slate-400 text-xs mb-2">Evolução do drawdown</div>
                      <ResponsiveContainer width="100%" height={130}>
                        <LineChart data={perfData?.ddChart??[]} margin={{top:4,right:4,left:-24,bottom:0}}>
                          <XAxis dataKey="date" tick={{fontSize:9,fill:"#64748b"}} tickLine={false} axisLine={false}
                            tickFormatter={d=>d.slice(0,4)} interval={Math.floor((perfData?.ddChart.length??1)/4)}/>
                          <YAxis tick={{fontSize:9,fill:"#64748b"}} tickLine={false} axisLine={false}
                            tickFormatter={v=>`${Number(v).toFixed(0)}%`} domain={["dataMin",0]}/>
                          <Tooltip content={<PerfTooltip/>}/>
                          <ReferenceLine y={0} stroke="#334155" strokeDasharray="3 3"/>
                          <Line type="monotone" dataKey="dd" stroke="#60a5fa" strokeWidth={1.5} dot={false} name="DD"/>
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                </div>
              </div>

              {/* 4+5 */}
              <div className="grid grid-cols-2 gap-5">
                <div className="bg-[#0b0f1a] border border-[#1a1f2e] rounded-xl p-5">
                  <div className="flex items-center justify-between mb-4">
                    <SH title="Alterações na carteira"/>
                    <button className="text-blue-400 text-xs hover:underline flex items-center gap-1 -mt-4">Ver carteira completa<ArrowUpRight size={12}/></button>
                  </div>
                  {recoLoading?(
                    <div className="text-slate-500 text-sm text-center py-6">A carregar…</div>
                  ):actionCounts.rows.length===0?(
                    <div className="text-slate-500 text-sm text-center py-6">Sem alterações este mês</div>
                  ):(
                    <table className="w-full text-xs">
                      <thead><tr className="text-slate-500 border-b border-[#1a1f2e]">
                        <th className="text-left pb-2 font-semibold">Ativo</th>
                        <th className="text-left pb-2 font-semibold">Setor</th>
                        <th className="text-right pb-2 font-semibold">Actual</th>
                        <th className="text-right pb-2 font-semibold">Novo</th>
                        <th className="text-right pb-2 font-semibold">Î”</th>
                        <th className="text-right pb-2 font-semibold">Ação</th>
                      </tr></thead>
                      <tbody>
                        {actionCounts.rows.map(r=>{
                          const ac=r.action==="Comprar"?"text-emerald-400":r.action==="Aumentar"?"text-cyan-400":r.action==="Vender"?"text-red-400":"text-amber-400";
                          const dc=r.delta>0?"text-emerald-400":"text-red-400";
                          return (
                            <tr key={r.ticker} className="border-b border-[#111520] hover:bg-white/[0.02]">
                              <td className="py-2.5 font-bold text-slate-200">{r.ticker}</td>
                              <td className="py-2.5 text-slate-400">{getSector(r.ticker)}</td>
                              <td className="py-2.5 text-right text-slate-300">{r.prev.toFixed(1)}%</td>
                              <td className="py-2.5 text-right text-slate-300">{r.cur.toFixed(1)}%</td>
                              <td className={`py-2.5 text-right font-semibold ${dc}`}>{r.delta>0?"+":""}{r.delta.toFixed(1)}%</td>
                              <td className={`py-2.5 text-right font-bold ${ac}`}>{r.action}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </div>
                <div className="bg-[#0b0f1a] border border-[#1a1f2e] rounded-xl p-5">
                  <div className="flex items-center justify-between mb-4">
                    <SH title="Alocação por setor"/>
                    <button className="text-blue-400 text-xs hover:underline flex items-center gap-1 -mt-4">Ver alocação completa<ArrowUpRight size={12}/></button>
                  </div>
                  {sectorData.length===0?(
                    <div className="text-slate-500 text-sm text-center py-6">A carregar…</div>
                  ):(
                    <div className="flex items-center gap-4">
                      <ResponsiveContainer width={160} height={160}>
                        <PieChart>
                          <Pie data={sectorData} cx="50%" cy="50%" innerRadius={48} outerRadius={72} dataKey="value" strokeWidth={0}>
                            {sectorData.map((_,i)=><Cell key={i} fill={PIE_COLORS[i%PIE_COLORS.length]}/>)}
                          </Pie>
                          <Tooltip formatter={(v:number)=>`${v}%`} contentStyle={{background:"#1e293b",border:"1px solid #334155",borderRadius:8,fontSize:11}}/>
                        </PieChart>
                      </ResponsiveContainer>
                      <div className="flex-1 space-y-2">
                        {sectorData.map((s,i)=>(
                          <div key={s.name} className="flex items-center justify-between text-xs">
                            <div className="flex items-center gap-2"><div className="w-2.5 h-2.5 rounded-sm shrink-0" style={{background:PIE_COLORS[i%PIE_COLORS.length]}}/><span className="text-slate-300">{s.name}</span></div>
                            <span className="text-slate-400 font-semibold">{s.value}%</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* 6. simulador (substituiu gráfico estático) */}
              <div className="bg-[#0b0f1a] border border-[#1a1f2e] rounded-xl overflow-hidden">
                <div className="flex items-center justify-between px-5 pt-5 pb-3">
                  <div className="flex items-center gap-2">
                    <h2 className="text-slate-200 text-sm font-bold tracking-wide uppercase">Simulação de Capital</h2>
                    <Info size={13} className="text-slate-500"/>
                  </div>
                  {!loggedIn&&(
                    <button onClick={()=>setShowRegModal(true)}
                      className="text-xs px-3 py-1.5 bg-blue-600/20 hover:bg-blue-600/30 border border-blue-500/30 text-blue-400 rounded-lg font-semibold transition-colors">
                      Guardar simulação →
                    </button>
                  )}
                </div>
                <div className="px-5 pb-5">
                  <NativeSimulator
                    dates={dates}
                    equity={equityRaw}
                    bench={benchRaw}
                    onRegister={()=>setShowRegModal(true)}
                    loggedIn={loggedIn}
                  />
                </div>
              </div>

              {/* historical performance (compact, below simulator) */}
              <div className="bg-[#0b0f1a] border border-[#1a1f2e] rounded-xl p-5">
                <div className="flex items-center justify-between mb-4">
                  <SH title="Performance histórica"/>
                  <div className="flex gap-1 -mt-4">
                    {PERIODS.map(p=>(
                      <button key={p} onClick={()=>setPeriod(p)}
                        className={["px-3 py-1 rounded text-xs font-semibold transition-colors",
                          period===p?"bg-blue-500/20 text-blue-400 border border-blue-500/30":"text-slate-400 hover:text-slate-200"].join(" ")}>
                        {p}
                      </button>
                    ))}
                  </div>
                </div>
                {perfData&&(
                  <div className="flex gap-8 mb-4">
                    <div><div className="text-slate-400 text-xs mb-0.5">Retorno ({period})</div><div className={`text-2xl font-black ${perfData.m.ret>=0?"text-emerald-400":"text-red-400"}`}>{fmt(perfData.m.ret,true)}</div></div>
                    <div><div className="text-slate-400 text-xs mb-0.5">Retorno anualizado</div><div className={`text-2xl font-black ${perfData.m.ann>=0?"text-emerald-400":"text-red-400"}`}>{fmt(perfData.m.ann,true)}</div></div>
                    <div><div className="text-slate-400 text-xs mb-0.5">Sharpe</div><div className="text-2xl font-black text-white">{perfData.m.shp.toFixed(2)}</div></div>
                  </div>
                )}
                <ResponsiveContainer width="100%" height={180}>
                  <LineChart data={perfData?.chart??[]} margin={{top:4,right:8,left:-4,bottom:0}}>
                    <XAxis dataKey="date" tick={{fontSize:10,fill:"#64748b"}} tickLine={false} axisLine={false} interval={Math.floor((perfData?.chart.length??1)/6)}/>
                    <YAxis scale="log" domain={["auto","auto"]} allowDataOverflow
                      tick={{fontSize:9,fill:"#64748b"}} tickLine={false} axisLine={false}
                      tickFormatter={v=>{const r=(Number(v)/100-1)*100; return `${r>=0?"+":""}${r.toFixed(0)}%`;}}/>
                    <Tooltip content={<PerfTooltip/>}/>
                    <ReferenceLine y={100} stroke="#334155" strokeDasharray="3 3"/>
                    <Line type="monotone" dataKey="modelo" stroke="#60a5fa" strokeWidth={2} dot={false} name="Modelo"/>
                    <Line type="monotone" dataKey="bench"  stroke="#64748b" strokeWidth={1.5} dot={false} name="Benchmark" strokeDasharray="4 2"/>
                  </LineChart>
                </ResponsiveContainer>
                <div className="flex items-center gap-4 mt-3">
                  <div className="flex items-center gap-2 text-xs text-slate-400"><div className="w-5 h-0.5 bg-blue-400 rounded"/>Modelo</div>
                  <div className="flex items-center gap-2 text-xs text-slate-400"><div className="w-5 h-px bg-slate-400 rounded"/>Benchmark</div>
                </div>
                <p className="text-slate-600 text-[10px] mt-3 text-center">As recomendações não constituem aconselhamento personalizado de investimento.</p>
              </div>
            </>
            )}

              {/* ── CARTEIRA ── */}
              {activePage==="carteira"&&(
                <div className="space-y-5">
                  <div className="grid grid-cols-3 gap-4">
                    <div className="bg-[#0b0f1a] border border-[#1a1f2e] rounded-xl p-5">
                      <div className="text-slate-400 text-xs mb-2">Nº de posições</div>
                      <div className="text-3xl font-black text-white">{actionCounts.comprar+actionCounts.aumentar+actionCounts.reduzir+actionCounts.vender+actionCounts.manter||20}</div>
                    </div>
                    <div className="bg-[#0b0f1a] border border-[#1a1f2e] rounded-xl p-5">
                      <div className="text-slate-400 text-xs mb-2">Alocação em acções</div>
                      <div className="text-3xl font-black text-emerald-400">{latestMonth?`${(100-(latestMonth.tbillsTotalPct??0)).toFixed(0)}%`:"—"}</div>
                    </div>
                    <div className="bg-[#0b0f1a] border border-[#1a1f2e] rounded-xl p-5">
                      <div className="text-slate-400 text-xs mb-2">Rebalanceamento</div>
                      <div className="text-3xl font-black text-blue-400">{recoLabel}</div>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-5">
                    <div className="bg-[#0b0f1a] border border-[#1a1f2e] rounded-xl p-5">
                      <div className="font-bold text-slate-200 text-sm mb-4">Alocação por setor</div>
                      <div className="flex gap-4">
                        <ResponsiveContainer width={140} height={140}>
                          <PieChart><Pie data={sectorData} cx="50%" cy="50%" innerRadius={40} outerRadius={65} dataKey="value" paddingAngle={2}>
                            {sectorData.map((_,i)=><Cell key={i} fill={["#60a5fa","#34d399","#f59e0b","#f87171","#a78bfa","#22d3ee"][i%6]!}/>)}
                          </Pie></PieChart>
                        </ResponsiveContainer>
                        <div className="space-y-2 flex-1">
                          {sectorData.slice(0,6).map((s,i)=>(
                            <div key={s.name} className="flex items-center justify-between text-xs">
                              <div className="flex items-center gap-2">
                                <div className="w-2.5 h-2.5 rounded-sm" style={{background:["#60a5fa","#34d399","#f59e0b","#f87171","#a78bfa","#22d3ee"][i%6]}}/>
                                <span className="text-slate-300">{s.name}</span>
                              </div>
                              <span className="text-slate-400 font-semibold">{s.value}%</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                    <div className="bg-[#0b0f1a] border border-[#1a1f2e] rounded-xl p-5">
                      <div className="font-bold text-slate-200 text-sm mb-4">Exposição geográfica</div>
                      <div className="space-y-3">
                        {geoData.map(g=>(
                          <div key={g.name}>
                            <div className="flex justify-between text-xs mb-1">
                              <span className="text-slate-300">{g.name}</span>
                              <span className="text-slate-400 font-semibold">{g.value}%</span>
                            </div>
                            <div className="h-1.5 rounded-full bg-[#1a1f2e]">
                              <div className="h-full rounded-full bg-blue-500" style={{width:`${g.value}%`}}/>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div className="bg-[#0b0f1a] border border-[#1a1f2e] rounded-xl p-5">
                    <div className="font-bold text-slate-200 text-sm mb-4">Principais posições</div>
                    <table className="w-full text-xs">
                      <thead><tr className="text-slate-500 border-b border-[#1a1f2e]">
                        <th className="text-left pb-2">Ativo</th><th className="text-left pb-2">Setor</th>
                        <th className="text-right pb-2">Peso actual</th><th className="text-right pb-2">Novo peso</th>
                        <th className="text-right pb-2">Variação</th>
                      </tr></thead>
                      <tbody>
                        {(latestMonth?.rows??[]).filter(r=>r.ticker!=="TBILL_PROXY"&&!r.ticker.startsWith("CASH"))
                          .sort((a,b)=>b.weightPct-a.weightPct).slice(0,15).map(r=>{
                          const prev=(sortedMonths[sortedMonths.length-2]?.rows??[]).find(x=>x.ticker===r.ticker)?.weightPct??0;
                          const delta=r.weightPct-prev;
                          return (
                            <tr key={r.ticker} className="border-b border-[#0f1420] hover:bg-white/2">
                              <td className="py-2.5 text-slate-200 font-semibold">{r.ticker}</td>
                              <td className="py-2.5 text-slate-400">{getSector(r.ticker)}</td>
                              <td className="py-2.5 text-right text-slate-300">{prev.toFixed(1)}%</td>
                              <td className="py-2.5 text-right text-white font-semibold">{r.weightPct.toFixed(1)}%</td>
                              <td className={`py-2.5 text-right font-semibold ${delta>=0?"text-emerald-400":"text-red-400"}`}>{delta>=0?"+":""}{delta.toFixed(1)}pp</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* ── PERFORMANCE ── */}
              {activePage==="perf"&&(
                <div className="space-y-5">
                  <div className="grid grid-cols-4 gap-4">
                    {perfData&&[
                      {label:"Retorno ("+period+")",val:fmt(perfData.m.ret,true),c:perfData.m.ret>=0?"text-emerald-400":"text-red-400"},
                      {label:"CAGR",val:fmt(perfData.m.ann,true),c:perfData.m.ann>=0?"text-emerald-400":"text-red-400"},
                      {label:"Sharpe",val:perfData.m.shp.toFixed(2),c:"text-white"},
                      {label:"Volatilidade anual",val:`${perfData.curVol.toFixed(1)}%`,c:"text-amber-400"},
                    ].map(({label,val,c})=>(
                      <div key={label} className="bg-[#0b0f1a] border border-[#1a1f2e] rounded-xl p-5">
                        <div className="text-slate-400 text-xs mb-2">{label}</div>
                        <div className={`text-2xl font-black ${c}`}>{val}</div>
                      </div>
                    ))}
                  </div>
                  <div className="bg-[#0b0f1a] border border-[#1a1f2e] rounded-xl p-5">
                    <div className="flex items-center justify-between mb-4">
                      <div className="font-bold text-slate-200 text-sm">Evolução do investimento</div>
                      <div className="flex gap-1">{PERIODS.map(p=>(
                        <button key={p} onClick={()=>setPeriod(p)}
                          className={`px-3 py-1 rounded text-xs font-semibold transition-colors ${period===p?"bg-blue-600 text-white":"text-slate-400 hover:text-slate-200"}`}>{p}</button>
                      ))}</div>
                    </div>
                    <ResponsiveContainer width="100%" height={220}>
                      <LineChart data={perfData?.chart??[]} margin={{top:4,right:8,left:-4,bottom:0}}>
                        <XAxis dataKey="date" tick={{fontSize:10,fill:"#64748b"}} tickLine={false} axisLine={false} interval={Math.floor((perfData?.chart.length??1)/6)}/>
                        <YAxis scale="log" domain={["auto","auto"]} allowDataOverflow tick={{fontSize:9,fill:"#64748b"}} tickLine={false} axisLine={false} tickFormatter={v=>{const r=(Number(v)/100-1)*100;return `${r>=0?"+":""}${r.toFixed(0)}%`;}}/>
                        <Tooltip content={<PerfTooltip/>}/>
                        <ReferenceLine y={100} stroke="#334155" strokeDasharray="3 3"/>
                        <Line type="monotone" dataKey="modelo" stroke="#60a5fa" strokeWidth={2} dot={false} name="Modelo"/>
                        <Line type="monotone" dataKey="bench" stroke="#475569" strokeWidth={1.5} dot={false} name="Benchmark" strokeDasharray="4 2"/>
                      </LineChart>
                    </ResponsiveContainer>
                    <div className="flex items-center gap-4 mt-3">
                      <div className="flex items-center gap-2 text-xs text-slate-400"><div className="w-5 h-0.5 bg-blue-400 rounded"/>Modelo</div>
                      <div className="flex items-center gap-2 text-xs text-slate-400"><div className="w-5 h-px bg-slate-400 rounded"/>Benchmark</div>
                    </div>
                  </div>
                  <div className="bg-[#0b0f1a] border border-[#1a1f2e] rounded-xl p-5">
                    <div className="font-bold text-slate-200 text-sm mb-4">Retornos anuais</div>
                    <ResponsiveContainer width="100%" height={200}>
                      <BarChart data={annualReturns} margin={{top:4,right:8,left:-4,bottom:0}} barGap={2}>
                        <XAxis dataKey="year" tick={{fontSize:10,fill:"#64748b"}} axisLine={false} tickLine={false}/>
                        <YAxis tick={{fontSize:9,fill:"#64748b"}} axisLine={false} tickLine={false} tickFormatter={v=>`${v}%`}/>
                        <Tooltip formatter={(v:number)=>[`${v>0?"+":""}${v}%`]} contentStyle={{background:"#111827",border:"1px solid #252a3a",borderRadius:8,fontSize:11}}/>
                        <ReferenceLine y={0} stroke="#334155"/>
                        <Bar dataKey="modelo" name="Modelo" radius={[3,3,0,0]}>
                          {annualReturns.map((r,i)=><Cell key={i} fill={r.modelo>=0?"#60a5fa":"#f87171"}/>)}
                        </Bar>
                        <Bar dataKey="bench" name="Benchmark" fill="#334155" radius={[3,3,0,0]}/>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}

              {/* ── RISCO ── */}
              {activePage==="risco"&&(
                <div className="space-y-5">
                  <div className="grid grid-cols-4 gap-4">
                    {[
                      {label:"Volatilidade anual",val:perfData?`${perfData.curVol.toFixed(1)}%`:"—",c:"text-amber-400"},
                      {label:"VaR 95% (diário)",val:riskMetrics?`${riskMetrics.var95.toFixed(2)}%`:"—",c:"text-red-400"},
                      {label:"Beta",val:riskMetrics?`${riskMetrics.beta}`:"—",c:"text-slate-200"},
                      {label:"Drawdown actual",val:perfData?`${perfData.curDD.toFixed(1)}%`:"—",c:"text-red-400"},
                    ].map(({label,val,c})=>(
                      <div key={label} className="bg-[#0b0f1a] border border-[#1a1f2e] rounded-xl p-5">
                        <div className="text-slate-400 text-xs mb-2">{label}</div>
                        <div className={`text-2xl font-black ${c}`}>{val}</div>
                      </div>
                    ))}
                  </div>
                  <div className="grid grid-cols-2 gap-5">
                    <div className="bg-[#0b0f1a] border border-[#1a1f2e] rounded-xl p-5">
                      <div className="font-bold text-slate-200 text-sm mb-3">Nível de risco</div>
                      <div className="text-amber-400 text-2xl font-black mb-4">Moderado</div>
                      <div className="relative h-3 rounded-full overflow-hidden mb-1" style={{background:"linear-gradient(to right,#22c55e,#f59e0b 50%,#ef4444)"}}>
                        <div className="absolute top-0 bottom-0 w-0.5 bg-white/90 rounded-full" style={{left:"55%"}}/>
                      </div>
                      <div className="flex justify-between text-[9px] mt-0.5">
                        <span className="text-emerald-400">Baixo</span><span className="text-amber-400">Médio</span><span className="text-red-400">Alto</span>
                      </div>
                      <div className="mt-4 space-y-2 text-xs">
                        {[
                          {label:"Volatilidade alvo",val:"15-20%"},
                          {label:"CAP15 activo",val:"Sim"},
                          {label:"Perfil",val:"Moderado"},
                        ].map(({label,val})=>(
                          <div key={label} className="flex justify-between"><span className="text-slate-400">{label}</span><span className="text-slate-200 font-semibold">{val}</span></div>
                        ))}
                      </div>
                    </div>
                    <div className="bg-[#0b0f1a] border border-[#1a1f2e] rounded-xl p-5">
                      <div className="font-bold text-slate-200 text-sm mb-3">Drawdown histórico (20 anos)</div>
                      <ResponsiveContainer width="100%" height={160}>
                        <LineChart data={perfData?.ddChart??[]} margin={{top:4,right:4,left:-24,bottom:0}}>
                          <XAxis dataKey="date" tick={{fontSize:9,fill:"#64748b"}} tickLine={false} axisLine={false} tickFormatter={d=>d.slice(0,4)} interval={Math.floor((perfData?.ddChart.length??1)/4)}/>
                          <YAxis tick={{fontSize:9,fill:"#64748b"}} tickLine={false} axisLine={false} tickFormatter={v=>`${Number(v).toFixed(0)}%`} domain={["dataMin",0]}/>
                          <Tooltip content={<PerfTooltip/>}/>
                          <ReferenceLine y={0} stroke="#334155" strokeDasharray="3 3"/>
                          <Line type="monotone" dataKey="dd" stroke="#f87171" strokeWidth={1.5} dot={false} name="Drawdown"/>
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                </div>
              )}

              {/* ── HISTÓRICO ── */}
              {activePage==="historico"&&(
                <div className="bg-[#0b0f1a] border border-[#1a1f2e] rounded-xl p-5">
                  <div className="font-bold text-slate-200 text-sm mb-5">Histórico de recomendações</div>
                  <table className="w-full text-xs">
                    <thead><tr className="text-slate-500 border-b border-[#1a1f2e] text-left">
                      <th className="pb-3 font-semibold">Data</th>
                      <th className="pb-3 font-semibold">Comprar</th>
                      <th className="pb-3 font-semibold">Vender</th>
                      <th className="pb-3 font-semibold">Manter</th>
                      <th className="pb-3 font-semibold">Resumo</th>
                      <th className="pb-3 font-semibold">Estado</th>
                    </tr></thead>
                    <tbody>
                      {[...sortedMonths].reverse().map((m,i)=>{
                        const raw=m.date??m.rebalance_date??"";
                        const label=raw?new Date(raw).toLocaleDateString("pt-PT",{month:"long",year:"numeric"}):raw;
                        const prev=sortedMonths[sortedMonths.length-1-i-1];
                        const pm=new Map((prev?.rows??[]).map(r=>[r.ticker,r.weightPct]));
                        const cm=new Map(m.rows.map(r=>[r.ticker,r.weightPct]));
                        let c2=0,v2=0,mt=0;
                        const N2=20,DMIN2=1;
                        const cands=[...new Set([...pm.keys(),...cm.keys()])].filter(t=>t!=="TBILL_PROXY"&&!t.startsWith("TBILL")).slice(0,N2);
                        cands.forEach(t=>{const p=pm.get(t)??0,cu=cm.get(t)??0,d=cu-p;if(p===0&&cu>0||d>=DMIN2)c2++;else if(cu===0&&p>0||d<=-DMIN2)v2++;else mt++;});
                        const isLatest=i===0;
                        return (
                          <tr key={i} className="border-b border-[#0f1420] hover:bg-white/2">
                            <td className="py-3 text-slate-200 font-semibold capitalize">{label}</td>
                            <td className="py-3 text-emerald-400 font-bold">{c2}</td>
                            <td className="py-3 text-red-400 font-bold">{v2}</td>
                            <td className="py-3 text-slate-400">{mt}</td>
                            <td className="py-3 text-slate-400">Rebalanceamento mensal</td>
                            <td className="py-3">
                              <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${isLatest?"bg-amber-500/20 text-amber-400":"bg-emerald-500/15 text-emerald-400"}`}>
                                {isLatest?"Pendente":"Aprovado"}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {/* ── AJUDA ── */}
              {activePage==="ajuda"&&(
                <div className="space-y-5">
                  <div className="bg-[#0b0f1a] border border-[#1a1f2e] rounded-xl p-5">
                    <div className="font-bold text-slate-200 text-sm mb-4">Tópicos frequentes</div>
                    <div className="grid grid-cols-2 gap-3">
                      {[
                        {q:"Como funcionam as recomendações?",a:"O DECIDE analisa mensalmente o universo de activos com modelos quantitativos de momentum e qualidade. O resultado é uma lista de comprar, vender e manter para rebalancear a carteira."},
                        {q:"Como aprovar as recomendações?",a:"Na página Recomendações, clica em 'Aprovar recomendações'. O sistema gera as ordens e envia para a tua corretora (Interactive Brokers). Precisas de conta na corretora ligada."},
                        {q:"Como é calculado o risco?",a:"O risco é medido pela volatilidade anualizada da carteira e pelo VaR 95% diário. O modelo usa o mecanismo CAP15 para limitar a volatilidade ao nível Moderado (12-20% aa)."},
                        {q:"O que é o CAGR histórico?",a:"Compound Annual Growth Rate — taxa de crescimento anual composta ao longo do período histórico. Com 25.04% ao ano durante 20 anos, €10.000 tornam-se em mais de €700.000."},
                        {q:"Com que frequência rebalancear?",a:"O modelo gera recomendações mensalmente. Rebalanceamentos muito frequentes aumentam custos. Podes aprovar mensalmente ou seguir sinais fortes (Comprar/Vender) apenas."},
                        {q:"Como ligar a corretora?",a:"No onboarding, seleccionas Interactive Brokers como corretora. Precisas de API Key e Account ID. O DECIDE envia ordens via IBKR API com aprovação prévia do utilizador."},
                      ].map(({q,a},i)=>(
                        <div key={i} className="bg-[#080c14] border border-[#1a1f2e] rounded-lg p-4">
                          <div className="text-slate-200 font-semibold text-xs mb-2">{q}</div>
                          <div className="text-slate-400 text-xs leading-relaxed">{a}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="bg-[#0b0f1a] border border-[#1a1f2e] rounded-xl p-5">
                    <div className="font-bold text-slate-200 text-sm mb-4">Guias e recursos</div>
                    <div className="grid grid-cols-3 gap-3">
                      {[
                        {label:"Guia rápido da plataforma",desc:"Passos essenciais para começar"},
                        {label:"Glossário de termos",desc:"Definição dos principais termos"},
                        {label:"Vídeos tutoriais",desc:"Tutoriais em vídeo passo a passo"},
                        {label:"Política de risco",desc:"Como o modelo gere o risco"},
                        {label:"FAQ completo",desc:"Todas as perguntas e respostas"},
                        {label:"Contactar suporte",desc:"Fala directamente com a equipa"},
                      ].map(({label,desc})=>(
                        <button key={label} onClick={()=>label==="Contactar suporte"&&setActivePage("contactos")}
                          className="bg-[#080c14] border border-[#1a1f2e] rounded-lg p-4 text-left hover:border-blue-500/40 transition-colors">
                          <HelpCircle size={16} className="text-blue-400 mb-2"/>
                          <div className="text-slate-200 text-xs font-semibold">{label}</div>
                          <div className="text-slate-500 text-[10px] mt-0.5">{desc}</div>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* ── CONTACTOS ── */}
              {activePage==="contactos"&&(
                <div className="grid grid-cols-2 gap-5">
                  <div className="space-y-4">
                    <div className="bg-[#0b0f1a] border border-[#1a1f2e] rounded-xl p-5">
                      <div className="font-bold text-slate-200 text-sm mb-4">Fale connosco</div>
                      <div className="space-y-3">
                        {[
                          {Icon:Phone,label:"Telefone",val:"+351 21 302 34 48"},
                          {Icon:Mail,label:"Email",val:"geral@decide.pt"},
                          {Icon:MapPin,label:"Morada",val:"Av. da Liberdade, 123\n1250-140 Lisboa, Portugal"},
                        ].map(({Icon,label,val})=>(
                          <div key={label} className="flex items-start gap-3 p-3 bg-[#080c14] rounded-lg">
                            <Icon size={16} className="text-blue-400 mt-0.5 shrink-0"/>
                            <div>
                              <div className="text-slate-500 text-[10px]">{label}</div>
                              <div className="text-slate-200 text-xs font-semibold whitespace-pre-line">{val}</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="bg-[#0b0f1a] border border-[#1a1f2e] rounded-xl p-5">
                      <div className="font-bold text-slate-200 text-sm mb-3">Horário de atendimento</div>
                      <div className="space-y-2 text-xs">
                        {[["Segunda a Sexta","9h - 18h"],["Sábado","10h - 13h"],["Domingo","Encerrado"]].map(([d,h])=>(
                          <div key={d} className="flex justify-between"><span className="text-slate-400">{d}</span><span className="text-slate-200">{h}</span></div>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div className="bg-[#0b0f1a] border border-[#1a1f2e] rounded-xl p-5">
                    <div className="font-bold text-slate-200 text-sm mb-4">Envie-nos uma mensagem</div>
                    {contactSent?(
                      <div className="flex flex-col items-center justify-center h-64 gap-3">
                        <CheckCircle2 size={40} className="text-emerald-400"/>
                        <div className="text-emerald-400 font-bold">Mensagem enviada!</div>
                        <div className="text-slate-400 text-xs text-center">Respondemos em 1 dia útil.</div>
                        <button onClick={()=>{setContactSent(false);setContactForm({nome:"",email:"",assunto:"",msg:""}); }}
                          className="mt-2 text-xs text-blue-400 underline">Enviar outra mensagem</button>
                      </div>
                    ):(
                      <form onSubmit={e=>{e.preventDefault();setContactSent(true);}} className="space-y-3">
                        {[
                          {k:"nome",label:"Nome",type:"text",ph:"O seu nome"},
                          {k:"email",label:"Email",type:"email",ph:"email@exemplo.com"},
                          {k:"assunto",label:"Assunto",type:"text",ph:"Seleccione o assunto"},
                        ].map(({k,label,type,ph})=>(
                          <div key={k}>
                            <label className="text-xs text-slate-400 mb-1 block">{label}</label>
                            <input type={type} placeholder={ph} value={(contactForm as any)[k]} required
                              onChange={e=>setContactForm(f=>({...f,[k]:e.target.value}))}
                              className="w-full bg-[#080c14] border border-[#252a3a] text-slate-200 text-xs rounded-lg px-3 py-2.5 outline-none focus:border-blue-500 transition-colors"/>
                          </div>
                        ))}
                        <div>
                          <label className="text-xs text-slate-400 mb-1 block">Mensagem</label>
                          <textarea rows={4} placeholder="Descreva a sua questão..." required value={contactForm.msg}
                            onChange={e=>setContactForm(f=>({...f,msg:e.target.value}))}
                            className="w-full bg-[#080c14] border border-[#252a3a] text-slate-200 text-xs rounded-lg px-3 py-2.5 outline-none focus:border-blue-500 transition-colors resize-none"/>
                        </div>
                        <button type="submit"
                          className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold rounded-lg py-2.5 transition-colors">
                          <Send size={13}/>Enviar mensagem
                        </button>
                      </form>
                    )}
                  </div>
                </div>
              )}

            </div>
          </main>
        </div>
      </div>
    </>
  );
}


