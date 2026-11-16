from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.orm import Session

from app import models, schemas
from app.board_view import (
    broadcast_card,
    can_delete_card,
    can_edit_card_text,
    can_moderate,
    card_view,
    cards_hidden,
    require_cards_visible,
)
from app.database import get_db
from app.limiter import TEAM_BULK_LIMIT, TEAM_WRITE_LIMIT, limiter
from app.services import cards as cards_service
from app.services.boards import clear_deleted_groups_state
from app.services.cards import load_board_cards, prune_empty_groups
from app.utils import get_or_404, require_unlocked_board
from app.workspace_auth import get_current_participant, get_current_workspace
from app.ws_manager import manager

router = APIRouter()

_NOT_YOUR_CARD = "Текст карточки может менять только её автор"
_CANNOT_DELETE = "Удалить чужую карточку может только создатель доски или ведущий"


def _count_votes(db: Session, board_id: str, participant_id: str) -> int:
    """Сколько голосов участник уже отдал на доске."""
    cards = (
        db.query(models.Card.likes)
        .join(models.Column, models.Card.column_id == models.Column.id)
        .filter(models.Column.board_id == board_id)
        .all()
    )
    return sum((likes or []).count(participant_id) for (likes,) in cards)


def _column_card_ids(column: models.Column) -> list[str]:
    return [c.id for c in sorted(column.cards, key=lambda c: c.position)]


@router.post("/", response_model=schemas.CardOut, status_code=201)
@limiter.limit(TEAM_WRITE_LIMIT)
async def create_card(
    request: Request,
    body: schemas.CardCreate,
    db: Session = Depends(get_db),
    workspace: models.Workspace = Depends(get_current_workspace),
    participant: models.Participant = Depends(get_current_participant),
):
    return await cards_service.create_card_for_participant(
        db,
        workspace.id,
        participant,
        column_id=body.column_id,
        text=body.text,
        color=body.color,
    )


@router.patch("/{card_id}", response_model=schemas.CardOut)
@limiter.limit(TEAM_WRITE_LIMIT)
async def update_card(
    request: Request,
    card_id: str,
    body: schemas.CardUpdate,
    db: Session = Depends(get_db),
    workspace: models.Workspace = Depends(get_current_workspace),
    participant: models.Participant = Depends(get_current_participant),
):
    card = get_or_404(db, models.Card, card_id, "Карточка не найдена")
    col = get_or_404(db, models.Column, card.column_id, "Карточка не найдена")
    board = require_unlocked_board(
        db.get(models.Board, col.board_id), workspace.id, "Карточка не найдена"
    )
    if body.text is not None:
        own = can_edit_card_text(card, participant.id)
        # Клиент присылает карточку целиком, поэтому чужой текст без изменений
        # не ошибка. Но у скрытой карточки сравнение подтверждало бы догадку
        # о её тексте — там текст от чужого не принимается вовсе.
        if not own and (cards_hidden(board) or body.text != card.text):
            raise HTTPException(403, _NOT_YOUR_CARD)
        card.text = body.text
    if body.color is not None:
        card.color = body.color
    if "group_id" in body.model_fields_set:
        if body.group_id is not None:
            group = get_or_404(db, models.CardGroup, body.group_id, "Группа не найдена")
            if group.column_id != card.column_id:
                raise HTTPException(400, "Карточка и группа должны быть в одной колонке")
        card.group_id = body.group_id
    db.commit()
    db.refresh(card)
    await broadcast_card(board, "card_updated", card)
    return card_view(card, board, participant.id)


@router.post("/{card_id}/move", response_model=schemas.CardOut)
@limiter.limit(TEAM_WRITE_LIMIT)
async def move_card(
    request: Request,
    card_id: str,
    body: schemas.MoveCard,
    db: Session = Depends(get_db),
    workspace: models.Workspace = Depends(get_current_workspace),
    participant: models.Participant = Depends(get_current_participant),
):
    card = get_or_404(db, models.Card, card_id, "Карточка не найдена")
    col = get_or_404(db, models.Column, card.column_id, "Карточка не найдена")
    board = require_unlocked_board(
        db.get(models.Board, col.board_id), workspace.id, "Карточка не найдена"
    )
    old_col = col
    new_col = get_or_404(db, models.Column, body.column_id, "Колонка назначения не найдена")
    if new_col.board_id != old_col.board_id:
        raise HTTPException(400, "Колонки должны быть на одной доске")

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
    db.refresh(new_col)
    if old_col.id != new_col.id:
        db.refresh(old_col)
    # Сервер перенумеровал соседей: шлём итоговый порядок обеих колонок,
    # иначе у остальных клиентов карточки встанут по устаревшим позициям.
    order = {
        "old_column_id": old_col.id,
        "column_card_ids": _column_card_ids(new_col),
        "old_column_card_ids": _column_card_ids(old_col),
    }
    await broadcast_card(board, "card_moved", card, lambda view: {"card": view, **order})

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

    return card_view(card, board, participant.id)


