import asyncio
import json
import logging
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from functools import partial
from typing import Any

import anyio
from fastapi import APIRouter, HTTPException, Query, WebSocket, WebSocketDisconnect
from sqlalchemy.orm import Session

from app import models
from app.config import settings
from app.database import get_db
from app.observability import record_unhandled_error
from app.services.boards import board_group_ids
from app.workspace_auth import SESSION_COOKIE, decode_workspace_token, resolve_session
from app.ws_manager import Peer, manager
from app.ws_payloads import MAX_WS_MESSAGE_CHARS, number_in_range
from app.ws_schemas import (
    ALLOWED_REACTIONS as ALLOWED_REACTIONS,
)
from app.ws_schemas import (
    KNOWN_EVENTS as KNOWN_EVENTS,
)
from app.ws_schemas import (
    VALID_PHASES as VALID_PHASES,
)
from app.ws_schemas import (
    CardTypingIn,
    CursorMoveIn,
    FacilitatorStopIn,
    FacilitatorTransferIn,
    GroupCollapseIn,
    PhaseChangeIn,
    ReactionIn,
    ReadyToggleIn,
    SpotlightCardIn,
    TimerPauseIn,
    TimerResetIn,
    TimerStartIn,
    WsBasePayload,
    parse_ws_event,
)

logger = logging.getLogger(__name__)

router = APIRouter()

WS_RATE_LIMIT = 20  # max non-cursor control messages per second
WS_CURSOR_RATE_LIMIT = 30  # max cursor_move frames per second
WS_RATE_WINDOW = 1.0  # seconds


@dataclass
class _WsContext:
    websocket: WebSocket
    board_id: str
    workspace_id: str
    peer: Peer
    facilitator_id: str | None
    is_facilitator: bool


def _open_ws_db(websocket: WebSocket):
    app = getattr(websocket, "app", None)
    overrides = getattr(app, "dependency_overrides", {}) or {}
    db_dep = overrides.get(get_db, get_db)
    return db_dep()


def _dump_state_snapshot(
    db: Session, board_id: str, state: dict | None
) -> str | None:
    if not state:
        return None
    cleaned = dict(state)
    collapsed = cleaned.get("collapsed_groups")
    if isinstance(collapsed, list):
        valid_group_ids = board_group_ids(db, board_id)
        filtered = [g for g in collapsed if isinstance(g, str) and g in valid_group_ids]
        if filtered:
            cleaned["collapsed_groups"] = filtered
        else:
            cleaned.pop("collapsed_groups", None)
    return json.dumps(cleaned) if cleaned else None


def _sync_board_session_db(
    websocket: WebSocket | None,
    board_id: str,
    workspace_id: str | None,
    facilitator: Peer | None,
    phase: str | None,
    session_id: int | None,
    lock_board: bool = False,
    reveal: bool = False,
    state_snapshot: dict | None = None,
) -> tuple[dict | None, bool | None]:
    """Сохранить состояние сессии в строке доски (выполнять в worker-потоке).

    Возвращает `(настройки_доски_при_блокировке, identity_hidden)`.
    """
    from app.board_view import board_settings_payload

    db_gen = _open_ws_db(websocket) if websocket is not None else get_db()
    try:
        db = next(db_gen)
        board = db.get(models.Board, board_id)
        if (
            not board
            or board.deleted_at is not None
            or (workspace_id is not None and board.workspace_id != workspace_id)
        ):
            return None, None
        board.active_facilitator = facilitator.name if facilitator else None
        board.active_facilitator_id = facilitator.id if facilitator else None
        board.active_phase = phase
        board.active_session_id = session_id
        board.session_state = _dump_state_snapshot(db, board_id, state_snapshot)
        if reveal:
            board.cards_revealed = True
        if lock_board:
            board.is_locked = True
        db.commit()
        hidden = _identity_hidden(board)
        if lock_board:
            return board_settings_payload(board), hidden
        return None, hidden
    except Exception:
        logger.warning("Failed to persist session state for board %s", board_id, exc_info=True)
        return None, None
    finally:
        try:
            next(db_gen)
        except StopIteration:
            pass


def _identity_hidden(board: models.Board) -> bool:
    """Нельзя ли называть, кто печатает: анонимный режим или карточки сейчас скрыты."""
    from app.board_view import cards_hidden

    return bool(board.anonymous_votes or cards_hidden(board))


def _board_is_locked(websocket: WebSocket, board_id: str) -> bool:
    db_gen = _open_ws_db(websocket)
    try:
        db = next(db_gen)
        board = db.get(models.Board, board_id)
        return bool(board is None or board.deleted_at is not None or board.is_locked)
    except Exception:
        logger.warning("Failed to read lock state of board %s", board_id, exc_info=True)
        return False
    finally:
        try:
            next(db_gen)
        except StopIteration:
            pass


