import Head from "next/head";
import Link from "next/link";
import React from "react";

/* ─── colour tokens ─────────────────────────────────────────────────────── */
const BG      = "#07091a";
const BG2     = "#0b0f22";
const TEAL    = "#2dd4bf";
const TEAL2   = "#14b8a6";
const BLUE    = "#3b82f6";
const NAV_H   = 100;

/* ─── reusable helpers ──────────────────────────────────────────────────── */
const Flex = ({children, style}: {children:React.ReactNode; style?:React.CSSProperties}) =>
  <div style={{display:"flex",...style}}>{children}</div>;

function slugify(s: string): string {
  return s.toLowerCase()
    .replace(/[àáâãä]/g,"a").replace(/[èéêë]/g,"e")
    .replace(/[ìíîï]/g,"i").replace(/[òóôõö]/g,"o")
    .replace(/[ùúûü]/g,"u").replace(/ç/g,"c")
    .replace(/\s+/g,"-").replace(/[^a-z0-9-]/g,"");
}

/* ─── nav ───────────────────────────────────────────────────────────────── */
function Nav() {
  return (
    <nav style={{
      position:"fixed",top:0,left:0,right:0,zIndex:100,
      height:NAV_H,
      background:"rgba(7,9,26,0.90)",
      backdropFilter:"blur(14px)",
      borderBottom:"1px solid rgba(255,255,255,0.07)",
      display:"flex",alignItems:"center",justifyContent:"space-between",
      padding:"0 32px",
    }}>
        {/* Logo — PNG tem padding negro; mostra-se maior e clipado para o logo real ficar visível */}
        <div style={{height:NAV_H,overflow:"hidden",flexShrink:0,display:"flex",alignItems:"center"}}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/images/decide-logo-full.png" alt="DECIDE"
            style={{height:220,width:"auto",objectFit:"contain",mixBlendMode:"screen",marginTop:0}} />
        </div>

        {/* Nav links */}
        <Flex style={{gap:32,alignItems:"center"}}>
          {(["Como funciona","Vantagens","Preços","Segurança","Sobre nós"] as string[]).map(l=>(
            <a key={l} href={`#${slugify(l)}`}
              style={{color:"#94a3b8",fontSize:14,fontWeight:500,textDecoration:"none",whiteSpace:"nowrap",
                cursor:"pointer",transition:"color .15s"}}
              onMouseEnter={e=>(e.currentTarget.style.color="#f1f5f9")}
              onMouseLeave={e=>(e.currentTarget.style.color="#94a3b8")}
            >{l}</a>
          ))}
        </Flex>

        {/* Auth buttons */}
        <Flex style={{gap:10,alignItems:"center"}}>
          <Link href="/client/login" style={{
            color:"#e2e8f0",fontSize:14,fontWeight:600,textDecoration:"none",
            padding:"8px 18px",borderRadius:8,border:"1px solid rgba(255,255,255,0.15)",
            transition:"border-color .15s",
          }}>Entrar</Link>
          <Link href="/client/register" style={{
            color:"#fff",fontSize:14,fontWeight:700,textDecoration:"none",
            padding:"9px 20px",borderRadius:8,
            background:`linear-gradient(135deg, ${TEAL2} 0%, ${BLUE} 100%)`,
          }}>Criar conta</Link>
        </Flex>
    </nav>
  );
}

