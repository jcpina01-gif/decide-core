from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, PlainTextResponse, Response
from pathlib import Path
from datetime import datetime, timedelta, timezone
import json, math, hashlib
import numpy as np
import pandas as pd
import yfinance as yf

app = FastAPI(title="DecideAI Backend")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])

ROOT = Path(__file__).parent.resolve()
DEC_JSON = ROOT / "decisions.json"
DEC_CSV  = ROOT / "decisions.csv"

def _to_list(x):
    if x is None: return []
    if isinstance(x, str): return [s.strip().upper() for s in x.split(",") if s.strip()]
    return [str(s).strip().upper() for s in x if str(s).strip()]

def _annualize_vol(daily_ret: pd.Series) -> float:
    s = daily_ret.dropna()
    if s.empty: return 0.0
    return float(s.std(ddof=0) * math.sqrt(252))

def _seed_for(t: str) -> int:
    # semente determinÃ­stica por ticker (para preÃ§os sintÃ©ticos estÃ¡veis)
    h = hashlib.sha256(t.encode("utf-8")).digest()
    return int.from_bytes(h[:4], "little", signed=False)

def _synthetic_prices(tickers, n_days=756):
    # sÃ©rie de dias Ãºteis (termina hoje)
    end = pd.Timestamp.today(tz="UTC").normalize()
    idx = pd.bdate_range(end=end, periods=n_days)
    out = {}
    for t in tickers:
        rs = np.random.RandomState(_seed_for(t))
        mu_annual, vol_annual = 0.08, 0.22
        mu = mu_annual/252.0
        sigma = vol_annual/np.sqrt(252.0)
        rets = rs.normal(loc=mu, scale=sigma, size=len(idx))
        start_price = float(rs.uniform(40, 300))
        prices = start_price * np.cumprod(1.0 + rets)
        out[t] = prices
    df = pd.DataFrame(out, index=idx)
    return df

def _download_prices(tickers):
    # tenta 5 anos; se falhar ou vier vazio, devolve DF vazio (fallback tratado a seguir)
    try:
        df = yf.download(tickers, period="5y", auto_adjust=True, progress=False).get("Close")
        if isinstance(df, pd.Series): df = df.to_frame()
        return df
    except Exception:
        return pd.DataFrame()

@app.head("/")
def root_head():
    """Render e proxies costumam fazer HEAD / — sem isto devolve 404."""
    return Response()


@app.get("/")
def root_get():
    return {"ok": True, "app": "DecideAI Backend", "health": "/api/health"}


@app.get("/api/health")
def api_health():
    return {"ok": True, "app": "DecideAI Backend", "time": datetime.now(timezone.utc).isoformat()}

def _select_weights(universe, benchmark, lookback, top_q, hedge_k, target_vol, px):
    # sinais (momentum simples)
    mom = (px / px.shift(lookback) - 1.0).iloc[-1].dropna()
    mom = mom.drop(index=[c for c in mom.index if c == benchmark], errors="ignore")
    mom_sorted = mom.sort_values(ascending=False)
    picks = list(mom_sorted.index[:max(1, min(top_q, len(mom_sorted)))])
    w = {s: 1.0/len(picks) for s in picks}

    # hedge ao benchmark
    ret = px.pct_change()
    bench_ret = ret[benchmark].dropna() if benchmark in ret.columns else pd.Series(dtype=float)
    port_ret_raw = ret[picks].fillna(0.0).dot(pd.Series(w))
    vol_port = _annualize_vol(port_ret_raw)
    vol_bench = _annualize_vol(bench_ret) if not bench_ret.empty else 0.0
    hedge_w = 0.0
    if hedge_k > 0 and vol_bench > 1e-8:
        hedge_w = -hedge_k * (vol_port / max(vol_bench, 1e-8))

    weights = pd.Series(w, dtype=float)
    if hedge_w != 0.0:
        weights = weights.reindex(list(set(list(weights.index)+[benchmark]))).fillna(0.0)
        weights[benchmark] += hedge_w

    # target vol (escala global)
    cols = [c for c in weights.index if c in ret.columns]
    cur = ret[cols].fillna(0.0).dot(weights.loc[cols])
    cur_ann = _annualize_vol(cur)
    scale = target_vol/cur_ann if (target_vol>0 and cur_ann>1e-8) else 1.0
    weights = (weights * scale).sort_index()
    return weights, ret

def _ensure_prices_or_synthetic(tickers, lookback, min_buffer=120):
    px = _download_prices(tickers)
    need = max(int(lookback) + int(min_buffer), 300)
    if px is None or px.empty or len(px.index) < (lookback + 2):
        # fallback robusto
        px = _synthetic_prices(tickers, n_days=need)
    return px.ffill().dropna(how="all")

