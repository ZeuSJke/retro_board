import asyncio
import json
import logging
import time

import anyio

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query, HTTPException

from app.config import settings
from app.ws_manager import manager
from app.workspace_auth import decode_workspace_token
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
        "phase_change",
        "summary_generated",
        "ready_toggle",
        "spotlight_card",
        "reaction",
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
    facilitator: str | None,
    phase: str | None,
    session_id: int | None,
    lock_board: bool = False,
) -> dict | None:
    """Persist active session state on Board row (best-effort for unit tests without DB rows)."""
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
        board.active_facilitator = facilitator
        board.active_phase = phase
        board.active_session_id = session_id
        if lock_board:
            board.is_locked = True
        db.commit()
        if lock_board:
            return {
                "id": board.id,
                "name": board.name,
                "slug": board.slug,
                "max_votes": board.max_votes,
                "template": board.template,
                "is_locked": board.is_locked,
                "hide_cards_until_reveal": board.hide_cards_until_reveal,
                "anonymous_votes": board.anonymous_votes,
                "workspace_id": board.workspace_id,
            }
        return None
    except Exception:
        logger.debug("Skipping DB session sync for board %s", board_id, exc_info=True)
        return None
    finally:
        try:
            next(db_gen)
        except StopIteration:
            pass


def _clear_board_session_on_grace(board_id: str) -> None:
    _sync_board_session_db(None, board_id, None, None, None, None, lock_board=False)


manager.on_session_cleared = _clear_board_session_on_grace

MAX_USERNAME_LENGTH = 100
MAX_COORD_VALUE = 10000


def _origin_allowed(websocket: WebSocket) -> bool:
    origin = (websocket.headers.get("origin") or "").rstrip("/")
    if not origin:
        return False
    allowed = [o.rstrip("/") for o in settings.cors_origins_list]
    return origin in allowed


async def _authenticate_ws(
    websocket: WebSocket,
    query_token: str | None = None,
) -> str | None:
    """Validate WebSocket Origin and workspace JWT (preferring httpOnly cookie)."""
    if not _origin_allowed(websocket):
        await websocket.close(code=1008, reason="Origin not allowed")
        return None

    # Prefer httpOnly cookie so JWTs are not leaked into URLs / access logs.
    # Keep query parameter fallback for backward compatibility with older clients/tests.
    token = websocket.cookies.get("workspace_token") or query_token
    if not token:
        await websocket.close(code=1008, reason="Workspace token required")
        return None

    try:
        payload = decode_workspace_token(token)
        return payload["workspace_id"]
    except HTTPException:
        await websocket.close(code=1008, reason="Invalid or expired token")
        return None


