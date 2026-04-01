import logging
import uuid
from fastapi import APIRouter, Depends, HTTPException, Request
from slugify import slugify
from sqlalchemy import case, func
from sqlalchemy.orm import Session, selectinload
from datetime import datetime, UTC

from app.database import get_db
from app import models, schemas
from app.utils import get_or_404
from app.limiter import limiter
from app.workspace_auth import get_current_workspace
from app.ws_manager import manager
from app.ai.prompts.summary_generation import generate_summary

logger = logging.getLogger(__name__)

router = APIRouter()

DEFAULT_COLUMNS = [
    {"title": "😊 Что хорошо", "color": "#006E1C"},
    {"title": "😟 Что улучшить", "color": "#BA1A1A"},
    {"title": "💡 Идеи", "color": "#E8760A"},
]


def _make_slug(name: str) -> str:
    return slugify(name, max_length=80, word_boundary=True) or "board"


@router.get("/", response_model=list[schemas.BoardListItem])
@limiter.limit("100/minute")
def list_boards(
    request: Request,
    db: Session = Depends(get_db),
    workspace: models.Workspace = Depends(get_current_workspace),
):
    rows = (
        db.query(
            models.Board,
            func.count(models.ActionItem.id).label("action_items_total"),
            func.count(case((models.ActionItem.status != "done", 1))).label(
                "action_items_open"
            ),
            func.max(models.BoardSummary.id).label("has_summary_id"),
        )
        .outerjoin(models.ActionItem)
        .outerjoin(models.BoardSummary)
        .filter(
            models.Board.deleted_at.is_(None),
            models.Board.workspace_id == workspace.id,
        )
        .group_by(models.Board.id)
        .order_by(models.Board.created_at.desc())
        .all()
    )
    result = []
    for board, total, open_count, has_summary_id in rows:
        item = schemas.BoardListItem.model_validate(board)
        item.action_items_total = total
        item.action_items_open = open_count
        item.has_summary = has_summary_id is not None
        result.append(item)
    return result


@router.post("/", response_model=schemas.BoardOut, status_code=201)
@limiter.limit("30/minute")
def create_board(
    request: Request,
    body: schemas.BoardCreate,
    db: Session = Depends(get_db),
    workspace: models.Workspace = Depends(get_current_workspace),
):
    existing = (
        db.query(models.Board)
        .filter(
            models.Board.name == body.name,
            models.Board.deleted_at.is_(None),
            models.Board.workspace_id == workspace.id,
        )
        .first()
    )
    if existing:
        raise HTTPException(409, "Измени название, такая доска уже есть")
    uid = str(uuid.uuid4())
    board = models.Board(
        id=uid,
        name=body.name,
        slug=_make_slug(body.name),
        max_votes=body.max_votes,
        workspace_id=workspace.id,
    )
    db.add(board)
    db.flush()
    for i, col in enumerate(DEFAULT_COLUMNS):
        db.add(
            models.Column(
                id=str(uuid.uuid4()),
                board_id=board.id,
                title=col["title"],
                color=col["color"],
                position=i,
            )
        )
    db.commit()
    db.refresh(board)
    return board


def _board_query(db: Session):
    """Board query with eager-loaded columns → cards + groups (avoids N+1)."""
    return db.query(models.Board).options(
        selectinload(models.Board.columns).selectinload(models.Column.cards),
        selectinload(models.Board.columns).selectinload(models.Column.groups),
    )


@router.get("/by-slug/{slug}", response_model=schemas.BoardOut)
@limiter.limit("100/minute")
def get_board_by_slug(
    request: Request,
    slug: str,
    db: Session = Depends(get_db),
    workspace: models.Workspace = Depends(get_current_workspace),
):
    board = (
        _board_query(db)
        .filter(
            models.Board.slug == slug,
            models.Board.deleted_at.is_(None),
            models.Board.workspace_id == workspace.id,
        )
        .first()
    )
    if not board:
        raise HTTPException(404, "Board not found")
    return board


@router.get("/{board_id}", response_model=schemas.BoardOut)
@limiter.limit("100/minute")
def get_board(
    request: Request,
    board_id: str,
    db: Session = Depends(get_db),
    workspace: models.Workspace = Depends(get_current_workspace),
):
    board = (
        _board_query(db)
        .filter(
            models.Board.id == board_id,
            models.Board.deleted_at.is_(None),
            models.Board.workspace_id == workspace.id,
        )
        .first()
    )
    if not board:
        raise HTTPException(404, "Board not found")
    return board


@router.patch("/{board_id}", response_model=schemas.BoardOut)
@limiter.limit("30/minute")
def update_board(
    request: Request,
    board_id: str,
    body: schemas.BoardUpdate,
    db: Session = Depends(get_db),
    workspace: models.Workspace = Depends(get_current_workspace),
):
    board = get_or_404(db, models.Board, board_id, "Board not found")
    if board.workspace_id != workspace.id:
        raise HTTPException(404, "Board not found")
    if body.name is not None:
        existing = (
            db.query(models.Board)
            .filter(
                models.Board.name == body.name,
                models.Board.id != board_id,
                models.Board.deleted_at.is_(None),
                models.Board.workspace_id == workspace.id,
            )
            .first()
        )
        if existing:
            raise HTTPException(409, "Измени название, такая доска уже есть")
        board.name = body.name
        board.slug = _make_slug(body.name)
    if body.max_votes is not None:
        board.max_votes = body.max_votes
    db.commit()
    db.refresh(board)
    return board


