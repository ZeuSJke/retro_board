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
    column_id: Optional[str] = None
    position: Optional[int] = None

class CardOut(CardBase):
    id: str
    column_id: str
    position: int
    likes: list[str] = []
    created_at: datetime

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
    created_at: datetime
    columns: list[ColumnOut] = []

    model_config = {"from_attributes": True}

class BoardListItem(BoardBase):
    id: str
    created_at: datetime
    model_config = {"from_attributes": True}


# ── Move card ─────────────────────────────────────────────────────────────────

class MoveCard(BaseModel):
    column_id: str
    position: int
