"""Tests for /api/action-items/ endpoints."""


class TestListActionItems:
    def test_empty_list(self, client, sample_board):
        resp = client.get("/api/action-items/", params={"board_id": sample_board["id"]})
        assert resp.status_code == 200
        assert resp.json() == []

    def test_with_items(self, client, sample_board):
        # Create two items
        client.post("/api/action-items/", json={
            "board_id": sample_board["id"],
            "text": "Item 1",
        })
        client.post("/api/action-items/", json={
            "board_id": sample_board["id"],
            "text": "Item 2",
            "assignee": "Alice",
        })

        resp = client.get("/api/action-items/", params={"board_id": sample_board["id"]})
        assert resp.status_code == 200
        items = resp.json()
        assert len(items) == 2
        assert items[0]["text"] == "Item 1"
        assert items[1]["text"] == "Item 2"
        assert items[1]["assignee"] == "Alice"

    def test_board_not_found_returns_404(self, client):
        resp = client.get("/api/action-items/", params={"board_id": "nonexistent"})
        assert resp.status_code == 404


class TestCreateActionItem:
    def test_returns_201(self, client, sample_board):
        resp = client.post("/api/action-items/", json={
            "board_id": sample_board["id"],
            "text": "Fix the pipeline",
        })
        assert resp.status_code == 201
        data = resp.json()
        assert data["text"] == "Fix the pipeline"
        assert data["board_id"] == sample_board["id"]
        assert data["assignee"] is None

    def test_with_assignee(self, client, sample_board):
        resp = client.post("/api/action-items/", json={
            "board_id": sample_board["id"],
            "text": "Update docs",
            "assignee": "Bob",
        })
        assert resp.status_code == 201
        assert resp.json()["assignee"] == "Bob"

    def test_board_not_found_returns_404(self, client):
        resp = client.post("/api/action-items/", json={
            "board_id": "nonexistent",
            "text": "Orphan item",
        })
        assert resp.status_code == 404


class TestUpdateActionItem:
    def test_update_text(self, client, sample_board):
        item = client.post("/api/action-items/", json={
            "board_id": sample_board["id"],
            "text": "Original",
        }).json()

        resp = client.patch(
            f"/api/action-items/{item['id']}",
            json={"text": "Updated"},
        )
        assert resp.status_code == 200
        assert resp.json()["text"] == "Updated"

    def test_update_assignee(self, client, sample_board):
        item = client.post("/api/action-items/", json={
            "board_id": sample_board["id"],
            "text": "Task",
        }).json()

        resp = client.patch(
            f"/api/action-items/{item['id']}",
            json={"assignee": "Charlie"},
        )
        assert resp.status_code == 200
        assert resp.json()["assignee"] == "Charlie"

    def test_clear_assignee(self, client, sample_board):
        item = client.post("/api/action-items/", json={
            "board_id": sample_board["id"],
            "text": "Task",
            "assignee": "Alice",
        }).json()

        resp = client.patch(
            f"/api/action-items/{item['id']}",
            json={"assignee": None},
        )
        assert resp.status_code == 200
        assert resp.json()["assignee"] is None

    def test_not_found_returns_404(self, client):
        resp = client.patch("/api/action-items/no-id", json={"text": "X"})
        assert resp.status_code == 404


class TestDeleteActionItem:
    def test_returns_204(self, client, sample_board):
        item = client.post("/api/action-items/", json={
            "board_id": sample_board["id"],
            "text": "To be deleted",
        }).json()

        resp = client.delete(f"/api/action-items/{item['id']}")
        assert resp.status_code == 204

        # Verify it's gone
        items = client.get(
            "/api/action-items/", params={"board_id": sample_board["id"]}
        ).json()
        assert len(items) == 0

    def test_not_found_returns_404(self, client):
        resp = client.delete("/api/action-items/no-id")
        assert resp.status_code == 404
