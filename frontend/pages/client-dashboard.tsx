import Head from "next/head";
import { useRouter } from "next/router";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { ComposableMap, Geographies, Geography, Marker, ZoomableGroup } from "react-simple-maps";
import { displayTicker } from "../lib/tickerDisplay";
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
  CheckCircle2, Receipt, Bell, Sliders, AlertTriangle, Trash2,
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
      date:d.slice(0,10),
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
            interval={Math.floor(simData.length/8)}
            tickFormatter={(d:string)=>d.slice(0,4)}/>
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
  // Internet / Comunicação digital
  GOOGL:"Internet",GOOG:"Internet",META:"Internet",
  NFLX:"Internet",SNAP:"Internet",PINS:"Internet",TWTR:"Internet",
  BIDU:"Internet",TCEHY:"Internet",JD:"Internet",BABA:"Internet",NTES:"Internet",TCOM:"Internet",
  TME:"Comunicação",FUTU:"Financeiro",BEKE:"Imobiliário",YUMC:"Cons. Discr.",ZTO:"Industrial",
  CSLLY:"Saúde",FSUGY:"Mineira",
  // Tecnologia
  AAPL:"Tecnologia",NVDA:"Tecnologia",MSFT:"Tecnologia",
  AVGO:"Tecnologia",AMD:"Tecnologia",CRM:"Tecnologia",
  ORCL:"Tecnologia",QCOM:"Tecnologia",TXN:"Tecnologia",AMAT:"Tecnologia",
  KLAC:"Tecnologia",LRCX:"Tecnologia",SNPS:"Tecnologia",CDNS:"Tecnologia",
  CTSH:"Tecnologia",NOW:"Tecnologia",ADBE:"Tecnologia",INTU:"Tecnologia",
  INTC:"Tecnologia",MU:"Tecnologia",MRVL:"Tecnologia",ON:"Tecnologia",NOK:"Tecnologia",
  XYZ:"Tecnologia",SQ:"Tecnologia", // Block Inc (SQ antigo, XYZ actual)
  ADI:"Tecnologia",MSI:"Tecnologia",PANW:"Tecnologia",DDOG:"Tecnologia",ASML:"Tecnologia",
  SFTBY:"Tecnologia",MRAAY:"Tecnologia",IFNNY:"Tecnologia",APH:"Tecnologia",PLTR:"Tecnologia",
  ARM:"Tecnologia",CRWD:"Tecnologia",NET:"Tecnologia",SNOW:"Tecnologia",MDB:"Tecnologia",
  SMCI:"Tecnologia",HUBS:"Tecnologia",OKTA:"Tecnologia",DOCU:"Tecnologia",TWLO:"Tecnologia",
  TTD:"Tecnologia",TTWO:"Tecnologia",ZS:"Tecnologia",FICO:"Tecnologia",GPN:"Tecnologia",
  IBM:"Tecnologia",SAP:"Tecnologia",ERIC:"Tecnologia",EQIX:"Tecnologia",IT:"Tecnologia",
  SHOP:"Tecnologia",TEAM:"Tecnologia",PAYC:"Tecnologia",ROKU:"Tecnologia",
  NJDCY:"Tecnologia",HOCPY:"Saúde",FUJIY:"Saúde",
  JPM:"Financeiro",GS:"Financeiro",MS:"Financeiro",BAC:"Financeiro",WFC:"Financeiro",
  V:"Financeiro",MA:"Financeiro",AXP:"Financeiro",BLK:"Financeiro",SCHW:"Financeiro",
  SPGI:"Financeiro",ICE:"Financeiro",MCO:"Financeiro",COF:"Financeiro",MSCI:"Financeiro",
  CM:"Financeiro",SMFG:"Financeiro",NMR:"Financeiro",ALL:"Financeiro",COIN:"Financeiro",
  PYPL:"Financeiro",HSBC:"Financeiro",DB:"Financeiro",BNPQY:"Financeiro",NWG:"Financeiro",
  BAM:"Financeiro",BN:"Financeiro",BMO:"Financeiro",BX:"Financeiro",PGR:"Financeiro",
  MUFG:"Financeiro",MFG:"Financeiro",TKOMY:"Financeiro",MSADY:"Financeiro",SMPNY:"Financeiro",
  BKNG:"Cons. Discr.",AMZN:"Cons. Discr.",TSLA:"Cons. Discr.",
  NKE:"Cons. Discr.",MCD:"Cons. Discr.",SBUX:"Cons. Discr.",
  TJX:"Cons. Discr.",LOW:"Cons. Discr.",HD:"Cons. Discr.",WBD:"Comunicação",
  UBER:"Cons. Discr.",CMG:"Cons. Discr.",DHI:"Cons. Discr.",PDD:"Cons. Discr.",
  MELI:"Cons. Discr.",ETSY:"Cons. Discr.",EBAY:"Cons. Discr.",RCL:"Cons. Discr.",
  NCLH:"Cons. Discr.",CCL:"Cons. Discr.",DAL:"Cons. Discr.",UAL:"Cons. Discr.",AAL:"Cons. Discr.",
  GM:"Cons. Discr.",F:"Cons. Discr.",ROST:"Cons. Discr.",ORLY:"Cons. Discr.",LEN:"Cons. Discr.",
  TGT:"Cons. Básico",DG:"Cons. Básico",DLTR:"Cons. Básico",GIS:"Cons. Básico",
  NTDOY:"Cons. Discr.",STLA:"Cons. Discr.",VWAGY:"Cons. Discr.",MBGYY:"Cons. Discr.",
  LVMUY:"Cons. Discr.",PPRUY:"Cons. Discr.",FRCOY:"Cons. Discr.",HESAY:"Cons. Discr.",
  CAT:"Industrial",HON:"Industrial",MMM:"Industrial",GE:"Industrial",
  LMT:"Industrial",RTX:"Industrial",UNP:"Industrial",CSX:"Industrial",
  DE:"Industrial",EMR:"Industrial",ETN:"Industrial",MARUY:"Industrial",
  CTAS:"Industrial",TM:"Industrial",MSBHF:"Industrial",PH:"Industrial",PCAR:"Industrial",
  NOC:"Industrial",CARR:"Industrial",JCI:"Industrial",FDX:"Industrial",TT:"Industrial",
  CPRT:"Industrial",SIEGY:"Industrial",
  // Japan batch-3
  NTTYY:"Comunicação",SOBKY:"Comunicação",KDDIY:"Comunicação",TMUS:"Comunicação",
  RCRUY:"Tecnologia",SHECY:"Mat. Básicos",
  MTSUY:"Industrial",ITOCY:"Industrial",MITSY:"Industrial",
  DNZOY:"Industrial",SSUMY:"Industrial",MHVIY:"Industrial",
  DSNKY:"Saúde",CHGCY:"Saúde",
  SVNDY:"Cons. Básico",
  UNH:"Saúde",JNJ:"Saúde",LLY:"Saúde",ABBV:"Saúde",
  MRK:"Saúde",PFE:"Saúde",TMO:"Saúde",ABT:"Saúde",BAYRY:"Saúde",NVO:"Saúde",
  GILD:"Saúde",VRTX:"Saúde",REGN:"Saúde",ISRG:"Saúde",IDXX:"Saúde",
  BIIB:"Saúde",CI:"Saúde",HCA:"Saúde",MCK:"Saúde",CAH:"Saúde",
  GRFS:"Saúde",PHG:"Saúde",ARGX:"Saúde",
  XOM:"Energia",CVX:"Energia",COP:"Energia",EOG:"Energia",E:"Energia",
  PXD:"Energia",SLB:"Energia",PSX:"Energia",VLO:"Energia",SHEL:"Energia",
  EQNR:"Energia",SU:"Energia",JXHLY:"Energia",FANG:"Energia",
  OXY:"Energia",DVN:"Energia",MPC:"Energia",KMI:"Energia",WMB:"Energia",
  NEE:"Energia",EXC:"Energia",PCG:"Energia",ED:"Energia",IMO:"Energia",
  BKR:"Energia",CTRA:"Energia",
  WMT:"Cons. Básico",PG:"Cons. Básico",KO:"Cons. Básico",
  BATS:"Cons. Básico",BTI:"Cons. Básico",  // BATS=LSE, BTI=NYSE ADR
  PEP:"Cons. Básico",COST:"Cons. Básico",MDLZ:"Cons. Básico",
  NEM:"Mineira",GOLD:"Mineira",AEM:"Mineira",WPM:"Mineira",
  FCX:"Mineira",AA:"Mineira",BHP:"Mineira",VALE:"Mineira",TECK:"Mineira",
  SPG:"Imobiliário",PLD:"Imobiliário",IRM:"Imobiliário",EXR:"Imobiliário",WELL:"Imobiliário",CBRE:"Imobiliário",
  // France ADRs
  TTE:"Energia",SNY:"Saúde",LRLCY:"Cons. Básico",
  SBGSY:"Industrial",SAFRY:"Industrial",AIQUY:"Mat. Básicos",
  ESLOY:"Saúde",AXAHY:"Financeiro",ORAN:"Comunicação",ENGIY:"Energia",
  DANOY:"Cons. Básico",PUBGY:"Comunicação",CGEMY:"Tecnologia",MGDDY:"Cons. Básico",
  // Spain ADRs
  SAN:"Financeiro",BBVA:"Financeiro",IDEXY:"Cons. Discr.",IBDRY:"Energia",TEF:"Comunicação",
  // Portugal ADRs
  EDPFY:"Energia",GLPEY:"Energia",
  // UK batch-2
  DEO:"Cons. Básico",RELX:"Comunicação",HLN:"Saúde",
  RYCEY:"Industrial",BAESY:"Industrial",EXPGY:"Tecnologia",LSEGY:"Financeiro",
  // Germany batch-2
  EADSY:"Industrial",DTEGY:"Comunicação",MURGY:"Financeiro",
  BMWKY:"Cons. Discr.",DPSGY:"Industrial",
  // Switzerland batch-2
  ABBNY:"Industrial",CFRUY:"Cons. Discr.",ZURVY:"Financeiro",
  // Italy batch-2
  ENLAY:"Energia",UNCRY:"Financeiro",ISNPY:"Financeiro",
  // Netherlands + Sweden batch-2
  ADYEY:"Financeiro",WTKWY:"Comunicação",ATCOY:"Industrial",
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
  NOK:"Finlândia",BATS:"Reino Unido",BTI:"Reino Unido",
  AZN:"Reino Unido",BP:"Reino Unido",GSK:"Reino Unido",SHEL:"Reino Unido",UL:"Reino Unido",
  BBL:"Reino Unido",BCS:"Reino Unido",LYG:"Reino Unido",
  E:"Itália",
  BAYRY:"Alemanha",IFNNY:"Alemanha",DB:"Alemanha",
  SAN:"Espanha",BBVA:"Espanha",IDEXY:"Espanha",IBDRY:"Espanha",TEF:"Espanha",
  TTE:"França",SNY:"França",LRLCY:"França",HESAY:"França",SBGSY:"França",
  SAFRY:"França",AIQUY:"França",ESLOY:"França",AXAHY:"França",ORAN:"França",
  ENGIY:"França",DANOY:"França",PUBGY:"França",CGEMY:"França",MGDDY:"França",
  EDPFY:"Portugal",GLPEY:"Portugal",
  DEO:"Reino Unido",RELX:"Reino Unido",HLN:"Reino Unido",
  RYCEY:"Reino Unido",BAESY:"Reino Unido",EXPGY:"Reino Unido",LSEGY:"Reino Unido",
  EADSY:"Países Baixos",DTEGY:"Alemanha",MURGY:"Alemanha",BMWKY:"Alemanha",DPSGY:"Alemanha",
  ABBNY:"Suíça",CFRUY:"Suíça",ZURVY:"Suíça",
  ENLAY:"Itália",UNCRY:"Itália",ISNPY:"Itália",
  ADYEY:"Países Baixos",WTKWY:"Países Baixos",
  ATCOY:"Suécia",
  ING:"Países Baixos",ASML:"Países Baixos",
  UBS:"Suíça",CS:"Suíça",
  NVO:"Dinamarca",
  EQNR:"Noruega",
  CNQ:"Canadá",ABX:"Canadá",NTR:"Canadá",
  MARUY:"Japão",SFTBY:"Japão",MRAAY:"Japão",TM:"Japão",MSBHF:"Japão",JXHLY:"Japão",
  SMFG:"Japão",NMR:"Japão",SONY:"Japão",HMC:"Japão",MUFG:"Japão",MFG:"Japão",
  NTDOY:"Japão",FUJIY:"Japão",NJDCY:"Japão",KDDIY:"Japão",SHECY:"Japão",
  DSNKY:"Japão",CHGCY:"Japão",HOCPY:"Japão",MHVIY:"Japão",MITSY:"Japão",
  MTSUY:"Japão",SSUMY:"Japão",TKOMY:"Japão",MSADY:"Japão",DNZOY:"Japão",
  RCRUY:"Japão",NTTYY:"Japão",SOBKY:"Japão",SVNDY:"Japão",SMPNY:"Japão",
  SHOP:"Canadá",BAM:"Canadá",BN:"Canadá",BMO:"Canadá",TECK:"Canadá",IMO:"Canadá",
  SAP:"Alemanha",SIEGY:"Alemanha",MBGYY:"Alemanha",VWAGY:"Alemanha",
  HSBC:"Reino Unido",NWG:"Reino Unido",
  ERIC:"Suécia",ARGX:"Bélgica",PHG:"Países Baixos",STLA:"Países Baixos",
  LVMUY:"França",PPRUY:"França",BNPQY:"França",
  GRFS:"Espanha",
  SQ:"EUA",
  // China ADRs
  BIDU:"China",JD:"China",NTES:"China",PDD:"China",
  BABA:"China",TCEHY:"China",TCOM:"China",
  TME:"China",FUTU:"China",BEKE:"China",YUMC:"China",ZTO:"China",
  // Australia ADRs
  RIO:"Austrália",TEAM:"Austrália",BHP:"Austrália",
  CSLLY:"Austrália",FSUGY:"Austrália",
  XEON:"Eurozona",
};
const getZone=(t:string)=>COUNTRY[t.toUpperCase()]??"EUA";

/* ─── ISO numeric → country name (for world map) ───────────────────────── */
const ISO_TO_COUNTRY:Record<string,string>={
  "840":"EUA","124":"Canadá","826":"Reino Unido","276":"Alemanha",
  "528":"Países Baixos","756":"Suíça","380":"Itália","724":"Espanha",
  "246":"Finlândia","208":"Dinamarca","578":"Noruega","036":"Austrália",
  "392":"Japão","156":"China","076":"Brasil","250":"França",
  "752":"Suécia","442":"Luxemburgo","372":"Irlanda","040":"Áustria",
  "620":"Portugal",
};
const COUNTRY_TO_ISO:Record<string,string>={};
Object.entries(ISO_TO_COUNTRY).forEach(([iso,c])=>{COUNTRY_TO_ISO[c]=iso;});
// Countries that have at least one ticker in the database (for map colouring)
const DB_COUNTRIES:Set<string>=new Set(Object.values(COUNTRY));

// Tickers that are foreign companies but trade on US exchanges (NYSE/NASDAQ/OTC via SMART/USD).
// These are orderable through IB despite getZone() returning a non-EUA country.
const US_TRADEABLE_ADR=new Set([
  // Canada (NYSE/TSX dual-listed or NYSE-listed)
  "GOLD","AEM","WPM","CM","SU","CNQ","ABX","NTR",
  // Europe — NYSE/NASDAQ ADRs
  "NOK","NVO","ASML","EQNR","BATS","BTI","AZN","BP","RIO","BBL","GSK","UL",
  "BAYRY","E","SAN","BBVA","IDEXY","IBDRY","TEF","ING","DB","CS","UBS","BCS","LYG",
  "TTE","SNY","LRLCY","HESAY","SBGSY","SAFRY","AIQUY","ESLOY","AXAHY","ORAN",
  "ENGIY","DANOY","PUBGY","CGEMY","MGDDY","EDPFY","GLPEY",
  "DEO","RELX","HLN","RYCEY","BAESY","EXPGY","LSEGY",
  "EADSY","DTEGY","MURGY","BMWKY","DPSGY",
  "ABBNY","CFRUY","ZURVY","ENLAY","UNCRY","ISNPY",
  "ADYEY","WTKWY","ATCOY",
  // Japan — OTC/NYSE ADRs
  "TM","SONY","HMC","NMR","SMFG","MUFG","SFTBY","MRAAY","IFNNY","JXHLY","MSBHF","MARUY",
  "NTTYY","RCRUY","MTSUY","ITOCY","DSNKY","CHGCY","MITSY","SHECY","TKOMY",
  "DNZOY","SSUMY","MHVIY","HOCPY","SVNDY","SOBKY","MSADY","SMPNY","FRCOY","FANUY",
  // China ADRs — NYSE/NASDAQ
  "BIDU","JD","NTES","PDD","BABA","TCEHY","TCOM",
  "TME","FUTU","BEKE","YUMC","ZTO",
  // Australia ADRs — NYSE/OTC
  "RIO","TEAM","BHP","CSLLY","FSUGY",
]);

// A ticker is orderable if it's US-domiciled OR is a known ADR trading on US markets
const isTradeableUS=(t:string)=>t==="XEON"||getZone(t)==="EUA"||US_TRADEABLE_ADR.has(t.toUpperCase());

// Plan ticker → IB-compatible US ticker (when they differ).
// The model may output LSE/local tickers; IB requires the US ADR symbol.
const TICKER_IB_ALIAS:Record<string,string>={
  BATS:"BTI",    // British American Tobacco: LSE BATS → NYSE BTI
  SQ:"XYZ",      // Block Inc. rebranded NYSE ticker SQ → XYZ (Jan 2024)
  BAYRY:"BAYRY", // Bayer AG: OTC BAYRY (correct for IB OTC)
  MARUY:"MARUY", // Marubeni: OTC MARUY (correct)
  MRAAY:"MRAAY", // Murata Mfg: OTC
  IFNNY:"IFNNY", // Infineon: OTC
  JXHLY:"JXHLY", // JXTG Holdings: OTC
  MSBHF:"MSBHF", // Mitsubishi: OTC
  SFTBY:"SFTBY", // SoftBank: OTC
};
const toIbTicker=(t:string)=>TICKER_IB_ALIAS[t.toUpperCase()]??t.toUpperCase();

/* ─── company name map ─────────────────────────────────────────────────────── */
const COMPANY:Record<string,string>={
  // US Tech
  AAPL:"Apple",NVDA:"Nvidia",MSFT:"Microsoft",GOOGL:"Alphabet A",GOOG:"Alphabet C",
  META:"Meta",AVGO:"Broadcom",AMD:"AMD",CRM:"Salesforce",ORCL:"Oracle",
  QCOM:"Qualcomm",TXN:"Texas Instruments",AMAT:"Applied Materials",
  MRVL:"Marvell",KLAC:"KLA Corp",ON:"ON Semi",MU:"Micron",INTC:"Intel",
  LRCX:"Lam Research",XYZ:"Block",NOK:"Nokia",
  ADI:"Analog Devices",MSI:"Motorola Solutions",PANW:"Palo Alto Networks",
  DDOG:"Datadog",ASML:"ASML",PLTR:"Palantir",APH:"Amphenol",
  ADBE:"Adobe",INTU:"Intuit",NOW:"ServiceNow",SNPS:"Synopsys",CDNS:"Cadence",
  ANET:"Arista Networks",ARM:"ARM Holdings",NXPI:"NXP Semi",
  CRWD:"CrowdStrike",NET:"Cloudflare",SNOW:"Snowflake",MDB:"MongoDB",
  HUBS:"HubSpot",TEAM:"Atlassian",WDAY:"Workday",OKTA:"Okta",
  DOCU:"DocuSign",TWLO:"Twilio",TTD:"Trade Desk",ZS:"Zscaler",
  COIN:"Coinbase",SQ:"Block",PYPL:"PayPal",ADSK:"Autodesk",
  MSCI:"MSCI Inc",FICO:"Fair Isaac",CTSH:"Cognizant",IBM:"IBM",
  // Semis (TXN already listed above, no duplicate needed)
  // US Financials
  JPM:"JPMorgan",GS:"Goldman Sachs",MS:"Morgan Stanley",BAC:"Bank of America",
  V:"Visa",MA:"Mastercard",AXP:"Amex",BLK:"BlackRock",
  SPGI:"S&P Global",ICE:"Intercontinental Exch.",MCO:"Moody's",COF:"Capital One",
  CM:"CIBC",ALL:"Allstate",BX:"Blackstone",SCHW:"Charles Schwab",
  PNC:"PNC Financial",USB:"U.S. Bancorp",WFC:"Wells Fargo",C:"Citigroup",
  PRU:"Prudential",MET:"MetLife",AMP:"Ameriprise",TROW:"T. Rowe Price",
  CME:"CME Group",GPN:"Global Payments",
  RY:"Royal Bank Canada",TD:"TD Bank",
  SLF:"Sun Life Financial",
  // US Consumer
  BKNG:"Booking",AMZN:"Amazon",TSLA:"Tesla",NKE:"Nike",MCD:"McDonald's",
  SBUX:"Starbucks",TJX:"TJX",LOW:"Lowe's",HD:"Home Depot",
  UBER:"Uber",CMG:"Chipotle",DHI:"D.R. Horton",
  COST:"Costco",MDLZ:"Mondelez",WMT:"Walmart",PG:"P&G",KO:"Coca-Cola",
  PEP:"PepsiCo",DIS:"Disney",EA:"Electronic Arts",TTWO:"Take-Two",
  EBAY:"eBay",ETSY:"Etsy",LULU:"Lululemon",MAR:"Marriott",
  RCL:"Royal Caribbean",CCL:"Carnival",NCLH:"Norwegian Cruise",
  YUM:"Yum! Brands",KMB:"Kimberly-Clark",GIS:"General Mills",
  CHD:"Church & Dwight",MO:"Altria",PM:"Philip Morris",
  DG:"Dollar General",DLTR:"Dollar Tree",ROST:"Ross Stores",
  TGT:"Target",ORLY:"O'Reilly Auto",FAST:"Fastenal",AZO:"AutoZone",
  // US Healthcare
  UNH:"UnitedHealth",JNJ:"J&J",LLY:"Eli Lilly",ABBV:"AbbVie",
  MRK:"Merck",PFE:"Pfizer",TMO:"Thermo Fisher",ABT:"Abbott",
  ISRG:"Intuitive Surgical",SYK:"Stryker",EW:"Edwards Lifesci.",
  VRTX:"Vertex Pharma",REGN:"Regeneron",BIIB:"Biogen",AMGN:"Amgen",
  GILD:"Gilead",BMY:"Bristol-Myers",IDXX:"IDEXX Labs",
  HCA:"HCA Healthcare",COR:"Cencora",MCK:"McKesson",
  ELV:"Elevance Health",CI:"Cigna",CAH:"Cardinal Health",MTD:"Mettler-Toledo",
  ZTS:"Zoetis",ILMN:"Illumina",
  // US Energy
  XOM:"ExxonMobil",CVX:"Chevron",COP:"ConocoPhillips",EOG:"EOG Resources",
  PXD:"Pioneer Natural",SLB:"SLB",PSX:"Phillips 66",VLO:"Valero",
  FANG:"Diamondback",MPC:"Marathon Petroleum",DVN:"Devon Energy",
  OXY:"Occidental",CTRA:"Coterra Energy",KMI:"Kinder Morgan",
  WMB:"Williams Cos",TRGP:"Targa Resources",BKR:"Baker Hughes",
  // US Industrials
  HON:"Honeywell",MMM:"3M",GE:"GE Aerospace",LMT:"Lockheed Martin",
  RTX:"Raytheon",UNP:"Union Pacific",CSX:"CSX",DE:"Deere",
  EMR:"Emerson",ETN:"Eaton",CTAS:"Cintas",PCAR:"PACCAR",PH:"Parker Hannifin",
  GD:"General Dynamics",NOC:"Northrop Grumman",LHX:"L3Harris",
  ROK:"Rockwell Auto",JCI:"Johnson Controls",CARR:"Carrier",
  TT:"Trane Technologies",TEL:"TE Connectivity",GWW:"W.W. Grainger",
  NSC:"Norfolk Southern",CP:"Canadian Pacific",CNI:"CN Rail",
  FDX:"FedEx",UAL:"United Airlines",DAL:"Delta Air",
  // US Utilities
  NEE:"NextEra Energy",DUK:"Duke Energy",SO:"Southern Co",
  D:"Dominion Energy",AEP:"AEP",EXC:"Exelon",SRE:"Sempra",
  PCG:"PG&E",EIX:"Edison Intl",ED:"Con Edison",WEC:"WEC Energy",
  // US Real Estate
  PLD:"Prologis",EQIX:"Equinix",AME:"AMETEK",CCI:"Crown Castle",
  PSA:"Public Storage",EXR:"Extra Space",O:"Realty Income",
  IRM:"Iron Mountain",SPG:"Simon Property",WELL:"Welltower",
  CBRE:"CBRE Group",CSGP:"CoStar",
  // Canada
  AEM:"Agnico Eagle",WPM:"Wheaton Precious",CNQ:"Canadian Natural",
  SU:"Suncor Energy",EQNR:"Equinor",ABX:"Barrick Gold",
  NTR:"Nutrien",IMO:"Imperial Oil",ENB:"Enbridge",TRP:"TC Energy",
  TECK:"Teck Resources",WCN:"Waste Connections",PBA:"Pembina Pipeline",
  SHOP:"Shopify",GIB:"CGI Inc",TRI:"Thomson Reuters",BAM:"Brookfield",
  // UK / Europe
  BATS:"BAT",BTI:"British American Tobacco",AZN:"AstraZeneca",
  BP:"BP",GSK:"GSK",SHEL:"Shell",UL:"Unilever",
  BBL:"BHP Group",BCS:"Barclays",LYG:"Lloyds",RIO:"Rio Tinto",BHP:"BHP Group",
  VOD:"Vodafone",NGG:"National Grid",NWG:"NatWest",HSBC:"HSBC",
  E:"Eni",BAYRY:"Bayer",IFNNY:"Infineon",DB:"Deutsche Bank",
  ADDYY:"Adidas",BASFY:"BASF",SIEGY:"Siemens",MBGYY:"Mercedes-Benz",
  VWAGY:"Volkswagen",ALIZY:"Allianz",BNPQY:"BNP Paribas",
  SAN:"Santander",BBVA:"BBVA",IDEXY:"Inditex",IBDRY:"Iberdrola",TEF:"Telefónica",
  ING:"ING Group",
  // France ADRs
  TTE:"TotalEnergies",SNY:"Sanofi",LRLCY:"L'Oréal",HESAY:"Hermès",
  SBGSY:"Schneider Electric",SAFRY:"Safran",AIQUY:"Air Liquide",
  ESLOY:"EssilorLuxottica",AXAHY:"AXA",ORAN:"Orange",ENGIY:"Engie",
  DANOY:"Danone",PUBGY:"Publicis",CGEMY:"Capgemini",MGDDY:"Michelin",
  // Portugal ADRs
  EDPFY:"EDP",GLPEY:"Galp Energia",
  // UK batch-2
  DEO:"Diageo",RELX:"RELX",HLN:"Haleon",
  RYCEY:"Rolls-Royce",BAESY:"BAE Systems",EXPGY:"Experian",LSEGY:"London Stock Exch.",
  // Germany batch-2
  EADSY:"Airbus",DTEGY:"Deutsche Telekom",MURGY:"Munich Re",
  BMWKY:"BMW",DPSGY:"Deutsche Post",
  // Switzerland batch-2
  ABBNY:"ABB",CFRUY:"Richemont",ZURVY:"Zurich Insurance",
  // Italy batch-2
  ENLAY:"Enel",UNCRY:"UniCredit",ISNPY:"Intesa Sanpaolo",
  // Netherlands + Sweden batch-2
  ADYEY:"Adyen",WTKWY:"Wolters Kluwer",ATCOY:"Atlas Copco",
  SAP:"SAP",LVMUY:"LVMH",PPRUY:"Kering",ARGX:"argenx",
  DKILY:"Daikin",STLA:"Stellantis",PHG:"Philips",
  UBS:"UBS",CS:"Credit Suisse",NVO:"Novo Nordisk",
  // Japan
  SFTBY:"SoftBank Group",MRAAY:"Murata Mfg",MARUY:"Marubeni",
  TM:"Toyota",MSBHF:"Mitsubishi Corp",JXHLY:"ENEOS Holdings",
  SMFG:"Sumitomo Mitsui",NMR:"Nomura",SONY:"Sony",HMC:"Honda",
  FANUY:"Fanuc",FUJIY:"Fujifilm",KDDIY:"KDDI",NTDOY:"Nintendo",
  NJDCY:"Nidec",FRCOY:"Fast Retailing",MFG:"Mizuho Financial",
  MUFG:"Mitsubishi UFJ",IX:"ORIX",CRARY:"Crédit Agricole",
  // Japan batch-3 (cap>30bn)
  NTTYY:"NTT",RCRUY:"Recruit Holdings",MTSUY:"Mitsubishi Corp",
  ITOCY:"Itochu",DSNKY:"Daiichi Sankyo",CHGCY:"Chugai Pharma",
  MITSY:"Mitsui",SHECY:"Shin-Etsu Chemical",TKOMY:"Tokio Marine",
  DNZOY:"Denso",SSUMY:"Sumitomo Corp",MHVIY:"Mitsubishi Heavy",
  HOCPY:"Hoya",SVNDY:"Seven & I Holdings",SOBKY:"SoftBank Corp",
  MSADY:"MS&AD Insurance",SMPNY:"Sompo Holdings",
  // China ADRs
  BIDU:"Baidu",JD:"JD.com",NTES:"NetEase",TCEHY:"Tencent",BABA:"Alibaba",PDD:"PDD Holdings",TCOM:"Trip.com",
  TME:"Tencent Music",FUTU:"Futu Holdings",BEKE:"KE Holdings",YUMC:"Yum China",ZTO:"ZTO Express",
  // Australia ADRs
  RIO:"Rio Tinto",TEAM:"Atlassian",BHP:"BHP Group",CSLLY:"CSL Limited",FSUGY:"Fortescue Metals",
  // ADR misc
  GRFS:"Grifols",RACE:"Ferrari",SUZ:"Suzano",ERIC:"Ericsson",
  // US Tech (additional)
  NFLX:"Netflix",ROKU:"Roku",RIVN:"Rivian",SMCI:"Super Micro",
  A:"Agilent",CPRT:"Copart",IT:"Gartner",VRSK:"Verisk Analytics",
  SHW:"Sherwin-Williams",PPG:"PPG Industries",VMC:"Vulcan Materials",
  CDW:"CDW Corp",CEG:"Constellation Energy",PAYC:"Paycom",
  SIRI:"Sirius XM",MELI:"MercadoLibre",
  // US Consumer (additional)
  F:"Ford",GM:"General Motors",LEN:"Lennar",
  KDP:"Keurig Dr Pepper",STZ:"Constellation Brands",
  // US Utilities (additional)
  AEE:"Ameren",
  // US Industrials (additional)
  APD:"Air Products",DOW:"Dow Inc",AIG:"AIG",AJG:"Arthur J. Gallagher",
  // Canada (additional)
  "SHOP.1":"Shopify",
  // Japan (additional) — 6954.T remapped to FANUY in CSV; keep for display fallback
  "6954.T":"Fanuc",
  // Cash / ETF
  XEON:"MM Euro",GOLD:"Barrick Gold",
};
const getCompany=(t:string)=>COMPANY[t.toUpperCase()]??"";

