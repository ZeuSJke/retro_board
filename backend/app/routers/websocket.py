import asyncio
import json
import logging
import time

import anyio

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query, HTTPException

from app.config import settings
from app.ws_manager import Peer, manager
from app.ws_payloads import (
    MAX_ID_LENGTH,
    MAX_WS_MESSAGE_CHARS,
    clean_cursor_move,
    clean_group_collapse,
    clean_timer,
    number_in_range,
    short_str,
)
from app.workspace_auth import SESSION_COOKIE, decode_workspace_token, resolve_session
from app.database import get_db
from app import models

logger = logging.getLogger(__name__)

router = APIRouter()

WS_RATE_LIMIT = 20  # max non-cursor control messages per second
WS_CURSOR_RATE_LIMIT = 30  # max cursor_move frames per second
WS_RATE_WINDOW = 1.0  # seconds

VALID_PHASES = ("brainstorm", "reveal", "discuss", "vote", "summary")

ALLOWED_REACTIONS = frozenset({"❤️", "👍", "🔥", "🎉", "💡", "👏", "😂"})

KNOWN_EVENTS = frozenset(
    {
        "identify",
        "cursor_move",
        "cursor_leave",
        "group_collapse",
        "timer_start",
        "timer_pause",
        "timer_reset",
        "facilitator_start",
        "facilitator_stop",
        "facilitator_transfer",
        "facilitator_takeover",
        "phase_change",
        "summary_generated",
        "ready_toggle",
        "spotlight_card",
        "reaction",
        "card_typing",
        "health_check_start",
    }
)


def _open_ws_db(websocket: WebSocket):
    app = getattr(websocket, "app", None)
    overrides = getattr(app, "dependency_overrides", {}) or {}
    db_dep = overrides.get(get_db, get_db)
    return db_dep()


def _sync_board_session_db(
    websocket: WebSocket | None,
    board_id: str,
    workspace_id: str | None,
    facilitator: Peer | None,
    phase: str | None,
    session_id: int | None,
    lock_board: bool = False,
    reveal: bool = False,
) -> dict | None:
    """Сохранить состояние сессии в строке доски.

    Возвращает настройки доски, если они изменились (блокировка), иначе None.
    Доски может не быть (тесты подключаются к синтетическим идентификаторам) —
    тогда сохранять нечего. Сбой записи не должен рвать WebSocket, но обязан
    попасть в журнал: иначе память и БД расходятся незаметно.
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
            return None
        board.active_facilitator = facilitator.name if facilitator else None
        board.active_facilitator_id = facilitator.id if facilitator else None
        board.active_phase = phase
        board.active_session_id = session_id
        board.session_state = _dump_state(board_id)
        if reveal:
            board.cards_revealed = True
        if lock_board:
            board.is_locked = True
        db.commit()
        if lock_board:
            return board_settings_payload(board)
        return None
    except Exception:
        logger.warning("Failed to persist session state for board %s", board_id, exc_info=True)
        return None
    finally:
        try:
            next(db_gen)
        except StopIteration:
            pass


def _board_is_locked(websocket: WebSocket, board_id: str) -> bool:
    db_gen = _open_ws_db(websocket)
    try:
        db = next(db_gen)
        board = db.get(models.Board, board_id)
        return bool(board is not None and board.is_locked)
    except Exception:
        logger.warning("Failed to read lock state of board %s", board_id, exc_info=True)
        return False
    finally:
        try:
            next(db_gen)
        except StopIteration:
            pass


def _dump_state(board_id: str) -> str | None:
    state = manager.export_state(board_id)
    return json.dumps(state) if state else None


def _persist_session_state(websocket: WebSocket, board_id: str, workspace_id: str) -> None:
    """Сохранить таймер и фокус в строке доски, чтобы рестарт пода их не обнулил."""
    db_gen = _open_ws_db(websocket)
    try:
        db = next(db_gen)
        board = db.get(models.Board, board_id)
        if board is None or board.deleted_at is not None or board.workspace_id != workspace_id:
            return
        board.session_state = _dump_state(board_id)
        db.commit()
    except Exception:
        logger.warning("Failed to persist timer state for board %s", board_id, exc_info=True)
    finally:
        try:
            next(db_gen)
        except StopIteration:
            pass


def _clear_board_session_on_grace(board_id: str) -> None:
    _sync_board_session_db(None, board_id, None, None, None, None)


manager.on_session_cleared = _clear_board_session_on_grace

# Идущие генерации итогов по (доска, сессия): повторный переход в фазу «Итоги»
# не должен запускать вторую генерацию, пока не закончилась первая. Новая
# сессия на той же доске — другой ключ, её итоги не ждут чужую генерацию.
_summary_tasks: dict[tuple[str, int | None], asyncio.Task] = {}


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
    Generation runs in a thread with its own DB session (see boards module).
    """
    from app.routers.boards import _generate_summary_internal

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
            _generate_summary_internal, board_id, facilitator_id, workspace_id
        )
        if summary_data:
            logger.info("Summary generated for board %s, broadcasting", board_id)
            # Та же форма, что у перегенерации по кнопке (см. boards.py)
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
            "data": {"duration": duration, "remaining": left, "ts": now_ms},
        }
    if remaining > 0:
        return {
            "event": "timer_pause",
            "data": {"remaining": remaining, "duration": duration},
        }
    return None


