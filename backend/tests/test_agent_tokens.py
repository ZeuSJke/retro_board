"""Тесты жизненного цикла токенов MCP-агентов (REST + админка + изоляция + CSRF)."""

from fastapi.testclient import TestClient

from app import models
from app.config import settings
from app.database import get_db
from app.services.agent_tokens import hash_token, resolve_agent_token
from app.workspace_auth import issue_session_token
from main import app


def _mcp_init_payload() -> dict:
    return {
        "jsonrpc": "2.0",
        "id": 1,
        "method": "initialize",
        "params": {
            "protocolVersion": "2025-11-25",
            "capabilities": {},
            "clientInfo": {"name": "pytest", "version": "1.0"},
        },
    }


def _mcp_headers(secret: str) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {secret}",
        "Accept": "application/json, text/event-stream",
    }


def test_workspace_agent_token_crud_and_secret_hashing(
    client, db_session, test_workspace, workspace_headers
):
    create_resp = client.post(
        "/api/workspaces/agent-tokens",
        json={"name": "Спринт-бот", "scope": "read_write"},
        headers=workspace_headers,
    )
    assert create_resp.status_code == 201, create_resp.text
    payload = create_resp.json()
    secret = payload["secret"]
    token_meta = payload["token"]

    assert secret.startswith("rba_")
    assert token_meta["name"] == "Спринт-бот"
    assert token_meta["scope"] == "read_write"
    assert token_meta["token_prefix"] == secret[:12]
    assert token_meta["revoked_at"] is None
    assert token_meta["last_used_at"] is None

    db_token = db_session.get(models.AgentToken, token_meta["id"])
    assert db_token is not None
    assert db_token.token_hash == hash_token(secret)
    assert db_token.token_hash != secret
    assert secret not in db_token.token_hash

    participant = db_session.get(models.Participant, db_token.participant_id)
    assert participant is not None
    assert participant.kind == "agent"
    assert participant.name == "Спринт-бот"
    assert participant.revoked_at is None

    second_resp = client.post(
        "/api/workspaces/agent-tokens",
        json={"name": "Читатель", "scope": "read_only"},
        headers=workspace_headers,
    )
    assert second_resp.status_code == 201

    list_resp = client.get("/api/workspaces/agent-tokens", headers=workspace_headers)
    assert list_resp.status_code == 200
    items = list_resp.json()
    assert len(items) == 2
    assert all("secret" not in item for item in items)

    revoke_resp = client.delete(
        f"/api/workspaces/agent-tokens/{token_meta['id']}",
        headers=workspace_headers,
    )
    assert revoke_resp.status_code == 200
    revoked_data = revoke_resp.json()
    assert revoked_data["revoked_at"] is not None

    db_session.expire_all()
    assert db_session.get(models.Participant, participant.id).revoked_at is not None
    assert resolve_agent_token(db_session, secret) is None

    # Повторный отзыв идемпотентен
    revoke_again = client.delete(
        f"/api/workspaces/agent-tokens/{token_meta['id']}",
        headers=workspace_headers,
    )
    assert revoke_again.status_code == 200


def test_admin_agent_token_crud_and_workspace_isolation(
    client, db_session, test_workspace, workspace_headers, admin_headers
):
    other_ws = client.post(
        "/api/admin/workspaces",
        json={"name": "Другая команда", "slug": "other-team", "access_key": "othersecret99"},
        headers=admin_headers,
    ).json()

    # Без админской авторизации недоступно
    assert (
        client.get(f"/api/admin/workspaces/{test_workspace.id}/agent-tokens").status_code == 401
    )

    created = client.post(
        f"/api/admin/workspaces/{other_ws['id']}/agent-tokens",
        json={"name": "Бот другой команды", "scope": "read_only"},
        headers=admin_headers,
    )
    assert created.status_code == 201
    other_id = created.json()["token"]["id"]

    admin_list = client.get(
        f"/api/admin/workspaces/{other_ws['id']}/agent-tokens",
        headers=admin_headers,
    )
    assert admin_list.status_code == 200
    assert [t["id"] for t in admin_list.json()] == [other_id]

    # Команда A не видит и не может отозвать токен команды B
    ws_list = client.get("/api/workspaces/agent-tokens", headers=workspace_headers)
    assert ws_list.status_code == 200
    assert ws_list.json() == []

    ws_revoke = client.delete(
        f"/api/workspaces/agent-tokens/{other_id}",
        headers=workspace_headers,
    )
    assert ws_revoke.status_code == 404

    # Админ может отозвать в целевой команде, но не через чужой workspace_id
    wrong_admin_revoke = client.delete(
        f"/api/admin/workspaces/{test_workspace.id}/agent-tokens/{other_id}",
        headers=admin_headers,
    )
    assert wrong_admin_revoke.status_code == 404

    ok_admin_revoke = client.delete(
        f"/api/admin/workspaces/{other_ws['id']}/agent-tokens/{other_id}",
        headers=admin_headers,
    )
    assert ok_admin_revoke.status_code == 200
    assert ok_admin_revoke.json()["revoked_at"] is not None


def test_agent_participant_cannot_mint_new_tokens(
    client, db_session, test_workspace, workspace_headers
):
    created = client.post(
        "/api/workspaces/agent-tokens",
        json={"name": "Агент", "scope": "read_write"},
        headers=workspace_headers,
    ).json()
    token_row = db_session.get(models.AgentToken, created["token"]["id"])
    participant = db_session.get(models.Participant, token_row.participant_id)
    session_jwt = issue_session_token(test_workspace, participant)

    resp = client.post(
        "/api/workspaces/agent-tokens",
        json={"name": "Дочерний агент", "scope": "read_write"},
        headers={"X-Workspace-Token": session_jwt},
    )
    assert resp.status_code == 403


