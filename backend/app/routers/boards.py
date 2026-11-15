import asyncio
import logging
import uuid
from datetime import datetime, UTC

from fastapi import APIRouter, Depends, HTTPException, Request
from slugify import slugify
from sqlalchemy import and_, case, exists, func, or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app.ai.prompts.summary_generation import generate_summary
from app.ai.prompts.workspace_insights import generate_workspace_insights
from app.board_view import (
    ANON_AUTHOR,
    board_settings_payload,
    board_view,
    broadcast_card,
    broadcast_mood,
    cards_hidden,
    mood_view,
    require_cards_visible,
    require_moderator,
)
from app.config import settings
from app.database import get_db, release_connection
from app import models, schemas
from app import themes
from app.limiter import TEAM_BULK_LIMIT, TEAM_READ_LIMIT, TEAM_WRITE_LIMIT, limiter
from app.models import now_utc
from app.routers.action_items import copy_unresolved_action_items
from app.utils import get_or_404, require_live_board, require_unlocked_board
from app.workspace_auth import get_current_participant, get_current_workspace
from app.ws_manager import manager

logger = logging.getLogger(__name__)

router = APIRouter()

DEFAULT_COLUMNS = [
    {"title": "😊 Что хорошо", "color": "#006E1C"},
    {"title": "😟 Что улучшить", "color": "#BA1A1A"},
    {"title": "💡 Идеи", "color": "#E8760A"},
]

BOARD_TEMPLATES: list[dict] = [
    {
        "id": "classic",
        "name": "Классическое ретро",
        "description": "Три базовые колонки: что прошло хорошо, что улучшить и идеи",
        "columns": DEFAULT_COLUMNS,
    },
    {
        "id": "start_stop_continue",
        "name": "Start / Stop / Continue",
        "description": "Фокус на действиях: что начать, что прекратить и что продолжать",
        "columns": [
            {"title": "🚀 Start (Начать)", "color": "#006E1C"},
            {"title": "🛑 Stop (Прекратить)", "color": "#BA1A1A"},
            {"title": "🔁 Continue (Продолжать)", "color": "#6750A4"},
        ],
    },
    {
        "id": "4ls",
        "name": "4Ls (Liked / Learned / Lacked / Longed for)",
        "description": "Глубокий разбор эмоций, инсайтов и ожиданий команды",
        "columns": [
            {"title": "❤️ Liked (Понравилось)", "color": "#006E1C"},
            {"title": "🎓 Learned (Узнали)", "color": "#00639B"},
            {"title": "🔍 Lacked (Не хватило)", "color": "#E8760A"},
            {"title": "✨ Longed for (Хочется)", "color": "#6750A4"},
        ],
    },
    {
        "id": "sailboat",
        "name": "Парусник (Sailboat)",
        "description": "Метафора пути команды: ветер, якоря, рифы и цель",
        "columns": [
            {"title": "💨 Ветер (Двигает вперёд)", "color": "#006E1C"},
            {"title": "⚓ Якорь (Тормозит)", "color": "#E8760A"},
            {"title": "🪨 Рифы (Риски)", "color": "#BA1A1A"},
            {"title": "🏝️ Цель (Остров)", "color": "#6750A4"},
        ],
    },
    {
        "id": "mad_sad_glad",
        "name": "Mad / Sad / Glad",
        "description": "Эмоциональный срез спринта: что злит, грустит и радует",
        "columns": [
            {"title": "😠 Mad (Злит)", "color": "#BA1A1A"},
            {"title": "😔 Sad (Грустно)", "color": "#00639B"},
            {"title": "😄 Glad (Радует)", "color": "#006E1C"},
        ],
    },
    {
        "id": "empty",
        "name": "Пустая доска",
        "description": "Чистый холст — добавьте собственные колонки вручную",
        "columns": [],
    },
]

_TEMPLATE_MAP: dict[str, dict] = {tpl["id"]: tpl for tpl in BOARD_TEMPLATES}


# Адрес /board/start фронтенд использует как «открыть первую доску»
_RESERVED_SLUGS = frozenset({"start"})


