"""Tests for /api/columns/ endpoints."""


class TestCreateColumn:
    def test_returns_201(self, client, sample_board):
        resp = client.post("/api/columns/", json={
            "board_id": sample_board["id"],
            "title": "Action Items",
            "color": "#1565C0",
        })
        assert resp.status_code == 201
        data = resp.json()
        assert data["title"] == "Action Items"
        assert data["color"] == "#1565C0"
        assert data["board_id"] == sample_board["id"]

    def test_position_auto_increments(self, client, sample_board):
        # Board already has 3 default columns (positions 0, 1, 2)
        resp = client.post("/api/columns/", json={
            "board_id": sample_board["id"],
            "title": "Extra Column",
        })
        assert resp.json()["position"] == 3

    def test_board_not_found_returns_404(self, client):
        resp = client.post("/api/columns/", json={
            "board_id": "nonexistent-board",
            "title": "X",
        })
        assert resp.status_code == 404


class TestUpdateColumn:
    def test_update_title(self, client, sample_column):
        resp = client.patch(
            f"/api/columns/{sample_column['id']}",
            json={"title": "New Title"},
        )
        assert resp.status_code == 200
        assert resp.json()["title"] == "New Title"

    def test_update_color(self, client, sample_column):
        resp = client.patch(
            f"/api/columns/{sample_column['id']}",
            json={"color": "#FF5722"},
        )
        assert resp.status_code == 200
        assert resp.json()["color"] == "#FF5722"

    def test_update_position(self, client, sample_column):
        resp = client.patch(
            f"/api/columns/{sample_column['id']}",
            json={"position": 5},
        )
        assert resp.status_code == 200
        assert resp.json()["position"] == 5

    def test_not_found_returns_404(self, client):
        resp = client.patch("/api/columns/no-id", json={"title": "X"})
        assert resp.status_code == 404


class TestDeleteColumn:
    def test_returns_204(self, client, sample_column):
        resp = client.delete(f"/api/columns/{sample_column['id']}")
        assert resp.status_code == 204

    def test_not_found_returns_404(self, client):
        resp = client.delete("/api/columns/no-id")
        assert resp.status_code == 404

    def test_cascade_deletes_cards(self, client, sample_card, sample_column):
        """Deleting a column removes its cards too."""
        client.delete(f"/api/columns/{sample_column['id']}")
        resp = client.patch(f"/api/cards/{sample_card['id']}", json={"text": "nope"})
        assert resp.status_code == 404
