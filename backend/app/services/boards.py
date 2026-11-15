"""Сервисный слой для досок, списков, трендов и итогов ретро."""

from datetime import UTC, datetime
import uuid

from fastapi import HTTPException
from slugify import slugify
from sqlalchemy import and_, case, exists, func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app import models, schemas, themes
from app.board_view import board_view, require_cards_visible
from app.database import release_connection
from app.models import now_utc
from app.services.action_items import copy_unresolved_action_items
from app.services.common import (
    BoardLookupMode,
    BroadcastAction,
    apply_board_lookup,
    dispatch_broadcasts,
    find_live_board,
)
from app.ws_manager import manager

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


def make_slug(name: str) -> str:
    slug = slugify(name, max_length=80, word_boundary=True)
    if not slug:
        return f"board-{uuid.uuid4().hex[:8]}"
    if slug in _RESERVED_SLUGS:
        return f"{slug}-{uuid.uuid4().hex[:6]}"
    return slug


def resolve_unique_slug(
    db: Session,
    name: str,
    workspace_id: str,
    exclude_board_id: str | None = None,
) -> str:
    base = make_slug(name)
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


def board_card_counts(db: Session, board_ids: list[str]) -> dict[str, int]:
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


def board_mood_stats(db: Session, board_ids: list[str]) -> dict[str, tuple[float | None, int]]:
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


def board_query(db: Session):
    """Запрос доски с eager-загрузкой колонок, карточек, групп и настроений."""
    return db.query(models.Board).options(
        selectinload(models.Board.columns).selectinload(models.Column.cards),
        selectinload(models.Board.columns).selectinload(models.Column.groups),
        selectinload(models.Board.moods),
    )


def get_mood_trends(db: Session, workspace_id: str) -> list[schemas.MoodTrendPoint]:
    """Динамика настроения, карточек и выполнения задач по всем доскам команды."""
    boards = (
        db.query(models.Board)
        .filter(
            models.Board.deleted_at.is_(None),
            models.Board.workspace_id == workspace_id,
        )
        .order_by(models.Board.created_at)
        .all()
    )
    board_ids = [b.id for b in boards]
    card_counts = board_card_counts(db, board_ids)
    mood_stats = board_mood_stats(db, board_ids)

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


