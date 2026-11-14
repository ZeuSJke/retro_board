import uuid
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.database import get_db
from app import models, schemas
from app.utils import get_or_404, require_unlocked_board
from app.ws_manager import manager
from app.limiter import TEAM_BULK_LIMIT, TEAM_WRITE_LIMIT, limiter
from app.workspace_auth import get_current_workspace

router = APIRouter()


def _count_user_votes(db: Session, board_id: str, username: str) -> int:
    """Count how many likes a user has across all cards in a board."""
    cards = (
        db.query(models.Card.likes)
        .join(models.Column, models.Card.column_id == models.Column.id)
        .filter(models.Column.board_id == board_id)
        .all()
    )
    return sum((likes or []).count(username) for (likes,) in cards)


@router.post("/", response_model=schemas.CardOut, status_code=201)
@limiter.limit(TEAM_WRITE_LIMIT)
async def create_card(
    request: Request,
    body: schemas.CardCreate,
    db: Session = Depends(get_db),
    workspace: models.Workspace = Depends(get_current_workspace),
):
    col = get_or_404(db, models.Column, body.column_id, "Column not found")
    require_unlocked_board(db.get(models.Board, col.board_id), workspace.id, "Column not found")
    pos = db.query(func.count(models.Card.id)).filter(models.Card.column_id == body.column_id).scalar() or 0
    card = models.Card(
        id=str(uuid.uuid4()),
        column_id=body.column_id,
        text=body.text,
        author=body.author,
        color=body.color,
        position=pos,
        likes=[],
    )
    db.add(card)
    db.commit()
    db.refresh(card)
    out = schemas.CardOut.model_validate(card)
    await manager.broadcast(col.board_id, "card_created", out.model_dump(mode="json"))
    return out


@router.patch("/{card_id}", response_model=schemas.CardOut)
@limiter.limit(TEAM_WRITE_LIMIT)
async def update_card(
    request: Request,
    card_id: str,
    body: schemas.CardUpdate,
    db: Session = Depends(get_db),
    workspace: models.Workspace = Depends(get_current_workspace),
):
    card = get_or_404(db, models.Card, card_id, "Card not found")
    col = db.get(models.Column, card.column_id)
    require_unlocked_board(db.get(models.Board, col.board_id), workspace.id, "Card not found")
    if body.text is not None:
        card.text = body.text
    if body.color is not None:
        card.color = body.color
    if "group_id" in body.model_fields_set:
        if body.group_id is not None:
            group = get_or_404(db, models.CardGroup, body.group_id, "Group not found")
            if group.column_id != card.column_id:
                raise HTTPException(400, "Card and group must be in the same column")
        card.group_id = body.group_id
    db.commit()
    db.refresh(card)
    out = schemas.CardOut.model_validate(card)
    await manager.broadcast(col.board_id, "card_updated", out.model_dump(mode="json"))
    return out


@router.post("/{card_id}/move", response_model=schemas.CardOut)
@limiter.limit(TEAM_WRITE_LIMIT)
async def move_card(
    request: Request,
    card_id: str,
    body: schemas.MoveCard,
    db: Session = Depends(get_db),
    workspace: models.Workspace = Depends(get_current_workspace),
):
    card = get_or_404(db, models.Card, card_id, "Card not found")
    col = db.get(models.Column, card.column_id)
    require_unlocked_board(db.get(models.Board, col.board_id), workspace.id, "Card not found")
    old_col = db.get(models.Column, card.column_id)
    new_col = get_or_404(db, models.Column, body.column_id, "Target column not found")
    if new_col.board_id != old_col.board_id:
        raise HTTPException(400, "Columns must be on the same board")

    old_group_id = card.group_id if old_col.id != new_col.id else None

    # Re-order old column
    if old_col.id != new_col.id:
        old_cards = sorted([c for c in old_col.cards if c.id != card_id], key=lambda c: c.position)
        for i, c in enumerate(old_cards):
            c.position = i

    # Insert into new column
    new_cards = sorted([c for c in new_col.cards if c.id != card_id], key=lambda c: c.position)
    new_cards.insert(body.position, card)
    for i, c in enumerate(new_cards):
        c.position = i
    card.column_id = body.column_id
    # Moving to another column always ungroups the card
    if old_col.id != new_col.id:
        card.group_id = None

    db.commit()
    db.refresh(card)
    out = schemas.CardOut.model_validate(card)
    await manager.broadcast(new_col.board_id, "card_moved", {
        "card": out.model_dump(mode="json"),
        "old_column_id": old_col.id,
    })

    # Auto-delete old group if it became empty after cross-column move
    if old_group_id:
        remaining = db.query(models.Card).filter(models.Card.group_id == old_group_id).count()
        if remaining == 0:
            group = db.get(models.CardGroup, old_group_id)
            if group:
                col_id = group.column_id
                db.delete(group)
                db.commit()
                await manager.broadcast(new_col.board_id, "group_deleted", {"id": old_group_id, "column_id": col_id, "card_ids": []})

    return out


