"""Tests for admin endpoints."""


def test_admin_login_success(client):
    """Успешный администраторский вход."""
    from app.config import settings
    resp = client.post("/api/admin/login", json={
        "login": settings.admin_login,
        "password": settings.admin_password,
    })
    assert resp.status_code == 200
    assert resp.json()["ok"] is True
    assert "admin_token" in resp.cookies


def test_admin_login_wrong_password(client):
    """Администраторский вход с неверным паролем → 401."""
    resp = client.post("/api/admin/login", json={
        "login": "admin",
        "password": "wrongpassword",
    })
    assert resp.status_code == 401


def test_admin_login_wrong_login(client):
    """Администраторский вход с неверным логином → 401."""
    from app.config import settings
    resp = client.post("/api/admin/login", json={
        "login": "wronglogin",
        "password": settings.admin_password,
    })
    assert resp.status_code == 401


def test_admin_session_without_login_is_200(client):
    """Проверка сессии без входа — 200 и authenticated=false, без 401."""
    resp = client.get("/api/admin/session")

    assert resp.status_code == 200
    assert resp.json() == {"authenticated": False}
    assert resp.headers["cache-control"] == "no-store"


def test_admin_session_with_bad_token_is_200(client):
    """Испорченный admin_token не роняет проверку: 200 и authenticated=false."""
    resp = client.get("/api/admin/session", headers={"Cookie": "admin_token=broken"})

    assert resp.status_code == 200
    assert resp.json() == {"authenticated": False}
    assert resp.headers["cache-control"] == "no-store"


def test_admin_session_with_login_is_200(client, admin_headers):
    """Проверка сессии после входа — 200 и authenticated=true."""
    resp = client.get("/api/admin/session", headers=admin_headers)

    assert resp.status_code == 200
    assert resp.json() == {"authenticated": True}
    assert resp.headers["cache-control"] == "no-store"


def test_admin_list_workspaces_requires_auth(client):
    """GET /api/admin/workspaces без аутентификации → 401."""
    resp = client.get("/api/admin/workspaces")
    assert resp.status_code == 401


def test_admin_list_workspaces_success(client, admin_headers, test_workspace):
    """GET /api/admin/workspaces с аутентификацией → список workspaces."""
    resp = client.get("/api/admin/workspaces", headers=admin_headers)
    assert resp.status_code == 200
    workspaces = resp.json()
    assert len(workspaces) >= 1
    assert any(ws["id"] == "test-workspace-id" for ws in workspaces)


def test_admin_create_workspace(client, admin_headers):
    """POST /api/admin/workspaces создает новый workspace."""
    resp = client.post("/api/admin/workspaces", json={
        "slug": "new-team",
        "name": "New Team",
        "access_key": "newsecret123",
    }, headers=admin_headers)
    assert resp.status_code == 201
    data = resp.json()
    assert data["slug"] == "new-team"
    assert data["name"] == "New Team"
    # Счётчик приходит сразу: таблице в админке не нужна перезагрузка
    assert data["boards_count"] == 0


def test_admin_create_workspace_duplicate_slug(client, admin_headers, test_workspace):
    """POST /api/admin/workspaces с дублирующимся slug → 409."""
    resp = client.post("/api/admin/workspaces", json={
        "slug": "test-team",
        "name": "Another Team",
        "access_key": "key123",
    }, headers=admin_headers)
    assert resp.status_code == 409
    assert "уже существует" in resp.json()["detail"]


def test_admin_update_workspace_name(client, admin_headers, test_workspace):
    """PATCH /api/admin/workspaces/{id} обновляет имя."""
    resp = client.patch(
        f"/api/admin/workspaces/{test_workspace.id}",
        json={"name": "Renamed Team"},
        headers=admin_headers,
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["name"] == "Renamed Team"
    assert data["slug"] == "test-team"  # slug не меняется


def test_admin_update_workspace_key(client, admin_headers, test_workspace):
    """PATCH /api/admin/workspaces/{id} обновляет ключ доступа."""
    resp = client.patch(
        f"/api/admin/workspaces/{test_workspace.id}",
        json={"access_key": "newkey123"},
        headers=admin_headers,
    )
    assert resp.status_code == 200

    # Проверить что новый ключ работает
    login_resp = client.post("/api/workspaces/login", json={
        "workspace_slug": "test-team",
        "access_key": "newkey123",
    })
    assert login_resp.status_code == 200

    # Старый ключ больше не работает
    old_login_resp = client.post("/api/workspaces/login", json={
        "workspace_slug": "test-team",
        "access_key": "testkey123",
    })
    assert old_login_resp.status_code == 401


def test_admin_delete_workspace(client, admin_headers, test_workspace):
    """DELETE /api/admin/workspaces/{id} удаляет workspace."""
    resp = client.delete(
        f"/api/admin/workspaces/{test_workspace.id}",
        headers=admin_headers,
    )
    assert resp.status_code == 204

    # Проверить что workspace удален
    login_resp = client.post("/api/workspaces/login", json={
        "workspace_slug": "test-team",
        "access_key": "testkey123",
    })
    assert login_resp.status_code == 401


def test_admin_delete_nonexistent_workspace(client, admin_headers):
    """DELETE /api/admin/workspaces/{id} для несуществующего → 404."""
    resp = client.delete(
        "/api/admin/workspaces/nonexistent-id",
        headers=admin_headers,
    )
    assert resp.status_code == 404


def test_admin_logout(client, admin_headers):
    """POST /api/admin/logout удаляет cookie."""
    resp = client.post("/api/admin/logout", headers=admin_headers)
    assert resp.status_code == 200
    assert resp.json()["ok"] is True
    # Проверить что admin_token cookie удален
    assert "admin_token" not in resp.cookies or resp.cookies["admin_token"].value == ""


def test_admin_list_workspaces_with_boards_count(client, admin_headers, workspace_headers, sample_board):
    """GET /api/admin/workspaces включает boards_count."""
    resp = client.get("/api/admin/workspaces", headers=admin_headers)
    assert resp.status_code == 200
    workspaces = resp.json()
    test_ws = next(w for w in workspaces if w["id"] == "test-workspace-id")
    assert test_ws["boards_count"] == 1


def test_admin_boards_count_is_per_team_and_skips_deleted(
    client, admin_headers, workspace_headers, sample_board
):
    """Счётчик считается по каждой команде отдельно и не включает удалённые доски."""
    created = client.post(
        "/api/admin/workspaces",
        json={"slug": "empty-team", "name": "Пустая команда", "access_key": "key12345"},
        headers=admin_headers,
    )
    assert created.status_code == 201

    def counts():
        rows = client.get("/api/admin/workspaces", headers=admin_headers).json()
        return {w["slug"]: w["boards_count"] for w in rows}

    assert counts() == {"test-team": 1, "empty-team": 0}
    assert client.delete(f"/api/boards/{sample_board['id']}", headers=workspace_headers).status_code == 204
    assert counts() == {"test-team": 0, "empty-team": 0}
