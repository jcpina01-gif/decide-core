"""
Router: FMP portfolio quality & fundamentals
Endpoints:
  GET  /api/fundamentals?tickers=AAPL,MSFT,...
  POST /api/portfolio-quality   body: {"positions": [{"ticker":"AAPL","weight":0.12},...]}
"""
from __future__ import annotations

import json
import math
from pathlib import Path

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from app_shared import ROOT as _ROOT_STR

ROOT      = Path(_ROOT_STR)
FUND_CSV  = ROOT / "data" / "fundamentals_fmp.csv"
SEC_CSV   = ROOT / "data" / "sectors_fmp.csv"
DEC_JSON  = ROOT / "decisions.json"

_fund_cache: "object | None" = None
_sec_cache:  "object | None" = None

router = APIRouter(tags=["portfolio-quality"])


# ── helpers ──────────────────────────────────────────────────────────────────

def _load_fund():
    import pandas as pd
    global _fund_cache
    if _fund_cache is None and FUND_CSV.exists():
        _fund_cache = pd.read_csv(FUND_CSV, index_col=0)
    import pandas as pd
    return _fund_cache if _fund_cache is not None else pd.DataFrame()


def _load_sectors():
    import pandas as pd
    global _sec_cache
    if _sec_cache is None and SEC_CSV.exists():
        _sec_cache = pd.read_csv(SEC_CSV, index_col=0)
    return _sec_cache if _sec_cache is not None else pd.DataFrame()


def _safe_float(v) -> "float | None":
    try:
        f = float(v)
        return None if math.isnan(f) or math.isinf(f) else round(f, 4)
    except Exception:
        return None


def _quality_label(roic: "float | None") -> str:
    if roic is None:    return "n/d"
    if roic > 0.25:     return "Alta"
    if roic > 0.12:     return "Média"
    return "Baixa"


def _build_ticker_fundamentals(tickers: list) -> list:
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


def _portfolio_quality_summary(tickers: list, weights: dict) -> dict:
    fund = _load_fund()
    if fund.empty:
        return {}

    metrics  = ["roic", "gross_margin", "op_margin", "net_margin",
                "debt_equity", "revenue_growth"]
    weighted = {m: [] for m in metrics}
    w_lists  = {m: [] for m in metrics}

    for tkr in tickers:
        if tkr not in fund.index:
            continue
        w = weights.get(tkr, 0.0)
        f = fund.loc[tkr]
        for m in metrics:
            v = _safe_float(f.get(m))
            if v is not None:
                weighted[m].append(v * w)
                w_lists[m].append(w)

    summary: dict = {}
    for m in metrics:
        if w_lists[m]:
            total_w = sum(w_lists[m])
            summary[m] = round(sum(weighted[m]) / total_w, 4) if total_w > 0 else None
        else:
            summary[m] = None

    # Sector exposure
    sec = _load_sectors()
    sector_exp: dict = {}
    if not sec.empty:
        for tkr in tickers:
            w = weights.get(tkr, 0.0)
            s = str(sec.loc[tkr, "sector"]) if tkr in sec.index else "Unknown"
            sector_exp[s] = round(sector_exp.get(s, 0.0) + w, 4)

    summary["sector_exposure"] = dict(sorted(sector_exp.items(), key=lambda x: -x[1]))
    summary["portfolio_quality_label"] = _quality_label(summary.get("roic"))
    return summary


# ── routes ───────────────────────────────────────────────────────────────────

@router.get("/api/fundamentals")
def get_fundamentals(tickers: str = ""):
    """Return FMP fundamental data. ?tickers=AAPL,MSFT,NVDA"""
    tkr_list = [t.strip().upper() for t in tickers.split(",") if t.strip()]
    if not tkr_list:
        return JSONResponse({"error": "tickers param required"}, status_code=400)
    return JSONResponse({"tickers": _build_ticker_fundamentals(tkr_list)})


@router.post("/api/portfolio-quality")
async def portfolio_quality(req: Request):
    """
    Weighted portfolio quality summary from FMP fundamentals.
    Body: {"positions": [{"ticker": "AAPL", "weight": 0.12}, ...]}
    """
    try:
        body = await req.json()
    except Exception:
        return JSONResponse({"error": "invalid JSON"}, status_code=400)

    positions = body.get("positions", [])
    if not positions and DEC_JSON.exists():
        try:
            dec = json.loads(DEC_JSON.read_text(encoding="utf-8"))
            positions = dec.get("selection", [])
        except Exception:
            pass

    tickers = [p["ticker"] for p in positions if "ticker" in p]
    weights = {p["ticker"]: float(p.get("weight", 0)) for p in positions if "ticker" in p}

    if not tickers:
        return JSONResponse({"error": "no positions"}, status_code=400)

    summary     = _portfolio_quality_summary(tickers, weights)
    ticker_data = _build_ticker_fundamentals(tickers)

    return JSONResponse({
        "portfolio_summary": summary,
        "tickers":           ticker_data,
        "n_positions":       len(tickers),
    })
