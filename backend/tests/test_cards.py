"""Tests for /api/cards/ endpoints."""


class TestCreateCard:
    def test_returns_201(self, client, sample_column, workspace_headers):
        resp = client.post("/api/cards/", json={
            "column_id": sample_column["id"],
            "text": "Deploy pipeline is slow",
            "author": "Alice",
            "color": "#E3F2FD",
        }, headers=workspace_headers)
        assert resp.status_code == 201
        data = resp.json()
        assert data["text"] == "Deploy pipeline is slow"
        assert data["author"] == "Alice"
        assert data["color"] == "#E3F2FD"
        assert data["likes"] == []

    def test_default_author(self, client, sample_column, workspace_headers):
        resp = client.post("/api/cards/", json={
            "column_id": sample_column["id"],
            "text": "Anonymous card",
        }, headers=workspace_headers)
        assert resp.status_code == 201
        assert resp.json()["author"] == "Аноним"

    def test_column_not_found_returns_404(self, client, workspace_headers):
        resp = client.post("/api/cards/", json={
            "column_id": "nonexistent",
            "text": "Orphan",
        }, headers=workspace_headers)
        assert resp.status_code == 404

    def test_invalid_color_returns_422(self, client, sample_column, workspace_headers):
        resp = client.post("/api/cards/", json={
            "column_id": sample_column["id"],
            "text": "Bad color",
            "color": "red",
        }, headers=workspace_headers)
        assert resp.status_code == 422

    def test_short_hex_color_returns_422(self, client, sample_column, workspace_headers):
        resp = client.post("/api/cards/", json={
            "column_id": sample_column["id"],
            "text": "Bad color",
            "color": "#FFF",
        }, headers=workspace_headers)
        assert resp.status_code == 422


class TestUpdateCard:
    def test_update_text(self, client, sample_card, workspace_headers):
        resp = client.patch(
            f"/api/cards/{sample_card['id']}",
            json={"text": "Updated text"},
            headers=workspace_headers,
        )
        assert resp.status_code == 200
        assert resp.json()["text"] == "Updated text"

    def test_update_color(self, client, sample_card, workspace_headers):
        resp = client.patch(
            f"/api/cards/{sample_card['id']}",
            json={"color": "#FF0000"},
            headers=workspace_headers,
        )
        assert resp.status_code == 200
        assert resp.json()["color"] == "#FF0000"

    def test_update_invalid_color_returns_422(self, client, sample_card, workspace_headers):
        resp = client.patch(
            f"/api/cards/{sample_card['id']}",
            json={"color": "notacolor"},
            headers=workspace_headers,
        )
        assert resp.status_code == 422

    def test_not_found_returns_404(self, client, workspace_headers):
        resp = client.patch("/api/cards/no-id", json={"text": "X"}, headers=workspace_headers)
        assert resp.status_code == 404


class TestMoveCard:
    def test_move_to_another_column(self, client, sample_board, sample_card, workspace_headers):
        columns = client.get(f"/api/boards/{sample_board['id']}", headers=workspace_headers).json()["columns"]
        target_col = [c for c in columns if c["id"] != sample_card["column_id"]][0]

        resp = client.post(f"/api/cards/{sample_card['id']}/move", json={
            "column_id": target_col["id"],
            "position": 0,
        }, headers=workspace_headers)
        assert resp.status_code == 200
        assert resp.json()["column_id"] == target_col["id"]
        assert resp.json()["position"] == 0

    def test_move_ungroups_card(self, client, sample_board, sample_card, sample_group, workspace_headers):
        """Moving a card to another column should remove it from its group."""
        # First, put card into the group
        client.post(f"/api/groups/{sample_group['id']}/set_card/{sample_card['id']}", headers=workspace_headers)

        # Get another column
        columns = client.get(f"/api/boards/{sample_board['id']}", headers=workspace_headers).json()["columns"]
        target_col = [c for c in columns if c["id"] != sample_card["column_id"]][0]

        # Move
        resp = client.post(f"/api/cards/{sample_card['id']}/move", json={
            "column_id": target_col["id"],
            "position": 0,
        }, headers=workspace_headers)
        assert resp.status_code == 200
        assert resp.json()["group_id"] is None

    def test_target_column_not_found(self, client, sample_card, workspace_headers):
        resp = client.post(f"/api/cards/{sample_card['id']}/move", json={
            "column_id": "nonexistent",
            "position": 0,
        }, headers=workspace_headers)
        assert resp.status_code == 404

    def test_card_not_found(self, client, workspace_headers):
        resp = client.post("/api/cards/no-id/move", json={
            "column_id": "x",
            "position": 0,
        }, headers=workspace_headers)
        assert resp.status_code == 404


