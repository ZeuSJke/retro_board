"""
Аудит-гарды soft-delete и slug-коллизий (fix/audit-batch-1).

Проверяют контракт после backend-фиксов:
- write-пути в soft-deleted доску → 404 (helper require_live_board);
- коллизия slug при разных name → 409, а не 500 (IntegrityError-guard);
- update soft-deleted доски → 404.

Используют существующие фикстуры conftest: client, workspace_headers,
sample_board, sample_column.
"""


def _delete_board(client, board_id, headers):
    resp = client.delete(f"/api/boards/{board_id}", headers=headers)
    assert resp.status_code == 204
    return resp


def test_create_card_in_soft_deleted_board_returns_404(
    client, workspace_headers, sample_board, sample_column
):
    """Запись карточки в колонку soft-deleted доски → 404."""
    _delete_board(client, sample_board["id"], workspace_headers)

    resp = client.post(
        "/api/cards/",
        json={
            "column_id": sample_column["id"],
            "text": "Should not be created",
            "author": "Tester",
            "color": "#FFEB3B",
        },
        headers=workspace_headers,
    )
    assert resp.status_code == 404


def test_create_column_in_soft_deleted_board_returns_404(
    client, workspace_headers, sample_board
):
    """Создание колонки в soft-deleted доске → 404."""
    _delete_board(client, sample_board["id"], workspace_headers)

    resp = client.post(
        "/api/columns/",
        json={"board_id": sample_board["id"], "title": "New column"},
        headers=workspace_headers,
    )
    assert resp.status_code == 404


def test_slug_collision_disambiguates_not_500(client, workspace_headers):
    """Два разных name с одним базовым slug → 201 с уникальным суффиксом, а не 500;
    одинаковое name по-прежнему → 409.
    """
    first = client.post(
        "/api/boards/", json={"name": "Test Board"}, headers=workspace_headers
    )
    assert first.status_code == 201

    second = client.post(
        "/api/boards/", json={"name": "Test Board!"}, headers=workspace_headers
    )
    assert second.status_code == 201
    assert second.json()["slug"] != first.json()["slug"]

    dup = client.post(
        "/api/boards/", json={"name": "Test Board"}, headers=workspace_headers
    )
    assert dup.status_code == 409


def test_update_soft_deleted_board_returns_404(
    client, workspace_headers, sample_board
):
    """PATCH soft-deleted доски → 404."""
    _delete_board(client, sample_board["id"], workspace_headers)

    resp = client.patch(
        f"/api/boards/{sample_board['id']}",
        json={"name": "Renamed"},
        headers=workspace_headers,
    )
    assert resp.status_code == 404
