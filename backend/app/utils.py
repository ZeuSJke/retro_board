from fastapi import HTTPException
from sqlalchemy.orm import Session


def get_or_404(db: Session, model, entity_id: str, detail: str = "Не найдено"):
    """Get entity by ID or raise 404."""
    obj = db.get(model, entity_id)
    if not obj:
        raise HTTPException(404, detail)
    return obj


def require_live_board(board, workspace_id: str, detail: str = "Доска не найдена"):
    """Ensure the board exists, belongs to the workspace and is not soft-deleted.

    Raises 404 otherwise. Returns the board for convenient inline use.
    """
    if (
        board is None
        or board.workspace_id != workspace_id
        or board.deleted_at is not None
    ):
        raise HTTPException(404, detail)
    return board


def require_unlocked_board(board, workspace_id: str, detail: str = "Доска не найдена"):
    """Ensure the board is live in the workspace and not locked for edits."""
    live = require_live_board(board, workspace_id, detail)
    if live.is_locked:
        raise HTTPException(423, "Доска заблокирована для изменений")
    return live
