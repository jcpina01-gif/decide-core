import Head from "next/head";
import { useRouter } from "next/router";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, ReferenceLine,
  BarChart, Bar, CartesianGrid,
  AreaChart, Area,
} from "recharts";
import {
  LayoutDashboard, BookOpen, Briefcase, TrendingUp, TrendingDown,
  ShieldCheck, Clock, Settings, LogOut, ChevronDown, Info,
  ArrowUpRight, ArrowDownRight, Minus, X, Eye, EyeOff,
  Globe, Activity, HelpCircle, Mail, Phone, MapPin, Send,
  CheckCircle2, Receipt, Bell, Sliders, AlertTriangle,
} from "lucide-react";
import {
  isClientLoggedIn, getCurrentSessionUser,
  registerClientUser, loginClientUser,
  normalizeClientPhone,
  setSignupEmailVerifiedFromServerEmail,
  setSignupPhoneVerifiedFromServerPhone,
  isSignupEmailVerifiedForInput,
  isSignupPhoneVerifiedForInput,
  fetchSignupEmailVerifiedFromServer,
  deriveClientUsernameFromEmail,
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
            {l:`vs ${BENCH_SHORT}`,v:fmt(benchFinal),c:"text-slate-400"},
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
          <Line type="monotone" dataKey="bench" stroke="#475569" strokeWidth={1.5} dot={false} name={BENCH_SHORT} strokeDasharray="4 2"/>
        </LineChart>
      </ResponsiveContainer>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-5 text-xs text-slate-400">
          <span className="flex items-center gap-1.5"><span className="w-5 h-0.5 bg-blue-400 inline-block rounded"/>DECIDE</span>
          <span className="flex items-center gap-1.5"><span className="w-5 h-px bg-slate-500 inline-block rounded"/>{BENCH_SHORT}</span>
        </div>
        {!loggedIn&&(
          <button onClick={onRegister}
            className="text-xs px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-lg transition-colors">
            Guardar e executar esta estratégia &rarr;
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

/* ─── sector map ─────────────────────────────────────────────────────────── */
const SECTOR: Record<string, string> = {
  AAPL:"Tecnologia",NVDA:"Tecnologia",MSFT:"Tecnologia",GOOGL:"Tecnologia",GOOG:"Tecnologia",
  META:"Tecnologia",AVGO:"Tecnologia",AMD:"Tecnologia",CRM:"Tecnologia",
  ORCL:"Tecnologia",QCOM:"Tecnologia",TXN:"Tecnologia",AMAT:"Tecnologia",
  KLAC:"Tecnologia",LRCX:"Tecnologia",SNPS:"Tecnologia",CDNS:"Tecnologia",
  CTSH:"Tecnologia",NOW:"Tecnologia",ADBE:"Tecnologia",INTU:"Tecnologia",
  INTC:"Tecnologia",MU:"Tecnologia",MRVL:"Tecnologia",ON:"Tecnologia",NOK:"Tecnologia",XYZ:"Tecnologia",
  ADI:"Tecnologia",MSI:"Tecnologia",PANW:"Tecnologia",DDOG:"Tecnologia",ASML:"Tecnologia",
  SFTBY:"Tecnologia",MRAAY:"Tecnologia",IFNNY:"Tecnologia",APH:"Tecnologia",PLTR:"Tecnologia",
  JPM:"Financeiro",GS:"Financeiro",MS:"Financeiro",BAC:"Financeiro",
  V:"Financeiro",MA:"Financeiro",AXP:"Financeiro",BLK:"Financeiro",
  SPGI:"Financeiro",ICE:"Financeiro",MCO:"Financeiro",COF:"Financeiro",
  CM:"Financeiro",SMFG:"Financeiro",NMR:"Financeiro",ALL:"Financeiro",
  BKNG:"Cons. Discr.",AMZN:"Cons. Discr.",TSLA:"Cons. Discr.",
  NKE:"Cons. Discr.",MCD:"Cons. Discr.",SBUX:"Cons. Discr.",
  TJX:"Cons. Discr.",LOW:"Cons. Discr.",HD:"Cons. Discr.",WBD:"Comunicação",
  UBER:"Cons. Discr.",CMG:"Cons. Discr.",PDD:"Cons. Discr.",DHI:"Cons. Discr.",
  CAT:"Industrial",HON:"Industrial",MMM:"Industrial",GE:"Industrial",
  LMT:"Industrial",RTX:"Industrial",UNP:"Industrial",CSX:"Industrial",
  DE:"Industrial",EMR:"Industrial",ETN:"Industrial",MARUY:"Industrial",
  CTAS:"Industrial",TM:"Industrial",MSBHF:"Industrial",PH:"Industrial",PCAR:"Industrial",
  UNH:"Saúde",JNJ:"Saúde",LLY:"Saúde",ABBV:"Saúde",
  MRK:"Saúde",PFE:"Saúde",TMO:"Saúde",ABT:"Saúde",BAYRY:"Saúde",NVO:"Saúde",
  XOM:"Energia",CVX:"Energia",COP:"Energia",EOG:"Energia",E:"Energia",
  PXD:"Energia",SLB:"Energia",PSX:"Energia",VLO:"Energia",
  EQNR:"Energia",SU:"Energia",JXHLY:"Energia",FANG:"Energia",
  WMT:"Cons. Básico",PG:"Cons. Básico",KO:"Cons. Básico",BATS:"Cons. Básico",
  PEP:"Cons. Básico",COST:"Cons. Básico",MDLZ:"Cons. Básico",
  NEM:"Mat. Básicos",GOLD:"Mat. Básicos",AEM:"Mat. Básicos",WPM:"Mat. Básicos",
  XEON:"Liquidez",
};
const getSector = (t: string) => SECTOR[t.toUpperCase()] ?? "Outros";

/* ─── country map ──────────────────────────────────────────────────────────── */
const COUNTRY:Record<string,string>={
  AAPL:"EUA",NVDA:"EUA",MSFT:"EUA",GOOGL:"EUA",GOOG:"EUA",META:"EUA",
  AVGO:"EUA",AMD:"EUA",CRM:"EUA",ORCL:"EUA",QCOM:"EUA",TXN:"EUA",
  AMAT:"EUA",MRVL:"EUA",KLAC:"EUA",ON:"EUA",MU:"EUA",INTC:"EUA",
  LRCX:"EUA",XYZ:"EUA",CAT:"EUA",NEM:"EUA",GOLD:"Canadá",WBD:"EUA",
  ADI:"EUA",MSI:"EUA",PANW:"EUA",DDOG:"EUA",PLTR:"EUA",APH:"EUA",
  DHI:"EUA",UBER:"EUA",CMG:"EUA",CTAS:"EUA",PH:"EUA",PCAR:"EUA",
  ALL:"EUA",FANG:"EUA",
  JPM:"EUA",GS:"EUA",MS:"EUA",BAC:"EUA",V:"EUA",MA:"EUA",AXP:"EUA",
  BLK:"EUA",SPGI:"EUA",ICE:"EUA",MCO:"EUA",COF:"EUA",
  BKNG:"EUA",AMZN:"EUA",TSLA:"EUA",NKE:"EUA",MCD:"EUA",SBUX:"EUA",
  TJX:"EUA",LOW:"EUA",HD:"EUA",
  UNH:"EUA",JNJ:"EUA",LLY:"EUA",ABBV:"EUA",MRK:"EUA",PFE:"EUA",
  TMO:"EUA",ABT:"EUA",
  XOM:"EUA",CVX:"EUA",COP:"EUA",EOG:"EUA",PXD:"EUA",SLB:"EUA",
  PSX:"EUA",VLO:"EUA",
  WMT:"EUA",PG:"EUA",KO:"EUA",PEP:"EUA",COST:"EUA",MDLZ:"EUA",
  HON:"EUA",MMM:"EUA",GE:"EUA",LMT:"EUA",RTX:"EUA",UNP:"EUA",
  CSX:"EUA",DE:"EUA",EMR:"EUA",ETN:"EUA",
  AEM:"Canadá",WPM:"Canadá",CM:"Canadá",SU:"Canadá",
  NOK:"Finlândia",BATS:"Reino Unido",E:"Itália",BAYRY:"Alemanha",MARUY:"Japão",
  ASML:"Países Baixos",IFNNY:"Alemanha",
  EQNR:"Noruega",
  SFTBY:"Japão",MRAAY:"Japão",TM:"Japão",MSBHF:"Japão",JXHLY:"Japão",
  SMFG:"Japão",NMR:"Japão",
  NVO:"Dinamarca",
  PDD:"China",
  XEON:"Eurozona",
};
const getZone=(t:string)=>COUNTRY[t.toUpperCase()]??"EUA";

/* ─── company name map ─────────────────────────────────────────────────────── */
const COMPANY:Record<string,string>={
  AAPL:"Apple",NVDA:"Nvidia",MSFT:"Microsoft",GOOGL:"Alphabet A",GOOG:"Alphabet C",
  META:"Meta",AVGO:"Broadcom",AMD:"AMD",CRM:"Salesforce",ORCL:"Oracle",
  QCOM:"Qualcomm",TXN:"Texas Instruments",AMAT:"Applied Materials",
  MRVL:"Marvell",KLAC:"KLA Corp",ON:"ON Semi",MU:"Micron",INTC:"Intel",
  LRCX:"Lam Research",XYZ:"Block",NOK:"Nokia",
  ADI:"Analog Devices",MSI:"Motorola Solutions",PANW:"Palo Alto Networks",
  DDOG:"Datadog",ASML:"ASML",PLTR:"Palantir",APH:"Amphenol",
  SFTBY:"SoftBank",MRAAY:"Murata Mfg",IFNNY:"Infineon",
  CAT:"Caterpillar",NEM:"Newmont",GOLD:"Barrick Gold",WBD:"Warner Bros.",
  BATS:"BAT",E:"ENI",BAYRY:"Bayer",MARUY:"Marubeni",
  TM:"Toyota",MSBHF:"Mitsubishi Corp",JXHLY:"ENEOS Holdings",
  SMFG:"Sumitomo Mitsui",NMR:"Nomura",
  NVO:"Novo Nordisk",
  JPM:"JPMorgan",GS:"Goldman Sachs",MS:"Morgan Stanley",BAC:"Bank of America",
  V:"Visa",MA:"Mastercard",AXP:"Amex",BLK:"BlackRock",
  SPGI:"S&P Global",ICE:"ICE",MCO:"Moody's",COF:"Capital One",
  CM:"CIBC",ALL:"Allstate",
  BKNG:"Booking",AMZN:"Amazon",TSLA:"Tesla",NKE:"Nike",MCD:"McDonald's",
  SBUX:"Starbucks",TJX:"TJX",LOW:"Lowe's",HD:"Home Depot",
  UBER:"Uber",CMG:"Chipotle",PDD:"PDD Holdings",DHI:"D.R. Horton",
  UNH:"UnitedHealth",JNJ:"J&J",LLY:"Eli Lilly",ABBV:"AbbVie",
  MRK:"Merck",PFE:"Pfizer",TMO:"Thermo Fisher",ABT:"Abbott",
  XOM:"ExxonMobil",CVX:"Chevron",COP:"ConocoPhillips",EOG:"EOG Resources",
  PXD:"Pioneer Natural",SLB:"SLB",PSX:"Phillips 66",VLO:"Valero",
  EQNR:"Equinor",SU:"Suncor Energy",FANG:"Diamondback Energy",
  WMT:"Walmart",PG:"P&G",KO:"Coca-Cola",PEP:"PepsiCo",
  COST:"Costco",MDLZ:"Mondelez",
  HON:"Honeywell",MMM:"3M",GE:"GE",LMT:"Lockheed Martin",RTX:"RTX",
  UNP:"Union Pacific",CSX:"CSX",DE:"Deere",EMR:"Emerson",ETN:"Eaton",
  CTAS:"Cintas",PCAR:"PACCAR",PH:"Parker Hannifin",
  AEM:"Agnico Eagle",WPM:"Wheaton Precious",
  XEON:"MM Euro",
};
const getCompany=(t:string)=>COMPANY[t.toUpperCase()]??"";

/* ─── Benchmark label (blended: US 60% / EU+UK 25% / JP 10% / CAN 5%) ────── */
const BENCH_LABEL="Benchmark (60% EUA / 25% EU · UK / 10% JP / 5% CAN)";
const BENCH_SHORT="Benchmark";

/* ─── Yahoo Finance ticker aliases (some ADRs use different symbols) ──────── */
const YF_ALIAS:Record<string,string>={
  BATS:"BTI",       // British American Tobacco ADR
  BAYRY:"BAYRY",    // Bayer ADR
  MARUY:"MARUY",    // Marubeni ADR
  SFTBY:"SFTBY",    // SoftBank ADR
  MRAAY:"MRAAY",    // Murata ADR
  IFNNY:"IFNNY",    // Infineon ADR
  MSBHF:"MSBHF",    // Mitsubishi ADR
  JXHLY:"JXHLY",    // ENEOS ADR
  SMFG:"SMFG",      // Sumitomo Mitsui ADR
  NMR:"NMR",        // Nomura ADR
  NVO:"NVO",        // Novo Nordisk ADR
};
const getYFTicker=(t:string)=>YF_ALIAS[t.toUpperCase()]??t;

type Page="dashboard"|"reco"|"carteira"|"perf"|"risco"|"historico"|"custos"|"ajuda"|"contactos"|"simulador"|"relatorios"|"ordens";
type RiskProfile="conservador"|"moderado"|"dinamico";
type FxExposure="protegida"|"parcial"|"aberta";
type KpiMode="base"|"margem";

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
/** Rescale daily returns by factor, recompute compounded curve */
function scaleEquityCurve(equity:number[], factor:number):number[] {
  if(!equity.length) return equity;
  if(factor===1)     return equity;
  const out=new Array(equity.length);
  out[0]=equity[0];
  for(let i=1;i<equity.length;i++){
    const r=equity[i]/equity[i-1]-1;
    out[i]=out[i-1]*(1+r*factor);
  }
  return out;
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
  {id:"dashboard",  label:"Dashboard",      Icon:LayoutDashboard},
  {id:"reco",       label:"Recomendações",  Icon:BookOpen},
  {id:"carteira",   label:"Carteira",       Icon:Briefcase},
  {id:"perf",       label:"Performance",    Icon:TrendingUp},
  {id:"risco",      label:"Risco",          Icon:ShieldCheck},
  {id:"historico",  label:"Histórico",      Icon:Clock},
  {id:"ordens",     label:"Enviar Ordens",   Icon:Send},
  {id:"relatorios", label:"Relatórios",     Icon:BookOpen},
  {id:"custos",     label:"Custos",         Icon:Receipt},
  {id:"ajuda",      label:"Ajuda",          Icon:HelpCircle},
  {id:"contactos",  label:"Contactos",      Icon:Mail},
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
            className="w-full flex items-center gap-3 px-3 py-2 text-slate-400 hover:text-slate-200 text-xs rounded-lg hover:bg-white/5 transition-colors">
            <LogOut size={14}/>Entrar / Criar conta
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

/* ─── auth modal (register + login tabs) ──────────────────── */
function RegisterModal({onClose,onSuccess,defaultTab="register"}:{onClose:()=>void;onSuccess:(user:string)=>void;defaultTab?:"register"|"login"}) {
  const [tab,setTab]=useState<"register"|"login">(defaultTab);

  /* register state */
  const [email,setEmail]=useState("");
  const [phone,setPhone]=useState("");
  const [phoneConfirm,setPhoneConfirm]=useState("");
  const [pw,setPw]=useState("");
  const [showPw,setShowPw]=useState(false);
  const [emailSent,setEmailSent]=useState(false);
  const [emailVerified,setEmailVerified]=useState(false);
  const [phoneSent,setPhoneSent]=useState(false);
  const [phoneOtp,setPhoneOtp]=useState("");
  const [phoneVerified,setPhoneVerified]=useState(false);
  const [otpProof,setOtpProof]=useState("");
  const [regErr,setRegErr]=useState("");
  const [regBusy,setRegBusy]=useState(false);

  /* login state */
  const [loginId,setLoginId]=useState("");
  const [loginPw,setLoginPw]=useState("");
  const [showLoginPw,setShowLoginPw]=useState(false);
  const [loginErr,setLoginErr]=useState("");
  const [loginBusy,setLoginBusy]=useState(false);

  const inp="w-full bg-[#111827] border border-[#252a3a] text-slate-200 text-sm rounded-lg px-3 py-2.5 outline-none focus:border-blue-500 transition-colors placeholder:text-slate-600";

  /* poll email verification every 3 s */
  useEffect(()=>{
    if(!emailSent||emailVerified) return;
    const id=setInterval(async()=>{
      const ok=await fetchSignupEmailVerifiedFromServer(email);
      if(ok){ setSignupEmailVerifiedFromServerEmail(email); setEmailVerified(true); }
    },3000);
    return ()=>clearInterval(id);
  },[emailSent,emailVerified,email]);

  async function sendEmailVerification(){
    setRegErr(""); setRegBusy(true);
    try{
      const r=await fetch("/api/client/email-verification/send",{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({email:email.trim(),signupOnly:true}),
      });
      const j=await r.json() as {ok:boolean;error?:string};
      if(!j.ok){setRegErr(j.error??"Erro ao enviar email.");}
      else{setEmailSent(true);}
    }catch{setRegErr("Erro de rede ao enviar email.");}
    setRegBusy(false);
  }

  async function sendPhoneSms(){
    setRegErr(""); setRegBusy(true);
    const norm=normalizeClientPhone(phone);
    if(!norm.ok){setRegErr(norm.error);setRegBusy(false);return;}
    try{
      const r=await fetch("/api/client/phone-verification/send",{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({phone:norm.e164}),
      });
      const j=await r.json() as {ok:boolean;error?:string;otpProof?:string;devOtp?:string};
      if(!j.ok){setRegErr(j.error??"Erro ao enviar SMS.");}
      else{
        setPhoneSent(true);
        if(j.otpProof) setOtpProof(j.otpProof);
        if(j.devOtp) setPhoneOtp(j.devOtp);
      }
    }catch{setRegErr("Erro de rede ao enviar SMS.");}
    setRegBusy(false);
  }

  async function verifyPhoneOtp(){
    setRegErr(""); setRegBusy(true);
    const norm=normalizeClientPhone(phone);
    if(!norm.ok){setRegErr(norm.error);setRegBusy(false);return;}
    try{
      const r=await fetch("/api/client/phone-verification/verify",{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({phone:norm.e164,code:phoneOtp,otpProof}),
      });
      const j=await r.json() as {ok:boolean;error?:string};
      if(!j.ok){setRegErr(j.error??"C\u00f3digo incorreto.");}
      else{setSignupPhoneVerifiedFromServerPhone(norm.e164);setPhoneVerified(true);}
    }catch{setRegErr("Erro de rede ao verificar c\u00f3digo.");}
    setRegBusy(false);
  }

  function submitRegister(e:React.FormEvent){
    e.preventDefault();
    setRegErr(""); setRegBusy(true);
    const emailTrim=email.trim();
    if(!emailVerified&&!isSignupEmailVerifiedForInput(emailTrim)){
      setRegErr("Confirme o email primeiro."); setRegBusy(false); return;
    }
    if(!phoneVerified&&!isSignupPhoneVerifiedForInput(phone)){
      setRegErr("Confirme o telom\u00f3vel primeiro."); setRegBusy(false); return;
    }
    const username=deriveClientUsernameFromEmail(emailTrim)||emailTrim.split("@")[0].replace(/[^a-z0-9_]/gi,"_").slice(0,24)||"user";
    const r=registerClientUser(username,pw,pw,emailTrim,phone,{requirePhoneSms:true});
    if(!r.ok){setRegErr(r.error??"Erro no registo.");setRegBusy(false);return;}
    const l=loginClientUser(username,pw);
    if(!l.ok){setRegErr("Conta criada, erro no login autom\u00e1tico.");setRegBusy(false);return;}
    setRegBusy(false); onSuccess(username);
  }

  function submitLogin(e:React.FormEvent){
    e.preventDefault();
    setLoginErr(""); setLoginBusy(true);
    const raw=loginId.trim();
    const username=raw.includes("@")?deriveClientUsernameFromEmail(raw)||raw.split("@")[0].replace(/[^a-z0-9_]/gi,"_").slice(0,24):raw;
    const l=loginClientUser(username,loginPw);
    if(!l.ok){setLoginErr(l.error??"Erro no login.");setLoginBusy(false);return;}
    setLoginBusy(false); onSuccess(username);
  }

  const bothVerified=(emailVerified||isSignupEmailVerifiedForInput(email))&&(phoneVerified||isSignupPhoneVerifiedForInput(phone));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={e=>{if(e.target===e.currentTarget)onClose();}}>
      <div className="bg-[#0b0f1a] border border-[#1a1f2e] rounded-2xl shadow-2xl w-full max-w-sm mx-4 p-6">

        <div className="flex items-center justify-between mb-5">
          <div className="flex gap-1 bg-[#111827] rounded-lg p-1">
            <button onClick={()=>setTab("register")}
              className={`px-4 py-1.5 rounded-md text-xs font-bold transition-colors ${tab==="register"?"bg-blue-600 text-white":"text-slate-400 hover:text-slate-200"}`}>
              Criar conta
            </button>
            <button onClick={()=>setTab("login")}
              className={`px-4 py-1.5 rounded-md text-xs font-bold transition-colors ${tab==="login"?"bg-blue-600 text-white":"text-slate-400 hover:text-slate-200"}`}>
              Entrar
            </button>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300 transition-colors ml-2"><X size={18}/></button>
        </div>

        {tab==="register"&&(
          <form onSubmit={submitRegister} className="space-y-3">
            <div>
              <label className="block text-xs text-slate-400 mb-1.5 font-semibold">Email</label>
              <div className="flex gap-2">
                <input type="email" value={email} onChange={e=>{setEmail(e.target.value);setEmailSent(false);setEmailVerified(false);}}
                  placeholder="o.teu@email.com" required disabled={emailVerified}
                  className={`${inp} flex-1 ${emailVerified?"border-emerald-600/50 text-slate-400":""}`}/>
                {emailVerified?(
                  <span className="flex items-center gap-1 text-emerald-400 text-xs font-bold px-2 shrink-0"><CheckCircle2 size={14}/>Ok</span>
                ):emailSent?(
                  <span className="text-blue-400 text-xs px-2 flex items-center shrink-0">A verificar…</span>
                ):(
                  <button type="button" onClick={sendEmailVerification} disabled={!email.includes("@")||regBusy}
                    className="shrink-0 px-3 py-2 bg-blue-600/20 hover:bg-blue-600/30 border border-blue-500/30 text-blue-400 text-xs font-semibold rounded-lg disabled:opacity-40 transition-colors">
                    Verificar
                  </button>
                )}
              </div>
              {emailSent&&!emailVerified&&<p className="text-slate-500 text-[10px] mt-1">Enviámos um link. Clique no email e volte aqui.</p>}
            </div>

            <div>
              <label className="block text-xs text-slate-400 mb-1.5 font-semibold">Telemóvel</label>
              <input type="tel" value={phone} onChange={e=>{setPhone(e.target.value);setPhoneSent(false);setPhoneVerified(false);setPhoneOtp("");}}
                placeholder="+351912345678" required disabled={phoneVerified}
                className={`${inp} ${phoneVerified?"border-emerald-600/50 text-slate-400":""}`}/>
            </div>

            <div>
              <label className="block text-xs text-slate-400 mb-1.5 font-semibold">Confirmar Telemóvel</label>
              <div className="flex gap-2">
                <input type="tel" value={phoneConfirm} onChange={e=>setPhoneConfirm(e.target.value)}
                  placeholder="+351912345678" required disabled={phoneVerified}
                  className={`${inp} flex-1 ${
                    phoneVerified?"border-emerald-600/50 text-slate-400":
                    phoneConfirm.length>0&&phone!==phoneConfirm?"border-red-500/60":"" }`}/>
                {phoneVerified?(
                  <span className="flex items-center gap-1 text-emerald-400 text-xs font-bold px-2 shrink-0"><CheckCircle2 size={14}/>Ok</span>
                ):(
                  <button type="button" onClick={sendPhoneSms}
                    disabled={phone.length<8||phone!==phoneConfirm||regBusy}
                    className="shrink-0 px-3 py-2 bg-blue-600/20 hover:bg-blue-600/30 border border-blue-500/30 text-blue-400 text-xs font-semibold rounded-lg disabled:opacity-40 transition-colors">
                    SMS
                  </button>
                )}
              </div>
              {phoneConfirm.length>0&&phone!==phoneConfirm&&(
                <p className="text-red-400 text-[10px] mt-1">Os números não coincidem.</p>
              )}
              {phoneSent&&!phoneVerified&&(
                <div className="mt-2">
                  <input value={phoneOtp} onChange={e=>setPhoneOtp(e.target.value.replace(/\D/g,"").slice(0,6))}
                    placeholder="Código de 6 dígitos" maxLength={6}
                    className={`${inp} tracking-[0.3em] text-center font-bold`}/>
                  <button type="button" onClick={verifyPhoneOtp} disabled={phoneOtp.length<4||regBusy}
                    className="mt-1.5 w-full py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold rounded-lg disabled:opacity-40 transition-colors">
                    Confirmar código
                  </button>
                </div>
              )}
            </div>

            <div>
              <label className="block text-xs text-slate-400 mb-1.5 font-semibold">Password</label>
              <div className="relative">
                <input type={showPw?"text":"password"} value={pw} onChange={e=>setPw(e.target.value)}
                  placeholder="Mínimo 10 caracteres" required minLength={10}
                  className={`${inp} pr-10`}/>
                <button type="button" onClick={()=>setShowPw(v=>!v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300">
                  {showPw?<EyeOff size={14}/>:<Eye size={14}/>}
                </button>
              </div>
            </div>

            {regErr&&<p className="text-red-400 text-xs bg-red-900/20 border border-red-800/40 rounded-lg px-3 py-2">{regErr}</p>}

            <button type="submit" disabled={regBusy||!bothVerified||pw.length<10}
              className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white font-bold text-sm py-3 rounded-xl transition-all shadow-lg shadow-emerald-900/30">
              {regBusy?"A criar conta…":"Criar conta →"}
            </button>

            {!bothVerified&&<p className="text-slate-600 text-[10px] text-center">Verifique o email e telomóvel para continuar.</p>}
            <p className="text-slate-600 text-[10px] text-center">Sem cartão. Ao criar conta aceita os <span className="underline cursor-pointer text-slate-500">Termos de Serviço</span>.</p>
          </form>
        )}

        {tab==="login"&&(
          <form onSubmit={submitLogin} className="space-y-3">
            <div>
              <label className="block text-xs text-slate-400 mb-1.5 font-semibold">Utilizador ou email</label>
              <input value={loginId} onChange={e=>setLoginId(e.target.value)} placeholder="username ou email" required
                className={inp} autoFocus/>
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1.5 font-semibold">Password</label>
              <div className="relative">
                <input type={showLoginPw?"text":"password"} value={loginPw} onChange={e=>setLoginPw(e.target.value)}
                  placeholder="A tua password" required className={`${inp} pr-10`}/>
                <button type="button" onClick={()=>setShowLoginPw(v=>!v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300">
                  {showLoginPw?<EyeOff size={14}/>:<Eye size={14}/>}
                </button>
              </div>
            </div>
            {loginErr&&<p className="text-red-400 text-xs bg-red-900/20 border border-red-800/40 rounded-lg px-3 py-2">{loginErr}</p>}
            <button type="submit" disabled={loginBusy}
              className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-white font-bold text-sm py-3 rounded-xl transition-colors">
              {loginBusy?"A entrar…":"Entrar →"}
            </button>
          </form>
        )}
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
    <div style={{background:"#0f1420",border:"1px solid #2d3748",borderRadius:8,padding:"8px 12px",fontSize:11,boxShadow:"0 4px 20px rgba(0,0,0,0.7)"}}>
      <div style={{color:"#94a3b8",marginBottom:4,fontWeight:600}}>{label}</div>
      {payload.map((p:any)=>{
        const v=Number(p.value);
        const display = v>=50
          ? `${v>=100?"+":""}${((v/100-1)*100).toFixed(1)}%`
          : `${v.toFixed(1)}%`;
        return (
          <div key={p.dataKey} style={{display:"flex",alignItems:"center",gap:6,marginTop:2}}>
            <div style={{width:8,height:8,borderRadius:"50%",background:p.color,flexShrink:0}}/>
            <span style={{color:"#94a3b8"}}>{p.name}:</span>
            <span style={{color:"#f1f5f9",fontWeight:700}}>{display}</span>
          </div>
        );
      })}
    </div>
  );
}

/* â”€â”€â”€ main â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

/* ─── CustosPage sub-component ─────────────────────────────── */
// DECIDE fee structure
// Premium: AUM €5k–€50k  → €25/mês fixo (sem performance fee)
// Private: AUM >€50k     → 0,6% aa gestão + 15% performance fee acima HWM
const DECIDE_MONTHLY_PREMIUM=25;          // €/mês
const DECIDE_MGMT_PCT_PRIVATE=0.60;       // % aa
const DECIDE_PERF_PCT_PRIVATE=15;         // % sobre ganhos acima HWM
const MARKET_AVG_PCT=0.62;
const ACTIVE_FUND_PCT=2.0;

// Outros custos operacionais (comuns a todos os segmentos)
const BASE_COST_ROWS=[
  {cat:"Custódia",   color:"#22c55e",desc:"Interactive Brokers",  modelo:"Tiered",         pct:0.06},
  {cat:"Transações", color:"#f59e0b",desc:"Comissões negociação", modelo:"Por operação",   pct:0.04},
  {cat:"Câmbio",     color:"#a78bfa",desc:"Conversão de moeda",   modelo:"Spread cambial", pct:0.01},
  {cat:"Outros",     color:"#64748b",desc:"Taxas regulatórias",   modelo:"Fixas",          pct:0.01},
];




function CustosPage({aum}:{aum:number}) {
  const [costPeriod,setCostPeriod]=useState<"ytd"|"1a"|"3a"|"5a"|"all">("ytd");
  const [faqOpen,setFaqOpen]=useState<number|null>(null);

  const aumEur=Math.max(aum,5000);
  const ytdMonths=new Date().getMonth()+1;
  const isPrivate=aumEur>=50000;

  // ── Fee constants ──────────────────────────────────────────────
  const MGMT_PCT_AA   = 0.60;   // Private: 0,6% aa = 0,05%/mês
  const MGMT_MONTHLY  = 0.0005; // 0,05%/mês
  const PERF_RATE     = 0.15;   // 15% sobre ganhos acima HWM
  const HIST_CAGR     = 0.25;   // retorno histórico estimado
  const MARKET_ETF    = 0.62;   // média ETFs passivos
  const ACTIVE_FUND   = 2.00;   // fundos activos tradicionais

  // ── Management fee ─────────────────────────────────────────────
  const mgmtAnnual = isPrivate ? aumEur*(MGMT_PCT_AA/100) : 25*12;
  const mgmtPct    = mgmtAnnual/aumEur*100;
  const mgmtYtd    = isPrivate ? aumEur*MGMT_MONTHLY*ytdMonths : 25*ytdMonths;

  // ── Performance fee (Private, annual, estimated) ────────────────
  const perfAnnual = isPrivate ? aumEur*HIST_CAGR*PERF_RATE : 0;
  const perfYtd    = perfAnnual*ytdMonths/12;
  const perfMonthly= perfAnnual/12;

  // ── Fixed operational rows ──────────────────────────────────────
  const FIXED_ROWS=[
    {cat:"Custódia",   desc:"Custódia e clearing",        modelo:"Valor fixo",      pct:0.06,color:"#22c55e"},
    {cat:"Transações", desc:"Comissões de negociação",    modelo:"Por operação",    pct:0.04,color:"#f59e0b"},
    {cat:"Câmbio",     desc:"Conversão de moeda",         modelo:"Spread cambial",  pct:0.01,color:"#a78bfa"},
    {cat:"Outros",     desc:"Taxas regulatórias",         modelo:"Fixas",           pct:0.01,color:"#64748b"},
  ];
  const fixedPct=FIXED_ROWS.reduce((s,r)=>s+r.pct,0); // 0.12%
  const fixedYtd=aumEur*(fixedPct/100)*ytdMonths/12;

  const totalFixedPct=mgmtPct+fixedPct;
  const totalFixedYtd=mgmtYtd+fixedYtd;
  const totalYtd=totalFixedYtd+perfYtd;

  // ── All rows for donut ──────────────────────────────────────────
  const allRows=[
    {cat:"Gestão DECIDE", desc:"Serviço de gestão",            modelo:isPrivate?"% do AUM":"Mensalidade fixa",
     pct:mgmtPct,   color:"#3b82f6", ytd:mgmtYtd,   txa:MGMT_PCT_AA.toFixed(2)+"%"},
    ...(isPrivate?[{cat:"Performance fee",desc:"15% sobre ganhos acima HWM",modelo:"Variável",
     pct:null as number|null, color:"#60a5fa", ytd:perfYtd, txa:"—"}]:[]),
    ...FIXED_ROWS.map(r=>({...r, ytd:aumEur*(r.pct/100)*ytdMonths/12, txa:r.pct.toFixed(2)+"%"})),
  ];

  // ── Savings vs active funds ─────────────────────────────────────
  const savingsPpFix=(ACTIVE_FUND-totalFixedPct);
  const savingsPerYearFix=aumEur*(savingsPpFix/100);

  // ── Long-term projection (€50k example) ────────────────────────
  const EX_CAP=50000; const GROSS=0.08; const YRS=10;
  const dNet=GROSS-totalFixedPct/100; const aNet=GROSS-ACTIVE_FUND/100;
  const dVal=Math.round(EX_CAP*Math.pow(1+dNet,YRS));
  const mVal=Math.round(EX_CAP*Math.pow(1+aNet,YRS));
  const diff=dVal-mVal;

  const fmt=(n:number)=>n.toLocaleString("pt-PT",{minimumFractionDigits:2,maximumFractionDigits:2});
  const fmtInt=(n:number)=>Math.round(n).toLocaleString("pt-PT");

  const growthChart=useMemo(()=>Array.from({length:YRS+1},(_,i)=>({
    year:i===0?"Hoje":`Ano ${i}`,
    decide:Math.round(EX_CAP*Math.pow(1+dNet,i)),
    market:Math.round(EX_CAP*Math.pow(1+aNet,i)),
  })),[dNet,aNet]);

  const costChart=useMemo(()=>{
    const now=new Date();
    return Array.from({length:12},(_,i)=>{
      const d=new Date(now.getFullYear(),now.getMonth()-11+i,1);
      const lbl=d.toLocaleDateString("pt-PT",{month:"short",year:"2-digit"}).replace(".","");
      const n=Math.sin(i*1.3)*0.008;
      return {label:lbl,model:+(totalFixedPct+n).toFixed(3),market:+(MARKET_ETF+n*0.3).toFixed(3)};
    });
  },[totalFixedPct]);

  const FAQS=[
    {q:"O que está incluído na comissão de gestão?",
     a:"A comissão de gestão cobre o serviço DECIDE: recomendações mensais, monitorização da carteira, dashboard completo e suporte. Não inclui custódia, transações ou câmbio."},
    {q:"Como funciona a performance fee?",
     a:"A performance fee é de 15% sobre os ganhos acima do high watermark, cobrada anualmente. Só é paga quando a carteira supera o máximo histórico anterior — alinhando os nossos interesses com os seus."},
    {q:"O que é o high watermark?",
     a:"O high watermark é o valor máximo histórico da sua carteira. A performance fee só se aplica a ganhos acima desse nível. Se a carteira descer e depois recuperar, só pagará quando superar o máximo anterior."},
    {q:"Existem custos adicionais?",
     a:"Além da comissão de gestão, existem custos operacionais: custódia (0,06%), transações (0,04%), câmbio (0,01%) e outros (0,01%). Todos detalhados nesta página."},
    {q:"Posso cancelar o meu plano quando quiser?",
     a:"Sim. O plano Premium (€25/mês) pode ser cancelado a qualquer momento sem penalização. O plano Private está sujeito a aviso prévio de 30 dias."},
  ];

  return (
    <div className="space-y-4 pb-8">

      {/* ── KPI row ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-4 gap-4">
        {/* 1 – Custo total fixo aa */}
        <div className="bg-[#0b0f1a] border border-[#1a1f2e] rounded-xl p-4">
          <div className="flex items-center gap-1 text-[9px] text-slate-500 font-semibold uppercase tracking-wide mb-3">
            CUSTO TOTAL (AA)<Info size={9} className="opacity-40"/>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-3xl font-bold text-slate-100">{totalFixedPct.toFixed(2)}%</div>
            <div className="w-10 h-10 rounded-full border-[3px] border-blue-500 flex items-center justify-center">
              <div className="text-[8px] font-bold text-blue-400 text-center leading-none">{totalFixedPct.toFixed(2)}%</div>
            </div>
          </div>
          <div className="text-[10px] text-slate-500 mt-1">Sobre o valor médio da carteira</div>
          <div className="text-[10px] text-slate-400 mt-2">= € {fmt(aumEur*totalFixedPct/100)} / ano</div>
        </div>
        {/* 2 – Custo YTD */}
        <div className="bg-[#0b0f1a] border border-[#1a1f2e] rounded-xl p-4">
          <div className="flex items-center gap-1 text-[9px] text-slate-500 font-semibold uppercase tracking-wide mb-3">
            CUSTO EM EUROS (YTD)<Info size={9} className="opacity-40"/>
          </div>
          <div className="text-3xl font-bold text-slate-100 mb-1">€ {fmt(totalYtd)}</div>
          <div className="text-[10px] text-slate-500">Total de custos pagos</div>
          <div className="text-[10px] text-slate-400 mt-2">{ytdMonths} meses do ano corrente</div>
        </div>
        {/* 3 – Performance fee / mensalidade */}
        <div className="bg-[#0b0f1a] border border-[#1a1f2e] rounded-xl p-4">
          <div className="flex items-center gap-1 text-[9px] text-slate-500 font-semibold uppercase tracking-wide mb-3">
            {isPrivate?"PERFORMANCE FEE (ESTIMATIVA)":"CUSTO MENSAL FIXO"}<Info size={9} className="opacity-40"/>
          </div>
          {isPrivate?(
            <>
              <div className="text-3xl font-bold text-slate-100 mb-1">15%</div>
              <div className="text-[10px] text-slate-500">Sobre ganhos acima do high watermark</div>
              <div className="text-[10px] text-amber-400 mt-2">+€ {fmt(perfMonthly)}/mês ao ritmo histórico</div>
            </>
          ):(
            <>
              <div className="text-3xl font-bold text-slate-100 mb-1">€ 25,00</div>
              <div className="text-[10px] text-slate-500">Mensalidade fixa DECIDE Premium</div>
              <div className="text-[10px] text-blue-400 mt-2">= {mgmtPct.toFixed(2)}% aa ao nível actual do AUM</div>
            </>
          )}
        </div>
        {/* 4 – Poupança vs fundos activos */}
        <div className="bg-[#0b0f1a] border border-[#1a1f2e] rounded-xl p-4">
          <div className="flex items-center gap-1 text-[9px] text-slate-500 font-semibold uppercase tracking-wide mb-3">
            POUPANÇA VS FUNDOS ATIVOS<Info size={9} className="opacity-40"/>
          </div>
          <div className="text-3xl font-bold text-emerald-400 mb-1">€ {fmtInt(diff)}</div>
          <div className="text-[10px] text-slate-500">Em seu benefício estimado em {YRS} anos</div>
          <div className="text-[10px] text-emerald-400 mt-2">+{savingsPpFix.toFixed(2)}pp menos custos fixos/ano</div>
        </div>
      </div>

      {/* ── Middle row ──────────────────────────────────────────── */}
      <div className="grid grid-cols-3 gap-4">

        {/* Estrutura de custos */}
        <div className="bg-[#0b0f1a] border border-[#1a1f2e] rounded-xl p-5">
          <div className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
            ESTRUTURA DE CUSTOS (YTD)<Info size={11} className="text-slate-600"/>
          </div>
          <div className="flex items-center gap-4 mb-4">
            <div className="relative shrink-0">
              <ResponsiveContainer width={110} height={110}>
                <PieChart>
                  <Pie data={allRows.map(r=>({name:r.cat,value:Math.max(r.pct??0.03,0.03)}))}
                    cx="50%" cy="50%" innerRadius={34} outerRadius={52} dataKey="value" strokeWidth={0} paddingAngle={2}>
                    {allRows.map((r,i)=><Cell key={i} fill={r.color}/>)}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                <div className="text-sm font-bold text-slate-100">{totalFixedPct.toFixed(2)}%</div>
                <div className="text-[8px] text-slate-500">Total</div>
              </div>
            </div>
            <div className="space-y-2 flex-1 min-w-0">
              {allRows.map(r=>(
                <div key={r.cat} className="flex items-center justify-between gap-1">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="w-2 h-2 rounded-full shrink-0" style={{background:r.color}}/>
                    <span className="text-[10px] text-slate-400 truncate">{r.cat}</span>
                  </div>
                  <span className="text-[10px] font-bold text-slate-200 shrink-0">
                    {r.pct==null?"variável":(r.pct.toFixed(2)+"%")}
                  </span>
                </div>
              ))}
            </div>
          </div>
          <div className="bg-blue-500/[0.07] border border-blue-500/20 rounded-lg p-3 flex gap-2">
            <Info size={11} className="text-blue-400 shrink-0 mt-0.5"/>
            <div className="text-[9px] text-slate-400 leading-relaxed">
              {isPrivate
                ?"A gestão é 0,6% ao ano e a performance fee é 15% apenas sobre ganhos acima do high watermark anual. Sem dupla cobrança."
                :"Mensalidade fixa de €25/mês. Sem comissão de performance. Sem custos escondidos."}
            </div>
          </div>
        </div>

        {/* Comparação com mercado */}
        <div className="bg-[#0b0f1a] border border-[#1a1f2e] rounded-xl p-5">
          <div className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
            COMPARAÇÃO COM MERCADO<Info size={11} className="text-slate-600"/>
          </div>
          <div className="grid grid-cols-3 gap-2 mb-4">
            {[
              {label:"DECIDE (fixo)",    val:totalFixedPct, color:"text-blue-400"},
              {label:"ETFs passivos",    val:MARKET_ETF,    color:"text-slate-400"},
              {label:"Fundos ativos",    val:ACTIVE_FUND,   color:"text-red-400"},
            ].map(c=>(
              <div key={c.label} className="text-center bg-[#080c14] rounded-lg p-2 border border-[#1a1f2e]">
                <div className="text-[8px] text-slate-500 mb-1 leading-tight">{c.label}</div>
                <div className={`text-base font-bold ${c.color}`}>{c.val.toFixed(2)}%</div>
              </div>
            ))}
          </div>
          {[
            {label:"DECIDE (custos fixos)", val:totalFixedPct, color:"#3b82f6", max:2.2},
            {label:"ETFs passivos",          val:MARKET_ETF,    color:"#475569", max:2.2},
            {label:"Fundos ativos",          val:ACTIVE_FUND,   color:"#ef4444", max:2.2},
          ].map(b=>(
            <div key={b.label} className="mb-2.5">
              <div className="flex justify-between text-[9px] text-slate-500 mb-1">
                <span>{b.label}</span>
                <span className="text-slate-300 font-bold">{b.val.toFixed(2)}%</span>
              </div>
              <div className="h-4 bg-[#0f1420] rounded-md overflow-hidden">
                <div className="h-full rounded-md" style={{width:`${(b.val/b.max)*100}%`,background:b.color}}/>
              </div>
            </div>
          ))}
          <div className="mt-3 flex items-center gap-2 bg-emerald-500/[0.08] border border-emerald-500/20 rounded-lg px-3 py-2">
            <CheckCircle2 size={12} className="text-emerald-400 shrink-0"/>
            <div className="text-[10px] text-emerald-300 font-semibold">
              {Math.round((ACTIVE_FUND-totalFixedPct)/ACTIVE_FUND*100)}% menos custos fixos que fundos ativos.
            </div>
          </div>
          {isPrivate&&(
            <div className="mt-2 flex items-start gap-2 bg-amber-500/[0.06] border border-amber-500/20 rounded-lg px-3 py-2">
              <Info size={11} className="text-amber-400 shrink-0 mt-0.5"/>
              <div className="text-[9px] text-amber-300">A performance fee alinha os interesses: só pagamos quando ganha acima do high watermark.</div>
            </div>
          )}
        </div>

        {/* Impacto a longo prazo */}
        <div className="bg-[#0b0f1a] border border-[#1a1f2e] rounded-xl p-5">
          <div className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-1 flex items-center gap-2">
            IMPACTO A LONGO PRAZO<Info size={11} className="text-slate-600"/>
          </div>
          <div className="text-[9px] text-slate-500 mb-4">Exemplo: €50.000 iniciais · {(GROSS*100).toFixed(0)}% retorno bruto · {YRS} anos</div>
          <div className="bg-[#080c14] rounded-lg p-3 border border-emerald-500/20 mb-2">
            <div className="text-[9px] text-slate-500 mb-1">Com DECIDE</div>
            <div className="text-lg font-bold text-emerald-400">€ {fmtInt(dVal)}</div>
            <div className="text-[9px] text-slate-500 mt-0.5">retorno líquido: {(dNet*100).toFixed(2)}% aa</div>
          </div>
          <div className="bg-[#080c14] rounded-lg p-3 border border-[#1a1f2e] mb-3">
            <div className="text-[9px] text-slate-500 mb-1">Com fundos ativos (2%)</div>
            <div className="text-lg font-bold text-slate-400">€ {fmtInt(mVal)}</div>
            <div className="text-[9px] text-slate-500 mt-0.5">retorno líquido: {(aNet*100).toFixed(2)}% aa</div>
          </div>
          <div className="flex items-center justify-between bg-emerald-500/[0.08] border border-emerald-500/20 rounded-lg px-3 py-2 mb-3">
            <span className="text-[9px] text-slate-400">A diferença é de</span>
            <span className="text-emerald-400 font-bold text-sm">€ {fmtInt(diff)}<span className="text-[9px] text-emerald-600 ml-1">a seu favor</span></span>
          </div>
          <ResponsiveContainer width="100%" height={60}>
            <AreaChart data={growthChart} margin={{top:2,right:4,left:0,bottom:0}}>
              <defs>
                <linearGradient id="gD3" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#22c55e" stopOpacity={0.3}/><stop offset="95%" stopColor="#22c55e" stopOpacity={0}/></linearGradient>
                <linearGradient id="gA3" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#475569" stopOpacity={0.2}/><stop offset="95%" stopColor="#475569" stopOpacity={0}/></linearGradient>
              </defs>
              <Area type="monotone" dataKey="decide" stroke="#22c55e" strokeWidth={1.5} fill="url(#gD3)" dot={false}/>
              <Area type="monotone" dataKey="market" stroke="#475569" strokeWidth={1} fill="url(#gA3)" dot={false}/>
            </AreaChart>
          </ResponsiveContainer>
          <div className="flex gap-4 mt-1 text-[8px]">
            <span className="flex items-center gap-1"><span className="w-3 h-px bg-emerald-400 inline-block"/><span className="text-slate-500">Com DECIDE</span></span>
            <span className="flex items-center gap-1"><span className="w-3 h-px bg-slate-500 inline-block"/><span className="text-slate-500">Fundos ativos (2%)</span></span>
          </div>
        </div>
      </div>

      {/* ── Detail table + Evolution chart ──────────────────────── */}
      <div className="grid grid-cols-2 gap-4">

        {/* Detail table */}
        <div className="bg-[#0b0f1a] border border-[#1a1f2e] rounded-xl p-5">
          <div className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
            DETALHE DOS CUSTOS (YTD)<Info size={11} className="text-slate-600"/>
          </div>
          <table className="w-full">
            <thead>
              <tr className="border-b border-[#1a1f2e]">
                {["Categoria","Descrição","Modelo de cobrança","Taxa anual","YTD (€)","% do total"].map(h=>(
                  <th key={h} className="pb-2 text-[8px] font-semibold text-slate-600 uppercase tracking-wide text-left whitespace-nowrap pr-2">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#0a0d15]">
              {allRows.map(r=>{
                const ytdAmt=r.cat==="Gestão DECIDE"&&!isPrivate ? 25*ytdMonths : r.ytd;
                const sharePct=totalYtd>0 ? ytdAmt/totalYtd*100 : 0;
                return (
                  <tr key={r.cat} className="hover:bg-white/[0.02]">
                    <td className="py-2 pr-2">
                      <div className="flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full shrink-0" style={{background:r.color}}/>
                        <span className="text-[10px] text-slate-300 font-medium whitespace-nowrap">{r.cat}</span>
                      </div>
                    </td>
                    <td className="py-2 pr-2 text-[9px] text-slate-500 whitespace-nowrap">{r.desc}</td>
                    <td className="py-2 pr-2 text-[9px] text-slate-500 whitespace-nowrap">{r.modelo}</td>
                    <td className="py-2 pr-2 text-right font-mono text-[10px] text-slate-300 whitespace-nowrap">{r.txa}</td>
                    <td className="py-2 pr-2 text-right font-mono text-[10px] text-slate-300 whitespace-nowrap">
                      {r.cat==="Performance fee"?"*":"€ "+fmt(ytdAmt)}
                    </td>
                    <td className="py-2 text-right font-mono text-[10px] text-slate-400 whitespace-nowrap">
                      {r.cat==="Performance fee"?"16,8%*":sharePct.toFixed(1)+"%"}
                    </td>
                  </tr>
                );
              })}
              <tr className="border-t-2 border-[#1a1f2e]">
                <td className="pt-2 text-[10px] font-bold text-slate-200" colSpan={3}>TOTAL</td>
                <td className="pt-2 text-right font-mono text-[10px] font-bold text-slate-200">—</td>
                <td className="pt-2 text-right font-mono text-[10px] font-bold text-slate-200">{totalFixedPct.toFixed(2)}%</td>
                <td className="pt-2 text-right font-mono text-[10px] font-bold text-slate-200">€ {fmt(totalFixedYtd)}</td>
              </tr>
            </tbody>
          </table>
          {isPrivate&&<div className="mt-2 text-[9px] text-amber-500">* Performance fee calculada anualmente sobre ganhos acima do high watermark anual.</div>}
          <div className="mt-1 text-[9px] text-slate-600">Nota: custos calculados sobre o valor médio da carteira no período.</div>
        </div>

        {/* Evolution chart */}
        <div className="bg-[#0b0f1a] border border-[#1a1f2e] rounded-xl p-5">
          <div className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-3 flex items-center gap-2">
            EVOLUÇÃO DO CUSTO TOTAL (%)<Info size={11} className="text-slate-600"/>
          </div>
          <div className="flex gap-1 mb-4 flex-wrap">
            {([["ytd","YTD"],["1a","1 Ano"],["3a","3 Anos"],["5a","5 Anos"],["all","Desde início"]] as [string,string][]).map(([k,l])=>(
              <button key={k} onClick={()=>setCostPeriod(k as typeof costPeriod)} className={`px-2.5 py-1 text-[10px] font-semibold rounded transition-colors ${costPeriod===k?"bg-blue-600 text-white":"text-slate-500 hover:text-slate-300"}`}>{l}</button>
            ))}
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={costChart} margin={{top:4,right:12,left:0,bottom:0}}>
              <CartesianGrid stroke="#1a1f2e" strokeDasharray="3 3"/>
              <XAxis dataKey="label" tick={{fontSize:8,fill:"#64748b"}} tickLine={false} axisLine={false} interval={1}/>
              <YAxis tick={{fontSize:8,fill:"#64748b"}} tickLine={false} axisLine={false} tickFormatter={v=>`${Number(v).toFixed(2)}%`} domain={["dataMin-0.1","dataMax+0.2"]} width={42}/>
              <Tooltip
                formatter={(v:number,name:string)=>[`${Number(v).toFixed(2)}%`,name==="model"?"O seu custo total":"Média de mercado (ETFs + Fundos ativos)"]}
                contentStyle={{background:"#0f172a",border:"1px solid #1e3a5f",borderRadius:8,fontSize:10,color:"#e2e8f0"}}
                labelStyle={{color:"#94a3b8"}} itemStyle={{fontWeight:600}}/>
              <Line type="monotone" dataKey="model" name="model" stroke="#3b82f6" strokeWidth={2} dot={false}/>
              <Line type="monotone" dataKey="market" name="market" stroke="#64748b" strokeWidth={1.5} strokeDasharray="5 3" dot={false}/>
            </LineChart>
          </ResponsiveContainer>
          <div className="flex gap-5 mt-2 text-[9px]">
            <span className="flex items-center gap-1.5"><span className="w-5 h-0.5 bg-blue-500 inline-block"/><span className="text-slate-400">O seu custo total</span></span>
            <span className="flex items-center gap-1.5"><span className="w-5 h-0.5 bg-slate-500 inline-block"/><span className="text-slate-400">Média de mercado (ETFs + Fundos ativos)</span></span>
          </div>
        </div>
      </div>

      {/* ── OS NOSSOS PLANOS + FAQ ───────────────────────────────── */}
      <div className="grid grid-cols-3 gap-4">

        {/* Planos (2/3 width) */}
        <div className="col-span-2 bg-[#0b0f1a] border border-[#1a1f2e] rounded-xl p-6">
          <div className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-1">OS NOSSOS PLANOS</div>
          <div className="text-[10px] text-slate-600 mb-5">Escolha o plano ideal para o seu nível de investimento.</div>
          <div className="grid grid-cols-2 gap-4">
            {/* Premium */}
            <div className={`rounded-xl p-5 border-2 ${!isPrivate?"border-blue-500 bg-blue-500/[0.06]":"border-[#1a1f2e] bg-[#080c14]"}`}>
              <div className="flex items-center gap-2 mb-1">
                <div className="text-xl">🚀</div>
                <div>
                  <div className="font-bold text-slate-100 text-sm">PREMIUM</div>
                  <div className="text-[9px] text-slate-500">Para investimentos até €50.000</div>
                </div>
              </div>
              <div className="mt-4 mb-4">
                <span className="text-3xl font-bold text-slate-100">€25</span>
                <span className="text-slate-400 text-sm"> / mês</span>
              </div>
              <div className="space-y-2 mb-5">
                {["Recomendações mensais","Carteira otimizada","Dashboard completo","Suporte por email"].map(f=>(
                  <div key={f} className="flex items-center gap-2 text-[11px] text-slate-300">
                    <CheckCircle2 size={12} className="text-blue-400 shrink-0"/>{f}
                  </div>
                ))}
              </div>
              <button className={`w-full py-2 rounded-lg text-[11px] font-bold transition-colors ${!isPrivate?"bg-blue-600 hover:bg-blue-700 text-white":"bg-[#1a1f2e] text-slate-500 cursor-default"}`}>
                {!isPrivate?"O seu plano actual":"Plano anterior"}
              </button>
            </div>
            {/* Private */}
            <div className={`rounded-xl p-5 border-2 ${isPrivate?"border-amber-500 bg-amber-500/[0.06]":"border-[#1a1f2e] bg-[#080c14]"}`}>
              <div className="flex items-center gap-2 mb-1">
                <div className="text-xl">👑</div>
                <div>
                  <div className="font-bold text-amber-400 text-sm">PRIVATE</div>
                  <div className="text-[9px] text-slate-500">Para investimentos acima de €50.000</div>
                </div>
              </div>
              <div className="mt-4 mb-1">
                <span className="text-3xl font-bold text-slate-100">0,6%</span>
                <span className="text-slate-400 text-sm"> / ano</span>
              </div>
              <div className="text-[10px] text-amber-400 mb-4">+ 15% performance fee</div>
              <div className="space-y-2 mb-5">
                {["Tudo do plano Premium","Gestão personalizada","Performance fee apenas sobre ganhos acima do high watermark","Relatórios avançados","Suporte prioritário"].map(f=>(
                  <div key={f} className="flex items-center gap-2 text-[11px] text-slate-300">
                    <CheckCircle2 size={12} className="text-amber-400 shrink-0"/>{f}
                  </div>
                ))}
              </div>
              <button className={`w-full py-2 rounded-lg text-[11px] font-bold transition-colors ${isPrivate?"bg-amber-600 hover:bg-amber-700 text-white":"bg-[#1a1f2e] text-slate-400 hover:bg-[#242936] hover:text-slate-200"}`}>
                {isPrivate?"O seu plano actual":"Fale connosco"}
              </button>
            </div>
          </div>
          {/* Transparency bar */}
          <div className="mt-5 flex items-center justify-between bg-blue-500/[0.05] border border-blue-500/15 rounded-lg px-4 py-3">
            <div className="flex items-start gap-2">
              <Info size={12} className="text-blue-400 shrink-0 mt-0.5"/>
              <div className="text-[9px] text-slate-400 leading-relaxed">
                Transparência total: não cobramos comissões escondidas.<br/>
                Todos os custos são apresentados de forma clara e detalhada.
              </div>
            </div>
            <button className="text-[9px] text-blue-400 hover:text-blue-300 whitespace-nowrap ml-4">Saber mais sobre os planos →</button>
          </div>
        </div>

        {/* FAQ (1/3 width) */}
        <div className="bg-[#0b0f1a] border border-[#1a1f2e] rounded-xl p-5">
          <div className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-4">PERGUNTAS FREQUENTES</div>
          <div className="space-y-1">
            {FAQS.map((f,i)=>(
              <div key={i} className="border-b border-[#1a1f2e] last:border-0">
                <button className="w-full flex items-center justify-between py-3 text-left gap-2"
                  onClick={()=>setFaqOpen(faqOpen===i?null:i)}>
                  <span className="text-[11px] text-slate-300 font-medium leading-snug">{f.q}</span>
                  <ChevronDown size={14} className={`text-slate-500 shrink-0 transition-transform ${faqOpen===i?"rotate-180":""}`}/>
                </button>
                {faqOpen===i&&(
                  <div className="pb-3 text-[10px] text-slate-500 leading-relaxed">{f.a}</div>
                )}
              </div>
            ))}
          </div>
          {/* Precisa de ajuda? */}
          <div className="mt-4 pt-4 border-t border-[#1a1f2e]">
            <div className="text-[10px] font-bold text-slate-300 mb-3">PRECISA DE AJUDA?</div>
            <div className="text-[9px] text-slate-500 mb-3">Fale com a nossa equipa.</div>
            <div className="grid grid-cols-2 gap-2">
              <a href="mailto:geral@decide.pt" className="flex items-center gap-2 bg-[#080c14] border border-[#1a1f2e] rounded-lg px-3 py-2 hover:border-blue-500/40 transition-colors">
                <Mail size={12} className="text-blue-400 shrink-0"/>
                <div>
                  <div className="text-[8px] text-slate-500">Email</div>
                  <div className="text-[9px] text-slate-300 font-medium">geral@decide.pt</div>
                </div>
              </a>
              <a href="tel:+351210123456" className="flex items-center gap-2 bg-[#080c14] border border-[#1a1f2e] rounded-lg px-3 py-2 hover:border-blue-500/40 transition-colors">
                <Phone size={12} className="text-blue-400 shrink-0"/>
                <div>
                  <div className="text-[8px] text-slate-500">Telefone</div>
                  <div className="text-[9px] text-slate-300 font-medium">+351 210 123 456</div>
                </div>
              </a>
            </div>
          </div>
        </div>
      </div>

      {/* ── Footer / legal ────────────────────────────────────────── */}
      <div className="flex items-center justify-between bg-[#080c14] border border-[#1a1f2e] rounded-xl px-5 py-3">
        <div className="flex items-start gap-2">
          <ShieldCheck size={13} className="text-slate-500 shrink-0 mt-0.5"/>
          <div className="text-[9px] text-slate-500 leading-relaxed">
            O DECIDE está registado na CMVM como intermediário financeiro. A sua confiança é a nossa prioridade.
          </div>
        </div>
        <button className="text-[9px] text-blue-500 hover:text-blue-400 whitespace-nowrap ml-4">Ver documentação legal →</button>
      </div>
    </div>
  );
}


/* ─── AjudaPage sub-component ──────────────────────────────── */
const FAQ_CATS=[
  {cat:"Plataforma",faqs:[
    {q:"O que é o DECIDE?",a:"O DECIDE é uma plataforma portuguesa de gestão de carteira de investimentos. Usa modelos quantitativos de momentum e qualidade para gerar recomendações mensais de compra, venda e reforço de posições em acções globais."},
    {q:"Como funciona o modelo quantitativo?",a:"O modelo analisa mensalmente um universo de centenas de acções globais usando factores de momentum de preço, qualidade financeira e tendência macro. Os activos são pontuados e os 20 melhores formam a carteira."},
    {q:"O que é o mecanismo CAP15?",a:"CAP15 é o sistema de controlo de risco que limita a volatilidade da carteira ao nível Moderado (12–20% aa). Quando o mercado está volátil, o modelo reduz a exposição automaticamente, protegendo o capital."},
    {q:"Quantas posições tem a carteira?",a:"A carteira tem ~20 posições de acções globais, complementadas por XEON (fundo de liquidez em euros) e uma posição de hedge cambial EUR/USD proporcional à exposição em dólares."},
    {q:"Com que frequência são geradas recomendações?",a:"Mensalmente. No início de cada mês o modelo reavalia todo o universo e gera uma nova lista de recomendações: Comprar, Reforçar, Vender, Reduzir e Manter."},
    {q:"Como aprovar as recomendações?",a:"Na página Recomendações, revê a lista e clica em 'Aprovar Plano'. O sistema gera as ordens e envia para a tua corretora (Interactive Brokers). Sempre com aprovação prévia do utilizador."},
  ]},
  {cat:"Performance e métricas",faqs:[
    {q:"O que é o CAGR histórico de 25%?",a:"CAGR (Compound Annual Growth Rate) é a taxa de crescimento anual composta ao longo de 20 anos de backtest (desde 2006). Com 25% ao ano, €10.000 iniciais tornam-se em mais de €700.000."},
    {q:"O que é o Sharpe Ratio?",a:"O Sharpe Ratio mede o retorno ajustado ao risco: retorno em excesso dividido pela volatilidade. Um Sharpe de 1.3 (como o do DECIDE) é considerado muito bom — significa que cada unidade de risco gera 1.3 unidades de retorno."},
    {q:"O que é o Max Drawdown?",a:"Max Drawdown (MDD) é a maior queda percentual do pico ao vale ao longo do histórico. O DECIDE teve um MDD de aproximadamente -35%, ocorrido durante a crise de 2008."},
    {q:"Como se calcula o VaR 95%?",a:"Value at Risk a 95% indica a perda máxima esperada num dia normal de mercado com 95% de confiança. Por exemplo, VaR 95% de -1.5% significa que em 95% dos dias a perda diária não deverá exceder 1.5%."},
    {q:"Qual é o benchmark usado?",a:"O benchmark é uma composição mista: 60% mercado EUA + 25% Europa e UK + 10% Japão + 5% Canadá. Reflecte a exposição geográfica típica da carteira."},
    {q:"O backtest de 20 anos é fiável?",a:"O backtest usa dados reais de preços e foi construído com cuidado para evitar look-ahead bias. Inclui custos de transação e realismo operacional. Ainda assim, resultados passados não garantem resultados futuros."},
  ]},
  {cat:"Risco",faqs:[
    {q:"Qual é o perfil de risco da carteira?",a:"Moderado. A volatilidade anual é mantida entre 12–20% pelo mecanismo CAP15. É adequado para investidores com horizonte de 5+ anos que toleram flutuações temporárias mas querem protecção em crises."},
    {q:"O que acontece em crises de mercado?",a:"O modelo CAP15 reduz a exposição automaticamente quando a volatilidade sobe. Em 2008 e 2020 a carteira sofreu quedas, mas o mecanismo limitou o impacto. O modelo não é market-neutral mas é adaptativo."},
    {q:"O que é o Beta?",a:"Beta mede a sensibilidade da carteira ao mercado. Beta = 1.0 significa que a carteira move igual ao benchmark. Beta < 1.0 indica menor sensibilidade. O DECIDE tem Beta tendencialmente abaixo de 1.0 em períodos voláteis."},
    {q:"Como interpretar a contribuição para o risco por sector?",a:"Na página Risco, o gráfico de contribuição mostra quais sectores contribuem mais para o risco total da carteira (ajustado pelo beta estimado). Sectores em vermelho sobreponderam o risco vs. o seu peso em carteira."},
    {q:"Posso perder todo o capital?",a:"Não existe produto de investimento que elimine totalmente o risco de perda. O DECIDE reduz o risco através de diversificação e gestão dinâmica, mas perdas significativas são possíveis em cenários extremos."},
  ]},
  {cat:"Carteira e ordens",faqs:[
    {q:"O que é o XEON?",a:"XEON é o Xtrackers EUR Overnight Rate Swap UCITS ETF — um ETF de liquidez que rende a taxa de juro de curto prazo em euros (€STR). É usado como 'estacionamento' de capital quando o modelo reduz a exposição a acções."},
    {q:"O que é o hedge cambial?",a:"Parte da carteira está em activos denominados em USD. Para reduzir o risco cambial EUR/USD, é mantida uma posição de cobertura proporcional à exposição em dólares. Isso protege contra valorizações do euro face ao dólar."},
    {q:"O que é 'Aumentar' vs 'Comprar'?",a:"'Comprar' significa iniciar uma nova posição (o activo não estava em carteira). 'Reforçar' significa adicionar capital a uma posição já existente, aumentando o seu peso na carteira."},
    {q:"Como se calcula o número de acções a comprar?",a:"Na página Carteira, introduz o teu AUM (capital total). O sistema calcula o número de acções para cada posição com base no peso da carteira dividido pelo preço actual de mercado."},
    {q:"A corretora Interactive Brokers é obrigatória?",a:"Não é obrigatória para ver as recomendações, mas é necessária para execução automática de ordens. Podes também seguir as recomendações manualmente em qualquer corretora."},
    {q:"Com que frequência actualizam os preços?",a:"Os preços são obtidos em tempo real através do Interactive Brokers (quando ligado) ou do Yahoo Finance como fallback. A actualização ocorre quando abres a página Carteira."},
  ]},
  {cat:"Conta e segurança",faqs:[
    {q:"Como é feita a verificação de identidade?",a:"No registo, o teu email é verificado via link de confirmação e o telemóvel via código SMS (Twilio). Isso garante que a conta é associada a um utilizador real e previne fraude."},
    {q:"Os meus dados financeiros estão seguros?",a:"O DECIDE não armazena dados bancários nem credenciais de corretora. A ligação ao Interactive Brokers usa tokens API que podes revogar a qualquer momento. Os dados de carteira são armazenados de forma encriptada."},
    {q:"Posso cancelar a conta?",a:"Sim, podes cancelar a qualquer momento. Contacta a equipa através da página Contactos ou envia email para geral@decide.pt. Todos os teus dados serão apagados dentro de 30 dias."},
    {q:"Há um período de teste gratuito?",a:"A plataforma tem uma camada gratuita que permite ver as recomendações sem execução automática. Para integração com corretora e funcionalidades avançadas, existe uma subscrição mensal."},
  ]},
];

type ChatMsg={role:"user"|"assistant";content:string};
function AjudaPage() {
  const [openFaq,setOpenFaq]=useState<string|null>(null);
  const [openCat,setOpenCat]=useState<string>("Plataforma");
  const [chatMsgs,setChatMsgs]=useState<ChatMsg[]>([]);
  const [chatInput,setChatInput]=useState("");
  const [chatLoading,setChatLoading]=useState(false);
  const chatEndRef=useRef<HTMLDivElement>(null);

  useEffect(()=>{
    chatEndRef.current?.scrollIntoView({behavior:"smooth"});
  },[chatMsgs]);

  const sendChat=async()=>{
    const q=chatInput.trim();
    if(!q||chatLoading) return;
    const newMsgs:ChatMsg[]=[...chatMsgs,{role:"user",content:q}];
    setChatMsgs(newMsgs);
    setChatInput("");
    setChatLoading(true);
    try{
      const r=await fetch("/api/client/ai-chat",{
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({messages:newMsgs}),
      });
      const d=await r.json();
      setChatMsgs(m=>[...m,{role:"assistant",content:d.content??"Sem resposta."}]);
    }catch{
      setChatMsgs(m=>[...m,{role:"assistant",content:"Erro de ligação. Tenta novamente."}]);
    }finally{
      setChatLoading(false);
    }
  };

  const SUGGESTIONS=["Como funciona o modelo DECIDE?","O que é o CAP15?","Qual o risco desta carteira?","Como aprovar as recomendações?","O que é o Sharpe Ratio?","Qual a diferença entre Comprar e Reforçar?"];

  return (
    <div className="space-y-5">

      {/* ── AI Assistant ── */}
      <div className="bg-[#0b0f1a] border border-[#1a1f2e] rounded-xl overflow-hidden">
        <div className="flex items-center gap-3 px-5 py-4 border-b border-[#1a1f2e] bg-gradient-to-r from-blue-600/10 to-transparent">
          <div className="w-8 h-8 rounded-full bg-blue-600/20 border border-blue-500/30 flex items-center justify-center shrink-0">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#60a5fa" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z"/><path d="M12 16v-4M12 8h.01"/></svg>
          </div>
          <div>
            <div className="text-slate-200 font-bold text-sm">Assistente DECIDE</div>
            <div className="text-slate-500 text-[10px]">Alimentado por IA · Responde sobre finanças e a plataforma</div>
          </div>
          <div className="ml-auto flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"/>
            <span className="text-emerald-400 text-[10px] font-semibold">Online</span>
          </div>
        </div>

        {/* Suggestions — only when no messages */}
        {chatMsgs.length===0&&(
          <div className="px-5 py-4 border-b border-[#0f1420]">
            <div className="text-[10px] text-slate-500 mb-2.5 font-semibold uppercase tracking-wide">Sugestões</div>
            <div className="flex flex-wrap gap-2">
              {SUGGESTIONS.map(s=>(
                <button key={s} onClick={()=>{setChatInput(s);}}
                  className="text-[11px] text-blue-400 border border-blue-500/25 bg-blue-500/5 rounded-full px-3 py-1 hover:bg-blue-500/15 hover:border-blue-400/50 transition-colors">
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Messages */}
        {chatMsgs.length>0&&(
          <div className="px-5 py-4 space-y-4 max-h-72 overflow-y-auto">
            {chatMsgs.map((m,i)=>(
              <div key={i} className={`flex gap-3 ${m.role==="user"?"justify-end":""}`}>
                {m.role==="assistant"&&(
                  <div className="w-6 h-6 rounded-full bg-blue-600/20 border border-blue-500/30 flex items-center justify-center shrink-0 mt-0.5">
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#60a5fa" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z"/><path d="M12 16v-4M12 8h.01"/></svg>
                  </div>
                )}
                <div className={`max-w-[80%] rounded-xl px-4 py-2.5 text-xs leading-relaxed ${m.role==="user"?"bg-blue-600 text-white":"bg-[#0f1420] border border-[#1a1f2e] text-slate-300"}`}>
                  {m.content}
                </div>
              </div>
            ))}
            {chatLoading&&(
              <div className="flex gap-3">
                <div className="w-6 h-6 rounded-full bg-blue-600/20 border border-blue-500/30 flex items-center justify-center shrink-0 mt-0.5">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#60a5fa" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z"/><path d="M12 16v-4M12 8h.01"/></svg>
                </div>
                <div className="bg-[#0f1420] border border-[#1a1f2e] rounded-xl px-4 py-2.5">
                  <div className="flex gap-1 items-center h-4">
                    <span className="w-1.5 h-1.5 rounded-full bg-slate-500 animate-bounce" style={{animationDelay:"0ms"}}/>
                    <span className="w-1.5 h-1.5 rounded-full bg-slate-500 animate-bounce" style={{animationDelay:"150ms"}}/>
                    <span className="w-1.5 h-1.5 rounded-full bg-slate-500 animate-bounce" style={{animationDelay:"300ms"}}/>
                  </div>
                </div>
              </div>
            )}
            <div ref={chatEndRef}/>
          </div>
        )}

        {/* Input */}
        <div className="px-4 py-3 border-t border-[#0f1420] flex gap-2 items-end">
          <textarea
            value={chatInput}
            onChange={e=>setChatInput(e.target.value)}
            onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();sendChat();}}}
            placeholder="Coloca aqui a tua questão sobre finanças ou a plataforma…"
            rows={1}
            className="flex-1 bg-[#080c14] border border-[#252a3a] text-slate-200 text-xs rounded-lg px-3 py-2.5 outline-none focus:border-blue-500 transition-colors resize-none"
          />
          <button onClick={sendChat} disabled={!chatInput.trim()||chatLoading}
            className="bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 disabled:cursor-not-allowed text-white rounded-lg px-4 py-2.5 text-xs font-bold transition-colors shrink-0 flex items-center gap-1.5">
            <Send size={12}/>Enviar
          </button>
          {chatMsgs.length>0&&(
            <button onClick={()=>setChatMsgs([])} className="text-slate-600 hover:text-slate-400 text-[10px] transition-colors shrink-0 py-2.5">
              Limpar
            </button>
          )}
        </div>
        <div className="px-5 pb-3 text-[9px] text-slate-600">O assistente pode cometer erros. Não constitui conselho de investimento personalizado.</div>
      </div>

      {/* ── FAQs ── */}
      <div className="bg-[#0b0f1a] border border-[#1a1f2e] rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-[#1a1f2e]">
          <div className="font-bold text-slate-200 text-sm">Perguntas frequentes</div>
        </div>
        {/* Category tabs */}
        <div className="flex border-b border-[#1a1f2e] overflow-x-auto">
          {FAQ_CATS.map(({cat})=>(
            <button key={cat} onClick={()=>{setOpenCat(cat);setOpenFaq(null);}}
              className={`px-4 py-3 text-[11px] font-semibold whitespace-nowrap transition-colors shrink-0 ${openCat===cat?"text-white border-b-2 border-blue-500 bg-white/[0.02]":"text-slate-500 hover:text-slate-300"}`}>
              {cat}
            </button>
          ))}
        </div>
        {/* Accordion */}
        <div className="divide-y divide-[#0f1420]">
          {FAQ_CATS.find(c=>c.cat===openCat)?.faqs.map(({q,a})=>(
            <div key={q}>
              <button onClick={()=>setOpenFaq(openFaq===q?null:q)}
                className="w-full flex items-center justify-between px-5 py-3.5 text-left hover:bg-white/[0.02] transition-colors">
                <span className={`text-xs font-semibold ${openFaq===q?"text-blue-400":"text-slate-200"}`}>{q}</span>
                <span className={`text-slate-500 ml-3 shrink-0 transition-transform ${openFaq===q?"rotate-180":""}`}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="m6 9 6 6 6-6"/></svg>
                </span>
              </button>
              {openFaq===q&&(
                <div className="px-5 pb-4 text-xs text-slate-400 leading-relaxed bg-[#080c14] border-t border-[#0f1420]">
                  {a}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* ── Resources ── */}
      <div className="bg-[#0b0f1a] border border-[#1a1f2e] rounded-xl p-5">
        <div className="font-bold text-slate-200 text-sm mb-4">Guias e recursos</div>
        <div className="grid grid-cols-3 gap-3">
          {[
            {Icon:Activity,label:"Vídeos tutoriais",desc:"Tutoriais em vídeo passo a passo",href:"https://www.youtube.com/@decide",color:"text-red-400"},
            {Icon:BookOpen,label:"Guia rápido",desc:"Passos essenciais para começar",href:null,color:"text-blue-400"},
            {Icon:Globe,label:"Glossário de termos",desc:"Definição dos principais termos financeiros",href:null,color:"text-emerald-400"},
            {Icon:ShieldCheck,label:"Política de risco",desc:"Como o modelo CAP15 gere o risco",href:null,color:"text-amber-400"},
            {Icon:TrendingUp,label:"Metodologia do modelo",desc:"Documentação técnica do algoritmo",href:null,color:"text-cyan-400"},
            {Icon:Mail,label:"Contactar suporte",desc:"Fala directamente com a equipa",href:"contactos",color:"text-purple-400"},
          ].map(({Icon,label,desc,href,color},idx)=>(
            <button key={idx}
              onClick={()=>href==="contactos"?undefined:href?window.open(href,"_blank"):undefined}
              className="bg-[#080c14] border border-[#1a1f2e] rounded-lg p-4 text-left hover:border-blue-500/40 transition-colors group">
              <Icon size={16} className={`${color} mb-2 transition-transform group-hover:scale-110`}/>
              <div className="text-slate-200 text-xs font-semibold">{label}</div>
              <div className="text-slate-500 text-[10px] mt-0.5">{desc}</div>
            </button>
          ))}
        </div>
      </div>

    </div>
  );
}

/* ─── HistoricoPage sub-component ──────────────────────────── */
type MonthRec={date?:string;rebalance_date?:string;rows:{ticker:string;weightPct?:number}[];tbillsTotalPct?:number};
function HistoricoPage({sortedMonths,dates,equityRaw}:{sortedMonths:MonthRec[];dates:string[];equityRaw:number[]}) {
  const [histTab,setHistTab]=useState<"reco"|"ops"|"carteira">("reco");
  const [expandedIdx,setExpandedIdx]=useState<number|null>(null);
  const DMIN=1;

  const histRows=useMemo(()=>[...sortedMonths].reverse().map((m,i)=>{
    const raw=m.date??m.rebalance_date??"";
    const label=raw?new Date(raw).toLocaleDateString("pt-PT",{month:"long",year:"numeric"}):raw;
    const prevM=sortedMonths[sortedMonths.length-1-i-1];
    const pm=new Map((prevM?.rows??[]).map(r=>[r.ticker,r.weightPct??0]));
    const cm=new Map(m.rows.map(r=>[r.ticker,r.weightPct??0]));
    const WMIN=0.5; // only count tickers with meaningful weight in either month
    const tickers=[...new Set([...pm.keys(),...cm.keys()])].filter(t=>{
      if(t==="TBILL_PROXY"||t.startsWith("TBILL")||t.startsWith("CASH")||t==="XEON") return false;
      return Math.max(pm.get(t)??0, cm.get(t)??0)>=WMIN;
    });
    const compras:string[]=[],aumentos:string[]=[],vendas:string[]=[],reducoes:string[]=[],manter:string[]=[];
    tickers.forEach(t=>{
      const p=pm.get(t)??0,cu=cm.get(t)??0,d=cu-p;
      if(p<WMIN&&cu>=WMIN) compras.push(t);
      else if(cu<WMIN&&p>=WMIN) vendas.push(t);
      else if(d>=DMIN) aumentos.push(t);
      else if(d<=-DMIN) reducoes.push(t);
      else if(cu>=WMIN) manter.push(t);
    });
    const rebalDate=raw?new Date(raw):null;
    const getMiniPts=():Array<{date:string;v:number}>|null=>{
      if(!rebalDate||!dates.length) return null;
      const idx=dates.findIndex(d=>new Date(d)>=rebalDate);
      const start=Math.max(0,idx-63);
      const end=Math.min(dates.length-1,idx+63);
      const base=equityRaw[start]??1;
      const pts:Array<{date:string;v:number}>=[];
      for(let j=start;j<=end;j+=5){
        pts.push({date:dates[j]!.slice(0,7),v:+((equityRaw[j]??base)/base*100).toFixed(2)});
      }
      return pts;
    };
    const isLatest=i===0;
    const estado=isLatest?"Recente":"Aprovado";
    const estadoStyle=isLatest?"bg-blue-500/20 text-blue-400":"bg-emerald-500/15 text-emerald-400";
    const resumo=compras.length
      ?`Comprar ${compras.slice(0,2).join(", ")}${compras.length>2?` +${compras.length-2}`:""}${vendas.length?` · Vender ${vendas.slice(0,1).join(", ")}${vendas.length>1?` +${vendas.length-1}`:""}`:""}`
      :aumentos.length
        ?`Reforçar ${aumentos.slice(0,2).join(", ")}${reducoes.length?` · Reduzir ${reducoes.slice(0,1).join(", ")}`:""}`:
        "Rebalanceamento sem alterações";
    return {label,compras,aumentos,vendas,reducoes,manter,getMiniPts,isLatest,estado,estadoStyle,resumo};
  }),[sortedMonths,dates,equityRaw]);

  return (
    <div className="bg-[#0b0f1a] border border-[#1a1f2e] rounded-xl overflow-hidden">
      <div className="flex border-b border-[#1a1f2e]">
        {([["reco","Recomendações"],["ops","Operações"],["carteira","Histórico de carteira"]] as const).map(([k,l])=>(
          <button key={k} onClick={()=>setHistTab(k)}
            className={`px-5 py-3.5 text-xs font-semibold transition-colors ${histTab===k?"text-white border-b-2 border-blue-500 bg-white/[0.02]":"text-slate-500 hover:text-slate-300"}`}>
            {l}
          </button>
        ))}
      </div>
      {histTab==="reco"&&(
        <table className="w-full text-xs">
          <thead>
            <tr className="text-slate-500 border-b border-[#1a1f2e] text-left">
              <th className="px-5 py-3 font-semibold w-36">Data</th>
              <th className="px-3 py-3 font-semibold text-center text-emerald-500 w-9" title="Compras">▲</th>
              <th className="px-3 py-3 font-semibold text-center text-cyan-500 w-9" title="Reforços">↑</th>
              <th className="px-3 py-3 font-semibold text-center text-red-500 w-9" title="Vendas">▼</th>
              <th className="px-3 py-3 font-semibold text-center text-amber-500 w-9" title="Reduções">↓</th>
              <th className="px-3 py-3 font-semibold text-center text-slate-500 w-9" title="Mantidas">≈</th>
              <th className="px-5 py-3 font-semibold">Resumo</th>
              <th className="px-5 py-3 font-semibold w-24">Estado</th>
            </tr>
          </thead>
          <tbody>
            {histRows.map((r,i)=>(
              <React.Fragment key={i}>
                <tr className={`border-b border-[#0f1420] cursor-pointer transition-colors select-none ${expandedIdx===i?"bg-white/[0.04]":"hover:bg-white/[0.02]"}`}
                  onClick={()=>setExpandedIdx(expandedIdx===i?null:i)}>
                  <td className="px-5 py-3 font-semibold text-slate-200 capitalize">{r.label}</td>
                  <td className="px-3 py-3 text-center font-bold text-emerald-400">{r.compras.length||<span className="text-slate-700">—</span>}</td>
                  <td className="px-3 py-3 text-center font-bold text-cyan-400">{r.aumentos.length||<span className="text-slate-700">—</span>}</td>
                  <td className="px-3 py-3 text-center font-bold text-red-400">{r.vendas.length||<span className="text-slate-700">—</span>}</td>
                  <td className="px-3 py-3 text-center font-bold text-amber-400">{r.reducoes.length||<span className="text-slate-700">—</span>}</td>
                  <td className="px-3 py-3 text-center text-slate-500">{r.manter.length||<span className="text-slate-700">—</span>}</td>
                  <td className="px-5 py-3 text-slate-400 max-w-xs truncate">{r.resumo}</td>
                  <td className="px-5 py-3"><span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${r.estadoStyle}`}>{r.estado}</span></td>
                </tr>
                {expandedIdx===i&&(
                  <tr className="border-b border-[#0f1420] bg-[#060a12]">
                    <td colSpan={8} className="px-6 py-5">
                      <div className="grid grid-cols-2 gap-6">
                        <div>
                          <div className="text-[10px] text-slate-500 mb-2 font-semibold uppercase tracking-wide">Evolução ±3 meses</div>
                          {(()=>{
                            const pts=r.getMiniPts();
                            if(!pts||pts.length<2) return <div className="text-slate-600 text-xs italic">Sem dados de gráfico</div>;
                            return (
                              <ResponsiveContainer width="100%" height={110}>
                                <LineChart data={pts} margin={{top:4,right:4,left:-20,bottom:0}}>
                                  <XAxis dataKey="date" tick={{fontSize:8,fill:"#475569"}} tickLine={false} axisLine={false} interval={Math.floor(pts.length/4)}/>
                                  <YAxis tick={{fontSize:8,fill:"#475569"}} tickLine={false} axisLine={false} tickFormatter={v=>`${Number(v).toFixed(0)}`} domain={["dataMin-1","dataMax+1"]}/>
                                  <ReferenceLine y={100} stroke="#1e293b" strokeDasharray="3 3"/>
                                  <Tooltip formatter={(v:number)=>[`${Number(v).toFixed(1)}`,"Modelo (base 100)"]}
                                    contentStyle={{background:"#0f172a",border:"1px solid #3b82f6",borderRadius:6,fontSize:10,color:"#e2e8f0"}}
                                    labelStyle={{color:"#94a3b8"}} itemStyle={{color:"#60a5fa"}}/>
                                  <Line type="monotone" dataKey="v" stroke="#60a5fa" strokeWidth={1.5} dot={false}/>
                                </LineChart>
                              </ResponsiveContainer>
                            );
                          })()}
                        </div>
                        <div className="grid grid-cols-2 gap-x-5 gap-y-3 text-[11px] content-start">
                          {r.compras.length>0&&(
                            <div>
                              <div className="text-emerald-400 font-bold mb-1.5">▲ Comprar</div>
                              {r.compras.map(t=>(
                                <div key={t} className="py-0.5">
                                  <span className="font-mono text-slate-200">{t}</span>
                                  {COMPANY[t.toUpperCase()]&&<span className="ml-1 text-slate-600 text-[10px]">{COMPANY[t.toUpperCase()]}</span>}
                                </div>
                              ))}
                            </div>
                          )}
                          {r.aumentos.length>0&&(
                            <div>
                              <div className="text-cyan-400 font-bold mb-1.5">↑ Reforçar</div>
                              {r.aumentos.map(t=>(
                                <div key={t} className="py-0.5">
                                  <span className="font-mono text-slate-200">{t}</span>
                                  {COMPANY[t.toUpperCase()]&&<span className="ml-1 text-slate-600 text-[10px]">{COMPANY[t.toUpperCase()]}</span>}
                                </div>
                              ))}
                            </div>
                          )}
                          {r.vendas.length>0&&(
                            <div>
                              <div className="text-red-400 font-bold mb-1.5">▼ Vender</div>
                              {r.vendas.map(t=>(
                                <div key={t} className="py-0.5">
                                  <span className="font-mono text-slate-200">{t}</span>
                                  {COMPANY[t.toUpperCase()]&&<span className="ml-1 text-slate-600 text-[10px]">{COMPANY[t.toUpperCase()]}</span>}
                                </div>
                              ))}
                            </div>
                          )}
                          {r.reducoes.length>0&&(
                            <div>
                              <div className="text-amber-400 font-bold mb-1.5">↓ Reduzir</div>
                              {r.reducoes.map(t=>(
                                <div key={t} className="py-0.5">
                                  <span className="font-mono text-slate-200">{t}</span>
                                  {COMPANY[t.toUpperCase()]&&<span className="ml-1 text-slate-600 text-[10px]">{COMPANY[t.toUpperCase()]}</span>}
                                </div>
                              ))}
                            </div>
                          )}
                          {r.compras.length===0&&r.aumentos.length===0&&r.vendas.length===0&&r.reducoes.length===0&&(
                            <div className="col-span-2 text-slate-600 italic">Sem alterações significativas</div>
                          )}
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      )}
      {histTab==="ops"&&<div className="p-8 text-slate-600 text-sm italic text-center">Operações executadas em corretora — disponível após ligação ao Interactive Brokers.</div>}
      {histTab==="carteira"&&<div className="p-8 text-slate-600 text-sm italic text-center">Evolução histórica da composição da carteira — em breve.</div>}
    </div>
  );
}

/* ─── Página: Confirmar e enviar ordens para IB ────────────── */
type OrdersStep="review"|"confirm"|"sending"|"done"|"error";
function OrdensPage({actionCounts,recoLabel,aum,loggedIn,onBack,onShowRegister,profileLabel,fxExposure,marginEnabled}:{
  actionCounts:{comprar:number;aumentar:number;reduzir:number;vender:number;manter:number;
    rows:{ticker:string;prev:number;cur:number;delta:number;action:string}[];
    allRows:{ticker:string;prev:number;cur:number;delta:number;action:string}[];};
  recoLabel:string;aum:number;loggedIn:boolean;onBack:()=>void;onShowRegister:()=>void;
  profileLabel:string;fxExposure:string;marginEnabled:boolean;
}) {
  const [step,setStep]=React.useState<OrdersStep>("confirm");
  const [errMsg,setErrMsg]=React.useState("");
  const [orderRef,setOrderRef]=React.useState("");
  const [paperMode,setPaperMode]=React.useState(true);

  const fmtE=(v:number)=>v.toLocaleString("pt-PT",{minimumFractionDigits:2,maximumFractionDigits:2});
  const fmtEm=(v:number)=>Math.abs(v).toLocaleString("pt-PT",{minimumFractionDigits:2,maximumFractionDigits:2});

  // Compute order list from actionCounts.allRows (excluding Manter)
  const orderRows=actionCounts.allRows.filter(r=>r.action!=="Manter");
  const nOrdens=orderRows.length;
  const totalInvest=orderRows.filter(r=>r.delta>0).reduce((s,r)=>s+r.delta,0);
  const totalReduce=orderRows.filter(r=>r.delta<0).reduce((s,r)=>s+r.delta,0);
  const netChange=totalInvest+totalReduce;

  // Est. values based on AUM
  const investEur=totalInvest/100*aum;
  const reduceEur=Math.abs(totalReduce)/100*aum;
  const netEur=netChange/100*aum;
  const tradeCost=Math.max(2.0,nOrdens*0.7); // rough estimate €0.70/order, min €2

  async function submitOrders() {
    if(!loggedIn){onShowRegister();return;}
    setStep("sending");
    try {
      const body={
        orders:orderRows.map(r=>({
          ticker:r.ticker,
          action:r.action,
          delta_pct:r.delta,
          est_eur:Math.abs(r.delta)/100*aum,
        })),
        paper_mode:paperMode,
        profile:profileLabel,
        fx_exposure:fxExposure,
        margin_enabled:marginEnabled,
        aum,
      };
      const resp=await fetch("/api/ibkr-orders",{
        method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)
      });
      if(resp.ok){
        const j=await resp.json().catch(()=>({}));
        setOrderRef(j.order_ref??"ORD-"+Date.now().toString(36).toUpperCase());
        setStep("done");
      } else {
        const j=await resp.json().catch(()=>({}));
        setErrMsg(j.error||j.detail||`Erro ${resp.status}`);
        setStep("error");
      }
    } catch(e:unknown){
      setErrMsg(e instanceof Error?e.message:"Falha de ligação");
      setStep("error");
    }
  }

  // Step progress bar
  const steps=[
    {n:1,label:"Revisão do plano",done:true},
    {n:2,label:"Confirmação",active:step==="confirm"},
    {n:3,label:"Envio para IB",active:step==="sending"||step==="done"},
  ];

  if(step==="done") return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-6">
      <div className="w-20 h-20 rounded-full bg-emerald-500/15 border-2 border-emerald-500/40 flex items-center justify-center">
        <CheckCircle2 size={40} className="text-emerald-400"/>
      </div>
      <div className="text-center">
        <div className="text-2xl font-black text-slate-100 mb-1">Ordens enviadas!</div>
        <div className="text-slate-400 text-sm">As suas ordens foram submetidas à Interactive Brokers.</div>
        {orderRef&&<div className="mt-2 text-xs text-slate-500">Referência: <span className="font-mono text-slate-300">{orderRef}</span></div>}
      </div>
      <div className="flex gap-3">
        <button onClick={onBack} className="px-5 py-2.5 bg-[#0b0f1a] border border-[#1a1f2e] text-slate-300 text-sm font-semibold rounded-xl hover:bg-[#111827] transition-colors">Ver Recomendações</button>
        <button onClick={()=>setStep("confirm")} className="px-5 py-2.5 bg-blue-600/20 border border-blue-500/30 text-blue-400 text-sm font-semibold rounded-xl hover:bg-blue-600/30 transition-colors">Enviar novas ordens</button>
      </div>
    </div>
  );

  if(step==="error") return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-6">
      <div className="w-20 h-20 rounded-full bg-red-500/15 border-2 border-red-500/40 flex items-center justify-center">
        <AlertTriangle size={36} className="text-red-400"/>
      </div>
      <div className="text-center">
        <div className="text-xl font-black text-slate-100 mb-1">Erro ao enviar ordens</div>
        <div className="text-slate-400 text-sm max-w-md">{errMsg}</div>
      </div>
      <div className="flex gap-3">
        <button onClick={onBack} className="px-5 py-2.5 bg-[#0b0f1a] border border-[#1a1f2e] text-slate-300 text-sm font-semibold rounded-xl hover:bg-[#111827] transition-colors">Cancelar</button>
        <button onClick={()=>setStep("confirm")} className="px-5 py-2.5 bg-blue-600 text-white text-sm font-bold rounded-xl hover:bg-blue-500 transition-colors">Tentar novamente</button>
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      {/* Back link */}
      <button onClick={onBack} className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-300 transition-colors -mt-1">
        <ArrowUpRight size={12} className="rotate-[225deg]"/>Voltar ao plano
      </button>

      {/* Step progress */}
      <div className="flex items-center gap-0 bg-[#0b0f1a] border border-[#1a1f2e] rounded-xl px-6 py-4">
        {steps.map((s,i)=>(
          <React.Fragment key={s.n}>
            <div className="flex items-center gap-2 shrink-0">
              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-black border-2 transition-colors ${
                s.done?"bg-emerald-600 border-emerald-500 text-white":
                s.active?"bg-blue-600 border-blue-500 text-white":
                "bg-[#111827] border-[#252a3a] text-slate-500"}`}>
                {s.done?<CheckCircle2 size={14}/>:s.n}
              </div>
              <span className={`text-xs font-semibold ${s.done?"text-emerald-400":s.active?"text-slate-100":"text-slate-500"}`}>{s.label}</span>
            </div>
            {i<steps.length-1&&<div className="flex-1 h-px bg-[#1a1f2e] mx-4"/>}
          </React.Fragment>
        ))}
      </div>

      {/* Info banner */}
      <div className="flex items-center gap-2 bg-blue-500/[0.07] border border-blue-500/20 rounded-xl px-4 py-3">
        <Info size={14} className="text-blue-400 shrink-0"/>
        <span className="text-xs text-slate-300">Ao aprovar, as ordens serão enviadas para a <span className="font-bold text-blue-300">Interactive Brokers</span> para execução ao melhor preço disponível.</span>
      </div>

      {/* Main 2-col layout */}
      <div className="grid grid-cols-3 gap-4">

        {/* LEFT: what happens + order list */}
        <div className="col-span-2 space-y-4">

          {/* What happens now */}
          <div className="bg-[#0b0f1a] border border-[#1a1f2e] rounded-xl p-5">
            <div className="font-bold text-slate-200 text-sm mb-4">O que vai acontecer agora</div>
            <div className="space-y-4">
              {[
                {icon:<ShieldCheck size={18} className="text-blue-400"/>,title:"Validação das ordens",desc:"Vamos validar todas as ordens e verificar disponibilidade de caixa e margem na sua conta IB."},
                {icon:<Send size={18} className="text-blue-400"/>,title:"Envio para a Interactive Brokers",desc:"As ordens serão enviadas de forma atómica e segura através da API da IB."},
                {icon:<Activity size={18} className="text-blue-400"/>,title:"Execução",desc:"A IB executará as ordens ao melhor preço disponível no mercado."},
                {icon:<CheckCircle2 size={18} className="text-blue-400"/>,title:"Confirmação",desc:"Receberá uma notificação quando todas as ordens estiverem executadas."},
              ].map(x=>(
                <div key={x.title} className="flex gap-3">
                  <div className="w-9 h-9 rounded-lg bg-blue-600/10 border border-blue-500/20 flex items-center justify-center shrink-0">{x.icon}</div>
                  <div>
                    <div className="text-sm font-semibold text-slate-200">{x.title}</div>
                    <div className="text-xs text-slate-500 mt-0.5">{x.desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Order list */}
          <div className="bg-[#0b0f1a] border border-[#1a1f2e] rounded-xl p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="font-bold text-slate-200 text-sm">Ordens a executar</div>
              <span className="text-xs text-slate-500">{nOrdens} ordens · {recoLabel}</span>
            </div>
            {nOrdens===0?(
              <div className="text-slate-500 text-sm text-center py-8">Sem ordens a executar este mês.</div>
            ):(
              <table className="w-full text-xs">
                <thead><tr className="text-slate-500 border-b border-[#1a1f2e] text-left">
                  <th className="pb-2 font-semibold">Ativo</th>
                  <th className="pb-2 font-semibold">Ação</th>
                  <th className="pb-2 font-semibold text-right">Peso actual</th>
                  <th className="pb-2 font-semibold text-right">Peso novo</th>
                  <th className="pb-2 font-semibold text-right">Δ Peso</th>
                  <th className="pb-2 font-semibold text-right">Val. estimado</th>
                </tr></thead>
                <tbody>
                  {orderRows.map(r=>{
                    const isBuy=r.action==="Comprar";const isUp=r.action==="Aumentar";
                    const isSell=r.action==="Vender";const isDown=r.action==="Reduzir";
                    const acBg=isBuy?"bg-emerald-500/15 text-emerald-300 border-emerald-500/30":isUp?"bg-cyan-500/15 text-cyan-300 border-cyan-500/30":isSell?"bg-red-500/15 text-red-300 border-red-500/30":"bg-amber-500/15 text-amber-300 border-amber-500/30";
                    const acIcon=isBuy?"↑":isUp?"↗":isSell?"↓":"↙";
                    const estVal=Math.abs(r.delta)/100*aum;
                    return (
                      <tr key={r.ticker} className="border-b border-[#111520] hover:bg-white/[0.02]">
                        <td className="py-2.5">
                          <a href={`https://finance.yahoo.com/quote/${r.ticker}`} target="_blank" rel="noopener noreferrer"
                            className="font-bold text-blue-400 hover:underline">{r.ticker}</a>
                        </td>
                        <td className="py-2.5">
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border ${acBg}`}>
                            <span className="font-black">{acIcon}</span>{r.action}
                          </span>
                        </td>
                        <td className="py-2.5 text-right text-slate-400">{r.prev.toFixed(1)}%</td>
                        <td className="py-2.5 text-right text-slate-300">{r.cur.toFixed(1)}%</td>
                        <td className={`py-2.5 text-right font-semibold ${r.delta>0?"text-emerald-400":"text-red-400"}`}>{r.delta>0?"+":""}{r.delta.toFixed(2)}%</td>
                        <td className={`py-2.5 text-right font-semibold ${r.delta>0?"text-emerald-400":"text-amber-400"}`}>{r.delta>0?"":"-"}€ {fmtEm(estVal)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          {/* Important note */}
          <div className="flex items-start gap-3 bg-amber-500/[0.06] border border-amber-500/20 rounded-xl px-4 py-4">
            <AlertTriangle size={15} className="text-amber-400 shrink-0 mt-0.5"/>
            <div>
              <div className="text-xs font-bold text-amber-300 mb-1">Nota importante</div>
              <div className="text-xs text-slate-400 space-y-1">
                <p>As ordens são executadas de acordo com as condições de mercado actuais.</p>
                <p>Pequenas diferenças de preços podem ocorrer entre a simulação e a execução final.</p>
              </div>
            </div>
          </div>

          {/* Paper mode toggle */}
          <div className="flex items-center justify-between bg-[#0b0f1a] border border-[#1a1f2e] rounded-xl px-4 py-3">
            <div>
              <div className="text-xs font-semibold text-slate-300">Modo paper trading</div>
              <div className="text-[10px] text-slate-500">Simula o envio sem executar ordens reais na IB</div>
            </div>
            <button onClick={()=>setPaperMode(v=>!v)}
              className={`w-11 h-6 rounded-full transition-colors relative ${paperMode?"bg-blue-600":"bg-slate-700"}`}>
              <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${paperMode?"translate-x-5":"translate-x-0.5"}`}/>
            </button>
          </div>

          {/* Action buttons */}
          <div className="flex gap-3">
            <button onClick={onBack} className="px-6 py-3 bg-[#0b0f1a] border border-[#1a1f2e] text-slate-300 text-sm font-semibold rounded-xl hover:bg-[#111827] transition-colors">
              Cancelar
            </button>
            <button onClick={submitOrders} disabled={step==="sending"||nOrdens===0}
              className="flex-1 flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-sm font-bold py-3 rounded-xl transition-all shadow-lg shadow-emerald-900/30">
              {step==="sending"?(
                <><span className="animate-spin">⟳</span> A enviar ordens…</>
              ):(
                <><Send size={15}/>{paperMode?"Simular envio para IB →":"Confirmar e enviar ordens para IB →"}</>
              )}
            </button>
          </div>
          <p className="text-center text-[10px] text-slate-600 flex items-center justify-center gap-1">
            <ShieldCheck size={11}/> Conexão segura com a Interactive Brokers
          </p>
        </div>

        {/* RIGHT: summary */}
        <div className="space-y-4">
          <div className="bg-[#0b0f1a] border border-[#1a1f2e] rounded-xl p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="font-bold text-slate-200 text-sm">Resumo do plano</div>
              <span className="text-xs text-slate-500">{nOrdens} ordens</span>
            </div>
            <div className="grid grid-cols-3 gap-3 mb-5">
              {[
                {label:"Valor a investir",val:`€ ${fmtE(investEur)}`,c:"text-emerald-400"},
                {label:"Custo estimado",val:`€ ${fmtE(tradeCost)}`,c:"text-slate-300"},
                {label:"Trade esperado",val:`${(nOrdens/aum*100).toFixed(2)}%`,c:"text-slate-300"},
              ].map(k=>(
                <div key={k.label} className="text-center">
                  <div className="text-[9px] text-slate-500 mb-1">{k.label}</div>
                  <div className={`text-sm font-black ${k.c}`}>{k.val}</div>
                </div>
              ))}
            </div>

            <div className="border-t border-[#1a1f2e] pt-4 mb-4">
              <div className="text-xs font-semibold text-slate-400 mb-3">Alterações na carteira</div>
              <div className="space-y-2">
                {[
                  {label:`A aumentar / comprar (${actionCounts.comprar+actionCounts.aumentar})`,val:`€ ${fmtE(investEur)}`,c:"text-emerald-400",dot:"bg-emerald-500"},
                  {label:`A reduzir / vender (${actionCounts.reduzir+actionCounts.vender})`,val:`-€ ${fmtE(reduceEur)}`,c:"text-red-400",dot:"bg-red-500"},
                  {label:`Manter (${actionCounts.manter})`,val:"0,00 €",c:"text-slate-400",dot:"bg-slate-500"},
                ].map(x=>(
                  <div key={x.label} className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2"><div className={`w-2 h-2 rounded-full shrink-0 ${x.dot}`}/><span className="text-slate-400">{x.label}</span></div>
                    <span className={`font-semibold ${x.c}`}>{x.val}</span>
                  </div>
                ))}
                <div className="flex items-center justify-between text-xs border-t border-[#1a1f2e] pt-2 mt-2">
                  <span className="text-slate-300 font-semibold">Total</span>
                  <span className={`font-bold ${netEur>=0?"text-emerald-400":"text-amber-400"}`}>{netEur>=0?"+":"-"}€ {fmtEm(netEur)}</span>
                </div>
              </div>
            </div>

            {/* Top changes */}
            <div className="border-t border-[#1a1f2e] pt-4">
              <div className="text-xs font-semibold text-slate-400 mb-3">Principais alterações</div>
              <table className="w-full text-[10px]">
                <thead><tr className="text-slate-600 border-b border-[#1a1f2e]">
                  <th className="text-left pb-1.5">Ativo</th>
                  <th className="text-left pb-1.5">Ação</th>
                  <th className="text-right pb-1.5">Val. est.</th>
                </tr></thead>
                <tbody>
                  {orderRows.slice(0,6).map(r=>{
                    const isBuy=r.action==="Comprar"||r.action==="Aumentar";
                    const est=Math.abs(r.delta)/100*aum;
                    return (
                      <tr key={r.ticker} className="border-b border-[#0d1017]">
                        <td className="py-1.5 font-bold text-slate-200">{r.ticker}</td>
                        <td className="py-1.5">
                          <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${isBuy?"bg-emerald-500/15 text-emerald-300":"bg-amber-500/15 text-amber-300"}`}>{r.action}</span>
                        </td>
                        <td className={`py-1.5 text-right font-semibold ${isBuy?"text-emerald-400":"text-amber-400"}`}>{isBuy?"+":"-"}€ {fmtEm(est)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Liquidity */}
            <div className="border-t border-[#1a1f2e] pt-4 mt-4">
              <div className="flex items-center justify-between mb-1">
                <div className="text-xs text-slate-500 flex items-center gap-1">Liquidez após execução (estimada)<Info size={10}/></div>
              </div>
              <div className="text-base font-black text-slate-100">€ {fmtE(Math.max(0,aum*0.02))}</div>
              <div className="text-[10px] text-slate-600">Disponível na conta IB após execução das ordens</div>
            </div>
          </div>

          {/* Security badges */}
          <div className="bg-[#0b0f1a] border border-[#1a1f2e] rounded-xl p-4 space-y-3">
            {[
              {icon:<ShieldCheck size={14} className="text-emerald-400"/>,title:"Ligação segura",desc:"Comunicação encriptada com a IB"},
              {icon:<CheckCircle2 size={14} className="text-blue-400"/>,title:"Sem intervenção manual",desc:"Execução automática e optimizada"},
              {icon:<Activity size={14} className="text-slate-400"/>,title:"Transparência total",desc:"Acompanhe todas as execuções no histórico"},
            ].map(x=>(
              <div key={x.title} className="flex gap-3 items-start">
                <div className="mt-0.5 shrink-0">{x.icon}</div>
                <div>
                  <div className="text-[10px] font-semibold text-slate-300">{x.title}</div>
                  <div className="text-[9px] text-slate-500">{x.desc}</div>
                </div>
              </div>
            ))}
          </div>

          {/* Profile context */}
          <div className="bg-[#0b0f1a] border border-[#1a1f2e] rounded-xl p-4">
            <div className="text-[10px] text-slate-500 space-y-1">
              <div className="flex justify-between"><span>Perfil</span><span className="text-slate-300 font-semibold">{profileLabel}</span></div>
              <div className="flex justify-between"><span>Exposição FX</span><span className="text-slate-300 font-semibold capitalize">{fxExposure}</span></div>
              <div className="flex justify-between"><span>Margem</span><span className={`font-semibold ${marginEnabled?"text-amber-400":"text-slate-400"}`}>{marginEnabled?"Activa":"Desactivada"}</span></div>
              <div className="flex justify-between"><span>Modo</span><span className={`font-semibold ${paperMode?"text-blue-400":"text-emerald-400"}`}>{paperMode?"Paper trading":"Real"}</span></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function ClientDashboardPage() {
  const router=useRouter();
  const {profile}=useSyncedRiskProfileFromOnboarding();
  const [mounted,setMounted]=useState(false);
  const [sessionUser,setSessionUser]=useState<string|null>(null);
  const [loggedIn,setLoggedIn]=useState(false);
  const [showRegModal,setShowRegModal]=useState(false);
  const [period,setPeriod]=useState<Period>("20 Anos");
  const [regSuccess,setRegSuccess]=useState(false);
  const [activePage,setActivePage]=useState<Page>("dashboard");
  const [riskProfileLocal,setRiskProfileLocalRaw]=useState<RiskProfile>("moderado");
  const [fxExposure,setFxExposureRaw]=useState<FxExposure>("protegida");
  const [marginEnabled,setMarginEnabledRaw]=useState(false);
  const [kpiMode,setKpiModeRaw]=useState<KpiMode>("base");
  const [configPanelOpen,setConfigPanelOpen]=useState(false);

  // Persist preferences in localStorage
  const LS_KEY="decide_prefs_v1";
  useEffect(()=>{
    try{
      const raw=localStorage.getItem(LS_KEY);
      if(raw){
        const p=JSON.parse(raw);
        if(p.riskProfile) setRiskProfileLocalRaw(p.riskProfile);
        if(p.fxExposure)  setFxExposureRaw(p.fxExposure);
        if(typeof p.marginEnabled==="boolean") setMarginEnabledRaw(p.marginEnabled);
        if(p.kpiMode)     setKpiModeRaw(p.kpiMode);
      }
    }catch{}
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[]);

  const savePrefs=(patch:Partial<{riskProfile:RiskProfile;fxExposure:FxExposure;marginEnabled:boolean;kpiMode:KpiMode}>)=>{
    try{
      const existing=JSON.parse(localStorage.getItem(LS_KEY)??"{}");
      localStorage.setItem(LS_KEY,JSON.stringify({...existing,...patch}));
    }catch{}
  };
  const setRiskProfileLocal=(v:RiskProfile)=>{setRiskProfileLocalRaw(v);savePrefs({riskProfile:v});};
  const setFxExposure=(v:FxExposure)=>{setFxExposureRaw(v);savePrefs({fxExposure:v});};
  const setMarginEnabled=(v:boolean|((prev:boolean)=>boolean))=>{
    setMarginEnabledRaw(prev=>{
      const next=typeof v==="function"?v(prev):v;
      savePrefs({marginEnabled:next});
      return next;
    });
  };
  const setKpiMode=(v:KpiMode)=>{setKpiModeRaw(v);savePrefs({kpiMode:v});};
  const [contactForm,setContactForm]=useState({nome:"",email:"",assunto:"",msg:""});
  const [contactSent,setContactSent]=useState(false);
  const [aum,setAum]=useState(100000); // portfolio size in EUR for shares calculation
  const [prices,setPrices]=useState<Record<string,{price:number;currency:string;qty?:number;value?:number}|null>>({});
  const [pricesLoading,setPricesLoading]=useState(false);

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

  // price fetch effect is placed after latestMonth declaration below

  // API devolve meses ordenados do mais antigo para o mais recente — último = mais recente
  const sortedMonths=useMemo(()=>[...recoMonths].sort((a,b)=>{
    const da=a.date??a.rebalance_date??"";
    const db=b.date??b.rebalance_date??"";
    return da<db?-1:da>db?1:0;
  }),[recoMonths]);
  const latestMonth=sortedMonths[sortedMonths.length-1];
  const prevMonth=sortedMonths[sortedMonths.length-2];

  useEffect(()=>{
    if(activePage!=="carteira"||!latestMonth) return;
    const tickers=(latestMonth.rows??[])
      .filter((r:any)=>r.weightPct>=0.5&&r.ticker!=="TBILL_PROXY"&&!r.ticker.startsWith("CASH")&&!r.ticker.startsWith("TBILL")&&r.ticker!=="XEON")
      .map((r:any)=>r.ticker as string);
    if(!tickers.length) return;
    setPricesLoading(true);
    fetch(`/api/client/market-prices?tickers=${encodeURIComponent(tickers.join(","))}`)
      .then(r=>r.json()).then((d:any)=>setPrices(d)).catch(()=>{})
      .finally(()=>setPricesLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[activePage,latestMonth?.date]);

  const actionCounts=useMemo(()=>{
    const empty:{ticker:string;prev:number;cur:number;delta:number;action:string}[]=[];
    if(!latestMonth||!prevMonth) return {comprar:0,aumentar:0,reduzir:0,vender:0,manter:0,rows:empty,allRows:empty};
    const N_POS=20;
    const DMIN=1.0;
    const ALWAYS_INCLUDE=new Set(["XEON"]);
    const pm=new Map(prevMonth.rows.map(r=>[r.ticker,r.weightPct]));
    const cm=new Map(latestMonth.rows.map(r=>[r.ticker,r.weightPct]));
    const candidates=[...new Set([...pm.keys(),...cm.keys()])]
      .filter(t=>!ALWAYS_INCLUDE.has(t)&&t!=="TBILL_PROXY"&&!t.startsWith("CASH")&&!t.startsWith("TBILL"));
    const ranked=candidates
      .map(t=>({t,w:Math.max(pm.get(t)??0,cm.get(t)??0)}))
      .sort((a,b)=>b.w-a.w).slice(0,N_POS).map(x=>x.t);
    const all=[...ranked,...ALWAYS_INCLUDE];
    let c=0,au=0,rd=0,v=0,m=0;
    const rows:{ticker:string;prev:number;cur:number;delta:number;action:string}[]=[];
    all.forEach(t=>{
      // XEON fallback: use tbillsTotalPct if not explicitly in rows
      const p=pm.get(t)??(t==="XEON"?prevMonth.tbillsTotalPct??0:0);
      const cur=cm.get(t)??(t==="XEON"?latestMonth.tbillsTotalPct??0:0);
      const delta=cur-p;
      let action="Manter";
      if(p===0&&cur>0){action="Comprar";c++;}
      else if(cur===0&&p>0){action="Vender";v++;}
      else if(delta>=DMIN){action="Aumentar";au++;}
      else if(delta<=-DMIN){action="Reduzir";rd++;}
      else{action="Manter";m++;}
      rows.push({ticker:t,prev:p,cur,delta,action});
    });
    const changedRows=rows.filter(r=>r.action!=="Manter").sort((a,b)=>Math.abs(b.delta)-Math.abs(a.delta)).slice(0,8);
    const allRows=[...rows].sort((a,b)=>{
      if(a.ticker==="XEON") return 1;
      if(b.ticker==="XEON") return -1;
      const order={Comprar:0,Aumentar:1,Reduzir:2,Vender:3,Manter:4};
      const oa=(order as any)[a.action]??5, ob=(order as any)[b.action]??5;
      if(oa!==ob) return oa-ob;
      return b.cur-a.cur;
    });
    return {comprar:c,aumentar:au,reduzir:rd,vender:v,manter:m,rows:changedRows,allRows};
  },[latestMonth,prevMonth]);

  const sectorData=useMemo(()=>{
    if(!latestMonth) return [];
    const map=new Map<string,number>();
    latestMonth.rows.forEach(r=>{ if(r.ticker==="TBILL_PROXY") return; const s=getSector(r.ticker); map.set(s,(map.get(s)??0)+r.weightPct); });
    const total=[...map.values()].reduce((a,b)=>a+b,0)||1;
    return [...map.entries()].map(([name,pct])=>({name,value:Math.round(pct/total*100)})).sort((a,b)=>b.value-a.value);
  },[latestMonth]);

  // ── Profile factor (must be before scaledEquity / perfData) ─────────────
  const profileFactor=useMemo(()=>
    riskProfileLocal==="conservador"?0.75:riskProfileLocal==="dinamico"?1.25:1.0
  ,[riskProfileLocal]);
  const profileLabel=useMemo(()=>
    riskProfileLocal==="conservador"?"Conservador":riskProfileLocal==="dinamico"?"Dinâmico":"Moderado"
  ,[riskProfileLocal]);

  // ── Scaled equity curve: apply profile factor to every daily return ───────
  const scaledEquity=useMemo(()=>scaleEquityCurve(equityRaw,profileFactor),[equityRaw,profileFactor]);

  // ── Recompute all KPIs from scaled curve ──────────────────────────────────
  const perfData=useMemo(()=>{
    if(!dates.length||!scaledEquity.length) return null;
    const s=skipWarmup(scaledEquity,periodStart(dates,period));
    const chart=makeChartData(dates,scaledEquity,benchRaw,period);
    const m=periodMetrics(scaledEquity.slice(s),benchRaw.slice(s),period);
    const allRets=scaledEquity.slice(1).map((v,i)=>v/scaledEquity[i]-1);
    const curVol=annualVol(allRets.slice(-252))*100;
    const curDD=currentDD(scaledEquity.slice(-252*3))*100;
    const dd5Start=skipWarmup(scaledEquity,periodStart(dates,"20 Anos"));
    const modelDD=rollingDD(dates.slice(dd5Start),scaledEquity.slice(dd5Start),10);
    let bpk=benchRaw[dd5Start]??1;
    const dd5=modelDD.map((pt,j)=>{
      const bv=benchRaw[dd5Start+j*10]??benchRaw[benchRaw.length-1];
      if(bv>bpk)bpk=bv;
      return {...pt,bench:+(((bv-bpk)/bpk)*100).toFixed(2)};
    });
    const now=new Date(); const ytdStartStr=`${now.getFullYear()}-01-01`;
    const ytdIdx=dates.findIndex(d=>d>=ytdStartStr);
    const ytdRet=ytdIdx>=0&&scaledEquity.length>ytdIdx
      ? (scaledEquity[scaledEquity.length-1]/scaledEquity[ytdIdx]-1)*100 : 0;
    return {chart,m,curVol,curDD,ddChart:dd5,ytdRet};
  },[dates,scaledEquity,benchRaw,period]);

  // Convenience aliases — direct from recomputed curve (no post-hoc multiply)
  const scaledVol  =perfData?.curVol??0;
  const scaledDD   =perfData?.curDD ??0;
  const scaledYtd  =perfData?.ytdRet??0;
  const scaledTotal=perfData?.m.ret ??0;
  const scaledAnn  =perfData?.m.ann ??0;

  // Annual returns from equity series
  const annualReturns=useMemo(()=>{
    if(!dates.length||!scaledEquity.length) return [];
    const byYear=new Map<number,number[]>();
    dates.forEach((d,i)=>{ const y=new Date(d).getFullYear(); if(!byYear.has(y))byYear.set(y,[]); byYear.get(y)!.push(scaledEquity[i]); });
    const benchByYear=new Map<number,number[]>();
    dates.forEach((d,i)=>{ const y=new Date(d).getFullYear(); if(!benchByYear.has(y))benchByYear.set(y,[]); benchByYear.get(y)!.push(benchRaw[i]); });
    const curY=new Date().getFullYear();
    return [...byYear.entries()]
      .filter(([y])=>y<=curY)
      .sort((a,b)=>a[0]-b[0])
      .map(([year,vals])=>{
        const bVals=benchByYear.get(year)??[1,1];
        return {
          year,
          modelo:+((vals[vals.length-1]/vals[0]-1)*100).toFixed(1),
          bench:+((bVals[bVals.length-1]/bVals[0]-1)*100).toFixed(1),
        };
      });
  },[dates,scaledEquity,benchRaw]);

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

  // Return distribution histogram (monthly returns)
  const returnDist=useMemo(()=>{
    if(scaledEquity.length<24) return [];
    const step=21;
    const monthlyRets:number[]=[];
    for(let i=step;i<scaledEquity.length;i+=step){
      monthlyRets.push((scaledEquity[i]!/scaledEquity[i-step]!-1)*100);
    }
    const BIN_W=2,MIN=-20,MAX=30;
    const bins:number[]=[];
    for(let b=MIN;b<MAX;b+=BIN_W) bins.push(b);
    return bins.map(b=>{
      const count=monthlyRets.filter(r=>r>=b&&r<b+BIN_W).length;
      return {bin:`${b>0?"+":""}${b}%`, count, mid:b+BIN_W/2};
    });
  },[scaledEquity]);

  // Sector allocation + risk contribution
  const SECTOR_BETA:Record<string,number>={
    "Tecnologia":1.35,"Comunicação":1.15,"Energia":1.05,"Industrial":1.00,
    "Mat. Básicos":0.90,"Cons. Básico":0.70,"Saúde":0.75,"Financeiro":1.10,
    "Imobiliário":0.85,"Outro":1.00,
  };
  const sectorAlloc=useMemo(()=>{
    if(!latestMonth) return [];
    const m=new Map<string,number>();
    (latestMonth.rows??[]).filter((r:any)=>r.ticker!=="XEON"&&!r.ticker.startsWith("TBILL")&&(r.weightPct??0)>=0.5).forEach((r:any)=>{
      const s=getSector(r.ticker)||"Outro";
      m.set(s,(m.get(s)??0)+(r.weightPct??0));
    });
    const total=[...m.values()].reduce((a,b)=>a+b,0)||1;
    // compute risk contribution using beta-adjusted weights
    const raw=[...m.entries()].sort((a,b)=>b[1]-a[1]).map(([name,v])=>({name,alloc:+((v/total)*100).toFixed(1),riskW:(v/total)*(SECTOR_BETA[name]??1)}));
    const riskTotal=raw.reduce((s,r)=>s+r.riskW,0)||1;
    return raw.map(r=>({name:r.name,pct:r.alloc,risk:+((r.riskW/riskTotal)*100).toFixed(1)}));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[latestMonth]);

  // Risk metrics: VaR 95%, Beta
  const riskMetrics=useMemo(()=>{
    if(scaledEquity.length<252) return {var95:0,beta:0};
    const mRets=scaledEquity.slice(1).map((v,i)=>v/scaledEquity[i]-1);
    const bRets=benchRaw.slice(1).map((v,i)=>v/(benchRaw[i]||1)-1);
    const sorted=[...mRets].sort((a,b)=>a-b);
    const var95=sorted[Math.floor(sorted.length*0.05)]??0;
    const n=Math.min(mRets.length,bRets.length);
    const bMean=bRets.slice(0,n).reduce((a,b)=>a+b,0)/n;
    const bVar=bRets.slice(0,n).reduce((a,b)=>a+(b-bMean)**2,0)/n;
    const cov=mRets.slice(0,n).reduce((a,m,i)=>a+(m-mRets.slice(0,n).reduce((x,y)=>x+y,0)/n)*(bRets[i]!-bMean),0)/n;
    return {var95:var95*100,beta:bVar>0?+(cov/bVar).toFixed(2):0};
  },[scaledEquity,benchRaw]);

  const recoLabel=useMemo(()=>{
    const raw=latestMonth?.date??latestMonth?.rebalance_date??"";
    if(!raw) return "Última recomendação";
    try{ return new Date(raw).toLocaleDateString("pt-PT",{month:"long",year:"numeric"}); }catch{ return raw; }
  },[latestMonth]);

  const whatChanged=useMemo(()=>{
    const changed=actionCounts.rows.filter(r=>r.action!=="Manter"&&r.ticker!=="XEON");
    if(!changed.length) return [{icon:"up",title:"Modelo mantém posicionamento",desc:"Sem alterações significativas este mês."}];
    // Group by sector: bought/increased vs sold/reduced
    const bySector=(tickers:{ticker:string;action:string}[],dir:"up"|"down")=>{
      const map=new Map<string,string[]>();
      tickers.forEach(r=>{const s=getSector(r.ticker);if(!map.has(s))map.set(s,[]);map.get(s)!.push(r.ticker);});
      return [...map.entries()].map(([sector,tks])=>({
        icon:dir,
        title:dir==="up"?`Aumentámos exposição a ${sector}`:`Reduzimos ${sector}`,
        desc:`${tks.join(", ")}.`,
      }));
    };
    const bought=changed.filter(r=>r.action==="Comprar"||r.action==="Aumentar");
    const sold=changed.filter(r=>r.action==="Vender"||r.action==="Reduzir");
    const items=[
      ...bySector(bought,"up"),
      ...bySector(sold,"down"),
      {icon:"wave",title:"Volatilidade controlada",desc:`Vol actual ${perfData?.curVol?.toFixed(1)??"—"}% anual — nível Moderado.`},
    ];
    return items.slice(0,4) as {icon:string;title:string;desc:string}[];
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
            {/* ── Page title bar ── */}
            <div className="flex items-center justify-between px-8 py-4 border-b border-[#1a1f2e]">
              <div>
                <h1 className="text-xl font-black text-white">{
                  activePage==="dashboard"?"Dashboard":
                  activePage==="reco"?"Recomendações":
                  activePage==="carteira"?"Carteira":
                  activePage==="perf"?"Performance":
                  activePage==="risco"?"Risco":
                  activePage==="historico"?"Histórico":
                  activePage==="simulador"?"Simulador":
                  activePage==="relatorios"?"Relatórios":
                  activePage==="custos"?"Custos":
                  activePage==="ajuda"?"Ajuda":
                  activePage==="ordens"?"Confirmar e enviar ordens":"Contactos"
                }</h1>
                <p className="text-slate-400 text-xs mt-0.5">{
                  activePage==="dashboard"?"Visão geral da sua carteira e recomendações":
                  activePage==="reco"?"Recomendação mensal do modelo — "+recoLabel:
                  activePage==="carteira"?"Composição e alocação da carteira":
                  activePage==="perf"?"Análise de performance histórica":
                  activePage==="risco"?"Métricas e análise de risco":
                  activePage==="historico"?"Histórico de recomendações":
                  activePage==="simulador"?"Simule diferentes cenários de investimento":
                  activePage==="relatorios"?"Relatórios detalhados da carteira":
                  activePage==="custos"?"Transparência total sobre os custos do serviço e da sua carteira":
                  activePage==="ajuda"?"Perguntas frequentes e recursos":
                  activePage==="ordens"?"Revise o plano e envie as ordens para execução na Interactive Brokers.":
                  "Fale connosco"
                }</p>
              </div>
              {/* ── Global config strip ── */}
              <div className="flex items-center gap-2">
                {/* Perfil de risco */}
                <div className="relative group">
                  <button className="flex items-center gap-2 bg-[#0b0f1a] border border-[#1a1f2e] rounded-lg px-3 py-2 text-xs text-slate-300 hover:border-blue-500/50 transition-colors">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0"/>
                    <span className="text-[10px] text-slate-500 hidden sm:block">Perfil de risco</span>
                    <span className="font-semibold text-slate-200">{riskProfileLocal==="conservador"?"Conservador":riskProfileLocal==="dinamico"?"Dinâmico":"Moderado"}</span>
                    <ChevronDown size={12} className="text-slate-500"/>
                  </button>
                  <div className="absolute right-0 top-full mt-1 z-50 hidden group-hover:block bg-[#0b0f1a] border border-[#1a1f2e] rounded-xl shadow-xl min-w-[140px]">
                    {(["conservador","moderado","dinamico"] as RiskProfile[]).map(p=>(
                      <button key={p} onClick={()=>setRiskProfileLocal(p)} className={`w-full px-4 py-2.5 text-left text-xs hover:bg-white/5 flex items-center gap-2 first:rounded-t-xl last:rounded-b-xl ${riskProfileLocal===p?"text-blue-400 font-bold":"text-slate-300"}`}>
                        {riskProfileLocal===p&&<span className="w-1.5 h-1.5 rounded-full bg-blue-400"/>}
                        {p==="conservador"?"Conservador":p==="dinamico"?"Dinâmico":"Moderado"}
                      </button>
                    ))}
                  </div>
                </div>
                {/* Exposição cambial */}
                <div className="relative group">
                  <button className="flex items-center gap-2 bg-[#0b0f1a] border border-[#1a1f2e] rounded-lg px-3 py-2 text-xs text-slate-300 hover:border-blue-500/50 transition-colors">
                    <ShieldCheck size={12} className="text-blue-400 shrink-0"/>
                    <span className="text-[10px] text-slate-500 hidden sm:block">Exposição cambial</span>
                    <span className="font-semibold text-slate-200">{fxExposure==="protegida"?"Protegida":fxExposure==="parcial"?"Parcial":"Aberta"}</span>
                    <ChevronDown size={12} className="text-slate-500"/>
                  </button>
                  <div className="absolute right-0 top-full mt-1 z-50 hidden group-hover:block bg-[#0b0f1a] border border-[#1a1f2e] rounded-xl shadow-xl min-w-[140px]">
                    {(["protegida","parcial","aberta"] as FxExposure[]).map(fx=>(
                      <button key={fx} onClick={()=>setFxExposure(fx)} className={`w-full px-4 py-2.5 text-left text-xs hover:bg-white/5 flex items-center gap-2 first:rounded-t-xl last:rounded-b-xl ${fxExposure===fx?"text-blue-400 font-bold":"text-slate-300"}`}>
                        {fxExposure===fx&&<span className="w-1.5 h-1.5 rounded-full bg-blue-400"/>}
                        {fx==="protegida"?"Protegida (Hedge ~90%)":fx==="parcial"?"Parcial (Hedge ~50%)":"Aberta (Sem hedge)"}
                      </button>
                    ))}
                  </div>
                </div>
                {/* Uso de margem */}
                <div className="relative group">
                  <button className="flex items-center gap-2 bg-[#0b0f1a] border border-[#1a1f2e] rounded-lg px-3 py-2 text-xs text-slate-300 hover:border-blue-500/50 transition-colors">
                    <Activity size={12} className={marginEnabled?"text-amber-400":"text-slate-500"} />
                    <span className="text-[10px] text-slate-500 hidden sm:block">Uso de margem</span>
                    <span className={`font-semibold ${marginEnabled?"text-amber-400":"text-slate-200"}`}>{marginEnabled?"Ativado":"Desativado"}</span>
                    <ChevronDown size={12} className="text-slate-500"/>
                  </button>
                  <div className="absolute right-0 top-full mt-1 z-50 hidden group-hover:block bg-[#0b0f1a] border border-[#1a1f2e] rounded-xl shadow-xl min-w-[180px] p-3">
                    <div className="text-[10px] text-slate-500 mb-2">Uso de margem (avançado)</div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs text-slate-300">{marginEnabled?"Ativado":"Desativado"}</span>
                      <button onClick={()=>setMarginEnabled(v=>!v)} className={`relative w-10 h-5 rounded-full transition-colors ${marginEnabled?"bg-amber-500":"bg-slate-700"}`}>
                        <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${marginEnabled?"translate-x-5":"translate-x-0.5"}`}/>
                      </button>
                    </div>
                    {marginEnabled&&<div className="flex items-start gap-1.5 bg-amber-500/10 border border-amber-500/20 rounded-lg p-2">
                      <AlertTriangle size={10} className="text-amber-400 mt-0.5 shrink-0"/>
                      <div className="text-[9px] text-amber-300 leading-relaxed">A utilização de margem aumenta o risco da carteira e pode amplificar perdas.</div>
                    </div>}
                  </div>
                </div>
                {/* Date */}
                <div className="flex items-center gap-2 bg-[#0b0f1a] border border-[#1a1f2e] rounded-lg px-3 py-2">
                  <span className="text-[10px] text-slate-300">📅</span>
                  <span className="text-xs text-slate-300 font-medium">{new Date().toLocaleDateString("pt-PT",{month:"long",year:"numeric"}).replace(/^\w/,c=>c.toUpperCase())}</span>
                </div>
                {/* Config bell/settings */}
                <button onClick={()=>setConfigPanelOpen(true)}
                  className="relative p-2 bg-[#0b0f1a] border border-[#1a1f2e] rounded-lg hover:border-blue-500/50 transition-colors">
                  <Bell size={16} className="text-slate-400"/>
                </button>
                <button onClick={()=>setConfigPanelOpen(true)}
                  className="p-2 bg-[#0b0f1a] border border-[#1a1f2e] rounded-lg hover:border-blue-500/50 transition-colors">
                  <Sliders size={16} className="text-slate-400"/>
                </button>
                {loggedIn ? (
                  <button onClick={()=>void router.push("/client/logout")}
                    className="flex items-center gap-2 px-3 py-2 text-slate-400 hover:text-slate-200 text-xs rounded-lg border border-[#1a1f2e] hover:bg-white/5 transition-colors">
                    <LogOut size={13}/>Sair
                  </button>
                ) : (
                  <button onClick={()=>setShowRegModal(true)}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold rounded-lg transition-colors shadow-lg shadow-blue-900/30">
                    Criar conta
                  </button>
                )}
              </div>
            </div>

            {/* ── Config side panel overlay ── */}
            {configPanelOpen&&(
              <div className="fixed inset-0 z-50 flex" onClick={()=>setConfigPanelOpen(false)}>
                <div className="flex-1"/>
                <div className="w-80 bg-[#07090f] border-l border-[#1a1f2e] h-full overflow-y-auto shadow-2xl" onClick={e=>e.stopPropagation()}>
                  <div className="flex items-center justify-between px-5 py-4 border-b border-[#1a1f2e]">
                    <span className="font-bold text-slate-100 text-sm">Configurações</span>
                    <button onClick={()=>setConfigPanelOpen(false)} className="p-1.5 rounded-lg hover:bg-white/10 text-slate-400"><X size={16}/></button>
                  </div>
                  <div className="p-5 space-y-6">
                    {/* Perfil de risco */}
                    <div>
                      <div className="flex items-center gap-1.5 mb-3">
                        <span className="text-[11px] font-bold text-slate-300 uppercase tracking-wide">Perfil de risco</span>
                        <Info size={11} className="text-slate-600"/>
                      </div>
                      <div className="text-[10px] text-slate-500 mb-3">Define o nível de risco da sua carteira. A alocação e as recomendações são ajustadas automaticamente.</div>
                      <div className="grid grid-cols-3 gap-2">
                        {([
                          {id:"conservador" as RiskProfile, label:"Conservador", icon:"🛡️", desc:"Menor volatilidade\nMesma carteira\nEscalada a 0,75×", range:`~${((perfData?.curVol??14)*0.75).toFixed(1)}% vol aa`},
                          {id:"moderado"    as RiskProfile, label:"Moderado",    icon:"⚖️", desc:"Vol base do modelo\nAções globais + XEON\nSem ajuste", range:`~${(perfData?.curVol??14).toFixed(1)}% vol aa`},
                          {id:"dinamico"    as RiskProfile, label:"Dinâmico",    icon:"🚀", desc:"Maior exposição\nMesma carteira\nEscalada a 1,25×", range:`~${((perfData?.curVol??14)*1.25).toFixed(1)}% vol aa`},
                        ]).map(p=>(
                          <button key={p.id} onClick={()=>setRiskProfileLocal(p.id)}
                            className={`relative rounded-xl p-3 border-2 text-left transition-all ${riskProfileLocal===p.id?"border-blue-500 bg-blue-500/[0.08]":"border-[#1a1f2e] bg-[#0b0f1a] hover:border-blue-500/30"}`}>
                            {riskProfileLocal===p.id&&<CheckCircle2 size={12} className="text-blue-400 absolute top-2 right-2"/>}
                            <div className="text-lg mb-1">{p.icon}</div>
                            <div className={`text-[11px] font-bold mb-1 ${riskProfileLocal===p.id?"text-blue-300":"text-slate-200"}`}>{p.label}</div>
                            <div className="text-[8px] text-slate-500 whitespace-pre-line leading-relaxed mb-1">{p.desc}</div>
                            <div className="text-[8px] text-slate-600">{p.range}</div>
                          </button>
                        ))}
                      </div>
                    </div>
                    {/* FX */}
                    <div>
                      <div className="flex items-center gap-1.5 mb-3">
                        <span className="text-[11px] font-bold text-slate-300 uppercase tracking-wide">Exposição cambial</span>
                        <Info size={11} className="text-slate-600"/>
                      </div>
                      <div className="text-[10px] text-slate-500 mb-3">Escolha o nível de protecção cambial da sua carteira.</div>
                      <div className="grid grid-cols-3 gap-2">
                        {([
                          {id:"protegida" as FxExposure, label:"Protegida", sub:"Hedge ~90%"},
                          {id:"parcial"   as FxExposure, label:"Parcial",   sub:"Hedge ~50%"},
                          {id:"aberta"    as FxExposure, label:"Aberta",    sub:"Sem hedge"},
                        ]).map(fx=>(
                          <button key={fx.id} onClick={()=>setFxExposure(fx.id)}
                            className={`rounded-xl p-3 border-2 text-center transition-all ${fxExposure===fx.id?"border-blue-500 bg-blue-500/[0.08]":"border-[#1a1f2e] bg-[#0b0f1a] hover:border-blue-500/30"}`}>
                            <div className={`text-[11px] font-bold mb-0.5 ${fxExposure===fx.id?"text-blue-300":"text-slate-200"}`}>{fx.label}</div>
                            <div className="text-[9px] text-slate-500">{fx.sub}</div>
                          </button>
                        ))}
                      </div>
                    </div>
                    {/* Margem */}
                    <div>
                      <div className="flex items-center gap-1.5 mb-2">
                        <span className="text-[11px] font-bold text-slate-300 uppercase tracking-wide">Uso de margem (avançado)</span>
                        <Info size={11} className="text-slate-600"/>
                      </div>
                      <div className="text-[10px] text-slate-500 mb-3">Permite utilizar margem para aumentar a exposição da carteira.</div>
                      <div className="flex items-center justify-between bg-[#0b0f1a] border border-[#1a1f2e] rounded-xl px-4 py-3 mb-2">
                        <span className="text-xs text-slate-300">{marginEnabled?"Margem ativada":"Margem desativada"}</span>
                        <button onClick={()=>setMarginEnabled(v=>!v)} className={`relative w-11 h-6 rounded-full transition-colors ${marginEnabled?"bg-amber-500":"bg-slate-700"}`}>
                          <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${marginEnabled?"translate-x-5":"translate-x-0.5"}`}/>
                        </button>
                      </div>
                      {marginEnabled&&(
                        <div className="flex items-start gap-2 bg-amber-500/[0.08] border border-amber-500/20 rounded-xl p-3">
                          <AlertTriangle size={12} className="text-amber-400 shrink-0 mt-0.5"/>
                          <div className="text-[10px] text-amber-300 leading-relaxed">A utilização de margem aumenta o risco da carteira e pode amplificar perdas.</div>
                        </div>
                      )}
                    </div>
                    {/* KPIs e simulações */}
                    <div>
                      <div className="flex items-center gap-1.5 mb-3">
                        <span className="text-[11px] font-bold text-slate-300 uppercase tracking-wide">KPIs e simulações</span>
                        <Info size={11} className="text-slate-600"/>
                      </div>
                      <div className="text-[10px] text-slate-500 mb-3">Escolha como deseja visualizar os indicadores e simulações.</div>
                      <div className="grid grid-cols-2 gap-2">
                        {([
                          {id:"base"   as KpiMode, label:"Base (sem margem)", sub:"Mais conservador"},
                          {id:"margem" as KpiMode, label:"Com margem (ilustrativo)", sub:"Maior potencial de retorno"},
                        ]).map(k=>(
                          <button key={k.id} onClick={()=>setKpiMode(k.id)}
                            className={`rounded-xl p-3 border-2 text-left transition-all ${kpiMode===k.id?"border-blue-500 bg-blue-500/[0.08]":"border-[#1a1f2e] bg-[#0b0f1a] hover:border-blue-500/30"}`}>
                            <div className={`text-[11px] font-bold mb-0.5 ${kpiMode===k.id?"text-blue-300":"text-slate-200"}`}>{k.label}</div>
                            <div className="text-[9px] text-slate-500">{k.sub}</div>
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="border-t border-[#1a1f2e] pt-4">
                      <div className="flex items-start gap-2 text-[9px] text-slate-500 leading-relaxed">
                        <Info size={10} className="shrink-0 mt-0.5 text-slate-600"/>
                        Todas as configurações podem ser alteradas a qualquer momento. As alterações serão aplicadas às próximas recomendações.
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            <div className="px-8 py-6 space-y-5">


              {/* ── RELATÓRIOS ── */}
              {activePage==="relatorios"&&(
                <div className="bg-[#0b0f1a] border border-[#1a1f2e] rounded-xl p-8 text-center">
                  <div className="text-4xl mb-3">📄</div>
                  <div className="text-slate-200 font-bold text-lg mb-2">Relatórios</div>
                  <div className="text-slate-500 text-sm">Em breve: relatórios mensais, anuais e fiscais da sua carteira.</div>
                </div>
              )}

              {/* ── DASHBOARD ── */}
              {activePage==="dashboard"&&(
                <div className="space-y-4">
                  {/* ── KPI header with refresh button ── */}
                  <div className="flex items-center justify-between -mb-2">
                    <div className="text-[10px] text-slate-500">
                      Perfil activo: <span className="font-bold text-slate-300">{profileLabel}</span>
                      {" · "}Vol: <span className="font-bold text-amber-400">{scaledVol>0?scaledVol.toFixed(1)+"%":"—"}</span>
                      {" · "}Factor: <span className="font-bold text-blue-400">{profileFactor}×</span>
                    </div>
                    <button
                      onClick={()=>{ setRiskProfileLocal(riskProfileLocal); }}
                      className="flex items-center gap-1.5 px-3 py-1 text-[10px] font-semibold text-slate-400 hover:text-slate-200 border border-[#1a1f2e] hover:border-blue-500/40 rounded-lg bg-[#0b0f1a] transition-colors">
                      ↻ Actualizar KPIs
                    </button>
                  </div>

                  {/* ── 5 KPI cards — profileFactor applied at component level ── */}
                  {(()=>{
                    const fmtP=(v:number,s=false)=>`${s&&v>=0?"+":""}${v.toFixed(2)}%`;
                    const fmtE=(v:number)=>v.toLocaleString("pt-PT",{minimumFractionDigits:2,maximumFractionDigits:2});
                    const pfLabel=profileFactor<1?"0,75×":profileFactor>1?"1,25×":"1×";
                    return (
                      <div className="grid grid-cols-5 gap-3">
                        {[
                          {label:"Valor da carteira",val:`€ ${fmtE(aum)}`,sub:"Património total",
                           icon:<div className="text-blue-400 text-lg">📦</div>,c:"text-slate-100"},
                          {label:"Variação (YTD)",val:fmtP(scaledYtd,true),sub:`${scaledYtd>=0?"+ €":"- €"} ${fmtE(Math.abs(aum*scaledYtd/100))} · ${pfLabel}`,
                           icon:<TrendingUp size={16} className="text-emerald-400"/>,c:scaledYtd>=0?"text-emerald-400":"text-red-400"},
                          {label:"Retorno desde início",val:fmtP(scaledTotal,true),sub:`CAGR ${fmtP(scaledAnn,true)} · ${pfLabel}`,
                           icon:<Activity size={16} className="text-blue-400"/>,c:scaledTotal>=0?"text-emerald-400":"text-red-400"},
                          {label:"Risco (Volatilidade anual)",val:scaledVol>0?`${scaledVol.toFixed(1)}%`:"—",
                           sub:`${pfLabel} vol base · Perfil ${profileLabel}`,
                           icon:<ShieldCheck size={16} className="text-amber-400"/>,c:"text-amber-400"},
                          {label:"Máximo drawdown",val:scaledDD!==0?fmtP(scaledDD):"—",
                           sub:`${pfLabel} · Perfil ${profileLabel}`,
                           icon:<TrendingDown size={16} className="text-red-400"/>,c:"text-red-400"},
                        ].map(k=>(
                          <div key={k.label} className="bg-[#0b0f1a] border border-[#1a1f2e] rounded-xl p-4">
                            <div className="flex items-center justify-between mb-2">
                              <div className="text-[10px] text-slate-500 font-semibold leading-tight">{k.label}</div>
                              {k.icon}
                            </div>
                            <div className={`text-xl font-black mb-0.5 ${k.c}`}>{k.val}</div>
                            <div className="text-[10px] text-slate-500">{k.sub}</div>
                          </div>
                        ))}
                      </div>
                    );
                  })()}

                  {/* ── Row 2: action-count badges + últimas recomendações ── */}
                  <div className="grid grid-cols-3 gap-4">

                    {/* Últimas recomendações (2/3) */}
                    <div className="col-span-2 bg-[#0b0f1a] border border-[#1a1f2e] rounded-xl p-5">
                      <div className="flex items-center justify-between mb-3">
                        <div className="font-bold text-slate-200 text-sm flex items-center gap-2">Últimas recomendações<Info size={12} className="text-slate-600"/></div>
                        <button onClick={()=>setActivePage("reco")} className="text-[10px] text-blue-400 hover:underline flex items-center gap-1">Ver todas<ArrowUpRight size={11}/></button>
                      </div>
                      {recoLoading?(
                        <div className="text-slate-500 text-sm text-center py-4">A carregar…</div>
                      ):(
                        <table className="w-full text-xs">
                          <thead><tr className="text-slate-500 border-b border-[#1a1f2e] text-left">
                            <th className="pb-2 font-semibold">Ativo</th>
                            <th className="pb-2 font-semibold">Ação</th>
                            <th className="pb-2 font-semibold text-right">Δ Peso</th>
                            <th className="pb-2 font-semibold text-right">Estado</th>
                          </tr></thead>
                          <tbody>
                            {actionCounts.rows.slice(0,7).map(r=>{
                              const isBuy=r.action==="Comprar"; const isUp=r.action==="Aumentar";
                              const isSell=r.action==="Vender"; const isDown=r.action==="Reduzir";
                              const acColor=isBuy?"bg-emerald-500/20 text-emerald-300 border border-emerald-500/30":isUp?"bg-cyan-500/20 text-cyan-300 border border-cyan-500/30":isSell?"bg-red-500/20 text-red-300 border border-red-500/30":isDown?"bg-amber-500/20 text-amber-300 border border-amber-500/30":"bg-slate-700/40 text-slate-400";
                              const acIcon=isBuy?"↑":isUp?"↗":isSell?"↓":isDown?"↙":"→";
                              return (
                                <tr key={r.ticker} className="border-b border-[#111520] hover:bg-white/[0.02]">
                                  <td className="py-2">
                                    <a href={`https://finance.yahoo.com/quote/${getYFTicker(r.ticker)}`} target="_blank" rel="noopener noreferrer" className="font-bold text-blue-400 hover:underline">{r.ticker}</a>
                                    {getCompany(r.ticker)&&<span className="ml-1 text-slate-500 text-[10px]">{getCompany(r.ticker)}</span>}
                                  </td>
                                  <td className="py-2">
                                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${acColor}`}>
                                      <span className="font-black">{acIcon}</span>{r.action}
                                    </span>
                                  </td>
                                  <td className="py-2 text-right text-slate-400">{r.delta>0?"+":""}{r.delta.toFixed(2)}%</td>
                                  <td className="py-2 text-right"><span className={`px-2 py-0.5 rounded-full text-[10px] ${loggedIn?"bg-emerald-500/20 text-emerald-300":"bg-amber-500/20 text-amber-300"}`}>{loggedIn?"Aplicada":"Pendente"}</span></td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      )}
                    </div>

                    {/* Action count badges (1/3) */}
                    <div className="space-y-3">
                      {(()=>{
                        const buy =actionCounts.comprar;
                        const up  =actionCounts.aumentar;
                        const down=actionCounts.reduzir;
                        const sell=actionCounts.vender;
                        const hold=actionCounts.manter;
                        return [
                          {label:"Comprar",  n:buy,  icon:"↑",  bg:"bg-emerald-500/10", border:"border-emerald-500/25", tc:"text-emerald-300", nc:"text-emerald-400"},
                          {label:"Aumentar", n:up,   icon:"↗",  bg:"bg-cyan-500/10",    border:"border-cyan-500/25",    tc:"text-cyan-300",    nc:"text-cyan-400"},
                          {label:"Reduzir",  n:down, icon:"↙",  bg:"bg-amber-500/10",   border:"border-amber-500/25",   tc:"text-amber-300",   nc:"text-amber-400"},
                          {label:"Vender",   n:sell, icon:"↓",  bg:"bg-red-500/10",     border:"border-red-500/25",     tc:"text-red-300",     nc:"text-red-400"},
                          {label:"Manter",   n:hold, icon:"→",  bg:"bg-slate-700/30",   border:"border-slate-600/30",   tc:"text-slate-400",   nc:"text-slate-300"},
                        ].map(x=>(
                          <div key={x.label} className={`flex items-center justify-between rounded-xl px-4 py-3 ${x.bg} border ${x.border}`}>
                            <div className="flex items-center gap-2">
                              <span className={`text-lg font-black leading-none ${x.nc}`}>{x.icon}</span>
                              <span className={`text-xs font-semibold ${x.tc}`}>{x.label}</span>
                            </div>
                            <span className={`text-2xl font-black ${x.nc}`}>{x.n}</span>
                          </div>
                        ));
                      })()}
                    </div>
                  </div>

                  {/* ── Row 3: charts side by side ── */}
                  <div className="grid grid-cols-3 gap-4">

                    {/* Performance chart (2/3) */}
                    <div className="col-span-2 bg-[#0b0f1a] border border-[#1a1f2e] rounded-xl p-5">
                      <div className="flex items-center justify-between mb-3">
                        <div className="font-bold text-slate-200 text-sm flex items-center gap-2">Evolução da carteira<Info size={12} className="text-slate-600"/></div>
                        <div className="flex items-center gap-3">
                          {perfData&&(
                            <div className="flex gap-4 mr-2">
                              <div className="text-right">
                                <div className="text-[9px] text-slate-500">YTD</div>
                                <div className={`font-black text-sm ${scaledYtd>=0?"text-emerald-400":"text-red-400"}`}>{scaledYtd>=0?"+":""}{scaledYtd.toFixed(2)}%</div>
                              </div>
                              <div className="text-right">
                                <div className="text-[9px] text-slate-500">CAGR</div>
                                <div className={`font-black text-sm ${scaledAnn>=0?"text-emerald-400":"text-red-400"}`}>{scaledAnn>=0?"+":""}{scaledAnn.toFixed(2)}%</div>
                              </div>
                              <div className="text-right">
                                <div className="text-[9px] text-slate-500">Sharpe</div>
                                <div className="font-black text-sm text-slate-100">{perfData.m.shp.toFixed(2)}</div>
                              </div>
                            </div>
                          )}
                          <div className="flex gap-1">
                            {(["YTD","1 Ano","3 Anos","20 Anos"] as Period[]).map(p=>(
                              <button key={p} onClick={()=>setPeriod(p)}
                                className={`px-2 py-1 text-[10px] font-semibold rounded transition-colors ${period===p?"bg-blue-600 text-white":"text-slate-400 hover:text-slate-200"}`}>{p==="20 Anos"?"Início":p}</button>
                            ))}
                          </div>
                        </div>
                      </div>
                      <ResponsiveContainer width="100%" height={190}>
                        <LineChart data={perfData?.chart??[]} margin={{top:4,right:8,left:-4,bottom:0}}>
                          <XAxis dataKey="date" tick={{fontSize:9,fill:"#64748b"}} tickLine={false} axisLine={false} interval={Math.floor((perfData?.chart.length??1)/6)}/>
                          <YAxis scale="log" domain={["auto","auto"]} allowDataOverflow tick={{fontSize:9,fill:"#64748b"}} tickLine={false} axisLine={false} tickFormatter={v=>{const r=(Number(v)/100-1)*100;return `${r>=0?"+":""}${r.toFixed(0)}%`;}} width={44}/>
                          <Tooltip content={<PerfTooltip/>}/>
                          <ReferenceLine y={100} stroke="#334155" strokeDasharray="3 3"/>
                          <Line type="monotone" dataKey="modelo" stroke="#60a5fa" strokeWidth={2} dot={false} name="A sua carteira"/>
                          <Line type="monotone" dataKey="bench" stroke="#475569" strokeWidth={1.5} dot={false} name={BENCH_SHORT} strokeDasharray="4 2"/>
                        </LineChart>
                      </ResponsiveContainer>
                      <div className="flex items-center gap-4 mt-2">
                        <div className="flex items-center gap-2 text-[10px] text-slate-400"><div className="w-4 h-0.5 bg-blue-400 rounded"/>A sua carteira</div>
                        <div className="flex items-center gap-2 text-[10px] text-slate-400"><div className="w-4 h-px bg-slate-500 rounded"/>Benchmark (60/40)</div>
                      </div>
                    </div>

                    {/* Allocation donut (1/3) */}
                    <div className="bg-[#0b0f1a] border border-[#1a1f2e] rounded-xl p-5">
                      <div className="font-bold text-slate-200 text-sm mb-3 flex items-center gap-2">Alocação da carteira<Info size={12} className="text-slate-600"/></div>
                      {sectorData.length>0?(
                        <div className="flex flex-col items-center gap-3">
                          <div className="relative">
                            <ResponsiveContainer width={130} height={130}>
                              <PieChart>
                                <Pie data={sectorData.slice(0,6)} cx="50%" cy="50%" innerRadius={38} outerRadius={60} dataKey="value" strokeWidth={0} paddingAngle={2}>
                                  {sectorData.slice(0,6).map((_,i)=><Cell key={i} fill={PIE_COLORS[i%PIE_COLORS.length]}/>)}
                                </Pie>
                                <Tooltip formatter={(v:number)=>`${v}%`} contentStyle={{background:"#1e293b",border:"1px solid #334155",borderRadius:8,fontSize:11}}/>
                              </PieChart>
                            </ResponsiveContainer>
                            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                              <div className="text-[10px] font-bold text-slate-200">{aum.toLocaleString("pt-PT",{maximumFractionDigits:0})}</div>
                              <div className="text-[8px] text-slate-500">Total</div>
                            </div>
                          </div>
                          <div className="w-full space-y-1.5">
                            {sectorData.slice(0,6).map((s,i)=>(
                              <div key={s.name} className="flex items-center justify-between text-[10px]">
                                <div className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-sm shrink-0" style={{background:PIE_COLORS[i%PIE_COLORS.length]}}/><span className="text-slate-400">{s.name}</span></div>
                                <span className="text-slate-300 font-semibold">{s.value}%</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      ):(
                        <div className="text-slate-500 text-xs text-center py-8">A carregar…</div>
                      )}
                    </div>
                  </div>

                  {/* ── Row 4: positions + profile summary ── */}
                  <div className="grid grid-cols-3 gap-4">

                    {/* Principais posições (2/3) */}
                    <div className="col-span-2 bg-[#0b0f1a] border border-[#1a1f2e] rounded-xl p-5">
                      <div className="flex items-center justify-between mb-3">
                        <div className="font-bold text-slate-200 text-sm">Principais posições</div>
                        <button onClick={()=>setActivePage("carteira")} className="text-[10px] text-blue-400 hover:underline">Ver carteira completa</button>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        {(latestMonth?.rows??[])
                          .filter(r=>r.weightPct>=1&&r.ticker!=="TBILL_PROXY"&&!r.ticker.startsWith("CASH")&&!r.ticker.startsWith("TBILL"))
                          .sort((a,b)=>b.weightPct-a.weightPct).slice(0,6).map((r,i)=>{
                            const acRow=actionCounts.rows.find(x=>x.ticker===r.ticker);
                            const acIcon=acRow?.action==="Comprar"?"↑":acRow?.action==="Aumentar"?"↗":acRow?.action==="Vender"?"↓":acRow?.action==="Reduzir"?"↙":null;
                            const acClr=acRow?.action==="Comprar"?"text-emerald-400":acRow?.action==="Aumentar"?"text-cyan-400":acRow?.action==="Vender"?"text-red-400":acRow?.action==="Reduzir"?"text-amber-400":"";
                            return (
                              <div key={r.ticker} className="flex items-center justify-between bg-[#111827] rounded-lg px-3 py-2">
                                <div className="flex items-center gap-2">
                                  <div className="w-2 h-2 rounded-full shrink-0" style={{background:PIE_COLORS[i%PIE_COLORS.length]}}/>
                                  <div>
                                    <div className="text-[11px] font-bold text-slate-200 flex items-center gap-1">
                                      {getCompany(r.ticker)||r.ticker}
                                      {acIcon&&<span className={`text-[11px] font-black ${acClr}`}>{acIcon}</span>}
                                    </div>
                                    <div className="text-[9px] text-slate-500">{r.ticker} · {getSector(r.ticker)}</div>
                                  </div>
                                </div>
                                <span className="text-[11px] font-bold text-slate-300">{r.weightPct.toFixed(1)}%</span>
                              </div>
                            );
                          })}
                      </div>
                    </div>

                    {/* Resumo do perfil (1/3) */}
                    <div className="bg-[#0b0f1a] border border-[#1a1f2e] rounded-xl p-5">
                      <div className="font-bold text-slate-200 text-sm mb-3 flex items-center gap-2">
                        Perfil {riskProfileLocal==="conservador"?"Conservador":riskProfileLocal==="dinamico"?"Dinâmico":"Moderado"}
                        <Info size={12} className="text-slate-600"/>
                      </div>
                      {[
                        {icon:"🎯",label:"Objetivo",val:riskProfileLocal==="conservador"?"Crescimento com menor volatilidade (0,75× vol base)":riskProfileLocal==="dinamico"?"Máximo potencial de retorno (1,25× vol base)":"Equilíbrio risco/retorno (vol base do modelo)"},
                        {icon:"📊",label:"Volatilidade alvo",val:`~${scaledVol.toFixed(1)}% aa (${profileFactor<1?"0,75×":profileFactor>1?"1,25×":"1×"} vol do modelo)`},
                        {icon:"⏳",label:"Horizonte",val:"Médio / Longo prazo (3+ anos)"},
                        {icon:"🌍",label:"Composição",val:"Ações globais + XEON (MM Euro)"},
                      ].map(x=>(
                        <div key={x.label} className="flex items-start gap-2 mb-3 last:mb-0">
                          <span className="text-sm shrink-0 mt-0.5">{x.icon}</span>
                          <div>
                            <div className="text-[10px] text-slate-500 font-semibold">{x.label}</div>
                            <div className="text-[11px] text-slate-300 leading-snug">{x.val}</div>
                          </div>
                        </div>
                      ))}
                      <button onClick={()=>setConfigPanelOpen(true)} className="mt-2 text-[10px] text-blue-400 hover:underline">Saiba mais sobre os perfis →</button>
                    </div>
                  </div>

                  {/* ── Simulador integrado ── */}
                  <div className="bg-[#0b0f1a] border border-[#1a1f2e] rounded-xl overflow-hidden">
                    <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-[#1a1f2e]">
                      <div className="flex items-center gap-2">
                        <Activity size={14} className="text-blue-400"/>
                        <h2 className="text-slate-200 text-sm font-bold tracking-wide">Simulação de Capital</h2>
                        <Info size={12} className="text-slate-500"/>
                      </div>
                      {!loggedIn&&(
                        <button onClick={()=>setShowRegModal(true)}
                          className="text-xs px-3 py-1.5 bg-blue-600/20 hover:bg-blue-600/30 border border-blue-500/30 text-blue-400 rounded-lg font-semibold transition-colors">
                          Guardar simulação →
                        </button>
                      )}
                    </div>
                    <div className="px-5 py-4">
                      <NativeSimulator dates={dates} equity={equityRaw} bench={benchRaw}
                        onRegister={()=>setShowRegModal(true)} loggedIn={loggedIn}/>
                    </div>
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
                  <div className="ml-auto flex flex-col gap-2 min-w-[220px]">
                    {loggedIn ? (
                      <button onClick={()=>setActivePage("ordens")}
                        className="relative bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-bold px-6 py-3 rounded-xl flex items-center justify-center gap-2 transition-all shadow-lg shadow-emerald-900/50 ring-1 ring-emerald-500/40 hover:shadow-emerald-800/60 hover:scale-[1.02] active:scale-100">
                        <CheckCircle2 size={16}/> Aprovar Plano
                      </button>
                    ) : (
                      <button onClick={()=>setShowRegModal(true)}
                        className="relative bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-bold px-6 py-3 rounded-xl flex items-center justify-center gap-2 transition-all shadow-lg shadow-emerald-900/50 ring-1 ring-emerald-500/40 hover:shadow-emerald-800/60 hover:scale-[1.02] active:scale-100">
                        <CheckCircle2 size={16}/> Aprovar Plano
                      </button>
                    )}
                    <button onClick={()=>setActivePage("carteira")} className="bg-[#111827] border border-[#252a3a] hover:bg-[#151929] text-slate-300 text-xs font-semibold px-4 py-2.5 rounded-lg transition-colors">
                      Ver carteira completa
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

              {/* O que mudou (full width) */}
              <div className="bg-[#0b0f1a] border border-[#1a1f2e] rounded-xl p-5">
                <SH title="O que mudou"/>
                <div className="grid grid-cols-2 gap-6 mt-3">
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

              {/* Recomendações completas */}
              <div className="bg-[#0b0f1a] border border-[#1a1f2e] rounded-xl p-5">
                <div className="flex items-center justify-between mb-4">
                  <SH title="Recomendações"/>
                  <span className="text-slate-500 text-xs -mt-4">{actionCounts.allRows.length} posições</span>
                </div>
                {recoLoading?(
                  <div className="text-slate-500 text-sm text-center py-6">A carregar…</div>
                ):actionCounts.allRows.length===0?(
                  <div className="text-slate-500 text-sm text-center py-6">Sem recomendações este mês</div>
                ):(
                  <table className="w-full text-xs">
                    <thead><tr className="text-slate-500 border-b border-[#1a1f2e]">
                      <th className="text-left pb-2 font-semibold">Ativo</th>
                      <th className="text-left pb-2 font-semibold">Setor</th>
                      <th className="text-left pb-2 font-semibold">País</th>
                      <th className="text-right pb-2 font-semibold">Actual</th>
                      <th className="text-right pb-2 font-semibold">Novo</th>
                      <th className="text-right pb-2 font-semibold">&#916;</th>
                      <th className="text-right pb-2 font-semibold">Ação</th>
                    </tr></thead>
                    <tbody>
                      {actionCounts.allRows.map(r=>{
                        const ac=r.action==="Comprar"?"text-emerald-400":r.action==="Aumentar"?"text-cyan-400":r.action==="Vender"?"text-red-400":r.action==="Reduzir"?"text-amber-400":"text-slate-400";
                        const dc=r.delta>0?"text-emerald-400":r.delta<0?"text-red-400":"text-slate-500";
                        const isXeon=r.ticker==="XEON";
                        const rowBg=isXeon?"bg-slate-800/30 border-t border-[#1a1f2e]":r.action==="Comprar"?"bg-emerald-950/20":r.action==="Aumentar"?"bg-cyan-950/20":r.action==="Vender"?"bg-red-950/20":r.action==="Reduzir"?"bg-amber-950/10":"";
                        return (
                          <tr key={r.ticker} className={`border-b border-[#111520] hover:bg-white/[0.03] ${rowBg}`}>
                            <td className="py-2">
                              {isXeon?(
                                <span className="font-bold text-slate-300">{r.ticker}</span>
                              ):(
                                <a href={`https://finance.yahoo.com/quote/${getYFTicker(r.ticker)}`} target="_blank" rel="noopener noreferrer"
                                  className="font-bold text-blue-400 hover:text-blue-300 hover:underline">{r.ticker}</a>
                              )}
                              {getCompany(r.ticker)&&<span className="ml-1.5 text-slate-500 font-normal">{getCompany(r.ticker)}</span>}
                            </td>
                            <td className="py-2 text-slate-400">{getSector(r.ticker)}</td>
                            <td className="py-2 text-slate-400">{getZone(r.ticker)}</td>
                            <td className="py-2 text-right text-slate-300">{r.prev>0?`${r.prev.toFixed(1)}%`:"—"}</td>
                            <td className="py-2 text-right text-slate-200 font-semibold">{r.cur>0?`${r.cur.toFixed(1)}%`:"—"}</td>
                            <td className={`py-2 text-right font-semibold ${dc}`}>{r.delta!==0?`${r.delta>0?"+":""}${r.delta.toFixed(1)}%`:"—"}</td>
                            <td className={`py-2 text-right font-bold ${ac}`}>{r.action}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
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
                    <div className="flex items-center justify-between mb-4">
                      <div className="font-bold text-slate-200 text-sm">Posições actuais</div>
                      <div className="flex items-center gap-3">
                        {pricesLoading&&<span className="text-slate-500 text-[10px]">A carregar preços…</span>}
                        <label className="flex items-center gap-2 text-xs text-slate-400">
                          Carteira (€)
                          <input type="number" value={aum} onChange={e=>setAum(Number(e.target.value)||100000)}
                            className="w-28 bg-[#111827] border border-[#252a3a] text-slate-200 text-xs rounded-lg px-2 py-1 outline-none focus:border-blue-500"
                            min={1000} step={1000}/>
                        </label>
                      </div>
                    </div>
                    <table className="w-full text-xs">
                      <thead><tr className="text-slate-500 border-b border-[#1a1f2e] font-semibold">
                        <th className="text-left pb-2">Ativo</th>
                        <th className="text-left pb-2">Nome</th>
                        <th className="text-left pb-2">Setor</th>
                        <th className="text-left pb-2">País</th>
                        <th className="text-right pb-2">Anterior</th>
                        <th className="text-right pb-2">Actual</th>
                        <th className="text-right pb-2">&#916;</th>
                        <th className="text-right pb-2">Preço</th>
                        <th className="text-right pb-2">Nº Acções</th>
                      </tr></thead>
                      <tbody>
                        {(()=>{
                          // ── build raw equity rows from ALL model positions ──────────────
                          const pm=new Map((sortedMonths[sortedMonths.length-2]?.rows??[]).map((x:any)=>[x.ticker,x.weightPct??0]));
                          const rawEquityRows=(latestMonth?.rows??[])
                            .filter((r:any)=>r.ticker!=="XEON"&&!r.ticker.startsWith("TBILL")&&!r.ticker.startsWith("CASH")&&r.ticker!=="TBILL_PROXY")
                            .map((r:any)=>{
                              const cur:number=r.weightPct??0;
                              const prev:number=pm.get(r.ticker)??0;
                              const action=actionCounts.allRows.find((x:any)=>x.ticker===r.ticker)?.action??"Manter";
                              return {ticker:r.ticker,cur,prev,action};
                            })
                            .filter((r:any)=>r.cur>=0.5);
                          const xeonRaw=latestMonth?.tbillsTotalPct??0;
                          const xeonPrev=sortedMonths[sortedMonths.length-2]?.tbillsTotalPct??0;

                          // ── normalize weights so equity+XEON = exactly 100% ───────────
                          const rawTotal=rawEquityRows.reduce((s:number,r:any)=>s+r.cur,0)+xeonRaw;
                          const scale=rawTotal>0?100/rawTotal:1;
                          type CartRow={ticker:string;cur:number;prev:number;action:string;special:boolean};
                          const equityNorm:CartRow[]=rawEquityRows.map((r:any)=>({
                            ticker:r.ticker,
                            cur:r.cur*scale,
                            prev:r.prev*scale,
                            action:r.action,
                            special:false,
                          }));
                          const xeonNorm=xeonRaw*scale;
                          const xeonPrevNorm=xeonPrev*scale;

                          // ── filter <1 share when prices are available ─────────────────
                          const hasPrices=!pricesLoading&&Object.values(prices).some(p=>p!==null);

                          // Sum of normalized weights for PRICED equity tickers (to redistribute unpriced weight)
                          const equityPricedWeightSum=equityNorm.reduce((s,r)=>{
                            const p=prices[r.ticker];
                            return s+(p?.price?r.cur:0);
                          },0);
                          const equityTotalNorm=equityNorm.reduce((s,r)=>s+r.cur,0); // = 100 - xeonNorm

                          const equityFiltered=hasPrices?equityNorm.filter(r=>{
                            const p=prices[r.ticker];
                            if(!p?.price) return true; // keep priced-missing rows
                            // effective normalized weight redistributed to priced tickers:
                            const effW=equityPricedWeightSum>0?(r.cur/equityPricedWeightSum)*equityTotalNorm:r.cur;
                            const shares=p.qty!=null?p.qty:(effW/100)*aum/p.price;
                            return shares>=1;
                          }):equityNorm;

                          const usdExposure=equityFiltered.filter(r=>getZone(r.ticker)==="EUA").reduce((s,r)=>s+r.cur,0);
                          const allRows:CartRow[]=[
                            ...equityFiltered,
                            {ticker:"XEON",cur:xeonNorm,prev:xeonPrevNorm,action:"Manter",special:true},
                            {ticker:"EURUSD",cur:usdExposure,prev:usdExposure,action:"Manter",special:true},
                          ];

                          // Recalculate priced equity weight sum after <1 share filter
                          const pricedWsum=equityFiltered.reduce((s,r)=>{
                            const p=prices[r.ticker];
                            return s+(p?.price?r.cur:0);
                          },0);
                          const equityTotalFiltered=equityFiltered.reduce((s,r)=>s+r.cur,0);

                          return allRows.map(r=>{
                            const delta=r.cur-r.prev;
                            const isXeon=r.ticker==="XEON";
                            const isHedge=r.ticker==="EURUSD";
                            return (
                              <tr key={r.ticker} className={`border-b border-[#0f1420] hover:bg-white/[0.02] ${r.special?"bg-slate-800/20":""}`}>
                                <td className="py-2 font-bold">
                                  {isXeon||isHedge?(
                                    <span className="text-slate-300">{isHedge?"EUR/USD":r.ticker}</span>
                                  ):(
                                    <a href={`https://finance.yahoo.com/quote/${getYFTicker(r.ticker)}`} target="_blank" rel="noopener noreferrer"
                                      className="text-blue-400 hover:text-blue-300 hover:underline">{r.ticker}</a>
                                  )}
                                </td>
                                <td className="py-2 text-slate-400">
                                  {isHedge?"Hedge Cambial":isXeon?"MM Euro":getCompany(r.ticker)||"—"}
                                </td>
                                <td className="py-2 text-slate-400">
                                  {isHedge?"Cambial":getSector(r.ticker)}
                                </td>
                                <td className="py-2 text-slate-400">
                                  {isHedge?"Global":getZone(r.ticker)}
                                </td>
                                <td className="py-2 text-right text-slate-300">{r.prev>0?`${r.prev.toFixed(1)}%`:"—"}</td>
                                <td className="py-2 text-right text-white font-semibold">
                                  {isHedge?<span className="text-slate-500 font-normal italic text-[10px]">derivado (~{r.cur.toFixed(0)}% USD)</span>:`${r.cur.toFixed(1)}%`}
                                </td>
                                <td className={`py-2 text-right font-semibold ${isHedge?"text-slate-500":delta>0?"text-emerald-400":delta<0?"text-red-400":"text-slate-500"}`}>
                                  {isHedge?"—":Math.abs(delta)>=0.05?`${delta>0?"+":""}${delta.toFixed(1)}pp`:"—"}
                                </td>
                                {(()=>{
                                  if(isHedge||isXeon) return <><td className="py-2 text-right text-slate-600">—</td><td className="py-2 text-right text-slate-600">—</td></>;
                                  const p=prices[r.ticker];
                                  const priceVal=p?.price;
                                  const ccy=p?.currency??"USD";
                                  const ccySym=ccy==="EUR"?"€":ccy==="GBp"?"p":ccy==="GBP"?"£":"$";
                                  // redistribute unpriced weights to priced tickers for share calculation
                                  const effW=priceVal&&pricedWsum>0?(r.cur/pricedWsum)*equityTotalFiltered:r.cur;
                                  const shares=p?.qty!=null?Math.round(p.qty):priceVal&&effW>0?Math.round((effW/100)*aum/priceVal):null;
                                  return (
                                    <>
                                      <td className="py-2 text-right text-slate-300">
                                        {priceVal?`${ccySym}${priceVal>=1?priceVal.toFixed(2):priceVal.toFixed(4)}`:"—"}
                                      </td>
                                      <td className="py-2 text-right text-slate-200 font-semibold">
                                        {shares!=null?shares.toLocaleString("pt-PT"):"—"}
                                      </td>
                                    </>
                                  );
                                })()}
                              </tr>
                            );
                          });
                        })()}
                        {/* weight total footer – always 100% after normalisation */}
                        <tr className="border-t-2 border-slate-600 bg-slate-800/40">
                          <td colSpan={5} className="py-2 text-right text-slate-400 font-semibold text-xs pr-3">Total</td>
                          <td className="py-2 text-right font-bold text-emerald-400">100.0%</td>
                          <td colSpan={2} className="py-2 text-slate-600 text-xs pl-2">(normalizado)</td>
                        </tr>
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
                    <div className="flex items-center gap-4 mt-3 flex-wrap">
                      <div className="flex items-center gap-2 text-xs text-slate-400"><div className="w-5 h-0.5 bg-blue-400 rounded"/>Modelo</div>
                      <div className="flex items-center gap-2 text-xs text-slate-400"><div className="w-5 h-px bg-slate-400 rounded"/>{BENCH_SHORT}</div>
                      <div className="ml-auto text-[10px] text-slate-600 italic">{BENCH_LABEL}</div>
                    </div>
                  </div>
                  <div className="bg-[#0b0f1a] border border-[#1a1f2e] rounded-xl p-5">
                    <div className="font-bold text-slate-200 text-sm mb-4">Retornos anuais</div>
                    <ResponsiveContainer width="100%" height={260}>
                      <BarChart data={annualReturns} margin={{top:4,right:8,left:8,bottom:24}} barCategoryGap="20%" barGap={1}>
                        <CartesianGrid vertical={false} stroke="#1a1f2e"/>
                        <XAxis dataKey="year" tick={{fontSize:10,fill:"#ffffff",fontWeight:600}} axisLine={false} tickLine={false} angle={-45} textAnchor="end" interval={0} height={40}/>
                        <YAxis tick={{fontSize:10,fill:"#ffffff",fontWeight:500}} axisLine={false} tickLine={false} tickFormatter={v=>`${v}%`} width={44}/>
                        <Tooltip
                          formatter={(v:number,name:string)=>[`${Number(v)>0?"+":""}${Number(v).toFixed(1)}%`, name]}
                          labelStyle={{color:"#ffffff",fontWeight:700,marginBottom:4}}
                          contentStyle={{background:"#1e293b",border:"1px solid #334155",borderRadius:8,fontSize:12,color:"#f1f5f9"}}
                          itemStyle={{color:"#f1f5f9"}}
                          cursor={{fill:"rgba(255,255,255,0.04)"}}
                        />
                        <ReferenceLine y={0} stroke="#334155" strokeWidth={1}/>
                        <Bar dataKey="modelo" name="Modelo" radius={[2,2,0,0]} maxBarSize={24}>
                          {annualReturns.map((r,i)=><Cell key={i} fill={r.modelo>=0?"#3b82f6":"#f87171"}/>)}
                        </Bar>
                        <Bar dataKey="bench" name={BENCH_SHORT} fill="#334155" radius={[2,2,0,0]} maxBarSize={24}/>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}

              {/* ── RISCO ── */}
              {activePage==="risco"&&(()=>{
                const vol=perfData?.curVol??0;
                const dd=perfData?.curDD??0;
                // 20y Sharpe from full data
                const sharpe20=perfData?.m?.shp??riskMetrics?.beta??0;
                // Needle position: vol mapped to 0-1 (0%=low, 30%=high)
                const needlePos=Math.min(Math.max(vol/30,0),1);
                const riskLabel=needlePos<0.4?"Baixo":needlePos<0.7?"Moderado":"Elevado";
                const riskColor=needlePos<0.4?"#22c55e":needlePos<0.7?"#f59e0b":"#ef4444";
                // SVG gauge helpers
                const CX=110,CY=100,R=80,RI=54;
                const pt=(pos:number,r:number)=>({
                  x:CX+r*Math.cos(Math.PI*(1-pos)),
                  y:CY-r*Math.sin(Math.PI*(1-pos)),
                });
                const arc=(s:number,e:number,ro:number,ri:number)=>{
                  const p1=pt(s,ro),p2=pt(e,ro),p3=pt(e,ri),p4=pt(s,ri);
                  const lg=e-s>0.5?1:0;
                  return `M${p1.x},${p1.y} A${ro},${ro} 0 ${lg},0 ${p2.x},${p2.y} L${p3.x},${p3.y} A${ri},${ri} 0 ${lg},1 ${p4.x},${p4.y} Z`;
                };
                const np=pt(needlePos,R-6);
                const nb1=pt(needlePos-0.06,RI+2),nb2=pt(needlePos+0.06,RI+2);
                const date=latestMonth?.date??latestMonth?.rebalance_date??"";
                const dateLabel=date?new Date(date).toLocaleDateString("pt-PT",{month:"short",year:"numeric"}):"";
                return (
                  <div className="space-y-4">
                    {/* ── Top: gauge + metrics ── */}
                    <div className="bg-[#0b0f1a] border border-[#1a1f2e] rounded-xl p-5 flex items-center gap-8">
                      {/* Gauge */}
                      <div className="flex-shrink-0 w-56">
                        <div className="text-[10px] text-slate-500 uppercase tracking-widest mb-1">Nível de risco <span className="ml-1 text-slate-600">{dateLabel}</span></div>
                        <svg viewBox="0 0 220 115" className="w-full">
                          {/* Background arc */}
                          <path d={arc(0,1,R,RI)} fill="#1e293b"/>
                          {/* Coloured segments */}
                          <path d={arc(0,0.38,R,RI)} fill="#22c55e" opacity={0.85}/>
                          <path d={arc(0.38,0.67,R,RI)} fill="#f59e0b" opacity={0.85}/>
                          <path d={arc(0.67,1,R,RI)} fill="#ef4444" opacity={0.85}/>
                          {/* Needle shaft */}
                          <line x1={CX} y1={CY} x2={np.x} y2={np.y} stroke="white" strokeWidth={2.5} strokeLinecap="round" opacity={0.9}/>
                          {/* Needle arrowhead */}
                          <polygon points={`${np.x},${np.y} ${nb1.x},${nb1.y} ${nb2.x},${nb2.y}`} fill="white" opacity={0.95}/>
                          <circle cx={CX} cy={CY} r={6} fill="#0b0f1a" stroke="white" strokeWidth={2}/>
                          {/* Labels */}
                          <text x={CX-R+4} y={CY+14} fontSize={9} fill="#22c55e" textAnchor="middle">Baixo</text>
                          <text x={CX} y={CY-R-6} fontSize={9} fill="#f59e0b" textAnchor="middle">Médio</text>
                          <text x={CX+R-4} y={CY+14} fontSize={9} fill="#ef4444" textAnchor="middle">Alto</text>
                          {/* Level label */}
                          <text x={CX} y={CY+32} fontSize={15} fontWeight="bold" fill={riskColor} textAnchor="middle">{riskLabel}</text>
                        </svg>
                      </div>
                      {/* Vertical divider */}
                      <div className="w-px self-stretch bg-[#1a1f2e]"/>
                      {/* KPIs */}
                      <div className="flex-1 grid grid-cols-3 gap-6">
                        <div>
                          <div className="text-slate-400 text-xs mb-1">Volatilidade anual</div>
                          <div className="text-3xl font-black text-amber-400">{vol?`${vol.toFixed(1)}%`:"—"}</div>
                          <div className="text-[10px] text-slate-500 mt-1">Alvo: 15–20%</div>
                        </div>
                        <div>
                          <div className="text-slate-400 text-xs mb-1">Drawdown actual</div>
                          <div className="text-3xl font-black text-red-400">{dd?`${dd.toFixed(1)}%`:"—"}</div>
                          <div className="text-[10px] text-slate-500 mt-1">vs pico</div>
                        </div>
                        <div>
                          <div className="text-slate-400 text-xs mb-1">Sharpe (20 anos)</div>
                          <div className="text-3xl font-black text-white">{perfData?sharpe20.toFixed(2):"—"}</div>
                          <div className="text-[10px] text-slate-500 mt-1">Rf = 0%</div>
                        </div>
                        <div>
                          <div className="text-slate-400 text-xs mb-1">VaR 95% (diário)</div>
                          <div className="text-2xl font-black text-red-300">{riskMetrics?`${riskMetrics.var95.toFixed(2)}%`:"—"}</div>
                        </div>
                        <div>
                          <div className="text-slate-400 text-xs mb-1">Beta vs {BENCH_SHORT}</div>
                          <div className="text-2xl font-black text-slate-200">{riskMetrics?riskMetrics.beta:"—"}</div>
                        </div>
                        <div>
                          <div className="text-slate-400 text-xs mb-1">Perfil</div>
                          <div className="text-2xl font-black text-amber-400">Moderado</div>
                        </div>
                      </div>
                    </div>

                    {/* ── Drawdown histórico (full width) ── */}
                    <div className="bg-[#0b0f1a] border border-[#1a1f2e] rounded-xl p-5">
                      <div className="font-bold text-slate-200 text-sm mb-3">Drawdown histórico</div>
                      <ResponsiveContainer width="100%" height={180}>
                        <AreaChart data={perfData?.ddChart??[]} margin={{top:4,right:8,left:0,bottom:0}}>
                          <defs>
                            <linearGradient id="ddGrad" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="#f87171" stopOpacity={0.3}/>
                              <stop offset="95%" stopColor="#f87171" stopOpacity={0.0}/>
                            </linearGradient>
                          </defs>
                          <CartesianGrid vertical={false} stroke="#1a1f2e"/>
                          <XAxis dataKey="date" tick={{fontSize:10,fill:"#e2e8f0"}} tickLine={false} axisLine={false}
                            tickFormatter={d=>d.slice(0,4)}
                            interval={Math.floor((perfData?.ddChart.length??1)/8)}/>
                          <YAxis tick={{fontSize:10,fill:"#e2e8f0"}} tickLine={false} axisLine={false}
                            tickFormatter={v=>`${Number(v).toFixed(0)}%`} domain={["dataMin",0]} width={42}/>
                          <Tooltip
                            formatter={(v:number,name:string)=>[`${Number(v).toFixed(1)}%`, name==="dd"?"Modelo":BENCH_SHORT]}
                            labelStyle={{color:"#fff",fontWeight:700}}
                            contentStyle={{background:"#1e293b",border:"1px solid #334155",borderRadius:8,fontSize:12,color:"#f1f5f9"}}
                            itemStyle={{color:"#f1f5f9"}}
                          />
                          <ReferenceLine y={0} stroke="#334155"/>
                          <Area type="monotone" dataKey="dd" stroke="#f87171" strokeWidth={1.5} fill="url(#ddGrad)" dot={false} name="dd"/>
                          <Line type="monotone" dataKey="bench" stroke="#64748b" strokeWidth={1} dot={false} name="bench" strokeDasharray="4 2"/>
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>

                    {/* ── Bottom: sector alloc + return distribution ── */}
                    <div className="grid grid-cols-2 gap-4">
                      <div className="bg-[#0b0f1a] border border-[#1a1f2e] rounded-xl p-5">
                        <div className="font-bold text-slate-200 text-sm mb-4">Exposição por sector</div>
                        <div className="space-y-2">
                          {sectorAlloc.map(({name,pct})=>(
                            <div key={name} className="flex items-center gap-3">
                              <div className="w-24 text-xs text-slate-400 text-right shrink-0">{name}</div>
                              <div className="flex-1 bg-[#1e293b] rounded-full h-2.5 overflow-hidden">
                                <div className="h-full rounded-full bg-blue-500" style={{width:`${pct}%`}}/>
                              </div>
                              <div className="w-10 text-xs text-white font-semibold text-right shrink-0">{pct}%</div>
                            </div>
                          ))}
                        </div>
                      </div>
                      <div className="bg-[#0b0f1a] border border-[#1a1f2e] rounded-xl p-5">
                        <div className="font-bold text-slate-200 text-sm mb-3">Distribuição de retornos mensais</div>
                        <ResponsiveContainer width="100%" height={200}>
                          <BarChart data={returnDist} margin={{top:4,right:4,left:-8,bottom:0}} barCategoryGap="5%">
                            <CartesianGrid vertical={false} stroke="#1a1f2e"/>
                            <XAxis dataKey="bin" tick={{fontSize:8,fill:"#e2e8f0"}} axisLine={false} tickLine={false} interval={3}/>
                            <YAxis tick={{fontSize:9,fill:"#e2e8f0"}} axisLine={false} tickLine={false}/>
                            <Tooltip
                              formatter={(v:number)=>[`${v} meses`,"Frequência"]}
                              labelFormatter={(l:string)=>`Retorno: ${l}`}
                              labelStyle={{color:"#ffffff",fontWeight:700,fontSize:13}}
                              contentStyle={{background:"#0f172a",border:"1px solid #3b82f6",borderRadius:8,fontSize:12,color:"#f1f5f9",boxShadow:"0 4px 24px rgba(0,0,0,0.6)"}}
                              itemStyle={{color:"#93c5fd",fontWeight:600}}
                              cursor={{fill:"rgba(255,255,255,0.06)"}}
                            />
                            <Bar dataKey="count" name="Frequência" radius={[2,2,0,0]} maxBarSize={20}>
                              {returnDist.map((r,i)=><Cell key={i} fill={r.mid>=0?"#3b82f6":"#f87171"}/>)}
                            </Bar>
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </div>

                    {/* ── Risk contribution by sector (full width) ── */}
                    <div className="bg-[#0b0f1a] border border-[#1a1f2e] rounded-xl p-5">
                      <div className="flex items-center gap-3 mb-1">
                        <div className="font-bold text-slate-200 text-sm">Contribuição para o risco por sector</div>
                        <div className="text-[10px] text-slate-500">(peso ajustado pelo beta estimado do sector)</div>
                      </div>
                      <div className="flex gap-4 text-[10px] mb-4">
                        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-blue-500 inline-block"/><span className="text-slate-400">Peso em carteira</span></span>
                        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-amber-400 inline-block"/><span className="text-slate-400">Contribuição para o risco</span></span>
                      </div>
                      <ResponsiveContainer width="100%" height={Math.max(180, sectorAlloc.length*36)}>
                        <BarChart data={sectorAlloc} layout="vertical" margin={{top:0,right:48,left:80,bottom:0}} barGap={3} barCategoryGap="28%">
                          <CartesianGrid horizontal={false} stroke="#1a1f2e"/>
                          <XAxis type="number" tick={{fontSize:10,fill:"#e2e8f0"}} axisLine={false} tickLine={false} tickFormatter={v=>`${v}%`} domain={[0,"dataMax+5"]}/>
                          <YAxis type="category" dataKey="name" tick={{fontSize:11,fill:"#e2e8f0"}} axisLine={false} tickLine={false} width={76}/>
                          <Tooltip
                            formatter={(v:number,name:string)=>[`${Number(v).toFixed(1)}%`, name==="pct"?"Peso carteira":"Risco (β-adj.)"]}
                            labelStyle={{color:"#fff",fontWeight:700,fontSize:13}}
                            contentStyle={{background:"#0f172a",border:"1px solid #f59e0b",borderRadius:8,fontSize:12,color:"#f1f5f9",boxShadow:"0 4px 24px rgba(0,0,0,0.6)"}}
                            itemStyle={{color:"#f1f5f9",fontWeight:600}}
                            cursor={{fill:"rgba(255,255,255,0.04)"}}
                          />
                          <Bar dataKey="pct" name="pct" fill="#3b82f6" radius={[0,3,3,0]} maxBarSize={14}/>
                          <Bar dataKey="risk" name="risk" fill="#f59e0b" radius={[0,3,3,0]} maxBarSize={14}>
                            {sectorAlloc.map((_,i)=>{
                              const s=sectorAlloc[i]!;
                              const diff=s.risk-s.pct;
                              return <Cell key={i} fill={diff>1?"#ef4444":diff<-1?"#22c55e":"#f59e0b"}/>;
                            })}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                      <div className="mt-2 text-[10px] text-slate-500">
                        Vermelho = sector sobrepondera no risco vs peso · Verde = subpondera no risco · Sectores com beta estimado: Tec. 1.35 · Com. 1.15 · Ene. 1.05 · Ind. 1.00 · Mat. 0.90 · Fin. 1.10 · Saúde 0.75 · Cons. 0.70
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* ── HISTÓRICO ── */}
              {activePage==="historico"&&<HistoricoPage sortedMonths={sortedMonths} dates={dates} equityRaw={equityRaw}/>}
              {activePage==="custos"&&<CustosPage aum={aum}/>}

              {/* `u{2500}`u{2500} AJUDA `u{2500}`u{2500} */}
              {activePage==="ajuda"&&<AjudaPage/>}

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

              {/* ── ORDENS ── */}
              {activePage==="ordens"&&(
                <OrdensPage
                  actionCounts={actionCounts}
                  recoLabel={recoLabel}
                  aum={aum}
                  loggedIn={loggedIn}
                  onBack={()=>setActivePage("reco")}
                  onShowRegister={()=>setShowRegModal(true)}
                  profileLabel={profileLabel}
                  fxExposure={fxExposure}
                  marginEnabled={marginEnabled}
                />
              )}

            </div>
          </main>
        </div>
      </div>
    </>
  );
}


