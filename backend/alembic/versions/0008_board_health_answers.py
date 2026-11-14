"""board_health_answers: health check команды и оценка встречи

Revision ID: 0008
Revises: 0007
Create Date: 2026-11-14 23:00:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0008"
down_revision: Union[str, None] = "0007"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "board_health_answers",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("board_id", sa.String(), nullable=False),
        sa.Column("participant_id", sa.String(), nullable=False),
        sa.Column("question", sa.String(length=40), nullable=False),
        sa.Column("value", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["board_id"], ["boards.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["participant_id"], ["participants.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "board_id", "participant_id", "question", name="uq_health_board_participant_question"
        ),
    )
    op.create_index("ix_board_health_answers_board_id", "board_health_answers", ["board_id"])


def downgrade() -> None:
    op.drop_index("ix_board_health_answers_board_id", table_name="board_health_answers")
    op.drop_table("board_health_answers")
