"""Сервисный слой для карточек: создание, массовая группировка и безопасный поиск."""

import uuid

import anyio
from fastapi import HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from app import models, schemas
from app.board_view import (
    card_broadcast_action,
    card_view,
    cards_hidden,
    require_cards_visible,
    visible_cards_sql_filter,
)
from app.database import release_connection
from app.services.boards import clear_deleted_groups_state
from app.services.common import BroadcastAction, dispatch_broadcasts, find_live_board
from app.utils import get_or_404, require_unlocked_board
from app.ws_manager import manager


def load_board_cards(
    db: Session,
    card_ids: list[str],
    workspace_id: str,
) -> tuple[models.Board, list[models.Card], dict[str, models.Column]]:
    """Загрузить уникальные карточки по ID и проверить общую незаблокированную доску."""
    unique_ids = list(dict.fromkeys(card_ids))
    cards = db.query(models.Card).filter(models.Card.id.in_(unique_ids)).all()
    by_id = {c.id: c for c in cards}
    ordered_cards = [by_id[cid] for cid in unique_ids if cid in by_id]
    if len(ordered_cards) != len(unique_ids):
        raise HTTPException(404, "Карточка не найдена")

    col_ids = {c.column_id for c in ordered_cards}
    cols = db.query(models.Column).filter(models.Column.id.in_(col_ids)).all()
    col_map = {col.id: col for col in cols}
    board_ids = {col.board_id for col in cols}
    if len(board_ids) != 1:
        raise HTTPException(400, "Карточки должны быть с одной доски")

    board_id = next(iter(board_ids))
    board = require_unlocked_board(
        db.get(models.Board, board_id), workspace_id, "Карточка не найдена"
    )
    return board, ordered_cards, col_map


def prune_empty_groups(db: Session, group_ids: set[str]) -> list[dict]:
    """Удалить опустевшие группы и вернуть payload для WebSocket `group_deleted`."""
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
                deleted_payloads.append(
                    {"id": gid, "column_id": col_id, "card_ids": []}
                )
    return deleted_payloads


def create_card_sync(
    db: Session,
    workspace_id: str,
    participant: models.Participant,
    *,
    column_id: str,
    text: str,
    color: str = "#FFFFFF",
) -> tuple[dict, list[BroadcastAction]]:
    """Создать карточку от имени участника в синхронной транзакции."""
    col = get_or_404(db, models.Column, column_id, "Колонка не найдена")
    board = require_unlocked_board(
        db.get(models.Board, col.board_id), workspace_id, "Колонка не найдена"
    )
    max_pos = (
        db.query(func.max(models.Card.position))
        .filter(models.Card.column_id == column_id)
        .scalar()
    )
    participant_id = participant.id
    card = models.Card(
        id=str(uuid.uuid4()),
        column_id=column_id,
        text=text,
        author=participant.name,
        author_id=participant_id,
        author_kind=participant.kind or "human",
        color=color,
        position=(max_pos if max_pos is not None else -1) + 1,
        likes=[],
    )
    db.add(card)
    db.commit()
    db.refresh(card)
    return card_view(card, board, participant_id), [
        card_broadcast_action(board, "card_created", card)
    ]


async def create_card_for_participant(
    db: Session,
    workspace_id: str,
    participant: models.Participant,
    *,
    column_id: str,
    text: str,
    color: str = "#FFFFFF",
) -> dict:
    """Создать карточку от имени участника (человека или агента) и разослать WS."""

    def _op():
        res = create_card_sync(
            db,
            workspace_id,
            participant,
            column_id=column_id,
            text=text,
            color=color,
        )
        release_connection(db)
        return res

    view, broadcasts = await anyio.to_thread.run_sync(_op)
    await dispatch_broadcasts(broadcasts)
    return view


