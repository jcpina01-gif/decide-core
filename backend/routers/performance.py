from __future__ import annotations

import json
import math
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Body, HTTPException, Query

router = APIRouter(prefix="/api/performance", tags=["performance"])


def _project_root() -> Path:
    return Path(__file__).resolve().parents[2]


def _get_dataset_path(dataset: str) -> Path:
    root = _project_root()
    ds = (dataset or "backtest15y").lower()

    candidates: dict[str, list[Path]] = {
        "live": [
            root / "backend" / "data" / "equity_curves" / "core_overlayed" / "core_overlayed_latest.json",
            root / "data" / "equity_curves" / "core_overlayed" / "core_overlayed_latest.json",
        ],
        "backtest15y": [
            root / "backend" / "data" / "equity_curves" / "backtest" / "backtest_15y_equity.json",
            root / "data" / "equity_curves" / "backtest" / "backtest_15y_equity.json",
        ],
    }

    if ds not in candidates:
        raise HTTPException(status_code=400, detail="Dataset invalido. Usa 'live' ou 'backtest15y'.")

    for p in candidates[ds]:
        if p.exists():
            return p

    raise HTTPException(status_code=404, detail=f"Ficheiro do dataset '{ds}' nao encontrado.")


def _read_payload(path: Path) -> dict[str, Any]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Erro a ler JSON: {exc}") from exc

    if not isinstance(payload, dict):
        raise HTTPException(status_code=500, detail="JSON invalido: raiz nao e objeto.")
    return payload


def _rows_list_to_columnar(rows: list[Any]) -> dict[str, Any]:
    """`core_overlayed_latest.json` costuma vir como lista de {date, equity, ...}."""
    dates: list[Any] = []
    benchmark_equity: list[Any] = []
    equity_overlayed: list[Any] = []
    equity_raw: list[Any] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        dates.append(row.get("date"))
        benchmark_equity.append(row.get("benchmark_equity"))
        eq = row.get("equity")
        eo = row.get("equity_overlayed")
        er = row.get("equity_raw")
        equity_overlayed.append(eo if eo is not None else eq)
        equity_raw.append(er if er is not None else eq)
    return {
        "dates": dates,
        "benchmark_equity": benchmark_equity,
        "equity_overlayed": equity_overlayed,
        "equity_raw": equity_raw,
    }


def _normalize_core_overlay_root(raw: Any) -> dict[str, Any]:
    if isinstance(raw, list):
        return _rows_list_to_columnar(raw)
    if isinstance(raw, dict):
        if isinstance(raw.get("dates"), list):
            return raw
        inner = raw.get("series")
        if isinstance(inner, dict) and isinstance(inner.get("dates"), list):
            return inner
    return {}


def _to_float(value: Any) -> float | None:
    if value is None:
        return None
    try:
        x = float(value)
        if math.isfinite(x):
            return x
        return None
    except Exception:
        return None


def _to_date(value: Any) -> datetime | None:
    if value is None:
        return None

    text = str(value).strip()
    if not text:
        return None

    formats = [
        "%Y-%m-%d",
        "%Y/%m/%d",
        "%Y-%m-%dT%H:%M:%S",
        "%Y-%m-%d %H:%M:%S",
    ]
    for fmt in formats:
        try:
            return datetime.strptime(text[:19], fmt)
        except ValueError:
            pass

    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return None


def _equal_series(a: list[float | None], b: list[float | None], tol: float = 1e-12) -> bool:
    if len(a) != len(b):
        return False
    for x, y in zip(a, b):
        if x is None and y is None:
            continue
        if x is None or y is None:
            return False
        if abs(x - y) > tol:
            return False
    return True


def _series_returns(values: list[float | None]) -> list[float]:
    out: list[float] = []
    prev = None
    for v in values:
        if v is None:
            prev = None
            continue
        if prev is not None and prev != 0:
            out.append((v / prev) - 1.0)
        prev = v
    return out


def _total_return(values: list[float | None]) -> float | None:
    valid = [v for v in values if v is not None]
    if len(valid) < 2 or valid[0] == 0:
        return None
    return (valid[-1] / valid[0]) - 1.0


def _max_drawdown(values: list[float | None]) -> float | None:
    valid = [v for v in values if v is not None]
    if not valid:
        return None

    peak = valid[0]
    max_dd = 0.0
    for v in valid:
        if v > peak:
            peak = v
        dd = (v / peak) - 1.0 if peak != 0 else 0.0
        if dd < max_dd:
            max_dd = dd
    return max_dd


def _annualized_vol(values: list[float | None]) -> float | None:
    rets = _series_returns(values)
    if len(rets) < 2:
        return None
    mean = sum(rets) / len(rets)
    var = sum((r - mean) ** 2 for r in rets) / (len(rets) - 1)
    return math.sqrt(var) * math.sqrt(252)


