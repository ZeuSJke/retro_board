"""add allow_multiple_votes_per_card to boards

Revision ID: 0005
Revises: 0004
Create Date: 2026-11-14 03:00:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0005"
down_revision: Union[str, None] = "0004"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("boards") as batch_op:
        batch_op.add_column(
            sa.Column(
                "allow_multiple_votes_per_card",
                sa.Boolean(),
                nullable=False,
                server_default=sa.false(),
            )
        )


def downgrade() -> None:
    with op.batch_alter_table("boards") as batch_op:
        batch_op.drop_column("allow_multiple_votes_per_card")
