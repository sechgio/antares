
from __future__ import annotations

import sqlite3
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import datetime

MIGRATIONS_TABLE = "_schema_migrations"


@dataclass(frozen=True)
class Migration:

    id: str
    sql: tuple[str, ...]
    description: str = ""


class MigrationManager:

    def __init__(self, conn: sqlite3.Connection) -> None:
        self.conn = conn

    def ensure_table(self) -> None:
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
        self.ensure_table()
        rows = self.conn.execute(f"SELECT id FROM {MIGRATIONS_TABLE}").fetchall()
        return {row[0] for row in rows}

    def is_applied(self, migration_id: str) -> bool:
        return migration_id in self.applied()

    def apply(self, migration: Migration) -> bool:
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
        applied_now: list[str] = []
        for migration in migrations:
            if self.apply(migration):
                applied_now.append(migration.id)
        return applied_now

    def _execute_idempotent(self, sql: str) -> None:
        try:
            self.conn.execute(sql)
        except sqlite3.OperationalError as exc:
            msg = str(exc).lower()
            if "duplicate column" in msg or "already exists" in msg:
                return
            raise
