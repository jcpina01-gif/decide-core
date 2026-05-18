import Head from "next/head";
import { useRouter } from "next/router";
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ComposableMap, Geographies, Geography, Marker, ZoomableGroup } from "react-simple-maps";
import { displayTicker } from "../lib/tickerDisplay";
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, ReferenceLine, ReferenceArea,
  BarChart, Bar, CartesianGrid,
  AreaChart, Area,
} from "recharts";
import {
  LayoutDashboard, BookOpen, Briefcase, TrendingUp, TrendingDown,
  ShieldCheck, Clock, Settings, LogOut, ChevronDown, Info,
  ArrowUpRight, ArrowDownRight, Minus, X, Eye, EyeOff,
  Globe, Activity, HelpCircle, Mail, Phone, MapPin, Send,
  CheckCircle2, Receipt, Bell, Sliders, AlertTriangle, Trash2, Menu,
} from "lucide-react";
import {
  isClientLoggedIn, getCurrentSessionUser,
  registerClientUser, loginClientUser,
  normalizeClientPhone, pushCurrentSessionPrefs,
  setSignupEmailVerifiedFromServerEmail,
  setSignupPhoneVerifiedFromServerPhone,
  isSignupEmailVerifiedForInput,
  isSignupPhoneVerifiedForInput,
  fetchSignupEmailVerifiedFromServer,
  deriveClientUsernameFromEmail,
} from "../lib/clientAuth";
import { useSyncedRiskProfileFromOnboarding } from "../hooks/useSyncedRiskProfileFromOnboarding";
import { KPI_IFRAME_SRC_REV } from "../lib/kpiFlaskBuildGate";
import { DecideBrandImage, HEADER_TOOLBAR_MIN_HEIGHT_PX } from "../components/DecideLogoHeader";

/* ─── native simulator ──────────────────────────────────────── */
const PRAZO_OPTS=[1,3,5,10,15,20] as const; // v2
function NativeSimulator({dates,equity,bench,onRegister,loggedIn,volScale=1,profileKey=""}:{
  dates:string[];equity:number[];bench:number[];onRegister:()=>void;loggedIn:boolean;
  /** Pre-computed vol-rule scale (profile+margin). When this changes, useMemos recompute. */
  volScale?:number;
  /** Opaque string that changes with profile+margin mode. Forces slice recompute. */
  profileKey?:string;
}) {
  const [capital,setCapital]=React.useState(10000);
  const [capInput,setCapInput]=React.useState("10000");
  const [prazo,setPrazo]=React.useState(20); // anos de horizonte

  // Slice de dados para o prazo seleccionado (com skipWarmup)
  // profileKey is in deps so that switching profile always invalidates the slice
  // even when equity has the same array reference (e.g. factor===1 returns equityRaw as-is).
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[equity,bench,dates,prazo,profileKey]);

  // Apply volScale: scale each period's return by the vol-rule factor.
  // volScale comes from the parent: volRuleScale for base mode, 1 for margin mode.
  // Using a primitive number ensures React always detects profile changes.
  const scaledEq=React.useMemo(()=>{
    if(slice.eq.length<2) return slice.eq;
    if(volScale===1) return slice.eq;
    const out:number[]=new Array(slice.eq.length);
    out[0]=slice.eq[0]||1;
    for(let i=1;i<slice.eq.length;i++){
      const prev=slice.eq[i-1]!;
      if(!prev||!isFinite(prev)){out[i]=out[i-1]!;continue;}
      const r=(slice.eq[i]!-prev)/prev;
      const next=out[i-1]!*(1+r*volScale);
      out[i]=isFinite(next)&&next>0?next:out[i-1]!;
    }
    return out;
  },[slice.eq,volScale]);

  // Actual years spanned by the data slice (calendar, not user-selected prazo).
  // Using real calendar years makes CAGR accurate when the slice is shorter than prazo
  // (e.g. warmup skip or data starts after the cut date).
  const actualYears=React.useMemo(()=>{
    if(slice.dts.length<2) return prazo;
    const ms=new Date(slice.dts[slice.dts.length-1]).getTime()-new Date(slice.dts[0]).getTime();
    const y=ms/(365.25*24*3600*1000);
    return y>0.5?y:prazo;
  },[slice.dts,prazo]);

  // CAGR da série base (sem escalagem) — retorno histórico real do modelo
  const cagrBase=React.useMemo(()=>
    slice.eq.length>1?cagrFn(slice.eq[0],slice.eq[slice.eq.length-1],actualYears)*100:0
  ,[slice.eq,actualYears]);

  // CAGR da série escalada (com perfil/margem aplicados)
  const cagrSim=React.useMemo(()=>
    scaledEq.length>1?cagrFn(scaledEq[0],scaledEq[scaledEq.length-1],actualYears)*100:0
  ,[scaledEq,actualYears]);

  const isScaled=Math.abs(volScale-1)>0.01;
  const cagrLabel=isScaled?"CAGR simulado":"CAGR hist\u00f3rico";
  const cagrVal=isScaled?cagrSim:cagrBase;

  const simData=React.useMemo(()=>{
    if(!scaledEq.length||!slice.dts.length) return [];
    const step=Math.max(1,Math.floor(scaledEq.length/300));
    const base=scaledEq[0]||1;
    const bbase=slice.bch[0]||1;
    return slice.dts.filter((_,i)=>i%step===0).map((d,i)=>({
      date:d.slice(0,10),
      modelo:Math.round((scaledEq[i*step]/base)*capital),
      bench: Math.round((slice.bch[i*step]/bbase)*capital),
    }));
  },[scaledEq,slice.dts,slice.bch,capital]);

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
            {l:cagrLabel,v:`+${cagrVal.toFixed(1)}%/ano`,c:"text-blue-400",
             sub:isScaled?`base: +${cagrBase.toFixed(1)}%/ano`:undefined},
            {l:`vs ${BENCH_SHORT}`,v:fmt(benchFinal),c:"text-slate-400"},
          ].map(({l,v,c,sub})=>(
            <div key={l}>
              <div className="text-slate-500 text-[10px] uppercase tracking-wide mb-0.5">{l}</div>
              <div className={`text-lg font-black ${c}`}>{v}</div>
              {sub&&<div className="text-slate-600 text-[9px] mt-0.5">{sub}</div>}
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
  "246":"Finlândia","208":"Dinamarca","578":"Noruega",
  "392":"Japão","076":"Brasil","250":"França",
  "752":"Suécia","442":"Luxemburgo","372":"Irlanda","040":"Áustria",
  "620":"Portugal",
};
const COUNTRY_TO_ISO:Record<string,string>={};
Object.entries(ISO_TO_COUNTRY).forEach(([iso,c])=>{COUNTRY_TO_ISO[c]=iso;});
// Countries that have at least one ticker in the database (for map colouring)
// Only include countries that are also in ISO_TO_COUNTRY (have a map entry) to avoid
// highlighting countries we don't want shown (e.g. China, Australia ADRs).
const _mappedCountries=new Set(Object.values(ISO_TO_COUNTRY));
const DB_COUNTRIES:Set<string>=new Set(Object.values(COUNTRY).filter(c=>_mappedCountries.has(c)));

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

const VALID_PAGE_IDS: Page[]=["dashboard","reco","carteira","perf","risco","historico","custos",
  "robustez","ajuda","contactos","simulador","relatorios","ordens","actividade"];
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
const RISK_FREE_ANNUAL = 0.02; // EUR risk-free rate (approx. long-run ECB/ESTR)
function sharpe(r: number[]) {
  const v = annualVol(r)/Math.sqrt(252);
  if(!v) return 0;
  const rfDaily = RISK_FREE_ANNUAL/252;
  return (r.reduce((a,b)=>a+b,0)/r.length - rfDaily)/v*Math.sqrt(252);
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
type Period="YTD"|"1 Ano"|"3 Anos"|"5 Anos"|"20 Anos";
const PERIODS:Period[]=["YTD","1 Ano","3 Anos","5 Anos","20 Anos"];

function periodStart(dates:string[], period:Period) {
  if(period==="20 Anos") return 0;
  const last=new Date(dates[dates.length-1]);
  const yrs=period==="YTD"?0:period==="1 Ano"?1:period==="3 Anos"?3:5;
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
function periodMetrics(eq:number[], bench:number[], period:Period, calYearsOverride?:number, seriesEndYear?:number) {
  // For YTD: use fraction of the series end year elapsed, not the client's current month
  const ytdFraction = eq.length > 1
    ? Math.max(1/252, Math.min(1, (eq.length) / 252))
    : (seriesEndYear ? (new Date(`${seriesEndYear}-12-31`).getMonth()+1)/12 : (new Date().getMonth()+1)/12);
  const y=calYearsOverride!==undefined?calYearsOverride
    :period==="YTD"?ytdFraction
    :period==="1 Ano"?1:period==="3 Anos"?3:period==="5 Anos"?5
    :eq.length/252;
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
type FlowRowDash={ticker:string;company?:string;weightPct?:number;prevWeightPct?:number;deltaWeightPct?:number;kind?:"new"|"increase"|"decrease"|"remove"|"cash_synthetic"};
type RecoMonth={date?:string;rebalance_date?:string;rows:WRow[];tbillsTotalPct?:number;entries?:FlowRowDash[];exits?:FlowRowDash[]};

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
function Sidebar({user,profile,loggedIn,onRegister,activePage,onNavigate,open,onClose}:{
  user:string|null;profile:string;loggedIn:boolean;onRegister:()=>void;
  activePage:Page;onNavigate:(p:Page)=>void;open:boolean;onClose:()=>void;
}) {
  const router=useRouter();
  const initials=(user??"JC").slice(0,2).toUpperCase();
  const profilePt=profile==="conservador"?"Conservador":profile==="dinamico"?"Dinâmico":"Moderado";
  return (
    <>
      {/* Mobile backdrop */}
      {open&&<div className="fixed inset-0 bg-black/60 z-40 lg:hidden" onClick={onClose}/>}

      <aside className={[
        /* Desktop: 2ª linha da grelha — nav fica sempre visível ao scroll do main */
        "decide-dashboard-sidebar flex min-h-0 min-w-0 w-64 shrink-0 flex-col bg-[#07090f] border-r border-[#1a1f2e] z-50",
        "fixed inset-y-0 left-0 h-full max-h-full transition-transform duration-200 ease-in-out lg:relative lg:inset-auto lg:translate-x-0 lg:row-start-2 lg:col-start-1 lg:col-end-2 lg:h-full lg:w-full lg:max-w-none lg:max-h-full lg:min-h-0 lg:overflow-hidden lg:self-stretch",
        open?"translate-x-0":"-translate-x-full lg:translate-x-0",
      ].join(" ")}>
        {/* Logo só no drawer telemóvel; no desktop o logo está na célula da grelha alinhada ao <header> */}
        <div
          className="flex shrink-0 items-stretch justify-between gap-2 border-b border-[#1a1f2e] pr-2 lg:hidden"
          style={{ height: HEADER_TOOLBAR_MIN_HEIGHT_PX, minHeight: HEADER_TOOLBAR_MIN_HEIGHT_PX }}>
          <div
            className="decide-sidebar-logo-slot flex min-h-0 flex-1 items-center self-stretch overflow-visible pl-3 py-0"
            style={{ minHeight: HEADER_TOOLBAR_MIN_HEIGHT_PX, maxWidth: "100%", boxSizing: "border-box" }}>
            <DecideBrandImage
              priority
              height={HEADER_TOOLBAR_MIN_HEIGHT_PX}
              maxWidth="100%"
              sizes="256px"
              className="decide-header-brand-mark decide-logo-img--plain decide-logo-img--header-lockup"
              knockoutBackground={false}
              style={{ objectFit: "contain", objectPosition: "left center" }}
            />
          </div>
          <button onClick={onClose} className="flex shrink-0 items-center justify-center self-stretch px-3 min-w-[44px] text-slate-500 hover:text-slate-300" aria-label="Fechar menu">
            <X size={18}/>
          </button>
        </div>
        <nav className="decide-dashboard-sidebar-nav min-h-0 flex-1 space-y-1 px-2.5 py-3 max-lg:overflow-y-auto max-lg:overscroll-contain max-lg:min-h-0 lg:flex-none lg:overflow-hidden lg:overscroll-auto lg:space-y-0.5 lg:px-2 lg:py-2 lg:pb-3">
          {NAV.map(({id,label,Icon})=>(
            <button key={id} onClick={()=>{onNavigate(id as Page);onClose();}}
              className={["group w-full flex items-center gap-3 rounded-xl px-3 py-2.5 text-[13px] font-semibold leading-snug tracking-tight transition-colors min-h-[44px] border lg:min-h-[36px] lg:gap-2 lg:px-2.5 lg:py-1.5 lg:text-[11px]",
                activePage===id
                  ? "border-teal-500/35 bg-teal-500/[0.08] text-teal-300 shadow-[inset_3px_0_0_0_rgba(45,212,191,0.75)]"
                  : "border-transparent text-slate-400 hover:border-[#1f2937] hover:bg-white/[0.05] hover:text-slate-100 active:bg-white/[0.07]"].join(" ")}>
              <Icon className={`shrink-0 w-[18px] h-[18px] lg:w-[15px] lg:h-[15px] ${activePage===id?"text-teal-400":"text-slate-500 group-hover:text-slate-300"}`} strokeWidth={activePage===id?2.25:2}/>
              <span className="text-left">{label}</span>
            </button>
          ))}
        </nav>
        <div className="px-3 py-4 lg:mt-auto lg:py-2.5 border-t border-[#1a1f2e] space-y-1 lg:space-y-0 shrink-0">
          {loggedIn ? (
            <>
              <div className="flex items-center gap-3 px-3 py-2 lg:py-1.5">
                <div className="w-9 h-9 lg:w-8 lg:h-8 rounded-full bg-blue-600 flex items-center justify-center text-white font-bold text-xs shrink-0">{initials}</div>
                <div className="min-w-0">
                  <div className="text-slate-200 text-xs font-semibold truncate">{user??"Utilizador"}</div>
                  <div className="text-slate-400 text-[10px]">Perfil: {profilePt}</div>
                </div>
              </div>
              <button onClick={()=>void router.push("/client/logout")}
                className="w-full flex items-center gap-3 px-3 py-2.5 lg:py-2 text-slate-500 hover:text-slate-300 text-xs rounded-lg hover:bg-white/5 transition-colors min-h-[44px] lg:min-h-0">
                <LogOut size={14}/>Sair
              </button>
            </>
          ) : (
            <button onClick={()=>{onRegister();onClose();}}
              className="w-full flex items-center gap-3 px-3 py-2.5 lg:py-2 text-slate-400 hover:text-slate-200 text-xs rounded-lg hover:bg-white/5 transition-colors min-h-[44px] lg:min-h-0">
              <LogOut size={14}/>Entrar / Criar conta
            </button>
          )}
        </div>
      </aside>
    </>
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
// Premium: AUM €5k–€50k  → €29/mês fixo (sem performance fee)
// Private: AUM >€50k     → 0,6% aa gestão (sem performance fee)
const DECIDE_MONTHLY_PREMIUM=29;          // €/mês
const DECIDE_MGMT_PCT_PRIVATE=0.60;       // % aa
const DECIDE_PERF_PCT_PRIVATE=0;          // sem performance fee
const MARKET_AVG_PCT=0.62;
const ACTIVE_FUND_PCT=2.0;

// Outros custos operacionais (comuns a todos os segmentos)
const BASE_COST_ROWS=[
  {cat:"Custódia",   color:"#22c55e",desc:"Interactive Brokers",  modelo:"Tiered",         pct:0.06},
  {cat:"Transações", color:"#f59e0b",desc:"Comissões negociação", modelo:"Por operação",   pct:0.04},
  {cat:"Câmbio",     color:"#a78bfa",desc:"Conversão de moeda",   modelo:"Spread cambial", pct:0.01},
  {cat:"Outros",     color:"#64748b",desc:"Taxas regulatórias",   modelo:"Fixas",          pct:0.01},
];




function CustosPage({aum,planOverride}:{aum:number;planOverride?:"premium"|"private"}) {
  const [faqOpen,setFaqOpen]=useState<number|null>(null);

  const aumEur=Math.max(aum,5000);
  const ytdMonths=new Date().getMonth()+1;
  const isPrivate=planOverride==="private"?true:planOverride==="premium"?false:aumEur>=50000;
  const MGMT_PCT_AA=0.60;
  const PERF_RATE=0;    // sem performance fee
  const HIST_CAGR=0.08; // conservative 8% gross
  const MARKET_ETF=0.62;
  const ACTIVE_FUND=2.00;
  const EXTERN_PCT=0.12; // custody+transactions+fx+other
  const EX_CAP=Math.max(aumEur,25000); const YRS=10;

  // Premium: fixed €29/month
  const premiumAnnual=29*12;
  const premiumPct=premiumAnnual/aumEur*100;
  const premiumYtd=29*ytdMonths;
  // Private: 0.6%/year + performance fee
  const privateAnnual=aumEur*(MGMT_PCT_AA/100);
  const privatePct=MGMT_PCT_AA;
  const privateYtd=privateAnnual*ytdMonths/12;
  const perfAnnualEst=aumEur*HIST_CAGR*PERF_RATE;
  const perfYtdEst=perfAnnualEst*ytdMonths/12;

  const mgmtPct=isPrivate?privatePct:premiumPct;
  const mgmtYtd=isPrivate?privateYtd:premiumYtd;
  const externYtd=aumEur*(EXTERN_PCT/100)*ytdMonths/12;
  const totalFixedPct=mgmtPct+EXTERN_PCT;
  const totalYtd=mgmtYtd+externYtd;

  // Long-term projection
  const dNet=HIST_CAGR-totalFixedPct/100;
  const aNet=HIST_CAGR-ACTIVE_FUND/100;
  const dVal=Math.round(EX_CAP*Math.pow(1+dNet,YRS));
  const mVal=Math.round(EX_CAP*Math.pow(1+aNet,YRS));
  const projDiff=dVal-mVal;

  const growthChart=useMemo(()=>Array.from({length:YRS+1},(_,i)=>({
    year:i===0?"Hoje":`Ano ${i}`,
    decide:Math.round(EX_CAP*Math.pow(1+dNet,i)),
    market:Math.round(EX_CAP*Math.pow(1+aNet,i)),
  })),[dNet,aNet,EX_CAP]);

  const fmt=(n:number)=>n.toLocaleString("pt-PT",{minimumFractionDigits:2,maximumFractionDigits:2});
  const fmtInt=(n:number)=>Math.round(n).toLocaleString("pt-PT");

  const FAQS_PREMIUM=[
    {q:"O que está incluído nos €29/mês?",
     a:"Recomendações mensais, dashboard completo, monitorização da carteira, histórico de decisões e suporte por email. O modelo quantitativo gera o plano — você decide se executa."},
    {q:"Existem custos além dos €29/mês?",
     a:"Sim. Existem custos externos ao DECIDE: custódia (~0,06%), transações (~0,04%), câmbio (~0,01%) e taxas regulatórias (~0,01%). Estes são cobrados pelo broker (Interactive Brokers), não pelo DECIDE."},
    {q:"Posso cancelar quando quiser?",
     a:"Sim. O plano Premium pode ser cancelado a qualquer momento sem penalização. Não há contratos de permanência."},
    {q:"Quando é cobrada a mensalidade?",
     a:"A mensalidade é cobrada no início de cada mês. O primeiro pagamento é feito na activação do serviço."},
  ];
  const FAQS_PRIVATE=[
    {q:"O que está incluído no plano Private?",
     a:"Tudo o que o plano Premium inclui, mais: hedge cambial configurável, relatório de risco avançado e acompanhamento personalizado. Orientado a carteiras a partir de €50 000."},
    {q:"Custos DECIDE vs custos externos — qual a diferença?",
     a:"O custo DECIDE (0,6% aa) é a comissão pelo serviço de gestão quantitativa. Os custos externos (custódia, transações, câmbio) são cobrados pelo broker (Interactive Brokers) e não beneficiam o DECIDE."},
    {q:"Quando é cobrada a taxa de gestão?",
     a:"A taxa de gestão é de 0,05% por mês (0,6% ao ano), cobrada sobre o valor real da carteira no início de cada mês. Se a carteira vale €60 000 em Janeiro, paga €30 nesse mês. Se em Fevereiro vale €62 000, paga €31. O custo acompanha o valor da carteira — sobe quando ganha, desce quando perde."},
    {q:"Existe performance fee no plano Private?",
     a:"Não. O plano Private tem apenas a taxa de gestão de 0,6% ao ano, sem qualquer performance fee. Custo simples, previsível e alinhado com o seu interesse."},
  ];
  const FAQS=isPrivate?FAQS_PRIVATE:FAQS_PREMIUM;

  const EXTERN_ROWS=[
    {label:"Custódia e clearing",pct:0.06,nota:"Interactive Brokers"},
    {label:"Comissões de negociação",pct:0.04,nota:"por operação"},
    {label:"Conversão cambial (FX)",pct:0.01,nota:"spread cambial"},
    {label:"Taxas regulatórias",pct:0.01,nota:"fixas"},
  ];

  return (
    <div className="space-y-5 pb-8">

      {/* ── MASTHEAD: diferente para Premium vs Private ── */}
      {!isPrivate?(
        /* ── PREMIUM MASTHEAD ── */
        <div className="bg-gradient-to-br from-[#0a1628] to-[#0b0f1a] border border-[#1a2540] rounded-2xl p-4 sm:p-7">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
            <div>
              <div className="text-[10px] uppercase tracking-widest text-slate-600 mb-2">Plano PREMIUM · DECIDE</div>
              <div className="text-slate-100 font-black text-3xl tracking-tight mb-2">
                €29<span className="text-slate-400 font-normal text-xl"> / mês</span>
              </div>
              <div className="text-slate-400 text-sm max-w-sm leading-relaxed">
                Investimento disciplinado com custo simples, fixo e totalmente transparente.
                Sem performance fee. Sem comissões escondidas.
              </div>
            </div>
            <div className="sm:text-right space-y-2 shrink-0">
              <div className="bg-teal-500/10 border border-teal-500/20 rounded-xl px-4 py-3">
                <div className="text-[10px] text-slate-500 mb-0.5">O seu custo anual estimado</div>
                <div className="text-xl font-black text-teal-400">€ {fmtInt(premiumAnnual + aumEur*EXTERN_PCT/100)}</div>
                <div className="text-[10px] text-slate-500 mt-0.5">({totalFixedPct.toFixed(2)}% do patrimônio)</div>
              </div>
            </div>
          </div>
          {/* 3 KPI — sempre lista (1 coluna) */}
          <div className="grid grid-cols-1 gap-2 mt-6 pt-5 border-t border-white/[0.05]">
            {[
              {label:"Gestão DECIDE",val:"€29 / mês",sub:"custo fixo, previsível",note:"sem performance fee"},
              {label:"Custos externos (broker)",val:`${EXTERN_PCT.toFixed(2)}% / ano`,sub:`≈ €${fmtInt(aumEur*EXTERN_PCT/100)} / ano`,note:"custódia + transações + FX"},
              {label:"Custo total estimado",val:`${totalFixedPct.toFixed(2)}% / ano`,sub:`€${fmtInt(premiumAnnual+aumEur*EXTERN_PCT/100)} anuais`,note:`a preços actuais do portfólio`},
            ].map(k=>(
              <div key={k.label} className="bg-white/[0.03] border border-white/[0.05] rounded-xl px-2 py-2.5 sm:px-4 sm:py-3 min-w-0">
                <div className="text-[9px] sm:text-[10px] text-slate-600 mb-1 sm:mb-2 leading-tight">{k.label}</div>
                <div className="text-sm sm:text-lg font-black text-slate-100 leading-tight break-words">{k.val}</div>
                <div className="text-[9px] sm:text-[10px] text-slate-500 mt-1 leading-tight">{k.sub}</div>
                <div className="text-[8px] sm:text-[10px] text-slate-600 mt-0.5 italic leading-tight">{k.note}</div>
              </div>
            ))}
          </div>
        </div>
      ):(
        /* ── PRIVATE MASTHEAD ── */
        <div className="bg-gradient-to-br from-[#100d04] via-[#0b0f1a] to-[#0b0f1a] border border-amber-900/30 rounded-2xl p-4 sm:p-7">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
            <div>
              <div className="text-[10px] uppercase tracking-widest text-amber-700 mb-2">Plano PRIVATE · DECIDE</div>
              <div className="text-slate-100 font-black text-3xl tracking-tight mb-2">
                0,6%<span className="text-slate-400 font-normal text-xl"> / ano</span>
              </div>
              <div className="text-slate-400 text-sm max-w-md leading-relaxed">
                Gestão quantitativa assistida com custo simples e transparente.
                Sem performance fee. Cobrado mensalmente: 0,05% sobre o valor real da carteira em cada mês.
              </div>
            </div>
            <div className="sm:text-right space-y-2 shrink-0">
              <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl px-4 py-3">
                <div className="text-[10px] text-slate-500 mb-0.5">Custo de gestão anual estimado</div>
                <div className="text-xl font-black text-amber-400">€ {fmtInt(privateAnnual)}</div>
                <div className="text-[10px] text-slate-500 mt-0.5">(0,6% · sem performance fee)</div>
              </div>
            </div>
          </div>
          {/* 3 KPI — sempre lista (1 coluna) */}
          <div className="grid grid-cols-1 gap-2 mt-6 pt-5 border-t border-white/[0.05]">
              {label:"Performance fee",val:"Não aplicável",sub:"sem performance fee",note:"custo simples e previsível"},
              {label:"Custos externos (broker)",val:`${EXTERN_PCT.toFixed(2)}% / ano`,sub:`≈ €${fmtInt(aumEur*EXTERN_PCT/100)} anuais`,note:"custódia + transações + FX"},
            ].map(k=>(
              <div key={k.label} className="bg-white/[0.03] border border-white/[0.05] rounded-xl px-2 py-2.5 sm:px-4 sm:py-3 min-w-0">
                <div className="text-[9px] sm:text-[10px] text-slate-600 mb-1 sm:mb-2 leading-tight">{k.label}</div>
                <div className="text-sm sm:text-lg font-black text-slate-100 leading-tight break-words">{k.val}</div>
                <div className="text-[9px] sm:text-[10px] text-slate-500 mt-1 leading-tight">{k.sub}</div>
                <div className="text-[8px] sm:text-[10px] text-slate-600 mt-0.5 italic leading-tight">{k.note}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Custos separados: DECIDE vs Externos — sempre lista (1 coluna) ── */}
      <div className="grid grid-cols-1 gap-2 lg:gap-4">
        {/* Custos DECIDE */}
        <div className="bg-[#0b0f1a] border border-[#1a1f2e] rounded-xl p-3 sm:p-5 min-w-0">
          <div className="text-[10px] uppercase tracking-widest text-slate-600 mb-4">Custos DECIDE</div>
          {!isPrivate?(
            <div className="space-y-3">
              <div className="flex items-center justify-between py-3 border-b border-[#111827]">
                <div>
                  <div className="text-slate-200 text-sm font-bold">Mensalidade fixa</div>
                  <div className="text-slate-500 text-xs mt-0.5">Serviço de gestão quantitativa</div>
                </div>
                <div className="text-right">
                  <div className="text-slate-100 font-black text-lg">€29 / mês</div>
                  <div className="text-slate-600 text-[10px]">= €348 / ano</div>
                </div>
              </div>
              <div className="flex items-center justify-between py-2">
                <div className="text-slate-500 text-xs">Performance fee</div>
                <div className="text-slate-600 text-xs font-semibold">Não aplicável</div>
              </div>
              <div className="bg-teal-900/15 border border-teal-700/20 rounded-lg px-4 py-3 mt-2">
                <div className="text-[10px] text-teal-400 font-semibold">Custo DECIDE anual fixo: €348</div>
                <div className="text-[10px] text-slate-500 mt-0.5">Independentemente da performance da carteira.</div>
              </div>
            </div>
          ):(
            <div className="space-y-3">
              <div className="flex items-center justify-between py-3 border-b border-[#111827]">
                <div>
                  <div className="text-slate-200 text-sm font-bold">Taxa de gestão</div>
                  <div className="text-slate-500 text-xs mt-0.5">0,05%/mês sobre o valor real da carteira em cada mês</div>
                </div>
                <div className="text-right">
                  <div className="text-slate-100 font-black text-lg">0,6% / ano</div>
                  <div className="text-slate-600 text-[10px]">≈ €{fmtInt(privateAnnual)} / ano</div>
                </div>
              </div>
              <div className="flex items-center justify-between py-2">
                <div className="text-slate-500 text-xs">Performance fee</div>
                <div className="text-slate-600 text-xs font-semibold">Não aplicável</div>
              </div>
              <div className="bg-amber-900/10 border border-amber-700/20 rounded-lg px-4 py-3 mt-1">
                <div className="text-[10px] text-amber-400 font-semibold">Custo DECIDE: 0,05% por mês sobre o valor da carteira</div>
                <div className="text-[10px] text-slate-500 mt-0.5">Cobrado mensalmente sobre o valor real da carteira nesse mês — sem performance fee, sem valor fixo.</div>
              </div>
            </div>
          )}
        </div>

        {/* Custos externos */}
        <div className="bg-[#0b0f1a] border border-[#1a1f2e] rounded-xl p-3 sm:p-5 min-w-0">
          <div className="text-[10px] uppercase tracking-widest text-slate-600 mb-3 sm:mb-4">Custos externos (IB)</div>
          <div className="text-[10px] sm:text-[11px] text-slate-500 mb-3 sm:mb-4 leading-relaxed">
            Estes custos são cobrados directamente pelo broker e <span className="text-slate-400 font-semibold">não beneficiam o DECIDE</span>. São estimativas baseadas na actividade típica de carteiras com o seu perfil.
          </div>
          <div className="space-y-0">
            {EXTERN_ROWS.map((r,i)=>(
              <div key={r.label} className={`flex items-center justify-between px-0 py-3 ${i<EXTERN_ROWS.length-1?"border-b border-[#111827]":""}`}>
                <div>
                  <div className="text-slate-300 text-xs font-medium">{r.label}</div>
                  <div className="text-slate-600 text-[10px]">{r.nota}</div>
                </div>
                <div className="text-right">
                  <div className="text-slate-200 font-bold text-sm">{r.pct.toFixed(2)}%</div>
                  <div className="text-slate-600 text-[10px]">≈ €{fmtInt(aumEur*r.pct/100)}/ano</div>
                </div>
              </div>
            ))}
            <div className="pt-3 flex items-center justify-between border-t border-[#1a1f2e]">
              <div className="text-slate-400 text-xs font-bold">Total externo</div>
              <div className="text-right">
                <div className="text-slate-100 font-black">{EXTERN_PCT.toFixed(2)}%</div>
                <div className="text-slate-600 text-[10px]">≈ €{fmtInt(aumEur*EXTERN_PCT/100)}/ano</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Exemplo real + Comparação de mercado — sempre lista ── */}
      <div className="grid grid-cols-1 gap-2 lg:gap-4">
        {/* Exemplo real */}
        <div className="bg-[#0b0f1a] border border-[#1a1f2e] rounded-xl p-3 sm:p-5 min-w-0">
          <div className="text-[10px] uppercase tracking-widest text-slate-600 mb-1">Exemplo concreto</div>
          <div className="text-[11px] text-slate-500 mb-4">Carteira de €{fmtInt(EX_CAP)} · estimativa anual</div>
          <div className="space-y-2.5">
            {(isPrivate?[
              {label:"Taxa de gestão (0,6%)",val:EX_CAP*0.006,c:"text-amber-400"},
              {label:"Custódia + transações + FX",val:EX_CAP*EXTERN_PCT/100,c:"text-slate-400"},
            ]:[
              {label:`Mensalidade DECIDE (€29 × 12)`,val:29*12,c:"text-teal-400"},
              {label:"Custódia + transações + FX",val:EX_CAP*EXTERN_PCT/100,c:"text-slate-400"},
            ]).map(r=>(
              <div key={r.label} className="flex items-center justify-between">
                <div className="text-slate-400 text-xs">{r.label}</div>
                <div className={`font-bold text-sm ${r.c}`}>€{fmtInt(r.val)}</div>
              </div>
            ))}
            <div className="pt-2.5 border-t border-[#1a1f2e] flex items-center justify-between">
              <div className="text-slate-200 text-xs font-bold">Total estimado / ano</div>
              <div className="text-slate-100 font-black text-base">
                €{fmtInt(isPrivate
                  ? EX_CAP*0.006 + EX_CAP*EXTERN_PCT/100
                  : 29*12 + EX_CAP*EXTERN_PCT/100)}
              </div>
            </div>
            <div className="text-[10px] text-slate-600 italic">Valores estimados baseados no AUM actual.</div>
          </div>
        </div>

        {/* Comparação mercado — sóbria */}
        <div className="bg-[#0b0f1a] border border-[#1a1f2e] rounded-xl p-3 sm:p-5 min-w-0">
          <div className="text-[10px] uppercase tracking-widest text-slate-600 mb-4">Contexto de mercado</div>
          <div className="space-y-4">
            {[
              {label:"DECIDE (custos totais fixos)",val:totalFixedPct,c:"#94a3b8",note:"gestão + externos"},
              {label:"ETFs passivos (estimativa)",val:MARKET_ETF,c:"#475569",note:"sem advisory, sem gestão ativa"},
              {label:"Fundos ativos tradicionais",val:ACTIVE_FUND,c:"#64748b",note:"média Portugal/Europa"},
            ].map(b=>(
              <div key={b.label}>
                <div className="flex justify-between text-xs mb-1.5">
                  <div>
                    <span className="text-slate-300 font-medium">{b.label}</span>
                    <span className="text-slate-600 ml-2 text-[10px]">({b.note})</span>
                  </div>
                  <span className="text-slate-200 font-bold">{b.val.toFixed(2)}%</span>
                </div>
                <div className="h-2 bg-slate-800/50 rounded-full">
                  <div className="h-2 rounded-full" style={{width:`${(b.val/ACTIVE_FUND)*100}%`,background:b.c,opacity:0.7}}/>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-4 text-[10px] text-slate-600 leading-relaxed border-t border-[#1a1f2e] pt-3">
            A comparação inclui apenas custos fixos do DECIDE. A performance fee, quando aplicável, acresce mas está directamente ligada ao desempenho da carteira.
          </div>
        </div>
      </div>

      {/* ── Projecção longo prazo + Quando pagas — sempre lista ── */}
      <div className="grid grid-cols-1 gap-2 lg:gap-4">
        {/* Projecção */}
        <div className="bg-[#0b0f1a] border border-[#1a1f2e] rounded-xl p-3 sm:p-5 min-w-0">
          <div className="text-[10px] uppercase tracking-widest text-slate-600 mb-1">Impacto dos custos a longo prazo</div>
          <div className="text-[10px] text-slate-600 mb-4 italic">Simulação: €{fmtInt(EX_CAP)} · {YRS} anos · {(HIST_CAGR*100).toFixed(0)}% retorno bruto estimado · simulado, não garantido</div>
          {/* Cost comparison row — lista */}
          <div className="grid grid-cols-1 gap-2 mb-4">
            <div className="bg-teal-900/15 border border-teal-700/25 rounded-xl p-3">
              <div className="text-[10px] text-teal-400 font-semibold mb-1">DECIDE — custo anual</div>
              <div className="text-xl font-black text-teal-300">{totalFixedPct.toFixed(2)}%</div>
              <div className="text-[10px] text-slate-500 mt-0.5">≈ €{fmtInt(EX_CAP*totalFixedPct/100)} / ano</div>
            </div>
            <div className="bg-white/[0.02] border border-white/[0.04] rounded-xl p-3">
              <div className="text-[10px] text-slate-500 font-semibold mb-1">Fundos ativos — custo anual</div>
              <div className="text-xl font-black text-slate-400">{ACTIVE_FUND.toFixed(2)}%</div>
              <div className="text-[10px] text-slate-600 mt-0.5">≈ €{fmtInt(EX_CAP*ACTIVE_FUND/100)} / ano</div>
            </div>
          </div>
          {/* Projected final values */}
          <div className="grid grid-cols-1 gap-2 mb-3">
            <div className="bg-teal-900/10 border border-teal-700/15 rounded-lg px-3 py-2">
              <div className="text-[9px] text-slate-500">Capital final (DECIDE)</div>
              <div className="text-base font-black text-slate-100">€ {fmtInt(dVal)}</div>
            </div>
            <div className="bg-white/[0.02] border border-white/[0.03] rounded-lg px-3 py-2">
              <div className="text-[9px] text-slate-500">Capital final (fundos ativos)</div>
              <div className="text-base font-black text-slate-400">€ {fmtInt(mVal)}</div>
            </div>
          </div>
          <div className="text-[11px] text-slate-400 mb-3">
            O DECIDE custa <span className="font-bold text-teal-400">{(ACTIVE_FUND-totalFixedPct).toFixed(2)}pp menos</span> por ano. Em {YRS} anos isso representa <span className="font-bold text-teal-400">+€{fmtInt(projDiff)}</span> a mais no seu bolso.
          </div>
          <ResponsiveContainer width="100%" height={90}>
            <AreaChart data={growthChart} margin={{top:4,right:4,left:0,bottom:0}}>
              <defs>
                <linearGradient id="gD4" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#14b8a6" stopOpacity={0.25}/><stop offset="95%" stopColor="#14b8a6" stopOpacity={0}/></linearGradient>
                <linearGradient id="gA4" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#475569" stopOpacity={0.15}/><stop offset="95%" stopColor="#475569" stopOpacity={0}/></linearGradient>
              </defs>
              <XAxis dataKey="year" tick={{fill:"#475569",fontSize:9}} tickLine={false} axisLine={false} interval={2}/>
              <Tooltip contentStyle={{background:"#0f172a",border:"1px solid #1e293b",borderRadius:6,fontSize:10}}
                formatter={(v:number,name:string)=>[`€${Math.round(v).toLocaleString("pt-PT")}`,name==="decide"?"DECIDE":"Fundos ativos"]}/>
              <Area type="monotone" dataKey="decide" stroke="#14b8a6" strokeWidth={2.5} fill="url(#gD4)" dot={false}/>
              <Area type="monotone" dataKey="market" stroke="#475569" strokeWidth={1.5} strokeDasharray="4 2" fill="url(#gA4)" dot={false}/>
            </AreaChart>
          </ResponsiveContainer>
          <div className="flex gap-4 mt-1 text-[10px]">
            <span className="flex items-center gap-1.5"><span className="w-4 h-0.5 bg-teal-500 inline-block rounded"/><span className="text-slate-500">DECIDE</span></span>
            <span className="flex items-center gap-1.5"><span className="w-4 h-px bg-slate-500 inline-block" style={{borderTop:"2px dashed #475569"}}/><span className="text-slate-500">Fundos ativos</span></span>
          </div>
        </div>

        {/* Quando pagas */}
        <div className="bg-[#0b0f1a] border border-[#1a1f2e] rounded-xl p-3 sm:p-5 min-w-0">
          <div className="text-[10px] uppercase tracking-widest text-slate-600 mb-4">Quando e como paga</div>
          <div className="space-y-4">
            {(isPrivate?[
              {title:"Taxa de gestão (0,6%/ano)",timing:"Mensal",detail:"0,05% cobrado no início de cada mês sobre o valor real da carteira nesse mês — se a carteira crescer, paga um pouco mais; se cair, paga menos.",color:"text-amber-400"},
              {title:"Performance fee",timing:"Não aplicável",detail:"O plano Private não tem performance fee — custo simples e previsível.",color:"text-slate-600"},
              {title:"Custos externos",timing:"Por transação",detail:"Cobrados pelo Interactive Brokers. Custódia debitada mensalmente; transações no momento da execução.",color:"text-slate-400"},
            ]:[
              {title:"Mensalidade DECIDE (€29)",timing:"Mensal",detail:"Débito directo no início de cada mês. Cancelável a qualquer momento.",color:"text-teal-400"},
              {title:"Custos externos",timing:"Por transação",detail:"Cobrados pelo Interactive Brokers no momento da custódia e execução das ordens.",color:"text-slate-400"},
              {title:"Performance fee",timing:"Não aplicável",detail:"O plano Premium não tem performance fee — custo fixo e previsível.",color:"text-slate-600"},
            ]).map(r=>(
              <div key={r.title} className="flex items-start gap-3">
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded border shrink-0 mt-0.5 ${r.timing==="Não aplicável"?"border-slate-700/30 bg-slate-800/30 text-slate-600":r.timing==="Anual"?"border-amber-700/30 bg-amber-900/20 text-amber-400":"border-slate-700/30 bg-slate-800/30 text-slate-400"}`}>
                  {r.timing}
                </span>
                <div>
                  <div className={`text-sm font-semibold ${r.color}`}>{r.title}</div>
                  <div className="text-[11px] text-slate-500 mt-0.5 leading-relaxed">{r.detail}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── FAQ ── */}
      <div className="bg-[#0b0f1a] border border-[#1a1f2e] rounded-xl p-5">
        <div className="text-[10px] uppercase tracking-widest text-slate-600 mb-4">Perguntas frequentes</div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-8">
          {FAQS.map((f,i)=>(
            <div key={i} className="border-b border-[#111827] last:border-0">
              <button className="w-full flex items-center justify-between py-3 text-left gap-3"
                onClick={()=>setFaqOpen(faqOpen===i?null:i)}>
                <span className="text-sm text-slate-300 font-medium leading-snug">{f.q}</span>
                <ChevronDown size={14} className={`text-slate-600 shrink-0 transition-transform ${faqOpen===i?"rotate-180":""}`}/>
              </button>
              {faqOpen===i&&(
                <div className="pb-3 text-xs text-slate-500 leading-relaxed">{f.a}</div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* ── Footer ── */}
      <div className="flex items-center gap-3 bg-[#080c14] border border-[#1a1f2e] rounded-xl px-5 py-3">
        <ShieldCheck size={12} className="text-slate-600 shrink-0"/>
        <div className="text-[10px] text-slate-600 leading-relaxed">
          Valores estimados com base nas características actuais da carteira. A performance fee depende dos resultados reais.
          Os custos externos são estimativas baseadas nas tarifas publicadas do Interactive Brokers.
          <span className="italic ml-1">Performance passada não garante resultados futuros.</span>
        </div>
      </div>
    </div>
  );
}


/* ─── RobustezPage sub-component ───────────────────────────── */
function RobustezPage(){
  const panel="bg-[#0b0f1a] border border-[#1a1f2e] rounded-xl p-5";
  const [expandedTest,setExpandedTest]=useState<string|null>(null);

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

  // More nuanced labels replacing "Aprovado"
  const testLabels:{[key:string]:{badge:string;color:string}}={
    "01":{badge:"Comportamento consistente",color:"bg-slate-700/40 text-slate-300 border border-slate-600/30"},
    "02":{badge:"Degradação limitada",color:"bg-slate-700/40 text-slate-300 border border-slate-600/30"},
    "03":{badge:"Resiliência observada",color:"bg-slate-700/40 text-slate-300 border border-slate-600/30"},
    "04":{badge:"Distribuição favorável",color:"bg-slate-700/40 text-slate-300 border border-slate-600/30"},
    "05":{badge:"Sinais mantidos",color:"bg-slate-700/40 text-slate-300 border border-slate-600/30"},
    "06":{badge:"Recuperação relativa",color:"bg-slate-700/40 text-slate-300 border border-slate-600/30"},
    "07":{badge:"Baixa dependência paramétrica",color:"bg-slate-700/40 text-slate-300 border border-slate-600/30"},
    "08":{badge:"Out-of-sample consistente",color:"bg-slate-700/40 text-slate-300 border border-slate-600/30"},
  };

  const LIMITATIONS=[
    {title:"Dados históricos",desc:"Todos os testes assentam em dados históricos. Regimes de mercado inéditos (ex.: deflação prolongada, ruptura sistémica) não estão representados e podem comportar-se de forma diferente."},
    {title:"Execução real vs. simulada",desc:"Os testes assumem execução a preços de fecho ou com slippage estimado. A execução real pode diferir, especialmente em períodos de elevada volatilidade ou iliquidez."},
    {title:"Capacidade do modelo",desc:"Os resultados foram obtidos com carteiras de dimensão limitada. Estratégias de momentum tendem a degradar-se com volumes significativamente maiores."},
    {title:"Risco de degradação futura",desc:"O comportamento passado dos factores de momentum e qualidade não garante persistência futura. Regimes em que estes factores percam eficácia não foram antecipados nos testes."},
    {title:"Testes conduzidos internamente",desc:"Os testes foram realizados pela equipa DECIDE sem auditoria externa independente. Devem ser interpretados como análise interna, não como certificação regulatória ou académica."},
  ];

  return(
    <div className="space-y-5">

      {/* ── Aviso de contexto ── */}
      <div className="bg-amber-950/25 border border-amber-800/30 rounded-xl px-5 py-4">
        <div className="flex items-start gap-3">
          <Info size={15} className="text-amber-400 shrink-0 mt-0.5"/>
          <div>
            <div className="text-amber-300 font-semibold text-sm mb-1">O objectivo destes testes</div>
            <p className="text-amber-200/70 text-xs leading-relaxed">
              Esta secção documenta análises de robustez realizadas internamente sobre o modelo quantitativo DECIDE.
              O objectivo é verificar se o modelo mantém comportamento <span className="font-semibold">relativamente consistente</span> em diferentes cenários históricos —
              não demonstrar que o modelo é infalível ou que os resultados passados se repetirão.
              Estes testes não constituem certificação regulatória, auditoria independente, ou garantia de resultados futuros.
            </p>
          </div>
        </div>
      </div>

      {/* ── Resumo — sem "8/8 aprovados" ── */}
      <div className={panel}>
        <div className="text-[10px] uppercase tracking-widest text-slate-600 mb-3">Âmbito da análise</div>
        <div className="grid grid-cols-3 gap-3">
          {[
            {label:"Análises realizadas",value:"8",sub:"cenários distintos"},
            {label:"Sub-períodos históricos",value:"4",sub:"incluindo 2008, COVID, 2022"},
            {label:"Simulações Monte Carlo",value:"5 000",sub:"bootstrap de retornos mensais"},
          ].map(s=>(
            <div key={s.label} className="bg-[#060a10] border border-[#1a1f2e] rounded-xl p-4 text-center">
              <div className="text-2xl font-black text-slate-200">{s.value}</div>
              <div className="text-[10px] text-slate-400 mt-0.5 font-medium">{s.label}</div>
              <div className="text-[9px] text-slate-600 mt-0.5 italic">{s.sub}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Testes — expandíveis ── */}
      <div className="space-y-2">
        <div className="text-[10px] uppercase tracking-widest text-slate-600 px-1 mb-2">Análises de robustez</div>
        {tests.map(t=>{
          const lbl=testLabels[t.id]??{badge:"Observado",color:"bg-slate-700/40 text-slate-300 border border-slate-600/30"};
          const isOpen=expandedTest===t.id;
          return (
            <div key={t.id} className="bg-[#0b0f1a] border border-[#1a1f2e] rounded-xl overflow-hidden">
              {/* Summary row — always visible */}
              <button className="w-full flex items-center gap-4 px-5 py-4 text-left hover:bg-white/[0.02] transition-colors"
                onClick={()=>setExpandedTest(isOpen?null:t.id)}>
                <span className="text-[10px] font-mono text-slate-600 shrink-0">T-{t.id}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-slate-200">{t.name}</div>
                  <div className="text-[11px] text-slate-500 mt-0.5 truncate">{t.metric}</div>
                </div>
                <span className={`text-[10px] font-semibold px-2.5 py-1 rounded-full shrink-0 ${lbl.color}`}>{lbl.badge}</span>
                <ChevronDown size={14} className={`text-slate-600 shrink-0 transition-transform ${isOpen?"rotate-180":""}`}/>
              </button>

              {/* Detail — only when expanded */}
              {isOpen&&(
                <div className="border-t border-[#111827] px-5 py-4 space-y-3">
                  <div>
                    <div className="text-[10px] uppercase tracking-wide text-slate-600 mb-1.5">Metodologia</div>
                    <p className="text-xs text-slate-400 leading-relaxed">{t.description}</p>
                  </div>
                  <div className="bg-[#060a10] border border-[#1a1f2e] rounded-lg px-4 py-3">
                    <div className="text-[10px] uppercase tracking-wide text-slate-500 mb-1.5">Observação</div>
                    <p className="text-xs text-slate-300 leading-relaxed">{t.result}</p>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* ── Limitações conhecidas ── */}
      <div className={panel}>
        <div className="text-[10px] uppercase tracking-widest text-slate-600 mb-4">Limitações e advertências</div>
        <div className="space-y-3">
          {LIMITATIONS.map(l=>(
            <div key={l.title} className="flex items-start gap-3">
              <div className="w-1.5 h-1.5 rounded-full bg-amber-600/60 shrink-0 mt-1.5"/>
              <div>
                <div className="text-xs font-semibold text-slate-300">{l.title}</div>
                <div className="text-xs text-slate-500 leading-relaxed mt-0.5">{l.desc}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Nota metodológica ── */}
      <div className={panel}>
        <div className="text-[10px] uppercase tracking-widest text-slate-600 mb-3">Notas metodológicas</div>
        <div className="space-y-2 text-xs text-slate-500 leading-relaxed">
          <p>O modelo combina factores de momentum de preço (12 meses excluindo o último mês) e qualidade fundamental. O rebalanceamento é mensal com volatilidade-alvo ajustada ao perfil.</p>
          <p>Em períodos de risco elevado, a exposição a acções é reduzida automaticamente com aumento da componente monetária (XEON). Em modo de alavancagem, a exposição pode atingir até 180% do capital.</p>
          <p>Custos de transacção estimados com base em spreads típicos para títulos de grande capitalização em mercados desenvolvidos. A execução real pode diferir.</p>
          <p className="text-slate-600 italic pt-1 border-t border-[#1a1f2e]">
            Análise interna DECIDE · Não auditada externamente · Performance passada não garante resultados futuros · Simulado
          </p>
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
    {q:"Porque é que a minha carteira mudou este mês?",a:"Todos os meses o modelo reavalia o universo de acções e pode alterar as posições por três razões: (1) um activo perdeu momentum relativo e foi substituído por outro mais forte; (2) o modelo ajustou pesos para gerir o risco; (3) alteração no nível de liquidez (XEON) em resposta à volatilidade de mercado. A página Histórico mostra o detalhe de cada revisão."},
    {q:"O que é o XEON?",a:"XEON é o Xtrackers EUR Overnight Rate Swap UCITS ETF — um ETF de liquidez que rende a taxa de juro de curto prazo em euros (€STR). É usado como 'estacionamento' de capital quando o modelo reduz a exposição a acções."},
    {q:"O que é o hedge cambial?",a:"Parte da carteira está em activos denominados em USD. Para reduzir o risco cambial EUR/USD, é mantida uma posição de cobertura proporcional à exposição em dólares. Isso protege contra valorizações do euro face ao dólar."},
    {q:"O que é 'Aumentar' vs 'Comprar'?",a:"'Comprar' (ou 'Nova posição') significa iniciar uma posição que não existia. 'Reforçar' significa adicionar capital a uma posição já existente, aumentando o seu peso na carteira."},
    {q:"A corretora Interactive Brokers é obrigatória?",a:"Não é obrigatória para ver as recomendações, mas é necessária para execução automática de ordens. Podes também seguir as recomendações manualmente em qualquer corretora."},
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

      {/* ── Como começar ── */}
      <div className="bg-gradient-to-br from-[#0b0f1a] to-[#0d1220] border border-[#1a1f2e] rounded-xl p-5">
        <div className="text-[10px] uppercase tracking-widest text-slate-600 mb-4">Como começar</div>
        <div className="-mx-1 flex flex-row gap-3 overflow-x-auto px-1 pb-1 [-webkit-overflow-scrolling:touch] sm:mx-0 sm:grid sm:grid-cols-4 sm:overflow-visible sm:px-0 sm:pb-0">
          {[
            {n:"1",title:"Definir o teu perfil",desc:"Selecciona o perfil de risco (Conservador, Moderado, Dinâmico) e preferência de hedge cambial no onboarding ou no topo da plataforma.",icon:<ShieldCheck size={14} className="text-teal-400"/>},
            {n:"2",title:"Rever as recomendações",desc:"No início de cada mês, o modelo gera um novo plano. Revê na página Recomendações e aprova se concordas.",icon:<BookOpen size={14} className="text-blue-400"/>},
            {n:"3",title:"Enviar ordens",desc:"Depois de aprovares o plano, envia as ordens à Interactive Brokers. O sistema gera e envia automaticamente.",icon:<Send size={14} className="text-emerald-400"/>},
            {n:"4",title:"Acompanhar o desempenho",desc:"Consulta as páginas Performance, Risco e Histórico para acompanhar a evolução da carteira ao longo do tempo.",icon:<TrendingUp size={14} className="text-amber-400"/>},
          ].map(s=>(
            <div key={s.n} className="w-[min(100%,17rem)] shrink-0 bg-white/[0.03] border border-white/[0.05] rounded-xl p-4 sm:w-auto sm:min-w-0">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-6 h-6 rounded-full bg-white/[0.05] flex items-center justify-center text-[10px] font-black text-slate-400">{s.n}</div>
                {s.icon}
              </div>
              <div className="text-slate-200 text-xs font-semibold mb-1">{s.title}</div>
              <div className="text-slate-500 text-[11px] leading-relaxed">{s.desc}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Assistente (tom educativo, não IA hype) ── */}
      <div ref={chatBoxRef} className="bg-[#0b0f1a] border border-[#1a1f2e] rounded-xl overflow-hidden">
        <div className="flex items-center gap-3 px-5 py-4 border-b border-[#1a1f2e]">
          <div className="w-8 h-8 rounded-full bg-slate-800 border border-slate-700/50 flex items-center justify-center shrink-0">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>
          </div>
          <div>
            <div className="text-slate-200 font-semibold text-sm">Assistente educativo DECIDE</div>
            <div className="text-slate-600 text-[10px]">Responde a dúvidas sobre a plataforma e conceitos financeiros gerais</div>
          </div>
          <div className="ml-auto">
            <span className="text-[10px] text-slate-600 border border-slate-700/40 rounded px-2 py-0.5">Não constitui aconselhamento personalizado</span>
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
        <div className="px-5 pb-3 text-[10px] text-slate-600 leading-relaxed">
          O assistente responde a questões educativas sobre a plataforma e finanças em geral. Pode cometer erros. As respostas não constituem recomendação de investimento personalizada nem aconselhamento financeiro regulado. Para decisões de investimento, consulte um profissional autorizado.
        </div>
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

      {/* ── Falar com a equipa ── */}
      <div className="bg-gradient-to-br from-[#0d1220] to-[#0b0f1a] border border-[#1a2030] rounded-xl p-6">
        <div className="text-[10px] uppercase tracking-widest text-slate-600 mb-1">Falar com a equipa</div>
        <div className="text-slate-400 text-xs mb-4 leading-relaxed">
          O DECIDE é construído e gerido por pessoas reais. Se tiveres dúvidas que a plataforma não resolve,
          ou simplesmente quiseres perceber melhor como funciona — estamos disponíveis.
        </div>
        <div className="grid grid-cols-2 gap-3">
          {[
            {icon:<Mail size={16} className="text-teal-400"/>,label:"Email",sub:"Resposta em 24–48h",action:"jcpina01@decidepoweredbyai.com",href:"mailto:jcpina01@decidepoweredbyai.com",bg:"bg-teal-900/10 border-teal-700/20"},
            {icon:<Activity size={16} className="text-amber-400"/>,label:"Agendar chamada",sub:"Revisão da carteira",action:"15 min · gratuito",href:"mailto:jcpina01@decidepoweredbyai.com?subject=Agendar%20chamada%20DECIDE",bg:"bg-amber-900/10 border-amber-700/20"},
          ].map(c=>(
            <a key={c.label} href={c.href} className={`flex items-start gap-3 p-4 rounded-xl border ${c.bg} hover:opacity-80 transition-opacity`}>
              <div className="mt-0.5">{c.icon}</div>
              <div>
                <div className="text-slate-200 text-sm font-semibold">{c.label}</div>
                <div className="text-slate-400 text-xs mt-0.5">{c.sub}</div>
                <div className="text-slate-600 text-[10px] mt-0.5 italic">{c.action}</div>
              </div>
            </a>
          ))}
        </div>
      </div>

      {/* ── Recursos ── */}
      <div className="bg-[#0b0f1a] border border-[#1a1f2e] rounded-xl p-5">
        <div className="text-[10px] uppercase tracking-widest text-slate-600 mb-4">Documentação e recursos</div>
        <div className="grid grid-cols-3 gap-3">
          {[
            {Icon:BookOpen,label:"Glossário de termos",desc:"Definição dos principais termos financeiros usados na plataforma",color:"text-blue-400"},
            {Icon:ShieldCheck,label:"Política de risco",desc:"Como o modelo gere automaticamente o risco e limita drawdowns",color:"text-amber-400"},
            {Icon:TrendingUp,label:"Metodologia (resumida)",desc:"Como funciona o modelo — versão simplificada para não especialistas",color:"text-teal-400"},
          ].map(({Icon,label,desc,color})=>(
            <div key={label} className="bg-[#080c14] border border-[#1a1f2e] rounded-xl p-4 hover:border-slate-600/60 transition-colors cursor-default">
              <Icon size={15} className={`${color} mb-2.5`}/>
              <div className="text-slate-200 text-xs font-semibold mb-1">{label}</div>
              <div className="text-slate-500 text-[10px] leading-relaxed">{desc}</div>
              <div className="text-slate-700 text-[10px] mt-2 italic">Em breve →</div>
            </div>
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

  // Pre-compute targetVol for leverage estimation (same MARGIN_BOOST as main equity computation)
  const HIST_MARGIN_BOOST=1.35;
  const targetVol=useMemo(()=>{
    if(!benchRaw.length) return 0;
    const bRets=benchRaw.slice(1).map((v,i)=>benchRaw[i]!>0?v/benchRaw[i]!-1:0);
    const base=annualVol(bRets)*profileFactor;
    return marginEnabled?base*HIST_MARGIN_BOOST:base;
  },[benchRaw,profileFactor,marginEnabled]);

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
    // Regime label based on equity allocation
    const regime=equityPct>105?"Alavancado":equityPct>=90?"Ofensivo":equityPct>=70?"Neutro":"Defensivo";
    const regimeStyle=equityPct>105?"bg-orange-500/15 text-orange-400":equityPct>=90?"bg-teal-500/15 text-teal-400":equityPct>=70?"bg-blue-500/15 text-blue-400":"bg-amber-500/15 text-amber-400";

    // Mini chart: model + benchmark ±3 months around rebalDate
    const getMiniPts=():{pts:Array<{date:string;v:number;b:number}>|null;result3m:{model:number;bench:number}|null}=>{
      if(!rebalDate||!dates.length) return {pts:null,result3m:null};
      const idx=dates.findIndex(d=>new Date(d)>=rebalDate);
      if(idx<0) return {pts:null,result3m:null};
      const start=Math.max(0,idx-63);
      const end=Math.min(dates.length-1,idx+63);
      const base=equityRaw[start]??1;
      const baseBench=benchRaw[start]??1;
      const pts:Array<{date:string;v:number;b:number}>=[];
      for(let j=start;j<=end;j++){
        pts.push({date:dates[j]!.slice(0,10),v:+((equityRaw[j]??base)/base*100).toFixed(2),b:+((benchRaw[j]??baseBench)/baseBench*100).toFixed(2)});
      }
      // Post-rebalancing 3m result (idx → idx+63)
      const endFwd=Math.min(dates.length-1,idx+63);
      const result3m=endFwd>idx&&(equityRaw[idx]??0)>0?{
        model:+((equityRaw[endFwd]!/equityRaw[idx]!-1)*100).toFixed(1),
        bench:+((benchRaw[endFwd]!/(benchRaw[idx]||1)-1)*100).toFixed(1),
      }:null;
      return {pts:pts.length>=2?pts:null,result3m};
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
    return {label,compras,aumentos,vendas,reducoes,manter,getMiniPts,isLatest,estado,estadoStyle,resumo,xeonPct,equityPct,xeonDelta,equityDelta,lev,regime,regimeStyle};
  }),[sortedMonths,dates,equityRaw,benchRaw,marginEnabled,targetVol]);

  return (
    <div className="bg-[#0b0f1a] border-y lg:border border-[#1a1f2e] lg:rounded-xl overflow-hidden max-lg:w-screen max-lg:max-w-[100vw] max-lg:ml-[calc(50%-50vw)] max-lg:mr-[calc(50%-50vw)] lg:mx-0 lg:w-auto lg:max-w-none">
      <div className="flex border-b border-[#1a1f2e]">
        {([["reco","Recomendações"],["ops","Operações"],["carteira","Histórico de carteira"]] as const).map(([k,l])=>(
          <button key={k} onClick={()=>setHistTab(k)}
            className={`px-5 py-3.5 text-xs font-semibold transition-colors ${histTab===k?"text-white border-b-2 border-blue-500 bg-white/[0.02]":"text-slate-500 hover:text-slate-300"}`}>
            {l}
          </button>
        ))}
      </div>
      {histTab==="reco"&&(
        <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-slate-500 border-b border-[#1a1f2e] text-left">
              <th className="px-4 py-3 font-semibold w-36">Data</th>
              <th className="px-3 py-3 font-semibold text-center text-emerald-500 w-9" title="Compras">▲</th>
              <th className="px-3 py-3 font-semibold text-center text-cyan-500 w-9 hidden sm:table-cell" title="Reforços">↑</th>
              <th className="px-3 py-3 font-semibold text-center text-red-500 w-9" title="Vendas">▼</th>
              <th className="px-3 py-3 font-semibold text-center text-amber-500 w-9" title="Reduções">↓</th>
              <th className="px-3 py-3 font-semibold text-center text-slate-500 w-9 hidden sm:table-cell" title="Mantidas">≈</th>
              <th className="px-4 py-3 font-semibold">Resumo</th>
              <th className="px-4 py-3 font-semibold w-24 hidden sm:table-cell">Estado</th>
            </tr>
          </thead>
          <tbody>
            {histRows.map((r,i)=>(
              <React.Fragment key={i}>
                <tr className={`border-b border-[#0f1420] cursor-pointer transition-colors select-none ${expandedIdx===i?"bg-white/[0.04]":"hover:bg-white/[0.02]"}`}
                  onClick={()=>setExpandedIdx(expandedIdx===i?null:i)}>
                  <td className="px-4 py-3 align-middle">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="font-semibold text-slate-200 capitalize text-sm">{r.label}</span>
                      <span className={`inline-flex shrink-0 items-center px-2 py-0.5 rounded-full text-[10px] font-bold leading-none ${r.regimeStyle}`}>{r.regime}</span>
                      <span className={`sm:hidden inline-flex shrink-0 items-center px-2 py-0.5 rounded-full text-[10px] font-bold leading-none ${r.estadoStyle}`}>{r.estado}</span>
                    </div>
                  </td>
                  <td className="px-3 py-3 text-center font-bold text-emerald-400 text-sm align-middle">{r.compras.length||<span className="text-slate-700">—</span>}</td>
                  <td className="px-3 py-3 text-center font-bold text-cyan-400 text-sm hidden sm:table-cell align-middle">{r.aumentos.length||<span className="text-slate-700">—</span>}</td>
                  <td className="px-3 py-3 text-center font-bold text-rose-400 text-sm align-middle">{r.vendas.length||<span className="text-slate-700">—</span>}</td>
                  <td className="px-3 py-3 text-center font-bold text-amber-400 text-sm align-middle">{r.reducoes.length||<span className="text-slate-700">—</span>}</td>
                  <td className="px-3 py-3 text-center text-slate-600 text-sm hidden sm:table-cell align-middle">{r.manter.length||<span className="text-slate-700">—</span>}</td>
                  <td className="px-4 py-3 align-middle min-w-0">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                      <span className="text-slate-300 min-w-0">{r.resumo}</span>
                      {r.xeonPct>0&&(
                        <span className="inline-flex shrink-0 items-center px-2 py-0.5 rounded bg-amber-500/10 text-amber-500 text-[10px] font-semibold leading-none whitespace-nowrap">
                          MM {r.xeonPct.toFixed(0)}%{r.xeonDelta!==0?` ${r.xeonDelta>0?"+":""}${r.xeonDelta.toFixed(0)}pp`:""}
                        </span>
                      )}
                      <span className={`inline-flex shrink-0 items-center px-2 py-0.5 rounded text-[10px] font-semibold leading-none whitespace-nowrap ${r.equityPct>101?"bg-orange-500/15 text-orange-400":"bg-slate-700/40 text-slate-500"}`}>
                        Acções {r.equityPct.toFixed(0)}%{r.lev>1.01?` ×${r.lev.toFixed(2)}`:""}
                        {r.equityDelta!==0?` ${r.equityDelta>0?"+":""}${r.equityDelta.toFixed(0)}pp`:""}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3 hidden sm:table-cell align-middle"><span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold leading-none ${r.estadoStyle}`}>{r.estado}</span></td>
                </tr>
                {expandedIdx===i&&(()=>{
                  const {pts,result3m}=r.getMiniPts();
                  return(
                  <tr className="border-b border-[#0a0e18] bg-[#060a12]">
                    <td colSpan={8} className="px-6 py-6">
                      <div className="space-y-5">

                        {/* ── Section 1: Allocation + Result ── */}
                        <div className="flex items-center gap-4 flex-wrap">
                          <span className={`px-3 py-1 rounded-lg text-xs font-bold ${r.regimeStyle}`}>{r.regime}</span>
                          {r.xeonPct>0&&(
                            <span className="px-3 py-1 rounded-lg text-xs font-bold bg-amber-500/10 text-amber-400">
                              Liquidez {r.xeonPct.toFixed(1)}%{r.xeonDelta!==0?` (${r.xeonDelta>0?"+":""}${r.xeonDelta.toFixed(1)}pp)`:""}
                            </span>
                          )}
                          <span className={`px-3 py-1 rounded-lg text-xs font-bold ${r.equityPct>101?"bg-orange-500/15 text-orange-400":"bg-slate-700/40 text-slate-400"}`}>
                            Acções {r.equityPct.toFixed(1)}%{r.lev>1.01?` ⚡ ×${r.lev.toFixed(2)}`:""}
                            {r.equityDelta!==0?` (${r.equityDelta>0?"+":""}${r.equityDelta.toFixed(1)}pp)`:""}
                          </span>
                          {result3m&&!r.isLatest&&(
                            <span className={`ml-auto px-3 py-1 rounded-lg text-xs font-bold border ${result3m.model>=result3m.bench?"border-teal-500/30 bg-teal-950/30 text-teal-400":"border-slate-600/30 bg-slate-800/30 text-slate-400"}`}>
                              Resultado 3m: Modelo {result3m.model>=0?"+":""}{result3m.model}% · Bench {result3m.bench>=0?"+":""}{result3m.bench}%
                              {result3m.model>result3m.bench&&<span className="text-teal-300 ml-1">+{(result3m.model-result3m.bench).toFixed(1)}pp vs bench</span>}
                            </span>
                          )}
                        </div>

                        {/* ── Section 2: Mini-chart + Actions ── */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 lg:gap-6">
                          {/* Mini chart with benchmark */}
                          <div>
                            <div className="text-[10px] text-slate-600 mb-2 font-semibold uppercase tracking-wide">Evolução ±3 meses</div>
                            {pts&&pts.length>=2?(
                              <ResponsiveContainer width="100%" height={120}>
                                <LineChart data={pts} margin={{top:4,right:4,left:-16,bottom:0}}>
                                  <defs>
                                    <linearGradient id={`miniGrad${i}`} x1="0" y1="0" x2="0" y2="1">
                                      <stop offset="5%" stopColor="#14b8a6" stopOpacity={0.15}/>
                                      <stop offset="95%" stopColor="#14b8a6" stopOpacity={0}/>
                                    </linearGradient>
                                  </defs>
                                  <XAxis dataKey="date" tick={{fontSize:8,fill:"#475569"}} tickLine={false} axisLine={false}
                                    interval={Math.floor(pts.length/4)} tickFormatter={(d:string)=>d.slice(5)}/>
                                  <YAxis tick={{fontSize:8,fill:"#475569"}} tickLine={false} axisLine={false}
                                    tickFormatter={v=>`${Number(v).toFixed(0)}`} domain={["dataMin-1","dataMax+1"]}/>
                                  <ReferenceLine y={100} stroke="#1e293b" strokeDasharray="2 2"/>
                                  <Tooltip
                                    formatter={(v:number,name:string)=>[`${Number(v).toFixed(1)}`,name==="v"?"Modelo":"Benchmark"]}
                                    labelFormatter={(d:string)=>d}
                                    contentStyle={{background:"#0f172a",border:"1px solid #1e293b",borderRadius:6,fontSize:10,color:"#e2e8f0"}}
                                    labelStyle={{color:"#94a3b8"}} itemStyle={{color:"#60a5fa"}}/>
                                  <Line type="monotone" dataKey="v" stroke="#14b8a6" strokeWidth={2} dot={false} name="v"/>
                                  <Line type="monotone" dataKey="b" stroke="#334155" strokeWidth={1} dot={false} strokeDasharray="3 2" name="b"/>
                                </LineChart>
                              </ResponsiveContainer>
                            ):(
                              <div className="text-slate-700 text-xs italic h-[120px] flex items-center">Sem dados de gráfico</div>
                            )}
                            <div className="flex items-center gap-3 mt-1">
                              <div className="flex items-center gap-1.5 text-[10px] text-slate-600"><div className="w-4 h-0.5 bg-teal-500 rounded"/>Modelo</div>
                              <div className="flex items-center gap-1.5 text-[10px] text-slate-700"><div className="w-4 h-px bg-slate-600 rounded"/>Benchmark</div>
                            </div>
                          </div>

                          {/* Actions grid */}
                          <div className="grid grid-cols-2 gap-x-6 gap-y-4 content-start">
                            {r.compras.length>0&&(
                              <div>
                                <div className="text-[10px] text-emerald-500 font-bold mb-2 uppercase tracking-wide">▲ Nova posição</div>
                                {r.compras.map(({t,w})=>{const cn=(COMPANY[t.toUpperCase()]||"").replace(/\s+[A-C]$/,"").trim();return(
                                  <div key={t} className="py-1 flex items-baseline gap-2">
                                    <span className="font-semibold text-slate-100 text-xs">{t}</span>
                                    <span className="text-emerald-400 text-[11px] font-semibold">{w.toFixed(1)}%</span>
                                    {cn&&<span className="text-slate-600 text-[10px] truncate">{cn}</span>}
                                  </div>
                                );})}
                              </div>
                            )}
                            {r.aumentos.length>0&&(
                              <div>
                                <div className="text-[10px] text-blue-400 font-bold mb-2 uppercase tracking-wide">↑ Reforçar</div>
                                {r.aumentos.map(({t,w})=>{const cn=(COMPANY[t.toUpperCase()]||"").replace(/\s+[A-C]$/,"").trim();return(
                                  <div key={t} className="py-1 flex items-baseline gap-2">
                                    <span className="font-semibold text-slate-100 text-xs">{t}</span>
                                    <span className="text-blue-300 text-[11px] font-semibold">{w.toFixed(1)}%</span>
                                    {cn&&<span className="text-slate-600 text-[10px] truncate">{cn}</span>}
                                  </div>
                                );})}
                              </div>
                            )}
                            {r.vendas.length>0&&(
                              <div>
                                <div className="text-[10px] text-rose-500 font-bold mb-2 uppercase tracking-wide">▼ Encerrar</div>
                                {r.vendas.map(({t,w})=>{const cn=(COMPANY[t.toUpperCase()]||"").replace(/\s+[A-C]$/,"").trim();return(
                                  <div key={t} className="py-1 flex items-baseline gap-2">
                                    <span className="font-semibold text-slate-100 text-xs">{t}</span>
                                    <span className="text-rose-400 text-[11px] font-semibold">{w.toFixed(1)}%</span>
                                    {cn&&<span className="text-slate-600 text-[10px] truncate">{cn}</span>}
                                  </div>
                                );})}
                              </div>
                            )}
                            {r.reducoes.length>0&&(
                              <div>
                                <div className="text-[10px] text-amber-500 font-bold mb-2 uppercase tracking-wide">↓ Reduzir</div>
                                {r.reducoes.map(({t,w})=>{const cn=(COMPANY[t.toUpperCase()]||"").replace(/\s+[A-C]$/,"").trim();return(
                                  <div key={t} className="py-1 flex items-baseline gap-2">
                                    <span className="font-semibold text-slate-100 text-xs">{t}</span>
                                    <span className="text-amber-300 text-[11px] font-semibold">{w.toFixed(1)}%</span>
                                    {cn&&<span className="text-slate-600 text-[10px] truncate">{cn}</span>}
                                  </div>
                                );})}
                              </div>
                            )}
                            {r.compras.length===0&&r.aumentos.length===0&&r.vendas.length===0&&r.reducoes.length===0&&(
                              <div className="col-span-2 text-slate-600 text-xs italic pt-2">Sem alterações significativas nesta revisão</div>
                            )}
                          </div>
                        </div>
                      </div>
                    </td>
                  </tr>
                );})()}
              </React.Fragment>
            ))}
          </tbody>
        </table>
        </div>
      )}
      {histTab==="ops"&&<div className="p-8 text-slate-600 text-sm italic text-center">Operações executadas em corretora — disponível após ligação ao Interactive Brokers.</div>}
      {histTab==="carteira"&&<div className="p-8 text-slate-600 text-sm italic text-center">Evolução histórica da composição da carteira — em breve.</div>}
    </div>
  );
}

/* ─── Página: Confirmar e enviar ordens para IB ────────────── */
function OrdensPage({actionCounts,latestMonth,recoLabel,aum,loggedIn,onBack,onShowRegister,profileLabel,fxExposure,marginEnabled,prices,sessionUser}:{
  actionCounts:{comprar:number;aumentar:number;reduzir:number;vender:number;manter:number;
    rows:{ticker:string;prev:number;cur:number;delta:number;action:string}[];
    allRows:{ticker:string;prev:number;cur:number;delta:number;action:string}[];};
  latestMonth:{rows:{ticker:string;weightPct:number}[];tbillsTotalPct?:number}|null;
  recoLabel:string;aum:number;loggedIn:boolean;onBack:()=>void;onShowRegister:()=>void;
  profileLabel:string;fxExposure:string;marginEnabled:boolean;
  prices:Record<string,{price:number;currency:string}|null>;
  sessionUser:string|null;
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
  type FillRow={ticker:string;action:string;requested_qty:number;filled:number;avg_fill_price?:number|null;currency?:string;value_eur?:number|null;status:string;message?:string|null;ib_order_id?:number|null;ib_perm_id?:number|null;executed_as?:string|null;fx_hedge_attached?:boolean};
  const [fills,setFills]=React.useState<FillRow[]>([]);
  const [paperMode,setPaperMode]=React.useState(false);
  const [showDiag,setShowDiag]=React.useState(false);
  // "full" = send entire plan (all positions); "delta" = send only this month's changes
  const [execMode,setExecMode]=React.useState<"full"|"delta">("full");
  // IB live positions (for orphan detection and "vender tudo")
  const [ibkrPos,setIbkrPos]=React.useState<{ticker:string;qty:number;value:number;value_eur?:number;currency?:string;weight_pct:number}[]|null>(null);
  const [ibkrOpenOrders,setIbkrOpenOrders]=React.useState<{ticker:string;side:string;remaining_qty:number;status:string}[]>([]);
  const [ibkrFxSupported,setIbkrFxSupported]=React.useState<boolean|null>(null);
  const [ibkrFxManualOverride,setIbkrFxManualOverride]=React.useState<boolean>(
    ()=>localStorage.getItem("ibkr_fx_disabled")==="1"
  );
  const ibkrFxBlocked=ibkrFxManualOverride||(ibkrFxSupported===false);
  const [ibkrAcctType,setIbkrAcctType]=React.useState("");
  const [ibkrAcctCode,setIbkrAcctCode]=React.useState("");
  const [ibkrLoading,setIbkrLoading]=React.useState(false);
  const [ibkrErr,setIbkrErr]=React.useState("");
  const [sellAllSending,setSellAllSending]=React.useState(false);
  const [sellAllResult,setSellAllResult]=React.useState<{ref:string;fills:number}|null>(null);
  const [sellAllFills,setSellAllFills]=React.useState<FillRow[]>([]);
  // Flatten (zerar) — fecha longs (SELL) E shorts (BUY to cover)
  const [flatSending,setFlatSending]=React.useState(false);
  const [flatResult,setFlatResult]=React.useState<{ref:string;longs:number;shorts:number}|null>(null);
  const [flatFills,setFlatFills]=React.useState<FillRow[]>([]);
  const [auditStatus,setAuditStatus]=React.useState<{ok:boolean;msg:string}|null>(null);
  // Confirmation flow state for flatten
  const [flatStep,setFlatStep]=React.useState<"idle"|"preview">("idle");
  const [flatChecks,setFlatChecks]=React.useState([false,false,false]);
  const [cancelSending,setCancelSending]=React.useState(false);
  const [cancelResult,setCancelResult]=React.useState<string|null>(null);
  const [pollCount,setPollCount]=React.useState(0);
  const [confirmChecks,setConfirmChecks]=React.useState([false,false,false]);
  const allChecked=confirmChecks.every(Boolean);

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
        const openOrders:(typeof ibkrOpenOrders)=j.open_orders??[];
        setIbkrOpenOrders(openOrders);
        if(typeof j.fx_supported==="boolean") setIbkrFxSupported(j.fx_supported);
        if(j.account_type) setIbkrAcctType(j.account_type);
        else if(j.meta?.account_type_raw) setIbkrAcctType(j.meta.account_type_raw);
        // Capture account code for audit fallback (e.g. "DUM504002" → client_id when not logged in)
        const acctCode=j.accountCode??j.account_code??j.account??j.selected?.accountCode??"";
        if(acctCode) { setIbkrAcctCode(acctCode); try{localStorage.setItem("decide_ibkr_acct_code",acctCode);}catch{} }

        // Sync fill statuses: any fill that was "Em curso" but is no longer
        // in IB open orders was cancelled or filled externally (e.g. via TWS).
        const openTickers=new Set(openOrders.map((o:{ticker:string})=>o.ticker.toUpperCase()));
        const heldTickers=new Set((j.positions??[]).map((p:{ticker:string})=>p.ticker.toUpperCase()));
        setFills(prev=>prev.map(f=>{
          const pending=f.status==="Submitted"||f.status==="PreSubmitted"||f.status==="PendingSubmit";
          if(!pending) return f;
          const t=(f.ticker||"").toUpperCase();
          if(openTickers.has(t)) return f; // still open in IB
          // Not in open orders anymore — determine if filled or cancelled
          const nowHeld=heldTickers.has(t);
          const wasSell=f.side==="SELL"||f.action==="Vender"||f.action==="SELL";
          const newStatus=(!wasSell&&nowHeld)||( wasSell&&!nowHeld)?"Filled":"Cancelled";
          return {...f,status:newStatus};
        }));
        setSellAllFills(prev=>prev.map(f=>{
          const pending=f.status==="Submitted"||f.status==="PreSubmitted"||f.status==="PendingSubmit";
          if(!pending) return f;
          const t=(f.ticker||"").toUpperCase();
          if(openTickers.has(t)) return f;
          return {...f,status:heldTickers.has(t)?"Filled":"Cancelled"};
        }));
        setFlatFills(prev=>prev.map(f=>{
          const pending=f.status==="Submitted"||f.status==="PreSubmitted"||f.status==="PendingSubmit";
          if(!pending) return f;
          const t=(f.ticker||"").toUpperCase();
          if(openTickers.has(t)) return f;
          return {...f,status:heldTickers.has(t)?"Filled":"Cancelled"};
        }));
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
        console.log("[cancel] response:", JSON.stringify({status:j.status,cancelled:j.cancelled,cancellations_len:(j.cancellations??[]).length,keys:Object.keys(j)}));
        const n=j.cancellations?.length??j.cancelled??0;
        setCancelResult(`${n} ordem(ns) cancelada(s)`);
        setIbkrOpenOrders([]);
        // Clear stale fills so the UI no longer shows "Em curso" for cancelled orders
        setFills(prev => prev.map(f => ({ ...f, status: "Cancelled" })));
        setDone(false);
        logActivity({type:"cancelamento",label:`${n} ordem(ns) cancelada(s) na IB Gateway`,icon:"✕",color:"text-red-400"});
        // ── Audit log: cancellation event ──────────────────────────────────
        const clientId = auditClientId() ?? "unknown";
        const cancelledAt = new Date().toISOString();
        // 1. Config-change log (always — even if no per-ticker detail)
        void fetch("/api/audit/config-change",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({
          client_id: clientId, changed_by:"client", change_type:"cancel_orders",
          new_value:{cancelled:n, orders: j.cancellations ?? [], cancelled_at: cancelledAt},
          changed_at: cancelledAt,
        })}).catch(()=>{});
        // 2. Individual order_logs entries — one per cancelled order (if IB returns ticker detail)
        const cancels:Array<{ticker?:string;side?:string;order_id?:number;ibOrderId?:number}> = j.cancellations ?? [];
        for(const c of cancels){
          const ticker = c.ticker ?? "";
          if(!ticker) continue;
          void fetch("/api/audit/order",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({
            client_id: clientId,
            ticker,
            side: (String(c.side??"SELL").toUpperCase()==="BUY"?"BUY":"SELL"),
            ibkr_order_id: String(c.order_id ?? c.ibOrderId ?? ""),
            status: "cancelled",
            submitted_at: cancelledAt,
          })}).catch(()=>{});
        }
      } else {
        setCancelResult("Erro: "+(j.error||j.detail||`HTTP ${resp.status}`));
      }
    }catch(e:unknown){setCancelResult("Erro: "+(e instanceof Error?e.message:"ligação"));}
    finally{setCancelSending(false);}
  }

  async function sellAllPositions(){
    if(!ibkrPos||ibkrPos.length===0) return;
    if(!paperMode&&ibkrOpenOrders.length>0){
      setIbkrErr(`⚠ Tens ${ibkrOpenOrders.length} ordens pendentes na IB. Cancela-as primeiro.`);
      return;
    }
    setSellAllSending(true);setIbkrErr("");
    try{
      if(paperMode){
        await new Promise(r=>setTimeout(r,1400));
        const simRef="SIM-SELLALL-"+Date.now().toString(36).toUpperCase();
        setSellAllResult({ref:simRef,fills:ibkrPos.length});
        setAuditStatus(null);
        const sentSell=ibkrPos.filter(p=>p.qty>0).map(p=>({ticker:p.ticker,side:"SELL" as const,requested_qty:p.qty,ib_order_id:null}));
        try{
          console.log("[audit] sellAll paper: saving approval, clientId=", auditClientId());
          const approvalId=await auditSaveApproval(null);
          await auditSaveOrders(approvalId,sentSell);
          setAuditStatus({ok:true,msg:`✓ Audit guardado · approvalId=${approvalId??"null"} · ${sentSell.length} ordens`});
        }catch(e){
          console.error("[audit] sellAll paper error:", e);
          setAuditStatus({ok:false,msg:`✗ Audit falhou: ${String(e)}`});
        }
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
      console.log("[sellAll] ibkr-orders response:", JSON.stringify({ok:j.ok,status:j.status,submitted:j.submitted,fills_len:(j.fills??[]).length}));
      if(resp.ok&&j.status!=="rejected"&&j.status!=="error"){
        setSellAllResult({ref:j.order_ref||"ORD-"+Date.now().toString(36).toUpperCase(),fills:j.submitted??ibkrPos.length});
        setSellAllFills(j.fills??[]);
        // Audit: log sell-all approval + orders
        // Use j.fills when available; fall back to the orders we submitted
        // (IB returns empty fills for PreSubmitted orders queued for next market open)
        console.log("[audit] sellAll: saving approval, clientId=", auditClientId(), "positions=", ibkrPos.length);
        const approvalId = await auditSaveApproval(null);
        const sentOrders = ibkrPos.filter(p=>p.qty>0).map(p=>({
          ticker:p.ticker, side:"SELL" as const, requested_qty:p.qty, ib_order_id:null,
        }));
        // Use sentOrders for correct side (SELL for longs); enrich with IB order IDs from fills
        const ibFillMap=new Map((j.fills??[] as Record<string,unknown>[]).map(f=>[String(f.ticker??"").toUpperCase(),f.ib_order_id as number|null]));
        const fillsForAudit=sentOrders.map(o=>({...o,ib_order_id:ibFillMap.get(o.ticker.toUpperCase())??null}));
        void auditSaveOrders(approvalId, fillsForAudit);
        // Log executions with real fill values (commission computed from value_eur)
        void auditSaveExecutions((j.fills??[]).map((f:Record<string,unknown>)=>({
          ticker:String(f.ticker??""),action:"Vender",
          filled:Number(f.filled??0)||0,avg_fill_price:Number(f.avg_fill_price??0)||null,
          value_eur:Number(f.value_eur??0)||null,ib_order_id:Number(f.ib_order_id??0)||null,
        })));
        void fetch("/api/audit/config-change",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({
          client_id: auditClientId(), changed_by:"client", change_type:"sell_all",
          new_value:{ref:j.order_ref, positions:ibkrPos.length}, changed_at: new Date().toISOString(),
        })}).catch(()=>{});
      } else{setIbkrErr(j.error||j.detail||`Erro ${resp.status}`);}
    }catch(e:unknown){setIbkrErr(e instanceof Error?e.message:"Erro de ligação");}
    finally{setSellAllSending(false);}
  }

  async function flattenAllPositions(){
    if(!ibkrPos||ibkrPos.length===0) return;
    // Safety: never send flatten if there are already open orders (prevents duplicates)
    if(!paperMode&&ibkrOpenOrders.length>0){
      setIbkrErr(`⚠ Tens ${ibkrOpenOrders.length} ordens pendentes na IB. Cancela-as primeiro antes de zerar.`);
      return;
    }
    const longs=ibkrPos.filter(p=>p.qty>0);
    const shorts=ibkrPos.filter(p=>p.qty<0);
    if(longs.length===0&&shorts.length===0) return;
    setFlatSending(true);setIbkrErr("");
    try{
      if(paperMode){
        await new Promise(r=>setTimeout(r,1400));
        const simRef="SIM-FLAT-"+Date.now().toString(36).toUpperCase();
        setFlatResult({ref:simRef,longs:longs.length,shorts:shorts.length});
        // Save audit even in paper mode so you can verify DB connectivity
        setAuditStatus(null);
        const sentFlat=[
          ...longs.map(p=>({ticker:p.ticker,side:"SELL" as const,requested_qty:p.qty,ib_order_id:null})),
          ...shorts.map(p=>({ticker:p.ticker,side:"BUY" as const,requested_qty:Math.abs(p.qty),ib_order_id:null})),
        ];
        try{
          console.log("[audit] flatten paper: saving approval, clientId=", auditClientId());
          const approvalId=await auditSaveApproval(null);
          await auditSaveOrders(approvalId,sentFlat);
          setAuditStatus({ok:true,msg:`✓ Audit guardado · approvalId=${approvalId??"null"} · ${sentFlat.length} ordens`});
        }catch(e){
          console.error("[audit] flatten paper error:", e);
          setAuditStatus({ok:false,msg:`✗ Audit falhou: ${String(e)}`});
        }
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
      console.log("[flatten] ibkr-orders response:", JSON.stringify({ok:j.ok,status:j.status,submitted:j.submitted,fills_len:(j.fills??[]).length}));
      if(resp.ok&&j.status!=="rejected"&&j.status!=="error"){
        setFlatResult({ref:j.order_ref||"ORD-"+Date.now().toString(36).toUpperCase(),longs:longs.length,shorts:shorts.length});
        setFlatFills(j.fills??[]);
        setIbkrPos(null);  // force refresh
        // Audit: log flatten approval + orders
        setAuditStatus(null);
        const sentFlat2=[
          ...longs.map(p=>({ticker:p.ticker,side:"SELL" as const,requested_qty:p.qty,ib_order_id:null})),
          ...shorts.map(p=>({ticker:p.ticker,side:"BUY" as const,requested_qty:Math.abs(p.qty),ib_order_id:null})),
        ];
        // Use sentFlat2 for correct side (longs→SELL, shorts→BUY); enrich with IB order IDs from fills
        const ibFillMap2=new Map((j.fills??[] as Record<string,unknown>[]).map(f=>[String(f.ticker??"").toUpperCase(),f.ib_order_id as number|null]));
        const fillsForAudit=sentFlat2.map(o=>({...o,ib_order_id:ibFillMap2.get(o.ticker.toUpperCase())??null}));
        try{
          console.log("[audit] flatten: saving approval, clientId=", auditClientId(), "fills=", fillsForAudit.length);
          const approvalId = await auditSaveApproval(null);
          await auditSaveOrders(approvalId, fillsForAudit);
          // Log executions with real fill values
          void auditSaveExecutions((j.fills??[]).map((f:Record<string,unknown>)=>({
            ticker:String(f.ticker??""),action:String(f.action??""),
            filled:Number(f.filled??0)||0,avg_fill_price:Number(f.avg_fill_price??0)||null,
            value_eur:Number(f.value_eur??0)||null,ib_order_id:Number(f.ib_order_id??0)||null,
          })));
          setAuditStatus({ok:true,msg:`✓ Audit guardado · ${fillsForAudit.length} ordens · approvalId=${approvalId??"null"}`});
        }catch(e){
          console.error("[audit] flatten error:", e);
          setAuditStatus({ok:false,msg:`✗ Audit falhou: ${String(e)}`});
        }
        void fetch("/api/audit/config-change",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({
          client_id: auditClientId(), changed_by:"client", change_type:"flatten_all",
          new_value:{ref:j.order_ref, longs:longs.length, shorts:shorts.length}, changed_at: new Date().toISOString(),
        })}).catch(()=>{});
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
    // Use value_eur (EUR-converted) when available; fall back to native value (pre-fix snapshots)
    (ibkrPos??[]).forEach(p=>m.set(p.ticker.toUpperCase(), p.value_eur ?? p.value));
    return m;
  },[ibkrPos]);
  const totalHeldEur=React.useMemo(()=>
    Array.from(ibkrHoldingsMap.values()).reduce((s,v)=>s+Math.abs(v),0)
  ,[ibkrHoldingsMap]);

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

  // Hard cash cap for BUY orders.
  // Total BUY notional is capped at BUY_SAFETY_FACTOR × AUM regardless of model weights.
  // This covers:
  //   • leveraged models whose weights sum to >100%
  //   • price movements between calculation and execution
  //   • bid-ask spread + whole-share rounding
  // Clients without a margin account will never overshoot their cash balance.
  // SELL orders are NOT reduced.
  const BUY_SAFETY_FACTOR = 0.97;

  const adjustedOrderRows:AdjRow[]=React.useMemo(()=>{
    // ── Pass 1: compute raw targets & held amounts ──────────────────────────
    const rows = orderRows.map(r=>{
      const isFullExit=r.action==="Vender";
      const isSell=execMode==="full"?isFullExit:(r.action==="Vender"||r.action==="Reduzir");
      const rawTarget=execMode==="full"
        ? (isFullExit?r.prev/100*aum:r.cur/100*aum)
        : Math.abs(r.delta)/100*aum;
      const ibTicker=toIbTicker(r.ticker);
      const heldEur=ibkrHoldingsMap.get(ibTicker)??ibkrHoldingsMap.get(r.ticker.toUpperCase())??0;
      return {r, isSell, rawTarget, ibTicker, heldEur};
    });

    // ── Pass 2: compute scale factor so total BUY ≤ BUY_SAFETY_FACTOR × AUM ─
    // In full mode rawTarget = cur/100*aum (≈100% aum after normalisation).
    // In delta mode rawTarget = |delta|/100*aum which can be << aum.
    // Use cur-weights total as the scaling reference so that full-mode builds from
    // a zero portfolio never invest more than budgetEur regardless of mode.
    const rawCurTotal = rows.reduce((s,{isSell,r})=>isSell?s:s+r.cur/100*aum, 0);
    const rawBuyTotal = rows.reduce((s,{isSell,rawTarget})=>isSell?s:s+rawTarget, 0);
    const budgetEur = aum * BUY_SAFETY_FACTOR;
    // Scale relative to cur-weight total (catches zero-portfolio full-mode over-investment)
    const rawForScale = Math.max(rawBuyTotal, rawCurTotal);
    const buyScale = rawForScale > budgetEur ? budgetEur / rawForScale : 1;

    // ── Pass 2.5: total currently held across ALL IB positions ───────────────
    // totalHeldEur is computed in the outer useMemo (ibkrHoldingsMap scope) and
    // captured here via closure — no need to recompute.
    // remainingBudget: only meaningful in full-mode (initial build from zero).
    // In delta mode the position-level effectiveTarget−heldEur logic already prevents
    // over-investment, and blocking all buys would break normal monthly rebalancing.
    const remainingBudget = execMode==="full"
      ? Math.max(0, budgetEur - totalHeldEur)
      : budgetEur; // delta mode: no global cap (per-position cap applies)

    // ── Pass 3: apply scale, deduct holdings, apply skip rules ───────────────
    return rows.map(({r, isSell, rawTarget, ibTicker, heldEur})=>{
      const targetEur = isSell ? rawTarget : rawTarget * buyScale;
      let adjEur=targetEur;
      let skipReason:string|undefined;
      if(!isSell){
        // Hard cap (full-mode only): if already invested ≥ plan budget, block new buys
        if(remainingBudget<=0){
          adjEur=0;
          skipReason="Carteira no plano ou acima";
        } else if(pendingBuyTickers.has(ibTicker.toUpperCase())||pendingBuyTickers.has(r.ticker.toUpperCase())){
          adjEur=0;
          skipReason="Ordem de compra em curso na IB";
        } else if(heldEur>0){
          const effectiveTarget=execMode==="full"?targetEur:(r.cur/100*aum*buyScale);
          adjEur=Math.max(0, effectiveTarget-heldEur);
          if(adjEur<MIN_ORDER_EUR)skipReason=adjEur<=0?"Já no alvo ou acima":"Incremento < €"+MIN_ORDER_EUR;
        }
      }
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
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[orderRows,execMode,aum,ibkrHoldingsMap,totalHeldEur,pendingBuyTickers]);

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
  const budgetEurForDisplay=aum*BUY_SAFETY_FACTOR;
  const investOverBudget=investEur>budgetEurForDisplay+100; // >€100 tolerance

  // ── Audit helpers ──────────────────────────────────────────────────────
  function auditClientId(): string | null {
    // 1. Client session (logged-in client)
    if (sessionUser) return sessionUser;
    try {
      // 2. Client session from localStorage
      const clientSession = localStorage.getItem("decide_client_session_user");
      if (clientSession) return clientSession;
      // 3. IBKR account code (e.g. "DUM504002") — set when snapshot is fetched
      const acct = ibkrAcctCode || localStorage.getItem("decide_ibkr_acct_code");
      if (acct) return acct;
    } catch { /* ignore */ }
    return null;
  }

  async function auditSaveRecommendation(): Promise<string|null> {
    const clientId = auditClientId() ?? "unknown";
    try {
      const positions = actionCounts.allRows.map(r => ({
        ticker: r.ticker, weightPct: r.cur, prev: r.prev, action: r.action,
      }));
      const r = await fetch("/api/audit/recommendation", {
        method: "POST", headers: {"Content-Type":"application/json"},
        body: JSON.stringify({
          client_id: clientId,
          risk_profile: profileLabel,
          model_version: "CAP15",
          positions,
        }),
      });
      const j = await r.json() as {ok?:boolean;id?:string};
      return j.ok && j.id ? j.id : null;
    } catch { return null; }
  }

  async function auditSaveApproval(recommendationId: string|null): Promise<string|null> {
    const clientId = auditClientId() ?? "unknown";
    console.log("[audit] auditSaveApproval called, clientId=", clientId);
    const r = await fetch("/api/audit/approval", {
      method: "POST", headers: {"Content-Type":"application/json"},
      body: JSON.stringify({ client_id: clientId, recommendation_id: recommendationId, action: "approved" }),
    });
    const j = await r.json() as {ok?:boolean;id?:string;error?:string};
    console.log("[audit] approval response:", r.status, JSON.stringify(j));
    if (!r.ok || !j.ok) throw new Error(`approval HTTP ${r.status}: ${j.error ?? "?"}`);
    return j.id ?? null;
  }

  async function auditSaveOrders(
    approvalId: string|null,
    fills: Array<{ticker:string;side?:string;action?:string;requested_qty?:number;ib_order_id?:number|null}>,
  ) {
    const clientId = auditClientId() ?? "unknown";
    if (!fills.length) return;
    console.log(`[audit] auditSaveOrders: clientId=${clientId} fills=${fills.length} approvalId=${approvalId}`);
    const results = await Promise.allSettled(fills.map(f => {
      // action takes priority (order intent); side is fallback (may reflect position direction)
      const a = (f.action ?? "").toLowerCase();
      const s = (f.side ?? "").toUpperCase();
      const side: "BUY"|"SELL" =
        (a === "comprar" || a === "buy") ? "BUY" :
        (a === "vender" || a === "reduzir" || a === "sell") ? "SELL" :
        s === "SELL" ? "SELL" : "BUY";
      return fetch("/api/audit/order", {
        method: "POST", headers: {"Content-Type":"application/json"},
        body: JSON.stringify({
          client_id: clientId,
          approval_id: approvalId,
          ticker: f.ticker,
          side,
          qty: f.requested_qty ?? null,
          ibkr_order_id: f.ib_order_id ? String(f.ib_order_id) : null,
          status: "submitted",
          submitted_at: new Date().toISOString(),
        }),
      }).then(async r => {
        const j = await r.json().catch(() => ({})) as {ok?:boolean;error?:string};
        if (!r.ok || !j.ok) throw new Error(`HTTP ${r.status}: ${j.error ?? "unknown"}`);
        return j;
      });
    }));
    const failed = results.filter(r => r.status === "rejected");
    if (failed.length > 0) {
      const reasons = failed.map(r => (r as PromiseRejectedResult).reason as string).join("; ");
      console.error(`[audit] ${failed.length}/${fills.length} order saves failed:`, reasons);
      throw new Error(`${failed.length} order(s) failed: ${reasons}`);
    }
    console.log(`[audit] auditSaveOrders: all ${fills.length} saved OK`);
  }

  // IB Tiered commission: 0.05% of EUR trade value, min €1.25 per fill
  function ibCommission(valueEur: number): number {
    return Math.max(1.25, valueEur * 0.0005);
  }

  // Log real executions (with IB commission computed from fill value) into execution_logs.
  // Best-effort: fires-and-forgets individual failures without throwing.
  async function auditSaveExecutions(
    fills: Array<{ticker:string;filled?:number;avg_fill_price?:number|null;value_eur?:number|null;ib_order_id?:number|null;action?:string;side?:string}>,
  ) {
    const clientId = auditClientId() ?? "unknown";
    console.log(`[audit] auditSaveExecutions: ${fills.length} fills, clientId=${clientId}`, fills.map(f=>({t:f.ticker,filled:f.filled,val:f.value_eur})));
    if (!fills.length) return;
    // Include all fills that have at least a ticker — even PreSubmitted orders (filled=0)
    // so they appear in execution_logs; commission will be null until IB sync fills the data.
    const execFills = fills.filter(f => f.ticker && f.ticker.length > 0 && f.ticker !== "EUR/USD");
    console.log(`[audit] execFills after filter: ${execFills.length}/${fills.length}`);
    if (!execFills.length) return;
    await Promise.allSettled(execFills.map(f => {
      const a = (f.action ?? "").toLowerCase();
      const s = (f.side ?? "").toUpperCase();
      const side: "BUY"|"SELL" =
        (a === "comprar" || a === "buy") ? "BUY" :
        (a === "vender" || a === "reduzir" || a === "sell") ? "SELL" :
        s === "SELL" ? "SELL" : "BUY";
      const isFilled = (f.filled ?? 0) > 0;
      const valueEur = f.value_eur ?? (f.filled && f.avg_fill_price ? f.filled * f.avg_fill_price : 0);
      const commission = valueEur > 0 ? ibCommission(valueEur) : null;
      return fetch("/api/audit/execution", {
        method: "POST", headers: {"Content-Type":"application/json"},
        body: JSON.stringify({
          client_id: clientId,
          ticker: f.ticker,
          side,
          qty_filled: isFilled ? f.filled : null,
          price_executed: f.avg_fill_price ?? null,
          commission,
          fill_status: isFilled ? "filled" : "presubmitted",
          ibkr_exec_id: f.ib_order_id ? String(f.ib_order_id) : null,
          executed_at: new Date().toISOString(),
        }),
      }).then(async r => {
        const j = await r.json().catch(()=>({})) as {ok?:boolean;error?:string};
        if (!r.ok || !j.ok) console.error(`[audit] execution save HTTP ${r.status}:`, j.error ?? "unknown");
        else console.log(`[audit] execution saved: ${f.ticker} ${side} filled=${f.filled??0}`);
      }).catch(e => console.warn("[audit] execution save failed:", e));
    }));
  }
  // ───────────────────────────────────────────────────────────────────────

  async function submitOrders() {
    setErrMsg("");
    setShowSendConfirm(false);
    setSending(true);
    // Save recommendation snapshot + approval before sending to IB
    const recId = await auditSaveRecommendation();
    const approvalId = await auditSaveApproval(recId);
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
        const fills:Array<{ticker:string;side:string;qty:number;ib_order_id?:number|null}>=j.fills??[];
        // Save audit order logs — fall back to activeOrderRows if IB returns no fills (PreSubmitted)
        const fillsForAudit=fills.length>0?fills:activeOrderRows.map(r=>({
          ticker:r.ticker,
          side:(r.action==="Vender"||r.action==="Reduzir"?"SELL":"BUY"),
          qty:r.adjEur,ib_order_id:null,
        }));
        void auditSaveOrders(approvalId, fillsForAudit);
        // Log executions with real fill values (commission from value_eur)
        void auditSaveExecutions((j.fills??[]).map((f:Record<string,unknown>)=>({
          ticker:String(f.ticker??""),action:String(f.action??""),side:String(f.side??""),
          filled:Number(f.filled??0)||0,avg_fill_price:Number(f.avg_fill_price??0)||null,
          value_eur:Number(f.value_eur??0)||null,ib_order_id:Number(f.ib_order_id??0)||null,
        })));
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

  const [execMethod,setExecMethod]=React.useState("smart");
  const [showAlertas,setShowAlertas]=React.useState(false);
  const [showExposicao,setShowExposicao]=React.useState(false);

  return (
    <div className="flex flex-col h-full bg-[#07090f] -m-4 lg:-m-6">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="bg-[#07090f] border-b border-[#1a1f2e] px-4 sm:px-6 lg:px-8 py-4 lg:py-5 shrink-0">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h1 className="text-lg lg:text-xl font-bold text-slate-100">Confirmar e enviar ordens</h1>
            <p className="text-xs lg:text-sm text-slate-400 mt-1">Valide os detalhes da nova ordem antes de a submeter ao sistema.</p>
          </div>
          <span className="text-xs text-slate-500 mt-1 shrink-0">1 de 1</span>
        </div>
        {/* Progress steps — scroll on mobile */}
        <div className="flex items-center overflow-x-auto scrollbar-none pb-1">
          {[
            {label:"Seleção da Carteira",done:true},
            {label:"Revisão e validação",done:true},
            {label:"Confirmação",active:true},
          ].map((s,i)=>(
            <React.Fragment key={s.label}>
              <div className="flex items-center gap-1.5 shrink-0">
                <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold border-2 transition-colors ${s.done?"bg-emerald-600 border-emerald-500 text-white":"bg-blue-600 border-blue-500 text-white"}`}>
                  {s.done?<CheckCircle2 size={12}/>:<span className="w-2 h-2 rounded-full bg-white inline-block"/>}
                </div>
                <span className={`text-xs font-semibold whitespace-nowrap ${s.done?"text-emerald-400":"text-slate-100"}`}>{s.label}</span>
              </div>
              {i<2&&<div className="flex-1 h-px bg-[#1a1f2e] mx-3 min-w-4"/>}
            </React.Fragment>
          ))}
        </div>
      </div>

      {/* ── Body: two-column layout (stacks on mobile) ───────────────────── */}
      <div className="flex flex-col lg:flex-row flex-1 min-h-0">

        {/* LEFT COLUMN — scrollable main content */}
        <div className="flex-1 overflow-y-auto px-4 lg:px-6 py-5 space-y-4">

          {/* O que mais a confirmar */}
          <div className="bg-[#0b0f1a] border border-[#1a1f2e] rounded-xl p-5">
            <div className="font-semibold text-slate-200 text-sm mb-4">O que mais a confirmar</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {[
                {icon:<ShieldCheck size={15} className="text-blue-400"/>,title:"Validação das ordens",desc:"Serão validadas a conformidade, disponibilidade de liquidez e regras de investimento."},
                {icon:<Activity size={15} className="text-blue-400"/>,title:"Impacto na carteira e risco",desc:"Serão confirmados os limites de risco impostos na carteira e o impacto nas novas ordens."},
                {icon:<Send size={15} className="text-blue-400"/>,title:"Execução",desc:"As ordens serão enviadas para a Interactive Brokers para execução ao melhor preço."},
                {icon:<CheckCircle2 size={15} className="text-blue-400"/>,title:"Notificação",desc:"Será enviada uma notificação após a conclusão das ordens."},
              ].map(x=>(
                <div key={x.title} className="flex gap-3">
                  <div className="w-8 h-8 rounded-lg bg-blue-600/10 border border-blue-500/20 flex items-center justify-center shrink-0">{x.icon}</div>
                  <div>
                    <div className="text-xs font-semibold text-slate-200">{x.title}</div>
                    <div className="text-[11px] text-slate-500 mt-0.5 leading-snug">{x.desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Lista de ordens */}
          <div className="bg-[#0b0f1a] border border-[#1a1f2e] rounded-xl p-5">
            <div className="flex items-start justify-between mb-3">
              <div>
                <div className="font-semibold text-slate-200 text-sm">Lista de ordens</div>
                <div className="text-[10px] text-slate-500 mt-0.5">Reveja todas as ordens antes de confirmar. Pode expandir cada ordem para ver mais detalhes.</div>
              </div>
              <div className="text-right shrink-0 ml-4">
                <div className="text-xs font-bold text-slate-100">Total em EUR · € {fmtEm(investEur+reduceEur)}</div>
                <div className="text-[10px] text-slate-500">{nOrdens} ordens</div>
              </div>
            </div>
            {/* execMode toggle */}
            <div className="flex rounded-lg border border-[#252a3a] overflow-hidden text-[10px] font-semibold mb-3">
              <button onClick={()=>setExecMode("full")}
                className={`flex-1 px-3 py-1.5 transition-colors ${execMode==="full"?"bg-blue-600 text-white":"text-slate-400 hover:text-slate-200"}`}
                title="Construção inicial: compra todas as posições ao peso-alvo. Ideal para conta vazia.">
                Construção inicial
              </button>
              <button onClick={()=>setExecMode("delta")}
                className={`flex-1 px-3 py-1.5 transition-colors border-l border-[#252a3a] ${execMode==="delta"?"bg-blue-600 text-white":"text-slate-400 hover:text-slate-200"}`}
                title="Rebalanceamento: envia apenas as ordens com alteração ≥ 1 pp face ao mês anterior.">
                Rebalanceamento
              </button>
            </div>
            <div className="text-[10px] text-sky-400/70 mb-3 flex items-center gap-1.5 bg-sky-500/5 border border-sky-500/15 rounded-lg px-3 py-1.5">
              <Info size={10} className="shrink-0"/>
              <span>Total de compras limitado a <strong>{Math.round(BUY_SAFETY_FACTOR*100)}%</strong> do plano (≤ € {fmtE(aum*BUY_SAFETY_FACTOR)}) — reserva de {Math.round((1-BUY_SAFETY_FACTOR)*100)}% em cash.</span>
            </div>
            <div className="overflow-x-auto -mx-1">
            <table className="w-full text-xs">
              <thead><tr className="text-slate-500 border-b border-[#1a1f2e] text-left">
                <th className="pb-2 font-semibold">Ticker</th>
                <th className="pb-2 font-semibold">Acção</th>
                <th className="pb-2 font-semibold text-right">Valor</th>
                <th className="pb-2 font-semibold text-right hidden sm:table-cell">Preço</th>
                <th className="pb-2 font-semibold text-right hidden sm:table-cell">Impacto</th>
                <th className="pb-2 font-semibold text-center">Status</th>
              </tr></thead>
              <tbody>
                {allPlanRows.map(r=>{
                  const isManter=r.action==="Manter";
                  const isBuy=r.action==="Comprar";
                  const isUp=r.action==="Aumentar";
                  const isSell=r.action==="Vender";
                  const inExec=activeOrderRows.some(x=>x.ticker===r.ticker);
                  const notOrderable=!isOrderable(r.ticker);
                  const adjRow=adjustedOrderRows.find(x=>x.ticker===r.ticker);
                  const skipped=adjRow?.skipReason;
                  const displayVal=adjRow?adjRow.adjEur:(execMode==="full"?(isSell?r.prev/100*aum:r.cur/100*aum):Math.abs(r.delta)/100*aum);
                  const refP=prices[r.ticker]??prices[toIbTicker(r.ticker)]??null;
                  const acBg=isManter?"bg-slate-700/20 text-slate-500 border-slate-700/30":
                    isBuy?"bg-emerald-500/15 text-emerald-300 border-emerald-500/30":
                    isUp?"bg-cyan-500/15 text-cyan-300 border-cyan-500/30":
                    isSell?"bg-red-500/15 text-red-300 border-red-500/30":
                    "bg-amber-500/15 text-amber-300 border-amber-500/30";
                  return (
                    <tr key={r.ticker} className={`border-b border-[#111520] hover:bg-white/[0.02] transition-colors ${(isManter&&execMode==="delta")||notOrderable||skipped?"opacity-40":""}`}>
                      <td className="py-2.5">
                        <div className="flex items-center gap-1.5">
                          <a href={`https://finance.yahoo.com/quote/${getYFTicker(r.ticker)}`} target="_blank" rel="noopener noreferrer"
                            className={`font-bold hover:underline ${inExec?"text-slate-100":skipped?"text-slate-600":"text-slate-500"}`}>{displayTicker(r.ticker)}</a>
                          {notOrderable&&<span className="text-[9px] text-amber-600" title="Não listada nos EUA">⚠</span>}
                          {!notOrderable&&toIbTicker(r.ticker)!==r.ticker.toUpperCase()&&
                            <span className="text-[9px] text-sky-500" title={`IB: ${toIbTicker(r.ticker)}`}>→{toIbTicker(r.ticker)}</span>}
                        </div>
                        {skipped&&<div className="text-[9px] text-slate-600 mt-0.5">{adjRow?.skipReason}</div>}
                      </td>
                      <td className="py-2.5">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border ${acBg}`}>
                          {r.action}
                        </span>
                      </td>
                      <td className="py-2.5 text-right font-mono">
                        {inExec&&!skipped?(
                          <span className="text-slate-200">€ {fmtEm(displayVal)}</span>
                        ):<span className="text-slate-600">—</span>}
                      </td>
                      <td className="py-2.5 text-right font-mono text-slate-400 text-[10px] hidden sm:table-cell">
                        {refP?`${refP.price.toFixed(2)}`:"—"}
                      </td>
                      <td className={`py-2.5 text-right font-semibold font-mono hidden sm:table-cell ${r.delta>0?"text-emerald-400":r.delta<0?"text-red-400":"text-slate-600"}`}>
                        {r.delta!==0?`${r.delta>0?"+":""}${r.delta.toFixed(2)}%`:"—"}
                      </td>
                      <td className="py-2.5 text-center">
                        {inExec&&!skipped?(
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-sky-500/15 text-sky-300 border border-sky-500/30">A enviar</span>
                        ):skipped?(
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-700/30 text-slate-500 border border-slate-700/30">Ignorar</span>
                        ):notOrderable?(
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-500/15 text-amber-400 border border-amber-500/30">Não-US</span>
                        ):(
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-700/20 text-slate-600 border border-slate-700/20">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-[#252a3a] bg-[#080c14]">
                  <td colSpan={3} className="py-2.5 text-xs font-bold text-slate-400">
                    {nOrdens} ordens a enviar
                    {ibkrPos&&execMode==="full"&&<span className="ml-1.5 text-[10px] font-normal text-sky-400">· ajustado vs carteira IB</span>}
                  </td>
                  <td colSpan={2} className="py-2.5 text-right text-[10px] text-slate-500">
                    Comissões est.: <span className="font-semibold text-slate-300">€ {fmtE(tradeCost)}</span>
                  </td>
                  <td className="py-2.5 text-right text-xs font-black text-emerald-400 pr-1">
                    € {fmtEm(investEur+reduceEur)}
                  </td>
                </tr>
              </tfoot>
            </table>
            </div>{/* end overflow-x-auto */}
            <div className="flex items-center justify-between mt-3 pt-3 border-t border-[#1a1f2e]">
              <button onClick={onBack} className="text-xs text-sky-400 hover:text-sky-300 transition-colors">Ver recomendações</button>
              <span className="text-[10px] text-slate-600">Estimativa de comissões ({nOrdens>0&&(investEur+reduceEur)>0?(tradeCost/(investEur+reduceEur)*100).toFixed(3):"0.000"}%): € {fmtE(tradeCost)}</span>
            </div>
          </div>

          {/* Alertas e validações — collapsible */}
          <div className="bg-[#0b0f1a] border border-[#1a1f2e] rounded-xl overflow-hidden">
            <button onClick={()=>setShowAlertas(v=>!v)} className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-white/[0.02] transition-colors">
              <div className="flex items-center gap-2">
                <AlertTriangle size={14} className="text-amber-400 shrink-0"/>
                <span className="text-xs font-semibold text-slate-200">Alertas e validações</span>
                {[investOverBudget, !ibkrPos&&!ibkrLoading&&!done, recentlySent].filter(Boolean).length>0&&(
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-500/15 text-amber-400 border border-amber-500/30">
                    {[investOverBudget,!ibkrPos&&!ibkrLoading&&!done,recentlySent].filter(Boolean).length}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-sky-400 hover:text-sky-300">Ver detalhes</span>
                <span className="text-slate-600 text-xs ml-2">{showAlertas?"▲":"▼"}</span>
              </div>
            </button>
            {showAlertas&&(
              <div className="px-5 pb-4 space-y-3 border-t border-[#1a1f2e] pt-3">
                {/* Budget */}
                <div className={`rounded-lg border px-3 py-2.5 text-[11px] space-y-1.5 ${investOverBudget?"border-red-600/60 bg-red-950/30":"border-slate-700/50 bg-slate-800/40"}`}>
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-slate-300">Diagnóstico de budget</span>
                    <span className="text-slate-500 text-[10px]">pesos: {adjustedOrderRows.reduce((s,r)=>s+r.cur,0).toFixed(1)}%</span>
                  </div>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                    <span className="text-slate-400">AUM: <strong className="text-slate-100">€{aum.toLocaleString("pt-PT",{maximumFractionDigits:0})}</strong></span>
                    <span className="text-slate-400">Budget {Math.round(BUY_SAFETY_FACTOR*100)}%: <strong className="text-slate-200">€{(aum*BUY_SAFETY_FACTOR).toLocaleString("pt-PT",{maximumFractionDigits:0})}</strong></span>
                    <span className="text-slate-400">A investir: <strong className={investOverBudget?"text-red-400 font-black":"text-emerald-400"}>€{investEur.toLocaleString("pt-PT",{maximumFractionDigits:0})}</strong>{investOverBudget&&<span className="text-red-400 ml-1">⚠</span>}</span>
                    <span className="text-slate-400">Já na IB: <strong className={totalHeldEur>aum*1.05?"text-amber-400":"text-slate-200"}>€{totalHeldEur.toLocaleString("pt-PT",{maximumFractionDigits:0})}</strong></span>
                  </div>
                  {investOverBudget&&<p className="text-red-300 text-[10px] font-semibold">⚠ Total a investir excede o budget. Verifica o campo "Montante plano (€)".</p>}
                </div>
                {/* Mode info */}
                {execMode==="full"?(
                  <div className="flex items-start gap-2 bg-amber-500/[0.06] border border-amber-500/20 rounded-lg px-3 py-2.5 text-xs">
                    <AlertTriangle size={12} className="text-amber-400 shrink-0 mt-0.5"/>
                    <div>
                      <div className="font-semibold text-amber-300 mb-0.5">Construção inicial</div>
                      <div className="text-slate-400">Compra apenas a diferença entre o peso-alvo e o que já tens em carteira. Posições acima do alvo não são reduzidas.</div>
                    </div>
                  </div>
                ):(
                  <div className="flex items-start gap-2 bg-blue-500/[0.06] border border-blue-500/20 rounded-lg px-3 py-2.5 text-xs">
                    <Info size={12} className="text-blue-400 shrink-0 mt-0.5"/>
                    <div>
                      <div className="font-semibold text-blue-300 mb-0.5">Rebalanceamento mensal</div>
                      <div className="text-slate-400">Apenas posições com variação ≥ 1 pp face ao mês anterior são enviadas.</div>
                    </div>
                  </div>
                )}
                {/* IB status */}
                {ibkrLoading&&!ibkrPos&&(
                  <div className="flex items-center gap-2 bg-sky-500/10 border border-sky-500/30 rounded-lg px-3 py-2.5 text-xs text-sky-300">
                    <span className="animate-spin text-sm">⟳</span>
                    <span className="font-semibold">A verificar carteira e ordens pendentes na IB…</span>
                  </div>
                )}
                {!ibkrPos&&!ibkrLoading&&!done&&(
                  <div className="flex items-start gap-2 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2.5 text-xs text-amber-300">
                    <AlertTriangle size={12} className="shrink-0 mt-0.5"/>
                    <div>
                      <span className="font-semibold">Não foi possível verificar a carteira IB automaticamente.</span>
                      <button onClick={fetchIbkrPositions} disabled={ibkrLoading} className="ml-2 underline hover:no-underline disabled:opacity-50">Tentar de novo</button>
                    </div>
                  </div>
                )}
                {ibkrPos&&ibkrOpenOrders.length>0&&!done&&(
                  <div className="flex items-center gap-2 bg-sky-500/10 border border-sky-500/30 rounded-lg px-3 py-2.5 text-xs text-sky-300">
                    <Info size={12} className="shrink-0"/>
                    <span><strong>{ibkrOpenOrders.filter(o=>o.side==="BUY").length}</strong> ordem(ns) BUY pendente(s) — excluídas do novo cálculo automaticamente.</span>
                  </div>
                )}
                {ibkrPos&&!done&&(()=>{
                  const ibNav=ibkrPos.reduce((s,p)=>s+Math.abs(p.value_eur??p.value),0);
                  if(ibNav<=aum*1.5) return null;
                  return (
                    <div className="flex items-start gap-2 bg-red-500/10 border border-red-500/40 rounded-lg px-3 py-2.5 text-xs text-red-300">
                      <AlertTriangle size={12} className="shrink-0 mt-0.5"/>
                      <span><strong>Carteira acumulada ({(ibNav/aum*100).toFixed(0)}% do objectivo)</strong> — não é seguro rebalancear. Usa "Zerar toda a carteira (FLAT)" no Diagnóstico abaixo.</span>
                    </div>
                  );
                })()}
                {recentlySent&&lastSent&&(
                  <div className="flex items-start gap-2 bg-red-950/60 border border-red-700/60 rounded-lg px-3 py-2.5 text-xs text-red-300">
                    <AlertTriangle size={12} className="shrink-0 mt-0.5"/>
                    <div className="flex-1">
                      <span className="font-semibold">Ordens enviadas há {Math.round((Date.now()-lastSent.ts)/60000)} min (ref: <code className="font-mono">{lastSent.ref}</code>). Enviar de novo pode <strong>duplicar posições</strong>.</span>
                    </div>
                    <button onClick={()=>{try{localStorage.removeItem(ORDERS_SENT_KEY);}catch{}setLastSent(null);}} className="text-[10px] text-red-400 hover:text-red-300 underline shrink-0">Ignorar</button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Exposição e limites — collapsible */}
          <div className="bg-[#0b0f1a] border border-[#1a1f2e] rounded-xl overflow-hidden">
            <button onClick={()=>setShowExposicao(v=>!v)} className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-white/[0.02] transition-colors">
              <div className="flex items-center gap-2">
                <Activity size={14} className="text-slate-400 shrink-0"/>
                <span className="text-xs font-semibold text-slate-200">Exposição e limites após execução (estimada)</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-sky-400 hover:text-sky-300">Ver detalhes</span>
                <span className="text-slate-600 text-xs ml-2">{showExposicao?"▲":"▼"}</span>
              </div>
            </button>
            {showExposicao&&(
              <div className="px-5 pb-4 border-t border-[#1a1f2e] pt-3 space-y-3">
                <div className="grid grid-cols-3 gap-3 text-center">
                  {[
                    {label:"Total a investir",val:`€ ${fmtE(investEur)}`,c:"text-emerald-400"},
                    {label:"Total a reduzir",val:`€ ${fmtE(reduceEur)}`,c:"text-red-400"},
                    {label:"NAV referência",val:`€ ${fmtE(aum)}`,c:"text-slate-200"},
                  ].map(k=>(
                    <div key={k.label} className="bg-[#111827] rounded-lg px-3 py-2.5 border border-[#1a1f2e]">
                      <div className="text-[9px] text-slate-500 mb-1">{k.label}</div>
                      <div className={`text-sm font-bold ${k.c}`}>{k.val}</div>
                    </div>
                  ))}
                </div>
                <div className="text-[11px] text-slate-500 space-y-1.5 border-t border-[#1a1f2e] pt-3">
                  <div className="flex justify-between"><span>Perfil de risco</span><span className="text-slate-300 font-semibold">{profileLabel}</span></div>
                  <div className="flex justify-between"><span>Exposição FX</span><span className="text-slate-300 font-semibold capitalize">{ibkrFxBlocked?"Conta Caixa — hedge desativado":fxExposure}</span></div>
                  <div className="flex justify-between"><span>Margem</span><span className={`font-semibold ${marginEnabled?"text-amber-400":"text-slate-400"}`}>{marginEnabled?"Ativa":"Desativada"}</span></div>
                  <div className="flex justify-between"><span>Modo</span><span className={`font-semibold ${paperMode?"text-amber-400":"text-emerald-400"}`}>{paperMode?"Simulação local":"Envia à IB"}</span></div>
                </div>
              </div>
            )}
          </div>

          {/* Método de execução */}
          {!done&&(
            <div className="bg-[#0b0f1a] border border-[#1a1f2e] rounded-xl p-5">
              <div className="font-semibold text-slate-200 text-sm mb-3">Método de execução</div>
              <div className="grid grid-cols-2 gap-2">
                {([
                  {id:"smart",label:"Smart",badge:"Recomendado",desc:"Rota automaticamente para o melhor preço disponível combinando estratégias globais."},
                  {id:"vwap",label:"VWAP",badge:null,desc:"Divide a ordem ao longo do dia seguindo o volume, reduzindo impacto de mercado."},
                  {id:"twap",label:"TWAP",badge:null,desc:"Divide a ordem em intervalos regulares de tempo. Bom para ativos com volumes irregulares."},
                  {id:"immediate",label:"Execução imediata",badge:null,desc:"Executa ao preço de mercado imediato. Melhor para ordens urgentes em mercados líquidos."},
                ] as {id:string;label:string;badge:string|null;desc:string}[]).map(m=>(
                  <label key={m.id} onClick={()=>setExecMethod(m.id)} className={`flex gap-3 p-3 rounded-xl border cursor-pointer transition-all ${execMethod===m.id?"border-blue-500/50 bg-blue-600/10":"border-[#1a1f2e] bg-[#080c14] hover:border-[#252a3a]"}`}>
                    <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 mt-0.5 ${execMethod===m.id?"border-blue-500":"border-slate-600"}`}>
                      {execMethod===m.id&&<div className="w-2 h-2 rounded-full bg-blue-500"/>}
                    </div>
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span className={`text-xs font-semibold ${execMethod===m.id?"text-blue-300":"text-slate-300"}`}>{m.label}</span>
                        {m.badge&&<span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">{m.badge}</span>}
                      </div>
                      <p className="text-[10px] text-slate-500 mt-0.5 leading-snug">{m.desc}</p>
                    </div>
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* Confirmation + submit */}
          {!done&&!showSendConfirm&&(
            <div className="bg-[#0b0f1a] border border-[#1a1f2e] rounded-xl p-5 space-y-4">
              <div className="font-semibold text-slate-200 text-sm">Confirmação e envio</div>
              <div className="text-[11px] text-slate-500">Confirme todas as ordens e clique no botão abaixo para enviar as ordens para execução.</div>

              {/* Summary grid */}
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-[#111827] rounded-xl px-4 py-3 border border-[#1a1f2e] text-center">
                  <div className="text-[9px] text-slate-500 mb-1">Total de ordens</div>
                  <div className="text-xl font-black text-slate-100">{nOrdens}</div>
                </div>
                <div className="bg-[#111827] rounded-xl px-4 py-3 border border-[#1a1f2e] text-center">
                  <div className="text-[9px] text-slate-500 mb-1">Valor total</div>
                  <div className="text-sm font-black text-emerald-400">€ {fmtE(investEur)}</div>
                </div>
                <div className="bg-[#111827] rounded-xl px-4 py-3 border border-[#1a1f2e] text-center">
                  <div className="text-[9px] text-slate-500 mb-1">Comissões estimadas</div>
                  <div className="text-sm font-black text-slate-300">€ {fmtE(tradeCost)}</div>
                </div>
              </div>

              {/* Paper mode toggle */}
              <div className="flex items-center justify-between py-2.5 px-3 bg-[#080c14] rounded-xl border border-[#1a1f2e]">
                <div>
                  <div className="text-xs font-semibold text-slate-300">Simulação local (não envia à IB)</div>
                  <div className="text-[10px] text-slate-500">Ligado = animação local · Desligado = envia ordens à IB Gateway</div>
                </div>
                <button onClick={()=>setPaperMode(v=>!v)}
                  className={`w-11 h-6 rounded-full transition-colors relative shrink-0 ml-4 ${paperMode?"bg-blue-600":"bg-slate-700"}`}>
                  <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${paperMode?"translate-x-5":"translate-x-0.5"}`}/>
                </button>
              </div>

              {/* Checkboxes */}
              <div className="space-y-2.5">
                {[
                  "Confirmo que todas as ordens e entendo os seus impactos.",
                  "Confirmo que esta ação cumpre a minha política de investimento.",
                  "Quero receber uma notificação quando todas as ordens forem executadas.",
                ].map((text,ci)=>(
                  <label key={ci} onClick={()=>setConfirmChecks(prev=>prev.map((v,j)=>j===ci?!v:v))} className="flex items-start gap-3 cursor-pointer group">
                    <div className={`w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0 mt-0.5 transition-all ${confirmChecks[ci]?"bg-blue-600 border-blue-500":"border-slate-600 bg-[#111827] group-hover:border-slate-500"}`}>
                      {confirmChecks[ci]&&<CheckCircle2 size={12} className="text-white"/>}
                    </div>
                    <span className={`text-xs leading-relaxed transition-colors ${confirmChecks[ci]?"text-slate-300":"text-slate-500 group-hover:text-slate-400"}`}>{text}</span>
                  </label>
                ))}
              </div>

              {/* Error banner */}
              {errMsg&&(
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

              {/* Submit button */}
              <button
                onClick={()=>setShowSendConfirm(true)}
                disabled={sending||ibkrLoading||nOrdens===0||done||aum<=0||!allChecked||investOverBudget||(ibkrPos!==null&&ibkrPos.reduce((s,p)=>s+Math.abs(p.value_eur??p.value),0)>aum*1.5)}
                className={`w-full flex items-center justify-center gap-2 py-3.5 text-sm font-black disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-xl transition-all ${
                  !allChecked?"bg-slate-700 cursor-not-allowed":
                  paperMode?"bg-slate-600 hover:bg-slate-500 shadow-lg":
                  investOverBudget?"bg-red-900 cursor-not-allowed":
                  recentlySent?"bg-amber-600 hover:bg-amber-500 shadow-xl shadow-amber-900/40":
                  "bg-blue-600 hover:bg-blue-500 shadow-xl shadow-blue-900/40"}`}>
                <Send size={16}/>
                {!allChecked?"Confirme os pontos acima para prosseguir":
                 paperMode?`Simular envio de ${nOrdens} ordens (simulação local)`:
                 investOverBudget?"⛔ Bloqueado — total excede budget":
                 recentlySent?"⚠ Já enviou recentemente — confirmar envio?":
                 `Confirmar e enviar ordens`}
              </button>
              <p className="text-center text-[10px] text-slate-700 flex items-center justify-center gap-1">
                <ShieldCheck size={10}/> As ordens só são enviadas após a sua confirmação explícita.
              </p>
            </div>
          )}

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
                      <div className="flex gap-2">
                        <button onClick={cancelPendingOrders} disabled={cancelSending}
                          className="flex-1 flex items-center justify-center gap-2 py-2.5 text-xs font-bold bg-slate-700/40 hover:bg-slate-600/40 border border-slate-500/30 text-slate-300 rounded-xl disabled:opacity-50 transition-colors">
                          {cancelSending?<span className="animate-spin text-xs">⟳</span>:<span className="text-xs">✕</span>}
                          {cancelSending?"A cancelar ordens pendentes…":"Cancelar ordens pendentes (Em curso)"}
                        </button>
                        <button
                          onClick={()=>{setFills([]);setSellAllFills([]);setFlatFills([]);setDone(false);setSellAllResult(null);setFlatResult(null);setCancelResult(null);void fetchIbkrPositions();}}
                          title="Cancelaste as ordens no TWS? Clica para sincronizar o estado aqui."
                          className="px-3 py-2.5 text-xs font-bold bg-slate-800 hover:bg-slate-700 border border-slate-600/40 text-slate-400 rounded-xl transition-colors shrink-0"
                        >⟳ Sync</button>
                      </div>
                      {cancelResult&&<div className="mt-1.5 text-[10px] text-center text-slate-400">{cancelResult}</div>}
                    </div>

                    {/* FLAT — closes ALL positions: confirmation flow */}
                    {flatResult?(
                      /* ── POST-SUBMIT result ── */
                      <div className="space-y-2">
                        <div className="flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/20 rounded-xl px-3 py-2.5">
                          <CheckCircle2 size={14} className="text-emerald-400 shrink-0"/>
                          <div>
                            <div className="text-[10px] font-bold text-emerald-300">Carteira zerada</div>
                            <div className="text-[10px] text-slate-500">{flatResult.longs} longs + {flatResult.shorts} shorts · ref {flatResult.ref}</div>
                          </div>
                          <button onClick={()=>{setFlatResult(null);setFlatFills([]);setIbkrPos(null);setAuditStatus(null);setFlatStep("idle");setFlatChecks([false,false,false]);}} className="ml-auto text-slate-500 hover:text-slate-300"><X size={12}/></button>
                        </div>
                        <div className={`px-3 py-2 rounded-lg text-xs font-mono border ${auditStatus?.ok?"bg-emerald-500/10 border-emerald-500/30 text-emerald-300":"bg-slate-800/60 border-slate-700/40 text-slate-400"}`}>
                          {auditStatus?.msg ?? "⏳ a guardar audit…"}
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
                                  const cancelled=f.status==="Cancelled"||f.status==="Canceled";
                                  const skipped=["skip_zero","skip_sell_no_long","contract_not_qualified"].includes(f.status);
                                  return(
                                    <tr key={i} className={`border-b border-[#1a1f2e] ${i%2===0?"":"bg-[#080c14]"} ${skipped||cancelled?"opacity-50":""}`}>
                                      <td className="px-3 py-1 font-bold text-orange-400">{f.ticker}</td>
                                      <td className={`px-2 py-1 font-semibold text-[10px] ${f.action==="BUY"||f.action==="Comprar"?"text-emerald-400":"text-red-400"}`}>{f.action==="BUY"||f.action==="Comprar"?"Comprar (cover)":"Vender"}</td>
                                      <td className="px-2 py-1 text-right text-slate-300">{f.filled||f.requested_qty}</td>
                                      <td className="px-3 py-1">
                                        <span className={`px-1.5 py-0.5 rounded text-[9px] font-semibold ${filled?"bg-emerald-900/40 text-emerald-300":cancelled?"bg-slate-800 text-slate-400":skipped?"bg-slate-800 text-slate-500":"bg-amber-900/40 text-amber-300"}`}>
                                          {filled?"OK":cancelled?"Cancelada":skipped?"Ignorada":"Em curso"}
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
                    ):flatStep==="preview"?(
                      /* ── CONFIRMATION STEP ── */
                      <div className="rounded-xl border border-orange-500/30 bg-orange-500/5 overflow-hidden">
                        {/* Header */}
                        <div className="flex items-center justify-between px-4 py-3 border-b border-orange-500/20">
                          <div>
                            <div className="text-xs font-black text-orange-300 flex items-center gap-1.5">
                              <span className="text-base leading-none">⊘</span> Confirmar — Zerar Carteira
                            </div>
                            <div className="text-[10px] text-slate-500 mt-0.5">
                              {ibkrPos.filter(p=>p.qty>0).length} longs + {ibkrPos.filter(p=>p.qty<0).length} shorts · ordens de mercado (MKT)
                            </div>
                          </div>
                          <button onClick={()=>{setFlatStep("idle");setFlatChecks([false,false,false]);}} className="text-slate-500 hover:text-slate-300"><X size={12}/></button>
                        </div>
                        {/* Order table */}
                        <div className="max-h-52 overflow-y-auto">
                          <table className="w-full text-[10px]">
                            <thead className="sticky top-0 bg-[#0d1117]">
                              <tr className="text-slate-500 border-b border-[#1a1f2e]">
                                <th className="text-left px-3 py-1.5">Ticker</th>
                                <th className="text-left px-2 py-1.5">Acção</th>
                                <th className="text-right px-2 py-1.5">Qtd</th>
                                <th className="text-right px-3 py-1.5">Valor est.</th>
                              </tr>
                            </thead>
                            <tbody>
                              {[...ibkrPos.filter(p=>p.qty>0).map(p=>({...p,act:"SELL"})),
                                ...ibkrPos.filter(p=>p.qty<0).map(p=>({...p,act:"BUY"}))].map((p,i)=>(
                                <tr key={i} className={`border-b border-[#1a1f2e] ${i%2===0?"":"bg-[#080c14]"}`}>
                                  <td className="px-3 py-1 font-bold text-slate-200">{p.ticker}</td>
                                  <td className={`px-2 py-1 font-semibold ${p.act==="SELL"?"text-red-400":"text-emerald-400"}`}>
                                    {p.act==="SELL"?"▼ Vender":"▲ Comprar (cover)"}
                                  </td>
                                  <td className="px-2 py-1 text-right text-slate-300">{Math.abs(p.qty)}</td>
                                  <td className="px-3 py-1 text-right text-slate-400">
                                    {p.value!=null?`€${Math.abs(p.value).toLocaleString("pt-PT",{minimumFractionDigits:0,maximumFractionDigits:0})}`:"—"}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        {/* Summary row */}
                        <div className="flex items-center justify-between px-4 py-2 border-t border-orange-500/20 bg-orange-500/5">
                          <span className="text-[10px] text-slate-400">{ibkrPos.filter(p=>p.qty!==0).length} ordens · execução imediata (MKT)</span>
                          <span className="text-[10px] font-bold text-orange-300">
                            €{ibkrPos.reduce((s,p)=>s+Math.abs(p.value??0),0).toLocaleString("pt-PT",{minimumFractionDigits:0,maximumFractionDigits:0})}
                          </span>
                        </div>
                        {/* Confirmation checkboxes */}
                        <div className="px-4 py-3 border-t border-orange-500/20 space-y-2">
                          {[
                            "Confirmo que todas as ordens são de venda a mercado e entendo o impacto imediato.",
                            "Confirmo que esta operação cumpre a política de investimento do cliente.",
                            "Confirmo que já cancelei todas as ordens pendentes na IB Gateway.",
                          ].map((label,i)=>(
                            <label key={i} className="flex items-start gap-2 cursor-pointer group">
                              <input type="checkbox" checked={flatChecks[i]}
                                onChange={e=>{const c=[...flatChecks];c[i]=e.target.checked;setFlatChecks(c);}}
                                className="mt-0.5 accent-orange-400 shrink-0"/>
                              <span className={`text-[10px] leading-relaxed transition-colors ${flatChecks[i]?"text-slate-300":"text-slate-500 group-hover:text-slate-400"}`}>{label}</span>
                            </label>
                          ))}
                        </div>
                        {/* Send button */}
                        <div className="px-4 pb-4">
                          <button
                            onClick={()=>void flattenAllPositions()}
                            disabled={!flatChecks.every(Boolean)||flatSending||(!paperMode&&ibkrOpenOrders.length>0)}
                            className="w-full flex items-center justify-center gap-2 py-3 text-xs font-black bg-orange-600/30 hover:bg-orange-600/40 border border-orange-500/60 text-orange-200 rounded-xl disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                            {flatSending?<span className="animate-spin">⟳</span>:<span>⊘</span>}
                            {flatSending?"A zerar carteira…":"Confirmar e enviar ordens"}
                          </button>
                          {!paperMode&&ibkrOpenOrders.length>0&&(
                            <p className="text-[9px] text-amber-400 text-center mt-1.5">⚠ Cancela as {ibkrOpenOrders.length} ordens pendentes primeiro</p>
                          )}
                        </div>
                      </div>
                    ):(
                      /* ── IDLE: initial button ── */
                      <button
                        onClick={()=>{setFlatStep("preview");setFlatChecks([false,false,false]);}}
                        disabled={ibkrPos.length===0||(ibkrPos.every(p=>p.qty===0))}
                        className="w-full flex items-center justify-center gap-2 py-3 text-xs font-black bg-orange-600/20 hover:bg-orange-600/30 border border-orange-500/50 text-orange-300 rounded-xl disabled:opacity-50 transition-colors">
                        <span className="text-base leading-none">⊘</span>
                        {paperMode?`Rever e zerar carteira (simulação)`:
                          `Rever e zerar carteira — ${ibkrPos.filter(p=>p.qty>0).length} longs + ${ibkrPos.filter(p=>p.qty<0).length} shorts`}
                      </button>
                    )}

                    {/* Original sell-longs-only button */}
                    {!sellAllResult?(
                      <button onClick={sellAllPositions} disabled={sellAllSending||ibkrPos.filter(p=>p.qty>0).length===0||(!paperMode&&ibkrOpenOrders.length>0)}
                        className="w-full flex items-center justify-center gap-2 py-2 text-[10px] font-bold bg-red-600/10 hover:bg-red-600/20 border border-red-500/20 text-red-400 rounded-xl disabled:opacity-50 transition-colors">
                        {sellAllSending?<span className="animate-spin text-xs">⟳</span>:<Trash2 size={11}/>}
                        {sellAllSending?"A vender longs…":
                          (!paperMode&&ibkrOpenOrders.length>0)?`⚠ Cancela pendentes antes de vender`:
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
                                  const cancelled=f.status==="Cancelled"||f.status==="Canceled";
                                  return(
                                    <tr key={i} className={`border-b border-[#1a1f2e] ${i%2===0?"":"bg-[#080c14]"} ${skipped||cancelled?"opacity-50":""}`}>
                                      <td className="px-3 py-1 font-bold text-red-400">{f.ticker}</td>
                                      <td className="px-2 py-1 text-right text-slate-300">{f.filled||f.requested_qty||"—"}</td>
                                      <td className="px-2 py-1 text-right text-slate-400">{f.avg_fill_price?f.avg_fill_price.toFixed(2):"—"}</td>
                                      <td className="px-3 py-1">
                                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${filled?"bg-emerald-900/40 text-emerald-300":cancelled?"bg-slate-800 text-slate-400":skipped?"bg-slate-800 text-slate-500":"bg-amber-900/40 text-amber-300"}`}>
                                          {filled?"Vendida":cancelled?"Cancelada":skipped?"Ignorada":f.status==="Submitted"?"Em curso":f.status}
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
                          const isCancelled=f.status==="Cancelled"||f.status==="Canceled";
                          const isSubmitted=["Submitted","PreSubmitted","PendingSubmit"].includes(f.status);
                          const isError=f.status==="error";
                          // value_eur: backend already converts USD→EUR; fallback assumes EUR
                          const valorExec=f.value_eur!=null?f.value_eur:f.filled&&f.avg_fill_price?f.filled*f.avg_fill_price:null;
                          const rowBg=isFx?"bg-violet-950/30":i%2===0?"":"bg-[#080c14]";
                          const statusBadge=isFilled
                            ?"bg-emerald-900/50 text-emerald-300 border-emerald-700/40"
                            :isCancelled
                              ?"bg-slate-800/60 text-slate-400 border-slate-700/30"
                              :skipped
                                ?"bg-slate-800/60 text-slate-500 border-slate-700/30"
                                :isError
                                  ?"bg-red-900/40 text-red-300 border-red-700/30"
                                  :"bg-amber-900/40 text-amber-300 border-amber-700/30";
                          const statusLabel=isFilled?"✓ Preenchida":isCancelled?"✕ Cancelada":skipped?"— Ignorada":isSubmitted?"⟳ Em curso":isError?"✕ Erro":f.status;
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
                            {(()=>{
                              // Use value_eur (EUR-converted) if available, else native price × qty (fallback)
                              const tot=fills.filter(f=>f.ticker!=="EUR/USD"&&f.ticker!=="EURUSD").reduce((s,f)=>{
                                if(f.value_eur!=null) return s+f.value_eur;
                                return s+(f.filled&&f.avg_fill_price?f.filled*f.avg_fill_price:0);
                              },0);
                              return tot>0?"€ "+tot.toLocaleString("pt-PT",{minimumFractionDigits:2,maximumFractionDigits:2}):"—";
                            })()}
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

          {/* ── Confirmation modal ── */}
          {showSendConfirm&&(
            <div className="bg-[#0b0f1a] border-2 border-amber-500/60 rounded-xl px-5 py-4 space-y-3">
              <div className="flex items-center gap-2">
                <AlertTriangle size={16} className="text-amber-400 shrink-0"/>
                <span className="text-sm font-bold text-amber-300">Confirmar envio de {nOrdens} {nOrdens===1?"ordem":"ordens"} à Interactive Brokers</span>
              </div>
              <div className="grid grid-cols-3 gap-2 text-xs overflow-x-auto">
                <div className="bg-emerald-900/30 border border-emerald-700/40 rounded-lg px-3 py-2 text-center min-w-[80px]">
                  <div className="text-slate-400 mb-0.5">Total compras</div>
                  <div className="text-emerald-300 font-bold text-sm">€{investEur.toLocaleString("pt-PT",{minimumFractionDigits:0,maximumFractionDigits:0})}</div>
                  <div className="text-slate-500">{totalBuyPct.toFixed(1)}% plano</div>
                </div>
                <div className="bg-[#111827] border border-slate-700/40 rounded-lg px-3 py-2 text-center">
                  <div className="text-slate-400 mb-0.5">Plano</div>
                  <div className="text-slate-200 font-bold text-sm">€{aum.toLocaleString("pt-PT",{minimumFractionDigits:0,maximumFractionDigits:0})}</div>
                  <div className="text-slate-500">budget {(BUY_SAFETY_FACTOR*100).toFixed(0)}%</div>
                </div>
                <div className={`border rounded-lg px-3 py-2 text-center ${investEur>aum*BUY_SAFETY_FACTOR?"bg-red-900/30 border-red-700/40":"bg-slate-800/50 border-slate-700/40"}`}>
                  <div className="text-slate-400 mb-0.5">Já investido</div>
                  <div className={`font-bold text-sm ${totalHeldEur>aum*BUY_SAFETY_FACTOR?"text-red-300":"text-slate-200"}`}>€{totalHeldEur.toLocaleString("pt-PT",{minimumFractionDigits:0,maximumFractionDigits:0})}</div>
                  <div className="text-slate-500">{(totalHeldEur/aum*100).toFixed(1)}% plano</div>
                </div>
              </div>
              <p className="text-xs text-slate-400 leading-relaxed">
                Esta acção é <strong className="text-slate-200">irreversível</strong> após execução. As ordens serão enviadas ao mercado e executadas ao melhor preço disponível. Verifique a lista de ordens antes de confirmar.
              </p>
              {recentlySent&&lastSent&&(
                <p className="text-xs text-red-300 font-semibold">⚠ Já enviou ordens há {Math.round((Date.now()-lastSent.ts)/60000)} min. Confirma que quer enviar de novo?</p>
              )}
              <div className="flex gap-3">
                <button onClick={()=>setShowSendConfirm(false)} className="flex-1 py-3 text-sm font-bold bg-slate-800 hover:bg-slate-700 border border-slate-600/50 text-slate-300 rounded-xl transition-colors min-h-[48px]">
                  Cancelar
                </button>
                <button onClick={submitOrders} className="flex-1 py-3 text-sm font-bold bg-red-700 hover:bg-red-600 text-white rounded-xl transition-colors flex items-center justify-center gap-2 min-h-[48px]">
                  <Send size={14}/>Confirmar — enviar ordens agora
                </button>
              </div>
            </div>
          )}

          {/* Cancel button when confirm modal or done */}
          {(done||showSendConfirm)&&(
            <div className="flex gap-3">
              <button onClick={onBack} className="px-6 py-3 bg-[#0b0f1a] border border-[#1a1f2e] text-slate-300 text-sm font-semibold rounded-xl hover:bg-[#111827] transition-colors">
                Cancelar
              </button>
            </div>
          )}
        </div>

        {/* ── RIGHT PANEL — sticky "Resumo da ordem" ─────────────────────── */}
        <div className="w-full lg:w-72 shrink-0 border-t lg:border-t-0 lg:border-l border-[#1a1f2e] overflow-y-auto bg-[#07090f]">
          <div className="p-4 space-y-3">
            {/* Header */}
            <div className="flex items-center justify-between">
              <div className="font-semibold text-slate-200 text-sm">Resumo da ordem</div>
              <button className="text-[10px] text-sky-400 hover:text-sky-300 px-2 py-1 border border-sky-500/30 rounded-lg transition-colors">
                Exportar pré-ordem
              </button>
            </div>

            {/* Impacto estimado */}
            <div className="bg-[#0b0f1a] border border-[#1a1f2e] rounded-xl p-4">
              <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-3">Impacto estimado</div>
              <div className="space-y-2 text-[11px]">
                <div className="flex justify-between">
                  <span className="text-slate-400">Exposição adicional (%)</span>
                  <span className="font-mono font-semibold text-emerald-400">+{totalBuyPct.toFixed(2)}%</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Risco (Volatilidade)</span>
                  <span className="font-mono text-red-400">—</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Tracking error</span>
                  <span className="font-mono text-sky-400">—</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Exposição da carteira</span>
                  <span className="font-mono text-slate-300">{(100-(latestMonth?.tbillsTotalPct??0)).toFixed(1)}%</span>
                </div>
              </div>
            </div>

            {/* Principais alterações */}
            <div className="bg-[#0b0f1a] border border-[#1a1f2e] rounded-xl p-4">
              <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-3">Principais alterações</div>
              <div className="space-y-1.5">
                {orderRows.slice(0,8).map(r=>{
                  const isBuy=r.action==="Comprar"||r.action==="Aumentar";
                  const isSell=r.action==="Vender"||r.action==="Reduzir";
                  const adjRow=adjustedOrderRows.find(x=>x.ticker===r.ticker);
                  const est=adjRow?adjRow.adjEur:Math.abs(r.delta)/100*aum;
                  return (
                    <div key={r.ticker} className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="font-semibold text-slate-200 text-[11px] truncate">{displayTicker(r.ticker)}</span>
                        <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold shrink-0 ${
                          isBuy?"bg-emerald-500/15 text-emerald-300":
                          isSell?"bg-red-500/15 text-red-300":
                          "bg-amber-500/15 text-amber-300"}`}>{r.action}</span>
                      </div>
                      <span className={`text-[10px] font-mono font-semibold shrink-0 ${r.delta>0?"text-emerald-400":r.delta<0?"text-red-400":"text-slate-500"}`}>
                        {r.delta>0?"+":""}{r.delta.toFixed(2)}%
                      </span>
                    </div>
                  );
                })}
              </div>

              {/* Impacto total */}
              <div className="border-t border-[#1a1f2e] mt-3 pt-3">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold text-slate-300">Impacto total</span>
                  <span className={`text-sm font-black font-mono ${investEur>=reduceEur?"text-emerald-400":"text-red-400"}`}>
                    {investEur>=reduceEur?"+":"-"}{Math.abs(totalBuyPct-totalSellPct).toFixed(2)}%
                  </span>
                </div>
              </div>

              {/* Warning if over limit */}
              {ibkrPos!==null&&(()=>{
                const ibNav=ibkrPos.reduce((s,p)=>s+Math.abs(p.value_eur??p.value),0);
                if(ibNav<=aum*1.5) return null;
                return (
                  <div className="mt-2 flex items-start gap-2 bg-amber-500/[0.08] border border-amber-500/20 rounded-lg px-2.5 py-2 text-[10px] text-amber-300">
                    <AlertTriangle size={10} className="shrink-0 mt-0.5"/>
                    <span>A redução da carteira ({(ibNav/aum*100).toFixed(0)}%) excede o limite preferido (≤ 25%). Considere rever o tamanho das ordens ou ajustar a lista.</span>
                  </div>
                );
              })()}
            </div>

            {/* Custos estimados */}
            <div className="bg-[#0b0f1a] border border-[#1a1f2e] rounded-xl p-4">
              <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-3">Custos estimados</div>
              <div className="space-y-2 text-[11px]">
                <div className="flex justify-between">
                  <span className="text-slate-400">Comissões estimadas</span>
                  <span className="font-mono font-semibold text-slate-200">€ {fmtE(tradeCost)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Impacto do mercado estimado</span>
                  <span className="font-mono text-slate-400">€ {fmtE(Math.max(1.5, nOrdens*0.4))}</span>
                </div>
                <div className="border-t border-[#1a1f2e] pt-2 mt-1 flex justify-between">
                  <span className="text-slate-300 font-semibold">Total estimado</span>
                  <span className="font-mono font-semibold text-slate-200">€ {fmtE(tradeCost+Math.max(1.5,nOrdens*0.4))}</span>
                </div>
              </div>
            </div>

            {/* Informação adicional */}
            <div className="bg-[#0b0f1a] border border-[#1a1f2e] rounded-xl p-4">
              <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-3">Informação adicional</div>
              <div className="space-y-2 text-[11px]">
                <div className="flex justify-between">
                  <span className="text-slate-400">Haircut do curto</span>
                  <span className="font-mono text-slate-300">16,35 (Lsbot)</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Liquidação prevista</span>
                  <span className="font-mono text-slate-300">T+2 dias úteis</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Modo</span>
                  <span className={`font-semibold ${paperMode?"text-amber-400":"text-emerald-400"}`}>{paperMode?"Simulação":"Produção"}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Perfil</span>
                  <span className="text-slate-300 font-semibold">{profileLabel}</span>
                </div>
              </div>
            </div>

            {/* NAV + IB divergence warning */}
            {ibkrPos!==null&&(()=>{
              const ibNav=ibkrPos.reduce((s,p)=>s+Math.abs(p.value_eur??p.value),0);
              const pct=aum>0?Math.abs(ibNav-aum)/aum*100:0;
              if(pct<5) return null;
              return (
                <div className={`flex items-start gap-2 rounded-xl px-3 py-2.5 text-[10px] ${ibNav>aum*1.5?"bg-red-500/10 border border-red-500/40 text-red-300":"bg-amber-500/[0.08] border border-amber-500/20 text-amber-300"}`}>
                  <AlertTriangle size={11} className="shrink-0 mt-0.5"/>
                  <span>NAV IB ({fmtE(ibNav)} €) diverge {pct.toFixed(0)}% do montante de referência ({fmtE(aum)} €).</span>
                </div>
              );
            })()}

            {/* Exportar button */}
            <button className="w-full flex items-center justify-center gap-2 py-2.5 text-xs font-semibold text-sky-400 border border-sky-500/30 rounded-xl hover:bg-sky-500/10 transition-colors">
              <ArrowUpRight size={13}/>
              Exportar pré-ordem
            </button>
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

type TimelineEvent={
  id:string; ts:number; kind:string;
  title:string; subtitle:string; narrative:string; tags:string[];
};

/* ─── ActividadePage sub-component ─────────────────────────────────────── */
function ActividadePage({sortedMonths}:{sortedMonths:MonthRec[]}) {
  const actLog=useState<ActEntry[]>(()=>getActivityLog())[0];

  // ── Build client-facing timeline events ────────────────────────────────
  // Only high-relevance events: rebalancing from model history + order executions.
  // Technical noise (login, configuração, raw API) is deliberately excluded.

  const rebalanceEvents=useMemo(()=>{
    const evs:TimelineEvent[]=[];
    sortedMonths.forEach((m,idx)=>{
      if(idx===0) return;
      const prev=sortedMonths[idx-1];
      const pm=new Map(prev.rows.map(r=>[r.ticker,r.weightPct]));
      const cm=new Map(m.rows.map(r=>[r.ticker,r.weightPct]));
      const allT=new Set([...pm.keys(),...cm.keys()]);
      let entradas=0,saidas=0,aumentos=0,reducoes=0;
      allT.forEach(t=>{
        if(t.startsWith("TBILL")||t.startsWith("CASH")||t==="XEON") return;
        const p=pm.get(t)??0, c=cm.get(t)??0, d=c-p;
        if(Math.abs(d)<0.01) return;
        if(p===0&&c>0) entradas++;
        else if(p>0&&c===0) saidas++;
        else if(d>0) aumentos++;
        else reducoes++;
      });
      const total=entradas+saidas+aumentos+reducoes;
      if(total===0) return;
      const parts:string[]=[];
      if(entradas) parts.push(`${entradas} nova${entradas>1?"s":""} posição${entradas>1?"ões":""}`);
      if(aumentos) parts.push(`${aumentos} reforço${aumentos>1?"s":""}`);
      if(reducoes) parts.push(`${reducoes} redução${reducoes>1?"ões":""}`);
      if(saidas) parts.push(`${saidas} encerramento${saidas>1?"s":""}`);
      const dateStr:string=m.date??m.rebalance_date??"1970-01-01";
      const monthName=new Date(dateStr).toLocaleDateString("pt-PT",{month:"long",year:"numeric"});
      evs.push({
        id:`reb-${dateStr}`,
        ts:new Date(dateStr).getTime(),
        kind:"revisao",
        title:`Revisão mensal do portfólio`,
        subtitle:monthName.charAt(0).toUpperCase()+monthName.slice(1),
        narrative:`O modelo identificou ${total} ajuste${total>1?"s":""} na composição da carteira. ${parts.join(", ")}.`,
        tags:parts.slice(0,2),
      });
    });
    return evs.reverse();
  },[sortedMonths]);

  const orderEvents=useMemo(()=>{
    return actLog
      .filter(e=>e.type==="ordens")
      .map(e=>({
        id:e.id||`ord-${e.ts}`,
        ts:e.ts,
        kind:"execucao" as const,
        title:"Plano de execução enviado",
        subtitle:new Date(e.ts).toLocaleDateString("pt-PT",{day:"2-digit",month:"long",year:"numeric"}),
        narrative:e.detail||"As ordens foram submetidas para execução na Interactive Brokers após confirmação.",
        tags:[] as string[],
      }));
  },[actLog]);

  const timeline=[...rebalanceEvents,...orderEvents].sort((a,b)=>b.ts-a.ts);

  const kindMeta=(kind:string)=>{
    switch(kind){
      case "revisao":   return {icon:"◈", accent:"border-l-teal-500",  badge:"text-teal-400 bg-teal-500/10 border-teal-500/25",  dot:"bg-teal-500"};
      case "execucao":  return {icon:"◆", accent:"border-l-emerald-500",badge:"text-emerald-400 bg-emerald-500/10 border-emerald-500/25",dot:"bg-emerald-500"};
      default:          return {icon:"○", accent:"border-l-slate-700",  badge:"text-slate-400 bg-slate-800 border-slate-700/30",  dot:"bg-slate-600"};
    }
  };

  const kindLabel=(kind:string)=>kind==="revisao"?"Revisão":(kind==="execucao"?"Execução":"Evento");

  const fmtDateShort=(ts:number)=>new Date(ts).toLocaleDateString("pt-PT",{day:"2-digit",month:"short",year:"numeric"});

  // Group by year/quarter for premium feel
  const grouped=useMemo(()=>{
    const g=new Map<string,TimelineEvent[]>();
    timeline.forEach(e=>{
      const d=new Date(e.ts);
      const key=`${d.getFullYear()}`;
      if(!g.has(key)) g.set(key,[]);
      g.get(key)!.push(e);
    });
    return [...g.entries()];
  },[timeline]);

  return (
    <div className="space-y-8 pb-8">

      {/* ── Page intro ── */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <h2 className="text-slate-100 font-black text-lg tracking-tight">Percurso da carteira</h2>
          <p className="text-slate-500 text-xs mt-1 max-w-sm leading-relaxed">
            Os momentos relevantes da sua gestão — revisões do modelo, execuções e alterações de perfil.
          </p>
        </div>
        {timeline.length>0&&(
          <div className="text-[11px] text-slate-600 shrink-0">
            {timeline.length} evento{timeline.length>1?"s":""} · desde {new Date(timeline[timeline.length-1].ts).getFullYear()}
          </div>
        )}
      </div>

      {/* ── Timeline ── */}
      {timeline.length===0?(
        <div className="bg-[#0b0f1a] border border-[#1a1f2e] rounded-2xl p-12 text-center">
          <div className="w-12 h-12 rounded-full bg-slate-800/60 flex items-center justify-center mx-auto mb-4">
            <span className="text-slate-600 text-xl">◎</span>
          </div>
          <div className="text-slate-400 text-sm font-medium mb-1">Sem eventos registados</div>
          <div className="text-slate-600 text-xs">Os eventos da sua carteira aparecerão aqui à medida que ocorrem.</div>
        </div>
      ):(
        <div className="space-y-10">
          {grouped.map(([year,events])=>(
            <div key={year}>
              {/* Year separator */}
              <div className="flex items-center gap-4 mb-6">
                <div className="text-xs font-black text-slate-600 tracking-[0.2em] uppercase">{year}</div>
                <div className="flex-1 h-px bg-[#1a1f2e]"/>
              </div>

              {/* Events */}
              <div className="relative">
                {/* Vertical timeline line */}
                <div className="absolute left-[15px] top-4 bottom-4 w-px bg-[#1a1f2e] hidden sm:block"/>

                <div className="space-y-4">
                  {events.map((e,i)=>{
                    const m=kindMeta(e.kind);
                    return (
                      <div key={e.id||i} className="relative flex items-start gap-4 sm:gap-5">
                        {/* Dot on timeline */}
                        <div className="shrink-0 relative z-10 mt-3.5 hidden sm:block">
                          <div className={`w-[7px] h-[7px] rounded-full ${m.dot} ml-[12px] ring-4 ring-[#080c14]`}/>
                        </div>

                        {/* Card */}
                        <div className={`flex-1 bg-[#0b0f1a] border border-[#1a1f2e] border-l-2 ${m.accent} rounded-xl px-5 py-4 transition-colors hover:border-l-2`}>
                          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2 sm:gap-4">
                            <div className="flex-1 min-w-0">
                              {/* Badge + date row */}
                              <div className="flex items-center gap-2 mb-2">
                                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${m.badge}`}>{kindLabel(e.kind)}</span>
                                <span className="text-[10px] text-slate-600">{fmtDateShort(e.ts)}</span>
                              </div>
                              {/* Title */}
                              <div className="text-slate-100 text-sm font-bold leading-snug">{e.title}</div>
                              {/* Narrative */}
                              <div className="text-slate-400 text-xs mt-1.5 leading-relaxed">{e.narrative}</div>
                              {/* Tags */}
                              {e.tags.length>0&&(
                                <div className="flex items-center gap-1.5 mt-3 flex-wrap">
                                  {e.tags.map((t,ti)=>(
                                    <span key={ti} className="text-[10px] text-slate-500 bg-slate-800/60 border border-slate-700/40 px-2 py-0.5 rounded-full">{t}</span>
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Reassurance footer ── */}
      {timeline.length>0&&(
        <div className="flex items-start gap-3 bg-[#080c14] border border-[#1a1f2e] rounded-xl px-5 py-4">
          <ShieldCheck size={13} className="text-slate-700 shrink-0 mt-0.5"/>
          <div className="text-[11px] text-slate-600 leading-relaxed">
            Cada revisão mensal é gerada autonomamente pelo modelo quantitativo e registada com hora e data. O detalhe completo das operações está disponível junto da sua equipa DECIDE.
          </div>
        </div>
      )}
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
  const [sidebarOpen,setSidebarOpen]=useState(false);

  const navigateToPage=useCallback((p:Page)=>{
    setActivePage(p);
    if(!router.isReady) return;
    const q:Record<string,string|string[]>={...(router.query as Record<string,string|string[]>)};
    if(p==="dashboard") delete q.page;
    else q.page=p;
    void router.replace({pathname:router.pathname,query:q},undefined,{shallow:true});
  },[router]);
  const [riskProfileLocal,setRiskProfileLocalRaw]=useState<RiskProfile>("moderado");
  const [fxExposure,setFxExposureRaw]=useState<FxExposure>("protegida");
  const [marginEnabled,setMarginEnabledRaw]=useState(false);
  const [configPanelOpen,setConfigPanelOpen]=useState(false);
  const [openProfileDrop,setOpenProfileDrop]=useState(false);
  const [openFxDrop,setOpenFxDrop]=useState(false);
  const [openMarginDrop,setOpenMarginDrop]=useState(false);

  // Persist preferences in localStorage
  const LS_KEY="decide_prefs_v1";
  useEffect(()=>{
    try{
      const raw=localStorage.getItem(LS_KEY);
      const p=raw?JSON.parse(raw):{};
      // Risk profile: saved pref → onboarding profile → default "moderado"
      if(p.riskProfile){
        setRiskProfileLocalRaw(p.riskProfile);
      } else if(profile){
        setRiskProfileLocalRaw(profile as RiskProfile);
      }
      // FX exposure: saved pref → map from onboarding hedge pct → default "protegida"
      if(p.fxExposure){
        setFxExposureRaw(p.fxExposure);
      } else {
        try{
          const hp=JSON.parse(localStorage.getItem("decide_fx_hedge_prefs_v1")??"{}");
          if(hp.pct===0)   setFxExposureRaw("aberta");
          else if(hp.pct===50) setFxExposureRaw("parcial");
          else if(hp.pct===100) setFxExposureRaw("protegida");
        }catch{}
      }
      if(typeof p.marginEnabled==="boolean") setMarginEnabledRaw(p.marginEnabled);
    }catch{}
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[]);

  const savePrefs=(patch:Partial<{riskProfile:RiskProfile;fxExposure:FxExposure;marginEnabled:boolean}>)=>{
    try{
      const existing=JSON.parse(localStorage.getItem(LS_KEY)??"{}");
      localStorage.setItem(LS_KEY,JSON.stringify({...existing,...patch}));
      // Push all prefs to server so they're available across browsers
      pushCurrentSessionPrefs();
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
  const [showManterRows,setShowManterRows]=useState(false);
  const [showStressPeriods,setShowStressPeriods]=useState(false);
  const [showMethodModal,setShowMethodModal]=useState(false);
  const [hoveredCountry,setHoveredCountry]=useState<{name:string;pct:number}|null>(null);
  const [cartIbPos,setCartIbPos]=useState<{ticker:string;qty:number;value:number;value_eur?:number;weight_pct:number;currency:string;name?:string;sector?:string;country?:string}[]|null>(null);
  const [cartIbLoading,setCartIbLoading]=useState(false);
  const [cartIbErr,setCartIbErr]=useState("");
  const [cartIbNav,setCartIbNav]=useState<{value:number;ccy:string}>({value:0,ccy:""});

  // freeze series
  const [dates,setDates]=useState<string[]>([]);
  const [equityRaw,setEquityRaw]=useState<number[]>([]);

  const [benchRaw,setBenchRaw]=useState<number[]>([]);
  // Pre-computed inception KPIs from API (server-side, avoids client warmup detection issues)
  const [apiInceptionKpis,setApiInceptionKpis]=useState<{ann:number;shp:number;ret:number}|null>(null);

  // recommendations
  const [recoMonths,setRecoMonths]=useState<RecoMonth[]>([]);
  const [recoLoading,setRecoLoading]=useState(true);

  // FMP portfolio quality
  type PortfolioQuality={
    portfolio_summary:{
      roic:number|null;gross_margin:number|null;op_margin:number|null;
      net_margin:number|null;debt_equity:number|null;revenue_growth:number|null;
      sector_exposure:Record<string,number>;portfolio_quality_label:string;
    };
    tickers:Array<{ticker:string;roic?:number|null;gross_margin?:number|null;op_margin?:number|null;debt_equity?:number|null;revenue_growth?:number|null;sector?:string;name?:string;quality_label?:string}>;
    n_positions:number;
  };
  const [portfolioQuality,setPortfolioQuality]=useState<PortfolioQuality|null>(null);
  const [pqLoading,setPqLoading]=useState(false);
  const [expandedReco,setExpandedReco]=useState<string|null>(null);

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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[]);

  useEffect(()=>{
    const handleNav=(e:Event)=>{
      const detail=(e as CustomEvent).detail as string;
      if(detail==="carteira"){
        navigateToPage("carteira");
        setCartTab("ib");
        setCartIbPos(null); // force refresh
      }
    };
    window.addEventListener("decide:nav",handleNav);
    return ()=>window.removeEventListener("decide:nav",handleNav);
  },[navigateToPage]);

  // Navigate to page from URL query param (?page=custos, etc.) — layout so first paint matches URL
  useLayoutEffect(()=>{
    if(!router.isReady) return;
    const raw=router.query.page;
    const pageStr=Array.isArray(raw)?raw[0]:raw;
    const p=String(pageStr??"").toLowerCase();
    if(p&&VALID_PAGE_IDS.includes(p as Page)) setActivePage(p as Page);
  },[router.isReady,router.query.page]);

  // NO redirect — public dashboard shows to all

  useEffect(()=>{
    const _v=new Date().toISOString().slice(0,10).replace(/-/g,"");
    fetch(`/api/landing/freeze-cap15-data?v=${_v}&fx_exposure=${encodeURIComponent(fxExposure)}&profile=${encodeURIComponent(riskProfileLocal)}`).then(r=>r.json())
      .then((d:any)=>{
        if(d?.series){
          setDates(d.series.dates??[]);
          setEquityRaw(d.series.equity_overlayed??[]);

          setBenchRaw(d.series.benchmark_equity??[]);
        }
        if(d?.result?.inception_kpis){ const k=d.result.inception_kpis; setApiInceptionKpis({ann:k.ann,shp:k.shp,ret:k.ret}); }
      })
      .catch(()=>{});
  },[fxExposure,riskProfileLocal]);

  useEffect(()=>{
    setRecoLoading(true);
    fetch("/api/client/recommendations-history").then(r=>r.json())
      .then((d:any)=>{ if(d?.months) setRecoMonths(d.months); })
      .catch(()=>{}).finally(()=>setRecoLoading(false));
  },[]);

  // price fetch effect is placed after latestMonth declaration below

  // FMP portfolio quality — fetch when relatorios or carteira page is active and positions available
  useEffect(()=>{
    if(activePage!=="relatorios"&&activePage!=="carteira"&&activePage!=="reco") return;
    if(portfolioQuality||pqLoading) return;
    // will be triggered once latestMonth is available (see below)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[activePage]);

  // API devolve meses ordenados do mais antigo para o mais recente — último = mais recente
  const sortedMonths=useMemo(()=>[...recoMonths].sort((a,b)=>{
    const da=a.date??a.rebalance_date??"";
    const db=b.date??b.rebalance_date??"";
    return da<db?-1:da>db?1:0;
  }),[recoMonths]);
  const latestMonth=sortedMonths[sortedMonths.length-1];
  const prevMonth=sortedMonths[sortedMonths.length-2];

  // Portfolio quality fetch (FMP) — triggered when latestMonth available and on relatorios/carteira
  useEffect(()=>{
    if(!latestMonth||(activePage!=="relatorios"&&activePage!=="carteira"&&activePage!=="reco")) return;
    if(portfolioQuality||pqLoading) return;
    const rows=(latestMonth.rows??[]).filter((r:any)=>
      r.weightPct>=0.5&&!r.ticker.startsWith("TBILL")&&!r.ticker.startsWith("CASH")&&r.ticker!=="XEON"
    );
    if(!rows.length) return;
    const positions=rows.map((r:any)=>({ticker:r.ticker,weight:r.weightPct/100}));
    setPqLoading(true);
    fetch("/api/portfolio-quality",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({positions})})
      .then(r=>r.json()).then((d:any)=>{if(d?.portfolio_summary) setPortfolioQuality(d as any);})
      .catch(()=>{}).finally(()=>setPqLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[activePage,latestMonth?.date]);

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
    const MAX_TRIES=4, RETRY_MS=3000;
    for(let attempt=0;attempt<MAX_TRIES;attempt++){
      try{
        const resp=await fetch("/api/ibkr-snapshot",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({paper_mode:true})});
        const j=await resp.json();
        if(j.status==="ok"||j.positions){
          const positions=j.positions??[];
          // Se voltou vazio e ainda há tentativas, aguarda e volta a tentar
          if(positions.length===0&&attempt<MAX_TRIES-1){
            await new Promise(r=>setTimeout(r,RETRY_MS));
            continue;
          }
          setCartIbPos(positions);
          setCartIbNav({value:j.net_liquidation??0,ccy:j.net_liquidation_ccy??"EUR"});
          setCartIbLoading(false);
          return;
        } else {
          setCartIbErr(j.error||"Erro ao carregar posições");
          setCartIbLoading(false);
          return;
        }
      }catch(e:unknown){
        if(attempt<MAX_TRIES-1){
          await new Promise(r=>setTimeout(r,RETRY_MS));
          continue;
        }
        setCartIbErr(e instanceof Error?e.message:"Erro de ligação");
      }
    }
    setCartIbLoading(false);
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

  /** Counts using the same logic as histRows (WMIN 0.5, DMIN 1, no US filter, no top-20 cap)
   *  so the Recomendações badges match the Histórico tab exactly. */
  const officialCounts=useMemo(()=>{
    if(!latestMonth||!prevMonth) return null;
    const WMIN=0.5,DMIN_OC=1.0;
    const pm=new Map((prevMonth.rows??[]).map((r:WRow)=>[r.ticker,r.weightPct??0]));
    const cm=new Map((latestMonth.rows??[]).map((r:WRow)=>[r.ticker,r.weightPct??0]));
    const tickers=[...new Set([...pm.keys(),...cm.keys()])].filter(t=>{
      if(t==="TBILL_PROXY"||t.startsWith("TBILL")||t.startsWith("CASH")||t==="XEON") return false;
      return Math.max(pm.get(t)??0,cm.get(t)??0)>=WMIN;
    });
    type TW={t:string;w:number};
    const comprasRaw:TW[]=[],aumentosRaw:TW[]=[],vendasRaw:TW[]=[],reducoesRaw:TW[]=[],manterArr:TW[]=[];
    tickers.forEach(t=>{
      const p=pm.get(t)??0,cu=cm.get(t)??0,d=cu-p;
      if(p<WMIN&&cu>=WMIN) comprasRaw.push({t,w:cu});
      else if(cu<WMIN&&p>=WMIN) vendasRaw.push({t,w:p});
      else if(d>=DMIN_OC) aumentosRaw.push({t,w:cu});
      else if(d<=-DMIN_OC) reducoesRaw.push({t,w:cu});
      else if(cu>=WMIN) manterArr.push({t,w:cu});
    });
    return {
      comprar:dedupTW(comprasRaw).length,
      aumentar:dedupTW(aumentosRaw).length,
      vender:dedupTW(vendasRaw).length,
      reduzir:dedupTW(reducoesRaw).length,
      manter:dedupTW(manterArr).length,
    };
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
    // Raw plan weights — consistent with "Este mês" column so sector % matches table
    return [...map.entries()].map(([name,pct])=>({name,value:Math.round(pct*10)/10})).sort((a,b)=>b.value-a.value);
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
  // Margin equity: vol-targeting with a boosted target so average leverage is meaningfully > 1×.
  // Without the boost, targetVol ≈ scaledEquity's actual vol → leverage ≈ 1× on average (no effect).
  // MARGIN_BOOST = 1.35 → target vol 35% above base → average leverage ~1.3–1.4×.
  const MARGIN_RATE=0.04;
  const MARGIN_BOOST=1.35;
  const marginEquity=useMemo(()=>{
    if(!scaledEquity.length||!benchRaw.length||!dates.length) return scaledEquity;
    const bRets=benchRaw.slice(1).map((v,i)=>benchRaw[i]!>0?v/benchRaw[i]!-1:0);
    const baseTargetVol=annualVol(bRets)*profileFactor;
    if(!baseTargetVol||!isFinite(baseTargetVol)) return scaledEquity;
    // Boost target vol to ensure average leverage is well above 1× in risk-on periods
    const marginTargetVol=baseTargetVol*MARGIN_BOOST;
    // Prepend a risk-on sentinel for the pre-history period.
    // Without this, sortedMonths[0]'s XEON % is applied to ALL dates before the first
    // recommendation (potentially the entire 2006-2023 history), treating them as defensive
    // and making margin identical to base for the bulk of the 20-year period.
    const seriesStart=dates[0]??"2000-01-01";
    const monthPeriods=sortedMonths.length
      ? sortedMonths.map(m=>{
          const date=(m.rebalance_date??m.date??"").slice(0,10);
          const xeonRow=m.rows.find(r=>r.ticker==="XEON");
          const xeonPct=m.tbillsTotalPct??xeonRow?.weightPct??0;
          return {date,xeonPct};
        }).filter(p=>p.date)
      : [];
    const xeonPeriods=[{date:seriesStart,xeonPct:0},...monthPeriods];
    return marginEquityCurveVolTargeted(scaledEquity,benchRaw,dates,xeonPeriods,marginTargetVol,MARGIN_RATE);
  },[scaledEquity,benchRaw,dates,sortedMonths,profileFactor]);
  // Active equity: base or leveraged depending on KPI mode selection
  const activeEquity=kpiMode==="margem"?marginEquity:scaledEquity;


  // ── Recompute all KPIs from scaled curve ──────────────────────────────────
  // Period-independent risk data — deps deliberately exclude `period`
  const riskData=useMemo(()=>{
    if(!dates.length||!activeEquity.length) return null;
    const allRets=activeEquity.slice(1).map((v,i)=>v/activeEquity[i]-1);
    const allBRets=benchRaw.slice(1).map((v,i)=>v/benchRaw[i]-1);
    const vol20y=annualVol(allRets)*100;
    const benchVol20y=annualVol(allBRets)*100;
    const curVol=annualVol(allRets.slice(-252))*100;
    const dd5Start=skipWarmup(activeEquity,periodStart(dates,"20 Anos"));
    const curDD=currentDD(activeEquity.slice(dd5Start))*100;
    const modelDD=rollingDD(dates.slice(dd5Start),activeEquity.slice(dd5Start),10);
    let bpk=benchRaw[dd5Start]??1;
    const ddChart=modelDD.map((pt,j)=>{
      const bv=benchRaw[dd5Start+j*10]??benchRaw[benchRaw.length-1];
      if(bv>bpk)bpk=bv;
      return {...pt,bench:+(((bv-bpk)/bpk)*100).toFixed(2)};
    });
    // Rolling 20-year window — mesma lógica do NativeSimulator para consistência
    const last20=new Date(dates[dates.length-1]);
    const cut20=new Date(last20.getFullYear()-20,last20.getMonth(),last20.getDate());
    let s20cut=dates.findIndex(d=>new Date(d)>=cut20);
    if(s20cut<0) s20cut=0;
    // Find warmup end robustly from the series start (first non-flat index)
    const initVal=activeEquity[0]??1;
    let warmupEnd=1;
    while(warmupEnd<activeEquity.length-1&&Math.abs((activeEquity[warmupEnd]??0)-initVal)<1e-12) warmupEnd++;
    // s20 = first non-warmup day on or after the rolling cut date
    const s20=Math.max(s20cut,warmupEnd);
    const calYearsInc=calYearsFromDates(dates.slice(s20))??20;
    const inceptionRaw=periodMetrics(activeEquity.slice(s20),benchRaw.slice(s20),"20 Anos",calYearsInc);
    // Use server-side pre-computed KPIs only for the BASE mode (they are computed from the base
    // series and would cancel out any margin effect on CAGR/Sharpe if used in margin mode)
    const inception=(!kpiMode||kpiMode==="base")&&apiInceptionKpis
      ?{...inceptionRaw,ret:apiInceptionKpis.ret,ann:apiInceptionKpis.ann,shp:apiInceptionKpis.shp}
      :inceptionRaw;
    return {vol20y,benchVol20y,curVol,curDD,ddChart,inception};
  },[dates,activeEquity,benchRaw,apiInceptionKpis,kpiMode]);

  const perfData=useMemo(()=>{
    if(!dates.length||!activeEquity.length) return null;
    // "20 Anos" — janela rolante; warmup detectado desde o início da série (robusto)
    const s20start=(()=>{
      const last=new Date(dates[dates.length-1]);
      const cut=new Date(last.getFullYear()-20,last.getMonth(),last.getDate());
      let cutIdx=dates.findIndex(d=>new Date(d)>=cut);
      if(cutIdx<0) cutIdx=0;
      const iv=activeEquity[0]??1;
      let we=1;
      while(we<activeEquity.length-1&&Math.abs((activeEquity[we]??0)-iv)<1e-12) we++;
      return Math.max(cutIdx,we);
    })();
    const s=period==="20 Anos"?s20start:skipWarmup(activeEquity,periodStart(dates,period));
    const calYears=period==="20 Anos"?calYearsFromDates(dates.slice(s)):undefined;
    const chart=makeChartData(dates,activeEquity,benchRaw,period);
    const mRaw=periodMetrics(activeEquity.slice(s),benchRaw.slice(s),period,calYears);
    // For "20 Anos": use server pre-computed KPIs only in base mode (not margin — they were
    // computed from the base series and would suppress the margin effect on CAGR/Sharpe)
    const useServerKpis=(!kpiMode||kpiMode==="base")&&apiInceptionKpis;
    const m=period==="20 Anos"
      ?(useServerKpis
        ?{...mRaw,ret:apiInceptionKpis!.ret,ann:apiInceptionKpis!.ann,shp:apiInceptionKpis!.shp}
        :(riskData?.inception?{...mRaw,ret:riskData.inception.ret,ann:riskData.inception.ann,shp:riskData.inception.shp}:mRaw))
      :mRaw;
    // Anchor YTD to the last year present in the series (not the client's wall clock)
    // so freeze data from Dec 2024 still shows "2024 YTD" correctly.
    const seriesEndYear = dates.length ? new Date(dates[dates.length-1]).getFullYear() : new Date().getFullYear();
    const ytdStartStr=`${seriesEndYear}-01-01`;
    const ytdIdx=dates.findIndex(d=>d>=ytdStartStr);
    const ytdRet=ytdIdx>=0&&activeEquity.length>ytdIdx
      ? (activeEquity[activeEquity.length-1]/activeEquity[ytdIdx]-1)*100 : 0;
    return {chart,m,ytdRet,
      // forward risk fields for backwards-compat references
      curVol:riskData?.curVol??0,
      vol20y:riskData?.vol20y??0,
      benchVol20y:riskData?.benchVol20y??0,
      curDD:riskData?.curDD??0,
      ddChart:riskData?.ddChart??[],
      inception:riskData?.inception??{ret:0,ann:0,shp:0,vol:0,alpha:0,mVol:0}};
  },[dates,activeEquity,benchRaw,period,riskData,apiInceptionKpis,kpiMode]);

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
    const s=period==="20 Anos"?0:skipWarmup(activeEquity,periodStart(dates,period));
    const bSlice=benchRaw.slice(s);
    const eSlice=activeEquity.slice(s);
    if(bSlice.length<2) return null;
    const ret=(bSlice[bSlice.length-1]/bSlice[0]-1)*100;
    const calYears=period==="20 Anos"?calYearsFromDates(dates):undefined;
    const y=calYears!==undefined?calYears
      :period==="YTD"?(new Date().getMonth()+1)/12
      :period==="1 Ano"?1:period==="3 Anos"?3:period==="5 Anos"?5
      :bSlice.length/252;
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
    // Use actionCounts.allRows (top-20 plan, same source as operations table)
    // so the geo chart only shows countries for positions that will actually be traded.
    if(!actionCounts.allRows.length) return [];
    const map=new Map<string,number>();
    actionCounts.allRows.forEach(r=>{
      if(r.ticker==="XEON") return;
      const z=getZone(r.ticker);
      if(z==="Eurozona") return;
      map.set(z,(map.get(z)??0)+r.cur);
    });
    // Use raw plan weights (same base as the "Este mês" column in the table)
    // so geo bars match what the user sees in the positions table.
    return [...map.entries()]
      .map(([name,pct])=>({name,value:Math.round(pct*10)/10}))
      .filter(d=>d.value>=0.5)
      .sort((a,b)=>b.value-a.value);
  },[actionCounts.allRows]);

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
    // Use actionCounts.allRows (top-20 equity plan, XEON excluded) — same source as sectorData
    if(!actionCounts.allRows.length) return [];
    const m=new Map<string,number>();
    actionCounts.allRows.forEach(r=>{
      if(r.ticker==="XEON") return;
      const s=getSector(r.ticker)||"Outros";
      m.set(s,(m.get(s)??0)+r.cur);
    });
    // Raw plan weights — same base as sectorData (no equity-only renormalization)
    const totalPlan=[...m.values()].reduce((a,b)=>a+b,0)||1;
    const raw=[...m.entries()].sort((a,b)=>b[1]-a[1]).map(([name,v])=>({name,alloc:+(v).toFixed(1),riskW:v*(SECTOR_BETA[name]??1)}));
    const riskTotal=raw.reduce((s,r)=>s+r.riskW,0)||1;
    return raw.map(r=>({name:r.name,pct:r.alloc,risk:+((r.riskW/riskTotal)*totalPlan).toFixed(1)}));
  },[actionCounts.allRows]);

  // Risk metrics: VaR 95%, Beta
  const countryAlloc=useMemo(()=>{
    const raw=new Map<string,number>();
    actionCounts.allRows.forEach(r=>{
      if(r.ticker==="XEON") return;
      const c=getZone(r.ticker);
      if(c==="Eurozona") return;
      raw.set(c,(raw.get(c)??0)+r.cur);
    });
    // Use raw plan weights — consistent with the "Este mês" column in the table
    return raw;
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

  // Worst periods for Risk page
  const worstPeriods=useMemo(()=>{
    const step21=21;
    if(activeEquity.length<step21*2||dates.length<step21*2) return null;
    // Monthly returns (approx 21-day windows)
    const monthly:{ret:number,date:string}[]=[];
    for(let i=step21;i<activeEquity.length&&i<dates.length;i+=step21){
      const r=(activeEquity[i]!/activeEquity[i-step21]!-1)*100;
      monthly.push({ret:r,date:dates[i]!});
    }
    // Quarterly (approx 63-day)
    const step63=63;
    const quarterly:{ret:number,date:string}[]=[];
    for(let i=step63;i<activeEquity.length&&i<dates.length;i+=step63){
      const r=(activeEquity[i]!/activeEquity[i-step63]!-1)*100;
      quarterly.push({ret:r,date:dates[i]!});
    }
    // Annual (approx 252-day)
    const step252=252;
    const annual:{ret:number,date:string}[]=[];
    for(let i=step252;i<activeEquity.length&&i<dates.length;i+=step252){
      const r=(activeEquity[i]!/activeEquity[i-step252]!-1)*100;
      annual.push({ret:r,date:dates[i]!.slice(0,4)});
    }
    const wm=monthly.sort((a,b)=>a.ret-b.ret)[0];
    const wq=quarterly.sort((a,b)=>a.ret-b.ret)[0];
    const wy=annual.sort((a,b)=>a.ret-b.ret)[0];
    // Best month (for context)
    const bm=[...monthly].sort((a,b)=>b.ret-a.ret)[0];
    return{wm,wq,wy,bm};
  },[activeEquity,dates]);

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
    items.push({icon:"wave",title:"Volatilidade controlada",desc:`Vol histórica ${riskData?.vol20y?.toFixed(1)??riskData?.curVol?.toFixed(1)??"—"}% anual (20a) — nível Moderado.`});
    return (items as {icon:string;title:string;desc:string}[]).slice(0,4);
  },[actionCounts.rows,perfData]);

  const nChanges=actionCounts.comprar+actionCounts.aumentar+actionCounts.reduzir+actionCounts.vender;
  const SECTOR_COLORS=["#14b8a6","#3b82f6","#f59e0b","#8b5cf6","#22c55e","#ef4444","#64748b"];

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

      {/* Desktop: grelha — linha 1 [logo | header] mesma altura; linha 2 [nav | main scroll]. Mobile: coluna + drawer. */}
      <div
        className="decide-client-dashboard-root flex h-full min-h-0 w-full max-h-full flex-1 flex-col overflow-hidden bg-[#080c14] text-slate-200 lg:grid lg:h-full lg:max-h-full lg:min-h-0 lg:w-full lg:grid-cols-[minmax(0,16rem)_minmax(0,1fr)] lg:grid-rows-[auto_1fr]"
        style={{fontFamily:"'Nunito',system-ui,sans-serif"}}>
        {/* Logo desktop: mesma linha que o header à direita — stretch à altura da grelha */}
        <div className="relative z-40 decide-dashboard-desktop-logo hidden min-h-0 items-stretch border-b border-[#1a1f2e] bg-black py-0 pl-1 pr-2 lg:flex lg:row-start-1 lg:col-start-1 lg:col-end-2 lg:h-full lg:self-stretch">
          <div
            className="decide-sidebar-logo-slot flex h-full min-h-[4.5rem] w-full min-w-0 flex-1 items-center justify-start bg-black"
            style={{ maxWidth: "100%", boxSizing: "border-box" }}>
            <DecideBrandImage
              priority
              height="100%"
              maxWidth="min(13.5rem, 98%)"
              sizes="280px"
              className="decide-header-brand-mark decide-logo-img--plain decide-logo-img--header-lockup"
              knockoutBackground={false}
              style={{ maxHeight: "min(11.5rem, 100%)", objectFit: "contain", objectPosition: "left center" }}
            />
          </div>
        </div>

        <Sidebar user={sessionUser} profile={profile} loggedIn={loggedIn} onRegister={()=>setShowRegModal(true)}
          activePage={activePage} onNavigate={navigateToPage} open={sidebarOpen} onClose={()=>setSidebarOpen(false)}/>

        <div className="flex min-h-0 min-w-0 shrink-0 flex-col overflow-hidden lg:col-start-2 lg:col-end-3 lg:row-start-1 lg:min-h-0">
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

            {/* Título + filtros — linha 1 da grelha (desktop), alinhados à altura do logo */}
            <header className="z-30 shrink-0 flex flex-col border-b border-[#1a1f2e] bg-[#080c14]/98 backdrop-blur-md supports-[backdrop-filter]:bg-[#080c14]/92">
              {/* Top row: hamburger + title + quick actions */}
              <div className="flex items-center gap-3 px-3 sm:px-6 lg:px-8 py-3 lg:py-4">
                {/* Hamburger (mobile only) */}
                <button onClick={()=>setSidebarOpen(true)}
                  className="lg:hidden p-2 -ml-1 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-white/5 active:bg-white/10 min-w-[44px] min-h-[44px] flex items-center justify-center"
                  aria-label="Abrir menu">
                  <Menu size={22}/>
                </button>
                <div className="flex-1 min-w-0">
                  <h1 className="text-lg lg:text-xl font-black text-white truncate">{
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
                  <p className="text-slate-400 text-xs mt-0.5 hidden sm:block">{
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
                {/* Quick actions: settings + login (always visible) */}
                <div className="flex items-center gap-1.5 shrink-0">
                  <button onClick={()=>setConfigPanelOpen(true)}
                    className="p-2.5 bg-[#0b0f1a] border border-[#1a1f2e] rounded-lg hover:border-blue-500/50 transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center">
                    <Sliders size={16} className="text-slate-400"/>
                  </button>
                  {loggedIn ? (
                    <button onClick={()=>void router.push("/client/logout")}
                      className="flex items-center gap-2 px-2 sm:px-3 py-2 text-slate-400 hover:text-slate-200 text-xs rounded-lg border border-[#1a1f2e] hover:bg-white/5 transition-colors min-h-[44px] min-w-[44px] justify-center">
                      <LogOut size={14}/>
                      <span className="hidden sm:inline">Sair</span>
                    </button>
                  ) : (
                    <button onClick={()=>setShowRegModal(true)}
                      className="px-3 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold rounded-lg transition-colors shadow-lg shadow-blue-900/30 min-h-[44px]">
                      Criar conta
                    </button>
                  )}
                </div>
              </div>
              {/* Config strip (scrollable on mobile) */}
              <div className="flex items-center gap-2 px-3 sm:px-6 lg:px-8 pb-3 overflow-x-auto scrollbar-none">
                {/* Perfil de risco */}
                <div className="relative shrink-0">
                  <button onClick={()=>{setOpenProfileDrop(v=>!v);setOpenFxDrop(false);setOpenMarginDrop(false);}}
                    className="flex items-center gap-1.5 bg-[#0b0f1a] border border-[#1a1f2e] rounded-lg px-3 py-2 text-xs text-slate-300 hover:border-blue-500/50 transition-colors min-h-[40px]">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0"/>
                    <span className="text-[10px] text-slate-500 hidden md:block">Perfil</span>
                    <span className="font-semibold text-slate-200">{riskProfileLocal==="conservador"?"Conservador":riskProfileLocal==="dinamico"?"Dinâmico":"Moderado"}</span>
                    <ChevronDown size={12} className="text-slate-500"/>
                  </button>
                  {openProfileDrop&&<>
                    <div className="fixed inset-0 z-40" onClick={()=>setOpenProfileDrop(false)}/>
                    <div className="absolute left-0 top-full mt-1 z-50 bg-[#0b0f1a] border border-[#1a1f2e] rounded-xl shadow-xl min-w-[150px]">
                      {(["conservador","moderado","dinamico"] as RiskProfile[]).map(p=>(
                        <button key={p} onClick={()=>{setRiskProfileLocal(p);setOpenProfileDrop(false);}}
                          className={`w-full px-4 py-3 text-left text-xs hover:bg-white/5 active:bg-white/10 flex items-center gap-2 first:rounded-t-xl last:rounded-b-xl ${riskProfileLocal===p?"text-blue-400 font-bold":"text-slate-300"}`}>
                          {riskProfileLocal===p&&<span className="w-1.5 h-1.5 rounded-full bg-blue-400"/>}
                          {p==="conservador"?"Conservador":p==="dinamico"?"Dinâmico":"Moderado"}
                        </button>
                      ))}
                    </div>
                  </>}
                </div>
                {/* Exposição cambial */}
                <div className="relative shrink-0">
                  <button onClick={()=>{setOpenFxDrop(v=>!v);setOpenProfileDrop(false);setOpenMarginDrop(false);}}
                    className="flex items-center gap-1.5 bg-[#0b0f1a] border border-[#1a1f2e] rounded-lg px-3 py-2 text-xs text-slate-300 hover:border-blue-500/50 transition-colors min-h-[40px]">
                    <ShieldCheck size={12} className="text-blue-400 shrink-0"/>
                    <span className="text-[10px] text-slate-500 hidden md:block">Câmbio</span>
                    <span className="font-semibold text-slate-200">{fxExposure==="protegida"?"Protegida":fxExposure==="parcial"?"Parcial":"Aberta"}</span>
                    <ChevronDown size={12} className="text-slate-500"/>
                  </button>
                  {openFxDrop&&<>
                    <div className="fixed inset-0 z-40" onClick={()=>setOpenFxDrop(false)}/>
                    <div className="absolute left-0 top-full mt-1 z-50 bg-[#0b0f1a] border border-[#1a1f2e] rounded-xl shadow-xl min-w-[180px]">
                      {(["protegida","parcial","aberta"] as FxExposure[]).map(fx=>(
                        <button key={fx} onClick={()=>{setFxExposure(fx);setOpenFxDrop(false);}}
                          className={`w-full px-4 py-3 text-left text-xs hover:bg-white/5 active:bg-white/10 flex items-center gap-2 first:rounded-t-xl last:rounded-b-xl ${fxExposure===fx?"text-blue-400 font-bold":"text-slate-300"}`}>
                          {fxExposure===fx&&<span className="w-1.5 h-1.5 rounded-full bg-blue-400"/>}
                          {fx==="protegida"?"Protegida (Hedge ~90%)":fx==="parcial"?"Parcial (Hedge ~50%)":"Aberta (Sem hedge)"}
                        </button>
                      ))}
                    </div>
                  </>}
                </div>
                {/* Uso de margem */}
                <div className="relative shrink-0">
                  <button onClick={()=>{setOpenMarginDrop(v=>!v);setOpenProfileDrop(false);setOpenFxDrop(false);}}
                    className="flex items-center gap-1.5 bg-[#0b0f1a] border border-[#1a1f2e] rounded-lg px-3 py-2 text-xs text-slate-300 hover:border-blue-500/50 transition-colors min-h-[40px]">
                    <Activity size={12} className={marginEnabled?"text-amber-400":"text-slate-500"} />
                    <span className="text-[10px] text-slate-500 hidden md:block">Margem</span>
                    <span className={`font-semibold ${marginEnabled?"text-amber-400":"text-slate-200"}`}>{marginEnabled?"Ativado":"Desativado"}</span>
                    <ChevronDown size={12} className="text-slate-500"/>
                  </button>
                  {openMarginDrop&&<>
                    <div className="fixed inset-0 z-40" onClick={()=>setOpenMarginDrop(false)}/>
                    <div className="absolute left-0 top-full mt-1 z-50 bg-[#0b0f1a] border border-[#1a1f2e] rounded-xl shadow-xl min-w-[200px] p-3">
                      <div className="text-[10px] text-slate-500 mb-2">Uso de margem (avançado)</div>
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs text-slate-300">{marginEnabled?"Ativado":"Desativado"}</span>
                        <button onClick={()=>setMarginEnabled(v=>!v)} className={`relative w-11 h-6 rounded-full transition-colors ${marginEnabled?"bg-amber-500":"bg-slate-700"}`}>
                          <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${marginEnabled?"translate-x-5":"translate-x-0.5"}`}/>
                        </button>
                      </div>
                      {marginEnabled&&<div className="flex items-start gap-1.5 bg-amber-500/10 border border-amber-500/20 rounded-lg p-2">
                        <AlertTriangle size={10} className="text-amber-400 mt-0.5 shrink-0"/>
                        <div className="text-[9px] text-amber-300 leading-relaxed">A utilização de margem aumenta o risco da carteira e pode amplificar perdas.</div>
                      </div>}
                    </div>
                  </>}
                </div>
                {/* Date */}
                <div className="flex items-center gap-2 bg-[#0b0f1a] border border-[#1a1f2e] rounded-lg px-3 py-2 shrink-0 min-h-[40px]">
                  <span className="text-[10px] text-slate-300">📅</span>
                  <span className="text-xs text-slate-300 font-medium whitespace-nowrap">{new Date().toLocaleDateString("pt-PT",{month:"long",year:"numeric"}).replace(/^\w/,c=>c.toUpperCase())}</span>
                </div>
                {/* Bell */}
                <button onClick={()=>setConfigPanelOpen(true)}
                  className="relative p-2.5 bg-[#0b0f1a] border border-[#1a1f2e] rounded-lg hover:border-blue-500/50 transition-colors shrink-0 min-w-[40px] min-h-[40px] flex items-center justify-center">
                  <Bell size={15} className="text-slate-400"/>
                </button>
              </div>
            </header>
          </div>

            <main className="flex min-h-0 min-w-0 max-w-full flex-1 flex-col overflow-y-auto overflow-x-hidden overscroll-y-contain lg:col-start-2 lg:col-end-3 lg:row-start-2 lg:min-h-0">
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

            <div className="w-full min-w-0 max-w-full px-3 py-4 space-y-4 sm:px-6 sm:py-5 sm:space-y-5 lg:px-8 lg:py-6">


              {/* ── RELATÓRIOS ── */}
              {activePage==="relatorios"&&(()=>{
                const reportDate=new Date().toLocaleDateString("pt-PT",{day:"2-digit",month:"long",year:"numeric"});
                const pfLabel=profileFactor<1?"Conservador":profileFactor>1?"Dinâmico":"Moderado";
                const fmtPct=(v:number,sign=false)=>`${sign&&v>=0?"+":""}${v.toFixed(2)}%`;
                const fmtEur=(v:number)=>v.toLocaleString("pt-PT",{minimumFractionDigits:0,maximumFractionDigits:0});
                const reportVol=(benchPerfData?.mVol??0)>0?(benchPerfData?.mVol??0):scaledVol;
                const sharpeVal=perfData?.inception?.shp??perfData?.m?.shp??0;
                const top5=(latestMonth?.rows??[])
                  .filter(r=>!r.ticker.startsWith("TBILL")&&!r.ticker.startsWith("CASH")&&r.ticker!=="XEON")
                  .sort((a,b)=>b.weightPct-a.weightPct).slice(0,5);
                const topSectors=sectorData.slice(0,6).map(s=>[s.name,s.value] as [string,number]);
                const changes=actionCounts.rows.filter(r=>r.action!=="Manter").slice(0,8);
                const top3Changes=changes.slice(0,3);
                const reportChart=(perfData?.chart??[]).slice(-252);
                const ytdGain=aum*scaledYtd/100;
                const isUp=scaledYtd>=0;
                const nEquity=(latestMonth?.rows??[]).filter(r=>!r.ticker.startsWith("TBILL")&&!r.ticker.startsWith("CASH")&&r.ticker!=="XEON").length;
                const equityPctReport=100-(latestMonth?.tbillsTotalPct??0);
                // Regime based on equity pct
                const regimeTxt=equityPctReport>=80?"ofensivo":equityPctReport>=60?"moderado":equityPctReport>=40?"neutro":"defensivo";
                // Risk level for advisory
                const riskOk=Math.abs(scaledDD)<=25&&reportVol<=22;
                // Outperformance vs bench
                // Outperformance: CAGR model vs CAGR bench — same annualised metric, safe to subtract
                const outpBench=(perfData?.inception?.ann??0)-(benchPerfData?.ann??0);
                const maxSec=topSectors[0]?.[0]??"—";
                const maxSecPct=topSectors[0]?.[1]??0;
                return (
                  <div className="space-y-6 print:space-y-4">

                    {/* ── Masthead ── */}
                    <div className="bg-gradient-to-br from-[#091220] via-[#0b0f1a] to-[#0d1628] border border-[#1a2540] rounded-2xl p-4 sm:p-7">
                      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-6">
                        <div>
                          <div className="text-[10px] uppercase tracking-widest text-slate-600 mb-2">Relatório de carteira · DECIDE</div>
                          <div className="text-slate-100 font-black text-2xl sm:text-3xl tracking-tight mb-1">Relatório de Carteira</div>
                          <div className="text-slate-500 text-sm">Perfil <span className="text-teal-400 font-semibold">{pfLabel}</span> · {reportDate}</div>
                        </div>
                        <div className="sm:text-right">
                          <div className="text-slate-600 text-[10px] uppercase tracking-wider mb-1">Património</div>
                          <div className="text-white font-black text-3xl sm:text-4xl tracking-tight">€ {fmtEur(aum)}</div>
                          <div className={`text-base font-bold mt-1.5 ${isUp?"text-emerald-400":"text-red-400"}`}>
                            {fmtPct(scaledYtd,true)} YTD
                            <span className="text-slate-500 font-normal text-sm ml-2">({isUp?"+":""}{fmtEur(ytdGain)} €)</span>
                          </div>
                        </div>
                      </div>

                      {/* ── Resumo executivo ── */}
                      <div className="border-t border-white/[0.05] pt-5">
                        <div className="text-[10px] uppercase tracking-widest text-slate-600 mb-3">Resumo executivo</div>
                        <p className="text-slate-300 text-sm leading-7">
                          {isUp
                            ? "A carteira encerrou o ano em terreno positivo, com um retorno de "
                            : "A carteira registou um resultado negativo no ano, com "}
                          <span className={`font-bold ${isUp?"text-emerald-400":"text-red-400"}`}>{fmtPct(scaledYtd,true)} YTD</span>.
                          {" "}O CAGR histórico situa-se em <span className="text-teal-400 font-semibold">{fmtPct(scaledAnn,true)}</span>
                          {outpBench>0.5
                            ? `, com excesso de retorno anualizado de ${outpBench.toFixed(1)}pp face ao benchmark`
                            : outpBench<-0.5
                            ? `, ligeiramente abaixo do CAGR do benchmark (${(benchPerfData?.ann??0).toFixed(1)}%)`
                            : `, em linha com o benchmark`}
                          . O modelo manteve um posicionamento <span className="text-slate-200 font-semibold">{regimeTxt}</span> durante o período,
                          com <span className="text-slate-200 font-semibold">{equityPctReport.toFixed(0)}% em acções</span> e concentração principal em{" "}
                          <span className="text-slate-200 font-semibold">{maxSec} ({maxSecPct.toFixed(0)}%)</span>.
                          {riskOk
                            ? ` O risco permanece alinhado com o perfil ${pfLabel}, com volatilidade controlada e drawdown dentro dos parâmetros históricos.`
                            : ` O risco merece atenção — a volatilidade ou o drawdown situam-se acima dos níveis típicos para o perfil ${pfLabel}.`}
                          {changes.length>0
                            ? ` Neste rebalanceamento foram introduzidas ${changes.length} alterações ao portefólio.`
                            : ` Não foram efectuadas alterações neste rebalanceamento — a carteira mantém-se estável.`}
                        </p>
                      </div>
                    </div>

                    {/* ── KPI strip ── */}
                    <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                      {[
                        {label:"Retorno YTD",val:fmtPct(scaledYtd,true),c:isUp?"text-emerald-400":"text-red-400",sub:"Ano corrente"},
                        {label:"CAGR histórico",val:fmtPct(scaledAnn,true),c:scaledAnn>=0?"text-teal-400":"text-red-400",sub:"Desde início"},
                        {label:"Volatilidade",val:reportVol>0?`${reportVol.toFixed(1)}%`:"—",c:"text-amber-400",sub:"Anualizada"},
                        {label:"Máx. drawdown",val:scaledDD!==0?fmtPct(scaledDD):"—",c:"text-red-400",sub:"Período completo"},
                        {label:"Sharpe",val:sharpeVal.toFixed(2),c:sharpeVal>=1?"text-emerald-400":sharpeVal>=0?"text-amber-400":"text-red-400",sub:"Rf = 2% EUR ajustado"},
                      ].map(k=>(
                        <div key={k.label} className="bg-[#0b0f1a] border border-[#1a1f2e] rounded-xl px-3 sm:px-4 py-4">
                          <div className="text-slate-500 text-[10px] font-semibold mb-2 uppercase tracking-wider leading-tight">{k.label}</div>
                          <div className={`text-xl sm:text-2xl font-black ${k.c}`}>{k.val}</div>
                          <div className="text-slate-600 text-[10px] mt-1 leading-tight">{k.sub}</div>
                        </div>
                      ))}
                    </div>

                    {/* ── Hero chart ── */}
                    <div className="bg-[#0b0f1a] border border-[#1a1f2e] rounded-xl p-6">
                      <div className="flex items-center justify-between mb-5">
                        <div>
                          <div className="font-bold text-slate-100 text-base">Evolução patrimonial</div>
                          <div className="text-slate-500 text-xs mt-0.5">Retorno acumulado · últimos 12 meses vs benchmark</div>
                        </div>
                        <div className="flex items-center gap-5 text-[11px] text-slate-500">
                          <span className="flex items-center gap-1.5"><span className="w-5 h-0.5 bg-teal-500 inline-block rounded"/>{pfLabel}</span>
                          <span className="flex items-center gap-1.5"><span className="w-5 h-0.5 bg-slate-600 inline-block rounded" style={{borderTop:"2px dashed #475569"}}/>{BENCH_SHORT}</span>
                        </div>
                      </div>
                      {reportChart.length>0?(
                        <ResponsiveContainer width="100%" height={270}>
                          <AreaChart data={reportChart} margin={{top:4,right:8,bottom:0,left:0}}>
                            <defs>
                              <linearGradient id="repGrad2" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#14b8a6" stopOpacity={0.22}/>
                                <stop offset="95%" stopColor="#14b8a6" stopOpacity={0}/>
                              </linearGradient>
                            </defs>
                            <CartesianGrid stroke="#0f172a" strokeDasharray="3 6" vertical={false}/>
                            <XAxis dataKey="date" tick={{fill:"#475569",fontSize:10}} tickLine={false} axisLine={false}
                              tickFormatter={d=>d?String(d).slice(0,7):""}
                              interval={Math.floor(reportChart.length/7)}/>
                            <YAxis tick={{fill:"#475569",fontSize:10}} tickLine={false} axisLine={false}
                              tickFormatter={v=>`${(+v).toFixed(0)}%`} domain={["auto","auto"]}/>
                            <Tooltip contentStyle={{background:"#0f172a",border:"1px solid #1e293b",borderRadius:8,fontSize:12}}
                              formatter={(v:number)=>[`${v?.toFixed(2)}%`,""]}
                              labelFormatter={l=>String(l).slice(0,10)}/>
                            <ReferenceLine y={0} stroke="#1e293b" strokeDasharray="3 3"/>
                            <Area type="monotone" dataKey="model" stroke="#14b8a6" strokeWidth={2.5} fill="url(#repGrad2)" dot={false} name={pfLabel}/>
                            <Area type="monotone" dataKey="bench" stroke="#475569" strokeWidth={1.5} strokeDasharray="5 3" fill="none" dot={false} name={BENCH_SHORT}/>
                          </AreaChart>
                        </ResponsiveContainer>
                      ):(
                        <div className="h-[270px] flex items-center justify-center text-slate-600 text-sm">Sem dados de performance</div>
                      )}
                    </div>

                    {/* ── "O que mudou" + Principais riscos ── */}
                    <div className="grid grid-cols-2 gap-4">
                      {/* O que mudou */}
                      <div className="bg-[#0b0f1a] border border-[#1a1f2e] rounded-xl p-5">
                        <div className="text-[10px] uppercase tracking-widest text-slate-600 mb-4">O que mudou neste rebalanceamento</div>
                        {top3Changes.length===0?(
                          <p className="text-slate-500 text-sm py-2">Sem alterações — carteira estável.</p>
                        ):(
                          <div className="space-y-3">
                            {top3Changes.map(r=>{
                              const isB=r.action==="Comprar"||r.action==="Aumentar";
                              const isS=r.action==="Vender"||r.action==="Reduzir";
                              const delta=r.cur-r.prev;
                              return (
                                <div key={r.ticker} className="flex items-center justify-between">
                                  <div>
                                    <div className="text-slate-200 text-sm font-semibold">{getCompany(r.ticker)||r.ticker}</div>
                                    <div className="text-slate-500 text-xs">{r.ticker} · {getSector(r.ticker)}</div>
                                  </div>
                                  <div className="text-right">
                                    <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${isB?"bg-emerald-900/30 text-emerald-400":isS?"bg-red-900/30 text-red-400":"bg-slate-800 text-slate-400"}`}>
                                      {r.action}
                                    </span>
                                    <div className={`text-xs mt-1 font-semibold ${delta>0?"text-emerald-400/70":"text-red-400/70"}`}>
                                      {delta>0?"+":""}{delta.toFixed(1)}pp
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                            {changes.length>3&&(
                              <div className="text-slate-600 text-xs pt-1">+{changes.length-3} outras alterações — ver Recomendações</div>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Principais riscos */}
                      <div className="bg-[#0b0f1a] border border-[#1a1f2e] rounded-xl p-5">
                        <div className="text-[10px] uppercase tracking-widest text-slate-600 mb-4">Principais riscos a monitorizar</div>
                        <div className="space-y-3">
                          {[
                            {
                              label:"Concentração sectorial",
                              desc:`${maxSec} representa ${maxSecPct.toFixed(0)}% da carteira — acima de 35% pode amplificar movimentos sectoriais.`,
                              level:maxSecPct>35?"alto":"moderado",
                            },
                            {
                              label:"Risco cambial (USD/EUR)",
                              desc:"Exposição maioritária a activos USD sem cobertura sistemática — o EUR/USD impacta o valor patrimonial.",
                              level:"moderado",
                            },
                            {
                              label:"Drawdown histórico",
                              desc:`Queda máxima de ${fmtPct(scaledDD)} — ${Math.abs(scaledDD)<=15?"dentro dos parâmetros esperados para o perfil.":"acima do nível típico para o perfil "+pfLabel+"."}`,
                              level:Math.abs(scaledDD)>25?"alto":Math.abs(scaledDD)>15?"moderado":"baixo",
                            },
                          ].map(rk=>(
                            <div key={rk.label} className="flex items-start gap-3">
                              <span className={`text-[10px] font-bold px-2 py-0.5 rounded mt-0.5 shrink-0 ${rk.level==="alto"?"bg-red-900/30 text-red-400":rk.level==="moderado"?"bg-amber-900/30 text-amber-400":"bg-slate-800 text-slate-500"}`}>
                                {rk.level.toUpperCase()}
                              </span>
                              <div>
                                <div className="text-slate-200 text-xs font-semibold mb-0.5">{rk.label}</div>
                                <div className="text-slate-500 text-xs leading-relaxed">{rk.desc}</div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>

                    {/* ── Holdings + Sectors ── */}
                    <div className="grid grid-cols-2 gap-4">
                      <div className="bg-[#0b0f1a] border border-[#1a1f2e] rounded-xl p-5">
                        <div className="text-[10px] uppercase tracking-widest text-slate-600 mb-4">Principais posições ({nEquity} títulos)</div>
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="text-slate-500 border-b border-[#1a1f2e] text-left">
                              <th className="pb-2 font-semibold">Empresa</th>
                              <th className="pb-2 font-semibold text-right">ROIC</th>
                              <th className="pb-2 font-semibold text-right">Peso</th>
                            </tr>
                          </thead>
                          <tbody>
                            {top5.map((r,i)=>{
                              const qd=portfolioQuality?.tickers?.find(t=>t.ticker===r.ticker);
                              const roic=qd?.roic??null;
                              return (
                              <tr key={r.ticker} className="border-b border-[#0f172a]/60 last:border-0">
                                <td className="py-2.5">
                                  <div className="flex items-center gap-2">
                                    <div className="w-2 h-2 rounded-full shrink-0" style={{background:PIE_COLORS[i%PIE_COLORS.length]}}/>
                                    <div>
                                      <div className="text-slate-200 font-semibold">{getCompany(r.ticker)||r.ticker}</div>
                                      <div className="text-slate-600 text-[9px]">{r.ticker} · {getSector(r.ticker)||getZone(r.ticker)}</div>
                                    </div>
                                  </div>
                                </td>
                                <td className="py-2.5 text-right">
                                  {roic!=null?(
                                    <span className={`text-[10px] font-bold ${roic>0.25?"text-emerald-400":roic>0.12?"text-amber-400":"text-slate-500"}`}>
                                      {(roic*100).toFixed(0)}%
                                    </span>
                                  ):<span className="text-slate-700 text-[10px]">—</span>}
                                </td>
                                <td className="py-2.5 text-right font-black text-slate-100 text-sm">{r.weightPct.toFixed(1)}%</td>
                              </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>

                      <div className="bg-[#0b0f1a] border border-[#1a1f2e] rounded-xl p-5">
                        <div className="text-[10px] uppercase tracking-widest text-slate-600 mb-4">Exposição sectorial</div>
                        {topSectors.length>0?(
                          <div className="space-y-3.5">
                            {topSectors.map(([sec,pct],i)=>{
                              const maxPct=topSectors[0]?.[1]??1;
                              return (
                                <div key={sec}>
                                  <div className="flex justify-between text-xs mb-1.5">
                                    <span className="text-slate-300 font-medium">{sec}</span>
                                    <span className="text-slate-200 font-bold">{pct.toFixed(1)}%</span>
                                  </div>
                                  <div className="h-2 bg-slate-800/60 rounded-full">
                                    <div className="h-2 rounded-full transition-all" style={{
                                      width:`${(pct/maxPct)*100}%`,
                                      background:PIE_COLORS[i%PIE_COLORS.length],
                                      opacity:0.8
                                    }}/>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        ):(
                          <div className="text-slate-600 text-sm text-center py-4">Sem dados</div>
                        )}
                      </div>
                    </div>

                    {/* ── Perfil de Qualidade (FMP) ── */}
                    {(portfolioQuality||pqLoading)&&(
                      <div className="bg-[#0b0f1a] border border-[#1a1f2e] rounded-xl p-5">
                        <div className="flex items-center justify-between mb-5">
                          <div>
                            <div className="text-[10px] uppercase tracking-widest text-slate-600 mb-1">Perfil de qualidade da carteira</div>
                            <div className="text-slate-400 text-xs">Médias ponderadas · FMP TTM · vs benchmark 60% SPY / 25% VGK / 10% EWJ / 5% EWC</div>
                          </div>
                        </div>
                        {pqLoading&&!portfolioQuality?(
                          <div className="text-slate-600 text-sm py-4 text-center">A carregar métricas fundamentais…</div>
                        ):(portfolioQuality&&(()=>{
                          const s=portfolioQuality.portfolio_summary;
                          // Benchmark oficial ponderado: 60% SPY + 25% VGK + 10% EWJ + 5% EWC (TTM médias estimadas)
                          const B={roic:0.125,gross:0.44,op:0.162,revG:0.050,debtEq:1.30,net:0.114};
                          const fmt=(v:number|null,pct=true)=>v==null?"n/d":pct?`${(v*100).toFixed(1)}%`:`${v.toFixed(2)}x`;
                          const fmtG=(v:number|null)=>v==null?"n/d":`${v>=0?"+":""}${(v*100).toFixed(1)}%`;
                          const metrics=[
                            {label:"ROIC",val:fmt(s.roic),raw:s.roic,bench:B.roic,benchFmt:`${(B.roic*100).toFixed(1)}%`,higherBetter:true,desc:"Rentabilidade do capital investido"},
                            {label:"Margem bruta",val:fmt(s.gross_margin),raw:s.gross_margin,bench:B.gross,benchFmt:`${(B.gross*100).toFixed(0)}%`,higherBetter:true,desc:"Eficiência operacional"},
                            {label:"Margem operacional",val:fmt(s.op_margin),raw:s.op_margin,bench:B.op,benchFmt:`${(B.op*100).toFixed(1)}%`,higherBetter:true,desc:"Rentabilidade antes de impostos"},
                            {label:"Crescimento receita",val:fmtG(s.revenue_growth),raw:s.revenue_growth,bench:B.revG,benchFmt:`${(B.revG*100).toFixed(1)}%`,higherBetter:true,desc:"Variação anual das vendas"},
                            {label:"Dívida/Capital próprio",val:fmt(s.debt_equity,false),raw:s.debt_equity,bench:B.debtEq,benchFmt:`${B.debtEq.toFixed(1)}x`,higherBetter:false,desc:"Alavancagem do balanço"},
                            {label:"Margem líquida",val:fmt(s.net_margin),raw:s.net_margin,bench:B.net,benchFmt:`${(B.net*100).toFixed(1)}%`,higherBetter:true,desc:"Lucro por euro de receita"},
                          ];
                          return (
                            <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
                              {metrics.map(m=>{
                                const beats=m.raw!=null?(m.higherBetter?m.raw>m.bench:m.raw<m.bench):null;
                                const valColor=m.raw==null?"text-slate-500":beats===true?"text-emerald-400":beats===false?"text-amber-400":"text-slate-300";
                                return(
                                <div key={m.label} className="bg-[#091220] border border-[#1a1f2e]/60 rounded-lg px-4 py-3">
                                  <div className="text-slate-600 text-[10px] font-semibold uppercase tracking-wider mb-1.5">{m.label}</div>
                                  <div className={`text-xl font-black ${valColor}`}>{m.val}</div>
                                  <div className="flex items-center gap-1 mt-1.5">
                                    {m.raw!=null&&(<span className={`text-[9px] leading-none font-bold ${beats===true?"text-emerald-500":beats===false?"text-amber-500":"text-slate-600"}`}>{beats===true?"▲":beats===false?"▼":"—"}</span>)}
                                    <span className="text-slate-600 text-[9px]">bench {m.benchFmt}</span>
                                  </div>
                                </div>
                                );
                              })}
                            </div>
                          );
                        })())}
                      </div>
                    )}

                    {/* ── Investment letter commentary ── */}
                    <div className="bg-gradient-to-br from-[#0b0f1a] to-[#091220] border border-[#1a2030] rounded-2xl p-7">
                      <div className="flex items-center gap-2.5 mb-5">
                        <BookOpen size={15} className="text-teal-400"/>
                        <div className="text-[10px] uppercase tracking-widest text-slate-500">Nota do gestor</div>
                      </div>
                      <div className="space-y-4 text-sm text-slate-400 leading-7">
                        <p>
                          O modelo manteve um posicionamento <span className="text-slate-200 font-semibold">{regimeTxt}</span> ao longo do período,
                          beneficiando de {equityPctReport>=70?"forte exposição a acções globais":"diversificação equilibrada entre acções e liquidez"}.
                          A concentração em <span className="text-slate-200 font-semibold">{maxSec}</span> continuou a ser o principal factor de retorno,
                          {maxSecPct>30?" embora o nível de concentração sectorial mereça acompanhamento continuado.":" com exposição diversificada entre sectores."}
                        </p>
                        <p>
                          Em termos de risco, a volatilidade anualizada situou-se em <span className="text-amber-400 font-semibold">{reportVol.toFixed(1)}%</span>,
                          {reportVol<=18
                            ? " permanecendo alinhada com o perfil de risco seleccionado e dentro dos parâmetros históricos da estratégia."
                            : " ligeiramente acima do nível típico, reflectindo condições de maior dispersão nos mercados globais."}
                          {" "}O drawdown máximo de <span className="text-red-400/80 font-semibold">{fmtPct(scaledDD)}</span> demonstra
                          {Math.abs(scaledDD)<=20?" a capacidade de contenção de perdas da estratégia quantitativa.":" um período de maior pressão — historicamente seguido de recuperação sustentada."}
                        </p>
                        {changes.length>0&&(
                          <p>
                            Neste ciclo de rebalanceamento foram introduzidas <span className="text-slate-200 font-semibold">{changes.length} alterações</span>,
                            com {(officialCounts??actionCounts).comprar+(officialCounts??actionCounts).aumentar} novas entradas ou reforços e {(officialCounts??actionCounts).reduzir+(officialCounts??actionCounts).vender} reduções ou saídas.
                            {top3Changes[0]&&(()=>{const ch=top3Changes[0];const d=ch.cur-ch.prev;return <> A alteração de maior impacto foi em <span className="text-slate-200 font-semibold">{getCompany(ch.ticker)||ch.ticker}</span>{" "}({ch.action.toLowerCase()}, {d>0?"+":""}{d.toFixed(1)}pp).</>;})()}
                          </p>
                        )}
                        {portfolioQuality&&portfolioQuality.portfolio_summary.roic!=null&&(
                          <p>
                            A carteira apresenta um <span className="text-slate-200 font-semibold">ROIC médio ponderado de{" "}
                            {(portfolioQuality.portfolio_summary.roic*100).toFixed(1)}%</span>
                            {portfolioQuality.portfolio_summary.roic>0.20
                              ? ", reflectindo uma selecção orientada para empresas com elevada rentabilidade do capital — um indicador robusto de vantagem competitiva sustentada."
                              : ", com perfil de qualidade moderado."}{" "}
                            {portfolioQuality.portfolio_summary.gross_margin!=null&&(
                              <>A margem bruta média situa-se em{" "}
                              <span className="text-slate-200 font-semibold">{(portfolioQuality.portfolio_summary.gross_margin*100).toFixed(1)}%</span>,
                              {portfolioQuality.portfolio_summary.gross_margin>0.40?" indicando estruturas de custo eficientes e poder de precificação acima da média.":" em linha com a mediana de mercado."}</>
                            )}
                          </p>
                        )}
                        <p className="text-slate-600 text-xs border-t border-white/[0.04] pt-4 leading-relaxed">
                          Este relatório foi gerado pelo sistema DECIDE com base em dados históricos do modelo quantitativo, ajustados ao perfil <span className="italic">{pfLabel}</span>.
                          Métricas fundamentais obtidas via Financial Modeling Prep (TTM). A informação apresentada é de carácter meramente informativo e não constitui recomendação de investimento.
                          Performance passada não garante resultados futuros. <span className="italic">Backtested — simulado.</span>
                        </p>
                      </div>
                    </div>

                  </div>
                );
              })()}

              {/* ── ACTIVIDADE ── */}
              {activePage==="actividade"&&<ActividadePage sortedMonths={sortedMonths}/>}

              {/* ── SIMULADOR ── */}
              {activePage==="simulador"&&(
                <div className="space-y-4">
                  <div className="bg-[#0b0f1a] border border-[#1a1f2e] rounded-xl overflow-hidden">
                    <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-[#1a1f2e]">
                      <div className="flex items-center gap-2">
                        <Activity size={14} className="text-blue-400"/>
                        <h2 className="text-slate-200 text-sm font-bold tracking-wide">Simulação de Capital</h2>
                        <span className="text-[10px] text-slate-500">· Perfil {profileLabel}{kpiMode==="margem"?" · Com margem":""}</span>
                      </div>
                      {!loggedIn&&(
                        <button onClick={()=>setShowRegModal(true)} className="text-[10px] text-blue-400 hover:underline">
                          Guardar simulação →
                        </button>
                      )}
                    </div>
                    <div className="px-5 py-4">
                      <NativeSimulator dates={dates}
                        equity={activeEquity}
                        bench={benchRaw}
                        onRegister={()=>setShowRegModal(true)} loggedIn={loggedIn}
                        volScale={1}
                        profileKey={`${riskProfileLocal}-${kpiMode}`}/>
                    </div>
                  </div>
                  <div className="bg-[#0b0f1a] border border-[#1a1f2e] rounded-xl p-4 text-xs text-slate-500">
                    O simulador usa dados históricos reais com o perfil e modo de margem activos (vol-rule aplicada).
                    Rendimentos passados não garantem resultados futuros.
                  </div>
                </div>
              )}

              {/* ── DASHBOARD ── */}
              {activePage==="dashboard"&&(
                <div className="space-y-5">

                  {/* ── 5 KPI cards ── */}
                  {(()=>{
                    const fmtP=(v:number,s=false)=>`${s&&v>=0?"+":""}${v.toFixed(2)}%`;
                    const fmtE=(v:number)=>v.toLocaleString("pt-PT",{minimumFractionDigits:0,maximumFractionDigits:0});
                    const annVal=perfData?.inception.ann??0;
                    return (
                      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                        {[
                          {label:"Património",val:`€ ${fmtE(aum)}`,sub:"valor actual",
                           icon:<div className="w-8 h-8 rounded-lg bg-blue-500/10 flex items-center justify-center"><Briefcase size={15} className="text-blue-400"/></div>,
                           c:"text-white",accent:"border-blue-500/20"},
                          {label:"Retorno YTD",val:fmtP(scaledYtd,true),sub:`€ ${fmtE(Math.abs(aum*scaledYtd/100))} este ano`,
                           icon:<div className={`w-8 h-8 rounded-lg flex items-center justify-center ${scaledYtd>=0?"bg-teal-500/10":"bg-red-500/10"}`}><TrendingUp size={15} className={scaledYtd>=0?"text-teal-400":"text-red-400"}/></div>,
                           c:scaledYtd>=0?"text-teal-400":"text-red-400",accent:scaledYtd>=0?"border-teal-500/20":"border-red-500/20"},
                          {label:"CAGR (20 anos)",val:fmtP(annVal,true),sub:`perfil ${profileLabel}`,
                           icon:<div className={`w-8 h-8 rounded-lg flex items-center justify-center ${annVal>=0?"bg-teal-500/10":"bg-red-500/10"}`}><Activity size={15} className={annVal>=0?"text-teal-400":"text-red-400"}/></div>,
                           c:annVal>=0?"text-teal-400":"text-red-400",accent:annVal>=0?"border-teal-500/20":"border-red-500/20"},
                          {label:"Volatilidade anual",val:(benchPerfData?.mVol??0)>0?`${(benchPerfData?.mVol??0).toFixed(1)}%`:"—",
                           sub:"vol. benchmark ajustada",
                           icon:<div className="w-8 h-8 rounded-lg bg-amber-500/10 flex items-center justify-center"><ShieldCheck size={15} className="text-amber-400"/></div>,
                           c:"text-amber-400",accent:"border-amber-500/20"},
                          {label:"Drawdown máx.",val:scaledDD!==0?fmtP(scaledDD):"—",
                           sub:"pior queda (20 anos)",
                           icon:<div className="w-8 h-8 rounded-lg bg-red-500/10 flex items-center justify-center"><TrendingDown size={15} className="text-red-400"/></div>,
                           c:"text-red-400",accent:"border-red-500/20"},
                        ].map(k=>(
                          <div key={k.label} className={`bg-[#0b0f1a] border ${k.accent} rounded-xl p-4 hover:bg-[#0d1220] transition-colors duration-200`}>
                            <div className="flex items-center justify-between mb-3">
                              <div className="text-xs text-slate-500 font-medium leading-tight">{k.label}</div>
                              {k.icon}
                            </div>
                            <div className={`text-2xl font-black tracking-tight mb-1 ${k.c}`}>{k.val}</div>
                            <div className="text-[11px] text-slate-600">{k.sub}</div>
                          </div>
                        ))}
                      </div>
                    );
                  })()}

                  {/* ── Row 2: action-count badges + últimas recomendações ── */}
                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

                    {/* Últimas recomendações (2/3 on lg, full on mobile) */}
                    <div className="lg:col-span-2 bg-[#0b0f1a] border border-[#1a1f2e] rounded-xl p-5 hover:border-slate-700/60 transition-colors duration-200">
                      <div className="flex items-center justify-between mb-4">
                        <div className="font-bold text-slate-100 text-sm">Últimas recomendações</div>
                        <button onClick={()=>navigateToPage("reco")} className="text-[11px] text-teal-400 hover:text-teal-300 flex items-center gap-1 transition-colors">Ver todas<ArrowUpRight size={12}/></button>
                      </div>
                      {recoLoading?(
                        <div className="text-slate-500 text-sm text-center py-4">A carregar…</div>
                      ):(
                        <div className="overflow-x-auto">
                        <table className="w-full text-xs min-w-[320px]">
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
                              const acColor=isBuy?"bg-teal-500/15 text-teal-300 border border-teal-500/30":isUp?"bg-blue-500/15 text-blue-300 border border-blue-500/30":isSell?"bg-red-500/15 text-red-300 border border-red-500/30":isDown?"bg-amber-500/15 text-amber-300 border border-amber-500/30":"bg-slate-700/30 text-slate-500";
                              const acIcon=isBuy?"↑":isUp?"↗":isSell?"↓":isDown?"↙":"→";
                              return (
                                <tr key={r.ticker} className="border-b border-[#0d1220] hover:bg-white/[0.03] transition-colors duration-100">
                                  <td className="py-2.5">
                                    <a href={`https://finance.yahoo.com/quote/${getYFTicker(r.ticker)}`} target="_blank" rel="noopener noreferrer"
                                      className="inline-flex items-center gap-1 font-bold text-teal-400 hover:text-teal-300 hover:underline underline-offset-2 transition-colors">
                                      {displayTicker(r.ticker)}<ArrowUpRight size={10} className="opacity-60"/>
                                    </a>
                                    {getCompany(r.ticker)&&<span className="ml-1.5 text-slate-600 text-[10px]">{getCompany(r.ticker)}</span>}
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
                        </div>
                      )}
                    </div>

                    {/* Action count badges (1/3) */}
                    <div className="space-y-3">
                      {(()=>{
                        const oc=officialCounts??actionCounts;
                        const buy =oc.comprar;
                        const up  =oc.aumentar;
                        const down=oc.reduzir;
                        const sell=oc.vender;
                        const hold=oc.manter;
                        return [
                          {label:"Comprar",  n:buy,  bg:"bg-teal-500/10",   border:"border-teal-500/20",   tc:"text-teal-400",   nc:"text-teal-300"},
                          {label:"Aumentar", n:up,   bg:"bg-blue-500/10",   border:"border-blue-500/20",   tc:"text-blue-400",   nc:"text-blue-300"},
                          {label:"Reduzir",  n:down, bg:"bg-amber-500/10",  border:"border-amber-500/20",  tc:"text-amber-400",  nc:"text-amber-300"},
                          {label:"Vender",   n:sell, bg:"bg-red-500/10",    border:"border-red-500/20",    tc:"text-red-400",    nc:"text-red-300"},
                          {label:"Manter",   n:hold, bg:"bg-slate-800/60",  border:"border-slate-700/30",  tc:"text-slate-500",  nc:"text-slate-400"},
                        ].map(x=>(
                          <div key={x.label} className={`flex items-center justify-between rounded-xl px-4 py-3.5 ${x.bg} border ${x.border} hover:brightness-110 transition-all duration-150`}>
                            <span className={`text-xs font-semibold ${x.tc}`}>{x.label}</span>
                            <span className={`text-3xl font-black tabular-nums ${x.nc}`}>{x.n}</span>
                          </div>
                        ));
                      })()}
                    </div>
                  </div>

                  {/* ── Row 3: charts side by side ── */}
                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

                    {/* Performance chart (2/3) — hero */}
                    <div className="lg:col-span-2 bg-[#0b0f1a] border border-[#1a1f2e] rounded-xl p-5 hover:border-slate-700/60 transition-colors duration-200">
                      <div className="flex flex-wrap items-start justify-between mb-4 gap-2">
                        <div>
                          <div className="font-bold text-slate-100 text-sm">Evolução da carteira</div>
                          {perfData&&(
                            <div className="flex gap-5 mt-1.5">
                              <div>
                                <span className="text-[10px] text-slate-600 mr-1">YTD</span>
                                <span className={`font-black text-sm ${scaledYtd>=0?"text-teal-400":"text-red-400"}`}>{scaledYtd>=0?"+":""}{scaledYtd.toFixed(1)}%</span>
                              </div>
                              <div>
                                <span className="text-[10px] text-slate-600 mr-1">CAGR</span>
                                <span className={`font-black text-sm ${scaledAnn>=0?"text-teal-400":"text-red-400"}`}>{scaledAnn>=0?"+":""}{scaledAnn.toFixed(1)}%</span>
                              </div>
                              <div>
                                <span className="text-[10px] text-slate-600 mr-1">Sharpe</span>
                                <span className="font-black text-sm text-slate-200">{perfData.m.shp.toFixed(2)}</span>
                              </div>
                            </div>
                          )}
                        </div>
                        <div className="flex gap-1 bg-[#111827] rounded-lg p-1 overflow-x-auto scrollbar-none shrink-0">
                          {PERIODS.map(p=>(
                            <button key={p} onClick={()=>setPeriod(p)}
                              className={`px-2.5 py-1 text-[10px] font-bold rounded-md transition-all duration-150 whitespace-nowrap ${period===p?"bg-teal-600 text-white shadow":"text-slate-500 hover:text-slate-300"}`}>{p}</button>
                          ))}
                        </div>
                      </div>
                      <ResponsiveContainer width="100%" height={230}>
                        <AreaChart data={perfData?.chart??[]} margin={{top:4,right:8,left:-4,bottom:0}}>
                          <defs>
                            <linearGradient id="heroGrad" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="#14b8a6" stopOpacity={0.25}/>
                              <stop offset="95%" stopColor="#14b8a6" stopOpacity={0}/>
                            </linearGradient>
                          </defs>
                          <XAxis dataKey="date" tick={{fontSize:9,fill:"#475569"}} tickLine={false} axisLine={false} interval={Math.floor((perfData?.chart.length??1)/6)}
                            tickFormatter={(d:string)=>{const dt=new Date(d);return `${dt.toLocaleString("pt-PT",{month:"short"})} '${String(dt.getFullYear()).slice(2)}`;}}/>
                          <YAxis scale="log" domain={["auto","auto"]} allowDataOverflow tick={{fontSize:9,fill:"#475569"}} tickLine={false} axisLine={false} tickFormatter={v=>{const r=(Number(v)/100-1)*100;return `${r>=0?"+":""}${r.toFixed(0)}%`;}} width={44}/>
                          <Tooltip content={<PerfTooltip/>}/>
                          <ReferenceLine y={100} stroke="#1e293b" strokeDasharray="4 4"/>
                          <Area type="monotone" dataKey="modelo" stroke="#14b8a6" strokeWidth={2.5} fill="url(#heroGrad)" dot={false} name="A sua carteira"/>
                          <Area type="monotone" dataKey="bench" stroke="#334155" strokeWidth={1.5} fill="none" dot={false} name={BENCH_SHORT} strokeDasharray="5 3"/>
                        </AreaChart>
                      </ResponsiveContainer>
                      <div className="flex items-center gap-5 mt-2">
                        <div className="flex items-center gap-2 text-[10px] text-slate-500"><div className="w-4 h-0.5 bg-teal-400 rounded"/>A sua carteira</div>
                        <div className="flex items-center gap-2 text-[10px] text-slate-600"><div className="w-4 h-px bg-slate-600 rounded"/>Benchmark (60/40)</div>
                      </div>
                    </div>

                    {/* Allocation donut (1/3) */}
                    <div className="bg-[#0b0f1a] border border-[#1a1f2e] rounded-xl p-5 hover:border-slate-700/60 transition-colors duration-200">
                      <div className="font-bold text-slate-100 text-sm mb-3 flex items-center gap-2">Alocação da carteira<Info size={12} className="text-slate-700"/></div>
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
                      "França":[2,46],
                      "Suécia":[17,62],"Irlanda":[-8,53],"Áustria":[14,47],
                      "Brasil":[-52,-10],"Luxemburgo":[6,49.6],
                      "Portugal":[-8,39],
                    };
                    const topCountries=[...countryAlloc.entries()].sort((a,b)=>b[1]-a[1]);
                    return (
                      <div className="bg-[#0b0f1a] border border-[#1a1f2e] rounded-xl p-5 hover:border-slate-700/60 transition-colors duration-200">
                        <div className="font-bold text-slate-100 text-sm mb-3 flex items-center gap-2">
                          Exposição geográfica
                          <span className="text-[10px] font-normal text-slate-600">% das acções actuais</span>
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
                        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                          <div className="lg:col-span-2">
                            <ComposableMap
                              projection="geoNaturalEarth1"
                              projectionConfig={{scale:140,center:[10,10]}}
                              style={{width:"100%",height:"auto"}}
                            >
                              <ZoomableGroup zoom={1} center={[10,10]} disablePanning>
                                <Geographies geography="https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json">
                                  {({geographies})=>geographies.map(geo=>{
                                    // Australia=36, China=156, AU territories=162/166/334/574
                                    const geoNum=Number(geo.id);
                                    const isoId=String(geo.id).padStart(3,"0");
                                    if([36,156,162,166,334,574].includes(geoNum)||["036","156","162","166","334","574"].includes(isoId))return(
                                      <Geography key={geo.rsmKey} geography={geo} fill="#111827" stroke="#1e293b" strokeWidth={0.5} style={{default:{outline:"none"},hover:{outline:"none",fill:"#111827"},pressed:{outline:"none"}}}/>
                                    );
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
                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

                    {/* Principais posições (2/3) */}
                    <div className="lg:col-span-2 bg-[#0b0f1a] border border-[#1a1f2e] rounded-xl p-5">
                      <div className="flex items-center justify-between mb-3">
                        <div className="font-bold text-slate-200 text-sm">Principais posições</div>
                        <button onClick={()=>navigateToPage("carteira")} className="text-[10px] text-blue-400 hover:underline">Ver carteira completa</button>
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
                      <NativeSimulator dates={dates}
                        equity={activeEquity}
                        bench={benchRaw}
                        onRegister={()=>setShowRegModal(true)} loggedIn={loggedIn}
                        volScale={1}
                        profileKey={`${riskProfileLocal}-${kpiMode}`}/>
                    </div>
                  </div>

              </div>
              )}

              {/* ── RECOMENDAÇÕES ── */}
              {activePage==="reco"&&(
              <div className="w-full min-w-0 max-w-full space-y-4">{/* contenção: evita largura da página > viewport no mobile */}
              <div data-section="reco" className="bg-[#0b0f1a] border border-[#1a1f2e] rounded-xl p-5 lg:p-6 w-full min-w-0 max-w-full overflow-hidden">
                <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-5 lg:gap-8 min-w-0">
                  {/* Action counts */}
                  <div className="flex-1 min-w-0 max-w-full">
                    <div className="text-xs text-slate-500 font-medium mb-4 uppercase tracking-widest">Recomendação · {recoLabel}</div>
                    <div className="flex max-w-full flex-nowrap gap-2 overflow-x-auto overflow-y-visible pb-1 scrollbar-none snap-x snap-mandatory [-webkit-overflow-scrolling:touch] lg:flex-wrap lg:gap-4 lg:overflow-visible lg:pb-0">
                      {[
                        {label:"Nova posição", count:recoLoading?0:(officialCounts??actionCounts).comprar,  c:"text-teal-400",  bg:"bg-teal-500/10",  b:"border-teal-500/20"},
                        {label:"Reforçar",     count:recoLoading?0:(officialCounts??actionCounts).aumentar, c:"text-blue-400",  bg:"bg-blue-500/10",  b:"border-blue-500/20"},
                        {label:"Reduzir",      count:recoLoading?0:(officialCounts??actionCounts).reduzir,  c:"text-amber-400", bg:"bg-amber-500/10", b:"border-amber-500/20"},
                        {label:"Encerrar",     count:recoLoading?0:(officialCounts??actionCounts).vender,   c:"text-red-400",   bg:"bg-red-500/10",   b:"border-red-500/20"},
                        {label:"Manter",       count:recoLoading?0:(officialCounts??actionCounts).manter,   c:"text-slate-400", bg:"bg-slate-800/40", b:"border-slate-700/30"},
                      ].map(x=>(
                        <div key={x.label} className={`flex shrink-0 snap-start flex-col items-center gap-1.5 rounded-xl px-4 py-3 ${x.bg} border ${x.b} min-w-[4.75rem] lg:min-w-[68px] lg:shrink`}>
                          <span className={`text-2xl lg:text-3xl font-black tabular-nums ${x.c}`}>{x.count}</span>
                          <span className={`text-[10px] font-semibold ${x.c} opacity-80`}>{x.label}</span>
                        </div>
                      ))}
                    </div>
                    <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-slate-500 pt-4 border-t border-[#1a1f2e]">
                      <span>Risco estimado: <span className="text-teal-400 font-semibold">↓ Ligeiro</span></span>
                      <span className="hidden sm:inline text-slate-700">·</span>
                      <span>Retorno esperado: <span className="text-blue-400 font-semibold">↑ Moderado</span></span>
                      <span className="hidden sm:inline text-slate-700">·</span>
                      <span>Perfil: <span className="text-slate-300 font-semibold">{profileLabel}</span></span>
                    </div>
                  </div>
                  {/* CTA */}
                  <div className="flex flex-row lg:flex-col gap-2 lg:min-w-[200px] shrink-0">
                    <button onClick={()=>navigateToPage(loggedIn?"ordens":"reco")}
                      onClickCapture={!loggedIn?()=>setShowRegModal(true):undefined}
                      className="flex-1 lg:flex-none bg-teal-600 hover:bg-teal-500 text-white text-sm font-bold px-5 py-3 rounded-xl flex items-center justify-center gap-2 transition-all shadow-lg shadow-teal-900/40 ring-1 ring-teal-500/30 active:scale-100 min-h-[48px]">
                      <CheckCircle2 size={16}/> Aprovar Plano
                    </button>
                    <button onClick={()=>navigateToPage("carteira")} className="flex-1 lg:flex-none bg-[#111827] border border-[#252a3a] hover:bg-[#151929] text-slate-400 text-xs font-semibold px-4 py-3 rounded-lg transition-colors min-h-[44px]">
                      Ver carteira completa
                    </button>
                  </div>
                </div>
              </div>

              {/* O que mudou (full width) */}
              <div className="bg-[#0b0f1a] border border-[#1a1f2e] rounded-xl p-5 w-full min-w-0 max-w-full overflow-hidden">
                <SH title="O que mudou"/>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 lg:gap-6 mt-3">
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
              <div className="bg-[#0b0f1a] border border-[#1a1f2e] rounded-xl overflow-hidden p-5 w-full min-w-0 max-w-full">
                <div className="flex flex-wrap items-center justify-between gap-2 mb-4 px-0 lg:mb-4 lg:px-0 min-w-0">
                  <SH title="Recomendações"/>
                  <span className="text-slate-500 text-xs -mt-4">{actionCounts.allRows.length} posições</span>
                </div>
                {recoLoading?(
                  <div className="text-slate-500 text-sm text-center py-6">A carregar…</div>
                ):actionCounts.allRows.length===0?(
                  <div className="text-slate-500 text-sm text-center py-6">Sem recomendações este mês</div>
                ):(
                  <div className="w-full min-w-0 max-w-full overflow-x-auto overscroll-x-contain">
                  <table className="w-full min-w-[520px] border-collapse text-xs">
                    <thead><tr className="text-slate-500 border-b border-[#1a1f2e]">
                      <th className="py-2 pl-0 pr-2 text-left font-semibold">Ativo</th>
                      <th className="hidden py-2 px-2 text-left font-semibold sm:table-cell">Setor</th>
                      <th className="hidden py-2 px-2 text-left font-semibold sm:table-cell">País</th>
                      <th className="whitespace-nowrap py-2 px-2 text-right font-semibold sm:px-3">
                        <span title="Peso no plano do mês anterior">Mês ant.</span>
                      </th>
                      <th className="whitespace-nowrap py-2 px-2 text-right font-semibold sm:px-3">
                        <span title="Peso no plano deste mês">Este mês</span>
                      </th>
                      <th className="hidden py-2 px-2 text-right font-semibold sm:table-cell">&#916;</th>
                      <th className="whitespace-nowrap py-2 pl-2 pr-0 text-right font-semibold sm:pr-1">Ação</th>
                    </tr></thead>
                    <tbody>
                      {(()=>{
                        // Advisory display labels
                        const actionLabel=(a:string)=>a==="Comprar"?"Nova posição":a==="Aumentar"?"Reforçar":a==="Vender"?"Encerrar":a;
                        const actionColor=(a:string)=>a==="Comprar"?"text-teal-400 bg-teal-500/10 border-teal-500/25":a==="Aumentar"?"text-blue-400 bg-blue-500/10 border-blue-500/25":a==="Vender"?"text-red-400 bg-red-500/10 border-red-500/25":a==="Reduzir"?"text-amber-400 bg-amber-500/10 border-amber-500/25":"text-slate-500 bg-slate-800/40 border-slate-700/30";
                        const rowAccent=(a:string)=>a==="Comprar"?"border-l-2 border-l-teal-500/40":a==="Aumentar"?"border-l-2 border-l-blue-500/40":a==="Vender"?"border-l-2 border-l-red-500/40":a==="Reduzir"?"border-l-2 border-l-amber-500/40":"border-l-2 border-l-transparent";
                        let lastAction="";
                        return actionCounts.allRows.map(r=>{
                          const dc=r.delta>0?"text-teal-400":r.delta<0?"text-red-400":"text-slate-600";
                          const isXeon=r.ticker==="XEON";
                          const showGroupSep=!isXeon&&r.action!==lastAction&&lastAction!=="";
                          if(!isXeon) lastAction=r.action;
                          return (
                            <React.Fragment key={r.ticker}>
                              {showGroupSep&&<tr><td colSpan={7} className="h-px bg-[#1a1f2e] p-0"/></tr>}
                              <tr
                                onClick={!isXeon?()=>setExpandedReco(v=>v===r.ticker?null:r.ticker):undefined}
                                className={`border-b border-[#0d1220] transition-colors duration-100 ${isXeon?"opacity-60":"cursor-pointer hover:bg-white/[0.03]"} ${!isXeon?rowAccent(r.action):""} ${expandedReco===r.ticker?"bg-white/[0.03]":""}`}>
                                <td className="py-3 pl-0 pr-2 sm:pl-1">
                                  {isXeon?(
                                    <span className="font-bold text-slate-400">XEON</span>
                                  ):(
                                    <span className="inline-flex items-center gap-1.5 font-bold text-slate-200">
                                      {displayTicker(r.ticker)}
                                      <span className={`transition-transform duration-150 text-slate-600 text-[9px] ${expandedReco===r.ticker?"rotate-90":"rotate-0"}`}>▶</span>
                                    </span>
                                  )}
                                  {getCompany(r.ticker)&&<div className="text-slate-600 font-normal text-[10px] mt-0.5 leading-tight">{getCompany(r.ticker)}</div>}
                                  <div className="sm:hidden text-slate-600 text-[10px] mt-0.5">{getSector(r.ticker)}</div>
                                </td>
                                <td className="py-3 px-3 text-slate-500 text-[11px] hidden sm:table-cell">{getSector(r.ticker)}</td>
                                <td className="py-3 px-3 text-slate-500 text-[11px] hidden sm:table-cell">{getZone(r.ticker)}</td>
                                <td className="py-3 px-4 text-right text-slate-500 whitespace-nowrap">{r.prev>0?`${r.prev.toFixed(1)}%`:"—"}</td>
                                <td className="py-3 px-4 text-right text-slate-200 font-semibold whitespace-nowrap">{r.cur>0?`${r.cur.toFixed(1)}%`:"—"}</td>
                                <td className={`py-3 px-3 text-right font-semibold whitespace-nowrap hidden sm:table-cell ${dc}`}>{r.delta!==0?`${r.delta>0?"+":""}${r.delta.toFixed(1)}%`:"—"}</td>
                                <td className="py-3 pr-3 sm:pr-4 text-right whitespace-nowrap">
                                  {!isXeon&&<span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border ${actionColor(r.action)}`}>{actionLabel(r.action)}</span>}
                                </td>
                              </tr>
                              {/* ── Painel editorial FMP (expansão) ── */}
                              {expandedReco===r.ticker&&!isXeon&&(()=>{
                                const qd=portfolioQuality?.tickers?.find(t=>t.ticker===r.ticker);
                                const scoreRaw=(latestMonth?.rows??[]).find((x:any)=>x.ticker===r.ticker||x.ticker===r.ticker.replace("XYZ","SQ"))?.score??null;
                                const score=scoreRaw??0;
                                const momentumLabel=score>50?"Convicção máxima no modelo":score>30?"Convicção forte no modelo":score>15?"Convicção moderada no modelo":"Convicção reduzida no modelo";
                                const momentumColor=score>50?"text-emerald-400":score>30?"text-teal-400":score>15?"text-amber-400":"text-slate-500";
                                type Bullet={dot:string;text:string};
                                const bullets:Bullet[]=[];
                                bullets.push({dot:score>30?"bg-teal-500":score>15?"bg-amber-500":"bg-slate-600",text:momentumLabel});
                                if(qd?.roic!=null){
                                  const roic=qd.roic as number;
                                  const roicPct=(roic*100).toFixed(1);
                                  const roicLabel=roic>0.25?`ROIC ${roicPct}% — rentabilidade operacional elevada`:roic>0.12?`ROIC ${roicPct}% — rentabilidade sólida`:roic>0?`ROIC ${roicPct}% — rentabilidade moderada`:`ROIC ${roicPct}% — rentabilidade reduzida`;
                                  bullets.push({dot:roic>0.12?"bg-emerald-500":roic>0?"bg-amber-500":"bg-red-500",text:roicLabel});
                                }
                                if(qd?.revenue_growth!=null){
                                  const g=qd.revenue_growth as number;
                                  const gPct=(g*100).toFixed(1);
                                  bullets.push({dot:g>0.10?"bg-emerald-500":g>0?"bg-amber-500":"bg-red-500",text:`Crescimento de receita ${g>0?"+":""}${gPct}%`});
                                }
                                if(qd?.gross_margin!=null){
                                  const gm=qd.gross_margin as number;
                                  bullets.push({dot:gm>0.40?"bg-emerald-500":gm>0.20?"bg-amber-500":"bg-slate-500",text:`Margem bruta ${(gm*100).toFixed(1)}%${gm>0.40?" — perfil de qualidade elevado":gm>0.20?" — perfil moderado":" — margens sob pressão"}`});
                                }
                                if(qd?.debt_equity!=null){
                                  const de=qd.debt_equity as number;
                                  bullets.push({dot:de<1.0?"bg-emerald-500":de<2.5?"bg-amber-500":"bg-red-500",text:`Dívida/Capital ${de.toFixed(2)}x${de<1.0?" — balanço sólido":de<2.5?" — estrutura financeira moderada":" — exposição a dívida significativa"}`});
                                }
                                const hasFmp=qd&&(qd.roic!=null||qd.revenue_growth!=null);
                                return(
                                  <tr className="bg-[#080c14] border-b border-[#0d1220]">
                                    <td colSpan={7} className="px-6 py-4">
                                      <div className="flex flex-col items-stretch gap-4 sm:flex-row sm:items-start sm:gap-8 min-w-0">
                                        <div className="flex-1">
                                          <div className="text-[10px] text-slate-600 uppercase tracking-widest mb-3 font-semibold">Análise da posição</div>
                                          <div className="space-y-2">
                                            {bullets.map((b,i)=>(
                                              <div key={i} className="flex items-center gap-2.5">
                                                <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${b.dot}`}/>
                                                <span className="text-xs text-slate-300">{b.text}</span>
                                              </div>
                                            ))}
                                            {!hasFmp&&(
                                              <div className="flex items-center gap-2.5">
                                                <div className="w-1.5 h-1.5 rounded-full bg-slate-700 shrink-0"/>
                                                <span className="text-xs text-slate-600 italic">Análise detalhada não disponível para esta posição</span>
                                              </div>
                                            )}
                                          </div>
                                        </div>
                                        {scoreRaw!=null&&(
                                          <div className="shrink-0 text-right">
                                            <div className="text-[10px] text-slate-600 uppercase tracking-widest mb-2 font-semibold">Convicção</div>
                                            <div className={`text-2xl font-black tabular-nums ${momentumColor}`}>{score.toFixed(0)}</div>
                                            <div className="text-[10px] text-slate-600 mt-0.5">quantitativo</div>
                                          </div>
                                        )}
                                      </div>
                                    </td>
                                  </tr>
                                );
                              })()}
                            </React.Fragment>
                          );
                        });
                      })()}
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
                  </div>
                )}
              </div>
              </div>
            )}

              {/* ── CARTEIRA ── */}
              {activePage==="carteira"&&(
                <div className="w-full min-w-0 space-y-4 sm:space-y-5">

                  {/* ── Summary strip ── */}
                  {(()=>{
                    const planMap=new Map<string,number>();
                    actionCounts.allRows.forEach(r=>{
                      planMap.set(r.ticker.toUpperCase(),r.cur);
                      planMap.set(toIbTicker(r.ticker),r.cur);
                    });
                    const equityPct=latestMonth?(100-(latestMonth.tbillsTotalPct??0)):0;
                    const cashPct=latestMonth?(latestMonth.tbillsTotalPct??0):0;
                    const topSector=sectorData[0];
                    // Alignment score from IB positions vs plan
                    const aligned=cartIbPos&&cartIbPos.length>0&&aum>0?(()=>{
                      const sumDev=cartIbPos.reduce((s,p)=>{
                        const pct=(p.value_eur??p.value)/aum*100;
                        const tgt=planMap.get(p.ticker.toUpperCase())??0;
                        return s+Math.abs(pct-tgt);
                      },0);
                      const missingDev=actionCounts.allRows.reduce((s,r)=>{
                        const ibAlias=toIbTicker(r.ticker);
                        const has=(cartIbPos??[]).some(p=>p.ticker.toUpperCase()===r.ticker.toUpperCase()||p.ticker.toUpperCase()===ibAlias);
                        return r.cur>0&&!has?s+r.cur:s;
                      },0);
                      return Math.max(0,100-(sumDev+missingDev)/2);
                    })():null;
                    const nDevRel=cartIbPos?cartIbPos.filter(p=>{
                      const pct=(p.value_eur??p.value)/aum*100;
                      const tgt=planMap.get(p.ticker.toUpperCase())??0;
                      return Math.abs(pct-tgt)>=1;
                    }).length:0;
                    return(
                      <div className="grid grid-cols-4 gap-3 max-lg:grid-cols-2">
                        {[
                          {label:"Acções", val:`${equityPct.toFixed(0)}%`, sub:"exposição a acções", c:"text-teal-400", acc:"border-teal-500/20", bg:"bg-teal-500/5"},
                          {label:"Liquidez (MM)", val:`${cashPct.toFixed(0)}%`, sub:"XEON / cash", c:"text-slate-300", acc:"border-slate-600/30", bg:"bg-slate-800/20"},
                          {label:"Sector principal", val:topSector?.name??"—", sub:`${topSector?.value??0}% do portfolio`, c:"text-blue-400", acc:"border-blue-500/20", bg:"bg-blue-500/5"},
                          aligned!==null
                            ?{label:"Alinhamento c/ plano", val:`${aligned.toFixed(0)}%`, sub:`${nDevRel} posição(ões) com desvio ≥1pp`, c:aligned>=90?"text-teal-400":aligned>=70?"text-amber-400":"text-red-400", acc:aligned>=90?"border-teal-500/20":aligned>=70?"border-amber-500/20":"border-red-500/20", bg:aligned>=90?"bg-teal-500/5":aligned>=70?"bg-amber-500/5":"bg-red-500/5"}
                            :{label:"Alinhamento c/ plano", val:"—", sub:"carregue posições IB", c:"text-slate-500", acc:"border-slate-700/30", bg:"bg-slate-800/20"},
                        ].map(k=>(
                          <div key={k.label} className={`rounded-xl px-4 py-4 border ${k.acc} ${k.bg}`}>
                            <div className="text-[10px] text-slate-500 font-medium mb-2 uppercase tracking-wide">{k.label}</div>
                            <div className={`text-xl font-black ${k.c}`}>{k.val}</div>
                            <div className="text-[10px] text-slate-600 mt-1">{k.sub}</div>
                          </div>
                        ))}
                      </div>
                    );
                  })()}

                  {/* Tab bar */}
                  <div className="flex gap-0 bg-[#0b0f1a] border border-[#1a1f2e] rounded-xl p-1 w-fit">
                    <button onClick={()=>setCartTab("ib")}
                      className={`px-5 py-2.5 rounded-lg text-xs font-bold transition-all duration-150 ${cartTab==="ib"?"bg-[#1a1f2e] text-slate-100":"text-slate-500 hover:text-slate-300"}`}>
                      Carteira real (IB)
                    </button>
                    <button onClick={()=>setCartTab("plano")}
                      className={`px-5 py-2.5 rounded-lg text-xs font-bold transition-all duration-150 flex items-center gap-2 ${cartTab==="plano"?"bg-teal-600 text-white":"text-slate-500 hover:text-slate-300"}`}>
                      Plano modelo
                      <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-black ${cartTab==="plano"?"bg-white/20 text-white":"bg-teal-500/20 text-teal-400"}`}>
                        {recoLabel}
                      </span>
                    </button>
                  </div>

                  {/* ── TAB: Carteira real IB ── */}
                  {cartTab==="ib"&&(
                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <div className="text-slate-500 text-xs">
                          {cartIbPos!==null&&!cartIbErr&&(
                            <span>
                            <span className="text-slate-300 font-semibold">{cartIbPos.length}</span> posições
                            {" · "}investido <span className="text-teal-400 font-semibold">{cartIbPos.reduce((s,p)=>s+(p.value_eur??p.value),0).toLocaleString("pt-PT",{minimumFractionDigits:0,maximumFractionDigits:0})} €</span>
                            {cartIbNav.value>0&&<span className="text-slate-600 ml-2">(conta paper: {cartIbNav.value.toLocaleString("pt-PT",{minimumFractionDigits:0,maximumFractionDigits:0})} {cartIbNav.ccy})</span>}
                          </span>
                          )}
                        </div>
                        <button onClick={fetchCartIbPositions} disabled={cartIbLoading}
                          className="flex items-center gap-1.5 bg-[#0b0f1a] border border-[#1a1f2e] hover:border-teal-500/50 text-slate-400 hover:text-slate-200 text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50">
                          {cartIbLoading?<span className="animate-spin text-xs">⟳</span>:null}
                          {cartIbLoading?"A ligar ao IB…":"↻ Actualizar"}
                        </button>
                      </div>
                      {cartIbErr&&(
                        <div className="bg-red-900/20 border border-red-500/30 rounded-xl px-4 py-4 space-y-2">
                          <div className="flex items-center gap-2">
                            <span className="text-red-400 text-sm font-semibold">
                              {cartIbErr.includes("inacessível")||cartIbErr.includes("530")||cartIbErr.includes("521")||cartIbErr.includes("522")||cartIbErr.includes("523")||cartIbErr.includes("524")
                                ? "Servidor offline"
                                : cartIbErr.includes("Timeout")
                                  ? "Timeout de ligação"
                                  : "Erro de ligação IB"}
                            </span>
                          </div>
                          <p className="text-red-300/80 text-[11px] leading-relaxed">{cartIbErr}</p>
                          {(cartIbErr.includes("inacessível")||cartIbErr.includes("530"))&&(
                            <p className="text-amber-400/80 text-[10px] leading-relaxed border-t border-red-500/20 pt-2">
                              O processo FastAPI/uvicorn no servidor remoto parou. Aceda ao servidor e reinicie o serviço backend (<code className="bg-black/30 px-1 py-0.5 rounded">systemctl restart decide-api</code> ou equivalente).
                            </p>
                          )}
                        </div>
                      )}
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
                        <div className="bg-[#0b0f1a] border border-[#1a1f2e] rounded-xl overflow-hidden w-full min-w-0 max-w-full">
                          <div className="w-full min-w-0 overflow-x-auto px-0">
                          <table className="w-full min-w-[520px] border-collapse text-xs">
                            <thead><tr className="text-slate-500 border-b border-[#1a1f2e] font-semibold">
                              <th className="px-2 py-3 text-left sm:px-3">Ativo</th>
                              <th className="hidden px-2 py-3 text-left sm:table-cell">Nome</th>
                              <th className="hidden px-2 py-3 text-left sm:table-cell">Setor</th>
                              <th className="hidden px-2 py-3 text-left sm:table-cell">País</th>
                              <th className="hidden px-2 py-3 text-right sm:table-cell">Qtd</th>
                              <th className="whitespace-nowrap px-2 py-3 text-right sm:px-3">Valor</th>
                              <th className="whitespace-nowrap px-2 py-3 text-right sm:px-3">Peso %</th>
                              <th className="whitespace-nowrap px-2 py-3 text-right text-slate-600 sm:px-3" title="Diferença face ao peso-alvo do plano">Desvio</th>
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
                                  const valEur=p.value_eur??p.value;
                                  const pctOfPlan=aum>0?(valEur/aum*100):0;
                                  const planTarget=planMap.get(p.ticker.toUpperCase())??0;
                                  const desvio=pctOfPlan-planTarget;
                                  const isOrphan=planTarget===0&&p.ticker!=="MM Euro";
                                  const absD=Math.abs(desvio);
                                  const devBadge=isOrphan
                                    ?"text-red-400 bg-red-500/10 border-red-500/25"
                                    :absD<0.5?"text-slate-600 bg-transparent border-transparent"
                                    :absD<1?"text-slate-400 bg-slate-700/30 border-slate-600/30"
                                    :desvio>0?"text-amber-400 bg-amber-500/10 border-amber-500/25"
                                    :"text-blue-400 bg-blue-500/10 border-blue-500/25";
                                  const desvioTxt=isOrphan?"fora do plano":absD<0.5?"alinhado":`${desvio>0?"+":""}${desvio.toFixed(1)}pp`;
                                  return(
                                    <tr key={p.ticker} className="border-b border-[#0d1220] hover:bg-white/[0.02] transition-colors duration-100">
                                      <td className="px-3 sm:px-4 py-3">
                                        <a href={`https://finance.yahoo.com/quote/${p.ticker}`} target="_blank" rel="noopener noreferrer"
                                          className="inline-flex items-center gap-1 font-bold text-slate-200 hover:text-teal-400 hover:underline underline-offset-2 transition-colors">
                                          {displayTicker(p.ticker)}<ArrowUpRight size={10} className="opacity-40"/>
                                        </a>
                                        <div className="sm:hidden text-[10px] text-slate-600 mt-0.5">{getSector(p.ticker)||"—"}</div>
                                      </td>
                                      <td className="px-2 py-3 text-slate-500 text-[11px] hidden sm:table-cell">{(p as any).name||"—"}</td>
                                      <td className="px-2 py-3 text-slate-500 text-[11px] hidden sm:table-cell">{getSector(p.ticker)||(p as any).sector||"—"}</td>
                                      <td className="px-2 py-3 text-slate-500 text-[11px] hidden sm:table-cell">{COUNTRY[p.ticker.toUpperCase()]||(p as any).country||"—"}</td>
                                      <td className="px-2 py-3 text-right text-slate-400 tabular-nums hidden sm:table-cell">{p.qty.toLocaleString("pt-PT",{maximumFractionDigits:2})}</td>
                                      <td className="px-3 sm:px-4 py-3 text-right text-slate-300 font-medium tabular-nums whitespace-nowrap">
                                        {(p.value_eur??p.value).toLocaleString("pt-PT",{minimumFractionDigits:0,maximumFractionDigits:0})} €
                                        {p.currency&&p.currency!=="EUR"&&p.value_eur!=null&&<span className="text-slate-600 ml-0.5 text-[9px] hidden sm:inline">≈€</span>}
                                      </td>
                                      <td className="px-3 sm:px-4 py-3 text-right whitespace-nowrap">
                                        <span className={`font-bold tabular-nums ${pctOfPlan>8?"text-teal-300":pctOfPlan>4?"text-teal-400":pctOfPlan>1?"text-slate-300":"text-slate-500"}`}>
                                          {pctOfPlan.toFixed(1)}%
                                        </span>
                                      </td>
                                      <td className="px-3 sm:px-4 py-3 text-right whitespace-nowrap" title={planTarget>0?`Alvo no plano: ${planTarget.toFixed(1)}%`:"Não está no plano"}>
                                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border ${devBadge}`}>
                                          {desvioTxt}
                                        </span>
                                      </td>
                                    </tr>
                                  );
                                });
                              })()}
                            </tbody>
                            <tfoot>
                              {(()=>{
                                const totalInvestedEur=cartIbPos.reduce((s,p)=>s+(p.value_eur??p.value),0);
                                const pctInvested=aum>0?(totalInvestedEur/aum*100):0;
                                // Sum of absolute deviations vs plan (same alias-aware map)
                                const planMap2=new Map<string,number>();
                                actionCounts.allRows.forEach(r=>{
                                  planMap2.set(r.ticker.toUpperCase(),r.cur);
                                  const ibAlias=toIbTicker(r.ticker);
                                  if(ibAlias!==r.ticker.toUpperCase()) planMap2.set(ibAlias,r.cur);
                                });
                                const sumAbsDesvio=cartIbPos.reduce((s,p)=>{
                                  const pct=aum>0?((p.value_eur??p.value)/aum*100):0;
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
                                      <td className="px-4 py-2.5 text-xs font-bold text-slate-300">
                                        Investido
                                        <span className="ml-1.5 text-[10px] font-normal text-slate-500">
                                          (plano {(aum/1000).toFixed(0)}k€)
                                        </span>
                                      </td>
                                      <td className="px-2 py-2.5 text-right text-xs text-slate-500 hidden sm:table-cell">—</td>
                                      <td className="px-2 py-2.5 text-right text-xs text-slate-500 hidden sm:table-cell">—</td>
                                      <td className="px-2 py-2.5 text-right text-xs text-slate-500 hidden sm:table-cell">—</td>
                                      <td className="px-2 py-2.5 text-right text-xs text-slate-500 hidden sm:table-cell">—</td>
                                      <td className="px-2 py-2.5 text-right text-xs font-bold text-emerald-400">
                                        {totalInvestedEur.toLocaleString("pt-PT",{minimumFractionDigits:0,maximumFractionDigits:0})} €
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
                        </div>
                      )}
                    </div>
                  )}

                  {/* ── TAB: Plano modelo ── */}
                  {cartTab==="plano"&&<div className="space-y-5">{(()=>{
                    const equityPct=latestMonth?(100-(latestMonth.tbillsTotalPct??0)):0;
                    const cashPct=latestMonth?(latestMonth.tbillsTotalPct??0):0;
                    return <>

                  {/* ── Comité header — full narrative ── */}
                  <div className="bg-[#0b0f1a] border border-[#1a1f2e] rounded-2xl p-6">
                    <div className="flex items-start justify-between gap-6 mb-5">
                      <div>
                        <div className="flex items-center gap-2 mb-2">
                          <div className="w-1.5 h-1.5 rounded-full bg-teal-400 animate-pulse"/>
                          <span className="text-[10px] text-teal-500 uppercase tracking-widest font-bold">Comité de Investimento Digital · {recoLabel}</span>
                        </div>
                        <div className="text-slate-100 font-bold text-base mb-1">Plano modelo recomendado</div>
                        <div className="text-slate-500 text-xs">Alocação óptima calculada pelo modelo quantitativo DECIDE V5 · {actionCounts.allRows.length} posições</div>
                      </div>
                      <button onClick={()=>navigateToPage("reco")} className="shrink-0 bg-teal-600 hover:bg-teal-500 text-white text-sm font-bold px-5 py-2.5 rounded-xl flex items-center gap-2 transition-all hover:scale-[1.02] shadow-lg shadow-teal-900/30">
                        <CheckCircle2 size={14}/> Aprovar plano
                      </button>
                    </div>

                    {/* Status strip */}
                    <div className="grid grid-cols-4 gap-3 mb-5">
                      {[
                        {label:"Acções", val:`${equityPct.toFixed(0)}%`, c:"text-teal-400"},
                        {label:"Liquidez", val:`${cashPct.toFixed(0)}%`, c:"text-slate-400"},
                        {label:"Alterações", val:nChanges, c:nChanges>0?"text-amber-400":"text-slate-400"},
                        {label:"Manter", val:actionCounts.manter, c:"text-slate-400"},
                      ].map(x=>(
                        <div key={x.label} className="bg-white/[0.03] rounded-xl px-4 py-3 border border-white/[0.05]">
                          <div className="text-[10px] text-slate-600 uppercase tracking-wide mb-1">{x.label}</div>
                          <div className={`text-xl font-black ${x.c}`}>{x.val}</div>
                        </div>
                      ))}
                    </div>

                    {/* Narrative: O que mudou */}
                    {whatChanged.length>0&&(
                      <div className="border-t border-white/[0.06] pt-4">
                        <div className="text-[10px] text-slate-600 uppercase tracking-wide mb-3">O que mudou este mês</div>
                        <div className="grid grid-cols-2 gap-3">
                          {whatChanged.map((b,i)=>(
                            <div key={i} className="flex items-start gap-3">
                              <div className={`w-6 h-6 rounded-lg flex items-center justify-center shrink-0 mt-0.5 ${b.icon==="up"?"bg-teal-500/15":b.icon==="down"?"bg-red-500/15":"bg-slate-700/40"}`}>
                                {b.icon==="up"&&<TrendingUp size={12} className="text-teal-400"/>}
                                {b.icon==="down"&&<TrendingDown size={12} className="text-red-400"/>}
                                {b.icon==="globe"&&<Globe size={12} className="text-blue-400"/>}
                                {b.icon==="wave"&&<Activity size={12} className="text-slate-400"/>}
                              </div>
                              <div>
                                <div className="text-xs font-semibold text-slate-300">{b.title}</div>
                                <div className="text-[11px] text-slate-600 mt-0.5">{b.desc}</div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Impact: Se aprovar */}
                    {nChanges>0&&(
                      <div className="border-t border-white/[0.06] pt-4 mt-4">
                        <div className="text-[10px] text-slate-600 uppercase tracking-wide mb-3">Se aprovar este plano</div>
                        <div className="flex flex-wrap gap-2">
                          {actionCounts.comprar>0&&<span className="px-3 py-1 rounded-full bg-teal-500/10 border border-teal-500/20 text-teal-400 text-[11px] font-semibold">{actionCounts.comprar} nova(s) posição(ões)</span>}
                          {actionCounts.aumentar>0&&<span className="px-3 py-1 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-400 text-[11px] font-semibold">{actionCounts.aumentar} posição(ões) reforçadas</span>}
                          {actionCounts.reduzir>0&&<span className="px-3 py-1 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-400 text-[11px] font-semibold">{actionCounts.reduzir} posição(ões) reduzidas</span>}
                          {actionCounts.vender>0&&<span className="px-3 py-1 rounded-full bg-red-500/10 border border-red-500/20 text-red-400 text-[11px] font-semibold">{actionCounts.vender} encerrada(s)</span>}
                          <span className="px-3 py-1 rounded-full bg-slate-700/30 border border-slate-600/20 text-slate-400 text-[11px]">volatilidade mantém-se alinhada com perfil {profileLabel}</span>
                          <span className="px-3 py-1 rounded-full bg-slate-700/30 border border-slate-600/20 text-slate-400 text-[11px]">{actionCounts.manter} posições mantidas sem alteração</span>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* ── Composição: sector + geo ── */}
                  <div className="grid grid-cols-2 gap-4">
                    {/* Sector — horizontal bars premium */}
                    <div className="bg-[#0b0f1a] border border-[#1a1f2e]/60 rounded-xl p-5">
                      <div className="text-xs font-bold text-slate-300 mb-4">Composição sectorial</div>
                      {(()=>{const maxSec=sectorData[0]?.value||1; return(
                      <div className="space-y-2.5">
                        {sectorData.filter(s=>s.value>=0.5).map((s,i)=>(
                          <div key={s.name}>
                            <div className="flex justify-between text-xs mb-1.5">
                              <div className="flex items-center gap-2">
                                <div className="w-2 h-2 rounded-full shrink-0" style={{background:SECTOR_COLORS[i%SECTOR_COLORS.length]}}/>
                                <span className="text-slate-400">{s.name}</span>
                              </div>
                              <span className={`font-bold tabular-nums ${i===0?"text-slate-100":"text-slate-400"}`}>{s.value.toFixed(1)}%</span>
                            </div>
                            <div className="h-1.5 rounded-full bg-[#111827] overflow-hidden">
                              <div className="h-full rounded-full transition-all duration-500"
                                style={{width:`${(s.value/maxSec)*100}%`,background:SECTOR_COLORS[i%SECTOR_COLORS.length],opacity:i===0?1:0.65}}/>
                            </div>
                          </div>
                        ))}
                      </div>
                      );})()}
                    </div>

                    {/* Geography — bars with teal gradient */}
                    <div className="bg-[#0b0f1a] border border-[#1a1f2e]/60 rounded-xl p-5">
                      <div className="flex items-center justify-between mb-4">
                        <div className="text-xs font-bold text-slate-300">Exposição geográfica</div>
                        <span className="text-[10px] text-slate-600">% das acções</span>
                      </div>
                      {(()=>{const maxGeo=geoData[0]?.value||1; return(
                      <div className="space-y-2.5">
                        {geoData.map((g,i)=>(
                          <div key={g.name}>
                            <div className="flex justify-between text-xs mb-1.5">
                              <span className="text-slate-400">{g.name}</span>
                              <span className={`font-bold tabular-nums ${i===0?"text-slate-100":"text-slate-400"}`}>{g.value.toFixed(1)}%</span>
                            </div>
                            <div className="h-1.5 rounded-full bg-[#111827] overflow-hidden">
                              <div className="h-full rounded-full transition-all duration-500"
                                style={{width:`${(g.value/maxGeo)*100}%`,background:i===0?"#14b8a6":i===1?"#3b82f6":"#64748b",opacity:i===0?1:0.6}}/>
                            </div>
                          </div>
                        ))}
                      </div>
                      );})()}
                    </div>
                  </div>
                  {/* ── Perfil de qualidade FMP (Carteira) ── */}
                  {(portfolioQuality||pqLoading)&&(()=>{
                    // Benchmark oficial: 60% SPY + 25% VGK + 10% EWJ + 5% EWC (médias ponderadas TTM)
                    const BENCH={roic:0.125,revGrowth:0.050,debtEq:1.30};
                    return(
                    <div className="bg-[#0b0f1a] border border-[#1a1f2e]/60 rounded-xl p-5">
                      <div className="flex items-center justify-between mb-4">
                        <div className="text-xs font-bold text-slate-300">Perfil fundamental da carteira</div>
                        <span className="text-[10px] text-slate-600">FMP · TTM · vs Bench 60/25/10/5</span>
                      </div>
                      {pqLoading&&!portfolioQuality?(
                        <div className="text-slate-600 text-xs animate-pulse">A carregar métricas fundamentais…</div>
                      ):(portfolioQuality&&(()=>{
                        const s=portfolioQuality.portfolio_summary;
                        const metrics=[
                          {
                            label:"ROIC",tip:"Retorno sobre capital investido (TTM)",
                            val:s.roic!=null?`${(s.roic*100).toFixed(1)}%`:null,
                            raw:s.roic,bench:BENCH.roic,
                            higherBetter:true,
                            benchFmt:`${(BENCH.roic*100).toFixed(1)}%`,
                          },
                          {
                            label:"Crescimento",tip:"Crescimento de receita anual (TTM)",
                            val:s.revenue_growth!=null?`${(s.revenue_growth*100).toFixed(1)}%`:null,
                            raw:s.revenue_growth,bench:BENCH.revGrowth,
                            higherBetter:true,
                            benchFmt:`${(BENCH.revGrowth*100).toFixed(1)}%`,
                          },
                          {
                            label:"Dívida/Capital",tip:"Rácio dívida sobre capital próprio",
                            val:s.debt_equity!=null?`${s.debt_equity.toFixed(2)}x`:null,
                            raw:s.debt_equity,bench:BENCH.debtEq,
                            higherBetter:false,
                            benchFmt:`${BENCH.debtEq.toFixed(1)}x`,
                          },
                        ];
                        return(
                          <div className="flex gap-8">
                            {metrics.map(m=>{
                              const beats=m.raw!=null?(m.higherBetter?m.raw>m.bench:m.raw<m.bench):null;
                              const valColor=m.raw==null?"text-slate-700":beats===true?"text-emerald-400":beats===false?"text-amber-400":"text-slate-300";
                              return(
                              <div key={m.label} title={m.tip} className="cursor-default">
                                <div className="text-[10px] text-slate-600 mb-1">{m.label}</div>
                                <div className={`text-lg font-black tabular-nums ${valColor}`}>{m.val??"—"}</div>
                                <div className="flex items-center gap-0.5 mt-0.5">
                                  {m.raw!=null&&(<span className={`text-[9px] leading-none ${beats===true?"text-emerald-500":beats===false?"text-amber-500":"text-slate-600"}`}>{beats===true?"▲":beats===false?"▼":"—"}</span>)}
                                  <span className="text-[9px] text-slate-600">bench {m.benchFmt}</span>
                                </div>
                              </div>
                              );
                            })}
                          </div>
                        );
                      })())}
                    </div>
                    );
                  })()}

                  <div className="bg-[#0b0f1a] border border-[#1a1f2e]/60 rounded-xl p-5 w-full min-w-0 max-w-full">
                    <div className="flex items-center justify-between mb-4 max-lg:px-3 lg:mb-4 lg:px-0">
                      <div>
                        <div className="font-bold text-slate-200 text-sm">Posições do plano</div>
                        <div className="text-[10px] text-slate-600 mt-0.5">{actionCounts.allRows.length} posições · {nChanges} com alteração · {actionCounts.manter} sem alteração</div>
                      </div>
                      <div className="flex items-center gap-3">
                        <button onClick={()=>setShowManterRows(v=>!v)}
                          className={`px-3 py-1.5 text-[10px] font-semibold rounded-lg border transition-colors ${showManterRows?"bg-slate-700 border-slate-600 text-slate-300":"border-slate-700/50 text-slate-600 hover:text-slate-400"}`}>
                          {showManterRows?"Ocultar":"Mostrar"} posições sem alteração ({actionCounts.manter})
                        </button>
                        {pricesLoading&&<span className="text-slate-500 text-[10px]">A carregar preços…</span>}
                        <label className="flex items-center gap-2 text-xs text-slate-500">
                          Montante (€)
                          <input type="number" value={aum} onChange={e=>setAum(Number(e.target.value)||100000)}
                            onBlur={e=>{
                              const v=Number(e.target.value)||100000;
                              setAum(v);
                              try{window.localStorage.setItem("decide_onboarding_montante_eur_v1",String(Math.round(v)));}catch{}
                              logActivity({type:"configuração",label:`Montante do plano alterado para €${v.toLocaleString("pt-PT")}`,icon:"⚙",color:"text-amber-400"});
                            }}
                            className="w-24 bg-[#111827] border border-[#252a3a] text-slate-200 text-xs rounded-lg px-2 py-1 outline-none focus:border-teal-500"
                            min={1000} step={1000}/>
                        </label>
                      </div>
                    </div>
                    <div className="w-full min-w-0 overflow-x-auto">
                    <table className="w-full min-w-[720px] border-collapse text-xs">
                      <thead><tr className="text-slate-500 border-b border-[#1a1f2e] font-semibold">
                        <th className="pb-2 pr-2 text-left">Ativo</th>
                        <th className="hidden pb-2 px-2 text-left sm:table-cell">Nome</th>
                        <th className="hidden pb-2 px-2 text-left text-slate-600 font-medium sm:table-cell">Setor</th>
                        <th className="hidden pb-2 px-2 text-left text-slate-600 font-medium sm:table-cell">País</th>
                        {portfolioQuality&&<th className="hidden pb-2 px-2 text-right text-slate-600 font-medium sm:table-cell" title="Return on Invested Capital (TTM)">ROIC</th>}
                        <th className="pb-2 px-2 text-right whitespace-nowrap">Mês ant.</th>
                        <th className="pb-2 px-2 text-right whitespace-nowrap">Este mês</th>
                        <th className="pb-2 px-2 text-right whitespace-nowrap">Δ</th>
                        <th className="hidden pb-2 px-2 text-right sm:table-cell whitespace-nowrap">Preço</th>
                        <th className="hidden pb-2 px-2 text-right sm:table-cell whitespace-nowrap">Acções</th>
                        <th className="pb-2 pl-2 text-right whitespace-nowrap">Acção</th>
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

                          return allRows
                            .filter(r=>showManterRows||r.action!=="Manter"||r.special)
                            .map(r=>{
                            const delta=r.cur-r.prev;
                            const isXeon=r.ticker==="XEON";
                            const isHedge=r.ticker==="EURUSD";
                            const actionLabel2=(a:string)=>a==="Comprar"?"Nova":a==="Aumentar"?"Reforçar":a==="Vender"?"Encerrar":a==="Reduzir"?"Reduzir":"—";
                            const actionColor2=(a:string)=>a==="Comprar"?"text-teal-400":a==="Aumentar"?"text-blue-400":a==="Vender"?"text-red-400":a==="Reduzir"?"text-amber-400":"text-slate-600";
                            return (
                              <tr key={r.ticker} className={`border-b border-[#0d1220] hover:bg-white/[0.025] transition-colors duration-100 ${r.special?"opacity-60":""}`}>
                                <td className="py-2.5 font-bold">
                                  {isXeon||isHedge?(
                                    <span className="text-slate-500 text-[11px]">{isHedge?"EUR/USD":r.ticker}</span>
                                  ):(
                                    <a href={`https://finance.yahoo.com/quote/${getYFTicker(r.ticker)}`} target="_blank" rel="noopener noreferrer"
                                      className="inline-flex items-center gap-1 text-slate-200 hover:text-teal-400 hover:underline underline-offset-2 transition-colors">
                                      {displayTicker(r.ticker)}<ArrowUpRight size={10} className="opacity-40"/>
                                    </a>
                                  )}
                                  <div className="sm:hidden text-[10px] text-slate-600 mt-0.5">{isHedge?"Cambial":isXeon?"MM Euro":getSector(r.ticker)||""}</div>
                                </td>
                                <td className="py-2.5 text-slate-500 text-[11px] hidden sm:table-cell">
                                  {isHedge?"Hedge Cambial":isXeon?"MM Euro":getCompany(r.ticker)||"—"}
                                </td>
                                <td className="py-2.5 text-slate-600 text-[11px] hidden sm:table-cell">
                                  {isHedge?"Cambial":getSector(r.ticker)}
                                </td>
                                <td className="py-2.5 text-slate-600 text-[11px] hidden sm:table-cell">
                                  {isHedge?"Global":getZone(r.ticker)}
                                </td>
                                {portfolioQuality&&(()=>{
                                  if(isHedge||isXeon) return <td className="py-2.5 text-right text-slate-700 hidden sm:table-cell">—</td>;
                                  const qd=portfolioQuality.tickers?.find(t=>t.ticker===r.ticker);
                                  const roic=qd?.roic;
                                  return(
                                    <td className="py-2.5 text-right tabular-nums font-semibold text-[11px] hidden sm:table-cell">
                                      {roic!=null?(
                                        <span className={roic>0.15?"text-emerald-400":roic>0.08?"text-amber-400":roic>0?"text-slate-400":"text-red-400"}>
                                          {(roic*100).toFixed(1)}%
                                        </span>
                                      ):<span className="text-slate-700">—</span>}
                                    </td>
                                  );
                                })()}
                                <td className="py-2.5 text-right text-slate-500 tabular-nums">{r.prev>0?`${r.prev.toFixed(1)}%`:"—"}</td>
                                <td className="py-2.5 text-right text-slate-200 font-semibold tabular-nums">
                                  {isHedge?<span className="text-slate-600 font-normal italic text-[10px]">~{r.cur.toFixed(0)}%</span>:`${r.cur.toFixed(1)}%`}
                                </td>
                                <td className={`py-2.5 text-right font-semibold tabular-nums ${isHedge?"text-slate-600":delta>0?"text-teal-400":delta<0?"text-red-400":"text-slate-600"}`}>
                                  {isHedge?"—":Math.abs(delta)>=0.05?`${delta>0?"+":""}${delta.toFixed(1)}pp`:"—"}
                                </td>
                                {(()=>{
                                  if(isHedge||isXeon) return <><td className="py-2 text-right text-slate-600 hidden sm:table-cell">—</td><td className="py-2 text-right text-slate-600 hidden sm:table-cell">—</td></>;
                                  const p=prices[r.ticker];
                                  const priceVal=p?.price;
                                  const ccy=p?.currency??"USD";
                                  const ccySym=ccy==="EUR"?"€":ccy==="GBp"?"p":ccy==="GBP"?"£":"$";
                                  const effW=priceVal&&pricedWsum>0?(r.cur/pricedWsum)*equityTotal:r.cur;
                                  const shares=p?.qty!=null?Math.round(p.qty):priceVal&&effW>0?Math.round((effW/100)*aum/priceVal):null;
                                  return (
                                    <>
                                      <td className="py-2 text-right text-slate-300 hidden sm:table-cell">
                                        {priceVal?`${ccySym}${priceVal>=1?priceVal.toFixed(2):priceVal.toFixed(4)}`:"—"}
                                      </td>
                                      <td className="py-2 text-right text-slate-200 font-semibold hidden sm:table-cell">
                                        {shares!=null?shares.toLocaleString("pt-PT"):"—"}
                                      </td>
                                    </>
                                  );
                                })()}
                                <td className="py-2.5 text-right">
                                  {!isHedge&&!isXeon&&r.action!=="Manter"&&<span className={`text-[10px] font-semibold ${actionColor2(r.action)}`}>{actionLabel2(r.action)}</span>}
                                </td>
                              </tr>
                            );
                          });
                        })()}
                        {/* weight total footer – always 100% (same normalised source as Recomendações) */}
                        <tr className="border-t-2 border-slate-600 bg-slate-800/40">
                          <td colSpan={portfolioQuality?6:5} className="py-2 text-right text-slate-400 font-semibold text-xs pr-3">Total</td>
                          <td className="py-2 text-right font-bold text-emerald-400">100.0%</td>
                          <td colSpan={portfolioQuality?4:4} className="py-2 text-slate-600 text-xs pl-2">(normalizado)</td>
                        </tr>
                      </tbody>
                    </table>
                    </div>{/* end overflow-x-auto */}
                  </div>
                  </>;})()}</div>}{/* end cartTab==="plano" */}
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
                      {label:"Sharpe (Rf 2%)",
                       m:perfData.m.shp, b:benchPerfData.shp,
                       mFmt:perfData.m.shp.toFixed(2), bFmt:benchPerfData.shp.toFixed(2),
                       delta:perfData.m.shp-benchPerfData.shp, isVol:false, isDelta:true},
                      {label:"Volatilidade anual",
                       m:benchPerfData.mVol, b:benchPerfData.vol,
                       mFmt:`${benchPerfData.mVol.toFixed(1)}%`, bFmt:`${benchPerfData.vol.toFixed(1)}%`,
                       delta:benchPerfData.mVol-benchPerfData.vol, isVol:true},
                    ];
                    return(
                      <div className="bg-[#0b0f1a] border border-[#1a1f2e] rounded-xl overflow-hidden overflow-x-auto">
                        {/* Header */}
                        <div className="grid grid-cols-4 border-b border-[#1a1f2e] min-w-[380px]">
                          <div className="px-4 py-2.5 text-[10px] font-semibold text-slate-600 uppercase tracking-wider">Métrica</div>
                          <div className="px-4 py-2.5 text-[10px] font-semibold text-blue-500 uppercase tracking-wider flex items-center gap-1.5"><div className="w-2.5 h-2.5 rounded-full bg-blue-500"/>Modelo</div>
                          <div className="px-4 py-2.5 text-[10px] font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1.5"><div className="w-2.5 h-2.5 rounded-full bg-slate-500"/>{BENCH_SHORT}</div>
                          <div className="px-4 py-2.5 text-[10px] font-semibold text-slate-600 uppercase tracking-wider">Excesso de retorno</div>
                        </div>
                        {cols.map(col=>{
                          const dPos=col.isVol?col.delta<=0:col.delta>=0;
                          const dFmt=col.isVol
                            ?`${col.delta>=0?"+":""}${col.delta.toFixed(1)}pp vol`
                            :col.label==="Sharpe"
                              ?`${col.delta>=0?"+":""}${col.delta.toFixed(2)}`
                              :`${col.delta>=0?"+":""}${col.delta.toFixed(2)}pp`;
                          return(
                            <div key={col.label} className="grid grid-cols-4 border-b border-[#0f172a] hover:bg-white/[0.015] min-w-[380px]">
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
                      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
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
                            <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-2">Rotação média</div>
                            <div className="text-2xl font-black text-amber-400">{ts.avg.toFixed(1)}<span className="text-sm font-semibold text-slate-500">%</span></div>
                            <div className="text-[11px] text-slate-400 mt-1">da carteira por revisão</div>
                          </div>
                          <div className="bg-[#0b0f1a] border border-[#1a1f2e] rounded-xl p-4">
                            <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-2">Revisões históricas</div>
                            <div className="text-2xl font-black text-slate-300">{ts.n}</div>
                            <div className="text-[11px] text-slate-400 mt-1">rebalanceamentos · frequência mensal</div>
                          </div>
                        </>}
                      </div>
                    );
                  })()}
                  <div className="bg-[#0b0f1a] border border-[#1a1f2e] rounded-xl p-5">
                    {(()=>{
                      // Stress period reference bands (start, end, label, color)
                      const stressPeriods=[
                        {label:"GFC 2008",start:"2007-10-01",end:"2009-03-31",color:"#ef4444"},
                        {label:"COVID",start:"2020-02-01",end:"2020-04-30",color:"#f59e0b"},
                        {label:"Bear 2022",start:"2022-01-01",end:"2022-12-31",color:"#a78bfa"},
                      ];
                      // Map dates to chart indexes for reference areas
                      const chartDates=(perfData?.chart??[]).map(c=>c.date);
                      const stressAreas=showStressPeriods?stressPeriods.map(sp=>{
                        const s=chartDates.find(d=>d>=sp.start)||sp.start;
                        const e=[...chartDates].reverse().find(d=>d<=sp.end)||sp.end;
                        return{...sp,s,e};
                      }):[];
                      return <>
                      {showMethodModal&&(
                        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                          <div className="absolute inset-0 bg-black/70" onClick={()=>setShowMethodModal(false)}/>
                          <div className="relative bg-[#0f1421] border border-[#1a2540] rounded-2xl p-8 max-w-lg w-full shadow-2xl">
                            <button onClick={()=>setShowMethodModal(false)} className="absolute top-4 right-4 text-slate-500 hover:text-slate-300 text-lg">✕</button>
                            <div className="text-teal-500 text-[10px] uppercase tracking-widest font-bold mb-3">Metodologia</div>
                            <div className="text-slate-100 font-bold text-base mb-4">DECIDE V5 — Modelo quantitativo</div>
                            <div className="space-y-3 text-[12px] text-slate-400 leading-relaxed">
                              <p><span className="text-slate-300 font-semibold">Dados históricos:</span> Simulação retrospectiva (backtest) sobre preços ajustados de dividendos desde Julho de 2005. Os resultados históricos não garantem performance futura.</p>
                              <p><span className="text-slate-300 font-semibold">Universo:</span> Selecção mensal das melhores 20 acções por modelo de momentum e qualidade. Liquidez (XEON/T-Bills) usada como amortecedor de risco.</p>
                              <p><span className="text-slate-300 font-semibold">Regra de volatilidade:</span> A exposição a acções é ajustada mensalmente para manter a volatilidade alvo próxima da do benchmark. Permite redução automática em períodos de stress.</p>
                              <p><span className="text-slate-300 font-semibold">Custos:</span> Incluídas estimativas de bid-ask spread (0.05%), comissões e slippage. Custos fiscais não incluídos.</p>
                              <p><span className="text-slate-300 font-semibold">Benchmark:</span> {BENCH_LABEL} — índice de referência de acções globais (MSCI World). Não inclui dividendos reinvestidos.</p>
                              <p className="text-slate-600 text-[11px] border-t border-slate-800 pt-3">Este material é fornecido apenas para fins informativos e não constitui aconselhamento de investimento. Investir envolve risco de perda de capital.</p>
                            </div>
                          </div>
                        </div>
                      )}
                      <div className="flex flex-col gap-2 mb-4">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <div className="font-bold text-slate-200 text-sm">Evolução do investimento</div>
                            <div className="text-[10px] text-slate-600 mt-0.5">Simulação histórica · dados desde 2005</div>
                          </div>
                          <div className="flex items-center gap-1.5 flex-shrink-0">
                            <button onClick={()=>setShowStressPeriods(v=>!v)}
                              className={`px-2.5 py-1.5 text-[10px] font-semibold rounded-lg border transition-colors flex items-center gap-1.5 whitespace-nowrap ${showStressPeriods?"bg-red-900/30 border-red-500/30 text-red-400":"border-slate-700/50 text-slate-600 hover:text-slate-400"}`}>
                              <span className="w-1.5 h-1.5 rounded-full bg-current"/>Stress
                            </button>
                            <button onClick={()=>setShowMethodModal(true)}
                              className="px-2.5 py-1.5 text-[10px] font-semibold rounded-lg border border-teal-500/30 text-teal-500 hover:bg-teal-500/10 transition-colors whitespace-nowrap">
                              Metodologia
                            </button>
                          </div>
                        </div>
                        <div className="flex gap-1 overflow-x-auto scrollbar-none">
                          {PERIODS.map(p=>(
                            <button key={p} onClick={()=>setPeriod(p)}
                              className={`px-3 py-1 rounded text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${period===p?"bg-blue-600 text-white":"text-slate-400 hover:text-slate-200"}`}>{p}</button>
                          ))}
                        </div>
                      </div>
                      <ResponsiveContainer width="100%" height={240}>
                        <LineChart data={perfData?.chart??[]} margin={{top:4,right:8,left:-4,bottom:0}}>
                          <XAxis dataKey="date" tick={{fontSize:10,fill:"#64748b"}} tickLine={false} axisLine={false} interval={Math.floor((perfData?.chart.length??1)/6)}
                            tickFormatter={(d:string)=>{const dt=new Date(d);return `${dt.toLocaleString("pt-PT",{month:"short"})} ${String(dt.getFullYear()).slice(2)}`;}}/>
                          <YAxis scale="log" domain={["auto","auto"]} allowDataOverflow tick={{fontSize:9,fill:"#64748b"}} tickLine={false} axisLine={false} tickFormatter={v=>{const r=(Number(v)/100-1)*100;return `${r>=0?"+":""}${r.toFixed(0)}%`;}}/>
                          <Tooltip content={<PerfTooltip/>}/>
                          <ReferenceLine y={100} stroke="#334155" strokeDasharray="3 3"/>
                          {stressAreas.map(sp=>(
                            <ReferenceArea key={sp.label} x1={sp.s} x2={sp.e} fill={sp.color} fillOpacity={0.08} stroke={sp.color} strokeOpacity={0.3} strokeWidth={1}/>
                          ))}
                          <Line type="monotone" dataKey="modelo" stroke="#60a5fa" strokeWidth={2} dot={false} name="Modelo"/>
                          <Line type="monotone" dataKey="bench" stroke="#475569" strokeWidth={1.5} dot={false} name="Benchmark" strokeDasharray="4 2"/>
                        </LineChart>
                      </ResponsiveContainer>
                      <div className="flex items-center gap-4 mt-3 flex-wrap">
                        <div className="flex items-center gap-2 text-xs text-slate-400"><div className="w-5 h-0.5 bg-blue-400 rounded"/>Modelo</div>
                        <div className="flex items-center gap-2 text-xs text-slate-400"><div className="w-5 h-px bg-slate-400 rounded"/>{BENCH_SHORT}</div>
                        {showStressPeriods&&stressPeriods.map(sp=>(
                          <div key={sp.label} className="flex items-center gap-1.5 text-[10px]" style={{color:sp.color}}>
                            <div className="w-2.5 h-2.5 rounded-sm opacity-60" style={{background:sp.color}}/>
                            {sp.label}
                          </div>
                        ))}
                        <div className="ml-auto text-[10px] text-slate-600 italic">{BENCH_LABEL}</div>
                      </div>
                      </>;
                    })()}
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

                  {/* Disclaimer regulatório */}
                  <div className="flex items-start gap-3 bg-slate-900/50 border border-slate-800/60 rounded-xl px-5 py-4">
                    <div className="text-slate-600 mt-0.5 shrink-0">⚠</div>
                    <p className="text-[11px] text-slate-600 leading-relaxed">
                      <span className="text-slate-500 font-semibold">Simulação histórica (backtest).</span>{" "}
                      Os resultados apresentados referem-se a uma simulação retrospectiva com dados históricos ajustados de dividendos desde Julho de 2005.
                      Performance passada não garante resultados futuros. Os retornos incluem estimativas de custos de transacção mas não incluem custos fiscais.
                      Este conteúdo é fornecido apenas para fins informativos e não constitui aconselhamento de investimento.
                    </p>
                  </div>
                </div>
              )}

              {/* ── RISCO ── */}
              {activePage==="risco"&&(()=>{
                const vol=riskData?.vol20y??riskData?.curVol??0;
                const benchVolTarget=(riskData?.benchVol20y??0)*profileFactor;
                const dd=riskData?.curDD??0;
                // Sharpe from inception (s=0, calYears) — period-independent
                const sharpe20=riskData?.inception?.shp??0;
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
                // Advisory narrative
                const volOk=vol>0&&benchVolTarget>0&&Math.abs(vol-benchVolTarget)/benchVolTarget<0.15;
                const ddSevere=dd<-25;
                const topSectorName=sectorAlloc[0]?.name??"Tecnologia";
                const topSectorPct=sectorAlloc[0]?.pct??0;
                const topSectorRisk=sectorAlloc[0]?.risk??0;
                const sectorConcentrated=topSectorPct>30;
                const advisory=[
                  volOk
                    ?`A volatilidade actual (${vol.toFixed(1)}%) está alinhada com o alvo do perfil ${profileLabel}.`
                    :`A volatilidade actual (${vol.toFixed(1)}%) está ${vol>benchVolTarget?"acima":"abaixo"} do alvo para o perfil ${profileLabel} (${benchVolTarget.toFixed(1)}%).`,
                  ddSevere
                    ?`O drawdown máx. histórico (20 anos) atingiu ${dd.toFixed(1)}%, acima do limiar típico para o perfil ${profileLabel}.`
                    :`O drawdown máx. histórico (20 anos) é de ${dd.toFixed(1)}%, dentro dos parâmetros esperados para o perfil ${profileLabel}.`,
                  sectorConcentrated
                    ?`A concentração em ${topSectorName} (${topSectorPct.toFixed(0)}% da carteira) é o principal factor de risco a monitorizar.`
                    :`A exposição sectorial está bem distribuída — ${topSectorName} representa ${topSectorPct.toFixed(0)}% da carteira.`,
                ].filter(Boolean);

                return (
                  <div className="space-y-4">

                    {/* ── Advisory narrative ── */}
                    <div className="bg-gradient-to-r from-teal-950/30 to-[#0b0f1a] border border-teal-500/15 rounded-xl px-5 py-4 flex items-start gap-4">
                      <div className="text-teal-500 mt-0.5 shrink-0"><ShieldCheck size={16}/></div>
                      <div>
                        <div className="text-[10px] text-teal-600 uppercase tracking-widest font-bold mb-2">Avaliação de risco · {dateLabel}</div>
                        <div className="space-y-1">
                          {advisory.map((line,i)=>(
                            <div key={i} className="text-[12px] text-slate-300 leading-relaxed">{line}</div>
                          ))}
                        </div>
                      </div>
                    </div>

                    {/* ── Top: gauge + metrics ── */}
                    <div className="bg-[#0b0f1a] border border-[#1a1f2e] rounded-xl p-5 flex flex-col sm:flex-row items-center gap-6 lg:gap-8">
                      {/* Gauge */}
                      <div className="flex-shrink-0 w-44 sm:w-52">
                        <div className="text-[10px] text-slate-500 uppercase tracking-widest mb-1">Nível de risco</div>
                        <svg viewBox="0 0 220 115" className="w-full">
                          <path d={arc(0,1,R,RI)} fill="#1e293b"/>
                          <path d={arc(0,0.38,R,RI)} fill="#22c55e" opacity={0.75}/>
                          <path d={arc(0.38,0.67,R,RI)} fill="#f59e0b" opacity={0.75}/>
                          <path d={arc(0.67,1,R,RI)} fill="#ef4444" opacity={0.75}/>
                          <line x1={CX} y1={CY} x2={np.x} y2={np.y} stroke="white" strokeWidth={2.5} strokeLinecap="round" opacity={0.9}/>
                          <polygon points={`${np.x},${np.y} ${nb1.x},${nb1.y} ${nb2.x},${nb2.y}`} fill="white" opacity={0.95}/>
                          <circle cx={CX} cy={CY} r={6} fill="#0b0f1a" stroke="white" strokeWidth={2}/>
                          <text x={CX-R+4} y={CY+14} fontSize={9} fill="#22c55e" textAnchor="middle">Baixo</text>
                          <text x={CX} y={CY-R-6} fontSize={9} fill="#f59e0b" textAnchor="middle">Médio</text>
                          <text x={CX+R-4} y={CY+14} fontSize={9} fill="#ef4444" textAnchor="middle">Alto</text>
                          <text x={CX} y={CY+32} fontSize={15} fontWeight="bold" fill={riskColor} textAnchor="middle">{riskLabel}</text>
                        </svg>
                      </div>
                      <div className="w-px self-stretch bg-[#1a1f2e]"/>
                      {/* KPIs — drawdown/vol first, Sharpe secondary */}
                      <div className="flex-1 grid grid-cols-2 sm:grid-cols-3 gap-4 lg:gap-6">
                        <div>
                          <div className="text-slate-500 text-[10px] mb-1 uppercase tracking-wide">Volatilidade anual</div>
                          <div className={`text-3xl font-black ${volOk?"text-emerald-400":vol>benchVolTarget*1.1?"text-amber-400":"text-sky-400"}`}>{vol?`${vol.toFixed(1)}%`:"—"}</div>
                          <div className="text-[10px] text-slate-600 mt-1">Alvo ~{benchVolTarget>0?benchVolTarget.toFixed(1):(profileFactor<1?"14.6":profileFactor>1?"24.3":"19.4")}% · 20 anos</div>
                        </div>
                        <div>
                          <div className="text-slate-500 text-[10px] mb-1 uppercase tracking-wide">Drawdown máx. (20a)</div>
                          <div className={`text-3xl font-black ${dd<-25?"text-rose-400":dd<-15?"text-amber-400":"text-slate-300"}`}>{dd?`${dd.toFixed(1)}%`:"—"}</div>
                          <div className="text-[10px] text-slate-600 mt-1">pior queda histórica</div>
                        </div>
                        <div>
                          <div className="text-slate-500 text-[10px] mb-1 uppercase tracking-wide">VaR 95% (diário)</div>
                          <div className="text-3xl font-black text-slate-300">{riskMetrics?`${riskMetrics.var95.toFixed(2)}%`:"—"}</div>
                          <div className="text-[10px] text-slate-600 mt-1">perda máxima esperada diária</div>
                        </div>
                        <div>
                          <div className="text-slate-500 text-[10px] mb-1 uppercase tracking-wide">Beta vs {BENCH_SHORT}</div>
                          <div className="text-2xl font-black text-slate-300">{riskMetrics?riskMetrics.beta:"—"}</div>
                          <div className="text-[10px] text-slate-600 mt-1">sensibilidade ao mercado</div>
                        </div>
                        <div>
                          <div className="text-slate-500 text-[10px] mb-1 uppercase tracking-wide">Perfil activo</div>
                          <div className="text-2xl font-black text-amber-400">{profileLabel}</div>
                          <div className="text-[10px] text-slate-600 mt-1">nível de risco seleccionado</div>
                        </div>
                        <div>
                          <div className="text-slate-500 text-[10px] mb-1 uppercase tracking-wide">Sharpe (20 anos)</div>
                          <div className="text-xl font-bold text-slate-400">{perfData?sharpe20.toFixed(2):"—"}</div>
                          <div className="text-[10px] text-slate-600 mt-1">retorno / vol · Rf = 2% (EUR)</div>
                        </div>
                      </div>
                    </div>

                    {/* ── Drawdown histórico ── */}
                    <div className="bg-[#0b0f1a] border border-[#1a1f2e] rounded-xl p-5">
                      <div className="flex items-center justify-between mb-3">
                        <div className="font-bold text-slate-200 text-sm">Drawdown histórico</div>
                        <div className="text-[10px] text-slate-600">Queda máxima pico-a-vale em cada momento</div>
                      </div>
                      <ResponsiveContainer width="100%" height={180}>
                        <AreaChart data={riskData?.ddChart??[]} margin={{top:4,right:8,left:0,bottom:0}}>
                          <defs>
                            <linearGradient id="ddGrad" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="#be6b7a" stopOpacity={0.22}/>
                              <stop offset="95%" stopColor="#be6b7a" stopOpacity={0.0}/>
                            </linearGradient>
                          </defs>
                          <CartesianGrid vertical={false} stroke="#111827"/>
                          <XAxis dataKey="date" tick={{fontSize:10,fill:"#64748b"}} tickLine={false} axisLine={false}
                            tickFormatter={d=>d.slice(0,4)}
                            interval={Math.floor((riskData?.ddChart.length??1)/8)}/>
                          <YAxis tick={{fontSize:10,fill:"#64748b"}} tickLine={false} axisLine={false}
                            tickFormatter={v=>`${Number(v).toFixed(0)}%`} domain={["dataMin",0]} width={42}/>
                          <Tooltip
                            formatter={(v:number,name:string)=>[`${Number(v).toFixed(1)}%`, name==="dd"?"Modelo":BENCH_SHORT]}
                            labelStyle={{color:"#fff",fontWeight:700}}
                            contentStyle={{background:"#1e293b",border:"1px solid #334155",borderRadius:8,fontSize:12,color:"#f1f5f9"}}
                            itemStyle={{color:"#f1f5f9"}}
                          />
                          <ReferenceLine y={0} stroke="#1e293b"/>
                          <Area type="monotone" dataKey="dd" stroke="#9d7080" strokeWidth={1.5} fill="url(#ddGrad)" dot={false} name="dd"/>
                          <Line type="monotone" dataKey="bench" stroke="#334155" strokeWidth={1.5} dot={false} name="bench" strokeDasharray="4 2"/>
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>

                    {/* ── Worst periods table ── */}
                    {worstPeriods&&(
                    <div className="bg-[#0b0f1a] border border-[#1a1f2e] rounded-xl p-5">
                      <div className="font-bold text-slate-200 text-sm mb-4">Piores períodos históricos</div>
                      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                        {[
                          {label:"Pior mês",val:worstPeriods.wm?.ret,date:worstPeriods.wm?.date?.slice(0,7)},
                          {label:"Pior trimestre",val:worstPeriods.wq?.ret,date:worstPeriods.wq?.date?.slice(0,7)},
                          {label:"Pior ano",val:worstPeriods.wy?.ret,date:worstPeriods.wy?.date},
                          {label:"Melhor mês",val:worstPeriods.bm?.ret,date:worstPeriods.bm?.date?.slice(0,7),good:true},
                        ].map(x=>(
                          <div key={x.label} className="bg-[#080c14] rounded-xl p-4 border border-[#111827]">
                            <div className="text-[10px] text-slate-600 uppercase tracking-wide mb-2">{x.label}</div>
                            <div className={`text-2xl font-black tabular-nums ${x.good?"text-emerald-400":"text-rose-400"}`}>
                              {x.val!=null?`${x.val>=0?"+":""}${x.val.toFixed(1)}%`:"—"}
                            </div>
                            <div className="text-[10px] text-slate-600 mt-1">{x.date??"—"}</div>
                          </div>
                        ))}
                      </div>
                      <div className="mt-3 text-[10px] text-slate-700">Calculado sobre retornos históricos simulados · janelas de 21/63/252 dias de negociação</div>
                    </div>
                    )}

                    {/* ── Bottom: sector alloc + return distribution ── */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                      <div className="bg-[#0b0f1a] border border-[#1a1f2e] rounded-xl p-5">
                        <div className="font-bold text-slate-200 text-sm mb-4">Exposição por sector</div>
                        <div className="space-y-2.5">
                          {(()=>{const maxP=sectorAlloc[0]?.pct||1; return sectorAlloc.map(({name,pct,risk})=>{
                            const over=risk-pct>1;
                            return(
                            <div key={name} className="flex items-center gap-3">
                              <div className="w-20 text-[11px] text-slate-500 text-right shrink-0">{name}</div>
                              <div className="flex-1 relative h-2 bg-[#111827] rounded-full overflow-hidden">
                                <div className="absolute inset-y-0 left-0 rounded-full bg-blue-500/60 transition-all"
                                  style={{width:`${(pct/maxP)*100}%`}}/>
                              </div>
                              <div className="flex items-center gap-1.5 w-20 shrink-0">
                                <span className="text-[11px] text-slate-300 font-semibold tabular-nums w-10 text-right">{pct.toFixed(1)}%</span>
                                {over&&<span className="text-[9px] text-amber-500 font-bold">↑risco</span>}
                              </div>
                            </div>
                          );}); })()}
                        </div>
                      </div>
                      <div className="bg-[#0b0f1a] border border-[#1a1f2e] rounded-xl p-5">
                        <div className="font-bold text-slate-200 text-sm mb-3">Distribuição de retornos mensais</div>
                        <ResponsiveContainer width="100%" height={200}>
                          <BarChart data={returnDist} margin={{top:4,right:4,left:-8,bottom:0}} barCategoryGap="5%">
                            <CartesianGrid vertical={false} stroke="#111827"/>
                            <XAxis dataKey="bin" tick={{fontSize:8,fill:"#64748b"}} axisLine={false} tickLine={false} interval={3}/>
                            <YAxis tick={{fontSize:9,fill:"#64748b"}} axisLine={false} tickLine={false}/>
                            <Tooltip
                              formatter={(v:number)=>[`${v} meses`,"Frequência"]}
                              labelFormatter={(l:string)=>`Retorno: ${l}`}
                              labelStyle={{color:"#ffffff",fontWeight:700,fontSize:13}}
                              contentStyle={{background:"#0f172a",border:"1px solid #334155",borderRadius:8,fontSize:12,color:"#f1f5f9"}}
                              itemStyle={{color:"#93c5fd",fontWeight:600}}
                              cursor={{fill:"rgba(255,255,255,0.04)"}}
                            />
                            <Bar dataKey="count" name="Frequência" radius={[2,2,0,0]} maxBarSize={20}>
                              {returnDist.map((r,i)=><Cell key={i} fill={r.mid>=0?"#3b82f6":"#9d7080"}/>)}
                            </Bar>
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </div>

                    {/* ── Risk contribution (simplified) ── */}
                    <div className="bg-[#0b0f1a] border border-[#1a1f2e] rounded-xl p-5">
                      <div className="font-bold text-slate-200 text-sm mb-1">Concentração de risco por sector</div>
                      <div className="text-[10px] text-slate-600 mb-4">Sectores onde o risco excede o peso indicam exposição acima da média</div>
                      <ResponsiveContainer width="100%" height={Math.max(160, sectorAlloc.length*34)}>
                        <BarChart data={sectorAlloc} layout="vertical" margin={{top:0,right:48,left:80,bottom:0}} barGap={3} barCategoryGap="30%">
                          <CartesianGrid horizontal={false} stroke="#111827"/>
                          <XAxis type="number" tick={{fontSize:10,fill:"#64748b"}} axisLine={false} tickLine={false} tickFormatter={v=>`${v}%`} domain={[0,"dataMax+5"]}/>
                          <YAxis type="category" dataKey="name" tick={{fontSize:11,fill:"#64748b"}} axisLine={false} tickLine={false} width={76}/>
                          <Tooltip
                            formatter={(v:number,name:string)=>[`${Number(v).toFixed(1)}%`, name==="pct"?"Peso carteira":"Risco relativo"]}
                            labelStyle={{color:"#fff",fontWeight:700,fontSize:13}}
                            contentStyle={{background:"#0f172a",border:"1px solid #334155",borderRadius:8,fontSize:12,color:"#f1f5f9"}}
                            itemStyle={{color:"#f1f5f9",fontWeight:600}}
                            cursor={{fill:"rgba(255,255,255,0.03)"}}
                          />
                          <Bar dataKey="pct" name="pct" fill="#3b82f6" fillOpacity={0.6} radius={[0,3,3,0]} maxBarSize={12}/>
                          <Bar dataKey="risk" name="risk" radius={[0,3,3,0]} maxBarSize={12}>
                            {sectorAlloc.map((_,i)=>{
                              const diff=sectorAlloc[i]!.risk-sectorAlloc[i]!.pct;
                              return <Cell key={i} fill={diff>1?"#c9965a":diff<-1?"#4ade80":"#64748b"} fillOpacity={0.8}/>;
                            })}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                );
              })()}

              {/* ── HISTÓRICO ── */}
              {activePage==="historico"&&<HistoricoPage sortedMonths={sortedMonths} dates={dates} equityRaw={activeEquity} benchRaw={benchRaw} marginEnabled={marginEnabled} profileFactor={profileFactor} />}
              {activePage==="custos"&&<CustosPage aum={aum} planOverride={router.query.plan==="premium"?"premium":router.query.plan==="private"?"private":undefined}/>}

              {/* ── TESTES DE ROBUSTEZ ── */}
              {activePage==="robustez"&&<RobustezPage/>}

              {/* ── AJUDA ── */}
              {activePage==="ajuda"&&<AjudaPage/>}

              {/* ── CONTACTOS ── */}
              {activePage==="contactos"&&(
                <div className="space-y-4">
                  {/* Human intro */}
                  <div className="bg-gradient-to-br from-[#0b0f1a] to-[#0d1220] border border-[#1a1f2e] rounded-xl px-6 py-5 flex items-start justify-between">
                    <div>
                      <div className="text-slate-100 font-bold text-lg mb-1">Equipa DECIDE</div>
                      <div className="text-slate-400 text-sm max-w-md leading-relaxed">
                        Estamos disponíveis para ajudar — seja para esclarecer dúvidas sobre a plataforma, discutir o modelo ou simplesmente perceber se o DECIDE é certo para si.
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0 ml-6">
                      <div className="w-2 h-2 rounded-full bg-emerald-400"/>
                      <div>
                        <div className="text-emerald-400 text-xs font-semibold">Disponível</div>
                        <div className="text-slate-600 text-[10px]">Resposta em &lt; 1 dia útil</div>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    {/* Left: contacts + hours */}
                    <div className="space-y-4">
                      <div className="bg-[#0b0f1a] border border-[#1a1f2e] rounded-xl p-5">
                        <div className="text-[10px] uppercase tracking-widest text-slate-600 mb-4">Contactos directos</div>
                        <div className="space-y-3">
                          {[
                            {Icon:Mail,label:"Email",val:"jcpina01@decidepoweredbyai.com",href:"mailto:jcpina01@decidepoweredbyai.com",note:"Respondemos em menos de 1 dia útil"},
                            {Icon:MapPin,label:"Morada",val:"Av. Miguel Bombarda 26, 3º\n1050-165 Lisboa - Portugal",href:null,note:"Sede social registada"},
                          ].map(({Icon,label,val,href,note})=>(
                            <div key={label} className="flex items-start gap-3 p-3 bg-[#080c14] border border-[#1a1f2e] rounded-lg hover:border-slate-600/50 transition-colors">
                              <Icon size={15} className="text-slate-400 mt-0.5 shrink-0"/>
                              <div className="flex-1 min-w-0">
                                <div className="text-slate-500 text-[10px]">{label}</div>
                                {href?(
                                  <a href={href} className="text-slate-200 text-xs font-semibold hover:text-teal-400 transition-colors whitespace-pre-line">{val}</a>
                                ):(
                                  <div className="text-slate-200 text-xs font-semibold whitespace-pre-line">{val}</div>
                                )}
                                <div className="text-slate-600 text-[10px] mt-0.5 italic">{note}</div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="bg-[#0b0f1a] border border-[#1a1f2e] rounded-xl p-5">
                        <div className="text-[10px] uppercase tracking-widest text-slate-600 mb-3">Horário de atendimento</div>
                        <div className="space-y-2">
                          {[
                            {d:"Segunda a Sexta",h:"9h – 18h",active:true},
                            {d:"Sábado",h:"10h – 13h",active:false},
                            {d:"Domingo e feriados",h:"Encerrado",active:false},
                          ].map(({d,h,active})=>(
                            <div key={d} className="flex justify-between items-center py-1.5 border-b border-[#0f172a] last:border-0">
                              <span className="text-slate-400 text-xs">{d}</span>
                              <span className={`text-xs font-semibold ${active?"text-teal-400":"text-slate-500"}`}>{h}</span>
                            </div>
                          ))}
                        </div>
                        <div className="mt-3 pt-3 border-t border-[#1a1f2e] flex items-center gap-2">
                          <Info size={11} className="text-slate-600 shrink-0"/>
                          <span className="text-[10px] text-slate-600">Para questões urgentes fora do horário, envie email — respondemos assim que possível.</span>
                        </div>
                      </div>
                    </div>

                    {/* Right: form */}
                    <div className="bg-[#0b0f1a] border border-[#1a1f2e] rounded-xl p-5">
                      <div className="text-[10px] uppercase tracking-widest text-slate-600 mb-4">Envie-nos uma mensagem</div>
                      {contactSent?(
                        <div className="flex flex-col items-center justify-center h-64 gap-3 text-center">
                          <div className="w-12 h-12 rounded-full bg-teal-900/30 border border-teal-700/40 flex items-center justify-center">
                            <CheckCircle2 size={22} className="text-teal-400"/>
                          </div>
                          <div className="text-slate-200 font-semibold text-sm">Mensagem recebida</div>
                          <div className="text-slate-500 text-xs max-w-xs leading-relaxed">Respondemos habitualmente em menos de 1 dia útil. Verifique a caixa de entrada do email que indicou.</div>
                          <button onClick={()=>{setContactSent(false);setContactForm({nome:"",email:"",assunto:"",msg:""}); }}
                            className="mt-2 text-xs text-teal-400 hover:text-teal-300 underline transition-colors">Enviar outra mensagem</button>
                        </div>
                      ):(
                        <form onSubmit={e=>{e.preventDefault();setContactSent(true);}} className="space-y-3">
                          {[
                            {k:"nome",label:"Nome",type:"text",ph:"O seu nome"},
                            {k:"email",label:"Email",type:"email",ph:"email@exemplo.com"},
                            {k:"assunto",label:"Assunto",type:"text",ph:"Ex: dúvida sobre recomendações"},
                          ].map(({k,label,type,ph})=>(
                            <div key={k}>
                              <label className="text-xs text-slate-500 mb-1 block">{label}</label>
                              <input type={type} placeholder={ph} value={(contactForm as Record<string,string>)[k]} required
                                onChange={e=>setContactForm(f=>({...f,[k]:e.target.value}))}
                                className="w-full bg-[#080c14] border border-[#1a1f2e] text-slate-200 text-xs rounded-lg px-3 py-2.5 outline-none focus:border-teal-500/60 transition-colors placeholder:text-slate-700"/>
                            </div>
                          ))}
                          <div>
                            <label className="text-xs text-slate-500 mb-1 block">Mensagem</label>
                            <textarea rows={4} placeholder="Descreva a sua questão em detalhe..." required value={contactForm.msg}
                              onChange={e=>setContactForm(f=>({...f,msg:e.target.value}))}
                              className="w-full bg-[#080c14] border border-[#1a1f2e] text-slate-200 text-xs rounded-lg px-3 py-2.5 outline-none focus:border-teal-500/60 transition-colors resize-none placeholder:text-slate-700"/>
                          </div>
                          <button type="submit"
                            className="w-full flex items-center justify-center gap-2 bg-teal-700 hover:bg-teal-600 text-white text-xs font-bold rounded-lg py-3 transition-colors">
                            <Send size={12}/>Enviar mensagem
                          </button>
                          <div className="text-[10px] text-slate-700 text-center">Os seus dados são tratados de forma confidencial. Nunca partilhamos informação com terceiros.</div>
                        </form>
                      )}
                    </div>
                  </div>

                  {/* Agendamento de chamada */}
                  <div className="bg-gradient-to-br from-[#0d1220] to-[#0b0f1a] border border-amber-700/20 rounded-xl p-5 flex items-center justify-between gap-6">
                    <div className="flex items-start gap-4">
                      <div className="w-10 h-10 rounded-xl bg-amber-900/20 border border-amber-700/30 flex items-center justify-center shrink-0">
                        <Activity size={18} className="text-amber-400"/>
                      </div>
                      <div>
                        <div className="text-slate-100 font-bold text-sm mb-0.5">Agendar chamada</div>
                        <div className="text-slate-400 text-xs leading-relaxed">Revisão da carteira, dúvidas sobre o modelo ou onboarding — marcamos uma chamada de 15 minutos, gratuita.</div>
                      </div>
                    </div>
                    <a href="mailto:jcpina01@decidepoweredbyai.com?subject=Agendar%20chamada%20DECIDE"
                      className="shrink-0 flex items-center gap-2 bg-amber-700/20 hover:bg-amber-700/35 border border-amber-600/30 text-amber-300 text-xs font-bold rounded-lg px-4 py-2.5 transition-colors whitespace-nowrap">
                      <Send size={12}/>Pedir chamada
                    </a>
                  </div>

                  {/* Legal/regulatory footer */}
                  <div className="flex items-start gap-3 bg-[#080c14] border border-[#1a1f2e] rounded-xl px-5 py-3">
                    <ShieldCheck size={13} className="text-slate-600 shrink-0 mt-0.5"/>
                    <div className="text-[10px] text-slate-600 leading-relaxed">
                      O DECIDE está registado na CMVM como intermediário financeiro. Para questões regulatórias, de conformidade ou reclamações formais, contacte <span className="text-slate-500">compliance@decide.pt</span>.
                      Para questões de privacidade e protecção de dados, contacte <span className="text-slate-500">privacidade@decide.pt</span>.
                    </div>
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
                  onBack={()=>navigateToPage("reco")}
                  onShowRegister={()=>setShowRegModal(true)}
                  profileLabel={profileLabel}
                  fxExposure={fxExposure}
                  marginEnabled={marginEnabled}
                  prices={prices}
                  sessionUser={sessionUser}
                />
              )}

            </div>
            </main>
      </div>
    </>
  );
}


