import asyncio
import json
import logging
import os
import time
import uuid
from collections import defaultdict
from collections.abc import Callable, Iterable
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
        "participant_renamed",
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
    # Буфер исходящих сообщений на один сокет и таймаут отправки, чтобы медленный
    # клиент не задерживал рассылку здоровым участникам комнаты.
    MAX_SOCKET_QUEUE: int = 128
    SEND_TIMEOUT_SECONDS: float = 5.0
    MAX_COLLAPSED_GROUPS: int = 200
    MAX_WS_CONNECTIONS_GLOBAL: int = 2000
    MAX_WS_CONNECTIONS_PER_WORKSPACE: int = 200
    MAX_NAMES_CACHE: int = 5000
    # Не 1008 (policy violation): при переполнении или таймауте клиент должен
    # автоматически переподключиться и пересинхронизироваться по снимку.
    SLOW_CONSUMER_CLOSE_CODE: int = 4008

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
        self.collapsed_groups: dict[str, set[str]] = defaultdict(set)  # board_id → {group_id}
        # board_id → {participant_id: column_id}
        self.typing_users: dict[str, dict[str, str]] = defaultdict(dict)
        self.names: dict[str, str] = {}  # participant_id → последнее известное имя
        self.facilitator_grace_tasks: dict[str, asyncio.Task] = {}
        self.on_session_cleared = None  # Optional callback(board_id)
        self.on_slow_consumer_drop: Callable[[], None] | None = None
        self._queues: dict[int, asyncio.Queue[str]] = {}
        self._writers: dict[int, asyncio.Task[None]] = {}
        self._close_tasks: set[asyncio.Task[None]] = set()
        # Номера событий живут в памяти процесса; `epoch` меняется при рестарте,
        # и клиент понимает, что прежняя нумерация недействительна.
        self.epoch: str = uuid.uuid4().hex[:12]
        self.seq: dict[str, int] = defaultdict(int)  # board_id → номер последнего события
        self.restored: set[str] = set()  # доски, чьё состояние уже поднято из БД
        # Скрывать ли на доске, кто именно печатает (анонимный режим, скрытый сбор).
        # Нет записи — считаем, что скрывать: ошибка в эту сторону безвредна.
        self.identity_hidden: dict[str, bool] = {}
        self.ended_timers: dict[str, float] = {}  # длительность таймера завершённой сессии
        self.workspace_peers: dict[int, str] = {}  # id(ws) сокета команды → участник
        # Сериализация мутаций сессии/таймера/фокуса на уровне доски (ключ — board_id)
        self._board_locks: dict[str, tuple[asyncio.AbstractEventLoop, asyncio.Lock]] = {}

    def board_lock(self, board_id: str) -> asyncio.Lock:
        """Вернуть per-board asyncio.Lock (пересоздаётся при смене event loop)."""
        loop = asyncio.get_running_loop()
        entry = self._board_locks.get(board_id)
        if entry is None or entry[0] is not loop:
            lock = asyncio.Lock()
            self._board_locks[board_id] = (loop, lock)
            return lock
        return entry[1]

    def reset(self) -> None:
        """Сбросить всё in-memory состояние (для изоляции тестов)."""
        for task in self.facilitator_grace_tasks.values():
            if not task.done():
                task.cancel()
        self.facilitator_grace_tasks.clear()
        for writer in list(self._writers.values()):
            if not writer.done():
                writer.cancel()
        self._writers.clear()
        self._queues.clear()
        for close_task in list(self._close_tasks):
            if not close_task.done():
                close_task.cancel()
        self._close_tasks.clear()
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
        self.collapsed_groups.clear()
        self.typing_users.clear()
        self.names.clear()
        self.seq.clear()
        self.restored.clear()
        self.identity_hidden.clear()
        self.ended_timers.clear()
        self.workspace_peers.clear()
        self._board_locks.clear()
        self.epoch = uuid.uuid4().hex[:12]

    # ── Исходящие очереди сокетов ────────────────────────────────────────────

    def _start_writer(
        self,
        ws: WebSocket,
        *,
        board_id: str | None,
        workspace_id: str | None,
    ) -> None:
        self._stop_writer(ws)
        queue: asyncio.Queue[str] = asyncio.Queue(maxsize=self.MAX_SOCKET_QUEUE)
        self._queues[id(ws)] = queue
        self._writers[id(ws)] = asyncio.create_task(
            self._socket_writer(ws, queue, board_id=board_id, workspace_id=workspace_id)
        )

    def _stop_writer(self, ws: WebSocket) -> None:
        self._queues.pop(id(ws), None)
        writer = self._writers.pop(id(ws), None)
        if writer is not None and not writer.done():
            try:
                current = asyncio.current_task()
            except RuntimeError:
                current = None
            if writer is not current:
                writer.cancel()

    def _schedule_close(
        self,
        ws: WebSocket,
        code: int = 4008,
        reason: str = "Slow consumer",
    ) -> None:
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            return

        async def _do_close() -> None:
            try:
                await asyncio.wait_for(ws.close(code=code, reason=reason), timeout=2.0)
            except Exception:
                logger.debug("Close slow socket skipped/failed", exc_info=True)

        task = loop.create_task(_do_close())
        self._close_tasks.add(task)
        task.add_done_callback(self._close_tasks.discard)

    async def _handle_failed_socket(
        self,
        ws: WebSocket,
        *,
        board_id: str | None,
        workspace_id: str | None,
    ) -> None:
        if board_id is not None:
            if ws in self.rooms.get(board_id, []):
                await self._drop_dead(board_id, [ws])
            else:
                self._stop_writer(ws)
        elif workspace_id is not None:
            self.disconnect_workspace(workspace_id, ws)
        else:
            self._stop_writer(ws)

    async def _socket_writer(
        self,
        ws: WebSocket,
        queue: asyncio.Queue[str],
        *,
        board_id: str | None,
        workspace_id: str | None,
    ) -> None:
        try:
            while True:
                message = await queue.get()
                try:
                    await asyncio.wait_for(
                        ws.send_text(message),
                        timeout=self.SEND_TIMEOUT_SECONDS,
                    )
                except TimeoutError:
                    logger.warning(
                        "Dropping slow WebSocket consumer after %.1fs send timeout",
                        self.SEND_TIMEOUT_SECONDS,
                    )
                    if self.on_slow_consumer_drop is not None:
                        self.on_slow_consumer_drop()
                    self._schedule_close(
                        ws, code=self.SLOW_CONSUMER_CLOSE_CODE, reason="Slow consumer"
                    )
                    await self._handle_failed_socket(
                        ws, board_id=board_id, workspace_id=workspace_id
                    )
                    return
                except Exception:
                    await self._handle_failed_socket(
                        ws, board_id=board_id, workspace_id=workspace_id
                    )
                    return
                finally:
                    queue.task_done()
        except asyncio.CancelledError:
            return

    async def _send_raw(self, ws: WebSocket, message: str) -> bool:
        queue = self._queues.get(id(ws))
        if queue is None:
            return False
        try:
            # Ждём освобождения слота с таймаутом, чтобы кратковременный всплеск
            # (например, bulk-операция > MAX_SOCKET_QUEUE) давал writer-задаче шанс разгрузить очередь.
            await asyncio.wait_for(queue.put(message), timeout=self.SEND_TIMEOUT_SECONDS)
            return True
        except TimeoutError:
            if self._queues.get(id(ws)) is not queue:
                return False
            logger.warning(
                "Dropping slow WebSocket consumer (outgoing queue limit=%d stalled for %.1fs)",
                queue.maxsize,
                self.SEND_TIMEOUT_SECONDS,
            )
            if self.on_slow_consumer_drop is not None:
                self.on_slow_consumer_drop()
            self._stop_writer(ws)
            self._schedule_close(
                ws, code=self.SLOW_CONSUMER_CLOSE_CODE, reason="Slow consumer"
            )
            return False

    async def send_event(self, ws: WebSocket, event: str, data: dict) -> bool:
        return await self._send_raw(
            ws, json.dumps({"event": event, "data": data}, default=str)
        )

    # ── Подключения ──────────────────────────────────────────────────────────

    def can_accept_connection(self, workspace_id: str | None = None) -> bool:
        """Проверить глобальный и командный лимиты числа WS-подключений."""
        board_sockets, workspace_sockets = self.connection_counts()
        if board_sockets + workspace_sockets >= self.MAX_WS_CONNECTIONS_GLOBAL:
            return False
        if workspace_id is not None:
            ws_count = sum(1 for wid in self.ws_workspaces.values() if wid == workspace_id)
            if ws_count >= self.MAX_WS_CONNECTIONS_PER_WORKSPACE:
                return False
        return True

    def _remember_name(self, participant_id: str, name: str) -> None:
        self.names.pop(participant_id, None)
        self.names[participant_id] = name
        while len(self.names) > self.MAX_NAMES_CACHE:
            oldest = next(iter(self.names))
            del self.names[oldest]

    def _maybe_prune_name(self, participant_id: str) -> None:
        if any(p.id == participant_id for p in self.peers.values()):
            return
        if any(pid == participant_id for pid in self.workspace_peers.values()):
            return
        if any(fid == participant_id for fid in self.facilitators.values()):
            return
        if any(participant_id in ready for ready in self.ready_users.values()):
            return
        self.names.pop(participant_id, None)

    async def connect(
        self,
        board_id: str,
        ws: WebSocket,
        workspace_id: str | None = None,
        peer: Peer | None = None,
    ) -> bool:
        """Принять сокет доски. Возвращает True, если участник появился на доске впервые."""
        await ws.accept()
        first_socket = peer is not None and not self.is_online(board_id, peer.id)
        self.rooms[board_id].append(ws)
        self._start_writer(ws, board_id=board_id, workspace_id=workspace_id)
        if workspace_id:
            self.ws_workspaces[id(ws)] = workspace_id
        if peer:
            self.peers[id(ws)] = peer
            self._remember_name(peer.id, peer.name)
            if self.facilitators.get(board_id) == peer.id:
                self.cancel_facilitator_grace(board_id)
                self.facilitator_offline_since.pop(board_id, None)
                self.facilitator_names[board_id] = peer.name
        return first_socket

    async def connect_workspace(
        self, workspace_id: str, ws: WebSocket, participant_id: str | None = None
    ):
        await ws.accept()
        self.workspace_rooms[workspace_id].append(ws)
        self._start_writer(ws, board_id=None, workspace_id=workspace_id)
        self.ws_workspaces[id(ws)] = workspace_id
        if participant_id:
            self.workspace_peers[id(ws)] = participant_id

    def disconnect_workspace(self, workspace_id: str, ws: WebSocket):
        self._stop_writer(ws)
        if ws in self.workspace_rooms[workspace_id]:
            self.workspace_rooms[workspace_id].remove(ws)
        if not self.workspace_rooms[workspace_id]:
            self.workspace_rooms.pop(workspace_id, None)
        self.ws_workspaces.pop(id(ws), None)
        pid = self.workspace_peers.pop(id(ws), None)
        if pid:
            self._maybe_prune_name(pid)

    def disconnect(self, board_id: str, ws: WebSocket) -> tuple[Peer | None, bool, bool]:
        """Отключить сокет доски.

        Возвращает (участник, остался ли он на доске в другой вкладке,
        ушёл ли со всех вкладок действующий ведущий).
        """
        self._stop_writer(ws)
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
        if peer and not still_present and not fac_disconnected:
            self._maybe_prune_name(peer.id)
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

    async def disconnect_participant(self, participant_id: str) -> None:
        """Закрыть все сокеты участника (выход из команды).

        Обычную уборку — присутствие, готовность, роль ведущего — делает
        обработчик разрыва в самом эндпоинте.
        """
        sockets = [
            ws
            for room in self.rooms.values()
            for ws in room
            if (peer := self.peers.get(id(ws))) is not None and peer.id == participant_id
        ]
        sockets += [
            ws
            for room in self.workspace_rooms.values()
            for ws in room
            if self.workspace_peers.get(id(ws)) == participant_id
        ]
        await self._close_all(sockets, "Session ended")

    async def disconnect_workspace_sessions(self, workspace_id: str) -> None:
        """Закрыть все сокеты команды — досок и списка досок (сменили ключ доступа).

        Сессия проверяется только при подключении, поэтому без этого участник с
        отозванной сессией продолжал бы получать события и управлять сессией ведущего.
        """
        sockets = list(self.workspace_rooms.get(workspace_id, []))
        sockets += [
            ws
            for room in self.rooms.values()
            for ws in room
            if self.ws_workspaces.get(id(ws)) == workspace_id
        ]
        await self._close_all(sockets, "Access revoked")

    async def _close_all(self, sockets: list[WebSocket], reason: str) -> None:
        for ws in sockets:
            self._stop_writer(ws)
        if not sockets:
            return

        async def _close_one(ws: WebSocket) -> None:
            try:
                await asyncio.wait_for(ws.close(code=1008, reason=reason), timeout=2.0)
            except Exception:
                logger.debug("Socket is already closed")

        await asyncio.gather(*(_close_one(ws) for ws in sockets), return_exceptions=True)

    async def cleanup_board(self, board_id: str) -> None:
        """Освободить всё in-memory состояние доски и закрыть её сокеты при удалении."""
        async with self.board_lock(board_id):
            self.cancel_facilitator_grace(board_id)
            sockets = list(self.rooms.pop(board_id, ()))
            removed_peers: list[str] = []
            for ws in sockets:
                self.ws_workspaces.pop(id(ws), None)
                peer = self.peers.pop(id(ws), None)
                if peer:
                    removed_peers.append(peer.id)
            self.facilitators.pop(board_id, None)
            self.facilitator_names.pop(board_id, None)
            self.facilitator_offline_since.pop(board_id, None)
            self.phases.pop(board_id, None)
            self.session_ids.pop(board_id, None)
            self.ready_users.pop(board_id, None)
            self.typing_users.pop(board_id, None)
            self.spotlights.pop(board_id, None)
            self.timers.pop(board_id, None)
            self.ended_timers.pop(board_id, None)
            self.collapsed_groups.pop(board_id, None)
            self.identity_hidden.pop(board_id, None)
            self.restored.discard(board_id)
            self.seq.pop(board_id, None)
            for pid in removed_peers:
                self._maybe_prune_name(pid)
            self._board_locks.pop(board_id, None)
        await self._close_all(sockets, "Board deleted")

    def name_of(self, participant_id: str) -> str:
        return self.names.get(participant_id, "Участник")

    def rename(self, participant_id: str, name: str) -> list[str]:
        """Обновить имя участника во всех его сокетах. Возвращает затронутые доски."""
        self._remember_name(participant_id, name)
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
                async with self.board_lock(board_id):
                    if self.facilitators.get(board_id) == participant_id and not self.is_online(
                        board_id, participant_id
                    ):
                        self.clear_session(board_id)
                        state_snapshot = self.export_state(board_id)
                        if self.on_session_cleared:
                            try:
                                cleared_res = await asyncio.to_thread(
                                    self.on_session_cleared, board_id, state_snapshot
                                )
                                if isinstance(cleared_res, bool):
                                    self.set_identity_hidden(board_id, cleared_res)
                            except TypeError:
                                # Поддержка пользовательского callback(board_id) с одним аргументом
                                try:
                                    await asyncio.to_thread(self.on_session_cleared, board_id)
                                except Exception:
                                    logger.warning(
                                        "Failed to clear persisted session for board %s",
                                        board_id,
                                        exc_info=True,
                                    )
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
                        ended_timer = self.pop_ended_timer(board_id)
                        if ended_timer:
                            await self.broadcast(board_id, "timer_reset", ended_timer)
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
        """Clear all session-related state for a board.

        Таймер убирается вместе с сессией; его длительность остаётся в
        `ended_timers`, чтобы вызывающий код разослал сброс (см. `pop_ended_timer`).
        """
        timer = self.timers.get(board_id)
        if timer:
            self.ended_timers[board_id] = timer.get("duration", 0)
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

    def set_identity_hidden(self, board_id: str, hidden: bool) -> None:
        self.identity_hidden[board_id] = hidden

    def is_identity_hidden(self, board_id: str) -> bool:
        """Нельзя ли показывать, кто что делает на доске. Нет записи — нельзя."""
        return self.identity_hidden.get(board_id, True)

    def typing_for(self, board_id: str, viewer_id: str | None) -> list[dict[str, str]]:
        """Список печатающих для конкретного получателя.

        В анонимном режиме и при скрытом сборе по индикатору нельзя понять, чья
        карточка появится следом: чужие записи приходят без имени и идентификатора.
        """
        entries = self.get_typing(board_id)
        if not self.is_identity_hidden(board_id):
            return entries
        masked: list[dict[str, str]] = []
        for entry in entries:
            if entry["participant_id"] == viewer_id:
                masked.append(entry)
            else:
                masked.append(
                    {
                        "participant_id": f"anon-{len(masked)}",
                        "username": "",
                        "column_id": entry["column_id"],
                    }
                )
        return masked

    async def broadcast_typing(self, board_id: str) -> None:
        await self.broadcast_each(
            board_id,
            "typing_update",
            lambda viewer_id: {"typing": self.typing_for(board_id, viewer_id)},
        )

    def set_spotlight(self, board_id: str, card_id: str | None):
        if card_id:
            self.spotlights[board_id] = card_id
        else:
            self.spotlights.pop(board_id, None)

    def get_spotlight(self, board_id: str) -> str | None:
        return self.spotlights.get(board_id)

    def set_group_collapsed(self, board_id: str, group_id: str, collapsed: bool) -> bool:
        """Обновить состояние сворачивания группы; возвращает True, если оно изменилось."""
        if collapsed:
            bucket = self.collapsed_groups[board_id]
            if group_id in bucket or len(bucket) >= self.MAX_COLLAPSED_GROUPS:
                return False
            bucket.add(group_id)
            return True
        existing = self.collapsed_groups.get(board_id)
        if not existing or group_id not in existing:
            return False
        existing.discard(group_id)
        if not existing:
            self.collapsed_groups.pop(board_id, None)
        return True

    def get_collapsed_groups(self, board_id: str) -> list[str]:
        return sorted(self.collapsed_groups.get(board_id, ()))

    def remove_collapsed_groups(self, board_id: str, group_ids: Iterable[str]) -> bool:
        existing = self.collapsed_groups.get(board_id)
        if not existing:
            return False
        before = len(existing)
        existing.difference_update(group_ids)
        if not existing:
            self.collapsed_groups.pop(board_id, None)
        return len(existing) != before

    def remove_collapsed_group(self, board_id: str, group_id: str) -> None:
        self.remove_collapsed_groups(board_id, (group_id,))

    def prune_collapsed_groups(self, board_id: str, valid_group_ids: set[str]) -> bool:
        bucket = self.collapsed_groups.get(board_id)
        if not bucket:
            return False
        filtered = bucket & valid_group_ids
        if len(filtered) == len(bucket):
            return False
        if filtered:
            self.collapsed_groups[board_id] = filtered
        else:
            self.collapsed_groups.pop(board_id, None)
        return True

    def set_timer(self, board_id: str, event: str, data: dict) -> None:
        """Store timer state so new clients can catch up."""
        now_ms = time.time() * 1000
        if event == "timer_start":
            duration = data.get("duration", 0)
            remaining = data.get("remaining", 0)
            self.timers[board_id] = {
                "running": True,
                "duration": duration,
                "remaining": remaining,
                # Отметку ставит сервер, а не клиент (часы у участников могут расходиться)
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

    def pop_ended_timer(self, board_id: str) -> dict | None:
        """Данные события timer_reset для таймера, убранного вместе с сессией."""
        if board_id not in self.ended_timers:
            return None
        return {"duration": self.ended_timers.pop(board_id)}

    # ── Состояние, переживающее рестарт ──────────────────────────────────────

    def export_state(
        self, board_id: str, valid_group_ids: set[str] | None = None
    ) -> dict | None:
        """Таймер, фокус и свёрнутые группы в виде, пригодном для хранения в БД.

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
        if valid_group_ids is not None:
            self.prune_collapsed_groups(board_id, valid_group_ids)
        collapsed = self.get_collapsed_groups(board_id)
        if collapsed:
            state["collapsed_groups"] = collapsed
        return state or None

    def restore_state(
        self,
        board_id: str,
        state: object,
        valid_group_ids: set[str] | None = None,
    ) -> None:
        """Поднять таймер, фокус и свёрнутые группы из БД один раз за жизнь процесса.

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
        collapsed = state.get("collapsed_groups")
        if isinstance(collapsed, list) and board_id not in self.collapsed_groups:
            valid = {
                g
                for g in collapsed
                if isinstance(g, str)
                and 0 < len(g) <= 100
                and (valid_group_ids is None or g in valid_group_ids)
            }
            if len(valid) > self.MAX_COLLAPSED_GROUPS:
                valid = set(sorted(valid)[: self.MAX_COLLAPSED_GROUPS])
            if valid:
                self.collapsed_groups[board_id] = valid

    def current_seq(self, board_id: str) -> int:
        return self.seq.get(board_id, 0)

    def connection_counts(self) -> tuple[int, int]:
        """Число открытых сокетов (на досках, на уровне команд)."""
        board_sockets = sum(len(s) for s in self.rooms.values())
        workspace_sockets = sum(len(s) for s in self.workspace_rooms.values())
        return board_sockets, workspace_sockets

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
        stalled: list[tuple[WebSocket, str]] = []
        for ws in list(self.rooms.get(board_id, [])):
            if ws is exclude:
                continue
            message = render(ws)
            if message is None:
                continue
            queue = self._queues.get(id(ws))
            if queue is None:
                dead.append(ws)
                continue
            try:
                queue.put_nowait(message)
            except asyncio.QueueFull:
                stalled.append((ws, message))
        if stalled:
            results = await asyncio.gather(
                *(self._send_raw(ws, msg) for ws, msg in stalled),
                return_exceptions=True,
            )
            for (ws, _msg), ok in zip(stalled, results, strict=True):
                if ok is not True:
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
                await self.broadcast_typing(board_id)

    async def broadcast_workspace(
        self,
        workspace_id: str,
        event: str,
        data: dict,
        exclude_board_id: str | None = None,
    ):
        """Разослать событие всем клиентам данного workspace (доски и дашборд)."""
        ws_message = json.dumps({"event": event, "data": data}, default=str)

        dead_ws_sockets: list[WebSocket] = []
        stalled_ws_sockets: list[WebSocket] = []
        for ws in list(self.workspace_rooms.get(workspace_id, [])):
            queue = self._queues.get(id(ws))
            if queue is None:
                dead_ws_sockets.append(ws)
                continue
            try:
                queue.put_nowait(ws_message)
            except asyncio.QueueFull:
                stalled_ws_sockets.append(ws)
        if stalled_ws_sockets:
            results = await asyncio.gather(
                *(self._send_raw(ws, ws_message) for ws in stalled_ws_sockets),
                return_exceptions=True,
            )
            for ws, ok in zip(stalled_ws_sockets, results, strict=True):
                if ok is not True:
                    dead_ws_sockets.append(ws)
        for ws in dead_ws_sockets:
            self.disconnect_workspace(workspace_id, ws)

        dead_by_board: dict[str, list[WebSocket]] = defaultdict(list)
        stalled_board_targets: list[tuple[str, WebSocket, str]] = []
        for b_id, sockets in list(self.rooms.items()):
            if exclude_board_id is not None and b_id == exclude_board_id:
                continue
            targets = [
                ws for ws in list(sockets) if self.ws_workspaces.get(id(ws)) == workspace_id
            ]
            if not targets:
                continue
            envelope = self._envelope(b_id, event)
            board_message = json.dumps({**envelope, "data": data}, default=str)
            for ws in targets:
                queue = self._queues.get(id(ws))
                if queue is None:
                    dead_by_board[b_id].append(ws)
                    continue
                try:
                    queue.put_nowait(board_message)
                except asyncio.QueueFull:
                    stalled_board_targets.append((b_id, ws, board_message))

        if stalled_board_targets:
            results = await asyncio.gather(
                *(self._send_raw(ws, msg) for _b_id, ws, msg in stalled_board_targets),
                return_exceptions=True,
            )
            for (b_id, ws, _msg), ok in zip(stalled_board_targets, results, strict=True):
                if ok is not True:
                    dead_by_board[b_id].append(ws)

        for b_id, dead in dead_by_board.items():
            await self._drop_dead(b_id, dead)


manager = ConnectionManager()
