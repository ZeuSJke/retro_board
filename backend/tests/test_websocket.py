"""Tests for WebSocket /ws/{board_id} endpoint.

Личность сокета сервер берёт из токена сессии, поэтому разные люди в тестах —
это разные токены (`ws_token_for("Имя")`), а не разные имена в сообщениях.
"""

import json
import time
from contextlib import contextmanager

import pytest
from starlette.websockets import WebSocketDisconnect

from app.config import settings
from app.ws_manager import manager

TEST_ORIGIN = "http://localhost:3000"


def recv_event(ws, target_event: str, max_messages: int = 15):
    """Receive messages until we get one with the target event, skipping others."""
    for _ in range(max_messages):
        msg = ws.receive_json()
        if msg["event"] == target_event:
            return msg
    raise AssertionError(
        f"Did not receive '{target_event}' within {max_messages} messages"
    )


def send(ws, event: str, data: dict | None = None) -> None:
    ws.send_text(json.dumps({"event": event, "data": data or {}}))


# WebSocket подключается только к существующей доске: помощник connect() создаёт
# пустую доску с нужным идентификатором через фикстуру ensure_board.
_ensure_board = None


@pytest.fixture(autouse=True)
def _boards_on_demand(ensure_board):
    global _ensure_board
    _ensure_board = ensure_board
    yield
    _ensure_board = None


@contextmanager
def connect(client, board_id: str, token: str, drain: bool = True):
    """Подключиться к доске.

    При подключении сервер шлёт начальное состояние и завершает его рассылкой
    presence_update. По умолчанию эти сообщения пропускаются, чтобы тест не
    принял стартовое состояние за ответ на своё действие; `drain=False` — для
    тестов, которые проверяют само начальное состояние.
    """
    if _ensure_board is not None:
        _ensure_board(board_id)
    with client.websocket_connect(
        f"/ws/{board_id}?workspace_token={token}", headers={"origin": TEST_ORIGIN}
    ) as ws:
        if drain:
            recv_event(ws, "presence_update")
        yield ws


def events_until(ws, marker_event: str, max_messages: int = 20) -> list[str]:
    """Имена событий, полученных до события-маркера включительно."""
    seen: list[str] = []
    for _ in range(max_messages):
        msg = ws.receive_json()
        seen.append(msg["event"])
        if msg["event"] == marker_event:
            return seen
    raise AssertionError(f"Marker '{marker_event}' not received: {seen}")


def expect_rejected(connect_fn) -> int | None:
    try:
        with connect_fn():
            pass
    except Exception as exc:  # noqa: BLE001 — TestClient бросает исключение с кодом закрытия
        return getattr(exc, "code", None)
    pytest.fail("Expected WebSocket to be rejected")


class TestConnect:
    def test_connect_and_ping(self, client, ws_token):
        with connect(client, "test-board", ws_token) as ws:
            ws.send_text("ping")

    def test_facilitator_update_is_first_message(self, client, ws_token):
        with connect(client, "board-init", ws_token, drain=False) as ws:
            msg = ws.receive_json()
            assert msg["event"] == "facilitator_update"
            assert msg["data"]["facilitator"] is None
            assert msg["data"]["facilitator_id"] is None
            assert msg["data"]["phase"] is None

    def test_presence_is_announced_on_connect(self, client, ws_token_for):
        """Участник известен с момента подключения — отдельное «представление» не нужно."""
        with connect(client, "board-presence", ws_token_for("Alice"), drain=False) as ws1:
            first = recv_event(ws1, "presence_update")["data"]
            assert first["users"] == ["Alice"]
            with connect(client, "board-presence", ws_token_for("Bob")):
                second = recv_event(ws1, "presence_update")["data"]
                assert second["users"] == ["Alice", "Bob"]
                assert [p["name"] for p in second["participants"]] == ["Alice", "Bob"]
                assert len({p["id"] for p in second["participants"]}) == 2

    def test_two_tabs_are_one_participant(self, client, ws_token_for):
        token = ws_token_for("Alice")
        with connect(client, "board-tabs", token, drain=False) as tab1, connect(client, "board-tabs", token):
            recv_event(tab1, "presence_update")
            assert recv_event(tab1, "presence_update")["data"]["users"] == ["Alice"]

    def test_namesakes_are_different_participants(self, client, ws_token_for):
        with connect(client, "board-names", ws_token_for("Саша"), drain=False) as ws1:
            recv_event(ws1, "presence_update")
            with connect(client, "board-names", ws_token_for("Саша")):
                presence = recv_event(ws1, "presence_update")["data"]
                assert presence["users"] == ["Саша", "Саша"]
                assert len({p["id"] for p in presence["participants"]}) == 2


