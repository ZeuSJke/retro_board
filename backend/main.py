import json
import logging
import secrets
import traceback
from contextlib import asynccontextmanager


from app.body_limit import BodySizeLimitMiddleware
from app.config import settings
from app.database import engine
from app.request_context import RequestIdMiddleware, configure_logging
from app.routers import (
    action_items,
    boards,
    cards,
    columns,
    groups,
    health,
    websocket,
    workspaces,
    admin,
)
from fastapi import FastAPI, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.routing import Route
from slowapi.errors import RateLimitExceeded
from slowapi import _rate_limit_exceeded_handler
from app.limiter import limiter
from app.mcp import mcp_asgi_app, mcp_lifespan

logger = logging.getLogger("retroboard")
configure_logging()


@asynccontextmanager
async def lifespan(app: FastAPI):
    from app.ws_manager import assert_single_worker

    assert_single_worker()
    async with mcp_lifespan():
        yield


app = FastAPI(
    title="RetroBoard API",
    description="Agile Retro Board — FastAPI + PostgreSQL",
    version="1.0.0",
    lifespan=lifespan,
)

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)


@app.exception_handler(RequestValidationError)
async def validation_error_handler(request: Request, exc: RequestValidationError) -> Response:
    """Ответ 422 без отражения введённого значения.

    Стандартный обработчик возвращает поле `input` как есть: пароль из
    запроса уезжает обратно в ответ, а строка с одиночным суррогатом
    («\\ud800») роняет сериализацию ответа в 500. Убираем `input` и
    пишем тело в ASCII-экранировании — оно кодируется при любом вводе.
    """
    errors = [
        {key: value for key, value in error.items() if key != "input"}
        for error in exc.errors()
    ]
    body = json.dumps({"detail": jsonable_encoder(errors)}, ensure_ascii=True)
    return Response(content=body, status_code=422, media_type="application/json")


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
        # Skip CSRF for WebSocket upgrades, health checks, and login endpoints
        # (only logins — the rest of /api/admin/* stays protected)
        if (
            request.url.path.startswith("/ws/")
            or request.url.path in ("/mcp", "/mcp/")
            or request.url.path == "/api/admin/login"
            or request.url.path
            in (
                "/health",
                "/api/health",
                "/api/ready",
                "/api/workspaces/login",
                "/api/workspaces/join",
            )
        ):
            return await call_next(request)

        if request.method in self.SAFE_METHODS:
            response = await call_next(request)
            if (
                self.COOKIE_NAME not in request.cookies
                or request.url.path == "/api/workspaces/me"
            ):
                token = request.cookies.get(self.COOKIE_NAME) or secrets.token_urlsafe(32)
                response.set_cookie(
                    self.COOKIE_NAME,
                    token,
                    httponly=False,  # JS must read it
                    samesite="lax",
                    max_age=settings.workspace_jwt_expire_hours * 3600,
                    secure=settings.secure_cookies,
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

# Снаружи CSRF: слишком большое тело отклоняется до любых проверок и разбора
app.add_middleware(
    BodySizeLimitMiddleware, max_bytes=settings.max_request_body_bytes
)

# Идентификатор запроса — снаружи всего остального, чтобы он был в журнале
# и в ответе при любой ошибке, включая 413 и CSRF
app.add_middleware(RequestIdMiddleware)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*", "x-csrf-token"],
)

app.routes.extend(
    [
        Route(
            "/mcp",
            endpoint=mcp_asgi_app,
            methods=["GET", "POST", "DELETE"],
            include_in_schema=False,
        ),
        Route(
            "/mcp/",
            endpoint=mcp_asgi_app,
            methods=["GET", "POST", "DELETE"],
            include_in_schema=False,
        ),
    ]
)

app.include_router(workspaces.router, prefix="/api/workspaces", tags=["workspaces"])
app.include_router(admin.router, prefix="/api/admin", tags=["admin"])
# Раньше досок: статические пути health check не должен перехватить /{board_id}
app.include_router(health.router, prefix="/api/boards", tags=["health"])
app.include_router(boards.router, prefix="/api/boards", tags=["boards"])
app.include_router(columns.router, prefix="/api/columns", tags=["columns"])
app.include_router(cards.router, prefix="/api/cards", tags=["cards"])
app.include_router(groups.router, prefix="/api/groups", tags=["groups"])
app.include_router(
    action_items.router, prefix="/api/action-items", tags=["action_items"]
)
app.include_router(websocket.router, tags=["websocket"])


@app.get("/health", tags=["health"])
@app.get("/api/health", tags=["health"], include_in_schema=False)
async def health():
    """Процесс жив. В БД не ходит: по этой проверке под перезапускают.

    Именно `async def`: обычная функция ждала бы свободный поток из общего пула,
    и при запросах, зависших на базе, проба не уложилась бы в таймаут.
    """
    return {"status": "ok"}


@app.get("/api/ready", tags=["health"], include_in_schema=False)
def ready():
    """Готов обслуживать запросы: база отвечает.

    Для readiness-пробы: под без связи с БД убирается из балансировки, но не
    перезапускается — перезапуск базу не вернёт, а состояние досок в памяти уронит.
    """
    try:
        with engine.connect() as connection:
            connection.exec_driver_sql("SELECT 1")
    except Exception:
        logger.warning("Readiness check failed: database is unreachable", exc_info=True)
        return JSONResponse(status_code=503, content={"status": "database unavailable"})
    return {"status": "ok"}
