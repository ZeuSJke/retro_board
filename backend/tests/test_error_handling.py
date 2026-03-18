"""Tests for global error handling."""


class TestGlobalExceptionHandler:
    def test_unhandled_exception_returns_500_json(self, client):
        """The global handler returns 500 JSON for unhandled errors."""
        # Trigger by accessing an endpoint that will cause an internal error
        # We use a specially crafted endpoint registered in conftest for this
        resp = client.get("/api/test-500")
        assert resp.status_code == 500
        assert resp.json()["detail"] == "Внутренняя ошибка сервера"

    def test_health_still_works(self, client):
        resp = client.get("/health")
        assert resp.status_code == 200
        assert resp.json() == {"status": "ok"}
