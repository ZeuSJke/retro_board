import atexit
import json
import re
import socket
import threading
import time
from dataclasses import dataclass
from typing import Any, Optional

import httpx

from app.config import settings
from app.observability import record_ai_call
from app.services.ai_settings import (
    ReasoningEffort,
    assert_safe_resolved_host,
    get_effective_ai_config,
)

_ORIGINAL_HTTPX_CLIENT = httpx.Client

_THINK_BLOCK_RE = re.compile(r"<think>.*?</think>", re.IGNORECASE | re.DOTALL)
_UNCLOSED_THINK_RE = re.compile(r"<think>.*$", re.IGNORECASE | re.DOTALL)

_REASONING_TOKEN_BONUS: dict[ReasoningEffort, int] = {
    "default": 4096,
    "none": 0,
    "low": 1024,
    "medium": 4096,
    "high": 6144,
    "max": 8192,
}
_MAX_OUTPUT_TOKENS_CAP = 16384


@dataclass
class AIModelConfig:
    # Пустая строка = использовать текущую модель из настроек /admin.
    model: str = ""
    temperature: float = 0.3
    max_tokens: int = 100
    timeout: int = 30
    retries: int = 2
    # Пауза перед повтором растёт с номером попытки: backoff, 2×backoff, …
    backoff: float = 0.5
    json_mode: bool = False


@dataclass
class _ManagedHttpClient:
    client: httpx.Client
    in_flight: int = 0
    retired: bool = False


# Один шлюз обслуживает все команды: ограничиваем число одновременных запросов,
# чтобы очередь не росла в потоках приложения.
_ai_slots = threading.BoundedSemaphore(max(1, settings.ai_max_concurrency))


def effective_max_tokens(
    base_max_tokens: int,
    reasoning_effort: ReasoningEffort,
) -> int:
    """Расширить лимит `max_tokens`, когда у модели могут идти размышления.

    В OpenAI-совместимых API с thinking (DeepSeek, Qwen3, o-серия и др.)
    `max_tokens` ограничивает сумму `reasoning_content + content`. Если оставить
    короткий лимит (например 100–1500), размышления исчерпают бюджет до вывода
    итогового JSON.
    """
    if reasoning_effort == "none":
        return base_max_tokens
    bonus = _REASONING_TOKEN_BONUS.get(reasoning_effort, 4096)
    return min(_MAX_OUTPUT_TOKENS_CAP, max(base_max_tokens, 0) + bonus)


def build_chat_payload(
    prompt: str,
    *,
    model: str,
    temperature: float,
    max_tokens: int,
    reasoning_effort: ReasoningEffort = "default",
    json_mode: bool = False,
) -> dict[str, Any]:
    """Сформировать универсальное тело `/chat/completions` с учётом reasoning и JSON."""
    payload: dict[str, Any] = {
        "model": model,
        "messages": [{"role": "user", "content": prompt}],
        "temperature": temperature,
        "max_tokens": effective_max_tokens(max_tokens, reasoning_effort),
    }
    if json_mode:
        payload["response_format"] = {"type": "json_object"}
    if reasoning_effort != "default":
        payload["reasoning_effort"] = reasoning_effort
    return payload


