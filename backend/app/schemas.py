from __future__ import annotations
from datetime import datetime
from typing import Optional
from pydantic import BaseModel, Field


# ── Card ──────────────────────────────────────────────────────────────────────

class CardBase(BaseModel):
    text: str = Field(..., min_length=1, max_length=2000)
    author: str = Field(default="Аноним", max_length=60)
    color: str = Field(default="#FFFFFF", max_length=20)

class CardCreate(CardBase):
    column_id: str

class CardUpdate(BaseModel):
    text: Optional[str] = None
    color: Optional[str] = None
    group_id: Optional[str] = None
    column_id: Optional[str] = None
    position: Optional[int] = None

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
    color: str = Field(default="#6750A4", max_length=20)

class ColumnCreate(ColumnBase):
    board_id: str

class ColumnUpdate(BaseModel):
    title: Optional[str] = None
    color: Optional[str] = None
    position: Optional[int] = None

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
    pass

class BoardUpdate(BaseModel):
    name: Optional[str] = None

class BoardOut(BoardBase):
    id: str
    slug: Optional[str] = None
    created_at: datetime
    columns: list[ColumnOut] = []

    model_config = {"from_attributes": True}

class BoardListItem(BoardBase):
    id: str
    slug: Optional[str] = None
    created_at: datetime
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
