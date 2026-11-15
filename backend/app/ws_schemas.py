"""Типизированные схемы входящих и исходящих WebSocket-сообщений.

Входящие события проходят строгую валидацию до попадания в обработчики и
`ConnectionManager`; некорректные кадры отбрасываются целиком, не нарушая
работу комнаты.
"""

from __future__ import annotations

import math
from typing import Annotated, Any, Literal, TypedDict

from pydantic import BaseModel, BeforeValidator, ConfigDict, Field, StrictBool, StrictStr, ValidationError

from app.ws_payloads import (
    MAX_COORD_VALUE,
    MAX_ID_LENGTH,
    MAX_TIMER_SECONDS,
    MAX_TIMESTAMP_MS,
)

VALID_PHASES: tuple[str, ...] = ("brainstorm", "reveal", "discuss", "vote", "summary")
ALLOWED_REACTIONS: frozenset[str] = frozenset({"❤️", "👍", "🔥", "🎉", "💡", "👏", "😂"})

PhaseLiteral = Literal["brainstorm", "reveal", "discuss", "vote", "summary"]


def _strict_finite_number(low: float, high: float):
    def _validate(value: object) -> float | int:
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise ValueError("must be a finite number")
        if isinstance(value, float) and not math.isfinite(value):
            raise ValueError("must be finite")
        if not (low <= value <= high):
            raise ValueError("number out of range")
        return value

    return BeforeValidator(_validate)


def _strict_nonempty_str(max_length: int):
    def _validate(value: object) -> str:
        if not isinstance(value, str) or not value or len(value) > max_length:
            raise ValueError("must be non-empty string within length limit")
        return value

    return BeforeValidator(_validate)


def _optional_strict_bool(value: object) -> bool | None:
    """Как и прежняя логика ready_toggle: любое не-bool значение считается None (переключение)."""
    return value if isinstance(value, bool) else None


def _coerce_reaction_id(value: object) -> str | None:
    if isinstance(value, str) and value:
        return value[:64]
    return None


CoordValue = Annotated[float | int, _strict_finite_number(0, MAX_COORD_VALUE)]
TimerSeconds = Annotated[float | int, _strict_finite_number(0, MAX_TIMER_SECONDS)]
TimestampMs = Annotated[float | int, _strict_finite_number(0, MAX_TIMESTAMP_MS)]
ShortId = Annotated[str, _strict_nonempty_str(MAX_ID_LENGTH)]


class WsBasePayload(BaseModel):
    """Базовая модель входящего WS-payload: неизвестные поля отбрасываются."""

    model_config = ConfigDict(extra="ignore")


class EmptyWsPayload(WsBasePayload):
    pass


class CursorMoveIn(WsBasePayload):
    x: CoordValue
    y: CoordValue


class GroupCollapseIn(WsBasePayload):
    group_id: ShortId
    collapsed: StrictBool


class TimerStartIn(WsBasePayload):
    duration: TimerSeconds
    remaining: TimerSeconds
    ts: object = None

    def sanitized(self) -> dict[str, Any]:
        clean: dict[str, Any] = {"duration": self.duration, "remaining": self.remaining}
        if (
            not isinstance(self.ts, bool)
            and isinstance(self.ts, (int, float))
            and not (isinstance(self.ts, float) and not math.isfinite(self.ts))
            and 0 <= self.ts <= MAX_TIMESTAMP_MS
        ):
            clean["ts"] = self.ts
        return clean


class TimerPauseIn(WsBasePayload):
    remaining: TimerSeconds
    duration: object = None

    def sanitized(self) -> dict[str, Any] | None:
        clean: dict[str, Any] = {"remaining": self.remaining}
        if self.duration is not None:
            if (
                isinstance(self.duration, bool)
                or not isinstance(self.duration, (int, float))
                or (isinstance(self.duration, float) and not math.isfinite(self.duration))
                or not (0 <= self.duration <= MAX_TIMER_SECONDS)
            ):
                return None
            clean["duration"] = self.duration
        return clean


class TimerResetIn(WsBasePayload):
    duration: TimerSeconds

    def sanitized(self) -> dict[str, Any]:
        return {"duration": self.duration}


class FacilitatorStopIn(WsBasePayload):
    lock_board: StrictBool = False


