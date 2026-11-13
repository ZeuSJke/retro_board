"""board session state, templates, flags and board_moods

Revision ID: 0004
Revises: 0003
Create Date: 2026-11-13

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0004"
down_revision: Union[str, None] = "0003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("boards") as batch_op:
        batch_op.add_column(
            sa.Column(
                "template",
                sa.String(length=40),
                nullable=False,
                server_default="classic",
            )
        )
        batch_op.add_column(
            sa.Column(
                "is_locked",
                sa.Boolean(),
                nullable=False,
                server_default=sa.false(),
            )
        )
        batch_op.add_column(
            sa.Column(
                "hide_cards_until_reveal",
                sa.Boolean(),
                nullable=False,
                server_default=sa.false(),
            )
        )
        batch_op.add_column(
            sa.Column(
                "anonymous_votes",
                sa.Boolean(),
                nullable=False,
                server_default=sa.false(),
            )
        )
        batch_op.add_column(
            sa.Column(
                "active_facilitator",
                sa.String(length=100),
                nullable=True,
                server_default=None,
            )
        )
        batch_op.add_column(
            sa.Column(
                "active_phase",
                sa.String(length=30),
                nullable=True,
                server_default=None,
            )
        )
        batch_op.add_column(
            sa.Column(
                "active_session_id",
                sa.Integer(),
                nullable=True,
                server_default=None,
            )
        )

    op.create_table(
        "board_moods",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("board_id", sa.String(), nullable=False),
        sa.Column("author", sa.String(length=60), nullable=False),
        sa.Column("score", sa.Integer(), nullable=False),
        sa.Column("note", sa.String(length=200), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["board_id"], ["boards.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("board_id", "author", name="uq_mood_board_author"),
    )
    op.create_index(
        "ix_board_moods_board_id", "board_moods", ["board_id"], unique=False
    )


def downgrade() -> None:
    op.drop_index("ix_board_moods_board_id", table_name="board_moods")
    op.drop_table("board_moods")

    with op.batch_alter_table("boards") as batch_op:
        batch_op.drop_column("active_session_id")
        batch_op.drop_column("active_phase")
        batch_op.drop_column("active_facilitator")
        batch_op.drop_column("anonymous_votes")
        batch_op.drop_column("hide_cards_until_reveal")
        batch_op.drop_column("is_locked")
        batch_op.drop_column("template")