async def _trigger_summary_generation(
    board_id: str, username: str, workspace_id: str
):
    """Trigger automatic summary generation when entering summary phase.

    This function is called when facilitator changes phase to 'summary'.
    Generation runs in a thread with its own DB session (see boards module).
    """
    from app.routers.boards import _generate_summary_internal

    logger.info("Starting summary generation for board %s by %s", board_id, username)

    try:
        summary_data = await asyncio.to_thread(
            _generate_summary_internal, board_id, username, workspace_id
        )
        if summary_data:
            logger.info("Summary generated for board %s, broadcasting", board_id)
            await manager.broadcast(
                board_id,
                "summary_generated",
                summary_data,
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


@router.websocket("/ws/workspace")
async def workspace_websocket_endpoint(
    websocket: WebSocket,
    workspace_token: str = Query(None, alias="workspace_token"),
):
    """WebSocket уровня workspace для live-обновления списка досок (напр., на /dashboard)."""
    workspace_id = await _authenticate_ws(websocket, workspace_token)
    if not workspace_id:
        return

    await manager.connect_workspace(workspace_id, websocket)
    try:
        while True:
            await websocket.receive_text()
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
    workspace_id = await _authenticate_ws(websocket, workspace_token)
    if not workspace_id:
        return

    db_gen = _open_ws_db(websocket)
    try:
        db = next(db_gen)
        # Skip DB guard only under SQLite unit tests (tests often connect to synthetic board IDs)
        dialect_name = getattr(getattr(getattr(db, "bind", None), "dialect", None), "name", None)
        board = None
        try:
            board = db.get(models.Board, board_id)
        except Exception:
            board = None
        if dialect_name != "sqlite":
            if (
                not board
                or board.workspace_id != workspace_id
                or board.deleted_at is not None
            ):
                await websocket.close(code=1008, reason="Board not found")
                return
        if (
            board is not None
            and board.deleted_at is None
            and board.workspace_id == workspace_id
            and manager.get_facilitator(board_id) is None
            and board.active_facilitator
        ):
            manager.hydrate_session(
                board_id,
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

    await manager.connect(board_id, websocket, workspace_id=workspace_id)
    msg_timestamps: list[float] = []
    cursor_timestamps: list[float] = []
    username_announced = False

    try:
        # Всегда отправляем начальное состояние сессии, даже если фасилитатор не назначен
        fac = manager.get_facilitator(board_id)
        await websocket.send_text(
            json.dumps(
                {
                    "event": "facilitator_update",
                    "data": {
                        "facilitator": fac,
                        "phase": manager.get_phase(board_id) if fac else None,
                        "session_id": manager.get_session_id(board_id) if fac else None,
                    },
                }
            )
        )
        ready_users = manager.get_ready_users(board_id)
        if ready_users:
            await websocket.send_text(
                json.dumps(
                    {
                        "event": "ready_update",
                        "data": {"ready_users": ready_users},
                    }
                )
            )
        spotlight_id = manager.get_spotlight(board_id)
        if spotlight_id:
            await websocket.send_text(
                json.dumps(
                    {
                        "event": "spotlight_update",
                        "data": {"card_id": spotlight_id},
                    }
                )
            )
        # Send current timer state to new client
        timer = manager.get_timer(board_id)
        if timer:
            if timer["running"]:
                # Recalculate remaining based on elapsed time since start
                elapsed_ms = time.time() * 1000 - timer["ts"]
                remaining = max(0, timer["remaining"] - elapsed_ms / 1000)
                await websocket.send_text(
                    json.dumps(
                        {
                            "event": "timer_start",
                            "data": {
                                "duration": timer["duration"],
                                "remaining": remaining,
                                "ts": time.time() * 1000,
                            },
                        }
                    )
                )
            elif timer["remaining"] > 0:
                await websocket.send_text(
                    json.dumps(
                        {
                            "event": "timer_pause",
                            "data": {
                                "remaining": timer["remaining"],
                                "duration": timer["duration"],
                            },
                        }
                    )
                )
        while True:
            data = await websocket.receive_text()

            if data == "ping":
                continue

            try:
                msg = json.loads(data)
                event = msg.get("event")
                payload = msg.get("data", {})

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

                # Validate cursor_move coordinates
                if event == "cursor_move":
                    x, y = payload.get("x"), payload.get("y")
                    if (
                        not isinstance(x, (int, float))
                        or not isinstance(y, (int, float))
                        or not (0 <= x <= MAX_COORD_VALUE)
                        or not (0 <= y <= MAX_COORD_VALUE)
                    ):
                        continue

                # Validate username length for identify / cursor_move
                if event in ("identify", "cursor_move"):
                    uname = payload.get("username")
                    if uname and (
                        not isinstance(uname, str) or len(uname) > MAX_USERNAME_LENGTH
                    ):
                        continue

                if event == "identify":
                    uname = payload.get("username")
                    if uname:
                        prev_uname = manager.get_username(websocket)
                        manager.set_username(websocket, uname, board_id=board_id)
                        name_changed = bool(prev_uname and prev_uname != uname)
                        if name_changed and manager.get_facilitator(board_id) == prev_uname:
                            manager.facilitators[board_id] = uname
                            _sync_board_session_db(
                                websocket,
                                board_id,
                                workspace_id,
                                uname,
                                manager.get_phase(board_id),
                                manager.get_session_id(board_id),
                            )
                            await manager.broadcast(
                                board_id,
                                "facilitator_update",
                                {
                                    "facilitator": uname,
                                    "phase": manager.get_phase(board_id),
                                    "session_id": manager.get_session_id(board_id),
                                },
                            )
                        if not username_announced or name_changed:
                            username_announced = True
                            if name_changed and prev_uname not in manager.get_users(board_id):
                                await manager.broadcast(
                                    board_id, "cursor_leave", {"username": prev_uname}
                                )
                            await manager.broadcast(
                                board_id,
                                "presence_update",
                                {"users": manager.get_users(board_id)},
                            )
                            fac = manager.get_facilitator(board_id)
                            if fac:
                                await websocket.send_text(
                                    json.dumps(
                                        {
                                            "event": "facilitator_update",
                                            "data": {
                                                "facilitator": fac,
                                                "phase": manager.get_phase(board_id),
                                                "session_id": manager.get_session_id(
                                                    board_id
                                                ),
                                            },
                                        }
                                    )
                                )

                elif event == "cursor_move":
                    username = payload.get("username")
                    if username:
                        manager.set_username(websocket, username, board_id=board_id)
                        # Broadcast presence on first cursor_move (user joined)
                        if not username_announced:
                            username_announced = True
                            await manager.broadcast(
                                board_id,
                                "presence_update",
                                {"users": manager.get_users(board_id)},
                            )
                            # Send current facilitator state to new user
                            fac = manager.get_facilitator(board_id)
                            if fac:
                                await websocket.send_text(
                                    json.dumps(
                                        {
                                            "event": "facilitator_update",
                                            "data": {
                                                "facilitator": fac,
                                                "phase": manager.get_phase(board_id),
                                                "session_id": manager.get_session_id(
                                                    board_id
                                                ),
                                            },
                                        }
                                    )
                                )
                    await manager.broadcast(
                        board_id, "cursor_move", payload, exclude=websocket
                    )

                elif event == "cursor_leave":
                    await manager.broadcast(
                        board_id, "cursor_leave", payload, exclude=websocket
                    )

                elif event == "group_collapse":
                    # Broadcast to ALL (including sender) for sync
                    await manager.broadcast(board_id, "group_collapse", payload)

                elif event in ("timer_start", "timer_pause", "timer_reset"):
                    ws_user = manager.get_username(websocket)
                    fac_user = manager.get_facilitator(board_id)
                    # Only facilitator can control timer when session is active
                    if fac_user and ws_user != fac_user:
                        continue
                    manager.set_timer(board_id, event, payload)
                    await manager.broadcast(board_id, event, payload)

                elif event == "facilitator_start":
                    username = manager.get_username(websocket)
                    if username and not manager.get_facilitator(board_id):
                        had_ready, had_spot = manager.set_facilitator(board_id, username)
                        session_id = manager.get_session_id(board_id)
                        _sync_board_session_db(
                            websocket,
                            board_id,
                            workspace_id,
                            username,
                            "brainstorm",
                            session_id,
                        )
                        await manager.broadcast(
                            board_id,
                            "facilitator_update",
                            {
                                "facilitator": username,
                                "phase": "brainstorm",
                                "session_id": session_id,
                            },
                        )
                        if had_ready:
                            await manager.broadcast(
                                board_id, "ready_update", {"ready_users": []}
                            )
                        if had_spot:
                            await manager.broadcast(
                                board_id, "spotlight_update", {"card_id": None}
                            )

                elif event == "facilitator_stop":
                    username = manager.get_username(websocket)
                    if username and manager.get_facilitator(board_id) == username:
                        lock_board = bool(
                            isinstance(payload, dict) and payload.get("lock_board")
                        )
                        had_ready, had_spot = manager.clear_session(board_id)
                        board_payload = _sync_board_session_db(
                            websocket,
                            board_id,
                            workspace_id,
                            None,
                            None,
                            None,
                            lock_board=lock_board,
                        )
                        await manager.broadcast(
                            board_id,
                            "facilitator_update",
                            {"facilitator": None, "phase": None, "session_id": None},
                        )
                        if had_ready:
                            await manager.broadcast(
                                board_id, "ready_update", {"ready_users": []}
                            )
                        if had_spot:
                            await manager.broadcast(
                                board_id, "spotlight_update", {"card_id": None}
                            )
                        if board_payload:
                            await manager.broadcast(board_id, "board_updated", board_payload)
                            await manager.broadcast_workspace(
                                workspace_id, "board_updated", board_payload
                            )

                elif event == "phase_change":
                    username = manager.get_username(websocket)
                    phase = payload.get("phase")
                    logger.info(
                        "phase_change: username=%s, facilitator=%s, phase=%s",
                        username, manager.get_facilitator(board_id), phase,
                    )
                    if (
                        username
                        and manager.get_facilitator(board_id) == username
                        and phase in VALID_PHASES
                    ):
                        had_ready, had_spot = manager.set_phase(board_id, phase)
                        _sync_board_session_db(
                            websocket,
                            board_id,
                            workspace_id,
                            username,
                            phase,
                            manager.get_session_id(board_id),
                        )
                        await manager.broadcast(
                            board_id, "phase_update", {"phase": phase}
                        )
                        if had_ready:
                            await manager.broadcast(
                                board_id, "ready_update", {"ready_users": []}
                            )
                        if had_spot:
                            await manager.broadcast(
                                board_id, "spotlight_update", {"card_id": None}
                            )
                        if phase == "summary":
                            logger.info(
                                "Creating summary task for board %s, user %s",
                                board_id, username,
                            )
                            asyncio.create_task(
                                _trigger_summary_generation(
                                    board_id, username, workspace_id
                                )
                            )

                elif event == "ready_toggle":
                    username = manager.get_username(websocket)
                    if username:
                        ready_flag = (
                            payload.get("ready")
                            if isinstance(payload, dict)
                            and isinstance(payload.get("ready"), bool)
                            else None
                        )
                        ready_users = manager.toggle_ready(
                            board_id, username, ready=ready_flag
                        )
                        await manager.broadcast(
                            board_id, "ready_update", {"ready_users": ready_users}
                        )

                elif event == "spotlight_card":
                    username = manager.get_username(websocket)
                    fac = manager.get_facilitator(board_id)
                    if not username or (fac and username != fac):
                        continue
                    card_id = (
                        payload.get("card_id") if isinstance(payload, dict) else None
                    )
                    if card_id is not None and (
                        not isinstance(card_id, str) or len(card_id) > 100
                    ):
                        continue
                    manager.set_spotlight(board_id, card_id)
                    await manager.broadcast(
                        board_id, "spotlight_update", {"card_id": card_id}
                    )

                elif event == "reaction":
                    emoji = payload.get("emoji") if isinstance(payload, dict) else None
                    if not isinstance(emoji, str) or emoji not in ALLOWED_REACTIONS:
                        continue
                    username = (
                        manager.get_username(websocket)
                        or (
                            payload.get("username")
                            if isinstance(payload, dict)
                            else None
                        )
                        or "Участник"
                    )
                    reaction_id = (
                        payload.get("id")
                        if isinstance(payload, dict) and isinstance(payload.get("id"), str)
                        else f"{time.time():.6f}"
                    )
                    await manager.broadcast(
                        board_id,
                        "reaction",
                        {
                            "id": reaction_id[:64],
                            "emoji": emoji,
                            "username": str(username)[:60],
                        },
                    )

            except (json.JSONDecodeError, KeyError):
                pass

    except WebSocketDisconnect:
        pass
    finally:
        username, still_present, fac_disconnected = manager.disconnect(
            board_id, websocket
        )
        # Синхронно планируем grace-таймер и чистим ready ДО любых await,
        # иначе CancelledError при отмене задачи оборвёт finally до планирования.
        if fac_disconnected and username:
            manager.schedule_facilitator_grace(board_id, username)
        if username and not still_present:
            ready_changed = manager.remove_ready_user(board_id, username)
            try:
                # Защищаем рассылку о выходе от CancelledError при закрытии сокета (Starlette TestClient / cancel),
                # иначе cursor_leave / presence_update обрываются на await и клиенты не получают обновление.
                with anyio.CancelScope(shield=True):
                    with anyio.move_on_after(2.0):
                        await manager.broadcast(
                            board_id, "cursor_leave", {"username": username}
                        )
                        await manager.broadcast(
                            board_id,
                            "presence_update",
                            {"users": manager.get_users(board_id)},
                        )
                        if ready_changed:
                            await manager.broadcast(
                                board_id,
                                "ready_update",
                                {"ready_users": manager.get_ready_users(board_id)},
                            )
            except Exception:
                pass
