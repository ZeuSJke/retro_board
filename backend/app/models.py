import uuid
from datetime import UTC, datetime

from sqlalchemy import (
    ARRAY,
    BigInteger,
    Boolean,
    DateTime,
    ForeignKey,
    Index,
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
    # Номер поколения токенов: смена ключа доступа увеличивает его и тем самым
    # отзывает все выданные ранее сессии (claim `epoch` в JWT).
    token_epoch: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    # Токен ссылки-приглашения; перевыпуск делает старую ссылку недействительной.
    invite_token: Mapped[str | None] = mapped_column(
        String(64), nullable=True, unique=True, index=True, default=None
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=now_utc
    )

    boards: Mapped[list["Board"]] = relationship(
        "Board", back_populates="workspace", cascade="all, delete-orphan"
    )
    participants: Mapped[list["Participant"]] = relationship(
        "Participant", back_populates="workspace", cascade="all, delete-orphan"
    )


class Participant(Base):
    """Участник команды: серверная личность, привязанная к сессии в cookie.

    Создаётся при входе (имя + код команды и ключ либо ссылка-приглашение).
    Имя — подпись, а не идентификатор: тёзки — разные участники, смена имени
    ничего не отвязывает. Аккаунтов нет: новое устройство — новый участник;
    `account_id` зарезервирован под будущий вход через SSO.
    """

    __tablename__ = "participants"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=gen_uuid)
    workspace_id: Mapped[str] = mapped_column(
        String, ForeignKey("workspaces.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(60), nullable=False)
    kind: Mapped[str] = mapped_column(String(20), nullable=False, default="human")
    account_id: Mapped[str | None] = mapped_column(String(100), nullable=True, default=None)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=now_utc
    )
    last_seen_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=now_utc
    )

    workspace: Mapped["Workspace"] = relationship(
        "Workspace", back_populates="participants"
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
    # Имя ведущего хранится для отображения, личность — в active_facilitator_id
    active_facilitator: Mapped[str | None] = mapped_column(String(100), nullable=True, default=None)
    active_facilitator_id: Mapped[str | None] = mapped_column(
        String, ForeignKey("participants.id", ondelete="SET NULL"), nullable=True, default=None
    )
    active_phase: Mapped[str | None] = mapped_column(String(30), nullable=True, default=None)
    # Номер сессии — время её начала в миллисекундах (в int4 не помещается)
    active_session_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True, default=None)
    # Таймер и карточка в фокусе (JSON): переживают рестарт пода вместе с сессией
    session_state: Mapped[str | None] = mapped_column(Text, nullable=True, default=None)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=now_utc
    )
    deleted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True, default=None
    )
    # Создатель доски; NULL у досок, созданных до появления участников
    created_by_id: Mapped[str | None] = mapped_column(
        String, ForeignKey("participants.id", ondelete="SET NULL"), nullable=True, default=None
    )
    # Скрытый сбор: при hide_cards_until_reveal чужие карточки скрыты, пока не раскрыты
    cards_revealed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    workspace: Mapped["Workspace | None"] = relationship(
        "Workspace", back_populates="boards"
    )
    columns: Mapped[list["Column"]] = relationship(
        "Column",
        back_populates="board",
        cascade="all, delete-orphan",
        order_by="(Column.position, Column.id)",
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
    # Порядок всегда читается внутри родителя, поэтому индекс составной:
    # он же обслуживает поиск по внешнему ключу (первая колонка индекса).
    __table_args__ = (Index("ix_columns_board_position", "board_id", "position"),)

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
        order_by="(Card.position, Card.created_at, Card.id)",
    )
    groups: Mapped[list["CardGroup"]] = relationship(
        "CardGroup",
        back_populates="column",
        cascade="all, delete-orphan",
        order_by="(CardGroup.position, CardGroup.id)",
    )


class CardGroup(Base):
    __tablename__ = "card_groups"
    __table_args__ = (
        Index("ix_card_groups_column_position", "column_id", "position"),
    )

    id: Mapped[str] = mapped_column(String, primary_key=True, default=gen_uuid)
    column_id: Mapped[str] = mapped_column(
        String, ForeignKey("columns.id", ondelete="CASCADE")
    )
    title: Mapped[str] = mapped_column(String(120), nullable=False, default="Группа")
    position: Mapped[int] = mapped_column(Integer, default=0)

    column: Mapped["Column"] = relationship("Column", back_populates="groups")


class Card(Base):
    __tablename__ = "cards"
    __table_args__ = (Index("ix_cards_column_position", "column_id", "position"),)

    id: Mapped[str] = mapped_column(String, primary_key=True, default=gen_uuid)
    column_id: Mapped[str] = mapped_column(
        String, ForeignKey("columns.id", ondelete="CASCADE")
    )
    group_id: Mapped[str | None] = mapped_column(
        String,
        ForeignKey("card_groups.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    text: Mapped[str] = mapped_column(Text, nullable=False)
    # Имя автора — снимок для отображения (обновляется при смене имени),
    # личность — в author_id; NULL у карточек, созданных до появления участников.
    author: Mapped[str] = mapped_column(String(60), default="Аноним")
    author_id: Mapped[str | None] = mapped_column(
        String,
        ForeignKey("participants.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
        default=None,
    )
    color: Mapped[str] = mapped_column(String(20), default="#FFFFFF")
    position: Mapped[int] = mapped_column(Integer, default=0)
    # Голоса: идентификаторы участников (по одному на голос). У старых карточек
    # здесь остались имена — они учитываются в счёте, но никому не принадлежат.
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
    # Задача перенесена на другую доску: дальше живёт её копия, а эта запись
    # остаётся в истории и не считается открытой.
    superseded_by_id: Mapped[str | None] = mapped_column(
        String, ForeignKey("action_items.id", ondelete="SET NULL"), nullable=True, default=None
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
    session_id: Mapped[int] = mapped_column(BigInteger, nullable=False, index=True)
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
        # Одна оценка на участника; у старых записей participant_id пуст
        UniqueConstraint("board_id", "participant_id", name="uq_mood_board_participant"),
    )

    id: Mapped[str] = mapped_column(String, primary_key=True, default=gen_uuid)
    board_id: Mapped[str] = mapped_column(
        String, ForeignKey("boards.id", ondelete="CASCADE"), index=True
    )
    author: Mapped[str] = mapped_column(String(60), nullable=False)
    participant_id: Mapped[str | None] = mapped_column(
        String, ForeignKey("participants.id", ondelete="SET NULL"), nullable=True, default=None
    )
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


# ── Health check команды ─────────────────────────────────────────────────────


class BoardHealthAnswer(Base):
    """Ответ участника на вопрос health check или оценку встречи на доске.

    Одна строка — один ответ участника на один вопрос. Команде показывается
    только сводка; кто как ответил, наружу не отдаётся.
    """

    __tablename__ = "board_health_answers"
    __table_args__ = (
        UniqueConstraint(
            "board_id", "participant_id", "question", name="uq_health_board_participant_question"
        ),
    )

    id: Mapped[str] = mapped_column(String, primary_key=True, default=gen_uuid)
    board_id: Mapped[str] = mapped_column(
        String, ForeignKey("boards.id", ondelete="CASCADE"), nullable=False, index=True
    )
    participant_id: Mapped[str] = mapped_column(
        String, ForeignKey("participants.id", ondelete="CASCADE"), nullable=False
    )
    # Ключ вопроса из app/health.py (или "roti" — оценка встречи)
    question: Mapped[str] = mapped_column(String(40), nullable=False)
    value: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=now_utc
    )