@app.post("/run-model")
async def run_model(req: Request):
    try: body = await req.json()
    except: body = {}
    return _run_model_impl(body)


def _run_model_impl(body: dict):
    universe    = _to_list(body.get("universe") or ["AAPL","MSFT","GOOGL","AMZN","NVDA","META"])
    benchmark   = (body.get("benchmark") or "SPY").strip().upper()
    lookback    = int(body.get("lookback", 120))
    top_q       = max(1, int(body.get("top_q", 3)))
    hedge_k     = float(body.get("hedge_strength", 0.30))
    target_vol  = max(0.0, float(body.get("target_vol", 0.15)))

    tickers = sorted(set(universe + [benchmark]))
    px = _ensure_prices_or_synthetic(tickers, lookback)
    w, ret = _select_weights(universe, benchmark, lookback, top_q, hedge_k, target_vol, px)

    now = datetime.now(timezone.utc)
    decisions = [{"date": now.isoformat(), "symbol": sym, "action": ("BUY" if wt>=0 else "SELL"), "weight": round(float(wt),6)} for sym, wt in w.items()]
    DEC_JSON.write_text(json.dumps(decisions, ensure_ascii=False, indent=2), encoding="utf-8")
    DEC_CSV.write_text("symbol,action,weight\n" + "\n".join(f"{d['symbol']},{d['action']},{d['weight']}" for d in decisions) + "\n", encoding="utf-8")

    port = ret[w.index].fillna(0.0).dot(w)
    return {"ok": True, "count": len(decisions), "current_vol": round(_annualize_vol(port),6)}


@app.post("/api/run-model")
async def api_run_model(req: Request):
    try: body = await req.json()
    except: body = {}
    return _run_model_impl(body)

@app.post("/backtest")
async def backtest(req: Request):
    try: body = await req.json()
    except: body = {}
    return _backtest_impl(body)


def _backtest_impl(body: dict):
    universe    = _to_list(body.get("universe") or ["AAPL","MSFT","GOOGL","AMZN","NVDA","META"])
    benchmark   = (body.get("benchmark") or "SPY").strip().upper()
    lookback    = int(body.get("lookback", 120))
    top_q       = max(1, int(body.get("top_q", 3)))
    hedge_k     = float(body.get("hedge_strength", 0.30))
    target_vol  = max(0.0, float(body.get("target_vol", 0.15)))

    tickers = sorted(set(universe + [benchmark]))
    # usa janela maior para backtest (mais suave)
    px = _ensure_prices_or_synthetic(tickers, lookback, min_buffer=240)

    # selecionar pesos usando a janela final de lookback (one-shot)
    px_use = px.iloc[-(lookback+1):].copy()
    w, ret = _select_weights(universe, benchmark, lookback, top_q, hedge_k, target_vol, px_use)

    cols = [c for c in w.index if c in ret.columns]
    port_ret = ret[cols].fillna(0.0).dot(w)
    bench_ret = ret[benchmark].fillna(0.0) if benchmark in ret.columns else pd.Series(0.0, index=ret.index)

    eq = (1.0 + port_ret).cumprod()
    eb = (1.0 + bench_ret).cumprod()

    def max_drawdown(x: pd.Series):
        roll = x.cummax()
        dd = (x/roll - 1.0).min()
        return float(dd) if not np.isnan(dd) else 0.0

    ann_vol = _annualize_vol(port_ret)
    sharpe = float((port_ret.mean()*252) / (ann_vol if ann_vol>1e-12 else np.nan)) if ann_vol>1e-12 else 0.0

    out = {
        "ok": True,
        "dates": [d.strftime("%Y-%m-%d") for d in eq.index],
        "equity": [float(v) for v in eq.values],
        "benchmark": [float(v) for v in eb.values],
        "metrics": { "ann_vol": round(ann_vol,4), "sharpe": round(sharpe,3), "max_dd": round(max_drawdown(eq),3) },
        "weights": { k: float(v) for k,v in w.items() }
    }
    return JSONResponse(out)


@app.post("/api/backtest")
async def api_backtest(req: Request):
    try: body = await req.json()
    except: body = {}
    return _backtest_impl(body)

@app.get("/decisions.csv")
def get_csv():
    if not DEC_CSV.exists():
        return PlainTextResponse("symbol,action,weight\n", media_type="text/csv; charset=utf-8")
    return PlainTextResponse(DEC_CSV.read_text(encoding="utf-8"), media_type="text/csv; charset=utf-8")