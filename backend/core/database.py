"""Módulo de base de datos: SQLite embebido con importación/exportación de Excel."""

from __future__ import annotations

import contextlib
import logging
import re
import sqlite3
import unicodedata
from pathlib import Path
from typing import Any

from backend.core.config_fields import get_field_names, load_fields, save_fields
from backend.core.exceptions import DatabaseError
from backend.core.repository import _db_lock, get_connection
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


def _build_schema(fields: list[dict[str, Any]]) -> str:
    """Construye la sentencia CREATE TABLE a partir de la configuración de campos."""
    columns = ["id INTEGER PRIMARY KEY AUTOINCREMENT"]
    for f in fields:
        name = _validate_identifier(f["name"])
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


def _create_indexes(cursor: sqlite3.Cursor, fields: list[dict[str, Any]]) -> None:
    """Create indexes on all queryable fields to avoid full-table scans."""
    if not fields:
        return

    for f in fields:
        name = _validate_identifier(f["name"])
        unique_clause = "UNIQUE" if f.get("unique") else ""
        cursor.execute(
            f"CREATE {unique_clause} INDEX IF NOT EXISTS idx_imagenes_{name} ON imagenes({_qi(name)})"
        )


def init_db() -> None:
    """Inicializa la base de datos SQLite con la tabla principal según campos configurados."""
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
                expected_cols = {f["name"]: f["type"] for f in fields}
                expected_cols["id"] = "INTEGER"

                new_cols = {name: ftype for name, ftype in expected_cols.items() if name not in existing_cols}
                removed_cols = [name for name in existing_cols if name not in expected_cols]
                changed_cols = [name for name in expected_cols if name in existing_cols and existing_cols[name] != expected_cols[name]]

                if removed_cols or changed_cols:
                    try:
                        cursor.execute("SELECT * FROM imagenes")
                        old_rows = cursor.fetchall()
                        old_cols = [d[0] for d in cursor.description]
                    except sqlite3.Error as exc:
                        logger.warning("No se pudieron leer datos antiguos durante migración: %s", exc)
                        old_rows = []
                        old_cols = []
                    cursor.execute("ALTER TABLE imagenes RENAME TO imagenes_old")
                    cursor.execute(_build_schema(fields))
                    if old_rows:
                        new_col_names = [_validate_identifier(f["name"]) for f in fields]
                        placeholders = ", ".join(["?"] * len(new_col_names))
                        col_names = ", ".join(_qi(c) for c in new_col_names)
                        defaults = {"INTEGER": 0, "REAL": 0.0, "TEXT": "", "BLOB": b""}
                        try:
                            all_values: list[list[Any]] = []
                            for row in old_rows:
                                row_dict = dict(zip(old_cols, row, strict=False))
                                values: list[Any] = []
                                for f in fields:
                                    col = f["name"]
                                    if col in row_dict and row_dict[col] is not None:
                                        values.append(row_dict[col])
                                    elif f.get("required"):
                                        values.append(defaults.get(f["type"], ""))
                                    else:
                                        values.append(None)
                                values_list = values
                                all_values.append(values_list)
                            cursor.executemany(
                                f"INSERT INTO imagenes ({col_names}) VALUES ({placeholders})", all_values
                            )
                            cursor.execute("DROP TABLE imagenes_old")
                        except sqlite3.Error as exc:
                            logger.error("Fallo migración de datos, se mantiene tabla antigua: %s", exc)
                            cursor.execute("DROP TABLE imagenes")
                            cursor.execute("ALTER TABLE imagenes_old RENAME TO imagenes")
                            raise DatabaseError(f"Migración fallida, esquema anterior preservado: {exc}") from exc
                    else:
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
            with contextlib.suppress(sqlite3.Error):
                cursor.execute("ROLLBACK")
            raise DatabaseError(f"Inicialización/migración de base de datos fallida: {exc}") from exc


