import asyncio
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import and_, case, func
from sqlalchemy.orm import Session

from app.board_view import ANON_AUTHOR, require_cards_visible
from app.database import get_db, release_connection
from app import models, schemas
from app.services import action_items as action_items_service
from app.services.action_items import copy_unresolved_action_items
from app.utils import get_or_404, require_live_board
from app.ai import ai_client
from app.ai.prompts.title_generation import (
    TITLE_GENERATION_CONFIG,
    build_title_prompt,
    clean_generated_title,
)
from app.ws_manager import manager
from app.limiter import TEAM_READ_LIMIT, TEAM_WRITE_LIMIT, limiter
from app.workspace_auth import get_current_workspace

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/trends", response_model=list[schemas.TrendPoint])
@limiter.limit(TEAM_READ_LIMIT)
def get_trends(
    request: Request,
    db: Session = Depends(get_db),
    workspace: models.Workspace = Depends(get_current_workspace),
):
    """Action item counts (open/in_progress/done) per board, sorted by board date."""
    rows = (
        db.query(
            models.Board.id,
            models.Board.name,
            models.Board.created_at,
            func.count(case((models.ActionItem.status == "open", 1))).label("open"),
            func.count(case((models.ActionItem.status == "in_progress", 1))).label(
                "in_progress"
            ),
            func.count(case((models.ActionItem.status == "done", 1))).label("done"),
            func.count(models.ActionItem.id).label("total"),
        )
        .outerjoin(
            models.ActionItem,
            and_(
                models.Board.id == models.ActionItem.board_id,
                # Перенесённая задача считается на доске, куда её перенесли
                models.ActionItem.superseded_by_id.is_(None),
            ),
        )
        .filter(
            models.Board.deleted_at.is_(None),
            models.Board.workspace_id == workspace.id,
        )
        .group_by(models.Board.id, models.Board.name, models.Board.created_at)
        .order_by(models.Board.created_at)
        .all()
    )
    return [
        schemas.TrendPoint(
            board_id=r.id,
            board_name=r.name,
            created_at=r.created_at,
            open=r.open,
            in_progress=r.in_progress,
            done=r.done,
            total=r.total,
        )
        for r in rows
    ]


@router.get("/all", response_model=list[schemas.DashboardActionItem])
@limiter.limit(TEAM_READ_LIMIT)
def list_all_action_items(
    request: Request,
    status: Optional[str] = None,
    board_id: Optional[str] = None,
    assignee: Optional[str] = None,
    include_carried: bool = False,
    db: Session = Depends(get_db),
    workspace: models.Workspace = Depends(get_current_workspace),
):
    """List action items across all boards with optional filters."""
    items, _total = action_items_service.list_workspace_action_items(
        db,
        workspace.id,
        status=status,
        board_id_or_slug=board_id,
        assignee=assignee,
        include_carried=include_carried,
        lookup="id",
    )
    return items


@router.post(
    "/carry-forward", response_model=list[schemas.ActionItemOut], status_code=201
)
@limiter.limit("10/minute")
async def carry_forward(
    request: Request,
    body: schemas.CarryForwardRequest,
    db: Session = Depends(get_db),
    workspace: models.Workspace = Depends(get_current_workspace),
):
    """Copy unresolved action items from source board to target board."""
    src_board = get_or_404(
        db, models.Board, body.source_board_id, "Исходная доска не найдена"
    )
    require_live_board(src_board, workspace.id, "Исходная доска не найдена")
    tgt_board = get_or_404(
        db, models.Board, body.target_board_id, "Целевая доска не найдена"
    )
    require_live_board(tgt_board, workspace.id, "Целевая доска не найдена")

    if body.source_board_id == body.target_board_id:
        raise HTTPException(400, "Исходная и целевая доски совпадают")

    created, carried = copy_unresolved_action_items(
        db, body.source_board_id, body.target_board_id, body.item_ids
    )
    db.commit()

    for out in created:
        await manager.broadcast(
            body.target_board_id, "action_item_created", out.model_dump(mode="json")
        )
    for out in carried:
        await manager.broadcast(
            body.source_board_id, "action_item_updated", out.model_dump(mode="json")
        )

    return created


@router.get("/", response_model=list[schemas.ActionItemOut])
@limiter.limit(TEAM_READ_LIMIT)
def list_action_items(
    request: Request,
    board_id: str,
    db: Session = Depends(get_db),
    workspace: models.Workspace = Depends(get_current_workspace),
):
    board = get_or_404(db, models.Board, board_id, "Доска не найдена")
    require_live_board(board, workspace.id)
    items = (
        db.query(models.ActionItem)
        .filter(models.ActionItem.board_id == board_id)
        .order_by(models.ActionItem.created_at)
        .all()
    )
    return [schemas.ActionItemOut.model_validate(i) for i in items]