class TestIdentityComesFromSession:
    def test_identify_cannot_change_name(self, client, ws_token_for):
        with connect(client, "board-id", ws_token_for("Mallory"), drain=False) as ws:
            recv_event(ws, "presence_update")
            send(ws, "identify", {"username": "Alice"})
            assert recv_event(ws, "presence_update")["data"]["users"] == ["Mallory"]

    def test_cursor_carries_session_identity(self, client, ws_token_for):
        with connect(client, "board-id2", ws_token_for("Mallory")) as ws1:
            with connect(client, "board-id2", ws_token_for("Bob")) as ws2:
                send(ws1, "cursor_move", {"username": "Alice", "x": 100, "y": 200})
                moved = recv_event(ws2, "cursor_move")["data"]
                assert moved["username"] == "Mallory"
                assert (moved["x"], moved["y"]) == (100, 200)

    def test_facilitator_role_cannot_be_hijacked_by_name(self, client, ws_token_for):
        """Раньше второй сокет, назвавшись именем ведущего, менял фазу и завершал сессию."""
        board = "board-hijack"
        with connect(client, board, ws_token_for("Alice")) as ws_fac:
            # Тёзка ведущего и участник, «представившийся» его именем
            with connect(client, board, ws_token_for("Alice")) as ws_twin:
                send(ws_fac, "facilitator_start")
                started = recv_event(ws_twin, "facilitator_update")["data"]
                assert started["facilitator"] == "Alice"

                send(ws_twin, "identify", {"username": "Alice"})
                send(ws_twin, "phase_change", {"phase": "summary"})
                send(ws_twin, "facilitator_stop", {"lock_board": True})
                send(ws_twin, "timer_start", {"duration": 60, "remaining": 60})
                send(ws_twin, "group_collapse", {"group_id": "маркер", "collapsed": True})

                seen = events_until(ws_fac, "group_collapse")
                assert "phase_update" not in seen
                assert "timer_start" not in seen
                assert manager.get_facilitator(board) == started["facilitator_id"]
                assert manager.get_phase(board) == "brainstorm"


class TestCursor:
    def test_cursor_broadcast_to_others_not_sender(self, client, ws_token_for):
        with connect(client, "board-1", ws_token_for("Alice")) as ws1:
            with connect(client, "board-1", ws_token_for("Bob")) as ws2:
                send(ws1, "cursor_move", {"x": 100, "y": 200})
                msg = recv_event(ws2, "cursor_move")
                assert msg["data"]["username"] == "Alice"
                assert msg["data"]["x"] == 100
                send(ws1, "group_collapse", {"group_id": "маркер", "collapsed": True})
                assert "cursor_move" not in events_until(ws1, "group_collapse")

    def test_cursor_leave_on_disconnect(self, client, ws_token_for):
        with connect(client, "board-2", ws_token_for("Listener")) as ws_listener:
            with connect(client, "board-2", ws_token_for("Bob")) as ws_leaver:
                send(ws_leaver, "cursor_move", {"x": 0, "y": 0})
                recv_event(ws_listener, "cursor_move")

            msg = recv_event(ws_listener, "cursor_leave")
            assert msg["data"]["username"] == "Bob"
            assert msg["data"]["participant_id"]

    def test_presence_update_on_leave(self, client, ws_token_for):
        with connect(client, "board-presence2", ws_token_for("Listener")) as ws_listener:
            with connect(client, "board-presence2", ws_token_for("Charlie")):
                assert "Charlie" in recv_event(ws_listener, "presence_update")["data"]["users"]

            msg = recv_event(ws_listener, "presence_update")
            assert msg["data"]["users"] == ["Listener"]


class TestFacilitator:
    def test_start_stop_and_phase(self, client, ws_token_for):
        board = "board-fac"
        with connect(client, board, ws_token_for("Leader")) as ws1:
            with connect(client, board, ws_token_for("Member")) as ws2:
                send(ws1, "facilitator_start")
                msg = recv_event(ws2, "facilitator_update")
                assert msg["data"]["facilitator"] == "Leader"
                assert msg["data"]["facilitator_id"]
                assert msg["data"]["facilitator_online"] is True
                assert msg["data"]["phase"] == "brainstorm"

                send(ws1, "phase_change", {"phase": "vote"})
                assert recv_event(ws2, "phase_update")["data"]["phase"] == "vote"

                send(ws1, "facilitator_stop")
                msg = recv_event(ws2, "facilitator_update")
                assert msg["data"]["facilitator"] is None
                assert msg["data"]["phase"] is None

    def test_second_start_is_ignored(self, client, ws_token_for):
        board = "board-fac-second"
        with connect(client, board, ws_token_for("Leader")) as ws1:
            with connect(client, board, ws_token_for("Member")) as ws2:
                send(ws1, "facilitator_start")
                leader_id = recv_event(ws2, "facilitator_update")["data"]["facilitator_id"]
                send(ws2, "facilitator_start")
                send(ws2, "group_collapse", {"group_id": "маркер", "collapsed": True})
                events_until(ws1, "group_collapse")
                assert manager.get_facilitator(board) == leader_id

    def test_invalid_phase_is_ignored(self, client, ws_token):
        with connect(client, "board-fac-phase", ws_token) as ws:
            send(ws, "facilitator_start")
            recv_event(ws, "facilitator_update")
            send(ws, "phase_change", {"phase": "не-фаза"})
            send(ws, "phase_change", {"phase": ["vote"]})
            send(ws, "group_collapse", {"group_id": "маркер", "collapsed": True})
            assert "phase_update" not in events_until(ws, "group_collapse")

    def test_rename_via_rest_updates_facilitator_and_presence(
        self, client, ws_board, ws_token_for
    ):
        """Смена имени идёт через REST и не отнимает роль ведущего."""
        token = ws_token_for("Bob")
        with connect(client, ws_board.id, token) as ws_fac:
            with connect(client, ws_board.id, ws_token_for("Other")) as ws_other:
                send(ws_fac, "facilitator_start")
                started = recv_event(ws_other, "facilitator_update")["data"]
                assert started["facilitator"] == "Bob"

                resp = client.patch(
                    "/api/workspaces/me/participant",
                    json={"name": "Robert"},
                    headers={"X-Workspace-Token": token},
                )
                assert resp.status_code == 200
                assert resp.json()["name"] == "Robert"

                renamed = recv_event(ws_other, "participant_renamed")["data"]
                assert renamed == {"participant_id": started["facilitator_id"], "name": "Robert"}
                assert "Robert" in recv_event(ws_other, "presence_update")["data"]["users"]
                fac = recv_event(ws_other, "facilitator_update")["data"]
                assert fac["facilitator"] == "Robert"
                assert fac["facilitator_id"] == started["facilitator_id"]


