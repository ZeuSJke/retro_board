"""Устойчивость бэкенда: одно сообщение или один запрос не должны ронять доску.

Каждый тест закрепляет конкретный сценарий отказа, найденный при ревью.
"""

import asyncio
import json
import sys
import threading
from unittest.mock import patch

import bcrypt
import httpx
import pytest
from sqlalchemy import event

from app.ai.ai_client import AIClient, AIModelConfig
from app.config import settings
from app.database import _engine_options
from app.limiter import TEAM_READ_LIMIT, TEAM_WRITE_LIMIT
from app.workspace_auth import verify_access_key
from app.ws_payloads import (
    MAX_WS_MESSAGE_CHARS,
    clean_cursor_move,
    clean_group_collapse,
    clean_timer,
    number_in_range,
)
from tests.conftest import engine as test_engine

TEST_ORIGIN = "http://localhost:3000"

# Пакет app.ai реэкспортирует экземпляр клиента под тем же именем, что и модуль,
# поэтому сам модуль берём из sys.modules.
ai_client_module = sys.modules["app.ai.ai_client"]


def _send(ws, event_name: str, data) -> None:
    ws.send_text(json.dumps({"event": event_name, "data": data}))


def _recv(ws, target_event: str, max_messages: int = 10) -> dict:
    for _ in range(max_messages):
        msg = ws.receive_json()
        if msg["event"] == target_event:
            return msg
    raise AssertionError(f"Did not receive '{target_event}'")


def _ws(client, token, board="hardening-board"):
    return client.websocket_connect(
        f"/ws/{board}?workspace_token={token}", headers={"origin": TEST_ORIGIN}
    )


# ── Проверка входящих WebSocket-сообщений ────────────────────────────────────


class TestPayloadCleaners:
    @pytest.mark.parametrize("value", ["5", None, True, float("nan"), float("inf"), -1, 10**9, [], {}])
    def test_number_in_range_rejects_non_numbers(self, value):
        assert number_in_range(value, 0, 1000) is None

    def test_number_in_range_accepts_numbers(self):
        assert number_in_range(0, 0, 10) == 0
        assert number_in_range(2.5, 0, 10) == 2.5

    def test_timer_start_keeps_only_known_fields(self):
        clean = clean_timer(
            "timer_start", {"duration": 300, "remaining": 120, "ts": 1700000000000, "junk": "x" * 100}
        )
        assert clean == {"duration": 300, "remaining": 120, "ts": 1700000000000}

    @pytest.mark.parametrize(
        "payload",
        [
            {"duration": 300, "remaining": "x"},
            {"duration": "300", "remaining": 10},
            {"duration": 300},
            {"duration": 300, "remaining": -5},
            {"duration": 300, "remaining": True},
        ],
    )
    def test_timer_start_rejects_bad_numbers(self, payload):
        assert clean_timer("timer_start", payload) is None

    def test_timer_pause_and_reset(self):
        assert clean_timer("timer_pause", {"remaining": 42}) == {"remaining": 42}
        assert clean_timer("timer_pause", {"remaining": 42, "duration": 60}) == {
            "remaining": 42,
            "duration": 60,
        }
        assert clean_timer("timer_pause", {"remaining": 42, "duration": "x"}) is None
        assert clean_timer("timer_reset", {"duration": 300, "extra": 1}) == {"duration": 300}
        assert clean_timer("timer_reset", {}) is None

    def test_cursor_and_collapse(self):
        assert clean_cursor_move({"x": 1, "y": 2, "username": "a", "junk": 1}) == {"x": 1, "y": 2}
        assert clean_cursor_move({"x": "1", "y": 2}) is None
        assert clean_group_collapse({"group_id": "g1", "collapsed": True, "junk": 1}) == {
            "group_id": "g1",
            "collapsed": True,
        }
        assert clean_group_collapse({"group_id": "g1", "collapsed": "yes"}) is None
        assert clean_group_collapse({"group_id": "g" * 500, "collapsed": True}) is None


