"""Tests for workspace login and auth."""

import pytest


def test_workspace_login_success(client, test_workspace):
    """Успешный вход в workspace."""
    resp = client.post(
        "/api/workspaces/login",
        json={"workspace_slug": "test-team", "access_key": "testkey123"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert "token" in data
    assert data["workspace_slug"] == "test-team"
    assert data["workspace_name"] == "Test Team"
    assert data["workspace_id"] == "test-workspace-id"


def test_workspace_login_wrong_key(client, test_workspace):
    """Вход с неверным ключом → 401."""
    resp = client.post(
        "/api/workspaces/login",
        json={"workspace_slug": "test-team", "access_key": "wrongkey"},
    )
    assert resp.status_code == 401
    assert "Неверный код команды или ключ доступа" in resp.json()["detail"]


def test_workspace_login_unknown_slug(client):
    """Вход в несуществующий workspace → 401."""
    resp = client.post(
        "/api/workspaces/login",
        json={"workspace_slug": "nonexistent", "access_key": "anykey"},
    )
    assert resp.status_code == 401


def test_list_boards_requires_workspace_token(client, workspace_headers):
    """GET /api/boards/ без токена → 401."""
    resp = client.get("/api/boards/")
    assert resp.status_code == 401
    assert "Workspace authentication required" in resp.json()["detail"]


def test_list_boards_with_workspace_token(client, workspace_headers, sample_board):
    """GET /api/boards/ с корректным токеном → успех."""
    resp = client.get("/api/boards/", headers=workspace_headers)
    assert resp.status_code == 200
    boards = resp.json()
    assert len(boards) == 1
    assert boards[0]["name"] == "Test Board"


def test_create_board_without_workspace_token(client):
    """POST /api/boards/ без токена → 401."""
    resp = client.post("/api/boards/", json={"name": "New Board"})
    assert resp.status_code == 401


def test_create_board_with_workspace_token(client, workspace_headers):
    """POST /api/boards/ с токеном → успех."""
    resp = client.post(
        "/api/boards/", json={"name": "New Board"}, headers=workspace_headers
    )
    assert resp.status_code == 201
    data = resp.json()
    assert data["name"] == "New Board"
    assert data["workspace_id"] == "test-workspace-id"


def test_board_isolation_between_workspaces(client, db_session, workspace_headers):
    """Доски одного workspace не видны в другом."""
    # Создать доску в первом workspace
    resp1 = client.post(
        "/api/boards/", json={"name": "Board A"}, headers=workspace_headers
    )
    assert resp1.status_code == 201

    # Создать второй workspace
    import bcrypt
    from app.models import Workspace

    ws2 = Workspace(
        id="workspace-2",
        slug="team-2",
        name="Team 2",
        access_key_hash=bcrypt.hashpw(b"key2", bcrypt.gensalt(rounds=4)).decode(),
    )
    db_session.add(ws2)
    db_session.commit()

    # Получить токен для второго workspace
    resp_login = client.post(
        "/api/workspaces/login", json={"workspace_slug": "team-2", "access_key": "key2"}
    )
    assert resp_login.status_code == 200
    token2 = resp_login.json()["token"]
    headers2 = {"X-Workspace-Token": token2}

    # Список досок во втором workspace должен быть пуст
    resp2 = client.get("/api/boards/", headers=headers2)
    assert resp2.status_code == 200
    assert len(resp2.json()) == 0


def test_get_board_cross_workspace_fails(
    client, db_session, workspace_headers, sample_board
):
    """Доступ к доске из другого workspace → 404."""
    # Создать второй workspace
    import bcrypt
    from app.models import Workspace

    ws2 = Workspace(
        id="workspace-2",
        slug="team-2",
        name="Team 2",
        access_key_hash=bcrypt.hashpw(b"key2", bcrypt.gensalt(rounds=4)).decode(),
    )
    db_session.add(ws2)
    db_session.commit()

    # Получить токен для второго workspace
    resp_login = client.post(
        "/api/workspaces/login", json={"workspace_slug": "team-2", "access_key": "key2"}
    )
    token2 = resp_login.json()["token"]
    headers2 = {"X-Workspace-Token": token2}

    # Попытка получить доску из первого workspace вторым → 404
    resp = client.get(f"/api/boards/{sample_board['id']}", headers=headers2)
    assert resp.status_code == 404
