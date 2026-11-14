from __future__ import annotations
import re
from datetime import datetime
from typing import Literal, Optional
from pydantic import BaseModel, Field, field_validator

ActionItemStatus = Literal["open", "in_progress", "done"]

_HEX_COLOR_RE = re.compile(r"^#[0-9a-fA-F]{6}$")
_HTML_TAG_RE = re.compile(r"<[^>]+>")


def _strip_non_empty(v: str | None, field_name: str = "Поле") -> str | None:
    if v is None:
        return v
    stripped = v.strip()
    if not stripped:
        raise ValueError(f"{field_name} не должно быть пустым")
    return stripped


def _utf8_encodable(v: str) -> str:
    """Отклонить строку, которую нельзя передать в БД и в bcrypt (одиночный суррогат)."""
    try:
        v.encode("utf-8")
    except UnicodeEncodeError as err:
        raise ValueError("Строка содержит недопустимые символы") from err
    return v


# bcrypt учитывает только первые 72 байта; кириллица в UTF-8 — по два байта на букву
_BCRYPT_MAX_BYTES = 72


def _access_key_within_bcrypt_limit(v: str | None) -> str | None:
    if v is not None and len(v.encode()) > _BCRYPT_MAX_BYTES:
        raise ValueError(
            "Ключ доступа слишком длинный: не больше 72 байт "
            "(72 латинских символа или 36 кириллических)"
        )
    return v


# ── Workspace ─────────────────────────────────────────────────────────────────


DEFAULT_PARTICIPANT_NAME = "Участник"


def _participant_name(v: str | None) -> str:
    """Имя участника: непустое, без HTML, кодируемое в UTF-8."""
    if v is None:
        return DEFAULT_PARTICIPANT_NAME
    stripped = _utf8_encodable(v).strip()
    if not stripped:
        return DEFAULT_PARTICIPANT_NAME
    if _HTML_TAG_RE.search(stripped):
        raise ValueError("Имя не должно содержать HTML-теги")
    return stripped


class WorkspaceLoginRequest(BaseModel):
    workspace_slug: str = Field(..., min_length=1, max_length=80)
    access_key: str = Field(..., min_length=1, max_length=100)
    # Имя, под которым участник появится на досках; личностью оно не является
    name: Optional[str] = Field(default=None, max_length=60, validate_default=True)

    @field_validator("workspace_slug", "access_key")
    @classmethod
    def validate_encodable(cls, v: str) -> str:
        return _utf8_encodable(v)

    @field_validator("name")
    @classmethod
    def validate_name(cls, v: str | None) -> str:
        return _participant_name(v)


class WorkspaceJoinRequest(BaseModel):
    """Вход по ссылке-приглашению: достаточно токена из ссылки и имени."""

    invite_token: str = Field(..., min_length=8, max_length=64)
    name: Optional[str] = Field(default=None, max_length=60, validate_default=True)

    @field_validator("invite_token")
    @classmethod
    def validate_encodable(cls, v: str) -> str:
        return _utf8_encodable(v)

    @field_validator("name")
    @classmethod
    def validate_name(cls, v: str | None) -> str:
        return _participant_name(v)


class ParticipantOut(BaseModel):
    id: str
    name: str

    model_config = {"from_attributes": True}


class ParticipantUpdate(BaseModel):
    name: str = Field(..., min_length=1, max_length=60)

    @field_validator("name")
    @classmethod
    def validate_name(cls, v: str) -> str:
        return _participant_name(v)


class SessionOut(BaseModel):
    """Ответ на вход. Токен сессии уходит только в httpOnly-cookie."""

    workspace_id: str
    workspace_slug: str
    workspace_name: str
    participant: ParticipantOut


class InviteOut(BaseModel):
    invite_token: str


class InviteInfoOut(BaseModel):
    workspace_name: str


class WorkspaceCreate(BaseModel):
    slug: str = Field(..., min_length=1, max_length=80, pattern=r"^[a-z0-9-]+$")
    name: str = Field(..., min_length=1, max_length=120)
    access_key: str = Field(..., min_length=4, max_length=100)

    @field_validator("name")
    @classmethod
    def validate_name(cls, v: str) -> str:
        return _strip_non_empty(v, "Название команды") or ""

    @field_validator("access_key")
    @classmethod
    def validate_access_key(cls, v: str) -> str:
        return _access_key_within_bcrypt_limit(v) or ""


class WorkspaceUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=120)
    access_key: Optional[str] = Field(default=None, min_length=4, max_length=100)

    @field_validator("name")
    @classmethod
    def validate_name(cls, v: str | None) -> str | None:
        return _strip_non_empty(v, "Название команды")

    @field_validator("access_key")
    @classmethod
    def validate_access_key(cls, v: str | None) -> str | None:
        return _access_key_within_bcrypt_limit(v)


class WorkspaceOut(BaseModel):
    id: str
    slug: str
    name: str
    created_at: datetime
    model_config = {"from_attributes": True}


class WorkspaceMeOut(WorkspaceOut):
    """Текущая сессия: команда, участник и возможности инстанса."""

    participant: ParticipantOut
    ai_enabled: bool = False


class WorkspaceListItem(WorkspaceOut):
    boards_count: int = 0


# ── Admin ────────────────────────────────────────────────────────────────────


class AdminLoginRequest(BaseModel):
    login: str = Field(..., min_length=1, max_length=200)
    password: str = Field(..., min_length=1, max_length=200)

    @field_validator("login", "password")
    @classmethod
    def validate_encodable(cls, v: str) -> str:
        return _utf8_encodable(v)


# ── Card ──────────────────────────────────────────────────────────────────────


class CardBase(BaseModel):
    text: str = Field(..., min_length=1, max_length=2000)
    color: str = Field(default="#FFFFFF", pattern=r"^#[0-9a-fA-F]{6}$")


class CardCreate(CardBase):
    """Автор карточки — участник текущей сессии; из запроса он не принимается."""

    column_id: str

    @field_validator("text")
    @classmethod
    def validate_text(cls, v: str) -> str:
        return _strip_non_empty(v, "Текст карточки") or ""


class CardUpdate(BaseModel):
    text: Optional[str] = Field(default=None, min_length=1, max_length=2000)
    color: Optional[str] = None
    group_id: Optional[str] = None
    column_id: Optional[str] = None
    position: Optional[int] = Field(default=None, ge=0)

    @field_validator("text")
    @classmethod
    def validate_text(cls, v: str | None) -> str | None:
        return _strip_non_empty(v, "Текст карточки")

    @field_validator("color")
    @classmethod
    def validate_color(cls, v: str | None) -> str | None:
        if v is not None and not _HEX_COLOR_RE.match(v):
            raise ValueError("color must be a hex string like #RRGGBB")
        return v


class CardOut(BaseModel):
    """Карточка в виде, собранном для конкретного получателя (см. app/board_view.py).

    `likes` — идентификаторы проголосовавших участников, по одному на голос;
    в анонимном режиме чужие заменены на "anon". `masked` — карточка чужая и
    ещё не раскрыта: текст, автор и голоса не передаются.
    """

    id: str
    column_id: str
    group_id: Optional[str] = None
    text: str = ""
    author: str = ""
    author_id: Optional[str] = None
    color: str = "#FFFFFF"
    position: int
    likes: list[str] = []
    masked: bool = False
    created_at: datetime


# ── CardGroup ─────────────────────────────────────────────────────────────────


class CardGroupCreate(BaseModel):
    column_id: str
    title: str = Field(default="Группа", min_length=1, max_length=120)

    @field_validator("title")
    @classmethod
    def validate_title(cls, v: str) -> str:
        return _strip_non_empty(v, "Название группы") or ""


class CardGroupUpdate(BaseModel):
    title: Optional[str] = Field(default=None, min_length=1, max_length=120)

    @field_validator("title")
    @classmethod
    def validate_title(cls, v: str | None) -> str | None:
        return _strip_non_empty(v, "Название группы")


class CardGroupOut(BaseModel):
    id: str
    column_id: str
    title: str
    position: int

    model_config = {"from_attributes": True}


# ── Column ────────────────────────────────────────────────────────────────────


class ColumnBase(BaseModel):
    title: str = Field(..., min_length=1, max_length=80)
    color: str = Field(default="#6750A4", pattern=r"^#[0-9a-fA-F]{6}$")


class ColumnCreate(ColumnBase):
    board_id: str

    @field_validator("title")
    @classmethod
    def validate_title(cls, v: str) -> str:
        return _strip_non_empty(v, "Название колонки") or ""


class ColumnUpdate(BaseModel):
    title: Optional[str] = Field(default=None, min_length=1, max_length=80)
    color: Optional[str] = None
    position: Optional[int] = Field(default=None, ge=0)

    @field_validator("title")
    @classmethod
    def validate_title(cls, v: str | None) -> str | None:
        return _strip_non_empty(v, "Название колонки")

    @field_validator("color")
    @classmethod
    def validate_color(cls, v: str | None) -> str | None:
        if v is not None and not _HEX_COLOR_RE.match(v):
            raise ValueError("color must be a hex string like #RRGGBB")
        return v


