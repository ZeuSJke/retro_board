"""agent tokens, card author_kind, and action item external_url

Revision ID: 0014
Revises: 0013
Create Date: 2026-11-15 12:00:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "0014"
down_revision: Union[str, None] = "0013"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "cards",
        sa.Column(
            "author_kind",
            sa.String(length=20),
            server_default="human",
            nullable=False,
        ),
    )
    op.add_column(
        "action_items",
        sa.Column("external_url", sa.String(length=500), nullable=True),
    )
    op.create_table(
        "agent_tokens",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("workspace_id", sa.String(), nullable=False),
        sa.Column("participant_id", sa.String(), nullable=False),
        sa.Column("name", sa.String(length=60), nullable=False),
        sa.Column("token_prefix", sa.String(length=20), nullable=False),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("scope", sa.String(length=20), nullable=False),
        sa.Column("created_by_id", sa.String(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["created_by_id"], ["participants.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["participant_id"], ["participants.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("participant_id"),
        sa.UniqueConstraint("token_hash"),
    )
    op.create_index(
        op.f("ix_agent_tokens_workspace_id"), "agent_tokens", ["workspace_id"], unique=False
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_agent_tokens_workspace_id"), table_name="agent_tokens")
    op.drop_table("agent_tokens")
    op.drop_column("action_items", "external_url")
    op.drop_column("cards", "author_kind")
