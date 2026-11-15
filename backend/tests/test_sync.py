"""Синхронизация доски: номера событий, состояние между рестартами, устойчивый порядок."""

import json
import time

from app.models import Board, CardGroup, Column
from app.ws_manager import SEQUENCED_EVENTS, manager

TEST_ORIGIN = "http://localhost:3000"


def _ws(client, board_id, headers):
    return client.websocket_connect(
        f"/ws/{board_id}?workspace_token={headers['X-Workspace-Token']}",
        headers={"origin": TEST_ORIGIN},
    )


def _recv(ws, event_name, max_messages=25):
    for _ in range(max_messages):
        msg = ws.receive_json()
        if msg["event"] == event_name:
            return msg
    raise AssertionError(f"'{event_name}' not received")


def _send(ws, event_name, data=None):
    ws.send_text(json.dumps({"event": event_name, "data": data or {}}))


def _card(client, headers, column_id, text="К"):
    resp = client.post("/api/cards/", json={"column_id": column_id, "text": text}, headers=headers)
    assert resp.status_code == 201
    return resp.json()


class TestEventNumbers:
    def test_data_events_are_numbered_without_gaps(self, client, workspace_headers, sample_board, sample_column):
        """По пропуску в номерах клиент узнаёт, что потерял событие, и перечитывает доску."""
        board_id = sample_board["id"]
        with _ws(client, board_id, workspace_headers) as ws:
            card = _card(client, workspace_headers, sample_column["id"])
            created = _recv(ws, "card_created")
            client.post(f"/api/cards/{card['id']}/like", headers=workspace_headers)
            updated = _recv(ws, "card_updated")
            client.delete(f"/api/cards/{card['id']}", headers=workspace_headers)
            deleted = _recv(ws, "card_deleted")

        assert [created["seq"], updated["seq"], deleted["seq"]] == [1, 2, 3]
        assert created["epoch"] == updated["epoch"] == manager.epoch

    def test_snapshot_carries_current_number(self, client, workspace_headers, sample_board, sample_column):
        """События с номером не больше номера снимка в него уже вошли — применять их повторно не нужно."""
        board_id = sample_board["id"]
        before = client.get(f"/api/boards/{board_id}", headers=workspace_headers).json()
        assert (before["event_seq"], before["event_epoch"]) == (0, manager.epoch)
        _card(client, workspace_headers, sample_column["id"])
        _card(client, workspace_headers, sample_column["id"])
        after = client.get(f"/api/boards/{board_id}", headers=workspace_headers).json()
        assert after["event_seq"] == 2

    def test_snapshot_number_is_read_before_the_rows(
        self, client, workspace_headers, sample_board, monkeypatch
    ):
        """Событие, случившееся пока доска читалась из БД, не должно попасть в номер снимка.

        Иначе клиент счёл бы его уже учтённым и пропустил, хотя в снимке его данных нет.
        Обратная ошибка безвредна: событие, применённое поверх снимка повторно, ничего не портит.
        """
        from app.services import boards as boards_service

        board_id = sample_board["id"]
        real_query = boards_service.board_query

        def query_with_concurrent_event(db):
            # Пока запрос готовится, другой участник успевает сделать правку
            manager.seq[board_id] = manager.current_seq(board_id) + 1
            return real_query(db)

        monkeypatch.setattr(boards_service, "board_query", query_with_concurrent_event)
        by_id = client.get(f"/api/boards/{board_id}", headers=workspace_headers).json()
        assert by_id["event_seq"] == 0
        by_slug = client.get(
            f"/api/boards/by-slug/{sample_board['slug']}", headers=workspace_headers
        ).json()
        assert by_slug["event_seq"] == 1 and manager.current_seq(board_id) == 2

    def test_numbers_are_per_board(self, client, workspace_headers, sample_board, sample_column):
        other = client.post("/api/boards/", json={"name": "Другая"}, headers=workspace_headers).json()
        _card(client, workspace_headers, sample_column["id"])
        _card(client, workspace_headers, other["columns"][0]["id"])
        assert manager.current_seq(sample_board["id"]) == 1
        assert manager.current_seq(other["id"]) == 1

    def test_ephemeral_events_are_not_numbered(self, client, workspace_headers, login_as, sample_board):
        """Курсоры, реакции и присутствие в счёт не идут: их потеря ничего не портит."""
        anya = login_as("Аня")
        with _ws(client, sample_board["id"], workspace_headers) as ws1, _ws(client, sample_board["id"], anya) as ws2:
            _send(ws2, "cursor_move", {"x": 1, "y": 2})
            assert "seq" not in _recv(ws1, "cursor_move")
            _send(ws2, "reaction", {"emoji": "🔥"})
            assert "seq" not in _recv(ws1, "reaction")
            _send(ws2, "timer_start", {"duration": 60, "remaining": 60})
            assert "seq" not in _recv(ws1, "timer_start")
        assert manager.current_seq(sample_board["id"]) == 0
        assert {"cursor_move", "reaction", "presence_update", "timer_start"}.isdisjoint(SEQUENCED_EVENTS)

    def test_per_recipient_event_shares_one_number(self, client, workspace_headers, login_as):
        """Скрытая карточка уходит получателям в разном виде, но под одним номером."""
        anya = login_as("Аня")
        board = client.post(
            "/api/boards/", json={"name": "Сбор", "hide_cards_until_reveal": True}, headers=workspace_headers
        ).json()
        with _ws(client, board["id"], workspace_headers) as ws_owner, _ws(client, board["id"], anya) as ws_anya:
            _card(client, anya, board["columns"][0]["id"], "Секрет")
            for_owner = _recv(ws_owner, "card_created")
            for_author = _recv(ws_anya, "card_created")
        assert for_owner["seq"] == for_author["seq"] == 1
        assert for_owner["data"]["masked"] is True and for_author["data"]["masked"] is False

    def test_restart_changes_epoch(self, client, workspace_headers, sample_board, sample_column):
        """После рестарта нумерация начинается заново — клиент видит это по смене поколения."""
        _card(client, workspace_headers, sample_column["id"])
        old_epoch = manager.epoch
        manager.reset()
        snapshot = client.get(f"/api/boards/{sample_board['id']}", headers=workspace_headers).json()
        assert snapshot["event_epoch"] != old_epoch and snapshot["event_seq"] == 0

    def test_participant_renamed_is_sequenced_on_board_and_unsequenced_on_workspace(
        self, client, workspace_headers, sample_board
    ):
        board_id = sample_board["id"]
        with (
            _ws(client, board_id, workspace_headers) as board_ws,
            client.websocket_connect(
                f"/ws/workspace?workspace_token={workspace_headers['X-Workspace-Token']}",
                headers={"origin": TEST_ORIGIN},
            ) as workspace_ws,
        ):
            resp = client.patch(
                "/api/workspaces/me/participant",
                json={"name": "Новое Имя"},
                headers=workspace_headers,
            )
            assert resp.status_code == 200
            board_msg = _recv(board_ws, "participant_renamed")
            ws_msg = _recv(workspace_ws, "participant_renamed")
        assert board_msg["seq"] == 1
        assert board_msg["epoch"] == manager.epoch
        assert board_msg["data"]["name"] == "Новое Имя"
        assert "seq" not in ws_msg and ws_msg["data"]["name"] == "Новое Имя"


