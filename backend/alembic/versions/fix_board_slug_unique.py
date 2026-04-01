"""fix board slug unique constraint

Revision ID: fx0000000004
Revises: fx0000000003
Create Date: 2026-04-01 00:00:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


# revision identifiers, used by Alembic.
revision: str = "fx0000000004"
down_revision: Union[str, None] = "fx0000000003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = inspect(conn)

    constraints = inspector.get_unique_constraints("boards")
    constraint_names = [c["name"] for c in constraints]

    old_constraint_name = None
    for c in constraints:
        if c["name"] in ("slug", "ix_boards_slug"):
            old_constraint_name = c["name"]
            break

    if old_constraint_name:
        op.drop_constraint(old_constraint_name, "boards", type_="unique")

    ix_names = [i["name"] for i in inspector.get_indexes("boards")]
    if "ix_boards_slug" in ix_names:
        op.drop_index("ix_boards_slug", table_name="boards")

    op.create_unique_constraint(
        "uq_board_workspace_slug",
        "boards",
        ["workspace_id", "slug"],
    )


def downgrade() -> None:
    conn = op.get_bind()
    inspector = inspect(conn)

    constraints = inspector.get_unique_constraints("boards")
    constraint_names = [c["name"] for c in constraints]

    if "uq_board_workspace_slug" in constraint_names:
        op.drop_constraint("uq_board_workspace_slug", "boards", type_="unique")

    op.create_index(op.f("ix_boards_slug"), "boards", ["slug"], unique=True)
