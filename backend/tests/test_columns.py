"""Tests for /api/columns/ endpoints."""


class TestCreateColumn:
    def test_returns_201(self, client, sample_board, workspace_headers):
        resp = client.post("/api/columns/", json={
            "board_id": sample_board["id"],
            "title": "Action Items",
            "color": "#1565C0",
        }, headers=workspace_headers)
        assert resp.status_code == 201
        data = resp.json()
        assert data["title"] == "Action Items"
        assert data["color"] == "#1565C0"
        assert data["board_id"] == sample_board["id"]

    def test_position_auto_increments(self, client, sample_board, workspace_headers):
        # Board already has 3 default columns (positions 0, 1, 2)
        resp = client.post("/api/columns/", json={
            "board_id": sample_board["id"],
            "title": "Extra Column",
        }, headers=workspace_headers)
        assert resp.json()["position"] == 3

    def test_board_not_found_returns_404(self, client, workspace_headers):
        resp = client.post("/api/columns/", json={
            "board_id": "nonexistent-board",
            "title": "X",
        }, headers=workspace_headers)
        assert resp.status_code == 404

    def test_invalid_color_returns_422(self, client, sample_board, workspace_headers):
        resp = client.post("/api/columns/", json={
            "board_id": sample_board["id"],
            "title": "Bad",
            "color": "blue",
        }, headers=workspace_headers)
        assert resp.status_code == 422


class TestUpdateColumn:
    def test_update_title(self, client, sample_column, workspace_headers):
        resp = client.patch(
            f"/api/columns/{sample_column['id']}",
            json={"title": "New Title"},
            headers=workspace_headers,
        )
        assert resp.status_code == 200
        assert resp.json()["title"] == "New Title"

    def test_update_color(self, client, sample_column, workspace_headers):
        resp = client.patch(
            f"/api/columns/{sample_column['id']}",
            json={"color": "#FF5722"},
            headers=workspace_headers,
        )
        assert resp.status_code == 200
        assert resp.json()["color"] == "#FF5722"

    def test_update_invalid_color_returns_422(self, client, sample_column, workspace_headers):
        resp = client.patch(
            f"/api/columns/{sample_column['id']}",
            json={"color": "not-a-color"},
            headers=workspace_headers,
        )
        assert resp.status_code == 422

    def test_update_position(self, client, sample_column, workspace_headers):
        # Board has 3 default columns; moving last column to position 0
        resp = client.patch(
            f"/api/columns/{sample_column['id']}",
            json={"position": 0},
            headers=workspace_headers,
        )
        assert resp.status_code == 200
        assert resp.json()["position"] == 0

    def test_reorder_after_delete_uses_place_in_list(self, client, sample_board, workspace_headers):
        """После удаления колонки позиции идут с пропуском; «место N» — это номер в списке.

        Раньше запрос «на место 1» для колонки с сохранённой позицией 1 молча игнорировался,
        хотя после удаления соседней она стояла в списке на месте 0.
        """
        board_url = f"/api/boards/{sample_board['id']}"
        extra = client.post(
            "/api/columns/",
            json={"board_id": sample_board["id"], "title": "Четвёртая"},
            headers=workspace_headers,
        ).json()
        first, second, third = client.get(board_url, headers=workspace_headers).json()["columns"][:3]
        # Удаляем первую: у оставшихся сохранённые позиции 1, 2, 3
        assert client.delete(f"/api/columns/{first['id']}", headers=workspace_headers).status_code == 204

        # «Вторая» стоит на месте 0, её сохранённая позиция — 1. Просим место 1.
        resp = client.patch(
            f"/api/columns/{second['id']}", json={"position": 1}, headers=workspace_headers
        )
        assert resp.status_code == 200 and resp.json()["position"] == 1

        columns = client.get(board_url, headers=workspace_headers).json()["columns"]
        assert [col["id"] for col in columns] == [third["id"], second["id"], extra["id"]]
        assert [col["position"] for col in columns] == [0, 1, 2]

    def test_not_found_returns_404(self, client, workspace_headers):
        resp = client.patch("/api/columns/no-id", json={"title": "X"}, headers=workspace_headers)
        assert resp.status_code == 404

    def test_rename_column_with_cards(self, client, sample_card, sample_column, workspace_headers):
        resp = client.patch(
            f"/api/columns/{sample_column['id']}",
            json={"title": "Renamed"},
            headers=workspace_headers,
        )
        assert resp.status_code == 200
        assert resp.json()["title"] == "Renamed"


class TestDeleteColumn:
    def test_returns_204(self, client, sample_column, workspace_headers):
        resp = client.delete(f"/api/columns/{sample_column['id']}", headers=workspace_headers)
        assert resp.status_code == 204

    def test_not_found_returns_404(self, client, workspace_headers):
        resp = client.delete("/api/columns/no-id", headers=workspace_headers)
        assert resp.status_code == 404

    def test_cascade_deletes_cards(self, client, sample_card, sample_column, workspace_headers):
        """Deleting a column removes its cards too."""
        client.delete(f"/api/columns/{sample_column['id']}", headers=workspace_headers)
        resp = client.patch(f"/api/cards/{sample_card['id']}", json={"text": "nope"}, headers=workspace_headers)
        assert resp.status_code == 404
