import json
import time

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.ws_manager import manager

router = APIRouter()

WS_RATE_LIMIT = 20  # max messages per second
WS_RATE_WINDOW = 1.0  # seconds


@router.websocket("/ws/{board_id}")
async def websocket_endpoint(websocket: WebSocket, board_id: str):
    await manager.connect(board_id, websocket)
    msg_timestamps: list[float] = []
    try:
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
                    # Broadcast to ALL (including sender) for sync confirmation
                    await manager.broadcast(board_id, event, payload)

            except (json.JSONDecodeError, KeyError):
                pass

    except WebSocketDisconnect:
        username = manager.get_username(websocket)
        manager.disconnect(board_id, websocket)
        if username:
            await manager.broadcast(board_id, "cursor_leave", {"username": username})
