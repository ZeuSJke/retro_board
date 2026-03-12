import json

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.ws_manager import manager

router = APIRouter()


@router.websocket("/ws/{board_id}")
async def websocket_endpoint(websocket: WebSocket, board_id: str):
    await manager.connect(board_id, websocket)
    try:
        while True:
            data = await websocket.receive_text()

            if data == "ping":
                continue

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

            except (json.JSONDecodeError, KeyError):
                pass

    except WebSocketDisconnect:
        username = manager.get_username(websocket)
        manager.disconnect(board_id, websocket)
        if username:
            await manager.broadcast(board_id, "cursor_leave", {"username": username})
