import json
import os
import time

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query, HTTPException

from app.config import settings
from app.ws_manager import manager
from app.workspace_auth import decode_workspace_token
from app.database import get_db
from app import models

router = APIRouter()

WS_RATE_LIMIT = 20  # max messages per second
WS_RATE_WINDOW = 1.0  # seconds

VALID_PHASES = ("brainstorm", "reveal", "discuss", "vote", "summary")

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
    }
)

MAX_USERNAME_LENGTH = 100
MAX_COORD_VALUE = 10000


def _origin_allowed(websocket: WebSocket) -> bool:
    origin = (websocket.headers.get("origin") or "").rstrip("/")
    if not origin:
        return False
    allowed = [o.rstrip("/") for o in settings.cors_origins_list]
    return origin in allowed


async def _trigger_summary_generation(board_id: str, username: str):
    """Trigger automatic summary generation when entering summary phase.

    This function is called when facilitator changes phase to 'summary'.
    The actual generation happens via the API endpoint to keep WS handler simple.
    """
    from app.routers.boards import _generate_summary_internal
    from app.database import SessionLocal

    db = SessionLocal()
    try:
        summary_data = await _generate_summary_internal(db, board_id, username)
        if summary_data:
            await manager.broadcast(
                board_id,
                "summary_generated",
                summary_data,
            )
    except Exception:
        # Silently fail - summary generation is not critical
        pass
    finally:
        db.close()


@router.websocket("/ws/{board_id}")
async def websocket_endpoint(
    websocket: WebSocket,
    board_id: str,
    workspace_token: str = Query(None, alias="workspace_token"),
):
    if not _origin_allowed(websocket):
        await websocket.close(code=1008, reason="Origin not allowed")
        return

    if not workspace_token:
        await websocket.close(code=1008, reason="Workspace token required")
        return

    try:
        payload = decode_workspace_token(workspace_token)
        workspace_id = payload["workspace_id"]
    except HTTPException:
        await websocket.close(code=1008, reason="Invalid or expired token")
        return

    db_gen = get_db()
    try:
        db = next(db_gen)
        if os.getenv("TESTING") != "true":
            board = db.get(models.Board, board_id)
            if not board or board.workspace_id != workspace_id:
                await websocket.close(code=1008, reason="Board not found")
                return
    except Exception:
        await websocket.close(code=1011, reason="Server error")
        return
    finally:
        try:
            next(db_gen)
        except StopIteration:
            pass

    await manager.connect(board_id, websocket)
    msg_timestamps: list[float] = []
    username_announced = False

    try:
        # Send current facilitator/phase state immediately on connect
        fac = manager.get_facilitator(board_id)
        if fac:
            await websocket.send_text(
                json.dumps(
                    {
                        "event": "facilitator_update",
                        "data": {
                            "facilitator": fac,
                            "phase": manager.get_phase(board_id),
                            "session_id": manager.get_session_id(board_id),
                        },
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

            # Simple rate check: drop excess messages
            now = time.monotonic()
            msg_timestamps = [t for t in msg_timestamps if now - t < WS_RATE_WINDOW]
            if len(msg_timestamps) >= WS_RATE_LIMIT:
                continue
            msg_timestamps.append(now)

            try:
                msg = json.loads(data)
                event = msg.get("event")
                payload = msg.get("data", {})

                # Validate event type
                if not isinstance(event, str) or event not in KNOWN_EVENTS:
                    continue

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
                        manager.set_username(websocket, uname)
                        if not username_announced:
                            username_announced = True
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
                        manager.set_username(websocket, username)
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
                        manager.set_facilitator(board_id, username)
                        await manager.broadcast(
                            board_id,
                            "facilitator_update",
                            {
                                "facilitator": username,
                                "phase": "brainstorm",
                                "session_id": manager.get_session_id(board_id),
                            },
                        )

                elif event == "facilitator_stop":
                    username = manager.get_username(websocket)
                    if username and manager.get_facilitator(board_id) == username:
                        manager.clear_session(board_id)
                        await manager.broadcast(
                            board_id,
                            "facilitator_update",
                            {"facilitator": None, "phase": None, "session_id": None},
                        )

                elif event == "phase_change":
                    username = manager.get_username(websocket)
                    phase = payload.get("phase")
                    if (
                        username
                        and manager.get_facilitator(board_id) == username
                        and phase in VALID_PHASES
                    ):
                        manager.set_phase(board_id, phase)
                        await manager.broadcast(
                            board_id, "phase_update", {"phase": phase}
                        )
                        # Trigger auto-generation when entering summary phase
                        if phase == "summary":
                            # Run in background to not block WS
                            import asyncio

                            asyncio.create_task(
                                _trigger_summary_generation(board_id, username)
                            )

            except (json.JSONDecodeError, KeyError):
                pass

    except WebSocketDisconnect:
        username = manager.get_username(websocket)
        was_facilitator = manager.get_facilitator(board_id) == username
        manager.disconnect(board_id, websocket)
        if username:
            await manager.broadcast(board_id, "cursor_leave", {"username": username})
            await manager.broadcast(
                board_id,
                "presence_update",
                {"users": manager.get_users(board_id)},
            )
        if was_facilitator:
            await manager.broadcast(
                board_id,
                "facilitator_update",
                {"facilitator": None, "phase": None, "session_id": None},
            )
