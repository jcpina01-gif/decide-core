"""
Verificação HMAC dos cabeçalhos de routing IBKR (alinhado a ``frontend/lib/server/ibkrInternalRouting.ts``).

Usado por ``routers/ibkr_snapshot.py`` quando ``DECIDE_IBKR_PER_REQUEST_ROUTING`` está activo.
"""

from __future__ import annotations

import hmac
import json
import os
import time
from typing import Any

from starlette.requests import Request

SIGN_VERSION = "v1"
_MAX_SKEW_MS = 300_000


def _truthy_env(raw: str | None) -> bool:
    s = (raw or "").strip().lower()
    return s in ("1", "true", "yes", "on")


def ibkr_per_request_routing_enabled() -> bool:
    return _truthy_env(os.environ.get("DECIDE_IBKR_PER_REQUEST_ROUTING"))


def ibkr_routing_secret_configured() -> bool:
    return bool((os.environ.get("DECIDE_IBKR_INTERNAL_HMAC_SECRET") or "").strip())


def _parse_route_map() -> dict[str, tuple[str, int, int]]:
    raw = (os.environ.get("DECIDE_IBKR_ROUTE_MAP_JSON") or "").strip()
    if not raw:
        return {}
    try:
        o = json.loads(raw)
    except json.JSONDecodeError:
        return {}
    if not isinstance(o, dict):
        return {}
    out: dict[str, tuple[str, int, int]] = {}
    for k, v in o.items():
        if not k or not isinstance(v, dict):
            continue
        host = str(v.get("host") or "").strip()
        try:
            port = int(v.get("port"))
            client_id = int(v.get("clientId"))
        except (TypeError, ValueError):
            continue
        if not host:
            continue
        out[str(k)] = (host, port, client_id)
    return out


def _allowed_routes() -> set[tuple[str, int, int]]:
    return set(_parse_route_map().values())


def _header(request: Request, name: str) -> str:
    h = request.headers
    v = h.get(name)
    if v is not None:
        return str(v).strip()
    v = h.get(name.lower())
    return str(v).strip() if v is not None else ""


def _canonical_message(
    *,
    ts_ms: int,
    nonce: str,
    paper_mode: bool,
    host: str,
    port: int,
    client_id: int,
) -> str:
    pm = "1" if paper_mode else "0"
    return f"{SIGN_VERSION}\n{ts_ms}\n{nonce}\n{pm}\n{host}\n{port}\n{client_id}\n"


def verify_signed_ibkr_route(request: Request, *, paper_mode: bool) -> tuple[str, int, int] | None:
    """
    Valida cabeçalhos assinados; devolve ``(host, port, client_id)`` ou ``None``.
    """
    secret = (os.environ.get("DECIDE_IBKR_INTERNAL_HMAC_SECRET") or "").strip()
    if not secret:
        return None

    allowed = _allowed_routes()
    if not allowed:
        return None

    sig_ver = _header(request, "X-Decide-Ibkr-Sign-Version")
    ts_raw = _header(request, "X-Decide-Ibkr-Ts")
    nonce = _header(request, "X-Decide-Ibkr-Nonce")
    host = _header(request, "X-Decide-Ibkr-Host")
    port_raw = _header(request, "X-Decide-Ibkr-Port")
    cid_raw = _header(request, "X-Decide-Ibkr-Client-Id")
    sig_hex = _header(request, "X-Decide-Ibkr-Signature")

    if not all((sig_ver, ts_raw, nonce, host, port_raw, cid_raw, sig_hex)):
        return None
    if sig_ver != SIGN_VERSION:
        return None
    try:
        ts_ms = int(ts_raw)
        port = int(port_raw)
        client_id = int(cid_raw)
    except ValueError:
        return None

    now = int(time.time() * 1000)
    if abs(now - ts_ms) > _MAX_SKEW_MS:
        return None

    msg = _canonical_message(
        ts_ms=ts_ms,
        nonce=nonce,
        paper_mode=paper_mode,
        host=host,
        port=port,
        client_id=client_id,
    )
    expected = hmac.new(secret.encode("utf-8"), msg.encode("utf-8"), "sha256").hexdigest()
    if not hmac.compare_digest(expected, sig_hex):
        return None

    route = (host, port, client_id)
    if route not in allowed:
        return None

    return route
