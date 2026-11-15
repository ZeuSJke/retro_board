"""In-memory rate limiter для MCP-эндпоинта `/mcp`.

Разделён на две независимые корзины:
- на валидный `token_id` (чтобы активный агент не мешал остальной команде за NAT);
- на IP при неуспешной аутентификации (тормозит перебор без блокировки валидных токенов).

Автоматически повторяет состояние `app.limiter.limiter.enabled`, поэтому в
`TESTING=true` выключен до тех пор, пока тест не включит `limiter.enabled = True`.
"""

from collections import deque
from threading import Lock
import time

from app.limiter import limiter

MCP_TOKEN_LIMIT_PER_MINUTE = 120
MCP_AUTH_FAIL_LIMIT_PER_MINUTE = 30
_WINDOW_SECONDS = 60.0


class SlidingWindowLimiter:
    def __init__(self) -> None:
        self._lock = Lock()
        self._buckets: dict[str, deque[float]] = {}

    def _allow(self, key: str, limit: int) -> bool:
        if not limiter.enabled:
            return True
        now = time.monotonic()
        cutoff = now - _WINDOW_SECONDS
        with self._lock:
            bucket = self._buckets.get(key)
            if bucket is None:
                bucket = deque()
                self._buckets[key] = bucket
            while bucket and bucket[0] <= cutoff:
                bucket.popleft()
            if len(bucket) >= limit:
                return False
            bucket.append(now)
            return True

    def allow_token(self, token_id: str) -> bool:
        return self._allow(f"token:{token_id}", MCP_TOKEN_LIMIT_PER_MINUTE)

    def allow_auth_failure(self, client_ip: str) -> bool:
        return self._allow(f"auth-fail:{client_ip or 'unknown'}", MCP_AUTH_FAIL_LIMIT_PER_MINUTE)

    def reset(self) -> None:
        with self._lock:
            self._buckets.clear()


mcp_rate_limiter = SlidingWindowLimiter()
