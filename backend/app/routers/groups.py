import uuid
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.database import get_db
from app import models, schemas
from app.utils import get_or_404
from app.ws_manager import manager
from app.limiter import limiter
from app.workspace_auth import get_current_workspace

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
    board = db.get(models.Board, col.board_id)
    if not board or board.workspace_id != workspace.id:
        raise HTTPException(404, "Column not found")
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
    board = db.get(models.Board, col.board_id)
    if not board or board.workspace_id != workspace.id:
        raise HTTPException(404, "Group not found")
    if body.title is not None:
        group.title = body.title
    db.commit()
    db.refresh(group)
    col = db.get(models.Column, group.column_id)
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
    board = db.get(models.Board, col.board_id)
    if not board or board.workspace_id != workspace.id:
        raise HTTPException(404, "Group not found")
    col = db.get(models.Column, group.column_id)
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
    board = db.get(models.Board, col.board_id)
    if not board or board.workspace_id != workspace.id:
        raise HTTPException(404, "Group not found")
    card = get_or_404(db, models.Card, card_id, "Card not found")
    if card.column_id != group.column_id:
        raise HTTPException(400, "Card and group must be in the same column")
    card.group_id = group_id
    db.commit()
    db.refresh(card)
    col = db.get(models.Column, card.column_id)
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
    board = db.get(models.Board, col.board_id)
    if not board or board.workspace_id != workspace.id:
        raise HTTPException(404, "Group not found")
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
    board = db.get(models.Board, col.board_id)
    if not board or board.workspace_id != workspace.id:
        raise HTTPException(404, "Card not found")
    card.group_id = None
    db.commit()
    db.refresh(card)
    col = db.get(models.Column, card.column_id)
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
