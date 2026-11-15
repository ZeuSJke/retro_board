"""Идентификатор запроса в журнале.

Каждый HTTP-запрос получает идентификатор: он возвращается клиенту в
заголовке X-Request-ID и подставляется во все записи журнала, сделанные при
обработке запроса. По нему жалобу пользователя («вот такой ответ с ошибкой»)
можно связать со строками в журнале пода.
"""

import contextvars
import json
import logging
import os
import re
import uuid
from datetime import UTC, datetime

from starlette.types import ASGIApp, Message, Receive, Scope, Send

request_id_var: contextvars.ContextVar[str] = contextvars.ContextVar("request_id", default="-")

# Идентификатор от прокси принимаем, только если он выглядит безобидно:
# иначе в журнал можно было бы подставить произвольный текст.
_SAFE_ID = re.compile(r"^[A-Za-z0-9._-]{8,64}$")

LOG_FORMAT = "%(asctime)s %(levelname)s [%(request_id)s] %(name)s: %(message)s"


class RequestIdFilter(logging.Filter):
    """Добавляет идентификатор текущего запроса в каждую запись журнала."""

    def filter(self, record: logging.LogRecord) -> bool:
        record.request_id = request_id_var.get()
        return True


class JsonLogFormatter(logging.Formatter):
    """Однострочный JSON-форматер для централизованного сбора логов (`LOG_FORMAT=json`)."""

    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, object] = {
            "ts": datetime.fromtimestamp(record.created, tz=UTC).isoformat(),
            "level": record.levelname,
            "request_id": getattr(record, "request_id", request_id_var.get()),
            "logger": record.name,
            "message": record.getMessage(),
        }
        if record.exc_info:
            payload["exc_info"] = self.formatException(record.exc_info)
        return json.dumps(payload, ensure_ascii=False)


def configure_logging(level: int = logging.INFO, fmt: str | None = None) -> None:
    """Единый формат журнала с идентификатором запроса (`text` или `json` через `LOG_FORMAT`)."""
    selected = (fmt if fmt is not None else os.getenv("LOG_FORMAT", "text")).strip().lower()
    handler = logging.StreamHandler()
    if selected == "json":
        handler.setFormatter(JsonLogFormatter())
    else:
        handler.setFormatter(logging.Formatter(LOG_FORMAT))
    handler.addFilter(RequestIdFilter())
    root = logging.getLogger()
    root.handlers[:] = [handler]
    root.setLevel(level)


class RequestIdMiddleware:
    """Присваивает запросу идентификатор и возвращает его в X-Request-ID."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        incoming = dict(scope.get("headers") or []).get(b"x-request-id", b"").decode("latin-1")
        request_id = incoming if _SAFE_ID.match(incoming) else uuid.uuid4().hex[:16]
        token = request_id_var.set(request_id)

        async def send_with_id(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = list(message.get("headers") or [])
                headers.append((b"x-request-id", request_id.encode()))
                message = {**message, "headers": headers}
            await send(message)

        try:
            await self.app(scope, receive, send_with_id)
        finally:
            request_id_var.reset(token)
