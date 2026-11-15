"""Общие вспомогательные выборки для домена и MCP."""

from collections.abc import Awaitable, Callable, Sequence
from typing import Literal

from sqlalchemy import case, or_
from sqlalchemy.orm import Query, Session

from app import models
from app.utils import require_live_board, require_unlocked_board

BroadcastAction = Callable[[], Awaitable[None]]
BoardLookupMode = Literal["id", "slug", "id_or_slug"]

_LOOKUP_PREDICATES: dict[BoardLookupMode, Callable[[str], object]] = {
    "id": lambda value: models.Board.id == value,
    "slug": lambda value: models.Board.slug == value,
    "id_or_slug": lambda value: or_(
        models.Board.id == value,
        models.Board.slug == value,
    ),
}


def apply_board_lookup(
    query: Query,
    board_id_or_slug: str,
    workspace_id: str,
    lookup: BoardLookupMode = "id_or_slug",
) -> Query:
    """Отфильтровать живую доску команды по ID, slug или обоим полям (ID приоритетнее)."""
    predicate = _LOOKUP_PREDICATES.get(lookup)
    if predicate is None:
        raise ValueError(f"Unsupported board lookup mode: {lookup}")
    filtered = query.filter(
        predicate(board_id_or_slug),
        models.Board.deleted_at.is_(None),
        models.Board.workspace_id == workspace_id,
    )
    if lookup == "id_or_slug":
        filtered = filtered.order_by(case((models.Board.id == board_id_or_slug, 0), else_=1))
    return filtered


async def dispatch_broadcasts(actions: Sequence[BroadcastAction]) -> None:
    """Выполнить отложенные WebSocket-рассылки после закрытия транзакции БД."""
    for action in actions:
        await action()


def find_live_board(
    db: Session,
    board_id_or_slug: str,
    workspace_id: str,
    *,
    lookup: BoardLookupMode = "id_or_slug",
    options: Sequence = (),
    require_unlocked: bool = False,
    detail: str = "Доска не найдена",
) -> models.Board:
    """Найти живую доску команды по ID или slug (опционально проверить блокировку)."""
    query = db.query(models.Board)
    if options:
        query = query.options(*options)
    board = apply_board_lookup(
        query, board_id_or_slug, workspace_id, lookup=lookup
    ).first()
    if require_unlocked:
        return require_unlocked_board(board, workspace_id, detail)
    return require_live_board(board, workspace_id, detail)
