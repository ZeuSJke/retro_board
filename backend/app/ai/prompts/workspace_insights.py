"""Промпт и кросс-спринт анализ пульса команды по последним ретроспективам."""

import json
import logging
import re
from typing import Any

from app.ai.ai_client import AIModelConfig, ai_client
from app.config import settings

logger = logging.getLogger(__name__)

WORKSPACE_INSIGHTS_PROMPT = """Ты ассистент Agile-коуча. Проанализируй динамику нескольких последних ретроспектив команды и выдели повторяющиеся паттерны.

Данные последних досок (JSON):
{boards_json}

Требования к ответу:
1. summary_text — краткий аналитический вывод о динамике команды за последние спринты (2-4 предложения на русском языке).
2. recurring_themes — список повторяющихся тем или системных проблем/успехов (2-5 коротких пунктов на русском языке).
3. recommendations — конкретные рекомендации для следующих ретроспектив (2-4 пункта на русском языке).

Ответ верни СТРОГО в JSON без markdown и пояснений:
{{
    "summary_text": "строка",
    "recurring_themes": ["тема 1", "тема 2"],
    "recommendations": ["рекомендация 1", "рекомендация 2"]
}}"""

WORKSPACE_INSIGHTS_CONFIG = AIModelConfig(
    temperature=0.3,
    max_tokens=900,
    timeout=60,
    retries=1,
)


def _sanitize_text(value: str, limit: int = 140) -> str:
    cleaned = re.sub(r"[\r\n\t]+", " ", str(value)).strip()
    cleaned = re.sub(r"[<>]", "", cleaned)
    return cleaned[:limit]


def _extract_json(raw: str) -> dict[str, Any] | None:
    cleaned = raw.strip()
    cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned)
    cleaned = re.sub(r"\s*```$", "", cleaned)
    cleaned = cleaned.strip()
    try:
        parsed = json.loads(cleaned)
    except (json.JSONDecodeError, TypeError):
        return None
    return parsed if isinstance(parsed, dict) else None


def _build_fallback_insights(boards_snapshot: list[dict[str, Any]]) -> dict[str, Any]:
    """Детерминистическая сводка, если AI не настроен или недоступен."""
    count = len(boards_snapshot)
    if count == 0:
        return {
            "summary_text": "Недостаточно данных: проведите хотя бы одну ретроспективу для анализа динамики команды.",
            "recurring_themes": [],
            "recommendations": [
                "Создайте первую доску ретроспективы и соберите карточки команды."
            ],
            "boards_analyzed": 0,
            "generated_by_ai": False,
        }

    total_cards = sum(b.get("cards_count", 0) for b in boards_snapshot)
    total_open = sum(b.get("action_items_open", 0) for b in boards_snapshot)
    total_done = sum(b.get("action_items_done", 0) for b in boards_snapshot)
    mood_values = [b["mood_avg"] for b in boards_snapshot if b.get("mood_avg") is not None]

    themes: list[str] = []
    seen_themes: set[str] = set()
    for board in boards_snapshot:
        for theme in board.get("summary_themes", []):
            norm = _sanitize_text(theme, 80)
            if norm and norm.lower() not in seen_themes:
                seen_themes.add(norm.lower())
                themes.append(norm)
            if len(themes) >= 4:
                break
        if len(themes) >= 4:
            break

    if not themes:
        for board in boards_snapshot:
            for card in board.get("top_cards", []):
                norm = _sanitize_text(card, 80)
                if norm and norm.lower() not in seen_themes:
                    seen_themes.add(norm.lower())
                    themes.append(norm)
                if len(themes) >= 4:
                    break
            if len(themes) >= 4:
                break

    mood_fragment = (
        f" Среднее настроение команды — {sum(mood_values) / len(mood_values):.1f}/5."
        if mood_values
        else ""
    )
    summary_text = (
        f"Проанализировано ретроспектив: {count} (карточек: {total_cards})."
        f"{mood_fragment} Задач выполнено: {total_done}, открытых задач остаётся: {total_open}."
    )

    recommendations: list[str] = []
    if total_open > total_done and total_open > 0:
        recommendations.append(
            f"Перенести и пересмотреть {total_open} открытых задач на следующем ретро."
        )
    if mood_values and (sum(mood_values) / len(mood_values)) < 3.5:
        recommendations.append(
            "Низкий индекс настроения команды — уделите больше времени обсуждению блокеров."
        )
    if not recommendations:
        recommendations.append(
            "Продолжайте фиксировать измеримые задачи с ответственными по итогам каждого ретро."
        )

    return {
        "summary_text": summary_text,
        "recurring_themes": themes,
        "recommendations": recommendations,
        "boards_analyzed": count,
        "generated_by_ai": False,
    }


def generate_workspace_insights(boards_snapshot: list[dict[str, Any]]) -> dict[str, Any]:
    """Сформировать кросс-спринт инсайты по команде (AI или fallback)."""
    sanitized_snapshot: list[dict[str, Any]] = []
    for board in boards_snapshot[:8]:
        sanitized_snapshot.append(
            {
                "name": _sanitize_text(board.get("name", ""), 80),
                "mood_avg": board.get("mood_avg"),
                "cards_count": int(board.get("cards_count", 0)),
                "action_items_open": int(board.get("action_items_open", 0)),
                "action_items_done": int(board.get("action_items_done", 0)),
                "summary_themes": [
                    _sanitize_text(t, 100) for t in board.get("summary_themes", [])[:5]
                ],
                "top_cards": [
                    _sanitize_text(c, 120) for c in board.get("top_cards", [])[:5]
                ],
            }
        )

    if not sanitized_snapshot or not settings.ai_configured:
        return _build_fallback_insights(sanitized_snapshot)

    try:
        prompt = WORKSPACE_INSIGHTS_PROMPT.format(
            boards_json=json.dumps(sanitized_snapshot, ensure_ascii=False, indent=2)
        )
        raw = ai_client.generate(prompt, WORKSPACE_INSIGHTS_CONFIG)
        parsed = _extract_json(raw)
        if parsed and isinstance(parsed.get("summary_text"), str) and parsed["summary_text"].strip():
            themes = [
                _sanitize_text(t, 120)
                for t in parsed.get("recurring_themes", [])
                if isinstance(t, str) and t.strip()
            ][:5]
            recs = [
                _sanitize_text(r, 160)
                for r in parsed.get("recommendations", [])
                if isinstance(r, str) and r.strip()
            ][:5]
            return {
                "summary_text": _sanitize_text(parsed["summary_text"], 600),
                "recurring_themes": themes,
                "recommendations": recs,
                "boards_analyzed": len(sanitized_snapshot),
                "generated_by_ai": True,
            }
    except Exception as exc:
        logger.warning("AI workspace insights failed, using deterministic fallback: %s", exc)

    return _build_fallback_insights(sanitized_snapshot)
