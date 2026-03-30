"""Tests for CSRF middleware."""
from app.config import settings


class TestCSRFMiddleware:
    def _enable_csrf(self):
        settings.csrf_enabled = True

    def _disable_csrf(self):
        settings.csrf_enabled = False

    def test_get_sets_csrf_cookie(self, client, workspace_headers):
        self._enable_csrf()
        try:
            resp = client.get("/api/boards/", headers=workspace_headers)
            assert resp.status_code == 200
            assert "csrf_token" in resp.cookies
        finally:
            self._disable_csrf()

    def test_post_without_csrf_token_returns_403(self, client, workspace_headers):
        self._enable_csrf()
        try:
            resp = client.post("/api/boards/", json={"name": "Test"}, headers=workspace_headers)
            assert resp.status_code == 403
            assert "CSRF" in resp.json()["detail"]
        finally:
            self._disable_csrf()

    def test_post_with_valid_csrf_token_succeeds(self, client, workspace_headers):
        self._enable_csrf()
        try:
            # First GET to obtain token
            get_resp = client.get("/api/boards/", headers=workspace_headers)
            token = get_resp.cookies.get("csrf_token")
            assert token

            # POST with matching header + cookie + workspace token
            client.cookies.set("csrf_token", token)
            resp = client.post(
                "/api/boards/",
                json={"name": "CSRF Test Board"},
                headers={"X-CSRF-Token": token, **workspace_headers},
            )
            assert resp.status_code == 201
        finally:
            self._disable_csrf()

    def test_post_with_wrong_csrf_token_returns_403(self, client, workspace_headers):
        self._enable_csrf()
        try:
            get_resp = client.get("/api/boards/", headers=workspace_headers)
            token = get_resp.cookies.get("csrf_token")

            client.cookies.set("csrf_token", token)
            resp = client.post(
                "/api/boards/",
                json={"name": "Test"},
                headers={"X-CSRF-Token": "wrong-token", **workspace_headers},
            )
            assert resp.status_code == 403
        finally:
            self._disable_csrf()

    def test_health_exempt_from_csrf(self, client):
        self._enable_csrf()
        try:
            resp = client.get("/health")
            assert resp.status_code == 200
        finally:
            self._disable_csrf()
