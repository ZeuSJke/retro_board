"""Наблюдаемость бэкенда: метрики Prometheus и учёт необработанных сбоев."""

from __future__ import annotations

import time
from collections.abc import Callable

from prometheus_client import CONTENT_TYPE_LATEST, Counter, Gauge, Histogram, generate_latest
from starlette.types import ASGIApp, Message, Receive, Scope, Send

HTTP_REQUESTS_TOTAL = Counter(
    "retro_http_requests_total",
    "Total HTTP requests processed",
    ["method", "route", "status"],
)

HTTP_REQUEST_DURATION_SECONDS = Histogram(
    "retro_http_request_duration_seconds",
    "HTTP request latency in seconds",
    ["method", "route"],
)

UNHANDLED_ERRORS_TOTAL = Counter(
    "retro_unhandled_errors_total",
    "Unhandled application exceptions",
    ["source", "exc_type"],
)

WS_ACTIVE_CONNECTIONS = Gauge(
    "retro_ws_active_connections",
    "Current number of active WebSocket connections",
    ["kind"],
)

WS_DROPPED_SLOW_CONSUMERS_TOTAL = Counter(
    "retro_ws_dropped_slow_consumers_total",
    "WebSocket sockets disconnected because outgoing queue filled or send timed out",
)

AI_CALLS_TOTAL = Counter(
    "retro_ai_calls_total",
    "Total calls to the AI gateway",
    ["status"],
)

AI_CALL_DURATION_SECONDS = Histogram(
    "retro_ai_call_duration_seconds",
    "Duration of AI gateway calls in seconds",
    ["status"],
)

# Регистрируется точкой входа, чтобы избежать циклического импорта с ws_manager
_ws_counts_provider: Callable[[], tuple[int, int]] | None = None


def register_ws_counts_provider(provider: Callable[[], tuple[int, int]]) -> None:
    """Зарегистрировать источник текущих счётчиков WS-подключений (board, workspace)."""
    global _ws_counts_provider
    _ws_counts_provider = provider


def record_unhandled_error(source: str, exc_type: str) -> None:
    """Зафиксировать необработанное исключение (http / ws / ai)."""
    UNHANDLED_ERRORS_TOTAL.labels(source=source, exc_type=exc_type).inc()


def record_ws_slow_consumer_drop() -> None:
    WS_DROPPED_SLOW_CONSUMERS_TOTAL.inc()


def record_ai_call(status: str, duration_seconds: float) -> None:
    AI_CALLS_TOTAL.labels(status=status).inc()
    AI_CALL_DURATION_SECONDS.labels(status=status).observe(duration_seconds)


def render_metrics() -> bytes:
    """Собрать снимок метрик в текстовом формате Prometheus."""
    if _ws_counts_provider is not None:
        board_count, workspace_count = _ws_counts_provider()
        WS_ACTIVE_CONNECTIONS.labels(kind="board").set(board_count)
        WS_ACTIVE_CONNECTIONS.labels(kind="workspace").set(workspace_count)
    return generate_latest()


_ALLOWED_HTTP_METHODS = frozenset(
    {"GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"}
)


class MetricsMiddleware:
    """ASGI-middleware для подсчёта HTTP-запросов и их длительности по шаблону маршрута."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        raw_method = str(scope.get("method", "GET")).upper()
        method = raw_method if raw_method in _ALLOWED_HTTP_METHODS else "OTHER"
        status_code = "500"
        start = time.perf_counter()

        async def send_with_status(message: Message) -> None:
            nonlocal status_code
            if message["type"] == "http.response.start":
                status_code = str(message.get("status", 500))
            await send(message)

        try:
            await self.app(scope, receive, send_with_status)
        finally:
            duration = time.perf_counter() - start
            route = scope.get("route")
            route_path = getattr(route, "path", None)
            if not isinstance(route_path, str):
                # Запросы, отклоненные до роутера (CSRF 403, BodySizeLimit 413, 404/405),
                # нельзя помечать сырым URI — иначе неавторизованный клиент раздует метрики.
                route_path = "<unmatched>"
            HTTP_REQUESTS_TOTAL.labels(
                method=method, route=route_path, status=status_code
            ).inc()
            HTTP_REQUEST_DURATION_SECONDS.labels(method=method, route=route_path).observe(
                duration
            )


__all__ = [
    "CONTENT_TYPE_LATEST",
    "MetricsMiddleware",
    "record_ai_call",
    "record_unhandled_error",
    "record_ws_slow_consumer_drop",
    "register_ws_counts_provider",
    "render_metrics",
]
