"""Health check команды: вопросы со светофором, оценка встречи, тренды."""

import json

import pytest

from app.models import Board
from tests.conftest import login_headers

TEST_ORIGIN = "http://localhost:3000"


def _answer(client, headers, board_id, answers):
    return client.post(f"/api/boards/{board_id}/health", json={"answers": answers}, headers=headers)


def _question(summary: dict, key: str) -> dict:
    return next(q for q in summary["questions"] if q["key"] == key)


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


class TestQuestions:
    def test_fixed_set_of_questions(self, client, workspace_headers):
        resp = client.get("/api/boards/health/questions", headers=workspace_headers)
        assert resp.status_code == 200
        questions = resp.json()
        assert [q["key"] for q in questions] == ["pace", "quality", "process", "atmosphere", "clarity"]
        assert all(q["title"] and q["hint"] for q in questions)

    def test_static_paths_are_not_taken_for_board_ids(self, client, workspace_headers):
        """Маршруты опроса стоят раньше /{board_id}: иначе «health-trends» искали бы как доску."""
        assert client.get("/api/boards/health-trends", headers=workspace_headers).json() == []
        assert client.get("/api/boards/health/questions").status_code == 401


class TestAnswers:
    def test_summary_counts_and_own_answers(self, client, workspace_headers, login_as, sample_board):
        board_id = sample_board["id"]
        anya = login_as("Аня")
        first = _answer(client, workspace_headers, board_id, {"pace": 3, "quality": 1})
        assert first.status_code == 200
        _answer(client, anya, board_id, {"pace": 2})

        mine = client.get(f"/api/boards/{board_id}/health", headers=workspace_headers).json()
        assert mine["participants"] == 2
        pace = _question(mine, "pace")
        assert (pace["red"], pace["yellow"], pace["green"], pace["answers"]) == (0, 1, 1, 2)
        assert pace["average"] == 2.5
        assert _question(mine, "quality")["red"] == 1
        assert _question(mine, "clarity")["answers"] == 0 and _question(mine, "clarity")["average"] is None
        # Свои ответы видит только сам участник
        assert mine["mine"] == {"pace": 3, "quality": 1}
        assert client.get(f"/api/boards/{board_id}/health", headers=anya).json()["mine"] == {"pace": 2}

    def test_second_answer_replaces_the_first(self, client, workspace_headers, sample_board):
        board_id = sample_board["id"]
        _answer(client, workspace_headers, board_id, {"pace": 1})
        again = _answer(client, workspace_headers, board_id, {"pace": 3}).json()
        pace = _question(again, "pace")
        assert (pace["red"], pace["green"], pace["answers"]) == (0, 1, 1)
        assert again["mine"] == {"pace": 3}

    def test_namesakes_answer_independently(self, client, login_as, sample_board):
        first, second = login_as("Саша"), login_as("Саша")
        _answer(client, first, sample_board["id"], {"pace": 1})
        summary = _answer(client, second, sample_board["id"], {"pace": 3}).json()
        assert _question(summary, "pace")["answers"] == 2

    @pytest.mark.parametrize(
        "answers",
        [{}, {"нет-такого": 2}, {"pace": 0}, {"pace": 4}, {"pace": "зелёный"}, {"roti": 3}],
    )
    def test_invalid_answers_are_rejected(self, client, workspace_headers, sample_board, answers):
        assert _answer(client, workspace_headers, sample_board["id"], answers).status_code == 422

    def test_summary_never_exposes_who_answered(self, client, workspace_headers, login_as, sample_board):
        anya = login_as("Аня")
        _answer(client, anya, sample_board["id"], {"atmosphere": 1})
        raw = client.get(f"/api/boards/{sample_board['id']}/health", headers=workspace_headers).text
        assert "Аня" not in raw and "participant_id" not in raw

    def test_locked_board_still_accepts_answers(self, client, workspace_headers, sample_board):
        """Опрос проходит и после встречи, когда доску уже заблокировали."""
        client.patch(f"/api/boards/{sample_board['id']}", json={"is_locked": True}, headers=workspace_headers)
        assert _answer(client, workspace_headers, sample_board["id"], {"pace": 2}).status_code == 200

    def test_other_team_board_is_404(self, client, db_session, sample_board, workspace_headers):
        import bcrypt

        from app.models import Workspace

        db_session.add(
            Workspace(
                id="other",
                slug="other-team",
                name="Другая",
                access_key_hash=bcrypt.hashpw(b"otherkey123", bcrypt.gensalt(rounds=4)).decode(),
            )
        )
        db_session.commit()
        stranger = login_headers(client, "Чужой", slug="other-team", key="otherkey123")
        assert client.get(f"/api/boards/{sample_board['id']}/health", headers=stranger).status_code == 404
        assert _answer(client, stranger, sample_board["id"], {"pace": 3}).status_code == 404
        assert client.post(f"/api/boards/{sample_board['id']}/roti", json={"value": 5}, headers=stranger).status_code == 404

    def test_deleted_board_is_404(self, client, workspace_headers, sample_board):
        client.delete(f"/api/boards/{sample_board['id']}", headers=workspace_headers)
        assert _answer(client, workspace_headers, sample_board["id"], {"pace": 3}).status_code == 404