def bulk_update_cards_sync(
    db: Session,
    workspace_id: str,
    participant: models.Participant,
    *,
    card_ids: list[str],
    provided_fields: set[str],
    column_id: str | None = None,
    group_title: str | None = None,
    group_id: str | None = None,
    color: str | None = None,
    require_visible_for_grouping: bool = False,
) -> tuple[list[dict], list[BroadcastAction]]:
    """Массово переместить/сгруппировать/перекрасить карточки (синхронная транзакция)."""
    board, cards, _col_map = load_board_cards(db, card_ids, workspace_id)
    if require_visible_for_grouping and (
        group_title is not None or "group_id" in provided_fields
    ):
        require_cards_visible(board)

    participant_id = participant.id
    touched_group_ids: set[str] = set()
    created_group: models.CardGroup | None = None

    if column_id is not None:
        target_col = get_or_404(db, models.Column, column_id, "Колонка не найдена")
        if target_col.board_id != board.id:
            raise HTTPException(400, "Колонка назначения принадлежит другой доске")
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

    if group_title is not None:
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
            title=group_title.strip() or "Новая группа",
            position=(max_gpos if max_gpos is not None else -1) + 1,
        )
        db.add(created_group)
        db.flush()
        for card in cards:
            if card.group_id and card.group_id != created_group.id:
                touched_group_ids.add(card.group_id)
            card.group_id = created_group.id
    elif "group_id" in provided_fields:
        if group_id:
            target_group = get_or_404(db, models.CardGroup, group_id, "Группа не найдена")
            target_group_col = db.get(models.Column, target_group.column_id)
            if not target_group_col or target_group_col.board_id != board.id:
                raise HTTPException(400, "Группа принадлежит другой доске")
            if any(c.column_id != target_group.column_id for c in cards):
                raise HTTPException(
                    400, "Карточки должны находиться в той же колонке, что и группа"
                )
        for card in cards:
            if card.group_id and card.group_id != group_id:
                touched_group_ids.add(card.group_id)
            card.group_id = group_id or None

    if color is not None:
        for card in cards:
            card.color = color

    db.flush()
    deleted_groups = prune_empty_groups(db, touched_group_ids)
    clear_deleted_groups_state(db, board.id, [p["id"] for p in deleted_groups], commit=False)
    db.commit()

    board_id = board.id
    broadcasts: list[BroadcastAction] = []
    if created_group is not None:
        db.refresh(created_group)
        group_payload = schemas.CardGroupOut.model_validate(created_group).model_dump(mode="json")

        async def _send_group(p=group_payload, bid=board_id) -> None:
            await manager.broadcast(bid, "group_created", p)

        broadcasts.append(_send_group)

    hidden = cards_hidden(board)
    results: list[dict] = []
    for card in cards:
        db.refresh(card)
        results.append(card_view(card, board, participant_id, hidden=hidden))
        broadcasts.append(card_broadcast_action(board, "card_updated", card))

    for deleted_payload in deleted_groups:

        async def _send_deleted(p=deleted_payload, bid=board_id) -> None:
            await manager.broadcast(bid, "group_deleted", p)

        broadcasts.append(_send_deleted)

    return results, broadcasts


async def bulk_update_cards_for_workspace(
    db: Session,
    workspace_id: str,
    participant: models.Participant,
    *,
    card_ids: list[str],
    provided_fields: set[str],
    column_id: str | None = None,
    group_title: str | None = None,
    group_id: str | None = None,
    color: str | None = None,
    require_visible_for_grouping: bool = False,
) -> list[dict]:
    """Массово переместить/сгруппировать/перекрасить карточки с WS-рассылкой."""

    def _op():
        res = bulk_update_cards_sync(
            db,
            workspace_id,
            participant,
            card_ids=card_ids,
            provided_fields=provided_fields,
            column_id=column_id,
            group_title=group_title,
            group_id=group_id,
            color=color,
            require_visible_for_grouping=require_visible_for_grouping,
        )
        release_connection(db)
        return res

    results, broadcasts = await anyio.to_thread.run_sync(_op)
    await dispatch_broadcasts(broadcasts)
    return results


def _escape_like(term: str) -> str:
    """Экранировать спецсимволы `LIKE` (`\\`, `%`, `_`) для поиска подстроки."""
    return term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def search_visible_cards(
    db: Session,
    workspace_id: str,
    viewer_id: str | None,
    *,
    query: str,
    board_id_or_slug: str | None = None,
    column_title: str | None = None,
    limit: int = 50,
    offset: int = 0,
) -> tuple[list[dict], int]:
    """SQL-поиск по тексту видимых карточек через `func.lower()` и пагинацией."""
    q = query.strip().lower()
    if not q:
        raise HTTPException(400, "Поисковый запрос не должен быть пустым")

    filters = [
        models.Board.deleted_at.is_(None),
        models.Board.workspace_id == workspace_id,
        func.lower(models.Card.text).like(f"%{_escape_like(q)}%", escape="\\"),
        visible_cards_sql_filter(viewer_id),
    ]
    if board_id_or_slug:
        board_filter = find_live_board(db, board_id_or_slug, workspace_id)
        filters.append(models.Board.id == board_filter.id)

    col_filter = column_title.strip().lower() if column_title else ""
    if col_filter:
        filters.append(
            func.lower(models.Column.title).like(
                f"%{_escape_like(col_filter)}%", escape="\\"
            )
        )

    total = (
        db.query(func.count(models.Card.id))
        .select_from(models.Card)
        .join(models.Column, models.Card.column_id == models.Column.id)
        .join(models.Board, models.Column.board_id == models.Board.id)
        .filter(*filters)
        .scalar()
        or 0
    )
    if total == 0 or offset >= total or limit <= 0:
        return [], total

    rows = (
        db.query(models.Card, models.Column, models.Board)
        .join(models.Column, models.Card.column_id == models.Column.id)
        .join(models.Board, models.Column.board_id == models.Board.id)
        .filter(*filters)
        .order_by(
            models.Board.created_at.desc(),
            models.Board.id.desc(),
            models.Column.position.asc(),
            models.Column.id.asc(),
            models.Card.position.asc(),
            models.Card.id.asc(),
        )
        .offset(offset)
        .limit(limit)
        .all()
    )

    matches: list[dict] = []
    for card, col, board in rows:
        view = card_view(card, board, viewer_id)
        if view["masked"]:
            continue
        matches.append(
            {
                **view,
                "board_id": board.id,
                "board_name": board.name,
                "board_slug": board.slug,
                "column_title": col.title,
            }
        )
    return matches, total
