"""History store for processing runs."""

from __future__ import annotations

import json
import sqlite3
from datetime import datetime
from typing import Any

from backend.core.database import get_db_path
from backend.core.migrations import Migration, MigrationManager
from backend.core.repository import _db_lock, get_connection
from backend.core.run_types import ALL_RUN_TYPES

# ─── Constants ─────────────────────────────────────────────────────────────

# Run type ids. Kept here for backward compatibility — the canonical list
# lives in ``backend.core.run_types.RUN_TYPE_REGISTRY``.
RUN_TYPE_CONVERSION = "conversion"
RUN_TYPE_FORMATO = "formato"
RUN_TYPE_SELLADOR = "sellador"
RUN_TYPE_PADRON = "padron"
RUN_TYPE_VOLANTE = "volante"
RUN_TYPE_IMAGE_OPTIMIZER = "image_optimizer"
RUN_TYPE_REPORTE_CAMPO = "reporte_campo"
RUN_TYPE_PANEL_AVISO_CORTE = "panel_aviso_corte"
RUN_TYPE_INFORME_TECNICO = "informe_tecnico"

# Known historial columns — explicit projection (never ``SELECT *``).
_HISTORIAL_COLUMNS: tuple[str, ...] = (
    "id",
    "run_type",
    "timestamp",
    "files_json",
    "options_json",
    "patron",
    "formato",
    "calidad",
    "resize",
    "ok_count",
    "err_count",
    "schema_version",
    "app_version",
    "duration_ms",
)
_HISTORIAL_SELECT = ", ".join(_HISTORIAL_COLUMNS)

# Current schema version. Bump when adding a new migration to ``HISTORIAL_MIGRATIONS``.
CURRENT_HISTORIAL_SCHEMA_VERSION = 1

# ─── Migrations ────────────────────────────────────────────────────────────
# Forward-only, additive, idempotent. New columns are always NULL-able.

HISTORIAL_MIGRATIONS: list[Migration] = [
    Migration(
        id="001_historial_baseline",
        description=(
            "Baseline historial table: id, run_type, timestamp, files_json, "
            "options_json, patron, formato, calidad, resize, ok_count, err_count."
        ),
        sql=(
            """
            CREATE TABLE IF NOT EXISTS historial (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                run_type TEXT NOT NULL DEFAULT 'conversion',
                timestamp TEXT NOT NULL,
                files_json TEXT NOT NULL,
                options_json TEXT NOT NULL,
                patron TEXT,
                formato TEXT,
                calidad INTEGER,
                resize TEXT,
                ok_count INTEGER DEFAULT 0,
                err_count INTEGER DEFAULT 0
            )
            """,
            # Idempotent for legacy installs that pre-date the run_type column.
            "ALTER TABLE historial ADD COLUMN run_type TEXT",
        ),
    ),
    Migration(
        id="002_historial_metadata",
        description=(
            "Add schema_version, app_version and duration_ms for forward compatibility "
            "and run analytics. All columns are NULL-able."
        ),
        sql=(
            "ALTER TABLE historial ADD COLUMN schema_version INTEGER DEFAULT 0",
            "ALTER TABLE historial ADD COLUMN app_version TEXT",
            "ALTER TABLE historial ADD COLUMN duration_ms INTEGER",
            "UPDATE historial SET schema_version = 0 WHERE schema_version IS NULL",
        ),
    ),
    Migration(
        id="003_historial_indexes",
        description="Indexes for historial list/filter queries (timestamp, run_type).",
        sql=(
            "CREATE INDEX IF NOT EXISTS idx_historial_ts ON historial(timestamp DESC)",
            "CREATE INDEX IF NOT EXISTS idx_historial_run_type ON historial(run_type)",
        ),
    ),
]


def _ensure_table() -> None:
    """Idempotently migrate the historial schema to the latest version.

    Safe to call on every access. Records applied migrations in
    ``_schema_migrations`` so a process restart or a code downgrade does not
    re-apply work.
    """
    db = get_db_path()
    with _db_lock:
        conn = get_connection(db)
        manager = MigrationManager(conn)
        manager.apply_all(HISTORIAL_MIGRATIONS)
        # Safety net for rows written by code that pre-dated the run_type column.
        conn.execute(
            "UPDATE historial SET run_type = 'conversion' WHERE run_type IS NULL"
        )
        conn.commit()


