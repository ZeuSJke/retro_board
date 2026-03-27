import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.orm import Session

from app.database import get_db
from app import models, schemas
from app.models import now_utc
from app.utils import get_or_404
from app.ws_manager import manager
from app.limiter import limiter

router = APIRouter()


@router.get("/all", response_model=list[schemas.DashboardActionItem])
@limiter.limit("30/minute")
async def list_all_action_items(
    request: Request,
    status: Optional[str] = None,
    board_id: Optional[str] = None,
    assignee: Optional[str] = None,
    db: Session = Depends(get_db),
):
    """List action items across all boards with optional filters."""
    q = db.query(models.ActionItem, models.Board.name).join(
        models.Board, models.ActionItem.board_id == models.Board.id
    )
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


@router.post("/carry-forward", response_model=list[schemas.ActionItemOut], status_code=201)
@limiter.limit("10/minute")
async def carry_forward(request: Request, body: schemas.CarryForwardRequest, db: Session = Depends(get_db)):
    """Copy unresolved action items from source board to target board."""
    get_or_404(db, models.Board, body.source_board_id, "Source board not found")
    get_or_404(db, models.Board, body.target_board_id, "Target board not found")

    items = (
        db.query(models.ActionItem)
        .filter(
            models.ActionItem.board_id == body.source_board_id,
            models.ActionItem.status != "done",
        )
        .order_by(models.ActionItem.created_at)
        .all()
    )

    created = []
    for src in items:
        new_item = models.ActionItem(
            id=str(uuid.uuid4()),
            board_id=body.target_board_id,
            title=src.title,
            text=src.text,
            assignee=src.assignee,
            status="open",
        )
        db.add(new_item)
        db.flush()
        db.refresh(new_item)
        out = schemas.ActionItemOut.model_validate(new_item)
        created.append(out)
    db.commit()

    for out in created:
        await manager.broadcast(body.target_board_id, "action_item_created", out.model_dump(mode="json"))

    return created


@router.get("/", response_model=list[schemas.ActionItemOut])
@limiter.limit("30/minute")
async def list_action_items(request: Request, board_id: str, db: Session = Depends(get_db)):
    get_or_404(db, models.Board, board_id, "Board not found")
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
    get_or_404(db, models.Board, body.board_id, "Board not found")
    item = models.ActionItem(
        id=str(uuid.uuid4()),
        board_id=body.board_id,
        title=body.title,
        text=body.text,
        assignee=body.assignee,
        status=body.status,
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
    item = get_or_404(db, models.ActionItem, item_id, "Action item not found")
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
    await manager.broadcast(item.board_id, "action_item_updated", out.model_dump(mode="json"))
    return out


@router.delete("/{item_id}", status_code=204)
@limiter.limit("30/minute")
async def delete_action_item(request: Request, item_id: str, db: Session = Depends(get_db)):
    item = get_or_404(db, models.ActionItem, item_id, "Action item not found")
    board_id = item.board_id
    db.delete(item)
    db.commit()
    await manager.broadcast(board_id, "action_item_deleted", {"id": item_id, "board_id": board_id})
