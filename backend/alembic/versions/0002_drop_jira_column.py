"""drop jira_issue_key from action_items

Revision ID: 0002
Revises: 0001
Create Date: 2026-09-30

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0002"
down_revision: Union[str, None] = "0001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("action_items") as batch_op:
        batch_op.drop_column("jira_issue_key")


def downgrade() -> None:
    with op.batch_alter_table("action_items") as batch_op:
        batch_op.add_column(sa.Column("jira_issue_key", sa.String(30), nullable=True))