def _is_active_room_socket(ctx: _WsContext) -> bool:
    """Проверить, что сокет всё ещё числится в комнате (доска не удалена через cleanup_board)."""
    return ctx.websocket in manager.rooms.get(ctx.board_id, ())


def _persist_session_state(
    websocket: WebSocket, board_id: str, workspace_id: str, state_snapshot: dict | None
) -> None:
    """Сохранить таймер, фокус и свёрнутые группы в строке доски (в worker-потоке)."""
    db_gen = _open_ws_db(websocket)
    try:
        db = next(db_gen)
        board = db.get(models.Board, board_id)
        if board is None or board.deleted_at is not None or board.workspace_id != workspace_id:
            return
        board.session_state = _dump_state_snapshot(db, board_id, state_snapshot)
        db.commit()
    except Exception:
        logger.warning("Failed to persist session state for board %s", board_id, exc_info=True)
    finally:
        try:
            next(db_gen)
        except StopIteration:
            pass


def _clear_board_session_on_grace(
    board_id: str, state_snapshot: dict | None = None
) -> bool | None:
    _payload, hidden = _sync_board_session_db(
        None, board_id, None, None, None, None, state_snapshot=state_snapshot
    )
    return hidden


manager.on_session_cleared = _clear_board_session_on_grace

# Идущие генерации итогов по (доска, сессия): повторный переход в фазу «Итоги»
# не должен запускать вторую генерацию, пока не закончилась первая. Новая
# сессия на той же доске — другой ключ, её итоги не ждут чужую генерацию.
_summary_tasks: dict[tuple[str, int | None], asyncio.Task] = {}


def cancel_board_summary_tasks(board_id: str) -> None:
    """Отменить и забыть незавершённые генерации итогов при удалении доски."""
    for key in [k for k in _summary_tasks if k[0] == board_id]:
        task = _summary_tasks.pop(key, None)
        if task is not None and not task.done():
            task.cancel()


def _origin_allowed(websocket: WebSocket) -> bool:
    origin = (websocket.headers.get("origin") or "").rstrip("/")
    if not origin:
        return False
    allowed = [o.rstrip("/") for o in settings.cors_origins_list]
    return origin in allowed


async def _authenticate_ws(
    websocket: WebSocket,
    query_token: str | None = None,
) -> dict | None:
    """Проверить Origin и подпись токена сессии; вернуть содержимое токена.

    Токен берётся из httpOnly-cookie; параметр запроса оставлен только для
    неинтерактивных клиентов и тестов — браузерный клиент его не использует.
    """
    if not _origin_allowed(websocket):
        await websocket.close(code=1008, reason="Origin not allowed")
        return None

    token = websocket.cookies.get(SESSION_COOKIE) or query_token
    if not token:
        await websocket.close(code=1008, reason="Workspace token required")
        return None

    try:
        return decode_workspace_token(token)
    except HTTPException:
        await websocket.close(code=1008, reason="Invalid or expired token")
        return None


async def _trigger_summary_generation(
    board_id: str, facilitator_id: str, workspace_id: str
):
    """Trigger automatic summary generation when entering summary phase.

    This function is called when facilitator changes phase to 'summary'.
    Generation runs in a thread with its own DB session (see services.boards module).
    """
    from app.services import boards as boards_service

    if not settings.ai_configured:
        # Без шлюза не занимаем ни поток, ни соединение с БД.
        await manager.broadcast(
            board_id,
            "summary_failed",
            {"message": "AI не настроен: итоги не сгенерированы"},
        )
        return

    logger.info("Starting summary generation for board %s", board_id)

    try:
        summary_data = await asyncio.to_thread(
            boards_service.generate_summary_internal,
            board_id,
            facilitator_id,
            workspace_id,
        )
        if summary_data:
            logger.info("Summary generated successfully for board %s", board_id)
            await manager.broadcast(
                board_id,
                "summary_generated",
                {"summary": summary_data, "board_id": board_id, "regenerated": False},
            )
        else:
            logger.warning("Summary generation returned None for board %s", board_id)
            await manager.broadcast(
                board_id,
                "summary_failed",
                {"message": "Не удалось сгенерировать итоги"},
            )
    except Exception as e:
        logger.error("Summary generation failed for board %s: %s", board_id, e)
        await manager.broadcast(
            board_id,
            "summary_failed",
            {"message": "Не удалось сгенерировать итоги"},
        )
    finally:
        logger.info("Summary generation task completed for board %s", board_id)