def _make_slug(name: str) -> str:
    slug = slugify(name, max_length=80, word_boundary=True)
    if not slug:
        return f"board-{uuid.uuid4().hex[:8]}"
    if slug in _RESERVED_SLUGS:
        return f"{slug}-{uuid.uuid4().hex[:6]}"
    return slug


def _resolve_unique_slug(
    db: Session,
    name: str,
    workspace_id: str,
    exclude_board_id: str | None = None,
) -> str:
    base = _make_slug(name)
    candidate = base
    for _ in range(5):
        q = db.query(models.Board.id).filter(
            models.Board.slug == candidate,
            models.Board.deleted_at.is_(None),
            models.Board.workspace_id == workspace_id,
        )
        if exclude_board_id:
            q = q.filter(models.Board.id != exclude_board_id)
        if not q.first():
            return candidate
        candidate = f"{base[:72]}-{uuid.uuid4().hex[:6]}"
    return f"board-{uuid.uuid4().hex[:10]}"


def _board_card_counts(db: Session, board_ids: list[str]) -> dict[str, int]:
    if not board_ids:
        return {}
    rows = (
        db.query(models.Column.board_id, func.count(models.Card.id))
        .join(models.Card, models.Card.column_id == models.Column.id)
        .filter(models.Column.board_id.in_(board_ids))
        .group_by(models.Column.board_id)
        .all()
    )
    return {board_id: count for board_id, count in rows}


def _board_mood_stats(db: Session, board_ids: list[str]) -> dict[str, tuple[float | None, int]]:
    if not board_ids:
        return {}
    rows = (
        db.query(
            models.BoardMood.board_id,
            func.avg(models.BoardMood.score),
            func.count(models.BoardMood.id),
        )
        .filter(models.BoardMood.board_id.in_(board_ids))
        .group_by(models.BoardMood.board_id)
        .all()
    )
    return {
        board_id: (round(float(avg_val), 2) if avg_val is not None else None, cnt)
        for board_id, avg_val, cnt in rows
    }


def _find_live_board(
    db: Session, board_id_or_slug: str, workspace_id: str
) -> models.Board:
    board = (
        db.query(models.Board)
        .filter(
            or_(
                models.Board.id == board_id_or_slug,
                models.Board.slug == board_id_or_slug,
            ),
            models.Board.deleted_at.is_(None),
            models.Board.workspace_id == workspace_id,
        )
        .first()
    )
    require_live_board(board, workspace_id)
    assert board is not None
    return board


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
    boards = (
        db.query(models.Board)
        .filter(
            models.Board.deleted_at.is_(None),
            models.Board.workspace_id == workspace.id,
        )
        .order_by(models.Board.created_at)
        .all()
    )
    board_ids = [b.id for b in boards]
    card_counts = _board_card_counts(db, board_ids)
    mood_stats = _board_mood_stats(db, board_ids)

    action_stats: dict[str, tuple[int, int]] = {}
    if board_ids:
        action_rows = (
            db.query(
                models.ActionItem.board_id,
                func.count(models.ActionItem.id),
                func.count(case((models.ActionItem.status == "done", 1))),
            )
            .filter(
                models.ActionItem.board_id.in_(board_ids),
                # Перенесённая задача считается там, куда её перенесли
                models.ActionItem.superseded_by_id.is_(None),
            )
            .group_by(models.ActionItem.board_id)
            .all()
        )
        action_stats = {bid: (total, done) for bid, total, done in action_rows}

    points: list[schemas.MoodTrendPoint] = []
    for board in boards:
        mood_avg, mood_count = mood_stats.get(board.id, (None, 0))
        ai_total, ai_done = action_stats.get(board.id, (0, 0))
        points.append(
            schemas.MoodTrendPoint(
                board_id=board.id,
                board_name=board.name,
                created_at=board.created_at,
                mood_avg=mood_avg,
                mood_count=mood_count,
                cards_count=card_counts.get(board.id, 0),
                action_items_total=ai_total,
                action_items_done=ai_done,
            )
        )
    return points