@router.post("/{card_id}/like", response_model=schemas.CardOut)
@limiter.limit(TEAM_WRITE_LIMIT)
async def toggle_like(
    request: Request,
    card_id: str,
    username: str = Query(..., min_length=1, max_length=60),
    action: str = Query("toggle", pattern="^(toggle|add|remove)$"),
    db: Session = Depends(get_db),
    workspace: models.Workspace = Depends(get_current_workspace),
):
    # Lock the card row to prevent concurrent vote race conditions
    card = db.query(models.Card).filter(models.Card.id == card_id).with_for_update().first()
    if not card:
        raise HTTPException(404, "Card not found")
    col = db.get(models.Column, card.column_id)
    # Lock board row too to prevent parallel votes across different cards from exceeding max_votes
    board = (
        db.query(models.Board)
        .filter(models.Board.id == col.board_id)
        .with_for_update()
        .first()
    )
    board = require_unlocked_board(board, workspace.id, "Card not found")
    likes = list(card.likes or [])
    if board.allow_multiple_votes_per_card:
        if action == "remove":
            if username in likes:
                likes.remove(username)
        else:
            if _count_user_votes(db, col.board_id, username) >= board.max_votes:
                raise HTTPException(403, "Лимит голосов исчерпан")
            likes.append(username)
    else:
        if username in likes:
            if action in ("toggle", "remove"):
                likes = [u for u in likes if u != username]
        elif action in ("toggle", "add"):
            if _count_user_votes(db, col.board_id, username) >= board.max_votes:
                raise HTTPException(403, "Лимит голосов исчерпан")
            likes.append(username)
    card.likes = likes
    db.commit()
    db.refresh(card)
    out = schemas.CardOut.model_validate(card)
    await manager.broadcast(col.board_id, "card_updated", out.model_dump(mode="json"))
    return out


def _load_board_cards(
    db: Session,
    card_ids: list[str],
    workspace_id: str,
) -> tuple[models.Board, list[models.Card], dict[str, models.Column]]:
    """Load unique cards by ID, verify same unlocked board in workspace."""
    unique_ids = list(dict.fromkeys(card_ids))
    cards = db.query(models.Card).filter(models.Card.id.in_(unique_ids)).all()
    by_id = {c.id: c for c in cards}
    ordered_cards = [by_id[cid] for cid in unique_ids if cid in by_id]
    if len(ordered_cards) != len(unique_ids):
        raise HTTPException(404, "Card not found")

    col_ids = {c.column_id for c in ordered_cards}
    cols = db.query(models.Column).filter(models.Column.id.in_(col_ids)).all()
    col_map = {col.id: col for col in cols}
    board_ids = {col.board_id for col in cols}
    if len(board_ids) != 1:
        raise HTTPException(400, "Cards must belong to the same board")

    board_id = next(iter(board_ids))
    board = require_unlocked_board(db.get(models.Board, board_id), workspace_id, "Card not found")
    return board, ordered_cards, col_map


