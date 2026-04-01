"""add workspaces table

Revision ID: add_workspaces
Revises: d9f0a1b2c3d4
Create Date: 2026-03-31 23:15:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


# revision identifiers, used by Alembic.
revision: str = "add_workspaces"
down_revision: Union[str, None] = "d9f0a1b2c3d4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = inspect(conn)
    existing_tables = inspector.get_table_names()

    if "workspaces" not in existing_tables:
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


def downgrade() -> None:
    conn = op.get_bind()
    inspector = inspect(conn)

    if "workspaces" in inspector.get_table_names():
        indexes = inspector.get_indexes("workspaces")
        index_names = [i["name"] for i in indexes]
        if "ix_workspaces_slug" in index_names:
            op.drop_index(op.f("ix_workspaces_slug"), table_name="workspaces")

        op.drop_table("workspaces")