class TestToggleLike:
    def test_add_like(self, client, sample_card, workspace_headers):
        resp = client.post(
            f"/api/cards/{sample_card['id']}/like",
            params={"username": "Alice"},
            headers=workspace_headers,
        )
        assert resp.status_code == 200
        assert "Alice" in resp.json()["likes"]

    def test_remove_like(self, client, sample_card, workspace_headers):
        # Like twice → toggle off
        client.post(f"/api/cards/{sample_card['id']}/like", params={"username": "Bob"}, headers=workspace_headers)
        resp = client.post(
            f"/api/cards/{sample_card['id']}/like",
            params={"username": "Bob"},
            headers=workspace_headers,
        )
        assert resp.status_code == 200
        assert "Bob" not in resp.json()["likes"]

    def test_card_not_found(self, client, workspace_headers):
        resp = client.post("/api/cards/no-id/like", params={"username": "X"}, headers=workspace_headers)
        assert resp.status_code == 404

    def test_vote_limit_returns_403(self, client, sample_board, sample_column, workspace_headers):
        """Exceeding max_votes returns 403."""
        # Board default max_votes = 5, update to 2 for testing
        client.patch(f"/api/boards/{sample_board['id']}", json={"max_votes": 2}, headers=workspace_headers)

        # Create 3 cards
        cards = []
        for i in range(3):
            resp = client.post("/api/cards/", json={
                "column_id": sample_column["id"],
                "text": f"Card {i}",
            }, headers=workspace_headers)
            cards.append(resp.json())

        # Like first two — should succeed
        for card in cards[:2]:
            resp = client.post(f"/api/cards/{card['id']}/like", params={"username": "Voter"}, headers=workspace_headers)
            assert resp.status_code == 200

        # Third like should fail
        resp = client.post(f"/api/cards/{cards[2]['id']}/like", params={"username": "Voter"}, headers=workspace_headers)
        assert resp.status_code == 403
        assert "Лимит голосов исчерпан" in resp.json()["detail"]

    def test_removing_vote_always_allowed(self, client, sample_board, sample_column, workspace_headers):
        """Removing a vote should work even when at the limit."""
        client.patch(f"/api/boards/{sample_board['id']}", json={"max_votes": 1}, headers=workspace_headers)

        resp = client.post("/api/cards/", json={
            "column_id": sample_column["id"],
            "text": "Card A",
        }, headers=workspace_headers)
        card = resp.json()

        # Like (fills limit)
        resp = client.post(f"/api/cards/{card['id']}/like", params={"username": "Voter"}, headers=workspace_headers)
        assert resp.status_code == 200
        assert "Voter" in resp.json()["likes"]

        # Unlike (should work)
        resp = client.post(f"/api/cards/{card['id']}/like", params={"username": "Voter"}, headers=workspace_headers)
        assert resp.status_code == 200
        assert "Voter" not in resp.json()["likes"]


class TestDeleteCard:
    def test_returns_204(self, client, sample_card, workspace_headers):
        resp = client.delete(f"/api/cards/{sample_card['id']}", headers=workspace_headers)
        assert resp.status_code == 204

    def test_not_found_returns_404(self, client, workspace_headers):
        resp = client.delete("/api/cards/no-id", headers=workspace_headers)
        assert resp.status_code == 404

    def test_deleting_last_card_auto_removes_empty_group(
        self, client, sample_card, sample_group, workspace_headers
    ):
        """When the only card in a group is deleted, the group is auto-deleted."""
        # Put card into the group
        client.post(f"/api/groups/{sample_group['id']}/set_card/{sample_card['id']}", headers=workspace_headers)

        # Delete the card
        client.delete(f"/api/cards/{sample_card['id']}", headers=workspace_headers)

        # Group should be gone
        resp = client.patch(
            f"/api/groups/{sample_group['id']}",
            json={"title": "still here?"},
            headers=workspace_headers,
        )
        assert resp.status_code == 404
