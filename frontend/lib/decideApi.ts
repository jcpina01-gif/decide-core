export type Profile = "conservador" | "moderado" | "dinamico";

const BACKEND = "http://127.0.0.1:8090";


function post(url:string,body:any){
  return fetch(url,{
    method:"POST",
    headers:{ "content-type":"application/json"},
    body:JSON.stringify(body)
  }).then(async r=>{
    const t=await r.text();
    let j:any=null;
    try{ j=JSON.parse(t);}catch{}
    if(!r.ok) throw new Error("HTTP "+r.status+" "+r.statusText+" | "+t);
    return j;
  });
}

export async function callCoreOverlayed(req:any){
  return post(BACKEND+"/api/performance/core_overlayed",req);
}

export async function callRegimesRun(req:any){
  return post(BACKEND+"/api/kpis_overlay/regimes/run",req);
}