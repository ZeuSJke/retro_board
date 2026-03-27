from __future__ import annotations
import re
from datetime import datetime
from typing import Literal, Optional
from pydantic import BaseModel, Field, field_validator

ActionItemStatus = Literal["open", "in_progress", "done"]

_HEX_COLOR_RE = re.compile(r"^#[0-9a-fA-F]{6}$")


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

class BoardCreate(BoardBase):
    max_votes: int = Field(default=5, ge=1, le=99)

class BoardUpdate(BaseModel):
    name: Optional[str] = None
    max_votes: Optional[int] = Field(default=None, ge=1, le=99)

class BoardOut(BoardBase):
    id: str
    slug: Optional[str] = None
    max_votes: int
    created_at: datetime
    columns: list[ColumnOut] = []

    model_config = {"from_attributes": True}

class BoardListItem(BoardBase):
    id: str
    slug: Optional[str] = None
    max_votes: int
    created_at: datetime
    action_items_total: int = 0
    action_items_open: int = 0
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
    status: str = "open"
    completed_at: Optional[datetime] = None
    created_at: datetime

    model_config = {"from_attributes": True}

class DashboardActionItem(ActionItemOut):
    board_name: str = ""


# ── Jira Integration ────────────────────────────────────────────────────────

class JiraCreateIssue(BaseModel):
    action_item_id: str
    project_key: str = Field(..., min_length=1, max_length=20)
    summary: str = Field(..., min_length=1, max_length=255)
    description: str = ""
    issue_type: str = "Task"

class JiraIssueResult(BaseModel):
    jira_issue_key: str
    jira_url: str

class JiraStatus(BaseModel):
    configured: bool


# ── Carry Forward ──────────────────────────────────────────────────────────

class CarryForwardRequest(BaseModel):
    source_board_id: str
    target_board_id: str
