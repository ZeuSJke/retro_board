import asyncio
import logging
import uuid
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.config import settings
from app.board_view import broadcast_card, card_view, require_cards_visible
from app.database import get_db, release_connection
from app import models, schemas
from app.utils import get_or_404, require_unlocked_board
from app.ws_manager import manager
from app.limiter import TEAM_WRITE_LIMIT, limiter
from app.workspace_auth import get_current_participant, get_current_workspace
from app.ai.clustering import cluster_cards, MAX_CARDS_FOR_CLUSTERING

logger = logging.getLogger(__name__)

router = APIRouter()


@router.post("/", response_model=schemas.CardGroupOut, status_code=201)
@limiter.limit(TEAM_WRITE_LIMIT)
async def create_group(
    request: Request,
    body: schemas.CardGroupCreate,
    db: Session = Depends(get_db),
    workspace: models.Workspace = Depends(get_current_workspace),
):
    col = get_or_404(db, models.Column, body.column_id, "Column not found")
    require_unlocked_board(db.get(models.Board, col.board_id), workspace.id, "Column not found")
    max_pos = (
        db.query(func.max(models.CardGroup.position))
        .filter(models.CardGroup.column_id == body.column_id)
        .scalar()
    )
    group = models.CardGroup(
        id=str(uuid.uuid4()),
        column_id=body.column_id,
        title=body.title,
        # После последней, а не по количеству: счёт по количеству давал дубли после удалений
        position=(max_pos if max_pos is not None else -1) + 1,
    )
    db.add(group)
    db.commit()
    db.refresh(group)
    out = schemas.CardGroupOut.model_validate(group)
    await manager.broadcast(col.board_id, "group_created", out.model_dump(mode="json"))
    return out


@router.patch("/{group_id}", response_model=schemas.CardGroupOut)
@limiter.limit(TEAM_WRITE_LIMIT)
async def update_group(
    request: Request,
    group_id: str,
    body: schemas.CardGroupUpdate,
    db: Session = Depends(get_db),
    workspace: models.Workspace = Depends(get_current_workspace),
):
    group = get_or_404(db, models.CardGroup, group_id, "Group not found")
    col = db.get(models.Column, group.column_id)
    require_unlocked_board(db.get(models.Board, col.board_id), workspace.id, "Group not found")
    if body.title is not None:
        group.title = body.title
    db.commit()
    db.refresh(group)
    out = schemas.CardGroupOut.model_validate(group)
    await manager.broadcast(col.board_id, "group_updated", out.model_dump(mode="json"))
    return out


@router.delete("/{group_id}", status_code=204)
@limiter.limit(TEAM_WRITE_LIMIT)
async def delete_group(
    request: Request,
    group_id: str,
    db: Session = Depends(get_db),
    workspace: models.Workspace = Depends(get_current_workspace),
):
    group = get_or_404(db, models.CardGroup, group_id, "Group not found")
    col = db.get(models.Column, group.column_id)
    require_unlocked_board(db.get(models.Board, col.board_id), workspace.id, "Group not found")
    board_id = col.board_id
    col_id = group.column_id  # capture before deletion

    # Ungroup all cards in this group
    card_ids = []
    for card in db.query(models.Card).filter(models.Card.group_id == group_id).all():
        card.group_id = None
        card_ids.append(card.id)

    db.delete(group)
    db.commit()
    await manager.broadcast(
        board_id,
        "group_deleted",
        {"id": group_id, "column_id": col_id, "card_ids": card_ids},
    )


@router.post("/{group_id}/set_card/{card_id}", response_model=schemas.CardOut)
@limiter.limit(TEAM_WRITE_LIMIT)
async def set_card_group(
    request: Request,
    group_id: str,
    card_id: str,
    db: Session = Depends(get_db),
    workspace: models.Workspace = Depends(get_current_workspace),
    participant: models.Participant = Depends(get_current_participant),
):
    """Add a card to a group."""
    group = get_or_404(db, models.CardGroup, group_id, "Group not found")
    col = db.get(models.Column, group.column_id)
    board = require_unlocked_board(
        db.get(models.Board, col.board_id), workspace.id, "Group not found"
    )
    card = get_or_404(db, models.Card, card_id, "Card not found")
    if card.column_id != group.column_id:
        raise HTTPException(400, "Card and group must be in the same column")
    card.group_id = group_id
    db.commit()
    db.refresh(card)
    await broadcast_card(board, "card_updated", card)
    return card_view(card, board, participant.id)


