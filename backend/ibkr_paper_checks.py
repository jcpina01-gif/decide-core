"""
Verificações partilhadas: conta IBKR **paper** (prefixo DU) e flag `IBKR_REQUIRE_PAPER`.
Usado em snapshot, envio de ordens e demos — evita enviar ordens se a ligação for a conta real.
"""

from __future__ import annotations

import os

from ib_insync import IB


def ibkr_require_paper_env() -> bool:
    return os.getenv("IBKR_REQUIRE_PAPER", "1").strip() != "0"


def is_paper_account(ib: IB) -> tuple[bool, list[str]]:
    vals = ib.accountValues()
    accts = sorted({str(v.account).strip() for v in vals if getattr(v, "account", None)})
    is_paper = any(a.upper().startswith("DU") for a in accts)
    return is_paper, accts
