import uuid
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app import models, schemas
from app.ws_manager import manager

router = APIRouter()


@router.post("/", response_model=schemas.ColumnOut, status_code=201)
async def create_column(body: schemas.ColumnCreate, db: Session = Depends(get_db)):
    board = db.get(models.Board, body.board_id)
    if not board:
        raise HTTPException(404, "Board not found")
    pos = len(board.columns)
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
async def update_column(column_id: str, body: schemas.ColumnUpdate, db: Session = Depends(get_db)):
    col = db.get(models.Column, column_id)
    if not col:
        raise HTTPException(404, "Column not found")
    if body.title is not None:
        col.title = body.title
    if body.color is not None:
        col.color = body.color
    if body.position is not None:
        col.position = body.position
    db.commit()
    db.refresh(col)
    out = schemas.ColumnOut.model_validate(col)
    await manager.broadcast(col.board_id, "column_updated", out.model_dump())
    return out


@router.delete("/{column_id}", status_code=204)
async def delete_column(column_id: str, db: Session = Depends(get_db)):
    col = db.get(models.Column, column_id)
    if not col:
        raise HTTPException(404, "Column not found")
    board_id = col.board_id
    db.delete(col)
    db.commit()
    await manager.broadcast(board_id, "column_deleted", {"id": column_id})
