import json
from collections import defaultdict
from fastapi import WebSocket


class ConnectionManager:
    def __init__(self):
        self.rooms: dict[str, list[WebSocket]] = defaultdict(list)

    async def connect(self, board_id: str, ws: WebSocket):
        await ws.accept()
        self.rooms[board_id].append(ws)

    def disconnect(self, board_id: str, ws: WebSocket):
        self.rooms[board_id].remove(ws)

    async def broadcast(self, board_id: str, event: str, data: dict, exclude: WebSocket = None):
        message = json.dumps({"event": event, "data": data})
        dead = []
        for ws in self.rooms.get(board_id, []):
            if ws is exclude:
                continue
            try:
                await ws.send_text(message)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.rooms[board_id].remove(ws)


manager = ConnectionManager()
