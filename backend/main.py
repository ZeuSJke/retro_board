import logging
import traceback
from contextlib import asynccontextmanager

from alembic import command
from alembic.config import Config
from sqlalchemy import inspect

from app.config import settings
from app.database import engine
from app.routers import action_items, boards, cards, columns, groups, jira, websocket
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware
from slowapi.errors import RateLimitExceeded
from slowapi import _rate_limit_exceeded_handler
from app.limiter import limiter

logger = logging.getLogger("retroboard")
logging.basicConfig(level=logging.INFO)


@asynccontextmanager
async def lifespan(app: FastAPI):
    alembic_cfg = Config("alembic.ini")
    inspector = inspect(engine)
    tables = inspector.get_table_names()
    if tables and "alembic_version" not in tables:
        # Existing DB without Alembic — stamp current state
        command.stamp(alembic_cfg, "head")
    else:
        command.upgrade(alembic_cfg, "head")
    yield


app = FastAPI(
    title="RetroBoard API",
    description="Agile Retro Board — FastAPI + PostgreSQL",
    version="1.0.0",
    lifespan=lifespan,
)

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)


class GlobalErrorMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        try:
            return await call_next(request)
        except Exception as exc:
            logger.error("Unhandled exception: %s\n%s", exc, traceback.format_exc())
            return JSONResponse(
                status_code=500,
                content={"detail": "Внутренняя ошибка сервера"},
            )


app.add_middleware(GlobalErrorMiddleware)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(boards.router, prefix="/api/boards", tags=["boards"])
app.include_router(columns.router, prefix="/api/columns", tags=["columns"])
app.include_router(cards.router, prefix="/api/cards", tags=["cards"])
app.include_router(groups.router, prefix="/api/groups", tags=["groups"])
app.include_router(action_items.router, prefix="/api/action-items", tags=["action_items"])
app.include_router(jira.router, prefix="/api/jira", tags=["jira"])
app.include_router(websocket.router, tags=["websocket"])


@app.get("/health", tags=["health"])
@app.get("/api/health", tags=["health"], include_in_schema=False)
def health():
    return {"status": "ok"}
