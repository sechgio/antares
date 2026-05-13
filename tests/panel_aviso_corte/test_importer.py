"""Tests del importador de Excel (``.xlsx``) para Panel Aviso de Corte.

Cubre los casos principales de :func:`parse_excel_bytes`:

* Archivo ``.xlsx`` válido con cabecera + filas de datos.
* Normalización de nombres de columna (tildes, mayúsculas, símbolos).
* Archivo sin filas de datos (solo cabecera) → mensaje exacto Req 6.5.
* Archivo con más de 10.000 filas → mensaje exacto Req 6.8.
* Archivo con extensión incorrecta → mensaje exacto Req 6.2.
* Archivo corrupto / bytes inválidos → mensaje con prefijo Req 6.6.
* Archivo con cabecera vacía (celda None en medio) → Req 6.6.
* Columnas que colisionan tras normalizar → Req 6.6.
* Celdas vacías coaccionadas a cadena vacía.
* Filas completamente vacías omitidas con warning informativo.

Las fixtures se construyen **en memoria** con openpyxl (sin tocar disco) y
devuelven los bytes que recibiría ``parse_excel_bytes`` en producción.

Validates: Requirements 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.8
"""

from __future__ import annotations

from io import BytesIO
from typing import TYPE_CHECKING, Any

import openpyxl
import pytest

from backend.core.panel_aviso_corte.errors import InvalidExcelError
from backend.core.panel_aviso_corte.importer import parse_excel_bytes
from backend.core.panel_aviso_corte.models import MAX_EXCEL_ROWS, ExcelSource

if TYPE_CHECKING:
    from collections.abc import Sequence

# Fixtures / helpers de construcción de xlsx en memoria


def _build_xlsx(rows: Sequence[Sequence[Any]]) -> bytes:
    """Serializa una matriz de celdas (cabecera + filas) a bytes ``.xlsx``.

    La primera fila se asume como cabecera. Devuelve los bytes del archivo
    generado por openpyxl, equivalentes a lo que el frontend enviaría al
    importar un ``.xlsx``.
    """
    workbook = openpyxl.Workbook()
    sheet = workbook.active
    for row in rows:
        sheet.append(list(row))
    buffer = BytesIO()
    workbook.save(buffer)
    workbook.close()
    return buffer.getvalue()


@pytest.fixture
def valid_xlsx_bytes() -> bytes:
    """Bytes de un ``.xlsx`` válido con 3 filas de datos y columnas canónicas."""
    return _build_xlsx(
        [
            ["CUADRANTE AFECTADO", "FECHA DE CORTE", "MOTIVO", "DIRECCIÓN"],
            ["CUAD-01", "2024-01-15", "Mantenimiento", "Av. Principal 100"],
            ["CUAD-02", "2024-01-16", "Reparación", "Av. Secundaria 200"],
            ["CUAD-03", "2024-01-17", "Limpieza", "Pasaje Ñandú 50"],
        ],
    )


@pytest.fixture
def header_only_xlsx_bytes() -> bytes:
    """``.xlsx`` con cabecera pero sin filas de datos."""
    return _build_xlsx(
        [["CUADRANTE AFECTADO", "FECHA DE CORTE", "MOTIVO"]],
    )


# Casos de éxito


