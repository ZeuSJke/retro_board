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

        last_error = None
        for attempt in range(config.retries):
            try:
                with httpx.Client(timeout=config.timeout, transport=self.transport) as client:
                    response = client.post(
                        f"{self.base_url}/chat/completions",
                        json=payload,
                        headers=headers,
                    )
                    response.raise_for_status()
                    data = response.json()
                    content = data["choices"][0]["message"]["content"].strip()
                    if content.startswith("."):
                        content = content[1:].strip()
                    if not content:
                        raise RuntimeError("AI returned empty content")
                    return content
            except (httpx.HTTPError, httpx.TimeoutException, KeyError, IndexError) as e:
                last_error = e
                if attempt < config.retries - 1:
                    continue

        raise RuntimeError(
            f"AI request failed after {config.retries} retries: {last_error}"
        )


ai_client = AIClient()