class ColumnInfo(ColumnBase):
    """Свойства колонки без карточек — для ответов и событий об изменении колонки."""

    id: str
    board_id: str
    position: int

    model_config = {"from_attributes": True}


class ColumnOut(ColumnInfo):
    cards: list[CardOut] = []
    groups: list[CardGroupOut] = []


# ── Board ─────────────────────────────────────────────────────────────────────


class BoardBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)

    @field_validator("name")
    @classmethod
    def name_no_html(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Название доски не должно быть пустым")
        if _HTML_TAG_RE.search(v):
            raise ValueError("Название доски не должно содержать HTML-теги")
        return v


class ColumnSeed(BaseModel):
    # Длина совпадает с Column.title в БД (String(80))
    title: str = Field(..., min_length=1, max_length=80)
    color: str = Field(default="#6750A4", pattern=_HEX_COLOR_RE.pattern)

    @field_validator("title")
    @classmethod
    def validate_title(cls, v: str) -> str:
        stripped = _strip_non_empty(v, "Название колонки") or ""
        if _HTML_TAG_RE.search(stripped):
            raise ValueError("Название колонки не должно содержать HTML-теги")
        return stripped


class BoardMoodCreate(BaseModel):
    """Оценку ставит участник текущей сессии; автор из запроса не принимается."""

    score: int = Field(..., ge=1, le=5)
    note: Optional[str] = Field(default=None, max_length=200)

    @field_validator("note")
    @classmethod
    def validate_note(cls, v: str | None) -> str | None:
        if v is None:
            return None
        stripped = v.strip()
        if not stripped:
            return None
        if _HTML_TAG_RE.search(stripped):
            raise ValueError("Комментарий не должен содержать HTML-теги")
        return stripped


class BoardMoodOut(BaseModel):
    id: str
    board_id: str
    author: str
    participant_id: Optional[str] = None
    score: int
    note: Optional[str] = None
    created_at: datetime
    # Оценка текущего участника (в анонимном режиме чужие имена скрыты)
    mine: bool = False


class BoardTemplateInfo(BaseModel):
    id: str
    name: str
    description: str
    columns: list[ColumnSeed]


class BoardCreate(BoardBase):
    max_votes: int = Field(default=5, ge=1, le=99)
    template: str = Field(default="classic", max_length=40)
    custom_columns: Optional[list[ColumnSeed]] = Field(default=None, max_length=10)
    source_board_id: Optional[str] = Field(default=None, max_length=100)
    carry_forward_items: bool = False
    hide_cards_until_reveal: bool = False
    anonymous_votes: bool = False
    allow_multiple_votes_per_card: bool = False


class BoardUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=120)
    max_votes: Optional[int] = Field(default=None, ge=1, le=99)
    is_locked: Optional[bool] = None
    hide_cards_until_reveal: Optional[bool] = None
    anonymous_votes: Optional[bool] = None
    allow_multiple_votes_per_card: Optional[bool] = None

    @field_validator("name")
    @classmethod
    def name_no_html(cls, v: str | None) -> str | None:
        if v is None:
            return v
        v = v.strip()
        if not v:
            raise ValueError("Название доски не должно быть пустым")
        if _HTML_TAG_RE.search(v):
            raise ValueError("Название доски не должно содержать HTML-теги")
        return v


class BoardOut(BoardBase):
    id: str
    slug: Optional[str] = None
    max_votes: int
    template: str = "classic"
    is_locked: bool = False
    hide_cards_until_reveal: bool = False
    anonymous_votes: bool = False
    allow_multiple_votes_per_card: bool = False
    active_facilitator: Optional[str] = None
    active_facilitator_id: Optional[str] = None
    active_phase: Optional[str] = None
    active_session_id: Optional[int] = None
    created_at: datetime
    workspace_id: Optional[str] = None
    # Создатель доски; пусто у досок, созданных до появления участников
    created_by_id: Optional[str] = None
    # Скрытый сбор: раскрыты ли карточки и скрыты ли они сейчас для получателя
    cards_revealed: bool = False
    cards_hidden: bool = False
    # Синхронизация: номер последнего события доски и поколение нумерации
    event_seq: int = 0
    event_epoch: str = ""
    columns: list[ColumnOut] = []
    moods: list[BoardMoodOut] = []


