"""Тесты админских настроек OpenAI-совместимого ИИ (`/api/admin/ai-settings*`)."""

import socket
from unittest.mock import patch

import httpx
import pytest
from sqlalchemy import event

from app import models
from app.ai import ai_client
from app.config import settings
from app.services.ai_settings import invalidate_ai_settings_cache
from tests.conftest import engine as test_engine


@pytest.fixture()
def tracked_connections():
    """Счётчик открытых DB-соединений для проверки освобождения до HTTP-вызовов."""
    state = {"open": 0}

    def on_checkout(_dbapi_conn, _record, _proxy):
        state["open"] += 1

    def on_checkin(_dbapi_conn, _record):
        state["open"] -= 1

    event.listen(test_engine, "checkout", on_checkout)
    event.listen(test_engine, "checkin", on_checkin)
    try:
        yield state
    finally:
        event.remove(test_engine, "checkout", on_checkout)
        event.remove(test_engine, "checkin", on_checkin)


class TestAdminAiSettingsAuth:
    def test_requires_admin_auth_on_all_endpoints(self, client):
        assert client.get("/api/admin/ai-settings").status_code == 401
        assert (
            client.put(
                "/api/admin/ai-settings",
                json={
                    "enabled": True,
                    "base_url": "https://api.example.com/v1",
                    "model": "model-id",
                    "reasoning_effort": "default",
                },
            ).status_code
            == 401
        )
        assert client.delete("/api/admin/ai-settings").status_code == 401
        assert (
            client.post(
                "/api/admin/ai-settings/test",
                json={
                    "base_url": "https://api.example.com/v1",
                    "model": "model-id",
                    "reasoning_effort": "default",
                },
            ).status_code
            == 401
        )
        assert (
            client.post(
                "/api/admin/ai-settings/models",
                json={"base_url": "https://api.example.com/v1"},
            ).status_code
            == 401
        )