class TestFacilitatorHandover:
    def test_transfer_to_online_participant(self, client, ws_token_for):
        board = "board-transfer"
        with connect(client, board, ws_token_for("Leader")) as ws1:
            with connect(client, board, ws_token_for("Member")) as ws2:
                presence = recv_event(ws1, "presence_update")
                member_id = next(
                    p["id"] for p in presence["data"]["participants"] if p["name"] == "Member"
                )
                send(ws1, "facilitator_start")
                recv_event(ws2, "facilitator_update")
                send(ws1, "phase_change", {"phase": "discuss"})
                recv_event(ws1, "phase_update")
                recv_event(ws2, "phase_update")

                send(ws1, "facilitator_transfer", {"participant_id": member_id})
                handed = recv_event(ws2, "facilitator_update")["data"]
                assert handed["facilitator"] == "Member"
                assert handed["facilitator_id"] == member_id
                # Фаза и сессия сохраняются
                assert handed["phase"] == "discuss"

                # Прежний ведущий больше не управляет, новый — управляет
                send(ws1, "phase_change", {"phase": "vote"})
                send(ws2, "phase_change", {"phase": "summary"})
                assert recv_event(ws1, "phase_update")["data"]["phase"] == "summary"

    def test_transfer_to_unknown_participant_is_ignored(self, client, ws_token):
        board = "board-transfer-bad"
        with connect(client, board, ws_token) as ws:
            send(ws, "facilitator_start")
            me = recv_event(ws, "facilitator_update")["data"]["facilitator_id"]
            send(ws, "facilitator_transfer", {"participant_id": "нет-такого"})
            send(ws, "facilitator_transfer", {"participant_id": me})
            send(ws, "group_collapse", {"group_id": "маркер", "collapsed": True})
            events_until(ws, "group_collapse")
            assert manager.get_facilitator(board) == me

    def test_takeover_only_when_facilitator_is_gone(self, client, ws_token_for, monkeypatch):
        board = "board-takeover"
        monkeypatch.setattr(manager, "FACILITATOR_TAKEOVER_SECONDS", 0.05)
        with connect(client, board, ws_token_for("Member")) as ws_member:
            with connect(client, board, ws_token_for("Leader")) as ws_leader:
                send(ws_leader, "facilitator_start")
                leader_id = recv_event(ws_member, "facilitator_update")["data"]["facilitator_id"]
                send(ws_leader, "phase_change", {"phase": "vote"})
                recv_event(ws_member, "phase_update")

                # Пока ведущий на доске, роль забрать нельзя
                send(ws_member, "facilitator_takeover")
                send(ws_member, "group_collapse", {"group_id": "маркер", "collapsed": True})
                events_until(ws_member, "group_collapse")
                assert manager.get_facilitator(board) == leader_id

            # Ведущий ушёл: остальные видят, что он не в сети
            offline = recv_event(ws_member, "facilitator_update")["data"]
            assert offline["facilitator_id"] == leader_id
            assert offline["facilitator_online"] is False

            time.sleep(0.1)
            send(ws_member, "facilitator_takeover")
            taken = recv_event(ws_member, "facilitator_update")["data"]
            assert taken["facilitator"] == "Member"
            assert taken["facilitator_online"] is True
            # Сессия не начинается заново
            assert taken["phase"] == "vote"

    def test_grace_period_preserves_session_on_reconnect(self, client, ws_token_for, monkeypatch):
        monkeypatch.setattr(manager, "FACILITATOR_GRACE_SECONDS", 0.2)
        board = "board-grace"
        leader = ws_token_for("Alice")
        with connect(client, board, ws_token_for("Other")) as ws_other:
            with connect(client, board, leader) as ws_fac:
                send(ws_fac, "facilitator_start")
                leader_id = recv_event(ws_other, "facilitator_update")["data"]["facilitator_id"]

            # Ведущий отключился (F5): сессия ещё жива
            assert manager.get_facilitator(board) == leader_id

            with connect(client, board, leader, drain=False) as ws_fac2:
                fac_ev = recv_event(ws_fac2, "facilitator_update")
                assert fac_ev["data"]["facilitator"] == "Alice"
                time.sleep(0.25)
                # Прежний grace-период истёк, но ведущий вернулся — сессия продолжается
                assert manager.get_facilitator(board) == leader_id

    def test_grace_period_clears_when_not_reconnected(self, client, ws_token_for, monkeypatch):
        monkeypatch.setattr(manager, "FACILITATOR_GRACE_SECONDS", 0.05)
        board = "board-grace-exp"
        with connect(client, board, ws_token_for("Other")) as ws_other:
            with connect(client, board, ws_token_for("Alice")) as ws_fac:
                send(ws_fac, "facilitator_start")
                assert recv_event(ws_other, "facilitator_update")["data"]["facilitator"] == "Alice"

            # Сначала — «ведущий не в сети», после grace — сессия завершена
            assert recv_event(ws_other, "facilitator_update")["data"]["facilitator_online"] is False
            time.sleep(0.1)
            ev_clear = recv_event(ws_other, "facilitator_update")
            assert ev_clear["data"]["facilitator"] is None
            assert manager.get_facilitator(board) is None

    def test_default_grace_survives_a_slow_reconnect(self):
        """Переподключение после рестарта пода занимает около 10 секунд — запас обязан быть больше."""
        assert manager.FACILITATOR_GRACE_SECONDS >= 60
        assert manager.FACILITATOR_TAKEOVER_SECONDS < manager.FACILITATOR_GRACE_SECONDS

    def test_stuck_session_after_restart_is_cleared(
        self, client, ws_board, ws_token_for, db_session, monkeypatch
    ):
        """После рестарта сессия восстанавливается из БД; если ведущий не вернулся, она завершается.

        Раньше grace-таймер ставился только на отключение, и такая сессия висела вечно:
        никто не мог ни начать новую, ни остановить эту.
        """
        from app.models import Board

        monkeypatch.setattr(manager, "FACILITATOR_GRACE_SECONDS", 0.05)
        with connect(client, ws_board.id, ws_token_for("Host")) as ws_host:
            send(ws_host, "facilitator_start")
            recv_event(ws_host, "facilitator_update")
            # Имитируем рестарт: память пуста, в БД сессия осталась
            manager.reset()

        db_session.expire_all()
        assert db_session.get(Board, ws_board.id).active_facilitator == "Host"

        with connect(client, ws_board.id, ws_token_for("Member"), drain=False) as ws_member:
            hydrated = recv_event(ws_member, "facilitator_update")["data"]
            assert hydrated["facilitator"] == "Host"
            assert hydrated["facilitator_online"] is False
            time.sleep(0.1)
            cleared = recv_event(ws_member, "facilitator_update")["data"]
            assert cleared["facilitator"] is None
            # Теперь сессию можно начать заново
            send(ws_member, "facilitator_start")
            assert recv_event(ws_member, "facilitator_update")["data"]["facilitator"] == "Member"

        db_session.expire_all()
        assert db_session.get(Board, ws_board.id).active_facilitator == "Member"


