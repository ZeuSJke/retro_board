"""Серверная личность участника: вход, права, скрытый сбор, анонимность, приглашения.

Каждый тест закрепляет сценарий, найденный при ревью: раньше сервер верил
имени из запроса, а скрытие карточек и анонимность существовали только в интерфейсе.
"""

import json
from datetime import UTC, datetime, timedelta
from unittest.mock import patch

import jwt
import pytest

from app import workspace_auth
from app.config import settings
from app.limiter import rate_limit_key
from app.models import Board, Card, Column
from tests.conftest import login_headers, participant_id_of

TEST_ORIGIN = "http://localhost:3000"


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


def _cards(board: dict) -> list[dict]:
    return [card for col in board["columns"] for card in col["cards"]]


def _ws(client, board_id, headers):
    return client.websocket_connect(
        f"/ws/{board_id}?workspace_token={headers['X-Workspace-Token']}",
        headers={"origin": TEST_ORIGIN},
    )


def _recv(ws, event_name, max_messages=20):
    for _ in range(max_messages):
        msg = ws.receive_json()
        if msg["event"] == event_name:
            return msg
    raise AssertionError(f"'{event_name}' not received")


# ── Вход и сессия ────────────────────────────────────────────────────────────


class TestSession:
    def test_login_creates_participant_with_given_name(self, client, test_workspace):
        resp = client.post(
            "/api/workspaces/login",
            json={"workspace_slug": "test-team", "access_key": "testkey123", "name": "  Аня  "},
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["participant"]["name"] == "Аня"
        assert body["participant"]["id"]

    def test_namesakes_are_different_participants(self, client, login_as):
        """Вариант А: тот, кто назвался чужим именем, — новый участник, а не коллега."""
        first, second = login_as("Саша"), login_as("Саша")
        assert participant_id_of(client, first) != participant_id_of(client, second)

    def test_name_with_html_is_rejected(self, client, test_workspace):
        resp = client.post(
            "/api/workspaces/login",
            json={"workspace_slug": "test-team", "access_key": "testkey123", "name": "<b>x</b>"},
        )
        assert resp.status_code == 422

    def test_unknown_team_and_wrong_key_look_the_same(self, client, test_workspace):
        """Ответ не выдаёт, существует ли команда с таким кодом."""
        wrong_key = client.post(
            "/api/workspaces/login", json={"workspace_slug": "test-team", "access_key": "нет"}
        )
        no_team = client.post(
            "/api/workspaces/login", json={"workspace_slug": "no-such-team", "access_key": "нет"}
        )
        assert wrong_key.status_code == no_team.status_code == 401
        assert wrong_key.json() == no_team.json()

    def test_me_returns_participant_and_capabilities(self, client, workspace_headers):
        with patch.object(settings, "ai_base_url", ""):
            me = client.get("/api/workspaces/me", headers=workspace_headers).json()
        assert me["participant"]["name"] == "Tester"
        assert me["slug"] == "test-team"
        assert me["ai_enabled"] is False
        with patch.object(settings, "ai_base_url", "http://llm.test/v1"):
            assert client.get("/api/workspaces/me", headers=workspace_headers).json()["ai_enabled"]

    def test_me_renews_an_aging_session(self, client, workspace_headers, monkeypatch):
        fresh = client.get("/api/workspaces/me", headers=workspace_headers)
        assert "workspace_token=" not in fresh.headers.get("set-cookie", "")

        monkeypatch.setattr(workspace_auth, "SESSION_RENEW_AFTER", timedelta(0))
        renewed = client.get("/api/workspaces/me", headers=workspace_headers)
        assert "workspace_token=" in renewed.headers["set-cookie"]
        client.cookies.clear()

    def test_logout_clears_cookie(self, client, test_workspace):
        resp = client.post("/api/workspaces/logout")
        assert resp.status_code == 204
        cookie = resp.headers["set-cookie"]
        assert cookie.startswith('workspace_token=""') or cookie.startswith("workspace_token=;")
        assert "Max-Age=0" in cookie

    def test_logout_ends_the_session_on_the_server(self, client, test_workspace):
        """После выхода токен не принимается, даже если его сохранили."""
        anna = login_headers(client, "Анна")
        boris = login_headers(client, "Борис")
        assert client.get("/api/boards/", headers=anna).status_code == 200

        assert client.post("/api/workspaces/logout", headers=anna).status_code == 204

        assert client.get("/api/boards/", headers=anna).status_code == 401
        assert client.get("/api/workspaces/me", headers=anna).status_code == 401
        # Чужая сессия не затронута
        assert client.get("/api/boards/", headers=boris).status_code == 200
        # Повторный выход тем же токеном — не ошибка
        assert client.post("/api/workspaces/logout", headers=anna).status_code == 204

    def test_logout_by_cookie_ends_that_session(self, client, test_workspace):
        resp = client.post(
            "/api/workspaces/login",
            json={"workspace_slug": "test-team", "access_key": "testkey123", "name": "Вера"},
        )
        token = resp.cookies["workspace_token"]
        # Тестовый клиент ходит по http и сам Secure-cookie не возвращает — кладём явно
        client.cookies.clear()
        client.cookies.set("workspace_token", token)
        assert client.get("/api/workspaces/me").status_code == 200

        assert client.post("/api/workspaces/logout").status_code == 204
        client.cookies.clear()

        assert client.get("/api/workspaces/me", headers={"X-Workspace-Token": token}).status_code == 401

    def test_logout_without_session_is_harmless(self, client, test_workspace):
        boris = login_headers(client, "Борис")
        for headers in ({}, {"X-Workspace-Token": "not.a.token"}):
            assert client.post("/api/workspaces/logout", headers=headers).status_code == 204
        assert client.get("/api/boards/", headers=boris).status_code == 200

    def test_cards_stay_with_the_participant_after_logout(self, client, test_workspace):
        """Выход не стирает сделанное: карточка остаётся с автором."""
        anna = login_headers(client, "Анна")
        anna_id = participant_id_of(client, anna)
        board = client.post("/api/boards/", json={"name": "Спринт"}, headers=anna).json()
        column = board["columns"][0]["id"]
        card = client.post(
            "/api/cards/", json={"column_id": column, "text": "Моя карточка"}, headers=anna
        ).json()

        client.post("/api/workspaces/logout", headers=anna)

        boris = login_headers(client, "Борис")
        seen = client.get(f"/api/boards/{board['id']}", headers=boris).json()
        cards = [c for col in seen["columns"] for c in col["cards"]]
        assert [(c["id"], c["author_id"], c["author"]) for c in cards] == [
            (card["id"], anna_id, "Анна")
        ]

    def test_token_issued_before_participants_is_rejected(self, client, test_workspace):
        """Старый токен личности не несёт: разовый повторный вход после обновления."""
        legacy = jwt.encode(
            {
                "workspace_id": test_workspace.id,
                "workspace_slug": test_workspace.slug,
                "workspace_name": test_workspace.name,
                "exp": datetime.now(UTC) + timedelta(hours=1),
            },
            settings.workspace_jwt_secret,
            algorithm="HS256",
        )
        resp = client.get("/api/boards/", headers={"X-Workspace-Token": legacy})
        assert resp.status_code == 401

    def test_token_of_another_team_participant_is_rejected(self, client, test_workspace, db_session):
        """Подписанный токен с участником из другой команды не открывает эту."""
        from app.models import Participant, Workspace

        other = Workspace(id="other-ws", slug="other", name="Другая", access_key_hash="x")
        db_session.add(other)
        db_session.commit()
        stranger = Participant(workspace_id=other.id, name="Чужой")
        db_session.add(stranger)
        db_session.commit()
        forged = workspace_auth.create_workspace_token(
            test_workspace.id, test_workspace.slug, test_workspace.name, stranger.id
        )
        resp = client.get("/api/boards/", headers={"X-Workspace-Token": forged})
        assert resp.status_code == 401

    def test_key_rotation_revokes_sessions_and_invite(
        self, client, admin_headers, test_workspace, workspace_headers
    ):
        invite = client.get("/api/workspaces/invite", headers=workspace_headers).json()["invite_token"]
        assert client.get("/api/boards/", headers=workspace_headers).status_code == 200

        resp = client.patch(
            f"/api/admin/workspaces/{test_workspace.id}",
            json={"access_key": "new-key-12345"},
            headers=admin_headers,
        )
        assert resp.status_code == 200

        # Ушедший участник больше не имеет доступа: ни по сессии, ни по старой ссылке
        assert client.get("/api/boards/", headers=workspace_headers).status_code == 401
        assert client.get(f"/api/workspaces/invite/{invite}").status_code == 404
        # Вход с новым ключом работает
        assert login_headers(client, "Аня", key="new-key-12345")

    def test_rename_without_key_change_keeps_sessions(
        self, client, admin_headers, test_workspace, workspace_headers
    ):
        resp = client.patch(
            f"/api/admin/workspaces/{test_workspace.id}",
            json={"name": "Новое имя"},
            headers=admin_headers,
        )
        assert resp.status_code == 200
        assert client.get("/api/boards/", headers=workspace_headers).status_code == 200


class TestRateLimitKey:
    def _request(self, headers: dict):
        from starlette.requests import Request

        raw = [(k.lower().encode(), v.encode()) for k, v in headers.items()]
        return Request({"type": "http", "headers": raw, "client": ("10.0.0.7", 1234)})

    def test_participants_behind_one_address_have_separate_quotas(self, client, login_as):
        """Команда за одним NAT раньше делила одну квоту на всех."""
        anya, oleg = login_as("Аня"), login_as("Олег")
        key_anya = rate_limit_key(self._request(anya))
        key_oleg = rate_limit_key(self._request(oleg))
        assert key_anya.startswith("participant:") and key_oleg.startswith("participant:")
        assert key_anya != key_oleg

    def test_requests_without_session_are_keyed_by_address(self):
        assert rate_limit_key(self._request({})) == "10.0.0.7"
        assert rate_limit_key(self._request({"X-Workspace-Token": "мусор"})) == "10.0.0.7"


# ── Имя — подпись, а не личность ─────────────────────────────────────────────


class TestRename:
    def test_rename_keeps_cards_votes_and_mood(self, client, workspace_headers, sample_board):
        """Раньше смена имени отвязывала от своих карточек и обнуляла лимит голосов."""
        board_id = sample_board["id"]
        client.patch(f"/api/boards/{board_id}", json={"max_votes": 1}, headers=workspace_headers)
        column = _get_board(client, workspace_headers, board_id)["columns"][0]
        card = _card(client, workspace_headers, column["id"], "Моя карточка")
        assert client.post(f"/api/cards/{card['id']}/like", headers=workspace_headers).status_code == 200
        client.post(f"/api/boards/{board_id}/mood", json={"score": 4}, headers=workspace_headers)

        resp = client.patch(
            "/api/workspaces/me/participant", json={"name": "Кирилл Б"}, headers=workspace_headers
        )
        assert resp.status_code == 200

        board = _get_board(client, workspace_headers, board_id)
        mine = _cards(board)[0]
        me = participant_id_of(client, workspace_headers)
        assert mine["author"] == "Кирилл Б" and mine["author_id"] == me
        assert mine["likes"] == [me]
        assert board["moods"][0]["author"] == "Кирилл Б" and board["moods"][0]["mine"] is True

        # Лимит голосов не обнулился: второй голос по-прежнему недоступен
        other = _card(client, workspace_headers, column["id"], "Вторая")
        assert client.post(f"/api/cards/{other['id']}/like?action=add", headers=workspace_headers).status_code == 403
        # Свою карточку по-прежнему можно править
        edit = client.patch(f"/api/cards/{card['id']}", json={"text": "Правка"}, headers=workspace_headers)
        assert edit.status_code == 200

    def test_empty_name_is_rejected(self, client, workspace_headers):
        resp = client.patch("/api/workspaces/me/participant", json={"name": ""}, headers=workspace_headers)
        assert resp.status_code == 422


# ── Голоса ───────────────────────────────────────────────────────────────────


class TestVotes:
    def test_username_parameter_cannot_vote_for_someone_else(
        self, client, workspace_headers, login_as, sample_card
    ):
        """Раньше ?username=Олег ставил и снимал голос от чужого имени."""
        oleg = login_as("Олег")
        client.post(f"/api/cards/{sample_card['id']}/like", headers=oleg)

        resp = client.post(
            f"/api/cards/{sample_card['id']}/like",
            params={"username": "Олег", "action": "remove"},
            headers=workspace_headers,
        )
        assert resp.status_code == 200
        assert resp.json()["likes"] == [participant_id_of(client, oleg)]

    def test_vote_budget_is_per_participant(self, client, workspace_headers, login_as, sample_board):
        """Раньше 12 голосов при лимите 5 набирались простой сменой имени в запросе."""
        board_id = sample_board["id"]
        client.patch(f"/api/boards/{board_id}", json={"max_votes": 2}, headers=workspace_headers)
        column = _get_board(client, workspace_headers, board_id)["columns"][0]
        cards = [_card(client, workspace_headers, column["id"], f"К{i}") for i in range(3)]

        codes = [
            client.post(
                f"/api/cards/{card['id']}/like", params={"username": f"вымышленный-{i}"}, headers=workspace_headers
            ).status_code
            for i, card in enumerate(cards)
        ]
        assert codes == [200, 200, 403]

        # У другого участника свой бюджет
        anya = login_as("Аня")
        assert client.post(f"/api/cards/{cards[2]['id']}/like", headers=anya).status_code == 200

    def test_reset_votes_only_touches_own(self, client, workspace_headers, login_as, sample_card, sample_board):
        oleg = login_as("Олег")
        client.post(f"/api/cards/{sample_card['id']}/like", headers=oleg)
        client.post(f"/api/cards/{sample_card['id']}/like", headers=workspace_headers)

        resp = client.post(
            f"/api/boards/{sample_board['id']}/reset-votes",
            params={"username": "Олег"},
            headers=workspace_headers,
        )
        assert resp.status_code == 200
        assert resp.json()["updated_cards"] == 1
        likes = _cards(_get_board(client, oleg, sample_board["id"]))[0]["likes"]
        assert likes == [participant_id_of(client, oleg)]

    def test_legacy_name_votes_count_but_belong_to_nobody(
        self, client, workspace_headers, sample_card, sample_board, db_session
    ):
        """Голоса, записанные именами до обновления, остаются в счёте."""
        card = db_session.get(Card, sample_card["id"])
        card.likes = ["Tester", "Аня"]
        db_session.commit()

        board = _get_board(client, workspace_headers, sample_board["id"])
        assert _cards(board)[0]["likes"] == ["Tester", "Аня"]
        # Имя «Tester» не равно личности участника: свой голос он ставит заново
        resp = client.post(f"/api/cards/{sample_card['id']}/like", headers=workspace_headers)
        assert len(resp.json()["likes"]) == 3


# ── Права ────────────────────────────────────────────────────────────────────


class TestCardRights:
    def test_only_author_edits_text(self, client, workspace_headers, login_as, sample_card):
        anya = login_as("Аня")
        resp = client.patch(f"/api/cards/{sample_card['id']}", json={"text": "Чужая правка"}, headers=anya)
        assert resp.status_code == 403
        # Оформление и группировка остаются общими
        recolor = client.patch(f"/api/cards/{sample_card['id']}", json={"color": "#E3F2FD"}, headers=anya)
        assert recolor.status_code == 200
        assert recolor.json()["text"] == "Test card"

    def test_stranger_cannot_delete_but_board_creator_can(self, client, workspace_headers, login_as, sample_column):
        anya, oleg = login_as("Аня"), login_as("Олег")
        card = _card(client, anya, sample_column["id"], "Карточка Ани")

        assert client.delete(f"/api/cards/{card['id']}", headers=oleg).status_code == 403
        bulk = client.post("/api/cards/bulk-delete", json={"card_ids": [card["id"]]}, headers=oleg)
        assert bulk.status_code == 403
        # Создатель доски модерирует
        assert client.delete(f"/api/cards/{card['id']}", headers=workspace_headers).status_code == 204

    def test_author_deletes_own_card(self, client, login_as, sample_column):
        anya = login_as("Аня")
        card = _card(client, anya, sample_column["id"])
        assert client.delete(f"/api/cards/{card['id']}", headers=anya).status_code == 204

    def test_facilitator_moderates_cards(self, client, login_as, sample_column, sample_board, db_session):
        anya, oleg = login_as("Аня"), login_as("Олег")
        card = _card(client, anya, sample_column["id"])
        board = db_session.get(Board, sample_board["id"])
        board.active_facilitator_id = participant_id_of(client, oleg)
        board.active_phase = "discuss"
        db_session.commit()
        assert client.delete(f"/api/cards/{card['id']}", headers=oleg).status_code == 204

    def test_legacy_card_without_author_is_editable_by_anyone(
        self, client, login_as, sample_card, db_session
    ):
        card = db_session.get(Card, sample_card["id"])
        card.author_id = None
        db_session.commit()
        anya = login_as("Аня")
        assert client.patch(f"/api/cards/{sample_card['id']}", json={"text": "Правка"}, headers=anya).status_code == 200
        assert client.delete(f"/api/cards/{sample_card['id']}", headers=anya).status_code == 204


class TestBoardRights:
    def test_only_creator_or_facilitator_deletes_board(
        self, client, workspace_headers, login_as, sample_board, db_session
    ):
        anya = login_as("Аня")
        assert client.delete(f"/api/boards/{sample_board['id']}", headers=anya).status_code == 403

        board = db_session.get(Board, sample_board["id"])
        board.active_facilitator_id = participant_id_of(client, anya)
        db_session.commit()
        assert client.delete(f"/api/boards/{sample_board['id']}", headers=anya).status_code == 204

    def test_creator_deletes_board(self, client, workspace_headers, sample_board):
        assert sample_board["created_by_id"] == participant_id_of(client, workspace_headers)
        assert client.delete(f"/api/boards/{sample_board['id']}", headers=workspace_headers).status_code == 204

    def test_legacy_board_without_creator_is_managed_by_anyone(
        self, client, login_as, sample_board, db_session
    ):
        board = db_session.get(Board, sample_board["id"])
        board.created_by_id = None
        db_session.commit()
        assert client.delete(f"/api/boards/{sample_board['id']}", headers=login_as("Аня")).status_code == 204

    def test_column_with_cards_needs_moderator(self, client, workspace_headers, login_as, sample_board):
        anya = login_as("Аня")
        columns = _get_board(client, workspace_headers, sample_board["id"])["columns"]
        _card(client, anya, columns[0]["id"])
        assert client.delete(f"/api/columns/{columns[0]['id']}", headers=anya).status_code == 403
        # Пустую колонку убрать может любой
        assert client.delete(f"/api/columns/{columns[1]['id']}", headers=anya).status_code == 204
        assert client.delete(f"/api/columns/{columns[0]['id']}", headers=workspace_headers).status_code == 204


# ── Скрытый сбор ─────────────────────────────────────────────────────────────


class TestHiddenCollection:
    def _setup(self, client, owner, other):
        board = _board(client, owner, "Скрытый сбор", hide_cards_until_reveal=True)
        column = board["columns"][0]["id"]
        mine = _card(client, owner, column, "Секрет владельца")
        theirs = _card(client, other, column, "Секрет Ани")
        return board, mine, theirs

    def test_other_cards_are_masked_until_reveal(self, client, workspace_headers, login_as):
        """Раньше GET /api/boards/{id} отдавал тексты всем, а скрывал их только интерфейс."""
        anya = login_as("Аня")
        board, mine, theirs = self._setup(client, workspace_headers, anya)

        seen = _get_board(client, workspace_headers, board["id"])
        assert seen["cards_hidden"] is True
        by_id = {c["id"]: c for c in _cards(seen)}
        assert by_id[mine["id"]]["text"] == "Секрет владельца" and by_id[mine["id"]]["masked"] is False
        hidden = by_id[theirs["id"]]
        assert hidden["masked"] is True
        assert (hidden["text"], hidden["author"], hidden["author_id"], hidden["likes"]) == ("", "", None, [])
        assert "Секрет Ани" not in json.dumps(seen, ensure_ascii=False)

        # Аня видит свою и не видит чужую — зеркально
        hers = {c["id"]: c for c in _cards(_get_board(client, anya, board["id"]))}
        assert hers[theirs["id"]]["text"] == "Секрет Ани"
        assert hers[mine["id"]]["masked"] is True

    def test_card_responses_do_not_leak_hidden_text(self, client, workspace_headers, login_as):
        anya = login_as("Аня")
        board, _mine, theirs = self._setup(client, workspace_headers, anya)
        column2 = board["columns"][1]["id"]
        moved = client.post(
            f"/api/cards/{theirs['id']}/move", json={"column_id": column2, "position": 0}, headers=workspace_headers
        )
        assert moved.status_code == 200
        assert moved.json()["masked"] is True and moved.json()["text"] == ""
        liked = client.post(f"/api/cards/{theirs['id']}/like", headers=workspace_headers)
        assert liked.json()["text"] == ""

    def test_only_moderator_reveals(self, client, workspace_headers, login_as):
        anya = login_as("Аня")
        board, _mine, theirs = self._setup(client, workspace_headers, anya)
        assert client.post(f"/api/boards/{board['id']}/reveal", headers=anya).status_code == 403

        revealed = client.post(f"/api/boards/{board['id']}/reveal", headers=workspace_headers)
        assert revealed.status_code == 200
        body = revealed.json()
        assert body["cards_hidden"] is False and body["cards_revealed"] is True
        assert {c["id"]: c["text"] for c in _cards(body)}[theirs["id"]] == "Секрет Ани"
        assert _get_board(client, anya, board["id"])["cards_hidden"] is False

    def test_enabling_hide_again_starts_a_new_collection(self, client, workspace_headers, login_as):
        anya = login_as("Аня")
        board, _mine, _theirs = self._setup(client, workspace_headers, anya)
        client.post(f"/api/boards/{board['id']}/reveal", headers=workspace_headers)
        client.patch(f"/api/boards/{board['id']}", json={"hide_cards_until_reveal": False}, headers=workspace_headers)
        again = client.patch(
            f"/api/boards/{board['id']}", json={"hide_cards_until_reveal": True}, headers=workspace_headers
        )
        assert again.json()["cards_hidden"] is True and again.json()["cards_revealed"] is False

    def test_brainstorm_phase_hides_and_later_phases_keep_revealed(
        self, client, workspace_headers, login_as, sample_board, sample_column, db_session
    ):
        """После завершения сессии карточки раньше скрывались снова."""
        anya = login_as("Аня")
        theirs = _card(client, anya, sample_column["id"], "Карточка Ани")
        board = db_session.get(Board, sample_board["id"])
        board.hide_cards_until_reveal = True
        board.active_phase = "brainstorm"
        db_session.commit()
        assert _get_board(client, workspace_headers, sample_board["id"])["cards_hidden"] is True

        # Ведущий перешёл к «Раскрытию», затем сессия завершилась
        board.active_phase = "reveal"
        board.cards_revealed = True
        db_session.commit()
        assert _get_board(client, workspace_headers, sample_board["id"])["cards_hidden"] is False
        board.active_phase = None
        db_session.commit()
        seen = _get_board(client, workspace_headers, sample_board["id"])
        assert seen["cards_hidden"] is False
        assert {c["id"]: c["text"] for c in _cards(seen)}[theirs["id"]] == "Карточка Ани"

    def test_reveal_is_refused_during_session(self, client, workspace_headers, sample_board, db_session):
        board = db_session.get(Board, sample_board["id"])
        board.active_phase = "brainstorm"
        db_session.commit()
        assert client.post(f"/api/boards/{sample_board['id']}/reveal", headers=workspace_headers).status_code == 409

    def test_ai_endpoints_refuse_while_hidden(self, client, workspace_headers, login_as):
        """Группировка, подбор задач и итоги читают все тексты — до раскрытия они выдали бы скрытое."""
        anya = login_as("Аня")
        board, _mine, _theirs = self._setup(client, workspace_headers, anya)
        column = board["columns"][0]["id"]
        with patch.object(settings, "ai_base_url", "http://llm.test/v1"):
            preview = client.post(
                "/api/groups/auto-cluster-preview", json={"column_id": column}, headers=workspace_headers
            )
            suggest = client.post(
                "/api/action-items/suggest", json={"board_id": board["id"]}, headers=workspace_headers
            )
            summary = client.post(f"/api/boards/{board['id']}/summary/regenerate", headers=workspace_headers)
        assert (preview.status_code, suggest.status_code, summary.status_code) == (409, 409, 409)

    def test_hidden_cards_do_not_reach_insights(self, client, workspace_headers, login_as):
        anya = login_as("Аня")
        self._setup(client, workspace_headers, anya)
        captured = {}

        def fake_insights(snapshot, *args, **kwargs):
            captured["snapshot"] = snapshot
            return {"summary_text": "ок", "recurring_themes": [], "recommendations": [], "boards_analyzed": 1}

        with patch("app.routers.boards.generate_workspace_insights", fake_insights):
            assert client.post("/api/boards/workspace-insights", headers=workspace_headers).status_code == 200
        assert captured["snapshot"][0]["top_cards"] == []

    def test_live_events_are_built_per_recipient(self, client, workspace_headers, login_as):
        """Событие о новой карточке автору приходит целиком, остальным — без текста."""
        anya = login_as("Аня")
        board = _board(client, workspace_headers, "Живой сбор", hide_cards_until_reveal=True)
        column = board["columns"][0]["id"]
        with _ws(client, board["id"], workspace_headers) as ws_owner, _ws(client, board["id"], anya) as ws_anya:
            created = _card(client, anya, column, "Только для Ани")
            for_owner = _recv(ws_owner, "card_created")["data"]
            for_author = _recv(ws_anya, "card_created")["data"]
            assert for_owner["id"] == created["id"]
            assert for_owner["masked"] is True and for_owner["text"] == "" and for_owner["author"] == ""
            assert for_author["masked"] is False and for_author["text"] == "Только для Ани"

            client.post(f"/api/boards/{board['id']}/reveal", headers=workspace_headers)
            _recv(ws_anya, "cards_visibility_changed")
            _recv(ws_owner, "cards_visibility_changed")
            texts = {c["id"]: c["text"] for c in _cards(_get_board(client, workspace_headers, board["id"]))}
            assert texts[created["id"]] == "Только для Ани"

    def test_anonymity_switch_tells_clients_to_reload(self, client, workspace_headers, login_as):
        """Анонимность меняет имена и голоса у каждого получателя — одного board_updated мало."""
        anya = login_as("Аня")
        board = _board(client, workspace_headers, "Анонимность")
        with _ws(client, board["id"], anya) as ws_anya:
            resp = client.patch(
                f"/api/boards/{board['id']}", json={"anonymous_votes": True}, headers=workspace_headers
            )
            assert resp.status_code == 200
            _recv(ws_anya, "cards_visibility_changed")

            # Правка, не затрагивающая видимость, лишнего перечитывания не вызывает
            client.patch(f"/api/boards/{board['id']}", json={"max_votes": 7}, headers=workspace_headers)
            client.patch(
                f"/api/boards/{board['id']}", json={"anonymous_votes": False}, headers=workspace_headers
            )
            events = []
            while "cards_visibility_changed" not in events:
                events.append(ws_anya.receive_json()["event"])
            # board_updated приходит дважды на правку (канал команды и канал доски);
            # будь у правки max_votes своё событие видимости, цикл оборвался бы раньше
            assert events == ["board_updated"] * 4 + ["cards_visibility_changed"]

    def test_session_brainstorm_masks_live_and_reveal_phase_opens(self, client, workspace_headers, login_as):
        anya = login_as("Аня")
        board = _board(client, workspace_headers, "Сессия")
        column = board["columns"][0]["id"]
        with _ws(client, board["id"], workspace_headers) as ws_fac, _ws(client, board["id"], anya) as ws_anya:
            ws_fac.send_text(json.dumps({"event": "facilitator_start", "data": {}}))
            _recv(ws_anya, "cards_visibility_changed")
            _recv(ws_fac, "cards_visibility_changed")

            created = _card(client, anya, column, "В штурме")
            assert _recv(ws_fac, "card_created")["data"]["masked"] is True
            assert _cards(_get_board(client, workspace_headers, board["id"]))[0]["masked"] is True

            ws_fac.send_text(json.dumps({"event": "phase_change", "data": {"phase": "reveal"}}))
            _recv(ws_fac, "cards_visibility_changed")
            opened = _get_board(client, workspace_headers, board["id"])
            assert opened["cards_revealed"] is True
            assert _cards(opened)[0]["text"] == "В штурме"

            # Завершение сессии ничего не прячет обратно
            ws_fac.send_text(json.dumps({"event": "facilitator_stop", "data": {}}))
            _recv(ws_fac, "cards_visibility_changed")
            assert _get_board(client, anya, board["id"])["cards_hidden"] is False
        assert created["id"]


# ── Анонимный режим ──────────────────────────────────────────────────────────


class TestAnonymousMode:
    def test_authors_and_voters_are_hidden_from_others(self, client, workspace_headers, login_as):
        """Раньше флаг только прятал имена в интерфейсе: API отдавал автора и голосовавших."""
        anya = login_as("Аня")
        board = _board(client, workspace_headers, "Анонимная", anonymous_votes=True)
        column = board["columns"][0]["id"]
        theirs = _card(client, anya, column, "От Ани")
        client.post(f"/api/cards/{theirs['id']}/like", headers=anya)
        client.post(f"/api/cards/{theirs['id']}/like", headers=workspace_headers)
        client.post(f"/api/boards/{board['id']}/mood", json={"score": 2}, headers=anya)

        me = participant_id_of(client, workspace_headers)
        seen = _get_board(client, workspace_headers, board["id"])
        card = _cards(seen)[0]
        assert card["text"] == "От Ани"
        assert card["author"] == "Участник" and card["author_id"] is None
        assert sorted(card["likes"]) == sorted(["anon", me])
        mood = seen["moods"][0]
        assert mood["author"] == "Участник" and mood["participant_id"] is None and mood["mine"] is False
        dump = json.dumps(seen, ensure_ascii=False)
        assert "Аня" not in dump and participant_id_of(client, anya) not in dump

        # Автор видит свою карточку своей
        hers = _cards(_get_board(client, anya, board["id"]))[0]
        assert hers["author"] == "Аня" and hers["author_id"] == participant_id_of(client, anya)

    def test_authors_do_not_reach_the_model(self, client, workspace_headers, login_as):
        """Автор карточки раньше уходил в запрос к модели и мог всплыть в итогах и задачах."""
        anya = login_as("Аня")
        board = _board(client, workspace_headers, "Анонимная для модели", anonymous_votes=True)
        _card(client, anya, board["columns"][0]["id"], "От Ани")
        captured = {}

        def fake_summary(board_data):
            captured["summary"] = json.dumps(board_data, ensure_ascii=False, default=str)
            return {"summary_text": "ок", "key_themes": [], "recommendations": []}

        def fake_suggest(cards):
            captured["suggest"] = json.dumps(cards, ensure_ascii=False)
            return []

        with (
            patch.object(settings, "ai_base_url", "http://llm.test/v1"),
            patch("app.routers.boards.generate_summary", fake_summary),
            patch("app.ai.prompts.action_item_suggestions.suggest_action_items_from_cards", fake_suggest),
        ):
            assert client.post(
                f"/api/boards/{board['id']}/summary/regenerate", headers=workspace_headers
            ).status_code == 200
            assert client.post(
                "/api/action-items/suggest", json={"board_id": board["id"]}, headers=workspace_headers
            ).status_code == 200
        assert "От Ани" in captured["summary"] and "От Ани" in captured["suggest"]
        assert "Аня" not in captured["summary"].replace("От Ани", "")
        assert "Аня" not in captured["suggest"].replace("От Ани", "")

    def test_live_card_event_hides_author(self, client, workspace_headers, login_as):
        anya = login_as("Аня")
        board = _board(client, workspace_headers, "Анонимная живая", anonymous_votes=True)
        with _ws(client, board["id"], workspace_headers) as ws_owner:
            _card(client, anya, board["columns"][0]["id"], "От Ани")
            event = _recv(ws_owner, "card_created")["data"]
            assert event["text"] == "От Ани" and event["author"] == "Участник" and event["author_id"] is None


# ── Приглашения ──────────────────────────────────────────────────────────────


class TestInvites:
    def test_join_by_invite_needs_only_a_name(self, client, workspace_headers, sample_board):
        invite = client.get("/api/workspaces/invite", headers=workspace_headers).json()["invite_token"]
        assert client.get("/api/workspaces/invite", headers=workspace_headers).json()["invite_token"] == invite

        info = client.get(f"/api/workspaces/invite/{invite}")
        assert info.status_code == 200 and info.json() == {"workspace_name": "Test Team"}

        joined = client.post("/api/workspaces/join", json={"invite_token": invite, "name": "Новичок"})
        assert joined.status_code == 200
        assert joined.json()["participant"]["name"] == "Новичок"
        assert joined.json()["workspace_slug"] == "test-team"
        headers = {"X-Workspace-Token": joined.cookies["workspace_token"]}
        client.cookies.clear()
        # Ссылка на доску: идентификатор доски не меняется при переименовании
        assert client.get(f"/api/boards/{sample_board['id']}", headers=headers).status_code == 200

    @pytest.mark.parametrize("token", ["нет-такого-токена", "x" * 40])
    def test_unknown_invite_is_404(self, client, test_workspace, token):
        assert client.get(f"/api/workspaces/invite/{token}").status_code == 404
        assert client.post("/api/workspaces/join", json={"invite_token": token, "name": "X"}).status_code == 404

    def test_invite_requires_session(self, client, test_workspace):
        assert client.get("/api/workspaces/invite").status_code == 401

    def test_join_works_for_a_first_time_visitor_without_csrf_cookie(
        self, client, workspace_headers, monkeypatch
    ):
        """У человека, впервые открывшего ссылку, ещё нет CSRF-cookie — как и при обычном входе."""
        invite = client.get("/api/workspaces/invite", headers=workspace_headers).json()["invite_token"]
        client.cookies.clear()
        monkeypatch.setattr(settings, "csrf_enabled", True)
        joined = client.post("/api/workspaces/join", json={"invite_token": invite, "name": "Гость"})
        assert joined.status_code == 200
        client.cookies.clear()
        # Остальные изменяющие запросы по-прежнему требуют CSRF-токен
        assert client.post("/api/workspaces/logout").status_code == 403

    def test_admin_rotation_invalidates_old_link_but_keeps_sessions(
        self, client, admin_headers, test_workspace, workspace_headers
    ):
        old = client.get("/api/workspaces/invite", headers=workspace_headers).json()["invite_token"]
        seen_by_admin = client.get(f"/api/admin/workspaces/{test_workspace.id}/invite", headers=admin_headers)
        assert seen_by_admin.json()["invite_token"] == old

        rotated = client.post(f"/api/admin/workspaces/{test_workspace.id}/invite/rotate", headers=admin_headers)
        new = rotated.json()["invite_token"]
        assert new != old
        assert client.get(f"/api/workspaces/invite/{old}").status_code == 404
        assert client.get(f"/api/workspaces/invite/{new}").status_code == 200
        # Уже вошедшие остаются в команде
        assert client.get("/api/boards/", headers=workspace_headers).status_code == 200


# ── Перенос задач без дублей ─────────────────────────────────────────────────


class TestCarryForward:
    def _task(self, client, headers, board_id, title, status="open"):
        resp = client.post(
            "/api/action-items/",
            json={"board_id": board_id, "title": title, "text": title, "status": status},
            headers=headers,
        )
        assert resp.status_code == 201
        return resp.json()

    def test_carried_task_is_counted_once(self, client, workspace_headers, sample_board):
        """Раньше перенос копировал задачу: дашборд показывал две открытые вместо одной."""
        self._task(client, workspace_headers, sample_board["id"], "Починить флейки", "in_progress")
        self._task(client, workspace_headers, sample_board["id"], "Уже сделано", "done")
        new_board = _board(client, workspace_headers, "Следующий спринт", carry_forward_items=True)

        open_items = [
            i for i in client.get("/api/action-items/all", headers=workspace_headers).json() if i["status"] != "done"
        ]
        assert [(i["title"], i["board_id"], i["status"]) for i in open_items] == [
            ("Починить флейки", new_board["id"], "in_progress")
        ]

        boards = {b["id"]: b for b in client.get("/api/boards/", headers=workspace_headers).json()}
        assert boards[sample_board["id"]]["action_items_open"] == 0
        assert boards[new_board["id"]]["action_items_open"] == 1

        trends = {t["board_id"]: t for t in client.get("/api/action-items/trends", headers=workspace_headers).json()}
        assert (trends[sample_board["id"]]["in_progress"], trends[sample_board["id"]]["done"]) == (0, 1)
        assert trends[new_board["id"]]["in_progress"] == 1

        # История на исходной доске сохраняется и видна по запросу
        with_history = client.get("/api/action-items/all?include_carried=true", headers=workspace_headers).json()
        assert len([i for i in with_history if i["title"] == "Починить флейки"]) == 2

    def test_board_trends_count_a_carried_task_once(self, client, workspace_headers, sample_board):
        self._task(client, workspace_headers, sample_board["id"], "Переносимая")
        self._task(client, workspace_headers, sample_board["id"], "Остаётся")
        target = _board(client, workspace_headers, "Цель")
        carried = self._task(client, workspace_headers, sample_board["id"], "Третья")
        client.post(
            "/api/action-items/carry-forward",
            json={
                "source_board_id": sample_board["id"],
                "target_board_id": target["id"],
                "item_ids": [carried["id"]],
            },
            headers=workspace_headers,
        )
        points = {
            p["board_id"]: p["action_items_total"]
            for p in client.get("/api/boards/mood-trends", headers=workspace_headers).json()
        }
        assert points == {sample_board["id"]: 2, target["id"]: 1}

    def test_second_carry_does_not_duplicate(self, client, workspace_headers, sample_board):
        """Кнопка «На доску» раньше создавала новую копию при каждом нажатии."""
        task = self._task(client, workspace_headers, sample_board["id"], "Задача")
        target = _board(client, workspace_headers, "Цель")
        body = {"source_board_id": sample_board["id"], "target_board_id": target["id"]}

        first = client.post("/api/action-items/carry-forward", json=body, headers=workspace_headers)
        second = client.post("/api/action-items/carry-forward", json=body, headers=workspace_headers)
        assert first.status_code == 201 and len(first.json()) == 1
        assert second.status_code == 201 and second.json() == []

        source = client.get(f"/api/action-items/?board_id={sample_board['id']}", headers=workspace_headers).json()
        assert source[0]["id"] == task["id"] and source[0]["superseded_by_id"] == first.json()[0]["id"]

    def test_carry_selected_items_only(self, client, workspace_headers, sample_board):
        first = self._task(client, workspace_headers, sample_board["id"], "Первая")
        self._task(client, workspace_headers, sample_board["id"], "Вторая")
        target = _board(client, workspace_headers, "Цель")
        resp = client.post(
            "/api/action-items/carry-forward",
            json={"source_board_id": sample_board["id"], "target_board_id": target["id"], "item_ids": [first["id"]]},
            headers=workspace_headers,
        )
        assert [i["title"] for i in resp.json()] == ["Первая"]

    def test_same_source_and_target_is_rejected(self, client, workspace_headers, sample_board):
        resp = client.post(
            "/api/action-items/carry-forward",
            json={"source_board_id": sample_board["id"], "target_board_id": sample_board["id"]},
            headers=workspace_headers,
        )
        assert resp.status_code == 400


# ── Согласованность порядка и адресов ────────────────────────────────────────


class TestOrderAndAddresses:
    def test_card_moved_event_carries_final_order(self, client, workspace_headers, sample_board, sample_column):
        """Раньше событие несло одну карточку, и у остальных клиентов порядок расходился с сервером."""
        cards = [_card(client, workspace_headers, sample_column["id"], f"К{i}") for i in range(4)]
        with _ws(client, sample_board["id"], workspace_headers) as ws:
            client.post(
                f"/api/cards/{cards[3]['id']}/move",
                json={"column_id": sample_column["id"], "position": 1},
                headers=workspace_headers,
            )
            event = _recv(ws, "card_moved")["data"]
        expected = [cards[0]["id"], cards[3]["id"], cards[1]["id"], cards[2]["id"]]
        assert event["column_card_ids"] == expected
        assert event["old_column_id"] == sample_column["id"]
        server = _get_board(client, workspace_headers, sample_board["id"])["columns"][0]["cards"]
        assert [c["id"] for c in server] == expected

    def test_new_card_goes_after_last_even_after_deletions(self, client, workspace_headers, sample_column, db_session):
        """Позиция по количеству давала дубли после удаления карточки из середины."""
        cards = [_card(client, workspace_headers, sample_column["id"], f"К{i}") for i in range(3)]
        client.delete(f"/api/cards/{cards[0]['id']}", headers=workspace_headers)
        added = _card(client, workspace_headers, sample_column["id"], "Новая")
        positions = [c.position for c in db_session.get(Column, sample_column["id"]).cards]
        assert len(positions) == len(set(positions))
        assert added["position"] == max(positions)

    def test_reserved_slug_is_not_issued(self, client, workspace_headers):
        """Адрес /board/start фронтенд понимает как «первая доска»."""
        board = _board(client, workspace_headers, "Start")
        assert board["slug"] != "start" and board["slug"].startswith("start-")
        assert client.get(f"/api/boards/by-slug/{board['slug']}", headers=workspace_headers).status_code == 200

    def test_column_update_does_not_carry_cards(self, client, workspace_headers, sample_board, sample_card, sample_column):
        """Ответ и событие об изменении колонки раньше несли все её карточки целиком."""
        with _ws(client, sample_board["id"], workspace_headers) as ws:
            resp = client.patch(
                f"/api/columns/{sample_column['id']}", json={"title": "Новое название"}, headers=workspace_headers
            )
            event = _recv(ws, "column_updated")["data"]
        assert resp.status_code == 200
        assert "cards" not in resp.json() and "cards" not in event
        assert event["title"] == "Новое название"