def _start_summary_generation(board_id: str, facilitator_id: str, workspace_id: str) -> bool:
    """Запустить генерацию итогов, если она для этой доски ещё не идёт."""
    loop = asyncio.get_running_loop()
    key = (board_id, manager.get_session_id(board_id))
    running = _summary_tasks.get(key)
    if running is not None and not running.done() and running.get_loop() is loop:
        logger.info("Summary generation already running for board %s, skipping", board_id)
        return False

    task = loop.create_task(_trigger_summary_generation(board_id, facilitator_id, workspace_id))
    _summary_tasks[key] = task

    def _forget(done: asyncio.Task) -> None:
        if _summary_tasks.get(key) is done:
            _summary_tasks.pop(key, None)

    task.add_done_callback(_forget)
    return True


def _timer_snapshot_message(timer: dict) -> dict | None:
    """Сообщение о текущем таймере для только что подключившегося клиента.

    Состояние перепроверяется: повреждённый таймер не должен обрывать подключение.
    """
    duration = number_in_range(timer.get("duration"), 0, float("inf"))
    remaining = number_in_range(timer.get("remaining"), 0, float("inf"))
    if duration is None or remaining is None:
        return None
    if timer.get("running"):
        started_ms = number_in_range(timer.get("ts"), 0, float("inf"))
        if started_ms is None:
            return None
        now_ms = time.time() * 1000
        left = max(0, remaining - (now_ms - started_ms) / 1000)
        return {
            "event": "timer_start",
            "data": {
                "duration": duration,
                "remaining": left,
                "ts": now_ms,
            },
        }
    if remaining > 0:
        return {
            "event": "timer_pause",
            "data": {"remaining": remaining, "duration": duration},
        }
    return None


async def _send(websocket: WebSocket, event: str, data: dict) -> bool:
    return await manager.send_event(websocket, event, data)


async def _broadcast_session_reset(board_id: str, had_ready: bool, had_spot: bool) -> None:
    if had_ready:
        await manager.broadcast(board_id, "ready_update", manager.ready_payload(board_id))
    if had_spot:
        await manager.broadcast(board_id, "spotlight_update", {"card_id": None})


# ── Обработчики входящих WS-событий ──────────────────────────────────────────


async def _handle_identify(ctx: _WsContext, _payload: WsBasePayload) -> None:
    # Личность задаёт сессия, а не сообщение. Событие оставлено для
    # клиентов, которые ждут в ответ состав доски и состояние сессии.
    await _send(ctx.websocket, "presence_update", manager.presence_payload(ctx.board_id))
    await _send(ctx.websocket, "facilitator_update", manager.facilitator_payload(ctx.board_id))


async def _handle_cursor_move(ctx: _WsContext, payload: WsBasePayload) -> None:
    if not isinstance(payload, CursorMoveIn):
        return
    # Подписанный курсор над формой колонки выдал бы автора карточки,
    # которая появится следом: в анонимном режиме и при скрытом сборе
    # курсоры не рассылаются вовсе.
    if manager.is_identity_hidden(ctx.board_id):
        return
    await manager.broadcast(
        ctx.board_id,
        "cursor_move",
        {
            "participant_id": ctx.peer.id,
            "username": ctx.peer.name,
            "x": payload.x,
            "y": payload.y,
        },
        exclude=ctx.websocket,
    )


async def _handle_cursor_leave(ctx: _WsContext, _payload: WsBasePayload) -> None:
    await manager.broadcast(
        ctx.board_id,
        "cursor_leave",
        {"participant_id": ctx.peer.id, "username": ctx.peer.name},
        exclude=ctx.websocket,
    )


def _group_exists_sync(
    websocket: WebSocket, board_id: str, workspace_id: str, group_id: str
) -> bool:
    db_gen = _open_ws_db(websocket)
    try:
        db = next(db_gen)
        board = db.get(models.Board, board_id)
        if (
            board is None
            or board.deleted_at is not None
            or board.workspace_id != workspace_id
        ):
            return False
        group_exists = (
            db.query(models.CardGroup.id)
            .join(models.Column, models.CardGroup.column_id == models.Column.id)
            .filter(
                models.CardGroup.id == group_id,
                models.Column.board_id == board_id,
            )
            .first()
        )
        return group_exists is not None
    finally:
        try:
            next(db_gen)
        except StopIteration:
            pass


async def _handle_group_collapse(ctx: _WsContext, payload: WsBasePayload) -> None:
    if not isinstance(payload, GroupCollapseIn):
        return
    async with manager.board_lock(ctx.board_id):
        if not _is_active_room_socket(ctx):
            return
        if not await anyio.to_thread.run_sync(
            _group_exists_sync, ctx.websocket, ctx.board_id, ctx.workspace_id, payload.group_id
        ):
            return
        changed = manager.set_group_collapsed(
            ctx.board_id, payload.group_id, payload.collapsed
        )
        if not changed:
            # Не рассылаем отклонённое (MAX_COLLAPSED_GROUPS) или избыточное состояние
            return
        state_snapshot = manager.export_state(ctx.board_id)
        await anyio.to_thread.run_sync(
            _persist_session_state,
            ctx.websocket,
            ctx.board_id,
            ctx.workspace_id,
            state_snapshot,
        )
        collapse = {"group_id": payload.group_id, "collapsed": payload.collapsed}
        # Broadcast to ALL (including sender) for sync
        await manager.broadcast(ctx.board_id, "group_collapse", collapse)


