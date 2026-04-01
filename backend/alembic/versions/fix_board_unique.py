"""fix board unique constraint

Revision ID: fix_board_unique
Revises: add_workspace_id_to_boards
Create Date: 2026-04-01 00:00:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


# revision identifiers, used by Alembic.
revision: str = "fx0000000003"
down_revision: Union[str, None] = "ws0000000002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = inspect(conn)

    constraints = inspector.get_unique_constraints("boards")
    constraint_names = [c["name"] for c in constraints]

    if "uq_board_workspace_name" not in constraint_names:
        old_constraint_name = None
        for c in constraints:
            if c["name"] in ("name", "boards_name_key"):
                old_constraint_name = c["name"]
                break

        if old_constraint_name:
            op.drop_constraint(old_constraint_name, "boards", type_="unique")

        ix_names = [i["name"] for i in inspector.get_indexes("boards")]
        if "ix_boards_name" in ix_names:
            op.drop_index("ix_boards_name", table_name="boards")

        op.create_unique_constraint(
            "uq_board_workspace_name",
            "boards",
            ["workspace_id", "name"],
        )


def downgrade() -> None:
    conn = op.get_bind()
    inspector = inspect(conn)

    constraints = inspector.get_unique_constraints("boards")
    constraint_names = [c["name"] for c in constraints]

    if "uq_board_workspace_name" in constraint_names:
        op.drop_constraint("uq_board_workspace_name", "boards", type_="unique")

    op.create_unique_constraint("boards_name_key", "boards", ["name"])
    op.create_index("ix_boards_name", "boards", ["name"], unique=True)
