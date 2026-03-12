import uuid
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app import models, schemas
from app.ws_manager import manager

router = APIRouter()


@router.post("/", response_model=schemas.CardOut, status_code=201)
async def create_card(body: schemas.CardCreate, db: Session = Depends(get_db)):
    col = db.get(models.Column, body.column_id)
    if not col:
        raise HTTPException(404, "Column not found")
    pos = len(col.cards)
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
async def update_card(card_id: str, body: schemas.CardUpdate, db: Session = Depends(get_db)):
    card = db.get(models.Card, card_id)
    if not card:
        raise HTTPException(404, "Card not found")
    if body.text is not None:
        card.text = body.text
    if body.color is not None:
        card.color = body.color
    if "group_id" in body.model_fields_set:
        card.group_id = body.group_id
    db.commit()
    db.refresh(card)
    col = db.get(models.Column, card.column_id)
    out = schemas.CardOut.model_validate(card)
    await manager.broadcast(col.board_id, "card_updated", out.model_dump(mode="json"))
    return out


@router.post("/{card_id}/move", response_model=schemas.CardOut)
async def move_card(card_id: str, body: schemas.MoveCard, db: Session = Depends(get_db)):
    card = db.get(models.Card, card_id)
    if not card:
        raise HTTPException(404, "Card not found")
    old_col = db.get(models.Column, card.column_id)
    new_col = db.get(models.Column, body.column_id)
    if not new_col:
        raise HTTPException(404, "Target column not found")

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
    return out


@router.post("/{card_id}/like", response_model=schemas.CardOut)
async def toggle_like(card_id: str, username: str, db: Session = Depends(get_db)):
    card = db.get(models.Card, card_id)
    if not card:
        raise HTTPException(404, "Card not found")
    likes = list(card.likes or [])
    if username in likes:
        likes.remove(username)
    else:
        likes.append(username)
    card.likes = likes
    db.commit()
    db.refresh(card)
    col = db.get(models.Column, card.column_id)
    out = schemas.CardOut.model_validate(card)
    await manager.broadcast(col.board_id, "card_updated", out.model_dump(mode="json"))
    return out


@router.delete("/{card_id}", status_code=204)
async def delete_card(card_id: str, db: Session = Depends(get_db)):
    card = db.get(models.Card, card_id)
    if not card:
        raise HTTPException(404, "Card not found")
    col = db.get(models.Column, card.column_id)
    board_id = col.board_id
    db.delete(card)
    db.commit()
    await manager.broadcast(board_id, "card_deleted", {"id": card_id, "column_id": col.id})
