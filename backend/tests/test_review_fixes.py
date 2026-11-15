"""Регрессии по итогам ревью ветки: обходы прав и приватности, отзыв доступа, лимиты входа.

Каждый тест повторяет сценарий, которым дефект был воспроизведён, и закрепляет исправление.
"""

import inspect

import bcrypt
import pytest
from starlette.websockets import WebSocketDisconnect

from app.limiter import limiter
from tests.conftest import login_headers, participant_id_of

ORIGIN = {"origin": "http://localhost:3000"}


def _board(client, headers, name="Доска", **extra):
    resp = client.post("/api/boards/", json={"name": name, **extra}, headers=headers)
    assert resp.status_code == 201, resp.text
    return resp.json()


def _card(client, headers, column_id, text="Карточка"):
    resp = client.post("/api/cards/", json={"column_id": column_id, "text": text}, headers=headers)
    assert resp.status_code == 201, resp.text
    return resp.json()


def _get_board(client, headers, board_id):
    resp = client.get(f"/api/boards/{board_id}", headers=headers)
    assert resp.status_code == 200, resp.text
    return resp.json()


def _cards(board):
    return [c for col in board["columns"] for c in col["cards"]]


def _ws(client, board_id, headers):
    return client.websocket_connect(
        f"/ws/{board_id}?workspace_token={headers['X-Workspace-Token']}", headers=ORIGIN
    )


def _team_ws(client, headers):
    return client.websocket_connect(
        f"/ws/workspace?workspace_token={headers['X-Workspace-Token']}", headers=ORIGIN
    )


def _recv(ws, event_name, max_messages=30):
    for _ in range(max_messages):
        msg = ws.receive_json()
        if msg["event"] == event_name:
            return msg
    raise AssertionError(f"'{event_name}' not received")


def _closed_with(ws) -> int:
    """Дочитать сокет до закрытия и вернуть код."""
    with pytest.raises(WebSocketDisconnect) as closed:
        for _ in range(30):
            ws.receive_json()
    return closed.value.code


@pytest.fixture()
def limiter_on():
    limiter.enabled = True
    limiter.reset()
    yield
    limiter.enabled = False
    limiter.reset()


class TestMergePermissions:
    def test_merge_refused_while_cards_are_hidden(self, client, workspace_headers, login_as):
        """Скрытый сбор: объединение склеило бы чужой скрытый текст в карточку вызывающего."""
        anya = login_as("Аня")
        board = _board(client, workspace_headers, "Скрытая", hide_cards_until_reveal=True)
        col = board["columns"][0]["id"]
        secret1 = _card(client, workspace_headers, col, "СЕКРЕТ-1 создателя")
        secret2 = _card(client, workspace_headers, col, "СЕКРЕТ-2 создателя")
        mine = _card(client, anya, col, "моя")

        resp = client.post(
            "/api/cards/merge",
            json={"card_ids": [mine["id"], secret1["id"], secret2["id"]]},
            headers=anya,
        )
        assert resp.status_code == 409
        assert "СЕКРЕТ" not in resp.text
        # Даже модератору: до раскрытия текста чужих карточек у него тоже нет
        own_merge = client.post(
            "/api/cards/merge",
            json={"card_ids": [secret1["id"], secret2["id"]]},
            headers=workspace_headers,
        )
        assert own_merge.status_code == 409
        after = _get_board(client, workspace_headers, board["id"])
        assert {c["id"] for c in _cards(after)} == {mine["id"], secret1["id"], secret2["id"]}

    def test_participant_cannot_merge_foreign_cards(self, client, workspace_headers, login_as):
        """Прямая правка и удаление чужого дают 403 — объединение не должно быть обходом."""
        anya = login_as("Аня")
        board = _board(client, workspace_headers, "Открытая")
        col = board["columns"][0]["id"]
        a = _card(client, workspace_headers, col, "карточка создателя A")
        b = _card(client, workspace_headers, col, "карточка создателя B")
        mine = _card(client, anya, col, "моя")

        for ids in ([a["id"], b["id"]], [mine["id"], a["id"]], [a["id"], mine["id"]]):
            resp = client.post(
                "/api/cards/merge",
                json={"card_ids": ids, "target_text": "переписано Аней"},
                headers=anya,
            )
            assert resp.status_code == 403, ids
        texts = sorted(c["text"] for c in _cards(_get_board(client, workspace_headers, board["id"])))
        assert texts == ["карточка создателя A", "карточка создателя B", "моя"]

    def test_own_cards_and_moderator_merge_still_work(self, client, workspace_headers, login_as):
        anya = login_as("Аня")
        board = _board(client, workspace_headers, "Объединение")
        col = board["columns"][0]["id"]
        first = _card(client, anya, col, "дубль раз")
        second = _card(client, anya, col, "дубль два")
        own = client.post(
            "/api/cards/merge", json={"card_ids": [first["id"], second["id"]]}, headers=anya
        )
        assert own.status_code == 200 and own.json()["text"] == "дубль раз\nдубль два"

        other = _card(client, workspace_headers, col, "карточка создателя")
        by_moderator = client.post(
            "/api/cards/merge",
            json={"card_ids": [other["id"], first["id"]]},
            headers=workspace_headers,
        )
        assert by_moderator.status_code == 200
        assert len(_cards(_get_board(client, workspace_headers, board["id"]))) == 1


