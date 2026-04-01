"""initial schema

Revision ID: 0001
Revises:
Create Date: 2026-04-01

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── workspaces ──────────────────────────────────────────────────────
    op.create_table(
        "workspaces",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("slug", sa.String(length=80), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("access_key_hash", sa.String(length=200), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("slug"),
    )
    op.create_index(op.f("ix_workspaces_slug"), "workspaces", ["slug"], unique=True)

    # ── boards ──────────────────────────────────────────────────────────
    op.create_table(
        "boards",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("workspace_id", sa.String(), nullable=True),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("slug", sa.String(length=150), nullable=True),
        sa.Column("max_votes", sa.Integer(), nullable=False, server_default="5"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(
            ["workspace_id"], ["workspaces.id"], ondelete="SET NULL"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("workspace_id", "name", name="uq_board_workspace_name"),
        sa.UniqueConstraint("workspace_id", "slug", name="uq_board_workspace_slug"),
    )
    op.create_index(
        op.f("ix_boards_workspace_id"), "boards", ["workspace_id"], unique=False
    )
    op.create_index(op.f("ix_boards_slug"), "boards", ["slug"], unique=False)

    # ── columns ─────────────────────────────────────────────────────────
    op.create_table(
        "columns",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("board_id", sa.String(), nullable=False),
        sa.Column("title", sa.String(length=80), nullable=False),
        sa.Column(
            "color", sa.String(length=20), nullable=False, server_default="#6750A4"
        ),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["board_id"], ["boards.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_columns_board_id"), "columns", ["board_id"], unique=False
    )
    op.create_index(
        op.f("ix_columns_position"), "columns", ["position"], unique=False
    )

    # ── card_groups ─────────────────────────────────────────────────────
    op.create_table(
        "card_groups",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("column_id", sa.String(), nullable=False),
        sa.Column(
            "title",
            sa.String(length=120),
            nullable=False,
            server_default="Группа",
        ),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["column_id"], ["columns.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_card_groups_column_id"), "card_groups", ["column_id"], unique=False
    )
    op.create_index(
        op.f("ix_card_groups_position"), "card_groups", ["position"], unique=False
    )

    # ── cards ───────────────────────────────────────────────────────────
    op.create_table(
        "cards",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("column_id", sa.String(), nullable=False),
        sa.Column("group_id", sa.String(), nullable=True),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column(
            "author", sa.String(length=60), nullable=False, server_default="Аноним"
        ),
        sa.Column(
            "color", sa.String(length=20), nullable=False, server_default="#FFFFFF"
        ),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("likes", sa.ARRAY(sa.String()), nullable=False, server_default="{}"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["column_id"], ["columns.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["group_id"], ["card_groups.id"], ondelete="SET NULL"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_cards_column_id"), "cards", ["column_id"], unique=False
    )
    op.create_index(op.f("ix_cards_group_id"), "cards", ["group_id"], unique=False)
    op.create_index(op.f("ix_cards_position"), "cards", ["position"], unique=False)

    # ── action_items ────────────────────────────────────────────────────
    op.create_table(
        "action_items",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("board_id", sa.String(), nullable=False),
        sa.Column("title", sa.String(length=200), nullable=False, server_default=""),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("assignee", sa.String(length=60), nullable=True),
        sa.Column("jira_issue_key", sa.String(length=30), nullable=True),
        sa.Column(
            "source_card_ids",
            sa.ARRAY(sa.String()),
            nullable=True,
            server_default="{}",
        ),
        sa.Column(
            "status", sa.String(length=20), nullable=False, server_default="open"
        ),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["board_id"], ["boards.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_action_items_board_id"),
        "action_items",
        ["board_id"],
        unique=False,
    )

    # ── board_summaries ─────────────────────────────────────────────────
    op.create_table(
        "board_summaries",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("board_id", sa.String(), nullable=False),
        sa.Column("session_id", sa.Integer(), nullable=False),
        sa.Column("summary_text", sa.Text(), nullable=False),
        sa.Column(
            "key_themes",
            sa.ARRAY(sa.String()),
            nullable=True,
            server_default="{}",
        ),
        sa.Column(
            "recommendations",
            sa.ARRAY(sa.String()),
            nullable=True,
            server_default="{}",
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["board_id"], ["boards.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_board_summaries_board_id"),
        "board_summaries",
        ["board_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_board_summaries_session_id"),
        "board_summaries",
        ["session_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_table("board_summaries")
    op.drop_table("action_items")
    op.drop_table("cards")
    op.drop_table("card_groups")
    op.drop_table("columns")
    op.drop_table("boards")
    op.drop_table("workspaces")
