import asyncio
import json
import os
import time
from collections import defaultdict

from fastapi import WebSocket


def assert_single_worker() -> None:
    """ConnectionManager держит состояние в памяти — требуется один воркер.

    Вызывать только на старте сервера (lifespan), НЕ на импорте: иначе
    ломается pytest collection / alembic / скрипты. Проверка читает
    WEB_CONCURRENCY (gunicorn/uvicorn-worker); флаг `uvicorn --workers N`
    эту переменную не выставляет и гардом не ловится — не масштабировать
    воркеры без выноса состояния в Redis.
    """
    workers = int(os.getenv("WEB_CONCURRENCY", "1"))
    if workers != 1:
        raise RuntimeError(
            f"ws_manager requires a single worker, got WEB_CONCURRENCY={workers}"
        )


class ConnectionManager:
    FACILITATOR_GRACE_SECONDS: float = 5.0

    def __init__(self):
        self.rooms: dict[str, list[WebSocket]] = defaultdict(list)
        self.workspace_rooms: dict[str, list[WebSocket]] = defaultdict(list)
        self.usernames: dict[int, str] = {}  # id(ws) → username
        self.ws_workspaces: dict[int, str] = {}  # id(ws) → workspace_id
        self.facilitators: dict[str, str] = {}  # board_id → username
        self.phases: dict[str, str] = {}  # board_id → phase
        self.timers: dict[str, dict] = {}  # board_id → timer state
        self.session_ids: dict[str, int] = {}  # board_id → session_id (timestamp)
        self.ready_users: dict[str, set[str]] = defaultdict(set)  # board_id → set[username]
        self.spotlights: dict[str, str] = {}  # board_id → card_id
        self.typing_users: dict[str, dict[str, str]] = defaultdict(dict)  # board_id → {username: column_id}
        self.facilitator_grace_tasks: dict[str, asyncio.Task] = {}
        self.on_session_cleared = None  # Optional callback(board_id)

    def reset(self) -> None:
        """Сбросить всё in-memory состояние (для изоляции тестов)."""
        for task in self.facilitator_grace_tasks.values():
            if not task.done():
                task.cancel()
        self.facilitator_grace_tasks.clear()
        self.rooms.clear()
        self.workspace_rooms.clear()
        self.usernames.clear()
        self.ws_workspaces.clear()
        self.facilitators.clear()
        self.phases.clear()
        self.timers.clear()
        self.session_ids.clear()
        self.ready_users.clear()
        self.spotlights.clear()
        self.typing_users.clear()

    async def connect(
        self, board_id: str, ws: WebSocket, workspace_id: str | None = None
    ):
        await ws.accept()
        self.rooms[board_id].append(ws)
        if workspace_id:
            self.ws_workspaces[id(ws)] = workspace_id

    async def connect_workspace(self, workspace_id: str, ws: WebSocket):
        await ws.accept()
        self.workspace_rooms[workspace_id].append(ws)
        self.ws_workspaces[id(ws)] = workspace_id

    def disconnect_workspace(self, workspace_id: str, ws: WebSocket):
        if ws in self.workspace_rooms[workspace_id]:
            self.workspace_rooms[workspace_id].remove(ws)
        if not self.workspace_rooms[workspace_id]:
            self.workspace_rooms.pop(workspace_id, None)
        self.ws_workspaces.pop(id(ws), None)

    def cancel_facilitator_grace(self, board_id: str):
        task = self.facilitator_grace_tasks.pop(board_id, None)
        if task and not task.done():
            try:
                current = asyncio.current_task()
            except RuntimeError:
                current = None
            if task is not current:
                task.cancel()

    def schedule_facilitator_grace(self, board_id: str, username: str):
        """Очистить сессию фасилитатора только если он не переподключился за grace-период."""
        self.cancel_facilitator_grace(board_id)

        async def _grace_clear():
            try:
                await asyncio.sleep(self.FACILITATOR_GRACE_SECONDS)
                if (
                    self.facilitators.get(board_id) == username
                    and username not in self.get_users(board_id)
                ):
                    self.clear_session(board_id)
                    if self.on_session_cleared:
                        try:
                            self.on_session_cleared(board_id)
                        except Exception:
                            pass
                    await self.broadcast(
                        board_id,
                        "facilitator_update",
                        {"facilitator": None, "phase": None, "session_id": None},
                    )
                    await self.broadcast(
                        board_id, "ready_update", {"ready_users": []}
                    )
                    await self.broadcast(
                        board_id, "spotlight_update", {"card_id": None}
                    )
            except asyncio.CancelledError:
                return
            finally:
                if self.facilitator_grace_tasks.get(board_id) is asyncio.current_task():
                    self.facilitator_grace_tasks.pop(board_id, None)

        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            self.clear_session(board_id)
            return
        self.facilitator_grace_tasks[board_id] = loop.create_task(_grace_clear())

    def set_username(
        self, ws: WebSocket, username: str, board_id: str | None = None
    ):
        self.usernames[id(ws)] = username
        if board_id and self.facilitators.get(board_id) == username:
            self.cancel_facilitator_grace(board_id)

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

    def disconnect(self, board_id: str, ws: WebSocket) -> tuple[str | None, bool, bool]:
        """Отключить сокет доски.

        Возвращает (username, still_present, is_facilitator_without_tabs).
        """
        if ws in self.rooms[board_id]:
            self.rooms[board_id].remove(ws)
        if not self.rooms[board_id]:
            self.rooms.pop(board_id, None)
        self.ws_workspaces.pop(id(ws), None)
        username = self.usernames.pop(id(ws), None)
        still_present = bool(username and username in self.get_users(board_id))
        fac_disconnected = bool(
            username
            and not still_present
            and self.facilitators.get(board_id) == username
        )
        return username, still_present, fac_disconnected

    def set_typing(self, board_id: str, username: str, column_id: str | None) -> bool:
        """Update active typing column for username; return True if state changed."""
        board_typing = self.typing_users[board_id]
        if column_id:
            if board_typing.get(username) == column_id:
                return False
            board_typing[username] = column_id
            return True
        if username in board_typing:
            board_typing.pop(username, None)
            return True
        return False

    def get_typing(self, board_id: str) -> list[dict[str, str]]:
        """Return list of {username, column_id} currently typing on a board."""
        return [
            {"username": uname, "column_id": col_id}
            for uname, col_id in self.typing_users.get(board_id, {}).items()
        ]

    def set_facilitator(self, board_id: str, username: str) -> tuple[bool, bool]:
        self.cancel_facilitator_grace(board_id)
        self.facilitators[board_id] = username
        self.phases[board_id] = "brainstorm"
        # Generate new session_id when facilitator starts
        self.session_ids[board_id] = int(time.time())
        had_ready = bool(self.ready_users.pop(board_id, None))
        had_spot = bool(self.spotlights.pop(board_id, None))
        return had_ready, had_spot

    def hydrate_session(
        self,
        board_id: str,
        facilitator: str | None,
        phase: str | None,
        session_id: int | None,
    ):
        """Восстановить состояние сессии из БД без генерации нового session_id."""
        if facilitator:
            self.facilitators[board_id] = facilitator
        if phase:
            self.phases[board_id] = phase
        if session_id is not None:
            self.session_ids[board_id] = session_id

    def get_facilitator(self, board_id: str) -> str | None:
        return self.facilitators.get(board_id)

    def clear_facilitator(self, board_id: str):
        self.cancel_facilitator_grace(board_id)
        self.facilitators.pop(board_id, None)
        self.phases.pop(board_id, None)

    def set_phase(self, board_id: str, phase: str) -> tuple[bool, bool]:
        self.phases[board_id] = phase
        had_ready = bool(self.ready_users.pop(board_id, None))
        had_spot = bool(self.spotlights.pop(board_id, None))
        return had_ready, had_spot

    def get_phase(self, board_id: str) -> str | None:
        return self.phases.get(board_id)

    def set_session_id(self, board_id: str, session_id: int):
        """Set session_id for a board."""
        self.session_ids[board_id] = session_id

    def get_session_id(self, board_id: str) -> int | None:
        """Get current session_id for a board."""
        return self.session_ids.get(board_id)

    def clear_session(self, board_id: str) -> tuple[bool, bool]:
        """Clear all session-related state for a board."""
        self.cancel_facilitator_grace(board_id)
        self.facilitators.pop(board_id, None)
        self.phases.pop(board_id, None)
        self.session_ids.pop(board_id, None)
        self.timers.pop(board_id, None)
        had_ready = bool(self.ready_users.pop(board_id, None))
        had_spot = bool(self.spotlights.pop(board_id, None))
        return had_ready, had_spot

    def toggle_ready(
        self, board_id: str, username: str, ready: bool | None = None
    ) -> list[str]:
        bucket = self.ready_users[board_id]
        if ready is True:
            bucket.add(username)
        elif ready is False:
            bucket.discard(username)
        elif username in bucket:
            bucket.discard(username)
        else:
            bucket.add(username)
        return sorted(bucket)

    def get_ready_users(self, board_id: str) -> list[str]:
        return sorted(self.ready_users.get(board_id, set()))

    def remove_ready_user(self, board_id: str, username: str) -> bool:
        bucket = self.ready_users.get(board_id)
        if bucket and username in bucket:
            bucket.discard(username)
            return True
        return False

    def set_spotlight(self, board_id: str, card_id: str | None):
        if card_id:
            self.spotlights[board_id] = card_id
        else:
            self.spotlights.pop(board_id, None)

    def get_spotlight(self, board_id: str) -> str | None:
        return self.spotlights.get(board_id)

    def set_timer(self, board_id: str, event: str, data: dict):
        """Store timer state so new clients can catch up."""
        now_ms = time.time() * 1000
        if event == "timer_start":
            self.timers[board_id] = {
                "running": True,
                "duration": data.get("duration", 0),
                "remaining": data.get("remaining", 0),
                # Всегда опираемся на серверное время, чтобы избежать рассинхрона часов клиента
                "ts": now_ms,
            }
        elif event == "timer_pause":
            t = self.timers.get(board_id)
            if t:
                t["running"] = False
                t["remaining"] = data.get("remaining", t["remaining"])
                t["duration"] = data.get("duration", t["duration"])
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
        message = json.dumps({"event": event, "data": data}, default=str)
        dead: list[WebSocket] = []
        for ws in list(self.rooms.get(board_id, [])):
            if ws is exclude:
                continue
            try:
                await ws.send_text(message)
            except Exception:
                dead.append(ws)
        left_users: list[str] = []
        for ws in dead:
            uname, still_present, fac_disconnected = self.disconnect(board_id, ws)
            if uname and not still_present:
                left_users.append(uname)
            if fac_disconnected and uname:
                self.schedule_facilitator_grace(board_id, uname)
        if left_users and event not in ("cursor_leave", "presence_update", "typing_update"):
            typing_changed = False
            for uname in left_users:
                if self.set_typing(board_id, uname, None):
                    typing_changed = True
                await self.broadcast(board_id, "cursor_leave", {"username": uname})
            await self.broadcast(
                board_id, "presence_update", {"users": self.get_users(board_id)}
            )
            if typing_changed:
                await self.broadcast(
                    board_id, "typing_update", {"typing": self.get_typing(board_id)}
                )

    async def broadcast_workspace(
        self,
        workspace_id: str,
        event: str,
        data: dict,
    ):
        """Разослать событие всем клиентам данного workspace (доски и дашборд)."""
        message = json.dumps({"event": event, "data": data}, default=str)

        dead_ws_sockets: list[WebSocket] = []
        for ws in list(self.workspace_rooms.get(workspace_id, [])):
            try:
                await ws.send_text(message)
            except Exception:
                dead_ws_sockets.append(ws)
        for ws in dead_ws_sockets:
            self.disconnect_workspace(workspace_id, ws)

        dead_board_sockets: list[tuple[str, WebSocket]] = []
        for b_id, sockets in list(self.rooms.items()):
            for ws in list(sockets):
                if self.ws_workspaces.get(id(ws)) != workspace_id:
                    continue
                try:
                    await ws.send_text(message)
                except Exception:
                    dead_board_sockets.append((b_id, ws))

        if dead_board_sockets:
            by_board: dict[str, list[str]] = defaultdict(list)
            for b_id, ws in dead_board_sockets:
                uname, still_present, fac_disconnected = self.disconnect(b_id, ws)
                if uname and not still_present:
                    by_board[b_id].append(uname)
                if fac_disconnected and uname:
                    self.schedule_facilitator_grace(b_id, uname)
            for b_id, users in by_board.items():
                typing_changed = False
                for uname in users:
                    if self.set_typing(b_id, uname, None):
                        typing_changed = True
                    await self.broadcast(b_id, "cursor_leave", {"username": uname})
                await self.broadcast(
                    b_id, "presence_update", {"users": self.get_users(b_id)}
                )
                if typing_changed:
                    await self.broadcast(
                        b_id, "typing_update", {"typing": self.get_typing(b_id)}
                    )


manager = ConnectionManager()