class BoardListItem(BoardBase):
    id: str
    slug: Optional[str] = None
    max_votes: int
    template: str = "classic"
    is_locked: bool = False
    created_at: datetime
    workspace_id: Optional[str] = None
    created_by_id: Optional[str] = None
    action_items_total: int = 0
    action_items_open: int = 0
    has_summary: bool = False
    cards_count: int = 0
    mood_avg: Optional[float] = None
    mood_count: int = 0
    model_config = {"from_attributes": True}


# ── Move card ─────────────────────────────────────────────────────────────────


class MoveCard(BaseModel):
    column_id: str
    position: int = Field(ge=0)


# ── Set card group ─────────────────────────────────────────────────────────────


class SetCardGroup(BaseModel):
    group_id: Optional[str] = None


# ── Move group ────────────────────────────────────────────────────────────────


class GroupMove(BaseModel):
    column_id: str


# ── ActionItem ───────────────────────────────────────────────────────────────


class ActionItemCreate(BaseModel):
    board_id: str
    title: str = Field(default="", max_length=200)
    text: str = Field(..., min_length=1, max_length=2000)
    assignee: Optional[str] = Field(default=None, max_length=60)
    source_card_ids: list[str] = []
    status: ActionItemStatus = "open"

    @field_validator("text")
    @classmethod
    def validate_text(cls, v: str) -> str:
        return _strip_non_empty(v, "Текст задачи") or ""


class ActionItemUpdate(BaseModel):
    title: Optional[str] = Field(default=None, max_length=200)
    text: Optional[str] = Field(default=None, min_length=1, max_length=2000)
    assignee: Optional[str] = Field(default=None, max_length=60)
    status: Optional[ActionItemStatus] = None

    @field_validator("text")
    @classmethod
    def validate_text(cls, v: str | None) -> str | None:
        return _strip_non_empty(v, "Текст задачи")


class ActionItemOut(BaseModel):
    id: str
    board_id: str
    title: str = ""
    text: str
    assignee: Optional[str] = None
    source_card_ids: list[str] = []
    status: str = "open"
    completed_at: Optional[datetime] = None
    created_at: datetime
    # Задача перенесена на другую доску: открытой считается её копия, а не она
    superseded_by_id: Optional[str] = None

    model_config = {"from_attributes": True}


class DashboardActionItem(ActionItemOut):
    board_name: str = ""


class GenerateTitleRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=2000)


class GenerateTitleResponse(BaseModel):
    title: str


# ── Carry Forward ──────────────────────────────────────────────────────────


class CarryForwardRequest(BaseModel):
    source_board_id: str
    target_board_id: str
    # Перенести только эти задачи; без списка — все незакрытые с исходной доски
    item_ids: Optional[list[str]] = Field(default=None, max_length=200)


# ── Trends ────────────────────────────────────────────────────────────────────


class TrendPoint(BaseModel):
    board_id: str
    board_name: str
    created_at: datetime
    open: int = 0
    in_progress: int = 0
    done: int = 0
    total: int = 0


# ── Board Summary ────────────────────────────────────────────────────────────


class BoardThemeStat(BaseModel):
    """Тема из итогов доски и её повторы между спринтами."""

    id: str
    name: str
    description: str = ""
    # На скольких досках команды тема названа в итогах
    boards_count: int
    # Сколько досок подряд, заканчивая этой: «N-й спринт подряд»
    streak: int


class BoardSummaryOut(BaseModel):
    id: str
    board_id: str
    session_id: int
    summary_text: str
    key_themes: list[str] = []
    recommendations: list[str] = []
    created_at: datetime
    # Только темы из списка команды; у итогов, созданных до него, список пуст
    theme_stats: list[BoardThemeStat] = []

    model_config = {"from_attributes": True}


class BoardSummaryGenerateResponse(BaseModel):
    summary: BoardSummaryOut
    generated: bool = True


# ── Auto Clustering ──────────────────────────────────────────────────────────


class AutoClusterRequest(BaseModel):
    column_id: str = Field(..., max_length=100)
    username: str = Field("", max_length=100)


class ClusterGroupInfo(BaseModel):
    group: CardGroupOut
    card_ids: list[str]


class AutoClusterResult(BaseModel):
    created_groups: list[ClusterGroupInfo]
    ungrouped_card_ids: list[str]


# ── Workspace Insights & Trends ─────────────────────────────────────────────


class MoodTrendPoint(BaseModel):
    board_id: str
    board_name: str
    created_at: datetime
    mood_avg: Optional[float] = None
    mood_count: int = 0
    cards_count: int = 0
    action_items_total: int = 0
    action_items_done: int = 0


class WorkspaceInsightsOut(BaseModel):
    recurring_themes: list[str] = []
    recommendations: list[str] = []
    summary_text: str
    boards_analyzed: int = 0
    generated_by_ai: bool = False


