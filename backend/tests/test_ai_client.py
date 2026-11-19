"""Unit tests for app.ai.ai_client.AIClient and reasoning/JSON support."""

import json
import socket
import sys
import threading
from unittest.mock import patch

import httpx
import pytest

import app.ai.ai_client  # noqa: F401
from app.ai.ai_client import (
    AIClient,
    AIModelConfig,
    build_chat_payload,
    effective_max_tokens,
    fetch_ai_models,
    probe_ai_connection,
)
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
        assert "reasoning_effort" not in captured["payload"]

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

    @pytest.mark.parametrize(
        ("effort", "expected_effort", "expected_tokens"),
        [
            ("default", None, 4196),
            ("none", "none", 100),
            ("low", "low", 1124),
            ("medium", "medium", 4196),
            ("high", "high", 6244),
            ("max", "max", 8292),
        ],
    )
    def test_reasoning_effort_payload_and_token_budget(
        self, effort, expected_effort, expected_tokens
    ):
        assert effective_max_tokens(100, effort) == expected_tokens
        payload = build_chat_payload(
            "hello",
            model="model-id",
            temperature=0.3,
            max_tokens=100,
            reasoning_effort=effort,
            json_mode=True,
        )
        assert payload["max_tokens"] == expected_tokens
        assert payload["response_format"] == {"type": "json_object"}
        assert "chat_template_kwargs" not in payload
        if expected_effort is None:
            assert "reasoning_effort" not in payload
        else:
            assert payload["reasoning_effort"] == expected_effort

    def test_json_mode_and_unsupported_param_fallback(self):
        seen_payloads: list[dict] = []

        def handler(request: httpx.Request) -> httpx.Response:
            body = json.loads(request.content)
            seen_payloads.append(body)
            if "response_format" in body:
                return httpx.Response(
                    400, json={"error": {"message": "Unsupported parameter: response_format"}}
                )
            if "reasoning_effort" in body:
                return httpx.Response(
                    400,
                    json={
                        "error": {
                            "message": "Invalid value 'high'. Supported: low, medium.",
                            "param": "reasoning_effort",
                        }
                    },
                )
            if "temperature" in body:
                return httpx.Response(
                    400, json={"error": {"message": "temperature is not supported in thinking mode"}}
                )
            if body.get("max_tokens", 0) > 150:
                return httpx.Response(
                    400,
                    json={"error": {"message": "max_tokens exceeds model limit 4096"}},
                )
            return httpx.Response(
                200, json={"choices": [{"message": {"content": '{"ok": true}'}}]}
            )

        client = AIClient(
            base_url="https://llm.test/v1",
            reasoning_effort="high",
            transport=httpx.MockTransport(handler),
        )
        res = client.generate("json", AIModelConfig(retries=1, max_tokens=150, json_mode=True))
        assert res == '{"ok": true}'
        assert len(seen_payloads) == 5
        assert "response_format" in seen_payloads[0]
        assert "response_format" not in seen_payloads[1]
        assert "reasoning_effort" not in seen_payloads[2]
        assert "temperature" not in seen_payloads[3]
        assert seen_payloads[4]["max_tokens"] == 150

    def test_strip_think_tags_and_finish_reason_length(self):
        client_tags = self._client(
            lambda _r: httpx.Response(
                200,
                json={
                    "choices": [
                        {
                            "finish_reason": "stop",
                            "message": {
                                "content": "<think>внутренние шаги</think>\n{\"a\": 1}"
                            },
                        }
                    ]
                },
            )
        )
        assert client_tags.generate("hi") == '{"a": 1}'

        client_trunc = self._client(
            lambda _r: httpx.Response(
                200,
                json={
                    "choices": [
                        {
                            "finish_reason": "length",
                            "message": {"content": "<think>незакрытые размышления"},
                        }
                    ]
                },
            )
        )
        with pytest.raises(RuntimeError, match="finish_reason=length"):
            client_trunc.generate("hi")

        client_null_trunc = self._client(
            lambda _r: httpx.Response(
                200,
                json={
                    "choices": [
                        {
                            "finish_reason": "length",
                            "message": {"content": None, "reasoning_content": "thought"},
                        }
                    ]
                },
            )
        )
        with pytest.raises(RuntimeError, match="finish_reason=length"):
            client_null_trunc.generate("hi")

    def test_redirect_3xx_does_not_retry(self):
        calls = {"n": 0}

        def handler(_r: httpx.Request) -> httpx.Response:
            calls["n"] += 1
            return httpx.Response(302, headers={"Location": "https://other.example/x"})

        client = self._client(handler)
        with pytest.raises(RuntimeError, match="attempt"):
            client.generate("hi", AIModelConfig(retries=3))
        assert calls["n"] == 1

    def test_reset_shared_client_waits_for_in_flight_request(self):
        entered = threading.Event()
        proceed = threading.Event()
        closed_events: list[str] = []

        class FakeHttpxClient:
            def __init__(self, **_kwargs):
                self.is_closed = False

            def post(self, url, **_kwargs):
                entered.set()
                assert proceed.wait(timeout=3.0)
                if self.is_closed:
                    raise RuntimeError("Cannot send a request, as the client has been closed.")
                return httpx.Response(
                    200,
                    json={"choices": [{"message": {"content": "ok-after-reset"}}]},
                    request=httpx.Request("POST", url),
                )

            def close(self):
                self.is_closed = True
                closed_events.append("closed")

        client = AIClient(base_url="https://api.example.com/v1")
        result_box: list[str] = []
        error_box: list[Exception] = []

        ai_client_module = sys.modules["app.ai.ai_client"]
        with patch.object(ai_client_module, "_ORIGINAL_HTTPX_CLIENT", FakeHttpxClient), patch.object(
            ai_client_module.httpx, "Client", FakeHttpxClient
        ):
            def run_req():
                try:
                    result_box.append(client.generate("hi"))
                except Exception as exc:  # pragma: no cover
                    error_box.append(exc)

            t = threading.Thread(target=run_req)
            t.start()
            assert entered.wait(timeout=3.0)
            client.reset_shared_client()
            assert closed_events == []
            proceed.set()
            t.join(timeout=3.0)

        assert not error_box
        assert result_box == ["ok-after-reset"]
        assert closed_events == ["closed"]

    def test_probe_ai_connection_cases(self):
        seen = {}

        def ok_reasoning_handler(request: httpx.Request) -> httpx.Response:
            seen["url"] = str(request.url)
            seen["payload"] = json.loads(request.content)
            seen["auth"] = request.headers.get("authorization")
            if "temperature" in seen["payload"]:
                return httpx.Response(
                    400, json={"error": {"message": "temperature unsupported"}}
                )
            return httpx.Response(
                200,
                json={
                    "choices": [
                        {
                            "finish_reason": "stop",
                            "message": {
                                "reasoning_content": "Думаю...",
                                "content": "  ОК  ",
                            },
                        }
                    ]
                },
            )

        ok, latency_ms, preview, err, reasoning_used = probe_ai_connection(
            base_url="https://api.example.com/v1/",
            api_key="sk-secret",
            model="reasoning-model",
            reasoning_effort="high",
            transport=httpx.MockTransport(ok_reasoning_handler),
        )
        assert ok is True
        assert latency_ms >= 0
        assert preview == "ОК"
        assert err is None
        assert reasoning_used is True
        assert seen["url"] == "https://api.example.com/v1/chat/completions"
        assert seen["auth"] == "Bearer sk-secret"
        assert seen["payload"]["reasoning_effort"] == "high"
        assert seen["payload"]["max_tokens"] > 1000

        ok, _, preview, err, reasoning_used = probe_ai_connection(
            base_url="https://api.example.com/v1",
            api_key="k",
            model="m",
            transport=httpx.MockTransport(
                lambda _r: httpx.Response(
                    200,
                    json={
                        "choices": [
                            {"message": {"content": "<think>шаги</think>\nОК"}}
                        ]
                    },
                )
            ),
        )
        assert ok is True and preview == "ОК" and reasoning_used is True

        ok, _, _, err, reasoning_used = probe_ai_connection(
            base_url="https://api.example.com/v1",
            api_key="k",
            model="m",
            transport=httpx.MockTransport(
                lambda _r: httpx.Response(
                    200,
                    json={
                        "choices": [
                            {
                                "finish_reason": "length",
                                "message": {"content": "", "reasoning_content": "thought"},
                            }
                        ]
                    },
                )
            ),
        )
        assert ok is False and err and "reasoning_effort" in err and reasoning_used is True

        ok, _, _, err, _ = probe_ai_connection(
            base_url="https://api.example.com/v1",
            api_key="bad",
            model="m",
            transport=httpx.MockTransport(lambda _r: httpx.Response(401)),
        )
        assert ok is False and err and "авторизации" in err

        ok, _, _, err, _ = probe_ai_connection(
            base_url="https://api.example.com/v1",
            api_key="k",
            model="m",
            transport=httpx.MockTransport(lambda _r: httpx.Response(404)),
        )
        assert ok is False and err and "404" in err

        ok, _, _, err, _ = probe_ai_connection(
            base_url="https://api.example.com/v1",
            api_key="k",
            model="m",
            transport=httpx.MockTransport(
                lambda _r: httpx.Response(302, headers={"Location": "http://internal/x"})
            ),
        )
        assert ok is False and err and "редирект" in err.lower()

        with patch(
            "app.services.ai_settings.socket.getaddrinfo",
            return_value=[(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("127.0.0.1", 443))],
        ):
            ok, _, _, err, _ = probe_ai_connection(
                base_url="https://rebind.example.com/v1",
                api_key="k",
                model="m",
            )
            assert ok is False and err and "loopback" in err

    def test_fetch_ai_models_sorting_and_errors(self):
        models = fetch_ai_models(
            base_url="https://api.example.com/v1",
            api_key="sk-1",
            transport=httpx.MockTransport(
                lambda _r: httpx.Response(
                    200,
                    json={
                        "data": [
                            {"id": "model-b"},
                            {"id": "model-a"},
                            {"id": "model-b"},
                            {"id": "   "},
                        ]
                    },
                )
            ),
        )
        assert models == ["model-a", "model-b"]

        with pytest.raises(RuntimeError, match="/models"):
            fetch_ai_models(
                base_url="https://api.example.com/v1",
                api_key="sk-1",
                transport=httpx.MockTransport(lambda _r: httpx.Response(404)),
            )

        with pytest.raises(RuntimeError, match="пустой список"):
            fetch_ai_models(
                base_url="https://api.example.com/v1",
                api_key="sk-1",
                transport=httpx.MockTransport(lambda _r: httpx.Response(200, json={"data": []})),
            )

        with patch(
            "app.services.ai_settings.socket.getaddrinfo",
            return_value=[(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("169.254.169.254", 443))],
        ):
            with pytest.raises(RuntimeError, match="link-local"):
                fetch_ai_models(
                    base_url="https://metadata.example.com/v1",
                    api_key="sk-1",
                )
