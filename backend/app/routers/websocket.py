import json
import time

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.config import settings
from app.ws_manager import manager

router = APIRouter()

WS_RATE_LIMIT = 20  # max messages per second
WS_RATE_WINDOW = 1.0  # seconds

VALID_PHASES = ("brainstorm", "reveal", "discuss", "vote")


def _origin_allowed(websocket: WebSocket) -> bool:
    origin = (websocket.headers.get("origin") or "").rstrip("/")
    if not origin:
        return True  # non-browser clients (curl, etc.)
    allowed = [o.rstrip("/") for o in settings.cors_origins_list]
    return origin in allowed


@router.websocket("/ws/{board_id}")
async def websocket_endpoint(websocket: WebSocket, board_id: str):
    if not _origin_allowed(websocket):
        await websocket.close(code=1008, reason="Origin not allowed")
        return
    await manager.connect(board_id, websocket)
    msg_timestamps: list[float] = []
    username_announced = False

    try:
        # Send current facilitator/phase state immediately on connect
        fac = manager.get_facilitator(board_id)
        if fac:
            await websocket.send_text(
                json.dumps({
                    "event": "facilitator_update",
                    "data": {
                        "facilitator": fac,
                        "phase": manager.get_phase(board_id),
                    },
                })
            )
        # Send current timer state to new client
        timer = manager.get_timer(board_id)
        if timer:
            if timer["running"]:
                # Recalculate remaining based on elapsed time since start
                elapsed_ms = time.time() * 1000 - timer["ts"]
                remaining = max(0, timer["remaining"] - elapsed_ms / 1000)
                await websocket.send_text(
                    json.dumps({
                        "event": "timer_start",
                        "data": {
                            "duration": timer["duration"],
                            "remaining": remaining,
                            "ts": time.time() * 1000,
                        },
                    })
                )
            elif timer["remaining"] > 0:
                await websocket.send_text(
                    json.dumps({
                        "event": "timer_pause",
                        "data": {
                            "remaining": timer["remaining"],
                            "duration": timer["duration"],
                        },
                    })
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

                if event == "cursor_move":
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
                                    json.dumps({
                                        "event": "facilitator_update",
                                        "data": {
                                            "facilitator": fac,
                                            "phase": manager.get_phase(board_id),
                                        },
                                    })
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
                            {"facilitator": username, "phase": "brainstorm"},
                        )

                elif event == "facilitator_stop":
                    username = manager.get_username(websocket)
                    if username and manager.get_facilitator(board_id) == username:
                        manager.clear_facilitator(board_id)
                        await manager.broadcast(
                            board_id,
                            "facilitator_update",
                            {"facilitator": None, "phase": None},
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
                {"facilitator": None, "phase": None},
            )
