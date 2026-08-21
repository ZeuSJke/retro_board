"""Промпт и логика для AI-кластеризации карточек."""

import json
import re

from app.ai.ai_client import AIModelConfig, ai_client

MAX_CARDS_FOR_CLUSTERING = 100

CLUSTERING_PROMPT = """You are a clustering assistant. Group the following retrospective cards by semantic similarity.

Cards:
{cards_data}

Rules:
- Each group MUST have at least 2 cards. Never create a group with only 1 card.
- A card can only be in one group
- Give each group a short title (up to 60 chars) in the same language as the cards
- Put unrelated cards in "ungrouped"
- CRITICAL: use the EXACT card IDs from the input, copy them character by character

Return ONLY valid JSON, no markdown, no explanations:
{{"groups": [{{"title": "Group name", "card_ids": ["exact-id-1", "exact-id-2"]}}], "ungrouped": ["exact-id-3"]}}"""

CLUSTERING_CONFIG = AIModelConfig(
    temperature=0.1,
    max_tokens=2000,
    timeout=90,
    retries=2,
)


def parse_clustering_response(
    response: str, valid_card_ids: set[str]
) -> dict:
    """Парсит ответ AI, валидирует card_ids, фильтрует группы < 2 карточек.

    Returns:
        {"groups": [{"title": str, "card_ids": [str, ...]}, ...], "ungrouped": [str, ...]}
    """
    empty_result = {"groups": [], "ungrouped": list(valid_card_ids)}

    # Strip markdown code fences
    cleaned = response.strip()
    cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned)
    cleaned = re.sub(r"\s*```$", "", cleaned)
    cleaned = cleaned.strip()

    try:
        data = json.loads(cleaned)
    except (json.JSONDecodeError, TypeError):
        return empty_result

    if not isinstance(data, dict):
        return empty_result

    raw_groups = data.get("groups", [])
    if not isinstance(raw_groups, list):
        return empty_result

    # Track assigned cards to remove duplicates
    assigned: set[str] = set()
    groups: list[dict] = []

    for g in raw_groups:
        if not isinstance(g, dict):
            continue
        title = str(g.get("title", "Группа"))[:120]
        # Strip HTML tags from AI-generated title
        title = re.sub(r"<[^>]+>", "", title).strip() or "Группа"
        card_ids = g.get("card_ids", [])
        if not isinstance(card_ids, list):
            continue

        # Filter: only valid, not-yet-assigned IDs
        filtered_ids = []
        for cid in card_ids:
            cid = str(cid)
            if cid in valid_card_ids and cid not in assigned:
                filtered_ids.append(cid)
                assigned.add(cid)

        if len(filtered_ids) >= 2:
            groups.append({"title": title, "card_ids": filtered_ids})
        else:
            # Cards from too-small groups go to ungrouped
            assigned -= set(filtered_ids)

    # All unassigned valid cards are ungrouped
    ungrouped = [cid for cid in valid_card_ids if cid not in assigned]

    return {"groups": groups, "ungrouped": ungrouped}


def _sanitize_card_text(text: str) -> str:
    """Sanitize card text before inserting into AI prompt."""
    text = text[:200]
    # Remove characters that could interfere with prompt structure
    text = text.replace('"', "'").replace("\\", "")
    # Strip control characters
    text = re.sub(r"[\x00-\x1f\x7f]", " ", text)
    return text.strip()


def cluster_cards(cards: list[dict]) -> dict:
    """Кластеризует карточки через AI.

    Args:
        cards: список {"id": str, "text": str}

    Returns:
        {"groups": [{"title": str, "card_ids": [str]}, ...], "ungrouped": [str, ...]}
    """
    valid_card_ids = {c["id"] for c in cards}

    # Format cards for prompt, sanitize and truncate text
    lines = []
    for c in cards:
        text = _sanitize_card_text(c["text"])
        lines.append(f"- id: {c['id']}, текст: \"{text}\"")
    cards_data = "\n".join(lines)

    prompt = CLUSTERING_PROMPT.format(cards_data=cards_data)
    response = ai_client.generate(prompt, CLUSTERING_CONFIG)

    return parse_clustering_response(response, valid_card_ids)
