"""add status to action_items

Revision ID: f4a8b1c2d3e5
Revises: ed833b699c28
Create Date: 2026-03-27
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "f4a8b1c2d3e5"
down_revision: Union[str, None] = "ed833b699c28"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "action_items",
        sa.Column("status", sa.String(20), nullable=False, server_default="open"),
    )
    op.add_column(
        "action_items",
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("action_items", "completed_at")
    op.drop_column("action_items", "status")