class TestWebSocketHardening:
    def test_bad_timer_does_not_block_new_connections(self, client, ws_token):
        """Нечисловой remaining раньше сохранялся и рвал каждое новое подключение."""
        with _ws(client, ws_token) as ws1:
            _send(ws1, "timer_start", {"duration": 300, "remaining": "x"})
            # Корректное событие после некорректного доходит — соединение живо
            _send(ws1, "timer_reset", {"duration": 60})
            assert _recv(ws1, "timer_reset")["data"] == {"duration": 60}

            _send(ws1, "timer_start", {"duration": 300, "remaining": "x"})
            with _ws(client, ws_token) as ws2:
                # Новое подключение открывается и получает начальное состояние
                assert _recv(ws2, "facilitator_update")["data"]["facilitator"] is None
                _send(ws2, "identify", {"username": "Bob"})
                assert "Bob" in _recv(ws2, "presence_update")["data"]["users"]

    def test_nan_timer_is_ignored(self, client, ws_token):
        with _ws(client, ws_token) as ws1:
            ws1.send_text('{"event": "timer_start", "data": {"duration": 300, "remaining": NaN}}')
            _send(ws1, "timer_reset", {"duration": 60})
            assert _recv(ws1, "timer_reset")["data"] == {"duration": 60}

    @pytest.mark.parametrize(
        "raw",
        [
            '{"event": "timer_start", "data": "строка"}',
            '{"event": "cursor_move", "data": [1, 2, 3]}',
            '{"event": "reaction", "data": 42}',
            '["не", "объект"]',
            '"просто строка"',
            "null",
        ],
    )
    def test_non_object_payload_keeps_connection(self, client, ws_token, raw):
        """data не-словарь раньше обрывал соединение отправителя."""
        with _ws(client, ws_token) as ws:
            ws.send_text(raw)
            _send(ws, "identify", {"username": "Alice"})
            assert _recv(ws, "presence_update")["data"]["users"] == ["Alice"]

    def test_oversized_message_is_ignored(self, client, ws_token):
        with _ws(client, ws_token) as ws:
            _send(ws, "group_collapse", {"group_id": "g1", "collapsed": True, "junk": "x" * MAX_WS_MESSAGE_CHARS})
            _send(ws, "group_collapse", {"group_id": "g2", "collapsed": False})
            assert _recv(ws, "group_collapse")["data"] == {"group_id": "g2", "collapsed": False}

    def test_relay_strips_unknown_fields(self, client, ws_token):
        """Другим клиентам уходят только известные поля, а не всё присланное."""
        with _ws(client, ws_token) as ws1, _ws(client, ws_token) as ws2:
            _send(ws1, "group_collapse", {"group_id": "g1", "collapsed": True, "junk": "мусор"})
            assert _recv(ws2, "group_collapse")["data"] == {"group_id": "g1", "collapsed": True}

            _send(ws1, "cursor_move", {"username": "Alice", "x": 10, "y": 20, "junk": "мусор"})
            assert _recv(ws2, "cursor_move")["data"] == {"username": "Alice", "x": 10, "y": 20}

            _send(ws1, "timer_start", {"duration": 300, "remaining": 300, "junk": "мусор"})
            assert _recv(ws2, "timer_start")["data"] == {"duration": 300, "remaining": 300}

    def test_cursor_leave_uses_sender_name(self, client, ws_token):
        """Нельзя убрать чужой курсор, прислав чужое имя."""
        with _ws(client, ws_token) as ws1, _ws(client, ws_token) as ws2:
            _send(ws1, "identify", {"username": "Alice"})
            _recv(ws2, "presence_update")
            _send(ws1, "cursor_leave", {"username": "Bob"})
            assert _recv(ws2, "cursor_leave")["data"] == {"username": "Alice"}


class TestSummaryGenerationGuard:
    def test_second_start_is_skipped_while_first_runs(self):
        from app.routers import websocket as ws_router

        started = []

        async def fake_trigger(board_id, username, workspace_id):
            started.append(board_id)
            await asyncio.sleep(0.05)

        async def scenario():
            with patch.object(ws_router, "_trigger_summary_generation", fake_trigger):
                first = ws_router._start_summary_generation("b1", "u", "w")
                second = ws_router._start_summary_generation("b1", "u", "w")
                other = ws_router._start_summary_generation("b2", "u", "w")
                await asyncio.sleep(0.15)
                again = ws_router._start_summary_generation("b1", "u", "w")
                await asyncio.sleep(0.1)
                return first, second, other, again

        first, second, other, again = asyncio.run(scenario())
        assert (first, second, other, again) == (True, False, True, True)
        assert started == ["b1", "b2", "b1"]
        assert ws_router._summary_tasks == {}

    def test_no_ai_means_no_generation_thread(self):
        """Без шлюза итоги не генерируются: ни потока, ни соединения с БД."""
        from app.routers import boards, websocket as ws_router

        sent = []

        async def fake_broadcast(board_id, event_name, data, exclude=None):
            sent.append((board_id, event_name))

        async def scenario():
            with (
                patch.object(settings, "ai_base_url", ""),
                patch.object(ws_router.manager, "broadcast", fake_broadcast),
                patch.object(boards, "_generate_summary_internal") as generate,
            ):
                await ws_router._trigger_summary_generation("b1", "u", "w")
                return generate.called

        assert asyncio.run(scenario()) is False
        assert sent == [("b1", "summary_failed")]


