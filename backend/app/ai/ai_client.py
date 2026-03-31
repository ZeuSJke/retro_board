import os
from dataclasses import dataclass
from typing import Optional

import httpx


@dataclass
class AIModelConfig:
    model: str = "qwen/qwen2.5-coder-7b-instruct"
    temperature: float = 0.3
    max_tokens: int = 100
    timeout: int = 30
    retries: int = 2


class AIClient:
    def __init__(self, api_key: Optional[str] = None):
        self.api_key = api_key or os.getenv("OPENROUTER_API_KEY")
        self.base_url = "https://openrouter.ai/api/v1"

    def generate(
        self,
        prompt: str,
        config: Optional[AIModelConfig] = None,
    ) -> str:
        if config is None:
            config = AIModelConfig()

        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }

        payload = {
            "model": config.model,
            "messages": [{"role": "user", "content": prompt}],
            "temperature": config.temperature,
            "max_tokens": config.max_tokens,
        }

        last_error = None
        for attempt in range(config.retries):
            try:
                with httpx.Client(timeout=config.timeout) as client:
                    response = client.post(
                        f"{self.base_url}/chat/completions",
                        json=payload,
                        headers=headers,
                    )
                    response.raise_for_status()
                    data = response.json()
                    return data["choices"][0]["message"]["content"].strip()
            except (httpx.HTTPError, httpx.TimeoutException) as e:
                last_error = e
                if attempt < config.retries - 1:
                    continue

        raise RuntimeError(
            f"AI request failed after {config.retries} retries: {last_error}"
        )


ai_client = AIClient()
