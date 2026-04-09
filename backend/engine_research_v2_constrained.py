"""
DECIDE - engine_research_v2_constrained (STABLE ADAPTER)

Este ficheiro é um ADAPTER pequeno e robusto:
- Evita corrupção/linhas coladas/indentação
- Expõe run_research_v2_constrained() e run_model() (o backend espera isto)
- Carrega SEMPRE o backend\\core.py pelo caminho do ficheiro (sem depender de "import core")
- Tenta executar a função adequada em core.py por ordem, com fallback inteligente

Devolve sempre um dict.
"""

from __future__ import annotations

from typing import Any, Callable, Dict, Tuple
import os
import inspect
import importlib.util
import traceback


def _load_core_by_path() -> Any:
    """
    Load backend/core.py by absolute path, avoiding any import-name collisions.
    """
    here = os.path.dirname(os.path.abspath(__file__))
    core_path = os.path.join(here, "core.py")
    if not os.path.exists(core_path):
        raise RuntimeError(f"core.py não encontrado em: {core_path}")

    spec = importlib.util.spec_from_file_location("decide_core_by_path", core_path)
    if spec is None or spec.loader is None:
        raise RuntimeError("Falha ao criar spec para core.py")

    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)  # type: ignore
    return mod


def _pick_callable(core_mod: Any) -> Tuple[str, Callable[..., Any]]:
    """
    Pick the best callable from core.py.
    Priority:
      1) run_model
      2) run_core
      3) run_engine
      4) run
      5) compute
      6) main
    Otherwise: first callable that looks like an engine runner.
    """
    priority = ("run_model", "run_core", "run_engine", "run", "compute", "main")
    for name in priority:
        fn = getattr(core_mod, name, None)
        if callable(fn):
            return name, fn

    # fallback: first function-like callable not private
    for name in dir(core_mod):
        if name.startswith("_"):
            continue
        fn = getattr(core_mod, name, None)
        if callable(fn):
            # skip classes
            if inspect.isclass(fn):
                continue
            # prefer names that look like runners
            low = name.lower()
            if any(k in low for k in ("run", "engine", "model", "compute", "backtest")):
                return name, fn

    raise RuntimeError("core.py não expõe nenhuma função executável (não encontrei callables).")


def _call_with_signature(fn: Callable[..., Any], kwargs: Dict[str, Any]) -> Any:
    """
    Call fn with kwargs filtered by its signature, unless it accepts **kwargs.
    """
    sig = inspect.signature(fn)
    has_varkw = any(p.kind == inspect.Parameter.VAR_KEYWORD for p in sig.parameters.values())
    if has_varkw:
        return fn(**kwargs)

    accepted: Dict[str, Any] = {}
    for k, v in kwargs.items():
        if k in sig.parameters:
            accepted[k] = v
    return fn(**accepted)


def _call_core(**kwargs) -> Dict[str, Any]:
    core_mod = _load_core_by_path()
    name, fn = _pick_callable(core_mod)

    try:
        out = _call_with_signature(fn, kwargs)
        if isinstance(out, dict):
            out.setdefault("meta", {})
            if isinstance(out["meta"], dict):
                out["meta"].setdefault("engine_entrypoint", "engine_research_v2_constrained(adapter->core_by_path)")
                out["meta"].setdefault("engine_function", name)
                out["meta"].setdefault("core_loaded", "by_path")
            return out

        return {
            "result": out,
            "meta": {
                "engine_entrypoint": "engine_research_v2_constrained(adapter->core_by_path)",
                "engine_function": name,
                "core_loaded": "by_path",
            },
        }
    except Exception as e:
        raise RuntimeError(
            "Falha a executar core.py via adapter. "
            f"engine_function={name} err={e} "
            f"trace={traceback.format_exc()}"
        )


def run_model(*args, **kwargs) -> Dict[str, Any]:
    """
    Interface genérica: aceita kwargs como profile/top_q/start_date/end_date/etc.
    """
    # compat: se vier 'prices' em vez de prices_path
    if "prices_path" not in kwargs and "prices" in kwargs:
        kwargs["prices_path"] = kwargs.pop("prices")

    return _call_core(**kwargs)


def run_research_v2_constrained(*args, **kwargs) -> Dict[str, Any]:
    """
    Alias esperado por engine_entrypoint.py.
    """
    return run_model(*args, **kwargs)