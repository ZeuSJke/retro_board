"""participants.revoked_at: logout ends the session on the server

Revision ID: 0012
Revises: 0011
Create Date: 2026-11-15 00:00:00.000000

Выход раньше только сбрасывал cookie: сам токен принимался до истечения срока.
Теперь выход помечает участника, и его токен больше не действует.
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0012"
down_revision: Union[str, None] = "0011"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "participants",
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("participants", "revoked_at")
