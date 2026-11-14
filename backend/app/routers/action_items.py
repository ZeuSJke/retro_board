import asyncio
import logging
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import and_, case, func
from sqlalchemy.orm import Session

from app.board_view import ANON_AUTHOR, require_cards_visible
from app.database import get_db, release_connection
from app import models, schemas
from app.models import now_utc
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
    q = (
        db.query(models.ActionItem, models.Board.name)
        .join(models.Board, models.ActionItem.board_id == models.Board.id)
        .filter(
            models.Board.deleted_at.is_(None),
            models.Board.workspace_id == workspace.id,
        )
    )
    if not include_carried:
        # Задача, перенесённая на другую доску, представлена там своей копией
        q = q.filter(models.ActionItem.superseded_by_id.is_(None))
    if status:
        q = q.filter(models.ActionItem.status == status)
    if board_id:
        q = q.filter(models.ActionItem.board_id == board_id)
    if assignee:
        q = q.filter(models.ActionItem.assignee == assignee)
    q = q.order_by(models.ActionItem.created_at.desc())
    results = q.all()
    return [
        schemas.DashboardActionItem(
            **schemas.ActionItemOut.model_validate(item).model_dump(),
            board_name=board_name,
        )
        for item, board_name in results
    ]


def copy_unresolved_action_items(
    db: Session,
    source_board_id: str,
    target_board_id: str,
    item_ids: list[str] | None = None,
) -> tuple[list[schemas.ActionItemOut], list[schemas.ActionItemOut]]:
    """Перенести нерешённые задачи со старой доски на целевую (без commit).

    На целевой доске появляется копия, а оригинал помечается перенесённым
    (`superseded_by_id`): он остаётся в истории своей доски, но больше не
    считается открытым — иначе одна задача считалась бы дважды. Уже
    перенесённые задачи повторно не переносятся.

    Возвращает (созданные копии, помеченные оригиналы).
    """
    query = db.query(models.ActionItem).filter(
        models.ActionItem.board_id == source_board_id,
        models.ActionItem.status != "done",
        models.ActionItem.superseded_by_id.is_(None),
    )
    if item_ids is not None:
        query = query.filter(models.ActionItem.id.in_(item_ids))
    items = query.order_by(models.ActionItem.created_at).all()
    created: list[schemas.ActionItemOut] = []
    carried: list[schemas.ActionItemOut] = []
    for src in items:
        new_item = models.ActionItem(
            id=str(uuid.uuid4()),
            board_id=target_board_id,
            title=src.title,
            text=src.text,
            assignee=src.assignee,
            source_card_ids=list(src.source_card_ids or []),
            status=src.status,
        )
        db.add(new_item)
        db.flush()
        src.superseded_by_id = new_item.id
        db.flush()
        db.refresh(new_item)
        db.refresh(src)
        created.append(schemas.ActionItemOut.model_validate(new_item))
        carried.append(schemas.ActionItemOut.model_validate(src))
    return created, carried


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
        db, models.Board, body.source_board_id, "Source board not found"
    )
    require_live_board(src_board, workspace.id, "Source board not found")
    tgt_board = get_or_404(
        db, models.Board, body.target_board_id, "Target board not found"
    )
    require_live_board(tgt_board, workspace.id, "Target board not found")

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
    board = get_or_404(db, models.Board, board_id, "Board not found")
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

    board = get_or_404(db, models.Board, body.board_id, "Board not found")
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
            "author": ANON_AUTHOR if board.anonymous_votes else card.author,
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
    board = get_or_404(db, models.Board, body.board_id, "Board not found")
    require_live_board(board, workspace.id)
    if body.source_card_ids:
        valid_cards = (
            db.query(models.Card.id)
            .join(models.Column, models.Card.column_id == models.Column.id)
            .filter(
                models.Column.board_id == body.board_id,
                models.Card.id.in_(body.source_card_ids),
            )
            .all()
        )
        valid_ids = {row[0] for row in valid_cards}
        invalid_ids = set(body.source_card_ids) - valid_ids
        if invalid_ids:
            raise HTTPException(
                400,
                f"Некорректные source_card_ids: {', '.join(sorted(invalid_ids))}",
            )
    item = models.ActionItem(
        id=str(uuid.uuid4()),
        board_id=body.board_id,
        title=body.title,
        text=body.text,
        assignee=body.assignee,
        source_card_ids=body.source_card_ids,
        status=body.status,
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    out = schemas.ActionItemOut.model_validate(item)
    await manager.broadcast(
        body.board_id, "action_item_created", out.model_dump(mode="json")
    )
    return out


@router.patch("/{item_id}", response_model=schemas.ActionItemOut)
@limiter.limit(TEAM_WRITE_LIMIT)
async def update_action_item(
    request: Request,
    item_id: str,
    body: schemas.ActionItemUpdate,
    db: Session = Depends(get_db),
    workspace: models.Workspace = Depends(get_current_workspace),
):
    item = get_or_404(db, models.ActionItem, item_id, "Action item not found")
    require_live_board(
        db.get(models.Board, item.board_id), workspace.id, "Action item not found"
    )
    if body.title is not None:
        item.title = body.title
    if body.text is not None:
        item.text = body.text
    if "assignee" in body.model_fields_set:
        item.assignee = body.assignee
    if "status" in body.model_fields_set and body.status is not None:
        item.status = body.status
        if body.status == "done":
            item.completed_at = now_utc()
        else:
            item.completed_at = None
    db.commit()
    db.refresh(item)
    out = schemas.ActionItemOut.model_validate(item)
    await manager.broadcast(
        item.board_id, "action_item_updated", out.model_dump(mode="json")
    )
    return out


@router.delete("/{item_id}", status_code=204)
@limiter.limit(TEAM_WRITE_LIMIT)
async def delete_action_item(
    request: Request,
    item_id: str,
    db: Session = Depends(get_db),
    workspace: models.Workspace = Depends(get_current_workspace),
):
    item = get_or_404(db, models.ActionItem, item_id, "Action item not found")
    require_live_board(
        db.get(models.Board, item.board_id), workspace.id, "Action item not found"
    )
    board_id = item.board_id
    db.delete(item)
    db.commit()
    await manager.broadcast(
        board_id, "action_item_deleted", {"id": item_id, "board_id": board_id}
    )
