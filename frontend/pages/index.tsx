import Head from "next/head";
import Link from "next/link";
import React from "react";

/* ─── colour tokens ─────────────────────────────────────────────────────── */
const BG      = "#07091a";
const BG2     = "#0b0f22";
const TEAL    = "#2dd4bf";
const TEAL2   = "#14b8a6";
const BLUE    = "#3b82f6";
const NAV_H   = 68;

/* ─── reusable helpers ──────────────────────────────────────────────────── */
const Flex = ({children, style}: {children:React.ReactNode; style?:React.CSSProperties}) =>
  <div style={{display:"flex",...style}}>{children}</div>;

/* ─── nav ───────────────────────────────────────────────────────────────── */
function Nav() {
  return (
    <nav style={{
      position:"fixed",top:0,left:0,right:0,zIndex:100,
      height:NAV_H,
      background:"rgba(7,9,26,0.90)",
      backdropFilter:"blur(14px)",
      borderBottom:"1px solid rgba(255,255,255,0.07)",
    }}>
      <div style={{
        maxWidth:1200,margin:"0 auto",height:"100%",
        display:"flex",alignItems:"center",justifyContent:"space-between",
        padding:"0 28px",
      }}>
        {/* Logo — mix-blend-mode:screen torna o fundo preto transparente */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/images/decide-logo-full.png" alt="DECIDE" style={{height:48,width:"auto",objectFit:"contain",mixBlendMode:"screen"}} />

        {/* Nav links */}
        <Flex style={{gap:32,alignItems:"center"}}>
          {["Como funciona","Vantagens","Preços","Segurança","Sobre nós"].map(l=>(
            <a key={l} href={`#${l.toLowerCase().replace(/ /g,"-").replace(/ç/g,"c").replace(/ã/g,"a")}`}
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
      </div>
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
                  <div style={{background:"rgba(255,255,255,0.92)",borderRadius:6,padding:"3px 8px",display:"inline-flex",alignItems:"center"}}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src="/images/ibkr-logo.png" alt="Interactive Brokers" style={{height:22,width:"auto"}} />
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
        <section id="como-funciona" style={{background:"#ffffff",padding:"80px 28px"}}>
          <div style={{maxWidth:1100,margin:"0 auto"}}>
            <div style={{textAlign:"center",marginBottom:56}}>
              <h2 style={{fontSize:"clamp(1.6rem,3vw,2.2rem)",fontWeight:800,color:"#0f172a",margin:"0 0 12px",letterSpacing:-0.8}}>
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
                      border:"2px solid #e2e8f0",
                      display:"flex",alignItems:"center",justifyContent:"center",
                      fontSize:28,background:"#f8fafc",
                    }}>{s.icon}</div>
                    <h3 style={{fontSize:15,fontWeight:700,color:"#0f172a",margin:"0 0 10px",letterSpacing:-0.3}}>
                      {s.step}. {s.title}
                    </h3>
                    <p style={{fontSize:13.5,color:"#64748b",lineHeight:1.65,margin:0,maxWidth:200}}>{s.desc}</p>
                  </div>
                  {i<3&&(
                    <div style={{paddingTop:36,color:"#cbd5e1",fontSize:22,flexShrink:0,userSelect:"none"}}>→</div>
                  )}
                </React.Fragment>
              ))}
            </div>
          </div>
        </section>

        {/* ── O QUE TORNA O DECIDE DIFERENTE ───────────────────────────── */}
        <section id="vantagens" style={{background:"#f8fafc",padding:"80px 28px"}}>
          <div style={{maxWidth:1100,margin:"0 auto"}}>
            <h2 style={{fontSize:"clamp(1.6rem,3vw,2.2rem)",fontWeight:800,color:"#0f172a",textAlign:"center",
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
                  background:"#ffffff",borderRadius:14,padding:"28px 24px",
                  border:"1px solid #e2e8f0",
                }}>
                  <div style={{
                    width:42,height:42,borderRadius:10,marginBottom:16,fontSize:20,
                    background:`${c.color}18`,display:"flex",alignItems:"center",justifyContent:"center",
                  }}>{c.icon}</div>
                  <h3 style={{fontSize:15,fontWeight:700,color:"#0f172a",margin:"0 0 10px"}}>{c.title}</h3>
                  <p style={{fontSize:13.5,color:"#64748b",lineHeight:1.65,margin:0}}>{c.desc}</p>
                </div>
              ))}
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
                <div style={{background:"rgba(255,255,255,0.88)",borderRadius:6,padding:"4px 10px",display:"inline-flex",alignItems:"center"}}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src="/images/ibkr-logo.png" alt="Interactive Brokers" style={{height:24,width:"auto"}} />
                </div>
                <span style={{fontSize:10,color:"#334155"}}>Líder global em serviços de investimento</span>
              </div>
            </div>

            <div style={{borderTop:"1px solid rgba(255,255,255,0.06)",paddingTop:20,
              display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:12}}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/images/decide-logo-full.png" alt="DECIDE" style={{height:36,width:"auto",objectFit:"contain",mixBlendMode:"screen",opacity:0.75}} />
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