class TestTimerEvents:
    def test_timer_start_pause_reset_broadcast(self, client, ws_token_for):
        with connect(client, "board-t", ws_token_for("Alice")) as ws1:
            with connect(client, "board-t", ws_token_for("Bob")) as ws2:
                send(ws1, "timer_start", {"duration": 300, "remaining": 300, "ts": 0})
                assert recv_event(ws1, "timer_start")["data"]["duration"] == 300
                assert recv_event(ws2, "timer_start")["data"]["remaining"] == 300

                send(ws1, "timer_pause", {"remaining": 120})
                assert recv_event(ws2, "timer_pause")["data"] == {"remaining": 120}

                send(ws1, "timer_reset", {"duration": 300})
                assert recv_event(ws2, "timer_reset")["data"] == {"duration": 300}

    def test_running_timer_sent_on_connect(self, client, ws_token_for):
        with connect(client, "board-ts1", ws_token_for("Alice")) as ws1:
            send(ws1, "timer_start", {"duration": 300, "remaining": 300, "ts": 0})
            recv_event(ws1, "timer_start")
            with connect(client, "board-ts1", ws_token_for("Bob"), drain=False) as ws2:
                msg = recv_event(ws2, "timer_start")
                assert msg["data"]["duration"] == 300
                assert 0 < msg["data"]["remaining"] <= 300

    def test_paused_timer_sent_on_connect(self, client, ws_token_for):
        with connect(client, "board-ts2", ws_token_for("Alice")) as ws1:
            send(ws1, "timer_start", {"duration": 300, "remaining": 300, "ts": 0})
            recv_event(ws1, "timer_start")
            send(ws1, "timer_pause", {"remaining": 120})
            recv_event(ws1, "timer_pause")
            with connect(client, "board-ts2", ws_token_for("Bob"), drain=False) as ws2:
                assert recv_event(ws2, "timer_pause")["data"]["remaining"] == 120

    def test_reset_timer_reaches_new_client_as_stopped(self, client, ws_token_for):
        """После сброса новый участник видит таймер остановленным на полной длительности."""
        with connect(client, "board-ts3", ws_token_for("Alice")) as ws1:
            send(ws1, "timer_start", {"duration": 300, "remaining": 40})
            recv_event(ws1, "timer_start")
            send(ws1, "timer_reset", {"duration": 300})
            recv_event(ws1, "timer_reset")
            with connect(client, "board-ts3", ws_token_for("Bob"), drain=False) as ws2:
                seen = []
                while True:
                    msg = ws2.receive_json()
                    seen.append(msg)
                    if msg["event"] == "presence_update":
                        break
                assert "timer_start" not in [m["event"] for m in seen]
                paused = next(m for m in seen if m["event"] == "timer_pause")
                assert paused["data"] == {"remaining": 300, "duration": 300}

    def test_zero_timer_not_sent_on_connect(self, client, ws_token_for):
        with connect(client, "board-ts4", ws_token_for("Alice")) as ws1:
            send(ws1, "timer_reset", {"duration": 0})
            recv_event(ws1, "timer_reset")
            with connect(client, "board-ts4", ws_token_for("Bob"), drain=False) as ws2:
                seen = events_until(ws2, "presence_update")
                assert "timer_start" not in seen and "timer_pause" not in seen

    def test_non_facilitator_timer_ignored(self, client, ws_token_for):
        board = "board-tfac1"
        with connect(client, board, ws_token_for("Facilitator")) as ws_fac:
            with connect(client, board, ws_token_for("Regular")) as ws_other:
                send(ws_fac, "facilitator_start")
                recv_event(ws_other, "facilitator_update")

                send(ws_other, "timer_start", {"duration": 300, "remaining": 300, "ts": 0})
                send(ws_fac, "group_collapse", {"group_id": "маркер", "collapsed": True})
                assert "timer_start" not in events_until(ws_other, "group_collapse")
                assert manager.get_timer(board) is None

    def test_no_facilitator_anyone_can_send_timer(self, client, ws_token_for):
        with connect(client, "board-tfac2", ws_token_for("Alice")) as ws1:
            with connect(client, "board-tfac2", ws_token_for("Bob")) as ws2:
                send(ws2, "timer_start", {"duration": 300, "remaining": 300, "ts": 0})
                assert recv_event(ws1, "timer_start")["event"] == "timer_start"


