
from __future__ import annotations

import logging
import zipfile
from io import BytesIO
from typing import Any

from .errors import InvalidExcelError
from .matcher import _normalize_column_name
from .models import MAX_EXCEL_ROWS, ExcelSource

logger = logging.getLogger(__name__)

_ERR_INVALID_EXTENSION: str = "Solo se admiten archivos .xlsx"
_ERR_NO_DATA_ROWS: str = "El Excel no contiene filas de datos"
_ERR_ROW_LIMIT: str = f"El Excel excede el límite de {MAX_EXCEL_ROWS:,} filas".replace(
    ",", ".",
)
_ERR_READ_PREFIX: str = "No se pudo leer el archivo Excel"


def _coerce_cell(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    import datetime as _dt
    if isinstance(value, _dt.datetime):
        return value.strftime("%Y-%m-%d")
    if isinstance(value, _dt.date):
        return value.strftime("%Y-%m-%d")
    return str(value)


def _is_row_completely_empty(raw_row: tuple[Any, ...]) -> bool:
    for value in raw_row:
        if value is None:
            continue
        if isinstance(value, str) and value.strip() == "":
            continue
        return False
    return True


def parse_excel_bytes(content: bytes, filename: str) -> ExcelSource:
    if not isinstance(content, (bytes, bytearray)):
        logger.error(
            "parse_excel_bytes: content debe ser bytes, se recibió %s",
            type(content).__name__,
        )
        msg = f"{_ERR_READ_PREFIX}: el contenido no son bytes válidos"
        raise InvalidExcelError(
            msg,
        )
    if not isinstance(filename, str):
        logger.error(
            "parse_excel_bytes: filename debe ser str, se recibió %s",
            type(filename).__name__,
        )
        raise InvalidExcelError(_ERR_INVALID_EXTENSION)

    if not filename.lower().endswith(".xlsx"):
        logger.warning(
            "parse_excel_bytes: extensión inválida para filename=%r", filename,
        )
        raise InvalidExcelError(_ERR_INVALID_EXTENSION)

    try:
        import openpyxl
        from openpyxl.utils.exceptions import InvalidFileException
    except ImportError as err:  # pragma: no cover - openpyxl es dependencia declarada
        # lazy: openpyxl→numpy arrastran ~1,600 archivos en frío (stall 10.4s medido
        # 2026-09-04 bajo presión de RAM); no se paga en el import del módulo.
        logger.exception("parse_excel_bytes: openpyxl no disponible: %s", err)
        msg = f"{_ERR_READ_PREFIX}: {err}"
        raise InvalidExcelError(msg) from err

    try:
        stream = BytesIO(bytes(content))
        workbook = openpyxl.load_workbook(
            stream,
            read_only=True,
            data_only=True,
        )
    except (InvalidFileException, zipfile.BadZipFile) as err:
        logger.exception(
            "parse_excel_bytes: no se pudo abrir el archivo %r: %s",
            filename,
            err,
        )
        msg = f"{_ERR_READ_PREFIX}: {err}"
        raise InvalidExcelError(msg) from err
    except InvalidExcelError:
        raise
    except Exception as err:  # pragma: no cover - defensivo
        logger.exception(
            "parse_excel_bytes: fallo inesperado abriendo %r: %s",
            filename,
            err,
        )
        msg = f"{_ERR_READ_PREFIX}: {err}"
        raise InvalidExcelError(msg) from err

    try:
        sheet = workbook.active
        if sheet is None:  # pragma: no cover - workbook siempre tiene hoja activa
            logger.error(
                "parse_excel_bytes: workbook %r sin hoja activa", filename,
            )
            msg = f"{_ERR_READ_PREFIX}: el archivo no tiene hojas"
            raise InvalidExcelError(
                msg,
            )

        row_iter = sheet.iter_rows(values_only=True)
        try:
            header_row = next(row_iter)
        except StopIteration as err:
            logger.warning(
                "parse_excel_bytes: archivo %r sin cabecera", filename,
            )
            raise InvalidExcelError(_ERR_NO_DATA_ROWS) from err

        if not header_row or all(cell is None for cell in header_row):
            logger.warning(
                "parse_excel_bytes: cabecera vacía en archivo %r", filename,
            )
            msg = f"{_ERR_READ_PREFIX}: la cabecera está vacía"
            raise InvalidExcelError(
                msg,
            )

        original_columns: list[str] = []
        normalized_columns: list[str] = []
        for idx, cell in enumerate(header_row):
            if cell is None:
                logger.warning(
                    "parse_excel_bytes: celda de cabecera vacía en columna %d de %r",
                    idx,
                    filename,
                )
                msg = f"{_ERR_READ_PREFIX}: la cabecera contiene celdas vacías"
                raise InvalidExcelError(
                    msg,
                )
            original = _coerce_cell(cell).strip()
            if not original:
                logger.warning(
                    "parse_excel_bytes: nombre de columna vacío en posición %d de %r",
                    idx,
                    filename,
                )
                msg = f"{_ERR_READ_PREFIX}: la cabecera contiene celdas vacías"
                raise InvalidExcelError(
                    msg,
                )
            normalized = _normalize_column_name(original)
            if not normalized:
                logger.warning(
                    "parse_excel_bytes: la columna %r no normaliza a un nombre "
                    "utilizable (archivo %r)",
                    original,
                    filename,
                )
                msg = (
                    f"{_ERR_READ_PREFIX}: nombre de columna no utilizable: "
                    f"{original!r}"
                )
                raise InvalidExcelError(
                    msg,
                )
            original_columns.append(original)
            normalized_columns.append(normalized)

        seen: set[str] = set()
        for norm in normalized_columns:
            if norm in seen:
                logger.warning(
                    "parse_excel_bytes: columna normalizada duplicada %r en %r",
                    norm,
                    filename,
                )
                msg = (
                    f"{_ERR_READ_PREFIX}: columnas duplicadas tras normalizar "
                    f"({norm!r})"
                )
                raise InvalidExcelError(
                    msg,
                )
            seen.add(norm)

        rows: list[dict[str, str]] = []
        skipped_empty_rows = 0
        for raw_row in row_iter:
            if raw_row is None:
                skipped_empty_rows += 1
                continue
            if _is_row_completely_empty(raw_row):
                skipped_empty_rows += 1
                continue

            if len(rows) >= MAX_EXCEL_ROWS:
                logger.warning(
                    "parse_excel_bytes: archivo %r excede MAX_EXCEL_ROWS=%d",
                    filename,
                    MAX_EXCEL_ROWS,
                )
                raise InvalidExcelError(_ERR_ROW_LIMIT)

            row_dict: dict[str, str] = {}
            for col_idx, col_name in enumerate(original_columns):
                value: Any = raw_row[col_idx] if col_idx < len(raw_row) else None
                row_dict[col_name] = _coerce_cell(value)
            rows.append(row_dict)

        if not rows:
            logger.warning(
                "parse_excel_bytes: archivo %r sin filas de datos válidas",
                filename,
            )
            raise InvalidExcelError(_ERR_NO_DATA_ROWS)

        warnings: tuple[str, ...] = ()
        if skipped_empty_rows > 0:
            warnings = (
                f"Se omitieron {skipped_empty_rows} filas totalmente vacías",
            )

        logger.info(
            "parse_excel_bytes: archivo %r parseado OK (%d filas, %d columnas)",
            filename,
            len(rows),
            len(original_columns),
        )
        return ExcelSource(
            filename=filename,
            columns=tuple(original_columns),
            normalized_columns=tuple(normalized_columns),
            rows=tuple(rows),
            warnings=warnings,
        )
    finally:
        try:
            workbook.close()
        except Exception:  # pragma: no cover - defensivo
            logger.debug(
                "parse_excel_bytes: error cerrando workbook %r",
                filename,
                exc_info=True,
            )


__all__ = [
    "parse_excel_bytes",
]
