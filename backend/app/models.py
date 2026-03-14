import uuid
from datetime import UTC, datetime

from sqlalchemy import ARRAY, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


def gen_uuid() -> str:
    return str(uuid.uuid4())


def now_utc() -> datetime:
    return datetime.now(UTC)


class Board(Base):
    __tablename__ = "boards"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=gen_uuid)
    name: Mapped[str] = mapped_column(String(120), nullable=False, unique=True)
    slug: Mapped[str | None] = mapped_column(String(150), unique=True, nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=now_utc
    )

    columns: Mapped[list["Column"]] = relationship(
        "Column",
        back_populates="board",
        cascade="all, delete-orphan",
        order_by="Column.position",
    )


class Column(Base):
    __tablename__ = "columns"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=gen_uuid)
    board_id: Mapped[str] = mapped_column(
        String, ForeignKey("boards.id", ondelete="CASCADE")
    )
    title: Mapped[str] = mapped_column(String(80), nullable=False)
    color: Mapped[str] = mapped_column(String(20), default="#6750A4")
    position: Mapped[int] = mapped_column(Integer, default=0)

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
        String, ForeignKey("columns.id", ondelete="CASCADE")
    )
    title: Mapped[str] = mapped_column(String(120), nullable=False, default="Группа")
    position: Mapped[int] = mapped_column(Integer, default=0)

    column: Mapped["Column"] = relationship("Column", back_populates="groups")


class Card(Base):
    __tablename__ = "cards"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=gen_uuid)
    column_id: Mapped[str] = mapped_column(
        String, ForeignKey("columns.id", ondelete="CASCADE")
    )
    group_id: Mapped[str | None] = mapped_column(
        String, ForeignKey("card_groups.id", ondelete="SET NULL"), nullable=True
    )
    text: Mapped[str] = mapped_column(Text, nullable=False)
    author: Mapped[str] = mapped_column(String(60), default="Аноним")
    color: Mapped[str] = mapped_column(String(20), default="#FFFFFF")
    position: Mapped[int] = mapped_column(Integer, default=0)
    likes: Mapped[list[str]] = mapped_column(ARRAY(String), default=list)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=now_utc
    )

    column: Mapped["Column"] = relationship("Column", back_populates="cards")
