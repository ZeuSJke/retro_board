import asyncio
import json
import logging
import os
import time
import uuid
from collections import defaultdict
from collections.abc import Callable
from dataclasses import dataclass

from fastapi import WebSocket

logger = logging.getLogger(__name__)


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


# События, меняющие данные доски. Каждое получает порядковый номер `seq`:
# клиент, увидев пропуск в номерах, понимает, что потерял событие, и
# перечитывает доску. Курсоры, набор текста и реакции в счёт не идут —
# их потеря ничего не портит.
SEQUENCED_EVENTS = frozenset(
    {
        "card_created",
        "card_updated",
        "card_moved",
        "card_deleted",
        "group_created",
        "group_updated",
        "group_moved",
        "group_deleted",
        "column_created",
        "column_updated",
        "column_deleted",
        "action_item_created",
        "action_item_updated",
        "action_item_deleted",
        "board_updated",
        "mood_updated",
        "health_updated",
        "cards_visibility_changed",
    }
)


@dataclass(frozen=True)
class Peer:
    """Участник за сокетом. Личность — `id` из сессии, `name` — только подпись."""

    id: str
    name: str


class ConnectionManager:
    # Сколько ведущий может быть не в сети, прежде чем сессия завершится сама.
    # Запас на перезагрузку страницы, смену сети и рестарт пода.
    FACILITATOR_GRACE_SECONDS: float = 90.0
    # Через сколько секунд отсутствия ведущего роль можно забрать, не дожидаясь
    # завершения сессии: фазы и таймер при этом сохраняются.
    FACILITATOR_TAKEOVER_SECONDS: float = 15.0

    def __init__(self):
        self.rooms: dict[str, list[WebSocket]] = defaultdict(list)
        self.workspace_rooms: dict[str, list[WebSocket]] = defaultdict(list)
        self.peers: dict[int, Peer] = {}  # id(ws) → участник
        self.ws_workspaces: dict[int, str] = {}  # id(ws) → workspace_id
        self.facilitators: dict[str, str] = {}  # board_id → participant_id
        self.facilitator_names: dict[str, str] = {}  # board_id → имя ведущего
        self.facilitator_offline_since: dict[str, float] = {}  # board_id → monotonic
        self.phases: dict[str, str] = {}  # board_id → phase
        self.timers: dict[str, dict] = {}  # board_id → timer state
        self.session_ids: dict[str, int] = {}  # board_id → session_id (timestamp)
        self.ready_users: dict[str, set[str]] = defaultdict(set)  # board_id → {participant_id}
        self.spotlights: dict[str, str] = {}  # board_id → card_id
        # board_id → {participant_id: column_id}
        self.typing_users: dict[str, dict[str, str]] = defaultdict(dict)
        self.names: dict[str, str] = {}  # participant_id → последнее известное имя
        self.facilitator_grace_tasks: dict[str, asyncio.Task] = {}
        self.on_session_cleared = None  # Optional callback(board_id)
        # Номера событий живут в памяти процесса; `epoch` меняется при рестарте,
        # и клиент понимает, что прежняя нумерация недействительна.
        self.epoch: str = uuid.uuid4().hex[:12]
        self.seq: dict[str, int] = defaultdict(int)  # board_id → номер последнего события
        self.restored: set[str] = set()  # доски, чьё состояние уже поднято из БД

    def reset(self) -> None:
        """Сбросить всё in-memory состояние (для изоляции тестов)."""
        for task in self.facilitator_grace_tasks.values():
            if not task.done():
                task.cancel()
        self.facilitator_grace_tasks.clear()
        self.rooms.clear()
        self.workspace_rooms.clear()
        self.peers.clear()
        self.ws_workspaces.clear()
        self.facilitators.clear()
        self.facilitator_names.clear()
        self.facilitator_offline_since.clear()
        self.phases.clear()
        self.timers.clear()
        self.session_ids.clear()
        self.ready_users.clear()
        self.spotlights.clear()
        self.typing_users.clear()
        self.names.clear()
        self.seq.clear()
        self.restored.clear()
        self.epoch = uuid.uuid4().hex[:12]

    # ── Подключения ──────────────────────────────────────────────────────────

    async def connect(
        self,
        board_id: str,
        ws: WebSocket,
        workspace_id: str | None = None,
        peer: Peer | None = None,
    ) -> bool:
        """Принять сокет доски. Возвращает True, если участник появился на доске впервые."""
        await ws.accept()
        first_socket = bool(peer) and not self.is_online(board_id, peer.id)
        self.rooms[board_id].append(ws)
        if workspace_id:
            self.ws_workspaces[id(ws)] = workspace_id
        if peer:
            self.peers[id(ws)] = peer
            self.names[peer.id] = peer.name
            if self.facilitators.get(board_id) == peer.id:
                self.cancel_facilitator_grace(board_id)
                self.facilitator_offline_since.pop(board_id, None)
                self.facilitator_names[board_id] = peer.name
        return first_socket

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

    def disconnect(self, board_id: str, ws: WebSocket) -> tuple[Peer | None, bool, bool]:
        """Отключить сокет доски.

        Возвращает (участник, остался ли он на доске в другой вкладке,
        ушёл ли со всех вкладок действующий ведущий).
        """
        if ws in self.rooms[board_id]:
            self.rooms[board_id].remove(ws)
        if not self.rooms[board_id]:
            self.rooms.pop(board_id, None)
        self.ws_workspaces.pop(id(ws), None)
        peer = self.peers.pop(id(ws), None)
        still_present = bool(peer and self.is_online(board_id, peer.id))
        fac_disconnected = bool(
            peer and not still_present and self.facilitators.get(board_id) == peer.id
        )
        if fac_disconnected:
            self.facilitator_offline_since[board_id] = time.monotonic()
        return peer, still_present, fac_disconnected

    def get_peer(self, ws: WebSocket) -> Peer | None:
        return self.peers.get(id(ws))

    def is_online(self, board_id: str, participant_id: str) -> bool:
        return any(
            (peer := self.peers.get(id(ws))) is not None and peer.id == participant_id
            for ws in self.rooms.get(board_id, [])
        )

    def get_users(self, board_id: str) -> list[Peer]:
        """Участники, подключённые к доске, без повторов, в порядке подключения."""
        seen: set[str] = set()
        result: list[Peer] = []
        for ws in self.rooms.get(board_id, []):
            peer = self.peers.get(id(ws))
            if peer and peer.id not in seen:
                seen.add(peer.id)
                result.append(peer)
        return result

    def presence_payload(self, board_id: str) -> dict:
        users = self.get_users(board_id)
        return {
            # `users` — имена для простых клиентов; тёзки различаются по `participants`
            "users": [peer.name for peer in users],
            "participants": [{"id": peer.id, "name": peer.name} for peer in users],
        }

    def name_of(self, participant_id: str) -> str:
        return self.names.get(participant_id, "Участник")

    def rename(self, participant_id: str, name: str) -> list[str]:
        """Обновить имя участника во всех его сокетах. Возвращает затронутые доски."""
        self.names[participant_id] = name
        boards: list[str] = []
        for board_id, sockets in self.rooms.items():
            touched = False
            for ws in sockets:
                peer = self.peers.get(id(ws))
                if peer and peer.id == participant_id:
                    self.peers[id(ws)] = Peer(participant_id, name)
                    touched = True
            if self.facilitators.get(board_id) == participant_id:
                self.facilitator_names[board_id] = name
                touched = True
            if touched:
                boards.append(board_id)
        return boards

    # ── Ведущий ──────────────────────────────────────────────────────────────

    def cancel_facilitator_grace(self, board_id: str):
        task = self.facilitator_grace_tasks.pop(board_id, None)
        if task and not task.done():
            try:
                current = asyncio.current_task()
            except RuntimeError:
                current = None
            if task is not current:
                task.cancel()

    def schedule_facilitator_grace(self, board_id: str, participant_id: str):
        """Завершить сессию, только если ведущий не вернулся за grace-период."""
        self.cancel_facilitator_grace(board_id)
        self.facilitator_offline_since.setdefault(board_id, time.monotonic())

        async def _grace_clear():
            try:
                await asyncio.sleep(self.FACILITATOR_GRACE_SECONDS)
                if self.facilitators.get(board_id) == participant_id and not self.is_online(
                    board_id, participant_id
                ):
                    self.clear_session(board_id)
                    if self.on_session_cleared:
                        try:
                            self.on_session_cleared(board_id)
                        except Exception:
                            # Память уже очищена; если БД не обновилась, после
                            # рестарта сессия «воскреснет» — это должно быть видно.
                            logger.warning(
                                "Failed to clear persisted session for board %s",
                                board_id,
                                exc_info=True,
                            )
                    await self.broadcast(
                        board_id, "facilitator_update", self.facilitator_payload(board_id)
                    )
                    await self.broadcast(board_id, "ready_update", self.ready_payload(board_id))
                    await self.broadcast(board_id, "spotlight_update", {"card_id": None})
                    # Сессия закончилась — видимость карточек могла измениться
                    await self.broadcast(board_id, "cards_visibility_changed", {})
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

    def set_facilitator(self, board_id: str, peer: Peer) -> tuple[bool, bool]:
        """Начать сессию: ведущий, фаза «Штурм», новый номер сессии."""
        self.cancel_facilitator_grace(board_id)
        self.facilitator_offline_since.pop(board_id, None)
        self.facilitators[board_id] = peer.id
        self.facilitator_names[board_id] = peer.name
        self.phases[board_id] = "brainstorm"
        # Номер сессии — время начала в миллисекундах: секундная точность давала
        # одинаковый номер при быстром перезапуске сессии
        self.session_ids[board_id] = int(time.time() * 1000)
        had_ready = bool(self.ready_users.pop(board_id, None))
        had_spot = bool(self.spotlights.pop(board_id, None))
        return had_ready, had_spot

    def transfer_facilitator(self, board_id: str, peer: Peer) -> None:
        """Передать роль ведущего, не трогая фазу, таймер и номер сессии."""
        self.cancel_facilitator_grace(board_id)
        self.facilitator_offline_since.pop(board_id, None)
        self.facilitators[board_id] = peer.id
        self.facilitator_names[board_id] = peer.name

    def can_take_over(self, board_id: str) -> bool:
        """Можно ли забрать роль: ведущий не в сети дольше порога."""
        facilitator_id = self.facilitators.get(board_id)
        if not facilitator_id or self.is_online(board_id, facilitator_id):
            return False
        since = self.facilitator_offline_since.get(board_id)
        return since is not None and time.monotonic() - since >= self.FACILITATOR_TAKEOVER_SECONDS

    def hydrate_session(
        self,
        board_id: str,
        facilitator_id: str | None,
        facilitator_name: str | None,
        phase: str | None,
        session_id: int | None,
    ):
        """Восстановить сессию из БД после рестарта без нового session_id.

        Если ведущий так и не подключится, сессия завершится по тому же
        grace-таймеру, что и при обычном уходе: иначе она зависла бы навсегда.
        """
        if not facilitator_id:
            return
        self.facilitators[board_id] = facilitator_id
        self.facilitator_names[board_id] = facilitator_name or "Ведущий"
        if phase:
            self.phases[board_id] = phase
        if session_id is not None:
            self.session_ids[board_id] = session_id
        if not self.is_online(board_id, facilitator_id):
            self.schedule_facilitator_grace(board_id, facilitator_id)

    def get_facilitator(self, board_id: str) -> str | None:
        """Идентификатор участника-ведущего."""
        return self.facilitators.get(board_id)

    def get_facilitator_name(self, board_id: str) -> str | None:
        if board_id not in self.facilitators:
            return None
        return self.facilitator_names.get(board_id)

    def facilitator_payload(self, board_id: str) -> dict:
        facilitator_id = self.facilitators.get(board_id)
        if not facilitator_id:
            return {
                "facilitator": None,
                "facilitator_id": None,
                "facilitator_online": False,
                "phase": None,
                "session_id": None,
            }
        return {
            "facilitator": self.facilitator_names.get(board_id),
            "facilitator_id": facilitator_id,
            "facilitator_online": self.is_online(board_id, facilitator_id),
            "phase": self.phases.get(board_id),
            "session_id": self.session_ids.get(board_id),
        }

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
        self.facilitator_names.pop(board_id, None)
        self.facilitator_offline_since.pop(board_id, None)
        self.phases.pop(board_id, None)
        self.session_ids.pop(board_id, None)
        self.timers.pop(board_id, None)
        had_ready = bool(self.ready_users.pop(board_id, None))
        had_spot = bool(self.spotlights.pop(board_id, None))
        return had_ready, had_spot

    # ── Готовность, набор текста, фокус, таймер ──────────────────────────────

    def toggle_ready(
        self, board_id: str, participant_id: str, ready: bool | None = None
    ) -> None:
        bucket = self.ready_users[board_id]
        if ready is True:
            bucket.add(participant_id)
        elif ready is False:
            bucket.discard(participant_id)
        elif participant_id in bucket:
            bucket.discard(participant_id)
        else:
            bucket.add(participant_id)

    def get_ready_ids(self, board_id: str) -> list[str]:
        return sorted(self.ready_users.get(board_id, set()))

    def ready_payload(self, board_id: str) -> dict:
        ids = self.get_ready_ids(board_id)
        return {
            "ready_users": sorted(self.name_of(pid) for pid in ids),
            "ready_ids": ids,
        }

    def remove_ready_user(self, board_id: str, participant_id: str) -> bool:
        bucket = self.ready_users.get(board_id)
        if bucket and participant_id in bucket:
            bucket.discard(participant_id)
            return True
        return False

    def set_typing(self, board_id: str, participant_id: str, column_id: str | None) -> bool:
        """Update active typing column for a participant; return True if state changed."""
        board_typing = self.typing_users[board_id]
        if column_id:
            if board_typing.get(participant_id) == column_id:
                return False
            board_typing[participant_id] = column_id
            return True
        if participant_id in board_typing:
            board_typing.pop(participant_id, None)
            return True
        return False

    def get_typing(self, board_id: str) -> list[dict[str, str]]:
        """Кто сейчас набирает карточку и в какой колонке."""
        return [
            {"participant_id": pid, "username": self.name_of(pid), "column_id": col_id}
            for pid, col_id in self.typing_users.get(board_id, {}).items()
        ]

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

    # ── Состояние, переживающее рестарт ──────────────────────────────────────

    def export_state(self, board_id: str) -> dict | None:
        """Таймер и карточка в фокусе в виде, пригодном для хранения в БД.

        Идущий таймер сохраняется моментом окончания, а не остатком: остаток
        устарел бы за время, пока под перезапускается.
        """
        state: dict = {}
        timer = self.timers.get(board_id)
        if timer:
            if timer.get("running"):
                state["timer"] = {
                    "running": True,
                    "duration": timer["duration"],
                    "ends_at_ms": timer["ts"] + timer["remaining"] * 1000,
                }
            else:
                state["timer"] = {
                    "running": False,
                    "duration": timer["duration"],
                    "remaining": timer["remaining"],
                }
        spotlight = self.spotlights.get(board_id)
        if spotlight:
            state["spotlight"] = spotlight
        return state or None

    def restore_state(self, board_id: str, state: object) -> None:
        """Поднять таймер и фокус из БД один раз за жизнь процесса.

        Данные читаются недоверчиво: повреждённая запись просто игнорируется.
        """
        if board_id in self.restored:
            return
        self.restored.add(board_id)
        if not isinstance(state, dict):
            return

        def number(value: object) -> float | None:
            if isinstance(value, bool) or not isinstance(value, (int, float)) or value < 0:
                return None
            return value

        timer = state.get("timer")
        if isinstance(timer, dict) and board_id not in self.timers:
            duration = number(timer.get("duration"))
            now_ms = time.time() * 1000
            if timer.get("running"):
                ends_at = number(timer.get("ends_at_ms"))
                if duration is not None and ends_at is not None and ends_at > now_ms:
                    self.timers[board_id] = {
                        "running": True,
                        "duration": duration,
                        "remaining": (ends_at - now_ms) / 1000,
                        "ts": now_ms,
                    }
            else:
                remaining = number(timer.get("remaining"))
                if duration is not None and remaining is not None:
                    self.timers[board_id] = {
                        "running": False,
                        "duration": duration,
                        "remaining": remaining,
                        "ts": 0,
                    }
        spotlight = state.get("spotlight")
        if isinstance(spotlight, str) and spotlight and board_id not in self.spotlights:
            self.spotlights[board_id] = spotlight

    def current_seq(self, board_id: str) -> int:
        return self.seq.get(board_id, 0)

    def _envelope(self, board_id: str, event: str) -> dict:
        """Конверт события: у событий данных — номер и поколение нумерации."""
        if event not in SEQUENCED_EVENTS:
            return {"event": event}
        self.seq[board_id] += 1
        return {"event": event, "seq": self.seq[board_id], "epoch": self.epoch}

    # ── Рассылка ─────────────────────────────────────────────────────────────

    async def broadcast(
        self,
        board_id: str,
        event: str,
        data: dict,
        exclude: WebSocket | None = None,
    ):
        message = json.dumps({**self._envelope(board_id, event), "data": data}, default=str)
        await self._send_to_room(board_id, event, lambda ws: message, exclude)

    async def broadcast_each(
        self,
        board_id: str,
        event: str,
        build: Callable[[str | None], dict | None],
        exclude: WebSocket | None = None,
    ):
        """Разослать событие, собрав данные отдельно для каждого получателя.

        `build` получает идентификатор участника за сокетом (или None) и
        возвращает данные для него; None — этому получателю ничего не слать.
        Нужно там, где разным участникам положено видеть разное: скрытые до
        раскрытия карточки, анонимные авторы.
        """
        cache: dict[str | None, str | None] = {}
        # Номер один на событие, а не на получателя: у всех клиентов общая нумерация
        envelope = self._envelope(board_id, event)

        def render(ws: WebSocket) -> str | None:
            peer = self.peers.get(id(ws))
            viewer = peer.id if peer else None
            if viewer not in cache:
                data = build(viewer)
                cache[viewer] = (
                    None if data is None else json.dumps({**envelope, "data": data}, default=str)
                )
            return cache[viewer]

        await self._send_to_room(board_id, event, render, exclude)

    async def _send_to_room(
        self,
        board_id: str,
        event: str,
        render: Callable[[WebSocket], str | None],
        exclude: WebSocket | None,
    ):
        dead: list[WebSocket] = []
        for ws in list(self.rooms.get(board_id, [])):
            if ws is exclude:
                continue
            message = render(ws)
            if message is None:
                continue
            try:
                await ws.send_text(message)
            except Exception:
                dead.append(ws)
        if dead:
            await self._drop_dead(board_id, dead, event)

    async def _drop_dead(self, board_id: str, dead: list[WebSocket], event: str = "") -> None:
        left: list[Peer] = []
        for ws in dead:
            peer, still_present, fac_disconnected = self.disconnect(board_id, ws)
            if peer and not still_present:
                left.append(peer)
            if fac_disconnected and peer:
                self.schedule_facilitator_grace(board_id, peer.id)
        if left and event not in ("cursor_leave", "presence_update", "typing_update"):
            typing_changed = False
            for peer in left:
                if self.set_typing(board_id, peer.id, None):
                    typing_changed = True
                await self.broadcast(
                    board_id, "cursor_leave", {"participant_id": peer.id, "username": peer.name}
                )
            await self.broadcast(board_id, "presence_update", self.presence_payload(board_id))
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

        dead_by_board: dict[str, list[WebSocket]] = defaultdict(list)
        for b_id, sockets in list(self.rooms.items()):
            for ws in list(sockets):
                if self.ws_workspaces.get(id(ws)) != workspace_id:
                    continue
                try:
                    await ws.send_text(message)
                except Exception:
                    dead_by_board[b_id].append(ws)

        for b_id, dead in dead_by_board.items():
            await self._drop_dead(b_id, dead)


manager = ConnectionManager()