def _auth_headers(api_key: str | None) -> dict[str, str]:
    headers = {"Content-Type": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    return headers


def _strip_think_tags(text: str) -> str:
    cleaned = _THINK_BLOCK_RE.sub("", text)
    cleaned = _UNCLOSED_THINK_RE.sub("", cleaned)
    return cleaned.strip()


def _extract_error_info(response: httpx.Response) -> tuple[str | None, str | None]:
    try:
        data = response.json()
    except ValueError:
        return None, None
    if not isinstance(data, dict):
        return None, None
    err = data.get("error")
    msg: str | None = None
    param: str | None = None
    if isinstance(err, dict):
        if isinstance(err.get("message"), str):
            msg = err["message"]
        if isinstance(err.get("param"), str):
            param = err["param"]
    elif isinstance(err, str):
        msg = err
    elif isinstance(data.get("detail"), str):
        msg = data["detail"]
    elif isinstance(data.get("message"), str):
        msg = data["message"]
    compact_msg = " ".join(msg.split()) if msg else None
    clean_param = param.strip().lower() if param and param.strip() else None
    return (compact_msg or None), clean_param


def _extract_error_message(response: httpx.Response) -> str | None:
    msg, _param = _extract_error_info(response)
    return msg[:200] if msg else None


def _drop_unsupported_param(
    payload: dict[str, Any],
    response: httpx.Response,
    *,
    base_max_tokens: int | None = None,
) -> bool:
    """Снять опциональный параметр, отклонённый провайдером (400/422), и повторить."""
    if response.status_code not in (400, 422):
        return False
    msg, param = _extract_error_info(response)
    text = (msg or response.text[:1000]).lower()
    if "response_format" in payload and (
        param == "response_format" or "response_format" in text or "json_object" in text
    ):
        payload.pop("response_format", None)
        return True
    if "reasoning_effort" in payload and (
        param == "reasoning_effort" or "reasoning_effort" in text
    ):
        payload.pop("reasoning_effort", None)
        return True
    if "temperature" in payload and (param == "temperature" or "temperature" in text):
        payload.pop("temperature", None)
        return True
    if (
        base_max_tokens is not None
        and isinstance(payload.get("max_tokens"), int)
        and payload["max_tokens"] > base_max_tokens
        and (
            param == "max_tokens"
            or "max_tokens" in text
            or "context length" in text
            or "maximum context" in text
        )
    ):
        payload["max_tokens"] = base_max_tokens
        return True
    return False


class AIClient:
    def __init__(
        self,
        api_key: Optional[str] = None,
        base_url: Optional[str] = None,
        model: Optional[str] = None,
        reasoning_effort: Optional[ReasoningEffort] = None,
        transport: Optional[httpx.BaseTransport] = None,
    ):
        # Явные параметры переопределения нужны для изолированных тестов.
        self._api_key_override = api_key
        self._base_url_override = (
            base_url.rstrip("/") if base_url is not None else None
        )
        self._model_override = model
        self._reasoning_effort_override = reasoning_effort
        self.transport = transport
        self._client_lock = threading.Lock()
        self._shared: _ManagedHttpClient | None = None

    def close(self) -> None:
        client_to_close: httpx.Client | None = None
        with self._client_lock:
            managed = self._shared
            self._shared = None
            if managed is not None:
                managed.retired = True
                if managed.in_flight == 0:
                    client_to_close = managed.client
        if client_to_close is not None and not client_to_close.is_closed:
            client_to_close.close()

    def reset_shared_client(self) -> None:
        """Безопасно пометить текущий пул на закрытие после смены настроек ИИ."""
        self.close()

    def _acquire_shared_client(
        self, default_timeout: httpx.Timeout
    ) -> _ManagedHttpClient:
        with self._client_lock:
            if (
                self._shared is None
                or self._shared.retired
                or self._shared.client.is_closed
            ):
                self._shared = _ManagedHttpClient(
                    client=httpx.Client(
                        timeout=default_timeout, follow_redirects=False
                    )
                )
            self._shared.in_flight += 1
            return self._shared

    def _release_shared_client(self, managed: _ManagedHttpClient) -> None:
        client_to_close: httpx.Client | None = None
        with self._client_lock:
            managed.in_flight = max(0, managed.in_flight - 1)
            if managed.retired and managed.in_flight == 0:
                client_to_close = managed.client
                if self._shared is managed:
                    self._shared = None
        if client_to_close is not None and not client_to_close.is_closed:
            client_to_close.close()

    def generate(
        self,
        prompt: str,
        config: Optional[AIModelConfig] = None,
    ) -> str:
        if config is None:
            config = AIModelConfig()

        effective = get_effective_ai_config()
        if (
            self._base_url_override is None
            and effective.updated_at is not None
            and not effective.enabled
        ):
            raise RuntimeError("AI отключён в настройках администратора")

        base_url = (
            self._base_url_override
            if self._base_url_override is not None
            else effective.base_url
        )
        if not base_url:
            raise RuntimeError("AI не настроен: задайте подключение в /admin")

        if (
            self.transport is None
            and self._base_url_override is None
            and httpx.Client is _ORIGINAL_HTTPX_CLIENT
        ):
            try:
                assert_safe_resolved_host(base_url)
            except ValueError as err:
                raise RuntimeError(str(err)) from err
            except OSError:
                pass

        api_key = (
            self._api_key_override
            if self._api_key_override is not None
            else (effective.api_key or None)
        )
        model = config.model or self._model_override or effective.model
        reasoning_effort = self._reasoning_effort_override or effective.reasoning_effort

        headers = _auth_headers(api_key)
        payload = build_chat_payload(
            prompt,
            model=model,
            temperature=config.temperature,
            max_tokens=config.max_tokens,
            reasoning_effort=reasoning_effort,
            json_mode=config.json_mode,
        )
        url = f"{base_url}/chat/completions"

        if not _ai_slots.acquire(timeout=settings.ai_queue_timeout_s):
            record_ai_call("busy", 0.0)
            raise RuntimeError("AI is busy: too many concurrent requests")
        start = time.perf_counter()
        try:
            result = self._request(url, payload, headers, config)
            record_ai_call("ok", time.perf_counter() - start)
            return result
        except Exception:
            record_ai_call("error", time.perf_counter() - start)
            raise
        finally:
            _ai_slots.release()

    def _request(
        self,
        url: str,
        payload: dict[str, Any],
        headers: dict[str, str],
        config: AIModelConfig,
    ) -> str:
        # Недоступный шлюз должен отваливаться быстро, а не через полный таймаут ответа
        timeout = httpx.Timeout(config.timeout, connect=settings.ai_connect_timeout_s)
        last_error: Exception | None = None
        attempts = 0
        request_payload = dict(payload)

        def _run_attempts(client: httpx.Client) -> str:
            nonlocal last_error, attempts
            dropped_params = 0
            for attempt in range(max(1, config.retries)):
                if attempt:
                    time.sleep(config.backoff * attempt)
                attempts += 1
                try:
                    while True:
                        response = client.post(
                            url,
                            json=request_payload,
                            headers=headers,
                            timeout=timeout,
                        )
                        if (
                            response.status_code in (400, 422)
                            and dropped_params < 4
                            and _drop_unsupported_param(
                                request_payload, response, base_max_tokens=config.max_tokens
                            )
                        ):
                            dropped_params += 1
                            continue
                        break
                    response.raise_for_status()
                    return _extract_content(response.json())
                except httpx.HTTPStatusError as e:
                    last_error = e
                    status = e.response.status_code
                    # Ошибку запроса и 3xx повтор не исправит; 429 и 5xx — временные
                    if 300 <= status < 500 and status != 429:
                        break
                except (
                    httpx.HTTPError,
                    KeyError,
                    IndexError,
                    TypeError,
                    AttributeError,
                    json.JSONDecodeError,
                    ValueError,
                ) as e:
                    last_error = e
            raise RuntimeError(
                f"AI request failed after {attempts} attempt(s): {last_error}"
            )

        # Когда транспорт не подменён тестом и httpx.Client не запатчен, переиспользуем пул соединений.
        if self.transport is None and httpx.Client is _ORIGINAL_HTTPX_CLIENT:
            managed = self._acquire_shared_client(timeout)
            try:
                return _run_attempts(managed.client)
            finally:
                self._release_shared_client(managed)

        with httpx.Client(
            timeout=timeout, transport=self.transport, follow_redirects=False
        ) as client:
            return _run_attempts(client)


def _extract_content_and_meta(data: object) -> tuple[str, bool, str | None]:
    """Достать очищенный от `<think>` текст ответа и метаданные размышлений."""
    choice = data["choices"][0]  # type: ignore[index]
    finish_reason = choice.get("finish_reason") if isinstance(choice, dict) else None
    message = choice["message"]
    raw_content = message.get("content") if isinstance(message, dict) else None
    reasoning_used = bool(
        isinstance(message, dict)
        and (
            message.get("reasoning_content")
            or message.get("reasoning")
            or (isinstance(raw_content, str) and "<think>" in raw_content.lower())
        )
    )
    if raw_content is None and finish_reason == "length":
        raise ValueError("AI truncated response during reasoning (finish_reason=length)")
    if not isinstance(raw_content, str):
        raise ValueError("AI returned non-text content")

    content = _strip_think_tags(raw_content)
    if content.startswith("."):
        content = content[1:].strip()
    if not content:
        if finish_reason == "length":
            raise ValueError("AI truncated response during reasoning (finish_reason=length)")
        raise ValueError("AI returned empty content")
    return content, reasoning_used, finish_reason if isinstance(finish_reason, str) else None


def _extract_content(data: object) -> str:
    """Достать текст ответа; любая неожиданная форма — ValueError."""
    content, _reasoning_used, _finish_reason = _extract_content_and_meta(data)
    return content


def _format_http_error(response: httpx.Response, *, for_models: bool = False) -> str:
    status = response.status_code
    if 300 <= status < 400:
        return (
            f"Сервер вернул перенаправление (HTTP {status}); "
            "автоматические редиректы отключены из соображений безопасности"
        )
    if status in (401, 403):
        return f"Ошибка авторизации (HTTP {status}): проверьте API-ключ"
    if status == 404:
        if for_models:
            return "Эндпоинт /models не поддерживается провайдером — введите имя модели вручную"
        return "Эндпоинт /chat/completions не найден (HTTP 404): проверьте Base URL"
    detail = _extract_error_message(response)
    suffix = f": {detail}" if detail else ""
    if status == 429:
        return f"Превышен лимит запросов провайдера (HTTP 429){suffix}"
    if status >= 500:
        return f"Сервер провайдера вернул ошибку (HTTP {status}){suffix}"
    return f"Запрос отклонён провайдером (HTTP {status}){suffix}"


def _format_network_error(exc: Exception) -> str:
    if isinstance(exc, httpx.TimeoutException):
        return "Превышен таймаут ожидания ответа от сервера ИИ"
    if isinstance(exc, socket.gaierror):
        return "Не удалось разрешить DNS-имя сервера ИИ"
    if isinstance(exc, httpx.HTTPError):
        return f"Ошибка сети или TLS при обращении к серверу ИИ: {type(exc).__name__}"
    return f"Неожиданный формат ответа от сервера ИИ: {exc}"


def probe_ai_connection(
    *,
    base_url: str,
    api_key: str,
    model: str,
    reasoning_effort: ReasoningEffort = "default",
    transport: httpx.BaseTransport | None = None,
) -> tuple[bool, int, str | None, str | None, bool]:
    """Выполнить пробный запрос `/chat/completions` для проверки настроек в `/admin`."""
    clean_url = base_url.strip().rstrip("/")
    if transport is None:
        try:
            assert_safe_resolved_host(clean_url)
        except ValueError as err:
            return False, 0, None, str(err), False
        except OSError as err:
            return False, 0, None, _format_network_error(err), False

    payload = build_chat_payload(
        "Ответь одним словом: ОК",
        model=model.strip(),
        temperature=0.0,
        max_tokens=32,
        reasoning_effort=reasoning_effort,
    )
    timeout = httpx.Timeout(30.0, connect=settings.ai_connect_timeout_s)
    start = time.perf_counter()
    try:
        with httpx.Client(
            timeout=timeout, transport=transport, follow_redirects=False
        ) as client:
            dropped = 0
            while True:
                response = client.post(
                    f"{clean_url}/chat/completions",
                    json=payload,
                    headers=_auth_headers(api_key or None),
                )
                if (
                    response.status_code in (400, 422)
                    and dropped < 4
                    and _drop_unsupported_param(payload, response, base_max_tokens=32)
                ):
                    dropped += 1
                    continue
                break
        latency_ms = max(0, int(round((time.perf_counter() - start) * 1000)))
        if not response.is_success:
            return False, latency_ms, None, _format_http_error(response), False

        data = response.json()
        choice = data["choices"][0]
        finish_reason = choice.get("finish_reason") if isinstance(choice, dict) else None
        message = choice["message"]
        raw_content = message.get("content") if isinstance(message, dict) else None
        reasoning_used = bool(
            isinstance(message, dict)
            and (
                message.get("reasoning_content")
                or message.get("reasoning")
                or (isinstance(raw_content, str) and "<think>" in raw_content.lower())
            )
        )
        cleaned = _strip_think_tags(raw_content) if isinstance(raw_content, str) else ""
        if not cleaned:
            if finish_reason == "length" and reasoning_used:
                return (
                    False,
                    latency_ms,
                    None,
                    "Модель исчерпала лимит токенов на размышления; попробуйте выбрать более низкий уровень reasoning_effort",
                    True,
                )
            if reasoning_used:
                return (
                    False,
                    latency_ms,
                    None,
                    "Модель вернула только размышления без итогового текста; попробуйте выбрать более низкий уровень reasoning_effort",
                    True,
                )
            return False, latency_ms, None, "Модель вернула пустой ответ", False
        return True, latency_ms, cleaned[:80], None, reasoning_used
    except (
        httpx.HTTPError,
        KeyError,
        IndexError,
        TypeError,
        AttributeError,
        json.JSONDecodeError,
        ValueError,
    ) as exc:
        latency_ms = max(0, int(round((time.perf_counter() - start) * 1000)))
        return False, latency_ms, None, _format_network_error(exc), False


def fetch_ai_models(
    *,
    base_url: str,
    api_key: str,
    transport: httpx.BaseTransport | None = None,
) -> list[str]:
    """Загрузить список доступных моделей через OpenAI-совместимый `GET /models`."""
    clean_url = base_url.strip().rstrip("/")
    if transport is None:
        try:
            assert_safe_resolved_host(clean_url)
        except ValueError as err:
            raise RuntimeError(str(err)) from err
        except OSError as err:
            raise RuntimeError(_format_network_error(err)) from err

    timeout = httpx.Timeout(10.0, connect=settings.ai_connect_timeout_s)
    headers: dict[str, str] = {}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    try:
        with httpx.Client(
            timeout=timeout, transport=transport, follow_redirects=False
        ) as client:
            response = client.get(f"{clean_url}/models", headers=headers)
        if not response.is_success:
            raise RuntimeError(_format_http_error(response, for_models=True))
        payload = response.json()
        items = payload.get("data") if isinstance(payload, dict) else None
        if not isinstance(items, list):
            raise ValueError("отсутствует массив data")
        models = sorted(
            {
                item["id"].strip()
                for item in items
                if isinstance(item, dict)
                and isinstance(item.get("id"), str)
                and item["id"].strip()
            }
        )
        if not models:
            raise RuntimeError(
                "Провайдер вернул пустой список моделей — введите имя модели вручную"
            )
        return models
    except RuntimeError:
        raise
    except (httpx.HTTPError, json.JSONDecodeError, TypeError, ValueError) as exc:
        raise RuntimeError(_format_network_error(exc)) from exc


ai_client = AIClient()
atexit.register(ai_client.close)