@router.post("/workspace-insights", response_model=schemas.WorkspaceInsightsOut)
@limiter.limit("15/minute")
async def get_workspace_insights(
    request: Request,
    db: Session = Depends(get_db),
    workspace: models.Workspace = Depends(get_current_workspace),
):
    """Кросс-спринт анализ последних ретроспектив команды."""
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
            models.Board.workspace_id == workspace.id,
        )
        .order_by(models.Board.created_at.desc())
        .limit(8)
        .all()
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
        latest_summary = board.summaries[0] if board.summaries else None
        snapshot.append(
            {
                "name": board.name,
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
    theme_counters = themes.themes_for_insights(db, workspace.id)

    # Снимок собран — соединение на время вызова модели не держим
    release_connection(db)
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
    db: Session = Depends(get_db),
    workspace: models.Workspace = Depends(get_current_workspace),
):
    rows = (
        db.query(
            models.Board,
            func.count(func.distinct(models.ActionItem.id)).label(
                "action_items_total"
            ),
            func.count(
                func.distinct(
                    case(
                        (
                            and_(
                                models.ActionItem.status != "done",
                                models.ActionItem.superseded_by_id.is_(None),
                            ),
                            models.ActionItem.id,
                        )
                    )
                )
            ).label("action_items_open"),
            exists()
            .where(models.BoardSummary.board_id == models.Board.id)
            .label("has_summary"),
        )
        .outerjoin(
            models.ActionItem, models.ActionItem.board_id == models.Board.id
        )
        .filter(
            models.Board.deleted_at.is_(None),
            models.Board.workspace_id == workspace.id,
        )
        .group_by(models.Board.id)
        .order_by(models.Board.created_at.desc())
        .all()
    )
    board_ids = [board.id for board, _, _, _ in rows]
    card_counts = _board_card_counts(db, board_ids)
    mood_stats = _board_mood_stats(db, board_ids)

    result = []
    for board, total, open_count, has_summary in rows:
        item = schemas.BoardListItem.model_validate(board)
        item.action_items_total = total
        item.action_items_open = open_count
        item.has_summary = bool(has_summary)
        item.cards_count = card_counts.get(board.id, 0)
        mood_avg, mood_count = mood_stats.get(board.id, (None, 0))
        item.mood_avg = mood_avg
        item.mood_count = mood_count
        result.append(item)
    return result


@router.post("/", response_model=schemas.BoardOut, status_code=201)
@limiter.limit("30/minute")
async def create_board(
    request: Request,
    body: schemas.BoardCreate,
    db: Session = Depends(get_db),
    workspace: models.Workspace = Depends(get_current_workspace),
    participant: models.Participant = Depends(get_current_participant),
):
    existing = (
        db.query(models.Board)
        .filter(
            models.Board.name == body.name,
            models.Board.deleted_at.is_(None),
            models.Board.workspace_id == workspace.id,
        )
        .first()
    )
    if existing:
        raise HTTPException(409, "Измени название, такая доска уже есть")

    src_board: models.Board | None = None
    if body.source_board_id:
        src_board = (
            db.query(models.Board)
            .options(selectinload(models.Board.columns))
            .filter(
                models.Board.id == body.source_board_id,
                models.Board.deleted_at.is_(None),
                models.Board.workspace_id == workspace.id,
            )
            .first()
        )
        if not src_board:
            raise HTTPException(404, "Исходная доска не найдена")

    if body.template == "copy":
        if src_board is None:
            raise HTTPException(400, "Укажите исходную доску для копирования")
        columns_spec = [
            {"title": col.title, "color": col.color}
            for col in sorted(src_board.columns, key=lambda c: c.position)
        ]
    elif body.template == "custom":
        columns_spec = [
            {"title": col.title, "color": col.color}
            for col in (body.custom_columns or [])
        ]
    elif body.template in _TEMPLATE_MAP:
        columns_spec = _TEMPLATE_MAP[body.template]["columns"]
    else:
        raise HTTPException(400, f"Неизвестный шаблон доски: {body.template}")

    slug = _resolve_unique_slug(db, body.name, workspace.id)
    uid = str(uuid.uuid4())
    board = models.Board(
        id=uid,
        name=body.name,
        slug=slug,
        max_votes=body.max_votes,
        template=body.template,
        hide_cards_until_reveal=body.hide_cards_until_reveal,
        anonymous_votes=body.anonymous_votes,
        allow_multiple_votes_per_card=body.allow_multiple_votes_per_card,
        workspace_id=workspace.id,
        created_by_id=participant.id,
    )
    db.add(board)
    try:
        db.flush()
    except IntegrityError as err:
        db.rollback()
        raise HTTPException(409, "Измени название, такая доска уже есть") from err

    for i, col in enumerate(columns_spec):
        db.add(
            models.Column(
                id=str(uuid.uuid4()),
                board_id=board.id,
                title=col["title"],
                color=col["color"],
                position=i,
            )
        )

    carried_count = 0
    if body.carry_forward_items:
        carry_src_id = src_board.id if src_board else None
        if carry_src_id is None:
            prev_board = (
                db.query(models.Board.id)
                .filter(
                    models.Board.workspace_id == workspace.id,
                    models.Board.deleted_at.is_(None),
                    models.Board.id != board.id,
                )
                .order_by(models.Board.created_at.desc())
                .first()
            )
            carry_src_id = prev_board[0] if prev_board else None
        if carry_src_id:
            carried, _superseded = copy_unresolved_action_items(db, carry_src_id, board.id)
            carried_count = len(carried)

    db.commit()
    board = _board_query(db).filter(models.Board.id == board.id).first() or board
    list_item = schemas.BoardListItem.model_validate(board)
    list_item.action_items_total = carried_count
    list_item.action_items_open = carried_count
    await manager.broadcast_workspace(
        workspace.id,
        "board_created",
        list_item.model_dump(mode="json"),
    )
    return board_view(board, participant.id)


def _board_query(db: Session):
    """Board query with eager-loaded columns → cards + groups + moods (avoids N+1)."""
    return db.query(models.Board).options(
        selectinload(models.Board.columns).selectinload(models.Column.cards),
        selectinload(models.Board.columns).selectinload(models.Column.groups),
        selectinload(models.Board.moods),
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
    # Сначала узнаём идентификатор и номер последнего события, потом читаем доску:
    # иначе событие, случившееся между чтением строк и чтением номера, потерялось бы.
    board_id = (
        db.query(models.Board.id)
        .filter(
            models.Board.slug == slug,
            models.Board.deleted_at.is_(None),
            models.Board.workspace_id == workspace.id,
        )
        .scalar()
    )
    if not board_id:
        raise HTTPException(404, "Доска не найдена")
    seq_before = manager.current_seq(board_id)
    board = _board_query(db).filter(models.Board.id == board_id).first()
    if not board or board.deleted_at is not None:
        raise HTTPException(404, "Доска не найдена")
    return board_view(board, participant.id, event_seq=seq_before)


@router.get("/{board_id}", response_model=schemas.BoardOut)
@limiter.limit(TEAM_READ_LIMIT)
def get_board(
    request: Request,
    board_id: str,
    db: Session = Depends(get_db),
    workspace: models.Workspace = Depends(get_current_workspace),
    participant: models.Participant = Depends(get_current_participant),
):
    # Номер читается до доски — см. get_board_by_slug
    seq_before = manager.current_seq(board_id)
    board = (
        _board_query(db)
        .filter(
            models.Board.id == board_id,
            models.Board.deleted_at.is_(None),
            models.Board.workspace_id == workspace.id,
        )
        .first()
    )
    if not board:
        raise HTTPException(404, "Доска не найдена")
    return board_view(board, participant.id, event_seq=seq_before)


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
    board = get_or_404(db, models.Board, board_id, "Доска не найдена")
    require_live_board(board, workspace.id)
    was_hidden = cards_hidden(board)
    was_anonymous = board.anonymous_votes
    if body.name is not None:
        existing = (
            db.query(models.Board)
            .filter(
                models.Board.name == body.name,
                models.Board.id != board_id,
                models.Board.deleted_at.is_(None),
                models.Board.workspace_id == workspace.id,
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
    if body.anonymous_votes is not None:
        board.anonymous_votes = body.anonymous_votes
    if body.allow_multiple_votes_per_card is not None:
        board.allow_multiple_votes_per_card = body.allow_multiple_votes_per_card
    try:
        db.commit()
    except IntegrityError as err:
        db.rollback()
        raise HTTPException(409, "Измени название, такая доска уже есть") from err
    board = _board_query(db).filter(models.Board.id == board.id).first() or board
    payload = board_settings_payload(board)
    await manager.broadcast_workspace(workspace.id, "board_updated", payload)
    await manager.broadcast(board.id, "board_updated", payload)
    # Скрытие и анонимность меняют то, что сервер отдаёт каждому получателю:
    # клиенты перечитывают доску.
    if cards_hidden(board) != was_hidden or board.anonymous_votes != was_anonymous:
        await manager.broadcast(board.id, "cards_visibility_changed", {})
    return board_view(board, participant.id)


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
    board = _board_query(db).filter(models.Board.id == board_id).first()
    require_unlocked_board(board, workspace.id)
    assert board is not None
    if board.active_phase is not None:
        raise HTTPException(409, "Идёт сессия ведущего: карточки раскрывает он")
    require_moderator(board, participant, "Раскрыть карточки может создатель доски")
    if not board.cards_revealed:
        board.cards_revealed = True
        db.commit()
        board = _board_query(db).filter(models.Board.id == board_id).first() or board
        payload = board_settings_payload(board)
        await manager.broadcast_workspace(workspace.id, "board_updated", payload)
        await manager.broadcast(board.id, "board_updated", payload)
        await manager.broadcast(board.id, "cards_visibility_changed", {})
    return board_view(board, participant.id)


@router.delete("/{board_id}", status_code=204)
@limiter.limit("30/minute")
async def delete_board(
    request: Request,
    board_id: str,
    db: Session = Depends(get_db),
    workspace: models.Workspace = Depends(get_current_workspace),
    participant: models.Participant = Depends(get_current_participant),
):
    board = get_or_404(db, models.Board, board_id, "Доска не найдена")
    if board.workspace_id != workspace.id or board.deleted_at is not None:
        raise HTTPException(404, "Доска не найдена")
    require_moderator(board, participant, "Удалить доску может её создатель или ведущий")
    board.deleted_at = datetime.now(UTC)
    # Clear unique fields so the name/slug can be reused
    board.slug = None
    board.name = f"__deleted__{board.id}"
    db.commit()
    await manager.broadcast_workspace(
        workspace.id,
        "board_deleted",
        {"id": board.id},
    )


# ── Summary Endpoints ────────────────────────────────────────────────────────


def _get_board_full_data(
    db: Session, board_id: str, workspace_id: str
) -> dict:
    """Get full board data with columns and cards for AI processing."""
    from sqlalchemy import or_

    board = (
        db.query(models.Board)
        .options(
            selectinload(models.Board.columns).selectinload(models.Column.cards),
        )
        .filter(
            or_(
                models.Board.slug == board_id,
                models.Board.id == board_id,
            ),
            models.Board.deleted_at.is_(None),
            models.Board.workspace_id == workspace_id,
        )
        .first()
    )

    if not board:
        return {}

    return {
        "id": board.id,
        "name": board.name,
        # Темы команды: модель переиспользует их названия вместо новых
        "team_themes": themes.themes_for_prompt(db, workspace_id),
        "columns": [
            {
                "id": col.id,
                "title": col.title,
                "position": col.position,
                "cards": [
                    {
                        "id": card.id,
                        "text": card.text,
                        "author": ANON_AUTHOR if board.anonymous_votes else card.author,
                        "likes": card.likes or [],
                        "position": card.position,
                    }
                    for card in col.cards
                ],
            }
            for col in board.columns
        ],
    }


def _generate_summary_internal(
    board_id: str,
    facilitator_id: str,
    workspace_id: str,
) -> dict | None:
    """Generate and save summary (blocking; run via asyncio.to_thread).

    Opens its own Session so it never reuses the request/WS session
    across threads. Returns summary data dict or None if generation failed.
    """
    from app.database import SessionLocal

    logger.info("Starting summary generation for board %s", board_id)

    if manager.get_facilitator(board_id) != facilitator_id:
        logger.warning("Participant %s is not facilitator of board %s", facilitator_id, board_id)
        return None

    session_id = manager.get_session_id(board_id)
    if not session_id:
        session_id = int(datetime.now(UTC).timestamp() * 1000)
        manager.set_session_id(board_id, session_id)
        logger.info("Created new session ID: %s", session_id)

    db = SessionLocal()
    try:
        board_row = db.get(models.Board, board_id)
        if (
            board_row is None
            or board_row.workspace_id != workspace_id
            or board_row.deleted_at is not None
        ):
            logger.warning(
                "Summary generation refused for board %s: not live in workspace",
                board_id,
            )
            return None

        existing = (
            db.query(models.BoardSummary)
            .filter(
                models.BoardSummary.board_id == board_id,
                models.BoardSummary.session_id == session_id,
            )
            .first()
        )

        if existing:
            logger.info(
                "Summary already exists for board %s, session %s",
                board_id,
                session_id,
            )
            return themes.summary_out(db, existing, workspace_id).model_dump(
                mode="json"
            )

        board_data = _get_board_full_data(db, board_id, workspace_id)
        if not board_data:
            logger.warning("No board data for %s", board_id)
            return None

        # Данные прочитаны — соединение на время вызова модели не держим.
        # Сессия та же: следующий запрос возьмёт соединение из пула заново.
        db.close()
        try:
            ai_result = generate_summary(board_data)
            logger.info("AI summary generated for board %s", board_id)
        except Exception as e:
            logger.error(
                "AI summary generation failed for board %s: %s", board_id, e
            )
            return None

        # Темы доски пишутся той же транзакцией, что и итоги
        theme_names = themes.apply_board_themes(
            db, workspace_id, board_data["id"], ai_result
        )
        summary = models.BoardSummary(
            id=str(uuid.uuid4()),
            board_id=board_data["id"],
            session_id=session_id,
            summary_text=ai_result.get("summary_text", ""),
            key_themes=theme_names,
            recommendations=ai_result.get("recommendations", []),
        )
        db.add(summary)
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            logger.info(
                "Summary race lost for board %s, session %s",
                board_id,
                session_id,
            )
            existing = (
                db.query(models.BoardSummary)
                .filter(
                    models.BoardSummary.board_id == board_data["id"],
                    models.BoardSummary.session_id == session_id,
                )
                .first()
            )
            if existing is None:
                return None
            return themes.summary_out(db, existing, workspace_id).model_dump(
                mode="json"
            )
        db.refresh(summary)
        logger.info("Summary saved to DB for board %s", board_id)

        return themes.summary_out(db, summary, workspace_id).model_dump(mode="json")
    finally:
        db.close()


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
    board = _find_live_board(db, board_id, workspace.id)
    mood = (
        db.query(models.BoardMood)
        .filter(
            models.BoardMood.board_id == board.id,
            models.BoardMood.participant_id == participant.id,
        )
        .first()
    )
    if mood:
        mood.score = body.score
        mood.note = body.note
        mood.author = participant.name
        mood.created_at = now_utc()
    else:
        mood = models.BoardMood(
            id=str(uuid.uuid4()),
            board_id=board.id,
            author=participant.name,
            participant_id=participant.id,
            score=body.score,
            note=body.note,
        )
        db.add(mood)
    db.commit()
    db.refresh(mood)
    await broadcast_mood(board, mood)
    return mood_view(mood, board, participant.id)


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
    board = _find_live_board(db, board_id, workspace.id)

    # Get current session_id if active
    session_id = manager.get_session_id(board.id)

    query = db.query(models.BoardSummary).filter(
        models.BoardSummary.board_id == board.id
    )

    if session_id:
        # Prefer current session
        summary = (
            query.filter(models.BoardSummary.session_id == session_id)
            .order_by(models.BoardSummary.created_at.desc())
            .first()
        )
        if summary:
            return themes.summary_out(db, summary, workspace.id)

    # Fall back to latest summary
    summary = query.order_by(models.BoardSummary.created_at.desc()).first()

    if not summary:
        raise HTTPException(404, "Итоги не найдены")

    return themes.summary_out(db, summary, workspace.id)


@router.post("/{board_id}/summary/regenerate", response_model=schemas.BoardSummaryOut)
@limiter.limit("10/minute")
async def regenerate_summary(
    request: Request,
    board_id: str,
    db: Session = Depends(get_db),
    workspace: models.Workspace = Depends(get_current_workspace),
):
    """Принудительно перегенерировать AI-резюме для доски."""
    board = _find_live_board(db, board_id, workspace.id)
    if not settings.ai_configured:
        raise HTTPException(503, "AI сервис не настроен")
    require_cards_visible(board)

    board_data = _get_board_full_data(db, board.id, workspace.id)
    if not board_data:
        raise HTTPException(404, "Доска не найдена")

    board_pk = board.id
    workspace_pk = workspace.id
    # Данные прочитаны — соединение на время вызова модели не держим
    release_connection(db)

    try:
        ai_result = await asyncio.to_thread(generate_summary, board_data)
    except Exception as exc:
        logger.exception("Manual summary regeneration failed for board %s: %s", board_pk, exc)
        raise HTTPException(502, "Не удалось сгенерировать AI-резюме") from exc

    # Пока модель думала, доску могли удалить — перечитываем
    board = _find_live_board(db, board_pk, workspace_pk)
    session_id = (
        manager.get_session_id(board.id)
        or board.active_session_id
        or int(datetime.now(UTC).timestamp() * 1000)
    )

    # Перегенерация заменяет набор тем доски; пишется той же транзакцией
    theme_names = themes.apply_board_themes(db, workspace_pk, board.id, ai_result)

    summary = (
        db.query(models.BoardSummary)
        .filter(
            models.BoardSummary.board_id == board.id,
            models.BoardSummary.session_id == session_id,
        )
        .first()
    )
    if summary:
        summary.summary_text = ai_result.get("summary_text", "")
        summary.key_themes = theme_names
        summary.recommendations = ai_result.get("recommendations", [])
        summary.created_at = now_utc()
    else:
        summary = models.BoardSummary(
            id=str(uuid.uuid4()),
            board_id=board.id,
            session_id=session_id,
            summary_text=ai_result.get("summary_text", ""),
            key_themes=theme_names,
            recommendations=ai_result.get("recommendations", []),
        )
        db.add(summary)

    db.commit()
    db.refresh(summary)
    out = themes.summary_out(db, summary, workspace_pk)
    await manager.broadcast(
        board.id,
        "summary_generated",
        # Повторная генерация по кнопке: остальным участникам окно итогов
        # открывать не нужно — только обновить содержимое.
        {"summary": out.model_dump(mode="json"), "board_id": board.id, "regenerated": True},
    )
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
    board = require_unlocked_board(db.get(models.Board, board_id), workspace.id, "Доска не найдена")
    cards = (
        db.query(models.Card)
        .join(models.Column, models.Card.column_id == models.Column.id)
        .filter(models.Column.board_id == board.id)
        .all()
    )
    changed_cards: list[models.Card] = []
    for card in cards:
        likes = list(card.likes or [])
        if participant.id in likes:
            card.likes = [voter for voter in likes if voter != participant.id]
            changed_cards.append(card)
    if changed_cards:
        db.commit()
        for card in changed_cards:
            db.refresh(card)
            await broadcast_card(board, "card_updated", card)
    return schemas.BoardVotesResetOut(
        board_id=board.id,
        username=participant.name,
        updated_cards=len(changed_cards),
    )