# ── Вход: любые строки дают 401 или 422, не 500 ──────────────────────────────


class TestLoginHardening:
    @pytest.mark.parametrize("key", ["a" * 80, "ключ" * 25, "x" * 100])
    def test_long_key_is_rejected_not_crashed(self, client, test_workspace, key):
        """bcrypt 5 бросает ValueError на вход длиннее 72 байт — раньше это был 500."""
        resp = client.post(
            "/api/workspaces/login",
            json={"workspace_slug": "test-team", "access_key": key},
        )
        assert resp.status_code == 401

    def test_legacy_long_key_still_verifies(self):
        """Ключ, выданный до лимита, хешировался по первым 72 байтам и должен подходить."""
        long_key = "k" * 90
        key_hash = bcrypt.hashpw(long_key.encode()[:72], bcrypt.gensalt(rounds=4)).decode()
        assert verify_access_key(long_key, key_hash) is True
        assert verify_access_key("другой", key_hash) is False

    def test_corrupted_hash_is_a_denial(self):
        assert verify_access_key("anything", "не-хеш") is False

    def test_admin_login_with_non_ascii(self, client):
        """secrets.compare_digest на str падал с TypeError на кириллице."""
        resp = client.post("/api/admin/login", json={"login": "админ", "password": "пароль"})
        assert resp.status_code == 401

    def test_admin_login_rejects_huge_fields(self, client):
        resp = client.post("/api/admin/login", json={"login": "a" * 5000, "password": "b"})
        assert resp.status_code == 422

    def test_new_key_longer_than_bcrypt_limit_is_422(self, client, admin_headers):
        resp = client.post(
            "/api/admin/workspaces",
            json={"slug": "long-key", "name": "Длинный ключ", "access_key": "ключ" * 10},
            headers=admin_headers,
        )
        assert resp.status_code == 422

    def test_key_at_bcrypt_limit_works(self, client, admin_headers):
        key = "k" * 72
        resp = client.post(
            "/api/admin/workspaces",
            json={"slug": "edge-key", "name": "Граница", "access_key": key},
            headers=admin_headers,
        )
        assert resp.status_code == 201
        login = client.post(
            "/api/workspaces/login", json={"workspace_slug": "edge-key", "access_key": key}
        )
        assert login.status_code == 200


# ── Длины в схемах совпадают с длинами в БД ──────────────────────────────────


class TestSchemaLengths:
    def test_custom_column_title_limited_to_db_length(self, client, workspace_headers):
        ok = client.post(
            "/api/boards/",
            json={"name": "Ровно 80", "custom_columns": [{"title": "к" * 80}]},
            headers=workspace_headers,
        )
        assert ok.status_code == 201
        too_long = client.post(
            "/api/boards/",
            json={"name": "Больше 80", "custom_columns": [{"title": "к" * 81}]},
            headers=workspace_headers,
        )
        assert too_long.status_code == 422

    def test_bulk_group_title_limited_to_db_length(self, client, sample_card, workspace_headers):
        resp = client.post(
            "/api/cards/bulk-update",
            json={"card_ids": [sample_card["id"]], "group_title": "г" * 121},
            headers=workspace_headers,
        )
        assert resp.status_code == 422

    def test_cluster_group_title_limited_to_db_length(self, client, sample_column, workspace_headers):
        resp = client.post(
            "/api/groups/apply-clusters",
            json={
                "column_id": sample_column["id"],
                "groups": [{"title": "г" * 121, "card_ids": ["a", "b"]}],
            },
            headers=workspace_headers,
        )
        assert resp.status_code == 422


# ── Лимит размера тела запроса ───────────────────────────────────────────────


