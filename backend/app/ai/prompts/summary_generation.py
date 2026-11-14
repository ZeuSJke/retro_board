"""Промпт и конфигурация для генерации резюме ретроспективы."""

import json
from typing import Any

from app.ai.ai_client import AIModelConfig, ai_client

SUMMARY_GENERATION_PROMPT = """Проанализируй данные ретроспективы и сгенерируй структурированное резюме.

Данные доски:
{board_data}

Требования к ответу:
1. summary_text — общий вывод о ретроспективе (2-4 предложения)
2. key_themes — список ключевых тем/паттернов (3-5 пунктов)
3. recommendations — конкретные рекомендации по улучшению (3-5 пунктов)

Ответ должен быть в формате JSON:
{{
    "summary_text": "строка",
    "key_themes": ["тема 1", "тема 2", ...],
    "recommendations": ["рекомендация 1", "рекомендация 2", ...]
}}

Ответ только JSON, без пояснений."""

SUMMARY_GENERATION_CONFIG = AIModelConfig(
    temperature=0.4,
    max_tokens=1000,
    timeout=90,
    retries=2,
)


def format_board_data(board_data: dict[str, Any]) -> str:
    """Format board data for AI prompt."""
    lines = [
        f"Название доски: {board_data.get('name', 'Без названия')}",
        "\nКолонки и карточки:",
    ]

    for column in board_data.get("columns", []):
        lines.append(f"\n[{column.get('title', 'Без названия')}]")
        cards = column.get("cards", [])
        if not cards:
            lines.append("  (нет карточек)")
        for card in cards:
            text = card.get("text", "")
            author = card.get("author", "Аноним")
            likes = len(card.get("likes", []))
            lines.append(
                f'  - "{text[:100]}{"..." if len(text) > 100 else ""}" (автор: {author}, лайков: {likes})'
            )

    return "\n".join(lines)


MAX_SUMMARY_CHARS = 4000
MAX_LIST_ITEMS = 10
MAX_LIST_ITEM_CHARS = 300


def _clean_str_list(value: Any) -> list[str]:
    """Оставить только непустые строки, обрезав длину и количество."""
    if not isinstance(value, list):
        return []
    items = [v.strip()[:MAX_LIST_ITEM_CHARS] for v in value if isinstance(v, str) and v.strip()]
    return items[:MAX_LIST_ITEMS]


def generate_summary(board_data: dict[str, Any]) -> dict[str, Any]:
    """Generate summary using AI.

    Args:
        board_data: Dictionary with board data including columns and cards

    Returns:
        Dictionary with summary_text, key_themes, and recommendations
    """
    formatted_data = format_board_data(board_data)
    prompt = SUMMARY_GENERATION_PROMPT.format(board_data=formatted_data)

    response = ai_client.generate(prompt, SUMMARY_GENERATION_CONFIG)

    # Parse JSON response
    try:
        # Clean up response - remove markdown code blocks if present
        cleaned = response.strip()
        if cleaned.startswith("```json"):
            cleaned = cleaned[7:]
        if cleaned.startswith("```"):
            cleaned = cleaned[3:]
        if cleaned.endswith("```"):
            cleaned = cleaned[:-3]
        cleaned = cleaned.strip()

        result = json.loads(cleaned)
        if not isinstance(result, dict):
            raise json.JSONDecodeError("not an object", cleaned, 0)

        # Ответ модели — недоверенный ввод: приводим поля к ожидаемым типам
        summary_text = result.get("summary_text")
        return {
            "summary_text": summary_text.strip()[:MAX_SUMMARY_CHARS]
            if isinstance(summary_text, str)
            else "",
            "key_themes": _clean_str_list(result.get("key_themes")),
            "recommendations": _clean_str_list(result.get("recommendations")),
        }
    except json.JSONDecodeError:
        # Fallback if AI returns non-JSON
        return {
            "summary_text": response[:500]
            if response
            else "Не удалось сгенерировать резюме",
            "key_themes": [],
            "recommendations": [],
        }