def save_run(
    files: list[str],
    options: dict[str, Any],
    patron: str,
    formato: str,
    calidad: int,
    resize: str | None,
    ok_count: int,
    err_count: int,
    run_type: str = RUN_TYPE_CONVERSION,
    duration_ms: int | None = None,
) -> int:
    """Save a processing run to history and return its ID.

    Validates the payload against the RunType registry when ``jsonschema`` is
    available; falls back to a permissive save (with ``schema_version=0``) when
    the library is missing. Records the application version that produced the
    row so the data is self-describing across updates.
    """
    _ensure_table()

    # Lazy import to avoid a hard dependency at module import time.
    from backend.core.run_types import (
        validate_run_payload,
    )
    from backend.version import __version__

    validate_run_payload(run_type, options, files)
    schema_version = CURRENT_HISTORIAL_SCHEMA_VERSION

    db = get_db_path()
    with _db_lock:
        conn = get_connection(db)
        cursor = conn.execute(
            """
            INSERT INTO historial (
                run_type, timestamp, files_json, options_json,
                patron, formato, calidad, resize, ok_count, err_count,
                schema_version, app_version, duration_ms
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                run_type,
                datetime.now().isoformat(),
                json.dumps(files),
                json.dumps(options),
                patron,
                formato,
                calidad,
                resize,
                ok_count,
                err_count,
                schema_version,
                __version__,
                duration_ms,
            ),
        )
        conn.commit()
        return cursor.lastrowid or 0


def list_runs(
    run_type: str | None = None,
    limit: int = 50,
    offset: int = 0,
    date_from: str | None = None,
    date_to: str | None = None,
) -> list[dict[str, Any]]:
    """List recent processing runs, newest first.

    Optional ``date_from`` and ``date_to`` are ISO 8601 strings and are
    compared against the stored ``timestamp`` (string comparison works for
    ISO 8601 because it is lexicographically ordered).
    """
    _ensure_table()
    db = get_db_path()
    where: list[str] = []
    params: list[Any] = []
    if run_type:
        where.append("run_type = ?")
        params.append(run_type)
    if date_from:
        where.append("timestamp >= ?")
        params.append(date_from)
    if date_to:
        where.append("timestamp <= ?")
        params.append(date_to)
    where_clause = f"WHERE {' AND '.join(where)}" if where else ""
    sql = (
        f"SELECT {_HISTORIAL_SELECT} FROM historial {where_clause} "
        f"ORDER BY timestamp DESC LIMIT ? OFFSET ?"
    )
    params.extend([limit, offset])
    with _db_lock:
        conn = get_connection(db)
        conn.row_factory = sqlite3.Row
        rows = conn.execute(sql, params).fetchall()
    return [dict(r) for r in rows]


def list_runs_by_ids(ids: list[int]) -> list[dict[str, Any]]:
    """Return runs whose ids are in ``ids``. Preserves the given ordering."""
    if not ids:
        return []
    _ensure_table()
    db = get_db_path()
    placeholders = ", ".join(["?"] * len(ids))
    with _db_lock:
        conn = get_connection(db)
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            f"SELECT {_HISTORIAL_SELECT} FROM historial WHERE id IN ({placeholders}) "
            f"ORDER BY timestamp DESC",
            ids,
        ).fetchall()
    by_id = {r["id"]: r for r in rows}
    # Preserve caller ordering, drop missing ids silently.
    return [dict(by_id[i]) for i in ids if i in by_id]


def get_run(run_id: int) -> dict[str, Any] | None:
    """Get a single run by ID."""
    _ensure_table()
    db = get_db_path()
    with _db_lock:
        conn = get_connection(db)
        conn.row_factory = sqlite3.Row
        row = conn.execute(
            f"SELECT {_HISTORIAL_SELECT} FROM historial WHERE id = ?",
            (run_id,),
        ).fetchone()
    return dict(row) if row else None


def delete_run(run_id: int) -> bool:
    """Delete a run by ID."""
    _ensure_table()
    db = get_db_path()
    with _db_lock:
        conn = get_connection(db)
        cursor = conn.execute("DELETE FROM historial WHERE id = ?", (run_id,))
        conn.commit()
        return cursor.rowcount > 0