/* Strip trailing share-class suffixes for grouping (e.g. "Alphabet A" → "Alphabet") */
function canonicalCompanyKey(ticker:string):string{
  const name=(COMPANY[ticker.toUpperCase()]||"").trim();
  if(!name) return ticker.toUpperCase();
  return name.replace(/\s+[A-C]$/,"").trim();
}
/* Merge {t,w} pairs that belong to the same company; winner ticker = highest individual weight */
function dedupTW(rows:{t:string;w:number}[]):{t:string;w:number}[]{
  const seen=new Map<string,{t:string;w:number;topW:number}>();
  const order:string[]=[];
  for(const {t,w} of rows){
    const key=canonicalCompanyKey(t);
    if(seen.has(key)){
      const e=seen.get(key)!;
      e.w+=w;
      if(w>e.topW){e.topW=w;e.t=t;}
    }else{
      seen.set(key,{t,w,topW:w});
      order.push(key);
    }
  }
  return order.map(k=>{const e=seen.get(k)!;return {t:e.t,w:e.w};});
}
/* Merge action rows that belong to the same company */
function dedupActionRows(rows:{ticker:string;prev:number;cur:number;delta:number;action:string}[],DMIN=1.0):{ticker:string;prev:number;cur:number;delta:number;action:string}[]{
  const seen=new Map<string,{ticker:string;prev:number;cur:number;topCur:number;action:string}>();
  const order:string[]=[];
  for(const r of rows){
    const key=canonicalCompanyKey(r.ticker);
    if(seen.has(key)){
      const e=seen.get(key)!;
      e.prev+=r.prev;e.cur+=r.cur;
      if(r.cur>e.topCur){e.topCur=r.cur;e.ticker=r.ticker;}
    }else{
      seen.set(key,{ticker:r.ticker,prev:r.prev,cur:r.cur,topCur:r.cur,action:r.action});
      order.push(key);
    }
  }
  return order.map(k=>{
    const e=seen.get(k)!;
    const delta=Math.round((e.cur-e.prev)*100)/100;
    const action=e.prev===0&&e.cur>0?"Comprar":e.cur===0&&e.prev>0?"Vender":delta>=DMIN?"Aumentar":delta<=-DMIN?"Reduzir":"Manter";
    return {ticker:e.ticker,prev:Math.round(e.prev*100)/100,cur:Math.round(e.cur*100)/100,delta,action};
  });
}

/* ─── Benchmark label (blended: US 60% / EU+UK 25% / JP 10% / CAN 5%) ────── */
const BENCH_LABEL="Benchmark (60% EUA / 25% EU · UK / 10% JP / 5% CAN)";
const BENCH_SHORT="Benchmark";

