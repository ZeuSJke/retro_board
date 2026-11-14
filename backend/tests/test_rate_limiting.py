"""Tests for rate limiting."""

from app.limiter import TEAM_READ_LIMIT, limiter


class TestRateLimiting:
    def test_limiter_is_configured(self, client):
        """Verify that the limiter is attached to the app."""
        from tests.conftest import app
        assert hasattr(app.state, "limiter")
        assert app.state.limiter is limiter

    def test_rate_limit_returns_429_when_enabled(self, client, workspace_headers):
        """Exceeding the rate limit returns 429 when limiter is enabled."""
        limiter.enabled = True
        try:
            # First request should succeed
            resp = client.get("/api/boards/", headers=workspace_headers)
            assert resp.status_code == 200

            # Exceed the per-minute limit rapidly
            limit = int(TEAM_READ_LIMIT.split("/")[0])
            for _ in range(limit + 1):
                resp = client.get("/api/boards/", headers=workspace_headers)

            # At some point we should get 429
            assert resp.status_code == 429
        finally:
            limiter.enabled = False
            limiter.reset()
