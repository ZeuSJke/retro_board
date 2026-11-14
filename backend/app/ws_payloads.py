"""Проверка входящих WebSocket-сообщений.

Всё, что клиент присылает в `data`, недоверенное. Функции модуля возвращают
словарь только с известными полями либо None, если сообщение нужно отбросить.
В рассылку другим клиентам и в состояние ConnectionManager попадает только
очищенное: одно некорректное сообщение не должно ломать доску остальным.
"""

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
    if not math.isfinite(value):
        return None
    if not (low <= value <= high):
        return None
    return value


def short_str(value: object, max_length: int) -> str | None:
    """Вернуть непустую строку не длиннее max_length или None."""
    if not isinstance(value, str) or not value or len(value) > max_length:
        return None
    return value


def clean_timer(event: str, payload: dict) -> dict | None:
    """Очистить данные timer_start / timer_pause / timer_reset."""
    duration = number_in_range(payload.get("duration"), 0, MAX_TIMER_SECONDS)
    remaining = number_in_range(payload.get("remaining"), 0, MAX_TIMER_SECONDS)

    if event == "timer_start":
        if duration is None or remaining is None:
            return None
        clean: dict = {"duration": duration, "remaining": remaining}
        ts = number_in_range(payload.get("ts"), 0, MAX_TIMESTAMP_MS)
        if ts is not None:
            clean["ts"] = ts
        return clean

    if event == "timer_pause":
        if remaining is None:
            return None
        clean = {"remaining": remaining}
        if payload.get("duration") is not None:
            if duration is None:
                return None
            clean["duration"] = duration
        return clean

    if event == "timer_reset":
        if duration is None:
            return None
        return {"duration": duration}

    return None


def clean_cursor_move(payload: dict) -> dict | None:
    """Очистить координаты курсора (имя участника добавляет обработчик)."""
    x = number_in_range(payload.get("x"), 0, MAX_COORD_VALUE)
    y = number_in_range(payload.get("y"), 0, MAX_COORD_VALUE)
    if x is None or y is None:
        return None
    return {"x": x, "y": y}


def clean_group_collapse(payload: dict) -> dict | None:
    """Очистить данные сворачивания группы."""
    group_id = short_str(payload.get("group_id"), MAX_ID_LENGTH)
    collapsed = payload.get("collapsed")
    if group_id is None or not isinstance(collapsed, bool):
        return None
    return {"group_id": group_id, "collapsed": collapsed}