class FacilitatorTransferIn(WsBasePayload):
    participant_id: ShortId


class PhaseChangeIn(WsBasePayload):
    phase: PhaseLiteral


class ReadyToggleIn(WsBasePayload):
    ready: Annotated[bool | None, BeforeValidator(_optional_strict_bool)] = None


class SpotlightCardIn(WsBasePayload):
    card_id: ShortId | None = None


class ReactionIn(WsBasePayload):
    emoji: StrictStr
    id: Annotated[str | None, BeforeValidator(_coerce_reaction_id)] = Field(default=None)

    def valid_emoji(self) -> bool:
        return self.emoji in ALLOWED_REACTIONS


class CardTypingIn(WsBasePayload):
    column_id: object = None
    is_typing: StrictBool = False

    def sanitized_column_id(self) -> str | None:
        if not isinstance(self.column_id, str) or not self.column_id:
            return None
        if len(self.column_id) > MAX_ID_LENGTH:
            return None
        return self.column_id


INBOUND_EVENT_MODELS: dict[str, type[WsBasePayload]] = {
    "identify": EmptyWsPayload,
    "cursor_move": CursorMoveIn,
    "cursor_leave": EmptyWsPayload,
    "group_collapse": GroupCollapseIn,
    "timer_start": TimerStartIn,
    "timer_pause": TimerPauseIn,
    "timer_reset": TimerResetIn,
    "facilitator_start": EmptyWsPayload,
    "facilitator_stop": FacilitatorStopIn,
    "facilitator_transfer": FacilitatorTransferIn,
    "facilitator_takeover": EmptyWsPayload,
    "phase_change": PhaseChangeIn,
    "summary_generated": EmptyWsPayload,
    "ready_toggle": ReadyToggleIn,
    "spotlight_card": SpotlightCardIn,
    "reaction": ReactionIn,
    "health_check_start": EmptyWsPayload,
    "card_typing": CardTypingIn,
}

KNOWN_EVENTS: frozenset[str] = frozenset(INBOUND_EVENT_MODELS.keys())


def parse_ws_event(event: object, payload: object) -> tuple[str, WsBasePayload] | None:
    """Проверить имя события и разобрать `data` в типизированную модель."""
    if not isinstance(event, str):
        return None
    model_cls = INBOUND_EVENT_MODELS.get(event)
    if model_cls is None:
        return None
    normalized = {} if payload is None else payload
    if not isinstance(normalized, dict):
        return None
    try:
        model = model_cls.model_validate(normalized)
    except ValidationError:
        return None
    if isinstance(model, ReactionIn) and not model.valid_emoji():
        return None
    return event, model


# ── Типизированные исходящие payload-структуры ───────────────────────────────


class ParticipantBriefOut(TypedDict):
    id: str
    name: str


class PresenceUpdateOut(TypedDict):
    users: list[str]
    participants: list[ParticipantBriefOut]


class FacilitatorUpdateOut(TypedDict):
    facilitator: str | None
    facilitator_id: str | None
    facilitator_online: bool
    phase: str | None
    session_id: int | None


class ReadyUpdateOut(TypedDict):
    ready_ids: list[str]
    ready_names: list[str]


class TimerStartOut(TypedDict, total=False):
    duration: float | int
    remaining: float | int
    ts: float | int
    ends_at_ms: float | int


class TimerPauseOut(TypedDict, total=False):
    remaining: float | int
    duration: float | int


class TimerResetOut(TypedDict):
    duration: float | int


class GroupCollapseOut(TypedDict):
    group_id: str
    collapsed: bool


class GroupsCollapsedOut(TypedDict):
    group_ids: list[str]


class CursorMoveOut(TypedDict):
    participant_id: str
    username: str
    x: float | int
    y: float | int


class CursorLeaveOut(TypedDict):
    participant_id: str
    username: str


class SpotlightUpdateOut(TypedDict):
    card_id: str | None


class PhaseUpdateOut(TypedDict):
    phase: str


class ReactionOut(TypedDict):
    id: str
    emoji: str
    username: str
    participant_id: str


class HealthCheckRequestedOut(TypedDict):
    requested_by: str
    participant_id: str


class ParticipantRenamedOut(TypedDict):
    participant_id: str
    name: str
