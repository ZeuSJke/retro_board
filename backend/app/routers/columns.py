import uuid

import anyio
from fastapi import APIRouter, Depends, Request
from sqlalchemy import func
from sqlalchemy.orm import Session

from app import models, schemas
from app.board_view import require_moderator
from app.database import get_db, release_connection
from app.limiter import limiter
from app.services.boards import clear_deleted_groups_state
from app.utils import get_or_404, require_unlocked_board
from app.workspace_auth import get_current_participant, get_current_workspace
from app.ws_manager import manager

router = APIRouter()


@router.post("/", response_model=schemas.ColumnOut, status_code=201)
@limiter.limit("30/minute")
async def create_column(
    request: Request,
    body: schemas.ColumnCreate,
    db: Session = Depends(get_db),
    workspace: models.Workspace = Depends(get_current_workspace),
):
    workspace_id = workspace.id

    def _op():
        board = get_or_404(db, models.Board, body.board_id, "Доска не найдена")
        require_unlocked_board(board, workspace_id)
        max_pos = (
            db.query(func.max(models.Column.position))
            .filter(models.Column.board_id == body.board_id)
            .scalar()
        )
        # После последней, а не по количеству: счёт по количеству давал дубли после удалений
        pos = (max_pos if max_pos is not None else -1) + 1
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
        info = schemas.ColumnInfo.model_validate(col)
        release_connection(db)
        return info

    info = await anyio.to_thread.run_sync(_op)
    await manager.broadcast(body.board_id, "column_created", info.model_dump())
    # Новая колонка пуста: отдаём её с пустыми списками карточек и групп
    return schemas.ColumnOut(**info.model_dump(), cards=[], groups=[])


@router.patch("/{column_id}", response_model=schemas.ColumnInfo)
@limiter.limit("30/minute")
async def update_column(
    request: Request,
    column_id: str,
    body: schemas.ColumnUpdate,
    db: Session = Depends(get_db),
    workspace: models.Workspace = Depends(get_current_workspace),
):
    workspace_id = workspace.id

    def _op():
        col = get_or_404(db, models.Column, column_id, "Колонка не найдена")
        require_unlocked_board(db.get(models.Board, col.board_id), workspace_id, "Колонка не найдена")
        if body.title is not None:
            col.title = body.title
        if body.color is not None:
            col.color = body.color
        if body.position is not None:
            # Место — номер в списке колонок. Сохранённые позиции после удалений идут
            # с пропусками, поэтому сравнивать запрос с ними нельзя: колонки каждый раз
            # перенумеровываются подряд.
            siblings = (
                db.query(models.Column)
                .filter(models.Column.board_id == col.board_id, models.Column.id != col.id)
                .order_by(models.Column.position, models.Column.id)
                .all()
            )
            siblings.insert(min(body.position, len(siblings)), col)
            for i, c in enumerate(siblings):
                if c.position != i:
                    c.position = i
        db.commit()
        db.refresh(col)
        # Только свойства колонки: карточки приходят своими событиями и собираются
        # отдельно для каждого получателя, целиком их сюда класть нельзя.
        out = schemas.ColumnInfo.model_validate(col)
        release_connection(db)
        return out

    out = await anyio.to_thread.run_sync(_op)
    await manager.broadcast(out.board_id, "column_updated", out.model_dump())
    return out


@router.delete("/{column_id}", status_code=204)
@limiter.limit("30/minute")
async def delete_column(
    request: Request,
    column_id: str,
    db: Session = Depends(get_db),
    workspace: models.Workspace = Depends(get_current_workspace),
    participant: models.Participant = Depends(get_current_participant),
):
    workspace_id = workspace.id

    def _op() -> str:
        col = get_or_404(db, models.Column, column_id, "Колонка не найдена")
        board = require_unlocked_board(
            db.get(models.Board, col.board_id), workspace_id, "Колонка не найдена"
        )
        # Удаление колонки стирает все её карточки — это действие создателя доски или ведущего
        if col.cards:
            require_moderator(
                board, participant, "Удалить колонку с карточками может создатель доски или ведущий"
            )
        board_id = col.board_id
        deleted_group_ids = [g.id for g in col.groups]
        db.delete(col)
        db.flush()
        clear_deleted_groups_state(db, board_id, deleted_group_ids, commit=False)
        db.commit()
        release_connection(db)
        return board_id

    board_id = await anyio.to_thread.run_sync(_op)
    await manager.broadcast(board_id, "column_deleted", {"id": column_id})