def _prune_empty_groups(db: Session, group_ids: set[str]) -> list[dict]:
    """Delete groups that no longer contain any cards and return deleted payloads."""
    deleted_payloads: list[dict] = []
    for gid in group_ids:
        if not gid:
            continue
        remaining = db.query(models.Card).filter(models.Card.group_id == gid).count()
        if remaining == 0:
            group = db.get(models.CardGroup, gid)
            if group:
                col_id = group.column_id
                db.delete(group)
                deleted_payloads.append({"id": gid, "column_id": col_id, "card_ids": []})
    return deleted_payloads


@router.post("/bulk-update", response_model=list[schemas.CardOut])
@limiter.limit(TEAM_BULK_LIMIT)
async def bulk_update_cards(
    request: Request,
    payload: schemas.BulkCardsUpdateRequest,
    db: Session = Depends(get_db),
    workspace: models.Workspace = Depends(get_current_workspace),
):
    board, cards, col_map = _load_board_cards(db, payload.card_ids, workspace.id)
    touched_group_ids: set[str] = set()
    created_group: models.CardGroup | None = None

    target_col: models.Column | None = None
    if payload.column_id is not None:
        target_col = get_or_404(db, models.Column, payload.column_id, "Column not found")
        if target_col.board_id != board.id:
            raise HTTPException(400, "Target column belongs to another board")
        max_pos = (
            db.query(func.max(models.Card.position))
            .filter(models.Card.column_id == target_col.id)
            .scalar()
        )
        next_pos = (max_pos if max_pos is not None else -1) + 1
        for offset, card in enumerate(cards):
            if card.column_id != target_col.id:
                if card.group_id:
                    touched_group_ids.add(card.group_id)
                card.column_id = target_col.id
                card.group_id = None
                card.position = next_pos + offset

    if payload.group_title is not None:
        effective_cols = {c.column_id for c in cards}
        if len(effective_cols) != 1:
            raise HTTPException(400, "Карточки для группировки должны быть в одной колонке")
        col_id = next(iter(effective_cols))
        max_gpos = (
            db.query(func.max(models.CardGroup.position))
            .filter(models.CardGroup.column_id == col_id)
            .scalar()
        )
        created_group = models.CardGroup(
            id=str(uuid.uuid4()),
            column_id=col_id,
            title=payload.group_title.strip() or "Новая группа",
            position=(max_gpos if max_gpos is not None else -1) + 1,
        )
        db.add(created_group)
        db.flush()
        for card in cards:
            if card.group_id and card.group_id != created_group.id:
                touched_group_ids.add(card.group_id)
            card.group_id = created_group.id
    elif "group_id" in payload.model_fields_set:
        if payload.group_id:
            target_group = get_or_404(db, models.CardGroup, payload.group_id, "Group not found")
            target_group_col = db.get(models.Column, target_group.column_id)
            if not target_group_col or target_group_col.board_id != board.id:
                raise HTTPException(400, "Group belongs to another board")
            if any(c.column_id != target_group.column_id for c in cards):
                raise HTTPException(400, "Карточки должны находиться в той же колонке, что и группа")
        for card in cards:
            if card.group_id and card.group_id != payload.group_id:
                touched_group_ids.add(card.group_id)
            card.group_id = payload.group_id or None

    if payload.color is not None:
        for card in cards:
            card.color = payload.color

    db.flush()
    deleted_groups = _prune_empty_groups(db, touched_group_ids)
    db.commit()

    if created_group is not None:
        db.refresh(created_group)
        group_out = schemas.CardGroupOut.model_validate(created_group)
        await manager.broadcast(board.id, "group_created", group_out.model_dump(mode="json"))

    results: list[schemas.CardOut] = []
    for card in cards:
        db.refresh(card)
        out = schemas.CardOut.model_validate(card)
        results.append(out)
        await manager.broadcast(board.id, "card_updated", out.model_dump(mode="json"))

    for deleted_payload in deleted_groups:
        await manager.broadcast(board.id, "group_deleted", deleted_payload)

    return results


