"""Ограничение размера тела HTTP-запроса.

Без него анонимный клиент может прислать десятки мегабайт JSON на любой
эндпоинт — тело будет прочитано и разобрано раньше, чем сработает проверка
доступа. Лимит применяется на входе в приложение, до CSRF и роутеров,
и не зависит от того, какой прокси стоит перед сервисом.
"""

import json

from starlette.types import ASGIApp, Message, Receive, Scope, Send

_BODY = json.dumps({"detail": "Слишком большой запрос"}, ensure_ascii=False).encode()


async def _reject(send: Send) -> None:
    await send(
        {
            "type": "http.response.start",
            "status": 413,
            "headers": [
                (b"content-type", b"application/json; charset=utf-8"),
                (b"content-length", str(len(_BODY)).encode()),
                # Остаток тела читать не будем — соединение переиспользовать нельзя
                (b"connection", b"close"),
            ],
        }
    )
    await send({"type": "http.response.body", "body": _BODY})


class BodySizeLimitMiddleware:
    """Отвечать 413 на запросы с телом больше `max_bytes`.

    Запрос с заголовком Content-Length отклоняется сразу, без чтения тела.
    Для тела без объявленной длины (chunked) байты считаются по мере чтения:
    при превышении приложению сообщается об обрыве, а его ответ заменяется на 413.
    """

    def __init__(self, app: ASGIApp, max_bytes: int) -> None:
        self.app = app
        self.max_bytes = max_bytes

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        declared = dict(scope.get("headers") or []).get(b"content-length")
        if declared is not None:
            try:
                too_big = int(declared) > self.max_bytes
            except ValueError:
                too_big = True
            if too_big:
                await _reject(send)
                return

        received = 0
        exceeded = False
        response_started = False
        rejected = False

        async def limited_receive() -> Message:
            nonlocal received, exceeded
            if exceeded:
                return {"type": "http.disconnect"}
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > self.max_bytes:
                    exceeded = True
                    return {"type": "http.disconnect"}
            return message

        async def guarded_send(message: Message) -> None:
            nonlocal response_started, rejected
            if not exceeded:
                if message["type"] == "http.response.start":
                    response_started = True
                await send(message)
                return
            # Лимит превышен: что бы приложение ни ответило на «обрыв», отдаём 413
            if not response_started and not rejected:
                rejected = True
                await _reject(send)

        try:
            await self.app(scope, limited_receive, guarded_send)
        except Exception:
            # Исключение из-за «обрыва», который устроили мы сами, — это всё тот же 413
            if not exceeded:
                raise
        if exceeded and not response_started and not rejected:
            await _reject(send)