@router.post("/generate-title", response_model=schemas.GenerateTitleResponse)
@limiter.limit("30/minute")
async def generate_action_item_title(
    request: Request,
    body: schemas.GenerateTitleRequest,
    db: Session = Depends(get_db),
    workspace: models.Workspace = Depends(get_current_workspace),
):
    """Generate action item title from card text using AI."""
    # Проверка токена уже открыла сессию — на время вызова модели она не нужна
    release_connection(db)
    prompt = build_title_prompt(body.text)
    try:
        title = await asyncio.to_thread(
            ai_client.generate, prompt, TITLE_GENERATION_CONFIG
        )
        # Ответ модели — недоверенный ввод; пустой после очистки заменяем текстом
        return schemas.GenerateTitleResponse(
            title=clean_generated_title(title) or body.text[:50]
        )
    except Exception:
        logger.exception("Action item title generation failed")
        return schemas.GenerateTitleResponse(title=body.text[:50])


@router.post("/suggest", response_model=schemas.ActionItemSuggestResponse)
@limiter.limit("10/minute")
async def suggest_action_items(
    request: Request,
    body: schemas.ActionItemSuggestRequest,
    db: Session = Depends(get_db),
    workspace: models.Workspace = Depends(get_current_workspace),
):
    """Suggest concrete action items from board cards using AI."""
    from app.ai.prompts.action_item_suggestions import suggest_action_items_from_cards
    from app.config import settings

    board = get_or_404(db, models.Board, body.board_id, "Доска не найдена")
    require_live_board(board, workspace.id)
    if not settings.ai_configured:
        raise HTTPException(503, "AI сервис не настроен")
    # Подбор задач читает тексты всех карточек — до раскрытия он выдал бы скрытое
    require_cards_visible(board)

    rows = (
        db.query(models.Card, models.Column.title)
        .join(models.Column, models.Card.column_id == models.Column.id)
        .filter(models.Column.board_id == board.id)
        .all()
    )
    if not rows:
        return schemas.ActionItemSuggestResponse(board_id=board.id, suggestions=[])

    cards_snapshot = [
        {
            "id": card.id,
            "column": col_title,
            "text": card.text,
            "author": ANON_AUTHOR if (board.anonymous_votes and card.author_kind != "agent") else card.author,
            "likes_count": len(card.likes or []),
        }
        for card, col_title in rows
    ]
    board_pk = board.id
    release_connection(db)
    try:
        raw_suggestions = await asyncio.to_thread(suggest_action_items_from_cards, cards_snapshot)
    except RuntimeError as exc:
        logger.warning("AI action item suggestion failed: %s", exc)
        raise HTTPException(503, "Не удалось получить предложения от AI") from exc

    return schemas.ActionItemSuggestResponse(
        board_id=board_pk,
        suggestions=[schemas.ActionItemSuggestion(**item) for item in raw_suggestions],
    )


@router.post("/", response_model=schemas.ActionItemOut, status_code=201)
@limiter.limit(TEAM_WRITE_LIMIT)
async def create_action_item(
    request: Request,
    body: schemas.ActionItemCreate,
    db: Session = Depends(get_db),
    workspace: models.Workspace = Depends(get_current_workspace),
):
    return await action_items_service.create_action_item_for_workspace(
        db,
        workspace.id,
        board_id_or_slug=body.board_id,
        title=body.title,
        text=body.text,
        assignee=body.assignee,
        external_url=body.external_url,
        source_card_ids=body.source_card_ids,
        status=body.status,
        require_unlocked=False,
    )


@router.patch("/{item_id}", response_model=schemas.ActionItemOut)
@limiter.limit(TEAM_WRITE_LIMIT)
async def update_action_item(
    request: Request,
    item_id: str,
    body: schemas.ActionItemUpdate,
    db: Session = Depends(get_db),
    workspace: models.Workspace = Depends(get_current_workspace),
):
    return await action_items_service.update_action_item_for_workspace(
        db,
        workspace.id,
        item_id=item_id,
        provided_fields=body.model_fields_set,
        title=body.title,
        text=body.text,
        assignee=body.assignee,
        external_url=body.external_url,
        status=body.status,
        restrict_locked_fields=False,
    )


@router.delete("/{item_id}", status_code=204)
@limiter.limit(TEAM_WRITE_LIMIT)
async def delete_action_item(
    request: Request,
    item_id: str,
    db: Session = Depends(get_db),
    workspace: models.Workspace = Depends(get_current_workspace),
):
    item = get_or_404(db, models.ActionItem, item_id, "Задача не найдена")
    require_live_board(
        db.get(models.Board, item.board_id), workspace.id, "Задача не найдена"
    )
    board_id = item.board_id
    db.delete(item)
    db.commit()
    await manager.broadcast(
        board_id, "action_item_deleted", {"id": item_id, "board_id": board_id}
    )
