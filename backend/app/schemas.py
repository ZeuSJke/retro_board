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


# ── Workspace ─────────────────────────────────────────────────────────────────


class WorkspaceLoginRequest(BaseModel):
    workspace_slug: str = Field(..., min_length=1, max_length=80)
    access_key: str = Field(..., min_length=1, max_length=100)


class WorkspaceTokenResponse(BaseModel):
    token: str
    workspace_id: str
    workspace_slug: str
    workspace_name: str


class WorkspaceCreate(BaseModel):
    slug: str = Field(..., min_length=1, max_length=80, pattern=r"^[a-z0-9-]+$")
    name: str = Field(..., min_length=1, max_length=120)
    access_key: str = Field(..., min_length=4, max_length=100)

    @field_validator("name")
    @classmethod
    def validate_name(cls, v: str) -> str:
        return _strip_non_empty(v, "Название команды") or ""


class WorkspaceUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=120)
    access_key: Optional[str] = Field(default=None, min_length=4, max_length=100)

    @field_validator("name")
    @classmethod
    def validate_name(cls, v: str | None) -> str | None:
        return _strip_non_empty(v, "Название команды")


class WorkspaceOut(BaseModel):
    id: str
    slug: str
    name: str
    created_at: datetime
    model_config = {"from_attributes": True}


class WorkspaceListItem(WorkspaceOut):
    boards_count: int = 0


# ── Admin ────────────────────────────────────────────────────────────────────


class AdminLoginRequest(BaseModel):
    login: str
    password: str


# ── Card ──────────────────────────────────────────────────────────────────────


class CardBase(BaseModel):
    text: str = Field(..., min_length=1, max_length=2000)
    author: str = Field(default="Аноним", min_length=1, max_length=60)
    color: str = Field(default="#FFFFFF", pattern=r"^#[0-9a-fA-F]{6}$")


class CardCreate(CardBase):
    column_id: str

    @field_validator("text")
    @classmethod
    def validate_text(cls, v: str) -> str:
        return _strip_non_empty(v, "Текст карточки") or ""

    @field_validator("author")
    @classmethod
    def validate_author(cls, v: str) -> str:
        return _strip_non_empty(v, "Автор") or "Аноним"


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


class CardOut(CardBase):
    id: str
    column_id: str
    group_id: Optional[str] = None
    position: int
    likes: list[str] = []
    created_at: datetime

    model_config = {"from_attributes": True}


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


class ColumnOut(ColumnBase):
    id: str
    board_id: str
    position: int
    cards: list[CardOut] = []
    groups: list[CardGroupOut] = []

    model_config = {"from_attributes": True}


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


class BoardCreate(BoardBase):
    max_votes: int = Field(default=5, ge=1, le=99)


class BoardUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=120)
    max_votes: Optional[int] = Field(default=None, ge=1, le=99)

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
    created_at: datetime
    workspace_id: Optional[str] = None
    columns: list[ColumnOut] = []

    model_config = {"from_attributes": True}


class BoardListItem(BoardBase):
    id: str
    slug: Optional[str] = None
    max_votes: int
    created_at: datetime
    workspace_id: Optional[str] = None
    action_items_total: int = 0
    action_items_open: int = 0
    has_summary: bool = False
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


class BoardSummaryOut(BaseModel):
    id: str
    board_id: str
    session_id: int
    summary_text: str
    key_themes: list[str] = []
    recommendations: list[str] = []
    created_at: datetime

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