class TestGroupCollapse:
    def test_group_collapse_broadcast_to_all(self, client, ws_token_for):
        with connect(client, "board-g", ws_token_for("Alice")) as ws1:
            with connect(client, "board-g", ws_token_for("Bob")) as ws2:
                send(ws1, "group_collapse", {"group_id": "g1", "collapsed": True})
                assert recv_event(ws1, "group_collapse")["data"]["group_id"] == "g1"
                assert recv_event(ws2, "group_collapse")["data"]["collapsed"] is True


class TestOriginValidation:
    """Origin header should be validated against CORS_ORIGINS setting."""

    def test_invalid_origin_rejected(self, client, ws_token):
        code = expect_rejected(
            lambda: client.websocket_connect(
                f"/ws/board-origin1?workspace_token={ws_token}",
                headers={"origin": "http://evil.example.com"},
            )
        )
        assert code == 1008

    def test_valid_origin_accepted(self, client, ws_token):
        with connect(client, "board-origin2", ws_token) as ws:
            ws.send_text("ping")

    def test_no_origin_rejected(self, client, ws_token):
        code = expect_rejected(
            lambda: client.websocket_connect(f"/ws/board-origin3?workspace_token={ws_token}")
        )
        assert code == 1008


class TestAuth:
    def test_board_ws_auth_via_httponly_cookie(self, client, ws_token, ws_board):
        with client.websocket_connect(
            f"/ws/{ws_board.id}",
            headers={"origin": TEST_ORIGIN, "cookie": f"workspace_token={ws_token}"},
        ) as ws:
            assert ws.receive_json()["event"] == "facilitator_update"

    def test_workspace_ws_auth_via_httponly_cookie(self, client, ws_token):
        with client.websocket_connect(
            "/ws/workspace",
            headers={"origin": TEST_ORIGIN, "cookie": f"workspace_token={ws_token}"},
        ) as ws:
            create_resp = client.post(
                "/api/boards/",
                json={"name": "WS Cookie Board"},
                headers={"X-Workspace-Token": ws_token},
            )
            assert create_resp.status_code == 201
            ev_created = recv_event(ws, "board_created")
            assert ev_created["data"]["id"] == create_resp.json()["id"]

    def test_rejects_missing_token(self, client, ws_board):
        code = expect_rejected(
            lambda: client.websocket_connect(
                f"/ws/{ws_board.id}", headers={"origin": TEST_ORIGIN}
            )
        )
        assert code == 1008

    def test_rejects_invalid_cookie_token(self, client, ws_board):
        code = expect_rejected(
            lambda: client.websocket_connect(
                f"/ws/{ws_board.id}",
                headers={"origin": TEST_ORIGIN, "cookie": "workspace_token=invalid.jwt.token"},
            )
        )
        assert code == 1008

    def test_rejects_token_without_participant(self, client, ws_workspace, ws_board):
        """Токен, выданный до появления участников, личности не несёт — нужен новый вход."""
        from datetime import UTC, datetime, timedelta

        import jwt

        legacy = jwt.encode(
            {
                "workspace_id": ws_workspace.id,
                "workspace_slug": ws_workspace.slug,
                "workspace_name": ws_workspace.name,
                "exp": datetime.now(UTC) + timedelta(hours=1),
            },
            settings.workspace_jwt_secret,
            algorithm="HS256",
        )
        assert expect_rejected(lambda: connect(client, ws_board.id, legacy)) == 1008
        assert (
            expect_rejected(
                lambda: client.websocket_connect(
                    f"/ws/workspace?workspace_token={legacy}", headers={"origin": TEST_ORIGIN}
                )
            )
            == 1008
        )

    def test_rejects_token_after_key_rotation(
        self, client, ws_workspace, ws_board, ws_token, db_session
    ):
        """Смена ключа доступа увеличивает поколение токенов — старые сессии недействительны."""
        with connect(client, ws_board.id, ws_token, drain=False) as ws:
            assert ws.receive_json()["event"] == "facilitator_update"
        ws_workspace.token_epoch += 1
        db_session.commit()
        assert expect_rejected(lambda: connect(client, ws_board.id, ws_token)) == 1008

    def test_deleted_board_ws_rejected(self, client, ws_token, ws_board, db_session):
        from datetime import datetime, timezone

        ws_board.deleted_at = datetime.now(timezone.utc)
        db_session.commit()
        assert expect_rejected(lambda: connect(client, ws_board.id, ws_token)) == 1008

    def test_logout_closes_sockets_and_blocks_reconnect(self, client, ws_token_for, ws_board):
        """Выход завершает сессию целиком: открытый сокет закрывается, новый не откроется."""
        anna, boris = ws_token_for("Анна"), ws_token_for("Борис")
        with connect(client, ws_board.id, boris) as observer:
            with connect(client, ws_board.id, anna) as ws:
                recv_event(observer, "presence_update")
                resp = client.post("/api/workspaces/logout", headers={"X-Workspace-Token": anna})
                assert resp.status_code == 204
                with pytest.raises(WebSocketDisconnect) as closed:
                    for _ in range(10):
                        ws.receive_json()
                assert closed.value.code == 1008
            # Остальные видят, что участник ушёл
            presence = recv_event(observer, "presence_update")
            assert [p["name"] for p in presence["data"]["participants"]] == ["Борис"]
        assert expect_rejected(lambda: connect(client, ws_board.id, anna)) == 1008

    def test_unknown_board_ws_rejected(self, client, ws_token):
        """Раньше под SQLite проверка доски пропускалась — теперь она одна для всех СУБД."""
        code = expect_rejected(
            lambda: client.websocket_connect(
                f"/ws/no-such-board?workspace_token={ws_token}", headers={"origin": TEST_ORIGIN}
            )
        )
        assert code == 1008

    def test_other_team_board_ws_rejected(self, client, ws_token, sample_board):
        """Доска другой команды для сокета не существует."""
        assert expect_rejected(lambda: client.websocket_connect(
            f"/ws/{sample_board['id']}?workspace_token={ws_token}", headers={"origin": TEST_ORIGIN}
        )) == 1008


