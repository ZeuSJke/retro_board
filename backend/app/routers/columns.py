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


@router.post("/", response_model=schemas.ColumnOut, status_code=201)
@limiter.limit("30/minute")
async def create_column(
    request: Request,
    body: schemas.ColumnCreate,
    db: Session = Depends(get_db),
    workspace: models.Workspace = Depends(get_current_workspace),
):
    board = get_or_404(db, models.Board, body.board_id, "Board not found")
    if board.workspace_id != workspace.id:
        raise HTTPException(404, "Board not found")
    pos = db.query(func.count(models.Column.id)).filter(models.Column.board_id == body.board_id).scalar() or 0
    col = models.Column(
        id=str(uuid.uuid4()),
        board_id=body.board_id,
        title=body.title,
        color=body.color,
        position=pos,
    )
    db.add(col)
    db.commit()
    db.refresh(col)
    out = schemas.ColumnOut.model_validate(col)
    await manager.broadcast(body.board_id, "column_created", out.model_dump())
    return out


@router.patch("/{column_id}", response_model=schemas.ColumnOut)
@limiter.limit("30/minute")
async def update_column(
    request: Request,
    column_id: str,
    body: schemas.ColumnUpdate,
    db: Session = Depends(get_db),
    workspace: models.Workspace = Depends(get_current_workspace),
):
    col = get_or_404(db, models.Column, column_id, "Column not found")
    board = db.get(models.Board, col.board_id)
    if not board or board.workspace_id != workspace.id:
        raise HTTPException(404, "Column not found")
    if body.title is not None:
        col.title = body.title
    if body.color is not None:
        col.color = body.color
    if body.position is not None and body.position != col.position:
        siblings = (
            db.query(models.Column)
            .filter(models.Column.board_id == col.board_id, models.Column.id != col.id)
            .order_by(models.Column.position)
            .all()
        )
        siblings.insert(min(body.position, len(siblings)), col)
        for i, c in enumerate(siblings):
            c.position = i
    db.commit()
    db.refresh(col)
    out = schemas.ColumnOut.model_validate(col)
    await manager.broadcast(col.board_id, "column_updated", out.model_dump())
    return out


@router.delete("/{column_id}", status_code=204)
@limiter.limit("30/minute")
async def delete_column(
    request: Request,
    column_id: str,
    db: Session = Depends(get_db),
    workspace: models.Workspace = Depends(get_current_workspace),
):
    col = get_or_404(db, models.Column, column_id, "Column not found")
    board = db.get(models.Board, col.board_id)
    if not board or board.workspace_id != workspace.id:
        raise HTTPException(404, "Column not found")
    board_id = col.board_id
    db.delete(col)
    db.commit()
    await manager.broadcast(board_id, "column_deleted", {"id": column_id})
