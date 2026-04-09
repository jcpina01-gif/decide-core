"""
Host/porta da API socket IBKR — **IB Gateway** (recomendado) ou **TWS**; mesmo protocolo e portas por defeito.

Variáveis de ambiente (primeira definida ganha):
  IB_GATEWAY_HOST, depois TWS_HOST, depois 127.0.0.1
  IB_GATEWAY_PORT, depois TWS_PORT, depois 7497 (paper)
"""

from __future__ import annotations

import os


def ib_socket_host() -> str:
    return (os.environ.get("IB_GATEWAY_HOST") or os.environ.get("TWS_HOST") or "127.0.0.1").strip()


def ib_socket_port() -> int:
    raw = os.environ.get("IB_GATEWAY_PORT") or os.environ.get("TWS_PORT") or "7497"
    return int(raw)
