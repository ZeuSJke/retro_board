"""Темы команды: одно название темы на все ретроспективы workspace.

При генерации итогов модель получает уже известные темы команды и должна
переиспользовать их названия. Здесь её ответ сопоставляется со списком,
недостающие темы создаются, а по связям «тема ↔ доска» считается, на скольких
досках тема встречалась и сколько досок подряд она поднимается.
"""

import re
import unicodedata
from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field
from typing import Any, Literal

from sqlalchemy import exists
from sqlalchemy.orm import Session

from app import models, schemas

MAX_THEME_NAME_CHARS = 80
MAX_THEME_KEY_CHARS = 120  # длина WorkspaceTheme.name_key
MAX_THEME_DESCRIPTION_CHARS = 200
MAX_THEMES_PER_BOARD = 10
# Сколько тем команды уходит в запрос к модели: самые недавние
MAX_THEMES_IN_PROMPT = 40

_INVISIBLE_RE = re.compile(r"[\x00-\x1f\x7f\x85​-‏  ﻿]")
_SPACES_RE = re.compile(r"\s+")
_MARKUP_RE = re.compile(r"[<>*`#]")
_QUOTES = "\"'«»“”„‘’"
_QUOTES_RE = re.compile(f"[{_QUOTES}]")
_DASHES_RE = re.compile(r"[‐‑‒–—−]")


# ── Очистка и сравнение названий ─────────────────────────────────────────────


def _one_line(value: str, form: Literal["NFC", "NFD", "NFKC", "NFKD"] = "NFC") -> str:
    """Одна строка без невидимых символов и разметки (ответ модели — недоверенный)."""
    text = unicodedata.normalize(form, value)
    text = _INVISIBLE_RE.sub(" ", text)
    text = _MARKUP_RE.sub("", text)
    return _SPACES_RE.sub(" ", text).strip()


def clean_theme_name(value: object) -> str:
    """Название темы: одна строка без разметки, обрамляющих кавычек и точки в конце."""
    if not isinstance(value, str):
        return ""
    text = _one_line(value).rstrip(" .,:;")
    # "«Долгое ревью»" → "Долгое ревью"; кавычки внутри названия не трогаем
    if len(text) >= 2 and text[0] in _QUOTES and text[-1] in _QUOTES:
        inner = text[1:-1].strip()
        if not _QUOTES_RE.search(inner):
            text = inner.rstrip(" .,:;")
    return text[:MAX_THEME_NAME_CHARS].strip()


def clean_theme_description(value: object) -> str:
    if not isinstance(value, str):
        return ""
    return _one_line(value)[:MAX_THEME_DESCRIPTION_CHARS].strip()


def theme_key(name: str) -> str:
    """Ключ сравнения названий: без регистра, лишних пробелов, кавычек, ё/е.

    «Долгое  РЕВЬЮ кода.» и «долгое ревью кода» — одна тема.
    """
    text = _one_line(name, "NFKC").casefold().replace("ё", "е")
    text = _QUOTES_RE.sub("", text)
    text = _DASHES_RE.sub("-", text)
    text = _SPACES_RE.sub(" ", text).strip(" .,:;!?-")
    return text[:MAX_THEME_KEY_CHARS].strip()


# ── Сопоставление ответа модели со списком тем ───────────────────────────────


@dataclass(frozen=True)
class ResolvedTheme:
    name: str
    key: str
    description: str
    # None — такой темы у команды ещё нет, её нужно создать
    theme_id: str | None


def _candidates(ai_result: dict[str, Any]) -> list[dict[str, Any]]:
    """Темы из результата генерации итогов.

    Основной формат — themes (объекты), запасной — key_themes (строки):
    так отвечала модель до появления списка тем. Если переданы оба списка
    (например, через save_summary агента), дополняем themes недостающими из key_themes.
    """
    raw = ai_result.get("themes")
    items = [item for item in raw if isinstance(item, dict)] if isinstance(raw, list) else []
    legacy = ai_result.get("key_themes")
    if not isinstance(legacy, list):
        return items
    seen = {
        theme_key(clean_theme_name(item.get("name")))
        for item in items
        if isinstance(item.get("name"), str)
    }
    merged = list(items)
    for name in legacy:
        if not isinstance(name, str):
            continue
        key = theme_key(clean_theme_name(name))
        if key and key not in seen:
            seen.add(key)
            merged.append({"name": name})
    return merged


