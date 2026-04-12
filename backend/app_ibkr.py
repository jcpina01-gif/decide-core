"""
Backend IBKR/TWS: saldo/posições, execução de ordens e fecho paper (testes).

- GET  /api/health
- POST /api/ibkr-snapshot  — NetLiquidation, caixa, posições
- POST /api/send-orders    — enviar ordens a mercado (paper)
- GET/POST /api/flatten-paper-portfolio — zerar posições STK na paper (testes)
- GET/POST /api/cancel-open-orders-paper — cancelar ordens em aberto (paper)
- POST /api/sync-paper-exec-lines — sincronizar tabela de execução com a IBKR

Arranque: uvicorn app_ibkr:app --host 127.0.0.1 --port 8090
Requisitos: TWS ou IB Gateway com API activa (paper: porta 7497 por defeito).

Para o backend completo (run-model, performance, …) use `uvicorn main:app` ou `app_main:app`.
"""

from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from routers.cancel_open_orders_paper import (
    CancelOpenOrdersRequest,
    cancel_open_orders_paper_probe,
    run_cancel_open_orders_paper,
)
from routers.flatten_portfolio import (
    FlattenRequest,
    flatten_paper_portfolio_probe,
    run_flatten_paper_portfolio,
)
from ib_socket_env import ib_socket_host, ib_socket_port
from routers.ibkr_snapshot import router as ibkr_snapshot_router
from routers.send_orders import router as send_orders_router
from routers.sync_paper_exec_lines import router as sync_paper_exec_lines_router, sync_paper_exec_lines_probe

app = FastAPI(title="DECIDE IBKR / TWS")

# Com allow_credentials=True o browser rejeita allow_origins=["*"] — quebra POST directo do site para :8090.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health():
    return {
        "status": "ok",
        "service": "DECIDE IBKR / TWS",
        "ib_socket": f"{ib_socket_host()}:{ib_socket_port()}",
        "routes": [
            "/api/ibkr-snapshot",
            "/api/send-orders",
            "/api/flatten-paper-portfolio",
            "/api/cancel-open-orders-paper",
            "/api/sync-paper-exec-lines",
        ],
    }


@app.post("/api/flatten-paper-portfolio", tags=["flatten-portfolio"])
def flatten_paper_portfolio_post(req: FlattenRequest) -> dict:
    return run_flatten_paper_portfolio(req)


@app.get("/api/flatten-paper-portfolio", tags=["flatten-portfolio"])
def flatten_paper_portfolio_get() -> dict:
    return flatten_paper_portfolio_probe()


@app.post("/api/cancel-open-orders-paper", tags=["flatten-portfolio"])
def cancel_open_orders_paper_post(req: CancelOpenOrdersRequest) -> dict:
    return run_cancel_open_orders_paper(req)


@app.get("/api/cancel-open-orders-paper", tags=["flatten-portfolio"])
def cancel_open_orders_paper_get() -> dict:
    return cancel_open_orders_paper_probe()


@app.get("/api/sync-paper-exec-lines", tags=["flatten-portfolio"])
def sync_paper_exec_lines_get() -> dict:
    return sync_paper_exec_lines_probe()


app.include_router(ibkr_snapshot_router)
app.include_router(send_orders_router)
app.include_router(sync_paper_exec_lines_router)
