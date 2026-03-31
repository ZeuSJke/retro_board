"""add workspace_id to boards

Revision ID: add_workspace_id_to_boards
Revises: add_workspaces
Create Date: 2026-03-31 23:25:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


# revision identifiers, used by Alembic.
revision: str = "add_workspace_id_to_boards"
down_revision: Union[str, None] = "add_workspaces"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Safety check: only add column if it doesn't exist (idempotent migration)
    conn = op.get_bind()
    inspector = inspect(conn)
    columns = [c["name"] for c in inspector.get_columns("boards")]
    if "workspace_id" not in columns:
        op.add_column(
            "boards",
            sa.Column(
                "workspace_id",
                sa.String(),
                sa.ForeignKey("workspaces.id", ondelete="SET NULL"),
                nullable=True,
            ),
        )
        op.create_index(
            "ix_boards_workspace_id", "boards", ["workspace_id"], unique=False
        )


def downgrade() -> None:
    conn = op.get_bind()
    inspector = inspect(conn)
    # Only drop index if it exists
    indexes = inspector.get_indexes("boards")
    index_names = [i["name"] for i in indexes]
    if "ix_boards_workspace_id" in index_names:
        op.drop_index("ix_boards_workspace_id", table_name="boards")
    # Only drop column if it exists
    columns = [c["name"] for c in inspector.get_columns("boards")]
    if "workspace_id" in columns:
        op.drop_column("boards", "workspace_id")