class TestBodySizeLimit:
    def test_oversized_body_is_rejected_before_auth(self, client):
        big = {"workspace_slug": "x", "access_key": "y", "junk": "z" * (settings.max_request_body_bytes + 1)}
        resp = client.post("/api/workspaces/login", json=big)
        assert resp.status_code == 413
        assert resp.json()["detail"] == "Слишком большой запрос"

    def test_oversized_chunked_body_is_rejected(self, client):
        """Тело без Content-Length считается по мере чтения."""

        def chunks():
            yield b'{"workspace_slug": "x", "access_key": "y", "junk": "'
            for _ in range(settings.max_request_body_bytes // 65536 + 2):
                yield b"z" * 65536
            yield b'"}'

        resp = client.post(
            "/api/workspaces/login",
            content=chunks(),
            headers={"content-type": "application/json"},
        )
        assert resp.status_code == 413

    def test_normal_body_passes(self, client, test_workspace):
        resp = client.post(
            "/api/workspaces/login",
            json={"workspace_slug": "test-team", "access_key": "testkey123"},
        )
        assert resp.status_code == 200


# ── Таймауты БД ──────────────────────────────────────────────────────────────


class TestDatabaseTimeouts:
    def test_postgres_gets_timeouts(self):
        opts = _engine_options("postgresql://user:pass@db:5432/retro")
        assert opts["connect_args"]["connect_timeout"] == settings.db_connect_timeout_s
        assert f"statement_timeout={settings.db_statement_timeout_ms}" in opts["connect_args"]["options"]
        assert f"lock_timeout={settings.db_lock_timeout_ms}" in opts["connect_args"]["options"]
        assert opts["pool_timeout"] == settings.db_pool_timeout_s

    def test_sqlite_is_untouched(self):
        assert _engine_options("sqlite://") == {"pool_pre_ping": True}


# ── Клиент модели ────────────────────────────────────────────────────────────


class TestAIClientHardening:
    def _client(self, handler):
        return AIClient(base_url="http://llm.test/v1", transport=httpx.MockTransport(handler))

    @pytest.mark.parametrize(
        "body",
        [
            {"choices": [{"message": {"content": None}}]},
            {"choices": [{"message": {"content": 42}}]},
            {"choices": [{"message": None}]},
            {"choices": None},
            ["не", "объект"],
        ],
    )
    def test_unexpected_response_shape_is_runtime_error(self, body):
        """content: null раньше давал AttributeError мимо обработчиков и 500 в эндпоинтах."""
        client = self._client(lambda request: httpx.Response(200, json=body))
        with pytest.raises(RuntimeError):
            client.generate("hi")

    def test_client_error_is_not_retried(self):
        calls = []

        def handler(request):
            calls.append(1)
            return httpx.Response(400, json={"error": "bad request"})

        with pytest.raises(RuntimeError):
            self._client(handler).generate("hi", AIModelConfig(retries=3))
        assert len(calls) == 1

    def test_server_error_is_retried(self):
        calls = []

        def handler(request):
            calls.append(1)
            return httpx.Response(503)

        with pytest.raises(RuntimeError):
            self._client(handler).generate("hi", AIModelConfig(retries=3))
        assert len(calls) == 3

    def test_busy_gateway_fails_fast(self):
        """Когда все слоты заняты, запрос не ждёт бесконечно."""
        slots = threading.BoundedSemaphore(1)
        slots.acquire()
        client = self._client(lambda request: httpx.Response(200, json={}))
        with (
            patch.object(ai_client_module, "_ai_slots", slots),
            patch.object(settings, "ai_queue_timeout_s", 0.01),
            pytest.raises(RuntimeError, match="busy"),
        ):
            client.generate("hi")


# ── Соединение с БД не удерживается на время вызова модели ───────────────────


@pytest.fixture()
def open_connections():
    """Счётчик соединений, взятых из пула и ещё не возвращённых."""
    state = {"open": 0}

    def on_checkout(dbapi_conn, record, proxy):
        state["open"] += 1

    def on_checkin(dbapi_conn, record):
        state["open"] -= 1

    event.listen(test_engine, "checkout", on_checkout)
    event.listen(test_engine, "checkin", on_checkin)
    try:
        yield state
    finally:
        event.remove(test_engine, "checkout", on_checkout)
        event.remove(test_engine, "checkin", on_checkin)


class TestConnectionReleasedDuringAI:
    def test_suggest_releases_connection(self, client, sample_card, sample_board, workspace_headers, open_connections):
        seen = []

        def fake_suggest(cards):
            seen.append(open_connections["open"])
            return []

        with (
            patch.object(settings, "ai_base_url", "http://llm.test/v1"),
            patch("app.ai.prompts.action_item_suggestions.suggest_action_items_from_cards", fake_suggest),
        ):
            resp = client.post(
                "/api/action-items/suggest", json={"board_id": sample_board["id"]}, headers=workspace_headers
            )
        assert resp.status_code == 200
        assert seen == [0]

    def test_generate_title_releases_connection(self, client, workspace_headers, open_connections):
        seen = []

        def fake_generate(prompt, config=None):
            seen.append(open_connections["open"])
            return "Заголовок"

        with patch("app.routers.action_items.ai_client.generate", fake_generate):
            resp = client.post(
                "/api/action-items/generate-title", json={"text": "Текст карточки"}, headers=workspace_headers
            )
        assert resp.status_code == 200
        assert resp.json()["title"] == "Заголовок"
        assert seen == [0]

    def test_insights_release_connection(self, client, sample_card, workspace_headers, open_connections):
        seen = []

        def fake_insights(snapshot):
            seen.append(open_connections["open"])
            return {"summary_text": "ок", "recurring_themes": [], "recommendations": [], "boards_analyzed": 1}

        with patch("app.routers.boards.generate_workspace_insights", fake_insights):
            resp = client.post("/api/boards/workspace-insights", headers=workspace_headers)
        assert resp.status_code == 200
        assert seen == [0]

    def test_regenerate_releases_connection_and_saves(
        self, client, sample_card, sample_board, workspace_headers, open_connections
    ):
        seen = []

        def fake_summary(board_data):
            seen.append(open_connections["open"])
            return {"summary_text": "Итог", "key_themes": ["тема"], "recommendations": []}

        with (
            patch.object(settings, "ai_base_url", "http://llm.test/v1"),
            patch("app.routers.boards.generate_summary", fake_summary),
        ):
            resp = client.post(
                f"/api/boards/{sample_board['id']}/summary/regenerate", headers=workspace_headers
            )
        assert resp.status_code == 200
        assert resp.json()["summary_text"] == "Итог"
        assert seen == [0]

    def test_cluster_preview_releases_connection(
        self, client, sample_column, workspace_headers, open_connections
    ):
        for text in ("Первая", "Вторая"):
            client.post(
                "/api/cards/",
                json={"column_id": sample_column["id"], "text": text, "author": "A"},
                headers=workspace_headers,
            )
        seen = []

        def fake_cluster(cards):
            seen.append(open_connections["open"])
            return {"groups": [], "ungrouped": [c["id"] for c in cards]}

        with (
            patch.object(settings, "ai_base_url", "http://llm.test/v1"),
            patch("app.routers.groups.cluster_cards", fake_cluster),
        ):
            resp = client.post(
                "/api/groups/auto-cluster-preview",
                json={"column_id": sample_column["id"]},
                headers=workspace_headers,
            )
        assert resp.status_code == 200
        assert resp.json()["column_id"] == sample_column["id"]
        assert seen == [0]

    def test_session_summary_releases_connection_and_saves(
        self, client, sample_card, sample_board, open_connections
    ):
        """Итоги по переходу в фазу «Итоги» генерируются в потоке со своей сессией."""
        from app.routers import boards
        from app.ws_manager import manager
        from tests.conftest import TestSessionLocal

        board_id = sample_board["id"]
        manager.set_facilitator(board_id, "Ведущий")
        seen = []

        def fake_summary(board_data):
            seen.append(open_connections["open"])
            return {"summary_text": "Итог сессии", "key_themes": [], "recommendations": ["шаг"]}

        with (
            patch("app.database.SessionLocal", TestSessionLocal),
            patch.object(boards, "generate_summary", fake_summary),
        ):
            result = boards._generate_summary_internal(board_id, "Ведущий", "test-workspace-id")

        assert seen == [0]
        assert result is not None
        assert result["summary_text"] == "Итог сессии"
        assert open_connections["open"] == 0

    def test_auto_cluster_rechecks_column_after_model(self, client, sample_column, workspace_headers):
        """Пока модель думала, колонку удалили: не пишем в несуществующую колонку."""
        ids = []
        for text in ("Первая", "Вторая"):
            resp = client.post(
                "/api/cards/",
                json={"column_id": sample_column["id"], "text": text, "author": "A"},
                headers=workspace_headers,
            )
            ids.append(resp.json()["id"])

        def fake_cluster(cards):
            deleted = client.delete(f"/api/columns/{sample_column['id']}", headers=workspace_headers)
            assert deleted.status_code == 204
            return {"groups": [{"title": "Группа", "card_ids": ids}], "ungrouped": []}

        with (
            patch.object(settings, "ai_base_url", "http://llm.test/v1"),
            patch("app.routers.groups.cluster_cards", fake_cluster),
        ):
            resp = client.post(
                "/api/groups/auto-cluster",
                json={"column_id": sample_column["id"]},
                headers=workspace_headers,
            )
        assert resp.status_code == 404


# ── Лимиты запросов рассчитаны на команду за одним адресом ───────────────────


class TestTeamLimits:
    def test_team_limits_cover_a_voting_team(self):
        """Десять человек по пять голосов за минуту — это 50 запросов с одного IP."""
        assert int(TEAM_WRITE_LIMIT.split("/")[0]) >= 200
        assert int(TEAM_READ_LIMIT.split("/")[0]) >= 200
