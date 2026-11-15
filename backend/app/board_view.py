"""Что участник видит на доске и что ему разрешено.

Сервер сам решает, какие данные отдать конкретному получателю: текст чужой
карточки до раскрытия и имя автора в анонимном режиме не уходят ни в ответе
REST, ни в WebSocket-событии. Скрывать уже отправленное на клиенте бессмысленно.
"""

from collections.abc import Awaitable, Callable
from types import SimpleNamespace

from fastapi import HTTPException
from sqlalchemy.orm import object_session

from app import models
from app.ws_manager import manager

# Чем заменяется чужой голос и чужое имя в анонимном режиме
ANON_VOTER = "anon"
ANON_AUTHOR = "Участник"


def cards_hidden(board: models.Board) -> bool:
    """Скрыты ли сейчас чужие карточки.

    В сессии ведущего карточки скрыты ровно на фазе «Штурм». Вне сессии —
    при включённом скрытом сборе, пока доску не раскрыли.
    """
    if board.active_phase == "brainstorm":
        return True
    if board.active_phase is None:
        return bool(board.hide_cards_until_reveal and not board.cards_revealed)
    return False


def is_own(card: models.Card, viewer_id: str | None) -> bool:
    return viewer_id is not None and card.author_id == viewer_id


def card_view(
    card: models.Card,
    board: models.Board,
    viewer_id: str | None,
    hidden: bool | None = None,
) -> dict:
    """Карточка в том виде, в каком её можно показать участнику `viewer_id`."""
    if hidden is None:
        hidden = cards_hidden(board)
    own = is_own(card, viewer_id)
    base = {
        "id": card.id,
        "column_id": card.column_id,
        "group_id": card.group_id,
        "position": card.position,
        "created_at": card.created_at,
    }
    if hidden and not own:
        return {
            **base,
            "text": "",
            "author": "",
            "author_id": None,
            "author_kind": "human",
            "color": "#FFFFFF",
            "likes": [],
            "masked": True,
        }
    likes = list(card.likes or [])
    author = card.author
    author_id = card.author_id
    author_kind = card.author_kind or "human"
    if board.anonymous_votes:
        likes = [voter if voter == viewer_id else ANON_VOTER for voter in likes]
        # Агент в анонимном режиме остаётся явно подписанным, чтобы команда
        # видела авторство и бейдж агента, пока человеческие карточки скрыты.
        if not own and author_kind != "agent":
            author = ANON_AUTHOR
            author_id = None
    return {
        **base,
        "text": card.text,
        "author": author,
        "author_id": author_id,
        "author_kind": author_kind,
        "color": card.color,
        "likes": likes,
        "masked": False,
    }


def mood_view(mood: models.BoardMood, board: models.Board, viewer_id: str | None) -> dict:
    own = viewer_id is not None and mood.participant_id == viewer_id
    anonymous = bool(board.anonymous_votes) and not own
    return {
        "id": mood.id,
        "board_id": mood.board_id,
        "author": ANON_AUTHOR if anonymous else mood.author,
        "participant_id": None if anonymous else mood.participant_id,
        "score": mood.score,
        "note": mood.note,
        "created_at": mood.created_at,
        "mine": own,
    }


def has_summary(board: models.Board) -> bool:
    """Есть ли у доски сохранённые итоги (клиенту незачем спрашивать их вслепую)."""
    session = object_session(board)
    if session is None:
        return False
    return (
        session.query(models.BoardSummary.id)
        .filter(models.BoardSummary.board_id == board.id)
        .first()
        is not None
    )


def board_view(
    board: models.Board, viewer_id: str | None, event_seq: int | None = None
) -> dict:
    """Доска целиком для участника: колонки, группы, карточки, настроение.

    `event_seq` — номер последнего события, прочитанный ДО загрузки доски из БД.
    Снимок вправе содержать больше, чем заявляет (повторное событие клиент применит
    безвредно), но не меньше: событие с заявленным номером клиент пропустит.
    Без аргумента берётся текущий номер — годится для ответов на собственные правки.
    """
    hidden = cards_hidden(board)
    return {
        "id": board.id,
        "name": board.name,
        "slug": board.slug,
        "max_votes": board.max_votes,
        "template": board.template,
        "is_locked": board.is_locked,
        "hide_cards_until_reveal": board.hide_cards_until_reveal,
        "anonymous_votes": board.anonymous_votes,
        "allow_multiple_votes_per_card": board.allow_multiple_votes_per_card,
        "active_facilitator": board.active_facilitator,
        "active_facilitator_id": board.active_facilitator_id,
        "active_phase": board.active_phase,
        "active_session_id": board.active_session_id,
        "created_at": board.created_at,
        "workspace_id": board.workspace_id,
        "created_by_id": board.created_by_id,
        "cards_revealed": board.cards_revealed,
        "cards_hidden": hidden,
        "has_summary": has_summary(board),
        # Номер последнего события доски на момент ответа: события с номером не
        # больше этого в снимок уже вошли, пропуск в номерах — повод перечитать доску
        "event_seq": manager.current_seq(board.id) if event_seq is None else event_seq,
        "event_epoch": manager.epoch,
        "columns": [
            {
                "id": col.id,
                "board_id": col.board_id,
                "title": col.title,
                "color": col.color,
                "position": col.position,
                "cards": [card_view(card, board, viewer_id, hidden) for card in col.cards],
                "groups": [
                    {
                        "id": group.id,
                        "column_id": group.column_id,
                        "title": group.title,
                        "position": group.position,
                    }
                    for group in col.groups
                ],
            }
            for col in board.columns
        ],
        "moods": [mood_view(mood, board, viewer_id) for mood in board.moods],
    }


