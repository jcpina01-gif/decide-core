import type { NextApiRequest, NextApiResponse } from "next"

export default async function handler(req: NextApiRequest, res: NextApiResponse) {

  const backend = "http://127.0.0.1:8090/api/performance/core_overlayed"

  let body:any = {}

  try{
    body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {})
  }catch{
    body = {}
  }

  const payload = {
    profile: body.profile ?? "moderado",
    benchmark: body.benchmark ?? "SPY",
    top_q: body.top_q ?? 20,
    lookback_days: body.lookback_days ?? 120,
    cap_per_ticker: body.cap_per_ticker ?? 0.2,

    use_tws_raw: body.use_tws_raw ?? false,

    include_series: true,
    include_debug: body.include_debug ?? false,

    voltarget_enabled: body.voltarget_enabled ?? true,
    voltarget_window: body.voltarget_window ?? 60
  }

  try{

    const r = await fetch(backend,{
      method:"POST",
      headers:{ "Content-Type":"application/json" },
      body: JSON.stringify(payload)
    })

    const text = await r.text()

    res.status(r.status)

    try{
      res.json(JSON.parse(text))
    }catch{
      res.json({ok:false,error:"backend_non_json",raw:text})
    }

  }catch(e:any){

    res.status(500).json({
      ok:false,
      error:"proxy_failed",
      message:String(e)
    })

  }

}