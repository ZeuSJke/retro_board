import asyncio
import logging
import uuid
from types import SimpleNamespace
from typing import cast

import anyio
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import func
from sqlalchemy.orm import Session

from app import models, schemas
from app.ai.clustering import MAX_CARDS_FOR_CLUSTERING, cluster_cards
from app.board_view import (
    card_broadcast_action,
    card_view,
    cards_hidden,
    require_cards_visible,
)
from app.config import settings
from app.database import get_db, release_connection
from app.limiter import TEAM_WRITE_LIMIT, limiter
from app.services.boards import clear_deleted_groups_state
from app.services.cards import prune_empty_groups
from app.services.common import BroadcastAction, dispatch_broadcasts
from app.utils import get_or_404, require_unlocked_board
from app.workspace_auth import get_current_participant, get_current_workspace
from app.ws_manager import manager

logger = logging.getLogger(__name__)

router = APIRouter()


@router.post("/", response_model=schemas.CardGroupOut, status_code=201)
@limiter.limit(TEAM_WRITE_LIMIT)
async def create_group(
    request: Request,
    body: schemas.CardGroupCreate,
    db: Session = Depends(get_db),
    workspace: models.Workspace = Depends(get_current_workspace),
):
    workspace_id = workspace.id

    def _op():
        col = get_or_404(db, models.Column, body.column_id, "Колонка не найдена")
        require_unlocked_board(db.get(models.Board, col.board_id), workspace_id, "Колонка не найдена")
        max_pos = (
            db.query(func.max(models.CardGroup.position))
            .filter(models.CardGroup.column_id == body.column_id)
            .scalar()
        )
        group = models.CardGroup(
            id=str(uuid.uuid4()),
            column_id=body.column_id,
            title=body.title,
            # После последней, а не по количеству: счёт по количеству давал дубли после удалений
            position=(max_pos if max_pos is not None else -1) + 1,
        )
        db.add(group)
        db.commit()
        db.refresh(group)
        board_id = col.board_id
        out = schemas.CardGroupOut.model_validate(group)
        release_connection(db)
        return board_id, out

    board_id, out = await anyio.to_thread.run_sync(_op)
    await manager.broadcast(board_id, "group_created", out.model_dump(mode="json"))
    return out


@router.patch("/{group_id}", response_model=schemas.CardGroupOut)
@limiter.limit(TEAM_WRITE_LIMIT)
async def update_group(
    request: Request,
    group_id: str,
    body: schemas.CardGroupUpdate,
    db: Session = Depends(get_db),
    workspace: models.Workspace = Depends(get_current_workspace),
):
    workspace_id = workspace.id

    def _op():
        group = get_or_404(db, models.CardGroup, group_id, "Группа не найдена")
        col = get_or_404(db, models.Column, group.column_id, "Группа не найдена")
        require_unlocked_board(db.get(models.Board, col.board_id), workspace_id, "Группа не найдена")
        if body.title is not None:
            group.title = body.title
        db.commit()
        db.refresh(group)
        board_id = col.board_id
        out = schemas.CardGroupOut.model_validate(group)
        release_connection(db)
        return board_id, out

    board_id, out = await anyio.to_thread.run_sync(_op)
    await manager.broadcast(board_id, "group_updated", out.model_dump(mode="json"))
    return out


@router.delete("/{group_id}", status_code=204)
@limiter.limit(TEAM_WRITE_LIMIT)
async def delete_group(
    request: Request,
    group_id: str,
    db: Session = Depends(get_db),
    workspace: models.Workspace = Depends(get_current_workspace),
):
    workspace_id = workspace.id

    def _op():
        group = get_or_404(db, models.CardGroup, group_id, "Группа не найдена")
        col = get_or_404(db, models.Column, group.column_id, "Группа не найдена")
        require_unlocked_board(db.get(models.Board, col.board_id), workspace_id, "Группа не найдена")
        board_id = col.board_id
        col_id = group.column_id  # capture before deletion

        # Ungroup all cards in this group
        card_ids = []
        for card in db.query(models.Card).filter(models.Card.group_id == group_id).all():
            card.group_id = None
            card_ids.append(card.id)

        db.delete(group)
        db.flush()
        clear_deleted_groups_state(db, board_id, [group_id], commit=False)
        db.commit()
        release_connection(db)
        return board_id, col_id, card_ids

    board_id, col_id, card_ids = await anyio.to_thread.run_sync(_op)
    await manager.broadcast(
        board_id,
        "group_deleted",
        {"id": group_id, "column_id": col_id, "card_ids": card_ids},
    )


