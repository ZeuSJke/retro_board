"""Tests for rate limiting."""

from app.limiter import limiter


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

            # Exceed the 100/minute limit rapidly
            for _ in range(101):
                resp = client.get("/api/boards/", headers=workspace_headers)

            # At some point we should get 429
            assert resp.status_code == 429
        finally:
            limiter.enabled = False
            limiter.reset()
