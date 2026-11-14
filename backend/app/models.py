import uuid
from datetime import UTC, datetime

from sqlalchemy import (
    ARRAY,
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


def gen_uuid() -> str:
    return str(uuid.uuid4())


def now_utc() -> datetime:
    return datetime.now(UTC)


class Workspace(Base):
    __tablename__ = "workspaces"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=gen_uuid)
    slug: Mapped[str] = mapped_column(
        String(80), nullable=False, unique=True, index=True
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    access_key_hash: Mapped[str] = mapped_column(String(200), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=now_utc
    )

    boards: Mapped[list["Board"]] = relationship(
        "Board", back_populates="workspace", cascade="all, delete-orphan"
    )


class Board(Base):
    __tablename__ = "boards"
    __table_args__ = (
        UniqueConstraint("workspace_id", "name", name="uq_board_workspace_name"),
        UniqueConstraint("workspace_id", "slug", name="uq_board_workspace_slug"),
    )

    id: Mapped[str] = mapped_column(String, primary_key=True, default=gen_uuid)
    workspace_id: Mapped[str | None] = mapped_column(
        String,
        ForeignKey("workspaces.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    slug: Mapped[str | None] = mapped_column(String(150), nullable=True, index=True)
    max_votes: Mapped[int] = mapped_column(Integer, default=5)
    template: Mapped[str] = mapped_column(String(40), nullable=False, default="classic")
    is_locked: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    hide_cards_until_reveal: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    anonymous_votes: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    allow_multiple_votes_per_card: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    active_facilitator: Mapped[str | None] = mapped_column(String(100), nullable=True, default=None)
    active_phase: Mapped[str | None] = mapped_column(String(30), nullable=True, default=None)
    active_session_id: Mapped[int | None] = mapped_column(Integer, nullable=True, default=None)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=now_utc
    )
    deleted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True, default=None
    )

    workspace: Mapped["Workspace | None"] = relationship(
        "Workspace", back_populates="boards"
    )
    columns: Mapped[list["Column"]] = relationship(
        "Column",
        back_populates="board",
        cascade="all, delete-orphan",
        order_by="Column.position",
    )
    action_items: Mapped[list["ActionItem"]] = relationship(
        "ActionItem",
        back_populates="board",
        cascade="all, delete-orphan",
        order_by="ActionItem.created_at",
    )
    summaries: Mapped[list["BoardSummary"]] = relationship(
        "BoardSummary",
        back_populates="board",
        cascade="all, delete-orphan",
        order_by="BoardSummary.created_at.desc()",
    )
    moods: Mapped[list["BoardMood"]] = relationship(
        "BoardMood",
        back_populates="board",
        cascade="all, delete-orphan",
        order_by="BoardMood.created_at",
    )


class Column(Base):
    __tablename__ = "columns"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=gen_uuid)
    board_id: Mapped[str] = mapped_column(
        String, ForeignKey("boards.id", ondelete="CASCADE"), index=True
    )
    title: Mapped[str] = mapped_column(String(80), nullable=False)
    color: Mapped[str] = mapped_column(String(20), default="#6750A4")
    position: Mapped[int] = mapped_column(Integer, default=0, index=True)

    board: Mapped["Board"] = relationship("Board", back_populates="columns")
    cards: Mapped[list["Card"]] = relationship(
        "Card",
        back_populates="column",
        cascade="all, delete-orphan",
        order_by="Card.position",
    )
    groups: Mapped[list["CardGroup"]] = relationship(
        "CardGroup",
        back_populates="column",
        cascade="all, delete-orphan",
        order_by="CardGroup.position",
    )


class CardGroup(Base):
    __tablename__ = "card_groups"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=gen_uuid)
    column_id: Mapped[str] = mapped_column(
        String, ForeignKey("columns.id", ondelete="CASCADE"), index=True
    )
    title: Mapped[str] = mapped_column(String(120), nullable=False, default="Группа")
    position: Mapped[int] = mapped_column(Integer, default=0, index=True)

    column: Mapped["Column"] = relationship("Column", back_populates="groups")