@router.post("/{group_id}/set_card/{card_id}", response_model=schemas.CardOut)
@limiter.limit(TEAM_WRITE_LIMIT)
async def set_card_group(
    request: Request,
    group_id: str,
    card_id: str,
    db: Session = Depends(get_db),
    workspace: models.Workspace = Depends(get_current_workspace),
    participant: models.Participant = Depends(get_current_participant),
):
    """Add a card to a group."""
    workspace_id = workspace.id
    participant_id = participant.id

    def _op():
        group = get_or_404(db, models.CardGroup, group_id, "Группа не найдена")
        col = get_or_404(db, models.Column, group.column_id, "Группа не найдена")
        board = require_unlocked_board(
            db.get(models.Board, col.board_id), workspace_id, "Группа не найдена"
        )
        card = get_or_404(db, models.Card, card_id, "Карточка не найдена")
        if card.column_id != group.column_id:
            raise HTTPException(400, "Карточка и группа должны быть в одной колонке")
        old_group_id = card.group_id
        card.group_id = group_id
        db.flush()
        deleted_groups: list[dict] = []
        if old_group_id and old_group_id != group_id:
            deleted_groups = prune_empty_groups(db, {old_group_id})
            clear_deleted_groups_state(
                db, col.board_id, [p["id"] for p in deleted_groups], commit=False
            )
        db.commit()
        db.refresh(card)
        view = card_view(card, board, participant_id)
        board_id = col.board_id
        broadcasts = [card_broadcast_action(board, "card_updated", card)]
        for deleted_payload in deleted_groups:

            async def _send_grp_del(p=deleted_payload, bid=board_id) -> None:
                await manager.broadcast(bid, "group_deleted", p)

            broadcasts.append(_send_grp_del)
        release_connection(db)
        return view, broadcasts

    view, broadcasts = await anyio.to_thread.run_sync(_op)
    await dispatch_broadcasts(broadcasts)
    return view


@router.patch("/{group_id}/move", response_model=schemas.CardGroupOut)
@limiter.limit(TEAM_WRITE_LIMIT)
async def move_group(
    request: Request,
    group_id: str,
    body: schemas.GroupMove,
    db: Session = Depends(get_db),
    workspace: models.Workspace = Depends(get_current_workspace),
):
    """Move a group (and all its cards) to a different column."""
    workspace_id = workspace.id

    def _op():
        group = get_or_404(db, models.CardGroup, group_id, "Группа не найдена")
        col = get_or_404(db, models.Column, group.column_id, "Группа не найдена")
        board = require_unlocked_board(
            db.get(models.Board, col.board_id), workspace_id, "Группа не найдена"
        )
        old_col = col
        new_col = get_or_404(db, models.Column, body.column_id, "Колонка не найдена")
        if old_col.board_id != new_col.board_id:
            raise HTTPException(400, "Колонки должны быть на одной доске")

        old_column_id = group.column_id
        group.column_id = body.column_id

        cards = db.query(models.Card).filter(models.Card.group_id == group_id).all()
        for card in cards:
            card.column_id = body.column_id
        db.commit()
        db.refresh(group)

        group_out = schemas.CardGroupOut.model_validate(group)
        group_data = group_out.model_dump(mode="json")
        # Снимаем значения до close() — избегаем N+2 lazy SELECT внутри broadcast_each
        hidden = cards_hidden(board)
        board_snap = SimpleNamespace(
            id=board.id,
            active_phase=board.active_phase,
            hide_cards_until_reveal=board.hide_cards_until_reveal,
            cards_revealed=board.cards_revealed,
            anonymous_votes=board.anonymous_votes,
        )
        card_snaps = [
            SimpleNamespace(
                id=c.id,
                column_id=c.column_id,
                group_id=c.group_id,
                position=c.position,
                created_at=c.created_at,
                text=c.text,
                author=c.author,
                author_id=c.author_id,
                author_kind=c.author_kind,
                color=c.color,
                likes=list(c.likes or []),
            )
            for c in cards
        ]
        board_id = board.id
        release_connection(db)
        return group_out, group_data, old_column_id, board_id, board_snap, card_snaps, hidden

    group_out, group_data, old_column_id, board_id, board_snap, card_snaps, hidden = (
        await anyio.to_thread.run_sync(_op)
    )
    await manager.broadcast_each(
        board_id,
        "group_moved",
        lambda viewer_id: {
            "group": group_data,
            "old_column_id": old_column_id,
            "cards": [
                card_view(
                    cast(models.Card, c),
                    cast(models.Board, board_snap),
                    viewer_id,
                    hidden,
                )
                for c in card_snaps
            ],
        },
    )
    return group_out


