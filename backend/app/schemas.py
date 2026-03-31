from __future__ import annotations
import re
from datetime import datetime
from typing import Literal, Optional
from pydantic import BaseModel, Field, field_validator

ActionItemStatus = Literal["open", "in_progress", "done"]

JiraIssueType = Literal["Task", "Bug", "Story", "Epic", "Subtask"]

_HEX_COLOR_RE = re.compile(r"^#[0-9a-fA-F]{6}$")
_JIRA_PROJECT_KEY_RE = re.compile(r"^[A-Z][A-Z0-9]{0,19}$")
_HTML_TAG_RE = re.compile(r"<[^>]+>")


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


class WorkspaceUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=120)
    access_key: Optional[str] = Field(default=None, min_length=4, max_length=100)


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
    author: str = Field(default="Аноним", max_length=60)
    color: str = Field(default="#FFFFFF", pattern=r"^#[0-9a-fA-F]{6}$")


class CardCreate(CardBase):
    column_id: str


class CardUpdate(BaseModel):
    text: Optional[str] = None
    color: Optional[str] = None
    group_id: Optional[str] = None
    column_id: Optional[str] = None
    position: Optional[int] = None

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


class CardGroupUpdate(BaseModel):
    title: Optional[str] = None


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


class ColumnUpdate(BaseModel):
    title: Optional[str] = None
    color: Optional[str] = None
    position: Optional[int] = Field(default=None, ge=0)

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
        if _HTML_TAG_RE.search(v):
            raise ValueError("Название доски не должно содержать HTML-теги")
        return v


class BoardCreate(BoardBase):
    max_votes: int = Field(default=5, ge=1, le=99)


class BoardUpdate(BaseModel):
    name: Optional[str] = None
    max_votes: Optional[int] = Field(default=None, ge=1, le=99)

    @field_validator("name")
    @classmethod
    def name_no_html(cls, v: str | None) -> str | None:
        if v is None:
            return v
        v = v.strip()
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
    position: int


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


class ActionItemUpdate(BaseModel):
    title: Optional[str] = Field(default=None, max_length=200)
    text: Optional[str] = Field(default=None, min_length=1, max_length=2000)
    assignee: Optional[str] = None
    status: Optional[ActionItemStatus] = None


class ActionItemOut(BaseModel):
    id: str
    board_id: str
    title: str = ""
    text: str
    assignee: Optional[str] = None
    jira_issue_key: Optional[str] = None
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


# ── Jira Integration ────────────────────────────────────────────────────────


class JiraCreateIssue(BaseModel):
    action_item_id: str
    project_key: str = Field(
        ...,
        min_length=1,
        max_length=20,
        pattern=r"^[A-Z][A-Z0-9]{0,19}$",
    )
    summary: str = Field(..., min_length=1, max_length=255)
    description: str = ""
    issue_type: JiraIssueType = "Task"

    @field_validator("project_key")
    @classmethod
    def validate_project_key(cls, v: str) -> str:
        if not _JIRA_PROJECT_KEY_RE.match(v):
            raise ValueError(
                "project_key must be a valid Jira project key (e.g., PROJ, ABC123)"
            )
        return v


class JiraIssueResult(BaseModel):
    jira_issue_key: str
    jira_url: str


class JiraStatus(BaseModel):
    configured: bool


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