@router.post("/{card_id}/like", response_model=schemas.CardOut)
@limiter.limit(TEAM_WRITE_LIMIT)
async def toggle_like(
    request: Request,
    card_id: str,
    action: str = Query("toggle", pattern="^(toggle|add|remove)$"),
    db: Session = Depends(get_db),
    workspace: models.Workspace = Depends(get_current_workspace),
    participant: models.Participant = Depends(get_current_participant),
):
    """Голос участника сессии. От чужого имени проголосовать или снять голос нельзя."""
    voter = participant.id
    # Lock the card row to prevent concurrent vote race conditions
    card = db.query(models.Card).filter(models.Card.id == card_id).with_for_update().first()
    if not card:
        raise HTTPException(404, "Карточка не найдена")
    col = get_or_404(db, models.Column, card.column_id, "Карточка не найдена")
    # Lock board row too to prevent parallel votes across different cards from exceeding max_votes
    board = (
        db.query(models.Board)
        .filter(models.Board.id == col.board_id)
        .with_for_update()
        .first()
    )
    board = require_unlocked_board(board, workspace.id, "Карточка не найдена")
    likes = list(card.likes or [])
    if board.allow_multiple_votes_per_card:
        if action == "remove":
            if voter in likes:
                likes.remove(voter)
        else:
            if _count_votes(db, col.board_id, voter) >= board.max_votes:
                raise HTTPException(403, "Лимит голосов исчерпан")
            likes.append(voter)
    else:
        if voter in likes:
            if action in ("toggle", "remove"):
                likes = [u for u in likes if u != voter]
        elif action in ("toggle", "add"):
            if _count_votes(db, col.board_id, voter) >= board.max_votes:
                raise HTTPException(403, "Лимит голосов исчерпан")
            likes.append(voter)
    card.likes = likes
    db.commit()
    db.refresh(card)
    await broadcast_card(board, "card_updated", card)
    return card_view(card, board, participant.id)


@router.post("/bulk-update", response_model=list[schemas.CardOut])
@limiter.limit(TEAM_BULK_LIMIT)
async def bulk_update_cards(
    request: Request,
    payload: schemas.BulkCardsUpdateRequest,
    db: Session = Depends(get_db),
    workspace: models.Workspace = Depends(get_current_workspace),
    participant: models.Participant = Depends(get_current_participant),
):
    return await cards_service.bulk_update_cards_for_workspace(
        db,
        workspace.id,
        participant,
        card_ids=payload.card_ids,
        provided_fields=payload.model_fields_set,
        column_id=payload.column_id,
        group_title=payload.group_title,
        group_id=payload.group_id,
        color=payload.color,
        require_visible_for_grouping=False,
    )


@router.post("/bulk-delete", status_code=200)
@limiter.limit(TEAM_BULK_LIMIT)
async def bulk_delete_cards(
    request: Request,
    payload: schemas.BulkCardsDeleteRequest,
    db: Session = Depends(get_db),
    workspace: models.Workspace = Depends(get_current_workspace),
    participant: models.Participant = Depends(get_current_participant),
):
    board, cards, _ = load_board_cards(db, payload.card_ids, workspace.id)
    if not all(can_delete_card(card, board, participant.id) for card in cards):
        raise HTTPException(403, _CANNOT_DELETE)
    touched_group_ids: set[str] = {c.group_id for c in cards if c.group_id}
    deleted_events = [{"id": c.id, "column_id": c.column_id} for c in cards]

    for card in cards:
        db.delete(card)
    db.flush()
    deleted_groups = prune_empty_groups(db, touched_group_ids)
    clear_deleted_groups_state(db, board.id, [p["id"] for p in deleted_groups], commit=False)
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
    participant: models.Participant = Depends(get_current_participant),
):
    board, cards, _ = load_board_cards(db, payload.card_ids, workspace.id)
    if len(cards) < 2:
        raise HTTPException(400, "Для объединения выберите минимум 2 карточки")
    # Объединение склеивает тексты, переписывает первую карточку и удаляет
    # остальные — это и правка, и удаление сразу. Пока карточки скрыты, оно
    # выдало бы чужой текст; чужие карточки объединяет только модератор.
    require_cards_visible(board)
    if not can_moderate(board, participant.id) and not all(
        can_edit_card_text(card, participant.id) for card in cards
    ):
        raise HTTPException(
            403, "Объединять чужие карточки может создатель доски или ведущий"
        )

    primary = cards[0]
    duplicates = cards[1:]

    if payload.target_text and payload.target_text.strip():
        merged_text = payload.target_text.strip()
    else:
        parts = [c.text.strip() for c in cards if c.text and c.text.strip()]
        merged_text = "\n".join(dict.fromkeys(parts))[:2000]
    if not merged_text:
        raise HTTPException(400, "Текст карточки не может быть пустым")
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
    deleted_groups = prune_empty_groups(db, touched_group_ids)
    clear_deleted_groups_state(db, board.id, [p["id"] for p in deleted_groups], commit=False)
    db.commit()
    db.refresh(primary)

    await broadcast_card(board, "card_updated", primary)
    for evt in deleted_events:
        await manager.broadcast(board.id, "card_deleted", evt)
    for deleted_payload in deleted_groups:
        await manager.broadcast(board.id, "group_deleted", deleted_payload)
    return card_view(primary, board, participant.id)


@router.delete("/{card_id}", status_code=204)
@limiter.limit(TEAM_WRITE_LIMIT)
async def delete_card(
    request: Request,
    card_id: str,
    db: Session = Depends(get_db),
    workspace: models.Workspace = Depends(get_current_workspace),
    participant: models.Participant = Depends(get_current_participant),
):
    card = get_or_404(db, models.Card, card_id, "Карточка не найдена")
    col = get_or_404(db, models.Column, card.column_id, "Карточка не найдена")
    board = require_unlocked_board(
        db.get(models.Board, col.board_id), workspace.id, "Карточка не найдена"
    )
    if not can_delete_card(card, board, participant.id):
        raise HTTPException(403, _CANNOT_DELETE)
    board_id = col.board_id
    group_id = card.group_id
    db.delete(card)
    db.flush()
    deleted_groups = prune_empty_groups(db, {group_id} if group_id else set())
    clear_deleted_groups_state(db, board_id, [p["id"] for p in deleted_groups], commit=False)
    db.commit()
    await manager.broadcast(board_id, "card_deleted", {"id": card_id, "column_id": col.id})

    for deleted_payload in deleted_groups:
        await manager.broadcast(board_id, "group_deleted", deleted_payload)