class TestParseValidXlsx:
    def test_returns_excel_source_with_filename(self, valid_xlsx_bytes: bytes) -> None:
        result = parse_excel_bytes(valid_xlsx_bytes, "datos.xlsx")
        assert isinstance(result, ExcelSource)
        assert result.filename == "datos.xlsx"

    def test_preserves_original_columns_in_order(
        self, valid_xlsx_bytes: bytes,
    ) -> None:
        result = parse_excel_bytes(valid_xlsx_bytes, "datos.xlsx")
        assert result.columns == (
            "CUADRANTE AFECTADO",
            "FECHA DE CORTE",
            "MOTIVO",
            "DIRECCIÓN",
        )

    def test_normalizes_column_names_removing_accents_and_casefolding(
        self, valid_xlsx_bytes: bytes,
    ) -> None:
        result = parse_excel_bytes(valid_xlsx_bytes, "datos.xlsx")
        assert result.normalized_columns == (
            "cuadrante afectado",
            "fecha de corte",
            "motivo",
            "direccion",
        )

    def test_normalizes_columns_stripping_symbols(self) -> None:
        content = _build_xlsx(
            [
                ["Motivo (principal):", "Número N°", "Fecha / Hora"],
                ["A", "1", "2024-01-15"],
            ],
        )
        result = parse_excel_bytes(content, "x.xlsx")
        assert result.normalized_columns == (
            "motivo principal",
            "numero n",
            "fecha hora",
        )

    def test_rows_indexed_by_original_column_name(
        self, valid_xlsx_bytes: bytes,
    ) -> None:
        result = parse_excel_bytes(valid_xlsx_bytes, "datos.xlsx")
        assert len(result.rows) == 3
        first = result.rows[0]
        assert first["CUADRANTE AFECTADO"] == "CUAD-01"
        assert first["FECHA DE CORTE"] == "2024-01-15"
        assert first["MOTIVO"] == "Mantenimiento"
        assert first["DIRECCIÓN"] == "Av. Principal 100"

    def test_row_values_are_strings(self, valid_xlsx_bytes: bytes) -> None:
        result = parse_excel_bytes(valid_xlsx_bytes, "datos.xlsx")
        for row in result.rows:
            for value in row.values():
                assert isinstance(value, str)

    def test_numeric_cells_are_coerced_to_str(self) -> None:
        content = _build_xlsx(
            [
                ["CODIGO", "VALOR"],
                [123, 4.5],
                [456, 7],
            ],
        )
        result = parse_excel_bytes(content, "x.xlsx")
        assert result.rows[0]["CODIGO"] == "123"
        assert result.rows[0]["VALOR"] == "4.5"
        assert result.rows[1]["CODIGO"] == "456"
        assert result.rows[1]["VALOR"] == "7"

    def test_none_cells_are_coerced_to_empty_string(self) -> None:
        content = _build_xlsx(
            [
                ["A", "B", "C"],
                ["v1", None, "v3"],
                [None, None, "v3b"],
            ],
        )
        result = parse_excel_bytes(content, "x.xlsx")
        assert result.rows[0] == {"A": "v1", "B": "", "C": "v3"}
        assert result.rows[1] == {"A": "", "B": "", "C": "v3b"}

    def test_skips_completely_empty_rows_with_warning(self) -> None:
        content = _build_xlsx(
            [
                ["A", "B"],
                ["v1", "v2"],
                [None, None],
                ["v3", "v4"],
                [None, None],
            ],
        )
        result = parse_excel_bytes(content, "x.xlsx")
        # sólo quedan 2 filas con datos reales
        assert len(result.rows) == 2
        assert result.rows[0]["A"] == "v1"
        assert result.rows[1]["A"] == "v3"
        # y debe haber al menos una warning reportando las filas omitidas
        assert result.warnings
        assert any("omitieron" in w.lower() for w in result.warnings)

    def test_warnings_is_empty_tuple_when_no_empty_rows(
        self, valid_xlsx_bytes: bytes,
    ) -> None:
        result = parse_excel_bytes(valid_xlsx_bytes, "datos.xlsx")
        assert result.warnings == ()

    def test_accepts_uppercase_extension(self, valid_xlsx_bytes: bytes) -> None:
        # La validación de extensión es case-insensitive.
        result = parse_excel_bytes(valid_xlsx_bytes, "DATOS.XLSX")
        assert result.filename == "DATOS.XLSX"


# Errores: extensión (Req 6.2)


class TestInvalidExtension:
    @pytest.mark.parametrize(
        "bad_name",
        [
            "datos.csv",
            "datos.xls",
            "datos.txt",
            "datos",          # sin extensión
            "datos.xlsx.bak", # extensión engañosa
        ],
    )
    def test_rejects_non_xlsx_extension(
        self, valid_xlsx_bytes: bytes, bad_name: str,
    ) -> None:
        with pytest.raises(
            InvalidExcelError, match=r"^Solo se admiten archivos \.xlsx$",
        ):
            parse_excel_bytes(valid_xlsx_bytes, bad_name)


# Errores: archivo sin filas (Req 6.5)


