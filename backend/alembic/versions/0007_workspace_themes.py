"""workspace_themes and board_themes: темы команды между спринтами

Revision ID: 0007
Revises: 0006
Create Date: 2026-11-14

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0007"
down_revision: Union[str, None] = "0006"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "workspace_themes",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("workspace_id", sa.String(), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("name_key", sa.String(length=120), nullable=False),
        sa.Column("description", sa.String(length=300), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["workspace_id"], ["workspaces.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "workspace_id", "name_key", name="uq_theme_workspace_name_key"
        ),
    )
    op.create_table(
        "board_themes",
        sa.Column("board_id", sa.String(), nullable=False),
        sa.Column("theme_id", sa.String(), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["board_id"], ["boards.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["theme_id"], ["workspace_themes.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("board_id", "theme_id"),
    )
    op.create_index(
        "ix_board_themes_theme_id", "board_themes", ["theme_id"], unique=False
    )


def downgrade() -> None:
    op.drop_index("ix_board_themes_theme_id", table_name="board_themes")
    op.drop_table("board_themes")
    op.drop_table("workspace_themes")
