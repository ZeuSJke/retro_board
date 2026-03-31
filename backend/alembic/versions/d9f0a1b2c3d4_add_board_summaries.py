"""add board_summaries table

Revision ID: d9f0a1b2c3d4
Revises: c8d9e0f1a2b3
Create Date: 2026-03-31
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import ARRAY

# revision identifiers, used by Alembic.
revision: str = "d9f0a1b2c3d4"
down_revision: Union[str, None] = "be1d3d296f64"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "board_summaries",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("board_id", sa.String(), nullable=False),
        sa.Column("session_id", sa.Integer(), nullable=False),
        sa.Column("summary_text", sa.Text(), nullable=False),
        sa.Column("key_themes", ARRAY(sa.String()), nullable=True, server_default="{}"),
        sa.Column(
            "recommendations", ARRAY(sa.String()), nullable=True, server_default="{}"
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
    op.create_index(
        op.f("ix_board_summaries_created_at"),
        "board_summaries",
        ["created_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_board_summaries_created_at"), table_name="board_summaries")
    op.drop_index(op.f("ix_board_summaries_session_id"), table_name="board_summaries")
    op.drop_index(op.f("ix_board_summaries_board_id"), table_name="board_summaries")
    op.drop_table("board_summaries")
