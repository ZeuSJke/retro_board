"""Tests for /api/boards/ endpoints."""


class TestCreateBoard:
    def test_returns_201_with_default_columns(self, client, workspace_headers):
        resp = client.post("/api/boards/", json={"name": "Sprint 42 Retro"}, headers=workspace_headers)
        assert resp.status_code == 201
        data = resp.json()
        assert data["name"] == "Sprint 42 Retro"
        assert data["slug"] == "sprint-42-retro"
        assert len(data["columns"]) == 3

    def test_default_columns_have_correct_titles(self, client, workspace_headers):
        resp = client.post("/api/boards/", json={"name": "My Board"}, headers=workspace_headers)
        titles = [c["title"] for c in resp.json()["columns"]]
        assert "😊 Что хорошо" in titles
        assert "😟 Что улучшить" in titles
        assert "💡 Идеи" in titles

    def test_duplicate_name_returns_409(self, client, workspace_headers, sample_board):
        resp = client.post("/api/boards/", json={"name": sample_board["name"]}, headers=workspace_headers)
        assert resp.status_code == 409


class TestListBoards:
    def test_returns_list(self, client, workspace_headers, sample_board):
        resp = client.get("/api/boards/", headers=workspace_headers)
        assert resp.status_code == 200
        boards = resp.json()
        assert isinstance(boards, list)
        assert len(boards) >= 1
        assert any(b["id"] == sample_board["id"] for b in boards)

    def test_empty_when_no_boards(self, client, workspace_headers):
        resp = client.get("/api/boards/", headers=workspace_headers)
        assert resp.status_code == 200
        assert resp.json() == []


class TestGetBoard:
    def test_by_id(self, client, workspace_headers, sample_board):
        resp = client.get(f"/api/boards/{sample_board['id']}", headers=workspace_headers)
        assert resp.status_code == 200
        assert resp.json()["id"] == sample_board["id"]
        assert "columns" in resp.json()

    def test_by_slug(self, client, workspace_headers, sample_board):
        resp = client.get(f"/api/boards/by-slug/{sample_board['slug']}", headers=workspace_headers)
        assert resp.status_code == 200
        assert resp.json()["id"] == sample_board["id"]

    def test_not_found_returns_404(self, client, workspace_headers):
        resp = client.get("/api/boards/nonexistent-id", headers=workspace_headers)
        assert resp.status_code == 404

    def test_slug_not_found_returns_404(self, client, workspace_headers):
        resp = client.get("/api/boards/by-slug/no-such-slug", headers=workspace_headers)
        assert resp.status_code == 404


class TestBoardMaxVotes:
    def test_default_max_votes(self, client, workspace_headers):
        resp = client.post("/api/boards/", json={"name": "Votes Board"}, headers=workspace_headers)
        assert resp.status_code == 201
        assert resp.json()["max_votes"] == 5

    def test_custom_max_votes(self, client, workspace_headers):
        resp = client.post("/api/boards/", json={"name": "Custom Votes", "max_votes": 10}, headers=workspace_headers)
        assert resp.status_code == 201
        assert resp.json()["max_votes"] == 10

    def test_update_max_votes(self, client, workspace_headers, sample_board):
        resp = client.patch(
            f"/api/boards/{sample_board['id']}",
            json={"max_votes": 3},
            headers=workspace_headers,
        )
        assert resp.status_code == 200
        assert resp.json()["max_votes"] == 3

    def test_max_votes_in_list(self, client, workspace_headers, sample_board):
        resp = client.get("/api/boards/", headers=workspace_headers)
        boards = resp.json()
        assert all("max_votes" in b for b in boards)


class TestUpdateBoard:
    def test_rename(self, client, workspace_headers, sample_board):
        resp = client.patch(
            f"/api/boards/{sample_board['id']}",
            json={"name": "Renamed Board"},
            headers=workspace_headers,
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["name"] == "Renamed Board"
        assert data["slug"] == "renamed-board"

    def test_rename_to_existing_name_returns_409(self, client, workspace_headers, sample_board):
        client.post("/api/boards/", json={"name": "Other Board"}, headers=workspace_headers)
        resp = client.patch(
            f"/api/boards/{sample_board['id']}",
            json={"name": "Other Board"},
            headers=workspace_headers,
        )
        assert resp.status_code == 409

    def test_not_found_returns_404(self, client, workspace_headers):
        resp = client.patch("/api/boards/no-id", json={"name": "X"}, headers=workspace_headers)
        assert resp.status_code == 404


class TestDeleteBoard:
    def test_returns_204(self, client, workspace_headers, sample_board):
        resp = client.delete(f"/api/boards/{sample_board['id']}", headers=workspace_headers)
        assert resp.status_code == 204
        # Board is gone
        assert client.get(f"/api/boards/{sample_board['id']}", headers=workspace_headers).status_code == 404

    def test_not_found_returns_404(self, client, workspace_headers):
        resp = client.delete("/api/boards/nonexistent", headers=workspace_headers)
        assert resp.status_code == 404


class TestBoardNameValidation:
    def test_create_board_with_html_name_returns_422(self, client, workspace_headers):
        resp = client.post("/api/boards/", json={"name": "<script>alert(1)</script>"}, headers=workspace_headers)
        assert resp.status_code == 422

    def test_update_board_with_html_name_returns_422(self, client, workspace_headers, sample_board):
        resp = client.patch(
            f"/api/boards/{sample_board['id']}",
            json={"name": "<b>Bold</b>"},
            headers=workspace_headers,
        )
        assert resp.status_code == 422


class TestSoftDelete:
    def test_delete_board_soft_deletes(self, client, workspace_headers, sample_board):
        resp = client.delete(f"/api/boards/{sample_board['id']}", headers=workspace_headers)
        assert resp.status_code == 204

        # GET by id returns 404
        assert client.get(f"/api/boards/{sample_board['id']}", headers=workspace_headers).status_code == 404

        # List does not include deleted board
        boards = client.get("/api/boards/", headers=workspace_headers).json()
        assert not any(b["id"] == sample_board["id"] for b in boards)

    def test_deleted_board_name_can_be_reused(self, client, workspace_headers, sample_board):
        name = sample_board["name"]
        client.delete(f"/api/boards/{sample_board['id']}", headers=workspace_headers)

        resp = client.post("/api/boards/", json={"name": name}, headers=workspace_headers)
        assert resp.status_code == 201
        assert resp.json()["name"] == name


class TestBoardListActionItemCounts:
    def test_list_includes_action_item_counts(self, client, workspace_headers, sample_board):
        # Create 2 items, mark one done
        client.post("/api/action-items/", json={
            "board_id": sample_board["id"], "text": "Open item",
        }, headers=workspace_headers)
        done = client.post("/api/action-items/", json={
            "board_id": sample_board["id"], "text": "Done item",
        }, headers=workspace_headers).json()
        client.patch(f"/api/action-items/{done['id']}", json={"status": "done"}, headers=workspace_headers)

        resp = client.get("/api/boards/", headers=workspace_headers)
        boards = resp.json()
        board = next(b for b in boards if b["id"] == sample_board["id"])
        assert board["action_items_total"] == 2
        assert board["action_items_open"] == 1

    def test_zero_counts_when_no_items(self, client, workspace_headers, sample_board):
        resp = client.get("/api/boards/", headers=workspace_headers)
        board = next(b for b in resp.json() if b["id"] == sample_board["id"])
        assert board["action_items_total"] == 0
        assert board["action_items_open"] == 0