def board_settings_payload(board: models.Board) -> dict:
    """Настройки доски для события board_updated (одинаковы для всех получателей)."""
    return {
        "id": board.id,
        "name": board.name,
        "slug": board.slug,
        "max_votes": board.max_votes,
        "template": board.template,
        "is_locked": board.is_locked,
        "hide_cards_until_reveal": board.hide_cards_until_reveal,
        "anonymous_votes": board.anonymous_votes,
        "allow_multiple_votes_per_card": board.allow_multiple_votes_per_card,
        "workspace_id": board.workspace_id,
        "created_by_id": board.created_by_id,
        "cards_revealed": board.cards_revealed,
        "cards_hidden": cards_hidden(board),
    }


def card_broadcast_action(
    board: models.Board,
    event: str,
    card: models.Card,
    wrap=None,
) -> Callable[[], Awaitable[None]]:
    """Снять значения карточки и доски до закрытия сессии и вернуть корутину рассылки."""
    hidden = cards_hidden(board)
    board_snap = SimpleNamespace(
        id=board.id,
        active_phase=board.active_phase,
        hide_cards_until_reveal=board.hide_cards_until_reveal,
        cards_revealed=board.cards_revealed,
        anonymous_votes=board.anonymous_votes,
    )
    card_snap = SimpleNamespace(
        id=card.id,
        column_id=card.column_id,
        group_id=card.group_id,
        position=card.position,
        created_at=card.created_at,
        text=card.text,
        author=card.author,
        author_id=card.author_id,
        author_kind=card.author_kind,
        color=card.color,
        likes=list(card.likes or []),
    )

    async def _send() -> None:
        def build(viewer_id: str | None) -> dict:
            view = card_view(card_snap, board_snap, viewer_id, hidden)
            return wrap(view) if wrap else view

        await manager.broadcast_each(board_snap.id, event, build)

    return _send


async def broadcast_card(
    board: models.Board,
    event: str,
    card: models.Card,
    wrap=None,
) -> None:
    """Разослать событие о карточке, собрав её вид отдельно для каждого получателя.

    `wrap` превращает вид карточки в данные события (для card_moved и подобных).
    """
    await card_broadcast_action(board, event, card, wrap)()


async def broadcast_mood(board: models.Board, mood: models.BoardMood) -> None:
    await manager.broadcast_each(
        board.id, "mood_updated", lambda viewer_id: mood_view(mood, board, viewer_id)
    )


# ── Права ────────────────────────────────────────────────────────────────────


def can_moderate(board: models.Board, participant_id: str) -> bool:
    """Создатель доски или ведущий активной сессии.

    У досок, созданных до появления участников, создателя нет — ими управляет
    любой участник команды, как и раньше.
    """
    return (
        board.created_by_id is None
        or board.created_by_id == participant_id
        or board.active_facilitator_id == participant_id
    )


def require_moderator(board: models.Board, participant: models.Participant, detail: str) -> None:
    if not can_moderate(board, participant.id):
        raise HTTPException(403, detail)


def can_edit_card_text(card: models.Card, participant_id: str) -> bool:
    """Текст карточки правит только автор; у старых карточек без автора — любой."""
    return card.author_id is None or card.author_id == participant_id


def can_delete_card(card: models.Card, board: models.Board, participant_id: str) -> bool:
    return (
        card.author_id is None
        or card.author_id == participant_id
        or can_moderate(board, participant_id)
    )


def require_cards_visible(board: models.Board) -> None:
    """Операции, которым нужны тексты всех карточек, до раскрытия недоступны."""
    if cards_hidden(board):
        raise HTTPException(409, "Карточки ещё скрыты: сначала раскройте их")
