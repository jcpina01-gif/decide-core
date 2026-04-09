from __future__ import annotations

import inspect
import time
from typing import Any

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from app_shared import (
    DATA_FILE,
    ENGINE_CONSTRAINED_NAME,
    ENGINE_ORIGINAL_NAME,
    MAIN_VERSION,
    ROOT,
)
from engine_entrypoint import run_model

router = APIRouter(tags=["run-model"])


def _parse_exclude_tickers(raw: str | None) -> list[str]:
    if not raw:
        return []
    out: list[str] = []
    for tok in str(raw).split(","):
        t = tok.strip().upper()
        if not t:
            continue
        if not all(ch.isalnum() or ch in ".-" for ch in t):
            continue
        out.append(t)
    # De acordo com UI do cliente B (máximo 5 exclusões)
    return list(dict.fromkeys(out))[:5]


def _apply_exclusions_to_current_portfolio(result: dict[str, Any], excluded: list[str]) -> None:
    if not excluded:
        return
    cp = result.get("current_portfolio")
    if not isinstance(cp, dict):
        return
    positions = cp.get("positions")
    if not isinstance(positions, list):
        return

    excluded_set = set(excluded)
    kept = []
    removed_weight = 0.0
    for p in positions:
        if not isinstance(p, dict):
            continue
        t = str(p.get("ticker", "")).strip().upper()
        if t in excluded_set:
            removed_weight += float(p.get("weight") or 0.0)
            continue
        kept.append(p)

    total_weight = 0.0
    for p in kept:
        total_weight += float(p.get("weight") or 0.0)

    cp["positions"] = kept
    cp["n_positions"] = len(kept)
    cp["max_weight"] = max((float(p.get("weight") or 0.0) for p in kept), default=0.0)
    cp["max_weight_pct"] = cp["max_weight"] * 100.0
    cp["gross_exposure"] = total_weight
    cp["gross_exposure_pct"] = total_weight * 100.0

    meta = result.get("meta")
    if not isinstance(meta, dict):
        meta = {}
        result["meta"] = meta
    meta["exclude_tickers_applied"] = excluded
    meta["exclude_tickers_count"] = len(excluded)
    meta["excluded_weight_total"] = removed_weight


@router.api_route("/api/run-model", methods=["GET", "POST"])
def run_model_endpoint(
    profile: str = "moderado",
    top_q: int = 20,
    start_date: str | None = None,
    exclude_tickers: str | None = None,
):
    t0 = time.time()

    try:
        sig = inspect.signature(run_model)
        run_kwargs = {"profile": profile}
        if "top_q" in sig.parameters:
            run_kwargs["top_q"] = top_q
        if "start_date" in sig.parameters and start_date is not None:
            run_kwargs["start_date"] = start_date
        result = run_model(**run_kwargs)
    except Exception as e:
        return JSONResponse(
            status_code=500,
            content={
                "ok": False,
                "error": str(e),
                "meta": {"runtime_seconds": round(time.time() - t0, 2)},
            },
        )
    if "top_q" not in sig.parameters:
        try:
            if isinstance(result, dict):
                result.setdefault("meta", {})
                result["meta"]["top_q_requested"] = int(top_q)
                result["meta"]["top_q_applied"] = None
                result["meta"]["top_q_note"] = "Current backend run_model does not accept top_q"
        except Exception:
            pass

    if not isinstance(result, dict):
        result = {}

    meta = result.get("meta")
    if not isinstance(meta, dict):
        meta = {}
    result["meta"] = meta

    summary = result.get("summary")
    if not isinstance(summary, dict):
        summary = {}

    result["meta"]["engine_original"] = ENGINE_ORIGINAL_NAME
    result["meta"]["engine_constrained"] = ENGINE_CONSTRAINED_NAME

    if not result["meta"].get("data_file_used"):
        result["meta"]["data_file_used"] = summary.get("data_file_used", DATA_FILE)

    result["meta"]["data_file_used_constrained"] = result["meta"].get("data_file_used", DATA_FILE)

    if "constraints_applied" not in result["meta"]:
        result["meta"]["constraints_applied"] = True

    if "constraints_source" not in result["meta"]:
        result["meta"]["constraints_source"] = (
            "rebalance_only + constrain_portfolio + geo_cap + HARD_CAP + FINAL_LIST_HARDCAP"
        )

    result["meta"]["main_version"] = MAIN_VERSION
    result["meta"]["backend_root"] = ROOT
    result["meta"]["runtime_seconds"] = round(time.time() - t0, 2)
    _apply_exclusions_to_current_portfolio(result, _parse_exclude_tickers(exclude_tickers))

    return result
