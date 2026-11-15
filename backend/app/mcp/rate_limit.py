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
    _PRUNE_THRESHOLD = 256
    _MAX_BUCKETS = 10_000

    def __init__(self, max_buckets: int = _MAX_BUCKETS) -> None:
        self._lock = Lock()
        self._buckets: dict[str, deque[float]] = {}
        self._max_buckets = max_buckets

    def _prune_stale(self, cutoff: float) -> None:
        stale = [k for k, dq in self._buckets.items() if not dq or dq[-1] <= cutoff]
        for k in stale:
            del self._buckets[k]

    def _allow(self, key: str, limit: int) -> bool:
        if not limiter.enabled:
            return True
        now = time.monotonic()
        cutoff = now - _WINDOW_SECONDS
        with self._lock:
            bucket = self._buckets.pop(key, None)
            if bucket is None:
                if len(self._buckets) >= min(self._PRUNE_THRESHOLD, self._max_buckets):
                    self._prune_stale(cutoff)
                while len(self._buckets) >= self._max_buckets:
                    oldest_key = next(iter(self._buckets))
                    del self._buckets[oldest_key]
                bucket = deque()
            else:
                while bucket and bucket[0] <= cutoff:
                    bucket.popleft()
            self._buckets[key] = bucket
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