class TestAdminAiSettingsCRUD:
    def test_get_returns_env_defaults_and_masks_key(self, client, admin_headers):
        with (
            patch.object(settings, "ai_base_url", "HTTPS://LLM.EXAMPLE.COM:443/v1/"),
            patch.object(settings, "ai_api_key", "sk-secret-value-1234"),
            patch.object(settings, "ai_model", "model-from-env"),
            patch.object(settings, "ai_disable_thinking", True),
        ):
            resp = client.get("/api/admin/ai-settings", headers=admin_headers)
        assert resp.status_code == 200
        assert resp.headers.get("cache-control") == "no-store"
        data = resp.json()
        assert data["source"] == "env"
        assert data["enabled"] is True
        assert data["base_url"] == "https://llm.example.com/v1"
        assert data["model"] == "model-from-env"
        assert data["reasoning_effort"] == "none"
        assert data["has_api_key"] is True
        assert data["api_key_masked"] == "sk-••••1234"
        assert data["env_configured"] is True
        assert "sk-secret-value-1234" not in resp.text

    def test_put_encrypts_key_updates_workspaces_me_and_switches_live_client(
        self, client, db_session, admin_headers, workspace_headers
    ):
        with patch.object(settings, "ai_base_url", ""):
            me_before = client.get("/api/workspaces/me", headers=workspace_headers).json()
            assert me_before["ai_enabled"] is False

            put_resp = client.put(
                "/api/admin/ai-settings",
                headers=admin_headers,
                json={
                    "enabled": True,
                    "base_url": "HTTPS://API.EXAMPLE.COM:443/v1/",
                    "model": "reasoning-model",
                    "reasoning_effort": "high",
                    "api_key": "sk-provider-secret-9876",
                },
            )
            assert put_resp.status_code == 200, put_resp.text
            saved = put_resp.json()
            assert saved["source"] == "database"
            assert saved["enabled"] is True
            assert saved["base_url"] == "https://api.example.com/v1"
            assert saved["model"] == "reasoning-model"
            assert saved["reasoning_effort"] == "high"
            assert saved["has_api_key"] is True
            assert saved["api_key_masked"] == "sk-••••9876"
            assert "sk-provider-secret-9876" not in put_resp.text

            row = db_session.get(models.AISettings, 1)
            assert row is not None
            assert row.api_key_encrypted is not None
            assert "sk-provider-secret-9876" not in row.api_key_encrypted

            me_after = client.get("/api/workspaces/me", headers=workspace_headers).json()
            assert me_after["ai_enabled"] is True

            # Живой вызов через глобальный ai_client идёт на новый URL с reasoning_effort и json_mode
            seen = {}

            def handler(request: httpx.Request) -> httpx.Response:
                seen["url"] = str(request.url)
                seen["json"] = json_loads(request.content)
                seen["auth"] = request.headers.get("authorization")
                return httpx.Response(
                    200, json={"choices": [{"message": {"content": "Готово"}}]}
                )

            def json_loads(raw: bytes) -> dict:
                import json as _json

                return _json.loads(raw)

            with patch.object(ai_client, "transport", httpx.MockTransport(handler)):
                out = ai_client.generate("Привет")

            assert out == "Готово"
            assert seen["url"] == "https://api.example.com/v1/chat/completions"
            assert seen["json"]["model"] == "reasoning-model"
            assert seen["json"]["reasoning_effort"] == "high"
            assert seen["auth"] == "Bearer sk-provider-secret-9876"

    def test_key_lifecycle_preserve_canonical_url_drop_on_host_change_and_clear(
        self, client, db_session, admin_headers
    ):
        # Первый PUT с тем же URL, что в env (но в другом регистре и с :443), переносит ключ из env
        with (
            patch.object(settings, "ai_base_url", "https://gw.example.com/v1"),
            patch.object(settings, "ai_api_key", "sk-env-inherited-1111"),
        ):
            r_inherit = client.put(
                "/api/admin/ai-settings",
                headers=admin_headers,
                json={
                    "enabled": True,
                    "base_url": "HTTPS://GW.EXAMPLE.COM:443/v1/",
                    "model": "model-1",
                    "reasoning_effort": "medium",
                },
            )
            assert r_inherit.status_code == 200
            assert r_inherit.json()["has_api_key"] is True
            assert r_inherit.json()["api_key_masked"] == "sk-••••1111"

        # Повторный PUT с тем же каноническим URL (другой регистр / :443) сохраняет ключ
        r_keep = client.put(
            "/api/admin/ai-settings",
            headers=admin_headers,
            json={
                "enabled": True,
                "base_url": "https://gw.example.com:443/v1/",
                "model": "model-2",
                "reasoning_effort": "low",
                "api_key": "",
            },
        )
        assert r_keep.status_code == 200
        assert r_keep.json()["has_api_key"] is True
        assert r_keep.json()["api_key_masked"] == "sk-••••1111"

        # Смена хоста без нового ключа НЕ переносит старый ключ
        r_host_change = client.put(
            "/api/admin/ai-settings",
            headers=admin_headers,
            json={
                "enabled": True,
                "base_url": "https://other.example.com/v1",
                "model": "model-3",
                "reasoning_effort": "none",
                "api_key": None,
            },
        )
        assert r_host_change.status_code == 200
        assert r_host_change.json()["has_api_key"] is False
        assert r_host_change.json()["api_key_masked"] is None

        # Явная очистка ключа
        client.put(
            "/api/admin/ai-settings",
            headers=admin_headers,
            json={
                "enabled": True,
                "base_url": "https://other.example.com/v1",
                "model": "model-3",
                "reasoning_effort": "default",
                "api_key": "sk-new-key-2222",
            },
        )
        r_clear = client.put(
            "/api/admin/ai-settings",
            headers=admin_headers,
            json={
                "enabled": True,
                "base_url": "https://other.example.com/v1",
                "model": "model-3",
                "reasoning_effort": "default",
                "clear_api_key": True,
            },
        )
        assert r_clear.status_code == 200
        assert r_clear.json()["has_api_key"] is False
        db_session.expire_all()
        assert db_session.get(models.AISettings, 1).api_key_encrypted is None

    def test_delete_resets_to_env_and_disable_turns_off_ai_and_blocks_client(
        self, client, admin_headers, workspace_headers
    ):
        with (
            patch.object(settings, "ai_base_url", "https://env-gw.example.com/v1"),
            patch.object(settings, "ai_model", "env-model"),
            patch.object(settings, "ai_api_key", "sk-env-9999"),
        ):
            r_disable = client.put(
                "/api/admin/ai-settings",
                headers=admin_headers,
                json={
                    "enabled": False,
                    "base_url": "",
                    "model": "",
                    "reasoning_effort": "default",
                },
            )
            assert r_disable.status_code == 200
            assert r_disable.json()["source"] == "database"
            assert r_disable.json()["enabled"] is False
            assert (
                client.get("/api/workspaces/me", headers=workspace_headers).json()[
                    "ai_enabled"
                ]
                is False
            )
            with pytest.raises(RuntimeError, match="отключён"):
                ai_client.generate("Привет")

            r_reset = client.delete("/api/admin/ai-settings", headers=admin_headers)
            assert r_reset.status_code == 200
            reset_data = r_reset.json()
            assert reset_data["source"] == "env"
            assert reset_data["base_url"] == "https://env-gw.example.com/v1"
            assert (
                client.get("/api/workspaces/me", headers=workspace_headers).json()[
                    "ai_enabled"
                ]
                is True
            )

    @pytest.mark.parametrize(
        "bad_url",
        [
            "http://api.example.com/v1",
            "https://localhost/v1",
            "https://sub.localhost/v1",
            "https://127.0.0.1/v1",
            "https://127.1/v1",
            "https://[::1]/v1",
            "https://[::ffff:127.0.0.1]/v1",
            "https://[::ffff:169.254.169.254]/v1",
            "https://2130706433/v1",
            "https://0x7f000001/v1",
            "https://0x7f.0.0.1/v1",
            "https://0xa9fea9fe/v1",
            "https://0177.0.0.1/v1",
            "https://169.254.169.254/v1",
            "https://[fe80::1]/v1",
            "https://user:pass@api.example.com/v1",
            "https://api.example.com/v1?foo=bar",
            "https://api.example.com/v1#frag",
            "https://api.example.com/v1 extra",
        ],
    )
    def test_url_validation_rejects_unsafe_or_non_https_urls(
        self, client, admin_headers, bad_url
    ):
        resp = client.put(
            "/api/admin/ai-settings",
            headers=admin_headers,
            json={
                "enabled": True,
                "base_url": bad_url,
                "model": "model-id",
                "reasoning_effort": "default",
            },
        )
        assert resp.status_code == 422

    def test_enabled_requires_url_and_model(self, client, admin_headers):
        r_no_url = client.put(
            "/api/admin/ai-settings",
            headers=admin_headers,
            json={
                "enabled": True,
                "base_url": "",
                "model": "model-id",
                "reasoning_effort": "default",
            },
        )
        assert r_no_url.status_code == 422

        r_no_model = client.put(
            "/api/admin/ai-settings",
            headers=admin_headers,
            json={
                "enabled": True,
                "base_url": "https://api.example.com/v1",
                "model": "   ",
                "reasoning_effort": "default",
            },
        )
        assert r_no_model.status_code == 422

    def test_corrupted_encrypted_key_can_be_cleared_or_replaced(
        self, client, db_session, admin_headers, workspace_headers
    ):
        db_session.add(
            models.AISettings(
                id=1,
                enabled=True,
                base_url="https://api.example.com/v1",
                api_key_encrypted="corrupted-token-after-secret-rotation",
                model="model-id",
                reasoning_effort="default",
            )
        )
        db_session.commit()
        invalidate_ai_settings_cache()

        me_resp = client.get("/api/workspaces/me", headers=workspace_headers)
        assert me_resp.status_code == 200
        assert me_resp.json()["ai_enabled"] is True

        get_resp = client.get("/api/admin/ai-settings", headers=admin_headers)
        assert get_resp.status_code == 200
        data = get_resp.json()
        assert data["key_decrypt_error"] is True
        assert data["has_api_key"] is True
        assert data["api_key_masked"] is None

        clear_resp = client.put(
            "/api/admin/ai-settings",
            headers=admin_headers,
            json={
                "enabled": True,
                "base_url": "https://api.example.com/v1",
                "model": "model-id",
                "reasoning_effort": "default",
                "clear_api_key": True,
            },
        )
        assert clear_resp.status_code == 200
        assert clear_resp.json()["key_decrypt_error"] is False
        assert clear_resp.json()["has_api_key"] is False