def _timer_handler(event: str) -> Callable[[_WsContext, WsBasePayload], Awaitable[None]]:
    async def _handle(ctx: _WsContext, payload: WsBasePayload) -> None:
        timer_data: dict[str, Any] | None = None
        if isinstance(payload, (TimerStartIn, TimerPauseIn, TimerResetIn)):
            timer_data = payload.sanitized()
        if timer_data is None:
            return
        async with manager.board_lock(ctx.board_id):
            if not _is_active_room_socket(ctx):
                return
            # Only facilitator can control timer when session is active
            facilitator_id = manager.get_facilitator(ctx.board_id)
            if facilitator_id and facilitator_id != ctx.peer.id:
                return
            manager.set_timer(ctx.board_id, event, timer_data)
            if event == "timer_start":
                server_timer = manager.get_timer(ctx.board_id)
                if server_timer and "ts" in server_timer:
                    timer_data = {**timer_data, "ts": server_timer["ts"]}
            state_snapshot = manager.export_state(ctx.board_id)
            await anyio.to_thread.run_sync(
                _persist_session_state,
                ctx.websocket,
                ctx.board_id,
                ctx.workspace_id,
                state_snapshot,
            )
            await manager.broadcast(ctx.board_id, event, timer_data)

    return _handle


async def _handle_facilitator_start(ctx: _WsContext, _payload: WsBasePayload) -> None:
    async with manager.board_lock(ctx.board_id):
        if not _is_active_room_socket(ctx):
            return
        if manager.get_facilitator(ctx.board_id) is not None:
            return
        # Заблокированная доска — архив: новая сессия скрыла бы её
        # карточки у всех («Штурм»). Сначала доску нужно разблокировать.
        if await anyio.to_thread.run_sync(_board_is_locked, ctx.websocket, ctx.board_id):
            return
        if manager.get_facilitator(ctx.board_id) is not None:
            return
        had_ready, had_spot = manager.set_facilitator(ctx.board_id, ctx.peer)
        session_id = manager.get_session_id(ctx.board_id)
        state_snapshot = manager.export_state(ctx.board_id)
        _board_payload, hidden = await anyio.to_thread.run_sync(
            partial(
                _sync_board_session_db,
                ctx.websocket,
                ctx.board_id,
                ctx.workspace_id,
                ctx.peer,
                "brainstorm",
                session_id,
                state_snapshot=state_snapshot,
            )
        )
        if hidden is not None:
            manager.set_identity_hidden(ctx.board_id, hidden)
        await manager.broadcast(
            ctx.board_id, "facilitator_update", manager.facilitator_payload(ctx.board_id)
        )
        await _broadcast_session_reset(ctx.board_id, had_ready, had_spot)
        # «Штурм» скрывает чужие карточки: клиенты перечитывают доску
        await manager.broadcast(ctx.board_id, "cards_visibility_changed", {})


async def _handle_facilitator_stop(ctx: _WsContext, payload: WsBasePayload) -> None:
    async with manager.board_lock(ctx.board_id):
        if not _is_active_room_socket(ctx):
            return
        if manager.get_facilitator(ctx.board_id) != ctx.peer.id:
            return
        lock_board = bool(payload.lock_board) if isinstance(payload, FacilitatorStopIn) else False
        had_ready, had_spot = manager.clear_session(ctx.board_id)
        state_snapshot = manager.export_state(ctx.board_id)
        # Завершение сессии раскрывает всё, что было скрыто в «Штурме»
        board_payload, hidden = await anyio.to_thread.run_sync(
            partial(
                _sync_board_session_db,
                ctx.websocket,
                ctx.board_id,
                ctx.workspace_id,
                None,
                None,
                None,
                lock_board=lock_board,
                reveal=True,
                state_snapshot=state_snapshot,
            )
        )
        if hidden is not None:
            manager.set_identity_hidden(ctx.board_id, hidden)
        await manager.broadcast(
            ctx.board_id, "facilitator_update", manager.facilitator_payload(ctx.board_id)
        )
        await _broadcast_session_reset(ctx.board_id, had_ready, had_spot)
        # Таймер сессии убран: без события он шёл бы до нуля у тех, кто
        # был на доске, и отсутствовал у вошедших позже
        ended_timer = manager.pop_ended_timer(ctx.board_id)
        if ended_timer:
            await manager.broadcast(ctx.board_id, "timer_reset", ended_timer)
        await manager.broadcast(ctx.board_id, "cards_visibility_changed", {})
        # Встреча закончилась — самое время спросить, была ли она полезной
        await manager.broadcast(ctx.board_id, "roti_requested", {})
        if board_payload:
            await manager.broadcast(ctx.board_id, "board_updated", board_payload)
            await manager.broadcast_workspace(
                ctx.workspace_id,
                "board_updated",
                board_payload,
                exclude_board_id=ctx.board_id,
            )


