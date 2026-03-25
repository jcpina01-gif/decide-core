import { useEffect, useState } from "react"
import dynamic from "next/dynamic"

const Plot = dynamic(() => import("react-plotly.js"), { ssr: false })

export default function Compare() {

const [fig,setFig]=useState<any>(null)

useEffect(()=>{

async function run(){

const payload={
profile:"moderado",
benchmark:"DECIDE_OFFICIAL",
lookback_days:120,
top_q:20,
cap_per_ticker:0.20,
include_series:true,
voltarget_enabled:true,
voltarget_window:60,
raw_volmatch_enabled:true
}

const v2=await fetch("/api/proxy/performance/core_overlayed",{
method:"POST",
headers:{"Content-Type":"application/json"},
body:JSON.stringify(payload)
}).then(r=>r.json())

const v3=await fetch("/api/proxy/performance/core_overlayed_v3",{
method:"POST",
headers:{"Content-Type":"application/json"},
body:JSON.stringify(payload)
}).then(r=>r.json())

const dates=v3.series.dates

const figData=[

{
x:dates,
y:v3.series.benchmark_equity,
type:"scatter",
mode:"lines",
name:"Benchmark",
line:{color:"#888",width:2}
},

{
x:dates,
y:v2.series.equity_overlayed,
type:"scatter",
mode:"lines",
name:"Model V2",
line:{color:"#ff9900",width:2}
},

{
x:dates,
y:v3.series.equity_raw,
type:"scatter",
mode:"lines",
name:"Model V3 raw",
line:{color:"#0099ff",width:2,dash:"dot"}
},

{
x:dates,
y:v3.series.equity_overlayed,
type:"scatter",
mode:"lines",
name:"Model V3 overlay",
line:{color:"#00ff99",width:3}
}

]

setFig(figData)

}

run()

},[])

return(

<div style={{
background:"#0b0f14",
color:"#fff",
padding:"30px",
height:"100vh"
}}>

<h2>DECIDE — V2 vs V3</h2>

{fig &&

<Plot
data={fig}
layout={{
paper_bgcolor:"#0b0f14",
plot_bgcolor:"#0b0f14",
font:{color:"#fff"},
xaxis:{title:"Date"},
yaxis:{title:"Equity"},
legend:{orientation:"h"}
}}
style={{width:"100%",height:"80vh"}}
/>

}

</div>

)

}