"""legacy boards with hidden collection are revealed

Revision ID: 0013
Revises: 0012
Create Date: 2026-11-15 00:00:00.000000

Доски, созданные до появления участников (`created_by_id IS NULL`), могли иметь
включённое «скрывать карточки до раскрытия». Раньше скрытие жило только в
интерфейсе; теперь его применяет сервер, а у старых карточек нет автора — они
оказались бы скрыты для всех, включая тех, кто их написал, и на
заблокированной доске их было бы нечем раскрыть. Такие доски считаются раскрытыми.
"""

from typing import Sequence, Union

from alembic import op


revision: str = "0013"
down_revision: Union[str, None] = "0012"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        "UPDATE boards SET cards_revealed = true "
        "WHERE created_by_id IS NULL AND hide_cards_until_reveal = true "
        "AND cards_revealed = false"
    )


def downgrade() -> None:
    # Обратного шага нет: какие доски были раскрыты этой миграцией, неизвестно,
    # а скрыть их заново значило бы спрятать карточки от собственных авторов.
    pass
