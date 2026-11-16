"""Tests for workspace login and auth."""


def test_workspace_login_success(client, test_workspace):
    """Успешный вход в workspace."""
    resp = client.post(
        "/api/workspaces/login",
        json={"workspace_slug": "test-team", "access_key": "testkey123"},
    )
    assert resp.status_code == 200
    data = resp.json()
    # Токен сессии уходит только в httpOnly-cookie, в теле ответа его нет
    assert "token" not in data
    set_cookie = resp.headers["set-cookie"]
    assert "workspace_token=" in set_cookie and "HttpOnly" in set_cookie
    assert data["participant"]["name"] == "Участник"
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
    assert "Требуется вход в команду" in resp.json()["detail"]


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
    headers2 = {"X-Workspace-Token": resp_login.cookies["workspace_token"]}
    client.cookies.clear()

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
    headers2 = {"X-Workspace-Token": resp_login.cookies["workspace_token"]}
    client.cookies.clear()

    # Попытка получить доску из первого workspace вторым → 404
    resp = client.get(f"/api/boards/{sample_board['id']}", headers=headers2)
    assert resp.status_code == 404


def test_cross_workspace_isolation_for_child_entities_and_admin_pagination(
    client, db_session, workspace_headers, admin_headers, sample_board
):
    """Изоляция между командами: колонки, карточки, группы, задачи, итоги, настроение, health check."""
    import bcrypt

    from app.models import Workspace

    col_id = sample_board["columns"][0]["id"]
    card_id = client.post(
        "/api/cards/",
        json={"column_id": col_id, "text": "Секрет команды 1"},
        headers=workspace_headers,
    ).json()["id"]
    group_id = client.post(
        "/api/groups/",
        json={"column_id": col_id, "title": "Группа 1"},
        headers=workspace_headers,
    ).json()["id"]
    action_id = client.post(
        "/api/action-items/",
        json={"board_id": sample_board["id"], "text": "Задача 1"},
        headers=workspace_headers,
    ).json()["id"]

    ws2 = Workspace(
        id="workspace-2",
        slug="team-2",
        name="Team 2",
        access_key_hash=bcrypt.hashpw(b"key2", bcrypt.gensalt(rounds=4)).decode(),
    )
    ws3 = Workspace(
        id="workspace-3",
        slug="team-3",
        name="Team 3",
        access_key_hash=bcrypt.hashpw(b"key3", bcrypt.gensalt(rounds=4)).decode(),
    )
    db_session.add_all([ws2, ws3])
    db_session.commit()

    resp_login = client.post(
        "/api/workspaces/login", json={"workspace_slug": "team-2", "access_key": "key2"}
    )
    headers2 = {"X-Workspace-Token": resp_login.cookies["workspace_token"]}
    client.cookies.clear()

    # Дочерние ресурсы первой команды недоступны из второй
    assert client.patch(f"/api/columns/{col_id}", json={"title": "X"}, headers=headers2).status_code == 404
    assert client.delete(f"/api/columns/{col_id}", headers=headers2).status_code == 404
    assert client.post("/api/cards/", json={"column_id": col_id, "text": "x"}, headers=headers2).status_code == 404
    assert client.patch(f"/api/cards/{card_id}", json={"text": "x"}, headers=headers2).status_code == 404
    assert client.post(f"/api/cards/{card_id}/like", headers=headers2).status_code == 404
    assert client.delete(f"/api/cards/{card_id}", headers=headers2).status_code == 404
    assert client.post("/api/groups/", json={"column_id": col_id, "title": "g"}, headers=headers2).status_code == 404
    assert client.patch(f"/api/groups/{group_id}", json={"title": "g2"}, headers=headers2).status_code == 404
    assert client.delete(f"/api/groups/{group_id}", headers=headers2).status_code == 404
    assert client.get(f"/api/action-items/?board_id={sample_board['id']}", headers=headers2).status_code == 404
    assert client.patch(f"/api/action-items/{action_id}", json={"status": "done"}, headers=headers2).status_code == 404
    assert client.delete(f"/api/action-items/{action_id}", headers=headers2).status_code == 404
    assert client.get("/api/action-items/all", headers=headers2).json() == []
    assert client.get(f"/api/boards/{sample_board['id']}/summary", headers=headers2).status_code == 404
    assert client.post(f"/api/boards/{sample_board['id']}/mood", json={"score": 5}, headers=headers2).status_code == 404
    assert client.get(f"/api/boards/{sample_board['id']}/health-check", headers=headers2).status_code == 404
    assert (
        client.post(
            f"/api/boards/{sample_board['id']}/health-check",
            json={"answers": [{"question_id": "mission", "score": 3}]},
            headers=headers2,
        ).status_code
        == 404
    )

    # Пагинация GET /api/admin/workspaces
    admin_p1 = client.get("/api/admin/workspaces?limit=2&offset=0", headers=admin_headers)
    assert admin_p1.status_code == 200
    assert admin_p1.headers["X-Total-Count"] == "3"
    assert len(admin_p1.json()) == 2
    admin_p2 = client.get("/api/admin/workspaces?limit=2&offset=2", headers=admin_headers)
    assert admin_p2.status_code == 200
    assert admin_p2.headers["X-Total-Count"] == "3"
    assert len(admin_p2.json()) == 1
    assert {w["id"] for w in admin_p1.json() + admin_p2.json()} == {
        "test-workspace-id",
        "workspace-2",
        "workspace-3",
    }
