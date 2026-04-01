"""initial schema

Revision ID: de9e6f923ef4
Revises:
Create Date: 2026-03-18 01:10:24.565366

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

# revision identifiers, used by Alembic.
revision: str = "de9e6f923ef4"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = inspect(conn)
    existing_tables = inspector.get_table_names()

    if "boards" not in existing_tables:
        op.create_table(
            "boards",
            sa.Column("id", sa.String(), nullable=False),
            sa.Column("name", sa.String(length=120), nullable=False),
            sa.Column("slug", sa.String(length=150), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("name"),
        )
        op.create_index(op.f("ix_boards_slug"), "boards", ["slug"], unique=True)

    if "columns" not in existing_tables:
        op.create_table(
            "columns",
            sa.Column("id", sa.String(), nullable=False),
            sa.Column("board_id", sa.String(), nullable=False),
            sa.Column("title", sa.String(length=80), nullable=False),
            sa.Column(
                "color", sa.String(length=20), nullable=False, server_default="#6750A4"
            ),
            sa.Column("position", sa.Integer(), nullable=False),
            sa.ForeignKeyConstraint(["board_id"], ["boards.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index(
            op.f("ix_columns_board_id"), "columns", ["board_id"], unique=False
        )
        op.create_index(
            op.f("ix_columns_position"), "columns", ["position"], unique=False
        )

    if "card_groups" not in existing_tables:
        op.create_table(
            "card_groups",
            sa.Column("id", sa.String(), nullable=False),
            sa.Column("column_id", sa.String(), nullable=False),
            sa.Column(
                "title", sa.String(length=120), nullable=False, server_default="Группа"
            ),
            sa.Column("position", sa.Integer(), nullable=False),
            sa.ForeignKeyConstraint(["column_id"], ["columns.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index(
            op.f("ix_card_groups_column_id"), "card_groups", ["column_id"], unique=False
        )
        op.create_index(
            op.f("ix_card_groups_position"), "card_groups", ["position"], unique=False
        )

    if "cards" not in existing_tables:
        op.create_table(
            "cards",
            sa.Column("id", sa.String(), nullable=False),
            sa.Column("column_id", sa.String(), nullable=False),
            sa.Column("group_id", sa.String(), nullable=True),
            sa.Column("text", sa.Text(), nullable=False),
            sa.Column(
                "author", sa.String(length=60), nullable=False, server_default="Аноним"
            ),
            sa.Column(
                "color", sa.String(length=20), nullable=False, server_default="#FFFFFF"
            ),
            sa.Column("position", sa.Integer(), nullable=False),
            sa.Column("likes", sa.ARRAY(sa.String()), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(["column_id"], ["columns.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(
                ["group_id"], ["card_groups.id"], ondelete="SET NULL"
            ),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index(
            op.f("ix_cards_column_id"), "cards", ["column_id"], unique=False
        )
        op.create_index(op.f("ix_cards_group_id"), "cards", ["group_id"], unique=False)
        op.create_index(op.f("ix_cards_position"), "cards", ["position"], unique=False)


def downgrade() -> None:
    conn = op.get_bind()
    inspector = inspect(conn)

    indexes = inspector.get_indexes("cards")
    index_names = [i["name"] for i in indexes]
    if "ix_cards_position" in index_names:
        op.drop_index(op.f("ix_cards_position"), table_name="cards")
    if "ix_cards_group_id" in index_names:
        op.drop_index(op.f("ix_cards_group_id"), table_name="cards")
    if "ix_cards_column_id" in index_names:
        op.drop_index(op.f("ix_cards_column_id"), table_name="cards")

    if "cards" in inspector.get_table_names():
        op.drop_table("cards")

    indexes = inspector.get_indexes("card_groups")
    index_names = [i["name"] for i in indexes]
    if "ix_card_groups_position" in index_names:
        op.drop_index(op.f("ix_card_groups_position"), table_name="card_groups")
    if "ix_card_groups_column_id" in index_names:
        op.drop_index(op.f("ix_card_groups_column_id"), table_name="card_groups")

    if "card_groups" in inspector.get_table_names():
        op.drop_table("card_groups")

    indexes = inspector.get_indexes("columns")
    index_names = [i["name"] for i in indexes]
    if "ix_columns_position" in index_names:
        op.drop_index(op.f("ix_columns_position"), table_name="columns")
    if "ix_columns_board_id" in index_names:
        op.drop_index(op.f("ix_columns_board_id"), table_name="columns")

    if "columns" in inspector.get_table_names():
        op.drop_table("columns")

    indexes = inspector.get_indexes("boards")
    index_names = [i["name"] for i in indexes]
    if "ix_boards_slug" in index_names:
        op.drop_index(op.f("ix_boards_slug"), table_name="boards")

    if "boards" in inspector.get_table_names():
        op.drop_table("boards")
