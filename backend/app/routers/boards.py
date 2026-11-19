import asyncio
import logging
import uuid
from datetime import UTC, datetime
from typing import Optional

import anyio
from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app import health as health_mod
from app import models, schemas, themes
from app.ai.prompts.summary_generation import generate_summary
from app.ai.prompts.workspace_insights import generate_workspace_insights
from app.board_view import (
    board_settings_payload,
    board_view,
    cards_hidden,
    mood_broadcast_action,
    mood_view,
    require_cards_visible,
    require_moderator,
)
from app.database import get_db, release_connection
from app.limiter import TEAM_BULK_LIMIT, TEAM_READ_LIMIT, TEAM_WRITE_LIMIT, limiter
from app.models import now_utc
from app.services import boards as boards_service
from app.services.ai_settings import is_ai_configured
from app.services.boards import BOARD_TEMPLATES
from app.services.common import dispatch_broadcasts, find_live_board
from app.utils import get_or_404, require_live_board, require_unlocked_board
from app.workspace_auth import get_current_participant, get_current_workspace
from app.ws_manager import manager

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/templates", response_model=list[schemas.BoardTemplateInfo])
@limiter.limit(TEAM_READ_LIMIT)
def list_templates(
    request: Request,
    workspace: models.Workspace = Depends(get_current_workspace),
):
    """Список доступных шаблонов ретроспективы."""
    return [
        schemas.BoardTemplateInfo(
            id=tpl["id"],
            name=tpl["name"],
            description=tpl["description"],
            columns=[schemas.ColumnSeed(**col) for col in tpl["columns"]],
        )
        for tpl in BOARD_TEMPLATES
    ]


@router.get("/mood-trends", response_model=list[schemas.MoodTrendPoint])
@limiter.limit(TEAM_READ_LIMIT)
def get_mood_trends(
    request: Request,
    db: Session = Depends(get_db),
    workspace: models.Workspace = Depends(get_current_workspace),
):
    """Динамика настроения, карточек и выполнения задач по всем доскам команды."""
    return boards_service.get_mood_trends(db, workspace.id)


@router.post("/workspace-insights", response_model=schemas.WorkspaceInsightsOut)
@limiter.limit("15/minute")
async def get_workspace_insights(
    request: Request,
    db: Session = Depends(get_db),
    workspace: models.Workspace = Depends(get_current_workspace),
):
    """Кросс-спринт анализ последних ретроспектив команды."""
    workspace_id = workspace.id

    def _collect_snapshot() -> tuple[list[dict], list[dict] | None]:
        boards = (
            db.query(models.Board)
            .options(
                selectinload(models.Board.columns).selectinload(models.Column.cards),
                selectinload(models.Board.action_items),
                selectinload(models.Board.summaries),
                selectinload(models.Board.moods),
            )
            .filter(
                models.Board.deleted_at.is_(None),
                models.Board.workspace_id == workspace_id,
            )
            .order_by(models.Board.created_at.desc())
            .limit(8)
            .all()
        )
        board_ids = [b.id for b in boards]
        health_by_board: dict[str, dict[str, tuple[float, int]]] = {}
        if board_ids:
            h_rows = (
                db.query(
                    models.BoardHealthAnswer.board_id,
                    models.BoardHealthAnswer.question,
                    func.avg(models.BoardHealthAnswer.value),
                    func.count(models.BoardHealthAnswer.id),
                )
                .filter(models.BoardHealthAnswer.board_id.in_(board_ids))
                .group_by(models.BoardHealthAnswer.board_id, models.BoardHealthAnswer.question)
                .all()
            )
            for bid, question, average, cnt in h_rows:
                health_by_board.setdefault(bid, {})[question] = (
                    round(float(average), 2),
                    int(cnt),
                )

        snapshot: list[dict] = []
        for board in reversed(boards):
            all_cards = [c for col in board.columns for c in col.cards]
            top_cards = sorted(
                all_cards, key=lambda c: len(c.likes or []), reverse=True
            )[:5]
            live_items = [item for item in board.action_items if item.superseded_by_id is None]
            open_count = sum(1 for item in live_items if item.status != "done")
            done_count = sum(1 for item in live_items if item.status == "done")
            mood_scores = [m.score for m in board.moods]
            mood_avg = (
                round(sum(mood_scores) / len(mood_scores), 2) if mood_scores else None
            )
            h_answers = health_by_board.get(board.id, {})
            health_metrics = {
                k: h_answers[k][0] for k in health_mod.QUESTION_KEYS if k in h_answers
            }
            health_avg = (
                round(sum(health_metrics.values()) / len(health_metrics), 2)
                if health_metrics
                else None
            )
            roti_entry = h_answers.get(health_mod.ROTI_KEY)
            roti_avg = roti_entry[0] if roti_entry else None
            roti_count = roti_entry[1] if roti_entry else 0
            latest_summary = board.summaries[0] if board.summaries else None
            snapshot.append(
                {
                    "name": board.name,
                    "health_avg": health_avg,
                    "health_metrics": health_metrics,
                    "roti_avg": roti_avg,
                    "roti_count": roti_count,
                    "mood_avg": mood_avg,
                    "cards_count": len(all_cards),
                    "action_items_open": open_count,
                    "action_items_done": done_count,
                    "summary_themes": latest_summary.key_themes if latest_summary else [],
                    # Пока карточки доски скрыты, их тексты не попадают и в аналитику
                    "top_cards": [] if cards_hidden(board) else [c.text for c in top_cards],
                }
            )

        # Повторяющиеся темы считаем по списку тем команды, а не спрашиваем у модели
        theme_counters = themes.themes_for_insights(db, workspace_id)
        # Снимок собран — соединение на время вызова модели не держим
        release_connection(db)
        return snapshot, theme_counters

    snapshot, theme_counters = await anyio.to_thread.run_sync(_collect_snapshot)
    result = await asyncio.to_thread(
        generate_workspace_insights, snapshot, theme_counters
    )
    return schemas.WorkspaceInsightsOut(**result)


