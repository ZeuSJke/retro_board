import uuid
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app.database import get_db
from app import models, schemas
from app.ws_manager import manager
from app.limiter import limiter

router = APIRouter()


@router.get("/", response_model=list[schemas.ActionItemOut])
@limiter.limit("30/minute")
async def list_action_items(request: Request, board_id: str, db: Session = Depends(get_db)):
    board = db.get(models.Board, board_id)
    if not board:
        raise HTTPException(404, "Board not found")
    items = (
        db.query(models.ActionItem)
        .filter(models.ActionItem.board_id == board_id)
        .order_by(models.ActionItem.created_at)
        .all()
    )
    return [schemas.ActionItemOut.model_validate(i) for i in items]


@router.post("/", response_model=schemas.ActionItemOut, status_code=201)
@limiter.limit("30/minute")
async def create_action_item(request: Request, body: schemas.ActionItemCreate, db: Session = Depends(get_db)):
    board = db.get(models.Board, body.board_id)
    if not board:
        raise HTTPException(404, "Board not found")
    item = models.ActionItem(
        id=str(uuid.uuid4()),
        board_id=body.board_id,
        text=body.text,
        assignee=body.assignee,
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    out = schemas.ActionItemOut.model_validate(item)
    await manager.broadcast(body.board_id, "action_item_created", out.model_dump(mode="json"))
    return out


@router.patch("/{item_id}", response_model=schemas.ActionItemOut)
@limiter.limit("30/minute")
async def update_action_item(request: Request, item_id: str, body: schemas.ActionItemUpdate, db: Session = Depends(get_db)):
    item = db.get(models.ActionItem, item_id)
    if not item:
        raise HTTPException(404, "Action item not found")
    if body.text is not None:
        item.text = body.text
    if "assignee" in body.model_fields_set:
        item.assignee = body.assignee
    db.commit()
    db.refresh(item)
    out = schemas.ActionItemOut.model_validate(item)
    await manager.broadcast(item.board_id, "action_item_updated", out.model_dump(mode="json"))
    return out


@router.delete("/{item_id}", status_code=204)
@limiter.limit("30/minute")
async def delete_action_item(request: Request, item_id: str, db: Session = Depends(get_db)):
    item = db.get(models.ActionItem, item_id)
    if not item:
        raise HTTPException(404, "Action item not found")
    board_id = item.board_id
    db.delete(item)
    db.commit()
    await manager.broadcast(board_id, "action_item_deleted", {"id": item_id, "board_id": board_id})
