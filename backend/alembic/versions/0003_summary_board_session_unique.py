"""unique(board_id, session_id) for board_summaries

Revision ID: 0003
Revises: 0002
Create Date: 2026-09-30

"""

from typing import Sequence, Union

from alembic import op

revision: str = "0003"
down_revision: Union[str, None] = "0002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("board_summaries") as batch_op:
        batch_op.create_unique_constraint(
            "uq_summary_board_session", ["board_id", "session_id"]
        )


def downgrade() -> None:
    with op.batch_alter_table("board_summaries") as batch_op:
        batch_op.drop_constraint("uq_summary_board_session", type_="unique")