@router.patch("/{group_id}/move", response_model=schemas.CardGroupOut)
@limiter.limit(TEAM_WRITE_LIMIT)
async def move_group(
    request: Request,
    group_id: str,
    body: schemas.GroupMove,
    db: Session = Depends(get_db),
    workspace: models.Workspace = Depends(get_current_workspace),
):
    """Move a group (and all its cards) to a different column."""
    group = get_or_404(db, models.CardGroup, group_id, "Group not found")
    col = db.get(models.Column, group.column_id)
    board = require_unlocked_board(
        db.get(models.Board, col.board_id), workspace.id, "Group not found"
    )
    old_col = db.get(models.Column, group.column_id)
    new_col = get_or_404(db, models.Column, body.column_id, "Column not found")
    if old_col.board_id != new_col.board_id:
        raise HTTPException(400, "Columns must be on the same board")

    old_column_id = group.column_id
    group.column_id = body.column_id

    cards = db.query(models.Card).filter(models.Card.group_id == group_id).all()
    for card in cards:
        card.column_id = body.column_id
    db.commit()
    db.refresh(group)

    group_out = schemas.CardGroupOut.model_validate(group)
    group_data = group_out.model_dump(mode="json")
    await manager.broadcast_each(
        old_col.board_id,
        "group_moved",
        lambda viewer_id: {
            "group": group_data,
            "old_column_id": old_column_id,
            "cards": [card_view(c, board, viewer_id) for c in cards],
        },
    )
    return group_out


@router.delete("/{group_id}/remove_card/{card_id}", response_model=schemas.CardOut)
@limiter.limit(TEAM_WRITE_LIMIT)
async def remove_card_from_group(
    request: Request,
    group_id: str,
    card_id: str,
    db: Session = Depends(get_db),
    workspace: models.Workspace = Depends(get_current_workspace),
    participant: models.Participant = Depends(get_current_participant),
):
    """Remove a card from its group. Auto-deletes the group if it becomes empty."""
    card = get_or_404(db, models.Card, card_id, "Card not found")
    col = db.get(models.Column, card.column_id)
    board = require_unlocked_board(
        db.get(models.Board, col.board_id), workspace.id, "Card not found"
    )
    if card.group_id != group_id:
        raise HTTPException(400, "Card is not in this group")
    card.group_id = None
    db.commit()
    db.refresh(card)
    await broadcast_card(board, "card_updated", card)

    # Auto-delete group if now empty
    remaining = db.query(models.Card).filter(models.Card.group_id == group_id).count()
    if remaining == 0:
        group = db.get(models.CardGroup, group_id)
        if group:
            col_id = group.column_id
            db.delete(group)
            db.commit()
            await manager.broadcast(col.board_id, "group_deleted", {"id": group_id, "column_id": col_id, "card_ids": []})

    return card_view(card, board, participant.id)


def _unlocked_column(
    db: Session, column_id: str, workspace_id: str
) -> tuple[models.Column, models.Board]:
    col = get_or_404(db, models.Column, column_id, "Колонка не найдена")
    board = require_unlocked_board(
        db.get(models.Board, col.board_id), workspace_id, "Колонка не найдена"
    )
    return col, board


async def _compute_column_clusters(
    column_id: str,
    db: Session,
    workspace_id: str,
) -> dict:
    """Validate column, check AI config, and compute clustering suggestions without persisting.

    Соединение с БД на время вызова модели возвращается в пул: объекты сессии
    после этого отсоединены, поэтому вызывающий код перечитывает колонку сам.
    """
    if not settings.ai_configured:
        raise HTTPException(503, "AI-сервис не настроен")

    _col, board = _unlocked_column(db, column_id, workspace_id)
    # Группировка читает тексты всех карточек колонки — до раскрытия она выдала бы скрытое
    require_cards_visible(board)

    ungrouped_cards = (
        db.query(models.Card)
        .filter(
            models.Card.column_id == column_id,
            models.Card.group_id.is_(None),
        )
        .all()
    )

    if len(ungrouped_cards) < 2:
        raise HTTPException(400, "Недостаточно негруппированных карточек (минимум 2)")

    if len(ungrouped_cards) > MAX_CARDS_FOR_CLUSTERING:
        raise HTTPException(
            400,
            f"Слишком много карточек ({len(ungrouped_cards)}). "
            f"Максимум {MAX_CARDS_FOR_CLUSTERING} для автоматической кластеризации.",
        )

    cards_data = [{"id": c.id, "text": c.text} for c in ungrouped_cards]
    release_connection(db)
    try:
        result = await asyncio.to_thread(cluster_cards, cards_data)
    except Exception as e:
        logger.error("AI clustering failed for column %s: %s", column_id, type(e).__name__)
        raise HTTPException(503, "AI-сервис временно недоступен") from e
    return result