class TestWorkspaceSocket:
    def test_workspace_ws_receives_board_events(self, client, ws_token):
        ws_headers = {"X-Workspace-Token": ws_token}
        with client.websocket_connect(
            f"/ws/workspace?workspace_token={ws_token}", headers={"origin": TEST_ORIGIN}
        ) as ws:
            create_resp = client.post(
                "/api/boards/", json={"name": "WS Live Board"}, headers=ws_headers
            )
            assert create_resp.status_code == 201
            board = create_resp.json()
            ev_created = recv_event(ws, "board_created")
            assert ev_created["data"]["id"] == board["id"]
            assert ev_created["data"]["name"] == "WS Live Board"

            upd_resp = client.patch(
                f"/api/boards/{board['id']}",
                json={"name": "WS Live Board Renamed"},
                headers=ws_headers,
            )
            assert upd_resp.status_code == 200
            ev_updated = recv_event(ws, "board_updated")
            assert ev_updated["data"]["id"] == board["id"]
            assert ev_updated["data"]["name"] == "WS Live Board Renamed"

            del_resp = client.delete(f"/api/boards/{board['id']}", headers=ws_headers)
            assert del_resp.status_code == 204
            ev_deleted = recv_event(ws, "board_deleted")
            assert ev_deleted["data"]["id"] == board["id"]


