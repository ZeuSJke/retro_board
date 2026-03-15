"""Tests for /api/boards/ endpoints."""


class TestCreateBoard:
    def test_returns_201_with_default_columns(self, client):
        resp = client.post("/api/boards/", json={"name": "Sprint 42 Retro"})
        assert resp.status_code == 201
        data = resp.json()
        assert data["name"] == "Sprint 42 Retro"
        assert data["slug"] == "sprint-42-retro"
        assert len(data["columns"]) == 3

    def test_default_columns_have_correct_titles(self, client):
        resp = client.post("/api/boards/", json={"name": "My Board"})
        titles = [c["title"] for c in resp.json()["columns"]]
        assert "😊 Что хорошо" in titles
        assert "😟 Что улучшить" in titles
        assert "💡 Идеи" in titles

    def test_duplicate_name_returns_409(self, client, sample_board):
        resp = client.post("/api/boards/", json={"name": sample_board["name"]})
        assert resp.status_code == 409


class TestListBoards:
    def test_returns_list(self, client, sample_board):
        resp = client.get("/api/boards/")
        assert resp.status_code == 200
        boards = resp.json()
        assert isinstance(boards, list)
        assert len(boards) >= 1
        assert any(b["id"] == sample_board["id"] for b in boards)

    def test_empty_when_no_boards(self, client):
        resp = client.get("/api/boards/")
        assert resp.status_code == 200
        assert resp.json() == []


class TestGetBoard:
    def test_by_id(self, client, sample_board):
        resp = client.get(f"/api/boards/{sample_board['id']}")
        assert resp.status_code == 200
        assert resp.json()["id"] == sample_board["id"]
        assert "columns" in resp.json()

    def test_by_slug(self, client, sample_board):
        resp = client.get(f"/api/boards/by-slug/{sample_board['slug']}")
        assert resp.status_code == 200
        assert resp.json()["id"] == sample_board["id"]

    def test_not_found_returns_404(self, client):
        resp = client.get("/api/boards/nonexistent-id")
        assert resp.status_code == 404

    def test_slug_not_found_returns_404(self, client):
        resp = client.get("/api/boards/by-slug/no-such-slug")
        assert resp.status_code == 404


class TestUpdateBoard:
    def test_rename(self, client, sample_board):
        resp = client.patch(
            f"/api/boards/{sample_board['id']}",
            json={"name": "Renamed Board"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["name"] == "Renamed Board"
        assert data["slug"] == "renamed-board"

    def test_rename_to_existing_name_returns_409(self, client, sample_board):
        client.post("/api/boards/", json={"name": "Other Board"})
        resp = client.patch(
            f"/api/boards/{sample_board['id']}",
            json={"name": "Other Board"},
        )
        assert resp.status_code == 409

    def test_not_found_returns_404(self, client):
        resp = client.patch("/api/boards/no-id", json={"name": "X"})
        assert resp.status_code == 404


class TestDeleteBoard:
    def test_returns_204(self, client, sample_board):
        resp = client.delete(f"/api/boards/{sample_board['id']}")
        assert resp.status_code == 204
        # Board is gone
        assert client.get(f"/api/boards/{sample_board['id']}").status_code == 404

    def test_not_found_returns_404(self, client):
        resp = client.delete("/api/boards/nonexistent")
        assert resp.status_code == 404
