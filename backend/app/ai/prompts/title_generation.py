from dataclasses import dataclass

from app.ai.ai_client import AIModelConfig


TITLE_GENERATION_PROMPT = """Сгенерируй краткое название задачи (до 50 символов) на основе текста ниже.

Требования:
- Название на русском языке
- Начинается с глагола в неопределённой форме
- Конкретное и понятное

Текст карточки: {card_text}

Ответ: только название задачи, без кавычек и пояснений."""

TITLE_GENERATION_CONFIG = AIModelConfig(
    model="qwen/qwen3.5-9b",
    temperature=0.3,
    max_tokens=50,
)