class TestNoDataRows:
    def test_header_only_file_rejected(
        self, header_only_xlsx_bytes: bytes,
    ) -> None:
        with pytest.raises(
            InvalidExcelError, match=r"^El Excel no contiene filas de datos$",
        ):
            parse_excel_bytes(header_only_xlsx_bytes, "vacio.xlsx")

    def test_only_empty_rows_rejected(self) -> None:
        content = _build_xlsx(
            [
                ["A", "B"],
                [None, None],
                [None, None],
            ],
        )
        with pytest.raises(
            InvalidExcelError, match=r"^El Excel no contiene filas de datos$",
        ):
            parse_excel_bytes(content, "vacio.xlsx")


# Errores: límite de filas (Req 6.8)


class TestRowLimit:
    def test_accepts_exactly_max_rows(self) -> None:
        """10.000 filas de datos deben aceptarse (límite inclusivo)."""
        rows: list[list[Any]] = [["A"]]
        rows.extend([f"v{i}"] for i in range(MAX_EXCEL_ROWS))
        content = _build_xlsx(rows)
        result = parse_excel_bytes(content, "big.xlsx")
        assert len(result.rows) == MAX_EXCEL_ROWS

    def test_rejects_more_than_max_rows(self) -> None:
        """10.001 filas de datos → rechazo con mensaje exacto."""
        rows: list[list[Any]] = [["A"]]
        rows.extend([f"v{i}"] for i in range(MAX_EXCEL_ROWS + 1))
        content = _build_xlsx(rows)
        with pytest.raises(
            InvalidExcelError,
            match=r"^El Excel excede el límite de 10\.000 filas$",
        ):
            parse_excel_bytes(content, "huge.xlsx")


# Errores: archivo corrupto o ilegible (Req 6.6)


class TestUnreadableFile:
    def test_not_an_xlsx_bytes_are_rejected(self) -> None:
        with pytest.raises(
            InvalidExcelError, match=r"^No se pudo leer el archivo Excel:",
        ):
            parse_excel_bytes(b"not-a-real-xlsx-just-plain-text", "datos.xlsx")

    def test_empty_bytes_are_rejected(self) -> None:
        with pytest.raises(
            InvalidExcelError, match=r"^No se pudo leer el archivo Excel:",
        ):
            parse_excel_bytes(b"", "datos.xlsx")

    def test_truncated_zip_bytes_are_rejected(self) -> None:
        # Empieza con la firma mágica de ZIP pero el contenido está
        # truncado → openpyxl lanzará BadZipFile.
        truncated = b"PK\x03\x04" + b"\x00" * 20
        with pytest.raises(
            InvalidExcelError, match=r"^No se pudo leer el archivo Excel:",
        ):
            parse_excel_bytes(truncated, "datos.xlsx")

    def test_non_bytes_content_is_rejected(self) -> None:
        with pytest.raises(
            InvalidExcelError, match=r"^No se pudo leer el archivo Excel:",
        ):
            parse_excel_bytes("not bytes", "datos.xlsx")  # type: ignore[arg-type]


# Errores: cabecera inválida / columnas duplicadas (Req 6.6)


class TestInvalidHeader:
    def test_header_with_none_cell_rejected(self) -> None:
        content = _build_xlsx(
            [
                ["A", None, "C"],
                ["v1", "v2", "v3"],
            ],
        )
        with pytest.raises(
            InvalidExcelError, match=r"^No se pudo leer el archivo Excel:",
        ):
            parse_excel_bytes(content, "datos.xlsx")

    def test_header_with_blank_string_rejected(self) -> None:
        content = _build_xlsx(
            [
                ["A", "   ", "C"],
                ["v1", "v2", "v3"],
            ],
        )
        with pytest.raises(
            InvalidExcelError, match=r"^No se pudo leer el archivo Excel:",
        ):
            parse_excel_bytes(content, "datos.xlsx")

    def test_columns_colliding_after_normalization_rejected(self) -> None:
        # "Dirección" y "DIRECCION" colapsan a la misma columna normalizada.
        content = _build_xlsx(
            [
                ["Dirección", "DIRECCION"],
                ["calle 1", "calle 2"],
            ],
        )
        with pytest.raises(
            InvalidExcelError,
            match=r"columnas duplicadas tras normalizar",
        ):
            parse_excel_bytes(content, "datos.xlsx")
