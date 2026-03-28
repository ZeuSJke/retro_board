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
        assert data["title"] == ""
        assert data["board_id"] == sample_board["id"]
        assert data["assignee"] is None

    def test_with_title(self, client, sample_board):
        resp = client.post("/api/action-items/", json={
            "board_id": sample_board["id"],
            "title": "Pipeline fix",
            "text": "Fix the CI/CD pipeline ASAP",
        })
        assert resp.status_code == 201
        data = resp.json()
        assert data["title"] == "Pipeline fix"
        assert data["text"] == "Fix the CI/CD pipeline ASAP"

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

    def test_update_title(self, client, sample_board):
        item = client.post("/api/action-items/", json={
            "board_id": sample_board["id"],
            "title": "Old title",
            "text": "Some task",
        }).json()

        resp = client.patch(
            f"/api/action-items/{item['id']}",
            json={"title": "New title"},
        )
        assert resp.status_code == 200
        assert resp.json()["title"] == "New title"

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


class TestActionItemStatus:
    def test_default_status_is_open(self, client, sample_board):
        resp = client.post("/api/action-items/", json={
            "board_id": sample_board["id"],
            "text": "New item",
        })
        assert resp.status_code == 201
        data = resp.json()
        assert data["status"] == "open"
        assert data["completed_at"] is None

    def test_create_with_status(self, client, sample_board):
        resp = client.post("/api/action-items/", json={
            "board_id": sample_board["id"],
            "text": "In progress item",
            "status": "in_progress",
        })
        assert resp.status_code == 201
        assert resp.json()["status"] == "in_progress"

    def test_update_status_to_done_sets_completed_at(self, client, sample_board):
        item = client.post("/api/action-items/", json={
            "board_id": sample_board["id"],
            "text": "To complete",
        }).json()

        resp = client.patch(
            f"/api/action-items/{item['id']}",
            json={"status": "done"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "done"
        assert data["completed_at"] is not None

    def test_reopen_clears_completed_at(self, client, sample_board):
        item = client.post("/api/action-items/", json={
            "board_id": sample_board["id"],
            "text": "To reopen",
        }).json()

        # Mark done
        client.patch(f"/api/action-items/{item['id']}", json={"status": "done"})
        # Reopen
        resp = client.patch(f"/api/action-items/{item['id']}", json={"status": "open"})
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "open"
        assert data["completed_at"] is None

    def test_invalid_status_422(self, client, sample_board):
        item = client.post("/api/action-items/", json={
            "board_id": sample_board["id"],
            "text": "Test",
        }).json()

        resp = client.patch(
            f"/api/action-items/{item['id']}",
            json={"status": "invalid_status"},
        )
        assert resp.status_code == 422


class TestListAllActionItems:
    def test_returns_items_across_boards(self, client):
        board1 = client.post("/api/boards/", json={"name": "Board A"}).json()
        board2 = client.post("/api/boards/", json={"name": "Board B"}).json()
        client.post("/api/action-items/", json={"board_id": board1["id"], "text": "Item A"})
        client.post("/api/action-items/", json={"board_id": board2["id"], "text": "Item B"})

        resp = client.get("/api/action-items/all")
        assert resp.status_code == 200
        items = resp.json()
        assert len(items) == 2
        texts = {i["text"] for i in items}
        assert texts == {"Item A", "Item B"}

    def test_includes_board_name(self, client):
        board = client.post("/api/boards/", json={"name": "My Board"}).json()
        client.post("/api/action-items/", json={"board_id": board["id"], "text": "Item"})

        resp = client.get("/api/action-items/all")
        assert resp.json()[0]["board_name"] == "My Board"

    def test_filter_by_status(self, client, sample_board):
        client.post("/api/action-items/", json={
            "board_id": sample_board["id"], "text": "Open", "status": "open",
        })
        done_item = client.post("/api/action-items/", json={
            "board_id": sample_board["id"], "text": "Done",
        }).json()
        client.patch(f"/api/action-items/{done_item['id']}", json={"status": "done"})

        resp = client.get("/api/action-items/all", params={"status": "open"})
        items = resp.json()
        assert len(items) == 1
        assert items[0]["text"] == "Open"

    def test_filter_by_board_id(self, client):
        board1 = client.post("/api/boards/", json={"name": "B1"}).json()
        board2 = client.post("/api/boards/", json={"name": "B2"}).json()
        client.post("/api/action-items/", json={"board_id": board1["id"], "text": "Item 1"})
        client.post("/api/action-items/", json={"board_id": board2["id"], "text": "Item 2"})

        resp = client.get("/api/action-items/all", params={"board_id": board1["id"]})
        items = resp.json()
        assert len(items) == 1
        assert items[0]["text"] == "Item 1"

    def test_filter_by_assignee(self, client, sample_board):
        client.post("/api/action-items/", json={
            "board_id": sample_board["id"], "text": "Alice task", "assignee": "Alice",
        })
        client.post("/api/action-items/", json={
            "board_id": sample_board["id"], "text": "Bob task", "assignee": "Bob",
        })

        resp = client.get("/api/action-items/all", params={"assignee": "Alice"})
        items = resp.json()
        assert len(items) == 1
        assert items[0]["assignee"] == "Alice"


class TestTrends:
    def test_empty_boards(self, client):
        resp = client.get("/api/action-items/trends")
        assert resp.status_code == 200
        assert resp.json() == []

    def test_boards_with_mixed_statuses(self, client):
        board = client.post("/api/boards/", json={"name": "Sprint 1"}).json()
        client.post("/api/action-items/", json={"board_id": board["id"], "text": "T1"})
        item2 = client.post("/api/action-items/", json={"board_id": board["id"], "text": "T2"}).json()
        client.patch(f"/api/action-items/{item2['id']}", json={"status": "in_progress"})
        item3 = client.post("/api/action-items/", json={"board_id": board["id"], "text": "T3"}).json()
        client.patch(f"/api/action-items/{item3['id']}", json={"status": "done"})

        resp = client.get("/api/action-items/trends")
        data = resp.json()
        assert len(data) == 1
        point = data[0]
        assert point["board_name"] == "Sprint 1"
        assert point["open"] == 1
        assert point["in_progress"] == 1
        assert point["done"] == 1
        assert point["total"] == 3

    def test_board_without_items_shows_zeros(self, client, sample_board):
        resp = client.get("/api/action-items/trends")
        data = resp.json()
        assert len(data) == 1
        assert data[0]["total"] == 0
        assert data[0]["open"] == 0

    def test_multiple_boards_sorted_by_date(self, client):
        b1 = client.post("/api/boards/", json={"name": "First"}).json()
        b2 = client.post("/api/boards/", json={"name": "Second"}).json()
        client.post("/api/action-items/", json={"board_id": b1["id"], "text": "T"})
        client.post("/api/action-items/", json={"board_id": b2["id"], "text": "T"})

        resp = client.get("/api/action-items/trends")
        data = resp.json()
        assert len(data) == 2
        assert data[0]["board_name"] == "First"
        assert data[1]["board_name"] == "Second"


class TestCarryForward:
    def test_copies_open_items(self, client):
        src = client.post("/api/boards/", json={"name": "Source"}).json()
        tgt = client.post("/api/boards/", json={"name": "Target"}).json()

        client.post("/api/action-items/", json={
            "board_id": src["id"], "text": "Open task", "assignee": "Alice",
        })
        item_done = client.post("/api/action-items/", json={
            "board_id": src["id"], "text": "Done task",
        }).json()
        client.patch(f"/api/action-items/{item_done['id']}", json={"status": "done"})

        resp = client.post("/api/action-items/carry-forward", json={
            "source_board_id": src["id"],
            "target_board_id": tgt["id"],
        })
        assert resp.status_code == 201
        created = resp.json()
        assert len(created) == 1
        assert created[0]["text"] == "Open task"
        assert created[0]["assignee"] == "Alice"
        assert created[0]["board_id"] == tgt["id"]
        assert created[0]["status"] == "open"

    def test_does_not_copy_done_items(self, client):
        src = client.post("/api/boards/", json={"name": "Src"}).json()
        tgt = client.post("/api/boards/", json={"name": "Tgt"}).json()

        item = client.post("/api/action-items/", json={
            "board_id": src["id"], "text": "Done",
        }).json()
        client.patch(f"/api/action-items/{item['id']}", json={"status": "done"})

        resp = client.post("/api/action-items/carry-forward", json={
            "source_board_id": src["id"],
            "target_board_id": tgt["id"],
        })
        assert resp.status_code == 201
        assert resp.json() == []

    def test_source_not_found_returns_404(self, client, sample_board):
        resp = client.post("/api/action-items/carry-forward", json={
            "source_board_id": "nonexistent",
            "target_board_id": sample_board["id"],
        })
        assert resp.status_code == 404

    def test_target_not_found_returns_404(self, client, sample_board):
        resp = client.post("/api/action-items/carry-forward", json={
            "source_board_id": sample_board["id"],
            "target_board_id": "nonexistent",
        })
        assert resp.status_code == 404
