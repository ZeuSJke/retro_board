import logging
import secrets
import traceback
from contextlib import asynccontextmanager


from app.config import settings
from app.routers import (
    action_items,
    boards,
    cards,
    columns,
    groups,
    jira,
    websocket,
    workspaces,
    admin,
)
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
            logger.error(
                "Unhandled exception: %s: %s\n%s",
                type(exc).__name__,
                str(exc),
                traceback.format_exc(),
            )
            return JSONResponse(
                status_code=500,
                content={"detail": "Внутренняя ошибка сервера"},
            )


class CSRFMiddleware(BaseHTTPMiddleware):
    SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}
    COOKIE_NAME = "csrf_token"
    HEADER_NAME = "x-csrf-token"

    async def dispatch(self, request: Request, call_next):
        # Skip if disabled via settings
        if not settings.csrf_enabled:
            return await call_next(request)
        # Skip CSRF for WebSocket upgrades, health checks, and auth endpoints
        if (
            request.url.path.startswith("/ws/")
            or request.url.path.startswith("/api/admin/")
            or request.url.path in ("/health", "/api/health", "/api/workspaces/login")
        ):
            return await call_next(request)

        if request.method in self.SAFE_METHODS:
            response = await call_next(request)
            if self.COOKIE_NAME not in request.cookies:
                token = secrets.token_urlsafe(32)
                response.set_cookie(
                    self.COOKIE_NAME,
                    token,
                    httponly=False,  # JS must read it
                    samesite="lax",
                    max_age=86400,
                )
            return response

        cookie_token = request.cookies.get(self.COOKIE_NAME)
        header_token = request.headers.get(self.HEADER_NAME)
        if not cookie_token or cookie_token != header_token:
            return JSONResponse(
                status_code=403,
                content={"detail": "CSRF token missing or invalid"},
            )

        return await call_next(request)


app.add_middleware(GlobalErrorMiddleware)

app.add_middleware(CSRFMiddleware)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*", "x-csrf-token"],
)

app.include_router(workspaces.router, prefix="/api/workspaces", tags=["workspaces"])
app.include_router(admin.router, prefix="/api/admin", tags=["admin"])
app.include_router(boards.router, prefix="/api/boards", tags=["boards"])
app.include_router(columns.router, prefix="/api/columns", tags=["columns"])
app.include_router(cards.router, prefix="/api/cards", tags=["cards"])
app.include_router(groups.router, prefix="/api/groups", tags=["groups"])
app.include_router(
    action_items.router, prefix="/api/action-items", tags=["action_items"]
)
app.include_router(jira.router, prefix="/api/jira", tags=["jira"])
app.include_router(websocket.router, tags=["websocket"])


@app.get("/health", tags=["health"])
@app.get("/api/health", tags=["health"], include_in_schema=False)
def health():
    return {"status": "ok"}