def test_workspace_key_rotation_does_not_revoke_agent_tokens(
    client, db_session, test_workspace, workspace_headers, admin_headers
):
    created = client.post(
        "/api/workspaces/agent-tokens",
        json={"name": "Долгоживущий бот", "scope": "read_only"},
        headers=workspace_headers,
    ).json()
    secret = created["secret"]

    rotate = client.patch(
        f"/api/admin/workspaces/{test_workspace.id}",
        json={"access_key": "brandnewkey42"},
        headers=admin_headers,
    )
    assert rotate.status_code == 200

    # Человеческая сессия отозвана ротацией ключа
    me_resp = client.get("/api/workspaces/me", headers=workspace_headers)
    assert me_resp.status_code == 401

    # Агентский токен продолжает работать независимо от смены ключа команды
    db_session.expire_all()
    assert resolve_agent_token(db_session, secret) is not None
    mcp_resp = client.post("/mcp", json=_mcp_init_payload(), headers=_mcp_headers(secret))
    assert mcp_resp.status_code == 200


def test_csrf_protects_agent_token_routes_when_enabled(db_session, test_workspace):
    # Используем локальный клиент с пустыми overrides из фикстуры conftest, не нарушая остальные тесты
    from tests.conftest import TestSessionLocal

    def _override():
        db = TestSessionLocal()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = _override
    prev_csrf = settings.csrf_enabled
    settings.csrf_enabled = True
    try:
        with TestClient(app, base_url="https://testserver") as c:
            login = c.post(
                "/api/workspaces/login",
                json={"workspace_slug": "test-team", "access_key": "testkey123", "name": "Owner"},
            )
            assert login.status_code == 200
            me_resp = c.get("/api/workspaces/me")
            assert me_resp.status_code == 200
            csrf_ws = me_resp.cookies["csrf_token"]

            no_csrf = c.post(
                "/api/workspaces/agent-tokens",
                json={"name": "Бот", "scope": "read_only"},
            )
            assert no_csrf.status_code == 403

            with_csrf = c.post(
                "/api/workspaces/agent-tokens",
                json={"name": "Бот", "scope": "read_only"},
                headers={"X-CSRF-Token": csrf_ws},
            )
            assert with_csrf.status_code == 201
            token_id = with_csrf.json()["token"]["id"]

            # Админские маршруты тоже защищены CSRF при cookie-сессии
            admin_login = c.post(
                "/api/admin/login",
                json={"login": settings.admin_login, "password": settings.admin_password},
            )
            assert admin_login.status_code == 200
            csrf_admin = c.cookies["csrf_token"]

            no_csrf_admin = c.delete(
                f"/api/admin/workspaces/{test_workspace.id}/agent-tokens/{token_id}"
            )
            assert no_csrf_admin.status_code == 403

            with_csrf_admin = c.delete(
                f"/api/admin/workspaces/{test_workspace.id}/agent-tokens/{token_id}",
                headers={"X-CSRF-Token": csrf_admin},
            )
            assert with_csrf_admin.status_code == 200
    finally:
        settings.csrf_enabled = prev_csrf
        app.dependency_overrides.clear()


def test_agent_participant_cannot_manage_agent_tokens_via_workspace_api(
    client, db_session, test_workspace, workspace_headers
):
    from app.workspace_auth import create_workspace_token

    created = client.post(
        "/api/workspaces/agent-tokens",
        json={"name": "Bot", "scope": "read_write"},
        headers=workspace_headers,
    ).json()
    bot_pid = created["token"]["participant_id"]
    token_id = created["token"]["id"]

    bot_jwt = create_workspace_token(
        test_workspace.id,
        test_workspace.slug,
        test_workspace.name,
        bot_pid,
        test_workspace.token_epoch,
    )
    bot_headers = {"X-Workspace-Token": bot_jwt}

    assert client.get("/api/workspaces/agent-tokens", headers=bot_headers).status_code == 403
    assert (
        client.post(
            "/api/workspaces/agent-tokens",
            json={"name": "Nested", "scope": "read_only"},
            headers=bot_headers,
        ).status_code
        == 403
    )
    assert client.delete(f"/api/workspaces/agent-tokens/{token_id}", headers=bot_headers).status_code == 403


def test_mcp_sliding_window_limiter_prunes_stale_and_bounds_buckets(monkeypatch):
    from app.limiter import limiter
    from app.mcp import rate_limit

    prev_enabled = limiter.enabled
    limiter.enabled = True
    try:
        clock = [100.0]
        monkeypatch.setattr(rate_limit.time, "monotonic", lambda: clock[0])

        sw = rate_limit.SlidingWindowLimiter(max_buckets=3)
        assert sw.record_auth_failure("10.0.0.1")
        assert sw.record_auth_failure("10.0.0.2")
        assert sw.record_auth_failure("10.0.0.3")
        assert len(sw._buckets) == 3

        # 4-й активный ключ вытесняет самый старый, словарь не растёт
        assert sw.record_auth_failure("10.0.0.4")
        assert len(sw._buckets) == 3
        assert "auth-fail:10.0.0.1" not in sw._buckets

        # По истечении окна просроченные бакеты вычищаются при следующем обращении
        clock[0] = 200.0
        assert sw.record_auth_failure("10.0.0.5")
        assert list(sw._buckets.keys()) == ["auth-fail:10.0.0.5"]

        for _ in range(rate_limit.MCP_AUTH_FAIL_LIMIT_PER_MINUTE):
            sw.record_auth_failure("10.0.0.6")
        assert sw.is_auth_failure_blocked("10.0.0.6")
        clock[0] = 300.0
        assert not sw.is_auth_failure_blocked("10.0.0.6")
    finally:
        limiter.enabled = prev_enabled
