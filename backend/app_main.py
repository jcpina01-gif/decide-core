from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app_shared import MAIN_VERSION, ROOT
from routers.run_model import router as run_model_router
from routers.send_orders import SEND_ORDERS_BUILD_ID, router as send_orders_router
from routers.paper_demo_orders import (
    paper_demo_orders_post,
    paper_demo_orders_probe,
)
from routers.ibkr_snapshot import router as ibkr_snapshot_router
from routers.performance import router as performance_router
from routers.flatten_portfolio import (
    FlattenRequest,
    flatten_paper_portfolio_probe,
    run_flatten_paper_portfolio,
)
from routers.cancel_open_orders_paper import (
    CancelOpenOrdersRequest,
    cancel_open_orders_paper_probe,
    run_cancel_open_orders_paper,
)
from routers.sync_paper_exec_lines import router as sync_paper_exec_lines_router, sync_paper_exec_lines_probe

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/api/health")
def health():
    return {
        "status": "ok",
        "service": "DECIDE backend",
        "main_version": MAIN_VERSION,
        "backend_root": ROOT,
        "send_orders_build": SEND_ORDERS_BUILD_ID,
    }


@app.get("/api/decide-ping-paper-demo")
def decide_ping_paper_demo():
    """Diagnóstico: se isto der 404 na mesma porta, o processo não é este `app_main` (ou é código antigo)."""
    return {
        "ok": True,
        "marker": "DECIDE app_main paper-demo registado em app (não só router)",
    }


# Rotas registadas na app principal (evita confusão se `include_router` falhar em algum arranque).
app.add_api_route(
    "/api/paper-demo-orders",
    paper_demo_orders_probe,
    methods=["GET"],
    tags=["paper-demo-orders"],
)
app.add_api_route(
    "/api/paper-demo-orders",
    paper_demo_orders_post,
    methods=["POST"],
    tags=["paper-demo-orders"],
)

app.include_router(run_model_router)
app.include_router(send_orders_router)
app.include_router(sync_paper_exec_lines_router)
app.include_router(ibkr_snapshot_router)
app.include_router(performance_router)

# Rotas registadas directamente na app (evita 404 se include_router do sub-router falhar em alguns arranques).
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