def resolve_candidates(
    existing: Sequence[models.WorkspaceTheme],
    candidates: Iterable[dict[str, Any]],
) -> list[ResolvedTheme]:
    """Сопоставить темы из ответа модели с темами команды.

    Модели не доверяем: решает сервер.
    1. Название совпало с существующей темой (без учёта регистра, пробелов,
       кавычек) — это она, что бы модель ни указала в id и is_new.
    2. Иначе, если модель сослалась на существующую тему по id и не пометила
       тему новой — это она: модель узнала тему, но переписала название;
       название в списке остаётся прежним.
    3. Иначе тема новая — в том числе при выдуманном id или is_new=false.
    Пустые названия и повторы одной темы отбрасываются.
    """
    by_key = {theme.name_key: theme for theme in existing}
    by_id = {theme.id: theme for theme in existing}
    resolved: list[ResolvedTheme] = []
    used_ids: set[str] = set()
    used_keys: set[str] = set()

    for candidate in candidates:
        if len(resolved) >= MAX_THEMES_PER_BOARD:
            break
        name = clean_theme_name(candidate.get("name"))
        key = theme_key(name)
        description = clean_theme_description(candidate.get("description"))

        theme = by_key.get(key) if key else None
        if theme is None and candidate.get("is_new") is not True:
            ref = candidate.get("theme_id")
            theme = by_id.get(ref) if isinstance(ref, str) else None

        if theme is not None:
            # Переписанное название запоминаем: его повтор — та же тема
            used_keys.add(key)
            if theme.id in used_ids:
                continue
            used_ids.add(theme.id)
            resolved.append(
                ResolvedTheme(theme.name, theme.name_key, description, theme.id)
            )
        elif key and key not in used_keys:
            used_keys.add(key)
            resolved.append(ResolvedTheme(name, key, description, None))
    return resolved


def _lock_workspace_themes(db: Session, workspace_id: str) -> None:
    """Выстроить в очередь запись тем одной команды (PostgreSQL).

    Две генерации итогов одновременно иначе создадут одну и ту же тему дважды
    или перезапишут связи друг друга. FOR NO KEY UPDATE не мешает созданию
    досок и карточек; SQLite блокировку строк игнорирует.
    """
    db.query(models.Workspace.id).filter(
        models.Workspace.id == workspace_id
    ).with_for_update(key_share=True).first()


