"""partial unique indexes for live boards instead of name mangling on delete

Revision ID: 0015
Revises: 0014
Create Date: 2026-11-15 18:00:00.000000
"""

import hashlib
from collections import defaultdict
from typing import Any, Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "0015"
down_revision: Union[str, None] = "0014"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    if op.get_bind().dialect.name == "sqlite":
        with op.batch_alter_table("boards") as batch_op:
            batch_op.drop_constraint("uq_board_workspace_name", type_="unique")
            batch_op.drop_constraint("uq_board_workspace_slug", type_="unique")
    else:
        op.drop_constraint("uq_board_workspace_name", "boards", type_="unique")
        op.drop_constraint("uq_board_workspace_slug", "boards", type_="unique")

    op.create_index(
        "uq_board_workspace_name",
        "boards",
        ["workspace_id", "name"],
        unique=True,
        postgresql_where=sa.text("deleted_at IS NULL"),
        sqlite_where=sa.text("deleted_at IS NULL"),
    )
    op.create_index(
        "uq_board_workspace_slug",
        "boards",
        ["workspace_id", "slug"],
        unique=True,
        postgresql_where=sa.text("deleted_at IS NULL"),
        sqlite_where=sa.text("deleted_at IS NULL"),
    )


def _deduplicate_column(
    conn: sa.Connection,
    boards_table: sa.TableClause,
    rows: Sequence[Any],
    *,
    col_name: str,
    max_len: int,
    suffix_prefix: str,
) -> None:
    """Переименовать конфликтующие soft-deleted значения перед возвратом full unique."""
    used: set[tuple[str | None, str]] = set()
    groups: dict[tuple[str, str], list[Any]] = defaultdict(list)

    for row in rows:
        val = getattr(row, col_name)
        if val is None:
            continue
        used.add((row.workspace_id, val))
        if row.workspace_id is not None:
            groups[(row.workspace_id, val)].append(row)

    for (ws_id, val), group in groups.items():
        if len(group) <= 1:
            continue
        # В одной команде с partial unique может быть не более одной живой доски;
        # её имя/slug оставляем нетронутым, а среди одних удалённых оставляем первую.
        live = [r for r in group if r.deleted_at is None]
        keeper = live[0] if live else group[0]

        for row in group:
            if row.id == keeper.id:
                continue
            if row.deleted_at is None:
                raise RuntimeError(
                    f"Duplicate live board {col_name}={val!r} in workspace {ws_id!r}"
                )
            suffix = f"{suffix_prefix}{row.id}"
            if len(suffix) >= max_len:
                digest = hashlib.sha256(row.id.encode("utf-8")).hexdigest()[:12]
                suffix = f"{suffix_prefix}{digest}"
            candidate = f"{val[: max_len - len(suffix)]}{suffix}"
            counter = 2
            while (ws_id, candidate) in used:
                extra = f"_{counter}"
                ext_suffix = suffix
                if len(ext_suffix) + len(extra) >= max_len:
                    digest = hashlib.sha256(f"{row.id}:{counter}".encode("utf-8")).hexdigest()[:12]
                    ext_suffix = f"{suffix_prefix}{digest}"
                candidate = f"{val[: max_len - len(ext_suffix) - len(extra)]}{ext_suffix}{extra}"
                counter += 1
            used.add((ws_id, candidate))
            conn.execute(
                sa.update(boards_table)
                .where(boards_table.c.id == row.id)
                .values(**{col_name: candidate})
            )


def _deduplicate_deleted_boards(conn: sa.Connection) -> None:
    """Сделать имена и slug уникальными в рамках команды перед откатом 0015 -> 0014."""
    boards_table = sa.table(
        "boards",
        sa.column("id", sa.String),
        sa.column("workspace_id", sa.String),
        sa.column("name", sa.String),
        sa.column("slug", sa.String),
        sa.column("deleted_at", sa.DateTime),
    )
    rows = conn.execute(
        sa.select(
            boards_table.c.id,
            boards_table.c.workspace_id,
            boards_table.c.name,
            boards_table.c.slug,
            boards_table.c.deleted_at,
        ).order_by(boards_table.c.id)
    ).fetchall()
    _deduplicate_column(
        conn, boards_table, rows, col_name="name", max_len=120, suffix_prefix="__del_"
    )
    _deduplicate_column(
        conn, boards_table, rows, col_name="slug", max_len=150, suffix_prefix="-del-"
    )


def downgrade() -> None:
    op.drop_index("uq_board_workspace_slug", table_name="boards")
    op.drop_index("uq_board_workspace_name", table_name="boards")
    _deduplicate_deleted_boards(op.get_bind())
    if op.get_bind().dialect.name == "sqlite":
        with op.batch_alter_table("boards") as batch_op:
            batch_op.create_unique_constraint(
                "uq_board_workspace_name", ["workspace_id", "name"]
            )
            batch_op.create_unique_constraint(
                "uq_board_workspace_slug", ["workspace_id", "slug"]
            )
    else:
        op.create_unique_constraint(
            "uq_board_workspace_name", "boards", ["workspace_id", "name"]
        )
        op.create_unique_constraint(
            "uq_board_workspace_slug", "boards", ["workspace_id", "slug"]
        )