async def _handle_facilitator_transfer(ctx: _WsContext, payload: WsBasePayload) -> None:
    if not isinstance(payload, FacilitatorTransferIn):
        return
    async with manager.board_lock(ctx.board_id):
        if not _is_active_room_socket(ctx):
            return
        # Ведущий передаёт роль участнику, который сейчас на доске
        if manager.get_facilitator(ctx.board_id) != ctx.peer.id:
            return
        target = next(
            (p for p in manager.get_users(ctx.board_id) if p.id == payload.participant_id),
            None,
        )
        if target is None or target.id == ctx.peer.id:
            return
        manager.transfer_facilitator(ctx.board_id, target)
        phase = manager.get_phase(ctx.board_id)
        session_id = manager.get_session_id(ctx.board_id)
        state_snapshot = manager.export_state(ctx.board_id)
        _board_payload, hidden = await anyio.to_thread.run_sync(
            partial(
                _sync_board_session_db,
                ctx.websocket,
                ctx.board_id,
                ctx.workspace_id,
                target,
                phase,
                session_id,
                state_snapshot=state_snapshot,
            )
        )
        if hidden is not None:
            manager.set_identity_hidden(ctx.board_id, hidden)
        await manager.broadcast(
            ctx.board_id, "facilitator_update", manager.facilitator_payload(ctx.board_id)
        )


async def _handle_facilitator_takeover(ctx: _WsContext, _payload: WsBasePayload) -> None:
    async with manager.board_lock(ctx.board_id):
        if not _is_active_room_socket(ctx):
            return
        # Любой участник забирает роль, если ведущий пропал
        if not manager.can_take_over(ctx.board_id):
            return
        manager.transfer_facilitator(ctx.board_id, ctx.peer)
        phase = manager.get_phase(ctx.board_id)
        session_id = manager.get_session_id(ctx.board_id)
        state_snapshot = manager.export_state(ctx.board_id)
        _board_payload, hidden = await anyio.to_thread.run_sync(
            partial(
                _sync_board_session_db,
                ctx.websocket,
                ctx.board_id,
                ctx.workspace_id,
                ctx.peer,
                phase,
                session_id,
                state_snapshot=state_snapshot,
            )
        )
        if hidden is not None:
            manager.set_identity_hidden(ctx.board_id, hidden)
        await manager.broadcast(
            ctx.board_id, "facilitator_update", manager.facilitator_payload(ctx.board_id)
        )


async def _handle_phase_change(ctx: _WsContext, payload: WsBasePayload) -> None:
    if not isinstance(payload, PhaseChangeIn):
        return
    async with manager.board_lock(ctx.board_id):
        if not _is_active_room_socket(ctx):
            return
        if manager.get_facilitator(ctx.board_id) != ctx.peer.id:
            return
        phase = payload.phase
        previous_phase = manager.get_phase(ctx.board_id)
        had_ready, had_spot = manager.set_phase(ctx.board_id, phase)
        # Выход из «Штурма» раскрывает карточки насовсем
        leaving_brainstorm = previous_phase == "brainstorm" and phase != "brainstorm"
        session_id = manager.get_session_id(ctx.board_id)
        state_snapshot = manager.export_state(ctx.board_id)
        _board_payload, hidden = await anyio.to_thread.run_sync(
            partial(
                _sync_board_session_db,
                ctx.websocket,
                ctx.board_id,
                ctx.workspace_id,
                ctx.peer,
                phase,
                session_id,
                reveal=leaving_brainstorm,
                state_snapshot=state_snapshot,
            )
        )
        if hidden is not None:
            manager.set_identity_hidden(ctx.board_id, hidden)
        await manager.broadcast(ctx.board_id, "phase_update", {"phase": phase})
        await _broadcast_session_reset(ctx.board_id, had_ready, had_spot)
        if leaving_brainstorm or phase == "brainstorm":
            await manager.broadcast(ctx.board_id, "cards_visibility_changed", {})
        if phase == "summary":
            logger.info("Summary phase entered on board %s", ctx.board_id)
            _start_summary_generation(ctx.board_id, ctx.peer.id, ctx.workspace_id)