def apply_board_themes(
    db: Session, workspace_id: str, board_id: str, ai_result: dict[str, Any]
) -> list[str]:
    """Записать темы доски по результату генерации итогов (без commit).

    Недостающие темы команды создаются, набор тем доски заменяется целиком.
    Возвращает названия тем в том виде, в каком они хранятся в списке
    команды, — их же вызывающий кладёт в BoardSummary.key_themes.
    Доска обязана принадлежать этому workspace — проверяет вызывающий.
    """
    _lock_workspace_themes(db, workspace_id)
    existing = (
        db.query(models.WorkspaceTheme)
        .filter(models.WorkspaceTheme.workspace_id == workspace_id)
        .all()
    )
    by_id = {theme.id: theme for theme in existing}
    resolved = resolve_candidates(existing, _candidates(ai_result))

    previous_ids = {
        theme_id
        for (theme_id,) in db.query(models.BoardTheme.theme_id).filter(
            models.BoardTheme.board_id == board_id
        )
    }
    db.query(models.BoardTheme).filter(
        models.BoardTheme.board_id == board_id
    ).delete(synchronize_session=False)

    board_themes: list[models.WorkspaceTheme] = []
    for item in resolved:
        if item.theme_id is None:
            theme = models.WorkspaceTheme(
                id=models.gen_uuid(),
                workspace_id=workspace_id,
                name=item.name,
                name_key=item.key,
                description=item.description,
            )
            db.add(theme)
        else:
            theme = by_id[item.theme_id]
            if not theme.description and item.description:
                theme.description = item.description
        board_themes.append(theme)
    # Темы — раньше связей: между моделями нет relationship, порядок вставки
    # задаём сами
    db.flush()

    for position, theme in enumerate(board_themes):
        db.add(
            models.BoardTheme(board_id=board_id, theme_id=theme.id, position=position)
        )
    db.flush()

    # Тема, которая была только на этой доске и после перегенерации не названа,
    # больше нигде не встречается — в списке команды ей делать нечего
    dropped_ids = previous_ids - {theme.id for theme in board_themes}
    if dropped_ids:
        db.query(models.WorkspaceTheme).filter(
            models.WorkspaceTheme.id.in_(dropped_ids),
            ~exists().where(models.BoardTheme.theme_id == models.WorkspaceTheme.id),
        ).delete(synchronize_session=False)

    return [theme.name for theme in board_themes]


# ── Счётчики повторов ────────────────────────────────────────────────────────


@dataclass
class _Timeline:
    """Доски команды с итогами по порядку создания и темы на них."""

    boards: list[Any]
    position: dict[str, int]  # board_id → номер доски по порядку
    themes: dict[str, models.WorkspaceTheme]
    # theme_id → номера досок, в итогах которых тема названа
    occurrences: dict[str, set[int]] = field(default_factory=dict)
    # board_id → темы доски в порядке итогов
    board_theme_ids: dict[str, list[str]] = field(default_factory=dict)

    def boards_count(self, theme_id: str) -> int:
        return len(self.occurrences.get(theme_id, ()))

    def streak(self, theme_id: str, end: int | None = None) -> int:
        """Сколько досок подряд названа тема, заканчивая доской номер end.

        По умолчанию — заканчивая последней доской с итогами.
        """
        positions = self.occurrences.get(theme_id, set())
        if end is None:
            end = len(self.boards) - 1
        length = 0
        while end - length in positions:
            length += 1
        return length

    def last_board(self, theme_id: str) -> Any | None:
        positions = self.occurrences.get(theme_id)
        return self.boards[max(positions)] if positions else None

    def ranked_theme_ids(self) -> list[str]:
        """Темы, встречающиеся на живых досках: сначала длинные серии."""
        seen = [theme_id for theme_id in self.themes if self.occurrences.get(theme_id)]
        return sorted(
            seen,
            key=lambda theme_id: (
                -self.streak(theme_id),
                -self.boards_count(theme_id),
                -max(self.occurrences[theme_id]),
                self.themes[theme_id].name_key,
            ),
        )


def _load_timeline(db: Session, workspace_id: str) -> _Timeline:
    """Прочитать доски с итогами и темы команды.

    Удалённые доски и доски без итогов в порядок не входят: по ним нельзя
    сказать, поднималась тема или нет.
    """
    boards = (
        db.query(
            models.Board.id,
            models.Board.name,
            models.Board.slug,
            models.Board.created_at,
        )
        .filter(
            models.Board.workspace_id == workspace_id,
            models.Board.deleted_at.is_(None),
            exists().where(models.BoardSummary.board_id == models.Board.id),
        )
        .order_by(models.Board.created_at, models.Board.id)
        .all()
    )
    themes = (
        db.query(models.WorkspaceTheme)
        .filter(models.WorkspaceTheme.workspace_id == workspace_id)
        .all()
    )
    timeline = _Timeline(
        boards=boards,
        position={board.id: number for number, board in enumerate(boards)},
        themes={theme.id: theme for theme in themes},
    )
    links = (
        db.query(models.BoardTheme.board_id, models.BoardTheme.theme_id)
        .join(
            models.WorkspaceTheme,
            models.WorkspaceTheme.id == models.BoardTheme.theme_id,
        )
        .filter(models.WorkspaceTheme.workspace_id == workspace_id)
        .order_by(models.BoardTheme.board_id, models.BoardTheme.position)
        .all()
    )
    for board_id, theme_id in links:
        number = timeline.position.get(board_id)
        if number is None or theme_id not in timeline.themes:
            continue
        timeline.occurrences.setdefault(theme_id, set()).add(number)
        timeline.board_theme_ids.setdefault(board_id, []).append(theme_id)
    return timeline


