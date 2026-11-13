"""Tests for audit & bugfix hardening: /workspaces/me, CSRF max-age, validation, cross-board/group guards."""

from app.config import settings


def test_workspace_me_returns_current_workspace(client, workspace_headers):
    resp = client.get("/api/workspaces/me", headers=workspace_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["slug"] == "test-team"
    assert data["name"] == "Test Team"


def test_workspace_me_requires_auth(client):
    resp = client.get("/api/workspaces/me")
    assert resp.status_code == 401


def test_csrf_cookie_max_age_matches_workspace_jwt(client, workspace_headers):
    settings.csrf_enabled = True
    try:
        resp = client.get("/api/workspaces/me", headers=workspace_headers)
        assert resp.status_code == 200
        set_cookies = resp.headers.get_list("set-cookie")
        csrf_cookies = [c for c in set_cookies if "csrf_token=" in c]
        assert csrf_cookies
        expected_max_age = str(settings.workspace_jwt_expire_hours * 3600)
        assert f"Max-Age={expected_max_age}" in csrf_cookies[0]
    finally:
        settings.csrf_enabled = False


def test_move_card_across_boards_returns_400(client, workspace_headers, sample_board, sample_column):
    other_board_resp = client.post(
        "/api/boards/", json={"name": "Other Board"}, headers=workspace_headers
    )
    assert other_board_resp.status_code == 201
    other_col_id = other_board_resp.json()["columns"][0]["id"]

    card_resp = client.post(
        "/api/cards/",
        json={"column_id": sample_column["id"], "text": "Card 1", "author": "User"},
        headers=workspace_headers,
    )
    assert card_resp.status_code == 201
    card_id = card_resp.json()["id"]

    move_resp = client.post(
        f"/api/cards/{card_id}/move",
        json={"column_id": other_col_id, "position": 0},
        headers=workspace_headers,
    )
    assert move_resp.status_code == 400


def test_remove_card_from_wrong_group_returns_400(client, workspace_headers, sample_column):
    c1 = client.post(
        "/api/cards/",
        json={"column_id": sample_column["id"], "text": "C1", "author": "User"},
        headers=workspace_headers,
    ).json()
    c2 = client.post(
        "/api/cards/",
        json={"column_id": sample_column["id"], "text": "C2", "author": "User"},
        headers=workspace_headers,
    ).json()
    c3 = client.post(
        "/api/cards/",
        json={"column_id": sample_column["id"], "text": "C3", "author": "User"},
        headers=workspace_headers,
    ).json()

    grp = client.post(
        "/api/groups/",
        json={"column_id": sample_column["id"], "title": "Group A"},
        headers=workspace_headers,
    )
    assert grp.status_code == 201
    group_id = grp.json()["id"]
    assert client.post(f"/api/groups/{group_id}/set_card/{c1['id']}", headers=workspace_headers).status_code == 200
    assert client.post(f"/api/groups/{group_id}/set_card/{c2['id']}", headers=workspace_headers).status_code == 200

    resp = client.delete(
        f"/api/groups/{group_id}/remove_card/{c3['id']}",
        headers=workspace_headers,
    )
    assert resp.status_code == 400


def test_update_card_assign_group_from_other_column_returns_400(
    client, workspace_headers, sample_board, sample_column
):
    col2_resp = client.post(
        "/api/columns/",
        json={"board_id": sample_board["id"], "title": "Second Col"},
        headers=workspace_headers,
    )
    assert col2_resp.status_code == 201
    col2_id = col2_resp.json()["id"]

    c1 = client.post(
        "/api/cards/",
        json={"column_id": sample_column["id"], "text": "C1", "author": "User"},
        headers=workspace_headers,
    ).json()
    grp = client.post(
        "/api/groups/",
        json={"column_id": sample_column["id"], "title": "Group A"},
        headers=workspace_headers,
    ).json()
    assert client.post(f"/api/groups/{grp['id']}/set_card/{c1['id']}", headers=workspace_headers).status_code == 200

    other_card = client.post(
        "/api/cards/",
        json={"column_id": col2_id, "text": "Other", "author": "User"},
        headers=workspace_headers,
    ).json()

    upd = client.patch(
        f"/api/cards/{other_card['id']}",
        json={"group_id": grp["id"]},
        headers=workspace_headers,
    )
    assert upd.status_code == 400


def test_update_schemas_reject_whitespace_only(client, workspace_headers, sample_board, sample_column):
    assert (
        client.patch(
            f"/api/boards/{sample_board['id']}",
            json={"name": "   "},
            headers=workspace_headers,
        ).status_code
        == 422
    )
    assert (
        client.patch(
            f"/api/columns/{sample_column['id']}",
            json={"title": "   "},
            headers=workspace_headers,
        ).status_code
        == 422
    )
    card = client.post(
        "/api/cards/",
        json={"column_id": sample_column["id"], "text": "Valid", "author": "User"},
        headers=workspace_headers,
    ).json()
    assert (
        client.patch(
            f"/api/cards/{card['id']}",
            json={"text": "   "},
            headers=workspace_headers,
        ).status_code
        == 422
    )
    ai = client.post(
        "/api/action-items/",
        json={"board_id": sample_board["id"], "text": "Action 1"},
        headers=workspace_headers,
    ).json()
    assert (
        client.patch(
            f"/api/action-items/{ai['id']}",
            json={"text": "   "},
            headers=workspace_headers,
        ).status_code
        == 422
    )


def test_punctuation_only_board_name_creates_valid_slug(client, workspace_headers):
    resp = client.post(
        "/api/boards/", json={"name": "!!!"}, headers=workspace_headers
    )
    assert resp.status_code == 201
    slug = resp.json()["slug"]
    assert slug.startswith("board-")
