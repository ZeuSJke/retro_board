"""add source_card_ids to action_items

Revision ID: c8d9e0f1a2b3
Revises: b7c8d9e0f1a2
Create Date: 2026-03-28
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy import inspect

# revision identifiers, used by Alembic.
revision: str = "c8d9e0f1a2b3"
down_revision: Union[str, None] = "b7c8d9e0f1a2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = inspect(conn)
    columns = [c["name"] for c in inspector.get_columns("action_items")]

    if "source_card_ids" not in columns:
        op.add_column(
            "action_items",
            sa.Column(
                "source_card_ids", ARRAY(sa.String), nullable=True, server_default="{}"
            ),
        )
        # Backfill: match existing action items to cards by text
        op.execute("""
            UPDATE action_items ai
            SET source_card_ids = matched.card_ids
            FROM (
                SELECT ai2.id AS action_item_id,
                       array_agg(c.id) AS card_ids
                FROM action_items ai2
                JOIN boards b ON b.id = ai2.board_id
                JOIN columns col ON col.board_id = b.id
                JOIN cards c ON c.column_id = col.id AND c.text = ai2.text
                WHERE ai2.source_card_ids IS NULL OR ai2.source_card_ids = '{}'
                GROUP BY ai2.id
            ) matched
            WHERE ai.id = matched.action_item_id
        """)


def downgrade() -> None:
    conn = op.get_bind()
    inspector = inspect(conn)
    columns = [c["name"] for c in inspector.get_columns("action_items")]

    if "source_card_ids" in columns:
        op.drop_column("action_items", "source_card_ids")
