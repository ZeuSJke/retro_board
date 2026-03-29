"""Tests for /api/jira/ endpoints."""

from unittest.mock import AsyncMock, patch, MagicMock

from app.config import settings


class TestJiraStatus:
    def test_returns_not_configured_by_default(self, client, workspace_headers):
        resp = client.get("/api/jira/status", headers=workspace_headers)
        assert resp.status_code == 200
        assert resp.json() == {"configured": False}

    def test_returns_configured_when_settings_set(self, client, workspace_headers, monkeypatch):
        monkeypatch.setattr(settings, "jira_url", "https://jira.example.com")
        monkeypatch.setattr(settings, "jira_email", "user@example.com")
        monkeypatch.setattr(settings, "jira_api_token", "token123")

        resp = client.get("/api/jira/status", headers=workspace_headers)
        assert resp.status_code == 200
        assert resp.json() == {"configured": True}


class TestCreateJiraIssue:
    def test_returns_503_when_not_configured(self, client, sample_board, workspace_headers):
        resp = client.post("/api/jira/create-issue", json={
            "action_item_id": "some-id",
            "project_key": "RB",
            "summary": "Test issue",
        }, headers=workspace_headers)
        assert resp.status_code == 503

    def test_returns_404_when_action_item_not_found(self, client, sample_board, workspace_headers, monkeypatch):
        monkeypatch.setattr(settings, "jira_url", "https://jira.example.com")
        monkeypatch.setattr(settings, "jira_email", "user@example.com")
        monkeypatch.setattr(settings, "jira_api_token", "token123")

        resp = client.post("/api/jira/create-issue", json={
            "action_item_id": "nonexistent",
            "project_key": "RB",
            "summary": "Test issue",
        }, headers=workspace_headers)
        assert resp.status_code == 404

    def test_returns_409_when_already_linked(self, client, sample_board, workspace_headers, monkeypatch):
        monkeypatch.setattr(settings, "jira_url", "https://jira.example.com")
        monkeypatch.setattr(settings, "jira_email", "user@example.com")
        monkeypatch.setattr(settings, "jira_api_token", "token123")

        # Create an action item
        resp = client.post("/api/action-items/", json={
            "board_id": sample_board["id"],
            "text": "Fix the bug",
        }, headers=workspace_headers)
        assert resp.status_code == 201
        item = resp.json()

        # Manually set jira_issue_key via a mocked successful create first
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {"key": "RB-1"}

        mock_client_instance = AsyncMock()
        mock_client_instance.post.return_value = mock_response
        mock_client_instance.__aenter__ = AsyncMock(return_value=mock_client_instance)
        mock_client_instance.__aexit__ = AsyncMock(return_value=False)

        with patch("app.routers.jira.httpx.AsyncClient", return_value=mock_client_instance):
            resp = client.post("/api/jira/create-issue", json={
                "action_item_id": item["id"],
                "project_key": "RB",
                "summary": "First link",
            }, headers=workspace_headers)
            assert resp.status_code == 200
            assert resp.json()["jira_issue_key"] == "RB-1"

        # Second attempt should return 409
        resp = client.post("/api/jira/create-issue", json={
            "action_item_id": item["id"],
            "project_key": "RB",
            "summary": "Duplicate link",
        }, headers=workspace_headers)
        assert resp.status_code == 409

    def test_successful_create_returns_key_and_url(self, client, sample_board, workspace_headers, monkeypatch):
        monkeypatch.setattr(settings, "jira_url", "https://jira.example.com")
        monkeypatch.setattr(settings, "jira_email", "user@example.com")
        monkeypatch.setattr(settings, "jira_api_token", "token123")

        # Create an action item
        resp = client.post("/api/action-items/", json={
            "board_id": sample_board["id"],
            "text": "Deploy to prod",
        }, headers=workspace_headers)
        assert resp.status_code == 201
        item = resp.json()

        mock_response = MagicMock()
        mock_response.status_code = 201
        mock_response.json.return_value = {"key": "RB-42"}

        mock_client_instance = AsyncMock()
        mock_client_instance.post.return_value = mock_response
        mock_client_instance.__aenter__ = AsyncMock(return_value=mock_client_instance)
        mock_client_instance.__aexit__ = AsyncMock(return_value=False)

        with patch("app.routers.jira.httpx.AsyncClient", return_value=mock_client_instance):
            resp = client.post("/api/jira/create-issue", json={
                "action_item_id": item["id"],
                "project_key": "RB",
                "summary": "Deploy to prod",
                "description": "Urgent deployment",
                "issue_type": "Bug",
            }, headers=workspace_headers)
            assert resp.status_code == 200
            data = resp.json()
            assert data["jira_issue_key"] == "RB-42"
            assert data["jira_url"] == "https://jira.example.com/browse/RB-42"
