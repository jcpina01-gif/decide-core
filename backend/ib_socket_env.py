"""
Host/porta da API socket IBKR — **IB Gateway** (recomendado) ou **TWS**; mesmo protocolo e portas por defeito.

Variáveis de ambiente (primeira definida ganha):
  IB_GATEWAY_HOST, depois TWS_HOST, depois 127.0.0.1
  IB_GATEWAY_PORT, depois TWS_PORT, depois **4002** (paper IB Gateway por defeito; TWS paper clássico = 7497 — definir env se usar TWS)

Se existir ``backend/.env`` (KEY=VAL por linha): ``IB_GATEWAY_*`` e ``TWS_*`` definidas
aí **substituem** o ambiente do processo (evita ficar preso a ``IB_GATEWAY_PORT=7497`` no Windows).
Outras chaves do ficheiro só preenchem variáveis ainda em falta.
"""

from __future__ import annotations

import os
from pathlib import Path


def _load_backend_dotenv() -> None:
    path = Path(__file__).resolve().parent / ".env"
    if not path.is_file():
        return
    try:
        text = path.read_text(encoding="utf-8")
    except OSError:
        return
    parsed: dict[str, str] = {}
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, val = line.partition("=")
        key = key.strip()
        if not key:
            continue
        val = val.strip()
        if len(val) >= 2 and val[0] == val[-1] and val[0] in "\"'":
            val = val[1:-1]
        parsed[key] = val

    # Estas chaves vêm do ``backend/.env`` mesmo que o Windows já tenha IB_GATEWAY_PORT=7497, etc.
    _ib_keys = ("IB_GATEWAY_HOST", "IB_GATEWAY_PORT", "TWS_HOST", "TWS_PORT")
    for k in _ib_keys:
        if k in parsed and parsed[k]:
            os.environ[k] = parsed[k]

    for key, val in parsed.items():
        if key in _ib_keys or not val:
            continue
        if key not in os.environ:
            os.environ[key] = val


_load_backend_dotenv()


def ib_socket_host() -> str:
    # Re-ler ``backend/.env`` por pedido — evita ficar com porta antiga se o processo uvicorn
    # arrancou antes do ficheiro existir ou se outro módulo alterou o ambiente após o import.
    _load_backend_dotenv()
    return (os.environ.get("IB_GATEWAY_HOST") or os.environ.get("TWS_HOST") or "127.0.0.1").strip()


def ib_socket_port() -> int:
    _load_backend_dotenv()
    raw = os.environ.get("IB_GATEWAY_PORT") or os.environ.get("TWS_PORT") or "4002"
    return int(raw)
