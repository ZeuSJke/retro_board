"""session state on boards, 64-bit session ids

Revision ID: 0009
Revises: 0008
Create Date: 2026-11-14 23:30:00.000000

Номер сессии становится временем начала в миллисекундах — в int4 не помещается.
Состояние сессии (таймер, карточка в фокусе) хранится в строке доски, чтобы
рестарт пода не обнулял его.
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0009"
down_revision: Union[str, None] = "0008"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("boards") as batch_op:
        batch_op.add_column(sa.Column("session_state", sa.Text(), nullable=True))
        batch_op.alter_column(
            "active_session_id",
            existing_type=sa.Integer(),
            type_=sa.BigInteger(),
            existing_nullable=True,
        )
    with op.batch_alter_table("board_summaries") as batch_op:
        batch_op.alter_column(
            "session_id",
            existing_type=sa.Integer(),
            type_=sa.BigInteger(),
            existing_nullable=False,
        )


def downgrade() -> None:
    # Номера сессий в миллисекундах в int4 не поместятся: активные сессии сбрасываем,
    # а итогам возвращаем номер в секундах.
    op.execute("UPDATE boards SET active_session_id = NULL")
    op.execute(
        "UPDATE board_summaries SET session_id = session_id / 1000 WHERE session_id > 2147483647"
    )
    with op.batch_alter_table("board_summaries") as batch_op:
        batch_op.alter_column(
            "session_id",
            existing_type=sa.BigInteger(),
            type_=sa.Integer(),
            existing_nullable=False,
        )
    with op.batch_alter_table("boards") as batch_op:
        batch_op.alter_column(
            "active_session_id",
            existing_type=sa.BigInteger(),
            type_=sa.Integer(),
            existing_nullable=True,
        )
        batch_op.drop_column("session_state")
