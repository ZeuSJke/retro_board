"""add workspaces table and workspace_id FK to boards

Revision ID: 001
Revises: f4a8b1c2d3e5
Create Date: 2026-03-29
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "001"
down_revision: Union[str, None] = "be1d3d296f64"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. Создать таблицу workspaces
    op.create_table(
        'workspaces',
        sa.Column('id', sa.String(), nullable=False),
        sa.Column('slug', sa.String(80), nullable=False),
        sa.Column('name', sa.String(120), nullable=False),
        sa.Column('access_key_hash', sa.String(200), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('slug', name='uq_workspaces_slug'),
    )
    op.create_index('ix_workspaces_slug', 'workspaces', ['slug'])

    # 2. Вставить workspace "FMRM Core" с ключом.
    fmrm_id = 'fmrm-core-workspace-001'
    key_hash = '$2b$12$fFOMt/d1BUt31NtML2PuMe5K//qI1xOJt2kyXmwBcibLEKMbkhUNC'
    op.execute(
        f"INSERT INTO workspaces (id, slug, name, access_key_hash, created_at) "
        f"VALUES ('{fmrm_id}', 'fmrm-core', 'FMRM Core', '{key_hash}', NOW())"
    )

    # 3. Добавить колонку workspace_id в boards
    op.add_column('boards', sa.Column('workspace_id', sa.String(), nullable=True))
    op.create_foreign_key(
        'fk_boards_workspace_id', 'boards', 'workspaces',
        ['workspace_id'], ['id'], ondelete='SET NULL'
    )
    op.create_index('ix_boards_workspace_id', 'boards', ['workspace_id'])

    # 4. Все существующие доски → FMRM Core
    op.execute(f"UPDATE boards SET workspace_id = '{fmrm_id}' WHERE workspace_id IS NULL")


def downgrade() -> None:
    # 1. Удалить FK и индекс
    op.drop_index('ix_boards_workspace_id')
    op.drop_constraint('fk_boards_workspace_id', 'boards', type_='foreignkey')

    # 2. Удалить колонку workspace_id
    op.drop_column('boards', 'workspace_id')

    # 3. Удалить таблицу workspaces
    op.drop_index('ix_workspaces_slug')
    op.drop_table('workspaces')