def list_workspace_themes(db: Session, workspace_id: str) -> list[schemas.WorkspaceThemeOut]:
    """Темы команды со счётчиками: сначала те, что поднимаются дольше всего подряд."""
    timeline = _load_timeline(db, workspace_id)
    result: list[schemas.WorkspaceThemeOut] = []
    for theme_id in timeline.ranked_theme_ids():
        theme = timeline.themes[theme_id]
        last = timeline.last_board(theme_id)
        if last is None:
            continue
        result.append(
            schemas.WorkspaceThemeOut(
                id=theme.id,
                name=theme.name,
                description=theme.description,
                boards_count=timeline.boards_count(theme_id),
                streak=timeline.streak(theme_id),
                last_board=schemas.ThemeBoardRef(
                    id=last.id,
                    name=last.name,
                    slug=last.slug,
                    created_at=last.created_at,
                ),
            )
        )
    return result


def themes_for_prompt(db: Session, workspace_id: str) -> list[dict[str, str]]:
    """Темы команды для запроса к модели: самые недавние, не больше лимита."""
    timeline = _load_timeline(db, workspace_id)
    recent_first = sorted(
        (theme_id for theme_id in timeline.themes if timeline.occurrences.get(theme_id)),
        key=lambda theme_id: (
            -max(timeline.occurrences[theme_id]),
            -timeline.boards_count(theme_id),
            timeline.themes[theme_id].name_key,
        ),
    )
    return [
        {
            "id": theme_id,
            "name": timeline.themes[theme_id].name,
            "description": timeline.themes[theme_id].description,
        }
        for theme_id in recent_first[:MAX_THEMES_IN_PROMPT]
    ]


def themes_for_insights(db: Session, workspace_id: str) -> list[dict[str, Any]] | None:
    """Счётчики тем для кросс-спринт анализа; None — у команды ещё нет тем."""
    timeline = _load_timeline(db, workspace_id)
    ranked = timeline.ranked_theme_ids()
    if not ranked:
        return None
    return [
        {
            "name": timeline.themes[theme_id].name,
            "boards_count": timeline.boards_count(theme_id),
            "streak": timeline.streak(theme_id),
        }
        for theme_id in ranked
    ]


def summary_out(
    db: Session, summary: models.BoardSummary, workspace_id: str
) -> schemas.BoardSummaryOut:
    """Итоги доски вместе со счётчиками повторов её тем.

    Серия считается до этой доски включительно: «на момент этого ретро тема
    поднималась N-й спринт подряд». В статистику попадают только темы,
    названные в самих итогах (key_themes): у итогов, созданных до появления
    списка тем, она пустая.
    """
    out = schemas.BoardSummaryOut.model_validate(summary)
    timeline = _load_timeline(db, workspace_id)
    number = timeline.position.get(summary.board_id)
    if number is None:
        return out
    named = {theme_key(name) for name in summary.key_themes or []}
    board_themes = [
        timeline.themes[theme_id]
        for theme_id in timeline.board_theme_ids.get(summary.board_id, [])
    ]
    out.theme_stats = [
        schemas.BoardThemeStat(
            id=theme.id,
            name=theme.name,
            description=theme.description,
            boards_count=timeline.boards_count(theme.id),
            streak=timeline.streak(theme.id, number),
        )
        for theme in board_themes
        if theme.name_key in named
    ]
    return out
