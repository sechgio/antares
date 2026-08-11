"""Módulo de base de datos: SQLite embebido con importación/exportación de Excel."""

from __future__ import annotations

import logging
import re
import sqlite3
import unicodedata
from pathlib import Path
from typing import Any, cast

from backend.core.config_fields import get_field_names, load_fields, save_fields
from backend.core.exceptions import DatabaseError
from backend.core.repository import _db_lock, _db_read_lock, get_connection, get_read_connection
from backend.utils.paths import user_data_path

logger = logging.getLogger(__name__)

_IDENTIFIER_RE = re.compile(r"^[a-z_][a-z0-9_]*$")


def _validate_identifier(name: str, context: str = "column") -> str:
    """Validate a SQL identifier to prevent injection.

    Only allows lowercase alphanumeric + underscore identifiers.
    Raises ValueError if the name is not a safe identifier.
    """
    if not _IDENTIFIER_RE.match(name):
        msg = f"Invalid SQL {context} name: {name!r}"
        raise ValueError(msg)
    return name


def _qi(name: str) -> str:
    """Quote a validated SQL identifier with double-quotes (SQLite style)."""
    return f'"{name}"'


def _get_connection() -> sqlite3.Connection:
    """Retorna la conexión compartida del pool."""
    return get_connection(get_db_path())


def _get_read_connection() -> sqlite3.Connection:
    """Retorna la conexión de solo lectura para SELECT."""
    return get_read_connection(get_db_path())


def _normalize_excel_column_name(name: Any, fallback: str) -> str:
    """Convierte encabezados de Excel en nombres de columna SQLite seguros."""
    text = unicodedata.normalize("NFKD", str(name or ""))
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    text = re.sub(r"[^a-zA-Z0-9_]+", "_", text.strip().lower())
    text = re.sub(r"_+", "_", text).strip("_")
    if not text or not re.match(r"^[a-z_]", text):
        text = fallback
    return text


def _normalize_excel_columns(columns: list[Any]) -> list[str]:
    """Normaliza encabezados preservando unicidad."""
    normalized: list[str] = []
    seen: dict[str, int] = {}
    for idx, column in enumerate(columns, 1):
        base = _normalize_excel_column_name(column, f"columna_{idx}")
        count = seen.get(base, 0)
        seen[base] = count + 1
        normalized.append(base if count == 0 else f"{base}_{count + 1}")
    return normalized


def get_db_path() -> Path:
    """Retorna la ruta de la base de datos SQLite local (writable)."""
    return user_data_path("catalogo.db")


