import json
import threading
from dataclasses import dataclass
from typing import Optional

import httpx

from app.config import settings


@dataclass
class AIModelConfig:
    # Пустая строка = использовать settings.ai_model (модель задаётся одним env).
    model: str = ""
    temperature: float = 0.3
    max_tokens: int = 100
    timeout: int = 30
    retries: int = 2


# Один шлюз обслуживает все команды: ограничиваем число одновременных запросов,
# чтобы очередь не росла в потоках приложения.
_ai_slots = threading.BoundedSemaphore(max(1, settings.ai_max_concurrency))


class AIClient:
    def __init__(
        self,
        api_key: Optional[str] = None,
        base_url: Optional[str] = None,
        transport: Optional[httpx.BaseTransport] = None,
    ):
        # Позволяет переопределить в тестах; по умолчанию — из Settings.
        self.api_key = api_key if api_key is not None else (settings.ai_api_key or None)
        self.base_url = (base_url or settings.ai_base_url).rstrip("/")
        self.transport = transport

    def generate(
        self,
        prompt: str,
        config: Optional[AIModelConfig] = None,
    ) -> str:
        if config is None:
            config = AIModelConfig()

        if not self.base_url:
            raise RuntimeError("AI не настроен: задайте AI_BASE_URL")

        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"

        payload = {
            "model": config.model or settings.ai_model,
            "messages": [{"role": "user", "content": prompt}],
            "temperature": config.temperature,
            "max_tokens": config.max_tokens,
        }

        # Qwen3 — reasoning-модель: без отключения thinking весь бюджет max_tokens
        # уходит в reasoning_content, а content возвращается пустым.
        if settings.ai_disable_thinking:
            payload["chat_template_kwargs"] = {"enable_thinking": False}

        if not _ai_slots.acquire(timeout=settings.ai_queue_timeout_s):
            raise RuntimeError("AI is busy: too many concurrent requests")
        try:
            return self._request(payload, headers, config)
        finally:
            _ai_slots.release()

    def _request(self, payload: dict, headers: dict, config: AIModelConfig) -> str:
        # Недоступный шлюз должен отваливаться быстро, а не через полный таймаут ответа
        timeout = httpx.Timeout(config.timeout, connect=settings.ai_connect_timeout_s)
        last_error: Exception | None = None
        for _attempt in range(config.retries):
            try:
                with httpx.Client(timeout=timeout, transport=self.transport) as client:
                    response = client.post(
                        f"{self.base_url}/chat/completions",
                        json=payload,
                        headers=headers,
                    )
                    response.raise_for_status()
                    return _extract_content(response.json())
            except httpx.HTTPStatusError as e:
                last_error = e
                status = e.response.status_code
                # Ошибку запроса повтор не исправит; 429 и 5xx — временные
                if 400 <= status < 500 and status != 429:
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
            f"AI request failed after {config.retries} retries: {last_error}"
        )


def _extract_content(data: object) -> str:
    """Достать текст ответа; любая неожиданная форма — ValueError."""
    content = data["choices"][0]["message"]["content"]  # type: ignore[index]
    if not isinstance(content, str):
        raise ValueError("AI returned non-text content")
    content = content.strip()
    if content.startswith("."):
        content = content[1:].strip()
    if not content:
        raise ValueError("AI returned empty content")
    return content


ai_client = AIClient()
