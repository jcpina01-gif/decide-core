"""
DECIDE - engine_entrypoint (ROBUST)

Responsabilidade:
- fornecer run_model(...) usado por main.py
- escolher um motor executável de forma robusta
- nunca rebentar com "No callable engine functions available to run" quando existe core.py
"""

from __future__ import annotations

from typing import Any, Dict
import importlib
import traceback

def _try_import(module_name: str):
    try:
        return importlib.import_module(module_name)
    except Exception:
        return None

def _call_first_available(call_plan, **kwargs) -> Dict[str, Any]:
    errors = []
    for label, fn in call_plan:
        if callable(fn):
            try:
                out = fn(**kwargs)  # type: ignore
                if isinstance(out, dict):
                    out.setdefault("meta", {})
                    if isinstance(out["meta"], dict):
                        out["meta"].setdefault("engine_entrypoint", label)
                    return out
                return {"result": out, "meta": {"engine_entrypoint": label}}
            except Exception as e:
                errors.append((label, str(e), traceback.format_exc()))

    # Se chegámos aqui, não havia nada executável
    msg = "No callable engine functions available to run."
    # mas anexamos detalhe para debug
    detail = {"errors": errors}
    raise RuntimeError(msg + " DETAIL=" + str(detail))

def run_model(
    profile: str = "moderado",
    top_q: int = 20,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    benchmark: Optional[str] = None,
    **kwargs
) -> Dict[str, Any]:
    """
    Endpoint handler: devolve dict com chaves esperadas pelo frontend (meta/kpis/etc).
    """
    # kwargs base
    k: Dict[str, Any] = dict(kwargs)
    k["profile"] = profile
    k["top_q"] = top_q
    if start_date is not None:
        k["start_date"] = start_date
    if end_date is not None:
        k["end_date"] = end_date
    if benchmark is not None:
        k["benchmark"] = benchmark

    # Plano: 1) adapter engine_research_v2_constrained 2) core.run_model 3) core.run_core
    call_plan = []

    m = _try_import("engine_research_v2_constrained")
    if m is not None:
        fn = getattr(m, "run_research_v2_constrained", None)
        if callable(fn):
            call_plan.append(("engine_research_v2_constrained.run_research_v2_constrained", fn))
        fn2 = getattr(m, "run_model", None)
        if callable(fn2):
            call_plan.append(("engine_research_v2_constrained.run_model", fn2))

    core = _try_import("core")
    if core is not None:
        fn3 = getattr(core, "run_model", None)
        if callable(fn3):
            call_plan.append(("core.run_model", fn3))
        fn4 = getattr(core, "run_core", None)
        if callable(fn4):
            call_plan.append(("core.run_core", fn4))

    return _call_first_available(call_plan, **k)


def run_engine(*args, **kwargs) -> Dict[str, Any]:
    """Backward-compatible alias for callers that still import run_engine."""
    return run_model(*args, **kwargs)