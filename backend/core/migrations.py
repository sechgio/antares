"""Versioned, idempotent SQLite schema migrations for ANTARES.

Each migration is identified by a unique string id (e.g. ``"001_historial_baseline"``).
Applied migrations are recorded in the ``_schema_migrations`` table. Re-running a
migration is a no-op. Statements that would fail because a column or table
already exists (e.g. ``ALTER TABLE ... ADD COLUMN`` run twice) are tolerated
so migrations are safe to re-apply.

Policy (see ``docs/superpowers/plans/2026-06-12-history-professional-durable.md``):

* New columns are always ``NULL``-able and have a ``DEFAULT NULL``/``0``.
* Columns are never dropped. Renames and type changes are introduced as a new
  column suffixed with ``_v2``; the old column is left readable for 2 minor
  versions.
* Migrations are forward-only and additive; ``bump:patch/minor/major`` never
  wipes data.
"""

from __future__ import annotations

import sqlite3
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import datetime

MIGRATIONS_TABLE = "_schema_migrations"


@dataclass(frozen=True)
class Migration:
    """A single forward-only, idempotent schema migration."""

    id: str
    sql: tuple[str, ...]
    description: str = ""


class MigrationManager:
    """Apply a list of forward-only, idempotent SQL migrations to a connection."""

    def __init__(self, conn: sqlite3.Connection) -> None:
        self.conn = conn

    def ensure_table(self) -> None:
        """Create the bookkeeping table that records applied migrations."""
        self.conn.execute(
            f"""
            CREATE TABLE IF NOT EXISTS {MIGRATIONS_TABLE} (
                id TEXT PRIMARY KEY,
                description TEXT,
                applied_at TEXT NOT NULL
            )
            """
        )

    def applied(self) -> set[str]:
        """Return the set of migration ids already applied."""
        self.ensure_table()
        rows = self.conn.execute(f"SELECT id FROM {MIGRATIONS_TABLE}").fetchall()
        return {row[0] for row in rows}

    def is_applied(self, migration_id: str) -> bool:
        return migration_id in self.applied()

    def apply(self, migration: Migration) -> bool:
        """Apply a single migration. Returns ``True`` if newly applied, ``False`` if already present."""
        self.ensure_table()
        if self.is_applied(migration.id):
            return False
        for sql in migration.sql:
            self._execute_idempotent(sql)
        self.conn.execute(
            f"INSERT INTO {MIGRATIONS_TABLE} (id, description, applied_at) VALUES (?, ?, ?)",
            (migration.id, migration.description, datetime.now().isoformat()),
        )
        self.conn.commit()
        return True

    def apply_all(self, migrations: Iterable[Migration]) -> list[str]:
        """Apply all pending migrations in order. Returns the list of newly applied ids."""
        applied_now: list[str] = []
        for migration in migrations:
            if self.apply(migration):
                applied_now.append(migration.id)
        return applied_now

    def _execute_idempotent(self, sql: str) -> None:
        """Execute SQL tolerating "duplicate column" / "already exists" errors."""
        try:
            self.conn.execute(sql)
        except sqlite3.OperationalError as exc:
            msg = str(exc).lower()
            if "duplicate column" in msg or "already exists" in msg:
                return
            raise
