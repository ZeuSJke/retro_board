"""add title to action_items

Revision ID: b7c8d9e0f1a2
Revises: f4a8b1c2d3e5
Create Date: 2026-03-28
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

# revision identifiers, used by Alembic.
revision: str = "b7c8d9e0f1a2"
down_revision: Union[str, None] = "f4a8b1c2d3e5"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = inspect(conn)
    columns = [c["name"] for c in inspector.get_columns("action_items")]

    if "title" not in columns:
        op.add_column(
            "action_items",
            sa.Column("title", sa.String(200), nullable=False, server_default=""),
        )


def downgrade() -> None:
    conn = op.get_bind()
    inspector = inspect(conn)
    columns = [c["name"] for c in inspector.get_columns("action_items")]

    if "title" in columns:
        op.drop_column("action_items", "title")