class TestPrivacySettingsNeedModerator:
    def test_participant_cannot_reveal_through_settings(self, client, workspace_headers, login_as):
        anya = login_as("Аня")
        board = _board(client, workspace_headers, "Скрытая", hide_cards_until_reveal=True)
        _card(client, workspace_headers, board["columns"][0]["id"], "СЕКРЕТ создателя")
        assert client.post(f"/api/boards/{board['id']}/reveal", headers=anya).status_code == 403

        resp = client.patch(
            f"/api/boards/{board['id']}", json={"hide_cards_until_reveal": False}, headers=anya
        )
        assert resp.status_code == 403
        assert "СЕКРЕТ" not in resp.text
        seen = _get_board(client, anya, board["id"])
        assert seen["cards_hidden"] is True and _cards(seen)[0]["text"] == ""

    def test_participant_cannot_switch_anonymity_off(self, client, workspace_headers, login_as):
        anya = login_as("Аня")
        board = _board(client, workspace_headers, "Анонимная", anonymous_votes=True)
        card = _card(client, workspace_headers, board["columns"][0]["id"], "честное мнение")
        client.post(f"/api/cards/{card['id']}/like", headers=workspace_headers)

        resp = client.patch(
            f"/api/boards/{board['id']}", json={"anonymous_votes": False}, headers=anya
        )
        assert resp.status_code == 403
        seen = _cards(_get_board(client, anya, board["id"]))[0]
        assert (seen["author"], seen["author_id"], seen["likes"]) == ("Участник", None, ["anon"])

    def test_participant_cannot_switch_privacy_on_either(self, client, workspace_headers, login_as):
        anya = login_as("Аня")
        board = _board(client, workspace_headers, "Обычная")
        for change in ({"hide_cards_until_reveal": True}, {"anonymous_votes": True}):
            assert (
                client.patch(f"/api/boards/{board['id']}", json=change, headers=anya).status_code
                == 403
            )

    def test_other_settings_and_unchanged_privacy_stay_open(
        self, client, workspace_headers, login_as
    ):
        """Клиент шлёт настройки целиком: неизменённые флаги приватности — не повод для отказа."""
        anya = login_as("Аня")
        board = _board(client, workspace_headers, "Настройки", hide_cards_until_reveal=True)
        resp = client.patch(
            f"/api/boards/{board['id']}",
            json={"max_votes": 7, "hide_cards_until_reveal": True, "anonymous_votes": False},
            headers=anya,
        )
        assert resp.status_code == 200 and resp.json()["max_votes"] == 7

    def test_creator_and_facilitator_can_change_privacy(self, client, workspace_headers, login_as):
        anya = login_as("Аня")
        board = _board(client, workspace_headers, "Права", hide_cards_until_reveal=True)
        by_creator = client.patch(
            f"/api/boards/{board['id']}",
            json={"hide_cards_until_reveal": False},
            headers=workspace_headers,
        )
        assert by_creator.status_code == 200
        with _ws(client, board["id"], anya) as ws:
            ws.send_json({"event": "facilitator_start", "data": {}})
            _recv(ws, "cards_visibility_changed")
            by_facilitator = client.patch(
                f"/api/boards/{board['id']}", json={"anonymous_votes": True}, headers=anya
            )
            assert by_facilitator.status_code == 200

    def test_reveal_works_on_a_locked_board(self, client, workspace_headers):
        """Раскрытие не меняет содержимое: блокировка не должна оставлять карточки скрытыми навсегда."""
        board = _board(client, workspace_headers, "Архив", hide_cards_until_reveal=True)
        _card(client, workspace_headers, board["columns"][0]["id"], "Запись")
        client.patch(f"/api/boards/{board['id']}", json={"is_locked": True}, headers=workspace_headers)

        resp = client.post(f"/api/boards/{board['id']}/reveal", headers=workspace_headers)
        assert resp.status_code == 200 and resp.json()["cards_hidden"] is False