@router.delete("/{group_id}/remove_card/{card_id}", response_model=schemas.CardOut)
@limiter.limit(TEAM_WRITE_LIMIT)
async def remove_card_from_group(
    request: Request,
    group_id: str,
    card_id: str,
    db: Session = Depends(get_db),
    workspace: models.Workspace = Depends(get_current_workspace),
    participant: models.Participant = Depends(get_current_participant),
):
    """Remove a card from its group. Auto-deletes the group if it becomes empty."""
    workspace_id = workspace.id
    participant_id = participant.id

    def _op():
        card = get_or_404(db, models.Card, card_id, "Карточка не найдена")
        col = get_or_404(db, models.Column, card.column_id, "Карточка не найдена")
        board = require_unlocked_board(
            db.get(models.Board, col.board_id), workspace_id, "Карточка не найдена"
        )
        if card.group_id != group_id:
            raise HTTPException(400, "Карточка не входит в эту группу")
        card.group_id = None
        db.flush()
        deleted_groups = prune_empty_groups(db, {group_id})
        clear_deleted_groups_state(db, col.board_id, [p["id"] for p in deleted_groups], commit=False)
        db.commit()
        db.refresh(card)
        view = card_view(card, board, participant_id)
        board_id = col.board_id
        broadcasts = [card_broadcast_action(board, "card_updated", card)]
        for deleted_payload in deleted_groups:

            async def _send_grp_del(p=deleted_payload, bid=board_id) -> None:
                await manager.broadcast(bid, "group_deleted", p)

            broadcasts.append(_send_grp_del)
        release_connection(db)
        return view, broadcasts

    view, broadcasts = await anyio.to_thread.run_sync(_op)
    await dispatch_broadcasts(broadcasts)
    return view


def _unlocked_column(
    db: Session, column_id: str, workspace_id: str
) -> tuple[models.Column, models.Board]:
    col = get_or_404(db, models.Column, column_id, "Колонка не найдена")
    board = require_unlocked_board(
        db.get(models.Board, col.board_id), workspace_id, "Колонка не найдена"
    )
    return col, board


async def _compute_column_clusters(
    column_id: str,
    db: Session,
    workspace_id: str,
) -> dict:
    """Validate column, check AI config, and compute clustering suggestions without persisting.

    Соединение с БД на время вызова модели возвращается в пул: объекты сессии
    после этого отсоединены, поэтому вызывающий код перечитывает колонку сам.
    """
    if not settings.ai_configured:
        raise HTTPException(503, "AI-сервис не настроен")

    def _collect() -> list[dict]:
        _col, board = _unlocked_column(db, column_id, workspace_id)
        # Группировка читает тексты всех карточек колонки — до раскрытия она выдала бы скрытое
        require_cards_visible(board)

        ungrouped_cards = (
            db.query(models.Card)
            .filter(
                models.Card.column_id == column_id,
                models.Card.group_id.is_(None),
            )
            .all()
        )

        if len(ungrouped_cards) < 2:
            raise HTTPException(400, "Недостаточно негруппированных карточек (минимум 2)")

        if len(ungrouped_cards) > MAX_CARDS_FOR_CLUSTERING:
            raise HTTPException(
                400,
                f"Слишком много карточек ({len(ungrouped_cards)}). "
                f"Максимум {MAX_CARDS_FOR_CLUSTERING} для автоматической кластеризации.",
            )

        cards_data = [{"id": c.id, "text": c.text} for c in ungrouped_cards]
        release_connection(db)
        return cards_data

    cards_data = await anyio.to_thread.run_sync(_collect)
    try:
        result = await asyncio.to_thread(cluster_cards, cards_data)
    except Exception as e:
        logger.error("AI clustering failed for column %s: %s", column_id, type(e).__name__)
        raise HTTPException(503, "AI-сервис временно недоступен") from e
    return result