def _data_fields(fields: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Fields that become data columns. Reserved PK ``id`` is never duplicated."""
    return [f for f in fields if str(f.get("name", "")).lower() != "id"]


def _build_schema(fields: list[dict[str, Any]]) -> str:
    """Construye la sentencia CREATE TABLE a partir de la configuración de campos."""
    columns = ["id INTEGER PRIMARY KEY AUTOINCREMENT"]
    for f in _data_fields(fields):
        name = _validate_identifier(f["name"])
        # Defensa: `id` es la PK interna; un field homónimo rompería CREATE TABLE.
        if name == "id":
            continue
        quoted_name = _qi(name)
        ftype = f["type"]
        constraints: list[str] = []
        if f.get("required"):
            constraints.append("NOT NULL")
        if f.get("unique"):
            constraints.append("UNIQUE")
        col = f"{quoted_name} {ftype}"
        if constraints:
            col += " " + " ".join(constraints)
        columns.append(col)
    return f"CREATE TABLE IF NOT EXISTS imagenes ({', '.join(columns)})"


def _table_matches_config(cursor: sqlite3.Cursor, fields: list[dict[str, Any]]) -> bool:
    """Verifica si la tabla actual coincide con la configuración de campos."""
    cursor.execute("PRAGMA table_info(imagenes)")
    existing = {row[1]: row[2].upper() for row in cursor.fetchall()}
    expected = {f["name"]: f["type"] for f in fields}
    # id siempre existe, lo ignoramos en la comparación
    expected["id"] = "INTEGER"
    return existing == expected


# Mensaje compartido por la migración real (init_db) y el dry-run
# (validate_fields_migration): el esquema nuevo no comparte ninguna columna con
# un catálogo poblado, así que la migración no podría preservar datos.
_MIGRATION_NO_OVERLAP_MSG = (
    "Migración abortada: el nuevo esquema no conserva "
    "ninguna columna del catálogo existente y dejaría "
    "la tabla vacía. Conserva al menos una columna "
    "compartida o importa un Excel nuevo."
)


def _schema_diff(
    fields: list[dict[str, Any]],
    existing_cols: dict[str, str],
) -> tuple[dict[str, str], list[str], list[str]]:
    """Diff entre un set de fields propuesto y las columnas vivas de la tabla.

    Returns ``(new_cols, removed_cols, changed_cols)`` — misma semántica que el
    diff inline que usaba ``init_db``. Compartida para que la validación dry-run
    y la migración real no puedan divergir.
    """
    expected_cols = {f["name"]: f["type"] for f in fields}
    expected_cols["id"] = "INTEGER"
    new_cols = {
        name: ftype for name, ftype in expected_cols.items()
        if name not in existing_cols
    }
    removed_cols = [name for name in existing_cols if name not in expected_cols]
    changed_cols = [
        name for name in expected_cols
        if name in existing_cols and existing_cols[name] != expected_cols[name]
    ]
    return new_cols, removed_cols, changed_cols


def _create_indexes(cursor: sqlite3.Cursor, fields: list[dict[str, Any]]) -> None:
    """Create indexes on all queryable fields to avoid full-table scans.

    Also creates expression indexes on ``lower(col)`` so case-insensitive
    lookups (``WHERE lower(col) IN (...)``) can use an index instead of a
    full scan. Plain UNIQUE indexes stay on the raw column (case-sensitive
    uniqueness); lower() indexes are always non-unique.
    """
    data_fields = _data_fields(fields)
    if not data_fields:
        return

    for f in data_fields:
        name = _validate_identifier(f["name"])
        unique_clause = "UNIQUE" if f.get("unique") else ""
        cursor.execute(
            f"CREATE {unique_clause} INDEX IF NOT EXISTS idx_imagenes_{name} ON imagenes({_qi(name)})"
        )
        # Expression index matching buscar_* queries: lower(col) IN (...)
        cursor.execute(
            f"CREATE INDEX IF NOT EXISTS idx_imagenes_lower_{name} "
            f"ON imagenes(lower({_qi(name)}))"
        )


def init_db(*, allow_catalog_wipe: bool = False) -> None:
    """Inicializa la base de datos SQLite con la tabla principal según campos configurados.

    Args:
        allow_catalog_wipe: Si True, permite migraciones sin solapamiento de
            columnas que vacían el catálogo (p. ej. import Excel con esquema
            nuevo). Si False (default), esas migraciones abortan con error.
    """
    fields = load_fields()
    conn = _get_connection()
    with _db_lock:
        cursor = conn.cursor()

        # Start a manual transaction for atomic schema creation and migrations
        cursor.execute("BEGIN IMMEDIATE")
        try:
            cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='imagenes'")
            table_exists = cursor.fetchone() is not None

            if not table_exists:
                cursor.execute(_build_schema(fields))
            elif not _table_matches_config(cursor, fields):
                cursor.execute("PRAGMA table_info(imagenes)")
                existing_cols = {row[1]: row[2].upper() for row in cursor.fetchall()}
                new_cols, removed_cols, changed_cols = _schema_diff(fields, existing_cols)

                if removed_cols or changed_cols:
                    read_cursor: sqlite3.Cursor | None = None
                    try:
                        # Contar primero (barato) para decidir la rama sin
                        # materializar filas que se van a descartar.
                        cursor.execute("SELECT COUNT(*) FROM imagenes")
                        total_old = int(cursor.fetchone()[0])
                        has_rows = total_old > 0
                        old_cols: list[str] = []
                        if has_rows:
                            # Segundo cursor sobre la MISMA conexión: mantiene
                            # un snapshot de la tabla vieja a través del RENAME
                            # (ALTER TABLE RENAME no libera el btree) y permite
                            # insertar por chunks sin retener todas las filas
                            # en memoria (fetchall materializaba el catálogo
                            # completo).
                            read_cursor = conn.cursor()
                            read_cursor.execute("SELECT * FROM imagenes")
                            old_cols = [d[0] for d in read_cursor.description]
                    except sqlite3.Error as exc:
                        logger.warning("No se pudieron leer datos antiguos durante migración: %s", exc)
                        total_old = 0
                        has_rows = False
                        old_cols = []
                    cursor.execute("ALTER TABLE imagenes RENAME TO imagenes_old")
                    cursor.execute(_build_schema(fields))
                    # Sólo se preservan filas si alguna columna vieja (no-id)
                    # mapea al nuevo esquema. Sin solapamiento (p. ej.
                    # nis/sgio → codigo/nombre/...) las filas viejas no llevan
                    # dato útil al nuevo esquema y reinsertarlas generaría rows
                    # de puros defaults/placeholder, además de chocar con UNIQUE.
                    preserved_cols = [
                        c for c in old_cols
                        if c in {f["name"] for f in fields} and c != "id"
                    ]
                    if has_rows and preserved_cols and read_cursor is not None:
                        data_fields = _data_fields(fields)
                        new_col_names = [_validate_identifier(f["name"]) for f in data_fields]
                        placeholders = ", ".join(["?"] * len(new_col_names))
                        col_names = ", ".join(_qi(c) for c in new_col_names)
                        defaults = {"INTEGER": 0, "REAL": 0.0, "TEXT": "", "BLOB": b""}
                        try:
                            insert_sql = f"INSERT INTO imagenes ({col_names}) VALUES ({placeholders})"
                            chunk: list[list[Any]] = []
                            chunk_size = 500
                            for i, row in enumerate(read_cursor):
                                row_dict = dict(zip(old_cols, row, strict=False))
                                values: list[Any] = []
                                for f in data_fields:
                                    col = f["name"]
                                    if col in row_dict and row_dict[col] is not None:
                                        values.append(row_dict[col])
                                    elif f.get("required"):
                                        default = defaults.get(f["type"], "")
                                        # Un campo required+unique sin dato de origen
                                        # recibiría el mismo default en cada fila y
                                        # chocaría con el UNIQUE al reinsertar >1 fila
                                        # (p. ej. codigo="" en todas). Uniquificar por
                                        # índice sólo en ese caso; el resto conserva el
                                        # default constante original.
                                        if f.get("unique") and total_old > 1:
                                            if isinstance(default, str):
                                                default = f"{default}{i}" if default else str(i)
                                            elif isinstance(default, (int, float)):
                                                default = default + i
                                            else:
                                                default = str(i)
                                        values.append(default)
                                    else:
                                        values.append(None)
                                chunk.append(values)
                                if len(chunk) >= chunk_size:
                                    cursor.executemany(insert_sql, chunk)
                                    chunk.clear()
                            if chunk:
                                cursor.executemany(insert_sql, chunk)
                            read_cursor.close()  # consumido; libera el lock del SELECT
                            read_cursor = None
                            cursor.execute("DROP TABLE imagenes_old")
                        except sqlite3.Error as exc:
                            if read_cursor is not None:
                                read_cursor.close()  # el SELECT activo bloquearía el DROP
                                read_cursor = None
                            logger.error("Fallo migración de datos, se mantiene tabla antigua: %s", exc)
                            cursor.execute("DROP TABLE imagenes")
                            cursor.execute("ALTER TABLE imagenes_old RENAME TO imagenes")
                            raise DatabaseError(f"Migración fallida, esquema anterior preservado: {exc}") from exc
                    else:
                        if read_cursor is not None:
                            # Rama abort/wipe: el SELECT quedó abierto sin consumir
                            # y mantiene un lock que bloquearía el DROP/ALTER.
                            read_cursor.close()
                            read_cursor = None
                        if has_rows and not allow_catalog_wipe:
                            # Abort: dropping old data with zero column overlap would
                            # silently empty the catalog (e.g. full column rename via UI).
                            cursor.execute("DROP TABLE imagenes")
                            cursor.execute("ALTER TABLE imagenes_old RENAME TO imagenes")
                            raise DatabaseError(_MIGRATION_NO_OVERLAP_MSG)
                        if has_rows:
                            logger.info(
                                "Migración sin solapamiento de columnas (%s → %s): "
                                "catálogo vaciado, no se preservaron filas viejas.",
                                [c for c in old_cols if c != "id"],
                                [f["name"] for f in fields],
                            )
                        cursor.execute("DROP TABLE imagenes_old")
                else:
                    defaults = {"INTEGER": "0", "REAL": "0.0", "TEXT": "''", "BLOB": "NULL"}
                    for col_name, col_type in new_cols.items():
                        safe_name = _validate_identifier(col_name)
                        quoted = _qi(safe_name)
                        default_val = defaults.get(col_type, "''")
                        cursor.execute(f"ALTER TABLE imagenes ADD COLUMN {quoted} {col_type} DEFAULT {default_val}")
                    logger.info("Migración aditiva: se agregaron columnas %s", list(new_cols.keys()))

            _create_indexes(cursor, fields)
            cursor.execute("COMMIT")
        except Exception as exc:
            try:
                cursor.execute("ROLLBACK")
            except sqlite3.Error as rollback_exc:
                # Don't shadow the original failure, but surface this for
                # post-mortem debugging — silent suppression hid real DB
                # corruption issues in the past.
                logger.error(
                    "ROLLBACK failed after migration error (%s): %s",
                    type(exc).__name__,
                    rollback_exc,
                )
            raise DatabaseError(f"Inicialización/migración de base de datos fallida: {exc}") from exc


def validate_fields_migration(fields: list[dict[str, Any]]) -> None:
    """Dry-run: raise DatabaseError si aplicar estos fields al catálogo vivo abortaría.

    La migración aborta cuando el nuevo esquema elimina/cambia columnas, el
    catálogo tiene filas y NO hay ninguna columna compartida que preserve datos.
    Este chequeo NO escribe nada (ni disco ni BD): los handlers lo ejecutan
    ANTES de persistir la config nueva, para que un cambio de campos inválido
    no deje el archivo de config adelantado respecto al esquema real de la tabla
    (esa divergencia rompía el arranque del backend en el siguiente inicio:
    init_db falla → sys.exit(1)).

    El veredicto replica exactamente la rama de aborto de ``init_db`` usando
    ``_schema_diff``, así la validación y la migración real no pueden divergir.
    """
    with _db_read_lock:
        conn = _get_read_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='imagenes'")
        if cursor.fetchone() is None:
            return  # instalación fresca: el path CREATE nunca aborta
        cursor.execute("PRAGMA table_info(imagenes)")
        existing_cols = {row[1]: row[2].upper() for row in cursor.fetchall()}
        _new_cols, removed_cols, changed_cols = _schema_diff(fields, existing_cols)
        if not removed_cols and not changed_cols:
            return  # aditivo o idéntico: nunca aborta
        preserved = [
            c for c in existing_cols
            if c in {f["name"] for f in fields} and c != "id"
        ]
        if preserved:
            return  # hay solape de columnas: la migración preserva datos
        cursor.execute("SELECT COUNT(*) FROM imagenes")
        row = cursor.fetchone()
        if not (row and row[0]):
            return  # tabla vacía: nada que perder
        raise DatabaseError(_MIGRATION_NO_OVERLAP_MSG)


def importar_excel(excel_path: str) -> dict[str, int]:
    """Importa datos desde Excel (.xlsx) a SQLite.

    Args:
        excel_path: Ruta al archivo Excel.

    Returns:
        Dict con ``inserted`` (filas válidas escritas) y ``skipped`` (filas
        omitidas por campos required vacíos). El catálogo previo se vacía
        siempre antes de insertar.

    Raises:
        ImportError: Si openpyxl no está instalado.
        ValueError: Si faltan columnas requeridas.
        DatabaseError: Si ocurre un error de base de datos.
    """
    try:
        # Cold import under the serialized-import guard: openpyxl (and its
        # optional numpy bridge via pandas compat) must never load
        # concurrently with another C-extension import (e.g. rpds via
        # history) or the process can deadlock on Windows.
        from backend.core.import_guard import serialized_import

        with serialized_import():
            from openpyxl import load_workbook
    except ImportError as exc:
        msg = "openpyxl no está instalado. Ejecuta: pip install openpyxl"
        raise ImportError(msg) from exc

    if not Path(excel_path).exists():
        msg = f"No se encontró el archivo: {excel_path}"
        raise FileNotFoundError(msg)

    # Lectura y normalización FUERA del lock: el streaming puede tardar
    # segundos en Excels grandes y no debe bloquear las demás operaciones de
    # BD (antes todo el import corría bajo _db_lock, congelando previews).
    # read_only + iter_rows evita materializar el DataFrame completo
    # (pandas read_excel: 100-300 MB pico en 50k filas) y evita el import de
    # pandas/numpy en el worker. data_only=False keep formulas as stored text.
    wb = load_workbook(excel_path, read_only=True, data_only=False)
    try:
        ws = wb.active
        rows_iter = ws.iter_rows(values_only=True)
        header = next(rows_iter, None)
        columns = _normalize_excel_columns(list(header) if header is not None else [])

        existing_fields = {f["name"]: f for f in load_fields()}
        fields = [
            {
                **existing_fields.get(column, {}),
                "name": column,
                "type": existing_fields.get(column, {}).get("type", "TEXT"),
                "required": bool(existing_fields.get(column, {}).get("required", False)),
                "unique": bool(existing_fields.get(column, {}).get("unique", False)),
            }
            for column in columns
        ]
        if not fields:
            msg = f"El Excel no contiene columnas válidas para importar: {columns}"
            raise ValueError(msg)

        with _db_lock:
            fields = save_fields(fields)
            if not fields:
                msg = f"El Excel no contiene columnas válidas para importar: {columns}"
                raise ValueError(msg)
            field_names = [f["name"] for f in fields]

            # Asegurar que el esquema de BD coincida con los campos, incluyendo columnas del Excel.
            init_db(allow_catalog_wipe=True)
            required = [f["name"] for f in fields if f.get("required")]

            # Validate all field names as safe SQL identifiers (defense in depth)
            field_names = [_validate_identifier(fn) for fn in field_names]

            missing = [r for r in required if r not in columns]
            if missing:
                msg = (
                    f"El Excel debe contener al menos las columnas requeridas: {missing}. "
                    f"Columnas encontradas: {columns}"
                )
                raise ValueError(
                    msg,
                )

            conn = _get_connection()
            cursor = conn.cursor()

            try:
                cursor.execute("BEGIN")

                cursor.execute("DELETE FROM imagenes")

                placeholders = ", ".join(["?"] * len(field_names))
                col_names = ", ".join(_qi(fn) for fn in field_names)
                sql = f"INSERT INTO imagenes ({col_names}) VALUES ({placeholders})"

                # Chunked executemany: avoid retaining every row's values list at once.
                chunk: list[list[Any]] = []
                chunk_size = 500
                inserted = 0
                skipped = 0
                required_set = set(required)
                for row in rows_iter:
                    row_dict = dict(zip(columns, row, strict=False))
                    values: list[Any] = []
                    valid = True
                    for fn in field_names:
                        val = row_dict.get(fn)
                        if val is not None and str(val).strip():
                            values.append(str(val).strip())
                        elif fn in required_set:
                            valid = False
                            break
                        else:
                            values.append(None)
                    if valid:
                        chunk.append(values)
                        if len(chunk) >= chunk_size:
                            cursor.executemany(sql, chunk)
                            inserted += len(chunk)
                            chunk.clear()
                    else:
                        skipped += 1

                if chunk:
                    cursor.executemany(sql, chunk)
                    inserted += len(chunk)

                cursor.execute("COMMIT")
                # Full-table reload: refresh planner stats so indexes stay effective
                # after large Excel imports (audit: periodic ANALYZE).
                try:
                    conn.execute("ANALYZE imagenes")
                except sqlite3.Error:
                    logger.debug("ANALYZE after import failed", exc_info=True)
                return {"inserted": inserted, "skipped": skipped}
            except sqlite3.Error as exc:
                cursor.execute("ROLLBACK")
                msg = f"Error importando datos: {exc}"
                raise DatabaseError(msg) from exc
    finally:
        wb.close()


def exportar_excel(excel_path: str) -> int:
    """Exporta los datos actuales de SQLite a un archivo Excel."""
    try:
        import pandas as pd  # type: ignore
    except ImportError as exc:
        msg = "pandas no está instalado."
        raise ImportError(msg) from exc

    with _db_read_lock:
        conn = _get_read_connection()
        field_names = [_validate_identifier(fn) for fn in get_field_names()]
        cols = ", ".join(_qi(fn) for fn in field_names)
        df = pd.read_sql_query(f"SELECT {cols} FROM imagenes ORDER BY id", conn)

    df.to_excel(excel_path, index=False, engine="openpyxl")
    return len(df)




def _record_code_match(
    result: dict[str, dict[str, Any]],
    code_rowids: dict[str, int],
    val: str,
    row_id: int,
    row_dict: dict[str, Any],
) -> None:
    """Map ``val -> row_dict`` with first-wins semantics.

    Codes are expected to be unique across the catalog. If ``val`` was already
    resolved to a *different* row, keep the first match and log the collision
    instead of silently letting the last row win.
    """
    prev_id = code_rowids.get(val)
    if prev_id is not None and prev_id != row_id:
        logger.warning(
            "Código duplicado en catálogo: %r coincide con varios "
            "registros (rowid %s vs %s). Se conserva el primero.",
            val, prev_id, row_id,
        )
        return
    code_rowids[val] = row_id
    result[val] = row_dict


def buscar_lote_por_codigos(codigos: list[str]) -> dict[str, dict[str, Any]]:
    """Busca múltiples códigos en una sola operación de BD.

    Pre-carga todos los registros que coincidan con cualquiera de los códigos
    proporcionados, eliminando la necesidad de N queries individuales.

    Strategy: prefer a single-column ``codigo`` (or first field) lookup with a
    large chunk size, then fall back to multi-field OR only for unresolved codes
    so multi-key catalogs keep working. Matching is case-insensitive (casefold).

    Args:
        codigos: Lista de códigos a buscar.

    Returns:
        Dict {codigo: registro} keyed by the query code form provided.
    """
    if not codigos:
        return {}
    with _db_read_lock:
        conn = _get_read_connection()
        cursor = conn.cursor()
        field_names = [_validate_identifier(fn) for fn in get_field_names()]
        if not field_names:
            return {}

        # casefold → first query spelling (results keyed by caller's form)
        query_by_fold: dict[str, str] = {}
        for raw in codigos:
            text = str(raw).strip()
            if text:
                query_by_fold.setdefault(text.casefold(), text)
        if not query_by_fold:
            return {}
        folded_codes = list(query_by_fold.keys())

        result: dict[str, dict[str, Any]] = {}
        # Track which DB row each code was first resolved to, so collisions (the
        # same code matching two distinct records) are logged instead of letting
        # the last row win. Codes are expected to be unique.
        code_rowids: dict[str, int] = {}
        cols = ", ".join(_qi(fn) for fn in field_names)

        preferred = "codigo" if "codigo" in field_names else field_names[0]

        def _query_key_for(val: str) -> str | None:
            return query_by_fold.get(val.casefold())

        def _scan_column(codes: list[str], column: str) -> None:
            CHUNK = 900
            for i in range(0, len(codes), CHUNK):
                chunk = codes[i:i + CHUNK]
                placeholders = ", ".join(["?"] * len(chunk))
                cursor.execute(
                    f"SELECT rowid AS __antares_rowid__, {cols} FROM imagenes "
                    f"WHERE lower({_qi(column)}) IN ({placeholders})",
                    chunk,
                )
                for row in cursor.fetchall():
                    row_dict = dict(row)
                    row_id = row_dict.pop("__antares_rowid__")
                    for fn in field_names:
                        val = str(row_dict.get(fn, "") or "").strip()
                        query_key = _query_key_for(val) if val else None
                        if query_key:
                            _record_code_match(result, code_rowids, query_key, row_id, row_dict)

        # Pass 1: fast path on preferred key column.
        _scan_column(folded_codes, preferred)

        unresolved = [c for c in folded_codes if query_by_fold[c] not in result]
        if unresolved and len(field_names) > 1:
            # Pass 2: multi-field OR only for codes still missing.
            # safe margin for SQLite param limit; clamp to >=1 so a schema with
            # >900 fields cannot produce CHUNK == 0 (range step of 0 -> ValueError).
            CHUNK = max(1, 900 // len(field_names))
            other_fields = [fn for fn in field_names if fn != preferred]
            for i in range(0, len(unresolved), CHUNK):
                chunk = unresolved[i:i + CHUNK]
                placeholders = ", ".join(["?"] * len(chunk))
                conditions = " OR ".join(
                    [f"lower({_qi(fn)}) IN ({placeholders})" for fn in other_fields]
                )
                params = chunk * len(other_fields)
                cursor.execute(
                    f"SELECT rowid AS __antares_rowid__, {cols} FROM imagenes WHERE {conditions}",
                    params,
                )
                for row in cursor.fetchall():
                    row_dict = dict(row)
                    row_id = row_dict.pop("__antares_rowid__")
                    for fn in field_names:
                        val = str(row_dict.get(fn, "") or "").strip()
                        query_key = _query_key_for(val) if val else None
                        if query_key:
                            _record_code_match(result, code_rowids, query_key, row_id, row_dict)
        return result


def buscar_por_columna(codigos: list[str], column: str) -> dict[str, dict[str, Any]]:
    """Busca múltiples códigos en una columna específica de la BD.

    Matching is case-insensitive (casefold). Result keys use the caller's
    query spelling.

    Args:
        codigos: Lista de códigos a buscar.
        column: Nombre de la columna clave donde buscar.

    Returns:
        Dict {codigo: registro} para los códigos encontrados.
    """
    if not codigos or not column:
        return {}
    safe_column = _validate_identifier(column)
    with _db_read_lock:
        conn = _get_read_connection()
        cursor = conn.cursor()
        field_names_list = [_validate_identifier(fn) for fn in get_field_names()]
        field_names = set(field_names_list)
        if safe_column not in field_names:
            return {}

        query_by_fold: dict[str, str] = {}
        for raw in codigos:
            text = str(raw).strip()
            if text:
                query_by_fold.setdefault(text.casefold(), text)
        if not query_by_fold:
            return {}
        folded_codes = list(query_by_fold.keys())

        result: dict[str, dict[str, Any]] = {}
        # Track which DB row each code was first resolved to, so collisions (the
        # same code matching two distinct records) are logged instead of letting
        # the last row win. Codes are expected to be unique.
        code_rowids: dict[str, int] = {}
        CHUNK = 900  # safe margin for SQLite param limit
        cols = ", ".join(_qi(fn) for fn in field_names_list)
        for i in range(0, len(folded_codes), CHUNK):
            chunk = folded_codes[i:i + CHUNK]
            placeholders = ", ".join(["?"] * len(chunk))
            cursor.execute(
                f"SELECT rowid AS __antares_rowid__, {cols} FROM imagenes "
                f"WHERE lower({_qi(safe_column)}) IN ({placeholders})",
                chunk,
            )
            for row in cursor.fetchall():
                row_dict = dict(row)
                row_id = row_dict.pop("__antares_rowid__")
                val = str(row_dict.get(safe_column, "") or "").strip()
                query_key = query_by_fold.get(val.casefold()) if val else None
                if query_key:
                    _record_code_match(result, code_rowids, query_key, row_id, row_dict)
        return result


def obtener_todos(limit: int | None = None, offset: int = 0) -> list[dict[str, Any]]:
    """Retorna registros como lista de diccionarios con paginación opcional.

    Ordenado explícitamente por ``id`` (rowid): el mapeo posicional del modo
    ``use_column_rename`` (archivo i ↔ registro i, en preview y en cada chunk
    del job) depende de un orden determinista — sin ORDER BY, SQLite podía
    devolver un orden distinto según el plan de consulta y desalinear el
    renombrado respecto al registro correcto.

    Args:
        limit: Número máximo de registros a retornar. None = todos.
        offset: Número de registros a saltar desde el inicio.
    """
    with _db_read_lock:
        conn = _get_read_connection()
        cursor = conn.cursor()
        field_names = [_validate_identifier(fn) for fn in get_field_names()]
        cols = ", ".join(_qi(fn) for fn in field_names)
        sql = f"SELECT {cols} FROM imagenes ORDER BY id"
        params: list[Any] = []
        if limit is not None:
            sql += " LIMIT ? OFFSET ?"
            params = [limit, offset]
        cursor.execute(sql, params)
        rows = cursor.fetchall()
    return [dict(r) for r in rows]


def limpiar_base_datos() -> int:
    """Elimina todos los registros de la tabla imagenes."""
    db_path = get_db_path()
    if not db_path.exists():
        return 0
    with _db_lock:
        conn = _get_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT COUNT(*) FROM imagenes")
        row = cursor.fetchone()
        count = int(row[0]) if row else 0
        # La conexión usa isolation_level=None (autocommit): el DELETE ya quedó
        # commiteado; un commit() explícito aquí era un no-op.
        cursor.execute("DELETE FROM imagenes")
    # No VACUUM aquí: reescribe TODO el archivo (incluidas historial/ubicaciones)
    # y puede tardar segundos con catálogos grandes. SQLite reutiliza las páginas
    # liberadas en el siguiente import, así que el archivo no crece sin límite
    # entre ciclos de vaciar/reimportar.
    return count


_MAPPING_ID_ALIASES = ("id", "codigo", "code", "filename", "archivo", "nombre original")
_MAPPING_RENAME_ALIASES = ("renombre", "rename", "new_name", "newname", "nombre nuevo", "nuevo_nombre", "nuevonombre")


def _normalize_header_alias(header: str) -> str:
    """Normaliza un encabezado para matching de alias: minúsculas, sin acentos, espacios/underscores/guiones unificados."""
    text = str(header).lower().strip()
    text = "".join(c for c in unicodedata.normalize("NFKD", text) if unicodedata.category(c) != "Mn")
    text = re.sub(r"[\s_\-]+", " ", text)
    text = " ".join(text.split())
    return text


def _detect_column(columns: list[str], aliases: tuple[str, ...]) -> str | None:
    """Devuelve la columna que mejor coincida con los alias, respetando el orden de prioridad.

    Los alias se normalizan con la misma función que los encabezados: alias con
    guiones bajos ("new_name", "nuevo_nombre") ahora matchean encabezados con
    espacios ("new name", "nuevo nombre") y viceversa.
    """
    for alias in aliases:
        normalized_alias = _normalize_header_alias(alias)
        for col in columns:
            if _normalize_header_alias(col) == normalized_alias:
                return col
    return None


def parse_id_rename_mapping(
    excel_path: str,
    id_column: str | None = None,
    rename_column: str | None = None,
) -> dict[str, str]:
    """Parsea un Excel de mapeo (columnas ID y nuevo nombre) en un dict de mapeo directo.

    Args:
        excel_path: Ruta al archivo .xlsx.
        id_column: Nombre de la columna ID. Si no se indica, se auto-detecta.
        rename_column: Nombre de la columna con el nuevo nombre. Si no se indica, se auto-detecta.

    Returns:
        Dict {ID.strip(): nuevo_nombre_sanitizado.strip()}.

    Raises:
        ValueError: Si la estructura no es válida (columnas, duplicados, celdas vacías).
        FileNotFoundError: Si el archivo no existe.
        ImportError: Si pandas/openpyxl no están instalados.

    Note:
        Para obtener también las columnas detectadas y todas las disponibles, usa
        :func:`parse_id_rename_mapping_full`.
    """
    result = parse_id_rename_mapping_full(excel_path, id_column, rename_column)
    return cast(dict[str, str], result["mapping"])


def parse_id_rename_mapping_full(
    excel_path: str,
    id_column: str | None = None,
    rename_column: str | None = None,
) -> dict[str, Any]:
    """Variante de :func:`parse_id_rename_mapping` que devuelve metadatos de columnas.

    Returns:
        Dict con claves:
        - ``mapping``: dict {ID.strip(): nuevo_nombre_sanitizado.strip()}.
        - ``id_column``: nombre (normalizado) de la columna ID usada.
        - ``rename_column``: nombre (normalizado) de la columna de nuevo nombre usada.
        - ``columns``: lista de todas las columnas normalizadas del Excel.

    Raises:
        ValueError: Si la estructura no es válida (columnas, duplicados, celdas vacías).
        FileNotFoundError: Si el archivo no existe.
        ImportError: Si pandas/openpyxl no están instalados.
    """
    try:
        from backend.core.import_guard import serialized_import

        with serialized_import():
            import pandas as pd  # type: ignore
    except ImportError as exc:
        msg = "pandas no está instalado. Ejecuta: pip install pandas openpyxl"
        raise ImportError(msg) from exc

    from backend.utils.validators import sanitizar_nombre

    if not Path(excel_path).exists():
        msg = f"No se encontró el archivo: {excel_path}"
        raise FileNotFoundError(msg)

    df = pd.read_excel(
        excel_path,
        dtype=str,
        engine="openpyxl",
        engine_kwargs={"read_only": True},
    )
    df.columns = _normalize_excel_columns(list(df.columns))
    columns = list(df.columns)

    if len(columns) < 2:
        msg = (
            f"El Excel de mapeo necesita al menos 2 columnas (una ID y una de nuevo nombre). "
            f"Columnas encontradas: {columns}"
        )
        raise ValueError(msg)

    raw_id_column = id_column or _detect_column(columns, _MAPPING_ID_ALIASES)
    raw_rename_column = rename_column or _detect_column(columns, _MAPPING_RENAME_ALIASES)

    chosen_id = raw_id_column if raw_id_column in df.columns else None
    chosen_rename = raw_rename_column if raw_rename_column in df.columns else None

    if not chosen_id:
        msg = (
            f"No se detectó una columna ID. Usa una columna como ID, Código, Code, Filename, Archivo, "
            f"o indica id_column. Columnas disponibles: {columns}"
        )
        raise ValueError(msg)
    if not chosen_rename:
        msg = (
            f"No se detectó una columna de nuevo nombre. Usa RENOMBRE, Nombre, New_Name, etc., "
            f"o indica rename_column. Columnas disponibles: {columns}"
        )
        raise ValueError(msg)
    if chosen_id == chosen_rename:
        msg = "La columna ID y la columna de nuevo nombre no pueden ser la misma."
        raise ValueError(msg)

    result: dict[str, str] = {}
    seen_ids: set[str] = set()

    for row_idx, row in df.iterrows():
        excel_row = int(row_idx) + 2  # encabezado + base 1
        raw_id = row.get(chosen_id)
        raw_rename = row.get(chosen_rename)

        if pd.isna(raw_id) or not str(raw_id).strip():
            msg = f"ID vacío en la fila {excel_row} de la columna '{chosen_id}'"
            raise ValueError(msg)
        if pd.isna(raw_rename) or not str(raw_rename).strip():
            msg = f"Nuevo nombre vacío en la fila {excel_row} de la columna '{chosen_rename}'"
            raise ValueError(msg)

        id_key = str(raw_id).strip()
        if id_key in seen_ids:
            msg = f"ID duplicado '{id_key}' en la fila {excel_row} de la columna '{chosen_id}'"
            raise ValueError(msg)
        seen_ids.add(id_key)

        rename_val = sanitizar_nombre(str(raw_rename).strip())
        if not rename_val:
            msg = f"Nuevo nombre inválido en la fila {excel_row} de la columna '{chosen_rename}'"
            raise ValueError(msg)
        result[id_key] = rename_val

    return {
        "mapping": result,
        "id_column": chosen_id,
        "rename_column": chosen_rename,
        "columns": columns,
    }


def generar_plantilla_excel(ruta_salida: str) -> int:
    """Genera un archivo Excel de plantilla con las columnas esperadas.

    Args:
        ruta_salida: Ruta donde guardar la plantilla.
    """
    try:
        import pandas as pd  # type: ignore
    except ImportError as exc:
        msg = "pandas no está instalado."
        raise ImportError(msg) from exc

    fields = load_fields()
    columns = [f["name"] for f in fields]
    df = pd.DataFrame(columns=columns)
    sample: list[str] = []
    for f in fields:
        fname: str = f["name"]
        if fname == "codigo":
            sample.append("IMG-001")
        elif fname == "nombre":
            sample.append("Producto Ejemplo")
        elif fname == "categoria":
            sample.append("Categoria A")
        elif fname == "marca":
            sample.append("Marca X")
        elif fname == "modelo":
            sample.append("Modelo 2024")
        elif fname == "descripcion":
            sample.append("Descripción de prueba")
        else:
            sample.append(f"Ejemplo {fname}")
    df.loc[0] = sample
    df.to_excel(ruta_salida, index=False, engine="openpyxl")
    return len(df)