class TestHiddenCardTextOracle:
    def test_guessed_text_of_hidden_card_is_not_confirmed(
        self, client, workspace_headers, login_as
    ):
        anya = login_as("Аня")
        board = _board(client, workspace_headers, "Скрытая", hide_cards_until_reveal=True)
        card = _card(client, workspace_headers, board["columns"][0]["id"], "Уволить Петю")

        wrong = client.patch(f"/api/cards/{card['id']}", json={"text": "Повысить Петю"}, headers=anya)
        right = client.patch(f"/api/cards/{card['id']}", json={"text": "Уволить Петю"}, headers=anya)
        assert (wrong.status_code, right.status_code) == (403, 403)

    def test_unchanged_text_of_visible_foreign_card_is_still_accepted(
        self, client, workspace_headers, login_as
    ):
        """На открытой доске клиент присылает карточку целиком, меняя, например, цвет."""
        anya = login_as("Аня")
        board = _board(client, workspace_headers, "Открытая")
        card = _card(client, workspace_headers, board["columns"][0]["id"], "Текст")
        resp = client.patch(
            f"/api/cards/{card['id']}", json={"text": "Текст", "color": "#FFE4B5"}, headers=anya
        )
        assert resp.status_code == 200 and resp.json()["color"] == "#FFE4B5"


