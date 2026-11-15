"""Сервисный слой для карточек: создание, массовая группировка и безопасный поиск."""

import uuid

from fastapi import HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session, selectinload

from app import models, schemas
from app.board_view import (
    broadcast_card,
    card_view,
    cards_hidden,
    require_cards_visible,
)
from app.services.common import find_live_board
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
    col = get_or_404(db, models.Column, column_id, "Колонка не найдена")
    board = require_unlocked_board(
        db.get(models.Board, col.board_id), workspace_id, "Колонка не найдена"
    )
    max_pos = (
        db.query(func.max(models.Card.position))
        .filter(models.Card.column_id == column_id)
        .scalar()
    )
    card = models.Card(
        id=str(uuid.uuid4()),
        column_id=column_id,
        text=text,
        author=participant.name,
        author_id=participant.id,
        author_kind=participant.kind or "human",
        color=color,
        position=(max_pos if max_pos is not None else -1) + 1,
        likes=[],
    )
    db.add(card)
    db.commit()
    db.refresh(card)
    await broadcast_card(board, "card_created", card)
    return card_view(card, board, participant.id)


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
    board, cards, _col_map = load_board_cards(db, card_ids, workspace_id)
    if require_visible_for_grouping and (
        group_title is not None or "group_id" in provided_fields
    ):
        require_cards_visible(board)

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
    db.commit()

    if created_group is not None:
        db.refresh(created_group)
        group_out = schemas.CardGroupOut.model_validate(created_group)
        await manager.broadcast(
            board.id, "group_created", group_out.model_dump(mode="json")
        )

    results: list[dict] = []
    for card in cards:
        db.refresh(card)
        results.append(card_view(card, board, participant.id))
        await broadcast_card(board, "card_updated", card)

    for deleted_payload in deleted_groups:
        await manager.broadcast(board.id, "group_deleted", deleted_payload)

    return results


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
    """Поиск по тексту видимых карточек через Python `casefold()`.

    Поиск выполняется в Python (а не через SQL `LIKE`), чтобы поведение кириллицы
    было одинаковым на SQLite и PostgreSQL и чтобы скрытые нераскрытые карточки
    (`cards_hidden=True`, чужие) гарантированно не просачивались через поиск.
    """
    q = query.strip().casefold()
    if not q:
        raise HTTPException(400, "Поисковый запрос не должен быть пустым")

    load_options = (selectinload(models.Board.columns).selectinload(models.Column.cards),)
    if board_id_or_slug:
        boards = [
            find_live_board(
                db,
                board_id_or_slug,
                workspace_id,
                options=load_options,
            )
        ]
    else:
        boards = (
            db.query(models.Board)
            .options(*load_options)
            .filter(
                models.Board.deleted_at.is_(None),
                models.Board.workspace_id == workspace_id,
            )
            .order_by(models.Board.created_at.desc())
            .all()
        )

    col_filter = column_title.strip().casefold() if column_title else ""
    matches: list[dict] = []

    for board in boards:
        hidden = cards_hidden(board)
        for col in sorted(board.columns, key=lambda c: c.position):
            if col_filter and col_filter not in col.title.casefold():
                continue
            for card in sorted(col.cards, key=lambda c: c.position):
                view = card_view(card, board, viewer_id, hidden=hidden)
                if view["masked"]:
                    continue
                if q in view["text"].casefold():
                    matches.append(
                        {
                            **view,
                            "board_id": board.id,
                            "board_name": board.name,
                            "board_slug": board.slug,
                            "column_title": col.title,
                        }
                    )

    total = len(matches)
    return matches[offset : offset + limit], total
