"""add max_votes to boards

Revision ID: a1b2c3d4e5f6
Revises: de9e6f923ef4
Create Date: 2026-03-18 12:00:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

# revision identifiers, used by Alembic.
revision: str = "a1b2c3d4e5f6"
down_revision: Union[str, None] = "de9e6f923ef4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = inspect(conn)
    columns = [c["name"] for c in inspector.get_columns("boards")]
    if "max_votes" not in columns:
        op.add_column(
            "boards",
            sa.Column("max_votes", sa.Integer(), nullable=False, server_default="5"),
        )


def downgrade() -> None:
    conn = op.get_bind()
    inspector = inspect(conn)
    columns = [c["name"] for c in inspector.get_columns("boards")]
    if "max_votes" in columns:
        op.drop_column("boards", "max_votes")