class TestAdminAiSettingsProbeEndpoints:
    def test_probe_uses_saved_key_for_canonical_url_and_releases_db_connection(
        self, client, admin_headers, tracked_connections
    ):
        # 1. В режиме env ключ из настроек окружения тоже подставляется на совпадающий URL
        with (
            patch.object(settings, "ai_base_url", "https://env.example.com/v1"),
            patch.object(settings, "ai_api_key", "sk-from-env"),
        ):
            env_seen: list[dict] = []

            def env_probe(*, base_url, api_key, model, reasoning_effort):
                env_seen.append(
                    {"api_key": api_key, "open_conns": tracked_connections["open"]}
                )
                return True, 12, "ОК", None, False

            with patch("app.routers.admin.probe_ai_connection", side_effect=env_probe):
                r_env = client.post(
                    "/api/admin/ai-settings/test",
                    headers=admin_headers,
                    json={
                        "base_url": "HTTPS://ENV.EXAMPLE.COM:443/v1/",
                        "model": "m1",
                        "reasoning_effort": "default",
                    },
                )
                assert r_env.status_code == 200
            assert env_seen == [{"api_key": "sk-from-env", "open_conns": 0}]

        # 2. В режиме database ключ подставляется только на тот же хост; соединение закрыто до запроса
        client.put(
            "/api/admin/ai-settings",
            headers=admin_headers,
            json={
                "enabled": True,
                "base_url": "https://api.example.com/v1",
                "model": "model-id",
                "reasoning_effort": "medium",
                "api_key": "sk-saved-secret",
            },
        )

        captured_test: list[dict] = []

        def fake_probe(*, base_url, api_key, model, reasoning_effort):
            captured_test.append(
                {
                    "base_url": base_url,
                    "api_key": api_key,
                    "model": model,
                    "reasoning_effort": reasoning_effort,
                    "open_conns": tracked_connections["open"],
                }
            )
            return True, 42, "ОК", None, True

        with patch("app.routers.admin.probe_ai_connection", side_effect=fake_probe):
            r_same = client.post(
                "/api/admin/ai-settings/test",
                headers=admin_headers,
                json={
                    "base_url": "HTTPS://API.EXAMPLE.COM:443/v1/",
                    "model": "model-id",
                    "reasoning_effort": "high",
                },
            )
            assert r_same.status_code == 200
            assert r_same.json() == {
                "ok": True,
                "latency_ms": 42,
                "reply_preview": "ОК",
                "error": None,
                "reasoning_used": True,
            }

            r_other = client.post(
                "/api/admin/ai-settings/test",
                headers=admin_headers,
                json={
                    "base_url": "https://evil.example.com/v1",
                    "model": "other-model",
                    "reasoning_effort": "none",
                },
            )
            assert r_other.status_code == 200

        assert captured_test[0]["api_key"] == "sk-saved-secret"
        assert captured_test[0]["open_conns"] == 0
        assert captured_test[1]["api_key"] == ""
        assert captured_test[1]["open_conns"] == 0

        captured_models: list[dict] = []

        def fake_models(*, base_url, api_key):
            captured_models.append(
                {
                    "base_url": base_url,
                    "api_key": api_key,
                    "open_conns": tracked_connections["open"],
                }
            )
            return ["model-a", "model-b"]

        with patch("app.routers.admin.fetch_ai_models", side_effect=fake_models):
            r_models_same = client.post(
                "/api/admin/ai-settings/models",
                headers=admin_headers,
                json={"base_url": "https://api.example.com/v1"},
            )
            assert r_models_same.status_code == 200
            assert r_models_same.json() == {"models": ["model-a", "model-b"]}

            r_models_other = client.post(
                "/api/admin/ai-settings/models",
                headers=admin_headers,
                json={"base_url": "https://other.example.com/v1"},
            )
            assert r_models_other.status_code == 200

        assert captured_models[0] == {
            "base_url": "https://api.example.com/v1",
            "api_key": "sk-saved-secret",
            "open_conns": 0,
        }
        assert captured_models[1] == {
            "base_url": "https://other.example.com/v1",
            "api_key": "",
            "open_conns": 0,
        }

    def test_models_endpoint_propagates_502_on_upstream_error(
        self, client, admin_headers
    ):
        with patch(
            "app.routers.admin.fetch_ai_models",
            side_effect=RuntimeError("Ошибка авторизации (HTTP 401): проверьте API-ключ"),
        ):
            resp = client.post(
                "/api/admin/ai-settings/models",
                headers=admin_headers,
                json={
                    "base_url": "https://api.example.com/v1",
                    "api_key": "sk-bad",
                },
            )
        assert resp.status_code == 502
        assert "401" in resp.json()["detail"]

    def test_probe_endpoints_block_dns_ssrf(self, client, admin_headers):
        with patch(
            "app.services.ai_settings.socket.getaddrinfo",
            return_value=[(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("127.0.0.1", 443))],
        ):
            r_test = client.post(
                "/api/admin/ai-settings/test",
                headers=admin_headers,
                json={
                    "base_url": "https://rebind.example.com/v1",
                    "model": "m",
                    "reasoning_effort": "default",
                },
            )
            assert r_test.status_code == 200
            assert r_test.json()["ok"] is False
            assert "loopback" in (r_test.json()["error"] or "")

            r_models = client.post(
                "/api/admin/ai-settings/models",
                headers=admin_headers,
                json={"base_url": "https://rebind.example.com/v1"},
            )
            assert r_models.status_code == 502
            assert "loopback" in r_models.json()["detail"]

    def test_probe_endpoints_validate_url(self, client, admin_headers):
        r1 = client.post(
            "/api/admin/ai-settings/test",
            headers=admin_headers,
            json={
                "base_url": "http://api.example.com/v1",
                "model": "m",
                "reasoning_effort": "default",
            },
        )
        assert r1.status_code == 422

        r2 = client.post(
            "/api/admin/ai-settings/models",
            headers=admin_headers,
            json={"base_url": "https://0x7f000001/v1"},
        )
        assert r2.status_code == 422