def importar_excel(excel_path: str) -> int:
    """Importa datos desde Excel (.xlsx) a SQLite.

    Args:
        excel_path: Ruta al archivo Excel.

    Returns:
        Cantidad de registros importados.

    Raises:
        ImportError: Si pandas no está instalado.
        ValueError: Si faltan columnas requeridas.
        DatabaseError: Si ocurre un error de base de datos.
    """
    try:
        import pandas as pd  # type: ignore
    except ImportError as exc:
        msg = "pandas no está instalado. Ejecuta: pip install pandas openpyxl"
        raise ImportError(msg) from exc

    if not Path(excel_path).exists():
        msg = f"No se encontró el archivo: {excel_path}"
        raise FileNotFoundError(msg)

    df = pd.read_excel(excel_path, dtype=str, engine="openpyxl")
    df.columns = _normalize_excel_columns(list(df.columns))

    fields = load_fields()
    field_names = [f["name"] for f in fields]
    new_columns = [c for c in df.columns if c not in field_names]
    if new_columns:
        fields = [
            *fields,
            *[
                {"name": column, "type": "TEXT", "required": False, "unique": False}
                for column in new_columns
            ],
        ]
        save_fields(fields)
        field_names = [f["name"] for f in fields]

    # Asegurar que el esquema de BD coincida con los campos, incluyendo columnas del Excel.
    init_db()
    required = [f["name"] for f in fields if f.get("required")]

    # Validate all field names as safe SQL identifiers (defense in depth)
    field_names = [_validate_identifier(fn) for fn in field_names]

    missing = [r for r in required if r not in df.columns]
    if missing:
        msg = (
            f"El Excel debe contener al menos las columnas requeridas: {missing}. "
            f"Columnas encontradas: {list(df.columns)}"
        )
        raise ValueError(
            msg,
        )

    with _db_lock:
        conn = _get_connection()
        cursor = conn.cursor()

        try:
            cursor.execute("BEGIN")

            cursor.execute("DELETE FROM imagenes")

            placeholders = ", ".join(["?"] * len(field_names))
            col_names = ", ".join(_qi(fn) for fn in field_names)
            sql = f"INSERT INTO imagenes ({col_names}) VALUES ({placeholders})"

            # Use executemany for bulk insert performance
            all_values: list[list[Any]] = []
            for _, row in df.iterrows():
                values: list[Any] = []
                valid = True
                for fn in field_names:
                    val = row.get(fn)
                    if pd.notna(val) and str(val).strip():
                        values.append(str(val).strip())
                    elif fn in required:
                        valid = False
                        break
                    else:
                        values.append(None)
                if valid:
                    all_values.append(values)

            cursor.executemany(sql, all_values)
            inserted = len(all_values)

            cursor.execute("COMMIT")
            return inserted
        except sqlite3.Error as exc:
            cursor.execute("ROLLBACK")
            msg = f"Error importando datos: {exc}"
            raise DatabaseError(msg) from exc


def exportar_excel(excel_path: str) -> int:
    """Exporta los datos actuales de SQLite a un archivo Excel."""
    try:
        import pandas as pd  # type: ignore
    except ImportError as exc:
        msg = "pandas no está instalado."
        raise ImportError(msg) from exc

    with _db_lock:
        conn = _get_connection()
        field_names = [_validate_identifier(fn) for fn in get_field_names()]
        cols = ", ".join(_qi(fn) for fn in field_names)
        df = pd.read_sql_query(f"SELECT {cols} FROM imagenes", conn)

    df.to_excel(excel_path, index=False, engine="openpyxl")
    return len(df)


def buscar_por_codigo(codigo: str) -> dict[str, Any] | None:
    """Busca un registro por código o por cualquier campo de texto exacto.
    Optimizado con una sola query usando OR en lugar de múltiples queries."""
    with _db_lock:
        conn = _get_connection()
        cursor = conn.cursor()
        field_names = [_validate_identifier(fn) for fn in get_field_names()]
        if not field_names:
            return None
        search_value = str(codigo).strip()

        # Single query with OR instead of multiple queries (identifiers are quoted for safety)
        conditions = " OR ".join([f"{_qi(fn)} = ?" for fn in field_names])
        cursor.execute(f"SELECT * FROM imagenes WHERE {conditions} LIMIT 1", [search_value] * len(field_names))
        row = cursor.fetchone()
        return dict(row) if row else None


