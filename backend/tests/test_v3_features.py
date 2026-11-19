"""Тесты для новой функциональности v3: шаблоны, carry-forward, lock/privacy, mood, insights и WS-события."""

import json
from unittest.mock import patch

from app.config import settings

TEST_ORIGIN = "http://localhost:3000"


def _recv_event(ws, target_event: str, max_messages: int = 12):
    for _ in range(max_messages):
        msg = ws.receive_json()
        if msg["event"] == target_event:
            return msg
    raise AssertionError(
        f"Did not receive '{target_event}' within {max_messages} messages"
    )


class TestBoardTemplatesAndCopy:
    def test_list_templates_returns_expected_presets(self, client, workspace_headers):
        resp = client.get("/api/boards/templates", headers=workspace_headers)
        assert resp.status_code == 200
        ids = [tpl["id"] for tpl in resp.json()]
        assert "classic" in ids
        assert "start_stop_continue" in ids
        assert "4ls" in ids
        assert "sailboat" in ids
        assert "mad_sad_glad" in ids
        # Пустой холст задаётся через custom без колонок; старый id «empty» остаётся
        # только для совместимости API/MCP и в списке шаблонов не показывается
        assert "empty" not in ids

    def test_create_board_with_sailboat_template(self, client, workspace_headers):
        resp = client.post(
            "/api/boards/",
            json={"name": "Sprint Sailboat", "template": "sailboat", "max_votes": 3},
            headers=workspace_headers,
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["template"] == "sailboat"
        assert len(data["columns"]) == 4
        assert "Ветер" in data["columns"][0]["title"]

    def test_create_board_with_custom_and_empty_templates(
        self, client, workspace_headers
    ):
        empty_resp = client.post(
            "/api/boards/",
            json={"name": "Blank Retro", "template": "empty"},
            headers=workspace_headers,
        )
        assert empty_resp.status_code == 201
        assert empty_resp.json()["columns"] == []

        custom_resp = client.post(
            "/api/boards/",
            json={
                "name": "Custom Retro",
                "template": "custom",
                "custom_columns": [
                    {"title": "Wins", "color": "#006E1C"},
                    {"title": "Risks", "color": "#BA1A1A"},
                ],
            },
            headers=workspace_headers,
        )
        assert custom_resp.status_code == 201
        cols = custom_resp.json()["columns"]
        assert [c["title"] for c in cols] == ["Wins", "Risks"]

    def test_create_board_unknown_template_returns_400(
        self, client, workspace_headers
    ):
        resp = client.post(
            "/api/boards/",
            json={"name": "Bad Template", "template": "non_existent"},
            headers=workspace_headers,
        )
        assert resp.status_code == 400

    def test_copy_board_structure_and_carry_forward_items(
        self, client, sample_board, workspace_headers
    ):
        # Добавляем кастомную колонку на исходную доску
        col_resp = client.post(
            "/api/columns/",
            json={
                "board_id": sample_board["id"],
                "title": "Благодарности",
                "color": "#6750A4",
            },
            headers=workspace_headers,
        )
        assert col_resp.status_code == 201

        # Создаём открытую и выполненную задачи
        open_item = client.post(
            "/api/action-items/",
            json={
                "board_id": sample_board["id"],
                "title": "Настроить алерты",
                "text": "Добавить алерт на 5xx в Grafana",
                "assignee": "Иван",
                "status": "in_progress",
            },
            headers=workspace_headers,
        )
        assert open_item.status_code == 201

        done_item = client.post(
            "/api/action-items/",
            json={
                "board_id": sample_board["id"],
                "title": "Готово",
                "text": "Уже выполненная задача",
                "status": "done",
            },
            headers=workspace_headers,
        )
        assert done_item.status_code == 201

        # Копируем структуру + carry-forward нерешённых задач
        new_resp = client.post(
            "/api/boards/",
            json={
                "name": "Next Sprint",
                "template": "copy",
                "source_board_id": sample_board["id"],
                "carry_forward_items": True,
                "hide_cards_until_reveal": True,
                "anonymous_votes": True,
            },
            headers=workspace_headers,
        )
        assert new_resp.status_code == 201
        new_board = new_resp.json()
        assert new_board["hide_cards_until_reveal"] is True
        assert new_board["anonymous_votes"] is True
        col_titles = [c["title"] for c in new_board["columns"]]
        assert "Благодарности" in col_titles
        assert len(col_titles) == 4

        items_resp = client.get(
            f"/api/action-items/?board_id={new_board['id']}",
            headers=workspace_headers,
        )
        assert items_resp.status_code == 200
        items = items_resp.json()
        assert len(items) == 1
        assert items[0]["title"] == "Настроить алерты"
        assert items[0]["assignee"] == "Иван"
        # Перенос сохраняет статус: задача «в работе» не откатывается в «открыта»
        assert items[0]["status"] == "in_progress"
        assert items[0]["superseded_by_id"] is None

        # Оригинал остаётся в истории своей доски, но помечен перенесённым
        source_items = client.get(
            f"/api/action-items/?board_id={sample_board['id']}",
            headers=workspace_headers,
        ).json()
        carried = next(i for i in source_items if i["title"] == "Настроить алерты")
        assert carried["superseded_by_id"] == items[0]["id"]


class TestBoardLockAndPrivacy:
    def test_locked_board_blocks_card_column_group_mutations(
        self, client, sample_board, sample_column, sample_card, workspace_headers
    ):
        lock_resp = client.patch(
            f"/api/boards/{sample_board['id']}",
            json={
                "is_locked": True,
                "hide_cards_until_reveal": True,
                "anonymous_votes": True,
            },
            headers=workspace_headers,
        )
        assert lock_resp.status_code == 200
        assert lock_resp.json()["is_locked"] is True

        # Создание карточки, лайк, колонка и группа заблокированы (423)
        r_card = client.post(
            "/api/cards/",
            json={
                "column_id": sample_column["id"],
                "text": "Blocked card",
                "author": "Alice",
            },
            headers=workspace_headers,
        )
        assert r_card.status_code == 423

        r_like = client.post(
            f"/api/cards/{sample_card['id']}/like?username=Alice",
            headers=workspace_headers,
        )
        assert r_like.status_code == 423

        r_col = client.post(
            "/api/columns/",
            json={"board_id": sample_board["id"], "title": "Blocked Col"},
            headers=workspace_headers,
        )
        assert r_col.status_code == 423

        r_grp = client.post(
            "/api/groups/",
            json={"column_id": sample_column["id"], "title": "Blocked Grp"},
            headers=workspace_headers,
        )
        assert r_grp.status_code == 423

        # Разблокировка возвращает доступ
        unlock_resp = client.patch(
            f"/api/boards/{sample_board['id']}",
            json={"is_locked": False},
            headers=workspace_headers,
        )
        assert unlock_resp.status_code == 200

        r_ok = client.post(
            "/api/cards/",
            json={
                "column_id": sample_column["id"],
                "text": "Unlocked card",
                "author": "Alice",
            },
            headers=workspace_headers,
        )
        assert r_ok.status_code == 201


class TestMoodAndInsightsAndRegenerate:
    def test_mood_upsert_trends_and_board_list_stats(
        self, client, sample_board, sample_card, workspace_headers, login_as
    ):
        r1 = client.post(
            f"/api/boards/{sample_board['id']}/mood",
            json={"score": 3, "note": "Нормально"},
            headers=workspace_headers,
        )
        assert r1.status_code == 200
        assert r1.json()["score"] == 3
        assert r1.json()["author"] == "Tester"
        assert r1.json()["mine"] is True

        # Повторная отправка от того же участника обновляет оценку, а не дублирует
        r2 = client.post(
            f"/api/boards/{sample_board['id']}/mood",
            json={"score": 5, "note": "Супер спринт"},
            headers=workspace_headers,
        )
        assert r2.status_code == 200
        assert r2.json()["score"] == 5

        # Тёзка — другой участник: его оценка не перезаписывает первую
        r3 = client.post(
            f"/api/boards/{sample_board['id']}/mood",
            json={"score": 3},
            headers=login_as("Tester"),
        )
        assert r3.status_code == 200

        board_resp = client.get(
            f"/api/boards/{sample_board['id']}", headers=workspace_headers
        )
        assert board_resp.status_code == 200
        assert len(board_resp.json()["moods"]) == 2

        list_resp = client.get("/api/boards/", headers=workspace_headers)
        assert list_resp.status_code == 200
        item = next(b for b in list_resp.json() if b["id"] == sample_board["id"])
        assert item["mood_avg"] == 4.0
        assert item["mood_count"] == 2
        assert item["cards_count"] == 1

        trends_resp = client.get("/api/boards/mood-trends", headers=workspace_headers)
        assert trends_resp.status_code == 200
        points = trends_resp.json()
        assert len(points) == 1
        assert points[0]["mood_avg"] == 4.0
        assert points[0]["cards_count"] == 1

    def test_workspace_insights_fallback_and_ai(
        self, client, sample_board, sample_card, workspace_headers
    ):
        with patch.object(settings, "ai_base_url", ""):
            fallback_resp = client.post(
                "/api/boards/workspace-insights", headers=workspace_headers
            )
            assert fallback_resp.status_code == 200
            fb = fallback_resp.json()
            assert fb["generated_by_ai"] is False
            assert fb["boards_analyzed"] == 1
            assert "1" in fb["summary_text"]

        mock_ai_json = json.dumps(
            {
                "summary_text": "Команда стабильно ускоряется.",
                "recurring_themes": ["CI/CD", "Ревью кода"],
                "recommendations": ["Сократить время ревью PR до 4 часов"],
            },
            ensure_ascii=False,
        )
        with patch.object(
            settings,
            "ai_base_url",
            "https://mock-ai.local/v1",
        ), patch(
            "app.ai.prompts.workspace_insights.ai_client.generate",
            return_value=mock_ai_json,
        ):
            ai_resp = client.post(
                "/api/boards/workspace-insights", headers=workspace_headers
            )
            assert ai_resp.status_code == 200
            data = ai_resp.json()
            assert data["generated_by_ai"] is True
            assert data["recurring_themes"] == ["CI/CD", "Ревью кода"]
            assert data["recommendations"] == ["Сократить время ревью PR до 4 часов"]

    def test_regenerate_summary_requires_ai_and_upserts(
        self, client, sample_board, sample_card, workspace_headers
    ):
        with patch.object(settings, "ai_base_url", ""):
            r_503 = client.post(
                f"/api/boards/{sample_board['id']}/summary/regenerate",
                headers=workspace_headers,
            )
            assert r_503.status_code == 503

        with patch.object(
            settings, "ai_base_url", "https://mock-ai.local/v1"
        ), patch(
            "app.routers.boards.generate_summary",
            return_value={
                "summary_text": "Первая версия итогов",
                "key_themes": ["Скорость"],
                "recommendations": ["Тесты"],
            },
        ):
            r_ok = client.post(
                f"/api/boards/{sample_board['id']}/summary/regenerate",
                headers=workspace_headers,
            )
            assert r_ok.status_code == 200
            assert r_ok.json()["summary_text"] == "Первая версия итогов"


class TestWebSocketV3EventsAndPersistence:
    def test_ready_spotlight_and_reaction_events(self, client, ws_board, ws_token_for):
        url1 = f"/ws/{ws_board.id}?workspace_token={ws_token_for('Facilitator')}"
        url2 = f"/ws/{ws_board.id}?workspace_token={ws_token_for('Member')}"
        with client.websocket_connect(url1, headers={"origin": TEST_ORIGIN}) as ws1:
            with client.websocket_connect(url2, headers={"origin": TEST_ORIGIN}) as ws2:
                _recv_event(ws2, "presence_update")

                ws1.send_text(json.dumps({"event": "facilitator_start", "data": {}}))
                _recv_event(ws2, "facilitator_update")

                # Готовность участников
                ws2.send_text(json.dumps({"event": "ready_toggle", "data": {"ready": True}}))
                ready_msg = _recv_event(ws1, "ready_update")
                assert ready_msg["data"]["ready_users"] == ["Member"]

                # Spotlight от не-фасилитатора игнорируется, от фасилитатора проходит
                ws2.send_text(
                    json.dumps({"event": "spotlight_card", "data": {"card_id": "c-bad"}})
                )
                ws1.send_text(
                    json.dumps({"event": "spotlight_card", "data": {"card_id": "c-123"}})
                )
                spot_msg = _recv_event(ws2, "spotlight_update")
                assert spot_msg["data"]["card_id"] == "c-123"

                # Реакции из whitelist
                ws2.send_text(
                    json.dumps({"event": "reaction", "data": {"emoji": "🔥"}})
                )
                react_msg = _recv_event(ws1, "reaction")
                assert react_msg["data"]["emoji"] == "🔥"
                assert react_msg["data"]["username"] == "Member"

                # Смена фазы сбрасывает ready_users и spotlight
                ws1.send_text(
                    json.dumps({"event": "phase_change", "data": {"phase": "discuss"}})
                )
                _recv_event(ws2, "phase_update")
                cleared_ready = _recv_event(ws2, "ready_update")
                assert cleared_ready["data"]["ready_users"] == []

    def test_session_persists_in_db_and_hydrates_after_manager_reset(
        self, client, ws_board, ws_token_for, db_session
    ):
        from app.models import Board
        from app.ws_manager import manager

        url = f"/ws/{ws_board.id}?workspace_token={ws_token_for('Host')}"
        with client.websocket_connect(url, headers={"origin": TEST_ORIGIN}) as ws1:
            _recv_event(ws1, "presence_update")

            ws1.send_text(json.dumps({"event": "facilitator_start", "data": {}}))
            _recv_event(ws1, "facilitator_update")

            ws1.send_text(
                json.dumps({"event": "phase_change", "data": {"phase": "vote"}})
            )
            _recv_event(ws1, "phase_update")

            # Проверяем запись в БД
            db_session.expire_all()
            row = db_session.get(Board, ws_board.id)
            assert row.active_facilitator == "Host"
            assert row.active_facilitator_id is not None
            assert row.active_phase == "vote"
            assert row.active_session_id is not None

        # Имитируем рестарт воркера: очищаем in-memory state
        manager.reset()

        # Новый клиент должен получить гидрированные active_facilitator и active_phase
        with client.websocket_connect(url, headers={"origin": TEST_ORIGIN}) as ws_re:
            fac_msg = _recv_event(ws_re, "facilitator_update")
            assert fac_msg["data"]["facilitator"] == "Host"
            assert fac_msg["data"]["phase"] == "vote"
            _recv_event(ws_re, "presence_update")

            # Завершаем сессию с блокировкой доски
            ws_re.send_text(
                json.dumps({"event": "facilitator_stop", "data": {"lock_board": True}})
            )
            _recv_event(ws_re, "board_updated")

        db_session.expire_all()
        row = db_session.get(Board, ws_board.id)
        assert row.active_facilitator is None
        assert row.active_phase is None
        assert row.is_locked is True
