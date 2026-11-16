"""Базовые примитивы и лимиты проверки входящих WebSocket-сообщений."""

import math

MAX_WS_MESSAGE_CHARS = 4096
MAX_USERNAME_LENGTH = 100
MAX_ID_LENGTH = 100
MAX_COORD_VALUE = 10000
MAX_TIMER_SECONDS = 24 * 60 * 60
# Клиентская отметка времени в миллисекундах; верхняя граница — с запасом на века.
MAX_TIMESTAMP_MS = 10**14


def number_in_range(value: object, low: float, high: float) -> float | int | None:
    """Вернуть число из диапазона или None. bool, NaN и бесконечность числом не считаются."""
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    # isfinite — только для float: на целом из тысяч цифр он бросает OverflowError,
    # а сравнение int с границами диапазона работает при любой величине.
    if isinstance(value, float) and not math.isfinite(value):
        return None
    if not (low <= value <= high):
        return None
    return value


def short_str(value: object, max_length: int) -> str | None:
    """Вернуть непустую строку не длиннее max_length или None."""
    if not isinstance(value, str) or not value or len(value) > max_length:
        return None
    return value