async def _apply_groups_to_column(
    col: models.Column,
    board: models.Board,
    groups_spec: list[dict],
    ungrouped_ids: list[str],
    username: str | None,
    db: Session,
) -> schemas.AutoClusterResult:
    """Persist proposed cluster groups into DB and broadcast WS updates."""
    created_groups: list[schemas.ClusterGroupInfo] = []
    board_id = col.board_id
    assigned_ids: set[str] = set()

    max_group_pos = (
        db.query(func.max(models.CardGroup.position))
        .filter(models.CardGroup.column_id == col.id)
        .scalar()
    )
    group_pos = (max_group_pos if max_group_pos is not None else -1) + 1

    for g in groups_spec:
        candidate_cards = [
            card
            for cid in g["card_ids"]
            if cid not in assigned_ids
            and (card := db.get(models.Card, cid)) is not None
            and card.column_id == col.id
            and card.group_id is None
        ]
        if len(candidate_cards) < 2:
            continue

        group = models.CardGroup(
            id=str(uuid.uuid4()),
            column_id=col.id,
            title=g["title"].strip() or "Группа",
            position=group_pos,
        )
        db.add(group)
        db.flush()
        group_pos += 1

        valid_card_ids: list[str] = []
        for card in candidate_cards:
            card.group_id = group.id
            assigned_ids.add(card.id)
            valid_card_ids.append(card.id)

        group_out = schemas.CardGroupOut.model_validate(group)
        created_groups.append(
            schemas.ClusterGroupInfo(group=group_out, card_ids=valid_card_ids)
        )

    db.commit()

    for cg in created_groups:
        await manager.broadcast(
            board_id, "group_created", cg.group.model_dump(mode="json")
        )
        for card_id in cg.card_ids:
            card = db.get(models.Card, card_id)
            if card:
                db.refresh(card)
                await broadcast_card(board, "card_updated", card)

    await manager.broadcast(
        board_id,
        "auto_cluster_completed",
        {
            "column_id": col.id,
            "groups_count": len(created_groups),
            "username": username,
        },
    )

    return schemas.AutoClusterResult(
        created_groups=created_groups,
        ungrouped_card_ids=ungrouped_ids,
    )


@router.post("/auto-cluster", response_model=schemas.AutoClusterResult)
@limiter.limit("5/minute")
async def auto_cluster(
    request: Request,
    body: schemas.AutoClusterRequest,
    db: Session = Depends(get_db),
    workspace: models.Workspace = Depends(get_current_workspace),
    participant: models.Participant = Depends(get_current_participant),
):
    """AI-кластеризация негруппированных карточек в колонке."""
    workspace_id = workspace.id
    username = participant.name
    result = await _compute_column_clusters(body.column_id, db, workspace_id)
    # Пока модель думала, колонку могли удалить, а доску — заблокировать
    col, board = _unlocked_column(db, body.column_id, workspace_id)
    return await _apply_groups_to_column(
        col=col,
        board=board,
        groups_spec=result["groups"],
        ungrouped_ids=result["ungrouped"],
        username=username,
        db=db,
    )


@router.post("/auto-cluster-preview", response_model=schemas.ClusterPreviewResult)
@limiter.limit("5/minute")
async def auto_cluster_preview(
    request: Request,
    body: schemas.AutoClusterRequest,
    db: Session = Depends(get_db),
    workspace: models.Workspace = Depends(get_current_workspace),
):
    """Preview AI clustering groups for a column without writing to DB."""
    result = await _compute_column_clusters(body.column_id, db, workspace.id)
    return schemas.ClusterPreviewResult(
        column_id=body.column_id,
        groups=[
            schemas.ClusterPreviewGroup(title=g["title"], card_ids=g["card_ids"])
            for g in result["groups"]
        ],
        ungrouped_card_ids=result["ungrouped"],
    )


@router.post("/apply-clusters", response_model=schemas.AutoClusterResult)
@limiter.limit("15/minute")
async def apply_clusters(
    request: Request,
    body: schemas.ApplyClustersRequest,
    db: Session = Depends(get_db),
    workspace: models.Workspace = Depends(get_current_workspace),
    participant: models.Participant = Depends(get_current_participant),
):
    """Persist user-reviewed AI cluster groups for a column."""
    col, board = _unlocked_column(db, body.column_id, workspace.id)
    all_ungrouped = (
        db.query(models.Card.id)
        .filter(models.Card.column_id == col.id, models.Card.group_id.is_(None))
        .all()
    )
    ungrouped_pool = {row[0] for row in all_ungrouped}
    grouped_requested = {cid for g in body.groups for cid in g.card_ids}
    remaining = sorted(ungrouped_pool - grouped_requested)
    groups_spec = [{"title": g.title, "card_ids": g.card_ids} for g in body.groups]
    return await _apply_groups_to_column(
        col=col,
        board=board,
        groups_spec=groups_spec,
        ungrouped_ids=remaining,
        username=participant.name,
        db=db,
    )