class BulkCardsUpdateRequest(BaseModel):
    card_ids: list[str] = Field(..., min_length=1, max_length=100)
    column_id: Optional[str] = None
    group_id: Optional[str] = None
    # Длина совпадает с CardGroup.title в БД (String(120))
    group_title: Optional[str] = Field(default=None, max_length=120)
    color: Optional[str] = Field(default=None, pattern=r"^#[0-9a-fA-F]{6}$")


class BulkCardsDeleteRequest(BaseModel):
    card_ids: list[str] = Field(..., min_length=1, max_length=100)


class MergeCardsRequest(BaseModel):
    card_ids: list[str] = Field(..., min_length=2, max_length=20)
    target_text: Optional[str] = Field(default=None, max_length=2000)


class ActionItemSuggestRequest(BaseModel):
    board_id: str


class ActionItemSuggestion(BaseModel):
    title: str
    text: str
    assignee_hint: Optional[str] = None
    source_card_ids: list[str] = []


class ActionItemSuggestResponse(BaseModel):
    board_id: str
    suggestions: list[ActionItemSuggestion]


class ClusterPreviewGroup(BaseModel):
    title: str
    card_ids: list[str]


class ClusterPreviewResult(BaseModel):
    column_id: str
    groups: list[ClusterPreviewGroup]
    ungrouped_card_ids: list[str] = []


class ApplyClusterGroup(BaseModel):
    # Длина совпадает с CardGroup.title в БД (String(120))
    title: str = Field(..., min_length=1, max_length=120)
    card_ids: list[str] = Field(..., min_length=2, max_length=100)


class ApplyClustersRequest(BaseModel):
    column_id: str
    groups: list[ApplyClusterGroup] = Field(default_factory=list, max_length=50)
    username: Optional[str] = None


class BoardVotesResetOut(BaseModel):
    board_id: str
    username: str
    updated_cards: int


# ── Темы команды ─────────────────────────────────────────────────────────────


class ThemeBoardRef(BaseModel):
    id: str
    name: str
    slug: Optional[str] = None
    created_at: datetime


class WorkspaceThemeOut(BaseModel):
    """Тема команды и её повторы между спринтами."""

    id: str
    name: str
    description: str = ""
    # На скольких досках команды тема названа в итогах
    boards_count: int
    # Сколько досок подряд, заканчивая последней доской с итогами;
    # 0 — на последней доске тему не называли
    streak: int
    # Последняя доска, в итогах которой тема названа
    last_board: ThemeBoardRef


# ── Health check команды ─────────────────────────────────────────────────────


class HealthQuestion(BaseModel):
    key: str
    title: str
    hint: str


class HealthAnswersIn(BaseModel):
    """Ответы участника: ключ вопроса → 1 (красный), 2 (жёлтый) или 3 (зелёный).

    Можно прислать часть вопросов; повторный ответ заменяет прежний.
    """

    answers: dict[str, int] = Field(..., min_length=1, max_length=10)

    @field_validator("answers")
    @classmethod
    def validate_answers(cls, v: dict[str, int]) -> dict[str, int]:
        from app.health import GREEN, QUESTION_KEYS, RED

        for key, value in v.items():
            if key not in QUESTION_KEYS:
                raise ValueError(f"Неизвестный вопрос: {key[:40]}")
            if isinstance(value, bool) or not (RED <= value <= GREEN):
                raise ValueError("Ответ — 1 (красный), 2 (жёлтый) или 3 (зелёный)")
        return v


class RotiIn(BaseModel):
    """Оценка встречи: от 1 (зря потраченное время) до 5 (очень полезно)."""

    value: int = Field(..., ge=1, le=5)


class HealthQuestionSummary(HealthQuestion):
    red: int = 0
    yellow: int = 0
    green: int = 0
    answers: int = 0
    average: Optional[float] = None


class HealthRotiSummary(BaseModel):
    average: Optional[float] = None
    answers: int = 0


class HealthSummaryOut(BaseModel):
    board_id: str
    # Сколько участников ответили хотя бы на один вопрос
    participants: int = 0
    questions: list[HealthQuestionSummary] = []
    roti: HealthRotiSummary = HealthRotiSummary()
    # Ответы текущего участника: ключ вопроса (или "roti") → значение
    mine: dict[str, int] = {}


class HealthTrendPoint(BaseModel):
    board_id: str
    board_name: str
    created_at: datetime
    averages: dict[str, float] = {}
    roti_average: Optional[float] = None
