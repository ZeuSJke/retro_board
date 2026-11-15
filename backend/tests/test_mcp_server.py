"""Тесты Streamable HTTP MCP-сервера (`/mcp`), 15 инструментов, 3 промптов и инвариантов."""

import asyncio
from datetime import UTC, datetime
import json

import anyio
import httpx
import pytest
from mcp.client.session import ClientSession
from mcp.client.streamable_http import streamable_http_client

from app import models
from app.config import settings
from app.limiter import limiter
from app.mcp import mcp_lifespan, set_db_session_factory
from app.mcp import server as mcp_server
from app.mcp.rate_limit import (
    MCP_AUTH_FAIL_LIMIT_PER_MINUTE,
    MCP_TOKEN_LIMIT_PER_MINUTE,
    mcp_rate_limiter,
)
from main import app

_MCP_HEADERS_BASE = {
    "Accept": "application/json, text/event-stream",
    "Content-Type": "application/json",
}


def _create_token(client, workspace_headers: dict, name: str = "Ретро-бот", scope: str = "read_write") -> dict:
    resp = client.post(
        "/api/workspaces/agent-tokens",
        json={"name": name, "scope": scope},
        headers=workspace_headers,
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


def _mcp_post(
    client,
    secret: str,
    method: str,
    params: dict | None = None,
    *,
    req_id: int = 1,
    path: str = "/mcp",
    extra_headers: dict[str, str] | None = None,
):
    headers = {**_MCP_HEADERS_BASE, "Authorization": f"Bearer {secret}"}
    if extra_headers:
        headers.update(extra_headers)
    payload: dict = {"jsonrpc": "2.0", "id": req_id, "method": method}
    if params is not None:
        payload["params"] = params
    return client.post(path, headers=headers, json=payload)


def _call_tool(
    client,
    secret: str,
    name: str,
    arguments: dict | None = None,
    *,
    req_id: int = 1,
) -> tuple[bool, object, dict]:
    resp = _mcp_post(
        client,
        secret,
        "tools/call",
        {"name": name, "arguments": arguments or {}},
        req_id=req_id,
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert "error" not in body, body
    result = body["result"]
    is_error = bool(result.get("isError"))
    sc = result.get("structuredContent")
    if sc is not None:
        data = sc.get("result") if set(sc.keys()) == {"result"} else sc
    else:
        texts = [item.get("text", "") for item in result.get("content", []) if item.get("type") == "text"]
        raw_text = "\n".join(texts)
        try:
            data = json.loads(raw_text)
        except Exception:
            data = raw_text
    return is_error, data, body


# ── Транспорт, авторизация, CSRF, DNS rebinding и rate limit ─────────────────


def test_mcp_transport_auth_and_csrf_rules(client, test_workspace, workspace_headers):
    # GET /mcp запрещён (stateless mode -> без открытого SSE-потока)
    get_resp = client.get("/mcp")
    assert get_resp.status_code == 405
    assert get_resp.headers.get("allow") == "POST"

    # Без Bearer или с неверным/cookie-токеном -> 401
    init_body = {
        "jsonrpc": "2.0",
        "id": 1,
        "method": "initialize",
        "params": {"protocolVersion": "2025-11-25", "capabilities": {}, "clientInfo": {"name": "t", "version": "1"}},
    }
    assert client.post("/mcp", headers=_MCP_HEADERS_BASE, json=init_body).status_code == 401
    assert (
        client.post(
            "/mcp",
            headers={**_MCP_HEADERS_BASE, "Authorization": "Bearer rba_invalid_secret"},
            json=init_body,
        ).status_code
        == 401
    )

    # Cookie workspace_token не даёт доступа к /mcp
    ws_cookie = workspace_headers["X-Workspace-Token"]
    assert (
        client.post(
            "/mcp",
            headers={**_MCP_HEADERS_BASE, "Cookie": f"workspace_token={ws_cookie}"},
            json=init_body,
        ).status_code
        == 401
    )

    issued = _create_token(client, workspace_headers, name="AuthBot", scope="read_only")
    secret = issued["secret"]
    token_id = issued["token"]["id"]

    # Trailing slash `/mcp/` поддерживается напрямую без 307
    ok_slash = _mcp_post(
        client,
        secret,
        "initialize",
        init_body["params"],
        path="/mcp/",
    )
    assert ok_slash.status_code == 200
    assert ok_slash.json()["result"]["serverInfo"]["name"] == "retroboard"

    # Даже с включённым CSRF-фильтром `/mcp` освобождён от X-CSRF-Token
    prev_csrf = settings.csrf_enabled
    settings.csrf_enabled = True
    try:
        ok_csrf = _mcp_post(client, secret, "tools/list")
        assert ok_csrf.status_code == 200
    finally:
        settings.csrf_enabled = prev_csrf

    # Отзыв токена немедленно закрывает /mcp
    del_resp = client.delete(f"/api/workspaces/agent-tokens/{token_id}", headers=workspace_headers)
    assert del_resp.status_code == 200
    revoked_resp = _mcp_post(client, secret, "tools/list")
    assert revoked_resp.status_code == 401


def test_mcp_dns_rebinding_protection(client, test_workspace, workspace_headers):
    secret = _create_token(client, workspace_headers, scope="read_only")["secret"]

    bad_host = client.post(
        "/mcp",
        headers={
            **_MCP_HEADERS_BASE,
            "Authorization": f"Bearer {secret}",
            "Host": "evil.attacker.example",
        },
        json={"jsonrpc": "2.0", "id": 1, "method": "tools/list"},
    )
    assert bad_host.status_code == 421

    bad_origin = client.post(
        "/mcp",
        headers={
            **_MCP_HEADERS_BASE,
            "Authorization": f"Bearer {secret}",
            "Origin": "https://evil.attacker.example",
        },
        json={"jsonrpc": "2.0", "id": 2, "method": "tools/list"},
    )
    assert bad_origin.status_code == 403


def test_mcp_rate_limits_per_token_and_auth_failures(
    client, test_workspace, workspace_headers, monkeypatch
):
    secret_a = _create_token(client, workspace_headers, name="Bot A", scope="read_only")["secret"]
    secret_b = _create_token(client, workspace_headers, name="Bot B", scope="read_only")["secret"]

    prev_enabled = limiter.enabled
    limiter.enabled = True
    mcp_rate_limiter.reset()
    try:
        for i in range(MCP_TOKEN_LIMIT_PER_MINUTE):
            r = _mcp_post(client, secret_a, "tools/list", req_id=i + 1)
            assert r.status_code == 200
        limited = _mcp_post(client, secret_a, "tools/list", req_id=999)
        assert limited.status_code == 429

        # На том же IP до блокировки по auth-fail другой валидный токен (Bot B) не затронут квотой Bot A
        assert _mcp_post(client, secret_b, "tools/list").status_code == 200

        # После порога auth-fail IP блокируется ДО обращения к БД/_authenticate_agent_sync
        auth_calls = 0
        orig_auth = mcp_server._authenticate_agent_sync

        def _spy_auth(raw_token: str):
            nonlocal auth_calls
            auth_calls += 1
            return orig_auth(raw_token)

        monkeypatch.setattr(mcp_server, "_authenticate_agent_sync", _spy_auth)

        for _ in range(MCP_AUTH_FAIL_LIMIT_PER_MINUTE):
            r = client.post(
                "/mcp",
                headers={**_MCP_HEADERS_BASE, "Authorization": "Bearer rba_wrong"},
                json={"jsonrpc": "2.0", "id": 1, "method": "tools/list"},
            )
            assert r.status_code == 401
        assert auth_calls == MCP_AUTH_FAIL_LIMIT_PER_MINUTE

        auth_limited = client.post(
            "/mcp",
            headers={**_MCP_HEADERS_BASE, "Authorization": "Bearer rba_wrong"},
            json={"jsonrpc": "2.0", "id": 1, "method": "tools/list"},
        )
        assert auth_limited.status_code == 429
        assert auth_calls == MCP_AUTH_FAIL_LIMIT_PER_MINUTE

        # Заблокированный IP отсекается до БД даже при валидном токене Bot B
        assert _mcp_post(client, secret_b, "tools/list").status_code == 429
        assert auth_calls == MCP_AUTH_FAIL_LIMIT_PER_MINUTE

        # Другой IP с валидным Bot B проходит нормально (200)
        async def _call_other_ip() -> int:
            async with httpx.AsyncClient(
                transport=httpx.ASGITransport(app=app, client=("10.0.0.99", 12345)),
                base_url="http://testserver",
            ) as async_client:
                resp = await async_client.post(
                    "/mcp",
                    headers={**_MCP_HEADERS_BASE, "Authorization": f"Bearer {secret_b}"},
                    json={"jsonrpc": "2.0", "id": 2, "method": "tools/list"},
                )
                return resp.status_code

        assert anyio.run(_call_other_ip) == 200
        assert auth_calls == MCP_AUTH_FAIL_LIMIT_PER_MINUTE + 1
    finally:
        limiter.enabled = prev_enabled
        mcp_rate_limiter.reset()


def test_mcp_tool_annotations_and_write_tools_match(client, workspace_headers):
    rw_secret = _create_token(client, workspace_headers, name="Annotator", scope="read_write")["secret"]
    tools = _mcp_post(client, rw_secret, "tools/list").json()["result"]["tools"]

    non_readonly_tools: set[str] = set()
    by_name = {}
    for tool in tools:
        ann = tool.get("annotations") or {}
        ro = ann.get("readOnlyHint")
        assert isinstance(ro, bool), f"readOnlyHint must be explicit bool for {tool['name']}"
        by_name[tool["name"]] = ann
        if ro is not True:
            non_readonly_tools.add(tool["name"])
            assert tool["name"] in mcp_server._WRITE_TOOLS

    assert non_readonly_tools == set(mcp_server._WRITE_TOOLS)

    for update_tool in ("group_cards", "update_action_item", "save_summary"):
        assert by_name[update_tool]["destructiveHint"] is True
        assert by_name[update_tool]["idempotentHint"] is True
    for add_tool in ("create_board", "create_card", "create_action_item"):
        assert by_name[add_tool]["destructiveHint"] is False
    for name, ann in by_name.items():
        if name not in mcp_server._WRITE_TOOLS:
            assert ann["readOnlyHint"] is True
            assert ann["destructiveHint"] is False


# ── Права read_only / read_write ─────────────────────────────────────────────


def test_mcp_scope_enforcement_lists_and_calls(client, test_workspace, workspace_headers, sample_board):
    ro_secret = _create_token(client, workspace_headers, name="Reader", scope="read_only")["secret"]
    rw_secret = _create_token(client, workspace_headers, name="Writer", scope="read_write")["secret"]

    ro_tools = _mcp_post(client, ro_secret, "tools/list").json()["result"]["tools"]
    rw_tools = _mcp_post(client, rw_secret, "tools/list").json()["result"]["tools"]

    ro_names = {t["name"] for t in ro_tools}
    rw_names = {t["name"] for t in rw_tools}
    assert len(rw_names) == 15
    assert "create_card" in rw_names
    assert "save_summary" in rw_names
    assert len(ro_names) == 9
    assert ro_names.isdisjoint(
        {"create_board", "create_card", "group_cards", "create_action_item", "update_action_item", "save_summary"}
    )

    # Прямой вызов write-инструмента read_only-токеном отвергается на уровне протокола MCP (-32602)
    blocked = _mcp_post(
        client,
        ro_secret,
        "tools/call",
        {
            "name": "create_board",
            "arguments": {"name": "Нельзя создать"},
        },
    )
    assert blocked.status_code == 200
    body = blocked.json()
    assert "error" in body
    assert body["error"]["code"] == -32602


# ── Раздельные тесты инструментов MCP, приватности, блокировки и промптов ──────


def test_mcp_boards_cards_search_and_grouping(
    client, test_workspace, workspace_headers, login_as
):
    other_headers = login_as("Алиса")
    rw_secret = _create_token(client, workspace_headers, name="Спринт-агент", scope="read_write")["secret"]

    err, b1, _ = _call_tool(
        client,
        rw_secret,
        "create_board",
        {"name": "Ретро 42", "template": "classic", "carry_forward_items": False},
    )
    assert not err
    board_slug = b1["slug"]
    col1_id = b1["columns"][0]["id"]
    col2_id = b1["columns"][1]["id"]

    err, b2, _ = _call_tool(
        client,
        rw_secret,
        "create_board",
        {"name": "Ретро 43", "custom_columns": [{"title": "Фокус", "color": "#112233"}]},
    )
    assert not err
    assert b2["id"] != b1["id"]

    err, boards_page1, _ = _call_tool(client, rw_secret, "list_boards", {"limit": 1, "offset": 0})
    assert not err
    assert boards_page1["total"] == 2
    assert len(boards_page1["items"]) == 1
    assert boards_page1["has_more"] is True

    err, c_agent1, _ = _call_tool(
        client,
        rw_secret,
        "create_card",
        {"column_id": col1_id, "text": "Автоматический анализ Релиза v2"},
    )
    assert not err
    assert c_agent1["author_kind"] == "agent"
    assert c_agent1["author"] == "Спринт-агент"

    err, c_agent2, _ = _call_tool(
        client,
        rw_secret,
        "create_card",
        {"column_id": col1_id, "text": "Повторяющийся флаки-тест в регрессе"},
    )
    assert not err

    human_card = client.post(
        "/api/cards/",
        json={"column_id": col2_id, "text": "Задержка релиза из-за ручного стенда"},
        headers=other_headers,
    )
    assert human_card.status_code == 201
    human_card_id = human_card.json()["id"]

    # search_cards поддерживает кириллицу без учёта регистра
    err, hits_cyr, _ = _call_tool(
        client,
        rw_secret,
        "search_cards",
        {"query": "релиз", "board_id_or_slug": board_slug},
    )
    assert not err
    assert hits_cyr["total"] == 2
    assert {h["id"] for h in hits_cyr["items"]} == {c_agent1["id"], human_card_id}

    # group_cards: создать группу и разгруппировать ('')
    err, grouped, _ = _call_tool(
        client,
        rw_secret,
        "group_cards",
        {"card_ids": [c_agent1["id"], c_agent2["id"]], "group_title": "Качество релизов"},
    )
    assert not err
    assert grouped[0]["group_id"] is not None

    err, ungrouped, _ = _call_tool(
        client,
        rw_secret,
        "group_cards",
        {"card_ids": [c_agent2["id"]], "group_id": ""},
    )
    assert not err
    assert ungrouped[0]["group_id"] is None


def test_mcp_action_items_external_url_and_carry_forward(client, workspace_headers):
    rw_secret = _create_token(client, workspace_headers, name="Task Bot", scope="read_write")["secret"]
    err, b1, _ = _call_tool(
        client,
        rw_secret,
        "create_board",
        {"name": "Спринт 10", "carry_forward_items": False},
    )
    assert not err
    board_slug = b1["slug"]

    err_bad_url, _, _ = _call_tool(
        client,
        rw_secret,
        "create_action_item",
        {
            "board_id_or_slug": board_slug,
            "title": "Плохой URL",
            "text": "Нельзя javascript",
            "external_url": "javascript:alert(1)",
        },
    )
    assert err_bad_url

    err, item1, _ = _call_tool(
        client,
        rw_secret,
        "create_action_item",
        {
            "board_id_or_slug": board_slug,
            "title": "Настроить автодеплой",
            "text": "Ускорить выкат на staging",
            "assignee": "Алиса",
            "external_url": "https://jira.example.com/browse/RETRO-42",
        },
    )
    assert not err
    assert item1["external_url"] == "https://jira.example.com/browse/RETRO-42"

    err, carried_board, _ = _call_tool(
        client,
        rw_secret,
        "create_board",
        {
            "name": "Спринт 11",
            "source_board_id_or_slug": board_slug,
            "carry_forward_items": True,
        },
    )
    assert not err
    err, active_items, _ = _call_tool(
        client,
        rw_secret,
        "list_action_items",
        {"board_id_or_slug": carried_board["id"], "include_carried": False},
    )
    assert not err
    assert active_items["total"] == 1
    assert active_items["items"][0]["external_url"] == "https://jira.example.com/browse/RETRO-42"


def test_mcp_privacy_anonymous_and_hidden_modes(client, workspace_headers, login_as, sample_board):
    other_headers = login_as("Алиса")
    rw_secret = _create_token(client, workspace_headers, name="Privacy Bot", scope="read_write")["secret"]
    board_id = sample_board["id"]
    col1_id = sample_board["columns"][0]["id"]
    col2_id = sample_board["columns"][1]["id"]

    err, c_agent, _ = _call_tool(
        client,
        rw_secret,
        "create_card",
        {"column_id": col1_id, "text": "Автоанализ релиза"},
    )
    assert not err

    human_card = client.post(
        "/api/cards/",
        json={"column_id": col2_id, "text": "Проблема релиза у команды"},
        headers=other_headers,
    )
    assert human_card.status_code == 201
    human_card_id = human_card.json()["id"]

    # Анонимный режим: люди скрыты, карточка агента сохраняет имя и author_kind="agent"
    assert (
        client.patch(
            f"/api/boards/{board_id}",
            json={"anonymous_votes": True, "hide_cards_until_reveal": False},
            headers=workspace_headers,
        ).status_code
        == 200
    )

    human_board_view = client.get(f"/api/boards/{board_id}", headers=workspace_headers).json()
    cards_for_human = {c["id"]: c for col in human_board_view["columns"] for c in col["cards"]}
    assert cards_for_human[c_agent["id"]]["author"] == "Privacy Bot"
    assert cards_for_human[c_agent["id"]]["author_kind"] == "agent"
    assert cards_for_human[human_card_id]["author"] == "Участник"
    assert cards_for_human[human_card_id]["author_kind"] == "human"

    err, mcp_board_anon, _ = _call_tool(client, rw_secret, "get_board", {"board_id_or_slug": board_id})
    assert not err
    cards_for_agent = {c["id"]: c for col in mcp_board_anon["columns"] for c in col["cards"]}
    assert cards_for_agent[human_card_id]["author"] == "Участник"
    assert cards_for_agent[c_agent["id"]]["author_kind"] == "agent"

    # Скрытый сбор: чужая карточка маскируется в get_board и выпадает из search_cards
    assert (
        client.patch(
            f"/api/boards/{board_id}",
            json={"hide_cards_until_reveal": True},
            headers=workspace_headers,
        ).status_code
        == 200
    )
    err, mcp_board_hidden, _ = _call_tool(client, rw_secret, "get_board", {"board_id_or_slug": board_id})
    assert not err
    hidden_cards = {c["id"]: c for col in mcp_board_hidden["columns"] for c in col["cards"]}
    assert hidden_cards[human_card_id]["masked"] is True
    assert hidden_cards[human_card_id]["text"] == ""
    assert hidden_cards[human_card_id]["author_kind"] == "human"

    err, hidden_search, _ = _call_tool(
        client, rw_secret, "search_cards", {"query": "релиз", "board_id_or_slug": board_id}
    )
    assert not err
    assert [h["id"] for h in hidden_search["items"]] == [c_agent["id"]]

    err_grp_hidden, _, _ = _call_tool(
        client, rw_secret, "group_cards", {"card_ids": [c_agent["id"]], "group_title": "Нельзя"}
    )
    assert err_grp_hidden
    err_sum_hidden, _, _ = _call_tool(
        client,
        rw_secret,
        "save_summary",
        {"board_id_or_slug": board_id, "summary_text": "Нельзя при скрытых карточках"},
    )
    assert err_sum_hidden


def test_mcp_locked_board_allows_only_status_and_external_url(client, workspace_headers, sample_board):
    rw_secret = _create_token(client, workspace_headers, name="Lock Bot", scope="read_write")["secret"]
    board_id = sample_board["id"]
    col1_id = sample_board["columns"][0]["id"]

    err, card, _ = _call_tool(
        client, rw_secret, "create_card", {"column_id": col1_id, "text": "До блокировки"}
    )
    assert not err
    err, item, _ = _call_tool(
        client,
        rw_secret,
        "create_action_item",
        {"board_id_or_slug": board_id, "title": "Задача", "text": "Описание"},
    )
    assert not err

    assert (
        client.patch(
            f"/api/boards/{board_id}",
            json={"is_locked": True},
            headers=workspace_headers,
        ).status_code
        == 200
    )

    for bad_call in [
        ("create_card", {"column_id": col1_id, "text": "Заблокировано"}),
        ("group_cards", {"card_ids": [card["id"]], "group_title": "Заблокировано"}),
        ("create_action_item", {"board_id_or_slug": board_id, "text": "Заблокировано"}),
        ("save_summary", {"board_id_or_slug": board_id, "summary_text": "Заблокировано"}),
        ("update_action_item", {"item_id": item["id"], "title": "Нельзя менять title"}),
        ("update_action_item", {"item_id": item["id"], "status": "done", "assignee": "Боб"}),
    ]:
        err_flag, _, _ = _call_tool(client, rw_secret, bad_call[0], bad_call[1])
        assert err_flag, f"Ожидалась ошибка на заблокированной доске для {bad_call}"

    err, item_upd, _ = _call_tool(
        client,
        rw_secret,
        "update_action_item",
        {
            "item_id": item["id"],
            "status": "in_progress",
            "external_url": "https://tracker.yandex.ru/RETRO-42",
        },
    )
    assert not err
    assert item_upd["status"] == "in_progress"
    assert item_upd["external_url"] == "https://tracker.yandex.ru/RETRO-42"

    err, item_cleared, _ = _call_tool(
        client,
        rw_secret,
        "update_action_item",
        {"item_id": item["id"], "external_url": ""},
    )
    assert not err
    assert item_cleared["external_url"] is None


def test_mcp_health_mood_trends_and_prompts(client, workspace_headers, sample_board):
    rw_secret = _create_token(client, workspace_headers, name="Trend Bot", scope="read_write")["secret"]
    board_id = sample_board["id"]
    board_slug = sample_board["slug"]

    questions = client.get("/api/boards/health/questions", headers=workspace_headers).json()
    q_key = questions[0]["key"]
    assert (
        client.post(
            f"/api/boards/{board_id}/health",
            json={"answers": {q_key: 3}},
            headers=workspace_headers,
        ).status_code
        == 200
    )
    assert (
        client.post(
            f"/api/boards/{board_id}/roti",
            json={"value": 4},
            headers=workspace_headers,
        ).status_code
        == 200
    )
    assert (
        client.post(
            f"/api/boards/{board_id}/mood",
            json={"score": 4},
            headers=workspace_headers,
        ).status_code
        == 200
    )

    err, h_sum, _ = _call_tool(
        client, rw_secret, "get_board_health", {"board_id_or_slug": board_slug}
    )
    assert not err
    assert h_sum["roti"]["answers"] == 1
    assert h_sum["roti"]["average"] == 4.0

    err, h_trends, _ = _call_tool(client, rw_secret, "get_health_trends")
    assert not err
    assert len(h_trends) >= 1

    err, m_trends, _ = _call_tool(client, rw_secret, "get_mood_trends")
    assert not err
    assert any(p["board_id"] == board_id and p["mood_count"] == 1 for p in m_trends)

    plist = _mcp_post(client, rw_secret, "prompts/list").json()["result"]["prompts"]
    assert {p["name"] for p in plist} == {"prepare_retro", "analyze_board", "sprint_followups"}

    for prompt_name, prompt_args in [
        ("prepare_retro", {"board_id_or_slug": board_slug}),
        ("analyze_board", {"board_id_or_slug": board_slug}),
        ("sprint_followups", {}),
    ]:
        p_resp = _mcp_post(
            client,
            rw_secret,
            "prompts/get",
            {"name": prompt_name, "arguments": prompt_args},
        )
        assert p_resp.status_code == 200
        msgs = p_resp.json()["result"]["messages"]
        assert len(msgs) == 1
        assert msgs[0]["content"]["text"]


def test_mcp_id_or_slug_collision_prefers_board_id_and_isolates_tools(client, workspace_headers):
    rw_secret = _create_token(client, workspace_headers, name="Lookup Bot", scope="read_write")["secret"]
    err, board_a, _ = _call_tool(
        client, rw_secret, "create_board", {"name": "Alpha", "carry_forward_items": False}
    )
    assert not err
    err, board_b, _ = _call_tool(
        client,
        rw_secret,
        "create_board",
        {"name": board_a["id"], "carry_forward_items": False},
    )
    assert not err
    assert board_b["slug"] == board_a["id"]

    _call_tool(
        client,
        rw_secret,
        "create_card",
        {"column_id": board_a["columns"][0]["id"], "text": "Общий поиск Alpha"},
    )
    _call_tool(
        client,
        rw_secret,
        "create_card",
        {"column_id": board_b["columns"][0]["id"], "text": "Общий поиск Beta"},
    )
    _call_tool(
        client,
        rw_secret,
        "create_action_item",
        {"board_id_or_slug": board_a["id"], "title": "Task A", "text": "Alpha task"},
    )
    _call_tool(
        client,
        rw_secret,
        "create_action_item",
        {"board_id_or_slug": board_b["id"], "title": "Task B", "text": "Beta task"},
    )

    err, got, _ = _call_tool(client, rw_secret, "get_board", {"board_id_or_slug": board_a["id"]})
    assert not err
    assert got["id"] == board_a["id"]

    err, tasks, _ = _call_tool(
        client, rw_secret, "list_action_items", {"board_id_or_slug": board_a["id"]}
    )
    assert not err
    assert [t["title"] for t in tasks["items"]] == ["Task A"]

    err, hits, _ = _call_tool(
        client,
        rw_secret,
        "search_cards",
        {"query": "общий поиск", "board_id_or_slug": board_a["id"]},
    )
    assert not err
    assert [h["board_id"] for h in hits["items"]] == [board_a["id"]]


def test_mcp_pagination_tie_breaker_stable_on_equal_created_at(
    client, db_session, test_workspace, workspace_headers
):
    rw_secret = _create_token(client, workspace_headers, name="Page Bot", scope="read_write")["secret"]
    fixed_ts = datetime(2026, 11, 15, 12, 0, 0, tzinfo=UTC)
    boards = [
        models.Board(
            id=f"board-page-{idx}",
            name=f"Page Board {idx}",
            slug=f"page-board-{idx}",
            workspace_id=test_workspace.id,
            created_at=fixed_ts,
        )
        for idx in (1, 2, 3)
    ]
    db_session.add_all(boards)
    db_session.flush()
    items = [
        models.ActionItem(
            id=f"item-page-{idx}",
            board_id=boards[0].id,
            title=f"Item {idx}",
            text="Body",
            status="open",
            created_at=fixed_ts,
        )
        for idx in (1, 2, 3)
    ]
    db_session.add_all(items)
    db_session.commit()

    board_ids: list[str] = []
    item_ids: list[str] = []
    for offset in range(3):
        err, page_b, _ = _call_tool(client, rw_secret, "list_boards", {"limit": 1, "offset": offset})
        assert not err
        board_ids.append(page_b["items"][0]["id"])

        err, page_i, _ = _call_tool(
            client, rw_secret, "list_action_items", {"limit": 1, "offset": offset}
        )
        assert not err
        item_ids.append(page_i["items"][0]["id"])

    assert board_ids == ["board-page-3", "board-page-2", "board-page-1"]
    assert item_ids == ["item-page-3", "item-page-2", "item-page-1"]


def test_mcp_save_summary_preserves_omitted_fields_and_clears_explicit_empty(
    client, db_session, workspace_headers, sample_board
):
    secret = _create_token(client, workspace_headers, "Preserve Bot", "read_write")["secret"]
    board_id = sample_board["id"]

    err, s1, _ = _call_tool(
        client,
        secret,
        "save_summary",
        {
            "board_id_or_slug": board_id,
            "summary_text": "Первый вариант",
            "themes_payload": [{"name": "Автодеплой", "description": "Ускорение CI"}],
            "recommendations": ["Убрать ручные шаги"],
        },
    )
    assert not err
    assert s1["key_themes"] == ["Автодеплой"]
    assert s1["recommendations"] == ["Убрать ручные шаги"]

    # Передача только summary_text (остальное None) сохраняет темы и рекомендации
    err, s2, _ = _call_tool(
        client,
        secret,
        "save_summary",
        {"board_id_or_slug": board_id, "summary_text": "Обновлённый текст"},
    )
    assert not err
    assert s2["id"] == s1["id"]
    assert s2["summary_text"] == "Обновлённый текст"
    assert s2["key_themes"] == ["Автодеплой"]
    assert s2["recommendations"] == ["Убрать ручные шаги"]

    err, fetched, _ = _call_tool(
        client, secret, "get_board_summary", {"board_id_or_slug": board_id}
    )
    assert not err
    assert fetched["key_themes"] == ["Автодеплой"]
    assert fetched["recommendations"] == ["Убрать ручные шаги"]
    err, ws_themes, _ = _call_tool(client, secret, "list_workspace_themes")
    assert not err
    assert any(t["name"] == "Автодеплой" for t in ws_themes)

    # Явная передача пустых списков очищает и темы, и рекомендации
    err, s3, _ = _call_tool(
        client,
        secret,
        "save_summary",
        {
            "board_id_or_slug": board_id,
            "summary_text": "Без тем и рекомендаций",
            "key_themes": [],
            "recommendations": [],
        },
    )
    assert not err
    assert s3["key_themes"] == []
    assert s3["recommendations"] == []
    err, ws_themes_after, _ = _call_tool(client, secret, "list_workspace_themes")
    assert not err
    assert not any(t["name"] == "Автодеплой" for t in ws_themes_after)


def test_mcp_workspace_isolation(
    client, db_session, test_workspace, workspace_headers, admin_headers, sample_board
):
    other_ws = client.post(
        "/api/admin/workspaces",
        json={"name": "Команда B", "slug": "team-b", "access_key": "secret-team-b"},
        headers=admin_headers,
    ).json()
    other_token = client.post(
        f"/api/admin/workspaces/{other_ws['id']}/agent-tokens",
        json={"name": "Бот B", "scope": "read_write"},
        headers=admin_headers,
    ).json()["secret"]

    err_board, _, _ = _call_tool(
        client, other_token, "get_board", {"board_id_or_slug": sample_board["id"]}
    )
    assert err_board

    # DELETE /mcp в stateless_http=True отклоняется по протоколу (405 Method Not Allowed)
    del_resp = client.delete(
        "/mcp",
        headers={
            **_MCP_HEADERS_BASE,
            "Authorization": f"Bearer {other_token}",
            "MCP-Protocol-Version": "2025-11-25",
        },
    )
    assert del_resp.status_code == 405

    col_id = client.get(f"/api/boards/{sample_board['id']}", headers=workspace_headers).json()["columns"][0]["id"]
    err_card, _, _ = _call_tool(
        client, other_token, "create_card", {"column_id": col_id, "text": "Чужая доска"}
    )
    assert err_card


def test_mcp_summary_merges_themes_caps_rec_and_handles_race(
    client, db_session, workspace_headers, sample_board
):
    from sqlalchemy.exc import IntegrityError

    from app.services import boards as boards_service

    secret = _create_token(client, workspace_headers, "Summary Bot", "read_write")["secret"]

    # Слишком длинная рекомендация отклоняется явной ошибкой
    err_long, long_msg, _ = _call_tool(
        client,
        secret,
        "save_summary",
        {
            "board_id_or_slug": sample_board["id"],
            "summary_text": "Итоги спринта",
            "recommendations": ["x" * 501],
        },
    )
    assert err_long
    assert "500" in str(long_msg)

    # Одновременная передача themes_payload и key_themes сохраняет оба источника без дублей
    err_ok, summary, _ = _call_tool(
        client,
        secret,
        "save_summary",
        {
            "board_id_or_slug": sample_board["id"],
            "summary_text": "Релиз прошёл стабильно",
            "themes_payload": [{"name": "Автотесты", "description": "Нужны e2e"}],
            "key_themes": ["Автотесты", "Мониторинг"],
            "recommendations": ["Добавить алерты на латентность"],
        },
    )
    assert not err_ok
    assert summary["key_themes"] == ["Автотесты", "Мониторинг"]

    # Имитация гонки INSERT при одинаковом (board_id, session_id): IntegrityError -> обновление существующей записи
    board = db_session.get(models.Board, sample_board["id"])
    assert board is not None
    orig_commit = db_session.commit
    failed_once = False

    def _race_once_commit():
        nonlocal failed_once
        if not failed_once:
            failed_once = True
            raise IntegrityError("INSERT INTO board_summaries", {}, Exception("duplicate key"))
        return orig_commit()

    db_session.commit = _race_once_commit
    try:
        out, _broadcasts = boards_service.persist_board_summary_sync(
            db_session,
            board,
            board.workspace_id,
            summary_text="Обновлённый после гонки итог",
            key_themes=["Мониторинг"],
            recommendations=["Проверить логи"],
            update_latest_when_no_session=True,
        )
    finally:
        db_session.commit = orig_commit

    assert failed_once
    assert out.summary_text == "Обновлённый после гонки итог"
    assert out.key_themes == ["Мониторинг"]


def test_mcp_and_rest_block_updating_superseded_action_item(
    client, workspace_headers, sample_board
):
    secret = _create_token(client, workspace_headers, "Carry Bot", "read_write")["secret"]

    created_task = client.post(
        "/api/action-items/",
        json={
            "board_id": sample_board["id"],
            "title": "Старая задача",
            "text": "Перенести в следующий спринт",
        },
        headers=workspace_headers,
    )
    assert created_task.status_code == 201
    old_item_id = created_task.json()["id"]

    # Создаём новую доску с переносом открытых задач -> оригинал получает superseded_by_id
    err_b, new_board, _ = _call_tool(
        client,
        secret,
        "create_board",
        {
            "name": "Следующий спринт",
            "source_board_id_or_slug": sample_board["id"],
            "carry_forward_items": True,
        },
    )
    assert not err_b
    err_items, carried_items, _ = _call_tool(
        client, secret, "list_action_items", {"board_id_or_slug": new_board["id"]}
    )
    assert not err_items
    assert len(carried_items["items"]) == 1

    # Попытка обновить перенесённый оригинал отклоняется и по MCP, и по REST (409)
    err_upd, err_msg, _ = _call_tool(
        client,
        secret,
        "update_action_item",
        {"item_id": old_item_id, "status": "done"},
    )
    assert err_upd
    assert "Перенесённую задачу" in str(err_msg)

    rest_resp = client.patch(
        f"/api/action-items/{old_item_id}",
        json={"status": "done"},
        headers=workspace_headers,
    )
    assert rest_resp.status_code == 409


@pytest.mark.anyio
async def test_mcp_real_streamable_http_client_and_concurrent_context_isolation(tmp_path):
    """Проверка реальным клиентом `mcp.ClientSession` и изоляции ContextVar при параллельных вызовах."""
    import bcrypt
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker

    from app.database import Base
    from app.services.agent_tokens import create_agent_token
    from tests.conftest import USE_POSTGRES, TestSessionLocal

    if USE_POSTGRES:
        file_engine = None
        SessionFactory = TestSessionLocal
    else:
        # Отдельный файловый SQLite без StaticPool, чтобы два потока anyio не делили один C-хендл sqlite3
        db_file = tmp_path / "mcp_concurrent.db"
        file_engine = create_engine(
            f"sqlite:///{db_file}",
            connect_args={"check_same_thread": False},
        )
        Base.metadata.create_all(bind=file_engine)
        SessionFactory = sessionmaker(autocommit=False, autoflush=False, bind=file_engine)

    with SessionFactory() as seed_db:
        ws_a = models.Workspace(
            id="ws-mcp-a",
            slug="mcp-a",
            name="Команда A",
            access_key_hash=bcrypt.hashpw(b"key-a-1234", bcrypt.gensalt(rounds=4)).decode(),
        )
        ws_b = models.Workspace(
            id="ws-mcp-b",
            slug="mcp-b",
            name="Команда B",
            access_key_hash=bcrypt.hashpw(b"key-b-1234", bcrypt.gensalt(rounds=4)).decode(),
        )
        seed_db.add_all([ws_a, ws_b])
        seed_db.flush()
        board_a = models.Board(id="board-a", name="Доска Alpha", slug="alpha", workspace_id=ws_a.id)
        board_b = models.Board(id="board-b", name="Доска Beta", slug="beta", workspace_id=ws_b.id)
        seed_db.add_all([board_a, board_b])
        seed_db.commit()

        _, secret_a = create_agent_token(seed_db, ws_a.id, name="AlphaBot", scope="read_only")
        _, secret_b = create_agent_token(seed_db, ws_b.id, name="BetaBot", scope="read_write")

    set_db_session_factory(SessionFactory)
    try:
        async with mcp_lifespan():
            async def _fetch_boards(secret: str) -> tuple[list[str], list[str]]:
                async with httpx.AsyncClient(
                    transport=httpx.ASGITransport(app=app),
                    base_url="http://testserver",
                    headers={"Authorization": f"Bearer {secret}"},
                ) as http_client:
                    async with streamable_http_client(
                        "http://testserver/mcp",
                        http_client=http_client,
                    ) as (read_stream, write_stream):
                        async with ClientSession(read_stream, write_stream) as session:
                            await session.initialize()
                            tools = await session.list_tools()
                            res = await session.call_tool("list_boards", {})
                            assert not res.is_error
                            names = [item["name"] for item in res.structured_content["items"]]
                            return [t.name for t in tools.tools], names

            (tools_a, boards_a), (tools_b, boards_b) = await asyncio.gather(
                _fetch_boards(secret_a),
                _fetch_boards(secret_b),
            )
            assert len(tools_a) == 9
            assert len(tools_b) == 15
            assert boards_a == ["Доска Alpha"]
            assert boards_b == ["Доска Beta"]
    finally:
        set_db_session_factory(None)
        if file_engine is not None:
            file_engine.dispose()