@router.get("/themes", response_model=list[schemas.WorkspaceThemeOut])
@limiter.limit(TEAM_READ_LIMIT)
def list_workspace_themes(
    request: Request,
    db: Session = Depends(get_db),
    workspace: models.Workspace = Depends(get_current_workspace),
):
    """Темы команды: на скольких досках названы и сколько досок подряд поднимаются."""
    return themes.list_workspace_themes(db, workspace.id)


@router.get("/", response_model=list[schemas.BoardListItem])
@limiter.limit(TEAM_READ_LIMIT)
def list_boards(
    request: Request,
    response: Response,
    limit: Optional[int] = Query(default=None, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    workspace: models.Workspace = Depends(get_current_workspace),
):
    items, total = boards_service.list_workspace_boards(
        db, workspace.id, limit=limit, offset=offset
    )
    response.headers["X-Total-Count"] = str(total)
    return items


@router.post("/", response_model=schemas.BoardOut, status_code=201)
@limiter.limit("30/minute")
async def create_board(
    request: Request,
    body: schemas.BoardCreate,
    db: Session = Depends(get_db),
    workspace: models.Workspace = Depends(get_current_workspace),
    participant: models.Participant = Depends(get_current_participant),
):
    return await boards_service.create_board_for_workspace(
        db, workspace.id, participant, body
    )


@router.get("/by-slug/{slug}", response_model=schemas.BoardOut)
@limiter.limit(TEAM_READ_LIMIT)
def get_board_by_slug(
    request: Request,
    slug: str,
    db: Session = Depends(get_db),
    workspace: models.Workspace = Depends(get_current_workspace),
    participant: models.Participant = Depends(get_current_participant),
):
    return boards_service.get_board_view(
        db,
        workspace.id,
        participant.id,
        slug,
        lookup="slug",
    )


@router.get("/{board_id}", response_model=schemas.BoardOut)
@limiter.limit(TEAM_READ_LIMIT)
def get_board(
    request: Request,
    board_id: str,
    db: Session = Depends(get_db),
    workspace: models.Workspace = Depends(get_current_workspace),
    participant: models.Participant = Depends(get_current_participant),
):
    return boards_service.get_board_view(
        db,
        workspace.id,
        participant.id,
        board_id,
        lookup="id",
    )


@router.patch("/{board_id}", response_model=schemas.BoardOut)
@limiter.limit("30/minute")
async def update_board(
    request: Request,
    board_id: str,
    body: schemas.BoardUpdate,
    db: Session = Depends(get_db),
    workspace: models.Workspace = Depends(get_current_workspace),
    participant: models.Participant = Depends(get_current_participant),
):
    workspace_id = workspace.id
    participant_id = participant.id
    seq_before = manager.current_seq(board_id)

    def _op() -> tuple[dict, bool, bool, bool, dict | None]:
        board = get_or_404(db, models.Board, board_id, "Доска не найдена")
        require_live_board(board, workspace_id)
        was_hidden = cards_hidden(board)
        was_anonymous = board.anonymous_votes
        # Скрытый сбор, анонимность и блокировку меняет только модератор
        changes_lock = body.is_locked is not None and body.is_locked != board.is_locked
        if changes_lock:
            require_moderator(
                board,
                participant,
                "Блокировать и разблокировать доску может создатель доски или ведущий",
            )
        changes_privacy = (
            (
                body.hide_cards_until_reveal is not None
                and body.hide_cards_until_reveal != board.hide_cards_until_reveal
            )
            or (
                body.anonymous_votes is not None
                and body.anonymous_votes != board.anonymous_votes
            )
            or bool(body.reset_cards_revealed)
        )
        if changes_privacy:
            require_moderator(
                board,
                participant,
                "Скрытый сбор и анонимный режим меняет создатель доски или ведущий",
            )
        if body.name is not None:
            existing = (
                db.query(models.Board)
                .filter(
                    models.Board.name == body.name,
                    models.Board.id != board_id,
                    models.Board.deleted_at.is_(None),
                    models.Board.workspace_id == workspace_id,
                )
                .first()
            )
            if existing:
                raise HTTPException(409, "Измени название, такая доска уже есть")
            # Адрес доски при переименовании не меняется: ссылки, которые уже
            # разослали команде, должны продолжать работать.
            board.name = body.name
        if body.max_votes is not None:
            board.max_votes = body.max_votes
        if body.is_locked is not None:
            board.is_locked = body.is_locked
        if body.hide_cards_until_reveal is not None:
            if body.hide_cards_until_reveal and not board.hide_cards_until_reveal:
                # Скрытый сбор включили заново — начинается новый сбор
                board.cards_revealed = False
            board.hide_cards_until_reveal = body.hide_cards_until_reveal
        if body.reset_cards_revealed and board.hide_cards_until_reveal:
            board.cards_revealed = False
        if body.anonymous_votes is not None:
            board.anonymous_votes = body.anonymous_votes
        if body.allow_multiple_votes_per_card is not None:
            board.allow_multiple_votes_per_card = body.allow_multiple_votes_per_card
        try:
            db.commit()
        except IntegrityError as err:
            db.rollback()
            raise HTTPException(409, "Измени название, такая доска уже есть") from err
        board = boards_service.board_query(db).filter(models.Board.id == board.id).first() or board
        identity_hidden = bool(board.anonymous_votes or cards_hidden(board))
        visibility_changed = cards_hidden(board) != was_hidden or board.anonymous_votes != was_anonymous
        payload = board_settings_payload(board)
        view = board_view(board, participant_id, event_seq=seq_before)
        release_connection(db)
        return view, identity_hidden, visibility_changed, True, payload

    async with manager.board_lock(board_id):
        view, identity_hidden, visibility_changed, _ok, payload = await anyio.to_thread.run_sync(_op)
        # Признак ставится до рассылок: между ними цикл событий успевает обработать чужой ввод
        manager.set_identity_hidden(board_id, identity_hidden)
    assert payload is not None
    await manager.broadcast_workspace(
        workspace_id, "board_updated", payload, exclude_board_id=board_id
    )
    await manager.broadcast(board_id, "board_updated", payload)
    # Скрытие и анонимность меняют то, что сервер отдаёт каждому получателю:
    # клиенты перечитывают доску.
    if visibility_changed:
        await manager.broadcast(board_id, "cards_visibility_changed", {})
    return view


@router.post("/{board_id}/reveal", response_model=schemas.BoardOut)
@limiter.limit("30/minute")
async def reveal_cards(
    request: Request,
    board_id: str,
    db: Session = Depends(get_db),
    workspace: models.Workspace = Depends(get_current_workspace),
    participant: models.Participant = Depends(get_current_participant),
):
    """Раскрыть карточки скрытого сбора вне сессии ведущего.

    В сессии карточки раскрывает ведущий переходом из фазы «Штурм».
    """
    workspace_id = workspace.id
    participant_id = participant.id
    seq_before = manager.current_seq(board_id)

    def _op() -> tuple[dict, bool, dict | None, bool]:
        board = boards_service.board_query(db).filter(models.Board.id == board_id).first()
        # Раскрытие не меняет содержимое, поэтому блокировка доски ему не мешает
        require_live_board(board, workspace_id)
        assert board is not None
        if board.active_phase is not None:
            raise HTTPException(409, "Идёт сессия ведущего: карточки раскрывает он")
        require_moderator(board, participant, "Раскрыть карточки может создатель доски")
        did_reveal = False
        payload: dict | None = None
        if not board.cards_revealed:
            board.cards_revealed = True
            db.commit()
            board = boards_service.board_query(db).filter(models.Board.id == board_id).first() or board
            did_reveal = True
            payload = board_settings_payload(board)
        identity_hidden = bool(board.anonymous_votes or cards_hidden(board))
        view = board_view(board, participant_id, event_seq=seq_before)
        release_connection(db)
        return view, identity_hidden, payload, did_reveal

    async with manager.board_lock(board_id):
        view, identity_hidden, payload, did_reveal = await anyio.to_thread.run_sync(_op)
        if did_reveal and payload is not None:
            manager.set_identity_hidden(board_id, identity_hidden)
    if did_reveal and payload is not None:
        await manager.broadcast_workspace(
            workspace_id, "board_updated", payload, exclude_board_id=board_id
        )
        await manager.broadcast(board_id, "board_updated", payload)
        await manager.broadcast(board_id, "cards_visibility_changed", {})
    return view


@router.delete("/{board_id}", status_code=204)
@limiter.limit("30/minute")
async def delete_board(
    request: Request,
    board_id: str,
    db: Session = Depends(get_db),
    workspace: models.Workspace = Depends(get_current_workspace),
    participant: models.Participant = Depends(get_current_participant),
):
    from app.routers.websocket import cancel_board_summary_tasks

    workspace_id = workspace.id

    def _op() -> None:
        board = get_or_404(db, models.Board, board_id, "Доска не найдена")
        if board.workspace_id != workspace_id or board.deleted_at is not None:
            raise HTTPException(404, "Доска не найдена")
        require_moderator(board, participant, "Удалить доску может её создатель или ведущий")
        # Уникальность name/slug задана частичным индексом `WHERE deleted_at IS NULL`,
        # поэтому при мягком удалении исходные имя и slug сохраняются.
        board.deleted_at = datetime.now(UTC)
        db.commit()
        release_connection(db)

    await anyio.to_thread.run_sync(_op)
    cancel_board_summary_tasks(board_id)
    await manager.cleanup_board(board_id)
    await manager.broadcast_workspace(
        workspace_id,
        "board_deleted",
        {"id": board_id},
    )


# ── Summary Endpoints ────────────────────────────────────────────────────────


@router.post("/{board_id}/mood", response_model=schemas.BoardMoodOut)
@limiter.limit(TEAM_WRITE_LIMIT)
async def upsert_mood(
    request: Request,
    board_id: str,
    body: schemas.BoardMoodCreate,
    db: Session = Depends(get_db),
    workspace: models.Workspace = Depends(get_current_workspace),
    participant: models.Participant = Depends(get_current_participant),
):
    """Сохранить или обновить оценку настроения участника сессии для доски."""
    workspace_id = workspace.id
    participant_id = participant.id
    participant_name = participant.name

    def _op():
        board = find_live_board(db, board_id, workspace_id, lookup="id")

        def _apply() -> models.BoardMood:
            existing_mood = (
                db.query(models.BoardMood)
                .filter(
                    models.BoardMood.board_id == board.id,
                    models.BoardMood.participant_id == participant_id,
                )
                .first()
            )
            if existing_mood:
                existing_mood.score = body.score
                existing_mood.note = body.note
                existing_mood.author = participant_name
                existing_mood.created_at = now_utc()
                return existing_mood
            created = models.BoardMood(
                id=str(uuid.uuid4()),
                board_id=board.id,
                author=participant_name,
                participant_id=participant_id,
                score=body.score,
                note=body.note,
            )
            db.add(created)
            return created

        mood = _apply()
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            board = find_live_board(db, board_id, workspace_id, lookup="id")
            mood = _apply()
            db.commit()
        db.refresh(mood)
        view = mood_view(mood, board, participant_id)
        send_mood = mood_broadcast_action(board, mood)
        release_connection(db)
        return view, send_mood

    view, send_mood = await anyio.to_thread.run_sync(_op)
    await send_mood()
    return view


@router.get("/{board_id}/summary", response_model=schemas.BoardSummaryOut)
@limiter.limit(TEAM_READ_LIMIT)
def get_summary(
    request: Request,
    board_id: str,
    db: Session = Depends(get_db),
    workspace: models.Workspace = Depends(get_current_workspace),
):
    """Get the latest summary for a board.

    Returns the most recent summary for the current or last session.
    """
    return boards_service.get_board_summary_for_workspace(
        db, workspace.id, board_id, lookup="id"
    )


@router.post("/{board_id}/summary/regenerate", response_model=schemas.BoardSummaryOut)
@limiter.limit("10/minute")
async def regenerate_summary(
    request: Request,
    board_id: str,
    db: Session = Depends(get_db),
    workspace: models.Workspace = Depends(get_current_workspace),
):
    """Принудительно перегенерировать AI-резюме для доски."""
    workspace_pk = workspace.id

    def _prepare() -> tuple[str, dict]:
        board = find_live_board(db, board_id, workspace_pk, lookup="id")
        if not is_ai_configured(db=db):
            raise HTTPException(503, "AI сервис не настроен")
        require_cards_visible(board)
        board_data = boards_service.get_board_full_data(db, board.id, workspace_pk)
        if not board_data:
            raise HTTPException(404, "Доска не найдена")
        board_pk = board.id
        # Данные прочитаны — соединение на время вызова модели не держим
        release_connection(db)
        return board_pk, board_data

    board_pk, board_data = await anyio.to_thread.run_sync(_prepare)

    try:
        ai_result = await asyncio.to_thread(generate_summary, board_data)
    except Exception as exc:
        logger.exception("Manual summary regeneration failed for board %s: %s", board_pk, exc)
        raise HTTPException(502, "Не удалось сгенерировать AI-резюме") from exc

    # Пока модель думала, доску могли удалить или снова скрыть карточки — перечитываем
    def _save_sync():
        board = find_live_board(db, board_pk, workspace_pk, lookup="id")
        require_cards_visible(board)
        res = boards_service.persist_board_summary_sync(
            db,
            board,
            workspace_pk,
            summary_text=ai_result.get("summary_text", ""),
            themes_payload=ai_result.get("themes") or [],
            key_themes=ai_result.get("key_themes") or [],
            recommendations=ai_result.get("recommendations") or [],
            update_latest_when_no_session=False,
        )
        release_connection(db)
        return res

    out, broadcasts = await anyio.to_thread.run_sync(_save_sync)
    await dispatch_broadcasts(broadcasts)
    return out


@router.post("/{board_id}/reset-votes", response_model=schemas.BoardVotesResetOut)
@limiter.limit(TEAM_BULK_LIMIT)
async def reset_user_votes(
    request: Request,
    board_id: str,
    db: Session = Depends(get_db),
    workspace: models.Workspace = Depends(get_current_workspace),
    participant: models.Participant = Depends(get_current_participant),
):
    """Снять все голоса участника сессии на доске. Чужие голоса сбросить нельзя."""
    from app.board_view import card_broadcast_action

    workspace_id = workspace.id
    participant_id = participant.id
    participant_name = participant.name

    def _op():
        board = require_unlocked_board(db.get(models.Board, board_id), workspace_id, "Доска не найдена")
        cards = (
            db.query(models.Card)
            .join(models.Column, models.Card.column_id == models.Column.id)
            .filter(models.Column.board_id == board.id)
            .all()
        )
        changed_cards: list[models.Card] = []
        for card in cards:
            likes = list(card.likes or [])
            if participant_id in likes:
                card.likes = [voter for voter in likes if voter != participant_id]
                changed_cards.append(card)
        broadcasts = []
        if changed_cards:
            db.commit()
            for card in changed_cards:
                db.refresh(card)
                broadcasts.append(card_broadcast_action(board, "card_updated", card))
        resolved_board_id = board.id
        release_connection(db)
        return resolved_board_id, len(changed_cards), broadcasts

    resolved_board_id, updated_cards, broadcasts = await anyio.to_thread.run_sync(_op)
    await dispatch_broadcasts(broadcasts)
    return schemas.BoardVotesResetOut(
        board_id=resolved_board_id,
        username=participant_name,
        updated_cards=updated_cards,
    )
