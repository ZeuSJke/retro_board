"""Unit tests for app.ai.ai_client.AIClient."""

import json
from unittest.mock import patch

import httpx
import pytest

from app.ai.ai_client import AIClient, AIModelConfig
from app.config import settings


class TestAIClient:
    """Tests for AIClient.generate() against the OpenAI-compatible API."""

    def _client(self, handler, api_key=None, base_url="http://llm.test/v1"):
        transport = httpx.MockTransport(handler)
        return AIClient(api_key=api_key, base_url=base_url, transport=transport)

    def _capture_handler(self, captured):
        def handler(request: httpx.Request) -> httpx.Response:
            captured["payload"] = json.loads(request.content)
            captured["headers"] = dict(request.headers)
            return httpx.Response(
                200, json={"choices": [{"message": {"content": "ok"}}]}
            )
        return handler

    def test_model_from_settings_when_config_empty(self):
        captured = {}
        client = self._client(self._capture_handler(captured))
        with patch.object(settings, "ai_model", "test-model-from-settings"):
            client.generate("hi")
        assert captured["payload"]["model"] == "test-model-from-settings"

    def test_config_model_takes_priority(self):
        captured = {}
        client = self._client(self._capture_handler(captured))
        cfg = AIModelConfig(model="custom-model")
        with patch.object(settings, "ai_model", "default-model"):
            client.generate("hi", cfg)
        assert captured["payload"]["model"] == "custom-model"

    def test_enable_thinking_false_sent_when_disabled(self):
        captured = {}
        client = self._client(self._capture_handler(captured))
        with patch.object(settings, "ai_disable_thinking", True):
            client.generate("hi")
        assert captured["payload"]["chat_template_kwargs"] == {
            "enable_thinking": False
        }

    def test_no_thinking_param_when_enabled(self):
        captured = {}
        client = self._client(self._capture_handler(captured))
        with patch.object(settings, "ai_disable_thinking", False):
            client.generate("hi")
        assert "chat_template_kwargs" not in captured["payload"]

    def test_no_auth_header_without_key(self):
        captured = {}
        client = self._client(self._capture_handler(captured), api_key=None)
        with patch.object(settings, "ai_api_key", ""):
            client.generate("hi")
        assert "authorization" not in {
            k.lower() for k in captured["headers"]
        }

    def test_auth_header_with_key(self):
        captured = {}
        client = self._client(self._capture_handler(captured), api_key="sk-test")
        client.generate("hi")
        headers_lower = {k.lower(): v for k, v in captured["headers"].items()}
        assert headers_lower.get("authorization") == "Bearer sk-test"

    def test_empty_content_raises(self):
        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(
                200,
                json={"choices": [{"message": {"content": "   "}}]},
            )
        client = self._client(handler)
        with pytest.raises(RuntimeError, match="empty content"):
            client.generate("hi")

    def test_retries_then_succeeds(self):
        calls = {"n": 0}

        def handler(request: httpx.Request) -> httpx.Response:
            calls["n"] += 1
            if calls["n"] == 1:
                return httpx.Response(500, json={"error": "boom"})
            return httpx.Response(
                200, json={"choices": [{"message": {"content": "ok"}}]}
            )
        client = self._client(handler)
        cfg = AIModelConfig(retries=2)
        assert client.generate("hi", cfg) == "ok"
        assert calls["n"] == 2

    def test_leading_dot_stripped(self):
        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(
                200,
                json={"choices": [{"message": {"content": ". Название"}}]},
            )
        client = self._client(handler)
        assert client.generate("hi") == "Название"

    def test_no_base_url_raises(self):
        client = AIClient(api_key=None, base_url="")
        with patch.object(settings, "ai_base_url", ""):
            with pytest.raises(RuntimeError, match="AI_BASE_URL"):
                client.generate("hi")