async def _handle_ready_toggle(ctx: _WsContext, payload: WsBasePayload) -> None:
    if not _is_active_room_socket(ctx):
        return
    ready_flag = payload.ready if isinstance(payload, ReadyToggleIn) else None
    manager.toggle_ready(ctx.board_id, ctx.peer.id, ready=ready_flag)
    await manager.broadcast(ctx.board_id, "ready_update", manager.ready_payload(ctx.board_id))


async def _handle_spotlight_card(ctx: _WsContext, payload: WsBasePayload) -> None:
    if not isinstance(payload, SpotlightCardIn):
        return
    async with manager.board_lock(ctx.board_id):
        if not _is_active_room_socket(ctx):
            return
        facilitator_id = manager.get_facilitator(ctx.board_id)
        if facilitator_id and facilitator_id != ctx.peer.id:
            return
        manager.set_spotlight(ctx.board_id, payload.card_id)
        state_snapshot = manager.export_state(ctx.board_id)
        await anyio.to_thread.run_sync(
            _persist_session_state,
            ctx.websocket,
            ctx.board_id,
            ctx.workspace_id,
            state_snapshot,
        )
        await manager.broadcast(ctx.board_id, "spotlight_update", {"card_id": payload.card_id})


async def _handle_reaction(ctx: _WsContext, payload: WsBasePayload) -> None:
    if not isinstance(payload, ReactionIn) or not payload.valid_emoji():
        return
    reaction_id = payload.id if payload.id is not None else f"{time.time():.6f}"
    await manager.broadcast(
        ctx.board_id,
        "reaction",
        {
            "id": reaction_id[:64],
            "emoji": payload.emoji,
            "username": ctx.peer.name,
            "participant_id": ctx.peer.id,
        },
    )


async def _handle_health_check_start(ctx: _WsContext, _payload: WsBasePayload) -> None:
    # Запустить health check у всех: в сессии — ведущий, вне её — любой
    if ctx.facilitator_id and not ctx.is_facilitator:
        return
    await manager.broadcast(
        ctx.board_id,
        "health_check_requested",
        {"requested_by": ctx.peer.name, "participant_id": ctx.peer.id},
    )


async def _handle_card_typing(ctx: _WsContext, payload: WsBasePayload) -> None:
    if not isinstance(payload, CardTypingIn):
        return
    if not _is_active_room_socket(ctx):
        return
    if payload.is_typing:
        column_id = payload.sanitized_column_id()
        if column_id is None:
            return
        changed = manager.set_typing(ctx.board_id, ctx.peer.id, column_id)
    else:
        changed = manager.set_typing(ctx.board_id, ctx.peer.id, None)
    if changed:
        await manager.broadcast_typing(ctx.board_id)


async def _handle_noop(_ctx: _WsContext, _payload: WsBasePayload) -> None:
    return None


_EVENT_HANDLERS: dict[str, Callable[[_WsContext, WsBasePayload], Awaitable[None]]] = {
    "identify": _handle_identify,
    "cursor_move": _handle_cursor_move,
    "cursor_leave": _handle_cursor_leave,
    "group_collapse": _handle_group_collapse,
    "timer_start": _timer_handler("timer_start"),
    "timer_pause": _timer_handler("timer_pause"),
    "timer_reset": _timer_handler("timer_reset"),
    "facilitator_start": _handle_facilitator_start,
    "facilitator_stop": _handle_facilitator_stop,
    "facilitator_transfer": _handle_facilitator_transfer,
    "facilitator_takeover": _handle_facilitator_takeover,
    "phase_change": _handle_phase_change,
    "summary_generated": _handle_noop,
    "ready_toggle": _handle_ready_toggle,
    "spotlight_card": _handle_spotlight_card,
    "reaction": _handle_reaction,
    "health_check_start": _handle_health_check_start,
    "card_typing": _handle_card_typing,
}


def _resolve_workspace_ws_sync(websocket: WebSocket, claims: dict) -> tuple[str, str]:
    db_gen = _open_ws_db(websocket)
    try:
        db = next(db_gen)
        workspace, participant = resolve_session(db, claims)
        return workspace.id, participant.id
    finally:
        try:
            next(db_gen)
        except StopIteration:
            pass