@router.delete("/{board_id}", status_code=204)
@limiter.limit("30/minute")
def delete_board(
    request: Request,
    board_id: str,
    db: Session = Depends(get_db),
    workspace: models.Workspace = Depends(get_current_workspace),
):
    board = get_or_404(db, models.Board, board_id, "Board not found")
    if board.workspace_id != workspace.id or board.deleted_at is not None:
        raise HTTPException(404, "Board not found")
    board.deleted_at = datetime.now(UTC)
    # Clear unique fields so the name/slug can be reused
    board.slug = None
    board.name = f"__deleted__{board.id}"
    db.commit()


# ── Summary Endpoints ────────────────────────────────────────────────────────


def _get_board_full_data(db: Session, board_id: str) -> dict:
    """Get full board data with columns and cards for AI processing."""
    from sqlalchemy import or_

    board = (
        db.query(models.Board)
        .options(
            selectinload(models.Board.columns).selectinload(models.Column.cards),
        )
        .filter(
            or_(
                models.Board.slug == board_id,
                models.Board.id == board_id,
            ),
            models.Board.deleted_at.is_(None),
        )
        .first()
    )

    if not board:
        return {}

    return {
        "id": board.id,
        "name": board.name,
        "columns": [
            {
                "id": col.id,
                "title": col.title,
                "position": col.position,
                "cards": [
                    {
                        "id": card.id,
                        "text": card.text,
                        "author": card.author,
                        "likes": card.likes or [],
                        "position": card.position,
                    }
                    for card in col.cards
                ],
            }
            for col in board.columns
        ],
    }


async def _generate_summary_internal(
    db: Session,
    board_id: str,
    username: str,
) -> dict | None:
    """Internal function to generate and save summary.

    Returns summary data dict or None if generation failed.
    """
    logger.info("Starting summary generation for board %s", board_id)

    if manager.get_facilitator(board_id) != username:
        logger.warning("User %s is not facilitator of board %s", username, board_id)
        return None

    session_id = manager.get_session_id(board_id)
    if not session_id:
        session_id = int(datetime.now(UTC).timestamp())
        manager.set_session_id(board_id, session_id)
        logger.info("Created new session ID: %s", session_id)

    existing = (
        db.query(models.BoardSummary)
        .filter(
            models.BoardSummary.board_id == board_id,
            models.BoardSummary.session_id == session_id,
        )
        .first()
    )

    if existing:
        logger.info(
            "Summary already exists for board %s, session %s", board_id, session_id
        )
        return schemas.BoardSummaryOut.model_validate(existing).model_dump(mode="json")

    board_data = _get_board_full_data(db, board_id)
    if not board_data:
        logger.warning("No board data for %s", board_id)
        return None

    try:
        ai_result = generate_summary(board_data)
        logger.info("AI summary generated for board %s", board_id)
    except Exception as e:
        logger.error("AI summary generation failed for board %s: %s", board_id, e)
        return None

    summary = models.BoardSummary(
        id=str(uuid.uuid4()),
        board_id=board_id,
        session_id=session_id,
        summary_text=ai_result.get("summary_text", ""),
        key_themes=ai_result.get("key_themes", []),
        recommendations=ai_result.get("recommendations", []),
    )
    db.add(summary)
    db.commit()
    db.refresh(summary)
    logger.info("Summary saved to DB for board %s", board_id)

    return schemas.BoardSummaryOut.model_validate(summary).model_dump(mode="json")


@router.get("/{board_id}/summary", response_model=schemas.BoardSummaryOut)
@limiter.limit("30/minute")
async def get_summary(
    request: Request,
    board_id: str,
    db: Session = Depends(get_db),
    workspace: models.Workspace = Depends(get_current_workspace),
):
    """Get the latest summary for a board.

    Returns the most recent summary for the current or last session.
    """
    board = get_or_404(db, models.Board, board_id, "Board not found")
    if board.workspace_id != workspace.id:
        raise HTTPException(404, "Board not found")

    # Get current session_id if active
    session_id = manager.get_session_id(board_id)

    query = db.query(models.BoardSummary).filter(
        models.BoardSummary.board_id == board_id
    )

    if session_id:
        # Prefer current session
        summary = (
            query.filter(models.BoardSummary.session_id == session_id)
            .order_by(models.BoardSummary.created_at.desc())
            .first()
        )
        if summary:
            return summary

    # Fall back to latest summary
    summary = query.order_by(models.BoardSummary.created_at.desc()).first()

    if not summary:
        raise HTTPException(404, "Summary not found")

    return summary


# NOTE: POST /{board_id}/summary/generate removed
# Generation happens automatically when facilitator transitions to 'summary' phase
# via WebSocket phase_change event. Manual generation via HTTP is not supported.
#
# Security: The facilitator check is done in websocket.py when handling
# phase_change event - only the actual facilitator can trigger the phase change.
# Full user_id based authorization requires adding User model to the system.