def _annualized_return(values: list[float | None], dates: list[datetime]) -> float | None:
    pairs = [(d, v) for d, v in zip(dates, values) if v is not None]
    if len(pairs) < 2:
        return None

    start_date, start_value = pairs[0]
    end_date, end_value = pairs[-1]

    if start_value == 0:
        return None

    days = (end_date - start_date).days
    if days <= 0:
        return None

    total = (end_value / start_value) - 1.0
    years = days / 365.25
    if years <= 0 or 1.0 + total <= 0:
        return None

    return (1.0 + total) ** (1.0 / years) - 1.0


def _sharpe(values: list[float | None]) -> float | None:
    rets = _series_returns(values)
    if len(rets) < 2:
        return None
    mean = sum(rets) / len(rets)
    var = sum((r - mean) ** 2 for r in rets) / (len(rets) - 1)
    std = math.sqrt(var)
    if std == 0:
        return None
    return (mean / std) * math.sqrt(252)


def _pct(x: float | None) -> float | None:
    return None if x is None else round(x * 100.0, 2)


def _num(x: float | None) -> float | None:
    return None if x is None else round(x, 2)


def _kpi_block(values: list[float | None], dates: list[datetime]) -> dict[str, float | None]:
    return {
        "total_return_pct": _pct(_total_return(values)),
        "annualized_return_pct": _pct(_annualized_return(values, dates)),
        "volatility_pct": _pct(_annualized_vol(values)),
        "max_drawdown_pct": _pct(_max_drawdown(values)),
        "sharpe": _num(_sharpe(values)),
    }


def _build_rows_and_meta(payload: dict[str, Any]) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    dates = payload.get("dates")
    benchmark_equity = payload.get("benchmark_equity")
    equity = payload.get("equity")
    equity_overlayed = payload.get("equity_overlayed")
    equity_raw = payload.get("equity_raw")

    if not isinstance(dates, list):
        raise HTTPException(status_code=500, detail="Campo 'dates' ausente ou invalido.")
    if not isinstance(benchmark_equity, list):
        raise HTTPException(status_code=500, detail="Campo 'benchmark_equity' ausente ou invalido.")

    benchmark_vals = [_to_float(v) for v in benchmark_equity]
    equity_vals = [_to_float(v) for v in (equity if isinstance(equity, list) else [])]
    overlayed_vals = [_to_float(v) for v in (equity_overlayed if isinstance(equity_overlayed, list) else [])]
    raw_vals = [_to_float(v) for v in (equity_raw if isinstance(equity_raw, list) else [])]

    if not overlayed_vals and equity_vals:
        overlayed_vals = equity_vals
    if not raw_vals and equity_vals:
        raw_vals = equity_vals
    if not equity_vals and overlayed_vals:
        equity_vals = overlayed_vals

    raw_available = len(raw_vals) > 0
    overlayed_available = len(overlayed_vals) > 0
    equity_available = len(equity_vals) > 0

    overlayed_equals_equity = overlayed_available and equity_available and _equal_series(overlayed_vals, equity_vals)
    raw_equals_overlayed = raw_available and overlayed_available and _equal_series(raw_vals, overlayed_vals)
    raw_equals_equity = raw_available and equity_available and _equal_series(raw_vals, equity_vals)

    rows: list[dict[str, Any]] = []
    for i, raw_date in enumerate(dates):
        dt = _to_date(raw_date)
        if dt is None:
            continue

        benchmark = benchmark_vals[i] if i < len(benchmark_vals) else None
        equity_model = equity_vals[i] if i < len(equity_vals) else None
        overlayed = overlayed_vals[i] if i < len(overlayed_vals) else None
        raw = raw_vals[i] if i < len(raw_vals) else None

        rows.append(
            {
                "date": dt,
                "benchmark": benchmark,
                "equity_model": equity_model,
                "raw": raw,
                "overlayed": overlayed,
            }
        )

    rows.sort(key=lambda r: r["date"])

    start_date = rows[0]["date"] if rows else None
    end_date = rows[-1]["date"] if rows else None
    years_covered = round(((end_date - start_date).days / 365.25), 2) if start_date and end_date else None

    recommended_model_key = "overlayed" if overlayed_available else "equity_model"
    if overlayed_equals_equity and equity_available:
        recommended_model_key = "equity_model"

    meta = {
        "raw_available": raw_available,
        "overlayed_available": overlayed_available,
        "equity_available": equity_available,
        "overlayed_equals_equity": overlayed_equals_equity,
        "raw_equals_overlayed": raw_equals_overlayed,
        "raw_equals_equity": raw_equals_equity,
        "recommended_model_key": recommended_model_key,
        "notes": [
            "equity_raw ausente" if not raw_available else "equity_raw presente",
            "equity_overlayed ausente" if not overlayed_available else "equity_overlayed presente",
            "equity == equity_overlayed" if overlayed_equals_equity else "equity != equity_overlayed",
        ],
        "start_date": start_date.strftime("%Y-%m-%d") if start_date else None,
        "end_date": end_date.strftime("%Y-%m-%d") if end_date else None,
        "years_covered": years_covered,
    }
    return rows, meta