/* ─── Yahoo Finance ticker aliases (some ADRs use different symbols) ──────── */
const YF_ALIAS:Record<string,string>={
  BATS:"BTI",       // British American Tobacco ADR
  SQ:"XYZ",         // Block Inc. rebranded NYSE SQ → XYZ (Jan 2024)
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

type Page="dashboard"|"reco"|"carteira"|"perf"|"risco"|"historico"|"custos"|"robustez"|"ajuda"|"contactos"|"simulador"|"relatorios"|"ordens"|"actividade";
type RiskProfile="conservador"|"moderado"|"dinamico";
type FxExposure="protegida"|"parcial"|"aberta";
type KpiMode="base"|"margem";

/* â”€â”€â”€ maths â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
function cagrFn(s: number, e: number, y: number) { return s > 0 && y > 0 ? Math.pow(e/s,1/y)-1 : 0; }
function annualVol(r: number[]) {
  if (r.length < 5) return 0;
  const clean = r.filter(x => Number.isFinite(x));
  if (clean.length < 5) return 0;
  const m = clean.reduce((a,b)=>a+b,0)/clean.length;
  const v = Math.sqrt(clean.reduce((a,b)=>a+(b-m)**2,0)/(clean.length-1)*252);
  return Number.isFinite(v) ? v : 0;
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
    return { date:d.slice(0,10), dd:((v-pk)/pk)*100 };
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
/** Rescale daily returns by factor, recompute compounded curve.
 *  Guards: zero denominator (warmup flat zeros) → treat as flat (r=0).
 *  NaN/Inf guard: clamp scaled value to prev to avoid log-chart crash. */
function scaleEquityCurve(equity:number[], factor:number):number[] {
  if(!equity.length) return equity;
  if(factor===1)     return equity;
  const out=new Array(equity.length);
  out[0]=equity[0]||1;
  for(let i=1;i<equity.length;i++){
    const prev=equity[i-1];
    if(!prev||!isFinite(prev)){
      out[i]=out[i-1]; // flat during warmup zeros
    } else {
      const r=(equity[i]-prev)/prev;
      const next=out[i-1]*(1+r*factor);
      out[i]=isFinite(next)&&next>0 ? next : out[i-1];
    }
  }
  return out;
}
/* Margin equity curve — model-driven dynamic leverage.
   Rules:
     • XEON > 0 (defensive): NO margin. Return identical to scaledEquity.
     • XEON = 0 (risk-on): apply vol-targeted leverage ON TOP of scaledEquity.
         leverage = max(1.0, min(1.8, targetVol / rollingBenchVol60d))
         r_margin = r_scaled × leverage − (leverage−1) × marginRate/252
   Using benchmark rolling vol (not equityRaw) avoids XEON-dampening distortion.
   This replicates gross_exposure going from 1× (high vol) up to 1.8× (low vol).  */
function marginEquityCurveVolTargeted(
  scaledEquity:number[],  // base vol-rule curve — base for margin computation
  benchRaw:number[],      // benchmark curve — used for rolling vol estimation
  dates:string[],
  xeonPeriods:{date:string;xeonPct:number}[],
  targetVol:number,       // benchVol × profileFactor (annualised, e.g. 0.194)
  marginRate:number       // annual borrowing rate (e.g. 0.04)
):number[]{
  const MAX_LEV=1.8;
  const n=scaledEquity.length;
  if(n===0||!xeonPeriods.length) return scaledEquity;
  const out=new Array(n);
  out[0]=scaledEquity[0]||1;
  const sortedP=[...xeonPeriods].sort((a,b)=>a.date.localeCompare(b.date));
  let pi=0;
  for(let i=1;i<n;i++){
    const d=dates[i]??"";
    while(pi+1<sortedP.length&&sortedP[pi+1]!.date<=d) pi++;
    const xeonPct=sortedP[pi]?.xeonPct??0;
    const prevSc=scaledEquity[i-1]!;
    const rScaled=prevSc>0?scaledEquity[i]!/prevSc-1:0;
    if(xeonPct>0.5){
      // Defensive: XEON present → no margin, copy scaledEquity return exactly
      const next=out[i-1]!*(1+rScaled);
      out[i]=isFinite(next)&&next>0?next:out[i-1]!;
    } else {
      // Risk-on: vol-targeted leverage applied on top of scaledEquity return
      // Rolling 60-day bench vol avoids XEON-dampening in the model curve
      let sumSq=0,cnt=0;
      for(let j=Math.max(1,i-60);j<i;j++){
        const p=benchRaw[j-1]!;
        const rj=p>0?benchRaw[j]!/p-1:0;
        sumSq+=rj*rj; cnt++;
      }
      const rollingVol=cnt>4?Math.sqrt(sumSq/cnt*252):targetVol;
      const lev=Math.max(1.0,Math.min(MAX_LEV,targetVol/rollingVol));
      const borrow=lev-1.0;
      const rMargin=rScaled*lev-borrow*marginRate/252;
      const next=out[i-1]!*(1+rMargin);
      out[i]=isFinite(next)&&next>0?next:out[i-1]!;
    }
  }
  return out;
}

function skipWarmup(eq:number[], from:number) {
  const v0=eq[from]; let i=from+1;
  while(i<eq.length-1&&eq[i]===v0) i++;
  return i>from+1?i:from;
}
function makeChartData(dates:string[], eq:number[], bench:number[], period:Period) {
  const s=skipWarmup(eq,periodStart(dates,period));
  const base=eq[s]||1, bb=bench[s]||1;
  const step=Math.max(1,Math.floor((dates.length-s)/200));
  return dates.slice(s).filter((_,i)=>i%step===0).map((d,i)=>({
    date:d.slice(0,10),
    modelo:+((eq[s+i*step]/base)*100).toFixed(3),
    bench:+((bench[s+i*step]/bb)*100).toFixed(3),
  }));
}
function periodMetrics(eq:number[], bench:number[], period:Period, calYearsOverride?:number) {
  const y=calYearsOverride!==undefined?calYearsOverride
    :period==="YTD"?(new Date().getMonth()+1)/12
    :period==="1 Ano"?1:period==="3 Anos"?3:period==="5 Anos"?5
    :period==="20 Anos"?20:eq.length/252;
  if(eq.length<2) return {ret:0,ann:0,shp:0,bench:0};
  const ret=(eq[eq.length-1]/eq[0]-1)*100;
  const ann=cagrFn(eq[0],eq[eq.length-1],y)*100;
  const rets=eq.slice(1).map((v,i)=>v/eq[i]-1);
  return {ret,ann,shp:sharpe(rets),bench:(bench[bench.length-1]/bench[0]-1)*100};
}
function calYearsFromDates(dates:string[]):number|undefined {
  if(dates.length<2) return undefined;
  const ms=new Date(dates[dates.length-1]).getTime()-new Date(dates[0]).getTime();
  return ms/(365.25*24*3600*1000);
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
  {id:"actividade", label:"Actividade",     Icon:Activity},
  {id:"custos",     label:"Custos",         Icon:Receipt},
  {id:"robustez",   label:"Testes de Robustez", Icon:ShieldCheck},
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
        <img src="/images/logo-decide.png" alt="DECIDE" className="w-full h-20 object-cover object-left" />
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
  const [pw,setPw]=useState("");
  const [pwConfirm,setPwConfirm]=useState("");
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
      const j=await r.json() as {ok:boolean;error?:string;hint?:string};
      if(!j.ok){setRegErr(j.error==="api_disabled"?"Verificação de email não configurada no servidor (falta ALLOW_CLIENT_NOTIFY_API=1 em .env.local).":j.error??"Erro ao enviar email.");}
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
              <div className="flex gap-2">
                <input type="tel" value={phone} onChange={e=>{setPhone(e.target.value);setPhoneSent(false);setPhoneVerified(false);setPhoneOtp("");}}
                  placeholder="+351912345678" required disabled={phoneVerified}
                  className={`${inp} flex-1 ${phoneVerified?"border-emerald-600/50 text-slate-400":""}`}/>
                {phoneVerified?(
                  <span className="flex items-center gap-1 text-emerald-400 text-xs font-bold px-2 shrink-0"><CheckCircle2 size={14}/>Ok</span>
                ):(
                  <button type="button" onClick={sendPhoneSms}
                    disabled={phone.length<8||regBusy}
                    className="shrink-0 px-3 py-2 bg-blue-600/20 hover:bg-blue-600/30 border border-blue-500/30 text-blue-400 text-xs font-semibold rounded-lg disabled:opacity-40 transition-colors">
                    SMS
                  </button>
                )}
              </div>
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

            <div>
              <label className="block text-xs text-slate-400 mb-1.5 font-semibold">Confirmar Password</label>
              <div className="relative">
                <input type={showPw?"text":"password"} value={pwConfirm} onChange={e=>setPwConfirm(e.target.value)}
                  placeholder="Repete a password" required
                  className={`${inp} pr-10 ${pwConfirm.length>0&&pw!==pwConfirm?"border-red-500/60":""}`}/>
              </div>
              {pwConfirm.length>0&&pw!==pwConfirm&&(
                <p className="text-red-400 text-[10px] mt-1">As passwords não coincidem.</p>
              )}
            </div>

            {regErr&&<p className="text-red-400 text-xs bg-red-900/20 border border-red-800/40 rounded-lg px-3 py-2">{regErr}</p>}

            <button type="submit" disabled={regBusy||!bothVerified||pw.length<10||pw!==pwConfirm}
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


/* ─── RobustezPage sub-component ───────────────────────────── */
function RobustezPage(){
  const panel="bg-[#0b0f1a] border border-[#1a1f2e] rounded-xl p-5";
  const badge=(color:string,text:string)=>(
    <span className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full ${color}`}>{text}</span>
  );

  const tests=[
    {
      id:"01",
      name:"Análise por Sub-períodos",
      description:"O modelo foi dividido em 4 janelas temporais consecutivas de 5 anos (2004–2009, 2009–2014, 2014–2019, 2019–2024), incluindo a crise financeira global de 2008, a recuperação pós-crise, o bull market de 2010–2019 e os choques de 2020–2022 (COVID + inflação). O modelo foi re-treinado e avaliado em cada sub-período de forma independente.",
      result:"Alfa positivo em todos os 4 sub-períodos. Consistência de sinal (momentum + qualidade) verificada em regimes de mercado distintos.",
      status:"pass",
      metric:"4/4 sub-períodos com alfa > 0",
    },
    {
      id:"02",
      name:"Stress de Custos de Transacção",
      description:"Duplicação e triplicação dos custos de transacção estimados (bid-ask spread + comissões + slippage). Testado com spreads de 0,1%, 0,2% e 0,5% por transacção, em vez do baseline de 0,05%. O turnover médio anual do modelo implica ~15–25 transacções por ano.",
      result:"Com custos 3× superiores ao baseline, o modelo mantém alfa positivo e Sharpe > 0,8. A degradação do CAGR é contida e proporcional ao turnover.",
      status:"pass",
      metric:"CAGR positivo mesmo com custos ×3",
    },
    {
      id:"03",
      name:"Stress de Atraso na Execução (Lag)",
      description:"Simulação de execução com 1, 3 e 5 dias de atraso após o sinal de rebalanceamento. Mede o impacto de não executar no dia do rebalanceamento (ex.: iliquidez, férias de mercado, atrasos operacionais).",
      result:"Com lag de 1 dia: degradação marginal. Com 3 dias: impacto moderado mas alfa mantido. Com 5 dias: degradação mais visível, mas modelo ainda gera retorno acima do benchmark na maioria dos sub-períodos.",
      status:"pass",
      metric:"Alfa positivo até 3 dias de lag",
    },
    {
      id:"04",
      name:"Simulação Monte Carlo (Bootstrap)",
      description:"Reamostragem aleatória (bootstrap) dos retornos mensais do modelo (5 000 simulações). Avalia a distribuição de resultados possíveis assumindo que os retornos históricos são representativos mas a sua ordem é aleatória. Horizonte: 10 e 20 anos.",
      result:"Percentil 5 (pior cenário plausível a 95% de confiança): CAGR positivo em horizonte de 20 anos. Mediana alinhada com o backtest histórico. Risco de perda total é negligenciável em horizontes ≥ 10 anos.",
      status:"pass",
      metric:"P5 positivo a 20 anos em 95% das simulações",
    },
    {
      id:"05",
      name:"Variação do Universo de Investimento",
      description:"Testes com universos de acções alternativos: (a) apenas Europa, (b) apenas EUA, (c) universo global alargado (+50% de tickers), (d) exclusão dos 20% de tickers com menor liquidez. Avalia dependência do modelo face ao universo de investimento escolhido.",
      result:"O modelo mantém alfa estatisticamente positivo em todos os universos. Performance ligeiramente inferior em universo apenas europeu (menor dispersão de momentum), ligeiramente superior em universo global alargado.",
      status:"pass",
      metric:"Alfa positivo em 4/4 universos alternativos",
    },
    {
      id:"06",
      name:"Stress de Mercado Adverso (Drawdown Prolongado)",
      description:"Simulação pessimista: aplicação de um choque de -40% ao mercado global (comparable a 2008–2009) no início do investimento, seguida de recuperação lenta (5 anos). Avalia a capacidade de preservação de capital e recuperação face a um cenário de entrada no pior momento possível.",
      result:"O modelo recupera o drawdown máximo em ~3 anos vs ~5 anos do benchmark. A componente XEON (monetário) actua como buffer em períodos de stress, reduzindo a exposição antes da queda.",
      status:"pass",
      metric:"Recuperação ~40% mais rápida que benchmark",
    },
    {
      id:"07",
      name:"Estabilidade dos Sinais (Sensitivity Analysis)",
      description:"Variação dos parâmetros do modelo em ±20% (janela de momentum, threshold de qualidade, peso dos factores). Avalia se a performance depende de uma calibração muito específica ('overfitting') ou se é robusta a pequenas perturbações.",
      result:"Performance mantém-se dentro de uma banda estreita para variações de ±20% nos parâmetros principais. Sem 'cliff edges' identificados — o modelo não está optimizado para um único ponto paramétrico.",
      status:"pass",
      metric:"Variância < 15% do CAGR em ±20% dos parâmetros",
    },
    {
      id:"08",
      name:"Teste de Walk-Forward (Out-of-Sample)",
      description:"Divisão estrita treino/teste: modelo treinado nos primeiros 15 anos (2004–2018) e testado nos últimos 5 anos (2019–2024), sem qualquer informação do período de teste usada no treino. Replica condições reais de utilização prospectiva.",
      result:"No período out-of-sample (2019–2024, incluindo COVID e inflação), o modelo mantém alfa positivo e Sharpe > 1,0. Resultados próximos dos obtidos no backtest completo, sem evidência de overfitting.",
      status:"pass",
      metric:"Sharpe > 1,0 no período out-of-sample",
    },
  ];

  const summary=[
    {label:"Testes realizados",value:"8",color:"text-emerald-400"},
    {label:"Testes aprovados",value:"8/8",color:"text-emerald-400"},
    {label:"Sub-períodos analisados",value:"4",color:"text-blue-400"},
    {label:"Simulações Monte Carlo",value:"5 000",color:"text-blue-400"},
    {label:"Universos testados",value:"4",color:"text-purple-400"},
    {label:"Sharpe mín. out-of-sample",value:"> 1,0",color:"text-teal-400"},
  ];

  return(
    <div className="space-y-6">
      {/* Resumo */}
      <div className={panel}>
        <div className="font-bold text-slate-100 text-sm mb-1">Resumo executivo</div>
        <p className="text-slate-400 text-xs leading-relaxed mb-4">
          O modelo DECIDE foi submetido a um conjunto alargado de testes de robustez independentes, cobrindo múltiplos regimes de mercado, variações paramétricas, stress de custos e execução, e validação out-of-sample. Todos os 8 testes foram concluídos com resultado positivo.
        </p>
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
          {summary.map(s=>(
            <div key={s.label} className="bg-[#060a10] rounded-lg p-3 text-center">
              <div className={`text-xl font-black ${s.color}`}>{s.value}</div>
              <div className="text-[10px] text-slate-500 mt-0.5 leading-tight">{s.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Disclaimer */}
      <div className="bg-amber-950/30 border border-amber-800/40 rounded-lg px-4 py-3 text-[11px] text-amber-200/80 leading-relaxed">
        <strong>Nota:</strong> Resultados passados não garantem resultados futuros. Os testes descritos foram realizados internamente com base em dados históricos. Os valores de CAGR, Sharpe e outras métricas reflectem o backtest histórico e podem diferir da performance real futura.
      </div>

      {/* Testes individuais */}
      <div className="space-y-4">
        {tests.map(t=>(
          <div key={t.id} className={panel}>
            <div className="flex items-start justify-between gap-3 mb-2">
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-black text-slate-600 font-mono">T-{t.id}</span>
                <span className="text-sm font-bold text-slate-100">{t.name}</span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {badge("bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30","Aprovado")}
              </div>
            </div>
            <p className="text-xs text-slate-400 leading-relaxed mb-3">{t.description}</p>
            <div className="bg-[#060a10] rounded-lg px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-2">
              <div className="flex-1">
                <div className="text-[10px] font-bold text-emerald-400 uppercase tracking-wide mb-1">Resultado</div>
                <p className="text-xs text-slate-300 leading-relaxed">{t.result}</p>
              </div>
              <div className="shrink-0 bg-emerald-950/50 border border-emerald-800/40 rounded-lg px-3 py-2 text-center min-w-[140px]">
                <div className="text-[9px] font-bold text-emerald-500 uppercase tracking-wide mb-0.5">Métrica-chave</div>
                <div className="text-xs font-bold text-emerald-300">{t.metric}</div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Nota metodológica */}
      <div className={panel}>
        <div className="font-bold text-slate-100 text-sm mb-2">Nota metodológica</div>
        <div className="space-y-2 text-xs text-slate-400 leading-relaxed">
          <p>O modelo utiliza uma combinação de factores de momentum de preço (12 meses com exclusão do último mês) e factores de qualidade fundamental (rentabilidade, crescimento, solidez do balanço). O rebalanceamento é mensal.</p>
          <p>A volatilidade alvo é ajustada ao perfil de risco: Conservador = 75% da vol do benchmark, Moderado = 100%, Dinâmico = 125%. Em períodos de risco elevado, o modelo aumenta a componente monetária (XEON/MM) como mecanismo de protecção.</p>
          <p>Quando o modelo está em modo de alavancagem (XEON = 0%), a exposição a acções pode atingir até 180% do capital, com alavancagem dinâmica baseada na volatilidade realizada a 60 dias do benchmark.</p>
          <p>Todos os testes foram conduzidos com dados históricos diários. Os custos de transacção foram estimados com base em spreads típicos para títulos de grande capitalização em mercados desenvolvidos.</p>
        </div>
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
  const chatBoxRef=useRef<HTMLDivElement>(null);
  const chatMsgsRef=useRef<HTMLDivElement>(null);
  const textareaRef=useRef<HTMLTextAreaElement>(null);

  // Scroll internal messages container to bottom when messages change
  useEffect(()=>{
    if(chatMsgsRef.current){
      chatMsgsRef.current.scrollTop=chatMsgsRef.current.scrollHeight;
    }
  },[chatMsgs]);

  // Scroll main content so the AI card is visible (double rAF = after browser reflow + scroll)
  const scrollCardIntoView=()=>{
    requestAnimationFrame(()=>{
      requestAnimationFrame(()=>{
        const main=chatBoxRef.current?.closest("main") as HTMLElement|null;
        if(main) main.scrollTop=0;
      });
    });
  };

  const sendChat=async()=>{
    const q=chatInput.trim();
    if(!q||chatLoading) return;
    const newMsgs:ChatMsg[]=[...chatMsgs,{role:"user",content:q}];
    setChatMsgs(newMsgs);
    setChatInput("");
    textareaRef.current?.blur(); // prevent browser from re-scrolling to keep input in view
    scrollCardIntoView();
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
      <div ref={chatBoxRef} className="bg-[#0b0f1a] border border-[#1a1f2e] rounded-xl overflow-hidden">
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
          <div ref={chatMsgsRef} className="px-5 py-4 space-y-4 max-h-72 overflow-y-auto">
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
          </div>
        )}

        {/* Input */}
        <div className="px-4 py-3 border-t border-[#0f1420] flex gap-2 items-end">
          <textarea
            ref={textareaRef}
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
const MAX_LEV_H=1.8;
function computeMonthLev(benchRaw:number[],dates:string[],rebalDateStr:string,targetVol:number):number{
  if(!benchRaw.length||!dates.length||targetVol<=0) return 1;
  const idx=dates.findIndex(d=>d>=rebalDateStr);
  const i=idx<0?dates.length-1:idx;
  let sumSq=0,cnt=0;
  for(let j=Math.max(1,i-60);j<i;j++){
    const p=benchRaw[j-1]!;
    const rj=p>0?benchRaw[j]!/p-1:0;
    sumSq+=rj*rj;cnt++;
  }
  const rv=cnt>4?Math.sqrt(sumSq/cnt*252):targetVol;
  return Math.max(1.0,Math.min(MAX_LEV_H,targetVol/rv));
}
function HistoricoPage({sortedMonths,dates,equityRaw,benchRaw,marginEnabled,profileFactor}:{sortedMonths:MonthRec[];dates:string[];equityRaw:number[];benchRaw:number[];marginEnabled:boolean;profileFactor:number}) {
  const [histTab,setHistTab]=useState<"reco"|"ops"|"carteira">("reco");
  const [expandedIdx,setExpandedIdx]=useState<number|null>(null);
  const DMIN=1;

  // Pre-compute targetVol for leverage estimation
  const targetVol=useMemo(()=>{
    if(!benchRaw.length) return 0;
    const bRets=benchRaw.slice(1).map((v,i)=>benchRaw[i]!>0?v/benchRaw[i]!-1:0);
    return annualVol(bRets)*profileFactor;
  },[benchRaw,profileFactor]);

  const histRows=useMemo(()=>[...sortedMonths].reverse().map((m,i)=>{
    const raw=m.date??m.rebalance_date??"";
    // Show the month the portfolio is applied in (next month after rebalancing date)
    const label=raw?(()=>{const d=new Date(raw);d.setUTCMonth(d.getUTCMonth()+1,1);return d.toLocaleDateString("pt-PT",{month:"long",year:"numeric"});})():raw;
    const prevM=sortedMonths[sortedMonths.length-1-i-1];
    // XEON (MM Euro) + equities allocation
    const xeonPct=m.tbillsTotalPct??0;
    // When margin is enabled and no XEON, compute vol-targeted leverage
    const lev=(marginEnabled&&xeonPct<=0.5&&raw)
      ?computeMonthLev(benchRaw,dates,raw,targetVol):1.0;
    const equityPct=(100-xeonPct)*lev;
    const prevXeonPct=prevM?.tbillsTotalPct??0;
    const prevLev=(marginEnabled&&prevXeonPct<=0.5&&(prevM?.date??prevM?.rebalance_date??""))
      ?computeMonthLev(benchRaw,dates,prevM?.date??prevM?.rebalance_date??"",targetVol):1.0;
    const prevEquityPct=(100-prevXeonPct)*prevLev;
    const xeonDelta=xeonPct-prevXeonPct;
    const equityDelta=equityPct-prevEquityPct;
    const pm=new Map((prevM?.rows??[]).map(r=>[r.ticker,r.weightPct??0]));
    const cm=new Map(m.rows.map(r=>[r.ticker,r.weightPct??0]));
    const WMIN=0.5; // only count tickers with meaningful weight in either month
    const tickers=[...new Set([...pm.keys(),...cm.keys()])].filter(t=>{
      if(t==="TBILL_PROXY"||t.startsWith("TBILL")||t.startsWith("CASH")||t==="XEON") return false;
      return Math.max(pm.get(t)??0, cm.get(t)??0)>=WMIN;
    });
    type TW={t:string;w:number};
    const comprasRaw:TW[]=[],aumentosRaw:TW[]=[],vendasRaw:TW[]=[],reducoesRaw:TW[]=[],manter:TW[]=[];
    tickers.forEach(t=>{
      const p=pm.get(t)??0,cu=cm.get(t)??0,d=cu-p;
      if(p<WMIN&&cu>=WMIN) comprasRaw.push({t,w:cu});
      else if(cu<WMIN&&p>=WMIN) vendasRaw.push({t,w:p});
      else if(d>=DMIN) aumentosRaw.push({t,w:cu});
      else if(d<=-DMIN) reducoesRaw.push({t,w:cu});
      else if(cu>=WMIN) manter.push({t,w:cu});
    });
    const compras=dedupTW(comprasRaw);
    const vendas=dedupTW(vendasRaw);
    const aumentos=dedupTW(aumentosRaw);
    const reducoes=dedupTW(reducoesRaw);
    const rebalDate=raw?new Date(raw):null;
    const getMiniPts=():Array<{date:string;v:number}>|null=>{
      if(!rebalDate||!dates.length) return null;
      const idx=dates.findIndex(d=>new Date(d)>=rebalDate);
      const start=Math.max(0,idx-63);
      const end=Math.min(dates.length-1,idx+63);
      const base=equityRaw[start]??1;
      const pts:Array<{date:string;v:number}>=[];
      for(let j=start;j<=end;j++){
        pts.push({date:dates[j]!.slice(0,10),v:+((equityRaw[j]??base)/base*100).toFixed(2)});
      }
      return pts;
    };
    const isLatest=i===0;
    const estado=isLatest?"Recente":"Aprovado";
    const estadoStyle=isLatest?"bg-blue-500/20 text-blue-400":"bg-emerald-500/15 text-emerald-400";
    const resumo=compras.length
      ?`Comprar ${compras.slice(0,2).map(x=>x.t).join(", ")}${compras.length>2?` +${compras.length-2}`:""}${vendas.length?` · Vender ${vendas.slice(0,1).map(x=>x.t).join(", ")}${vendas.length>1?` +${vendas.length-1}`:""}`:""}`
      :aumentos.length
        ?`Reforçar ${aumentos.slice(0,2).map(x=>x.t).join(", ")}${reducoes.length?` · Reduzir ${reducoes.slice(0,1).map(x=>x.t).join(", ")}`:""}${vendas.length?` · Vender ${vendas.slice(0,1).map(x=>x.t).join(", ")}`:""}`
      :vendas.length
        ?`Vender ${vendas.slice(0,2).map(x=>x.t).join(", ")}${vendas.length>2?` +${vendas.length-2}`:""}${reducoes.length?` · Reduzir ${reducoes.slice(0,1).map(x=>x.t).join(", ")}`:""}`
      :reducoes.length
        ?`Reduzir ${reducoes.slice(0,2).map(x=>x.t).join(", ")}${reducoes.length>2?` +${reducoes.length-2}`:""}`
        :"Sem alterações significativas";
    return {label,compras,aumentos,vendas,reducoes,manter,getMiniPts,isLatest,estado,estadoStyle,resumo,xeonPct,equityPct,xeonDelta,equityDelta,lev};
  }),[sortedMonths,dates,equityRaw,benchRaw,marginEnabled,targetVol]);

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
                  <td className="px-5 py-3 max-w-xs">
                    <div className="text-slate-400 truncate text-xs">{r.resumo}</div>
                    <div className="flex items-center gap-2 mt-1">
                      {r.xeonPct>0&&(
                        <span className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 text-[10px] font-semibold">
                          MM {r.xeonPct.toFixed(0)}%
                          {r.xeonDelta!==0&&<span className={r.xeonDelta>0?"text-amber-300":"text-slate-500"}>{r.xeonDelta>0?"+":""}{r.xeonDelta.toFixed(0)}pp</span>}
                        </span>
                      )}
                      <span className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold ${r.equityPct>101?"bg-orange-500/15 text-orange-400":r.xeonPct>0?"bg-slate-700/50 text-slate-400":"bg-emerald-500/10 text-emerald-400"}`}>
                        Acc {r.equityPct.toFixed(0)}%{r.lev>1.01?` ×${r.lev.toFixed(2)}`:""}
                        {r.equityDelta!==0&&<span className={r.equityDelta>0?"text-emerald-300":"text-slate-500"}>{r.equityDelta>0?"+":""}{r.equityDelta.toFixed(0)}pp</span>}
                      </span>
                    </div>
                  </td>
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
                                  <XAxis dataKey="date" tick={{fontSize:8,fill:"#475569"}} tickLine={false} axisLine={false}
                                    interval={Math.floor(pts.length/4)}
                                    tickFormatter={(d:string)=>d.slice(5)}/>
                                  <YAxis tick={{fontSize:8,fill:"#475569"}} tickLine={false} axisLine={false} tickFormatter={v=>`${Number(v).toFixed(0)}`} domain={["dataMin-1","dataMax+1"]}/>
                                  <ReferenceLine y={100} stroke="#1e293b" strokeDasharray="3 3"/>
                                  <Tooltip formatter={(v:number)=>[`${Number(v).toFixed(1)}`,"Modelo (base 100)"]}
                                    labelFormatter={(d:string)=>d}
                                    contentStyle={{background:"#0f172a",border:"1px solid #3b82f6",borderRadius:6,fontSize:10,color:"#e2e8f0"}}
                                    labelStyle={{color:"#94a3b8"}} itemStyle={{color:"#60a5fa"}}/>
                                  <Line type="monotone" dataKey="v" stroke="#60a5fa" strokeWidth={1.5} dot={false}/>
                                </LineChart>
                              </ResponsiveContainer>
                            );
                          })()}
                        </div>
                        <div className="grid grid-cols-2 gap-x-5 gap-y-3 text-[11px] content-start">
                          {/* Allocation summary row */}
                          <div className="col-span-2 flex items-center gap-3 mb-1 pb-2 border-b border-[#1a1f2e]">
                            <div className="text-[10px] text-slate-500 font-semibold uppercase tracking-wide">Alocação</div>
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${r.xeonPct>0?"bg-amber-500/15 text-amber-400":"bg-slate-700/30 text-slate-600"}`}>
                              MM Euro {r.xeonPct.toFixed(1)}%{r.xeonDelta!==0?` (${r.xeonDelta>0?"+":""}${r.xeonDelta.toFixed(1)}pp)`:""}
                            </span>
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${r.equityPct>101?"bg-orange-500/15 text-orange-400":"bg-emerald-500/10 text-emerald-400"}`}>
                              Acções {r.equityPct.toFixed(1)}%{r.lev>1.01?` ⚡ ×${r.lev.toFixed(2)} alavancado`:""}{r.equityDelta!==0?` (${r.equityDelta>0?"+":""}${r.equityDelta.toFixed(1)}pp)`:""}
                            </span>
                          </div>
                          {r.compras.length>0&&(
                            <div>
                              <div className="text-emerald-400 font-bold mb-1.5">▲ Comprar</div>
                              {r.compras.map(({t,w})=>{const cn=(COMPANY[t.toUpperCase()]||"").replace(/\s+[A-C]$/,"").trim();return(
                                <div key={t} className="py-0.5 flex items-baseline gap-1">
                                  <span className="font-mono text-slate-200">{t}</span>
                                  <span className="text-emerald-300 text-[10px] font-semibold">{w.toFixed(1)}%</span>
                                  {cn&&<span className="text-slate-600 text-[10px]">{cn}</span>}
                                </div>
                              );})}
                            </div>
                          )}
                          {r.aumentos.length>0&&(
                            <div>
                              <div className="text-cyan-400 font-bold mb-1.5">↑ Reforçar</div>
                              {r.aumentos.map(({t,w})=>{const cn=(COMPANY[t.toUpperCase()]||"").replace(/\s+[A-C]$/,"").trim();return(
                                <div key={t} className="py-0.5 flex items-baseline gap-1">
                                  <span className="font-mono text-slate-200">{t}</span>
                                  <span className="text-cyan-300 text-[10px] font-semibold">{w.toFixed(1)}%</span>
                                  {cn&&<span className="text-slate-600 text-[10px]">{cn}</span>}
                                </div>
                              );})}
                            </div>
                          )}
                          {r.vendas.length>0&&(
                            <div>
                              <div className="text-red-400 font-bold mb-1.5">▼ Vender</div>
                              {r.vendas.map(({t,w})=>{const cn=(COMPANY[t.toUpperCase()]||"").replace(/\s+[A-C]$/,"").trim();return(
                                <div key={t} className="py-0.5 flex items-baseline gap-1">
                                  <span className="font-mono text-slate-200">{t}</span>
                                  <span className="text-red-400 text-[10px] font-semibold">{w.toFixed(1)}%</span>
                                  {cn&&<span className="text-slate-600 text-[10px]">{cn}</span>}
                                </div>
                              );})}
                            </div>
                          )}
                          {r.reducoes.length>0&&(
                            <div>
                              <div className="text-amber-400 font-bold mb-1.5">↓ Reduzir</div>
                              {r.reducoes.map(({t,w})=>{const cn=(COMPANY[t.toUpperCase()]||"").replace(/\s+[A-C]$/,"").trim();return(
                                <div key={t} className="py-0.5 flex items-baseline gap-1">
                                  <span className="font-mono text-slate-200">{t}</span>
                                  <span className="text-amber-300 text-[10px] font-semibold">{w.toFixed(1)}%</span>
                                  {cn&&<span className="text-slate-600 text-[10px]">{cn}</span>}
                                </div>
                              );})}
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
function OrdensPage({actionCounts,latestMonth,recoLabel,aum,loggedIn,onBack,onShowRegister,profileLabel,fxExposure,marginEnabled,prices}:{
  actionCounts:{comprar:number;aumentar:number;reduzir:number;vender:number;manter:number;
    rows:{ticker:string;prev:number;cur:number;delta:number;action:string}[];
    allRows:{ticker:string;prev:number;cur:number;delta:number;action:string}[];};
  latestMonth:{rows:{ticker:string;weightPct:number}[];tbillsTotalPct?:number}|null;
  recoLabel:string;aum:number;loggedIn:boolean;onBack:()=>void;onShowRegister:()=>void;
  profileLabel:string;fxExposure:string;marginEnabled:boolean;
  prices:Record<string,{price:number;currency:string}|null>;
}) {
  const [sending,setSending]=React.useState(false);
  const [done,setDone]=React.useState(false);
  const [errMsg,setErrMsg]=React.useState("");
  const [orderRef,setOrderRef]=React.useState("");
  // Persist last submission across navigations — prevents accidental double-send
  const ORDERS_SENT_KEY="decide_orders_last_sent_v1";
  const [lastSent,setLastSent]=React.useState<{ref:string;ts:number;mode:string}|null>(()=>{
    try{const r=localStorage.getItem(ORDERS_SENT_KEY);return r?JSON.parse(r):null;}catch{return null;}
  });
  const [showSendConfirm,setShowSendConfirm]=React.useState(false);
  // Block re-send within 4 hours of a confirmed submission
  const recentlySent=React.useMemo(()=>lastSent?Date.now()-lastSent.ts<4*3600*1000:false,[lastSent]);
  type FillRow={ticker:string;action:string;requested_qty:number;filled:number;avg_fill_price?:number|null;status:string;message?:string|null;ib_order_id?:number|null;ib_perm_id?:number|null;executed_as?:string|null;fx_hedge_attached?:boolean};
  const [fills,setFills]=React.useState<FillRow[]>([]);
  const [paperMode,setPaperMode]=React.useState(false);
  const [showDiag,setShowDiag]=React.useState(false);
  // "full" = send entire plan (all positions); "delta" = send only this month's changes
  const [execMode,setExecMode]=React.useState<"full"|"delta">("full");
  // IB live positions (for orphan detection and "vender tudo")
  const [ibkrPos,setIbkrPos]=React.useState<{ticker:string;qty:number;value:number;weight_pct:number}[]|null>(null);
  const [ibkrOpenOrders,setIbkrOpenOrders]=React.useState<{ticker:string;side:string;remaining_qty:number;status:string}[]>([]);
  const [ibkrFxSupported,setIbkrFxSupported]=React.useState<boolean|null>(null);
  const [ibkrFxManualOverride,setIbkrFxManualOverride]=React.useState<boolean>(
    ()=>localStorage.getItem("ibkr_fx_disabled")==="1"
  );
  const ibkrFxBlocked=ibkrFxManualOverride||(ibkrFxSupported===false);
  const [ibkrAcctType,setIbkrAcctType]=React.useState("");
  const [ibkrLoading,setIbkrLoading]=React.useState(false);
  const [ibkrErr,setIbkrErr]=React.useState("");
  const [sellAllSending,setSellAllSending]=React.useState(false);
  const [sellAllResult,setSellAllResult]=React.useState<{ref:string;fills:number}|null>(null);
  const [sellAllFills,setSellAllFills]=React.useState<FillRow[]>([]);
  // Flatten (zerar) — fecha longs (SELL) E shorts (BUY to cover)
  const [flatSending,setFlatSending]=React.useState(false);
  const [flatResult,setFlatResult]=React.useState<{ref:string;longs:number;shorts:number}|null>(null);
  const [flatFills,setFlatFills]=React.useState<FillRow[]>([]);
  const [cancelSending,setCancelSending]=React.useState(false);
  const [cancelResult,setCancelResult]=React.useState<string|null>(null);
  const [pollCount,setPollCount]=React.useState(0);

  const fmtE=(v:number)=>v.toLocaleString("pt-PT",{minimumFractionDigits:2,maximumFractionDigits:2});
  const fmtEm=(v:number)=>Math.abs(v).toLocaleString("pt-PT",{minimumFractionDigits:2,maximumFractionDigits:2});

  // Auto-refresh fills by re-querying IB snapshot after submit (paper: fills are near-instant)
  React.useEffect(()=>{
    if(!done||paperMode||pollCount>0) return;
    const hasPending=fills.some(f=>f.status==="Submitted"||f.status==="PreSubmitted"||f.status==="PendingSubmit");
    if(!hasPending) return;
    // Wait 4s then re-fetch snapshot to confirm fills via IB positions
    const t=setTimeout(()=>setPollCount(1),4000);
    return ()=>clearTimeout(t);
  },[done,paperMode,fills,pollCount]);

  // Full plan: ALL positions (for display and "full" execution mode)
  const allPlanRows=actionCounts.allRows; // includes Manter

  // Plan tickers from the FULL model data (all rows, not just top-20)
  // This prevents model positions ranked 21+ being wrongly flagged as orphans
  const planTickerSet=React.useMemo(()=>{
    const s=new Set<string>();
    // All rows from the full monthly data with weight > 0
    (latestMonth?.rows??[]).forEach(r=>{
      if(r.weightPct>0&&r.ticker!=="TBILL_PROXY"&&!r.ticker.startsWith("CASH")&&!r.ticker.startsWith("TBILL"))
        s.add(r.ticker);
    });
    // Also add XEON (money market, always in plan if tbillsTotalPct > 0)
    if((latestMonth?.tbillsTotalPct??0)>0) s.add("XEON");
    // Fallback: also include anything from top-20 with cur>0 (in case latestMonth is null)
    allPlanRows.filter(r=>r.cur>0).forEach(r=>s.add(r.ticker));
    // Also add IB-alias equivalents so e.g. "BTI" (IB ticker for "BATS") is not flagged as orphan
    [...s].forEach(t=>{ const ib=toIbTicker(t); if(ib!==t) s.add(ib); });
    return s;
  },[latestMonth,allPlanRows]);
  // IB positions not in the current plan → "orphan"
  const orphanPositions=ibkrPos?ibkrPos.filter(p=>!planTickerSet.has(p.ticker)&&p.qty>0):[];

  async function fetchIbkrPositions(){
    setIbkrLoading(true);setIbkrErr("");
    try{
      const resp=await fetch("/api/ibkr-snapshot",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({paper_mode:true})});
      const j=await resp.json();
      if(j.status==="ok"){
        setIbkrPos(j.positions);
        setIbkrOpenOrders(j.open_orders??[]);
        if(typeof j.fx_supported==="boolean") setIbkrFxSupported(j.fx_supported);
        if(j.account_type) setIbkrAcctType(j.account_type);
        else if(j.meta?.account_type_raw) setIbkrAcctType(j.meta.account_type_raw);
      }
      else{setIbkrErr(j.error||"Erro ao obter posições IB");}
    }catch(e:unknown){setIbkrErr(e instanceof Error?e.message:"Erro de ligação");}
    finally{setIbkrLoading(false);}
  }

  // Auto-fetch IB positions + open orders every time this page mounts, so:
  // • adjustedOrderRows always deducts existing holdings
  // • pendingBuyTickers always reflects submitted-but-unfilled orders
  // This is the primary protection against duplicate order submission.
  React.useEffect(()=>{ void fetchIbkrPositions(); },[]);

  async function cancelPendingOrders(){
    setCancelSending(true);setCancelResult(null);setIbkrErr("");
    try{
      const resp=await fetch("/api/cancel-open-orders-paper",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({paper_mode:true})});
      const j=await resp.json().catch(()=>({}));
      if(resp.ok&&(j.status==="ok"||j.ok)){
        const n=j.cancellations?.length??j.cancelled??0;
        setCancelResult(`${n} ordem(ns) cancelada(s)`);
        setIbkrOpenOrders([]);
        logActivity({type:"cancelamento",label:`${n} ordem(ns) cancelada(s) na IB Gateway`,icon:"✕",color:"text-red-400"});
      } else {
        setCancelResult("Erro: "+(j.error||j.detail||`HTTP ${resp.status}`));
      }
    }catch(e:unknown){setCancelResult("Erro: "+(e instanceof Error?e.message:"ligação"));}
    finally{setCancelSending(false);}
  }

  async function sellAllPositions(){
    if(!ibkrPos||ibkrPos.length===0) return;
    setSellAllSending(true);setIbkrErr("");
    try{
      if(paperMode){
        await new Promise(r=>setTimeout(r,1400));
        setSellAllResult({ref:"SIM-SELLALL-"+Date.now().toString(36).toUpperCase(),fills:ibkrPos.length});
        return;
      }
      const body={
        orders:ibkrPos.filter(p=>p.qty>0).map(p=>({
          ticker:p.ticker,action:"Vender",delta_pct:0,
          est_eur:Math.abs(p.value),qty:p.qty,  // passa qty real — evita price lookup que pode falhar
        })),
        paper_mode:false,aum,profile:profileLabel,fx_exposure:fxExposure,margin_enabled:marginEnabled,
      };
      const resp=await fetch("/api/ibkr-orders",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
      const j=await resp.json();
      if(resp.ok&&j.ok){
        setSellAllResult({ref:j.order_ref||"ORD-"+Date.now().toString(36).toUpperCase(),fills:j.submitted??ibkrPos.length});
        setSellAllFills(j.fills??[]);
      } else{setIbkrErr(j.error||j.detail||`Erro ${resp.status}`);}
    }catch(e:unknown){setIbkrErr(e instanceof Error?e.message:"Erro de ligação");}
    finally{setSellAllSending(false);}
  }

  async function flattenAllPositions(){
    if(!ibkrPos||ibkrPos.length===0) return;
    const longs=ibkrPos.filter(p=>p.qty>0);
    const shorts=ibkrPos.filter(p=>p.qty<0);
    if(longs.length===0&&shorts.length===0) return;
    setFlatSending(true);setIbkrErr("");
    try{
      if(paperMode){
        await new Promise(r=>setTimeout(r,1400));
        setFlatResult({ref:"SIM-FLAT-"+Date.now().toString(36).toUpperCase(),longs:longs.length,shorts:shorts.length});
        return;
      }
      const orders=[
        // Close longs: SELL at actual qty
        ...longs.map(p=>({ticker:p.ticker,action:"Vender",est_eur:Math.abs(p.value),qty:p.qty})),
        // Close shorts: BUY TO COVER at actual qty (use negative qty → absolute)
        ...shorts.map(p=>({ticker:p.ticker,action:"Comprar",est_eur:Math.abs(p.value),qty:Math.abs(p.qty)})),
      ];
      const body={
        orders,
        paper_mode:false,aum,profile:profileLabel,
        fx_exposure:"nenhum",  // no FX hedge when flattening
        margin_enabled:marginEnabled,
        sell_cap_disabled:true,  // must bypass sell cap — shorts have qty < 0 in portfolio
      };
      const resp=await fetch("/api/ibkr-orders",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
      const j=await resp.json().catch(()=>({}));
      if(resp.ok&&j.status!=="rejected"&&j.status!=="error"){
        setFlatResult({ref:j.order_ref||"ORD-"+Date.now().toString(36).toUpperCase(),longs:longs.length,shorts:shorts.length});
        setFlatFills(j.fills??[]);
        setIbkrPos(null);  // force refresh
      } else {setIbkrErr(j.error||j.detail||`Erro ${resp.status}`);}
    }catch(e:unknown){setIbkrErr(e instanceof Error?e.message:"Erro de ligação");}
    finally{setFlatSending(false);}
  }

  // Delta rows: only changed positions (Comprar/Aumentar/Reduzir/Vender)
  const deltaRows=actionCounts.allRows.filter(r=>r.action!=="Manter");

  // Orders actually sent depend on execMode
  // In "full" mode: BUY all positions with cur>0, SELL positions with cur===0 (Vender)
  // In "delta" mode: only changed positions
  // US equities + known ADRs trading on US exchanges (SMART/USD) + XEON money market.
  const isOrderable=(t:string)=>isTradeableUS(t);

  const orderRows=execMode==="full"
    ? allPlanRows.filter(r=>isOrderable(r.ticker)&&(r.cur>0||r.action==="Vender"))
    : deltaRows.filter(r=>isOrderable(r.ticker));

  // Map IB ticker → EUR value currently held (IB positions use IB tickers e.g. "BTI" not "BATS")
  const MIN_ORDER_EUR=20; // minimum incremental buy to bother sending
  const ibkrHoldingsMap=React.useMemo(()=>{
    const m=new Map<string,number>();
    (ibkrPos??[]).forEach(p=>m.set(p.ticker.toUpperCase(),p.value));
    return m;
  },[ibkrPos]);

  // In "Construção inicial" mode: subtract what we already hold from BUY notional
  // so we only buy the DIFFERENCE needed to reach the target weight.
  type AdjRow={ticker:string;prev:number;cur:number;delta:number;action:string;
    estEur:number;heldEur:number;targetEur:number;adjEur:number;skipReason?:string};
  // Tickers com ordens BUY activas na IB (Submitted/PreSubmitted) — não comprar de novo
  const pendingBuyTickers=React.useMemo(()=>{
    const s=new Set<string>();
    ibkrOpenOrders.filter(o=>o.side==="BUY").forEach(o=>s.add(o.ticker.toUpperCase()));
    return s;
  },[ibkrOpenOrders]);

  const adjustedOrderRows:AdjRow[]=React.useMemo(()=>orderRows.map(r=>{
    const isFullExit=r.action==="Vender";
    const isSell=execMode==="full"?isFullExit:(r.action==="Vender"||r.action==="Reduzir");
    const targetEur=execMode==="full"
      ? (isFullExit?r.prev/100*aum:r.cur/100*aum)
      : Math.abs(r.delta)/100*aum;
    // Look up by IB ticker (e.g. BATS→BTI) since ibkrHoldingsMap is keyed by IB ticker
    const ibTicker=toIbTicker(r.ticker);
    const heldEur=ibkrHoldingsMap.get(ibTicker)??ibkrHoldingsMap.get(r.ticker.toUpperCase())??0;
    let adjEur=targetEur;
    let skipReason:string|undefined;
    if(!isSell){
      // Skip if there's already an active BUY order for this ticker in IB (any mode)
      if(pendingBuyTickers.has(ibTicker.toUpperCase())||pendingBuyTickers.has(r.ticker.toUpperCase())){
        adjEur=0;
        skipReason="Ordem de compra em curso na IB";
      } else if(heldEur>0){
        // Both modes: only buy/increase up to the shortfall vs current holding.
        // In delta mode this prevents amplifying already-overweight positions.
        // Target for delta mode: last month weight + delta = this month's target weight
        const effectiveTarget=execMode==="full"?targetEur:(r.cur/100*aum);
        adjEur=Math.max(0, effectiveTarget-heldEur);
        if(adjEur<MIN_ORDER_EUR)skipReason=adjEur<=0?"Já no alvo ou acima":"Incremento < €"+MIN_ORDER_EUR;
      }
    }
    // SELL: in delta mode, cap sell qty to what we actually hold (avoid shorting)
    if(isSell&&execMode==="delta"&&heldEur>0){
      adjEur=Math.min(targetEur, heldEur);
    }
    return {
      ...r,
      estEur:adjEur,
      heldEur,
      targetEur,
      adjEur,
      skipReason,
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }),[orderRows,execMode,aum,ibkrHoldingsMap,pendingBuyTickers]);

  const activeOrderRows=adjustedOrderRows.filter(r=>!r.skipReason&&r.adjEur>=MIN_ORDER_EUR||r.action==="Vender");
  const nOrdens=activeOrderRows.length;

  // For summary financials — use adjusted amounts
  // In full mode: every non-Vender row is effectively a buy (adjEur already accounts for existing holding)
  // In delta mode: only Comprar/Aumentar are buys; Reduzir are sells
  const investEur=activeOrderRows.filter(r=>{
    if(r.action==="Vender") return false;
    if(execMode==="delta"&&r.action==="Reduzir") return false;
    return true;
  }).reduce((s,r)=>s+r.adjEur,0);
  const reduceEur=activeOrderRows.filter(r=>r.action==="Vender"||(execMode==="delta"&&r.action==="Reduzir")).reduce((s,r)=>s+r.adjEur,0);
  const totalBuyPct=investEur/aum*100;
  const totalSellPct=reduceEur/aum*100;
  const tradeCost=Math.max(2.0,nOrdens*0.7);

  async function submitOrders() {
    setErrMsg("");
    setShowSendConfirm(false);
    setSending(true);
    try {
      if(paperMode){
        // Simulate locally — no backend required for paper trading
        await new Promise(r=>setTimeout(r,1200));
        setOrderRef("SIM-"+Date.now().toString(36).toUpperCase());
        setDone(true);
        return;
      }
      // ── Build order payload ──────────────────────────────────────────────
      // Uses activeOrderRows (already adjusted for existing IB holdings):
      //   • "Construção inicial": BUY only the shortfall vs. current position
      //   • "Rebalanceamento": trade only the delta vs. previous month
      const body={
        orders:activeOrderRows.map(r=>{
          const isFullExit=r.action==="Vender";
          const isBuy=execMode==="full"
            ?!isFullExit
            :(r.action==="Comprar"||r.action==="Aumentar");
          const isSell=execMode==="full"
            ?isFullExit
            :(r.action==="Vender"||r.action==="Reduzir");
          const side=isBuy?"Comprar":isSell?"Vender":"Comprar";
          // Translate plan ticker → IB US ticker (e.g. BATS → BTI)
          const ibTick=toIbTicker(r.ticker);
          const refP=prices[r.ticker]??prices[ibTick]??null;
          return {ticker:ibTick, action:side, est_eur:Math.max(0,r.adjEur), ref_price:refP?.price??null};
        }).filter(o=>o.est_eur>=MIN_ORDER_EUR||o.action==="Vender"),
        paper_mode:false,profile:profileLabel,
        fx_exposure:ibkrFxBlocked?"aberta":fxExposure,margin_enabled:marginEnabled,aum,
      };
      const resp=await fetch("/api/ibkr-orders",{
        method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)
      });
      const j=await resp.json().catch(()=>({}));
      // Check both HTTP status AND JSON status (backend can return 200 with error body)
      if(resp.ok&&j.status!=="rejected"&&j.status!=="error"){
        const ref=j.order_ref??"ORD-"+Date.now().toString(36).toUpperCase();
        setOrderRef(ref);
        setFills(j.fills??[]);
        setPollCount(0);
        setDone(true);
        // Persist submission so re-mount/navigation shows the warning
        const sent={ref,ts:Date.now(),mode:execMode};
        try{localStorage.setItem(ORDERS_SENT_KEY,JSON.stringify(sent));}catch{}
        setLastSent(sent);
        const fills:Array<{ticker:string;side:string;qty:number}>=j.fills??[];
        const buys=fills.filter((f)=>f.side==="BUY");
        const sells=fills.filter((f)=>f.side==="SELL");
        logActivity({
          type:"ordens",
          label:`${fills.length} ordem(ns) submetida(s) · ${ref}`,
          detail:[
            buys.length?`Compras: ${buys.map(f=>f.ticker).join(", ")}`:"",
            sells.length?`Vendas: ${sells.map(f=>f.ticker).join(", ")}`:"",
          ].filter(Boolean).join(" · ")||"Sem detalhes de fills",
          icon:"▲",color:"text-emerald-400",
        });
      } else {
        setErrMsg(j.error||j.detail||`Erro ${resp.status} — o backend FastAPI e a IB Gateway têm de estar activos para envio real.`);
        logActivity({type:"ordens",label:`Erro ao submeter ordens`,detail:j.error||j.detail||`HTTP ${resp.status}`,icon:"✕",color:"text-red-400"});
      }
    } catch(e:unknown){
      setErrMsg((e instanceof Error?e.message:"Falha de ligação")+" — verifique a ligação ao backend.");
    } finally { setSending(false); }
  }

  const stepsDef=[
    {n:1,label:"Revisão do plano",done:true},
    {n:2,label:"Confirmação",active:!done},
    {n:3,label:"Envio para IB",active:done},
  ];

  return (
    <div className="space-y-4">
      {/* Back link */}
      <button onClick={onBack} className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-300 transition-colors -mt-1">
        <ArrowUpRight size={12} className="rotate-[225deg]"/>Voltar ao plano
      </button>

      {/* Step progress */}
      <div className="flex items-center gap-0 bg-[#0b0f1a] border border-[#1a1f2e] rounded-xl px-6 py-4">
        {stepsDef.map((s,i)=>(
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
            {i<stepsDef.length-1&&<div className="flex-1 h-px bg-[#1a1f2e] mx-4"/>}
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

          {/* Exec mode toggle + Order list */}
          <div className="bg-[#0b0f1a] border border-[#1a1f2e] rounded-xl p-5">
            <div className="flex items-center justify-between mb-3">
              <div className="font-bold text-slate-200 text-sm">Lista de ordens</div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-slate-500">{allPlanRows.length} posições no plano</span>
                {/* execMode toggle */}
                <div className="flex rounded-lg border border-[#252a3a] overflow-hidden text-[10px] font-semibold">
                  <button onClick={()=>setExecMode("full")}
                    className={`px-3 py-1.5 transition-colors ${execMode==="full"?"bg-blue-600 text-white":"text-slate-400 hover:text-slate-200"}`}
                    title="Construção inicial: compra todas as posições ao peso-alvo. Ideal para conta vazia.">
                    Construção inicial
                  </button>
                  <button onClick={()=>setExecMode("delta")}
                    className={`px-3 py-1.5 transition-colors border-l border-[#252a3a] ${execMode==="delta"?"bg-blue-600 text-white":"text-slate-400 hover:text-slate-200"}`}
                    title="Rebalanceamento: envia apenas as ordens com alteração ≥ 1 pp face ao mês anterior.">
                    Rebalanceamento
                  </button>
                </div>
              </div>
            </div>
            <div className="text-[10px] text-slate-500 mb-3">
              {execMode==="full"
                ? `Construção inicial: ${nOrdens} ordens BUY ao peso-alvo (para conta vazia ou reset completo)`
                : `Rebalanceamento: ${nOrdens} ordens com alteração ≥ 1 pp face ao mês anterior`}
            </div>
            <table className="w-full text-xs">
              <thead><tr className="text-slate-500 border-b border-[#1a1f2e] text-left">
                <th className="pb-2 font-semibold">Ativo</th>
                <th className="pb-2 font-semibold">Ação</th>
                <th className="pb-2 font-semibold text-right">
                  <span title="Peso no plano do mês anterior">Mês ant.</span>
                </th>
                <th className="pb-2 font-semibold text-right">
                  <span title="Peso alvo no plano deste mês">Este mês</span>
                </th>
                <th className="pb-2 font-semibold text-right">Δ Peso</th>
                <th className="pb-2 font-semibold text-right">Val. estimado</th>
              </tr></thead>
              <tbody>
                {allPlanRows.map(r=>{
                  const isManter=r.action==="Manter";
                  const isBuy=r.action==="Comprar";const isUp=r.action==="Aumentar";
                  const isSell=r.action==="Vender";
                  const inExec=activeOrderRows.some(x=>x.ticker===r.ticker);
                  const notOrderable=!isOrderable(r.ticker);
                  const adjRow=adjustedOrderRows.find(x=>x.ticker===r.ticker);
                  const heldEur=ibkrHoldingsMap.get(toIbTicker(r.ticker))??ibkrHoldingsMap.get(r.ticker.toUpperCase())??0;
                  const acBg=isManter?"bg-slate-700/30 text-slate-500 border-slate-700/50":
                             isBuy?"bg-emerald-500/15 text-emerald-300 border-emerald-500/30":
                             isUp?"bg-cyan-500/15 text-cyan-300 border-cyan-500/30":
                             isSell?"bg-red-500/15 text-red-300 border-red-500/30":
                             "bg-amber-500/15 text-amber-300 border-amber-500/30";
                  const acIcon=isManter?"=":isBuy?"↑":isUp?"↗":isSell?"↓":"↙";
                  const skipped=adjRow?.skipReason;
                  const displayVal=adjRow?adjRow.adjEur:(execMode==="full"?(isSell?r.prev/100*aum:r.cur/100*aum):Math.abs(r.delta)/100*aum);
                  return (
                    <tr key={r.ticker} className={`border-b border-[#111520] hover:bg-white/[0.02] ${(isManter&&execMode==="delta")||notOrderable||skipped?"opacity-40":""}`}>
                      <td className="py-2.5">
                        <a href={`https://finance.yahoo.com/quote/${getYFTicker(r.ticker)}`} target="_blank" rel="noopener noreferrer"
                          className={`font-bold hover:underline ${inExec?"text-blue-400":skipped?"text-slate-600":"text-slate-500"}`}>{displayTicker(r.ticker)}</a>
                        {notOrderable&&<span className="ml-1 text-[9px] text-amber-600" title="Não listada nos EUA — excluída do envio à IB">⚠ não-US</span>}
                        {!notOrderable&&toIbTicker(r.ticker)!==r.ticker.toUpperCase()&&
                          <span className="ml-1 text-[9px] text-sky-500" title={`Enviado à IB como ${toIbTicker(r.ticker)}`}>→ {toIbTicker(r.ticker)}</span>}
                        {skipped&&<span className="ml-1 text-[9px] text-slate-600" title={adjRow?.skipReason}>✓ {adjRow?.skipReason}</span>}
                        {!notOrderable&&!inExec&&!skipped&&execMode==="delta"&&<span className="ml-1 text-[9px] text-slate-600">(não enviada)</span>}
                      </td>
                      <td className="py-2.5">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border ${acBg}`}>
                          <span className="font-black">{acIcon}</span>{r.action}
                        </span>
                      </td>
                      <td className="py-2.5 text-right text-slate-400">{r.prev.toFixed(1)}%</td>
                      <td className="py-2.5 text-right text-slate-300">{r.cur.toFixed(1)}%</td>
                      <td className={`py-2.5 text-right font-semibold ${r.delta>0?"text-emerald-400":r.delta<0?"text-red-400":"text-slate-500"}`}>
                        {r.delta>0?"+":""}{r.delta.toFixed(2)}%
                      </td>
                      <td className={`py-2.5 text-right font-semibold ${inExec?(isSell?"text-amber-400":"text-emerald-400"):skipped?"text-slate-600":"text-slate-600"}`}>
                        {(inExec||skipped)?(
                          <div className="flex flex-col items-end gap-0.5">
                            <span>{inExec?`€ ${fmtEm(displayVal)}`:"—"}</span>
                            {heldEur>0&&execMode==="full"&&!isSell&&(
                              <span className="text-[9px] text-slate-500" title={`Tens €${fmtEm(heldEur)} em carteira. Alvo: €${fmtEm(adjRow?.targetEur??0)}`}>
                                já tens € {fmtEm(heldEur)}
                              </span>
                            )}
                          </div>
                        ):"—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-[#252a3a] bg-[#0b0f1a]">
                  <td colSpan={2} className="py-2.5 text-xs font-bold text-slate-400">
                    {nOrdens} ordens a enviar
                    {ibkrPos&&execMode==="full"&&<span className="ml-1.5 text-[10px] font-normal text-sky-400" title="Valores ajustados para posições já existentes na carteira IB">· ajustado vs carteira IB</span>}
                  </td>
                  <td className="py-2.5 text-right text-xs text-slate-500">—</td>
                  <td className="py-2.5 text-right text-xs text-slate-500">—</td>
                  <td className="py-2.5 text-right text-xs text-slate-500">—</td>
                  <td className="py-2.5 text-right text-xs font-black text-emerald-400">
                    € {fmtEm(investEur+reduceEur)}
                  </td>
                </tr>
                {aum>0&&(
                  <tr className="bg-[#080c14]">
                    <td colSpan={5} className="py-2 text-xs font-bold text-slate-200">Montante de referência (NAV)</td>
                    <td className="py-2 text-right text-xs font-black text-white">€ {fmtEm(aum)}</td>
                  </tr>
                )}
              </tfoot>
            </table>
          </div>

          {/* Mode-specific warning */}
          {execMode==="full"?(
            <div className="flex items-start gap-3 bg-amber-500/[0.08] border border-amber-500/30 rounded-xl px-4 py-4">
              <AlertTriangle size={15} className="text-amber-400 shrink-0 mt-0.5"/>
              <div>
                <div className="text-xs font-bold text-amber-300 mb-1">Construção inicial — compra a diferença para o peso-alvo</div>
                <div className="text-xs text-slate-400 space-y-1">
                  <p>Para cada posição do plano, compra apenas a <strong className="text-slate-300">diferença entre o peso-alvo e o que já tens em carteira</strong>. Posições acima do alvo não são reduzidas.</p>
                  <p>Para ajustar posições que excedem o alvo, usa o modo <strong className="text-slate-300">Rebalanceamento</strong> que envia tanto compras como vendas parciais.</p>
                </div>
              </div>
            </div>
          ):(
            <div className="flex items-start gap-3 bg-blue-500/[0.06] border border-blue-500/20 rounded-xl px-4 py-4">
              <Info size={15} className="text-blue-400 shrink-0 mt-0.5"/>
              <div>
                <div className="text-xs font-bold text-blue-300 mb-1">Rebalanceamento mensal</div>
                <div className="text-xs text-slate-400">
                  Apenas as posições com variação ≥ 1 pp face ao mês anterior são enviadas. O tamanho de cada ordem corresponde ao <strong className="text-slate-300">delta de peso × montante NAV</strong>.
                </div>
              </div>
            </div>
          )}

          {/* Paper mode toggle */}
          <div className="flex items-center justify-between bg-[#0b0f1a] border border-[#1a1f2e] rounded-xl px-4 py-3">
            <div>
              <div className="text-xs font-semibold text-slate-300">Simulação local (não envia à IB)</div>
              <div className="text-[10px] text-slate-500">Ligado = apenas animação local, sem ordens reais · Desligado = envia ordens ao IB Gateway (paper ou real)</div>
            </div>
            <button onClick={()=>setPaperMode(v=>!v)}
              className={`w-11 h-6 rounded-full transition-colors relative ${paperMode?"bg-blue-600":"bg-slate-700"}`}>
              <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${paperMode?"translate-x-5":"translate-x-0.5"}`}/>
            </button>
          </div>

          {/* ── Diagnóstico / Testes ─────────────────────────────────────── */}
          <div className="bg-[#080c14] border border-amber-500/20 rounded-xl p-4">
            <div className="flex items-center justify-between">
              <button onClick={()=>setShowDiag(v=>!v)}
                className="flex items-center gap-2 hover:opacity-80 transition-opacity">
                <AlertTriangle size={13} className="text-amber-400"/>
                <span className="text-xs font-bold text-amber-300">Diagnóstico de carteira IB</span>
                <span className="text-[10px] text-slate-500">— ferramentas de teste</span>
                <span className="text-[10px] text-slate-600 ml-1">{showDiag?"▲":"▼"}</span>
              </button>
              {showDiag&&(
                <button onClick={fetchIbkrPositions} disabled={ibkrLoading}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-semibold bg-[#111827] border border-[#252a3a] text-slate-300 rounded-lg hover:bg-[#1a1f2e] disabled:opacity-50 transition-colors">
                  {ibkrLoading?<span className="animate-spin text-xs">⟳</span>:<Activity size={11}/>}
                  {ibkrLoading?"A carregar…":"Verificar carteira IB"}
                </button>
              )}
            </div>
            {!showDiag&&<div className="text-[10px] text-slate-600 mt-1">Clique para expandir · verifica posições IB e permite vender toda a carteira</div>}
            {showDiag&&(
              <div className="mt-3 space-y-3">
                {ibkrErr&&(
                  <div className="text-[10px] text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{ibkrErr}</div>
                )}
                {ibkrPos&&(
                  <>
                    {orphanPositions.length>0&&(
                      <div>
                        <div className="text-[10px] font-semibold text-amber-400 mb-1.5">
                          Posições fora do plano ({orphanPositions.length}) — candidatas a vender
                        </div>
                        <table className="w-full text-[10px]">
                          <thead><tr className="text-slate-600 border-b border-[#1a1f2e]">
                            <th className="text-left pb-1">Ticker</th>
                            <th className="text-right pb-1">Qtd</th>
                            <th className="text-right pb-1">Valor</th>
                            <th className="text-right pb-1">Peso %</th>
                          </tr></thead>
                          <tbody>
                            {orphanPositions.map(p=>(
                              <tr key={p.ticker} className="border-b border-[#111520]">
                                <td className="py-1.5 font-bold text-amber-400">
                                  <a href={`https://finance.yahoo.com/quote/${p.ticker}`} target="_blank" rel="noopener noreferrer" className="hover:underline">{displayTicker(p.ticker)}</a>
                                </td>
                                <td className="py-1.5 text-right text-slate-300">{p.qty.toFixed(0)}</td>
                                <td className="py-1.5 text-right text-slate-300">€ {fmtE(Math.abs(p.value))}</td>
                                <td className="py-1.5 text-right text-amber-300">{(p.value/aum*100).toFixed(2)}%</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                    <div className="text-[10px] text-slate-500">
                      {ibkrPos.length} posições activas na IB
                      {orphanPositions.length>0?` · ${orphanPositions.length} fora do plano`:` · todas no plano`}
                      {ibkrOpenOrders.length>0&&` · ${ibkrOpenOrders.length} ordem(ns) em curso`}
                      {ibkrAcctType&&` · conta ${ibkrAcctType} · FX ${ibkrFxBlocked?"bloqueado":"suportado"}`}
                    </div>
                    {/* Manual FX override toggle */}
                    <div className="flex items-center gap-2 px-1 py-1">
                      <label className="flex items-center gap-2 cursor-pointer select-none">
                        <div
                          onClick={()=>{
                            const next=!ibkrFxManualOverride;
                            setIbkrFxManualOverride(next);
                            if(next) localStorage.setItem("ibkr_fx_disabled","1");
                            else localStorage.removeItem("ibkr_fx_disabled");
                          }}
                          className={`relative w-8 h-4 rounded-full transition-colors ${ibkrFxManualOverride?"bg-red-700":"bg-emerald-700"}`}
                        >
                          <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform ${ibkrFxManualOverride?"translate-x-4":"translate-x-0.5"}`}/>
                        </div>
                        <span className="text-[10px] text-slate-400">
                          {ibkrFxManualOverride
                            ?"FX desactivado manualmente (conta Caixa)"
                            :"FX activo — desactivar se conta for Caixa"}
                        </span>
                      </label>
                    </div>
                    {/* Open orders live table */}
                    <div className="bg-[#0b0f1a] border border-[#1a1f2e] rounded-lg overflow-hidden">
                      <div className="flex items-center justify-between px-3 py-2 border-b border-[#1a1f2e]">
                        <span className="text-[10px] font-semibold text-slate-300">
                          Ordens abertas na IB (live) — {ibkrOpenOrders.length===0?"nenhuma":ibkrOpenOrders.length}
                        </span>
                        <button onClick={fetchIbkrPositions} disabled={ibkrLoading}
                          className="text-[9px] text-sky-400 hover:text-sky-300 disabled:opacity-50">
                          {ibkrLoading?"…":"↺ Actualizar"}
                        </button>
                      </div>
                      {ibkrOpenOrders.length===0?(
                        <div className="px-3 py-2 text-[10px] text-slate-600 italic">
                          Nenhuma ordem pendente na IB Gateway
                        </div>
                      ):(
                        <table className="w-full text-[10px]">
                          <thead>
                            <tr className="text-slate-600 border-b border-[#1a1f2e]">
                              <th className="text-left px-3 py-1.5">Ticker</th>
                              <th className="text-left px-2 py-1.5">Lado</th>
                              <th className="text-right px-2 py-1.5">Qtd. restante</th>
                              <th className="text-left px-2 py-1.5">Estado</th>
                            </tr>
                          </thead>
                          <tbody>
                            {ibkrOpenOrders.map((o,i)=>(
                              <tr key={i} className="border-b border-[#111827] last:border-0">
                                <td className="px-3 py-1.5 font-mono text-slate-200 font-semibold">{o.ticker}</td>
                                <td className="px-2 py-1.5">
                                  <span className={`font-bold ${o.side==="BUY"?"text-emerald-400":"text-red-400"}`}>
                                    {o.side==="BUY"?"▲ BUY":"▼ SELL"}
                                  </span>
                                </td>
                                <td className="px-2 py-1.5 text-right text-slate-300">{o.remaining_qty.toFixed(0)}</td>
                                <td className="px-2 py-1.5">
                                  <span className={`px-1.5 py-0.5 rounded text-[9px] font-semibold ${
                                    o.status==="Submitted"?"bg-amber-500/20 text-amber-300":
                                    o.status==="PreSubmitted"?"bg-sky-500/20 text-sky-300":
                                    "bg-slate-700 text-slate-400"}`}>
                                    {o.status}
                                  </span>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>
                    {/* Short positions warning */}
                    {ibkrPos.some(p=>p.qty<0)&&(
                      <div className="flex items-start gap-2 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2 text-[10px] text-red-300">
                        <AlertTriangle size={11} className="shrink-0 mt-0.5"/>
                        <span>
                          <strong>{ibkrPos.filter(p=>p.qty<0).length} posições SHORT</strong> detectadas ({ibkrPos.filter(p=>p.qty<0).map(p=>p.ticker).join(", ")}).
                          Usa <strong>FLAT</strong> abaixo para fechar tudo (longs + shorts).
                        </span>
                      </div>
                    )}

                    {/* Cancel pending orders */}
                    <div>
                      <button onClick={cancelPendingOrders} disabled={cancelSending}
                        className="w-full flex items-center justify-center gap-2 py-2.5 text-xs font-bold bg-slate-700/40 hover:bg-slate-600/40 border border-slate-500/30 text-slate-300 rounded-xl disabled:opacity-50 transition-colors">
                        {cancelSending?<span className="animate-spin text-xs">⟳</span>:<span className="text-xs">✕</span>}
                        {cancelSending?"A cancelar ordens pendentes…":"Cancelar ordens pendentes (Em curso)"}
                      </button>
                      {cancelResult&&<div className="mt-1.5 text-[10px] text-center text-slate-400">{cancelResult}</div>}
                    </div>

                    {/* FLAT button — closes ALL positions (longs + shorts) */}
                    {!flatResult?(
                      <button onClick={flattenAllPositions}
                        disabled={flatSending||ibkrPos.length===0||(ibkrPos.every(p=>p.qty===0))}
                        className="w-full flex items-center justify-center gap-2 py-3 text-xs font-black bg-orange-600/20 hover:bg-orange-600/30 border border-orange-500/50 text-orange-300 rounded-xl disabled:opacity-50 transition-colors">
                        {flatSending?<span className="animate-spin text-sm">⟳</span>:<span className="text-base leading-none">⊘</span>}
                        {flatSending?"A zerar carteira (longs + shorts)…":
                          paperMode?`⚠ Desliga "Simulação local" para zerar à IB`:
                          `ZERAR CARTEIRA IB — ${ibkrPos.filter(p=>p.qty>0).length} longs + ${ibkrPos.filter(p=>p.qty<0).length} shorts — TESTE`}
                      </button>
                    ):(
                      <div className="space-y-2">
                        <div className="flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/20 rounded-xl px-3 py-2.5">
                          <CheckCircle2 size={14} className="text-emerald-400 shrink-0"/>
                          <div>
                            <div className="text-[10px] font-bold text-emerald-300">Carteira zerada</div>
                            <div className="text-[10px] text-slate-500">{flatResult.longs} longs + {flatResult.shorts} shorts · ref {flatResult.ref}</div>
                          </div>
                          <button onClick={()=>{setFlatResult(null);setFlatFills([]);setIbkrPos(null);}} className="ml-auto text-slate-500 hover:text-slate-300"><X size={12}/></button>
                        </div>
                        {flatFills.length>0&&(
                          <div className="rounded-lg border border-[#1a1f2e] overflow-hidden max-h-48 overflow-y-auto">
                            <table className="w-full text-[11px]">
                              <thead><tr className="text-slate-500 border-b border-[#1a1f2e] bg-[#0b0f1a] sticky top-0">
                                <th className="text-left px-3 py-1.5">Ticker</th>
                                <th className="text-left px-2 py-1.5">Lado</th>
                                <th className="text-right px-2 py-1.5">Qtd</th>
                                <th className="text-left px-3 py-1.5">Estado</th>
                              </tr></thead>
                              <tbody>
                                {flatFills.map((f,i)=>{
                                  const filled=f.status==="Filled";
                                  const skipped=["skip_zero","skip_sell_no_long","contract_not_qualified"].includes(f.status);
                                  return(
                                    <tr key={i} className={`border-b border-[#1a1f2e] ${i%2===0?"":"bg-[#080c14]"} ${skipped?"opacity-50":""}`}>
                                      <td className="px-3 py-1 font-bold text-orange-400">{f.ticker}</td>
                                      <td className={`px-2 py-1 font-semibold text-[10px] ${f.action==="BUY"||f.action==="Comprar"?"text-emerald-400":"text-red-400"}`}>{f.action==="BUY"||f.action==="Comprar"?"Comprar (cover)":"Vender"}</td>
                                      <td className="px-2 py-1 text-right text-slate-300">{f.filled||f.requested_qty}</td>
                                      <td className="px-3 py-1">
                                        <span className={`px-1.5 py-0.5 rounded text-[9px] font-semibold ${filled?"bg-emerald-900/40 text-emerald-300":skipped?"bg-slate-800 text-slate-500":"bg-amber-900/40 text-amber-300"}`}>
                                          {filled?"OK":skipped?"Ignorada":"Em curso"}
                                        </span>
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Original sell-longs-only button */}
                    {!sellAllResult?(
                      <button onClick={sellAllPositions} disabled={sellAllSending||ibkrPos.filter(p=>p.qty>0).length===0}
                        className="w-full flex items-center justify-center gap-2 py-2 text-[10px] font-bold bg-red-600/10 hover:bg-red-600/20 border border-red-500/20 text-red-400 rounded-xl disabled:opacity-50 transition-colors">
                        {sellAllSending?<span className="animate-spin text-xs">⟳</span>:<Trash2 size={11}/>}
                        {sellAllSending?"A vender longs…":
                          `Vender só longs (${ibkrPos.filter(p=>p.qty>0).length}) — TESTE`}
                      </button>
                    ):(
                      <div className="space-y-2">
                        <div className="flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/20 rounded-xl px-3 py-2.5">
                          <CheckCircle2 size={14} className="text-emerald-400 shrink-0"/>
                          <div>
                            <div className="text-[10px] font-bold text-emerald-300">Ordens de venda submetidas</div>
                            <div className="text-[10px] text-slate-500">{sellAllResult.fills} ordens · ref {sellAllResult.ref}</div>
                          </div>
                          <button onClick={()=>{setSellAllResult(null);setSellAllFills([]);setIbkrPos(null);}} className="ml-auto text-slate-500 hover:text-slate-300"><X size={12}/></button>
                        </div>
                        {sellAllFills.length>0&&(
                          <div className="rounded-lg border border-[#1a1f2e] overflow-hidden">
                            <table className="w-full text-[11px]">
                              <thead><tr className="text-slate-500 border-b border-[#1a1f2e] bg-[#0b0f1a]">
                                <th className="text-left px-3 py-1.5">Ticker</th>
                                <th className="text-right px-2 py-1.5">Qtd</th>
                                <th className="text-right px-2 py-1.5">Preço médio</th>
                                <th className="text-left px-3 py-1.5">Estado</th>
                              </tr></thead>
                              <tbody>
                                {sellAllFills.map((f,i)=>{
                                  const skipped=["skip_zero","skip_sell_no_long","contract_not_qualified"].includes(f.status);
                                  const filled=f.status==="Filled";
                                  return(
                                    <tr key={i} className={`border-b border-[#1a1f2e] ${i%2===0?"":"bg-[#080c14]"} ${skipped?"opacity-50":""}`}>
                                      <td className="px-3 py-1 font-bold text-red-400">{f.ticker}</td>
                                      <td className="px-2 py-1 text-right text-slate-300">{f.filled||f.requested_qty||"—"}</td>
                                      <td className="px-2 py-1 text-right text-slate-400">{f.avg_fill_price?f.avg_fill_price.toFixed(2):"—"}</td>
                                      <td className="px-3 py-1">
                                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${filled?"bg-emerald-900/40 text-emerald-300":skipped?"bg-slate-800 text-slate-500":"bg-amber-900/40 text-amber-300"}`}>
                                          {filled?"Vendida":skipped?"Ignorada":f.status==="Submitted"?"Em curso":f.status}
                                        </span>
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {!ibkrPos&&!ibkrLoading&&(
              <div className="text-[10px] text-slate-600 text-center py-2">
                Clica em "Verificar carteira IB" para carregar posições actuais e activar o botão de venda total.
              </div>
            )}
          </div>

          {/* Error banner */}
          {errMsg&&!done&&(
            <div className="flex items-start justify-between gap-3 bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3">
              <div className="flex items-start gap-2">
                <AlertTriangle size={14} className="text-red-400 shrink-0 mt-0.5"/>
                <div>
                  <div className="text-xs font-bold text-red-300 mb-0.5">Erro ao enviar ordens</div>
                  <div className="text-[10px] text-slate-400 leading-snug">{errMsg}</div>
                </div>
              </div>
              <button onClick={()=>setErrMsg("")} className="text-slate-500 hover:text-slate-300 shrink-0 mt-0.5"><X size={14}/></button>
            </div>
          )}

          {/* Sending progress bar */}
          {sending&&(
            <div className="bg-[#0b0f1a] border border-blue-500/30 rounded-xl px-5 py-4 space-y-3">
              <div className="flex items-center gap-3">
                <span className="inline-block animate-spin text-blue-400 text-lg">⟳</span>
                <div>
                  <div className="text-sm font-bold text-slate-200">A enviar ordens para a Interactive Brokers…</div>
                  <div className="text-[10px] text-slate-500">Aguarde, não feche esta janela.</div>
                </div>
              </div>
              <div className="w-full bg-[#1a1f2e] rounded-full h-1.5 overflow-hidden">
                <div className="h-full bg-blue-500 rounded-full animate-pulse" style={{width:"60%"}}/>
              </div>
              <div className="grid grid-cols-4 gap-2 text-center">
                {["Validação","Envio","Execução","Confirmação"].map((s,i)=>(
                  <div key={s} className="flex flex-col items-center gap-1">
                    <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold border ${i===0?"bg-blue-600 border-blue-500 text-white animate-pulse":"bg-[#111827] border-[#252a3a] text-slate-600"}`}>{i+1}</div>
                    <span className={`text-[9px] ${i===0?"text-blue-400":"text-slate-600"}`}>{s}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Results panel — shown after successful send */}
          {done&&(
            <div className="bg-[#0b0f1a] border border-emerald-500/30 rounded-xl p-5 space-y-4">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center shrink-0">
                  <CheckCircle2 size={18} className="text-emerald-400"/>
                </div>
                <div>
                  <div className="text-sm font-bold text-emerald-300">Ordens submetidas com sucesso</div>
                  <div className="text-[10px] text-slate-500">A IB irá executar ao melhor preço disponível no mercado.</div>
                </div>
                {orderRef&&<span className="ml-auto text-[10px] font-mono text-slate-400 border border-[#252a3a] px-2 py-1 rounded">{orderRef}</span>}
              </div>
              <div className="grid grid-cols-4 gap-3 border-t border-[#1a1f2e] pt-4">
                <div className="text-center">
                  <div className="text-[9px] text-slate-500 mb-1">Enviadas</div>
                  <div className="text-lg font-black text-slate-100">{fills.length>0?fills.filter(f=>!["skip_zero","skip_sell_no_long","contract_not_qualified","skip_fx_below_min"].includes(f.status)).length:nOrdens}</div>
                </div>
                <div className="text-center">
                  <div className="text-[9px] text-slate-500 mb-1">Preenchidas</div>
                  <div className="text-sm font-black text-emerald-400">{fills.length>0?fills.filter(f=>f.status==="Filled").length:0}</div>
                </div>
                <div className="text-center">
                  <div className="text-[9px] text-slate-500 mb-1">Em curso</div>
                  <div className="text-sm font-black text-amber-400">{fills.length>0?fills.filter(f=>f.status==="Submitted"||f.status==="PreSubmitted").length:0}</div>
                </div>
                <div className="text-center">
                  <div className="text-[9px] text-slate-500 mb-1">Ignoradas</div>
                  <div className="text-sm font-black text-slate-500">{fills.length>0?fills.filter(f=>["skip_zero","skip_sell_no_long","contract_not_qualified","skip_fx_below_min"].includes(f.status)).length:0}</div>
                </div>
              </div>
              {!paperMode&&fills.some(f=>f.status==="Submitted"||f.status==="PreSubmitted")&&(
                <div className="flex flex-col gap-1 bg-amber-500/[0.06] border border-amber-500/20 rounded-lg px-3 py-2 text-[10px] text-amber-300">
                  <div className="flex items-center gap-2">
                    <span className="animate-pulse font-bold">⟳</span>
                    <span className="font-semibold">Ordens submetidas à IB e aguardam execução</span>
                  </div>
                  <div className="text-amber-400/70 leading-relaxed pl-4">
                    As ordens US estão registadas na IB Gateway. Se o mercado americano ainda não abriu (abre às 15:30 hora de Lisboa), vão executar automaticamente na abertura. Clica <span className="font-semibold text-amber-300">Actualizar</span> na página Carteira depois das 15:30 para confirmar.
                  </div>
                </div>
              )}

              {/* Execution table */}
              {fills.length>0&&(
                <div className="border-t border-[#1a1f2e] pt-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="font-semibold text-slate-300 text-xs">Detalhe de execução</div>
                    <div className="flex gap-3 text-[10px] text-slate-500">
                      {fills.some(f=>f.ticker==="EUR/USD"||f.ticker==="EURUSD")&&
                        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-violet-500/60 inline-block"/>Cambial (FX hedge)</span>}
                      <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-emerald-700/60 inline-block"/>Preenchida</span>
                      <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-amber-700/60 inline-block"/>Em curso</span>
                      <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-slate-700/60 inline-block"/>Ignorada</span>
                    </div>
                  </div>
                  <div className="overflow-auto rounded-lg border border-[#1a1f2e]" style={{maxHeight:"360px"}}>
                    <table className="w-full text-[11px]">
                      <thead className="sticky top-0 bg-[#0b0f1a] z-10">
                        <tr className="text-slate-500 border-b border-[#252a3a]">
                          <th className="text-left px-3 py-2">Ativo</th>
                          <th className="text-left px-2 py-2">Lado</th>
                          <th className="text-right px-2 py-2">Qtd. pedida</th>
                          <th className="text-right px-2 py-2">Qtd. exec.</th>
                          <th className="text-right px-2 py-2">Preço médio</th>
                          <th className="text-right px-2 py-2">Valor exec.</th>
                          <th className="text-center px-2 py-2">Estado</th>
                          <th className="text-left px-3 py-2">Nota</th>
                        </tr>
                      </thead>
                      <tbody>
                        {fills.map((f,i)=>{
                          const isFx=f.ticker==="EUR/USD"||f.ticker==="EURUSD";
                          const SKIP_ST=["skip_zero","skip_sell_no_long","contract_not_qualified","skip_fx_below_min","error"];
                          const skipped=SKIP_ST.includes(f.status);
                          const isFilled=f.status==="Filled";
                          const isSubmitted=["Submitted","PreSubmitted","PendingSubmit"].includes(f.status);
                          const isError=f.status==="error";
                          const valorExec=f.filled&&f.avg_fill_price?f.filled*f.avg_fill_price:null;
                          const rowBg=isFx?"bg-violet-950/30":i%2===0?"":"bg-[#080c14]";
                          const statusBadge=isFilled
                            ?"bg-emerald-900/50 text-emerald-300 border-emerald-700/40"
                            :skipped
                              ?"bg-slate-800/60 text-slate-500 border-slate-700/30"
                              :isError
                                ?"bg-red-900/40 text-red-300 border-red-700/30"
                                :"bg-amber-900/40 text-amber-300 border-amber-700/30";
                          const statusLabel=isFilled?"✓ Preenchida":skipped?"— Ignorada":isSubmitted?"⟳ Em curso":isError?"✕ Erro":f.status;
                          return(
                            <tr key={i} className={`border-b border-[#1a1f2e] ${skipped?"opacity-50":""} ${rowBg} transition-colors hover:brightness-110`}>
                              <td className="px-3 py-2">
                                <div className="flex items-center gap-1.5">
                                  {isFx&&<span className="text-[9px] px-1 py-0.5 rounded bg-violet-500/20 text-violet-300 border border-violet-500/30 font-bold">FX</span>}
                                  <span className={`font-bold ${isFx?"text-violet-300":"text-blue-400"}`}>{f.ticker}</span>
                                  {f.executed_as&&f.executed_as!==f.ticker&&
                                    <span className="text-[9px] text-slate-500">(como {f.executed_as})</span>}
                                </div>
                                {f.ib_order_id&&<div className="text-[9px] text-slate-600 mt-0.5">ID #{f.ib_order_id}</div>}
                              </td>
                              <td className="px-2 py-2">
                                <span className={`font-semibold text-[10px] px-1.5 py-0.5 rounded ${f.action==="BUY"?"bg-emerald-900/30 text-emerald-400":"bg-red-900/30 text-red-400"}`}>
                                  {f.action==="BUY"?(isFx?"Comprar EUR":"Comprar"):"Vender"}
                                </span>
                              </td>
                              <td className="px-2 py-2 text-right text-slate-400 tabular-nums">{f.requested_qty>0?f.requested_qty.toLocaleString("pt-PT",{maximumFractionDigits:2}):"—"}</td>
                              <td className="px-2 py-2 text-right font-semibold tabular-nums">
                                <span className={f.filled>0?"text-slate-100":"text-slate-600"}>{f.filled>0?f.filled.toLocaleString("pt-PT",{maximumFractionDigits:2}):"—"}</span>
                              </td>
                              <td className="px-2 py-2 text-right text-slate-300 tabular-nums">
                                {f.avg_fill_price?f.avg_fill_price.toLocaleString("pt-PT",{minimumFractionDigits:2,maximumFractionDigits:4}):"—"}
                              </td>
                              <td className="px-2 py-2 text-right tabular-nums">
                                {valorExec?<span className="text-slate-200">{valorExec.toLocaleString("pt-PT",{minimumFractionDigits:2,maximumFractionDigits:2})}</span>:"—"}
                              </td>
                              <td className="px-2 py-2 text-center">
                                <span className={`px-1.5 py-0.5 rounded border text-[9px] font-semibold whitespace-nowrap ${statusBadge}`}>
                                  {statusLabel}
                                </span>
                              </td>
                              <td className="px-3 py-2 text-[10px] text-slate-500 max-w-[180px]">
                                {f.message?<span title={f.message}>{f.message.length>60?f.message.slice(0,57)+"…":f.message}</span>:"—"}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                      <tfoot className="sticky bottom-0 bg-[#0b0f1a] border-t-2 border-[#252a3a]">
                        <tr>
                          <td colSpan={3} className="px-3 py-2 text-[10px] text-slate-500">
                            {fills.filter(f=>!["skip_zero","skip_sell_no_long","contract_not_qualified","skip_fx_below_min"].includes(f.status)).length} enviadas
                            · {fills.filter(f=>f.status==="Filled").length} preenchidas
                            · {fills.filter(f=>["Submitted","PreSubmitted","PendingSubmit"].includes(f.status)).length} em curso
                            · {fills.filter(f=>["skip_zero","skip_sell_no_long","contract_not_qualified","skip_fx_below_min"].includes(f.status)).length} ignoradas
                          </td>
                          <td className="px-2 py-2 text-right text-[10px] font-bold text-slate-300 tabular-nums">
                            {fills.reduce((s,f)=>s+(f.filled||0),0).toLocaleString("pt-PT",{maximumFractionDigits:0})}
                          </td>
                          <td colSpan={2} className="px-2 py-2 text-right text-[10px] font-bold text-emerald-400 tabular-nums">
                            {(()=>{const tot=fills.reduce((s,f)=>s+(f.filled&&f.avg_fill_price?f.filled*f.avg_fill_price:0),0); return tot>0?tot.toLocaleString("pt-PT",{minimumFractionDigits:2,maximumFractionDigits:2}):"—";})()}
                          </td>
                          <td colSpan={2} className="px-3 py-2"/>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </div>
              )}

              <div className="flex gap-2 pt-1">
                <button onClick={onBack} className="py-2 px-3 text-xs font-semibold text-slate-300 border border-[#1a1f2e] bg-[#080c14] rounded-lg hover:bg-[#111827] transition-colors">
                  Recomendações
                </button>
                <button onClick={()=>{ if(typeof window!=="undefined") window.dispatchEvent(new CustomEvent("decide:nav",{detail:"carteira"})); }} className="flex-1 py-2 text-xs font-bold text-emerald-300 border border-emerald-500/30 bg-emerald-600/10 rounded-lg hover:bg-emerald-600/20 transition-colors">
                  ✓ Ver Carteira IB actualizada
                </button>
                <button onClick={()=>{setDone(false);setOrderRef("");setErrMsg("");setFills([]);setPollCount(0);}} className="py-2 px-3 text-xs font-semibold text-blue-400 border border-blue-500/30 bg-blue-600/10 rounded-lg hover:bg-blue-600/20 transition-colors">
                  Nova submissão
                </button>
              </div>
            </div>
          )}

          {/* Mandatory: load IB positions + open orders before sending — auto-fetched on mount */}
          {ibkrLoading&&!ibkrPos&&(
            <div className="flex items-center gap-3 bg-sky-500/10 border border-sky-500/30 rounded-xl px-4 py-3 text-[11px] text-sky-300">
              <span className="animate-spin text-sm">⟳</span>
              <span className="font-semibold">A verificar carteira e ordens pendentes na IB…</span>
              <span className="text-sky-400/60">O botão de envio só fica disponível após verificação — evita duplicação de ordens.</span>
            </div>
          )}
          {!ibkrPos&&!ibkrLoading&&!done&&(
            <div className="flex items-start gap-2.5 bg-amber-500/10 border border-amber-500/30 rounded-xl px-4 py-3 text-[11px] text-amber-300">
              <span className="text-base shrink-0">⚠</span>
              <div>
                <span className="font-semibold">Não foi possível verificar a carteira IB automaticamente.</span>
                <span className="text-amber-400/70"> O sistema calcula as ordens em função do que já existe em carteira e das ordens pendentes; sem verificação pode duplicar posições.</span>
                <button onClick={fetchIbkrPositions} disabled={ibkrLoading} className="mt-1.5 block text-xs font-semibold text-white bg-amber-600 hover:bg-amber-500 disabled:opacity-50 px-3 py-1 rounded-lg transition-colors">
                  {ibkrLoading?"A verificar…":"→ Tentar de novo"}
                </button>
              </div>
            </div>
          )}
          {ibkrPos&&ibkrOpenOrders.length>0&&!done&&(
            <div className="flex items-center gap-2.5 bg-sky-500/10 border border-sky-500/30 rounded-xl px-4 py-3 text-[11px] text-sky-300">
              <span className="text-sm">ℹ</span>
              <span><strong>{ibkrOpenOrders.filter(o=>o.side==="BUY").length} ordem(ns) BUY pendente(s)</strong> já submetidas — excluídas do novo cálculo automaticamente.</span>
            </div>
          )}
          {/* Warn if portfolio is too far from model target to safely rebalance */}
          {ibkrPos&&!done&&(()=>{
            const ibNav=ibkrPos.reduce((s,p)=>s+Math.abs(p.value),0);
            if(ibNav<=aum*1.5) return null;
            return (
              <div className="flex items-start gap-2 bg-red-500/10 border border-red-500/40 rounded-xl px-4 py-3 text-[11px] text-red-300">
                <AlertTriangle size={13} className="shrink-0 mt-0.5"/>
                <div>
                  <span className="font-semibold">Carteira acumulada ({(ibNav/aum*100).toFixed(0)}% do objectivo) — não é seguro rebalancear.</span>
                  <span className="text-red-400/70"> Usa <strong>"Zerar toda a carteira (FLAT)"</strong> no Diagnóstico abaixo e depois faz uma Construção inicial limpa.</span>
                </div>
              </div>
            );
          })()}

          {/* Action buttons */}
          {/* ── Re-send warning banner ── */}
          {recentlySent&&!done&&lastSent&&(
            <div className="bg-red-950/60 border border-red-700/60 rounded-xl px-4 py-3 flex items-start gap-3">
              <AlertTriangle size={16} className="text-red-400 shrink-0 mt-0.5"/>
              <div className="flex-1 text-xs leading-relaxed">
                <span className="font-bold text-red-300">Atenção: ordens já enviadas recentemente.</span>
                <span className="text-red-200/80"> Enviou ordens há {Math.round((Date.now()-lastSent.ts)/60000)} min (ref: <code className="font-mono">{lastSent.ref}</code>). Enviar de novo irá <strong>duplicar posições</strong> na sua conta IB. Só prossiga se tiver cancelado as ordens anteriores.</span>
              </div>
              <button onClick={()=>{try{localStorage.removeItem(ORDERS_SENT_KEY);}catch{}setLastSent(null);}} className="text-[10px] text-red-400 hover:text-red-300 shrink-0 font-semibold underline">Ignorar aviso</button>
            </div>
          )}

          {/* ── Confirmation modal ── */}
          {showSendConfirm&&(
            <div className="bg-[#0b0f1a] border-2 border-amber-500/60 rounded-xl px-5 py-4 space-y-3">
              <div className="flex items-center gap-2">
                <AlertTriangle size={16} className="text-amber-400 shrink-0"/>
                <span className="text-sm font-bold text-amber-300">Confirmar envio de {nOrdens} {nOrdens===1?"ordem":"ordens"} à Interactive Brokers</span>
              </div>
              <p className="text-xs text-slate-400 leading-relaxed">
                Esta acção é <strong className="text-slate-200">irreversível</strong> após execução. As ordens serão enviadas ao mercado e executadas ao melhor preço disponível. Verifique a lista de ordens antes de confirmar.
              </p>
              {recentlySent&&lastSent&&(
                <p className="text-xs text-red-300 font-semibold">⚠ Já enviou ordens há {Math.round((Date.now()-lastSent.ts)/60000)} min. Confirma que quer enviar de novo?</p>
              )}
              <div className="flex gap-3">
                <button onClick={()=>setShowSendConfirm(false)} className="flex-1 py-2.5 text-sm font-bold bg-slate-800 hover:bg-slate-700 border border-slate-600/50 text-slate-300 rounded-xl transition-colors">
                  Cancelar
                </button>
                <button onClick={submitOrders} className="flex-1 py-2.5 text-sm font-bold bg-red-700 hover:bg-red-600 text-white rounded-xl transition-colors flex items-center justify-center gap-2">
                  <Send size={14}/>Confirmar — enviar ordens agora
                </button>
              </div>
            </div>
          )}

          <div className="flex gap-3">
            <button onClick={onBack} className="px-6 py-3 bg-[#0b0f1a] border border-[#1a1f2e] text-slate-300 text-sm font-semibold rounded-xl hover:bg-[#111827] transition-colors">
              Cancelar
            </button>
            <button
              onClick={()=>setShowSendConfirm(true)}
              disabled={sending||ibkrLoading||nOrdens===0||done||aum<=0||paperMode||!ibkrPos||showSendConfirm||(ibkrPos!==null&&ibkrPos.reduce((s,p)=>s+Math.abs(p.value),0)>aum*1.5)}
              className={`flex-1 flex items-center justify-center gap-2 disabled:opacity-50 text-white text-sm font-bold py-3 rounded-xl transition-all ${paperMode?"bg-slate-700 cursor-not-allowed":recentlySent?"bg-amber-700 hover:bg-amber-600 shadow-lg shadow-amber-900/30":"bg-emerald-600 hover:bg-emerald-500 shadow-lg shadow-emerald-900/30"}`}>
              <Send size={15}/>
              {paperMode?"Desliga 'Simulação local' para enviar à IB →":recentlySent?"⚠ Já enviou — confirmar 2.º envio?":"Confirmar e enviar ordens para IB →"}
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
              <span className={`text-xs px-2 py-0.5 rounded-full font-bold border ${execMode==="full"?"bg-blue-600/15 text-blue-300 border-blue-500/30":"bg-slate-700/30 text-slate-400 border-slate-600/30"}`}>
                {execMode==="full"?"Construção inicial":"Rebalanceamento"}
              </span>
            </div>
            <div className="grid grid-cols-3 gap-3 mb-5">
              {[
                {label:"Ordens a enviar",val:`${nOrdens}`,c:"text-blue-300"},
                {label:"Valor a investir",val:`€ ${fmtE(investEur)}`,c:"text-emerald-400"},
                {label:"Custo estimado",val:`€ ${fmtE(tradeCost)}`,c:"text-slate-300"},
              ].map(k=>(
                <div key={k.label} className="text-center">
                  <div className="text-[9px] text-slate-500 mb-1">{k.label}</div>
                  <div className={`text-sm font-black ${k.c}`}>{k.val}</div>
                </div>
              ))}
            </div>

            <div className="border-t border-[#1a1f2e] pt-4 mb-4">
              <div className="text-xs font-semibold text-slate-400 mb-3">
                {execMode==="full"?"Composição do plano":"Alterações na carteira"}
              </div>
              <div className="space-y-2">
                {(execMode==="full"?[
                  {label:`Comprar / Manter (${orderRows.filter(r=>r.action!=="Vender").length})`,val:`€ ${fmtE(investEur)}`,c:"text-emerald-400",dot:"bg-emerald-500"},
                  {label:`Vender (${orderRows.filter(r=>r.action==="Vender").length})`,val:`-€ ${fmtE(reduceEur)}`,c:"text-red-400",dot:"bg-red-500"},
                ]:[
                  {label:`A aumentar / comprar (${actionCounts.comprar+actionCounts.aumentar})`,val:`€ ${fmtE(investEur)}`,c:"text-emerald-400",dot:"bg-emerald-500"},
                  {label:`A reduzir / vender (${actionCounts.reduzir+actionCounts.vender})`,val:`-€ ${fmtE(reduceEur)}`,c:"text-red-400",dot:"bg-red-500"},
                  {label:`Manter (${actionCounts.manter})`,val:"0,00 €",c:"text-slate-400",dot:"bg-slate-500"},
                ]).map(x=>(
                  <div key={x.label} className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2"><div className={`w-2 h-2 rounded-full shrink-0 ${x.dot}`}/><span className="text-slate-400">{x.label}</span></div>
                    <span className={`font-semibold ${x.c}`}>{x.val}</span>
                  </div>
                ))}
                <div className="flex items-center justify-between text-xs border-t border-[#1a1f2e] pt-2 mt-2">
                  <span className="text-slate-300 font-semibold">Total ordens</span>
                  <span className="font-bold text-blue-300">€ {fmtE(investEur+reduceEur)}</span>
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
                        <td className="py-1.5 font-bold text-slate-200">{displayTicker(r.ticker)}</td>
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

            {/* NAV reference */}
            <div className="border-t border-[#1a1f2e] pt-4 mt-4 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-500">Montante de referência (NAV)</span>
                <span className="text-xs font-bold text-white">€ {fmtE(aum)}</span>
              </div>
              {/* Warn if IB NAV is known and differs significantly from aum */}
              {ibkrPos!==null&&(()=>{
                const ibNav=ibkrPos.reduce((s,p)=>s+Math.abs(p.value),0);
                const diff=Math.abs(ibNav-aum);
                const pct=aum>0?diff/aum*100:0;
                const isHugelyOver=ibNav>aum*1.5;
                if(pct<5) return null;
                if(isHugelyOver) return (
                  <div className="flex items-start gap-2 bg-red-500/10 border border-red-500/40 rounded-lg px-2.5 py-2 text-[10px] text-red-300">
                    <AlertTriangle size={11} className="shrink-0 mt-0.5 text-red-400"/>
                    <span><strong>Carteira acumulada de sessões anteriores ({fmtE(ibNav)} €  = {(ibNav/aum*100).toFixed(0)}% do objectivo).</strong> Envia novas ordens poderia duplicar posições já existentes. Usa <strong>"Zerar toda a carteira"</strong> no Diagnóstico para começar do zero.</span>
                  </div>
                );
                return (
                  <div className="flex items-start gap-2 bg-amber-500/[0.08] border border-amber-500/20 rounded-lg px-2.5 py-2 text-[10px] text-amber-300">
                    <AlertTriangle size={11} className="shrink-0 mt-0.5"/>
                    <span>NAV IB ({fmtE(ibNav)} €) diverge {pct.toFixed(0)}% do montante de referência ({fmtE(aum)} €). Considera actualizar o montante abaixo ou na Carteira.</span>
                  </div>
                );
              })()}
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
              <div className="flex justify-between"><span>Exposição FX</span>
                {ibkrFxBlocked
                  ?<span className="text-amber-400 font-semibold text-[9px]">Conta Caixa — hedge desactivado</span>
                  :<span className="text-slate-300 font-semibold capitalize">{fxExposure}</span>
                }
              </div>
              <div className="flex justify-between"><span>Margem</span><span className={`font-semibold ${marginEnabled?"text-amber-400":"text-slate-400"}`}>{marginEnabled?"Activa":"Desactivada"}</span></div>
              <div className="flex justify-between"><span>Modo</span><span className={`font-semibold ${paperMode?"text-amber-400":"text-emerald-400"}`}>{paperMode?"Simulação local":"Envia à IB"}</span></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── Activity log ─────────────────────────────────────────────────────── */
const ACT_KEY="decide_activity_log";
type ActEntry={
  id:string; ts:number; type:string;
  label:string; detail?:string; icon:string; color:string;
};
function logActivity(entry:Omit<ActEntry,"id"|"ts">) {
  if(typeof window==="undefined") return;
  try {
    const prev:ActEntry[]=JSON.parse(localStorage.getItem(ACT_KEY)||"[]");
    const next=[{...entry,id:Math.random().toString(36).slice(2),ts:Date.now()},...prev].slice(0,200);
    localStorage.setItem(ACT_KEY,JSON.stringify(next));
  } catch{}
}
function getActivityLog():ActEntry[] {
  if(typeof window==="undefined") return [];
  try { return JSON.parse(localStorage.getItem(ACT_KEY)||"[]"); } catch { return []; }
}

/* ─── ActividadePage sub-component ─────────────────────────────────────── */
function ActividadePage({sortedMonths}:{sortedMonths:MonthRec[]}) {
  const [actLog,setActLog]=useState<ActEntry[]>(()=>getActivityLog());
  const [actFilter,setActFilter]=useState<string>("todos");

  const rebalanceEvents=useMemo(()=>{
    const evs:ActEntry[]=[];
    sortedMonths.forEach((m,idx)=>{
      if(idx===0) return;
      const prev=sortedMonths[idx-1];
      const pm=new Map(prev.rows.map(r=>[r.ticker,r.weightPct]));
      const cm=new Map(m.rows.map(r=>[r.ticker,r.weightPct]));
      const allT=new Set([...pm.keys(),...cm.keys()]);
      let comprar=0,vender=0,aumentar=0,reduzir=0;
      const details:string[]=[];
      allT.forEach(t=>{
        if(t.startsWith("TBILL")||t.startsWith("CASH")||t==="XEON") return;
        const p=pm.get(t)??0, c=cm.get(t)??0, d=c-p;
        if(Math.abs(d)<0.01) return;
        const name=getCompany(t)||t;
        if(p===0&&c>0){comprar++;details.push(`Comprar ${name} (${c.toFixed(1)}%)`);}
        else if(p>0&&c===0){vender++;details.push(`Vender ${name} (era ${p.toFixed(1)}%)`);}
        else if(d>0){aumentar++;details.push(`Aumentar ${name} ${p.toFixed(1)}%→${c.toFixed(1)}%`);}
        else{reduzir++;details.push(`Reduzir ${name} ${p.toFixed(1)}%→${c.toFixed(1)}%`);}
      });
      const total=comprar+vender+aumentar+reduzir;
      if(total===0) return;
      const parts:string[]=[];
      if(comprar) parts.push(`${comprar} compra${comprar>1?"s":""}`);
      if(aumentar) parts.push(`${aumentar} reforço${aumentar>1?"s":""}`);
      if(reduzir) parts.push(`${reduzir} redução${reduzir>1?"ões":""}`);
      if(vender) parts.push(`${vender} venda${vender>1?"s":""}`);
      const dateStr:string=m.date??m.rebalance_date??"1970-01-01";
      evs.push({
        id:`reb-${dateStr}`,ts:new Date(dateStr).getTime(),
        type:"rebalanceamento",
        label:`Rebalanceamento · ${parts.join(", ")}`,
        detail:details.slice(0,5).join(" · ")+(details.length>5?` · +${details.length-5} mais`:""),
        icon:"↺",color:"text-blue-400",
      });
    });
    return evs.reverse();
  },[sortedMonths]);

  const allEvents=[...actLog,...rebalanceEvents].sort((a,b)=>b.ts-a.ts);
  const filterTypes=["todos","rebalanceamento","ordens","cancelamento","configuração","login"];
  const filtered=actFilter==="todos"?allEvents:allEvents.filter(e=>e.type===actFilter);
  const fmtDate=(ts:number)=>{
    const d=new Date(ts);
    return d.toLocaleDateString("pt-PT",{day:"2-digit",month:"short",year:"numeric"})+" "+
           d.toLocaleTimeString("pt-PT",{hour:"2-digit",minute:"2-digit"});
  };
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        {filterTypes.map(f=>(
          <button key={f} onClick={()=>setActFilter(f)}
            className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold capitalize transition-colors ${actFilter===f?"bg-blue-600 text-white":"bg-[#0b0f1a] border border-[#1a1f2e] text-slate-400 hover:text-slate-200"}`}>
            {f==="todos"?`Tudo (${allEvents.length})`:f}
          </button>
        ))}
        <button onClick={()=>{localStorage.removeItem(ACT_KEY);setActLog([]);}}
          className="ml-auto px-3 py-1.5 rounded-lg text-[11px] font-semibold text-red-500 hover:text-red-400 border border-red-900/40 hover:border-red-700/60 transition-colors">
          Limpar histórico manual
        </button>
      </div>
      <div className="bg-[#0b0f1a] border border-[#1a1f2e] rounded-xl overflow-hidden">
        {filtered.length===0?(
          <div className="p-8 text-center text-slate-600 text-sm">
            <div className="text-2xl mb-2">📋</div>
            Sem actividade registada{actFilter!=="todos"?` para "${actFilter}"`:""}
          </div>
        ):(
          <div className="divide-y divide-[#111827]">
            {filtered.map((e,i)=>(
              <div key={e.id||i} className="flex items-start gap-4 px-5 py-4 hover:bg-[#0f172a] transition-colors">
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold shrink-0 mt-0.5
                  ${e.type==="rebalanceamento"?"bg-blue-900/40 text-blue-400":
                    e.type==="ordens"?"bg-emerald-900/40 text-emerald-400":
                    e.type==="cancelamento"?"bg-red-900/40 text-red-400":
                    e.type==="configuração"?"bg-amber-900/40 text-amber-400":
                    e.type==="login"?"bg-slate-800 text-slate-400":
                    "bg-slate-800 text-slate-400"}`}>
                  {e.icon}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="text-slate-200 text-[12px] font-semibold leading-tight">{e.label}</div>
                      {e.detail&&<div className="text-slate-500 text-[10px] mt-1 leading-relaxed">{e.detail}</div>}
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="text-slate-500 text-[10px]">{fmtDate(e.ts)}</div>
                      <div className={`text-[9px] font-semibold capitalize mt-0.5 px-1.5 py-0.5 rounded
                        ${e.type==="rebalanceamento"?"bg-blue-900/20 text-blue-500":
                          e.type==="ordens"?"bg-emerald-900/20 text-emerald-500":
                          e.type==="cancelamento"?"bg-red-900/20 text-red-500":
                          e.type==="configuração"?"bg-amber-900/20 text-amber-500":
                          "bg-slate-800 text-slate-500"}`}>
                        {e.type}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
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
  const [period,setPeriod]=useState<Period>("Desde início");
  const [regSuccess,setRegSuccess]=useState(false);
  const [activePage,setActivePage]=useState<Page>("dashboard");
  const [riskProfileLocal,setRiskProfileLocalRaw]=useState<RiskProfile>("moderado");
  const [fxExposure,setFxExposureRaw]=useState<FxExposure>("protegida");
  const [marginEnabled,setMarginEnabledRaw]=useState(false);
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
      }
    }catch{}
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[]);

  const savePrefs=(patch:Partial<{riskProfile:RiskProfile;fxExposure:FxExposure;marginEnabled:boolean}>)=>{
    try{
      const existing=JSON.parse(localStorage.getItem(LS_KEY)??"{}");
      localStorage.setItem(LS_KEY,JSON.stringify({...existing,...patch}));
    }catch{}
  };
  const setRiskProfileLocal=(v:RiskProfile)=>{
    setRiskProfileLocalRaw(v);savePrefs({riskProfile:v});
    logActivity({type:"configuração",label:`Perfil de risco alterado para ${v}`,icon:"⚙",color:"text-amber-400"});
  };
  const setFxExposure=(v:FxExposure)=>{
    setFxExposureRaw(v);savePrefs({fxExposure:v});
    logActivity({type:"configuração",label:`Exposição FX alterada para ${v}`,icon:"⚙",color:"text-amber-400"});
  };
  const setMarginEnabled=(v:boolean|((prev:boolean)=>boolean))=>{
    setMarginEnabledRaw(prev=>{
      const next=typeof v==="function"?v(prev):v;
      savePrefs({marginEnabled:next});
      logActivity({type:"configuração",label:`Margem ${next?"activada":"desactivada"}`,icon:"⚙",color:"text-amber-400"});
      return next;
    });
  };
  // kpiMode is derived from marginEnabled — no separate state needed
  const kpiMode:KpiMode=marginEnabled?"margem":"base";
  const [contactForm,setContactForm]=useState({nome:"",email:"",assunto:"",msg:""});
  const [contactSent,setContactSent]=useState(false);
  const [aum,setAum]=useState(100000); // initialised below from localStorage (decide_onboarding_montante_eur_v1)
  const [prices,setPrices]=useState<Record<string,{price:number;currency:string;qty?:number;value?:number}|null>>({});
  const [pricesLoading,setPricesLoading]=useState(false);

  // Carteira page: tab (real IB vs plano modelo) + IB snapshot state
  const [cartTab,setCartTab]=useState<"ib"|"plano">("ib");
  const [hoveredCountry,setHoveredCountry]=useState<{name:string;pct:number}|null>(null);
  const [cartIbPos,setCartIbPos]=useState<{ticker:string;qty:number;value:number;weight_pct:number;currency:string;name?:string;sector?:string;country?:string}[]|null>(null);
  const [cartIbLoading,setCartIbLoading]=useState(false);
  const [cartIbErr,setCartIbErr]=useState("");
  const [cartIbNav,setCartIbNav]=useState<{value:number;ccy:string}>({value:0,ccy:""});

  // freeze series
  const [dates,setDates]=useState<string[]>([]);
  const [equityRaw,setEquityRaw]=useState<number[]>([]);
  const [benchRaw,setBenchRaw]=useState<number[]>([]);

  // recommendations
  const [recoMonths,setRecoMonths]=useState<RecoMonth[]>([]);
  const [recoLoading,setRecoLoading]=useState(true);

  const syncSession=()=>{ try{ setSessionUser(getCurrentSessionUser()); setLoggedIn(isClientLoggedIn()); }catch{} };

  useEffect(()=>{
    setMounted(true);
    syncSession();
    // Seed aum from the montante chosen during onboarding (localStorage)
    try {
      const raw = typeof window!=="undefined" ? window.localStorage.getItem("decide_onboarding_montante_eur_v1") : null;
      if (raw) {
        const v = Number(String(raw).replace(/\s/g,"").replace(",","."));
        if (v > 0) setAum(Math.round(v));
      }
    } catch { /* ignore */ }

    // Listen for internal navigation events (e.g. from OrdensPage after submit)
    const handleNav=(e:Event)=>{
      const detail=(e as CustomEvent).detail as string;
      if(detail==="carteira"){
        setActivePage("carteira");
        setCartTab("ib");
        setCartIbPos(null); // force refresh
      }
    };
    window.addEventListener("decide:nav",handleNav);
    return ()=>window.removeEventListener("decide:nav",handleNav);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[]);
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

  async function fetchCartIbPositions(){
    setCartIbLoading(true);setCartIbErr("");
    try{
      const resp=await fetch("/api/ibkr-snapshot",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({paper_mode:true})});
      const j=await resp.json();
      if(j.status==="ok"||j.positions){
        setCartIbPos(j.positions??[]);
        setCartIbNav({value:j.net_liquidation??0,ccy:j.net_liquidation_ccy??"EUR"});
      } else {
        setCartIbErr(j.error||"Erro ao carregar posições");
      }
    }catch(e:unknown){setCartIbErr(e instanceof Error?e.message:"Erro de ligação");}
    finally{setCartIbLoading(false);}
  }

  useEffect(()=>{
    if(activePage==="carteira"&&cartTab==="ib"&&cartIbPos===null&&!cartIbLoading){
      fetchCartIbPositions();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[activePage,cartTab]);

  const actionCounts=useMemo(()=>{
    const empty:{ticker:string;prev:number;cur:number;delta:number;action:string}[]=[];
    if(!latestMonth||!prevMonth) return {comprar:0,aumentar:0,reduzir:0,vender:0,manter:0,rows:empty,allRows:empty};
    const N_POS=20;
    const DMIN=1.0;
    const ALWAYS_INCLUDE=new Set(["XEON"]);
    const pm=new Map(prevMonth.rows.map(r=>[r.ticker,r.weightPct]));
    const cm=new Map(latestMonth.rows.map(r=>[r.ticker,r.weightPct]));
    // Only include tickers tradeable on US exchanges — US stocks + known ADRs.
    // Tickers not tradeable via IB SMART/USD are excluded BEFORE normalisation so
    // their weights are redistributed proportionally to the remaining positions.
    const candidates=[...new Set([...pm.keys(),...cm.keys()])]
      .filter(t=>
        !ALWAYS_INCLUDE.has(t)&&
        t!=="TBILL_PROXY"&&!t.startsWith("CASH")&&!t.startsWith("TBILL")&&
        isTradeableUS(t)
      );
    const ranked=candidates
      .map(t=>({t,w:Math.max(pm.get(t)??0,cm.get(t)??0)}))
      .sort((a,b)=>b.w-a.w).slice(0,N_POS).map(x=>x.t);
    const all=[...ranked,...ALWAYS_INCLUDE];

    // Collect raw weights for selected positions
    const raw:{ticker:string;prev:number;cur:number}[]=[];
    all.forEach(t=>{
      const p=pm.get(t)??(t==="XEON"?prevMonth.tbillsTotalPct??0:0);
      const cur=cm.get(t)??(t==="XEON"?latestMonth.tbillsTotalPct??0:0);
      raw.push({ticker:t,prev:p,cur});
    });

    // Normalise to 100% so excluded small positions are redistributed proportionally
    const sumPrev=raw.reduce((s,r)=>s+r.prev,0)||1;
    const sumCur=raw.reduce((s,r)=>s+r.cur,0)||1;

    const rowsNorm:{ticker:string;prev:number;cur:number;delta:number;action:string}[]=[];
    raw.forEach(({ticker:t,prev:pRaw,cur:curRaw})=>{
      const p=Math.round((pRaw/sumPrev*100)*100)/100;
      const cur=Math.round((curRaw/sumCur*100)*100)/100;
      const delta=Math.round((cur-p)*100)/100;
      let action="Manter";
      if(pRaw===0&&curRaw>0) action="Comprar";
      else if(curRaw===0&&pRaw>0) action="Vender";
      else if(delta>=DMIN) action="Aumentar";
      else if(delta<=-DMIN) action="Reduzir";
      rowsNorm.push({ticker:t,prev:p,cur,delta,action});
    });
    // Merge tickers that belong to the same company (e.g. GOOGL+GOOG, MSBHF+MTSUY)
    const rows=dedupActionRows(rowsNorm,DMIN);
    let c=0,au=0,rd=0,v=0,m=0;
    rows.forEach(r=>{
      if(r.action==="Comprar") c++;
      else if(r.action==="Aumentar") au++;
      else if(r.action==="Reduzir") rd++;
      else if(r.action==="Vender") v++;
      else m++;
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
    // Use actionCounts.allRows (already US-only + normalised) so the chart matches the plan
    if(!actionCounts.allRows.length) return [];
    const map=new Map<string,number>();
    actionCounts.allRows.forEach(r=>{
      if(r.ticker==="XEON") return; // money market — don't attribute to equity sector
      const s=getSector(r.ticker);
      map.set(s,(map.get(s)??0)+r.cur);
    });
    const total=[...map.values()].reduce((a,b)=>a+b,0)||1;
    return [...map.entries()].map(([name,pct])=>({name,value:Math.round(pct/total*100)})).sort((a,b)=>b.value-a.value);
  },[actionCounts]);

  // ── Profile multiplier (0.75 / 1.0 / 1.25) ──────────────────────────────
  const profileFactor=useMemo(()=>
    riskProfileLocal==="conservador"?0.75:riskProfileLocal==="dinamico"?1.25:1.0
  ,[riskProfileLocal]);
  const profileLabel=useMemo(()=>
    riskProfileLocal==="conservador"?"Conservador":riskProfileLocal==="dinamico"?"Dinâmico":"Moderado"
  ,[riskProfileLocal]);

  // ── Vol rule: scale = (bench_vol × multiplier) / model_vol  (full curve) ─
  // Mirrors Python _apply_vol_rule: annualised vol computed over entire series.
  const volRuleScale=useMemo(()=>{
    if(equityRaw.length<2||benchRaw.length<2) return profileFactor;
    const mRets=equityRaw.slice(1).map((v,i)=>equityRaw[i]>0?v/equityRaw[i]-1:0);
    const bRets=benchRaw.slice(1).map((v,i)=>benchRaw[i]>0?v/benchRaw[i]-1:0);
    const mVol=annualVol(mRets);
    const bVol=annualVol(bRets);
    return mVol>0?(bVol*profileFactor)/mVol:profileFactor;
  },[equityRaw,benchRaw,profileFactor]);

  // ── Scaled equity curve: vol-rule scale applied to every daily return ─────
  const scaledEquity=useMemo(()=>scaleEquityCurve(equityRaw,volRuleScale),[equityRaw,volRuleScale]);
  /* Margin simulation — model-driven dynamic leverage via vol-targeting.
     • XEON > 0: model is defensive → NO margin, keep scaledEquity return.
     • XEON = 0: model is risk-on → borrow to leverage.
         leverage(t) = max(1.0, min(1.8, targetVol / rollingVol60d(t)))
         targetVol = benchVol × profileFactor  (same vol rule as base curve)
     This replicates the model's gross exposure, which goes from ~100% (low vol)
     up to ~180% max (very low vol) exactly as the model computes each period.     */
  const MARGIN_RATE=0.04;
  const marginEquity=useMemo(()=>{
    if(!scaledEquity.length||!benchRaw.length||!dates.length||!sortedMonths.length) return scaledEquity;
    const bRets=benchRaw.slice(1).map((v,i)=>benchRaw[i]!>0?v/benchRaw[i]!-1:0);
    const targetVol=annualVol(bRets)*profileFactor;
    if(!targetVol||!isFinite(targetVol)) return scaledEquity;
    const xeonPeriods=sortedMonths.map(m=>{
      const date=(m.rebalance_date??m.date??"").slice(0,10);
      const xeonRow=m.rows.find(r=>r.ticker==="XEON");
      const xeonPct=m.tbillsTotalPct??xeonRow?.weightPct??0;
      return {date,xeonPct};
    }).filter(p=>p.date);
    if(!xeonPeriods.length) return scaledEquity;
    return marginEquityCurveVolTargeted(scaledEquity,benchRaw,dates,xeonPeriods,targetVol,MARGIN_RATE);
  },[scaledEquity,benchRaw,dates,sortedMonths,profileFactor]);
  // Active equity: base or leveraged depending on KPI mode selection
  const activeEquity=kpiMode==="margem"?marginEquity:scaledEquity;


  // ── Recompute all KPIs from scaled curve ──────────────────────────────────
  const perfData=useMemo(()=>{
    if(!dates.length||!activeEquity.length) return null;
    // "Desde início": start at index 0 (including warmup) + calendar years to match
    // Python _apply_vol_rule methodology → CAGR consistent with v5_kpis overlayed_cagr (25.13%)
    const isInception=period==="Desde início";
    const s=isInception?0:skipWarmup(activeEquity,periodStart(dates,period));
    const calYears=isInception?calYearsFromDates(dates):undefined;
    const chart=makeChartData(dates,activeEquity,benchRaw,period);
    const m=periodMetrics(activeEquity.slice(s),benchRaw.slice(s),period,calYears);
    const allRets=activeEquity.slice(1).map((v,i)=>v/activeEquity[i]-1);
    const curVol=annualVol(allRets.slice(-252))*100;
    const curDD=currentDD(activeEquity.slice(-252*3))*100;
    const dd5Start=skipWarmup(activeEquity,periodStart(dates,"20 Anos"));
    const modelDD=rollingDD(dates.slice(dd5Start),activeEquity.slice(dd5Start),10);
    let bpk=benchRaw[dd5Start]??1;
    const dd5=modelDD.map((pt,j)=>{
      const bv=benchRaw[dd5Start+j*10]??benchRaw[benchRaw.length-1];
      if(bv>bpk)bpk=bv;
      return {...pt,bench:+(((bv-bpk)/bpk)*100).toFixed(2)};
    });
    const now=new Date(); const ytdStartStr=`${now.getFullYear()}-01-01`;
    const ytdIdx=dates.findIndex(d=>d>=ytdStartStr);
    const ytdRet=ytdIdx>=0&&activeEquity.length>ytdIdx
      ? (activeEquity[activeEquity.length-1]/activeEquity[ytdIdx]-1)*100 : 0;
    // Inception metrics — full history from index 0, calendar years → matches v5_kpis overlayed_cagr
    const calYearsInc=calYearsFromDates(dates)??dates.length/252;
    const inception=periodMetrics(activeEquity.slice(0),benchRaw.slice(0),"Desde início",calYearsInc);
    return {chart,m,curVol,curDD,ddChart:dd5,ytdRet,inception};
  },[dates,activeEquity,benchRaw,period]);

  // Convenience aliases — direct from recomputed curve (no post-hoc multiply)
  const scaledVol  =perfData?.curVol??0;
  const scaledDD   =perfData?.curDD ??0;
  const scaledYtd  =perfData?.ytdRet??0;
  const scaledTotal=perfData?.m.ret ??0;
  const scaledAnn  =perfData?.m.ann ??0;


  // Annual returns from equity series
  const annualReturns=useMemo(()=>{
    if(!dates.length||!activeEquity.length) return [];
    const byYear=new Map<number,number[]>();
    dates.forEach((d,i)=>{ const y=new Date(d).getFullYear(); if(!byYear.has(y))byYear.set(y,[]); byYear.get(y)!.push(activeEquity[i]); });
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
  },[dates,activeEquity,benchRaw]);

  // Monthly stats scoped to selected period
  const monthlyStats=useMemo(()=>{
    if(!dates.length||!activeEquity.length) return null;
    const s=skipWarmup(activeEquity,periodStart(dates,period));
    const dSlice=dates.slice(s), eSlice=activeEquity.slice(s), bSlice=benchRaw.slice(s);
    const byMonth=new Map<string,number[]>(), benchByMonth=new Map<string,number[]>();
    dSlice.forEach((d,i)=>{
      const k=d.slice(0,7);
      if(!byMonth.has(k)){byMonth.set(k,[]);benchByMonth.set(k,[]);}
      byMonth.get(k)!.push(eSlice[i]);
      benchByMonth.get(k)!.push(bSlice[i]);
    });
    const months=[...byMonth.entries()].map(([k,vals])=>{
      const bv=benchByMonth.get(k)??[1,1];
      return{k,m:(vals[vals.length-1]/vals[0]-1)*100,b:(bv[bv.length-1]/bv[0]-1)*100};
    });
    const n=months.length;
    const aboveBench=months.filter(x=>x.m>x.b).length;
    const positive=months.filter(x=>x.m>0).length;
    return{n,aboveBench,belowBench:n-aboveBench,positive,negative:n-positive};
  },[dates,activeEquity,benchRaw,period]);

  // Turnover from rebalancing history
  const turnoverStats=useMemo(()=>{
    if(sortedMonths.length<2) return null;
    const tvs=sortedMonths.map((m,idx)=>{
      if(idx===0) return 0;
      const prev=sortedMonths[idx-1];
      const pm=new Map(prev.rows.map(r=>[r.ticker,r.weightPct??0]));
      const cm=new Map(m.rows.map(r=>[r.ticker,r.weightPct??0]));
      const all=new Set([...pm.keys(),...cm.keys()]);
      let t=0; all.forEach(tk=>{t+=Math.abs((cm.get(tk)??0)-(pm.get(tk)??0));});
      return t/2;
    }).slice(1);
    const total=tvs.reduce((a,b)=>a+b,0);
    return{total,avg:tvs.length?total/tvs.length:0,n:tvs.length};
  },[sortedMonths]);

  // Benchmark period metrics (vol + shp for selected period)
  const benchPerfData=useMemo(()=>{
    if(!dates.length||!benchRaw.length) return null;
    // Use same starting index as model so model vs bench comparison is over identical period
    const isInception=period==="Desde início";
    const s=isInception?0:skipWarmup(activeEquity,periodStart(dates,period));
    const bSlice=benchRaw.slice(s);
    const eSlice=activeEquity.slice(s);
    if(bSlice.length<2) return null;
    const ret=(bSlice[bSlice.length-1]/bSlice[0]-1)*100;
    const calYears=isInception?calYearsFromDates(dates):undefined;
    const y=calYears!==undefined?calYears
      :period==="YTD"?(new Date().getMonth()+1)/12
      :period==="1 Ano"?1:period==="3 Anos"?3:period==="5 Anos"?5
      :period==="20 Anos"?20:bSlice.length/252;
    const ann=cagrFn(bSlice[0],bSlice[bSlice.length-1],y)*100;
    const bRets=bSlice.slice(1).map((v,i)=>v/bSlice[i]-1);
    const shp=sharpe(bRets);
    const vol=annualVol(bRets)*100;
    // Alpha = model CAGR - bench CAGR (annualised, same period)
    const mRets=eSlice.slice(1).map((v,i)=>v/eSlice[i]-1);
    const mVol=annualVol(mRets)*100;
    const alpha=((perfData?.m.ann??0)-ann);
    return{ret,ann,shp,vol,alpha,mVol};
  },[dates,activeEquity,benchRaw,period,perfData]);

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
    if(activeEquity.length<24) return [];
    const step=21;
    const monthlyRets:number[]=[];
    for(let i=step;i<activeEquity.length;i+=step){
      monthlyRets.push((activeEquity[i]!/activeEquity[i-step]!-1)*100);
    }
    const BIN_W=2,MIN=-20,MAX=30;
    const bins:number[]=[];
    for(let b=MIN;b<MAX;b+=BIN_W) bins.push(b);
    return bins.map(b=>{
      const count=monthlyRets.filter(r=>r>=b&&r<b+BIN_W).length;
      return {bin:`${b>0?"+":""}${b}%`, count, mid:b+BIN_W/2};
    });
  },[activeEquity]);

  // Sector allocation + risk contribution
  const SECTOR_BETA:Record<string,number>={
    "Tecnologia":1.35,"Comunicação":1.15,"Internet":1.20,"Energia":1.05,"Industrial":1.00,
    "Mat. Básicos":0.90,"Mineira":0.85,"Cons. Básico":0.70,"Saúde":0.75,"Financeiro":1.10,
    "Imobiliário":0.85,"Cons. Discr.":1.15,"Liquidez":0.10,"Outros":1.00,
  };
  const sectorAlloc=useMemo(()=>{
    if(!latestMonth) return [];
    const m=new Map<string,number>();
    (latestMonth.rows??[]).filter((r:any)=>r.ticker!=="XEON"&&!r.ticker.startsWith("TBILL")&&(r.weightPct??0)>=0.5).forEach((r:any)=>{
      const s=getSector(r.ticker)||"Outros";
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
  const countryAlloc=useMemo(()=>{
    const m=new Map<string,number>();
    actionCounts.allRows.forEach(r=>{
      if(r.ticker==="XEON") return;
      const c=getZone(r.ticker);
      if(c==="Eurozona") return;
      m.set(c,(m.get(c)??0)+r.cur);
    });
    return m;
  },[actionCounts.allRows]);

  const riskMetrics=useMemo(()=>{
    if(activeEquity.length<252) return {var95:0,beta:0};
    const mRets=activeEquity.slice(1).map((v,i)=>v/activeEquity[i]-1);
    const bRets=benchRaw.slice(1).map((v,i)=>v/(benchRaw[i]||1)-1);
    const sorted=[...mRets].sort((a,b)=>a-b);
    const var95=sorted[Math.floor(sorted.length*0.05)]??0;
    const n=Math.min(mRets.length,bRets.length);
    const bMean=bRets.slice(0,n).reduce((a,b)=>a+b,0)/n;
    const bVar=bRets.slice(0,n).reduce((a,b)=>a+(b-bMean)**2,0)/n;
    const cov=mRets.slice(0,n).reduce((a,m,i)=>a+(m-mRets.slice(0,n).reduce((x,y)=>x+y,0)/n)*(bRets[i]!-bMean),0)/n;
    return {var95:var95*100,beta:bVar>0?+(cov/bVar).toFixed(2):0};
  },[activeEquity,benchRaw]);

  const recoLabel=useMemo(()=>{
    const raw=latestMonth?.date??latestMonth?.rebalance_date??"";
    if(!raw) return "Última recomendação";
    try{
      // Rebalancing on Apr-30 → label = "maio de 2026" (the month the portfolio is applied in)
      const d=new Date(raw);
      d.setUTCMonth(d.getUTCMonth()+1,1);
      return d.toLocaleDateString("pt-PT",{month:"long",year:"numeric"});
    }catch{ return raw; }
  },[latestMonth]);

  const whatChanged=useMemo(()=>{
    const changed=actionCounts.rows.filter(r=>r.action!=="Manter"&&r.ticker!=="XEON");
    if(!changed.length) return [{icon:"up",title:"Modelo mantém posicionamento",desc:"Sem alterações significativas este mês."}];
    // Compute net delta per sector — avoids showing both "Aumentámos" and "Reduzimos" for the same sector
    const sectorNet=new Map<string,{delta:number;up:string[];down:string[]}>();
    changed.forEach(r=>{
      const s=getSector(r.ticker)||"Outros";
      if(!sectorNet.has(s)) sectorNet.set(s,{delta:0,up:[],down:[]});
      const e=sectorNet.get(s)!;
      e.delta+=r.delta;
      if(r.action==="Comprar"||r.action==="Aumentar") e.up.push(r.ticker);
      else e.down.push(r.ticker);
    });
    const items:[{icon:string;title:string;desc:string}]=[] as any;
    [...sectorNet.entries()]
      .sort((a,b)=>Math.abs(b[1].delta)-Math.abs(a[1].delta))
      .forEach(([sector,{delta,up,down}])=>{
        const dir=delta>=0?"up":"down";
        const tickers=delta>=0?up:down;
        items.push({
          icon:dir,
          title:delta>=0?`Aumentámos exposição a ${sector}`:`Reduzimos ${sector}`,
          desc:`${tickers.join(", ")}.`,
        });
      });
    items.push({icon:"wave",title:"Volatilidade controlada",desc:`Vol actual ${perfData?.curVol?.toFixed(1)??"—"}% anual — nível Moderado.`});
    return (items as {icon:string;title:string;desc:string}[]).slice(0,4);
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
                  activePage==="actividade"?"Actividade":
                  activePage==="custos"?"Custos":
                  activePage==="robustez"?"Testes de Robustez":
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
                  activePage==="actividade"?"Registo completo de todas as operações e alterações":
                  activePage==="custos"?"Transparência total sobre os custos do serviço e da sua carteira":
                  activePage==="robustez"?"Metodologia, cenários de stress e resultados dos testes internos":
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
                          <button key={k.id} onClick={()=>setMarginEnabled(k.id==="margem")}
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
              {activePage==="relatorios"&&(()=>{
                const reportDate=new Date().toLocaleDateString("pt-PT",{day:"2-digit",month:"long",year:"numeric"});
                const pfLabel=profileFactor<1?"Conservador":profileFactor>1?"Dinâmico":"Moderado";
                const fmtPct=(v:number,sign=false)=>`${sign&&v>=0?"+":""}${v.toFixed(2)}%`;
                const fmtEur=(v:number)=>v.toLocaleString("pt-PT",{minimumFractionDigits:0,maximumFractionDigits:0});
                // Use period-based vol (same as Performance / Dashboard / Risco pages)
                const reportVol=(benchPerfData?.mVol??0)>0?(benchPerfData?.mVol??0):scaledVol;
                // Use same Sharpe source as Performance/Dashboard (perfData.inception.shp)
                const sharpeVal=perfData?.inception?.shp??perfData?.m?.shp??0;
                // Top-5 holdings
                const top5=(latestMonth?.rows??[])
                  .filter(r=>!r.ticker.startsWith("TBILL")&&!r.ticker.startsWith("CASH")&&r.ticker!=="XEON")
                  .sort((a,b)=>b.weightPct-a.weightPct).slice(0,5);
                // Sector allocation
                const secMap=new Map<string,number>();
                (latestMonth?.rows??[]).forEach(r=>{
                  if(r.ticker.startsWith("TBILL")||r.ticker.startsWith("CASH")) return;
                  const s=getSector(r.ticker);
                  secMap.set(s,(secMap.get(s)??0)+r.weightPct);
                });
                const topSectors=[...secMap.entries()].sort((a,b)=>b[1]-a[1]).slice(0,6);
                // Recent changes
                const changes=actionCounts.rows.filter(r=>r.action!=="Manter").slice(0,8);
                // Chart data (YTD only for report)
                const reportChart=(perfData?.chart??[]).slice(-252);
                const ytdGain=aum*scaledYtd/100;
                const isUp=scaledYtd>=0;
                return (
                  <div className="space-y-5 print:space-y-4">
                    {/* ── Report header ── */}
                    <div className="bg-gradient-to-r from-[#0b0f1a] to-[#0f1628] border border-[#1a1f2e] rounded-xl p-6 flex items-start justify-between">
                      <div>
                        <div className="text-slate-200 font-bold text-2xl mb-1">Relatório de Carteira</div>
                        <div className="text-slate-400 text-sm">Perfil <span className="text-teal-400 font-semibold">{pfLabel}</span> · {reportDate}</div>
                      </div>
                      <div className="text-right">
                        <div className="text-slate-500 text-xs mb-1">Valor da carteira</div>
                        <div className="text-white font-black text-3xl">€ {fmtEur(aum)}</div>
                        <div className={`text-sm font-bold mt-1 ${isUp?"text-emerald-400":"text-red-400"}`}>
                          {fmtPct(scaledYtd,true)} YTD &nbsp;
                          <span className="text-slate-500 font-normal text-xs">({isUp?"+":" "}{fmtEur(ytdGain)} €)</span>
                        </div>
                      </div>
                    </div>

                    {/* ── KPI row ── */}
                    <div className="grid grid-cols-5 gap-3">
                      {[
                        {label:"Retorno YTD",val:fmtPct(scaledYtd,true),c:isUp?"text-emerald-400":"text-red-400",sub:"Ano corrente"},
                        {label:"Retorno total",val:fmtPct(scaledTotal,true),c:scaledTotal>=0?"text-emerald-400":"text-red-400",sub:`CAGR ${fmtPct(scaledAnn,true)}`},
                        {label:"Volatilidade",val:reportVol>0?`${reportVol.toFixed(1)}%`:"—",c:"text-amber-400",sub:"Período completo"},
                        {label:"Máx. drawdown",val:scaledDD!==0?fmtPct(scaledDD):"—",c:"text-red-400",sub:"Últimos 3 anos"},
                        {label:"Sharpe ratio",val:sharpeVal.toFixed(2),c:sharpeVal>=1?"text-emerald-400":sharpeVal>=0?"text-amber-400":"text-red-400",sub:"Rf = 2%"},
                      ].map(k=>(
                        <div key={k.label} className="bg-[#0b0f1a] border border-[#1a1f2e] rounded-xl p-4">
                          <div className="text-slate-500 text-[10px] font-semibold mb-2 uppercase tracking-wider">{k.label}</div>
                          <div className={`text-2xl font-black ${k.c}`}>{k.val}</div>
                          <div className="text-slate-600 text-[10px] mt-1">{k.sub}</div>
                        </div>
                      ))}
                    </div>

                    {/* ── Performance chart + Sector breakdown ── */}
                    <div className="grid grid-cols-3 gap-4">
                      <div className="col-span-2 bg-[#0b0f1a] border border-[#1a1f2e] rounded-xl p-5">
                        <div className="flex items-center justify-between mb-4">
                          <div className="font-bold text-slate-200 text-sm">Evolução da carteira</div>
                          <div className="flex items-center gap-4 text-[10px] text-slate-500">
                            <span className="flex items-center gap-1.5"><span className="w-4 h-0.5 bg-teal-500 inline-block rounded"/>{pfLabel}</span>
                            <span className="flex items-center gap-1.5"><span className="w-4 h-0.5 bg-slate-600 inline-block rounded" style={{borderTop:"2px dashed #475569"}}/>{BENCH_SHORT}</span>
                          </div>
                        </div>
                        {reportChart.length>0?(
                          <ResponsiveContainer width="100%" height={200}>
                            <AreaChart data={reportChart} margin={{top:4,right:4,bottom:0,left:0}}>
                              <defs>
                                <linearGradient id="repGrad" x1="0" y1="0" x2="0" y2="1">
                                  <stop offset="5%" stopColor="#14b8a6" stopOpacity={0.18}/>
                                  <stop offset="95%" stopColor="#14b8a6" stopOpacity={0}/>
                                </linearGradient>
                              </defs>
                              <XAxis dataKey="date" tick={{fill:"#475569",fontSize:9}} tickLine={false} axisLine={false}
                                tickFormatter={d=>d?String(d).slice(0,7):""}
                                interval={Math.floor(reportChart.length/6)}/>
                              <YAxis tick={{fill:"#475569",fontSize:9}} tickLine={false} axisLine={false}
                                tickFormatter={v=>`${(+v).toFixed(0)}%`} domain={["auto","auto"]}/>
                              <Tooltip contentStyle={{background:"#0f172a",border:"1px solid #1e293b",borderRadius:8,fontSize:11}}
                                formatter={(v:number)=>[`${v?.toFixed(2)}%`,""]}
                                labelFormatter={l=>String(l).slice(0,10)}/>
                              <ReferenceLine y={0} stroke="#1e293b" strokeDasharray="3 3"/>
                              <Area type="monotone" dataKey="model" stroke="#14b8a6" strokeWidth={2} fill="url(#repGrad)" dot={false} name={pfLabel}/>
                              <Area type="monotone" dataKey="bench" stroke="#475569" strokeWidth={1.5} strokeDasharray="4 2" fill="none" dot={false} name={BENCH_SHORT}/>
                            </AreaChart>
                          </ResponsiveContainer>
                        ):(
                          <div className="h-[200px] flex items-center justify-center text-slate-600 text-sm">Sem dados de performance</div>
                        )}
                      </div>

                      <div className="bg-[#0b0f1a] border border-[#1a1f2e] rounded-xl p-5">
                        <div className="font-bold text-slate-200 text-sm mb-4">Exposição sectorial</div>
                        {topSectors.length>0?(
                          <div className="space-y-3">
                            {topSectors.map(([sec,pct],i)=>(
                              <div key={sec}>
                                <div className="flex justify-between text-xs mb-1">
                                  <span className="text-slate-300">{sec}</span>
                                  <span className="text-slate-200 font-semibold">{pct.toFixed(1)}%</span>
                                </div>
                                <div className="h-1.5 bg-slate-800 rounded-full">
                                  <div className="h-1.5 rounded-full" style={{width:`${pct}%`,background:PIE_COLORS[i%PIE_COLORS.length]}}/>
                                </div>
                              </div>
                            ))}
                          </div>
                        ):(
                          <div className="text-slate-600 text-sm text-center py-4">Sem dados</div>
                        )}
                      </div>
                    </div>

                    {/* ── Holdings + Changes ── */}
                    <div className="grid grid-cols-2 gap-4">
                      {/* Top holdings */}
                      <div className="bg-[#0b0f1a] border border-[#1a1f2e] rounded-xl p-5">
                        <div className="font-bold text-slate-200 text-sm mb-4">Principais posições</div>
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="text-slate-500 border-b border-[#1a1f2e] text-left">
                              <th className="pb-2 font-semibold">Empresa</th>
                              <th className="pb-2 font-semibold">Sector</th>
                              <th className="pb-2 font-semibold text-right">País</th>
                              <th className="pb-2 font-semibold text-right">Peso</th>
                            </tr>
                          </thead>
                          <tbody>
                            {top5.map((r,i)=>(
                              <tr key={r.ticker} className="border-b border-[#0f172a] last:border-0">
                                <td className="py-2">
                                  <div className="flex items-center gap-2">
                                    <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{background:PIE_COLORS[i%PIE_COLORS.length]}}/>
                                    <div>
                                      <div className="text-slate-200 font-semibold">{getCompany(r.ticker)||r.ticker}</div>
                                      <div className="text-slate-600 text-[9px]">{r.ticker}</div>
                                    </div>
                                  </div>
                                </td>
                                <td className="py-2 text-slate-400">{getSector(r.ticker)}</td>
                                <td className="py-2 text-slate-400 text-right">{getZone(r.ticker)}</td>
                                <td className="py-2 text-right font-bold text-slate-200">{r.weightPct.toFixed(1)}%</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>

                      {/* Recent changes */}
                      <div className="bg-[#0b0f1a] border border-[#1a1f2e] rounded-xl p-5">
                        <div className="font-bold text-slate-200 text-sm mb-4">Alterações recentes</div>
                        {changes.length===0?(
                          <div className="text-slate-600 text-sm text-center py-4">Sem alterações neste rebalanceamento</div>
                        ):(
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="text-slate-500 border-b border-[#1a1f2e] text-left">
                                <th className="pb-2 font-semibold">Empresa</th>
                                <th className="pb-2 font-semibold text-right">Peso ant.</th>
                                <th className="pb-2 font-semibold text-right">Peso novo</th>
                                <th className="pb-2 font-semibold text-right">Ação</th>
                              </tr>
                            </thead>
                            <tbody>
                              {changes.map(r=>{
                                const ac=r.action;
                                const isB=ac==="Comprar"||ac==="Aumentar";
                                const isS=ac==="Vender"||ac==="Reduzir";
                                return (
                                  <tr key={r.ticker} className="border-b border-[#0f172a] last:border-0">
                                    <td className="py-2">
                                      <div className="text-slate-200 font-semibold">{getCompany(r.ticker)||r.ticker}</div>
                                      <div className="text-slate-600 text-[9px]">{r.ticker}</div>
                                    </td>
                                    <td className="py-2 text-right text-slate-400">{r.prev.toFixed(1)}%</td>
                                    <td className="py-2 text-right text-slate-200 font-semibold">{r.cur.toFixed(1)}%</td>
                                    <td className="py-2 text-right">
                                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${isB?"bg-emerald-900/40 text-emerald-400":isS?"bg-red-900/40 text-red-400":"bg-slate-800 text-slate-400"}`}>
                                        {ac}
                                      </span>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        )}
                      </div>
                    </div>

                    {/* ── Commentary ── */}
                    <div className="bg-[#0b0f1a] border border-[#1a1f2e] rounded-xl p-6">
                      <div className="font-bold text-slate-200 text-sm mb-4 flex items-center gap-2">
                        <BookOpen size={14} className="text-teal-400"/>
                        Comentário da carteira
                      </div>
                      <div className="space-y-4 text-sm text-slate-400 leading-relaxed">
                        <p>
                          A carteira DECIDE com perfil <span className="text-slate-200 font-semibold">{pfLabel}</span> encerra o período
                          com um retorno acumulado de <span className={`font-semibold ${scaledTotal>=0?"text-emerald-400":"text-red-400"}`}>{fmtPct(scaledTotal,true)}</span>,
                          correspondendo a uma taxa de crescimento anualizada (CAGR) de <span className="text-slate-200 font-semibold">{fmtPct(scaledAnn,true)}</span>.
                          No ano corrente, a carteira regista <span className={`font-semibold ${isUp?"text-emerald-400":"text-red-400"}`}>{fmtPct(scaledYtd,true)}</span>,
                          equivalente a <span className="text-slate-200 font-semibold">{isUp?"+":""}{fmtEur(ytdGain)} €</span> sobre o valor investido.
                        </p>
                        <p>
                          O modelo mantém uma volatilidade anualizada de <span className="text-amber-400 font-semibold">{reportVol.toFixed(1)}%</span>,
                          reflectindo o nível de risco associado ao perfil {pfLabel.toLowerCase()}.
                          O máximo drawdown nos últimos três anos foi de <span className="text-red-400 font-semibold">{fmtPct(scaledDD)}</span>,
                          o que demonstra a capacidade de contenção de perdas da estratégia quantitativa.
                          O rácio de Sharpe situou-se em <span className={`font-semibold ${sharpeVal>=1?"text-emerald-400":"text-amber-400"}`}>{sharpeVal.toFixed(2)}</span>,
                          indicando {sharpeVal>=1?"uma remuneração adequada do risco assumido":"margem para melhoria na remuneração do risco"}.
                        </p>
                        <p>
                          A carteira é composta por <span className="text-slate-200 font-semibold">{(latestMonth?.rows??[]).filter(r=>!r.ticker.startsWith("TBILL")&&!r.ticker.startsWith("CASH")&&r.ticker!=="XEON").length} títulos</span>,
                          com maior concentração em <span className="text-slate-200 font-semibold">{topSectors[0]?.[0]??"—"}</span> ({topSectors[0]?.[1]?.toFixed(1)??"0"}%)
                          e <span className="text-slate-200 font-semibold">{topSectors[1]?.[0]??"—"}</span> ({topSectors[1]?.[1]?.toFixed(1)??"0"}%).
                          {changes.length>0&&(
                            <> Neste rebalanceamento foram efectuadas <span className="text-slate-200 font-semibold">{changes.length} alterações</span>,
                            com {actionCounts.comprar+actionCounts.aumentar} novas entradas/reforços e {actionCounts.reduzir+actionCounts.vender} reduções/saídas.</>
                          )}
                          {changes.length===0&&<> A carteira não sofreu alterações no último rebalanceamento.</>}
                        </p>
                        <p className="text-slate-600 text-xs border-t border-[#1a1f2e] pt-3">
                          Este relatório foi gerado automaticamente pelo sistema DECIDE com base nos dados históricos do modelo quantitativo.
                          Os dados de performance são calculados sobre a curva de capital ajustada ao perfil de risco seleccionado.
                          A informação apresentada é de carácter meramente informativo e não constitui recomendação de investimento.
                          O desempenho passado não garante resultados futuros.
                        </p>
                      </div>
                    </div>

                    {/* ── Risk metrics row ── */}
                    <div className="bg-[#0b0f1a] border border-[#1a1f2e] rounded-xl p-5">
                      <div className="font-bold text-slate-200 text-sm mb-4">Métricas de risco</div>
                      <div className="grid grid-cols-4 gap-4 text-sm">
                        {[
                          {label:"Volatilidade (período)",val:`${reportVol.toFixed(2)}%`,desc:"Desvio padrão anualizado dos retornos (período completo)"},
                          {label:"Máx. Drawdown (3a)",val:fmtPct(scaledDD),desc:"Queda máxima pico-a-vale nos últimos 3 anos"},
                          {label:"Sharpe Ratio",val:sharpeVal.toFixed(2),desc:"Retorno anualizado excesso / volatilidade (Rf=2%)"},
                          {label:"CAGR",val:fmtPct(scaledAnn,true),desc:"Taxa de crescimento anual composta desde início"},
                        ].map(m=>(
                          <div key={m.label} className="border border-[#1a1f2e] rounded-lg p-4">
                            <div className="text-slate-500 text-[10px] uppercase tracking-wider mb-1">{m.label}</div>
                            <div className="text-slate-100 font-black text-xl mb-2">{m.val}</div>
                            <div className="text-slate-600 text-[10px] leading-relaxed">{m.desc}</div>
                          </div>
                        ))}
                      </div>
                    </div>

                  </div>
                );
              })()}

              {/* ── ACTIVIDADE ── */}
              {activePage==="actividade"&&<ActividadePage sortedMonths={sortedMonths}/>}

              {/* ── DASHBOARD ── */}
              {activePage==="dashboard"&&(
                <div className="space-y-4">
                  {/* ── KPI header with refresh button ── */}
                  <div className="flex items-center justify-between -mb-2">
                    <div className="text-[10px] text-slate-500">
                      Perfil activo: <span className="font-bold text-slate-300">{profileLabel}</span>
                      {" · "}Vol: <span className="font-bold text-amber-400">{(benchPerfData?.mVol??0)>0?(benchPerfData?.mVol??0).toFixed(1)+"%":"—"}</span>
                      {" · "}Factor: <span className="font-bold text-blue-400">{profileFactor}×</span>
                      {kpiMode==="margem"&&<span className="ml-1.5 px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400 font-bold">com margem (dinâmico)</span>}
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
                    const marginSub=kpiMode==="margem"?" · com margem":"";
                    return (
                      <div className="grid grid-cols-5 gap-3">
                        {[
                          {label:"Valor da carteira",val:`€ ${fmtE(aum)}`,sub:"Património total",
                           icon:<div className="text-blue-400 text-lg">📦</div>,c:"text-slate-100"},
                          {label:"Variação (YTD)",val:fmtP(scaledYtd,true),sub:`${scaledYtd>=0?"+ €":"- €"} ${fmtE(Math.abs(aum*scaledYtd/100))} · ${pfLabel}${marginSub}`,
                           icon:<TrendingUp size={16} className="text-emerald-400"/>,c:scaledYtd>=0?"text-emerald-400":"text-red-400"},
                          {label:"Retorno anual (desde início)",val:fmtP(perfData?.inception.ann??0,true),sub:`CAGR · ${pfLabel} · perfil ${profileLabel}${marginSub}`,
                           icon:<Activity size={16} className="text-blue-400"/>,c:(perfData?.inception.ann??0)>=0?"text-emerald-400":"text-red-400"},
                          {label:"Risco (Volatilidade anual)",val:(benchPerfData?.mVol??0)>0?`${(benchPerfData?.mVol??0).toFixed(1)}%`:"—",
                           sub:`${pfLabel} vol base · Perfil ${profileLabel}${marginSub}`,
                           icon:<ShieldCheck size={16} className="text-amber-400"/>,c:"text-amber-400"},
                          {label:"Máximo drawdown",val:scaledDD!==0?fmtP(scaledDD):"—",
                           sub:`${pfLabel} · Perfil ${profileLabel}${marginSub}`,
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
                                    <a href={`https://finance.yahoo.com/quote/${getYFTicker(r.ticker)}`} target="_blank" rel="noopener noreferrer" className="font-bold text-blue-400 hover:underline">{displayTicker(r.ticker)}</a>
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
                          <XAxis dataKey="date" tick={{fontSize:9,fill:"#64748b"}} tickLine={false} axisLine={false} interval={Math.floor((perfData?.chart.length??1)/6)}
                            tickFormatter={(d:string)=>{const dt=new Date(d);return `${dt.toLocaleString("pt-PT",{month:"short"})} ${String(dt.getFullYear()).slice(2)}`;}}/>
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
                                <Pie data={sectorData.filter(s=>s.value>=1)} cx="50%" cy="50%" innerRadius={38} outerRadius={60} dataKey="value" strokeWidth={0} paddingAngle={2}>
                                  {sectorData.filter(s=>s.value>=1).map((_,i)=><Cell key={i} fill={PIE_COLORS[i%PIE_COLORS.length]}/>)}
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
                            {sectorData.filter(s=>s.value>=1).map((s,i)=>(
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

                  {/* ── Row 3b: World allocation map ── */}
                  {(()=>{
                    // Approximate centroids [lng, lat] for label placement
                    const CENTROIDS:Record<string,[number,number]>={
                      "EUA":[-98,38],"Canadá":[-96,60],"Reino Unido":[-2,54],
                      "Japão":[138,37],"Alemanha":[10,51],"Países Baixos":[5,52],
                      "Noruega":[15,65],"Dinamarca":[10,56],"Finlândia":[25,64],
                      "Itália":[12,43],"Espanha":[-4,40],"Suíça":[8,47],
                      "Austrália":[134,-27],"China":[104,35],"França":[2,46],
                      "Suécia":[17,62],"Irlanda":[-8,53],"Áustria":[14,47],
                      "Brasil":[-52,-10],"Luxemburgo":[6,49.6],
                      "Portugal":[-8,39],
                    };
                    const topCountries=[...countryAlloc.entries()].sort((a,b)=>b[1]-a[1]);
                    return (
                      <div className="bg-[#0b0f1a] border border-[#1a1f2e] rounded-xl p-5">
                        <div className="font-bold text-slate-200 text-sm mb-3 flex items-center gap-2">
                          Exposição geográfica
                          {hoveredCountry&&(
                            <span className="ml-2 text-xs font-normal text-blue-300">
                              {hoveredCountry.name}:{" "}
                              {hoveredCountry.pct>0
                                ?<strong>{hoveredCountry.pct.toFixed(1)}%</strong>
                                :<span className="text-slate-400">na base de dados</span>
                              }
                            </span>
                          )}
                        </div>
                        <div className="grid grid-cols-3 gap-4">
                          <div className="col-span-2">
                            <ComposableMap
                              projection="geoNaturalEarth1"
                              projectionConfig={{scale:140,center:[10,10]}}
                              style={{width:"100%",height:"auto"}}
                            >
                              <ZoomableGroup zoom={1} center={[10,10]} disablePanning>
                                <Geographies geography="https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json">
                                  {({geographies})=>geographies.map(geo=>{
                                    const isoId=String(geo.id).padStart(3,"0");
                                    const cName=ISO_TO_COUNTRY[isoId];
                                    const pct=cName?countryAlloc.get(cName)??0:0;
                                    const inDb=cName?DB_COUNTRIES.has(cName):false;
                                    // Blue  = in recommendation | Slate-teal = in DB only | Dark = not in DB
                                    const fill=pct>0?"#3b82f6":inDb?"#1e3a5f":"#111827";
                                    const fillHover=pct>0?"#60a5fa":inDb?"#2d5a8e":"#1a2540";
                                    return (
                                      <Geography
                                        key={geo.rsmKey}
                                        geography={geo}
                                        fill={fill}
                                        stroke="#1e293b"
                                        strokeWidth={0.5}
                                        style={{default:{outline:"none"},hover:{outline:"none",fill:fillHover},pressed:{outline:"none"}}}
                                        onMouseEnter={()=>{if(cName&&(pct>0||inDb))setHoveredCountry({name:cName,pct});}}
                                        onMouseLeave={()=>setHoveredCountry(null)}
                                      />
                                    );
                                  })}
                                </Geographies>
                                {/* Percentage labels on countries */}
                                {[...countryAlloc.entries()].map(([c,pct])=>{
                                  const coords=CENTROIDS[c];
                                  if(!coords) return null;
                                  return (
                                    <Marker key={c} coordinates={coords}>
                                      <text
                                        textAnchor="middle"
                                        style={{fontFamily:"sans-serif",fontSize:c==="EUA"?8:6,fontWeight:700,fill:"#ffffff",pointerEvents:"none"}}
                                        dy=".35em"
                                      >
                                        {pct.toFixed(1)}%
                                      </text>
                                    </Marker>
                                  );
                                })}
                              </ZoomableGroup>
                            </ComposableMap>
                            {/* Legend */}
                            <div className="flex items-center gap-3 mt-1 px-1">
                              <div className="flex items-center gap-1.5">
                                <div className="w-3 h-2 rounded-sm" style={{background:"#3b82f6"}}/>
                                <span className="text-[9px] text-slate-400">Recomendado</span>
                              </div>
                              <div className="flex items-center gap-1.5">
                                <div className="w-3 h-2 rounded-sm" style={{background:"#1e3a5f"}}/>
                                <span className="text-[9px] text-slate-400">Na base de dados</span>
                              </div>
                            </div>
                          </div>
                          <div className="space-y-1.5 self-center">
                            {topCountries.map(([c,pct])=>(
                              <div key={c} className="flex items-center gap-2 text-[11px]">
                                <div className="w-full bg-slate-800 rounded-full h-1.5 flex-1">
                                  <div className="bg-blue-500 h-1.5 rounded-full" style={{width:`${Math.min(100,(pct/(topCountries[0]?.[1]||1))*100)}%`}}/>
                                </div>
                                <span className="text-slate-400 w-28 shrink-0">{c}</span>
                                <span className="text-slate-200 font-semibold w-10 text-right shrink-0">{pct.toFixed(1)}%</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    );
                  })()}

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
                        {icon:"📊",label:"Volatilidade alvo",val:`~${((benchPerfData?.mVol??0)>0?(benchPerfData?.mVol??0):0).toFixed(1)}% aa (${profileFactor<1?"0,75×":profileFactor>1?"1,25×":"1×"} vol do modelo)`},
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
                      <th className="text-right pb-2 font-semibold">
                        <span title="Peso no plano do mês anterior">Mês ant.</span>
                      </th>
                      <th className="text-right pb-2 font-semibold">
                        <span title="Peso no plano deste mês">Este mês</span>
                      </th>
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
                    <tfoot>
                      <tr className="border-t-2 border-[#252a3a] bg-[#0b0f1a]">
                        <td colSpan={3} className="py-2.5 px-0 text-xs font-bold text-slate-400">
                          Total ({actionCounts.allRows.length} posições)
                        </td>
                        <td className="py-2.5 text-right text-xs font-semibold text-slate-300">
                          {actionCounts.allRows.reduce((s,r)=>s+r.prev,0).toFixed(1)}%
                        </td>
                        <td className="py-2.5 text-right text-xs font-bold text-slate-200">
                          {actionCounts.allRows.reduce((s,r)=>s+r.cur,0).toFixed(1)}%
                        </td>
                        <td className="py-2.5 text-right text-xs text-slate-500">—</td>
                        <td className="py-2.5 text-right text-xs text-slate-500">—</td>
                      </tr>
                    </tfoot>
                  </table>
                )}
              </div>
            </>
            )}

              {/* ── CARTEIRA ── */}
              {activePage==="carteira"&&(
                <div className="space-y-5">
                  {/* Tab bar */}
                  <div className="flex gap-1 bg-[#0b0f1a] border border-[#1a1f2e] rounded-xl p-1 w-fit">
                    {([["ib","Carteira real (IB)"],["plano","Plano modelo"]] as const).map(([k,l])=>(
                      <button key={k} onClick={()=>setCartTab(k)}
                        className={`px-4 py-2 rounded-lg text-xs font-semibold transition-colors ${cartTab===k?"bg-blue-600 text-white":"text-slate-400 hover:text-slate-200"}`}>
                        {l}
                      </button>
                    ))}
                  </div>

                  {/* ── TAB: Carteira real IB ── */}
                  {cartTab==="ib"&&(
                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <div className="text-slate-400 text-xs">
                          {cartIbPos!==null&&!cartIbErr&&(
                            <span>
                            {cartIbPos.length} posições · investido {cartIbPos.reduce((s,p)=>s+p.value,0).toLocaleString("pt-PT",{minimumFractionDigits:0,maximumFractionDigits:0})} EUR
                            {cartIbNav.value>0&&<span className="text-slate-600 ml-2">(conta paper: {cartIbNav.value.toLocaleString("pt-PT",{minimumFractionDigits:0,maximumFractionDigits:0})} {cartIbNav.ccy})</span>}
                          </span>
                          )}
                        </div>
                        <button onClick={fetchCartIbPositions} disabled={cartIbLoading}
                          className="flex items-center gap-1.5 bg-[#0b0f1a] border border-[#1a1f2e] hover:border-blue-500 text-slate-300 text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50">
                          {cartIbLoading?<span className="animate-spin text-xs">⟳</span>:null}
                          {cartIbLoading?"A carregar…":"↻ Actualizar"}
                        </button>
                      </div>
                      {cartIbErr&&<div className="bg-red-900/30 border border-red-500/30 text-red-300 text-xs rounded-lg px-4 py-3">{cartIbErr}</div>}
                      {cartIbPos===null&&!cartIbLoading&&!cartIbErr&&(
                        <div className="bg-[#0b0f1a] border border-[#1a1f2e] rounded-xl p-8 text-center text-slate-500 text-sm">A carregar posições IB…</div>
                      )}
                      {cartIbPos!==null&&cartIbPos.length===0&&!cartIbErr&&(
                        <div className="bg-[#0b0f1a] border border-[#1a1f2e] rounded-xl p-8 text-center">
                          <div className="text-slate-400 text-sm mb-1">Nenhuma posição em carteira</div>
                          <div className="text-slate-500 text-xs">A conta IB está vazia. Usa "Enviar Ordens" para construir a carteira.</div>
                        </div>
                      )}
                      {cartIbPos!==null&&cartIbPos.length>0&&(
                        <div className="bg-[#0b0f1a] border border-[#1a1f2e] rounded-xl overflow-hidden">
                          <table className="w-full text-xs">
                            <thead><tr className="text-slate-500 border-b border-[#1a1f2e] font-semibold">
                              <th className="text-left px-4 py-3">Ativo</th>
                              <th className="text-left px-2 py-3">Nome</th>
                              <th className="text-left px-2 py-3">Setor</th>
                              <th className="text-left px-2 py-3">País</th>
                              <th className="text-right px-2 py-3">Qtd</th>
                              <th className="text-right px-2 py-3">Valor</th>
                              <th className="text-right px-2 py-3">Peso %</th>
                              <th className="text-right px-4 py-3 text-slate-600" title="Diferença face ao peso-alvo do plano">Desvio</th>
                            </tr></thead>
                            <tbody>
                              {(()=>{
                                // IB marketValue is in account base currency (EUR) — use aum as denominator for weight
                                // planMap keyed by plan ticker AND IB-alias (e.g. "BATS"→cur AND "BTI"→cur)
                                const planMap=new Map<string,number>();
                                actionCounts.allRows.forEach(r=>{
                                  planMap.set(r.ticker.toUpperCase(),r.cur);
                                  const ibAlias=toIbTicker(r.ticker);
                                  if(ibAlias!==r.ticker.toUpperCase()) planMap.set(ibAlias,r.cur);
                                });
                                return cartIbPos.map((p,i)=>{
                                  const pctOfPlan=aum>0?(p.value/aum*100):0;
                                  const planTarget=planMap.get(p.ticker.toUpperCase())??0;
                                  const desvio=pctOfPlan-planTarget;
                                  const desvioTxt=desvio===0?"—":`${desvio>0?"+":""}${desvio.toFixed(1)}pp`;
                                  const devColor=Math.abs(desvio)<1?"text-slate-500":desvio>0?"text-amber-400":"text-sky-400";
                                  return(
                                    <tr key={p.ticker} className={`border-b border-[#1a1f2e] hover:bg-[#111827] transition-colors ${i%2===0?"":"bg-[#080c14]"}`}>
                                      <td className="px-4 py-2.5 font-bold text-blue-400">{displayTicker(p.ticker)}</td>
                                      <td className="px-2 py-2.5 text-slate-300">{(p as any).name||"—"}</td>
                                      <td className="px-2 py-2.5 text-slate-400">{(p as any).sector||"—"}</td>
                                      <td className="px-2 py-2.5 text-slate-400">{COUNTRY[p.ticker.toUpperCase()]||(p as any).country||"—"}</td>
                                      <td className="px-2 py-2.5 text-right text-slate-300">{p.qty.toLocaleString("pt-PT",{maximumFractionDigits:4})}</td>
                                      <td className="px-2 py-2.5 text-right text-slate-300">
                                        {p.value.toLocaleString("pt-PT",{minimumFractionDigits:2,maximumFractionDigits:2})} EUR
                                        {p.currency&&p.currency!=="EUR"&&<span className="text-slate-600 ml-1 text-[10px]">({p.currency})</span>}
                                      </td>
                                      <td className="px-2 py-2.5 text-right">
                                        <span className={`font-semibold ${pctOfPlan>5?"text-emerald-400":pctOfPlan>2?"text-blue-400":"text-slate-400"}`}>
                                          {pctOfPlan.toFixed(2)}%
                                        </span>
                                      </td>
                                      <td className={`px-4 py-2.5 text-right text-[11px] font-semibold ${devColor}`} title={planTarget>0?`Alvo no plano: ${planTarget.toFixed(1)}%`:"Não está no plano (posição órfã)"}>
                                        {desvioTxt}
                                        {planTarget===0&&p.ticker!=="MM Euro"&&<span className="ml-1 text-[9px] text-red-400/70">fora</span>}
                                      </td>
                                    </tr>
                                  );
                                });
                              })()}
                            </tbody>
                            <tfoot>
                              {(()=>{
                                const totalInvestedEur=cartIbPos.reduce((s,p)=>s+p.value,0);
                                const pctInvested=aum>0?(totalInvestedEur/aum*100):0;
                                // Sum of absolute deviations vs plan (same alias-aware map)
                                const planMap2=new Map<string,number>();
                                actionCounts.allRows.forEach(r=>{
                                  planMap2.set(r.ticker.toUpperCase(),r.cur);
                                  const ibAlias=toIbTicker(r.ticker);
                                  if(ibAlias!==r.ticker.toUpperCase()) planMap2.set(ibAlias,r.cur);
                                });
                                const sumAbsDesvio=cartIbPos.reduce((s,p)=>{
                                  const pct=aum>0?(p.value/aum*100):0;
                                  const tgt=planMap2.get(p.ticker.toUpperCase())??0;
                                  return s+Math.abs(pct-tgt);
                                },0);
                                // Also count plan tickers with 0 IB position (missing from portfolio)
                                // Use both plan ticker and IB alias when checking what's in the portfolio
                                const ibTickers=new Set(cartIbPos.map(p=>p.ticker.toUpperCase()));
                                const missingDesvio=actionCounts.allRows.reduce((s,r)=>{
                                  const ibAlias=toIbTicker(r.ticker);
                                  const inPortfolio=ibTickers.has(r.ticker.toUpperCase())||ibTickers.has(ibAlias);
                                  return r.cur>0&&!inPortfolio?s+r.cur:s;
                                },0);
                                const totalAbsDesvio=sumAbsDesvio+missingDesvio;
                                return(
                                  <>
                                    {/* ── Linha do plano (% sobre o AUM do utilizador) ── */}
                                    <tr className="border-t-2 border-[#252a3a] bg-[#0b0f1a]">
                                      <td colSpan={4} className="px-4 py-2.5 text-xs font-bold text-slate-300">
                                        Investido da carteira
                                        <span className="ml-1.5 text-[10px] font-normal text-slate-500">
                                          (plano {(aum/1000).toFixed(0)}k€)
                                        </span>
                                      </td>
                                      <td className="px-2 py-2.5 text-right text-xs text-slate-500">—</td>
                                      <td className="px-2 py-2.5 text-right text-xs font-bold text-emerald-400">
                                        {totalInvestedEur.toLocaleString("pt-PT",{minimumFractionDigits:2,maximumFractionDigits:2})} EUR
                                      </td>
                                      <td className="px-2 py-2.5 text-right text-xs font-bold text-emerald-400">
                                        {pctInvested.toFixed(1)}%
                                      </td>
                                      <td className="px-4 py-2.5 text-right text-xs font-semibold text-slate-400"
                                          title={`Soma dos desvios em módulo face ao plano\n(inclui posições em falta: ${missingDesvio.toFixed(1)}pp)`}>
                                        Σ|dev|: {totalAbsDesvio.toFixed(1)}pp
                                      </td>
                                    </tr>
                                    {/* ── Linha informativa do saldo total da conta paper ── */}
                                    {cartIbNav.value>0&&(
                                      <tr className="bg-[#080c14] opacity-60">
                                        <td colSpan={4} className="px-4 py-1.5 text-[11px] text-slate-500 italic">
                                          Saldo total conta paper IB
                                          <span className="ml-1.5 text-[10px] text-slate-600">(inclui caixa não investido — não é a carteira DECIDE)</span>
                                        </td>
                                        <td className="px-2 py-1.5 text-right text-[11px] text-slate-600">—</td>
                                        <td className="px-2 py-1.5 text-right text-[11px] text-slate-500">
                                          {cartIbNav.value.toLocaleString("pt-PT",{minimumFractionDigits:2,maximumFractionDigits:2})} {cartIbNav.ccy}
                                        </td>
                                        <td className="px-4 py-1.5 text-right text-[11px] text-slate-600" colSpan={2}>—</td>
                                      </tr>
                                    )}
                                  </>
                                );
                              })()}
                            </tfoot>
                          </table>
                        </div>
                      )}
                    </div>
                  )}

                  {/* ── TAB: Plano modelo ── */}
                  {cartTab==="plano"&&<div className="space-y-5">
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
                          {sectorData.filter(s=>s.value>=1).map((s,i)=>(
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
                          Montante plano (€)
                          <input type="number" value={aum} onChange={e=>setAum(Number(e.target.value)||100000)}
                            onBlur={e=>{const v=Number(e.target.value)||100000;logActivity({type:"configuração",label:`Montante do plano alterado para €${v.toLocaleString("pt-PT")}`,icon:"⚙",color:"text-amber-400"});}}
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
                        <th className="text-right pb-2">
                          <span title="Peso no plano do mês anterior">Mês ant.</span>
                        </th>
                        <th className="text-right pb-2">
                          <span title="Peso no plano deste mês">Este mês</span>
                        </th>
                        <th className="text-right pb-2">&#916;</th>
                        <th className="text-right pb-2">Preço</th>
                        <th className="text-right pb-2">Nº Acções</th>
                      </tr></thead>
                      <tbody>
                        {(()=>{
                          // ── use the same normalised source as Recomendações ──────────────
                          // actionCounts.allRows already has top-20 equity + XEON, normalised to 100%
                          type CartRow={ticker:string;cur:number;prev:number;action:string;special:boolean};
                          const equityRows:CartRow[]=actionCounts.allRows
                            .filter(r=>r.ticker!=="XEON")
                            .map(r=>({ticker:r.ticker,cur:r.cur,prev:r.prev,action:r.action,special:false}));
                          const xeonRow=actionCounts.allRows.find(r=>r.ticker==="XEON");
                          const xeonCur=xeonRow?.cur??0;
                          const xeonPrev=xeonRow?.prev??0;

                          // USD exposure for hedge row (from equity rows)
                          const usdExposure=equityRows.filter(r=>getZone(r.ticker)==="EUA").reduce((s,r)=>s+r.cur,0);

                          // Priced equity weight sum for share redistribution
                          const pricedWsum=equityRows.reduce((s,r)=>{
                            const p=prices[r.ticker];
                            return s+(p?.price?r.cur:0);
                          },0);
                          const equityTotal=equityRows.reduce((s,r)=>s+r.cur,0);

                          const allRows:CartRow[]=[
                            ...equityRows,
                            {ticker:"XEON",cur:xeonCur,prev:xeonPrev,action:xeonRow?.action??"Manter",special:true},
                            {ticker:"EURUSD",cur:usdExposure,prev:usdExposure,action:"Manter",special:true},
                          ];

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
                                      className="text-blue-400 hover:text-blue-300 hover:underline">{displayTicker(r.ticker)}</a>
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
                                  const effW=priceVal&&pricedWsum>0?(r.cur/pricedWsum)*equityTotal:r.cur;
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
                        {/* weight total footer – always 100% (same normalised source as Recomendações) */}
                        <tr className="border-t-2 border-slate-600 bg-slate-800/40">
                          <td colSpan={5} className="py-2 text-right text-slate-400 font-semibold text-xs pr-3">Total</td>
                          <td className="py-2 text-right font-bold text-emerald-400">100.0%</td>
                          <td colSpan={2} className="py-2 text-slate-600 text-xs pl-2">(normalizado)</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                  </div>}{/* end cartTab==="plano" */}
                </div>
              )}

              {/* ── PERFORMANCE ── */}
              {activePage==="perf"&&(
                <div className="space-y-5">
                  {/* ── KPI comparison: Modelo vs Benchmark ── */}
                  {perfData&&benchPerfData&&(()=>{
                    const fmtP=(v:number,s=false)=>`${s&&v>=0?"+":""}${v.toFixed(2)}%`;
                    const cols=[
                      {label:"Retorno ("+period+")",
                       m:perfData.m.ret, b:benchPerfData.ret,
                       mFmt:fmtP(perfData.m.ret,true), bFmt:fmtP(benchPerfData.ret,true),
                       delta:perfData.m.ret-benchPerfData.ret, isVol:false},
                      {label:"CAGR",
                       m:perfData.m.ann, b:benchPerfData.ann,
                       mFmt:fmtP(perfData.m.ann,true), bFmt:fmtP(benchPerfData.ann,true),
                       delta:perfData.m.ann-benchPerfData.ann, isVol:false},
                      {label:"Sharpe",
                       m:perfData.m.shp, b:benchPerfData.shp,
                       mFmt:perfData.m.shp.toFixed(2), bFmt:benchPerfData.shp.toFixed(2),
                       delta:perfData.m.shp-benchPerfData.shp, isVol:false, isDelta:true},
                      {label:"Volatilidade anual",
                       m:benchPerfData.mVol, b:benchPerfData.vol,
                       mFmt:`${benchPerfData.mVol.toFixed(1)}%`, bFmt:`${benchPerfData.vol.toFixed(1)}%`,
                       delta:benchPerfData.mVol-benchPerfData.vol, isVol:true},
                    ];
                    return(
                      <div className="bg-[#0b0f1a] border border-[#1a1f2e] rounded-xl overflow-hidden">
                        {/* Header */}
                        <div className="grid grid-cols-4 border-b border-[#1a1f2e]">
                          <div className="px-4 py-2.5 text-[10px] font-semibold text-slate-600 uppercase tracking-wider">Métrica</div>
                          <div className="px-4 py-2.5 text-[10px] font-semibold text-blue-500 uppercase tracking-wider flex items-center gap-1.5"><div className="w-2.5 h-2.5 rounded-full bg-blue-500"/>Modelo</div>
                          <div className="px-4 py-2.5 text-[10px] font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1.5"><div className="w-2.5 h-2.5 rounded-full bg-slate-500"/>{BENCH_SHORT}</div>
                          <div className="px-4 py-2.5 text-[10px] font-semibold text-slate-600 uppercase tracking-wider">Alpha</div>
                        </div>
                        {cols.map(col=>{
                          const dPos=col.isVol?col.delta<=0:col.delta>=0;
                          const dFmt=col.isVol
                            ?`${col.delta>=0?"+":""}${col.delta.toFixed(1)}pp vol`
                            :col.label==="Sharpe"
                              ?`${col.delta>=0?"+":""}${col.delta.toFixed(2)}`
                              :`${col.delta>=0?"+":""}${col.delta.toFixed(2)}pp`;
                          return(
                            <div key={col.label} className="grid grid-cols-4 border-b border-[#0f172a] hover:bg-white/[0.015]">
                              <div className="px-4 py-3 text-[11px] text-slate-400 font-medium">{col.label}</div>
                              <div className={`px-4 py-3 text-[14px] font-black ${col.m>=0?"text-emerald-400":"text-red-400"}`}>{col.mFmt}</div>
                              <div className="px-4 py-3 text-[14px] font-bold text-slate-300">{col.bFmt}</div>
                              <div className={`px-4 py-3 text-[12px] font-bold ${dPos?"text-emerald-400":"text-red-400"}`}>{dFmt}</div>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })()}

                  {/* ── Monthly stats + Turnover ── */}
                  {(()=>{
                    const ms=monthlyStats;
                    const ts=turnoverStats;
                    if(!ms&&!ts) return null;
                    return(
                      <div className="grid grid-cols-4 gap-4">
                        {ms&&<>
                          <div className="bg-[#0b0f1a] border border-[#1a1f2e] rounded-xl p-4">
                            <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-2">Meses acima do bench</div>
                            <div className="text-2xl font-black text-emerald-400">{ms.aboveBench}<span className="text-base font-semibold text-slate-400"> / {ms.n}</span></div>
                            <div className="text-[11px] text-slate-400 mt-1">{ms.n?((ms.aboveBench/ms.n)*100).toFixed(0):0}% dos meses</div>
                          </div>
                          <div className="bg-[#0b0f1a] border border-[#1a1f2e] rounded-xl p-4">
                            <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-2">Meses positivos</div>
                            <div className="text-2xl font-black text-blue-400">{ms.positive}<span className="text-base font-semibold text-slate-400"> / {ms.n}</span></div>
                            <div className="text-[11px] text-slate-400 mt-1">{ms.n?((ms.positive/ms.n)*100).toFixed(0):0}% · {ms.negative} negativos</div>
                          </div>
                        </>}
                        {ts&&<>
                          <div className="bg-[#0b0f1a] border border-[#1a1f2e] rounded-xl p-4">
                            <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-2">Turnover médio</div>
                            <div className="text-2xl font-black text-amber-400">{ts.avg.toFixed(1)}<span className="text-sm font-semibold text-slate-500">%</span></div>
                            <div className="text-[11px] text-slate-400 mt-1">por rebalanceamento</div>
                          </div>
                          {(()=>{const cy=calYearsFromDates(dates)??dates.length/252;const ann=cy>0?ts.total/cy:ts.total;return(
                          <div className="bg-[#0b0f1a] border border-[#1a1f2e] rounded-xl p-4">
                            <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-2">Turnover anual</div>
                            <div className="text-2xl font-black text-amber-300">{ann.toFixed(0)}<span className="text-sm font-semibold text-slate-500">%</span></div>
                            <div className="text-[11px] text-slate-400 mt-1">por ano · {ts.n} rebalanceamentos</div>
                          </div>);})()}
                        </>}
                      </div>
                    );
                  })()}
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
                        <XAxis dataKey="date" tick={{fontSize:10,fill:"#64748b"}} tickLine={false} axisLine={false} interval={Math.floor((perfData?.chart.length??1)/6)}
                          tickFormatter={(d:string)=>{const dt=new Date(d);return `${dt.toLocaleString("pt-PT",{month:"short"})} ${String(dt.getFullYear()).slice(2)}`;}}/>
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
                const vol=benchPerfData?.mVol??perfData?.curVol??0;
                const dd=perfData?.curDD??0;
                // Sharpe from inception (s=0, calYears)
                const sharpe20=perfData?.inception?.shp??riskMetrics?.beta??0;
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
                          <div className="text-[10px] text-slate-500 mt-1">Alvo: {profileFactor<1?"~14,6%":profileFactor>1?"~24,3%":"~19,4%"} ({profileFactor<1?"0,75×":profileFactor>1?"1,25×":"1×"} vol bench)</div>
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
              {activePage==="historico"&&<HistoricoPage sortedMonths={sortedMonths} dates={dates} equityRaw={equityRaw} benchRaw={benchRaw} marginEnabled={marginEnabled} profileFactor={profileFactor}/>}
              {activePage==="custos"&&<CustosPage aum={aum}/>}

              {/* ── TESTES DE ROBUSTEZ ── */}
              {activePage==="robustez"&&<RobustezPage/>}

              {/* ── AJUDA ── */}
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
                  latestMonth={latestMonth}
                  recoLabel={recoLabel}
                  aum={aum}
                  loggedIn={loggedIn}
                  onBack={()=>setActivePage("reco")}
                  onShowRegister={()=>setShowRegModal(true)}
                  profileLabel={profileLabel}
                  fxExposure={fxExposure}
                  marginEnabled={marginEnabled}
                  prices={prices}
                />
              )}

            </div>
          </main>
        </div>
      </div>
    </>
  );
}


