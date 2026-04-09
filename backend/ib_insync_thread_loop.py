"""
Event loop para `ib_insync` em rotas síncronas FastAPI / threads AnyIO.

`ib_insync.util.run` usa `getLoop()` → `asyncio.get_event_loop_policy().get_event_loop()`
e `loop.run_until_complete(...)`. Num worker thread do AnyIO isso falha ou fica inconsistente
se não existir loop **estável** no thread.

**Não fechar** o loop no fim de cada pedido: o mesmo worker reutiliza o loop; fechar
causava «There is no current event loop» no pedido seguinte.

`nest_asyncio` + `util.patchAsyncio()` permitem `run_until_complete` dentro de contextos
onde o uvicorn já tem loops noutros threads.
"""
from __future__ import annotations

import asyncio
import threading
from typing import Tuple

_tls = threading.local()
_patch_done_global = False


def _patch_asyncio_once() -> None:
    global _patch_done_global
    if _patch_done_global:
        return
    try:
        import nest_asyncio

        nest_asyncio.apply()
    except Exception:
        pass
    try:
        from ib_insync import util

        util.patchAsyncio()
    except Exception:
        pass
    _patch_done_global = True


def ensure_ib_insync_loop() -> Tuple[bool, asyncio.AbstractEventLoop | None]:
    """
    Garante um event loop **por thread**, reutilizado entre pedidos.
    Devolve (created_this_call, loop) — `created` só indica se acabámos de criar o loop.
    """
    _patch_asyncio_once()
    loop = getattr(_tls, "ib_loop", None)
    if loop is not None and not loop.is_closed():
        return False, loop

    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    _tls.ib_loop = loop
    return True, loop


def teardown_ib_insync_loop(created: bool, loop: asyncio.AbstractEventLoop | None) -> None:
    """
    Não fechamos o loop aqui — o worker AnyIO reutiliza o mesmo thread; fechar quebrava
    o `ib_insync` no pedido seguinte. Só desligar o IB em cada handler.
    """
    return
