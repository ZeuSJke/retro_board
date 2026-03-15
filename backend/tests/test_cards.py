"""Tests for /api/cards/ endpoints."""


class TestCreateCard:
    def test_returns_201(self, client, sample_column):
        resp = client.post("/api/cards/", json={
            "column_id": sample_column["id"],
            "text": "Deploy pipeline is slow",
            "author": "Alice",
            "color": "#E3F2FD",
        })
        assert resp.status_code == 201
        data = resp.json()
        assert data["text"] == "Deploy pipeline is slow"
        assert data["author"] == "Alice"
        assert data["color"] == "#E3F2FD"
        assert data["likes"] == []

    def test_default_author(self, client, sample_column):
        resp = client.post("/api/cards/", json={
            "column_id": sample_column["id"],
            "text": "Anonymous card",
        })
        assert resp.status_code == 201
        assert resp.json()["author"] == "Аноним"

    def test_column_not_found_returns_404(self, client):
        resp = client.post("/api/cards/", json={
            "column_id": "nonexistent",
            "text": "Orphan",
        })
        assert resp.status_code == 404


class TestUpdateCard:
    def test_update_text(self, client, sample_card):
        resp = client.patch(
            f"/api/cards/{sample_card['id']}",
            json={"text": "Updated text"},
        )
        assert resp.status_code == 200
        assert resp.json()["text"] == "Updated text"

    def test_update_color(self, client, sample_card):
        resp = client.patch(
            f"/api/cards/{sample_card['id']}",
            json={"color": "#FF0000"},
        )
        assert resp.status_code == 200
        assert resp.json()["color"] == "#FF0000"

    def test_not_found_returns_404(self, client):
        resp = client.patch("/api/cards/no-id", json={"text": "X"})
        assert resp.status_code == 404


class TestMoveCard:
    def test_move_to_another_column(self, client, sample_board, sample_card):
        columns = client.get(f"/api/boards/{sample_board['id']}").json()["columns"]
        target_col = [c for c in columns if c["id"] != sample_card["column_id"]][0]

        resp = client.post(f"/api/cards/{sample_card['id']}/move", json={
            "column_id": target_col["id"],
            "position": 0,
        })
        assert resp.status_code == 200
        assert resp.json()["column_id"] == target_col["id"]
        assert resp.json()["position"] == 0

    def test_move_ungroups_card(self, client, sample_board, sample_card, sample_group):
        """Moving a card to another column should remove it from its group."""
        # First, put card into the group
        client.post(f"/api/groups/{sample_group['id']}/set_card/{sample_card['id']}")

        # Get another column
        columns = client.get(f"/api/boards/{sample_board['id']}").json()["columns"]
        target_col = [c for c in columns if c["id"] != sample_card["column_id"]][0]

        # Move
        resp = client.post(f"/api/cards/{sample_card['id']}/move", json={
            "column_id": target_col["id"],
            "position": 0,
        })
        assert resp.status_code == 200
        assert resp.json()["group_id"] is None

    def test_target_column_not_found(self, client, sample_card):
        resp = client.post(f"/api/cards/{sample_card['id']}/move", json={
            "column_id": "nonexistent",
            "position": 0,
        })
        assert resp.status_code == 404

    def test_card_not_found(self, client):
        resp = client.post("/api/cards/no-id/move", json={
            "column_id": "x",
            "position": 0,
        })
        assert resp.status_code == 404


class TestToggleLike:
    def test_add_like(self, client, sample_card):
        resp = client.post(
            f"/api/cards/{sample_card['id']}/like",
            params={"username": "Alice"},
        )
        assert resp.status_code == 200
        assert "Alice" in resp.json()["likes"]

    def test_remove_like(self, client, sample_card):
        # Like twice → toggle off
        client.post(f"/api/cards/{sample_card['id']}/like", params={"username": "Bob"})
        resp = client.post(
            f"/api/cards/{sample_card['id']}/like",
            params={"username": "Bob"},
        )
        assert resp.status_code == 200
        assert "Bob" not in resp.json()["likes"]

    def test_card_not_found(self, client):
        resp = client.post("/api/cards/no-id/like", params={"username": "X"})
        assert resp.status_code == 404


class TestDeleteCard:
    def test_returns_204(self, client, sample_card):
        resp = client.delete(f"/api/cards/{sample_card['id']}")
        assert resp.status_code == 204

    def test_not_found_returns_404(self, client):
        resp = client.delete("/api/cards/no-id")
        assert resp.status_code == 404

    def test_deleting_last_card_auto_removes_empty_group(
        self, client, sample_card, sample_group
    ):
        """When the only card in a group is deleted, the group is auto-deleted."""
        # Put card into the group
        client.post(f"/api/groups/{sample_group['id']}/set_card/{sample_card['id']}")

        # Delete the card
        client.delete(f"/api/cards/{sample_card['id']}")

        # Group should be gone
        resp = client.patch(
            f"/api/groups/{sample_group['id']}",
            json={"title": "still here?"},
        )
        assert resp.status_code == 404
