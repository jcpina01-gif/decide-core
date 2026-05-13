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
from routers.ibkr_orders import router as ibkr_orders_router
from routers.client_auth import router as client_auth_router
from routers.portfolio_quality import router as portfolio_quality_router

app = FastAPI()

import os as _os

_CORS_ORIGINS_ENV = _os.environ.get("DECIDE_CORS_ORIGINS", "")
_CORS_ORIGINS: list[str] = (
    [o.strip() for o in _CORS_ORIGINS_ENV.split(",") if o.strip()]
    if _CORS_ORIGINS_ENV.strip()
    else [
        "https://decide-frontend.vercel.app",
        "https://decide-core22.vercel.app",
        # allow any *.vercel.app preview deployments
        "https://*.vercel.app",
        # local dev
        "http://localhost:3000",
        "http://localhost:3001",
    ]
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=_CORS_ORIGINS,
    allow_origin_regex=r"https://.*\.vercel\.app",
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization", "X-Requested-With"],
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
app.include_router(ibkr_orders_router)
app.include_router(sync_paper_exec_lines_router)
app.include_router(ibkr_snapshot_router)
app.include_router(performance_router)
app.include_router(client_auth_router)
app.include_router(portfolio_quality_router)

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