async def _send(websocket: WebSocket, event: str, data: dict) -> None:
    await websocket.send_text(json.dumps({"event": event, "data": data}, default=str))


async def _broadcast_session_reset(board_id: str, had_ready: bool, had_spot: bool) -> None:
    if had_ready:
        await manager.broadcast(board_id, "ready_update", manager.ready_payload(board_id))
    if had_spot:
        await manager.broadcast(board_id, "spotlight_update", {"card_id": None})


@router.websocket("/ws/workspace")
async def workspace_websocket_endpoint(
    websocket: WebSocket,
    workspace_token: str = Query(None, alias="workspace_token"),
):
    """WebSocket уровня workspace для live-обновления списка досок (напр., на /dashboard)."""
    claims = await _authenticate_ws(websocket, workspace_token)
    if not claims:
        return

    db_gen = _open_ws_db(websocket)
    try:
        db = next(db_gen)
        workspace, _participant = resolve_session(db, claims)
        workspace_id = workspace.id
    except HTTPException:
        await websocket.close(code=1008, reason="Session expired")
        return
    except Exception:
        await websocket.close(code=1011, reason="Server error")
        return
    finally:
        try:
            next(db_gen)
        except StopIteration:
            pass

    await manager.connect_workspace(workspace_id, websocket)
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

    db_gen = _open_ws_db(websocket)
    try:
        db = next(db_gen)
        try:
            workspace, participant = resolve_session(db, claims)
        except HTTPException:
            await websocket.close(code=1008, reason="Session expired")
            return
        workspace_id = workspace.id
        # Личность сокета фиксируется здесь и больше не меняется сообщениями клиента
        peer = Peer(participant.id, participant.name)

        # Подключиться можно только к живой доске своей команды
        board = db.get(models.Board, board_id)
        if board is None or board.workspace_id != workspace_id or board.deleted_at is not None:
            await websocket.close(code=1008, reason="Board not found")
            return
        # Таймер и фокус поднимаются из БД один раз после рестарта процесса
        try:
            saved_state = json.loads(board.session_state) if board.session_state else None
        except ValueError:
            saved_state = None
        manager.restore_state(board_id, saved_state)
        if manager.get_facilitator(board_id) is None and board.active_facilitator_id:
            manager.hydrate_session(
                board_id,
                board.active_facilitator_id,
                board.active_facilitator,
                board.active_phase,
                board.active_session_id,
            )
    except Exception:
        await websocket.close(code=1011, reason="Server error")
        return
    finally:
        try:
            next(db_gen)
        except StopIteration:
            pass

    await manager.connect(board_id, websocket, workspace_id=workspace_id, peer=peer)
    msg_timestamps: list[float] = []
    cursor_timestamps: list[float] = []

    try:
        # Начальное состояние: кто на доске, сессия ведущего, готовность, фокус, таймер
        await _send(websocket, "facilitator_update", manager.facilitator_payload(board_id))
        if manager.get_ready_ids(board_id):
            await _send(websocket, "ready_update", manager.ready_payload(board_id))
        spotlight_id = manager.get_spotlight(board_id)
        if spotlight_id:
            await _send(websocket, "spotlight_update", {"card_id": spotlight_id})
        typing_users = manager.get_typing(board_id)
        if typing_users:
            await _send(websocket, "typing_update", {"typing": typing_users})
        timer = manager.get_timer(board_id)
        timer_message = _timer_snapshot_message(timer) if timer else None
        if timer_message:
            await websocket.send_text(json.dumps(timer_message))
        # Участник известен с момента подключения — сообщаем о нём всем сразу
        await manager.broadcast(board_id, "presence_update", manager.presence_payload(board_id))
        if manager.get_facilitator(board_id) == peer.id:
            # Ведущий вернулся: остальным пора убрать «ведущий не в сети»
            await manager.broadcast(
                board_id, "facilitator_update", manager.facilitator_payload(board_id)
            )

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
                event = msg.get("event")
                payload = msg.get("data")
                if payload is None:
                    payload = {}
                if not isinstance(payload, dict):
                    continue

                # Validate event type
                if not isinstance(event, str) or event not in KNOWN_EVENTS:
                    continue

                # Separate rate-limit buckets so cursor movement never drops session/timer commands
                now = time.monotonic()
                if event == "cursor_move":
                    cursor_timestamps = [t for t in cursor_timestamps if now - t < WS_RATE_WINDOW]
                    if len(cursor_timestamps) >= WS_CURSOR_RATE_LIMIT:
                        continue
                    cursor_timestamps.append(now)
                else:
                    msg_timestamps = [t for t in msg_timestamps if now - t < WS_RATE_WINDOW]
                    if len(msg_timestamps) >= WS_RATE_LIMIT:
                        continue
                    msg_timestamps.append(now)

                # Имя могли сменить через REST — берём актуальное
                peer = manager.get_peer(websocket) or peer
                facilitator_id = manager.get_facilitator(board_id)
                is_facilitator = facilitator_id == peer.id

                if event == "identify":
                    # Личность задаёт сессия, а не сообщение. Событие оставлено для
                    # клиентов, которые ждут в ответ состав доски и состояние сессии.
                    await _send(websocket, "presence_update", manager.presence_payload(board_id))
                    await _send(
                        websocket, "facilitator_update", manager.facilitator_payload(board_id)
                    )

                elif event == "cursor_move":
                    cursor = clean_cursor_move(payload)
                    if cursor is None:
                        continue
                    await manager.broadcast(
                        board_id,
                        "cursor_move",
                        {"participant_id": peer.id, "username": peer.name, **cursor},
                        exclude=websocket,
                    )

                elif event == "cursor_leave":
                    await manager.broadcast(
                        board_id,
                        "cursor_leave",
                        {"participant_id": peer.id, "username": peer.name},
                        exclude=websocket,
                    )

                elif event == "group_collapse":
                    collapse = clean_group_collapse(payload)
                    if collapse is None:
                        continue
                    # Broadcast to ALL (including sender) for sync
                    await manager.broadcast(board_id, "group_collapse", collapse)

                elif event in ("timer_start", "timer_pause", "timer_reset"):
                    # Only facilitator can control timer when session is active
                    if facilitator_id and not is_facilitator:
                        continue
                    timer_data = clean_timer(event, payload)
                    if timer_data is None:
                        continue
                    manager.set_timer(board_id, event, timer_data)
                    _persist_session_state(websocket, board_id, workspace_id)
                    await manager.broadcast(board_id, event, timer_data)

                elif event == "facilitator_start":
                    if facilitator_id:
                        continue
                    # Заблокированная доска — архив: новая сессия скрыла бы её
                    # карточки у всех («Штурм»). Сначала доску нужно разблокировать.
                    if _board_is_locked(websocket, board_id):
                        continue
                    had_ready, had_spot = manager.set_facilitator(board_id, peer)
                    _sync_board_session_db(
                        websocket,
                        board_id,
                        workspace_id,
                        peer,
                        "brainstorm",
                        manager.get_session_id(board_id),
                    )
                    await manager.broadcast(
                        board_id, "facilitator_update", manager.facilitator_payload(board_id)
                    )
                    await _broadcast_session_reset(board_id, had_ready, had_spot)
                    # «Штурм» скрывает чужие карточки: клиенты перечитывают доску
                    await manager.broadcast(board_id, "cards_visibility_changed", {})

                elif event == "facilitator_stop":
                    if not is_facilitator:
                        continue
                    lock_board = bool(payload.get("lock_board"))
                    had_ready, had_spot = manager.clear_session(board_id)
                    # Завершение сессии раскрывает всё, что было скрыто в «Штурме»
                    board_payload = _sync_board_session_db(
                        websocket,
                        board_id,
                        workspace_id,
                        None,
                        None,
                        None,
                        lock_board=lock_board,
                        reveal=True,
                    )
                    await manager.broadcast(
                        board_id, "facilitator_update", manager.facilitator_payload(board_id)
                    )
                    await _broadcast_session_reset(board_id, had_ready, had_spot)
                    await manager.broadcast(board_id, "cards_visibility_changed", {})
                    # Встреча закончилась — самое время спросить, была ли она полезной
                    await manager.broadcast(board_id, "roti_requested", {})
                    if board_payload:
                        await manager.broadcast(board_id, "board_updated", board_payload)
                        await manager.broadcast_workspace(
                            workspace_id, "board_updated", board_payload
                        )

                elif event == "facilitator_transfer":
                    # Ведущий передаёт роль участнику, который сейчас на доске
                    if not is_facilitator:
                        continue
                    target_id = short_str(payload.get("participant_id"), MAX_ID_LENGTH)
                    target = next(
                        (p for p in manager.get_users(board_id) if p.id == target_id), None
                    )
                    if target is None or target.id == peer.id:
                        continue
                    manager.transfer_facilitator(board_id, target)
                    _sync_board_session_db(
                        websocket,
                        board_id,
                        workspace_id,
                        target,
                        manager.get_phase(board_id),
                        manager.get_session_id(board_id),
                    )
                    await manager.broadcast(
                        board_id, "facilitator_update", manager.facilitator_payload(board_id)
                    )

                elif event == "facilitator_takeover":
                    # Любой участник забирает роль, если ведущий пропал
                    if not manager.can_take_over(board_id):
                        continue
                    manager.transfer_facilitator(board_id, peer)
                    _sync_board_session_db(
                        websocket,
                        board_id,
                        workspace_id,
                        peer,
                        manager.get_phase(board_id),
                        manager.get_session_id(board_id),
                    )
                    await manager.broadcast(
                        board_id, "facilitator_update", manager.facilitator_payload(board_id)
                    )

                elif event == "phase_change":
                    phase = payload.get("phase")
                    if not is_facilitator or phase not in VALID_PHASES:
                        continue
                    previous_phase = manager.get_phase(board_id)
                    had_ready, had_spot = manager.set_phase(board_id, phase)
                    # Выход из «Штурма» раскрывает карточки насовсем
                    leaving_brainstorm = previous_phase == "brainstorm" and phase != "brainstorm"
                    _sync_board_session_db(
                        websocket,
                        board_id,
                        workspace_id,
                        peer,
                        phase,
                        manager.get_session_id(board_id),
                        reveal=leaving_brainstorm,
                    )
                    await manager.broadcast(board_id, "phase_update", {"phase": phase})
                    await _broadcast_session_reset(board_id, had_ready, had_spot)
                    if leaving_brainstorm or phase == "brainstorm":
                        await manager.broadcast(board_id, "cards_visibility_changed", {})
                    if phase == "summary":
                        logger.info("Summary phase entered on board %s", board_id)
                        _start_summary_generation(board_id, peer.id, workspace_id)

                elif event == "ready_toggle":
                    ready_flag = (
                        payload.get("ready") if isinstance(payload.get("ready"), bool) else None
                    )
                    manager.toggle_ready(board_id, peer.id, ready=ready_flag)
                    await manager.broadcast(
                        board_id, "ready_update", manager.ready_payload(board_id)
                    )

                elif event == "spotlight_card":
                    if facilitator_id and not is_facilitator:
                        continue
                    card_id = payload.get("card_id")
                    if card_id is not None and short_str(card_id, MAX_ID_LENGTH) is None:
                        continue
                    manager.set_spotlight(board_id, card_id)
                    _persist_session_state(websocket, board_id, workspace_id)
                    await manager.broadcast(
                        board_id, "spotlight_update", {"card_id": card_id}
                    )

                elif event == "reaction":
                    emoji = payload.get("emoji")
                    if not isinstance(emoji, str) or emoji not in ALLOWED_REACTIONS:
                        continue
                    reaction_id = (
                        payload.get("id")
                        if isinstance(payload.get("id"), str)
                        else f"{time.time():.6f}"
                    )
                    await manager.broadcast(
                        board_id,
                        "reaction",
                        {
                            "id": reaction_id[:64],
                            "emoji": emoji,
                            "username": peer.name,
                            "participant_id": peer.id,
                        },
                    )

                elif event == "health_check_start":
                    # Запустить health check у всех: в сессии — ведущий, вне её — любой
                    if facilitator_id and not is_facilitator:
                        continue
                    await manager.broadcast(
                        board_id,
                        "health_check_requested",
                        {"requested_by": peer.name, "participant_id": peer.id},
                    )

                elif event == "card_typing":
                    column_id = payload.get("column_id")
                    if bool(payload.get("is_typing")):
                        if short_str(column_id, MAX_ID_LENGTH) is None:
                            continue
                        changed = manager.set_typing(board_id, peer.id, column_id)
                    else:
                        changed = manager.set_typing(board_id, peer.id, None)
                    if changed:
                        await manager.broadcast(
                            board_id,
                            "typing_update",
                            {"typing": manager.get_typing(board_id)},
                        )

            except (json.JSONDecodeError, KeyError):
                pass
            except WebSocketDisconnect:
                raise
            except Exception:
                # Сбой обработки одного сообщения не должен рвать соединение:
                # фиксируем его в журнале и ждём следующее сообщение.
                logger.exception(
                    "Unhandled error while handling WS message on board %s", board_id
                )

    except WebSocketDisconnect:
        pass
    finally:
        gone, still_present, fac_disconnected = manager.disconnect(board_id, websocket)
        # Синхронно планируем grace-таймер и чистим ready ДО любых await,
        # иначе CancelledError при отмене задачи оборвёт finally до планирования.
        if fac_disconnected and gone:
            manager.schedule_facilitator_grace(board_id, gone.id)
        if gone and not still_present:
            ready_changed = manager.remove_ready_user(board_id, gone.id)
            typing_changed = manager.set_typing(board_id, gone.id, None)
            try:
                # Защищаем рассылку о выходе от CancelledError при закрытии сокета (Starlette TestClient / cancel),
                # иначе cursor_leave / presence_update обрываются на await и клиенты не получают обновление.
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
                            await manager.broadcast(
                                board_id,
                                "typing_update",
                                {"typing": manager.get_typing(board_id)},
                            )
            except Exception:
                pass
