import asyncio
import logging
import uuid
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app import models, schemas
from app.utils import get_or_404, require_unlocked_board
from app.ws_manager import manager
from app.limiter import limiter
from app.workspace_auth import get_current_workspace
from app.ai.clustering import cluster_cards, MAX_CARDS_FOR_CLUSTERING

logger = logging.getLogger(__name__)

router = APIRouter()


@router.post("/", response_model=schemas.CardGroupOut, status_code=201)
@limiter.limit("30/minute")
async def create_group(
    request: Request,
    body: schemas.CardGroupCreate,
    db: Session = Depends(get_db),
    workspace: models.Workspace = Depends(get_current_workspace),
):
    col = get_or_404(db, models.Column, body.column_id, "Column not found")
    require_unlocked_board(db.get(models.Board, col.board_id), workspace.id, "Column not found")
    pos = db.query(func.count(models.CardGroup.id)).filter(models.CardGroup.column_id == body.column_id).scalar() or 0
    group = models.CardGroup(
        id=str(uuid.uuid4()),
        column_id=body.column_id,
        title=body.title,
        position=pos,
    )
    db.add(group)
    db.commit()
    db.refresh(group)
    out = schemas.CardGroupOut.model_validate(group)
    await manager.broadcast(col.board_id, "group_created", out.model_dump(mode="json"))
    return out


@router.patch("/{group_id}", response_model=schemas.CardGroupOut)
@limiter.limit("30/minute")
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
@limiter.limit("30/minute")
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
@limiter.limit("30/minute")
async def set_card_group(
    request: Request,
    group_id: str,
    card_id: str,
    db: Session = Depends(get_db),
    workspace: models.Workspace = Depends(get_current_workspace),
):
    """Add a card to a group."""
    group = get_or_404(db, models.CardGroup, group_id, "Group not found")
    col = db.get(models.Column, group.column_id)
    require_unlocked_board(db.get(models.Board, col.board_id), workspace.id, "Group not found")
    card = get_or_404(db, models.Card, card_id, "Card not found")
    if card.column_id != group.column_id:
        raise HTTPException(400, "Card and group must be in the same column")
    card.group_id = group_id
    db.commit()
    db.refresh(card)
    out = schemas.CardOut.model_validate(card)
    await manager.broadcast(col.board_id, "card_updated", out.model_dump(mode="json"))
    return out


@router.patch("/{group_id}/move", response_model=schemas.CardGroupOut)
@limiter.limit("30/minute")
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
    require_unlocked_board(db.get(models.Board, col.board_id), workspace.id, "Group not found")
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
    card_outs = [schemas.CardOut.model_validate(c) for c in cards]
    await manager.broadcast(
        old_col.board_id,
        "group_moved",
        {
            "group": group_out.model_dump(mode="json"),
            "old_column_id": old_column_id,
            "cards": [c.model_dump(mode="json") for c in card_outs],
        },
    )
    return group_out


@router.delete("/{group_id}/remove_card/{card_id}", response_model=schemas.CardOut)
@limiter.limit("30/minute")
async def remove_card_from_group(
    request: Request,
    group_id: str,
    card_id: str,
    db: Session = Depends(get_db),
    workspace: models.Workspace = Depends(get_current_workspace),
):
    """Remove a card from its group. Auto-deletes the group if it becomes empty."""
    card = get_or_404(db, models.Card, card_id, "Card not found")
    col = db.get(models.Column, card.column_id)
    require_unlocked_board(db.get(models.Board, col.board_id), workspace.id, "Card not found")
    if card.group_id != group_id:
        raise HTTPException(400, "Card is not in this group")
    card.group_id = None
    db.commit()
    db.refresh(card)
    out = schemas.CardOut.model_validate(card)
    await manager.broadcast(col.board_id, "card_updated", out.model_dump(mode="json"))

    # Auto-delete group if now empty
    remaining = db.query(models.Card).filter(models.Card.group_id == group_id).count()
    if remaining == 0:
        group = db.get(models.CardGroup, group_id)
        if group:
            col_id = group.column_id
            db.delete(group)
            db.commit()
            await manager.broadcast(col.board_id, "group_deleted", {"id": group_id, "column_id": col_id, "card_ids": []})

    return out


async def _compute_column_clusters(
    column_id: str,
    db: Session,
    workspace_id: str,
) -> tuple[models.Column, dict]:
    """Validate column, check AI config, and compute clustering suggestions without persisting."""
    if not settings.ai_configured:
        raise HTTPException(503, "AI-сервис не настроен")

    col = get_or_404(db, models.Column, column_id, "Колонка не найдена")
    require_unlocked_board(db.get(models.Board, col.board_id), workspace_id, "Колонка не найдена")

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
    try:
        result = await asyncio.to_thread(cluster_cards, cards_data)
    except Exception as e:
        logger.error("AI clustering failed for column %s: %s", column_id, type(e).__name__)
        raise HTTPException(503, "AI-сервис временно недоступен")
    return col, result


async def _apply_groups_to_column(
    col: models.Column,
    groups_spec: list[dict],
    ungrouped_ids: list[str],
    username: str | None,
    db: Session,
) -> schemas.AutoClusterResult:
    """Persist proposed cluster groups into DB and broadcast WS updates."""
    created_groups: list[schemas.ClusterGroupInfo] = []
    board_id = col.board_id
    assigned_ids: set[str] = set()

    group_pos = (
        db.query(func.count(models.CardGroup.id))
        .filter(models.CardGroup.column_id == col.id)
        .scalar()
        or 0
    )

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
                card_out = schemas.CardOut.model_validate(card)
                await manager.broadcast(
                    board_id, "card_updated", card_out.model_dump(mode="json")
                )

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
):
    """AI-кластеризация негруппированных карточек в колонке."""
    col, result = await _compute_column_clusters(body.column_id, db, workspace.id)
    return await _apply_groups_to_column(
        col=col,
        groups_spec=result["groups"],
        ungrouped_ids=result["ungrouped"],
        username=body.username,
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
    col, result = await _compute_column_clusters(body.column_id, db, workspace.id)
    return schemas.ClusterPreviewResult(
        column_id=col.id,
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
):
    """Persist user-reviewed AI cluster groups for a column."""
    col = get_or_404(db, models.Column, body.column_id, "Колонка не найдена")
    require_unlocked_board(db.get(models.Board, col.board_id), workspace.id, "Колонка не найдена")
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
        groups_spec=groups_spec,
        ungrouped_ids=remaining,
        username=body.username,
        db=db,
    )