def _filter_period(rows: list[dict[str, Any]], period: str) -> list[dict[str, Any]]:
    if not rows:
        return rows

    p = (period or "MAX").upper()
    if p == "MAX":
        return rows

    days_map = {
        "1Y": 365,
        "3Y": 365 * 3,
        "5Y": 365 * 5,
        "10Y": 365 * 10,
        "15Y": 365 * 15,
    }
    if p not in days_map:
        raise HTTPException(status_code=400, detail="Periodo invalido. Usa 1Y, 3Y, 5Y, 10Y, 15Y, MAX.")

    cutoff = rows[-1]["date"] - timedelta(days=days_map[p])
    filtered = [r for r in rows if r["date"] >= cutoff]
    return filtered if filtered else rows


@router.get("/equity-curves")
def get_equity_curves(
    period: str = Query(default="MAX", description="1Y, 3Y, 5Y, 10Y, 15Y, MAX"),
    dataset: str = Query(default="backtest15y", description="live | backtest15y"),
) -> dict[str, Any]:
    path = _get_dataset_path(dataset)
    payload = _read_payload(path)
    rows, meta = _build_rows_and_meta(payload)

    if not rows:
        raise HTTPException(status_code=404, detail="Sem observacoes validas.")

    rows = _filter_period(rows, period)

    dates = [r["date"] for r in rows]
    benchmark_values = [r["benchmark"] for r in rows]
    equity_model_values = [r["equity_model"] for r in rows]
    raw_values = [r["raw"] for r in rows]
    overlayed_values = [r["overlayed"] for r in rows]

    series = [
        {
            "date": r["date"].strftime("%Y-%m-%d"),
            "benchmark": r["benchmark"],
            "equity_model": r["equity_model"],
            "raw": r["raw"],
            "overlayed": r["overlayed"],
        }
        for r in rows
    ]

    return {
        "dataset": dataset.lower(),
        "source_file": str(path),
        "period": period.upper(),
        "points": len(series),
        "start_date": meta["start_date"],
        "end_date": meta["end_date"],
        "years_covered": meta["years_covered"],
        "series": series,
        "series_meta": meta,
        "kpis": {
            "benchmark": _kpi_block(benchmark_values, dates),
            "equity_model": _kpi_block(equity_model_values, dates),
            "raw": _kpi_block(raw_values, dates) if meta["raw_available"] else None,
            "overlayed": _kpi_block(overlayed_values, dates) if meta["overlayed_available"] else None,
        },
    }


@router.post("/core_overlayed")
def post_core_overlayed(payload: dict[str, Any] | None = Body(default=None)) -> dict[str, Any]:
    """
    Compatível com a landing Next: devolve séries no formato { series: { dates, benchmark_equity, equity_overlayed } }.
    Lê o snapshot em disco (`core_overlayed_latest.json`) — não recalcula o motor em tempo real.
    O corpo JSON é aceite mas ignorado (mesmo contrato que o frontend envia).
    """
    _ = payload if payload is not None else {}
    try:
        path = _get_dataset_path("live")
    except HTTPException as exc:
        detail = exc.detail
        msg = detail if isinstance(detail, str) else json.dumps(detail)
        return {
            "ok": False,
            "error": msg,
            "series": {
                "dates": [],
                "benchmark_equity": [],
                "equity_overlayed": [],
                "equity_raw": [],
            },
        }

    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        return {"ok": False, "error": f"Erro a ler JSON: {exc}", "series": {}}

    norm = _normalize_core_overlay_root(raw)
    dates = norm.get("dates") or []
    if len(dates) < 50:
        return {
            "ok": False,
            "error": "Série insuficiente em core_overlayed_latest.json",
            "series": norm,
        }

    series_out = {
        "dates": dates,
        "benchmark_equity": list(norm.get("benchmark_equity") or []),
        "equity_overlayed": list(norm.get("equity_overlayed") or []),
        "equity_raw": list(norm.get("equity_raw") or []),
    }
    return {
        "ok": True,
        "series": series_out,
        "result": {"source_file": str(path), "kind": "static_snapshot"},
    }