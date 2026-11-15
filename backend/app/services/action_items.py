"""Сервисный слой для задач (action items): перенос, выборки, создание и обновление."""

import uuid

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app import models, schemas
from app.database import release_connection
from app.models import now_utc
from app.services.common import (
    BoardLookupMode,
    BroadcastAction,
    apply_board_lookup,
    dispatch_broadcasts,
    find_live_board,
)
from app.utils import get_or_404, require_live_board
from app.ws_manager import manager

_LOCKED_ACTION_ITEM_FIELDS = frozenset({"title", "text", "assignee"})


def copy_unresolved_action_items(
    db: Session,
    source_board_id: str,
    target_board_id: str,
    item_ids: list[str] | None = None,
) -> tuple[list[schemas.ActionItemOut], list[schemas.ActionItemOut]]:
    """Перенести нерешённые задачи со старой доски на целевую (без commit).

    На целевой доске появляется копия, а оригинал помечается перенесённым
    (`superseded_by_id`): он остаётся в истории своей доски, но больше не
    считается открытым — иначе одна задача считалась бы дважды. Уже
    перенесённые задачи повторно не переносятся.
    """
    query = db.query(models.ActionItem).filter(
        models.ActionItem.board_id == source_board_id,
        models.ActionItem.status != "done",
        models.ActionItem.superseded_by_id.is_(None),
    )
    if item_ids is not None:
        query = query.filter(models.ActionItem.id.in_(item_ids))
    items = query.order_by(models.ActionItem.created_at).all()
    created: list[schemas.ActionItemOut] = []
    carried: list[schemas.ActionItemOut] = []
    for src in items:
        new_item = models.ActionItem(
            id=str(uuid.uuid4()),
            board_id=target_board_id,
            title=src.title,
            text=src.text,
            assignee=src.assignee,
            external_url=src.external_url,
            source_card_ids=list(src.source_card_ids or []),
            status=src.status,
        )
        db.add(new_item)
        db.flush()
        src.superseded_by_id = new_item.id
        db.flush()
        db.refresh(new_item)
        db.refresh(src)
        created.append(schemas.ActionItemOut.model_validate(new_item))
        carried.append(schemas.ActionItemOut.model_validate(src))
    return created, carried


def list_workspace_action_items(
    db: Session,
    workspace_id: str,
    *,
    status: str | None = None,
    board_id_or_slug: str | None = None,
    assignee: str | None = None,
    include_carried: bool = False,
    limit: int | None = None,
    offset: int = 0,
    lookup: BoardLookupMode = "id_or_slug",
) -> tuple[list[schemas.DashboardActionItem], int]:
    """Вернуть задачи команды с фильтрами и опциональной пагинацией."""
    q = (
        db.query(models.ActionItem, models.Board.name)
        .join(models.Board, models.ActionItem.board_id == models.Board.id)
        .filter(
            models.Board.deleted_at.is_(None),
            models.Board.workspace_id == workspace_id,
        )
    )
    if not include_carried:
        q = q.filter(models.ActionItem.superseded_by_id.is_(None))
    if status:
        q = q.filter(models.ActionItem.status == status)
    if board_id_or_slug:
        if lookup == "id_or_slug":
            matched_board_id = (
                apply_board_lookup(
                    db.query(models.Board.id),
                    board_id_or_slug,
                    workspace_id,
                    lookup="id_or_slug",
                )
                .limit(1)
                .scalar()
            )
            if matched_board_id is None:
                return [], 0
            q = q.filter(models.Board.id == matched_board_id)
        elif lookup == "id":
            q = q.filter(models.Board.id == board_id_or_slug)
        elif lookup == "slug":
            q = q.filter(models.Board.slug == board_id_or_slug)
    if assignee:
        q = q.filter(models.ActionItem.assignee == assignee)

    total = q.count()
    ordered = q.order_by(
        models.ActionItem.created_at.desc(), models.ActionItem.id.desc()
    )
    if offset:
        ordered = ordered.offset(offset)
    if limit is not None:
        ordered = ordered.limit(limit)
    rows = ordered.all()

    items = [
        schemas.DashboardActionItem(
            **schemas.ActionItemOut.model_validate(item).model_dump(),
            board_name=board_name,
        )
        for item, board_name in rows
    ]
    return items, total


