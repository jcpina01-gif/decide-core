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


# ── Fundamentals & Sector Data (FMP) ─────────────────────────────────────────

FUND_CSV   = ROOT / "data" / "fundamentals_fmp.csv"
SECTOR_CSV = ROOT / "data" / "sectors_fmp.csv"

_fund_cache:   pd.DataFrame | None = None
_sector_cache: pd.DataFrame | None = None

def _load_fund() -> pd.DataFrame:
    global _fund_cache
    if _fund_cache is None and FUND_CSV.exists():
        _fund_cache = pd.read_csv(FUND_CSV, index_col=0)
    return _fund_cache if _fund_cache is not None else pd.DataFrame()

def _load_sectors() -> pd.DataFrame:
    global _sector_cache
    if _sector_cache is None and SECTOR_CSV.exists():
        _sector_cache = pd.read_csv(SECTOR_CSV, index_col=0)
    return _sector_cache if _sector_cache is not None else pd.DataFrame()

def _safe_float(v) -> float | None:
    try:
        f = float(v)
        return None if math.isnan(f) or math.isinf(f) else round(f, 4)
    except Exception:
        return None

def _quality_label(roic: float | None) -> str:
    if roic is None: return "n/d"
    if roic > 0.25:  return "Alta"
    if roic > 0.12:  return "Média"
    return "Baixa"

def _build_ticker_fundamentals(tickers: list[str]) -> list[dict]:
    fund = _load_fund()
    sec  = _load_sectors()
    out  = []
    for tkr in tickers:
        row: dict = {"ticker": tkr}
        if not fund.empty and tkr in fund.index:
            f = fund.loc[tkr]
            row["roic"]              = _safe_float(f.get("roic"))
            row["gross_margin"]      = _safe_float(f.get("gross_margin"))
            row["op_margin"]         = _safe_float(f.get("op_margin"))
            row["net_margin"]        = _safe_float(f.get("net_margin"))
            row["fcf_margin"]        = _safe_float(f.get("fcf_margin"))
            row["debt_equity"]       = _safe_float(f.get("debt_equity"))
            row["current_ratio"]     = _safe_float(f.get("current_ratio"))
            row["interest_coverage"] = _safe_float(f.get("interest_coverage"))
            row["revenue_growth"]    = _safe_float(f.get("revenue_growth"))
            row["eps_stability"]     = _safe_float(f.get("eps_stability"))
            row["pe_ratio"]          = _safe_float(f.get("pe_ratio"))
            row["quality_label"]     = _quality_label(row.get("roic"))
        if not sec.empty and tkr in sec.index:
            s = sec.loc[tkr]
            row["sector"]   = str(s.get("sector",  "") or "")
            row["industry"] = str(s.get("industry","") or "")
            row["name"]     = str(s.get("name",    "") or "")
        out.append(row)
    return out

def _portfolio_quality_summary(tickers: list[str], weights: dict[str, float]) -> dict:
    """Weighted-average quality metrics for a portfolio."""
    fund = _load_fund()
    if fund.empty:
        return {}

    metrics = ["roic", "gross_margin", "op_margin", "net_margin",
               "debt_equity", "revenue_growth"]
    weighted: dict[str, list] = {m: [] for m in metrics}
    w_list: dict[str, list]   = {m: [] for m in metrics}

    for tkr in tickers:
        if tkr not in fund.index:
            continue
        w = weights.get(tkr, 0.0)
        f = fund.loc[tkr]
        for m in metrics:
            v = _safe_float(f.get(m))
            if v is not None:
                weighted[m].append(v * w)
                w_list[m].append(w)

    summary: dict = {}
    for m in metrics:
        if w_list[m]:
            total_w = sum(w_list[m])
            summary[m] = round(sum(weighted[m]) / total_w, 4) if total_w > 0 else None
        else:
            summary[m] = None

    # Sector exposure
    sec = _load_sectors()
    sector_exp: dict[str, float] = {}
    if not sec.empty:
        for tkr in tickers:
            w  = weights.get(tkr, 0.0)
            s  = str(sec.loc[tkr, "sector"]) if tkr in sec.index else "Unknown"
            sector_exp[s] = round(sector_exp.get(s, 0.0) + w, 4)

    summary["sector_exposure"] = dict(
        sorted(sector_exp.items(), key=lambda x: -x[1])
    )

    # Portfolio quality label
    avg_roic = summary.get("roic")
    summary["portfolio_quality_label"] = _quality_label(avg_roic)

    return summary


@app.get("/api/fundamentals")
def get_fundamentals(tickers: str = ""):
    """
    Return FMP fundamental data for a comma-separated list of tickers.
    ?tickers=AAPL,MSFT,NVDA
    """
    tkr_list = [t.strip().upper() for t in tickers.split(",") if t.strip()]
    if not tkr_list:
        return JSONResponse({"error": "tickers param required"}, status_code=400)
    return JSONResponse({"tickers": _build_ticker_fundamentals(tkr_list)})


@app.post("/api/portfolio-quality")
async def portfolio_quality(req: Request):
    """
    Given a list of {ticker, weight} positions, return weighted portfolio quality summary.
    Body: {"positions": [{"ticker": "AAPL", "weight": 0.12}, ...]}
    """
    try:
        body = await req.json()
    except Exception:
        return JSONResponse({"error": "invalid JSON"}, status_code=400)

    positions = body.get("positions", [])
    if not positions:
        # try to load from decisions.json
        if DEC_JSON.exists():
            try:
                dec = json.loads(DEC_JSON.read_text(encoding="utf-8"))
                positions = dec.get("selection", [])
            except Exception:
                pass

    tickers = [p["ticker"] for p in positions if "ticker" in p]
    weights = {p["ticker"]: float(p.get("weight", 0)) for p in positions if "ticker" in p}

    if not tickers:
        return JSONResponse({"error": "no positions"}, status_code=400)

    summary = _portfolio_quality_summary(tickers, weights)
    ticker_data = _build_ticker_fundamentals(tickers)

    return JSONResponse({
        "portfolio_summary": summary,
        "tickers": ticker_data,
        "n_positions": len(tickers),
    })