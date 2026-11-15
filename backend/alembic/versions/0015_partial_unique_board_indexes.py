"""partial unique indexes for live boards instead of name mangling on delete

Revision ID: 0015
Revises: 0014
Create Date: 2026-11-15 18:00:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "0015"
down_revision: Union[str, None] = "0014"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    if op.get_bind().dialect.name == "sqlite":
        with op.batch_alter_table("boards") as batch_op:
            batch_op.drop_constraint("uq_board_workspace_name", type_="unique")
            batch_op.drop_constraint("uq_board_workspace_slug", type_="unique")
    else:
        op.drop_constraint("uq_board_workspace_name", "boards", type_="unique")
        op.drop_constraint("uq_board_workspace_slug", "boards", type_="unique")

    op.create_index(
        "uq_board_workspace_name",
        "boards",
        ["workspace_id", "name"],
        unique=True,
        postgresql_where=sa.text("deleted_at IS NULL"),
        sqlite_where=sa.text("deleted_at IS NULL"),
    )
    op.create_index(
        "uq_board_workspace_slug",
        "boards",
        ["workspace_id", "slug"],
        unique=True,
        postgresql_where=sa.text("deleted_at IS NULL"),
        sqlite_where=sa.text("deleted_at IS NULL"),
    )


def downgrade() -> None:
    op.drop_index("uq_board_workspace_slug", table_name="boards")
    op.drop_index("uq_board_workspace_name", table_name="boards")
    if op.get_bind().dialect.name == "sqlite":
        with op.batch_alter_table("boards") as batch_op:
            batch_op.create_unique_constraint(
                "uq_board_workspace_name", ["workspace_id", "name"]
            )
            batch_op.create_unique_constraint(
                "uq_board_workspace_slug", ["workspace_id", "slug"]
            )
    else:
        op.create_unique_constraint(
            "uq_board_workspace_name", "boards", ["workspace_id", "name"]
        )
        op.create_unique_constraint(
            "uq_board_workspace_slug", "boards", ["workspace_id", "slug"]
        )