class TestMeetingRating:
    def test_roti_average_and_replace(self, client, workspace_headers, login_as, sample_board):
        board_id = sample_board["id"]
        client.post(f"/api/boards/{board_id}/roti", json={"value": 2}, headers=workspace_headers)
        client.post(f"/api/boards/{board_id}/roti", json={"value": 4}, headers=workspace_headers)
        summary = client.post(f"/api/boards/{board_id}/roti", json={"value": 5}, headers=login_as("Аня")).json()
        assert summary["roti"] == {"average": 4.5, "answers": 2}
        assert summary["mine"] == {"roti": 5}
        # Оценка встречи не считается ответом на вопросы опроса
        assert summary["participants"] == 0

    @pytest.mark.parametrize("value", [0, 6, "пять"])
    def test_roti_out_of_range(self, client, workspace_headers, sample_board, value):
        resp = client.post(f"/api/boards/{sample_board['id']}/roti", json={"value": value}, headers=workspace_headers)
        assert resp.status_code == 422


class TestTrends:
    def test_boards_in_order_and_empty_boards_skipped(self, client, workspace_headers, sample_board, db_session):
        later = client.post("/api/boards/", json={"name": "Спринт 2"}, headers=workspace_headers).json()
        client.post("/api/boards/", json={"name": "Без ответов"}, headers=workspace_headers)
        # Первая доска — более ранняя
        db_session.get(Board, sample_board["id"]).created_at = db_session.get(
            Board, later["id"]
        ).created_at.replace(year=2020)
        db_session.commit()

        _answer(client, workspace_headers, sample_board["id"], {"pace": 1, "quality": 3})
        _answer(client, workspace_headers, later["id"], {"pace": 3})
        client.post(f"/api/boards/{later['id']}/roti", json={"value": 4}, headers=workspace_headers)

        points = client.get("/api/boards/health-trends", headers=workspace_headers).json()
        assert [p["board_name"] for p in points] == ["Test Board", "Спринт 2"]
        assert points[0]["averages"] == {"pace": 1.0, "quality": 3.0} and points[0]["roti_average"] is None
        assert points[1]["averages"] == {"pace": 3.0} and points[1]["roti_average"] == 4.0

    def test_deleted_boards_are_not_in_trends(self, client, workspace_headers, sample_board):
        _answer(client, workspace_headers, sample_board["id"], {"pace": 2})
        client.delete(f"/api/boards/{sample_board['id']}", headers=workspace_headers)
        assert client.get("/api/boards/health-trends", headers=workspace_headers).json() == []


class TestLiveEvents:
    def test_facilitator_starts_check_for_everyone(self, client, workspace_headers, login_as, sample_board):
        anya = login_as("Аня")
        board_id = sample_board["id"]
        with _ws(client, board_id, workspace_headers) as ws_fac, _ws(client, board_id, anya) as ws_anya:
            ws_fac.send_text(json.dumps({"event": "facilitator_start", "data": {}}))
            _recv(ws_anya, "facilitator_update")

            # Участник запустить опрос за ведущего не может
            ws_anya.send_text(json.dumps({"event": "health_check_start", "data": {}}))
            ws_fac.send_text(json.dumps({"event": "health_check_start", "data": {}}))
            requested = _recv(ws_anya, "health_check_requested")["data"]
            assert requested["requested_by"] == "Tester"

            _answer(client, anya, board_id, {"pace": 3})
            update = _recv(ws_fac, "health_updated")["data"]
            assert "mine" not in update
            assert _question(update, "pace")["green"] == 1

            # Конец встречи — запрос оценки у всех
            ws_fac.send_text(json.dumps({"event": "facilitator_stop", "data": {}}))
            _recv(ws_anya, "roti_requested")

    def test_anyone_starts_check_without_session(self, client, workspace_headers, login_as, sample_board):
        anya = login_as("Аня")
        with _ws(client, sample_board["id"], workspace_headers) as ws_owner, _ws(client, sample_board["id"], anya) as ws_anya:
            ws_anya.send_text(json.dumps({"event": "health_check_start", "data": {}}))
            assert _recv(ws_owner, "health_check_requested")["data"]["requested_by"] == "Аня"