/* ─── dashboard mockup ──────────────────────────────────────────────────── */
function DashboardMockup() {
  return (
    <div style={{
      background:"#0d1224",borderRadius:16,
      border:"1px solid rgba(255,255,255,0.10)",
      boxShadow:`0 0 80px rgba(45,212,191,0.12), 0 24px 64px rgba(0,0,0,0.7)`,
      overflow:"hidden",fontSize:11,color:"#cbd5e1",
      transform:"perspective(900px) rotateY(-4deg) rotateX(1deg)",
      width:"100%",maxWidth:500,
    }}>
      {/* Top bar */}
      <div style={{background:"#080c1a",padding:"10px 14px",borderBottom:"1px solid rgba(255,255,255,0.07)",
        display:"flex",alignItems:"center",justifyContent:"space-between"}}>
        <Flex style={{alignItems:"center",gap:7}}>
          <div style={{width:22,height:22,borderRadius:5,background:`linear-gradient(135deg,${TEAL},${BLUE})`,
            display:"flex",alignItems:"center",justifyContent:"center",fontWeight:900,fontSize:11,color:"#fff"}}>D</div>
          <span style={{fontWeight:700,fontSize:13,color:"#f1f5f9"}}>DECIDE</span>
        </Flex>
        <Flex style={{gap:4}}>
          {["Resumo","Recomendações","Carteira","Histórico","Relatórios","Definições"].map((t,i)=>(
            <span key={t} style={{padding:"3px 7px",borderRadius:5,fontSize:9.5,fontWeight:i===0?700:400,
              background:i===0?"rgba(45,212,191,0.15)":"transparent",
              color:i===0?TEAL:"#64748b",cursor:"pointer"}}>{t}</span>
          ))}
        </Flex>
      </div>

      {/* KPI row */}
      <div style={{padding:"12px 14px 8px",display:"flex",gap:10,borderBottom:"1px solid rgba(255,255,255,0.06)"}}>
        <div style={{flex:1}}>
          <div style={{fontSize:9,color:"#64748b",marginBottom:3,fontWeight:500,textTransform:"uppercase",letterSpacing:.5}}>Património</div>
          <div style={{fontSize:22,fontWeight:800,color:"#f1f5f9",letterSpacing:-1}}>€ 125.430</div>
          <div style={{fontSize:11,color:"#22c55e",fontWeight:700,marginTop:2}}>+8,42% <span style={{color:"#64748b",fontWeight:400}}>(YTD)</span></div>
        </div>
        <div style={{textAlign:"center",padding:"0 10px",borderLeft:"1px solid rgba(255,255,255,0.07)"}}>
          <div style={{fontSize:9,color:"#64748b",marginBottom:6,textTransform:"uppercase",letterSpacing:.5}}>Risco da carteira</div>
          <div style={{width:56,height:56,borderRadius:"50%",border:"4px solid rgba(255,255,255,0.08)",
            display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",margin:"0 auto",
            background:`conic-gradient(${TEAL} 0% 50%, rgba(255,255,255,0.06) 50% 100%)`,
            position:"relative"}}>
            <div style={{width:40,height:40,borderRadius:"50%",background:"#0d1224",
              display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",
              position:"absolute"}}>
              <span style={{fontSize:14,fontWeight:800,color:"#f1f5f9"}}>5/10</span>
            </div>
          </div>
          <div style={{fontSize:9,color:"#64748b",marginTop:4}}>Moderado</div>
        </div>
        <div style={{borderLeft:"1px solid rgba(255,255,255,0.07)",paddingLeft:10}}>
          <div style={{fontSize:9,color:"#64748b",marginBottom:4,textTransform:"uppercase",letterSpacing:.5}}>Impacto esperado</div>
          <div style={{marginBottom:4}}>
            <div style={{fontSize:9,color:"#64748b"}}>Retorno</div>
            <div style={{fontSize:13,fontWeight:700,color:"#22c55e"}}>+1,35%</div>
          </div>
          <div>
            <div style={{fontSize:9,color:"#64748b"}}>Risco</div>
            <div style={{fontSize:13,fontWeight:700,color:"#f87171"}}>-0,12</div>
          </div>
        </div>
      </div>

      {/* Recommendation */}
      <div style={{padding:"10px 14px",borderBottom:"1px solid rgba(255,255,255,0.06)"}}>
        <Flex style={{alignItems:"center",justifyContent:"space-between",marginBottom:6}}>
          <Flex style={{alignItems:"center",gap:6}}>
            <span style={{fontSize:9,fontWeight:700,color:"#f1f5f9"}}>Recomendação principal</span>
            <span style={{fontSize:8,padding:"1px 6px",borderRadius:4,background:TEAL,color:"#000",fontWeight:700}}>NOVA</span>
          </Flex>
        </Flex>
        <div style={{fontSize:12,fontWeight:700,color:"#f1f5f9",marginBottom:4}}>
          Aumentar exposição a tecnologia
        </div>
        <div style={{fontSize:9.5,color:"#64748b",marginBottom:8,lineHeight:1.5}}>
          Aumentar de 19% para 34% do portfólio.<br/>
          Teste: Valorização anrista e revisões de lucros positivas.
        </div>
        <Flex style={{gap:6}}>
          <button style={{flex:1,padding:"5px 0",borderRadius:6,border:"1px solid rgba(255,255,255,0.15)",
            background:"transparent",color:"#94a3b8",fontSize:9.5,cursor:"pointer",fontWeight:600}}>
            Ver detalhes da base →
          </button>
          <button style={{flex:1,padding:"5px 0",borderRadius:6,border:"none",
            background:`linear-gradient(90deg,${TEAL2},${BLUE})`,color:"#fff",fontSize:9.5,cursor:"pointer",fontWeight:700}}>
            Aprovar
          </button>
        </Flex>
      </div>

      {/* Allocation + Region */}
      <div style={{padding:"10px 14px",display:"flex",gap:14}}>
        <div style={{flex:1}}>
          <div style={{fontSize:9,color:"#64748b",marginBottom:6,textTransform:"uppercase",letterSpacing:.5}}>Alocação por classe de ativos</div>
          <Flex style={{alignItems:"center",gap:8}}>
            <div style={{width:44,height:44,borderRadius:"50%",flexShrink:0,
              background:`conic-gradient(${TEAL} 0% 65%, #3b82f6 65% 85%, #a78bfa 85% 93%, #f59e0b 93% 100%)`}}/>
            <div style={{fontSize:8.5,display:"flex",flexDirection:"column",gap:3}}>
              {[{c:TEAL,l:"Ações",v:"65%"},{c:BLUE,l:"Obrigações",v:"20%"},{c:"#a78bfa",l:"Alternativos",v:"7%"}].map(x=>(
                <Flex key={x.l} style={{alignItems:"center",gap:5}}>
                  <div style={{width:6,height:6,borderRadius:2,background:x.c,flexShrink:0}}/>
                  <span style={{color:"#94a3b8"}}>{x.l}</span>
                  <span style={{color:"#f1f5f9",fontWeight:600,marginLeft:"auto",paddingLeft:8}}>{x.v}</span>
                </Flex>
              ))}
            </div>
          </Flex>
        </div>
        <div style={{flex:1,borderLeft:"1px solid rgba(255,255,255,0.06)",paddingLeft:12}}>
          <div style={{fontSize:9,color:"#64748b",marginBottom:6,textTransform:"uppercase",letterSpacing:.5}}>Exposição por região</div>
          {[{l:"EUA",v:42,c:TEAL},{l:"Europa",v:28,c:BLUE},{l:"Ásia",v:10,c:"#a78bfa"},{l:"Outros",v:8,c:"#f59e0b"}].map(x=>(
            <div key={x.l} style={{marginBottom:5}}>
              <Flex style={{justifyContent:"space-between",marginBottom:2}}>
                <span style={{fontSize:8.5,color:"#94a3b8"}}>{x.l}</span>
                <span style={{fontSize:8.5,color:"#f1f5f9",fontWeight:600}}>{x.v}%</span>
              </Flex>
              <div style={{height:3,borderRadius:2,background:"rgba(255,255,255,0.06)"}}>
                <div style={{height:"100%",borderRadius:2,background:x.c,width:`${x.v/50*100}%`}}/>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Footer */}
      <div style={{padding:"8px 14px",borderTop:"1px solid rgba(255,255,255,0.06)",
        display:"flex",alignItems:"center",justifyContent:"space-between",background:"#080c1a"}}>
        <Flex style={{alignItems:"center",gap:6}}>
          <div style={{width:22,height:22,borderRadius:"50%",background:"linear-gradient(135deg,#3b82f6,#8b5cf6)",
            display:"flex",alignItems:"center",justifyContent:"center",fontSize:9,fontWeight:800,color:"#fff"}}>JC</div>
          <div>
            <div style={{fontSize:9,fontWeight:600,color:"#e2e8f0"}}>João Cliente</div>
            <div style={{fontSize:8,color:"#64748b"}}>Perfil Moderado</div>
          </div>
        </Flex>
        <div style={{fontSize:8,color:"#475569"}}>Última actualização: 20 mai 2024</div>
      </div>
    </div>
  );
}

/* ─── main page ─────────────────────────────────────────────────────────── */
export default function LandingPage() {
  return (
    <>
      <Head>
        <title>DECIDE — Investir com clareza. Sem perder o controlo.</title>
        <meta name="description" content="O DECIDE combina ciência financeira e tecnologia para lhe dar recomendações personalizadas e acionáveis — e você decide sempre antes de investir."/>
        <meta name="viewport" content="width=device-width, initial-scale=1"/>
        <link rel="icon" href="/favicon.svg"/>
      </Head>

      <div style={{background:BG,minHeight:"100vh",fontFamily:"Inter,system-ui,sans-serif",color:"#f1f5f9"}}>
        <Nav/>

        {/* ── HERO ──────────────────────────────────────────────────────── */}
        <section style={{
          minHeight:"100vh",paddingTop:NAV_H,
          background:`radial-gradient(ellipse 80% 60% at 60% 40%, rgba(45,212,191,0.07) 0%, transparent 60%),
                      radial-gradient(ellipse 50% 50% at 20% 80%, rgba(59,130,246,0.06) 0%, transparent 50%),
                      ${BG}`,
          display:"flex",alignItems:"center",
        }}>
          <div style={{maxWidth:1200,margin:"0 auto",padding:"60px 28px",width:"100%",
            display:"grid",gridTemplateColumns:"1fr 1fr",gap:60,alignItems:"center"}}>

            {/* Left */}
            <div>
              <div style={{
                display:"inline-flex",alignItems:"center",gap:6,
                padding:"5px 12px",borderRadius:20,marginBottom:28,
                background:"rgba(45,212,191,0.08)",border:"1px solid rgba(45,212,191,0.2)",
              }}>
                <div style={{width:6,height:6,borderRadius:"50%",background:TEAL}}/>
                <span style={{fontSize:11,fontWeight:700,letterSpacing:1.5,color:TEAL,textTransform:"uppercase"}}>
                  Advisory quantitativo
                </span>
              </div>

              <h1 style={{
                fontSize:"clamp(2.4rem,4.5vw,3.2rem)",fontWeight:800,lineHeight:1.1,
                margin:"0 0 20px",letterSpacing:-1.5,color:"#f8fafc",
              }}>
                Investir com clareza.<br/>
                Sem perder o{" "}
                <span style={{color:TEAL}}>controlo.</span>
              </h1>

              <p style={{fontSize:16,lineHeight:1.7,color:"#94a3b8",margin:"0 0 36px",maxWidth:500}}>
                O DECIDE combina ciência financeira e tecnologia para lhe dar recomendações personalizadas e acionáveis —
                e <span style={{color:"#e2e8f0",fontWeight:600}}>você decide sempre</span> antes de investir.
              </p>

              <div style={{display:"flex",gap:14,flexWrap:"wrap",marginBottom:44}}>
                <Link href="/client/register" style={{
                  display:"inline-flex",alignItems:"center",gap:8,
                  padding:"14px 28px",borderRadius:10,
                  background:`linear-gradient(135deg, ${TEAL2} 0%, ${BLUE} 100%)`,
                  color:"#fff",fontSize:15,fontWeight:700,textDecoration:"none",
                  boxShadow:`0 4px 24px rgba(45,212,191,0.3)`,
                  transition:"transform .15s,box-shadow .15s",
                }}>
                  Criar conta gratuita <span style={{fontSize:16}}>→</span>
                </Link>
                <Link href="/client/register" style={{
                  display:"inline-flex",alignItems:"center",gap:8,
                  padding:"14px 28px",borderRadius:10,
                  border:"1px solid rgba(255,255,255,0.18)",
                  color:"#e2e8f0",fontSize:15,fontWeight:600,textDecoration:"none",
                  background:"rgba(255,255,255,0.04)",
                }}>
                  Ver exemplo de recomendação
                </Link>
              </div>

              {/* Trust badges */}
              <div style={{display:"flex",gap:24,flexWrap:"wrap",marginBottom:32}}>
                {[
                  {icon:"🛡️",text:"Você aprova antes de investir"},
                  {icon:"🏦",text:"Execução segura via Interactive Brokers"},
                  {icon:"👁",text:"Transparência total em custos e estratégia"},
                ].map(b=>(
                  <div key={b.text} style={{display:"flex",alignItems:"flex-start",gap:8,maxWidth:140}}>
                    <span style={{fontSize:15,flexShrink:0,marginTop:1}}>{b.icon}</span>
                    <span style={{fontSize:11.5,color:"#64748b",lineHeight:1.4,fontWeight:500}}>{b.text}</span>
                  </div>
                ))}
              </div>

              {/* IB partnership */}
              <div style={{display:"flex",alignItems:"center",gap:10,borderTop:"1px solid rgba(255,255,255,0.07)",paddingTop:20}}>
                <span style={{fontSize:12,color:"#475569",fontWeight:500}}>Em parceria com</span>
                <div style={{display:"flex",alignItems:"center",gap:4}}>
                  <div style={{display:"inline-flex",alignItems:"center",gap:6}}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src="/images/ibkr-icon.png" alt="" style={{height:22,width:"auto"}} />
                    <span style={{fontSize:13,fontWeight:700,color:"#cbd5e1",letterSpacing:-0.2}}>Interactive<span style={{fontWeight:800,color:"#f1f5f9"}}>Brokers</span></span>
                  </div>
                  <span style={{display:"none",fontSize:13,fontWeight:700,color:"#94a3b8",letterSpacing:-0.3}}>
                    Interactive<span style={{fontWeight:800,color:"#b0b8c8"}}>Brokers</span>
                  </span>
                </div>
              </div>
            </div>

            {/* Right — dashboard mockup */}
            <div style={{display:"flex",justifyContent:"center",alignItems:"center"}}>
              <DashboardMockup/>
            </div>
          </div>
        </section>

        {/* ── COMO FUNCIONA ─────────────────────────────────────────────── */}
        <section id="como-funciona" style={{
          background:`linear-gradient(180deg, ${BG} 0%, ${BG2} 100%)`,
          padding:"80px 28px",
          borderTop:"1px solid rgba(255,255,255,0.06)",
        }}>
          <div style={{maxWidth:1100,margin:"0 auto"}}>
            <div style={{textAlign:"center",marginBottom:56}}>
              <h2 style={{fontSize:"clamp(1.6rem,3vw,2.2rem)",fontWeight:800,color:"#f8fafc",margin:"0 0 12px",letterSpacing:-0.8}}>
                Como funciona
              </h2>
              <p style={{fontSize:16,color:"#64748b",margin:0,fontWeight:500}}>
                Um processo simples. O controlo é sempre seu.
              </p>
            </div>

            <div style={{display:"flex",alignItems:"flex-start",gap:0,justifyContent:"center"}}>
              {[
                {icon:"👤",step:"1",title:"Defina o seu perfil",desc:"Responda a algumas perguntas sobre os seus objectivos, horizonte e tolerância ao risco."},
                {icon:"📊",step:"2",title:"Receba recomendações",desc:"A nossa IA analisa milhares de ativos e gera recomendações personalizadas para si."},
                {icon:"✅",step:"3",title:"Aprove alterações",desc:"Veja o racional por trás de cada recomendação e aprove apenas as que fazem sentido para si."},
                {icon:"🏛️",step:"4",title:"Execute com segurança",desc:"Execute as operações na sua conta Interactive Brokers com total transparência e controlo."},
              ].map((s,i)=>(
                <React.Fragment key={s.step}>
                  <div style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",textAlign:"center",padding:"0 20px"}}>
                    <div style={{
                      width:72,height:72,borderRadius:"50%",marginBottom:18,
                      border:"2px solid rgba(45,212,191,0.25)",
                      display:"flex",alignItems:"center",justifyContent:"center",
                      fontSize:28,
                      background:"rgba(45,212,191,0.07)",
                    }}>{s.icon}</div>
                    <h3 style={{fontSize:15,fontWeight:700,color:"#f1f5f9",margin:"0 0 10px",letterSpacing:-0.3}}>
                      {s.step}. {s.title}
                    </h3>
                    <p style={{fontSize:13.5,color:"#64748b",lineHeight:1.65,margin:0,maxWidth:200}}>{s.desc}</p>
                  </div>
                  {i<3&&(
                    <div style={{paddingTop:36,color:"rgba(45,212,191,0.4)",fontSize:22,flexShrink:0,userSelect:"none"}}>→</div>
                  )}
                </React.Fragment>
              ))}
            </div>
          </div>
        </section>

        {/* ── O QUE TORNA O DECIDE DIFERENTE ───────────────────────────── */}
        <section id="vantagens" style={{
          background:BG2,
          padding:"80px 28px",
          borderTop:"1px solid rgba(255,255,255,0.06)",
        }}>
          <div style={{maxWidth:1100,margin:"0 auto"}}>
            <h2 style={{fontSize:"clamp(1.6rem,3vw,2.2rem)",fontWeight:800,color:"#f8fafc",textAlign:"center",
              margin:"0 0 52px",letterSpacing:-0.8}}>
              O que torna o DECIDE diferente
            </h2>

            <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:24}}>
              {[
                {icon:"🛡️",color:"#22c55e",title:"Controlo total",
                  desc:"Você decide sempre. Sem execução automática, sem surpresas."},
                {icon:"📈",color:BLUE,title:"Estratégia científica",
                  desc:"Modelos quantitativos avançados, diversificação inteligente e gestão de risco rigorosa."},
                {icon:"👁",color:TEAL,title:"Transparência",
                  desc:"Veja o racional de cada recomendação, custos claros e relatórios completos."},
                {icon:"🤝",color:"#a78bfa",title:"Alinhamento de interesses",
                  desc:"O nosso sucesso está alinhado com o seu: foco em resultados de longo prazo."},
              ].map(c=>(
                <div key={c.title} style={{
                  background:"rgba(255,255,255,0.03)",
                  borderRadius:14,padding:"28px 24px",
                  border:"1px solid rgba(255,255,255,0.08)",
                  transition:"border-color .2s",
                }}>
                  <div style={{
                    width:42,height:42,borderRadius:10,marginBottom:16,fontSize:20,
                    background:`${c.color}18`,display:"flex",alignItems:"center",justifyContent:"center",
                  }}>{c.icon}</div>
                  <h3 style={{fontSize:15,fontWeight:700,color:"#f1f5f9",margin:"0 0 10px"}}>{c.title}</h3>
                  <p style={{fontSize:13.5,color:"#64748b",lineHeight:1.65,margin:0}}>{c.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── PREÇOS ───────────────────────────────────────────────────── */}
        <section id="precos" style={{scrollMarginTop:NAV_H,padding:"80px 28px",background:BG2,borderTop:"1px solid rgba(255,255,255,0.06)"}}>
          <div style={{maxWidth:1100,margin:"0 auto"}}>
            <div style={{textAlign:"center",marginBottom:52}}>
              <div style={{display:"inline-block",fontSize:12,fontWeight:700,letterSpacing:2,
                color:TEAL,textTransform:"uppercase",marginBottom:14}}>Preços</div>
              <h2 style={{fontSize:"clamp(1.5rem,2.8vw,2.1rem)",fontWeight:800,color:"#f8fafc",
                margin:"0 0 14px",letterSpacing:-0.6}}>Simples e transparente</h2>
              <p style={{fontSize:16,color:"#94a3b8",maxWidth:520,margin:"0 auto",lineHeight:1.7}}>
                Dois planos, sem surpresas. Sem comissões de transação escondidas, sem conflito de interesses.
              </p>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:24,maxWidth:820,margin:"0 auto"}}>
              {[
                {plan:"Premium",color:TEAL,price:"€25",period:"/mês",desc:"Para investidores que querem recomendações claras e controlo total com carteiras a partir de €10 000.",features:["Recomendações mensais do modelo","Dashboard e performance em tempo real","Relatório detalhado da carteira","Verificação de identidade incluída","Suporte por email"],href:"/client/register",cta:"Criar conta Premium"},
                {plan:"Private",color:"#a78bfa",price:"Fee NAV",period:"+ performance",desc:"Para carteiras a partir de €50 000 com hedge cambial, relatório avançado e acompanhamento dedicado.",features:["Tudo do plano Premium","Fee alinhada ao desempenho","Hedge cambial configurável","Relatório com análise de risco avançada","Acompanhamento personalizado"],href:"mailto:jcpina01@decidepoweredbyai.com?subject=Plano%20Private%20DECIDE",cta:"Contactar para Private"},
              ].map(p=>(
                <div key={p.plan} style={{
                  background:"rgba(255,255,255,0.025)",border:`1px solid ${p.color}28`,
                  borderRadius:18,padding:"32px 28px",display:"flex",flexDirection:"column",gap:20,
                }}>
                  <div>
                    <div style={{fontSize:11,fontWeight:700,letterSpacing:2,color:p.color,textTransform:"uppercase",marginBottom:8}}>{p.plan}</div>
                    <div style={{display:"flex",alignItems:"baseline",gap:4,marginBottom:10}}>
                      <span style={{fontSize:36,fontWeight:800,color:"#f8fafc"}}>{p.price}</span>
                      <span style={{fontSize:13,color:"#64748b"}}>{p.period}</span>
                    </div>
                    <p style={{fontSize:13.5,color:"#94a3b8",lineHeight:1.65,margin:0}}>{p.desc}</p>
                  </div>
                  <ul style={{listStyle:"none",padding:0,margin:0,display:"flex",flexDirection:"column",gap:8}}>
                    {p.features.map(f=>(
                      <li key={f} style={{display:"flex",alignItems:"center",gap:8,fontSize:13,color:"#cbd5e1"}}>
                        <span style={{color:p.color,fontWeight:700,fontSize:14}}>&#10003;</span>{f}
                      </li>
                    ))}
                  </ul>
                  <Link href={p.href} style={{
                    display:"block",textAlign:"center",padding:"12px 20px",borderRadius:10,
                    background:`${p.color}18`,border:`1px solid ${p.color}40`,
                    color:p.color,fontSize:13,fontWeight:700,textDecoration:"none",
                    transition:"background .2s",
                  }}>{p.cta} →</Link>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── SEGURANÇA ────────────────────────────────────────────────── */}
        <section id="seguranca" style={{scrollMarginTop:NAV_H,padding:"80px 28px",background:BG,borderTop:"1px solid rgba(255,255,255,0.06)"}}>
          <div style={{maxWidth:1100,margin:"0 auto"}}>
            <div style={{textAlign:"center",marginBottom:52}}>
              <div style={{display:"inline-block",fontSize:12,fontWeight:700,letterSpacing:2,
                color:TEAL,textTransform:"uppercase",marginBottom:14}}>Segurança</div>
              <h2 style={{fontSize:"clamp(1.5rem,2.8vw,2.1rem)",fontWeight:800,color:"#f8fafc",
                margin:"0 0 14px",letterSpacing:-0.6}}>
                O seu dinheiro nunca passa pelo DECIDE
              </h2>
              <p style={{fontSize:16,color:"#94a3b8",maxWidth:580,margin:"0 auto",lineHeight:1.7}}>
                Somos um serviço de assessoria e recomendação — os seus ativos ficam sempre na sua conta da Interactive Brokers, regulada e segregada.
              </p>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(240px,1fr))",gap:20}}>
              {[
                {icon:"🏦",color:"#2dd4bf",title:"Ativos segregados na IB",
                  desc:"A sua carteira está na Interactive Brokers — líder mundial regulado pela SEC, FCA e CMVM. O DECIDE nunca detém nem movimenta os seus fundos."},
                {icon:"🔒",color:"#3b82f6",title:"Encriptação e RGPD",
                  desc:"Todos os dados são transmitidos via HTTPS/TLS e armazenados em base de dados cifrada. Cumprimos integralmente o Regulamento Geral de Proteção de Dados (RGPD)."},
                {icon:"🪪",color:"#a78bfa",title:"Verificação de identidade (KYC/AML)",
                  desc:"Cada cliente passa por verificação de identidade biométrica (KYC) e rastreio de branqueamento de capitais (AML), em conformidade com a Diretiva MiFID II."},
                {icon:"🛡️",color:"#f59e0b",title:"Sem acesso à sua conta",
                  desc:"O DECIDE apenas emite recomendações. A execução de qualquer ordem é sempre feita por si, na plataforma da Interactive Brokers, com o seu login exclusivo."},
                {icon:"📋",color:"#34d399",title:"Regulação e conformidade",
                  desc:"Operamos em conformidade com a legislação europeia de serviços de investimento. Parceiros regulados, processos auditáveis e documentação transparente."},
                {icon:"🔑",color:"#fb7185",title:"Autenticação segura",
                  desc:"Acesso protegido por email verificado e código SMS. Sessões com expiração automática. Nenhuma palavra-passe é armazenada em texto simples."},
              ].map(c=>(
                <div key={c.title} style={{
                  background:"rgba(255,255,255,0.025)",border:"1px solid rgba(255,255,255,0.07)",
                  borderRadius:14,padding:"24px 22px",transition:"border-color .2s",
                }}>
                  <div style={{width:40,height:40,borderRadius:10,marginBottom:14,fontSize:19,
                    background:`${c.color}18`,display:"flex",alignItems:"center",justifyContent:"center"}}>{c.icon}</div>
                  <h3 style={{fontSize:14,fontWeight:700,color:"#f1f5f9",margin:"0 0 8px"}}>{c.title}</h3>
                  <p style={{fontSize:13,color:"#64748b",lineHeight:1.65,margin:0}}>{c.desc}</p>
                </div>
              ))}
            </div>
            <div style={{marginTop:32,padding:"16px 24px",background:"rgba(45,212,191,0.04)",
              border:"1px solid rgba(45,212,191,0.12)",borderRadius:12,
              display:"flex",alignItems:"flex-start",gap:14}}>
              <span style={{fontSize:18,flexShrink:0}}>ℹ️</span>
              <p style={{fontSize:12.5,color:"#64748b",lineHeight:1.65,margin:0}}>
                <strong style={{color:"#94a3b8"}}>Aviso regulatório:</strong> o DECIDE presta um serviço de aconselhamento em matéria de investimento. Investimentos em valores mobiliários envolvem risco de perda, incluindo a possibilidade de perda do capital investido. Rendimentos passados não garantem rendimentos futuros. Leia a documentação regulamentar antes de subscrever.
              </p>
            </div>
          </div>
        </section>

        {/* ── SOBRE NÓS ─────────────────────────────────────────────────── */}
        <section id="sobre-nos" style={{scrollMarginTop:NAV_H,padding:"80px 28px",background:BG2,borderTop:"1px solid rgba(255,255,255,0.06)"}}>
          <div style={{maxWidth:1100,margin:"0 auto"}}>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:60,alignItems:"center"}}>
              <div>
                <div style={{fontSize:12,fontWeight:700,letterSpacing:2,color:TEAL,
                  textTransform:"uppercase",marginBottom:14}}>Sobre nós</div>
                <h2 style={{fontSize:"clamp(1.5rem,2.8vw,2.1rem)",fontWeight:800,color:"#f8fafc",
                  margin:"0 0 18px",letterSpacing:-0.6,lineHeight:1.2}}>
                  Construído por quem investe, para quem quer investir melhor
                </h2>
                <p style={{fontSize:15,color:"#94a3b8",lineHeight:1.75,margin:"0 0 16px"}}>
                  O DECIDE nasceu de uma constatação simples: os modelos quantitativos que os melhores fundos de investimento usam são inacessíveis ao investidor individual. Demasiado técnicos, demasiado caros, demasiado opacos.
                </p>
                <p style={{fontSize:15,color:"#94a3b8",lineHeight:1.75,margin:"0 0 16px"}}>
                  A nossa missão é mudar isso — disponibilizar estratégias baseadas em dados, com transparência total, a quem quer tomar decisões de investimento informadas sem delegar o controlo a terceiros.
                </p>
                <p style={{fontSize:15,color:"#94a3b8",lineHeight:1.75,margin:0}}>
                  Somos uma equipa pequena, baseada em Lisboa, com experiência em finanças quantitativas, engenharia de software e gestão de risco. Acreditamos que o melhor investimento é aquele que o investidor compreende.
                </p>
              </div>
              <div style={{display:"flex",flexDirection:"column",gap:16}}>
                {([
                  {dot:TEAL,label:"Localização",val:"Av. Miguel Bombarda 26, 3\u00ba \u2014 Lisboa, Portugal"},
                  {dot:TEAL,label:"Contacto",val:"jcpina01@decidepoweredbyai.com"},
                  {dot:TEAL,label:"Miss\u00e3o",val:"Democratizar o acesso a estrat\u00e9gias quantitativas de investimento"},
                  {dot:TEAL,label:"Tecnologia",val:"Modelos pr\u00f3prios de machine learning e an\u00e1lise fundamentalista, actualizados diariamente"},
                  {dot:TEAL,label:"Regula\u00e7\u00e3o",val:"Operamos em conformidade com MiFID II e legisla\u00e7\u00e3o portuguesa de servi\u00e7os de investimento"},
                ] as {dot:string;label:string;val:string}[]).map(r=>(
                  <div key={r.label} style={{
                    display:"flex",alignItems:"flex-start",gap:14,
                    padding:"14px 18px",background:"rgba(255,255,255,0.025)",
                    border:"1px solid rgba(255,255,255,0.07)",borderRadius:12,
                  }}>
                    <span style={{width:8,height:8,borderRadius:"50%",background:r.dot,flexShrink:0,marginTop:5,display:"inline-block"}}/>
                    <div>
                      <div style={{fontSize:11,fontWeight:600,color:"#475569",textTransform:"uppercase",letterSpacing:1,marginBottom:3}}>{r.label}</div>
                      <div style={{fontSize:13.5,color:"#cbd5e1",lineHeight:1.5}}>{r.val}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* ── CTA BANNER ───────────────────────────────────────────────── */}
        <section style={{
          padding:"80px 28px",
          background:`radial-gradient(ellipse 70% 80% at 50% 50%, rgba(34,197,94,0.10) 0%, rgba(45,212,191,0.06) 30%, ${BG2} 70%)`,
          borderTop:"1px solid rgba(255,255,255,0.06)",
          borderBottom:"1px solid rgba(255,255,255,0.06)",
          textAlign:"center",
        }}>
          <div style={{maxWidth:620,margin:"0 auto"}}>
            <h2 style={{fontSize:"clamp(1.6rem,3vw,2.2rem)",fontWeight:800,color:"#f8fafc",
              margin:"0 0 16px",letterSpacing:-0.8}}>
              Pronto para investir com clareza e controlo?
            </h2>
            <p style={{fontSize:16,color:"#94a3b8",margin:"0 0 36px",lineHeight:1.65}}>
              Crie a sua conta gratuita e receba a sua primeira recomendação.
            </p>
            <Link href="/client/register" style={{
              display:"inline-flex",alignItems:"center",gap:8,
              padding:"15px 36px",borderRadius:10,
              background:`linear-gradient(135deg, ${TEAL2} 0%, ${BLUE} 100%)`,
              color:"#fff",fontSize:16,fontWeight:700,textDecoration:"none",
              boxShadow:`0 4px 32px rgba(45,212,191,0.35)`,
            }}>
              Criar conta gratuita <span>→</span>
            </Link>
            <p style={{fontSize:13,color:"#475569",margin:"16px 0 0",fontWeight:500}}>
              Sem compromisso. Cancele quando quiser.
            </p>
          </div>
        </section>

        {/* ── FOOTER ───────────────────────────────────────────────────── */}
        <footer style={{background:BG,padding:"52px 28px",borderTop:"1px solid rgba(255,255,255,0.06)"}}>
          <div style={{maxWidth:1100,margin:"0 auto"}}>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr auto",gap:32,alignItems:"start",marginBottom:40}}>
              {[
                {icon:"🔒",title:"Segurança de dados",desc:"Os seus dados são encriptados e protegidos de acordo com o RGPD."},
                {icon:"⚖️",title:"Regulado e transparente",desc:"Operamos com parceiros regulados e seguimos as melhores práticas do mercado."},
                {icon:"🏦",title:"Fundos segregados",desc:"Os seus ativos estão sempre segregados e protegidos."},
              ].map(f=>(
                <div key={f.title} style={{display:"flex",alignItems:"flex-start",gap:12}}>
                  <span style={{fontSize:22,flexShrink:0,opacity:.7}}>{f.icon}</span>
                  <div>
                    <div style={{fontSize:13,fontWeight:700,color:"#e2e8f0",marginBottom:5}}>{f.title}</div>
                    <div style={{fontSize:12,color:"#475569",lineHeight:1.6}}>{f.desc}</div>
                  </div>
                </div>
              ))}
              {/* IB logo */}
              <div style={{display:"flex",flexDirection:"column",alignItems:"flex-end",gap:8}}>
                <span style={{fontSize:11,color:"#475569"}}>Em parceria com</span>
                <div style={{display:"inline-flex",alignItems:"center",gap:6}}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src="/images/ibkr-icon.png" alt="" style={{height:24,width:"auto"}} />
                  <span style={{fontSize:13,fontWeight:700,color:"#94a3b8",letterSpacing:-0.2}}>Interactive<span style={{fontWeight:800,color:"#b0b8c8"}}>Brokers</span></span>
                </div>
                <span style={{fontSize:10,color:"#334155"}}>Líder global em serviços de investimento</span>
              </div>
            </div>

            <div style={{borderTop:"1px solid rgba(255,255,255,0.06)",paddingTop:20,
              display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:12}}>
              <div style={{height:44,overflow:"hidden",display:"flex",alignItems:"center"}}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/images/decide-logo-full.png" alt="DECIDE" style={{height:110,width:"auto",mixBlendMode:"screen",opacity:0.8}} />
              </div>
              <p style={{fontSize:11,color:"#334155",margin:0,textAlign:"right",maxWidth:560,lineHeight:1.5}}>
                Informação meramente indicativa. Investimentos envolvem risco de perda. Leia a documentação regulamentar antes de subscrever qualquer serviço.
              </p>
            </div>
          </div>
        </footer>
      </div>
    </>
  );
}