class TestHeartbeat:
    def test_ping_is_answered(self, client, workspace_headers, sample_board):
        """Без ответа клиент не может отличить живое соединение от зависшего."""
        with _ws(client, sample_board["id"], workspace_headers) as ws:
            ws.send_text("ping")
            assert _recv(ws, "pong")["data"] == {}


class TestStateSurvivesRestart:
    def test_running_timer_and_spotlight_are_restored(self, client, workspace_headers, sample_board, db_session):
        """Раньше каждый выкат обнулял таймер и карточку в фокусе."""
        board_id = sample_board["id"]
        with _ws(client, board_id, workspace_headers) as ws:
            _send(ws, "timer_start", {"duration": 300, "remaining": 200})
            _recv(ws, "timer_start")
            _send(ws, "spotlight_card", {"card_id": "card-42"})
            _recv(ws, "spotlight_update")
            _send(ws, "group_collapse", {"group_id": "grp-saved", "collapsed": True})
            _recv(ws, "group_collapse")

        db_session.expire_all()
        saved = json.loads(db_session.get(Board, board_id).session_state)
        assert saved["spotlight"] == "card-42"
        assert saved["collapsed_groups"] == ["grp-saved"]
        assert saved["timer"]["running"] is True and saved["timer"]["duration"] == 300
        assert saved["timer"]["ends_at_ms"] > time.time() * 1000

        manager.reset()  # рестарт пода: память пуста

        with _ws(client, board_id, workspace_headers) as ws:
            assert _recv(ws, "spotlight_update")["data"] == {"card_id": "card-42"}
            assert _recv(ws, "groups_collapsed")["data"] == {"group_ids": ["grp-saved"]}
            timer = _recv(ws, "timer_start")["data"]
            assert timer["duration"] == 300
            assert 190 < timer["remaining"] <= 200
            assert timer["ends_at_ms"] > time.time() * 1000

    def test_paused_timer_is_restored(self, client, workspace_headers, sample_board):
        board_id = sample_board["id"]
        with _ws(client, board_id, workspace_headers) as ws:
            _send(ws, "timer_start", {"duration": 300, "remaining": 300})
            _recv(ws, "timer_start")
            _send(ws, "timer_pause", {"remaining": 120})
            _recv(ws, "timer_pause")
        manager.reset()
        with _ws(client, board_id, workspace_headers) as ws:
            assert _recv(ws, "timer_pause")["data"] == {"remaining": 120, "duration": 300}

    def test_expired_timer_is_not_restored(self, client, workspace_headers, sample_board, db_session):
        board = db_session.get(Board, sample_board["id"])
        board.session_state = json.dumps(
            {"timer": {"running": True, "duration": 60, "ends_at_ms": time.time() * 1000 - 5000}}
        )
        db_session.commit()
        manager.restore_state(sample_board["id"], json.loads(board.session_state))
        assert manager.get_timer(sample_board["id"]) is None

    def test_corrupted_state_is_ignored(self, client, workspace_headers, sample_board, db_session):
        """Повреждённая запись не должна мешать подключению к доске."""
        for raw in ("не json", '"строка"', '{"timer": {"running": true, "duration": "x", "ends_at_ms": []}}', '{"spotlight": 7}'):
            manager.reset()
            board = db_session.get(Board, sample_board["id"])
            board.session_state = raw
            db_session.commit()
            with _ws(client, sample_board["id"], workspace_headers) as ws:
                assert _recv(ws, "presence_update")
            assert manager.get_timer(sample_board["id"]) is None
            assert manager.get_spotlight(sample_board["id"]) is None

    def test_state_is_restored_once_and_does_not_override_live(
        self, client, workspace_headers, sample_board, db_session
    ):
        board_id = sample_board["id"]
        with _ws(client, board_id, workspace_headers) as ws:
            _send(ws, "timer_reset", {"duration": 60})
            _recv(ws, "timer_reset")
            # В БД оказалась устаревшая запись (например, сохранение не успело пройти)
            board = db_session.get(Board, board_id)
            board.session_state = json.dumps(
                {"timer": {"running": False, "duration": 999, "remaining": 999}, "spotlight": "старая"}
            )
            db_session.commit()
            # Второй участник подключается к живой доске: память главнее записи в БД
            with _ws(client, board_id, workspace_headers) as ws2:
                assert _recv(ws2, "timer_pause")["data"] == {"remaining": 60, "duration": 60}
            assert manager.get_spotlight(board_id) is None

    def test_session_end_clears_saved_state(self, client, workspace_headers, sample_board, db_session):
        board_id = sample_board["id"]
        with _ws(client, board_id, workspace_headers) as ws:
            _send(ws, "facilitator_start")
            _recv(ws, "facilitator_update")
            _send(ws, "timer_start", {"duration": 300, "remaining": 300})
            _recv(ws, "timer_start")
            _send(ws, "facilitator_stop")
            _recv(ws, "roti_requested")
        db_session.expire_all()
        assert db_session.get(Board, board_id).session_state is None

    def test_session_ids_do_not_collide_on_quick_restart(self, client, workspace_headers, sample_board):
        """Номер сессии в секундах совпадал при перезапуске в ту же секунду."""
        board_id = sample_board["id"]
        ids = []
        with _ws(client, board_id, workspace_headers) as ws:
            for _ in range(2):
                _send(ws, "facilitator_start")
                started = _recv(ws, "facilitator_update")
                while started["data"]["session_id"] is None:
                    started = _recv(ws, "facilitator_update")
                ids.append(started["data"]["session_id"])
                _send(ws, "facilitator_stop")
                _recv(ws, "roti_requested")
                time.sleep(0.005)
        assert ids[0] != ids[1]
        assert ids[0] > 2**31  # миллисекунды: в int4 не помещается, колонка — BigInteger


