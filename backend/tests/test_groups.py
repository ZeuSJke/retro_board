"""Tests for /api/groups/ endpoints."""


class TestCreateGroup:
    def test_returns_201(self, client, sample_column):
        resp = client.post("/api/groups/", json={
            "column_id": sample_column["id"],
            "title": "Common Theme",
        })
        assert resp.status_code == 201
        data = resp.json()
        assert data["title"] == "Common Theme"
        assert data["column_id"] == sample_column["id"]

    def test_default_title(self, client, sample_column):
        resp = client.post("/api/groups/", json={
            "column_id": sample_column["id"],
        })
        assert resp.status_code == 201
        assert resp.json()["title"] == "Группа"

    def test_column_not_found_returns_404(self, client):
        resp = client.post("/api/groups/", json={
            "column_id": "nonexistent",
            "title": "X",
        })
        assert resp.status_code == 404


class TestUpdateGroup:
    def test_rename(self, client, sample_group):
        resp = client.patch(
            f"/api/groups/{sample_group['id']}",
            json={"title": "Renamed Group"},
        )
        assert resp.status_code == 200
        assert resp.json()["title"] == "Renamed Group"

    def test_not_found_returns_404(self, client):
        resp = client.patch("/api/groups/no-id", json={"title": "X"})
        assert resp.status_code == 404


class TestDeleteGroup:
    def test_returns_204(self, client, sample_group):
        resp = client.delete(f"/api/groups/{sample_group['id']}")
        assert resp.status_code == 204

    def test_not_found_returns_404(self, client):
        resp = client.delete("/api/groups/no-id")
        assert resp.status_code == 404

    def test_ungroups_cards_on_delete(self, client, sample_card, sample_group):
        """Deleting a group should set group_id=None on all its cards."""
        # Assign card
        client.post(f"/api/groups/{sample_group['id']}/set_card/{sample_card['id']}")

        # Delete group
        client.delete(f"/api/groups/{sample_group['id']}")

        # Card should still exist but with group_id=None
        card = client.patch(
            f"/api/cards/{sample_card['id']}",
            json={"text": sample_card["text"]},
        ).json()
        assert card["group_id"] is None


class TestSetCardToGroup:
    def test_assign_card(self, client, sample_card, sample_group):
        resp = client.post(
            f"/api/groups/{sample_group['id']}/set_card/{sample_card['id']}"
        )
        assert resp.status_code == 200
        assert resp.json()["group_id"] == sample_group["id"]

    def test_card_in_different_column_returns_400(
        self, client, sample_board, sample_group
    ):
        """Card and group must be in the same column."""
        # Get another column
        columns = client.get(f"/api/boards/{sample_board['id']}").json()["columns"]
        other_col = [
            c for c in columns if c["id"] != sample_group["column_id"]
        ][0]

        # Create card in the other column
        card = client.post("/api/cards/", json={
            "column_id": other_col["id"],
            "text": "Wrong column",
        }).json()

        resp = client.post(
            f"/api/groups/{sample_group['id']}/set_card/{card['id']}"
        )
        assert resp.status_code == 400

    def test_group_not_found(self, client, sample_card):
        resp = client.post(f"/api/groups/no-id/set_card/{sample_card['id']}")
        assert resp.status_code == 404

    def test_card_not_found(self, client, sample_group):
        resp = client.post(f"/api/groups/{sample_group['id']}/set_card/no-id")
        assert resp.status_code == 404


class TestRemoveCardFromGroup:
    def test_removes_card(self, client, sample_card, sample_group):
        # Assign first
        client.post(f"/api/groups/{sample_group['id']}/set_card/{sample_card['id']}")

        # Remove
        resp = client.delete(
            f"/api/groups/{sample_group['id']}/remove_card/{sample_card['id']}"
        )
        assert resp.status_code == 200
        assert resp.json()["group_id"] is None

    def test_removing_last_card_auto_deletes_group(
        self, client, sample_card, sample_group
    ):
        """Auto-delete group when the last card is removed."""
        client.post(f"/api/groups/{sample_group['id']}/set_card/{sample_card['id']}")

        # Remove last card from group
        client.delete(
            f"/api/groups/{sample_group['id']}/remove_card/{sample_card['id']}"
        )

        # Group should be gone
        resp = client.patch(
            f"/api/groups/{sample_group['id']}",
            json={"title": "exists?"},
        )
        assert resp.status_code == 404


class TestMoveGroup:
    def test_moves_group_and_cards(self, client, sample_board, sample_card, sample_group):
        """Moving a group should move all its cards to the target column."""
        # Assign card to the group
        client.post(f"/api/groups/{sample_group['id']}/set_card/{sample_card['id']}")

        # Get another column on the same board
        columns = client.get(f"/api/boards/{sample_board['id']}").json()["columns"]
        target_col = [
            c for c in columns if c["id"] != sample_group["column_id"]
        ][0]

        resp = client.patch(
            f"/api/groups/{sample_group['id']}/move",
            json={"column_id": target_col["id"]},
        )
        assert resp.status_code == 200
        assert resp.json()["column_id"] == target_col["id"]

        # Card should also be in the new column
        card = client.patch(
            f"/api/cards/{sample_card['id']}",
            json={"text": sample_card["text"]},
        ).json()
        assert card["column_id"] == target_col["id"]

    def test_target_column_not_found(self, client, sample_group):
        resp = client.patch(
            f"/api/groups/{sample_group['id']}/move",
            json={"column_id": "nonexistent"},
        )
        assert resp.status_code == 404

    def test_group_not_found(self, client):
        resp = client.patch(
            "/api/groups/no-id/move",
            json={"column_id": "x"},
        )
        assert resp.status_code == 404