class TestEntryLimitsAreKeyedByAddress:
    """Каждый вход выдаёт новый токен: лимит по участнику обходился сменой токена."""

    def test_team_login_limit_survives_token_rotation(
        self, client, test_workspace, db_session, limiter_on
    ):
        from app.models import Workspace

        db_session.add(
            Workspace(
                id="victim",
                slug="victim-team",
                name="Victim",
                access_key_hash=bcrypt.hashpw(b"s3cret", bcrypt.gensalt(rounds=4)).decode(),
            )
        )
        db_session.commit()
        limiter.enabled = False
        tokens = [login_headers(client, "Атакующий") for _ in range(2)]
        client.post("/api/workspaces/logout", headers=tokens[1])
        client.cookies.clear()
        limiter.enabled = True
        limiter.reset()

        def attempt(headers, key):
            return client.post(
                "/api/workspaces/login",
                json={"workspace_slug": "victim-team", "access_key": key, "name": "x"},
                headers=headers,
            ).status_code

        anonymous = [attempt({}, f"guess-{i}") for i in range(31)]
        assert anonymous[:30] == [401] * 30 and anonymous[30] == 429
        # Свой токен, второй токен и отозванный токен квоту не обновляют
        assert [attempt(tokens[0], "a"), attempt(tokens[1], "b")] == [429, 429]

    def test_admin_login_limit_survives_token_rotation(self, client, test_workspace, limiter_on):
        limiter.enabled = False
        tokens = [login_headers(client, f"Атакующий {i}") for i in range(3)]
        limiter.enabled = True
        limiter.reset()

        def attempt(headers, password):
            return client.post(
                "/api/admin/login",
                json={"login": "testadmin", "password": password},
                headers=headers,
            ).status_code

        anonymous = [attempt({}, f"guess-{i}") for i in range(11)]
        assert anonymous[:10] == [401] * 10 and anonymous[10] == 429
        assert [attempt(headers, "guess") for headers in tokens] == [429, 429, 429]

    def test_join_limit_survives_token_chaining(self, client, test_workspace, limiter_on):
        """Цепочкой приглашений участники создавались без предела: каждый ответ давал новый токен."""
        limiter.enabled = False
        owner = login_headers(client, "Владелец")
        invite = client.get("/api/workspaces/invite", headers=owner).json()["invite_token"]
        limiter.enabled = True
        limiter.reset()

        headers: dict = {}
        codes = []
        for i in range(125):
            resp = client.post(
                "/api/workspaces/join",
                json={"invite_token": invite, "name": f"Бот {i}"},
                headers=headers,
            )
            codes.append(resp.status_code)
            if resp.status_code == 200:
                headers = {"X-Workspace-Token": resp.cookies["workspace_token"]}
            client.cookies.clear()
        assert codes[:120] == [200] * 120 and set(codes[120:]) == {429}

    def test_team_requests_are_still_keyed_by_participant(self, client, test_workspace, limiter_on):
        """Команда за одним адресом не делит общую квоту на обычную работу с доской."""
        from app.limiter import entry_limit_key, rate_limit_key

        limiter.enabled = False
        anna = login_headers(client, "Анна")
        limiter.enabled = True

        class _Request:
            def __init__(self, headers):
                self.headers = headers
                self.cookies = {}
                self.client = type("C", (), {"host": "10.0.0.1"})()

        with_session = _Request(anna)
        assert rate_limit_key(with_session) == f"participant:{participant_id_of(client, anna)}"
        assert entry_limit_key(with_session) == "10.0.0.1"


class TestRevokedAccessClosesSockets:
    def test_key_rotation_closes_board_and_team_sockets(
        self, client, workspace_headers, login_as, admin_headers, test_workspace
    ):
        """Сессия проверяется только при подключении — открытые сокеты нужно закрыть самим."""
        anya = login_as("Аня")
        board = _board(client, workspace_headers, "Отзыв")
        with _ws(client, board["id"], anya) as ws_board, _team_ws(client, anya) as ws_team:
            _recv(ws_board, "presence_update")
            resp = client.patch(
                f"/api/admin/workspaces/{test_workspace.id}",
                json={"access_key": "new-key-12345"},
                headers=admin_headers,
            )
            assert resp.status_code == 200, resp.text
            assert _closed_with(ws_board) == 1008
            assert _closed_with(ws_team) == 1008
        client.cookies.clear()
        assert client.get(f"/api/boards/{board['id']}", headers=anya).status_code == 401
        # Заново подключиться отозванной сессией нельзя
        with pytest.raises(WebSocketDisconnect):
            with _ws(client, board["id"], anya) as ws:
                ws.receive_json()

    def test_renaming_the_team_keeps_sockets_open(
        self, client, workspace_headers, admin_headers, test_workspace
    ):
        board = _board(client, workspace_headers, "Переименование")
        with _ws(client, board["id"], workspace_headers) as ws:
            _recv(ws, "presence_update")
            client.patch(
                f"/api/admin/workspaces/{test_workspace.id}",
                json={"name": "Новое имя"},
                headers=admin_headers,
            )
            ws.send_text("ping")
            assert _recv(ws, "pong")

    def test_logout_closes_the_team_socket_too(self, client, workspace_headers, login_as):
        anya = login_as("Аня")
        with _team_ws(client, anya) as ws_anya, _team_ws(client, workspace_headers) as ws_owner:
            assert client.post("/api/workspaces/logout", headers=anya).status_code == 204
            assert _closed_with(ws_anya) == 1008
            # Чужой сокет команды не тронут
            _board(client, workspace_headers, "После выхода")
            assert _recv(ws_owner, "board_created")["data"]["name"] == "После выхода"