class TestWorkspaceSocketHeartbeat:
    def test_workspace_socket_answers_ping(self, client, ws_token):
        """Панель управления тоже должна отличать живое соединение от зависшего."""
        with client.websocket_connect(
            f"/ws/workspace?workspace_token={ws_token}", headers={"origin": TEST_ORIGIN}
        ) as ws:
            ws.send_text("ping")
            assert ws.receive_json() == {"event": "pong", "data": {}}
            # Прочие сообщения сокет команды по-прежнему молча пропускает
            ws.send_text("что угодно")
            ws.send_text("ping")
            assert ws.receive_json()["event"] == "pong"


class TestLockedBoardSession:
    def test_session_cannot_start_on_a_locked_board(self, client, ws_token, ws_board, db_session):
        """Заблокированная доска — архив: «Штурм» новой сессии скрыл бы её карточки у всех."""
        ws_board.is_locked = True
        db_session.commit()
        with connect(client, ws_board.id, ws_token) as ws:
            send(ws, "facilitator_start")
            # Команда молча отклонена; следующая — обычный ответ без ведущего
            send(ws, "identify")
            assert recv_event(ws, "facilitator_update")["data"]["facilitator_id"] is None
        db_session.refresh(ws_board)
        assert ws_board.active_phase is None and ws_board.active_facilitator_id is None

    def test_session_starts_after_unlock(self, client, ws_token, ws_board, db_session):
        ws_board.is_locked = True
        db_session.commit()
        with connect(client, ws_board.id, ws_token) as ws:
            send(ws, "facilitator_start")
            ws_board.is_locked = False
            db_session.commit()
            send(ws, "facilitator_start")
            started = recv_event(ws, "facilitator_update")["data"]
            assert started["facilitator_id"] is not None and started["phase"] == "brainstorm"


class TestSummaryEvents:
    def test_summary_failed_event_on_generation_error(
        self, client, ws_token, ws_board, monkeypatch
    ):
        from app.services import boards as boards_service

        monkeypatch.setattr(settings, "ai_base_url", "http://llm.test/v1")
        monkeypatch.setattr(
            boards_service, "generate_summary_internal", lambda *args, **kwargs: None
        )
        with connect(client, ws_board.id, ws_token) as ws:
            send(ws, "facilitator_start")
            recv_event(ws, "facilitator_update")
            send(ws, "phase_change", {"phase": "summary"})
            ev = recv_event(ws, "summary_failed")
            assert ev["data"]["message"] == "Не удалось сгенерировать итоги"

    def test_summary_generated_has_the_same_shape_as_regeneration(
        self, client, ws_token, ws_board, monkeypatch
    ):
        """Итоги из фазы и по кнопке приходят одним конвертом; различает их флаг regenerated."""
        from app.services import boards as boards_service

        summary = {"id": "s1", "summary_text": "Итоги", "key_themes": [], "recommendations": []}
        monkeypatch.setattr(settings, "ai_base_url", "http://llm.test/v1")
        monkeypatch.setattr(
            boards_service, "generate_summary_internal", lambda *args, **kwargs: summary
        )
        with connect(client, ws_board.id, ws_token) as ws:
            send(ws, "facilitator_start")
            recv_event(ws, "facilitator_update")
            send(ws, "phase_change", {"phase": "summary"})
            ev = recv_event(ws, "summary_generated")
            assert ev["data"] == {"summary": summary, "board_id": ws_board.id, "regenerated": False}

    def test_summary_failed_event_without_ai(self, client, ws_token, ws_board, monkeypatch):
        monkeypatch.setattr(settings, "ai_base_url", "")
        with connect(client, ws_board.id, ws_token) as ws:
            send(ws, "facilitator_start")
            recv_event(ws, "facilitator_update")
            send(ws, "phase_change", {"phase": "summary"})
            assert "AI не настроен" in recv_event(ws, "summary_failed")["data"]["message"]


class TestRateLimit:
    def test_cursor_flood_does_not_drop_facilitator_commands(self, client, ws_token, ws_board):
        with connect(client, ws_board.id, ws_token, drain=False) as ws:
            ws.receive_json()  # initial facilitator_update
            # Flood cursor_move past cursor rate limit (30/s)
            for i in range(35):
                send(ws, "cursor_move", {"x": 10 + i, "y": 20 + i})

            send(ws, "facilitator_start")
            ev_fac = recv_event(ws, "facilitator_update")
            assert ev_fac["data"]["facilitator"] == "Tester"

            send(ws, "phase_change", {"phase": "vote"})
            assert recv_event(ws, "phase_update")["data"]["phase"] == "vote"


