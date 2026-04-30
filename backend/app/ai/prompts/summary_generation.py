"""Промпт и конфигурация для генерации резюме ретроспективы."""

import json
from dataclasses import dataclass
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
    model="qwen/qwen3.6-flash",
    temperature=0.4,
    max_tokens=1000,
    timeout=60,
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

        # Validate required fields
        return {
            "summary_text": result.get("summary_text", ""),
            "key_themes": result.get("key_themes", []),
            "recommendations": result.get("recommendations", []),
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