class TestTypingDoesNotNameTheAuthor:
    def _typing_seen_by_other(self, client, owner, anya, **board_settings):
        board = _board(client, owner, "Набор текста", **board_settings)
        col = board["columns"][0]["id"]
        with _ws(client, board["id"], owner) as ws_owner, _ws(client, board["id"], anya) as ws_anya:
            _recv(ws_anya, "presence_update")
            ws_owner.send_json({"event": "card_typing", "data": {"column_id": col, "is_typing": True}})
            for_other = _recv(ws_anya, "typing_update")["data"]["typing"]
            for_self = _recv(ws_owner, "typing_update")["data"]["typing"]
        return col, for_other, for_self

    def test_anonymous_board_hides_who_is_typing(self, client, workspace_headers, login_as):
        owner_id = participant_id_of(client, workspace_headers)
        col, for_other, for_self = self._typing_seen_by_other(
            client, workspace_headers, login_as("Аня"), anonymous_votes=True
        )
        assert for_other == [{"participant_id": "anon-0", "username": "", "column_id": col}]
        # Сам печатающий свою запись получает как есть: клиент исключает её по идентификатору
        assert for_self == [{"participant_id": owner_id, "username": "Tester", "column_id": col}]

    def test_hidden_collection_hides_who_is_typing(self, client, workspace_headers, login_as):
        _col, for_other, _ = self._typing_seen_by_other(
            client, workspace_headers, login_as("Аня"), hide_cards_until_reveal=True
        )
        assert [(t["participant_id"], t["username"]) for t in for_other] == [("anon-0", "")]

    def test_open_board_still_names_the_typist(self, client, workspace_headers, login_as):
        owner_id = participant_id_of(client, workspace_headers)
        _col, for_other, _ = self._typing_seen_by_other(client, workspace_headers, login_as("Аня"))
        assert [(t["participant_id"], t["username"]) for t in for_other] == [(owner_id, "Tester")]

    def test_switching_anonymity_on_takes_effect_for_open_sockets(
        self, client, workspace_headers, login_as
    ):
        anya = login_as("Аня")
        board = _board(client, workspace_headers, "Переключение")
        col = board["columns"][0]["id"]
        with _ws(client, board["id"], workspace_headers) as ws_owner, _ws(
            client, board["id"], anya
        ) as ws_anya:
            _recv(ws_anya, "presence_update")
            client.patch(
                f"/api/boards/{board['id']}", json={"anonymous_votes": True}, headers=workspace_headers
            )
            ws_owner.send_json({"event": "card_typing", "data": {"column_id": col, "is_typing": True}})
            typing = _recv(ws_anya, "typing_update")["data"]["typing"]
        assert [(t["participant_id"], t["username"]) for t in typing] == [("anon-0", "")]

    def test_session_brainstorm_hides_and_reveal_phase_shows(
        self, client, workspace_headers, login_as
    ):
        """В «Штурме» карточки скрыты — имя печатающего тоже; с «Раскрытия» оно снова видно."""
        anya = login_as("Аня")
        owner_id = participant_id_of(client, workspace_headers)
        board = _board(client, workspace_headers, "Сессия")
        col = board["columns"][0]["id"]
        with _ws(client, board["id"], workspace_headers) as ws_owner, _ws(
            client, board["id"], anya
        ) as ws_anya:
            _recv(ws_anya, "presence_update")
            ws_owner.send_json({"event": "facilitator_start", "data": {}})
            _recv(ws_anya, "cards_visibility_changed")
            ws_owner.send_json({"event": "card_typing", "data": {"column_id": col, "is_typing": True}})
            hidden = _recv(ws_anya, "typing_update")["data"]["typing"]
            ws_owner.send_json({"event": "card_typing", "data": {"column_id": col, "is_typing": False}})
            _recv(ws_anya, "typing_update")
            ws_owner.send_json({"event": "phase_change", "data": {"phase": "reveal"}})
            _recv(ws_anya, "cards_visibility_changed")
            ws_owner.send_json({"event": "card_typing", "data": {"column_id": col, "is_typing": True}})
            shown = _recv(ws_anya, "typing_update")["data"]["typing"]
        assert [t["participant_id"] for t in hidden] == ["anon-0"]
        assert [t["participant_id"] for t in shown] == [owner_id]