class TestGroupCollapsePersistence:
    def test_late_joiner_receives_groups_collapsed_snapshot(
        self, client, ws_token_for, ws_board
    ):
        with connect(client, ws_board.id, ws_token_for("Alice")) as ws1:
            send(ws1, "group_collapse", {"group_id": "grp-1", "collapsed": True})
            assert recv_event(ws1, "group_collapse")["data"] == {
                "group_id": "grp-1",
                "collapsed": True,
            }

            with connect(client, ws_board.id, ws_token_for("Bob"), drain=False) as ws2:
                assert recv_event(ws2, "groups_collapsed")["data"] == {"group_ids": ["grp-1"]}

            send(ws1, "group_collapse", {"group_id": "grp-1", "collapsed": False})
            assert recv_event(ws1, "group_collapse")["data"]["collapsed"] is False

            with connect(client, ws_board.id, ws_token_for("Carol"), drain=False) as ws3:
                seen3 = events_until(ws3, "presence_update")
                assert "groups_collapsed" not in seen3


class TestBoardUpdateDeduplication:
    def test_patch_board_sends_single_board_updated_to_active_board(
        self, client, ws_token, ws_board
    ):
        ws_headers = {"X-Workspace-Token": ws_token}
        with (
            connect(client, ws_board.id, ws_token) as ws_board_sock,
            client.websocket_connect(
                f"/ws/workspace?workspace_token={ws_token}", headers={"origin": TEST_ORIGIN}
            ) as ws_workspace_sock,
        ):
            resp = client.patch(
                f"/api/boards/{ws_board.id}",
                json={"name": "Без дублей"},
                headers=ws_headers,
            )
            assert resp.status_code == 200

            ws_event = recv_event(ws_workspace_sock, "board_updated")
            assert ws_event["data"]["name"] == "Без дублей"

            # На самой доске событие приходит один раз и имеет порядковый номер;
            # следом отправляем group_collapse как маркер, чтобы убедиться, что второго дубля нет.
            send(ws_board_sock, "group_collapse", {"group_id": "marker", "collapsed": True})
            board_events = []
            for _ in range(20):
                msg = ws_board_sock.receive_json()
                board_events.append(msg)
                if msg["event"] == "group_collapse":
                    break
            updated = [m for m in board_events if m["event"] == "board_updated"]
            assert len(updated) == 1
            assert updated[0]["seq"] == 1
            assert updated[0]["data"]["name"] == "Без дублей"


class TestSlowConsumerAndSchema:
    def test_slow_consumer_full_queue_dropped_without_blocking_healthy_peer(self):
        import asyncio

        from app.ws_manager import ConnectionManager

        class FakeSocket:
            def __init__(self, hang: bool = False):
                self.hang = hang
                self.sent: list[str] = []
                self.closed_codes: list[int] = []
                self.release = asyncio.Event()

            async def accept(self):
                return None

            async def send_text(self, message: str):
                if self.hang:
                    await self.release.wait()
                self.sent.append(message)

            async def close(self, code: int = 1000, reason: str = ""):
                self.closed_codes.append(code)
                self.release.set()

        async def scenario():
            mgr = ConnectionManager()
            mgr.MAX_SOCKET_QUEUE = 2
            slow = FakeSocket(hang=True)
            healthy = FakeSocket(hang=False)
            await mgr.connect("b1", slow, peer=None)
            await mgr.connect("b1", healthy, peer=None)
            try:
                # 1-е сообщение уйдёт в hang внутри send_text, ещё 2 забьют очередь (maxsize=2),
                # 4-е переполнит очередь медленного клиента и отключит его, не блокируя healthy.
                await mgr.broadcast("b1", "reaction", {"emoji": "👍"})
                await asyncio.sleep(0)
                for i in range(4):
                    await mgr.broadcast("b1", "reaction", {"emoji": "👍", "i": i})
                    await asyncio.sleep(0)
                await asyncio.sleep(0.05)
                assert len(healthy.sent) == 5
                assert healthy in mgr.rooms.get("b1", [])
                assert slow not in mgr.rooms.get("b1", [])
                assert 1008 in slow.closed_codes
            finally:
                slow.release.set()
                mgr.reset()

        asyncio.run(scenario())

    def test_ws_schemas_rejects_bool_nan_and_unknown_events(self):
        from app.ws_schemas import parse_ws_event

        assert parse_ws_event("unknown", {}) is None
        assert parse_ws_event("cursor_move", {"x": True, "y": 10}) is None
        assert parse_ws_event("cursor_move", {"x": float("nan"), "y": 10}) is None
        assert parse_ws_event("phase_change", {"phase": "bogus"}) is None
        assert parse_ws_event("reaction", {"emoji": "🤖"}) is None
        assert parse_ws_event("group_collapse", {"group_id": "g1", "collapsed": "yes"}) is None
        assert parse_ws_event("facilitator_stop", {"lock_board": "false"}) is None
        assert parse_ws_event("card_typing", {"column_id": "c1", "is_typing": "yes"}) is None
        parsed_ready = parse_ws_event("ready_toggle", {"ready": "invalid"})
        assert parsed_ready is not None and parsed_ready[1].ready is None
        parsed_timer = parse_ws_event("timer_start", {"duration": 60, "remaining": 60, "junk": 1})
        assert parsed_timer is not None and parsed_timer[1].sanitized() == {
            "duration": 60,
            "remaining": 60,
        }