class Card(Base):
    __tablename__ = "cards"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=gen_uuid)
    column_id: Mapped[str] = mapped_column(
        String, ForeignKey("columns.id", ondelete="CASCADE"), index=True
    )
    group_id: Mapped[str | None] = mapped_column(
        String,
        ForeignKey("card_groups.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    text: Mapped[str] = mapped_column(Text, nullable=False)
    author: Mapped[str] = mapped_column(String(60), default="Аноним")
    color: Mapped[str] = mapped_column(String(20), default="#FFFFFF")
    position: Mapped[int] = mapped_column(Integer, default=0, index=True)
    likes: Mapped[list[str]] = mapped_column(ARRAY(String), default=list)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=now_utc
    )

    column: Mapped["Column"] = relationship("Column", back_populates="cards")


class ActionItem(Base):
    __tablename__ = "action_items"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=gen_uuid)
    board_id: Mapped[str] = mapped_column(
        String, ForeignKey("boards.id", ondelete="CASCADE"), index=True
    )
    title: Mapped[str] = mapped_column(String(200), nullable=False, default="")
    text: Mapped[str] = mapped_column(Text, nullable=False)
    assignee: Mapped[str | None] = mapped_column(String(60), nullable=True)
    source_card_ids: Mapped[list[str]] = mapped_column(ARRAY(String), default=list)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="open")
    completed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=now_utc
    )

    board: Mapped["Board"] = relationship("Board", back_populates="action_items")


class BoardSummary(Base):
    __tablename__ = "board_summaries"
    __table_args__ = (
        UniqueConstraint(
            "board_id", "session_id", name="uq_summary_board_session"
        ),
    )

    id: Mapped[str] = mapped_column(String, primary_key=True, default=gen_uuid)
    board_id: Mapped[str] = mapped_column(
        String, ForeignKey("boards.id", ondelete="CASCADE"), index=True
    )
    session_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    summary_text: Mapped[str] = mapped_column(Text, nullable=False)
    key_themes: Mapped[list[str]] = mapped_column(ARRAY(String), default=list)
    recommendations: Mapped[list[str]] = mapped_column(ARRAY(String), default=list)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=now_utc
    )

    board: Mapped["Board"] = relationship("Board", back_populates="summaries")


class BoardMood(Base):
    __tablename__ = "board_moods"
    __table_args__ = (
        UniqueConstraint("board_id", "author", name="uq_mood_board_author"),
    )

    id: Mapped[str] = mapped_column(String, primary_key=True, default=gen_uuid)
    board_id: Mapped[str] = mapped_column(
        String, ForeignKey("boards.id", ondelete="CASCADE"), index=True
    )
    author: Mapped[str] = mapped_column(String(60), nullable=False)
    score: Mapped[int] = mapped_column(Integer, nullable=False)
    note: Mapped[str | None] = mapped_column(String(200), nullable=True, default=None)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=now_utc
    )

    board: Mapped["Board"] = relationship("Board", back_populates="moods")


# ── Темы команды ─────────────────────────────────────────────────────────────


class WorkspaceTheme(Base):
    """Тема команды: одно название на все ретроспективы workspace."""

    __tablename__ = "workspace_themes"
    __table_args__ = (
        # name_key — нормализованное название: одна тема не заводится дважды
        # из-за регистра, пробелов или кавычек
        UniqueConstraint(
            "workspace_id", "name_key", name="uq_theme_workspace_name_key"
        ),
    )

    id: Mapped[str] = mapped_column(String, primary_key=True, default=gen_uuid)
    workspace_id: Mapped[str] = mapped_column(
        String, ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    name_key: Mapped[str] = mapped_column(String(120), nullable=False)
    description: Mapped[str] = mapped_column(String(300), nullable=False, default="")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=now_utc
    )


class BoardTheme(Base):
    """Связь «тема ↔ доска»: тема названа в итогах этой доски."""

    __tablename__ = "board_themes"

    board_id: Mapped[str] = mapped_column(
        String, ForeignKey("boards.id", ondelete="CASCADE"), primary_key=True
    )
    theme_id: Mapped[str] = mapped_column(
        String,
        ForeignKey("workspace_themes.id", ondelete="CASCADE"),
        primary_key=True,
        index=True,
    )
    # Порядок темы в итогах доски (как в BoardSummary.key_themes)
    position: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