def _apply_groups_to_column_sync(
    column_id: str,
    workspace_id: str,
    groups_spec: list[dict],
    ungrouped_ids: list[str] | None,
    username: str | None,
    participant_id: str | None,
    db: Session,
):
    """Проверить видимость и записать предложенные кластеры в БД (в worker-потоке)."""
    col, board = _unlocked_column(db, column_id, workspace_id)
    require_cards_visible(board)
    if ungrouped_ids is None:
        all_ungrouped = (
            db.query(models.Card.id)
            .filter(models.Card.column_id == col.id, models.Card.group_id.is_(None))
            .all()
        )
        ungrouped_pool = {row[0] for row in all_ungrouped}
        grouped_requested = {cid for g in groups_spec for cid in g["card_ids"]}
        ungrouped_ids = sorted(ungrouped_pool - grouped_requested)

    created_groups: list[schemas.ClusterGroupInfo] = []
    board_id = col.board_id
    assigned_ids: set[str] = set()

    max_group_pos = (
        db.query(func.max(models.CardGroup.position))
        .filter(models.CardGroup.column_id == col.id)
        .scalar()
    )
    group_pos = (max_group_pos if max_group_pos is not None else -1) + 1

    for g in groups_spec:
        candidate_cards = [
            card
            for cid in g["card_ids"]
            if cid not in assigned_ids
            and (card := db.get(models.Card, cid)) is not None
            and card.column_id == col.id
            and card.group_id is None
        ]
        if len(candidate_cards) < 2:
            continue

        group = models.CardGroup(
            id=str(uuid.uuid4()),
            column_id=col.id,
            title=g["title"].strip() or "Группа",
            position=group_pos,
        )
        db.add(group)
        db.flush()
        group_pos += 1

        valid_card_ids: list[str] = []
        for card in candidate_cards:
            card.group_id = group.id
            assigned_ids.add(card.id)
            valid_card_ids.append(card.id)

        group_out = schemas.CardGroupOut.model_validate(group)
        created_groups.append(
            schemas.ClusterGroupInfo(group=group_out, card_ids=valid_card_ids)
        )

    db.commit()

    broadcasts: list[BroadcastAction] = []
    for cg in created_groups:
        grp_payload = cg.group.model_dump(mode="json")

        async def _send_grp(p=grp_payload, bid=board_id) -> None:
            await manager.broadcast(bid, "group_created", p)

        broadcasts.append(_send_grp)
        for card_id in cg.card_ids:
            card = db.get(models.Card, card_id)
            if card:
                db.refresh(card)
                broadcasts.append(card_broadcast_action(board, "card_updated", card))

    done_payload = {
        "column_id": col.id,
        "groups_count": len(created_groups),
        "username": username,
        # Инициатора клиенты узнают по идентификатору: тёзки не путаются
        "participant_id": participant_id,
    }

    async def _send_done() -> None:
        await manager.broadcast(board_id, "auto_cluster_completed", done_payload)

    broadcasts.append(_send_done)
    release_connection(db)
    return (
        schemas.AutoClusterResult(
            created_groups=created_groups,
            ungrouped_card_ids=ungrouped_ids,
        ),
        broadcasts,
    )


@router.post("/auto-cluster", response_model=schemas.AutoClusterResult)
@limiter.limit("5/minute")
async def auto_cluster(
    request: Request,
    body: schemas.AutoClusterRequest,
    db: Session = Depends(get_db),
    workspace: models.Workspace = Depends(get_current_workspace),
    participant: models.Participant = Depends(get_current_participant),
):
    """AI-кластеризация негруппированных карточек в колонке."""
    workspace_id = workspace.id
    username = participant.name
    participant_id = participant.id
    result = await _compute_column_clusters(body.column_id, db, workspace_id)
    # Пока модель думала, колонку могли удалить, а доску — заблокировать или скрыть карточки
    res, broadcasts = await anyio.to_thread.run_sync(
        _apply_groups_to_column_sync,
        body.column_id,
        workspace_id,
        result["groups"],
        result["ungrouped"],
        username,
        participant_id,
        db,
    )
    await dispatch_broadcasts(broadcasts)
    return res


@router.post("/auto-cluster-preview", response_model=schemas.ClusterPreviewResult)
@limiter.limit("5/minute")
async def auto_cluster_preview(
    request: Request,
    body: schemas.AutoClusterRequest,
    db: Session = Depends(get_db),
    workspace: models.Workspace = Depends(get_current_workspace),
):
    """Preview AI clustering groups for a column without writing to DB."""
    result = await _compute_column_clusters(body.column_id, db, workspace.id)
    return schemas.ClusterPreviewResult(
        column_id=body.column_id,
        groups=[
            schemas.ClusterPreviewGroup(title=g["title"], card_ids=g["card_ids"])
            for g in result["groups"]
        ],
        ungrouped_card_ids=result["ungrouped"],
    )


@router.post("/apply-clusters", response_model=schemas.AutoClusterResult)
@limiter.limit("15/minute")
async def apply_clusters(
    request: Request,
    body: schemas.ApplyClustersRequest,
    db: Session = Depends(get_db),
    workspace: models.Workspace = Depends(get_current_workspace),
    participant: models.Participant = Depends(get_current_participant),
):
    """Persist user-reviewed AI cluster groups for a column."""
    groups_spec = [{"title": g.title, "card_ids": g.card_ids} for g in body.groups]
    res, broadcasts = await anyio.to_thread.run_sync(
        _apply_groups_to_column_sync,
        body.column_id,
        workspace.id,
        groups_spec,
        None,
        participant.name,
        participant.id,
        db,
    )
    await dispatch_broadcasts(broadcasts)
    return res
