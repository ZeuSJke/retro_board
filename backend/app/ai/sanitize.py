"""Очистка пользовательского текста и разбор JSON-ответов модели."""

import json
import re
from typing import Any

# Управляющие символы и юникодные разделители строк: каждая запись в запросе
# занимает одну строку, и текст не должен её разрывать.
_LINE_BREAKING_RE = re.compile(r"[\x00-\x1f\x7f\x85\u2028\u2029]")


def sanitize_prompt_text(value: object, limit: int = 200) -> str:
    """Обрезать текст и убрать символы, которыми можно сломать структуру запроса.

    Кавычки заменяются на одинарные, обратная косая черта удаляется,
    управляющие символы и переводы строк становятся пробелами.
    """
    text = str(value or "")[:limit]
    text = text.replace('"', "'").replace("\\", "")
    text = _LINE_BREAKING_RE.sub(" ", text)
    return text.strip()


def sanitize_insight_text(value: object, limit: int = 140) -> str:
    """Очистка текста для JSON-сводок и человекочитаемого вывода (удаляет переводы строк и угловые скобки)."""
    cleaned = re.sub(r"[\r\n\t]+", " ", str(value or "")).strip()
    cleaned = re.sub(r"[<>]", "", cleaned)
    return cleaned[:limit]


def _strip_code_fences(raw: str) -> str:
    cleaned = (raw or "").strip()
    cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned)
    cleaned = re.sub(r"\s*```$", "", cleaned)
    return cleaned.strip()


def extract_json_value(raw: str, *, expected_type: type | None = None) -> Any:
    """Извлечь JSON (объект или массив) из ответа модели, включая ответы с поясняющим текстом."""
    cleaned = _strip_code_fences(raw)
    if not cleaned:
        return None
    try:
        parsed = json.loads(cleaned)
        if expected_type is None or isinstance(parsed, expected_type):
            return parsed
    except (json.JSONDecodeError, TypeError):
        pass

    decoder = json.JSONDecoder()
    for idx, ch in enumerate(cleaned):
        if expected_type is dict and ch != "{":
            continue
        if expected_type is list and ch != "[":
            continue
        if ch in "{[":
            try:
                parsed, _end = decoder.raw_decode(cleaned[idx:])
                if expected_type is None or isinstance(parsed, expected_type):
                    return parsed
            except (json.JSONDecodeError, TypeError):
                continue
    return None


def extract_json_object(raw: str) -> dict[str, Any] | None:
    """Извлечь JSON-объект из ответа модели (пропуская префиксы вроде [1])."""
    parsed = extract_json_value(raw, expected_type=dict)
    return parsed if isinstance(parsed, dict) else None
