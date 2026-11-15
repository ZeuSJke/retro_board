"""Общие вспомогательные выборки для домена и MCP."""

from collections.abc import Awaitable, Callable, Sequence

from sqlalchemy import or_
from sqlalchemy.orm import Session

from app import models
from app.utils import require_live_board, require_unlocked_board

BroadcastAction = Callable[[], Awaitable[None]]


async def dispatch_broadcasts(actions: Sequence[BroadcastAction]) -> None:
    """Выполнить отложенные WebSocket-рассылки после закрытия транзакции БД."""
    for action in actions:
        await action()


def find_live_board(
    db: Session,
    board_id_or_slug: str,
    workspace_id: str,
    *,
    options: Sequence = (),
    require_unlocked: bool = False,
    detail: str = "Доска не найдена",
) -> models.Board:
    """Найти живую доску команды по ID или slug (опционально проверить блокировку)."""
    query = db.query(models.Board)
    if options:
        query = query.options(*options)
    board = (
        query.filter(
            or_(
                models.Board.id == board_id_or_slug,
                models.Board.slug == board_id_or_slug,
            ),
            models.Board.deleted_at.is_(None),
            models.Board.workspace_id == workspace_id,
        )
        .first()
    )
    if require_unlocked:
        return require_unlocked_board(board, workspace_id, detail)
    return require_live_board(board, workspace_id, detail)
