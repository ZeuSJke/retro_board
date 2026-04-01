"""add_action_items

Revision ID: ed833b699c28
Revises: a1b2c3d4e5f6
Create Date: 2026-03-21 22:33:56.248441

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

# revision identifiers, used by Alembic.
revision: str = "ed833b699c28"
down_revision: Union[str, None] = "a1b2c3d4e5f6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = inspect(conn)
    existing_tables = inspector.get_table_names()

    if "action_items" not in existing_tables:
        op.create_table(
            "action_items",
            sa.Column("id", sa.String(), nullable=False),
            sa.Column("board_id", sa.String(), nullable=False),
            sa.Column("text", sa.Text(), nullable=False),
            sa.Column("assignee", sa.String(length=60), nullable=True),
            sa.Column("jira_issue_key", sa.String(length=30), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(["board_id"], ["boards.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index(
            op.f("ix_action_items_board_id"), "action_items", ["board_id"], unique=False
        )


def downgrade() -> None:
    conn = op.get_bind()
    inspector = inspect(conn)

    indexes = inspector.get_indexes("action_items")
    index_names = [i["name"] for i in indexes]
    if "ix_action_items_board_id" in index_names:
        op.drop_index(op.f("ix_action_items_board_id"), table_name="action_items")

    if "action_items" in inspector.get_table_names():
        op.drop_table("action_items")
