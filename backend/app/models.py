import uuid
from datetime import datetime
from sqlalchemy import String, Integer, DateTime, ForeignKey, Text, ARRAY
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID
from app.database import Base


def gen_uuid():
    return str(uuid.uuid4())


class Board(Base):
    __tablename__ = "boards"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=gen_uuid)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    columns: Mapped[list["Column"]] = relationship(
        "Column", back_populates="board",
        cascade="all, delete-orphan",
        order_by="Column.position",
    )


class Column(Base):
    __tablename__ = "columns"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=gen_uuid)
    board_id: Mapped[str] = mapped_column(String, ForeignKey("boards.id", ondelete="CASCADE"))
    title: Mapped[str] = mapped_column(String(80), nullable=False)
    color: Mapped[str] = mapped_column(String(20), default="#6750A4")
    position: Mapped[int] = mapped_column(Integer, default=0)

    board: Mapped["Board"] = relationship("Board", back_populates="columns")
    cards: Mapped[list["Card"]] = relationship(
        "Card", back_populates="column",
        cascade="all, delete-orphan",
        order_by="Card.position",
    )


class Card(Base):
    __tablename__ = "cards"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=gen_uuid)
    column_id: Mapped[str] = mapped_column(String, ForeignKey("columns.id", ondelete="CASCADE"))
    text: Mapped[str] = mapped_column(Text, nullable=False)
    author: Mapped[str] = mapped_column(String(60), default="Аноним")
    color: Mapped[str] = mapped_column(String(20), default="#FFFFFF")
    position: Mapped[int] = mapped_column(Integer, default=0)
    likes: Mapped[list[str]] = mapped_column(ARRAY(String), default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    column: Mapped["Column"] = relationship("Column", back_populates="cards")