class TestStableOrder:
    def test_group_and_column_positions_after_deletion(self, client, workspace_headers, sample_board, db_session):
        """Позиция по количеству давала дубли после удаления из середины."""
        board = client.get(f"/api/boards/{sample_board['id']}", headers=workspace_headers).json()
        column_id = board["columns"][0]["id"]
        groups = [
            client.post("/api/groups/", json={"column_id": column_id, "title": f"Г{i}"}, headers=workspace_headers).json()
            for i in range(3)
        ]
        client.delete(f"/api/groups/{groups[0]['id']}", headers=workspace_headers)
        client.post("/api/groups/", json={"column_id": column_id, "title": "Новая"}, headers=workspace_headers)
        positions = [g.position for g in db_session.query(CardGroup).filter_by(column_id=column_id)]
        assert len(positions) == len(set(positions))

        client.delete(f"/api/columns/{board['columns'][1]['id']}", headers=workspace_headers)
        added = client.post(
            "/api/columns/", json={"board_id": board["id"], "title": "Новая колонка"}, headers=workspace_headers
        ).json()
        col_positions = [c.position for c in db_session.query(Column).filter_by(board_id=board["id"])]
        assert len(col_positions) == len(set(col_positions))
        assert added["position"] == max(col_positions)

    def test_equal_positions_have_deterministic_order(self, client, workspace_headers, sample_board, sample_column, db_session):
        """Старые данные с одинаковыми позициями должны отдаваться в одном и том же порядке."""
        from app.models import Card

        cards = [_card(client, workspace_headers, sample_column["id"], f"К{i}") for i in range(4)]
        for card in db_session.query(Card).filter_by(column_id=sample_column["id"]):
            card.position = 0
        db_session.commit()

        def order():
            board = client.get(f"/api/boards/{sample_board['id']}", headers=workspace_headers).json()
            return [c["id"] for c in board["columns"][0]["cards"]]

        first = order()
        assert first == [c["id"] for c in sorted(cards, key=lambda c: (c["created_at"], c["id"]))]
        assert all(order() == first for _ in range(3))
