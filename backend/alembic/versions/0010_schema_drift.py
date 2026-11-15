"""align schema with models: NOT NULL arrays, duplicate unique on workspaces.slug

Revision ID: 0010
Revises: 0009
Create Date: 2026-11-15 00:00:00.000000

`alembic check` показывал расхождения, накопившиеся с первой миграции:
массивы в моделях обязательные, а в БД допускали NULL, и у `workspaces.slug`
было два одинаковых ограничения уникальности — именованный индекс и
безымянное ограничение. После выравнивания проверка идёт в CI.
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0010"
down_revision: Union[str, None] = "0009"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_ARRAYS = (
    ("action_items", "source_card_ids"),
    ("board_summaries", "key_themes"),
    ("board_summaries", "recommendations"),
)


def upgrade() -> None:
    # Массивы и безымянные ограничения — особенности PostgreSQL; в SQLite
    # миграции не исполняются (тесты создают схему из моделей).
    if op.get_bind().dialect.name != "postgresql":
        return
    for table, column in _ARRAYS:
        op.execute(f"UPDATE {table} SET {column} = '{{}}' WHERE {column} IS NULL")
        op.alter_column(
            table, column, existing_type=sa.ARRAY(sa.String()), nullable=False
        )
    # Уникальность slug остаётся за индексом ix_workspaces_slug
    op.execute("ALTER TABLE workspaces DROP CONSTRAINT IF EXISTS workspaces_slug_key")


def downgrade() -> None:
    if op.get_bind().dialect.name != "postgresql":
        return
    op.create_unique_constraint("workspaces_slug_key", "workspaces", ["slug"])
    for table, column in _ARRAYS:
        op.alter_column(
            table, column, existing_type=sa.ARRAY(sa.String()), nullable=True
        )
