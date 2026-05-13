"""Importador de archivos Excel (``.xlsx``) para Panel Aviso de Corte.

Este módulo expone :func:`parse_excel_bytes`, una función pura que recibe
los bytes crudos de un archivo ``.xlsx`` y su nombre original y devuelve un
:class:`~backend.core.panel_aviso_corte.models.ExcelSource`.

Responsabilidades:

* Validar la extensión ``.xlsx`` (Req 6.1 / 6.2).
* Abrir la primera hoja activa con ``openpyxl`` en modo ``read_only``
  (Req 6.3). El modo ``read_only`` es obligatorio para no cargar en
  memoria hojas muy grandes y para preservar la semántica de streaming.
* Normalizar los nombres de columna (Req 6.4): delegado a
  :func:`~backend.core.panel_aviso_corte.matcher._normalize_column_name`,
  que aplica ``NFKD`` + descarte de *combining marks* + limpieza de
  símbolos + colapso de whitespace + ``casefold``.
* Devolver nombres originales y normalizados lado a lado (Req 6.7).
* Validar número de filas de datos: ``>= 1`` (Req 6.5) y
  ``<= MAX_EXCEL_ROWS`` (Req 6.8).
* Traducir fallos de lectura (archivo corrupto, protegido, zip inválido)
  a :class:`InvalidExcelError` con el mensaje *"No se pudo leer el archivo
  Excel: {detalle}"* (Req 6.6).
* Emitir logs en el logger estándar del módulo ante cada ruta de error
  (Req 16.4).
"""

from __future__ import annotations

import logging
import zipfile
from io import BytesIO
from typing import Any

import openpyxl
from openpyxl.utils.exceptions import InvalidFileException

from .errors import InvalidExcelError
from .matcher import _normalize_column_name
from .models import MAX_EXCEL_ROWS, ExcelSource

#: Logger estándar del módulo (ver Req 16.4).
logger = logging.getLogger(__name__)

#: Mensajes de error exactos definidos por los acceptance criteria.
_ERR_INVALID_EXTENSION: str = "Solo se admiten archivos .xlsx"
_ERR_NO_DATA_ROWS: str = "El Excel no contiene filas de datos"
_ERR_ROW_LIMIT: str = f"El Excel excede el límite de {MAX_EXCEL_ROWS:,} filas".replace(
    ",", ".",
)
# "No se pudo leer el archivo Excel: {detalle}" — prefijo usado por varios
# fallos; el detalle se añade en el sitio de captura.
_ERR_READ_PREFIX: str = "No se pudo leer el archivo Excel"


def _coerce_cell(value: Any) -> str:
    """Convierte un valor de celda openpyxl a str para el dominio.

    - ``None`` → ``""`` (celda vacía).
    - ``str`` → tal cual (sin alterar).
    - ``datetime`` / ``date`` → formato ISO ``YYYY-MM-DD`` (para que pase
      la validación de ``Panel.fecha_corte``).
    - Cualquier otro tipo (int, float, Decimal) → ``str(value)``.
    """
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    # openpyxl devuelve datetime para celdas con formato de fecha;
    # necesitamos solo la parte de fecha en formato ISO.
    import datetime as _dt
    if isinstance(value, _dt.datetime):
        return value.strftime("%Y-%m-%d")
    if isinstance(value, _dt.date):
        return value.strftime("%Y-%m-%d")
    return str(value)


def _is_row_completely_empty(raw_row: tuple[Any, ...]) -> bool:
    """True si la fila es una tupla de valores ``None``/vacíos.

    Se usa para saltar filas completamente vacías sin contarlas como filas
    de datos (evita falsos positivos del límite y del "sin filas").
    """
    for value in raw_row:
        if value is None:
            continue
        if isinstance(value, str) and value.strip() == "":
            continue
        return False
    return True


# ---------------------------------------------------------------------------

def parse_excel_bytes(content: bytes, filename: str) -> ExcelSource:
    """Parsea los bytes de un Excel y devuelve un :class:`ExcelSource`.

    :param content: bytes crudos del archivo ``.xlsx``.
    :param filename: nombre original del archivo (con extensión). Se usa
        sólo para validar la extensión y como metadato; no se lee del disco.

    :raises InvalidExcelError: con el mensaje exacto especificado por el
        requirements doc:

        * ``"Solo se admiten archivos .xlsx"`` — extensión distinta (6.2).
        * ``"El Excel no contiene filas de datos"`` — cabecera sin filas
          de datos válidas debajo (6.5).
        * ``"El Excel excede el límite de 10.000 filas"`` — límite superado
          (6.8).
        * ``"No se pudo leer el archivo Excel: {detalle}"`` — archivo
          corrupto, protegido, zip inválido, cabecera vacía o columnas
          duplicadas tras normalizar (6.6).

    :returns: un :class:`ExcelSource` con:

        * ``filename``: el nombre original pasado por el caller.
        * ``columns``: tupla de nombres de columna **originales**
          (orden y casing tal como aparecen en la cabecera).
        * ``normalized_columns``: tupla paralela a ``columns`` con los
          nombres normalizados (``NFKD`` + casefold + sin símbolos).
        * ``rows``: tupla de dicts ``{columna_original: str}``; los valores
          vienen coaccionados a ``str`` (``None`` → ``""``).
        * ``warnings``: tupla de advertencias no fatales (por ejemplo,
          filas completamente vacías que fueron omitidas).
    """
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

    # ---- Validación de extensión (Req 6.1 / 6.2) ----
    if not filename.lower().endswith(".xlsx"):
        logger.warning(
            "parse_excel_bytes: extensión inválida para filename=%r", filename,
        )
        raise InvalidExcelError(_ERR_INVALID_EXTENSION)

    # ---- Apertura del workbook (Req 6.3 / 6.6) ----
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
        # No envolver dos veces si un helper futuro ya hizo el trabajo.
        raise
    except Exception as err:  # pragma: no cover - defensivo
        # openpyxl puede lanzar distintos tipos según el fallo concreto
        # (KeyError en archivos con estructura rara, OSError del stream).
        # Todos caen en la categoría "no se pudo leer" del Req 6.6.
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

        # Cabecera vacía o con todos None → archivo ilegible (Req 6.6).
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
                # Una celda None **en medio** de la cabecera invalida la
                # estructura: la convención del importer es que el rango
                # de columnas es contiguo y todas tienen nombre.
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
            # openpyxl puede devolver filas más cortas si la hoja tiene
            # columnas residuales truncadas; alineamos con len(original_columns).
            if raw_row is None:
                skipped_empty_rows += 1
                continue
            if _is_row_completely_empty(raw_row):
                skipped_empty_rows += 1
                continue

            # Enforce el límite antes de acumular demasiado (Req 6.8).
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
        # ``read_only`` workbooks deben cerrarse explícitamente para liberar
        # el file handle sobre el BytesIO y el stream comprimido.
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
