"""add status to action_items

Revision ID: f4a8b1c2d3e5
Revises: ed833b699c28
Create Date: 2026-03-27
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

# revision identifiers, used by Alembic.
revision: str = "f4a8b1c2d3e5"
down_revision: Union[str, None] = "ed833b699c28"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = inspect(conn)
    columns = [c["name"] for c in inspector.get_columns("action_items")]

    if "status" not in columns:
        op.add_column(
            "action_items",
            sa.Column("status", sa.String(20), nullable=False, server_default="open"),
        )

    if "completed_at" not in columns:
        op.add_column(
            "action_items",
            sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        )


def downgrade() -> None:
    conn = op.get_bind()
    inspector = inspect(conn)
    columns = [c["name"] for c in inspector.get_columns("action_items")]

    if "completed_at" in columns:
        op.drop_column("action_items", "completed_at")

    if "status" in columns:
        op.drop_column("action_items", "status")