def create_action_item_sync(
    db: Session,
    workspace_id: str,
    *,
    board_id_or_slug: str,
    title: str,
    text: str,
    assignee: str | None = None,
    external_url: str | None = None,
    source_card_ids: list[str] | None = None,
    status: str = "open",
    require_unlocked: bool = False,
) -> tuple[schemas.ActionItemOut, list[BroadcastAction]]:
    """Создать задачу на доске (по ID или slug) в синхронной транзакции."""
    board = find_live_board(
        db, board_id_or_slug, workspace_id, require_unlocked=require_unlocked
    )
    board_id = board.id
    card_ids = list(source_card_ids or [])
    if card_ids:
        valid_cards = (
            db.query(models.Card.id)
            .join(models.Column, models.Card.column_id == models.Column.id)
            .filter(
                models.Column.board_id == board_id,
                models.Card.id.in_(card_ids),
            )
            .all()
        )
        valid_ids = {row[0] for row in valid_cards}
        invalid_ids = set(card_ids) - valid_ids
        if invalid_ids:
            raise HTTPException(
                400,
                f"Некорректные source_card_ids: {', '.join(sorted(invalid_ids))}",
            )

    item = models.ActionItem(
        id=str(uuid.uuid4()),
        board_id=board_id,
        title=title,
        text=text,
        assignee=assignee,
        external_url=external_url,
        source_card_ids=card_ids,
        status=status,
        completed_at=now_utc() if status == "done" else None,
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    out = schemas.ActionItemOut.model_validate(item)
    payload = out.model_dump(mode="json")

    async def _send() -> None:
        await manager.broadcast(board_id, "action_item_created", payload)

    return out, [_send]


async def create_action_item_for_workspace(
    db: Session,
    workspace_id: str,
    *,
    board_id_or_slug: str,
    title: str,
    text: str,
    assignee: str | None = None,
    external_url: str | None = None,
    source_card_ids: list[str] | None = None,
    status: str = "open",
    require_unlocked: bool = False,
) -> schemas.ActionItemOut:
    """Создать задачу на доске (по ID или slug) и разослать событие по WebSocket."""
    out, broadcasts = create_action_item_sync(
        db,
        workspace_id,
        board_id_or_slug=board_id_or_slug,
        title=title,
        text=text,
        assignee=assignee,
        external_url=external_url,
        source_card_ids=source_card_ids,
        status=status,
        require_unlocked=require_unlocked,
    )
    release_connection(db)
    await dispatch_broadcasts(broadcasts)
    return out


def update_action_item_sync(
    db: Session,
    workspace_id: str,
    *,
    item_id: str,
    provided_fields: set[str],
    title: str | None = None,
    text: str | None = None,
    assignee: str | None = None,
    external_url: str | None = None,
    status: str | None = None,
    restrict_locked_fields: bool = False,
) -> tuple[schemas.ActionItemOut, list[BroadcastAction]]:
    """Обновить задачу в синхронной транзакции."""
    item = get_or_404(db, models.ActionItem, item_id, "Задача не найдена")
    board = require_live_board(
        db.get(models.Board, item.board_id), workspace_id, "Задача не найдена"
    )
    if item.superseded_by_id is not None:
        raise HTTPException(409, "Перенесённую задачу нельзя изменять")
    if restrict_locked_fields and board.is_locked:
        forbidden = _LOCKED_ACTION_ITEM_FIELDS & provided_fields
        if forbidden:
            raise HTTPException(
                423,
                "Доска заблокирована: можно менять только status и external_url задачи",
            )

    if "title" in provided_fields and title is not None:
        item.title = title
    if "text" in provided_fields and text is not None:
        item.text = text
    if "assignee" in provided_fields:
        item.assignee = assignee
    if "external_url" in provided_fields:
        item.external_url = external_url
    if "status" in provided_fields and status is not None:
        item.status = status
        item.completed_at = now_utc() if status == "done" else None

    board_id = item.board_id
    db.commit()
    db.refresh(item)
    out = schemas.ActionItemOut.model_validate(item)
    payload = out.model_dump(mode="json")

    async def _send() -> None:
        await manager.broadcast(board_id, "action_item_updated", payload)

    return out, [_send]


async def update_action_item_for_workspace(
    db: Session,
    workspace_id: str,
    *,
    item_id: str,
    provided_fields: set[str],
    title: str | None = None,
    text: str | None = None,
    assignee: str | None = None,
    external_url: str | None = None,
    status: str | None = None,
    restrict_locked_fields: bool = False,
) -> schemas.ActionItemOut:
    """Обновить задачу и разослать `action_item_updated` по WebSocket."""
    out, broadcasts = update_action_item_sync(
        db,
        workspace_id,
        item_id=item_id,
        provided_fields=provided_fields,
        title=title,
        text=text,
        assignee=assignee,
        external_url=external_url,
        status=status,
        restrict_locked_fields=restrict_locked_fields,
    )
    release_connection(db)
    await dispatch_broadcasts(broadcasts)
    return out
