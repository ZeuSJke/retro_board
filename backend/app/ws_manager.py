import json
import time
from collections import defaultdict

from fastapi import WebSocket


class ConnectionManager:
    def __init__(self):
        self.rooms: dict[str, list[WebSocket]] = defaultdict(list)
        self.usernames: dict[int, str] = {}  # id(ws) → username
        self.facilitators: dict[str, str] = {}  # board_id → username
        self.phases: dict[str, str] = {}  # board_id → phase
        self.timers: dict[str, dict] = {}  # board_id → timer state
        self.session_ids: dict[str, int] = {}  # board_id → session_id (timestamp)

    async def connect(self, board_id: str, ws: WebSocket):
        await ws.accept()
        self.rooms[board_id].append(ws)

    def set_username(self, ws: WebSocket, username: str):
        self.usernames[id(ws)] = username

    def get_username(self, ws: WebSocket) -> str | None:
        return self.usernames.get(id(ws))

    def get_users(self, board_id: str) -> list[str]:
        """Return unique usernames currently connected to a board."""
        seen: set[str] = set()
        result: list[str] = []
        for ws in self.rooms.get(board_id, []):
            name = self.usernames.get(id(ws))
            if name and name not in seen:
                seen.add(name)
                result.append(name)
        return result

    def disconnect(self, board_id: str, ws: WebSocket):
        if ws in self.rooms[board_id]:
            self.rooms[board_id].remove(ws)
        username = self.usernames.pop(id(ws), None)
        # If facilitator disconnects, clear facilitator state and session
        if username and self.facilitators.get(board_id) == username:
            self.clear_session(board_id)

    def set_facilitator(self, board_id: str, username: str):
        self.facilitators[board_id] = username
        self.phases[board_id] = "brainstorm"
        # Generate new session_id when facilitator starts
        self.session_ids[board_id] = int(time.time())

    def get_facilitator(self, board_id: str) -> str | None:
        return self.facilitators.get(board_id)

    def clear_facilitator(self, board_id: str):
        self.facilitators.pop(board_id, None)
        self.phases.pop(board_id, None)

    def set_phase(self, board_id: str, phase: str):
        self.phases[board_id] = phase

    def get_phase(self, board_id: str) -> str | None:
        return self.phases.get(board_id)

    def set_session_id(self, board_id: str, session_id: int):
        """Set session_id for a board."""
        self.session_ids[board_id] = session_id

    def get_session_id(self, board_id: str) -> int | None:
        """Get current session_id for a board."""
        return self.session_ids.get(board_id)

    def clear_session(self, board_id: str):
        """Clear all session-related state for a board."""
        self.facilitators.pop(board_id, None)
        self.phases.pop(board_id, None)
        self.session_ids.pop(board_id, None)
        self.timers.pop(board_id, None)

    def set_timer(self, board_id: str, event: str, data: dict):
        """Store timer state so new clients can catch up."""
        if event == "timer_start":
            self.timers[board_id] = {
                "running": True,
                "duration": data.get("duration", 0),
                "remaining": data.get("remaining", 0),
                "ts": data.get("ts", time.time() * 1000),
            }
        elif event == "timer_pause":
            t = self.timers.get(board_id)
            if t:
                t["running"] = False
                t["remaining"] = data.get("remaining", t["remaining"])
        elif event == "timer_reset":
            dur = data.get("duration", 0)
            self.timers[board_id] = {
                "running": False,
                "duration": dur,
                "remaining": dur,
                "ts": 0,
            }

    def get_timer(self, board_id: str) -> dict | None:
        return self.timers.get(board_id)

    async def broadcast(
        self,
        board_id: str,
        event: str,
        data: dict,
        exclude: WebSocket | None = None,
    ):
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
            self.usernames.pop(id(ws), None)


manager = ConnectionManager()
