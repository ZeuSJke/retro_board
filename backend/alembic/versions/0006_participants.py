"""participants, token epoch, invites, hidden collection, carried action items

Revision ID: 0006
Revises: 0005
Create Date: 2026-11-14 21:00:00.000000

Серверная личность участника. Существующие данные не переписываются: у старых
карточек и оценок настроения автор остаётся именем без участника, голоса в
`cards.likes` остаются именами — они входят в счёт, но никому не принадлежат.
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0006"
down_revision: Union[str, None] = "0005"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "participants",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("workspace_id", sa.String(), nullable=False),
        sa.Column("name", sa.String(length=60), nullable=False),
        sa.Column("kind", sa.String(length=20), nullable=False, server_default="human"),
        sa.Column("account_id", sa.String(length=100), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_participants_workspace_id", "participants", ["workspace_id"])

    with op.batch_alter_table("workspaces") as batch_op:
        batch_op.add_column(
            sa.Column("token_epoch", sa.Integer(), nullable=False, server_default="0")
        )
        batch_op.add_column(sa.Column("invite_token", sa.String(length=64), nullable=True))
        batch_op.create_index("ix_workspaces_invite_token", ["invite_token"], unique=True)

    with op.batch_alter_table("boards") as batch_op:
        batch_op.add_column(sa.Column("active_facilitator_id", sa.String(), nullable=True))
        batch_op.add_column(sa.Column("created_by_id", sa.String(), nullable=True))
        batch_op.add_column(
            sa.Column("cards_revealed", sa.Boolean(), nullable=False, server_default=sa.false())
        )
        batch_op.create_foreign_key(
            "fk_boards_active_facilitator_id",
            "participants",
            ["active_facilitator_id"],
            ["id"],
            ondelete="SET NULL",
        )
        batch_op.create_foreign_key(
            "fk_boards_created_by_id",
            "participants",
            ["created_by_id"],
            ["id"],
            ondelete="SET NULL",
        )

    with op.batch_alter_table("cards") as batch_op:
        batch_op.add_column(sa.Column("author_id", sa.String(), nullable=True))
        batch_op.create_index("ix_cards_author_id", ["author_id"])
        batch_op.create_foreign_key(
            "fk_cards_author_id", "participants", ["author_id"], ["id"], ondelete="SET NULL"
        )

    with op.batch_alter_table("board_moods") as batch_op:
        batch_op.add_column(sa.Column("participant_id", sa.String(), nullable=True))
        batch_op.create_foreign_key(
            "fk_board_moods_participant_id",
            "participants",
            ["participant_id"],
            ["id"],
            ondelete="SET NULL",
        )
        # Имя больше не ключ: тёзки ставят оценки независимо
        batch_op.drop_constraint("uq_mood_board_author", type_="unique")
        batch_op.create_unique_constraint(
            "uq_mood_board_participant", ["board_id", "participant_id"]
        )

    with op.batch_alter_table("action_items") as batch_op:
        batch_op.add_column(sa.Column("superseded_by_id", sa.String(), nullable=True))
        batch_op.create_foreign_key(
            "fk_action_items_superseded_by_id",
            "action_items",
            ["superseded_by_id"],
            ["id"],
            ondelete="SET NULL",
        )

    # Сессии ведущих привязаны к именам, которых сервер больше не признаёт
    # личностью: активные сессии сбрасываем, доски раскрываем как есть.
    op.execute(
        "UPDATE boards SET active_facilitator = NULL, active_phase = NULL, "
        "active_session_id = NULL WHERE active_facilitator IS NOT NULL"
    )


def downgrade() -> None:
    with op.batch_alter_table("action_items") as batch_op:
        batch_op.drop_constraint("fk_action_items_superseded_by_id", type_="foreignkey")
        batch_op.drop_column("superseded_by_id")

    # Имя снова становится ключом оценки: оставляем по одной записи на (доска, имя)
    op.execute(
        "DELETE FROM board_moods WHERE id NOT IN ("
        "SELECT MIN(id) FROM board_moods GROUP BY board_id, author)"
    )
    with op.batch_alter_table("board_moods") as batch_op:
        batch_op.drop_constraint("uq_mood_board_participant", type_="unique")
        batch_op.create_unique_constraint("uq_mood_board_author", ["board_id", "author"])
        batch_op.drop_constraint("fk_board_moods_participant_id", type_="foreignkey")
        batch_op.drop_column("participant_id")

    with op.batch_alter_table("cards") as batch_op:
        batch_op.drop_constraint("fk_cards_author_id", type_="foreignkey")
        batch_op.drop_index("ix_cards_author_id")
        batch_op.drop_column("author_id")

    with op.batch_alter_table("boards") as batch_op:
        batch_op.drop_constraint("fk_boards_created_by_id", type_="foreignkey")
        batch_op.drop_constraint("fk_boards_active_facilitator_id", type_="foreignkey")
        batch_op.drop_column("cards_revealed")
        batch_op.drop_column("created_by_id")
        batch_op.drop_column("active_facilitator_id")

    with op.batch_alter_table("workspaces") as batch_op:
        batch_op.drop_index("ix_workspaces_invite_token")
        batch_op.drop_column("invite_token")
        batch_op.drop_column("token_epoch")

    op.drop_index("ix_participants_workspace_id", table_name="participants")
    op.drop_table("participants")