def buscar_lote_por_codigos(codigos: list[str]) -> dict[str, dict[str, Any]]:
    """Busca múltiples códigos en una sola operación de BD.

    Pre-carga todos los registros que coincidan con cualquiera de los códigos
    proporcionados, eliminando la necesidad de N queries individuales.

    Args:
        codigos: Lista de códigos a buscar.

    Returns:
        Dict {codigo: registro} para los códigos encontrados.
    """
    if not codigos:
        return {}
    with _db_lock:
        conn = _get_connection()
        cursor = conn.cursor()
        field_names = [_validate_identifier(fn) for fn in get_field_names()]
        if not field_names:
            return {}

        unique_codes = list(set(str(c).strip() for c in codigos if c))
        if not unique_codes:
            return {}

        # Batch query: fetch all records where ANY field matches ANY of the codes.
        # Use chunks to avoid SQLite variable limit (999 per query).
        result: dict[str, dict[str, Any]] = {}
        CHUNK = 900 // len(field_names)  # safe margin for SQLite param limit
        for i in range(0, len(unique_codes), CHUNK):
            chunk = unique_codes[i:i + CHUNK]
            placeholders = ", ".join(["?"] * len(chunk))
            conditions = " OR ".join(
                [f"{_qi(fn)} IN ({placeholders})" for fn in field_names]
            )
            params = chunk * len(field_names)
            cursor.execute(f"SELECT * FROM imagenes WHERE {conditions}", params)
            for row in cursor.fetchall():
                row_dict = dict(row)
                # Map each matching field value back to the code
                for fn in field_names:
                    val = str(row_dict.get(fn, "") or "").strip()
                    if val and val in unique_codes:
                        result[val] = row_dict
        return result


def buscar_por_columna(codigos: list[str], column: str) -> dict[str, dict[str, Any]]:
    """Busca múltiples códigos en una columna específica de la BD.

    Args:
        codigos: Lista de códigos a buscar.
        column: Nombre de la columna clave donde buscar.

    Returns:
        Dict {codigo: registro} para los códigos encontrados.
    """
    if not codigos or not column:
        return {}
    safe_column = _validate_identifier(column)
    with _db_lock:
        conn = _get_connection()
        cursor = conn.cursor()
        unique_codes = list(set(str(c).strip() for c in codigos if c))
        if not unique_codes:
            return {}

        result: dict[str, dict[str, Any]] = {}
        CHUNK = 900  # safe margin for SQLite param limit
        for i in range(0, len(unique_codes), CHUNK):
            chunk = unique_codes[i:i + CHUNK]
            placeholders = ", ".join(["?"] * len(chunk))
            cursor.execute(
                f"SELECT * FROM imagenes WHERE {_qi(safe_column)} IN ({placeholders})",
                chunk,
            )
            for row in cursor.fetchall():
                row_dict = dict(row)
                val = str(row_dict.get(safe_column, "") or "").strip()
                if val and val in unique_codes:
                    result[val] = row_dict
        return result


def obtener_todos(limit: int | None = None, offset: int = 0) -> list[dict[str, Any]]:
    """Retorna registros como lista de diccionarios con paginación opcional.

    Args:
        limit: Número máximo de registros a retornar. None = todos.
        offset: Número de registros a saltar desde el inicio.
    """
    with _db_lock:
        conn = _get_connection()
        cursor = conn.cursor()
        field_names = [_validate_identifier(fn) for fn in get_field_names()]
        cols = ", ".join(_qi(fn) for fn in field_names)
        sql = f"SELECT {cols} FROM imagenes"
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
        count = cursor.fetchone()[0]
        cursor.execute("DELETE FROM imagenes")
        conn.commit()
        # Vacuum to reclaim space and optimize
        cursor.execute("VACUUM")
    return count


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