def _resolve_board_ws_sync(websocket: WebSocket, board_id: str, claims: dict) -> dict | None:
    db_gen = _open_ws_db(websocket)
    try:
        db = next(db_gen)
        workspace, participant = resolve_session(db, claims)
        workspace_id = workspace.id
        board = db.get(models.Board, board_id)
        if board is None or board.workspace_id != workspace_id or board.deleted_at is not None:
            return None
        try:
            saved_state = json.loads(board.session_state) if board.session_state else None
        except ValueError:
            saved_state = None
        return {
            "workspace_id": workspace_id,
            "peer": Peer(participant.id, participant.name),
            "identity_hidden": _identity_hidden(board),
            "saved_state": saved_state,
            "valid_groups": board_group_ids(db, board_id),
            "active_facilitator_id": board.active_facilitator_id,
            "active_facilitator": board.active_facilitator,
            "active_phase": board.active_phase,
            "active_session_id": board.active_session_id,
        }
    finally:
        try:
            next(db_gen)
        except StopIteration:
            pass


@router.websocket("/ws/workspace")
async def workspace_websocket_endpoint(
    websocket: WebSocket,
    workspace_token: str = Query(None, alias="workspace_token"),
):
    """WebSocket уровня workspace для live-обновления списка досок (напр., на /dashboard)."""
    claims = await _authenticate_ws(websocket, workspace_token)
    if not claims:
        return

    try:
        workspace_id, participant_id = await anyio.to_thread.run_sync(
            _resolve_workspace_ws_sync, websocket, claims
        )
    except HTTPException:
        await websocket.close(code=1008, reason="Session expired")
        return
    except Exception:
        logger.warning("Workspace WS handshake DB error", exc_info=True)
        await websocket.close(code=1011, reason="Server error")
        return

    if not manager.can_accept_connection(workspace_id):
        await websocket.close(code=1008, reason="Too many connections")
        return

    await manager.connect_workspace(workspace_id, websocket, participant_id)
    try:
        while True:
            # Клиент ничего, кроме ping, сюда не шлёт; ответ отличает живое соединение от зависшего
            if await websocket.receive_text() == "ping":
                await _send(websocket, "pong", {})
    except WebSocketDisconnect:
        pass
    finally:
        manager.disconnect_workspace(workspace_id, websocket)