def list_workspace_boards(
    db: Session,
    workspace_id: str,
    *,
    limit: int | None = None,
    offset: int = 0,
) -> tuple[list[schemas.BoardListItem], int]:
    """Список досок команды со счётчиками и опциональной пагинацией."""
    total = (
        db.query(func.count(models.Board.id))
        .filter(
            models.Board.deleted_at.is_(None),
            models.Board.workspace_id == workspace_id,
        )
        .scalar()
        or 0
    )

    q = (
        db.query(
            models.Board,
            func.count(func.distinct(models.ActionItem.id)).label("action_items_total"),
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
        .outerjoin(models.ActionItem, models.ActionItem.board_id == models.Board.id)
        .filter(
            models.Board.deleted_at.is_(None),
            models.Board.workspace_id == workspace_id,
        )
        .group_by(models.Board.id)
        .order_by(models.Board.created_at.desc(), models.Board.id.desc())
    )
    if offset:
        q = q.offset(offset)
    if limit is not None:
        q = q.limit(limit)
    rows = q.all()

    board_ids = [board.id for board, _, _, _ in rows]
    card_counts = board_card_counts(db, board_ids)
    mood_stats = board_mood_stats(db, board_ids)

    result: list[schemas.BoardListItem] = []
    for board, ai_total, open_count, has_summary in rows:
        item = schemas.BoardListItem.model_validate(board)
        item.action_items_total = ai_total
        item.action_items_open = open_count
        item.has_summary = bool(has_summary)
        item.cards_count = card_counts.get(board.id, 0)
        mood_avg, mood_count = mood_stats.get(board.id, (None, 0))
        item.mood_avg = mood_avg
        item.mood_count = mood_count
        result.append(item)
    return result, total


def get_board_view(
    db: Session,
    workspace_id: str,
    viewer_id: str | None,
    board_id_or_slug: str,
    *,
    board_query_fn=None,
    lookup: BoardLookupMode = "id_or_slug",
) -> dict:
    """Снимок доски (по ID или slug) для конкретного участника/агента."""
    board_id = (
        apply_board_lookup(
            db.query(models.Board.id),
            board_id_or_slug,
            workspace_id,
            lookup=lookup,
        )
        .limit(1)
        .scalar()
    )
    if not board_id:
        raise HTTPException(404, "Доска не найдена")

    # Номер события читается до выборки доски, чтобы не потерять конкурентные изменения.
    seq_before = manager.current_seq(board_id)
    query_fn = board_query_fn or board_query
    board = query_fn(db).filter(models.Board.id == board_id).first()
    if not board or board.deleted_at is not None:
        raise HTTPException(404, "Доска не найдена")
    return board_view(board, viewer_id, event_seq=seq_before)


def create_board_sync(
    db: Session,
    workspace_id: str,
    participant: models.Participant,
    body: schemas.BoardCreate,
    *,
    source_board_id_or_slug: str | None = None,
) -> tuple[dict, list[BroadcastAction]]:
    """Создать доску команды в синхронной транзакции и вернуть вид + отложенную WS-рассылку."""
    existing = (
        db.query(models.Board)
        .filter(
            models.Board.name == body.name,
            models.Board.deleted_at.is_(None),
            models.Board.workspace_id == workspace_id,
        )
        .first()
    )
    if existing:
        raise HTTPException(409, "Измени название, такая доска уже есть")

    src_lookup = source_board_id_or_slug or body.source_board_id
    src_board: models.Board | None = None
    if src_lookup:
        src_lookup_mode: BoardLookupMode = (
            "id_or_slug" if source_board_id_or_slug is not None else "id"
        )
        src_board = apply_board_lookup(
            db.query(models.Board).options(selectinload(models.Board.columns)),
            src_lookup,
            workspace_id,
            lookup=src_lookup_mode,
        ).first()
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

    slug = resolve_unique_slug(db, body.name, workspace_id)
    uid = str(uuid.uuid4())
    participant_id = participant.id
    board = models.Board(
        id=uid,
        name=body.name,
        slug=slug,
        max_votes=body.max_votes,
        template=body.template,
        hide_cards_until_reveal=body.hide_cards_until_reveal,
        anonymous_votes=body.anonymous_votes,
        allow_multiple_votes_per_card=body.allow_multiple_votes_per_card,
        workspace_id=workspace_id,
        # Агент не бывает ведущим в браузере — доской, подготовленной агентом, может управлять любой человек команды
        created_by_id=None if (participant.kind or "human") == "agent" else participant_id,
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
                    models.Board.workspace_id == workspace_id,
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
    board = board_query(db).filter(models.Board.id == board.id).first() or board
    list_item = schemas.BoardListItem.model_validate(board)
    list_item.action_items_total = carried_count
    list_item.action_items_open = carried_count
    payload = list_item.model_dump(mode="json")

    async def _send() -> None:
        await manager.broadcast_workspace(workspace_id, "board_created", payload)

    return board_view(board, participant_id), [_send]


async def create_board_for_workspace(
    db: Session,
    workspace_id: str,
    participant: models.Participant,
    body: schemas.BoardCreate,
    *,
    source_board_id_or_slug: str | None = None,
) -> dict:
    """Создать доску команды, перенести открытые задачи и разослать `board_created`."""
    view, broadcasts = create_board_sync(
        db,
        workspace_id,
        participant,
        body,
        source_board_id_or_slug=source_board_id_or_slug,
    )
    release_connection(db)
    await dispatch_broadcasts(broadcasts)
    return view


def get_board_summary_for_workspace(
    db: Session,
    workspace_id: str,
    board_id_or_slug: str,
    *,
    lookup: BoardLookupMode = "id_or_slug",
) -> schemas.BoardSummaryOut:
    """Последние итоги доски (предпочитая активную сессию)."""
    board = find_live_board(db, board_id_or_slug, workspace_id, lookup=lookup)
    session_id = manager.get_session_id(board.id)

    query = db.query(models.BoardSummary).filter(
        models.BoardSummary.board_id == board.id
    )
    if session_id:
        summary = (
            query.filter(models.BoardSummary.session_id == session_id)
            .order_by(models.BoardSummary.created_at.desc())
            .first()
        )
        if summary:
            return themes.summary_out(db, summary, workspace_id)

    summary = query.order_by(models.BoardSummary.created_at.desc()).first()
    if not summary:
        raise HTTPException(404, "Итоги не найдены")
    return themes.summary_out(db, summary, workspace_id)


def persist_board_summary_sync(
    db: Session,
    board: models.Board,
    workspace_id: str,
    *,
    summary_text: str,
    themes_payload: list[dict] | None = None,
    key_themes: list[str] | None = None,
    recommendations: list[str] | None = None,
    update_latest_when_no_session: bool = False,
) -> tuple[schemas.BoardSummaryOut, list[BroadcastAction]]:
    """Применить темы команды, сохранить или обновить BoardSummary (синхронная транзакция).

    Если `themes_payload`/`key_themes` или `recommendations` равны `None`,
    при обновлении существующего итога соответствующие поля сохраняются без изменений.
    """
    board_id = board.id
    update_themes = (themes_payload is not None) or (key_themes is not None)
    update_recs = recommendations is not None
    ai_result = {
        "summary_text": summary_text,
        "themes": list(themes_payload or []),
        "key_themes": list(key_themes or []),
    }

    active_session_id = manager.get_session_id(board_id) or board.active_session_id
    summary: models.BoardSummary | None = None
    if active_session_id is not None:
        summary = (
            db.query(models.BoardSummary)
            .filter(
                models.BoardSummary.board_id == board_id,
                models.BoardSummary.session_id == active_session_id,
            )
            .order_by(models.BoardSummary.created_at.desc())
            .first()
        )
        session_id = active_session_id
    else:
        if update_latest_when_no_session:
            summary = (
                db.query(models.BoardSummary)
                .filter(models.BoardSummary.board_id == board_id)
                .order_by(models.BoardSummary.created_at.desc())
                .first()
            )
        session_id = (
            summary.session_id
            if summary is not None
            else int(datetime.now(UTC).timestamp() * 1000)
        )

    if summary is not None:
        summary.summary_text = summary_text
        if update_themes:
            summary.key_themes = themes.apply_board_themes(
                db, workspace_id, board_id, ai_result
            )
        if update_recs:
            summary.recommendations = list(recommendations or [])
        summary.created_at = now_utc()
    else:
        theme_names = (
            themes.apply_board_themes(db, workspace_id, board_id, ai_result)
            if update_themes
            else []
        )
        summary = models.BoardSummary(
            id=str(uuid.uuid4()),
            board_id=board_id,
            session_id=session_id,
            summary_text=summary_text,
            key_themes=theme_names,
            recommendations=list(recommendations or []),
        )
        db.add(summary)

    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        existing = (
            db.query(models.BoardSummary)
            .filter(
                models.BoardSummary.board_id == board_id,
                models.BoardSummary.session_id == session_id,
            )
            .first()
        )
        if existing is None:
            raise
        existing.summary_text = summary_text
        if update_themes:
            existing.key_themes = themes.apply_board_themes(
                db, workspace_id, board_id, ai_result
            )
        if update_recs:
            existing.recommendations = list(recommendations or [])
        existing.created_at = now_utc()
        summary = existing
        db.commit()

    db.refresh(summary)
    out = themes.summary_out(db, summary, workspace_id)
    payload = {"summary": out.model_dump(mode="json"), "board_id": board_id, "regenerated": True}

    async def _send() -> None:
        await manager.broadcast(board_id, "summary_generated", payload)

    return out, [_send]


async def persist_board_summary(
    db: Session,
    board: models.Board,
    workspace_id: str,
    *,
    summary_text: str,
    themes_payload: list[dict] | None = None,
    key_themes: list[str] | None = None,
    recommendations: list[str] | None = None,
    update_latest_when_no_session: bool = False,
) -> schemas.BoardSummaryOut:
    """Применить темы команды, сохранить или обновить BoardSummary и разослать WS."""
    out, broadcasts = persist_board_summary_sync(
        db,
        board,
        workspace_id,
        summary_text=summary_text,
        themes_payload=themes_payload,
        key_themes=key_themes,
        recommendations=recommendations,
        update_latest_when_no_session=update_latest_when_no_session,
    )
    release_connection(db)
    await dispatch_broadcasts(broadcasts)
    return out


def save_board_summary_sync(
    db: Session,
    workspace_id: str,
    *,
    board_id_or_slug: str,
    summary_text: str,
    key_themes: list[str] | None = None,
    themes_payload: list[dict] | None = None,
    recommendations: list[str] | None = None,
    require_unlocked: bool = True,
) -> tuple[schemas.BoardSummaryOut, list[BroadcastAction]]:
    """Сохранить или обновить итоги доски от агента (синхронная транзакция)."""
    board = find_live_board(
        db, board_id_or_slug, workspace_id, require_unlocked=require_unlocked
    )
    require_cards_visible(board)
    return persist_board_summary_sync(
        db,
        board,
        workspace_id,
        summary_text=summary_text,
        themes_payload=themes_payload,
        key_themes=key_themes,
        recommendations=recommendations,
        update_latest_when_no_session=True,
    )


async def save_board_summary_for_workspace(
    db: Session,
    workspace_id: str,
    *,
    board_id_or_slug: str,
    summary_text: str,
    key_themes: list[str] | None = None,
    themes_payload: list[dict] | None = None,
    recommendations: list[str] | None = None,
    require_unlocked: bool = True,
) -> schemas.BoardSummaryOut:
    """Сохранить или обновить итоги доски от агента и синхронизировать темы."""
    out, broadcasts = save_board_summary_sync(
        db,
        workspace_id,
        board_id_or_slug=board_id_or_slug,
        summary_text=summary_text,
        themes_payload=themes_payload,
        key_themes=key_themes,
        recommendations=recommendations,
        require_unlocked=require_unlocked,
    )
    release_connection(db)
    await dispatch_broadcasts(broadcasts)
    return out
