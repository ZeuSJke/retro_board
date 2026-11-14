"""composite parent+position indexes instead of single-column ones

Revision ID: 0011
Revises: 0010
Create Date: 2026-11-15 00:00:00.000000

Порядок колонок, групп и карточек всегда читается внутри родителя
(`WHERE column_id = … ORDER BY position`). Отдельный индекс по `position`
для такого запроса бесполезен, а составной `(родитель, position)` обслуживает
и его, и поиск по внешнему ключу — прежний индекс по одному ключу не нужен.
"""

from typing import Sequence, Union

from alembic import op


revision: str = "0011"
down_revision: Union[str, None] = "0010"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# (таблица, колонка родителя, имя составного индекса)
_TABLES = (
    ("columns", "board_id", "ix_columns_board_position"),
    ("card_groups", "column_id", "ix_card_groups_column_position"),
    ("cards", "column_id", "ix_cards_column_position"),
)


def upgrade() -> None:
    for table, parent, composite in _TABLES:
        op.create_index(composite, table, [parent, "position"], unique=False)
        op.drop_index(f"ix_{table}_position", table_name=table)
        op.drop_index(f"ix_{table}_{parent}", table_name=table)


def downgrade() -> None:
    for table, parent, composite in _TABLES:
        op.create_index(f"ix_{table}_{parent}", table, [parent], unique=False)
        op.create_index(f"ix_{table}_position", table, ["position"], unique=False)
        op.drop_index(composite, table_name=table)