@router.websocket("/ws/{board_id}")
async def websocket_endpoint(
    websocket: WebSocket,
    board_id: str,
    workspace_token: str = Query(None, alias="workspace_token"),
):
    claims = await _authenticate_ws(websocket, workspace_token)
    if not claims:
        return

    reject_code: int | None = None
    reject_reason = ""
    workspace_id = ""
    peer: Peer | None = None
    connected = False

    try:
        async with manager.board_lock(board_id):
            try:
                snapshot = await anyio.to_thread.run_sync(
                    _resolve_board_ws_sync, websocket, board_id, claims
                )
            except HTTPException:
                reject_code = 1008
                reject_reason = "Session expired"
                snapshot = None
            except Exception:
                logger.warning("Board WS handshake DB error for %s", board_id, exc_info=True)
                reject_code = 1011
                reject_reason = "Server error"
                snapshot = None

            if reject_code is None and snapshot is None:
                reject_code = 1008
                reject_reason = "Board not found"

            if reject_code is None and snapshot is not None:
                workspace_id = snapshot["workspace_id"]
                if not manager.can_accept_connection(workspace_id):
                    reject_code = 1008
                    reject_reason = "Too many connections"
                else:
                    peer = snapshot["peer"]
                    manager.set_identity_hidden(board_id, snapshot["identity_hidden"])
                    valid_groups = snapshot["valid_groups"]
                    manager.restore_state(
                        board_id, snapshot["saved_state"], valid_group_ids=valid_groups
                    )
                    manager.prune_collapsed_groups(board_id, valid_groups)
                    if manager.get_facilitator(board_id) is None and snapshot["active_facilitator_id"]:
                        manager.hydrate_session(
                            board_id,
                            snapshot["active_facilitator_id"],
                            snapshot["active_facilitator"],
                            snapshot["active_phase"],
                            snapshot["active_session_id"],
                        )

                    await manager.connect(board_id, websocket, workspace_id=workspace_id, peer=peer)
                    connected = True

                    # Начальное состояние: кто на доске, сессия ведущего, готовность, фокус, свёрнутые группы, таймер
                    await _send(websocket, "facilitator_update", manager.facilitator_payload(board_id))
                    if manager.get_ready_ids(board_id):
                        await _send(websocket, "ready_update", manager.ready_payload(board_id))
                    spotlight_id = manager.get_spotlight(board_id)
                    if spotlight_id:
                        await _send(websocket, "spotlight_update", {"card_id": spotlight_id})
                    collapsed_groups = manager.get_collapsed_groups(board_id)
                    if collapsed_groups:
                        await _send(websocket, "groups_collapsed", {"group_ids": collapsed_groups})
                    typing_users = manager.typing_for(board_id, peer.id)
                    if typing_users:
                        await _send(websocket, "typing_update", {"typing": typing_users})
                    timer = manager.get_timer(board_id)
                    timer_message = _timer_snapshot_message(timer) if timer else None
                    if timer_message:
                        await _send(websocket, timer_message["event"], timer_message["data"])
                    # Участник известен с момента подключения — сообщаем о нём всем сразу
                    await manager.broadcast(
                        board_id, "presence_update", manager.presence_payload(board_id)
                    )
                    if manager.get_facilitator(board_id) == peer.id:
                        # Ведущий вернулся: остальным пора убрать «ведущий не в сети»
                        await manager.broadcast(
                            board_id, "facilitator_update", manager.facilitator_payload(board_id)
                        )

        if reject_code is not None or peer is None:
            await websocket.close(code=reject_code or 1008, reason=reject_reason or "Unauthorized")
            return

        msg_timestamps: list[float] = []
        cursor_timestamps: list[float] = []

        while True:
            data = await websocket.receive_text()

            if data == "ping":
                # Ответ нужен клиенту, чтобы отличить живое соединение от зависшего
                await _send(websocket, "pong", {})
                continue
            if len(data) > MAX_WS_MESSAGE_CHARS:
                continue

            try:
                msg = json.loads(data)
                if not isinstance(msg, dict):
                    continue
                event_name = msg.get("event")
                if not isinstance(event_name, str) or event_name not in KNOWN_EVENTS:
                    continue

                # Лимит частоты считаем по имени события ДО разбора data,
                # чтобы поток некорректных кадров не обходил ограничение.
                now = time.monotonic()
                if event_name == "cursor_move":
                    cursor_timestamps = [t for t in cursor_timestamps if now - t < WS_RATE_WINDOW]
                    if len(cursor_timestamps) >= WS_CURSOR_RATE_LIMIT:
                        continue
                    cursor_timestamps.append(now)
                else:
                    msg_timestamps = [t for t in msg_timestamps if now - t < WS_RATE_WINDOW]
                    if len(msg_timestamps) >= WS_RATE_LIMIT:
                        continue
                    msg_timestamps.append(now)

                parsed = parse_ws_event(event_name, msg.get("data"))
                if parsed is None:
                    continue
                event, payload = parsed

                # Имя могли сменить через REST — берём актуальное
                peer = manager.get_peer(websocket) or peer
                facilitator_id = manager.get_facilitator(board_id)
                ctx = _WsContext(
                    websocket=websocket,
                    board_id=board_id,
                    workspace_id=workspace_id,
                    peer=peer,
                    facilitator_id=facilitator_id,
                    is_facilitator=facilitator_id == peer.id,
                )
                handler = _EVENT_HANDLERS.get(event)
                if handler is not None:
                    if websocket not in manager.rooms.get(board_id, ()):
                        break
                    await handler(ctx, payload)

            except (json.JSONDecodeError, KeyError):
                pass
            except WebSocketDisconnect:
                raise
            except Exception as exc:
                # Сбой обработки одного сообщения не должен рвать соединение:
                # фиксируем его в журнале и ждём следующее сообщение.
                record_unhandled_error("ws", type(exc).__name__)
                logger.exception(
                    "Unhandled error while handling WS message on board %s", board_id
                )

    except WebSocketDisconnect:
        pass
    finally:
        if connected:
            gone, still_present, fac_disconnected = manager.disconnect(board_id, websocket)
            # Синхронно планируем grace-таймер и чистим ready ДО любых await,
            # иначе CancelledError при отмене задачи оборвёт finally до планирования.
            if fac_disconnected and gone:
                manager.schedule_facilitator_grace(board_id, gone.id)
            if gone and not still_present:
                ready_changed = manager.remove_ready_user(board_id, gone.id)
                typing_changed = manager.set_typing(board_id, gone.id, None)
                try:
                    # Защищаем рассылку о выходе от CancelledError при отмене задачи сокета
                    # (обрыв соединения или остановка ASGI-сервера), иначе cursor_leave и
                    # presence_update обрываются на await и клиенты остаются с призраком участника.
                    with anyio.CancelScope(shield=True):
                        with anyio.move_on_after(2.0):
                            await manager.broadcast(
                                board_id,
                                "cursor_leave",
                                {"participant_id": gone.id, "username": gone.name},
                            )
                            await manager.broadcast(
                                board_id, "presence_update", manager.presence_payload(board_id)
                            )
                            if fac_disconnected:
                                # Остальные видят, что ведущий не в сети и роль можно забрать
                                await manager.broadcast(
                                    board_id,
                                    "facilitator_update",
                                    manager.facilitator_payload(board_id),
                                )
                            if ready_changed:
                                await manager.broadcast(
                                    board_id, "ready_update", manager.ready_payload(board_id)
                                )
                            if typing_changed:
                                await manager.broadcast_typing(board_id)
                except Exception:
                    pass