@router.post("/bulk-delete", status_code=200)
@limiter.limit(TEAM_BULK_LIMIT)
async def bulk_delete_cards(
    request: Request,
    payload: schemas.BulkCardsDeleteRequest,
    db: Session = Depends(get_db),
    workspace: models.Workspace = Depends(get_current_workspace),
):
    board, cards, _ = _load_board_cards(db, payload.card_ids, workspace.id)
    touched_group_ids: set[str] = {c.group_id for c in cards if c.group_id}
    deleted_events = [{"id": c.id, "column_id": c.column_id} for c in cards]

    for card in cards:
        db.delete(card)
    db.flush()
    deleted_groups = _prune_empty_groups(db, touched_group_ids)
    db.commit()

    for evt in deleted_events:
        await manager.broadcast(board.id, "card_deleted", evt)
    for deleted_payload in deleted_groups:
        await manager.broadcast(board.id, "group_deleted", deleted_payload)

    return {"deleted": len(deleted_events)}


@router.post("/merge", response_model=schemas.CardOut)
@limiter.limit(TEAM_BULK_LIMIT)
async def merge_cards(
    request: Request,
    payload: schemas.MergeCardsRequest,
    db: Session = Depends(get_db),
    workspace: models.Workspace = Depends(get_current_workspace),
):
    board, cards, _ = _load_board_cards(db, payload.card_ids, workspace.id)
    if len(cards) < 2:
        raise HTTPException(400, "Для объединения выберите минимум 2 карточки")

    primary = cards[0]
    duplicates = cards[1:]

    if payload.target_text and payload.target_text.strip():
        merged_text = payload.target_text.strip()
    else:
        parts = [c.text.strip() for c in cards if c.text and c.text.strip()]
        merged_text = "\n".join(dict.fromkeys(parts))[:2000]
    if not merged_text:
        raise HTTPException(400, "Card text cannot be empty")
    primary.text = merged_text

    combined_likes: list[str] = []
    if board.allow_multiple_votes_per_card:
        for c in cards:
            combined_likes.extend(c.likes or [])
    else:
        seen_voters: set[str] = set()
        for c in cards:
            for voter in c.likes or []:
                if voter not in seen_voters:
                    seen_voters.add(voter)
                    combined_likes.append(voter)
    primary.likes = combined_likes

    touched_group_ids: set[str] = {d.group_id for d in duplicates if d.group_id}
    deleted_events = [{"id": d.id, "column_id": d.column_id} for d in duplicates]
    for dup in duplicates:
        db.delete(dup)
    db.flush()
    deleted_groups = _prune_empty_groups(db, touched_group_ids)
    db.commit()
    db.refresh(primary)

    out = schemas.CardOut.model_validate(primary)
    await manager.broadcast(board.id, "card_updated", out.model_dump(mode="json"))
    for evt in deleted_events:
        await manager.broadcast(board.id, "card_deleted", evt)
    for deleted_payload in deleted_groups:
        await manager.broadcast(board.id, "group_deleted", deleted_payload)
    return out


@router.delete("/{card_id}", status_code=204)
@limiter.limit(TEAM_WRITE_LIMIT)
async def delete_card(
    request: Request,
    card_id: str,
    db: Session = Depends(get_db),
    workspace: models.Workspace = Depends(get_current_workspace),
):
    card = get_or_404(db, models.Card, card_id, "Card not found")
    col = db.get(models.Column, card.column_id)
    require_unlocked_board(db.get(models.Board, col.board_id), workspace.id, "Card not found")
    board_id = col.board_id
    group_id = card.group_id
    db.delete(card)
    db.commit()
    await manager.broadcast(board_id, "card_deleted", {"id": card_id, "column_id": col.id})

    # Auto-delete group if it became empty after card deletion
    if group_id:
        remaining = db.query(models.Card).filter(models.Card.group_id == group_id).count()
        if remaining == 0:
            group = db.get(models.CardGroup, group_id)
            if group:
                col_id = group.column_id
                db.delete(group)
                db.commit()
                await manager.broadcast(board_id, "group_deleted", {"id": group_id, "column_id": col_id, "card_ids": []})