class TestCursorsDoNotNameTheAuthor:
    """Подписанный курсор над формой колонки — тот же сигнал, что и «печатает»."""

    def _cursor_seen_by_other(self, client, owner, anya, **board_settings):
        board = _board(client, owner, "Курсоры", **board_settings)
        with _ws(client, board["id"], owner) as ws_owner, _ws(client, board["id"], anya) as ws_anya:
            _recv(ws_anya, "presence_update")
            ws_owner.send_json({"event": "cursor_move", "data": {"x": 0.42, "y": 0.13}})
            # Следом — событие, которое точно дойдёт: по нему видно, был ли перед ним курсор
            ws_owner.send_json({"event": "reaction", "data": {"emoji": "👍"}})
            events = []
            while not events or events[-1]["event"] != "reaction":
                events.append(ws_anya.receive_json())
        return [e for e in events if e["event"] == "cursor_move"]

    def test_no_cursors_on_anonymous_board(self, client, workspace_headers, login_as):
        assert self._cursor_seen_by_other(
            client, workspace_headers, login_as("Аня"), anonymous_votes=True
        ) == []

    def test_no_cursors_while_cards_are_hidden(self, client, workspace_headers, login_as):
        assert self._cursor_seen_by_other(
            client, workspace_headers, login_as("Аня"), hide_cards_until_reveal=True
        ) == []

    def test_cursors_still_work_on_open_board(self, client, workspace_headers, login_as):
        owner_id = participant_id_of(client, workspace_headers)
        cursors = self._cursor_seen_by_other(client, workspace_headers, login_as("Аня"))
        assert [(c["data"]["participant_id"], c["data"]["username"]) for c in cursors] == [
            (owner_id, "Tester")
        ]


class TestSessionEndResetsTimer:
    def test_timer_is_reset_for_everyone_when_session_stops(
        self, client, workspace_headers, login_as
    ):
        """Без события таймер шёл до нуля у тех, кто был на доске, и отсутствовал у вошедших позже."""
        anya = login_as("Аня")
        board = _board(client, workspace_headers, "Таймер")
        with _ws(client, board["id"], workspace_headers) as ws_owner, _ws(
            client, board["id"], anya
        ) as ws_anya:
            _recv(ws_anya, "presence_update")
            ws_owner.send_json({"event": "facilitator_start", "data": {}})
            ws_owner.send_json(
                {"event": "timer_start", "data": {"duration": 300, "remaining": 300}}
            )
            _recv(ws_anya, "timer_start")
            ws_owner.send_json({"event": "facilitator_stop", "data": {}})
            assert _recv(ws_anya, "timer_reset")["data"] == {"duration": 300}
        # Вошедший после завершения таймера не получает — как и те, кому пришёл сброс
        with _ws(client, board["id"], anya) as ws_late:
            events = []
            while "presence_update" not in events:
                events.append(ws_late.receive_json()["event"])
            assert not [e for e in events if e.startswith("timer_")]

    def test_stop_without_timer_sends_no_reset(self, client, workspace_headers):
        board = _board(client, workspace_headers, "Без таймера")
        with _ws(client, board["id"], workspace_headers) as ws:
            ws.send_json({"event": "facilitator_start", "data": {}})
            ws.send_json({"event": "facilitator_stop", "data": {}})
            events = []
            while "roti_requested" not in events and len(events) < 30:
                events.append(ws.receive_json()["event"])
            assert "timer_reset" not in events


class TestLivenessDoesNotWaitForThreads:
    def test_health_is_a_coroutine(self):
        """Обычная функция ждала бы поток из общего пула вместе с запросами, зависшими на базе."""
        import main

        assert inspect.iscoroutinefunction(main.health)
        assert not inspect.iscoroutinefunction(main.ready)
